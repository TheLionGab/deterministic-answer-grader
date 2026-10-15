// Nota de um chat com LLM sobre respostas JÁ COLETADAS (arquivo de respostas). Não chama API.
// Sai com 1 se alguma resposta trouxer dose, concentração de produto ou marca.
//
//   deno run --allow-read cli/avaliar.ts \
//     data/perguntas.json <respostas.json>

import {
  avaliarChat,
  type RespostaColetada,
  validarPerguntas,
} from "../src/avaliacao.ts";

const [caminhoPerguntas, caminhoRespostas] = Deno.args;
if (!caminhoPerguntas || !caminhoRespostas) {
  throw new Error("uso: avaliar.ts <perguntas.json> <respostas.json>");
}
const lerJson = async (caminho: string): Promise<unknown> =>
  JSON.parse(await Deno.readTextFile(caminho));

const perguntas = validarPerguntas(await lerJson(caminhoPerguntas));
const respostas = await lerJson(caminhoRespostas) as RespostaColetada[];
if (!Array.isArray(respostas)) throw new Error("respostas: esperado lista");
if (new Set(respostas.map((r) => r.id)).size !== respostas.length) {
  throw new Error("respostas: id duplicado");
}

const metricas = avaliarChat(perguntas, respostas);
Deno.stdout.writeSync(
  new TextEncoder().encode(`${JSON.stringify(metricas, null, 2)}\n`),
);
if (metricas.violacoes > 0) Deno.exit(1);
