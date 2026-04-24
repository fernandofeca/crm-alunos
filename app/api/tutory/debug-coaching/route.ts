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

  // Extrai o script inline que contém "relatorio", "coaching" ou "lote" — sem limite
  const scriptBlocks = html.match(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/gi) ?? [];
  const inlineScriptCompleto = scriptBlocks
    .map((sb) => sb.replace(/<\/?script[^>]*>/gi, "").trim())
    .filter((s) => s.includes("relatorio") || s.includes("coaching") || s.includes("lote") || s.includes("dispararEmails"))
    .join("\n\n---\n\n");

  // 1. Meta tags de token/csrf
  const metaTags = [...html.matchAll(/<meta[^>]+>/gi)]
    .map((m) => m[0])
    .filter((t) => /token|csrf|_token/i.test(t));

  // 2. Variáveis JS globais com "token"
  const jsTokenVars: string[] = [];
  for (const sb of scriptBlocks) {
    const inner = sb.replace(/<\/?script[^>]*>/gi, "");
    for (const m of inner.matchAll(/(?:var|let|const|window\.)[\w.]*[Tt]oken[\w.]*\s*=\s*['"`]([^'"`]{10,})['"`;]/g)) {
      jsTokenVars.push(`${m[0].trim().slice(0, 200)}`);
    }
  }

  // 3. Primeira 500 chars do <head> para ver meta tags
  const headSnippet = html.slice(0, 2000);

  // 4. Fetch tutory-admin-main.js para ver como XHRreq monta o token
  const adminJs = await fetch("https://static.tutory.com.br/js/tutory-admin-main.js")
    .then((r) => r.text())
    .catch(() => "");

  // Trechos relevantes do JS admin
  const xhrSnippets: string[] = [];
  let pos = 0;
  while ((pos = adminJs.indexOf("token", pos)) >= 0) {
    xhrSnippets.push(adminJs.slice(Math.max(0, pos - 100), pos + 200));
    pos += 5;
    if (xhrSnippets.length >= 8) break;
  }

  // Trechos em volta de "cadastrar-relatorio"
  const relatorioSnippets: string[] = [];
  pos = 0;
  while ((pos = adminJs.indexOf("relatorio", pos)) >= 0) {
    relatorioSnippets.push(adminJs.slice(Math.max(0, pos - 50), pos + 300));
    pos += 8;
    if (relatorioSnippets.length >= 5) break;
  }

  // Encontrar adminUser no HTML da página
  const adminUserMatch = html.match(/adminUser\s*=\s*(\{[^}]{0,500}\})/);
  const adminUserRaw = adminUserMatch ? adminUserMatch[1] : null;

  // Trechos em volta de adminUser nos scripts inline
  const adminUserSnippets: string[] = [];
  for (const sb of scriptBlocks) {
    const inner = sb.replace(/<\/?script[^>]*>/gi, "");
    const idx = inner.indexOf("adminUser");
    if (idx >= 0) adminUserSnippets.push(inner.slice(Math.max(0, idx - 50), idx + 400));
  }

  return NextResponse.json({
    pageSize: html.length,
    adminUserRaw,
    adminUserSnippets,
    xhrSnippets,
  });
}
