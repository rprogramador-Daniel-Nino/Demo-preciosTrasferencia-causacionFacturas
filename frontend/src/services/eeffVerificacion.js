/* ─────────────────────────────────────────────────────────────────────────────
   Verificación aritmética de los estados financieros del contribuyente.

   Hasta agosto de 2026 la lectura del contribuyente no se verificaba en absoluto.
   `verifyAccountingEqualities` existía en `eeffParser.js` desde el principio, pero solo
   corría para las comparables: la parte examinada —la única compañía cuyas cifras la
   DIAN va a mirar rubro por rubro— entraba al estudio tal como la devolvía el modelo.

   El caso que lo puso en evidencia: el estado de resultados de Montachem 2025 rotula
   «RESULTADO DE ACTIVIDADES DE LA OPERACIÓN» una fila que trae −2.986.236.031, y esa
   cifra no es la utilidad operacional sino el total de los gastos operativos. Se
   comprueba con el propio documento:

     utilidad bruta            1.891.180.250
     − gastos operativos      −2.986.236.031
     + resultado financiero      −71.162.144
     = utilidad antes de imp. −1.166.217.925   ← la que el documento imprime

   Con la fila creída al pie de la letra, la utilidad operacional entraba como
   −2.986.236.031 (la real es −1.095.055.781) y el libro publicaba 4.877.416.281 de
   gastos operativos: inflados exactamente en la utilidad bruta.

   Ninguna de las comprobaciones de aquí conoce a Montachem ni a ningún cliente. Son
   identidades contables, y valen para cualquier estado financiero — que es la única
   forma de tratar planes de cuentas que no se conocen de antemano.

   El módulo es puro: ni React, ni red, ni acceso a `localStorage`.
   ───────────────────────────────────────────────────────────────────────────── */

import { num, egreso } from '../utils/calculations.js';
import { cifrasDelTexto, cifraApareceEnTexto } from './eeffTextoPdf.js';

/* Los estados financieros redondean, y no todos los conceptos de un estado de resultados
   se piden en la lectura (un «otros ingresos» de 8.298 pesos entre veintitrés mil
   millones). Una identidad se considera cumplida dentro de una milésima de la escala del
   estado, con un piso de un peso para los estados expresados en unidades pequeñas. La
   diferencia que este módulo busca es de otro orden: la del caso Montachem era del 173 %
   de la cifra. */
const TOLERANCIA_RELATIVA = 0.001;

const tolerancia = (escala) => Math.max(1, Math.abs(num(escala) || 0) * TOLERANCIA_RELATIVA);
const cuadra = (a, b, escala) => Math.abs(a - b) <= tolerancia(escala);

/* Etiquetas para los mensajes: las mismas que el analista ve en la hoja del libro y en el
   formulario, para que un hallazgo se pueda seguir hasta su casilla. */
const ETIQUETA = {
  t_s: 'Ventas netas',
  t_c: 'Costo de ventas',
  t_op: 'Utilidad operacional',
  t_cash: 'Efectivo y equivalentes de efectivo',
  t_inv_assoc: 'Inversiones asociadas',
  t_ar: 'Cuentas por cobrar comerciales y otras cuentas por cobrar',
  t_inv: 'Inventarios',
  t_tax: 'Activos por impuestos corrientes',
  t_act_curr: 'Total, Activo corriente',
  t_ppe: 'Propiedades, planta y equipo',
  t_intang: 'Intangibles',
  t_dif: 'Diferidos',
  t_act_nocurr: 'Total, Activos no corrientes',
  t_act_tot: 'Total, Activos',
  t_ap: 'Cuentas por pagar comerciales',
};

/* Los rubros que suman al activo corriente y al no corriente, para poder decir cuánto
   falta cuando el subtotal impreso no cuadra con las partidas reconocidas. `t_dif` cuenta
   en el no corriente porque ahí es donde los estados colombianos suelen presentar los
   gastos pagados por anticipado y el impuesto diferido. */
const COMPONENTES_CORRIENTE = ['t_cash', 't_inv_assoc', 't_ar', 't_inv', 't_tax'];
const COMPONENTES_NO_CORRIENTE = ['t_ppe', 't_intang', 't_dif'];

const fmtCop = (v) => (v === null || v === undefined
  ? '—'
  : Math.round(v).toLocaleString('es-CO'));

/**
 * Verifica una lectura de estados financieros del contribuyente y devuelve los campos
 * que deben entrar al estudio.
 *
 * `lectura` es lo que devuelve `parseEeffWithGeminiOCR`: los `t_*`, el `cotejo` con los
 * rubros que no son campos del estudio, los `rotulos` de origen, los `rubrosNoAsignados`
 * y el `textoPdf`.
 *
 * Devuelve:
 *  · `campos`      — los `t_*` a aplicar, ya corregidos y con los descartes en null.
 *  · `correcciones`— lo que se cambió y por qué. Se guarda con el estudio y se publica en
 *                    el libro: una corrección automática que no deja rastro es peor que
 *                    no corregir, porque el analista firma una cifra que no leyó.
 *  · `advertencias`— lo que no se corrige y necesita una decisión humana.
 *  · `verificadoContraTexto` — si el documento tenía capa de texto. Con `false`, la
 *                    comprobación anti-alucinación no se pudo hacer y hay que decirlo.
 */
export function verificarEeff(lectura, { anioEstudio } = {}) {
  const l = lectura || {};
  const cotejo = l.cotejo || {};
  const rotulos = l.rotulos || {};
  const correcciones = [];
  const advertencias = [];

  const campos = {};
  Object.keys(ETIQUETA).forEach((clave) => {
    if (clave === 't_op') return; // se resuelve abajo, por identidad
    campos[clave] = num(l[clave]);
  });

  /* ── 1. Presencia literal: ¿esta cifra está impresa en el documento? ──
     La comprobación que habría frenado el 44.177.669 que la lectura devolvió como
     «cuentas por pagar comerciales» de un documento donde esa cifra no aparece en
     ninguna de sus cuatro páginas. Solo se puede hacer con capa de texto; un escaneo no
     la tiene y entonces no se afirma haberla hecho. */
  const verificadoContraTexto = Boolean(l.textoPdf && String(l.textoPdf).trim());
  if (verificadoContraTexto) {
    const impresas = cifrasDelTexto(l.textoPdf);
    Object.keys(campos).forEach((clave) => {
      const v = campos[clave];
      if (v === null || v === 0) return;
      if (cifraApareceEnTexto(v, impresas)) return;
      campos[clave] = null;
      advertencias.push({
        tipo: 'cifra-inexistente',
        campo: clave,
        mensaje: `«${ETIQUETA[clave]}»: la cifra ${fmtCop(v)} no aparece impresa en el `
          + `documento${rotulos[clave] ? ` (la lectura la atribuyó a «${rotulos[clave]}»)` : ''}. `
          + 'Se descartó; verifíquela contra el estado financiero y escríbala a mano si corresponde.',
      });
    });
  } else {
    advertencias.push({
      tipo: 'sin-capa-de-texto',
      mensaje: 'El documento no trae capa de texto (es un escaneo o una imagen), así que no '
        + 'se pudo comprobar que cada cifra esté impresa en él. Revise las cifras contra el '
        + 'documento antes de continuar.',
    });
  }

  /* ── 2. La utilidad operacional, por identidad y no por rótulo ──
     El estudio guarda `t_op` como UTILIDAD operacional (convenio de `pliOf`); el libro la
     convierte a gastos con `estudioNormalizado.js`. Se despeja en este orden:

       a) utilidad antes de impuestos − resultado financiero neto
       b) utilidad bruta − |gastos operativos|
       c) (ventas − |costo|) − |gastos operativos|

     La (a) va primera porque sus dos términos son cifras que el estado imprime abajo, ya
     acumuladas, y no dependen de qué filas de gasto haya reconocido la lectura. Es la que
     resuelve el caso del rótulo engañoso. */
  const ventas = num(l.t_s);
  const costo = egreso(l.t_c);
  const utilidadBrutaLeida = num(cotejo.utilidad_bruta);
  const utilidadBruta = utilidadBrutaLeida !== null
    ? utilidadBrutaLeida
    : (ventas !== null && costo !== null ? ventas - costo : null);
  const gastosLeidos = egreso(cotejo.gastos_operacionales);
  const uai = num(cotejo.utilidad_antes_impuestos);
  const financiero = num(cotejo.resultado_financiero_neto);
  const uopLeida = num(cotejo.utilidad_operacional);

  let uop = null;
  let fuenteUop = null;
  if (uai !== null && financiero !== null) {
    uop = uai - financiero;
    fuenteUop = 'utilidad antes de impuestos − resultado financiero neto';
  } else if (utilidadBruta !== null && gastosLeidos !== null) {
    uop = utilidadBruta - gastosLeidos;
    fuenteUop = 'utilidad bruta − gastos operativos';
  } else if (uopLeida !== null) {
    uop = uopLeida;
    fuenteUop = 'lectura directa';
  }

  if (uop !== null && uopLeida !== null && fuenteUop !== 'lectura directa'
      && !cuadra(uop, uopLeida, ventas)) {
    correcciones.push({
      campo: 't_op',
      etiqueta: ETIQUETA.t_op,
      valorLeido: uopLeida,
      valorAplicado: uop,
      rotuloLeido: rotulos.utilidad_operacional || '',
      motivo: `La fila leída${rotulos.utilidad_operacional ? ` («${rotulos.utilidad_operacional}»)` : ''} `
        + `trae ${fmtCop(uopLeida)}, que no cuadra con el resto del estado. Se aplicó `
        + `${fmtCop(uop)}, despejado de ${fuenteUop}.`,
    });
  }
  campos.t_op = uop;

  if (uop === null) {
    advertencias.push({
      tipo: 'sin-utilidad-operacional',
      campo: 't_op',
      mensaje: 'No se pudo establecer la utilidad operacional: el documento no trae la '
        + 'utilidad antes de impuestos con su resultado financiero, ni los gastos operativos '
        + 'totales. Escríbala a mano — sin ella no hay margen operacional ni Índice de Berry.',
    });
  }

  /* Los gastos operativos totales, cuando el documento los imprime o cuando se despejan
     de la utilidad operacional ya verificada. Van a `t_gastos`, que
     `estudioNormalizado.js` lee como lectura directa antes de derivarlos: así el libro
     publica el número del documento y no uno reconstruido. */
  const gastos = gastosLeidos !== null
    ? gastosLeidos
    : (utilidadBruta !== null && uop !== null ? utilidadBruta - uop : null);
  if (gastos !== null) campos.t_gastos = gastos;

  /* ── 3. Los subtotales del balance ── */
  const totalCorriente = campos.t_act_curr;
  const totalNoCorriente = campos.t_act_nocurr;
  const totalActivos = campos.t_act_tot;

  /* El total de activos se despeja de sus dos subtotales, que es la identidad que el
     propio estado imprime. */
  if (totalCorriente !== null && totalNoCorriente !== null) {
    const suma = totalCorriente + totalNoCorriente;
    if (totalActivos === null) {
      campos.t_act_tot = suma;
      correcciones.push({
        campo: 't_act_tot',
        etiqueta: ETIQUETA.t_act_tot,
        valorLeido: null,
        valorAplicado: suma,
        motivo: `No se leyó el total de activos; se aplicó ${fmtCop(suma)}, la suma de los `
          + 'dos subtotales del propio estado. El análisis vertical divide sobre esta celda.',
      });
    } else if (!cuadra(totalActivos, suma, totalActivos)) {
      advertencias.push({
        tipo: 'subtotales-no-cuadran',
        campo: 't_act_tot',
        mensaje: `El total de activos leído (${fmtCop(totalActivos)}) no es la suma del activo `
          + `corriente (${fmtCop(totalCorriente)}) y el no corriente (${fmtCop(totalNoCorriente)}) `
          + `= ${fmtCop(suma)}. Alguna de las tres cifras está mal leída.`,
      });
    }
  }

  /* La ecuación patrimonial. No corrige nada —los pasivos y el patrimonio no son campos
     del estudio— pero si no cuadra, es que algún total del activo está mal leído, y eso
     sí afecta al análisis vertical y a la Tabla 10. */
  const pasivos = num(cotejo.total_pasivos);
  const patrimonio = num(cotejo.patrimonio);
  if (campos.t_act_tot !== null && pasivos !== null && patrimonio !== null
      && !cuadra(campos.t_act_tot, pasivos + patrimonio, campos.t_act_tot)) {
    advertencias.push({
      tipo: 'ecuacion-patrimonial',
      mensaje: `La ecuación patrimonial no cuadra: activos ${fmtCop(campos.t_act_tot)} ≠ `
        + `pasivos ${fmtCop(pasivos)} + patrimonio ${fmtCop(patrimonio)} = `
        + `${fmtCop(pasivos + patrimonio)}. Revise los totales del balance.`,
    });
  }

  /* Los subtotales contra las partidas reconocidas. Lo que falte se explica, cuando se
     puede, con los rubros que la lectura dejó sin asignar: es el aviso que le dice al
     analista que en el activo corriente de este estado hay cuentas por cobrar a partes
     relacionadas y activos financieros que ningún campo del estudio recogió. */
  const noAsignados = Array.isArray(l.rubrosNoAsignados) ? l.rubrosNoAsignados : [];
  [
    { total: 't_act_curr', partes: COMPONENTES_CORRIENTE, nombre: 'activo corriente', seccion: 'activo_corriente' },
    { total: 't_act_nocurr', partes: COMPONENTES_NO_CORRIENTE, nombre: 'activo no corriente', seccion: 'activo_no_corriente' },
  ].forEach(({ total, partes, nombre, seccion }) => {
    const impreso = campos[total];
    if (impreso === null || impreso === 0) return;
    const reconocidas = partes.reduce((acc, k) => acc + (campos[k] || 0), 0);
    const falta = impreso - reconocidas;
    if (Math.abs(falta) <= tolerancia(impreso)) return;

    /* Qué explica el faltante. No se listan todos los rubros sin asignar —eso metía
       cuentas por PAGAR en el aviso de un subtotal del ACTIVO, ruido que hace que el
       analista deje de leer los avisos—: se busca el subconjunto cuya suma da
       exactamente el faltante. En el estado de Montachem ese subconjunto existe y es
       elocuente: 2.946.262.156 = cuentas por cobrar a partes relacionadas 2.926.256.259
       + activos financieros 20.005.897. Cuando no hay subconjunto que cuadre, se dice el
       faltante sin atribuirlo a nada: una atribución falsa es peor que ninguna. */
    const candidatos = noAsignados.filter(
      (r) => Math.abs(r.valor) > 0 && (!r.seccion || r.seccion === seccion || r.seccion.includes('situacion')),
    );
    const explican = subconjuntoQueSuma(candidatos, falta, tolerancia(impreso));
    const detalle = explican
      ? ` Lo explican exactamente: ${explican.map((r) => `«${r.rotulo}» ${fmtCop(r.valor)}`).join(' + ')}.`
      : ' Ningún rubro sin asignar del documento suma ese faltante: revise el subtotal contra el estado.';
    advertencias.push({
      tipo: 'subtotal-con-faltante',
      campo: total,
      mensaje: `El ${nombre} impreso (${fmtCop(impreso)}) supera en ${fmtCop(falta)} la suma de `
        + `los rubros que se reconocieron (${fmtCop(reconocidas)}).${detalle}`
        + (explican ? ' Decida si alguno entra en el ajuste de capital de trabajo.' : ''),
    });
  });

  /* ── 4. Lo que no se corrige, pero hay que decir ── */
  if (campos.t_ap === null) {
    const porPagar = noAsignados.filter((r) => /pagar|proveedor|acreedor/i.test(r.rotulo));
    advertencias.push({
      tipo: 'sin-cuentas-por-pagar',
      campo: 't_ap',
      mensaje: 'El documento no desglosa una cuenta por pagar comercial o de proveedores.'
        + (porPagar.length
          ? ` Las que trae son: ${porPagar.map((r) => `«${r.rotulo}» ${fmtCop(r.valor)}`).join(', ')}. `
            + 'Elija la que corresponda a la operación y escríbala a mano.'
          : ' El ajuste de capital de trabajo por cuentas por pagar quedará en cero.'),
    });
  }

  const periodo = String(l.periodo || '').trim();
  const anio = String(anioEstudio || '').trim();
  if (anio && periodo && !periodo.includes(anio)) {
    advertencias.push({
      tipo: 'periodo-distinto',
      mensaje: `El período leído (${periodo}) no es el año gravable del estudio (${anio}). `
        + 'Compruebe que las cifras salieron de la columna correcta del estado comparativo.',
    });
  }

  /* La escala. Se advierte y no se reescala: el ANEXO A adjunta las páginas del propio
     PDF, y multiplicar las cifras por mil dejaría el texto del informe diciendo una cosa
     y su anexo mostrando otra. `unidad_origen` se pedía desde el principio en los tres
     prompts y no tenía ni un consumidor; este es el primero. */
  const unidad = String(l.unidadOrigen || '').trim().toLowerCase();
  if (unidad && unidad !== 'unidades') {
    advertencias.push({
      tipo: 'escala-no-unitaria',
      mensaje: `El estado está expresado en ${unidad}, así que las cifras entraron tal como `
        + 'están impresas, sin convertir. Los indicadores son razones y no se afectan, pero '
        + 'las cifras absolutas del informe y del Formato 1125 sí: conviértalas antes de radicar.',
    });
  }

  return { campos, correcciones, advertencias, verificadoContraTexto };
}

/* Tope de combinaciones que se exploran al buscar el subconjunto que explica un faltante.
   Con los rubros que trae un estado financiero real —una decena a lo sumo— la búsqueda
   termina de inmediato; el tope está para que un documento anómalo con cincuenta partidas
   sin asignar no congele la pantalla mientras el analista espera su lectura. */
const TOPE_COMBINACIONES = 200000;

/**
 * El subconjunto de rubros cuya suma es `objetivo`, o null si ninguno lo es.
 *
 * Búsqueda en profundidad con dos podas: se ordena de mayor a menor y se corta la rama en
 * cuanto lo que queda por sumar no alcanza el objetivo. Exportada para poder probarla
 * suelta, que es donde se ve que devuelve el subconjunto exacto y no el primero que se
 * acerca.
 */
export function subconjuntoQueSuma(rubros, objetivo, tol = 1) {
  const items = (rubros || []).filter((r) => Number.isFinite(Number(r.valor)));
  const orden = [...items].sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor));
  /* Suma de las colas, para poder descartar una rama sin recorrerla. */
  const restante = new Array(orden.length + 1).fill(0);
  for (let i = orden.length - 1; i >= 0; i--) {
    restante[i] = restante[i + 1] + Math.abs(Number(orden[i].valor));
  }

  let visitados = 0;
  const buscar = (i, suma, elegidos) => {
    if (Math.abs(suma - objetivo) <= tol && elegidos.length) return elegidos;
    if (i >= orden.length || visitados > TOPE_COMBINACIONES) return null;
    /* Con todo lo que queda no se llega: no hay nada que explorar por aquí. */
    if (suma + restante[i] < objetivo - tol) return null;
    visitados += 1;
    const v = Math.abs(Number(orden[i].valor));
    return buscar(i + 1, suma + v, [...elegidos, orden[i]]) || buscar(i + 1, suma, elegidos);
  };

  return buscar(0, 0, []);
}

/**
 * Los campos del estudio que la ingesta debe escribir, descartando los que quedaron sin
 * cifra para no sobrescribir con `null` un valor que el analista ya había escrito a mano.
 *
 * Es la razón por la que `IngestaCifras.jsx` comprobaba campo por campo antes de asignar;
 * aquí se hace una vez y en un sitio testeable.
 */
export function camposAplicables(campos) {
  return Object.fromEntries(
    Object.entries(campos || {}).filter(([, v]) => v !== null && v !== undefined),
  );
}
