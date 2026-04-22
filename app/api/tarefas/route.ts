import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const concluida = searchParams.get("concluida");

  const where: Record<string, unknown> = {};
  if (concluida === "true") where.concluida = true;
  else if (concluida === "false") where.concluida = false;

  const tarefas = await prisma.tarefa.findMany({
    where,
    include: { aluno: { select: { id: true, nome: true } }, user: { select: { name: true } } },
    orderBy: [{ concluida: "asc" }, { dataVencimento: "asc" }, { createdAt: "desc" }],
  });

  return NextResponse.json(tarefas);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const body = await req.json();
  const tarefa = await prisma.tarefa.create({
    data: {
      titulo: body.titulo,
      descricao: body.descricao ?? "",
      prioridade: body.prioridade ?? "media",
      dataVencimento: body.dataVencimento ? new Date(body.dataVencimento) : null,
      alunoId: body.alunoId || null,
      userId: (session.user?.id ?? "") as string,
    },
    include: { aluno: { select: { id: true, nome: true } }, user: { select: { name: true } } },
  });

  return NextResponse.json(tarefa, { status: 201 });
}
