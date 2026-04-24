/**
 * Replanejamento de Cronogramas
 *
 * Mecanismo confirmado pelo debug (2025-04-24):
 *   Visitar GET /painel/ com PHPSESSID do aluno (obtido via ver-painel)
 *   faz o PHP processar o replanejamento server-side na primeira visita.
 *   Na segunda visita o swal "Cronograma Replanejado" não aparece mais
 *   e o aluno some da lista /alunos/atraso automaticamente.
 *
 * Fluxo por aluno:
 *  1. POST ver-painel (cpf + id + token + adm_id) → PHPSESSID do app.tutory.com.br
 *  2. GET /painel/ com esse PHPSESSID → PHP processa o replanejamento
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

interface ReplanejamentoResult {
  nome: string;
  id: string;
  status: number | string;
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

    const sessionCookie = verRes.headers.get("set-cookie")?.match(/PHPSESSID=[^;]+/)?.[0] ?? "";
    const location = verRes.headers.get("location") ?? "/painel/";
    const panelUrl = location.startsWith("http") ? location : `https://app.tutory.com.br${location}`;

    if (!sessionCookie) {
      return { nome: aluno.nome, id: aluno.id, status: "sem-sessão" };
    }

    // 2. GET /painel/ → PHP processa o replanejamento server-side
    const panelRes = await fetch(panelUrl, {
      headers: {
        Cookie: sessionCookie,
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9",
        Referer: "https://app.tutory.com.br/intent/ver-painel",
      },
      redirect: "follow",
    });

    return { nome: aluno.nome, id: aluno.id, status: panelRes.status };
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

  // Lotes de 3 com 600ms de intervalo para não sobrecarregar o Tutory
  for (let i = 0; i < alunos.length; i += 3) {
    const lote = alunos.slice(i, i + 3);
    const resps = await Promise.all(lote.map(replanejamentoAluno));
    resultados.push(...resps);
    if (i + 3 < alunos.length) await new Promise((r) => setTimeout(r, 600));
  }

  const sucessos = resultados.filter(
    (r) => typeof r.status === "number" && r.status < 400
  ).length;

  const falhas = resultados.filter(
    (r) => typeof r.status !== "number" || r.status >= 400
  );

  return NextResponse.json({
    ok: true,
    total: alunos.length,
    replanejados: sucessos,
    falhas: falhas.length > 0 ? falhas : undefined,
    nota: "Alunos saem da lista do Tutory em poucos minutos após o processamento",
    executadoEm: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
  });
}

// GET ?key=cg-bulk-2026&debug=1  → testa o fluxo completo no 1º aluno
// GET ?key=cg-bulk-2026           → cron (background, resposta imediata)
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== "cg-bulk-2026") return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  if (req.nextUrl.searchParams.get("debug") === "1") {
    const adminCookie = await getAdminCookie();
    if (!adminCookie) return NextResponse.json({ error: "Login admin falhou" });

    const alunos = await scraparFormularios(adminCookie);
    const primeiro = alunos[0];
    if (!primeiro) return NextResponse.json({ msg: "Nenhum aluno atrasado na lista do Tutory" });

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
    const sessionCookie = verRes.headers.get("set-cookie")?.match(/PHPSESSID=[^;]+/)?.[0] ?? "";
    const location = verRes.headers.get("location") ?? "/painel/";
    const panelUrl = location.startsWith("http") ? location : `https://app.tutory.com.br${location}`;

    if (!sessionCookie) {
      return NextResponse.json({ erro: "ver-painel não retornou PHPSESSID" });
    }

    // 1ª visita
    const html1 = await fetch(panelUrl, {
      headers: { Cookie: sessionCookie, "User-Agent": BROWSER_UA, Accept: "text/html,application/xhtml+xml" },
      redirect: "follow",
    }).then((r) => r.text());
    const swal1 = html1.includes("Cronograma Replanejado");

    await new Promise((r) => setTimeout(r, 2000));

    // 2ª visita (confirma se processou)
    const html2 = await fetch(panelUrl, {
      headers: { Cookie: sessionCookie, "User-Agent": BROWSER_UA, Accept: "text/html,application/xhtml+xml", Referer: panelUrl },
      redirect: "follow",
    }).then((r) => r.text());
    const swal2 = html2.includes("Cronograma Replanejado");

    // Aluno ainda na lista admin?
    const listaHtml = await fetch("https://admin.tutory.com.br/alunos/atraso?p=1", {
      headers: { Cookie: adminCookie },
    }).then((r) => r.text());
    const nomeNaLista = listaHtml.toLowerCase().includes(primeiro.nome.toLowerCase().split(" ")[0]);

    return NextResponse.json({
      totalAtrasados: alunos.length,
      primeiroAluno: { nome: primeiro.nome, id: primeiro.id },
      visita1: { swalReplanejado: swal1 },
      visita2: { swalReplanejado: swal2 },
      alunoAindaNaLista: nomeNaLista,
      resultado: !swal2
        ? "✓ PHP processou o replan — aluno deve sair da lista em instantes"
        : "✗ PHP não processou — investigar",
    });
  }

  // Cron: dispara em background e retorna imediatamente
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
