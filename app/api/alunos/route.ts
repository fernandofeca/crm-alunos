import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";
import { registrarLog } from "@/lib/log";

const PAGE_SIZE = 50;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const q = searchParams.get("q") ?? "";
  const filtroParam = searchParams.get("filtro") ?? "";
  const filtros = filtroParam ? filtroParam.split(",").filter(Boolean) : [];
  const concursoParam = searchParams.get("concurso") ?? "";
  const concurso = concursoParam; // kept for compat
  const concursos = concursoParam ? concursoParam.split(",").filter(Boolean) : [];
  const planoTipoParam = searchParams.get("planoTipo") ?? "";
  const planoTipo = planoTipoParam; // kept for compat
  const planoTipos = planoTipoParam ? planoTipoParam.split(",").filter(Boolean) : [];
  const ativo = searchParams.get("ativo");
  const todos = searchParams.get("todos") === "true";
  const ordenar = searchParams.get("ordenar") ?? "";
  const page = Math.max(0, parseInt(searchParams.get("page") ?? "0", 10));

  // Modo leve: retorna só id+nome de todos os alunos ativos (para selects)
  if (todos) {
    const alunos = await prisma.aluno.findMany({
      where: { ativo: true },
      select: { id: true, nome: true },
      orderBy: { nome: "asc" },
    });
    return NextResponse.json(alunos);
  }

  const where: Record<string, unknown> = {};

  if (q) {
    const palavras = q.trim().split(/\s+/).filter(Boolean);
    if (palavras.length <= 1) {
      where.OR = [
        { nome: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
        { cpf: { contains: q } },
      ];
    } else {
      // Múltiplas palavras: todas devem aparecer no nome (qualquer ordem)
      where.OR = [
        {
          AND: palavras.map((p) => ({
            nome: { contains: p, mode: "insensitive" },
          })),
        },
        { email: { contains: q, mode: "insensitive" } },
        { cpf: { contains: q } },
      ];
    }
  }

  const diasAtrasoValues: number[] = [];
  for (const f of filtros) {
    if (f === "nota_baixa") {
      where.taxaAcertos = { lt: 60 };
    } else if (f === "metas_em_dia") {
      diasAtrasoValues.push(0);
    } else if (f === "novos") {
      const trinta = new Date();
      trinta.setDate(trinta.getDate() - 30);
      where.dataInicio = { gte: trinta };
    } else if (f === "sem_contato") {
      where.contatos = { none: {} };
    } else if (f === "acompanhar") {
      where.acompanharDePerto = true;
    } else {
      const metasMatch = f.match(/^metas_(\d+)d$/);
      if (metasMatch) diasAtrasoValues.push(parseInt(metasMatch[1], 10));
    }
  }
  if (diasAtrasoValues.length === 1) {
    where.diasAtraso = diasAtrasoValues[0];
  } else if (diasAtrasoValues.length > 1) {
    where.diasAtraso = { in: diasAtrasoValues };
  }

  if (concursos.length === 1) where.concurso = concursos[0];
  else if (concursos.length > 1) where.concurso = { in: concursos };
  if (planoTipos.length === 1) where.planoTipo = planoTipos[0];
  else if (planoTipos.length > 1) where.planoTipo = { in: planoTipos };
  if (ativo === "true") where.ativo = true;
  else if (ativo === "false") where.ativo = false;

  const orderBy =
    ordenar === "metas_desc"     ? [{ diasAtraso: "desc" as const }, { nome: "asc" as const }] :
    ordenar === "taxa_desc"      ? [{ taxaAcertos: "desc" as const }, { nome: "asc" as const }] :
    ordenar === "taxa_asc"       ? [{ taxaAcertos: "asc" as const }, { nome: "asc" as const }] :
    ordenar === "inicio_desc"    ? [{ dataInicio: "desc" as const }, { nome: "asc" as const }] :
    ordenar === "inicio_asc"     ? [{ dataInicio: "asc" as const }, { nome: "asc" as const }] :
    ordenar === "nome_asc"       ? [{ nome: "asc" as const }] :
    ordenar === "nome_desc"      ? [{ nome: "desc" as const }] :
    ordenar === "concurso_asc"   ? [{ concurso: "asc" as const }, { nome: "asc" as const }] :
    ordenar === "concurso_desc"  ? [{ concurso: "desc" as const }, { nome: "asc" as const }] :
    ordenar === "contato_desc"   ? [{ ultimoContatoData: "desc" as const }, { nome: "asc" as const }] :
    ordenar === "contato_asc"    ? [{ ultimoContatoData: "asc" as const }, { nome: "asc" as const }] :
    [{ nome: "asc" as const }];

  const [alunos, total] = await Promise.all([
    prisma.aluno.findMany({
      where,
      include: {
        disciplinas: { include: { assuntos: true } },
        contatos: { include: { user: true }, orderBy: { data: "desc" }, take: 1 },
      },
      orderBy,
      take: PAGE_SIZE,
      skip: page * PAGE_SIZE,
    }),
    prisma.aluno.count({ where }),
  ]);

  return NextResponse.json({ alunos, total, page, pageSize: PAGE_SIZE });
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const body = await req.json();
  const { nome, email, cpf, whatsapp, concurso, mediaGeral, disciplinas } = body;

  const aluno = await prisma.aluno.create({
    data: {
      nome,
      email,
      cpf: cpf ?? "",
      whatsapp: whatsapp ?? "",
      concurso: concurso ?? "",
      mediaGeral: mediaGeral ?? 0,
      disciplinas: disciplinas
        ? {
            create: disciplinas.map(
              (d: { nome: string; nota: number; assuntos?: { nome: string; nota: number }[] }) => ({
                nome: d.nome,
                nota: d.nota,
                assuntos: d.assuntos
                  ? { create: d.assuntos.map((a) => ({ nome: a.nome, nota: a.nota })) }
                  : undefined,
              })
            ),
          }
        : undefined,
    },
    include: { disciplinas: { include: { assuntos: true } } },
  });

  await registrarLog({
    tipo: "usuario",
    acao: "aluno_criado",
    descricao: `Criou o aluno ${aluno.nome}`,
    userId: (session.user?.id ?? null) as string | null,
    alunoId: aluno.id,
    alunoNome: aluno.nome,
  });

  return NextResponse.json(aluno, { status: 201 });
}
