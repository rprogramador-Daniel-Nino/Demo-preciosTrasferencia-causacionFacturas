/* ─────────────────────────────────────────────────────────────────────────────
   Ajuste de capital de trabajo sobre el rango intercuartil.

   Este módulo replica la metodología del modelo Excel de rangos
   (Rangos_-_END_GAME_2025.xlsm, hojas OM / GM / BERRY / Cost Plus / NCP y las
   filas 81–117 de cada hoja 'Co N'). El sistema ya calculaba un rango sin ajuste
   y una versión de ajuste simplificada dentro de rangoIntercuartil.js; lo que
   faltaba era el ajuste completo por cada partida de capital de trabajo —cuentas
   por cobrar, cuentas por pagar, inventario y PP&E— y sus combinaciones, que es
   lo que el consultor calculaba a mano en la hoja de cálculo.

   La diferencia con el ajuste que ya vivía en rangoIntercuartil.js es doble:
     1. Aquí cada partida ajusta la BASE del indicador (ventas, costos u opex),
        no solo el numerador. El Excel construye una "venta ajustada" y divide
        sobre ella; ignorar eso desviaba el rango.
     2. El factor de descuento no es la tasa a secas: para CxC y CxP es
        t/(1+t) —valor presente de un flujo a un período— y para inventario y
        PP&E es la tasa directa. Se respetan tal cual salen de las fórmulas del
        Excel, comparable por comparable, para que el rango publicado sea el
        mismo que sustenta el estudio.

        Esas dos convenciones conviven dentro del mismo ajuste y no se han
        homogeneizado: es una decisión heredada de la plantilla, no un descuido,
        y por eso tiene que quedar descrita en el anexo metodológico del informe.

   Se partió de una réplica exacta de END GAME 2025, y desde ahí se corrigieron
   dos defectos que la plantilla arrastraba y que la auditoría celda por celda del
   libro de Capital IQ dejó documentados:

     · el ajuste de PP&E no escalaba por la base del método, así que salía
       prácticamente cero y los escenarios con PP&E no se distinguían de los
       demás;
     · la venta ajustada se usaba como denominador en los siete sabores, también
       en los que no restan el ajuste de cuentas por cobrar del numerador.

   Por eso los sabores `aap`, `inv`, `ppe` y `aar_aap_inv_ppe` ya NO coinciden con
   la hoja original: coinciden con ella corregida. Los demás sí siguen cuadrando
   con END GAME al quinto decimal.
   ───────────────────────────────────────────────────────────────────────────── */

import { num } from '../utils/calculations.js';

/* Los seis ajustes del modelo, en el mismo orden y con las mismas etiquetas que
   las columnas de las hojas de método del Excel. 'ninguno' es el rango sin ajuste
   —el que el sistema ya sabía calcular— y se conserva para no romper esa ruta. */
export const TIPOS_AJUSTE = {
  ninguno: 'Sin ajuste',
  aar: 'Ajuste 1 (Cuentas por Cobrar)',
  aap: 'Ajuste 2 (Cuentas por Pagar)',
  inv: 'Ajuste 3 (Inventario)',
  aar_aap_inv: 'Ajuste 4 (CxC, CxP e Inventario)',
  aar_aap_inv_ppe: 'Ajuste 5 (CxC, CxP, Inventario y PP&E)',
  ppe: 'Ajuste 6 (Propiedad, Planta y Equipo)',
};

/* Sabores que restan el ajuste de cuentas por cobrar del numerador y, por tanto,
   son los únicos que deben dividir sobre la venta ajustada. */
const AJUSTAN_AR = new Set(['aar', 'aar_aap_inv', 'aar_aap_inv_ppe']);

/* Métodos que admiten este ajuste. El Índice de Berry queda fuera por decisión
   heredada del sistema (rangoIntercuartil.js ya lo excluía), pero el Excel sí lo
   ajusta, así que se ofrece aquí como opción explícita y se documenta el matiz.

   Cada método define la BASE sobre la que se escala cada partida de capital de
   trabajo y sobre la que se divide el indicador:
     - MO / MB      → ventas netas
     - Berry        → gastos operativos
     - NCP          → costo de ventas + gastos operativos
     - Cost Plus    → costo de ventas (COGS) */
const BASES = {
  MO: 'ventas',
  MB: 'ventas',
  Berry: 'opex',
  NCP: 'costos',
  CostPlus: 'cogs',
};

/* Métodos cuyo numerador es la utilidad bruta (ventas − costos); los otros dos —MO y
   NCP— van con la utilidad operacional. Está aquí arriba, junto a BASES y AJUSTAN_AR,
   porque es configuración del método y no aritmética del ajuste: `desgloseAjuste` publica
   las dos utilidades y es `indicadorAjustado` quien elige, con este criterio, cuál divide.
   Escrito una sola vez, que es lo que impide que las dos funciones lo respondan distinto. */
const NUMERADOR_UTIL_BRUTA = new Set(['MB', 'Berry', 'CostPlus']);

/* Cifras de una parte (contribuyente o comparable) normalizadas a números.
   Se aceptan los mismos nombres cortos que usa el resto del sistema (s, c, op…)
   más las cuatro partidas de capital de trabajo promedio que el ajuste necesita. */
function cifras(parte) {
  const p = parte || {};
  return {
    s: num(p.s),        // ventas netas
    c: num(p.c),        // costo de ventas (COGS)
    op: num(p.op),      // gastos operativos totales
    gp: num(p.s) !== null && num(p.c) !== null ? num(p.s) - num(p.c) : null, // utilidad bruta
    ebit: pliEbit(p),   // utilidad operacional
    ar: num(p.ar) || 0, // CxC promedio
    inv: num(p.inv) || 0, // inventario promedio
    ap: num(p.ap) || 0, // CxP promedio
    ppe: num(p.ppe) || 0, // PP&E promedio
  };
}

/* EBIT del sistema: ventas − costos − gastos. Coincide con Operating Profit del
   Excel (E17 = E12 − E16). */
function pliEbit(p) {
  const s = num(p.s), c = num(p.c), op = num(p.op);
  if (s === null || c === null || op === null) return null;
  return s - c - op;
}

/**
 * Los intermedios del ajuste de capital de trabajo, que son el rastro de auditoría que
 * publica el libro de soporte en sus columnas J–R.
 *
 * Se extrajo de `indicadorAjustado`, que ahora lo consume: calcularlos aparte habría
 * creado una segunda implementación de la misma aritmética, que es exactamente lo que
 * el diseño de 2026-08-11 retira del sistema. Por eso lo que devuelve no es «parecido»
 * al indicador: lo RECONSTRUYE, y la prueba que lo afirma es lo que impide que el libro
 * publique un desglose que no explique el número del informe.
 *
 * `tasa` es la tasa del estudio en tanto por uno, igual que en `indicadorAjustado`.
 *
 * Todo lo que devuelve es público: no hay campos internos filtrados en el contrato para
 * que `indicadorAjustado` no recalcule. `usaDepurado` está aquí porque el llamador
 * necesita saber si `denomAjustado` es el denominador depurado del método —y entonces
 * rige para los siete sabores— o la venta ajustada, que solo rige para los tres que
 * restan el ajuste de cuentas por cobrar del numerador.
 *
 * @returns {null|{ebit:number, utilBruta:number, desc:number, base:number,
 *   ajusteAR:number, ajusteAP:number, ajusteINV:number, ajustePPE:number,
 *   denomAjustado:number, usaDepurado:boolean}}
 */
export function desgloseAjuste(comp, contribuyente, metodo, tasa) {
  const c = cifras(comp);
  const s = cifras(contribuyente);
  if (c.s === null || c.ebit === null || !s.s) return null;

  /* Métodos que este módulo no sabe construir (MCG, ROA y cualquier otro que se
     agregue al sistema sin darle una base aquí). Antes caían al `|| 'ventas'` y
     devolvían un margen operacional disfrazado del método pedido; devolver null
     deja que el llamador use su propia ruta en vez de publicar un número ajeno. */
  if (!BASES[metodo]) return null;

  const base = BASES[metodo];
  const t = num(tasa) || 0;
  const desc = t / (1 + t); // factor de valor presente para CxC y CxP

  /* Denominador de referencia para escalar cada partida. El Excel usa la misma
     base del indicador: ventas para MO/MB, opex para Berry, COGS+opex para NCP,
     COGS para Cost Plus. */
  const baseC = base === 'ventas' ? c.s
    : base === 'opex' ? c.op
    : base === 'cogs' ? c.c
    : c.c + c.op; // costos (NCP)
  const baseS = base === 'ventas' ? s.s
    : base === 'opex' ? s.op
    : base === 'cogs' ? s.c
    : s.c + s.op;
  if (!baseC || !baseS) return null;

  /* NCP tiene un denominador propio para el indicador: costo de ventas depurado
     de las cuentas por pagar promedio más los gastos operativos —E110 del Excel:
     (COGS − CxP) + opex—. Ese mismo E110 aparece SOLO en el ratio de inventario
     de NCP (fila 108); las demás partidas de NCP escalan con (COGS + opex).

     Cost Plus es análogo pero sin los gastos operativos: su denominador ajustado
     es COGS depurado de CxP —E133 del Excel: (COGS − CxP)—, y ese mismo E133
     aparece en el ratio de inventario de Cost Plus (fila 132). Las demás partidas
     de Cost Plus escalan con COGS puro (E11 = baseC). */
  const denomDep = metodo === 'NCP' ? (c.c - c.ap) + c.op
    : metodo === 'CostPlus' ? c.c - c.ap
    : null;

  /* Cada ajuste es (ratio_comparable − ratio_contribuyente) × factor. El signo con
     que entra al indicador lo pone la fórmula final: CxC e inventario restan,
     CxP suma, tal como en las filas 86–140 del Excel.

     El ratio del comparable para inventario en NCP y Cost Plus usa el denominador
     depurado (E110 / E133) en lugar de baseC: es la única excepción por partida y
     viene tal cual de las filas 108 y 132. */
  const usaDepurado = metodo === 'NCP' || metodo === 'CostPlus';
  const baseInvC = usaDepurado ? denomDep : baseC;
  const ajusteAR = ((c.ar / baseC) - (s.ar / baseS)) * (baseC * desc);
  const ajusteAP = ((c.ap / baseC) - (s.ap / baseS)) * (baseC * desc);
  const ajusteINV = ((c.inv / baseInvC) - (s.inv / baseS)) * (baseC * t);
  /* PP&E escala por la base igual que las otras tres partidas. La plantilla de
     Capital IQ multiplicaba solo por la tasa: sin la base, el ajuste quedaba
     dividido por el monto de las ventas (o del costo, según el método) y salía
     prácticamente cero, por lo que los escenarios «+PP&E» y «PP&E» reproducían
     casi exactamente a «CxC+CxP+Inv» y al margen sin ajustar. */
  const ajustePPE = ((c.ppe / baseInvC) - (s.ppe / baseS)) * (baseC * t);

  /* Ventas ajustadas: el Excel descuenta el ajuste de CxC de las ventas y divide
     el margen sobre esa venta corregida (fila 83). Para bases distintas de ventas
     el denominador es la base sin corregir, como en Berry. */
  const baseAjustada = base === 'ventas' ? c.s - ajusteAR : baseC;

  return {
    ebit: c.ebit, utilBruta: c.gp, desc, base: baseC,
    ajusteAR, ajusteAP, ajusteINV, ajustePPE, usaDepurado,
    /* El denominador de la columna R del libro: para NCP y Cost Plus el depurado,
       para las bases de ventas la venta ajustada, y la base a secas en Berry. Los tres
       casos caben en un solo campo porque en Berry la venta ajustada COLAPSA a la base
       (`baseAjustada` solo descuenta el ajuste con base de ventas), así que no hace falta
       publicar los tres denominadores por separado para que el llamador reconstruya. */
    denomAjustado: usaDepurado ? denomDep : baseAjustada,
  };
}

/* Núcleo del ajuste: dado un comparable y el contribuyente, devuelve el indicador
   ajustado para el método y el sabor de ajuste pedidos. Devuelve null si faltan
   cifras, igual que hace pliOf con las comparables sin datos.

   La aritmética del ajuste no vive aquí: la calcula `desgloseAjuste`, y esta función
   solo elige numerador y denominador según el sabor pedido. Tener las dos cosas juntas
   dejaba al libro de soporte sin poder publicar los intermedios sin recalcularlos por
   su cuenta, que es la clase de segunda implementación que el sistema viene retirando.

   `tasa` es la tasa efectiva del comparable (la E6 del Excel: la tasa del período
   ya escalada por el número de años promediados), en tanto por uno. */
export function indicadorAjustado(comp, contribuyente, metodo, ajuste, tasa) {
  const d = desgloseAjuste(comp, contribuyente, metodo, tasa);
  if (!d) return null;
  const { ajusteAR, ajusteAP, ajusteINV, ajustePPE } = d;
  const baseC = d.base;

  /* Numerador según el método:
       MB / Berry / Cost Plus → utilidad bruta (ventas − costos),
       MO / NCP               → utilidad operacional (EBIT).
     El desglose publica las dos y aquí se elige; el criterio vive en un solo sitio
     (NUMERADOR_UTIL_BRUTA), así que las dos funciones no pueden responderlo distinto. */
  const numBase = NUMERADOR_UTIL_BRUTA.has(metodo) ? d.utilBruta : d.ebit;
  if (numBase === null) return null;

  let numerador;
  switch (ajuste) {
    case 'aar':
      numerador = numBase - ajusteAR;
      break;
    case 'aap':
      numerador = numBase + ajusteAP;
      break;
    case 'inv':
      numerador = numBase - ajusteINV;
      break;
    case 'aar_aap_inv':
      numerador = numBase - ajusteAR + ajusteAP - ajusteINV;
      break;
    case 'aar_aap_inv_ppe':
      numerador = numBase - ajusteAR + ajusteAP - ajusteINV - ajustePPE;
      break;
    case 'ppe':
      numerador = numBase - ajustePPE;
      break;
    case 'ninguno':
    default: {
      /* Sin ajuste el indicador es el de siempre: numerador sobre la base original.
         MO/MB → ventas, Berry → opex, NCP → (COGS+opex), Cost Plus → COGS. */
      return baseC ? numBase / baseC : null;
    }
  }

  /* Denominador del indicador ajustado:
       MO/MB     → venta ajustada (descuenta el ajuste de CxC),
       Berry     → opex,
       NCP       → (COGS − CxP) + opex, el denominador depurado del Excel,
       Cost Plus → (COGS − CxP), el COGS depurado del Excel (E133).

     La venta ajustada solo se usa en los sabores que sí restan el ajuste de CxC
     del numerador. La plantilla la aplicaba a los siete por igual, de modo que
     «solo CxP» y «solo inventario» descontaban del denominador un ajuste que
     nunca habían aplicado arriba. No afectaba al escenario que se reporta
     —CxC+CxP+Inv—, pero dejaba dos columnas incoherentes consigo mismas.

     Los cuatro casos entran en una sola línea leyendo `denomAjustado`, que ya es el
     depurado donde el método lo usa y la venta ajustada donde la base son las ventas:
     con denominador depurado rige para los siete sabores; con base de ventas, solo para
     los que restan CxC, y si no lo restan es la base; y en Berry `denomAjustado` colapsa
     a la base, así que las dos ramas coinciden. */
  const denom = (d.usaDepurado || AJUSTAN_AR.has(ajuste)) ? d.denomAjustado : baseC;
  return denom ? numerador / denom : null;
}

/* Cuartil por interpolación lineal, equivalente a QUARTILE.INC de Excel, y desde
   agosto de 2026 el único del sistema: `quart` (posición truncada, sin interpolar)
   convivía en calculations.js y sobre la misma serie daba otro rango. El modelo Excel
   de rangos usa QUARTILE.INC, así que se conservó esta y se retiró aquella. */
export function cuartilInterpolado(serieOrdenada, p) {
  const n = serieOrdenada.length;
  if (n === 0) return null;
  if (n === 1) return serieOrdenada[0];
  const pos = p * (n - 1);
  const lo = Math.floor(pos);
  const frac = pos - lo;
  if (lo + 1 < n) return serieOrdenada[lo] + frac * (serieOrdenada[lo + 1] - serieOrdenada[lo]);
  return serieOrdenada[lo];
}

/* Un comparable entra en la serie según el filtro de ámbito del estudio, el mismo
   `cmode` que aplica el panel: 'intl' solo internacionales, 'nac' solo nacionales,
   cualquier otro valor las toma todas.

   Se exporta porque el emisor del libro (memoriaCalculoRangoOptimo.js) necesita el
   mismo criterio para poner el valor en caché de su columna de ámbito. Replicarlo allá
   habría dejado tres copias del criterio —esta, la del libro y la fórmula de Excel— y
   la fórmula ya es una copia irreducible: está en otro lenguaje. Dos son el mínimo;
   tres eran una de más. */
export const entraPorAmbito = (amb, modo) => (
  modo === 'intl' ? amb === 'Int' : modo === 'nac' ? amb === 'Nac' : true
);

/* Rango ajustado completo para un método y un sabor de ajuste.

   Recibe el estudio tal como lo maneja el sistema (t_s, t_c, t_op, t_ar, t_inv,
   t_ap, t_ppe para el contribuyente y `comparables` con s/c/op/ar/inv/ap/ppe).

   IMPORTANTE: `op` y `t_op` son GASTOS operativos, no utilidad operacional. El
   resto del sistema usa el convenio contrario (ver `pliOf` en utils/calculations.js),
   así que hay que pasar las cifras por `normalizarEeff` antes de llamar aquí.

   La tasa es una sola para todo el estudio —`prime`, en porcentaje—. Hasta agosto
   de 2026 cada comparable podía traer la suya (`tasaEfectiva`), que era la tasa de
   su país heredada de la plantilla de Capital IQ; se retiró porque la metodología
   del informe usa una única tasa de referencia para toda la muestra.

   Devuelve { stats, filas, cumple, sujeto } con la misma forma que analizarRango
   para que las tablas del informe puedan consumir uno u otro sin ramificar. */
export function analizarRangoAjustado(estudio, metodo, ajuste) {
  const study = estudio || {};
  const kind = metodo || study.pli || 'MO';
  const tipo = ajuste || 'ninguno';
  const modo = study.cmode || 'all';

  /* Ingreso de una operación no controlada (p. ej. un proyecto CoCrea) ajeno a la
     vinculada: se descuenta de las ventas para que el margen no se calcule sobre
     cifras mezcladas. Solo de las ventas: como aquí `t_op` son gastos y no utilidad,
     restarlo también de `t_op` —como hace el panel, donde `op` sí es utilidad—
     cambiaría la utilidad operacional dos veces. */
  const segExcluido = num(study.seg_excluido) || 0;
  const tS = num(study.t_s);

  const contribuyente = {
    s: tS !== null ? tS - segExcluido : null,
    c: study.t_c, op: study.t_op,
    ar: study.t_ar, inv: study.t_inv, ap: study.t_ap, ppe: study.t_ppe,
  };

  const tasaEstudio = (num(study.prime) || 0) / 100;

  const filas = (study.comparables || []).map((comp) => {
    const valor = indicadorAjustado(comp, contribuyente, kind, tipo, tasaEstudio);
    /* El mismo indicador sin ninguna partida de capital de trabajo. Va en la fila
       porque las tablas del informe publican las dos columnas —margen y margen
       ajustado— y la diferencia entre ambas tiene que ser el ajuste que de verdad
       se aplicó, no un tercer cálculo hecho aparte. */
    const noAjustado = tipo === 'ninguno'
      ? valor
      : indicadorAjustado(comp, contribuyente, kind, 'ninguno', tasaEstudio);
    const amb = comp && comp.amb === 'Nac' ? 'Nac' : 'Int';
    return {
      nombre: String((comp && comp.name) || '').trim(),
      amb,
      valor,
      noAjustado,
      incluida: entraPorAmbito(amb, modo) && valor !== null && Number.isFinite(valor),
    };
  });

  const serie = filas
    .filter((f) => f.incluida)
    .map((f) => f.valor)
    .sort((a, b) => a - b);

  let stats = null;
  if (serie.length >= 3) {
    stats = {
      p25: cuartilInterpolado(serie, 0.25),
      med: cuartilInterpolado(serie, 0.5),
      p75: cuartilInterpolado(serie, 0.75),
      min: serie[0],
      max: serie[serie.length - 1],
      n: serie.length,
    };
  }

  /* Indicador del contribuyente con el mismo método y ajuste, para la conclusión.
     El contribuyente se ajusta contra sí mismo: los ratios se cancelan y el
     ajuste es cero, así que su indicador ajustado es el de siempre. Se calcula
     igual por la vía general para no duplicar fórmulas. */
  const sujeto = indicadorAjustado(contribuyente, contribuyente, kind, tipo, tasaEstudio);

  let cumple = 'CUMPLE'; // comportamiento heredado: sin rango, CUMPLE
  if (stats && sujeto !== null) {
    cumple = sujeto >= stats.p25 && sujeto <= stats.p75 ? 'CUMPLE' : 'NO CUMPLE';
  }

  return { stats, filas, cumple, sujeto, metodo: kind, ajuste: tipo };
}
