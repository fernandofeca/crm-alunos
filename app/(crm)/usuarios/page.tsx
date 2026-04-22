import { prisma } from "@/lib/prisma";
import UsuariosClient from "./UsuariosClient";
import { auth } from "@/auth";
import { isAdmin } from "@/lib/permissions";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function UsuariosPage() {
  const session = await auth();
  if (!isAdmin(session)) redirect("/");

  const usuarios = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, createdAt: true },
    orderBy: { name: "asc" },
  });

  return <UsuariosClient initialUsuarios={JSON.parse(JSON.stringify(usuarios))} />;
}
