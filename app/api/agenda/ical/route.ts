import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

function icalDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

function icalEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function foldLine(line: string): string {
  // RFC 5545: lines longer than 75 octets should be folded
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  let result = "";
  let pos = 0;
  while (pos < line.length) {
    if (pos === 0) {
      result += line.slice(0, 75) + "\r\n";
      pos = 75;
    } else {
      result += " " + line.slice(pos, pos + 74) + "\r\n";
      pos += 74;
    }
  }
  return result;
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  const secret = process.env.AUTH_SECRET ?? "";

  if (!token || token !== secret) {
    return new NextResponse("Não autorizado", { status: 401 });
  }

  const eventos = await prisma.evento.findMany({
    include: { aluno: { select: { nome: true } } },
    orderBy: { data: "asc" },
  });

  const linhas: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CG Mentoria CRM//PT",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:CG Mentoria - Agenda",
    "X-WR-TIMEZONE:America/Sao_Paulo",
  ];

  for (const ev of eventos) {
    const inicio = new Date(ev.data);
    const fim = new Date(inicio.getTime() + 60 * 60 * 1000); // +1 hora
    const descParts = [];
    if (ev.descricao) descParts.push(ev.descricao);
    if (ev.aluno) descParts.push(`Aluno: ${ev.aluno.nome}`);

    linhas.push("BEGIN:VEVENT");
    linhas.push(`UID:${ev.id}@cgmentoria-crm`);
    linhas.push(`DTSTART:${icalDate(inicio)}`);
    linhas.push(`DTEND:${icalDate(fim)}`);
    linhas.push(`SUMMARY:${icalEscape(ev.titulo)}`);
    if (descParts.length) linhas.push(`DESCRIPTION:${icalEscape(descParts.join(" | "))}`);
    linhas.push(`CREATED:${icalDate(new Date(ev.createdAt))}`);
    linhas.push("END:VEVENT");
  }

  linhas.push("END:VCALENDAR");

  const ics = linhas.map(foldLine).join("\r\n");

  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="cgmentoria-agenda.ics"',
      "Cache-Control": "no-cache, no-store",
    },
  });
}
