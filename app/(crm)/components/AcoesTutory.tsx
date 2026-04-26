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
  /** Se true, encadeia chamadas com ?offset= até timedOut=false */
  autoContinue?: boolean;
}

const ACOES: Acao[] = [
  {
    label: "Sync Tutory",
    descricao: "Atualiza diasAtraso, taxaAcertos e vincula IDs faltantes via relatórios de curso",
    url: "/api/tutory/sync",
    method: "POST",
    cor: "bg-blue-600 text-white",
    corHover: "hover:bg-blue-700",
    icone: "🔄",
    autoContinue: true,
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
  if (typeof dados.salvos === "number") resumo.push(`${dados.salvos} alunos atualizados`);
  if (typeof dados.criados === "number" && dados.criados > 0) resumo.push(`${dados.criados} criados`);
  if (typeof dados.total === "number") resumo.push(`${dados.total} ativos na Tutory`);
  if (typeof dados.totalAlunos === "number") resumo.push(`${dados.totalAlunos} alunos`);
  if (typeof dados.emailsEnviados === "number") resumo.push(`${dados.emailsEnviados} emails enviados`);
  if (typeof dados.replanejados === "number") resumo.push(`${dados.replanejados} replanejados`);
  if (typeof dados.concursosAtualizados === "number" && dados.concursosAtualizados > 0)
    resumo.push(`${dados.concursosAtualizados} concursos atualizados`);
  if (typeof dados.vinculados === "number" && dados.vinculados > 0)
    resumo.push(`${dados.vinculados} IDs vinculados`);
  if (typeof dados.cursosComDados === "number")
    resumo.push(`${dados.cursosComDados} cursos processados`);
  if (typeof dados.totalCursosDisponiveis === "number")
    resumo.push(`de ${dados.totalCursosDisponiveis}`);
  if (typeof dados.semUrl === "number" && dados.semUrl > 0)
    resumo.push(`⚠️ ${dados.semUrl} sem URL de painel`);
  if (typeof dados.msg === "string") resumo.push(dados.msg as string);

  return (
    <div className="mt-2 text-xs">
      {resumo.length > 0 && <p className="text-green-700">{resumo.join(" · ")}</p>}
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
  const [progresso, setProgresso] = useState<Record<string, string>>({});

  async function executar(acao: Acao) {
    setEstados((e) => ({ ...e, [acao.label]: "loading" }));
    setResultados((r) => { const c = { ...r }; delete c[acao.label]; return c; });
    setProgresso((p) => { const c = { ...p }; delete c[acao.label]; return c; });

    try {
      if (acao.autoContinue) {
        // Primeira chamada: sync completo (offset=0 ativa vinculação)
        // Chamadas seguintes: apenas continua varredura de cursos (offset>0)
        setProgresso((p) => ({ ...p, [acao.label]: "Sincronizando Tutory…" }));
        const res0 = await fetch(`${acao.url}?offset=0`, { method: acao.method });
        const json0 = await res0.json() as Record<string, unknown>;

        if (!res0.ok) {
          setResultados((r) => ({ ...r, [acao.label]: json0 }));
          setEstados((e) => ({ ...e, [acao.label]: "erro" }));
          setProgresso((p) => { const c = { ...p }; delete c[acao.label]; return c; });
          return;
        }

        // Acumula resultados ao longo das chamadas
        let totalVinculados       = (json0.vinculados       as number) ?? 0;
        let totalCursosComDados   = (json0.cursosComDados   as number) ?? 0;
        let totalCursosSemDados   = (json0.cursosSemDados   as number) ?? 0;
        let totalCursosDisponiveis = (json0.totalCursosDisponiveis as number) ?? 0;
        const dadosSync = {
          salvos:  (json0.salvos  as number) ?? (json0.atualizados as number) ?? 0,
          criados: (json0.criados as number) ?? 0,
          total:   (json0.total   as number) ?? 0,
        };

        let offset     = (json0.proximoOffset as number) ?? 0;
        let timedOut   = (json0.timedOut as boolean) ?? false;

        // Continua varrendo cursos enquanto houver timeout e ainda existirem cursos
        while (timedOut && offset < totalCursosDisponiveis) {
          setProgresso((p) => ({
            ...p,
            [acao.label]: `Vinculando IDs… (curso ${offset} de ${totalCursosDisponiveis})`,
          }));

          const res = await fetch(`${acao.url}?offset=${offset}`, { method: acao.method });
          const json = await res.json() as Record<string, unknown>;

          if (!res.ok) break;

          totalVinculados       += (json.vinculados       as number) ?? 0;
          totalCursosComDados   += (json.cursosComDados   as number) ?? 0;
          totalCursosSemDados   += (json.cursosSemDados   as number) ?? 0;
          totalCursosDisponiveis = (json.totalCursosDisponiveis as number) ?? totalCursosDisponiveis;
          offset    = (json.proximoOffset as number) ?? offset;
          timedOut  = (json.timedOut as boolean) ?? false;
        }

        setResultados((r) => ({
          ...r,
          [acao.label]: {
            ok: true,
            ...dadosSync,
            vinculados: totalVinculados,
            cursosComDados: totalCursosComDados,
            cursosSemDados: totalCursosSemDados,
            totalCursosDisponiveis,
          },
        }));
        setEstados((e) => ({ ...e, [acao.label]: "ok" }));
        setProgresso((p) => { const c = { ...p }; delete c[acao.label]; return c; });
      } else {
        // Chamada simples
        const res = await fetch(acao.url, { method: acao.method });
        const json = await res.json();
        setResultados((r) => ({ ...r, [acao.label]: json }));
        setEstados((e) => ({ ...e, [acao.label]: res.ok ? "ok" : "erro" }));
      }
    } catch (e) {
      setResultados((r) => ({ ...r, [acao.label]: { error: String(e) } }));
      setEstados((e) => ({ ...e, [acao.label]: "erro" }));
      setProgresso((p) => { const c = { ...p }; delete c[acao.label]; return c; });
    }
  }

  return (
    <div>
      <h2 className="text-base font-semibold text-slate-700 mb-3">Ações Tutory</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {ACOES.map((acao) => {
          const status    = estados[acao.label] ?? "idle";
          const resultado = resultados[acao.label];
          const prog      = progresso[acao.label];

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

              {status === "loading" && prog && (
                <p className="text-xs text-slate-500 animate-pulse">{prog}</p>
              )}

              {status === "ok" && resultado && <ResultadoDetalhe dados={resultado} />}
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
