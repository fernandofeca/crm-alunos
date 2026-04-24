/**
 * Relatório de Coaching — Automação do envio semanal
 *
 * Fluxo (confirmado via debug 2025-04-24):
 *  1. Admin login → PHPSESSID
 *  2. GET /alunos/coaching → extrai adminUser.token (Bearer) + IDs dos alunos
 *  3. POST /intent/cadastrar-relatorio-coach (lote de IDs, datas, agrupamento)
 *     → retorna [{id, token}, ...]  — usa Authorization: Bearer adminUser.token
 *  4. Para cada aluno × cada modelo ('aluno', 'questoes'):
 *     POST /intent/cadastrar-envio-relatorio-coach → dispara email
 *
 * Datas: dt_ini = hoje − 4 meses | dt_fim = hoje | agrupamento = semana
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

// ─── helpers ────────────────────────────────────────────────────────────────

function formatDateBR(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

function calcDatas() {
  const hoje = new Date();
  const dtFim = formatDateBR(hoje);
  const ini = new Date(hoje);
  ini.setMonth(ini.getMonth() - 4);
  return { dtIni: formatDateBR(ini), dtFim };
}

async function getAdminCookie(): Promise<string> {
  const account = process.env.TUTORY_ACCOUNT ?? "";
  const password = process.env.TUTORY_PASSWORD ?? "";
  if (!account || !password) return "";
  const res = await fetch("https://admin.tutory.com.br/intent/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: `account=${encodeURIComponent(account)}&password=${encodeURIComponent(password)}`,
    redirect: "manual",
  });
  return res.headers.get("set-cookie")?.match(/PHPSESSID=[^;]+/)?.[0] ?? "";
}

// ─── extrai IDs + adminUser.token da página de coaching ─────────────────────

interface CoachingPageData { ids: string[]; bearerToken: string }

async function scraparCoachingPage(adminCookie: string): Promise<CoachingPageData> {
  const ids = new Set<string>();

  function parsePage(html: string) {
    for (const m of html.matchAll(/relatorio-aluno-check"[^>]*data-id="(\d+)"/g)) ids.add(m[1]);
    for (const m of html.matchAll(/data-id="(\d+)"[^>]*relatorio-aluno-check"/g)) ids.add(m[1]);
  }

  const firstHtml = await fetch("https://admin.tutory.com.br/alunos/coaching?p=1", {
    headers: { Cookie: adminCookie },
  }).then((r) => r.text());

  if (firstHtml.includes('document.location.href = "/login"')) return { ids: [], bearerToken: "" };

  // Extrai adminUser.token embutido no HTML
  const bearerToken = firstHtml.match(/adminUser\s*=\s*\{[^}]*token\s*:\s*['"]([^'"]+)['"]/)?.[1] ?? "";

  parsePage(firstHtml);

  // Paginação
  const ultimaMatch = firstHtml.match(/\?p=(\d+)[^"]*"[^>]*>\s*[ÚU]ltima/);
  const totalAlunosMatch = firstHtml.match(/Mostrando entre \d+ e \d+ de (\d+)/);
  let totalPages = 1;
  if (ultimaMatch) totalPages = parseInt(ultimaMatch[1], 10);
  else if (totalAlunosMatch) totalPages = Math.ceil(parseInt(totalAlunosMatch[1], 10) / 100);

  for (let start = 2; start <= totalPages; start += 5) {
    const batch: Promise<void>[] = [];
    for (let p = start; p < start + 5 && p <= totalPages; p++) {
      batch.push(
        fetch(`https://admin.tutory.com.br/alunos/coaching?p=${p}`, { headers: { Cookie: adminCookie } })
          .then((r) => r.text())
          .then(parsePage)
      );
    }
    await Promise.all(batch);
  }

  return { ids: [...ids], bearerToken };
}

// ─── passo 1: gerar relatórios em lote ──────────────────────────────────────

interface RelatorioToken { id: string; token: string }

async function gerarRelatoriosV2(
  adminCookie: string,
  bearerToken: string,
  ids: string[],
  dtIni: string,
  dtFim: string,
  agrupamento = "semana"
): Promise<RelatorioToken[]> {
  const tokens: RelatorioToken[] = [];

  for (let i = 0; i < ids.length; i += 50) {
    const lote = ids.slice(i, i + 50);
    const body = lote.map((id) => `alunos[]=${encodeURIComponent(id)}`).join("&")
      + `&dt_ini=${encodeURIComponent(dtIni)}&dt_fim=${encodeURIComponent(dtFim)}&agrupamento=${encodeURIComponent(agrupamento)}`;

    try {
      const res = await fetch("https://admin.tutory.com.br/intent/cadastrar-relatorio-coach", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest",
          "Authorization": `Bearer ${bearerToken}`,
          Cookie: adminCookie,
        },
        body,
      });

      const json = await res.json().catch(() => null);
      const data: RelatorioToken[] = json?.data ?? [];
      tokens.push(...data);
    } catch {
      // continua
    }

    if (i + 50 < ids.length) await new Promise((r) => setTimeout(r, 800));
  }

  return tokens;
}

// ─── passo 2: enviar emails ──────────────────────────────────────────────────

const MODELOS = ["aluno", "questoes"] as const;

interface EnvioResult { alunoId: string; modelo: string; ok: boolean; email?: string; erro?: string }

async function enviarEmails(
  adminCookie: string,
  bearerToken: string,
  tokens: RelatorioToken[],
  dtIni: string,
  dtFim: string
): Promise<EnvioResult[]> {
  const resultados: EnvioResult[] = [];

  for (let i = 0; i < tokens.length; i += 3) {
    const lote = tokens.slice(i, i + 3);
    const tasks: Promise<void>[] = [];

    for (const t of lote) {
      for (const modelo of MODELOS) {
        tasks.push(
          fetch("https://admin.tutory.com.br/intent/cadastrar-envio-relatorio-coach", {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
              "X-Requested-With": "XMLHttpRequest",
              "Authorization": `Bearer ${bearerToken}`,
              Cookie: adminCookie,
            },
            body: new URLSearchParams({
              aluno_id: t.id,
              token: t.token,
              dt_ini: dtIni,
              dt_fim: dtFim,
              modelo,
            }).toString(),
          })
            .then((r) => r.json())
            .then((json) => {
              resultados.push({ alunoId: t.id, modelo, ok: true, email: json?.data?.email });
            })
            .catch((e) => {
              resultados.push({ alunoId: t.id, modelo, ok: false, erro: String(e) });
            })
        );
      }
    }

    await Promise.all(tasks);
    if (i + 3 < tokens.length) await new Promise((r) => setTimeout(r, 400));
  }

  return resultados;
}

// ─── orquestrador ────────────────────────────────────────────────────────────

async function executarRelatorios() {
  const adminCookie = await getAdminCookie();
  if (!adminCookie) return NextResponse.json({ error: "Falha no login admin" }, { status: 500 });

  const { ids, bearerToken } = await scraparCoachingPage(adminCookie);

  if (ids.length === 0) return NextResponse.json({ ok: true, total: 0, msg: "Nenhum aluno na página de coaching" });
  if (!bearerToken) return NextResponse.json({ ok: false, error: "adminUser.token não encontrado na página" }, { status: 500 });

  const { dtIni, dtFim } = calcDatas();

  const relTokens = await gerarRelatoriosV2(adminCookie, bearerToken, ids, dtIni, dtFim, "semana");
  if (relTokens.length === 0) {
    return NextResponse.json({
      ok: false,
      totalAlunos: ids.length,
      msg: "Nenhum token retornado por cadastrar-relatorio-coach",
      dtIni,
      dtFim,
    });
  }

  const envios = await enviarEmails(adminCookie, bearerToken, relTokens, dtIni, dtFim);
  const enviados = envios.filter((e) => e.ok).length;
  const falhas = envios.filter((e) => !e.ok);

  return NextResponse.json({
    ok: true,
    totalAlunos: ids.length,
    tokenGerados: relTokens.length,
    emailsEnviados: enviados,
    emailsEsperados: relTokens.length * MODELOS.length,
    falhas: falhas.length > 0 ? falhas : undefined,
    dtIni,
    dtFim,
    agrupamento: "semana",
    modelos: MODELOS,
    executadoEm: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
  });
}

// ─── debug: testa com o 1º aluno ────────────────────────────────────────────

async function executarDebug() {
  const adminCookie = await getAdminCookie();
  if (!adminCookie) return NextResponse.json({ error: "Login falhou" });

  const { ids, bearerToken } = await scraparCoachingPage(adminCookie);
  if (ids.length === 0) return NextResponse.json({ msg: "Nenhum aluno no coaching" });
  if (!bearerToken) return NextResponse.json({ erro: "adminUser.token não encontrado" });

  const { dtIni, dtFim } = calcDatas();
  const primeiroId = ids[0];

  // Gera relatório só para o 1º aluno
  const body = `alunos[]=${encodeURIComponent(primeiroId)}&dt_ini=${encodeURIComponent(dtIni)}&dt_fim=${encodeURIComponent(dtFim)}&agrupamento=semana`;
  const gerarRes = await fetch("https://admin.tutory.com.br/intent/cadastrar-relatorio-coach", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      "Authorization": `Bearer ${bearerToken}`,
      Cookie: adminCookie,
    },
    body,
  });
  const gerarJson = await gerarRes.json().catch(() => null);
  const relTokens: RelatorioToken[] = gerarJson?.data ?? [];

  if (relTokens.length === 0) {
    return NextResponse.json({ etapa: "gerar-relatorio", status: gerarRes.status, resposta: gerarJson, primeiroId, dtIni, dtFim, erro: "Nenhum token retornado" });
  }

  // Envia só modelo 'aluno' para o 1º (debug conservador)
  const t = relTokens[0];
  const enviarRes = await fetch("https://admin.tutory.com.br/intent/cadastrar-envio-relatorio-coach", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      "Authorization": `Bearer ${bearerToken}`,
      Cookie: adminCookie,
    },
    body: new URLSearchParams({ aluno_id: t.id, token: t.token, dt_ini: dtIni, dt_fim: dtFim, modelo: "aluno" }).toString(),
  });
  const enviarJson = await enviarRes.json().catch(() => null);

  return NextResponse.json({
    totalAlunos: ids.length,
    primeiroId,
    dtIni,
    dtFim,
    bearerTokenOk: bearerToken.length > 10,
    gerarStatus: gerarRes.status,
    gerarResposta: gerarJson,
    tokenObtido: t,
    enviarStatus: enviarRes.status,
    enviarResposta: enviarJson,
  });
}

// ─── handlers HTTP ───────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== "cg-bulk-2026") return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  if (req.nextUrl.searchParams.get("debug") === "1") return executarDebug();

  executarRelatorios().catch((e) => console.error("[relatorio-coaching-bg]", e));
  return NextResponse.json({
    ok: true,
    message: "Relatórios de coaching iniciados em background",
    timestamp: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
  });
}

export async function POST(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== "cg-bulk-2026") {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  return executarRelatorios();
}
