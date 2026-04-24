import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

async function executarRetirarAtrasos() {
  const token = process.env.TUTORY_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "TUTORY_TOKEN não configurado" }, { status: 500 });
  }

  const res = await fetch("https://admin.tutory.com.br/intent/cadastrar-exclusao-atrasos", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: "sub_id=0",
  });

  const texto = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(texto); } catch { json = texto; }

  return NextResponse.json({
    ok: res.ok,
    status: res.status,
    resposta: json,
    executadoEm: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
  });
}

// Cron via cron-job.org: GET com chave secreta
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== "cg-bulk-2026") {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  return executarRetirarAtrasos();
}

// Manual via painel (usuário autenticado)
export async function POST(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== "cg-bulk-2026") {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  return executarRetirarAtrasos();
}
