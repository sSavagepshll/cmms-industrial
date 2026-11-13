"use client";
import { setorDaOm } from "@/lib/rotulos";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, buscarFila, cancelarDelegacao, listarTecnicos } from "@/lib/api";
import { POLL_COM_SSE_MS, POLL_MS, PRIORIDADE, haQuanto } from "@/lib/kanban";
import { conectarEventos, type EstadoSse } from "@/lib/sse";
import type { FilaKanban, OmKanban, Operador, TecnicoCarga } from "@/lib/types";
import { AtribuirTecnico } from "../despacho/AtribuirTecnico";
import { AvisoDesfazer } from "../despacho/AvisoDesfazer";
import { ConfirmarAcao } from "../ui/ConfirmarAcao";
import { Faixa } from "../ui/Faixa";
import { Icone } from "../ui/Icones";
import { SeloAtribuicao } from "../ui/Selos";
import { btnPrim, btnSec } from "../ui/estilos";

/** Situações que exigem decisão do gerente (a OM ainda não tem responsável e o técnico não pode puxá-la, ou acabou de ser liberada). */
const URGENTES = new Set(["URGENTE_AGUARDA_GERENTE", "LIBERADA"]); // a OM devolvida pela recusa tem faixa própria (abaixo)
type Modo = "urgentes" | "todas";

/**
 * Despacho (GERENTE/ADMIN, docs/ux/fase17 §2.2): fila de OMs sem responsável à esquerda, carga dos técnicos à direita.
 * Atribuir RESERVA a OM (ela continua ABERTA até o técnico assumir com PIN). Atualiza por SSE com polling de segurança.
 * Escopo global: o gerente vê todas as OMs (não há equipes nem setores).
 */
export function DespachoPage({ user }: { user: Operador }) {
  const [fila, setFila] = useState<FilaKanban | null>(null);
  const [tecnicos, setTecnicos] = useState<TecnicoCarga[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [erroTecnicos, setErroTecnicos] = useState<string | null>(null);
  const [sse, setSse] = useState<EstadoSse>("conectando");
  const [modo, setModo] = useState<Modo>("urgentes");
  const [atribuindo, setAtribuindo] = useState<OmKanban | null>(null);
  const [desfazendo, setDesfazendo] = useState<OmKanban | null>(null);
  const [busy, setBusy] = useState(false);
  const [erroDesfazer, setErroDesfazer] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ omId: string; msg: string } | null>(null);

  const carregar = useCallback(async () => {
    const [f, t] = await Promise.allSettled([buscarFila(), listarTecnicos()]);
    if (f.status === "fulfilled") { setFila(f.value); setErro(null); }
    else if (!(f.reason instanceof ApiError && f.reason.status === 401)) { // 401: o handler global faz o logout
      setErro(f.reason instanceof ApiError && f.reason.status === 0 ? "Sem conexão com o servidor." : "Não foi possível carregar a fila de OMs.");
    }
    if (t.status === "fulfilled") { setTecnicos(t.value); setErroTecnicos(null); }
    else if (!(t.reason instanceof ApiError && t.reason.status === 401)) { setTecnicos((p) => p ?? []); setErroTecnicos("Não foi possível carregar os técnicos."); }
  }, []);

  useEffect(() => {
    void carregar();
    let t: ReturnType<typeof setTimeout> | undefined;
    const parar = conectarEventos(() => { clearTimeout(t); t = setTimeout(() => void carregar(), 250); }, (s) => {
      setSse((ant) => { if (s === "conectado" && ant !== "conectado") { clearTimeout(t); t = setTimeout(() => void carregar(), 250); } return s; });
    });
    return () => { parar(); clearTimeout(t); };
  }, [carregar]);
  useEffect(() => {
    const id = setInterval(() => void carregar(), sse === "conectado" ? POLL_COM_SSE_MS : POLL_MS);
    return () => clearInterval(id);
  }, [carregar, sse]);

  const abertas = fila?.colunas.ABERTO ?? [];
  const devolvidas = useMemo(() => abertas.filter((o) => o.situacaoAtribuicao === "DEVOLVIDA"), [abertas]);
  const semResponsavel = useMemo(() => abertas.filter((o) => o.situacaoAtribuicao !== "RESERVADA" && o.situacaoAtribuicao !== "DEVOLVIDA"), [abertas]);
  const urgentes = useMemo(() => semResponsavel.filter((o) => URGENTES.has(o.situacaoAtribuicao ?? "")), [semResponsavel]);
  const reservadas = useMemo(() => abertas.filter((o) => o.situacaoAtribuicao === "RESERVADA"), [abertas]);
  const visiveis = modo === "urgentes" ? urgentes : semResponsavel;

  async function desfazerReserva(om: OmKanban) {
    setBusy(true); setErroDesfazer(null);
    try { await cancelarDelegacao(om.id); setDesfazendo(null); await carregar(); }
    catch (e) {
      setErroDesfazer(e instanceof ApiError ? (e.code === "OM_NAO_DISPONIVEL" ? "O técnico já aceitou a OM: não dá mais para cancelar a reserva." : e.message) : "Erro inesperado.");
      void carregar();
    } finally { setBusy(false); }
  }

  const paraAtribuir = (o: OmKanban) => ({ id: o.id, numero: o.numero, prioridade: o.prioridade, equipamento: o.equipamento, setorExibicao: setorDaOm(o), reservadaPara: o.reservadaPara, recusouId: o.recusadoPor?.id ?? null });

  return (
    <section aria-label="Despacho" className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">Despacho</h1>
          <p className="text-muted">Designe um técnico para as OMs sem responsável. A OM fica reservada até o técnico assumir com o PIN.</p>
        </div>
        <div className="flex items-center gap-3">
          <span role="status" className={`rounded-full px-3 py-1 text-sm font-semibold ${sse === "conectado" ? "bg-ok-soft text-ok-soft-fg" : "bg-warn-soft text-warn-soft-fg"}`}>
            {sse === "conectado" ? "● Ao vivo" : sse === "indisponivel" ? "○ Atualização a cada 10s" : "○ Reconectando…"}
          </span>
          <button onClick={() => void carregar()} className={btnSec}><Icone nome="atualizar" />Atualizar</button>
        </div>
      </header>

      {aviso && <AvisoDesfazer key={aviso.omId + aviso.msg} omId={aviso.omId} mensagem={aviso.msg} onFechar={() => setAviso(null)} onDesfeito={() => { setAviso(null); void carregar(); }} />}
      {erro && <Faixa tipo="erro">{erro} <button onClick={() => void carregar()} className="ml-1 underline">Tentar novamente</button></Faixa>}

      {devolvidas.length > 0 && (
        <section aria-label="Recusadas pelo técnico" className="flex flex-col gap-2 rounded-2xl bg-warn-soft p-4 text-warn-soft-fg ring-2 ring-warn-fg">
          <h2 className="flex items-center gap-2 text-lg font-extrabold"><Icone nome="desfazer" />Recusadas pelo técnico ({devolvidas.length})</h2>
          <ul className="flex flex-col gap-2">
            {devolvidas.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-panel p-3 text-fg ring-1 ring-line-soft">
                <div className="min-w-0 flex-1">
                  <p><strong className="whitespace-nowrap tabular-nums">{o.numero}</strong> · {o.equipamento.codigo} · {o.equipamento.nome}
                    <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-extrabold ${PRIORIDADE[o.prioridade].cls}`}>{PRIORIDADE[o.prioridade].label}</span></p>
                  <p className="text-sm">Recusada{o.recusadoPor ? ` por ${o.recusadoPor.nome}` : ""}{o.recusadoEm ? ` · ${haQuanto(o.recusadoEm)}` : ""}{o.motivoRecusa ? <>: <q>{o.motivoRecusa}</q></> : ""}</p>
                </div>
                <button onClick={() => setAtribuindo(o)} aria-label={`Reatribuir ${o.numero}`} className={`${btnPrim} !min-h-11`}><Icone nome="enviar" />Reatribuir</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="flex flex-col gap-4">
          <section aria-label="Sem responsável" className="flex flex-col gap-3 rounded-2xl bg-panel p-4 ring-1 ring-line">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-extrabold">Sem responsável ({visiveis.length})</h2>
              <div role="group" aria-label="Mostrar" className="flex gap-2">
                {([["urgentes", `Urgentes (${urgentes.length})`], ["todas", `Todas sem responsável (${semResponsavel.length})`]] as [Modo, string][]).map(([k, l]) => (
                  <button key={k} aria-pressed={modo === k} onClick={() => setModo(k)}
                    className={`min-h-11 rounded-full px-4 text-sm font-semibold ${modo === k ? "bg-brand-600 text-white" : "bg-panel ring-1 ring-line hover:bg-brand-50"}`}>{l}</button>
                ))}
              </div>
            </div>
            {!fila && !erro ? <Esqueleto /> : visiveis.length === 0 ? (
              <p className="rounded-xl bg-ink p-8 text-center text-muted">
                Nenhuma OM aguardando responsável.{modo === "urgentes" && semResponsavel.length > 0 && <> Há {semResponsavel.length} não urgente(s) na fila de puxar: veja em “Todas sem responsável”.</>}
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {visiveis.map((o) => (
                  <li key={o.id}><Cartao om={o} user={user} rotulo="Atribuir" onAcao={() => setAtribuindo(o)} /></li>
                ))}
              </ul>
            )}
          </section>

          {reservadas.length > 0 && (
            <section aria-label="Reservadas aguardando aceite" className="flex flex-col gap-3 rounded-2xl bg-panel p-4 ring-1 ring-line">
              <h2 className="text-lg font-extrabold">Reservadas aguardando aceite ({reservadas.length})</h2>
              <ul className="flex flex-col gap-3">
                {reservadas.map((o) => (
                  <li key={o.id}>
                    <Cartao om={o} user={user} rotulo="Reatribuir" onAcao={() => setAtribuindo(o)}
                      extra={<button onClick={() => { setErroDesfazer(null); setDesfazendo(o); }} className={`${btnSec} !min-h-11`} aria-label={`Desfazer a reserva de ${o.numero}`}><Icone nome="desfazer" />Desfazer reserva</button>} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <aside aria-label="Técnicos" className="flex flex-col gap-3 rounded-2xl bg-panel p-4 ring-1 ring-line xl:sticky xl:top-28">
          <h2 className="text-lg font-extrabold">Técnicos{tecnicos ? ` (${tecnicos.length} ativos)` : ""}</h2>
          {!tecnicos ? <Esqueleto linhas={3} /> : erroTecnicos ? <Faixa tipo="erro">{erroTecnicos}</Faixa> : tecnicos.length === 0 ? (
            <Faixa tipo="atencao">Nenhum técnico ativo.{user.perfil === "ADMIN" ? " Cadastre em Configurações, aba Usuários (perfil Técnico)." : " Peça a um administrador para cadastrar técnicos."}</Faixa>
          ) : (
            <ul className="flex flex-col gap-2">
              {tecnicos.map((t) => (
                <li key={t.id} className="rounded-xl bg-ink p-3 ring-1 ring-line-soft">
                  <p className="flex items-center justify-between gap-2 font-bold">{t.nome}
                    <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${t.situacao === "DISPONIVEL" ? "bg-ok-soft text-ok-soft-fg" : "bg-warn-soft text-warn-soft-fg"}`}>
                      {t.situacao === "DISPONIVEL" ? "● Disponível" : "● Em atendimento"}</span></p>
                  <p className="text-sm text-muted">Em atendimento: {t.emAtendimento} · Reservadas: {t.reservadas}{t.cronometroAtivo ? " · cronômetro ativo" : ""}</p>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>

      {atribuindo && (
        <AtribuirTecnico om={paraAtribuir(atribuindo)} onFechar={() => setAtribuindo(null)} onAtualizar={() => void carregar()}
          onAtribuido={(a) => {
            const om = atribuindo; setAtribuindo(null);
            setAviso({ omId: om.id, msg: `${om.numero} ${a.reatribuicao ? "reatribuída" : "reservada"} para ${a.tecnico.nome}.` });
            void carregar();
          }} />
      )}
      {desfazendo && (
        <ConfirmarAcao titulo="Desfazer a reserva?" rotuloConfirmar="Desfazer reserva" busy={busy} erro={erroDesfazer}
          onCancelar={() => setDesfazendo(null)} onConfirmar={() => void desfazerReserva(desfazendo)}>
          <p>A OM <strong>{desfazendo.numero}</strong> deixa de estar reservada para <strong>{desfazendo.reservadaPara?.nome ?? "o técnico"}</strong> e volta à fila para nova designação.</p>
        </ConfirmarAcao>
      )}
    </section>
  );
}

function Esqueleto({ linhas = 3 }: { linhas?: number }) {
  return (
    <div aria-busy="true" aria-label="Carregando" className="flex flex-col gap-3">
      {Array.from({ length: linhas }, (_, i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-ink ring-1 ring-line-soft" />)}
    </div>
  );
}

const BARRA: Record<string, string> = { CRITICA: "border-l-red-700", ALTA: "border-l-orange-500", MEDIA: "border-l-yellow-400", BAIXA: "border-l-slate-500" };

function Cartao({ om, user, rotulo, onAcao, extra }: { om: OmKanban; user: Operador; rotulo: string; onAcao: () => void; extra?: React.ReactNode }) {
  const p = PRIORIDADE[om.prioridade];
  return (
    <article className={`flex flex-col gap-2 rounded-xl border-l-4 bg-ink p-3 ring-2 ${BARRA[om.prioridade] ?? "border-l-slate-500"} ${om.prioridade === "CRITICA" ? "ring-danger-fg" : "ring-line-soft"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="whitespace-nowrap font-bold tabular-nums text-primary-fg">{om.numero}</span>
        <span className={`rounded-full px-2.5 py-0.5 text-sm font-extrabold ${p.cls}`}>{p.label}</span>
        <span className="ml-auto whitespace-nowrap text-sm text-muted" title={new Date(om.dataAbertura).toLocaleString("pt-BR")}>{haQuanto(om.dataAbertura)}</span>
      </div>
      <p className="font-semibold">{om.equipamento.codigo} · {om.equipamento.nome}</p>
      <p className="text-sm text-muted">{om.sintomas.join(", ") || om.titulo}{om.prioridade === "CRITICA" ? " · máquina parada" : ""}</p>
      <SeloAtribuicao om={om} userId={user.id} gestor />
      <div className="flex flex-wrap justify-end gap-2">
        {extra}
        <button onClick={onAcao} aria-label={`${rotulo} técnico para ${om.numero}`} className={`${btnPrim} !min-h-11`}><Icone nome="enviar" />{rotulo}</button>
      </div>
    </article>
  );
}
