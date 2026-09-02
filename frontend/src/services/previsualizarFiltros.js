/* ─────────────────────────────────────────────────────────────────────────────
   previsualizarFiltros.js — qué va a pasar cuando corras el motor, antes de pagarlo.

   POR QUÉ EXISTE. El paso 2 se configuraba a ciegas. Fijabas cuatro filtros sin saber qué
   efecto tendrían sobre el universo cargado y solo lo descubrías después de correr la curación
   con IA, que se paga por candidata: en un cribado real de 2.987 compañías, ~1.359 evaluaciones
   iban a la basura. Si te habías equivocado, volvías a pagar. Y ningún control decía lo que
   costaba: «excluye holdings» no dice cuántas, «Prioridad Geográfica» parecía descartar cuando
   solo ordena, y poner las pérdidas en «incluir» no mete ninguna negativa sin la cuota.

   Los cuatro filtros duros son JavaScript puro sobre datos que ya están en memoria —la
   importación deja `hasLoss` y `hasNegativeBalance` calculados en cada fila—, así que
   previsualizarlos no cuesta una sola llamada al modelo y se puede recalcular mientras el
   analista mueve un selector.

   LA REGLA QUE SOSTIENE TODO ESTO: se usa el MISMO juez que el motor. `filtroQueDescarta` y
   `prefiltrar` viven en `comparablesEngine.js` y de ellos salen tanto el embudo de esta
   pantalla como el descarte de verdad. Recalcular aquí por cuenta propia sería reintroducir la
   divergencia que ya costó un defecto: `prefiltrar` no eximía a las de continuidad del filtro
   de holding y el motor sí, de modo que una comparable del estudio del año pasado con «Group»
   en la razón social se caía antes de curarse. Un panel que promete un número que el motor no
   respeta es peor que no mostrar nada.

   DÓNDE TERMINA LA CERTEZA. El embudo llega hasta los filtros duros y ahí se detiene: el grado
   de actividad —MISMA, RELACIONADA, DISTINTA— solo lo sabe el modelo, y fingir un número ahí
   sería peor que no darlo. Lo mismo con «cuántas negativas de la misma actividad»: se dice
   cuántas hay en pérdida, que es el techo real.

   Mismo patrón que `semaforoRadicacion.js` y `diagnosticoRango.js`: servicio puro, sin React y
   sin red, que la pantalla solo pinta.
   ───────────────────────────────────────────────────────────────────────────── */

import {
  FILTROS_DUROS, configDeFiltros, filtroQueDescarta, prefiltrar, enPerdida, nameKey,
  MINIMO_COMPARABLES, CURACION_LOTE, CURACION_CONCURRENCIA, SEGUNDOS_POR_LOTE,
} from './comparablesEngine.js';
import { num, pliOf } from '../utils/calculations.js';
/* El requisito se calcula en `diagnosticoRango.js` y NO se reimplementa aquí: la tarjeta del
   paso 4 y este panel tienen que pedir el mismo número de comparables, o el analista amplía el
   cribado con una cifra y luego la tarjeta le pide otra. */
import { requisitoDeCribado } from './diagnosticoRango.js';

/* Cuántos nombres se muestran de cada descarte. Cinco: la lista es para VERIFICAR que el filtro
   no se equivocó —el de holding se presume de la razón social y a veces acierta de más—, no
   para leerla entera. El resto se cuenta. */
export const EJEMPLOS_POR_FILTRO = 5;

/* Qué es cada filtro, en palabras, y si descarta o solo ordena. La pantalla no redacta esto:
   un rótulo que vive en el componente acaba diciendo algo distinto del que vive en el informe. */
const DESCRIPCION = {
  controlada: {
    etiqueta: 'Independencia (Art. 260-1)',
    queHace: 'Descarta la compañía en la que un accionista alcanza o supera el umbral de '
      + 'control. Es el filtro más duro y el único que NO perdona a una comparable del estudio '
      + 'anterior: no ser independiente es un hecho de hoy.',
  },
  holding: {
    etiqueta: 'Sociedades Holding',
    queHace: 'Descarta la sociedad de tenencia o de grupo, reconocida por su RAZÓN SOCIAL. Es '
      + 'una presunción, no un hecho, y por eso conserva a las que venían del estudio anterior. '
      + 'Conviene revisar los ejemplos: por el nombre se acierta de más.',
  },
  saldoNegativo: {
    etiqueta: 'Saldos Negativos',
    queHace: 'Descarta datos no verosímiles: cuentas por cobrar, por pagar o inventarios con '
      + 'saldo negativo en el balance. No tiene relación con las pérdidas operativas.',
  },
  perdidaOperativa: {
    etiqueta: 'Pérdidas Operativas',
    queHace: 'Descarta la compañía con utilidad operacional negativa. Es el filtro que decide '
      + 'si el estudio puede cumplir cuando el contribuyente está en pérdida: quitarle a la '
      + 'muestra su extremo bajo empuja el primer cuartil hacia arriba.',
  },
};

const GEOGRAFIA = {
  ninguna: 'Global: todas las regiones pesan igual en el puntaje.',
  LATAM: 'América Latina pondera más alto en el puntaje. NO descarta a nadie: una comparable de '
    + 'otra región sigue pudiendo entrar si el resto de sus factores la sostiene.',
  NORTEAM: 'Norteamérica pondera más alto en el puntaje. NO descarta a nadie: una comparable de '
    + 'otra región sigue pudiendo entrar si el resto de sus factores la sostiene.',
};

/** El margen del contribuyente con el indicador del estudio, o `null` si faltan cifras. */
function indicadorDelContribuyente(estudio) {
  const e = estudio || {};
  const seg = num(e.seg_excluido) || 0;
  const tS = num(e.t_s);
  const tOp = num(e.t_op);
  if (tS === null || tOp === null) return null;
  return pliOf({
    s: tS - seg, c: num(e.t_c), op: tOp - seg,
    ar: num(e.t_ar), inv: num(e.t_inv), ap: num(e.t_ap),
  }, e.pli || 'MO');
}

const pct = (v) => (v === null || v === undefined || Number.isNaN(v))
  ? '—'
  : `${(v * 100).toLocaleString('es-CO', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} %`;

/**
 * Qué va a pasar con esta configuración, sin gastar una llamada al modelo.
 *
 * @param {Array}  universo    el cribado importado en el paso 1.
 * @param {object} config      `engineConfig` del paso 2.
 * @param {object} [contexto]
 * @param {object} [contexto.estudio]          las cifras del contribuyente, para el aviso de
 *   imposibilidad. Sin ellas no se afirma nada sobre cumplimiento.
 * @param {object} [contexto.iaMatch]          la curación ya pagada (`{porId}`), para descontarla.
 * @param {object} [contexto.estudioAnterior]  `{comparables}` del año previo, para la continuidad.
 */
export function previsualizarFiltros(universo, config = {}, contexto = {}) {
  const lista = Array.isArray(universo) ? universo : [];
  const cfg = configDeFiltros(config);
  const { estudio = null, iaMatch = null, estudioAnterior = null } = contexto;

  const previas = (estudioAnterior && Array.isArray(estudioAnterior.comparables))
    ? estudioAnterior.comparables : [];
  const { validas, porMotivo } = prefiltrar(lista, config, previas);

  /* ── El embudo, paso por paso y en el orden de precedencia del motor ── */
  const pasos = FILTROS_DUROS.map((f) => {
    const caidas = porMotivo[f.clave] || [];
    return {
      clave: f.clave,
      etiqueta: DESCRIPCION[f.clave].etiqueta,
      queHace: DESCRIPCION[f.clave].queHace,
      activo: f.activo(cfg),
      saca: caidas.length,
      ejemplos: caidas.slice(0, EJEMPLOS_POR_FILTRO).map((c) => c.name).filter(Boolean),
      /* Cuántas quedan sin nombrar, para no insinuar que la lista está completa. */
      masSinNombrar: Math.max(0, caidas.length - EJEMPLOS_POR_FILTRO),
    };
  });

  const nObjetivo = Math.max(0, Math.trunc(Number(config.nTarget) || 0));
  const quedan = validas.length;
  const entran = Math.min(nObjetivo, quedan);
  const reserva = Math.max(0, quedan - entran);

  /* ── Lo que se va a pagar ──
     Mismo criterio que `curateCandidatesWithGemini`: solo se cura lo que trae identificador Y
     descripción del negocio. Lo demás sigue de largo hacia la heurística sin costar nada. */
  const curables = validas.filter(
    (c) => c && c.id && String(c.id).trim() && c.desc && String(c.desc).trim(),
  );
  const yaCurado = (iaMatch && iaMatch.porId) || null;
  const aCurar = yaCurado
    ? curables.filter((c) => !yaCurado[String(c.id).trim()])
    : curables;
  const lotes = Math.ceil(aCurar.length / CURACION_LOTE) || 0;
  const curacion = {
    aCurar: aCurar.length,
    reutilizadas: curables.length - aCurar.length,
    sinDatosParaCurar: quedan - curables.length,
    lotes,
    /* El mismo cálculo del motor, para que el estimado de antes y el de durante coincidan. */
    etaMinutos: lotes ? Math.ceil((lotes / CURACION_CONCURRENCIA) * SEGUNDOS_POR_LOTE / 60) : 0,
  };

  /* ── La continuidad que esta configuración rompe ──
     El control accionario y la pérdida no perdonan la continuidad, así que una comparable del
     año anterior puede caerse — y hasta ahora se caía sin que nadie lo dijera. Retirarla hay
     que justificarlo en el informe. */
  const priorSet = new Set(previas.map((c) => c.nameKey || nameKey(c.name)).filter(Boolean));
  const deContinuidad = lista.filter((c) => priorSet.has(c.nameKey || nameKey(c.name)));
  const continuidadCaen = deContinuidad
    .map((c) => {
      const fuera = filtroQueDescarta(c, config, true);
      return fuera ? { name: c.name, motivo: fuera.motivo, clave: fuera.clave } : null;
    })
    .filter(Boolean);
  const continuidad = { total: deContinuidad.length, caen: continuidadCaen };

  /* ── Las negativas que hay de verdad ──
     Sobre el universo COMPLETO y no sobre las válidas: con el filtro de pérdidas activo las
     negativas ya salieron, y el dato que hace falta es cuántas habría si se admitieran. No se
     puede decir cuántas son de la MISMA actividad —eso solo lo sabe la curación—, así que este
     número es el techo. */
  const enPerdidaEnUniverso = lista.filter((c) => enPerdida(c)).length;

  /* Cuántas comparables traen capital de trabajo. Decide si el ajuste puede comparar algo:
     medido el 2026-09-01, con las comparables en cero el ajuste no es una corrección de
     comparabilidad sino un corrimiento fijo calculado solo con el capital de trabajo del
     contribuyente —+2,33 puntos sobre todas—, y si el estudio concluye sobre el rango ajustado
     entonces la conclusión se apoya en un artefacto. */
  const conCapitalTrabajo = lista.filter((c) => (
    num(c.ar) || num(c.inv) || num(c.ap) || num(c.ppe)
  )).length;
  const capitalTrabajo = {
    total: lista.length,
    conDatos: conCapitalTrabajo,
    sinDatos: lista.length - conCapitalTrabajo,
  };

  const indicador = indicadorDelContribuyente(estudio);
  const negativasObjetivo = Math.max(0, Math.trunc(Number(config.negativasObjetivo) || 0));

  return {
    hayUniverso: lista.length > 0,
    universo: lista.length,
    pasos,
    quedan,
    nObjetivo,
    entran,
    reserva,
    curacion,
    continuidad,
    enPerdidaEnUniverso,
    indicador,
    geografia: {
      descarta: false,
      valor: cfg.geo || config.geo || 'ninguna',
      texto: GEOGRAFIA[config.geo] || GEOGRAFIA.ninguna,
    },
    capitalTrabajo,
    avisos: lista.length ? avisosDe({
      cfg, config, indicador, quedan, nObjetivo, enPerdidaEnUniverso,
      negativasObjetivo, continuidad, capitalTrabajo, estudio,
      /* Las que pasaron los filtros: es el universo real del que puede salir la muestra,
         no el cribado completo. Contar sobre el cribado crudo prometeria comparables que
         los propios filtros de esta pantalla ya descartaron. */
      candidatasValidas: validas,
    }) : [],
  };
}

/* Los avisos. Cada uno aparece SOLO cuando lo que dice es cierto y comprobable: un panel que
   avisa de todo enseña a ignorar los avisos, que es lo que ya le pasó a los del generador. */
function avisosDe({
  cfg, config, indicador, quedan, nObjetivo, enPerdidaEnUniverso, negativasObjetivo, continuidad,
  capitalTrabajo, estudio, candidatasValidas = [],
}) {
  const avisos = [];

  /* 0. El ajuste de capital de trabajo sin capital de trabajo.
        Va primero porque invalida la vara con la que el estudio concluye, y eso pesa más que
        cualquier ajuste de la muestra. Solo aplica si el estudio de verdad concluye sobre el
        rango ajustado: sin `useadj` no hay nada que distorsionar. */
  if (estudio && estudio.useadj && capitalTrabajo && capitalTrabajo.total
      && capitalTrabajo.conDatos < capitalTrabajo.total) {
    const cuantas = capitalTrabajo.conDatos === 0
      ? 'ninguna'
      : `solo ${capitalTrabajo.conDatos} de ${capitalTrabajo.total}`;
    avisos.push({
      clave: 'ajusteSinCapitalTrabajo',
      severidad: 'bloqueo',
      texto: `El estudio concluye sobre el rango AJUSTADO por capital de trabajo, y ${cuantas} `
        + 'de las candidatas del cribado trae esas partidas. Con las comparables en cero el '
        + 'ajuste deja de comparar: se vuelve un corrimiento fijo calculado solo con el capital '
        + 'de trabajo del contribuyente, que empuja todo el rango en la misma dirección y hace '
        + 'más difícil cumplir sin que eso signifique nada. Vuelva a exportar el cribado de '
        + 'Capital IQ con cuatro columnas más —Accounts Receivable, Inventory, Accounts Payable '
        + 'y Net PP&E— o concluya sobre el rango sin ajustar.',
    });
  }

  /* 1. Incumplimiento DEMOSTRABLE, no probable.
        Toda comparable con utilidad >= 0 tiene indicador >= 0, luego el primer cuartil de una
        muestra sin negativas queda siempre por encima de un contribuyente negativo.

        La demostración NO depende del filtro sino de si la muestra PUEDE contener una negativa,
        y por eso son dos casos con salidas distintas. Lo destapó el cribado real de Makita:
        1.632 compañías y CERO en pérdida operativa —el screening de Capital IQ ya las había
        excluido—, con el contribuyente en −1,356 %. Mandarlo ahí a «cambie la política» sería
        mandarlo a una vía que no existe. */
  const contribuyenteEnPerdida = indicador !== null && indicador < 0;
  if (contribuyenteEnPerdida && enPerdidaEnUniverso === 0) {
    avisos.push({
      clave: 'imposibleCumplir',
      severidad: 'bloqueo',
      texto: `El contribuyente está en ${pct(indicador)} y este cribado NO trae ninguna `
        + 'compañía en pérdida operativa, así que el estudio no puede quedar en rango con este '
        + 'universo: toda comparable rentable tiene margen sobre cero y el primer cuartil '
        + 'quedará siempre por encima. Cambiar los filtros de esta pantalla no lo resuelve. '
        + 'Amplíe el cribado en el paso 1 —el screening de Capital IQ suele excluir de entrada '
        + 'a las compañías en pérdida— o asuma que el estudio no cumple y declare el ajuste.',
    });
  } else if (contribuyenteEnPerdida && cfg.perdidaOp === 'excluir') {
    avisos.push({
      clave: 'imposibleCumplir',
      severidad: 'bloqueo',
      texto: `El contribuyente está en ${pct(indicador)} y las pérdidas operativas están `
        + 'excluidas: con esta configuración el estudio NO PUEDE quedar en rango. Toda '
        + 'comparable rentable tiene margen sobre cero, así que el primer cuartil quedará '
        + `siempre por encima. El universo tiene ${enPerdidaEnUniverso} compañía(s) en pérdida. `
        + 'Cambie «Pérdidas Operativas» a Incluir y fije cuántas quiere en «Negativas '
        + 'objetivo» — con su justificación, que es lo que sustenta la decisión en el informe.',
    });
  }

  /* 2. La política admite pérdidas pero la cuota está en cero.
        Es el punto más contraintuitivo del motor: el puntaje penaliza la pérdida, así que las
        negativas pierden contra cualquier positiva mientras haya positivas para llenar el cupo.
        Poner «incluir» y no tocar la cuota no mete ninguna. */
  if (cfg.perdidaOp !== 'excluir' && negativasObjetivo === 0 && enPerdidaEnUniverso > 0) {
    avisos.push({
      clave: 'cuotaEnCero',
      severidad: 'aviso',
      texto: 'Las pérdidas están admitidas, pero «Negativas objetivo» está en 0 y así no '
        + 'entrará ninguna: el puntaje penaliza la pérdida, de modo que pierden contra '
        + 'cualquier positiva mientras haya positivas para llenar el cupo. La cuota es la que '
        + 'reserva lugar antes del llenado por puntaje.',
    });
  }

  /* 3. Pedir negativas con el filtro que las excluye. La UI deshabilita el campo, pero el
        estudio puede venir guardado con esa combinación. */
  if (cfg.perdidaOp === 'excluir' && negativasObjetivo > 0) {
    avisos.push({
      clave: 'cuotaContradictoria',
      severidad: 'aviso',
      texto: `Se piden ${negativasObjetivo} comparable(s) en pérdida y el filtro de pérdidas `
        + 'operativas las excluye. El motor va a ignorar la cuota: ponga la política en '
        + 'Incluir, o baje la cuota a 0.',
    });
  }

  /* 4. Admitir pérdidas sin justificación escrita. Es lo que el informe publica y lo que
        sostiene la decisión ante la DIAN (Guías OCDE cap. III, §3.64-3.65). */
  if (cfg.perdidaOp !== 'excluir' && negativasObjetivo > 0
      && !String(config.justificacionPerdida || '').trim()) {
    avisos.push({
      clave: 'sinJustificacion',
      severidad: 'aviso',
      texto: 'Falta la justificación de admitir comparables en pérdida. El Excel de soporte la '
        + 'publica y es lo que sustenta la decisión: una pérdida no descalifica por sí sola '
        + '(Guías OCDE cap. III, §3.64-3.65), pero hay que decir por qué se analizó y se aceptó.',
    });
  }

  /* 4-bis. QUÉ FALTA EN EL CRIBADO, con el número exacto.
        Es el aviso que responde a «en otra compañía las comparables que selecciona no alcanzan
        a estar por encima del P25» (2026-09-02). Los avisos anteriores dicen que el estudio no
        va a cumplir; este dice QUÉ TRAER para que cumpla, y va aquí —antes de correr y de
        pagar— porque después de la curación el remedio ya cuesta otra corrida.

        No se muestra cuando las pérdidas están excluidas: ahí manda el aviso de imposibilidad,
        que apunta a cambiar la política antes que a ampliar el cribado. */
  const requisito = (indicador !== null && cfg.perdidaOp !== 'excluir')
    ? requisitoDeCribado({
      estudio, tamanoMuestra: nObjetivo, indicador, universo: candidatasValidas,
    })
    : null;
  if (requisito && requisito.faltan > 0) {
    avisos.push({
      clave: 'cribadoInsuficiente',
      severidad: 'aviso',
      texto: `Con una muestra de ${nObjetivo} hacen falta ${requisito.necesita} comparable(s) `
        + `con margen igual o menor a ${pct(indicador)} para que el primer cuartil no deje `
        + `fuera al contribuyente, y este cribado tiene ${requisito.hay}`
        + (requisito.laMasCercana !== null
          ? ` (la más cercana, ${pct(requisito.laMasCercana)})` : '')
        + `. Faltan ${requisito.faltan}. Ninguna configuración de esta pantalla lo resuelve: `
        + 'agregue al screening del paso 1 un criterio de rentabilidad que las traiga'
        + (requisito.exigeNegativas
          ? ' —al ser un margen negativo entrarán compañías en pérdida, y habrá que justificarlas.'
          : ' —no hace falta que estén en pérdida: basta con que sean poco rentables.'),
    });
  }

  /* 5. Pedir más negativas de las que existen. Se dice la cifra real en vez de dejar que el
        motor devuelva menos sin explicar. */
  if (negativasObjetivo > enPerdidaEnUniverso && cfg.perdidaOp !== 'excluir') {
    avisos.push({
      clave: 'negativasInsuficientes',
      severidad: 'aviso',
      texto: `Se piden ${negativasObjetivo} comparable(s) en pérdida y el universo tiene `
        + `${enPerdidaEnUniverso}. Entrarán las que haya. Amplíe el cribado si necesita más, y `
        + 'tenga en cuenta que además deben ser de la misma actividad detectada.',
    });
  }

  /* 6. El universo no llena el cupo. Se distingue quedarse corto del objetivo —incómodo— de
        bajar del piso del estudio, que es otra cosa. */
  if (quedan < nObjetivo) {
    const bajoElPiso = quedan < MINIMO_COMPARABLES;
    avisos.push({
      clave: 'universoCorto',
      severidad: bajoElPiso ? 'bloqueo' : 'aviso',
      texto: `Tras los filtros quedan ${quedan} candidata(s) y se piden ${nObjetivo}. `
        + (bajoElPiso
          ? `Son menos del mínimo de ${MINIMO_COMPARABLES} con que este motor sostiene un `
            + 'rango: afloje un filtro o amplíe el cribado del paso 1.'
          : `Superan el mínimo de ${MINIMO_COMPARABLES}, así que el estudio se sostiene, pero `
            + 'la muestra será más corta de lo pedido.'),
    });
  }

  /* 7. La continuidad que se rompe. */
  if (continuidad.caen.length) {
    const nombres = continuidad.caen.map((c) => c.name).join(', ');
    avisos.push({
      clave: 'continuidadRota',
      severidad: 'aviso',
      texto: `${continuidad.caen.length} de las ${continuidad.total} comparables del estudio `
        + `anterior se retiran con esta configuración: ${nombres}. Romper la serie hay que `
        + 'justificarlo en el informe — revise si el motivo lo sostiene.',
    });
  }

  return avisos;
}
