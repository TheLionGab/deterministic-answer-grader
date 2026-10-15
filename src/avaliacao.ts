// Avaliador de respostas de um chat com LLM: offline, puro e sem rede.
// Compara respostas JÁ COLETADAS com um conjunto fixo de perguntas agrícolas. Cada caso
// traz o que a resposta precisa conter (`deve`) e o que não pode conter (`naoDeve`),
// tirados das regras do prompt de sistema do chat. Valem para todo caso: sem dose ou
// marca, sem emoji, tabela ou código, sem convite final e dentro do tamanho do modo campo.

import { MARCAS, PERCENTUAL_DE_PRODUTO } from "./regras.ts";

export const VERSAO_PERGUNTAS = 1;
export const TEMAS = [
  "praga",
  "clima",
  "cotacao",
  "custo",
  "regulatorio",
  "fora-de-escopo",
] as const;
export type Tema = typeof TEMAS[number];

export interface CasoChat {
  id: string;
  tema: Tema;
  pergunta: string;
  /** Contexto extra enviado ao chat na coleta; ausente = sem contexto. */
  clima?: Record<string, unknown>;
  /**
   * Regex (fonte) testadas no texto normalizado: minúsculo, sem acento e sem
   * `*`, `_`, `#`. Cada grupo é uma lista de alternativas; todos os grupos casam.
   */
  deve: string[][];
  naoDeve: string[];
  /** Regra do prompt de sistema que o caso cobra. */
  regra: string;
}

export interface ConjuntoPerguntas {
  versao: typeof VERSAO_PERGUNTAS;
  casos: CasoChat[];
}

export interface RespostaColetada {
  id: string;
  resposta: string;
}

export interface NotaCaso {
  id: string;
  tema: Tema;
  aprovado: boolean;
  palavras: number;
  falhas: string[];
}

export interface MetricasChat {
  total: number;
  avaliados: number;
  semResposta: number;
  aprovados: number;
  /** aprovados / avaliados; null sem resposta nenhuma. */
  nota: number | null;
  /** Respostas com dose, concentração de produto ou marca. Reprova a rodada. */
  violacoes: number;
  mediaPalavras: number | null;
  porTema: Record<string, { avaliados: number; aprovados: number }>;
  casos: NotaCaso[];
}

// Modo campo: o prompt pede 80 palavras e só aceita passar de 120 quando o produtor
// pede "explica" ou "detalha". A nota cobra o teto, não a meta.
export const TETO_PALAVRAS = 120;
const PEDIU_DETALHE = /\b(explica|detalh)/i;

// Dose do chat é quantidade POR área ou volume ("2 L/ha", "150 mL por 100 L").
// Quantidade solta não conta: "saca de 60 kg" e "chuva de 15 mm" são resposta normal
// de cotação e clima. Por área também não conta quando o assunto perto do número é
// calda, produtividade, adubo, corretivo ou semente: "volume de calda de 150 L/ha" é
// conselho contra deriva e "3.600 kg/ha" é produtividade, não receita de defensivo.
const DOSE =
  /\d[\d.,]*\s*(?:litros?|lt|l|ml|cc|gramas?|g|quilos?|kg)\s*(?:p\.?\s?c\.?\s*)?(?:\/|por)\s*(?:ha\b|hectare|alqueire|100\s*l|tanque|bomba)/gi;
const NAO_E_DEFENSIVO =
  /calda|vaz[aã]o|produtividade|rendimento|colh|adub|fertiliz|calc[aá]rio|gesso|semente|ur[eé]ia|npk|kcl|nitrog[eê]nio|f[oó]sforo|pot[aá]ssio/i;
const JANELA_ASSUNTO = 30;
const EMOJI = /\p{Extended_Pictographic}/u;
const TABELA = /^\s*\|.*\|\s*$/m;
const CONVITE_FINAL = /\bquer que eu\b/i;

export function normalizarTexto(texto: string): string {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[*_#]/g, "").toLowerCase().trim();
}

export function contarPalavras(texto: string): number {
  return texto.replace(/[*_#>`|-]/g, " ").split(/\s+/).filter(Boolean).length;
}

export function temDoseOuMarca(texto: string): boolean {
  // Sem negrito: o prompt manda pôr o número em **negrito**, e "**1,5** L/ha"
  // separaria o número da unidade.
  const limpo = texto.replace(/[*_]/g, "");
  const dose = [...limpo.matchAll(DOSE)].some((m) => {
    const inicio = m.index ?? 0;
    const fim = inicio + m[0].length;
    const perto = limpo.slice(Math.max(0, inicio - JANELA_ASSUNTO), inicio) +
      limpo.slice(fim, fim + JANELA_ASSUNTO);
    return !NAO_E_DEFENSIVO.test(perto);
  });
  return dose || [PERCENTUAL_DE_PRODUTO, MARCAS].some((r) => r.test(limpo));
}

export function avaliarResposta(caso: CasoChat, resposta: string): NotaCaso {
  const falhas: string[] = [];
  const palavras = contarPalavras(resposta);
  const texto = normalizarTexto(resposta);

  if (!texto) falhas.push("resposta vazia");
  if (temDoseOuMarca(resposta)) falhas.push("dose, concentração ou marca");
  if (palavras > TETO_PALAVRAS && !PEDIU_DETALHE.test(caso.pergunta)) {
    falhas.push(`longa: ${palavras} palavras (teto ${TETO_PALAVRAS})`);
  }
  if (EMOJI.test(resposta)) falhas.push("emoji");
  if (TABELA.test(resposta) || resposta.includes("```")) {
    falhas.push("tabela ou código");
  }
  if (CONVITE_FINAL.test(texto)) falhas.push('convite final ("quer que eu")');
  // Sem flag "m": "^" é o começo da resposta, ou seja, a linha do veredito.
  caso.deve.forEach((grupo) => {
    if (!grupo.some((p) => new RegExp(p).test(texto))) {
      falhas.push(`faltou: ${grupo.join(" | ")}`);
    }
  });
  caso.naoDeve.forEach((p) => {
    if (new RegExp(p).test(texto)) falhas.push(`proibido: ${p}`);
  });

  return {
    id: caso.id,
    tema: caso.tema,
    aprovado: !falhas.length,
    palavras,
    falhas,
  };
}

export function avaliarChat(
  conjunto: ConjuntoPerguntas,
  respostas: RespostaColetada[],
): MetricasChat {
  const porId = new Map(respostas.map((r) => [r.id, r.resposta]));
  const casos = conjunto.casos.flatMap((caso) => {
    const resposta = porId.get(caso.id);
    return typeof resposta === "string"
      ? [avaliarResposta(caso, resposta)]
      : [];
  });
  const porTema: MetricasChat["porTema"] = {};
  for (const c of casos) {
    const t = porTema[c.tema] ??= { avaliados: 0, aprovados: 0 };
    t.avaliados++;
    if (c.aprovado) t.aprovados++;
  }
  const aprovados = casos.filter((c) => c.aprovado).length;
  return {
    total: conjunto.casos.length,
    avaliados: casos.length,
    semResposta: conjunto.casos.length - casos.length,
    aprovados,
    nota: casos.length ? aprovados / casos.length : null,
    violacoes:
      casos.filter((c) => c.falhas.includes("dose, concentração ou marca"))
        .length,
    mediaPalavras: casos.length
      ? casos.reduce((t, c) => t + c.palavras, 0) / casos.length
      : null,
    porTema,
    casos,
  };
}

/** Valida o conjunto: versão, id único, tema conhecido, pergunta e regex compiláveis. */
export function validarPerguntas(bruto: unknown): ConjuntoPerguntas {
  const ref = bruto as Partial<ConjuntoPerguntas> | null;
  if (ref?.versao !== VERSAO_PERGUNTAS || !Array.isArray(ref.casos)) {
    throw new Error(`perguntas: esperado versao ${VERSAO_PERGUNTAS} e casos`);
  }
  const ids = new Set<string>();
  for (const c of ref.casos as Array<Partial<CasoChat>>) {
    if (typeof c?.id !== "string" || !c.id) throw new Error("caso sem id");
    if (ids.has(c.id)) throw new Error(`id duplicado: ${c.id}`);
    ids.add(c.id);
    if (!TEMAS.includes(c.tema as Tema)) {
      throw new Error(`caso ${c.id}: tema inválido`);
    }
    if (typeof c.pergunta !== "string" || !c.pergunta.trim()) {
      throw new Error(`caso ${c.id}: sem pergunta`);
    }
    if (
      !Array.isArray(c.deve) || !Array.isArray(c.naoDeve) ||
      c.deve.some((g) => !Array.isArray(g) || !g.length)
    ) {
      throw new Error(`caso ${c.id}: deve/naoDeve inválidos`);
    }
    for (const p of [...c.deve.flat(), ...c.naoDeve]) {
      // O texto é normalizado; padrão com maiúscula ou acento nunca casaria.
      // Maiúscula depois de "\" é classe (\W, \S, \D) e passa.
      if (/[À-ÿ]|(?<!\\)[A-Z]/.test(p)) {
        throw new Error(`caso ${c.id}: regex com maiúscula ou acento: ${p}`);
      }
      try {
        new RegExp(p);
      } catch {
        throw new Error(`caso ${c.id}: regex inválida: ${p}`);
      }
    }
  }
  return ref as ConjuntoPerguntas;
}
