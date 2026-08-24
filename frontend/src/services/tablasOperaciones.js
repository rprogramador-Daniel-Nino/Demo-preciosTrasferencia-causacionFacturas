/* ─────────────────────────────────────────────────────────────────────────────
   tablasOperaciones.js — QUÉ dice cada celda de las Tablas 1 y 2 del Informe Local.

   Solo los datos; el formato es de quien las emite. `docxRelleno.js` las convierte a
   OOXML para rellenar el .docx del cliente y `tablasOperacionesHtml.js` a HTML para la
   ruta de plantilla en PDF. Una sola definición porque las dos rutas producen el MISMO
   documento: si cada una armara sus filas, un cambio en una dejaría a la otra declarando
   otra cosa ante la DIAN, y nadie compara los dos formatos del mismo estudio.

   Ninguna celda tiene valor por defecto. Lo que el estudio no traiga sale como «—»: la
   plantilla es el informe del año anterior, así que un hueco silencioso no queda vacío,
   queda con el dato del cliente anterior.

   Eso vale celda a celda, pero NO cuando la tabla entera se queda sin datos: ahí cada
   función declara `sinDatos` y quien la publica conserva la tabla de la plantilla en vez
   de sustituirla por una rejilla de guiones. El por qué, con el caso que lo motivó, está
   en `datosDeTabla.js`.
   ───────────────────────────────────────────────────────────────────────────── */

import { fmt, num, getUvtValue } from '../utils/calculations.js';
import { codigoDeTipoOperacion } from './tiposOperacionDian.js';
import { sinNingunDato } from './datosDeTabla.js';

const FUENTE = 'Información suministrada por la Administración de la Compañía.';
const SIN_DATO = '—';

const wrap = (v) => String(v == null || v === '' ? SIN_DATO : v);

/** Un monto ya formateado, o «—». Mismo formateador que el resto del informe. */
const montoTexto = (v) => {
  const n = num(v);
  return n === null ? SIN_DATO : fmt(n);
};

/**
 * El concepto de la operación, partido en descripción y código DIAN.
 *
 * `cod` es `null` cuando no se puede establecer, y eso es una respuesta legítima: la
 * columna «Cod» del Excel es opcional y «Tipo de operación» admite texto libre. El
 * archivo de referencia de 2025 trae «VENTA SERVICIOS», que no es ninguno de los 63
 * nombres del catálogo. Antes esto devolvía '07' fijo —el código que traía el informe de
 * END GAME 2024— y el número viajaba al informe de cualquier cliente.
 *
 * @param {object} estudio
 * @returns {{desc: string|null, cod: string|null}}
 */
export function conceptoDeOperacion(estudio) {
  const texto = String((estudio && estudio.vinc_tipo) || '').trim();
  if (!texto) return { desc: null, cod: null };

  /* Un código ya escrito es la declaración del contribuyente y no se re-deriva. */
  const m = /^(.*?)\s*\((\d+)\)\s*$/.exec(texto);
  if (m) {
    return { desc: m[1].trim(), cod: String(m[2]).padStart(2, '0') };
  }

  return { desc: texto, cod: codigoDeTipoOperacion(texto, !!(estudio && estudio.egreso)) };
}

/** El monto de la operación ya formateado, o «—». Los dos campos porque la ingesta
 *  escribe ambos y un estudio guardado antes puede traer solo uno. */
function montoDeLaOperacion(estudio) {
  const bruto = (estudio && (estudio.monto_operacion ?? estudio.monto)) ?? null;
  const n = num(bruto);
  return n === null ? SIN_DATO : fmt(n);
}

/**
 * Tabla 1 — «Operaciones de Ingreso» (o de Egreso), tal como la declara el estudio.
 *
 * Una sola fila: el estudio guarda un vinculado y un tipo de operación, no una lista.
 * Cuando el Excel trae varias contrapartes, `parseExcelOperations` avisa de que el monto
 * es la suma de todas y se atribuye a la primera.
 *
 * @returns {{nombre:string, encabezados:string[], filas:string[][], fuente:string}}
 */
export function filasOperacionesDeIngreso(estudio) {
  const e = estudio || {};
  return {
    nombre: 'Operaciones de ' + (e.egreso ? 'Egreso' : 'Ingreso'),
    encabezados: [
      'Concepto de Operaciones a analizar', 'Nombre vinculado', 'País vinculado',
      'Monto de la Operación analizar',
    ],
    filas: [[wrap(e.vinc_tipo), wrap(e.vinc), wrap(e.pais_vinc), montoDeLaOperacion(e)]],
    fuente: FUENTE,
    /* Los cuatro campos que publica, en crudo: sin ninguno de ellos la única fila sale
       «— — — —» y quien la emite conserva la de la plantilla. */
    sinDatos: sinNingunDato([e.vinc_tipo, e.vinc, e.pais_vinc, e.monto_operacion ?? e.monto]),
  };
}

/**
 * Tabla 2 — «Operación analizar»: el tipo con su código y la descripción.
 *
 * @returns {{nombre:string, encabezados:string[], filas:string[][], fuente:string}}
 */
export function filasOperacionAnalizar(estudio) {
  const e = estudio || {};
  const { desc, cod } = conceptoDeOperacion(e);
  const tipo = e.egreso ? 'Egreso' : 'Ingreso';
  return {
    nombre: 'Operación analizar',
    encabezados: ['No. Operaciones de análisis', 'Descripción'],
    filas: [[tipo + ' (' + (cod || SIN_DATO) + ')', wrap(desc)]],
    fuente: FUENTE,
    /* «Ingreso»/«Egreso» lo pone esta función, así que la celda nunca queda del todo en
       blanco y el criterio del texto la daría por llena: los datos son el código y la
       descripción, y sin los dos no hay tabla que publicar. */
    sinDatos: sinNingunDato([cod, desc]),
  };
}

/**
 * Tabla 3 — «Transacciones Inter compañía»: la ficha del vinculado, en vertical.
 *
 * Cada fila es etiqueta y valor, no una columna de datos. La plantilla la trae DOS veces
 * —en la descripción del vinculado y otra vez en el análisis— y las dos publican lo mismo.
 *
 * @returns {{nombre:string, encabezados:string[], filas:string[][], fuente:string}}
 */
export function filasTransaccionesIntercompania(estudio) {
  const e = estudio || {};
  return {
    nombre: 'Transacciones Inter compañía',
    encabezados: ['Compañía vinculada', ''],
    filas: [
      ['Razón social', wrap(e.vinc)],
      ['Identificación fiscal', wrap(e.vinc_id)],
      ['País - Residencia fiscal', wrap(e.pais_vinc)],
      /* El inciso es el del caso más común y el estudio puede corregirlo. No es un dato
         que se pueda dejar en blanco: la vinculación hay que sustentarla. */
      ['Tipo de vinculación', wrap(e.tipo_vinculacion || 'Art 260-1 E-T Inciso 1')],
      ['Tipo de operaciones (' + (e.egreso ? 'Egreso' : 'Ingreso') + ')', wrap(e.vinc_tipo)],
      ['Monto en pesos', montoDeLaOperacion(e)],
    ],
    fuente: 'Información de ' + (e.ent || 'la Compañía') + '.',
    /* Ficha vertical: la primera columna son los rótulos que pone esta función y el
       inciso de vinculación tiene valor por defecto, así que ninguno de los dos cuenta
       como dato. Lo que decide son los campos del vinculado. */
    sinDatos: sinNingunDato([
      e.vinc, e.vinc_id, e.pais_vinc, e.vinc_tipo, e.monto_operacion ?? e.monto,
    ]),
  };
}

/* ══════════════════ Operación adicional (códigos DIAN 61 a 63) ══════════════════ */

/* Desde cuánto la información adicional del formato entra al informe.
   Son operaciones que NO se reflejan en el Estado de Resultados —préstamos con vinculados,
   reintegros de gastos, operaciones a nombre de vinculados—, así que no sustentan el rango
   ni el monto de la operación analizada; se declaran aparte y solo cuando pesan.

   El umbral son los 45.000 UVT del art. 260-5 E.T. y del art. 1.2.2.3.2 del Decreto 2120 de
   2017, medidos sobre la SUMA de todas las filas de la sección y no fila a fila.

   SE DERIVA del UVT del año gravable y no se escribe. Antes era la constante 2.500.000.000
   —2.240.955.000 es el valor de 2025, que es el número que la gente tiene en la cabeza y el
   que pediría escribir—, pero en 2026 el UVT es 52.300 y el umbral 2.353.500.000: un número
   fijo hace que el estudio de cada año nuevo mida contra el umbral del anterior sin que
   nadie lo note. */
export const UVT_UMBRAL_OPERACION_ADICIONAL = 45000;

/**
 * El umbral en pesos del año gravable.
 *
 * @param {number|string} [anio] año gravable del estudio. Lo que `getUvtValue` no conozca
 *        cae en su propio respaldo, que es el UVT de 2024.
 * @returns {number} pesos colombianos.
 */
export function umbralOperacionAdicional(anio) {
  return UVT_UMBRAL_OPERACION_ADICIONAL * getUvtValue(anio);
}

/* Cómo rotula cada plantilla esta tabla. Se busca por NOMBRE y no por número, y con varias
   redacciones porque ninguna firma titula igual: unas escriben «Intercompañía» junto y otras
   «Inter compañía»; unas dicen «Operación adicional» y otras «Operaciones adicionales» o
   «Información adicional». El localizador casa por inclusión, así que basta con que el rótulo
   de la plantilla contenga una de éstas.

   El último es a propósito el más corto: es el que salva a la plantilla que rotula la tabla
   solo como «Operación adicional», sin repetir «Transacciones». */
export const NOMBRES_TABLA_ADICIONAL = [
  'Operación adicional Transacciones Intercompañía',
  'Operación adicional Transacciones Inter compañía',
  'Operaciones adicionales Transacciones Intercompañía',
  'Información adicional Transacciones Intercompañía',
  'Operaciones adicionales',
  'Operación adicional',
];

/* Y lo que NO es esta tabla aunque su nombre la contenga. «Operación adicional Transacciones
   Inter compañía» contiene «Transacciones Inter compañía», que es la Tabla 3: sin este veto
   las dos se reclamarían y la ficha del vinculado acabaría escrita sobre la otra. */
export const NOMBRES_TABLA_TRANSACCIONES = [
  'Transacciones Inter compañía',
  'Transacciones Intercompañía',
];

/**
 * ¿El estudio tiene información adicional que haya que declarar?
 *
 * Las dos condiciones son necesarias y las pidió el usuario en ese orden: que el formato
 * TRAIGA la sección, y que su total SUPERE el umbral del año gravable (45.000 UVT). Si falta
 * cualquiera de las dos, el informe sale exactamente como salía antes de que esto existiera
 * — sin la tabla, sin un hueco y sin un rótulo huérfano.
 *
 * @param {object} estudio
 * @returns {boolean}
 */
export function tieneOperacionAdicional(estudio) {
  const ad = estudio && estudio.operacionAdicional;
  if (!ad || !Array.isArray(ad.filas) || !ad.filas.length) return false;
  return montoOperacionAdicional(estudio) > umbralOperacionAdicional(estudio.anio);
}

/** El total de la información adicional, sumado de sus filas si no viene ya calculado. */
export function montoOperacionAdicional(estudio) {
  const ad = (estudio && estudio.operacionAdicional) || null;
  if (!ad) return 0;
  const guardado = num(ad.monto);
  if (guardado !== null && guardado > 0) return guardado;
  return (ad.filas || []).reduce((acc, f) => acc + (num(f.monto) || 0), 0);
}

/**
 * Tabla «Operación adicional Transacciones Intercompañía», en horizontal: una fila por
 * operación declarada en la sección 4 del formato.
 *
 * Devuelve `null` cuando no aplica, y quien la publica tiene que respetarlo: escribir la
 * tabla vacía dejaría en el informe un rótulo sin datos, y escribirla con lo que la
 * plantilla traía la dejaría con las operaciones del cliente anterior.
 *
 * @param {object} estudio
 * @returns {{nombre:string, encabezados:string[], filas:string[][], fuente:string}|null}
 */
export function filasOperacionAdicional(estudio) {
  if (!tieneOperacionAdicional(estudio)) return null;
  const e = estudio || {};
  const filas = e.operacionAdicional.filas.map((f) => [
    wrap(f.vinculado),
    wrap(f.nit),
    wrap(f.pais),
    wrap(f.tipo),
    montoTexto(f.monto),
  ]);
  return {
    nombre: 'Operación adicional Transacciones Intercompañía',
    encabezados: ['Compañía vinculada', 'Identificación fiscal', 'País - Residencia fiscal',
      'Tipo de operación', 'Monto en pesos'],
    filas,
    fuente: 'Información de ' + (e.ent || 'la Compañía') + '.',
  };
}

/**
 * La misma tabla en ficha vertical, para la plantilla que la trae con dos columnas —igual
 * que «Transacciones Inter compañía», de la que toma el nombre—.
 *
 * Con más de una operación adicional se publica el total y se detalla cada una en su propia
 * fila: una ficha de etiqueta y valor no admite varias contrapartes en columnas, y perder
 * las demás en silencio sería declarar de menos.
 *
 * @param {object} estudio
 * @returns {{nombre:string, encabezados:string[], filas:string[][], fuente:string}|null}
 */
export function filasOperacionAdicionalFicha(estudio) {
  if (!tieneOperacionAdicional(estudio)) return null;
  const e = estudio || {};
  const ops = e.operacionAdicional.filas;
  const primera = ops[0];
  const filas = [
    ['Razón social', wrap(primera.vinculado)],
    ['Identificación fiscal', wrap(primera.nit)],
    ['País - Residencia fiscal', wrap(primera.pais)],
    ['Tipo de vinculación', wrap(e.tipo_vinculacion || 'Art 260-1 E-T Inciso 1')],
  ];
  for (const op of ops) filas.push(['Tipo de operación', wrap(op.tipo)]);
  filas.push(['Monto en pesos', montoTexto(montoOperacionAdicional(e))]);
  return {
    nombre: 'Operación adicional Transacciones Intercompañía',
    encabezados: ['Compañía vinculada', ''],
    filas,
    fuente: 'Información de ' + (e.ent || 'la Compañía') + '.',
  };
}

/**
 * Tabla 4 — «Método de Precios de Transferencia Aplicable».
 *
 * Publica el código de operación en su propia columna, así que comparte
 * `conceptoDeOperacion` con las Tablas 1 y 2: es el mismo dato y no puede diferir entre
 * dos tablas del mismo informe.
 *
 * `nombre` es más corto que `titulo` porque es con lo que se localiza la tabla, y las
 * plantillas rotulan el título completo.
 *
 * @returns {{nombre:string, titulo:string, encabezados:string[], filas:string[][], fuente:string}}
 */
export function filasMetodoAplicable(estudio) {
  const e = estudio || {};
  const { desc, cod } = conceptoDeOperacion(e);
  return {
    nombre: 'Método de Precios de Transferencia',
    titulo: 'Método de Precios de Transferencia Aplicable',
    encabezados: [
      'Código de Operación', 'Descripción de la operación', 'Método seleccionado',
      'Indicador de Rentabilidad',
    ],
    filas: [[wrap(cod), wrap(desc), e.metodo || 'TU', e.pli || 'MO']],
    fuente: FUENTE,
    /* El método y el indicador tienen valor por defecto («TU»/«MO»), así que solos no
       alcanzan: con el código y la descripción vacíos la tabla publicaría el método del
       sistema junto a dos guiones, tapando el que la plantilla ya declaraba. */
    sinDatos: sinNingunDato([cod, desc, e.metodo, e.pli]),
  };
}

/** El año gravable del estudio. 2025 por omisión, igual que el resto del sistema. */
const anioDe = (estudio) => Number(estudio && estudio.anio) || 2025;

/**
 * Tabla 8 — «Compañías vinculadas al 31 de diciembre de {año}».
 *
 * El título lleva el año gravable, que es un DATO: la plantilla trae el del informe
 * anterior y dejarlo publica «al 31 de diciembre de 2024» en el informe de 2025.
 *
 * @returns {{nombre:string, titulo:string, encabezados:string[], filas:string[][], fuente:string}}
 */
export function filasCompaniasVinculadas(estudio) {
  const e = estudio || {};
  return {
    nombre: 'Compañías vinculadas',
    titulo: 'Compañías vinculadas al 31 de diciembre de ' + anioDe(e),
    encabezados: ['Nombre Vinculada', 'No. ID Fiscal', 'País'],
    filas: [[wrap(e.vinc), wrap(e.vinc_id), wrap(e.pais_vinc)]],
    fuente: FUENTE,
    sinDatos: sinNingunDato([e.vinc, e.vinc_id, e.pais_vinc]),
  };
}

/**
 * Tabla 9 — «Criterios de vinculación económica».
 *
 * El criterio y su detalle son los del caso que el sistema sustenta hoy —vinculación
 * directa por el numeral 1— y no salen del estudio porque no hay dónde escribirlos.
 *
 * @returns {{nombre:string, titulo:string, encabezados:string[], filas:string[][], fuente:string}}
 */
export function filasCriteriosVinculacion(estudio) {
  const e = estudio || {};
  return {
    nombre: 'Criterios de vinculación',
    titulo: 'Criterios de vinculación económica',
    encabezados: [
      'Nombre Vinculada', 'País', 'Criterio de vinculación',
      'Detalle del Criterio de Vinculación',
    ],
    filas: [[
      wrap(e.vinc), wrap(e.pais_vinc),
      'Artículo. 260-1 del Estatuto Tributario, numeral 1, literal a', 'Vinculación Directa',
    ]],
    fuente: FUENTE,
    /* Las dos últimas columnas son la norma que esta función escribe, no un dato: sin el
       nombre y el país del vinculado la fila sería la cita legal sobre dos guiones. */
    sinDatos: sinNingunDato([e.vinc, e.pais_vinc]),
  };
}
