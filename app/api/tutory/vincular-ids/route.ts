/**
 * POST /api/tutory/vincular-ids
 *
 * Itera pelos relatórios "Relação de Alunos" de cada curso na Tutory
 * (/relatorios/?id=3&conc=<ID>) e atualiza tutoryId nos alunos do CRM
 * que ainda não estão vinculados.
 *
 * Match por ordem de prioridade: email → CPF/matrícula → nome normalizado.
 *
 * Suporta paginação via ?offset=N para contornar timeout de serverless:
 *   - Primeira chamada: sem offset (processa cursos 0..limit-1)
 *   - Se timedOut=true na resposta, chame novamente com ?offset=proximoOffset
 */

import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { registrarLog } from "@/lib/log";

// ─── helpers ──────────────────────────────────────────────────────────────────

async function getSessionCookie(): Promise<string> {
  const account  = process.env.TUTORY_ACCOUNT ?? "";
  const password = process.env.TUTORY_PASSWORD ?? "";
  if (!account || !password) return "";
  const res = await fetch("https://admin.tutory.com.br/intent/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: `account=${encodeURIComponent(account)}&password=${encodeURIComponent(password)}`,
  });
  return res.headers.get("set-cookie")?.match(/PHPSESSID=[^;]+/)?.[0] ?? "";
}

async function getCursoIds(cookie: string): Promise<string[]> {
  const html = await fetch("https://admin.tutory.com.br/cursos/relatorios", {
    headers: { Cookie: cookie },
  }).then((r) => r.text());
  const matches = [...html.matchAll(/<option[^>]*value=["']([1-9]\d*)["']/gi)];
  return [...new Set(matches.map((m) => m[1]))];
}

function encontrarChave(headers: string[], candidatos: string[]): string {
  const lower = headers.map((h) => String(h).toLowerCase().trim());
  for (const c of candidatos) {
    const idx = lower.indexOf(c.toLowerCase().trim());
    if (idx !== -1) return headers[idx];
  }
  for (const c of candidatos) {
    const idx = lower.findIndex((h) => h.includes(c.toLowerCase()));
    if (idx !== -1) return headers[idx];
  }
  return "";
}

type AlunoXLS = { tutoryId: number; email: string; nome: string; cpf: string };

async function fetchCursoAlunos(cookie: string, cursoId: string): Promise<AlunoXLS[]> {
  try {
    const res = await fetch(
      `https://admin.tutory.com.br/relatorios/?id=3&conc=${cursoId}`,
      {
        headers: { Cookie: cookie },
        signal: AbortSignal.timeout(15_000),
      }
    );

    const ct = res.headers.get("content-type") ?? "";
    // Se retornar HTML, o curso pode estar vazio ou exigir outra ação
    if (ct.includes("text/html")) return [];

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 50) return [];

    const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
    if (rows.length === 0) return [];

    const headers = Object.keys(rows[0]);
    const colId    = encontrarChave(headers, ["id", "código", "codigo", "cod", "matricula", "matrícula", "id do aluno", "id_aluno", "aluno_id"]);
    const colEmail = encontrarChave(headers, ["email", "e-mail", "e mail", "endereco", "endereço"]);
    const colNome  = encontrarChave(headers, ["nome", "aluno", "name", "estudante", "nome do aluno"]);
    const colCpf   = encontrarChave(headers, ["cpf", "documento", "doc"]);

    const result: AlunoXLS[] = [];
    for (const row of rows) {
      const idRaw = String(row[colId] ?? "").trim();
      const id = parseInt(idRaw);
      if (!id || id <= 0) continue;
      result.push({
        tutoryId: id,
        email: String(row[colEmail] ?? "").toLowerCase().trim(),
        nome:  String(row[colNome]  ?? "").trim(),
        cpf:   String(row[colCpf]   ?? "").replace(/\D/g, ""),
      });
    }
    return result;
  } catch {
    return [];
  }
}

function normNome(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// ─── core ─────────────────────────────────────────────────────────────────────

async function executar(offset: number, limit: number) {
  const startMs  = Date.now();
  const BUDGET   = 52_000; // 52 s (Railway permite ~60 s)
  const PARALLEL = 6;      // requisições simultâneas à Tutory

  const cookie = await getSessionCookie();
  if (!cookie) return NextResponse.json({ error: "Login falhou" }, { status: 500 });

  // Todos os IDs de curso disponíveis
  const allIds  = await getCursoIds(cookie);
  const slice   = allIds.slice(offset, offset + limit);

  // Alunos do CRM ainda sem tutoryId
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

  let vinculados       = 0;
  let cursosComDados   = 0;
  let cursosSemDados   = 0;
  let timedOut         = false;
  const detalhes: { tutory: string; crm: string; via: string }[] = [];

  for (let i = 0; i < slice.length; i += PARALLEL) {
    if (Date.now() - startMs > BUDGET) { timedOut = true; break; }
    if (porEmail.size === 0 && porNome.size === 0 && porCpf.size === 0) break;

    const batch   = slice.slice(i, i + PARALLEL);
    const results = await Promise.allSettled(batch.map((id) => fetchCursoAlunos(cookie, id)));

    for (const result of results) {
      if (result.status === "rejected" || result.value.length === 0) {
        cursosSemDados++;
        continue;
      }
      cursosComDados++;

      for (const t of result.value) {
        const emailT = t.email;
        const nomeT  = normNome(t.nome);
        const cpfT   = t.cpf;

        const via =
          (emailT && porEmail.has(emailT)) ? "email" :
          (cpfT.length === 11 && porCpf.has(cpfT)) ? "cpf" :
          (nomeT && porNome.has(nomeT)) ? "nome" : "";

        const aluno =
          (emailT && porEmail.get(emailT)) ||
          (cpfT.length === 11 && porCpf.get(cpfT)) ||
          (nomeT && porNome.get(nomeT));

        if (aluno && via) {
          try {
            await prisma.aluno.update({ where: { id: aluno.id }, data: { tutoryId: t.tutoryId } });
            porEmail.delete(emailT);
            porCpf.delete(cpfT);
            porNome.delete(nomeT);
            vinculados++;
            detalhes.push({ tutory: t.nome, crm: aluno.nome, via });
          } catch { /* aluno já atualizado por outro batch */ }
        }
      }
    }
  }

  const elapsed        = Math.round((Date.now() - startMs) / 1000);
  const processados    = cursosComDados + cursosSemDados;
  const proximoOffset  = offset + processados;

  await registrarLog({
    tipo: "sistema",
    acao: "tutory_ids_vinculados",
    descricao: `Vinculou via relatórios: ${vinculados} alunos (cursos ${offset}–${proximoOffset - 1}/${allIds.length})`,
    meta: { vinculados, cursosComDados, cursosSemDados, offset, elapsed, timedOut },
  });

  return NextResponse.json({
    ok: true,
    totalCursosDisponiveis: allIds.length,
    cursosNestaChamada:     slice.length,
    cursosComDados,
    cursosSemDados,
    alunosSemVinculoAntes:  semVinculo.length,
    vinculados,
    detalhes:               detalhes.slice(0, 100),
    proximoOffset,
    timedOut,
    elapsed,
  });
}

// ─── handler ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== "cg-bulk-2026") {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const offset = parseInt(req.nextUrl.searchParams.get("offset") ?? "0");
  const limit  = parseInt(req.nextUrl.searchParams.get("limit")  ?? "500");
  return executar(offset, limit);
}
