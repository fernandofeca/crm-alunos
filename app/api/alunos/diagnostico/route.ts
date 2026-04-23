import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== "cg-bulk-2026") return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const hoje = new Date();

  // Inativos no CRM mas com plano ainda vigente no Tutory
  const inativosComPlanoVigente = await prisma.aluno.findMany({
    where: { ativo: false, planoVencimento: { gte: hoje } },
    select: { id: true, nome: true, email: true, tutoryId: true, planoVencimento: true, concurso: true },
    orderBy: { planoVencimento: "asc" },
  });

  // Ativos no CRM mas com plano vencido (possível inconsistência inversa)
  const ativosComPlanoVencido = await prisma.aluno.findMany({
    where: { ativo: true, planoVencimento: { lt: hoje, not: null } },
    select: { id: true, nome: true, email: true, tutoryId: true, planoVencimento: true, concurso: true },
    orderBy: { planoVencimento: "desc" },
  });

  const totalAtivos = await prisma.aluno.count({ where: { ativo: true } });
  const totalInativos = await prisma.aluno.count({ where: { ativo: false } });

  return NextResponse.json({
    totalAtivos,
    totalInativos,
    inativosComPlanoVigente,
    ativosComPlanoVencido: ativosComPlanoVencido.slice(0, 20),
  });
}
