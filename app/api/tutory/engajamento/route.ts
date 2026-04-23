import { prisma } from "@/lib/prisma";
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

function parseHoras(texto: string): number {
  // "14h 30min" | "14h30m" | "14:30" | "14h" | "14.5"
  const hMin = texto.match(/(\d+)\s*h\s*(\d+)/);
  if (hMin) return parseInt(hMin[1]) + parseInt(hMin[2]) / 60;
  const hSo = texto.match(/(\d+)\s*h/);
  if (hSo) return parseInt(hSo[1]);
  const hmm = texto.match(/(\d+):(\d+)/);
  if (hmm) return parseInt(hmm[1]) + parseInt(hmm[2]) / 60;
  const num = parseFloat(texto.replace(",", "."));
  return isNaN(num) ? 0 : num;
}

function proximaSexta(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  // day 5 = friday
  const dow = d.getUTCDay();
  if (dow === 5) return d;
  const diff = (5 - dow + 7) % 7 || 7;
  d.setUTCDate(d.getUTCDate() - ((dow - 5 + 7) % 7));
  void diff;
  return d;
}

function sexta(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  const dow = d.getUTCDay();
  // retorna a sexta mais recente (incluindo hoje se for sexta)
  const diasAtras = (dow - 5 + 7) % 7;
  d.setUTCDate(d.getUTCDate() - diasAtras);
  return d;
}

async function scrapeEngajamento(cookie: string): Promise<{ email: string; horas: number }[]> {
  const resultado: { email: string; horas: number }[] = [];

  let pagina = 1;
  while (true) {
    const url = `https://admin.tutory.com.br/alunos/engajamento?p=${pagina}&m=100&t=7`;
    const html = await fetch(url, { headers: { Cookie: cookie } }).then((r) => r.text());

    if (html.includes('document.location.href = "/login"')) break;

    // Parse rows — try both table rows and list items
    let encontrou = false;

    // Strip HTML tags to avoid matching IDs/classes inside attributes (e.g. id="student-201310h")
    const stripTags = (s: string) => s.replace(/<[^>]*>/g, " ");
    const horasRegex = /\b(\d+[,.]\d+\s*h|\d+\s*h\s*(?:\d+\s*(?:min|m)?)?|\d+:\d+)\b/i;

    // Pattern 1: tabela com mailto e célula de horas
    const rowsTable = html.split(/<tr[^>]*>/i).slice(1);
    for (const row of rowsTable) {
      const emailMatch = row.match(/href=['"]mailto:([^'"]+)['"]/i);
      if (!emailMatch) continue;
      const rowText = stripTags(row);
      const horasMatch = rowText.match(horasRegex);
      if (!horasMatch) continue;
      const horas = parseHoras(horasMatch[1]);
      // Sanity check: no one studies more than 100h/week
      if (horas > 0 && horas <= 100) {
        resultado.push({ email: emailMatch[1].toLowerCase().trim(), horas });
        encontrou = true;
      }
    }

    // Pattern 2: lista com data-search
    if (!encontrou) {
      const blocks = html.split('class="student-list-item"');
      for (const block of blocks.slice(1)) {
        const searchMatch = block.match(/data-search="([^"]+)"/);
        if (!searchMatch) continue;
        const parts = searchMatch[1].trim().split(" ");
        const email = parts[parts.length - 1].toLowerCase();
        const blockText = stripTags(block);
        const horasMatch = blockText.match(horasRegex);
        if (!horasMatch) continue;
        const horas = parseHoras(horasMatch[1]);
        if (horas > 0 && horas <= 100) {
          resultado.push({ email, horas });
          encontrou = true;
        }
      }
    }

    // Se não encontrou nada nessa página, para
    if (!encontrou && pagina > 1) break;

    // Verifica se há próxima página
    if (!html.includes(`p=${pagina + 1}`) && !html.includes("Próxima") && !html.includes("proxima") && !html.includes("&gt;&gt;")) break;
    pagina++;
    if (pagina > 50) break;
  }

  return resultado;
}

// POST: chamada manual autenticada
// GET com ?key=cg-bulk-2026: chamada pelo cron do Railway
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== "cg-bulk-2026") return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  return processar(req.nextUrl.searchParams.get("dry") === "true");
}

export async function POST(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== "cg-bulk-2026") return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  return processar(body.dry === true);
}

async function processar(dry = false) {
  try {
    const cookie = await getSessionCookie();
    if (!cookie) return NextResponse.json({ error: "Sem credenciais Tutory" }, { status: 500 });

    const engajados = await scrapeEngajamento(cookie);
    const qualificados = engajados.filter((e) => e.horas >= 14);
    const semanaRef = sexta();

    if (dry) {
      return NextResponse.json({ total: engajados.length, qualificados: qualificados.length, semana: semanaRef, amostra: qualificados.slice(0, 5) });
    }

    let conquistados = 0;
    let naoEncontrados = 0;

    for (const { email, horas } of qualificados) {
      const aluno = await prisma.aluno.findUnique({ where: { email }, select: { id: true } });
      if (!aluno) { naoEncontrados++; continue; }

      await prisma.conquista.upsert({
        where: { alunoId_tipo_semana: { alunoId: aluno.id, tipo: "engajamento_semanal", semana: semanaRef } },
        create: { alunoId: aluno.id, tipo: "engajamento_semanal", semana: semanaRef, horas },
        update: { horas },
      });
      conquistados++;
    }

    return NextResponse.json({ total: engajados.length, qualificados: qualificados.length, conquistados, naoEncontrados, semana: semanaRef });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
