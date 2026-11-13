-- V002 - Correções da Fase 1 (regras do PO)
BEGIN;

-- 1) USUARIOS: Matrícula, PIN e RFID (identificação em totem)
ALTER TABLE usuarios
    ADD COLUMN matricula VARCHAR(30),
    ADD COLUMN pin_hash  VARCHAR(255),   -- PIN armazenado apenas como hash
    ADD COLUMN rfid_tag  VARCHAR(64);

ALTER TABLE usuarios
    ADD CONSTRAINT ux_usuarios_matricula UNIQUE (matricula),
    ADD CONSTRAINT ux_usuarios_rfid_tag  UNIQUE (rfid_tag),
    ADD CONSTRAINT ck_usuarios_matricula CHECK (matricula IS NULL OR length(btrim(matricula)) > 0),
    ADD CONSTRAINT ck_usuarios_rfid      CHECK (rfid_tag  IS NULL OR length(btrim(rfid_tag))  > 0);

-- 2) ORDENS_MANUTENCAO: origem (totem), categoria, sintomas e número formatado
ALTER TABLE ordens_manutencao
    ADD COLUMN totem_id_origem   VARCHAR(50),                         -- NULL = aberta fora de totem
    ADD COLUMN categoria         VARCHAR(50) NOT NULL DEFAULT 'OUTROS',
    ADD COLUMN sintomas          TEXT,
    ADD COLUMN numero_formatado  VARCHAR(30);

ALTER TABLE ordens_manutencao
    ADD CONSTRAINT ck_ordens_categoria CHECK (length(btrim(categoria)) > 0);

-- Backfill das ordens existentes: OM-AAAA-000001
UPDATE ordens_manutencao
   SET numero_formatado = 'OM-' || to_char(data_abertura, 'YYYY') || '-' || lpad(id::text, 6, '0')
 WHERE numero_formatado IS NULL;

ALTER TABLE ordens_manutencao
    ALTER COLUMN numero_formatado SET NOT NULL,
    ADD CONSTRAINT ux_ordens_numero_formatado UNIQUE (numero_formatado);

-- Novas ordens: o id identity já existe quando o BEFORE INSERT executa
CREATE OR REPLACE FUNCTION fn_set_numero_formatado() RETURNS trigger AS $$
BEGIN
    IF NEW.numero_formatado IS NULL THEN
        NEW.numero_formatado := 'OM-' || to_char(NEW.data_abertura, 'YYYY') || '-' || lpad(NEW.id::text, 6, '0');
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ordens_numero_formatado
    BEFORE INSERT ON ordens_manutencao
    FOR EACH ROW EXECUTE FUNCTION fn_set_numero_formatado();

CREATE INDEX ix_ordens_totem     ON ordens_manutencao (totem_id_origem) WHERE totem_id_origem IS NOT NULL;
CREATE INDEX ix_ordens_categoria ON ordens_manutencao (categoria);

-- 3) EQUIPAMENTOS: Setor
ALTER TABLE equipamentos ADD COLUMN setor VARCHAR(100);

UPDATE equipamentos SET setor = COALESCE(NULLIF(btrim(localizacao), ''), 'NAO_INFORMADO') WHERE setor IS NULL;

ALTER TABLE equipamentos
    ALTER COLUMN setor SET NOT NULL,
    ADD CONSTRAINT ck_equipamentos_setor CHECK (length(btrim(setor)) > 0);

CREATE INDEX ix_equipamentos_setor ON equipamentos (setor);

COMMIT;
