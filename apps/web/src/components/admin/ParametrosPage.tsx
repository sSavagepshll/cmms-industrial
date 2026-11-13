"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, listarConfiguracoes, salvarConfiguracao } from "@/lib/api";
import { ehConfigEmail, ehVerdadeiro, mensagemErroConfig, temValor } from "@/lib/configuracoes";
import type { ConfiguracaoItem } from "@/lib/types";
import { CampoSecreto } from "../ui/CampoSecreto";
import { ConfirmarAcao } from "../ui/ConfirmarAcao";
import { Faixa } from "../ui/Faixa";
import { Icone } from "../ui/Icones";
import { btnPrim, btnSec, campo } from "../ui/estilos";
import { MODOS_TEMA, PADRAO_TEMA_TOTEM, horaValida, lerConfigPublica, resumoTema, type ModoTema } from "@/lib/temaTotem";

/** Chaves do grupo "Aparência do totem" (tela própria; dado-guiado: só aparece se o servidor as publicar). */
const CHAVES_TEMA = ["TEMA_TOTEM_MODO", "TEMA_TOTEM_ESCURO_INICIO", "TEMA_TOTEM_ESCURO_FIM"] as const;

const ROTULO_GRUPO: Record<string, string> = { EMAIL: "E-mail", SMTP: "E-mail (SMTP)", SISTEMA: "Sistema", EMPRESA: "Empresa", GERAL: "Geral", SEGURANCA: "Segurança", SLA: "SLA", METAS: "Metas de atendimento (minutos)" };
const rotuloGrupo = (g: string) => ROTULO_GRUPO[g.toUpperCase()] ?? g.charAt(0).toUpperCase() + g.slice(1).toLowerCase().replace(/_/g, " ");

/** Forma canônica para comparar "mudou?" sem falso positivo (ex.: "1" vs "true"). */
const normalizar = (c: ConfiguracaoItem, v: string) => (c.tipo === "BOOLEANO" ? String(ehVerdadeiro(v)) : v.trim());

/** Mensagem de erro de validação do valor digitado (null = válido). */
function validar(c: ConfiguracaoItem, v: string): string | null {
  const t = v.trim();
  if (!t) return null; // vazio = limpar o parâmetro
  if (c.tipo === "NUMERO" && !Number.isFinite(Number(t.replace(",", ".")))) return "Informe um número válido.";
  if (c.tipo === "NUMERO" && (c.min != null || c.max != null)) {
    const n = Number(t.replace(",", "."));
    if ((c.min != null && n < c.min) || (c.max != null && n > c.max)) return `Informe um valor entre ${c.min ?? "…"} e ${c.max ?? "…"}${c.unidade ? ` ${c.unidade}` : ""}.`;
  }
  if (c.tipo === "JSON") { try { JSON.parse(t); } catch { return "JSON inválido."; } }
  return null;
}

/**
 * Parâmetros do Sistema (ADMIN): lista `GET /configuracoes` agrupada por `grupo`; salva cada chave com `PUT /configuracoes/:chave`.
 * As chaves do SMTP ficam na aba "E-mail (SMTP)" e não aparecem aqui.
 */
export function ParametrosPage() {
  const [itens, setItens] = useState<ConfiguracaoItem[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [edits, setEdits] = useState<Record<string, string>>({}); // só chaves alteradas; SECRETO só quando digitado
  const [errosCampo, setErrosCampo] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState<string | null>(null); // grupo em gravação
  const [aviso, setAviso] = useState<string | null>(null);
  const [confirmaRecarregar, setConfirmaRecarregar] = useState(false);

  const carregar = useCallback(() => {
    listarConfiguracoes()
      .then((l) => { setItens(l.filter((c) => !ehConfigEmail(c))); setErro(null); })
      .catch((e) => { if (e instanceof ApiError && e.status === 401) return; setItens((p) => p ?? []); setErro(mensagemErroConfig(e)); });
  }, []);
  useEffect(carregar, [carregar]);

  const grupos = useMemo(() => {
    const m = new Map<string, ConfiguracaoItem[]>();
    for (const c of [...(itens ?? [])].filter((x) => !(CHAVES_TEMA as readonly string[]).includes(x.chave)).sort((a, b) => a.chave.localeCompare(b.chave))) m.set(c.grupo, [...(m.get(c.grupo) ?? []), c]);
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [itens]);

  const itensTema = useMemo(() => (itens ?? []).filter((c) => (CHAVES_TEMA as readonly string[]).includes(c.chave)), [itens]);
  const sujo = Object.keys(edits).length > 0;

  function editar(c: ConfiguracaoItem, v: string) {
    setAviso(null);
    setErrosCampo((p) => { const { [c.chave]: _, ...r } = p; return r; });
    setEdits((p) => {
      const { [c.chave]: _, ...resto } = p;
      const original = c.tipo === "SECRETO" ? "" : (c.valor ?? "");
      const igual = c.tipo === "SECRETO" ? v === "" : normalizar(c, v) === normalizar(c, original);
      return igual ? resto : { ...resto, [c.chave]: v };
    });
  }

  function descartarGrupo(lista: ConfiguracaoItem[]) {
    const chaves = new Set(lista.map((c) => c.chave));
    setEdits((p) => Object.fromEntries(Object.entries(p).filter(([k]) => !chaves.has(k))));
    setErrosCampo((p) => Object.fromEntries(Object.entries(p).filter(([k]) => !chaves.has(k))));
  }

  async function salvarGrupo(grupo: string, lista: ConfiguracaoItem[]) {
    const alteradas = lista.filter((c) => c.chave in edits);
    if (alteradas.length === 0) return;
    const invalidos = Object.fromEntries(alteradas.map((c) => [c.chave, validar(c, edits[c.chave])] as const).filter(([, m]) => m)) as Record<string, string>;
    if (Object.keys(invalidos).length) { setErrosCampo((p) => ({ ...p, ...invalidos })); return; }

    setSalvando(grupo); setAviso(null);
    const resultados = await Promise.allSettled(alteradas.map(async (c) => {
      const bruto = edits[c.chave];
      // SECRETO: só chega aqui se foi digitado (nunca enviar a máscara). Demais: vazio = limpar (null).
      const valor = c.tipo === "SECRETO" ? bruto
        : c.tipo === "BOOLEANO" ? String(ehVerdadeiro(bruto))
        : c.tipo === "NUMERO" ? (bruto.trim() ? bruto.trim().replace(",", ".") : null)
        : (bruto.trim() === "" ? null : bruto.trim());
      return salvarConfiguracao(c.chave, valor);
    }));

    const novosErros: Record<string, string> = {};
    const salvos: ConfiguracaoItem[] = [];
    resultados.forEach((r, i) => {
      if (r.status === "fulfilled") salvos.push(r.value);
      else novosErros[alteradas[i].chave] = mensagemErroConfig(r.reason);
    });
    setItens((l) => l?.map((c) => salvos.find((s) => s.chave === c.chave) ?? c) ?? l);
    setEdits((p) => Object.fromEntries(Object.entries(p).filter(([k]) => !salvos.some((s) => s.chave === k))));
    setErrosCampo((p) => ({ ...p, ...novosErros }));
    if (salvos.length) setAviso(`${salvos.length} parâmetro(s) de “${rotuloGrupo(grupo)}” salvo(s).${Object.keys(novosErros).length ? ` ${Object.keys(novosErros).length} com erro.` : ""}`);
    setSalvando(null);
  }

  function recarregar() {
    setEdits({}); setErrosCampo({}); setAviso(null); setConfirmaRecarregar(false); carregar();
  }

  return (
    <section aria-label="Parâmetros do sistema" className="flex flex-col gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-xl font-extrabold">Parâmetros do sistema</h3>
          <p className="text-muted">Configurações globais da empresa. Cada grupo é salvo separadamente. O e-mail (SMTP) tem aba própria.</p>
        </div>
        <button onClick={() => (sujo ? setConfirmaRecarregar(true) : recarregar())} className={btnSec}><Icone nome="atualizar" />Recarregar</button>
      </header>

      {aviso && <Faixa tipo="ok">{aviso}</Faixa>}
      {erro && <Faixa tipo="erro">{erro}</Faixa>}
      {!itens && <p className="text-muted">Carregando…</p>}
      {itens && itens.length === 0 && !erro && <p className="rounded-xl bg-panel p-6 text-center text-muted ring-1 ring-line">Nenhum parâmetro cadastrado.</p>}

      {itens && itensTema.length === 0 && !erro && (
        <p className="flex items-center gap-2 rounded-xl bg-info-soft p-3 text-info-soft-fg"><Icone nome="info" />A aparência do totem (claro, escuro ou por horário) ainda não está disponível neste servidor.</p>
      )}
      {itensTema.length > 0 && (
        <AparenciaTotem itens={itensTema} edits={edits} erros={errosCampo} salvando={salvando !== null} gravando={salvando === "TEMA"}
          onEditar={editar} onDescartar={() => descartarGrupo(itensTema)} onSalvar={() => void salvarGrupo("TEMA", itensTema)} />
      )}
      {grupos.map(([grupo, lista]) => {
        const mudou = lista.filter((c) => c.chave in edits).length;
        return (
          <form key={grupo} aria-label={rotuloGrupo(grupo)} onSubmit={(e) => { e.preventDefault(); void salvarGrupo(grupo, lista); }}
            className="flex flex-col gap-4 rounded-2xl bg-panel p-4 ring-1 ring-line md:p-5">
            <h4 className="text-lg font-extrabold text-primary-fg">{rotuloGrupo(grupo)}</h4>
            <div className="grid gap-4 md:grid-cols-2">
              {lista.map((c) => (
                <CampoParametro key={c.chave} c={c} valor={c.chave in edits ? edits[c.chave] : undefined} erro={errosCampo[c.chave]}
                  alterado={c.chave in edits} onChange={(v) => editar(c, v)} />
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-3">
              {mudou > 0 && <span className="mr-auto text-sm font-semibold text-amber-800">● {mudou} alteração(ões) não salva(s)</span>}
              <button type="button" onClick={() => descartarGrupo(lista)} disabled={mudou === 0 || salvando === grupo} className={btnSec}>Descartar</button>
              <button type="submit" disabled={mudou === 0 || salvando !== null} className={btnPrim}>{salvando === grupo ? "Salvando…" : `Salvar ${rotuloGrupo(grupo)}`}</button>
            </div>
          </form>
        );
      })}

      {confirmaRecarregar && (
        <ConfirmarAcao titulo="Descartar alterações e recarregar?" rotuloConfirmar="Descartar e recarregar"
          onCancelar={() => setConfirmaRecarregar(false)} onConfirmar={recarregar}>
          <p>Há <strong>{Object.keys(edits).length}</strong> alteração(ões) não salva(s). Recarregar volta os campos aos valores gravados e apaga o que você digitou.</p>
        </ConfirmarAcao>
      )}
    </section>
  );
}

function CampoParametro({ c, valor, erro, alterado, onChange }: {
  c: ConfiguracaoItem; valor: string | undefined; erro?: string; alterado: boolean; onChange: (v: string) => void;
}) {
  const id = `cfg-${c.chave}`;
  const dica = `${id}-dica`;
  const atual = valor ?? (c.tipo === "SECRETO" ? "" : (c.valor ?? ""));
  const rotulo = c.descricao?.trim() || c.chave;
  const ring = erro ? "ring-danger-fg" : alterado ? "ring-amber-500" : "";
  const comum = { id, "aria-invalid": !!erro, "aria-describedby": dica } as const;
  const chave = <code className="rounded bg-brand-50 px-1">{c.chave}</code>;
  const faixa = c.unidade || c.min != null || c.max != null
    ? <> · {c.unidade ?? ""}{c.min != null && c.max != null ? " (de " + c.min + " a " + c.max + ")" : ""}{c.padrao == null && c.grupo.toUpperCase() === "METAS" ? " · vazio = sem meta" : ""}</> : null;

  if (c.tipo === "SECRETO") {
    return <CampoSecreto id={id} rotulo={rotulo} valor={atual} onChange={onChange} definido={temValor(c)} alterado={alterado} erro={erro} extra={<> · {chave}</>} />;
  }
  return (
    <div className={`flex flex-col gap-1 ${c.tipo === "JSON" ? "md:col-span-2" : ""}`}>
      {c.tipo === "BOOLEANO" ? (
        <label htmlFor={id} className="flex min-h-11 items-center gap-3 font-semibold">
          <input {...comum} type="checkbox" checked={ehVerdadeiro(atual)} onChange={(e) => onChange(e.target.checked ? "true" : "false")} className="h-6 w-6 accent-brand-600" />
          {rotulo}{alterado && <span aria-label="alterado" className="text-amber-700">●</span>}
        </label>
      ) : (
        <>
          <label htmlFor={id} className="font-semibold">{rotulo}{alterado && <span aria-label="alterado" className="ml-1 text-amber-700">●</span>}</label>
          {c.tipo === "JSON" ? (
            <textarea {...comum} rows={5} spellCheck={false} value={atual} onChange={(e) => onChange(e.target.value)} className={`${campo} py-2 font-mono text-sm ${ring}`} />
          ) : c.tipo === "NUMERO" ? (
            <input {...comum} type="text" inputMode="decimal" value={atual} onChange={(e) => onChange(e.target.value)} className={`${campo} tabular-nums ${ring}`} />
          ) : (
            <input {...comum} type="text" value={atual} onChange={(e) => onChange(e.target.value)} className={`${campo} ${ring}`} />
          )}
        </>
      )}
      <span id={dica} className={`text-sm ${erro ? "font-semibold text-red-800" : "text-muted"}`}>{erro ?? <>{chave}{faixa}</>}</span>
    </div>
  );
}

/** Grupo "Aparência do totem" (docs/ux/fase17-etapa2-telas-finais.md §2): modo + janela escura (só em "Por horário"). */
function AparenciaTotem({ itens, edits, erros, salvando, gravando, onEditar, onDescartar, onSalvar }: {
  itens: ConfiguracaoItem[]; edits: Record<string, string>; erros: Record<string, string>; salvando: boolean; gravando: boolean;
  onEditar: (c: ConfiguracaoItem, v: string) => void; onDescartar: () => void; onSalvar: () => void;
}) {
  const item = (k: string) => itens.find((c) => c.chave === k);
  const val = (k: string) => { const c = item(k); return c ? (k in edits ? edits[k] : (c.valor ?? "")) : ""; };
  const publico = lerConfigPublica({ temaModo: val("TEMA_TOTEM_MODO"), escuroInicio: val("TEMA_TOTEM_ESCURO_INICIO"), escuroFim: val("TEMA_TOTEM_ESCURO_FIM") }).cfg;
  const modo: ModoTema = publico.modo;
  const mudou = itens.filter((c) => c.chave in edits).length;
  const invalida = (k: string) => { const v = val(k); return v !== "" && !horaValida(v); };
  const iniV = invalida("TEMA_TOTEM_ESCURO_INICIO"), fimV = invalida("TEMA_TOTEM_ESCURO_FIM");
  const cI = item("TEMA_TOTEM_MODO");
  return (
    <form aria-label="Aparência do totem" onSubmit={(e) => { e.preventDefault(); if (!iniV && !fimV) onSalvar(); }}
      className="flex flex-col gap-4 rounded-2xl bg-panel p-4 ring-1 ring-line md:p-5">
      <h4 className="text-lg font-extrabold text-primary-fg">Aparência do totem</h4>
      <fieldset className="flex flex-col gap-2">
        <legend className="font-semibold">Tema do totem</legend>
        <div role="radiogroup" aria-label="Tema do totem" className="flex flex-wrap gap-2">
          {MODOS_TEMA.map((m) => (
            <label key={m.key} className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-4 font-semibold ring-2 ${modo === m.key ? "bg-brand-700 text-white ring-brand-700" : "bg-ink ring-line"}`}>
              <input type="radio" name="tema-totem" value={m.key} checked={modo === m.key} onChange={() => cI && onEditar(cI, m.key)} className="sr-only" />
              {m.rotulo}
            </label>
          ))}
        </div>
      </fieldset>
      {modo === "HORARIO" && (
        <div className="grid gap-4 sm:grid-cols-2">
          {([["TEMA_TOTEM_ESCURO_INICIO", "Escuro a partir de", PADRAO_TEMA_TOTEM.inicio, iniV], ["TEMA_TOTEM_ESCURO_FIM", "Claro a partir de", PADRAO_TEMA_TOTEM.fim, fimV]] as const).map(([k, rot, ph, ruim]) => {
            const c = item(k);
            return c && (
              <div key={k} className="flex flex-col gap-1">
                <span id={`cfg-${k}-rot`} className="font-semibold">{rot}</span>
                <SeletorHora id={`cfg-${k}`} rotuloId={`cfg-${k}-rot`} valor={val(k)} invalido={ruim || !!erros[k]} onChange={(v) => onEditar(c, v)} />
                <span className={`text-sm ${ruim || erros[k] ? "font-semibold text-red-800" : "text-muted"}`}>{erros[k] ?? (ruim ? "Use HH:mm (ex.: 18:00)." : `Padrão ${ph}`)}</span>
              </div>
            );
          })}
        </div>
      )}
      {erros.TEMA_TOTEM_MODO && <p role="alert" className="text-sm font-semibold text-red-800">{erros.TEMA_TOTEM_MODO}</p>}
      <p className="flex items-start gap-2 text-sm text-muted"><Icone nome="info" className="mt-0.5 h-4 w-4 shrink-0" />{resumoTema(publico, new Date(), false)} O operador pode trocar no botão sol/lua da tela de repouso; a troca vale até a próxima virada (ou até o reinício do totem).</p>
      <div className="flex flex-wrap items-center justify-end gap-3">
        {mudou > 0 && <span className="mr-auto text-sm font-semibold text-amber-800">● {mudou} alteração(ões) não salva(s)</span>}
        <button type="button" onClick={onDescartar} disabled={mudou === 0 || gravando} className={btnSec}>Descartar</button>
        <button type="submit" disabled={mudou === 0 || salvando || iniV || fimV} className={btnPrim}>{gravando ? "Salvando…" : "Salvar Aparência do totem"}</button>
      </div>
    </form>
  );
}

/** Hora em 24 h independente do idioma do navegador (Designer): dois seletores HH (00–23) e mm (passo de 5 min), rótulo "h". */
function SeletorHora({ id, rotuloId, valor, invalido, onChange }: { id: string; rotuloId: string; valor: string; invalido: boolean; onChange: (v: string) => void }) {
  const [h, m] = /^[0-9]{2}:[0-9]{2}$/.test(valor) ? valor.split(":") : ["", ""];
  const horas = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
  const minutos = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0"));
  if (m && !minutos.includes(m)) minutos.push(m), minutos.sort(); // valor já gravado fora do passo de 5: não perder
  const mudar = (nh: string, nm: string) => onChange(`${nh || "00"}:${nm || "00"}`);
  const cls = `${campo} w-24 tabular-nums ${invalido ? "ring-danger-fg" : ""}`;
  return (
    <div role="group" aria-labelledby={rotuloId} className="flex items-center gap-2">
      <select id={id} aria-label="Hora" value={h} aria-invalid={invalido} onChange={(e) => mudar(e.target.value, m)} className={cls}>
        {!h && <option value="">--</option>}{horas.map((x) => <option key={x}>{x}</option>)}
      </select>
      <span aria-hidden className="font-bold">h</span>
      <select aria-label="Minutos" value={m} aria-invalid={invalido} onChange={(e) => mudar(h, e.target.value)} className={cls}>
        {!m && <option value="">--</option>}{minutos.map((x) => <option key={x}>{x}</option>)}
      </select>
    </div>
  );
}
