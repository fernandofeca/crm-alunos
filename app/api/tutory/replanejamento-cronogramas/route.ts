/**
 * Replanejamento de Cronogramas
 *
 * Visita o painel Tutory de cada aluno atrasado para disparar o replanejamento
 * automático de cronograma (popup "Cronograma Replanejado").
 *
 * Fluxo cron:
 *   06h20 – snapshot-atraso (salva lista no DB)
 *   06h30 – retirar-atrasos (limpa atrasos em bulk)
 *   06h35 – replanejamento-cronogramas (visita painel de cada aluno)
 *
 * Fontes de URL por ordem de prioridade:
 *   1. URL extraída do bloco HTML da lista /alunos/atraso (se ainda houver alunos lá)
 *   2. alunos/index?aid={tutoryId} de alunos com tutoryId no nosso DB
 */

import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

async function getSessionCookie(): Promise<string> {
  const account = process.env.TUTORY_ACCOUNT ?? "";
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

function extrairPanelUrl(block: string): string | null {
  const patterns = [
    /window\.open\(['"]([^'"]+)['"]/i,
    /href="(\/alunos\/(?:ver|painel|panel|cronograma|index)[^"]+)"/i,
    /data-(?:href|url|panel|link)="([^"]+)"/i,
    /href="([^"]*painel[^"]*)"/i,
  ];
  for (const p of patterns) {
    const m = block.match(p);
    if (m) {
      const url = m[1];
      return url.startsWith("http") ? url : `https://admin.tutory.com.br${url}`;
    }
  }
  return null;
}

interface StudentEntry {
  nome: string;
  email: string;
  panelUrl: string | null;
  fonte: "scrape" | "db";
}

async function resolverAlunos(cookie: string): Promise<StudentEntry[]> {
  const map = new Map<string, StudentEntry>();

  // 1. Tentar scrape da lista /alunos/atraso (funciona se ainda houver alunos)
  const firstHtml = await fetch("https://admin.tutory.com.br/alunos/atraso?p=1", {
    headers: { Cookie: cookie },
  }).then((r) => r.text());

  const listaVazia = firstHtml.includes('document.location.href = "/login"');

  if (!listaVazia) {
    const parsePage = (html: string) => {
      const blocks = html.split('class="student-list-item"');
      for (const block of blocks.slice(1)) {
        const searchMatch = block.match(/data-search="([^"]+)"/);
        if (!searchMatch) continue;
        const parts = searchMatch[1].trim().split(" ");
        const email = parts[parts.length - 1].toLowerCase();
        const nome = parts.slice(0, -1).join(" ").trim();
        const stripTags = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
        const texto = stripTags(block);
        const atrasoMatch =
          texto.match(/(\d+)\s+dias?\s+de\s+atraso/i) ??
          texto.match(/atraso[:\s]+(\d+)\s+dias?/i) ??
          texto.match(/(\d+)\s+dias?/i);
        if (!atrasoMatch) continue;
        const dias = parseInt(atrasoMatch[1], 10);
        if (!email || dias <= 0) continue;
        const panelUrl = extrairPanelUrl(block);
        if (!map.has(email)) {
          map.set(email, { nome, email, panelUrl, fonte: "scrape" });
        }
      }
    };

    parsePage(firstHtml);

    const totalPagesMatch = firstHtml.match(/\?p=(\d+)[^"]*">Última/);
    const totalPages = totalPagesMatch ? parseInt(totalPagesMatch[1], 10) : 1;

    for (let start = 2; start <= totalPages; start += 5) {
      const batch = [];
      for (let p = start; p < start + 5 && p <= totalPages; p++) {
        batch.push(
          fetch(`https://admin.tutory.com.br/alunos/atraso?p=${p}`, { headers: { Cookie: cookie } })
            .then((r) => r.text())
            .then(parsePage)
        );
      }
      await Promise.all(batch);
    }
  }

  // 2. Fallback: usar snapshot de hoje (sexta atual) + tutoryId do DB
  //    Cobre alunos que não apareceram no scrape (lista já limpa) ou sem panelUrl extraído
  const sextaHoje = (() => {
    const sp = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    const [ano, mes, dia] = sp.split("-").map(Number);
    const hoje = new Date(Date.UTC(ano, mes - 1, dia));
    const dow = hoje.getUTCDay();
    const diasAteSexta = (5 - dow + 7) % 7;
    const sexta = new Date(hoje);
    if (dow !== 5) sexta.setUTCDate(hoje.getUTCDate() + diasAteSexta);
    return sexta;
  })();

  const snapshots = await prisma.snapshotAtraso.findMany({
    where: { semana: sextaHoje },
    include: { aluno: { select: { tutoryId: true } } },
  });

  for (const snap of snapshots) {
    const existing = map.get(snap.email);
    const tutoryId = snap.aluno?.tutoryId;

    if (!existing) {
      // Aluno não veio do scrape (lista já limpa) — usar tutoryId se disponível
      map.set(snap.email, {
        nome: snap.nome,
        email: snap.email,
        panelUrl: tutoryId ? `https://admin.tutory.com.br/alunos/index?aid=${tutoryId}` : null,
        fonte: "db",
      });
    } else if (!existing.panelUrl && tutoryId) {
      // Veio do scrape mas sem URL extraída — preencher com tutoryId
      existing.panelUrl = `https://admin.tutory.com.br/alunos/index?aid=${tutoryId}`;
    }
  }

  return [...map.values()];
}

async function executarReplanejamento() {
  try {
    const cookie = await getSessionCookie();
    if (!cookie) {
      return NextResponse.json(
        { error: "Falha no login Tutory (credenciais ausentes ou inválidas)" },
        { status: 500 }
      );
    }

    const alunos = await resolverAlunos(cookie);

    if (alunos.length === 0) {
      return NextResponse.json({
        ok: true,
        total: 0,
        msg: "Nenhum aluno a replanejamento (snapshot vazio e lista Tutory sem atrasos)",
        executadoEm: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
      });
    }

    const comUrl = alunos.filter((a) => a.panelUrl !== null);
    const semUrl = alunos.filter((a) => a.panelUrl === null);

    // Visitar cada painel em lotes de 3
    const resultados: { nome: string; email: string; url: string; status: number | string; fonte: string }[] = [];

    for (let i = 0; i < comUrl.length; i += 3) {
      const lote = comUrl.slice(i, i + 3);
      const resps = await Promise.all(
        lote.map(async (a) => {
          try {
            const r = await fetch(a.panelUrl!, {
              headers: {
                Cookie: cookie,
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              },
              redirect: "follow",
            });
            return { nome: a.nome, email: a.email, url: a.panelUrl!, status: r.status, fonte: a.fonte };
          } catch (e) {
            return { nome: a.nome, email: a.email, url: a.panelUrl!, status: String(e), fonte: a.fonte };
          }
        })
      );
      resultados.push(...resps);
      if (i + 3 < comUrl.length) await new Promise((r) => setTimeout(r, 400));
    }

    const sucessos = resultados.filter((r) => typeof r.status === "number" && r.status < 400).length;

    return NextResponse.json({
      ok: true,
      total: alunos.length,
      comUrl: comUrl.length,
      semUrl: semUrl.length,
      semUrlNomes: semUrl.map((a) => `${a.nome} (${a.email})`),
      replanejados: sucessos,
      resultados,
      executadoEm: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

async function executarDebug(cookie: string) {
  const html = await fetch("https://admin.tutory.com.br/alunos/atraso?p=1", {
    headers: { Cookie: cookie },
  }).then((r) => r.text());

  const blocks = html.split('class="student-list-item"');
  const loginOk = !html.includes('document.location.href = "/login"');

  return NextResponse.json({
    loginOk,
    totalBlocos: blocks.length - 1,
    primeiroBlocoRaw: blocks[1]?.slice(0, 3000) ?? null,
    panelUrlExtraido: blocks[1] ? extrairPanelUrl(blocks[1]) : null,
  });
}

// GET ?key=cg-bulk-2026            → cron (background, resposta imediata)
// GET ?key=cg-bulk-2026&debug=1    → inspeciona HTML do bloco para ajustar regex
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== "cg-bulk-2026") return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  if (req.nextUrl.searchParams.get("debug") === "1") {
    const cookie = await getSessionCookie();
    if (!cookie) return NextResponse.json({ error: "Sem cookie" }, { status: 500 });
    return executarDebug(cookie);
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
