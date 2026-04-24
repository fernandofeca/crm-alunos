import { prisma } from "@/lib/prisma";
import Link from "next/link";

export const dynamic = "force-dynamic";

const PLANOS = ["Mentoria da Posse", "Mentoria Diamante", "Cronograma Ouro", "Cronograma Outros"];

function fmtData(d: Date) {
  return new Date(d).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
}

function corDias(dias: number) {
  if (dias >= 7) return "bg-red-100 text-red-800";
  if (dias >= 4) return "bg-red-50 text-red-600";
  if (dias >= 2) return "bg-orange-50 text-orange-700";
  return "bg-yellow-50 text-yellow-700";
}

function buildHref(semanaIso: string | undefined, plano: string | undefined) {
  const params = new URLSearchParams();
  if (semanaIso) params.set("semana", semanaIso);
  if (plano) params.set("plano", plano);
  return `/historico-atrasos?${params.toString()}`;
}

export default async function HistoricoAtrasosPage({ searchParams }: { searchParams: Promise<{ semana?: string; plano?: string }> }) {
  const { semana: semanaParam, plano: planoParam } = await searchParams;

  // All distinct semanas (Fridays with snapshots)
  const semanas = await prisma.snapshotAtraso.findMany({
    distinct: ["semana"],
    select: { semana: true },
    orderBy: { semana: "desc" },
  });

  // Selected semana — default to most recent
  const semanaAtual = semanaParam
    ? new Date(semanaParam)
    : semanas[0]?.semana ?? null;

  const semanaIso = semanaAtual?.toISOString();

  // Filter by plano via aluno relation (students without CRM link are excluded when plano filter active)
  const snapshots = semanaAtual
    ? await prisma.snapshotAtraso.findMany({
        where: {
          semana: semanaAtual,
          ...(planoParam ? { aluno: { planoTipo: planoParam } } : {}),
        },
        include: { aluno: { select: { id: true, whatsapp: true, planoTipo: true } } },
        orderBy: { diasAtraso: "desc" },
      })
    : [];

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">📋 Histórico de Atrasos</h1>
        <p className="text-sm text-slate-500 mt-1">
          Snapshot capturado às 06h20 de cada sexta-feira, antes da retirada automática de atrasos
        </p>
      </div>

      {semanas.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center">
          <p className="text-3xl mb-2">📭</p>
          <p className="text-slate-500 text-sm">Nenhum snapshot ainda. O cron roda toda sexta às 06h20.</p>
          <p className="text-xs text-slate-400 mt-2">Você também pode gerar manualmente via POST /api/tutory/snapshot-atraso</p>
        </div>
      ) : (
        <>
          {/* Seletor de semana */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm text-slate-500 font-medium">Sexta-feira:</span>
            {semanas.map(({ semana }) => {
              const iso = semana.toISOString();
              const ativa = semanaAtual && semana.getTime() === semanaAtual.getTime();
              return (
                <Link
                  key={iso}
                  href={buildHref(iso, planoParam)}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition ${
                    ativa
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {new Date(semana).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" })}
                </Link>
              );
            })}
          </div>

          {/* Filtro de plano */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-slate-500 font-medium">Plano:</span>
            <Link
              href={buildHref(semanaIso, undefined)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition ${
                !planoParam
                  ? "bg-slate-700 text-white border-slate-700"
                  : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50"
              }`}
            >
              Todos
            </Link>
            {PLANOS.map((p) => (
              <Link
                key={p}
                href={buildHref(semanaIso, planoParam === p ? undefined : p)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition ${
                  planoParam === p
                    ? "bg-indigo-600 text-white border-indigo-600"
                    : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50"
                }`}
              >
                {p}
              </Link>
            ))}
          </div>

          {/* Tabela */}
          {semanaAtual && (
            <>
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-slate-700">
                  {fmtData(semanaAtual)}
                  {planoParam && <span className="ml-2 text-sm font-normal text-indigo-600">· {planoParam}</span>}
                </h2>
                <span className="text-sm text-slate-400">
                  {snapshots.length} aluno{snapshots.length !== 1 ? "s" : ""} em atraso
                </span>
              </div>

              <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                    <tr>
                      <th className="text-left px-4 py-3">#</th>
                      <th className="text-left px-4 py-3">Aluno</th>
                      <th className="text-left px-4 py-3">Plano</th>
                      <th className="text-center px-4 py-3">Dias de atraso</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {snapshots.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                          Nenhum aluno encontrado para este filtro.
                        </td>
                      </tr>
                    )}
                    {snapshots.map((s, idx) => (
                      <tr key={s.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 text-slate-400 text-xs">{idx + 1}</td>
                        <td className="px-4 py-3">
                          {s.aluno ? (
                            <Link href={`/alunos/${s.aluno.id}`} className="font-medium text-blue-600 hover:underline">
                              {s.nome}
                            </Link>
                          ) : (
                            <span className="font-medium text-slate-700">{s.nome}</span>
                          )}
                          <div className="text-xs text-slate-400">{s.email}</div>
                        </td>
                        <td className="px-4 py-3 text-slate-500 text-xs">
                          {s.aluno?.planoTipo || <span className="text-slate-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-full ${corDias(s.diasAtraso)}`}>
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            {s.diasAtraso}d
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            {s.aluno?.whatsapp && (
                              <a
                                href={`https://wa.me/${s.aluno.whatsapp.replace(/\D/g, "")}`}
                                target="_blank" rel="noopener noreferrer"
                                className="text-xs bg-green-500 hover:bg-green-600 text-white px-2 py-1 rounded transition"
                              >
                                WhatsApp
                              </a>
                            )}
                            {s.aluno && (
                              <Link href={`/alunos/${s.aluno.id}`}
                                className="text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded hover:bg-blue-100 transition">
                                Ver Perfil
                              </Link>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
