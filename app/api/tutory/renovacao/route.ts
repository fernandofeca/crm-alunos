import { NextRequest, NextResponse } from "next/server";

async function getSessionCookie(): Promise<string> {
  const account = process.env.TUTORY_ACCOUNT ?? "";
  const password = process.env.TUTORY_PASSWORD ?? "";
  if (!account || !password) return "";
  const res = await fetch("https://admin.tutory.com.br/intent/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest" },
    body: `account=${encodeURIComponent(account)}&password=${encodeURIComponent(password)}`,
  });
  return res.headers.get("set-cookie")?.match(/PHPSESSID=[^;]+/)?.[0] ?? "";
}

// Debug endpoint: GET /api/tutory/renovacao?key=cg-bulk-2026&debug=1
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== "cg-bulk-2026") return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const cookie = await getSessionCookie();
  const html = await fetch("https://admin.tutory.com.br/alunos/renovacao", {
    headers: { Cookie: cookie },
  }).then((r) => r.text());

  // Return a diagnostic snapshot
  const snippet = html.slice(0, 5000);
  const hasStudentList = html.includes("student-list-item");
  const dataSearchSamples = [...html.matchAll(/data-search="([^"]+)"/g)].slice(0, 5).map((m) => m[1]);
  const firstCard = html.indexOf("student-list-item") !== -1
    ? html.slice(html.indexOf("student-list-item") - 50, html.indexOf("student-list-item") + 800)
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    : "não encontrado";

  return NextResponse.json({ hasStudentList, dataSearchSamples, firstCard, snippet });
}
