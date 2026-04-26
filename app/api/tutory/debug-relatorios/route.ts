/**
 * GET /api/tutory/debug-relatorios?key=cg-bulk-2026
 *
 * Inspeciona a página de relatórios da Tutory para entender
 * quais cursos estão disponíveis e qual endpoint é usado no download.
 */

import { NextRequest, NextResponse } from "next/server";

async function getSessionCookie(): Promise<string> {
  const account  = process.env.TUTORY_ACCOUNT ?? "";
  const password = process.env.TUTORY_PASSWORD ?? "";
  if (!account || !password) return "";
  const res = await fetch("https://admin.tutory.com.br/intent/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest" },
    body: `account=${encodeURIComponent(account)}&password=${encodeURIComponent(password)}`,
  });
  return res.headers.get("set-cookie")?.match(/PHPSESSID=[^;]+/)?.[0] ?? "";
}

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== "cg-bulk-2026") return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const cookie = await getSessionCookie();
  if (!cookie) return NextResponse.json({ error: "Login falhou" }, { status: 500 });

  // 1. Busca a página de relatórios
  const html = await fetch("https://admin.tutory.com.br/cursos/relatorios", {
    headers: { Cookie: cookie },
  }).then((r) => r.text());

  if (html.includes('document.location.href = "/login"')) {
    return NextResponse.json({ error: "Cookie inválido — redirecionou para login" }, { status: 401 });
  }

  // 2. Extrai links, forms e data-* relevantes
  const links    = [...html.matchAll(/href=["']([^"']*relatorio[^"']*)["']/gi)].map((m) => m[1]);
  const forms    = [...html.matchAll(/<form[^>]*action=["']([^"']*)["'][^>]*>/gi)].map((m) => m[1]);
  const dataUrls = [...html.matchAll(/data-(?:url|href|action|link)=["']([^"']*)["']/gi)].map((m) => ({ attr: m[0].split("=")[0], url: m[1] }));
  const selects  = [...html.matchAll(/<select[^>]*name=["']([^"']*)["'][^>]*>([\s\S]*?)<\/select>/gi)].map((m) => ({
    name: m[1],
    options: [...m[2].matchAll(/<option[^>]*value=["']([^"']*)["'][^>]*>([^<]*)/gi)].map((o) => ({ value: o[1], label: o[2].trim() })),
  }));
  const scripts  = [...html.matchAll(/(?:fetch|axios|ajax|url)\s*[:(]\s*["'`]([^"'`]*relat[^"'`]*)["'`]/gi)].map((m) => m[1]);
  const ajaxUrls = [...html.matchAll(/["'`](\/intent\/[^"'`]+)["'`]/gi)].map((m) => m[1]);

  // 3. Trecho HTML ao redor de "relat" para análise manual
  const idx = html.toLowerCase().indexOf("relat");
  const snippet = idx >= 0 ? html.slice(Math.max(0, idx - 200), idx + 600).replace(/<script[\s\S]*?<\/script>/gi, "") : "";

  return NextResponse.json({
    htmlLength: html.length,
    links,
    forms,
    dataUrls,
    selects,
    scripts,
    ajaxUrls: [...new Set(ajaxUrls)],
    snippet,
  });
}
