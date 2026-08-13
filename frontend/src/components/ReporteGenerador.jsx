import React, {
  useState, useEffect, useMemo, useRef,
} from 'react';
import axios from 'axios';
import { Upload, FileDown, Edit3, Loader2, Sparkles, Check, FileText, AlertTriangle, RefreshCw } from 'lucide-react';
import mammoth from 'mammoth';
import { diagnosticarCobertura } from '../services/tablasInforme';
import {
  normalizarActividad, claveActividad, corridaSectorIncompleta,
} from '../services/analisisMercado';
import {
  extraerReferencia, estiloBaseDe, versionDe, loQueFaltaPorVersion, VERSION_EXTRACTOR,
} from '../services/pdfReferenceExtractor';
import {
  guardarRecursos, leerRecursos, hashPlantilla, guardarPlantilla, leerPlantilla,
  guardarVinculo, leerVinculo, guardarMarcado, leerMarcado, borrarMarcado,
  guardarHuecos, leerHuecos,
  guardarDocx, leerDocx, guardarDocxMarcado, leerDocxMarcado, borrarDocxMarcado,
} from '../services/plantillaStore';
import {
  leerAnalisisMercado, leerAnalisisSector, leerNarrativaMacroEstudio, guardarNarrativaMacroEstudio,
} from '../services/firestoreRepo';
import { necesitaRedaccion, redactarNarrativaMacroEnVivo } from '../services/analisisMercadoRedaccion';
import RevisorDeMarcas from './RevisorDeMarcas.jsx';
import {
  proponerMarcas, aplicarMarcas,
  MOTIVO_NO_APARECE, MOTIVO_SOLAPE, MOTIVO_SIN_APARICION_LIBRE,
} from '../services/plantillaMarcador.js';
import { renderizar } from '../services/plantillaRenderer.js';
import {
  revisarAntesDeGenerar, valoresDeReferencia, revisarSalidaRenderizada,
  sustituirDatosDeReferencia, TRAMO_HTML,
} from '../services/plantillaGuardas.js';
import { evaluarRadicacion } from '../services/semaforoRadicacion.js';
import {
  cssDeHojas, cssDeExportacion, cssDeWord, conSaltosDePagina, conTamanoDeImagen,
} from '../services/estiloDocumento.js';
import { aDocxBlob } from '../services/docxWriter.js';
import PizZip from 'pizzip';
import { htmlParaMarcar, aplicarMarcasOoxml, envolverTablaEnBucle } from '../services/docxPlantilla.js';
import { rellenarDocx, coleccionesDelEstudio, CENTINELA_ANEXO } from '../services/docxRelleno.js';
import {
  subirPlantillaDelEstudio, descargarPlantillaDelEstudio, restaurarPlantillaEnLocal,
} from '../services/plantillaNube.js';
import { bucketAusente, AVISO_STORAGE_APAGADO } from '../services/cribadoStorage.js';

/* Llamada directa a la URL de la función, NO a /api/generar-analisis-sector: ese path pasa
   por el rewrite de Firebase Hosting, que corta cualquier petición a los 60 s sin importar
   el timeoutSeconds de la función (ver el comentario junto a GEMINI_CORTE_MS en
   functions/index.js). La cadena Gemini→Gemini→Claude de este endpoint puede tardar más que
   eso —el navegador recibía un 502 opaco del borde aunque la función siguiera viva dentro de
   su propio límite de 180 s—. La función ya tiene cors:true. */
const URL_ANALISIS_SECTOR =
  'https://us-central1-precios-trasnferencia.cloudfunctions.net/generarAnalisisSector';

/* El endpoint SIEMPRE rehace la corrida y la sobrescribe con `merge`: la decisión de
   reutilizar lo guardado es de aquí, no de la función. Por eso sirve igual para la
   generación bajo demanda y para regenerar a mano una corrida vieja. */
async function pedirAnalisisSector(actividad, year) {
  const resp = await axios.post(URL_ANALISIS_SECTOR, { actividad, year });
  return { porAnio: { [String(year)]: resp.data.entrada } };
}

export default function ReporteGenerador({ study, estudioId, usuario }) {
  const [htmlContent, setHtmlContent] = useState('');
  const [loading, setLoading] = useState(false);
  /* `customTemplateLoaded` vivía aquí y se ha retirado: su único cometido era impedir
     que el efecto de la plantilla maestra sobrescribiera lo recuperado. Sin plantilla
     maestra no hay nada de lo que defenderse, y con qué plantilla se genera ya lo dice
     `plantillaActiva`, que es el dato real. */
  const [recursosCargados, setRecursosCargados] = useState([]);
  /* Cifras y narrativa de la Sección III, refrescadas mensualmente por
     `actualizarAnalisisMercadoScheduled`. null mientras carga o si Firestore no
     responde — los generadores de analisisMercado.js caen al respaldo local
     embebido en el código cuando reciben null. */
  const [analisisMercado, setAnalisisMercado] = useState(null);
  /* true mientras la redacción en vivo de la narrativa macro está en curso — mismo
     propósito que sectorEnCurso más abajo, pero mucho más corta (un solo round-trip
     a Claude/Gemini, sin búsqueda: segundos, no minutos). */
  const [redactandoMacro, setRedactandoMacro] = useState(false);
  /* Análisis de sector (III.C) para la actividad de este estudio. A diferencia
     de analisisMercado (un solo documento global), este es por actividad+año
     — ver el efecto más abajo, que lo lee o lo genera bajo demanda. null
     mientras carga o si todavía no hay corrida: generarApartadoSectorial cae
     al respaldo genérico con marcador. */
  const [analisisSector, setAnalisisSector] = useState(null);
  /* Motivo por el que no se pudo generar/leer el análisis de sector, o null si no ha
     fallado (todavía no corre, o corrió bien). Se distingue del resto de `analisisSector`
     porque el banner necesita decir POR QUÉ falló, no solo que falló: "no hay información
     pública confiable para esta actividad" (el sector es real pero no se encontró nada
     verificable — no va a resolverse solo reintentando) es una situación muy distinta de
     un error técnico (red, API caída), y antes ambas quedaban indistinguibles detrás del
     mismo mensaje genérico de "todavía no está generado". */
  const [motivoFalloSector, setMotivoFalloSector] = useState(null);
  /* true mientras la generación bajo demanda del análisis de sector está en
     vuelo. La llamada real (Gemini busca + Claude redacta) tarda 60-100+ s, y
     sin esto el banner de abajo decía "todavía no está generado" desde el
     primer instante — indistinguible para el usuario de una corrida que
     nunca se disparó o que falló, cuando en realidad solo estaba en curso. */
  const [sectorEnCurso, setSectorEnCurso] = useState(false);
  /* Banner de lo que le falta al informe (Sección III, tablas del motor). No se usa
     `alert` aquí porque el efecto corre en cada montaje: un alert bloqueante cada vez
     que se abre el estudio sería más molesto que informativo. El alert sí se
     conserva en la carga manual del PDF, donde es una reacción directa a la
     acción que el usuario acaba de hacer. */
  const [veredictoRadicacion, setVeredictoRadicacion] = useState(null);

  /* Marcas propuestas a la espera de revisión humana, y el id de la plantilla a la
     que pertenecen. Mientras esto no sea null, la pantalla muestra el revisor. */
  const [marcasPropuestas, setMarcasPropuestas] = useState(null);
  const [plantillaPendiente, setPlantillaPendiente] = useState(null);
  const [avisos, setAvisos] = useState([]);
  /* Resultado del marcado (trozos enviados, fallidos, propuestas rechazadas).
     Se guarda el dato crudo y no el texto ya redactado porque el mismo hecho se
     cuenta distinto antes y después de confirmar: antes se puede reintentar,
     después ya no. */
  const [telemetriaMarcado, setTelemetriaMarcado] = useState(null);
  /* Avance del marcado por IA: `{ terminados, total, fallidos }` mientras corre,
     null cuando no hay marcado en curso. */
  const [progresoMarcado, setProgresoMarcado] = useState(null);
  /* Por qué la copia en la nube no está disponible. Se muestra junto a la plantilla: sin
     esto, el usuario creería que el formato viaja con el estudio cuando no lo hace. */
  const [avisoNube, setAvisoNube] = useState('');
  /* Plantilla vinculada al estudio: `{ id, html, huecos, marcada }`. Se guarda para
     poder volver a marcarla sin pedirle al usuario que suba otra vez el PDF. */
  const [plantillaActiva, setPlantillaActiva] = useState(null);

  /* Dispara la redacción en vivo si hace falta, o aplica el caché de Firestore si ya
     existe uno vigente — mismo criterio en la carga inicial y en "Actualizar información".
     `datos` es lo que acaba de devolver leerAnalisisMercado() (puede ser null). */
  async function aplicarNarrativaMacro(datos) {
    if (!datos) return;
    let cache;
    try {
      cache = await leerNarrativaMacroEstudio(estudioId);
    } catch (err) {
      console.error('No se pudo leer el caché de narrativa macro de Firestore:', err);
      return;
    }
    if (necesitaRedaccion(datos, cache)) {
      setRedactandoMacro(true);
      redactarNarrativaMacroEnVivo(datos.series || {}, Number(study && study.anio) || 2025)
        .then(async (narrativaEnVivo) => {
          if (!narrativaEnVivo) return; // se queda con el marcador especifico, no bloquea nada
          const seriesActualizadoEnMs = datos.actualizadoEn && datos.actualizadoEn.toMillis
            ? datos.actualizadoEn.toMillis() : Date.now();
          await guardarNarrativaMacroEstudio(estudioId, seriesActualizadoEnMs, narrativaEnVivo);
          setAnalisisMercado((actual) => ({
            ...actual,
            narrativa: { ...(actual && actual.narrativa), ...narrativaEnVivo },
          }));
        })
        .catch((err) => {
          console.error('No se pudo guardar el caché de narrativa macro de Firestore:', err);
        })
        .finally(() => setRedactandoMacro(false));
    } else if (cache) {
      setAnalisisMercado((actual) => ({
        ...actual,
        narrativa: { ...(actual && actual.narrativa), ...cache.narrativa },
      }));
    }
  }

  /* Documento global (no depende de estudioId): una lectura por sesión basta,
     el cron que lo refresca corre una vez al mes. Si falla, se deja null: los
     generadores de la Sección III ya saben caer al respaldo local. */
  useEffect(() => {
    let vivo = true;
    leerAnalisisMercado()
      .then((datos) => { if (vivo) { setAnalisisMercado(datos); aplicarNarrativaMacro(datos); } })
      .catch((err) => {
        console.error('No se pudo leer el análisis de mercado de Firestore:', err);
        if (vivo) setAnalisisMercado(null);
      });
    return () => { vivo = false; };
  }, []);

  /* Análisis de sector (III.C): depende de la actividad del estudio y del año
     gravable, así que corre por estudio, no una sola vez por sesión. Primero
     intenta leer una corrida ya guardada para esa actividad+año (reutilizable
     entre todos los estudios de ese sector); si no existe, dispara la
     generación bajo demanda y usa la respuesta directa —sin una segunda
     lectura a Firestore— para no esperar dos viajes de red. */
  useEffect(() => {
    let vivo = true;
    const actividadTexto = ((study && (study.actividad_especifica || study.objeto)) || '').trim();
    const year = Number(study && study.anio) || null;
    if (!actividadTexto || !year) {
      setAnalisisSector(null);
      return undefined;
    }

    const clave = claveActividad(normalizarActividad(actividadTexto));
    if (vivo) { setMotivoFalloSector(null); setSectorEnCurso(false); }
    (async () => {
      try {
        let doc = await leerAnalisisSector(clave);
        const yaTieneEsteAnio = doc && doc.porAnio && doc.porAnio[String(year)];
        if (!yaTieneEsteAnio) {
          if (vivo) setSectorEnCurso(true);
          try {
            doc = await pedirAnalisisSector(actividadTexto, year);
          } finally {
            if (vivo) setSectorEnCurso(false);
          }
        }
        if (vivo) setAnalisisSector(doc);
      } catch (err) {
        console.error('No se pudo generar/leer el análisis de sector:', err);
        if (vivo) {
          setAnalisisSector(null);
          setMotivoFalloSector(err?.response?.data?.error || err?.message || 'error desconocido');
        }
      }
    })();
    return () => { vivo = false; };
  }, [study?.actividad_especifica, study?.objeto, study?.anio]);

  /* Qué quedó sin cubrir en la sección III (TENDENCIAS DE LA ECONOMÍA). Se informa
     en concreto —qué serie y de qué año— porque un aviso genérico se ignora, y
     estas son las cifras que el Decreto 1625 de 2016 obliga a respaldar con fuente
     y fecha de consulta antes de radicar. */
  const avisosDeMercado = (htmlBase) => {
    const d = diagnosticarCobertura(htmlBase, study, analisisMercado, analisisSector);
    const avisos = [];
    if (!d.sectorialCubierto) {
      avisos.push(
        'esta plantilla no trae la sección del análisis del sector, así que no se ' +
        'reemplazó por la actividad de la compañía: revísala a mano'
      );
    } else if (sectorEnCurso) {
      /* En vuelo, no fallado ni pendiente: la corrida real (Gemini busca + Claude
         redacta) tarda 60-100+ s. Sin esta rama el banner de abajo se confundía con
         "todavía no está generado", que suena a que hay que hacer algo — aquí no hay
         nada que hacer, solo esperar a que este mismo aviso se actualice solo. */
      avisos.push(
        'el análisis del sector (III.C) se está generando para esta actividad y año — ' +
        'puede tardar uno o dos minutos, este aviso se actualiza solo cuando esté listo'
      );
    } else if (motivoFalloSector) {
      /* Distinguir "no hay nada público que citar" de un error técnico: la primera no se
         arregla reintentando (el analista necesita redactarla a mano o buscar otra fuente),
         la segunda sí puede ser transitoria. Antes las dos quedaban indistinguibles detrás
         del mismo mensaje genérico de "todavía no está generado". */
      avisos.push(
        /Ning[uú]n dato del sector trajo confirmaci[oó]n de b[uú]squeda/i.test(motivoFalloSector)
          ? 'no se encontró información pública confiable para el sector de esta actividad: el ' +
            'análisis del sector (III.C) quedó con el respaldo genérico — redáctalo a mano, no va ' +
            'a resolverse solo con reintentar'
          : 'no se pudo generar el análisis del sector (III.C) por un error técnico (' + motivoFalloSector + '): ' +
            'quedó con el respaldo genérico, vuelve a intentarlo'
      );
    } else if (!d.sectorNarrativaCubierta) {
      avisos.push(
        'el análisis del sector (III.C) todavía no está generado para esta actividad y año: ' +
        'quedó con el respaldo genérico y un marcador que hay que completar'
      );
    }
    if (d.seriesFaltantes.length) {
      avisos.push(
        'no hay datos de ' + d.year + ' para ' + d.seriesFaltantes.join(', ') +
        '; esas tablas quedaron con un marcador que hay que completar'
      );
    }
    if (!analisisMercado) {
      avisos.push(
        'no se pudo leer el análisis de mercado actualizado; se está usando el respaldo local del código'
      );
    } else if (analisisMercado.actualizadoEn) {
      const dias = (Date.now() - analisisMercado.actualizadoEn.toMillis()) / 86400000;
      if (dias > 62) {
        avisos.push(
          'los datos macro de la Sección III no se han refrescado en más de dos meses (última ' +
          'actualización: ' + new Date(analisisMercado.actualizadoEn.toMillis()).toLocaleDateString('es-CO') + ')'
        );
      }
    }
    /* Aviso propio y no un `else` de los anteriores: Firestore puede responder,
       estar al día y aun así no traer la narrativa (una corrida a medias, o un
       documento de una versión anterior del esquema). Sin esto, III.A y III.B
       salían con el marcador de pendiente y nada lo señalaba, porque el banner
       solo miraba si `analisisMercado` era nulo. */
    if (analisisMercado && !d.narrativaCubierta) {
      avisos.push(
        'el análisis de mercado no trae la narrativa de III.A/III.B; esos dos apartados ' +
        'quedaron con un marcador que hay que redactar'
      );
    }
    /* Sin el embudo del motor, la tabla 16 se queda con los números que traiga la
       plantilla, que son los del contribuyente para el que se redactó. Es el tipo de
       dato ajeno que no puede llegar a un documento que se radica, así que se nombra
       la tabla y qué hacer. */
    if (!d.razonesRechazoCubiertas) {
      avisos.push(
        'la tabla 16 de razones de rechazo conserva las cifras que traía la plantilla: ' +
        'ejecuta la selección del motor de comparables para que se calculen con este estudio'
      );
    }
    if (d.razonesRechazoDescuadradas) {
      avisos.push(
        'los conteos de la tabla 16 no suman el universo evaluado, así que el estudio ' +
        'cambió después de la última selección: vuelve a ejecutarla antes de radicar'
      );
    }
    /* Sin comparables en el estudio, las tablas 17 y 19 salen con las de la plantilla,
       nombre por nombre y margen por margen. Es la fuga más fácil de ver de todo el
       documento. */
    if (!d.comparablesCubiertas) {
      avisos.push(
        'las tablas 17 y 19 conservan la muestra de comparables que traía la plantilla, ' +
        'con sus nombres y sus márgenes: carga las comparables de este estudio en el motor'
      );
    }
    if (d.comparablesSinCifras) {
      avisos.push(
        'hay ' + d.comparablesSinCifras + ' comparable(s) de la muestra sin estados ' +
        'financieros cargados: salen con hueco en la tabla 19 y no entran al rango'
      );
    }
    return avisos;
  };

  /* Semáforo de "¿listo para radicar?" sobre el documento que se acaba de producir.
     Se alimenta del propio resultado y no de la plantilla en crudo: el diagnóstico
     mira si el documento trae el apartado del análisis del sector, y ahí es donde
     se ve. No es un `alert` porque el cálculo corre en cada montaje del estudio y
     un modal bloqueante cada vez molestaría más de lo que informa — el semáforo es
     un banner, no un `window.confirm`: se ve, no se impone.

     `avisosDeMercado` sigue dando las advertencias detalladas de la Sección III
     (series faltantes, sector sin generar); `evaluarRadicacion` las junta con las
     fugas del informe de referencia (`revisarSalidaRenderizada`) y con lo que no se
     encontró en la plantilla, y decide si algo de eso es BLOQUEANTE —dato de otro
     contribuyente con aspecto de estar completo— o solo ADVERTENCIA —un marcador
     visible que hay que completar—. */
  const revisarCobertura = (htmlDelInforme, { valores = [], avisosTablas = [], camposVacios = [] } = {}) => {
    const d = diagnosticarCobertura(htmlDelInforme, study, analisisMercado, analisisSector);
    const fugasReferencia = revisarSalidaRenderizada({
      estudio: study, htmlRenderizado: htmlDelInforme, valores,
    });
    const veredicto = evaluarRadicacion({ diagnostico: d, fugasReferencia, avisosTablas, camposVacios });
    /* `avisosDeMercado` da avisos que dependen de estado en vivo (si el sector se está
       generando en este momento, cuántos días tiene la última corrida del cron) que
       `diagnosticarCobertura` no calcula por sí solo — se agregan aparte, como
       advertencias, no como bloqueantes: ninguno implica un dato de otro cliente. */
    veredicto.advertencias = veredicto.advertencias.concat(avisosDeMercado(htmlDelInforme));
    setVeredictoRadicacion(veredicto);
  };

  /* Renderiza la plantilla marcada contra el estudio activo y calcula los
     avisos previos a generar. Se centraliza aquí porque son tres las rutas
     que renderizan por campo —al subir un PDF cuya plantilla ya estaba
     marcada, al confirmar marcas recién revisadas, y al abrir un estudio con
     plantilla marcada— y las tres deben avisar exactamente igual.

     `huecos` es cuántos huecos de anexo dejó el extractor en esta plantilla. */
  const renderizarYAvisar = (htmlMarcado, recursos, huecos = 0) => {
    /* `analisisMercado` alimenta las ocho tablas y la prosa de tendencias de la economía
       (III.A/III.B). La ruta .docx ya los recibía (`construirDocxDelEstudio`); esta se
       quedaba sin ellos y esas tablas salían con las series del informe del que se tomó
       la plantilla. `analisisSector` hace lo mismo para III.C. */
    const r = renderizar(htmlMarcado, study, recursos, { datosMacro: analisisMercado, analisisSector });
    /* Los valores que traía el informe de referencia salen del propio HTML
       marcado: el marcado envuelve el texto original sin alterarlo, así que el
       contenido de una marca `data-campo="nit"` es literalmente el NIT del
       cliente anterior. Con eso se revisa la SALIDA, que es lo único que
       comprueba de verdad el objetivo de todo este trabajo. */
    const valores = valoresDeReferencia(htmlMarcado);
    const nitRef = valores.find((v) => v.campo === 'nit');

    /* Y se CORRIGEN las que se pueden corregir sin riesgo, no solo se avisan. Detectarlas
       dejaba el trabajo al ojo de quien radica sobre un documento de 112 páginas.
       `sustituirDatosDeReferencia` existía desde el 2026-08-12 con sus pruebas, pero no
       estaba conectada a ninguna ruta: era el ajuste que faltaba. Lo que no puede corregir
       —un valor ambiguo porque otro lo contiene, o partido entre dos tramos— lo devuelve en
       `omitidos`, y de eso sí se avisa. */
    const correccion = sustituirDatosDeReferencia(r.html, {
      estudio: study, valores, rxTramo: TRAMO_HTML,
    });
    const htmlFinal = correccion.xml;

    setHtmlContent(htmlFinal);
    /* La cobertura se mide sobre el render CORREGIDO, no sobre la plantilla en crudo ni
       sobre el render sin corregir: es el documento que se va a radicar, y contar como
       fuga algo que se acaba de arreglar es lo que enseña a ignorar el banner. */
    revisarCobertura(htmlFinal, { valores, avisosTablas: r.avisosTablas, camposVacios: r.vacios });
    /* Las tablas del motor que la plantilla no trae. Mismo aviso que en la ruta .docx:
       una tabla que no se regenera se queda con los datos del informe del que salió la
       plantilla, y sin decirlo el fallo llega hasta la radicación. */
    const avisosDeTablas = (r.avisosTablas || []).length
      ? [{
        nivel: 'aviso',
        origen: 'tablas',
        /* La lista mezcla nombres de tabla y avisos que ya traen su propia explicación —el
           del ANEXO B nombra las comparables a las que falta el estado financiero—, así que
           el encabezado no puede dar por hecho que todo sea «una tabla no encontrada». */
        texto: 'Esto no se actualizó con los datos del estudio: ' + r.avisosTablas.join(' · ') +
          '. Lo que no se actualiza conserva el contenido que traía tu plantilla, así que ' +
          'revísalo antes de radicar; si alguna tabla está rotulada de otro modo, dilo para ' +
          'añadir ese nombre.',
      }]
      : [];

    /* Qué se corrigió y qué no. Lo corregido se dice porque cambia el documento sin que nadie
       lo haya pedido explícitamente, y quien radica tiene derecho a saberlo; lo omitido,
       porque sigue siendo un dato del contribuyente anterior que hay que mirar a mano. */
    const avisosDeFugas = [];
    if (correccion.sustituidos.length) {
      avisosDeFugas.push({
        nivel: 'info',
        origen: 'fugas',
        texto: 'Se reemplazaron datos del informe de referencia que el marcado no alcanzó: ' +
          correccion.sustituidos
            .map((s) => '«' + s.valor + '» → «' + s.nuevo + '» (' + s.cuenta + ')')
            .join(' · ') + '.',
      });
    }
    if (correccion.omitidos.length) {
      avisosDeFugas.push({
        nivel: 'aviso',
        origen: 'fugas',
        texto: 'Esto no se pudo reemplazar solo: ' +
          correccion.omitidos.map((o) => o.motivo).join(' · '),
      });
    }

    setAvisos(avisosDeTablas.concat(avisosDeFugas).concat(revisarAntesDeGenerar({
      estudio: study,
      /* Sin NIT de referencia la guarda no opina, que es lo correcto: no hay
         con qué comparar. */
      nitDeReferencia: nitRef ? nitRef.valor : null,
      vacios: r.vacios,
      /* Hay anexo si la plantilla no dejó huecos —no hay nada que rellenar— o si
         el estudio ya trae las páginas del ANEXO A. `study.eeffImages` es de fiar
         aquí: aunque se persista aparte en IndexedDB porque no cabe en Firestore,
         App.jsx lo rehidrata al abrir el estudio.

         Este era el punto donde el trabajo del equipo y el nuestro se cruzaban
         sin que git lo marcara: nosotros escribimos la guarda dando por sentado
         que la subida del anexo estaba fuera de alcance, y mientras tanto se
         implementó. Contar solo los huecos habría avisado de un anexo que falta
         cuando ya está subido. */
      tieneAnexo: huecos === 0 || (study.eeffImages || []).length > 0,
      recursosFaltantes: r.recursosFaltantes,
      htmlRenderizado: r.html,
      valores,
      /* Qué le falta a esta plantilla por venir de un lector de PDF anterior. Las
         plantillas se guardan y se reutilizan, así que una extraída hace dos
         versiones sigue produciendo el documento de entonces —sin la tipografía
         del informe, por ejemplo— y sin este aviso no hay forma de saberlo ni de
         saber que la solución es volver a subir el PDF. */
      faltaPorVersion: loQueFaltaPorVersion(versionDe(htmlMarcado)),
    })));
  };

  /* Restauración al abrir el estudio: sin esto la plantilla y sus imágenes se
     pierden al recargar la página, que es el fallo que motivó este trabajo. La bandera
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
      if (vivo) {
        setMarcasPropuestas(null); setPlantillaPendiente(null); setTelemetriaMarcado(null);
      }
      if (!estudioId) return;
      /* Se asigna siempre, también cuando viene vacío: si no, al cambiar de
         estudio quedarían los avisos del anterior. */
      if (vivo) { setAvisos([]); setVeredictoRadicacion(null); }
      /* `let` porque la restauración desde la nube, más abajo, puede traer los recursos
         del cliente: el resto del efecto renderiza con esta variable —no con el estado, que
         no ha surtido efecto todavía—, así que si no se actualiza aquí las imágenes salen
         vacías en la primera pintada. */
      let recursos = await leerRecursos(estudioId);
      /* Se asigna siempre, también cuando viene vacío: si no, al cambiar de
         estudio quedarían los recursos del anterior. */
      if (vivo) setRecursosCargados(recursos);

      let idPlantilla = await leerVinculo(estudioId);

      /* Sin plantilla en este navegador, se busca la copia del estudio en la nube y se
         deja en IndexedDB antes de seguir. Es lo que evita que el mismo estudio dé un Word
         distinto según el equipo: quien la subió tenía el vínculo y el marcado en su
         IndexedDB, y quien abría el estudio en otra parte se quedaba sin plantilla. */
      if (!idPlantilla && usuario) {
        try {
          const paquete = await descargarPlantillaDelEstudio({ uid: usuario.uid, estudioId });
          if (paquete && await restaurarPlantillaEnLocal(estudioId, paquete)) {
            idPlantilla = paquete.plantillaId;
            if (paquete.recursos && paquete.recursos.length) {
              recursos = paquete.recursos;
              if (vivo) setRecursosCargados(recursos);
            }
          }
        } catch (err) {
          console.error('[plantilla] no se pudo traer la copia del estudio', err);
        }
      }

      if (!idPlantilla) return;

      /* Plantilla .docx del cliente: se restaura antes que la de PDF porque su
         marcado vive en otro almacén. Es la ruta buena, la única que produce el
         informe a partir del documento del propio contribuyente. */
      const docxMarcado = await leerDocxMarcado(idPlantilla);
      if (docxMarcado) {
        if (!vivo) return;
        setPlantillaActiva({ id: idPlantilla, tipo: 'docx', huecos: 0, marcada: true });
        await previsualizarDocx(docxMarcado);
        return;
      }

      const html = await leerPlantilla(idPlantilla);

      /* Solo la plantilla marcada por campos produce informe. La que está guardada
         pero sin marcar ya no se sirve: antes se hidrataba sustituyendo literales del
         documento de End Game, de modo que en la plantilla de otro cliente no casaba
         ninguna regla y salía un informe con los datos del contribuyente ajeno.
         Se resuelve al leer y no al guardar porque el estudio puede cambiar después
         de haber subido la plantilla. */
      const marcado = await leerMarcado(idPlantilla);
      /* La cuenta de huecos se guardó con la plantilla al subir el PDF: sin
         leerla aquí, al recargar el estudio no habría forma de saber que el
         documento tiene páginas de anexo sin rellenar. */
      const huecos = await leerHuecos(idPlantilla);
      if (vivo) setPlantillaActiva({ id: idPlantilla, html, huecos, marcada: !!marcado });
      if (vivo && marcado) {
        renderizarYAvisar(marcado, recursos, huecos);
      } else if (vivo && html) {
        /* Plantilla guardada pero SIN MARCAR. Antes se servía hidratada por
           literales; ahora no se sirve: el previo se deja vacío y se dice qué falta
           hacer. Servirla sin marcas equivalía a entregar el documento del
           contribuyente para el que se redactó, con su NIT y sus cifras, bajo el
           nombre de este cliente. */
        setHtmlContent('');
        setVeredictoRadicacion(null);
        setAvisos([
          {
            nivel: 'aviso',
            texto:
              'Esta plantilla está guardada pero sin marcar, así que no se puede generar el ' +
              'informe con ella: sin marcas no hay forma de saber qué texto es un dato del ' +
              'contribuyente y cuál no, y el documento saldría con los datos del cliente para ' +
              'el que se redactó la plantilla. Vuelve a subirla y confirma sus marcas.',
          },
          /* Qué le falta a esta plantilla por venir de un lector de PDF anterior. Las
             plantillas se guardan y se reutilizan, así que una extraída hace dos
             versiones sigue produciendo el documento de entonces —sin la tipografía
             del informe, por ejemplo— y sin este aviso no hay forma de saberlo ni de
             saber que la solución es volver a subir el PDF. */
          ...revisarAntesDeGenerar({ faltaPorVersion: loQueFaltaPorVersion(versionDe(html)) }),
        ]);
      }
    })();
    return () => { vivo = false; };
    /* motivoFalloSector/sectorEnCurso: sin ellas, cuando la generación del
       sector arranca, falla o termina con un motivo específico, `analisisSector`
       no cambia (sigue null) y este efecto no se repite — el banner se quedaba
       pegado en el primer mensaje genérico ("todavía no está generado") para
       siempre, aunque ya se supiera que está en curso o por qué falló.
       `usuario` entra porque de su uid depende la ruta de la copia en la nube:
       al resolverse la sesión hay que volver a intentar traerla. */
  }, [estudioId, analisisMercado, analisisSector, motivoFalloSector, sectorEnCurso, usuario]);

  /* Sube al estudio la copia de la plantilla, para que el formato del Word no dependa del
     navegador en que se cargó. Nunca lanza: la plantilla ya está guardada en local y
     sirve para trabajar; lo que se pierde si esto falla es poder abrir el estudio en otro
     equipo con el mismo formato, y eso se dice en el aviso. */
  const guardarPlantillaEnLaNube = async ({ plantillaId, html, marcado, huecos, recursos }) => {
    if (!usuario || !estudioId) return;
    try {
      await subirPlantillaDelEstudio({
        uid: usuario.uid, estudioId, plantillaId, html, marcado, huecos, recursos,
      });
      setAvisoNube('');
    } catch (err) {
      console.error('[plantilla] no se pudo guardar en la nube', err);
      setAvisoNube(await bucketAusente(err)
        ? AVISO_STORAGE_APAGADO
        : 'La plantilla no se pudo guardar en la nube: ' + ((err && err.message) || 'error desconocido') +
          '. Funciona en este navegador, pero al abrir el estudio en otro equipo no habrá ' +
          'plantilla y no se podrá generar el informe hasta volver a subirla.');
    }
  };

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
          /* La cuenta de huecos se conserva con la plantilla, no solo en
             memoria: es lo que permite que la guarda del anexo siga opinando
             después de recargar la página. */
          const huecos = ref.huecos ? ref.huecos.length : 0;
          await guardarHuecos(idPlantilla, huecos);

          /* El marcado guardado sólo sirve si se hizo sobre lo que este lector
             produce hoy. Si es de una versión anterior hay que descartarlo: el
             HTML crudo que se acaba de guardar arriba ya trae lo nuevo —la
             tipografía, las imágenes en su sitio— y reutilizar el marcado viejo
             lo tira, que es exactamente lo que hacía que volver a subir el PDF
             no cambiara nada y no hubiera forma de entender por qué. */
          const guardado = await leerMarcado(idPlantilla);
          let marcadoPrevio = guardado;
          if (guardado && versionDe(guardado) < VERSION_EXTRACTOR) {
            await borrarMarcado(idPlantilla);
            marcadoPrevio = null;
          }

          setPlantillaActiva({
            id: idPlantilla, html: ref.html, huecos, marcada: !!marcadoPrevio,
          });
          /* La copia va con lo que hay ahora: si el marcado se confirma después, se vuelve
             a subir en ese momento con el marcado incluido. */
          await guardarPlantillaEnLaNube({
            plantillaId: idPlantilla, html: ref.html, marcado: marcadoPrevio,
            huecos, recursos: ref.imagenes,
          });
          if (!marcadoPrevio) {
            /* Los avisos visibles corresponden a la plantilla anterior (u
               otro estudio): mientras se revisan las marcas nuevas no hay
               todavía un render del que calcularlos, y dejarlos puestos
               enseñaría al usuario a ignorar el banner. */
            setAvisos([]);
            setVeredictoRadicacion(null);
            /* El marcado de un informe de 112 páginas son unos veinte viajes al
               modelo. Sin este avance el spinner se queda quieto minutos y no hay
               forma de distinguirlo de un cuelgue. */
            const propuestas = await proponerMarcas(ref.html, {
              avisar: ({ terminados, total, fallidos }) => setProgresoMarcado({
                terminados, total, fallidos,
              }),
            });
            setProgresoMarcado(null);
            setPlantillaPendiente({ id: idPlantilla, html: ref.html, huecos });
            setMarcasPropuestas(propuestas.marcas);
            setTelemetriaMarcado(propuestas);
          } else {
            renderizarYAvisar(marcadoPrevio, recursos, huecos);
          }
        } else {
          /* ── Plantilla .docx: se rellena, no se reconstruye ──
             Antes esta rama convertía el Word a HTML con mammoth y el informe se
             volvía a construir desde ahí, de modo que salía con el formato del
             sistema y no con el del cliente: mammoth produce HTML semántico y
             descarta la presentación —encabezado, pie, fuentes, colores, bordes,
             sombreados y márgenes—, que es justo lo que el cliente quiere conservar.
             Ahora se guarda el archivo tal cual y el informe se produce editando su
             propio OOXML. Mammoth sigue en la ruta, pero solo para la vista previa
             del resultado. */
          const binario = new Uint8Array(arrayBuffer);
          const idPlantilla = await hashPlantilla(binario);
          await guardarDocx(idPlantilla, binario);
          if (estudioId) await guardarVinculo(estudioId, idPlantilla);

          setAvisos([]);
          setVeredictoRadicacion(null);
          setRecursosCargados([]);

          /* El marcado se paga una vez por plantilla: el id es el hash del archivo,
             así que volver a subir el mismo Word reutiliza lo ya marcado. */
          const marcadoPrevio = await leerDocxMarcado(idPlantilla);
          if (marcadoPrevio) {
            setPlantillaActiva({ id: idPlantilla, tipo: 'docx', huecos: 0, marcada: true });
            await previsualizarDocx(marcadoPrevio);
          } else {
            const xml = new PizZip(binario).file('word/document.xml').asText();
            const propuestas = await proponerMarcas(htmlParaMarcar(xml), {
              avisar: ({ terminados, total, fallidos }) => setProgresoMarcado({
                terminados, total, fallidos,
              }),
            });
            setProgresoMarcado(null);
            setPlantillaPendiente({ id: idPlantilla, tipo: 'docx', binario, huecos: 0 });
            setMarcasPropuestas(propuestas.marcas);
            setTelemetriaMarcado(propuestas);
          }
        }
      } catch (err) {
        console.error("Error al analizar la plantilla personalizada:", err);
        alert("No se pudo analizar la plantilla seleccionada.");
      } finally {
        setLoading(false);
      }
    };
  };

  /* Resume el marcado en sí: trozos enviados, trozos perdidos y propuestas que
     el vocabulario rechazó. Un marcado parcial silencioso es exactamente el
     fallo que este proyecto ya sufrió dos veces con las imágenes: un PDF de 112
     páginas son unas 25 llamadas y basta un 429 para que un tramo entero quede
     sin marcar. Devuelve '' cuando todo salió bien, para no poner un banner que
     no dice nada. */
  const resumirMarcado = ({
    trozosEnviados, trozosFallidos, rechazadasPorVocabulario,
    bloqueadasPorZona, bloqueadasPorGuarda,
  }, { reintentable = true } = {}) => {
    const lineas = [];
    if (trozosFallidos) {
      /* El consejo de reintentar solo vale antes de confirmar. Después, el
         marcado queda guardado y resubir el mismo PDF encuentra su hash y no
         vuelve a llamar a la IA, así que prometer un reintento sería falso
         —y un consejo falso sobre un documento que se radica es peor que
         ninguno—. De ahí el `reintentable`. */
      lineas.push(trozosFallidos + ' de ' + trozosEnviados + ' tramos del documento no se ' +
                  'pudieron marcar (falló la llamada o la respuesta no traía JSON). Ese texto ' +
                  'queda SIN MARCAR: los datos del contribuyente anterior que hubiera ahí van a ' +
                  'sobrevivir. ' +
                  (reintentable
                    ? 'Puedes cancelar y volver a subir el PDF para marcarlo otra vez.'
                    : 'El marcado ya quedó guardado: revisa a mano esos tramos del documento ' +
                      'antes de radicar.'));
    }
    if (rechazadasPorVocabulario) {
      lineas.push(rechazadasPorVocabulario + ' propuesta(s) se rechazaron porque el campo no está ' +
                  'en el vocabulario. El modelo estaba señalando un dato del informe de ' +
                  'referencia que ningún campo puede sustituir: revísalo a mano.');
    }
    /* Lo que las guardas dejaron fuera. No es un fallo —es lo que evita que el año gravable
       reescriba una serie histórica o que una cifra del contribuyente aterrice en la ficha
       de una comparable—, pero se informa: en una plantilla con otra estructura de
       encabezados podría estar bloqueando texto que sí había que marcar. */
    if (bloqueadasPorZona) {
      lineas.push(bloqueadasPorZona + ' aparición(es) no se marcaron por estar en una zona ' +
                  'donde ese dato no va (anexos, tendencias de la economía, citas). Esas ' +
                  'secciones se regeneran o son fijas; si tu plantilla las titula de otro ' +
                  'modo, revísalas a mano.');
    }
    if (bloqueadasPorGuarda) {
      lineas.push(bloqueadasPorGuarda + ' aparición(es) no se marcaron porque el texto no ' +
                  'identifica el dato por sí solo (una palabra común, un número corto, o un ' +
                  'año en una fecha que no es el año gravable). Se dejan como están a ' +
                  'propósito: sustituirlas reescribiría la redacción del informe.');
    }
    return lineas.join('\n');
  };

  /* Resume las descartadas agrupándolas por motivo. Los tres motivos que
     produce aplicarMarcas significan cosas muy distintas, y solo uno es
     benigno: un solape (el modelo marcó de más sobre texto que una marca
     anterior ya cubría). Que el fragmento no aparezca es la señal de que el
     modelo reescribió el texto al proponerlo; que no quede una aparición libre
     significa que la marca se quedó sin sitio y el dato del cliente anterior
     sobrevive en el documento. Anunciar los tres como benignos —o los tres como
     "no aparece"— esconde la señal real. */
  const resumirDescartes = (descartadas) => {
    const porMotivo = new Map();
    for (const d of descartadas) porMotivo.set(d.motivo, (porMotivo.get(d.motivo) || 0) + 1);

    const lineas = [];
    const noAparece = porMotivo.get(MOTIVO_NO_APARECE);
    const solapada = porMotivo.get(MOTIVO_SOLAPE);
    const sinLibre = porMotivo.get(MOTIVO_SIN_APARICION_LIBRE);
    if (noAparece) {
      lineas.push(noAparece + ' se descartaron porque su texto no aparece literalmente en el ' +
                  'documento: revisa si el modelo reescribió ese fragmento.');
    }
    if (sinLibre) {
      lineas.push(sinLibre + ' se descartaron porque el documento no tiene tantas apariciones de ' +
                  'ese texto como decía la marca. ATENCIÓN: esas apariciones se quedan SIN ' +
                  'SUSTITUIR y el dato del contribuyente anterior sobrevive ahí. Revísalas a mano ' +
                  'en el documento antes de radicar.');
    }
    if (solapada) {
      lineas.push(solapada + ' se descartaron por solaparse con una marca ya aplicada, lo cual es ' +
                  'normal y no es señal de un problema.');
    }
    /* Motivo distinto de los tres conocidos hoy: se reporta genérico en vez de
       omitirlo, por si aplicarMarcas agrega alguno nuevo más adelante. */
    for (const [motivo, n] of porMotivo) {
      if (motivo !== MOTIVO_NO_APARECE && motivo !== MOTIVO_SOLAPE &&
          motivo !== MOTIVO_SIN_APARICION_LIBRE) {
        lineas.push(n + ' se descartaron: ' + motivo + '.');
      }
    }
    return lineas.join('\n');
  };

  /* Descarta el marcado guardado y vuelve a marcar la plantilla.

     Sin esto no había salida: el marcado se guarda por hash del PDF, así que
     volver a subir el mismo documento encontraba el marcado viejo y se saltaba la
     IA. Si el marcado salió incompleto —tramos caídos, o el modelo dejó
     apariciones del cliente anterior sin marcar, que es lo que avisa la revisión
     de la salida— la única alternativa era corregir cien páginas a mano.

     Se reusa el HTML crudo que ya está guardado con la plantilla: no hace falta
     volver a leer el PDF ni pedírselo otra vez al usuario. */
  const volverAMarcar = async () => {
    if (!plantillaActiva) return;

    /* Plantilla .docx: el original se guardó al subirlo, así que se vuelve a marcar
       sobre él sin pedirle al usuario el archivo otra vez. No aplica la comprobación
       de versión del lector de PDF, que aquí no interviene. */
    if (plantillaActiva.tipo === 'docx') {
      if (!window.confirm(
        'Se va a descartar el marcado guardado de esta plantilla y a marcarla de nuevo ' +
        'con IA. Son varios viajes al modelo y tarda un rato. ¿Continuar?'
      )) return;
      setLoading(true);
      try {
        const binario = await leerDocx(plantillaActiva.id);
        if (!binario) {
          alert('No se encontró el documento original. Vuelve a subirlo para marcarlo.');
          return;
        }
        await borrarDocxMarcado(plantillaActiva.id);
        setAvisos([]);
        setVeredictoRadicacion(null);
        const xml = new PizZip(binario).file('word/document.xml').asText();
        const propuestas = await proponerMarcas(htmlParaMarcar(xml), {
          avisar: ({ terminados, total, fallidos }) => setProgresoMarcado({
            terminados, total, fallidos,
          }),
        });
        setProgresoMarcado(null);
        setPlantillaPendiente({ id: plantillaActiva.id, tipo: 'docx', binario, huecos: 0 });
        setMarcasPropuestas(propuestas.marcas);
        setTelemetriaMarcado(propuestas);
      } catch (err) {
        console.error('No se pudo volver a marcar la plantilla .docx:', err);
        alert('No se pudo volver a marcar: ' + err.message);
      } finally {
        setProgresoMarcado(null);
        setLoading(false);
      }
      return;
    }

    /* Si el HTML crudo guardado es de un lector anterior, volver a marcar no
       recupera lo que ese lector no leyó: hay que releer el PDF. Decirlo aquí
       evita el viaje al modelo y la decepción de que el documento salga igual. */
    if (versionDe(plantillaActiva.html) < VERSION_EXTRACTOR) {
      alert(
        'Esta plantilla se leyó con una versión anterior del lector de PDF. Volver a ' +
        'marcarla no recuperaría ' +
        loQueFaltaPorVersion(versionDe(plantillaActiva.html)).join('; ni ') +
        ', porque el marcado se hace sobre lo que ya está guardado. Sube otra vez el ' +
        'mismo PDF de referencia: al hacerlo se relee y el marcado viejo se descarta solo.'
      );
      return;
    }

    if (!window.confirm(
      'Se va a descartar el marcado guardado de esta plantilla y a marcarla de nuevo ' +
      'con IA. Son varios viajes al modelo y tarda un par de minutos. ¿Continuar?'
    )) return;

    setLoading(true);
    try {
      await borrarMarcado(plantillaActiva.id);
      setAvisos([]);
      setVeredictoRadicacion(null);
      const propuestas = await proponerMarcas(plantillaActiva.html, {
        avisar: ({ terminados, total, fallidos }) => setProgresoMarcado({
          terminados, total, fallidos,
        }),
      });
      setProgresoMarcado(null);
      setPlantillaPendiente({
        id: plantillaActiva.id,
        html: plantillaActiva.html,
        huecos: plantillaActiva.huecos,
      });
      setMarcasPropuestas(propuestas.marcas);
      setTelemetriaMarcado(propuestas);
    } catch (err) {
      console.error('[marcado] no se pudo volver a marcar:', err);
      alert('No se pudo volver a marcar la plantilla: ' + err.message);
    } finally {
      setLoading(false);
      setProgresoMarcado(null);
    }
  };

  /* Aplica las marcas que la persona confirmó y guarda el resultado.

     Un marcado sin ninguna marca aplicada NO se guarda. Guardarlo era el peor
     fallo posible: la plantilla quedaba registrada como «marcada», así que en
     cada apertura posterior se leía ese marcado vacío y ya no se volvía a
     llamar a la IA, la revisión de la salida no tenía valores con los que
     comparar, y el informe seguía saliendo con el nombre y el NIT del cliente
     anterior sin un solo aviso. Al no guardarlo, la plantilla sigue disponible
     para marcarse otra vez y la ruta de respaldo por literales toma el relevo
     mientras tanto. */
  /* Escribe las marcas confirmadas dentro del OOXML y guarda el .docx marcado.
     Mismo criterio que la ruta de PDF: un marcado sin ninguna marca aplicada NO se
     guarda, porque dejaría la plantilla registrada como marcada y el informe saldría
     con los datos del cliente anterior sin un solo aviso. */
  const confirmarMarcasDocx = async (marcas) => {
    const zip = new PizZip(plantillaPendiente.binario);
    const { xml, aplicadas, descartadas } = aplicarMarcasOoxml(
      zip.file('word/document.xml').asText(), marcas);

    const resumen = [
      telemetriaMarcado ? resumirMarcado(telemetriaMarcado, { reintentable: aplicadas === 0 }) : '',
      descartadas.length ? resumirDescartes(descartadas) : '',
    ].filter(Boolean).join('\n');

    if (aplicadas === 0) {
      setMarcasPropuestas(null);
      setPlantillaPendiente(null);
      setTelemetriaMarcado(null);
      alert(
        'No se aplicó ninguna marca, así que la plantilla NO se guardó como marcada.\n' +
        (resumen ? resumen + '\n' : '') +
        'Vuelve a subir el documento para marcarlo de nuevo.'
      );
      return;
    }

    /* Las tablas que se repiten se envuelven después de las marcas de campo: se
       localizan por su título y se marca su fila modelo, de modo que el relleno
       clone su formato una vez por comparable. Si la plantilla del cliente no trae
       esas tablas, no pasa nada: `envolverTablaEnBucle` avisa y sigue. */
    let conTablas = xml;
    [
      { ancla: 'Compañías comparables', coleccion: 'comparables', campos: ['n', 'nombre', 'ambito'] },
      { ancla: 'Razones de rechazo', coleccion: 'razonesRechazo', campos: ['letra', 'criterio', 'cantidad'] },
    ].forEach((cfg) => {
      const r = envolverTablaEnBucle(conTablas, cfg);
      if (r.envuelta) conTablas = r.xml;
    });

    zip.file('word/document.xml', conTablas);
    const marcado = zip.generate({ type: 'uint8array' });
    await guardarDocxMarcado(plantillaPendiente.id, marcado);

    setPlantillaActiva({ id: plantillaPendiente.id, tipo: 'docx', huecos: 0, marcada: true });
    await previsualizarDocx(marcado);
    setMarcasPropuestas(null);
    setPlantillaPendiente(null);
    setTelemetriaMarcado(null);
    if (resumen) alert('Se aplicaron ' + aplicadas + ' marcas.\n' + resumen);
  };

  /* Rellena la plantilla .docx marcada con los datos del estudio y devuelve el
     binario. Es la única fuente del documento que se descarga. */
  const construirDocxDelEstudio = (binarioMarcado, tipoSalida = 'blob') => rellenarDocx({
    binario: binarioMarcado,
    estudio: study,
    datosMacro: analisisMercado,
    analisisSector: analisisSector,
    colecciones: coleccionesDelEstudio(study),
    imagenesAnexo: (study.eeffImages || []).map((img) => ({
      dataUrl: typeof img === 'string' ? img : (img && (img.dataUrl || img.src)),
    })),
    tipoSalida,
  });

  /* Vista previa de la ruta .docx: se rellena el documento y se convierte el
     RESULTADO con mammoth, no la plantilla. Así lo que se ve en pantalla son los
     datos que de verdad va a llevar el archivo. Pierde el formato —mammoth lo
     descarta—, pero el .docx que se descarga sale del original intacto, que es lo
     que importa. */
  const previsualizarDocx = async (binarioMarcado) => {
    try {
      const { salida, camposVacios, avisosTablas } = construirDocxDelEstudio(binarioMarcado, 'uint8array');
      const { value } = await mammoth.convertToHtml({ arrayBuffer: salida.buffer.slice(
        salida.byteOffset, salida.byteOffset + salida.byteLength) });
      setHtmlContent(value);
      /* Lo que le falta al informe (series macro del año, análisis del sector, tablas
         del motor) se mide aquí y no solo en la ruta de PDF: esta es la ruta con la
         que se genera de verdad, y era justo la que salía sin ese banner.

         Sin `valores`: esta ruta parte de un `.docx` binario, no de HTML marcado con
         `data-campo`, así que `revisarSalidaRenderizada` no tiene con qué comparar
         todavía — queda pendiente el mismo barrido de fugas que ya existe para la
         ruta de plantilla marcada. */
      revisarCobertura(value, { avisosTablas, camposVacios });
      const avisos = revisarAntesDeGenerar({
        estudio: study,
        tieneAnexo: true,
        vacios: camposVacios,
        faltaPorVersion: [],
        recursosFaltantes: [],
      });
      setAvisos(avisos);
    } catch (err) {
      console.error('No se pudo previsualizar la plantilla .docx:', err);
      setVeredictoRadicacion({
        listo: false,
        bloqueantes: ['No se pudo previsualizar la plantilla: ' + err.message],
        advertencias: [],
      });
    }
  };

  const confirmarMarcas = async (marcas) => {
    if (plantillaPendiente && plantillaPendiente.tipo === 'docx') {
      return confirmarMarcasDocx(marcas);
    }
    const { html, aplicadas, descartadas } = aplicarMarcas(plantillaPendiente.html, marcas);
    const resumen = [
      telemetriaMarcado ? resumirMarcado(telemetriaMarcado, { reintentable: aplicadas === 0 }) : '',
      descartadas.length ? resumirDescartes(descartadas) : '',
    ].filter(Boolean).join('\n');

    if (aplicadas === 0) {
      setMarcasPropuestas(null);
      setPlantillaPendiente(null);
      setTelemetriaMarcado(null);
      alert(
        'No se aplicó ninguna marca, así que la plantilla NO se guardó como marcada.\n' +
        (resumen ? resumen + '\n' : '') +
        'Sin marcas no se puede generar el informe con esta plantilla: no habría forma de ' +
        'distinguir qué texto es un dato del contribuyente, y saldría con los del cliente ' +
        'para el que se redactó. Vuelve a subir el PDF para marcarlo de nuevo.'
      );
      return;
    }

    await guardarMarcado(plantillaPendiente.id, html);
    /* Desde aquí la plantilla ya está marcada, así que aparece el botón de volver
       a marcar: es la salida si este marcado resultó incompleto. */
    setPlantillaActiva({
      id: plantillaPendiente.id,
      html: plantillaPendiente.html,
      huecos: plantillaPendiente.huecos || 0,
      marcada: true,
    });
    /* El marcado es lo que de verdad fija el formato del Word, y es lo más caro de
       obtener —unos veinte viajes al modelo en un informe de 112 páginas—: la copia en la
       nube se actualiza aquí para no volver a pagarlo en otro equipo. */
    await guardarPlantillaEnLaNube({
      plantillaId: plantillaPendiente.id,
      html: plantillaPendiente.html,
      marcado: html,
      huecos: plantillaPendiente.huecos || 0,
      recursos: recursosCargados,
    });
    renderizarYAvisar(html, recursosCargados, plantillaPendiente.huecos || 0);
    setMarcasPropuestas(null);
    setPlantillaPendiente(null);
    setTelemetriaMarcado(null);
    if (resumen) alert('Se aplicaron ' + aplicadas + ' marcas.\n' + resumen);
  };

  /* Resuelve las marcas que dejó el extractor contra el catálogo de recursos.
     El HTML guardado sólo trae `<img data-recurso="...">` sin el base64 dentro,
     así que esto hace falta tanto para ver el informe como para descargarlo.

     El reemplazo es global: una misma imagen —el logo del encabezado— aparece
     marcada en casi cien páginas y con un reemplazo simple sólo la primera
     habría salido. Y conserva el atributo `data-recurso` para que aplicarlo dos
     veces sobre el mismo HTML no rompa nada. */
  /* Se conservan los demás atributos de la marca en vez de reescribirla entera: desde
     la versión 7 lleva su tamaño en centímetros —el que le da el PDF— y reemplazar la
     etiqueta completa lo tiraba, así que la imagen volvía a su tamaño natural en
     píxeles y desbordaba la hoja. El `src` previo se quita antes de poner el nuevo para
     que aplicarlo dos veces sobre el mismo HTML no acumule dos. */
  const conImagenes = (htmlBase, recursos = recursosCargados) =>
    recursos.reduce(
      (acc, r) =>
        acc.replace(
          new RegExp('<img data-recurso="' + r.id + '"([^>]*)>', 'g'),
          (_, resto) => '<img data-recurso="' + r.id + '"' +
            resto.replace(/\s*\/?$/, '').replace(/\s+src="[^"]*"/g, '') +
            ' src="' + r.dataUrl + '" />'
        ),
      htmlBase
    );

  /* El logo que el extractor apartó como encabezado de página. Lo necesitan las dos
     salidas: Word para declararlo como encabezado, y la pantalla para repetirlo arriba
     de cada hoja igual que hará Word. */
  /* `lado` y `desdePagina` los anota el extractor leyendo el PDF (versión 7). Una
     plantilla anterior no los trae: entonces se cae a centrado y a imprimirlo también en
     la portada, que es lo que se hacía antes. */
  const encabezadoDelDocumento = () => {
    const enc = /<div data-encabezado="1"([^>]*)>([\s\S]*?)<\/div>/.exec(htmlContent);
    if (!enc) return null;
    const lado = (/data-lado="([^"]+)"/.exec(enc[1]) || [])[1] || 'centro';
    const desde = Number((/data-desde-pagina="(\d+)"/.exec(enc[1]) || [])[1] || 1);
    const alto = (/height:([\d.]+cm)/.exec(enc[2]) || [])[1] || null;
    return {
      bloque: enc[0], contenido: enc[2], lado, alto, enLaPortada: desde <= 1,
    };
  };

  /* Previsualización en hojas. Antes el previo era un bloque continuo con los estilos de
     Tailwind: no había forma de ver dónde iba a caer un salto, ni de notar que la portada
     se fundía con el índice, hasta descargar el .doc y abrirlo en Word. */
  const cssPrevio = useMemo(() => {
    /* El logo va como fondo de un pseudoelemento y no como `<img>`, para no meter nada
       nuevo dentro del `contentEditable`. Su lado, su alto y si va en la portada salen
       del PDF: los anotó el extractor. */
    const enc = encabezadoDelDocumento();
    const src = enc ? /src="(data:image\/[^"]+)"/.exec(enc.contenido) : null;
    return cssDeHojas({
      base: estiloBaseDe(htmlContent),
      logo: src ? src[1] : null,
      lado: enc ? enc.lado : 'centro',
      alto: enc ? enc.alto : null,
      enLaPortada: enc ? enc.enLaPortada : true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [htmlContent]);

  /* Sin páginas marcadas —un .docx pasado por mammoth— no hay dónde
     cortar, así que el documento entero se pinta como una hoja larga. Mejor eso que
     fingir una paginación que Word no va a respetar. */
  const tienePaginas = /class="pagina"|class=pagina/.test(htmlContent);

  /* Descarga en .docx real (OOXML). Convive con el .doc y no lo reemplaza: el equipo toca este
     flujo, y tener los dos permite comparar el mismo estudio en los dos formatos.

     A diferencia del .doc, aquí no hay importador de HTML de Word interpretando nada: lo que
     el writer escribe es lo que Word abre. Los cuatro fallos de formato que costó el .doc
     —834 páginas por párrafos colgando de una fila, una hoja por párrafo por imágenes sin
     tamaño, los dos logos encimados y el resaltado de pantalla colándose— eran todos ese
     importador. */
  const [generandoDocx, setGenerandoDocx] = useState(false);
  /* Cerrojo síncrono contra la reentrada. `generandoDocx` (el `useState`) sólo refleja el
     render en curso: el `disabled` del botón depende de que React repinte antes del siguiente
     clic, y si dos invocaciones se solapan en esa ventana, la intercepción de `console.warn` de
     más abajo se anida —cada una lo restaura al valor que capturó al arrancar, que en la
     segunda ya es el envoltorio de la primera— y `console.warn` queda parcheado con un cierre
     obsoleto el resto de la sesión. Un `useRef` se lee y se escribe de inmediato, sin esperar a
     un repintado, así que cierra la ventana del todo y no sólo el caso normal. */
  const generandoDocxRef = useRef(false);
  /* Actualización de lo que no vive en el estudio: ver `actualizarInformacion`. */
  const [actualizando, setActualizando] = useState(false);
  const actualizandoRef = useRef(false);

  /* Rehace el informe con lo que hay AHORA, sin volver a montar la pantalla ni rehacer el
     estudio.

     Hacía falta porque parte de lo que alimenta el documento no vive en el estudio y solo se
     leía una vez, al abrir esta pantalla: el análisis de mercado (las tablas de la Sección
     III y la narrativa de III.A/III.B) y el del sector (III.C). Si el cron los refrescaba
     —o alguien los generaba— después de que abrieras el gestor, el informe seguía saliendo
     con el contenido de la plantilla y la única salida era recargar la página entera sin
     saber que había que hacerlo.

     Lo que este botón NO puede recuperar es el universo de Capital IQ, del que se deriva la
     matriz del ANEXO C: eso lo restaura el paso 4 al montarse, descargando el cribado. Si
     falta, el aviso de cobertura lo dice y manda ahí. */
  const actualizarInformacion = async () => {
    if (actualizandoRef.current) return;
    actualizandoRef.current = true;
    setActualizando(true);
    try {
      const macro = await leerAnalisisMercado();
      setAnalisisMercado(macro);
      aplicarNarrativaMacro(macro);

      /* El del sector se rehace solo si el estudio trae con qué buscarlo, y se lee con la
         misma clave que la carga inicial —solo la actividad normalizada—. Si no hay una
         corrida guardada se deja el que ya estuviera: este botón actualiza, no dispara
         generaciones que cuestan una llamada de IA. */
      const actividadTexto = ((study && (study.actividad_especifica || study.objeto)) || '').trim();
      if (actividadTexto) {
        const sector = await leerAnalisisSector(claveActividad(normalizarActividad(actividadTexto)));
        if (sector) setAnalisisSector(sector);
      }

      /* Y la vista previa, que es donde se comprueba si el documento quedó completo: se
         rehace con la plantilla marcada del estudio, igual que la descarga.

         LAS DOS RUTAS, y esto es lo que faltaba. La rama de .docx estaba desde el principio;
         la de plantilla PDF no, así que con un PDF este botón leía los análisis y se iba sin
         volver a renderizar. Que pareciera funcionar era casualidad: `leerAnalisisMercado`
         devuelve un objeto nuevo, `setAnalisisMercado` cambiaba la referencia y el efecto de
         más arriba —que sí renderiza— se disparaba de rebote. Pero cuando el estudio todavía
         no tiene análisis macro generado esa función devuelve `null`, y asignar `null` sobre
         `null` no cambia ninguna referencia: el botón no hacía nada en absoluto.

         Ese rebote era además el ÚNICO camino por el que la vista previa recogía cambios en
         los datos del estudio —comparables, cifras, año—, porque el efecto que renderiza no
         los lista en sus dependencias. De ahí que la tabla del rango y la frase que la
         comenta salieran coherentes entre sí y desactualizadas las dos: mismo render viejo. */
      if (plantillaActiva && plantillaActiva.tipo === 'docx' && plantillaActiva.marcada) {
        const marcado = await leerDocxMarcado(plantillaActiva.id);
        if (marcado) await previsualizarDocx(marcado);
      } else if (plantillaActiva && plantillaActiva.marcada) {
        const marcado = await leerMarcado(plantillaActiva.id);
        if (marcado) {
          renderizarYAvisar(marcado, recursosCargados, plantillaActiva.huecos || 0);
        }
      }
    } catch (err) {
      console.error('[generador] no se pudo actualizar la información', err);
      setVeredictoRadicacion({
        listo: false,
        bloqueantes: ['No se pudo actualizar la información: ' + (err && err.message ? err.message : 'error desconocido')],
        advertencias: [],
      });
    } finally {
      actualizandoRef.current = false;
      setActualizando(false);
    }
  };

  const descargarDocx = async () => {
    if (generandoDocxRef.current) return;
    generandoDocxRef.current = true;
    setGenerandoDocx(true);
    try {
      /* Plantilla .docx del cliente: el documento sale de rellenar SU archivo, no de
         reconstruirlo. Es lo que conserva encabezado, pie, estilos, tablas y
         márgenes; el writer de más abajo produce el formato del sistema y aquí sería
         exactamente lo que no se quiere. */
      if (plantillaActiva && plantillaActiva.tipo === 'docx' && plantillaActiva.marcada) {
        const marcado = await leerDocxMarcado(plantillaActiva.id);
        if (!marcado) throw new Error('No se encontró la plantilla marcada. Vuelve a subirla.');
        const { salida, camposVacios, avisosTablas, imagenesInsertadas } = construirDocxDelEstudio(marcado, 'blob');
        const enlace = document.createElement('a');
        enlace.href = URL.createObjectURL(salida);
        enlace.download = 'Informe_Local_PT_' + (study.ent || 'Empresa') + '_' +
          (study.anio || '') + '.docx';
        enlace.click();
        URL.revokeObjectURL(enlace.href);

        const nuevos = [];
        if (camposVacios.length) {
          nuevos.push({
            nivel: 'aviso', origen: 'docx',
            texto: 'Salen sin dato ' + camposVacios.length + ' campo(s) marcado(s) (' +
              camposVacios.join(', ') + '): en el documento aparecen como «—». ' +
              'Complétalos antes de radicar.',
          });
        }
        /* Las tablas que el motor no encontró en la plantilla. Sin este aviso se radican con
           las cifras del informe del que salió la plantilla, y nadie se entera. */
        if (avisosTablas && avisosTablas.length) {
          nuevos.push({
            nivel: 'aviso', origen: 'docx',
            texto: 'No se encontraron en tu plantilla ' + avisosTablas.length + ' tabla(s) (' +
              avisosTablas.join(', ') + '), así que conservan el contenido que ya traían. ' +
              'Revísalas una por una antes de radicar.',
          });
        }
        if ((study.eeffImages || []).length && imagenesInsertadas === 0) {
          nuevos.push({
            nivel: 'aviso', origen: 'docx',
            texto: 'El anexo de estados financieros no se insertó: la plantilla no trae un ' +
              'encabezado «ANEXO A» donde anclarlo, ni el centinela ' + CENTINELA_ANEXO + '. ' +
              'Añade uno de los dos al Word y vuelve a subirlo.',
          });
        }
        setAvisos((previos) => [...previos.filter((a) => a.origen !== 'docx'), ...nuevos]);
        return;
      }

      /* El writer avisa por `console.warn` cuando el anexo trae más páginas que huecos
         hay en el informe —páginas de estados financieros firmados que no entran—. Nadie
         mira la consola del navegador, así que se intercepta mientras corre esta llamada
         y, si aparece, se traduce a un aviso legible para el banner. Se restaura en un
         `finally` propio —no el de la función entera— para no dejar `console.warn`
         sustituido más tiempo del que dura la llamada, ni siquiera si ésta lanza. */
      const warnOriginal = console.warn;
      let avisoAnexo = null;
      console.warn = (mensaje, ...resto) => {
        if (typeof mensaje === 'string' && mensaje.startsWith('[docxWriter] el anexo trae')) {
          const m = /trae (\d+) página\(s\) para sólo (\d+) hueco\(s\) en el informe: sobran (\d+)/
            .exec(mensaje);
          if (m) {
            avisoAnexo = 'El anexo trae ' + m[1] + ' página(s) de estados financieros firmados ' +
              'para sólo ' + m[2] + ' hueco(s) en el informe: sobran ' + m[3] + ' página(s) que ' +
              'no van a entrar en el documento. Revísalo antes de radicar.';
          }
        }
        warnOriginal(mensaje, ...resto);
      };
      let blob;
      try {
        blob = await aDocxBlob({
          html: htmlContent,
          recursos: recursosCargados,
          anexo: study.eeffImages || [],
        });
      } finally {
        console.warn = warnOriginal;
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'Informe_Local_PT_' + (study.ent || 'Empresa') + '_' +
        (study.anio || '') + '.docx';
      a.click();
      URL.revokeObjectURL(a.href);

      /* Cuántas hojas produce Word sólo se sabe abriéndolo, así que no se afirma un número:
         se dice cuántas declara el documento. Prometer una cuenta que no se ha medido es
         justamente lo que hay que no hacer aquí. */
      const declaradas = (htmlContent.match(/class="pagina"/g) || []).length;
      const nuevosAvisos = [];
      if (declaradas) {
        nuevosAvisos.push({
          nivel: 'aviso',
          origen: 'docx',
          texto: 'El documento declara ' + declaradas + ' páginas, una por cada página del ' +
            'informe de referencia. Word repagina al abrirlo: si el contenido de alguna no ' +
            'cabe, desborda a una hoja extra. Compara el total con el original antes de radicar.',
        });
      }
      if (avisoAnexo) {
        nuevosAvisos.push({ nivel: 'aviso', origen: 'docx', texto: avisoAnexo });
      }
      /* Reemplaza, no acumula. Los avisos del render de la plantilla (los demás `setAvisos` de
         este archivo) también reemplazan la lista entera porque se recalculan de cero cada vez;
         estos, en cambio, sólo se recalculan al pulsar este botón, así que sin este filtro cada
         clic apilaba una copia más del mismo aviso. Se distinguen por `origen: 'docx'` en vez
         de vaciar toda la lista, porque los avisos del render (sin ese campo) tienen que seguir
         en pantalla mientras tanto. */
      setAvisos((previos) => [
        ...previos.filter((a) => a.origen !== 'docx'),
        ...nuevosAvisos,
      ]);
    } catch (err) {
      console.error('No se pudo generar el .docx:', err);
      alert('No se pudo generar el .docx: ' + err.message +
        '\n\nEl botón de .doc sigue disponible.');
    } finally {
      generandoDocxRef.current = false;
      setGenerandoDocx(false);
    }
  };

  const handleDownload = () => {
    // Estilos compatibles con Word (.doc)
    /* La tipografía sale del informe de referencia, no de un gusto propio: el
       extractor la anotó en el HTML al leer las fuentes del PDF. Con Georgia
       —lo que había aquí— el Word generado no se parecía al original ni de lejos,
       porque el informe está en Arial 12. Sin la marca (un .docx vía mammoth, o
       una plantilla anterior a este cambio) se cae a Arial, que es lo más común en
       estos documentos y desde luego más cerca que una serif de pantalla. */
    /* Los encabezados van en escala sobre el cuerpo y no en píxeles fijos, para que
       acompañen a la tipografía del documento en vez de imponer otra. Se conserva
       la línea de color de la casa, que es identidad y no formato heredado.

       Las reglas son literalmente las mismas que pinta la previsualización: salen del
       mismo módulo. Estaban duplicadas a mano, y cualquier ajuste en una cara dejaba
       la otra mintiendo. */
    const exportStyle = cssDeExportacion(estiloBaseDe(htmlContent));

    /* El logo del informe se saca del cuerpo y se declara como encabezado de
       p\u00e1gina. Word lo entiende desde HTML \u2014un div con `mso-element:header` al que
       apunta `@page` por su id\u2014, as\u00ed que se repite solo en todas las p\u00e1ginas sin
       necesidad de generar OOXML. Antes sal\u00eda como primera imagen del documento y
       no como encabezado, que es lo que se ve\u00eda distinto del original. */
    const conEncabezado = encabezadoDelDocumento();
    const encabezado = conEncabezado ? conEncabezado.contenido : '';
    const cuerpoSinEncabezado = conEncabezado
      ? htmlContent.replace(conEncabezado.bloque, '')
      : htmlContent;

    /* Carta con los m\u00e1rgenes del informe. El pie lleva el campo PAGE de Word y no
       el n\u00famero que tra\u00eda el PDF: al repaginar, un n\u00famero literal mentir\u00eda. */
    /* La página va **nombrada** y hay un div que la usa con `page:Section1`. Es lo
       que Word exige: con un `@page` sin nombre ignora `mso-header` y el logo se
       queda como primera imagen del cuerpo en vez de repetirse arriba de cada
       página. Es la estructura que Word emite cuando uno guarda como página web. */
    const wordCSS = cssDeWord({
      conEncabezado: !!encabezado,
      lado: conEncabezado ? conEncabezado.lado : 'centro',
      enLaPortada: conEncabezado ? conEncabezado.enLaPortada : true,
    });

    /* Ya no hace falta limpiar el resaltado de pantalla: va por clase y lo pinta sólo el
       CSS del previo. Aquí se quitaban tres propiedades a mano de las seis que traía el
       `style=` inline, así que `font-weight:600`, `padding:0 4px` y `border-radius:3px`
       llegaban al documento: cada dato sustituido salía más negrita y con cuatro píxeles
       de aire a cada lado, cientos de veces en las 112 páginas. Quitar propiedades
       nombradas a mano era el problema, no la solución. */
    /* Dos cosas que sí hay que hacerle al cuerpo antes de exportarlo.

       Una: el div de metadatos del extractor (`data-extractor`, `data-estilo-base`) no tiene
       nada que hacer en el documento. Además era el primer `div` del cuerpo, y por eso
       `div.pagina:first-of-type` no emparejaba con ninguna página.

       Dos: los saltos de página se meten como elementos propios entre página y página, en vez
       de dejarlos en una regla sobre `div.pagina`. El motivo, medido, está en
       `conSaltosDePagina`. */
    const cleanHtml = conSaltosDePagina(
      cuerpoSinEncabezado.replace(/<div data-extractor="\d+"[^>]*><\/div>/, '')
    );

    /* Encabezado y pie van dentro de la secci\u00f3n y fuera del flujo: Word los recoge
       por su id y los repite en cada p\u00e1gina. El pie lleva el campo PAGE, no el
       n\u00famero que tra\u00eda el PDF: al repaginar, un n\u00famero literal mentir\u00eda. */
    const bloquesMso =
      (encabezado
        ? '<div style="mso-element:header" id="h1"><p class=enc>' +
          conTamanoDeImagen(conImagenes(encabezado)) + '</p></div>'
        : '') +
      '<div style="mso-element:footer" id="f1"><p class=pie>' +
      '<span style="mso-field-code:PAGE"></span></p></div>';

    /* Todo el cuerpo dentro de la secci\u00f3n nombrada: es lo que hace que `@page
       Section1` \u2014y con ella el encabezado\u2014 se aplique de verdad. */
    const cuerpoDocumento =
      /* `conTamanoDeImagen` va DESPUÉS de `conImagenes`, no antes: los atributos se calculan
         sobre la etiqueta ya resuelta, y así una imagen sin recurso en el catálogo tampoco
         recibe tamaño. */
      '<div class=Section1>' + conTamanoDeImagen(conImagenes(cleanHtml)) +
      bloquesMso + '</div>';

    const content = `\ufeff<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"><title>Informe Local Precios de Transferencia</title><style>${exportStyle}${wordCSS}</style></head><body>${cuerpoDocumento}</body></html>`;

    const blob = new Blob([content], { type: 'application/msword' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Informe_Local_PT_${study.ent || 'Empresa'}_${study.anio || ''}.doc`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  /* Confirmación de que el análisis de sector (III.C) de ESTA actividad+año ya
     quedó generado (no solo que la lectura a Firestore respondió, sino que trae
     la corrida de ese año puntual). Se calcula aparte del semáforo de abajo
     (`veredictoRadicacion`, que solo lista problemas) porque generar toma 60-100+ s
     y el usuario necesita saber que ya terminó sin tener que abrir el Word. */
  const anioEstudio = Number(study && study.anio) || null;
  const entradaSectorDelAnio = anioEstudio
    && analisisSector && analisisSector.porAnio && analisisSector.porAnio[String(anioEstudio)];
  const sectorListo = !sectorEnCurso && !motivoFalloSector && !!entradaSectorDelAnio;
  const sectorIncompleto = sectorListo && corridaSectorIncompleta(entradaSectorDelAnio);

  /* Rehacer la corrida de esta actividad+año aunque ya haya una guardada. El endpoint
     siempre regenera; lo que impedía recuperar una corrida vieja era que aquí solo se
     pedía cuando no existía ninguna. Va a mano y no automático porque cuesta una cadena
     de llamadas a Gemini y Claude. */
  const regenerarSector = async () => {
    const actividadTexto = ((study && (study.actividad_especifica || study.objeto)) || '').trim();
    if (!actividadTexto || !anioEstudio) return;
    setMotivoFalloSector(null);
    setSectorEnCurso(true);
    try {
      setAnalisisSector(await pedirAnalisisSector(actividadTexto, anioEstudio));
    } catch (err) {
      console.error('No se pudo regenerar el análisis de sector:', err);
      setAnalisisSector(null);
      setMotivoFalloSector(err?.response?.data?.error || err?.message || 'error desconocido');
    } finally {
      setSectorEnCurso(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Barra de Acciones y Control */}
      <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm flex flex-col md:flex-row gap-4 items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-md font-bold text-zinc-950 dark:text-zinc-50">Generador de Informe Final (sobre la plantilla del cliente)</h3>
            <span className="bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
              Formato del cliente intacto
            </span>
          </div>
          <p className="text-xs text-zinc-500 mt-1">
            Rellena el .docx del propio contribuyente con los datos del estudio: encabezado, pie, estilos, márgenes e índice salen como venían.
          </p>
          {/* Con qué plantilla se está generando. El formato del Word depende de esto más
              que de cualquier otra cosa, y no se decía en ninguna parte. La plantilla vive
              en IndexedDB, o sea en un solo equipo, así que la diferencia aparece también
              al cambiar de navegador. */}
          {plantillaActiva && plantillaActiva.marcada ? (
            <p className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-1 flex items-center gap-1">
              <Check className="w-3 h-3" />
              Se genera con la plantilla de referencia marcada por campos, guardada con el estudio.
            </p>
          ) : plantillaActiva ? (
            <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              Plantilla cargada pero <strong>sin marcar</strong>: así no se puede generar. Sin marcas no
              hay forma de saber qué texto es un dato del contribuyente, y el informe saldría con los
              del cliente para el que se redactó la plantilla. Confirme sus marcas antes de generar.
            </p>
          ) : (
            <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              <span>
                <strong>Falta la plantilla .docx de este cliente</strong>: sin ella no hay informe.
                Hasta hace poco el sistema caía a un documento de respaldo incrustado en el código,
                que era el informe de OTRO contribuyente —con su NIT, sus cifras y su vinculada—, y
                radicarlo bajo el nombre de este cliente es exactamente el fallo que se vino a cerrar.
                Súbala con «Subir Otra Plantilla Word» y quedará guardada con el estudio para
                cualquier equipo.
              </span>
            </p>
          )}
          {avisoNube && (
            <p className="text-[11px] text-amber-700 dark:text-amber-400 mt-1 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />{avisoNube}
            </p>
          )}
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
          {/* Sólo con plantilla marcada: en la ruta por literales no hay marcado
              que descartar. Es la salida cuando el marcado quedó incompleto y la
              revisión de la salida avisa de datos del cliente anterior que
              sobreviven. */}
          {plantillaActiva && plantillaActiva.marcada && (
            <button
              onClick={volverAMarcar}
              disabled={loading}
              title="Descarta el marcado guardado y vuelve a marcar la plantilla con IA"
              className="flex items-center gap-2 bg-[#ffffff] dark:bg-[#262626] text-[#334155] dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 rounded-lg px-4 py-2 text-xs font-semibold hover:bg-[#f8fafc] dark:hover:bg-zinc-800 transition-colors shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Volver a marcar
            </button>
          )}
          {/* Rehace el informe con los datos actuales sin recargar la página ni rehacer el
              estudio: relee el análisis de mercado y el del sector —que solo se cargaban al
              abrir esta pantalla— y regenera la vista previa. */}
          <button
            onClick={actualizarInformacion}
            disabled={actualizando || generandoDocx}
            title="Vuelve a leer el análisis de mercado y del sector, y rehace la vista previa con los datos actuales del estudio"
            className="flex items-center gap-2 bg-[#ffffff] dark:bg-[#262626] text-[#334155] dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 rounded-lg px-4 py-2 text-xs font-semibold hover:bg-[#f8fafc] dark:hover:bg-zinc-800 transition-colors shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={'w-3.5 h-3.5' + (actualizando ? ' animate-spin' : '')} />
            {actualizando ? 'Actualizando…' : 'Actualizar información'}
          </button>
          <button
            onClick={descargarDocx}
            disabled={generandoDocx}
            title="Word real (OOXML): saltos de página, encabezado y tablas exactos"
            className="flex items-center gap-2 bg-[#0FA3A1] hover:bg-[#0B7C7A] text-white rounded-lg px-4 py-2 text-xs font-semibold transition-colors shadow-sm cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <FileDown className="w-3.5 h-3.5" />
            {generandoDocx ? 'Generando…' : 'Descargar Word (.docx)'}
          </button>
          <button
            onClick={handleDownload}
            className="flex items-center gap-2 bg-white dark:bg-[#262626] text-[#334155] dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 hover:bg-[#f8fafc] dark:hover:bg-zinc-800 rounded-lg px-4 py-2 text-xs font-semibold transition-colors shadow-sm cursor-pointer"
          >
            <FileDown className="w-3.5 h-3.5" />
            Descargar .doc (anterior)
          </button>
        </div>
      </div>

      {marcasPropuestas && (
        <RevisorDeMarcas
          marcas={marcasPropuestas}
          aviso={telemetriaMarcado ? resumirMarcado(telemetriaMarcado) : ''}
          onConfirmar={confirmarMarcas}
          onCancelar={() => {
            setMarcasPropuestas(null); setPlantillaPendiente(null); setTelemetriaMarcado(null);
          }}
        />
      )}

      {/* Estado del análisis de sector (III.C): en curso o ya listo para esta
          actividad+año. Aparte del semáforo de abajo porque ese banner solo lista
          problemas — esto es información de estado, no una advertencia. */}
      {redactandoMacro && (
        <div className="bg-sky-50 dark:bg-sky-950/20 border border-sky-200 dark:border-sky-900 text-sky-800 dark:text-sky-300 rounded-xl px-5 py-3 text-xs leading-relaxed flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          Redactando el panorama económico (III.A/III.B) para este estudio — puede tardar unos segundos.
        </div>
      )}
      {sectorEnCurso && (
        <div className="bg-sky-50 dark:bg-sky-950/20 border border-sky-200 dark:border-sky-900 text-sky-800 dark:text-sky-300 rounded-xl px-5 py-3 text-xs leading-relaxed flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          Generando el análisis del sector (III.C) para esta actividad y año — puede tardar uno o dos minutos.
        </div>
      )}
      {sectorListo && !sectorIncompleto && (
        <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-300 rounded-xl px-5 py-3 text-xs leading-relaxed">
          ✓ Análisis del sector (III.C) generado para esta actividad y año {anioEstudio}.
        </div>
      )}
      {/* La corrida existe pero es de una versión anterior del generador. Se dice cuál es
          la consecuencia concreta en el documento —el hueco de entrada de III.C sale con el
          marcador de pendiente— en vez de un «está desactualizada» que no orienta. */}
      {sectorIncompleto && (
        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-300 rounded-xl px-5 py-3 text-xs leading-relaxed flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
          <span>
            El análisis del sector (III.C) de esta actividad y año {anioEstudio} viene de una
            corrida anterior que no redactó el párrafo de entrada, así que ese hueco sale con
            el marcador de pendiente. Regenéralo para que lo traiga.
          </span>
          <button
            type="button"
            onClick={regenerarSector}
            className="shrink-0 px-3 py-1.5 rounded-lg border border-amber-300 dark:border-amber-800 hover:bg-amber-100 dark:hover:bg-amber-900/40 font-medium"
            title="Rehace la corrida del sector para esta actividad y año, aunque ya haya una guardada (tarda uno o dos minutos)"
          >
            Regenerar III.C
          </button>
        </div>
      )}

      {/* Aviso de la ruta de respaldo: la sustitución por valor literal no se
          pudo confirmar. Va aparte de `avisos` porque esa lista la produce la
          ruta de campos marcados, que en este caso no corrió. No es un alert
          porque el componente se monta cada vez que se abre el estudio y un
          modal bloqueante en cada apertura molestaría más de lo que informa. */}
      {/* Semáforo de "¿listo para radicar?": rojo si hay dato de otro contribuyente con
          aspecto de estar completo (bloqueante), ámbar si solo faltan marcadores
          visibles por completar (advertencia), verde si no hay nada pendiente. No es un
          `window.confirm` — la decisión de descargar sigue siendo de quien usa la app,
          pero ya no puede no verlo. */}
      {veredictoRadicacion && (veredictoRadicacion.bloqueantes.length > 0 || veredictoRadicacion.advertencias.length > 0) && (
        <div className={
          'rounded-xl px-5 py-4 text-xs leading-relaxed border ' + (
            veredictoRadicacion.bloqueantes.length > 0
              ? 'bg-rose-50 dark:bg-rose-950/20 border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-300'
              : 'bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-300'
          )
        }>
          <strong className="font-semibold block mb-2">
            {veredictoRadicacion.bloqueantes.length > 0
              ? '⛔ No listo para radicar'
              : '⚠ Listo para radicar, con pendientes por completar'}
          </strong>
          {veredictoRadicacion.bloqueantes.length > 0 && (
            <ul className="space-y-1 mb-2">
              {veredictoRadicacion.bloqueantes.map((b, i) => <li key={'b' + i}>• {b}</li>)}
            </ul>
          )}
          {veredictoRadicacion.advertencias.length > 0 && (
            <ul className="space-y-1 opacity-90">
              {veredictoRadicacion.advertencias.map((a, i) => <li key={'a' + i}>• {a}</li>)}
            </ul>
          )}
        </div>
      )}
      {veredictoRadicacion && veredictoRadicacion.bloqueantes.length === 0 && veredictoRadicacion.advertencias.length === 0 && (
        <div className="bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900 text-emerald-800 dark:text-emerald-300 rounded-xl px-5 py-3 text-xs leading-relaxed">
          <strong className="font-semibold">✓ Listo para radicar.</strong>
        </div>
      )}

      {avisos.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 rounded-xl px-5 py-4">
          <ul className="text-xs text-amber-800 dark:text-amber-300 space-y-1 leading-relaxed">
            {avisos.map((a, i) => <li key={i}>⚠ {a.texto}</li>)}
          </ul>
        </div>
      )}

      {/* Contenedor del Editor de HTML Renderizado */}
      <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl p-8 shadow-sm overflow-x-auto min-h-[600px]">
        {loading ? (
          <div className="flex flex-col items-center justify-center min-h-[400px] text-zinc-500">
            <Loader2 className="w-8 h-8 text-[#0FA3A1] animate-spin mb-2" />
            {progresoMarcado ? (
              <>
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  Marcando la plantilla con IA: {progresoMarcado.terminados} de{' '}
                  {progresoMarcado.total} tramos
                </span>
                <div className="w-64 h-1.5 bg-zinc-200 dark:bg-zinc-800 rounded-full mt-3 overflow-hidden">
                  <div
                    className="h-full bg-[#0FA3A1] transition-all duration-300"
                    style={{
                      width: Math.round(
                        (progresoMarcado.terminados / progresoMarcado.total) * 100
                      ) + '%',
                    }}
                  />
                </div>
                <span className="text-xs mt-3 max-w-sm text-center">
                  Un informe largo son varios viajes al modelo y puede tardar un par de
                  minutos. Se paga una sola vez por documento: la próxima vez que se
                  suba este mismo PDF, la plantilla ya estará marcada.
                </span>
                {progresoMarcado.fallidos > 0 && (
                  <span className="text-xs mt-2 text-amber-600 dark:text-amber-400">
                    {progresoMarcado.fallidos} tramo(s) no se pudieron marcar
                  </span>
                )}
              </>
            ) : (
              <span>Cargando plantilla...</span>
            )}
          </div>
        ) : (
          <div className="hojas">
            <style>{cssPrevio}</style>
            <div
              dangerouslySetInnerHTML={{ __html: htmlContent }}
              className={'focus:outline-none' + (tienePaginas ? '' : ' pagina')}
              contentEditable
              suppressContentEditableWarning
              onBlur={(e) => setHtmlContent(e.currentTarget.innerHTML)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
