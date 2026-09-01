import XLSX from 'xlsx-js-style';
import { hojasMemoriaRangoOptimo, CLAVES_RUBROS_EXAMINADA } from './memoriaCalculoRangoOptimo.js';
import { obtenerEstudioNormalizadoParaParche } from './estudioNormalizado.js';
import { pctf } from '../utils/calculations.js';

const CATEGORIA_RECHAZO = { filtro: 'Filtro (holding/saldo negativo/pérdida)', ia: 'Curación IA', rigor: 'Rigor funcional' };
const puntaje = (v) => (typeof v === 'number' ? pctf(v) : '—');

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

  const est = datos.estudio || {};
  const T = datos.examinada?.T || {};

  /* ¿De dónde salen las cifras del contribuyente: del estudio en bruto o del `T` que
     armó la pantalla? Importa por una razón concreta, no por estilo: `T.s` y `T.op`
     llegan con el segmento excluido YA descontado —`MotorComparables.jsx` lo descuenta
     para su propio cálculo— mientras `hojasMemoriaRangoOptimo` lo descuenta por su
     cuenta, así que las dos procedencias no son intercambiables y mezclarlas descontaba
     el segmento dos veces.

     El estudio en bruto manda, y las ventas son el testigo de la decisión: si están, todo
     sale de ahí. `T` queda como respaldo para el llamador que solo tenga esa forma, y en
     ese caso el segmento no se vuelve a descontar porque ya viene aplicado.

     Hasta agosto de 2026 la precedencia era la contraria (`T` primero) y `datos.estudio`
     no traía ningún `t_*`: los ocho rubros del ESF llegaban en `undefined` por la ruta del
     Motor de Comparables y la hoja Datos los publicaba en cero. */
  const enBruto = est.t_s !== undefined && est.t_s !== null && est.t_s !== '';

  /* Los alias cortos (`s`, `c`, `op`…) son legado de estudios anteriores al ESF; los ocho
     rubros de balance nuevos no los tienen. `T` usa la clave sin el prefijo `t_`. */
  const cifra = (clave) => {
    const corta = clave.slice(2);
    return enBruto ? (est[clave] ?? est[corta]) : T[corta];
  };

  const estudioBase = {
    /* Los quince rubros, derivados de la lista del emisor y no de una copia a mano:
       añadir un rubro allá no puede volver a dejarlo fuera de aquí. */
    ...Object.fromEntries(CLAVES_RUBROS_EXAMINADA.map((k) => [k, cifra(k)])),
    /* Viaja al lado de `t_s` en bruto y lo descuenta `hojasMemoriaRangoOptimo`, que es
       por donde pasan las DOS rutas de descarga del libro —esta y la del modal, que
       llama al emisor directo (MemoriaRangoModal.jsx:93)—. Descontarlo aquí dejaría al
       modal publicando unas ventas y al motor otras. */
    seg_excluido: enBruto ? (Number(est.seg_excluido) || 0) : 0,
    /* El filtro de ámbito del tablero. Sin él el libro cuartilaba las 16 filas
       mientras el informe cuartilaba solo las del ámbito elegido. */
    cmode: est.cmode || 'all',
    /* Ver la nota de `construirPayloadSoporte`: la hoja de diagnóstico las publica. */
    t_correcciones: est.t_correcciones,
    /* La tasa viaja EN PORCENTAJE (7.37), que es como la escribe el usuario y como la
       espera `hojasMemoriaRangoOptimo`, que la divide entre 100 al escribir la celda de
       la tasa en la hoja Datos (la fila la deriva `FILA_TASA()`, no una fija).
       No leer aquí `estudio.interestRate`: el componente la publica ya dividida para su
       propio cálculo, y tomarla de ahí la dividía dos veces —el libro salía con 0,0737 %
       en vez de 7,37 % y ningún comparable recibía ajuste—. */
    prime: est.prime ?? 0,
    comparables: (datos.comparables || []).map((c) => ({
      name: c.name || c.razonSocial || '',
      /* Mismo criterio que `analizarRangoAjustado:296`: lo que no está marcado como
         nacional es internacional. */
      amb: c.amb === 'Nac' ? 'Nac' : 'Int',
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

  /* La política de pérdidas y la cuota de negativas viajan con la selección. Salen del
     embudo, que es lo que se persiste con el estudio, así que llegan igual por la ruta del
     Motor de Comparables y por la del modal de memoria de cálculo — que es justo el reparto
     que el diseño de 2026-08-11 vino a garantizar. Sin esto, el libro publicaría comparables
     en pérdida sin nada que explique por qué se admitieron. */
  const embudo = (datos.filtros && datos.filtros.selectionFunnel) || null;
  const conPerdidas = seleccion && embudo
    ? {
      ...seleccion,
      perdidas: {
        politica: embudo.politicaPerdidas || null,
        justificacion: embudo.justificacionPerdida || '',
        objetivo: embudo.negativasObjetivo || 0,
        incluidas: embudo.negativasIncluidas || 0,
        disponibles: embudo.negativasDisponibles || 0,
        excluidasPorFiltro: embudo.negativasExcluidasPorFiltro || 0,
      },
    }
    : seleccion;

  const hojasOptimas = hojasMemoriaRangoOptimo(estudioNorm, conPerdidas);

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

/**
 * El payload del libro, armado desde el estudio en bruto.
 *
 * Vive aquí, como función pura, y no dentro del componente, por lo que costó la vez
 * anterior: `MotorComparables.jsx` construía el objeto a mano con seis campos del estudio
 * y las siete cifras del `T` de la pantalla, así que los ocho rubros del ESF y el `cmode`
 * nunca llegaban al libro. La prueba que debía cubrirlo pasaba `examinada.T.cash`, una
 * forma que el componente no producía: verde sobre una ruta que no existía. Derivando los
 * rubros de `CLAVES_RUBROS_EXAMINADA` el olvido ya no es posible, y siendo pura se puede
 * probar la forma real sin renderizar React.
 *
 * `extras` son los datos que solo la pantalla tiene calculados: el indicador y los ratios
 * de la parte examinada, el rango, los filtros del motor, las comparables con su desglose
 * y la auditoría de rechazos.
 */
export function construirPayloadSoporte(study, extras = {}) {
  const s = study || {};
  return {
    estudio: {
      entidad: s.ent || '',
      anio: s.anio || '',
      /* El PLI, el ámbito y la tasa efectiva los decide el tablero, que puede tener el
         selector en un valor todavía no persistido en el estudio. */
      pli: extras.pli ?? s.pli,
      useAdj: extras.useAdj,
      interestRate: extras.interestRate,
      prime: s.prime,
      cmode: extras.cmode ?? s.cmode ?? 'all',
      seg_excluido: s.seg_excluido,
      /* Las correcciones que la verificación de la ingesta aplicó a las cifras leídas. El
         libro las publica en su hoja de diagnóstico, y tienen que viajar por las DOS rutas
         de descarga: el modal recibe el estudio entero y las traía, y sin esta línea la
         ruta del Motor emitía el mismo libro sin ellas. */
      t_correcciones: s.t_correcciones,
      /* Los quince rubros EN BRUTO, sin descontar el segmento excluido: lo descuenta el
         emisor, que es el punto por donde pasan las dos rutas de descarga del libro. */
      ...Object.fromEntries(CLAVES_RUBROS_EXAMINADA.map((k) => [k, s[k]])),
    },
    examinada: extras.examinada,
    rango: extras.rango,
    filtros: extras.filtros,
    comparables: extras.comparables,
    auditoria: extras.auditoria,
    ...(extras.seleccion ? { seleccion: extras.seleccion } : {}),
  };
}

/** Arma el libro y dispara la descarga en el navegador. */
export function exportarSoporteMotor(datos, nombreArchivo) {
  const wb = construirLibroSoporte(datos);
  XLSX.writeFile(wb, nombreArchivo || 'Soporte_Motor_Comparables.xlsx');
}
