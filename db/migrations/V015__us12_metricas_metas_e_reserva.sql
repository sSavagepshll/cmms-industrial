-- V015 - US-12 (Dashboard Executivo, aprovada pelo Analista/PO em 09/10/2026):
--   1) valores APROVADOS das metas e dos limiares de zona (só preenche quem ainda está vazio: não sobrescreve ajuste do ADMIN);
--   2) parâmetro do prazo de aceite da reserva (US-12 §4: 15 min);
--   3) vw_om_tempos: definição ÚNICA dos tempos da OM (MTTA, MTTR, tempo de parada) conforme a US-12 §2.
-- Para revisão do DBA.
BEGIN;

-- 1) Metas e zonas (US-12 §1, §2, §3)
UPDATE configuracoes_globais SET valor = v.valor
  FROM (VALUES
    ('META_MTTA_MIN_CRITICA', '15'),
    ('META_MTTA_MIN_ALTA',    '30'),
    ('META_MTTA_MIN_MEDIA',   '120'),
    ('META_MTTA_MIN_BAIXA',   '240'),
    ('META_MTTR_MIN',         '60'),
    ('ZONA_META_OK_PCT',      '95'),
    ('ZONA_META_ATENCAO_PCT', '85'),
    ('ZONA_MTTR_ATENCAO_PCT', '120')
  ) AS v (chave, valor)
 WHERE configuracoes_globais.chave = v.chave AND configuracoes_globais.valor IS NULL;

-- 2) Prazo de aceite da reserva (US-12 §4): passado o prazo sem aceite, a reserva expira.
INSERT INTO configuracoes_globais (chave, valor, tipo, grupo, descricao) VALUES
    ('OM_RESERVA_ACEITE_MIN', '15', 'NUMERO', 'SLA', 'Minutos para o técnico aceitar uma OM reservada; passado o prazo a reserva expira e a OM volta à fila (urgentes ficam liberadas ao pull, RN-22).')
ON CONFLICT (chave) DO NOTHING;

-- 3) Tempos da OM (US-12 §2). Uma linha por OM; os campos de conclusão só têm valor em OM concluída.
--   aceite_em     = 1ª entrada em EM_ANDAMENTO (aceite/assunção); sem histórico (legado), usa data_inicio.
--   mtta_segundos = abertura -> aceite.
--   mttr_segundos = aceite -> conclusão técnica (data_conclusao) MENOS o tempo em PAUSADA, AGUARDANDO_PECA e
--                   AGUARDANDO_APROVACAO dentro desse intervalo. O tempo de fila antes do aceite NÃO entra.
--   parada_segundos = abertura -> conclusão (tempo de parada).
CREATE OR REPLACE VIEW vw_om_tempos AS
SELECT o.id AS ordem_id, o.status, o.tipo, o.prioridade, o.categoria, o.equipamento_id, o.responsavel_id, o.data_abertura, o.data_conclusao,
       COALESCE(ac.aceite_em, o.data_inicio) AS aceite_em,
       EXTRACT(EPOCH FROM (COALESCE(ac.aceite_em, o.data_inicio) - o.data_abertura))::float8 AS mtta_segundos,
       EXTRACT(EPOCH FROM (o.data_conclusao - o.data_abertura))::float8                      AS parada_segundos,
       GREATEST(0, EXTRACT(EPOCH FROM (o.data_conclusao - COALESCE(ac.aceite_em, o.data_inicio))) - COALESCE(pa.espera_segundos, 0))::float8 AS mttr_segundos
  FROM ordens_manutencao o
  LEFT JOIN LATERAL (
        SELECT min(h.criado_em) AS aceite_em
          FROM historico_status_ordem h
         WHERE h.ordem_id = o.id AND h.status_novo = 'EM_ANDAMENTO'
  ) ac ON TRUE
  LEFT JOIN LATERAL (
        SELECT sum(GREATEST(0, EXTRACT(EPOCH FROM (
                   LEAST(COALESCE(z.fim, o.data_conclusao), o.data_conclusao) - GREATEST(z.ini, COALESCE(ac.aceite_em, o.data_inicio))
               )))) AS espera_segundos
          FROM (SELECT h.status_novo, h.criado_em AS ini, lead(h.criado_em) OVER (ORDER BY h.criado_em, h.id) AS fim
                  FROM historico_status_ordem h WHERE h.ordem_id = o.id) z
         WHERE z.status_novo IN ('PAUSADA', 'AGUARDANDO_PECA', 'AGUARDANDO_APROVACAO')
  ) pa ON TRUE;

COMMIT;
