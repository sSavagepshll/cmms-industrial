-- V020_a - Fase 21: status intermediario AGUARDANDO_BAIXA (aprovado pela producao, aguardando "Concluir OM" do Gestor/Admin).
-- ATENCAO: sem BEGIN/COMMIT de proposito. Valor novo de enum so pode ser usado apos o commit; o uso (CHECK/indice) fica em V020_b.
-- O runner (migrate.sh) executa via `psql -f` (autocommit): compativel (mesmo padrao da V017_a).
ALTER TYPE status_ordem ADD VALUE IF NOT EXISTS 'AGUARDANDO_BAIXA' AFTER 'AGUARDANDO_APROVACAO';
