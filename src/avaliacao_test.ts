import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  avaliarChat,
  avaliarResposta,
  type CasoChat,
  contarPalavras,
  temDoseOuMarca,
  validarPerguntas,
} from "./avaliacao.ts";
import perguntas from "../data/perguntas.json" with {
  type: "json",
};

const caso = (extra: Partial<CasoChat> = {}): CasoChat => ({
  id: "c",
  tema: "praga",
  pergunta: "tem percevejo na soja, aplico?",
  deve: [["\\?"], ["estadio", "nivel"]],
  naoDeve: [],
  regra: "",
  ...extra,
});

Deno.test("dose por área ou volume, % de produto e marca reprovam; quantidade solta não", () => {
  for (
    const t of [
      "Aplicar 2 L/ha de fungicida.",
      "Use 150 mL por 100 L.",
      "Entre com 0,5 kg p.c./ha.",
      "Usar 0,5% v/v do produto.",
      "Priori Xtra resolve.",
    ]
  ) assertEquals(temDoseOuMarca(t), true, t);
  for (
    const t of [
      "Soja a **R$ 128** a saca de 60 kg em Sorriso.",
      "Choveu 15 mm ontem.",
      "Confirme a dose na bula com o agrônomo.",
      "Desfolha de 30% no R5.",
      "Volume de calda conforme a bula.",
    ]
  ) assertEquals(temDoseOuMarca(t), false, t);
});

Deno.test("deve casa no texto sem acento, sem markdown e sem caixa", () => {
  const n = avaliarResposta(
    caso(),
    "**Ainda não.**\n- Qual o **estádio** e o nível no pano de batida?",
  );
  assertEquals(n.falhas, []);
  assertEquals(n.aprovado, true);
});

Deno.test("cada grupo de deve que não casa vira uma falha; naoDeve também", () => {
  const n = avaliarResposta(
    caso({ naoDeve: ["vento\\s+(esta\\s+)?(ok|bom)"] }),
    "Pode aplicar, vento está ok.",
  );
  assertEquals(n.falhas, [
    "faltou: \\?",
    "faltou: estadio | nivel",
    "proibido: vento\\s+(esta\\s+)?(ok|bom)",
  ]);
});

Deno.test("âncora ^ testa a primeira linha (o veredito)", () => {
  const c = caso({ deve: [["^\\W*nao\\b"]] });
  assertEquals(avaliarResposta(c, "**Não.**\n- Vento alto.").aprovado, true);
  assertEquals(avaliarResposta(c, "Olha, não.").aprovado, false);
});

Deno.test("modo campo: teto de palavras só cai quando o produtor pede detalhe", () => {
  const longa = `Estádio? ${"palavra ".repeat(130)}nível`;
  assertEquals(contarPalavras("**Não.** - um, dois"), 3);
  assertEquals(
    avaliarResposta(caso(), longa).falhas,
    ["longa: 132 palavras (teto 120)"],
  );
  assertEquals(
    avaliarResposta(caso({ pergunta: "explica o nível de controle" }), longa)
      .aprovado,
    true,
  );
});

Deno.test("emoji, tabela, código e convite final reprovam", () => {
  const base = "Qual o estádio?";
  const falhas = (extra: string) =>
    avaliarResposta(caso(), base + extra).falhas;
  assertEquals(falhas(" 🌱"), ["emoji"]);
  assertEquals(falhas("\n| a | b |"), ["tabela ou código"]);
  assertEquals(falhas("\n```x```"), ["tabela ou código"]);
  assertEquals(falhas(" Quer que eu simule o nível?"), [
    'convite final ("quer que eu")',
  ]);
});

Deno.test("métricas: nota, sem resposta, violação e recorte por tema", () => {
  const conjunto = {
    versao: 1 as const,
    casos: [
      caso({ id: "a" }),
      caso({ id: "b", tema: "clima", deve: [["inversao"]] }),
      caso({ id: "c", tema: "clima", deve: [["deriva"]] }),
    ],
  };
  const m = avaliarChat(conjunto, [
    { id: "a", resposta: "Qual o estádio? Use 2 L/ha." },
    { id: "b", resposta: "Não. Risco de inversão." },
  ]);
  assertEquals([m.total, m.avaliados, m.semResposta, m.aprovados], [
    3,
    2,
    1,
    1,
  ]);
  assertEquals([m.nota, m.violacoes], [0.5, 1]);
  assertEquals(m.porTema, {
    praga: { avaliados: 1, aprovados: 0 },
    clima: { avaliados: 1, aprovados: 1 },
  });
  assertEquals(avaliarChat(conjunto, []).nota, null);
});

Deno.test("validação: versão, id, tema, pergunta e regex", () => {
  const ok = { versao: 1, casos: [caso()] };
  assertEquals(validarPerguntas(ok).casos.length, 1);
  const com = (extra: Partial<CasoChat>) => ({
    versao: 1,
    casos: [caso(extra)],
  });
  assertThrows(() => validarPerguntas({ versao: 2, casos: [] }));
  assertThrows(() => validarPerguntas({ versao: 1, casos: [caso(), caso()] }));
  assertThrows(() => validarPerguntas(com({ tema: "x" as CasoChat["tema"] })));
  assertThrows(() => validarPerguntas(com({ pergunta: " " })));
  assertThrows(() => validarPerguntas(com({ deve: [[]] })));
  assertThrows(() => validarPerguntas(com({ naoDeve: ["("] })));
  assertThrows(() => validarPerguntas(com({ naoDeve: ["Inversão"] })));
  assertEquals(
    validarPerguntas(com({ naoDeve: ["^\\W*sim\\b"] })).casos.length,
    1,
  );
});

Deno.test("o conjunto versionado é válido", () => {
  const conjunto = validarPerguntas(perguntas);
  assertEquals(conjunto.casos.length >= 15, true);
});

Deno.test("negrito no número não esconde a dose (o prompt pede negrito)", () => {
  for (
    const t of [
      "Aplique **1,5** L/ha.",
      "Use **2 L**/ha.",
      "**0,5%** v/v do produto.",
      "Entre com 150 L/ha do fungicida.",
    ]
  ) assertEquals(temDoseOuMarca(t), true, t);
});

Deno.test("calda, produtividade e adubo por hectare não são dose de defensivo", () => {
  for (
    const t of [
      "Use volume de calda de 150 L/ha para reduzir deriva.",
      "Produtividade de **3.600 kg/ha** no talhão.",
      "Adubação de 300 kg/ha de NPK conforme a análise.",
    ]
  ) assertEquals(temDoseOuMarca(t), false, t);
});

Deno.test("^ é o começo da resposta, não de cada bullet", () => {
  const veredito = caso({ deve: [["^\\W*nao\\b"]] });
  assertEquals(
    avaliarResposta(veredito, "**Pode, com cuidado.**\n- Não esqueça o EPI.")
      .aprovado,
    false,
  );
  const semSim = caso({ deve: [["\\?"]], naoDeve: ["^\\W*sim\\b"] });
  assertEquals(
    avaliarResposta(semSim, "**Não.**\n- Sim, a UR está boa. Qual o estádio?")
      .falhas,
    [],
  );
});

Deno.test("conjunto versionado aprova respostas certas de clima", () => {
  const conjunto = validarPerguntas(perguntas);
  const nota = (id: string, resposta: string) => {
    const c = conjunto.casos.find((x) => x.id === id);
    if (!c) throw new Error(id);
    return avaliarResposta(c, resposta).falhas;
  };
  assertEquals(
    nota(
      "clima-janela-boa",
      "**Pode aplicar.**\n- Vento de 6 km/h, sem risco de inversão térmica.",
    ),
    [],
  );
  assertEquals(
    nota(
      "clima-vento-calmo",
      "**Não.**\n- Vento de 2 km/h: risco de inversão térmica.\n- Vento ideal: 4 a 9 km/h.",
    ),
    [],
  );
  assertEquals(
    nota("clima-vento-calmo", "**Sim**, vento ok (2 km/h).").length,
    3,
  );
});
