ALTER TABLE "Tarefa" ADD COLUMN IF NOT EXISTS "responsavelId" TEXT;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Tarefa_responsavelId_fkey') THEN
    ALTER TABLE "Tarefa" ADD CONSTRAINT "Tarefa_responsavelId_fkey"
      FOREIGN KEY ("responsavelId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
