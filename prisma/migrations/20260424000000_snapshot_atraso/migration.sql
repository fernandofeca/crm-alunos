CREATE TABLE IF NOT EXISTS "SnapshotAtraso" (
  "id"         TEXT NOT NULL,
  "semana"     TIMESTAMP(3) NOT NULL,
  "alunoId"    TEXT,
  "nome"       TEXT NOT NULL,
  "email"      TEXT NOT NULL,
  "diasAtraso" INTEGER NOT NULL,
  "criadoEm"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SnapshotAtraso_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "SnapshotAtraso_alunoId_fkey" FOREIGN KEY ("alunoId") REFERENCES "Aluno"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "SnapshotAtraso_semana_email_key" ON "SnapshotAtraso"("semana", "email");
