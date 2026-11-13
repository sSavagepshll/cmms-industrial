-- V001 - Tabelas base: usuarios, equipamentos, ordens_manutencao (PostgreSQL 13+)
BEGIN;

-- Tipos enumerados
CREATE TYPE perfil_usuario AS ENUM ('ADMIN', 'GESTOR', 'TECNICO', 'SOLICITANTE');
CREATE TYPE status_equipamento AS ENUM ('ATIVO', 'INATIVO', 'EM_MANUTENCAO', 'DESCARTADO');
CREATE TYPE tipo_manutencao AS ENUM ('PREVENTIVA', 'CORRETIVA', 'PREDITIVA');
CREATE TYPE prioridade_ordem AS ENUM ('BAIXA', 'MEDIA', 'ALTA', 'CRITICA');
CREATE TYPE status_ordem AS ENUM ('ABERTA', 'EM_ANDAMENTO', 'AGUARDANDO_PECA', 'CONCLUIDA', 'CANCELADA');

-- Trigger genérico para atualizar atualizado_em
CREATE OR REPLACE FUNCTION fn_set_atualizado_em() RETURNS trigger AS $$
BEGIN
    NEW.atualizado_em = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- USUARIOS
CREATE TABLE usuarios (
    id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    nome          VARCHAR(150)   NOT NULL,
    email         VARCHAR(254)   NOT NULL,
    senha_hash    VARCHAR(255)   NOT NULL,          -- nunca armazenar senha em texto puro
    perfil        perfil_usuario NOT NULL DEFAULT 'SOLICITANTE',
    ativo         BOOLEAN        NOT NULL DEFAULT TRUE,
    criado_em     TIMESTAMPTZ    NOT NULL DEFAULT now(),
    atualizado_em TIMESTAMPTZ    NOT NULL DEFAULT now(),
    CONSTRAINT ck_usuarios_email CHECK (position('@' in email) > 1)
);
CREATE UNIQUE INDEX ux_usuarios_email ON usuarios (lower(email));

-- EQUIPAMENTOS
CREATE TABLE equipamentos (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    codigo          VARCHAR(50)        NOT NULL,     -- patrimônio / tag
    nome            VARCHAR(150)       NOT NULL,
    descricao       TEXT,
    fabricante      VARCHAR(100),
    modelo          VARCHAR(100),
    numero_serie    VARCHAR(100),
    localizacao     VARCHAR(150),
    data_aquisicao  DATE,
    status          status_equipamento NOT NULL DEFAULT 'ATIVO',
    criado_em       TIMESTAMPTZ        NOT NULL DEFAULT now(),
    atualizado_em   TIMESTAMPTZ        NOT NULL DEFAULT now(),
    CONSTRAINT ux_equipamentos_codigo UNIQUE (codigo),
    CONSTRAINT ck_equipamentos_aquisicao CHECK (data_aquisicao IS NULL OR data_aquisicao <= CURRENT_DATE + 1)
);
CREATE INDEX ix_equipamentos_status ON equipamentos (status);

-- ORDENS_MANUTENCAO
CREATE TABLE ordens_manutencao (
    id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    equipamento_id     BIGINT           NOT NULL REFERENCES equipamentos (id) ON DELETE RESTRICT,
    solicitante_id     BIGINT           NOT NULL REFERENCES usuarios (id)     ON DELETE RESTRICT,
    responsavel_id     BIGINT                    REFERENCES usuarios (id)     ON DELETE SET NULL,
    tipo               tipo_manutencao  NOT NULL DEFAULT 'CORRETIVA',
    prioridade         prioridade_ordem NOT NULL DEFAULT 'MEDIA',
    status             status_ordem     NOT NULL DEFAULT 'ABERTA',
    titulo             VARCHAR(200)     NOT NULL,
    descricao          TEXT,
    solucao            TEXT,
    data_abertura      TIMESTAMPTZ      NOT NULL DEFAULT now(),
    data_prevista      TIMESTAMPTZ,
    data_inicio        TIMESTAMPTZ,
    data_conclusao     TIMESTAMPTZ,
    criado_em          TIMESTAMPTZ      NOT NULL DEFAULT now(),
    atualizado_em      TIMESTAMPTZ      NOT NULL DEFAULT now(),
    CONSTRAINT ck_ordens_datas CHECK (
        (data_inicio    IS NULL OR data_inicio    >= data_abertura) AND
        (data_conclusao IS NULL OR data_conclusao >= COALESCE(data_inicio, data_abertura))
    ),
    CONSTRAINT ck_ordens_conclusao CHECK (status <> 'CONCLUIDA' OR data_conclusao IS NOT NULL)
);
CREATE INDEX ix_ordens_equipamento ON ordens_manutencao (equipamento_id);
CREATE INDEX ix_ordens_solicitante ON ordens_manutencao (solicitante_id);
CREATE INDEX ix_ordens_responsavel ON ordens_manutencao (responsavel_id) WHERE responsavel_id IS NOT NULL;
CREATE INDEX ix_ordens_abertas     ON ordens_manutencao (prioridade, data_abertura)
    WHERE status IN ('ABERTA', 'EM_ANDAMENTO', 'AGUARDANDO_PECA');

-- Triggers de atualizado_em
CREATE TRIGGER trg_usuarios_upd     BEFORE UPDATE ON usuarios          FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();
CREATE TRIGGER trg_equipamentos_upd BEFORE UPDATE ON equipamentos      FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();
CREATE TRIGGER trg_ordens_upd       BEFORE UPDATE ON ordens_manutencao FOR EACH ROW EXECUTE FUNCTION fn_set_atualizado_em();

COMMIT;
