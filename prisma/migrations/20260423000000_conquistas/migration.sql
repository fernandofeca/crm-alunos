CREATE TABLE IF NOT EXISTS "Conquista" (
  "id" TEXT NOT NULL,
  "alunoId" TEXT NOT NULL,
  "tipo" TEXT NOT NULL,
  "semana" TIMESTAMP(3) NOT NULL,
  "horas" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Conquista_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Conquista_alunoId_fkey" FOREIGN KEY ("alunoId") REFERENCES "Aluno"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "Conquista_alunoId_tipo_semana_key" ON "Conquista"("alunoId", "tipo", "semana");
