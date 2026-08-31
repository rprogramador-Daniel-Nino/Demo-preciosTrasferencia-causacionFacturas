import React, { useState } from 'react';
import { Sparkles, BarChart, Settings, Calculator, Upload, CheckCircle2, Loader2, FileCheck, FileText, AlertTriangle, FileWarning, Wand2, Plus, Trash2, ListTree } from 'lucide-react';
import { pliOf, pctf, fmt } from '../utils/calculations';
import { parseEeffWithGeminiOCR, CAMPOS_CON_FALLBACK_NOTAS } from '../services/eeffParser';
import {
  verificarEeff, camposAplicables, camposParaLimpiar, candidataParaAprender, utilidadOperacionalDe,
} from '../services/eeffVerificacion';
import {
  resolverFaltantesConNotas, aprenderDeLecturaExitosa, aprenderRotuloConfirmado,
} from '../services/notasEeffOrquestacion';
import {
  leerVocabularioEeff, guardarVocabularioEeff,
  leerRotulosConfirmadosPorEmpresa, guardarRotulosConfirmadosPorEmpresa,
} from '../services/firestoreRepo';
import { convertPdfToImages } from '../services/pdfRenderer';
import { RUBROS_EXAMINADA } from '../services/memoriaCalculoRangoOptimo.js';
import PopupFaltantesEeff from './PopupFaltantesEeff';
import CampoMoneda from './CampoMoneda';

/* Las casillas del estado de situación financiera. Tres partidas y un subtotal, que es lo
   que esta ingesta toma por decisión del usuario (2026-08-21).

   Las dos de capital de trabajo son las de PARTES RELACIONADAS, no las comerciales: la
   operación bajo estudio es con la vinculada, y en este estado el propio flujo de efectivo
   lo confirma —su línea «Aumento / disminución en proveedores» es exactamente la variación
   de las cuentas por pagar a partes relacionadas—. El rótulo de la casilla dice «a partes
   relacionadas» para que no haya duda de qué cifra va aquí; el de la fila del libro no
   cambia, porque esa hoja y las tablas del informe son otra cosa.

   Antes de este ajuste el formulario mostraba las doce filas del balance. Se redujo a
   propósito: las que no alimentan el ajuste de capital de trabajo ni el subtotal no las
   toca esta ingesta. */
const RUBROS_BALANCE = [
  { clave: 't_ar', etiqueta: 'Cuentas por cobrar a partes relacionadas' },
  { clave: 't_inv', etiqueta: 'Inventarios' },
  { clave: 't_ap', etiqueta: 'Cuentas por pagar a partes relacionadas' },
  { clave: 't_act_curr', etiqueta: 'Total, Activo corriente' },
  /* Hasta el caso de Symtek (2026-08-24) esta casilla era 100% manual: alimenta dos de los
     siete escenarios de ajuste del motor y sin dato se calculan contra cero, y el caso que
     fijó ese diseño (Montachem) tenía el equipo totalmente depreciado y en cero. Para una
     compañía con PP&E real, dejarlo en manual lo trataba como cero por omisión — ahora se
     lee y se verifica contra el documento como cualquier otra partida del balance. */
  { clave: 't_ppe', etiqueta: 'Propiedad, planta y equipo' },
];

/* Los seis rubros que el Excel Soporte Motor ya publica (hoja Datos, columna A.V.) pero
   que hasta ahora ningún punto de la interfaz permitía corregir: solo los escribía la
   lectura del documento, y esta no los toma (ver `CAMPO_POR_RUBRO` en eeffParser.js), así
   que quedaban siempre en 0,00. No alimentan la utilidad operacional ni los ajustes de
   capital de trabajo — solo el Análisis Vertical de la hoja Datos y del ANEXO A/Tabla 10.

   Las etiquetas se toman de `RUBROS_EXAMINADA` y no se repiten aquí a mano: es la misma
   fila que el Excel escribe, y una etiqueta distinta en los dos sitios confundiría a quien
   audite el libro contra la pantalla. */
const CLAVES_BALANCE_ADICIONALES = ['t_cash', 't_inv_assoc', 't_tax', 't_intang', 't_dif', 't_act_nocurr'];
const RUBROS_BALANCE_ADICIONALES = CLAVES_BALANCE_ADICIONALES.map(
  (clave) => RUBROS_EXAMINADA.find((r) => r.clave === clave),
);

const CLASE_CASILLA = 'bg-[#ffffff] dark:bg-[#09090b] border border-zinc-200 dark:border-zinc-800 rounded-[8px] px-[12px] py-[8px] text-sm focus:outline-none focus:ring-2 focus:ring-[#0FA3A1]/50 focus:border-[#0FA3A1] text-zinc-950 dark:text-zinc-100 font-mono';

export default function IngestaCifras({ study, updateStudy }) {
  const [loadingEeff, setLoadingEeff] = useState(false);
  const [eeffMsg, setEeffMsg] = useState('');
  const [eeffFileName, setEeffFileName] = useState('');
  /* Los hallazgos de la última lectura: qué se corrigió y qué necesita una decisión. Vive
     en el componente y no en el estudio porque describe UNA lectura, no el estudio; lo que
     sí se persiste son las correcciones (`t_correcciones`), que el libro publica. */
  const [hallazgos, setHallazgos] = useState(null);
  /* Los estados por campo que la ingesta no pudo resolver ni con la pasada a notas —
     solo se llena cuando hay algo que de verdad merece un popup, no en cada carga. */
  const [popupFaltantes, setPopupFaltantes] = useState(null);

  /* Los tres insumos de la utilidad operacional. Cambiar cualquiera obliga a recalcularla:
     es un valor derivado, no un dato, y dejarlo con la cifra de la carga anterior es peor
     que no tenerlo — el margen del estudio saldría de una utilidad que ya no se deriva del
     costo que el analista acaba de corregir. */
  const INSUMOS_UTILIDAD = ['t_s', 't_c', 't_gastos'];

  /* Los dos campos de partes relacionadas: si el analista escribe a mano exactamente el
     valor de una de las candidatas ambiguas que la última carga mostró, es la confirmación
     de cuál rótulo corresponde a la vinculada — se aprende para no volver a preguntar en el
     próximo EEFF (de esta empresa, o de cualquiera si el rótulo ya nombra la relación). */
  const CAMPOS_RELACIONADAS_APRENDIBLES = ['t_ar', 't_ap'];

  const handleFieldChange = (key, value) => {
    const cambios = { [key]: value };

    if (INSUMOS_UTILIDAD.includes(key)) {
      /* Con la MISMA función que usa la lectura del documento, para que el signo se aplique
         igual escriba el analista «-21.850.187.494» o «21.850.187.494». */
      const fuente = { ...study, ...cambios };
      const uop = utilidadOperacionalDe({
        ventas: fuente.t_s, costo: fuente.t_c, gastos: fuente.t_gastos,
      });
      if (uop !== null) cambios.t_op = uop;
    }

    if (CAMPOS_RELACIONADAS_APRENDIBLES.includes(key) && hallazgos) {
      const advertencia = hallazgos.advertencias.find(
        (a) => a.campo === key && Array.isArray(a.candidatas) && a.candidatas.length > 0,
      );
      const candidata = advertencia && candidataParaAprender(advertencia.candidatas, value);
      if (candidata) {
        aprenderRotuloConfirmado({
          campo: key,
          rotulo: candidata.rotulo,
          nit: study.nit,
          leerVocabulario: leerVocabularioEeff,
          guardarVocabulario: guardarVocabularioEeff,
          leerRotulosEmpresa: leerRotulosConfirmadosPorEmpresa,
          guardarRotulosEmpresa: guardarRotulosConfirmadosPorEmpresa,
        }).catch((err) => console.warn('No se pudo aprender el rótulo confirmado:', err));
      }
    }

    updateStudy(cambios);
  };

  /* Elegir una de las candidatas ambiguas que la alerta lista (botón en la caja roja o en
     el popup): usa la MISMA ruta que si el analista la hubiera escrito a mano, para que
     dispare el mismo aprendizaje — no hay dos caminos distintos que puedan divergir. */
  const elegirCandidataRelacionada = (campo, candidata) => {
    if (!campo || !candidata) return;
    handleFieldChange(campo, candidata.valor);
  };

  /* El detalle completo de la sección ACTIVOS (Tabla 10 / ANEXO A). A diferencia de las
     tres partidas de arriba, aquí no hay campos con nombre fijo: cada EEFF trae su propia
     combinación de rubros, así que la lista es de largo variable y editable fila por fila. */
  const detalleActivos = study.t_activos_detalle || [];

  const handleActivoDetalleChange = (index, campo, valor) => {
    const detalle = detalleActivos.map((fila, i) => (i === index ? { ...fila, [campo]: valor } : fila));
    updateStudy({ t_activos_detalle: detalle });
  };

  const handleAgregarActivoDetalle = () => {
    updateStudy({
      t_activos_detalle: [...detalleActivos, { etiqueta: '', valor: '', esSubtotal: false }],
    });
  };

  const handleEliminarActivoDetalle = (index) => {
    updateStudy({ t_activos_detalle: detalleActivos.filter((_, i) => i !== index) });
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
      const [res, diccionarioRelacionadaGlobal, rotulosConfirmadosEmpresa] = await Promise.all([
        parseEeffWithGeminiOCR(file, study.anio),
        /* El diccionario de rótulos que YA nombran la relación (relacionada, vinculada,
           matriz...), compartido entre todas las empresas. Un fallo de Firestore no debe
           tumbar la ingesta: se sigue como si nunca hubiera aprendido nada. */
        Promise.all([
          leerVocabularioEeff('t_ar_relacionada'),
          leerVocabularioEeff('t_ap_relacionada'),
        ]).then(([t_ar, t_ap]) => ({ t_ar, t_ap }))
          .catch((err) => { console.warn('No se pudo leer el diccionario de rótulos relacionados:', err); return {}; }),
        /* Los rótulos genéricos que YA se confirmaron para esta empresa puntual. Sin NIT
           todavía (estudio nuevo, sin contribuyente guardado) no hay nada que leer. */
        study.nit
          ? leerRotulosConfirmadosPorEmpresa(study.nit)
            .catch((err) => { console.warn('No se pudieron leer los rótulos confirmados de la empresa:', err); return {}; })
          : Promise.resolve({}),
      ]);

      const updates = {};
      if (eeffImages && eeffImages.length > 0) {
        updates.eeffImages = eeffImages;
      }

      /* La verificación decide qué entra: calcula la utilidad operacional a partir de los
         ingresos, el costo y los dos gastos del giro —en vez de creerle a una fila rotulada
         «resultado de la operación»— y descarta las cifras que no están impresas en el
         documento. También intenta resolver partes relacionadas ambiguas con lo ya
         aprendido, antes de rendirse y pedirle al analista que lo escriba a mano. */
      const primeraVerificacion = verificarEeff(res, {
        anioEstudio: study.anio, diccionarioRelacionadaGlobal, rotulosConfirmadosEmpresa,
      });

      /* La pasada a notas solo corre si algo de costo de ventas, partes relacionadas o
         inventarios quedó en null — con diccionario y páginas decidiendo si vale la pena
         gastar la llamada. Un fallo aquí (Firestore o Gemini caídos) no debe tumbar la
         ingesta: se sigue con lo que ya se tenía de la primera pasada. */
      let verificacion = primeraVerificacion;
      try {
        verificacion = await resolverFaltantesConNotas({
          file,
          lectura: res,
          diccionarioRelacionadaGlobal,
          rotulosConfirmadosEmpresa,
          verificacion: primeraVerificacion,
          anioEstudio: study.anio,
          leerVocabulario: leerVocabularioEeff,
          guardarVocabulario: guardarVocabularioEeff,
        });
      } catch (err) {
        console.error('No se pudo completar la pasada a notas:', err);
      }

      /* Alimenta el diccionario con lo que la pasada 1 SÍ encontró, para que madure con
         cada estudio exitoso y no solo con los que necesitaron el fallback. No bloquea la
         ingesta si falla. */
      aprenderDeLecturaExitosa({
        campos: verificacion.campos,
        rotulos: res.rotulos,
        leerVocabulario: leerVocabularioEeff,
        guardarVocabulario: guardarVocabularioEeff,
      }).catch((err) => console.warn('No se pudo actualizar el diccionario de vocabulario:', err));

      Object.assign(updates, camposAplicables(verificacion.campos));

      /* Cualquier campo que ESTA lectura dejó en null y trae una advertencia asociada se
         limpia explícitamente: camposAplicables() no lo propaga porque protege lo que el
         analista ya escribió a mano, pero esta ingesta siempre relee y reverifica el mismo
         balance en cada carga, así que dejar el número de una carga o edición anterior
         contradice el aviso que se le está mostrando al analista en este mismo momento
         (antes esto solo cubría inventarios — ver commit 203eaa3 —, ahora es general). */
      Object.assign(updates, camposParaLimpiar(verificacion.campos, verificacion.advertencias));

      updates.t_correcciones = verificacion.correcciones;

      updateStudy(updates);
      setHallazgos(verificacion);

      /* El popup solo aparece si queda algo confirmado ausente, probablemente ausente
         por vocabulario, sin poder revisar por falta de páginas, o en $0 con una cifra
         mayor sin desglosar por contraparte — el caso feliz (todo resuelto o nunca hizo
         falta el fallback) no debe interrumpir al analista. */
      const necesitanPopup = verificacion.advertencias.filter((a) => (
        a.campo && CAMPOS_CON_FALLBACK_NOTAS[a.campo]
        && ['confirmado_ausente', 'probable_ausente_por_vocabulario', 'implicito_cero', 'revisar_total_mayor'].includes(a.estado)
      ));
      if (necesitanPopup.length > 0) {
        setPopupFaltantes({ advertencias: necesitanPopup, conclusion: verificacion.conclusionNotas || '' });
      }

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

  /* Sin coaccionar a 0: un `t_op` (o `t_s`) faltante es `null`, no una utilidad de cero, y
     `pliOf` ya sabe devolver `null` en ese caso — coaccionarlo aquí antes de llamarlo es lo
     que hacía que la tarjeta de Resultado Preliminar mostrara «0,000 %» cuando en realidad
     no había cifra con qué calcular el margen (ver el `'—'` de la línea de abajo). */
  const calculatedPli = pliOf({
    s: study.t_s,
    c: study.t_c,
    op: study.t_op,
  }, study.pli || 'MO');

  return (
    <>
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
            (PDF o imagen). Se leen los ingresos de actividades ordinarias, el costo de ventas,
            los gastos de ventas y de administración, las cuentas por cobrar y por pagar a
            partes relacionadas, los inventarios, propiedad planta y equipo y el total del
            activo corriente. La utilidad operacional se calcula como ingresos − costo − gastos
            operativos; si ese cálculo no basta, se recurre a la utilidad operacional impresa
            en el documento, solo cuando cuadra con utilidad bruta − gastos y no se confunde
            con el total de gastos. De cada cifra se comprueba que esté impresa en el documento.
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
                    {/* Un botón por candidata ambigua: sin esto, la única forma de resolver
                        la ambigüedad era escribir a mano el número exacto en la casilla de
                        más abajo, sin ninguna pista de que hacerlo cuenta como confirmación. */}
                    {Array.isArray(a.candidatas) && a.candidatas.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {a.candidatas.map((c, j) => (
                          <button
                            key={j}
                            type="button"
                            onClick={() => elegirCandidataRelacionada(a.campo, c)}
                            className="text-[10px] font-semibold px-2 py-0.5 rounded-full border border-rose-300 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-100 dark:hover:bg-rose-900/40 transition-colors"
                          >
                            Usar «{c.rotulo}» ({fmt(c.valor)})
                          </button>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* `verificadoContraTexto` distingue una lectura que sí se cruzó contra el texto
              nativo del PDF de una que no tuvo con qué —documento escaneado o con fuentes
              sin ToUnicode—. Sin este aviso, un documento 100% escaneado que por azar no
              dispara ninguna advertencia puntual se ve en pantalla igual que una lectura
              verificada cifra por cifra: el analista no tiene forma de saber que ninguna
              cifra pudo cotejarse contra el documento. */}
          {hallazgos && hallazgos.verificadoContraTexto === false && (
            <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 text-[11px] text-amber-900 dark:text-amber-200 flex gap-2 items-center">
              <FileWarning className="w-4 h-4 flex-shrink-0" />
              <span>
                Este documento no tiene una capa de texto legible (es un escaneo o sus fuentes
                no se pueden leer): ninguna cifra pudo cotejarse contra el texto del PDF.
                Revise el estado financiero a mano antes de confiar en esta lectura.
              </span>
            </div>
          )}

          {hallazgos && hallazgos.correcciones.length === 0 && hallazgos.advertencias.length === 0
            && hallazgos.verificadoContraTexto && (
            <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 text-[11px] text-emerald-800 dark:text-emerald-300 flex gap-2 items-center">
              <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
              <span>
                Lectura verificada: cada cifra está impresa en el documento y la utilidad
                operacional se calculó a partir de los ingresos, el costo y los gastos del giro.
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
              <CampoMoneda
                value={study.t_s ?? ''}
                onChange={(v) => handleFieldChange('t_s', v)}
                placeholder="COP Ventas"
                className={CLASE_CASILLA}
              />
            </div>

            <div className="flex flex-col">
              <label className="text-xs font-semibold text-zinc-500 mb-1.5">Costo de Ventas</label>
              <CampoMoneda
                value={study.t_c ?? ''}
                onChange={(v) => handleFieldChange('t_c', v)}
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
              <label className="text-xs font-semibold text-zinc-500 mb-1.5">Gastos Operativos</label>
              <CampoMoneda
                value={study.t_gastos ?? ''}
                onChange={(v) => handleFieldChange('t_gastos', v)}
                placeholder="COP Gastos Op."
                className={CLASE_CASILLA}
              />
              {/* Es el tercer insumo de la utilidad operacional y hasta ahora no tenía
                  casilla: si la lectura no lo acertaba, no había forma de corregirlo. */}
              <p className="text-[10px] text-zinc-500 mt-1 leading-snug">
                Gastos de ventas + gastos de administración. Puede escribirlo con el signo del
                estado financiero: el cálculo usa la magnitud.
              </p>
            </div>

            <div className="flex flex-col">
              <label className="text-xs font-semibold text-zinc-500 mb-1.5">Utilidad Operacional</label>
              <CampoMoneda
                value={study.t_op ?? ''}
                onChange={(v) => handleFieldChange('t_op', v)}
                placeholder="COP Utilidad Op."
                className={CLASE_CASILLA}
              />
              {/* La ingesta la CALCULA y no la lee de ninguna fila: es lo que evita que un
                  «resultado de actividades de la operación» que en realidad trae el total de
                  los gastos decida el margen del estudio. Editable de todas formas, porque el
                  analista manda sobre lo que el documento diga. */}
              <p className="text-[10px] text-zinc-500 mt-1 leading-snug">
                Se recalcula sola: ingresos − |costo| − |gastos operativos|. Utilidad, no
                gastos: con pérdida operativa va en negativo.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2 border-t border-zinc-100 dark:border-zinc-800">
            <div className="flex flex-col">
              <label className="text-xs font-semibold text-zinc-500 mb-1.5">Monto Excluido (Operación No Vinculada)</label>
              <CampoMoneda
                value={study.seg_excluido ?? ''}
                onChange={(v) => handleFieldChange('seg_excluido', v)}
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

        {/* Cifras del Estado de Situación Financiera: las tres partidas y el subtotal */}
        <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm space-y-4">
          <h3 className="text-md font-bold text-zinc-900 dark:text-zinc-50 border-b border-zinc-100 dark:border-zinc-800 pb-2 flex items-center gap-2">
            <BarChart className="w-5 h-5 text-[#0FA3A1]" />
            Cifras del Estado de Situación Financiera
          </h3>
          <p className="text-xs text-zinc-500 leading-relaxed">
            Las tres partidas de capital de trabajo sostienen el ajuste de comparabilidad. Son
            las de <strong>partes relacionadas</strong>, no las comerciales con terceros: la
            operación bajo estudio es con la vinculada. Propiedad, planta y equipo alimenta los
            ajustes que la usan; se lee del documento cuando lo trae y sigue siendo editable.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {RUBROS_BALANCE.map(({ clave, etiqueta }) => (
              <div key={clave} className="flex flex-col">
                <label className="text-xs font-semibold text-zinc-500 mb-1.5">{etiqueta}</label>
                <CampoMoneda
                  value={study[clave] ?? ''}
                  onChange={(v) => handleFieldChange(clave, v)}
                  placeholder="COP"
                  className={CLASE_CASILLA}
                />
              </div>
            ))}
          </div>

          <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800">
            <p className="text-xs text-zinc-500 leading-relaxed mb-3">
              Estos rubros no cambian la utilidad ni los ajustes de capital de trabajo: solo
              alimentan el Análisis Vertical de la hoja Datos del Excel de soporte y del
              ANEXO A / Tabla 10. La lectura del documento no los completa todavía —
              escríbalos a mano si el balance los trae.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {RUBROS_BALANCE_ADICIONALES.map(({ clave, etiqueta }) => (
                <div key={clave} className="flex flex-col">
                  <label className="text-xs font-semibold text-zinc-500 mb-1.5">{etiqueta}</label>
                  <CampoMoneda
                    value={study[clave] ?? ''}
                    onChange={(v) => handleFieldChange(clave, v)}
                    placeholder="COP"
                    className={CLASE_CASILLA}
                  />
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Detalle completo de Activos: la Tabla 10 y el ANEXO A se arman de esta lista */}
        <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm space-y-4">
          <h3 className="text-md font-bold text-zinc-900 dark:text-zinc-50 border-b border-zinc-100 dark:border-zinc-800 pb-2 flex items-center gap-2">
            <ListTree className="w-5 h-5 text-[#0FA3A1]" />
            Detalle de Activos (Estado de Situación Financiera)
          </h3>
          <p className="text-xs text-zinc-500 leading-relaxed">
            Cada fila de la sección ACTIVOS del documento, tal como el EEFF la trae — sin
            estructura fija, porque cada compañía desglosa sus activos distinto. La ingesta la
            llena sola al leer el PDF; agregue, corrija o elimine filas si algo no quedó bien.
          </p>

          {detalleActivos.length > 0 && (
            <div className="space-y-2">
              <div className="hidden md:grid grid-cols-[1fr_180px_90px_32px] gap-2 px-1">
                <span className="text-[11px] font-semibold text-zinc-500">Rótulo</span>
                <span className="text-[11px] font-semibold text-zinc-500">Valor (COP)</span>
                <span className="text-[11px] font-semibold text-zinc-500">Subtotal</span>
                <span />
              </div>
              {detalleActivos.map((fila, i) => (
                <div key={i} className="grid grid-cols-[1fr_180px_90px_32px] gap-2 items-center">
                  <input
                    type="text"
                    value={fila.etiqueta || ''}
                    onChange={(e) => handleActivoDetalleChange(i, 'etiqueta', e.target.value)}
                    placeholder="Rótulo del rubro"
                    className={CLASE_CASILLA}
                  />
                  <CampoMoneda
                    value={fila.valor ?? ''}
                    onChange={(v) => handleActivoDetalleChange(i, 'valor', v)}
                    placeholder="COP"
                    className={CLASE_CASILLA}
                  />
                  <label className="flex items-center justify-center gap-1.5 text-[11px] text-zinc-500">
                    <input
                      type="checkbox"
                      checked={Boolean(fila.esSubtotal)}
                      onChange={(e) => handleActivoDetalleChange(i, 'esSubtotal', e.target.checked)}
                      className="accent-[#0FA3A1]"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => handleEliminarActivoDetalle(i)}
                    className="p-1.5 rounded-lg text-zinc-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                    aria-label="Eliminar rubro"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={handleAgregarActivoDetalle}
            className="flex items-center gap-1.5 text-xs font-semibold text-[#0FA3A1] hover:underline"
          >
            <Plus className="w-4 h-4" />
            Agregar rubro
          </button>

          <div className="flex flex-col pt-2 border-t border-zinc-100 dark:border-zinc-800 max-w-xs">
            <label className="text-xs font-semibold text-zinc-500 mb-1.5">Total, Activos</label>
            <CampoMoneda
              value={study.t_act_tot ?? ''}
              onChange={(v) => handleFieldChange('t_act_tot', v)}
              placeholder="COP"
              className={CLASE_CASILLA}
            />
            <p className="text-[10px] text-zinc-500 mt-1 leading-snug">
              El total general de activos: es el denominador del análisis vertical de la Tabla 10.
            </p>
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
                value={study.prime ?? ''}
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

    {popupFaltantes && (
      <PopupFaltantesEeff
        advertencias={popupFaltantes.advertencias}
        conclusion={popupFaltantes.conclusion}
        alCerrar={() => setPopupFaltantes(null)}
        onElegirCandidata={elegirCandidataRelacionada}
      />
    )}
    </>
  );
}
