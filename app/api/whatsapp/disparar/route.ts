import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

const ZAPI_BASE = `https://api.z-api.io/instances/${process.env.ZAPI_INSTANCE_ID}/token/${process.env.ZAPI_TOKEN}`;
const CLIENT_TOKEN = process.env.ZAPI_CLIENT_TOKEN ?? "";

// Delay entre mensagens para evitar bloqueio por spam
const DELAY_MS = 2000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizarFone(numero: string): string {
  // Remove tudo que não é dígito
  const digitos = numero.replace(/\D/g, "");
  // Garante código do país 55 (Brasil)
  if (digitos.startsWith("55")) return digitos;
  return `55${digitos}`;
}

async function enviarMensagem(fone: string, mensagem: string): Promise<{ ok: boolean; erro?: string }> {
  try {
    const res = await fetch(`${ZAPI_BASE}/send-text`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Client-Token": CLIENT_TOKEN,
      },
      body: JSON.stringify({ phone: fone, message: mensagem }),
      cache: "no-store",
    });

    if (!res.ok) {
      const txt = await res.text();
      return { ok: false, erro: `HTTP ${res.status}: ${txt.slice(0, 100)}` };
    }

    return { ok: true };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }
}

type AlunoPayload = {
  id: string;
  nome: string;
  whatsapp: string;
};

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  if (!process.env.ZAPI_INSTANCE_ID || !process.env.ZAPI_TOKEN) {
    return NextResponse.json({ error: "Z-API não configurada" }, { status: 500 });
  }

  const { mensagem, alunos } = await req.json() as { mensagem: string; alunos: AlunoPayload[] };

  if (!mensagem?.trim() || !Array.isArray(alunos) || alunos.length === 0) {
    return NextResponse.json({ error: "Parâmetros inválidos" }, { status: 400 });
  }

  const resultados: { id: string; nome: string; ok: boolean; erro?: string }[] = [];

  for (const aluno of alunos) {
    if (!aluno.whatsapp) {
      resultados.push({ id: aluno.id, nome: aluno.nome, ok: false, erro: "Sem número" });
      continue;
    }

    const fone = normalizarFone(aluno.whatsapp);
    const texto = mensagem.replace(/\[nome\]/gi, aluno.nome.split(" ")[0]);

    const resultado = await enviarMensagem(fone, texto);
    resultados.push({ id: aluno.id, nome: aluno.nome, ...resultado });

    // Aguarda entre envios para não ser bloqueado
    if (alunos.indexOf(aluno) < alunos.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  const enviados = resultados.filter((r) => r.ok).length;
  const falhas   = resultados.filter((r) => !r.ok).length;

  return NextResponse.json({ enviados, falhas, resultados });
}
