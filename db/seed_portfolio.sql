-- =============================================================================
-- seed_portfolio.sql - Carga Demonstrativa de Portfólio Industrial (Apex Industrial)
-- Banco de Dados: ordens_manutencao (PostgreSQL 16)
-- 100% Idempotente (ON CONFLICT DO NOTHING / WHERE NOT EXISTS)
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. USUÁRIOS FICTÍCIOS
-- -----------------------------------------------------------------------------
-- Autenticação exclusivamente via matrícula + PIN (scrypt '1234', N=32768, r=8, p=1):
--   scrypt$32768$8$1$oZkZoZ9eKm9BPKzELPkhww==$xzpzwXhHfGafQzOep+/qkNc8oop16UdWQOKBdC0CJPE=
-- senha_hash permanece NULL para todos os usuários demo.

INSERT INTO usuarios (nome, email, matricula, pin_hash, senha_hash, perfil, ativo)
VALUES
  ('Carlos Silva', 'operador@apexindustrial.com', '333444',
   'scrypt$32768$8$1$oZkZoZ9eKm9BPKzELPkhww==$xzpzwXhHfGafQzOep+/qkNc8oop16UdWQOKBdC0CJPE=',
   NULL, 'OPERADOR', TRUE),

  ('Marcos Lima', 'lider@apexindustrial.com', '333333',
   'scrypt$32768$8$1$oZkZoZ9eKm9BPKzELPkhww==$xzpzwXhHfGafQzOep+/qkNc8oop16UdWQOKBdC0CJPE=',
   NULL, 'LIDER_PRODUCAO', TRUE),

  ('Lucas Ferreira', 'tecnico@apexindustrial.com', '222222',
   'scrypt$32768$8$1$oZkZoZ9eKm9BPKzELPkhww==$xzpzwXhHfGafQzOep+/qkNc8oop16UdWQOKBdC0CJPE=',
   NULL, 'TECNICO', TRUE),

  ('Roberto Mendes', 'gerente@apexindustrial.com', '111111',
   'scrypt$32768$8$1$oZkZoZ9eKm9BPKzELPkhww==$xzpzwXhHfGafQzOep+/qkNc8oop16UdWQOKBdC0CJPE=',
   NULL, 'GERENTE', TRUE),

  ('Eduardo Martins', 'admin@apexindustrial.com', '999999',
   'scrypt$32768$8$1$oZkZoZ9eKm9BPKzELPkhww==$xzpzwXhHfGafQzOep+/qkNc8oop16UdWQOKBdC0CJPE=',
   NULL, 'ADMIN', TRUE)
ON CONFLICT (matricula) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. MÁQUINAS FICTÍCIAS (8 ATIVOS INDUSTRIAIS)
-- -----------------------------------------------------------------------------
INSERT INTO equipamentos (codigo, nome, descricao, fabricante, modelo, numero_serie, localizacao, setor_id, grupo_id, data_aquisicao, status, predial, item_livre)
VALUES
  ('INJ-01', 'Injetora Romi 220T', 'Injetora hidráulica de ciclo rápido para polímeros técnicos',
   'Romi', 'Primax 220', 'RM-220-4491', 'Galpão Principal - Ala Norte',
   (SELECT id FROM setores WHERE oficial AND lower(nome) = 'produção' LIMIT 1),
   (SELECT id FROM grupos_ativos WHERE codigo = 'PRODUTIVOS' LIMIT 1),
   '2022-03-15', 'ATIVO', FALSE, FALSE),

  ('INJ-02', 'Injetora Romi 350T', 'Injetora hidráulica de médio porte para peças técnicas',
   'Romi', 'Primax 350', 'RM-350-8812', 'Galpão Principal - Ala Norte',
   (SELECT id FROM setores WHERE oficial AND lower(nome) = 'produção' LIMIT 1),
   (SELECT id FROM grupos_ativos WHERE codigo = 'PRODUTIVOS' LIMIT 1),
   '2021-08-10', 'ATIVO', FALSE, FALSE),

  ('INJ-03', 'Injetora Haitian 450T', 'Injetora servo-acionada de alta eficiência energética',
   'Haitian', 'Mars II 450', 'HT-450-1093', 'Galpão Principal - Ala Sul',
   (SELECT id FROM setores WHERE oficial AND lower(nome) = 'produção' LIMIT 1),
   (SELECT id FROM grupos_ativos WHERE codigo = 'PRODUTIVOS' LIMIT 1),
   '2023-01-20', 'ATIVO', FALSE, FALSE),

  ('EXT-01', 'Extrusora Dupla Rosca 75mm', 'Linha de extrusão e granulação de compostos poliméricos',
   'Coperion', 'ZSK-75', 'CP-75-9923', 'Linha de Extrusão 1',
   (SELECT id FROM setores WHERE oficial AND lower(nome) = 'produção' LIMIT 1),
   (SELECT id FROM grupos_ativos WHERE codigo = 'PRODUTIVOS' LIMIT 1),
   '2020-05-18', 'ATIVO', FALSE, FALSE),

  ('EXT-02', 'Extrusora Monorosca 60mm', 'Extrusora para perfis e tubos poliméricos',
   'Wortex', 'Challenger 60', 'WT-60-3341', 'Linha de Extrusão 2',
   (SELECT id FROM setores WHERE oficial AND lower(nome) = 'produção' LIMIT 1),
   (SELECT id FROM grupos_ativos WHERE codigo = 'PRODUTIVOS' LIMIT 1),
   '2021-11-05', 'ATIVO', FALSE, FALSE),

  ('MOL-01', 'Molde Injeção Tampa Flip-Top 28mm', 'Molde 16 cavidades com câmara quente para tampa 28mm',
   'Polimold', 'FT-28-16C', 'ML-28-5521', 'Ferramentaria - Prateleira A3',
   (SELECT id FROM setores WHERE oficial AND lower(nome) = 'ferramentaria' LIMIT 1),
   COALESCE(
     (SELECT id FROM grupos_ativos WHERE codigo = 'MOLDES_PREDIAL' LIMIT 1),
     (SELECT id FROM grupos_ativos WHERE codigo LIKE 'MOLDES%' LIMIT 1)
   ),
   '2022-09-12', 'ATIVO', FALSE, FALSE),

  ('CNC-01', 'Centro de Usinagem CNC D800', 'Centro de usinagem vertical 3 eixos para manutenção de moldes',
   'Romi', 'Discovery D800', 'CNC-D8-7712', 'Ferramentaria - Baia 2',
   (SELECT id FROM setores WHERE oficial AND lower(nome) = 'ferramentaria' LIMIT 1),
   (SELECT id FROM grupos_ativos WHERE codigo = 'PRODUTIVOS' LIMIT 1),
   '2019-07-22', 'ATIVO', FALSE, FALSE),

  ('PRN-01', 'Prensa Hidráulica 100T', 'Prensa de ajuste e fechamento de moldes e matrizes',
   'Schuler', 'H-100 Compact', 'PR-100-2210', 'Estamparia e Ajuste',
   (SELECT id FROM setores WHERE oficial AND lower(nome) = 'produção' LIMIT 1),
   (SELECT id FROM grupos_ativos WHERE codigo = 'PRODUTIVOS' LIMIT 1),
   '2020-02-14', 'ATIVO', FALSE, FALSE)
ON CONFLICT (codigo) DO UPDATE
SET nome = EXCLUDED.nome,
    descricao = EXCLUDED.descricao,
    fabricante = EXCLUDED.fabricante,
    modelo = EXCLUDED.modelo,
    numero_serie = EXCLUDED.numero_serie,
    localizacao = EXCLUDED.localizacao,
    setor_id = EXCLUDED.setor_id,
    grupo_id = EXCLUDED.grupo_id,
    status = EXCLUDED.status,
    atualizado_em = now();

-- -----------------------------------------------------------------------------
-- 3. ORDENS DE MANUTENÇÃO (18 OMs COBRINDO O CICLO COMPLETO DO KANBAN)
-- -----------------------------------------------------------------------------

-- OM-01: CONCLUIDA (Injetora Romi 220T - Vazamento Manifold)
INSERT INTO ordens_manutencao (
  numero_formatado, equipamento_id, solicitante_id, responsavel_id,
  tipo, prioridade, status, titulo, descricao, solucao,
  aprovado_por, data_aprovacao, concluido_por, concluido_em,
  delegado_por, delegado_em, tipo_ativo, categoria, sintomas,
  data_abertura, data_inicio, data_conclusao, tempo_atendimento_seg, tempo_reparo_seg
)
SELECT
  'OM-2026-000001',
  (SELECT id FROM equipamentos WHERE codigo = 'INJ-01'),
  (SELECT id FROM usuarios WHERE matricula = '333444'),
  (SELECT id FROM usuarios WHERE matricula = '222222'),
  'CORRETIVA', 'ALTA', 'CONCLUIDA',
  'Vazamento de óleo no bloco manifold principal',
  'Identificado gotejamento constante de óleo hidráulico próximo às válvulas direcionais de fechamento da máquina.',
  'Substituídos os anéis O-ring das válvulas direcionais e reapertados flanges com torquímetro. Teste de estanqueidade a 160 bar OK.',
  (SELECT id FROM usuarios WHERE matricula = '333333'), now() - INTERVAL '6 days 7 hours',
  (SELECT id FROM usuarios WHERE matricula = '111111'), now() - INTERVAL '6 days 6 hours',
  (SELECT id FROM usuarios WHERE matricula = '333333'), now() - INTERVAL '6 days 13 hours',
  'MAQUINA', 'MECANICA', 'Mancha de óleo hidráulico no piso abaixo do grupo de fechamento',
  now() - INTERVAL '6 days 14 hours',
  now() - INTERVAL '6 days 12 hours',
  now() - INTERVAL '6 days 8 hours',
  7200, 14400
WHERE NOT EXISTS (SELECT 1 FROM ordens_manutencao WHERE numero_formatado = 'OM-2026-000001');

-- OM-02: CONCLUIDA (Extrusora Dupla Rosca 75mm - Preventiva Semanal)
INSERT INTO ordens_manutencao (
  numero_formatado, equipamento_id, solicitante_id, responsavel_id,
  tipo, prioridade, status, titulo, descricao, solucao,
  aprovado_por, data_aprovacao, concluido_por, concluido_em,
  delegado_por, delegado_em, tipo_ativo, categoria, sintomas,
  data_abertura, data_inicio, data_conclusao, tempo_atendimento_seg, tempo_reparo_seg
)
SELECT
  'OM-2026-000002',
  (SELECT id FROM equipamentos WHERE codigo = 'EXT-01'),
  (SELECT id FROM usuarios WHERE matricula = '333444'),
  (SELECT id FROM usuarios WHERE matricula = '222222'),
  'PREVENTIVA', 'MEDIA', 'CONCLUIDA',
  'Manutenção preventiva semanal do acionamento',
  'Revisão periódica do painel elétrico, checagem de aquecimento nos contatores e reaperto de barramentos.',
  'Limpeza dos filtros do painel elétrico, reaperto de bornes do inversor e medição de corrente dos motores dentro da faixa nominal.',
  (SELECT id FROM usuarios WHERE matricula = '333333'), now() - INTERVAL '5 days 20 hours',
  (SELECT id FROM usuarios WHERE matricula = '999999'), now() - INTERVAL '5 days 19 hours',
  (SELECT id FROM usuarios WHERE matricula = '333333'), now() - INTERVAL '6 days 1 hour',
  'MAQUINA', 'ELETRICA', 'Inspeção periódica conforme plano de manutenção PM-EXT-01',
  now() - INTERVAL '6 days 2 hours',
  now() - INTERVAL '6 days',
  now() - INTERVAL '5 days 21 hours',
  7200, 10800
WHERE NOT EXISTS (SELECT 1 FROM ordens_manutencao WHERE numero_formatado = 'OM-2026-000002');

-- OM-03: CONCLUIDA (Molde Flip-Top 28mm - Pino Extrator Quebrado)
INSERT INTO ordens_manutencao (
  numero_formatado, equipamento_id, solicitante_id, responsavel_id,
  tipo, prioridade, status, titulo, descricao, solucao,
  aprovado_por, data_aprovacao, concluido_por, concluido_em,
  delegado_por, delegado_em, tipo_ativo, categoria, sintomas,
  data_abertura, data_inicio, data_conclusao, tempo_atendimento_seg, tempo_reparo_seg
)
SELECT
  'OM-2026-000003',
  (SELECT id FROM equipamentos WHERE codigo = 'MOL-01'),
  (SELECT id FROM usuarios WHERE matricula = '333333'),
  (SELECT id FROM usuarios WHERE matricula = '222222'),
  'CORRETIVA', 'CRITICA', 'CONCLUIDA',
  'Pino extrator quebrado na cavidade 4',
  'Pino extrator rompeu durante a fase de extração no ciclo contínuo. Molde parado para retirada do componente fraturado.',
  'Desmontagem da placa extratora, remoção do pino fraturado, polimento da bucha guia e montagem de novo extrator DIN 1530 H7.',
  (SELECT id FROM usuarios WHERE matricula = '333333'), now() - INTERVAL '5 days 1 hour',
  (SELECT id FROM usuarios WHERE matricula = '111111'), now() - INTERVAL '5 days',
  (SELECT id FROM usuarios WHERE matricula = '333333'), now() - INTERVAL '5 days 7 hours 30 minutes',
  'MOLDE', 'MOLDES', 'Peças saindo presas no molde e rebarba visível na base da tampa',
  now() - INTERVAL '5 days 8 hours',
  now() - INTERVAL '5 days 7 hours',
  now() - INTERVAL '5 days 2 hours',
  3600, 18000
WHERE NOT EXISTS (SELECT 1 FROM ordens_manutencao WHERE numero_formatado = 'OM-2026-000003');

-- OM-04: CONCLUIDA (CNC D800 - Vibração no Fuso Z)
INSERT INTO ordens_manutencao (
  numero_formatado, equipamento_id, solicitante_id, responsavel_id,
  tipo, prioridade, status, titulo, descricao, solucao,
  aprovado_por, data_aprovacao, concluido_por, concluido_em,
  delegado_por, delegado_em, tipo_ativo, categoria, sintomas,
  data_abertura, data_inicio, data_conclusao, tempo_atendimento_seg, tempo_reparo_seg
)
SELECT
  'OM-2026-000004',
  (SELECT id FROM equipamentos WHERE codigo = 'CNC-01'),
  (SELECT id FROM usuarios WHERE matricula = '333333'),
  (SELECT id FROM usuarios WHERE matricula = '222222'),
  'PREDITIVA', 'BAIXA', 'CONCLUIDA',
  'Análise e correção de vibração no fuso do eixo Z',
  'Inspeção do conjunto de rolamentos de alta precisão do fuso após alerta emitido pelo sistema de vibração.',
  'Substituição da graxa de alta rotação dos mancais e balanceamento dinâmico. Níveis normalizados para 0.8 mm/s.',
  (SELECT id FROM usuarios WHERE matricula = '333333'), now() - INTERVAL '4 days 11 hours',
  (SELECT id FROM usuarios WHERE matricula = '111111'), now() - INTERVAL '4 days 10 hours',
  (SELECT id FROM usuarios WHERE matricula = '111111'), now() - INTERVAL '4 days 17 hours',
  'MAQUINA', 'MECANICA', 'Nível de vibração RMS próximo ao limite de alerta no monitoramento preditivo',
  now() - INTERVAL '4 days 18 hours',
  now() - INTERVAL '4 days 16 hours',
  now() - INTERVAL '4 days 12 hours',
  7200, 14400
WHERE NOT EXISTS (SELECT 1 FROM ordens_manutencao WHERE numero_formatado = 'OM-2026-000004');

-- OM-05: AGUARDANDO_BAIXA (Injetora Romi 350T - Resistência do Bico)
INSERT INTO ordens_manutencao (
  numero_formatado, equipamento_id, solicitante_id, responsavel_id,
  tipo, prioridade, status, titulo, descricao, solucao,
  aprovado_por, data_aprovacao, concluido_por, concluido_em,
  delegado_por, delegado_em, tipo_ativo, categoria, sintomas,
  data_abertura, data_inicio, data_conclusao, tempo_atendimento_seg, tempo_reparo_seg
)
SELECT
  'OM-2026-000005',
  (SELECT id FROM equipamentos WHERE codigo = 'INJ-02'),
  (SELECT id FROM usuarios WHERE matricula = '333444'),
  (SELECT id FROM usuarios WHERE matricula = '222222'),
  'CORRETIVA', 'ALTA', 'AGUARDANDO_BAIXA',
  'Falha intermitente na resistência do bico',
  'Resistência coleira apresentando variação brusca de impedância durante a injeção.',
  'Substituição da cinta cerâmica de aquecimento 220V 800W e reaperto dos terminais estanhados.',
  (SELECT id FROM usuarios WHERE matricula = '333333'), now() - INTERVAL '3 days 4 hours',
  NULL, NULL,
  (SELECT id FROM usuarios WHERE matricula = '333333'), now() - INTERVAL '3 days 9 hours',
  'MAQUINA', 'ELETRICA', 'Alarme E-34 (Temperatura do bico fora de tolerância) e queda térmica no dosador',
  now() - INTERVAL '3 days 10 hours',
  now() - INTERVAL '3 days 8 hours',
  now() - INTERVAL '3 days 5 hours',
  7200, 10800
WHERE NOT EXISTS (SELECT 1 FROM ordens_manutencao WHERE numero_formatado = 'OM-2026-000005');

-- OM-06: AGUARDANDO_BAIXA (Prensa Hidráulica 100T - Cortina Ótica)
INSERT INTO ordens_manutencao (
  numero_formatado, equipamento_id, solicitante_id, responsavel_id,
  tipo, prioridade, status, titulo, descricao, solucao,
  aprovado_por, data_aprovacao, concluido_por, concluido_em,
  delegado_por, delegado_em, tipo_ativo, categoria, sintomas,
  data_abertura, data_inicio, data_conclusao, tempo_atendimento_seg, tempo_reparo_seg
)
SELECT
  'OM-2026-000006',
  (SELECT id FROM equipamentos WHERE codigo = 'PRN-01'),
  (SELECT id FROM usuarios WHERE matricula = '333444'),
  (SELECT id FROM usuarios WHERE matricula = '222222'),
  'CORRETIVA', 'MEDIA', 'AGUARDANDO_BAIXA',
  'Alinhamento da cortina ótica de segurança frontal',
  'Sensor de presença categoria 4 desalinhando após golpes contínuos da prensa.',
  'Realinhamento ótico dos suportes dos emissores/receptores e instalação de amortecedores em elastômero.',
  (SELECT id FROM usuarios WHERE matricula = '333333'), now() - INTERVAL '2 days 22 hours',
  NULL, NULL,
  (SELECT id FROM usuarios WHERE matricula = '333333'), now() - INTERVAL '3 days 3 hours',
  'MAQUINA', 'SEGURANCA', 'Cortina de luz desarmando indevidamente com a trepidação do martelo',
  now() - INTERVAL '3 days 4 hours',
  now() - INTERVAL '3 days 2 hours',
  now() - INTERVAL '2 days 23 hours',
  7200, 10800
WHERE NOT EXISTS (SELECT 1 FROM ordens_manutencao WHERE numero_formatado = 'OM-2026-000006');

-- OM-07: AGUARDANDO_APROVACAO (Injetora Haitian 450T - Vedações do Pistão)
INSERT INTO ordens_manutencao (
  numero_formatado, equipamento_id, solicitante_id, responsavel_id,
  tipo, prioridade, status, titulo, descricao, solucao,
  aprovado_por, data_aprovacao, concluido_por, concluido_em,
  delegado_por, delegado_em, tipo_ativo, categoria, sintomas,
  data_abertura, data_inicio, data_conclusao, tempo_atendimento_seg, tempo_reparo_seg
)
SELECT
  'OM-2026-000007',
  (SELECT id FROM equipamentos WHERE codigo = 'INJ-03'),
  (SELECT id FROM usuarios WHERE matricula = '333444'),
  (SELECT id FROM usuarios WHERE matricula = '222222'),
  'CORRETIVA', 'CRITICA', 'AGUARDANDO_APROVACAO',
  'Substituição das vedações do pistão de injeção',
  'Pistão hidráulico com desgaste severo nas gaxetas internas. Máquina parada sem capacidade de injeção uniforme.',
  'Kit de vedação Parker substituído, fluido completado e teste preliminar a vazio OK. Liberado para validação em produção.',
  NULL, NULL,
  NULL, NULL,
  (SELECT id FROM usuarios WHERE matricula = '333333'), now() - INTERVAL '2 days 5 hours',
  'MAQUINA', 'MECANICA', 'Perda gradual de pressão de injeção e refluxo de óleo no cabeçote',
  now() - INTERVAL '2 days 6 hours',
  now() - INTERVAL '2 days 4 hours',
  now() - INTERVAL '2 days',
  7200, 14400
WHERE NOT EXISTS (SELECT 1 FROM ordens_manutencao WHERE numero_formatado = 'OM-2026-000007');

-- OM-08: AGUARDANDO_APROVACAO (Extrusora Monorosca 60mm - Correias)
INSERT INTO ordens_manutencao (
  numero_formatado, equipamento_id, solicitante_id, responsavel_id,
  tipo, prioridade, status, titulo, descricao, solucao,
  aprovado_por, data_aprovacao, concluido_por, concluido_em,
  delegado_por, delegado_em, tipo_ativo, categoria, sintomas,
  data_abertura, data_inicio, data_conclusao, tempo_atendimento_seg, tempo_reparo_seg
)
SELECT
  'OM-2026-000008',
  (SELECT id FROM equipamentos WHERE codigo = 'EXT-02'),
  (SELECT id FROM usuarios WHERE matricula = '333444'),
  (SELECT id FROM usuarios WHERE matricula = '222222'),
  'PREVENTIVA', 'MEDIA', 'AGUARDANDO_APROVACAO',
  'Troca de correias de transmissão do motor',
  'Troca preventiva por fadiga de material das correias de acionamento do redutor da rosca.',
  'Substituído o jogo de 4 correias trapezoidais Gates B-75 e aferida a tensão de montagem com frequencímetro.',
  NULL, NULL,
  NULL, NULL,
  (SELECT id FROM usuarios WHERE matricula = '333333'), now() - INTERVAL '1 day 19 hours',
  'MAQUINA', 'MECANICA', 'Fissuras superficiais e folga excessiva no jogo de correias',
  now() - INTERVAL '1 day 20 hours',
  now() - INTERVAL '1 day 18 hours',
  now() - INTERVAL '1 day 15 hours',
  7200, 10800
WHERE NOT EXISTS (SELECT 1 FROM ordens_manutencao WHERE numero_formatado = 'OM-2026-000008');

-- OM-09: AGUARDANDO_APROVACAO (CNC D800 - Bomba Refrigeração Solúvel)
INSERT INTO ordens_manutencao (
  numero_formatado, equipamento_id, solicitante_id, responsavel_id,
  tipo, prioridade, status, titulo, descricao, solucao,
  aprovado_por, data_aprovacao, concluido_por, concluido_em,
  delegado_por, delegado_em, tipo_ativo, categoria, sintomas,
  data_abertura, data_inicio, data_conclusao, tempo_atendimento_seg, tempo_reparo_seg
)
SELECT
  'OM-2026-000009',
  (SELECT id FROM equipamentos WHERE codigo = 'CNC-01'),
  (SELECT id FROM usuarios WHERE matricula = '333333'),
  (SELECT id FROM usuarios WHERE matricula = '222222'),
  'CORRETIVA', 'MEDIA', 'AGUARDANDO_APROVACAO',
  'Bomba de refrigeração solúvel sem pressão',
  'Bomba centrífuga girando em falso com ruído característico de cavitação e cavaco no filtro de sucção.',
  'Limpeza profunda do reservatório de refrigeração, desobstrução da tubulação e troca do rotor da bomba.',
  NULL, NULL,
  NULL, NULL,
  (SELECT id FROM usuarios WHERE matricula = '111111'), now() - INTERVAL '1 day 13 hours',
  'MAQUINA', 'REFRIGERACAO', 'Vazão insuficiente de fluido solúvel durante a fresagem de postiços',
  now() - INTERVAL '1 day 14 hours',
  now() - INTERVAL '1 day 12 hours',
  now() - INTERVAL '1 day 9 hours',
  7200, 10800
WHERE NOT EXISTS (SELECT 1 FROM ordens_manutencao WHERE numero_formatado = 'OM-2026-000009');

-- OM-10: PAUSADA (Molde Flip-Top 28mm - Folga Coluna Guia)
INSERT INTO ordens_manutencao (
  numero_formatado, equipamento_id, solicitante_id, responsavel_id,
  tipo, prioridade, status, titulo, descricao, solucao, motivo_pausa,
  aprovado_por, data_aprovacao, concluido_por, concluido_em,
  delegado_por, delegado_em, tipo_ativo, categoria, sintomas,
  data_abertura, data_inicio, data_conclusao
)
SELECT
  'OM-2026-000010',
  (SELECT id FROM equipamentos WHERE codigo = 'MOL-01'),
  (SELECT id FROM usuarios WHERE matricula = '333333'),
  (SELECT id FROM usuarios WHERE matricula = '222222'),
  'CORRETIVA', 'ALTA', 'PAUSADA',
  'Folga excessiva na coluna guia do molde',
  'Coluna e bucha guia com desgaste acentuado após 150 mil batidas.',
  NULL,
  'Aguardando têmpera por indução da bucha guia na ferramentaria externa',
  NULL, NULL, NULL, NULL,
  (SELECT id FROM usuarios WHERE matricula = '333333'), now() - INTERVAL '1 day 7 hours',
  'MOLDE', 'MOLDES', 'Desalinhamento entre placa fixa e móvel causando risco de colisão das cavidades',
  now() - INTERVAL '1 day 8 hours',
  now() - INTERVAL '1 day 6 hours',
  NULL
WHERE NOT EXISTS (SELECT 1 FROM ordens_manutencao WHERE numero_formatado = 'OM-2026-000010');

-- OM-11: PAUSADA (Extrusora Dupla Rosca 75mm - Oscilação Térmica Zona 5)
INSERT INTO ordens_manutencao (
  numero_formatado, equipamento_id, solicitante_id, responsavel_id,
  tipo, prioridade, status, titulo, descricao, solucao, motivo_pausa,
  aprovado_por, data_aprovacao, concluido_por, concluido_em,
  delegado_por, delegado_em, tipo_ativo, categoria, sintomas,
  data_abertura, data_inicio, data_conclusao
)
SELECT
  'OM-2026-000011',
  (SELECT id FROM equipamentos WHERE codigo = 'EXT-01'),
  (SELECT id FROM usuarios WHERE matricula = '333444'),
  (SELECT id FROM usuarios WHERE matricula = '222222'),
  'CORRETIVA', 'MEDIA', 'PAUSADA',
  'Oscilação térmica no canhão da zona 5',
  'Sensor de temperatura com sinal intermitente por quebra de fiação interna.',
  NULL,
  'Aguardando chegada de termopar tipo J especial M10 solicitado ao fornecedor',
  NULL, NULL, NULL, NULL,
  (SELECT id FROM usuarios WHERE matricula = '333333'), now() - INTERVAL '19 hours',
  'MAQUINA', 'ELETRICA', 'Variação de temperatura de ±30°C no IHM provocando degradação da resina',
  now() - INTERVAL '20 hours',
  now() - INTERVAL '18 hours',
  NULL
WHERE NOT EXISTS (SELECT 1 FROM ordens_manutencao WHERE numero_formatado = 'OM-2026-000011');

-- OM-12: EM_ANDAMENTO (Injetora Romi 220T - Travamento de Gaveta Lateral - CRONÔMETRO ABERTO)
INSERT INTO ordens_manutencao (
  numero_formatado, equipamento_id, solicitante_id, responsavel_id,
  tipo, prioridade, status, titulo, descricao, solucao, motivo_pausa,
  aprovado_por, data_aprovacao, concluido_por, concluido_em,
  delegado_por, delegado_em, tipo_ativo, categoria, sintomas,
  data_abertura, data_inicio, data_conclusao
)
SELECT
  'OM-2026-000012',
  (SELECT id FROM equipamentos WHERE codigo = 'INJ-01'),
  (SELECT id FROM usuarios WHERE matricula = '333444'),
  (SELECT id FROM usuarios WHERE matricula = '222222'),
  'CORRETIVA', 'CRITICA', 'EM_ANDAMENTO',
  'Travamento da gaveta lateral hidráulica',
  'Gaveta lateral mecânica com dificuldade de deslocamento no curso final.',
  NULL, NULL,
  NULL, NULL, NULL, NULL,
  (SELECT id FROM usuarios WHERE matricula = '333333'), now() - INTERVAL '3 hours',
  'MAQUINA', 'MECANICA', 'Ciclo de injeção interrompido por ausência de sinal de recuo da gaveta',
  now() - INTERVAL '4 hours',
  now() - INTERVAL '2 hours 30 minutes',
  NULL
WHERE NOT EXISTS (SELECT 1 FROM ordens_manutencao WHERE numero_formatado = 'OM-2026-000012');

-- OM-13: EM_ANDAMENTO (Prensa Hidráulica 100T - Revisão NR-12 - Apontamento Pausado/Fechado)
INSERT INTO ordens_manutencao (
  numero_formatado, equipamento_id, solicitante_id, responsavel_id,
  tipo, prioridade, status, titulo, descricao, solucao, motivo_pausa,
  aprovado_por, data_aprovacao, concluido_por, concluido_em,
  delegado_por, delegado_em, tipo_ativo, categoria, sintomas,
  data_abertura, data_inicio, data_conclusao
)
SELECT
  'OM-2026-000013',
  (SELECT id FROM equipamentos WHERE codigo = 'PRN-01'),
  (SELECT id FROM usuarios WHERE matricula = '333444'),
  (SELECT id FROM usuarios WHERE matricula = '222222'),
  'PREVENTIVA', 'MEDIA', 'EM_ANDAMENTO',
  'Revisão semestral do bloco de segurança hidráulico',
  'Verificação de retenção e vedação das válvulas monitoradas de segurança.',
  NULL, NULL,
  NULL, NULL, NULL, NULL,
  (SELECT id FROM usuarios WHERE matricula = '333333'), now() - INTERVAL '6 hours',
  'MAQUINA', 'HIDRAULICA', 'Inspeção preventiva programada conforme requisitos de segurança NR-12',
  now() - INTERVAL '7 hours',
  now() - INTERVAL '5 hours',
  NULL
WHERE NOT EXISTS (SELECT 1 FROM ordens_manutencao WHERE numero_formatado = 'OM-2026-000013');

-- OM-14: RESERVADA (Injetora Romi 350T - Ventoinha Servo-Motor)
INSERT INTO ordens_manutencao (
  numero_formatado, equipamento_id, solicitante_id, responsavel_id,
  tipo, prioridade, status, titulo, descricao, solucao, motivo_pausa,
  aprovado_por, data_aprovacao, concluido_por, concluido_em,
  delegado_por, delegado_em, prazo_atendimento,
  tipo_ativo, categoria, sintomas,
  data_abertura, data_inicio, data_conclusao
)
SELECT
  'OM-2026-000014',
  (SELECT id FROM equipamentos WHERE codigo = 'INJ-02'),
  (SELECT id FROM usuarios WHERE matricula = '333444'),
  (SELECT id FROM usuarios WHERE matricula = '222222'),
  'CORRETIVA', 'ALTA', 'RESERVADA',
  'Ventoinha de resfriamento do servo-motor inoperante',
  'Cooler de ventilação forçada travado com acúmulo de pó polimérico.',
  NULL, NULL,
  NULL, NULL, NULL, NULL,
  (SELECT id FROM usuarios WHERE matricula = '333333'), now() - INTERVAL '2 hours',
  now() + INTERVAL '1 hour',
  'MAQUINA', 'ELETRICA', 'Alarme térmico no inversor do dosador de matéria-prima',
  now() - INTERVAL '3 hours',
  NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM ordens_manutencao WHERE numero_formatado = 'OM-2026-000014');

-- OM-15: RESERVADA (Extrusora Monorosca 60mm - Lubrificação de Mancais)
INSERT INTO ordens_manutencao (
  numero_formatado, equipamento_id, solicitante_id, responsavel_id,
  tipo, prioridade, status, titulo, descricao, solucao, motivo_pausa,
  aprovado_por, data_aprovacao, concluido_por, concluido_em,
  delegado_por, delegado_em, prazo_atendimento,
  tipo_ativo, categoria, sintomas,
  data_abertura, data_inicio, data_conclusao
)
SELECT
  'OM-2026-000015',
  (SELECT id FROM equipamentos WHERE codigo = 'EXT-02'),
  (SELECT id FROM usuarios WHERE matricula = '333333'),
  (SELECT id FROM usuarios WHERE matricula = '222222'),
  'PREVENTIVA', 'MEDIA', 'RESERVADA',
  'Lubrificação centralizada dos mancais da rosca',
  'Reabastecimento e purga de ar da linha de engraxamento automático.',
  NULL, NULL,
  NULL, NULL, NULL, NULL,
  (SELECT id FROM usuarios WHERE matricula = '111111'), now() - INTERVAL '1 hour 30 minutes',
  now() + INTERVAL '2 hours',
  'MAQUINA', 'LUBRIFICACAO', 'Rotina de lubrificação e checagem periódica do nível do reservatório',
  now() - INTERVAL '2 hours',
  NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM ordens_manutencao WHERE numero_formatado = 'OM-2026-000015');

-- OM-16: ABERTA (Injetora Haitian 450T - Ruído de Plastificação)
INSERT INTO ordens_manutencao (
  numero_formatado, equipamento_id, solicitante_id, responsavel_id,
  tipo, prioridade, status, titulo, descricao, solucao, motivo_pausa,
  aprovado_por, data_aprovacao, concluido_por, concluido_em,
  delegado_por, delegado_em, prazo_atendimento,
  tipo_ativo, categoria, sintomas,
  data_abertura, data_inicio, data_conclusao
)
SELECT
  'OM-2026-000016',
  (SELECT id FROM equipamentos WHERE codigo = 'INJ-03'),
  (SELECT id FROM usuarios WHERE matricula = '333444'),
  NULL,
  'CORRETIVA', 'CRITICA', 'ABERTA',
  'Ruído metálico no conjunto de plastificação',
  'Operador reportou barulho anormal no funil de alimentação e rosca.',
  NULL, NULL,
  NULL, NULL, NULL, NULL,
  NULL, NULL,
  now() + INTERVAL '30 minutes',
  'MAQUINA', 'MECANICA', 'Estalo repetitivo durante a dosagem de polipropileno com fibra',
  now() - INTERVAL '1 hour',
  NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM ordens_manutencao WHERE numero_formatado = 'OM-2026-000016');

-- OM-17: ABERTA (CNC D800 - Vazamento Ar Trocador de Ferramentas)
INSERT INTO ordens_manutencao (
  numero_formatado, equipamento_id, solicitante_id, responsavel_id,
  tipo, prioridade, status, titulo, descricao, solucao, motivo_pausa,
  aprovado_por, data_aprovacao, concluido_por, concluido_em,
  delegado_por, delegado_em, prazo_atendimento,
  tipo_ativo, categoria, sintomas,
  data_abertura, data_inicio, data_conclusao
)
SELECT
  'OM-2026-000017',
  (SELECT id FROM equipamentos WHERE codigo = 'CNC-01'),
  (SELECT id FROM usuarios WHERE matricula = '333444'),
  NULL,
  'CORRETIVA', 'ALTA', 'ABERTA',
  'Vazamento de ar no magazine trocador de ferramentas',
  'Conexão rápida de mangueira 8mm do carrossel partida e escapando ar comprimido.',
  NULL, NULL,
  NULL, NULL, NULL, NULL,
  NULL, NULL,
  now() + INTERVAL '1 hour 20 minutes',
  'MAQUINA', 'PNEUMATICA', 'Pressão pneumática do braço mecânico oscilando abaixo de 5 bar',
  now() - INTERVAL '40 minutes',
  NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM ordens_manutencao WHERE numero_formatado = 'OM-2026-000017');

-- OM-18: ABERTA (Molde Flip-Top 28mm - Polimento Preventivo de Cavidades)
INSERT INTO ordens_manutencao (
  numero_formatado, equipamento_id, solicitante_id, responsavel_id,
  tipo, prioridade, status, titulo, descricao, solucao, motivo_pausa,
  aprovado_por, data_aprovacao, concluido_por, concluido_em,
  delegado_por, delegado_em, prazo_atendimento,
  tipo_ativo, categoria, sintomas,
  data_abertura, data_inicio, data_conclusao
)
SELECT
  'OM-2026-000018',
  (SELECT id FROM equipamentos WHERE codigo = 'MOL-01'),
  (SELECT id FROM usuarios WHERE matricula = '333333'),
  NULL,
  'PREVENTIVA', 'MEDIA', 'ABERTA',
  'Inspeção e polimento preventivo de cavidades',
  'Desmontagem para banho ultrassônico e polimento espelhado das cavidades óticas.',
  NULL, NULL,
  NULL, NULL, NULL, NULL,
  NULL, NULL,
  now() + INTERVAL '3 hours',
  'MOLDE', 'MOLDES', 'Fim de campanha programada de 100.000 ciclos de injeção',
  now() - INTERVAL '15 minutes',
  NULL, NULL
WHERE NOT EXISTS (SELECT 1 FROM ordens_manutencao WHERE numero_formatado = 'OM-2026-000018');

-- -----------------------------------------------------------------------------
-- 4. APONTAMENTOS DE TEMPO (om_apontamentos_tempo)
--    Garante no máximo 1 cronômetro ativo (fim IS NULL) para o técnico Lucas
-- -----------------------------------------------------------------------------
INSERT INTO om_apontamentos_tempo (ordem_id, tecnico_id, inicio, fim, origem)
SELECT
  o.id,
  (SELECT id FROM usuarios WHERE matricula = '222222'),
  dados.inicio,
  dados.fim,
  'CRONOMETRO'::apontamento_origem
FROM (
  VALUES
    ('OM-2026-000001', now() - INTERVAL '6 days 12 hours', now() - INTERVAL '6 days 8 hours'),
    ('OM-2026-000002', now() - INTERVAL '6 days',          now() - INTERVAL '5 days 21 hours'),
    ('OM-2026-000003', now() - INTERVAL '5 days 7 hours',  now() - INTERVAL '5 days 2 hours'),
    ('OM-2026-000004', now() - INTERVAL '4 days 16 hours', now() - INTERVAL '4 days 12 hours'),
    ('OM-2026-000005', now() - INTERVAL '3 days 8 hours',  now() - INTERVAL '3 days 5 hours'),
    ('OM-2026-000006', now() - INTERVAL '3 days 2 hours',  now() - INTERVAL '2 days 23 hours'),
    ('OM-2026-000007', now() - INTERVAL '2 days 4 hours',  now() - INTERVAL '2 days'),
    ('OM-2026-000008', now() - INTERVAL '1 day 18 hours',  now() - INTERVAL '1 day 15 hours'),
    ('OM-2026-000009', now() - INTERVAL '1 day 12 hours',  now() - INTERVAL '1 day 9 hours'),
    ('OM-2026-000010', now() - INTERVAL '1 day 6 hours',   now() - INTERVAL '1 day 4 hours'),
    ('OM-2026-000011', now() - INTERVAL '18 hours',        now() - INTERVAL '16 hours'),
    ('OM-2026-000012', now() - INTERVAL '45 minutes',      NULL::timestamptz), -- CRONÔMETRO ABERTO
    ('OM-2026-000013', now() - INTERVAL '5 hours',         now() - INTERVAL '3 hours')
) AS dados(numero_om, inicio, fim)
JOIN ordens_manutencao o ON o.numero_formatado = dados.numero_om
WHERE NOT EXISTS (
  SELECT 1 FROM om_apontamentos_tempo apt
  WHERE apt.ordem_id = o.id
);

-- -----------------------------------------------------------------------------
-- 5. MATERIAIS UTILIZADOS (om_materiais_utilizados)
-- -----------------------------------------------------------------------------
INSERT INTO om_materiais_utilizados (ordem_id, registrado_por, codigo, descricao, quantidade, unidade, custo_unitario, flag_interno)
SELECT
  o.id,
  (SELECT id FROM usuarios WHERE matricula = '222222'),
  mat.codigo, mat.descricao, mat.quantidade, mat.unidade, mat.custo_unitario, TRUE
FROM (
  VALUES
    ('OM-2026-000001', 'OR-VIT-323',  'Anel O-ring Viton 90 Shore 32x3mm',       4.000, 'UN', 18.50),
    ('OM-2026-000001', 'OLEO-VG68',   'Óleo Hidráulico Industrial ISO VG 68',   20.000, 'L',  14.00),
    ('OM-2026-000002', 'FLT-RIT-150', 'Filtro para Painel Rittal 150x150',       2.000, 'UN', 35.00),
    ('OM-2026-000003', 'EXT-DIN-4150','Pino Extrator DIN 1530-A 4x150mm',        2.000, 'UN', 42.50),
    ('OM-2026-000003', 'SPY-DESM-SIL','Spray Desmoldante Protetivo Silfree',     1.000, 'UN', 38.00),
    ('OM-2026-000004', 'GRX-KLU-NBU', 'Graxa Especial Klüber Isoflex NBU 15',    1.000, 'UN', 195.00),
    ('OM-2026-000005', 'RES-CER-6050','Resistência Coleira Cerâmica 60x50 800W', 1.000, 'UN', 135.00),
    ('OM-2026-000006', 'VIB-STP-MINI','Amortecedor Vibra-Stop Mini M8',          4.000, 'UN', 28.00),
    ('OM-2026-000007', 'JGO-GAX-90PU','Jogo Gaxetas Hidráulicas PU 90mm',        1.000, 'UN', 260.00),
    ('OM-2026-000008', 'COR-GAT-B75', 'Correia Trapezoidal Gates B-75 Hi-Power', 4.000, 'UN', 48.00),
    ('OM-2026-000009', 'ROT-BMB-05HP','Rotor Polimérico Bomba Refrigeração 0.5HP', 1.000, 'UN', 115.00)
) AS mat(numero_om, codigo, descricao, quantidade, unidade, custo_unitario)
JOIN ordens_manutencao o ON o.numero_formatado = mat.numero_om
WHERE NOT EXISTS (
  SELECT 1 FROM om_materiais_utilizados m
  WHERE m.ordem_id = o.id AND m.codigo = mat.codigo
);

-- -----------------------------------------------------------------------------
-- 6. OBSERVAÇÕES TÉCNICAS (ordens_notas)
-- -----------------------------------------------------------------------------
INSERT INTO ordens_notas (ordem_id, autor_id, nota, criado_em)
SELECT
  o.id,
  (SELECT id FROM usuarios WHERE matricula = '222222'),
  n.nota,
  n.criado_em
FROM (
  VALUES
    ('OM-2026-000001', 'Manifold totalmente estanque. Pressão hidráulica calibrada em 160 bar com manômetro padrão.', now() - INTERVAL '6 days 8 hours'),
    ('OM-2026-000003', 'Ajuste H7 das buchas verificado com calibrador passa/não-passa antes da montagem na máquina.', now() - INTERVAL '5 days 2 hours'),
    ('OM-2026-000005', 'Aquecimento térmico conferido com termovisor Fluke. Temperatura uniforme em toda a cinta.', now() - INTERVAL '3 days 5 hours'),
    ('OM-2026-000010', 'Bucha guia enviada para tratamento térmico terceirizado. Retorno programado para amanhã.', now() - INTERVAL '1 day 6 hours'),
    ('OM-2026-000011', 'Pedido de compra emergencial PO-2026-882 emitido para o termopar tipo J.', now() - INTERVAL '18 hours'),
    ('OM-2026-000012', 'Desmontagem do sensor indutivo e conferência das folgas mecânicas das réguas.', now() - INTERVAL '1 hour 30 minutes'),
    ('OM-2026-000013', 'Válvulas de segurança testadas individualmente sem fuga interna. Prosseguindo calibração.', now() - INTERVAL '3 hours')
) AS n(numero_om, nota, criado_em)
JOIN ordens_manutencao o ON o.numero_formatado = n.numero_om
WHERE NOT EXISTS (
  SELECT 1 FROM ordens_notas nota
  WHERE nota.ordem_id = o.id AND nota.nota = n.nota
);

-- -----------------------------------------------------------------------------
-- 7. HISTÓRICO DE TRANSIÇÕES DE STATUS (historico_status_ordem)
--    Complementa a linha do tempo para OMs concluídas / aprovadas / pausadas
-- -----------------------------------------------------------------------------
INSERT INTO historico_status_ordem (ordem_id, status_anterior, status_novo, usuario_id, motivo, criado_em)
SELECT
  o.id,
  h.status_anterior::status_ordem,
  h.status_novo::status_ordem,
  (SELECT id FROM usuarios WHERE matricula = h.matricula_usuario),
  h.motivo,
  h.criado_em
FROM (
  VALUES
    -- Transições da OM-01 (Concluída)
    ('OM-2026-000001', 'ABERTA',               'RESERVADA',            '333333', NULL,                                                                           now() - INTERVAL '6 days 13 hours'),
    ('OM-2026-000001', 'RESERVADA',            'EM_ANDAMENTO',         '222222', NULL,                                                                           now() - INTERVAL '6 days 12 hours'),
    ('OM-2026-000001', 'EM_ANDAMENTO',         'AGUARDANDO_APROVACAO', '222222', NULL,                                                                           now() - INTERVAL '6 days 8 hours'),
    ('OM-2026-000001', 'AGUARDANDO_APROVACAO', 'AGUARDANDO_BAIXA',     '333333', NULL,                                                                           now() - INTERVAL '6 days 7 hours'),
    ('OM-2026-000001', 'AGUARDANDO_BAIXA',     'CONCLUIDA',            '111111', NULL,                                                                           now() - INTERVAL '6 days 6 hours'),

    -- Transições da OM-05 (Aguardando Baixa)
    ('OM-2026-000005', 'ABERTA',               'RESERVADA',            '333333', NULL,                                                                           now() - INTERVAL '3 days 9 hours'),
    ('OM-2026-000005', 'RESERVADA',            'EM_ANDAMENTO',         '222222', NULL,                                                                           now() - INTERVAL '3 days 8 hours'),
    ('OM-2026-000005', 'EM_ANDAMENTO',         'AGUARDANDO_APROVACAO', '222222', NULL,                                                                           now() - INTERVAL '3 days 5 hours'),
    ('OM-2026-000005', 'AGUARDANDO_APROVACAO', 'AGUARDANDO_BAIXA',     '333333', NULL,                                                                           now() - INTERVAL '3 days 4 hours'),

    -- Transições da OM-07 (Aguardando Aprovação)
    ('OM-2026-000007', 'ABERTA',               'RESERVADA',            '333333', NULL,                                                                           now() - INTERVAL '2 days 5 hours'),
    ('OM-2026-000007', 'RESERVADA',            'EM_ANDAMENTO',         '222222', NULL,                                                                           now() - INTERVAL '2 days 4 hours'),
    ('OM-2026-000007', 'EM_ANDAMENTO',         'AGUARDANDO_APROVACAO', '222222', NULL,                                                                           now() - INTERVAL '2 days'),

    -- Transições da OM-10 (Pausada)
    ('OM-2026-000010', 'ABERTA',               'RESERVADA',            '333333', NULL,                                                                           now() - INTERVAL '1 day 7 hours'),
    ('OM-2026-000010', 'RESERVADA',            'EM_ANDAMENTO',         '222222', NULL,                                                                           now() - INTERVAL '1 day 6 hours'),
    ('OM-2026-000010', 'EM_ANDAMENTO',         'PAUSADA',              '222222', 'Aguardando têmpera por indução da bucha guia na ferramentaria externa',        now() - INTERVAL '1 day 4 hours')
) AS h(numero_om, status_anterior, status_novo, matricula_usuario, motivo, criado_em)
JOIN ordens_manutencao o ON o.numero_formatado = h.numero_om
WHERE NOT EXISTS (
  SELECT 1 FROM historico_status_ordem hst
  WHERE hst.ordem_id = o.id
    AND hst.status_novo = h.status_novo::status_ordem
    AND hst.status_anterior = h.status_anterior::status_ordem
);

-- -----------------------------------------------------------------------------
-- 8. ATUALIZAÇÃO SEGURA DE SEQUÊNCIAS ANUAIS (om_sequencias_anuais)
-- -----------------------------------------------------------------------------
-- Garante que o contador do ano civil corrente (2026) esteja no mínimo no
-- sequencial 18, sem nunca regredir caso já existam números superiores no banco.
INSERT INTO om_sequencias_anuais (ano, ultimo_numero, criado_em, atualizado_em)
VALUES (2026, 18, now(), now())
ON CONFLICT (ano) DO UPDATE
SET ultimo_numero = GREATEST(om_sequencias_anuais.ultimo_numero, 18),
    atualizado_em = now();

COMMIT;
