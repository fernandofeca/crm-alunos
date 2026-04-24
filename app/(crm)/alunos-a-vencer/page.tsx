import { prisma } from "@/lib/prisma";
import Link from "next/link";

export const dynamic = "force-dynamic";

type TutoryRenovacao = {
  nome: string;
  email: string;
  curso: string;
  vencimento: Date;
  wppUrl: string;
  tutoryId: number | null;
};

async function getSessionCookie(): Promise<string> {
  const account = process.env.TUTORY_ACCOUNT ?? "";
  const password = process.env.TUTORY_PASSWORD ?? "";
  if (!account || !password) return "";
  const res = await fetch("https://admin.tutory.com.br/intent/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: `account=${encodeURIComponent(account)}&password=${encodeURIComponent(password)}`,
  });
  return res.headers.get("set-cookie")?.match(/PHPSESSID=[^;]+/)?.[0] ?? "";
}

function parseRenovacaoPage(html: string): TutoryRenovacao[] {
  const result: TutoryRenovacao[] = [];
  const tbodyMatch = html.match(/<tbody>([\s\S]*?)<\/tbody>/i);
  if (!tbodyMatch) return result;

  const rows = tbodyMatch[1].split(/<tr[^>]*>/i).slice(1);
  for (const row of rows) {
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) =>
      m[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
    );
    if (cells.length < 4) continue;

    const nome = cells[0].trim();
    const email = cells[1].toLowerCase().trim();
    const curso = cells[2].trim();
    const vencimentoStr = cells[3].trim(); // DD/MM/YYYY

    if (!nome || !email || !vencimentoStr.match(/^\d{2}\/\d{2}\/\d{4}$/)) continue;

    const [dia, mes, ano] = vencimentoStr.split("/").map(Number);
    const vencimento = new Date(Date.UTC(ano, mes - 1, dia));

    // WhatsApp link from Tutory (already has the renewal message)
    const wppMatch = row.match(/href='(https:\/\/api\.whatsapp\.com[^']+)'/);
    const wppUrl = wppMatch ? wppMatch[1] : "";

    // Tutory student ID
    const idMatch = row.match(/data-id='(\d+)'/);
    const tutoryId = idMatch ? parseInt(idMatch[1]) : null;

    result.push({ nome, email, curso, vencimento, wppUrl, tutoryId });
  }

  return result;
}

function diasRestantes(vencimento: Date): number {
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return Math.round((vencimento.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));
}

function corDias(dias: number) {
  if (dias <= 0) return { badge: "bg-red-100 text-red-700", bar: "bg-red-500", label: "Vencido" };
  if (dias <= 2) return { badge: "bg-red-50 text-red-600", bar: "bg-red-400", label: `${dias}d` };
  if (dias <= 4) return { badge: "bg-orange-50 text-orange-700", bar: "bg-orange-400", label: `${dias}d` };
  return { badge: "bg-yellow-50 text-yellow-700", bar: "bg-yellow-400", label: `${dias}d` };
}

export default async function AlunosAVencerPage() {
  const cookie = await getSessionCookie();

  let renovacaoList: TutoryRenovacao[] = [];
  let erroScraping = "";

  try {
    const html = await fetch("https://admin.tutory.com.br/alunos/renovacao", {
      headers: { Cookie: cookie },
      cache: "no-store",
    }).then((r) => r.text());

    if (html.includes('document.location.href = "/login"')) {
      erroScraping = "Sessão Tutory expirada — configure TUTORY_ACCOUNT e TUTORY_PASSWORD.";
    } else {
      renovacaoList = parseRenovacaoPage(html);
    }
  } catch (e) {
    erroScraping = e instanceof Error ? e.message : String(e);
  }

  // Cross-reference with CRM database by email
  const emails = renovacaoList.map((r) => r.email).filter(Boolean);
  const alunosDb = await prisma.aluno.findMany({
    where: { email: { in: emails } },
    select: {
      id: true,
      email: true,
      planoTipo: true,
      whatsapp: true,
      tutoryId: true,
      contatos: {
        orderBy: { data: "desc" },
        take: 1,
        select: { data: true, tipo: true },
      },
    },
  });
  const dbMap = new Map(alunosDb.map((a) => [a.email, a]));

  // Sort by vencimento ascending
  renovacaoList.sort((a, b) => a.vencimento.getTime() - b.vencimento.getTime());

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">📋 Alunos à Vencer</h1>
        <p className="text-sm text-slate-500 mt-1">
          Planos vencendo nos próximos 7 dias — dados em tempo real do Tutory
        </p>
      </div>

      {erroScraping && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          ⚠️ {erroScraping}
        </div>
      )}

      {!erroScraping && renovacaoList.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center">
          <p className="text-3xl mb-2">🎉</p>
          <p className="text-slate-500 text-sm">Nenhum aluno com plano vencendo nos próximos 7 dias.</p>
        </div>
      )}

      {renovacaoList.length > 0 && (
        <>
          <p className="text-xs text-slate-400">
            {renovacaoList.length} aluno{renovacaoList.length !== 1 ? "s" : ""} com vencimento nos próximos 7 dias
          </p>
          <div className="space-y-3">
            {renovacaoList.map((r, idx) => {
              const dias = diasRestantes(r.vencimento);
              const cor = corDias(dias);
              const db = dbMap.get(r.email);
              const ultimoContato = db?.contatos[0];

              return (
                <div
                  key={idx}
                  className="bg-white rounded-xl border border-slate-200 p-5 flex items-center gap-5"
                >
                  {/* Days badge */}
                  <div className={`flex-shrink-0 flex flex-col items-center justify-center rounded-xl w-16 h-16 font-bold ${cor.badge}`}>
                    <span className="text-xs font-semibold opacity-70 uppercase tracking-wide">
                      {dias <= 0 ? "Vencido" : "em"}
                    </span>
                    {dias > 0 && (
                      <>
                        <span className="text-2xl leading-none">{dias}</span>
                        <span className="text-xs opacity-70">dia{dias !== 1 ? "s" : ""}</span>
                      </>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {db ? (
                        <Link href={`/alunos/${db.id}`} className="text-base font-semibold text-slate-800 hover:text-blue-600 hover:underline">
                          {r.nome}
                        </Link>
                      ) : (
                        <span className="text-base font-semibold text-slate-800">{r.nome}</span>
                      )}
                      {!db && (
                        <span className="text-xs bg-slate-100 text-slate-400 px-2 py-0.5 rounded-full">Fora do CRM</span>
                      )}
                    </div>

                    <p className="text-xs text-slate-400 mt-0.5">{r.email}</p>

                    <div className="flex gap-2 mt-1.5 flex-wrap items-center">
                      <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full">{r.curso}</span>
                      {db?.planoTipo && (
                        <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{db.planoTipo}</span>
                      )}
                      <span className="text-xs text-slate-400">
                        Vence em{" "}
                        <span className="font-medium text-slate-600">
                          {r.vencimento.toLocaleDateString("pt-BR", { timeZone: "UTC" })}
                        </span>
                      </span>
                    </div>

                    {ultimoContato && (
                      <p className="text-xs text-slate-400 mt-1">
                        Último contato:{" "}
                        <span className="text-slate-600">
                          {new Date(ultimoContato.data).toLocaleDateString("pt-BR")} · {ultimoContato.tipo}
                        </span>
                      </p>
                    )}
                    {db && !ultimoContato && (
                      <p className="text-xs text-yellow-600 mt-1">⚠️ Nenhum contato registrado</p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-shrink-0 flex-col sm:flex-row">
                    {r.wppUrl && (
                      <a
                        href={r.wppUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 bg-green-500 hover:bg-green-600 text-white text-xs font-semibold px-3 py-2 rounded-lg transition whitespace-nowrap"
                      >
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                        </svg>
                        WhatsApp Renovação
                      </a>
                    )}
                    {db && (
                      <Link
                        href={`/alunos/${db.id}`}
                        className="text-xs bg-blue-50 text-blue-600 px-3 py-2 rounded-lg hover:bg-blue-100 transition whitespace-nowrap"
                      >
                        Ver Perfil
                      </Link>
                    )}
                    {r.tutoryId && (
                      <a
                        href={`https://admin.tutory.com.br/alunos/index?aid=${r.tutoryId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs bg-slate-50 text-slate-500 px-3 py-2 rounded-lg hover:bg-slate-100 transition whitespace-nowrap"
                      >
                        Tutory
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
