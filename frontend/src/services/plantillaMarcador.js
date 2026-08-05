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

/* Agrupa los segmentos en "corridas": tramos de texto visible contiguo
   delimitados por las etiquetas ORIGINALES del documento. Las etiquetas
   insertadas al marcar (sin original:true) no interrumpen la corrida, así que
   el texto ya marcado sigue contando para numerar las apariciones.

   Cada corrida es la lista de piezas que la componen, con el índice del
   segmento del que salió cada una: eso permite pasar de "aparición número N
   del documento" a "posición dentro de tal segmento", que es lo que hace falta
   para marcarla.

   Esta agrupación es también la que decide si un fragmento está partido por una
   frontera real del HTML: si no aparece dentro de ninguna corrida, o no está o
   está partido. */
function construirCorridas(segmentos) {
  const corridas = [];
  let actual = [];
  for (let i = 0; i < segmentos.length; i++) {
    const s = segmentos[i];
    if (s.tipo === 'etiqueta' && s.original) {
      if (actual.length) corridas.push(actual);
      actual = [];
    } else if (s.tipo === 'etiqueta') {
      /* Etiqueta insertada al marcar: no interrumpe la corrida. */
    } else {
      // tipo === 'texto' o 'marcado'
      actual.push({ indice: i, tipo: s.tipo, valor: s.valor });
    }
  }
  if (actual.length) corridas.push(actual);
  return corridas;
}

/* Apariciones no solapadas de `fragmento` en `texto`, con sus posiciones. */
function posicionesEn(texto, fragmento) {
  const posiciones = [];
  let desde = 0;
  for (;;) {
    const pos = texto.indexOf(fragmento, desde);
    if (pos === -1) break;
    posiciones.push(pos);
    desde = pos + fragmento.length;
  }
  return posiciones;
}

/* Cuenta las apariciones de `fragmento` en el HTML **exactamente igual que las
   cuenta `aplicarMarcas`**: solo dentro del texto visible y sin cruzar las
   fronteras de las etiquetas originales. Contar sobre el HTML crudo daría otro
   número —marcaría dentro de atributos y uniría texto de párrafos distintos— y
   entonces la traducción de ocurrencia local a global no cuadraría. */
export function contarApariciones(html, fragmento) {
  if (!fragmento) return 0;
  let n = 0;
  for (const corrida of construirCorridas(segmentar(String(html || '')))) {
    n += posicionesEn(corrida.map((p) => p.valor).join(''), fragmento).length;
  }
  return n;
}

/* Índice del texto visible de un documento SIN MARCAR: una entrada por corrida
   con el desplazamiento del HTML donde empieza. Se calcula una vez por
   documento y se reutiliza para todos los fragmentos y todos los trozos: sin
   esto `proponerMarcas` volvía a segmentar las 112 páginas por cada fragmento
   de cada trozo, unas quinientas veces.

   Exige HTML sin marcar porque `inicio + posición` solo equivale a un
   desplazamiento del HTML mientras no haya etiquetas insertadas dentro de la
   corrida. `proponerMarcas` siempre trabaja sobre el documento crudo. */
function indexarTexto(html) {
  const corridas = [];
  let actual = null;
  let offset = 0;
  for (const s of segmentar(String(html || ''))) {
    if (s.tipo === 'texto') {
      if (!actual) actual = { texto: '', inicio: offset };
      actual.texto += s.valor;
    } else if (actual) {
      corridas.push(actual);
      actual = null;
    }
    offset += s.valor.length;
  }
  if (actual) corridas.push(actual);
  return corridas;
}

/* Apariciones de `fragmento` en el texto visible, en orden de documento. */
function aparicionesEn(corridas, fragmento) {
  const lista = [];
  for (let c = 0; c < corridas.length; c++) {
    for (const pos of posicionesEn(corridas[c].texto, fragmento)) {
      lista.push({ corrida: c, pos, offset: corridas[c].inicio + pos });
    }
  }
  return lista;
}

/* Texto a los dos lados de una aparición, cruzando corridas si hace falta. Al
   cruzar una frontera real del documento mete un espacio para no pegar dos
   palabras de párrafos distintos. */
function contextoDe(textos, c, pos, largo, radio) {
  let antes = textos[c].slice(0, pos);
  for (let k = c - 1; k >= 0 && antes.length < radio; k--) antes = textos[k] + ' ' + antes;
  let despues = textos[c].slice(pos + largo);
  for (let k = c + 1; k < textos.length && despues.length < radio; k++) despues += ' ' + textos[k];
  return {
    antes: antes.slice(-radio).replace(/\s+/g, ' '),
    despues: despues.slice(0, radio).replace(/\s+/g, ' '),
  };
}

/* Motivos de descarte. Se exportan porque quien los muestra tiene que
   distinguirlos: el solape es benigno y los otros dos no. */
export const MOTIVO_NO_APARECE = 'el fragmento no aparece en el documento';
export const MOTIVO_SOLAPE = 'se solapa con una marca ya aplicada';
export const MOTIVO_SIN_APARICION_LIBRE = 'no queda una aparición libre para esta ocurrencia';

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

    /* La ocurrencia se cuenta sobre TODAS las apariciones del documento,
       incluidas las que ya quedaron dentro de una marca anterior. Contar solo
       las libres —como se hacía antes— renumera el documento después de cada
       marca: con tres apariciones y marcas 1, 2 y 3, la segunda marca caía en
       la tercera aparición y la tercera marca se quedaba sin sitio. En un
       informe eso significa sustituir en el lugar equivocado y dejar el dato
       del cliente anterior en otro. */
    const corridas = construirCorridas(segmentos);
    let vistas = 0;
    let objetivo = null;   // { indice, local } del segmento donde marcar
    let alcanzada = false; // la aparición pedida existe, aunque no sea marcable

    for (const corrida of corridas) {
      const texto = corrida.map((p) => p.valor).join('');
      for (const pos of posicionesEn(texto, fragmento)) {
        vistas++;
        if (vistas !== ocurrencia) continue;
        alcanzada = true;
        /* Solo es marcable si cae completa dentro de una única pieza de texto
           todavía sin marcar. Si cruza dos piezas o cae dentro de una ya
           marcada, se solapa con una marca anterior. */
        let inicio = 0;
        for (const pieza of corrida) {
          const fin = inicio + pieza.valor.length;
          if (pos >= inicio && pos + fragmento.length <= fin) {
            if (pieza.tipo === 'texto') objetivo = { indice: pieza.indice, local: pos - inicio };
            break;
          }
          inicio = fin;
        }
        break;
      }
      if (alcanzada) break;
    }

    if (objetivo) {
      const v = segmentos[objetivo.indice].valor;
      segmentos.splice(
        objetivo.indice, 1,
        { tipo: 'texto', valor: v.slice(0, objetivo.local) },
        { tipo: 'etiqueta', valor: '<span data-campo="' + campo + '">' },
        { tipo: 'marcado', valor: fragmento },
        { tipo: 'etiqueta', valor: '</span>' },
        { tipo: 'texto', valor: v.slice(objetivo.local + fragmento.length) }
      );
      aplicadas++;
      continue;
    }

    /* Tres motivos, y confundirlos cuesta caro:
       - vistas === 0  → el fragmento no está: el modelo lo reescribió al
                         proponerlo.
       - alcanzada     → la aparición pedida existe pero ya la cubre otra marca:
                         solape, y eso sí es benigno.
       - resto         → el documento no tiene tantas apariciones: la numeración
                         venía mal y el dato del cliente anterior sobrevive.
                         NO es benigno. */
    if (vistas === 0) descartadas.push({ marca, motivo: MOTIVO_NO_APARECE });
    else if (alcanzada) descartadas.push({ marca, motivo: MOTIVO_SOLAPE });
    else descartadas.push({ marca, motivo: MOTIVO_SIN_APARICION_LIBRE });
  }

  return { html: segmentos.map((s) => s.valor).join(''), aplicadas, descartadas };
}

/* Contexto alrededor de la aparición `ocurrencia` de `fragmento`: ~`radio`
   caracteres de texto a cada lado. El revisor humano es la única defensa contra
   una marca mal asignada, y sin contexto no se puede saber si una "2.ª
   aparición" de un NIT es la del contribuyente o la del vinculado.

   Solo texto visible: se salta etiquetas y, al cruzar una frontera real del
   documento, mete un espacio para no pegar dos palabras de párrafos distintos.
   Es material de pantalla; no se usa para decidir dónde marcar. */
export function contextoDeMarca(html, fragmento, ocurrencia = 1, radio = 60) {
  if (!fragmento) return null;
  const textos = construirCorridas(segmentar(String(html || '')))
    .map((corrida) => corrida.map((p) => p.valor).join(''));
  let vistas = 0;
  for (let c = 0; c < textos.length; c++) {
    for (const pos of posicionesEn(textos[c], fragmento)) {
      if (++vistas !== ocurrencia) continue;
      return contextoDe(textos, c, pos, fragmento.length, radio);
    }
  }
  return null;
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
    model: 'gemini-2.0-flash',
    contents: [{ parts: [{ text: prompt }] }],
  });
  /* Todas las partes, no solo la primera: los modelos parten la respuesta. */
  return (respuesta.data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
}

/* Devuelve `{ marcas, trozosEnviados, trozosFallidos, rechazadasPorVocabulario }`.
   No solo las marcas: un marcado parcial silencioso es el fallo que este
   proyecto ya sufrió dos veces con las imágenes. Un PDF de 112 páginas son unas
   25 llamadas, y basta un 429 o un corte por longitud para que un tramo entero
   quede sin marcar. El patrón es el de `comparablesEngine.js` con
   `veredicto.fallidas`: se cuenta lo que salió mal y se publica.

   Las ocurrencias se traducen de locales (el modelo solo ve su trozo, así que
   numera "primera aparición" dentro de él) a globales, porque `aplicarMarcas`
   cuenta sobre el documento completo. La traducción es exacta porque `trocear`
   conserva el texto carácter a carácter y corta siempre en un '<': el prefijo
   ya procesado se puede contar por separado y sumar. */
export async function proponerMarcas(html, opciones = {}) {
  const pedir = opciones.pedir || pedirAlModelo;
  const completo = String(html || '');
  const marcas = [];
  let trozosEnviados = 0;
  let trozosFallidos = 0;
  let rechazadasPorVocabulario = 0;

  /* El documento se indexa una sola vez y de ahí sale todo: cuántas apariciones
     de un fragmento quedan antes del trozo actual (para traducir la ocurrencia)
     y el contexto de cada marca (para el revisor). Las apariciones por fragmento
     se memorizan porque el mismo texto —la razón social, el NIT— se propone en
     casi todos los trozos. */
  const corridas = indexarTexto(completo);
  const cache = new Map();
  const apariciones = (fragmento) => {
    if (!cache.has(fragmento)) cache.set(fragmento, aparicionesEn(corridas, fragmento));
    return cache.get(fragmento);
  };
  const textos = corridas.map((c) => c.texto);

  const trozos = trocear(completo, opciones.maxCaracteres);

  /* Desplazamiento en el HTML donde empieza cada trozo. `trocear` conserva el
     texto carácter a carácter y corta siempre en un '<', así que basta acumular
     longitudes: ninguna aparición queda partida por el corte. Se precalculan
     todos porque los trozos ya no se recorren en orden. */
  const inicios = [];
  let desplazamiento = 0;
  for (const t of trozos) {
    inicios.push(desplazamiento);
    desplazamiento += t.length;
  }

  const avisar = typeof opciones.avisar === 'function' ? opciones.avisar : () => {};
  /* Un informe de 112 páginas son unos veinte trozos, y en serie eran cinco
     minutos de reloj con un spinner que no decía nada: indistinguible de un
     cuelgue. De cuatro en cuatro baja a poco más de un minuto. No se sube más
     porque al otro lado hay un límite de peticiones por minuto y un 429 no
     acelera nada: convierte un trozo en texto sin marcar. */
  const concurrencia = Math.max(1, opciones.concurrencia || 4);

  /* Los resultados se depositan por índice y se aplanan al final, así que el
     orden de las marcas no depende de cuál respondió primero: con las mismas
     respuestas sale el mismo documento. */
  const porTrozo = new Array(trozos.length);
  let siguiente = 0;
  let terminados = 0;

  const trabajar = async () => {
    for (;;) {
      const i = siguiente++;
      if (i >= trozos.length) return;

      const inicioDelTrozo = inicios[i];
      const previas = (fragmento) =>
        apariciones(fragmento).filter((a) => a.offset < inicioDelTrozo).length;

      const delTrozo = [];
      try {
        const texto = await pedir(promptDe(trozos[i]));
        const json = extraerJSON(texto);
        for (const m of (json && json.marcas) || []) {
          if (!m || !m.fragmento) continue;
          if (!esCampoValido(m.campo)) {
            /* El modelo estaba diciendo "aquí hay un dato del cliente anterior"
               con un nombre que no existe. Descartarlo sin contarlo pierde el
               aviso. */
            rechazadasPorVocabulario++;
            continue;
          }
          const fragmento = String(m.fragmento);
          const local = Number(m.ocurrencia) > 0 ? Number(m.ocurrencia) : 1;
          const ocurrencia = previas(fragmento) + local;
          const donde = apariciones(fragmento)[ocurrencia - 1];
          delTrozo.push({
            fragmento,
            campo: m.campo,
            ocurrencia,
            /* Contexto para el revisor humano. Sale del mismo índice, así que
               corresponde exactamente a la aparición que se va a marcar. Es null
               si la ocurrencia traducida no existe —el modelo devolvió un
               fragmento que reescribió—, y entonces el revisor muestra solo el
               fragmento. */
            contexto: donde
              ? contextoDe(textos, donde.corrida, donde.pos, fragmento.length, 60)
              : null,
          });
        }
      } catch (err) {
        /* Un trozo que falla no debe tumbar el marcado entero: son decenas de
           llamadas y perder todo por una es inaceptable. Pero se cuenta, y aquí
           caen tanto el fallo de la llamada como la respuesta sin JSON. */
        trozosFallidos++;
        console.error('[marcado] trozo ' + (i + 1) + ' de ' + trozos.length + ':', err);
      }

      porTrozo[i] = delTrozo;
      trozosEnviados++;
      avisar({ terminados: ++terminados, total: trozos.length, fallidos: trozosFallidos });
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrencia, trozos.length) }, () => trabajar())
  );

  for (const lote of porTrozo) if (lote) marcas.push(...lote);

  /* Extensión a todas las apariciones del mismo texto.

     El modelo ve un trozo a la vez y marca lo que ahí le parece relevante, así
     que de un texto que se repite cuarenta veces —la razón social, el NIT, el
     objeto social— marca unas cuantas y deja el resto. Medido con el informe
     real: la razón social sobrevivía treinta y una veces sin marcar, y esas
     apariciones se radican con el nombre del contribuyente anterior.

     Si el modelo dijo que un texto corresponde a un campo, todas sus apariciones
     literales corresponden al mismo campo: es el mismo texto. Completar la serie
     es determinista, no cuesta otra llamada, y convierte una cobertura parcial en
     total.

     Se extiende sólo cuando el texto tiene un único campo asignado. Si el modelo
     le dio dos campos distintos en dos trozos, no hay forma de saber cuál vale
     para las apariciones que nadie miró: se deja como está y se cuenta, para que
     la revisión humana lo vea en vez de que el código elija a ciegas. */
  const campoPorFragmento = new Map();
  const ambiguos = new Set();
  for (const m of marcas) {
    const previo = campoPorFragmento.get(m.fragmento);
    if (previo === undefined) campoPorFragmento.set(m.fragmento, m.campo);
    else if (previo !== m.campo) ambiguos.add(m.fragmento);
  }

  let extendidas = 0;
  for (const [fragmento, campo] of campoPorFragmento) {
    if (ambiguos.has(fragmento)) continue;
    const yaMarcadas = new Set(
      marcas.filter((m) => m.fragmento === fragmento).map((m) => m.ocurrencia)
    );
    const todas = apariciones(fragmento);
    for (let i = 1; i <= todas.length; i++) {
      if (yaMarcadas.has(i)) continue;
      const donde = todas[i - 1];
      marcas.push({
        fragmento,
        campo,
        ocurrencia: i,
        contexto: contextoDe(textos, donde.corrida, donde.pos, fragmento.length, 60),
        /* Para que el revisor humano distinga lo que propuso el modelo de lo que
           completó el código: son decisiones con distinto respaldo. */
        extendida: true,
      });
      extendidas++;
    }
  }

  return {
    marcas,
    trozosEnviados,
    trozosFallidos,
    rechazadasPorVocabulario,
    extendidas,
    fragmentosAmbiguos: [...ambiguos],
  };
}
