/**
 * Replanejamento de Cronogramas
 *
 * Fluxo por aluno:
 *  1. POST ver-painel (cpf + id + token + adm_id) → PHPSESSID do app.tutory.com.br
 *  2. GET /painel/config/replanejar-atrasos com esse PHPSESSID
 *     → a página PHP executa o replanejamento do cronograma server-side
 *
 * Debug (GET ?key=cg-bulk-2026&debug=1):
 *  → mostra HTML de /painel/config/replanejar-atrasos do 1º aluno atrasado
 *  → permite ajustar se for necessário fazer POST em vez de GET
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

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

interface AlunoForm {
  id: string;
  cpf: string;
  token: string;
  admId: string;
  nome: string;
  email: string;
}

async function scraparFormularios(adminCookie: string): Promise<AlunoForm[]> {
  const result: AlunoForm[] = [];

  function parsePage(html: string) {
    const blocks = html.split('class="student-list-item"');
    for (const block of blocks.slice(1)) {
      const searchMatch = block.match(/data-search="([^"]+)"/);
      if (!searchMatch) continue;
      const parts = searchMatch[1].trim().split(" ");
      const email = parts[parts.length - 1].toLowerCase();
      const nome = parts.slice(0, -1).join(" ").trim();

      const id    = block.match(/name="id"\s+value="(\d+)"/)?.[1] ?? "";
      const cpf   = block.match(/name="cpf"\s+value="([^"]+)"/)?.[1] ?? "";
      const token = block.match(/name="token"\s+value="([^"]+)"/)?.[1] ?? "";
      const admId = block.match(/name="adm_id"\s+value="(\d+)"/)?.[1] ?? "";

      if (id && cpf && token && admId) {
        result.push({ id, cpf, token, admId, nome, email });
      }
    }
  }

  const firstHtml = await fetch("https://admin.tutory.com.br/alunos/atraso?p=1", {
    headers: { Cookie: adminCookie },
  }).then((r) => r.text());

  if (firstHtml.includes('document.location.href = "/login"')) return [];
  parsePage(firstHtml);

  const totalPagesMatch = firstHtml.match(/\?p=(\d+)[^"]*">Última/);
  const totalPages = totalPagesMatch ? parseInt(totalPagesMatch[1], 10) : 1;

  for (let start = 2; start <= totalPages; start += 5) {
    const batch = [];
    for (let p = start; p < start + 5 && p <= totalPages; p++) {
      batch.push(
        fetch(`https://admin.tutory.com.br/alunos/atraso?p=${p}`, {
          headers: { Cookie: adminCookie },
        })
          .then((r) => r.text())
          .then(parsePage)
      );
    }
    await Promise.all(batch);
  }

  return result;
}

/** Obtém PHPSESSID do app.tutory.com.br para o aluno via ver-painel */
async function obterSessaoAluno(aluno: AlunoForm): Promise<string | null> {
  const verRes = await fetch("https://app.tutory.com.br/intent/ver-painel", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
      Origin: "https://app.tutory.com.br",
      Referer: "https://admin.tutory.com.br/alunos/atraso",
    },
    body: `cpf=${encodeURIComponent(aluno.cpf)}&id=${aluno.id}&token=${encodeURIComponent(aluno.token)}&adm_id=${aluno.admId}`,
    redirect: "manual",
  });

  return verRes.headers.get("set-cookie")?.match(/PHPSESSID=[^;]+/)?.[0] ?? null;
}

interface ReplanejamentoResult {
  nome: string;
  id: string;
  status: number | string;
  replanStatus?: number | string;
}

async function replanejamentoAluno(aluno: AlunoForm): Promise<ReplanejamentoResult> {
  try {
    // 1. Obter sessão do aluno no app
    const sessionCookie = await obterSessaoAluno(aluno);
    if (!sessionCookie) {
      return { nome: aluno.nome, id: aluno.id, status: "sem-sessão" };
    }

    // 2. Visitar /painel/config/replanejar-atrasos → PHP executa replanejamento
    const replanRes = await fetch("https://app.tutory.com.br/painel/config/replanejar-atrasos", {
      method: "GET",
      headers: {
        Cookie: sessionCookie,
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9",
        Referer: "https://app.tutory.com.br/painel/",
      },
      redirect: "follow",
    });

    return {
      nome: aluno.nome,
      id: aluno.id,
      status: "ok",
      replanStatus: replanRes.status,
    };
  } catch (e) {
    return { nome: aluno.nome, id: aluno.id, status: String(e) };
  }
}

async function executarReplanejamento() {
  const adminCookie = await getAdminCookie();
  if (!adminCookie) {
    return NextResponse.json({ error: "Falha no login admin" }, { status: 500 });
  }

  const alunos = await scraparFormularios(adminCookie);

  if (alunos.length === 0) {
    return NextResponse.json({
      ok: true,
      total: 0,
      msg: "Nenhum aluno atrasado encontrado",
      executadoEm: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    });
  }

  const resultados: ReplanejamentoResult[] = [];

  for (let i = 0; i < alunos.length; i += 3) {
    const lote = alunos.slice(i, i + 3);
    const resps = await Promise.all(lote.map(replanejamentoAluno));
    resultados.push(...resps);
    if (i + 3 < alunos.length) await new Promise((r) => setTimeout(r, 400));
  }

  const sucessos = resultados.filter(
    (r) => r.status === "ok" && typeof r.replanStatus === "number" && r.replanStatus < 400
  ).length;

  return NextResponse.json({
    ok: true,
    total: alunos.length,
    replanejados: sucessos,
    falhas: resultados.filter(
      (r) => r.status !== "ok" || typeof r.replanStatus !== "number" || r.replanStatus >= 400
    ),
    executadoEm: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
  });
}

// GET ?key=cg-bulk-2026&debug=1 — mostra HTML de /painel/config/replanejar-atrasos do 1º aluno
// GET ?key=cg-bulk-2026          — cron (background)
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== "cg-bulk-2026") return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  if (req.nextUrl.searchParams.get("debug") === "1") {
    const adminCookie = await getAdminCookie();
    if (!adminCookie) return NextResponse.json({ error: "Login admin falhou" });

    const alunos = await scraparFormularios(adminCookie);
    const primeiro = alunos[0];
    if (!primeiro) return NextResponse.json({ error: "Nenhum aluno na lista de atrasos" });

    // Passo 1: obter sessão
    const sessionCookie = await obterSessaoAluno(primeiro);

    if (!sessionCookie) {
      return NextResponse.json({ error: "ver-painel não retornou PHPSESSID" });
    }

    // Passo 2: GET /painel/config/replanejar-atrasos
    const replanRes = await fetch("https://app.tutory.com.br/painel/config/replanejar-atrasos", {
      method: "GET",
      headers: {
        Cookie: sessionCookie,
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9",
        Referer: "https://app.tutory.com.br/painel/",
      },
      redirect: "manual", // manual para ver redirect
    });

    const replanLocation = replanRes.headers.get("location") ?? null;
    const replanCookie = replanRes.headers.get("set-cookie") ?? null;
    const replanHtml = await replanRes.text();

    // Se redirecionar, seguir
    let finalHtml = replanHtml;
    let finalStatus = replanRes.status;
    if (replanRes.status >= 300 && replanRes.status < 400 && replanLocation) {
      const dest = replanLocation.startsWith("http")
        ? replanLocation
        : `https://app.tutory.com.br${replanLocation}`;
      const finalRes = await fetch(dest, {
        headers: { Cookie: sessionCookie, "User-Agent": BROWSER_UA },
        redirect: "follow",
      });
      finalHtml = await finalRes.text();
      finalStatus = finalRes.status;
    }

    // Buscar indicadores de sucesso no HTML
    const sucessoIndicadores = [
      /sucesso|success|replanejado|atualizado|concluído/i.test(finalHtml),
    ];

    return NextResponse.json({
      primeiroAluno: { nome: primeiro.nome, id: primeiro.id },
      sessionObtida: true,
      replanRequest: {
        status: replanRes.status,
        location: replanLocation,
        setCookie: replanCookie,
      },
      finalStatus,
      sucessoNoHtml: sucessoIndicadores[0],
      // Primeiros 2000 chars do HTML final
      htmlPreview: finalHtml.slice(0, 2000),
      // Todos os forms na página
      forms: [...finalHtml.matchAll(/<form[^>]*action="([^"]*)"[^>]*>/gi)].map((m) => m[1]),
      // Contexto ao redor de palavras-chave
      contextos: (() => {
        const hits: string[] = [];
        for (const kw of ["replan", "sucesso", "cronograma", "atraso"]) {
          const idx = finalHtml.toLowerCase().indexOf(kw);
          if (idx >= 0) {
            hits.push(finalHtml.slice(Math.max(0, idx - 50), idx + 200));
          }
        }
        return hits;
      })(),
    });
  }

  executarReplanejamento().catch((e) => console.error("[replanejamento-bg]", e));
  return NextResponse.json({
    ok: true,
    message: "Replanejamento iniciado em background",
    timestamp: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
  });
}

// POST autenticado — aguarda resultado completo
export async function POST(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== "cg-bulk-2026") {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  return executarReplanejamento();
}
