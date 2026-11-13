-- V013 - Dashboard de desempenho da equipe (Fase 18): chaves de META (VAZIAS, sem valor padrão) e índices de consulta.
-- As metas de atendimento AINDA NÃO foram aprovadas pelo Analista/Gerência: as chaves nascem vazias (NULL) e o endpoint
-- /metricas/meta devolve { configurada: false } enquanto todas as metas de MTTA estiverem vazias. Nenhum dado de exemplo.
-- Para revisão do DBA (índices).
BEGIN;

INSERT INTO configuracoes_globais (chave, valor, tipo, grupo, descricao) VALUES
    ('META_MTTA_MIN_CRITICA', NULL, 'NUMERO', 'METAS', 'Meta de tempo até o atendimento (MTTA) para OM CRITICA, em minutos. Vazio = sem meta.'),
    ('META_MTTA_MIN_ALTA',    NULL, 'NUMERO', 'METAS', 'Meta de tempo até o atendimento (MTTA) para OM ALTA, em minutos. Vazio = sem meta.'),
    ('META_MTTA_MIN_MEDIA',   NULL, 'NUMERO', 'METAS', 'Meta de tempo até o atendimento (MTTA) para OM MEDIA, em minutos. Vazio = sem meta.'),
    ('META_MTTA_MIN_BAIXA',   NULL, 'NUMERO', 'METAS', 'Meta de tempo até o atendimento (MTTA) para OM BAIXA, em minutos. Vazio = sem meta.'),
    ('META_MTTR_MIN',         NULL, 'NUMERO', 'METAS', 'Meta opcional de MTTR (mão de obra), em minutos. Alimenta a linha de referência do gráfico. Vazio = sem meta.')
ON CONFLICT (chave) DO NOTHING;

-- Índices para as consultas do dashboard (período por conclusão/abertura, backlog por status, carga por técnico, transições de status).
CREATE INDEX IF NOT EXISTS ix_ordens_data_conclusao ON ordens_manutencao (data_conclusao) WHERE data_conclusao IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_ordens_data_abertura  ON ordens_manutencao (data_abertura);
CREATE INDEX IF NOT EXISTS ix_ordens_status         ON ordens_manutencao (status);
CREATE INDEX IF NOT EXISTS ix_ordens_resp_conclusao ON ordens_manutencao (responsavel_id, data_conclusao) WHERE responsavel_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_historico_status_data ON historico_status_ordem (status_novo, criado_em);

COMMIT;
