/**
 * POST /api/tutory/vincular-ids
 *
 * Busca TODOS os alunos da Tutory via API e tenta vincular (tutoryId)
 * os alunos do CRM que ainda não têm esse vínculo.
 *
 * Estratégia de match (ordem de prioridade):
 *  1. Email exato (lowercase)
 *  2. CPF (somente dígitos, 11 chars)
 *  3. Nome normalizado (sem acento, lowercase, espaços colapsados)
 *
 * Retorna: vinculados, semMatch (lista), jáVinculados (pulados).
 */

import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";
import { registrarLog } from "@/lib/log";

type TutoryAluno = {
  id: number;
  matricula: string;
  email: string;
  nome: string;
  ddd?: number | null;
  telefone?: string | null;
  [key: string]: unknown;
};

// ─── helpers ──────────────────────────────────────────────────────────────────

async function getSessionCookie(): Promise<string> {
  const account  = process.env.TUTORY_ACCOUNT ?? "";
  const password = process.env.TUTORY_PASSWORD ?? "";
  if (!account || !password) return "";
  const res = await fetch("https://admin.tutory.com.br/intent/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest" },
    body: `account=${encodeURIComponent(account)}&password=${encodeURIComponent(password)}`,
  });
  return res.headers.get("set-cookie")?.match(/PHPSESSID=[^;]+/)?.[0] ?? "";
}

async function fetchTodosAlunos(headers: Record<string, string>): Promise<TutoryAluno[]> {
  const all: TutoryAluno[] = [];
  let pagina = 1;
  while (true) {
    const res = await fetch("https://admin.tutory.com.br/intent/listar-alunos", {
      method: "POST",
      headers: { ...headers, "X-Requested-With": "XMLHttpRequest", "Content-Type": "application/x-www-form-urlencoded" },
      body: `pagina=${pagina}`,
    });
    if (!res.ok) break;
    const data = await res.json();
    if (!data.result) break;
    const alunos: TutoryAluno[] = data.data?.alunos ?? [];
    if (alunos.length === 0) break;
    all.push(...alunos);
    const pag = data.data?.pagination ?? {};
    const total: number = pag["total de paginas"] ?? pag["total_de_paginas"] ?? pag["totalPaginas"] ?? pag["total_pages"] ?? 1;
    if (pagina >= total) break;
    pagina++;
  }
  return all;
}

function normNome(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function limparCpf(s: string): string {
  return s.replace(/\D/g, "");
}

// ─── handler ──────────────────────────────────────────────────────────────────

async function executar() {
  const cookie = await getSessionCookie();
  const apiHeaders: Record<string, string> = process.env.TUTORY_TOKEN
    ? { Authorization: `Bearer ${process.env.TUTORY_TOKEN}` }
    : { Cookie: cookie };

  const tutoryAlunos = await fetchTodosAlunos(apiHeaders);
  if (tutoryAlunos.length === 0) {
    return NextResponse.json({ error: "Nenhum aluno retornado pela Tutory" }, { status: 502 });
  }

  // Somente alunos do CRM que ainda não têm tutoryId
  const semVinculo = await prisma.aluno.findMany({
    where: { tutoryId: null },
    select: { id: true, nome: true, email: true, cpf: true },
  });

  if (semVinculo.length === 0) {
    return NextResponse.json({ ok: true, vinculados: 0, msg: "Todos os alunos já estão vinculados!" });
  }

  // Índices para lookup rápido
  const porEmail = new Map(semVinculo.map((a) => [a.email.toLowerCase(), a]));
  const porCpf   = new Map(semVinculo.filter((a) => a.cpf?.length === 11).map((a) => [a.cpf!, a]));
  const porNome  = new Map(semVinculo.map((a) => [normNome(a.nome), a]));

  let vinculados = 0;
  const semMatch: string[] = [];
  const detalhes: { tutory: string; crm: string; via: string }[] = [];

  for (const t of tutoryAlunos) {
    const emailT = (t.email ?? "").toLowerCase().trim();
    const nomeT  = normNome(t.nome ?? "");
    const cpfT   = limparCpf(t.matricula ?? "");

    const aluno =
      (emailT && porEmail.get(emailT)) ||
      (cpfT.length === 11 && porCpf.get(cpfT)) ||
      (nomeT && porNome.get(nomeT));

    const via =
      (emailT && porEmail.get(emailT)) ? "email" :
      (cpfT.length === 11 && porCpf.get(cpfT)) ? "cpf" :
      (nomeT && porNome.get(nomeT)) ? "nome" : "";

    if (aluno) {
      await prisma.aluno.update({ where: { id: aluno.id }, data: { tutoryId: t.id } });
      // Remove dos mapas para não fazer match duplo
      porEmail.delete(emailT);
      porCpf.delete(cpfT);
      porNome.delete(nomeT);
      vinculados++;
      detalhes.push({ tutory: t.nome, crm: aluno.nome, via });
    } else {
      semMatch.push(`${t.nome} (${emailT || "sem email"})`);
    }
  }

  await registrarLog({
    tipo: "sistema",
    acao: "tutory_ids_vinculados",
    descricao: `Vinculou IDs Tutory: ${vinculados} alunos vinculados automaticamente`,
    meta: { vinculados, semMatch: semMatch.length, totalTutory: tutoryAlunos.length },
  });

  return NextResponse.json({
    ok: true,
    totalTutory: tutoryAlunos.length,
    alunosSemVinculoAntes: semVinculo.length,
    vinculados,
    semMatch: semMatch.length,
    semMatchLista: semMatch,
    detalhes,
  });
}

export async function POST(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== "cg-bulk-2026") {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  return executar();
}
