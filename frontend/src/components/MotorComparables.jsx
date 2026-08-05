import React, { useState, useEffect } from 'react';
import {
  Plus, Trash2, ShieldCheck, ShieldAlert, Sparkles, Filter, Calculator,
  Upload, FileText, CheckCircle, AlertTriangle, RefreshCw, Edit3, Eye, FileCheck, Layers, FileUp, BookOpen, FileSpreadsheet
} from 'lucide-react';
import { num, pliOf, ratios, quart, pctf, fmt, adjustInfo } from '../utils/calculations';
import { importCapitalIQExcel, scoreCandidates, curateCandidatesWithGemini, prefiltrar, nameKey } from '../services/comparablesEngine';
import { exportarSoporteMotor } from '../services/motorExcelExport';
import { parseEEFFComparableOCR, parseEEFFComparablesLote } from '../services/eeffParser';
import { redactarDescripcionesEnLote } from '../services/descripcionComparables';
import { parsePriorStudyFile } from '../services/priorStudyParser';
import { cruzar, repartir, esCruceFirme, motivoCruce, motivoRechazoEnFila } from '../services/cruceComparables';
import {
  registrarComparablesHistoricas, guardarEeffComparables, leerEeffDeComparables,
  comparablesHistoricasDelAnio,
} from '../services/firestoreRepo';
import {
  comparablesConEeffReutilizable, aplicarEeffGuardadoEnFila, catalogoAComparablesPrevias,
} from '../services/firestoreModelo';
import MemoriaRangoModal from './MemoriaRangoModal.jsx';

/* Aviso que ocupa el lugar de la actividad económica mientras no se extraiga de los
   adjuntos. No es un dato del contribuyente y no debe guardarse como tal. */
const ACTIVIDAD_SIN_EXTRAER = 'No extraido por favor validar adjuntos';

export default function MotorComparables({ study, updateStudy, estudioId, usuario }) {
  // Prior Study Ingestion State
  const [loadingPriorStudy, setLoadingPriorStudy] = useState(false);
  const [priorStudyMsg, setPriorStudyMsg] = useState('');
  const [estudioAnteriorInfo, setEstudioAnteriorInfo] = useState(study.estudioAnterior || null);
  /* Resultado de haber llevado las empresas del informe anterior al catálogo
     compartido: { guardadas, nuevas, actualizadas, descartadas, fallidas } */
  const [catalogo, setCatalogo] = useState(null);

  // State for Extracted Company Activity
  /* Texto que se muestra mientras no se haya extraído la actividad de los adjuntos. Es un
     aviso para la pantalla, no un dato: más abajo se evita que se guarde como si lo
     fuera, porque el apartado sectorial del informe se redacta con este campo. */
  const [actividad, setActividad] = useState(study.actividad_especifica || ACTIVIDAD_SIN_EXTRAER);
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
  /* Un estudio sin comparables arranca vacío. Antes arrancaba con cuatro empresas de
     videojuegos —Activision, Electronic Arts, Take-Two y Ubisoft— y cifras inventadas de
     ejemplo: en un sistema multiempresa eso significa que el estudio de cualquier
     contribuyente podía recibir la muestra de otro sector, y como el efecto de más abajo
     escribe `comparables` en el estudio, esas cuatro se guardaban y llegaban al rango
     intercuartil y al informe. Un hueco se ve; una muestra plausible y ajena, no. */
  const [comparables, setComparables] = useState(study.comparables || []);

  const [cmode, setCmode] = useState(study.cmode || 'all');
  /* Criterios de la hoja "Screen Criteria" del export de Capital IQ (SIC, tipo
     de compañía, ingresos, etc.), para reconstruir la Tabla 13 del informe con
     la corrida real de este año en vez de la del informe anterior. */
  const [criteriosScreening, setCriteriosScreening] = useState(study.criteriosScreening || []);
  const [loadingExcel, setLoadingExcel] = useState(false);
  const [loadingSelection, setLoadingSelection] = useState(false);
  /* El embudo se guarda con el estudio: la tabla de razones de rechazo del informe se
     arma con estos conteos, y si vivieran solo en memoria habría que volver a ejecutar
     la selección cada vez que se recarga para poder generar el Word. */
  const [selectionFunnel, setSelectionFunnel] = useState(study.embudoSeleccion || null);
  /* Estado visible de la carga de EEFF. `uploadingEEFF` y `eeffLog` ya existían
     pero nadie los leía en el JSX, así que al cargar un EEFF no se veía nada:
     ni que estaba trabajando, ni los hallazgos contables, ni los errores, que
     solo iban a la consola. */
  const [uploadingEEFF, setUploadingEEFF] = useState(false);
  /* No hay un `eeffLog` aparte: los hallazgos contables viven en la propia fila
     (comp.eeffHallazgos), que es lo que se guarda con el estudio. El estado
     paralelo que había antes duplicaba esa información, se perdía al recargar y
     tampoco se leía en ninguna parte. */
  /* Descripciones de actividad pendientes de redactar con IA: solo para el botón de
     backfill del Paso 4 — el disparo automático tras cargar un EEFF no usa este estado. */
  const [redactandoDescripciones, setRedactandoDescripciones] = useState(false);
  const [cargaEeff, setCargaEeff] = useState(null);          // { etapa, hechas, total }
  const [resultadoCarga, setResultadoCarga] = useState(null); // { aplicadas, rechazadas }
  /* Qué se subió al repositorio compartido de estados financieros tras una carga. */
  const [eeffCompartido, setEeffCompartido] = useState(null);
  /* Cifras que otro estudio del equipo ya cargó para estas mismas comparables:
     { buscando } | { propuestas: [...], anio } | { error } */
  const [eeffGuardados, setEeffGuardados] = useState(null);

  // Visibilidad de la importación de Capital IQ: progreso, diagnóstico y registro.
  const [importProgreso, setImportProgreso] = useState(null);
  const [importMeta, setImportMeta] = useState(null);
  const [importLog, setImportLog] = useState([]);

  // Curación por IA del universo: veredicto por identificador y su progreso.
  const [iaMatch, setIaMatch] = useState(study.iaMatch || null);
  const [curando, setCurando] = useState(false);
  const [curacionProgreso, setCuracionProgreso] = useState(null);
  /* Memoria de cálculo del rango intercuartil, abierta desde su tarjeta. */
  const [memoriaAbierta, setMemoriaAbierta] = useState(false);

  /* Detalle de candidatas rechazadas y en reserva de la última corrida del motor,
     para el Excel de soporte. Igual que `universo`, NO se persiste con el estudio:
     puede traer miles de filas y guardarlas revienta la cuota de localStorage. Se
     recalcula corriendo el motor otra vez. */
  const [motorAuditoria, setMotorAuditoria] = useState(null); // { rechazadas, reserva } | null

  useEffect(() => {
    updateStudy({
      /* El aviso de «no extraído» no se guarda: el apartado sectorial del informe se
         redacta con este campo, y con el aviso dentro el documento declararía como
         actividad del contribuyente un texto que es una instrucción para el analista.
         Vacío, las guardas del generador lo señalan como campo sin dato. */
      actividad_especifica: actividad === ACTIVIDAD_SIN_EXTRAER ? '' : actividad,
      estudioAnterior: estudioAnteriorInfo,
      motorConfig: engineConfig,
      /* universo NO se persiste: es el Excel de Capital IQ completo (miles de filas
         con descripción de negocio) y guardarlo en cada estudio hacía que el JSON
         superara la cuota de localStorage y tumbara toda la app (QuotaExceededError
         sin capturar). Se recalcula re-importando el Excel; lo que sí importa para
         el resto del estudio, `comparables`, sigue persistiendo igual que antes. */
      comparables,
      cmode,
      criteriosScreening,
      /* Conteos de la última selección: alimentan la tabla 14 del informe. */
      embudoSeleccion: selectionFunnel,
      /* el veredicto de la curación es la constancia de por qué se aceptó o rechazó
         cada candidata, y evita volver a pagar la consulta. Viaja con el estudio hasta
         App, que lo separa antes de subirlo: se guarda en localStorage y no en
         Firestore, por decisión del usuario y porque un dictamen por cada una de
         miles de candidatas no cabe cómodo en un documento */
      iaMatch
    });
  }, [actividad, estudioAnteriorInfo, engineConfig, universo, comparables, cmode, criteriosScreening, iaMatch, selectionFunnel]);

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
          anio: result.anio_gravable || null,
          comparables: result.comparables || []
        };
        setEstudioAnteriorInfo(info);
        setPriorStudyMsg(`✅ Informe leído con éxito. Extraída actividad y ${result.comparables.length} comparables de la tabla anterior.`);

        /* Las empresas del informe se llevan al catálogo compartido del equipo. Antes
           se quedaban dentro de este estudio y solo servían para reconocer
           continuidad aquí; ahora quedan disponibles para cualquier otro estudio y
           con el rastro del documento del que salieron.

           Si falla, el informe ya está leído y el estudio sigue su curso: guardar el
           catálogo es un extra, no un requisito para trabajar. */
        await registrarEnCatalogo(info, result);
      }
    } catch (err) {
      console.error("Error al leer informe del año anterior:", err);
      setPriorStudyMsg('⚠️ No se pudo procesar el informe .');
    } finally {
      setLoadingPriorStudy(false);
    }
  };

  /* Registra en `comparablesHistoricas` las empresas leídas del informe anterior. El
     año de la aparición es el que declara el propio informe; si no lo trae, se usa el
     del estudio menos uno, que es lo que significa «año anterior». */
  const registrarEnCatalogo = async (info, result) => {
    if (!usuario) { setCatalogo({ sinSesion: true }); return; }
    const comparables = (result && result.comparables) || [];
    if (!comparables.length) return;

    const anioEstudio = Number(study.anio) || new Date().getFullYear();
    const anio = Number(result.anio_gravable) || (anioEstudio - 1);
    setCatalogo({ enCurso: true });
    try {
      const resumen = await registrarComparablesHistoricas({
        comparables,
        aparicion: {
          estudioId: estudioId || '',
          clienteNit: String(study.nit || ''),
          anio,
          archivo: String(info.fuente || ''),
          cargadoEn: new Date().toISOString(),
        },
        usuario,
      });
      setCatalogo({ ...resumen, anio });
    } catch (err) {
      console.error('[catálogo histórico] no se pudo registrar', err);
      setCatalogo({ error: (err && err.message) || 'error desconocido' });
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

  /* Cura contra la actividad detectada las candidatas que ya pasaron los filtros
     duros del paso 2 —no el universo entero—: curar lo que el motor iba a descartar
     igual era casi la mitad del gasto en Gemini de cada corrida, y dejaba el panel de
     curación hablando de un conjunto distinto al del embudo.

     El veredicto se guarda por identificador y se persiste con el estudio: si el
     navegador se recarga, lo ya curado no se pierde, y al reejecutar solo se consulta
     lo que falte. Mientras corre, la selección del paso 3 queda bloqueada, porque
     ejecutarla a medias produciría un conjunto con criterios distintos según qué
     lotes hubieran terminado. */
  const curarUniverso = async (candidatas, { forzar = false } = {}) => {
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
        veredictoPrevio: forzar ? null : iaMatch,
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

  /* Cura solo lo que sobrevive a los filtros duros de la configuración actual. Es el
     único punto de entrada a la curación: así el paso 2 y el paso 3 juzgan siempre el
     mismo conjunto, que es lo que antes no ocurría. */
  const curarValidas = async ({ forzar = false } = {}) => {
    const { validas, rechazadas } = prefiltrar(universo, engineConfig);
    if (rechazadas.length) {
      anotar(`${rechazadas.length} de ${universo.length} quedan fuera por los filtros del paso 2 antes de curar; ` +
        `se consultan ${validas.length}.`);
    }
    if (!validas.length) {
      anotar('Los filtros del paso 2 no dejan ninguna candidata que curar. Amplíe los criterios.', 'aviso');
      return null;
    }
    return curarUniverso(validas, { forzar });
  };

  /* Cambiar un filtro invalida el embudo: describía la corrida anterior y se quedaba
     en pantalla como si describiera la configuración nueva —mostrando «6 de 6» con el
     objetivo ya puesto en 8—, que es parte de por qué los dos pasos parecían
     contradecirse. Se actualiza con la forma funcional para no perder cambios
     seguidos sobre dos selectores distintos. */
  const cambiarConfig = (campo, valor) => {
    setEngineConfig(prev => ({ ...prev, [campo]: valor }));
    setSelectionFunnel(null);
    setMotorAuditoria(null);
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
      setCriteriosScreening(meta.criteriosScreening || []);
      if (meta.criteriosScreening && meta.criteriosScreening.length) {
        anotar(`${meta.criteriosScreening.length} criterios de búsqueda leídos de la hoja "Screen Criteria" (Tabla 13 del informe)`, 'ok');
      } else {
        anotar('No se encontró la hoja "Screen Criteria" en el archivo: la Tabla 13 del informe quedará pendiente.', 'aviso');
      }
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

      /* La curación NO se dispara aquí. Corría sobre el universo recién importado,
         antes de que existieran los filtros del paso 2, así que por construcción no
         podía respetarlos: evaluaba miles de compañías que el motor descartaba
         después por holding, saldos negativos o pérdida operativa. Ahora la lanza el
         paso 3 sobre las que ya pasaron esos filtros, y sigue ocurriendo antes de
         puntuar —su veredicto es uno de los filtros del motor—, así que no se vuelve
         al problema de quedarse corto de comparables por curar al final.

         El veredicto se guarda por identificador: reejecutar el paso 3 con otros
         filtros solo consulta las candidatas que aún no tengan dictamen. */
      setIaMatch(null);
      setSelectionFunnel(null);
      setMotorAuditoria(null);
      anotar('Siguiente: defina los filtros del paso 2 y ejecute la selección del paso 3, que cura con IA lo que pase esos filtros.', 'ok');
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
         con holding, saldos negativos, pérdida operativa y rigor funcional. Si no se
         curó —sin actividad detectada o sin descripciones— el motor sigue con las
         palabras clave, no descarta a nadie por omisión.

         Se cura siempre aquí, pero `curarValidas` reutiliza por identificador lo ya
         dictaminado para esta misma actividad: reejecutar tras cambiar un filtro no
         vuelve a pagar el universo, solo consulta las candidatas que quedaron sin
         veredicto porque el filtro anterior las excluía. */
      let veredicto = iaMatch;
      if (String(actividad || '').trim()) {
        veredicto = (await curarValidas()) || veredicto;
      }

      const result = scoreCandidates(universo, engineConfig, actividad, priorComps, {
        ventasParteExaminada: study.t_s,
        iaMatch: veredicto,
      });

      /* Conteos del propio motor, no deducidos del texto del motivo: antes esto era
         una expresión regular sobre `motivoRechazo` y el embudo mezclaba etapas. */
      const cat = result.rechazadasPorCategoria;
      anotar(`${result.totalValidas} pasaron todos los criterios; ${result.rechazadas.length} descartadas ` +
        `(${cat.filtro} por los filtros del paso 2, ${cat.ia} por la curación con IA, ${cat.rigor} por el rigor funcional)`);
      if (!result.ventasParteExaminada) {
        anotar('Sin ventas de la parte examinada: el factor de tamaño queda neutro. Diligéncielas en la tarjeta de cifras.', 'aviso');
      }
      if (!result.conActividad) {
        anotar('Sin actividad detectada: la especialidad pesa 15 % en lugar de 40 %.', 'aviso');
      }

      const nTarget = engineConfig.nTarget || 12;
      const finales = result.seleccionadas;
      setComparables(finales);
      /* Detalle por candidata para el Excel de soporte: `scoreCandidates` ya lo
         calcula (motivo, categoría, score, factores), pero hasta ahora solo se
         guardaban los conteos agregados en el embudo y este detalle se perdía. */
      setMotorAuditoria({ rechazadas: result.rechazadas, reserva: result.reserva });
      setSelectionFunnel({
        evaluadas: result.evaluadas,
        validas: result.totalValidas,
        /* Desglose por criterio, para la tabla de razones de rechazo del informe. */
        porMotivo: result.rechazadasPorMotivo,
        rechazadasFiltros: cat.filtro,
        curadas: veredicto ? veredicto.total : 0,
        reutilizadas: veredicto ? (veredicto.reutilizadas || 0) : 0,
        rechazadasIA: cat.ia,
        rechazadasRigor: cat.rigor,
        rigor: engineConfig.rigor,
        seleccionadas: finales.length,
        objetivo: nTarget,
        reserva: result.reserva.length,
      });

      /* Se dice de qué está compuesta la muestra: el número que el usuario pide es el
         tamaño final, y las de continuidad ocupan parte de ese cupo. */
      const deContinuidad = result.continuidad || 0;
      const composicion = deContinuidad
        ? ` (${deContinuidad} del estudio anterior + ${finales.length - deContinuidad} nuevas)`
        : '';

      if (result.continuidadExcedeObjetivo) {
        anotar(`El estudio anterior aporta ${deContinuidad} comparables, más que las ${nTarget} pedidas: ` +
          'no se descarta ninguna, porque retirar una comparable ya aceptada hay que justificarlo en el informe. ' +
          'Suba el N objetivo o revise la matriz del año anterior.', 'aviso');
      } else if (finales.length < nTarget) {
        anotar(`Solo ${finales.length} de las ${nTarget} buscadas${composicion}: no quedan más candidatas válidas. ` +
          'Amplíe los criterios del paso 2.', 'aviso');
      } else {
        anotar(`${finales.length} comparables seleccionadas${composicion} · ${result.reserva.length} en reserva`, 'ok');
      }
    } catch (err) {
      console.error("Error ejecutando selección del motor:", err);
      anotar(err && err.message ? err.message : 'Falló la selección.', 'error');
    } finally {
      setLoadingSelection(false);
    }
  };

  /* Vuelca en una fila las cifras leídas de un documento. Devuelve el arreglo
     nuevo; no toca el estado, para poder aplicar varias de una sola vez. */
  const aplicarEeffEnFila = (filas, indice, datos, verificacion, archivo, cruce) => {
    const copia = [...filas];
    copia[indice] = {
      ...copia[indice],
      s: datos.ingresos_operacionales || copia[indice].s,
      c: datos.costo_ventas || copia[indice].c,
      op: datos.utilidad_operacional || copia[indice].op,
      ar: datos.cuentas_por_cobrar || copia[indice].ar,
      inv: datos.inventarios || copia[indice].inv,
      ap: datos.cuentas_por_pagar || copia[indice].ap,
      eeffDatos: datos,
      eeffVerificado: verificacion.esValido,
      eeffHallazgos: verificacion.hallazgos,
      eeffArchivo: archivo,
      /* Se guarda cómo cruzó: un cruce por solapamiento de palabras hay que
         confirmarlo a ojo, y sin dejar rastro nadie lo haría. */
      eeffCruce: cruce ? { modo: cruce.modo, punt: cruce.punt, nombreLeido: datos.nombre || '' } : null,
      eeffPorConfirmar: cruce ? !esCruceFirme(cruce) : false,
    };
    return copia;
  };

  /* Redacta con IA la descripción de actividad de las filas indicadas que tengan `desc`
     crudo y no tengan `descActividad` todavía. Es idempotente: si ya está redactada, no
     se repite la llamada. Usa el actualizador de `setComparables` para no pisar cambios
     de estado hechos mientras la llamada a la IA estaba en curso. */
  const redactarDescripcionesDeFilas = async (filasActuales, indices) => {
    const objetivos = [...new Set(indices)]
      .map((i) => ({ indice: i, fila: filasActuales[i] }))
      .filter(({ fila }) => fila && String(fila.desc || '').trim() && !fila.descActividad);
    if (!objetivos.length) return;

    const resultados = await redactarDescripcionesEnLote(
      objetivos.map(({ fila }) => ({ nombre: fila.name, descCruda: fila.desc }))
    );

    setComparables((prev) => {
      const copia = [...prev];
      objetivos.forEach(({ indice }, pos) => {
        if (resultados[pos] && copia[indice]) {
          copia[indice] = { ...copia[indice], descActividad: resultados[pos] };
        }
      });
      return copia;
    });
  };

  const redactarDescripcionesPendientes = async () => {
    setRedactandoDescripciones(true);
    try {
      const indices = comparables
        .map((c, i) => (c.eeffArchivo && String(c.desc || '').trim() && !c.descActividad ? i : -1))
        .filter((i) => i >= 0);
      await redactarDescripcionesDeFilas(comparables, indices);
    } finally {
      setRedactandoDescripciones(false);
    }
  };

  /* Sube al repositorio compartido las cifras que acaban de entrar en unas filas.
     Así el mismo estado financiero no se vuelve a leer —ni a pagar— cuando esa
     comparable reaparece en el estudio de otro año o de otro cliente.

     Es deliberadamente un extra: si falla, la carga que el usuario acaba de hacer
     sigue aplicada en su estudio y solo se avisa de que no se compartió. */
  const publicarEeff = async (filas, indices) => {
    if (!usuario) return;
    const seleccion = [...new Set(indices)].map(i => filas[i]).filter(Boolean);
    if (!seleccion.length) return;
    try {
      const resumen = await guardarEeffComparables({ comparables: seleccion, anio: study.anio, usuario });
      setEeffCompartido({ ...resumen, anio: Number(study.anio) || null });
    } catch (err) {
      console.error('[EEFF compartidos] no se pudieron subir', err);
      setEeffCompartido({ error: (err && err.message) || 'error desconocido' });
    }
  };

  /* Busca en la base compartida cifras ya cargadas para las comparables de este
     estudio. Solo propone las filas que están vacías: una cifra puesta aquí puede
     venir de un documento más reciente o de una corrección a mano. */
  const buscarEeffGuardados = async () => {
    if (!usuario) { setEeffGuardados({ error: 'Sin sesión activa.' }); return; }
    const anio = Number(study.anio) || null;
    if (!anio) { setEeffGuardados({ error: 'El estudio no tiene año gravable definido.' }); return; }
    setEeffGuardados({ buscando: true });
    try {
      const claves = comparables.map(c => c.nameKey || nameKey(c.name || '')).filter(Boolean);
      const guardados = await leerEeffDeComparables(claves, anio, usuario);
      setEeffGuardados({ propuestas: comparablesConEeffReutilizable(comparables, guardados), anio });
    } catch (err) {
      console.error('[EEFF compartidos] no se pudo consultar', err);
      setEeffGuardados({ error: (err && err.message) || 'error desconocido' });
    }
  };

  /* Vuelca las cifras propuestas. Quedan marcadas por confirmar a propósito: no se
     leyeron en este estudio y quien firma el informe tiene que darlas por buenas. */
  const aplicarEeffGuardados = () => {
    const propuestas = (eeffGuardados && eeffGuardados.propuestas) || [];
    if (!propuestas.length) return;
    let filas = comparables;
    propuestas.forEach(p => { filas = aplicarEeffGuardadoEnFila(filas, p.indice, p.doc); });
    setComparables(filas);
    setEeffGuardados({ aplicadas: propuestas.length, anio: eeffGuardados.anio });
  };

  /* Trae del catálogo compartido las comparables que el equipo usó el año anterior y
     las toma como referencia de continuidad. Sirve cuando no se tiene a mano el
     informe del año pasado: hasta ahora la continuidad dependía de cargar ese PDF. */
  const traerContinuidadDelCatalogo = async () => {
    if (!usuario) { setCatalogo({ sinSesion: true }); return; }
    const anioEstudio = Number(study.anio) || new Date().getFullYear();
    const anio = anioEstudio - 1;
    setCatalogo({ enCurso: true });
    try {
      const items = await comparablesHistoricasDelAnio(anio, usuario);
      if (!items.length) {
        setCatalogo({ traidas: 0, anio });
        return;
      }
      setEstudioAnteriorInfo({
        fuente: `catálogo compartido (año ${anio})`,
        actividad,
        anio,
        comparables: catalogoAComparablesPrevias(items),
      });
      setCatalogo({ traidas: items.length, anio });
    } catch (err) {
      console.error('[catálogo histórico] no se pudo consultar', err);
      setCatalogo({ error: (err && err.message) || 'error desconocido' });
    }
  };

  /* Carga de EEFF sobre una fila concreta. Ahora comprueba que el documento sea
     de esa empresa: antes las cifras entraban en la fila donde se soltaba el
     archivo, fuera o no la correcta, y de ahí pasaban al rango intercuartil. */
  const handleComparableEEFFUpload = async (compIndex, file) => {
    if (!file) return;
    setUploadingEEFF(true);
    setCargaEeff({ etapa: 'Leyendo ' + file.name + '…', hechas: 0, total: 1 });
    setResultadoCarga(null);
    try {
      const studyYear = study.anio || 2025;
      const result = await parseEEFFComparableOCR(file, studyYear);
      if (!result || !result.data) throw new Error('El documento no devolvió cifras legibles.');

      const destino = comparables[compIndex];
      const cruce = cruzar(result.data, file.name, comparables);

      /* Cruzó con OTRA fila, o no cruzó con ninguna: no se aplica nada y se
         explica por qué. Si el documento no trae razón social no hay nada que
         contrastar, así que se acepta pero queda marcado por confirmar. */
      const traeNombre = String(result.data.nombre || '').trim() || String(result.data.identificador_fuente || '').trim();
      if (traeNombre && cruce.indice !== compIndex) {
        setResultadoCarga({
          aplicadas: [],
          rechazadas: [{
            archivo: file.name,
            datos: result.data,
            motivo: motivoRechazoEnFila(result.data, destino, file.name),
          }],
        });
        return;
      }

      const cruceEfectivo = traeNombre
        ? cruce
        : { modo: 'manual', punt: 1, comparable: destino, indice: compIndex };
      const filas = aplicarEeffEnFila(comparables, compIndex, result.data, result.verificacion, result.filename, cruceEfectivo);
      setComparables(filas);
      /* Al repositorio compartido, para que otro estudio no vuelva a leer este mismo
         documento. Va después de aplicar: lo del usuario primero. */
      await publicarEeff(filas, [compIndex]);
      redactarDescripcionesDeFilas(filas, [compIndex]).catch((err) =>
        console.error('[MotorComparables] no se pudo redactar la descripción de actividad', err)
      );
      setResultadoCarga({
        aplicadas: [{
          archivo: file.name,
          datos: result.data,
          motivo: traeNombre
            ? motivoCruce(cruce, result.data, file.name)
            : 'El documento no trae razón social, así que se aplicó a «' + destino.name +
            '» sin poder verificar que le corresponde: confírmalo.',
          firme: traeNombre && esCruceFirme(cruce),
          verificacion: result.verificacion,
        }],
        rechazadas: [],
      });
    } catch (err) {
      console.error('Error al procesar EEFF de comparable:', err);
      setResultadoCarga({
        aplicadas: [],
        rechazadas: [{ archivo: file.name, motivo: 'No se pudo leer el documento: ' + (err?.message || err) }],
      });
    } finally {
      setUploadingEEFF(false);
      setCargaEeff(null);
    }
  };

  /* Carga masiva: uno o varios archivos, y cada archivo puede traer los EEFF de
     varias comparables. Se lee todo, se reparte por cruce de razón social y se
     informa qué entró, con qué confianza, y qué se rechazó y por qué. */
  const handleCargaMasivaEEFF = async (files) => {
    const lista = Array.from(files || []);
    if (!lista.length) return;

    setUploadingEEFF(true);
    setResultadoCarga(null);
    const entradas = [];
    const fallosLectura = [];

    try {
      const studyYear = study.anio || 2025;
      for (let i = 0; i < lista.length; i++) {
        const file = lista[i];
        setCargaEeff({ etapa: 'Leyendo ' + file.name + '…', hechas: i, total: lista.length });
        try {
          const leidas = await parseEEFFComparablesLote(file, studyYear);
          if (!leidas.length) {
            fallosLectura.push({
              archivo: file.name,
              motivo: 'No se pudo identificar ninguna empresa con razón social en el documento. ' +
                'Si es el estado financiero de una sola comparable, cárgalo desde su fila.',
            });
          }
          entradas.push(...leidas);
        } catch (err) {
          fallosLectura.push({ archivo: file.name, motivo: 'No se pudo leer: ' + (err?.message || err) });
        }
      }

      setCargaEeff({ etapa: 'Cruzando ' + entradas.length + ' empresa(s) con las comparables…', hechas: lista.length, total: lista.length });
      const { aplicadas, rechazadas } = repartir(entradas, comparables);

      /* Se acumulan todas las filas antes de un único setComparables: un set por
         empresa se sobrescribiría entre iteraciones y solo entraría la última. */
      let filas = comparables;
      aplicadas.forEach((a) => {
        filas = aplicarEeffEnFila(filas, a.indice, a.datos, a.verificacion, a.archivo, a.cruce);
      });
      if (aplicadas.length) {
        setComparables(filas);
        await publicarEeff(filas, aplicadas.map(a => a.indice));
        redactarDescripcionesDeFilas(filas, aplicadas.map((a) => a.indice)).catch((err) =>
          console.error('[MotorComparables] no se pudo redactar la descripción de actividad', err)
        );
      }
      setResultadoCarga({ aplicadas, rechazadas: [...rechazadas, ...fallosLectura] });
    } finally {
      setUploadingEEFF(false);
      setCargaEeff(null);
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

  // Ingreso/gasto de una operación no controlada (ej. proyecto CoCrea) ajeno a la
  // vinculada: se resta de s y op para que el margen no se calcule sobre cifras mezcladas.
  const segExcluido = num(study.seg_excluido) || 0;
  const tsNum = num(study.t_s);
  const tOpNum = num(study.t_op);

  const T = {
    s: tsNum !== null ? tsNum - segExcluido : null,
    c: num(study.t_c),
    op: tOpNum !== null ? tOpNum - segExcluido : null,
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
      adj,
      ratiosComp: cR,
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

  /* Excel de soporte del motor: documenta filtros, comparables (seleccionadas,
     rechazadas y en reserva), el rango intercuartil y el desglose del ajuste de
     capital de trabajo. Solo arma lo que ya está calculado en este componente. */
  const handleExportarExcel = () => {
    if (!comparables.length) {
      alert('No hay comparables cargadas: importe o agregue al menos una antes de exportar el Excel de soporte.');
      return;
    }

    const seleccionadasKeys = new Set((calculatedRows || comparables).map(c => c.nameKey || nameKey(c.name)));
    const candidatasUniverso = Array.isArray(universo) && universo.length > 0
      ? universo.map(cand => ({
          ...cand,
          seleccionada: seleccionadasKeys.has(cand.nameKey || nameKey(cand.name))
        }))
      : null;

    const datos = {
      estudio: { entidad: study.ent || '', anio: study.anio || '', pli: kind, useAdj, interestRate },
      examinada: { T, tPLI, tR },
      rango: { stats, activeCount: activeSeries.length, adjustment },
      filtros: { engineConfig, selectionFunnel },
      comparables: calculatedRows,
      auditoria: motorAuditoria,
      seleccion: {
        criterios: criteriosScreening || [],
        candidatas: candidatasUniverso
      }
    };
    const entidadSlug = String(datos.estudio.entidad || 'estudio')
      .trim().toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'estudio';
    exportarSoporteMotor(datos, `Soporte_Motor_Comparables_${entidadSlug}_${datos.estudio.anio || 's-f'}.xlsx`);
  };

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
          {/* Continuidad sin tener el PDF a mano: si el equipo ya cargó el informe del
              año anterior en otro estudio, sus comparables están en el catálogo. */}
          <button
            type="button"
            onClick={traerContinuidadDelCatalogo}
            disabled={loadingPriorStudy}
            className="flex items-center gap-2 text-xs font-semibold px-3 py-2.5 rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50"
            title="Toma como referencia de continuidad las comparables que el equipo ya registró para el año anterior"
          >
            <Layers className="w-4 h-4" />
            Traer del catálogo del año anterior
          </button>

          {priorStudyMsg && (
            <span className="text-xs font-medium text-[#0FA3A1] bg-[#0FA3A1]/10 px-3 py-1.5 rounded-lg">
              {priorStudyMsg}
            </span>
          )}
        </div>

        {/* Qué pasó con esas empresas en el catálogo compartido. Se informa aparte del
            mensaje de lectura porque son dos cosas distintas: una es haber entendido
            el documento y otra haber dejado registro reutilizable de sus comparables. */}
        {catalogo && (
          <div className="text-[11px] bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800 rounded-lg p-3 space-y-1">
            <div className="font-semibold text-zinc-700 dark:text-zinc-200">Catálogo histórico compartido</div>
            {catalogo.enCurso && <div className="text-zinc-500">Consultando el catálogo compartido…</div>}
            {typeof catalogo.traidas === 'number' && (
              catalogo.traidas
                ? <div className="text-zinc-600 dark:text-zinc-300">
                  {catalogo.traidas} comparables del año {catalogo.anio} traídas del catálogo como referencia de continuidad.
                  El motor las tratará como del estudio anterior.
                </div>
                : <div className="text-amber-600 dark:text-amber-400">
                  El catálogo no tiene comparables registradas del año {catalogo.anio}. Cargue la documentación
                  comprobatoria de ese año para alimentarlo.
                </div>
            )}
            {catalogo.sinSesion && (
              <div className="text-amber-600 dark:text-amber-400">
                Sin sesión activa: las empresas no se guardaron en el catálogo. Vuelva a entrar y cargue el informe otra vez.
              </div>
            )}
            {catalogo.error && (
              <div className="text-amber-600 dark:text-amber-400">
                No se pudo guardar en el catálogo: {catalogo.error}. El informe sí quedó leído y el estudio puede continuar.
              </div>
            )}
            {typeof catalogo.guardadas === 'number' && (
              <>
                <div className="text-zinc-600 dark:text-zinc-300">
                  {catalogo.guardadas} empresas registradas del año {catalogo.anio}
                  {catalogo.nuevas ? ` · ${catalogo.nuevas} nuevas en el catálogo` : ''}
                  {catalogo.actualizadas ? ` · ${catalogo.actualizadas} ya estaban y se completaron` : ''}
                </div>
                {catalogo.descartadas ? (
                  <div className="text-amber-600 dark:text-amber-400">
                    {catalogo.descartadas} filas se descartaron por no traer razón social legible.
                  </div>
                ) : null}
                {catalogo.fallidas ? (
                  <div className="text-amber-600 dark:text-amber-400">
                    {catalogo.fallidas} no se pudieron guardar; revise la consola para el detalle.
                  </div>
                ) : null}
              </>
            )}
          </div>
        )}
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
                /* el embudo describía una corrida contra la actividad anterior */
                onClick={() => { setActividad(actInput); setEditingAct(false); setSelectionFunnel(null); setMotorAuditoria(null); }}
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

          {/* Curación por IA: la dispara el paso 3 sobre las candidatas que pasaron los
              filtros del paso 2, antes de puntuar, porque su veredicto es uno de los
              filtros del motor. Son varios lotes y varios minutos, así que hay que
              decir cuánto falta. */}
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
                <span className="font-semibold">Candidatas curadas con IA</span>
                <span className="text-zinc-500">
                  · {iaMatch.coinciden} de {iaMatch.total} coinciden con la actividad
                  {iaMatch.reutilizadas ? ` · ${iaMatch.reutilizadas} reutilizadas de una corrida anterior` : ''}
                  {iaMatch.fallidas ? ` · ${iaMatch.fallidas} sin evaluar` : ''}
                </span>
                <button
                  type="button"
                  onClick={() => curarValidas({ forzar: true })}
                  disabled={curando || !universo.length}
                  className="ml-auto text-[10.5px] px-2 py-0.5 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                  title="Descarta el veredicto guardado y vuelve a curar desde cero las candidatas que pasan los filtros del paso 2"
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

          {/* Decir en qué orden se aplican: el reclamo era que la curación y los
              filtros parecían juzgar conjuntos distintos, y así era. */}
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 -mt-1">
            Holding, saldos negativos y pérdidas operativas se aplican <b>antes</b> de curar con IA, así que
            la curación solo evalúa —y solo se paga por— lo que pasa estos filtros. El rigor funcional se
            aplica <b>después</b>, sobre el perfil que dictamina la propia curación.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="flex flex-col">
              <label className="text-[11px] font-semibold text-zinc-500 mb-1">N Objetivo (Tope 30)</label>
              <input
                type="number"
                min="4"
                max="30"
                value={engineConfig.nTarget}
                onChange={(e) => cambiarConfig('nTarget', Number(e.target.value))}
                className="bg-[#ffffff] dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-950 dark:text-zinc-100 focus:outline-none"
              />
            </div>

            <div className="flex flex-col">
              <label className="text-[11px] font-semibold text-zinc-500 mb-1">Pérdidas Operativas</label>
              <select
                value={engineConfig.perdidaOp}
                onChange={(e) => cambiarConfig('perdidaOp', e.target.value)}
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
                onChange={(e) => cambiarConfig('holding', e.target.value)}
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
                onChange={(e) => cambiarConfig('saldoNegativo', e.target.value)}
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
                onChange={(e) => cambiarConfig('geo', e.target.value)}
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
                onChange={(e) => cambiarConfig('rigor', e.target.value)}
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
                {curando ? 'Curando las candidatas con IA…'
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
              {/* En orden de embudo: cada etapa cuenta solo lo que ella descartó, y las
                  tres cifras de rechazo más las válidas suman el universo. Antes
                  «rechazadas por la IA» se deducía con una expresión regular sobre el
                  motivo y «descartadas por los filtros» se calculaba por resta, así que
                  un descarte cabía en las dos casillas o en ninguna. */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-1 text-zinc-600 dark:text-zinc-300">
                <div>Universo evaluado <b className="tabular-nums">{selectionFunnel.evaluadas.toLocaleString('es-CO')}</b></div>
                <div>Descartadas por los filtros <b className="tabular-nums text-amber-600 dark:text-amber-400">{(selectionFunnel.rechazadasFiltros ?? 0).toLocaleString('es-CO')}</b></div>
                <div>
                  Curadas con IA <b className="tabular-nums">{(selectionFunnel.curadas ?? 0).toLocaleString('es-CO')}</b>
                  {selectionFunnel.reutilizadas ? (
                    <span className="text-zinc-400"> ({selectionFunnel.reutilizadas.toLocaleString('es-CO')} reutilizadas)</span>
                  ) : null}
                </div>
                <div>Rechazadas por la IA <b className={'tabular-nums ' + ((selectionFunnel.rechazadasIA ?? 0) > 0 ? 'text-amber-600 dark:text-amber-400' : '')}>{(selectionFunnel.rechazadasIA ?? 0).toLocaleString('es-CO')}</b></div>
                <div>
                  Rechazadas por el rigor{' '}
                  <b className={'tabular-nums ' + ((selectionFunnel.rechazadasRigor ?? 0) > 0 ? 'text-amber-600 dark:text-amber-400' : '')}>
                    {(selectionFunnel.rechazadasRigor ?? 0).toLocaleString('es-CO')}
                  </b>
                  {selectionFunnel.rigor ? <span className="text-zinc-400"> ({selectionFunnel.rigor})</span> : null}
                </div>
                <div>Válidas <b className="tabular-nums">{selectionFunnel.validas.toLocaleString('es-CO')}</b></div>
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
            Cargue un solo PDF con los estados financieros de todas las comparables y el sistema los reparte por razón social,
            o cárguelos uno por uno desde su fila. En ambos casos se comprueba a qué empresa pertenece cada documento antes de
            incorporar las cifras, y se verifican las identidades contables.
          </p>

          {/* Carga masiva: varios archivos, y cada archivo puede traer varias empresas */}
          <label className={`flex items-center justify-center gap-2 border-2 border-dashed rounded-xl px-4 py-5 text-xs font-semibold transition-colors ${uploadingEEFF
            ? 'border-zinc-200 dark:border-zinc-800 text-zinc-400 cursor-not-allowed'
            : 'border-[#0FA3A1]/40 text-[#0B7C7A] dark:text-[#0FA3A1] hover:bg-[#0FA3A1]/5 cursor-pointer'
            }`}>
            {uploadingEEFF ? <RefreshCw className="w-4 h-4 animate-spin" /> : <FileUp className="w-4 h-4" />}
            <span>
              {uploadingEEFF
                ? 'Procesando…'
                : 'Cargar EEFF de todas las comparables (uno o varios PDF)'}
            </span>
            <input
              type="file"
              accept="application/pdf,image/*"
              multiple
              disabled={uploadingEEFF}
              className="hidden"
              onChange={(e) => { handleCargaMasivaEEFF(e.target.files); e.target.value = null; }}
            />
          </label>

          {/* Reutilización de cifras que otro estudio del equipo ya cargó. Es lo que
              evita volver a leer —y volver a pagar— el mismo estado financiero cuando
              una comparable reaparece en otro estudio del mismo año gravable. */}
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={buscarEeffGuardados}
              disabled={uploadingEEFF || !comparables.length || (eeffGuardados && eeffGuardados.buscando)}
              className="flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Consulta en la base compartida si alguna de estas comparables ya tiene cifras cargadas para el mismo año"
            >
              <Layers className="w-4 h-4" />
              {eeffGuardados && eeffGuardados.buscando ? 'Consultando la base…' : 'Buscar cifras ya cargadas por el equipo'}
            </button>

            {eeffGuardados && eeffGuardados.error && (
              <span className="text-[11px] text-amber-600 dark:text-amber-400">{eeffGuardados.error}</span>
            )}

            {eeffGuardados && typeof eeffGuardados.aplicadas === 'number' && (
              <span className="text-[11px] text-emerald-600 dark:text-emerald-500">
                {eeffGuardados.aplicadas} fila(s) completadas con cifras del año {eeffGuardados.anio}. Quedan marcadas por confirmar.
              </span>
            )}

            {eeffGuardados && eeffGuardados.propuestas && (
              eeffGuardados.propuestas.length ? (
                <>
                  <span className="text-[11px] text-zinc-600 dark:text-zinc-300">
                    {eeffGuardados.propuestas.length} de {comparables.length} tienen cifras del año {eeffGuardados.anio} guardadas
                    por otro estudio: {eeffGuardados.propuestas.map(p => p.nombre).join(', ')}
                  </span>
                  <button
                    type="button"
                    onClick={aplicarEeffGuardados}
                    className="text-[11px] font-bold px-3 py-1.5 rounded-lg bg-[#0FA3A1] hover:bg-[#0B7C7A] text-white"
                  >
                    Aplicarlas a las filas vacías
                  </button>
                </>
              ) : (
                <span className="text-[11px] text-zinc-500">
                  Ninguna comparable con la fila vacía tiene cifras guardadas del año {eeffGuardados.anio}.
                </span>
              )
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={redactarDescripcionesPendientes}
              disabled={redactandoDescripciones || !comparables.some((c) => c.eeffArchivo && String(c.desc || '').trim() && !c.descActividad)}
              className="flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Redacta en español, con IA, la descripción de actividad de las comparables con EEFF cargado que todavía no la tienen"
            >
              <Sparkles className="w-4 h-4" />
              {redactandoDescripciones ? 'Redactando…' : 'Redactar descripciones pendientes'}
            </button>
          </div>

          {/* Qué se subió a la base tras una carga */}
          {eeffCompartido && (
            <div className="text-[11px] text-zinc-600 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-900/60 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2">
              {eeffCompartido.error
                ? <span className="text-amber-600 dark:text-amber-400">
                  Las cifras quedaron en el estudio, pero no se pudieron guardar para reutilizarlas: {eeffCompartido.error}
                </span>
                : <>
                  {eeffCompartido.guardadas} estado(s) financiero(s) disponibles ahora para sus otros estudios
                  {eeffCompartido.anio ? ` (año ${eeffCompartido.anio})` : ''}
                  {eeffCompartido.omitidas ? ` · ${eeffCompartido.omitidas} sin ingresos, no se compartieron` : ''}
                  {eeffCompartido.fallidas ? ` · ${eeffCompartido.fallidas} fallaron` : ''}
                </>}
            </div>
          )}

          {/* Progreso: qué archivo va y cuántos faltan */}
          {cargaEeff && (
            <div className="bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-200 dark:border-zinc-800 rounded-lg px-4 py-3">
              <div className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300">
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#0FA3A1]" />
                <span>{cargaEeff.etapa}</span>
                {cargaEeff.total > 1 && (
                  <span className="ml-auto font-mono text-[11px] text-zinc-500">
                    {cargaEeff.hechas}/{cargaEeff.total}
                  </span>
                )}
              </div>
              {cargaEeff.total > 1 && (
                <div className="mt-2 h-1 bg-zinc-200 dark:bg-zinc-800 rounded overflow-hidden">
                  <div
                    className="h-full bg-[#0FA3A1] transition-all"
                    style={{ width: Math.round((cargaEeff.hechas / cargaEeff.total) * 100) + '%' }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Resultado: qué entró, con qué confianza, y qué se rechazó y por qué */}
          {resultadoCarga && (
            <div className="space-y-2">
              {resultadoCarga.aplicadas.map((a, i) => (
                <div
                  key={'ok' + i}
                  className={`rounded-lg px-4 py-3 text-xs border ${a.firme
                    ? 'bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-300'
                    : 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-300'
                    }`}
                >
                  <div className="flex items-start gap-2">
                    {a.firme ? <CheckCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />}
                    <div>
                      <div className="font-semibold">{a.archivo}</div>
                      <div className="mt-0.5 leading-relaxed">{a.motivo}</div>
                      {a.verificacion && a.verificacion.hallazgos && a.verificacion.hallazgos.length > 0 && (
                        <ul className="mt-1.5 space-y-0.5 list-disc list-inside">
                          {a.verificacion.hallazgos.map((h, j) => <li key={j}>{h}</li>)}
                        </ul>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              {resultadoCarga.rechazadas.map((r, i) => (
                <div
                  key={'no' + i}
                  className="rounded-lg px-4 py-3 text-xs border bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900 text-red-800 dark:text-red-300"
                >
                  <div className="flex items-start gap-2">
                    <ShieldAlert className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                    <div>
                      <div className="font-semibold">Rechazado: {r.archivo}</div>
                      <div className="mt-0.5 leading-relaxed">{r.motivo}</div>
                    </div>
                  </div>
                </div>
              ))}

              {!resultadoCarga.aplicadas.length && !resultadoCarga.rechazadas.length && (
                <div className="text-xs text-zinc-500">No se encontró ningún estado financiero en los documentos.</div>
              )}
            </div>
          )}

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
                      {/* Los hallazgos contables ya se calculaban y se guardaban en
                          eeffLog, pero no se mostraban en ninguna parte. */}
                      {comp.eeffHallazgos && comp.eeffHallazgos.length > 0 && (
                        <ul className="mt-1 space-y-0.5 text-[10px] text-amber-700 dark:text-amber-400 list-disc list-inside">
                          {comp.eeffHallazgos.map((h, j) => <li key={j}>{h}</li>)}
                        </ul>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-zinc-500 text-[11px]">
                      {comp.eeffArchivo || '—'}
                      {/* Un cruce por solapamiento de palabras hay que confirmarlo:
                          se deja a la vista el nombre que se leyó y el porcentaje. */}
                      {comp.eeffPorConfirmar && comp.eeffCruce && (
                        <div className="mt-1 text-[10px] text-amber-700 dark:text-amber-400">
                          Por confirmar: se leyó «{comp.eeffCruce.nombreLeido || '(sin razón social)'}»
                          {comp.eeffCruce.modo === 'manual'
                            ? ' y el documento no permitía verificarlo'
                            : ' · ' + Math.round((comp.eeffCruce.punt || 0) * 100) + '% de coincidencia'}
                        </div>
                      )}
                    </td>
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
        {/* La tarjeta abre la memoria de cálculo: este es el número que decide el
            cumplimiento, y hasta ahora no había forma de ver de dónde salía. */}
        <button
          type="button"
          onClick={() => setMemoriaAbierta(true)}
          title="Ver cómo se calculó este rango y descargarlo en Excel"
          className="text-left bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm hover:border-[#0FA3A1] focus:outline-none focus:ring-1 focus:ring-[#0FA3A1]/50 transition-colors"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Rango Intercuartil</span>
            <Calculator className="w-4 h-4 text-[#0FA3A1]" />
          </div>
          <div className="mt-2">
            <span className="text-xl font-bold tracking-tight">
              {stats ? `${pctf(stats.p25)} - ${pctf(stats.p75)}` : 'N/A'}
            </span>
            <span className="text-xs text-zinc-500 block mt-1">Mediana: {stats ? pctf(stats.med) : '—'}</span>
            <span className="text-[10.5px] text-[#0B7C7A] dark:text-[#0FA3A1] block mt-1.5 font-medium">
              Ver memoria de cálculo →
            </span>
          </div>
        </button>

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

      {/* `comparables` y `cmode` van del estado local y no de `study`: el efecto que los
          persiste corre después del render, y la memoria tiene que explicar el rango que
          se está viendo en la tarjeta, no el del render anterior. */}
      {memoriaAbierta && (
        <MemoriaRangoModal
          estudio={{ ...study, comparables, cmode, universo, criteriosScreening }}
          alCerrar={() => setMemoriaAbierta(false)}
        />
      )}

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

      {/* ══════ EXPORTAR EXCEL DE SOPORTE DEL MOTOR ══════ */}
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleExportarExcel}
          disabled={!comparables.length}
          className="flex items-center gap-2 bg-[#0FA3A1] hover:bg-[#0B7C7A] disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg px-5 py-2.5 text-xs font-bold transition-colors shadow-sm cursor-pointer"
          title="Genera un Excel con los filtros aplicados, las comparables (seleccionadas, rechazadas y en reserva), el rango intercuartil y el desglose del ajuste de capital de trabajo"
        >
          <FileSpreadsheet className="w-4 h-4" />
          Exportar Excel de Soporte del Motor
        </button>
      </div>
    </div>
  );
}
