CREATE TABLE "Log" (
  "id" TEXT NOT NULL,
  "tipo" TEXT NOT NULL,
  "acao" TEXT NOT NULL,
  "descricao" TEXT NOT NULL,
  "userId" TEXT,
  "alunoId" TEXT,
  "alunoNome" TEXT,
  "meta" JSONB NOT NULL DEFAULT '{}',
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Log_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Log_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "Log_criadoEm_idx" ON "Log"("criadoEm" DESC);
CREATE INDEX "Log_userId_idx" ON "Log"("userId");
