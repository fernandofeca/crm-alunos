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

async function fetchFicha(tutoryId: string): Promise<string> {
  const cookie = await getTutoryCookie();
  const res = await fetch(`https://admin.tutory.com.br/alunos/index?aid=${tutoryId}`, {
    headers: { Cookie: cookie },
    cache: "no-store",
  });

  if (!res.ok) throw new Error(`Tutory retornou ${res.status}`);

  const html = await res.text();

  // Extrai conteúdo do <textarea id="anamnese">...</textarea>
  const match = html.match(/<textarea[^>]*id=["']anamnese["'][^>]*>([\s\S]*?)<\/textarea>/i);
  if (!match) {
    // Tenta sem aspas também
    const match2 = html.match(/<textarea[^>]*id=anamnese[^>]*>([\s\S]*?)<\/textarea>/i);
    if (!match2) return "";
    return limparHtml(match2[1].trim());
  }
  return limparHtml(match[1].trim());
}

function limparHtml(str: string): string {
  return str
    // Converte <br> e </p> em quebra de linha antes de remover tags
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    // Remove todas as demais tags HTML
    .replace(/<[^>]*>/g, "")
    // Decodifica entidades HTML
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    // Remove linhas em branco extras
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

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
    const ficha = await fetchFicha(tutoryId);
    return NextResponse.json({ ficha });
  } catch (e) {
    // Se falhou com cookie em cache, limpa e tenta de novo
    cachedCookie = null;
    try {
      const ficha = await fetchFicha(tutoryId);
      return NextResponse.json({ ficha });
    } catch (e2) {
      return NextResponse.json(
        { error: e2 instanceof Error ? e2.message : String(e2) },
        { status: 500 },
      );
    }
  }
}
