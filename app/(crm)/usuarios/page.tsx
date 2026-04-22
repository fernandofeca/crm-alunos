import { prisma } from "@/lib/prisma";
import UsuariosClient from "./UsuariosClient";

export const dynamic = "force-dynamic";

export default async function UsuariosPage() {
  const usuarios = await prisma.user.findMany({
    select: { id: true, name: true, email: true, role: true, createdAt: true },
    orderBy: { name: "asc" },
  });

  return <UsuariosClient initialUsuarios={JSON.parse(JSON.stringify(usuarios))} />;
}
