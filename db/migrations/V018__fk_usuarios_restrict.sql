-- V018 - B-19-01 (defesa em profundidade): FKs de autoria para usuarios passam de ON DELETE SET NULL para RESTRICT,
-- para que nem um DELETE fora da API apague a autoria (auditoria, historico, responsavel, configuracoes).
-- Sem alteracao de dados. Mesmos nomes de constraint. A pre-checagem de referencias do Back-end continua sendo a regra principal.
-- Obs.: o trigger fn_auditoria_imutavel bloqueia UPDATE em auditoria, logo o SET NULL ja faria o DELETE falhar (23514); RESTRICT torna o erro explicito (23503).
BEGIN;

ALTER TABLE ordens_manutencao DROP CONSTRAINT ordens_manutencao_responsavel_id_fkey;
ALTER TABLE ordens_manutencao ADD CONSTRAINT ordens_manutencao_responsavel_id_fkey
    FOREIGN KEY (responsavel_id) REFERENCES usuarios (id) ON DELETE RESTRICT;

ALTER TABLE historico_status_ordem DROP CONSTRAINT historico_status_ordem_usuario_id_fkey;
ALTER TABLE historico_status_ordem ADD CONSTRAINT historico_status_ordem_usuario_id_fkey
    FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE RESTRICT;

ALTER TABLE configuracoes_globais DROP CONSTRAINT configuracoes_globais_atualizado_por_fkey;
ALTER TABLE configuracoes_globais ADD CONSTRAINT configuracoes_globais_atualizado_por_fkey
    FOREIGN KEY (atualizado_por) REFERENCES usuarios (id) ON DELETE RESTRICT;

ALTER TABLE auditoria DROP CONSTRAINT auditoria_ator_id_fkey;
ALTER TABLE auditoria ADD CONSTRAINT auditoria_ator_id_fkey
    FOREIGN KEY (ator_id) REFERENCES usuarios (id) ON DELETE RESTRICT;

ALTER TABLE auditoria DROP CONSTRAINT auditoria_em_nome_de_fkey;
ALTER TABLE auditoria ADD CONSTRAINT auditoria_em_nome_de_fkey
    FOREIGN KEY (em_nome_de) REFERENCES usuarios (id) ON DELETE RESTRICT;

COMMIT;
