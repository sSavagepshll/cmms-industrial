-- V010 - Status Reservada, Motivo de Recusa e Prazos de Fallback
-- Depende de V001..V009
BEGIN;

-- 1) Novo status RESERVADA (após ABERTA e antes de EM_ANDAMENTO)
ALTER TYPE status_ordem ADD VALUE IF NOT EXISTS 'RESERVADA' AFTER 'ABERTA';

-- 2) Adição das colunas de SLA (fallback) e Recusa
ALTER TABLE ordens_manutencao
    ADD COLUMN motivo_recusa TEXT,
    ADD COLUMN prazo_atendimento TIMESTAMPTZ,
    ADD COLUMN prazo_aprovacao TIMESTAMPTZ;

-- Garantir que a recusa exija um motivo (se status volta para ABERTA após estar RESERVADA)
-- Será validado pelo trigger histórico abaixo. Opcionalmente a API fará a validação estrutural.
ALTER TABLE ordens_manutencao
    ADD CONSTRAINT ck_ordens_motivo_recusa CHECK (motivo_recusa IS NULL OR length(btrim(motivo_recusa)) > 0);

-- 3) Atualização do Trigger de Histórico para registrar o motivo da recusa
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
                    WHEN OLD.status::text = 'RESERVADA' AND NEW.status::text = 'ABERTA'
                        THEN NEW.motivo_recusa
                END);
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

COMMIT;
