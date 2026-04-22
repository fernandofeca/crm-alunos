import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { NextRequest, NextResponse } from "next/server";

/* ── ICS parser ─────────────────────────────────────────────── */

type IcsEvent = {
  uid: string;
  summary: string;
  description: string;
  dtstart: Date | null;
  dtend: Date | null;
};

function unfold(raw: string): string {
  // RFC 5545: CRLF followed by whitespace = continuation
  return raw.replace(/\r\n[ \t]/g, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function unescape(s: string): string {
  return s.replace(/\\n/g, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

function parseIcsDate(val: string): Date | null {
  // Remove TZID param if present: "TZID=America/Sao_Paulo:20260422T090000"
  const raw = val.includes(":") ? val.split(":").slice(1).join(":") : val;
  const s = raw.trim().replace(/[^0-9TZ]/g, "");

  // All-day: YYYYMMDD
  if (/^\d{8}$/.test(s)) {
    const y = +s.slice(0, 4), m = +s.slice(4, 6) - 1, d = +s.slice(6, 8);
    return new Date(y, m, d, 0, 0, 0);
  }
  // Date-time: YYYYMMDDTHHmmss[Z]
  if (/^\d{8}T\d{6}Z?$/.test(s)) {
    const y = +s.slice(0, 4), mo = +s.slice(4, 6) - 1, d = +s.slice(6, 8);
    const h = +s.slice(9, 11), mi = +s.slice(11, 13), se = +s.slice(13, 15);
    if (s.endsWith("Z")) return new Date(Date.UTC(y, mo, d, h, mi, se));
    return new Date(y, mo, d, h, mi, se);
  }
  return null;
}

function parseIcs(text: string): IcsEvent[] {
  const lines = unfold(text).split("\n");
  const events: IcsEvent[] = [];
  let current: Partial<IcsEvent> | null = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (line === "BEGIN:VEVENT") {
      current = { uid: "", summary: "", description: "", dtstart: null, dtend: null };
      continue;
    }
    if (line === "END:VEVENT") {
      if (current) events.push(current as IcsEvent);
      current = null;
      continue;
    }
    if (!current) continue;

    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).toUpperCase();
    const value = line.slice(colon + 1);

    if (key === "UID") current.uid = value.trim();
    else if (key === "SUMMARY") current.summary = unescape(value);
    else if (key === "DESCRIPTION") current.description = unescape(value);
    else if (key.startsWith("DTSTART")) current.dtstart = parseIcsDate(line.slice(line.indexOf(":") + 1));
    else if (key.startsWith("DTEND"))   current.dtend   = parseIcsDate(line.slice(line.indexOf(":") + 1));
  }

  return events;
}

/* ── Handler ─────────────────────────────────────────────────── */

async function importarEventos(icsText: string, userId: string) {
  const parsed = parseIcs(icsText);
  let criados = 0, ignorados = 0, erros = 0;

  // Busca UIDs já existentes de uma vez
  const uids = parsed.map((e) => e.uid).filter(Boolean);
  const existentes = await prisma.evento.findMany({
    where: { externalUid: { in: uids } },
    select: { externalUid: true },
  });
  const existentesSet = new Set(existentes.map((e) => e.externalUid));

  for (const ev of parsed) {
    if (!ev.dtstart) { erros++; continue; }
    if (ev.uid && existentesSet.has(ev.uid)) { ignorados++; continue; }

    try {
      await prisma.evento.create({
        data: {
          titulo: ev.summary || "(Sem título)",
          descricao: ev.description || "",
          data: ev.dtstart,
          tipo: "lembrete",
          externalUid: ev.uid || null,
          userId,
        },
      });
      criados++;
    } catch {
      erros++;
    }
  }

  return { total: parsed.length, criados, ignorados, erros };
}

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const userId = (session.user?.id ?? "") as string;
  const contentType = req.headers.get("content-type") ?? "";

  // Modo 1: upload de arquivo ICS
  if (contentType.includes("multipart/form-data")) {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "Nenhum arquivo enviado." }, { status: 400 });

    const text = await file.text();
    const resultado = await importarEventos(text, userId);
    return NextResponse.json(resultado);
  }

  // Modo 2: URL do feed iCal
  const body = await req.json();
  const url: string = body.url ?? "";
  if (!url) return NextResponse.json({ error: "URL não informada." }, { status: 400 });

  let text: string;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "CGMentoria-CRM/1.0" },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await res.text();
  } catch (e) {
    return NextResponse.json(
      { error: `Não foi possível buscar o feed: ${e instanceof Error ? e.message : "erro desconhecido"}` },
      { status: 400 }
    );
  }

  const resultado = await importarEventos(text, userId);
  return NextResponse.json(resultado);
}
