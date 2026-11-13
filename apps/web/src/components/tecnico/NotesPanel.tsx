"use client";
import { useCallback, useEffect, useState } from "react";
import { ApiError, adicionarNota, listarNotas } from "@/lib/api";
import { interpretarNota } from "@/lib/kanban";
import { OBS_MAX } from "@/lib/constants";
import type { Nota } from "@/lib/types";
import { btnBase } from "../kiosk/ui";
import { VirtualKeyboard } from "../kiosk/VirtualKeyboard";

/** Lista as notas da OM (inclui pausas auditadas) e permite adicionar nova com teclado em tela. */
export function NotesPanel({ omId, encerrada, refreshKey }: { omId: string; encerrada: boolean; refreshKey: number }) {
  const [notas, setNotas] = useState<Nota[] | null>(null);
  const [texto, setTexto] = useState("");
  const [abrir, setAbrir] = useState(false);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(() => {
    listarNotas(omId).then(setNotas).catch(() => setErro("Não foi possível carregar as notas."));
  }, [omId]);
  useEffect(carregar, [carregar, refreshKey]);

  async function enviar() {
    setBusy(true); setErro(null);
    try {
      await adicionarNota(omId, texto.trim());
      setTexto(""); setAbrir(false);
      carregar();
    } catch (e) {
      setErro(e instanceof ApiError ? e.message : "Não foi possível salvar a nota.");
    } finally { setBusy(false); }
  }

  return (
    <section aria-label="Notas" className="flex flex-col gap-3">
      <h3 className="text-2xl font-extrabold">Notas {notas && `(${notas.length})`}</h3>
      {erro && <p role="alert" className="text-xl font-semibold text-danger-fg">{erro}</p>}
      {!notas ? <p className="text-xl text-muted">Carregando…</p> : notas.length === 0 ? (
        <p className="text-xl text-muted">Nenhuma nota registrada.</p>
      ) : (
        <ul className="flex max-h-[40dvh] flex-col gap-2 overflow-y-auto">
          {notas.map((n) => {
            const i = interpretarNota(n.nota);
            return (
              <li key={n.id} className={`rounded-xl p-3 ring-1 ${i.pausa ? "bg-amber-50 ring-amber-500" : "bg-ink ring-line"}`}>
                <p className="flex flex-wrap justify-between gap-2 text-lg text-muted">
                  <span>{n.autor.nome}</span>
                  <time dateTime={n.criadoEm}>{new Date(n.criadoEm).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</time>
                </p>
                {i.pausa && <p className="text-xl font-bold text-amber-800">⏸ Pausa: {i.pausa}</p>}
                {i.texto && <p className="whitespace-pre-wrap text-xl">{i.texto}</p>}
              </li>
            );
          })}
        </ul>
      )}
      {!encerrada && (abrir ? (
        <>
          <div className="min-h-[72px] rounded-xl bg-ink p-3 text-xl ring-1 ring-line">
            {texto || <span className="text-muted">Digite a nota…</span>}
            <span className="float-right text-lg text-muted">{texto.length}/{OBS_MAX}</span>
          </div>
          <VirtualKeyboard value={texto} onChange={setTexto} maxLength={OBS_MAX} />
          <div className="grid grid-cols-2 gap-3">
            <button onClick={() => { setAbrir(false); setTexto(""); }} className={`${btnBase} bg-ink ring-1 ring-line`}>Cancelar</button>
            <button disabled={busy || !texto.trim()} onClick={enviar} className={`${btnBase} bg-green-700 text-white`}>{busy ? "Salvando…" : "Salvar nota"}</button>
          </div>
        </>
      ) : (
        <button onClick={() => setAbrir(true)} className={`${btnBase} bg-brand-700 text-white`}>＋ Adicionar nota</button>
      ))}
    </section>
  );
}
