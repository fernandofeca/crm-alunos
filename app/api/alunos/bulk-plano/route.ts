import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== "cg-bulk-2026") return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const body = await req.json();
  const { concursos, planoTipo, prefixoNome, resetAll } = body as {
    concursos?: string[];
    planoTipo: string;
    prefixoNome?: string;
    resetAll?: boolean;
  };

  if (resetAll) {
    const result = await prisma.aluno.updateMany({ data: { planoTipo } });
    return NextResponse.json({ atualizados: result.count, modo: "resetAll" });
  }

  if (prefixoNome) {
    const result = await prisma.aluno.updateMany({
      where: { nome: { startsWith: prefixoNome } },
      data: { planoTipo },
    });
    return NextResponse.json({ atualizados: result.count, modo: "prefixoNome" });
  }

  if (!concursos?.length) {
    return NextResponse.json({ error: "concursos é obrigatório e não pode ser vazio" }, { status: 400 });
  }

  const result = await prisma.aluno.updateMany({
    where: { concurso: { in: concursos } },
    data: { planoTipo },
  });

  return NextResponse.json({ atualizados: result.count, modo: "concursos" });
}
