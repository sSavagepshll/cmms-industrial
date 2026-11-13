-- V017_b - B-19-05: texto livre do tipo de ativo quando tipo_ativo = 'OUTRO' (max. 30 chars).
-- Sem backfill (OMs antigas, inclusive ROBO, nao mudam) e sem indice novo. Depende de V017_a (valor OUTRO ja commitado).
BEGIN;

ALTER TABLE ordens_manutencao
    ADD COLUMN tipo_ativo_outro VARCHAR(30),
    ADD CONSTRAINT ck_ordens_tipo_ativo_outro CHECK (
        (tipo_ativo = 'OUTRO' AND tipo_ativo_outro IS NOT NULL AND length(btrim(tipo_ativo_outro)) > 0)
     OR (tipo_ativo IS DISTINCT FROM 'OUTRO' AND tipo_ativo_outro IS NULL));

COMMENT ON COLUMN ordens_manutencao.tipo_ativo_outro IS 'B-19-05: rotulo livre do ativo; obrigatorio se tipo_ativo=OUTRO, NULL nos demais.';

COMMIT;
