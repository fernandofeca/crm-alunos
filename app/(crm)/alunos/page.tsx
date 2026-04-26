import { prisma } from "@/lib/prisma";
import Link from "next/link";
import { Suspense } from "react";
import AlunosClient from "./AlunosClient";
import TutorySyncButton from "./TutorySyncButton";

export const dynamic = "force-dynamic";

export default async function AlunosPage() {
  const [total, concursosRaw] = await Promise.all([
    prisma.aluno.count({ where: { ativo: true } }),
    prisma.aluno.findMany({
      select: { concurso: true },
      distinct: ["concurso"],
      where: { concurso: { not: "" }, ativo: true },
      orderBy: { concurso: "asc" },
    }),
  ]);

  const concursos = concursosRaw.map((c) => c.concurso).filter(Boolean).sort();

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Alunos</h1>
          <p className="text-sm text-slate-500">{total} alunos ativos</p>
        </div>
        <div className="flex gap-2">
          <TutorySyncButton />
          <Link
            href="/alunos/novo"
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
          >
            + Novo aluno
          </Link>
        </div>
      </div>
      <Suspense fallback={<p className="text-sm text-slate-400">Carregando...</p>}>
        <AlunosClient initialAlunos={[]} concursos={concursos} totalInicial={total} />
      </Suspense>
    </div>
  );
}
