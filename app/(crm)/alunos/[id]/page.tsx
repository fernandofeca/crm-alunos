import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import AlunoDetalhe from "./AlunoDetalhe";

export const dynamic = "force-dynamic";

export default async function AlunoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const aluno = await prisma.aluno.findUnique({
    where: { id },
    include: {
      disciplinas: { include: { assuntos: true } },
      contatos: { include: { user: true }, orderBy: { data: "desc" } },
      conquistas: { orderBy: { semana: "desc" } },
    },
  });

  if (!aluno) notFound();

  const concursosRaw = await prisma.aluno.findMany({
    select: { concurso: true },
    distinct: ["concurso"],
    where: { concurso: { not: "" } },
    orderBy: { concurso: "asc" },
  });
  const concursos = concursosRaw.map((c) => c.concurso).filter(Boolean);

  return <AlunoDetalhe aluno={JSON.parse(JSON.stringify(aluno))} concursos={concursos} />;
}
