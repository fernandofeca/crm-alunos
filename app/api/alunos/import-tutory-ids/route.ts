/**
 * POST /api/alunos/import-tutory-ids
 *
 * Recebe um arquivo XLS/XLSX exportado do relatório "Relação de Alunos" da Tutory.
 * Lê o ID da Tutory e o email de cada linha, cruza com o banco por email (ou nome),
 * e salva o tutoryId em cada aluno encontrado.
 */

import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { registrarLog } from "@/lib/log";

type Linha = Record<string, unknown>;

function encontrarChave(headers: string[], candidatos: string[]): string {
  const lower = headers.map((h) => String(h).toLowerCase().trim());
  for (const c of candidatos) {
    const idx = lower.indexOf(c.toLowerCase().trim());
    if (idx !== -1) return headers[idx];
  }
  // Busca parcial
  for (const c of candidatos) {
    const idx = lower.findIndex((h) => h.includes(c.toLowerCase()));
    if (idx !== -1) return headers[idx];
  }
  return "";
}

function val(row: Linha, col: string): string {
  if (!col) return "";
  const v = row[col];
  if (v === undefined || v === null) return "";
  return String(v).trim();
}

function normNome(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Erro ao ler o arquivo." }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "Nenhum arquivo enviado." }, { status: 400 });

  let rows: Linha[] = [];
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    rows = XLSX.utils.sheet_to_json<Linha>(sheet, { defval: "" });
  } catch (e) {
    return NextResponse.json(
      { error: `Não foi possível ler a planilha: ${e instanceof Error ? e.message : "formato inválido"}` },
      { status: 400 }
    );
  }

  if (rows.length === 0) {
    return NextResponse.json({ error: "Planilha vazia ou sem dados." }, { status: 400 });
  }

  const headers = Object.keys(rows[0]);

  // Detecta colunas
  const colId    = encontrarChave(headers, ["id", "código", "codigo", "cod", "matricula", "matrícula", "id do aluno", "id_aluno", "aluno_id"]);
  const colEmail = encontrarChave(headers, ["email", "e-mail", "e mail", "endereco eletronico", "endereço eletrônico"]);
  const colNome  = encontrarChave(headers, ["nome", "aluno", "name", "estudante", "nome do aluno"]);

  // Pré-carrega todos os alunos do banco para cruzamento por nome
  const todosAlunos = await prisma.aluno.findMany({
    select: { id: true, nome: true, email: true, tutoryId: true },
  });
  const porEmail = new Map(todosAlunos.map((a) => [a.email.toLowerCase(), a]));
  const porNome  = new Map(todosAlunos.map((a) => [normNome(a.nome), a]));

  const resultados = {
    atualizados: 0,
    semMatch: [] as string[],
    semId: 0,
    colunasDetectadas: { id: colId, email: colEmail, nome: colNome },
    primeiraLinha: rows[0],
  };

  for (const row of rows) {
    const tutoryIdRaw = val(row, colId);
    const email       = val(row, colEmail).toLowerCase();
    const nome        = val(row, colNome);

    if (!tutoryIdRaw || isNaN(parseInt(tutoryIdRaw))) {
      resultados.semId++;
      continue;
    }

    const tutoryId = parseInt(tutoryIdRaw);

    // Tenta encontrar o aluno: primeiro por email, depois por nome normalizado
    const aluno = (email && porEmail.get(email)) || (nome && porNome.get(normNome(nome)));

    if (aluno) {
      await prisma.aluno.update({ where: { id: aluno.id }, data: { tutoryId } });
      resultados.atualizados++;
    } else {
      resultados.semMatch.push(`${nome || email || tutoryIdRaw} (tutoryId: ${tutoryId})`);
    }
  }

  await registrarLog({
    tipo: "usuario",
    acao: "tutory_ids_importados",
    descricao: `Importou IDs Tutory via XLS: ${resultados.atualizados} alunos atualizados`,
    userId: (session.user?.id ?? null) as string | null,
    meta: { atualizados: resultados.atualizados, semMatch: resultados.semMatch.length },
  });

  return NextResponse.json(resultados);
}
