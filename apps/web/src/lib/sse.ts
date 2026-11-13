import { getApiBaseUrl } from "./api";
import { getToken, getTotemId, notifyUnauthorized } from "./session";

export type EstadoSse = "conectando" | "conectado" | "reconectando" | "indisponivel";
export interface EventoSse { event: string; data: string }

/**
 * SSE da API: 1) POST /eventos/ticket (Bearer) -> ticket de 30 s, uso único; 2) GET /eventos?ticket=...
 * (o JWT nunca vai na URL). Lido via fetch+stream; um novo ticket a cada reconexão.
 * Eventos: "conectado" e "om" ({tipo, ordemId}). Qualquer evento = "invalide a fila".
 * 403/404/501 no ticket => sem acesso/sem SSE: sinaliza "indisponivel" e o chamador usa polling.
 */
export function conectarEventos(onEvento: (e: EventoSse) => void, onEstado: (s: EstadoSse) => void): () => void {
  const ctrl = new AbortController();
  let tentativa = 0;

  async function ciclo() {
    while (!ctrl.signal.aborted) {
      onEstado(tentativa === 0 ? "conectando" : "reconectando");
      try {
        const t = await fetch(`${getApiBaseUrl()}/eventos/ticket`, {
          method: "POST",
          headers: { Authorization: `Bearer ${getToken() ?? ""}`, ...(getTotemId() ? { "X-Totem-Id": getTotemId() as string } : {}) },
          cache: "no-store",
          signal: ctrl.signal,
        });
        if (t.status === 401) { notifyUnauthorized(); return; }
        if ([403, 404, 501].includes(t.status)) { onEstado("indisponivel"); return; }
        if (!t.ok) throw new Error(`ticket ${t.status}`);
        const { ticket } = (await t.json()) as { ticket: string };

        const tid = getTotemId();
        const res = await fetch(`${getApiBaseUrl()}/eventos?ticket=${encodeURIComponent(ticket)}${tid ? `&totem=${encodeURIComponent(tid)}` : ""}`, {
          headers: { Accept: "text/event-stream" },
          cache: "no-store",
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) throw new Error(`SSE ${res.status}`);

        tentativa = 0;
        onEstado("conectado");
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value.replace(/\r\n/g, "\n");
          let i: number;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const bloco = buf.slice(0, i);
            buf = buf.slice(i + 2);
            let event = "message";
            const data: string[] = [];
            for (const l of bloco.split("\n")) {
              if (l.startsWith(":") || l.startsWith("retry:")) continue; // heartbeat / retry
              if (l.startsWith("event:")) event = l.slice(6).trim();
              else if (l.startsWith("data:")) data.push(l.slice(5).replace(/^ /, ""));
            }
            if (data.length || event !== "message") onEvento({ event, data: data.join("\n") });
          }
        }
      } catch {
        if (ctrl.signal.aborted) return;
      }
      tentativa++;
      onEstado("reconectando");
      await new Promise((r) => setTimeout(r, Math.min(15_000, 1000 * 2 ** Math.min(tentativa, 4))));
    }
  }

  void ciclo();
  return () => ctrl.abort();
}
