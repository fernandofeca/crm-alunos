"use client";

import { useState, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

type Contato = {
  id: string;
  data: string;
  tipo: string;
  user: { name: string };
};

type Disciplina = {
  id: string;
  nome: string;
  nota: number;
  assuntos: { id: string; nome: string; nota: number }[];
};

type Aluno = {
  id: string;
  nome: string;
  email: string;
  cpf: string;
  whatsapp: string;
  concurso: string;
  planoTipo: string;
  taxaAcertos: number;
  totalQuestoes: number;
  diasAtraso: number;
  dataInicio: string | null;
  disciplinas: Disciplina[];
  contatos: Contato[];
};

type SortField = "metas" | "taxa" | "dataInicio";
type SortDir = "asc" | "desc";

const METAS_FILTROS = [
  { value: "metas_em_dia", label: "Em dia", ativo: "bg-green-500 text-white border-green-500", inativo: "bg-white border-slate-300 text-slate-600 hover:bg-slate-50" },
  { value: "metas_1d", label: "1d atraso", ativo: "bg-yellow-400 text-white border-yellow-400", inativo: "bg-white border-slate-300 text-slate-600 hover:bg-slate-50" },
  { value: "metas_2d", label: "2d atraso", ativo: "bg-orange-400 text-white border-orange-400", inativo: "bg-white border-slate-300 text-slate-600 hover:bg-slate-50" },
  { value: "metas_3d", label: "3d atraso", ativo: "bg-orange-500 text-white border-orange-500", inativo: "bg-white border-slate-300 text-slate-600 hover:bg-slate-50" },
  { value: "metas_4d", label: "4d atraso", ativo: "bg-red-400 text-white border-red-400", inativo: "bg-white border-slate-300 text-slate-600 hover:bg-slate-50" },
  { value: "metas_5d", label: "5d atraso", ativo: "bg-red-500 text-white border-red-500", inativo: "bg-white border-slate-300 text-slate-600 hover:bg-slate-50" },
  { value: "metas_6d", label: "6d atraso", ativo: "bg-red-600 text-white border-red-600", inativo: "bg-white border-slate-300 text-slate-600 hover:bg-slate-50" },
  { value: "metas_7d", label: "7d atraso", ativo: "bg-red-700 text-white border-red-700", inativo: "bg-white border-slate-300 text-slate-600 hover:bg-slate-50" },
];

const PLANOS = ["Mentoria da Posse", "Mentoria Diamante", "Cronograma Ouro", "Cronograma Outros"];

function taxaCor(taxa: number): string {
  if (taxa <= 49.9) return "bg-red-100 text-red-700";
  if (taxa <= 70) return "bg-yellow-100 text-yellow-700";
  if (taxa <= 80) return "bg-blue-100 text-blue-700";
  return "bg-green-100 text-green-700";
}

function whatsappUrl(numero: string) {
  const limpo = numero.replace(/\D/g, "");
  return `https://wa.me/${limpo}`;
}

function disciplinaMaisBaixa(disciplinas: Disciplina[]) {
  if (!disciplinas.length) return null;
  return disciplinas.reduce((a, b) => (a.nota < b.nota ? a : b));
}

function assuntoMaisBaixo(disciplinas: Disciplina[]) {
  const todos = disciplinas.flatMap((d) => d.assuntos);
  if (!todos.length) return null;
  return todos.reduce((a, b) => (a.nota < b.nota ? a : b));
}

export default function AlunosClient({
  initialAlunos,
  concursos,
  totalInicial,
}: {
  initialAlunos: Aluno[];
  concursos: string[];
  totalInicial: number;
}) {
  const searchParams = useSearchParams();
  const filtroInicial = searchParams.get("filtro") ?? "";

  const [alunos, setAlunos] = useState<Aluno[]>(initialAlunos);
  const [q, setQ] = useState("");
  const [filtro, setFiltro] = useState(filtroInicial);
  const [concursoFiltro, setConcursoFiltro] = useState("");
  const [planoFiltro, setPlanoFiltro] = useState("");
  const [apenasAtivos, setApenasAtivos] = useState(true);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(totalInicial);
  const [sort, setSort] = useState<{ field: SortField; dir: SortDir } | null>(null);
  const pageSize = 50;

  useEffect(() => {
    buscar("", filtroInicial, "", "", true, 0, null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function sortToParam(s: { field: SortField; dir: SortDir } | null): string {
    if (!s) return "";
    if (s.field === "metas") return "metas_desc";
    if (s.field === "taxa") return s.dir === "desc" ? "taxa_desc" : "taxa_asc";
    if (s.field === "dataInicio") return s.dir === "desc" ? "inicio_desc" : "inicio_asc";
    return "";
  }

  async function buscar(query: string, f: string, concurso: string, plano: string, ativos: boolean, p: number, s: typeof sort) {
    setLoading(true);
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (f) params.set("filtro", f);
    if (concurso) params.set("concurso", concurso);
    if (plano) params.set("planoTipo", plano);
    if (ativos) params.set("ativo", "true");
    const ord = sortToParam(s);
    if (ord) params.set("ordenar", ord);
    params.set("page", String(p));
    const res = await fetch(`/api/alunos?${params}`);
    const data = await res.json();
    setAlunos(data.alunos);
    setTotal(data.total);
    setPage(p);
    setLoading(false);
  }

  function handleQ(v: string) {
    setQ(v);
    buscar(v, filtro, concursoFiltro, planoFiltro, apenasAtivos, 0, sort);
  }

  function handleFiltro(v: string) {
    const next = filtro === v ? "" : v;
    setFiltro(next);
    buscar(q, next, concursoFiltro, planoFiltro, apenasAtivos, 0, sort);
  }

  function handleConcurso(v: string) {
    setConcursoFiltro(v);
    buscar(q, filtro, v, planoFiltro, apenasAtivos, 0, sort);
  }

  function handlePlano(v: string) {
    setPlanoFiltro(v);
    buscar(q, filtro, concursoFiltro, v, apenasAtivos, 0, sort);
  }

  function handleApenasAtivos(v: boolean) {
    setApenasAtivos(v);
    buscar(q, filtro, concursoFiltro, planoFiltro, v, 0, sort);
  }

  function handleSort(field: SortField, defaultDir: SortDir = "desc") {
    let next: typeof sort;
    if (!sort || sort.field !== field) {
      next = { field, dir: defaultDir };
    } else if (sort.dir === defaultDir) {
      next = { field, dir: defaultDir === "desc" ? "asc" : "desc" };
    } else {
      next = null;
    }
    setSort(next);
    buscar(q, filtro, concursoFiltro, planoFiltro, apenasAtivos, 0, next);
  }

  const totalPages = Math.ceil(total / pageSize);

  function SortBtn({ field, defaultDir = "desc", label }: { field: SortField; defaultDir?: SortDir; label: string }) {
    const active = sort?.field === field;
    const dir = active ? sort!.dir : null;
    return (
      <button
        onClick={() => handleSort(field, defaultDir)}
        className={`flex items-center gap-1 font-semibold uppercase tracking-wide transition ${active ? "text-blue-600" : "text-slate-500 hover:text-slate-700"}`}
      >
        {label}
        <span className="flex flex-col leading-none">
          <svg className={`w-2.5 h-2.5 ${active && dir === "asc" ? "text-blue-600" : "text-slate-300"}`} fill="currentColor" viewBox="0 0 10 6">
            <path d="M5 0L10 6H0z" />
          </svg>
          <svg className={`w-2.5 h-2.5 ${active && dir === "desc" ? "text-blue-600" : "text-slate-300"}`} fill="currentColor" viewBox="0 0 10 6">
            <path d="M5 6L0 0H10z" />
          </svg>
        </span>
      </button>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3">
        {/* Linha 1: busca + selects */}
        <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
          <input
            type="text"
            placeholder="Buscar por nome, email ou CPF..."
            value={q}
            onChange={(e) => handleQ(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm flex-1 min-w-48 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {concursos.length > 0 && (
            <select
              value={concursoFiltro}
              onChange={(e) => handleConcurso(e.target.value)}
              className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">Todos os concursos</option>
              {concursos.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          )}
          <select
            value={planoFiltro}
            onChange={(e) => handlePlano(e.target.value)}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="">Todos os planos</option>
            {PLANOS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          <button
            onClick={() => handleFiltro("novos")}
            className={`px-3 py-2 rounded-lg text-sm font-medium border transition ${
              filtro === "novos"
                ? "bg-indigo-500 text-white border-indigo-500"
                : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50"
            }`}
          >
            Novos (30d)
          </button>
          <button
            onClick={() => handleFiltro("nota_baixa")}
            className={`px-3 py-2 rounded-lg text-sm font-medium border transition ${
              filtro === "nota_baixa"
                ? "bg-red-500 text-white border-red-500"
                : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50"
            }`}
          >
            Taxa baixa
          </button>
          <button
            onClick={() => handleFiltro("acompanhar")}
            className={`px-3 py-2 rounded-lg text-sm font-medium border transition ${
              filtro === "acompanhar"
                ? "bg-orange-500 text-white border-orange-500"
                : "bg-white border-slate-300 text-slate-600 hover:bg-slate-50"
            }`}
          >
            👁 Acompanhar
          </button>
          <button
            onClick={() => handleApenasAtivos(!apenasAtivos)}
            className={`px-3 py-2 rounded-lg text-sm font-medium border transition ${
              apenasAtivos
                ? "bg-blue-600 text-white border-blue-600"
                : "bg-white border-slate-300 text-slate-500 hover:bg-slate-50"
            }`}
          >
            {apenasAtivos ? "Apenas ativos" : "Todos"}
          </button>
        </div>

        {/* Linha 2: filtros de metas */}
        <div className="flex flex-wrap gap-2">
          <span className="text-xs text-slate-500 self-center">Metas:</span>
          {METAS_FILTROS.map((s) => (
            <button
              key={s.value}
              onClick={() => handleFiltro(s.value)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                filtro === s.value ? s.ativo : s.inativo
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="text-sm text-slate-400">Buscando...</p>}

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm min-w-[1000px]">
          <thead className="bg-slate-50 text-slate-500 uppercase text-xs">
            <tr>
              <th className="text-left px-4 py-3">Aluno</th>
              <th className="text-left px-4 py-3">Concurso</th>
              <th className="text-left px-4 py-3"><SortBtn field="dataInicio" defaultDir="desc" label="Data Início" /></th>
              <th className="text-left px-4 py-3">WhatsApp</th>
              <th className="text-left px-4 py-3"><SortBtn field="taxa" defaultDir="desc" label="Taxa Acertos" /></th>
              <th className="text-left px-4 py-3">Disciplina baixa</th>
              <th className="text-left px-4 py-3">Assunto baixo</th>
              <th className="text-left px-4 py-3"><SortBtn field="metas" defaultDir="desc" label="Metas" /></th>
              <th className="text-left px-4 py-3">Último contato</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {alunos.map((a) => {
              const disc = disciplinaMaisBaixa(a.disciplinas);
              const assunto = assuntoMaisBaixo(a.disciplinas);
              const ultimoContato = a.contatos[0];
              return (
                <tr key={a.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">{a.nome}</div>
                    <div className="text-xs text-slate-400">{a.email}</div>
                    {a.cpf && <div className="text-xs text-slate-400">CPF: {a.cpf}</div>}
                  </td>
                  <td className="px-4 py-3">
                    {a.concurso ? (
                      <span className="text-xs bg-indigo-50 text-indigo-700 font-medium px-2 py-0.5 rounded-full">
                        {a.concurso}
                      </span>
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">
                    {a.dataInicio ? new Date(a.dataInicio).toLocaleDateString("pt-BR") : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    {a.whatsapp ? (
                      <a
                        href={whatsappUrl(a.whatsapp)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 bg-green-500 hover:bg-green-600 text-white text-xs font-semibold px-3 py-1.5 rounded-full transition"
                      >
                        <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                        </svg>
                        WhatsApp
                      </a>
                    ) : (
                      <span className="text-slate-300 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {a.taxaAcertos > 0 ? (
                      <span className={`inline-block font-bold text-sm px-2 py-0.5 rounded-full ${taxaCor(a.taxaAcertos)}`}>
                        {a.taxaAcertos.toFixed(1)}%
                      </span>
                    ) : (
                      <span className="text-slate-300 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {disc ? (
                      <span className="text-slate-600">
                        {disc.nome}{" "}
                        <span className={`font-semibold ${disc.nota < 6 ? "text-red-500" : ""}`}>
                          ({disc.nota.toFixed(1)})
                        </span>
                      </span>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    {assunto ? (
                      <span className="text-slate-600">
                        {assunto.nome}{" "}
                        <span className={`font-semibold ${assunto.nota < 6 ? "text-red-500" : ""}`}>
                          ({assunto.nota.toFixed(1)})
                        </span>
                      </span>
                    ) : <span className="text-slate-300">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    {a.diasAtraso > 0 ? (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-orange-600 bg-orange-50 px-2 py-0.5 rounded-full">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        {a.diasAtraso}d atraso
                      </span>
                    ) : (
                      <span className="text-xs text-green-600 font-medium">Em dia</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {ultimoContato ? (
                      <div>
                        <div>{new Date(ultimoContato.data).toLocaleDateString("pt-BR")}</div>
                        <div className="text-xs capitalize text-slate-400">
                          {ultimoContato.tipo} · {ultimoContato.user.name}
                        </div>
                      </div>
                    ) : (
                      <span className="text-yellow-500 text-xs">Nenhum</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/alunos/${a.id}`} className="text-blue-600 hover:underline text-xs whitespace-nowrap">
                      Ver perfil
                    </Link>
                  </td>
                </tr>
              );
            })}
            {alunos.length === 0 && !loading && (
              <tr>
                <td colSpan={10} className="px-4 py-10 text-center text-slate-400">
                  Nenhum aluno encontrado
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-400">
          {total} aluno(s) · página {page + 1} de {totalPages || 1}
        </p>
        {totalPages > 1 && (
          <div className="flex gap-2">
            <button
              onClick={() => buscar(q, filtro, concursoFiltro, planoFiltro, apenasAtivos, page - 1, sort)}
              disabled={page === 0 || loading}
              className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              ← Anterior
            </button>
            <button
              onClick={() => buscar(q, filtro, concursoFiltro, planoFiltro, apenasAtivos, page + 1, sort)}
              disabled={page >= totalPages - 1 || loading}
              className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              Próxima →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
