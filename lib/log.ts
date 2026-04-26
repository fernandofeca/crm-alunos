import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

interface LogParams {
  tipo: "usuario" | "sistema";
  acao: string;
  descricao: string;
  userId?: string | null;
  alunoId?: string | null;
  alunoNome?: string | null;
  meta?: Record<string, unknown>;
}

export async function registrarLog(p: LogParams): Promise<void> {
  try {
    await prisma.log.create({
      data: {
        tipo: p.tipo,
        acao: p.acao,
        descricao: p.descricao,
        userId: p.userId ?? null,
        alunoId: p.alunoId ?? null,
        alunoNome: p.alunoNome ?? null,
        meta: (p.meta ?? {}) as Prisma.InputJsonValue,
      },
    });
  } catch {
    // Erros de log nunca devem quebrar o fluxo principal
  }
}
