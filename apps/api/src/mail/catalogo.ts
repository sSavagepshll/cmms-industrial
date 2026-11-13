// Fase 35 (D1, RN-77/RN-79): catálogo FECHADO dos e-mails vitais. Única fonte da lista; o banco repete a regra (V027).
export const EMAIL_TIPOS_VITAIS = ['OM_ABERTURA', 'OM_FINALIZADA_TECNICO', 'OM_APROVADA_SOLICITANTE', 'OM_CONCLUIDA_GESTOR'] as const;
export type EmailTipoVital = (typeof EMAIL_TIPOS_VITAIS)[number];

export type TipoDocumento = 'FICHA_INICIAL' | 'FICHA_FINAL';

/** RN-79: o PDF da ficha vai exatamente na abertura (inicial) e na conclusão do gestor (final). */
export const ANEXO_POR_TIPO: Readonly<Record<EmailTipoVital, TipoDocumento | null>> = {
  OM_ABERTURA: 'FICHA_INICIAL',
  OM_FINALIZADA_TECNICO: null,
  OM_APROVADA_SOLICITANTE: null,
  OM_CONCLUIDA_GESTOR: 'FICHA_FINAL',
};

export const ehTipoVital = (t: string): t is EmailTipoVital => (EMAIL_TIPOS_VITAIS as readonly string[]).includes(t);

export class EmailTipoNaoPermitido extends Error {
  constructor(tipo: string) {
    super(`tipo de e-mail fora do catálogo vital: ${tipo}`);
    this.name = 'EmailTipoNaoPermitido';
  }
}
