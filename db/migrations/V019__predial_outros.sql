-- V019 - Fase 20: opcao "Outros" (manutencao predial/geral) na abertura de OM no Totem.
-- Decisao do Arquiteto: equipamento_id segue NOT NULL; usa-se um pseudo-ativo predial (equipamentos.predial = TRUE, codigo 'PREDIAL',
-- setor reservado 'Outros') + local em texto livre na OM (local_descricao). Contrato: docs/api/contrato-fase20-predial-outros.md.
-- vw_om_tempos NAO muda: ja expoe equipamento_id, entao o `escopo` das metricas filtra via JOIN equipamentos (e.predial).
-- Pre-check feito em dev: nenhum equipamento existente usa setor 'Outros' (o CHECK ck_equipamentos_setor_predial nao falha).
BEGIN;

-- 1) Marca de pseudo-ativo predial
ALTER TABLE equipamentos ADD COLUMN predial BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX ix_equipamentos_predial ON equipamentos (predial) WHERE predial;

-- 2) Local livre na OM (ex.: "RH", "Administracao - sala 2"). Obrigatoriedade p/ predial e regra da API (cruza tabelas).
ALTER TABLE ordens_manutencao
    ADD COLUMN local_descricao VARCHAR(100),
    ADD CONSTRAINT ck_ordens_local_descricao CHECK (local_descricao IS NULL OR length(btrim(local_descricao)) > 0);

-- 3) Seed do pseudo-ativo (idempotente). Setor reservado "Outros".
INSERT INTO equipamentos (codigo, nome, descricao, setor, localizacao, status, predial)
VALUES ('PREDIAL', 'Manutenção Predial / Geral', 'Pseudo-ativo para manutenções não-maquinares (predial, elétrica, hidráulica, infraestrutura)', 'Outros', NULL, 'ATIVO', TRUE)
ON CONFLICT (codigo) DO NOTHING;

-- 4) Setor "Outros" so contem pseudo-ativos prediais e vice-versa
ALTER TABLE equipamentos ADD CONSTRAINT ck_equipamentos_setor_predial
    CHECK ((predial AND setor = 'Outros') OR (NOT predial AND lower(btrim(setor)) <> 'outros'));

COMMENT ON COLUMN equipamentos.predial IS 'Fase 20: TRUE = pseudo-ativo de manutencao predial/geral (setor reservado Outros). Protegido: nao desativar/excluir.';
COMMENT ON COLUMN ordens_manutencao.local_descricao IS 'Fase 20: local livre da OM predial (obrigatorio na API se equipamento.predial; NULL nos demais).';

COMMIT;
