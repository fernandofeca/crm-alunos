import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

const ZAPI_BASE = `https://api.z-api.io/instances/${process.env.ZAPI_INSTANCE_ID}/token/${process.env.ZAPI_TOKEN}`;
const CLIENT_TOKEN = process.env.ZAPI_CLIENT_TOKEN ?? "";
const DELAY_MS = 2500;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizarFone(numero: string): string {
  const digitos = numero.replace(/\D/g, "");
  if (digitos.startsWith("55")) return digitos;
  return `55${digitos}`;
}

async function enviar(
  fone: string,
  texto: string,
  imagem?: string,
): Promise<{ ok: boolean; erro?: string }> {
  try {
    // Com imagem → send-image (caption = legenda)
    // Sem imagem → send-text
    const endpoint = imagem ? "send-image" : "send-text";
    const body = imagem
      ? { phone: fone, image: imagem, caption: texto }
      : { phone: fone, message: texto };

    const res = await fetch(`${ZAPI_BASE}/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Client-Token": CLIENT_TOKEN },
      body: JSON.stringify(body),
      cache: "no-store",
    });

    if (!res.ok) {
      const txt = await res.text();
      return { ok: false, erro: `HTTP ${res.status}: ${txt.slice(0, 120)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, erro: e instanceof Error ? e.message : String(e) };
  }
}

type AlunoPayload = { id: string; nome: string; whatsapp: string };

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  if (!process.env.ZAPI_INSTANCE_ID || !process.env.ZAPI_TOKEN)
    return NextResponse.json({ error: "Z-API não configurada" }, { status: 500 });

  const { mensagem, alunos, imagem } = await req.json() as {
    mensagem: string;
    alunos: AlunoPayload[];
    imagem?: string; // base64 data URL ou URL pública
  };

  if (!mensagem?.trim() || !Array.isArray(alunos) || alunos.length === 0)
    return NextResponse.json({ error: "Parâmetros inválidos" }, { status: 400 });

  const resultados: { id: string; nome: string; ok: boolean; erro?: string }[] = [];

  for (let i = 0; i < alunos.length; i++) {
    const aluno = alunos[i];

    if (!aluno.whatsapp) {
      resultados.push({ id: aluno.id, nome: aluno.nome, ok: false, erro: "Sem número" });
      continue;
    }

    const fone  = normalizarFone(aluno.whatsapp);
    const texto = mensagem.replace(/\[nome\]/gi, aluno.nome.split(" ")[0]);

    const resultado = await enviar(fone, texto, imagem);
    resultados.push({ id: aluno.id, nome: aluno.nome, ...resultado });

    if (i < alunos.length - 1) await sleep(DELAY_MS);
  }

  const enviados = resultados.filter((r) => r.ok).length;
  const falhas   = resultados.filter((r) => !r.ok).length;

  return NextResponse.json({ enviados, falhas, resultados });
}
