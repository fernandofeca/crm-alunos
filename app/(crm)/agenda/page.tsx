"use client";

import { useState, useEffect } from "react";

type Aluno = { id: string; nome: string };
type Evento = {
  id: string;
  titulo: string;
  descricao: string;
  data: string;
  tipo: string;
  aluno: Aluno | null;
  user: { name: string };
};

const TIPOS = ["lembrete", "reuniao", "contato", "tarefa", "outro"];
const TIPO_LABEL: Record<string, string> = {
  lembrete: "Lembrete", reuniao: "Reunião", contato: "Contato", tarefa: "Tarefa", outro: "Outro",
};
const TIPO_COR: Record<string, string> = {
  lembrete: "bg-blue-100 text-blue-700",
  reuniao:  "bg-purple-100 text-purple-700",
  contato:  "bg-green-100 text-green-700",
  tarefa:   "bg-orange-100 text-orange-700",
  outro:    "bg-slate-100 text-slate-600",
};

function mesLabel(mes: string) {
  const [ano, m] = mes.split("-").map(Number);
  return new Date(ano, m - 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

function mesAtual() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function navMes(mes: string, delta: number) {
  const [ano, m] = mes.split("-").map(Number);
  const d = new Date(ano, m - 1 + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function agruparPorDia(eventos: Evento[]) {
  const map = new Map<string, Evento[]>();
  for (const e of eventos) {
    const dia = e.data.slice(0, 10);
    if (!map.has(dia)) map.set(dia, []);
    map.get(dia)!.push(e);
  }
  return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
}

export default function AgendaPage() {
  const [mes, setMes] = useState(mesAtual());
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [alunos, setAlunos] = useState<Aluno[]>([]);
  const [loading, setLoading] = useState(true);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [form, setForm] = useState({ titulo: "", descricao: "", data: "", hora: "09:00", tipo: "lembrete", alunoId: "" });

  useEffect(() => { carregar(); }, [mes]);
  useEffect(() => { carregarAlunos(); }, []);

  async function carregar() {
    setLoading(true);
    const res = await fetch(`/api/agenda?mes=${mes}`);
    if (res.ok) setEventos(await res.json());
    setLoading(false);
  }

  async function carregarAlunos() {
    const res = await fetch("/api/alunos?ativo=true&page=0");
    if (res.ok) { const d = await res.json(); setAlunos(d.alunos ?? []); }
  }

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    if (!form.titulo.trim() || !form.data) return;
    setSalvando(true);
    const dataHora = `${form.data}T${form.hora}:00`;
    const res = await fetch("/api/agenda", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, data: dataHora }),
    });
    if (res.ok) {
      const novo = await res.json();
      const novaMes = novo.data.slice(0, 7);
      if (novaMes === mes) setEventos((prev) => [...prev, novo].sort((a, b) => a.data.localeCompare(b.data)));
      setForm({ titulo: "", descricao: "", data: "", hora: "09:00", tipo: "lembrete", alunoId: "" });
      setMostrarForm(false);
    }
    setSalvando(false);
  }

  async function excluir(id: string) {
    if (!confirm("Excluir este evento?")) return;
    await fetch(`/api/agenda/${id}`, { method: "DELETE" });
    setEventos((prev) => prev.filter((e) => e.id !== id));
  }

  const grupos = agruparPorDia(eventos);
  const hoje = new Date().toISOString().slice(0, 10);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Agenda</h1>
          <p className="text-sm text-slate-500">{eventos.length} evento(s) em {mesLabel(mes)}</p>
        </div>
        <button
          onClick={() => setMostrarForm((v) => !v)}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
        >
          + Novo evento
        </button>
      </div>

      {mostrarForm && (
        <form onSubmit={criar} className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
          <h2 className="text-sm font-semibold text-slate-700">Novo evento</h2>
          <input
            autoFocus
            type="text"
            placeholder="Título *"
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
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Data *</label>
              <input type="date" required value={form.data}
                onChange={(e) => setForm((p) => ({ ...p, data: e.target.value }))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Hora</label>
              <input type="time" value={form.hora}
                onChange={(e) => setForm((p) => ({ ...p, hora: e.target.value }))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Tipo</label>
              <select value={form.tipo} onChange={(e) => setForm((p) => ({ ...p, tipo: e.target.value }))}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                {TIPOS.map((t) => <option key={t} value={t}>{TIPO_LABEL[t]}</option>)}
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
              {salvando ? "Salvando..." : "Criar evento"}
            </button>
            <button type="button" onClick={() => setMostrarForm(false)}
              className="text-sm text-slate-500 hover:underline px-2">
              Cancelar
            </button>
          </div>
        </form>
      )}

      {/* Navegação de mês */}
      <div className="flex items-center justify-between bg-white rounded-xl border border-slate-200 px-5 py-3">
        <button onClick={() => setMes(navMes(mes, -1))}
          className="text-slate-500 hover:text-blue-600 transition px-2 py-1 rounded hover:bg-slate-50">
          ← Anterior
        </button>
        <div className="text-center">
          <p className="font-semibold text-slate-800 capitalize">{mesLabel(mes)}</p>
        </div>
        <button onClick={() => setMes(navMes(mes, 1))}
          className="text-slate-500 hover:text-blue-600 transition px-2 py-1 rounded hover:bg-slate-50">
          Próximo →
        </button>
      </div>

      {mes !== mesAtual() && (
        <button onClick={() => setMes(mesAtual())}
          className="text-sm text-blue-600 hover:underline">
          Voltar para hoje
        </button>
      )}

      {loading && <p className="text-sm text-slate-400">Carregando...</p>}

      {!loading && grupos.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 px-5 py-12 text-center text-slate-400 text-sm">
          Nenhum evento em {mesLabel(mes)}
        </div>
      )}

      <div className="space-y-4">
        {grupos.map(([dia, evs]) => {
          const isHoje = dia === hoje;
          const dataFmt = new Date(dia + "T12:00:00").toLocaleDateString("pt-BR", {
            weekday: "long", day: "numeric", month: "long",
          });
          return (
            <div key={dia}>
              <div className={`flex items-center gap-2 mb-2`}>
                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${isHoje ? "bg-blue-500" : "bg-slate-300"}`} />
                <span className={`text-sm font-semibold capitalize ${isHoje ? "text-blue-600" : "text-slate-600"}`}>
                  {dataFmt}{isHoje && " · Hoje"}
                </span>
              </div>
              <div className="space-y-2 pl-4">
                {evs.map((ev) => (
                  <div key={ev.id} className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex gap-3 items-start">
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-slate-800">{ev.titulo}</span>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${TIPO_COR[ev.tipo]}`}>
                          {TIPO_LABEL[ev.tipo]}
                        </span>
                        <span className="text-xs text-slate-400">
                          {new Date(ev.data).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      {ev.descricao && <p className="text-xs text-slate-500 mt-0.5">{ev.descricao}</p>}
                      <div className="flex gap-3 mt-1 text-xs text-slate-400">
                        {ev.aluno && (
                          <a href={`/alunos/${ev.aluno.id}`} className="text-indigo-500 hover:underline">
                            {ev.aluno.nome}
                          </a>
                        )}
                        <span>{ev.user.name}</span>
                      </div>
                    </div>
                    <button onClick={() => excluir(ev.id)}
                      className="text-slate-300 hover:text-red-400 transition flex-shrink-0 mt-0.5" title="Excluir">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
