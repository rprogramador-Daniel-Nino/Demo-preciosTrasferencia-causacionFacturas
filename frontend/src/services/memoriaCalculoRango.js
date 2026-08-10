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
    formula: '(Ingresos operacionales − Costo de ventas) ÷ Gastos operativos',
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
      /* Berry dejó de estar exceptuado: con la definición del motor —utilidad bruta
         sobre gastos operativos— sí admite el ajuste, y la hoja Berry del Excel ya
         lo venía calculando con sus siete escenarios. */
      aplicado: !!useAdj,
      tasa,
      /* El texto que se publica tiene que ser el que ejecuta `indicadorAjustado`. La
         versión anterior describía un ajuste neto único multiplicado por la tasa, que
         no es lo que calcula el motor: cada partida escala por la base del método, y
         CxC y CxP llevan el factor de valor presente r/(1+r) mientras inventario y
         PP&E llevan la tasa directa. */
      formula:
        'Por comparable, con r = tasa y d = r/(1+r), y Base = la base del método ' +
        '(ventas en MO y MB, gastos operativos en Berry, costo en Cost Plus, ' +
        'costo + gastos en NCP):\n' +
        '  AjCxC = (CxC c/Base c − CxC e/Base e) × Base c × d\n' +
        '  AjCxP = (CxP c/Base c − CxP e/Base e) × Base c × d\n' +
        '  AjInv = (Inv c/Base c − Inv e/Base e) × Base c × r\n' +
        'Indicador ajustado = (Utilidad − AjCxC + AjCxP − AjInv) / Denominador, donde el ' +
        'denominador es la base descontando AjCxC cuando la base es ventas',
      nota:
        'Compara los ratios de capital de trabajo de la parte examinada (e) con los de cada ' +
        'comparable (c). Se reporta el escenario CxC + CxP + Inventario. Las dos convenciones ' +
        'de factor —r/(1+r) para las partidas monetarias y r directa para las de existencias— ' +
        'vienen del modelo Excel validado y son deliberadas.',
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
    cuartilFormula:
      'Interpolación lineal en la posición p × (n − 1) de la serie ordenada de menor a mayor, ' +
      'equivalente a QUARTILE.INC de Excel: cuando la posición no cae sobre un dato, el valor ' +
      'se interpola entre ese dato y el siguiente',
    advertencias,
  };
}

/* Aquí vivía hojasMemoriaRango, que armaba cuatro hojas de Excel con valores
   estáticos y estilos propios (ESTILOS, cPct, cNum, cEnt y el constructor
   de bloques). La reemplazó hojasMemoriaRangoOptimo de memoriaCalculoRangoOptimo.js,
   que emite el mismo contenido con fórmulas vivas y los cinco métodos, y es la que
   descarga MemoriaRangoModal. Convivieron un tiempo y la vieja se quedó sin ningún
   llamador en producción, con la mayoría de los tests de este archivo apuntándole. */

/** Nombre del archivo, con el contribuyente y el año para no acabar con diez «rango.xlsx». */
export function nombreArchivoMemoria(estudio) {
  const study = estudio || {};
  const base = String(study.ent || 'estudio')
    .replace(/[\\/:*?"<>|]/g, '')
    .trim()
    .slice(0, 60) || 'estudio';
  return `Memoria rango intercuartil - ${base} ${study.anio || ''}`.trim() + '.xlsx';
}
