"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
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
  mesAtual: string;
  mesesDisponiveis: string[];
};

const PLANOS = ["Mentoria da Posse", "Mentoria Diamante", "Cronograma Ouro", "Cronograma Outros"];

const MESES_NOMES: Record<number, string> = {
  1: "Janeiro", 2: "Fevereiro", 3: "Março", 4: "Abril", 5: "Maio", 6: "Junho",
  7: "Julho", 8: "Agosto", 9: "Setembro", 10: "Outubro", 11: "Novembro", 12: "Dezembro",
};

function fmtMes(mesStr: string) {
  const [ano, mes] = mesStr.split("-").map(Number);
  return `${MESES_NOMES[mes]} ${ano}`;
}

function fmtSemana(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" });
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

function extrairNome(nomeCompleto: string): string {
  const semEmoji = nomeCompleto.replace(/\p{Extended_Pictographic}/gu, "").trim();
  const partes = semEmoji.split(/\s+/).filter(Boolean);
  if (partes.length === 0) return nomeCompleto.trim();
  const primeiro = partes[0];
  if (primeiro.toLowerCase() === "maria" && partes.length >= 2) {
    return `${primeiro} ${partes[1]}`;
  }
  return primeiro;
}

function whatsappUrlMsg(numero: string, primeiroNome: string, msg: string) {
  const limpo = numero.replace(/\D/g, "");
  const texto = msg.replace(/\[nome\]/gi, primeiroNome);
  return `https://wa.me/${limpo}?text=${encodeURIComponent(texto)}`;
}

const MSG_PADRAO =
  "Olá, [nome]! 🏆 Você conquistou o selo de engajamento esta semana! Parabéns pelo seu empenho e dedicação! Continue assim! 💪";

const PLANOS_DISPARO = ["Mentoria da Posse", "Mentoria Diamante"];


export default function AlunosEngajadosClient({ conquistas, concursos, sextas, mesAtual, mesesDisponiveis }: Props) {
  const router = useRouter();
  const [planoFiltro, setPlanoFiltro] = useState<string[]>([]);
  const [concursoFiltro, setConcursoFiltro] = useState<string[]>([]);
  const [sextaFiltro, setSextaFiltro] = useState<string>(""); // "" = todas
  const [planoOpen, setPlanoOpen] = useState(false);
  const [concursoOpen, setConcursoOpen] = useState(false);
  const planoRef = useRef<HTMLDivElement>(null);
  const concursoRef = useRef<HTMLDivElement>(null);

  // ── Disparo WhatsApp
  type FaseDisparo = "config" | "enviando" | "resultado" | null;
  type Resultado = { id: string; nome: string; ok: boolean; erro?: string };
  const [disparo, setDisparo] = useState<FaseDisparo>(null);
  const [mensagem, setMensagem] = useState(MSG_PADRAO);
  const [imagem, setImagem] = useState<string | null>(null);
  const [resultados, setResultados] = useState<Resultado[]>([]);
  const [enviando, setEnviando] = useState(false);

  function handleImagem(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setImagem(reader.result as string);
    reader.readAsDataURL(file);
  }

  // Reset sexta filter when month changes
  useEffect(() => { setSextaFiltro(""); }, [mesAtual]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (planoRef.current && !planoRef.current.contains(e.target as Node)) setPlanoOpen(false);
      if (concursoRef.current && !concursoRef.current.contains(e.target as Node)) setConcursoOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const alunoMap = new Map<string, { aluno: Aluno; semanas: { semana: string; horas: number }[] }>();
  for (const c of conquistas) {
    const key = c.aluno.id;
    if (!alunoMap.has(key)) alunoMap.set(key, { aluno: c.aluno, semanas: [] });
    alunoMap.get(key)!.semanas.push({ semana: c.semana, horas: c.horas });
  }

  // Sextas visíveis na tabela (todas ou só a selecionada)
  const sextasVisiveis = sextaFiltro ? sextas.filter((s) => s === sextaFiltro) : sextas;

  let entries = Array.from(alunoMap.values());
  // Quando uma sexta específica está selecionada, mostra só quem tem selo nela
  if (sextaFiltro) entries = entries.filter((e) => e.semanas.some((s) => s.semana === sextaFiltro));
  if (planoFiltro.length > 0) entries = entries.filter((e) => planoFiltro.includes(e.aluno.planoTipo));
  if (concursoFiltro.length > 0) entries = entries.filter((e) => concursoFiltro.includes(e.aluno.concurso));
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

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Alunos Engajados</h1>
        <p className="text-sm text-slate-500 mt-1">
          Selos de engajamento em <span className="font-medium">{fmtMes(mesAtual)}</span>
          {sextas.length > 0 && (
            <> — sextas: {sextas.map(fmtSemana).join(", ")}</>
          )}
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

        {/* Mês/Ano selector */}
        <select
          value={mesAtual}
          onChange={(e) => router.push(`/alunos-engajados?mes=${e.target.value}`)}
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white hover:bg-slate-50 text-slate-600 cursor-pointer"
        >
          {mesesDisponiveis.map((m) => (
            <option key={m} value={m}>{fmtMes(m)}</option>
          ))}
        </select>

        {/* Sexta selector */}
        <select
          value={sextaFiltro}
          onChange={(e) => setSextaFiltro(e.target.value)}
          className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white hover:bg-slate-50 text-slate-600 cursor-pointer"
        >
          <option value="">Todas as sextas</option>
          {sextas.map((s) => (
            <option key={s} value={s}>{fmtSemana(s)}</option>
          ))}
        </select>

        <div className="flex items-center text-sm text-slate-500 ml-1">
          {entries.length} aluno{entries.length !== 1 ? "s" : ""}
        </div>

        {/* Botão disparo */}
        {entries.some((e) => e.aluno.whatsapp && PLANOS_DISPARO.includes(e.aluno.planoTipo)) && (
          <button
            onClick={() => { setResultados([]); setImagem(null); setDisparo("config"); }}
            className="ml-auto flex items-center gap-2 bg-green-500 hover:bg-green-600 text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
          >
            📲 Disparar WhatsApp
          </button>
        )}
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
              {sextasVisiveis.map((s) => (
                <th key={s} className="px-4 py-3 text-center">{fmtSemana(s)}</th>
              ))}
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr>
                <td colSpan={6 + sextasVisiveis.length} className="px-4 py-8 text-center text-slate-400">
                  Nenhum aluno engajado neste mês.
                </td>
              </tr>
            )}
            {entries.map(({ aluno, semanas }, idx) => {
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
                  {sextasVisiveis.map((s) => {
                    const horas = horasPorSemana[s];
                    return (
                      <td key={s} className="px-4 py-3 text-center">
                        {horas !== undefined ? (
                          <span className="inline-flex flex-col items-center">
                            <span className="text-lg">🏆</span>
                            <span className="text-xs text-slate-500">{fmtHoras(horas)}</span>
                          </span>
                        ) : (
                          <span className="text-slate-200 text-lg">—</span>
                        )}
                      </td>
                    );
                  })}
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

      {/* ── Modal de disparo WhatsApp ── */}
      {disparo && (() => {
        // Sexta do disparo: a selecionada no filtro, ou a sexta de hoje, ou a mais recente do mês
        const hoje = new Date().toISOString().slice(0, 10);
        const sextaDisparo =
          sextaFiltro ||                                          // filtro ativo
          sextas.find((s) => s.slice(0, 10) === hoje) ||         // hoje é sexta com dados
          sextas[sextas.length - 1] ||                           // mais recente do mês
          "";

        // Somente Mentoria da Posse e Mentoria Diamante,
        // com WhatsApp cadastrado e com selo NA sexta do disparo
        const comWpp = entries.filter(
          (e) =>
            e.aluno.whatsapp &&
            PLANOS_DISPARO.includes(e.aluno.planoTipo) &&
            (sextaDisparo ? e.semanas.some((s) => s.semana === sextaDisparo) : true)
        );

        const labelSexta = sextaDisparo
          ? new Date(sextaDisparo).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "UTC" })
          : "—";

        async function disparar() {
          setEnviando(true);
          setDisparo("enviando");
          try {
            const res = await fetch("/api/whatsapp/disparar", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                mensagem,
                imagem: imagem ?? undefined,
                alunos: comWpp.map((e) => ({
                  id: e.aluno.id,
                  nome: e.aluno.nome,
                  whatsapp: e.aluno.whatsapp,
                })),
              }),
            });
            const json = await res.json() as { enviados: number; falhas: number; resultados: Resultado[] };
            setResultados(json.resultados ?? []);
            setDisparo("resultado");
          } catch {
            setDisparo("config");
          } finally {
            setEnviando(false);
          }
        }

        // ── Tela de configuração
        if (disparo === "config") {
          return (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-6 space-y-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-lg font-bold text-slate-800">📲 Disparar WhatsApp</h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Alunos engajados em <span className="font-semibold text-green-600">{labelSexta}</span>
                    </p>
                  </div>
                  <button onClick={() => setDisparo(null)} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">
                    Mensagem <span className="text-slate-400 font-normal">— use [nome] para personalizar</span>
                  </label>
                  <textarea
                    value={mensagem}
                    onChange={(e) => setMensagem(e.target.value)}
                    rows={5}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
                  />
                  <p className="text-xs text-slate-400 mt-1">
                    Preview: {mensagem.replace(/\[nome\]/gi, comWpp[0] ? extrairNome(comWpp[0].aluno.nome) : "Aluno")}
                  </p>
                </div>

                {/* Upload de imagem */}
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Imagem <span className="text-slate-400 font-normal">(obrigatória)</span></label>
                  <label className="flex items-center gap-3 cursor-pointer border-2 border-dashed border-slate-300 hover:border-green-400 rounded-xl p-3 transition">
                    <span className="text-2xl">{imagem ? "🖼️" : "📁"}</span>
                    <span className="text-sm text-slate-600">
                      {imagem ? "Imagem selecionada — clique para trocar" : "Clique para selecionar a imagem"}
                    </span>
                    <input type="file" accept="image/*" onChange={handleImagem} className="hidden" />
                  </label>
                  {imagem && (
                    <div className="mt-2 flex items-center gap-3">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={imagem} alt="preview" className="h-16 w-16 object-cover rounded-lg border border-slate-200" />
                      <button onClick={() => setImagem(null)} className="text-xs text-red-500 hover:underline">Remover</button>
                    </div>
                  )}
                </div>

                <div className="bg-slate-50 rounded-lg p-3 text-sm text-slate-600 max-h-40 overflow-y-auto space-y-1">
                  {comWpp.map((e, i) => (
                    <div key={e.aluno.id} className="flex items-center gap-2">
                      <span className="text-slate-400 text-xs w-5 text-right">{i + 1}.</span>
                      <span className="font-medium">{e.aluno.nome}</span>
                      <span className="text-slate-400 text-xs">{e.aluno.whatsapp}</span>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-slate-500">
                  Mentoria da Posse + Mentoria Diamante · engajados em {labelSexta} · {comWpp.length} aluno{comWpp.length !== 1 ? "s" : ""} com WhatsApp
                </p>

                <div className="flex gap-3">
                  <button
                    onClick={disparar}
                    disabled={!imagem}
                    className="flex-1 bg-green-500 hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-2 rounded-lg text-sm transition"
                    title={!imagem ? "Selecione uma imagem antes de enviar" : ""}
                  >
                    🚀 Enviar para todos ({comWpp.length})
                  </button>
                  <button onClick={() => setDisparo(null)} className="flex-1 border border-slate-300 text-slate-600 text-sm font-medium py-2 rounded-lg hover:bg-slate-50 transition">
                    Cancelar
                  </button>
                </div>
              </div>
            </div>
          );
        }

        // ── Tela de enviando (aguardando)
        if (disparo === "enviando") {
          return (
            <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
              <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-8 text-center space-y-4">
                <div className="text-4xl animate-bounce">📲</div>
                <p className="font-semibold text-slate-800">Enviando mensagens…</p>
                <p className="text-sm text-slate-500">
                  Aguarde — enviando para {comWpp.length} aluno{comWpp.length !== 1 ? "s" : ""} com intervalo de 2s entre cada envio.
                </p>
                <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                  <div className="h-2 bg-green-400 rounded-full animate-pulse w-full" />
                </div>
              </div>
            </div>
          );
        }

        // ── Tela de resultado
        const enviados = resultados.filter((r) => r.ok).length;
        const falhas   = resultados.filter((r) => !r.ok);
        return (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-slate-800">📲 Resultado do disparo</h2>
                <button onClick={() => setDisparo(null)} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="bg-green-50 border border-green-200 rounded-xl p-4 text-center">
                  <p className="text-3xl font-bold text-green-600">{enviados}</p>
                  <p className="text-xs text-green-700 mt-1">Enviado{enviados !== 1 ? "s" : ""} ✓</p>
                </div>
                <div className={`border rounded-xl p-4 text-center ${falhas.length > 0 ? "bg-red-50 border-red-200" : "bg-slate-50 border-slate-200"}`}>
                  <p className={`text-3xl font-bold ${falhas.length > 0 ? "text-red-500" : "text-slate-400"}`}>{falhas.length}</p>
                  <p className={`text-xs mt-1 ${falhas.length > 0 ? "text-red-600" : "text-slate-400"}`}>Falha{falhas.length !== 1 ? "s" : ""}</p>
                </div>
              </div>

              {falhas.length > 0 && (
                <div className="bg-red-50 rounded-lg p-3 space-y-1 max-h-40 overflow-y-auto">
                  <p className="text-xs font-semibold text-red-700 mb-1">Não enviados:</p>
                  {falhas.map((f) => (
                    <div key={f.id} className="text-xs text-red-600">
                      <span className="font-medium">{f.nome}</span>
                      {f.erro && <span className="text-red-400"> — {f.erro}</span>}
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={() => setDisparo(null)}
                className="w-full bg-green-500 hover:bg-green-600 text-white font-semibold py-2 rounded-lg text-sm transition"
              >
                Fechar
              </button>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
