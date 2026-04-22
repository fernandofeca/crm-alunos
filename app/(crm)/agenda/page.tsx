"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";

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

const TIPOS = ["lembrete", "reuniao", "contato", "outro"] as const;
const TIPO_LABEL: Record<string, string> = {
  lembrete: "Lembrete", reuniao: "Reunião", contato: "Contato", outro: "Outro",
};
const TIPO_BG: Record<string, string> = {
  lembrete: "bg-blue-500",
  reuniao:  "bg-purple-500",
  contato:  "bg-green-500",
  outro:    "bg-slate-400",
};
const TIPO_LIGHT: Record<string, string> = {
  lembrete: "bg-blue-100 text-blue-700",
  reuniao:  "bg-purple-100 text-purple-700",
  contato:  "bg-green-100 text-green-700",
  outro:    "bg-slate-100 text-slate-600",
};

function googleCalendarUrl(ev: Evento): string {
  const inicio = new Date(ev.data);
  const fim = new Date(inicio.getTime() + 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: ev.titulo,
    dates: `${fmt(inicio)}/${fmt(fim)}`,
    details: [ev.descricao, ev.aluno ? `Aluno: ${ev.aluno.nome}` : ""].filter(Boolean).join("\n"),
    sf: "true",
    output: "xml",
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MESES = ["Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"];

function hoje() {
  const d = new Date();
  return { ano: d.getFullYear(), mes: d.getMonth(), dia: d.getDate() };
}

function diasNoMes(ano: number, mes: number) {
  return new Date(ano, mes + 1, 0).getDate();
}

function primeiroDiaDaSemana(ano: number, mes: number) {
  return new Date(ano, mes, 1).getDay();
}

function isoData(ano: number, mes: number, dia: number) {
  return `${ano}-${String(mes + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

export default function AgendaPage() {
  const hj = hoje();
  const [ano, setAno] = useState(hj.ano);
  const [mes, setMes] = useState(hj.mes);
  const [diaSel, setDiaSel] = useState<string>(isoData(hj.ano, hj.mes, hj.dia));
  const [eventos, setEventos] = useState<Evento[]>([]);
  const [alunos, setAlunos] = useState<Aluno[]>([]);
  const [loading, setLoading] = useState(true);
  const [mostrarForm, setMostrarForm] = useState(false);
  const [mostrarSync, setMostrarSync] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const [googleConectado, setGoogleConectado] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);
  const [syncResultado, setSyncResultado] = useState<{ criados: number; atualizados: number; total: number } | null>(null);
  const icalUrl = useRef("");
  const [form, setForm] = useState({ titulo: "", descricao: "", hora: "09:00", tipo: "lembrete", alunoId: "" });

  const mesStr = `${ano}-${String(mes + 1).padStart(2, "0")}`;

  useEffect(() => {
    fetch("/api/agenda/ical-token").then((r) => r.json()).then((d) => {
      if (d.url) icalUrl.current = d.url;
    });
    fetch("/api/agenda/google/status").then((r) => r.json()).then((d) => setGoogleConectado(d.conectado));

    // Verificar se voltou do OAuth Google
    const params = new URLSearchParams(window.location.search);
    const google = params.get("google");
    if (google === "conectado") {
      setGoogleConectado(true);
      setMostrarSync(true);
      window.history.replaceState({}, "", "/agenda");
    } else if (google === "erro" || google === "sem_token") {
      window.history.replaceState({}, "", "/agenda");
    }
  }, []);

  async function sincronizarGoogle() {
    setSincronizando(true);
    setSyncResultado(null);
    const res = await fetch("/api/agenda/google/sync", { method: "POST" });
    const data = await res.json();
    if (res.ok) {
      setSyncResultado(data);
      carregar();
    }
    setSincronizando(false);
  }

  async function desconectarGoogle() {
    if (!confirm("Desconectar o Google Agenda?")) return;
    await fetch("/api/agenda/google/disconnect", { method: "POST" });
    setGoogleConectado(false);
    setSyncResultado(null);
  }

  async function copiarUrl() {
    if (!icalUrl.current) return;
    await navigator.clipboard.writeText(icalUrl.current);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 2000);
  }

  const carregar = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/agenda?mes=${mesStr}`);
    if (res.ok) setEventos(await res.json());
    setLoading(false);
  }, [mesStr]);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => {
    fetch("/api/alunos?todos=true").then((r) => r.json()).then(setAlunos);
  }, []);

  function navMes(delta: number) {
    const d = new Date(ano, mes + delta);
    setAno(d.getFullYear());
    setMes(d.getMonth());
  }

  function voltarHoje() {
    const h = hoje();
    setAno(h.ano); setMes(h.mes);
    setDiaSel(isoData(h.ano, h.mes, h.dia));
  }

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    if (!form.titulo.trim()) return;
    setSalvando(true);
    const dataHora = `${diaSel}T${form.hora}:00`;
    const res = await fetch("/api/agenda", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, data: dataHora }),
    });
    if (res.ok) {
      const novo = await res.json();
      setEventos((prev) => [...prev, novo].sort((a, b) => a.data.localeCompare(b.data)));
      setForm({ titulo: "", descricao: "", hora: "09:00", tipo: "lembrete", alunoId: "" });
      setMostrarForm(false);
    }
    setSalvando(false);
  }

  async function excluir(id: string) {
    if (!confirm("Excluir este evento?")) return;
    await fetch(`/api/agenda/${id}`, { method: "DELETE" });
    setEventos((prev) => prev.filter((e) => e.id !== id));
  }

  // Montar grade do calendário
  const totalDias = diasNoMes(ano, mes);
  const primeiroDS = primeiroDiaDaSemana(ano, mes);
  const diasAntes = primeiroDS;
  const totalCelulas = Math.ceil((diasAntes + totalDias) / 7) * 7;
  const celulas: Array<{ dia: number; mesAtual: boolean; dataStr: string }> = [];

  // Dias do mês anterior
  const mesAnterior = mes === 0 ? 11 : mes - 1;
  const anoAnterior = mes === 0 ? ano - 1 : ano;
  const diasMesAnterior = diasNoMes(anoAnterior, mesAnterior);
  for (let i = diasAntes - 1; i >= 0; i--) {
    const d = diasMesAnterior - i;
    celulas.push({ dia: d, mesAtual: false, dataStr: isoData(anoAnterior, mesAnterior, d) });
  }
  // Dias do mês atual
  for (let d = 1; d <= totalDias; d++) {
    celulas.push({ dia: d, mesAtual: true, dataStr: isoData(ano, mes, d) });
  }
  // Dias do próximo mês
  const mesPro = mes === 11 ? 0 : mes + 1;
  const anoPro = mes === 11 ? ano + 1 : ano;
  for (let d = 1; celulas.length < totalCelulas; d++) {
    celulas.push({ dia: d, mesAtual: false, dataStr: isoData(anoPro, mesPro, d) });
  }

  // Mapa eventos por dia
  const eventosPorDia = new Map<string, Evento[]>();
  for (const ev of eventos) {
    const k = ev.data.slice(0, 10);
    if (!eventosPorDia.has(k)) eventosPorDia.set(k, []);
    eventosPorDia.get(k)!.push(ev);
  }

  const evsDiaSel = (eventosPorDia.get(diaSel) ?? []).sort((a, b) => a.data.localeCompare(b.data));
  const dataSelFmt = new Date(diaSel + "T12:00:00").toLocaleDateString("pt-BR", {
    weekday: "long", day: "numeric", month: "long",
  });
  const isHoje = (ds: string) => {
    const h = hoje();
    return ds === isoData(h.ano, h.mes, h.dia);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-slate-800">Agenda</h1>
          <button onClick={voltarHoje}
            className="text-sm border border-slate-300 rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-50 transition">
            Hoje
          </button>
          <div className="flex items-center gap-1">
            <button onClick={() => navMes(-1)}
              className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-600 transition">
              ‹
            </button>
            <button onClick={() => navMes(1)}
              className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-100 text-slate-600 transition">
              ›
            </button>
          </div>
          <h2 className="text-lg font-semibold text-slate-700">
            {MESES[mes]} {ano}
          </h2>
        </div>
        <div className="flex gap-2">
          <Link href="/agenda/importar"
            className="flex items-center gap-1.5 border border-slate-300 text-slate-600 hover:bg-slate-50 text-sm font-medium px-3 py-2 rounded-lg transition">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            Importar
          </Link>
          <button onClick={() => setMostrarSync((v) => !v)}
            className="flex items-center gap-1.5 border border-slate-300 text-slate-600 hover:bg-slate-50 text-sm font-medium px-3 py-2 rounded-lg transition">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM7 10h5v5H7z"/>
            </svg>
            Google Agenda
          </button>
          <button onClick={() => { setMostrarForm(true); }}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition">
            + Novo evento
          </button>
        </div>
      </div>

      {/* Painel Google Calendar */}
      {mostrarSync && (
        <div className="bg-white rounded-xl border border-blue-200 p-5 space-y-5">
          <div className="flex items-start justify-between gap-4">
            <p className="font-semibold text-slate-800 flex items-center gap-2">
              <svg className="w-5 h-5 text-blue-500" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM7 10h5v5H7z"/>
              </svg>
              Google Agenda
            </p>
            <button onClick={() => { setMostrarSync(false); setSyncResultado(null); }}
              className="text-slate-400 hover:text-slate-600 flex-shrink-0">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Seção 1: Sincronizar via conta Google */}
          <div className="border border-slate-100 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-slate-700">Sincronizar com minha conta Google</p>
                <p className="text-xs text-slate-500 mt-0.5">Importa eventos dos últimos 30 dias + próximos 180 dias automaticamente.</p>
              </div>
              {googleConectado && (
                <span className="flex items-center gap-1 text-xs text-green-600 font-medium bg-green-50 px-2 py-1 rounded-full">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" />
                  Conectado
                </span>
              )}
            </div>

            {!googleConectado ? (
              <a href="/api/agenda/google/auth"
                className="inline-flex items-center gap-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium px-4 py-2 rounded-lg transition">
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Conectar com o Google
              </a>
            ) : (
              <div className="flex gap-2 flex-wrap">
                <button onClick={sincronizarGoogle} disabled={sincronizando}
                  className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg disabled:opacity-50 transition">
                  {sincronizando ? (
                    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  )}
                  {sincronizando ? "Sincronizando..." : "Sincronizar agora"}
                </button>
                <button onClick={desconectarGoogle}
                  className="text-sm text-red-400 hover:text-red-600 hover:underline px-2 transition">
                  Desconectar
                </button>
              </div>
            )}

            {syncResultado && (
              <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3 text-sm text-green-700 flex gap-4">
                <span><strong>{syncResultado.criados}</strong> novos</span>
                <span><strong>{syncResultado.atualizados}</strong> atualizados</span>
                <span className="text-slate-400">{syncResultado.total} encontrados</span>
              </div>
            )}
          </div>

          {/* Seção 2: Feed iCal (CRM → Google) */}
          <div className="border border-slate-100 rounded-xl p-4 space-y-3">
            <div>
              <p className="text-sm font-semibold text-slate-700">Exportar agenda do CRM para o Google</p>
              <p className="text-xs text-slate-500 mt-0.5">Use esta URL para assinar a agenda do CRM no Google Agenda.</p>
            </div>
            <div className="flex gap-2">
              <input readOnly value={icalUrl.current || "Carregando..."}
                className="flex-1 text-xs border border-slate-200 rounded-lg px-3 py-2 bg-slate-50 text-slate-500 font-mono" />
              <button onClick={copiarUrl}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition flex-shrink-0 ${
                  copiado ? "bg-green-500 text-white" : "border border-slate-300 text-slate-600 hover:bg-slate-50"
                }`}>
                {copiado ? "Copiado!" : "Copiar"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex gap-5 items-start">
        {/* Grade do calendário */}
        <div className="flex-1 min-w-0 bg-white rounded-xl border border-slate-200 overflow-hidden">
          {/* Cabeçalho dias da semana */}
          <div className="grid grid-cols-7 border-b border-slate-200">
            {DIAS_SEMANA.map((d) => (
              <div key={d} className="py-2 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide">
                {d}
              </div>
            ))}
          </div>

          {/* Grade de dias */}
          <div className="grid grid-cols-7">
            {celulas.map((cel, i) => {
              const evs = eventosPorDia.get(cel.dataStr) ?? [];
              const isSel = cel.dataStr === diaSel;
              const isHj = isHoje(cel.dataStr);
              const isUltima = i >= celulas.length - 7;
              return (
                <div
                  key={i}
                  onClick={() => setDiaSel(cel.dataStr)}
                  className={`min-h-[90px] p-1.5 border-b border-r border-slate-100 cursor-pointer transition-colors ${
                    isSel ? "bg-blue-50" : "hover:bg-slate-50"
                  } ${isUltima ? "border-b-0" : ""} ${i % 7 === 6 ? "border-r-0" : ""}`}
                >
                  {/* Número do dia */}
                  <div className="flex justify-end mb-1">
                    <span className={`text-sm w-7 h-7 flex items-center justify-center rounded-full font-medium transition-colors ${
                      isHj
                        ? "bg-blue-600 text-white"
                        : isSel
                        ? "bg-blue-100 text-blue-700"
                        : cel.mesAtual
                        ? "text-slate-700"
                        : "text-slate-300"
                    }`}>
                      {cel.dia}
                    </span>
                  </div>
                  {/* Pills de eventos */}
                  <div className="space-y-0.5">
                    {evs.slice(0, 3).map((ev) => (
                      <div key={ev.id}
                        className={`text-xs text-white px-1.5 py-0.5 rounded truncate ${TIPO_BG[ev.tipo] ?? "bg-slate-400"}`}
                        title={ev.titulo}>
                        {new Date(ev.data).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} {ev.titulo}
                      </div>
                    ))}
                    {evs.length > 3 && (
                      <div className="text-xs text-slate-500 pl-1">+{evs.length - 3} mais</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Painel lateral do dia selecionado */}
        <div className="w-72 flex-shrink-0 space-y-3">
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <p className="text-sm font-semibold text-slate-700 capitalize">{dataSelFmt}</p>
              <button onClick={() => setMostrarForm(true)}
                className="text-xs text-blue-600 hover:underline font-medium">+ Adicionar</button>
            </div>
            <div className="p-3 space-y-2 max-h-[420px] overflow-y-auto">
              {loading && <p className="text-xs text-slate-400 py-2">Carregando...</p>}
              {!loading && evsDiaSel.length === 0 && (
                <p className="text-xs text-slate-400 py-4 text-center">Nenhum evento</p>
              )}
              {evsDiaSel.map((ev) => (
                <div key={ev.id} className="rounded-lg border border-slate-100 p-3 hover:bg-slate-50 transition group">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${TIPO_BG[ev.tipo]}`} />
                      <span className="text-sm font-medium text-slate-800 truncate">{ev.titulo}</span>
                    </div>
                    <button onClick={() => excluir(ev.id)}
                      className="text-slate-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition flex-shrink-0">
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 mt-1.5">
                    <span className="text-xs text-slate-400">
                      {new Date(ev.data).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${TIPO_LIGHT[ev.tipo]}`}>
                      {TIPO_LABEL[ev.tipo]}
                    </span>
                  </div>
                  {ev.descricao && <p className="text-xs text-slate-500 mt-1">{ev.descricao}</p>}
                  {ev.aluno && (
                    <a href={`/alunos/${ev.aluno.id}`} className="text-xs text-indigo-500 hover:underline mt-1 block">
                      {ev.aluno.nome}
                    </a>
                  )}
                  <div className="flex items-center justify-between mt-1.5">
                    <p className="text-xs text-slate-400">{ev.user.name}</p>
                    <a href={googleCalendarUrl(ev)} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-blue-500 hover:underline flex items-center gap-0.5" title="Adicionar ao Google Agenda">
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M19 3h-1V1h-2v2H8V1H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11zM7 10h5v5H7z"/>
                      </svg>
                      Google
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Legenda */}
          <div className="bg-white rounded-xl border border-slate-200 p-3">
            <p className="text-xs font-semibold text-slate-500 mb-2 uppercase tracking-wide">Legenda</p>
            <div className="space-y-1.5">
              {TIPOS.map((t) => (
                <div key={t} className="flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full ${TIPO_BG[t]}`} />
                  <span className="text-xs text-slate-600">{TIPO_LABEL[t]}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Modal de novo evento */}
      {mostrarForm && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setMostrarForm(false); }}>
          <form onSubmit={criar}
            className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-800">Novo evento</h2>
              <button type="button" onClick={() => setMostrarForm(false)}
                className="text-slate-400 hover:text-slate-600 transition">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <input autoFocus required type="text" placeholder="Título *"
              value={form.titulo} onChange={(e) => setForm((p) => ({ ...p, titulo: e.target.value }))}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <textarea placeholder="Descrição (opcional)" rows={2}
              value={form.descricao} onChange={(e) => setForm((p) => ({ ...p, descricao: e.target.value }))}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Data</label>
                <input type="date" value={diaSel}
                  onChange={(e) => setDiaSel(e.target.value)}
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
            <div className="flex gap-2 pt-1">
              <button type="submit" disabled={salvando}
                className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold py-2 rounded-lg disabled:opacity-50 transition">
                {salvando ? "Salvando..." : "Criar evento"}
              </button>
              <button type="button" onClick={() => setMostrarForm(false)}
                className="px-4 border border-slate-300 rounded-lg text-sm text-slate-600 hover:bg-slate-50 transition">
                Cancelar
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
