// Debug-only endpoint — kept for future diagnostics
import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== "cg-bulk-2026") return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  return NextResponse.json({ ok: true, info: "Use /alunos-a-vencer for the CRM page" });
}
