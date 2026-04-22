import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";
import { canDo, forbidden } from "@/lib/permissions";

const include = {
  aluno: { select: { id: true, nome: true } },
  user: { select: { id: true, name: true } },
  responsavel: { select: { id: true, name: true } },
};

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
    include,
    orderBy: [{ concluida: "asc" }, { dataVencimento: "asc" }, { createdAt: "desc" }],
  });

  return NextResponse.json(tarefas);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (!canDo(session, "gerenciar_tarefas")) return forbidden();

  const body = await req.json();
  const tarefa = await prisma.tarefa.create({
    data: {
      titulo: body.titulo,
      descricao: body.descricao ?? "",
      prioridade: body.prioridade ?? "media",
      dataVencimento: body.dataVencimento ? new Date(body.dataVencimento) : null,
      alunoId: body.alunoId || null,
      responsavelId: body.responsavelId || null,
      userId: (session.user?.id ?? "") as string,
    },
    include,
  });

  return NextResponse.json(tarefa, { status: 201 });
}
