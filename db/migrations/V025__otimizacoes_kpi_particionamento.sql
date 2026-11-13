-- V025 - Otimizacoes de dados: covering index do historico, colunas materializadas de tempos de OM e particionamento de auditoria (Fase 34). Depende de V001..V024.
BEGIN;

-- 1) Covering index para resolucao rapida de MTTA, MTTR e retrabalho
CREATE INDEX IF NOT EXISTS idx_historico_ordem_cobridor
    ON historico_status_ordem (ordem_id, status_novo)
    INCLUDE (criado_em, id);

-- 2) Colunas materializadas para tempos de atendimento e reparo na tabela ordens_manutencao
ALTER TABLE ordens_manutencao
    ADD COLUMN IF NOT EXISTS tempo_atendimento_seg DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS tempo_reparo_seg DOUBLE PRECISION;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_ordens_tempo_atendimento') THEN
        ALTER TABLE ordens_manutencao
            ADD CONSTRAINT ck_ordens_tempo_atendimento CHECK (tempo_atendimento_seg IS NULL OR tempo_atendimento_seg >= 0);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ck_ordens_tempo_reparo') THEN
        ALTER TABLE ordens_manutencao
            ADD CONSTRAINT ck_ordens_tempo_reparo CHECK (tempo_reparo_seg IS NULL OR tempo_reparo_seg >= 0);
    END IF;
END $$;

-- Backfill historico dos tempos consolidados atraves de vw_om_tempos
UPDATE ordens_manutencao o
   SET tempo_atendimento_seg = v.mtta_segundos,
       tempo_reparo_seg = v.mttr_segundos
  FROM vw_om_tempos v
 WHERE o.id = v.ordem_id
   AND (v.mtta_segundos IS NOT NULL OR v.mttr_segundos IS NOT NULL);

-- Trigger de calculo reativo dos tempos materializados a cada mudanca de status
CREATE OR REPLACE FUNCTION fn_historico_atualizar_tempos_ordem()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    v_data_abertura TIMESTAMPTZ;
    v_data_inicio TIMESTAMPTZ;
    v_data_conclusao TIMESTAMPTZ;
    v_aceite TIMESTAMPTZ;
    v_mtta DOUBLE PRECISION;
    v_mttr DOUBLE PRECISION;
    v_espera NUMERIC;
BEGIN
    SELECT data_abertura, data_inicio, data_conclusao
      INTO v_data_abertura, v_data_inicio, v_data_conclusao
      FROM ordens_manutencao
     WHERE id = NEW.ordem_id;

    -- Ao entrar em EM_ANDAMENTO: calcula MTTA se ainda nao calculado
    IF NEW.status_novo = 'EM_ANDAMENTO' THEN
        SELECT min(criado_em) INTO v_aceite
          FROM historico_status_ordem
         WHERE ordem_id = NEW.ordem_id AND status_novo = 'EM_ANDAMENTO';
        v_aceite := COALESCE(v_aceite, v_data_inicio, NEW.criado_em);

        IF v_data_abertura IS NOT NULL AND v_aceite IS NOT NULL THEN
            v_mtta := GREATEST(0::double precision, EXTRACT(epoch FROM (v_aceite - v_data_abertura))::double precision);
            UPDATE ordens_manutencao
               SET tempo_atendimento_seg = COALESCE(tempo_atendimento_seg, v_mtta)
             WHERE id = NEW.ordem_id AND tempo_atendimento_seg IS NULL;
        END IF;
    END IF;

    -- Ao entrar em AGUARDANDO_BAIXA ou CONCLUIDA: calcula MTTR liquido
    IF NEW.status_novo IN ('AGUARDANDO_BAIXA', 'CONCLUIDA') THEN
        v_data_conclusao := COALESCE(v_data_conclusao, NEW.criado_em);

        SELECT min(criado_em) INTO v_aceite
          FROM historico_status_ordem
         WHERE ordem_id = NEW.ordem_id AND status_novo = 'EM_ANDAMENTO';
        v_aceite := COALESCE(v_aceite, v_data_inicio, v_data_abertura);

        IF v_data_conclusao IS NOT NULL AND v_aceite IS NOT NULL THEN
            SELECT COALESCE(sum(GREATEST(0::numeric, EXTRACT(epoch FROM LEAST(COALESCE(z.fim, v_data_conclusao), v_data_conclusao) - GREATEST(z.ini, v_aceite)))), 0::numeric)
              INTO v_espera
              FROM (
                SELECT status_novo,
                       criado_em AS ini,
                       lead(criado_em) OVER (ORDER BY criado_em, id) AS fim
                  FROM historico_status_ordem
                 WHERE ordem_id = NEW.ordem_id
              ) z
             WHERE z.status_novo IN ('PAUSADA', 'AGUARDANDO_PECA', 'AGUARDANDO_APROVACAO');

            v_mttr := GREATEST(0::double precision, (EXTRACT(epoch FROM (v_data_conclusao - v_aceite)) - COALESCE(v_espera, 0::numeric))::double precision);

            UPDATE ordens_manutencao
               SET tempo_reparo_seg = v_mttr
             WHERE id = NEW.ordem_id;
        END IF;
    END IF;

    -- Ao reprovar (retorno de AGUARDANDO_APROVACAO para EM_ANDAMENTO): limpa tempo de reparo ate nova conclusao
    IF NEW.status_novo = 'EM_ANDAMENTO' AND NEW.status_anterior = 'AGUARDANDO_APROVACAO' THEN
        UPDATE ordens_manutencao
           SET tempo_reparo_seg = NULL
         WHERE id = NEW.ordem_id;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_historico_atualizar_tempos ON historico_status_ordem;
CREATE TRIGGER trg_historico_atualizar_tempos
    AFTER INSERT ON historico_status_ordem
    FOR EACH ROW EXECUTE FUNCTION fn_historico_atualizar_tempos_ordem();

-- Atualizacao transparente da view vw_om_tempos para usufruir dos campos materializados
CREATE OR REPLACE VIEW vw_om_tempos AS
 SELECT o.id AS ordem_id,
    o.status,
    o.tipo,
    o.prioridade,
    o.categoria,
    o.equipamento_id,
    o.responsavel_id,
    o.data_abertura,
    o.data_conclusao,
    COALESCE(ac.aceite_em, o.data_inicio) AS aceite_em,
    EXTRACT(epoch FROM COALESCE(ac.aceite_em, o.data_inicio) - o.data_abertura)::double precision AS mtta_segundos,
    EXTRACT(epoch FROM o.data_conclusao - o.data_abertura)::double precision AS parada_segundos,
    GREATEST(0::numeric, EXTRACT(epoch FROM o.data_conclusao - COALESCE(ac.aceite_em, o.data_inicio)) - COALESCE(pa.espera_segundos, 0::numeric))::double precision AS mttr_segundos
   FROM ordens_manutencao o
     LEFT JOIN LATERAL ( SELECT min(h.criado_em) AS aceite_em
           FROM historico_status_ordem h
          WHERE h.ordem_id = o.id AND h.status_novo = 'EM_ANDAMENTO'::status_ordem) ac ON true
     LEFT JOIN LATERAL ( SELECT sum(GREATEST(0::numeric, EXTRACT(epoch FROM LEAST(COALESCE(z.fim, o.data_conclusao), o.data_conclusao) - GREATEST(z.ini, COALESCE(ac.aceite_em, o.data_inicio))))) AS espera_segundos
           FROM ( SELECT h.status_novo,
                    h.criado_em AS ini,
                    lead(h.criado_em) OVER (ORDER BY h.criado_em, h.id) AS fim
                   FROM historico_status_ordem h
                  WHERE h.ordem_id = o.id) z
          WHERE z.status_novo = ANY (ARRAY['PAUSADA'::status_ordem, 'AGUARDANDO_PECA'::status_ordem, 'AGUARDANDO_APROVACAO'::status_ordem])) pa ON true;

-- 3) Particionamento declarativo da tabela auditoria por data (criado_em)
ALTER TABLE auditoria RENAME TO auditoria_legado;
ALTER INDEX auditoria_pkey RENAME TO auditoria_legado_pkey;
ALTER INDEX ix_auditoria_data RENAME TO ix_auditoria_legado_data;
ALTER INDEX ix_auditoria_acao RENAME TO ix_auditoria_legado_acao;
ALTER INDEX ix_auditoria_alvo RENAME TO ix_auditoria_legado_alvo;
ALTER INDEX IF EXISTS ix_auditoria_ator RENAME TO ix_auditoria_legado_ator;
ALTER TABLE auditoria_legado RENAME CONSTRAINT ck_auditoria_acao TO ck_auditoria_legado_acao;
ALTER TABLE auditoria_legado RENAME CONSTRAINT auditoria_ator_id_fkey TO auditoria_legado_ator_id_fkey;
ALTER TABLE auditoria_legado RENAME CONSTRAINT auditoria_em_nome_de_fkey TO auditoria_legado_em_nome_de_fkey;

CREATE TABLE auditoria (
    id          BIGINT GENERATED ALWAYS AS IDENTITY,
    criado_em   TIMESTAMPTZ NOT NULL DEFAULT now(),
    ator_id     BIGINT,
    ator_perfil VARCHAR(30),
    acao        VARCHAR(50) NOT NULL,
    alvo_tipo   VARCHAR(30) NOT NULL,
    alvo_id     VARCHAR(100) NOT NULL,
    em_nome_de  BIGINT,
    detalhe     JSONB,

    CONSTRAINT auditoria_pkey PRIMARY KEY (id, criado_em),
    CONSTRAINT ck_auditoria_acao CHECK (length(btrim(acao)) > 0),
    CONSTRAINT auditoria_ator_id_fkey FOREIGN KEY (ator_id) REFERENCES usuarios (id) ON DELETE RESTRICT,
    CONSTRAINT auditoria_em_nome_de_fkey FOREIGN KEY (em_nome_de) REFERENCES usuarios (id) ON DELETE RESTRICT
) PARTITION BY RANGE (criado_em);

CREATE TABLE auditoria_y2026 PARTITION OF auditoria
    FOR VALUES FROM ('2026-01-01 00:00:00+00') TO ('2027-01-01 00:00:00+00');

CREATE TABLE auditoria_y2027 PARTITION OF auditoria
    FOR VALUES FROM ('2027-01-01 00:00:00+00') TO ('2028-01-01 00:00:00+00');

CREATE TABLE auditoria_default PARTITION OF auditoria DEFAULT;

CREATE INDEX ix_auditoria_data ON auditoria (criado_em DESC);
CREATE INDEX ix_auditoria_acao ON auditoria (acao, criado_em DESC);
CREATE INDEX ix_auditoria_alvo ON auditoria (alvo_tipo, alvo_id);
CREATE INDEX ix_auditoria_ator ON auditoria (ator_id, criado_em DESC) WHERE ator_id IS NOT NULL;

CREATE TRIGGER trg_auditoria_imutavel
    BEFORE DELETE OR UPDATE ON auditoria
    FOR EACH ROW EXECUTE FUNCTION fn_auditoria_imutavel();

INSERT INTO auditoria (id, criado_em, ator_id, ator_perfil, acao, alvo_tipo, alvo_id, em_nome_de, detalhe)
OVERRIDING SYSTEM VALUE
SELECT id, criado_em, ator_id, ator_perfil, acao, alvo_tipo, alvo_id, em_nome_de, detalhe
  FROM auditoria_legado
 ORDER BY id ASC;

SELECT setval(pg_get_serial_sequence('auditoria', 'id'), COALESCE(max(id), 1)) FROM auditoria;

DROP TABLE auditoria_legado;

COMMIT;
