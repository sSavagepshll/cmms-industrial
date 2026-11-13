-- V020_b - Fase 21: conclusao pelo Gestor/Admin ("Concluir OM"). Depende de V020_a (valor AGUARDANDO_BAIXA ja commitado).
-- Sem backfill e sem alteracao de dados existentes. ck_ordens_aguardando_aprov (V006) continua valido.
-- Rollback: mover para CONCLUIDA qualquer OM em AGUARDANDO_BAIXA, depois remover indices/constraints/colunas (valor de enum nao se remove).
BEGIN;

ALTER TABLE ordens_manutencao
    ADD COLUMN concluido_por BIGINT REFERENCES usuarios (id) ON DELETE RESTRICT,
    ADD COLUMN concluido_em  TIMESTAMPTZ,
    ADD CONSTRAINT ck_ordens_concluido_par  CHECK ((concluido_por IS NULL) = (concluido_em IS NULL)),
    ADD CONSTRAINT ck_ordens_concluido_data CHECK (concluido_em IS NULL OR data_aprovacao IS NULL OR concluido_em >= data_aprovacao),
    -- Aguardando conclusao exige execucao finalizada, aprovacao registrada e ainda sem conclusao do gestor.
    ADD CONSTRAINT ck_ordens_aguardando_baixa CHECK (
        status <> 'AGUARDANDO_BAIXA'
        OR (data_conclusao IS NOT NULL AND aprovado_por IS NOT NULL AND data_aprovacao IS NOT NULL AND concluido_por IS NULL)
    );

CREATE INDEX ix_ordens_concluido_por    ON ordens_manutencao (concluido_por) WHERE concluido_por IS NOT NULL;
-- Fila "Conclusoes pendentes" (mais antigas primeiro)
CREATE INDEX ix_ordens_aguardando_baixa ON ordens_manutencao (data_aprovacao) WHERE status = 'AGUARDANDO_BAIXA';

COMMENT ON COLUMN ordens_manutencao.concluido_por IS 'Fase 21: GESTOR/ADMIN que clicou em Concluir OM (AGUARDANDO_BAIXA -> CONCLUIDA).';
COMMENT ON COLUMN ordens_manutencao.concluido_em  IS 'Fase 21: instante da conclusao pelo gestor.';

COMMIT;
