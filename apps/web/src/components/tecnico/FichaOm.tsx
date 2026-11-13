"use client";
import { useEffect, useState, type ReactNode } from "react";
import { listarApontamentos, listarMateriais } from "@/lib/api";
import { fmtDia, fmtHora, horasDecimais } from "@/lib/datetime";
import type { Apontamento, Material, OmKanban } from "@/lib/types";
import { Brand } from "../Brand";
import { rotuloTipo, setorDaOm } from "@/lib/rotulos";

/**
 * Ficha da OM: visualização somente-leitura espelhando o formulário físico (Formulário: APX-081), frente e verso.
 * Folha branca (papel) mesmo no tema escuro, como a ficha impressa; no celular as seções empilham e as
 * tabelas rolam na horizontal. Campos sem dado no sistema ficam em branco, como no papel.
 */
const cel = "f-cel border border-slate-400 p-2";
const rotulo = "text-xs font-bold uppercase tracking-wide text-slate-600 sm:text-sm";
const Campo = ({ r, children, className = "" }: { r: string; children?: ReactNode; className?: string }) => (
  <div className={`${cel} ${className}`}><p className={rotulo}>{r}</p><div className="min-h-7 text-lg font-semibold text-primary-fg md:text-xl">{children}</div></div>
);
const Marca = ({ on, children }: { on: boolean; children: ReactNode }) => (
  <span className="inline-flex items-center gap-2 text-base font-bold text-slate-800 md:text-lg">
    <span aria-hidden className="grid h-6 w-6 place-items-center border-2 border-slate-700 text-base leading-none">{on ? "✕" : ""}</span>
    <span className="sr-only">{on ? "Marcado: " : "Não marcado: "}</span>{children}
  </span>
);
const Titulo = ({ children }: { children: ReactNode }) => (
  <h3 className="border-x border-slate-400 bg-slate-100 p-2 text-center text-base font-extrabold uppercase tracking-wide text-slate-800 md:text-lg">{children}</h3>
);
const th = "f-th border border-slate-400 bg-slate-50 p-2 text-center text-xs font-bold uppercase text-slate-700 sm:text-sm";
const td = "f-td border border-slate-400 p-2 h-11 text-base tabular-nums text-primary-fg md:text-lg";
const dh = (iso?: string | null) => (iso ? `${fmtDia(iso)} ${fmtHora(iso)}` : "");
const linhas = (n: number, min: number) => Array.from({ length: Math.max(0, min - n) });

export function FichaOm({ om }: { om: OmKanban }) {
  const [aps, setAps] = useState<Apontamento[]>([]);
  const [mats, setMats] = useState<Material[]>([]);
  useEffect(() => {
    listarApontamentos(om.id).then(setAps).catch(() => setAps([]));
    listarMateriais(om.id).then((r) => setMats(r.itens)).catch(() => setMats([]));
  }, [om.id]);

  const seg = (a: Apontamento) => (a.fim ? Math.max(0, (new Date(a.fim).getTime() - new Date(a.inicio).getTime()) / 1000) : 0);
  const total = aps.reduce((t, a) => t + seg(a), 0);
  const ultimoFim = aps.filter((a) => a.fim).map((a) => a.fim as string).sort().at(-1);
  const servicos = om.descricao || om.sintomas.join(", ") || om.titulo;

  return (
    <article aria-label={`Ficha da OM ${om.numero}`} className="ficha-impressao flex flex-col gap-6">
      <div className="flex justify-end print:hidden">
        <button onClick={() => window.print()} className="min-h-14 rounded-xl bg-panel px-5 text-lg font-bold ring-1 ring-line md:min-h-tap-md md:text-xl">🖨 Imprimir ficha</button>
      </div>

      {/* ---------- FRENTE ---------- */}
      <section aria-label="Frente da ficha" className="tema-claro bg-paper text-slate-900 shadow-lg ring-1 ring-black/20">
        <header className="grid grid-cols-1 items-center border border-slate-400 sm:grid-cols-[auto_1fr]">
          <div className="border-slate-400 p-3 sm:border-r"><Brand /></div>
          <p className="p-3 text-center text-2xl font-extrabold uppercase tracking-wide sm:text-3xl">Apex Industrial Technologies</p>
        </header>
        <div className="grid grid-cols-1 border-x border-slate-400 sm:grid-cols-[1fr_auto]">
          <p className={`${cel} flex items-center text-sm font-extrabold uppercase text-slate-800 md:text-base`}>Ordem de Manutenção (OM)</p>
          <p className={`${cel} text-center text-3xl font-black tabular-nums text-accent md:text-4xl`}>{om.numero}</p>
        </div>

        <div className="grid grid-cols-1 border-x border-slate-400 sm:grid-cols-[minmax(11rem,1fr)_2fr]">
          <div className={`${cel} flex flex-wrap gap-x-4 gap-y-2 sm:flex-col`}>
            <Marca on={om.tipoAtivo === "MOLDE"}>Molde</Marca>
            <Marca on={om.tipoAtivo === "MAQUINA"}>Máquina</Marca>
            {/* 3ª opção = linha em branco da ficha física: texto digitado (OUTRO), "Robô" (OMs antigas) ou sublinhado vazio. */}
            <Marca on={om.tipoAtivo === "OUTRO" || om.tipoAtivo === "ROBO"}>
              {om.tipoAtivo === "OUTRO" || om.tipoAtivo === "ROBO"
                ? rotuloTipo(om.tipoAtivo, om.tipoAtivoOutro, om.tipoAtivoRotulo)
                : <span aria-hidden className="inline-block w-24 border-b border-slate-700" />}
            </Marca>
            <p className="text-base font-bold text-slate-800 md:text-lg">C. CUSTO: <span className="text-primary-fg">{om.centroCusto ?? ""}</span></p>
          </div>
          <Campo r="Identificação do equipamento">
            <span className="text-2xl md:text-3xl">{om.itemDescricao ?? om.equipamento.nome}</span>
            <span className="block text-base text-slate-700">{om.itemDescricao ? "Item não cadastrado" : om.equipamento.codigo}{om.itemDescricao ? "" : om.equipamento.predial
              ? (om.localDescricao ? ` · Local: ${om.localDescricao}` : "")
              : ` · ${setorDaOm(om)}${om.equipamento.localizacao ? ` · ${om.equipamento.localizacao}` : ""}`}</span>
          </Campo>
        </div>

        <div className={`${cel} flex flex-wrap items-center gap-x-8 gap-y-2 border-t-0 border-x border-slate-400`}>
          <span className={rotulo}>Custo:</span>
          <Marca on={om.custoTipo === "INTERNO"}>Interno</Marca>
          <Marca on={om.custoTipo === "CLIENTE"}>Cliente</Marca>
        </div>

        <Campo r="Serviços a executar" className="border-x"><p className="whitespace-pre-wrap">{servicos}</p></Campo>

        <div className="grid grid-cols-2 border-x border-slate-400 md:grid-cols-4">
          <Campo r="Solicitante · Data / Hora">{dh(om.dataAbertura)}</Campo>
          <Campo r="Solicitante · Visto">{om.solicitante.nome}</Campo>
          <Campo r="Executante · Data / Hora">{om.statusKanban === "CONCLUIDO" ? dh(ultimoFim) : ""}</Campo>
          <Campo r="Executante · Visto">{om.responsavel?.nome ?? ""}</Campo>
          <Campo r="Aprovado por · Data / Hora" className="md:col-span-2">{om.aprovadoPor ? `${om.aprovadoPor.nome} · ${dh(om.dataAprovacao)}` : ""}</Campo>
          <Campo r="Concluído por · Data / Hora" className="md:col-span-2">{om.statusKanban === "CONCLUIDO" ? (om.concluidoPor ? `${om.concluidoPor.nome} · ${dh(om.concluidoEm)}` : "—") : ""}</Campo>
        </div>

        <div className="overflow-x-auto border-x border-slate-400">
          <table className="w-full min-w-[40rem] border-collapse">
            <caption className="sr-only">Testes</caption>
            <thead><tr>{["Nº", "Teste S/N", "Data / Hora", "Programação", "Aprovado S/N", "Data / Hora", "Ciente executante"].map((h) => <th key={h} scope="col" className={th}>{h}</th>)}</tr></thead>
            <tbody>{[1, 2, 3, 4].map((n) => <tr key={n} className={n > 3 ? "extra-print" : undefined}><th scope="row" className={`${td} text-slate-700`}>{String(n).padStart(2, "0")}</th>{Array.from({ length: 6 }).map((_, i) => <td key={i} className={td} />)}</tr>)}</tbody>
          </table>
        </div>

        <Titulo>Teste (Produção) Resp.</Titulo>
        <div className="overflow-x-auto border-x border-slate-400">
          <table className="w-full min-w-[40rem] border-collapse">
            <caption className="sr-only">Teste de produção</caption>
            <thead><tr>{["Nº", "Data / Hora", "Recebido", "Início", "Final", "Tempo total (H)", "Devolvido"].map((h) => <th key={h} scope="col" className={th}>{h}</th>)}</tr></thead>
            <tbody>{[1, 2, 3, 4].map((n) => <tr key={n} className={n > 3 ? "extra-print" : undefined}><th scope="row" className={`${td} text-slate-700`}>{String(n).padStart(2, "0")}</th>{Array.from({ length: 6 }).map((_, i) => <td key={i} className={td} />)}</tr>)}</tbody>
          </table>
        </div>

        <div className="grid grid-cols-1 border border-slate-400 sm:grid-cols-[2fr_1fr]">
          <div className={`${cel} min-h-28`}><p className={rotulo}>Obs.:</p></div>
          <div className={`${cel} flex min-h-28 flex-col justify-between`}><p className={rotulo}>Uso interno</p><p className="text-xs text-slate-500">Formulário: APX-081</p></div>
        </div>
      </section>

      {/* ---------- VERSO ---------- */}
      <section aria-label="Verso da ficha" className="tema-claro bg-paper text-slate-900 shadow-lg ring-1 ring-black/20">
        <div className="overflow-x-auto border border-slate-400">
          <table className="w-full min-w-[36rem] border-collapse">
            <caption className="border-b border-slate-400 bg-slate-100 p-2 text-base font-extrabold uppercase text-slate-800 md:text-lg">Horas trabalhadas</caption>
            <thead><tr>{["Data", "Início", "Término", "Observações (cód)", "Tempo total (H)"].map((h) => <th key={h} scope="col" className={th}>{h}</th>)}</tr></thead>
            <tbody>
              {aps.map((a) => (
                <tr key={a.id}>
                  <td className={td}>{fmtDia(a.inicio)}</td><td className={td}>{fmtHora(a.inicio)}</td>
                  <td className={td}>{a.fim ? fmtHora(a.fim) : "▶ em andamento"}</td>
                  <td className={td}>{a.manual ? "✎ " : ""}{a.observacao}</td>
                  <td className={`${td} text-right font-bold`}>{a.fim ? horasDecimais(seg(a)) : ""}</td>
                </tr>
              ))}
              {linhas(aps.length, 8).map((_, i) => <tr key={`v${i}`} className={aps.length + i >= 6 ? "extra-print" : undefined}>{Array.from({ length: 5 }).map((__, k) => <td key={k} className={td} />)}</tr>)}
            </tbody>
            <tfoot><tr><td colSpan={4} className={`${td} bg-slate-50 text-right font-extrabold text-slate-800`}>TOTAL GERAL</td><td className={`${td} text-right text-xl font-extrabold`}>{aps.length ? horasDecimais(total) : ""}</td></tr></tfoot>
          </table>
        </div>
        <p className="border-x border-slate-400 px-2 py-1 text-xs text-slate-600">Início e término de cada lançamento (I = início, T = término no formulário físico).</p>

        <div className="f-mt mt-4 overflow-x-auto border border-slate-400">
          <table className="w-full min-w-[36rem] border-collapse">
            <caption className="sr-only">Materiais</caption>
            <thead><tr>{["Qde", "Unidade", "Descrição", "Inter.", "Conf. N.F."].map((h) => <th key={h} scope="col" className={th}>{h}</th>)}</tr></thead>
            <tbody>
              {mats.map((m) => (
                <tr key={m.id}>
                  <td className={`${td} font-bold`}>{String(m.quantidade).replace(".", ",")}</td><td className={td}>{m.unidade}</td><td className={td}>{m.descricao}</td>
                  <td className={`${td} text-center font-black`}>{m.flagInterno ? "✕" : ""}</td><td className={`${td} text-center font-black`}>{m.confNf ? "✕" : ""}</td>
                </tr>
              ))}
              {linhas(mats.length, 7).map((_, i) => <tr key={`m${i}`} className={mats.length + i >= 5 ? "extra-print" : undefined}>{Array.from({ length: 5 }).map((__, k) => <td key={k} className={td} />)}</tr>)}
            </tbody>
          </table>
        </div>
      </section>
    </article>
  );
}
