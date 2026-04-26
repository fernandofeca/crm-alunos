import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import UsuariosClient from "./UsuariosClient";

export const dynamic = "force-dynamic";

const ADMINS = ["fernandofecalimas@gmail.com", "carolina@carolinagaubert.com"];

export default async function UsuariosPage() {
  const session = await auth();
  const email = session?.user?.email ?? "";
  const isAdmin = ADMINS.includes(email);

  const usuarios = isAdmin
    ? await prisma.user.findMany({
        select: { id: true, name: true, email: true, role: true, createdAt: true },
        orderBy: { name: "asc" },
      })
    : await prisma.user.findMany({
        where: { id: session?.user?.id ?? "" },
        select: { id: true, name: true, email: true, role: true, createdAt: true },
      });

  return (
    <UsuariosClient
      initialUsuarios={JSON.parse(JSON.stringify(usuarios))}
      isAdmin={isAdmin}
    />
  );
}
