CREATE TABLE IF NOT EXISTS "Tarefa" (
    "id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL DEFAULT '',
    "concluida" BOOLEAN NOT NULL DEFAULT false,
    "prioridade" TEXT NOT NULL DEFAULT 'media',
    "dataVencimento" TIMESTAMP(3),
    "alunoId" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Tarefa_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Evento" (
    "id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL DEFAULT '',
    "data" TIMESTAMP(3) NOT NULL,
    "tipo" TEXT NOT NULL DEFAULT 'lembrete',
    "alunoId" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Evento_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Tarefa_alunoId_fkey') THEN
    ALTER TABLE "Tarefa" ADD CONSTRAINT "Tarefa_alunoId_fkey"
      FOREIGN KEY ("alunoId") REFERENCES "Aluno"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Tarefa_userId_fkey') THEN
    ALTER TABLE "Tarefa" ADD CONSTRAINT "Tarefa_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Evento_alunoId_fkey') THEN
    ALTER TABLE "Evento" ADD CONSTRAINT "Evento_alunoId_fkey"
      FOREIGN KEY ("alunoId") REFERENCES "Aluno"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Evento_userId_fkey') THEN
    ALTER TABLE "Evento" ADD CONSTRAINT "Evento_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
