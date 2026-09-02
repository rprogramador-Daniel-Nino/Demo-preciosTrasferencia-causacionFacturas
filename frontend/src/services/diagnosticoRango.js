/* ─────────────────────────────────────────────────────────────────────────────
   diagnosticoRango.js — por qué el estudio no cumple, y qué queda por probar.

   POR QUÉ EXISTE. La tarjeta de cumplimiento decía «NO CUMPLE (por debajo)» y nada más. No
   decía a cuánto estaba del límite, ni cuánto sería el ajuste en pesos —que `adjustInfo` ya
   calculaba en `adj.capped` y nadie mostraba—, ni cuál de los dos rangos estaba mirando, ni
   qué palancas quedaban. Sobre el caso que motivó esto —contribuyente en 1,509 % contra un
   rango de 5,316 % a 8,382 %— el analista veía el veredicto y tenía que salir a adivinar.

   NINGUNA PALANCA ES UNA SUGERENCIA GENÉRICA. Cada una se calcula de verdad y solo aparece
   si cambia el veredicto: se recalcula el rango con esa palanca aplicada y se compara. Un
   panel que sugiere cinco cosas de las que ninguna funciona enseña a ignorarlo, que es
   exactamente lo que ya le pasó a los avisos del generador antes de que se acotaran.

   Y LA PRIMERA PREGUNTA NO ES QUÉ PALANCA MOVER, SINO SI LA CIFRA ES CIERTA. Si el indicador
   del contribuyente sale de una lectura que no se pudo verificar contra el documento
   —escaneo sin capa de texto, cifras descartadas por venir de otra columna—, ajustar la
   muestra para alcanzar ese número deteriora el estudio en vez de arreglarlo. Por eso el
   diagnóstico encabeza con la confianza y no con las palancas.

   Mismo patrón que `semaforoRadicacion.js`: servicio puro, sin React y sin red, que la
   pantalla solo pinta. Es lo que permite probar cada palanca sin montar el componente.
   ───────────────────────────────────────────────────────────────────────────── */

import { num, pliOf, adjustInfo, segmentacionDesajuste, cumpleElRango } from '../utils/calculations.js';
import { analizarRango, margenQueDecide } from './rangoIntercuartil.js';
import { analizarRangoAjustado } from './ajusteRangoCapitalTrabajo.js';
import { enPerdida, gradoDeActividad } from './comparablesEngine.js';

/* El escenario de ajuste que reporta el informe. Mismo que `SABOR_INFORME` en
   `rangoIntercuartil.js`: CxC, CxP e inventario, sin PP&E. Se repite el valor y no se
   importa porque allá es privado; si algún día cambia, cambia en los dos sitios. */
const AJUSTE_DEL_INFORME = 'aar_aap_inv';

/** Los indicadores que el sistema ofrece, para poder decir «con MB sí cumpliría». */
const INDICADORES = ['MO', 'MB', 'Berry'];

/* Las tres cifras con las que se calcula el margen del contribuyente. Solo lo que las toca
   pone en duda el indicador: una corrección sobre inventarios o sobre PP&E es un hallazgo
   real, pero no cambia el número que la tarjeta compara contra el rango. Distinguirlo es lo
   que evita que casi todo estudio salga marcado «no confiable» y el aviso se vuelva ruido. */
const CAMPOS_DEL_MARGEN = ['t_s', 't_c', 't_op'];

/* Las advertencias de la verificación por columna. Se cuentan sobre CUALQUIER campo, no solo
   los tres del margen: un documento cuyas columnas se leyeron mal una vez no es de fiar en
   las demás filas tampoco, ni siquiera en las que salieron con veredicto `coincide`. */
const TIPOS_POR_COLUMNA = [
  'cifra-de-otro-anio', 'cifra-sin-dato-en-el-anio',
  'cifra-fuera-de-columna', 'cifra-de-otra-seccion',
];

/* Los indicadores que dividen por el COSTO y por tanto dependen de que el costo sea creíble.
   El margen operacional no está: usa utilidad sobre ventas y no toca el costo, que es la razón
   de que el defecto de abajo se pudiera colar sin que nada lo notara. */
const INDICADORES_QUE_USAN_COSTO = ['MB', 'Berry', 'CostPlus', 'NCP'];

/* A partir de qué punto un costo deja de ser creíble frente al ingreso.

   Una compañía SÍ puede vender por debajo del costo en un año malo, así que un margen bruto
   negativo no basta para descartar la fila. Lo que no puede pasar es que el costo sea el doble
   del ingreso: eso es un problema de unidades, de moneda o de columna, no un resultado.

   Reportado el 2026-09-01: en una muestra real había filas con el costo casi diez veces el
   ingreso —Formosa 5.586/54.076, Inabata 5.595/50.679, Hangzhou 56/547—, con márgenes brutos de
   -868 %, -806 % y -877 %. Esos outliers arrastraban el rango de MB hasta contener cualquier
   cosa, y la tarjeta «recomendaba» MB y Berry sobre esa base: mandaba a cambiar la metodología
   del estudio por un artefacto. */
const COSTO_SOBRE_INGRESO_MAXIMO = 2;

/** Las comparables cuyo costo no puede ser cierto frente a su ingreso, con el motivo. */
export function costosImplausiblesDe(comparables) {
  return (comparables || []).map((c) => {
    const s = num(c.s), costo = num(c.c);
    if (s === null || costo === null || s <= 0) return null;
    const ratio = costo / s;
    if (ratio <= COSTO_SOBRE_INGRESO_MAXIMO) return null;
    return {
      name: c.name || '(sin nombre)',
      ratio,
      motivo: `su costo de ventas es ${ratio.toFixed(1)} veces su ingreso, lo que no puede ser `
        + 'un resultado: apunta a un problema de unidades, de moneda o de columna en el cribado',
    };
  }).filter(Boolean);
}

/** Los ámbitos de muestra, con el nombre que usa el selector del tablero. */
const AMBITOS = [
  { valor: 'all', etiqueta: 'todas las comparables' },
  { valor: 'intl', etiqueta: 'solo internacionales' },
  { valor: 'nac', etiqueta: 'solo nacionales' },
];

/* ¿El indicador cae dentro del rango, y ese rango sostiene algo?
   Solo se usa para juzgar palancas, nunca para el veredicto —ese sale de `adjustInfo`— y por
   eso exige además que el rango tenga dispersión. Un rango con P25 igual a P75 no contiene al
   contribuyente: coincide con él por degeneración, que es lo que pasa cuando el indicador
   alterno no discrimina sobre esta muestra (por ejemplo MB con el costo de ventas en cero en
   todas las comparables: sale 100 % para todas y para el contribuyente). Proponerlo como
   palanca sería prometer un cumplimiento que ningún revisor sostendría. */
function dentro(stats, indicador) {
  if (!stats || indicador === null || indicador === undefined) return false;
  if (!(stats.p75 > stats.p25)) return false;
  /* La MISMA regla que decide el veredicto —por encima del primer cuartil—, importada de
     `utils/calculations.js`. Una palanca que se midiera con otro criterio prometeria un
     cumplimiento que la tarjeta no iba a confirmar. La guarda del rango degenerado se conserva:
     es de esta funcion y no del criterio. */
  return cumpleElRango(stats, indicador);
}

/** El indicador del contribuyente con el mismo criterio que la tarjeta: `pliOf` sobre las
 *  cifras del estudio con el segmento excluido descontado de ventas y de utilidad. */
function indicadorDelContribuyente(estudio, metodo) {
  const seg = num(estudio.seg_excluido) || 0;
  const tS = num(estudio.t_s);
  const tOp = num(estudio.t_op);
  return pliOf({
    s: tS !== null ? tS - seg : null,
    c: num(estudio.t_c),
    op: tOp !== null ? tOp - seg : null,
    ar: num(estudio.t_ar), inv: num(estudio.t_inv), ap: num(estudio.t_ap),
  }, metodo);
}

/* El estudio tal como lo espera el motor OCDE: `op` como GASTOS y no como utilidad. Es la
   misma traducción que hace `rangoIntercuartil.js`, y se repite aquí porque allá es privada.
   Cruzar esa frontera sin traducir es el error más caro de este sistema. */
const aGastos = (o) => {
  const s = num(o.s), c = num(o.c), op = num(o.op);
  return { ...o, op: (s !== null && c !== null && op !== null) ? s - c - op : null };
};

function estudioParaMotor(estudio, comparables) {
  return {
    ...estudio,
    t_op: aGastos({ s: estudio.t_s, c: estudio.t_c, op: estudio.t_op }).op,
    comparables: (comparables || []).map(aGastos),
  };
}

/**
 * Por qué el estudio no cumple y qué queda por probar.
 *
 * @param {object} args
 * @param {object} args.estudio      el estudio, con sus cifras y su configuración.
 * @param {Array}  args.comparables  la muestra en curso (el estado del tablero, no `study`).
 * @param {string} [args.cmode]      el ámbito seleccionado, si difiere del guardado.
 * @param {Array}  [args.universo]   el cribado de Capital IQ, para la palanca de pérdidas.
 * @param {object} [args.hallazgos]  lo que devolvió `verificarEeff` en la última ingesta.
 */
export function diagnosticarCumplimiento({
  estudio, comparables, cmode, universo, hallazgos,
} = {}) {
  const study = estudio || {};
  const muestra = comparables || [];
  const ambito = cmode || study.cmode || 'all';
  const metodo = study.pli || 'MO';

  const base = { ...study, comparables: muestra, cmode: ambito };
  const rango = analizarRango(base);
  const indicador = rango.tPLI;
  const stats = rango.stats;

  /* El ajuste en pesos que el informe declararía, con su tope y su improcedencia. Ya lo
     calculaba la tarjeta y no lo mostraba. */
  const T = {
    s: (num(study.t_s) || 0) - (num(study.seg_excluido) || 0),
    c: num(study.t_c), op: num(study.t_op),
    ar: num(study.t_ar), inv: num(study.t_inv), ap: num(study.t_ap),
  };
  const adj = (stats && indicador !== null) ? adjustInfo(T, indicador, stats, T.s || 0, 1, study.egreso) : null;

  /* Los dos rangos, y cuál decide. `useadj` lo elige en silencio y la tarjeta no lo decía,
     así que no había forma de saber si el 5,316 % que se veía era el ajustado o el otro. */
  const preparado = estudioParaMotor(base, muestra);
  const conAjuste = analizarRangoAjustado(preparado, metodo, AJUSTE_DEL_INFORME);
  const sinAjuste = analizarRangoAjustado(preparado, metodo, 'ninguno');

  const cumple = Boolean(adj && adj.within);
  const brecha = (stats && indicador !== null && !cumple)
    ? (indicador < stats.p25 ? stats.p25 - indicador : indicador - stats.p75)
    : null;

  /* Sin rango calculable no hay veredicto que cambiar, así que tampoco hay vías que
     proponer: la palanca de segmentación no depende del rango y se colaba sola, de modo que
     la tarjeta decía «1 vía que sí cambia el veredicto» junto a «ingrese cifras y comparables
     para analizar». Prometía algo sobre una conclusión que todavía no existe. */
  /* Qué comparables traen un costo que no puede ser cierto. Se calcula siempre, aunque el
     estudio cumpla: es un defecto del cribado y el analista tiene que verlo. */
  const costosImplausibles = costosImplausiblesDe(muestra);

  /* Cuanto sobra entre el indicador y el limite inferior, cuando cumple. Un cumplimiento por
     tres milesimas se sostiene igual de mal que uno que no cumple si una cifra se corrige, y
     eso hay que poder verlo sin recalcular a mano. */
  const colchon = (cumple && stats && indicador !== null) ? indicador - stats.p25 : null;

  const hayVeredicto = Boolean(stats) && indicador !== null;
  const palancas = (cumple || !hayVeredicto) ? [] : palancasQueCambianElVeredicto({
    /* `conAjuste` ya no viaja: es el rango que DECIDE (2026-09-02), y la palanca del ajuste
       solo necesita el otro para decir si el ajuste es lo que deja fuera al contribuyente.
       Pasarlo sin usarlo invitaba a volver a compararlo consigo mismo. */
    study, muestra, ambito, metodo, indicador, universo, sinAjuste,
    costosImplausibles,
  });

  /* Que hay que traer del cribado para que el primer cuartil no lo deje fuera. Solo cuando NO
     cumple: si cumple no hay nada que buscar. Se calcula aunque alguna palanca alcance, porque
     ampliar el cribado es la via que sostiene mejor el estudio -mas comparables reales- frente a
     apretar la seleccion de las pocas que hay. */
  const requisito = (cumple || !hayVeredicto) ? null : requisitoDeCribado({
    estudio: study, tamanoMuestra: muestra.length, indicador, universo,
  });

  /* ── LA TASA EN CERO ANULA EL AJUSTE, Y CON EL LA VARA QUE DECIDE ──
     El cumplimiento se concluye sobre el rango ajustado (2026-09-02), y ese ajuste se calcula
     con la tasa del paso 3. Con la tasa en cero cada ajuste sale nulo, el rango ajustado
     COLAPSA al crudo y el veredicto pasa a salir del rango que la metodologia del despacho
     descarta — sin que nada en la pantalla lo diga. Medido sobre el caso reportado: decidia con
     un P25 de 1,364 % (CUMPLE) en vez de 6,232 % (NO CUMPLE).

     Va en el diagnostico y no solo en la memoria del rango porque es AQUI donde se lee el
     veredicto; el modal hay que abrirlo. */
  const tasaAjuste = num(study.prime) || 0;
  const ajusteAnulado = !tasaAjuste;

  return {
    cumple,
    colchon,
    /* `true` cuando el rango ajustado no puede ajustar nada. La pantalla lo pinta como aviso,
       porque invalida la vara con la que se concluye. */
    ajusteAnulado,
    requisito,
    /* `null` cuando no hay rango o no hay indicador: es distinto de «no cumple», y la
       pantalla tiene que poder decir «faltan datos» en vez de un veredicto. */
    veredicto: (!stats || indicador === null) ? null : (cumple ? 'CUMPLE' : 'NO CUMPLE'),
    dir: adj && !adj.within ? adj.dir : null,
    indicador,
    metodo,
    brecha,
    stats,
    ajuste: adj ? {
      monto: adj.capped,
      topado: Boolean(adj.flag),
      improcedente: Boolean(adj.improcedente),
    } : null,
    rangos: {
      ajustado: conAjuste.stats,
      sinAjustar: sinAjuste.stats,
      /* Siempre el ajustado (2026-09-02): es el que sostiene la conclusion. Se conserva el
         campo porque la tarjeta lo pinta y porque publicar los dos rangos sigue siendo util
         —el sin ajustar es la vara con que se eligieron las comparables—. */
      decide: 'ajustado',
    },
    palancas,
    costosImplausibles,
    /* En vivo se usan los hallazgos de la ingesta de esta sesión; si la tarjeta se abre sin
       haber pasado por el paso 3 —lo normal al retomar un estudio guardado— se cae al
       resumen que la ingesta persistió con el estudio. */
    confianza: confianzaDelIndicador(
      hallazgos || study.t_lecturaEeff || null,
      study.t_camposAMano || [],
    ),
  };
}

/* Cada palanca se prueba de verdad: se recalcula el rango con ella aplicada y solo entra en
   la lista si el contribuyente pasa a estar dentro. Lo que no cambia el veredicto no se
   nombra, porque una lista de sugerencias inútiles se deja de leer. */
function palancasQueCambianElVeredicto({
  study, muestra, ambito, metodo, indicador, universo, sinAjuste,
  costosImplausibles = [],
}) {
  const palancas = [];

  /* ── 1. La política de pérdidas ──
     Va primera porque es la de más alcance: el filtro `excluir` le quita a toda muestra su
     extremo bajo, así que empuja el rango hacia arriba de forma sistemática. Y es la única
     que puede bajar el P25 por debajo de cero, que es lo que hace falta cuando el
     contribuyente está muy abajo.
     No se recalcula un rango hipotético aquí: eso exigiría volver a correr el motor con las
     negativas dentro, y el motor necesita la curación. Se dice cuántas hay, que es el dato
     accionable, y el analista lo prueba desde el paso 2. */
  const config = study.motorConfig || {};
  const disponibles = negativasDisponiblesEnUniverso(universo, study);
  const listaDisponibles = negativasDelUniverso(universo, study);
  const enLaMuestra = muestra.filter(enPerdida).length;
  /* La condición es «hay negativas en el universo que no están en la muestra», y no «el
     filtro está en excluir». Poner la política en «incluir» y dejar la cuota en cero no mete
     ninguna: el puntaje penaliza la pérdida (`fRent`), así que pierden contra cualquier
     positiva mientras haya positivas para llenar el cupo. Quien decide es la cuota. */
  if (disponibles > enLaMuestra) {
    const excluidasPorPolitica = config.perdidaOp === 'excluir';
    const cuotaActual = Math.max(0, Math.trunc(Number(config.negativasObjetivo) || 0));
    /* A cuánto subir la cuota, calculado: «súbalo» sin el número obligaba a probar y volver a
       correr el motor cada vez. */
    const cuotaQueCumple = cuotaMinimaQueCumple({
      study, muestra, ambito, indicador,
      negativasDisponibles: listaDisponibles,
    });
    const comoSubir = cuotaQueCumple !== null
      ? `Pruebe con ${cuotaQueCumple} en «Negativas objetivo»: con esa cuota el contribuyente `
        + 'queda dentro del rango. Es la más baja que lo consigue — con más de las necesarias el '
        + 'rango se ensancha y puede volverse enteramente negativo, que se defiende peor.'
      : 'Ojo: ninguna cuota alcanza con las negativas de este cribado, así que subirla acerca el '
        + 'rango pero no lo cierra. Amplíe el cribado del paso 1 o revise las otras vías.';
    palancas.push({
      clave: 'politicaPerdidas',
      cuantificado: disponibles - enLaMuestra,
      cuotaQueCumple,
      texto: `El universo tiene ${disponibles - enLaMuestra} comparable(s) en pérdida con la `
        + 'misma actividad detectada que no están en la muestra. Incluirlas baja el primer '
        + 'cuartil, y es el criterio de las Guías OCDE (cap. III, §3.64-3.65): una pérdida no '
        + 'descalifica por sí sola, hay que analizar su causa. '
        + (excluidasPorPolitica
          ? 'Hoy el filtro de pérdidas las descarta: cambie la política en el paso 2. '
          : `La política ya las admite y el objetivo está en ${cuotaActual}. `)
        + comoSubir,
    });
  }

  /* ── 2. El rango sin ajustar ──
     El cumplimiento lo decide el AJUSTADO en todo estudio (2026-09-02), asi que esto ya no es
     una palanca que el analista pueda accionar: no hay casilla que cambie la conclusion. Sigue
     siendo informacion —y por eso se reporta— porque dice DONDE esta el problema: si sin el
     ajuste el contribuyente si queda dentro, lo que lo saca es el ajuste, y entonces lo que hay
     que revisar es el capital de trabajo de las comparables (o el propio), no la muestra.

     Se emite como observacion y NO se promete que cambie el veredicto, que es la regla de esta
     lista: proponer «apague el ajuste» seria proponer concluir con el rango que la metodologia
     del despacho descarta. */
  if (sinAjuste && dentro(sinAjuste.stats, indicador)) {
    palancas.push({
      clave: 'ajusteCapitalTrabajo',
      cuantificado: null,
      accionable: false,
      texto: 'Sin el ajuste de capital de trabajo el contribuyente SÍ quedaría dentro del rango: '
        + 'lo que lo deja fuera es el ajuste. El cumplimiento se concluye sobre el rango ajustado, '
        + 'así que esto no se resuelve apagando nada — revise el capital de trabajo de las '
        + 'comparables y el de la parte examinada, que es lo que el ajuste compara.',
    });
  }

  /* ── 3. El indicador de rentabilidad ──
     Cambiar de MO a MB o a Berry es legítimo si el análisis funcional lo sustenta, y es una
     de las decisiones del método. Se prueba con el mismo motor. */
  /* Con el costo de alguna comparable fuera de toda escala, el rango de MB y de Berry se
     construye sobre un outlier y puede contener cualquier cosa. Proponer uno de esos
     indicadores ahí manda a cambiar la metodología del estudio por un artefacto, así que en vez
     de la palanca se emite el defecto. */
  const costoNoSirve = costosImplausibles.length > 0;
  if (costoNoSirve) {
    const nombres = costosImplausibles.map((c) => c.name).slice(0, 3).join(', ');
    palancas.push({
      clave: 'costosImplausibles',
      cuantificado: costosImplausibles.length,
      texto: `${costosImplausibles.length} comparable(s) de la muestra traen un costo de ventas `
        + `que no puede ser cierto frente a su ingreso: ${nombres}`
        + (costosImplausibles.length > 3 ? ` y ${costosImplausibles.length - 3} más` : '')
        + '. Mientras eso siga así NO se puede evaluar MB, Berry, Cost Plus ni NCP —todos '
        + 'dividen por el costo y su rango saldría de un dato imposible—, y el margen '
        + 'operacional es el único indicador que se sostiene con este cribado, porque no usa el '
        + 'costo. Revise la columna «Costo de ventas» del Excel de Capital IQ: suele ser un '
        + 'problema de unidades, de moneda o de columna.',
    });
  }

  INDICADORES.filter((m) => m !== metodo)
    .filter((otro) => !(costoNoSirve && INDICADORES_QUE_USAN_COSTO.includes(otro)))
    .forEach((otro) => {
    const preparado = estudioParaMotor({ ...study, comparables: muestra, cmode: ambito }, muestra);
    /* Con el escenario del informe siempre: el cumplimiento se concluye sobre el ajustado
       (2026-09-02), asi que probar el indicador alterno sobre el crudo prometeria un
       cumplimiento que la tarjeta no iba a confirmar. */
    const r = analizarRangoAjustado(preparado, otro, AJUSTE_DEL_INFORME);
    const suyo = indicadorDelContribuyente(study, otro);
    if (dentro(r.stats, suyo)) {
      palancas.push({
        clave: 'indicador:' + otro,
        cuantificado: suyo,
        texto: `Con ${otro} como indicador de rentabilidad el contribuyente queda dentro del `
          + 'rango. Cambiarlo hay que sustentarlo en el análisis funcional, no elegirlo por el '
          + 'resultado: revise si ese indicador describe mejor la operación analizada.',
      });
    }
  });

  /* ── 4. El ámbito de la muestra ── */
  AMBITOS.filter((a) => a.valor !== ambito).forEach((otro) => {
    const r = analizarRango({ ...study, comparables: muestra, cmode: otro.valor });
    if (dentro(r.stats, r.tPLI)) {
      palancas.push({
        clave: 'ambito:' + otro.valor,
        cuantificado: r.stats ? r.stats.n : null,
        texto: `Con el ámbito en «${otro.etiqueta}» el contribuyente queda dentro del rango `
          + `(${r.stats ? r.stats.n : 0} comparables). Acotar el ámbito hay que justificarlo: `
          + 'la comparabilidad geográfica es un criterio, no un filtro de conveniencia.',
      });
    }
  });

  /* ── 5. La segmentación ──
     No se prueba recalculando —no se sabe cuánto habría que excluir— pero sí se detecta el
     hecho: hay una diferencia sin explicar entre el ingreso del P&L y la operación con la
     vinculada, y mientras no se registre, el margen se está calculando sobre cifras
     mezcladas. Es un dato del estudio, no una sugerencia. */
  const seg = segmentacionDesajuste(study);
  if (seg && seg.desajuste && !num(study.seg_excluido)) {
    palancas.push({
      clave: 'segmentacion',
      cuantificado: seg.diferencia,
      texto: 'Hay una diferencia sin explicar entre el ingreso del estado de resultados y el '
        + 'monto de la operación con la vinculada. Si parte del ingreso viene de una operación '
        + 'no controlada, el margen se está calculando sobre cifras mezcladas: regístrela en '
        + '«Ingreso a excluir» del paso 3.',
    });
  }

  return palancas;
}

/**
 * La cuota de negativas MÁS PEQUEÑA que mete al contribuyente en el rango, o `null` si ninguna
 * lo consigue.
 *
 * Existe porque la palanca decía «súbalo en el paso 2» sin decir a cuánto, y el analista tenía
 * que probar 5, 6, 7 y volver a correr el motor cada vez. El número se puede calcular: se
 * simula la muestra con las N negativas más cercanas del universo —el mismo criterio que usa el
 * motor desde el 2026-09-01— y se busca la N más chica que cumple.
 *
 * Se da la MÍNIMA a propósito. Con más negativas de las necesarias el rango se ensancha y puede
 * volverse enteramente negativo, que ante un revisor se ve peor que cumplir con lo justo.
 *
 * Es una SIMULACIÓN, no una promesa: el motor decide con la curación, los filtros y el puntaje,
 * y aquí solo se sustituyen las últimas N positivas de la muestra por negativas. Sirve para
 * orientar la cuota, y por eso el texto dice «pruebe con N».
 */
function cuotaMinimaQueCumple({ study, muestra, ambito, negativasDisponibles, indicador }) {
  if (indicador === null || !negativasDisponibles.length || !muestra.length) return null;

  /* Las más cercanas al contribuyente primero, con la MISMA vara que aplica el motor: el PLI
     que decide el cumplimiento, ajustado o no según `useadj`. Con la vara cruda este cálculo
     devolvía una cuota que no cumplía —el motor elegía otro conjunto— y la tarjeta mandaba a
     probar un número equivocado. */
  const porCercania = [...negativasDisponibles].sort((a, b) => {
    const ma = margenParaCercania(a, study), mb = margenParaCercania(b, study);
    if (ma === null && mb === null) return 0;
    if (ma === null) return 1;
    if (mb === null) return -1;
    return Math.abs(ma - indicador) - Math.abs(mb - indicador);
  });

  /* Las positivas de la muestra en curso, de mejor a peor: las últimas son las que ceden. */
  const positivas = muestra.filter((c) => !enPerdida(c));
  const yaNegativas = muestra.filter((c) => enPerdida(c));
  const tope = Math.min(porCercania.length, muestra.length - MINIMO_POSITIVAS_EN_MUESTRA);

  for (let n = yaNegativas.length + 1; n <= tope; n += 1) {
    const conservadas = positivas.slice(0, Math.max(0, muestra.length - n));
    const simulada = [...conservadas, ...yaNegativas, ...porCercania.slice(0, n - yaNegativas.length)];
    if (simulada.length < 4) continue;
    const r = analizarRango({ ...study, comparables: simulada, cmode: ambito });
    if (r.stats && dentro(r.stats, r.tPLI)) return n;
  }
  return null;
}

/* Cuántas positivas se conservan como piso al simular: una muestra que fuera casi toda pérdida
   deja de describir el mercado y el rango entero se va a negativo, que es peor que no cumplir. */
const MINIMO_POSITIVAS_EN_MUESTRA = 2;

/* La vara con que se ordena la cercanía: la misma que decide el cumplimiento. Si el ajuste no
   se puede calcular para esa candidata —le faltan partidas— se cae al margen crudo, porque
   quedarse sin medida no es lo mismo que estar lejos. */
function margenParaCercania(cand, study) {
  const ajustado = margenQueDecide(cand, study);
  if (ajustado !== null) return ajustado;
  const s = num(cand.s), op = num(cand.op);
  if (s === null || !s || op === null) return null;
  return op / s;
}

/* Cuántas comparables en pérdida hay en el universo con la misma actividad detectada. Es el
   dato que convierte «podría incluir pérdidas» en «hay 5 ahí mismo». Se cuenta sobre el
   veredicto de la curación cuando existe, porque la decisión fue admitir solo actividad
   MISMA; sin curación no se puede afirmar la actividad y se cuentan todas las que estén en
   pérdida, que es el techo. */
function negativasDelUniverso(universo, study) {
  const lista = Array.isArray(universo) ? universo : [];
  if (!lista.length) return [];
  const porId = (study.iaMatch && study.iaMatch.porId) || null;
  return lista.filter((c) => {
    if (!enPerdida(c)) return false;
    if (!porId) return true;
    const id = c && c.id ? String(c.id).trim() : '';
    return gradoDeActividad(porId[id]) === 'MISMA';
  });
}

function negativasDisponiblesEnUniverso(universo, study) {
  const lista = Array.isArray(universo) ? universo : [];
  if (!lista.length) return 0;
  const porId = (study.iaMatch && study.iaMatch.porId) || null;
  return lista.filter((c) => {
    if (!enPerdida(c)) return false;
    if (!porId) return true;
    const id = c && c.id ? String(c.id).trim() : '';
    return gradoDeActividad(porId[id]) === 'MISMA';
  }).length;
}

/* ─────────────────────────────────────────────────────────────────────────────
   QUÉ HAY QUE TRAER DEL CRIBADO PARA QUE EL ESTUDIO CUMPLA

   Cuando ninguna palanca alcanza, el problema no es la selección: es el cribado. Medido sobre un
   caso real con solo 3 negativas y ninguna honda, contra un contribuyente en -4,595 %: la cuota
   completa deja el P25 en 1,275 %, bajar la muestra al piso de 10 lo deja en -0,375 %, y quitar
   las cuatro positivas más altas en -1,525 %. Ninguna cierra, ni todas juntas — porque en el
   universo cargado no existen las compañías que harían falta.

   Ahí el sistema tiene que dejar de decir «no cumple» y decir QUÉ BUSCAR, que es lo único
   accionable: un criterio de rentabilidad para el screening del paso 1.

   NO SE SIMULA, SE CALCULA. `cuartilInterpolado` es QUARTILE.INC: sobre n valores ordenados el
   primer cuartil cae en la posición (n-1)/4 (base 0). Para que el P25 quede en el nivel del
   contribuyente o por debajo basta con que el valor de la posición ceil((n-1)/4) ya esté en ese
   nivel, y para eso hacen falta ceil((n-1)/4) + 1 comparables contándolo. La aritmética se
   valida contra `analizarRango` tamaño por tamaño en las pruebas, porque un requisito de más
   manda a buscar compañías innecesarias y uno de menos hace pagar un cribado que sigue fallando.

   EL REQUISITO SE EXPRESA EN MARGEN, NO EN PÉRDIDAS. Con el contribuyente en utilidad baja lo
   que falta son comparables poco rentables, y ninguna tiene que estar en pérdida; hablar de
   pérdidas ahí mandaría a buscar lo que no hace falta y a justificar una inclusión que el
   estudio no necesita. `exigeNegativas` dice cuál de los dos casos es.
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * Las comparables del universo cuyo margen está en el nivel dado o por debajo.
 *
 * Se mide con `margenParaCercania`, que es la MISMA vara que decide el cumplimiento —ajustada o
 * no según `useadj`—. Contar con el margen crudo mientras el rango decide con el ajustado haría
 * que el requisito apuntara a un nivel que no es el que se compara: es el defecto que ya costó
 * una cuota equivocada en `cuotaMinimaQueCumple`.
 */
export function comparablesEnOPorDebajoDe(universo, study, nivel) {
  const lista = Array.isArray(universo) ? universo : [];
  if (nivel === null || nivel === undefined || Number.isNaN(nivel)) return [];
  return lista.filter((c) => {
    const m = margenParaCercania(c, study || {});
    return m !== null && m <= nivel;
  });
}

/**
 * Cuántas comparables en el nivel del contribuyente o por debajo hacen falta para que el primer
 * cuartil no lo deje fuera, cuántas de esas hay en el cribado, y cuántas faltan por traer.
 *
 * @param {object} p
 * @param {object} p.estudio        las cifras del contribuyente (para la vara del margen).
 * @param {number} p.tamanoMuestra  cuántas comparables va a tener la muestra.
 * @param {number} p.indicador      el margen de la parte examinada, en tanto por uno.
 * @param {Array}  p.universo       el cribado del paso 1.
 * @returns {object|null} `null` si no hay indicador o la muestra es demasiado corta: sin eso no
 *   se puede afirmar un requisito, y un número inventado mandaría a buscar mal.
 */
export function requisitoDeCribado({ estudio, tamanoMuestra, indicador, universo } = {}) {
  const n = Math.trunc(Number(tamanoMuestra) || 0);
  if (indicador === null || indicador === undefined || Number.isNaN(indicador)) return null;
  if (n < 4) return null;

  /* La posición del primer cuartil en QUARTILE.INC, base 0. */
  const posicion = (n - 1) / 4;
  const necesita = Math.ceil(posicion) + 1;

  const enNivel = comparablesEnOPorDebajoDe(universo, estudio || {}, indicador);
  const hay = enNivel.length;

  /* La más cercana POR ENCIMA del nivel: es la que dice cuán lejos está el cribado de servir.
     «La más honda que tienes es -3,8 % y necesitas -4,6 %» es accionable; «no hay» no lo es. */
  let laMasCercana = null;
  (Array.isArray(universo) ? universo : []).forEach((c) => {
    const m = margenParaCercania(c, estudio || {});
    if (m === null || m <= indicador) return;
    if (laMasCercana === null || m < laMasCercana) laMasCercana = m;
  });

  return {
    necesita,
    hay,
    faltan: Math.max(0, necesita - hay),
    alcanza: hay >= necesita,
    /* El margen que deben tener las que falten. Es el del contribuyente exacto: el mínimo que
       cumple, sin colchón añadido por cuenta del sistema. El colchón que quede se reporta
       aparte, para que se vea si el estudio quedó al filo. */
    margenObjetivo: indicador,
    laMasCercana,
    /* Si el nivel es negativo, lo que falta son comparables en pérdida y hay que justificarlas
       (Guías OCDE cap. III §3.64-3.65). Si es positivo, basta con poco rentables. */
    exigeNegativas: indicador < 0,
    tamanoMuestra: n,
  };
}

/**
 * Lo mínimo de una lectura que hace falta para juzgar la confianza más tarde.
 *
 * `verificarEeff` devuelve advertencias con textos largos y listas de candidatas, y eso vive
 * en el componente de la ingesta porque describe UNA lectura. Pero la tarjeta de cumplimiento
 * está tres pasos más adelante y puede abrirse en otra sesión, así que necesita un rastro
 * persistido. Este resumen es ese rastro: tipos, campos y conteos, sin prosa.
 *
 * @param {object} verificacion  el retorno de `verificarEeff`.
 * @param {object} [respaldoOcr] lo que devolvió `respaldarLecturaConOcr`, si corrió. Se guarda
 *   porque cambia el peso de la verificación: cotejar contra una transcripción hecha por el
 *   mismo modelo no es lo mismo que cotejar contra la capa de texto del propio PDF, y sin esta
 *   marca `verificadoContraTexto: true` diría las dos cosas por igual.
 */
export function resumenDeLectura(verificacion, respaldoOcr = null) {
  if (!verificacion) return null;
  return {
    verificadoContraTexto: verificacion.verificadoContraTexto === true,
    respaldoOcr: respaldoOcr
      ? { paginasTranscritas: respaldoOcr.paginasTranscritas || 0 }
      : null,
    advertencias: (verificacion.advertencias || []).map((a) => ({
      tipo: a.tipo || '', campo: a.campo || '', estado: a.estado || '',
    })),
    correcciones: (verificacion.correcciones || []).map((c) => ({ campo: c.campo || '' })),
    anioVerificado: verificacion.anioVerificado || null,
    verificadasPorColumna: verificacion.verificadasPorColumna || 0,
  };
}

/**
 * ¿Se puede confiar en el indicador del contribuyente?
 *
 * Responde a la pregunta que va ANTES de cualquier palanca. Si la cifra sale de una lectura
 * que no se pudo verificar, mover comparables para alcanzarla empeora el estudio.
 *
 * @param {object} hallazgos    `verificarEeff` en vivo, o el `resumenDeLectura` persistido.
 * @param {Array}  camposAMano  los campos que el analista escribió después de la lectura. Lo
 *   que él mismo digitó no es una cifra que la IA no pudo verificar: es su cifra. Sin esto el
 *   aviso de un escaneo no se apagaría nunca y el panel enseñaría a ignorarlo.
 */
export function confianzaDelIndicador(hallazgos, camposAMano = []) {
  const h = hallazgos || null;
  if (!h) {
    return {
      verificado: null,
      motivos: [],
      viaOcr: false,
      /* `null` y no `false`: no haber ingerido un documento en esta sesión no es lo mismo que
         haberlo ingerido y no haber podido verificarlo. */
    };
  }

  const aMano = new Set(Array.isArray(camposAMano) ? camposAMano : []);
  /* Una advertencia o una corrección sobre un campo que el analista ya reescribió no dice
     nada del número que hoy está en la casilla. */
  const vigente = (x) => !(x && x.campo && aMano.has(x.campo));
  const advertencias = (h.advertencias || []).filter(vigente);
  const correcciones = (h.correcciones || []).filter(vigente);
  const margenDigitado = CAMPOS_DEL_MARGEN.every((c) => aMano.has(c));

  const motivos = [];
  if (h.verificadoContraTexto === false && !margenDigitado) {
    motivos.push('el documento no trae capa de texto legible (es un escaneo), así que ninguna '
      + 'cifra pudo cotejarse contra él');
  }
  const porColumna = advertencias.filter((a) => TIPOS_POR_COLUMNA.includes(a.tipo));
  if (porColumna.length) {
    motivos.push(`${porColumna.length} cifra(s) se descartaron por venir de otra fila, otra `
      + 'columna de ejercicio u otra sección del documento');
  }
  const corrDelMargen = correcciones.filter((c) => CAMPOS_DEL_MARGEN.includes(c.campo));
  if (corrDelMargen.length) {
    motivos.push(`${corrDelMargen.length} de las tres cifras del margen se corrigió `
      + 'automáticamente: revise el rastro de la corrección en el paso 3');
  }
  /* Falta de cifra, que es distinto de cifra descartada por columna: esas ya se nombraron
     arriba y contarlas dos veces haría que el mismo defecto apareciera como dos motivos. */
  const sinCifra = advertencias.filter((a) => (
    CAMPOS_DEL_MARGEN.includes(a.campo) && !TIPOS_POR_COLUMNA.includes(a.tipo)
  ));
  if (sinCifra.length) {
    motivos.push('falta alguna de las tres cifras con las que se calcula el margen');
  }
  if (advertencias.some((a) => a.tipo === 'anio-ausente-en-documento')) {
    motivos.push('el documento cargado no trae la columna del año gravable del estudio');
  }

  /* `viaOcr` no es un motivo: la verificación existe —donde antes no había ninguna— y bloquear
     por ella devolvería el estudio al punto de partida. Es una salvedad, y se publica aparte
     para que la pantalla la diga en gris y no en ámbar. Las cifras que el analista digitó no
     dependen de ninguna transcripción, así que con las tres del margen a mano se apaga. */
  const viaOcr = Boolean(h.respaldoOcr && h.respaldoOcr.paginasTranscritas > 0) && !margenDigitado;

  return { verificado: motivos.length === 0, motivos, viaOcr };
}
