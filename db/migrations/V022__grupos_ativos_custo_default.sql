-- V022 - Fase 30 / US-15: Taxonomia das 4 macro-categorias de ativos para navegacao no Totem
-- e default de tipo_custo ('INTERNO') em ordens_manutencao.
-- Base: docs/requisitos/US-15-ajustes-formulario-fluxo-abertura.md e docs/api/contrato-fase30-us15.md (§4).
BEGIN;

-- 1) Grupos: conjunto FIXO de 4 (RN-39 "obrigatoriamente 4"); so rotulo/ordem editaveis, codigo imutavel.
CREATE TABLE grupos_ativos (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    codigo        VARCHAR(20)  NOT NULL UNIQUE
                  CHECK (codigo IN ('PRODUTIVOS', 'IMPRODUTIVOS', 'MOLDES_PREDIAL', 'OUTROS')),
    nome          VARCHAR(60)  NOT NULL
                  CHECK (length(nome) BETWEEN 2 AND 60 AND nome = btrim(nome)),
    ordem         INTEGER      NOT NULL DEFAULT 0,
    criado_em     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    atualizado_em TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX ux_grupos_ativos_nome ON grupos_ativos (lower(nome));
CREATE TRIGGER trg_grupos_ativos_upd BEFORE UPDATE ON grupos_ativos FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();

-- Funcao guarda: impede DELETE e alteracao de codigo (conjunto fixo de 4 categorias)
CREATE FUNCTION fn_grupos_ativos_guarda() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'grupos de ativos sao fixos e nao podem ser excluidos' USING ERRCODE = '23514';
    END IF;
    IF NEW.codigo IS DISTINCT FROM OLD.codigo THEN
        RAISE EXCEPTION 'o codigo do grupo de ativos nao pode ser alterado' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_grupos_ativos_guarda BEFORE UPDATE OR DELETE ON grupos_ativos
    FOR EACH ROW EXECUTE FUNCTION fn_grupos_ativos_guarda();

-- Carga inicial das 4 macro-categorias
INSERT INTO grupos_ativos (codigo, nome, ordem) VALUES
    ('PRODUTIVOS', 'Máquinas e Equip. Produtivos', 1),
    ('IMPRODUTIVOS', 'Máquinas e Equip. Improdutivos', 2),
    ('MOLDES_PREDIAL', 'Moldes e Predial', 3),
    ('OUTROS', 'Outros', 4);

-- 2) Vinculo de equipamentos -> grupos_ativos (backfill deterministico, depois NOT NULL). FK RESTRICT (US-15.5 / CA-04).
ALTER TABLE equipamentos ADD COLUMN grupo_id BIGINT REFERENCES grupos_ativos (id) ON DELETE RESTRICT;

UPDATE equipamentos
   SET grupo_id = (SELECT id FROM grupos_ativos WHERE codigo = CASE WHEN predial THEN 'MOLDES_PREDIAL' ELSE 'PRODUTIVOS' END);

ALTER TABLE equipamentos ALTER COLUMN grupo_id SET NOT NULL;
CREATE INDEX ix_equipamentos_grupo_id ON equipamentos (grupo_id);

-- Default para INSERTs legados/seed/testes que nao informam grupo_id: PRODUTIVOS (ou MOLDES_PREDIAL se predial).
-- Invariante: equipamento predial so pertence ao grupo MOLDES_PREDIAL (ERRCODE 23514).
CREATE FUNCTION fn_equipamentos_valida_grupo() RETURNS trigger AS $$
DECLARE
    g_codigo VARCHAR(20);
BEGIN
    IF NEW.grupo_id IS NULL THEN
        IF NEW.predial THEN
            SELECT id INTO NEW.grupo_id FROM grupos_ativos WHERE codigo = 'MOLDES_PREDIAL';
        ELSE
            SELECT id INTO NEW.grupo_id FROM grupos_ativos WHERE codigo = 'PRODUTIVOS';
        END IF;
    END IF;

    SELECT codigo INTO g_codigo FROM grupos_ativos WHERE id = NEW.grupo_id;
    IF g_codigo IS NULL THEN
        RAISE EXCEPTION 'grupo_ativo nao encontrado' USING ERRCODE = '23503';
    END IF;

    IF NEW.predial AND g_codigo <> 'MOLDES_PREDIAL' THEN
        RAISE EXCEPTION 'equipamento predial so pertence ao grupo MOLDES_PREDIAL' USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_equipamentos_grupo BEFORE INSERT OR UPDATE OF grupo_id, predial ON equipamentos
    FOR EACH ROW EXECUTE FUNCTION fn_equipamentos_valida_grupo();

-- 3) Custo default (A4 / CA-06). Sem backfill do historico.
ALTER TABLE ordens_manutencao ALTER COLUMN tipo_custo SET DEFAULT 'INTERNO';

COMMENT ON TABLE  grupos_ativos                IS 'Fase 30 / US-15: taxonomia em 4 macro-categorias de ativos para navegacao no Totem.';
COMMENT ON COLUMN equipamentos.grupo_id        IS 'Fase 30 / US-15: grupo do Totem (RESTRICT). Default automatico via trigger.';
COMMENT ON COLUMN ordens_manutencao.tipo_custo IS 'Fase 30 / US-15: DEFAULT INTERNO para novos registros sem custo informado.';

COMMIT;
