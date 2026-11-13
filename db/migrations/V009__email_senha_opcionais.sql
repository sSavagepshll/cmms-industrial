-- V009 - E-mail e Senha opcionais para Operadores
-- Depende de V001..V008
BEGIN;

ALTER TABLE usuarios 
    ALTER COLUMN email DROP NOT NULL,
    ALTER COLUMN senha_hash DROP NOT NULL;

COMMIT;
