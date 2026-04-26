"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

// ─── tipos ───────────────────────────────────────────────────────────────────
type HistoricoItem = { ano: number; mes: number; produto: number; servico: number };

type DadosFinanceiro = {
  ano: number;
  mes: number;
  totalProduto: number;
  totalServico: number;
  totalGeral: number;
  qtdNfe: number;
  qtdNfse: number;
  historico: HistoricoItem[];
};

// ─── helpers ─────────────────────────────────────────────────────────────────
const MESES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function moeda(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function CardTotal({
  label, valor, qtd, cor, icone,
}: { label: string; valor: number; qtd: number; cor: string; icone: string }) {
  return (
    <div className={`rounded-2xl p-6 ${cor} flex flex-col gap-2`}>
      <div className="flex items-center gap-2">
        <span className="text-2xl">{icone}</span>
        <p className="text-sm font-semibold opacity-80">{label}</p>
      </div>
      <p className="text-3xl font-bold">{moeda(valor)}</p>
      <p className="text-xs opacity-70">{qtd} nota{qtd !== 1 ? "s" : ""} emitida{qtd !== 1 ? "s" : ""}</p>
    </div>
  );
}

// Barra simples de gráfico
function BarChart({ historico }: { historico: HistoricoItem[] }) {
  const max = Math.max(...historico.map((h) => h.produto + h.servico), 1);

  return (
    <div className="mt-6">
      <h2 className="text-sm font-semibold text-slate-600 mb-4">Faturamento — últimos 12 meses</h2>
      <div className="flex items-end gap-2 h-40">
        {historico.map((h, i) => {
          const total = h.produto + h.servico;
          const pct = (total / max) * 100;
          const pctProd = total > 0 ? (h.produto / total) * pct : 0;
          const pctServ = total > 0 ? (h.servico / total) * pct : 0;
          const isAtual = i === historico.length - 1;

          return (
            <div key={i} className="flex-1 flex flex-col items-center gap-1 group relative">
              {/* tooltip */}
              <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:flex flex-col items-center z-10 pointer-events-none">
                <div className="bg-slate-800 text-white text-xs rounded-lg px-3 py-2 whitespace-nowrap shadow-lg">
                  <p className="font-semibold">{MESES[h.mes].slice(0, 3)}/{h.ano}</p>
                  {h.produto > 0 && <p>Produto: {moeda(h.produto)}</p>}
                  {h.servico > 0 && <p>Serviço: {moeda(h.servico)}</p>}
                  <p className="font-semibold border-t border-slate-600 mt-1 pt-1">Total: {moeda(total)}</p>
                </div>
                <div className="w-2 h-2 bg-slate-800 rotate-45 -mt-1" />
              </div>

              {/* barra empilhada */}
              <div className="w-full flex flex-col justify-end rounded-t-md overflow-hidden" style={{ height: "120px" }}>
                {pctServ > 0 && (
                  <div
                    className="w-full bg-indigo-400"
                    style={{ height: `${pctServ}%` }}
                  />
                )}
                {pctProd > 0 && (
                  <div
                    className={`w-full ${isAtual ? "bg-blue-600" : "bg-blue-300"}`}
                    style={{ height: `${pctProd}%` }}
                  />
                )}
                {total === 0 && (
                  <div className="w-full bg-slate-100" style={{ height: "4px" }} />
                )}
              </div>

              <p className={`text-xs ${isAtual ? "font-bold text-slate-700" : "text-slate-400"}`}>
                {MESES[h.mes].slice(0, 3)}
              </p>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-4 mt-3">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-blue-400" />
          <span className="text-xs text-slate-500">NF Produto</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 rounded-sm bg-indigo-400" />
          <span className="text-xs text-slate-500">NF Serviço</span>
        </div>
      </div>
    </div>
  );
}

// ─── página ───────────────────────────────────────────────────────────────────
export default function FinanceiroPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const now = new Date();
  const [ano,  setAno]  = useState(now.getFullYear());
  const [mes,  setMes]  = useState(now.getMonth());
  const [dados, setDados] = useState<DadosFinanceiro | null>(null);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState("");

  const buscar = useCallback(async (a: number, m: number) => {
    setLoading(true);
    setErro("");
    try {
      const res = await fetch(`/api/diginfe/financeiro?year=${a}&month=${m}`);
      const json = await res.json() as DadosFinanceiro & { error?: string };
      if (!res.ok) {
        if (res.status === 403) {
          setErro("Acesso restrito.");
        } else {
          setErro(json.error ?? "Erro desconhecido");
        }
      } else {
        setDados(json);
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status === "authenticated") buscar(ano, mes);
  }, [status, ano, mes, buscar]);

  // Navega entre meses
  function navMes(delta: number) {
    let m = mes + delta;
    let a = ano;
    if (m < 0)  { m = 11; a--; }
    if (m > 11) { m = 0;  a++; }
    setMes(m);
    setAno(a);
  }

  if (status === "loading") {
    return <div className="text-sm text-slate-400 p-10">Carregando…</div>;
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* cabeçalho */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">💰 Dashboard Financeiro</h1>
          <p className="text-sm text-slate-500 mt-1">Faturamento via Diginfe — dados em tempo real</p>
        </div>

        {/* seletor de mês */}
        <div className="flex items-center gap-2 bg-white border border-slate-200 rounded-xl px-4 py-2">
          <button
            onClick={() => navMes(-1)}
            className="text-slate-400 hover:text-slate-700 transition px-1"
          >
            ‹
          </button>
          <span className="text-sm font-semibold text-slate-700 w-36 text-center">
            {MESES[mes]} {ano}
          </span>
          <button
            onClick={() => navMes(1)}
            disabled={ano === now.getFullYear() && mes === now.getMonth()}
            className="text-slate-400 hover:text-slate-700 transition px-1 disabled:opacity-30"
          >
            ›
          </button>
        </div>
      </div>

      {/* erro de acesso */}
      {erro === "Acesso restrito." && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
          <p className="text-2xl mb-2">🔒</p>
          <p className="text-sm font-semibold text-red-700">Acesso restrito</p>
          <p className="text-xs text-red-500 mt-1">Esta página é exclusiva para administradores financeiros.</p>
        </div>
      )}

      {/* erro genérico */}
      {erro && erro !== "Acesso restrito." && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          ⚠️ {erro}
        </div>
      )}

      {/* loading */}
      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-36 rounded-2xl bg-slate-100 animate-pulse" />
          ))}
        </div>
      )}

      {/* cards */}
      {!loading && dados && !erro && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* coluna produto */}
            <div className="flex flex-col gap-2">
              <CardTotal
                label="Total NF Produto"
                valor={dados.totalProduto}
                qtd={dados.qtdNfe}
                cor="bg-sky-50 text-sky-800 border border-sky-200"
                icone="📦"
              />
              <div className="rounded-xl px-4 py-3 bg-sky-100 border border-sky-200 text-sky-800 flex items-center justify-between">
                <span className="text-xs font-semibold opacity-70">🧾 Imposto sobre Produto <span className="opacity-50">(6,197%)</span></span>
                <span className="text-sm font-bold">{moeda(dados.totalProduto * 0.06197)}</span>
              </div>
            </div>

            {/* coluna serviço */}
            <div className="flex flex-col gap-2">
              <CardTotal
                label="Total NF Serviço"
                valor={dados.totalServico}
                qtd={dados.qtdNfse}
                cor="bg-indigo-50 text-indigo-800 border border-indigo-200"
                icone="🛠️"
              />
              <div className="rounded-xl px-4 py-3 bg-indigo-100 border border-indigo-200 text-indigo-800 flex items-center justify-between">
                <span className="text-xs font-semibold opacity-70">🧾 Imposto sobre Serviço <span className="opacity-50">(14%)</span></span>
                <span className="text-sm font-bold">{moeda(dados.totalServico * 0.14)}</span>
              </div>
            </div>

            {/* coluna total */}
            <div className="flex flex-col gap-2">
              <CardTotal
                label="Faturamento Total"
                valor={dados.totalGeral}
                qtd={dados.qtdNfe + dados.qtdNfse}
                cor="bg-emerald-50 text-emerald-800 border border-emerald-200"
                icone="💰"
              />
              <div className="rounded-xl px-4 py-3 bg-red-50 border border-red-200 text-red-800 flex items-center justify-between">
                <span className="text-xs font-semibold opacity-70">🧾 Imposto a Pagar</span>
                <span className="text-sm font-bold">{moeda(dados.totalProduto * 0.06197 + dados.totalServico * 0.14)}</span>
              </div>
            </div>
          </div>

          {/* gráfico */}
          <div className="bg-white rounded-2xl border border-slate-200 p-6">
            <BarChart historico={dados.historico} />
          </div>

          {/* link */}
          <div className="text-right">
            <a
              href="https://app.diginfe.com.br/#/notas-fiscais"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:underline"
            >
              Abrir Diginfe →
            </a>
          </div>
        </>
      )}
    </div>
  );
}
