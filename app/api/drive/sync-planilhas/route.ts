/**
 * Sync Planilhas Google Drive → Aluno.planilhaUrl
 *
 * Usa Google Drive API v3 (sem OAuth — só API Key + pasta pública).
 * Lista todos os arquivos da pasta, normaliza os nomes e cruza com o banco.
 *
 * GET ?key=cg-bulk-2026&dry=1  → mostra matches sem salvar
 * GET ?key=cg-bulk-2026        → salva no banco
 * POST (autenticado)           → mesma coisa
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { registrarLog } from "@/lib/log";

const FOLDER_ID = "1qdM6wxLIqMadq6NphCUG92rVBZiKnTlb";

// ─── normalização de nomes ────────────────────────────────────────────────────

function normalizeName(name: string): string {
  return name
    // Remove emojis e símbolos Unicode não-alfanuméricos
    .replace(/[\u{1F000}-\u{1FFFF}|\u{2600}-\u{27FF}|\u{2700}-\u{27BF}|\u{FE00}-\u{FEFF}|\u{1F900}-\u{1F9FF}]/gu, "")
    // Remove caracteres especiais de prefixo comuns (💎 ⭐ etc.)
    .replace(/^[^\w\s]+/, "")
    // Remove prefixos "CO-", "CO ", "C0-" usados no banco
    .replace(/^c[o0][\s\-–]+/i, "")
    // Remove extensões de arquivo
    .replace(/\.xlsx?$/i, "")
    // Normaliza acentos → ASCII
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    // Lowercase e trim
    .toLowerCase()
    .trim()
    // Colapsa espaços múltiplos
    .replace(/\s+/g, " ");
}

// Distância de Levenshtein simples para fuzzy match
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

function similaridade(a: string, b: string): number {
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  return maxLen === 0 ? 1 : 1 - dist / maxLen;
}

// ─── listar arquivos do Drive ─────────────────────────────────────────────────

interface DriveFile { id: string; name: string; webViewLink: string }

async function listarArquivosDrive(apiKey: string): Promise<DriveFile[]> {
  const todos: DriveFile[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      q: `'${FOLDER_ID}' in parents and trashed = false`,
      fields: "nextPageToken,files(id,name,webViewLink)",
      pageSize: "1000",
      key: apiKey,
      ...(pageToken ? { pageToken } : {}),
    });

    const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`);
    const json = await res.json();

    if (!res.ok) throw new Error(`Drive API error: ${JSON.stringify(json)}`);

    todos.push(...(json.files ?? []));
    pageToken = json.nextPageToken;
  } while (pageToken);

  // Remove o arquivo modelo
  return todos.filter((f) => !f.name.toLowerCase().includes("modelo"));
}

// ─── matching ─────────────────────────────────────────────────────────────────

interface MatchResult {
  driveNome: string;
  driveLink: string;
  alunoId?: string;
  alunoNome?: string;
  similaridade?: number;
  status: "exato" | "fuzzy" | "sem_match";
}

async function fazerMatching(arquivos: DriveFile[]): Promise<MatchResult[]> {
  const alunos = await prisma.aluno.findMany({
    select: { id: true, nome: true },
  });

  const alunosNorm = alunos.map((a) => ({
    ...a,
    nomeNorm: normalizeName(a.nome),
  }));

  const resultados: MatchResult[] = [];

  for (const arq of arquivos) {
    const nomeNorm = normalizeName(arq.name);

    // 1. Match exato
    const exato = alunosNorm.find((a) => a.nomeNorm === nomeNorm);
    if (exato) {
      resultados.push({
        driveNome: arq.name,
        driveLink: arq.webViewLink,
        alunoId: exato.id,
        alunoNome: exato.nome,
        similaridade: 1,
        status: "exato",
      });
      continue;
    }

    // 2. Fuzzy match (threshold 0.80)
    let melhor = { aluno: alunosNorm[0], sim: 0 };
    for (const a of alunosNorm) {
      const sim = similaridade(nomeNorm, a.nomeNorm);
      if (sim > melhor.sim) melhor = { aluno: a, sim };
    }

    if (melhor.sim >= 0.93) {
      resultados.push({
        driveNome: arq.name,
        driveLink: arq.webViewLink,
        alunoId: melhor.aluno.id,
        alunoNome: melhor.aluno.nome,
        similaridade: Math.round(melhor.sim * 100) / 100,
        status: "fuzzy",
      });
    } else {
      resultados.push({
        driveNome: arq.name,
        driveLink: arq.webViewLink,
        status: "sem_match",
      });
    }
  }

  return resultados;
}

// ─── salvar no banco ──────────────────────────────────────────────────────────

async function salvarPlanilhas(matches: MatchResult[]): Promise<number> {
  const paraAtualizar = matches.filter((m) => m.alunoId && m.driveLink);
  await Promise.all(
    paraAtualizar.map((m) =>
      prisma.aluno.update({
        where: { id: m.alunoId },
        data: { planilhaUrl: m.driveLink },
      })
    )
  );
  return paraAtualizar.length;
}

// ─── handler ──────────────────────────────────────────────────────────────────

async function executarSync(dry: boolean) {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GOOGLE_API_KEY não configurada no ambiente" }, { status: 500 });
  }

  let arquivos: DriveFile[];
  try {
    arquivos = await listarArquivosDrive(apiKey);
  } catch (e) {
    return NextResponse.json({ error: `Erro ao acessar Google Drive: ${String(e)}` }, { status: 500 });
  }

  const matches = await fazerMatching(arquivos);

  const exatos = matches.filter((m) => m.status === "exato");
  const fuzzy = matches.filter((m) => m.status === "fuzzy");
  const semMatch = matches.filter((m) => m.status === "sem_match");

  let salvos = 0;
  if (!dry) {
    salvos = await salvarPlanilhas(matches);
    await registrarLog({
      tipo: "sistema",
      acao: "drive_sync",
      descricao: `Sincronizou planilhas do Drive: ${salvos} vínculos salvos (${exatos.length} exatos + ${fuzzy.length} fuzzy)`,
      meta: { exatos: exatos.length, fuzzy: fuzzy.length, semMatch: semMatch.length, salvos },
    });
  }

  return NextResponse.json({
    ok: true,
    dry,
    totalArquivosDrive: arquivos.length,
    exatos: exatos.length,
    fuzzy: fuzzy.length,
    semMatch: semMatch.length,
    salvos: dry ? "(dry run)" : salvos,
    detalhesFuzzy: fuzzy.map((m) => ({
      drive: m.driveNome,
      banco: m.alunoNome,
      sim: m.similaridade,
    })),
    semMatchLista: semMatch.map((m) => m.driveNome),
  });
}

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== "cg-bulk-2026") return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  const dry = req.nextUrl.searchParams.get("dry") === "1";
  return executarSync(dry);
}

export async function POST(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== "cg-bulk-2026") {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  return executarSync(false);
}
