/**
 * Debug: inspeciona a página /alunos/coaching para descobrir
 * formulários, botões e endpoints XHR usados no fluxo "Gerar Lote".
 */
import { NextRequest, NextResponse } from "next/server";

async function getAdminCookie(): Promise<string> {
  const account = process.env.TUTORY_ACCOUNT ?? "";
  const password = process.env.TUTORY_PASSWORD ?? "";
  if (!account || !password) return "";
  const res = await fetch("https://admin.tutory.com.br/intent/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: `account=${encodeURIComponent(account)}&password=${encodeURIComponent(password)}`,
    redirect: "manual",
  });
  return res.headers.get("set-cookie")?.match(/PHPSESSID=[^;]+/)?.[0] ?? "";
}

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== "cg-bulk-2026") return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const adminCookie = await getAdminCookie();
  if (!adminCookie) return NextResponse.json({ error: "Login falhou" }, { status: 500 });

  const html = await fetch("https://admin.tutory.com.br/alunos/coaching", {
    headers: { Cookie: adminCookie },
  }).then((r) => r.text());

  if (html.includes('document.location.href = "/login"')) {
    return NextResponse.json({ error: "Sessão inválida" }, { status: 401 });
  }

  // Extrai formulários e seus campos
  const forms: { action: string; method: string; fields: string[] }[] = [];
  const formBlocks = html.match(/<form[^>]*>[\s\S]*?<\/form>/gi) ?? [];
  for (const fb of formBlocks) {
    const action = fb.match(/action=["']([^"']+)["']/i)?.[1] ?? "(sem action)";
    const method = fb.match(/method=["']([^"']+)["']/i)?.[1] ?? "get";
    const fields = [...fb.matchAll(/name=["']([^"']+)["']/gi)].map((m) => m[1]);
    forms.push({ action, method, fields });
  }

  // Extrai botões com data-attributes relevantes
  const botoes: { texto: string; attrs: Record<string, string> }[] = [];
  const btnMatches = html.matchAll(/<(?:button|a)[^>]*class="[^"]*(?:btn|button)[^"]*"[^>]*>([\s\S]*?)<\/(?:button|a)>/gi);
  for (const m of btnMatches) {
    const tag = m[0];
    const texto = m[1].replace(/<[^>]+>/g, "").trim().slice(0, 80);
    const attrs: Record<string, string> = {};
    for (const attr of tag.matchAll(/\s(data-[\w-]+|id|href|onclick)=["']([^"']*)["']/gi)) {
      attrs[attr[1]] = attr[2].slice(0, 200);
    }
    if (Object.keys(attrs).length > 0 || texto.toLowerCase().includes("relat") || texto.toLowerCase().includes("lot") || texto.toLowerCase().includes("ger")) {
      botoes.push({ texto, attrs });
    }
  }

  // Extrai chamadas fetch/$.ajax/$.post nos scripts inline
  const inlineScripts: string[] = [];
  const scriptBlocks = html.match(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/gi) ?? [];
  for (const sb of scriptBlocks) {
    const inner = sb.replace(/<\/?script[^>]*>/gi, "").trim();
    if (
      inner.includes("fetch(") ||
      inner.includes("$.ajax") ||
      inner.includes("$.post") ||
      inner.includes("$.get") ||
      inner.includes("relatorio") ||
      inner.includes("coaching") ||
      inner.includes("lote") ||
      inner.includes("gerar")
    ) {
      inlineScripts.push(inner.slice(0, 2000));
    }
  }

  // Extrai URLs de scripts externos Tutory
  const scriptUrls = [...html.matchAll(/src=["'](https?:\/\/[^"']+\.js[^"']*|\/[^"']+\.js[^"']*)/gi)]
    .map((m) => m[1])
    .filter((u) => u.includes("tutory") || !u.includes("vendor"));

  // Amostra do HTML em volta de palavras-chave relevantes
  const snippets: string[] = [];
  for (const kw of ["gerar", "lote", "relatorio", "coaching", "estudo", "desempenho"]) {
    const idx = html.toLowerCase().indexOf(kw);
    if (idx >= 0) snippets.push(`[${kw}] ...${html.slice(Math.max(0, idx - 100), idx + 300)}...`);
  }

  return NextResponse.json({
    pageSize: html.length,
    forms,
    botoes,
    inlineScripts,
    scriptUrls,
    snippets,
  });
}
