import { prisma } from "@/lib/prisma";
import Link from "next/link";
import * as XLSX from "xlsx";

export const dynamic = "force-dynamic";

// ─── tipos ────────────────────────────────────────────────────────────────────

type RenovacaoPendente = {
  nome: string;
  email: string;
  telefone: string;
  concurso: string;
  vencimento: Date | null;
};

// ─── helpers ──────────────────────────────────────────────────────────────────

async function getSessionCookie(): Promise<string> {
  const account  = process.env.TUTORY_ACCOUNT ?? "";
  const password = process.env.TUTORY_PASSWORD ?? "";
  if (!account || !password) return "";
  const res = await fetch("https://admin.tutory.com.br/intent/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Requested-With": "XMLHttpRequest" },
    body: `account=${encodeURIComponent(account)}&password=${encodeURIComponent(password)}`,
  });
  return res.headers.get("set-cookie")?.match(/PHPSESSID=[^;]+/)?.[0] ?? "";
}

function encontrarChave(headers: string[], candidatos: string[]): string {
  const lower = headers.map((h) => String(h).toLowerCase().trim());
  for (const c of candidatos) {
    const idx = lower.indexOf(c.toLowerCase().trim());
    if (idx !== -1) return headers[idx];
  }
  for (const c of candidatos) {
    const idx = lower.findIndex((h) => h.includes(c.toLowerCase()));
    if (idx !== -1) return headers[idx];
  }
  return "";
}

async function fetchRenovacaoPendente(
  cookie: string
): Promise<{ alunos: RenovacaoPendente[]; debug: string }> {
  try {
    // 1. Descobre o link na página /loja/relatorios
    const html = await fetch("https://admin.tutory.com.br/loja/relatorios", {
      headers: { Cookie: cookie },
      cache: "no-store",
    }).then((r) => r.text());

    if (html.includes('document.location.href = "/login"')) {
      return { alunos: [], debug: "Sessão Tutory expirada — configure TUTORY_ACCOUNT e TUTORY_PASSWORD." };
    }

    let downloadPath = "";
    const blocos = html.split(/(?=<div[^>]*class="[^"]*relatorio-item)/i);
    for (const bloco of blocos) {
      if (/renova[cç][aã]o\s+pendente/i.test(bloco)) {
        const m = bloco.match(/href=["']([^"']+)["']/i);
        if (m) { downloadPath = m[1]; break; }
      }
    }
    if (!downloadPath) return { alunos: [], debug: "Link 'Renovação Pendente' não encontrado na página /loja/relatorios." };

    // 2. Baixa o XLS
    const url = downloadPath.startsWith("http")
      ? downloadPath
      : `https://admin.tutory.com.br${downloadPath}`;

    const res = await fetch(url, {
      headers: { Cookie: cookie },
      cache: "no-store",
    });
    const ct = res.headers.get("content-type") ?? "";
    if (ct.includes("text/html")) {
      return { alunos: [], debug: `Resposta HTML em vez de XLS (url: ${url})` };
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.length < 50) return { alunos: [], debug: "XLS vazio ou muito pequeno." };

    // 3. Parseia
    const wb    = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows  = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" });
    if (rows.length === 0) return { alunos: [], debug: "Planilha sem linhas." };

    const headers   = Object.keys(rows[0]);
    const colNome   = encontrarChave(headers, ["nome", "aluno", "name", "estudante"]);
    const colEmail  = encontrarChave(headers, ["email", "e-mail", "e mail"]);
    const colTel    = encontrarChave(headers, ["telefone", "celular", "whatsapp", "fone", "tel"]);
    const colConc   = encontrarChave(headers, ["concurso", "plano", "curso", "produto", "plan"]);
    const colVenc   = encontrarChave(headers, ["data fim", "vencimento", "expira", "validade", "data de vencimento", "data vencimento", "termino", "término", "fim"]);

    const alunos: RenovacaoPendente[] = [];
    for (const row of rows) {
      const email = String(row[colEmail] ?? "").toLowerCase().trim();
      if (!email || !email.includes("@")) continue;

      const vencRaw = row[colVenc];
      let vencimento: Date | null = null;
      if (vencRaw instanceof Date) vencimento = vencRaw;
      else if (typeof vencRaw === "string" && vencRaw) {
        const d = new Date(vencRaw);
        if (!isNaN(d.getTime())) vencimento = d;
      } else if (typeof vencRaw === "number" && vencRaw > 0) {
        const d = new Date(Math.round((vencRaw - 25569) * 86400 * 1000));
        if (!isNaN(d.getTime())) vencimento = d;
      }

      alunos.push({
        nome:     String(row[colNome]  ?? "").trim() || email,
        email,
        telefone: String(row[colTel]   ?? "").replace(/\D/g, ""),
        concurso: String(row[colConc]  ?? "").trim(),
        vencimento,
      });
    }

    // Ordena por vencimento mais próximo primeiro
    alunos.sort((a, b) => {
      if (!a.vencimento) return 1;
      if (!b.vencimento) return -1;
      return a.vencimento.getTime() - b.vencimento.getTime();
    });

    return {
      alunos,
      debug: `OK — ${alunos.length} alunos (colunas: nome=${colNome}, email=${colEmail}, conc=${colConc}, venc=${colVenc})`,
    };
  } catch (e) {
    return { alunos: [], debug: `Erro: ${e instanceof Error ? e.message : String(e)}` };
  }
}

function formatarData(d: Date | null): string {
  if (!d) return "—";
  return d.toLocaleDateString("pt-BR", { timeZone: "UTC" });
}

function diasAteVencer(d: Date | null): number | null {
  if (!d) return null;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return Math.ceil((d.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));
}

function badgeDias(dias: number | null) {
  if (dias === null) return { cls: "bg-slate-100 text-slate-500", label: "—" };
  if (dias < 0)  return { cls: "bg-red-100 text-red-700 font-semibold", label: `Vencido há ${Math.abs(dias)}d` };
  if (dias === 0) return { cls: "bg-red-100 text-red-700 font-semibold", label: "Vence hoje" };
  if (dias <= 3)  return { cls: "bg-orange-100 text-orange-700 font-semibold", label: `${dias}d restantes` };
  if (dias <= 7)  return { cls: "bg-yellow-100 text-yellow-700", label: `${dias}d restantes` };
  return { cls: "bg-slate-100 text-slate-500", label: `${dias}d restantes` };
}

// ─── página ───────────────────────────────────────────────────────────────────

export default async function RenovacaoPendentePage() {
  const cookie = await getSessionCookie();
  const { alunos, debug } = await fetchRenovacaoPendente(cookie);

  // Cruza com CRM pelo email
  const emails   = alunos.map((a) => a.email);
  const alunosDb = await prisma.aluno.findMany({
    where: { email: { in: emails } },
    select: {
      id: true, email: true, whatsapp: true, planoTipo: true,
      contatos: { orderBy: { data: "desc" }, take: 1, select: { data: true, tipo: true } },
    },
  });
  const dbMap = new Map(alunosDb.map((a) => [a.email, a]));

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-800">🔔 Renovação Pendente</h1>
        <p className="text-sm text-slate-500 mt-1">
          Alunos com renovação pendente — dados em tempo real do Tutory
        </p>
      </div>

      {debug && !debug.startsWith("OK") && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-700">
          ⚠️ {debug}
        </div>
      )}

      {alunos.length === 0 && debug.startsWith("OK") && (
        <div className="bg-white rounded-xl border border-slate-200 p-10 text-center">
          <p className="text-3xl mb-2">🎉</p>
          <p className="text-slate-500 text-sm">Nenhuma renovação pendente no momento.</p>
        </div>
      )}

      {alunos.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-700">
              {alunos.length} aluno{alunos.length !== 1 ? "s" : ""} com renovação pendente
            </span>
            <span className="text-xs text-slate-400">{debug}</span>
          </div>

          <div className="divide-y divide-slate-100">
            {alunos.map((aluno) => {
              const db   = dbMap.get(aluno.email);
              const dias = diasAteVencer(aluno.vencimento);
              const badge = badgeDias(dias);
              const wpp  = db?.whatsapp || aluno.telefone;
              const wppUrl = wpp
                ? `https://wa.me/55${wpp.replace(/\D/g, "")}?text=${encodeURIComponent(`Olá ${aluno.nome.split(" ")[0]}, tudo bem? Passando para avisar que seu plano vence em breve. Vamos renovar?`)}`
                : null;
              const ultimoContato = db?.contatos?.[0];

              return (
                <div key={aluno.email} className="px-5 py-4 flex items-center gap-4 hover:bg-slate-50 transition">
                  {/* Info principal */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      {db ? (
                        <Link
                          href={`/alunos/${db.id}`}
                          className="font-semibold text-slate-800 hover:text-blue-600 transition truncate"
                        >
                          {aluno.nome}
                        </Link>
                      ) : (
                        <span className="font-semibold text-slate-800 truncate">{aluno.nome}</span>
                      )}
                      {db?.planoTipo && (
                        <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full shrink-0">
                          {db.planoTipo}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5 truncate">{aluno.email}</p>
                    {aluno.concurso && (
                      <p className="text-xs text-slate-400 mt-0.5 truncate">{aluno.concurso}</p>
                    )}
                  </div>

                  {/* Último contato */}
                  <div className="text-right shrink-0 hidden sm:block">
                    {ultimoContato ? (
                      <>
                        <p className="text-xs text-slate-500">
                          {new Date(ultimoContato.data).toLocaleDateString("pt-BR")}
                        </p>
                        <p className="text-xs text-slate-400">{ultimoContato.tipo}</p>
                      </>
                    ) : (
                      <p className="text-xs text-slate-400">Sem contatos</p>
                    )}
                  </div>

                  {/* Vencimento */}
                  <div className="shrink-0 text-right">
                    <p className="text-xs text-slate-500 mb-1">{formatarData(aluno.vencimento)}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${badge.cls}`}>
                      {badge.label}
                    </span>
                  </div>

                  {/* WhatsApp */}
                  {wppUrl ? (
                    <a
                      href={wppUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 bg-green-500 hover:bg-green-600 text-white text-xs font-semibold px-3 py-1.5 rounded-lg transition"
                    >
                      WhatsApp
                    </a>
                  ) : (
                    <span className="shrink-0 text-xs text-slate-300 px-3 py-1.5">Sem tel.</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
