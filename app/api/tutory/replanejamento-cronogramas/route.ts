/**
 * Replanejamento de Cronogramas
 *
 * Fluxo descoberto pela análise do tutory-dashboard-notificacoes.js:
 *  1. ver-painel → PHPSESSID do app.tutory.com.br
 *  2. GET /painel/ → extrair jsAluno.id do HTML inline
 *  3. POST selecionar-notificacoes {id: jsAluno.id} → lista de notificações pendentes
 *  4. Para cada notificação: POST excluir-notificacao {id: jsAluno.id, notificacao_id: notif.id}
 *     → deleta a notificação e remove o aluno da lista de atrasos
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

/** Extrai jsAluno.id do HTML do painel (variável gerada pelo PHP) */
function extrairJsAlunoId(html: string): string | null {
  // Padrão principal: var jsAluno = { id: 12345, ... }
  const match =
    html.match(/jsAluno\s*=\s*\{[^}]*?id\s*:\s*(\d+)/i) ??
    html.match(/jsAluno\.id\s*=\s*(\d+)/i) ??
    html.match(/"jsAluno"[^}]*"id"\s*:\s*(\d+)/i);
  return match?.[1] ?? null;
}

interface NotifEntry { id: number | string }

interface ReplanejamentoResult {
  nome: string;
  id: string;
  jsAlunoId: string | null;
  status: string;
  notificacoes?: NotifEntry[];
  excluidos?: (number | string)[];
  erros?: string[];
}

async function replanejamentoAluno(aluno: AlunoForm): Promise<ReplanejamentoResult> {
  const erros: string[] = [];

  try {
    // 1. ver-painel → PHPSESSID
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

    let sessionCookie = verRes.headers.get("set-cookie")?.match(/PHPSESSID=[^;]+/)?.[0] ?? "";
    const location = verRes.headers.get("location") ?? "/painel/";
    const panelUrl = location.startsWith("http") ? location : `https://app.tutory.com.br${location}`;

    if (!sessionCookie) {
      return { nome: aluno.nome, id: aluno.id, jsAlunoId: null, status: "sem-sessão" };
    }

    // 2. GET /painel/ → extrair jsAluno.id
    const panelRes = await fetch(panelUrl, {
      headers: {
        Cookie: sessionCookie,
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml",
        Referer: "https://app.tutory.com.br/intent/ver-painel",
      },
      redirect: "follow",
    });
    const updatedCookie = panelRes.headers.get("set-cookie")?.match(/PHPSESSID=[^;]+/)?.[0];
    if (updatedCookie) sessionCookie = updatedCookie;

    const panelHtml = await panelRes.text();
    const jsAlunoId = extrairJsAlunoId(panelHtml) ?? aluno.id;

    const headers = {
      Authorization: `Bearer ${aluno.token}`,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Accept: "application/json, */*",
      "X-Requested-With": "XMLHttpRequest",
      Cookie: sessionCookie,
      Origin: "https://app.tutory.com.br",
      Referer: panelUrl,
    };

    // 3. selecionar-notificacoes com jsAluno.id → lista de notificações
    const selecionarRes = await fetch("https://app.tutory.com.br/intent/selecionar-notificacoes", {
      method: "POST",
      headers,
      body: `id=${jsAlunoId}`,
    });
    const selecionarData = await selecionarRes.json().catch(() => null) as {
      data?: NotifEntry[];
      result?: boolean;
    } | null;

    const notificacoes: NotifEntry[] = Array.isArray(selecionarData?.data) ? selecionarData!.data : [];

    // 4. excluir-notificacao para cada notificação encontrada
    const excluidos: (number | string)[] = [];
    for (const notif of notificacoes) {
      const excluirRes = await fetch("https://app.tutory.com.br/intent/excluir-notificacao", {
        method: "POST",
        headers,
        body: `id=${jsAlunoId}&notificacao_id=${notif.id}`,
      });
      const excluirData = await excluirRes.json().catch(() => null);
      if (excluirRes.ok) {
        excluidos.push(notif.id);
      } else {
        erros.push(`excluir-notificacao ${notif.id}: ${JSON.stringify(excluirData)}`);
      }
    }

    // 4b. Se não havia notificações via selecionar, tentar /painel/config/replanejar-atrasos como fallback
    if (notificacoes.length === 0) {
      await fetch("https://app.tutory.com.br/painel/config/replanejar-atrasos", {
        method: "GET",
        headers: {
          Cookie: sessionCookie,
          "User-Agent": BROWSER_UA,
          Accept: "text/html,application/xhtml+xml",
          Referer: panelUrl,
        },
        redirect: "follow",
      });
    }

    return {
      nome: aluno.nome,
      id: aluno.id,
      jsAlunoId,
      status: notificacoes.length > 0 ? "notif-excluida" : "fallback-visitou",
      notificacoes,
      excluidos,
      erros,
    };
  } catch (e) {
    return { nome: aluno.nome, id: aluno.id, jsAlunoId: null, status: String(e), erros };
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

  const comNotif  = resultados.filter((r) => r.status === "notif-excluida").length;
  const fallback  = resultados.filter((r) => r.status === "fallback-visitou").length;
  const falhas    = resultados.filter((r) => r.status !== "notif-excluida" && r.status !== "fallback-visitou");

  return NextResponse.json({
    ok: true,
    total: alunos.length,
    notificacoesExcluidas: comNotif,
    fallback,
    falhas,
    executadoEm: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
  });
}

// GET ?key=cg-bulk-2026&debug=1  → debug completo para o 1º aluno
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

    // ver-painel → sessão
    const verRes = await fetch("https://app.tutory.com.br/intent/ver-painel", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
        Origin: "https://app.tutory.com.br",
        Referer: "https://admin.tutory.com.br/alunos/atraso",
      },
      body: `cpf=${encodeURIComponent(primeiro.cpf)}&id=${primeiro.id}&token=${encodeURIComponent(primeiro.token)}&adm_id=${primeiro.admId}`,
      redirect: "manual",
    });
    let sessionCookie = verRes.headers.get("set-cookie")?.match(/PHPSESSID=[^;]+/)?.[0] ?? "";
    const location = verRes.headers.get("location") ?? "/painel/";
    const panelUrl = location.startsWith("http") ? location : `https://app.tutory.com.br${location}`;

    // GET painel
    const panelRes = await fetch(panelUrl, {
      headers: { Cookie: sessionCookie, "User-Agent": BROWSER_UA, Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
    });
    const updated = panelRes.headers.get("set-cookie")?.match(/PHPSESSID=[^;]+/)?.[0];
    if (updated) sessionCookie = updated;
    const panelHtml = await panelRes.text();

    // Encontrar jsAluno no HTML
    const jsAlunoId = extrairJsAlunoId(panelHtml);
    const jsAlunoContexto = (() => {
      const idx = panelHtml.toLowerCase().indexOf("jsaluno");
      if (idx < 0) return null;
      return panelHtml.slice(Math.max(0, idx - 10), idx + 400);
    })();

    const headers = {
      Authorization: `Bearer ${primeiro.token}`,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Accept: "application/json, */*",
      "X-Requested-With": "XMLHttpRequest",
      Cookie: sessionCookie,
      Origin: "https://app.tutory.com.br",
      Referer: panelUrl,
    };

    // selecionar-notificacoes com jsAluno.id extraído
    const selecionarId = jsAlunoId ?? primeiro.id;
    const selecionarRes = await fetch("https://app.tutory.com.br/intent/selecionar-notificacoes", {
      method: "POST",
      headers,
      body: `id=${selecionarId}`,
    });
    const selecionarData = await selecionarRes.json().catch(() => "PARSE_ERROR");

    // Se houver notificações, tentar excluir a primeira
    let excluirResult: unknown = null;
    const notifs = Array.isArray((selecionarData as { data?: NotifEntry[] })?.data)
      ? (selecionarData as { data: NotifEntry[] }).data
      : [];

    if (notifs.length > 0) {
      const excluirRes = await fetch("https://app.tutory.com.br/intent/excluir-notificacao", {
        method: "POST",
        headers,
        body: `id=${selecionarId}&notificacao_id=${notifs[0].id}`,
      });
      excluirResult = await excluirRes.json().catch(() => null);
    }

    return NextResponse.json({
      primeiroAluno: { nome: primeiro.nome, idAdmin: primeiro.id },
      jsAlunoIdExtraido: jsAlunoId,
      jsAlunoContexto,
      selecionarNotificacoes: {
        idUsado: selecionarId,
        status: selecionarRes.status,
        data: selecionarData,
      },
      excluirNotificacao: notifs.length > 0 ? { tentou: notifs[0].id, result: excluirResult } : "nenhuma-notif-para-excluir",
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
