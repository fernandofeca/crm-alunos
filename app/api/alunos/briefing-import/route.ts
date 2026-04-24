import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";

type BriefingRow = {
  nome: string;
  email: string;
  dataNascimento: string | null;
  cidade: string;
  estado: string;
  endereco: string;
  bio: string;
};

function normalizar(s: string) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export async function POST(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== "cg-bulk-2026") {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const rows: BriefingRow[] = await req.json();
  if (!Array.isArray(rows)) return NextResponse.json({ error: "Body deve ser array" }, { status: 400 });

  let atualizados = 0;
  let ignorados = 0;
  const erros: string[] = [];

  // Build name lookup for all students (for fallback matching)
  const todosAlunos = await prisma.aluno.findMany({ select: { id: true, nome: true, email: true } });
  const nomeMap = new Map<string, string>(); // normalized name → id
  for (const a of todosAlunos) {
    const n = normalizar(a.nome);
    if (!nomeMap.has(n)) nomeMap.set(n, a.id);
  }

  for (const row of rows) {
    try {
      const emailLower = row.email?.toLowerCase().trim() ?? "";
      const nomeNorm = normalizar(row.nome ?? "");

      // 1. Match by email first
      let alunoId: string | null = null;
      if (emailLower) {
        const a = await prisma.aluno.findUnique({ where: { email: emailLower }, select: { id: true } });
        if (a) alunoId = a.id;
      }

      // 2. Fallback: match by normalized name
      if (!alunoId && nomeNorm) {
        alunoId = nomeMap.get(nomeNorm) ?? null;
      }

      // 3. No match → skip
      if (!alunoId) {
        ignorados++;
        continue;
      }

      const dataNasc = row.dataNascimento ? new Date(row.dataNascimento) : null;
      const dataValida = dataNasc && !isNaN(dataNasc.getTime()) ? dataNasc : null;

      await prisma.aluno.update({
        where: { id: alunoId },
        data: {
          ...(dataValida ? { dataNascimento: dataValida } : {}),
          ...(row.cidade ? { cidade: row.cidade.trim() } : {}),
          ...(row.estado ? { estado: row.estado.trim() } : {}),
          ...(row.endereco ? { endereco: row.endereco.trim() } : {}),
          ...(row.bio ? { bio: row.bio.trim() } : {}),
        },
      });
      atualizados++;
    } catch (e) {
      erros.push(`${row.nome}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return NextResponse.json({ atualizados, ignorados, erros, total: rows.length });
}
