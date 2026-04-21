CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'equipe',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Aluno" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "cpf" TEXT NOT NULL DEFAULT '',
    "whatsapp" TEXT NOT NULL,
    "concurso" TEXT NOT NULL DEFAULT '',
    "mediaGeral" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ativo" BOOLEAN NOT NULL DEFAULT false,
    "estudouUltimos7d" BOOLEAN NOT NULL DEFAULT false,
    "discMaisBaixaNome" TEXT NOT NULL DEFAULT '',
    "discMaisBaixaNota" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "assuntoMaisBaixoNome" TEXT NOT NULL DEFAULT '',
    "assuntoMaisBaixoNota" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Aluno_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Disciplina" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "nota" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "alunoId" TEXT NOT NULL,
    CONSTRAINT "Disciplina_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Assunto" (
    "id" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "nota" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "disciplinaId" TEXT NOT NULL,
    CONSTRAINT "Assunto_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Contato" (
    "id" TEXT NOT NULL,
    "data" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "tipo" TEXT NOT NULL,
    "obs" TEXT NOT NULL DEFAULT '',
    "alunoId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    CONSTRAINT "Contato_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "Aluno_email_key" ON "Aluno"("email");

ALTER TABLE "Disciplina" ADD CONSTRAINT "Disciplina_alunoId_fkey"
    FOREIGN KEY ("alunoId") REFERENCES "Aluno"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Assunto" ADD CONSTRAINT "Assunto_disciplinaId_fkey"
    FOREIGN KEY ("disciplinaId") REFERENCES "Disciplina"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Contato" ADD CONSTRAINT "Contato_alunoId_fkey"
    FOREIGN KEY ("alunoId") REFERENCES "Aluno"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Contato" ADD CONSTRAINT "Contato_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
