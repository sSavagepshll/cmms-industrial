-- V021 - Fase 22: setores dinamicos, setor predial ('Outros') configuravel e locais padrao.
-- DDL do contrato docs/api/contrato-fase22-setores-e-dashboards.md (secao 2), com UM acrescimo: fn_equipamentos_valida_setor
-- resolve setor_id pelo texto quando o INSERT nao o informa (compatibilidade com SQL direto/testes; a API nunca grava `setor`).
BEGIN;

-- 1) Setores
CREATE TABLE setores (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome          VARCHAR(100) NOT NULL,
    ativo         BOOLEAN      NOT NULL DEFAULT TRUE,
    predial       BOOLEAN      NOT NULL DEFAULT FALSE,   -- TRUE = "Outros" (manutenção predial/geral); único e protegido
    ordem         INTEGER      NOT NULL DEFAULT 0,       -- ordenação na grade do Totem (predial sempre por último, via API)
    criado_em     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    atualizado_em TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ck_setores_nome CHECK (length(nome) BETWEEN 2 AND 100 AND nome = btrim(nome))
);
CREATE UNIQUE INDEX ux_setores_nome    ON setores (lower(nome));
CREATE UNIQUE INDEX ux_setores_predial ON setores (predial) WHERE predial;      -- no máximo um setor predial
CREATE TRIGGER trg_setores_upd BEFORE UPDATE ON setores FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();

-- 2) Carga a partir dos textos existentes. Variações só de caixa/espaços viram UM setor (grafia canônica = a mais frequente/primeira).
INSERT INTO setores (nome, predial)
SELECT DISTINCT ON (lower(btrim(setor))) btrim(setor), (lower(btrim(setor)) = 'outros')
  FROM equipamentos
 ORDER BY lower(btrim(setor)), btrim(setor)
ON CONFLICT DO NOTHING;
-- Garante o setor predial mesmo se não houver equipamento (V019 já criou o pseudo-ativo PREDIAL em 'Outros', então normalmente já existe).
INSERT INTO setores (nome, predial) VALUES ('Outros', TRUE) ON CONFLICT DO NOTHING;

-- 3) Vínculo equipamento -> setor
ALTER TABLE equipamentos ADD COLUMN setor_id BIGINT REFERENCES setores (id) ON DELETE RESTRICT;
UPDATE equipamentos e SET setor_id = s.id FROM setores s WHERE lower(btrim(e.setor)) = lower(s.nome);
ALTER TABLE equipamentos ALTER COLUMN setor_id SET NOT NULL;
CREATE INDEX ix_equipamentos_setor_id ON equipamentos (setor_id);

-- 4) O CHECK da V019 usava o literal 'Outros' (agora renomeável): troca por trigger que também sincroniza o texto.
ALTER TABLE equipamentos DROP CONSTRAINT ck_equipamentos_setor_predial;

CREATE FUNCTION fn_equipamentos_valida_setor() RETURNS trigger AS $$
DECLARE s setores%ROWTYPE;
BEGIN
    -- Compatibilidade (inserts legados/testes que informam so o texto `setor`): resolve o id pelo nome.
    -- Nenhuma rota da API grava `equipamentos.setor`; este ramo so atende SQL direto.
    IF NEW.setor_id IS NULL THEN
        IF NEW.predial THEN
            SELECT id INTO NEW.setor_id FROM setores WHERE predial;
        ELSE
            SELECT id INTO NEW.setor_id FROM setores WHERE NOT predial AND lower(nome) = lower(btrim(NEW.setor));
            IF NEW.setor_id IS NULL THEN
                INSERT INTO setores (nome) VALUES (btrim(NEW.setor)) RETURNING id INTO NEW.setor_id;
            END IF;
        END IF;
    END IF;
    SELECT * INTO s FROM setores WHERE id = NEW.setor_id;
    IF NEW.predial IS DISTINCT FROM s.predial THEN
        RAISE EXCEPTION 'equipamento predial so pertence ao setor predial (e vice-versa)' USING ERRCODE = '23514';
    END IF;
    NEW.setor := s.nome;                                   -- texto derivado (compatibilidade com consultas por nome)
    RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_equipamentos_setor BEFORE INSERT OR UPDATE OF setor_id, predial, setor ON equipamentos
    FOR EACH ROW EXECUTE FUNCTION fn_equipamentos_valida_setor();

-- 5) Renomear setor propaga o texto; setor predial é imutável quanto ao tipo e não pode ser excluído
CREATE FUNCTION fn_setores_guarda() RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.predial THEN RAISE EXCEPTION 'setor predial nao pode ser excluido' USING ERRCODE = '23514'; END IF;
        RETURN OLD;
    END IF;
    IF NEW.predial IS DISTINCT FROM OLD.predial THEN
        RAISE EXCEPTION 'o tipo predial do setor nao pode ser alterado' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_setores_guarda BEFORE UPDATE OR DELETE ON setores FOR EACH ROW EXECUTE FUNCTION fn_setores_guarda();

CREATE FUNCTION fn_setores_propaga_nome() RETURNS trigger AS $$
BEGIN
    UPDATE equipamentos SET setor = NEW.nome WHERE setor_id = NEW.id AND setor IS DISTINCT FROM NEW.nome;
    RETURN NULL;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_setores_nome AFTER UPDATE OF nome ON setores FOR EACH ROW EXECUTE FUNCTION fn_setores_propaga_nome();

-- 6) Locais padrão (somente setor predial)
CREATE TABLE setor_locais (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    setor_id      BIGINT       NOT NULL REFERENCES setores (id) ON DELETE CASCADE,
    nome          VARCHAR(60)  NOT NULL,
    ativo         BOOLEAN      NOT NULL DEFAULT TRUE,
    ordem         INTEGER      NOT NULL DEFAULT 0,
    criado_em     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    atualizado_em TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ck_setor_locais_nome CHECK (length(nome) BETWEEN 1 AND 60 AND nome = btrim(nome))
);
CREATE UNIQUE INDEX ux_setor_locais_nome ON setor_locais (setor_id, lower(nome));
CREATE INDEX ix_setor_locais_setor ON setor_locais (setor_id, ordem);
CREATE TRIGGER trg_setor_locais_upd BEFORE UPDATE ON setor_locais FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();

CREATE FUNCTION fn_setor_locais_so_predial() RETURNS trigger AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM setores WHERE id = NEW.setor_id AND predial) THEN
        RAISE EXCEPTION 'locais padrao so existem no setor predial' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER trg_setor_locais_predial BEFORE INSERT OR UPDATE OF setor_id ON setor_locais
    FOR EACH ROW EXECUTE FUNCTION fn_setor_locais_so_predial();

-- Seed: os 6 atalhos hoje fixos no código do Totem (front: lib/constants.ts LOCAIS_RAPIDOS)
INSERT INTO setor_locais (setor_id, nome, ordem)
SELECT s.id, v.nome, v.ordem FROM setores s,
  (VALUES ('Administração',1),('RH',2),('Refeitório',3),('Recepção',4),('Banheiros',5),('Pátio',6)) AS v(nome, ordem)
 WHERE s.predial
ON CONFLICT DO NOTHING;

COMMENT ON TABLE  setores IS 'Fase 22: cadastro de setores. predial=TRUE e o setor "Outros" (unico, protegido, renomeavel).';
COMMENT ON COLUMN equipamentos.setor IS 'Fase 22: texto DERIVADO de setores.nome (trigger). Nunca gravar direto; use setor_id.';
COMMIT;
