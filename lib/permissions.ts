import { NextResponse } from "next/server";

export const PERMISSOES = [
  { id: "criar_aluno",        label: "Criar aluno",              grupo: "Alunos" },
  { id: "editar_aluno",       label: "Editar dados do aluno",    grupo: "Alunos" },
  { id: "excluir_aluno",      label: "Excluir aluno",            grupo: "Alunos" },
  { id: "importar_xls",       label: "Importar planilha XLS",    grupo: "Alunos" },
  { id: "ativar_aluno",       label: "Ativar / inativar aluno",  grupo: "Alunos" },
  { id: "registrar_contato",  label: "Registrar contato",        grupo: "Contatos" },
  { id: "gerenciar_tarefas",  label: "Criar e editar tarefas",   grupo: "Tarefas" },
  { id: "excluir_tarefa",     label: "Excluir tarefas",          grupo: "Tarefas" },
  { id: "gerenciar_agenda",   label: "Criar e editar eventos",   grupo: "Agenda" },
  { id: "excluir_evento",     label: "Excluir eventos",          grupo: "Agenda" },
] as const;

export type Permissao = (typeof PERMISSOES)[number]["id"];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getRole(session: any): string {
  return ((session?.user as { role?: string })?.role ?? "equipe").toLowerCase();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isAdmin(session: any): boolean {
  return getRole(session) === "admin";
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function canDo(session: any, perm: Permissao): boolean {
  if (isAdmin(session)) return true;
  try {
    const bloqueadas: string[] = JSON.parse(
      (session?.user as { permissoes?: string })?.permissoes ?? "[]"
    );
    return !bloqueadas.includes(perm);
  } catch {
    return true;
  }
}

export function forbidden() {
  return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
}
