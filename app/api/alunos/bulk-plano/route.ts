import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== "cg-bulk-2026") return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { concursos, planoTipo }: { concursos: string[]; planoTipo: string } = await req.json();

  const result = await prisma.aluno.updateMany({
    where: { concurso: { in: concursos } },
    data: { planoTipo },
  });

  return NextResponse.json({ atualizados: result.count });
}
