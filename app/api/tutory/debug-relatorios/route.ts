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

  // Pega o concurso do query param, ou usa o primeiro disponível
  let cursoId = req.nextUrl.searchParams.get("concurso") ?? "";

  if (!cursoId) {
    const htmlPrincipal = await fetch("https://admin.tutory.com.br/cursos/relatorios", {
      headers: { Cookie: cookie },
    }).then((r) => r.text());
    const m = htmlPrincipal.match(/<option[^>]*value=["'](\d+)["']/i);
    cursoId = m?.[1] ?? "28399";
  }

  const html = await fetch(
    `https://admin.tutory.com.br/cursos/relatorios?concurso=${cursoId}`,
    { headers: { Cookie: cookie } }
  ).then((r) => r.text());

  // 1. Todos os hrefs que parecem downloads ou relatórios
  const hrefsRelevantes = [...html.matchAll(/href=["']([^"']+)["']/gi)]
    .map((m) => m[1])
    .filter((u) => /download|xls|csv|relat|aluno|export|planilha/i.test(u));

  // 2. Todos os <a> completos (tag inteira) que contêm palavras-chave
  const anchorsTodos = [...html.matchAll(/<a[^>]*>[\s\S]*?<\/a>/gi)]
    .map((m) => m[0].replace(/\s+/g, " ").trim())
    .filter((a) => /download|xls|aluno|relat|export|planilha/i.test(a))
    .slice(0, 20);

  // 3. Todos os botões com onclick
  const botoesOnclick = [...html.matchAll(/<(?:a|button)[^>]*onclick=["']([^"']+)["'][^>]*>([^<]*)/gi)]
    .map((m) => ({ onclick: m[1], texto: m[2].trim() }))
    .slice(0, 20);

  // 4. Seção bruta entre 55000 e htmlLength (onde ficam os relatórios)
  const secaoRelatorios = html
    .slice(55000)
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "[SCRIPT]")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 3000);

  // 5. Todos os data-* que contêm URL ou ID
  const dataComValor = [...html.matchAll(/data-[\w-]+=["']([^"']{3,})["']/gi)]
    .map((m) => m[0])
    .filter((d) => /\d|http|\/|relat|aluno|xls/i.test(d))
    .slice(0, 30);

  // 6. Procura padrões de URL de download nos scripts inline
  const urlsNosScripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)]
    .flatMap((m) => [...m[1].matchAll(/["'`]([^"'`]*(?:download|relat|aluno|xls|export)[^"'`]*)["'`]/gi)].map((u) => u[1]))
    .slice(0, 20);

  return NextResponse.json({
    cursoId,
    htmlLength: html.length,
    hrefsRelevantes,
    anchorsTodos,
    botoesOnclick,
    dataComValor,
    urlsNosScripts,
    secaoRelatorios,
  });
}
