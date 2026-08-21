import React, { useState } from 'react';
import { Sparkles, BarChart, Settings, Calculator, Upload, CheckCircle2, Loader2, FileCheck, FileText, AlertTriangle, Wand2 } from 'lucide-react';
import { pliOf, pctf, fmt, num } from '../utils/calculations';
import { parseEeffWithGeminiOCR } from '../services/eeffParser';
import { verificarEeff, camposAplicables } from '../services/eeffVerificacion';
import { convertPdfToImages } from '../services/pdfRenderer';

/* Las casillas del balance, con las etiquetas EXACTAS de `RUBROS_EXAMINADA`
   (services/memoriaCalculoRangoOptimo.js) y de `RUBROS_ESF` (services/docxRelleno.js).
   Que el rótulo de la pantalla y el de la hoja del libro sean el mismo texto no es
   cosmética: es lo que permite al analista cotejar una celda del Excel con la casilla
   donde la corrige, sin tener que saber qué alias corresponde a qué.

   Hasta agosto de 2026 solo existían las casillas de ventas, costo, utilidad operacional,
   CxC, inventarios, CxP y PP&E. Los ocho restantes entraban únicamente si la lectura del
   documento los acertaba, y si no, la única vía era editar el Excel: por eso un estado con
   nomenclatura NIIF propia dejaba media hoja `DATOS DE ENTRADA` en ceros sin remedio. */
const RUBROS_BALANCE = [
  { clave: 't_cash', etiqueta: 'Efectivo y equivalentes de efectivo' },
  { clave: 't_inv_assoc', etiqueta: 'Inversiones asociadas' },
  { clave: 't_ar', etiqueta: 'Cuentas por cobrar comerciales y otras' },
  { clave: 't_inv', etiqueta: 'Inventarios' },
  { clave: 't_tax', etiqueta: 'Activos por impuestos corrientes' },
  { clave: 't_act_curr', etiqueta: 'Total, Activo corriente', subtotal: 'corriente' },
  { clave: 't_ppe', etiqueta: 'Propiedades, planta y equipo' },
  { clave: 't_intang', etiqueta: 'Intangibles' },
  { clave: 't_dif', etiqueta: 'Diferidos' },
  { clave: 't_act_nocurr', etiqueta: 'Total, Activos no corrientes', subtotal: 'nocorriente' },
  { clave: 't_act_tot', etiqueta: 'Total, Activos', subtotal: 'total' },
  { clave: 't_ap', etiqueta: 'Cuentas por pagar comerciales' },
];

/* Los mismos grupos que usa `eeffVerificacion.js` para cotejar los subtotales. Aquí solo
   sirven para el aviso junto a la casilla, en vivo mientras el analista escribe. */
const SUMANDOS = {
  corriente: ['t_cash', 't_inv_assoc', 't_ar', 't_inv', 't_tax'],
  nocorriente: ['t_ppe', 't_intang', 't_dif'],
  total: ['t_act_curr', 't_act_nocurr'],
};

const CLASE_CASILLA = 'bg-[#ffffff] dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-[8px] px-[12px] py-[8px] text-sm focus:outline-none focus:ring-2 focus:ring-[#0FA3A1]/50 focus:border-[#0FA3A1] text-zinc-950 dark:text-zinc-100 font-mono';

export default function IngestaCifras({ study, updateStudy }) {
  const [loadingEeff, setLoadingEeff] = useState(false);
  const [eeffMsg, setEeffMsg] = useState('');
  const [eeffFileName, setEeffFileName] = useState('');
  /* Los hallazgos de la última lectura: qué se corrigió y qué necesita una decisión. Vive
     en el componente y no en el estudio porque describe UNA lectura, no el estudio; lo que
     sí se persiste son las correcciones (`t_correcciones`), que el libro publica. */
  const [hallazgos, setHallazgos] = useState(null);

  const handleFieldChange = (key, value) => {
    updateStudy({ [key]: value });
  };

  // Carga de Estados Financieros (EEFF) con Gemini Vision OCR
  const handleEeffUpload = async (file) => {
    if (!file) return;
    setLoadingEeff(true);
    setEeffFileName(file.name);
    setHallazgos(null);
    setEeffMsg('🤖 Leyendo Estados Financieros…');

    try {
      const eeffImages = await convertPdfToImages(file);
      /* El año del estudio viaja al prompt: los estados financieros colombianos son
         comparativos y sin decirle qué columna leer, el modelo elige la más reciente
         —que no es la del estudio cuando se trabaja un año anterior—. */
      const res = await parseEeffWithGeminiOCR(file, study.anio);

      const updates = {};
      if (eeffImages && eeffImages.length > 0) {
        updates.eeffImages = eeffImages;
      }

      /* La verificación decide qué entra: despeja la utilidad operacional de las
         identidades del propio estado en vez de creerle a una fila rotulada, y descarta
         las cifras que no están impresas en el documento. */
      const verificacion = verificarEeff(res, { anioEstudio: study.anio });
      Object.assign(updates, camposAplicables(verificacion.campos));
      updates.t_correcciones = verificacion.correcciones;

      updateStudy(updates);
      setHallazgos(verificacion);

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

  /* El cotejo en vivo de un subtotal contra sus partidas. Devuelve null cuando falta el
     subtotal o cuando cuadra: solo se dibuja cuando hay algo que decir. */
  const descuadre = (grupo) => {
    if (!grupo) return null;
    const impreso = num(study[{ corriente: 't_act_curr', nocorriente: 't_act_nocurr', total: 't_act_tot' }[grupo]]);
    if (impreso === null || impreso === 0) return null;
    const suma = SUMANDOS[grupo].reduce((acc, k) => acc + (num(study[k]) || 0), 0);
    const dif = impreso - suma;
    /* Una milésima de la escala del subtotal, el mismo criterio de `eeffVerificacion.js`:
       los estados financieros redondean y no todo rubro tiene casilla propia. */
    if (Math.abs(dif) <= Math.max(1, Math.abs(impreso) * 0.001)) return null;
    return dif;
  };

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
            Adjunte el Estado de Situación Financiera y el Estado de Resultados de la compañía
            (PDF o imagen). El sistema lee los quince rubros de la parte examinada, comprueba
            que cada cifra esté impresa en el documento y coteja los subtotales y la utilidad
            operacional contra las identidades contables del propio estado.
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
                <span className="text-[11px] text-zinc-400">Lectura del texto del PDF + OCR, con verificación contable</span>
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

          {/* Correcciones aplicadas. Se publican porque una corrección automática sin
              rastro es peor que no corregir: el analista firma cifras que no leyó. */}
          {hallazgos && hallazgos.correcciones.length > 0 && (
            <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 space-y-2">
              <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300">
                <Wand2 className="w-4 h-4 flex-shrink-0" />
                <span className="text-xs font-bold">
                  Se corrigieron {hallazgos.correcciones.length} cifra(s) que no cuadraban con el estado
                </span>
              </div>
              <ul className="space-y-1.5">
                {hallazgos.correcciones.map((c, i) => (
                  <li key={i} className="text-[11px] text-amber-900 dark:text-amber-200 leading-snug">
                    <span className="font-semibold">{c.etiqueta}:</span>{' '}
                    <span className="line-through opacity-70 font-mono">{fmt(c.valorLeido)}</span>{' → '}
                    <span className="font-mono font-semibold">{fmt(c.valorAplicado)}</span>
                    <br />
                    <span className="opacity-80">{c.motivo}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Advertencias: lo que el sistema no corrige porque exige una decisión. */}
          {hallazgos && hallazgos.advertencias.length > 0 && (
            <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900 space-y-2">
              <div className="flex items-center gap-2 text-rose-800 dark:text-rose-300">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span className="text-xs font-bold">
                  {hallazgos.advertencias.length} punto(s) que requieren su revisión
                </span>
              </div>
              <ul className="list-disc pl-4 space-y-1">
                {hallazgos.advertencias.map((a, i) => (
                  <li key={i} className="text-[11px] text-rose-900 dark:text-rose-200 leading-snug">
                    {a.mensaje}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {hallazgos && hallazgos.correcciones.length === 0 && hallazgos.advertencias.length === 0 && (
            <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 text-[11px] text-emerald-800 dark:text-emerald-300 flex gap-2 items-center">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              <span>
                Verificación contable superada: los subtotales, la ecuación patrimonial y la
                utilidad operacional cuadran, y cada cifra está impresa en el documento.
              </span>
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
                className={CLASE_CASILLA}
              />
            </div>

            <div className="flex flex-col">
              <label className="text-xs font-semibold text-zinc-500 mb-1.5">Costo de Ventas</label>
              <input
                type="number"
                value={study.t_c || ''}
                onChange={(e) => handleFieldChange('t_c', e.target.value)}
                placeholder="COP Costos"
                className={CLASE_CASILLA}
              />
              {/* El signo del documento se conserva a propósito: la hoja del libro y el
                  ANEXO A se leen igual que el estado radicado, y el cálculo toma la
                  magnitud (ver `egreso` en utils/calculations.js). */}
              <p className="text-[10px] text-zinc-500 mt-1 leading-snug">
                Puede dejarlo con el signo del estado financiero (negativo o entre
                paréntesis): el cálculo usa la magnitud.
              </p>
            </div>

            <div className="flex flex-col">
              <label className="text-xs font-semibold text-zinc-500 mb-1.5">Utilidad Operacional</label>
              <input
                type="number"
                value={study.t_op || ''}
                onChange={(e) => handleFieldChange('t_op', e.target.value)}
                placeholder="COP Utilidad Op."
                className={CLASE_CASILLA}
              />
              <p className="text-[10px] text-zinc-500 mt-1 leading-snug">
                Utilidad, no gastos. Con pérdida operativa va en negativo.
              </p>
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
                className={CLASE_CASILLA}
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

        {/* Balance General: los doce rubros del ESF, con las etiquetas del libro */}
        <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm space-y-4">
          <h3 className="text-md font-bold text-zinc-900 dark:text-zinc-50 border-b border-zinc-100 dark:border-zinc-800 pb-2 flex items-center gap-2">
            <BarChart className="w-5 h-5 text-[#0FA3A1]" />
            Cifras del Estado de Situación Financiera
          </h3>
          <p className="text-xs text-zinc-500 leading-relaxed">
            Estos rubros alimentan el ajuste de capital de trabajo, el análisis vertical de la
            Tabla 10 y el ANEXO A. Los subtotales avisan si no cuadran con sus partidas.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {RUBROS_BALANCE.map(({ clave, etiqueta, subtotal }) => {
              const dif = descuadre(subtotal);
              return (
                <div key={clave} className="flex flex-col">
                  <label className={`text-xs font-semibold mb-1.5 ${subtotal ? 'text-zinc-700 dark:text-zinc-300' : 'text-zinc-500'}`}>
                    {etiqueta}
                  </label>
                  <input
                    type="number"
                    value={study[clave] || ''}
                    onChange={(e) => handleFieldChange(clave, e.target.value)}
                    placeholder="COP"
                    className={CLASE_CASILLA}
                  />
                  {dif !== null && (
                    <p className="text-[10px] text-amber-700 dark:text-amber-400 mt-1 leading-snug flex gap-1 items-start">
                      <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
                      <span>
                        No cuadra con sus partidas: {dif > 0 ? 'faltan' : 'sobran'}{' '}
                        {fmt(Math.abs(dif))}.
                      </span>
                    </p>
                  )}
                </div>
              );
            })}
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
