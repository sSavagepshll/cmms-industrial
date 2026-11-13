import type { CategoriaKey } from "./types";

export const TOTEM_ID = process.env.NEXT_PUBLIC_TOTEM_ID ?? "TOTEM-01";

// RN-05 / US-01 / US-04
export const LOGIN_TIMEOUT_MS = 30_000;
export const IDLE_TIMEOUT_MS = 45_000;
export const IDLE_WARNING_MS = 10_000;
export const SUCCESS_COUNTDOWN_S = 8;
export const OBS_MAX = 250;

// Prioridade exibida na revisão (a API é quem grava; RN-03: parada => CRITICA)
export const prioridadePorImpacto = { PARADA: "CRITICA", OPERANDO: "MEDIA" } as const;

// `key` = enum aceito por POST /ordens. Sintomas não podem conter ';'.
export const CATEGORIAS: { key: CategoriaKey; label: string; sintomas: string[] }[] = [
  { key: "MECANICO", label: "Mecânico", sintomas: ["Ruído Anormal", "Vibração Excessiva", "Peça Quebrada", "Superaquecimento", "Vazamento de Óleo"] },
  { key: "ELETRICO", label: "Elétrico", sintomas: ["Não Liga", "Superaquecimento", "Fusível Queimado", "Cheiro de Queimado", "Disjuntor Desarmando"] },
  { key: "PNEUMATICO_HIDRAULICO", label: "Pneumático/Hidráulico", sintomas: ["Vazamento de Óleo", "Vazamento de Ar", "Pressão Baixa", "Mangueira Rompida", "Cilindro Travado"] },
  { key: "INSTRUMENTACAO", label: "Instrumentação", sintomas: ["Sensor Descalibrado", "Leitura Instável", "Display Apagado", "Sensor Não Detecta"] },
  { key: "SEGURANCA", label: "Segurança", sintomas: ["Proteção Danificada", "Botão de Emergência", "Cortina de Luz Falhando", "Risco de Acidente"] },
  // Só aparece no fluxo predial (setor "Outros"); ver StepDetalhes.
  { key: "CIVIL_PREDIAL", label: "Civil/Predial", sintomas: ["Lâmpada Queimada", "Tomada/Interruptor", "Eletroduto/Fiação", "Vazamento/Infiltração", "Porta/Fechadura", "Piso/Parede/Telhado", "Ar-condicionado/Ventilação"] },
];
export const LOCAL_MAX = 100;

/** Fase 30 (US-15): tríade da natureza da falha no Totem (RN-41) e sugestões rápidas por tipo (RN-42). Sintomas não podem conter ';' (≤80). */
export const TRIADE: { key: "MECANICO" | "ELETRICO" | "OUTROS"; label: string; icon: string; sintomas: string[] }[] = [
  { key: "MECANICO", label: "Mecânico", icon: "🔧", sintomas: ["Ruído Anormal", "Vibração Excessiva", "Vazamento de Óleo", "Superaquecimento", "Peça Quebrada"] },
  { key: "ELETRICO", label: "Elétrico", icon: "⚡", sintomas: ["Não Liga", "Fusível Queimado", "Cheiro de Queimado", "Disjuntor Desarmando", "Aquecimento Elétrico"] },
  { key: "OUTROS", label: "Outros", icon: "🧰", sintomas: ["Pneumático", "Hidráulico", "Sensor/Instrumentação", "Segurança", "Predial"] },
];
export const SINTOMA_MAX = 80;
/** Ícone de cada grupo do Totem, por `codigo` (o nome vem do banco). */
export const ICONES_GRUPO: Record<string, string> = { PRODUTIVOS: "🏭", IMPRODUTIVOS: "⚙️", MOLDES: "🧩", PREDIAL_OUTROS: "🏢" };
