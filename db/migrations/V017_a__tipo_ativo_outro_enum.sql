-- V017_a - B-19-05: 3o tipo de ativo customizavel. Adiciona o valor OUTRO ao enum tipo_ativo (ROBO permanece).
-- ATENCAO: sem BEGIN/COMMIT de proposito. Um valor de enum novo nao pode ser usado na transacao que o criou;
-- por isso a coluna + CHECK ficam em V017_b. O runner (migrate.sh) executa via `psql -f` (autocommit): compativel.
ALTER TYPE tipo_ativo ADD VALUE IF NOT EXISTS 'OUTRO';
