-- V011 - Delegação (quem/quando), aprovação "em nome de", alerta de fallback, auditoria (RN-25) e parâmetros de SLA.
-- Depende de V001..V010 (V010: status RESERVADA, motivo_recusa, prazo_atendimento, prazo_aprovacao).
-- Autor: Back-end (Fase 17). Para revisão do DBA.
BEGIN;

-- 1) Delegação: quem reservou a OM e quando; alerta único de fallback; aprovação em nome do operador.
ALTER TABLE ordens_manutencao
    ADD COLUMN delegado_por         BIGINT      REFERENCES usuarios (id) ON DELETE RESTRICT,
    ADD COLUMN delegado_em          TIMESTAMPTZ,
    ADD COLUMN fallback_alertado_em TIMESTAMPTZ,                       -- evita repetir o alerta da RN-22
    ADD COLUMN aprovado_em_nome_de  BIGINT      REFERENCES usuarios (id) ON DELETE RESTRICT; -- RN-21: líder decide pelo operador

ALTER TABLE ordens_manutencao
    ADD CONSTRAINT ck_ordens_delegacao_par CHECK ((delegado_por IS NULL) = (delegado_em IS NULL)),
    -- Reservada exige técnico reservado e quem delegou; ABERTA nunca tem responsável (RN-23).
    -- (status::text: literais novos de enum não podem ser usados como enum na transação que os criou; aqui é seguro, mas mantém o padrão)
    ADD CONSTRAINT ck_ordens_reservada CHECK (
        status::text <> 'RESERVADA' OR (responsavel_id IS NOT NULL AND delegado_por IS NOT NULL)
    ),
    ADD CONSTRAINT ck_ordens_aberta_sem_responsavel CHECK (
        status::text <> 'ABERTA' OR responsavel_id IS NULL
    );

CREATE INDEX ix_ordens_reservadas ON ordens_manutencao (responsavel_id) WHERE status = 'RESERVADA';
-- Varredura do fallback (RN-22): urgentes abertas ainda não alertadas.
CREATE INDEX ix_ordens_fallback ON ordens_manutencao (prazo_atendimento)
    WHERE status = 'ABERTA' AND fallback_alertado_em IS NULL;

-- 2) Auditoria (RN-25). Nunca guarda PIN, senha ou valor de segredo: a API só grava metadados em `detalhe`.
CREATE TABLE auditoria (
    id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    criado_em   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    ator_id     BIGINT       REFERENCES usuarios (id) ON DELETE SET NULL,   -- NULL = sistema (ex.: fallback)
    ator_perfil VARCHAR(30),                                                -- perfil no momento da ação
    acao        VARCHAR(50)  NOT NULL,
    alvo_tipo   VARCHAR(30)  NOT NULL,                                      -- USUARIO | OM | PARAMETRO
    alvo_id     VARCHAR(100) NOT NULL,
    em_nome_de  BIGINT       REFERENCES usuarios (id) ON DELETE SET NULL,
    detalhe     JSONB,
    CONSTRAINT ck_auditoria_acao CHECK (length(btrim(acao)) > 0)
);
CREATE INDEX ix_auditoria_data  ON auditoria (criado_em DESC);
CREATE INDEX ix_auditoria_ator  ON auditoria (ator_id, criado_em DESC) WHERE ator_id IS NOT NULL;
CREATE INDEX ix_auditoria_acao  ON auditoria (acao, criado_em DESC);
CREATE INDEX ix_auditoria_alvo  ON auditoria (alvo_tipo, alvo_id);

-- Registro de auditoria é imutável (só INSERT).
CREATE OR REPLACE FUNCTION fn_auditoria_imutavel() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'auditoria é imutável' USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trg_auditoria_imutavel BEFORE UPDATE OR DELETE ON auditoria
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria_imutavel();

-- 3) Parâmetros de SLA (RN-21 e RN-22), editáveis pelo ADMIN. Não sobrescreve valor já ajustado.
INSERT INTO configuracoes_globais (chave, valor, tipo, grupo, descricao) VALUES
    ('OM_FALLBACK_URGENTE_MIN',  '10', 'NUMERO', 'SLA', 'Minutos sem responsável para liberar o pull de OM urgente (máquina parada) a qualquer técnico (RN-22).'),
    ('OM_LIDER_APROVA_APOS_MIN', '30', 'NUMERO', 'SLA', 'Minutos aguardando aprovação após os quais o líder pode decidir no lugar do operador (RN-21).')
ON CONFLICT (chave) DO NOTHING;

COMMIT;
