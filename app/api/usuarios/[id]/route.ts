import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { registrarLog } from "@/lib/log";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const { name, email, password, role } = await req.json();

  const data: Record<string, unknown> = { name, email, role };
  if (password) {
    data.password = await bcrypt.hash(password, 10);
  }

  const usuario = await prisma.user.update({
    where: { id },
    data,
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });

  await registrarLog({
    tipo: "usuario",
    acao: "usuario_editado",
    descricao: `Editou o usuário ${name}`,
    userId: (session.user?.id ?? null) as string | null,
    meta: { usuarioEditadoId: id, trocouSenha: !!password },
  });

  return NextResponse.json(usuario);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const sessionId = session.user?.id;

  if (id === sessionId) {
    return NextResponse.json({ error: "Você não pode excluir sua própria conta" }, { status: 400 });
  }

  const usuario = await prisma.user.findUnique({ where: { id }, select: { name: true, email: true } });
  await prisma.user.delete({ where: { id } });

  await registrarLog({
    tipo: "usuario",
    acao: "usuario_excluido",
    descricao: `Excluiu o usuário ${usuario?.name ?? id}`,
    userId: (session.user?.id ?? null) as string | null,
    meta: { usuarioExcluidoId: id, email: usuario?.email },
  });

  return NextResponse.json({ ok: true });
}
