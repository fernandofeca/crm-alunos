import { NextRequest, NextResponse } from "next/server";

// ─── empresa fixa (CAROLINA GAUBERT MENTORIA LTDA) ───────────────────────────
const EMPRESA_ID = "6639339e5e81b61fe3467e72";

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

// ─── tipos ───────────────────────────────────────────────────────────────────
type NfItem = {
  notaFiscal: {
    id: string;
    numero: number;
    serie: string;
    dataEmissao: string;
    status: string;
    valorTotal: number;
    modeloDocumentoFiscal: string;
    chave: string | null;
    destinatario: { cpf?: string; cnpj?: string; nome?: string; nomeCompleto?: string } | null;
    naturezaOperacao: { descricao: string } | null;
  };
  cancelada: boolean;
};

type NfseItem = {
  id: string;
  numero: number;
  dataEmissao: string;
  status: string;
  tomador: { cpf?: string; cnpj?: string; razaoSocial?: string; nomeFantasia?: string; nomeCompleto?: string } | null;
  servico: { valorLiquido?: number; valorServicos?: number; discriminacao?: string } | null;
  codigoVerificacao: string | null;
};

// ─── helpers ─────────────────────────────────────────────────────────────────
function normCpf(cpf: string): string {
  return cpf.replace(/\D/g, "");
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

// NF-e: busca por CPF no campo destinatario
async function fetchNfe(token: string, cpf: string): Promise<NfItem[]> {
  const norm    = normCpf(cpf);
  const results: NfItem[] = [];

  // A API NF-e não tem filtro por CPF direto — busca via filter geral e filtra client-side
  let page = 1;
  let hasMore = true;
  while (hasMore) {
    const data = await apiGet(token, "notas-fiscais/todosPaginado", {
      page:       String(page),
      count:      "100",
      idEmpresa:  EMPRESA_ID,
    }) as { conteudo?: { content?: NfItem[]; totalPages?: number } } | null;
    if (!data) break;
    const content = data?.conteudo?.content ?? [];
    const totalPages = data?.conteudo?.totalPages ?? 1;
    for (const item of content) {
      const dest = item.notaFiscal?.destinatario;
      if (!dest) continue;
      const destCpf  = normCpf(dest.cpf ?? "");
      const destCnpj = normCpf(dest.cnpj ?? "");
      if (destCpf === norm || destCnpj === norm) results.push(item);
    }
    hasMore = page < totalPages;
    page++;
    if (page > 20) break;
  }
  return results;
}

// NFS-e: usa o filtro destinatario por CPF (funciona na API)
async function fetchNfse(token: string, cpf: string): Promise<NfseItem[]> {
  const norm    = normCpf(cpf);
  const results: NfseItem[] = [];
  let page = 1;
  let hasMore = true;
  while (hasMore) {
    const data = await apiGet(token, "notas-fiscais/municipais", {
      page:        String(page),
      count:       "100",
      idEmpresa:   EMPRESA_ID,
      destinatario: norm,
    }) as { content?: NfseItem[]; totalPages?: number } | null;
    if (!data) break;
    const content = (data as { content?: NfseItem[] })?.content ?? [];
    const totalPages = (data as { totalPages?: number })?.totalPages ?? 1;
    for (const nota of content) {
      const tom = nota.tomador;
      if (!tom) continue;
      const tomCpf  = normCpf(tom.cpf  ?? "");
      const tomCnpj = normCpf(tom.cnpj ?? "");
      if (tomCpf === norm || tomCnpj === norm) results.push(nota);
    }
    hasMore = page < totalPages;
    page++;
    if (page > 20) break;
  }
  return results;
}

// ─── route ───────────────────────────────────────────────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ cpf: string }> }
) {
  const { cpf } = await params;
  if (!cpf || normCpf(cpf).length < 11) {
    return NextResponse.json({ error: "CPF inválido" }, { status: 400 });
  }

  try {
    const token = await getToken();
    const [nfe, nfse] = await Promise.all([
      fetchNfe(token, cpf),
      fetchNfse(token, cpf),
    ]);

    type NotaUnified = {
      id: string;
      tipo: "NF-e" | "NFS-e";
      numero: number;
      serie?: string;
      dataEmissao: string;
      status: string;
      valor: number;
      descricao: string;
      chave: string | null;
      cancelada: boolean;
    };

    const notas: NotaUnified[] = [
      ...nfe.map((item) => ({
        id:          item.notaFiscal.id,
        tipo:        "NF-e" as const,
        numero:      item.notaFiscal.numero,
        serie:       item.notaFiscal.serie,
        dataEmissao: item.notaFiscal.dataEmissao,
        status:      item.notaFiscal.status,
        valor:       item.notaFiscal.valorTotal ?? 0,
        descricao:   item.notaFiscal.naturezaOperacao?.descricao ?? "",
        chave:       item.notaFiscal.chave,
        cancelada:   item.cancelada,
      })),
      ...nfse.map((nota) => ({
        id:          nota.id,
        tipo:        "NFS-e" as const,
        numero:      nota.numero,
        dataEmissao: nota.dataEmissao,
        status:      nota.status,
        valor:       nota.servico?.valorLiquido ?? nota.servico?.valorServicos ?? 0,
        descricao:   nota.servico?.discriminacao?.slice(0, 80) ?? "",
        chave:       nota.codigoVerificacao,
        cancelada:   nota.status === "CANCELADA",
      })),
    ];

    notas.sort((a, b) => new Date(b.dataEmissao).getTime() - new Date(a.dataEmissao).getTime());

    return NextResponse.json({ notas });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
