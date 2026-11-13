-- V003 - Tabelas do técnico: notas, apontamentos de tempo (play/pause) e materiais
-- Depende de V001 (usuarios, ordens_manutencao, fn_set_atualizado_em)
BEGIN;

-- ORDENS_NOTAS: anotações do técnico na OM
CREATE TABLE ordens_notas (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ordem_id      BIGINT      NOT NULL REFERENCES ordens_manutencao (id) ON DELETE CASCADE,
    autor_id      BIGINT      NOT NULL REFERENCES usuarios (id)          ON DELETE RESTRICT,
    nota          TEXT        NOT NULL,
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_ordens_notas_nota CHECK (length(btrim(nota)) > 0)
);
CREATE INDEX ix_ordens_notas_ordem ON ordens_notas (ordem_id, criado_em);
CREATE INDEX ix_ordens_notas_autor ON ordens_notas (autor_id);

-- OM_APONTAMENTOS_TEMPO: cada "play" abre uma linha (fim NULL); o "pause"/stop preenche fim.
-- Tempo total da OM = soma de (fim - inicio) das linhas.
CREATE TABLE om_apontamentos_tempo (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ordem_id      BIGINT      NOT NULL REFERENCES ordens_manutencao (id) ON DELETE CASCADE,
    tecnico_id    BIGINT      NOT NULL REFERENCES usuarios (id)          ON DELETE RESTRICT,
    inicio        TIMESTAMPTZ NOT NULL DEFAULT now(),
    fim           TIMESTAMPTZ,
    criado_em     TIMESTAMPTZ NOT NULL DEFAULT now(),
    atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_apontamentos_periodo CHECK (fim IS NULL OR fim >= inicio)
);
-- Um técnico só pode ter UM cronômetro rodando por vez (evita play duplo / corrida entre requisições)
CREATE UNIQUE INDEX ux_apontamentos_aberto_tecnico ON om_apontamentos_tempo (tecnico_id) WHERE fim IS NULL;
CREATE INDEX ix_apontamentos_ordem   ON om_apontamentos_tempo (ordem_id, inicio);
CREATE INDEX ix_apontamentos_tecnico ON om_apontamentos_tempo (tecnico_id, inicio);

-- OM_MATERIAIS_UTILIZADOS: materiais/peças consumidos na OM
CREATE TABLE om_materiais_utilizados (
    id             BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ordem_id       BIGINT         NOT NULL REFERENCES ordens_manutencao (id) ON DELETE CASCADE,
    registrado_por BIGINT         NOT NULL REFERENCES usuarios (id)          ON DELETE RESTRICT,
    codigo         VARCHAR(50),                         -- código no almoxarifado (opcional)
    descricao      VARCHAR(200)   NOT NULL,
    quantidade     NUMERIC(12,3)  NOT NULL,
    unidade        VARCHAR(10)    NOT NULL DEFAULT 'UN',
    custo_unitario NUMERIC(12,2),                       -- NULL = não informado
    criado_em      TIMESTAMPTZ    NOT NULL DEFAULT now(),
    atualizado_em  TIMESTAMPTZ    NOT NULL DEFAULT now(),
    CONSTRAINT ck_materiais_quantidade CHECK (quantidade > 0),
    CONSTRAINT ck_materiais_custo      CHECK (custo_unitario IS NULL OR custo_unitario >= 0),
    CONSTRAINT ck_materiais_descricao  CHECK (length(btrim(descricao)) > 0)
);
CREATE INDEX ix_materiais_ordem  ON om_materiais_utilizados (ordem_id);
CREATE INDEX ix_materiais_codigo ON om_materiais_utilizados (codigo) WHERE codigo IS NOT NULL;

-- Triggers de atualizado_em
CREATE TRIGGER trg_ordens_notas_upd  BEFORE UPDATE ON ordens_notas            FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();
CREATE TRIGGER trg_apontamentos_upd  BEFORE UPDATE ON om_apontamentos_tempo   FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();
CREATE TRIGGER trg_materiais_upd     BEFORE UPDATE ON om_materiais_utilizados FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();

COMMIT;
