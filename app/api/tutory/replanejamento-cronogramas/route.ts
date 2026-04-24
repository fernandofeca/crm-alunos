/**
 * Replanejamento de Cronogramas
 *
 * Chama POST /intent/selecionar-notificacoes no app.tutory.com.br
 * com id={tutoryId} — o mesmo request que o browser faz ao clicar OK
 * no popup "Cronograma Replanejado".
 *
 * Requer login em app.tutory.com.br para obter PHPSESSID + Bearer token.
 */

import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

function sextaAtual(): Date {
  const sp = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const [ano, mes, dia] = sp.split("-").map(Number);
  const hoje = new Date(Date.UTC(ano, mes - 1, dia));
  const dow = hoje.getUTCDay();
  const sexta = new Date(hoje);
  if (dow !== 5) sexta.setUTCDate(hoje.getUTCDate() + ((5 - dow + 7) % 7));
  return sexta;
}

interface AppAuth {
  phpsessid: string;
  bearerToken: string;
}

async function getAppAuth(): Promise<AppAuth | null> {
  const account = process.env.TUTORY_ACCOUNT ?? "";
  const password = process.env.TUTORY_PASSWORD ?? "";
  if (!account || !password) return null;

  // 1. Login em app.tutory.com.br
  const loginRes = await fetch("https://app.tutory.com.br/intent/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
      Origin: "https://app.tutory.com.br",
    },
    body: `account=${encodeURIComponent(account)}&password=${encodeURIComponent(password)}`,
    redirect: "manual",
  });

  const setCookie = loginRes.headers.get("set-cookie") ?? "";
  const phpsessid = setCookie.match(/PHPSESSID=[^;]+/)?.[0] ?? "";

  // 2. Tentar extrair Bearer do corpo da resposta
  let bearerToken = process.env.TUTORY_APP_TOKEN ?? "";
  try {
    const body = await loginRes.text();
    const tokenMatch = body.match(/"token"\s*:\s*"([^"]+)"/);
    if (tokenMatch) bearerToken = tokenMatch[1];
  } catch { /* ignorar */ }

  if (!phpsessid) return null;
  return { phpsessid, bearerToken };
}

async function executarReplanejamento() {
  // Autenticar em app.tutory.com.br
  const appAuth = await getAppAuth();
  if (!appAuth) {
    return NextResponse.json(
      { error: "Falha no login em app.tutory.com.br — verifique TUTORY_ACCOUNT e TUTORY_PASSWORD" },
      { status: 500 }
    );
  }

  const { phpsessid, bearerToken } = appAuth;

  if (!bearerToken) {
    return NextResponse.json(
      { error: "Bearer token não disponível — configure TUTORY_APP_TOKEN" },
      { status: 500 }
    );
  }

  // Busca alunos do snapshot desta semana com tutoryId no CRM
  const snapshots = await prisma.snapshotAtraso.findMany({
    where: {
      semana: sextaAtual(),
      aluno: { tutoryId: { not: null } },
    },
    include: { aluno: { select: { tutoryId: true } } },
  });

  if (snapshots.length === 0) {
    return NextResponse.json({
      ok: true,
      total: 0,
      msg: "Nenhum aluno no snapshot desta semana com tutoryId",
      executadoEm: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    });
  }

  const resultados: { nome: string; tutoryId: string; status: number | string }[] = [];

  for (let i = 0; i < snapshots.length; i += 5) {
    const lote = snapshots.slice(i, i + 5);
    const resps = await Promise.all(
      lote.map(async (s) => {
        const tutoryId = String(s.aluno!.tutoryId!);
        try {
          const r = await fetch("https://app.tutory.com.br/intent/selecionar-notificacoes", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${bearerToken}`,
              "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
              Accept: "*/*",
              Cookie: phpsessid,
              Origin: "https://app.tutory.com.br",
              Referer: "https://app.tutory.com.br/painel/",
            },
            body: `id=${tutoryId}`,
          });
          return { nome: s.nome, tutoryId, status: r.status };
        } catch (e) {
          return { nome: s.nome, tutoryId, status: String(e) };
        }
      })
    );
    resultados.push(...resps);
    if (i + 5 < snapshots.length) await new Promise((r) => setTimeout(r, 200));
  }

  const sucessos = resultados.filter((r) => typeof r.status === "number" && r.status < 400).length;

  return NextResponse.json({
    ok: true,
    replanejados: sucessos,
    total: snapshots.length,
    phpsessidObtido: !!phpsessid,
    falhas: resultados.filter((r) => typeof r.status !== "number" || r.status >= 400),
    executadoEm: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
  });
}

// GET ?key=cg-bulk-2026&debug=1 — testa o login e mostra resposta
// GET ?key=cg-bulk-2026 — cron (responde imediatamente)
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== "cg-bulk-2026") return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  if (req.nextUrl.searchParams.get("debug") === "1") {
    const account = process.env.TUTORY_ACCOUNT ?? "";
    const password = process.env.TUTORY_PASSWORD ?? "";
    const endpoints = [
      "https://app.tutory.com.br/intent/login",
      "https://app.tutory.com.br/api/login",
      "https://app.tutory.com.br/login",
    ];
    const resultados = await Promise.all(
      endpoints.map(async (url) => {
        try {
          const r = await fetch(url, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              "X-Requested-With": "XMLHttpRequest",
              Origin: "https://app.tutory.com.br",
            },
            body: `account=${encodeURIComponent(account)}&password=${encodeURIComponent(password)}`,
            redirect: "manual",
          });
          const body = await r.text();
          const setCookie = r.headers.get("set-cookie") ?? "";
          return {
            url,
            status: r.status,
            phpsessid: setCookie.match(/PHPSESSID=[^;]+/)?.[0] ?? null,
            setCookieHeader: setCookie.slice(0, 200),
            bodyPreview: body.slice(0, 300),
          };
        } catch (e) {
          return { url, status: "erro", error: String(e) };
        }
      })
    );
    return NextResponse.json({ resultados });
  }

  executarReplanejamento().catch((e) => console.error("[replanejamento-bg]", e));
  return NextResponse.json({
    ok: true,
    message: "Replanejamento iniciado em background",
    timestamp: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
  });
}

// POST autenticado — aguarda resultado completo
export async function POST(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== "cg-bulk-2026") {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  return executarReplanejamento();
}
