"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";

type Usuario = {
  id: string;
  name: string;
  email: string;
  role: string;
  createdAt: string;
};

type FormData = {
  name: string;
  email: string;
  password: string;
  role: "equipe" | "mentor";
};

const emptyForm: FormData = { name: "", email: "", password: "", role: "equipe" };

export default function UsuariosClient({
  initialUsuarios,
  isAdmin,
}: {
  initialUsuarios: Usuario[];
  isAdmin: boolean;
}) {
  const { data: session } = useSession();
  const [usuarios, setUsuarios] = useState<Usuario[]>(initialUsuarios);
  const [showModal, setShowModal] = useState(false);
  const [editando, setEditando] = useState<Usuario | null>(null);
  const [form, setForm] = useState<FormData>(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<Usuario | null>(null);

  function abrirNovo() {
    setEditando(null);
    setForm(emptyForm);
    setError("");
    setShowModal(true);
  }

  function abrirEditar(u: Usuario) {
    setEditando(u);
    setForm({ name: u.name, email: u.email, password: "", role: u.role as "equipe" | "mentor" });
    setError("");
    setShowModal(true);
  }

  function fecharModal() {
    setShowModal(false);
    setEditando(null);
    setError("");
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    if (!editando && !form.password) {
      setError("Senha é obrigatória para novos usuários.");
      setLoading(false);
      return;
    }

    const body: Partial<FormData> = { name: form.name, email: form.email, role: form.role };
    if (form.password) body.password = form.password;

    const res = editando
      ? await fetch(`/api/usuarios/${editando.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      : await fetch("/api/usuarios", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

    setLoading(false);

    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "Erro ao salvar usuário.");
      return;
    }

    const usuario: Usuario = await res.json();
    if (editando) {
      setUsuarios((prev) => prev.map((u) => (u.id === usuario.id ? usuario : u)));
    } else {
      setUsuarios((prev) => [...prev, usuario].sort((a, b) => a.name.localeCompare(b.name)));
    }
    fecharModal();
  }

  async function excluir(u: Usuario) {
    setLoading(true);
    const res = await fetch(`/api/usuarios/${u.id}`, { method: "DELETE" });
    setLoading(false);

    if (!res.ok) {
      const data = await res.json();
      alert(data.error ?? "Erro ao excluir usuário.");
      setConfirmDelete(null);
      return;
    }

    setUsuarios((prev) => prev.filter((x) => x.id !== u.id));
    setConfirmDelete(null);
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Usuários</h1>
          <p className="text-sm text-slate-500">
            {isAdmin ? "Gerencie o acesso da sua equipe" : "Edite suas informações de perfil"}
          </p>
        </div>
        {isAdmin && (
          <button
            onClick={abrirNovo}
            className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 rounded-lg transition"
          >
            + Novo usuário
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-500 uppercase text-xs">
            <tr>
              <th className="text-left px-4 py-3">Nome</th>
              <th className="text-left px-4 py-3">Email</th>
              <th className="text-left px-4 py-3">Papel</th>
              <th className="text-left px-4 py-3">Desde</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {usuarios.map((u) => (
              <tr key={u.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 font-medium text-slate-800">
                  {u.name}
                  {u.id === session?.user?.id && (
                    <span className="ml-2 text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full">
                      Você
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-slate-500">{u.email}</td>
                <td className="px-4 py-3">
                  <span
                    className={`capitalize text-xs font-semibold px-2 py-1 rounded-full ${
                      u.role === "mentor"
                        ? "bg-purple-100 text-purple-700"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {u.role}
                  </span>
                </td>
                <td className="px-4 py-3 text-slate-400 text-xs">
                  {new Date(u.createdAt).toLocaleDateString("pt-BR")}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3 justify-end">
                    {(isAdmin || u.id === session?.user?.id) && (
                      <button
                        onClick={() => abrirEditar(u)}
                        className="text-blue-600 hover:underline text-xs"
                      >
                        Editar
                      </button>
                    )}
                    {isAdmin && u.id !== session?.user?.id && (
                      <button
                        onClick={() => setConfirmDelete(u)}
                        className="text-red-500 hover:underline text-xs"
                      >
                        Excluir
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {usuarios.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                  Nenhum usuário encontrado
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold text-slate-800 mb-5">
              {editando ? "Editar usuário" : "Novo usuário"}
            </h2>
            <form onSubmit={salvar} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nome</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  required
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Senha {editando && <span className="text-slate-400 font-normal">(deixe vazio para não alterar)</span>}
                </label>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder={editando ? "••••••••" : ""}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              {isAdmin && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">Papel</label>
                  <div className="flex gap-2">
                    {(["equipe", "mentor"] as const).map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setForm({ ...form, role: r })}
                        className={`flex-1 py-2 rounded-lg text-sm font-medium border transition capitalize ${
                          form.role === r
                            ? "bg-blue-600 text-white border-blue-600"
                            : "bg-white text-slate-600 border-slate-300 hover:bg-slate-50"
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {error && <p className="text-sm text-red-500">{error}</p>}

              <div className="flex gap-3 pt-1">
                <button
                  type="submit"
                  disabled={loading}
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold py-2 rounded-lg transition disabled:opacity-50"
                >
                  {loading ? "Salvando..." : "Salvar"}
                </button>
                <button
                  type="button"
                  onClick={fecharModal}
                  className="flex-1 border border-slate-300 text-slate-600 text-sm font-medium py-2 rounded-lg hover:bg-slate-50 transition"
                >
                  Cancelar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 text-center">
            <p className="text-slate-800 font-semibold mb-1">Excluir usuário?</p>
            <p className="text-sm text-slate-500 mb-6">
              <span className="font-medium">{confirmDelete.name}</span> perderá o acesso ao sistema.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => excluir(confirmDelete)}
                disabled={loading}
                className="flex-1 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold py-2 rounded-lg transition disabled:opacity-50"
              >
                {loading ? "Excluindo..." : "Excluir"}
              </button>
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 border border-slate-300 text-slate-600 text-sm font-medium py-2 rounded-lg hover:bg-slate-50 transition"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
