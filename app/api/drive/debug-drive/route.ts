import { NextRequest, NextResponse } from "next/server";

const FOLDER_ID = "1qdM6wxLIqMadq6NphCUG92rVBZiKnTlb";

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== "cg-bulk-2026") return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "GOOGLE_API_KEY não definida" }, { status: 500 });

  const params = new URLSearchParams({
    q: `'${FOLDER_ID}' in parents and trashed = false`,
    fields: "files(id,name,webViewLink)",
    pageSize: "5",
    key: apiKey,
  });

  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`);
  const json = await res.json();

  return NextResponse.json({ status: res.status, resposta: json });
}
