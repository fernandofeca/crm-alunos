"use client";

import { useState, useEffect } from "react";

type Aluno = { id: string; nome: string };
type Tarefa = {
  id: string;
  titulo: string;
  descricao: string;
  concluida: boolean;
  prioridade: string;
  dataVencimento: string | null;
  aluno: Aluno | null;
  user: { name: string };
  createdAt: string;
};

const PRIORIDADE_COR: Record<string, string> = {
  alta:  "bg-red-100 text-red-700 border-red-200",
  media: "bg-yellow-100 text-yellow-700 border-yellow-200",
  baixa: "bg-green-100 text-green-700 border-green-200",
};
const PRIORIDADE_LABEL: Record<string, string> = {
  alta: "Alta", media: "Média", baixa: "Baixa",
};

function vencimentoBadge(dataStr: string | null) {
  if (!dataStr) return null;
  const hoje = new Date(); hoje.setHours(0,0,0,0);
  const d = new Date(dataStr); d.setHours(0,0,0,0);
  const diff = Math.round((d.getTime() - hoje.getTime()) / 86400000);
  if (diff < 0) return <span className="text-xs text-red-500 font-medium">Vencida</span>;
  if (diff === 0) return <span className="text-xs text-orange-500 font-medium">Hoje</span>;
  if (diff <= 3) return <span className="text-xs text-yellow-600 font-medium">Em {diff}d</span>;
  return <span className="text-xs text-slate-400">{new Date(dataStr).toLocaleDateString("pt-BR")}</span>;
}

export default function TarefasPage() {
  const [tarefas, setTarefas] = useState<Tarefa[]>([]);
  const [alunos, setAlunos] = useState<Aluno[]>([]);
  const [filtro, setFiltro] = useState<"todas" | "pendentes" | "concluidas">("pendentes");
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ titulo: "", descricao: "", prioridade: "media", dataVencimento: "", alunoId: "" });
  const [salvando, setSalvando] = useState(false);
  const [mostrarForm, setMostrarForm] = useState(false);

  useEffect(() => { carregar(); carregarAlunos(); }, []);

  async function carregar() {
    setLoading(true);
    const res = await fetch("/api/tarefas");
    if (res.ok) setTarefas(await res.json());
    setLoading(false);
  }

  async function carregarAlunos() {
    const res = await fetch("/api/alunos?ativo=true&page=0");
    if (res.ok) { const d = await res.json(); setAlunos(d.alunos ?? []); }
  }

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    if (!form.titulo.trim()) return;
    setSalvando(true);
    const res = await fetch("/api/tarefas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (res.ok) {
      const nova = await res.json();
      setTarefas((prev) => [nova, ...prev]);
      setForm({ titulo: "", descricao: "", prioridade: "media", dataVencimento: "", alunoId: "" });
      setMostrarForm(false);
    }
    setSalvando(false);
  }

  async function toggleConcluida(t: Tarefa) {
    const res = await fetch(`/api/tarefas/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ concluida: !t.concluida }),
    });
    if (res.ok) {
      const atualizada = await res.json();
      setTarefas((prev) => prev.map((x) => (x.id === t.id ? atualizada : x)));
    }
  }

  async function excluir(id: string) {
    if (!confirm("Excluir esta tarefa?")) return;
    await fetch(`/api/tarefas/${id}`, { method: "DELETE" });
    setTarefas((prev) => prev.filter((t) => t.id !== id));
  }

  const visiveis = tarefas.filter((t) =>
    filtro === "todas" ? true : filtro === "pendentes" ? !t.concluida : t.concluida
  );

  const counts = {
    pendentes: tarefas.filter((t) => !t.concluida).length,
    concluidas: tarefas.filter((t) => t.concluida).length,
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Tarefas</h1>
          <p className="text-sm text-slate-500">{counts.pendentes} pendente(s) · {counts.concluidas} concluída(s)</p>
        </div>
        <button
          onClick={() => setMostrarForm((v) => !v)}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
        >
          + Nova tarefa
        </button>
      </div>

      {mostrarForm && (
        <form onSubmit={criar} className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-slate-700">Nova tarefa</h2>
          <input
            autoFocus
            type="text"
            placeholder="Título da tarefa *"
            value={form.titulo}
            onChange={(e) => setForm((p) => ({ ...p, titulo: e.target.value }))}
            required
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <textarea
            placeholder="Descrição (opcional)"
            value={form.descricao}
            onChange={(e) => setForm((p) => ({ ...p, descricao: e.target.value }))}
            rows={2}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Prioridade</label>
              <select
                value={form.prioridade}
                onChange={(e) => setForm((p) => ({ ...p, prioridade: e.target.value }))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="baixa">Baixa</option>
                <option value="media">Média</option>
                <option value="alta">Alta</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Vencimento</label>
              <input
                type="date"
                value={form.dataVencimento}
                onChange={(e) => setForm((p) => ({ ...p, dataVencimento: e.target.value }))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Aluno (opcional)</label>
              <select
                value={form.alunoId}
                onChange={(e) => setForm((p) => ({ ...p, alunoId: e.target.value }))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">— Nenhum —</option>
                {alunos.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2">
            <button type="submit" disabled={salvando}
              className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50 transition">
              {salvando ? "Salvando..." : "Criar tarefa"}
            </button>
            <button type="button" onClick={() => setMostrarForm(false)}
              className="text-sm text-slate-500 hover:underline px-2">
              Cancelar
            </button>
          </div>
        </form>
      )}

      {/* Filtros */}
      <div className="flex gap-2">
        {(["pendentes", "concluidas", "todas"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFiltro(f)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition capitalize ${
              filtro === f ? "bg-blue-600 text-white border-blue-600" : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50"
            }`}
          >
            {f === "pendentes" ? `Pendentes (${counts.pendentes})` : f === "concluidas" ? `Concluídas (${counts.concluidas})` : "Todas"}
          </button>
        ))}
      </div>

      {loading && <p className="text-sm text-slate-400">Carregando...</p>}

      <div className="space-y-2">
        {visiveis.length === 0 && !loading && (
          <div className="bg-white rounded-xl border border-slate-200 px-5 py-10 text-center text-slate-400 text-sm">
            Nenhuma tarefa {filtro === "pendentes" ? "pendente" : filtro === "concluidas" ? "concluída" : ""}
          </div>
        )}
        {visiveis.map((t) => (
          <div
            key={t.id}
            className={`bg-white rounded-xl border px-5 py-4 flex gap-4 items-start transition ${
              t.concluida ? "border-slate-100 opacity-60" : "border-slate-200"
            }`}
          >
            <button
              onClick={() => toggleConcluida(t)}
              className={`mt-0.5 w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition ${
                t.concluida ? "bg-green-500 border-green-500 text-white" : "border-slate-300 hover:border-blue-400"
              }`}
            >
              {t.concluida && (
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`text-sm font-medium ${t.concluida ? "line-through text-slate-400" : "text-slate-800"}`}>
                  {t.titulo}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded-full border ${PRIORIDADE_COR[t.prioridade]}`}>
                  {PRIORIDADE_LABEL[t.prioridade]}
                </span>
                {vencimentoBadge(t.dataVencimento)}
              </div>
              {t.descricao && <p className="text-xs text-slate-500 mt-0.5 truncate">{t.descricao}</p>}
              <div className="flex gap-3 mt-1 text-xs text-slate-400">
                {t.aluno && (
                  <span className="text-indigo-500">
                    <a href={`/alunos/${t.aluno.id}`} className="hover:underline">{t.aluno.nome}</a>
                  </span>
                )}
                <span>{t.user.name}</span>
              </div>
            </div>
            <button onClick={() => excluir(t.id)} className="text-slate-300 hover:text-red-400 transition flex-shrink-0 mt-0.5" title="Excluir">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
