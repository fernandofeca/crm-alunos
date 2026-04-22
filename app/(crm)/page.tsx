import { prisma } from "@/lib/prisma";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const trinta = new Date();
  trinta.setDate(trinta.getDate() - 30);

  const [
    total,
    taxaBaixa,
    semContato,
    novosAlunos,
    metasEmDia,
    metas1d,
    metas2d,
    metas3d,
    metas4d,
    metas5d,
    metas6d,
    metas7d,
  ] = await Promise.all([
    prisma.aluno.count({ where: { ativo: true } }),
    prisma.aluno.count({ where: { ativo: true, taxaAcertos: { gt: 0, lt: 60 } } }),
    prisma.aluno.count({ where: { ativo: true, contatos: { none: {} } } }),
    prisma.aluno.count({ where: { ativo: true, tutoryCreatedAt: { gte: trinta } } }),
    prisma.aluno.count({ where: { ativo: true, diasAtraso: 0 } }),
    prisma.aluno.count({ where: { ativo: true, diasAtraso: 1 } }),
    prisma.aluno.count({ where: { ativo: true, diasAtraso: 2 } }),
    prisma.aluno.count({ where: { ativo: true, diasAtraso: 3 } }),
    prisma.aluno.count({ where: { ativo: true, diasAtraso: 4 } }),
    prisma.aluno.count({ where: { ativo: true, diasAtraso: 5 } }),
    prisma.aluno.count({ where: { ativo: true, diasAtraso: 6 } }),
    prisma.aluno.count({ where: { ativo: true, diasAtraso: 7 } }),
  ]);

  const atencao = await prisma.aluno.findMany({
    where: { ativo: true, diasAtraso: { gt: 0 } },
    include: {
      contatos: { include: { user: true }, orderBy: { data: "desc" }, take: 1 },
    },
    orderBy: { diasAtraso: "desc" },
    take: 10,
  });

  const cardsResumo = [
    { label: "Total de Alunos", value: total, color: "bg-blue-50 text-blue-700", border: "border-blue-200", href: "/alunos" },
    { label: "Novos Alunos (30d)", value: novosAlunos, color: "bg-indigo-50 text-indigo-700", border: "border-indigo-200", href: "/alunos?filtro=novos" },
    { label: "Taxa baixa (<60%)", value: taxaBaixa, color: "bg-red-50 text-red-700", border: "border-red-200", href: "/alunos?filtro=nota_baixa" },
    { label: "Sem contato", value: semContato, color: "bg-yellow-50 text-yellow-700", border: "border-yellow-200", href: "/alunos?filtro=sem_contato" },
  ];

  const cardsMetas = [
    { label: "Em dia", value: metasEmDia, color: "bg-green-50 text-green-700", border: "border-green-200", href: "/alunos?filtro=metas_em_dia" },
    { label: "1d atraso", value: metas1d, color: "bg-yellow-50 text-yellow-700", border: "border-yellow-200", href: "/alunos?filtro=metas_1d" },
    { label: "2d atraso", value: metas2d, color: "bg-orange-50 text-orange-700", border: "border-orange-200", href: "/alunos?filtro=metas_2d" },
    { label: "3d atraso", value: metas3d, color: "bg-orange-50 text-orange-800", border: "border-orange-300", href: "/alunos?filtro=metas_3d" },
    { label: "4d atraso", value: metas4d, color: "bg-red-50 text-red-600", border: "border-red-200", href: "/alunos?filtro=metas_4d" },
    { label: "5d atraso", value: metas5d, color: "bg-red-50 text-red-700", border: "border-red-300", href: "/alunos?filtro=metas_5d" },
    { label: "6d atraso", value: metas6d, color: "bg-red-100 text-red-700", border: "border-red-300", href: "/alunos?filtro=metas_6d" },
    { label: "7d atraso", value: metas7d, color: "bg-red-100 text-red-800", border: "border-red-400", href: "/alunos?filtro=metas_7d" },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Dashboard</h1>
        <p className="text-sm text-slate-500">Visão geral do desempenho dos alunos</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {cardsResumo.map((c) => (
          <Link key={c.label} href={c.href} className={`rounded-xl border p-5 ${c.color} ${c.border} hover:opacity-80 transition cursor-pointer block`}>
            <p className="text-3xl font-bold">{c.value}</p>
            <p className="text-sm mt-1 font-medium opacity-80">{c.label}</p>
          </Link>
        ))}
      </div>

      <div>
        <h2 className="text-base font-semibold text-slate-700 mb-3">Status Metas (ativos)</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-3">
          {cardsMetas.map((c) => (
            <Link key={c.label} href={c.href} className={`rounded-xl border p-4 ${c.color} ${c.border} hover:opacity-80 transition cursor-pointer block text-center`}>
              <p className="text-2xl font-bold">{c.value}</p>
              <p className="text-xs mt-1 font-medium opacity-80">{c.label}</p>
            </Link>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-slate-700">Alunos com metas em atraso</h2>
          <Link href="/alunos" className="text-sm text-blue-600 hover:underline">Ver todos</Link>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500 uppercase text-xs">
              <tr>
                <th className="text-left px-4 py-3">Aluno</th>
                <th className="text-left px-4 py-3">Metas</th>
                <th className="text-left px-4 py-3">Taxa Acertos</th>
                <th className="text-left px-4 py-3">Último contato</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {atencao.map((a) => {
                const ultimoContato = a.contatos[0];
                return (
                  <tr key={a.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">{a.nome}</td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {a.diasAtraso}d atraso
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {a.taxaAcertos > 0 ? (
                        <span className="font-semibold text-slate-700">{a.taxaAcertos.toFixed(1)}%</span>
                      ) : (
                        <span className="text-slate-300">—</span>
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
                      <Link href={`/alunos/${a.id}`} className="text-blue-600 hover:underline text-xs">Ver</Link>
                    </td>
                  </tr>
                );
              })}
              {atencao.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                    Nenhum aluno com meta em atraso
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
