// Fase 35 (D7): grupos do Totem. `PREDIAL_OUTROS` é reservado: só aceita os dois pseudo-ativos (PREDIAL e OUTROS);
// máquinas regulares nunca entram nele (também garantido por trigger na V026).
export const GRUPOS_TOTEM = ['PRODUTIVOS', 'IMPRODUTIVOS', 'MOLDES', 'PREDIAL_OUTROS'] as const;
export type GrupoTotem = (typeof GRUPOS_TOTEM)[number];
export const GRUPO_RESERVADO: GrupoTotem = 'PREDIAL_OUTROS';
