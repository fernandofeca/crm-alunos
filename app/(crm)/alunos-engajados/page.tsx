import { prisma } from "@/lib/prisma";
import AlunosEngajadosClient from "./AlunosEngajadosClient";

export const dynamic = "force-dynamic";

function sextasDoMes(ano: number, mes: number): Date[] {
  const sextas: Date[] = [];
  const d = new Date(Date.UTC(ano, mes - 1, 1));
  while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCMonth() === mes - 1) {
    sextas.push(new Date(d));
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return sextas;
}

export default async function AlunosEngajadosPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const { mes } = await searchParams;

  const hoje = new Date();
  let ano = hoje.getUTCFullYear();
  let mesNum = hoje.getUTCMonth() + 1;

  if (mes && /^\d{4}-\d{2}$/.test(mes)) {
    const [y, m] = mes.split("-").map(Number);
    ano = y;
    mesNum = m;
  }

  const sextas = sextasDoMes(ano, mesNum);

  const conquistas = await prisma.conquista.findMany({
    where: { semana: { in: sextas }, tipo: "engajamento_semanal" },
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
          tutoryId: true,
        },
      },
    },
    orderBy: { semana: "asc" },
  });

  const concursosRaw = await prisma.aluno.findMany({
    select: { concurso: true },
    distinct: ["concurso"],
    where: { ativo: true, concurso: { not: "" } },
    orderBy: { concurso: "asc" },
  });
  const concursos = concursosRaw.map((c) => c.concurso).filter(Boolean);

  // Months available from April 2026 to current month
  const mesesDisponiveis: string[] = [];
  const inicio = new Date(Date.UTC(2026, 3, 1));
  const limite = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 1));
  const cursor = new Date(inicio);
  while (cursor <= limite) {
    mesesDisponiveis.push(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  const mesAtual = `${ano}-${String(mesNum).padStart(2, "0")}`;

  return (
    <AlunosEngajadosClient
      conquistas={JSON.parse(JSON.stringify(conquistas))}
      concursos={concursos}
      sextas={sextas.map((s) => s.toISOString())}
      mesAtual={mesAtual}
      mesesDisponiveis={mesesDisponiveis}
    />
  );
}
