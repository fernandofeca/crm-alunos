import { prisma } from "@/lib/prisma";
import Link from "next/link";

export const dynamic = "force-dynamic";

// Returns today's date (year/month/day) in Brasília timezone (UTC-3, no DST)
function hojeEmBrasilia(): { ano: number; mes: number; dia: number } {
  const str = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const [ano, mes, dia] = str.split("-").map(Number);
  return { ano, mes, dia };
}

function semanaAtual(hoje: { ano: number; mes: number; dia: number }): { inicio: Date; fim: Date } {
  const hojeUtc = new Date(Date.UTC(hoje.ano, hoje.mes - 1, hoje.dia));
  const diaSemana = hojeUtc.getUTCDay(); // 0=Dom ... 6=Sab
  const segunda = new Date(hojeUtc);
  segunda.setUTCDate(hojeUtc.getUTCDate() - (diaSemana === 0 ? 6 : diaSemana - 1));
  const domingo = new Date(segunda);
  domingo.setUTCDate(segunda.getUTCDate() + 6);
  return { inicio: segunda, fim: domingo };
}

function aniversarioNaSemana(dataNasc: Date, inicio: Date, fim: Date): Date | null {
  const ano = inicio.getFullYear();
  // Tenta este ano
  for (const a of [ano, ano + 1]) {
    const aniv = new Date(Date.UTC(a, dataNasc.getUTCMonth(), dataNasc.getUTCDate()));
    if (aniv >= inicio && aniv <= fim) return aniv;
  }
  return null;
}

function calcularIdade(dataNasc: Date, anivEsteAno: Date): number {
  return anivEsteAno.getUTCFullYear() - dataNasc.getUTCFullYear();
}

function fmtData(d: Date) {
  return d.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", timeZone: "UTC" });
}

function whatsappUrl(numero: string) {
  return `https://wa.me/${numero.replace(/\D/g, "")}`;
}

const DIAS_PT: Record<number, string> = {
  0: "Domingo", 1: "Segunda-feira", 2: "Terça-feira",
  3: "Quarta-feira", 4: "Quinta-feira", 5: "Sexta-feira", 6: "Sábado",
};

const MESES_PT: Record<number, string> = {
  0: "Janeiro", 1: "Fevereiro", 2: "Março", 3: "Abril", 4: "Maio", 5: "Junho",
  6: "Julho", 7: "Agosto", 8: "Setembro", 9: "Outubro", 10: "Novembro", 11: "Dezembro",
};

export default async function AniversariantesPage() {
  const hoje = hojeEmBrasilia();
  const { inicio, fim } = semanaAtual(hoje);

  const alunos = await prisma.aluno.findMany({
    where: { dataNascimento: { not: null } },
    select: {
      id: true,
      nome: true,
      email: true,
      whatsapp: true,
      concurso: true,
      planoTipo: true,
      ativo: true,
      tutoryId: true,
      dataNascimento: true,
    },
    orderBy: { nome: "asc" },
  });

  type Aniversariante = {
    id: string;
    nome: string;
    email: string;
    whatsapp: string;
    concurso: string;
    planoTipo: string;
    ativo: boolean;
    tutoryId: number | null;
    dataNascimento: Date;
    anivDate: Date;
    idade: number;
    isHoje: boolean;
  };

  const aniversariantes: Aniversariante[] = [];

  for (const a of alunos) {
    if (!a.dataNascimento) continue;
    const anivDate = aniversarioNaSemana(a.dataNascimento, inicio, fim);
    if (!anivDate) continue;
    const isHoje =
      anivDate.getUTCDate() === hoje.dia &&
      anivDate.getUTCMonth() === hoje.mes - 1 &&
      anivDate.getUTCFullYear() === hoje.ano;
    aniversariantes.push({
      ...a,
      dataNascimento: a.dataNascimento,
      anivDate,
      idade: calcularIdade(a.dataNascimento, anivDate),
      isHoje,
    });
  }

  // Sort by day of week (birthday date), then name
  aniversariantes.sort((a, b) => {
    const diff = a.anivDate.getTime() - b.anivDate.getTime();
    if (diff !== 0) return diff;
    return a.nome.localeCompare(b.nome, "pt-BR");
  });

  const fmtSemana = `${inicio.toLocaleDateString("pt-BR")} – ${fim.toLocaleDateString("pt-BR")}`;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">🎂 Aniversariantes da Semana</h1>
        <p className="text-sm text-slate-500 mt-1">Semana de {fmtSemana}</p>
      </div>

      {aniversariantes.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center">
          <p className="text-3xl mb-2">🎈</p>
          <p className="text-slate-500 text-sm">Nenhum aniversariante esta semana.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {aniversariantes.map((a) => {
            const diaSemana = DIAS_PT[a.anivDate.getUTCDay()];
            const diaNum = String(a.anivDate.getUTCDate()).padStart(2, "0");
            const mes = MESES_PT[a.anivDate.getUTCMonth()];

            return (
              <div
                key={a.id}
                className={`bg-white rounded-xl border p-5 flex items-center gap-5 ${
                  a.isHoje ? "border-pink-300 bg-pink-50 shadow-sm" : "border-slate-200"
                }`}
              >
                {/* Day badge */}
                <div className={`flex-shrink-0 flex flex-col items-center justify-center rounded-xl w-16 h-16 ${
                  a.isHoje ? "bg-pink-500 text-white" : "bg-slate-100 text-slate-700"
                }`}>
                  <span className="text-xs font-semibold uppercase tracking-wide opacity-80">{diaSemana.slice(0, 3)}</span>
                  <span className="text-2xl font-bold leading-none">{diaNum}</span>
                  <span className="text-xs opacity-70">{mes.slice(0, 3)}</span>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link href={`/alunos/${a.id}`} className="text-base font-semibold text-slate-800 hover:text-blue-600 hover:underline">
                      {a.nome}
                    </Link>
                    {a.isHoje && (
                      <span className="text-xs bg-pink-500 text-white px-2 py-0.5 rounded-full font-semibold">🎉 Hoje!</span>
                    )}
                    {!a.ativo && (
                      <span className="text-xs bg-slate-200 text-slate-500 px-2 py-0.5 rounded-full">Inativo</span>
                    )}
                  </div>
                  <p className="text-sm text-slate-500 mt-0.5">
                    Faz <span className="font-semibold text-slate-700">{a.idade} anos</span>
                    {" · "}{diaSemana}, {diaNum} de {mes}
                  </p>
                  <div className="flex gap-2 mt-1 flex-wrap">
                    {a.concurso && (
                      <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full">{a.concurso}</span>
                    )}
                    {a.planoTipo && (
                      <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{a.planoTipo}</span>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  {a.whatsapp && (
                    <a
                      href={whatsappUrl(a.whatsapp)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 bg-green-500 hover:bg-green-600 text-white text-xs font-semibold px-3 py-2 rounded-lg transition"
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                      </svg>
                      WhatsApp
                    </a>
                  )}
                  <Link
                    href={`/alunos/${a.id}`}
                    className="text-xs bg-blue-50 text-blue-600 px-3 py-2 rounded-lg hover:bg-blue-100 transition"
                  >
                    Ver Perfil
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-slate-400 text-center pb-4">
        {aniversariantes.length} aniversariante{aniversariantes.length !== 1 ? "s" : ""} esta semana
        {" · "}Inclui alunos ativos e inativos
      </p>
    </div>
  );
}
