/**
 * Replanejamento de Cronogramas
 *
 * Fluxo por aluno:
 *  1. POST ver-painel (cpf + id + token + adm_id) → PHPSESSID do app.tutory.com.br + redirect
 *  2. GET /painel/ com PHPSESSID → HTML da página com o popup "Cronograma Replanejado"
 *  3. Extrai o ID da notificação do HTML (é diferente do tutoryId do aluno)
 *  4. POST selecionar-notificacoes com o ID da notificação → dispara o replanejamento
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

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

/**
 * Tenta extrair o ID da notificação de replanejamento do HTML do painel.
 * O ID da notificação é diferente do tutoryId do aluno — é gerado quando
 * o cronograma é replanejado e está embutido no onclick/JS da página.
 *
 * Retorna o ID encontrado, ou null se não encontrar.
 */
function extrairNotifId(html: string): string | null {
  const candidatos: string[] = [];

  // Padrão 1: selecionar(12345) em qualquer onclick/JS
  for (const m of html.matchAll(/selecionar[^(]*\(\s*['"]?(\d{4,9})['"]?\s*\)/gi)) {
    candidatos.push(m[1]);
  }

  // Padrão 2: data-id em elementos que contenham "replan" ou "cronograma" próximo
  for (const m of html.matchAll(/data-id="(\d{4,9})"/gi)) {
    const pos = html.indexOf(m[0]);
    const ctx = html.slice(Math.max(0, pos - 300), pos + 300);
    if (/replan|cronograma/i.test(ctx)) candidatos.push(m[1]);
  }

  // Padrão 3: variável JS perto de replan/cronograma
  for (const m of html.matchAll(/(?:notif|replan|cronograma)[_A-Za-z]*\s*[=:]\s*['"]?(\d{4,9})['"]?/gi)) {
    candidatos.push(m[1]);
  }

  // Padrão 4: qualquer input[name=id] dentro de um bloco com replan/cronograma
  const replanBlocks = html.match(/(?:replan|cronograma)[^<]{0,2000}/gi) ?? [];
  for (const block of replanBlocks) {
    const m = block.match(/(?:name|id)["'\s=]+['"]?(\d{4,9})['"]?/i);
    if (m) candidatos.push(m[1]);
  }

  // Padrão 5: último recurso — qualquer número de 4-9 dígitos em contexto de replan
  const replanCtx = html.match(/replan[\s\S]{0,500}?(\d{5,9})/i)?.[1];
  if (replanCtx) candidatos.push(replanCtx);

  return candidatos[0] ?? null;
}

interface ReplanejamentoResult {
  nome: string;
  id: string;
  status: number | string;
  notifId?: string;
  usouNotifId?: boolean;
  data?: unknown;
}

async function replanejamentoAluno(aluno: AlunoForm): Promise<ReplanejamentoResult> {
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

    // 2. GET painel → HTML com o popup
    let notifId: string | null = null;
    if (sessionCookie) {
      const panelRes = await fetch(panelUrl, {
        headers: {
          Cookie: sessionCookie,
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "pt-BR,pt;q=0.9",
          Referer: "https://app.tutory.com.br/intent/ver-painel",
        },
        redirect: "follow",
      });

      const updatedCookie = panelRes.headers.get("set-cookie")?.match(/PHPSESSID=[^;]+/)?.[0];
      if (updatedCookie) sessionCookie = updatedCookie;

      const html = await panelRes.text();

      // 3. Extrair ID da notificação do HTML
      notifId = extrairNotifId(html);
    }

    // 4. selecionar-notificacoes com o ID correto
    const idParaEnviar = notifId ?? aluno.id;

    const notifRes = await fetch("https://app.tutory.com.br/intent/selecionar-notificacoes", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aluno.token}`,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Accept: "*/*",
        ...(sessionCookie ? { Cookie: sessionCookie } : {}),
        Origin: "https://app.tutory.com.br",
        Referer: panelUrl,
      },
      body: `id=${idParaEnviar}`,
    });

    const notifJson = await notifRes.json().catch(() => null);
    return {
      nome: aluno.nome,
      id: aluno.id,
      status: notifRes.status,
      notifId: idParaEnviar,
      usouNotifId: notifId !== null,
      data: notifJson,
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

  const sucessos = resultados.filter((r) => typeof r.status === "number" && r.status < 400).length;
  const comNotifId = resultados.filter((r) => r.usouNotifId).length;

  return NextResponse.json({
    ok: true,
    total: alunos.length,
    replanejados: sucessos,
    comNotifIdExtraido: comNotifId,
    semNotifId: alunos.length - comNotifId,
    falhas: resultados.filter((r) => typeof r.status !== "number" || r.status >= 400),
    executadoEm: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
  });
}

// GET ?key=cg-bulk-2026&debug=1 — inspeciona HTML do painel do 1º aluno
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

    // Passo 1: ver-painel
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
    const phpsessid1 = verRes.headers.get("set-cookie")?.match(/PHPSESSID=[^;]+/)?.[0] ?? "";
    const location = verRes.headers.get("location") ?? "/painel/";
    const panelUrl = location.startsWith("http") ? location : `https://app.tutory.com.br${location}`;

    // Passo 2: GET painel
    const panelRes = await fetch(panelUrl, {
      headers: {
        Cookie: phpsessid1,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9",
        Referer: "https://app.tutory.com.br/intent/ver-painel",
      },
      redirect: "follow",
    });
    const phpsessid2 = panelRes.headers.get("set-cookie")?.match(/PHPSESSID=[^;]+/)?.[0] ?? "";
    const sessionFinal = phpsessid2 || phpsessid1;
    const html = await panelRes.text();

    // Análise do HTML
    const notifIdExtraido = extrairNotifId(html);

    // Todos os onclick handlers
    const onclicks = [...html.matchAll(/onclick="([^"]{0,200})"/gi)].map((m) => m[1]);

    // Contexto ao redor de "replan" e "cronograma"
    const replanContextos: string[] = [];
    const regex = /(?:replan|cronograma)/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
      const start = Math.max(0, match.index - 100);
      const end = Math.min(html.length, match.index + 300);
      replanContextos.push(html.slice(start, end));
      if (replanContextos.length >= 5) break;
    }

    // Todos os intent/ endpoints
    const intents = [...new Set([...html.matchAll(/intent\/[\w-]+/gi)].map((m) => m[0]))];

    // Passo 3: chamar selecionar-notificacoes com o ID extraído (se encontrado)
    let notifResult: unknown = null;
    if (notifIdExtraido) {
      const notifRes = await fetch("https://app.tutory.com.br/intent/selecionar-notificacoes", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${primeiro.token}`,
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          Cookie: sessionFinal,
          Origin: "https://app.tutory.com.br",
          Referer: panelUrl,
        },
        body: `id=${notifIdExtraido}`,
      });
      notifResult = await notifRes.json().catch(() => null);
    }

    return NextResponse.json({
      primeiroAluno: { nome: primeiro.nome, id: primeiro.id, tutoryId: primeiro.id },
      verPainel: { status: verRes.status, phpsessidObtido: !!phpsessid1, location, panelUrl },
      panelPage: { status: panelRes.status, cookieAtualizado: !!phpsessid2, htmlSize: html.length },
      notifIdExtraido,
      onclicks: onclicks.slice(0, 20),
      replanContextos,
      intents,
      notifResult,
      htmlInicio: html.slice(0, 800),
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
