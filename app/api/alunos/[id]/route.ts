import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";
import { registrarLog } from "@/lib/log";

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

  await registrarLog({
    tipo: "usuario",
    acao: "aluno_atualizado",
    descricao: `Atualizou dados do aluno ${aluno.nome}`,
    userId: (session.user?.id ?? null) as string | null,
    alunoId: aluno.id,
    alunoNome: aluno.nome,
  });

  return NextResponse.json(aluno);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();

  const campos: Record<string, unknown> = {};
  if (body.nome !== undefined) campos.nome = body.nome;
  if (body.email !== undefined) campos.email = body.email;
  if (body.cpf !== undefined) campos.cpf = body.cpf;
  if (body.whatsapp !== undefined) campos.whatsapp = body.whatsapp;
  if (body.concurso !== undefined) campos.concurso = body.concurso;
  if (body.ativo !== undefined) campos.ativo = body.ativo;
  if (body.mediaGeral !== undefined) campos.mediaGeral = body.mediaGeral;
  if (body.discMaisBaixaNome !== undefined) campos.discMaisBaixaNome = body.discMaisBaixaNome;
  if (body.discMaisBaixaNota !== undefined) campos.discMaisBaixaNota = body.discMaisBaixaNota;
  if (body.assuntoMaisBaixoNome !== undefined) campos.assuntoMaisBaixoNome = body.assuntoMaisBaixoNome;
  if (body.assuntoMaisBaixoNota !== undefined) campos.assuntoMaisBaixoNota = body.assuntoMaisBaixoNota;
  if (body.statusEstudo !== undefined) campos.statusEstudo = body.statusEstudo;
  if (body.planoTipo !== undefined) campos.planoTipo = body.planoTipo;
  if (body.planoVencimento !== undefined) campos.planoVencimento = body.planoVencimento ? new Date(body.planoVencimento) : null;
  if (body.dataInicio !== undefined) campos.dataInicio = body.dataInicio ? new Date(body.dataInicio) : null;
  if (body.acompanharDePerto !== undefined) campos.acompanharDePerto = body.acompanharDePerto;
  if (body.tutoryId !== undefined) campos.tutoryId = body.tutoryId ? Number(body.tutoryId) : null;
  if (body.planilhaUrl !== undefined) campos.planilhaUrl = body.planilhaUrl || null;

  // Busca nome atual para log (antes do update, caso seja exclusão de dado)
  const alunoAtual = await prisma.aluno.findUnique({ where: { id }, select: { nome: true } });

  const aluno = await prisma.aluno.update({ where: { id }, data: campos });

  // Só loga se vier de sessão humana (não de sync automático)
  if (session.user?.id) {
    const camposEditados = Object.keys(campos).join(", ");
    await registrarLog({
      tipo: "usuario",
      acao: "aluno_editado",
      descricao: `Editou perfil de ${alunoAtual?.nome ?? id} (${camposEditados})`,
      userId: session.user.id as string,
      alunoId: id,
      alunoNome: alunoAtual?.nome,
      meta: { campos: Object.keys(campos) },
    });
  }

  return NextResponse.json(aluno);
}

export async function DELETE(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const aluno = await prisma.aluno.findUnique({ where: { id }, select: { nome: true } });
  await prisma.aluno.delete({ where: { id } });

  await registrarLog({
    tipo: "usuario",
    acao: "aluno_excluido",
    descricao: `Excluiu o aluno ${aluno?.nome ?? id}`,
    userId: (session.user?.id ?? null) as string | null,
    alunoNome: aluno?.nome,
    meta: { alunoId: id },
  });

  return NextResponse.json({ ok: true });
}
