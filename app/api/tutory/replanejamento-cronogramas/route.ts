/**
 * Replanejamento de Cronogramas
 *
 * Hipótese atual: admin:1 sessions não disparam o replanejamento server-side.
 * Testando ver-painel SEM adm_id para obter sessão admin:0 (sessão de aluno).
 *
 * Dados confirmados pelo debug:
 * - jsAluno.id = '342258' (com aspas, regex corrigida)
 * - jsAluno.admin: 1 = sessão de admin (pode não acionar o replan)
 * - excluir-notificacao precisa do campo NOT_ID (não id)
 * - notificação encontrada foi de mural (tipo diferente do replan)
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36";

async function getAdminCookie(): Promise<string> {
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
    redirect: "manual",
  });
  return res.headers.get("set-cookie")?.match(/PHPSESSID=[^;]+/)?.[0] ?? "";
}

interface AlunoForm {
  id: string;
  cpf: string;
  token: string;
  admId: string;
  nome: string;
  email: string;
}

async function scraparFormularios(adminCookie: string): Promise<AlunoForm[]> {
  const result: AlunoForm[] = [];

  function parsePage(html: string) {
    const blocks = html.split('class="student-list-item"');
    for (const block of blocks.slice(1)) {
      const searchMatch = block.match(/data-search="([^"]+)"/);
      if (!searchMatch) continue;
      const parts = searchMatch[1].trim().split(" ");
      const email = parts[parts.length - 1].toLowerCase();
      const nome = parts.slice(0, -1).join(" ").trim();
      const id    = block.match(/name="id"\s+value="(\d+)"/)?.[1] ?? "";
      const cpf   = block.match(/name="cpf"\s+value="([^"]+)"/)?.[1] ?? "";
      const token = block.match(/name="token"\s+value="([^"]+)"/)?.[1] ?? "";
      const admId = block.match(/name="adm_id"\s+value="(\d+)"/)?.[1] ?? "";
      if (id && cpf && token && admId) result.push({ id, cpf, token, admId, nome, email });
    }
  }

  const firstHtml = await fetch("https://admin.tutory.com.br/alunos/atraso?p=1", {
    headers: { Cookie: adminCookie },
  }).then((r) => r.text());

  if (firstHtml.includes('document.location.href = "/login"')) return [];
  parsePage(firstHtml);

  const totalPagesMatch = firstHtml.match(/\?p=(\d+)[^"]*">Última/);
  const totalPages = totalPagesMatch ? parseInt(totalPagesMatch[1], 10) : 1;

  for (let start = 2; start <= totalPages; start += 5) {
    const batch: Promise<void>[] = [];
    for (let p = start; p < start + 5 && p <= totalPages; p++) {
      batch.push(
        fetch(`https://admin.tutory.com.br/alunos/atraso?p=${p}`, { headers: { Cookie: adminCookie } })
          .then((r) => r.text())
          .then(parsePage)
      );
    }
    await Promise.all(batch);
  }

  return result;
}

/** Extrai jsAluno.id do HTML (pode ser quoted: id: '12345' ou unquoted: id: 12345) */
function extrairJsAlunoId(html: string): string | null {
  return (
    html.match(/jsAluno\s*=\s*\{[^}]*?\bid\s*:\s*['"]?(\d+)['"]?/i)?.[1] ??
    html.match(/jsAluno\.id\s*=\s*['"]?(\d+)['"]?/i)?.[1] ??
    null
  );
}

/** Extrai o valor de jsAluno.admin (0 = aluno, 1 = admin) */
function extrairJsAlunoAdmin(html: string): string | null {
  return html.match(/jsAluno\s*=\s*\{[^}]*?\badmin\s*:\s*(\d+)/i)?.[1] ?? null;
}

interface NotifEntry {
  NOT_ID?: string | number;
  id?: string | number;
  [key: string]: unknown;
}

interface ReplanejamentoResult {
  nome: string;
  id: string;
  status: string;
  adminFlag?: string | null;
  notificacoes?: NotifEntry[];
  excluidos?: (string | number)[];
}

async function obterSessao(
  aluno: AlunoForm,
  semAdmId = false
): Promise<{ cookie: string; location: string; status: number } | null> {
  const body = semAdmId
    ? `cpf=${encodeURIComponent(aluno.cpf)}&id=${aluno.id}&token=${encodeURIComponent(aluno.token)}`
    : `cpf=${encodeURIComponent(aluno.cpf)}&id=${aluno.id}&token=${encodeURIComponent(aluno.token)}&adm_id=${aluno.admId}`;

  const verRes = await fetch("https://app.tutory.com.br/intent/ver-painel", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "X-Requested-With": "XMLHttpRequest",
      Origin: "https://app.tutory.com.br",
      Referer: "https://admin.tutory.com.br/alunos/atraso",
    },
    body,
    redirect: "manual",
  });

  const cookie = verRes.headers.get("set-cookie")?.match(/PHPSESSID=[^;]+/)?.[0] ?? "";
  const location = verRes.headers.get("location") ?? "/painel/";
  if (!cookie) return null;
  return { cookie, location, status: verRes.status };
}

async function replanejamentoAluno(aluno: AlunoForm): Promise<ReplanejamentoResult> {
  try {
    // Tentar sessão sem adm_id (admin:0) primeiro
    let sessao = await obterSessao(aluno, true);
    let semAdmId = true;
    if (!sessao) {
      sessao = await obterSessao(aluno, false);
      semAdmId = false;
    }
    if (!sessao) return { nome: aluno.nome, id: aluno.id, status: "sem-sessão" };

    let sessionCookie = sessao.cookie;
    const panelUrl = sessao.location.startsWith("http")
      ? sessao.location
      : `https://app.tutory.com.br${sessao.location}`;

    // Visitar painel → extrair jsAluno
    const panelRes = await fetch(panelUrl, {
      headers: {
        Cookie: sessionCookie,
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml",
        Referer: "https://app.tutory.com.br/intent/ver-painel",
      },
      redirect: "follow",
    });
    const updatedCookie = panelRes.headers.get("set-cookie")?.match(/PHPSESSID=[^;]+/)?.[0];
    if (updatedCookie) sessionCookie = updatedCookie;
    const panelHtml = await panelRes.text();

    const jsAlunoId = extrairJsAlunoId(panelHtml) ?? aluno.id;
    const adminFlag = extrairJsAlunoAdmin(panelHtml);

    const headers = {
      Authorization: `Bearer ${aluno.token}`,
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Accept: "application/json, */*",
      "X-Requested-With": "XMLHttpRequest",
      Cookie: sessionCookie,
      Origin: "https://app.tutory.com.br",
      Referer: panelUrl,
    };

    // selecionar-notificacoes → lista de notificações
    const selecionarRes = await fetch("https://app.tutory.com.br/intent/selecionar-notificacoes", {
      method: "POST",
      headers,
      body: `id=${jsAlunoId}`,
    });
    const selecionarData = await selecionarRes.json().catch(() => null) as { data?: NotifEntry[] } | null;
    const notificacoes: NotifEntry[] = Array.isArray(selecionarData?.data) ? selecionarData!.data : [];

    // excluir cada notificação usando NOT_ID
    const excluidos: (string | number)[] = [];
    for (const notif of notificacoes) {
      const notifId = notif.NOT_ID ?? notif.id;
      if (!notifId) continue;
      const excluirRes = await fetch("https://app.tutory.com.br/intent/excluir-notificacao", {
        method: "POST",
        headers,
        body: `id=${jsAlunoId}&notificacao_id=${notifId}`,
      });
      if (excluirRes.ok) excluidos.push(notifId);
    }

    // Visitar /painel/config/replanejar-atrasos como segunda estratégia
    await fetch("https://app.tutory.com.br/painel/config/replanejar-atrasos", {
      method: "GET",
      headers: {
        Cookie: sessionCookie,
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml",
        Referer: panelUrl,
      },
      redirect: "follow",
    });

    return {
      nome: aluno.nome,
      id: aluno.id,
      adminFlag,
      status: semAdmId ? "sem-admId" : "com-admId",
      notificacoes,
      excluidos,
    };
  } catch (e) {
    return { nome: aluno.nome, id: aluno.id, status: String(e) };
  }
}

async function executarReplanejamento() {
  const adminCookie = await getAdminCookie();
  if (!adminCookie) {
    return NextResponse.json({ error: "Falha no login admin" }, { status: 500 });
  }

  const alunos = await scraparFormularios(adminCookie);

  if (alunos.length === 0) {
    return NextResponse.json({
      ok: true,
      total: 0,
      msg: "Nenhum aluno atrasado encontrado",
      executadoEm: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    });
  }

  const resultados: ReplanejamentoResult[] = [];

  for (let i = 0; i < alunos.length; i += 3) {
    const lote = alunos.slice(i, i + 3);
    const resps = await Promise.all(lote.map(replanejamentoAluno));
    resultados.push(...resps);
    if (i + 3 < alunos.length) await new Promise((r) => setTimeout(r, 600));
  }

  const semAdmId = resultados.filter((r) => r.status === "sem-admId").length;
  const comNotif = resultados.filter((r) => (r.notificacoes?.length ?? 0) > 0).length;
  const falhas   = resultados.filter((r) => r.status !== "sem-admId" && r.status !== "com-admId");

  return NextResponse.json({
    ok: true,
    total: alunos.length,
    semAdmId,
    comNotificacoesExcluidas: comNotif,
    falhas,
    executadoEm: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
  });
}

// GET ?key=cg-bulk-2026&debug=1  → testa ver-painel sem adm_id, mostra jsAluno.admin
// GET ?key=cg-bulk-2026           → cron (background)
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== "cg-bulk-2026") return NextResponse.json({ error: "Não autorizado" }, { status: 401 });

  if (req.nextUrl.searchParams.get("debug") === "1") {
    const adminCookie = await getAdminCookie();
    if (!adminCookie) return NextResponse.json({ error: "Login admin falhou" });

    const alunos = await scraparFormularios(adminCookie);
    const primeiro = alunos[0];
    if (!primeiro) return NextResponse.json({ error: "Nenhum aluno na lista" });

    // Testar ver-painel SEM adm_id → esperamos admin:0
    const semAdmId = await obterSessao(primeiro, true);
    // Testar ver-painel COM adm_id → confirmado admin:1
    const comAdmId = await obterSessao(primeiro, false);

    async function inspecionarSessao(sessao: { cookie: string; location: string } | null, label: string) {
      if (!sessao) return { label, erro: "sem PHPSESSID" };

      const panelUrl = sessao.location.startsWith("http")
        ? sessao.location
        : `https://app.tutory.com.br${sessao.location}`;

      let sessionCookie = sessao.cookie;
      const panelRes = await fetch(panelUrl, {
        headers: { Cookie: sessionCookie, "User-Agent": BROWSER_UA, Accept: "text/html,application/xhtml+xml" },
        redirect: "follow",
      });
      const updated = panelRes.headers.get("set-cookie")?.match(/PHPSESSID=[^;]+/)?.[0];
      if (updated) sessionCookie = updated;
      const html = await panelRes.text();

      const jsAlunoId = extrairJsAlunoId(html);
      const adminFlag = extrairJsAlunoAdmin(html);
      const temSwal = html.includes("Cronograma Replanejado");

      const headers = {
        Authorization: `Bearer ${primeiro.token}`,
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Accept: "application/json, */*",
        "X-Requested-With": "XMLHttpRequest",
        Cookie: sessionCookie,
        Origin: "https://app.tutory.com.br",
        Referer: panelUrl,
      };

      const selId = jsAlunoId ?? primeiro.id;
      const selecionarRes = await fetch("https://app.tutory.com.br/intent/selecionar-notificacoes", {
        method: "POST",
        headers,
        body: `id=${selId}`,
      });
      const selecionarData = await selecionarRes.json().catch(() => null);
      const notifs: NotifEntry[] = Array.isArray((selecionarData as { data?: NotifEntry[] })?.data)
        ? (selecionarData as { data: NotifEntry[] }).data
        : [];

      // Tentar excluir a primeira notificação com NOT_ID
      let excluirResult: unknown = "nenhuma-notif";
      if (notifs.length > 0) {
        const notifId = notifs[0].NOT_ID ?? notifs[0].id;
        const excluirRes = await fetch("https://app.tutory.com.br/intent/excluir-notificacao", {
          method: "POST",
          headers,
          body: `id=${selId}&notificacao_id=${notifId}`,
        });
        excluirResult = await excluirRes.json().catch(() => null);
      }

      return {
        label,
        jsAlunoId,
        adminFlag,
        temSwalReplanejado: temSwal,
        selecionarNotificacoes: { idUsado: selId, data: selecionarData },
        excluirNotificacao: excluirResult,
      };
    }

    const [resultSemAdmId, resultComAdmId] = await Promise.all([
      inspecionarSessao(semAdmId, "SEM adm_id"),
      inspecionarSessao(comAdmId, "COM adm_id"),
    ]);

    return NextResponse.json({
      primeiroAluno: { nome: primeiro.nome, id: primeiro.id },
      semAdmId: resultSemAdmId,
      comAdmId: resultComAdmId,
    });
  }

  executarReplanejamento().catch((e) => console.error("[replanejamento-bg]", e));
  return NextResponse.json({
    ok: true,
    message: "Replanejamento iniciado em background",
    timestamp: new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
  });
}

// POST autenticado — aguarda resultado completo
export async function POST(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (key !== "cg-bulk-2026") {
    const session = await auth();
    if (!session) return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  return executarReplanejamento();
}
