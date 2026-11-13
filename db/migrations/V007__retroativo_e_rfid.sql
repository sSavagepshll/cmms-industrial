-- V007 - Remoção do RFID (crachá descontinuado), Apontamento Retroativo e Soft Delete
-- Depende de V001..V006.
BEGIN;

-- 1) USUARIOS: Remover rfid_tag e suas constraints (ux_usuarios_rfid_tag, ck_usuarios_rfid)
ALTER TABLE usuarios
    DROP COLUMN IF EXISTS rfid_tag;

-- 2) OM_APONTAMENTOS_TEMPO: Origem, exclusão lógica (soft delete) e justificativas
CREATE TYPE apontamento_origem AS ENUM ('CRONOMETRO', 'RETROATIVO');

ALTER TABLE om_apontamentos_tempo
    ADD COLUMN origem apontamento_origem NOT NULL DEFAULT 'CRONOMETRO',
    ADD COLUMN justificativa TEXT,
    ADD COLUMN deletado_em TIMESTAMPTZ,
    ADD COLUMN deletado_por BIGINT REFERENCES usuarios (id) ON DELETE RESTRICT,
    ADD COLUMN motivo_exclusao TEXT;

ALTER TABLE om_apontamentos_tempo
    -- Retroativo exige justificativa
    ADD CONSTRAINT ck_apontamento_justificativa CHECK (
        origem::text <> 'RETROATIVO' OR (justificativa IS NOT NULL AND length(btrim(justificativa)) > 0)
    ),
    -- Exclusão exige motivo e registro do autor
    ADD CONSTRAINT ck_apontamento_exclusao CHECK (
        deletado_em IS NULL OR (
            deletado_por IS NOT NULL AND
            motivo_exclusao IS NOT NULL AND length(btrim(motivo_exclusao)) > 0
        )
    ),
    -- Limite de segurança do banco: máximo de 24h por apontamento
    ADD CONSTRAINT ck_apontamento_duracao CHECK (
        fim IS NULL OR (fim - inicio <= INTERVAL '24 hours')
    );

-- Nota do Dev Back-end: limites de tempo para apontamento retroativo (ex: max 30 dias no passado)
-- devem ser gerenciados pela API (variável de ambiente ou tabela de configs), e não hardcoded no BD.
-- A constraint de exclusão (btree_gist) para evitar sobreposição de horários do mesmo técnico 
-- precisaria da extensão btree_gist habilitada. Será validada primariamente pela API via lock/consulta.

-- 3) Atualizar índices para considerar o Soft Delete
DROP INDEX IF EXISTS ux_apontamentos_aberto_tecnico;
CREATE UNIQUE INDEX ux_apontamentos_aberto_tecnico ON om_apontamentos_tempo (tecnico_id) 
    WHERE fim IS NULL AND deletado_em IS NULL;

DROP INDEX IF EXISTS ix_apontamentos_ordem;
CREATE INDEX ix_apontamentos_ordem ON om_apontamentos_tempo (ordem_id, inicio) 
    WHERE deletado_em IS NULL;

DROP INDEX IF EXISTS ix_apontamentos_tecnico;
CREATE INDEX ix_apontamentos_tecnico ON om_apontamentos_tempo (tecnico_id, inicio) 
    WHERE deletado_em IS NULL;

COMMIT;
