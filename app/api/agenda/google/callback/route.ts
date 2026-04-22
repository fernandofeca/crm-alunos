import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.redirect(new URL("/login", req.url));

  const code = req.nextUrl.searchParams.get("code");
  const error = req.nextUrl.searchParams.get("error");

  if (error || !code) {
    return NextResponse.redirect(new URL("/agenda?google=erro", req.url));
  }

  const headersList = await headers();
  const host = headersList.get("host") ?? "";
  const proto = host.includes("localhost") ? "http" : "https";
  const redirectUri = `${proto}://${host}/api/agenda/google/callback`;

  // Trocar código por tokens
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });

  const tokens = await tokenRes.json();
  if (!tokens.refresh_token) {
    return NextResponse.redirect(new URL("/agenda?google=sem_token", req.url));
  }

  // Salvar refresh token no usuário
  await prisma.user.update({
    where: { id: (session.user?.id ?? "") as string },
    data: { googleRefreshToken: tokens.refresh_token },
  });

  return NextResponse.redirect(new URL("/agenda?google=conectado", req.url));
}
