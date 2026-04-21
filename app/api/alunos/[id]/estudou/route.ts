import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const { estudouUltimos7d } = await req.json();

  const aluno = await prisma.aluno.update({
    where: { id },
    data: { estudouUltimos7d },
  });

  return NextResponse.json(aluno);
}
