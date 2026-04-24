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

  // Extrai array de alunos com tokens — padrão: {id: X, token: 'Y'} ou similar
  const tokenMatches = [...html.matchAll(/\{\s*id\s*:\s*(\d+)\s*,\s*token\s*:\s*['"]([^'"]+)['"]/g)].map(
    (m) => ({ id: m[1], token: m[2] })
  );

  // Alternativa: data-token em elementos HTML
  const dataTokens = [...html.matchAll(/data-id=["'](\d+)["'][^>]*data-token=["']([^"']+)["']/g)].map(
    (m) => ({ id: m[1], token: m[2] })
  );
  const dataTokensAlt = [...html.matchAll(/data-token=["']([^"']+)["'][^>]*data-id=["'](\d+)["']/g)].map(
    (m) => ({ id: m[2], token: m[1] })
  );

  // Busca qualquer variável JS que pareça ser lista de alunos
  const varAlunosMatch = inlineScriptCompleto.match(/(?:var|let|const)\s+(\w*[Aa]luno\w*|urls\w*)\s*=\s*(\[[\s\S]{0,3000}\])/);
  const varAlunos = varAlunosMatch ? { nome: varAlunosMatch[1], valor: varAlunosMatch[2] } : null;

  // Trechos em volta de "token" no script
  const tokenSnippets: string[] = [];
  let idx = 0;
  while ((idx = inlineScriptCompleto.indexOf("token", idx)) >= 0) {
    tokenSnippets.push(inlineScriptCompleto.slice(Math.max(0, idx - 80), idx + 120));
    idx += 5;
    if (tokenSnippets.length >= 10) break;
  }

  return NextResponse.json({
    pageSize: html.length,
    forms,
    botoes: botoes.slice(0, 5), // só os primeiros para não poluir
    inlineScriptCompleto,
    tokenMatches: tokenMatches.slice(0, 5),
    dataTokens: dataTokens.slice(0, 5),
    dataTokensAlt: dataTokensAlt.slice(0, 5),
    varAlunos,
    tokenSnippets,
  });
}
