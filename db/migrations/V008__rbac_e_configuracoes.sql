-- V008 - Novo RBAC (Operador, Líder, Gerente) e Configurações Globais
-- Depende de V001..V007
BEGIN;

-- 1) Atualização do Enum de Perfis (RBAC)
-- Renomear papéis existentes para refletir a nova nomenclatura
ALTER TYPE perfil_usuario RENAME VALUE 'GESTOR' TO 'GERENTE';
ALTER TYPE perfil_usuario RENAME VALUE 'SOLICITANTE' TO 'OPERADOR';

-- Adicionar o novo papel (LIDER_PRODUCAO)
ALTER TYPE perfil_usuario ADD VALUE IF NOT EXISTS 'LIDER_PRODUCAO' AFTER 'OPERADOR';

-- 2) Tabela de Configurações Globais
CREATE TABLE configuracoes_globais (
    chave          VARCHAR(100) PRIMARY KEY,
    valor          TEXT,
    tipo           VARCHAR(20)  NOT NULL DEFAULT 'TEXTO',
    grupo          VARCHAR(50)  NOT NULL DEFAULT 'GERAL',
    descricao      TEXT,
    atualizado_por BIGINT REFERENCES usuarios (id) ON DELETE SET NULL,
    atualizado_em  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ck_configuracao_tipo CHECK (tipo IN ('TEXTO', 'NUMERO', 'BOOLEANO', 'JSON', 'SECRETO'))
);

CREATE TRIGGER trg_config_globais_upd 
    BEFORE UPDATE ON configuracoes_globais 
    FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();

COMMIT;
