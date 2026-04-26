import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";
import { registrarLog } from "@/lib/log";

const include = {
  aluno: { select: { id: true, nome: true } },
  user: { select: { id: true, name: true } },
  responsavel: { select: { id: true, name: true } },
  responsavel2: { select: { id: true, name: true } },
};

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();

  // Busca estado anterior para detectar mudança de concluída
  const anterior = await prisma.tarefa.findUnique({ where: { id }, select: { concluida: true, titulo: true } });

  const campos: Record<string, unknown> = {};
  if (body.titulo !== undefined) campos.titulo = body.titulo;
  if (body.descricao !== undefined) campos.descricao = body.descricao;
  if (body.concluida !== undefined) campos.concluida = body.concluida;
  if (body.prioridade !== undefined) campos.prioridade = body.prioridade;
  if (body.dataVencimento !== undefined) campos.dataVencimento = body.dataVencimento ? new Date(body.dataVencimento) : null;
  if (body.alunoId !== undefined) campos.alunoId = body.alunoId || null;
  if (body.responsavelId !== undefined) campos.responsavelId = body.responsavelId || null;
  if (body.responsavel2Id !== undefined) campos.responsavel2Id = body.responsavel2Id || null;

  const tarefa = await prisma.tarefa.update({ where: { id }, data: campos, include });

  if (body.concluida !== undefined && anterior && body.concluida !== anterior.concluida) {
    const acao = body.concluida ? "tarefa_concluida" : "tarefa_reaberta";
    const descricao = body.concluida
      ? `Concluiu a tarefa "${tarefa.titulo}"`
      : `Reabriu a tarefa "${tarefa.titulo}"`;
    await registrarLog({
      tipo: "usuario",
      acao,
      descricao,
      userId: (session.user?.id ?? null) as string | null,
      alunoId: tarefa.alunoId,
      alunoNome: tarefa.aluno?.nome,
    });
  }

  return NextResponse.json(tarefa);
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const tarefa = await prisma.tarefa.findUnique({ where: { id }, select: { titulo: true, alunoId: true } });
  await prisma.tarefa.delete({ where: { id } });

  await registrarLog({
    tipo: "usuario",
    acao: "tarefa_excluida",
    descricao: `Excluiu a tarefa "${tarefa?.titulo ?? id}"`,
    userId: (session.user?.id ?? null) as string | null,
    alunoId: tarefa?.alunoId,
  });

  return NextResponse.json({ ok: true });
}
