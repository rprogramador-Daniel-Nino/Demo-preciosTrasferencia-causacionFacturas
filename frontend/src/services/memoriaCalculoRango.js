/* Memoria de cálculo del rango intercuartil: de dónde sale cada número que muestra la
   tarjeta del panel, con la fórmula aplicada y los valores que entraron en ella.

   Existe porque el rango es el número que decide si el contribuyente cumple o no con el
   principio de plena competencia, y hasta ahora la pantalla mostraba «3,23 % - 10,40 %»
   sin nada detrás. Quien tiene que sostener esa cifra ante la DIAN necesita poder
   reconstruirla comparable por comparable.

   No calcula nada por su cuenta: reutiliza `analizarRango` para el margen de cada
   comparable y `cuartilInterpolado` para los cuartiles, que son las mismas funciones que
   alimentan el informe, el panel y el Excel de soporte. Duplicar aquí una fórmula
   produciría una memoria de cálculo que no explica el número que se está mostrando, que
   es peor que no tener memoria. */

import { num, pliOf, ratios } from '../utils/calculations.js';
import { analizarRango } from './rangoIntercuartil.js';
import { cuartilInterpolado } from './ajusteRangoCapitalTrabajo.js';

/** Indicadores de rentabilidad admitidos, con la fórmula tal como la aplica `pliOf`. */
export const INDICADORES = {
  MO: {
    etiqueta: 'Margen Operacional (MO)',
    formula: 'Utilidad operacional ÷ Ingresos operacionales',
  },
  MB: {
    etiqueta: 'Margen Bruto (MB)',
    formula: '(Ingresos operacionales − Costo de ventas) ÷ Ingresos operacionales',
  },
  Berry: {
    etiqueta: 'Índice de Berry',
    formula: 'Ingresos operacionales ÷ (Costo de ventas + Gastos operativos)',
  },
};

/** Cómo se traduce el filtro de ámbito del panel. */
const AMBITOS = {
  all: 'Todas las comparables',
  intl: 'Solo internacionales',
  nac: 'Solo nacionales',
};

const entra = (amb, modo) => (modo === 'intl' ? amb === 'Int' : modo === 'nac' ? amb === 'Nac' : true);

/**
 * Desglose completo del rango que está viendo el usuario.
 *
 * Recibe el estudio con su `cmode` porque el panel filtra por ámbito antes de calcular
 * los cuartiles. La memoria tiene que explicar el número de la pantalla, no otro.
 */
export function construirMemoriaRango(estudio) {
  const study = estudio || {};
  const clave = study.pli || 'MO';
  const indicador = INDICADORES[clave] || INDICADORES.MO;
  const modo = study.cmode || 'all';

  const T = {
    s: num(study.t_s), c: num(study.t_c), op: num(study.t_op),
    ar: num(study.t_ar), inv: num(study.t_inv), ap: num(study.t_ap),
  };
  const pliContribuyente = pliOf(T, clave);
  const razonesT = ratios(T);

  const useAdj = study.useadj || false;
  const tasa = (num(study.prime) || 0) / 100;

  /* Las filas salen de `analizarRango`: mismo margen y mismo ajuste que el informe. */
  const { filas } = analizarRango(study);

  const comparables = filas.map((f) => {
    const incluida = entra(f.amb, modo) && f.ajustado !== null;
    let excluida = '';
    if (f.ajustado === null) excluida = 'sin estados financieros cargados';
    else if (!entra(f.amb, modo)) excluida = 'fuera del filtro de ámbito';
    return {
      nombre: f.nombre,
      amb: f.amb,
      noAjustado: f.noAjustado,
      /* El ajuste es la diferencia, no un tercer cálculo: así la columna cuadra siempre
         con las otras dos y no puede desviarse de lo que se sumó de verdad. */
      ajuste: f.ajustado === null || f.noAjustado === null ? null : f.ajustado - f.noAjustado,
      ajustado: f.ajustado,
      incluida,
      excluida,
    };
  });

  const serie = comparables.filter((c) => c.incluida).map((c) => c.ajustado).sort((a, b) => a - b);
  const n = serie.length;

  /* Cuartiles por interpolación lineal —QUARTILE.INC—, los mismos que calculan el
     rango del informe y las hojas del Excel de soporte. La memoria existe para
     explicar ese número: si aquí se usara otra fórmula, explicaría uno distinto.

     Se publica además la posición porque es lo que permite rehacer la cuenta a mano
     sobre la tabla de al lado. Es la del elemento inferior del par: cuando el cuartil
     no cae justo sobre un dato, el valor está interpolado entre esa posición y la
     siguiente, y `interpolado` lo señala para que nadie busque la cifra en la lista. */
  const posicion = (p) => (n ? Math.floor(p * (n - 1)) : null);
  const interpola = (p) => (n ? (p * (n - 1)) % 1 !== 0 : false);
  const cuartil = (p) => ({
    valor: cuartilInterpolado(serie, p),
    posicion: posicion(p),
    interpolado: interpola(p),
  });
  const cuartiles = n
    ? { p25: cuartil(0.25), mediana: cuartil(0.5), p75: cuartil(0.75) }
    : null;

  /* El panel exige al menos una comparable con margen; el informe exige tres. Cuando el
     panel muestra un rango que el informe no va a publicar, hay que decirlo. */
  const stats = cuartiles
    ? { p25: cuartiles.p25.valor, med: cuartiles.mediana.valor, p75: cuartiles.p75.valor }
    : null;

  const dentro = stats && pliContribuyente !== null
    ? pliContribuyente >= stats.p25 && pliContribuyente <= stats.p75
    : null;

  const advertencias = [];
  const excluidasPorAmbito = comparables.filter((c) => c.excluida === 'fuera del filtro de ámbito').length;
  if (excluidasPorAmbito) {
    /* El informe ya calcula el rango con el mismo filtro —antes lo ignoraba y las dos
       cifras no coincidían—, así que el aviso pasó de anunciar una discrepancia a
       recordar que la muestra publicada es más chica que la cargada. */
    advertencias.push(
      `El filtro «${AMBITOS[modo]}» deja fuera ${excluidasPorAmbito} comparable(s) de este ` +
      'rango. El informe en Word aplica el mismo filtro, así que publicará esta cifra y ' +
      'una muestra más corta que la cargada.'
    );
  }
  const sinCifras = comparables.filter((c) => c.excluida === 'sin estados financieros cargados').length;
  if (sinCifras) {
    advertencias.push(
      `${sinCifras} comparable(s) de la muestra no tienen estados financieros cargados, así ` +
      'que no aportan margen y quedan fuera del rango.'
    );
  }
  if (n && n < 3) {
    advertencias.push(
      `El rango se calculó con ${n} comparable(s). El informe exige tres como mínimo: por ` +
      'debajo de ese número la sección del rango sale sin cifras.'
    );
  }
  if (useAdj && !tasa) {
    advertencias.push(
      'El ajuste de capital de trabajo está activado pero la tasa de interés está en cero, ' +
      'así que el ajuste de cada comparable es nulo.'
    );
  }

  return {
    indicador: { clave, ...indicador },
    ambito: { modo, etiqueta: AMBITOS[modo] || AMBITOS.all },
    parteExaminada: { cifras: T, pli: pliContribuyente, razones: razonesT },
    ajuste: {
      aplicado: !!useAdj && clave !== 'Berry',
      tasa,
      formula:
        'Tasa × [(CxC/Ventas − CxC/Ventas c) + (Inventario/Ventas − Inventario/Ventas c) ' +
        '− (CxP/Costos − CxP/Costos c)]',
      nota:
        'Compara los ratios de capital de trabajo de la parte examinada con los de cada ' +
        'comparable. El índice de Berry no admite este ajuste.',
    },
    comparables,
    serie,
    cuartiles,
    stats,
    resultado: {
      pli: pliContribuyente,
      dentro,
      dir: dentro === false && stats ? (pliContribuyente < stats.p25 ? 'por debajo' : 'por encima') : '',
      ajustePropuesto: dentro === false && stats && pliContribuyente !== null
        ? (stats.med - pliContribuyente) * (T.s || 0)
        : null,
      formulaAjuste: '(Mediana − Indicador del contribuyente) × Ingresos operacionales',
    },
    cuartilFormula: 'Valor en la posición ⌊p × (n − 1)⌋ de la serie ordenada de menor a mayor, sin interpolar',
    advertencias,
  };
}

/* ══════════════ Hojas del libro de Excel ══════════════
   Dos decisiones gobiernan estas hojas.

   Los porcentajes y los importes van como NÚMERO con formato, no como el texto
   «10,00 %». Es la diferencia entre una hoja que se puede ordenar, filtrar y sumar y una
   lista de etiquetas: quien recibe esta memoria la va a querer cruzar con sus propias
   cifras, y sobre texto no se puede.

   Y cada bloque se emite como una tabla con su rol por fila —título del documento,
   título de bloque, encabezado de columnas, fila de dato, advertencia—, del que sale el
   formato. Marcar el rol en vez de escribir el estilo en cada celda es lo que mantiene
   las cuatro hojas con el mismo aspecto: el estilo se define una vez en `ESTILOS` y una
   hoja nueva no puede desviarse sin querer.

   Los estilos los escribe `xlsx-js-style`, que es SheetJS 0.18.5 con el escritor de
   formato de celda que la versión abierta de `xlsx` no trae. */

/** Celda de porcentaje: el valor decimal con formato, para que Excel lo trate como tal. */
const cPct = (v) => (v === null || v === undefined ? '' : { v, t: 'n', z: '0.00%' });
/** Celda de importe en pesos, con separador de miles y sin decimales. */
const cNum = (v) => (v === null || v === undefined ? '' : { v, t: 'n', z: '#,##0' });
/** Celda de conteo. */
const cEnt = (v) => (v === null || v === undefined ? '' : { v, t: 'n', z: '0' });

/** Combina las celdas de una fila de título, para que ocupe el ancho de la tabla. */
const combinar = (fila, columnas) => ({ s: { r: fila, c: 0 }, e: { r: fila, c: columnas - 1 } });

/* Los mismos colores de la aplicación: el teal del producto para lo que encabeza y grises
   fríos para el resto. Un Excel que se adjunta al expediente junto a la pantalla de la que
   salió no debería parecer de otro programa. */
const TEAL = '0FA3A1';
const TEAL_OSCURO = '0B7C7A';
const GRIS_TITULO = 'F1F5F9';
const GRIS_ZEBRA = 'F8FAFC';
const GRIS_BORDE = 'D8DEE7';
const AMBAR = 'FEF3C7';
const AMBAR_BORDE = 'FCD34D';
const TINTA = '18181B';
const TINTA_SUAVE = '52525B';

const marco = (rgb = GRIS_BORDE) => {
  const linea = { style: 'thin', color: { rgb } };
  return { top: linea, bottom: linea, left: linea, right: linea };
};

export const ESTILOS = {
  tituloDocumento: {
    font: { bold: true, sz: 13, color: { rgb: 'FFFFFF' } },
    fill: { fgColor: { rgb: TEAL_OSCURO } },
    alignment: { vertical: 'center', horizontal: 'left' },
  },
  tituloBloque: {
    font: { bold: true, sz: 11, color: { rgb: TEAL_OSCURO } },
    fill: { fgColor: { rgb: GRIS_TITULO } },
    border: marco(),
    alignment: { vertical: 'center' },
  },
  encabezado: {
    font: { bold: true, sz: 10, color: { rgb: 'FFFFFF' } },
    fill: { fgColor: { rgb: TEAL } },
    border: marco(TEAL),
    alignment: { vertical: 'center', wrapText: true },
  },
  /* Primera columna de una fila de dato: es la etiqueta de la fila, así que va en
     seminegrita y en tinta suave para que la vista salte al valor. */
  concepto: {
    font: { bold: true, sz: 10, color: { rgb: TINTA_SUAVE } },
    border: marco(),
    alignment: { vertical: 'top', wrapText: true },
  },
  valor: {
    font: { sz: 10, color: { rgb: TINTA } },
    border: marco(),
    alignment: { vertical: 'top', wrapText: true },
  },
  advertencia: {
    font: { sz: 10, color: { rgb: TINTA } },
    fill: { fgColor: { rgb: AMBAR } },
    border: marco(AMBAR_BORDE),
    alignment: { vertical: 'top', wrapText: true },
  },
};

/* Filas de dato alternas con fondo, que es lo que permite seguir una fila de ocho
   columnas sin perder el renglón. */
const conZebra = (estilo) => ({ ...estilo, fill: { fgColor: { rgb: GRIS_ZEBRA } } });
/* Las cifras se alinean a la derecha: es lo que deja comparar dos porcentajes de un
   vistazo, con los decimales en la misma vertical. */
const aLaDerecha = (estilo) => ({ ...estilo, alignment: { ...estilo.alignment, horizontal: 'right' } });

const esNumerica = (celda) => !!celda && typeof celda === 'object' && celda.t === 'n';

/** Celda con su estilo, sea texto plano, número suelto o celda ya tipada. */
function conEstilo(celda, estilo) {
  if (celda && typeof celda === 'object') return { ...celda, s: estilo };
  if (typeof celda === 'number') return { v: celda, t: 'n', s: estilo };
  /* También las vacías: sin ellas la fila queda con el borde cortado a media tabla. */
  return { v: celda === null || celda === undefined ? '' : celda, t: 's', s: estilo };
}

/**
 * Constructor de hoja: acumula filas junto con su rol, para que el estilo se derive del
 * rol y no se escriba a mano en cada celda.
 */
function nuevaHoja(columnas) {
  const filas = [];
  const roles = [];
  const merges = [];
  const agregar = (rol, celdas) => { roles.push(rol); filas.push(celdas); };

  return {
    filas,
    roles,
    merges,
    columnas,
    tituloDocumento(texto) {
      merges.push(combinar(filas.length, columnas));
      agregar('tituloDocumento', [texto]);
    },
    tituloBloque(texto) {
      merges.push(combinar(filas.length, columnas));
      agregar('tituloBloque', [texto]);
    },
    encabezado(celdas) { agregar('encabezado', celdas); },
    dato(celdas) { agregar('dato', celdas); },
    advertencia(celdas) { agregar('advertencia', celdas); },
    blanco() { agregar(null, []); },
  };
}

/** Aplica a cada celda el estilo que le corresponde por su rol y su posición. */
function estilizar(hoja) {
  const { filas, roles, columnas } = hoja;
  let enBloque = 0;

  return filas.map((fila, i) => {
    const rol = roles[i];
    /* La fila en blanco separa bloques y reinicia la alternancia, para que la primera
       fila de cada tabla salga siempre sin fondo. */
    if (!rol) { enBloque = 0; return []; }
    if (rol === 'tituloDocumento' || rol === 'tituloBloque') {
      enBloque = 0;
      return [conEstilo(fila[0], ESTILOS[rol])];
    }
    if (rol === 'encabezado') {
      enBloque = 0;
      return Array.from({ length: columnas }, (_, j) => conEstilo(fila[j], ESTILOS.encabezado));
    }

    const alterna = enBloque++ % 2 === 1;
    return Array.from({ length: columnas }, (_, j) => {
      const celda = fila[j];
      let estilo = rol === 'advertencia' ? ESTILOS.advertencia : j === 0 ? ESTILOS.concepto : ESTILOS.valor;
      if (esNumerica(celda)) estilo = aLaDerecha(estilo);
      if (alterna && rol !== 'advertencia') estilo = conZebra(estilo);
      return conEstilo(celda, estilo);
    });
  });
}

/**
 * Las hojas del libro, cada una con sus filas ya estilizadas, sus anchos de columna, sus
 * combinaciones, su alto de fila y su autofiltro.
 *
 * Se devuelven en crudo y no como archivo para que esto se pueda probar con `npm test`:
 * la escritura del `.xlsx` y la descarga viven en el componente, que es lo único que
 * necesita el navegador.
 */
export function hojasMemoriaRango(memoria, estudio) {
  const m = memoria;
  const study = estudio || {};

  /* ─── Hoja 1: Resumen ───
     Tres bloques —identificación, cuartiles y resultado—, cada uno con su título y su
     encabezado de columnas. */
  const resumen = nuevaHoja(3);
  resumen.tituloDocumento('MEMORIA DE CÁLCULO DEL RANGO INTERCUARTIL');
  resumen.blanco();

  resumen.tituloBloque('IDENTIFICACIÓN');
  resumen.encabezado(['Concepto', 'Valor', '']);
  resumen.dato(['Contribuyente', study.ent || '']);
  resumen.dato(['NIT', study.nit || '']);
  resumen.dato(['Año gravable', cEnt(Number(study.anio) || null)]);
  resumen.dato(['Indicador de rentabilidad', m.indicador.etiqueta]);
  resumen.dato(['Fórmula del indicador', m.indicador.formula]);
  resumen.dato(['Comparables consideradas', m.ambito.etiqueta]);
  resumen.dato(['Comparables en el rango', cEnt(m.serie.length)]);
  resumen.blanco();

  resumen.tituloBloque('CUARTILES');
  resumen.encabezado(['Concepto', 'Posición en la serie', 'Valor']);
  resumen.dato(['Fórmula', m.cuartilFormula]);
  if (m.cuartiles) {
    resumen.dato(['Cuartil inferior (P25)', cEnt(m.cuartiles.p25.posicion), cPct(m.cuartiles.p25.valor)]);
    resumen.dato(['Mediana (P50)', cEnt(m.cuartiles.mediana.posicion), cPct(m.cuartiles.mediana.valor)]);
    resumen.dato(['Cuartil superior (P75)', cEnt(m.cuartiles.p75.posicion), cPct(m.cuartiles.p75.valor)]);
  } else {
    resumen.dato(['Sin comparables con margen calculable', '']);
  }
  resumen.blanco();

  resumen.tituloBloque('RESULTADO');
  resumen.encabezado(['Concepto', 'Valor', '']);
  resumen.dato(['Indicador del contribuyente', cPct(m.resultado.pli)]);
  resumen.dato([
    'Dentro del rango',
    m.resultado.dentro === null ? 'No determinado' : m.resultado.dentro ? 'SÍ — CUMPLE' : 'NO — ' + m.resultado.dir,
  ]);
  resumen.dato(['Fórmula del ajuste', m.resultado.formulaAjuste]);
  resumen.dato(['Ajuste propuesto', cNum(m.resultado.ajustePropuesto)]);

  if (m.advertencias.length) {
    resumen.blanco();
    resumen.tituloBloque('ADVERTENCIAS');
    resumen.encabezado(['#', 'Salvedad', '']);
    m.advertencias.forEach((a, i) => resumen.advertencia([cEnt(i + 1), a]));
  }

  /* ─── Hoja 2: Comparables ───
     El encabezado va en la primera fila, sin título encima, para que el autofiltro
     abarque la tabla entera y se pueda ordenar por margen de un clic. */
  const comparables = nuevaHoja(8);
  const columnasComparables = [
    '#', 'Compañía', 'Ámbito', 'Margen sin ajustar', 'Ajuste de capital de trabajo',
    'Margen ajustado', '¿Entra al rango?', 'Motivo de exclusión',
  ];
  comparables.encabezado(columnasComparables);
  m.comparables.forEach((c, i) => comparables.dato([
    cEnt(i + 1),
    c.nombre,
    c.amb === 'Nac' ? 'NACIONAL' : 'INTERNACIONAL',
    cPct(c.noAjustado),
    cPct(c.ajuste),
    cPct(c.ajustado),
    c.incluida ? 'Sí' : 'No',
    c.excluida,
  ]));

  /* ─── Hoja 3: Serie y cuartiles ───
     Va aparte de la tabla de comparables para no romperle el autofiltro. La columna
     «Cuartil» es la que permite ver de un vistazo de qué posición salió cada cifra. */
  const etiquetaCuartil = (i) => {
    if (!m.cuartiles) return '';
    return [
      i === m.cuartiles.p25.posicion && 'P25',
      i === m.cuartiles.mediana.posicion && 'Mediana',
      i === m.cuartiles.p75.posicion && 'P75',
    ].filter(Boolean).join(' / ');
  };
  const serie = nuevaHoja(4);
  serie.encabezado(['Posición', 'Compañía', 'Margen ajustado', 'Cuartil']);
  m.serie.forEach((v, i) => {
    const duena = m.comparables.find((c) => c.incluida && c.ajustado === v);
    serie.dato([cEnt(i), duena ? duena.nombre : '', cPct(v), etiquetaCuartil(i)]);
  });

  /* ─── Hoja 4: Parte examinada ───
     Las cifras del contribuyente y los ratios con los que se ajusta cada comparable. */
  const T = m.parteExaminada.cifras;
  const razones = m.parteExaminada.razones;
  const parte = nuevaHoja(2);

  parte.tituloBloque('CIFRAS DE LA PARTE EXAMINADA');
  parte.encabezado(['Concepto', 'Valor']);
  parte.dato(['Ingresos operacionales', cNum(T.s)]);
  parte.dato(['Costo de ventas', cNum(T.c)]);
  parte.dato(['Utilidad operacional', cNum(T.op)]);
  parte.dato(['Cuentas por cobrar', cNum(T.ar)]);
  parte.dato(['Inventarios', cNum(T.inv)]);
  parte.dato(['Cuentas por pagar', cNum(T.ap)]);
  parte.dato(['Indicador (' + m.indicador.clave + ')', cPct(m.resultado.pli)]);
  parte.blanco();

  parte.tituloBloque('RATIOS DE CAPITAL DE TRABAJO');
  parte.encabezado(['Ratio', 'Valor']);
  parte.dato(['CxC / Ventas', razones ? cPct(razones.arS) : 'no calculable']);
  parte.dato(['Inventario / Ventas', razones ? cPct(razones.invS) : 'no calculable']);
  parte.dato(['CxP / Costos', razones && razones.apC !== null ? cPct(razones.apC) : 'no calculable']);
  parte.blanco();

  parte.tituloBloque('AJUSTE DE CAPITAL DE TRABAJO');
  parte.encabezado(['Concepto', 'Valor']);
  parte.dato(['Aplicado', m.ajuste.aplicado ? 'Sí' : 'No']);
  parte.dato(['Tasa de interés', m.ajuste.tasa ? cPct(m.ajuste.tasa) : '—']);
  parte.dato(['Fórmula', m.ajuste.formula]);
  parte.dato(['Nota', m.ajuste.nota]);

  /* El alto de la primera fila acompaña al tamaño de letra del título; el resto lo
     calcula Excel con el ajuste de texto. */
  const altoTitulo = [{ hpt: 24 }];

  return [
    {
      nombre: 'Resumen',
      filas: estilizar(resumen),
      cols: [{ wch: 32 }, { wch: 58 }, { wch: 18 }],
      merges: resumen.merges,
      rows: altoTitulo,
    },
    {
      nombre: 'Comparables',
      filas: estilizar(comparables),
      cols: [{ wch: 5 }, { wch: 38 }, { wch: 16 }, { wch: 18 }, { wch: 26 }, { wch: 16 }, { wch: 16 }, { wch: 34 }],
      /* Sobre la tabla entera, encabezado incluido: es lo que deja ordenar por margen o
         quedarse solo con las que entraron al rango sin tocar nada más. */
      autofiltro: `A1:${String.fromCharCode(64 + columnasComparables.length)}${comparables.filas.length}`,
    },
    {
      nombre: 'Serie y cuartiles',
      filas: estilizar(serie),
      cols: [{ wch: 10 }, { wch: 38 }, { wch: 18 }, { wch: 18 }],
    },
    {
      nombre: 'Parte examinada',
      filas: estilizar(parte),
      cols: [{ wch: 34 }, { wch: 76 }],
      merges: parte.merges,
    },
  ];
}

/** Nombre del archivo, con el contribuyente y el año para no acabar con diez «rango.xlsx». */
export function nombreArchivoMemoria(estudio) {
  const study = estudio || {};
  const base = String(study.ent || 'estudio')
    .replace(/[\\/:*?"<>|]/g, '')
    .trim()
    .slice(0, 60) || 'estudio';
  return `Memoria rango intercuartil - ${base} ${study.anio || ''}`.trim() + '.xlsx';
}
