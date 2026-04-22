import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { NextResponse } from "next/server";

export async function POST() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  await prisma.user.update({
    where: { id: (session.user?.id ?? "") as string },
    data: { googleRefreshToken: null },
  });

  return NextResponse.json({ ok: true });
}
