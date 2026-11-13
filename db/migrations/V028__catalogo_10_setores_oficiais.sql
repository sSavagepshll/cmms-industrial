-- V028 - Fase 37 (US-21 / RN-88): Catalogo oficial de 10 setores corporativos.
-- Nao edita migrations antigas (V001..V027 intactas).
-- Reversao: Para desfazer, recriar setores legados a partir de setores_legado_v028 e reapontar equipamentos.setor_id = setor_id_antigo.
BEGIN;

-- 1) Adicao da coluna oficial em setores
ALTER TABLE setores ADD COLUMN IF NOT EXISTS oficial BOOLEAN NOT NULL DEFAULT FALSE;

-- 2) Tabela de auditoria/evidencia do remapeamento
CREATE TABLE IF NOT EXISTS setores_legado_v028 (
  equipamento_id    BIGINT       NOT NULL REFERENCES equipamentos (id) ON DELETE CASCADE,
  setor_id_antigo   BIGINT       NOT NULL,
  setor_nome_antigo VARCHAR(100) NOT NULL,
  setor_id_novo     BIGINT       NOT NULL REFERENCES setores (id),
  migrado_em        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  PRIMARY KEY (equipamento_id)
);

-- 3) Cadastro/atualizacao dos 10 setores oficiais (ordem 1..10, ativo=TRUE, oficial=TRUE, predial=FALSE)
INSERT INTO setores (nome, predial, ativo, oficial, ordem) VALUES
  ('Produção',         FALSE, TRUE, TRUE, 1),
  ('CQ',               FALSE, TRUE, TRUE, 2),
  ('RH',               FALSE, TRUE, TRUE, 3),
  ('Almoxarifado',     FALSE, TRUE, TRUE, 4),
  ('Estoque',          FALSE, TRUE, TRUE, 5),
  ('Escritório Prod.', FALSE, TRUE, TRUE, 6),
  ('Supervisão',       FALSE, TRUE, TRUE, 7),
  ('Recepção',         FALSE, TRUE, TRUE, 8),
  ('Refeitório',       FALSE, TRUE, TRUE, 9),
  ('Ferramentaria',    FALSE, TRUE, TRUE, 10)
ON CONFLICT (lower(nome)) DO UPDATE
  SET oficial = TRUE, ativo = TRUE, ordem = EXCLUDED.ordem, nome = EXCLUDED.nome
  WHERE setores.predial = FALSE;

-- 4) Evidencia e Remapeamento deterministico de equipamentos legados
--    Regra: MOLDES -> Ferramentaria; demais regulares -> Produção; PREDIAL e OUTROS permanecem isolados.
INSERT INTO setores_legado_v028 (equipamento_id, setor_id_antigo, setor_nome_antigo, setor_id_novo)
SELECT e.id, e.setor_id, e.setor, destino.id
  FROM equipamentos e
  JOIN grupos_ativos g ON g.id = e.grupo_id
  JOIN setores atual ON atual.id = e.setor_id AND NOT atual.oficial
  JOIN setores destino ON destino.oficial AND lower(destino.nome) =
       CASE WHEN g.codigo = 'MOLDES' THEN 'ferramentaria' ELSE 'produção' END
 WHERE NOT e.predial AND NOT e.item_livre
ON CONFLICT (equipamento_id) DO NOTHING;

UPDATE equipamentos e
   SET setor_id = l.setor_id_novo
  FROM setores_legado_v028 l
 WHERE l.equipamento_id = e.id
   AND e.setor_id <> l.setor_id_novo;

-- 5) Preservacao de Geral (fora do catalogo e desativado) e Outros (predial)
UPDATE setores SET ativo = FALSE, oficial = FALSE WHERE lower(nome) = 'geral' AND NOT predial;

-- 6) Expurgo de setores legados sem vinculo ativo e desativacao preventiva
DELETE FROM setores s
 WHERE NOT s.oficial AND NOT s.predial
   AND NOT EXISTS (SELECT 1 FROM equipamentos e WHERE e.setor_id = s.id);

UPDATE setores SET ativo = FALSE WHERE NOT oficial AND NOT predial;

-- 7) Indice parcial para consultas rapidas do catalogo oficial ativo
CREATE INDEX IF NOT EXISTS ix_setores_catalogo ON setores (ordem, nome) WHERE oficial AND ativo;

-- 8) Assercoes e pos-condicoes obrigatorias (falha aborta com ROLLBACK total)
DO $$
BEGIN
  IF (SELECT count(*) FROM setores WHERE oficial) <> 10 THEN
    RAISE EXCEPTION 'V028: catálogo oficial deve ter exatamente 10 setores';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM equipamentos e
      JOIN setores s ON s.id = e.setor_id
     WHERE NOT s.oficial AND NOT e.predial AND NOT e.item_livre
  ) THEN
    RAISE EXCEPTION 'V028: equipamento comum fora do catálogo oficial';
  END IF;

  IF (SELECT count(*) FROM setores WHERE predial) <> 1 THEN
    RAISE EXCEPTION 'V028: deve haver exatamente 1 setor predial';
  END IF;
END $$;

COMMENT ON COLUMN setores.oficial IS 'Fase 37: TRUE = setor do catálogo corporativo (selecionável no cadastro de equipamentos).';
COMMENT ON TABLE setores_legado_v028 IS 'Fase 37: evidência do remapeamento de equipamentos para os 10 setores oficiais.';

COMMIT;
