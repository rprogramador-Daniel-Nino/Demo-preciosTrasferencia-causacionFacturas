import React, { useState, useEffect } from 'react';
import { 
  Plus, Trash2, ShieldCheck, ShieldAlert, Sparkles, Filter, Calculator, 
  Upload, FileText, CheckCircle, AlertTriangle, RefreshCw, Edit3, Eye, FileCheck, Layers
} from 'lucide-react';
import { num, pliOf, ratios, quart, pctf, fmt, adjustInfo } from '../utils/calculations';
import { importCapitalIQExcel, scoreCandidates, curateCandidatesWithGemini } from '../services/comparablesEngine';
import { parseEEFFComparableOCR } from '../services/eeffParser';

export default function MotorComparables({ study, updateStudy }) {
  // State for Extracted Company Activity
  const [actividad, setActividad] = useState(study.actividad_especifica || 'Prestación de servicios interactivos, diseño digital y soluciones de tecnología.');
  const [editingAct, setEditingAct] = useState(false);
  const [actInput, setActInput] = useState(actividad);

  // Engine Configuration State
  const [engineConfig, setEngineConfig] = useState(study.motorConfig || {
    nTarget: 12,
    perdidaOp: 'excluir',
    holding: 'excluir',
    saldoNegativo: 'excluir',
    geo: 'ninguna',
    rigor: 'estandar',
    justificacionPerdida: ''
  });

  // Imported Universe & Active Comparables
  const [universo, setUniverso] = useState(study.universo || []);
  const [comparables, setComparables] = useState(study.comparables || [
    { name: 'Activision Blizzard Inc', amb: 'Int', s: 7500000000, c: 2500000000, op: 1500000000, ar: 800000000, inv: 100000000, ap: 400000000, sic: '5812', id: '1' },
    { name: 'Electronic Arts Inc', amb: 'Int', s: 7400000000, c: 2200000000, op: 1300000000, ar: 900000000, inv: 50000000, ap: 300000000, sic: '5812', id: '2' },
    { name: 'Take-Two Interactive Software', amb: 'Int', s: 5300000000, c: 1800000000, op: 800000000, ar: 600000000, inv: 20000000, ap: 250000000, sic: '5812', id: '3' },
    { name: 'Ubisoft Entertainment SA', amb: 'Int', s: 2200000000, c: 900000000, op: 250000000, ar: 350000000, inv: 40000000, ap: 180000000, sic: '5812', id: '4' }
  ]);

  const [cmode, setCmode] = useState(study.cmode || 'all');
  const [loadingExcel, setLoadingExcel] = useState(false);
  const [loadingSelection, setLoadingSelection] = useState(false);
  const [selectionFunnel, setSelectionFunnel] = useState(null);
  const [selectedCompForUpload, setSelectedCompForUpload] = useState(null);
  const [uploadingEEFF, setUploadingEEFF] = useState(false);
  const [eeffLog, setEeffLog] = useState({});

  useEffect(() => {
    updateStudy({ 
      actividad_especifica: actividad,
      motorConfig: engineConfig,
      universo,
      comparables, 
      cmode 
    });
  }, [actividad, engineConfig, universo, comparables, cmode]);

  // Handle Capital IQ File Upload
  const handleImportExcel = async (file) => {
    if (!file) return;
    setLoadingExcel(true);
    try {
      const rows = await importCapitalIQExcel(file);
      setUniverso(rows);
    } catch (err) {
      console.error("Error importando Excel Capital IQ:", err);
    } finally {
      setLoadingExcel(false);
    }
  };

  // Run Motor TOP-N Selection & AI Curation
  const runEngineSelection = async () => {
    if (!universo || universo.length === 0) {
      alert("Por favor importe primero un archivo de Capital IQ en el Paso 1.");
      return;
    }
    setLoadingSelection(true);
    try {
      const priorComps = (study.estudioAnterior && study.estudioAnterior.comparables) || [];
      
      // 1. Scoring & Filtering
      let result = scoreCandidates(universo, engineConfig, actividad, priorComps);
      
      // 2. Curación con Gemini AI
      const curatedSeleccionadas = await curateCandidatesWithGemini(result.seleccionadas, actividad);
      
      setComparables(curatedSeleccionadas);
      setSelectionFunnel({
        evaluadas: result.evaluadas,
        validas: result.totalValidas,
        seleccionadas: curatedSeleccionadas.length
      });
    } catch (err) {
      console.error("Error ejecutando selección del motor:", err);
    } finally {
      setLoadingSelection(false);
    }
  };

  // Handle EEFF Ingestion for a Selected Comparable
  const handleComparableEEFFUpload = async (compIndex, file) => {
    if (!file) return;
    setUploadingEEFF(true);
    try {
      const studyYear = study.anio || 2025;
      const result = await parseEEFFComparableOCR(file, studyYear);

      if (result && result.data) {
        const next = [...comparables];
        const data = result.data;

        next[compIndex] = {
          ...next[compIndex],
          s: data.ingresos_operacionales || next[compIndex].s,
          c: data.costo_ventas || next[compIndex].c,
          op: data.utilidad_operacional || next[compIndex].op,
          ar: data.cuentas_por_cobrar || next[compIndex].ar,
          inv: data.inventarios || next[compIndex].inv,
          ap: data.cuentas_por_pagar || next[compIndex].ap,
          eeffVerificado: result.verificacion.esValido,
          eeffHallazgos: result.verificacion.hallazgos,
          eeffArchivo: result.filename
        };

        setComparables(next);
        setEeffLog(prev => ({
          ...prev,
          [next[compIndex].name]: result.verificacion
        }));
      }
    } catch (err) {
      console.error("Error al procesar EEFF de comparable:", err);
    } finally {
      setUploadingEEFF(false);
    }
  };

  const handleRowChange = (index, key, value) => {
    const next = [...comparables];
    next[index][key] = value;
    setComparables(next);
  };

  const addComparable = () => {
    setComparables([...comparables, {
      name: '', amb: 'Int', s: '', c: '', op: '', ar: '', inv: '', ap: '', sic: '', id: Date.now().toString()
    }]);
  };

  const removeComparable = (index) => {
    setComparables(comparables.filter((_, i) => i !== index));
  };

  // Calculations for Interquartile Range
  const kind = study.pli || 'MO';
  const useAdj = study.useadj || false;
  const interestRate = (num(study.prime) || 0) / 100;
  
  const T = {
    s: num(study.t_s),
    c: num(study.t_c),
    op: num(study.t_op),
    ar: num(study.t_ar),
    inv: num(study.t_inv),
    ap: num(study.t_ap)
  };
  
  const tPLI = pliOf(T, kind);
  const tR = ratios(T);

  const calculatedRows = comparables.map(c => {
    const rawVal = {
      s: num(c.s),
      c: num(c.c),
      op: num(c.op),
      ar: num(c.ar),
      inv: num(c.inv),
      ap: num(c.ap)
    };
    
    let pliVal = pliOf(rawVal, kind);
    let adj = 0;
    const cR = ratios(rawVal);

    if (useAdj && kind !== 'Berry' && tR && cR && tR.apC !== null && cR.apC !== null) {
      adj = interestRate * ((tR.arS - cR.arS) + (tR.invS - cR.invS) - (tR.apC - cR.apC));
    }

    const adjustedPli = pliVal === null ? null : pliVal + adj;
    const isIncluded = cmode === 'all' ? true : (cmode === 'intl' ? c.amb === 'Int' : c.amb === 'Nac');

    return {
      ...c,
      pli: pliVal,
      adjustedPli,
      isIncluded
    };
  });

  const activeSeries = calculatedRows
    .filter(r => r.isIncluded && r.adjustedPli !== null)
    .map(r => r.adjustedPli)
    .sort((a, b) => a - b);

  const stats = activeSeries.length ? {
    p25: quart(activeSeries, .25),
    med: quart(activeSeries, .5),
    p75: quart(activeSeries, .75)
  } : null;

  const adjustment = (stats && tPLI !== null) ? adjustInfo(T, tPLI, stats, T.s || 0, 1, study.egreso) : null;

  return (
    <div className="space-y-6">

      {/* ══════ BANNER: ACTIVIDAD DE LA EMPRESA ══════ */}
      <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-emerald-500 font-bold text-lg">🟢</span>
            <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
              Actividad Económica Detectada de la Empresa
            </h3>
          </div>
          <button
            onClick={() => { setEditingAct(!editingAct); setActInput(actividad); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-xs font-semibold text-zinc-700 dark:text-zinc-300 transition-colors"
          >
            <Edit3 className="w-3.5 h-3.5" />
            Editar
          </button>
        </div>

        {editingAct ? (
          <div className="space-y-3 pt-2">
            <textarea
              rows={2}
              value={actInput}
              onChange={(e) => setActInput(e.target.value)}
              className="w-full bg-[#ffffff] dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-lg p-2.5 text-xs text-zinc-950 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-[#0FA3A1]/50"
            />
            <div className="flex gap-2">
              <button
                onClick={() => { setActividad(actInput); setEditingAct(false); }}
                className="bg-[#0FA3A1] text-white px-3 py-1.5 rounded-lg text-xs font-semibold"
              >
                Guardar Actividad
              </button>
              <button
                onClick={() => setEditingAct(false)}
                className="bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 px-3 py-1.5 rounded-lg text-xs font-semibold"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <p className="text-xs text-zinc-600 dark:text-zinc-300 leading-relaxed font-medium bg-zinc-50 dark:bg-zinc-900/50 p-3 rounded-lg border border-zinc-100 dark:border-zinc-800/50">
            {actividad}
          </p>
        )}
      </div>

      {/* ══════ WIZARD DE SELECCIÓN AUTOMÁTICA (TOP-N) ══════ */}
      <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm space-y-6">
        <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-3">
          <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#0FA3A1]" />
            ⚙️ Motor de Selección Automática (TOP-N)
          </h3>
          <span className="text-[11px] font-medium text-zinc-500">
            Ponderación: Actividad (40%) · Tamaño (20%) · Geografía (15%) · Rentabilidad (15%) · Datos (10%)
          </span>
        </div>

        {/* Paso 1: Importar Capital IQ */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-zinc-800 text-white text-xs font-bold flex items-center justify-center">1</span>
            <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100">Importar Excel de Capital IQ</span>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 bg-[#0FA3A1] hover:bg-[#0B7C7A] text-white px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer transition-colors shadow-sm">
              <Upload className="w-4 h-4" />
              <span>{loadingExcel ? 'Importando...' : '📥 Importar Excel (Capital IQ)'}</span>
              <input 
                type="file" 
                accept=".xlsx,.xls,.csv" 
                disabled={loadingExcel} 
                onChange={(e) => e.target.files[0] && handleImportExcel(e.target.files[0])} 
                className="hidden" 
              />
            </label>
            {universo.length > 0 && (
              <span className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                <CheckCircle className="w-4 h-4" /> {universo.length} candidatas cargadas en memoria.
              </span>
            )}
          </div>
        </div>

        {/* Paso 2: Filtros del Motor */}
        <div className="space-y-3 pt-4 border-t border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-zinc-800 text-white text-xs font-bold flex items-center justify-center">2</span>
            <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100">Definir los Filtros del Motor</span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="flex flex-col">
              <label className="text-[11px] font-semibold text-zinc-500 mb-1">N Objetivo (Tope 30)</label>
              <input
                type="number"
                min="4"
                max="30"
                value={engineConfig.nTarget}
                onChange={(e) => setEngineConfig({ ...engineConfig, nTarget: Number(e.target.value) })}
                className="bg-[#ffffff] dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-950 dark:text-zinc-100 focus:outline-none"
              />
            </div>

            <div className="flex flex-col">
              <label className="text-[11px] font-semibold text-zinc-500 mb-1">Pérdidas Operativas</label>
              <select
                value={engineConfig.perdidaOp}
                onChange={(e) => setEngineConfig({ ...engineConfig, perdidaOp: e.target.value })}
                className="bg-[#ffffff] dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-950 dark:text-zinc-100 focus:outline-none"
              >
                <option value="excluir">Excluir (criterio conservador DIAN)</option>
                <option value="incluir">Incluir (criterio OCDE)</option>
              </select>
            </div>

            <div className="flex flex-col">
              <label className="text-[11px] font-semibold text-zinc-500 mb-1">Sociedades Holding</label>
              <select
                value={engineConfig.holding}
                onChange={(e) => setEngineConfig({ ...engineConfig, holding: e.target.value })}
                className="bg-[#ffffff] dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-950 dark:text-zinc-100 focus:outline-none"
              >
                <option value="excluir">Excluir (sin actividad propia)</option>
                <option value="incluir">Incluir</option>
              </select>
            </div>

            <div className="flex flex-col">
              <label className="text-[11px] font-semibold text-zinc-500 mb-1">Saldos Negativos</label>
              <select
                value={engineConfig.saldoNegativo}
                onChange={(e) => setEngineConfig({ ...engineConfig, saldoNegativo: e.target.value })}
                className="bg-[#ffffff] dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-950 dark:text-zinc-100 focus:outline-none"
              >
                <option value="excluir">Excluir (datos no verosímiles)</option>
                <option value="incluir">Incluir</option>
              </select>
            </div>

            <div className="flex flex-col">
              <label className="text-[11px] font-semibold text-zinc-500 mb-1">Prioridad Geográfica</label>
              <select
                value={engineConfig.geo}
                onChange={(e) => setEngineConfig({ ...engineConfig, geo: e.target.value })}
                className="bg-[#ffffff] dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-950 dark:text-zinc-100 focus:outline-none"
              >
                <option value="ninguna">Global</option>
                <option value="LATAM">América Latina</option>
                <option value="NORTEAM">Norteamérica</option>
              </select>
            </div>

            <div className="flex flex-col">
              <label className="text-[11px] font-semibold text-zinc-500 mb-1">Rigor Funcional</label>
              <select
                value={engineConfig.rigor}
                onChange={(e) => setEngineConfig({ ...engineConfig, rigor: e.target.value })}
                className="bg-[#ffffff] dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-950 dark:text-zinc-100 focus:outline-none"
              >
                <option value="estandar">Estándar (servicios+mixtos)</option>
                <option value="estricto">Estricto (solo servicios)</option>
                <option value="amplio">Amplio</option>
              </select>
            </div>
          </div>
        </div>

        {/* Paso 3: Ejecutar Selección y Curación Gemini AI */}
        <div className="space-y-3 pt-4 border-t border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-zinc-800 text-white text-xs font-bold flex items-center justify-center">3</span>
            <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100">Ejecutar la Selección & Curación con Gemini AI</span>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={runEngineSelection}
              disabled={loadingSelection}
              className="flex items-center gap-2 bg-[#0FA3A1] hover:bg-[#0B7C7A] text-white px-5 py-2.5 rounded-lg text-xs font-bold cursor-pointer transition-colors shadow-sm"
            >
              <Sparkles className="w-4 h-4" />
              <span>{loadingSelection ? 'Curando candidatas con Gemini AI...' : 'Ejecutar Selección Automática'}</span>
            </button>

            {selectionFunnel && (
              <span className="text-xs text-zinc-500 font-semibold">
                📊 Evaluadas: {selectionFunnel.evaluadas} | Válidas: {selectionFunnel.validas} | Seleccionadas: {selectionFunnel.seleccionadas}
              </span>
            )}
          </div>
        </div>

        {/* Paso 4: Ingesta EEFF Comparables por Fila / Elección Explícita del Usuario */}
        <div className="space-y-4 pt-4 border-t border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-zinc-800 text-white text-xs font-bold flex items-center justify-center">4</span>
            <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100">Paso 4: Ingestar EEFF de Comparables (Elección Explícita)</span>
          </div>

          <p className="text-xs text-zinc-500">
            Elija a continuación la empresa comparable a la que desea cargarle sus Estados Financieros (PDF o Imagen). El sistema verificará automáticamente las identidades contables antes de incorporar los datos.
          </p>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-zinc-50 dark:bg-zinc-900/50 text-zinc-500 uppercase font-semibold">
                <tr>
                  <th className="py-2 px-3">Empresa Comparable</th>
                  <th className="py-2 px-3">Estado EEFF</th>
                  <th className="py-2 px-3">Archivo Cargado</th>
                  <th className="py-2 px-3 text-right">Acción</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {comparables.map((comp, idx) => (
                  <tr key={idx} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-900/30">
                    <td className="py-2.5 px-3 font-semibold text-zinc-900 dark:text-zinc-100">{comp.name}</td>
                    <td className="py-2.5 px-3">
                      {comp.eeffVerificado ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
                          <CheckCircle className="w-3 h-3" /> Verificado OK
                        </span>
                      ) : comp.eeffArchivo ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">
                          <AlertTriangle className="w-3 h-3" /> Con Alertas
                        </span>
                      ) : (
                        <span className="text-zinc-400 text-[11px]">Sin EEFF cargados</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-zinc-500 text-[11px]">{comp.eeffArchivo || '—'}</td>
                    <td className="py-2.5 px-3 text-right">
                      <label className="cursor-pointer bg-zinc-100 dark:bg-zinc-800 hover:bg-[#0FA3A1] hover:text-white px-3 py-1 rounded text-[11px] font-semibold transition-colors inline-flex items-center gap-1">
                        <Upload className="w-3 h-3" />
                        <span>Cargar EEFF</span>
                        <input
                          type="file"
                          accept="application/pdf,image/*"
                          className="hidden"
                          onChange={(e) => e.target.files[0] && handleComparableEEFFUpload(idx, e.target.files[0])}
                        />
                      </label>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ══════ KPIs & RESULTADOS DEL RANGO INTERCUARTIL ══════ */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Rango Intercuartil</span>
            <Calculator className="w-4 h-4 text-[#0FA3A1]" />
          </div>
          <div className="mt-2">
            <span className="text-xl font-bold tracking-tight">
              {stats ? `${pctf(stats.p25)} - ${pctf(stats.p75)}` : 'N/A'}
            </span>
            <span className="text-xs text-zinc-500 block mt-1">Mediana: {stats ? pctf(stats.med) : '—'}</span>
          </div>
        </div>

        <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Indicador del Contribuyente</span>
            <Sparkles className="w-4 h-4 text-amber-500" />
          </div>
          <div className="mt-2">
            <span className="text-xl font-bold tracking-tight">
              {tPLI !== null ? pctf(tPLI) : 'N/A'}
            </span>
            <span className="text-xs text-zinc-500 block mt-1">Métrica: {study.pli || 'MO'}</span>
          </div>
        </div>

        <div className="md:col-span-2 bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Resultado Cumplimiento</span>
            <div>
              {adjustment ? (
                adjustment.within ? (
                  <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-bold text-lg">
                    <ShieldCheck className="w-5 h-5" />
                    CUMPLE (Dentro del rango)
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-red-600 dark:text-rose-400 font-bold text-lg">
                    <ShieldAlert className="w-5 h-5" />
                    NO CUMPLE ({adjustment.dir})
                  </div>
                )
              ) : (
                <span className="text-sm text-zinc-500">Ingrese cifras y comparables para analizar.</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ══════ TABLA DE COMPARABLES CON PLI AJUSTADO ══════ */}
      <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl overflow-hidden shadow-sm">
        <div className="p-4 border-b border-zinc-200 dark:border-zinc-800 flex flex-col md:flex-row gap-4 items-center justify-between">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-zinc-500" />
            <select
              value={cmode}
              onChange={(e) => setCmode(e.target.value)}
              className="bg-[#ffffff] dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-1.5 text-xs font-medium focus:outline-none text-zinc-950 dark:text-zinc-100"
            >
              <option value="all">Todas las comparables</option>
              <option value="intl">Solo Internacionales</option>
              <option value="nac">Solo Nacionales</option>
            </select>
          </div>
          <button
            onClick={addComparable}
            className="flex items-center gap-2 bg-[#0FA3A1] hover:bg-[#0B7C7A] text-white rounded-lg px-4 py-2 text-xs font-semibold transition-colors shadow-sm cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Agregar Comparable Manual
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[900px]">
            <thead>
              <tr className="bg-zinc-50 dark:bg-[#0f0f13] text-zinc-500 dark:text-zinc-400 text-[10px] font-bold uppercase tracking-wider">
                <th className="py-3 px-3 border-b border-zinc-200 dark:border-zinc-800 w-[18%]">Razón Social</th>
                <th className="py-3 px-3 border-b border-zinc-200 dark:border-zinc-800 w-[8%]">Ámbito</th>
                <th className="py-3 px-3 border-b border-zinc-200 dark:border-zinc-800 text-right w-[10%]">Ventas</th>
                <th className="py-3 px-3 border-b border-zinc-200 dark:border-zinc-800 text-right w-[10%]">Costos</th>
                <th className="py-3 px-3 border-b border-zinc-200 dark:border-zinc-800 text-right w-[10%]">U. Op.</th>
                <th className="py-3 px-3 border-b border-zinc-200 dark:border-zinc-800 text-right w-[8%]">CxC</th>
                <th className="py-3 px-3 border-b border-zinc-200 dark:border-zinc-800 text-right w-[8%]">Inv.</th>
                <th className="py-3 px-3 border-b border-zinc-200 dark:border-zinc-800 text-right w-[8%]">CxP</th>
                <th className="py-3 px-3 border-b border-zinc-200 dark:border-zinc-800 text-center w-[12%]">PLI Ajustado</th>
                <th className="py-3 px-3 border-b border-zinc-200 dark:border-zinc-800 text-center w-[8%]">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800 text-xs">
              {calculatedRows.map((row, idx) => (
                <tr 
                  key={row.id || idx}
                  className={`transition-colors ${
                    row.isIncluded 
                      ? 'hover:bg-zinc-50 dark:hover:bg-zinc-800/40' 
                      : 'opacity-35 bg-zinc-100/50 dark:bg-zinc-950/20'
                  }`}
                >
                  <td className="py-2 px-3">
                    <input
                      type="text"
                      value={row.name}
                      placeholder="Empresa comparable"
                      onChange={(e) => handleRowChange(idx, 'name', e.target.value)}
                      className="w-full bg-transparent border-0 border-b border-transparent hover:border-zinc-300 focus:border-[#0FA3A1] py-1 text-zinc-950 dark:text-zinc-100 focus:outline-none"
                    />
                  </td>
                  <td className="py-2 px-3">
                    <select
                      value={row.amb}
                      onChange={(e) => handleRowChange(idx, 'amb', e.target.value)}
                      className="bg-transparent border-0 border-b border-transparent focus:border-[#0FA3A1] py-1 text-zinc-900 dark:text-zinc-200 focus:outline-none"
                    >
                      <option value="Int">Int</option>
                      <option value="Nac">Nac</option>
                    </select>
                  </td>
                  <td className="py-2 px-3 text-right">
                    <input
                      type="number"
                      value={row.s}
                      placeholder="0"
                      onChange={(e) => handleRowChange(idx, 's', e.target.value)}
                      className="w-full bg-transparent border-0 border-b border-transparent text-right py-1 font-mono text-zinc-950 dark:text-zinc-100 focus:outline-none"
                    />
                  </td>
                  <td className="py-2 px-3 text-right">
                    <input
                      type="number"
                      value={row.c}
                      placeholder="0"
                      onChange={(e) => handleRowChange(idx, 'c', e.target.value)}
                      className="w-full bg-transparent border-0 border-b border-transparent text-right py-1 font-mono text-zinc-950 dark:text-zinc-100 focus:outline-none"
                    />
                  </td>
                  <td className="py-2 px-3 text-right">
                    <input
                      type="number"
                      value={row.op}
                      placeholder="0"
                      onChange={(e) => handleRowChange(idx, 'op', e.target.value)}
                      className="w-full bg-transparent border-0 border-b border-transparent text-right py-1 font-mono text-zinc-950 dark:text-zinc-100 focus:outline-none"
                    />
                  </td>
                  <td className="py-2 px-3 text-right">
                    <input
                      type="number"
                      value={row.ar}
                      placeholder="0"
                      onChange={(e) => handleRowChange(idx, 'ar', e.target.value)}
                      className="w-full bg-transparent border-0 border-b border-transparent text-right py-1 font-mono text-zinc-950 dark:text-zinc-100 focus:outline-none"
                    />
                  </td>
                  <td className="py-2 px-3 text-right">
                    <input
                      type="number"
                      value={row.inv}
                      placeholder="0"
                      onChange={(e) => handleRowChange(idx, 'inv', e.target.value)}
                      className="w-full bg-transparent border-0 border-b border-transparent text-right py-1 font-mono text-zinc-950 dark:text-zinc-100 focus:outline-none"
                    />
                  </td>
                  <td className="py-2 px-3 text-right">
                    <input
                      type="number"
                      value={row.ap}
                      placeholder="0"
                      onChange={(e) => handleRowChange(idx, 'ap', e.target.value)}
                      className="w-full bg-transparent border-0 border-b border-transparent text-right py-1 font-mono text-zinc-950 dark:text-zinc-100 focus:outline-none"
                    />
                  </td>
                  <td className="py-2 px-3 text-center font-bold text-zinc-800 dark:text-zinc-200">
                    {row.adjustedPli !== null ? pctf(row.adjustedPli) : '—'}
                  </td>
                  <td className="py-2 px-3 text-center">
                    <button
                      onClick={() => removeComparable(idx)}
                      className="p-1 hover:bg-red-50 dark:hover:bg-red-950/20 rounded-lg text-zinc-400 hover:text-red-600 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
