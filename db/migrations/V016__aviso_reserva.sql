-- V016 - Aviso prévio da reserva (US-12 §4, decisão do Analista): aos 10 min sem aceite (faltando 5 para expirar) o técnico
-- e o gerente são avisados. `reserva_aviso_em` garante UM aviso por reserva (vale só se for posterior a `delegado_em`,
-- então uma nova delegação/reatribuição gera novo aviso sem precisar zerar a coluna). Para revisão do DBA.
BEGIN;

ALTER TABLE ordens_manutencao ADD COLUMN reserva_aviso_em TIMESTAMPTZ;

INSERT INTO configuracoes_globais (chave, valor, tipo, grupo, descricao) VALUES
    ('OM_RESERVA_AVISO_MIN', '10', 'NUMERO', 'SLA', 'Minutos após a delegação em que o técnico e o gerente são avisados de que a reserva vai expirar (deve ser menor que o prazo de aceite).')
ON CONFLICT (chave) DO NOTHING;

COMMIT;
