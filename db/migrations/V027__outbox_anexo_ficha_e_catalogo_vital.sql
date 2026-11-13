-- V027 - Fase 35: Catalogo vital de e-mails (4 tipos) e tabela outbox_anexo com snapshot JSON da ficha
-- Base: docs/arch/fase35-arquitetura-emails-pdf-csv.md (§2, §3, §9.2)
BEGIN;

-- 1) Backlog descontinuado: cancelar ANTES de criar os CHECKs (API parada na janela de deploy)
UPDATE outbox_email
   SET status = 'CANCELADO', ultimo_erro = 'tipo_descontinuado', bloqueado_por = NULL, bloqueado_ate = NULL
 WHERE status IN ('PENDENTE','PROCESSANDO')
   AND tipo NOT IN ('OM_ABERTURA','OM_FINALIZADA_TECNICO','OM_APROVADA_SOLICITANTE','OM_CONCLUIDA_GESTOR');

-- 2) Snapshot da ficha, compartilhado por todos os destinatarios do evento
CREATE TABLE outbox_anexo (
    id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ordem_id        BIGINT      NOT NULL REFERENCES ordens_manutencao (id) ON DELETE RESTRICT,
    tipo_documento  TEXT        NOT NULL,
    snapshot_versao SMALLINT    NOT NULL DEFAULT 1,
    snapshot        JSONB       NOT NULL,
    criado_em       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_outbox_anexo_tipo    CHECK (tipo_documento IN ('FICHA_INICIAL','FICHA_FINAL')),
    CONSTRAINT ck_outbox_anexo_tamanho CHECK (octet_length(snapshot::text) <= 65536),
    CONSTRAINT ux_outbox_anexo_ordem_tipo UNIQUE (ordem_id, tipo_documento)
);

-- 3) Vinculo e regras de catalogo (NOT VALID: so linhas novas; o passo 1 ja esvaziou as nao terminais)
ALTER TABLE outbox_email ADD COLUMN anexo_id BIGINT REFERENCES outbox_anexo (id) ON DELETE RESTRICT;
CREATE INDEX ix_outbox_email_anexo ON outbox_email (anexo_id) WHERE anexo_id IS NOT NULL;

ALTER TABLE outbox_email ADD CONSTRAINT ck_outbox_email_tipo_vital
    CHECK (tipo IN ('OM_ABERTURA','OM_FINALIZADA_TECNICO','OM_APROVADA_SOLICITANTE','OM_CONCLUIDA_GESTOR')) NOT VALID;
ALTER TABLE outbox_email ADD CONSTRAINT ck_outbox_email_anexo_regra
    CHECK ((tipo IN ('OM_ABERTURA','OM_CONCLUIDA_GESTOR')) = (anexo_id IS NOT NULL)) NOT VALID;

-- 4) fn_outbox_email_imutavel: incluir anexo_id entre os campos imutaveis
CREATE OR REPLACE FUNCTION fn_outbox_email_imutavel() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.destinatario_email IS DISTINCT FROM OLD.destinatario_email
     OR NEW.assunto IS DISTINCT FROM OLD.assunto
     OR NEW.corpo_texto IS DISTINCT FROM OLD.corpo_texto
     OR NEW.corpo_html IS DISTINCT FROM OLD.corpo_html
     OR NEW.tipo IS DISTINCT FROM OLD.tipo
     OR NEW.ordem_id IS DISTINCT FROM OLD.ordem_id
     OR NEW.anexo_id IS DISTINCT FROM OLD.anexo_id THEN
    RAISE EXCEPTION 'outbox_email: conteudo imutavel' USING ERRCODE = '23514';
  END IF;
  -- transições proibidas a partir de estados terminais (exceto reprocesso MORTO/CANCELADO -> PENDENTE)
  IF OLD.status = 'ENVIADO' AND NEW.status <> 'ENVIADO' THEN
    RAISE EXCEPTION 'outbox_email: ENVIADO e terminal' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

-- 5) fn_outbox_email_expurgar: apos o DELETE de outbox_email, remover outbox_anexo sem nenhum outbox_email
CREATE OR REPLACE FUNCTION fn_outbox_email_expurgar(p_enviado_dias INT DEFAULT 30, p_morto_dias INT DEFAULT 90)
RETURNS BIGINT LANGUAGE plpgsql AS $$
DECLARE
    n BIGINT;
BEGIN
    DELETE FROM outbox_email
     WHERE (status IN ('ENVIADO','CANCELADO') AND atualizado_em < now() - make_interval(days => p_enviado_dias))
        OR (status = 'MORTO'                  AND atualizado_em < now() - make_interval(days => p_morto_dias));
    GET DIAGNOSTICS n = ROW_COUNT;

    -- Remove anexos orfaos (nenhum outbox_email aponta para eles e ja passaram do periodo de retencao)
    DELETE FROM outbox_anexo a
     WHERE NOT EXISTS (SELECT 1 FROM outbox_email e WHERE e.anexo_id = a.id)
       AND a.criado_em < now() - make_interval(days => p_enviado_dias);

    RETURN n;
END $$;

COMMENT ON TABLE  outbox_anexo                IS 'Fase 35: snapshots de fichas de OM (inicial/final) compartilhados pelos e-mails do evento.';
COMMENT ON COLUMN outbox_anexo.ordem_id       IS 'OM a que a ficha pertence.';
COMMENT ON COLUMN outbox_anexo.tipo_documento IS 'FICHA_INICIAL (abertura) ou FICHA_FINAL (conclusao pelo gestor).';
COMMENT ON COLUMN outbox_anexo.snapshot       IS 'JSON com dados da OM no momento do evento (max 64KB). Base para geracao do PDF.';
COMMENT ON COLUMN outbox_email.anexo_id       IS 'Fase 35: referencia opcional para anexo em PDF (obrigatorio em OM_ABERTURA e OM_CONCLUIDA_GESTOR).';

-- 6) Pos-condicoes obrigatorias
DO $$
DECLARE
    v_invalid_count INT;
BEGIN
    SELECT count(*) INTO v_invalid_count
      FROM outbox_email
     WHERE status IN ('PENDENTE', 'PROCESSANDO')
       AND tipo NOT IN ('OM_ABERTURA','OM_FINALIZADA_TECNICO','OM_APROVADA_SOLICITANTE','OM_CONCLUIDA_GESTOR');
    IF v_invalid_count > 0 THEN
        RAISE EXCEPTION 'V027 pos-condicao falhou: ha % emails ativos com tipo descontinuado', v_invalid_count;
    END IF;
END $$;

COMMIT;
