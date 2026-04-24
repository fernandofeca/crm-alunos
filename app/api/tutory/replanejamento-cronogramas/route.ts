/**
 * Replanejamento de Cronogramas
 *
 * O debug anterior descobriu:
 * - O PHP gera inline: swal('Cronograma Replanejado', ..., 'info');
 * - O comportamento do OK está no tutory-dashboard-notificacoes.js
 *
 * Este debug busca e analisa esses arquivos JS específicos.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

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
      if (id && cpf && token && admId) result.push({ id, cpf, token, admId, nome, email });
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
    const batch: Promise<void>[] = [];
    for (let p = start; p < start + 5 && p <= totalPages; p++) {
      batch.push(
        fetch(`https://admin.tutory.com.br/alunos/atraso?p=${p}`, { headers: { Cookie: adminCookie } })
          .then((r) => r.text())
          .then(parsePage)
      );
    }
    await Promise.all(batch);
  }

  return result;
}

async function obterSessaoAluno(aluno: AlunoForm): Promise<{ cookie: string; location: string } | null> {
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
  const cookie = verRes.headers.get("set-cookie")?.match(/PHPSESSID=[^;]+/)?.[0] ?? "";
  const location = verRes.headers.get("location") ?? "/painel/";
  if (!cookie) return null;
  return { cookie, location };
}

/** Extrai todas as chamadas de intent/ de um bloco JS */
function extrairIntentCalls(js: string): string[] {
  const linhas = js.split("\n");
  return linhas
    .filter((l) => /intent\//i.test(l))
    .map((l) => l.trim())
    .filter((l) => l.length < 400);
}

/** Extrai contexto ao redor de uma palavra num JS */
function contextoAoRedor(js: string, palavra: string, janela = 800): string[] {
  const resultados: string[] = [];
  const lower = js.toLowerCase();
  const palavraLower = palavra.toLowerCase();
  let idx = 0;
  while ((idx = lower.indexOf(palavraLower, idx)) !== -1) {
    resultados.push(js.slice(Math.max(0, idx - 200), idx + janela));
    idx += palavraLower.length;
    if (resultados.length >= 5) break;
  }
  return resultados;
}

interface ReplanejamentoResult {
  nome: string;
  id: string;
  status: number | string;
  notifIds?: string[];
  replanStatus?: number | string;
}

async function replanejamentoAluno(aluno: AlunoForm): Promise<ReplanejamentoResult> {
  try {
    const sessao = await obterSessaoAluno(aluno);
    if (!sessao) return { nome: aluno.nome, id: aluno.id, status: "sem-sessão" };

    const { cookie: sessionCookie, location } = sessao;
    const panelUrl = location.startsWith("http") ? location : `https://app.tutory.com.br${location}`;

    // Visitar /painel/ para disparar o swal (PHP processa o replanejamento)
    await fetch(panelUrl, {
      headers: {
        Cookie: sessionCookie,
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml",
        Referer: "https://app.tutory.com.br/intent/ver-painel",
      },
      redirect: "follow",
    });

    // Visitar /painel/config/replanejar-atrasos para garantir que o replanejamento foi executado
    const replanRes = await fetch("https://app.tutory.com.br/painel/config/replanejar-atrasos", {
      method: "GET",
      headers: {
        Cookie: sessionCookie,
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml",
        Referer: panelUrl,
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

// GET ?key=cg-bulk-2026&debug=1  → analisa JS do Tutory para encontrar o endpoint do OK
// GET ?key=cg-bulk-2026           → cron (background)
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== "cg-bulk-2026") return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  if (req.nextUrl.searchParams.get("debug") === "1") {
    const adminCookie = await getAdminCookie();
    if (!adminCookie) return NextResponse.json({ error: "Login admin falhou" });

    const alunos = await scraparFormularios(adminCookie);
    const primeiro = alunos[0];
    if (!primeiro) return NextResponse.json({ error: "Nenhum aluno na lista" });

    // 1. Sessão do aluno
    const sessao = await obterSessaoAluno(primeiro);
    if (!sessao) return NextResponse.json({ error: "ver-painel sem PHPSESSID" });

    // 2. HTML do painel (para capturar inline scripts)
    const panelUrl = sessao.location.startsWith("http")
      ? sessao.location
      : `https://app.tutory.com.br${sessao.location}`;
    const panelHtml = await fetch(panelUrl, {
      headers: { Cookie: sessao.cookie, "User-Agent": BROWSER_UA, Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
    }).then((r) => r.text());

    // Scripts inline completos (sem truncar)
    const inlineScriptsCompletos = [...panelHtml.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/gi)]
      .map((m) => m[1].trim())
      .filter((s) => /swal|replan|notific|cronograma/i.test(s));

    // 3. Baixar e analisar os arquivos JS específicos do Tutory
    const arquivosTutory = [
      "https://static.tutory.com.br/js/tutory-dashboard-notificacoes.js",
      "https://static.tutory.com.br/js/tutory-dashboard-main.js",
      "https://app.tutory.com.br/assets/js/novo-layout.js?v=1.1",
    ];

    const jsAnalise: Record<string, unknown> = {};
    for (const url of arquivosTutory) {
      try {
        const js = await fetch(url, { headers: { "User-Agent": BROWSER_UA } }).then((r) => r.text());
        jsAnalise[url.split("/").pop()!] = {
          tamanho: js.length,
          intentCalls: extrairIntentCalls(js).slice(0, 20),
          contextoSwal: contextoAoRedor(js, "swal"),
          contextoReplan: contextoAoRedor(js, "replan"),
          contextoNotif: contextoAoRedor(js, "notific"),
        };
      } catch {
        jsAnalise[url.split("/").pop()!] = "FETCH_ERROR";
      }
    }

    return NextResponse.json({
      primeiroAluno: { nome: primeiro.nome, id: primeiro.id },
      inlineScriptsCompletos,
      jsAnalise,
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
