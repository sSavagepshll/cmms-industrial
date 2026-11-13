// Fase 32 (US-17, contrato §3.1): política de acesso por portal. Módulo puro, sem HTTP.
// É uma camada de login (UX + defesa em profundidade); a fronteira real de segurança continua sendo o RBAC por rota.
export type Perfil = 'ADMIN' | 'GERENTE' | 'TECNICO' | 'OPERADOR' | 'LIDER_PRODUCAO';
export type Portal = 'TOTEM' | 'TECNICO' | 'PADRAO';

/** TOTEM = há totemId; TECNICO = declarou portal 'TECNICO'; senão PADRAO (ex.: /admin). */
export const portalDe = (totemId: string | undefined, declarado: 'TECNICO' | undefined): Portal =>
  totemId !== undefined ? 'TOTEM' : declarado === 'TECNICO' ? 'TECNICO' : 'PADRAO';

export function perfilPermitido(portal: Portal, perfil: Perfil, totemPermitidos: readonly Perfil[]): boolean {
  if (perfil === 'ADMIN') return true; // RN-54: ADMIN sempre entra
  if (portal === 'TOTEM') return totemPermitidos.includes(perfil);
  if (portal === 'TECNICO') return perfil === 'TECNICO';
  return true; // PADRAO: sem restrição por portal
}

export const ERRO_PORTAL = {
  TOTEM: { error: 'PERFIL_NAO_PERMITIDO_NO_TOTEM', message: 'Acesso restrito. Técnicos de manutenção devem utilizar o portal exclusivo (/tecnico).' },
  TECNICO: { error: 'PERFIL_NAO_PERMITIDO_NO_PORTAL_TECNICO', message: 'Acesso exclusivo para técnicos de manutenção e administradores.' },
} as const;

/** Mensagem do bloqueio no Totem: TECNICO usa o texto da spec; os demais perfis são direcionados ao painel de gestão. */
export const mensagemTotem = (perfil: Perfil): string =>
  perfil === 'TECNICO' ? ERRO_PORTAL.TOTEM.message : 'Acesso restrito. Utilize o painel de gestão (/admin).';
