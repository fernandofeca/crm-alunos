import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

const TUTORY_ACCOUNT  = process.env.TUTORY_ACCOUNT  ?? "";
const TUTORY_PASSWORD = process.env.TUTORY_PASSWORD ?? "";
const TUTORY_TOKEN    = process.env.TUTORY_TOKEN    ?? "";

let cachedCookie: { value: string; expiry: number } | null = null;

async function getTutoryCookie(): Promise<string> {
  if (cachedCookie && cachedCookie.expiry > Date.now()) return cachedCookie.value;

  const res = await fetch("https://admin.tutory.com.br/intent/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: `account=${encodeURIComponent(TUTORY_ACCOUNT)}&password=${encodeURIComponent(TUTORY_PASSWORD)}`,
    cache: "no-store",
  });

  const setCookie = res.headers.get("set-cookie") ?? "";
  const match = setCookie.match(/PHPSESSID=[^;]+/);
  if (!match) throw new Error("Login Tutory falhou — cookie não encontrado");

  cachedCookie = { value: match[0], expiry: Date.now() + 30 * 60 * 1000 };
  return cachedCookie.value;
}

async function fetchPaginaHtml(cookie: string, tutoryId: string): Promise<string> {
  const res = await fetch(`https://admin.tutory.com.br/alunos/index?aid=${tutoryId}`, {
    headers: { Cookie: cookie },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Tutory retornou ${res.status}`);
  return res.text();
}

function extrairInput(html: string, name: string): string {
  const m = html.match(new RegExp(`<input[^>]*name=["']${name}["'][^>]*value=["']([^"']*)["']`, "i"))
    ?? html.match(new RegExp(`<input[^>]*value=["']([^"']*)["'][^>]*name=["']${name}["']`, "i"));
  return m?.[1] ?? "";
}

function extrairSelect(html: string, name: string): string {
  const selectMatch = html.match(
    new RegExp(`<select[^>]*name=["']${name}["'][^>]*>([\\s\\S]*?)</select>`, "i"),
  );
  if (!selectMatch) return "";
  const selectedMatch = selectMatch[1].match(/<option[^>]*value=["']([^"']*)["'][^>]*selected/i);
  if (selectedMatch) return selectedMatch[1];
  const firstMatch = selectMatch[1].match(/<option[^>]*value=["']([^"']*)["']/i);
  return firstMatch?.[1] ?? "";
}

function extrairCsrf(html: string): string {
  return html.match(/_token:\s*'([A-Fa-f0-9]{60,})'/)?.[1] ?? "";
}

function extrairFicha(html: string): string {
  const m = html.match(/<textarea[^>]*id=["']?anamnese["']?[^>]*>([\s\S]*?)<\/textarea>/i);
  return m ? limparHtml(m[1].trim()) : "";
}

function limparHtml(str: string): string {
  return str
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Converte "YYYY-MM-DD" → "DD/MM/YYYY" para o Tutory
function paraDataTutory(iso: string): string {
  if (!iso) return "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

// Calcula meses entre duas datas ISO para o campo "periodo" do Tutory
function calcularPeriodoMeses(dataInicioIso: string, vencimentoIso: string): string {
  if (!dataInicioIso || !vencimentoIso) return "";
  const ini = new Date(dataInicioIso);
  const fim = new Date(vencimentoIso);
  const meses = Math.round((fim.getTime() - ini.getTime()) / (1000 * 60 * 60 * 24 * 30.44));
  return String(Math.max(1, meses));
}

async function salvarNaTutory(
  cookie: string,
  html: string,
  overrides: Record<string, string>,
): Promise<{ result: boolean; message?: string }> {
  const csrf       = extrairCsrf(html);
  const id         = extrairInput(html, "id");
  const nome       = extrairInput(html, "nome");
  const nascimento = extrairInput(html, "nascimento");
  const celular    = extrairInput(html, "celular");
  const genero     = extrairSelect(html, "genero");
  const categoriaId = extrairSelect(html, "categoria_id");
  const ddd        = extrairSelect(html, "ddd");
  const dataInicio = extrairInput(html, "data_inicio");
  const periodo    = extrairInput(html, "periodo");
  const fichaAtual = extrairFicha(html);

  const campos: Record<string, string> = {
    _token: csrf,
    id,
    nome,
    nascimento,
    celular,
    genero,
    categoria_id: categoriaId,
    ddd,
    data_inicio: dataInicio,
    periodo,
    anmnese: fichaAtual,
    ...overrides,
  };

  const body = new URLSearchParams(campos);

  const res = await fetch("https://admin.tutory.com.br/intent/editar-aluno", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
      Cookie: cookie,
      Authorization: `Bearer ${TUTORY_TOKEN}`,
    },
    body: body.toString(),
    cache: "no-store",
  });

  if (!res.ok) throw new Error(`Tutory retornou ${res.status} ao salvar`);
  const json = await res.json() as { result?: boolean; message?: string };
  if (json.result === false) throw new Error(json.message ?? "Tutory recusou a edição");
  return { result: true };
}

async function withRetry<T>(fn: (cookie: string) => Promise<T>): Promise<T> {
  const cookie = await getTutoryCookie();
  try {
    return await fn(cookie);
  } catch {
    cachedCookie = null;
    const freshCookie = await getTutoryCookie();
    return fn(freshCookie);
  }
}

// ─── GET: buscar ficha ────────────────────────────────────────────────────────
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ tutoryId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { tutoryId } = await params;
  if (!tutoryId || isNaN(Number(tutoryId)))
    return NextResponse.json({ error: "tutoryId inválido" }, { status: 400 });

  try {
    const ficha = await withRetry(async (cookie) => {
      const html = await fetchPaginaHtml(cookie, tutoryId);
      return extrairFicha(html);
    });
    return NextResponse.json({ ficha });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

// ─── PUT: salvar campos no Tutory (ficha e/ou datas) ─────────────────────────
// Body aceita: { ficha?, dataInicio?, planoVencimento? }
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ tutoryId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id)
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const { tutoryId } = await params;
  if (!tutoryId || isNaN(Number(tutoryId)))
    return NextResponse.json({ error: "tutoryId inválido" }, { status: 400 });

  const body = await req.json() as {
    ficha?: string;
    dataInicio?: string;       // ISO "YYYY-MM-DD"
    planoVencimento?: string;  // ISO "YYYY-MM-DD"
  };

  // Monta overrides com os campos que foram enviados
  const overrides: Record<string, string> = {};
  if (typeof body.ficha === "string") overrides.anmnese = body.ficha;
  if (body.dataInicio) overrides.data_inicio = paraDataTutory(body.dataInicio);
  if (body.dataInicio && body.planoVencimento) {
    overrides.periodo = calcularPeriodoMeses(body.dataInicio, body.planoVencimento);
  }

  if (Object.keys(overrides).length === 0)
    return NextResponse.json({ error: "Nenhum campo para atualizar" }, { status: 400 });

  try {
    await withRetry(async (cookie) => {
      const html = await fetchPaginaHtml(cookie, tutoryId);
      await salvarNaTutory(cookie, html, overrides);
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
