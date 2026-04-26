/**
 * GET /api/tutory/debug-relatorios?key=cg-bulk-2026
 *
 * Inspeciona a página de relatórios + JS principal da Tutory para
 * descobrir quais endpoints são usados no relatório de alunos por curso.
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

function extrairTrechos(texto: string, palavras: string[], contexto = 300): string[] {
  const trechos: string[] = [];
  const lower = texto.toLowerCase();
  for (const p of palavras) {
    let pos = 0;
    while (true) {
      const idx = lower.indexOf(p.toLowerCase(), pos);
      if (idx === -1) break;
      trechos.push(`[${p}@${idx}] ...${texto.slice(Math.max(0, idx - 100), idx + contexto)}...`);
      pos = idx + 1;
      if (trechos.length > 30) break;
    }
  }
  return trechos;
}

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== "cg-bulk-2026") return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const cookie = await getSessionCookie();
  if (!cookie) return NextResponse.json({ error: "Login falhou" }, { status: 500 });

  // 1. HTML da página de relatórios
  const html = await fetch("https://admin.tutory.com.br/cursos/relatorios", {
    headers: { Cookie: cookie },
  }).then((r) => r.text());

  if (html.includes('document.location.href = "/login"')) {
    return NextResponse.json({ error: "Cookie expirado" }, { status: 401 });
  }

  // 2. Busca o arquivo JS principal referenciado na página
  const jsUrls = [...html.matchAll(/src=["']((?:https?:)?\/\/[^"']*\.js[^"']*)["']/gi)].map((m) => m[1]);
  const jsPrincipal = jsUrls.find((u) => u.includes("tutory-admin-main") || u.includes("main")) ?? jsUrls[0] ?? "";

  let jsTrechos: string[] = [];
  let jsIntentEndpoints: string[] = [];
  if (jsPrincipal) {
    const url = jsPrincipal.startsWith("//") ? `https:${jsPrincipal}` : jsPrincipal;
    try {
      const js = await fetch(url).then((r) => r.text());
      // Todos os /intent/ encontrados no JS
      jsIntentEndpoints = [...new Set([...js.matchAll(/["'`](\/intent\/[^"'`\s?#]+)/g)].map((m) => m[1]))];
      // Trechos ao redor de palavras-chave de relatório
      jsTrechos = extrairTrechos(js, ["relatorio", "relat", "listar-aluno", "cursos", "planilha", "export", "download", "xls"]);
    } catch {
      jsTrechos = ["Erro ao buscar JS"];
    }
  }

  // 3. Trechos relevantes no HTML
  const htmlTrechos = extrairTrechos(
    html.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<script[\s\S]*?<\/script>/gi, ""),
    ["curso", "plano", "relat", "data-id", "data-curso", "aluno"]
  );

  // 4. Todos os /intent/ no HTML
  const htmlIntentEndpoints = [...new Set([...html.matchAll(/["'`](\/intent\/[^"'`\s?#]+)/g)].map((m) => m[1]))];

  // 5. Blocos de script inline (sem libs externas)
  const scriptsInline = [...html.matchAll(/<script(?!\s+src)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1].trim())
    .filter((s) => s.length > 20 && (s.includes("relat") || s.includes("curso") || s.includes("intent") || s.includes("fetch") || s.includes("ajax")));

  return NextResponse.json({
    htmlLength: html.length,
    jsUrlsEncontradas: jsUrls,
    jsPrincipal,
    jsIntentEndpoints,
    htmlIntentEndpoints,
    htmlTrechos: htmlTrechos.slice(0, 15),
    jsTrechos: jsTrechos.slice(0, 15),
    scriptsInline: scriptsInline.slice(0, 5),
  });
}
