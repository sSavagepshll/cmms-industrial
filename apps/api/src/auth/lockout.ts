// Bloqueio por conta após falhas consecutivas de PIN (defesa em profundidade além do rate limit por IP,
// que não cobre ataque distribuído contra uma mesma matrícula).
// Armazenamento em memória: válido para instância única. Com múltiplas instâncias, migrar para Redis/tabela.
const MAX_FALHAS = 5;
const BLOQUEIO_MS = 15 * 60 * 1000;
const MAX_ENTRADAS = 10_000;

interface Entrada {
  falhas: number;
  bloqueadoAte: number;
}
const estado = new Map<string, Entrada>();

/** Retorna segundos restantes de bloqueio (0 = liberado). */
export function segundosBloqueado(chave: string): number {
  const e = estado.get(chave);
  if (!e || e.bloqueadoAte <= Date.now()) return 0;
  return Math.ceil((e.bloqueadoAte - Date.now()) / 1000);
}

export function registrarFalha(chave: string): void {
  if (estado.size >= MAX_ENTRADAS) {
    const agora = Date.now();
    for (const [k, v] of estado) if (v.bloqueadoAte <= agora && v.falhas < MAX_FALHAS) estado.delete(k);
    if (estado.size >= MAX_ENTRADAS) return; // evita crescimento ilimitado de memória
  }
  const e = estado.get(chave) ?? { falhas: 0, bloqueadoAte: 0 };
  if (e.bloqueadoAte && e.bloqueadoAte <= Date.now()) e.falhas = 0; // bloqueio expirou
  e.falhas += 1;
  if (e.falhas >= MAX_FALHAS) e.bloqueadoAte = Date.now() + BLOQUEIO_MS;
  estado.set(chave, e);
}

/** Instante em que o bloqueio termina (null = não bloqueado). */
export function bloqueadoAte(chave: string): Date | null {
  const e = estado.get(chave);
  return e && e.bloqueadoAte > Date.now() ? new Date(e.bloqueadoAte) : null;
}

export function limparFalhas(chave: string): void {
  estado.delete(chave);
}
