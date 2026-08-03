import React, { useState, useEffect } from 'react';
import { Upload, FileDown, Edit3, Loader2, Sparkles, Check, FileText } from 'lucide-react';
import mammoth from 'mammoth';
import { MASTER_WORD_TEMPLATE } from '../services/masterTemplate';
import { hydrateExactWordTemplate } from '../services/exactTemplateMapper';
import { extraerReferencia } from '../services/pdfReferenceExtractor';
import {
  guardarRecursos, leerRecursos, hashPlantilla, guardarPlantilla, leerPlantilla,
  guardarVinculo, leerVinculo, guardarMarcado, leerMarcado,
} from '../services/plantillaStore';
import RevisorDeMarcas from './RevisorDeMarcas.jsx';
import { proponerMarcas, aplicarMarcas } from '../services/plantillaMarcador.js';
import { renderizar } from '../services/plantillaRenderer.js';
import { revisarAntesDeGenerar } from '../services/plantillaGuardas.js';

export default function ReporteGenerador({ study, estudioId }) {
  const [htmlContent, setHtmlContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [customTemplateLoaded, setCustomTemplateLoaded] = useState(false);
  const [recursosCargados, setRecursosCargados] = useState([]);
  /* Banner para el aviso de hidratación fallida al recargar. No se usa `alert`
     aquí porque el efecto corre en cada montaje: un alert bloqueante cada vez
     que se abre el estudio sería más molesto que informativo. El alert sí se
     conserva en la carga manual del PDF, donde es una reacción directa a la
     acción que el usuario acaba de hacer. */
  const [avisoHidratacion, setAvisoHidratacion] = useState('');

  /* Marcas propuestas a la espera de revisión humana, y el id de la plantilla a la
     que pertenecen. Mientras esto no sea null, la pantalla muestra el revisor. */
  const [marcasPropuestas, setMarcasPropuestas] = useState(null);
  const [plantillaPendiente, setPlantillaPendiente] = useState(null);
  const [avisos, setAvisos] = useState([]);

  /* La hidratación sustituye por literales del informe de End Game 2024. Con
     el PDF de otro cliente no coincide ninguno y el documento sale con los
     datos del PDF subido, sin ninguna señal. Se usa el NIT del estudio como
     testigo: si el estudio tiene NIT y no aparece en el HTML ya hidratado, la
     sustitución no ocurrió. El arreglo de fondo —marcado por campos con
     nombre— es del plan 2; esto solo evita que pase desapercibido. */
  const faltaSustitucion = (hydrated) => study?.nit && !hydrated.includes(study.nit);

  /* Extrae el NIT que traía el informe de referencia. El marcado conserva el
     texto original y solo lo envuelve, así que el contenido de la primera
     marca `data-campo="nit"` es literalmente el NIT del cliente anterior. Si
     el documento no llegó a marcar ese campo, devuelve null y la guarda de
     "plantilla de otro contribuyente" simplemente no opina, que es lo
     correcto: sin NIT de referencia no hay con qué comparar. */
  const extraerNitDeReferencia = (htmlMarcado) => {
    const m = /<span data-campo="nit">([\s\S]*?)<\/span>/.exec(htmlMarcado || '');
    return m ? m[1] : null;
  };

  /* Renderiza la plantilla marcada contra el estudio activo y calcula los
     avisos previos a generar. Se centraliza aquí porque son tres las rutas
     que renderizan por campo —al subir un PDF cuya plantilla ya estaba
     marcada, al confirmar marcas recién revisadas, y al abrir un estudio con
     plantilla marcada— y las tres deben avisar exactamente igual. */
  const renderizarYAvisar = (htmlMarcado, recursos) => {
    const r = renderizar(htmlMarcado, study, recursos);
    setHtmlContent(r.html);
    setAvisos(revisarAntesDeGenerar({
      estudio: study,
      nitDeReferencia: extraerNitDeReferencia(htmlMarcado),
      vacios: r.vacios,
      /* El almacén 'anexos' ya existe en plantillaStore.js pero nadie lo usa
         todavía: falta la pantalla de subida del anexo de estados
         financieros, fuera del alcance de esta tarea. Se deja fijo en true
         para no disparar un aviso de "falta el anexo" que sería
         permanentemente falso —y por tanto ignorable— hasta que esa pantalla
         exista. */
      tieneAnexo: true,
      recursosFaltantes: r.recursosFaltantes,
    }));
    setCustomTemplateLoaded(true);
  };

  /* Rehidratación: sin esto las imágenes del informe de referencia se pierden
     al recargar la página, que es el fallo que motivó este trabajo. La bandera
     `vivo` evita escribir estado si el componente se desmonta antes de que
     IndexedDB responda. */
  useEffect(() => {
    let vivo = true;
    (async () => {
      /* Defensivo: si estudioId cambia mientras hay marcas propuestas
         pendientes de revisión de otro estudio, se descartan. Hoy App.jsx
         desmonta este componente al cambiar de estudio (cambia de pestaña),
         así que esto no se puede provocar en la práctica, pero el
         invariante vive fuera de este componente y no conviene depender
         de él en silencio. */
      if (vivo) { setMarcasPropuestas(null); setPlantillaPendiente(null); }
      if (!estudioId) return;
      /* Se asigna siempre, también cuando viene vacío: si no, al cambiar de
         estudio quedarían los avisos del anterior. */
      if (vivo) setAvisos([]);
      const recursos = await leerRecursos(estudioId);
      /* Se asigna siempre, también cuando viene vacío: si no, al cambiar de
         estudio quedarían los recursos del anterior. */
      if (vivo) setRecursosCargados(recursos);

      const idPlantilla = await leerVinculo(estudioId);
      if (!idPlantilla) return;
      const html = await leerPlantilla(idPlantilla);

      /* Si la plantilla está marcada se renderiza por campo; si no, se cae a
         la sustitución por literales, que sigue siendo la ruta de las
         plantillas antiguas. Se resuelve al leer y no al guardar porque el
         estudio puede cambiar después de haber subido la plantilla. */
      const marcado = await leerMarcado(idPlantilla);
      if (vivo && marcado) {
        renderizarYAvisar(marcado, recursos);
      } else if (vivo && html) {
        /* Se guarda el HTML crudo del extractor y se hidrata al leerlo, no al
           guardarlo: el estudio puede cambiar después de haber subido la
           plantilla, y entonces los valores almacenados quedarían viejos. Sin
           esta línea, tras recargar se ven las cifras del informe de
           referencia en vez de las del estudio actual. */
        /* `recursos` se pasa explícito y no se lee de `recursosCargados`: el
           setState de arriba no ha surtido efecto todavía dentro de este mismo
           efecto, y las imágenes saldrían rotas en la primera pintada. */
        setHtmlContent(conImagenes(hydrateExactWordTemplate(html, study), recursos));
        /* Evita que el efecto de la plantilla maestra sobrescriba lo
           recuperado. Es lo que hacía fallar la recarga. */
        setCustomTemplateLoaded(true);
      }
    })();
    return () => { vivo = false; };
  }, [estudioId]);

  // Carga la plantilla original 100% completa de 27 secciones (End Game 2024) y aplica el reemplazo de variables
  const loadExactMasterTemplate = () => {
    const hydrated = hydrateExactWordTemplate(MASTER_WORD_TEMPLATE, study);
    setHtmlContent(hydrated);
  };

  useEffect(() => {
    if (!customTemplateLoaded) {
      loadExactMasterTemplate();
    }
  }, [study, customTemplateLoaded]);

  // Carga de una nueva plantilla Word (.docx) por si el usuario desea usar otro documento modelo
  const handleTemplateUpload = (file) => {
    setLoading(true);
    const reader = new FileReader();
    reader.readAsArrayBuffer(file);
    reader.onload = async (e) => {
      try {
        const arrayBuffer = e.target.result;
        const esPdf = /\.pdf$/i.test(file.name);
        if (esPdf) {
          const datos = new Uint8Array(arrayBuffer);
          /* El hash va antes de extraer: pdf.js transfiere el buffer al worker
             y lo desprende, y crypto.subtle.digest sobre un buffer desprendido
             no falla, hashea cero bytes. Todos los PDF darían el mismo id. */
          const idPlantilla = await hashPlantilla(datos);
          const ref = await extraerReferencia(datos);
          /* Sin esto las imágenes recién extraídas sólo aparecerían tras
             recargar la página: el efecto de arranque es el único otro sitio
             donde se pueblan, y el HTML nuevo trae marcas sin base64. */
          const recursos = ref.imagenes;
          setRecursosCargados(ref.imagenes);
          await guardarPlantilla(idPlantilla, ref.html);
          if (estudioId) await guardarRecursos(estudioId, ref.imagenes);
          if (estudioId) await guardarVinculo(estudioId, idPlantilla);
          if (!ref.etiquetado) {
            alert('El PDF no trae estructura interna: la plantilla saldrá sin secciones.');
          }

          /* El marcado se paga una vez por plantilla. Si este PDF ya se marcó
             antes —otro estudio del mismo cliente, o un reintento— se
             reutiliza sin volver a llamar a la IA. */
          const marcadoPrevio = await leerMarcado(idPlantilla);
          if (!marcadoPrevio) {
            /* Los avisos visibles corresponden a la plantilla anterior (u
               otro estudio): mientras se revisan las marcas nuevas no hay
               todavía un render del que calcularlos, y dejarlos puestos
               enseñaría al usuario a ignorar el banner. */
            setAvisos([]);
            const propuestas = await proponerMarcas(ref.html);
            setPlantillaPendiente({ id: idPlantilla, html: ref.html });
            setMarcasPropuestas(propuestas);
          } else {
            renderizarYAvisar(marcadoPrevio, recursos);
          }
        } else {
          const result = await mammoth.convertToHtml({ arrayBuffer });
          const html = result.value;

          /* Ruta de respaldo, sin marcado: mammoth ya incrusta las imágenes
             en el propio HTML, así que no hay recursos que resolver aparte.
             Se limpian los avisos porque, sin marcado, no hay de dónde
             recalcularlos, y los de la plantilla anterior ya no corresponden
             a este documento. */
          setAvisos([]);
          const hydrated = hydrateExactWordTemplate(html, study);
          setHtmlContent(conImagenes(hydrated, []));
          setCustomTemplateLoaded(true);
        }
      } catch (err) {
        console.error("Error al analizar la plantilla personalizada:", err);
        alert("No se pudo analizar la plantilla seleccionada.");
      } finally {
        setLoading(false);
      }
    };
  };

  /* Resume las descartadas agrupándolas por motivo. Los dos motivos que
     produce aplicarMarcas significan cosas muy distintas: un solape es
     benigno (el modelo marcó de más sobre texto que una marca anterior ya
     cubría); que el fragmento no aparezca es la señal real de que el modelo
     reescribió el texto al proponerlo. Anunciar ambos como "no aparece" -el
     mensaje genérico que tenía esto antes- alarma de más en el primer caso y
     esconde la señal real en el segundo. */
  const resumirDescartes = (descartadas) => {
    const porMotivo = new Map();
    for (const d of descartadas) porMotivo.set(d.motivo, (porMotivo.get(d.motivo) || 0) + 1);

    const lineas = [];
    const noAparece = porMotivo.get('el fragmento no aparece en el documento');
    const solapada = porMotivo.get('se solapa con una marca ya aplicada');
    if (noAparece) {
      lineas.push(noAparece + ' se descartaron porque su texto no aparece literalmente en el ' +
                  'documento: revisa si el modelo reescribió ese fragmento.');
    }
    if (solapada) {
      lineas.push(solapada + ' se descartaron por solaparse con una marca ya aplicada, lo cual es ' +
                  'normal y no es señal de un problema.');
    }
    /* Motivo distinto de los dos conocidos hoy: se reporta genérico en vez de
       omitirlo, por si aplicarMarcas agrega alguno nuevo más adelante. */
    for (const [motivo, n] of porMotivo) {
      if (motivo !== 'el fragmento no aparece en el documento' && motivo !== 'se solapa con una marca ya aplicada') {
        lineas.push(n + ' se descartaron: ' + motivo + '.');
      }
    }
    return lineas.join('\n');
  };

  /* Aplica las marcas que la persona confirmó y guarda el resultado. */
  const confirmarMarcas = async (marcas) => {
    const { html, aplicadas, descartadas } = aplicarMarcas(plantillaPendiente.html, marcas);
    await guardarMarcado(plantillaPendiente.id, html);
    renderizarYAvisar(html, recursosCargados);
    setMarcasPropuestas(null);
    setPlantillaPendiente(null);
    if (descartadas.length) {
      alert('Se aplicaron ' + aplicadas + ' marcas.\n' + resumirDescartes(descartadas));
    }
  };

  /* Resuelve las marcas que dejó el extractor contra el catálogo de recursos.
     El HTML guardado sólo trae `<img data-recurso="...">` sin el base64 dentro,
     así que esto hace falta tanto para ver el informe como para descargarlo.

     El reemplazo es global: una misma imagen —el logo del encabezado— aparece
     marcada en casi cien páginas y con un reemplazo simple sólo la primera
     habría salido. Y conserva el atributo `data-recurso` para que aplicarlo dos
     veces sobre el mismo HTML no rompa nada. */
  const conImagenes = (htmlBase, recursos = recursosCargados) =>
    recursos.reduce(
      (acc, r) =>
        acc.replace(
          new RegExp('<img data-recurso="' + r.id + '"[^>]*>', 'g'),
          '<img data-recurso="' + r.id + '" src="' + r.dataUrl + '" />'
        ),
      htmlBase
    );

  const handleDownload = () => {
    // Estilos compatibles con Word (.doc)
    const exportStyle = `body{font-family:Georgia,serif;max-width:800px;margin:40px auto;padding:0 24px;color:#222;line-height:1.7}h1{font-size:22px;color:#0E1726;border-bottom:2px solid #0FA3A1;padding-bottom:6px}h2{border-bottom:1px solid #E2E8F0;padding-bottom:4px;margin-top:26px;font-size:16px;color:#0E1726}table{width:100%;border-collapse:collapse;margin:16px 0;font-size:13px}th{background:#0E1726;color:#fff;text-align:left;padding:8px 12px}td{padding:8px 12px;border-bottom:1px solid #E2E8F0}`;
    const wordCSS = 'body{counter-reset:secpt}h2::before{content:""}p,li,td{text-align:justify}';

    // Limpiamos los estilos de resaltado de pantalla para que el documento final en Word quede impecable
    const cleanHtml = htmlContent
      .replace(/background-color:\s*#F0FDF4;\s*/g, '')
      .replace(/border-bottom:\s*1px\s*dashed\s*#0FA3A1;\s*/g, '')
      .replace(/color:\s*#0B7C7A;\s*/g, '');

    const content = `\ufeff<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"><title>Informe Local Precios de Transferencia</title><style>${exportStyle}${wordCSS}</style></head><body>${conImagenes(cleanHtml)}</body></html>`;

    const blob = new Blob([content], { type: 'application/msword' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Informe_Local_PT_${study.ent || 'Empresa'}_${study.anio || ''}.doc`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-6">
      {/* Barra de Acciones y Control */}
      <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm flex flex-col md:flex-row gap-4 items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-md font-bold text-zinc-950 dark:text-zinc-50">Generador de Informe Final (Fiel 100% al Word Original)</h3>
            <span className="bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
              27 Secciones Intactas
            </span>
          </div>
          <p className="text-xs text-zinc-500 mt-1">
            Conserva el texto íntegro original del informe (Introducción, FAR, Tendencias, Anexos A-C) e inyecta quirúrgicamente los datos del cliente.
          </p>
        </div>
        <div className="flex gap-3">
          <div className="relative">
            <button className="flex items-center gap-2 bg-[#ffffff] dark:bg-[#262626] text-[#334155] dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 rounded-lg px-4 py-2 text-xs font-semibold hover:bg-[#f8fafc] dark:hover:bg-zinc-800 transition-colors shadow-sm cursor-pointer">
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              Subir Otra Plantilla Word
            </button>
            <input
              type="file"
              accept=".docx,.pdf"
              disabled={loading}
              onChange={(e) => {
                if (e.target.files[0]) {
                  handleTemplateUpload(e.target.files[0]);
                }
                // Añade esta línea para limpiar el input
                e.target.value = null;
              }}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
          </div>
          <button
            onClick={handleDownload}
            className="flex items-center gap-2 bg-[#0FA3A1] hover:bg-[#0B7C7A] text-white rounded-lg px-4 py-2 text-xs font-semibold transition-colors shadow-sm cursor-pointer"
          >
            <FileDown className="w-3.5 h-3.5" />
            Descargar Word (.doc)
          </button>
        </div>
      </div>

      {marcasPropuestas && (
        <RevisorDeMarcas
          marcas={marcasPropuestas}
          onConfirmar={confirmarMarcas}
          onCancelar={() => { setMarcasPropuestas(null); setPlantillaPendiente(null); }}
        />
      )}

      {avisos.length > 0 && (
        <div className="border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 rounded-xl p-4">
          <ul className="text-xs text-amber-900 dark:text-amber-200 space-y-1">
            {avisos.map((a, i) => <li key={i}>{a.texto}</li>)}
          </ul>
        </div>
      )}

      {/* Contenedor del Editor de HTML Renderizado */}
      <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl p-8 shadow-sm overflow-x-auto min-h-[600px]">
        {loading ? (
          <div className="flex flex-col items-center justify-center min-h-[400px] text-zinc-500">
            <Loader2 className="w-8 h-8 text-[#0FA3A1] animate-spin mb-2" />
            <span>Cargando plantilla...</span>
          </div>
        ) : (
          <div
            dangerouslySetInnerHTML={{ __html: htmlContent }}
            className="prose dark:prose-invert max-w-none focus:outline-none"
            contentEditable
            onBlur={(e) => setHtmlContent(e.currentTarget.innerHTML)}
          />
        )}
      </div>
    </div>
  );
}
