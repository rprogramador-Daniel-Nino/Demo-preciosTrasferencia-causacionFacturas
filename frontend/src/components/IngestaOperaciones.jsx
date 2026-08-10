import React, { useState } from 'react';
import { Upload, FileSpreadsheet, CheckCircle2, Loader2, FileCheck, ArrowRight, Building2, Globe, DollarSign } from 'lucide-react';
import { fmt, montoOperacion } from '../utils/calculations';
import { parseExcelOperations } from '../services/excelOperationsParser';

export default function IngestaOperaciones({ study, updateStudy }) {
  const [loadingExcel, setLoadingExcel] = useState(false);
  const [excelMsg, setExcelMsg] = useState('');
  const [fileName, setFileName] = useState('');

  const handleExcelUpload = async (file) => {
    if (!file) return;
    setLoadingExcel(true);
    setFileName(file.name);
    setExcelMsg('Analizando Excel de Operaciones con Vinculados...');
    
    try {
      const res = await parseExcelOperations(file);
      if (res && res.vinc && (res.monto || res.t_s)) {
        const valMonto = res.monto || res.t_s;
        updateStudy({
          vinc: res.vinc,
          vinc_id: res.vinc_id,
          pais_vinc: res.pais_vinc,
          vinc_tipo: res.vinc_tipo,
          monto: valMonto,
          monto_operacion: valMonto
        });
        const avisos = [];
        /* Con varias contrapartes el total es la suma de todas y el estudio se queda
           con la primera. Decirlo aquí es lo que evita que el informe declare ante la
           DIAN una operación con un vinculado que no es el único. */
        if (res.contrapartes > 1) {
          avisos.push(
            `⚠ el archivo trae ${res.contrapartes} contrapartes distintas y el estudio guarda una sola ` +
            `(${res.vinc}): revise el vinculado y el monto antes de generar el informe`
          );
        }
        /* Misma razón social con varios NIT entre secciones. El estudio guarda un solo
           `vinc_id`, así que sin este aviso el informe se va con la identificación de la
           primera fila y la diferencia con el resto del archivo no la ve nadie. */
        (res.idsDivergentes || []).forEach(d => {
          avisos.push(
            `⚠ «${d.vinculado}» aparece en el archivo con ${d.ids.length} identificaciones distintas ` +
            `(${d.ids.join(', ')}): verifique cuál corresponde al vinculado del informe`
          );
        });
        /* Los egresos son de otro formato (1001) y por eso no se suman, pero callarlo hacía
           que el usuario viera un total menor al del archivo sin explicación. */
        const egresos = res.egresosDescartados;
        if (egresos && egresos.filas > 0) {
          avisos.push(
            `⚠ se descartaron ${egresos.filas} ${egresos.filas === 1 ? 'operación' : 'operaciones'} de egreso ` +
            `por COP $ ${fmt(egresos.monto)}: el estudio solo suma las operaciones de ingreso`
          );
        }
        const aviso = avisos.length ? ' · ' + avisos.join(' · ') : '';
        setExcelMsg(`✅ Operaciones procesadas con éxito: ${res.vinc_tipo} por COP $ ${fmt(valMonto)}${aviso}`);
      } else {
        setExcelMsg('⚠ No se encontraron las hojas u operaciones esperadas en este Excel. Verifique la estructura o ingrese los datos manualmente.');
      }
    } catch (err) {
      console.error("Error al procesar el Excel de operaciones:", err);
      setExcelMsg('⚠ No se pudo procesar el archivo Excel. Verifique la estructura de las hojas.');
    } finally {
      setLoadingExcel(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Encabezado */}
      <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-zinc-950 dark:text-zinc-50">2. Ingesta de Cifras y Operaciones con Vinculados</h2>
          <p className="text-xs text-zinc-500">Cargue el archivo Excel de operaciones del año gravable para extraer montos y contrapartes.</p>
        </div>
        {fileName && (
          <span className="text-xs bg-[#0FA3A1]/10 text-[#0FA3A1] font-semibold px-3 py-1.5 rounded-full flex items-center gap-1.5">
            <FileCheck className="w-4 h-4" />
            {fileName}
          </span>
        )}
      </div>

      {/* Recuadro de Carga de Archivo */}
      <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm space-y-4">
        <div className="border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl p-6 flex flex-col items-center justify-center text-center hover:border-[#0FA3A1] transition-colors relative cursor-pointer bg-zinc-50/50 dark:bg-zinc-900/30">
          <input
            type="file"
            accept=".xlsx,.xls"
            disabled={loadingExcel}
            onChange={(e) => {
              if (e.target.files[0]) {
                handleExcelUpload(e.target.files[0]);
              }
            }}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
          {loadingExcel ? (
            <div className="flex flex-col items-center gap-2 py-4">
              <Loader2 className="w-10 h-10 text-[#0FA3A1] animate-spin" />
              <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">Procesando hojas de operaciones...</span>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 py-4">
              <FileSpreadsheet className="w-10 h-10 text-[#0FA3A1]" />
              <div>
                <span className="text-sm text-zinc-800 dark:text-zinc-200 font-bold block">
                  Seleccionar o arrastrar archivo Excel de Operaciones PT (.xlsx)
                </span>
                <span className="text-xs text-zinc-400">Ejemplo: <code>Información Operaciones PT 2025-2 modificado cr.xlsx</code></span>
              </div>
            </div>
          )}
        </div>

        {excelMsg && (
          <div className={`p-4 rounded-xl text-xs flex gap-2 items-center ${
            excelMsg.includes('✅')
              ? 'bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 text-emerald-800 dark:text-emerald-300'
              : 'bg-rose-50 dark:bg-rose-950/20 border border-rose-200 text-rose-800 dark:text-rose-300'
          }`}>
            <CheckCircle2 className="w-5 h-5 text-emerald-500 flex-shrink-0" />
            <span className="font-medium text-sm">{excelMsg}</span>
          </div>
        )}
      </div>

      {/* Tarjeta Detallada de Operación Extraída */}
      {study.vinc_tipo && (
        <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm space-y-4">
          <h3 className="text-md font-bold text-zinc-900 dark:text-zinc-50 border-b border-zinc-100 dark:border-zinc-800 pb-2">
            Resumen de Operación Extraída
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 space-y-1">
              <span className="text-xs text-zinc-500 font-semibold uppercase tracking-wider block">Concepto de Operación</span>
              <span className="text-base font-bold text-zinc-900 dark:text-zinc-100">{study.vinc_tipo}</span>
            </div>

            <div className="p-4 rounded-xl bg-emerald-50/50 dark:bg-emerald-950/10 border border-emerald-200 dark:border-emerald-900/30 space-y-1">
              <span className="text-xs text-emerald-700 dark:text-emerald-400 font-semibold uppercase tracking-wider block">Monto Total Transaccionado</span>
              {/* El monto de la operación, no `t_s`: este paso escribe `monto` y
                  `monto_operacion`, y `t_s` son los ingresos operacionales que llegan
                  del estado financiero. Leer t_s aquí mostraba «COP $ 0» justo al lado
                  del mensaje de éxito que sí traía la cifra. */}
              <span className="text-xl font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                {montoOperacion(study) === null ? '—' : 'COP $ ' + fmt(montoOperacion(study))}
              </span>
            </div>

            <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 space-y-1">
              <span className="text-xs text-zinc-500 font-semibold uppercase tracking-wider block">Compañía Vinculada</span>
              <span className="text-base font-bold text-zinc-900 dark:text-zinc-100">{study.vinc || '—'}</span>
            </div>

            <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 space-y-1">
              <span className="text-xs text-zinc-500 font-semibold uppercase tracking-wider block">País e ID Fiscal</span>
              <span className="text-base font-bold text-zinc-900 dark:text-zinc-100">{study.pais_vinc || '—'} ({study.vinc_id || '—'})</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
