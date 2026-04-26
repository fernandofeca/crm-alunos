"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

// ─── tipos ────────────────────────────────────────────────────────────────────

type ColunasDetectadas = { colNome: string; colEmail: string; colCpf: string; colCelular: string; colConcurso: string; colStatus: string; colVencimento: string };
type ResultadoImport = { criados: number; atualizados: number; erros: string[]; colunas_detectadas?: ColunasDetectadas };

// ─── componente de área de upload reutilizável ────────────────────────────────

function UploadArea({ arquivo, onChange }: { arquivo: File | null; onChange: (f: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [arrastando, setArrastando] = useState(false);

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setArrastando(false);
    const file = e.dataTransfer.files[0];
    if (file) onChange(file);
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
      onDragLeave={() => setArrastando(false)}
      onDrop={onDrop}
      onClick={() => inputRef.current?.click()}
      className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition ${
        arrastando ? "border-blue-400 bg-blue-50" : "border-slate-300 bg-white hover:border-blue-400 hover:bg-slate-50"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".xls,.xlsx"
        className="hidden"
        onChange={(e) => { if (e.target.files?.[0]) onChange(e.target.files[0]); }}
      />
      <div className="flex flex-col items-center gap-2">
        <svg className="w-10 h-10 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        {arquivo ? (
          <div>
            <p className="font-semibold text-slate-700">{arquivo.name}</p>
            <p className="text-xs text-slate-400">{(arquivo.size / 1024).toFixed(1)} KB</p>
          </div>
        ) : (
          <div>
            <p className="font-medium text-slate-600 text-sm">Arraste o arquivo aqui ou clique para selecionar</p>
            <p className="text-xs text-slate-400 mt-1">Suporta .xls e .xlsx</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── seção 1: importar alunos ─────────────────────────────────────────────────

function ImportarAlunos() {
  const router = useRouter();
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [resultado, setResultado] = useState<ResultadoImport | null>(null);
  const [erro, setErro] = useState("");

  function onArquivo(file: File) {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["xls", "xlsx", "csv"].includes(ext ?? "")) {
      setErro("Formato inválido. Use .xls, .xlsx ou .csv");
      return;
    }
    setArquivo(file);
    setResultado(null);
    setErro("");
  }

  async function importar() {
    if (!arquivo) return;
    setLoading(true);
    setErro("");
    setResultado(null);
    const form = new FormData();
    form.append("file", arquivo);
    const res = await fetch("/api/alunos/importar", { method: "POST", body: form });
    const data = await res.json();
    setLoading(false);
    if (!res.ok) { setErro(data.error ?? "Erro ao importar."); return; }
    setResultado(data);
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-800">Importar Alunos</h2>
        <p className="text-sm text-slate-500 mt-0.5">
          Planilha com colunas: <span className="font-medium text-slate-700">Nome, Email, CPF, Celular, Concurso, Vencimento do Plano, Status</span>
        </p>
      </div>

      <UploadArea arquivo={arquivo} onChange={onArquivo} />

      {erro && <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-600">{erro}</div>}

      {resultado && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-3">
          <p className="font-semibold text-green-800">Importação concluída!</p>
          <div className="flex gap-6 text-sm">
            <div><span className="text-2xl font-bold text-green-700">{resultado.criados}</span><p className="text-green-600">Criados</p></div>
            <div><span className="text-2xl font-bold text-blue-700">{resultado.atualizados}</span><p className="text-blue-600">Atualizados</p></div>
          </div>
          {resultado.colunas_detectadas && (
            <div className="bg-white rounded border border-green-200 p-3 text-xs grid grid-cols-2 gap-1">
              {Object.entries({
                Nome: resultado.colunas_detectadas.colNome,
                Email: resultado.colunas_detectadas.colEmail,
                CPF: resultado.colunas_detectadas.colCpf,
                Celular: resultado.colunas_detectadas.colCelular,
                Concurso: resultado.colunas_detectadas.colConcurso,
                Status: resultado.colunas_detectadas.colStatus,
                Vencimento: resultado.colunas_detectadas.colVencimento,
              }).map(([label, valor]) => (
                <div key={label} className="flex gap-1">
                  <span className="text-slate-400">{label}:</span>
                  <span className={valor ? "text-green-700 font-medium" : "text-red-400"}>{valor || "não encontrado"}</span>
                </div>
              ))}
            </div>
          )}
          {resultado.erros.length > 0 && (
            <div className="bg-red-50 rounded border border-red-200 p-3">
              <p className="text-xs font-semibold text-red-600 mb-1">{resultado.erros.length} linha(s) com erro:</p>
              <ul className="text-xs text-red-500 space-y-0.5 max-h-36 overflow-y-auto">
                {resultado.erros.slice(0, 15).map((e, i) => <li key={i}>• {e}</li>)}
              </ul>
            </div>
          )}
          <button onClick={() => router.push("/alunos")}
            className="bg-green-600 hover:bg-green-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition">
            Ver alunos
          </button>
        </div>
      )}

      <div className="flex gap-3">
        <button onClick={importar} disabled={!arquivo || loading}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-5 py-2 rounded-lg transition disabled:opacity-40">
          {loading ? "Importando..." : "Importar planilha"}
        </button>
        {arquivo && !loading && (
          <button onClick={() => { setArquivo(null); setResultado(null); setErro(""); }}
            className="text-sm text-slate-500 hover:underline">Limpar</button>
        )}
      </div>
    </div>
  );
}

// ─── página ───────────────────────────────────────────────────────────────────

export default function ImportarPage() {
  const router = useRouter();

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <button onClick={() => router.back()} className="text-sm text-slate-500 hover:underline mb-4 block">
          ← Voltar
        </button>
        <h1 className="text-2xl font-bold text-slate-800">Importar Alunos</h1>
        <p className="text-sm text-slate-500 mt-1">Importe alunos em massa via planilha XLS.</p>
      </div>

      <ImportarAlunos />
    </div>
  );
}
