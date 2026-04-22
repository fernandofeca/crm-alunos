import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";
import { canDo, forbidden } from "@/lib/permissions";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (!canDo(session, "registrar_contato")) return forbidden();

  const { id } = await params;
  const body = await req.json();

  const contato = await prisma.contato.create({
    data: {
      alunoId: id,
      userId: (session.user?.id ?? "") as string,
      tipo: body.tipo,
      obs: body.obs ?? "",
      ...(body.data ? { data: new Date(body.data) } : {}),
    },
    include: { user: true },
  });

  return NextResponse.json(contato, { status: 201 });
}
