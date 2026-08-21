/* ─────────────────────────────────────────────────────────────────────────────
   Verificación de la lectura de estados financieros del contribuyente.

   Hasta agosto de 2026 la lectura del contribuyente no se verificaba en absoluto.
   `verifyAccountingEqualities` existía en `eeffParser.js` desde el principio, pero solo
   corría para las comparables: la parte examinada —la única compañía cuyas cifras la
   DIAN va a mirar rubro por rubro— entraba al estudio tal como la devolvía el modelo, y
   así entró un 44.177.669 como cuentas por pagar de un documento donde esa cifra no
   aparece en ninguna de sus cuatro páginas.

   ── Qué se toma, y de dónde (alcance fijado por el usuario el 2026-08-21) ──

   Del ESTADO DE SITUACIÓN FINANCIERA, tres partidas y un subtotal:

     t_ar        ← cuentas por cobrar A PARTES RELACIONADAS
     t_inv       ← inventarios
     t_ap        ← cuentas por pagar A PARTES RELACIONADAS
     t_act_curr  ← total del activo corriente

   Las dos de capital de trabajo son las de partes relacionadas y no las comerciales
   porque la operación bajo estudio es con la vinculada. El propio estado lo confirma: en
   su flujo de efectivo, la línea «Aumento / disminución en proveedores» (−135.245.675) es
   exactamente la variación de las cuentas por pagar a partes relacionadas
   (5.400.016.795 − 5.535.262.470). Para esta compañía el proveedor ES la vinculada.

   Del ESTADO DE RESULTADOS, dos cifras leídas y una calculada:

     t_s      ← ingresos de actividades ordinarias
     t_c      ← costo de ventas
     t_gastos = gastos de ventas + gastos de administración
     t_op     = t_s − |t_c| − t_gastos          ← la utilidad operacional, calculada

   Calcularla es lo que cierra el defecto que motivó todo esto. La versión anterior leía
   la fila que el documento rotulara «resultado de la operación», y en el estado de
   Montachem 2025 esa fila (−2.986.236.031) es el total de los gastos operativos y no la
   utilidad: se publicaban 4.877.416.281 de gastos y un margen operacional de tres
   dígitos. Derivándola de ingresos, costo y los dos gastos del giro —cifras que no se
   pueden confundir con otra cosa— ningún rótulo engañoso puede volver a decidirla.

   «Otros gastos» y «otros ingresos» quedan fuera de los gastos operativos a propósito:
   la definición son los dos rubros del giro. En ese estado la diferencia es de 4.051.927.

   El módulo es puro: ni React, ni red, ni acceso a `localStorage`.
   ───────────────────────────────────────────────────────────────────────────── */

import { num, egreso } from '../utils/calculations.js';
import { cifrasDelTexto, cifraApareceEnTexto } from './eeffTextoPdf.js';

/* Una identidad se considera cumplida dentro de una milésima de la escala del estado, con
   un piso de un peso para los estados expresados en unidades pequeñas: los estados
   financieros redondean. La diferencia que aquí se busca es de otro orden — la del caso
   que motivó el módulo era del 173 % de la cifra. */
const TOLERANCIA_RELATIVA = 0.001;

const tolerancia = (escala) => Math.max(1, Math.abs(num(escala) || 0) * TOLERANCIA_RELATIVA);
const cuadra = (a, b, escala) => Math.abs(a - b) <= tolerancia(escala);

/* Los campos del estudio que esta ingesta llena, con el nombre que el analista ve en su
   casilla. Es la lista completa: lo que no está aquí, esta lectura no lo toca. */
const ETIQUETA = {
  t_s: 'Ingresos de actividades ordinarias',
  t_c: 'Costo de ventas',
  t_op: 'Utilidad operacional',
  t_ar: 'Cuentas por cobrar a partes relacionadas',
  t_inv: 'Inventarios',
  t_ap: 'Cuentas por pagar a partes relacionadas',
  t_act_curr: 'Total, Activo corriente',
};

/* Los que se leen del documento. `t_op` no está: se calcula. */
const LEIDOS = ['t_s', 't_c', 't_ar', 't_inv', 't_ap', 't_act_curr'];

const fmtCop = (v) => (v === null || v === undefined
  ? '—'
  : Math.round(v).toLocaleString('es-CO'));

/**
 * La utilidad operacional, con la ley de signos aplicada a los egresos.
 *
 *     utilidad operacional = ventas − |costo| − |gastos operativos|
 *
 * El valor absoluto no es un adorno: es lo único que hace que el resultado no dependa de
 * cómo el documento —o el analista— haya escrito el signo. Los estados imprimen el costo y
 * los gastos con signo negativo o entre paréntesis casi sin excepción, y aplicar la resta
 * sobre esos valores tal cual los SUMA por doble negación: con las cifras de Montachem 2025
 * daría 23.741.367.744 + 21.850.187.494 + 2.982.184.104 = 48.573.739.342 en lugar de
 * −1.091.003.854. Al revés, un documento que los imprima en positivo da el mismo resultado.
 *
 * Las ventas NO pasan por el valor absoluto: un ingreso negativo es un dato —devoluciones
 * netas superiores a la facturación— y volverlo positivo cambiaría el sentido del estado.
 * La utilidad tampoco: sale con el signo que le corresponde, y aquí sale negativa porque la
 * compañía está en pérdida operativa.
 *
 * Vive aquí, exportada, porque la usan dos sitios: la lectura del documento y el formulario
 * cuando el analista corrige una de las tres cifras a mano. Si cada uno la escribiera por
 * su cuenta, editar el costo dejaría una utilidad que ya no se deriva de él.
 *
 * Devuelve null si falta cualquiera de los tres términos: sin ellos no hay nada que
 * calcular, y un cero sería una afirmación falsa.
 */
export function utilidadOperacionalDe({ ventas, costo, gastos }) {
  const s = num(ventas);
  const c = egreso(costo);
  const g = egreso(gastos);
  if (s === null || c === null || g === null) return null;
  return s - c - g;
}

/** Los gastos operativos: la suma de los dos rubros del giro, en magnitud.
 *
 *  Con uno solo de los dos se sigue adelante —hay estados que no desglosan gastos de
 *  ventas porque los llevan todos a administración—; con ninguno no hay nada que sumar y
 *  devuelve null en vez de un cero que fingiría una compañía sin gastos. */
export function gastosOperativosDe({ ventas: gastosVentas, administracion }) {
  const gv = egreso(gastosVentas);
  const ga = egreso(administracion);
  if (gv === null && ga === null) return null;
  return (gv || 0) + (ga || 0);
}

/**
 * Verifica una lectura de estados financieros del contribuyente y devuelve los campos
 * que deben entrar al estudio.
 *
 * `lectura` es lo que devuelve `parseEeffWithGeminiOCR`: los `t_*` leídos, el `cotejo` con
 * los rubros que no son campos del estudio (los dos gastos y la utilidad bruta), los
 * `rotulos` de origen, los `rubrosNoAsignados` y el `textoPdf`.
 *
 * Devuelve:
 *  · `campos`      — los `t_*` a aplicar, con los descartes en null y `t_op`/`t_gastos`
 *                    ya calculados.
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
  LEIDOS.forEach((clave) => { campos[clave] = num(l[clave]); });

  /* ── 1. Presencia literal: ¿esta cifra está impresa en el documento? ──
     La comprobación que habría frenado el 44.177.669. Solo se puede hacer con capa de
     texto; un escaneo no la tiene y entonces no se afirma haberla hecho. */
  const verificadoContraTexto = Boolean(l.textoPdf && String(l.textoPdf).trim());
  if (verificadoContraTexto) {
    const impresas = cifrasDelTexto(l.textoPdf);
    LEIDOS.forEach((clave) => {
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

  /* ── 2. Los gastos operativos y la utilidad operacional ──
     gastos operativos    = gastos de ventas + gastos de administración
     utilidad operacional = ingresos − costo de ventas − gastos operativos */
  /* Se leen de `campos` y no de la lectura cruda: si la comprobación de presencia literal
     descartó alguna, la utilidad no puede calcularse con ella. La ley de signos la aplican
     `gastosOperativosDe` y `utilidadOperacionalDe`, que son las mismas funciones que usa el
     formulario cuando el analista corrige una cifra a mano. */
  const ventas = campos.t_s;
  const costo = campos.t_c;
  const gastos = gastosOperativosDe({
    ventas: cotejo.gastos_ventas,
    administracion: cotejo.gastos_administracion,
  });
  const uop = utilidadOperacionalDe({ ventas, costo, gastos });

  campos.t_op = uop;
  if (gastos !== null) campos.t_gastos = gastos;

  if (uop === null) {
    const falta = [];
    if (ventas === null) falta.push('los ingresos de actividades ordinarias');
    if (costo === null) falta.push('el costo de ventas');
    if (gastos === null) falta.push('los gastos de ventas y de administración');
    advertencias.push({
      tipo: 'sin-utilidad-operacional',
      campo: 't_op',
      mensaje: `No se pudo calcular la utilidad operacional: falta ${falta.join(' y ')} en el `
        + 'documento. Escríbala a mano — sin ella no hay margen operacional ni Índice de Berry.',
    });
  }

  /* La utilidad bruta que el documento imprime, contra la que sale de las dos cifras
     leídas. No corrige nada: si no cuadra, es que el costo o los ingresos se tomaron de la
     fila equivocada, y eso lo tiene que ver el analista antes de seguir. */
  const utilidadBrutaLeida = num(cotejo.utilidad_bruta);
  /* En magnitud, igual que en el cálculo de la utilidad operacional: `costo` conserva el
     signo del documento, y restarlo tal cual lo sumaría. Con las cifras de Montachem la
     comparación daría 45.591.555.238 contra los 1.891.180.250 que el estado imprime, y
     saltaría una advertencia falsa en todos los estados que imprimen el costo en negativo
     —es decir, en casi todos—. */
  const costoEnMagnitud = egreso(costo);
  if (utilidadBrutaLeida !== null && ventas !== null && costoEnMagnitud !== null
      && !cuadra(utilidadBrutaLeida, ventas - costoEnMagnitud, ventas)) {
    advertencias.push({
      tipo: 'utilidad-bruta-no-cuadra',
      mensaje: `La utilidad bruta que imprime el documento (${fmtCop(utilidadBrutaLeida)}) no es `
        + `ingresos ${fmtCop(ventas)} − costo ${fmtCop(costoEnMagnitud)} = `
        + `${fmtCop(ventas - costoEnMagnitud)}. `
        + 'Revise de qué filas se tomaron los ingresos y el costo.',
    });
  }

  /* ── 3. Lo que falta y hay que decir ──
     Las tres partidas del balance sostienen el ajuste de capital de trabajo: sin una, su
     ajuste se calcula contra cero y nada lo advierte en el libro. */
  const noAsignados = Array.isArray(l.rubrosNoAsignados) ? l.rubrosNoAsignados : [];
  const relacionadas = [
    { campo: 't_ap', patron: /pagar|proveedor|acreedor/i },
    { campo: 't_ar', patron: /cobrar|deudor|cliente/i },
  ];
  relacionadas.forEach(({ campo, patron }) => {
    if (campos[campo] !== null) return;
    const candidatas = noAsignados.filter((r) => patron.test(r.rotulo) && Math.abs(r.valor) > 0);
    advertencias.push({
      tipo: 'sin-partida-relacionada',
      campo,
      mensaje: `«${ETIQUETA[campo]}»: el documento no desglosa esa partida con partes `
        + 'relacionadas, así que su ajuste de capital de trabajo quedará en cero.'
        + (candidatas.length
          ? ` Las que sí trae son: ${candidatas.map((r) => `«${r.rotulo}» ${fmtCop(r.valor)}`).join(', ')}. `
            + 'Si alguna corresponde a la operación, escríbala a mano.'
          : ''),
    });
  });

  if (campos.t_inv === null) {
    advertencias.push({
      tipo: 'sin-inventarios',
      campo: 't_inv',
      mensaje: 'No se leyeron inventarios. Si la compañía los tiene, escríbalos: su ajuste '
        + 'de capital de trabajo se está calculando contra cero.',
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
     y su anexo mostrando otra. */
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

/**
 * Los campos del estudio que la ingesta debe escribir, descartando los que quedaron sin
 * cifra para no sobrescribir con `null` un valor que el analista ya había escrito a mano.
 */
export function camposAplicables(campos) {
  return Object.fromEntries(
    Object.entries(campos || {}).filter(([, v]) => v !== null && v !== undefined),
  );
}
