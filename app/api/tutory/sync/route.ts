import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";

type TutoryAluno = {
  id: number;
  matricula: string;
  email: string;
  nome: string;
  ddd: number | null;
  telefone: string | null;
  plano_nome: string | null;
  dt_expiracao: string | null;
  dt_ini?: string | null;
  dt_cadastro?: string | null;
  [key: string]: unknown;
};


type FetchAlunosResult = { alunos: TutoryAluno[]; paginacaoDebug: string; primeiroAlunoKeys: string };

async function fetchTutoryAlunos(headers: Record<string, string>): Promise<FetchAlunosResult> {
  const all: TutoryAluno[] = [];
  let pagina = 1;
  let paginacaoDebug = "";
  let primeiroAlunoKeys = "";

  while (true) {
    const res = await fetch("https://admin.tutory.com.br/intent/listar-alunos", {
      method: "POST",
      headers: { ...headers, "X-Requested-With": "XMLHttpRequest", "Content-Type": "application/x-www-form-urlencoded" },
      body: `pagina=${pagina}`,
    });
    if (!res.ok) { paginacaoDebug += `[p${pagina} HTTP ${res.status}]`; break; }
    const data = await res.json();
    if (!data.result) { paginacaoDebug += `[p${pagina} result=false]`; break; }
    const alunos: TutoryAluno[] = data.data?.alunos ?? [];
    if (alunos.length === 0) { paginacaoDebug += `[p${pagina} vazio]`; break; }
    if (pagina === 1) {
      primeiroAlunoKeys = Object.keys(alunos[0]).join(", ");
      paginacaoDebug = `p1=${alunos.length} | pagination=${JSON.stringify(data.data?.pagination)}`;
    }
    all.push(...alunos);
    const paginationObj = data.data?.pagination ?? {};
    const totalPaginas: number =
      paginationObj["total de paginas"] ??
      paginationObj["total_de_paginas"] ??
      paginationObj["totalPaginas"] ??
      paginationObj["total_pages"] ?? 1;
    if (pagina >= totalPaginas) break;
    pagina++;
  }

  return { alunos: all, paginacaoDebug, primeiroAlunoKeys };
}

function isAtivo(aluno: TutoryAluno): boolean {
  if (!aluno.dt_expiracao) return false;
  return new Date(aluno.dt_expiracao) >= new Date();
}

// Returns map of email (lowercase) -> diasAtraso, plus diagnostic info
async function fetchDiasAtraso(cookie: string): Promise<{ map: Map<string, number>; debug: string; ok: boolean }> {
  const map = new Map<string, number>();
  try {
    if (!cookie) return { map, debug: "Sem cookie de sessão", ok: false };

    function parsePage(html: string) {
      const stripTags = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
      const blocks = html.split('class="student-list-item"');
      for (const block of blocks.slice(1)) {
        const searchMatch = block.match(/data-search="([^"]+)"/);
        if (!searchMatch) continue;
        const parts = searchMatch[1].trim().split(" ");
        const email = parts[parts.length - 1].toLowerCase();
        const texto = stripTags(block);
        // Match "X dia(s) de atraso" or "atraso: X" or "X dias" — try specific first
        const atrasoMatch =
          texto.match(/(\d+)\s+dias?\s+de\s+atraso/i) ??
          texto.match(/atraso[:\s]+(\d+)\s+dias?/i) ??
          texto.match(/(\d+)\s+dias?/i);
        if (!atrasoMatch) continue;
        const dias = parseInt(atrasoMatch[1], 10);
        if (email && dias > 0) map.set(email, dias);
      }
    }

    // Fetch first page to find total pages
    const firstHtml = await fetch("https://admin.tutory.com.br/alunos/atraso?p=1", {
      headers: { Cookie: cookie },
    }).then((r) => r.text());

    if (firstHtml.includes('document.location.href = "/login"')) {
      return { map, debug: "Cookie inválido — página redirecionou para login", ok: false };
    }

    parsePage(firstHtml);

    const totalPagesMatch = firstHtml.match(/\?p=(\d+)[^"]*">Última/);
    const totalPages = totalPagesMatch ? parseInt(totalPagesMatch[1], 10) : 1;

    // Fetch remaining pages in parallel (batches of 5)
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

    // ok=true mesmo com 0 resultados — significa que a página carregou normalmente
    return { map, debug: `OK — ${map.size} aluno(s) com atraso em ${totalPages} página(s)`, ok: true };
  } catch (e) {
    return { map, debug: `Erro: ${e instanceof Error ? e.message : String(e)}`, ok: false };
  }
}



type QuestaoInfo = { taxaAcertos: number; totalQuestoes: number };

// Returns map of email (lowercase) -> questao stats from /alunos/questoes (last 30 days)
async function fetchQuestoes(cookie: string): Promise<{ map: Map<string, QuestaoInfo>; debug: string }> {
  const map = new Map<string, QuestaoInfo>();
  try {
    function parsePage(html: string) {
      // Split on any <tr> tag (may have attributes like <tr class="...">)
      const rows = html.split(/<tr[^>]*>/i).slice(2); // skip header rows
      for (const row of rows) {
        const emailMatch = row.match(/href=['"]mailto:([^'"]+)['"]/i);
        const taxaMatch = row.match(/([\d]+(?:[,.][\d]+)?)\s*%/);
        const cells = [...row.matchAll(/<td[^>]*>\s*([\d.]+)\s*<\/td>/gi)];
        if (!emailMatch || !taxaMatch || cells.length < 1) continue;
        const email = emailMatch[1].toLowerCase().trim();
        // Taxa: "93.71" or "93,71" or "80" → 93.71 / 80.0
        const taxa = parseFloat(taxaMatch[1].replace(",", "."));
        // First numeric cell is total questoes: "2.115" (BR thousands) → 2115
        const totalQuestoes = parseInt(cells[0][1].replace(/\./g, ""), 10);
        if (email && !isNaN(taxa) && !isNaN(totalQuestoes) && totalQuestoes > 0) {
          map.set(email, { taxaAcertos: taxa, totalQuestoes });
        }
      }
    }

    // Pagination links are ?p=N&t=30&m=50 format
    const firstHtml = await fetch("https://admin.tutory.com.br/alunos/questoes?p=1&t=30&m=50", {
      headers: { Cookie: cookie },
    }).then((r) => r.text());

    if (firstHtml.includes('document.location.href = "/login"')) {
      return { map, debug: "Cookie inválido para questoes" };
    }
    if (firstHtml.length < 1000) {
      return { map, debug: `Página questoes muito pequena (${firstHtml.length} bytes)` };
    }

    parsePage(firstHtml);

    // Match any pagination "Última" link regardless of param order
    const totalPagesMatch = firstHtml.match(/\?p=(\d+)[^"]*">Última/);
    const totalPages = totalPagesMatch ? parseInt(totalPagesMatch[1], 10) : 1;

    for (let start = 2; start <= totalPages; start += 5) {
      const batch = [];
      for (let p = start; p < start + 5 && p <= totalPages; p++) {
        batch.push(
          fetch(`https://admin.tutory.com.br/alunos/questoes?p=${p}&t=30&m=50`, { headers: { Cookie: cookie } })
            .then((r) => r.text())
            .then(parsePage)
        );
      }
      await Promise.all(batch);
    }
    return { map, debug: `OK — ${map.size} aluno(s) em ${totalPages} página(s)` };
  } catch (e) {
    return { map, debug: `Erro: ${e instanceof Error ? e.message : String(e)}` };
  }
}

async function getSessionCookie(): Promise<string> {
  const account = process.env.TUTORY_ACCOUNT ?? "";
  const password = process.env.TUTORY_PASSWORD ?? "";
  if (!account || !password) return "";
  const res = await fetch("https://admin.tutory.com.br/intent/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest" },
    body: `account=${encodeURIComponent(account)}&password=${encodeURIComponent(password)}`,
  });
  return res.headers.get("set-cookie")?.match(/PHPSESSID=[^;]+/)?.[0] ?? "";
}

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== "cg-bulk-2026") return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  // ?debug=atraso → inspeciona botões/forms da página de atraso
  if (req.nextUrl.searchParams.get("debug") === "atraso") {
    const cookie = await getSessionCookie();
    const html = await fetch("https://admin.tutory.com.br/alunos/atraso?p=1", { headers: { Cookie: cookie } }).then(r => r.text());
    const botoes = [...html.matchAll(/(?:href|action|data-url|data-href)=["']([^"']*retirar[^"']*)["']/gi)].map(m => m[1]);
    const forms = [...html.matchAll(/<form[^>]*action=["']([^"']*)["'][^>]*>/gi)].map(m => m[1]);
    const onclick = [...html.matchAll(/onclick=["']([^"']*replan[^"']*|[^"']*retirar[^"']*)["']/gi)].map(m => m[1]);
    const links = [...html.matchAll(/href=["']([^"']*retirar[^"'|]*replan[^"']*)["']/gi)].map(m => m[1]);
    return NextResponse.json({ botoes, forms, onclick, links, htmlSnippet: html.slice(html.indexOf("retirar") - 200, html.indexOf("retirar") + 400).replace(/<[^>]*>/g, " ") });
  }
  // Cron: responde imediatamente e roda o sync em background
  // (cron-job.org tem timeout de 30s, mas o sync demora mais)
  executarSync().catch((e) => console.error("[sync-bg]", e));
  return NextResponse.json({
    ok: true,
    message: "Sync iniciado em background",
    timestamp: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
  });
}

export async function POST(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key === "cg-bulk-2026") return executarSync();
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  return executarSync();
}

async function executarSync() {

  try {
    // Single login — share cookie across all HTML scraping functions
    const cookieHeader = await getSessionCookie();
    const apiHeaders: Record<string, string> = process.env.TUTORY_TOKEN
      ? { Authorization: `Bearer ${process.env.TUTORY_TOKEN}` }
      : { Cookie: cookieHeader };

    const [
      { alunos: tutoryAlunos, paginacaoDebug, primeiroAlunoKeys },
      { map: diasAtrasoMap, debug: diasAtrasoDebug, ok: diasAtrasoOk },
      { map: questoesMap, debug: questoesDebug },
    ] = await Promise.all([
      fetchTutoryAlunos(apiHeaders),
      fetchDiasAtraso(cookieHeader),
      cookieHeader ? fetchQuestoes(cookieHeader) : Promise.resolve({ map: new Map<string, QuestaoInfo>(), debug: "Sem cookie" }),
    ]);

    if (tutoryAlunos.length === 0) {
      return NextResponse.json({ error: "Nenhum aluno retornado pelo Tutory." }, { status: 502 });
    }

    const resultados = { criados: 0, atualizados: 0, erros: [] as string[] };

    // 1. Sync basic student data from listar-alunos
    for (const t of tutoryAlunos) {
      try {
        const ativo = isAtivo(t);
        const email = t.email?.toLowerCase().trim() ?? "";
        const cpf = (t.matricula ?? "").replace(/\D/g, "");
        const whatsapp = t.ddd && t.telefone ? `${t.ddd}${t.telefone}` : "";
        const nome = t.nome?.trim() || "Sem nome";
        const concurso = t.plano_nome ?? "";
        const planoVencimento = t.dt_expiracao ? new Date(t.dt_expiracao) : null;
        const dtCadastroRaw = (t.dt_ini ?? t.dt_cadastro ?? null) as string | null;
        const tutoryCreatedAt = dtCadastroRaw ? new Date(dtCadastroRaw) : null;

        let existente = email ? await prisma.aluno.findUnique({ where: { email } }) : null;
        if (!existente && cpf.length === 11 && !cpf.startsWith("000")) {
          existente = await prisma.aluno.findFirst({ where: { cpf } }) ?? null;
        }
        // Fallback: match by normalized name (remove accents, lowercase, collapse spaces)
        if (!existente && nome && nome !== "Sem nome") {
          const normalizar = (s: string) =>
            s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
          const nomeNorm = normalizar(nome);
          const candidatos = await prisma.aluno.findMany({ where: { tutoryId: null } });
          existente = candidatos.find((c) => normalizar(c.nome) === nomeNorm) ?? null;
        }

        if (existente) {
          await prisma.aluno.update({
            where: { id: existente.id },
            data: {
              nome: nome || existente.nome,
              whatsapp: whatsapp || existente.whatsapp,
              concurso: concurso || existente.concurso,
              planoVencimento,
              ativo,
              tutoryId: t.id,
              ...(cpf && !existente.cpf ? { cpf } : {}),
              ...(tutoryCreatedAt ? { tutoryCreatedAt } : {}),
            },
          });
          resultados.atualizados++;
        } else if (ativo) {
          await prisma.aluno.create({
            data: { nome, email: email || `sem-email-tutory-${t.id}`, cpf, whatsapp, concurso, planoVencimento, ativo: true, tutoryId: t.id, ...(tutoryCreatedAt ? { tutoryCreatedAt } : {}) },
          });
          resultados.criados++;
        }
      } catch (e) {
        resultados.erros.push(`${t.nome}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // 2. Update diasAtraso for ALL CRM students based on scraped atraso page
    //    (independent of listar-alunos — covers older students too)
    //    ok=true means the page loaded correctly (even with 0 results = all delays cleared)
    //    ok=false means login failed or network error — skip to avoid wiping valid data
    if (diasAtrasoOk) {
      // Students with delays: set their diasAtraso
      for (const [email, dias] of diasAtrasoMap) {
        await prisma.aluno.updateMany({ where: { email }, data: { diasAtraso: dias } });
      }
      // All other active students: reset to 0 (including when map is empty = no delays at all)
      await prisma.aluno.updateMany({
        where: { ativo: true, email: { notIn: [...diasAtrasoMap.keys()] } },
        data: { diasAtraso: 0 },
      });
    }

    // 2b. Auto-flag "Acompanhar de Perto" for new students (dataInicio <= 30d) with 4+ days delay
    const trintaDias = new Date();
    trintaDias.setDate(trintaDias.getDate() - 30);
    await prisma.aluno.updateMany({
      where: { ativo: true, planoTipo: "Mentoria da Posse", dataInicio: { gte: trintaDias }, diasAtraso: { gte: 4 } },
      data: { acompanharDePerto: true },
    });

    // 3. Update taxaAcertos/totalQuestoes for ALL CRM students based on questoes page
    let questoesAtualizados = 0;
    if (questoesMap.size > 0) {
      for (const [email, { taxaAcertos, totalQuestoes }] of questoesMap) {
        const r = await prisma.aluno.updateMany({ where: { email }, data: { taxaAcertos, totalQuestoes } });
        questoesAtualizados += r.count;
      }
    }

    return NextResponse.json({ ...resultados, total: tutoryAlunos.length, diasAtrasoDebug, questoesDebug: `${questoesDebug} | ${questoesAtualizados} aluno(s) no CRM`, paginacaoDebug });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro na sincronização" },
      { status: 500 }
    );
  }
}
