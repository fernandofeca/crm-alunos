import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const contato = await prisma.contato.delete({ where: { id }, select: { alunoId: true } });

  // Recalcula ultimoContatoData após deleção
  const ultimo = await prisma.contato.findFirst({
    where: { alunoId: contato.alunoId },
    orderBy: { data: "desc" },
    select: { data: true },
  });
  await prisma.aluno.update({
    where: { id: contato.alunoId },
    data: { ultimoContatoData: ultimo?.data ?? null },
  });

  return NextResponse.json({ ok: true });
}
