-- V026 - Fase 35: Reestruturacao de grupos do Totem:
-- MOLDES_PREDIAL -> MOLDES (exclusivo para moldes)
-- OUTROS -> PREDIAL_OUTROS (grupo reservado aos pseudo-ativos PREDIAL e OUTROS)
-- Base: docs/arch/fase35-arquitetura-emails-pdf-csv.md (§7 e §9.1)
BEGIN;

-- 1) Desabilitar trigger de guarda para permitir atualizacao de codigo e nome dos grupos fixos
ALTER TABLE grupos_ativos DISABLE TRIGGER trg_grupos_ativos_guarda;

-- 2) Remover CHECK inline da V022
ALTER TABLE grupos_ativos DROP CONSTRAINT IF EXISTS grupos_ativos_codigo_check;

-- 3) Renomear grupos e ajustar ordem/rotulos (registrando log de auditoria via NOTICE)
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT codigo, nome FROM grupos_ativos WHERE codigo IN ('MOLDES_PREDIAL', 'OUTROS') LOOP
        RAISE NOTICE 'V026: Renomeando grupo % (nome anterior: %)', r.codigo, r.nome;
    END LOOP;
END $$;

UPDATE grupos_ativos
   SET codigo = 'MOLDES', nome = 'Moldes', ordem = 3
 WHERE codigo = 'MOLDES_PREDIAL';

UPDATE grupos_ativos
   SET codigo = 'PREDIAL_OUTROS', nome = 'Predial e Outros', ordem = 4
 WHERE codigo = 'OUTROS';

-- 4) Recriar CHECK com a nova taxonomia de 4 categorias
ALTER TABLE grupos_ativos ADD CONSTRAINT ck_grupos_ativos_codigo
    CHECK (codigo IN ('PRODUTIVOS', 'IMPRODUTIVOS', 'MOLDES', 'PREDIAL_OUTROS'));

-- 5) Atualizar funcoes de validacao e guarda antes de movimentar equipamentos
CREATE OR REPLACE FUNCTION fn_equipamentos_valida_grupo() RETURNS trigger AS $$
DECLARE
    g_codigo VARCHAR(20);
BEGIN
    IF NEW.grupo_id IS NULL THEN
        IF NEW.predial OR NEW.item_livre THEN
            SELECT id INTO NEW.grupo_id FROM grupos_ativos WHERE codigo = 'PREDIAL_OUTROS';
        ELSE
            SELECT id INTO NEW.grupo_id FROM grupos_ativos WHERE codigo = 'PRODUTIVOS';
        END IF;
    END IF;

    SELECT codigo INTO g_codigo FROM grupos_ativos WHERE id = NEW.grupo_id;
    IF g_codigo IS NULL THEN
        RAISE EXCEPTION 'grupo_ativo nao encontrado' USING ERRCODE = '23503';
    END IF;

    IF NEW.predial AND g_codigo <> 'PREDIAL_OUTROS' THEN
        RAISE EXCEPTION 'equipamento predial so pertence ao grupo PREDIAL_OUTROS' USING ERRCODE = '23514';
    END IF;

    IF NEW.item_livre AND g_codigo <> 'PREDIAL_OUTROS' THEN
        RAISE EXCEPTION 'pseudo-ativo OUTROS so pertence ao grupo PREDIAL_OUTROS' USING ERRCODE = '23514';
    END IF;

    IF NOT NEW.predial AND NOT NEW.item_livre AND g_codigo = 'PREDIAL_OUTROS' THEN
        RAISE EXCEPTION 'grupo PREDIAL_OUTROS e reservado a predial e item livre' USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_equipamentos_grupo ON equipamentos;
CREATE TRIGGER trg_equipamentos_grupo BEFORE INSERT OR UPDATE OF grupo_id, predial, item_livre ON equipamentos
    FOR EACH ROW EXECUTE FUNCTION fn_equipamentos_valida_grupo();

CREATE OR REPLACE FUNCTION fn_equipamentos_outros_guarda() RETURNS trigger AS $$
DECLARE
    g_reservado BIGINT;
BEGIN
    IF TG_OP = 'DELETE' THEN
        IF OLD.item_livre THEN
            RAISE EXCEPTION 'pseudo-ativo OUTROS nao pode ser excluido' USING ERRCODE = '23514';
        END IF;
        RETURN OLD;
    END IF;

    IF TG_OP = 'UPDATE' AND OLD.item_livre AND (
         NEW.item_livre IS DISTINCT FROM OLD.item_livre OR
         NEW.codigo IS DISTINCT FROM OLD.codigo OR
         NEW.grupo_id IS DISTINCT FROM OLD.grupo_id OR
         NEW.status IS DISTINCT FROM OLD.status OR
         NEW.predial) THEN
        RAISE EXCEPTION 'pseudo-ativo OUTROS e imutavel' USING ERRCODE = '23514';
    END IF;

    SELECT id INTO g_reservado FROM grupos_ativos WHERE codigo = 'PREDIAL_OUTROS';
    IF NEW.grupo_id = g_reservado AND NOT NEW.item_livre AND NOT NEW.predial THEN
        RAISE EXCEPTION 'o grupo PREDIAL_OUTROS e reservado ao pseudo-ativo de itens nao cadastrados e predial' USING ERRCODE = '23514';
    END IF;
    IF NEW.item_livre AND NEW.grupo_id IS DISTINCT FROM g_reservado THEN
        RAISE EXCEPTION 'pseudo-ativo OUTROS so pertence ao grupo PREDIAL_OUTROS' USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END $$ LANGUAGE plpgsql;

-- 6) Mover pseudo-ativo PREDIAL para o grupo PREDIAL_OUTROS
UPDATE equipamentos
   SET grupo_id = (SELECT id FROM grupos_ativos WHERE codigo = 'PREDIAL_OUTROS')
 WHERE predial;

-- 7) Reabilitar trigger de guarda de grupos_ativos e atualizar comentarios
ALTER TABLE grupos_ativos ENABLE TRIGGER trg_grupos_ativos_guarda;

COMMENT ON TABLE  grupos_ativos         IS 'Fase 35: taxonomia em 4 macro-categorias de ativos para navegacao no Totem (PRODUTIVOS, IMPRODUTIVOS, MOLDES, PREDIAL_OUTROS).';
COMMENT ON COLUMN equipamentos.grupo_id IS 'Fase 35: grupo do Totem (RESTRICT). PREDIAL_OUTROS e reservado a predial e item livre.';

-- 8) Pos-condicoes obrigatorias (assercoes)
DO $$
DECLARE
    v_grupos_count INT;
    v_regulares_reservados INT;
    v_predial_grupo VARCHAR(20);
    v_outros_grupo VARCHAR(20);
    v_sem_grupo INT;
BEGIN
    SELECT count(*) INTO v_grupos_count
      FROM grupos_ativos
     WHERE codigo IN ('PRODUTIVOS', 'IMPRODUTIVOS', 'MOLDES', 'PREDIAL_OUTROS');
    IF v_grupos_count <> 4 THEN
        RAISE EXCEPTION 'V026 pos-condicao falhou: esperado 4 grupos validos, encontrado %', v_grupos_count;
    END IF;

    SELECT count(*) INTO v_regulares_reservados
      FROM equipamentos e
      JOIN grupos_ativos g ON g.id = e.grupo_id
     WHERE g.codigo = 'PREDIAL_OUTROS'
       AND NOT e.predial
       AND NOT e.item_livre;
    IF v_regulares_reservados > 0 THEN
        RAISE EXCEPTION 'V026 pos-condicao falhou: ha % equipamentos regulares em PREDIAL_OUTROS', v_regulares_reservados;
    END IF;

    SELECT g.codigo INTO v_predial_grupo
      FROM equipamentos e
      JOIN grupos_ativos g ON g.id = e.grupo_id
     WHERE e.predial;
    IF v_predial_grupo <> 'PREDIAL_OUTROS' THEN
        RAISE EXCEPTION 'V026 pos-condicao falhou: PREDIAL esta no grupo %, esperado PREDIAL_OUTROS', v_predial_grupo;
    END IF;

    SELECT g.codigo INTO v_outros_grupo
      FROM equipamentos e
      JOIN grupos_ativos g ON g.id = e.grupo_id
     WHERE e.item_livre;
    IF v_outros_grupo <> 'PREDIAL_OUTROS' THEN
        RAISE EXCEPTION 'V026 pos-condicao falhou: OUTROS esta no grupo %, esperado PREDIAL_OUTROS', v_outros_grupo;
    END IF;

    SELECT count(*) INTO v_sem_grupo
      FROM equipamentos
     WHERE grupo_id IS NULL;
    IF v_sem_grupo > 0 THEN
        RAISE EXCEPTION 'V026 pos-condicao falhou: ha % equipamentos sem grupo', v_sem_grupo;
    END IF;
END $$;

COMMIT;
