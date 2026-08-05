import * as XLSX from 'xlsx';
import { pctf, fmt } from '../utils/calculations.js';

const PLI_LABEL = { MO: 'Margen Operacional (MO)', MB: 'Margen Bruto (MB)', Berry: 'Razón Berry' };
const CATEGORIA_RECHAZO = { filtro: 'Filtro (holding/saldo negativo/pérdida)', ia: 'Curación IA', rigor: 'Rigor funcional' };

const conFormato = (v, formatter) => (v === null || v === undefined ? '—' : formatter(v));
const puntaje = (v) => (typeof v === 'number' ? (v * 100).toFixed(1) + '%' : '—');

function hojaResumen(datos) {
  const { estudio, examinada, rango } = datos;
  const { T, tPLI } = examinada;
  const { stats, activeCount, adjustment } = rango;

  const filas = [
    ['Resumen del cálculo — Motor de Comparables'],
    [],
    ['Entidad', estudio.entidad || '—'],
    ['Año gravable', estudio.anio || '—'],
    ['Indicador de rentabilidad (PLI)', PLI_LABEL[estudio.pli] || estudio.pli || '—'],
    ['Ajuste de capital de trabajo', estudio.useAdj ? 'Sí' : 'No'],
    ['Tasa de interés usada', estudio.useAdj ? pctf(estudio.interestRate) : '—'],
    [],
    ['Cifras de la parte examinada'],
    ['Ventas', fmt(T.s)],
    ['Costo de ventas', fmt(T.c)],
    ['Utilidad operacional', fmt(T.op)],
    ['Cuentas por cobrar', fmt(T.ar)],
    ['Inventarios', fmt(T.inv)],
    ['Cuentas por pagar', fmt(T.ap)],
    ['PLI de la parte examinada', conFormato(tPLI, pctf)],
    [],
    ['Rango intercuartil'],
    ['Comparables activas usadas en el rango', activeCount],
    ['Percentil 25', stats ? pctf(stats.p25) : '—'],
    ['Mediana', stats ? pctf(stats.med) : '—'],
    ['Percentil 75', stats ? pctf(stats.p75) : '—'],
    [],
    ['Resultado de cumplimiento'],
  ];

  if (adjustment) {
    filas.push(['¿Dentro del rango?', adjustment.within ? 'Sí — CUMPLE' : 'No — NO CUMPLE']);
    if (!adjustment.within) {
      filas.push(
        ['Dirección', adjustment.dir],
        ['Ajuste bruto (a la mediana)', fmt(adjustment.raw)],
        ['Ajuste aplicado (topado por el egreso)', fmt(adjustment.capped)],
        ['¿Se topó por el monto del egreso?', adjustment.flag ? 'Sí' : 'No'],
        ['¿Ajuste improcedente (resultaría negativo)?', adjustment.improcedente ? 'Sí' : 'No'],
      );
    }
  } else {
    filas.push(['Sin datos suficientes (cifras de la examinada y/o comparables activas) para evaluar el cumplimiento.', '']);
  }

  return XLSX.utils.aoa_to_sheet(filas);
}

function hojaMetodologia() {
  const filas = [
    ['Metodología del cálculo'],
    [],
    ['1. Indicador de rentabilidad (PLI)'],
    ['Margen Operacional (MO)', 'Utilidad Operacional / Ventas'],
    ['Margen Bruto (MB)', '(Ventas − Costo de Ventas) / Ventas'],
    ['Razón Berry', 'Ventas / (Costo de Ventas + Gastos Operativos), donde Gastos Operativos = Ventas − Costo de Ventas − Utilidad Operacional'],
    [],
    ['2. Ajuste de capital de trabajo (cuando aplica; no se calcula sobre Razón Berry)'],
    ['Fórmula', 'Tasa de interés × [ (CxC/Ventas examinada − CxC/Ventas comparable) + (Inventarios/Ventas examinada − Inventarios/Ventas comparable) − (CxP/Costo examinada − CxP/Costo comparable) ]'],
    ['PLI ajustado', 'PLI crudo de la comparable + el ajuste anterior'],
    [],
    ['3. Rango intercuartil'],
    ['Cálculo', 'Se ordenan de menor a mayor los PLI ajustados de las comparables activas (según el filtro Todas/Internacionales/Nacionales de la tabla) y se toma el valor en la posición floor(percentil × (n−1)) para el percentil 25, la mediana (percentil 50) y el percentil 75.'],
    [],
    ['4. Regla de ajuste de la parte examinada'],
    ['Dentro del rango', 'No se ajusta: el PLI de la parte examinada está entre el percentil 25 y el percentil 75.'],
    ['Fuera del rango', 'Se calcula un ajuste bruto que llevaría el resultado a la mediana: (Mediana − PLI examinada) × Ventas de la examinada.'],
    ['Tope', 'Si el ajuste bruto supera en valor absoluto el monto del egreso declarado, se topa a ese monto (con el mismo signo).'],
    ['Improcedencia', 'Si el ajuste resultara negativo, no se aplica: queda en cero y se marca como improcedente.'],
  ];
  return XLSX.utils.aoa_to_sheet(filas);
}

function hojaFiltros(datos) {
  const { engineConfig, selectionFunnel } = datos.filtros;
  const filas = [
    ['Filtros configurados en el motor'],
    [],
    ['N objetivo (tope 30)', engineConfig.nTarget],
    ['Pérdidas operativas', engineConfig.perdidaOp === 'excluir' ? 'Excluir (criterio conservador DIAN)' : 'Incluir (criterio OCDE)'],
    ['Sociedades holding', engineConfig.holding === 'excluir' ? 'Excluir (sin actividad propia)' : 'Incluir'],
    ['Saldos negativos', engineConfig.saldoNegativo === 'excluir' ? 'Excluir (datos no verosímiles)' : 'Incluir'],
    ['Prioridad geográfica', engineConfig.geo === 'ninguna' ? 'Global' : engineConfig.geo],
    ['Rigor funcional', engineConfig.rigor],
    ['Justificación de pérdida', engineConfig.justificacionPerdida || '—'],
    [],
    ['Embudo de selección'],
  ];

  if (selectionFunnel) {
    filas.push(
      ['Universo evaluado', selectionFunnel.evaluadas],
      ['Descartadas por los filtros (holding/saldo negativo/pérdida)', selectionFunnel.rechazadasFiltros ?? 0],
      ['Curadas con IA', selectionFunnel.curadas ?? 0],
      ['  · de esas, reutilizadas de una corrida anterior', selectionFunnel.reutilizadas ?? 0],
      ['Rechazadas por la curación IA', selectionFunnel.rechazadasIA ?? 0],
      ['Rechazadas por el rigor funcional', selectionFunnel.rechazadasRigor ?? 0],
      ['Válidas (pasaron todos los filtros)', selectionFunnel.validas],
      ['Seleccionadas', selectionFunnel.seleccionadas],
      ['Objetivo (N)', selectionFunnel.objetivo],
      ['En reserva (válidas que no entraron por el tope N)', selectionFunnel.reserva],
    );
  } else {
    filas.push(['No se ejecutó la selección automática del motor en esta corrida: las comparables de este estudio se cargaron o editaron manualmente.']);
  }

  return XLSX.utils.aoa_to_sheet(filas);
}

const HEADERS_BASE = ['Razón Social', 'ID', 'Ámbito', 'SIC', 'Ventas', 'Costo de Ventas', 'Utilidad Operacional', 'CxC', 'Inventarios', 'CxP', 'PLI Crudo'];
const HEADERS_ADJ = ['CxC/Ventas (comparable)', 'CxC/Ventas (examinada)', 'Inv/Ventas (comparable)', 'Inv/Ventas (examinada)', 'CxP/Costo (comparable)', 'CxP/Costo (examinada)', 'Tasa de Interés', 'Ajuste de Capital de Trabajo'];
const HEADERS_TAIL = ['PLI Ajustado', 'Incluida en el Rango', 'Puntaje del Motor', 'Razones', 'Continuidad'];

function hojaComparables(datos) {
  const { comparables, estudio, examinada } = datos;
  const conAjuste = !!estudio.useAdj && estudio.pli !== 'Berry';
  const headers = [...HEADERS_BASE, ...(conAjuste ? HEADERS_ADJ : []), ...HEADERS_TAIL];
  const tR = examinada.tR || {};

  const filas = [headers];
  (comparables || []).forEach(row => {
    const base = [
      row.name || '', row.id || '', row.amb || '', row.sic || '',
      fmt(row.s), fmt(row.c), fmt(row.op), fmt(row.ar), fmt(row.inv), fmt(row.ap),
      conFormato(row.pli, pctf),
    ];
    const ajuste = conAjuste ? [
      conFormato(row.ratiosComp?.arS, pctf), conFormato(tR.arS, pctf),
      conFormato(row.ratiosComp?.invS, pctf), conFormato(tR.invS, pctf),
      conFormato(row.ratiosComp?.apC, pctf), conFormato(tR.apC, pctf),
      pctf(estudio.interestRate),
      row.adj !== undefined ? fmt(row.adj) : '—',
    ] : [];
    const cola = [
      conFormato(row.adjustedPli, pctf),
      row.isIncluded ? 'Sí' : 'No',
      puntaje(row.score),
      row.razones || '',
      row.esContinuidad ? 'Sí' : 'No',
    ];
    filas.push([...base, ...ajuste, ...cola]);
  });

  return XLSX.utils.aoa_to_sheet(filas);
}

function hojaRechazadas(rechazadas) {
  const headers = ['Razón Social', 'ID', 'SIC', 'País', 'Categoría', 'Motivo de Rechazo'];
  const filas = [headers, ...(rechazadas || []).map(c => [
    c.name || '', c.id || '', c.sic || '', c.country || '',
    CATEGORIA_RECHAZO[c.categoriaRechazo] || c.categoriaRechazo || '',
    c.motivoRechazo || '',
  ])];
  return XLSX.utils.aoa_to_sheet(filas);
}

function hojaReserva(reserva) {
  const headers = ['Razón Social', 'ID', 'SIC', 'País', 'Perfil Funcional', 'Puntaje del Motor', 'Razones'];
  const filas = [headers, ...(reserva || []).map(c => [
    c.name || '', c.id || '', c.sic || '', c.country || '',
    c.perfilFuncional || '', puntaje(c.score), c.razones || '',
  ])];
  return XLSX.utils.aoa_to_sheet(filas);
}

/**
 * Arma el libro de soporte del Motor de Comparables. Función pura: no toca el
 * DOM, así que se puede testear igual que el resto de `services/`.
 *
 * `datos` esperado:
 * {
 *   estudio: { entidad, anio, pli, useAdj, interestRate },
 *   examinada: { T, tPLI, tR },
 *   rango: { stats, activeCount, adjustment },
 *   filtros: { engineConfig, selectionFunnel },
 *   comparables: calculatedRows,           // filas ya calculadas por el componente
 *   auditoria: { rechazadas, reserva } | null,
 * }
 */
export function construirLibroSoporte(datos) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, hojaResumen(datos), 'Resumen');
  XLSX.utils.book_append_sheet(wb, hojaMetodologia(), 'Metodología');
  XLSX.utils.book_append_sheet(wb, hojaFiltros(datos), 'Filtros del motor');
  XLSX.utils.book_append_sheet(wb, hojaComparables(datos), 'Comparables seleccionadas');

  const rechazadas = (datos.auditoria && datos.auditoria.rechazadas) || [];
  if (rechazadas.length) {
    XLSX.utils.book_append_sheet(wb, hojaRechazadas(rechazadas), 'Candidatas rechazadas');
  }

  const reserva = (datos.auditoria && datos.auditoria.reserva) || [];
  if (reserva.length) {
    XLSX.utils.book_append_sheet(wb, hojaReserva(reserva), 'Candidatas en reserva');
  }

  return wb;
}

/** Arma el libro y dispara la descarga en el navegador. */
export function exportarSoporteMotor(datos, nombreArchivo) {
  const wb = construirLibroSoporte(datos);
  XLSX.writeFile(wb, nombreArchivo || 'Soporte_Motor_Comparables.xlsx');
}
