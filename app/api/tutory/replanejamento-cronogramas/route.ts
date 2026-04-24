/**
 * Replanejamento de Cronogramas
 *
 * Para cada aluno atrasado:
 *  1. Scrapa id, cpf, token, adm_id do formulário em /alunos/atraso
 *  2. POST ver-painel → obtém PHPSESSID do app.tutory.com.br
 *  3. POST selecionar-notificacoes com esse PHPSESSID → dispara o replanejamento
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

async function getAdminCookie(): Promise<string> {
  const account = process.env.TUTORY_ACCOUNT ?? "";
  const password = process.env.TUTORY_PASSWORD ?? "";
  if (!account || !password) return "";
  const res = await fetch("https://admin.tutory.com.br/intent/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest" },
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

  async function parsePage(html: string) {
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
  }).then(r => r.text());

  if (firstHtml.includes('document.location.href = "/login"')) return [];
  await parsePage(firstHtml);

  const totalPagesMatch = firstHtml.match(/\?p=(\d+)[^"]*">Última/);
  const totalPages = totalPagesMatch ? parseInt(totalPagesMatch[1], 10) : 1;

  for (let start = 2; start <= totalPages; start += 5) {
    const batch = [];
    for (let p = start; p < start + 5 && p <= totalPages; p++) {
      batch.push(
        fetch(`https://admin.tutory.com.br/alunos/atraso?p=${p}`, { headers: { Cookie: adminCookie } })
          .then(r => r.text())
          .then(parsePage)
      );
    }
    await Promise.all(batch);
  }

  return result;
}

async function replanejamentoAluno(aluno: AlunoForm): Promise<{ nome: string; id: string; status: number | string; data?: unknown }> {
  try {
    // 1. ver-painel → obtém PHPSESSID + Location do redirect
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

    const appPhpsessid = verRes.headers.get("set-cookie")?.match(/PHPSESSID=[^;]+/)?.[0] ?? "";
    const location = verRes.headers.get("location") ?? "https://app.tutory.com.br/painel/";

    // 2. Seguir o redirect — carrega a página do painel, que cria a notificação server-side
    if (appPhpsessid) {
      await fetch(location.startsWith("http") ? location : `https://app.tutory.com.br${location}`, {
        method: "GET",
        headers: {
          Cookie: appPhpsessid,
          Accept: "text/html,application/xhtml+xml",
          Referer: "https://app.tutory.com.br/intent/ver-painel",
        },
      });
    }

    // 3. selecionar-notificacoes — processa a notificação de replanejamento criada
    const notifRes = await fetch("https://app.tutory.com.br/intent/selecionar-notificacoes", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${aluno.token}`,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Accept: "*/*",
        ...(appPhpsessid ? { Cookie: appPhpsessid } : {}),
        Origin: "https://app.tutory.com.br",
        Referer: "https://app.tutory.com.br/painel/",
      },
      body: `id=${aluno.id}`,
    });

    const notifJson = await notifRes.json().catch(() => null);
    return { nome: aluno.nome, id: aluno.id, status: notifRes.status, data: notifJson };
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

  const resultados: { nome: string; id: string; status: number | string }[] = [];

  for (let i = 0; i < alunos.length; i += 3) {
    const lote = alunos.slice(i, i + 3);
    const resps = await Promise.all(lote.map(replanejamentoAluno));
    resultados.push(...resps);
    if (i + 3 < alunos.length) await new Promise(r => setTimeout(r, 300));
  }

  const sucessos = resultados.filter(r => typeof r.status === "number" && r.status < 400).length;

  return NextResponse.json({
    ok: true,
    total: alunos.length,
    replanejados: sucessos,
    falhas: resultados.filter(r => typeof r.status !== "number" || r.status >= 400),
    executadoEm: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
  });
}

// GET ?key=cg-bulk-2026&debug=1 — testa com o primeiro aluno e mostra detalhes
// GET ?key=cg-bulk-2026 — cron (background)
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== "cg-bulk-2026") return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  if (req.nextUrl.searchParams.get("debug") === "1") {
    const adminCookie = await getAdminCookie();
    if (!adminCookie) return NextResponse.json({ error: "Login admin falhou" });

    const alunos = await scraparFormularios(adminCookie);
    const primeiro = alunos[0];
    if (!primeiro) return NextResponse.json({ error: "Nenhum aluno na lista" });

    const resultado = await replanejamentoAluno(primeiro);

    return NextResponse.json({
      totalAlunos: alunos.length,
      primeiroAluno: { nome: primeiro.nome, id: primeiro.id, cpf: primeiro.cpf.slice(0, 3) + "****" },
      resultado,
    });
  }

  executarReplanejamento().catch(e => console.error("[replanejamento-bg]", e));
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
