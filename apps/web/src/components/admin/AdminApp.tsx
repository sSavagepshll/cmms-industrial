"use client";
import { useCallback, useEffect, useState } from "react";
import { ApiError, autenticarPin, encerrarSessao, listarAprovacoes, listarConclusoesPendentes } from "@/lib/api";
import { setUnauthorizedHandler } from "@/lib/session";
import { conectarEventos } from "@/lib/sse";
import { decideAprovacao, ehGestor, type Aprovacao, type ConclusaoPendente, type Operador } from "@/lib/types";
import { Brand, BrandBar, BrandStripe } from "../Brand";
import { Icone, type NomeIcone } from "../ui/Icones";
import { MenuTema } from "../ui/TemaToggle";
import { AprovacoesPage } from "./AprovacoesPage";
import { ConclusoesPage } from "./ConclusoesPage";
import { DashboardPage } from "./DashboardPage";
import { DespachoPage } from "./DespachoPage";
import { OrdensPage } from "./OrdensPage";
import { ConfiguracoesPage } from "./ConfiguracoesPage";

type Pagina = "despacho" | "aprovacoes" | "conclusoes" | "dashboard" | "ordens" | "configuracoes";

/** Painel Administrativo (desktop): GESTOR/ADMIN. Token só em memória, igual ao totem. Sem timer de inatividade (Fase 37 / RN-87): a sessão só termina no "Sair", no vencimento absoluto (12 h) ou por revogação (401). */
export function AdminApp() {
  const [user, setUser] = useState<Operador | null>(null);
  const [aviso, setAviso] = useState<string>();
  const sair = useCallback((msg?: string) => { encerrarSessao(); setUser(null); setAviso(msg); }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => sair("Sessão expirada. Entre novamente."));
    return () => setUnauthorizedHandler(null);
  }, [sair]);

  if (!user) return <AdminLogin aviso={aviso} onSuccess={(u) => { setAviso(undefined); setUser(u); }} />;
  return <Shell user={user} onSair={() => sair()} />;
}

function Shell({ user, onSair }: { user: Operador; onSair: () => void }) {
  const [pagina, setPagina] = useState<Pagina>("despacho");
  const [abaCfg, setAbaCfg] = useState<"usuarios" | "parametros">("usuarios");
  const [aprovacoes, setAprovacoes] = useState<Aprovacao[] | null>(null);
  const [erroAprov, setErroAprov] = useState<string | null>(null);

  const [conclusoes, setConclusoes] = useState<ConclusaoPendente[] | null>(null);
  const [erroConcl, setErroConcl] = useState<string | null>(null);
  const aprova = decideAprovacao(user.perfil); // Fase 21: o GERENTE não aprova (a API responde 403); só conclui

  const carregarConclusoes = useCallback(() => {
    listarConclusoesPendentes().then((l) => { setConclusoes(l); setErroConcl(null); })
      .catch((e) => { if (e instanceof ApiError && e.status === 401) return; setConclusoes((p) => p ?? []); setErroConcl("Não foi possível carregar as conclusões pendentes."); });
  }, []);

  const carregarAprovacoes = useCallback(() => {
    if (!aprova) { setAprovacoes([]); return; }
    listarAprovacoes().then((l) => { setAprovacoes(l); setErroAprov(null); })
      .catch((e) => { if (e instanceof ApiError && e.status === 401) return; setAprovacoes((p) => p ?? []); setErroAprov("Não foi possível carregar as aprovações."); });
  }, [aprova]);
  const carregar = useCallback(() => { carregarAprovacoes(); carregarConclusoes(); }, [carregarAprovacoes, carregarConclusoes]);

  // SSE invalida a fila (nova OM finalizada / decidida por outro supervisor); polling de 60 s como rede de segurança.
  useEffect(() => {
    carregar();
    let t: ReturnType<typeof setTimeout> | undefined;
    const parar = conectarEventos(() => { clearTimeout(t); t = setTimeout(carregar, 300); }, () => {});
    const id = setInterval(carregar, 60_000);
    return () => { parar(); clearInterval(id); clearTimeout(t); };
  }, [carregar]);

  const pend = aprovacoes?.length ?? 0;
  const itens: { key: Pagina; label: string; icone: NomeIcone; badge?: number }[] = [
    { key: "despacho", label: "Despacho", icone: "enviar" },
    ...(aprova ? [{ key: "aprovacoes" as Pagina, label: "Aprovações", icone: "checkCirculo" as NomeIcone, badge: pend }] : []),
    { key: "conclusoes", label: "Conclusões pendentes", icone: "prancheta", badge: conclusoes?.length ?? 0 },
    { key: "dashboard", label: "Dashboard", icone: "graficos" },
    { key: "ordens", label: "Ordens de manutenção", icone: "prancheta" },
  ];
  if (user.perfil === "ADMIN") {
    itens.push({ key: "configuracoes", label: "Configurações do Sistema", icone: "engrenagem" });
  }

  return (
    <>
      <BrandBar wide>
        <div className="flex items-center gap-3 text-base">
          <span className="hidden text-muted sm:inline">{user.nome} <span className="rounded bg-brand-100 px-2 py-0.5 text-sm font-bold text-primary-fg">{user.perfil}</span></span>
          <MenuTema />
          <button onClick={onSair} className="min-h-11 rounded-lg bg-strong px-4 font-semibold text-strong-on ring-2 ring-transparent dark:ring-primary-edge">Sair</button>
        </div>
      </BrandBar>
      <div className="mx-auto grid w-full max-w-[1600px] grid-cols-[minmax(0,1fr)] gap-6 p-4 md:p-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
        <nav aria-label="Seções" className="sticky top-0 z-20 -mx-4 flex gap-2 overflow-x-auto bg-ink px-4 py-2 [scroll-snap-type:x_proximity] md:-mx-6 md:px-6 lg:static lg:mx-0 lg:flex-col lg:overflow-visible lg:bg-transparent lg:p-0">
          {itens.map((i) => (
            <button key={i.key} aria-current={pagina === i.key ? "page" : undefined} onClick={() => { if (i.key === "configuracoes") setAbaCfg("usuarios"); setPagina(i.key); }}
              className={`flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-4 text-left text-base font-semibold ${pagina === i.key ? "bg-brand-600 text-white" : "bg-panel text-fg ring-1 ring-line hover:bg-brand-50"}`}>
              <Icone nome={i.icone} /><span className="flex-1">{i.label}</span>
              {!!i.badge && <span aria-label={`${i.badge} pendentes`} className="rounded-full bg-amber-400 px-2 py-0.5 text-sm font-extrabold text-black">{i.badge}</span>}
            </button>
          ))}
        </nav>
        <main className="min-w-0">
          {pagina === "despacho" && <DespachoPage user={user} />}
          {pagina === "aprovacoes" && aprova && <AprovacoesPage lista={aprovacoes} erro={erroAprov} onRecarregar={carregar} />}
          {pagina === "conclusoes" && <ConclusoesPage lista={conclusoes} erro={erroConcl} onRecarregar={carregar} />}
          {pagina === "dashboard" && <DashboardPage pendentes={pend} onIrAprovacoes={() => setPagina("aprovacoes")} onIrOrdens={() => setPagina("ordens")} onIrParametros={() => { setAbaCfg("parametros"); setPagina("configuracoes"); }} />}
          {pagina === "ordens" && <OrdensPage user={user} />}
          {pagina === "configuracoes" && <ConfiguracoesPage user={user} abaInicial={abaCfg} />}
        </main>
      </div>
    </>
  );
}

function AdminLogin({ aviso, onSuccess }: { aviso?: string; onSuccess: (u: Operador) => void }) {
  const [matricula, setMatricula] = useState("");
  const [pin, setPin] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function entrar(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErro(null);
    try {
      const u = await autenticarPin(matricula.trim(), pin);
      if (!ehGestor(u.perfil)) { encerrarSessao(); setErro("Seu perfil não tem acesso ao painel administrativo."); setPin(""); }
      else onSuccess(u);
    } catch (err) {
      setPin("");
      setErro(err instanceof ApiError ? (err.status === 0 || err.status >= 500 ? "Sistema indisponível. Tente novamente em instantes." : err.message) : "Erro inesperado.");
    } finally { setBusy(false); }
  }
  const campo = "min-h-12 w-full rounded-xl bg-panel px-4 text-lg ring-2 ring-line focus:ring-primary-fg focus:outline-none";
  return (
    <main className="grid min-h-dvh place-items-center bg-ink p-4">
      <form onSubmit={entrar} className="flex w-full max-w-md flex-col overflow-hidden rounded-3xl bg-panel shadow-xl ring-1 ring-black/10">
        <div className="flex justify-center px-10 pb-8 pt-10"><Brand className="h-10" /></div>
        <BrandStripe />
        <div className="flex flex-col gap-6 px-10 py-10">
          <div className="text-center"><h1 className="text-2xl font-extrabold">Painel Administrativo</h1><p className="text-muted">Ordens de Manutenção · acesso de supervisão</p></div>
          {aviso && <p role="status" className="rounded-xl bg-amber-100 p-3 font-semibold text-amber-900">{aviso}</p>}
          <div className="flex flex-col gap-5">
          <label className="flex flex-col gap-1"><span className="font-semibold">Matrícula</span>
            <input autoFocus inputMode="numeric" autoComplete="username" value={matricula} onChange={(e) => setMatricula(e.target.value)} className={campo} /></label>
          <label className="flex flex-col gap-1"><span className="font-semibold">PIN</span>
            <input type="password" inputMode="numeric" autoComplete="current-password" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} className={campo} /></label>
          </div>
          {erro && <p role="alert" className="rounded-xl bg-red-700 p-3 font-semibold text-white">{erro}</p>}
          <button disabled={busy || !matricula.trim() || pin.length < 4} className="min-h-12 w-full rounded-xl bg-brand-600 text-lg font-bold text-white">{busy ? "Verificando…" : "Entrar"}</button>
        </div>
      </form>
    </main>
  );
}
