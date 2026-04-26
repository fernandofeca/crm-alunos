import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";
import { registrarLog } from "@/lib/log";

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

import * as XLSX from "xlsx";

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

// ─── Vinculação por relatórios de curso ───────────────────────────────────────

function normNome(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

function encontrarChave(headers: string[], candidatos: string[]): string {
  const lower = headers.map((h) => String(h).toLowerCase().trim());
  for (const c of candidatos) {
    const idx = lower.indexOf(c.toLowerCase().trim());
    if (idx !== -1) return headers[idx];
  }
  for (const c of candidatos) {
    const idx = lower.findIndex((h) => h.includes(c.toLowerCase()));
    if (idx !== -1) return headers[idx];
  }
  return "";
}

async function getCursoIds(cookie: string): Promise<string[]> {
  const html = await fetch("https://admin.tutory.com.br/cursos/relatorios", {
    headers: { Cookie: cookie },
  }).then((r) => r.text());
  const matches = [...html.matchAll(/<option[^>]*value=["']([1-9]\d*)["']/gi)];
  return [...new Set(matches.map((m) => m[1]))];
}

type AlunoXLS = { tutoryId: number; email: string; nome: string; cpf: string };

async function fetchCursoAlunos(cookie: string, cursoId: string): Promise<AlunoXLS[]> {
  try {
    const res = await fetch(
      `https://admin.tutory.com.br/relatorios/?id=3&conc=${cursoId}`,
      { headers: { Cookie: cookie }, signal: AbortSignal.timeout(12_000) }
    );
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("text/html")) return [];
    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 50) return [];
    const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
    if (rows.length === 0) return [];
    const headers = Object.keys(rows[0]);
    const colId    = encontrarChave(headers, ["id", "código", "codigo", "cod", "matricula", "matrícula", "id do aluno", "id_aluno"]);
    const colEmail = encontrarChave(headers, ["email", "e-mail", "e mail", "endereco", "endereço"]);
    const colNome  = encontrarChave(headers, ["nome", "aluno", "name", "estudante"]);
    const colCpf   = encontrarChave(headers, ["cpf", "documento", "doc"]);
    const result: AlunoXLS[] = [];
    for (const row of rows) {
      const id = parseInt(String(row[colId] ?? "").trim());
      if (!id || id <= 0) continue;
      result.push({
        tutoryId: id,
        email: String(row[colEmail] ?? "").toLowerCase().trim(),
        nome:  String(row[colNome]  ?? "").trim(),
        cpf:   String(row[colCpf]   ?? "").replace(/\D/g, ""),
      });
    }
    return result;
  } catch {
    return [];
  }
}

type VincularResult = {
  vinculados: number;
  cursosComDados: number;
  cursosSemDados: number;
  totalCursosDisponiveis: number;
  proximoOffset: number;
  timedOut: boolean;
};

async function vincularPorRelatorios(cookie: string, offset: number, budgetMs: number): Promise<VincularResult> {
  const startMs  = Date.now();
  const PARALLEL = 10;

  const allIds = await getCursoIds(cookie);
  const slice  = allIds.slice(offset, offset + 500);

  const semVinculo = await prisma.aluno.findMany({
    where: { tutoryId: null },
    select: { id: true, nome: true, email: true, cpf: true },
  });

  if (semVinculo.length === 0) {
    return { vinculados: 0, cursosComDados: 0, cursosSemDados: 0, totalCursosDisponiveis: allIds.length, proximoOffset: allIds.length, timedOut: false };
  }

  const porEmail = new Map(semVinculo.map((a) => [a.email.toLowerCase(), a]));
  const porCpf   = new Map(semVinculo.filter((a) => a.cpf?.length === 11).map((a) => [a.cpf!, a]));
  const porNome  = new Map(semVinculo.map((a) => [normNome(a.nome), a]));

  let vinculados = 0, cursosComDados = 0, cursosSemDados = 0, processados = 0;

  for (let i = 0; i < slice.length; i += PARALLEL) {
    if (Date.now() - startMs > budgetMs) break;
    if (porEmail.size === 0 && porNome.size === 0 && porCpf.size === 0) break;
    const batch   = slice.slice(i, i + PARALLEL);
    const results = await Promise.allSettled(batch.map((id) => fetchCursoAlunos(cookie, id)));
    processados  += batch.length;

    for (const result of results) {
      if (result.status === "rejected" || result.value.length === 0) { cursosSemDados++; continue; }
      cursosComDados++;
      for (const t of result.value) {
        const via =
          (t.email && porEmail.has(t.email)) ? "email" :
          (t.cpf.length === 11 && porCpf.has(t.cpf)) ? "cpf" :
          (t.nome && porNome.has(normNome(t.nome))) ? "nome" : "";
        const aluno =
          (t.email && porEmail.get(t.email)) ||
          (t.cpf.length === 11 && porCpf.get(t.cpf)) ||
          (t.nome && porNome.get(normNome(t.nome)));
        if (aluno && via) {
          try {
            await prisma.aluno.update({ where: { id: aluno.id }, data: { tutoryId: t.tutoryId } });
            porEmail.delete(t.email);
            porCpf.delete(t.cpf);
            porNome.delete(normNome(t.nome));
            vinculados++;
          } catch { /* ignore */ }
        }
      }
    }
  }

  const timedOut      = processados < slice.length && Date.now() - startMs > budgetMs;
  const proximoOffset = offset + processados;
  return { vinculados, cursosComDados, cursosSemDados, totalCursosDisponiveis: allIds.length, proximoOffset, timedOut };
}

// ─── Relação de Cadastros (/loja/relatorios) ──────────────────────────────────

type RegistroCadastro = {
  email: string;
  concurso: string;
  planoVencimento: Date | null;
  dataInicio: Date | null;
};

async function fetchRelacaoCadastros(cookie: string): Promise<{ registros: RegistroCadastro[]; debug: string }> {
  try {
    // 1. Descobre o link de download na página /loja/relatorios
    const html = await fetch("https://admin.tutory.com.br/loja/relatorios", {
      headers: { Cookie: cookie },
      signal: AbortSignal.timeout(10_000),
    }).then((r) => r.text());

    let downloadPath = "";
    // Quebra em blocos de relatorio-item e procura o que contém "cadastro"
    const blocos = html.split(/(?=<div[^>]*class="[^"]*relatorio-item)/i);
    for (const bloco of blocos) {
      if (/relac[aã]o\s+de\s+cadastros?/i.test(bloco)) {
        const m = bloco.match(/href=["']([^"']+)["']/i);
        if (m) { downloadPath = m[1]; break; }
      }
    }
    if (!downloadPath) return { registros: [], debug: "Link de cadastros não encontrado na página" };

    // 2. Baixa o XLS
    const url = downloadPath.startsWith("http")
      ? downloadPath
      : `https://admin.tutory.com.br${downloadPath}`;

    const res = await fetch(url, {
      headers: { Cookie: cookie },
      signal: AbortSignal.timeout(30_000),
    });
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("text/html")) return { registros: [], debug: `Resposta HTML em vez de XLS (url: ${url})` };

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 50) return { registros: [], debug: "XLS vazio ou muito pequeno" };

    // 3. Parseia o XLS
    const wb   = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows  = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
    if (rows.length === 0) return { registros: [], debug: "XLS sem linhas" };

    const headers   = Object.keys(rows[0]);
    const colEmail  = encontrarChave(headers, ["email", "e-mail", "e mail"]);
    const colConc   = encontrarChave(headers, ["concurso", "plano", "curso", "produto", "plan", "nome do plano"]);
    const colVenc   = encontrarChave(headers, ["data fim", "vencimento", "expira", "validade", "dt_expiracao", "data de vencimento", "data vencimento", "termino", "término", "fim"]);
    const colInicio = encontrarChave(headers, ["data de inicio", "data inicio", "inicio", "dt_inicio", "dt_ini", "data de início", "data início", "início"]);

    // Agrupa por email mantendo a entrada com vencimento mais recente (plano atual)
    const byEmail = new Map<string, RegistroCadastro>();
    for (const row of rows) {
      const email = String(row[colEmail] ?? "").toLowerCase().trim();
      if (!email || !email.includes("@")) continue;

      const concurso = String(row[colConc] ?? "").trim();
      const vencRaw  = row[colVenc];

      let planoVencimento: Date | null = null;
      if (vencRaw instanceof Date) {
        planoVencimento = vencRaw;
      } else if (typeof vencRaw === "string" && vencRaw) {
        const d = new Date(vencRaw);
        if (!isNaN(d.getTime())) planoVencimento = d;
      } else if (typeof vencRaw === "number" && vencRaw > 0) {
        // Serial date do Excel
        const d = new Date(Math.round((vencRaw - 25569) * 86400 * 1000));
        if (!isNaN(d.getTime())) planoVencimento = d;
      }

      // Data de início
      const inicioRaw = row[colInicio];
      let dataInicio: Date | null = null;
      if (inicioRaw instanceof Date) dataInicio = inicioRaw;
      else if (typeof inicioRaw === "string" && inicioRaw) {
        const d = new Date(inicioRaw);
        if (!isNaN(d.getTime())) dataInicio = d;
      } else if (typeof inicioRaw === "number" && inicioRaw > 0) {
        const d = new Date(Math.round((inicioRaw - 25569) * 86400 * 1000));
        if (!isNaN(d.getTime())) dataInicio = d;
      }

      const existente = byEmail.get(email);
      const maisRecente =
        !existente ||
        (planoVencimento && (!existente.planoVencimento || planoVencimento > existente.planoVencimento));
      if (maisRecente) byEmail.set(email, { email, concurso, planoVencimento, dataInicio });
    }

    const registros = [...byEmail.values()];
    return {
      registros,
      debug: `OK — ${registros.length} alunos únicos de ${rows.length} linhas (colunas: email=${colEmail}, concurso=${colConc}, venc=${colVenc}, inicio=${colInicio})`,
    };
  } catch (e) {
    return { registros: [], debug: `Erro: ${e instanceof Error ? e.message : String(e)}` };
  }
}

// ─── handlers ─────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== "cg-bulk-2026") return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  if (req.nextUrl.searchParams.get("debug") === "atraso") {
    const cookie = await getSessionCookie();
    const html = await fetch("https://admin.tutory.com.br/alunos/atraso?p=1", { headers: { Cookie: cookie } }).then(r => r.text());
    const botoes = [...html.matchAll(/(?:href|action|data-url|data-href)=["']([^"']*retirar[^"']*)["']/gi)].map(m => m[1]);
    const forms  = [...html.matchAll(/<form[^>]*action=["']([^"']*)["'][^>]*>/gi)].map(m => m[1]);
    const onclick = [...html.matchAll(/onclick=["']([^"']*replan[^"']*|[^"']*retirar[^"']*)["']/gi)].map(m => m[1]);
    const links  = [...html.matchAll(/href=["']([^"']*retirar[^"'|]*replan[^"']*)["']/gi)].map(m => m[1]);
    return NextResponse.json({ botoes, forms, onclick, links, htmlSnippet: html.slice(html.indexOf("retirar") - 200, html.indexOf("retirar") + 400).replace(/<[^>]*>/g, " ") });
  }
  // Cron: responde imediatamente, sync em background (sem varredura de cursos)
  executarSync(false, 0).catch((e) => console.error("[sync-bg]", e));
  return NextResponse.json({
    ok: true,
    message: "Sync iniciado em background",
    timestamp: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
  });
}

export async function POST(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== "cg-bulk-2026") {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  const offsetParam = req.nextUrl.searchParams.get("offset");
  const offset = offsetParam !== null ? parseInt(offsetParam) : -1;

  // offset=-1 ou ausente → sync completo (sem varredura de cursos, para compatibilidade)
  // offset=0  → sync completo + inicia varredura de cursos
  // offset>0  → apenas continua varredura de cursos
  if (offset > 0) {
    return executarSoVincular(offset);
  }
  return executarSync(offset === 0, 0);
}

// Apenas continua a varredura de cursos (chamada automática do autoContinue)
async function executarSoVincular(offset: number) {
  const cookie = await getSessionCookie();
  if (!cookie) return NextResponse.json({ error: "Login falhou" }, { status: 500 });
  const resultado = await vincularPorRelatorios(cookie, offset, 50_000);
  return NextResponse.json({ ok: true, ...resultado });
}

async function executarSync(incluirVinculacao: boolean, vinculacaoOffset: number) {
  try {
    const cookieHeader = await getSessionCookie();
    const apiHeaders: Record<string, string> = process.env.TUTORY_TOKEN
      ? { Authorization: `Bearer ${process.env.TUTORY_TOKEN}` }
      : { Cookie: cookieHeader };

    const [
      { alunos: tutoryAlunos, paginacaoDebug, primeiroAlunoKeys },
      { map: diasAtrasoMap, debug: diasAtrasoDebug, ok: diasAtrasoOk },
      { map: questoesMap, debug: questoesDebug },
      { registros: cadastros, debug: cadastrosDebug },
    ] = await Promise.all([
      fetchTutoryAlunos(apiHeaders),
      fetchDiasAtraso(cookieHeader),
      cookieHeader ? fetchQuestoes(cookieHeader) : Promise.resolve({ map: new Map<string, QuestaoInfo>(), debug: "Sem cookie" }),
      cookieHeader ? fetchRelacaoCadastros(cookieHeader) : Promise.resolve({ registros: [], debug: "Sem cookie" }),
    ]);

    if (tutoryAlunos.length === 0) {
      return NextResponse.json({ error: "Nenhum aluno retornado pelo Tutory." }, { status: 502 });
    }

    const resultados = { criados: 0, atualizados: 0, erros: [] as string[] };

    // 1. Sync dados básicos via listar-alunos
    for (const t of tutoryAlunos) {
      try {
        const ativo = isAtivo(t);
        const email = t.email?.toLowerCase().trim() ?? "";
        const cpf = (t.matricula ?? "").replace(/\D/g, "");
        const whatsapp = t.ddd && t.telefone ? `${t.ddd}${t.telefone}` : "";
        const nome = t.nome?.trim() || "Sem nome";
        const concurso = t.plano_nome ?? "";
        const planoVencimento = t.dt_expiracao ? new Date(t.dt_expiracao) : null;
        const dataInicio      = t.dt_ini      ? new Date(t.dt_ini as string)      : null;
        const tutoryCreatedAt = t.dt_cadastro ? new Date(t.dt_cadastro as string) : dataInicio;

        let existente = email ? await prisma.aluno.findUnique({ where: { email } }) : null;
        if (!existente && cpf.length === 11 && !cpf.startsWith("000")) {
          existente = await prisma.aluno.findFirst({ where: { cpf } }) ?? null;
        }
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
            data: { nome: nome || existente.nome, whatsapp: whatsapp || existente.whatsapp, concurso: concurso || existente.concurso, planoVencimento, ativo, tutoryId: t.id, ...(cpf && !existente.cpf ? { cpf } : {}), ...(tutoryCreatedAt ? { tutoryCreatedAt } : {}), ...(dataInicio ? { dataInicio } : {}) },
          });
          resultados.atualizados++;
        } else if (ativo) {
          await prisma.aluno.create({
            data: { nome, email: email || `sem-email-tutory-${t.id}`, cpf, whatsapp, concurso, planoVencimento, ativo: true, tutoryId: t.id, ...(tutoryCreatedAt ? { tutoryCreatedAt } : {}), ...(dataInicio ? { dataInicio } : {}) },
          });
          resultados.criados++;
        }
      } catch (e) {
        resultados.erros.push(`${t.nome}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // 2. Atualiza diasAtraso
    if (diasAtrasoOk) {
      for (const [email, dias] of diasAtrasoMap) {
        await prisma.aluno.updateMany({ where: { email }, data: { diasAtraso: dias } });
      }
      await prisma.aluno.updateMany({
        where: { ativo: true, email: { notIn: [...diasAtrasoMap.keys()] } },
        data: { diasAtraso: 0 },
      });
    }

    const trintaDias = new Date();
    trintaDias.setDate(trintaDias.getDate() - 30);
    await prisma.aluno.updateMany({
      where: { ativo: true, planoTipo: "Mentoria da Posse", dataInicio: { gte: trintaDias }, diasAtraso: { gte: 4 } },
      data: { acompanharDePerto: true },
    });

    // 3. Atualiza taxaAcertos/totalQuestoes
    let questoesAtualizados = 0;
    if (questoesMap.size > 0) {
      for (const [email, { taxaAcertos, totalQuestoes }] of questoesMap) {
        const r = await prisma.aluno.updateMany({ where: { email }, data: { taxaAcertos, totalQuestoes } });
        questoesAtualizados += r.count;
      }
    }

    // 4. Atualiza concurso + planoVencimento + dataInicio via Relação de Cadastros
    //    Cobre TODOS os alunos (ativos e históricos) pelo email.
    //    Mantém o plano mais recente por aluno (já resolvido no fetchRelacaoCadastros).
    let concursosAtualizados = 0;
    for (const c of cadastros) {
      if (!c.concurso && !c.dataInicio && !c.planoVencimento) continue;
      const r = await prisma.aluno.updateMany({
        where: { email: c.email },
        data: {
          ...(c.concurso       ? { concurso: c.concurso }             : {}),
          ...(c.planoVencimento ? { planoVencimento: c.planoVencimento } : {}),
          ...(c.dataInicio      ? { dataInicio: c.dataInicio }          : {}),
        },
      });
      concursosAtualizados += r.count;
    }

    // 5. Vinculação por relatórios de curso (se solicitada, com budget restante ~25s)
    let vincularResult: VincularResult | null = null;
    if (incluirVinculacao) {
      vincularResult = await vincularPorRelatorios(cookieHeader, vinculacaoOffset, 25_000);
    }

    await registrarLog({
      tipo: "sistema",
      acao: "tutory_sync",
      descricao: `Sincronizou Tutory: ${resultados.criados} criados, ${resultados.atualizados} atualizados, ${concursosAtualizados} concursos atualizados${vincularResult ? `, ${vincularResult.vinculados} IDs vinculados` : ""}`,
      meta: { criados: resultados.criados, atualizados: resultados.atualizados, concursosAtualizados, total: tutoryAlunos.length, vinculados: vincularResult?.vinculados ?? 0 },
    });

    return NextResponse.json({
      ok: true,
      ...resultados,
      salvos: resultados.atualizados,
      total: tutoryAlunos.length,
      concursosAtualizados,
      diasAtrasoDebug,
      questoesDebug: `${questoesDebug} | ${questoesAtualizados} aluno(s) no CRM`,
      cadastrosDebug,
      paginacaoDebug,
      // Campos de vinculação (presentes só quando incluirVinculacao=true)
      ...(vincularResult ?? {}),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro na sincronização" },
      { status: 500 }
    );
  }
}
