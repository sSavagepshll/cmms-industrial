-- V004 - Status PAUSADA, motivo_pausa e histórico de status (linha do tempo do Kanban)
-- Depende de V001..V003.
--
-- ATENÇÃO (PostgreSQL): um valor novo de ENUM adicionado com ALTER TYPE ... ADD VALUE
-- NÃO pode ser usado como literal na mesma transação em que foi criado. Por isso, nesta
-- migration nada referencia o literal 'PAUSADA' como enum (usa-se status::text e NOT IN
-- sobre valores antigos). Se o runner executar tudo em transação, isso continua válido.
BEGIN;

-- 1) Novo status
ALTER TYPE status_ordem ADD VALUE IF NOT EXISTS 'PAUSADA' AFTER 'EM_ANDAMENTO';

-- 2) Motivo da pausa
ALTER TABLE ordens_manutencao ADD COLUMN motivo_pausa TEXT;

ALTER TABLE ordens_manutencao
    ADD CONSTRAINT ck_ordens_motivo_pausa CHECK (
        status::text <> 'PAUSADA'
        OR (motivo_pausa IS NOT NULL AND length(btrim(motivo_pausa)) > 0)
    );

-- Índice de ordens "em aberto": recriado por exclusão para passar a incluir PAUSADA
-- sem usar o novo literal na mesma transação.
DROP INDEX IF EXISTS ix_ordens_abertas;
CREATE INDEX ix_ordens_abertas ON ordens_manutencao (prioridade, data_abertura)
    WHERE status NOT IN ('CONCLUIDA', 'CANCELADA');

-- 3) Histórico de status (linha do tempo)
CREATE TABLE historico_status_ordem (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ordem_id        BIGINT       NOT NULL REFERENCES ordens_manutencao (id) ON DELETE CASCADE,
    status_anterior status_ordem,                                   -- NULL = criação da OM
    status_novo     status_ordem NOT NULL,
    usuario_id      BIGINT       REFERENCES usuarios (id) ON DELETE SET NULL,  -- NULL = sistema/desconhecido
    motivo          TEXT,
    criado_em       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ck_historico_mudou CHECK (status_anterior IS DISTINCT FROM status_novo)
);
CREATE INDEX ix_historico_ordem   ON historico_status_ordem (ordem_id, criado_em);
CREATE INDEX ix_historico_usuario ON historico_status_ordem (usuario_id) WHERE usuario_id IS NOT NULL;

-- Backfill: um evento inicial por OM existente
INSERT INTO historico_status_ordem (ordem_id, status_anterior, status_novo, criado_em)
SELECT id, NULL, status, data_abertura FROM ordens_manutencao;

-- Registro automático. O usuário é lido de SET LOCAL app.usuario_id = '<id>' (definido pela API
-- na transação); se ausente, fica NULL.
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
                CASE WHEN NEW.status::text = 'PAUSADA' THEN NEW.motivo_pausa END);
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ordens_historico_ins AFTER INSERT ON ordens_manutencao
    FOR EACH ROW EXECUTE FUNCTION fn_registrar_historico_status();
CREATE TRIGGER trg_ordens_historico_upd AFTER UPDATE OF status ON ordens_manutencao
    FOR EACH ROW EXECUTE FUNCTION fn_registrar_historico_status();

COMMIT;
