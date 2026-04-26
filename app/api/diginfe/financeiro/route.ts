import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

// ─── empresa fixa ─────────────────────────────────────────────────────────────
const EMPRESA_ID = "6639339e5e81b61fe3467e72"; // CAROLINA GAUBERT MENTORIA LTDA

// ─── acesso restrito ─────────────────────────────────────────────────────────
const EMAILS_PERMITIDOS = [
  "fernandofecalimas@gmail.com",
  "carolina@carolinagaubert.com",
];

async function podeAcessar(userId: string, email: string): Promise<boolean> {
  if (EMAILS_PERMITIDOS.includes(email)) return true;
  const user = await prisma.user.findUnique({
    where:  { id: userId },
    select: { permissoes: true },
  });
  if (!user) return false;
  try {
    const perms = JSON.parse(user.permissoes || "[]") as string[];
    return perms.includes("financeiro");
  } catch { return false; }
}

// ─── token cache ─────────────────────────────────────────────────────────────
let cachedToken: { token: string; expiry: number } | null = null;

async function getToken(): Promise<string> {
  if (cachedToken && cachedToken.expiry > Date.now()) return cachedToken.token;
  const email    = process.env.DIGINFE_EMAIL    ?? "";
  const password = process.env.DIGINFE_PASSWORD ?? "";
  if (!email || !password) throw new Error("DIGINFE_EMAIL / DIGINFE_PASSWORD não configurados");
  const res = await fetch("https://api.digisan.com.br/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type:    "password",
      username:      email,
      password:      password,
      client_id:     "angularapp",
      client_secret: "angularapp_cliente_api",
      scope:         "all",
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`OAuth falhou: ${res.status}`);
  const data = await res.json() as { access_token: string; expires_in: number };
  cachedToken = { token: data.access_token, expiry: Date.now() + (data.expires_in - 60) * 1000 };
  return cachedToken.token;
}

// ─── helpers ─────────────────────────────────────────────────────────────────
function ptDate(d: Date): string {
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yy = d.getUTCFullYear();
  return `${dd}/${mm}/${yy}`;
}

async function apiGet(token: string, path: string, params: Record<string, string>): Promise<unknown> {
  const url = new URL(`https://api.digisan.com.br/api/v1/${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    cache:   "no-store",
  });
  if (!res.ok) return null;
  return res.json();
}

// NFS-e: server-side date filter funciona com idEmpresa
async function fetchNfseMes(token: string, dataIni: Date, dataFim: Date): Promise<number> {
  const ini = ptDate(dataIni);
  const fim = ptDate(dataFim);
  let total = 0;
  let page  = 1;
  let hasMore = true;

  while (hasMore) {
    const data = await apiGet(token, "notas-fiscais/municipais", {
      page:       String(page),
      count:      "200",
      idEmpresa:  EMPRESA_ID,
      dataInicio: ini,
      dataFim:    fim,
    }) as { content?: Array<{ status: string; valorLiquido?: number; servico?: { valorLiquido?: number } }>; totalPages?: number } | null;
    if (!data) break;
    const content    = data.content ?? [];
    const totalPages = data.totalPages ?? 1;
    for (const nota of content) {
      if (nota.status === "CANCELADA") continue;
      total += nota.valorLiquido ?? nota.servico?.valorLiquido ?? 0;
    }
    hasMore = page < totalPages;
    page++;
    if (page > 30) break;
  }
  return total;
}

// NF-e: server-side date filter NÃO funciona — filtra client-side por data
// Usa paginação inteligente: para quando encontra nota mais antiga que o período
async function fetchNfeMes(token: string, dataIni: Date, dataFim: Date): Promise<{ total: number; qtd: number }> {
  let soma = 0;
  let qtd  = 0;
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const data = await apiGet(token, "notas-fiscais/todosPaginado", {
      page:      String(page),
      count:     "100",
      idEmpresa: EMPRESA_ID,
    }) as {
      conteudo?: {
        content?: Array<{ notaFiscal: { dataEmissao: string; status: string; valorTotal: number }; cancelada: boolean }>;
        totalPages?: number;
      };
    } | null;
    if (!data) break;
    const content    = data?.conteudo?.content ?? [];
    const totalPages = data?.conteudo?.totalPages ?? 1;
    let parou = false;

    for (const item of content) {
      const d = new Date(item.notaFiscal.dataEmissao);
      // notas vêm em ordem decrescente — parar quando atingir data anterior ao período
      if (d < dataIni) { parou = true; break; }
      if (d > dataFim) continue;
      if (item.cancelada || item.notaFiscal.status !== "AUTORIZADA") continue;
      soma += item.notaFiscal.valorTotal ?? 0;
      qtd++;
    }
    if (parou) break;
    hasMore = page < totalPages;
    page++;
    if (page > 30) break;
  }
  return { total: soma, qtd };
}

// Conta NFS-e do mês (sem paginação — usa totalElements)
async function countNfseMes(token: string, dataIni: Date, dataFim: Date): Promise<number> {
  const data = await apiGet(token, "notas-fiscais/municipais", {
    page:       "1",
    count:      "1",
    idEmpresa:  EMPRESA_ID,
    dataInicio: ptDate(dataIni),
    dataFim:    ptDate(dataFim),
  }) as { totalElements?: number } | null;
  return data?.totalElements ?? 0;
}

// ─── route ───────────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const ok = await podeAcessar(session.user.id, session.user.email ?? "");
  if (!ok)  return NextResponse.json({ error: "Acesso negado" }, { status: 403 });

  const url   = new URL(req.url);
  const now   = new Date();
  const year  = parseInt(url.searchParams.get("year")  ?? String(now.getFullYear()));
  const month = parseInt(url.searchParams.get("month") ?? String(now.getMonth())); // 0-based

  const dataIni = new Date(Date.UTC(year, month, 1));
  const dataFim = new Date(Date.UTC(year, month + 1, 0));

  try {
    const token = await getToken();

    // Paralelo: NF-e do mês + NFS-e do mês + histórico 12 meses
    const [nfeMes, nfseTotalMes, nfseValorMes] = await Promise.all([
      fetchNfeMes(token, dataIni, dataFim),
      countNfseMes(token, dataIni, dataFim),
      fetchNfseMes(token, dataIni, dataFim),
    ]);

    // Histórico: 12 meses anteriores (NFS-e apenas, pois tem filtro server-side)
    const historicoPromises = Array.from({ length: 12 }, (_, i) => {
      const d   = new Date(Date.UTC(now.getFullYear(), now.getMonth() - 11 + i, 1));
      const ini = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
      const fim = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
      const isAtual = d.getUTCFullYear() === year && d.getUTCMonth() === month;
      return isAtual
        // já temos esses valores
        ? Promise.resolve({ ano: year, mes: month, produto: nfeMes.total, servico: nfseValorMes })
        : Promise.all([
            fetchNfeMes(token, ini, fim),
            fetchNfseMes(token, ini, fim),
          ]).then(([nfe, nfse]) => ({
            ano:      d.getUTCFullYear(),
            mes:      d.getUTCMonth(),
            produto:  nfe.total,
            servico:  nfse,
          }));
    });

    const historico = await Promise.all(historicoPromises);

    return NextResponse.json({
      ano:          year,
      mes:          month,
      totalProduto: nfeMes.total,
      totalServico: nfseValorMes,
      totalGeral:   nfeMes.total + nfseValorMes,
      qtdNfe:       nfeMes.qtd,
      qtdNfse:      nfseTotalMes,
      historico,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
