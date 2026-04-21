import { prisma } from "@/lib/prisma";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const [total, semEstudo, notaBaixa, semContato] = await Promise.all([
    prisma.aluno.count(),
    prisma.aluno.count({ where: { ativo: true, estudouUltimos7d: false } }),
    prisma.aluno.count({ where: { ativo: true, mediaGeral: { lt: 6 } } }),
    prisma.aluno.count({ where: { ativo: true, contatos: { none: {} } } }),
  ]);

  const alertas = await prisma.aluno.findMany({
    where: {
      ativo: true,
      OR: [{ estudouUltimos7d: false }, { mediaGeral: { lt: 6 } }],
    },
    include: {
      contatos: { include: { user: true }, orderBy: { data: "desc" }, take: 1 },
    },
    orderBy: { mediaGeral: "asc" },
    take: 10,
  });

  const cards = [
    { label: "Total de Alunos", value: total, color: "bg-blue-50 text-blue-700", border: "border-blue-200" },
    { label: "Sem estudar (7d)", value: semEstudo, color: "bg-orange-50 text-orange-700", border: "border-orange-200" },
    { label: "Nota abaixo de 6", value: notaBaixa, color: "bg-red-50 text-red-700", border: "border-red-200" },
    { label: "Sem contato", value: semContato, color: "bg-yellow-50 text-yellow-700", border: "border-yellow-200" },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Dashboard</h1>
        <p className="text-sm text-slate-500">Visão geral do desempenho dos alunos</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {cards.map((c) => (
          <div key={c.label} className={`rounded-xl border p-5 ${c.color} ${c.border}`}>
            <p className="text-3xl font-bold">{c.value}</p>
            <p className="text-sm mt-1 font-medium opacity-80">{c.label}</p>
          </div>
        ))}
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-slate-700">Alunos que precisam de atenção</h2>
          <Link href="/alunos" className="text-sm text-blue-600 hover:underline">
            Ver todos
          </Link>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 uppercase text-xs">
              <tr>
                <th className="text-left px-4 py-3">Aluno</th>
                <th className="text-left px-4 py-3">Média</th>
                <th className="text-left px-4 py-3">Estudou (7d)</th>
                <th className="text-left px-4 py-3">Último contato</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {alertas.map((a) => {
                const ultimoContato = a.contatos[0];
                return (
                  <tr key={a.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">{a.nome}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`font-semibold ${
                          a.mediaGeral < 6 ? "text-red-600" : "text-green-600"
                        }`}
                      >
                        {a.mediaGeral.toFixed(1)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {a.estudouUltimos7d ? (
                        <span className="text-green-600 font-medium">Sim</span>
                      ) : (
                        <span className="text-orange-500 font-medium">Não</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {ultimoContato ? (
                        <span>
                          {new Date(ultimoContato.data).toLocaleDateString("pt-BR")} &middot;{" "}
                          <span className="capitalize">{ultimoContato.tipo}</span>
                        </span>
                      ) : (
                        <span className="text-yellow-500">Nenhum</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/alunos/${a.id}`}
                        className="text-blue-600 hover:underline text-xs"
                      >
                        Ver
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {alertas.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                    Nenhum aluno em alerta
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
