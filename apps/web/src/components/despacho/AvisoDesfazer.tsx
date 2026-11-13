"use client";
import { useEffect, useState } from "react";
import { ApiError, cancelarDelegacao } from "@/lib/api";
import { Faixa } from "../ui/Faixa";
import { Icone } from "../ui/Icones";
import { btnSec } from "../ui/estilos";

const JANELA_S = 8;

/**
 * Confirmação de "OM reservada para X" com [Desfazer] por 8 s (docs/ux/fase17 §2.3). Desfazer = POST /cancelar-delegacao,
 * que só funciona enquanto o técnico não aceitou (senão 409 e o aviso explica).
 */
export function AvisoDesfazer({ omId, mensagem, onFechar, onDesfeito }: { omId: string; mensagem: string; onFechar: () => void; onDesfeito: () => void }) {
  const [resta, setResta] = useState(JANELA_S);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (busy || erro) return;
    const id = setInterval(() => setResta((s) => s - 1), 1000);
    return () => clearInterval(id);
  }, [busy, erro]);
  useEffect(() => { if (resta <= 0 && !erro) onFechar(); }, [resta, erro, onFechar]);

  async function desfazer() {
    setBusy(true); setErro(null);
    try { await cancelarDelegacao(omId); onDesfeito(); }
    catch (e) { setErro(e instanceof ApiError ? (e.code === "OM_NAO_DISPONIVEL" ? "Não foi possível desfazer: o técnico já aceitou a OM." : e.message) : "Erro inesperado."); setBusy(false); }
  }

  if (erro) return <div className="flex flex-wrap items-center gap-3"><Faixa tipo="atencao" className="flex-1">{erro}</Faixa><button onClick={onFechar} className={btnSec}>Fechar</button></div>;
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Faixa tipo="ok" className="flex-1">{mensagem}</Faixa>
      <button onClick={() => void desfazer()} disabled={busy} className={btnSec}><Icone nome="desfazer" />{busy ? "Desfazendo…" : `Desfazer (${resta}s)`}</button>
    </div>
  );
}
