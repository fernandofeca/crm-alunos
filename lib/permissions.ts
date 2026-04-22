import { NextResponse } from "next/server";

export function forbidden() {
  return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
}
