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

  // Trecho bruto em volta de "check" / "checkbox" / "input" na tabela
  const rawCheckbox: string[] = [];
  const checkIdx = html.indexOf("relatorio-aluno-check");
  if (checkIdx >= 0) {
    rawCheckbox.push(html.slice(Math.max(0, checkIdx - 200), checkIdx + 600));
  }
  // Também em volta de qualquer <input type="checkbox"
  const cbIdx = html.indexOf('type="checkbox"');
  if (cbIdx >= 0) rawCheckbox.push(html.slice(Math.max(0, cbIdx - 100), cbIdx + 400));

  // Todos os data-id encontrados em qualquer elemento
  const allDataIds = [...html.matchAll(/data-id=["'](\d+)["']/g)].map((m) => m[1]).slice(0, 20);

  // Todos os <input> com name ou class relacionados a aluno/check
  const inputs = [...html.matchAll(/<input[^>]*(?:aluno|check|relatorio)[^>]*>/gi)].map((m) => m[0]).slice(0, 10);

  // Trecho da tabela (primeiros 3000 chars após <table)
  const tableIdx = html.toLowerCase().indexOf("<table");
  const tableSnippet = tableIdx >= 0 ? html.slice(tableIdx, tableIdx + 3000) : "(sem tabela)";

  return NextResponse.json({
    pageSize: html.length,
    allDataIds,
    inputs,
    rawCheckbox,
    tableSnippet,
    inlineScriptCompleto: inlineScriptCompleto.slice(0, 500),
  });
}
