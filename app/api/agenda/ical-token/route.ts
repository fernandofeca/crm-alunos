import { auth } from "@/auth";
import { NextResponse } from "next/server";
import { headers } from "next/headers";

export async function GET() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const headersList = await headers();
  const host = headersList.get("host") ?? "";
  const proto = host.includes("localhost") ? "http" : "https";
  const base = `${proto}://${host}`;
  const token = process.env.AUTH_SECRET ?? "";
  const url = `${base}/api/agenda/ical?token=${encodeURIComponent(token)}`;

  return NextResponse.json({ url });
}
