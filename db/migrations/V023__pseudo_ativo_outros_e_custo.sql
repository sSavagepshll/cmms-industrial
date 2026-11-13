-- V023 - Fase 31 / US-16: Pseudo-ativo reservado OUTROS para itens nao cadastrados (texto livre no Totem),
-- coluna ordens_manutencao.item_descricao e remocao do DEFAULT de tipo_custo (reversao da D4 da Fase 30).
-- Base: docs/requisitos/US-16-simplificacao-kiosk-migracao-setores-grupos.md e docs/api/contrato-fase31-us16.md (§2 e §4).
BEGIN;

-- 1) Setor tecnico padrao para maquinas criadas por grupo (B3). Nao predial, ativo.
INSERT INTO setores (nome, predial) VALUES ('Geral', FALSE) ON CONFLICT DO NOTHING;

-- 2) Pseudo-ativo reservado para itens nao cadastrados
ALTER TABLE equipamentos ADD COLUMN item_livre BOOLEAN NOT NULL DEFAULT FALSE;
CREATE UNIQUE INDEX ux_equipamentos_item_livre ON equipamentos (item_livre) WHERE item_livre;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM equipamentos WHERE lower(codigo) = 'outros') THEN
    RAISE EXCEPTION 'V023: ja existe equipamento com TAG OUTROS; renomeie-o antes de migrar';
  END IF;
END $$;

-- Realocar maquinas que eventualmente ja estejam no grupo OUTROS (antes de criar o pseudo-ativo e o trigger)
UPDATE equipamentos
   SET grupo_id = (SELECT id FROM grupos_ativos WHERE codigo = 'PRODUTIVOS')
 WHERE grupo_id = (SELECT id FROM grupos_ativos WHERE codigo = 'OUTROS')
   AND NOT item_livre;

INSERT INTO equipamentos (codigo, nome, setor, predial, item_livre, status, grupo_id)
SELECT 'OUTROS', 'Item Não Cadastrado / Outros', 'Geral', FALSE, TRUE, 'ATIVO', g.id
  FROM grupos_ativos g WHERE g.codigo = 'OUTROS';

-- 3) Guarda: pseudo-ativo imutavel (nao exclui, nao troca TAG/grupo/status/flags); grupo OUTROS e exclusivo dele (RN-50).
CREATE FUNCTION fn_equipamentos_outros_guarda() RETURNS trigger AS $$
DECLARE g_outros BIGINT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.item_livre THEN RAISE EXCEPTION 'pseudo-ativo OUTROS nao pode ser excluido' USING ERRCODE='23514'; END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.item_livre AND (
       NEW.item_livre IS DISTINCT FROM OLD.item_livre OR NEW.codigo IS DISTINCT FROM OLD.codigo OR
       NEW.grupo_id  IS DISTINCT FROM OLD.grupo_id  OR NEW.status IS DISTINCT FROM OLD.status OR NEW.predial) THEN
    RAISE EXCEPTION 'pseudo-ativo OUTROS e imutavel' USING ERRCODE='23514';
  END IF;
  SELECT id INTO g_outros FROM grupos_ativos WHERE codigo = 'OUTROS';
  IF NEW.grupo_id = g_outros AND NOT NEW.item_livre THEN
    RAISE EXCEPTION 'o grupo OUTROS e reservado ao pseudo-ativo de itens nao cadastrados' USING ERRCODE='23514';
  END IF;
  IF NEW.item_livre AND NEW.grupo_id IS DISTINCT FROM g_outros THEN
    RAISE EXCEPTION 'pseudo-ativo OUTROS so pertence ao grupo OUTROS' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER trg_equipamentos_outros_guarda BEFORE INSERT OR UPDATE OR DELETE ON equipamentos
  FOR EACH ROW EXECUTE FUNCTION fn_equipamentos_outros_guarda();

-- 4) Coluna de OM: item_descricao (3 a 100 caracteres) e indice para checagem de duplicidade RN-04
ALTER TABLE ordens_manutencao ADD COLUMN item_descricao VARCHAR(100);
ALTER TABLE ordens_manutencao ADD CONSTRAINT ck_ordens_item_descricao
  CHECK (item_descricao IS NULL OR (length(item_descricao) BETWEEN 3 AND 100 AND item_descricao = btrim(item_descricao)));
CREATE INDEX ix_ordens_item_descricao ON ordens_manutencao (lower(item_descricao)) WHERE item_descricao IS NOT NULL;

-- 5) Custo: remove DEFAULT 'INTERNO' (reversao da D4 da Fase 30; RN-52 exige NULL na abertura)
ALTER TABLE ordens_manutencao ALTER COLUMN tipo_custo DROP DEFAULT;

-- 6) Conversao B4: inativar maquinas ATIVAS de setor inativo (preserva status escondido pelo admin)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN 
    SELECT e.id, e.codigo, s.nome AS setor_nome
      FROM equipamentos e
      JOIN setores s ON s.id = e.setor_id
     WHERE s.ativo = FALSE AND e.status = 'ATIVO'
  LOOP
    RAISE NOTICE 'V023: Inativando equipamento % (%) pois o setor % esta inativo', r.codigo, r.id, r.setor_nome;
  END LOOP;
END $$;

UPDATE equipamentos e
   SET status = 'INATIVO'
  FROM setores s
 WHERE s.id = e.setor_id
   AND s.ativo = FALSE
   AND e.status = 'ATIVO';

COMMENT ON COLUMN equipamentos.item_livre IS 'Fase 31 / US-16: TRUE = pseudo-ativo reservado OUTROS para abertura de OMs com texto livre (grupo OUTROS).';
COMMENT ON COLUMN ordens_manutencao.item_descricao IS 'Fase 31 / US-16: descricao do item nao cadastrado quando equipamento e o pseudo-ativo OUTROS (3 a 100 chars).';

COMMIT;
