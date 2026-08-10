import XLSX from 'xlsx-js-style';
import { hojasMemoriaRangoOptimo } from './memoriaCalculoRangoOptimo.js';
import { obtenerEstudioNormalizadoParaParche } from './estudioNormalizado.js';

const CATEGORIA_RECHAZO = { filtro: 'Filtro (holding/saldo negativo/pérdida)', ia: 'Curación IA', rigor: 'Rigor funcional' };
const puntaje = (v) => (typeof v === 'number' ? (v * 100).toFixed(1) + '%' : '—');

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
    /* La tasa viaja EN PORCENTAJE (7.37), que es como la escribe el usuario y como la
       espera `hojasMemoriaRangoOptimo`, que la divide entre 100 al escribir Datos!B11.
       No leer aquí `estudio.interestRate`: el componente la publica ya dividida para su
       propio cálculo, y tomarla de ahí la dividía dos veces —el libro salía con 0,0737 %
       en vez de 7,37 % y ningún comparable recibía ajuste—. */
    prime: datos.estudio?.prime ?? 0,
    comparables: (datos.comparables || []).map((c) => ({
      name: c.name || c.razonSocial || '',
      s: c.s,
      c: c.c,
      op: c.op,
      ar: c.ar,
      inv: c.inv,
      ap: c.ap,
      ppe: c.ppe,
    })),
  };

  const estudioNorm = obtenerEstudioNormalizadoParaParche(estudioBase);

  /* Sin `datos.seleccion` (universo no importado) se arma con lo que sí evaluó el
     motor. Estas candidatas vienen de `scoreCandidates`, así que ya traen
     `motivoClave` y `perfilFuncional`: la hoja de trazabilidad cuenta su embudo
     sobre esas claves y aquí no hace falta enriquecerlas. */
  const seleccion = datos.seleccion || (datos.auditoria || datos.filtros ? {
    criterios: datos.filtros?.selectionFunnel?.criterios || [],
    umbralControl: datos.filtros?.engineConfig?.umbralControl,
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
