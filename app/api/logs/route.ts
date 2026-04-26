import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";

const PAGE_SIZE = 50;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const userId = searchParams.get("userId") ?? "";
  const tipo = searchParams.get("tipo") ?? "";
  const acao = searchParams.get("acao") ?? "";
  const page = Math.max(0, parseInt(searchParams.get("page") ?? "0", 10));

  const where: Record<string, unknown> = {};
  if (userId) where.userId = userId;
  if (tipo) where.tipo = tipo;
  if (acao) where.acao = acao;

  const [logs, total] = await Promise.all([
    prisma.log.findMany({
      where,
      include: { user: { select: { id: true, name: true } } },
      orderBy: { criadoEm: "desc" },
      take: PAGE_SIZE,
      skip: page * PAGE_SIZE,
    }),
    prisma.log.count({ where }),
  ]);

  return NextResponse.json({ logs, total, page, pageSize: PAGE_SIZE });
}
