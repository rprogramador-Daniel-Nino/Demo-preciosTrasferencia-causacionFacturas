/* ─────────────────────────────────────────────────────────────────────────────
   tablasContribuyente.js — QUÉ dice cada celda de las tablas del contribuyente:
   la composición accionaria (Tabla 6) y los activos del balance (Tabla 10).

   Mismo contrato que `tablasOperaciones.js`: solo los datos, y las dos rutas que
   producen el informe —rellenar el .docx del cliente y regenerar sobre el HTML
   extraído de su PDF— los consumen de aquí. Que cada ruta armara sus filas es
   justamente lo que permitiría publicar dos composiciones accionarias distintas del
   mismo estudio según por dónde se generara el documento.

   Ninguna celda tiene valor por defecto: lo que el estudio no traiga sale como «—».
   La plantilla es el informe del año anterior, así que una celda que no se escribe no
   queda vacía, queda con el dato del cliente anterior.
   ───────────────────────────────────────────────────────────────────────────── */

import { fmt, num, pctf } from '../utils/calculations.js';

const SIN_DATO = '—';

const wrap = (v) => String(v == null || v === '' ? SIN_DATO : v);

/* Una cifra formateada, o «—» si el estudio no la trae. El cero también sale como hueco:
   es el criterio que ya seguía la ruta .docx, y en un balance un rubro en cero y un rubro
   que nadie cargó se leen igual de mal si se publica «0». */
const cifra = (v) => {
  const n = num(v);
  return n ? fmt(n) : SIN_DATO;
};

/**
 * El análisis vertical de un rubro sobre el total de activos del estudio.
 *
 * Una sola definición para la Tabla 10 del cuerpo y para el ESF del ANEXO A: si cada una
 * llevara su cuenta, el informe publicaría dos verticales distintos para el mismo estado
 * financiero, y quien revisa no tendría forma de saber cuál vale.
 *
 * @param {object} estudio
 * @returns {(valor:*) => string} el porcentaje formateado, o «—» sin total de activos.
 */
export function verticalSobreActivos(estudio) {
  const total = num(estudio && estudio.t_act_tot);
  return (valor) => {
    const n = num(valor);
    if (n === null || !total) return SIN_DATO;
    /* El formato lo pone `pctf`, no una copia local: cuando cada sitio se formateaba solo, el
       mismo informe publicaba «4,985%» por una ruta y «4.98%» por la otra. */
    return pctf(n / total);
  };
}

/**
 * Composición accionaria efectiva:
 * 1. Certificado cargado en el estudio actual (Sección 1) tiene máxima prioridad.
 * 2. Si no hay, se usa la composición heredada del informe del año anterior (estudio.estudioAnterior).
 * 3. Si tampoco hay, se usa la composición extraída de la plantilla del cliente (estudio.plantillaAccionistas).
 */
export function resolverComposicionAccionaria(estudio) {
  const actual = estudio && estudio.accionistas;
  if (Array.isArray(actual) && actual.length) {
    return {
      accionistas: actual,
      capital_pagado: estudio.capital_pagado,
      total_acciones: estudio.total_acciones,
      fuente: 'certificado',
    };
  }
  const anterior = estudio && estudio.estudioAnterior;
  const heredados = anterior && anterior.accionistas;
  if (Array.isArray(heredados) && heredados.length) {
    return {
      accionistas: heredados,
      capital_pagado: anterior.capital_pagado,
      total_acciones: anterior.total_acciones,
      fuente: 'estudioAnterior',
    };
  }
  const plantilla = estudio && (estudio.plantillaAccionistas || estudio.plantilla_accionistas);
  const dePlantilla = plantilla && (Array.isArray(plantilla) ? plantilla : plantilla.accionistas);
  if (Array.isArray(dePlantilla) && dePlantilla.length) {
    return {
      accionistas: dePlantilla,
      capital_pagado: plantilla.capital_pagado || null,
      total_acciones: plantilla.total_acciones || null,
      fuente: 'plantilla',
    };
  }
  return { accionistas: [], capital_pagado: null, total_acciones: null, fuente: null };
}

/**
 * ¿El estudio trae una composición accionaria PROPIA, distinta de la que ya está escrita en la
 * plantilla?
 *
 * Propia es la del certificado de la Sección 1 y la heredada del informe del año anterior: dos
 * documentos que el usuario cargó aparte. La tercera rama de la cascada —`plantillaAccionistas`—
 * NO lo es: sale de leer con IA la misma tabla que se iba a reescribir, así que regenerarla con
 * eso es un viaje de ida y vuelta que sólo puede perder datos. Es exactamente lo que pasaba: la
 * extracción devuelve razón social, país y participación, pero no el número de acciones ni el
 * valor del capital, y la tabla se publicaba con «—» en esas dos columnas donde la plantilla
 * traía las cifras.
 *
 * @param {object} estudio
 * @returns {boolean}
 */
export function tieneComposicionAccionariaPropia(estudio) {
  const { accionistas, fuente } = resolverComposicionAccionaria(estudio);
  return !!accionistas.length && fuente !== 'plantilla';
}

/**
 * Tabla 6 — «Composición accionaria», con la fila de totales al cierre.
 *
 * Devuelve `null` cuando el estudio no trae una composición accionaria propia
 * (`tieneComposicionAccionariaPropia`), y quien la publica tiene que respetarlo DEJANDO LA
 * TABLA DE LA PLANTILLA TAL CUAL, con sus filas y sus cifras.
 *
 * Antes se emitía siempre, aunque sólo fuera la fila «Total» con huecos, para delatar que
 * faltaba cargar el certificado. Se cambió por decisión del usuario (2026-08-22): un hueco a la
 * vista no vale lo que cuesta, porque la plantilla es el informe del año anterior DEL MISMO
 * contribuyente y su composición accionaria es un dato que casi nunca cambia de un año al otro
 * —mientras que el certificado, cuando se carga, sí manda—. Si la plantilla fuera de otro
 * cliente, esta tabla queda con sus accionistas: hay que revisarla a mano, igual que las demás
 * tablas que este motor no sabe regenerar.
 *
 * @returns {{nombre:string, titulo:string, encabezados:string[], filas:string[][], fuente:string}|null}
 */
export function filasComposicionAccionaria(estudio) {
  if (!tieneComposicionAccionariaPropia(estudio)) return null;
  const { accionistas } = resolverComposicionAccionaria(estudio);

  const filas = accionistas.map((a) => [
    wrap(a.nombre),
    wrap(a.pais),
    cifra(a.acciones),
    cifra(a.valor_capital),
    a.participacion_pct ? String(a.participacion_pct) + '%' : SIN_DATO,
  ]);

  const totalAcciones = accionistas.reduce((acc, a) => acc + (num(a.acciones) || 0), 0);
  const totalCapital = accionistas.reduce((acc, a) => acc + (num(a.valor_capital) || 0), 0);
  filas.push([
    'Total',
    '',
    totalAcciones ? fmt(totalAcciones) : SIN_DATO,
    totalCapital ? fmt(totalCapital) : SIN_DATO,
    '100%',
  ]);

  return {
    nombre: 'Composición accionaria',
    titulo: 'Composición accionaria',
    encabezados: ['Accionista', 'País', 'N° Acciones', 'Valor Capital', '% Participación'],
    filas,
    fuente: 'Información suministrada por la administración de la Compañía.',
  };
}

/* Los diez rubros del activo, en el orden del balance y con el campo del estudio que los
   alimenta. Van en una lista y no repetidos a mano porque el orden importa: los subtotales
   («Total, Activo corriente») cierran su grupo y moverlos descuadra la lectura.

   El tercer elemento marca los subtotales: a diferencia de un rubro de línea, un subtotal
   siempre se publica (con «—» si falta) porque es lo que cierra visualmente cada grupo del
   balance — quitarlo deja la tabla sin el corte que separa corriente de no corriente. */
const RUBROS_ACTIVO = [
  ['Efectivo y equivalentes de efectivo', 't_cash'],
  ['Inversiones asociadas', 't_inv_assoc'],
  ['Cuentas por cobrar comerciales y otras cuentas por cobrar', 't_ar'],
  ['Activos por impuestos corrientes', 't_tax'],
  ['Total, Activo corriente', 't_act_curr', true],
  ['Propiedades, planta y equipo', 't_ppe'],
  ['Intangibles', 't_intang'],
  ['Diferidos', 't_dif'],
  ['Total, Activos no corrientes', 't_act_nocurr', true],
  ['Total, Activos', 't_act_tot', true],
];

/**
 * Tabla 10 — «Activos a 31 de diciembre de {año}», con su análisis vertical.
 *
 * El título y los encabezados de columna llevan el año gravable, que es un DATO: la
 * plantilla de referencia rotula «Activos a 31 de diciembre de 2024», y dejarlo publica el
 * encabezado del año anterior en el informe nuevo.
 *
 * Un rubro de línea que el estudio no trae (o llega en cero) no publica su fila: la tabla solo
 * pinta lo que la Compañía reportó. Los subtotales son la excepción — siempre se publican,
 * con «—» si falta el dato, porque son el cierre de cada grupo del balance.
 *
 * @returns {{nombre:string, titulo:string, encabezados:string[], filas:string[][], fuente:string}}
 */
export function filasActivos(estudio) {
  const e = estudio || {};
  const year = Number(e.anio) || 2025;
  const av = verticalSobreActivos(e);

  return {
    nombre: 'Activos a 31 de diciembre',
    titulo: 'Activos a 31 de diciembre de ' + year,
    encabezados: ['Cifras Expresadas en pesos colombianos', String(year), 'A.V. ' + year],
    filas: RUBROS_ACTIVO
      .filter(([, campo, esSubtotal]) => esSubtotal || num(e[campo]))
      .map(([etiqueta, campo]) => [etiqueta, cifra(e[campo]), av(e[campo])]),
    fuente: 'Estados financieros de la Compañía a 31 de diciembre de ' + year + '.',
  };
}
