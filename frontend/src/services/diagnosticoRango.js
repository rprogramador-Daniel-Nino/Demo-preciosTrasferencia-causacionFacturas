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

import { num, pliOf, adjustInfo, segmentacionDesajuste } from '../utils/calculations.js';
import { analizarRango } from './rangoIntercuartil.js';
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
  'cifra-de-otro-anio', 'cifra-de-otra-fila',
  'cifra-fuera-de-columna', 'cifra-de-otra-seccion',
];

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
  return indicador >= stats.p25 && indicador <= stats.p75;
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

  const palancas = cumple ? [] : palancasQueCambianElVeredicto({
    study, muestra, ambito, metodo, indicador, universo, conAjuste, sinAjuste,
  });

  return {
    cumple,
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
      decide: study.useadj ? 'ajustado' : 'sinAjustar',
    },
    palancas,
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
  study, muestra, ambito, metodo, indicador, universo, conAjuste, sinAjuste,
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
  const enLaMuestra = muestra.filter(enPerdida).length;
  /* La condición es «hay negativas en el universo que no están en la muestra», y no «el
     filtro está en excluir». Poner la política en «incluir» y dejar la cuota en cero no mete
     ninguna: el puntaje penaliza la pérdida (`fRent`), así que pierden contra cualquier
     positiva mientras haya positivas para llenar el cupo. Quien decide es la cuota. */
  if (disponibles > enLaMuestra) {
    const excluidasPorPolitica = config.perdidaOp === 'excluir';
    palancas.push({
      clave: 'politicaPerdidas',
      cuantificado: disponibles - enLaMuestra,
      texto: `El universo tiene ${disponibles - enLaMuestra} comparable(s) en pérdida con la `
        + 'misma actividad detectada que no están en la muestra. Incluirlas baja el primer '
        + 'cuartil, y es el criterio de las Guías OCDE (cap. III, §3.64-3.65): una pérdida no '
        + 'descalifica por sí sola, hay que analizar su causa. '
        + (excluidasPorPolitica
          ? 'Hoy el filtro de pérdidas las descarta: cambie la política en el paso 2 y fije '
            + 'cuántas quiere en la muestra.'
          : 'La política ya las admite, pero el objetivo de negativas está en '
            + `${Math.max(0, Math.trunc(Number(config.negativasObjetivo) || 0))}: súbalo en el `
            + 'paso 2 y vuelva a correr el motor, con la justificación de la política.'),
    });
  }

  /* ── 2. El ajuste de capital de trabajo ──
     Está calculado siempre; lo único que `useadj` decide es cuál de los dos sostiene la
     conclusión. Si el que NO decide sí contiene al contribuyente, eso es información: es una
     decisión metodológica del estudio, no un cambio en la muestra. */
  const decideAjustado = Boolean(study.useadj);
  const elOtro = decideAjustado ? sinAjuste : conAjuste;
  if (elOtro && dentro(elOtro.stats, indicador)) {
    palancas.push({
      clave: 'ajusteCapitalTrabajo',
      cuantificado: null,
      texto: decideAjustado
        ? 'Sin el ajuste de capital de trabajo el contribuyente SÍ queda dentro del rango. '
          + 'Hoy la conclusión la sostiene el rango ajustado porque la casilla está activada.'
        : 'Con el ajuste de capital de trabajo activado el contribuyente SÍ queda dentro del '
          + 'rango. Está calculado y el Excel de soporte ya lo publica; solo falta que la '
          + 'casilla del paso 3 lo haga decidir.',
    });
  }

  /* ── 3. El indicador de rentabilidad ──
     Cambiar de MO a MB o a Berry es legítimo si el análisis funcional lo sustenta, y es una
     de las decisiones del método. Se prueba con el mismo motor. */
  INDICADORES.filter((m) => m !== metodo).forEach((otro) => {
    const preparado = estudioParaMotor({ ...study, comparables: muestra, cmode: ambito }, muestra);
    const r = analizarRangoAjustado(preparado, otro, study.useadj ? AJUSTE_DEL_INFORME : 'ninguno');
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

/* Cuántas comparables en pérdida hay en el universo con la misma actividad detectada. Es el
   dato que convierte «podría incluir pérdidas» en «hay 5 ahí mismo». Se cuenta sobre el
   veredicto de la curación cuando existe, porque la decisión fue admitir solo actividad
   MISMA; sin curación no se puede afirmar la actividad y se cuentan todas las que estén en
   pérdida, que es el techo. */
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
