"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";

type Aluno = {
  id: string;
  nome: string;
  email: string;
  whatsapp: string;
  concurso: string;
  planoTipo: string;
  ativo: boolean;
  tutoryId: number | null;
};

type Conquista = {
  id: string;
  semana: string;
  horas: number;
  aluno: Aluno;
};

type Props = {
  conquistas: Conquista[];
  concursos: string[];
  sextas: string[];
};

const PLANOS = ["Mentoria da Posse", "Mentoria Diamante", "Cronograma Ouro", "Cronograma Outros"];

function fmtSemana(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });
}

function fmtHoras(h: number) {
  const hrs = Math.floor(h);
  const min = Math.round((h - hrs) * 60);
  return min > 0 ? `${hrs}h ${min}min` : `${hrs}h`;
}

function whatsappUrl(numero: string) {
  const limpo = numero.replace(/\D/g, "");
  return `https://wa.me/${limpo}`;
}

export default function AlunosEngajadosClient({ conquistas, concursos, sextas }: Props) {
  const [planoFiltro, setPlanoFiltro] = useState<string[]>([]);
  const [concursoFiltro, setConcursoFiltro] = useState<string[]>([]);
  const [planoOpen, setPlanoOpen] = useState(false);
  const [concursoOpen, setConcursoOpen] = useState(false);
  const planoRef = useRef<HTMLDivElement>(null);
  const concursoRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (planoRef.current && !planoRef.current.contains(e.target as Node)) setPlanoOpen(false);
      if (concursoRef.current && !concursoRef.current.contains(e.target as Node)) setConcursoOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Group conquistas by alunoId, collecting which weeks they got the badge
  const alunoMap = new Map<string, { aluno: Aluno; semanas: { semana: string; horas: number }[] }>();
  for (const c of conquistas) {
    const key = c.aluno.id;
    if (!alunoMap.has(key)) {
      alunoMap.set(key, { aluno: c.aluno, semanas: [] });
    }
    alunoMap.get(key)!.semanas.push({ semana: c.semana, horas: c.horas });
  }

  let entries = Array.from(alunoMap.values());

  // Apply filters
  if (planoFiltro.length > 0) {
    entries = entries.filter((e) => planoFiltro.includes(e.aluno.planoTipo));
  }
  if (concursoFiltro.length > 0) {
    entries = entries.filter((e) => concursoFiltro.includes(e.aluno.concurso));
  }

  // Sort by number of badges desc, then nome
  entries.sort((a, b) => {
    if (b.semanas.length !== a.semanas.length) return b.semanas.length - a.semanas.length;
    return a.aluno.nome.localeCompare(b.aluno.nome, "pt-BR");
  });

  function togglePlano(p: string) {
    setPlanoFiltro((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }

  function toggleConcurso(c: string) {
    setConcursoFiltro((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]));
  }

  const sextaLabels = sextas.map(fmtSemana);

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Alunos Engajados</h1>
        <p className="text-sm text-slate-500 mt-1">
          Alunos com selo de engajamento nas últimas duas sextas: {sextaLabels.join(" e ")}
        </p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5">
        {/* Plano filter */}
        <div className="relative" ref={planoRef}>
          <button
            onClick={() => setPlanoOpen((o) => !o)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white hover:bg-slate-50 flex items-center gap-2 min-w-[160px] justify-between"
          >
            <span className="text-slate-600">
              {planoFiltro.length === 0 ? "Todos os Planos" : planoFiltro.length === 1 ? planoFiltro[0] : `${planoFiltro.length} planos`}
            </span>
            <span className="text-slate-400">▾</span>
          </button>
          {planoOpen && (
            <div className="absolute z-20 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg min-w-[220px] py-1">
              <div className="flex gap-2 px-3 py-1 border-b border-slate-100">
                <button onClick={() => setPlanoFiltro([...PLANOS])} className="text-xs text-blue-600 hover:underline">Selecionar todos</button>
                <span className="text-slate-300">|</span>
                <button onClick={() => setPlanoFiltro([])} className="text-xs text-slate-500 hover:underline">Limpar</button>
              </div>
              {PLANOS.map((p) => (
                <label key={p} className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 cursor-pointer text-sm text-slate-700">
                  <input type="checkbox" checked={planoFiltro.includes(p)} onChange={() => togglePlano(p)} className="accent-blue-600" />
                  {p}
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Concurso filter */}
        <div className="relative" ref={concursoRef}>
          <button
            onClick={() => setConcursoOpen((o) => !o)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white hover:bg-slate-50 flex items-center gap-2 min-w-[160px] justify-between"
          >
            <span className="text-slate-600">
              {concursoFiltro.length === 0 ? "Todos os Concursos" : concursoFiltro.length === 1 ? concursoFiltro[0] : `${concursoFiltro.length} concursos`}
            </span>
            <span className="text-slate-400">▾</span>
          </button>
          {concursoOpen && (
            <div className="absolute z-20 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg min-w-[220px] max-h-64 overflow-y-auto py-1">
              <div className="flex gap-2 px-3 py-1 border-b border-slate-100">
                <button onClick={() => setConcursoFiltro([...concursos])} className="text-xs text-blue-600 hover:underline">Selecionar todos</button>
                <span className="text-slate-300">|</span>
                <button onClick={() => setConcursoFiltro([])} className="text-xs text-slate-500 hover:underline">Limpar</button>
              </div>
              {concursos.map((c) => (
                <label key={c} className="flex items-center gap-2 px-3 py-1.5 hover:bg-slate-50 cursor-pointer text-sm text-slate-700">
                  <input type="checkbox" checked={concursoFiltro.includes(c)} onChange={() => toggleConcurso(c)} className="accent-blue-600" />
                  {c}
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center text-sm text-slate-500 ml-2">
          {entries.length} aluno{entries.length !== 1 ? "s" : ""}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
              <th className="px-4 py-3">#</th>
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">Concurso</th>
              <th className="px-4 py-3">Plano</th>
              <th className="px-4 py-3 text-center">Selos</th>
              {sextas.map((s) => (
                <th key={s} className="px-4 py-3 text-center">{fmtSemana(s)}</th>
              ))}
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr>
                <td colSpan={6 + sextas.length} className="px-4 py-8 text-center text-slate-400">
                  Nenhum aluno engajado encontrado.
                </td>
              </tr>
            )}
            {entries.map(({ aluno, semanas }, idx) => {
              const semanaSet = new Set(semanas.map((s) => s.semana));
              const horasPorSemana = Object.fromEntries(semanas.map((s) => [s.semana, s.horas]));
              return (
                <tr key={aluno.id} className="border-b border-slate-100 hover:bg-slate-50 transition">
                  <td className="px-4 py-3 text-slate-400">{idx + 1}</td>
                  <td className="px-4 py-3 font-medium">
                    {aluno.tutoryId ? (
                      <a href={`https://admin.tutory.com.br/alunos/index?aid=${aluno.tutoryId}`} target="_blank" rel="noopener noreferrer"
                        className="text-blue-600 hover:text-blue-800 hover:underline">
                        {aluno.nome}
                      </a>
                    ) : (
                      <span className="text-slate-800">{aluno.nome}</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{aluno.concurso}</td>
                  <td className="px-4 py-3 text-slate-600">{aluno.planoTipo}</td>
                  <td className="px-4 py-3 text-center">
                    <span className="inline-flex items-center gap-1 font-semibold text-amber-600">
                      {"🏆".repeat(semanas.length)}
                      <span className="text-xs text-slate-500 ml-1">({semanas.length}/{sextas.length})</span>
                    </span>
                  </td>
                  {sextas.map((s) => (
                    <td key={s} className="px-4 py-3 text-center">
                      {semanaSet.has(s) ? (
                        <span className="inline-flex flex-col items-center">
                          <span className="text-lg">🏆</span>
                          <span className="text-xs text-slate-500">{fmtHoras(horasPorSemana[s])}</span>
                        </span>
                      ) : (
                        <span className="text-slate-200 text-lg">—</span>
                      )}
                    </td>
                  ))}
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {aluno.whatsapp && (
                        <a href={whatsappUrl(aluno.whatsapp)} target="_blank" rel="noopener noreferrer"
                          className="text-xs bg-green-500 text-white px-2 py-1 rounded hover:bg-green-600 transition">
                          WhatsApp
                        </a>
                      )}
                      <Link href={`/alunos/${aluno.id}`}
                        className="text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded hover:bg-blue-100 transition">
                        Ver Perfil
                      </Link>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
