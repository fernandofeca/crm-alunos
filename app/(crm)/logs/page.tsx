"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

type Usuario = { id: string; name: string };
type LogEntry = {
  id: string;
  tipo: "usuario" | "sistema";
  acao: string;
  descricao: string;
  userId: string | null;
  user: { id: string; name: string } | null;
  alunoId: string | null;
  alunoNome: string | null;
  criadoEm: string;
};

// ─── config visual por ação ────────────────────────────────────────────────────

const ACAO_CONFIG: Record<string, { emoji: string; cor: string }> = {
  aluno_criado:        { emoji: "👤", cor: "bg-green-100 text-green-700" },
  aluno_atualizado:    { emoji: "✏️", cor: "bg-blue-100 text-blue-700" },
  aluno_editado:       { emoji: "✏️", cor: "bg-blue-100 text-blue-700" },
  aluno_excluido:      { emoji: "🗑️", cor: "bg-red-100 text-red-700" },
  contato_registrado:  { emoji: "💬", cor: "bg-indigo-100 text-indigo-700" },
  tarefa_criada:       { emoji: "✅", cor: "bg-green-100 text-green-700" },
  tarefa_concluida:    { emoji: "🎉", cor: "bg-green-100 text-green-700" },
  tarefa_reaberta:     { emoji: "↩️", cor: "bg-yellow-100 text-yellow-700" },
  tarefa_excluida:     { emoji: "🗑️", cor: "bg-red-100 text-red-700" },
  usuario_criado:      { emoji: "🧑‍💼", cor: "bg-purple-100 text-purple-700" },
  usuario_editado:     { emoji: "✏️", cor: "bg-purple-100 text-purple-700" },
  usuario_excluido:    { emoji: "🗑️", cor: "bg-red-100 text-red-700" },
  tutory_sync:         { emoji: "🔄", cor: "bg-sky-100 text-sky-700" },
  drive_sync:          { emoji: "📁", cor: "bg-sky-100 text-sky-700" },
  coaching_relatorio:  { emoji: "📊", cor: "bg-teal-100 text-teal-700" },
};

function acaoConfig(acao: string) {
  return ACAO_CONFIG[acao] ?? { emoji: "📋", cor: "bg-slate-100 text-slate-600" };
}

function formatarData(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function LogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filtroUsuario, setFiltroUsuario] = useState("");
  const [filtroTipo, setFiltroTipo] = useState<"" | "usuario" | "sistema">("");

  useEffect(() => {
    fetch("/api/usuarios").then((r) => r.json()).then(setUsuarios);
  }, []);

  useEffect(() => {
    buscar(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtroUsuario, filtroTipo]);

  async function buscar(p: number) {
    setLoading(true);
    const params = new URLSearchParams();
    if (filtroUsuario) params.set("userId", filtroUsuario);
    if (filtroTipo) params.set("tipo", filtroTipo);
    if (p > 0) params.set("page", String(p));
    const res = await fetch(`/api/logs?${params}`);
    if (res.ok) {
      const data = await res.json();
      setLogs(data.logs);
      setTotal(data.total);
      setPage(p);
    }
    setLoading(false);
  }

  const totalPages = Math.ceil(total / 50);

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-800">Log de Eventos</h1>
        <p className="text-sm text-slate-500">{total} evento(s) registrado(s)</p>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3 items-center">
        {/* Tipo */}
        <div className="flex gap-2">
          {([["", "Todos"], ["usuario", "👤 Usuário"], ["sistema", "⚙️ Sistema"]] as const).map(([v, label]) => (
            <button key={v} onClick={() => setFiltroTipo(v)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition ${
                filtroTipo === v ? "bg-blue-600 text-white border-blue-600" : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50"
              }`}>
              {label}
            </button>
          ))}
        </div>

        {/* Usuário */}
        {usuarios.length > 0 && (
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs text-slate-400">Por:</span>
            <button onClick={() => setFiltroUsuario("")}
              className={`px-3 py-1 rounded-lg text-xs font-medium border transition ${
                filtroUsuario === "" ? "bg-slate-700 text-white border-slate-700" : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50"
              }`}>
              Todos
            </button>
            {usuarios.map((u) => (
              <button key={u.id} onClick={() => setFiltroUsuario(filtroUsuario === u.id ? "" : u.id)}
                className={`px-3 py-1 rounded-lg text-xs font-medium border transition ${
                  filtroUsuario === u.id ? "bg-blue-600 text-white border-blue-600" : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50"
                }`}>
                {u.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {loading && <p className="text-sm text-slate-400">Carregando...</p>}

      {/* Lista */}
      <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
        {!loading && logs.length === 0 && (
          <div className="px-6 py-12 text-center text-slate-400 text-sm">
            Nenhum evento encontrado
          </div>
        )}
        {logs.map((log) => {
          const cfg = acaoConfig(log.acao);
          return (
            <div key={log.id} className="flex items-start gap-4 px-5 py-3.5 hover:bg-slate-50">
              {/* Ícone */}
              <span className={`mt-0.5 flex-shrink-0 text-base w-8 h-8 rounded-full flex items-center justify-center text-sm ${cfg.cor}`}>
                {cfg.emoji}
              </span>

              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-800">{log.descricao}</p>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-xs text-slate-400">
                  {/* Tipo badge */}
                  <span className={`font-medium px-1.5 py-0.5 rounded ${
                    log.tipo === "sistema" ? "bg-sky-50 text-sky-600" : "bg-slate-100 text-slate-500"
                  }`}>
                    {log.tipo === "sistema" ? "Sistema" : "Usuário"}
                  </span>

                  {/* Quem fez */}
                  {log.user && <span className="font-medium text-slate-500">{log.user.name}</span>}

                  {/* Aluno relacionado */}
                  {log.alunoId && log.alunoNome && (
                    <Link href={`/alunos/${log.alunoId}`} className="text-indigo-500 hover:underline">
                      {log.alunoNome}
                    </Link>
                  )}
                  {!log.alunoId && log.alunoNome && (
                    <span className="text-slate-400">{log.alunoNome}</span>
                  )}
                </div>
              </div>

              {/* Data */}
              <span className="flex-shrink-0 text-xs text-slate-400 whitespace-nowrap mt-0.5">
                {formatarData(log.criadoEm)}
              </span>
            </div>
          );
        })}
      </div>

      {/* Paginação */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-slate-400">
            Página {page + 1} de {totalPages}
          </p>
          <div className="flex gap-2">
            <button onClick={() => buscar(page - 1)} disabled={page === 0 || loading}
              className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition">
              ← Anterior
            </button>
            <button onClick={() => buscar(page + 1)} disabled={page >= totalPages - 1 || loading}
              className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition">
              Próxima →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
