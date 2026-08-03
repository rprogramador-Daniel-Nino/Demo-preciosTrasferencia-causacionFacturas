/* Aplica al HTML las marcas propuestas, verificando que cada fragmento exista
   literalmente antes de tocarlo.

   El modelo no reescribe el documento: devuelve pares fragmento→campo y las
   marcas las pone este código. Pedirle a un modelo que reescriba 112 páginas
   insertando etiquetas garantiza que altere texto por el camino —una tilde, una
   cifra, un párrafo resumido— y este documento se radica ante la DIAN. */

import axios from 'axios';
import { VOCABULARIO, esCampoValido } from './plantillaVocabulario.js';
import { extraerJSON } from './comparablesEngine.js';

/* Trocea el HTML en segmentos de texto y de etiqueta. La búsqueda solo entra en
   los de texto: buscar sobre el HTML crudo permitiría marcar dentro de un
   atributo y romper la etiqueta.

   Las etiquetas originales se marcan con original:true para distinguirlas de las
   que se insertan al marcar. Eso permite detectar cuándo un fragmento está
   partido por una frontera real del documento vs. una etiqueta insertada. */
function segmentar(html) {
  const segmentos = [];
  let i = 0;
  while (i < html.length) {
    const abre = html.indexOf('<', i);
    if (abre === -1) {
      segmentos.push({ tipo: 'texto', valor: html.slice(i) });
      break;
    }
    if (abre > i) segmentos.push({ tipo: 'texto', valor: html.slice(i, abre) });
    const cierra = html.indexOf('>', abre);
    if (cierra === -1) {
      segmentos.push({ tipo: 'etiqueta', valor: html.slice(abre), original: true });
      break;
    }
    segmentos.push({ tipo: 'etiqueta', valor: html.slice(abre, cierra + 1), original: true });
    i = cierra + 1;
  }
  return segmentos;
}

/* Devuelve un array de strings que son trozos de texto visible, respetando las
   fronteras de las etiquetas originales del documento. Las etiquetas
   insertadas al marcar (sin original:true) no interrumpen la continuidad.

   Esto permite detectar si un fragmento está partido por una frontera real del
   HTML original: si busca en estos tokens y aparece completamente en uno,
   existe contiguo; si no aparece en ninguno, está partido o no existe. */
function obtenerTokenosTexto(segmentos) {
  const tokens = [];
  let token = '';
  for (const s of segmentos) {
    if (s.tipo === 'etiqueta' && s.original) {
      if (token) tokens.push(token);
      token = '';
    } else if (s.tipo === 'etiqueta') {
      // Etiqueta insertada (sin original:true): ignoro pero continúo el token
    } else {
      // tipo === 'texto' o 'marcado'
      token += s.valor;
    }
  }
  if (token) tokens.push(token);
  return tokens;
}

export function aplicarMarcas(html, marcas) {
  const segmentos = segmentar(html);
  const descartadas = [];
  let aplicadas = 0;

  for (const marca of marcas || []) {
    const { fragmento, campo } = marca || {};
    const ocurrencia = marca && marca.ocurrencia ? marca.ocurrencia : 1;

    if (!campo || !esCampoValido(campo)) {
      descartadas.push({ marca, motivo: 'el campo no está en el vocabulario' });
      continue;
    }
    if (!fragmento) {
      descartadas.push({ marca, motivo: 'la marca no trae fragmento' });
      continue;
    }

    /* Se recorre contando apariciones en el texto ya segmentado, de modo que
       las marcas anteriores (que introdujeron etiquetas) no desplacen la
       cuenta ni se marquen dos veces.

       Solo busca en segmentos tipo 'texto': los marcados quedan ineligibles para
       evitar solapamientos. */
    let vistas = 0;
    let puesta = false;
    for (let s = 0; s < segmentos.length && !puesta; s++) {
      if (segmentos[s].tipo !== 'texto') continue;
      let desde = 0;
      for (;;) {
        const pos = segmentos[s].valor.indexOf(fragmento, desde);
        if (pos === -1) break;
        vistas++;
        if (vistas === ocurrencia) {
          const v = segmentos[s].valor;
          segmentos.splice(
            s, 1,
            { tipo: 'texto', valor: v.slice(0, pos) },
            { tipo: 'etiqueta', valor: '<span data-campo="' + campo + '">' },
            { tipo: 'marcado', valor: fragmento },
            { tipo: 'etiqueta', valor: '</span>' },
            { tipo: 'texto', valor: v.slice(pos + fragmento.length) }
          );
          puesta = true;
          break;
        }
        desde = pos + fragmento.length;
      }
    }

    if (puesta) aplicadas++;
    else {
      const tokens = obtenerTokenosTexto(segmentos);
      if (tokens.some(t => t.includes(fragmento))) {
        descartadas.push({ marca, motivo: 'se solapa con una marca ya aplicada' });
      } else {
        descartadas.push({ marca, motivo: 'el fragmento no aparece en el documento' });
      }
    }
  }

  return { html: segmentos.map((s) => s.valor).join(''), aplicadas, descartadas };
}

/* 112 páginas no caben en una petición. Se trocea por límites de etiqueta para
   no partir el HTML por la mitad; las marcas se acumulan y cada fragmento se
   verifica después contra el documento completo. */
export function trocear(html, maxCaracteres = 12000) {
  const trozos = [];
  let actual = '';
  for (const parte of html.split(/(?=<)/)) {
    if (actual && actual.length + parte.length > maxCaracteres) {
      trozos.push(actual);
      actual = '';
    }
    actual += parte;
  }
  if (actual) trozos.push(actual);
  return trozos;
}

const listaDeCampos = () =>
  VOCABULARIO.map((v) => '- ' + v.campo + ': ' + v.etiqueta + ' (' + v.grupo + ')').join('\n');

const promptDe = (trozo) =>
  'Eres un asistente que prepara una plantilla de Informe Local de Precios de Transferencia.\n' +
  'Recibes un fragmento del informe del año anterior. Debes señalar qué textos concretos son ' +
  'datos del contribuyente que cambian de un informe a otro.\n\n' +
  'Campos disponibles (elige SOLO de esta lista, no inventes nombres):\n' + listaDeCampos() +
  '\n\nFragmento:\n' + trozo +
  '\n\nResponde ÚNICAMENTE con un objeto JSON válido, sin marcas markdown, con esta forma exacta:\n' +
  '{"marcas":[{"fragmento":"","campo":"","ocurrencia":1}]}\n' +
  '"fragmento" debe ser el texto EXACTO tal y como aparece en el fragmento, sin reescribirlo, ' +
  'sin corregir tildes y sin incluir etiquetas HTML. "ocurrencia" es 1 para la primera ' +
  'aparición de ese texto, 2 para la segunda, y así. Si no hay nada que marcar, responde ' +
  '{"marcas":[]}.';

/* Llamada real al proxy. Se aísla aquí para que los tests inyecten la suya. */
async function pedirAlModelo(prompt) {
  const respuesta = await axios.post('/api/gemini', {
    model: 'gemini-3-flash-preview',
    contents: [{ parts: [{ text: prompt }] }],
  });
  /* Todas las partes, no solo la primera: los modelos parten la respuesta. */
  return (respuesta.data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
}

export async function proponerMarcas(html, opciones = {}) {
  const pedir = opciones.pedir || pedirAlModelo;
  const marcas = [];

  for (const trozo of trocear(html, opciones.maxCaracteres)) {
    let texto;
    try {
      texto = await pedir(promptDe(trozo));
    } catch (err) {
      /* Un trozo que falla no debe tumbar el marcado entero: son decenas de
         llamadas y perder todo por una es inaceptable. */
      console.error('[marcado] un trozo falló:', err);
      continue;
    }
    let json;
    try {
      json = extraerJSON(texto);
    } catch {
      console.error('[marcado] respuesta sin JSON utilizable');
      continue;
    }
    for (const m of (json && json.marcas) || []) {
      if (!m || !m.fragmento || !esCampoValido(m.campo)) continue;
      marcas.push({
        fragmento: String(m.fragmento),
        campo: m.campo,
        ocurrencia: Number(m.ocurrencia) > 0 ? Number(m.ocurrencia) : 1,
      });
    }
  }
  return marcas;
}
