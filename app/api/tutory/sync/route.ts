import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { NextResponse } from "next/server";

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
async function fetchDiasAtraso(cookie: string): Promise<{ map: Map<string, number>; debug: string }> {
  const map = new Map<string, number>();
  try {
    if (!cookie) return { map, debug: "Sem cookie de sessão" };

    function parsePage(html: string) {
      const blocks = html.split('class="student-list-item"');
      for (const block of blocks.slice(1)) {
        const searchMatch = block.match(/data-search="([^"]+)"/);
        const diasMatch = block.match(/(\d+)\s+dias/);
        if (!searchMatch || !diasMatch) continue;
        const parts = searchMatch[1].trim().split(" ");
        const email = parts[parts.length - 1].toLowerCase();
        const dias = parseInt(diasMatch[1], 10);
        if (email && dias > 0) map.set(email, dias);
      }
    }

    // Fetch first page to find total pages
    const firstHtml = await fetch("https://admin.tutory.com.br/alunos/atraso?p=1", {
      headers: { Cookie: cookie },
    }).then((r) => r.text());

    if (firstHtml.includes('document.location.href = "/login"')) {
      return { map, debug: "Cookie inválido — página redirecionou para login" };
    }

    parsePage(firstHtml);

    const totalPagesMatch = firstHtml.match(/href="\?p=(\d+)">Última/);
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

    return { map, debug: `OK — ${map.size} aluno(s) com atraso em ${totalPages} página(s)` };
  } catch (e) {
    return { map, debug: `Erro: ${e instanceof Error ? e.message : String(e)}` };
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

export async function POST() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  try {
    // Single login — share cookie across all HTML scraping functions
    const cookieHeader = await getSessionCookie();
    const apiHeaders: Record<string, string> = process.env.TUTORY_TOKEN
      ? { Authorization: `Bearer ${process.env.TUTORY_TOKEN}` }
      : { Cookie: cookieHeader };

    const [
      { alunos: tutoryAlunos, paginacaoDebug, primeiroAlunoKeys },
      { map: diasAtrasoMap, debug: diasAtrasoDebug },
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

        if (existente) {
          await prisma.aluno.update({
            where: { id: existente.id },
            data: {
              nome: nome || existente.nome,
              whatsapp: whatsapp || existente.whatsapp,
              concurso: concurso || existente.concurso,
              planoVencimento,
              ativo,
              ...(cpf && !existente.cpf ? { cpf } : {}),
              ...(tutoryCreatedAt ? { tutoryCreatedAt } : {}),
            },
          });
          resultados.atualizados++;
        } else if (ativo) {
          await prisma.aluno.create({
            data: { nome, email: email || `sem-email-tutory-${t.id}`, cpf, whatsapp, concurso, planoVencimento, ativo: true, ...(tutoryCreatedAt ? { tutoryCreatedAt } : {}) },
          });
          resultados.criados++;
        }
      } catch (e) {
        resultados.erros.push(`${t.nome}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // 2. Update diasAtraso for ALL CRM students based on scraped atraso page
    //    (independent of listar-alunos — covers older students too)
    if (diasAtrasoMap.size > 0) {
      // Students with delays: set their diasAtraso
      for (const [email, dias] of diasAtrasoMap) {
        await prisma.aluno.updateMany({ where: { email }, data: { diasAtraso: dias } });
      }
      // All other active students: reset to 0
      await prisma.aluno.updateMany({
        where: { ativo: true, email: { notIn: [...diasAtrasoMap.keys()] } },
        data: { diasAtraso: 0 },
      });
    }

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
