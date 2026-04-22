import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();

  const campos: Record<string, unknown> = {};
  if (body.titulo !== undefined) campos.titulo = body.titulo;
  if (body.descricao !== undefined) campos.descricao = body.descricao;
  if (body.data !== undefined) campos.data = new Date(body.data);
  if (body.tipo !== undefined) campos.tipo = body.tipo;
  if (body.alunoId !== undefined) campos.alunoId = body.alunoId || null;

  const evento = await prisma.evento.update({
    where: { id },
    data: campos,
    include: { aluno: { select: { id: true, nome: true } }, user: { select: { name: true } } },
  });

  return NextResponse.json(evento);
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  await prisma.evento.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
