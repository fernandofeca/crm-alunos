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

  // Usa concurso do param ou pega o primeiro ID > 0 do select
  let cursoId = req.nextUrl.searchParams.get("concurso") ?? "";

  if (!cursoId) {
    const htmlPrincipal = await fetch("https://admin.tutory.com.br/cursos/relatorios", {
      headers: { Cookie: cookie },
    }).then((r) => r.text());
    const m = htmlPrincipal.match(/<option[^>]*value=["']([1-9]\d*)["']/i);
    cursoId = m?.[1] ?? "28399";
  }

  const html = await fetch(
    `https://admin.tutory.com.br/cursos/relatorios?concurso=${cursoId}`,
    { headers: { Cookie: cookie } }
  ).then((r) => r.text());

  // 1. Todos os hrefs
  const todosHrefs = [...new Set([...html.matchAll(/href=["']([^"']+)["']/gi)].map((m) => m[1]))];

  // 2. Todos os <a> e <button>
  const todosLinks = [...html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)]
    .map((m) => m[0].replace(/\s+/g, " ").trim())
    .filter((a) => a.length < 500);

  const todosBotoes = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/gi)]
    .map((m) => m[0].replace(/\s+/g, " ").trim())
    .filter((b) => b.length < 500);

  // 3. Todos os <form>
  const todosForms = [...html.matchAll(/<form\b[^>]*>/gi)]
    .map((m) => m[0].replace(/\s+/g, " ").trim());

  // 4. HTML bruto ao redor de palavras-chave
  const trechosRaw: string[] = [];
  for (const palavra of ["baixar", "download", "relacao", "relação", "planilha", "xls", "exportar", "export"]) {
    let pos = 0;
    const lower = html.toLowerCase();
    while (pos < html.length) {
      const idx = lower.indexOf(palavra, pos);
      if (idx === -1) break;
      trechosRaw.push(`[${palavra}@${idx}]\n${html.slice(Math.max(0, idx - 300), idx + 600)}`);
      pos = idx + 1;
      if (trechosRaw.length > 12) break;
    }
    if (trechosRaw.length > 12) break;
  }

  // 5. Scripts inline
  const scriptsInline = [...html.matchAll(/<script(?!\s+src)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => m[1].trim())
    .filter((s) => s.length > 50);

  // 6. Busca no JS estático
  let jsDownloadUrls: string[] = [];
  let jsRelatorioFunctions = "";
  try {
    const js = await fetch("https://static.tutory.com.br/js/tutory-admin-main.js").then((r) => r.text());
    jsDownloadUrls = [...new Set([
      ...[...js.matchAll(/["'`]([^"'`]*(?:relatorio|relação|relacao|download|xls|exportar|export|aluno)[^"'`]*)["'`]/gi)].map((m) => m[1]),
      ...[...js.matchAll(/["'`](\/(?:cursos|intent|alunos|relatorio)[^"'`\s]{3,})["'`]/gi)].map((m) => m[1]),
    ])].slice(0, 60);

    // Extrai funções relacionadas a relatório/download (±300 chars ao redor)
    const relMatch = js.match(/(?:relatorio|download|exportar).{0,2000}/i);
    if (relMatch) jsRelatorioFunctions = relMatch[0].slice(0, 1500);
  } catch { /* ignore */ }

  // 7. Tenta endpoints candidatos diretamente
  const candidatos = [
    `/cursos/relatorios/download?concurso=${cursoId}`,
    `/cursos/relatorios/export?concurso=${cursoId}`,
    `/intent/relatorio-alunos?concurso=${cursoId}`,
    `/intent/exportar-alunos?concurso=${cursoId}`,
    `/intent/download-relatorio?concurso=${cursoId}&tipo=alunos`,
    `/cursos/exportar?concurso=${cursoId}`,
    `/cursos/relatorios/xls?concurso=${cursoId}`,
  ];

  const testesCandidatos: { url: string; status: number; contentType: string; tamanho: number }[] = [];
  for (const path of candidatos) {
    try {
      const r = await fetch(`https://admin.tutory.com.br${path}`, {
        headers: { Cookie: cookie },
        redirect: "manual",
      });
      testesCandidatos.push({
        url: path,
        status: r.status,
        contentType: r.headers.get("content-type") ?? "",
        tamanho: parseInt(r.headers.get("content-length") ?? "0"),
      });
    } catch (e) {
      testesCandidatos.push({ url: path, status: -1, contentType: String(e), tamanho: 0 });
    }
  }

  return NextResponse.json({
    cursoId,
    htmlLength: html.length,
    todosHrefs,
    todosLinks: todosLinks.slice(0, 40),
    todosBotoes: todosBotoes.slice(0, 20),
    todosForms,
    trechosRaw: trechosRaw.slice(0, 6),
    scriptsInline: scriptsInline.slice(0, 8),
    jsDownloadUrls,
    jsRelatorioFunctions,
    testesCandidatos,
  });
}
