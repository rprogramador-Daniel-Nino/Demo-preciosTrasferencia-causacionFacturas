/* ─────────────────────────────────────────────────────────────────────────────
   anexosPlantilla.js — QUÉ anexo es cada uno en la plantilla de cualquier cliente.

   POR NOMBRE Y NO POR LETRA. La numeración de los anexos es de cada informe y no se
   repite entre clientes. El informe de referencia trae A = estados financieros,
   B = descripciones de comparables, C = matriz de rechazo; el de MC Internacional
   numera A, C, D, E, F —sin B— y ahí la matriz de rechazo es el ANEXO D. Buscar
   «ANEXO B» en esa plantilla no encuentra nada y las descripciones no se rellenan;
   buscar «ANEXO C» encuentra las descripciones y escribirle encima la matriz de
   rechazo destruye el anexo y todo lo que le sigue. El nombre —«Matriz de Rechazo»,
   «Descripciones de comparables»— es lo que se conserva entre plantillas; la letra es
   el rótulo, y cambia. Es el mismo criterio con el que `claveTitulo` localiza las
   tablas del informe sin depender del «Tabla N.» que las precede.

   Este módulo es texto puro: no sabe de OOXML ni de HTML. Las dos rutas del informe
   —la del .docx del cliente (`docxRelleno.js`) y la de la plantilla marcada
   (`anexoBHtml.js`, `anexoCHtml.js`)— le pasan el texto plano de cada párrafo y él dice
   si es un encabezado de anexo y de cuál. Así la definición de «cómo se llama cada
   anexo» vive UNA vez: cuando aparezca un cliente que rotule distinto, se añade aquí y
   las dos salidas del informe lo aprenden a la vez.
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * Clave de comparación de un título de anexo: minúsculas, sin tildes y sin puntuación.
 *
 * No descarta ningún prefijo —a diferencia de `claveTitulo`, que se come el «Tabla N.»—
 * porque aquí el prefijo ya lo separa `interpretarEncabezadoAnexo`: lo que llega es el
 * nombre del anexo, sin su letra.
 */
export function claveDeAnexo(texto) {
  return String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/* «ANEXO C. Descripciones de comparables…», «ANEXO D: Matriz…», «ANEXO F) Metodología…».
   El separador es OBLIGATORIO y el nombre no puede ir vacío: sin exigirlos, un párrafo
   de prosa que empiece por «ANEXO A se presentan los estados financieros del…» pasaría
   por encabezado, y como se toma el primero que aparece el anexo se rellenaría sobre un
   párrafo del cuerpo. */
const RX_ENCABEZADO = /^anexo\s+([a-z])\s*[.:)–—-]\s*(\S.*)$/i;

/* Un encabezado de anexo es corto. El más largo de las dos plantillas conocidas —«ANEXO E.
   Legislación Colombiana en materia de Precios de Transferencia»— tiene 70 caracteres, así
   que este tope deja holgura de sobra y descarta la prosa que mencione un anexo. */
const MAX_ENCABEZADO = 140;

/* Una entrada de la tabla de contenido, que repite el título del anexo unas páginas antes
   que el encabezado de verdad. Se reconoce por cómo termina: con el número de página pegado a
   la última letra —«Estados Financieros52», que es como se lee un campo TOC cuando solo se
   mira el texto— o detrás de los puntos de relleno —«Matriz de Rechazo . 88»—.

   No vale con «acaba en un número»: un anexo puede llamarse «Estados financieros 2024» y
   descartarlo dejaría el anexo del cuerpo sin rellenar, que es el fallo contrario y se nota
   igual de tarde. Y no vale con mirar solo el campo `PAGEREF` del OOXML, porque un índice
   escrito a mano no lo lleva. */
const RX_ENTRADA_INDICE = /(?:[a-z]\d{1,4}|[.·\t]\s*\d{1,4})\s*$/i;

/** Si el texto es una entrada del índice y no el encabezado del anexo. */
export function esEntradaDeIndice(texto) {
  return RX_ENTRADA_INDICE.test(String(texto || '').trim());
}

/**
 * Interpreta un texto como encabezado de anexo.
 *
 * Las entradas del índice NO cuentan: se filtran aquí y no en cada llamador para que ninguna
 * de las dos rutas del informe pueda olvidarse de hacerlo.
 *
 * @param {string} texto  el texto plano del párrafo, ya sin etiquetas.
 * @returns {{letra:string, titulo:string, nombre:string, clave:string}|null}
 *          `letra` en mayúscula, `titulo` completo tal como se lee, `nombre` sin la letra
 *          ni el separador, y `clave` normalizada para comparar. `null` si no lo es.
 */
export function interpretarEncabezadoAnexo(texto) {
  const plano = String(texto || '').replace(/\s+/g, ' ').trim();
  if (!plano || plano.length > MAX_ENCABEZADO || esEntradaDeIndice(plano)) return null;
  const m = RX_ENCABEZADO.exec(plano);
  if (!m) return null;
  const nombre = m[2].trim();
  return { letra: m[1].toUpperCase(), titulo: plano, nombre, clave: claveDeAnexo(nombre) };
}

/* Los nombres con los que se reportan los anexos que el sistema rellena. Sin letra: cuando
   hay que nombrarlos en un aviso es porque NO se encontraron, y entonces no hay letra que
   citar. `rotuloAnexo` compone el rótulo con la de la plantilla cuando sí se conoce. */
export const NOMBRE_EEFF = 'Estados financieros del contribuyente';
export const NOMBRE_DESCRIPCIONES = 'Descripciones de comparables y Estados Financieros';
export const NOMBRE_MATRIZ = 'Matriz de Rechazo';

/**
 * Los anexos que el sistema rellena, EN ORDEN DE RESOLUCIÓN.
 *
 * El orden no es decorativo. En las dos plantillas conocidas el anexo de comparables se
 * titula «Descripciones de comparables **y Estados Financieros**», así que resolver
 * `estados financieros` primero se lo llevaría a él y el anexo del contribuyente se
 * quedaría con las cifras del cliente anterior.
 *
 * `claves` va de lo más específico a lo más laxo, y se prueban POR NIVELES: primero la
 * primera clave de los tres anexos, después la segunda, y así. De ese modo un nombre
 * específico siempre gana a uno genérico aunque el genérico esté declarado antes, y una
 * plantilla que rotule su anexo «Descripciones» a secas también se reconoce.
 */
export const ANEXOS_RELLENABLES = [
  {
    id: 'descripciones',
    nombre: NOMBRE_DESCRIPCIONES,
    claves: ['descripciones de comparables', 'descripcion de comparables', 'descripciones'],
  },
  {
    id: 'matriz',
    nombre: NOMBRE_MATRIZ,
    claves: ['matriz de rechazo', 'matriz de descarte', 'matriz'],
  },
  {
    id: 'eeff',
    nombre: NOMBRE_EEFF,
    claves: ['estados financieros', 'estado financiero'],
  },
];

/** El nombre con el que se reporta un anexo que no se encontró. */
export function nombreDeAnexo(id) {
  const def = ANEXOS_RELLENABLES.find((a) => a.id === id);
  return def ? def.nombre : String(id || '');
}

/**
 * El rótulo de un anexo con la letra que usa la plantilla.
 *
 * Se compone con la letra hallada y no con una fija: escribir «ANEXO B» en un informe que
 * numera A, C, D deja el documento contradiciendo a su propio índice.
 *
 * @param {string} id
 * @param {string} letra  la del encabezado que trae la plantilla.
 * @param {{entidad?:string, anio?:number}} [datos]  para el anexo de estados financieros,
 *        cuyo rótulo nombra al contribuyente del estudio.
 */
export function rotuloAnexo(id, letra, datos = {}) {
  const inicio = letra ? `ANEXO ${String(letra).toUpperCase()}. ` : '';
  if (id === 'eeff') {
    const entidad = String(datos.entidad || '').trim();
    return inicio + 'Estados financieros' + (entidad ? ' ' + entidad : '');
  }
  return inicio + nombreDeAnexo(id);
}

/**
 * Reparte una lista de encabezados de anexo entre los anexos que se rellenan.
 *
 * @param {Array<{clave:string}>} lista  los encabezados del documento, en orden de aparición.
 * @returns {object} `{descripciones?, matriz?, eeff?}` con el elemento de `lista` que
 *          corresponde a cada uno. Los que no aparecen quedan sin clave.
 */
export function resolverAnexos(lista) {
  const anexos = Array.isArray(lista) ? lista : [];
  const tomados = new Set();
  const salida = {};
  const niveles = Math.max(...ANEXOS_RELLENABLES.map((def) => def.claves.length));
  for (let nivel = 0; nivel < niveles; nivel += 1) {
    for (const def of ANEXOS_RELLENABLES) {
      const clave = def.claves[nivel];
      if (salida[def.id] || !clave) continue;
      for (let i = 0; i < anexos.length; i += 1) {
        const a = anexos[i];
        if (tomados.has(i) || !a || !String(a.clave || '').includes(clave)) continue;
        salida[def.id] = a;
        tomados.add(i);
        break;
      }
    }
  }
  return salida;
}
