import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";
import { canDo, forbidden } from "@/lib/permissions";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const mes = searchParams.get("mes"); // YYYY-MM
  const where: Record<string, unknown> = {};

  if (mes) {
    const [ano, m] = mes.split("-").map(Number);
    where.data = {
      gte: new Date(ano, m - 1, 1),
      lt: new Date(ano, m, 1),
    };
  }

  const eventos = await prisma.evento.findMany({
    where,
    include: { aluno: { select: { id: true, nome: true } }, user: { select: { name: true } } },
    orderBy: { data: "asc" },
  });

  return NextResponse.json(eventos);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (!canDo(session, "gerenciar_agenda")) return forbidden();

  const body = await req.json();
  const evento = await prisma.evento.create({
    data: {
      titulo: body.titulo,
      descricao: body.descricao ?? "",
      data: new Date(body.data),
      tipo: body.tipo ?? "lembrete",
      alunoId: body.alunoId || null,
      userId: (session.user?.id ?? "") as string,
    },
    include: { aluno: { select: { id: true, nome: true } }, user: { select: { name: true } } },
  });

  return NextResponse.json(evento, { status: 201 });
}
