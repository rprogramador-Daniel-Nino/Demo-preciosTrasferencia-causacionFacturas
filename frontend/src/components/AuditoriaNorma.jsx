import React from 'react';
import { ShieldCheck, ShieldAlert, AlertCircle, FileText, CheckCircle2, XCircle } from 'lucide-react';
import { num, pliOf, pctf, fmt, segmentacionDesajuste } from '../utils/calculations';
import { analizarRango } from '../services/rangoIntercuartil';

export default function AuditoriaNorma({ study }) {
  const auditPoints = [];

  // Check 1: Datos del Contribuyente
  const hasContribuyente = !!(study.ent && study.nit && study.ciiu);
  auditPoints.push({
    type: 'Norma',
    title: 'Información básica del contribuyente (Razón Social, NIT, CIIU)',
    status: hasContribuyente,
    detail: hasContribuyente 
      ? `Contribuyente: ${study.ent} (NIT: ${study.nit}, CIIU: ${study.ciiu})` 
      : 'Faltan datos de identificación fiscal principal del contribuyente.'
  });

  // Check 2: Representante Legal
  const hasRepLegal = !!study.representante;
  auditPoints.push({
    type: 'Norma',
    title: 'Representación legal identificada',
    status: hasRepLegal,
    detail: hasRepLegal 
      ? `Representante: ${study.representante}` 
      : 'Falta registrar el representante legal.'
  });

  // Check 3: Parte Vinculada
  const hasVinculada = !!(study.vinc && study.pais_vinc && study.vinc_tipo);
  auditPoints.push({
    type: 'Norma',
    title: 'Identificación de la parte vinculada y criterio de vinculación',
    status: hasVinculada,
    detail: hasVinculada 
      ? `Vinculado: ${study.vinc} (${study.pais_vinc}) - Tipo: ${study.vinc_tipo}` 
      : 'Faltan datos de la contraparte del exterior o el criterio de vinculación.'
  });

  // Check 4: Cifras financieras
  const hasFinancials = !!(study.t_s && study.t_op);
  auditPoints.push({
    type: 'Técnica',
    title: 'Cifras financieras de la parte examinada',
    status: hasFinancials,
    detail: hasFinancials 
      ? `Ingresos: COP ${fmt(study.t_s)} | Utilidad Op: COP ${fmt(study.t_op)}` 
      : 'Falta ingresar las cifras financieras principales (Ventas / Utilidad).'
  });

  // Check 5: Muestra de comparables
  const hasComparables = study.comparables && study.comparables.length >= 3;
  auditPoints.push({
    type: 'Técnica',
    title: 'Muestra mínima de comparables (Mínimo 3)',
    status: hasComparables,
    detail: hasComparables 
      ? `Se detectaron ${study.comparables.length} empresas comparables en la muestra.` 
      : `Muestra insuficiente. Solo hay ${study.comparables ? study.comparables.length : 0} comparables (se exigen al menos 3).`
  });

  // Check 6: Cumplimiento de margen (Rango Intercuartil)
  let withinRange = false;
  let statusDetail = 'No se ha podido calcular el cumplimiento.';
  let hasRange = false;
  
  if (study.comparables && study.comparables.length >= 3 && study.t_s && study.t_op) {
    /* El rango y el veredicto salen de `analizarRango`, el mismo servicio que alimenta
       el informe Word y el Excel de soporte. Esta pantalla calculaba antes sus propios
       cuartiles, sin ajuste de capital de trabajo ni filtro de ámbito, de modo que podía
       declarar cumplimiento contra un rango que ningún documento del estudio publicaba. */
    const { stats, adj } = analizarRango(study);

    /* El margen del contribuyente se arma aquí porque el servicio devuelve la conclusión
       y no la cifra que se imprime. Es el mismo `pliOf` con `seg_excluido` descontado que
       el servicio usa por dentro —no un segundo descuento encima del suyo—, así que el
       número que se muestra es el que `adj` comparó contra el rango. */
    const segExcluido = num(study.seg_excluido) || 0;
    const tS = num(study.t_s);
    const tOp = num(study.t_op);
    const tPLI = pliOf({
      s: tS !== null ? tS - segExcluido : null,
      c: num(study.t_c),
      op: tOp !== null ? tOp - segExcluido : null
    }, study.pli || 'MO');

    if (stats) {
      hasRange = true;
      if (adj) {
        withinRange = adj.within;
        statusDetail = adj.within
          ? `Cumple: Margen ${pctf(tPLI)} dentro del rango intercuartil [${pctf(stats.p25)} - ${pctf(stats.p75)}]`
          : `Requiere ajuste: Margen ${pctf(tPLI)} fuera del rango [${pctf(stats.p25)} - ${pctf(stats.p75)}]. Ajuste sugerido: COP ${fmt(adj.capped)}`;
      }
    }
  }

  auditPoints.push({
    type: 'Técnica',
    title: 'Cumplimiento del rango intercuartil (Arm\'s Length)',
    status: hasRange && withinRange,
    detail: statusDetail,
    warningOnly: !hasRange
  });

  // Check 7: Conciliación entre el ingreso del P&L y el monto de la operación con la vinculada
  const segCheck = segmentacionDesajuste(study);
  let segStatus = true;
  let segWarningOnly = false;
  let segDetail = 'No hay datos suficientes para comparar el ingreso del P&L con el monto de la operación reportada.';

  if (segCheck) {
    if (!segCheck.desajuste) {
      segDetail = `El ingreso del P&L (COP ${fmt(segCheck.ingresoPL)}) concilia con la operación reportada con la vinculada (COP ${fmt(segCheck.monto)}).`;
    } else if (study.seg_excluido && study.seg_motivo) {
      segDetail = `Diferencia de COP ${fmt(segCheck.diferencia)} (${pctf(segCheck.diferenciaPct)}) entre el ingreso del P&L y la operación reportada, explicada: ${study.seg_motivo}`;
    } else {
      segStatus = false;
      segWarningOnly = true;
      segDetail = `Hay una diferencia de COP ${fmt(segCheck.diferencia)} (${pctf(segCheck.diferenciaPct)}) entre el ingreso total del estado de resultados y la operación reportada con ${study.vinc || 'la vinculada'}. Verifique con el cliente si hubo una operación no controlada (por ejemplo, un proyecto tipo CoCrea) ajena a esa operación, y regístrela en Cifras del Estado de Resultados.`;
    }
  }

  auditPoints.push({
    type: 'Técnica',
    title: 'Conciliación entre ingreso del P&L y operación con la vinculada',
    status: segStatus,
    detail: segDetail,
    warningOnly: segWarningOnly
  });

  const totalWarnings = auditPoints.filter(p => !p.status && p.warningOnly).length;
  const totalErrors = auditPoints.filter(p => !p.status && !p.warningOnly).length;

  return (
    <div className="space-y-6">
      {/* Resumen de Auditoría */}
      <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm flex flex-col md:flex-row gap-6 justify-between items-start md:items-center">
        <div>
          <h3 className="text-lg font-bold text-zinc-950 dark:text-zinc-50">Auditoría de Cumplimiento Técnico y Normativo</h3>
          <p className="text-sm text-zinc-500">Valida los requisitos de la documentación comprobatoria según el estatuto tributario colombiano.</p>
        </div>
        <div className="flex gap-4">
          <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 px-4 py-2 rounded-lg text-center">
            <span className="text-xs text-emerald-800 dark:text-emerald-400 block font-medium uppercase">Exitosos</span>
            <span className="text-2xl font-bold text-emerald-600 dark:text-emerald-300">{auditPoints.filter(p => p.status).length}</span>
          </div>
          {totalErrors > 0 && (
            <div className="bg-rose-50 dark:bg-rose-950/20 border border-rose-200 px-4 py-2 rounded-lg text-center">
              <span className="text-xs text-rose-800 dark:text-rose-400 block font-medium uppercase">Errores</span>
              <span className="text-2xl font-bold text-rose-600 dark:text-rose-300">{totalErrors}</span>
            </div>
          )}
        </div>
      </div>

      {/* Aviso de desajuste de segmentación */}
      {segCheck && segCheck.desajuste && !study.seg_motivo && (
        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 rounded-xl p-5 shadow-sm flex gap-3 items-start">
          <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-amber-800 dark:text-amber-300 leading-relaxed">
            Hay una diferencia de COP {fmt(segCheck.diferencia)} ({pctf(segCheck.diferenciaPct)}) entre los ingresos totales
            del estado de resultados y la operación reportada con {study.vinc || 'la vinculada'}.
          </p>
        </div>
      )}

      {/* Tarjeta de Lista */}
      <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-sm">
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#0f0f13]">
          <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-500">Reglas de Validación Técnica</h4>
        </div>
        <div className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {auditPoints.map((point, idx) => (
            <div key={idx} className="p-4 flex gap-4 items-start hover:bg-zinc-50/50 dark:hover:bg-zinc-800/20 transition-colors">
              <div className="pt-0.5">
                {point.status ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                ) : point.warningOnly ? (
                  <AlertCircle className="w-5 h-5 text-amber-500 flex-shrink-0" />
                ) : (
                  <XCircle className="w-5 h-5 text-rose-500 flex-shrink-0" />
                )}
              </div>
              <div className="flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200">{point.title}</span>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                    point.type === 'Norma' 
                      ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' 
                      : 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400'
                  }`}>
                    {point.type}
                  </span>
                </div>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-normal">{point.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
