import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { NextResponse } from "next/server";

// Promove o usuário logado a admin SE ainda não existir nenhum admin.
export async function POST() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Faça login primeiro." }, { status: 401 });

  const adminExiste = await prisma.user.findFirst({ where: { role: "admin" } });
  if (adminExiste) {
    return NextResponse.json({ error: "Já existe um admin. Endpoint desativado." }, { status: 403 });
  }

  const userId = session.user?.id as string;
  await prisma.user.update({ where: { id: userId }, data: { role: "admin" } });

  return NextResponse.json({ ok: true, mensagem: "Você agora é admin. Faça logout e login novamente." });
}
