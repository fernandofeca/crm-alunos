"use client";

import { useState } from "react";

type Status = "idle" | "loading" | "ok" | "erro";

interface Acao {
  label: string;
  descricao: string;
  url: string;
  method: "POST" | "GET";
  cor: string;
  corHover: string;
  icone: string;
}

const ACOES: Acao[] = [
  {
    label: "Sync Tutory",
    descricao: "Atualiza diasAtraso e taxaAcertos de todos os alunos",
    url: "/api/tutory/sync",
    method: "POST",
    cor: "bg-blue-600 text-white",
    corHover: "hover:bg-blue-700",
    icone: "🔄",
  },
  {
    label: "Retirar Atrasos",
    descricao: "Remove os atrasos de todos os alunos na Tutory",
    url: "/api/tutory/retirar-atrasos",
    method: "POST",
    cor: "bg-orange-500 text-white",
    corHover: "hover:bg-orange-600",
    icone: "🧹",
  },
  {
    label: "Replanejamento de Cronogramas",
    descricao: "Visita o painel de cada aluno atrasado para disparar o replanejamento automático",
    url: "/api/tutory/replanejamento-cronogramas",
    method: "POST",
    cor: "bg-indigo-600 text-white",
    corHover: "hover:bg-indigo-700",
    icone: "📅",
  },
  {
    label: "Relatório de Coaching",
    descricao: "Envia Estudos + Desempenho em Questões (4 meses · semanal) para todos os alunos",
    url: "/api/tutory/relatorio-coaching",
    method: "POST",
    cor: "bg-teal-600 text-white",
    corHover: "hover:bg-teal-700",
    icone: "📊",
  },
];

function ResultadoDetalhe({ dados }: { dados: Record<string, unknown> }) {
  const [aberto, setAberto] = useState(false);

  const resumo: string[] = [];
  if (typeof dados.salvos === "number") resumo.push(`${dados.salvos} alunos salvos`);
  if (typeof dados.replanejados === "number") resumo.push(`${dados.replanejados} replanejados`);
  if (typeof dados.total === "number") resumo.push(`${dados.total} alunos`);
  if (typeof dados.totalAlunos === "number") resumo.push(`${dados.totalAlunos} alunos`);
  if (typeof dados.emailsEnviados === "number") resumo.push(`${dados.emailsEnviados} emails enviados`);
  if (typeof dados.semUrl === "number" && dados.semUrl > 0)
    resumo.push(`⚠️ ${dados.semUrl} sem URL de painel`);
  if (typeof dados.executadoEm === "string") resumo.push(dados.executadoEm as string);
  if (typeof dados.msg === "string") resumo.push(dados.msg as string);

  return (
    <div className="mt-2 text-xs">
      {resumo.length > 0 && (
        <p className="text-green-700">{resumo.join(" · ")}</p>
      )}
      <button
        onClick={() => setAberto((v) => !v)}
        className="text-slate-400 hover:text-slate-600 underline mt-1"
      >
        {aberto ? "Ocultar detalhes" : "Ver resposta completa"}
      </button>
      {aberto && (
        <pre className="mt-2 bg-slate-50 border border-slate-200 rounded p-2 overflow-x-auto text-slate-600 text-xs max-h-48">
          {JSON.stringify(dados, null, 2)}
        </pre>
      )}
    </div>
  );
}

export default function AcoesTutory() {
  const [estados, setEstados] = useState<Record<string, Status>>({});
  const [resultados, setResultados] = useState<Record<string, Record<string, unknown>>>({});

  async function executar(acao: Acao) {
    setEstados((e) => ({ ...e, [acao.label]: "loading" }));
    setResultados((r) => {
      const copia = { ...r };
      delete copia[acao.label];
      return copia;
    });

    try {
      const res = await fetch(acao.url, { method: acao.method });
      const json = await res.json();
      setResultados((r) => ({ ...r, [acao.label]: json }));
      setEstados((e) => ({ ...e, [acao.label]: res.ok ? "ok" : "erro" }));
    } catch (e) {
      setResultados((r) => ({ ...r, [acao.label]: { error: String(e) } }));
      setEstados((e) => ({ ...e, [acao.label]: "erro" }));
    }
  }

  return (
    <div>
      <h2 className="text-base font-semibold text-slate-700 mb-3">Ações Tutory</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {ACOES.map((acao) => {
          const status = estados[acao.label] ?? "idle";
          const resultado = resultados[acao.label];

          return (
            <div
              key={acao.label}
              className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col gap-2"
            >
              <div className="flex items-center gap-2">
                <span className="text-xl">{acao.icone}</span>
                <span className="font-semibold text-slate-800 text-sm">{acao.label}</span>
              </div>
              <p className="text-xs text-slate-500 flex-1">{acao.descricao}</p>

              <button
                onClick={() => executar(acao)}
                disabled={status === "loading"}
                className={`w-full py-2 px-3 rounded-lg text-sm font-medium transition ${acao.cor} ${acao.corHover} disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {status === "loading" ? "Executando…" : "Executar"}
              </button>

              {status === "ok" && resultado && (
                <ResultadoDetalhe dados={resultado} />
              )}
              {status === "erro" && resultado && (
                <div className="mt-1 text-xs text-red-600">
                  Erro: {(resultado.error as string) ?? "Falha desconhecida"}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
