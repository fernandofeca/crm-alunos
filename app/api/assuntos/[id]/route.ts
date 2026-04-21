import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { id } = await params;
  const { nota } = await req.json();

  const assunto = await prisma.assunto.update({
    where: { id },
    data: { nota },
  });

  return NextResponse.json({ nota: assunto.nota });
}
