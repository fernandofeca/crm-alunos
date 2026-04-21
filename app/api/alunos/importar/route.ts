import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";

type Linha = Record<string, unknown>;

function primeiroValor(row: Linha, col: string): string {
  const val = row[col];
  if (val === undefined || val === null) return "";
  return String(val).trim();
}

function encontrarChave(headers: string[], candidatos: string[]): string {
  const lower = headers.map((h) => h.toLowerCase().trim());
  for (const c of candidatos) {
    const idx = lower.indexOf(c.toLowerCase().trim());
    if (idx !== -1) return headers[idx];
  }
  return "";
}

function limparNumero(val: string): string {
  return val.replace(/\D/g, "");
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Erro ao ler o arquivo enviado." }, { status: 400 });
  }

  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "Nenhum arquivo enviado." }, { status: 400 });

  let rows: Linha[] = [];
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const workbook = XLSX.read(buffer, { type: "buffer" });
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
    return NextResponse.json({ error: "A planilha está vazia ou sem dados." }, { status: 400 });
  }

  const headers = Object.keys(rows[0]);

  const colNome = encontrarChave(headers, [
    "nome", "name", "aluno", "estudante",
  ]);
  const colEmail = encontrarChave(headers, [
    "email", "e-mail", "e mail", "endereco", "endereço",
  ]);
  const colCpf = encontrarChave(headers, [
    "cpf", "documento", "doc",
  ]);
  const colCelular = encontrarChave(headers, [
    "celular", "telefone", "whatsapp", "fone", "contato", "cel", "tel",
  ]);
  const colConcurso = encontrarChave(headers, [
    "concurso", "curso", "turma", "produto",
  ]);

  const resultados = {
    criados: 0,
    atualizados: 0,
    erros: [] as string[],
    colunas_detectadas: { colNome, colEmail, colCpf, colCelular, colConcurso },
  };

  // Deduplica emails dentro da mesma importação
  const emailsProcessados = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const linhaNr = i + 2;

    const nome = colNome ? primeiroValor(row, colNome) : "";
    // Normaliza email: lowercase + trim para evitar colisão por capitalização
    const email = (colEmail ? primeiroValor(row, colEmail) : "").toLowerCase().trim();
    const cpf = limparNumero(colCpf ? primeiroValor(row, colCpf) : "");
    const celular = limparNumero(colCelular ? primeiroValor(row, colCelular) : "");
    const concurso = colConcurso ? primeiroValor(row, colConcurso) : "";

    // Linha verdadeiramente vazia — sem nenhum dado relevante
    if (!nome && !email && !cpf && !celular) continue;

    try {
      if (email) {
        // Evita processar o mesmo email duas vezes na mesma planilha
        if (emailsProcessados.has(email)) {
          resultados.atualizados++;
          continue;
        }
        emailsProcessados.add(email);

        const existente = await prisma.aluno.findUnique({ where: { email } });
        if (existente) {
          await prisma.aluno.update({
            where: { id: existente.id },
            data: {
              nome: nome || existente.nome,
              cpf: cpf || existente.cpf,
              whatsapp: celular || existente.whatsapp,
              concurso: concurso || existente.concurso,
            },
          });
          resultados.atualizados++;
        } else {
          await prisma.aluno.create({
            data: { nome: nome || "Sem nome", email, cpf, whatsapp: celular, concurso },
          });
          resultados.criados++;
        }
      } else {
        // Sem email: tenta encontrar pelo CPF para não criar duplicatas
        if (cpf) {
          const existentePorCpf = await prisma.aluno.findFirst({ where: { cpf } });
          if (existentePorCpf) {
            await prisma.aluno.update({
              where: { id: existentePorCpf.id },
              data: {
                nome: nome || existentePorCpf.nome,
                whatsapp: celular || existentePorCpf.whatsapp,
                concurso: concurso || existentePorCpf.concurso,
              },
            });
            resultados.atualizados++;
            continue;
          }
          // CPF ainda não cadastrado — cria com email derivado do CPF
          await prisma.aluno.create({
            data: {
              nome: nome || "Sem nome",
              email: `sem-email-cpf-${cpf}`,
              cpf,
              whatsapp: celular,
              concurso,
            },
          });
          resultados.criados++;
        } else {
          // Sem email e sem CPF — cria com email único baseado em índice
          await prisma.aluno.create({
            data: {
              nome: nome || "Sem nome",
              email: `sem-email-linha-${linhaNr}-${Date.now()}`,
              cpf: "",
              whatsapp: celular,
              concurso,
            },
          });
          resultados.criados++;
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      resultados.erros.push(`Linha ${linhaNr} ("${nome || email || cpf}"): ${msg}`);
    }
  }

  return NextResponse.json(resultados);
}
