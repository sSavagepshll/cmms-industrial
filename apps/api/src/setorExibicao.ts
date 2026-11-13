// Fase 35 (§6.2): setor exibido da OM, sempre derivado do equipamento. Função pura única (DTOs, ficha e e-mails).
export interface SetorExibicaoEntrada {
  equipamento: { setor: string; predial?: boolean | null; itemLivre?: boolean | null };
  localDescricao?: string | null;
}

export function setorExibicao({ equipamento, localDescricao }: SetorExibicaoEntrada): string {
  if (equipamento.predial) {
    const local = localDescricao?.trim();
    return local ? `Predial · Local: ${local}` : 'Predial';
  }
  if (equipamento.itemLivre) return 'Item avulso';
  return equipamento.setor;
}
