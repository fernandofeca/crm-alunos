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

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const concluida = searchParams.get("concluida");
  const usuarioId = searchParams.get("usuarioId");

  const where: Record<string, unknown> = {};
  if (concluida === "true") where.concluida = true;
  else if (concluida === "false") where.concluida = false;

  if (usuarioId) {
    where.OR = [
      { responsavelId: usuarioId },
      { responsavel2Id: usuarioId },
    ];
  }

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

  const body = await req.json();
  const tarefa = await prisma.tarefa.create({
    data: {
      titulo: body.titulo,
      descricao: body.descricao ?? "",
      prioridade: body.prioridade ?? "media",
      dataVencimento: body.dataVencimento ? new Date(body.dataVencimento) : null,
      alunoId: body.alunoId || null,
      responsavelId: body.responsavelId || null,
      responsavel2Id: body.responsavel2Id || null,
      userId: (session.user?.id ?? "") as string,
    },
    include,
  });

  await registrarLog({
    tipo: "usuario",
    acao: "tarefa_criada",
    descricao: `Criou a tarefa "${tarefa.titulo}"`,
    userId: (session.user?.id ?? null) as string | null,
    alunoId: tarefa.alunoId,
    alunoNome: tarefa.aluno?.nome,
    meta: { prioridade: tarefa.prioridade },
  });

  return NextResponse.json(tarefa, { status: 201 });
}
