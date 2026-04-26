import { NextRequest, NextResponse } from "next/server";

// ─── token cache (module-level, reused across requests) ─────────────────────
let cachedToken: { token: string; expiry: number } | null = null;

async function getToken(): Promise<string> {
  if (cachedToken && cachedToken.expiry > Date.now()) {
    return cachedToken.token;
  }

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
  // Cache with 1 minute margin
  cachedToken = {
    token:  data.access_token,
    expiry: Date.now() + (data.expires_in - 60) * 1000,
  };
  return cachedToken.token;
}

// ─── types ───────────────────────────────────────────────────────────────────
type NotaFiscal = {
  id: string;
  numero: number;
  serie: string;
  dataEmissao: string;
  status: string;
  valorTotal: number;
  modeloDocumentoFiscal: string;
  chave: string | null;
  destinatario: { cpf?: string; cnpj?: string; nome?: string } | null;
  naturezaOperacao: { descricao: string } | null;
};

type NotaItem = {
  notaFiscal: NotaFiscal;
  cancelada: boolean;
};

type NfseMunicipal = {
  id: string;
  numero: number;
  dataEmissao: string;
  status: string;
  tomador: { cpf?: string; cnpj?: string; razaoSocial?: string; nomeFantasia?: string } | null;
  servico: { valorLiquido?: number; valorServicos?: number; discriminacao?: string } | null;
  codigoVerificacao: string | null;
};

// ─── helpers ─────────────────────────────────────────────────────────────────
function normCpf(cpf: string): string {
  return cpf.replace(/\D/g, "");
}

async function fetchNfe(token: string, cpf: string): Promise<NotaItem[]> {
  const norm = normCpf(cpf);
  const results: NotaItem[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const res = await fetch(
      `https://api.digisan.com.br/api/v1/notas-fiscais/todosPaginado?page=${page}&count=50`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
    );
    if (!res.ok) break;

    const data = await res.json() as {
      conteudo?: { content?: NotaItem[]; totalPages?: number; totalElements?: number };
    };
    const content = data?.conteudo?.content ?? [];
    const totalPages = data?.conteudo?.totalPages ?? 1;

    for (const item of content) {
      const dest = item.notaFiscal?.destinatario;
      if (!dest) continue;
      const destCpf = normCpf(dest.cpf ?? "");
      const destCnpj = normCpf(dest.cnpj ?? "");
      if (destCpf === norm || destCnpj === norm) {
        results.push(item);
      }
    }

    hasMore = page < totalPages;
    page++;
    if (page > 20) break; // safety limit
  }

  return results;
}

async function fetchNfse(token: string, cpf: string): Promise<NfseMunicipal[]> {
  const norm = normCpf(cpf);
  const results: NfseMunicipal[] = [];
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    const res = await fetch(
      `https://api.digisan.com.br/api/v1/notas-fiscais/municipais?page=${page}&count=50`,
      { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" }
    );
    if (!res.ok) break;

    const data = await res.json() as {
      content?: NfseMunicipal[];
      totalPages?: number;
    };
    const content = data?.content ?? [];
    const totalPages = data?.totalPages ?? 1;

    for (const nota of content) {
      const tom = nota.tomador;
      if (!tom) continue;
      const tomCpf = normCpf(tom.cpf ?? "");
      const tomCnpj = normCpf(tom.cnpj ?? "");
      if (tomCpf === norm || tomCnpj === norm) {
        results.push(nota);
      }
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

    // Unify into a single list sorted by date desc
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
        valor:       item.notaFiscal.valorTotal,
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
