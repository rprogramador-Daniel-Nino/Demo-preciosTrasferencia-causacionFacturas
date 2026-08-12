/* ─────────────────────────────────────────────────────────────────────────────
   anexoBHtml.js — ANEXO B: descripciones de comparables y estados financieros.

   QUÉ ES EL ANEXO B. Por CADA comparable de la muestra, tres tablas seguidas:

     1. «NOMBRE DE LA COMPAÑÍA COMPARABLE | DESCRIPCIÓN ACTIVIDAD», con la razón social
        y el párrafo que describe a qué se dedica.
     2. Estado de resultados: ventas netas, costo de los bienes vendidos, beneficio bruto,
        gastos operativos y utilidad de operación.
     3. Balance: activos totales, cuentas por pagar, cuentas por cobrar, PP&E, inventario
        y efectivo.

   POR QUÉ NO SIRVE EL MECANISMO DE LAS DEMÁS TABLAS. Las otras doce son una tabla que
   está una vez en el documento y a la que solo hay que cambiarle las filas. Aquí el
   número de BLOQUES depende de la muestra: la plantilla de END GAME trae trece, y un
   estudio con cuatro comparables necesita cuatro. Hay que crear y retirar bloques
   enteros, no filas.

   LAS FILAS DE CADA COMPARABLE NO SON LAS MISMAS. Medido sobre la plantilla real: el
   estado de resultados de AKATSUKI tiene cinco filas, el de COLOPL seis —añade «Gastos de
   publicidad»— y el de IGG siete —I+D y publicidad—; en el balance, FUN YOURS no trae
   inventario y NEPTUNE no trae cuentas por pagar. No es un descuido de la plantilla: cada
   compañía reporta lo que reporta, y el prompt del parser lo respeta devolviendo `null`
   en el rubro que no figura y no un cero. Así que aquí se emite una fila por cada rubro
   QUE LA COMPARABLE TIENE, y las demás no se inventan.

   POR QUÉ EL MOLDE. La razón de ser de la ruta de PDF es conservar la presentación del
   informe del cliente. En lugar de emitir tablas nuevas, se clona el markup del primer
   bloque —etiquetas de celda, envoltura `<p>`, `<strong>` del nombre, incluso el
   separador de miles de sus cifras— y solo se cambia el contenido.
   ───────────────────────────────────────────────────────────────────────────── */

import {
  textoPlanoHtml, envolturaDe, filasDe, celdasDe, escaparTextoHtml,
} from './tablasHtmlInforme.js';

/* Una entrada del índice lleva el número de página pegado al final y NO abre sección: el
   índice repite «ANEXO B. Descripciones de comparables…55». Sin esta condición la búsqueda
   se queda en la tabla de contenido y el anexo de verdad no se toca. Es el mismo criterio
   que `plantillaMarcador.js` aplica para no marcar dentro del índice. */
const RX_ENTRADA_INDICE = /\d\s*$/;
const RX_BLOQUE_TEXTO = /<(p|h[1-6])(?:\s[^>]*)?>([\s\S]*?)<\/\1\s*>/gi;

/** Reconoce la cabecera de un bloque: la tabla que nombra a la compañía comparable. */
const RX_CABECERA_BLOQUE = /nombre de la compa/i;

/** Con este nombre se reporta el anexo cuando no se puede regenerar. */
export const NOMBRE_ANEXO_B = 'ANEXO B. Descripciones de comparables y Estados Financieros';

/**
 * Los rubros del ANEXO B, en el orden en que van en el informe.
 *
 * `patron` reconoce la etiqueta en la plantilla —para reutilizar SU redacción— y
 * `etiqueta` es la que se escribe cuando la plantilla no trae esa fila, que pasa con I+D
 * y publicidad. `campo` es el rubro del parser (`eeffDatos`).
 */
export const RUBROS_RESULTADOS = [
  { campo: 'ingresos_operacionales', etiqueta: 'Ventas netas', patron: /ventas netas|ingresos operacionales/i },
  { campo: 'costo_ventas', etiqueta: 'Costo de los bienes vendidos', patron: /costo de los bienes|costo de ventas/i },
  { campo: 'utilidad_bruta', etiqueta: 'Beneficio bruto', patron: /beneficio bruto|utilidad bruta/i },
  { campo: 'gastos_operacionales', etiqueta: 'Gastos operativos', patron: /gastos operativos|gastos de operaci/i },
  { campo: 'utilidad_operacional', etiqueta: 'Utilidad de operación', patron: /utilidad de operaci|utilidad operacional/i },
  { campo: 'gastos_investigacion_desarrollo', etiqueta: 'Gastos de investigación y desarrollo', patron: /investigaci/i },
  { campo: 'gastos_publicidad', etiqueta: 'Gastos de publicidad', patron: /publicidad/i },
];

export const RUBROS_BALANCE = [
  { campo: 'total_activos', etiqueta: 'Activos totales promedio', patron: /activos totales/i },
  { campo: 'cuentas_por_pagar', etiqueta: 'Promedio de cuentas por pagar netas', patron: /cuentas por pagar/i },
  { campo: 'cuentas_por_cobrar', etiqueta: 'Promedio de cuentas por cobrar netas', patron: /cuentas por cobrar/i },
  { campo: 'propiedad_planta_equipo', etiqueta: 'EPP neto promedio', patron: /epp|propiedad, planta|planta y equipo/i },
  { campo: 'inventarios', etiqueta: 'Inventario neto promedio', patron: /inventario/i },
  { campo: 'efectivo_y_equivalentes', etiqueta: 'Efectivo promedio y equivalentes de efectivo', patron: /efectivo/i },
];

/**
 * Dónde empieza y acaba la sección de un anexo.
 *
 * Del encabezado del anexo al del siguiente, o al final del documento si no hay otro. Se
 * descartan las entradas del índice, donde el título llega con el número de página pegado.
 *
 * @param {string} html
 * @param {string} letra  la del anexo: 'b', 'c', …
 * @returns {{inicio:number, fin:number, titulo:string}|null} `inicio` queda DESPUÉS del
 *          encabezado, que no hay que tocar.
 */
export function localizarAnexo(html, letra) {
  const texto = String(html || '');
  const buscada = String(letra || '').trim().toLowerCase();
  if (!/^[a-z]$/.test(buscada)) return null;

  const rxAbre = new RegExp('^anexo\\s*' + buscada + '\\b', 'i');
  /* Cualquier anexo con letra POSTERIOR cierra el que se busca. Se compara la letra en vez
     de fijar un rango en la expresión: así vale para cualquiera sin escribir uno por uno. */
  const cierra = (t) => {
    const m = /^anexo\s*([a-z])\b/i.exec(t);
    return !!m && m[1].toLowerCase() > buscada;
  };

  RX_BLOQUE_TEXTO.lastIndex = 0;
  let inicio = -1, titulo = '', fin = texto.length, m;
  while ((m = RX_BLOQUE_TEXTO.exec(texto)) !== null) {
    const t = textoPlanoHtml(m[2]);
    if (!t || RX_ENTRADA_INDICE.test(t)) continue;
    if (inicio < 0) {
      if (rxAbre.test(t)) { inicio = m.index + m[0].length; titulo = t; }
      continue;
    }
    if (cierra(t)) { fin = m.index; break; }
  }
  return inicio < 0 ? null : { inicio, fin, titulo };
}

/** La sección del ANEXO B. */
export function localizarAnexoB(html) {
  return localizarAnexo(html, 'b');
}

/**
 * Los bloques de comparable dentro de la zona del anexo.
 *
 * Un bloque es la tabla que nombra la compañía más las tablas que le siguen hasta la
 * cabecera del bloque siguiente, de modo que se llevan también las de cifras.
 *
 * @param {string} zona  el HTML entre el encabezado del anexo y el del siguiente.
 * @returns {Array<{inicio:number, fin:number, tablas:Array<{inicio:number, fin:number, xml:string}>}>}
 *          posiciones relativas a `zona`.
 */
export function bloquesAnexoB(zona) {
  const texto = String(zona || '');
  const tablas = [...texto.matchAll(/<table(?:\s[^>]*)?>[\s\S]*?<\/table\s*>/gi)]
    .map((m) => ({ xml: m[0], inicio: m.index, fin: m.index + m[0].length }));

  const bloques = [];
  tablas.forEach((t) => {
    const filas = filasDe(t.xml);
    const esCabecera = filas.length && RX_CABECERA_BLOQUE.test(textoPlanoHtml(filas[0].xml));
    if (esCabecera) {
      bloques.push({ inicio: t.inicio, fin: t.fin, tablas: [t] });
    } else if (bloques.length) {
      const actual = bloques[bloques.length - 1];
      actual.tablas.push(t);
      actual.fin = t.fin;
    }
  });
  return bloques;
}

/* Con qué separador de miles escribe sus cifras la plantilla. Se copia en vez de imponer
   el del sistema: el anexo original viene con el formato de la base de datos («23,652,000,000»)
   y cambiarlo a «23.652.000.000» sería un cambio visible que nadie pidió. */
function separadorDeMiles(bloqueHtml) {
  const texto = textoPlanoHtml(bloqueHtml);
  if (/\d,\d{3}(?:[,.]|\b)/.test(texto)) return ',';
  if (/\d\.\d{3}(?:[,.]|\b)/.test(texto)) return '.';
  return null;
}

/**
 * Formatea una cifra con el separador indicado, sin redondear: el anexo en tabla debe
 * mostrar el dato tal como lo leyó el parser, no una versión truncada al entero. «—»
 * cuando no hay dato.
 */
export function formatearCifra(valor, separador) {
  if (valor === null || valor === undefined || valor === '') return '—';
  const n = Number(valor);
  if (!Number.isFinite(n)) return '—';
  const negativo = n < 0;
  const [enteroStr, decStr] = Math.abs(n).toString().split('.');
  const conComas = Number(enteroStr).toLocaleString('en-US');
  const parteEntera = separador === '.' ? conComas.replace(/,/g, '.')
    : separador === ',' ? conComas
      : Number(enteroStr).toLocaleString('es-CO');
  const separadorDecimal = separador === '.' ? ',' : '.';
  const cuerpo = decStr ? parteEntera + separadorDecimal + decStr : parteEntera;
  return (negativo ? '-' : '') + cuerpo;
}

/* La etiqueta con la que la plantilla nombra un rubro, si la trae; si no, la del informe. */
function etiquetaDe(rubro, etiquetasPlantilla) {
  const hallada = etiquetasPlantilla.find((e) => rubro.patron.test(e));
  return hallada || rubro.etiqueta;
}

/* Reescribe una tabla de dos columnas con las filas dadas, clonando el markup del molde. */
function reescribirDosColumnas(tablaMolde, filas) {
  const filasMolde = filasDe(tablaMolde);
  if (filasMolde.length < 2) return tablaMolde;

  const molde = celdasDe(filasMolde[1].xml);
  if (molde.length < 2) return tablaMolde;

  const celda = (i, texto) => {
    const m = molde[Math.min(i, molde.length - 1)];
    const { abre, cierra } = envolturaDe(m.contenido);
    return '<' + m.etiqueta + m.atributos + '>' + abre + escaparTextoHtml(texto) + cierra
      + '</' + m.etiqueta + '>';
  };

  const cuerpo = filas.map(([a, b]) => '<tr>' + celda(0, a) + celda(1, b) + '</tr>').join('');
  const ultima = filasMolde[filasMolde.length - 1];
  return tablaMolde.slice(0, filasMolde[1].inicio) + cuerpo + tablaMolde.slice(ultima.fin);
}

/* Pone el año gravable en la segunda celda del encabezado («Descripción | 2024»). */
function conAnioEnCabecera(tablaHtml, year) {
  const filas = filasDe(tablaHtml);
  if (!filas.length) return tablaHtml;
  const celdas = celdasDe(filas[0].xml);
  if (celdas.length < 2) return tablaHtml;
  /* Solo si la celda es un año: si la plantilla puso otra cosa ahí, no se toca. */
  if (!/^\s*\d{4}\s*$/.test(textoPlanoHtml(celdas[1].contenido))) return tablaHtml;

  let vistas = 0;
  const filaNueva = filas[0].xml.replace(/<(td|th)((?:\s[^>]*)?)>([\s\S]*?)<\/\1\s*>/gi,
    (todo, etiqueta, atributos, contenido) => {
      if (vistas++ !== 1) return todo;
      const { abre, cierra } = envolturaDe(contenido);
      return '<' + etiqueta + atributos + '>' + abre + String(year) + cierra + '</' + etiqueta + '>';
    });
  return tablaHtml.slice(0, filas[0].inicio) + filaNueva + tablaHtml.slice(filas[0].fin);
}

/* Las etiquetas de la primera columna de una tabla, sin contar el encabezado. */
function etiquetasDeTabla(tablaHtml) {
  return filasDe(tablaHtml).slice(1)
    .map((f) => {
      const c = celdasDe(f.xml);
      return c.length ? textoPlanoHtml(c[0].contenido) : '';
    })
    .filter(Boolean);
}

/**
 * El bloque de tres tablas de una comparable, clonado del molde.
 *
 * @param {{tablas:Array}} molde  bloque de la plantilla del que se copia el markup.
 * @param {string} moldeHtml      su HTML, para leer el separador de miles.
 * @param {object} comparable     la fila del estudio, con `eeffDatos`.
 * @param {number} year
 * @returns {string}
 */
export function generarBloqueAnexoB(molde, moldeHtml, comparable, year) {
  const c = comparable || {};
  const datos = c.eeffDatos || {};
  const sep = separadorDeMiles(moldeHtml);

  const tablaNombre = reescribirDosColumnas(molde.tablas[0].xml, [[
    String(c.name || '').trim() || '—',
    String(c.descActividad || c.desc || '').trim() || 'Descripción de actividad no disponible.',
  ]]);

  /* Una fila por rubro QUE LA COMPARABLE TIENE. Los que no reporta no se inventan: es lo
     que hace la plantilla original, donde unas traen I+D y publicidad y otras no. */
  const filasDeRubros = (rubros, etiquetas) => rubros
    .filter((r) => datos[r.campo] !== null && datos[r.campo] !== undefined && datos[r.campo] !== '')
    .map((r) => [etiquetaDe(r, etiquetas), formatearCifra(datos[r.campo], sep)]);

  const tablaResultados = molde.tablas[1]
    ? conAnioEnCabecera(
      reescribirDosColumnas(molde.tablas[1].xml,
        filasDeRubros(RUBROS_RESULTADOS, etiquetasDeTabla(molde.tablas[1].xml))),
      year)
    : '';

  const tablaBalance = molde.tablas[2]
    ? conAnioEnCabecera(
      reescribirDosColumnas(molde.tablas[2].xml,
        filasDeRubros(RUBROS_BALANCE, etiquetasDeTabla(molde.tablas[2].xml))),
      year)
    : '';

  /* Lo que el molde tenga entre sus tablas —párrafos vacíos, saltos— se conserva, para no
     pegar las tablas unas a otras. */
  const separadores = [];
  for (let i = 1; i < molde.tablas.length; i++) {
    separadores.push(moldeHtml.slice(
      molde.tablas[i - 1].fin - molde.inicio, molde.tablas[i].inicio - molde.inicio));
  }

  return tablaNombre + (separadores[0] || '') + tablaResultados
    + (separadores[1] || '') + tablaBalance;
}

/**
 * Regenera el ANEXO B con las comparables del estudio.
 *
 * Es todo o nada. Si alguna comparable de la muestra no trae las cifras de su estado
 * financiero, no se emite un anexo a medias —unos bloques del estudio y otros del informe
 * del que salió la plantilla, que es la peor forma de fallar en un documento que se
 * radica—: se avisa y el anexo se deja intacto. Decisión del usuario, 2026-08-11.
 *
 * @param {string} html
 * @param {object} estudio
 * @param {string[]} [avisos]
 * @returns {string}
 */
export function actualizarAnexoBHtml(html, estudio, avisos) {
  const salida = String(html || '');
  const study = estudio || {};
  const anotar = (texto) => { if (Array.isArray(avisos)) avisos.push(texto); };

  const zonaB = localizarAnexoB(salida);
  if (!zonaB) { anotar(NOMBRE_ANEXO_B); return salida; }

  const zona = salida.slice(zonaB.inicio, zonaB.fin);
  const bloques = bloquesAnexoB(zona);
  if (!bloques.length || bloques[0].tablas.length < 3) {
    /* Sin un bloque completo del que copiar no hay forma de emitir el anexo conservando
       la presentación, y emitirlo con tablas propias lo dejaría con otro formato. */
    anotar(NOMBRE_ANEXO_B);
    return salida;
  }

  const comparables = (study.comparables || []).filter((c) => c && String(c.name || '').trim());
  if (!comparables.length) { anotar(NOMBRE_ANEXO_B); return salida; }

  /* Las que no traen cifras NO cancelan el anexo: salen con sus casillas en blanco y el
     aviso dice cuáles faltan.

     Antes se descartaba el anexo entero —una sola comparable sin estado financiero bastaba—
     y el documento se radicaba con el ANEXO B de la plantilla, es decir con las comparables
     y las cifras del contribuyente anterior. Un anexo con casillas vacías se ve y se
     completa; uno con los datos del año pasado se radica sin que nadie lo note. Entre
     quedarse corto y quedarse equivocado, corto. */
  const sinCifras = comparables.filter((c) => !c.eeffDatos);
  if (sinCifras.length) {
    anotar(NOMBRE_ANEXO_B + ': ' + sinCifras.length + ' de ' + comparables.length
      + ' comparable(s) sin estado financiero leído (' + sinCifras.map((c) => c.name).join(', ')
      + '). Salen en el anexo con las cifras en blanco: carga sus EEFF en el paso 4 del motor '
      + 'de comparables y vuelve a generar.');
  }

  const year = Number(study.anio) || 2025;
  const molde = bloques[0];
  const moldeHtml = zona.slice(molde.inicio, molde.fin);
  const nuevos = comparables
    .map((c) => generarBloqueAnexoB(molde, moldeHtml, c, year))
    .join(zona.slice(molde.fin, bloques[1] ? bloques[1].inicio : molde.fin) || '');

  const zonaNueva = zona.slice(0, molde.inicio) + nuevos
    + zona.slice(bloques[bloques.length - 1].fin);

  return salida.slice(0, zonaB.inicio) + zonaNueva + salida.slice(zonaB.fin);
}
