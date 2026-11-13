// Rótulo do tipo de ativo (ficha física: Molde · Máquina · ____). Única fonte do mapeamento (ficha, detalhe, e-mail e front).
const ROTULOS: Record<string, string> = { MOLDE: 'Molde', MAQUINA: 'Máquina', ROBO: 'Robô' };

export function tipoAtivoRotulo(tipo: string | null | undefined, outro: string | null | undefined): string | null {
  if (!tipo) return null;
  if (tipo === 'OUTRO') return outro?.trim() || 'Outro';
  return ROTULOS[tipo] ?? tipo;
}

export type TipoAtivoEnum = 'MOLDE' | 'MAQUINA' | 'ROBO' | 'OUTRO';

/**
 * Fase 30 / US-15 (contrato §3.3): tipo de ativo da OM quando o cliente não o informa (o Totem deixou de perguntar).
 * Pura e sem I/O. O pseudo-ativo predial vence o grupo; `ROBO` nunca é derivado (só se enviado explicitamente).
 * Fase 35: MOLDES e PREDIAL_OUTROS. Grupo ausente/desconhecido (legado) cai em MAQUINA, que é o padrão do backfill (PRODUTIVOS).
 */
export function derivarTipoAtivo(
  equip: { predial: boolean },
  grupoCodigo: string | null | undefined,
): { tipoAtivo: TipoAtivoEnum; tipoAtivoOutro: string | null } {
  if (equip.predial) return { tipoAtivo: 'OUTRO', tipoAtivoOutro: 'Predial' };
  switch (grupoCodigo) {
    case 'MOLDES': return { tipoAtivo: 'MOLDE', tipoAtivoOutro: null };
    case 'PREDIAL_OUTROS': return { tipoAtivo: 'OUTRO', tipoAtivoOutro: 'Outros' }; // o pseudo-ativo predial já saiu acima
    default: return { tipoAtivo: 'MAQUINA', tipoAtivoOutro: null }; // PRODUTIVOS, IMPRODUTIVOS e legado
  }
}
