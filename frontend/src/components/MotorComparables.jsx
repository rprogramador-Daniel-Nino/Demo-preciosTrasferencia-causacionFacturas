import React, { useState, useEffect } from 'react';
import {
  Plus, Trash2, ShieldCheck, ShieldAlert, Sparkles, Filter, Calculator,
  Upload, FileText, CheckCircle, AlertTriangle, RefreshCw, Edit3, Eye, FileCheck, Layers, FileUp, BookOpen
} from 'lucide-react';
import { num, pliOf, ratios, quart, pctf, fmt, adjustInfo } from '../utils/calculations';
import { importCapitalIQExcel, scoreCandidates, curateCandidatesWithGemini } from '../services/comparablesEngine';
import { parseEEFFComparableOCR } from '../services/eeffParser';
import { parsePriorStudyFile } from '../services/priorStudyParser';

export default function MotorComparables({ study, updateStudy }) {
  // Prior Study Ingestion State
  const [loadingPriorStudy, setLoadingPriorStudy] = useState(false);
  const [priorStudyMsg, setPriorStudyMsg] = useState('');
  const [estudioAnteriorInfo, setEstudioAnteriorInfo] = useState(study.estudioAnterior || null);

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
  const [uploadingEEFF, setUploadingEEFF] = useState(false);
  const [eeffLog, setEeffLog] = useState({});

  // Visibilidad de la importación de Capital IQ: progreso, diagnóstico y registro.
  const [importProgreso, setImportProgreso] = useState(null);
  const [importMeta, setImportMeta] = useState(null);
  const [importLog, setImportLog] = useState([]);

  // Curación por IA del universo: veredicto por identificador y su progreso.
  const [iaMatch, setIaMatch] = useState(study.iaMatch || null);
  const [curando, setCurando] = useState(false);
  const [curacionProgreso, setCuracionProgreso] = useState(null);

  useEffect(() => {
    updateStudy({
      actividad_especifica: actividad,
      estudioAnterior: estudioAnteriorInfo,
      motorConfig: engineConfig,
      /* universo NO se persiste: es el Excel de Capital IQ completo (miles de filas
         con descripción de negocio) y guardarlo en cada estudio hacía que el JSON
         superara la cuota de localStorage y tumbara toda la app (QuotaExceededError
         sin capturar). Se recalcula re-importando el Excel; lo que sí importa para
         el resto del estudio, `comparables`, sigue persistiendo igual que antes. */
      comparables,
      cmode,
      /* el veredicto de la curación viaja con el estudio: es la constancia de por
         qué se aceptó o rechazó cada candidata, y evita volver a pagar la consulta */
      iaMatch
    });
  }, [actividad, estudioAnteriorInfo, engineConfig, universo, comparables, cmode, iaMatch]);

  // Handle Prior Study Ingestion (.pdf, .docx, .json, .txt)
  const handlePriorStudyUpload = async (file) => {
    if (!file) return;
    setLoadingPriorStudy(true);
    setPriorStudyMsg('🤖 Leyendo informe del año anterior ');
    try {
      const result = await parsePriorStudyFile(file);
      if (result) {
        if (result.actividad_especifica) {
          setActividad(result.actividad_especifica);
          setActInput(result.actividad_especifica);
        }
        const info = {
          fuente: result.filename,
          actividad: result.actividad_especifica,
          comparables: result.comparables || []
        };
        setEstudioAnteriorInfo(info);
        setPriorStudyMsg(`✅ Informe leído con éxito. Extraída actividad y ${result.comparables.length} comparables de la tabla anterior.`);
      }
    } catch (err) {
      console.error("Error al leer informe del año anterior:", err);
      setPriorStudyMsg('⚠️ No se pudo procesar el informe .');
    } finally {
      setLoadingPriorStudy(false);
    }
  };

  // Registro de lo que va pasando durante una importación, visible en pantalla.
  // Antes el único rastro era console.error, así que un archivo que no se podía
  // mapear se veía igual que uno cargado con éxito: sin nada.
  const anotar = (texto, tipo = 'info') => {
    const hora = new Date().toLocaleTimeString('es-CO', { hour12: false });
    setImportLog(prev => [...prev.slice(-60), { hora, texto, tipo }]);
    if (tipo === 'error') console.error('[Capital IQ] ' + texto);
    else console.log('[Capital IQ] ' + texto);
  };

  /* Cura el universo contra la actividad detectada. El veredicto se guarda por
     identificador y se persiste con el estudio: si el navegador se recarga, lo ya
     curado no se pierde. Mientras corre, la selección del paso 3 queda bloqueada,
     porque ejecutarla a medias produciría un conjunto con criterios distintos
     según qué lotes hubieran terminado. */
  const curarUniverso = async (candidatas) => {
    const act = String(actividad || '').trim();
    if (!act) {
      anotar('Sin actividad detectada: se omite la curación por IA y el motor usará las palabras clave. Cargue el informe del año anterior para detectarla.', 'aviso');
      return null;
    }
    setCurando(true);
    setCuracionProgreso({ etapa: 'inicio', mensaje: 'Preparando la curación…' });
    try {
      const priorComps = (estudioAnteriorInfo && estudioAnteriorInfo.comparables) || [];
      const veredicto = await curateCandidatesWithGemini(candidatas, act, {
        priorComps,
        fuente: (importMeta && importMeta.archivo) || '',
        onProgress: (info) => {
          setCuracionProgreso(info);
          if (info.etapa === 'inicio' || info.etapa === 'omitida') anotar(info.mensaje, info.etapa === 'omitida' ? 'aviso' : 'info');
        },
      });
      setIaMatch(veredicto);
      if (veredicto.omitida) {
        anotar(veredicto.omitida, 'aviso');
      } else {
        anotar(`Curación terminada: ${veredicto.coinciden} de ${veredicto.total} coinciden con la actividad`, 'ok');
        if (veredicto.fallidas) {
          anotar(`${veredicto.fallidas} candidatas no se pudieron evaluar; se dejan pasar sin descartarlas por actividad.`, 'aviso');
        }
      }
      return veredicto;
    } catch (err) {
      anotar('La curación por IA falló: ' + (err && err.message ? err.message : 'error desconocido') +
        '. El motor seguirá con las palabras clave.', 'error');
      return null;
    } finally {
      setCurando(false);
      setCuracionProgreso(null);
    }
  };

  // Handle Capital IQ File Upload
  const handleImportExcel = async (file) => {
    if (!file) return;
    setLoadingExcel(true);
    setImportLog([]);
    setImportMeta(null);
    setImportProgreso({ etapa: 'Abriendo el archivo…', hechas: 0, total: null });
    anotar(`Archivo recibido: «${file.name}» (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
    try {
      const { rows, meta } = await importCapitalIQExcel(file, (etapa, hechas, total) => {
        setImportProgreso({ etapa, hechas, total });
      });

      setImportMeta(meta);
      anotar(`Hoja «${meta.hoja}» de ${meta.hojas.length} (${meta.hojas.join(', ')})`);
      anotar(`Encabezados detectados en la fila ${meta.filaEncabezados + 1}; ${meta.filas} filas en la hoja`);
      anotar(`Columnas reconocidas (${meta.reconocidas.length}): ${meta.reconocidas.map(r => r.etiqueta).join(', ')}`);
      if (meta.faltantes.length) {
        anotar(`Columnas no encontradas: ${meta.faltantes.map(f => f.etiqueta).join(', ')}`,
          meta.faltantes.some(f => f.esencial) ? 'error' : 'aviso');
      }
      if (meta.saltadas) anotar(`${meta.saltadas} filas sin compañía se omitieron (totales, notas o filas vacías)`, 'aviso');

      if (!rows.length) {
        anotar('No se obtuvo ninguna compañía del archivo.', 'error');
        setImportProgreso(null);
        return;
      }

      setUniverso(rows);
      anotar(`${rows.length} compañías cargadas como universo evaluable`, 'ok');
      if (meta.sinCuentasDeBalance) {
        anotar('El cribado no trae cartera, inventarios ni proveedores: el ajuste de capital de trabajo queda pendiente hasta cargar los estados financieros.', 'aviso');
      }
      setImportProgreso(null);

      /* La curación se hace aquí, sobre el UNIVERSO recién importado, no después
         de seleccionar: su veredicto es uno de los filtros del motor, así que
         tiene que existir antes de puntuar. Curar después obligaba a quedarse
         corto de comparables cuando la IA rechazaba parte de las elegidas. */
      await curarUniverso(rows);
      anotar('Siguiente: defina los filtros del paso 2 y ejecute la selección del paso 3.', 'ok');
    } catch (err) {
      // El error trae meta cuando el archivo se leyó pero no se pudo mapear:
      // saber qué encabezados había es lo que permite corregir el export.
      if (err && err.meta) {
        setImportMeta(err.meta);
        anotar(`Hoja «${err.meta.hoja}», encabezados en la fila ${err.meta.filaEncabezados + 1}`);
        anotar(`Encabezados leídos: ${err.meta.encabezados.slice(0, 12).join(' | ') || '(ninguno)'}`);
      }
      anotar(err && err.message ? err.message : 'Falló la importación.', 'error');
      setImportProgreso(null);
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
    if (curando) {
      alert('Espere a que termine la curación por IA: el motor necesita su veredicto para puntuar.');
      return;
    }
    setLoadingSelection(true);
    setImportLog([]);
    try {
      const priorComps = (estudioAnteriorInfo && estudioAnteriorInfo.comparables) || [];
      anotar(`Evaluando ${universo.length} candidatas del universo…`);

      /* El veredicto de la curación entra como uno de los filtros del motor, junto
         con holding, saldos negativos y pérdida operativa. Si no se curó —sin
         actividad detectada o sin descripciones— el motor sigue con las palabras
         clave, no descarta a nadie por omisión. */
      let veredicto = iaMatch;
      if (!veredicto && String(actividad || '').trim()) {
        anotar('El universo no estaba curado; curando ahora antes de puntuar…', 'aviso');
        veredicto = await curarUniverso(universo);
      }

      const result = scoreCandidates(universo, engineConfig, actividad, priorComps, {
        ventasParteExaminada: study.t_s,
        iaMatch: veredicto,
      });

      const porIA = result.rechazadas.filter(c => /Curación IA|Sin descripción del negocio/.test(c.motivoRechazo || '')).length;
      anotar(`${result.totalValidas} pasaron los filtros; ${result.rechazadas.length} descartadas` +
        (porIA ? ` (${porIA} por la curación con IA)` : ''));
      if (!result.ventasParteExaminada) {
        anotar('Sin ventas de la parte examinada: el factor de tamaño queda neutro. Diligéncielas en la tarjeta de cifras.', 'aviso');
      }
      if (!result.conActividad) {
        anotar('Sin actividad detectada: la especialidad pesa 15 % en lugar de 40 %.', 'aviso');
      }

      const nTarget = engineConfig.nTarget || 12;
      const finales = result.seleccionadas;
      setComparables(finales);
      setSelectionFunnel({
        evaluadas: result.evaluadas,
        validas: result.totalValidas,
        rechazadasFiltros: result.rechazadas.length - porIA,
        curadas: veredicto ? veredicto.total : 0,
        rechazadasIA: porIA,
        seleccionadas: finales.length,
        objetivo: nTarget,
        reserva: result.reserva.length,
      });

      if (finales.length < nTarget) {
        anotar(`Solo ${finales.length} de las ${nTarget} buscadas: no quedan más candidatas válidas. Amplíe los criterios del paso 2.`, 'aviso');
      } else {
        anotar(`${finales.length} comparables seleccionadas · ${result.reserva.length} en reserva`, 'ok');
      }
    } catch (err) {
      console.error("Error ejecutando selección del motor:", err);
      anotar(err && err.message ? err.message : 'Falló la selección.', 'error');
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

      {/* ══════ BANNER: INGESTA DEL ESTUDIO DEL AÑO ANTERIOR ══════ */}
      <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-zinc-100 dark:border-zinc-800 pb-3">
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-[#0FA3A1]" />
            <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100">
              Documentación Comprobatoria del Año Anterior (Fuente Histórica)
            </h3>
          </div>
          {estudioAnteriorInfo && (
            <span className="text-xs bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400 px-2.5 py-1 rounded-full font-semibold border border-emerald-200 dark:border-emerald-800">
              ✓ {estudioAnteriorInfo.fuente}
            </span>
          )}
        </div>

        <p className="text-xs text-zinc-500">
          Cargue aquí el informe o estudio de precios de transferencia del año anterior (.pdf, .docx, .json, .txt). El sistema detectará automáticamente la actividad de la empresa y la matriz de comparables anteriores para garantizar el principio de continuidad.
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 bg-[#0FA3A1] hover:bg-[#0B7C7A] text-white px-4 py-2.5 rounded-lg text-xs font-bold cursor-pointer transition-colors shadow-sm">
            <FileUp className="w-4 h-4" />
            <span>{loadingPriorStudy ? 'Analizando con Gemini AI...' : '📎 Cargar Informe del Año Anterior'}</span>
            <input
              type="file"
              accept=".pdf,.docx,.doc,.json,.txt"
              disabled={loadingPriorStudy}
              onChange={(e) => e.target.files[0] && handlePriorStudyUpload(e.target.files[0])}
              className="hidden"
            />
          </label>
          {priorStudyMsg && (
            <span className="text-xs font-medium text-[#0FA3A1] bg-[#0FA3A1]/10 px-3 py-1.5 rounded-lg">
              {priorStudyMsg}
            </span>
          )}
        </div>
      </div>

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
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900 text-xs font-semibold text-zinc-700 dark:text-zinc-300 transition-colors cursor-pointer"
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
          {/* Los pesos que se anuncian son los que aplica scoreCandidates de verdad
              y cambian según haya o no actividad detectada. Antes el encabezado
              declaraba una ponderación que el código no implementaba. */}
          <span className="text-[11px] font-medium text-zinc-500">
            {actividad && actividad.trim()
              ? 'Ponderación: Actividad (40%) · Perfil (20%) · Tamaño (15%) · Rentabilidad (15%) · Geografía (10%)'
              : 'Ponderación sin actividad detectada: Perfil (35%) · Tamaño (20%) · Actividad (15%) · Rentabilidad (15%) · Geografía (15%)'}
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

          {/* Progreso de la carga: etapa, contador y barra. Sin esto, un archivo de
              3.000 filas parece no hacer nada. */}
          {importProgreso && (
            <div className="bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3">
              <div className="flex items-center gap-2 text-[11px] font-semibold text-zinc-700 dark:text-zinc-200">
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#0FA3A1]" />
                <span>{importProgreso.etapa}</span>
                {importProgreso.total ? (
                  <span className="ml-auto tabular-nums text-zinc-500">
                    {importProgreso.hechas.toLocaleString('es-CO')} de {importProgreso.total.toLocaleString('es-CO')}
                    {' · '}{Math.min(100, Math.round((importProgreso.hechas / importProgreso.total) * 100))} %
                  </span>
                ) : null}
              </div>
              <div className="h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-full mt-2 overflow-hidden">
                <div
                  className={'h-full bg-[#0FA3A1] transition-all duration-150' + (importProgreso.total ? '' : ' opacity-40 w-full animate-pulse')}
                  style={importProgreso.total
                    ? { width: Math.min(100, Math.round((importProgreso.hechas / importProgreso.total) * 100)) + '%' }
                    : undefined}
                />
              </div>
            </div>
          )}

          {/* Diagnóstico de lo que se leyó: hoja, fila de encabezados y columnas.
              Es lo que permite corregir el export cuando el mapeo no cuadra. */}
          {importMeta && (
            <div className="text-[11px] bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3 space-y-1">
              <div className="text-zinc-700 dark:text-zinc-200">
                <span className="font-semibold">Hoja «{importMeta.hoja}»</span>
                {importMeta.hojas.length > 1 && <span className="text-zinc-500"> de {importMeta.hojas.length} ({importMeta.hojas.join(', ')})</span>}
                <span className="text-zinc-500"> · encabezados en la fila {importMeta.filaEncabezados + 1} · {importMeta.filas.toLocaleString('es-CO')} filas</span>
              </div>
              <div className="flex flex-wrap gap-1">
                {importMeta.reconocidas.map(r => (
                  <span key={r.clave} title={String(r.header || '')} className="px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800/60">
                    {r.etiqueta}
                  </span>
                ))}
                {importMeta.faltantes.map(f => (
                  <span key={f.clave} title={'Se buscó: ' + f.claves.join(', ')} className={'px-1.5 py-0.5 rounded border ' + (f.esencial
                    ? 'bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800/60'
                    : 'bg-zinc-100 dark:bg-zinc-800/60 text-zinc-500 border-zinc-200 dark:border-zinc-700')}>
                    {f.etiqueta} {f.esencial ? '✗' : '—'}
                  </span>
                ))}
              </div>
              {importMeta.encabezados && importMeta.encabezados.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300">Ver los {importMeta.encabezados.length} encabezados del archivo</summary>
                  <div className="mt-1 text-zinc-500 font-mono text-[10px] leading-relaxed">{importMeta.encabezados.join(' | ')}</div>
                </details>
              )}
            </div>
          )}

          {/* Curación por IA del universo: corre al importar, porque su veredicto
              es uno de los filtros del motor. Con miles de candidatas son varios
              lotes y varios minutos, así que hay que decir cuánto falta. */}
          {curacionProgreso && (
            <div className="bg-[#0FA3A1]/5 border border-[#0FA3A1]/30 rounded-lg p-3">
              <div className="flex items-center gap-2 text-[11px] font-semibold text-zinc-700 dark:text-zinc-200">
                <Sparkles className="w-3.5 h-3.5 text-[#0FA3A1] animate-pulse" />
                <span>Curación con Gemini: {curacionProgreso.mensaje}</span>
                {curacionProgreso.total ? (
                  <span className="ml-auto tabular-nums text-zinc-500">
                    {Math.min(100, Math.round(((curacionProgreso.evaluadas || 0) / curacionProgreso.total) * 100))} %
                  </span>
                ) : null}
              </div>
              {curacionProgreso.total ? (
                <div className="h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-full mt-2 overflow-hidden">
                  <div className="h-full bg-[#0FA3A1] transition-all duration-200"
                    style={{ width: Math.min(100, Math.round(((curacionProgreso.evaluadas || 0) / curacionProgreso.total) * 100)) + '%' }} />
                </div>
              ) : null}
              {curacionProgreso.etaMinutos ? (
                <div className="text-[10.5px] text-zinc-500 mt-1.5">
                  {curacionProgreso.lotes} lote(s) · estimado ~{curacionProgreso.etaMinutos} min · no cierre la pestaña
                </div>
              ) : null}
            </div>
          )}

          {/* Resultado de la curación, ya terminada */}
          {!curando && iaMatch && !iaMatch.omitida && (
            <div className="text-[11px] bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3">
              <div className="flex items-center gap-1.5 text-zinc-700 dark:text-zinc-200">
                <Sparkles className="w-3.5 h-3.5 text-[#0FA3A1]" />
                <span className="font-semibold">Universo curado con IA</span>
                <span className="text-zinc-500">
                  · {iaMatch.coinciden} de {iaMatch.total} coinciden con la actividad
                  {iaMatch.fallidas ? ` · ${iaMatch.fallidas} sin evaluar` : ''}
                </span>
                <button
                  type="button"
                  onClick={() => curarUniverso(universo)}
                  disabled={curando || !universo.length}
                  className="ml-auto text-[10.5px] px-2 py-0.5 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  title="Volver a curar el universo, por ejemplo si corrigió la actividad detectada"
                >
                  ↻ Volver a curar
                </button>
              </div>
              {iaMatch.fallidas ? (
                <div className="text-amber-600 dark:text-amber-400 mt-1">
                  Las que no se pudieron evaluar se dejan pasar sin descartarlas por actividad: un fallo de red no debe excluir comparables.
                </div>
              ) : null}
              {iaMatch.actividadUsada ? (
                <div className="text-zinc-500 mt-1">Actividad usada: «{iaMatch.actividadUsada.slice(0, 160)}{iaMatch.actividadUsada.length > 160 ? '…' : ''}»</div>
              ) : null}
            </div>
          )}

          {/* Registro de la importación */}
          {importLog.length > 0 && (
            <details open className="text-[11px]">
              <summary className="cursor-pointer font-semibold text-zinc-600 dark:text-zinc-300 flex items-center gap-1.5">
                <FileText className="w-3.5 h-3.5" /> Registro de la importación ({importLog.length})
              </summary>
              <div className="mt-1.5 max-h-56 overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-[#09090b] divide-y divide-zinc-100 dark:divide-zinc-800/70">
                {importLog.map((l, i) => (
                  <div key={i} className="flex gap-2 px-2.5 py-1.5 font-mono text-[10.5px] leading-relaxed">
                    <span className="text-zinc-400 tabular-nums flex-none">{l.hora}</span>
                    <span className={
                      l.tipo === 'error' ? 'text-red-600 dark:text-red-400'
                        : l.tipo === 'aviso' ? 'text-amber-600 dark:text-amber-400'
                          : l.tipo === 'ok' ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-zinc-600 dark:text-zinc-300'
                    }>
                      {l.tipo === 'error' ? '✗' : l.tipo === 'aviso' ? '⚠' : l.tipo === 'ok' ? '✓' : '·'} {l.texto}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          )}
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
            {/* bloqueado mientras cura: ejecutar a medias daría un conjunto con
                criterios distintos según qué lotes hubieran terminado */}
            <button
              onClick={runEngineSelection}
              disabled={loadingSelection || curando}
              className={'flex items-center gap-2 text-white px-5 py-2.5 rounded-lg text-xs font-bold transition-colors shadow-sm ' +
                (loadingSelection || curando ? 'bg-zinc-400 cursor-not-allowed' : 'bg-[#0FA3A1] hover:bg-[#0B7C7A] cursor-pointer')}
              title={curando ? 'Espere a que termine la curación por IA' : undefined}
            >
              <Sparkles className="w-4 h-4" />
              <span>
                {curando ? 'Curando el universo con IA…'
                  : loadingSelection ? 'Puntuando y seleccionando…'
                    : 'Ejecutar Selección Automática'}
              </span>
            </button>

          </div>

          {/* Embudo de depuración: cada etapa con lo que dejó fuera. Antes eran
              tres números y el de «seleccionadas» contaba el total del pool,
              porque el resultado de la curación no se filtraba. */}
          {selectionFunnel && (
            <div className="text-[11px] bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3 space-y-1.5">
              <div className="font-semibold text-zinc-700 dark:text-zinc-200">Embudo de depuración</div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-zinc-600 dark:text-zinc-300">
                <div>Universo evaluado <b className="tabular-nums">{selectionFunnel.evaluadas.toLocaleString('es-CO')}</b></div>
                <div>Descartadas por los filtros <b className="tabular-nums text-amber-600 dark:text-amber-400">{(selectionFunnel.rechazadasFiltros ?? 0).toLocaleString('es-CO')}</b></div>
                <div>Válidas <b className="tabular-nums">{selectionFunnel.validas.toLocaleString('es-CO')}</b></div>
                <div>Curadas con IA <b className="tabular-nums">{selectionFunnel.curadas ?? '—'}</b></div>
                <div>Rechazadas por la IA <b className={'tabular-nums ' + ((selectionFunnel.rechazadasIA ?? 0) > 0 ? 'text-amber-600 dark:text-amber-400' : '')}>{selectionFunnel.rechazadasIA ?? 0}</b></div>
                <div>
                  Seleccionadas{' '}
                  <b className={'tabular-nums ' + (selectionFunnel.objetivo && selectionFunnel.seleccionadas < selectionFunnel.objetivo ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400')}>
                    {selectionFunnel.seleccionadas}
                  </b>
                  {selectionFunnel.objetivo ? <span className="text-zinc-400"> de {selectionFunnel.objetivo}</span> : null}
                </div>
              </div>
              {selectionFunnel.objetivo && selectionFunnel.seleccionadas < selectionFunnel.objetivo && (
                <div className="text-amber-600 dark:text-amber-400">
                  No se alcanzó el objetivo: tras la curación no quedó reserva suficiente. Amplíe los criterios del paso 2 o revise la actividad detectada.
                </div>
              )}
            </div>
          )}
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
                <th className="py-3 px-3 border-b border-zinc-200 dark:border-zinc-800 w-[10%]">Razón Social</th>
                <th className="py-3 px-3 border-b border-zinc-200 dark:border-zinc-800 w-[8%]">ID IQ</th>
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
                  className={`transition-colors ${row.isIncluded
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
                    {row.esContinuidad && (
                      <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-50 text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-400">
                        Continuidad
                      </span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-zinc-500 dark:text-zinc-400 text-[11px]">
                    {row.id || '—'}
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
