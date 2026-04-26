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

// Chave "ano-mes" para agrupar
function mesKey(ano: number, mes: number): string {
  return `${ano}-${mes}`;
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

// ─── NF-e: única varredura para todos os meses ────────────────────────────────
// Faz ~13 chamadas em vez de 143 (11 meses × 13 páginas em paralelo).
// Retorna mapa "ano-mes" → { total, qtd } para o período [desde, ate].
type NfeMes = { total: number; qtd: number };

async function fetchAllNfeAgrupado(
  token: string,
  desde: Date,  // início do período mais antigo (ex: 12 meses atrás)
  ate:   Date,  // fim do período mais recente (ex: hoje)
): Promise<Map<string, NfeMes>> {
  const byMes = new Map<string, NfeMes>();
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
      const raw = new Date(item.notaFiscal.dataEmissao);
      // Normaliza para data-pura UTC (API retorna sem fuso; getFullYear/Month/Date = local)
      const d = new Date(Date.UTC(raw.getFullYear(), raw.getMonth(), raw.getDate()));
      if (d < desde) { parou = true; break; }
      if (d > ate) continue;
      if (item.cancelada || item.notaFiscal.status !== "AUTORIZADA") continue;

      const key = mesKey(d.getUTCFullYear(), d.getUTCMonth());
      const cur = byMes.get(key) ?? { total: 0, qtd: 0 };
      byMes.set(key, { total: cur.total + (item.notaFiscal.valorTotal ?? 0), qtd: cur.qtd + 1 });
    }

    if (parou) break;
    hasMore = page < totalPages;
    page++;
    if (page > 50) break;
  }
  return byMes;
}

// ─── NFS-e: filtro server-side funciona ──────────────────────────────────────
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
    }) as { content?: Array<{ notaFiscal: { status: string; valorLiquido?: number } }>; totalPages?: number } | null;
    if (!data) break;
    const content    = data.content ?? [];
    const totalPages = data.totalPages ?? 1;
    for (const nota of content) {
      if (nota.notaFiscal.status !== "AUTORIZADA") continue;
      total += nota.notaFiscal.valorLiquido ?? 0;
    }
    hasMore = page < totalPages;
    page++;
    if (page > 30) break;
  }
  return total;
}

// Conta NFS-e do mês (usa totalElements)
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
  const year  = parseInt(url.searchParams.get("year")  ?? String(now.getUTCFullYear()));
  const month = parseInt(url.searchParams.get("month") ?? String(now.getUTCMonth())); // 0-based

  const dataIni = new Date(Date.UTC(year, month, 1));
  // Mês atual: usa hoje como fim para bater com relatórios do Diginfe
  const isCurrentMonth = year === now.getUTCFullYear() && month === now.getUTCMonth();
  const dataFim = isCurrentMonth
    ? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
    : new Date(Date.UTC(year, month + 1, 0));

  // Início do histórico: 12 meses atrás (dia 1)
  const historicoDe = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));

  try {
    const token = await getToken();

    // ── Uma única varredura de NF-e cobre o mês selecionado + 12 meses de histórico
    // ── NFS-e: chamadas separadas por mês (filtro server-side funciona)
    const [nfeMap, nfseTotalMes, nfseValorMes] = await Promise.all([
      fetchAllNfeAgrupado(token, historicoDe, dataFim),
      countNfseMes(token, dataIni, dataFim),
      fetchNfseMes(token, dataIni, dataFim),
    ]);

    const nfeMes: NfeMes = nfeMap.get(mesKey(year, month)) ?? { total: 0, qtd: 0 };

    // Histórico NFS-e: 12 chamadas em paralelo (OK pois cada uma é 1-2 páginas)
    const historicoNfse = await Promise.all(
      Array.from({ length: 12 }, (_, i) => {
        const d   = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11 + i, 1));
        const ini = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
        const fim = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
        // Mês atual do histórico: já temos o valor
        if (d.getUTCFullYear() === year && d.getUTCMonth() === month) {
          return Promise.resolve({ ano: year, mes: month, nfse: nfseValorMes });
        }
        return fetchNfseMes(token, ini, fim).then((nfse) => ({
          ano: d.getUTCFullYear(),
          mes: d.getUTCMonth(),
          nfse,
        }));
      })
    );

    const historico = historicoNfse.map(({ ano, mes, nfse }) => {
      const nfe = nfeMap.get(mesKey(ano, mes)) ?? { total: 0 };
      return { ano, mes, produto: nfe.total, servico: nfse };
    });

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
