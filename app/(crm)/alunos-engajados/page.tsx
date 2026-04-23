import { prisma } from "@/lib/prisma";
import AlunosEngajadosClient from "./AlunosEngajadosClient";

export const dynamic = "force-dynamic";

function ultimasDuasSextas(): Date[] {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  const dow = d.getUTCDay();
  const diasAteSexta = (dow - 5 + 7) % 7;
  const s1 = new Date(d);
  s1.setUTCDate(d.getUTCDate() - diasAteSexta);
  const s2 = new Date(s1);
  s2.setUTCDate(s1.getUTCDate() - 7);
  return [s1, s2];
}

export default async function AlunosEngajadosPage() {
  const [sexta1, sexta2] = ultimasDuasSextas();

  const conquistas = await prisma.conquista.findMany({
    where: {
      semana: { in: [sexta1, sexta2] },
      tipo: "engajamento_semanal",
    },
    include: {
      aluno: {
        select: {
          id: true,
          nome: true,
          email: true,
          whatsapp: true,
          concurso: true,
          planoTipo: true,
          ativo: true,
        },
      },
    },
    orderBy: { semana: "desc" },
  });

  const concursosRaw = await prisma.aluno.findMany({
    select: { concurso: true },
    distinct: ["concurso"],
    where: { ativo: true, concurso: { not: "" } },
    orderBy: { concurso: "asc" },
  });
  const concursos = concursosRaw.map((c) => c.concurso).filter(Boolean);

  return (
    <AlunosEngajadosClient
      conquistas={JSON.parse(JSON.stringify(conquistas))}
      concursos={concursos}
      sextas={[sexta1.toISOString(), sexta2.toISOString()]}
    />
  );
}
