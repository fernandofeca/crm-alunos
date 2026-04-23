import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { email, password } = await req.json();
  if (!email || !password) return NextResponse.json({ error: "campos_obrigatorios" });

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return NextResponse.json({ error: "usuario_nao_encontrado" });

  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return NextResponse.json({ error: "senha_incorreta" });

  return NextResponse.json({ ok: true });
}
