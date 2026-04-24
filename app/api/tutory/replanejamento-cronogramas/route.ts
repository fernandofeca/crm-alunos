/**
 * Replanejamento de Cronogramas
 *
 * Hipótese atual: o popup "Cronograma Replanejado" é gerado pelo JS externo
 * do Tutory. Precisamos encontrar qual endpoint o botão OK chama.
 *
 * Estratégia do debug:
 *  1. ver-painel → PHPSESSID
 *  2. Chamar selecionar-notificacoes SEM visitar /painel/ antes (ver se retorna dados)
 *  3. Extrair URLs de scripts JS do HTML do painel
 *  4. Baixar o JS do Tutory e buscar "replan", "selecionar", "cronograma", "intent"
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

/** Extrai URLs de scripts JS do HTML — preferindo scripts do Tutory */
function extrairScriptUrls(html: string): string[] {
  const urls: string[] = [];
  for (const m of html.matchAll(/<script[^>]+src="([^"]+)"/gi)) {
    const url = m[1];
    if (url.includes("tutory") || url.includes("/assets/js") || url.includes("/js/")) {
      urls.push(url.startsWith("http") ? url : `https://app.tutory.com.br${url}`);
    }
  }
  return urls;
}

/** Busca padrões relevantes em um arquivo JS */
function analisarJs(js: string): Record<string, string[]> {
  const resultado: Record<string, string[]> = {};

  // Linhas com "replan" ou "cronograma"
  const linhasReplan = js.split("\n")
    .filter((l) => /replan|cronograma/i.test(l))
    .map((l) => l.trim().slice(0, 300));
  if (linhasReplan.length) resultado.replan = linhasReplan.slice(0, 10);

  // Linhas com "selecionar"
  const linhasSelecionar = js.split("\n")
    .filter((l) => /selecionar/i.test(l))
    .map((l) => l.trim().slice(0, 300));
  if (linhasSelecionar.length) resultado.selecionar = linhasSelecionar.slice(0, 10);

  // Todos os endpoints intent/
  const intents = [...new Set([...js.matchAll(/intent\/[\w-]+/gi)].map((m) => m[0]))];
  if (intents.length) resultado.intents = intents;

  // Chamadas AJAX/fetch com /intent/
  const ajaxCalls = js.split("\n")
    .filter((l) => /intent\//i.test(l) && /post|fetch|ajax|url/i.test(l))
    .map((l) => l.trim().slice(0, 300));
  if (ajaxCalls.length) resultado.ajaxCalls = ajaxCalls.slice(0, 10);

  return resultado;
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
    // 1. Obter sessão do aluno
    const sessionCookie = await obterSessaoAluno(aluno);
    if (!sessionCookie) {
      return { nome: aluno.nome, id: aluno.id, status: "sem-sessão" };
    }

    // 2. Chamar selecionar-notificacoes com tutoryId → obter lista de notificações pendentes
    const notifRes = await fetch("https://app.tutory.com.br/intent/selecionar-notificacoes", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aluno.token}`,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Accept: "application/json, */*",
        Cookie: sessionCookie,
        Origin: "https://app.tutory.com.br",
        Referer: "https://app.tutory.com.br/painel/",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: `id=${aluno.id}`,
    });
    const notifData = await notifRes.json().catch(() => null) as { data?: Array<{ id: number | string }> } | null;

    const notifIds: string[] =
      Array.isArray(notifData?.data) && notifData!.data.length > 0
        ? notifData!.data.map((n) => String(n.id))
        : [];

    // 3a. Se encontrou IDs de notificação: confirmar cada um
    if (notifIds.length > 0) {
      const confirmacoes = await Promise.all(
        notifIds.map((nid) =>
          fetch("https://app.tutory.com.br/intent/selecionar-notificacoes", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${aluno.token}`,
              "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
              Cookie: sessionCookie,
              Origin: "https://app.tutory.com.br",
              Referer: "https://app.tutory.com.br/painel/",
              "X-Requested-With": "XMLHttpRequest",
            },
            body: `id=${nid}`,
          }).then((r) => r.status)
        )
      );
      return {
        nome: aluno.nome,
        id: aluno.id,
        status: "ok",
        notifIds,
        replanStatus: confirmacoes[0],
      };
    }

    // 3b. Fallback: visitar /painel/config/replanejar-atrasos
    const replanRes = await fetch("https://app.tutory.com.br/painel/config/replanejar-atrasos", {
      method: "GET",
      headers: {
        Cookie: sessionCookie,
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml",
        Referer: "https://app.tutory.com.br/painel/",
      },
      redirect: "follow",
    });

    return {
      nome: aluno.nome,
      id: aluno.id,
      status: "ok-fallback",
      notifIds: [],
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

  const comNotif = resultados.filter((r) => (r.notifIds?.length ?? 0) > 0).length;
  const fallback = resultados.filter((r) => r.status === "ok-fallback").length;
  const falhas   = resultados.filter((r) => r.status !== "ok" && r.status !== "ok-fallback");

  return NextResponse.json({
    ok: true,
    total: alunos.length,
    comNotificacoes: comNotif,
    fallback,
    falhas,
    executadoEm: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
  });
}

// GET ?key=cg-bulk-2026&debug=1 → inspeciona JS do Tutory para achar endpoint do OK
// GET ?key=cg-bulk-2026          → cron (background)
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== "cg-bulk-2026") return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  if (req.nextUrl.searchParams.get("debug") === "1") {
    const adminCookie = await getAdminCookie();
    if (!adminCookie) return NextResponse.json({ error: "Login admin falhou" });

    const alunos = await scraparFormularios(adminCookie);
    const primeiro = alunos[0];
    if (!primeiro) return NextResponse.json({ error: "Nenhum aluno na lista" });

    // Passo 1: ver-painel → PHPSESSID
    const sessionCookie = await obterSessaoAluno(primeiro);
    if (!sessionCookie) return NextResponse.json({ error: "ver-painel sem PHPSESSID" });

    // Passo 2: selecionar-notificacoes SEM visitar /painel/ antes
    const notifRes = await fetch("https://app.tutory.com.br/intent/selecionar-notificacoes", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${primeiro.token}`,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Accept: "application/json, */*",
        Cookie: sessionCookie,
        Origin: "https://app.tutory.com.br",
        Referer: "https://app.tutory.com.br/painel/",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: `id=${primeiro.id}`,
    });
    const notifData = await notifRes.json().catch(() => "PARSE_ERROR");

    // Passo 3: buscar scripts JS no HTML do painel
    const panelHtml = await fetch("https://app.tutory.com.br/painel/", {
      headers: {
        Cookie: sessionCookie,
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
    }).then((r) => r.text());

    const scriptUrls = extrairScriptUrls(panelHtml);

    // Passo 4: baixar e analisar os JS files
    const jsAnalise: Record<string, unknown> = {};
    for (const url of scriptUrls.slice(0, 5)) {
      try {
        const js = await fetch(url, { headers: { "User-Agent": BROWSER_UA } }).then((r) => r.text());
        jsAnalise[url] = analisarJs(js);
      } catch {
        jsAnalise[url] = "FETCH_ERROR";
      }
    }

    // Passo 5: analisar também o HTML do painel (scripts inline)
    const inlineScripts = [...panelHtml.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/gi)]
      .map((m) => m[1])
      .filter((s) => /intent|replan|selecionar/i.test(s));

    return NextResponse.json({
      primeiroAluno: { nome: primeiro.nome, id: primeiro.id },
      selecionarSemPainel: { status: notifRes.status, data: notifData },
      scriptUrls,
      jsAnalise,
      inlineScriptsComIntent: inlineScripts.map((s) => s.slice(0, 500)),
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
