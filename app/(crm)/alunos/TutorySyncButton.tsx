"use client";

import { useState } from "react";

type Resultado = { criados: number; atualizados: number; total: number; erros: string[]; error?: string; diasAtrasoDebug?: string; questoesDebug?: string };

export default function TutorySyncButton({ onSync }: { onSync?: () => void }) {
  const [loading, setLoading] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  async function sincronizar() {
    setLoading(true);
    setResultado(null);
    try {
      const res = await fetch("/api/tutory/sync", { method: "POST" });
      const data = await res.json();
      setResultado(data);
      if (!data.error && onSync) onSync();
    } catch {
      setResultado({ criados: 0, atualizados: 0, total: 0, erros: [], error: "Falha na conexão." });
    }
    setLoading(false);
  }

  return (
    <>
      <button
        onClick={sincronizar}
        disabled={loading}
        className="flex items-center gap-2 border border-indigo-300 text-indigo-700 hover:bg-indigo-50 text-sm font-semibold px-4 py-2 rounded-lg transition disabled:opacity-50"
      >
        <svg className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        {loading ? "Sincronizando..." : "Sync Tutory"}
      </button>

      {resultado && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6">
            {resultado.error ? (
              <>
                <p className="text-red-600 font-semibold mb-2">Erro na sincronização</p>
                <p className="text-sm text-slate-600">{resultado.error}</p>
              </>
            ) : (
              <>
                <p className="text-lg font-bold text-slate-800 mb-4">Sync Tutory concluído</p>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Total Tutory</span>
                    <span className="font-semibold">{resultado.total}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Criados no CRM</span>
                    <span className="font-semibold text-green-600">+{resultado.criados}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Atualizados</span>
                    <span className="font-semibold text-blue-600">{resultado.atualizados}</span>
                  </div>
                  {resultado.diasAtrasoDebug && (
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-500 shrink-0">Atrasos</span>
                      <span className="font-semibold text-xs text-slate-600 text-right">{resultado.diasAtrasoDebug}</span>
                    </div>
                  )}
                  {resultado.questoesDebug && (
                    <div className="flex justify-between gap-2">
                      <span className="text-slate-500 shrink-0">Questões</span>
                      <span className="font-semibold text-xs text-slate-600 text-right">{resultado.questoesDebug}</span>
                    </div>
                  )}
                  {resultado.erros.length > 0 && (
                    <div className="mt-3 p-3 bg-red-50 rounded-lg">
                      <p className="text-xs font-semibold text-red-600 mb-1">
                        {resultado.erros.length} erro(s):
                      </p>
                      <ul className="text-xs text-red-500 space-y-0.5 max-h-24 overflow-y-auto">
                        {resultado.erros.map((e, i) => <li key={i}>{e}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              </>
            )}
            <button
              onClick={() => setResultado(null)}
              className="mt-5 w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold py-2 rounded-lg transition"
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </>
  );
}
