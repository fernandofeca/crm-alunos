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

    const atrasoRes = await fetch("https://admin.tutory.com.br/alunos/atraso", {
      headers: { Cookie: cookie },
    });
    const html = await atrasoRes.text();

    if (html.includes('document.location.href = "/login"')) {
      return { map, debug: "Cookie inválido — página redirecionou para login" };
    }

    // Each student block: data-search="name email" ... X dias
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
    return { map, debug: `OK — ${map.size} aluno(s) com atraso encontrados` };
  } catch (e) {
    return { map, debug: `Erro: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export async function POST() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  try {
    const headers = await getAuthHeaders();
    const [tutoryAlunos, { map: diasAtrasoMap, debug: diasAtrasoDebug }] = await Promise.all([
      fetchTutoryAlunos(headers),
      fetchDiasAtraso(headers),
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
            },
          });
          resultados.criados++;
        }
      } catch (e) {
        resultados.erros.push(`${t.nome}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    return NextResponse.json({ ...resultados, total: tutoryAlunos.length, diasAtrasoDebug });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Erro na sincronização" },
      { status: 500 }
    );
  }
}
