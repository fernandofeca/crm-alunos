import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";

const include = {
  aluno: { select: { id: true, nome: true } },
  user: { select: { id: true, name: true } },
  responsavel: { select: { id: true, name: true } },
};

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();

  const campos: Record<string, unknown> = {};
  if (body.titulo !== undefined) campos.titulo = body.titulo;
  if (body.descricao !== undefined) campos.descricao = body.descricao;
  if (body.concluida !== undefined) campos.concluida = body.concluida;
  if (body.prioridade !== undefined) campos.prioridade = body.prioridade;
  if (body.dataVencimento !== undefined) campos.dataVencimento = body.dataVencimento ? new Date(body.dataVencimento) : null;
  if (body.alunoId !== undefined) campos.alunoId = body.alunoId || null;
  if (body.responsavelId !== undefined) campos.responsavelId = body.responsavelId || null;

  const tarefa = await prisma.tarefa.update({ where: { id }, data: campos, include });
  return NextResponse.json(tarefa);
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  await prisma.tarefa.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
