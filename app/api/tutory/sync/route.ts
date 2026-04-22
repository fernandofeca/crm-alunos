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

async function getAuthHeaders(): Promise<Record<string, string>> {
  const token = process.env.TUTORY_TOKEN;
  if (token) {
    return { Authorization: `Bearer ${token}` };
  }
  // Fallback: session cookie via login
  const account = process.env.TUTORY_ACCOUNT ?? "";
  const password = process.env.TUTORY_PASSWORD ?? "";
  const res = await fetch("https://admin.tutory.com.br/intent/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: `account=${encodeURIComponent(account)}&password=${encodeURIComponent(password)}`,
  });
  const cookie = res.headers.get("set-cookie")?.match(/PHPSESSID=[^;]+/)?.[0] ?? "";
  if (!cookie) throw new Error("Falha na autenticação do Tutory.");
  return { Cookie: cookie };
}

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
async function fetchDiasAtraso(headers: Record<string, string>): Promise<{ map: Map<string, number>; debug: string }> {
  const map = new Map<string, number>();
  try {
    // Need a session cookie — Bearer token doesn't work for HTML pages
    let cookie = (headers["Cookie"] ?? "").match(/PHPSESSID=[^;]+/)?.[0];
    if (!cookie) {
      const account = process.env.TUTORY_ACCOUNT ?? "";
      const password = process.env.TUTORY_PASSWORD ?? "";
      if (!account || !password) return { map, debug: "TUTORY_ACCOUNT/PASSWORD não configurados" };
      const res = await fetch("https://admin.tutory.com.br/intent/login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest" },
        body: `account=${encodeURIComponent(account)}&password=${encodeURIComponent(password)}`,
      });
      cookie = res.headers.get("set-cookie")?.match(/PHPSESSID=[^;]+/)?.[0];
      if (!cookie) return { map, debug: `Login falhou (status ${res.status})` };
    }

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

// Returns map of email (lowercase) -> plano_nome from /alunos HTML page (all active students)
async function fetchPlanosAlunos(cookie: string): Promise<{ map: Map<string, string>; debug: string }> {
  const map = new Map<string, string>();
  try {
    function parsePage(html: string) {
      // Strategy 1: data-search="NAME EMAIL" blocks (same pattern as /alunos/atraso)
      // Try to find plan name near each student block
      const blocks = html.split(/class="student-list-item"/i);
      for (const block of blocks.slice(1)) {
        const searchMatch = block.match(/data-search="([^"]+)"/);
        if (!searchMatch) continue;
        const parts = searchMatch[1].trim().split(" ");
        const email = parts[parts.length - 1].toLowerCase();
        // Look for plan name in data attributes or nearby text
        const planoMatch =
          block.match(/data-plano="([^"]+)"/) ??
          block.match(/data-plan="([^"]+)"/) ??
          block.match(/class="[^"]*plano[^"]*"[^>]*>\s*([^<]+?)\s*</) ??
          block.match(/class="[^"]*plan[^"]*"[^>]*>\s*([^<]+?)\s*</);
        if (email.includes("@") && planoMatch) {
          map.set(email, planoMatch[1].trim());
        }
      }

      // Strategy 2: table rows with mailto + text columns (similar to /alunos/questoes)
      if (map.size === 0) {
        const rows = html.split(/<tr[^>]*>/i).slice(2);
        for (const row of rows) {
          const emailMatch = row.match(/href=['"]mailto:([^'"]+)['"]/i);
          if (!emailMatch) continue;
          const email = emailMatch[1].toLowerCase().trim();
          // Find non-numeric, non-empty <td> cells (likely text = plan name)
          const textCells = [...row.matchAll(/<td[^>]*>\s*([A-Za-zÀ-ÿ][^<]{3,60}?)\s*<\/td>/gi)];
          if (email.includes("@") && textCells.length > 0) {
            // Take the last meaningful text cell as plan name (usually last column)
            const plano = textCells[textCells.length - 1][1].trim();
            if (plano && !plano.includes("@")) map.set(email, plano);
          }
        }
      }
    }

    const firstHtml = await fetch("https://admin.tutory.com.br/alunos?p=1", {
      headers: { Cookie: cookie },
    }).then((r) => r.text());

    if (firstHtml.includes('document.location.href = "/login"')) {
      return { map, debug: "Cookie inválido para /alunos" };
    }
    if (firstHtml.length < 500) {
      return { map, debug: `Página /alunos muito pequena (${firstHtml.length} bytes)` };
    }

    parsePage(firstHtml);

    const totalPagesMatch = firstHtml.match(/href="\?p=(\d+)">Última/) ??
                            firstHtml.match(/\?p=(\d+)[^"]*">Última/);
    const totalPages = totalPagesMatch ? parseInt(totalPagesMatch[1], 10) : 1;

    for (let start = 2; start <= totalPages; start += 5) {
      const batch = [];
      for (let p = start; p < start + 5 && p <= totalPages; p++) {
        batch.push(
          fetch(`https://admin.tutory.com.br/alunos?p=${p}`, { headers: { Cookie: cookie } })
            .then((r) => r.text())
            .then(parsePage)
        );
      }
      await Promise.all(batch);
    }

    // Debug: show first 200 chars of page to help diagnose structure if 0 found
    const estruturaDebug = map.size === 0
      ? ` | HTML snippet: ${firstHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200)}`
      : "";

    return { map, debug: `OK — ${map.size} plano(s) em ${totalPages} pág${estruturaDebug}` };
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

export async function POST() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  try {
    const headers = await getAuthHeaders();

    // Get session cookie for HTML scraping
    let sessionCookie: string | undefined;
    if (!headers["Cookie"]) {
      const account = process.env.TUTORY_ACCOUNT ?? "";
      const password = process.env.TUTORY_PASSWORD ?? "";
      const loginRes = await fetch("https://admin.tutory.com.br/intent/login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest" },
        body: `account=${encodeURIComponent(account)}&password=${encodeURIComponent(password)}`,
      });
      sessionCookie = loginRes.headers.get("set-cookie")?.match(/PHPSESSID=[^;]+/)?.[0];
    } else {
      sessionCookie = headers["Cookie"].match(/PHPSESSID=[^;]+/)?.[0];
    }

    const cookieHeader = sessionCookie ?? "";

    const [
      { alunos: tutoryAlunos, paginacaoDebug, primeiroAlunoKeys },
      { map: diasAtrasoMap, debug: diasAtrasoDebug },
      { map: questoesMap, debug: questoesDebug },
      { map: planosMap, debug: planosDebug },
    ] = await Promise.all([
      fetchTutoryAlunos(headers),
      fetchDiasAtraso(headers),
      cookieHeader ? fetchQuestoes(cookieHeader) : Promise.resolve({ map: new Map<string, QuestaoInfo>(), debug: "Sem cookie" }),
      cookieHeader ? fetchPlanosAlunos(cookieHeader) : Promise.resolve({ map: new Map<string, string>(), debug: "Sem cookie" }),
    ]);

    if (tutoryAlunos.length === 0) {
      return NextResponse.json({ error: "Nenhum aluno retornado pelo Tutory." }, { status: 502 });
    }

    const resultados = { criados: 0, atualizados: 0, erros: [] as string[] };

    const camposDisponiveis = primeiroAlunoKeys || "—";

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

    // 4. Update concurso (plano de estudos) for ALL CRM students from /alunos HTML page
    let planosAtualizados = 0;
    if (planosMap.size > 0) {
      for (const [email, concurso] of planosMap) {
        const r = await prisma.aluno.updateMany({ where: { email }, data: { concurso } });
        planosAtualizados += r.count;
      }
    }

    const comData = tutoryAlunos.filter(t => t.dt_ini || t.dt_cadastro).length;
    const primeiroEx = tutoryAlunos[0] ? `dt_ini="${tutoryAlunos[0].dt_ini}"` : "";
    return NextResponse.json({ ...resultados, total: tutoryAlunos.length, diasAtrasoDebug, questoesDebug: `${questoesDebug} | ${questoesAtualizados} aluno(s) no CRM`, planosDebug: `${planosDebug} | ${planosAtualizados} atualizado(s)`, dataDebug: `${comData}/${tutoryAlunos.length} com dt_inicio. ${primeiroEx}`, paginacaoDebug });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro na sincronização" },
      { status: 500 }
    );
  }
}
