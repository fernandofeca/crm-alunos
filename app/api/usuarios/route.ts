import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const usuarios = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, createdAt: true },
    orderBy: { name: "asc" },
  });

  return NextResponse.json(usuarios);
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { name, email, password, role } = await req.json();

  if (!name || !email || !password) {
    return NextResponse.json({ error: "Nome, email e senha são obrigatórios" }, { status: 400 });
  }

  const existe = await prisma.user.findUnique({ where: { email } });
  if (existe) {
    return NextResponse.json({ error: "Email já cadastrado" }, { status: 409 });
  }

  const hash = await bcrypt.hash(password, 10);
  const usuario = await prisma.user.create({
    data: { name, email, password: hash, role: role ?? "equipe" },
    select: { id: true, name: true, email: true, role: true, createdAt: true },
  });

  return NextResponse.json(usuario, { status: 201 });
}
