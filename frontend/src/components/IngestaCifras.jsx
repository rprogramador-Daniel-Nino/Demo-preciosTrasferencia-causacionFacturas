import React, { useState } from 'react';
import { Sparkles, BarChart, Settings, Calculator, Upload, FileSpreadsheet, CheckCircle2, Loader2, FileCheck, FileText, AlertTriangle } from 'lucide-react';
import { pliOf, pctf } from '../utils/calculations';
import { parseEeffWithGeminiOCR } from '../services/eeffParser';
import { convertPdfToImages } from '../services/pdfRenderer';

export default function IngestaCifras({ study, updateStudy }) {
  const [loadingEeff, setLoadingEeff] = useState(false);
  const [eeffMsg, setEeffMsg] = useState('');
  const [eeffFileName, setEeffFileName] = useState('');

  const handleFieldChange = (key, value) => {
    updateStudy({ [key]: value });
  };

  // Carga de Estados Financieros (EEFF) con Gemini Vision OCR
  const handleEeffUpload = async (file) => {
    if (!file) return;
    setLoadingEeff(true);
    setEeffFileName(file.name);
    setEeffMsg('🤖 Leyendo Estados Financieros con Gemini Vision OCR…');

    try {
      const eeffImages = await convertPdfToImages(file);
      const res = await parseEeffWithGeminiOCR(file);

      const updates = {};
      if (eeffImages && eeffImages.length > 0) {
        updates.eeffImages = eeffImages;
      }

      if (res) {
        if (res.t_s !== null && res.t_s !== undefined) updates.t_s = res.t_s;
        if (res.t_c !== null && res.t_c !== undefined) updates.t_c = res.t_c;
        if (res.t_op !== null && res.t_op !== undefined) updates.t_op = res.t_op;
        if (res.t_ar !== null && res.t_ar !== undefined) updates.t_ar = res.t_ar;
        if (res.t_inv !== null && res.t_inv !== undefined) updates.t_inv = res.t_inv;
        if (res.t_ap !== null && res.t_ap !== undefined) updates.t_ap = res.t_ap;
        if (res.t_cash !== null && res.t_cash !== undefined) updates.t_cash = res.t_cash;
        if (res.t_inv_assoc !== null && res.t_inv_assoc !== undefined) updates.t_inv_assoc = res.t_inv_assoc;
        if (res.t_tax !== null && res.t_tax !== undefined) updates.t_tax = res.t_tax;
        if (res.t_act_curr !== null && res.t_act_curr !== undefined) updates.t_act_curr = res.t_act_curr;
        if (res.t_ppe !== null && res.t_ppe !== undefined) updates.t_ppe = res.t_ppe;
        if (res.t_intang !== null && res.t_intang !== undefined) updates.t_intang = res.t_intang;
        if (res.t_dif !== null && res.t_dif !== undefined) updates.t_dif = res.t_dif;
        if (res.t_act_nocurr !== null && res.t_act_nocurr !== undefined) updates.t_act_nocurr = res.t_act_nocurr;
        if (res.t_act_tot !== null && res.t_act_tot !== undefined) updates.t_act_tot = res.t_act_tot;
      }

      updateStudy(updates);
      /* El mensaje decía siempre "páginas adjuntadas" aunque convertPdfToImages
         hubiera devuelto un arreglo vacío (falla silenciosa, ver pdfRenderer.js): el
         analista veía "éxito" y solo se enteraba de que el ANEXO A quedó sin imágenes
         al abrir el Word ya generado. */
      const paginasAdjuntas = eeffImages ? eeffImages.length : 0;
      if (paginasAdjuntas > 0) {
        setEeffMsg(`✅ EEFF leídos y ${paginasAdjuntas} página(s) del PDF adjuntadas para el ANEXO A.`);
      } else {
        setEeffMsg('⚠ Se leyeron las cifras, pero no se pudieron adjuntar las páginas del PDF para el ANEXO A (revise que el archivo no esté dañado, o inténtelo de nuevo).');
      }
    } catch (err) {
      console.error("Error procesando EEFF con OCR:", err);
      setEeffMsg('⚠ No se pudo procesar el archivo. Puede ingresar las cifras manualmente.');
    } finally {
      setLoadingEeff(false);
    }
  };

  const calculatedPli = pliOf({
    s: study.t_s || 0,
    c: study.t_c || 0,
    op: study.t_op || 0
  }, study.pli || 'MO');

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Columna Izquierda: Formulario de Cifras e Ingesta */}
      <div className="lg:col-span-2 space-y-6">
        
        {/* 1. Sección: Ingesta de Estados Financieros (EEFF) */}
        <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-3">
            <h3 className="text-md font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
              <FileText className="w-5 h-5 text-[#0FA3A1]" />
              Ingesta de Estados Financieros (EEFF de la Empresa)
            </h3>
            {eeffFileName && (
              <span className="text-xs bg-[#0FA3A1]/10 text-[#0FA3A1] font-semibold px-2.5 py-1 rounded-full flex items-center gap-1">
                <FileCheck className="w-3.5 h-3.5" />
                {eeffFileName}
              </span>
            )}
          </div>

          <p className="text-xs text-zinc-500 leading-relaxed">
            Adjunte el Estado de Resultados o Balance General de la compañía (Excel, PDF o Imagen). El sistema leerá las cifras de Ventas, Costos, Utilidad Operacional, Cartera, Inventarios y Proveedores.
          </p>

          <div className="border-2 border-dashed border-zinc-200 dark:border-zinc-800 rounded-xl p-4 flex flex-col items-center justify-center text-center hover:border-[#0FA3A1] transition-colors relative cursor-pointer bg-zinc-50/50 dark:bg-zinc-900/30">
            <input
              type="file"
              accept=".xlsx,.xls,.pdf,image/*"
              disabled={loadingEeff}
              onChange={(e) => {
                if (e.target.files[0]) {
                  handleEeffUpload(e.target.files[0]);
                }
              }}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
            {loadingEeff ? (
              <div className="flex flex-col items-center gap-2 py-2">
                <Loader2 className="w-8 h-8 text-[#0FA3A1] animate-spin" />
                <span className="text-xs font-semibold text-zinc-600 dark:text-zinc-300">Extrayendo cifras financieras...</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2 py-2">
                <Upload className="w-8 h-8 text-zinc-400" />
                <span className="text-xs text-zinc-700 dark:text-zinc-300 font-semibold">
                  Seleccionar o arrastrar Estados Financieros (Excel, PDF o Imagen)
                </span>
                <span className="text-[11px] text-zinc-400">Lectura inteligente OCR + Algoritmo de balances</span>
              </div>
            )}
          </div>

          {eeffMsg && (
            <div className={`p-3 rounded-lg text-xs flex gap-2 items-center ${
              eeffMsg.includes('✅')
                ? 'bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 text-emerald-800 dark:text-emerald-300'
                : 'bg-rose-50 dark:bg-rose-950/20 border border-rose-200 text-rose-800 dark:text-rose-300'
            }`}>
              <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
              <span>{eeffMsg}</span>
            </div>
          )}
        </div>

        {/* Cifras P&L */}
        <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm space-y-4">
          <h3 className="text-md font-bold text-zinc-900 dark:text-zinc-50 border-b border-zinc-100 dark:border-zinc-800 pb-2 flex items-center gap-2">
            <Calculator className="w-5 h-5 text-[#0FA3A1]" />
            Cifras del Estado de Resultados (Parte Examinada)
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="flex flex-col">
              <label className="text-xs font-semibold text-zinc-500 mb-1.5">Ingresos (Ventas)</label>
              <input
                type="number"
                value={study.t_s || ''}
                onChange={(e) => handleFieldChange('t_s', e.target.value)}
                placeholder="COP Ventas"
                className="bg-[#ffffff] dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-[8px] px-[12px] py-[8px] text-sm focus:outline-none focus:ring-2 focus:ring-[#0FA3A1]/50 focus:border-[#0FA3A1] text-zinc-950 dark:text-zinc-100 font-mono"
              />
            </div>

            <div className="flex flex-col">
              <label className="text-xs font-semibold text-zinc-500 mb-1.5">Costo de Ventas</label>
              <input
                type="number"
                value={study.t_c || ''}
                onChange={(e) => handleFieldChange('t_c', e.target.value)}
                placeholder="COP Costos"
                className="bg-[#ffffff] dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-[8px] px-[12px] py-[8px] text-sm focus:outline-none focus:ring-2 focus:ring-[#0FA3A1]/50 focus:border-[#0FA3A1] text-zinc-950 dark:text-zinc-100 font-mono"
              />
            </div>

            <div className="flex flex-col">
              <label className="text-xs font-semibold text-zinc-500 mb-1.5">Utilidad Operacional</label>
              <input
                type="number"
                value={study.t_op || ''}
                onChange={(e) => handleFieldChange('t_op', e.target.value)}
                placeholder="COP Utilidad Op."
                className="bg-[#ffffff] dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-[8px] px-[12px] py-[8px] text-sm focus:outline-none focus:ring-2 focus:ring-[#0FA3A1]/50 focus:border-[#0FA3A1] text-zinc-950 dark:text-zinc-100 font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-zinc-100 dark:border-zinc-800">
            <div className="flex flex-col">
              <label className="text-xs font-semibold text-zinc-500 mb-1.5">Monto Excluido (Operación No Vinculada)</label>
              <input
                type="number"
                value={study.seg_excluido || ''}
                onChange={(e) => handleFieldChange('seg_excluido', e.target.value)}
                placeholder="COP a excluir del ingreso/gasto"
                className="bg-[#ffffff] dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-[8px] px-[12px] py-[8px] text-sm focus:outline-none focus:ring-2 focus:ring-[#0FA3A1]/50 focus:border-[#0FA3A1] text-zinc-950 dark:text-zinc-100 font-mono"
              />
            </div>

            <div className="flex flex-col md:col-span-2">
              <label className="text-xs font-semibold text-zinc-500 mb-1.5">Motivo de la Exclusión (Segmentación)</label>
              <textarea
                value={study.seg_motivo || ''}
                onChange={(e) => handleFieldChange('seg_motivo', e.target.value)}
                placeholder="Ej: proyecto CoCrea con un tercero no vinculado, ajeno a la operación con la vinculada"
                rows={2}
                className="bg-[#ffffff] dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-[8px] px-[12px] py-[8px] text-sm focus:outline-none focus:ring-2 focus:ring-[#0FA3A1]/50 focus:border-[#0FA3A1] text-zinc-950 dark:text-zinc-100"
              />
            </div>
          </div>
        </div>

        {/* Balance General */}
        <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm space-y-4">
          <h3 className="text-md font-bold text-zinc-900 dark:text-zinc-50 border-b border-zinc-100 dark:border-zinc-800 pb-2 flex items-center gap-2">
            <BarChart className="w-5 h-5 text-[#0FA3A1]" />
            Cifras del Balance General (Para Ajuste de Comparabilidad)
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="flex flex-col">
              <label className="text-xs font-semibold text-zinc-500 mb-1.5">Cuentas por Cobrar (Clientes)</label>
              <input
                type="number"
                value={study.t_ar || ''}
                onChange={(e) => handleFieldChange('t_ar', e.target.value)}
                placeholder="COP CxC"
                className="bg-[#ffffff] dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-[8px] px-[12px] py-[8px] text-sm focus:outline-none focus:ring-2 focus:ring-[#0FA3A1]/50 focus:border-[#0FA3A1] text-zinc-950 dark:text-zinc-100 font-mono"
              />
            </div>

            <div className="flex flex-col">
              <label className="text-xs font-semibold text-zinc-500 mb-1.5">Inventarios</label>
              <input
                type="number"
                value={study.t_inv || ''}
                onChange={(e) => handleFieldChange('t_inv', e.target.value)}
                placeholder="COP Inventarios"
                className="bg-[#ffffff] dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-[8px] px-[12px] py-[8px] text-sm focus:outline-none focus:ring-2 focus:ring-[#0FA3A1]/50 focus:border-[#0FA3A1] text-zinc-950 dark:text-zinc-100 font-mono"
              />
            </div>

            <div className="flex flex-col">
              <label className="text-xs font-semibold text-zinc-500 mb-1.5">Cuentas por Pagar (Proveedores)</label>
              <input
                type="number"
                value={study.t_ap || ''}
                onChange={(e) => handleFieldChange('t_ap', e.target.value)}
                placeholder="COP CxP"
                className="bg-[#ffffff] dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-[8px] px-[12px] py-[8px] text-sm focus:outline-none focus:ring-2 focus:ring-[#0FA3A1]/50 focus:border-[#0FA3A1] text-zinc-950 dark:text-zinc-100 font-mono"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Columna Derecha: Configuración de Método e Indicadores */}
      <div className="space-y-6">
        {/* Configuración de Cálculo */}
        <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm space-y-4">
          <h3 className="text-md font-bold text-zinc-900 dark:text-zinc-50 border-b border-zinc-100 dark:border-zinc-800 pb-2 flex items-center gap-2">
            <Settings className="w-5 h-5 text-[#0FA3A1]" />
            Configuración del Análisis
          </h3>

          <div className="flex flex-col">
            <label className="text-xs font-semibold text-zinc-500 mb-1.5">Indicador de Rentabilidad (PLI)</label>
            <select
              value={study.pli || 'MO'}
              onChange={(e) => handleFieldChange('pli', e.target.value)}
              className="bg-[#ffffff] dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-[8px] px-[12px] py-[8px] text-sm focus:outline-none focus:ring-2 focus:ring-[#0FA3A1]/50 focus:border-[#0FA3A1] text-zinc-950 dark:text-zinc-100"
            >
              <option value="MO">Margen Operacional (MO = Utilidad Op / Ventas)</option>
              <option value="MB">Margen Bruto (MB = Utilidad Bruta / Ventas)</option>
              <option value="Berry">Índice de Berry (Utilidad Bruta / Gastos Operativos)</option>
            </select>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <input
              type="checkbox"
              id="useadj"
              checked={study.useadj || false}
              onChange={(e) => handleFieldChange('useadj', e.target.checked)}
              className="accent-[#0FA3A1]"
            />
            <label htmlFor="useadj" className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 select-none">
              Aplicar ajuste de cuentas de capital
            </label>
          </div>

          {study.useadj && (
            <div className="flex flex-col pt-2">
              <label className="text-xs font-semibold text-zinc-500 mb-1.5">Tasa de Interés Anual (Prime Rate %)</label>
              <input
                type="number"
                step="0.01"
                value={study.prime || ''}
                onChange={(e) => handleFieldChange('prime', e.target.value)}
                placeholder="Ej: 7.37"
                className="bg-[#ffffff] dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-[8px] px-[12px] py-[8px] text-sm focus:outline-none focus:ring-2 focus:ring-[#0FA3A1]/50 focus:border-[#0FA3A1] text-zinc-950 dark:text-zinc-100"
              />
              {/* De dónde sale el valor precargado. Es una sola tasa para toda la muestra:
                  el ajuste no usa la tasa del país de cada comparable. */}
              <p className="text-[10px] text-zinc-500 mt-1.5 leading-snug">
                Bank Prime Loan Rate (Reserva Federal, H.15 · serie FRED RIFSPBLPNA), promedio
                anual de días hábiles: 2025 = 7,37 %; 2024 = 8,31 %. Se aplica la misma tasa a
                todas las comparables — ajústala si el año gravable es otro.
              </p>
            </div>
          )}
        </div>

        {/* Resumen Indicador Calculado */}
        <div className="bg-[#0FA3A1]/5 dark:bg-[#0FA3A1]/10 border border-[#0FA3A1]/30 rounded-xl p-5 shadow-sm space-y-2">
          <div className="flex items-center gap-2 text-[#0FA3A1]">
            <Sparkles className="w-4 h-4" />
            <span className="text-xs font-bold uppercase tracking-wider">Resultado Preliminar</span>
          </div>
          <div className="pt-2">
            <span className="text-xs text-zinc-500 dark:text-zinc-400 block font-medium">Indicador de la Parte Examinada:</span>
            <span className="text-3xl font-extrabold text-zinc-950 dark:text-zinc-50 tracking-tight">
              {calculatedPli !== null ? pctf(calculatedPli) : '—'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
