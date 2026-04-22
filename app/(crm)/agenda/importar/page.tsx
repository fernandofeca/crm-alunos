"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";

type Resultado = { total: number; criados: number; ignorados: number; erros: number };

export default function ImportarAgendaPage() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [aba, setAba] = useState<"arquivo" | "url">("arquivo");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [arrastando, setArrastando] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [erro, setErro] = useState("");

  function onArquivo(file: File) {
    if (!file.name.toLowerCase().endsWith(".ics")) {
      setErro("Use um arquivo .ics exportado do Google Agenda.");
      return;
    }
    setArquivo(file);
    setResultado(null);
    setErro("");
  }

  async function importar() {
    setLoading(true);
    setErro("");
    setResultado(null);

    let res: Response;
    if (aba === "arquivo" && arquivo) {
      const form = new FormData();
      form.append("file", arquivo);
      res = await fetch("/api/agenda/importar", { method: "POST", body: form });
    } else {
      if (!url.trim()) { setErro("Cole a URL do feed iCal."); setLoading(false); return; }
      res = await fetch("/api/agenda/importar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
    }

    const data = await res.json();
    setLoading(false);
    if (!res.ok) { setErro(data.error ?? "Erro ao importar."); return; }
    setResultado(data);
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <button onClick={() => router.back()} className="text-sm text-slate-500 hover:underline mb-4 block">
          ← Voltar
        </button>
        <h1 className="text-2xl font-bold text-slate-800">Importar do Google Agenda</h1>
        <p className="text-sm text-slate-500 mt-1">
          Traga seus eventos existentes do Google Agenda para o CRM.
        </p>
      </div>

      {/* Abas */}
      <div className="flex border-b border-slate-200">
        {([["arquivo", "📁 Arquivo .ics"], ["url", "🔗 URL do feed"]] as const).map(([v, label]) => (
          <button key={v} onClick={() => { setAba(v); setErro(""); setResultado(null); }}
            className={`px-5 py-2.5 text-sm font-medium border-b-2 transition -mb-px ${
              aba === v ? "border-blue-600 text-blue-600" : "border-transparent text-slate-500 hover:text-slate-700"
            }`}>
            {label}
          </button>
        ))}
      </div>

      {/* Aba arquivo */}
      {aba === "arquivo" && (
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-2">
            <p className="text-sm font-semibold text-blue-800">Como exportar do Google Agenda</p>
            <ol className="text-sm text-blue-700 space-y-1 list-decimal list-inside">
              <li>Acesse <strong>Google Agenda</strong> no computador</li>
              <li>Clique em <strong>⚙ Configurações</strong> → <strong>Importar e exportar</strong></li>
              <li>Clique em <strong>Exportar</strong> — baixa um arquivo .zip</li>
              <li>Descompacte o .zip e você terá um ou mais arquivos <strong>.ics</strong></li>
              <li>Faça o upload de cada arquivo .ics aqui</li>
            </ol>
          </div>

          <div
            onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
            onDragLeave={() => setArrastando(false)}
            onDrop={(e) => { e.preventDefault(); setArrastando(false); const f = e.dataTransfer.files[0]; if (f) onArquivo(f); }}
            onClick={() => inputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition ${
              arrastando ? "border-blue-400 bg-blue-50" : "border-slate-300 bg-white hover:border-blue-400 hover:bg-slate-50"
            }`}
          >
            <input ref={inputRef} type="file" accept=".ics" className="hidden"
              onChange={(e) => { if (e.target.files?.[0]) onArquivo(e.target.files[0]); }} />
            <div className="flex flex-col items-center gap-3">
              <svg className="w-10 h-10 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              {arquivo ? (
                <div>
                  <p className="font-semibold text-slate-700">{arquivo.name}</p>
                  <p className="text-sm text-slate-400">{(arquivo.size / 1024).toFixed(1)} KB</p>
                </div>
              ) : (
                <div>
                  <p className="font-medium text-slate-600">Arraste o arquivo .ics ou clique para selecionar</p>
                  <p className="text-sm text-slate-400 mt-1">Exportado do Google Agenda</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Aba URL */}
      {aba === "url" && (
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-2">
            <p className="text-sm font-semibold text-blue-800">Como obter a URL do feed privado</p>
            <ol className="text-sm text-blue-700 space-y-1 list-decimal list-inside">
              <li>Acesse <strong>Google Agenda</strong> no computador</li>
              <li>No menu lateral, passe o mouse sobre o calendário desejado</li>
              <li>Clique nos <strong>três pontos ⋮</strong> → <strong>Configurações e compartilhamento</strong></li>
              <li>Role até <strong>&quot;Integrar agenda&quot;</strong></li>
              <li>Copie o <strong>&quot;Endereço secreto no formato iCal&quot;</strong></li>
              <li>Cole abaixo e clique em Importar</li>
            </ol>
            <p className="text-xs text-blue-600 mt-1">
              ⚠ Esta URL dá acesso aos seus eventos. Não a compartilhe publicamente.
            </p>
          </div>

          <div>
            <label className="text-sm font-medium text-slate-700 block mb-1">URL do feed iCal</label>
            <input type="url" value={url} onChange={(e) => setUrl(e.target.value)}
              placeholder="https://calendar.google.com/calendar/ical/..."
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
      )}

      {erro && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-600">{erro}</div>
      )}

      {resultado && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-5 space-y-3">
          <p className="font-semibold text-green-800">Importação concluída!</p>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-2xl font-bold text-green-700">{resultado.criados}</p>
              <p className="text-xs text-green-600">Criados</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-500">{resultado.ignorados}</p>
              <p className="text-xs text-slate-400">Já existiam</p>
            </div>
            <div>
              <p className="text-2xl font-bold text-red-500">{resultado.erros}</p>
              <p className="text-xs text-red-400">Erros</p>
            </div>
          </div>
          <button onClick={() => router.push("/agenda")}
            className="bg-green-600 hover:bg-green-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition">
            Ver agenda
          </button>
        </div>
      )}

      <div className="flex gap-3">
        <button onClick={importar} disabled={loading || (aba === "arquivo" && !arquivo)}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-6 py-2.5 rounded-lg transition disabled:opacity-40">
          {loading ? "Importando..." : "Importar eventos"}
        </button>
        {(arquivo || url) && !loading && (
          <button onClick={() => { setArquivo(null); setUrl(""); setResultado(null); setErro(""); }}
            className="text-sm text-slate-500 hover:underline">
            Limpar
          </button>
        )}
      </div>
    </div>
  );
}
