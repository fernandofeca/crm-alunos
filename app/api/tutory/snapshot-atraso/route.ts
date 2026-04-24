import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";

async function getSessionCookie(): Promise<string> {
  const account = process.env.TUTORY_ACCOUNT ?? "";
  const password = process.env.TUTORY_PASSWORD ?? "";
  if (!account || !password) return "";
  const res = await fetch("https://admin.tutory.com.br/intent/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest" },
    body: `account=${encodeURIComponent(account)}&password=${encodeURIComponent(password)}`,
  });
  return res.headers.get("set-cookie")?.match(/PHPSESSID=[^;]+/)?.[0] ?? "";
}

async function scrapeAtrasados(cookie: string): Promise<{ nome: string; email: string; diasAtraso: number }[]> {
  const result: { nome: string; email: string; diasAtraso: number }[] = [];

  async function parsePage(html: string) {
    const stripTags = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
    const blocks = html.split('class="student-list-item"');
    for (const block of blocks.slice(1)) {
      const searchMatch = block.match(/data-search="([^"]+)"/);
      if (!searchMatch) continue;
      const parts = searchMatch[1].trim().split(" ");
      const email = parts[parts.length - 1].toLowerCase();
      const nome = parts.slice(0, -1).join(" ").trim();
      const texto = stripTags(block);
      const atrasoMatch =
        texto.match(/(\d+)\s+dias?\s+de\s+atraso/i) ??
        texto.match(/atraso[:\s]+(\d+)\s+dias?/i) ??
        texto.match(/(\d+)\s+dias?/i);
      if (!atrasoMatch) continue;
      const dias = parseInt(atrasoMatch[1], 10);
      if (email && dias > 0) result.push({ nome, email, diasAtraso: dias });
    }
  }

  const firstHtml = await fetch("https://admin.tutory.com.br/alunos/atraso?p=1", {
    headers: { Cookie: cookie },
  }).then((r) => r.text());

  if (firstHtml.includes('document.location.href = "/login"')) return [];
  await parsePage(firstHtml);

  const totalPagesMatch = firstHtml.match(/\?p=(\d+)[^"]*">Última/);
  const totalPages = totalPagesMatch ? parseInt(totalPagesMatch[1], 10) : 1;

  for (let start = 2; start <= totalPages; start += 5) {
    const batch = [];
    for (let p = start; p < start + 5 && p <= totalPages; p++) {
      batch.push(
        fetch(`https://admin.tutory.com.br/alunos/atraso?p=${p}`, { headers: { Cookie: cookie } })
          .then((r) => r.text())
          .then(parsePage)
      );
    }
    await Promise.all(batch);
  }

  return result;
}

function sextaAtual(): Date {
  // Retorna a sexta-feira da semana atual (horário São Paulo)
  const sp = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const [ano, mes, dia] = sp.split("-").map(Number);
  const hoje = new Date(Date.UTC(ano, mes - 1, dia));
  const dow = hoje.getUTCDay();
  const diasAteSexta = (5 - dow + 7) % 7;
  // Se hoje é sexta (dow===5) usa hoje; senão vai para a próxima
  const sexta = new Date(hoje);
  if (dow !== 5) sexta.setUTCDate(hoje.getUTCDate() + diasAteSexta);
  return sexta;
}

async function executarSnapshot() {
  try {
    const cookie = await getSessionCookie();
    if (!cookie) return NextResponse.json({ error: "Sem credenciais Tutory" }, { status: 500 });

    const atrasados = await scrapeAtrasados(cookie);
    if (atrasados.length === 0) {
      return NextResponse.json({ ok: true, salvos: 0, semana: sextaAtual(), msg: "Nenhum aluno atrasado encontrado" });
    }

    const semana = sextaAtual();
    let salvos = 0;

    // Build email → alunoId map from CRM
    const emails = atrasados.map((a) => a.email);
    const alunosDb = await prisma.aluno.findMany({
      where: { email: { in: emails } },
      select: { id: true, email: true, nome: true },
    });
    const dbMap = new Map(alunosDb.map((a) => [a.email, a]));

    for (const { nome, email, diasAtraso } of atrasados) {
      const db = dbMap.get(email);
      await prisma.snapshotAtraso.upsert({
        where: { semana_email: { semana, email } },
        create: {
          semana,
          email,
          nome: db?.nome ?? nome,
          diasAtraso,
          ...(db ? { alunoId: db.id } : {}),
        },
        update: { diasAtraso, nome: db?.nome ?? nome },
      });
      salvos++;
    }

    return NextResponse.json({
      ok: true,
      salvos,
      semana,
      executadoEm: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

// Cron: GET ?key=cg-bulk-2026 — responde imediatamente
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== "cg-bulk-2026") return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  executarSnapshot().catch((e) => console.error("[snapshot-atraso-bg]", e));
  return NextResponse.json({
    ok: true,
    message: "Snapshot iniciado em background",
    timestamp: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
  });
}

// Manual: POST autenticado (aguarda resultado)
export async function POST(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== "cg-bulk-2026") {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  return executarSnapshot();
}
