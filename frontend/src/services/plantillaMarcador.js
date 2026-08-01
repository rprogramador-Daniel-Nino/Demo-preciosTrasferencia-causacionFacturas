/* Aplica al HTML las marcas propuestas, verificando que cada fragmento exista
   literalmente antes de tocarlo.

   El modelo no reescribe el documento: devuelve pares fragmento→campo y las
   marcas las pone este código. Pedirle a un modelo que reescriba 112 páginas
   insertando etiquetas garantiza que altere texto por el camino —una tilde, una
   cifra, un párrafo resumido— y este documento se radica ante la DIAN. */

import { esCampoValido } from './plantillaVocabulario.js';

/* Trocea el HTML en segmentos de texto y de etiqueta. La búsqueda solo entra en
   los de texto: buscar sobre el HTML crudo permitiría marcar dentro de un
   atributo y romper la etiqueta. */
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
      segmentos.push({ tipo: 'etiqueta', valor: html.slice(abre) });
      break;
    }
    segmentos.push({ tipo: 'etiqueta', valor: html.slice(abre, cierra + 1) });
    i = cierra + 1;
  }
  return segmentos;
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
       cuenta ni se marquen dos veces. */
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
            { tipo: 'texto', valor: fragmento },
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
    else descartadas.push({ marca, motivo: 'el fragmento no aparece en el documento' });
  }

  return { html: segmentos.map((s) => s.valor).join(''), aplicadas, descartadas };
}
