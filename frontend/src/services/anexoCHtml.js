/* ─────────────────────────────────────────────────────────────────────────────
   anexoCHtml.js — ANEXO C: la matriz de rechazo.

   QUÉ ES. Medido sobre la plantilla de END GAME: cinco tablas seguidas, sin prosa entre
   ellas, con 442 filas en total.

     · Una tabla-resumen —«FILTRO APLICADO INTERNACIONALES | FILTROS APLICADO | N° POR
       FILTRO»— que cierra con «TOTAL, UNIVERSO».
     · Una tabla por grupo, con el nombre del grupo en su primera fila y el encabezado
       «Nº | NOMBRE DE LA COMPAÑÍA | FILTRO» en la segunda: diferencias funcionales (327,
       letra A), ventas netas faltantes (66, B), holdings (36, C) y las compañías
       comparables aceptadas (13, D).

   POR QUÉ HACÍA FALTA. Su tabla-resumen es un DUPLICADO de la «Tabla 16. Razones de
   rechazo» del cuerpo, con los mismos conteos. La 16 sí se regenera —tiene rótulo, y por
   ahí la encuentra el localizador—, pero la del anexo va pegada al encabezado y sin
   rótulo, así que nadie la alcanzaba: el informe salía con las dos tablas juntas y
   distintas, la del cuerpo con las cifras del estudio y la del anexo con las de END GAME.

   DE DÓNDE SALEN LOS DATOS. Del universo enriquecido (`enriquecerUniverso`), que marca
   cada candidata con su `motivoClave` y si fue seleccionada. La agrupación sigue la misma
   regla que la hoja «Matriz de rechazo» del Excel de soporte, para que el anexo y el libro
   no puedan decir cosas distintas:

     seleccionada           → compañías comparables
     sin `motivoClave`      → diferencias funcionales (ahí caen la reserva y las válidas
                              que no entraron al cupo, que es lo que declara el resumen)
     con `motivoClave`      → el grupo de ese motivo

   EL ORDEN Y LAS LETRAS los da `filasRazonesRechazo`, la misma función que llena la Tabla
   16, para que la letra de una compañía en el anexo sea la que el cuerpo del informe le
   asigna a su motivo. Los CONTEOS del resumen, en cambio, son el tamaño real de cada
   grupo listado: así la suma del anexo cuadra con su propio detalle y con el universo,
   aunque el embudo guardado venga de una corrida anterior.
   ───────────────────────────────────────────────────────────────────────────── */

import { filasRazonesRechazo, ETIQUETAS_MOTIVO } from './tablasInforme.js';
import { textoPlanoHtml, filasDe, celdasDe } from './tablasHtmlInforme.js';
import { localizarAnexo } from './anexoBHtml.js';
import { reescribirFilasHtml } from './tablasHtmlInforme.js';

/** Con este nombre se reporta el anexo cuando no se puede regenerar. */
export const NOMBRE_ANEXO_C = 'ANEXO C. Matriz de Rechazo';

/** La fila que cierra el resumen. */
export const ETIQUETA_TOTAL = 'TOTAL, UNIVERSO';

/** Reconoce la tabla-resumen por su encabezado: no tiene rótulo del que agarrarse. */
const RX_RESUMEN = /filtro\s*aplicado|n[°º]?\s*por\s*filtro/i;

/** Reconoce el encabezado de una tabla de listado. */
const RX_LISTADO = /nombre de la compa/i;

/**
 * Las tablas de la zona del anexo, clasificadas.
 *
 * @param {string} zona
 * @returns {{resumen:object|null, listados:Array}} posiciones relativas a `zona`.
 */
export function tablasAnexoC(zona) {
  const texto = String(zona || '');
  const tablas = [...texto.matchAll(/<table(?:\s[^>]*)?>[\s\S]*?<\/table\s*>/gi)]
    .map((m) => ({ xml: m[0], inicio: m.index, fin: m.index + m[0].length }));

  let resumen = null;
  const listados = [];
  tablas.forEach((t) => {
    const filas = filasDe(t.xml);
    if (!filas.length) return;
    const primeras = filas.slice(0, 2).map((f) => textoPlanoHtml(f.xml)).join(' ');
    if (!resumen && RX_RESUMEN.test(primeras)) { resumen = t; return; }
    if (RX_LISTADO.test(primeras)) listados.push(t);
  });
  return { resumen, listados };
}

/**
 * Agrupa el universo evaluado por motivo, para guardarlo con el estudio.
 *
 * La corre el motor de comparables, que es quien tiene el universo enriquecido; el
 * generador del informe no lo tiene —`universo` no se persiste porque son miles de filas
 * con la descripción de negocio— y por eso lo que viaja es este resultado, solo los nombres.
 *
 * @param {Array} universoEnriquecido  lo que devuelve `enriquecerUniverso`.
 * @returns {{porMotivo:object, universo:number}} listo para `study.matrizRechazo`.
 */
export function matrizDeRechazo(universoEnriquecido) {
  const candidatas = (universoEnriquecido || []).filter((c) => c && String(c.name || '').trim());
  const porMotivo = {};
  candidatas.forEach((c) => {
    /* Las que el motor no marcó con un motivo y no entraron a la muestra son las diferencias
       funcionales: superaron los filtros objetivos y no integran la muestra. Es la misma
       regla que aplica la hoja «Matriz de rechazo» del Excel de soporte. */
    const clave = c.seleccionada ? 'aceptadas' : (c.motivoClave || 'rigorFuncional');
    if (!porMotivo[clave]) porMotivo[clave] = [];
    porMotivo[clave].push(String(c.name).trim());
  });
  Object.keys(porMotivo).forEach((k) => {
    porMotivo[k].sort((a, b) => a.localeCompare(b, 'es'));
  });
  return { porMotivo, universo: candidatas.length };
}

/**
 * Los grupos que publica el anexo, en el orden y con las letras del cuerpo del informe.
 *
 * @param {object} estudio  con `matrizRechazo` y `embudoSeleccion`.
 * @returns {Array<{clave:string, etiqueta:string, letra:string, companias:string[]}>}
 *          sin los grupos vacíos.
 */
export function gruposDelAnexoC(estudio) {
  const study = estudio || {};
  const matriz = study.matrizRechazo || null;
  const porMotivo = (matriz && matriz.porMotivo) || null;
  if (!porMotivo || !Object.keys(porMotivo).length) return [];

  /* El orden y las etiquetas salen de la misma función que llena la Tabla 16, para que la
     letra de una compañía en el anexo sea la que el cuerpo del informe le da a su motivo. */
  const { filas } = filasRazonesRechazo(study.embudoSeleccion);

  const grupos = [];
  const vistas = new Set();
  filas.forEach((f) => {
    const companias = Array.isArray(porMotivo[f.clave]) ? porMotivo[f.clave] : [];
    vistas.add(f.clave);
    if (companias.length) grupos.push({ clave: f.clave, etiqueta: f.etiqueta, companias });
  });

  /* Un motivo que la matriz tiene y el embudo no declara se publica IGUAL, al final. Pasa
     cuando el embudo guardado es de una corrida anterior a la matriz —o al revés—, y
     descartarlo dejaría compañías fuera del anexo sin que nada lo dijera: la suma de los
     grupos tiene que seguir dando el universo evaluado, que es lo que hace verificable esta
     matriz ante quien la revise. */
  Object.keys(porMotivo).forEach((clave) => {
    if (vistas.has(clave)) return;
    const companias = porMotivo[clave] || [];
    if (!companias.length) return;
    grupos.push({ clave, etiqueta: ETIQUETAS_MOTIVO[clave] || clave, companias });
  });

  /* Las letras se asignan al final, corridas sobre los grupos que quedan: así coinciden con
     las de la Tabla 16, que también las asigna sobre sus filas no vacías. */
  return grupos.map((g, i) => ({ ...g, letra: LETRAS_ANEXO[i] || '' }));
}

const LETRAS_ANEXO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/* Filas del resumen: una por grupo con su letra y su conteo REAL, más el total. */
function filasResumen(grupos, universo) {
  const filas = grupos.map((g) => [g.etiqueta, g.letra, String(g.companias.length)]);
  filas.push([ETIQUETA_TOTAL, '', String(universo)]);
  return filas;
}

/* El título de una tabla de listado, tal como lo escribe la plantilla: en mayúsculas. */
function tituloDeGrupo(grupo) {
  /* La etiqueta del cuerpo del informe es una frase con su explicación —«Diferencias
     funcionales: perfil no comparable con la parte examinada»—; el anexo titula con el
     concepto a secas, que es lo que cabe en la fila. */
  return String(grupo.etiqueta).split(':')[0].trim().toUpperCase();
}

/**
 * Reescribe una tabla de listado: su título, su encabezado y una fila por compañía.
 *
 * El molde da el markup —celdas, párrafos y negritas— y de él se conservan las DOS primeras
 * filas: el título del grupo (que se reescribe) y el encabezado de columnas (que no).
 */
export function reescribirListado(tablaMolde, grupo) {
  const filas = filasDe(tablaMolde);
  if (filas.length < 2) return tablaMolde;

  const cuerpo = grupo.companias.map((n, i) => [String(i + 1), n, grupo.letra]);
  /* `filasEncabezado: 2` deja el título y la cabecera de columnas intactos; el molde de las
     filas nuevas es la primera de datos, que es la tercera de la tabla. */
  let salida = reescribirFilasHtml(tablaMolde, cuerpo, { filasEncabezado: 2, pie: false });

  /* Y el título del grupo, que vive en la primera fila. */
  const filasSalida = filasDe(salida);
  const celdas = celdasDe(filasSalida[0].xml);
  if (celdas.length) {
    const primera = filasSalida[0].xml.replace(
      /<(td|th)((?:\s[^>]*)?)>([\s\S]*?)<\/\1\s*>/i,
      (todo, etiqueta, atributos, contenido) => {
        const abre = /^(\s*(?:<(?:p|strong|b|em|span|u)(?:\s[^>]*)?>)*)/.exec(contenido)[1] || '';
        const cierra = /((?:<\/(?:p|strong|b|em|span|u)\s*>\s*)*)$/.exec(contenido)[1] || '';
        return '<' + etiqueta + atributos + '>' + abre + tituloDeGrupo(grupo) + cierra
          + '</' + etiqueta + '>';
      });
    salida = salida.slice(0, filasSalida[0].inicio) + primera + salida.slice(filasSalida[0].fin);
  }
  return salida;
}

/**
 * Regenera el ANEXO C con la matriz de rechazo del estudio.
 *
 * Todo o nada, igual que el ANEXO B: sin el universo evaluado no se puede llenar el
 * detalle por compañía, y un anexo con unos grupos del estudio y otros del informe del que
 * salió la plantilla es la peor forma de fallar. Se avisa y se deja intacto.
 *
 * @param {string} html
 * @param {object} estudio  necesita `universoEnriquecido` y `embudoSeleccion`.
 * @param {string[]} [avisos]
 * @returns {string}
 */
export function actualizarAnexoCHtml(html, estudio, avisos) {
  const salida = String(html || '');
  const study = estudio || {};
  const anotar = (texto) => { if (Array.isArray(avisos)) avisos.push(texto); };

  const zonaC = localizarAnexo(salida, 'c');
  if (!zonaC) { anotar(NOMBRE_ANEXO_C); return salida; }

  const zona = salida.slice(zonaC.inicio, zonaC.fin);
  const { resumen, listados } = tablasAnexoC(zona);
  if (!resumen || !listados.length) { anotar(NOMBRE_ANEXO_C); return salida; }

  const grupos = gruposDelAnexoC(study);
  if (!grupos.length) {
    anotar(NOMBRE_ANEXO_C + ': el estudio no trae la matriz del universo evaluado, así que el '
      + 'anexo se deja como estaba. Abre el paso 3 del motor de comparables con el cribado de '
      + 'Capital IQ cargado para que se calcule.');
    return salida;
  }

  const universo = Number(study.matrizRechazo && study.matrizRechazo.universo) || 0;

  /* De atrás hacia adelante: cada sustitución desplaza los offsets de lo anterior. El
     resumen va antes que los listados en el documento, así que se reescribe al final. */
  const moldeListado = listados[0].xml;
  const nuevos = grupos.map((g) => reescribirListado(moldeListado, g));
  const separador = listados[1]
    ? zona.slice(listados[0].fin, listados[1].inicio)
    : '';

  let zonaNueva = zona.slice(0, listados[0].inicio)
    + nuevos.join(separador)
    + zona.slice(listados[listados.length - 1].fin);

  /* El resumen se localiza otra vez sobre la zona ya cambiada: su posición no se movió
     —está antes de los listados—, pero recalcularlo evita depender de ese orden. */
  const { resumen: resumen2 } = tablasAnexoC(zonaNueva);
  if (resumen2) {
    const tabla = reescribirFilasHtml(
      zonaNueva.slice(resumen2.inicio, resumen2.fin), filasResumen(grupos, universo), { pie: false });
    zonaNueva = zonaNueva.slice(0, resumen2.inicio) + tabla + zonaNueva.slice(resumen2.fin);
  }

  return salida.slice(0, zonaC.inicio) + zonaNueva + salida.slice(zonaC.fin);
}
