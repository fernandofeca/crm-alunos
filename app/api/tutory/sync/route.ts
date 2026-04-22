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

async function fetchTutoryAlunos(headers: Record<string, string>): Promise<TutoryAluno[]> {
  const all: TutoryAluno[] = [];
  let pagina = 1;

  while (true) {
    const res = await fetch("https://admin.tutory.com.br/intent/listar-alunos", {
      method: "POST",
      headers: { ...headers, "X-Requested-With": "XMLHttpRequest", "Content-Type": "application/x-www-form-urlencoded" },
      body: `pagina=${pagina}`,
    });
    if (!res.ok) break;

    const data = await res.json();
    if (!data.result) break;

    const alunos: TutoryAluno[] = data.data?.alunos ?? [];
    if (alunos.length === 0) break;

    all.push(...alunos);

    const totalPaginas: number = data.data?.pagination?.["total de paginas"] ?? 1;
    if (pagina >= totalPaginas) break;
    pagina++;
  }

  return all;
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

type QuestaoInfo = { taxaAcertos: number; totalQuestoes: number };

// Returns map of email (lowercase) -> questao stats from /alunos/questoes (last 30 days)
async function fetchQuestoes(cookie: string): Promise<{ map: Map<string, QuestaoInfo>; debug: string }> {
  const map = new Map<string, QuestaoInfo>();
  try {
    function parsePage(html: string) {
      const rows = html.split("<tr>").slice(2); // skip header rows
      for (const row of rows) {
        const emailMatch = row.match(/href='mailto:([^']+)'/);
        const taxaMatch = row.match(/([\d]+[,.][\d]+)\s*%/);
        const cells = [...row.matchAll(/<td[^>]*>\s*([\d.]+)\s*<\/td>/g)];
        if (!emailMatch || !taxaMatch || cells.length < 2) continue;
        const email = emailMatch[1].toLowerCase().trim();
        // Taxa: "93.71" or "93,71" → 93.71
        const taxa = parseFloat(taxaMatch[1].replace(",", "."));
        // Questoes: "2.115" (BR thousands) → remove dots → 2115
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

    const [tutoryAlunos, { map: diasAtrasoMap, debug: diasAtrasoDebug }, { map: questoesMap, debug: questoesDebug }] = await Promise.all([
      fetchTutoryAlunos(headers),
      fetchDiasAtraso(headers),
      cookieHeader ? fetchQuestoes(cookieHeader) : Promise.resolve({ map: new Map<string, QuestaoInfo>(), debug: "Sem cookie" }),
    ]);

    if (tutoryAlunos.length === 0) {
      return NextResponse.json({ error: "Nenhum aluno retornado pelo Tutory." }, { status: 502 });
    }

    const resultados = { criados: 0, atualizados: 0, erros: [] as string[] };

    for (const t of tutoryAlunos) {
      try {
        const ativo = isAtivo(t);
        const email = t.email?.toLowerCase().trim() ?? "";
        const cpf = (t.matricula ?? "").replace(/\D/g, "");
        const whatsapp = t.ddd && t.telefone ? `${t.ddd}${t.telefone}` : "";
        const nome = t.nome?.trim() || "Sem nome";
        const concurso = t.plano_nome ?? "";
        const planoVencimento = t.dt_expiracao ? new Date(t.dt_expiracao) : null;
        const diasAtraso = diasAtrasoMap.get(email) ?? 0;
        const questao = questoesMap.get(email);
        const taxaAcertos = questao?.taxaAcertos ?? undefined;
        const totalQuestoes = questao?.totalQuestoes ?? undefined;

        // Match by email first, then CPF (only real CPFs, 11 digits, not sequential)
        let existente = email ? await prisma.aluno.findUnique({ where: { email } }) : null;
        if (!existente && cpf.length === 11 && !cpf.startsWith("000")) {
          existente = await prisma.aluno.findFirst({ where: { cpf } }) ?? null;
        }

        if (existente) {
          // Update only fields from Tutory — preserve CRM-specific history
          await prisma.aluno.update({
            where: { id: existente.id },
            data: {
              nome: nome || existente.nome,
              whatsapp: whatsapp || existente.whatsapp,
              concurso: concurso || existente.concurso,
              planoVencimento,
              ativo,
              diasAtraso,
              ...(taxaAcertos !== undefined ? { taxaAcertos } : {}),
              ...(totalQuestoes !== undefined ? { totalQuestoes } : {}),
              ...(cpf && !existente.cpf ? { cpf } : {}),
            },
          });
          resultados.atualizados++;
        } else if (ativo) {
          // Only create if currently active
          await prisma.aluno.create({
            data: {
              nome,
              email: email || `sem-email-tutory-${t.id}`,
              cpf,
              whatsapp,
              concurso,
              planoVencimento,
              ativo: true,
              diasAtraso,
              ...(taxaAcertos !== undefined ? { taxaAcertos } : {}),
              ...(totalQuestoes !== undefined ? { totalQuestoes } : {}),
            },
          });
          resultados.criados++;
        }
      } catch (e) {
        resultados.erros.push(`${t.nome}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return NextResponse.json({ ...resultados, total: tutoryAlunos.length, diasAtrasoDebug, questoesDebug });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro na sincronização" },
      { status: 500 }
    );
  }
}
