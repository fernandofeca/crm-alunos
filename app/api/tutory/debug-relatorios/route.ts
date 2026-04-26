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

  // 1. Página principal — extrai todos os cursos do select
  const htmlPrincipal = await fetch("https://admin.tutory.com.br/cursos/relatorios", {
    headers: { Cookie: cookie },
  }).then((r) => r.text());

  const cursos: { id: string; nome: string }[] = [];
  const selectMatch = htmlPrincipal.match(/<select[^>]*select-concurso[^>]*>([\s\S]*?)<\/select>/i);
  if (selectMatch) {
    for (const m of selectMatch[1].matchAll(/<option[^>]*value=["'](\d+)["'][^>]*>\s*([^<]+)/gi)) {
      if (m[1] !== "0") cursos.push({ id: m[1], nome: m[2].trim() });
    }
  }

  // 2. Busca a página do PRIMEIRO curso para inspecionar estrutura
  const primeiroCurso = cursos[0];
  if (!primeiroCurso) return NextResponse.json({ cursos, erro: "Nenhum curso encontrado no select" });

  const htmlCurso = await fetch(
    `https://admin.tutory.com.br/cursos/relatorios?concurso=${primeiroCurso.id}`,
    { headers: { Cookie: cookie } }
  ).then((r) => r.text());

  // 3. Inspeciona a página do curso
  const links    = [...htmlCurso.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1]).filter((u) => u.startsWith("/") && u !== "#!");
  const dataAttrs = [...htmlCurso.matchAll(/data-[\w-]+=["']([^"']+)["']/gi)].map((m) => m[0]);
  const intentUrls = [...new Set([...htmlCurso.matchAll(/["'`](\/intent\/[^"'`\s?#]+)/g)].map((m) => m[1]))];
  const scriptsInline = [...htmlCurso.matchAll(/<script(?!\s+src)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1].trim())
    .filter((s) => s.length > 10);

  // Linhas da tabela de alunos (se existir)
  const tabelaMatch = htmlCurso.match(/<table[\s\S]*?<\/table>/gi) ?? [];
  const tabelas = tabelaMatch.map((t) => t.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 500));

  // Trecho ao redor de "aluno" e "relat"
  const palavras = ["aluno", "relat", "download", "export", "xls", "intent", "fetch", "ajax", "email", "data-id"];
  const trechos: string[] = [];
  const lower = htmlCurso.toLowerCase();
  for (const p of palavras) {
    const idx = lower.indexOf(p);
    if (idx >= 0) {
      trechos.push(`[${p}@${idx}] ${htmlCurso.slice(Math.max(0, idx - 80), idx + 300).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ")}`);
    }
  }

  return NextResponse.json({
    totalCursos: cursos.length,
    cursos: cursos.slice(0, 10), // primeiros 10
    primeiroCursoInspecionado: primeiroCurso,
    htmlCursoLength: htmlCurso.length,
    links: [...new Set(links)].slice(0, 30),
    dataAttrs: dataAttrs.slice(0, 20),
    intentUrls,
    scriptsInline: scriptsInline.slice(0, 5),
    tabelas: tabelas.slice(0, 3),
    trechos: trechos.slice(0, 15),
  });
}
