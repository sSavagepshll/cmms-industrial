-- V029 - Fase 39: Sequencias anuais atomicas de numeracao de OMs (OM-AAAA-NNNNNN).
-- Base: docs/arch/fase39-sequencia-anual-om.md e docs/handoff.md
BEGIN;

-- 1) Tabela de controle de sequencias anuais
CREATE TABLE IF NOT EXISTS om_sequencias_anuais (
    ano           INTEGER      PRIMARY KEY,
    ultimo_numero INTEGER      NOT NULL DEFAULT 0,
    criado_em     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    atualizado_em TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ck_om_sequencias_ano CHECK (ano >= 2000 AND ano <= 2100),
    CONSTRAINT ck_om_sequencias_ultimo CHECK (ultimo_numero >= 0)
);

-- 2) Carga inicial baseada no historico de OMs existentes
INSERT INTO om_sequencias_anuais (ano, ultimo_numero, criado_em, atualizado_em)
SELECT
    v_ano,
    COALESCE(MAX(substring(numero_formatado from 9 for 6)::INTEGER), 0),
    now(),
    now()
FROM (
    SELECT
        substring(numero_formatado from 4 for 4)::INTEGER AS v_ano,
        numero_formatado
    FROM ordens_manutencao
    WHERE numero_formatado ~ '^OM-[0-9]{4}-[0-9]{6}$'
) sub
GROUP BY v_ano
ON CONFLICT (ano) DO UPDATE
SET ultimo_numero = GREATEST(om_sequencias_anuais.ultimo_numero, EXCLUDED.ultimo_numero),
    atualizado_em = now();

-- Garante que o ano civil corrente (2026) esteja inicializado mesmo se nao houver OMs
INSERT INTO om_sequencias_anuais (ano, ultimo_numero, criado_em, atualizado_em)
VALUES (2026, 0, now(), now())
ON CONFLICT (ano) DO NOTHING;

-- 3) Funcao atomica de proximo numero da sequencia anual
CREATE OR REPLACE FUNCTION fn_proximo_numero_om(p_ano INTEGER) RETURNS INTEGER AS $$
DECLARE
    v_seq INTEGER;
BEGIN
    IF p_ano IS NULL THEN
        RAISE EXCEPTION 'ano nao pode ser nulo para gerar numero de OM' USING ERRCODE = '23514';
    END IF;

    INSERT INTO om_sequencias_anuais (ano, ultimo_numero, criado_em, atualizado_em)
    VALUES (p_ano, 1, now(), now())
    ON CONFLICT (ano) DO UPDATE
       SET ultimo_numero = om_sequencias_anuais.ultimo_numero + 1,
           atualizado_em = now()
    RETURNING ultimo_numero INTO v_seq;

    RETURN v_seq;
END;
$$ LANGUAGE plpgsql;

-- 4) Atualizacao do trigger para formatar numero com reinicio anual
CREATE OR REPLACE FUNCTION fn_set_numero_formatado() RETURNS trigger AS $$
DECLARE
    v_ano INTEGER;
    v_seq INTEGER;
BEGIN
    IF NEW.numero_formatado IS NULL THEN
        v_ano := EXTRACT(YEAR FROM (COALESCE(NEW.data_abertura, now()) AT TIME ZONE 'America/Sao_Paulo'))::INTEGER;
        v_seq := fn_proximo_numero_om(v_ano);
        NEW.numero_formatado := 'OM-' || v_ano::text || '-' || lpad(v_seq::text, 6, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ordens_numero_formatado ON ordens_manutencao;
CREATE TRIGGER trg_ordens_numero_formatado
    BEFORE INSERT ON ordens_manutencao
    FOR EACH ROW EXECUTE FUNCTION fn_set_numero_formatado();

-- 5) Documentacao e comentarios
COMMENT ON TABLE  om_sequencias_anuais               IS 'Fase 39: controle atomico de sequencias anuais de numeracao de OMs (OM-AAAA-NNNNNN).';
COMMENT ON COLUMN om_sequencias_anuais.ano           IS 'Ano civil de abertura da OM (fuso America/Sao_Paulo).';
COMMENT ON COLUMN om_sequencias_anuais.ultimo_numero IS 'Ultimo sequencial emitido para o respectivo ano civil (reiniciado em 1 a cada novo ano).';

-- 6) Assercoes de integridade pos-migracao
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM om_sequencias_anuais WHERE ano = 2026) THEN
        RAISE EXCEPTION 'V029 pos-condicao falhou: ano 2026 deve estar registrado em om_sequencias_anuais';
    END IF;
END $$;

COMMIT;
