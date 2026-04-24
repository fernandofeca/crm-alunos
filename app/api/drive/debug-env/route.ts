import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== "cg-bulk-2026") return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const googleKey = process.env.GOOGLE_API_KEY;

  return NextResponse.json({
    GOOGLE_API_KEY: googleKey ? `${googleKey.slice(0, 6)}...${googleKey.slice(-4)} (${googleKey.length} chars)` : "NÃO DEFINIDA",
    NODE_ENV: process.env.NODE_ENV,
    todasAsChaves: Object.keys(process.env).filter(k => k.startsWith("GOOGLE") || k.startsWith("TUTORY") || k === "NODE_ENV"),
  });
}
