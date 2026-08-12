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
 * Tabla 6 — «Composición accionaria», con la fila de totales al cierre.
 *
 * La fila de total se emite siempre, incluso sin accionistas: es lo que delata que falta
 * cargar el certificado, en vez de dejar en el documento los accionistas de la plantilla.
 *
 * @returns {{nombre:string, titulo:string, encabezados:string[], filas:string[][], fuente:string}}
 */
export function filasComposicionAccionaria(estudio) {
  const accionistas = (estudio && estudio.accionistas) || [];

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
   («Total, Activo corriente») cierran su grupo y moverlos descuadra la lectura. */
const RUBROS_ACTIVO = [
  ['Efectivo y equivalentes de efectivo', 't_cash'],
  ['Inversiones asociadas', 't_inv_assoc'],
  ['Cuentas por cobrar comerciales y otras cuentas por cobrar', 't_ar'],
  ['Activos por impuestos corrientes', 't_tax'],
  ['Total, Activo corriente', 't_act_curr'],
  ['Propiedades, planta y equipo', 't_ppe'],
  ['Intangibles', 't_intang'],
  ['Diferidos', 't_dif'],
  ['Total, Activos no corrientes', 't_act_nocurr'],
  ['Total, Activos', 't_act_tot'],
];

/**
 * Tabla 10 — «Activos a 31 de diciembre de {año}», con su análisis vertical.
 *
 * El título y los encabezados de columna llevan el año gravable, que es un DATO: la
 * plantilla de referencia rotula «Activos a 31 de diciembre de 2024», y dejarlo publica el
 * encabezado del año anterior en el informe nuevo.
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
    filas: RUBROS_ACTIVO.map(([etiqueta, campo]) => [etiqueta, cifra(e[campo]), av(e[campo])]),
    fuente: 'Estados financieros de la Compañía a 31 de diciembre de ' + year + '.',
  };
}
