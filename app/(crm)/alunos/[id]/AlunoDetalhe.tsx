"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

type Assunto = { id: string; nome: string; nota: number };
type Disciplina = { id: string; nome: string; nota: number; assuntos: Assunto[] };
type Contato = { id: string; data: string; tipo: string; obs: string; user: { name: string } };
type Conquista = { id: string; tipo: string; semana: string; horas: number };
type Aluno = {
  id: string;
  nome: string;
  email: string;
  cpf: string;
  whatsapp: string;
  concurso: string;
  taxaAcertos: number;
  totalQuestoes: number;
  ativo: boolean;
  planoTipo: string;
  planoVencimento: string | null;
  dataInicio: string | null;
  acompanharDePerto: boolean;
  discMaisBaixaNome: string;
  discMaisBaixaNota: number;
  assuntoMaisBaixoNome: string;
  assuntoMaisBaixoNota: number;
  diasAtraso: number;
  tutoryId: number | null;
  planilhaUrl: string | null;
  dataNascimento: string | null;
  cidade: string;
  estado: string;
  endereco: string;
  bio: string;
  disciplinas: Disciplina[];
  contatos: Contato[];
  conquistas: Conquista[];
};

function taxaCor(taxa: number) {
  if (taxa <= 49.9) return { bg: "bg-red-50", text: "text-red-600", badge: "bg-red-100 text-red-700" };
  if (taxa <= 70)   return { bg: "bg-yellow-50", text: "text-yellow-600", badge: "bg-yellow-100 text-yellow-700" };
  if (taxa <= 80)   return { bg: "bg-blue-50", text: "text-blue-600", badge: "bg-blue-100 text-blue-700" };
  return { bg: "bg-green-50", text: "text-green-600", badge: "bg-green-100 text-green-700" };
}

function whatsappUrl(numero: string) {
  const limpo = numero.replace(/\D/g, "");
  return `https://wa.me/${limpo}`;
}

function notaBadge(nota: number) {
  if (nota < 5) return "bg-red-100 text-red-700";
  if (nota < 7) return "bg-orange-100 text-orange-700";
  return "bg-green-100 text-green-700";
}

function parseNota(s: string): number | null {
  const v = parseFloat(s.replace(",", "."));
  if (isNaN(v) || v < 0 || v > 10) return null;
  return v;
}

type CardEditavelProps = {
  label: string;
  nome: string;
  nota: number;
  onSave: (nome: string, nota: number) => Promise<void>;
  mostrarNome?: boolean;
};

function CardEditavel({ label, nome, nota, onSave, mostrarNome = true }: CardEditavelProps) {
  const [editando, setEditando] = useState(false);
  const [nomeInput, setNomeInput] = useState("");
  const [notaInput, setNotaInput] = useState("");
  const nomeRef = useRef<HTMLInputElement>(null);

  function abrir() {
    setNomeInput(nome);
    setNotaInput(nota.toFixed(1));
    setEditando(true);
    setTimeout(() => nomeRef.current?.focus(), 50);
  }

  async function salvar() {
    const novaNotaParsed = parseNota(notaInput);
    if (novaNotaParsed === null) { setEditando(false); return; }
    await onSave(nomeInput.trim(), novaNotaParsed);
    setEditando(false);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Enter") salvar();
    if (e.key === "Escape") setEditando(false);
  }

  return (
    <div
      className="bg-slate-50 rounded-lg p-4 cursor-pointer hover:bg-slate-100 transition"
      onClick={() => { if (!editando) abrir(); }}
    >
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      {editando ? (
        <div className="space-y-1" onClick={(e) => e.stopPropagation()}>
          {mostrarNome && (
            <input
              ref={nomeRef}
              type="text"
              value={nomeInput}
              onChange={(e) => setNomeInput(e.target.value)}
              onKeyDown={onKey}
              placeholder="Nome"
              className="w-full text-xs bg-white border border-blue-400 rounded px-1.5 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          )}
          <input
            autoFocus={!mostrarNome}
            type="text"
            value={notaInput}
            onChange={(e) => setNotaInput(e.target.value)}
            onBlur={salvar}
            onKeyDown={onKey}
            placeholder="0.0"
            className="w-20 text-lg font-bold bg-white border border-blue-400 rounded px-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      ) : (
        <div>
          {mostrarNome && nome && (
            <p className="text-xs text-slate-500 truncate mb-0.5">{nome}</p>
          )}
          <p className={`text-lg font-bold ${nota < 6 ? "text-red-600" : nota === 0 ? "text-slate-400" : "text-green-600"}`}>
            {nota === 0 && !nome ? "—" : nota.toFixed(1)}
            <span className="text-xs text-slate-400 ml-1 font-normal">✎</span>
          </p>
        </div>
      )}
    </div>
  );
}


// ─── NF-e / NFS-e section ────────────────────────────────────────────────────

type NotaFiscal = {
  id: string;
  tipo: "NF-e" | "NFS-e";
  numero: number;
  serie?: string;
  dataEmissao: string;
  status: string;
  valor: number;
  descricao: string;
  chave: string | null;
  cancelada: boolean;
};

function statusBadge(nota: NotaFiscal) {
  if (nota.cancelada || nota.status === "CANCELADA")
    return "bg-red-100 text-red-700 line-through";
  if (nota.status === "AUTORIZADA" || nota.status === "EMITIDA")
    return "bg-green-100 text-green-700";
  if (nota.status === "DENEGADA" || nota.status === "REJEITADA")
    return "bg-red-100 text-red-700";
  return "bg-slate-100 text-slate-500";
}

function NotasFiscaisSection({ cpf }: { cpf: string }) {
  const [notas, setNotas] = useState<NotaFiscal[] | null>(null);
  const [erro, setErro] = useState("");
  const [aberta, setAberta] = useState(false);
  const carregou = useRef(false);

  function abrir() {
    setAberta(true);
    if (carregou.current) return;
    carregou.current = true;
    fetch(`/api/diginfe/notas/${encodeURIComponent(cpf.replace(/\D/g, ""))}`)
      .then((r) => r.json())
      .then((data: { notas?: NotaFiscal[]; error?: string }) => {
        if (data.error) setErro(data.error);
        else setNotas(data.notas ?? []);
      })
      .catch((e: Error) => setErro(e.message));
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200">
      <button
        onClick={() => (aberta ? setAberta(false) : abrir())}
        className="w-full px-6 py-4 flex items-center justify-between hover:bg-slate-50 transition rounded-xl"
      >
        <div className="flex items-center gap-2">
          <span className="text-xl">🧾</span>
          <span className="text-base font-semibold text-slate-700">Notas Fiscais</span>
          {notas !== null && (
            <span className="text-xs bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full ml-1">
              {notas.length} nota{notas.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <svg
          className={`w-4 h-4 text-slate-400 transition-transform ${aberta ? "rotate-180" : ""}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {aberta && (
        <div className="px-6 pb-5 border-t border-slate-100">
          {!notas && !erro && (
            <p className="text-sm text-slate-400 py-4 animate-pulse">Buscando notas fiscais…</p>
          )}
          {erro && (
            <p className="text-sm text-red-600 py-4">⚠️ {erro}</p>
          )}
          {notas !== null && notas.length === 0 && (
            <p className="text-sm text-slate-400 py-4">
              Nenhuma NF-e / NFS-e encontrada para CPF {cpf}.
            </p>
          )}
          {notas !== null && notas.length > 0 && (
            <div className="mt-4 divide-y divide-slate-100">
              {notas.map((nota) => (
                <div key={nota.id} className="py-3 flex items-center gap-4">
                  <div className="shrink-0">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${nota.tipo === "NFS-e" ? "bg-indigo-100 text-indigo-700" : "bg-sky-100 text-sky-700"}`}>
                      {nota.tipo}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800">
                      Nº {nota.numero}{nota.serie ? ` · Série ${nota.serie}` : ""}
                    </p>
                    {nota.descricao && (
                      <p className="text-xs text-slate-500 truncate">{nota.descricao}</p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-xs text-slate-500">
                      {new Date(nota.dataEmissao).toLocaleDateString("pt-BR")}
                    </p>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${statusBadge(nota)}`}>
                      {nota.cancelada ? "Cancelada" : nota.status}
                    </span>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold text-slate-700">
                      {nota.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4">
            <a
              href="https://app.diginfe.com.br/#/notas-fiscais"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-600 hover:underline"
            >
              Abrir Diginfe →
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AlunoDetalhe({ aluno: initial, concursos = [] }: { aluno: Aluno; concursos?: string[] }) {
  const router = useRouter();
  const { data: session } = useSession();
  const [aluno, setAluno] = useState<Aluno>(initial);
  const [tipoContato, setTipoContato] = useState<"mentor" | "equipe">("equipe");
  const [obsContato, setObsContato] = useState("");
  const [dataContato, setDataContato] = useState(() => new Date().toISOString().slice(0, 10));
  const [savingContato, setSavingContato] = useState(false);
  const [savingAtivo, setSavingAtivo] = useState(false);
  const [editandoTutoryId, setEditandoTutoryId] = useState(false);
  const [tutoryIdInput, setTutoryIdInput] = useState("");
  const [editandoPlanilha, setEditandoPlanilha] = useState(false);
  const [planilhaInput, setPlanilhaInput] = useState("");
  const [editandoDados, setEditandoDados] = useState(false);
  const [dadosForm, setDadosForm] = useState({ nome: "", email: "", cpf: "", whatsapp: "", concurso: "" });
  const [savingDados, setSavingDados] = useState(false);

  function abrirEdicao() {
    setDadosForm({ nome: aluno.nome, email: aluno.email, cpf: aluno.cpf, whatsapp: aluno.whatsapp, concurso: aluno.concurso });
    setEditandoDados(true);
  }

  async function salvarDados(e: React.FormEvent) {
    e.preventDefault();
    setSavingDados(true);
    await patchAluno(dadosForm as Partial<Aluno>);
    setSavingDados(false);
    setEditandoDados(false);
  }

  async function patchAluno(campos: Partial<Aluno>) {
    const res = await fetch(`/api/alunos/${aluno.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(campos),
    });
    if (res.ok) setAluno((prev) => ({ ...prev, ...campos }));
  }

  async function toggleAtivo() {
    setSavingAtivo(true);
    await patchAluno({ ativo: !aluno.ativo } as Partial<Aluno>);
    setSavingAtivo(false);
  }


  async function salvarDisc(nome: string, nota: number) {
    await patchAluno({ discMaisBaixaNome: nome, discMaisBaixaNota: nota } as Partial<Aluno>);
  }

  async function salvarAssunto(nome: string, nota: number) {
    await patchAluno({ assuntoMaisBaixoNome: nome, assuntoMaisBaixoNota: nota } as Partial<Aluno>);
  }

  async function registrarContato(e: React.FormEvent) {
    e.preventDefault();
    setSavingContato(true);
    const res = await fetch(`/api/alunos/${aluno.id}/contatos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipo: tipoContato, obs: obsContato, data: dataContato || undefined }),
    });
    if (res.ok) {
      const novo = await res.json();
      setAluno((prev) => ({
        ...prev,
        contatos: [{ ...novo, user: { name: session?.user?.name ?? "" } }, ...prev.contatos],
      }));
      setObsContato("");
      setDataContato(new Date().toISOString().slice(0, 10));
    }
    setSavingContato(false);
  }

  async function deletarContato(contatoId: string) {
    const res = await fetch(`/api/contatos/${contatoId}`, { method: "DELETE" });
    if (res.ok) {
      setAluno((prev) => ({ ...prev, contatos: prev.contatos.filter((c) => c.id !== contatoId) }));
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <button onClick={() => router.back()} className="text-sm text-slate-500 hover:underline">
        ← Voltar
      </button>

      <div className="bg-white rounded-xl border border-slate-200 p-6">
        {editandoDados ? (
          <form onSubmit={salvarDados} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Nome</label>
                <input value={dadosForm.nome} onChange={e => setDadosForm(p => ({ ...p, nome: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required />
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">WhatsApp</label>
                <input value={dadosForm.whatsapp} onChange={e => setDadosForm(p => ({ ...p, whatsapp: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">Email</label>
                <input value={dadosForm.email} onChange={e => setDadosForm(p => ({ ...p, email: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" required />
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">CPF</label>
                <input value={dadosForm.cpf} onChange={e => setDadosForm(p => ({ ...p, cpf: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="sm:col-span-2">
                <label className="text-xs text-slate-500 mb-1 block">Concurso</label>
                <select
                  value={dadosForm.concurso}
                  onChange={e => setDadosForm(p => ({ ...p, concurso: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="">— Sem concurso —</option>
                  {concursos.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                  {dadosForm.concurso && !concursos.includes(dadosForm.concurso) && (
                    <option value={dadosForm.concurso}>{dadosForm.concurso}</option>
                  )}
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={savingDados}
                className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition disabled:opacity-50">
                {savingDados ? "Salvando..." : "Salvar"}
              </button>
              <button type="button" onClick={() => setEditandoDados(false)}
                className="text-sm text-slate-500 hover:underline px-2">
                Cancelar
              </button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-slate-800">{aluno.nome}</h1>
                <button onClick={abrirEdicao} className="text-slate-400 hover:text-blue-600 transition" title="Editar dados">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
              </div>
              <p className="text-sm text-slate-500">{aluno.email}</p>
              {aluno.cpf && <p className="text-xs text-slate-400">CPF: {aluno.cpf}</p>}
              {aluno.concurso && (
                <span className="inline-block mt-1 text-xs bg-indigo-50 text-indigo-700 font-medium px-2 py-0.5 rounded-full">
                  {aluno.concurso}
                </span>
              )}
              {/* ID Tutory */}
              <div className="mt-2 flex items-center gap-2">
                {editandoTutoryId ? (
                  <form className="flex items-center gap-1" onSubmit={async (e) => {
                    e.preventDefault();
                    await patchAluno({ tutoryId: tutoryIdInput ? Number(tutoryIdInput) : null } as Partial<Aluno>);
                    setEditandoTutoryId(false);
                  }}>
                    <input
                      autoFocus
                      type="number"
                      value={tutoryIdInput}
                      onChange={e => setTutoryIdInput(e.target.value)}
                      placeholder="ID Tutory"
                      className="border border-slate-300 rounded px-2 py-0.5 text-xs w-28 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <button type="submit" className="text-xs text-blue-600 hover:underline">Salvar</button>
                    <button type="button" onClick={() => setEditandoTutoryId(false)} className="text-xs text-slate-400 hover:underline">Cancelar</button>
                  </form>
                ) : aluno.tutoryId ? (
                  <a
                    href={`https://admin.tutory.com.br/alunos/index?aid=${aluno.tutoryId}`}
                    target="_blank" rel="noopener noreferrer"
                    className="text-xs text-blue-600 hover:underline flex items-center gap-1"
                  >
                    Ver no Tutory #{aluno.tutoryId}
                  </a>
                ) : (
                  <button
                    onClick={() => { setTutoryIdInput(""); setEditandoTutoryId(true); }}
                    className="text-xs text-slate-400 hover:text-blue-600 hover:underline"
                  >
                    + Vincular ID Tutory
                  </button>
                )}
                {aluno.tutoryId && !editandoTutoryId && (
                  <button onClick={() => { setTutoryIdInput(String(aluno.tutoryId ?? "")); setEditandoTutoryId(true); }}
                    className="text-xs text-slate-300 hover:text-slate-500">✏️</button>
                )}
              </div>

              {/* Planilha Google Drive */}
              <div className="flex items-center gap-2 mt-1 flex-wrap">
                {editandoPlanilha ? (
                  <form className="flex items-center gap-1 flex-wrap" onSubmit={async (e) => {
                    e.preventDefault();
                    await patchAluno({ planilhaUrl: planilhaInput || null } as Partial<Aluno>);
                    setEditandoPlanilha(false);
                  }}>
                    <input
                      value={planilhaInput}
                      onChange={e => setPlanilhaInput(e.target.value)}
                      placeholder="Link do Google Sheets"
                      className="border border-slate-300 rounded px-2 py-0.5 text-xs w-64 focus:outline-none focus:ring-1 focus:ring-green-500"
                    />
                    <button type="submit" className="text-xs text-green-600 hover:underline">Salvar</button>
                    <button type="button" onClick={() => setEditandoPlanilha(false)} className="text-xs text-slate-400 hover:underline">Cancelar</button>
                  </form>
                ) : aluno.planilhaUrl ? (
                  <>
                    <svg className="w-4 h-4 text-green-600 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M19.5 3h-15A1.5 1.5 0 003 4.5v15A1.5 1.5 0 004.5 21h15a1.5 1.5 0 001.5-1.5v-15A1.5 1.5 0 0019.5 3zM8 17H6v-7h2v7zm4 0h-2V7h2v10zm4 0h-2v-4h2v4z"/>
                    </svg>
                    <a href={aluno.planilhaUrl} target="_blank" rel="noopener noreferrer"
                      className="text-xs text-green-700 hover:underline font-medium">
                      Planilha do Aluno
                    </a>
                    <button onClick={() => { setPlanilhaInput(aluno.planilhaUrl ?? ""); setEditandoPlanilha(true); }}
                      className="text-xs text-slate-300 hover:text-slate-500">✏️</button>
                  </>
                ) : (
                  <button onClick={() => { setPlanilhaInput(""); setEditandoPlanilha(true); }}
                    className="text-xs text-slate-400 hover:text-green-600 hover:underline">
                    + Vincular Planilha
                  </button>
                )}
              </div>
            </div>

            <div className="flex items-center gap-4 self-start">
              <label className="flex items-center gap-2 cursor-pointer select-none bg-orange-50 border border-orange-200 rounded-lg px-3 py-2">
                <input
                  type="checkbox"
                  checked={aluno.acompanharDePerto}
                  onChange={(e) => patchAluno({ acompanharDePerto: e.target.checked } as Partial<Aluno>)}
                  className="w-4 h-4 accent-orange-500 cursor-pointer"
                />
                <span className="text-sm font-medium text-orange-700">Acompanhar de Perto</span>
              </label>
              <a href={whatsappUrl(aluno.whatsapp)} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-2 bg-green-500 hover:bg-green-600 text-white text-sm font-semibold px-4 py-2 rounded-full transition">
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                </svg>
                {aluno.whatsapp}
              </a>
            </div>
          </div>
        )}

        <div className="mt-6 grid grid-cols-2 sm:grid-cols-5 gap-4">
          {/* Status */}
          <div className="bg-slate-50 rounded-lg p-4">
            <p className="text-xs text-slate-500 mb-2">Status</p>
            <button
              onClick={toggleAtivo}
              disabled={savingAtivo}
              className={`px-4 py-1.5 rounded-full text-sm font-semibold transition disabled:opacity-50 ${
                aluno.ativo
                  ? "bg-blue-600 hover:bg-blue-700 text-white"
                  : "bg-slate-200 hover:bg-slate-300 text-slate-600"
              }`}
            >
              {aluno.ativo ? "Ativo" : "Inativo"}
            </button>
          </div>

          {/* Taxa de Acertos */}
          <div className={`rounded-lg p-4 ${aluno.taxaAcertos > 0 ? taxaCor(aluno.taxaAcertos).bg : "bg-slate-50"}`}>
            <p className="text-xs text-slate-500 mb-1">Taxa de Acertos</p>
            {aluno.taxaAcertos > 0 ? (
              <div>
                <p className={`text-2xl font-bold ${taxaCor(aluno.taxaAcertos).text}`}>
                  {aluno.taxaAcertos.toFixed(1)}%
                </p>
                <p className="text-xs text-slate-400 mt-0.5">{aluno.totalQuestoes.toLocaleString("pt-BR")} questões</p>
              </div>
            ) : (
              <p className="text-lg font-bold text-slate-300">—</p>
            )}
          </div>

          {/* Disciplina mais baixa */}
          <CardEditavel
            label="Disciplina mais baixa"
            nome={aluno.discMaisBaixaNome}
            nota={aluno.discMaisBaixaNota}
            onSave={salvarDisc}
          />

          {/* Assunto mais baixo */}
          <CardEditavel
            label="Assunto mais baixo"
            nome={aluno.assuntoMaisBaixoNome}
            nota={aluno.assuntoMaisBaixoNota}
            onSave={salvarAssunto}
          />

          {/* Metas Tutory */}
          <div className="bg-slate-50 rounded-lg p-4">
            <p className="text-xs text-slate-500 mb-2">Metas (Tutory)</p>
            {aluno.diasAtraso > 0 ? (
              <div className="flex flex-col gap-1">
                <span className="inline-flex items-center gap-1.5 text-sm font-bold text-orange-600">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {aluno.diasAtraso} dia{aluno.diasAtraso !== 1 ? "s" : ""} de atraso
                </span>
                <span className="text-xs text-orange-500">Meta Atrasada</span>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                <span className="inline-flex items-center gap-1.5 text-sm font-bold text-green-600">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Em dia
                </span>
                <span className="text-xs text-green-500">Metas ok</span>
              </div>
            )}
          </div>
        </div>

        {/* Plano */}
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Tipo do Plano */}
          <div className="bg-slate-50 rounded-lg p-4">
            <p className="text-xs text-slate-500 mb-2">Tipo do Plano</p>
            <div className="flex flex-wrap gap-1.5">
              {(["Mentoria da Posse", "Mentoria Diamante", "Cronograma Ouro", "Cronograma Outros"] as const).map((tipo) => (
                <button
                  key={tipo}
                  onClick={() => patchAluno({ planoTipo: tipo } as Partial<Aluno>)}
                  className={`px-3 py-1 rounded-full text-xs font-semibold transition ${
                    aluno.planoTipo === tipo
                      ? "bg-indigo-600 text-white"
                      : "bg-white border border-slate-300 text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {tipo}
                </button>
              ))}
              {aluno.planoTipo && (
                <button
                  onClick={() => patchAluno({ planoTipo: "" } as Partial<Aluno>)}
                  className="px-2 py-1 rounded-full text-xs text-slate-400 hover:text-red-500 transition"
                  title="Remover plano"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Datas */}
          <div className="bg-slate-50 rounded-lg p-4">
            <div className="flex gap-6">
              <div>
                <p className="text-xs text-slate-500 mb-2">Data de Início</p>
                <input
                  type="date"
                  value={aluno.dataInicio ? aluno.dataInicio.slice(0, 10) : ""}
                  onChange={(e) => patchAluno({ dataInicio: e.target.value || null } as Partial<Aluno>)}
                  className="text-sm bg-white border border-slate-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-2">Vencimento do Plano</p>
                <input
                  type="date"
                  value={aluno.planoVencimento ? aluno.planoVencimento.slice(0, 10) : ""}
                  onChange={(e) => patchAluno({ planoVencimento: e.target.value || null } as Partial<Aluno>)}
                  className="text-sm bg-white border border-slate-300 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Dados Pessoais (briefing) */}
      {(aluno.dataNascimento || aluno.cidade || aluno.estado || aluno.endereco || aluno.bio) && (
        <div className="bg-white rounded-xl border border-slate-200 p-6">
          <h2 className="text-base font-semibold text-slate-700 mb-4">Dados Pessoais</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {aluno.dataNascimento && (
              <div>
                <p className="text-xs text-slate-400 mb-0.5">Data de Nascimento</p>
                <p className="text-sm text-slate-700">
                  {new Date(aluno.dataNascimento).toLocaleDateString("pt-BR", { timeZone: "UTC" })}
                </p>
              </div>
            )}
            {aluno.cidade && (
              <div>
                <p className="text-xs text-slate-400 mb-0.5">Cidade</p>
                <p className="text-sm text-slate-700">{aluno.cidade}</p>
              </div>
            )}
            {aluno.estado && (
              <div>
                <p className="text-xs text-slate-400 mb-0.5">Estado</p>
                <p className="text-sm text-slate-700">{aluno.estado}</p>
              </div>
            )}
            {aluno.endereco && (
              <div>
                <p className="text-xs text-slate-400 mb-0.5">Endereço</p>
                <p className="text-sm text-slate-700">{aluno.endereco}</p>
              </div>
            )}
            {aluno.bio && (
              <div className="sm:col-span-2">
                <p className="text-xs text-slate-400 mb-0.5">Bio</p>
                <p className="text-sm text-slate-700 whitespace-pre-line">{aluno.bio}</p>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="grid sm:grid-cols-2 gap-6">
        {/* Conquistas */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xl">🏆</span>
            <h2 className="text-base font-semibold text-slate-700">Conquistas</h2>
            <span className="ml-auto text-xs text-slate-400 font-medium">{aluno.conquistas.length} selo{aluno.conquistas.length !== 1 ? "s" : ""}</span>
          </div>
          {aluno.conquistas.length === 0 ? (
            <p className="text-sm text-slate-400">Nenhuma conquista registrada ainda.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {aluno.conquistas.map((c) => (
                <div
                  key={c.id}
                  title={`${c.horas.toFixed(1)}h estudadas`}
                  className="flex flex-col items-center gap-1 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-center"
                >
                  <span className="text-2xl">🏆</span>
                  <span className="text-xs font-semibold text-amber-700">Engajamento</span>
                  <span className="text-xs text-amber-600">{new Date(c.semana).toLocaleDateString("pt-BR")}</span>
                  <span className="text-xs text-slate-500">{c.horas.toFixed(1)}h</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-6 space-y-4">
          <h2 className="text-base font-semibold text-slate-700">Registrar Contato</h2>
          <form onSubmit={registrarContato} className="space-y-3">
            <div className="flex gap-2">
              {(["equipe", "mentor"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTipoContato(t)}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium border transition capitalize ${
                    tipoContato === t
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">Data do contato</label>
              <input
                type="date"
                value={dataContato}
                onChange={(e) => setDataContato(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <textarea
              value={obsContato}
              onChange={(e) => setObsContato(e.target.value)}
              placeholder="Observações (opcional)..."
              rows={3}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
            <button
              type="submit"
              disabled={savingContato}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold py-2 rounded-lg transition disabled:opacity-50"
            >
              {savingContato ? "Registrando..." : "Registrar contato"}
            </button>
          </form>

          <div className="mt-4">
            <h3 className="text-sm font-semibold text-slate-600 mb-3">Histórico de Contatos</h3>
            {aluno.contatos.length === 0 ? (
              <p className="text-sm text-slate-400">Nenhum contato registrado</p>
            ) : (
              <div className="space-y-3 max-h-64 overflow-y-auto">
                {aluno.contatos.map((c) => (
                  <div key={c.id} className="border-l-2 border-blue-200 pl-3 group relative">
                    <div className="flex items-center gap-2 text-xs text-slate-500">
                      <span>{new Date(c.data).toLocaleDateString("pt-BR")}</span>
                      <span className="capitalize font-medium text-blue-600">{c.tipo}</span>
                      <span>&middot; {c.user.name}</span>
                      <button
                        onClick={() => deletarContato(c.id)}
                        className="ml-auto opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500 transition"
                        title="Apagar contato"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                    {c.obs && <p className="text-sm text-slate-600 mt-0.5">{c.obs}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>

      {/* NF-e / NFS-e */}
      {aluno.cpf && <NotasFiscaisSection cpf={aluno.cpf} />}

      {/* Disciplinas e Assuntos */}
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <h2 className="text-base font-semibold text-slate-700 mb-4">Disciplinas e Assuntos</h2>
        {aluno.disciplinas.length === 0 ? (
          <p className="text-sm text-slate-400">Nenhuma disciplina cadastrada</p>
        ) : (
          <div className="space-y-4">
            {aluno.disciplinas.map((d) => (
              <div key={d.id}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-slate-700">{d.nome}</span>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${notaBadge(d.nota)}`}>
                    {d.nota.toFixed(1)}
                  </span>
                </div>
                {d.assuntos.length > 0 && (
                  <div className="pl-3 space-y-1">
                    {d.assuntos.map((a) => (
                      <div key={a.id} className="flex items-center justify-between">
                        <span className="text-xs text-slate-500">{a.nome}</span>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${notaBadge(a.nota)}`}>
                          {a.nota.toFixed(1)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
