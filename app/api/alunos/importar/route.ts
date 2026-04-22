import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";

type Linha = Record<string, unknown>;

function primeiroValor(row: Linha, col: string): string {
  const val = row[col];
  if (val === undefined || val === null) return "";
  if (val instanceof Date) return val.toISOString();
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

function parseData(val: unknown): Date | null {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (typeof val === "number") {
    // Excel serial date
    const info = XLSX.SSF.parse_date_code(val);
    if (info) return new Date(info.y, info.m - 1, info.d);
  }
  if (typeof val === "string") {
    const s = val.trim();
    const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (br) return new Date(parseInt(br[3]), parseInt(br[2]) - 1, parseInt(br[1]));
    const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]));
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
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
    return NextResponse.json({ error: "A planilha está vazia ou sem dados." }, { status: 400 });
  }

  const headers = Object.keys(rows[0]);

  const colNome      = encontrarChave(headers, ["nome", "name", "aluno", "estudante"]);
  const colEmail     = encontrarChave(headers, ["email", "e-mail", "e mail", "endereco", "endereço"]);
  const colCpf       = encontrarChave(headers, ["cpf", "documento", "doc"]);
  const colCelular   = encontrarChave(headers, ["celular", "telefone", "whatsapp", "fone", "contato", "cel", "tel"]);
  const colConcurso  = encontrarChave(headers, ["concurso", "curso", "turma", "produto"]);
  const colStatus    = encontrarChave(headers, ["status", "situacao", "situação", "situação"]);
  const colVencimento = encontrarChave(headers, [
    "vencimento do plano", "vencimento", "validade", "expiracao", "expiração",
    "data vencimento", "data de vencimento", "venc",
  ]);

  const resultados = {
    criados: 0,
    atualizados: 0,
    erros: [] as string[],
    colunas_detectadas: { colNome, colEmail, colCpf, colCelular, colConcurso, colStatus, colVencimento },
  };

  const emailsProcessados = new Set<string>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const linhaNr = i + 2;

    const nome     = colNome     ? primeiroValor(row, colNome)    : "";
    const email    = (colEmail   ? primeiroValor(row, colEmail)   : "").toLowerCase().trim();
    const cpf      = limparNumero(colCpf     ? primeiroValor(row, colCpf)     : "");
    const celular  = limparNumero(colCelular  ? primeiroValor(row, colCelular) : "");
    const concurso = colConcurso  ? primeiroValor(row, colConcurso) : "";

    // Status: só marca ativo=true se coluna existir E valor for "ativo"
    const statusRaw = colStatus ? primeiroValor(row, colStatus).toLowerCase().trim() : null;
    const ativo = statusRaw !== null ? statusRaw === "ativo" : undefined;

    // Vencimento do plano
    const vencimentoRaw = colVencimento ? row[colVencimento] : null;
    const planoVencimento = vencimentoRaw ? parseData(vencimentoRaw) : null;

    if (!nome && !email && !cpf && !celular) continue;

    try {
      if (email) {
        if (emailsProcessados.has(email)) { resultados.atualizados++; continue; }
        emailsProcessados.add(email);

        const existente = await prisma.aluno.findUnique({ where: { email } });
        if (existente) {
          await prisma.aluno.update({
            where: { id: existente.id },
            data: {
              nome:     nome     || existente.nome,
              cpf:      cpf      || existente.cpf,
              whatsapp: celular  || existente.whatsapp,
              concurso: concurso || existente.concurso,
              ...(ativo !== undefined ? { ativo } : {}),
              ...(planoVencimento ? { planoVencimento } : {}),
            },
          });
          resultados.atualizados++;
        } else {
          await prisma.aluno.create({
            data: {
              nome: nome || "Sem nome",
              email,
              cpf,
              whatsapp: celular,
              concurso,
              ...(ativo !== undefined ? { ativo } : {}),
              ...(planoVencimento ? { planoVencimento } : {}),
            },
          });
          resultados.criados++;
        }
      } else if (cpf) {
        const existentePorCpf = await prisma.aluno.findFirst({ where: { cpf } });
        if (existentePorCpf) {
          await prisma.aluno.update({
            where: { id: existentePorCpf.id },
            data: {
              nome:     nome     || existentePorCpf.nome,
              whatsapp: celular  || existentePorCpf.whatsapp,
              concurso: concurso || existentePorCpf.concurso,
              ...(ativo !== undefined ? { ativo } : {}),
              ...(planoVencimento ? { planoVencimento } : {}),
            },
          });
          resultados.atualizados++;
        } else {
          await prisma.aluno.create({
            data: {
              nome: nome || "Sem nome",
              email: `sem-email-cpf-${cpf}`,
              cpf,
              whatsapp: celular,
              concurso,
              ...(ativo !== undefined ? { ativo } : {}),
              ...(planoVencimento ? { planoVencimento } : {}),
            },
          });
          resultados.criados++;
        }
      } else {
        await prisma.aluno.create({
          data: {
            nome: nome || "Sem nome",
            email: `sem-email-linha-${linhaNr}-${Date.now()}`,
            cpf: "",
            whatsapp: celular,
            concurso,
            ...(ativo !== undefined ? { ativo } : {}),
            ...(planoVencimento ? { planoVencimento } : {}),
          },
        });
        resultados.criados++;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      resultados.erros.push(`Linha ${linhaNr} ("${nome || email || cpf}"): ${msg}`);
    }
  }

  return NextResponse.json(resultados);
}
