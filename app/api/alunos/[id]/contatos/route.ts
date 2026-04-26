import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";
import { registrarLog } from "@/lib/log";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const body = await req.json();

  const contatoData = body.data ? new Date(body.data) : new Date();

  const contato = await prisma.contato.create({
    data: {
      alunoId: id,
      userId: (session.user?.id ?? "") as string,
      tipo: body.tipo,
      obs: body.obs ?? "",
      data: contatoData,
    },
    include: { user: true },
  });

  const aluno = await prisma.aluno.update({
    where: { id },
    data: { ultimoContatoData: contatoData },
    select: { nome: true },
  });

  await registrarLog({
    tipo: "usuario",
    acao: "contato_registrado",
    descricao: `Registrou contato (${body.tipo}) com ${aluno.nome}`,
    userId: (session.user?.id ?? null) as string | null,
    alunoId: id,
    alunoNome: aluno.nome,
    meta: { tipo: body.tipo, obs: body.obs ?? "" },
  });

  return NextResponse.json(contato, { status: 201 });
}
