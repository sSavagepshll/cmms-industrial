-- V024 - Outbox transacional de e-mail (Fase 34 / Ideia 4). Depende de V001..V023.
BEGIN;

CREATE TABLE outbox_email (
    id                   BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    tipo                 TEXT         NOT NULL,
    ordem_id             BIGINT       REFERENCES ordens_manutencao (id) ON DELETE RESTRICT,
    destinatario_email   TEXT         NOT NULL,
    assunto              TEXT         NOT NULL,
    corpo_texto          TEXT         NOT NULL,
    corpo_html           TEXT         NOT NULL,
    chave_dedupe         TEXT,
    status               TEXT         NOT NULL DEFAULT 'PENDENTE',
    tentativas           SMALLINT     NOT NULL DEFAULT 0,
    max_tentativas       SMALLINT     NOT NULL DEFAULT 6,
    proxima_tentativa_em TIMESTAMPTZ  NOT NULL DEFAULT now(),
    bloqueado_por        TEXT,
    bloqueado_ate        TIMESTAMPTZ,
    ultimo_erro          TEXT,
    message_id           TEXT,
    resposta_smtp        TEXT,
    req_id               TEXT,
    enviado_em           TIMESTAMPTZ,
    criado_em            TIMESTAMPTZ  NOT NULL DEFAULT now(),
    atualizado_em        TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT ck_outbox_email_status    CHECK (status IN ('PENDENTE','PROCESSANDO','ENVIADO','MORTO','CANCELADO')),
    CONSTRAINT ck_outbox_email_tipo      CHECK (tipo ~ '^[A-Z_]{3,40}$'),
    -- destinatário/assunto vão em header SMTP: sem CR/LF/controle (header injection) e com limite de tamanho
    CONSTRAINT ck_outbox_email_dest      CHECK (char_length(destinatario_email) BETWEEN 3 AND 254 AND destinatario_email !~ '[[:cntrl:][:space:]]'),
    CONSTRAINT ck_outbox_email_assunto   CHECK (char_length(assunto) BETWEEN 1 AND 200 AND assunto !~ '[[:cntrl:]]'),
    CONSTRAINT ck_outbox_email_corpo     CHECK (char_length(corpo_texto) <= 100000 AND char_length(corpo_html) <= 200000),
    CONSTRAINT ck_outbox_email_tent      CHECK (tentativas >= 0 AND max_tentativas BETWEEN 1 AND 20 AND tentativas <= max_tentativas),
    CONSTRAINT ck_outbox_email_erro      CHECK (ultimo_erro IS NULL OR char_length(ultimo_erro) <= 300),
    CONSTRAINT ck_outbox_email_lease     CHECK ((status = 'PROCESSANDO') = (bloqueado_ate IS NOT NULL AND bloqueado_por IS NOT NULL)),
    CONSTRAINT ck_outbox_email_enviado   CHECK ((status = 'ENVIADO') = (enviado_em IS NOT NULL))
);

-- Fila: só linhas elegíveis (índice pequeno, mesmo com milhões de ENVIADO)
CREATE INDEX ix_outbox_email_fila  ON outbox_email (proxima_tentativa_em, id) WHERE status = 'PENDENTE';
-- Recuperação de lease
CREATE INDEX ix_outbox_email_lease ON outbox_email (bloqueado_ate)            WHERE status = 'PROCESSANDO';
-- Expurgo (terminais) e painel de mortos
CREATE INDEX ix_outbox_email_expurgo ON outbox_email (atualizado_em)          WHERE status IN ('ENVIADO','CANCELADO','MORTO');
CREATE INDEX ix_outbox_email_ordem   ON outbox_email (ordem_id)               WHERE ordem_id IS NOT NULL;
-- Idempotência de produtor
CREATE UNIQUE INDEX ux_outbox_email_dedupe ON outbox_email (chave_dedupe)     WHERE chave_dedupe IS NOT NULL;

-- atualizado_em automático
CREATE OR REPLACE FUNCTION fn_outbox_email_touch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.atualizado_em := now(); RETURN NEW; END $$;

CREATE TRIGGER trg_outbox_email_touch BEFORE UPDATE ON outbox_email
    FOR EACH ROW EXECUTE FUNCTION fn_outbox_email_touch();

-- Acordador do worker. Payload constante; entregue só no COMMIT.
CREATE OR REPLACE FUNCTION fn_outbox_email_notify() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_notify('outbox_email_novo', '1'); RETURN NULL; END $$;

CREATE TRIGGER trg_outbox_email_notify_ins AFTER INSERT ON outbox_email
    FOR EACH ROW EXECUTE FUNCTION fn_outbox_email_notify();

CREATE TRIGGER trg_outbox_email_notify_req AFTER UPDATE OF status ON outbox_email
    FOR EACH ROW WHEN (NEW.status = 'PENDENTE' AND OLD.status IN ('MORTO','CANCELADO'))
    EXECUTE FUNCTION fn_outbox_email_notify();

-- Imutabilidade do conteúdo: só o worker/ADMIN mudam o estado; o conteúdo entregue nunca é reescrito
CREATE OR REPLACE FUNCTION fn_outbox_email_imutavel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.destinatario_email IS DISTINCT FROM OLD.destinatario_email
     OR NEW.assunto IS DISTINCT FROM OLD.assunto
     OR NEW.corpo_texto IS DISTINCT FROM OLD.corpo_texto
     OR NEW.corpo_html IS DISTINCT FROM OLD.corpo_html
     OR NEW.tipo IS DISTINCT FROM OLD.tipo
     OR NEW.ordem_id IS DISTINCT FROM OLD.ordem_id THEN
    RAISE EXCEPTION 'outbox_email: conteudo imutavel' USING ERRCODE = '23514';
  END IF;
  -- transições proibidas a partir de estados terminais (exceto reprocesso MORTO/CANCELADO -> PENDENTE)
  IF OLD.status = 'ENVIADO' AND NEW.status <> 'ENVIADO' THEN
    RAISE EXCEPTION 'outbox_email: ENVIADO e terminal' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_outbox_email_imutavel BEFORE UPDATE ON outbox_email
    FOR EACH ROW EXECUTE FUNCTION fn_outbox_email_imutavel();

-- Expurgo (chamado por job de retenção; ver §8). Retorna linhas removidas.
CREATE OR REPLACE FUNCTION fn_outbox_email_expurgar(p_enviado_dias INT DEFAULT 30, p_morto_dias INT DEFAULT 90)
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE n BIGINT;
BEGIN
  DELETE FROM outbox_email
   WHERE (status IN ('ENVIADO','CANCELADO') AND atualizado_em < now() - make_interval(days => p_enviado_dias))
      OR (status = 'MORTO'                  AND atualizado_em < now() - make_interval(days => p_morto_dias));
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

COMMIT;
