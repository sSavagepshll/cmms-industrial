-- V012 - Parâmetros do tema do totem (Fase 17 etapa 2). Só parâmetros padrão; nenhum dado de exemplo.
-- Lidos pelo endpoint público GET /config/publica (o totem em repouso não está autenticado).
-- Não sobrescreve valores já ajustados pelo ADMIN.
BEGIN;

INSERT INTO configuracoes_globais (chave, valor, tipo, grupo, descricao) VALUES
    ('TEMA_TOTEM_MODO',          'AUTO',  'TEXTO', 'TEMA', 'Tema do totem: AUTO (segue o sistema), CLARO, ESCURO ou HORARIO (escuro entre início e fim).'),
    ('TEMA_TOTEM_ESCURO_INICIO', '18:00', 'TEXTO', 'TEMA', 'Início do período escuro no modo HORARIO (HH:mm, fuso do servidor).'),
    ('TEMA_TOTEM_ESCURO_FIM',    '06:00', 'TEXTO', 'TEMA', 'Fim do período escuro no modo HORARIO (HH:mm, fuso do servidor).')
ON CONFLICT (chave) DO NOTHING;

COMMIT;
