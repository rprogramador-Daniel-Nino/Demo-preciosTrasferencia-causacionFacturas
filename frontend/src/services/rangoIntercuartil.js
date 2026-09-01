/* Rango intercuartil de las comparables y conclusión de cumplimiento.
   Vive aparte porque lo consumen varias rutas: la sustitución por campos con
   nombre (`plantillaVocabulario.js`), las filas de las tablas del informe
   (`tablasInforme.js`) y el Excel de soporte.

   ─── Sobre el ajuste de capital de trabajo ───

   Hasta agosto de 2026 este módulo aplicaba una fórmula propia —sumaba el ajuste
   en puntos al margen, sin venta ajustada ni factor t/(1+t)— distinta de la que
   emite el Excel de soporte, que sí sigue el Anexo del Cap. III de las Guías OCDE.
   El informe y el libro que lo sustenta publicaban por tanto rangos distintos.

   Ahora el cálculo lo hace `ajusteRangoCapitalTrabajo.js`, el mismo motor que
   alimenta el Excel, para los métodos en que ambas definiciones del indicador
   coinciden exactamente:

     · MO → utilidad operacional / ventas
     · MB → utilidad bruta / ventas

     · Berry → utilidad bruta / gastos operativos

   Berry estuvo fuera del motor mientras el sistema lo definía como «Ventas /
   Costos totales» y el motor como «utilidad bruta / gastos operativos»: no eran
   el mismo indicador y enrutarlo habría cambiado la cifra del informe en silencio.
   Esa definición ya se decidió a favor de la del motor —la del Anexo del Cap. III
   de las Guías OCDE, y la que replica el Excel validado por el consultor—, así que
   `pliOf` la adoptó y Berry entra por la misma ruta que los demás.

   Consecuencia que hay que conocer: Berry pasa a admitir el ajuste de capital de
   trabajo, que antes no recibía. El modelo Excel ya lo ajusta —su hoja Berry trae
   las siete columnas de escenario—, así que es alinearse con él, no un invento.

   ─── Convenio de `op` ───

   El resto del sistema guarda `op` como UTILIDAD operacional; el motor OCDE lo
   espera como GASTOS operativos. La traducción se hace aquí, en `aConvenioOCDE`,
   y no en el motor, porque el motor también lo consume el Excel, que ya recibe las
   cifras normalizadas. */

import { num, pliOf, adjustInfo } from '../utils/calculations.js';
import { analizarRangoAjustado, indicadorAjustado } from './ajusteRangoCapitalTrabajo.js';

/* Ya no hay lista de métodos enrutados: los tres indicadores que ofrece el sistema
   —MO, MB y Berry— pasan por el motor. Un `pli` que el motor no sepa construir
   devuelve `stats: null`, que es la respuesta honesta; antes caía en una segunda
   implementación del cuartil que publicaba un número con otra fórmula. */

/* Escenario que reporta el informe: cuentas por cobrar, cuentas por pagar e
   inventario. Es el que describe el anexo de ajustes de capital de trabajo y el
   que la auditoría de la plantilla señaló como el defendible; PP&E queda fuera
   porque desborda el resultado en comparables con activo fijo desproporcionado. */
const SABOR_INFORME = 'aar_aap_inv';

/** Utilidad operacional → gastos operativos, el convenio que espera el motor. */
function aConvenioOCDE(o) {
  const s = num(o.s), c = num(o.c), op = num(o.op);
  return { ...o, op: (s !== null && c !== null && op !== null) ? s - c - op : null };
}

/**
 * El margen de una comparable medido con LA MISMA VARA que decide el cumplimiento.
 *
 * Vive aquí porque este módulo es el que ya sabe cuál de los dos rangos sostiene la conclusión
 * —lo elige `useadj`— y cuál es el escenario de ajuste del informe. El motor de selección lo
 * recibe inyectado: la cuota de negativas ordena por cercanía al contribuyente, y si la
 * conclusión se sostiene en el rango AJUSTADO, medir la cercanía sobre el margen crudo elige el
 * conjunto equivocado (reportado el 2026-09-01).
 *
 * Recibe la comparable en el convenio del ESTUDIO —`op` es la utilidad operacional, como la
 * trae Capital IQ— y hace la traducción al convenio OCDE por dentro. Cruzar esa frontera sin
 * traducir es el error más caro de este sistema, así que no se le pide al llamador.
 *
 * @param {object} comp    la comparable, con `op` como UTILIDAD.
 * @param {object} estudio el estudio: sus cifras, su `pli` y su `useadj`.
 * @returns {number|null}  el margen que el rango va a medir, o `null` si no se puede calcular.
 */
export function margenQueDecide(comp, estudio) {
  const study = estudio || {};
  const kind = study.pli || 'MO';
  const escenario = study.useadj ? SABOR_INFORME : 'ninguno';
  const seg = num(study.seg_excluido) || 0;
  const tS = num(study.t_s), tOp = num(study.t_op);
  const contribuyente = aConvenioOCDE({
    s: tS !== null ? tS - seg : null,
    c: num(study.t_c),
    op: tOp !== null ? tOp - seg : null,
    ar: num(study.t_ar), inv: num(study.t_inv), ap: num(study.t_ap), ppe: num(study.t_ppe),
  });
  const v = indicadorAjustado(aConvenioOCDE(comp), contribuyente, kind, escenario, (num(study.prime) || 0) / 100);
  return v === null || !isFinite(v) ? null : v;
}

export function analizarRango(estudio) {
  const study = estudio || {};
  const kind = study.pli || 'MO';
  /* Ingreso de una operación no controlada ajena a la vinculada: se descuenta de
     ventas y de utilidad, igual que hace el panel, para que el indicador del
     contribuyente no se calcule sobre cifras mezcladas. Aquí `op` es la utilidad
     operacional, así que baja con las ventas. */
  const seg = num(study.seg_excluido) || 0;
  const tS = num(study.t_s), tOp = num(study.t_op);
  const T = {
    s: tS !== null ? tS - seg : null,
    c: num(study.t_c),
    op: tOp !== null ? tOp - seg : null,
    ar: num(study.t_ar), inv: num(study.t_inv), ap: num(study.t_ap),
  };
  const tPLI = pliOf(T, kind);

  const { filas, stats, statsNoAjustado, statsAjustado } = porMetodologiaOCDE(study, kind);

  const adj = stats && tPLI !== null ? adjustInfo(T, tPLI, stats, T.s || 0, 1, study.egreso) : null;
  /* 'CUMPLE' cuando no hay ajuste es comportamiento heredado, no un descuido.
     Ver la nota de la Task 0 del plan antes de cambiarlo. */
  const cumple = adj ? (adj.within ? 'CUMPLE' : 'NO CUMPLE') : 'CUMPLE';

  /* `tPLI` sale del retorno porque el informe lo nombra en prosa —«obtuvo una rentabilidad
     de (X)»— y hasta ahora no había forma de que esa cifra se actualizara: no existía campo
     para el indicador de la parte examinada, así que la frase se radicaba con el del
     contribuyente anterior. Ya se calculaba aquí; solo faltaba publicarlo. */
  return { stats, statsNoAjustado, statsAjustado, tPLI, adj, cumple, filas };
}

/* Ruta unificada: el mismo motor que emite las fórmulas del Excel de soporte.
   Trae de propina dos cosas que antes solo hacía la pantalla y que el informe
   ignoraba —el filtro de ámbito (`cmode`) y el descuento del segmento excluido—,
   de modo que el rango del documento pasa a ser el que se ve en el tablero. */
function porMetodologiaOCDE(study, kind) {
  const preparado = {
    ...study,
    t_op: aConvenioOCDE({ s: study.t_s, c: study.t_c, op: study.t_op }).op,
    comparables: (study.comparables || []).map(aConvenioOCDE),
  };

  /* Los DOS escenarios se calculan siempre, sin mirar `useadj`. Las tablas del informe
     tienen una columna que se titula «AJUSTADO» y otra «NO AJUSTADO», y cada una debe
     llevar lo que su encabezado promete.

     Antes solo se corría el escenario que `useadj` seleccionaba y el otro se copiaba: con
     la casilla apagada, la columna «RANGE MO AJUSTADO» publicaba el rango sin ajustar
     —0,54 % donde el ajuste da 0,21 %—, repitiendo la columna de al lado. El número
     ajustado ya estaba calculado y el libro de soporte lo publicaba en su columna
     CxC+CxP+Inv; el informe simplemente no lo llevaba a la tabla.

     Se le piden al motor y no se recalculan aquí: `docxRelleno.js` los ordenaba y
     cuartilaba por su cuenta, sin el filtro de ámbito (`cmode`), de modo que las dos
     columnas de una misma tabla salían sobre universos distintos. */
  const conAjuste = analizarRangoAjustado(preparado, kind, SABOR_INFORME);
  const sinAjuste = analizarRangoAjustado(preparado, kind, 'ninguno');

  /* `useadj` sigue decidiendo UNA cosa: cuál de los dos rangos sostiene la conclusión de
     cumplimiento. Eso es metodología del estudio —si el análisis ajusta o no por capital
     de trabajo— y no le corresponde a una tabla. Lo que la casilla ya no decide es si el
     documento muestra un número que tiene calculado. */
  const reportado = study.useadj ? conAjuste : sinAjuste;

  return {
    stats: reportado.stats,
    statsNoAjustado: sinAjuste.stats,
    statsAjustado: conAjuste.stats,
    /* Las filas salen de la pasada CON ajuste porque trae las dos cifras de cada
       comparable: `noAjustado` es su margen tal cual y `valor` el ajustado. */
    filas: conAjuste.filas.map((f) => ({
      nombre: f.nombre,
      amb: f.amb,
      noAjustado: f.noAjustado,
      ajustado: f.valor,
    })),
  };
}

/* Aquí vivía `heredado`: margen sin ajuste de capital de trabajo y cuartiles por
   posición truncada con `quart`. Era la segunda implementación del cuartil del
   sistema y solo la alcanzaba Berry. Al adoptar Berry la definición del motor
   quedó sin ningún llamador, y con ella desaparece la posibilidad de que el mismo
   estudio muestre un rango en el modal y otro en el informe. */
