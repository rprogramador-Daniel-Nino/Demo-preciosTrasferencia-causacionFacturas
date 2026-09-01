import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Plus, Trash2, ShieldCheck, ShieldAlert, Sparkles, Filter, Calculator,
  Upload, FileText, CheckCircle, AlertTriangle, RefreshCw, Edit3, FileCheck, Layers, FileUp, BookOpen, FileSpreadsheet, Lightbulb, Search, ChevronDown, ChevronRight, Ban, Clock
} from 'lucide-react';
import { num, pliOf, ratios, pctf, fmt, adjustInfo } from '../utils/calculations';
import { analizarRango } from '../services/rangoIntercuartil';
import { diagnosticarCumplimiento } from '../services/diagnosticoRango';
import { previsualizarFiltros } from '../services/previsualizarFiltros';
import { redactarJustificacionPerdidas } from '../services/justificacionPerdidasIA';
import { importCapitalIQExcel, scoreCandidates, curateCandidatesWithGemini, prefiltrar, nameKey, enriquecerUniverso, MINIMO_COMPARABLES } from '../services/comparablesEngine';
import { exportarSoporteMotor, construirPayloadSoporte } from '../services/motorExcelExport';
import { parseEEFFComparableOCR, parseEEFFComparablesLote } from '../services/eeffParser';
import {
  separarPorSuficiencia, partidasFaltantes, motivoSinInformacionFinanciera, retirarFilas,
} from '../services/eeffSuficiencia';
import { cotejarConFuente } from '../services/eeffCotejoFuente';
import { matrizDeRechazo } from '../services/anexoCHtml';
import { rasterizarConReintento, recortarPorPagina } from '../services/pdfRenderer';
/* El EEFF se adjunta al ANEXO B como imagen de la página, no como cifras transcritas
   (spec 2026-08-06). Sin quitarle el papel en blanco de alrededor, el cuadro de cada
   comparable se llevaba una página entera del informe. */
import { recortarPaginas } from '../services/recorteImagen';
import { redactarDescripcionesEnLote } from '../services/descripcionComparables';
import { traducirCriteriosScreening } from '../services/criteriosScreeningIA';
import { residuoDeCriterios } from '../services/criteriosScreeningEs';
import { parsePriorStudyFile } from '../services/priorStudyParser';
import { cruzar, repartir, esCruceFirme, motivoCruce, motivoRechazoEnFila } from '../services/cruceComparables';
import {
  registrarComparablesHistoricas, guardarEeffComparables, leerEeffDeComparables,
  comparablesHistoricasDelAnio,
} from '../services/firestoreRepo';
import {
  comparablesConEeffReutilizable, aplicarEeffGuardadoEnFila, catalogoAComparablesPrevias,
} from '../services/firestoreModelo';
import {
  subirCribado, descargarCribado, borrarCribado, subirCuracion, descargarCuracion,
  debeRestaurarCribado, bucketAusente, AVISO_STORAGE_APAGADO,
} from '../services/cribadoStorage';
import MemoriaRangoModal from './MemoriaRangoModal.jsx';
import CampoMoneda from './CampoMoneda';

/* Aviso que ocupa el lugar de la actividad económica mientras no se extraiga de los
   adjuntos. No es un dato del contribuyente y no debe guardarse como tal. */
const ACTIVIDAD_SIN_EXTRAER = 'No extraido por favor validar adjuntos';

/* Las cifras de la parte examinada tal como las espera `pliOf`, con el segmento excluido
   descontado de ventas y de utilidad. Estaba escrito tres veces en este archivo con el mismo
   cuerpo; ahora el motor también lo necesita —usa el margen del contribuyente para ordenar la
   cuota de negativas por cercanía— y una cuarta copia acabaría divergiendo. */
function cifrasExaminada(study) {
  const seg = num(study.seg_excluido) || 0;
  const tS = num(study.t_s);
  const tOp = num(study.t_op);
  return {
    s: tS !== null ? tS - seg : null,
    c: num(study.t_c),
    op: tOp !== null ? tOp - seg : null,
    ar: num(study.t_ar), inv: num(study.t_inv), ap: num(study.t_ap), ppe: num(study.t_ppe),
  };
}

/** El margen de la parte examinada con el indicador del estudio, o `null` si faltan cifras. */
function margenExaminada(study) {
  return pliOf(cifrasExaminada(study), study.pli || 'MO');
}

/* Miles con punto, como el resto del embudo del paso 3. Sin esto un universo de 2.987 salía
   «2987» en el panel nuevo y «2.987» tres bloques más abajo, en la misma pantalla. */
const mil = (n) => Number(n || 0).toLocaleString('es-CO');

/* LA ACTIVIDAD de la comparable, tal como la va a publicar el informe.

   `descActividad` es la redacción en español que hace `descripcionComparables.js`; `desc` es la
   Business Description cruda de Capital IQ. El informe publica la primera y cae a la segunda
   —así lo hacen `anexoBHtml.js:304` y `docxRelleno.js:3676`— pero la tabla no mostraba ninguna
   de las dos, así que el texto que se radica por cada comparable no se podía leer antes de
   generarlo (pedido del 2026-09-01).

   Se distingue cuál de las dos se está viendo: si todavía no hay redacción en español, el
   informe saldría con el inglés de la fuente, y eso hay que poder notarlo. */
function ActividadDeLaComparable({ row }) {
  const redactada = String(row.descActividad || '').trim();
  const cruda = String(row.desc || '').trim();
  const texto = redactada || cruda;
  if (!texto) {
    return (
      <p className="text-[10.5px] text-zinc-400 mt-1 italic">
        Sin descripción del negocio en el cribado: el informe la publicaría vacía.
      </p>
    );
  }
  return (
    <p
      className="text-[10.5px] text-zinc-500 dark:text-zinc-400 mt-1 leading-snug line-clamp-2"
      title={redactada
        ? texto
        : texto + '  —  Sin redactar: el informe publicaría este texto en inglés, tal como '
          + 'viene de Capital IQ. Use «Redactar descripciones» para pasarlo a español.'}
    >
      {!redactada && (
        <span className="text-amber-600 dark:text-amber-500 font-semibold">[sin redactar] </span>
      )}
      {texto}
    </p>
  );
}

/* El veredicto de actividad de una comparable, para validarlo antes de generar los EEFF.

   Cuatro estados y cada uno dice algo distinto:
     · MISMA        la curación reconoció la misma actividad. Es lo que se busca.
     · RELACIONADA  actividad afín, no idéntica. Entra solo si las de misma actividad no llenan
                    el cupo, y hay que sustentarla en el informe.
     · DISTINTA     no debería estar en la muestra; si aparece es porque venía del estudio
                    anterior, que la exime.
     · sin veredicto  nadie la verificó: agregada a mano, sin identificador, o curación no
                    corrida. Se marca, porque antes se veía igual que una confirmada. */
function InsigniaActividad({ row }) {
  const grado = row.gradoActividad || '';
  const motivo = row.motivoActividad || '';
  const clases = 'inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded text-[10px] font-bold ';

  if (grado === 'MISMA') {
    return (
      <span
        className={clases + 'bg-[#0FA3A1]/10 text-[#0B7C7A] dark:text-[#0FA3A1]'}
        title={'Misma actividad económica, según la curación con IA.' + (motivo ? ' · ' + motivo : '')}
      >
        Misma actividad
      </span>
    );
  }
  if (grado === 'RELACIONADA') {
    return (
      <span
        className={clases + 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-400'}
        title={'Actividad relacionada, no idéntica'
          + (row.entroPorAmpliacion ? `. Entró para no bajar de ${MINIMO_COMPARABLES} comparables` : '')
          + '. Hay que sustentarla en el informe.'
          + (motivo ? ' · ' + motivo : '')}
      >
        Actividad relacionada
      </span>
    );
  }
  if (grado === 'DISTINTA') {
    return (
      <span
        className={clases + 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-400'}
        title={'La curación NO reconoció la actividad. Está en la muestra porque venía del '
          + 'estudio anterior, que la exime del descarte.' + (motivo ? ' · ' + motivo : '')}
      >
        Actividad distinta
      </span>
    );
  }
  return (
    <span
      className={clases + 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400'}
      title="Nadie verificó su actividad: se agregó a mano, no trae identificador de la fuente, o la curación no ha corrido. Revísela antes de radicar."
    >
      Actividad sin verificar
    </span>
  );
}

/* Lo que un filtro está sacando del universo, pegado a su propio control.
   Es el corazón del rediseño del paso 2: un rótulo sin número es abstracto —«excluye holdings»
   no dice cuántas— y un embudo aparte obliga a adivinar qué línea corresponde a qué selector.
   Con el número al lado, el rótulo se vuelve concreto y el embudo deja de necesitar lectura
   propia.

   El «ver» despliega cinco razones sociales. Cinco y no todas: la lista sirve para VERIFICAR
   que el filtro no se equivocó —el de holding se presume del nombre y a veces acierta de más—,
   no para leerla entera. */
function CostoDelFiltro({ paso, universo, expandido, alExpandir }) {
  if (!paso || !universo) return null;
  /* Un filtro en «incluir» no descarta a nadie, y decir «apagado» ahí se leía como que el
     control estuviera roto —se reportó exactamente así sobre «Pérdidas Operativas» puesto en
     Incluir—. Lo que importa es el efecto, no el estado del interruptor. */
  if (!paso.activo) {
    return (
      <span className="text-[10px] text-zinc-400 shrink-0" title={paso.queHace}>
        no descarta
      </span>
    );
  }
  if (paso.saca === 0) {
    return (
      <span className="text-[10px] text-zinc-400 shrink-0" title={paso.queHace}>
        no saca ninguna
      </span>
    );
  }
  return (
    <span className="flex items-baseline gap-1.5 shrink-0">
      <span className="text-[10.5px] text-zinc-500" title={paso.queHace}>
        saca <b className="text-rose-700 dark:text-rose-400">{mil(paso.saca)}</b> de {mil(universo)}
      </span>
      {paso.ejemplos.length > 0 && (
        <button
          type="button"
          onClick={alExpandir}
          className="text-[10px] text-[#0B7C7A] dark:text-[#0FA3A1] hover:underline"
        >
          {expandido ? 'ocultar' : 'ver'}
        </button>
      )}
    </span>
  );
}

/* Los ejemplos del filtro desplegado. Va aparte del control para poder ocupar el ancho
   completo: cinco razones sociales de Capital IQ no caben en la columna de un selector. */
function EjemplosDelFiltro({ paso }) {
  if (!paso || !paso.ejemplos.length) return null;
  return (
    <div className="md:col-span-2 rounded-lg bg-zinc-50 dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 p-2.5 -mt-1">
      <p className="text-[10.5px] text-zinc-500 mb-1.5 leading-relaxed">{paso.queHace}</p>
      <ul className="text-[11px] text-zinc-700 dark:text-zinc-300 space-y-0.5">
        {paso.ejemplos.map((nombre) => (
          <li key={nombre} className="flex gap-1.5">
            <span className="text-zinc-400 shrink-0">·</span>
            <span>{nombre}</span>
          </li>
        ))}
      </ul>
      {paso.masSinNombrar > 0 && (
        <p className="text-[10px] text-zinc-400 mt-1.5">
          y {paso.masSinNombrar} más. Se muestran cinco: es para comprobar el criterio, no para
          revisarlas una por una.
        </p>
      )}
    </div>
  );
}

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

  useEffect(() => {
    if (study.actividad_especifica) {
      setActividad(study.actividad_especifica);
      setActInput(study.actividad_especifica);
    }
  }, [study.actividad_especifica]);

  // Engine Configuration State
  const [engineConfig, setEngineConfig] = useState(study.motorConfig || {
    nTarget: 12,
    perdidaOp: 'excluir',
    /* Cuántas comparables en pérdida se quieren en el informe. Cuenta DENTRO de `nTarget` y
       es también un tope. Solo aplica si la política admite pérdidas: con `excluir` no hay
       negativas que repartir y el motor lo ignora solo. Los estudios guardados antes de que
       esto existiera no lo traen, y el motor lo toma como 0. */
    negativasObjetivo: 0,
    holding: 'excluir',
    /* Independencia (Art. 260-1 E.T.): una comparable con un accionista por encima
       del umbral no es independiente. Los estudios guardados antes de que existiera
       esta opción no la traen en `motorConfig`, y entonces el motor aplica sus
       valores por defecto, que son estos mismos. */
    control: 'excluir',
    umbralControl: 50,
    saldoNegativo: 'excluir',
    geo: 'ninguna',
    /* `rigor` estuvo aquí hasta el 2026-09-01. Su filtro se retiró del motor el 2026-08-10 y su
       selector salió del paso 2, y desde entonces nada lo leía: dejar una clave inerte en la
       configuración invita a volver a cablearla. Los estudios guardados que la traigan siguen
       cargando sin problema — el motor la acepta y la ignora. */
    justificacionPerdida: ''
  });

  // Imported Universe & Active Comparables
  const [universo, setUniverso] = useState(study.universo || []);
  /* Referencia al cribado guardado en Cloud Storage: { ruta, archivo, filas, hoja,
     bytes, subidoEn, subidoPor, curacion? }. El universo en sí no cabe en el documento
     del estudio —miles de filas con su descripción de negocio, por encima del millón de
     bytes que admite Firestore—, así que lo que viaja con el estudio es esto, y el
     archivo vive aparte. Sin ello, reabrir el estudio obligaba a cargar el Excel otra
     vez y la curación ya pagada se perdía al cambiar de máquina. */
  const [cribadoIQ, setCribadoIQ] = useState(study.cribadoIQ || null);
  /* Restauración en curso desde la nube, para que la pantalla no parezca vacía mientras
     se descarga y reparsea un archivo de varios MB. */
  const [restaurando, setRestaurando] = useState(false);
  /* Un estudio sin comparables arranca vacío. Antes arrancaba con cuatro empresas de
     videojuegos —Activision, Electronic Arts, Take-Two y Ubisoft— y cifras inventadas de
     ejemplo: en un sistema multiempresa eso significa que el estudio de cualquier
     contribuyente podía recibir la muestra de otro sector, y como el efecto de más abajo
     escribe `comparables` en el estudio, esas cuatro se guardaban y llegaban al rango
     intercuartil y al informe. Un hueco se ve; una muestra plausible y ajena, no. */
  const [comparables, setComparables] = useState(study.comparables || []);
  /* Imágenes del EEFF de cada comparable para el ANEXO B, por nameKey — ver
     plantillaStore.js (guardarAnexoBImagenes) y docxRelleno.js
     (insertarImagenesAnexoB). No es parte de `comparables`: pesa demasiado para
     ir dentro de cada fila del estudio (ver CAMPOS_SOLO_LOCALES). */
  const [eeffImagenesComparables, setEeffImagenesComparables] = useState(study.eeffImagenesComparables || {});

  const [cmode, setCmode] = useState(study.cmode || 'all');
  /* Criterios de la hoja "Screen Criteria" del export de Capital IQ (SIC, tipo
     de compañía, ingresos, etc.), para reconstruir la Tabla 13 del informe con
     la corrida real de este año en vez de la del informe anterior. */
  const [criteriosScreening, setCriteriosScreening] = useState(study.criteriosScreening || []);
  /* Cuándo se consultó la base de datos: se sella al importar el export de Capital IQ y
     alimenta la cita al pie de las siete tablas del motor. Antes esa cita llevaba «septiembre
     de 2025» escrito a mano en el código, heredado del informe de referencia, y se radicaba
     igual en un estudio consultado en otro mes. El numeral 4 del artículo 1.2.2.2.1.5 del
     Decreto 1625 de 2016 exige la fecha de consulta. */
  const [dbConsulta, setDbConsulta] = useState(study.database_consulta || null);
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

  /* Auditoría del motor: el motivo de rechazo y el perfil funcional de cada
     candidata del universo.

     Vive SOLO en memoria —no se persiste con el estudio, igual que el universo— así
     que al reabrir un estudio guardado el universo se restauraba desde el archivo de
     Capital IQ pero los motivos no, y la hoja de trazabilidad salía con las 2.986
     compañías sin motivo y todos los contadores del embudo en cero: un documento que
     parece declarar que no se descartó a ninguna.

     `scoreCandidates` es determinista y tiene sus insumos persistidos —universo,
     configuración, actividad, veredicto de la IA y estudio anterior—, así que se
     recalcula cuando falta en lugar de emitir una hoja vacía. */
  const auditoria = useMemo(() => {
    if (motorAuditoria) return motorAuditoria;
    if (!Array.isArray(universo) || universo.length === 0) return null;
    const rehecha = scoreCandidates(
      universo, engineConfig, actividad,
      (estudioAnteriorInfo && estudioAnteriorInfo.comparables) || [],
      {
        ventasParteExaminada: study.t_s, iaMatch,
        /* Los MISMOS insumos que la corrida real: sin el margen del contribuyente esta
           reconstrucción ordenaría la cuota por puntaje y la hoja de trazabilidad describiría
           una selección distinta de la que se radicó. */
        pliParteExaminada: margenExaminada(study),
        metodoPli: study.pli || 'MO',
      },
    );
    return { rechazadas: rehecha.rechazadas, reserva: rehecha.reserva };
  }, [motorAuditoria, universo, engineConfig, actividad, estudioAnteriorInfo, study, iaMatch]);

  /* Matriz del ANEXO C: qué compañía del universo quedó en cada motivo. Se calcula aquí
     —el único sitio con el universo enriquecido— y se persiste ya agrupada, porque el
     generador del informe no tiene con qué recalcularla: `universo` no viaja con el estudio.
     Solo los nombres, que es lo que el anexo publica.

     Va declarada ANTES del efecto que la persiste, y no junto al resto de los cálculos
     del render: el arreglo de dependencias de ese efecto se evalúa durante el render, así
     que con la declaración más abajo `matrizRechazo` se leía en su zona muerta y el
     componente moría con «Cannot access before initialization», dejando la aplicación en
     blanco. Lo mismo obliga a que `auditoria`, de la que depende, quede también aquí. */
  const matrizRechazo = useMemo(() => {
    if (!Array.isArray(universo) || !universo.length) return null;
    return matrizDeRechazo(enriquecerUniverso(universo, comparables, auditoria));
  }, [universo, comparables, auditoria]);

  /* Qué va a pasar con esta configuración, ANTES de correr y de pagar la curación. Los cuatro
     filtros duros son cálculo local sobre el universo ya cargado, así que esto se puede
     recalcular con cada tecla sin costar nada — que es justo el punto: el paso 2 se configuraba
     a ciegas y el efecto solo se veía después de pagar.

     Usa el MISMO juez que el motor (`prefiltrar` / `filtroQueDescarta`), no una copia: un panel
     que promete un número que `scoreCandidates` no respeta es peor que no mostrar nada. */
  const previsualizacion = useMemo(() => previsualizarFiltros(universo, engineConfig, {
    estudio: study,
    iaMatch,
    estudioAnterior: estudioAnteriorInfo,
  }), [universo, engineConfig, study, iaMatch, estudioAnteriorInfo]);

  /* Las afinaciones arrancan plegadas: seis controles en una parrilla plana no dejaban ver
     cuáles son decisiones de fondo. El costo de lo plegado se muestra en la propia barra, para
     que esconderlas nunca oculte un descarte. */
  const [afinacionesAbiertas, setAfinacionesAbiertas] = useState(false);
  /* Qué filtro tiene desplegados sus ejemplos. Uno a la vez: es para verificar una sospecha,
     no para leer cuatro listas juntas. */
  const [filtroExpandido, setFiltroExpandido] = useState(null);
  /* El asistente de la justificación. El borrador vive aquí y no en el estudio: solo entra al
     campo si el analista lo acepta, porque ese texto se radica y conviene leerlo antes. */
  const [redactando, setRedactando] = useState(false);
  const [borradorJustificacion, setBorradorJustificacion] = useState(null);
  const [avisoJustificacion, setAvisoJustificacion] = useState('');



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
         sin capturar). Lo que se guarda es `cribadoIQ`, la referencia al archivo en
         Cloud Storage, con la que el universo se restaura al reabrir el estudio; lo
         que sí importa para el resto del estudio, `comparables`, sigue persistiendo
         igual que antes. */
      cribadoIQ,
      comparables,
      cmode,
      criteriosScreening,
      database_consulta: dbConsulta,
      /* La matriz del ANEXO C: qué compañía quedó en cada motivo, solo los nombres. El
         generador del informe no puede calcularla —necesita el universo enriquecido, y
         `universo` no viaja con el estudio—, así que se guarda ya agrupada. Va en
         CAMPOS_SOLO_LOCALES: son miles de nombres y no caben en el documento de Firestore.

         Solo se publica cuando hay algo que publicar. `updateStudy` fusiona con
         `{...prev, ...campos}`, así que mandar `null` BORRABA la matriz guardada: al
         reabrir un estudio, `universo` no está —no se persiste— y el cálculo de arriba
         devuelve `null`, de modo que este efecto pisaba con nada la matriz que el estudio
         traía de la corrida anterior. El ANEXO C del informe se quedaba entonces con la
         tabla de la plantilla, sin que nada más lo delatara. */
      ...(matrizRechazo ? { matrizRechazo } : {}),
      /* Conteos de la última selección: alimentan la tabla 14 del informe. */
      embudoSeleccion: selectionFunnel,
      /* el veredicto de la curación es la constancia de por qué se aceptó o rechazó
         cada candidata, y evita volver a pagar la consulta. Viaja con el estudio hasta
         App, que lo separa antes de subirlo: se guarda en localStorage y no en
         Firestore, por decisión del usuario y porque un dictamen por cada una de
         miles de candidatas no cabe cómodo en un documento */
      iaMatch,
      eeffImagenesComparables,
    });
  }, [actividad, estudioAnteriorInfo, engineConfig, universo, comparables, cmode, criteriosScreening, dbConsulta, iaMatch, selectionFunnel, cribadoIQ, eeffImagenesComparables, matrizRechazo]);

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
          /* La identificación del vinculado del informe anterior es lo que permite
             detectar que el Tax ID de la contraparte cambió de un año a otro sin
             explicación. Sin guardarla aquí, ese cotejo no se puede hacer. */
          vinculado: result.vinculado || null,
          comparables: result.comparables || [],
          /* Composición accionaria del informe anterior: solo se usa en la Tabla 6
             cuando el estudio actual no tiene certificado propio cargado (ver
             resolverComposicionAccionaria en tablasContribuyente.js). */
          capital_pagado: result.capital_pagado || null,
          total_acciones: result.total_acciones || null,
          accionistas: result.accionistas || []
        };
        setEstudioAnteriorInfo(info);
        updateStudy({
          estudioAnterior: info,
          ...(result.actividad_especifica ? { actividad_especifica: result.actividad_especifica } : {})
        });
        const msgAcc = result.accionistas && result.accionistas.length > 0
          ? ` · ${result.accionistas.length} accionista(s)`
          : '';
        setPriorStudyMsg(`✅ Informe leído con éxito. Extraída actividad, ${result.comparables.length} comparables${msgAcc}.`);

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
      const kind = study.pli || 'MO';
      const segExcluido = num(study.seg_excluido) || 0;
      const tSNum = num(study.t_s);
      const tOpNum = num(study.t_op);
      const T = {
        s: tSNum !== null ? tSNum - segExcluido : null,
        c: num(study.t_c),
        op: tOpNum !== null ? tOpNum - segExcluido : null,
        ar: num(study.t_ar),
        inv: num(study.t_inv),
        ap: num(study.t_ap),
        ppe: num(study.t_ppe),
      };
      const tPLI = pliOf(T, kind);
      const targetProfitability = tPLI !== null ? (tPLI * 100).toFixed(3) : '4.716';

      const veredicto = await curateCandidatesWithGemini(candidatas, act, {
        priorComps,
        targetProfitability,
        pli: kind,
        fuente: (importMeta && importMeta.archivo) || '',
        veredictoPrevio: forzar ? null : iaMatch,
        onProgress: (info) => {
          setCuracionProgreso(info);
          if (info.etapa === 'inicio' || info.etapa === 'omitida') anotar(info.mensaje, info.etapa === 'omitida' ? 'aviso' : 'info');
        },
      });
      setIaMatch(veredicto);
      /* El veredicto vale dinero —son consultas a Gemini ya pagadas— y es la constancia
         de por qué se aceptó o rechazó cada candidata. Va a la nube junto al cribado y
         no dentro del estudio: un dictamen por cada una de miles de candidatas ronda
         cientos de KB y se comería el presupuesto de un documento de Firestore. */
      if (!veredicto.omitida) await guardarCuracionEnLaNube(veredicto);
      if (veredicto.omitida) {
        anotar(veredicto.omitida, 'aviso');
      } else {
        anotar(`Curación terminada: ${veredicto.coinciden} de ${veredicto.total} coinciden con la actividad`, 'ok');
        if (veredicto.fallidas) {
          /* Con el código HTTP y el motivo a la vista: un 502/504 es el servidor
             cortando por tiempo y conviene volver a curar; un tope de gasto agotado
             no se arregla reintentando y hay que ir a la consola de Gemini. Sin esto
             el usuario solo veía «no se pudieron evaluar». */
          const errores = veredicto.errores || [];
          const codigos = [...new Set(errores.map(e => e.status ? 'HTTP ' + e.status : 'fallo de red'))];
          anotar(`${veredicto.fallidas} candidatas no se pudieron evaluar` +
            (errores.length ? ` (${errores.length} lote(s): ${codigos.join(', ')})` : '') +
            '; se dejan pasar sin descartarlas por actividad. Puede volver a curar para reintentar solo esas.', 'aviso');
          const cuota = errores.find(e => /spending cap|current quota|billing|free tier/i.test(e.mensaje || ''));
          if (cuota) {
            anotar('La cuenta de Gemini agotó su tope de gasto: «' + cuota.mensaje +
              '». Reintentar no sirve hasta levantarlo en ai.studio/spend.', 'error');
          }
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

  /* Redacta la justificación de admitir pérdidas con los HECHOS de este estudio más la causa
     que escribió el analista. La causa es el único insumo que la IA no puede sacar de los datos
     —las Guías OCDE piden analizar la causa de la pérdida, no solo constatarla— y por eso sin
     ella no se llama al modelo. */
  const redactarJustificacion = async () => {
    const causa = String(study.causaPerdidasSector || '').trim();
    if (!causa) {
      setAvisoJustificacion('Escriba primero por qué el sector tuvo pérdidas: es el análisis de '
        + 'causa que piden las Guías OCDE, y es lo único que la IA no puede deducir de los datos.');
      return;
    }
    setAvisoJustificacion('');
    setRedactando(true);
    try {
      const enPerdidaMuestra = comparables.filter((c) => num(c.op) !== null && num(c.op) < 0);
      const texto = await redactarJustificacionPerdidas({
        causa,
        entidad: study.ent,
        anio: study.anio,
        actividad: actividad,
        metodo: study.pli || 'MO',
        indicador: margenExaminada(study),
        enLaMuestra: enPerdidaMuestra.length,
        deLaMuestra: comparables.length,
        disponibles: previsualizacion.enPerdidaEnUniverso,
        margenes: enPerdidaMuestra
          .map((c) => (num(c.s) ? num(c.op) / num(c.s) : null))
          .filter((m) => m !== null),
        criterio: (selectionFunnel && selectionFunnel.criterioNegativas) || 'puntaje',
      });
      if (texto) setBorradorJustificacion(texto);
      else {
        setAvisoJustificacion('No se pudo redactar en este momento. El campo sigue siendo '
          + 'editable a mano.');
      }
    } finally {
      setRedactando(false);
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

  /* Guarda el cribado en la nube y deja su referencia en el estudio. Nunca lanza: la
     importación ya terminó bien y un fallo de red no puede deshacerla. Lo que sí hace es
     decir en el panel qué pasó, porque un cribado que se cree guardado y no lo esté se
     descubre semanas después, al reabrir el estudio y encontrarlo vacío. */
  const guardarCribadoEnLaNube = async (file, meta, filas) => {
    if (!usuario || !estudioId) {
      anotar('El cribado no se guardó en la nube: hace falta una sesión y un estudio guardado. ' +
        'El motor funciona igual, pero al reabrir el estudio habrá que cargar el Excel de nuevo.', 'aviso');
      return;
    }
    try {
      const referencia = await subirCribado(file, {
        uid: usuario.uid, estudioId, filas, hoja: (meta && meta.hoja) || '',
      });
      /* Reimportar con otro nombre de archivo da otra ruta, así que el anterior queda sin
         nada que lo referencie: se retira para no ir acumulando copias pagadas. */
      const anterior = cribadoIQ && cribadoIQ.ruta;
      if (anterior && anterior !== referencia.ruta) await borrarCribado(anterior);
      setCribadoIQ(referencia);
      anotar(`Cribado guardado en la nube (${(referencia.bytes / 1024 / 1024).toFixed(2)} MB): ` +
        'al reabrir el estudio el universo se restaura solo.', 'ok');
    } catch (err) {
      if (await bucketAusente(err)) anotar(AVISO_STORAGE_APAGADO, 'aviso');
      else anotar('No se pudo guardar el cribado en la nube: ' + ((err && err.message) || 'error desconocido') +
        '. El motor funciona igual, pero al reabrir el estudio habrá que cargar el Excel de nuevo.', 'aviso');
      console.error('[cribado] no se pudo subir', err);
    }
  };

  /* Sube el veredicto de la curación y anota la referencia dentro de `cribadoIQ`, para
     que viaje con el estudio en un solo campo. Tampoco lanza: la curación ya está en
     memoria y sirve para esta sesión aunque no se pueda guardar. */
  const guardarCuracionEnLaNube = async (veredicto) => {
    if (!usuario || !estudioId) return;
    try {
      const referencia = await subirCuracion(veredicto, { uid: usuario.uid, estudioId });
      setCribadoIQ(prev => ({ ...(prev || {}), curacion: referencia }));
    } catch (err) {
      if (await bucketAusente(err)) anotar(AVISO_STORAGE_APAGADO, 'aviso');
      else anotar('La curación no se pudo guardar en la nube: ' + ((err && err.message) || 'error desconocido') +
        '. Sigue disponible en este navegador, pero al abrir el estudio en otra máquina habría que volver a pagarla.', 'aviso');
      console.error('[curación] no se pudo subir el veredicto', err);
    }
  };

  /* Trae el cribado guardado y reconstruye el universo. Corre una sola vez al abrir el
     estudio, y solo si no hay universo en memoria: reimportar el Excel a mano deja el
     universo puesto, y volver a descargarlo entonces sería pagar tráfico por nada. */
  useEffect(() => {
    if (!debeRestaurarCribado({ universo, cribadoIQ })) return;
    let cancelado = false;
    (async () => {
      setRestaurando(true);
      anotar(`Restaurando el cribado guardado («${cribadoIQ.archivo || 'archivo'}»)…`);
      try {
        const blob = await descargarCribado(cribadoIQ.ruta);
        const { rows, meta } = await importCapitalIQExcel(blob, (etapa, hechas, total) => {
          if (!cancelado) setImportProgreso({ etapa, hechas, total });
        });
        if (cancelado) return;
        setUniverso(rows);
        setImportMeta(meta);
        /* El export acaba de leerse: esta ES la fecha de consulta de la base de datos. */
        setDbConsulta(new Date().toISOString());
        if (meta.criteriosScreening && meta.criteriosScreening.length) {
          setCriteriosScreening(meta.criteriosScreening);
        }
        anotar(`${rows.length} compañías restauradas del cribado guardado, sin volver a cargar el archivo.`, 'ok');

        /* El veredicto ya pagado. Solo si no hay uno en memoria: el de localStorage es
           igual de válido y más reciente que el de la nube si se curó y no se subió. */
        if (!iaMatch && cribadoIQ.curacion && cribadoIQ.curacion.ruta) {
          const guardado = await descargarCuracion(cribadoIQ.curacion.ruta);
          if (!cancelado && guardado && guardado.porId) {
            setIaMatch(guardado);
            anotar(`Curación recuperada de la nube: ${Object.keys(guardado.porId).length} candidatas ya evaluadas, ` +
              'no hay que volver a pagarlas.', 'ok');
          }
        }
      } catch (err) {
        if (cancelado) return;
        if (await bucketAusente(err)) anotar(AVISO_STORAGE_APAGADO, 'aviso');
        else anotar('No se pudo restaurar el cribado guardado: ' + ((err && err.message) || 'error desconocido') +
          '. Cargue el Excel de Capital IQ de nuevo.', 'error');
        console.error('[cribado] no se pudo restaurar', err);
      } finally {
        if (!cancelado) { setRestaurando(false); setImportProgreso(null); }
      }
    })();
    return () => { cancelado = true; };
    /* Solo al montar: las dependencias reales (universo, iaMatch) cambian dentro del
       propio efecto y volverlo reactivo lo relanzaría contra sí mismo. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Traducción al español de los criterios de búsqueda (Tabla 14 del informe, «Códigos SIC
     utilizados»). El diccionario de `criteriosScreeningEs.js` cubre el vocabulario cerrado
     de Capital IQ en el propio render, sin pagar nada; esto solo paga IA por el residuo
     —una etiqueta de campo nueva, un título SIC fuera del catálogo sembrado— y lo cachea
     en el estudio como `etiquetaEs` / `valorEs`.

     Un solo efecto cubre los tres caminos por los que llegan criterios: importar el Excel,
     restaurar el cribado guardado y abrir un estudio viejo que tiene el inglés almacenado.

     El ref no es un lujo: `traducirCriteriosScreening` devuelve un array nuevo también
     cuando la IA falla, así que sin memoria de lo ya intentado el efecto se relanzaría
     contra sí mismo y pagaría una llamada por render. La firma es el texto CRUDO, que no
     cambia al añadir la traducción. */
  const criteriosIntentados = useRef(new Set());
  useEffect(() => {
    const pendientes = residuoDeCriterios(criteriosScreening);
    if (!pendientes.length) return undefined;
    const firma = JSON.stringify((criteriosScreening || []).map((c) => [c && c.etiqueta, c && c.valor]));
    if (criteriosIntentados.current.has(firma)) return undefined;
    criteriosIntentados.current.add(firma);

    let cancelado = false;
    (async () => {
      const sinCatalogar = pendientes.flatMap((p) => p.residuo);
      anotar(`Traduciendo al español ${pendientes.length} criterio(s) de búsqueda que el diccionario no cubre: ` +
        sinCatalogar.join('; '));
      const traducidos = await traducirCriteriosScreening(criteriosScreening);
      if (cancelado) return;
      const siguenPendientes = residuoDeCriterios(traducidos).length;
      if (siguenPendientes >= pendientes.length) {
        anotar('No se pudo traducir ese residuo: la Tabla 14 saldrá con esos trozos en inglés. ' +
          'El resto de la tabla sí sale en español.', 'aviso');
        return;
      }
      setCriteriosScreening(traducidos);
      anotar(`${pendientes.length - siguenPendientes} criterio(s) de búsqueda traducidos con IA y guardados en el estudio.`, 'ok');
    })();
    return () => { cancelado = true; };
    /* `anotar` se redefine en cada render y volvería reactivo un efecto que solo depende
       de los criterios. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [criteriosScreening]);

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
      /* El export acaba de leerse: esta ES la fecha de consulta de la base de datos. */
      setDbConsulta(new Date().toISOString());
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
      /* El archivo se guarda tal como se cargó. Va después de dejar el universo en
         pantalla y en su propio try: si la subida falla, el motor tiene que seguir
         funcionando exactamente como antes —el universo ya está en memoria— y lo único
         que se pierde es poder reabrir el estudio sin volver a cargar el Excel. */
      await guardarCribadoEnLaNube(file, meta, rows.length);
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
         con holding, saldos negativos y pérdida operativa. Si no se curó —sin actividad
         detectada o sin descripciones— el motor sigue con las palabras clave, no
         descarta a nadie por omisión.

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
        /* El margen del contribuyente ordena la cuota de negativas: entran las de perfil de
           rentabilidad más parecido al suyo (decisión del usuario, 2026-09-01). Sin cifras
           cargadas el motor degrada al orden por puntaje. */
        pliParteExaminada: margenExaminada(study),
        metodoPli: study.pli || 'MO',
        /* La cercanía se mide sobre el margen NO AJUSTADO, y eso es metodología, no una
           limitación: la búsqueda de comparables se hace sobre el margen propio de cada
           compañía y el ajuste por capital de trabajo se aplica DESPUÉS, para leer el
           cumplimiento (criterio del contador que asesora el estudio, 2026-09-01).

           `margenDeCandidata` queda disponible por si alguna vez se quiere medir con otra vara
           —`margenQueDecide` la construye— pero NO se inyecta: seleccionar con la vara ajustada
           elige comparables por el resultado del ajuste y no por su perfil, que es al revés de
           lo que pide la comparabilidad. */
      });

      /* Conteos del propio motor, no deducidos del texto del motivo: antes esto era
         una expresión regular sobre `motivoRechazo` y el embudo mezclaba etapas. */
      const cat = result.rechazadasPorCategoria;
      /* `cat.rigor` NO son descartes por rigor funcional: ese filtro se retiró el 2026-08-10.
         Son las que superan los filtros objetivos, pasan la curación y no alcanzan el cupo —
         diferencias funcionales (Art. 260-4), que es como ya las nombran la Tabla 16 del informe
         y la hoja del embudo del Excel. */
      anotar(`${result.totalValidas} pasaron todos los criterios; ${result.rechazadas.length} descartadas ` +
        `(${cat.filtro} por los filtros del paso 2, ${cat.ia} por la curación con IA, ${cat.rigor} por diferencias funcionales)`);
      if (!result.ventasParteExaminada) {
        anotar('Sin ventas de la parte examinada: el factor de tamaño queda neutro. Diligéncielas en la tarjeta de cifras.', 'aviso');
      }
      if (!result.conActividad) {
        anotar('Sin actividad detectada: la especialidad pesa 15 % en lugar de 40 %.', 'aviso');
      }

      /* El cupo que el motor aplicó de verdad: nunca por debajo de `MINIMO_COMPARABLES`,
         aunque el paso 2 pida menos. */
      const nTarget = result.cupo;
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
        seleccionadas: finales.length,
        objetivo: nTarget,
        reserva: result.reserva.length,
        /* Cuántas entraron ampliando el criterio a actividades afines. Hay que declararlo en
           el informe, así que tiene que verse en pantalla y no solo en el detalle por fila. */
        ampliadas: result.ampliadas || 0,
        relacionadasDisponibles: result.relacionadasDisponibles || 0,
        /* La política de pérdidas y la cuota, con su justificación. Van en el embudo porque es
           lo único de esta pantalla que se persiste con el estudio y que el informe y el Excel
           de soporte ya leen: sin esto, una muestra con comparables en pérdida llegaría al
           documento que se radica sin nada que explique por qué están ahí. */
        politicaPerdidas: engineConfig.perdidaOp,
        justificacionPerdida: engineConfig.justificacionPerdida || '',
        negativasObjetivo: result.negativasObjetivo || 0,
        negativasIncluidas: result.negativasIncluidas || 0,
        negativasDisponibles: result.negativasDisponibles || 0,
        negativasExcluidasPorFiltro: result.negativasExcluidasPorFiltro || 0,
      });

      /* Se dice de qué está compuesta la muestra: el número que el usuario pide es el
         tamaño final, y las de continuidad ocupan parte de ese cupo. */
      const deContinuidad = result.continuidad || 0;
      const composicion = deContinuidad
        ? ` (${deContinuidad} del estudio anterior + ${finales.length - deContinuidad} nuevas)`
        : '';

      /* ── La cuota de comparables en pérdida ──
         Se reporta siempre que se haya pedido alguna, salga o no completa: es una decisión
         metodológica que el informe tiene que sustentar, y cuando no se completa la cifra que
         importa es cuántas HABÍA, que es lo que distingue «Capital IQ no tiene más» de «el
         motor no las buscó». */
      const negObjetivo = result.negativasObjetivo || 0;
      const negIncluidas = result.negativasIncluidas || 0;
      const negDisponibles = result.negativasDisponibles || 0;
      if (negObjetivo > 0) {
        if (negIncluidas >= negObjetivo) {
          anotar(`${negIncluidas} comparable(s) en pérdida en la muestra, como se pidió` +
            (result.negativasDeContinuidad
              ? ` (${result.negativasDeContinuidad} viene(n) del estudio anterior)`
              : '') +
            `. Del universo había ${negDisponibles} con la misma actividad detectada.`, 'ok');
        } else {
          /* La causa importa y antes se afirmaba una sola —«el resto del cupo lo llenaron
             positivas»— que era falsa cuando la continuidad se había llevado el cupo entero.
             Se reportó sobre un caso real con 16 de continuidad y 41 negativas disponibles:
             entraron 0 y el aviso mandaba a ampliar un cribado que estaba bien. */
          const causa = negDisponibles < negObjetivo
            ? `el universo de Capital IQ solo tiene ${negDisponibles} con la misma actividad `
              + 'detectada que superen los filtros. Amplíe el cribado del paso 1, o revise la '
              + 'actividad detectada si cree que debería reconocer más.'
            : `el universo tiene ${negDisponibles} con la misma actividad detectada, así que no `
              + 'faltan candidatas: lo que faltó fue cupo. Suba el N objetivo en el paso 2.';
          anotar(`Se pidieron ${negObjetivo} comparables en pérdida y solo se incluyeron `
            + `${negIncluidas}: ${causa}`, 'aviso');
        }
        if (!String(engineConfig.justificacionPerdida || '').trim()) {
          anotar('Falta la justificación de la política de pérdidas: sin ella, el informe ' +
            'publica comparables en pérdida sin nada que explique por qué se admitieron. ' +
            'Escríbala en el paso 2.', 'aviso');
        }
      }
      /* Y las del año anterior que este año están en pérdida: siguen excluidas —la pérdida es
         un hecho del ejercicio en curso— pero hasta ahora se caían sin un solo aviso. */
      const previasEnPerdida = result.continuidadEnPerdida || [];
      if (previasEnPerdida.length) {
        anotar(`${previasEnPerdida.length} comparable(s) del estudio anterior están en pérdida ` +
          `este año y el filtro las excluyó: ${previasEnPerdida.join(', ')}. Retirar una ` +
          'comparable ya aceptada hay que justificarlo en el informe; si quiere conservarlas, ' +
          'ponga «Incluir» en Pérdidas Operativas.', 'aviso');
      }

      /* La ampliación a actividades afines se dice siempre que ocurre: es una decisión
         metodológica que hay que sustentar en el informe, no un detalle de implementación. */
      const ampliadas = result.ampliadas || 0;
      if (ampliadas) {
        anotar(`${ampliadas} entraron por actividad relacionada, no idéntica, para no bajar de ` +
          `${MINIMO_COMPARABLES} comparables. Revíselas una a una: hay que justificar en el informe ` +
          'la ampliación del criterio de búsqueda.', 'aviso');
      }

      /* La continuidad que la cuota obligó a retirar. Va en su propio aviso y con los
         nombres: retirar una comparable aceptada el año anterior se justifica en el informe, y
         antes desaparecían sin que nada lo dijera. */
      const desplazadas = result.continuidadDesplazada || [];
      if (desplazadas.length) {
        const nombres = desplazadas.map((c) => c.name).filter(Boolean);
        const muestra3 = nombres.slice(0, 3).join(', ');
        anotar(`La cuota de ${negObjetivo} comparable(s) en pérdida obligó a retirar `
          + `${desplazadas.length} del estudio anterior, las de menor puntaje`
          + (muestra3 ? `: ${muestra3}${nombres.length > 3 ? ` y ${nombres.length - 3} más` : ''}` : '')
          + `. Cada retiro hay que justificarlo en el informe. Si prefiere conservar la serie, `
          + `suba el N objetivo a ${result.continuidad + desplazadas.length + negIncluidas} y `
          + 'vuelva a correr: caben las dos cosas.', 'aviso');
      }

      if (result.continuidadExcedeObjetivo) {
        anotar(`El estudio anterior aporta ${deContinuidad} comparables, más que las ${nTarget} pedidas: ` +
          'no se descarta ninguna, porque retirar una comparable ya aceptada hay que justificarlo en el informe. ' +
          'Suba el N objetivo o revise la matriz del año anterior.', 'aviso');
      } else if (finales.length < MINIMO_COMPARABLES) {
        anotar(`Solo ${finales.length} comparables${composicion}, por debajo del mínimo de ${MINIMO_COMPARABLES}: ` +
          'ni ampliando a actividades relacionadas alcanza. Afloje los filtros del paso 2 —la pérdida operativa y ' +
          'el holding son los que más descartan—, revise la actividad detectada o traiga un universo más amplio ' +
          'de Capital IQ.', 'error');
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

    /* Las cifras de la base de datos, tal como llegaron del export de Capital IQ, antes
       de que las líneas de abajo las sobrescriban con las de la ficha. Se guardan la
       primera vez y no se vuelven a tocar: sin esto, recargar una ficha sobre una fila
       que ya tenía otra cotejaría ficha contra ficha —siempre cuadra— justo cuando el
       analista está corrigiendo una lectura mala, que es cuando el cotejo importa. */
    const previa = copia[indice] || {};
    const fuenteCifras = previa.fuenteCifras || { s: previa.s, c: previa.c, op: previa.op };

    /* Testigo externo de la lectura: el margen de la ficha contra el que la base de datos
       publica para esa misma compañía. `verificacion` solo mira la aritmética interna del
       documento, y una cifra tomada de la fila equivocada puede cuadrar consigo misma. */
    const cotejo = cotejarConFuente(datos, fuenteCifras);

    copia[indice] = {
      ...copia[indice],
      fuenteCifras,
      s: datos.ingresos_operacionales || copia[indice].s,
      c: datos.costo_ventas || copia[indice].c,
      op: datos.utilidad_operacional || copia[indice].op,
      ar: datos.cuentas_por_cobrar || copia[indice].ar,
      inv: datos.inventarios || copia[indice].inv,
      ap: datos.cuentas_por_pagar || copia[indice].ap,
      /* El parser ya leía PP&E —está en el esquema de los dos prompts, el individual
         y el de lote—, pero no se volcaba en la fila, así que llegaba en cero al
         ajuste y al Excel de soporte por más que el documento lo trajera. */
      ppe: datos.propiedad_planta_equipo || copia[indice].ppe,
      eeffDatos: datos,
      eeffVerificado: verificacion.esValido && cotejo.hallazgos.length === 0,
      eeffHallazgos: [...verificacion.hallazgos, ...cotejo.hallazgos],
      /* Que el cotejo no se pudo hacer —comparable cargada a mano, sin cifras de la base
         de datos en su fila— no es lo mismo que haberlo hecho y estar bien. Se deja dicho
         para que la pantalla del paso 4 pueda distinguirlo de un visto bueno. */
      eeffCotejado: cotejo.cotejado,
      eeffArchivo: archivo,
      /* Se guarda cómo cruzó: un cruce por solapamiento de palabras hay que
         confirmarlo a ojo, y sin dejar rastro nadie lo haría. */
      eeffCruce: cruce ? { modo: cruce.modo, punt: cruce.punt, nombreLeido: datos.nombre || '' } : null,
      eeffPorConfirmar: cruce ? !esCruceFirme(cruce) : false,
    };
    return copia;
  };

  /* El embudo tiene que seguir cuadrando: la tabla de razones de rechazo del informe
     comprueba que rechazos + aceptadas dé el universo evaluado. Bajar `seleccionadas`
     sin anotar las retiradas en ningún sitio haría fallar esa comprobación, así que
     van a `sinEeff`, que `filasRazonesRechazo` suma a las diferencias funcionales
     —el mismo destino que la reserva, y por la misma razón—.

     Si no hay embudo (estudio con comparables cargadas a mano, sin correr el motor del
     paso 3) no hay nada que ajustar. */
  const anotarRetiradasEnEmbudo = (cuantas) => {
    if (!cuantas) return;
    setSelectionFunnel((prev) => (prev ? {
      ...prev,
      seleccionadas: Math.max(0, (Number(prev.seleccionadas) || 0) - cuantas),
      sinEeff: (Number(prev.sinEeff) || 0) + cuantas,
    } : prev));
  };

  /* Lo mismo para la comparable que el analista retira A MANO con la papelera del paso 4. El
     embudo tiene que seguir cuadrando igual: sin esto la fila desaparecía de la pantalla y el
     informe seguía declarando las aceptadas de antes, así que la tabla de razones de rechazo
     decía una cifra y la de márgenes listaba otra. Y el descuadre no se veía, porque los conteos
     del embudo no habían cambiado y seguían sumando el universo evaluado.

     Se guarda la LISTA de las retiradas y no un contador: así retirar dos veces la misma no la
     cuenta dos veces, y `devolverAMuestra` puede deshacerlo. `filasRazonesRechazo` suma su
     longitud a las diferencias funcionales, el mismo destino que la reserva. */
  const retirarDeMuestra = (comp) => {
    const clave = (comp && comp.nameKey) || nameKey((comp && comp.name) || '');
    /* Una fila en blanco no es una comparable: no hay nada que anotar. */
    if (!clave) return;
    setSelectionFunnel((prev) => {
      if (!prev) return prev;
      const ya = Array.isArray(prev.retiradasManual) ? prev.retiradasManual : [];
      if (ya.includes(clave)) return prev;
      return {
        ...prev,
        seleccionadas: Math.max(0, (Number(prev.seleccionadas) || 0) - 1),
        retiradasManual: [...ya, clave],
      };
    });
  };

  /* Deshace el retiro manual de la comparable que vuelve a la muestra. */
  const devolverAMuestra = (nombre) => {
    const clave = nameKey(nombre || '');
    if (!clave) return;
    setSelectionFunnel((prev) => {
      const ya = (prev && Array.isArray(prev.retiradasManual)) ? prev.retiradasManual : [];
      if (!ya.includes(clave)) return prev;
      return {
        ...prev,
        seleccionadas: (Number(prev.seleccionadas) || 0) + 1,
        retiradasManual: ya.filter((k) => k !== clave),
      };
    });
  };

  /* Guarda las páginas rasterizadas de esta comparable para el ANEXO B. Se combina con
     lo que ya había: dos cargas sucesivas sobre comparables distintas no deben
     pisarse entre sí. */
  const guardarImagenesComparable = (clave, imagenes) => {
    if (!clave) return;
    setEeffImagenesComparables((prev) => ({ ...prev, [clave]: imagenes }));
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

      /* Mismo criterio que en la carga en lote, y por la misma razón: un documento sin
         cifras con las que calcular el margen no sostiene a la comparable, y aplicarlo
         dejaría en la fila las de Capital IQ como si este documento las respaldara. */
      const faltantes = partidasFaltantes(result.data);
      if (faltantes.length) {
        const nombre = (destino && destino.name) || (result.data && result.data.nombre);
        const { filas: filasFinales } = retirarFilas(comparables, new Set([compIndex]));
        setComparables(filasFinales);
        anotarRetiradasEnEmbudo(1);
        setResultadoCarga({
          aplicadas: [],
          rechazadas: [],
          retiradas: [{
            archivo: file.name,
            comparable: nombre || 'la comparable',
            motivo: motivoSinInformacionFinanciera(nombre, faltantes, file.name),
          }],
        });
        return;
      }

      const cruceEfectivo = traeNombre
        ? cruce
        : { modo: 'manual', punt: 1, comparable: destino, indice: compIndex };
      const filas = aplicarEeffEnFila(comparables, compIndex, result.data, result.verificacion, result.filename, cruceEfectivo);
      setComparables(filas);

      /* Imagen del EEFF para el Anexo B: no bloquea lo anterior si falla. Recortada al
         cuadro, para que quepa debajo de la tabla de descripción de su comparable. */
      const clave = nameKey(filas[compIndex].name || '');
      const imagenes = await recortarPaginas(await rasterizarConReintento(file));
      guardarImagenesComparable(clave, imagenes);
      const avisoImagen = imagenes.length
        ? ''
        : ' No se pudieron adjuntar las páginas del EEFF para el ANEXO B (revise que el archivo no esté dañado, o inténtelo de nuevo); las cifras se aplicaron igual.';

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
          motivo: (traeNombre
            ? motivoCruce(cruce, result.data, file.name)
            : 'El documento no trae razón social, así que se aplicó a «' + destino.name +
            '» sin poder verificar que le corresponde: confírmalo.') + avisoImagen,
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

    /* Sin comparables en la tabla no hay a qué fila aplicar nada, y leer los documentos
       primero para rechazarlos después cuesta una consulta a Gemini por archivo —minutos y
       dinero— para acabar en una lista de rechazos idénticos. Se avisa antes de leer. */
    if (!comparables.length) {
      setResultadoCarga({
        aplicadas: [],
        rechazadas: lista.map((f) => ({
          archivo: f.name,
          motivo: 'El estudio todavía no tiene comparables en la tabla, así que no hay ninguna fila a ' +
            'la que aplicar sus cifras. Ejecute la selección del paso 3 y vuelva a cargar los ' +
            'estados financieros. No se leyó ningún documento, así que no se gastó ninguna consulta.',
        })),
      });
      return;
    }

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
          } else {
            /* Una sola rasterización por archivo: el PDF de lote puede traer varias
               empresas, y cada una se recorta de este mismo arreglo más abajo. El
               recorte del papel en blanco va aquí, sobre el archivo completo, y no por
               empresa: es el mismo trabajo una sola vez, y deja el reparto por página
               de más abajo sincrónico. */
            const imagenesDelArchivo = await recortarPaginas(await rasterizarConReintento(file));
            entradas.push(...leidas.map((l) => ({ ...l, _imagenesDelArchivo: imagenesDelArchivo })));
          }
        } catch (err) {
          fallosLectura.push({ archivo: file.name, motivo: 'No se pudo leer: ' + (err?.message || err) });
        }
      }

      setCargaEeff({ etapa: 'Cruzando ' + entradas.length + ' empresa(s) con las comparables…', hechas: lista.length, total: lista.length });
      const { aplicadas, rechazadas } = repartir(entradas, comparables);

      /* Las que cruzaron pero cuyo documento no trae con qué calcular el margen salen de
         la muestra en vez de aplicarse. Volcarlas dejaría en la fila las cifras que ya
         traía de Capital IQ como si este documento las respaldara, y la comparable
         seguiría en el rango sin soporte. */
      const { conCifras, sinCifras } = separarPorSuficiencia(aplicadas);

      /* Se acumulan todas las filas antes de un único setComparables: un set por
         empresa se sobrescribiría entre iteraciones y solo entraría la última. */
      let filas = comparables;
      conCifras.forEach((a) => {
        filas = aplicarEeffEnFila(filas, a.indice, a.datos, a.verificacion, a.archivo, a.cruce);
      });

      /* Imágenes por empresa, recortadas del PDF de lote al que pertenecen. Se hace
         después de aplicar las cifras: la clave (nameKey) sale del nombre ya asentado
         en la fila, que puede diferir en mayúsculas/acentos del que trajo el documento. */
      conCifras.forEach((a) => {
        const clave = nameKey(filas[a.indice].name || '');
        const imagenesArchivo = a._imagenesDelArchivo || [];
        if (!imagenesArchivo.length) {
          a.motivo += ' No se pudieron adjuntar las páginas del EEFF para el ANEXO B (revise que el archivo no esté dañado, o inténtelo de nuevo); las cifras se aplicaron igual.';
          return;
        }
        const { imagenes, delimitada } = recortarPorPagina(imagenesArchivo, a.datos.pagina_inicio, a.datos.pagina_fin);
        guardarImagenesComparable(clave, imagenes);
        if (!delimitada) {
          a.motivo += ' No se pudo delimitar la página de esta empresa dentro del documento; se adjuntó el PDF completo — revisa que no incluya páginas de otras comparables.';
        }
      });

      /* El retiro va después de aplicar y de recortar las imágenes, que trabajan sobre
         los índices originales, y antes de publicar y de pedir las descripciones, que
         reciben ya los nuevos. */
      const retiradas = sinCifras.map((a) => ({
        archivo: a.archivo,
        comparable: (filas[a.indice] && filas[a.indice].name)
          || (a.datos && a.datos.nombre) || 'la comparable',
        motivo: motivoSinInformacionFinanciera(
          (filas[a.indice] && filas[a.indice].name) || (a.datos && a.datos.nombre),
          a.faltantes, a.archivo,
        ),
      }));
      const aRetirar = new Set(sinCifras.map((a) => a.indice));
      const { filas: filasFinales, nuevoIndice } = retirarFilas(filas, aRetirar);
      const indicesAplicados = conCifras
        .map((a) => (nuevoIndice ? nuevoIndice.get(a.indice) : a.indice))
        .filter((i) => i != null);

      if (conCifras.length || aRetirar.size) setComparables(filasFinales);
      anotarRetiradasEnEmbudo(aRetirar.size);
      if (indicesAplicados.length) {
        await publicarEeff(filasFinales, indicesAplicados);
        redactarDescripcionesDeFilas(filasFinales, indicesAplicados).catch((err) =>
          console.error('[MotorComparables] no se pudo redactar la descripción de actividad', err)
        );
      }
      setResultadoCarga({
        aplicadas: conCifras,
        rechazadas: [...rechazadas, ...fallosLectura],
        retiradas,
      });
    } finally {
      setUploadingEEFF(false);
      setCargaEeff(null);
    }
  };

  const handleRowChange = (index, key, value) => {
    const next = [...comparables];
    next[index][key] = value;
    setComparables(next);
    /* Si el nombre que se escribe es el de una comparable retirada a mano antes, se deshace ese
       retiro: es lo que permite corregir un borrado por error sin dejar el embudo contando una
       baja que ya no existe. */
    if (key === 'name') devolverAMuestra(value);
  };

  const addComparable = () => {
    setComparables([...comparables, {
      name: '', amb: 'Int', s: '', c: '', op: '', ar: '', inv: '', ap: '', ppe: '', sic: '', id: Date.now().toString(),
      /* Nace fuera del motor, así que nunca estuvo en el embudo: retirarla no puede descontar
         una aceptada que el embudo no contó. Sin esta marca, añadir una a mano y volver a
         quitarla dejaba la tabla de razones de rechazo con una baja inventada. */
      aMano: true,
    }]);
  };

  const removeComparable = (index) => {
    const fila = comparables[index];
    setComparables(comparables.filter((_, i) => i !== index));
    /* Y se anota en el embudo, como hace la retirada automática por falta de estado financiero.
       Quitar la fila y no anotarla dejaba el informe declarando más comparables aceptadas de las
       que la muestra tiene, sin que nada lo advirtiera. */
    if (!fila || fila.aMano) return;
    retirarDeMuestra(fila);
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
    ap: num(study.t_ap),
    /* PP&E faltaba aquí, y este `T` es el que viaja al Excel de soporte: el libro
       salía con la propiedad, planta y equipo de la parte examinada en cero aunque
       el estudio la tuviera cargada. */
    ppe: num(study.t_ppe),
  };

  const tPLI = pliOf(T, kind);
  const tR = ratios(T);

  /* El rango lo calcula `analizarRango`, el mismo servicio que alimenta el informe
     Word y el Excel de soporte. Esta pantalla repetía aquí la fórmula del ajuste, de
     modo que el tablero, el documento y el libro podían publicar tres rangos
     distintos sobre las mismas comparables. `comparables` y `cmode` van del estado
     local y no de `study` porque el efecto que los sincroniza corre después. */
  const rango = analizarRango({ ...study, comparables, cmode });

  const calculatedRows = comparables.map((c, idx) => {
    const fila = rango.filas[idx] || {};
    const pliVal = fila.noAjustado ?? null;
    const adjustedPli = fila.ajustado ?? null;
    return {
      ...c,
      pli: pliVal,
      /* El ajuste es la diferencia entre las dos columnas, no un tercer cálculo:
         así lo que se muestra cuadra siempre con lo que se sumó de verdad. */
      adj: pliVal === null || adjustedPli === null ? 0 : adjustedPli - pliVal,
      ratiosComp: ratios({
        s: num(c.s), c: num(c.c), op: num(c.op),
        ar: num(c.ar), inv: num(c.inv), ap: num(c.ap),
      }),
      adjustedPli,
      isIncluded: cmode === 'all' ? true : (cmode === 'intl' ? c.amb === 'Int' : c.amb === 'Nac'),
    };
  });

  /* Filas ordenadas por PLI ajustado: es la serie exacta sobre la que se calcula
     el rango. Se conserva con nombre (no solo el número) para que el Excel de
     soporte pueda mostrar de qué comparable sale cada percentil, no solo la
     fórmula en abstracto. */
  const activeRowsOrdenadas = calculatedRows
    .filter(r => r.isIncluded && r.adjustedPli !== null)
    .sort((a, b) => a.adjustedPli - b.adjustedPli);
  const activeSeries = activeRowsOrdenadas.map(r => r.adjustedPli);

  const stats = rango.stats;

  const adjustment = (stats && tPLI !== null) ? adjustInfo(T, tPLI, stats, T.s || 0, 1, study.egreso) : null;

  /* Por qué no cumple y qué queda por probar. La tarjeta decía «NO CUMPLE (por debajo)» y
     nada más: ni la brecha, ni el ajuste en pesos que `adjustInfo` ya traía en `capped`, ni
     cuál de los dos rangos sostenía la conclusión. El servicio prueba cada palanca de verdad
     —recalcula el rango con ella aplicada— y solo devuelve las que cambian el veredicto.
     `comparables`, `cmode` y `engineConfig` van del estado local y no de `study` porque el
     efecto que los persiste corre después del render: el diagnóstico tiene que explicar el
     rango que se está viendo, no el del render anterior.
     Se memoriza porque recalcula el rango varias veces (una por palanca) y este componente
     re-renderiza con cada tecla de los filtros. */
  const diagnostico = useMemo(() => diagnosticarCumplimiento({
    estudio: { ...study, comparables, cmode, motorConfig: engineConfig },
    comparables,
    cmode,
    universo,
  }), [study, comparables, cmode, engineConfig, universo]);

  /* Excel de soporte del motor: documenta filtros, comparables (seleccionadas,
     rechazadas y en reserva), el rango intercuartil y el desglose del ajuste de
     capital de trabajo. Solo arma lo que ya está calculado en este componente. */
  const handleExportarExcel = () => {
    if (!comparables.length) {
      alert('No hay comparables cargadas: importe o agregue al menos una antes de exportar el Excel de soporte.');
      return;
    }
    /* El universo es el import crudo: el motivo de rechazo y el perfil funcional los
       aporta la auditoría del motor (ver `enriquecerUniverso`). */
    const candidatasUniverso = Array.isArray(universo) && universo.length > 0
      ? enriquecerUniverso(universo, calculatedRows || comparables, auditoria)
      : null;

    /* El payload lo arma `construirPayloadSoporte` desde el estudio en bruto, y no este
       componente a mano: la versión anterior enumeraba seis campos del estudio y las
       siete cifras de `T`, de modo que los ocho rubros del ESF —efectivo, inversiones
       asociadas, impuestos corrientes, los tres subtotales, intangibles y diferidos— y el
       `cmode` del tablero nunca llegaban al libro, que los publicaba en cero.

       `prime` va en porcentaje, tal como lo escribe el usuario: es lo que espera el
       generador. `interestRate` es el mismo número ya dividido entre 100, que usa el
       cálculo de esta pantalla; se conserva porque otros consumidores del payload lo leen,
       pero el Excel no debe tomarlo de ahí. */
    const datos = construirPayloadSoporte(study, {
      pli: kind,
      useAdj,
      interestRate,
      cmode,
      examinada: { T, tPLI, tR },
      rango: { stats, activeCount: activeSeries.length, adjustment },
      filtros: { engineConfig, selectionFunnel },
      comparables: calculatedRows,
      auditoria,
      /* Sin `universo` (candidatasUniverso null: estudio con comparables cargadas a mano,
         sin importar el Excel de Capital IQ) se omite `seleccion` para que
         construirLibroSoporte caiga en su propio fallback (comparables + rechazadas +
         reserva) en vez de armar una hoja «Selección comparables» vacía. */
      ...(candidatasUniverso ? {
        seleccion: {
          criterios: criteriosScreening || [],
          umbralControl: engineConfig.umbralControl,
          candidatas: candidatasUniverso,
        }
      } : {}),
    });
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
                onClick={() => {
                  setActividad(actInput);
                  updateStudy({ actividad_especifica: actInput });
                  setEditingAct(false);
                  setSelectionFunnel(null);
                  setMotorAuditoria(null);
                }}
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
                <CheckCircle className="w-4 h-4" /> {universo.length} candidatas cargadas.
              </span>
            )}
            {restaurando && (
              <span className="text-xs text-sky-600 dark:text-sky-400 font-semibold flex items-center gap-1">
                <RefreshCw className="w-4 h-4 animate-spin" /> Restaurando el cribado guardado…
              </span>
            )}
            {/* Distingue «guardado» de «solo en esta pestaña»: es la diferencia entre
                poder reabrir el estudio y tener que volver a cargar el archivo. */}
            {!restaurando && cribadoIQ && cribadoIQ.ruta ? (
              <span className="text-xs text-zinc-500 flex items-center gap-1" title={`Guardado en la nube: ${cribadoIQ.archivo || ''}`}>
                <FileCheck className="w-4 h-4" /> Cribado guardado
                {cribadoIQ.subidoEn ? ` el ${new Date(cribadoIQ.subidoEn).toLocaleDateString('es-CO')}` : ''}
                {cribadoIQ.curacion ? ' · curación incluida' : ''}
              </span>
            ) : (!restaurando && universo.length > 0 && (
              <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                <AlertTriangle className="w-4 h-4" /> Solo en esta pestaña: al reabrir habrá que cargar el Excel otra vez.
              </span>
            ))}
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
          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 -mt-1 leading-relaxed">
            Estos cuatro filtros se aplican <b>antes</b> de curar con IA, así que la curación solo
            evalúa —y solo se paga por— lo que los pasa. Los números de la derecha de cada control
            son el efecto real sobre el cribado que ya cargaste: se calculan aquí, sin gastar una
            sola consulta.
          </p>

          {/* ══ Los avisos: solo cuando lo que dicen es cierto y comprobable ══
              Un panel que avisa de todo enseña a ignorar los avisos, que es lo que ya le pasó a
              los del generador antes de que se acotaran. Los emite `previsualizarFiltros`; aquí
              solo se pintan. */}
          {previsualizacion.avisos.length > 0 && (
            <div className="space-y-1.5">
              {previsualizacion.avisos.map((a) => (
                <div
                  key={a.clave}
                  className={`rounded-lg p-2.5 flex items-start gap-2 text-[11.5px] leading-relaxed border ${a.severidad === 'bloqueo'
                    ? 'bg-rose-50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900/50 text-rose-900 dark:text-rose-200'
                    : 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900/50 text-amber-900 dark:text-amber-200'
                    }`}
                >
                  {a.severidad === 'bloqueo'
                    ? <Ban className="w-4 h-4 mt-px shrink-0" />
                    : <AlertTriangle className="w-4 h-4 mt-px shrink-0" />}
                  <span>{a.texto}</span>
                </div>
              ))}
            </div>
          )}

          {/* ══ Decisiones de método ══
              Arriba y siempre visibles porque son las que hay que justificar en el informe: la
              política de pérdidas con su cuota, y la independencia con su umbral. */}
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 p-3 space-y-3">
            <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
              Decisiones de método
            </span>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col">
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <label className="text-[11px] font-semibold text-zinc-500">Pérdidas Operativas</label>
                  <CostoDelFiltro
                    paso={previsualizacion.pasos.find((x) => x.clave === 'perdidaOperativa')}
                    universo={previsualizacion.universo}
                    expandido={filtroExpandido === 'perdidaOperativa'}
                    alExpandir={() => setFiltroExpandido(filtroExpandido === 'perdidaOperativa' ? null : 'perdidaOperativa')}
                  />
                </div>
                <select
                  value={engineConfig.perdidaOp}
                  onChange={(e) => cambiarConfig('perdidaOp', e.target.value)}
                  className="bg-[#ffffff] dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-950 dark:text-zinc-100 focus:outline-none"
                >
                  <option value="excluir">Excluir (criterio conservador DIAN)</option>
                  <option value="incluir">Incluir (criterio OCDE)</option>
                </select>
                {previsualizacion.hayUniverso && (
                  <span className="text-[10px] text-zinc-400 mt-1">
                    El cribado trae {mil(previsualizacion.enPerdidaEnUniverso)} compañía(s) en pérdida.
                  </span>
                )}
              </div>

              {/* Cuántas comparables en pérdida se quieren en el informe. Cuenta dentro del N
                  objetivo, no aparte, y es también un tope: pedir 3 no puede devolver 5.
                  Deshabilitado mientras la política excluya pérdidas — con «excluir» no hay
                  negativas que repartir, y dejar el campo activo prometería algo que el motor
                  va a ignorar. La UI lo dice en vez de cambiar la política por su cuenta. */}
              <div className="flex flex-col">
                <label className="text-[11px] font-semibold text-zinc-500 mb-1">Negativas objetivo</label>
                <input
                  type="number"
                  min="0"
                  max={engineConfig.nTarget}
                  disabled={engineConfig.perdidaOp === 'excluir'}
                  value={engineConfig.negativasObjetivo ?? 0}
                  onChange={(e) => cambiarConfig('negativasObjetivo', Math.max(0, Number(e.target.value) || 0))}
                  title={engineConfig.perdidaOp === 'excluir'
                    ? 'Cambie «Pérdidas Operativas» a Incluir para poder pedir comparables en pérdida'
                    : 'Cuántas comparables en pérdida debe traer la muestra, dentro del N objetivo'}
                  className="bg-[#ffffff] dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-950 dark:text-zinc-100 focus:outline-none disabled:opacity-40 disabled:cursor-not-allowed"
                />
                <span className="text-[10px] text-zinc-400 mt-1">
                  {engineConfig.perdidaOp === 'excluir'
                    ? 'Ponga «Incluir» para habilitarlo'
                    : `Dentro de las ${engineConfig.nTarget}, misma actividad. Reserva cupo antes del puntaje: sin cuota no entra ninguna.`}
                </span>
              </div>

              <div className="flex flex-col">
                <div className="flex items-baseline justify-between gap-2 mb-1">
                  <label className="text-[11px] font-semibold text-zinc-500">Independencia (Art. 260-1)</label>
                  <CostoDelFiltro
                    paso={previsualizacion.pasos.find((x) => x.clave === 'controlada')}
                    universo={previsualizacion.universo}
                    expandido={filtroExpandido === 'controlada'}
                    alExpandir={() => setFiltroExpandido(filtroExpandido === 'controlada' ? null : 'controlada')}
                  />
                </div>
                <select
                  value={engineConfig.control ?? 'excluir'}
                  onChange={(e) => cambiarConfig('control', e.target.value)}
                  className="bg-[#ffffff] dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-950 dark:text-zinc-100 focus:outline-none"
                >
                  <option value="excluir">Excluir controladas</option>
                  <option value="incluir">Incluir</option>
                </select>
                <span className="text-[10px] text-zinc-400 mt-1">
                  No perdona a las del estudio anterior: no ser independiente es un hecho de hoy.
                </span>
              </div>

              {/* El umbral es la palanca de más peso del paso 2 —sobre el cribado de Makita
                  saca 238 al 50 % y 775 al 25 %— y era un campo mudo. Con el costo al lado,
                  moverlo deja de ser a ciegas. */}
              <div className="flex flex-col">
                <label className="text-[11px] font-semibold text-zinc-500 mb-1">Umbral de control (%)</label>
                <input
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  value={engineConfig.umbralControl ?? 50}
                  disabled={(engineConfig.control ?? 'excluir') !== 'excluir'}
                  onChange={(e) => cambiarConfig('umbralControl', Number(e.target.value))}
                  className="bg-[#ffffff] dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-950 dark:text-zinc-100 focus:outline-none disabled:opacity-40"
                />
                <span className="text-[10px] text-zinc-400 mt-1">
                  Baje el umbral y el filtro se endurece: se ve al instante en el número de arriba.
                </span>
              </div>

              {/* Los ejemplos ocupan las dos columnas: cinco razones sociales de Capital IQ no
                  caben en la columna de un selector. */}
              {['perdidaOperativa', 'controlada'].includes(filtroExpandido) && (
                <EjemplosDelFiltro paso={previsualizacion.pasos.find((x) => x.clave === filtroExpandido)} />
              )}
            </div>

            {/* La justificación de admitir comparables en pérdida. Solo aparece cuando de verdad
                se van a admitir: pedirla siempre la convertiría en un campo que se rellena sin
                leer. Va al embudo, que se persiste con el estudio y que el informe y el Excel de
                soporte ya leen: es lo que impide que el documento radicado publique comparables
                en pérdida sin nada que explique por qué están ahí. */}
            {(engineConfig.negativasObjetivo ?? 0) > 0 && (
              <div className="flex flex-col pt-1">
                <label className="text-[11px] font-semibold text-zinc-500 mb-1">
                  Justificación de admitir pérdidas
                  {!String(engineConfig.justificacionPerdida || '').trim() && (
                    <span className="text-amber-600 dark:text-amber-400 font-normal"> · falta, y va al informe</span>
                  )}
                </label>
                <textarea
                  rows={2}
                  value={engineConfig.justificacionPerdida || ''}
                  onChange={(e) => cambiarConfig('justificacionPerdida', e.target.value)}
                  placeholder="Ej: Guías OCDE cap. III §3.64-3.65 — las pérdidas de las comparables reflejan condiciones normales del mercado en el año gravable y su exclusión sesgaría el rango al alza."
                  className="w-full bg-[#ffffff] dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-950 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-[#0FA3A1]/50"
                />
                <span className="text-[10px] text-zinc-400 mt-1">
                  Se publica con el estudio y viaja al Excel de soporte. Escríbala antes de radicar.
                </span>

                {/* ══ El asistente ══
                    Pide la CAUSA porque es lo único que no está en los datos: las Guías OCDE
                    (cap. III, §3.64-3.65) no dicen «las pérdidas se admiten», dicen que una
                    pérdida no descalifica siempre que se analice su causa. El resto —cifras,
                    fundamento normativo, argumento del sesgo— sale del estudio. */}
                <div className="mt-3 rounded-lg border border-zinc-200 dark:border-zinc-800 p-2.5 space-y-2">
                  <label className="text-[11px] font-semibold text-zinc-500 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-[#0FA3A1]" />
                    ¿Por qué el sector tuvo pérdidas en {study.anio || 'el año gravable'}?
                  </label>
                  <textarea
                    rows={2}
                    value={study.causaPerdidasSector || ''}
                    onChange={(e) => updateStudy({ causaPerdidasSector: e.target.value })}
                    placeholder="Dos líneas bastan: contracción de la demanda, alza de un insumo importado, devaluación, sobreoferta del sector…"
                    className="w-full bg-[#ffffff] dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-950 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-[#0FA3A1]/50"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={redactarJustificacion}
                      disabled={redactando}
                      className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-[#0FA3A1] text-white hover:bg-[#0B7C7A] disabled:opacity-50 flex items-center gap-1.5"
                    >
                      {redactando
                        ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Redactando…</>
                        : <><Sparkles className="w-3.5 h-3.5" /> Redactar con IA</>}
                    </button>
                    <span className="text-[10px] text-zinc-400">
                      Usa las cifras reales del estudio y no inventa causas: solo la que escriba arriba.
                    </span>
                  </div>

                  {avisoJustificacion && (
                    <p className="text-[11px] text-amber-700 dark:text-amber-400 leading-relaxed">
                      {avisoJustificacion}
                    </p>
                  )}

                  {/* El borrador se propone; no pisa lo que haya hasta que se acepte. */}
                  {borradorJustificacion && (
                    <div className="rounded-lg bg-zinc-50 dark:bg-[#09090b] border border-[#0FA3A1]/40 p-2.5 space-y-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                        Borrador propuesto
                      </span>
                      <p className="text-[11.5px] text-zinc-700 dark:text-zinc-300 leading-relaxed whitespace-pre-wrap">
                        {borradorJustificacion}
                      </p>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            cambiarConfig('justificacionPerdida', borradorJustificacion);
                            setBorradorJustificacion(null);
                          }}
                          className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700"
                        >
                          Usar este texto
                        </button>
                        <button
                          type="button"
                          onClick={() => setBorradorJustificacion(null)}
                          className="text-[11px] px-3 py-1.5 rounded-lg border border-zinc-300 dark:border-zinc-700 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                        >
                          Descartar
                        </button>
                        <span className="text-[10px] text-zinc-400">
                          Léalo antes de aceptarlo: se radica.
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* ══ Afinaciones ══
              Plegadas, con su costo en la propia barra: esconderlas no puede ocultar un
              descarte. */}
          <div className="rounded-lg border border-zinc-200 dark:border-zinc-800">
            <button
              type="button"
              onClick={() => setAfinacionesAbiertas(!afinacionesAbiertas)}
              className="w-full flex items-center justify-between gap-2 p-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900/40 rounded-lg transition-colors"
            >
              <span className="flex items-center gap-1.5">
                {afinacionesAbiertas
                  ? <ChevronDown className="w-3.5 h-3.5 text-zinc-400" />
                  : <ChevronRight className="w-3.5 h-3.5 text-zinc-400" />}
                <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                  Afinaciones
                </span>
                <span className="text-[10.5px] text-zinc-500">
                  N objetivo, holding, saldos negativos, geografía
                </span>
              </span>
              {previsualizacion.hayUniverso && (
                <span className="text-[10.5px] text-zinc-500 shrink-0">
                  sacan{' '}
                  <b className="text-zinc-700 dark:text-zinc-300">
                    {mil(previsualizacion.pasos
                      .filter((x) => x.clave === 'holding' || x.clave === 'saldoNegativo')
                      .reduce((n, x) => n + x.saca, 0))}
                  </b>
                </span>
              )}
            </button>

            {afinacionesAbiertas && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-3 pt-0">
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
                  <span className="text-[10px] text-zinc-400 mt-1">
                    Cuántas entran en la muestra. Piso normativo del motor: {MINIMO_COMPARABLES}.
                  </span>
                </div>

                <div className="flex flex-col">
                  <div className="flex items-baseline justify-between gap-2 mb-1">
                    <label className="text-[11px] font-semibold text-zinc-500">Sociedades Holding</label>
                    <CostoDelFiltro
                      paso={previsualizacion.pasos.find((x) => x.clave === 'holding')}
                      universo={previsualizacion.universo}
                      expandido={filtroExpandido === 'holding'}
                      alExpandir={() => setFiltroExpandido(filtroExpandido === 'holding' ? null : 'holding')}
                    />
                  </div>
                  <select
                    value={engineConfig.holding}
                    onChange={(e) => cambiarConfig('holding', e.target.value)}
                    className="bg-[#ffffff] dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-950 dark:text-zinc-100 focus:outline-none"
                  >
                    <option value="excluir">Excluir (sin actividad propia)</option>
                    <option value="incluir">Incluir</option>
                  </select>
                  <span className="text-[10px] text-zinc-400 mt-1">
                    Se presume de la razón social: revise los ejemplos, por el nombre se acierta de más.
                  </span>
                </div>

                <div className="flex flex-col">
                  <div className="flex items-baseline justify-between gap-2 mb-1">
                    <label className="text-[11px] font-semibold text-zinc-500">Saldos Negativos</label>
                    <CostoDelFiltro
                      paso={previsualizacion.pasos.find((x) => x.clave === 'saldoNegativo')}
                      universo={previsualizacion.universo}
                      expandido={filtroExpandido === 'saldoNegativo'}
                      alExpandir={() => setFiltroExpandido(filtroExpandido === 'saldoNegativo' ? null : 'saldoNegativo')}
                    />
                  </div>
                  <select
                    value={engineConfig.saldoNegativo}
                    onChange={(e) => cambiarConfig('saldoNegativo', e.target.value)}
                    className="bg-[#ffffff] dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-950 dark:text-zinc-100 focus:outline-none"
                  >
                    <option value="excluir">Excluir (datos no verosímiles)</option>
                    <option value="incluir">Incluir</option>
                  </select>
                  <span className="text-[10px] text-zinc-400 mt-1">
                    Cartera, cuentas por pagar o inventarios en negativo. No son pérdidas.
                  </span>
                </div>

                {/* No descarta a nadie, y el rótulo lo dice. Parecía un filtro. */}
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
                  <span className="text-[10px] text-zinc-400 mt-1">
                    {previsualizacion.geografia.texto}
                  </span>
                </div>

                {['holding', 'saldoNegativo'].includes(filtroExpandido) && (
                  <EjemplosDelFiltro paso={previsualizacion.pasos.find((x) => x.clave === filtroExpandido)} />
                )}
              </div>
            )}
          </div>

          {/* ══ El cierre: qué queda, qué entra, y qué se va a pagar ══
              Reencuadra la pantalla: casi nunca manda el filtro, manda el cupo. Y el costo de la
              curación es el dato que faltaba para no configurar a ciegas. */}
          {previsualizacion.hayUniverso && (
            <div className="rounded-lg bg-zinc-50 dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 p-3 space-y-2">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-[11.5px]">
                <span className="text-zinc-500">
                  Universo <b className="text-zinc-800 dark:text-zinc-200">{mil(previsualizacion.universo)}</b>
                </span>
                <span className="text-zinc-400">→</span>
                <span className="text-zinc-500">
                  pasan los filtros <b className="text-zinc-800 dark:text-zinc-200">{mil(previsualizacion.quedan)}</b>
                </span>
                <span className="text-zinc-400">→</span>
                <span className="text-zinc-500">
                  entran <b className="text-[#0B7C7A] dark:text-[#0FA3A1]">{mil(previsualizacion.entran)}</b>
                  {previsualizacion.reserva > 0 && (
                    <span className="text-zinc-400"> · {mil(previsualizacion.reserva)} en reserva</span>
                  )}
                </span>
              </div>

              {previsualizacion.curacion.aCurar > 0 ? (
                <div className="flex items-start gap-1.5 text-[11px] text-zinc-600 dark:text-zinc-400 leading-relaxed">
                  <Clock className="w-3.5 h-3.5 mt-px shrink-0 text-zinc-400" />
                  <span>
                    Al ejecutar el paso 3 se curarán{' '}
                    <b>{mil(previsualizacion.curacion.aCurar)}</b> candidatas en{' '}
                    {previsualizacion.curacion.lotes} lote(s), ~{previsualizacion.curacion.etaMinutos} min
                    {previsualizacion.curacion.reutilizadas > 0
                      && ` · ${mil(previsualizacion.curacion.reutilizadas)} ya curadas se reutilizan sin volver a pagarse`}
                    {previsualizacion.curacion.sinDatosParaCurar > 0
                      && ` · ${mil(previsualizacion.curacion.sinDatosParaCurar)} sin descripción del negocio pasan a la heurística, sin costo`}.
                  </span>
                </div>
              ) : (
                <div className="text-[11px] text-zinc-500">
                  No hay candidatas nuevas que curar con esta configuración.
                </div>
              )}

              {/* Aquí termina lo que se puede afirmar sin la IA, y se dice. */}
              <div className="text-[10.5px] text-zinc-400 leading-relaxed border-t border-zinc-200 dark:border-zinc-800 pt-2">
                De aquí en adelante decide la curación: si la actividad de cada candidata coincide
                con la del contribuyente solo lo sabe el modelo, así que este embudo no lo estima.
                {previsualizacion.continuidad.total > 0 && (
                  <> El estudio anterior aporta {previsualizacion.continuidad.total} comparable(s)
                    {previsualizacion.continuidad.caen.length === 0
                      ? ', y esta configuración las conserva todas.'
                      : '.'}
                  </>
                )}
              </div>
            </div>
          )}
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
                {/* «Diferencias funcionales» y no «rigor»: el filtro de rigor funcional se
                    retiró del motor el 2026-08-10 y su selector salió del paso 2 el 2026-09-01,
                    pero esta casilla seguía llamándose por él y hasta mostraba su valor entre
                    paréntesis. El número nunca fue suyo: son las que superan los filtros
                    objetivos, pasan la curación y no alcanzan el cupo. Así las nombran ya la
                    Tabla 16 del informe y la hoja del embudo del Excel de soporte, y la pantalla
                    tiene que coincidir con lo que se radica. */}
                {/* Cuenta la RESERVA y no `rechazadasRigor`: las de reserva no pasan por
                    `rechazadas` —el informe las suma aparte y meterlas en las dos listas
                    descuadraría la tabla contra el universo—, así que esta casilla mostraba 0
                    con 738 en reserva. Se reportó exactamente así. */}
                <div>
                  Diferencias funcionales{' '}
                  <b className={'tabular-nums ' + ((selectionFunnel.reserva ?? 0) > 0 ? 'text-amber-600 dark:text-amber-400' : '')}>
                    {(selectionFunnel.reserva ?? 0).toLocaleString('es-CO')}
                  </b>
                  <span className="text-zinc-400" title="Superan los filtros objetivos y la curación, pero no alcanzan el cupo de la muestra (Art. 260-4)"> (Art. 260-4)</span>
                </div>
                <div>Válidas <b className="tabular-nums">{selectionFunnel.validas.toLocaleString('es-CO')}</b></div>
                <div>
                  Seleccionadas{' '}
                  <b className={'tabular-nums ' + (selectionFunnel.objetivo && selectionFunnel.seleccionadas < selectionFunnel.objetivo ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400')}>
                    {selectionFunnel.seleccionadas}
                  </b>
                  {selectionFunnel.objetivo ? <span className="text-zinc-400"> de {selectionFunnel.objetivo}</span> : null}
                  {selectionFunnel.ampliadas ? (
                    <span className="text-zinc-400"> ({selectionFunnel.ampliadas} por actividad relacionada)</span>
                  ) : null}
                </div>
              </div>
              {/* La ampliación a actividades afines se declara aquí y no solo en el registro:
                  es lo que hay que sustentar en el informe si la DIAN lo pregunta. */}
              {selectionFunnel.ampliadas ? (
                <div className="text-amber-600 dark:text-amber-400">
                  {selectionFunnel.ampliadas} de las seleccionadas no son de la misma actividad sino de una
                  relacionada, y entraron para no bajar del mínimo de {MINIMO_COMPARABLES}. Revíselas: la ampliación
                  del criterio de búsqueda hay que justificarla en el informe.
                </div>
              ) : null}
              {selectionFunnel.seleccionadas < MINIMO_COMPARABLES ? (
                <div className="text-red-600 dark:text-red-400">
                  Por debajo del mínimo de {MINIMO_COMPARABLES}: ni ampliando a actividades relacionadas alcanza.
                  Afloje los filtros del paso 2, revise la actividad detectada o traiga un universo más amplio.
                </div>
              ) : selectionFunnel.objetivo && selectionFunnel.seleccionadas < selectionFunnel.objetivo ? (
                <div className="text-amber-600 dark:text-amber-400">
                  No se alcanzó el objetivo: tras la curación no quedó reserva suficiente. Amplíe los criterios del paso 2 o revise la actividad detectada.
                </div>
              ) : null}
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

              {/* Comparables retiradas de la muestra porque su EEFF no traía cifras. Es un
                  estado distinto de «rechazado»: ahí no se aplicó un documento, aquí se
                  quitó una comparable del estudio, y eso cambia el tamaño de la muestra.
                  Este aviso vive solo en pantalla: no se escribe en el Excel de soporte
                  —donde la compañía aparece contada entre las diferencias funcionales— ni
                  en el informe. */}
              {(resultadoCarga.retiradas || []).length > 0 && (
                <div className="rounded-lg px-4 py-3 text-xs border bg-orange-50 dark:bg-orange-950/20 border-orange-200 dark:border-orange-900 text-orange-800 dark:text-orange-300">
                  <div className="flex items-start gap-2">
                    <ShieldAlert className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                    <div>
                      <div className="font-semibold">
                        {resultadoCarga.retiradas.length === 1
                          ? '1 comparable salió de la muestra por falta de información financiera'
                          : `${resultadoCarga.retiradas.length} comparables salieron de la muestra por falta de información financiera`}
                        {selectionFunnel ? ` · la muestra queda en ${selectionFunnel.seleccionadas}` : ''}
                      </div>
                      <ul className="mt-1.5 space-y-1.5">
                        {resultadoCarga.retiradas.map((r, i) => (
                          <li key={'ret' + i}>
                            <span className="font-semibold">{r.comparable}</span>
                            <span className="block leading-relaxed">{r.motivo}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}

              {!resultadoCarga.aplicadas.length && !resultadoCarga.rechazadas.length
                && !(resultadoCarga.retiradas || []).length && (
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
                      {/* Tres estados y no dos: «Verificado OK» significa que la
                          aritmética del documento cuadra Y que su margen coincide con el
                          que publica la base de datos. Cuando no hubo cifras de la fuente
                          con las que cotejar se dice, en vez de dar por bueno lo que no se
                          comprobó. Se exige `=== false` a propósito: los estudios guardados
                          antes de que existiera el cotejo no traen el campo, y marcarlos
                          «sin cotejo» sería afirmar algo que no se midió. */}
                      {comp.eeffVerificado && comp.eeffCotejado === false ? (
                        <span
                          title="Las cifras del documento cuadran entre sí, pero esta fila no traía cifras de la base de datos con las que comparar el margen."
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-sky-50 text-sky-700 dark:bg-sky-950/30 dark:text-sky-400">
                          <CheckCircle className="w-3 h-3" /> Verificado, sin cotejo
                        </span>
                      ) : comp.eeffVerificado ? (
                        <span
                          title="La aritmética del documento cuadra y su margen coincide con el que publica la base de datos."
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
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
                            : ' · ' + pctf(comp.eeffCruce.punt || 0) + ' de coincidencia'}
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

        {/* La tarjeta de cumplimiento. Antes decía solo «NO CUMPLE (por debajo)»: ni a cuánto
            estaba del límite, ni cuánto sería el ajuste en pesos, ni cuál de los dos rangos
            sostenía la conclusión, ni qué quedaba por intentar. Todo lo que se pinta aquí lo
            calcula `diagnosticoRango.js`; este bloque no decide nada. */}
        <div className="md:col-span-2 bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl p-5 shadow-sm space-y-3">
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

            {/* La brecha y el ajuste: `adjustInfo` ya devolvía `capped` y nadie lo mostraba,
                así que el analista tenía que abrir el Excel de soporte para saber de cuánto
                era el ajuste que el informe iba a declarar. */}
            {!diagnostico.cumple && diagnostico.brecha !== null && (
              <p className="text-[11.5px] text-zinc-600 dark:text-zinc-400 leading-relaxed">
                Faltan <strong>{pctf(diagnostico.brecha)}</strong> para alcanzar el{' '}
                {diagnostico.dir === 'por debajo' ? 'primer cuartil' : 'tercer cuartil'}
                {diagnostico.ajuste && diagnostico.ajuste.monto ? (
                  <>
                    {' · ajuste a declarar: '}
                    <strong>COP {fmt(diagnostico.ajuste.monto)}</strong>
                    {diagnostico.ajuste.topado ? ' (topado por la utilidad disponible)' : ''}
                  </>
                ) : null}
              </p>
            )}
            {diagnostico.ajuste && diagnostico.ajuste.improcedente && (
              <p className="text-[11.5px] text-amber-700 dark:text-amber-400 leading-relaxed">
                El ajuste resulta improcedente con estas cifras: revise el indicador del
                contribuyente antes de declararlo.
              </p>
            )}

            {/* Cuál de los dos rangos decide. `useadj` lo elegía en silencio, así que no había
                forma de saber si el rango que se veía era el ajustado o el otro. */}
            {diagnostico.veredicto && (
              <p className="text-[11px] text-zinc-500">
                Decide el rango{' '}
                {diagnostico.rangos.decide === 'ajustado'
                  ? 'ajustado por capital de trabajo'
                  : 'sin ajuste de capital de trabajo'}
                {diagnostico.rangos.decide === 'ajustado' && diagnostico.rangos.sinAjustar
                  ? ` · sin ajustar sería ${pctf(diagnostico.rangos.sinAjustar.p25)} - ${pctf(diagnostico.rangos.sinAjustar.p75)}`
                  : (diagnostico.rangos.ajustado
                    ? ` · ajustado sería ${pctf(diagnostico.rangos.ajustado.p25)} - ${pctf(diagnostico.rangos.ajustado.p75)}`
                    : '')}
              </p>
            )}
          </div>

          {/* Antes de mover una sola comparable: si el indicador del contribuyente sale de una
              lectura que no se pudo cotejar contra el documento, ajustar la muestra para
              alcanzar ese número deteriora el estudio en vez de arreglarlo. */}
          {diagnostico.confianza.verificado === false && (
            <div className="rounded-lg border border-amber-300 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-950/30 p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                <div className="text-[11.5px] text-amber-900 dark:text-amber-200 leading-relaxed">
                  <strong>Antes de ajustar la muestra:</strong> el indicador del contribuyente
                  {tPLI !== null ? ` (${pctf(tPLI)})` : ''} sale de una lectura que no se pudo
                  verificar contra el documento. Confírmelo en el paso 3.
                  <ul className="list-disc pl-4 mt-1 space-y-0.5">
                    {diagnostico.confianza.motivos.map((m, i) => (
                      <li key={i}>{m}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* La verificación se hizo, pero contra una transcripción por OCR de las páginas
              escaneadas. Va en gris y no en ámbar a propósito: donde antes no había ninguna
              verificación ahora hay una, y bloquear por ella devolvería el estudio al punto de
              partida. Pero es más débil que cotejar contra la capa de texto del propio PDF, y
              quien firme el estudio tiene que poder saberlo. */}
          {diagnostico.confianza.verificado !== false && diagnostico.confianza.viaOcr && (
            <p className="text-[11px] text-zinc-500 leading-relaxed flex items-start gap-1.5">
              <FileText className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>
                Las cifras se comprobaron contra una transcripción por OCR de las páginas
                escaneadas del documento, no contra su capa de texto. Es una verificación más
                débil: si el margen decide el cumplimiento, vale confirmarlo a mano en el paso 3.
              </span>
            </p>
          )}

          {/* Las palancas. Cada una se probó de verdad —el servicio recalculó el rango con
              ella aplicada— y solo está aquí si cambia el veredicto: una lista de sugerencias
              que no funcionan enseña a ignorar el panel. */}
          {diagnostico.palancas.length > 0 && (
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-[#09090b] p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Lightbulb className="w-4 h-4 text-[#0FA3A1]" />
                <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
                  {diagnostico.palancas.length} vía(s) que sí cambian el veredicto
                </span>
              </div>
              <ul className="space-y-1.5">
                {diagnostico.palancas.map((p) => (
                  <li key={p.clave} className="text-[11.5px] text-zinc-700 dark:text-zinc-300 leading-relaxed flex gap-2">
                    <span className="text-[#0FA3A1] shrink-0">→</span>
                    <span>{p.texto}</span>
                  </li>
                ))}
              </ul>
              <p className="text-[10.5px] text-zinc-500 leading-relaxed">
                Ninguna se aplica sola: cada una es una decisión metodológica que hay que
                sustentar en el análisis funcional y dejar escrita en el informe.
              </p>
            </div>
          )}

          {/* No cumple y no hay nada que probar. Es una conclusión legítima y hay que poder
              decirla: el usuario pidió hacer todo lo posible, no forzar el resultado. */}
          {diagnostico.veredicto === 'NO CUMPLE' && diagnostico.palancas.length === 0 && (
            <div className="flex items-start gap-2 text-[11.5px] text-zinc-600 dark:text-zinc-400 leading-relaxed">
              <Search className="w-4 h-4 text-zinc-400 mt-0.5 shrink-0" />
              <span>
                Se probaron la política de pérdidas, el ajuste de capital de trabajo, los otros
                indicadores de rentabilidad, los tres ámbitos de muestra y la segmentación:
                ninguno deja al contribuyente dentro del rango. El estudio no cumple, y el
                informe debe declararlo con el ajuste correspondiente.
              </span>
            </div>
          )}
        </div>
      </div>

      {/* `comparables` y `cmode` van del estado local y no de `study`: el efecto que los
          persiste corre después del render, y la memoria tiene que explicar el rango que
          se está viendo en la tarjeta, no el del render anterior. */}
      {memoriaAbierta && (
        <MemoriaRangoModal
          /* `auditoria` va aquí y no se persiste con el estudio: es el detalle de la
             última corrida del motor, con el motivo de rechazo de cada candidata, y
             es lo que permite que el embudo del Excel refleje lo que el motor
             decidió en vez de contar cero en todos los motivos. */
          estudio={{ ...study, comparables, cmode, universo, criteriosScreening, motorConfig: engineConfig, auditoria }}
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
                <th className="py-3 px-3 border-b border-zinc-200 dark:border-zinc-800 text-right w-[8%]">PP&amp;E</th>
                {/* Se muestran los DOS y se marca cuál decide. Antes había una sola columna,
                    la ajustada, mientras el rango podía estar decidiendo sobre la NO ajustada
                    —lo que `useadj` elige—: el analista contaba negativas en una serie que no
                    era la que producía el rango. Se reportó exactamente así, con 4 comparables
                    en pérdida seleccionadas y solo 2 visibles en la columna. */}
                <th className="py-3 px-3 border-b border-zinc-200 dark:border-zinc-800 text-center w-[12%]">
                  PLI{' '}
                  <span className="font-normal text-zinc-400 normal-case">
                    ({useAdj ? 'ajustado' : 'sin ajustar'} decide)
                  </span>
                </th>
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
                    {/* ══ El veredicto de actividad, fila por fila ══
                        Pedido el 2026-09-01: poder validar la actividad antes de generar los
                        EEFF. El motor SÍ la respeta —la DISTINTA se descarta y la cuota de
                        negativas admite solo MISMA— pero la tabla no lo mostraba: una fila de
                        misma actividad no llevaba marca y se veía igual que una que nadie
                        verificó. El `title` lleva el motivo que escribió la curación, que es lo
                        único que permite validar el veredicto en vez de creerle. */}
                    <InsigniaActividad row={row} />
                    {/* La actividad en sí, que es lo que el informe publica por comparable. */}
                    <ActividadDeLaComparable row={row} />
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
                    <CampoMoneda
                      value={row.s}
                      placeholder="0"
                      onChange={(v) => handleRowChange(idx, 's', v)}
                      className="w-full bg-transparent border-0 border-b border-transparent text-right py-1 font-mono text-zinc-950 dark:text-zinc-100 focus:outline-none"
                    />
                  </td>
                  <td className="py-2 px-3 text-right">
                    <CampoMoneda
                      value={row.c}
                      placeholder="0"
                      onChange={(v) => handleRowChange(idx, 'c', v)}
                      className="w-full bg-transparent border-0 border-b border-transparent text-right py-1 font-mono text-zinc-950 dark:text-zinc-100 focus:outline-none"
                    />
                  </td>
                  <td className="py-2 px-3 text-right">
                    <CampoMoneda
                      value={row.op}
                      placeholder="0"
                      onChange={(v) => handleRowChange(idx, 'op', v)}
                      className="w-full bg-transparent border-0 border-b border-transparent text-right py-1 font-mono text-zinc-950 dark:text-zinc-100 focus:outline-none"
                    />
                  </td>
                  <td className="py-2 px-3 text-right">
                    <CampoMoneda
                      value={row.ar}
                      placeholder="0"
                      onChange={(v) => handleRowChange(idx, 'ar', v)}
                      className="w-full bg-transparent border-0 border-b border-transparent text-right py-1 font-mono text-zinc-950 dark:text-zinc-100 focus:outline-none"
                    />
                  </td>
                  <td className="py-2 px-3 text-right">
                    <CampoMoneda
                      value={row.inv}
                      placeholder="0"
                      onChange={(v) => handleRowChange(idx, 'inv', v)}
                      className="w-full bg-transparent border-0 border-b border-transparent text-right py-1 font-mono text-zinc-950 dark:text-zinc-100 focus:outline-none"
                    />
                  </td>
                  <td className="py-2 px-3 text-right">
                    <CampoMoneda
                      value={row.ap}
                      placeholder="0"
                      onChange={(v) => handleRowChange(idx, 'ap', v)}
                      className="w-full bg-transparent border-0 border-b border-transparent text-right py-1 font-mono text-zinc-950 dark:text-zinc-100 focus:outline-none"
                    />
                  </td>
                  <td className="py-2 px-3 text-right">
                    <CampoMoneda
                      value={row.ppe ?? ''}
                      placeholder="0"
                      onChange={(v) => handleRowChange(idx, 'ppe', v)}
                      className="w-full bg-transparent border-0 border-b border-transparent text-right py-1 font-mono text-zinc-950 dark:text-zinc-100 focus:outline-none"
                    />
                  </td>
                  <td className="py-2 px-3 text-center font-bold text-zinc-800 dark:text-zinc-200">
                    {(() => {
                      /* El que decide, grande; el otro debajo, en gris. `useadj` es lo único que
                         elige cuál sostiene la conclusión, y hasta ahora esa elección no se veía
                         en ninguna parte de la tabla. */
                      const decide = useAdj ? row.adjustedPli : row.pli;
                      const otro = useAdj ? row.pli : row.adjustedPli;
                      return (
                        <span className="flex flex-col items-center leading-tight">
                          <span className={decide !== null && decide < 0 ? 'text-rose-600 dark:text-rose-400 font-semibold' : ''}>
                            {decide !== null ? pctf(decide) : '—'}
                          </span>
                          {otro !== null && (
                            <span
                              className="text-[10px] text-zinc-400"
                              title={useAdj ? 'Sin ajustar (no decide)' : 'Ajustado por capital de trabajo (no decide)'}
                            >
                              {pctf(otro)}
                            </span>
                          )}
                        </span>
                      );
                    })()}
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
