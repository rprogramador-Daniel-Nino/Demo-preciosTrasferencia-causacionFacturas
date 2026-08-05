import XLSX from 'xlsx-js-style';
import { pctf, fmt } from '../utils/calculations.js';
import { hojasMemoriaRangoOptimo } from './memoriaCalculoRangoOptimo.js';
import { normalizarEeff } from './eeffParserNormalizador.js';

const CATEGORIA_RECHAZO = { filtro: 'Filtro (holding/saldo negativo/pérdida)', ia: 'Curación IA', rigor: 'Rigor funcional' };
const puntaje = (v) => (typeof v === 'number' ? (v * 100).toFixed(1) + '%' : '—');

/**
 * Prepara una copia aislada del estudio para la memoria de cálculo óptima
 * sin tocar ni alterar el objeto 'estudio' original usado por el resto del sistema.
 */
function obtenerEstudioNormalizadoParaParche(estudioOriginal) {
  if (!estudioOriginal) return {};
  const copia = JSON.parse(JSON.stringify(estudioOriginal));
  const cftNormalizadas = normalizarEeff({
    ingresos_operacionales: copia.t_s ?? copia.T?.s,
    costo_ventas: copia.t_c ?? copia.T?.c,
    utilidad_operacional: copia.t_op ?? copia.T?.op,
    gastos_operacionales: copia.t_gastos || copia.t_opex,
    cuentas_por_cobrar: copia.t_ar ?? copia.T?.ar,
    inventarios: copia.t_inv ?? copia.T?.inv,
    cuentas_por_pagar: copia.t_ap ?? copia.T?.ap,
    propiedad_planta_equipo: copia.t_ppe ?? copia.T?.ppe,
  });

  if (cftNormalizadas.op !== null && cftNormalizadas.op !== undefined) {
    copia.t_op = cftNormalizadas.op;
  } else if (copia.t_s != null && copia.t_c != null && copia.t_op != null) {
    copia.t_op = Number(copia.t_s) - Number(copia.t_c) - Number(copia.t_op);
  }
  if (cftNormalizadas.ppe != null) copia.t_ppe = cftNormalizadas.ppe;

  if (Array.isArray(copia.comparables)) {
    copia.comparables = copia.comparables.map((comp) => {
      const compNorm = normalizarEeff({
        ingresos_operacionales: comp.s,
        costo_ventas: comp.c,
        utilidad_operacional: comp.op,
        gastos_operacionales: comp.gastos || comp.opex,
        cuentas_por_cobrar: comp.ar,
        inventarios: comp.inv,
        cuentas_por_pagar: comp.ap,
        propiedad_planta_equipo: comp.ppe || comp.propiedad_planta_equipo,
      });
      let opex = compNorm.op;
      if ((opex === null || opex === undefined) && comp.s != null && comp.c != null && comp.op != null) {
        opex = Number(comp.s) - Number(comp.c) - Number(comp.op);
      }
      return {
        ...comp,
        op: opex !== null && opex !== undefined ? opex : comp.op,
        ppe: compNorm.ppe !== null && compNorm.ppe !== undefined ? compNorm.ppe : comp.ppe,
      };
    });
  }
  return copia;
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
 * Arma el libro de soporte del Motor de Comparables integrando las 8 hojas del Excel Óptimo
 * con fórmulas dinámicas recalculables.
 */
export function construirLibroSoporte(datos) {
  const wb = XLSX.utils.book_new();

  const estudioBase = {
    t_s: datos.examinada?.T?.s ?? datos.estudio?.t_s ?? datos.estudio?.s,
    t_c: datos.examinada?.T?.c ?? datos.estudio?.t_c ?? datos.estudio?.c,
    t_op: datos.examinada?.T?.op ?? datos.estudio?.t_op ?? datos.estudio?.op,
    t_ar: datos.examinada?.T?.ar ?? datos.estudio?.t_ar ?? datos.estudio?.ar,
    t_inv: datos.examinada?.T?.inv ?? datos.estudio?.t_inv ?? datos.estudio?.inv,
    t_ap: datos.examinada?.T?.ap ?? datos.estudio?.t_ap ?? datos.estudio?.ap,
    t_ppe: datos.examinada?.T?.ppe ?? datos.estudio?.t_ppe ?? datos.estudio?.ppe,
    prime: datos.estudio?.interestRate ?? datos.estudio?.prime ?? 0,
    comparables: (datos.comparables || []).map((c) => ({
      name: c.name || c.razonSocial || '',
      s: c.s,
      c: c.c,
      op: c.op,
      ar: c.ar,
      inv: c.inv,
      ap: c.ap,
      ppe: c.ppe,
      tasaEfectiva: c.tasaEfectiva,
    })),
  };

  const estudioNorm = obtenerEstudioNormalizadoParaParche(estudioBase);

  const seleccion = datos.seleccion || (datos.auditoria || datos.filtros ? {
    criterios: datos.filtros?.selectionFunnel?.criterios || [],
    candidatas: [
      ...(datos.comparables || []).map(c => ({ ...c, seleccionada: true })),
      ...((datos.auditoria && datos.auditoria.rechazadas) || []).map(c => ({ ...c, seleccionada: false })),
      ...((datos.auditoria && datos.auditoria.reserva) || []).map(c => ({ ...c, seleccionada: false })),
    ]
  } : null);

  const hojasOptimas = hojasMemoriaRangoOptimo(estudioNorm, seleccion);

  hojasOptimas.forEach(({ nombre, celdas, filas, cols, rows, merges, autofiltro }) => {
    const hoja = XLSX.utils.aoa_to_sheet(celdas || filas);
    if (cols) hoja['!cols'] = cols;
    if (rows) hoja['!rows'] = rows;
    if (merges && merges.length) hoja['!merges'] = merges;
    if (autofiltro) hoja['!autofilter'] = typeof autofiltro === 'string' ? { ref: autofiltro } : autofiltro;
    XLSX.utils.book_append_sheet(wb, hoja, nombre);
  });

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
