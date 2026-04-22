"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

type Usuario = { id: string; name: string };
type Aluno = { id: string; nome: string };
type Tarefa = {
  id: string;
  titulo: string;
  descricao: string;
  concluida: boolean;
  prioridade: string;
  dataVencimento: string | null;
  aluno: Aluno | null;
  user: { id: string; name: string };
  responsavel: { id: string; name: string } | null;
  createdAt: string;
};

const PRIOR_COR: Record<string, string> = {
  alta:  "bg-red-100 text-red-700",
  media: "bg-yellow-100 text-yellow-700",
  baixa: "bg-green-100 text-green-700",
};
const PRIOR_LABEL: Record<string, string> = { alta: "Alta", media: "Média", baixa: "Baixa" };

function VencimentoBadge({ dataStr }: { dataStr: string | null }) {
  if (!dataStr) return null;
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const d = new Date(dataStr); d.setHours(0, 0, 0, 0);
  const diff = Math.round((d.getTime() - hoje.getTime()) / 86400000);
  if (diff < 0) return <span className="text-xs font-medium text-red-500">⚠ Vencida</span>;
  if (diff === 0) return <span className="text-xs font-medium text-orange-500">Hoje</span>;
  if (diff <= 3) return <span className="text-xs font-medium text-yellow-600">Em {diff}d</span>;
  return <span className="text-xs text-slate-400">{new Date(dataStr).toLocaleDateString("pt-BR")}</span>;
}

export default function TarefasPage() {
  const [tarefas, setTarefas] = useState<Tarefa[]>([]);
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [alunos, setAlunos] = useState<Aluno[]>([]);
  const [filtro, setFiltro] = useState<"pendentes" | "concluidas" | "todas">("pendentes");
  const [loading, setLoading] = useState(true);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [form, setForm] = useState({
    titulo: "", descricao: "", prioridade: "media",
    dataVencimento: "", alunoId: "", responsavelId: "",
  });

  useEffect(() => {
    carregar();
    fetch("/api/usuarios").then((r) => r.json()).then(setUsuarios);
    fetch("/api/alunos?ativo=true&page=0").then((r) => r.json()).then((d) => setAlunos(d.alunos ?? []));
  }, []);

  async function carregar() {
    setLoading(true);
    const res = await fetch("/api/tarefas");
    if (res.ok) setTarefas(await res.json());
    setLoading(false);
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
      setForm({ titulo: "", descricao: "", prioridade: "media", dataVencimento: "", alunoId: "", responsavelId: "" });
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
    if (res.ok) setTarefas((prev) => prev.map((x) => (x.id === t.id ? { ...x, concluida: !x.concluida } : x)));
  }

  async function excluir(id: string) {
    if (!confirm("Excluir esta tarefa?")) return;
    await fetch(`/api/tarefas/${id}`, { method: "DELETE" });
    setTarefas((prev) => prev.filter((t) => t.id !== id));
  }

  const visiveis = tarefas.filter((t) =>
    filtro === "todas" ? true : filtro === "pendentes" ? !t.concluida : t.concluida
  );
  const pendentes = tarefas.filter((t) => !t.concluida).length;
  const concluidas = tarefas.filter((t) => t.concluida).length;

  return (
    <div className="max-w-3xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Tarefas</h1>
          <p className="text-sm text-slate-500">{pendentes} pendente(s) · {concluidas} concluída(s)</p>
        </div>
        <button onClick={() => setMostrarForm((v) => !v)}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition">
          + Nova tarefa
        </button>
      </div>

      {/* Formulário */}
      {mostrarForm && (
        <form onSubmit={criar} className="bg-white rounded-xl border border-slate-200 p-5 space-y-4 shadow-sm">
          <p className="text-sm font-semibold text-slate-700">Nova tarefa</p>
          <input autoFocus required type="text" placeholder="Título da tarefa *"
            value={form.titulo} onChange={(e) => setForm((p) => ({ ...p, titulo: e.target.value }))}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <textarea placeholder="Descrição (opcional)" rows={2}
            value={form.descricao} onChange={(e) => setForm((p) => ({ ...p, descricao: e.target.value }))}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Prioridade</label>
              <select value={form.prioridade} onChange={(e) => setForm((p) => ({ ...p, prioridade: e.target.value }))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="baixa">Baixa</option>
                <option value="media">Média</option>
                <option value="alta">Alta</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Vencimento</label>
              <input type="date" value={form.dataVencimento}
                onChange={(e) => setForm((p) => ({ ...p, dataVencimento: e.target.value }))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Responsável</label>
              <select value={form.responsavelId} onChange={(e) => setForm((p) => ({ ...p, responsavelId: e.target.value }))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">— Ninguém —</option>
                {usuarios.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Aluno (opcional)</label>
              <select value={form.alunoId} onChange={(e) => setForm((p) => ({ ...p, alunoId: e.target.value }))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
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
              className="text-sm text-slate-500 hover:underline px-2">Cancelar</button>
          </div>
        </form>
      )}

      {/* Filtros */}
      <div className="flex gap-2">
        {([
          ["pendentes", `Pendentes (${pendentes})`],
          ["concluidas", `Concluídas (${concluidas})`],
          ["todas", "Todas"],
        ] as const).map(([v, label]) => (
          <button key={v} onClick={() => setFiltro(v)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition ${
              filtro === v ? "bg-blue-600 text-white border-blue-600" : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50"
            }`}>
            {label}
          </button>
        ))}
      </div>

      {loading && <p className="text-sm text-slate-400">Carregando...</p>}

      {/* Lista */}
      <div className="space-y-2">
        {!loading && visiveis.length === 0 && (
          <div className="bg-white rounded-xl border border-slate-100 px-5 py-12 text-center text-slate-400 text-sm">
            Nenhuma tarefa {filtro === "pendentes" ? "pendente" : filtro === "concluidas" ? "concluída" : ""}
          </div>
        )}
        {visiveis.map((t) => (
          <div key={t.id}
            className={`bg-white rounded-xl border px-5 py-4 flex gap-4 items-start transition-opacity ${
              t.concluida ? "border-slate-100 opacity-55" : "border-slate-200"
            }`}>
            {/* Checkbox círculo */}
            <button onClick={() => toggleConcluida(t)}
              className={`mt-0.5 w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center transition ${
                t.concluida ? "bg-green-500 border-green-500 text-white" : "border-slate-300 hover:border-blue-500"
              }`}>
              {t.concluida && (
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                </svg>
              )}
            </button>

            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 mb-0.5">
                <span className={`text-sm font-medium ${t.concluida ? "line-through text-slate-400" : "text-slate-800"}`}>
                  {t.titulo}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${PRIOR_COR[t.prioridade]}`}>
                  {PRIOR_LABEL[t.prioridade]}
                </span>
                <VencimentoBadge dataStr={t.dataVencimento} />
              </div>
              {t.descricao && <p className="text-xs text-slate-500 truncate mb-1">{t.descricao}</p>}
              <div className="flex flex-wrap gap-3 text-xs text-slate-400">
                {t.responsavel && (
                  <span className="flex items-center gap-1">
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                    </svg>
                    <span className="text-blue-600 font-medium">{t.responsavel.name}</span>
                  </span>
                )}
                {t.aluno && (
                  <Link href={`/alunos/${t.aluno.id}`} className="text-indigo-500 hover:underline">
                    {t.aluno.nome}
                  </Link>
                )}
                <span>por {t.user.name}</span>
              </div>
            </div>

            <button onClick={() => excluir(t.id)} title="Excluir"
              className="text-slate-300 hover:text-red-400 transition flex-shrink-0 mt-0.5">
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
