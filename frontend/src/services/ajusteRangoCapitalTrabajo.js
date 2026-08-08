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

   Validado contra los 16 comparables de END GAME 2025: los 7 sabores de OM,
   los 7 de Berry y los de NCP coinciden con el Excel al quinto decimal.
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

/* Núcleo del ajuste: dado un comparable y el contribuyente, devuelve el indicador
   ajustado para el método y el sabor de ajuste pedidos. Devuelve null si faltan
   cifras, igual que hace pliOf con las comparables sin datos.

   `tasa` es la tasa efectiva del comparable (la E6 del Excel: la tasa del período
   ya escalada por el número de años promediados), en tanto por uno. */
export function indicadorAjustado(comp, contribuyente, metodo, ajuste, tasa) {
  const c = cifras(comp);
  const s = cifras(contribuyente);
  if (c.s === null || c.ebit === null || !s.s) return null;

  const base = BASES[metodo] || 'ventas';
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
  const denomNCP = metodo === 'NCP' ? (c.c - c.ap) + c.op
    : metodo === 'CostPlus' ? c.c - c.ap
    : null;

  /* Cada ajuste es (ratio_comparable − ratio_contribuyente) × factor. El signo con
     que entra al indicador lo pone la fórmula final: CxC e inventario restan,
     CxP suma, tal como en las filas 86–140 del Excel.

     El ratio del comparable para inventario en NCP y Cost Plus usa el denominador
     depurado (E110 / E133) en lugar de baseC: es la única excepción por partida y
     viene tal cual de las filas 108 y 132. */
  const usaDepurado = metodo === 'NCP' || metodo === 'CostPlus';
  const baseInvC = usaDepurado ? denomNCP : baseC;
  const ajusteAR = ((c.ar / baseC) - (s.ar / baseS)) * (baseC * desc);
  const ajusteAP = ((c.ap / baseC) - (s.ap / baseS)) * (baseC * desc);
  const ajusteINV = ((c.inv / baseInvC) - (s.inv / baseS)) * (baseC * t);
  const ajustePPE = ((c.ppe / (usaDepurado ? denomNCP : baseC)) - (s.ppe / baseS)) * t;

  /* Ventas ajustadas: el Excel descuenta el ajuste de CxC de las ventas y divide
     el margen sobre esa venta corregida (fila 83). Para bases distintas de ventas
     el denominador es la base sin corregir, como en Berry. */
  const baseAjustada = base === 'ventas' ? c.s - ajusteAR : baseC;

  /* Numerador según el método:
       MB / Berry / Cost Plus → utilidad bruta (ventas − costos),
       MO / NCP               → utilidad operacional (EBIT). */
  const numBase = (metodo === 'MB' || metodo === 'Berry' || metodo === 'CostPlus')
    ? c.gp : c.ebit;
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
       Cost Plus → (COGS − CxP), el COGS depurado del Excel (E133). */
  const denom = usaDepurado ? denomNCP
    : base === 'ventas' ? baseAjustada
    : baseC;
  return denom ? numerador / denom : null;
}

/* Cuartil por interpolación lineal, equivalente a QUARTILE.INC de Excel.

   IMPORTANTE: difiere a propósito de `quart` en calculations.js, que toma el
   elemento en la posición truncada sin interpolar. El modelo Excel de rangos
   usa QUARTILE.INC, y para que el rango ajustado que publica el sistema coincida
   con el que el consultor validó en la hoja, este módulo interpola. La ruta sin
   ajuste sigue usando `quart` heredado; sólo el rango ajustado usa este. */
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

/* Rango ajustado completo para un método y un sabor de ajuste.

   Recibe el estudio tal como lo maneja el sistema (t_s, t_c, t_op, t_ar, t_inv,
   t_ap para el contribuyente y `comparables` con s/c/op/ar/inv/ap y opcionalmente
   `ppe` y `tasaEfectiva`). La tasa por comparable cae, en orden de preferencia, a
   la del propio comparable, luego a la del estudio (prime), luego a 0.

   Devuelve { stats, filas, cumple, sujeto } con la misma forma que analizarRango
   para que las tablas del informe puedan consumir uno u otro sin ramificar. */
export function analizarRangoAjustado(estudio, metodo, ajuste) {
  const study = estudio || {};
  const kind = metodo || study.pli || 'MO';
  const tipo = ajuste || 'ninguno';

  const contribuyente = {
    s: study.t_s, c: study.t_c, op: study.t_op,
    ar: study.t_ar, inv: study.t_inv, ap: study.t_ap, ppe: study.t_ppe,
  };

  const tasaEstudio = (num(study.prime) || 0) / 100;

  const filas = (study.comparables || []).map((comp) => {
    // Al uniformar la tasa (atendiendo auditoría de fuga de Capital IQ), se ignora la tasa por país
    // de la comparable y se asigne siempre la tasa de interés de referencia del estudio (Prime Rate)
    const tasa = tasaEstudio;
    const valor = indicadorAjustado(comp, contribuyente, kind, tipo, tasa);
    return {
      nombre: String((comp && comp.name) || '').trim(),
      amb: comp && comp.amb === 'Nac' ? 'Nac' : 'Int',
      valor,
    };
  });

  const serie = filas
    .map((f) => f.valor)
    .filter((v) => v !== null && Number.isFinite(v))
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
