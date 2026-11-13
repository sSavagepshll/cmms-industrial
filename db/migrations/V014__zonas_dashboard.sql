-- V014 - Limiares das zonas do dashboard executivo (Fase 18). PROPOSTAS do Designer: NÃO aprovadas.
-- As chaves nascem VAZIAS (NULL), sem padrão ativo, no grupo METAS. Enquanto vazias, o endpoint /metricas/meta devolve
-- os limiares como null e o front não pinta zonas. Nenhum dado de exemplo.
BEGIN;

INSERT INTO configuracoes_globais (chave, valor, tipo, grupo, descricao) VALUES
    ('ZONA_META_OK_PCT',       NULL, 'NUMERO', 'METAS', 'Cumprimento da meta de MTTA (%) a partir do qual a zona é OK (verde). Vazio = zonas desligadas.'),
    ('ZONA_META_ATENCAO_PCT',  NULL, 'NUMERO', 'METAS', 'Cumprimento da meta de MTTA (%) a partir do qual a zona é ATENÇÃO (abaixo disso, crítica). Vazio = zonas desligadas.'),
    ('ZONA_MTTR_ATENCAO_PCT',  NULL, 'NUMERO', 'METAS', 'MTTR em % da meta (META_MTTR_MIN): até 100 = OK; até este valor = ATENÇÃO; acima = crítica. Vazio = zonas desligadas.')
ON CONFLICT (chave) DO NOTHING;

COMMIT;
