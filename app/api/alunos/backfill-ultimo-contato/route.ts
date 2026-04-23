import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== "cg-bulk-2026") return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const alunos = await prisma.aluno.findMany({
    where: { contatos: { some: {} } },
    select: { id: true, contatos: { orderBy: { data: "desc" }, take: 1, select: { data: true } } },
  });

  let atualizados = 0;
  for (const aluno of alunos) {
    if (aluno.contatos[0]) {
      await prisma.aluno.update({
        where: { id: aluno.id },
        data: { ultimoContatoData: aluno.contatos[0].data },
      });
      atualizados++;
    }
  }

  return NextResponse.json({ atualizados });
}
