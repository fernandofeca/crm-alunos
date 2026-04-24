/**
 * Relatório de Coaching — Automação do envio semanal
 *
 * Fluxo (descoberto via debug 2025-04-24):
 *  1. Admin login → PHPSESSID
 *  2. Scraping de todas as páginas de /alunos/coaching → lista de IDs
 *  3. POST /intent/cadastrar-relatorio-coach (lote de IDs, datas, agrupamento)
 *     → retorna [{id, token}, ...]
 *  4. Para cada aluno e cada modelo ('aluno' e 'questoes'):
 *     POST /intent/cadastrar-envio-relatorio-coach → dispara email ao aluno
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
  const dtIni = formatDateBR(ini);
  return { dtIni, dtFim };
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

// ─── scraping de IDs ─────────────────────────────────────────────────────────

async function scraparIdsCoaching(adminCookie: string): Promise<string[]> {
  const ids = new Set<string>();

  function parsePage(html: string) {
    for (const m of html.matchAll(/class="relatorio-aluno-check"[^>]*data-id="(\d+)"/g)) {
      ids.add(m[1]);
    }
    // fallback: qualquer data-id em checkboxes da tabela
    for (const m of html.matchAll(/data-id="(\d+)"[^>]*class="relatorio-aluno-check"/g)) {
      ids.add(m[1]);
    }
  }

  const firstHtml = await fetch("https://admin.tutory.com.br/alunos/coaching?p=1", {
    headers: { Cookie: adminCookie },
  }).then((r) => r.text());

  if (firstHtml.includes('document.location.href = "/login"')) return [];
  parsePage(firstHtml);

  const totalMatch = firstHtml.match(/\?p=(\d+)[^"]*">Última/) ?? firstHtml.match(/Mostrando entre \d+ e \d+ de (\d+)/);
  let totalPages = 1;
  if (totalMatch) {
    // se encontrou link "Última" usa o número de páginas, senão estima
    const n = parseInt(totalMatch[1], 10);
    totalPages = firstHtml.includes("Última") ? n : Math.ceil(n / 100);
  }

  // Busca em paralelo (lotes de 5)
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

  return [...ids];
}

// ─── passo 1: gerar relatórios em lote ──────────────────────────────────────

interface RelatorioToken { id: string; token: string }

async function gerarRelatorios(
  adminCookie: string,
  ids: string[],
  dtIni: string,
  dtFim: string,
  agrupamento = "semana"
): Promise<RelatorioToken[]> {
  const tokens: RelatorioToken[] = [];

  // Lotes de 50 IDs por chamada
  for (let i = 0; i < ids.length; i += 50) {
    const lote = ids.slice(i, i + 50);
    try {
      const res = await fetch("https://admin.tutory.com.br/intent/cadastrar-relatorio-coach", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest",
          Cookie: adminCookie,
        },
        body: new URLSearchParams({
          "alunos[]": lote.join(","), // fallback
          dt_ini: dtIni,
          dt_fim: dtFim,
          agrupamento,
        }).toString().replace("alunos%5B%5D=", `alunos[]=${lote[0]}&`) +
          lote.slice(1).map((id) => `&alunos[]=${id}`).join(""),
      });

      const json = await res.json().catch(() => null);
      const data: RelatorioToken[] = json?.data ?? [];
      tokens.push(...data);
    } catch {
      // continua com os próximos lotes
    }

    if (i + 50 < ids.length) await new Promise((r) => setTimeout(r, 800));
  }

  return tokens;
}

// ─── passo 1 (alternativa): body correto para array PHP ─────────────────────

async function gerarRelatoriosV2(
  adminCookie: string,
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
  tokens: RelatorioToken[],
  dtIni: string,
  dtFim: string
): Promise<EnvioResult[]> {
  const resultados: EnvioResult[] = [];

  // 3 alunos × 2 modelos por lote, intervalo de 400ms
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
              resultados.push({
                alunoId: t.id,
                modelo,
                ok: true,
                email: json?.data?.email,
              });
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
  if (!adminCookie) {
    return NextResponse.json({ error: "Falha no login admin" }, { status: 500 });
  }

  const ids = await scraparIdsCoaching(adminCookie);
  if (ids.length === 0) {
    return NextResponse.json({ ok: true, total: 0, msg: "Nenhum aluno encontrado na página de coaching" });
  }

  const { dtIni, dtFim } = calcDatas();

  const tokens = await gerarRelatoriosV2(adminCookie, ids, dtIni, dtFim, "semana");
  if (tokens.length === 0) {
    return NextResponse.json({
      ok: false,
      total: ids.length,
      msg: "Relatórios não foram gerados — verifique o endpoint cadastrar-relatorio-coach",
      dtIni,
      dtFim,
    });
  }

  const envios = await enviarEmails(adminCookie, tokens, dtIni, dtFim);
  const enviados = envios.filter((e) => e.ok).length;
  const falhas = envios.filter((e) => !e.ok);

  return NextResponse.json({
    ok: true,
    totalAlunos: ids.length,
    tokenGerados: tokens.length,
    emailsEnviados: enviados,
    emailsEsperados: tokens.length * MODELOS.length,
    falhas: falhas.length > 0 ? falhas : undefined,
    dtIni,
    dtFim,
    agrupamento: "semana",
    modelos: MODELOS,
    executadoEm: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
  });
}

// ─── debug: testa com 1 aluno ────────────────────────────────────────────────

async function executarDebug() {
  const adminCookie = await getAdminCookie();
  if (!adminCookie) return NextResponse.json({ error: "Login falhou" });

  const ids = await scraparIdsCoaching(adminCookie);
  if (ids.length === 0) return NextResponse.json({ msg: "Nenhum aluno no coaching" });

  const { dtIni, dtFim } = calcDatas();
  const primeiroId = ids[0];

  // Gera relatório só para o 1º aluno
  const body = `alunos[]=${encodeURIComponent(primeiroId)}&dt_ini=${encodeURIComponent(dtIni)}&dt_fim=${encodeURIComponent(dtFim)}&agrupamento=semana`;
  const gerarRes = await fetch("https://admin.tutory.com.br/intent/cadastrar-relatorio-coach", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      Cookie: adminCookie,
    },
    body,
  });
  const gerarJson = await gerarRes.json().catch(() => null);
  const tokens: RelatorioToken[] = gerarJson?.data ?? [];

  if (tokens.length === 0) {
    return NextResponse.json({
      etapa: "gerar-relatorio",
      status: gerarRes.status,
      resposta: gerarJson,
      primeiroId,
      dtIni,
      dtFim,
      erro: "Nenhum token retornado",
    });
  }

  // Envia email modelo 'aluno' para o 1º aluno (sem disparar 'questoes' no debug)
  const t = tokens[0];
  const enviarRes = await fetch("https://admin.tutory.com.br/intent/cadastrar-envio-relatorio-coach", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      Cookie: adminCookie,
    },
    body: new URLSearchParams({
      aluno_id: t.id,
      token: t.token,
      dt_ini: dtIni,
      dt_fim: dtFim,
      modelo: "aluno",
    }).toString(),
  });
  const enviarJson = await enviarRes.json().catch(() => null);

  return NextResponse.json({
    totalAlunos: ids.length,
    primeiroId,
    dtIni,
    dtFim,
    gerarStatus: gerarRes.status,
    gerarResposta: gerarJson,
    tokenObtido: t,
    enviarStatus: enviarRes.status,
    enviarResposta: enviarJson,
  });
}

// ─── handlers HTTP ───────────────────────────────────────────────────────────

// GET ?key=cg-bulk-2026&debug=1  → testa com 1 aluno
// GET ?key=cg-bulk-2026           → cron (fire-and-forget)
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== "cg-bulk-2026") return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  if (req.nextUrl.searchParams.get("debug") === "1") {
    return executarDebug();
  }

  // Cron: dispara em background
  executarRelatorios().catch((e) => console.error("[relatorio-coaching-bg]", e));
  return NextResponse.json({
    ok: true,
    message: "Relatórios de coaching iniciados em background",
    timestamp: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
  });
}

// POST autenticado → aguarda resultado completo
export async function POST(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== "cg-bulk-2026") {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  return executarRelatorios();
}
