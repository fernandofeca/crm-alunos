import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";

const PAGE_SIZE = 50;

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const { searchParams } = req.nextUrl;
  const q = searchParams.get("q") ?? "";
  const filtro = searchParams.get("filtro") ?? "";
  const concurso = searchParams.get("concurso") ?? "";
  const planoTipo = searchParams.get("planoTipo") ?? "";
  const ativo = searchParams.get("ativo");
  const todos = searchParams.get("todos") === "true";
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
    where.OR = [
      { nome: { contains: q } },
      { email: { contains: q } },
      { cpf: { contains: q } },
    ];
  }

  const statusEstudoMap: Record<string, string> = {
    todos_dias: "todos_dias",
    mais_3_dias: "mais_3_dias",
    menos_3_dias: "menos_3_dias",
    nao_estudou: "nao_estudou",
  };
  if (filtro === "nota_baixa") where.mediaGeral = { lt: 6 };
  else if (statusEstudoMap[filtro]) where.statusEstudo = statusEstudoMap[filtro];

  if (concurso) where.concurso = concurso;
  if (planoTipo) where.planoTipo = planoTipo;
  if (ativo === "true") where.ativo = true;
  else if (ativo === "false") where.ativo = false;

  const [alunos, total] = await Promise.all([
    prisma.aluno.findMany({
      where,
      include: {
        disciplinas: { include: { assuntos: true } },
        contatos: { include: { user: true }, orderBy: { data: "desc" }, take: 1 },
      },
      orderBy: { nome: "asc" },
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

  return NextResponse.json(aluno, { status: 201 });
}
