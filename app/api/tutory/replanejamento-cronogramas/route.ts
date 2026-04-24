/**
 * Replanejamento de Cronogramas
 *
 * Teste decisivo: visitar /painel/ duas vezes.
 * - Se swal desaparece na 2ª visita → o PHP processa o replan na 1ª visita (automação funciona)
 * - Se swal ainda aparece na 2ª visita → o PHP não processa na visita do servidor, precisamos de outra abordagem
 *
 * Outros achados dos debugs anteriores:
 * - admin:0 não é possível via ver-painel (sempre admin:1)
 * - excluir-notificacao funciona com NOT_ID mas só remove notifs de mural
 * - o swal "Cronograma Replanejado" é um mecanismo separado do sistema de notificações
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

function extrairJsAlunoId(html: string): string | null {
  return (
    html.match(/jsAluno\s*=\s*\{[^}]*?\bid\s*:\s*['"]?(\d+)['"]?/i)?.[1] ??
    html.match(/jsAluno\.id\s*=\s*['"]?(\d+)['"]?/i)?.[1] ??
    null
  );
}

interface NotifEntry {
  NOT_ID?: string | number;
  [key: string]: unknown;
}

interface ReplanejamentoResult {
  nome: string;
  id: string;
  status: string;
  notificacoes?: NotifEntry[];
  excluidos?: (string | number)[];
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

    if (!sessionCookie) return { nome: aluno.nome, id: aluno.id, status: "sem-sessão" };

    // 2. Visitar /painel/ (1ª visita — PHP gera o swal e pode processar o replan)
    const painel1 = await fetch(panelUrl, {
      headers: {
        Cookie: sessionCookie,
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml",
        Referer: "https://app.tutory.com.br/intent/ver-painel",
      },
      redirect: "follow",
    });
    const updated1 = painel1.headers.get("set-cookie")?.match(/PHPSESSID=[^;]+/)?.[0];
    if (updated1) sessionCookie = updated1;
    const html1 = await painel1.text();

    const jsAlunoId = extrairJsAlunoId(html1) ?? aluno.id;

    const headers = {
      Authorization: `Bearer ${aluno.token}`,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Accept: "application/json, */*",
      "X-Requested-With": "XMLHttpRequest",
      Cookie: sessionCookie,
      Origin: "https://app.tutory.com.br",
      Referer: panelUrl,
    };

    // 3. selecionar-notificacoes → lista com NOT_ID
    const selecionarRes = await fetch("https://app.tutory.com.br/intent/selecionar-notificacoes", {
      method: "POST",
      headers,
      body: `id=${jsAlunoId}`,
    });
    const selecionarData = await selecionarRes.json().catch(() => null) as { data?: NotifEntry[] } | null;
    const notificacoes: NotifEntry[] = Array.isArray(selecionarData?.data) ? selecionarData!.data : [];

    // 4. excluir cada notificação pelo NOT_ID
    const excluidos: (string | number)[] = [];
    for (const notif of notificacoes) {
      const notifId = notif.NOT_ID;
      if (!notifId) continue;
      const excluirRes = await fetch("https://app.tutory.com.br/intent/excluir-notificacao", {
        method: "POST",
        headers,
        body: `id=${jsAlunoId}&notificacao_id=${notifId}`,
      });
      if (excluirRes.ok) excluidos.push(notifId);
    }

    // 5. Visitar /painel/config/replanejar-atrasos (confirma o replanejamento)
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

    return {
      nome: aluno.nome,
      id: aluno.id,
      status: "ok",
      notificacoes,
      excluidos,
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
    if (i + 3 < alunos.length) await new Promise((r) => setTimeout(r, 600));
  }

  const falhas = resultados.filter((r) => r.status !== "ok");

  return NextResponse.json({
    ok: true,
    total: alunos.length,
    replanejados: resultados.length - falhas.length,
    falhas,
    executadoEm: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
  });
}

// GET ?key=cg-bulk-2026&debug=1  → teste decisivo: swal na 2ª visita ao painel?
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

    const panelHeaders = {
      Cookie: sessionCookie,
      "User-Agent": BROWSER_UA,
      Accept: "text/html,application/xhtml+xml",
      Referer: "https://app.tutory.com.br/intent/ver-painel",
    };

    // ── 1ª visita ao painel ──
    const painel1Res = await fetch(panelUrl, { headers: panelHeaders, redirect: "follow" });
    const updated1 = painel1Res.headers.get("set-cookie")?.match(/PHPSESSID=[^;]+/)?.[0];
    if (updated1) sessionCookie = updated1;
    const html1 = await painel1Res.text();
    const swal1 = html1.includes("Cronograma Replanejado");

    // Aguardar 2 segundos antes da 2ª visita
    await new Promise((r) => setTimeout(r, 2000));

    // ── 2ª visita ao painel (mesma sessão) ──
    const painel2Res = await fetch(panelUrl, {
      headers: { ...panelHeaders, Cookie: sessionCookie, Referer: panelUrl },
      redirect: "follow",
    });
    const html2 = await painel2Res.text();
    const swal2 = html2.includes("Cronograma Replanejado");

    // ── Verificar admin list: o aluno ainda está em /alunos/atraso? ──
    const listaHtml = await fetch("https://admin.tutory.com.br/alunos/atraso?p=1", {
      headers: { Cookie: adminCookie },
    }).then((r) => r.text());
    const nomeNaLista = listaHtml.toLowerCase().includes(primeiro.nome.toLowerCase().split(" ")[0]);

    // ── Tela de /painel/config/replanejar-atrasos ──
    const replanHtml = await fetch("https://app.tutory.com.br/painel/config/replanejar-atrasos", {
      headers: { Cookie: sessionCookie, "User-Agent": BROWSER_UA, Accept: "text/html,application/xhtml+xml", Referer: panelUrl },
      redirect: "follow",
    }).then((r) => r.text());
    const swalReplan = replanHtml.includes("Cronograma Replanejado");

    return NextResponse.json({
      primeiroAluno: { nome: primeiro.nome, id: primeiro.id },
      painel1: { swalAparece: swal1 },
      painel2: { swalAparece: swal2, interpretacao: swal2 ? "PHP NÃO processou o replan na 1ª visita" : "PHP processou o replan na 1ª visita! ✓" },
      replanejArAtrasos: { swalAparece: swalReplan },
      adminList: { nomeAindaNaLista: nomeNaLista },
      conclusao: swal2
        ? "Visitação do servidor NÃO dispara o replan — precisamos de outro mecanismo"
        : "Visitação dispara o replan — automação funciona, usuário deve verificar após alguns minutos",
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
