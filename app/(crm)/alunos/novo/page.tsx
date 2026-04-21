"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Assunto = { nome: string; nota: string };
type Disciplina = { nome: string; nota: string; assuntos: Assunto[] };

export default function NovoAlunoPage() {
  const router = useRouter();
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [cpf, setCpf] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [concurso, setConcurso] = useState("");
  const [mediaGeral, setMediaGeral] = useState("");
  const [disciplinas, setDisciplinas] = useState<Disciplina[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function addDisciplina() {
    setDisciplinas([...disciplinas, { nome: "", nota: "", assuntos: [] }]);
  }

  function removeDisciplina(i: number) {
    setDisciplinas(disciplinas.filter((_, idx) => idx !== i));
  }

  function updateDisciplina(i: number, field: keyof Disciplina, value: string) {
    setDisciplinas(disciplinas.map((d, idx) => (idx === i ? { ...d, [field]: value } : d)));
  }

  function addAssunto(di: number) {
    setDisciplinas(
      disciplinas.map((d, idx) =>
        idx === di ? { ...d, assuntos: [...d.assuntos, { nome: "", nota: "" }] } : d
      )
    );
  }

  function removeAssunto(di: number, ai: number) {
    setDisciplinas(
      disciplinas.map((d, idx) =>
        idx === di ? { ...d, assuntos: d.assuntos.filter((_, j) => j !== ai) } : d
      )
    );
  }

  function updateAssunto(di: number, ai: number, field: keyof Assunto, value: string) {
    setDisciplinas(
      disciplinas.map((d, idx) =>
        idx === di
          ? { ...d, assuntos: d.assuntos.map((a, j) => (j === ai ? { ...a, [field]: value } : a)) }
          : d
      )
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/alunos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome,
        email,
        cpf,
        whatsapp,
        concurso,
        mediaGeral: parseFloat(mediaGeral) || 0,
        disciplinas: disciplinas.map((d) => ({
          nome: d.nome,
          nota: parseFloat(d.nota) || 0,
          assuntos: d.assuntos.map((a) => ({ nome: a.nome, nota: parseFloat(a.nota) || 0 })),
        })),
      }),
    });
    setLoading(false);
    if (res.ok) {
      router.push("/alunos");
    } else {
      setError("Erro ao cadastrar aluno.");
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-slate-800 mb-6">Novo Aluno</h1>
      <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 p-6 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-slate-700 mb-1">Nome</label>
            <input
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              required
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">CPF</label>
            <input
              value={cpf}
              onChange={(e) => setCpf(e.target.value)}
              placeholder="000.000.000-00"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">WhatsApp / Celular</label>
            <input
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              placeholder="5511999999999"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Concurso</label>
            <input
              value={concurso}
              onChange={(e) => setConcurso(e.target.value)}
              placeholder="Ex: PCSP 2025"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Média Geral</label>
            <input
              type="number"
              step="0.1"
              min="0"
              max="10"
              value={mediaGeral}
              onChange={(e) => setMediaGeral(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-3">
            <label className="text-sm font-medium text-slate-700">Disciplinas</label>
            <button type="button" onClick={addDisciplina} className="text-xs text-blue-600 hover:underline">
              + Adicionar disciplina
            </button>
          </div>
          <div className="space-y-3">
            {disciplinas.map((d, di) => (
              <div key={di} className="border border-slate-200 rounded-lg p-4 space-y-3">
                <div className="flex gap-3 items-center">
                  <input
                    placeholder="Nome da disciplina"
                    value={d.nome}
                    onChange={(e) => updateDisciplina(di, "nome", e.target.value)}
                    className="flex-1 border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <input
                    type="number" step="0.1" min="0" max="10" placeholder="Nota"
                    value={d.nota}
                    onChange={(e) => updateDisciplina(di, "nota", e.target.value)}
                    className="w-20 border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <button type="button" onClick={() => removeDisciplina(di)} className="text-red-400 hover:text-red-600 text-xs">
                    Remover
                  </button>
                </div>
                <div className="pl-4 space-y-2">
                  {d.assuntos.map((a, ai) => (
                    <div key={ai} className="flex gap-2 items-center">
                      <input
                        placeholder="Assunto"
                        value={a.nome}
                        onChange={(e) => updateAssunto(di, ai, "nome", e.target.value)}
                        className="flex-1 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <input
                        type="number" step="0.1" min="0" max="10" placeholder="Nota"
                        value={a.nota}
                        onChange={(e) => updateAssunto(di, ai, "nota", e.target.value)}
                        className="w-20 border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                      <button type="button" onClick={() => removeAssunto(di, ai)} className="text-red-400 hover:text-red-600 text-xs">×</button>
                    </div>
                  ))}
                  <button type="button" onClick={() => addAssunto(di)} className="text-xs text-slate-400 hover:text-blue-500">
                    + Assunto
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}
        <div className="flex gap-3 pt-2">
          <button
            type="submit" disabled={loading}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-5 py-2 rounded-lg transition disabled:opacity-50"
          >
            {loading ? "Salvando..." : "Salvar"}
          </button>
          <button type="button" onClick={() => router.back()} className="text-sm text-slate-500 hover:underline">
            Cancelar
          </button>
        </div>
      </form>
    </div>
  );
}
