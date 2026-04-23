import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const pairs: { email: string; tutoryId: number }[] = await req.json();

  let atualizados = 0;
  let naoEncontrados = 0;
  const semMatch: string[] = [];

  for (const { email, tutoryId } of pairs) {
    const aluno = await prisma.aluno.findUnique({ where: { email } });
    if (aluno) {
      await prisma.aluno.update({ where: { email }, data: { tutoryId } });
      atualizados++;
    } else {
      semMatch.push(email);
      naoEncontrados++;
    }
  }

  return NextResponse.json({ atualizados, naoEncontrados, semMatch });
}
