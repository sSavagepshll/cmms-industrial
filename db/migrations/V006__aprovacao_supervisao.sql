-- V006 - Aprovação de Supervisão: após o técnico finalizar a execução, a OM aguarda a confirmação
-- de um superior (GESTOR/ADMIN). Fluxo:
--   EM_ANDAMENTO/PAUSADA --(técnico conclui)--> AGUARDANDO_APROVACAO
--   AGUARDANDO_APROVACAO --(supervisor aprova)--> CONCLUIDA        (aprovado_por/data_aprovacao)
--   AGUARDANDO_APROVACAO --(supervisor reprova)-> EM_ANDAMENTO     (motivo_reprovacao; data_conclusao zerada)
-- Depende de V001..V005.
--
-- ATENÇÃO (PostgreSQL): o valor novo de ENUM não pode ser usado como literal na mesma transação em que
-- foi criado. Por isso as constraints/trigger abaixo comparam status::text.
BEGIN;

-- 1) Novo status
ALTER TYPE status_ordem ADD VALUE IF NOT EXISTS 'AGUARDANDO_APROVACAO' AFTER 'AGUARDANDO_PECA';

-- 2) Campos da aprovação (anuláveis: OMs CONCLUIDAS antes da V006 não passaram por aprovação)
ALTER TABLE ordens_manutencao
    ADD COLUMN aprovado_por      BIGINT REFERENCES usuarios (id) ON DELETE RESTRICT,
    ADD COLUMN data_aprovacao    TIMESTAMPTZ,
    ADD COLUMN motivo_reprovacao TEXT,
    ADD CONSTRAINT ck_ordens_aprovacao_par CHECK ((aprovado_por IS NULL) = (data_aprovacao IS NULL)),
    ADD CONSTRAINT ck_ordens_aprovacao_data CHECK (data_aprovacao IS NULL OR data_conclusao IS NULL OR data_aprovacao >= data_conclusao),
    ADD CONSTRAINT ck_ordens_motivo_reprovacao CHECK (motivo_reprovacao IS NULL OR length(btrim(motivo_reprovacao)) > 0),
    -- Aguardando aprovação exige execução finalizada (data_conclusao) e ainda sem aprovação registrada.
    ADD CONSTRAINT ck_ordens_aguardando_aprov CHECK (
        status::text <> 'AGUARDANDO_APROVACAO'
        OR (data_conclusao IS NOT NULL AND aprovado_por IS NULL)
    );

CREATE INDEX ix_ordens_aprovado_por ON ordens_manutencao (aprovado_por) WHERE aprovado_por IS NOT NULL;

-- 3) Histórico: registra também o motivo da reprovação (AGUARDANDO_APROVACAO -> EM_ANDAMENTO).
--    ix_ordens_abertas (V004) já usa NOT IN ('CONCLUIDA','CANCELADA'), então inclui o novo status.
CREATE OR REPLACE FUNCTION fn_registrar_historico_status() RETURNS trigger AS $$
DECLARE
    v_usuario BIGINT := NULLIF(current_setting('app.usuario_id', true), '')::BIGINT;
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO historico_status_ordem (ordem_id, status_anterior, status_novo, usuario_id)
        VALUES (NEW.id, NULL, NEW.status, v_usuario);
    ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
        INSERT INTO historico_status_ordem (ordem_id, status_anterior, status_novo, usuario_id, motivo)
        VALUES (NEW.id, OLD.status, NEW.status, v_usuario,
                CASE
                    WHEN NEW.status::text = 'PAUSADA' THEN NEW.motivo_pausa
                    WHEN OLD.status::text = 'AGUARDANDO_APROVACAO' AND NEW.status::text = 'EM_ANDAMENTO'
                        THEN NEW.motivo_reprovacao
                END);
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

COMMIT;
