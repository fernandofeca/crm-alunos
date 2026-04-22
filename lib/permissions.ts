import { NextResponse } from "next/server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getRole(session: any): string {
  return ((session?.user as { role?: string })?.role ?? "equipe").toLowerCase();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isAdmin(session: any): boolean {
  return getRole(session) === "admin";
}

export function forbidden() {
  return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
}
