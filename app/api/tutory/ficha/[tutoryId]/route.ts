import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

const TUTORY_ACCOUNT  = process.env.TUTORY_ACCOUNT  ?? "";
const TUTORY_PASSWORD = process.env.TUTORY_PASSWORD ?? "";

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

  cachedCookie = { value: match[0], expiry: Date.now() + 30 * 60 * 1000 }; // 30 min
  return cachedCookie.value;
}

// Busca a página do aluno e extrai ficha + campos do formulário
async function fetchPaginaAluno(cookie: string, tutoryId: string) {
  const res = await fetch(`https://admin.tutory.com.br/alunos/index?aid=${tutoryId}`, {
    headers: { Cookie: cookie },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Tutory retornou ${res.status}`);
  return res.text();
}

function extrairCampoInput(html: string, name: string): string {
  const m = html.match(new RegExp(`<input[^>]*name=["']${name}["'][^>]*value=["']([^"']*)["']`, "i"))
    ?? html.match(new RegExp(`<input[^>]*value=["']([^"']*)["'][^>]*name=["']${name}["']`, "i"));
  return m?.[1] ?? "";
}

function extrairFichaHtml(html: string): string {
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

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    cachedCookie = null;
    return fn();
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
    const ficha = await withRetry(async () => {
      const cookie = await getTutoryCookie();
      const html = await fetchPaginaAluno(cookie, tutoryId);
      return extrairFichaHtml(html);
    });
    return NextResponse.json({ ficha });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}

// ─── PUT: salvar ficha no Tutory ──────────────────────────────────────────────
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

  const { ficha } = await req.json() as { ficha: string };
  if (typeof ficha !== "string")
    return NextResponse.json({ error: "ficha inválida" }, { status: 400 });

  try {
    const result = await withRetry(async () => {
      const cookie = await getTutoryCookie();

      // Busca a página para extrair os campos obrigatórios do form
      const html = await fetchPaginaAluno(cookie, tutoryId);

      const id         = extrairCampoInput(html, "id");
      const nome       = extrairCampoInput(html, "nome");
      const nascimento = extrairCampoInput(html, "nascimento");
      const celular    = extrairCampoInput(html, "celular");
      const dataInicio = extrairCampoInput(html, "data_inicio");
      const periodo    = extrairCampoInput(html, "periodo");

      // POST para /intent/editar-aluno com todos os campos + anamnese atualizada
      // Campo no form se chama "anmnese" (typo original do Tutory)
      const body = new URLSearchParams({
        id,
        nome,
        nascimento,
        celular,
        data_inicio: dataInicio,
        periodo,
        anmnese: ficha,
      });

      const saveRes = await fetch("https://admin.tutory.com.br/intent/editar-aluno", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "X-Requested-With": "XMLHttpRequest",
          Cookie: cookie,
        },
        body: body.toString(),
        cache: "no-store",
      });

      if (!saveRes.ok) throw new Error(`Tutory retornou ${saveRes.status} ao salvar`);
      const json = await saveRes.json() as { result?: boolean; message?: string };
      if (json.result === false) throw new Error(json.message ?? "Tutory recusou a edição");
      return json;
    });

    return NextResponse.json({ ok: true, result });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
