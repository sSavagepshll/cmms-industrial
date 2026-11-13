-- V005 - Campos da ficha física de OM: tipo de ativo, custos, NF, testes de qualidade e de produção
-- Depende de V001..V004.
BEGIN;

-- 1) ORDENS_MANUTENCAO
CREATE TYPE tipo_ativo AS ENUM ('MOLDE', 'MAQUINA', 'ROBO');
CREATE TYPE tipo_custo AS ENUM ('INTERNO', 'CLIENTE');

-- Anuláveis: OMs já existentes não possuem essa informação (sem backfill confiável).
-- A obrigatoriedade para novas OMs deve ser validada pela API.
ALTER TABLE ordens_manutencao
    ADD COLUMN tipo_ativo   tipo_ativo,
    ADD COLUMN centro_custo VARCHAR(50),
    ADD COLUMN tipo_custo   tipo_custo,
    ADD CONSTRAINT ck_ordens_centro_custo CHECK (centro_custo IS NULL OR length(btrim(centro_custo)) > 0);

CREATE INDEX ix_ordens_tipo_ativo   ON ordens_manutencao (tipo_ativo)   WHERE tipo_ativo IS NOT NULL;
CREATE INDEX ix_ordens_centro_custo ON ordens_manutencao (centro_custo) WHERE centro_custo IS NOT NULL;

-- 2) OM_MATERIAIS_UTILIZADOS
ALTER TABLE om_materiais_utilizados
    ADD COLUMN flag_interno BOOLEAN     NOT NULL DEFAULT TRUE,   -- TRUE = material do estoque interno
    ADD COLUMN conf_nf      VARCHAR(50),                         -- conferência da NF (nº/ref.) p/ material externo
    ADD CONSTRAINT ck_materiais_conf_nf CHECK (conf_nf IS NULL OR length(btrim(conf_nf)) > 0);

-- 3) OM_TESTES_QUALIDADE
CREATE TABLE om_testes_qualidade (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ordem_id           BIGINT      NOT NULL REFERENCES ordens_manutencao (id) ON DELETE CASCADE,
    teste_sn           BOOLEAN     NOT NULL DEFAULT FALSE,   -- houve teste? (S/N)
    data_hora          TIMESTAMPTZ,                          -- data/hora do teste
    programacao        TEXT,                                 -- programação/parâmetros do teste
    aprovado_sn        BOOLEAN,                              -- NULL = pendente de aprovação
    data_hora_aprov    TIMESTAMPTZ,
    ciente_executante  BOOLEAN     NOT NULL DEFAULT FALSE,   -- executante tomou ciência
    criado_em          TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_tq_aprov_data   CHECK (aprovado_sn IS NULL OR data_hora_aprov IS NOT NULL),
    CONSTRAINT ck_tq_ordem_datas  CHECK (data_hora IS NULL OR data_hora_aprov IS NULL OR data_hora_aprov >= data_hora)
);
CREATE INDEX ix_tq_ordem ON om_testes_qualidade (ordem_id);

-- 4) OM_TESTES_PRODUCAO
CREATE TABLE om_testes_producao (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ordem_id       BIGINT      NOT NULL REFERENCES ordens_manutencao (id) ON DELETE CASCADE,
    recebido       TIMESTAMPTZ,                              -- recebimento pela produção
    inicio         TIMESTAMPTZ,
    final          TIMESTAMPTZ,
    tempo_total    INTERVAL GENERATED ALWAYS AS (final - inicio) STORED,   -- derivado: evita divergência
    devolvido      TIMESTAMPTZ,                              -- devolução à manutenção
    criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_tp_inicio    CHECK (recebido IS NULL OR inicio    IS NULL OR inicio    >= recebido),
    CONSTRAINT ck_tp_final     CHECK (inicio   IS NULL OR final     IS NULL OR final     >= inicio),
    CONSTRAINT ck_tp_devolvido CHECK (final    IS NULL OR devolvido IS NULL OR devolvido >= final)
);
CREATE INDEX ix_tp_ordem ON om_testes_producao (ordem_id);

CREATE TRIGGER trg_tq_upd BEFORE UPDATE ON om_testes_qualidade FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();
CREATE TRIGGER trg_tp_upd BEFORE UPDATE ON om_testes_producao  FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();

COMMIT;
