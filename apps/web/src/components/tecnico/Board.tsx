"use client";
import { useCallback, useEffect, useState } from "react";
import { ApiError, buscarFila } from "@/lib/api";
import { COLUNAS, POLL_MS, POLL_COM_SSE_MS } from "@/lib/kanban";
import { conectarEventos, type EstadoSse } from "@/lib/sse";
import { avisoParaUsuario, type AvisoReserva as TAvisoReserva } from "@/lib/eventosReserva";
import { AvisoReserva } from "../ui/AvisoReserva";
import { atendeOm, type FilaKanban, type OmKanban, type Operador, type StatusKanban } from "@/lib/types";
import { btnBase } from "../kiosk/ui";
import { MenuTema } from "../ui/TemaToggle";
import { GruposAbertas } from "./GruposAbertas";
import { OmCard } from "./OmCard";
import { OmDetail } from "./OmDetail";
import { BrandBar } from "../Brand";

export function Board({ user, onLogout }: { user: Operador; onLogout: () => void }) {
  const [fila, setFila] = useState<FilaKanban | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [avisoReserva, setAvisoReserva] = useState<TAvisoReserva | null>(null);
  const [aba, setAba] = useState<StatusKanban>("ABERTO"); // telas estreitas: uma coluna por vez
  const [selId, setSelId] = useState<string | null>(null);
  const [sse, setSse] = useState<EstadoSse>("conectando");

  const carregar = useCallback(async () => {
    try {
      setFila(await buscarFila());
      setErro(null);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return; // handler global faz o logout
      setErro(e instanceof ApiError && e.status === 403
        ? "Seu perfil não tem acesso ao painel de manutenção."
        : "Sem conexão com o servidor. Tentando novamente…");
    }
  }, []);

  // SSE (RN-06): cada evento invalida a fila -> refetch com debounce. Sem SSE (endpoint ausente/queda), polling de 10s.
  useEffect(() => {
    void carregar();
    let t: ReturnType<typeof setTimeout> | undefined;
    const agendar = () => { clearTimeout(t); t = setTimeout(carregar, 250); };
    const parar = conectarEventos((e) => { const av = avisoParaUsuario(e, user.id); if (av) setAvisoReserva(av); agendar(); }, (s) => {
      setSse((ant) => { if (s === "conectado" && ant !== "conectado") agendar(); return s; }); // ressincroniza ao (re)conectar
    });
    return () => { parar(); clearTimeout(t); };
  }, [carregar, user.id]);

  useEffect(() => {
    const id = setInterval(carregar, sse === "conectado" ? POLL_COM_SSE_MS : POLL_MS); // rede de segurança
    return () => clearInterval(id);
  }, [carregar, sse]);
  const todas = fila ? COLUNAS.flatMap((c) => fila.colunas[c.key] ?? []) : [];
  const sel: OmKanban | undefined = todas.find((o) => o.id === selId);
  const podeAgir = atendeOm(user.perfil); // TECNICO, GERENTE e ADMIN atendem OM (back-end: soTecnico)

  return (
    <>
    <BrandBar wide />
    <main className="mx-auto flex min-h-[calc(100dvh-6.5rem)] w-full max-w-[1600px] flex-col gap-4 p-3 md:p-4">
      <header className="flex flex-wrap items-center gap-4">
        <h1 className="min-w-0 flex-1 basis-full text-2xl font-extrabold sm:basis-auto md:text-3xl">Kanban · {user.nome} <span className="text-lg font-normal text-muted">({user.perfil})</span></h1>
        <span className={`rounded-full px-3 py-1 text-lg font-semibold ${sse === "conectado" ? "bg-green-100 text-green-900" : "bg-amber-100 text-amber-900"}`} role="status">{sse === "conectado" ? "● Ao vivo" : sse === "indisponivel" ? "○ Atualização a cada 10s" : "○ Reconectando…"}</span>
        <MenuTema />
        <button onClick={carregar} className={`${btnBase} min-h-tap-md bg-panel text-xl ring-1 ring-line`}>↻ Atualizar</button>
        <button onClick={onLogout} className={`${btnBase} min-h-tap-md bg-strong text-strong-on text-xl dark:ring-2 dark:ring-primary-edge`}>Sair</button>
      </header>
      {!podeAgir && <p className="rounded-xl bg-panel p-3 text-xl text-amber-800">Modo somente leitura: seu perfil não atende OMs.</p>}
      {erro && <p role="alert" className="rounded-xl bg-red-700 text-white p-3 text-xl font-semibold">{erro}</p>}
      <AvisoReserva aviso={avisoReserva} onFechar={() => setAvisoReserva(null)} />

      <nav className="grid grid-cols-2 gap-3 md:grid-cols-3 2xl:hidden" aria-label="Colunas">
        {COLUNAS.map((c) => (
          <button key={c.key} aria-pressed={aba === c.key} onClick={() => setAba(c.key)}
            className={`min-h-tap-md rounded-xl text-xl font-bold ${aba === c.key ? "bg-brand-700 text-white" : "bg-panel ring-1 ring-line"}`}>
            {c.titulo} ({fila?.colunas[c.key]?.length ?? 0})
          </button>
        ))}
      </nav>

      <div className="grid flex-1 grid-cols-1 gap-4 2xl:grid-cols-6">
        {COLUNAS.map((c) => (
          <section key={c.key} aria-label={c.titulo}
            className={`flex-col gap-3 ${aba === c.key ? "flex" : "hidden"} 2xl:flex`}>
            <h2 className={`hidden border-b-4 pb-2 text-xl font-extrabold 2xl:block ${c.cor}`}>
              {c.titulo} <span className="text-muted">({fila?.colunas[c.key]?.length ?? 0})</span>
            </h2>
            {!fila && <p className="text-xl text-muted">Carregando…</p>}
            {fila && c.key === "ABERTO" && <GruposAbertas lista={fila.colunas.ABERTO} user={user} onAbrir={(o) => setSelId(o.id)} />}
            {fila && c.key !== "ABERTO" && (fila.colunas[c.key] ?? []).map((o) => <OmCard key={o.id} om={o} user={user} onOpen={() => setSelId(o.id)} />)}
            {fila && c.key !== "ABERTO" && (fila.colunas[c.key] ?? []).length === 0 && <p className="text-xl text-muted">Nenhuma OM.</p>}
          </section>
        ))}
      </div>

      {sel && <OmDetail om={sel} user={user} podeAgir={podeAgir} onClose={() => setSelId(null)} onChanged={carregar} />}
    </main>
    </>
  );
}

