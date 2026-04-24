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
  // Find the main content area — look for table rows or list items
  const bodyStart = html.indexOf("<main") !== -1 ? html.indexOf("<main") : html.indexOf('<div class="container');
  const bodySnippet = html.slice(bodyStart, bodyStart + 6000).replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");

  // Look for any <tr> rows with data
  const trSamples = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].slice(2, 8).map((m) => m[0].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());

  // Look for mailto links (emails in table)
  const emailSamples = [...html.matchAll(/mailto:([^"'<\s]+)/gi)].slice(0, 10).map((m) => m[1]);

  // Look for expiration dates
  const datePatterns = [...html.matchAll(/\d{2}\/\d{2}\/\d{4}/g)].slice(0, 10).map((m) => m[0]);

  return NextResponse.json({ hasStudentList, dataSearchSamples, trSamples, emailSamples, datePatterns, bodySnippet });
}
