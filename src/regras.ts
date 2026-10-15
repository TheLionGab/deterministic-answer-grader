// Regras de segurança compartilhadas: o que nunca pode aparecer numa resposta
// sobre defensivos agrícolas (percentual de produto e marca comercial).

// "%" só conta ao lado de produto, calda ou i.a.: "desfolha de 30%" é resposta normal.
export const PERCENTUAL_DE_PRODUTO =
  /\d[\d.,]*\s*%\s*(?:v\/v|p\/v|i\.?a\.?|(?:do|de|na|da)\s+(?:produto|calda))/i;

// Lista parcial de propósito, sem palavra comum ("nativo", "opera"): o que escapar
// dela se pega na revisão humana.
export const MARCAS =
  /\b(?:priori|fox xpro|aproach|engeo|ativum|elatus|orkestra|roundup|karate)\b/i;
