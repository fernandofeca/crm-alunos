"use client";

import { signOut, useSession } from "next-auth/react";
import Link from "next/link";

export default function Navbar() {
  const { data: session } = useSession();

  return (
    <nav className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between">
      <div className="flex items-center gap-6">
        <Link href="/" className="text-lg font-bold text-blue-600">
          CRM Alunos
        </Link>
        <div className="flex items-center gap-4 text-sm">
          <Link href="/" className="text-slate-600 hover:text-blue-600 transition">
            Dashboard
          </Link>
          <Link href="/alunos" className="text-slate-600 hover:text-blue-600 transition">
            Alunos
          </Link>
          <Link href="/alunos-engajados" className="text-slate-600 hover:text-blue-600 transition">
            Alunos Engajados
          </Link>
          <Link href="/historico-atrasos" className="text-slate-600 hover:text-blue-600 transition">
            Histórico de Atrasos
          </Link>
          <Link href="/aniversariantes" className="text-slate-600 hover:text-blue-600 transition">
            Aniversariantes
          </Link>
          <Link href="/alunos-a-vencer" className="text-slate-600 hover:text-blue-600 transition">
            Alunos a Vencer
          </Link>
          <Link href="/renovacao-pendente" className="text-slate-600 hover:text-blue-600 transition">
            Renovação Pendente
          </Link>
          <Link href="/agenda" className="text-slate-600 hover:text-blue-600 transition">
            Agenda
          </Link>
          <Link href="/tarefas" className="text-slate-600 hover:text-blue-600 transition">
            Tarefas
          </Link>
          <Link href="/usuarios" className="text-slate-600 hover:text-blue-600 transition">
            Usuários
          </Link>
          <Link href="/logs" className="text-slate-600 hover:text-blue-600 transition">
            Logs
          </Link>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <span className="text-sm text-slate-600">{session?.user?.name}</span>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="text-sm text-red-500 hover:underline"
        >
          Sair
        </button>
      </div>
    </nav>
  );
}
