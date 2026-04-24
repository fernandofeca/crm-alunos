/**
 * Replanejamento de Cronogramas
 *
 * Chama POST /intent/selecionar-notificacoes no app.tutory.com.br
 * com id={tutoryId} para cada aluno atrasado — o mesmo request que o
 * browser faz ao abrir o painel do aluno, disparando o replanejamento.
 *
 * Env vars necessárias:
 *   TUTORY_APP_TOKEN  — Bearer token do app.tutory.com.br (diferente do admin)
 *
 * Fluxo cron:
 *   06h20 – snapshot-atraso (salva lista no DB)
 *   06h30 – retirar-atrasos (limpa atrasos em bulk)
 *   06h35 – replanejamento-cronogramas (dispara replanejamento via API)
 */

import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

function sextaAtual(): Date {
  const sp = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const [ano, mes, dia] = sp.split("-").map(Number);
  const hoje = new Date(Date.UTC(ano, mes - 1, dia));
  const dow = hoje.getUTCDay();
  const diasAteSexta = (5 - dow + 7) % 7;
  const sexta = new Date(hoje);
  if (dow !== 5) sexta.setUTCDate(hoje.getUTCDate() + diasAteSexta);
  return sexta;
}

async function executarReplanejamento() {
  const token = process.env.TUTORY_APP_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "TUTORY_APP_TOKEN não configurado" }, { status: 500 });
  }

  // Busca alunos do snapshot desta semana que têm tutoryId no CRM
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
      msg: "Nenhum aluno no snapshot desta semana com tutoryId cadastrado",
      executadoEm: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    });
  }

  const resultados: { nome: string; email: string; tutoryId: string; status: number | string }[] = [];

  // Processa em lotes de 5 para não sobrecarregar
  for (let i = 0; i < snapshots.length; i += 5) {
    const lote = snapshots.slice(i, i + 5);
    const resps = await Promise.all(
      lote.map(async (s) => {
        const tutoryId = s.aluno!.tutoryId!;
        try {
          const r = await fetch("https://app.tutory.com.br/intent/selecionar-notificacoes", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
              Accept: "*/*",
              Origin: "https://app.tutory.com.br",
              Referer: "https://app.tutory.com.br/painel/",
            },
            body: `id=${tutoryId}`,
          });
          return { nome: s.nome, email: s.email, tutoryId: String(tutoryId), status: r.status };
        } catch (e) {
          return { nome: s.nome, email: s.email, tutoryId: String(tutoryId), status: String(e) };
        }
      })
    );
    resultados.push(...resps);
    if (i + 5 < snapshots.length) await new Promise((r) => setTimeout(r, 200));
  }

  const sucessos = resultados.filter((r) => typeof r.status === "number" && r.status < 400).length;
  const semTutoryId = await prisma.snapshotAtraso.count({
    where: { semana: sextaAtual(), aluno: { tutoryId: null } },
  });
  const semCrm = await prisma.snapshotAtraso.count({
    where: { semana: sextaAtual(), alunoId: null },
  });

  return NextResponse.json({
    ok: true,
    replanejados: sucessos,
    total: snapshots.length,
    semTutoryId,
    semCrm,
    falhas: resultados.filter((r) => typeof r.status !== "number" || r.status >= 400),
    executadoEm: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
  });
}

// GET ?key=cg-bulk-2026 — cron (responde imediatamente)
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== "cg-bulk-2026") return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
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
