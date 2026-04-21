import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const aluno = await prisma.aluno.findUnique({
    where: { id },
    include: {
      disciplinas: { include: { assuntos: true } },
      contatos: { include: { user: true }, orderBy: { data: "desc" } },
    },
  });

  if (!aluno) return NextResponse.json({ error: "Aluno não encontrado" }, { status: 404 });
  return NextResponse.json(aluno);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();

  const aluno = await prisma.aluno.update({
    where: { id },
    data: {
      nome: body.nome,
      email: body.email,
      whatsapp: body.whatsapp,
      mediaGeral: body.mediaGeral,
      estudouUltimos7d: body.estudouUltimos7d,
    },
    include: {
      disciplinas: { include: { assuntos: true } },
      contatos: { include: { user: true }, orderBy: { data: "desc" } },
    },
  });

  return NextResponse.json(aluno);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();

  const campos: Record<string, unknown> = {};
  if (body.mediaGeral !== undefined) campos.mediaGeral = body.mediaGeral;
  if (body.discMaisBaixaNome !== undefined) campos.discMaisBaixaNome = body.discMaisBaixaNome;
  if (body.discMaisBaixaNota !== undefined) campos.discMaisBaixaNota = body.discMaisBaixaNota;
  if (body.assuntoMaisBaixoNome !== undefined) campos.assuntoMaisBaixoNome = body.assuntoMaisBaixoNome;
  if (body.assuntoMaisBaixoNota !== undefined) campos.assuntoMaisBaixoNota = body.assuntoMaisBaixoNota;

  const aluno = await prisma.aluno.update({ where: { id }, data: campos });
  return NextResponse.json(aluno);
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  await prisma.aluno.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
