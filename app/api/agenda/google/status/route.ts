import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ conectado: false });

  const user = await prisma.user.findUnique({
    where: { id: (session.user?.id ?? "") as string },
    select: { googleRefreshToken: true },
  });

  return NextResponse.json({ conectado: !!user?.googleRefreshToken });
}
