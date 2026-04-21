import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { NextResponse } from "next/server";

export async function POST() {
  const existing = await prisma.user.findUnique({
    where: { email: "admin@crm.com" },
  });
  if (existing) {
    return NextResponse.json({ message: "Usuário já existe" });
  }
  const hash = await bcrypt.hash("admin123", 10);
  await prisma.user.create({
    data: {
      name: "Administrador",
      email: "admin@crm.com",
      password: hash,
      role: "equipe",
    },
  });
  return NextResponse.json({ message: "Usuário admin criado com sucesso" });
}
