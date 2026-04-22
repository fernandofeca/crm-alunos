import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { NextResponse } from "next/server";

async function getAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Não foi possível renovar o token do Google.");
  return data.access_token;
}

type GoogleEvent = {
  id: string;
  summary?: string;
  description?: string;
  start?: { dateTime?: string; date?: string };
  status?: string;
};

export async function POST() {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  const userId = (session.user?.id ?? "") as string;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { googleRefreshToken: true } });

  if (!user?.googleRefreshToken) {
    return NextResponse.json({ error: "Google Agenda não conectado." }, { status: 400 });
  }

  let accessToken: string;
  try {
    accessToken = await getAccessToken(user.googleRefreshToken);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro de autenticação." }, { status: 401 });
  }

  // Buscar eventos: últimos 30 dias + próximos 180 dias
  const agora = new Date();
  const inicio = new Date(agora); inicio.setDate(inicio.getDate() - 30);
  const fim = new Date(agora); fim.setDate(fim.getDate() + 180);

  const params = new URLSearchParams({
    timeMin: inicio.toISOString(),
    timeMax: fim.toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "500",
  });

  const calRes = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!calRes.ok) {
    const err = await calRes.json();
    return NextResponse.json({ error: err.error?.message ?? "Erro ao buscar eventos." }, { status: 400 });
  }

  const { items }: { items: GoogleEvent[] } = await calRes.json();
  const eventos = (items ?? []).filter((e) => e.status !== "cancelled" && (e.start?.dateTime || e.start?.date));

  // UIDs externos já existentes
  const uids = eventos.map((e) => `google:${e.id}`);
  const existentes = await prisma.evento.findMany({
    where: { externalUid: { in: uids } },
    select: { externalUid: true },
  });
  const existentesSet = new Set(existentes.map((e) => e.externalUid));

  let criados = 0, atualizados = 0;

  for (const ev of eventos) {
    const uid = `google:${ev.id}`;
    const dataStr = ev.start?.dateTime ?? `${ev.start?.date}T00:00:00`;
    const data = new Date(dataStr);
    if (isNaN(data.getTime())) continue;

    if (existentesSet.has(uid)) {
      // Atualiza título e data
      await prisma.evento.updateMany({
        where: { externalUid: uid },
        data: {
          titulo: ev.summary || "(Sem título)",
          descricao: ev.description || "",
          data,
        },
      });
      atualizados++;
    } else {
      await prisma.evento.create({
        data: {
          titulo: ev.summary || "(Sem título)",
          descricao: ev.description || "",
          data,
          tipo: "lembrete",
          externalUid: uid,
          userId,
        },
      });
      criados++;
    }
  }

  return NextResponse.json({ criados, atualizados, total: eventos.length });
}
