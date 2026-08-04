import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { Upload, FileDown, Edit3, Loader2, Sparkles, Check, FileText } from 'lucide-react';
import mammoth from 'mammoth';
import { MASTER_WORD_TEMPLATE } from '../services/masterTemplate';
import { hydrateExactWordTemplate, diagnosticarCobertura } from '../services/exactTemplateMapper';
import { normalizarActividad, claveActividad } from '../services/analisisMercado';
import {
  extraerReferencia, estiloBaseDe, versionDe, loQueFaltaPorVersion, VERSION_EXTRACTOR,
} from '../services/pdfReferenceExtractor';
import {
  guardarRecursos, leerRecursos, hashPlantilla, guardarPlantilla, leerPlantilla,
  guardarVinculo, leerVinculo, guardarMarcado, leerMarcado, borrarMarcado,
  guardarHuecos, leerHuecos,
} from '../services/plantillaStore';
import { leerAnalisisMercado, leerAnalisisSector } from '../services/firestoreRepo';
import RevisorDeMarcas from './RevisorDeMarcas.jsx';
import {
  proponerMarcas, aplicarMarcas,
  MOTIVO_NO_APARECE, MOTIVO_SOLAPE, MOTIVO_SIN_APARICION_LIBRE,
} from '../services/plantillaMarcador.js';
import { renderizar } from '../services/plantillaRenderer.js';
import { revisarAntesDeGenerar, valoresDeReferencia } from '../services/plantillaGuardas.js';
import {
  cssDeHojas, cssDeExportacion, cssDeWord, conSaltosDePagina, conTamanoDeImagen,
} from '../services/estiloDocumento.js';

export default function ReporteGenerador({ study, estudioId }) {
  const [htmlContent, setHtmlContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [customTemplateLoaded, setCustomTemplateLoaded] = useState(false);
  const [recursosCargados, setRecursosCargados] = useState([]);
  /* Cifras y narrativa de la Sección III, refrescadas mensualmente por
     `actualizarAnalisisMercadoScheduled`. null mientras carga o si Firestore no
     responde — los generadores de analisisMercado.js caen al respaldo local
     embebido en el código cuando reciben null. */
  const [analisisMercado, setAnalisisMercado] = useState(null);
  /* Análisis de sector (III.C) para la actividad de este estudio. A diferencia
     de analisisMercado (un solo documento global), este es por actividad+año
     — ver el efecto más abajo, que lo lee o lo genera bajo demanda. null
     mientras carga o si todavía no hay corrida: generarApartadoSectorial cae
     al respaldo genérico con marcador. */
  const [analisisSector, setAnalisisSector] = useState(null);
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
  /* Resultado del marcado (trozos enviados, fallidos, propuestas rechazadas).
     Se guarda el dato crudo y no el texto ya redactado porque el mismo hecho se
     cuenta distinto antes y después de confirmar: antes se puede reintentar,
     después ya no. */
  const [telemetriaMarcado, setTelemetriaMarcado] = useState(null);
  /* Avance del marcado por IA: `{ terminados, total, fallidos }` mientras corre,
     null cuando no hay marcado en curso. */
  const [progresoMarcado, setProgresoMarcado] = useState(null);
  /* Plantilla vinculada al estudio: `{ id, html, huecos, marcada }`. Se guarda para
     poder volver a marcarla sin pedirle al usuario que suba otra vez el PDF. */
  const [plantillaActiva, setPlantillaActiva] = useState(null);

  /* La hidratación sustituye por literales del informe de End Game 2024. Con
     el PDF de otro cliente no coincide ninguno y el documento sale con los
     datos del PDF subido, sin ninguna señal. Se usa el NIT del estudio como
     testigo: si el estudio tiene NIT y no aparece en el HTML ya hidratado, la
     sustitución no ocurrió. El arreglo de fondo es el marcado por campos con
     nombre; esto solo evita que la ruta de respaldo falle en silencio. */
  const faltaSustitucion = (hydrated) => study?.nit && !hydrated.includes(study.nit);

  /* Documento global (no depende de estudioId): una lectura por sesión basta,
     el cron que lo refresca corre una vez al mes. Si falla, se deja null: los
     generadores de la Sección III ya saben caer al respaldo local. */
  useEffect(() => {
    let vivo = true;
    leerAnalisisMercado()
      .then((datos) => { if (vivo) setAnalisisMercado(datos); })
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
    (async () => {
      try {
        let doc = await leerAnalisisSector(clave);
        const yaTieneEsteAnio = doc && doc.porAnio && doc.porAnio[String(year)];
        if (!yaTieneEsteAnio) {
          const resp = await axios.post('/api/generar-analisis-sector', { actividad: actividadTexto, year });
          doc = { porAnio: { [String(year)]: resp.data.entrada } };
        }
        if (vivo) setAnalisisSector(doc);
      } catch (err) {
        console.error('No se pudo generar/leer el análisis de sector:', err);
        if (vivo) setAnalisisSector(null);
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
    /* Sin el embudo del motor, la tabla 16 sale con los números del informe de
       referencia. Es el tipo de dato ajeno que no puede llegar a un documento que se
       radica, así que se nombra la tabla y qué hacer. */
    if (!d.razonesRechazoCubiertas) {
      avisos.push(
        'la tabla 16 de razones de rechazo conserva las cifras del informe de referencia: ' +
        'ejecuta la selección del motor de comparables para que se calculen con este estudio'
      );
    }
    if (d.razonesRechazoDescuadradas) {
      avisos.push(
        'los conteos de la tabla 16 no suman el universo evaluado, así que el estudio ' +
        'cambió después de la última selección: vuelve a ejecutarla antes de radicar'
      );
    }
    /* Sin comparables en el estudio, las tablas 17 y 19 salen con las trece compañías
       del informe de referencia, nombre por nombre y margen por margen. Es la fuga más
       fácil de ver de todo el documento. */
    if (!d.comparablesCubiertas) {
      avisos.push(
        'las tablas 17 y 19 conservan la muestra de comparables del informe de referencia, ' +
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

  /* Aviso de la ruta de respaldo (mammoth y plantillas sin marcar). Reúne el
     testigo del NIT y los avisos de la sección III, y se pinta como banner, no
     con `alert`: al recargar el estudio el efecto corre en cada montaje y un
     alert bloqueante cada vez sería más molesto que informativo.

     Recibe el HTML sin hidratar además del hidratado porque el diagnóstico de la
     sección III se hace sobre la plantilla original: es ahí donde se ve si trae
     el apartado sectorial y qué series le faltan. */
  const revisarHidratacion = (htmlBase, hydrated) => {
    const partes = [];
    if (faltaSustitucion(hydrated)) {
      partes.push(
        'no se encontró el NIT del estudio (' + study.nit + ') en el documento hidratado. ' +
        'Esta plantilla no está marcada por campos, así que la sustitución va por valor ' +
        'literal: revisa el documento entero antes de radicarlo, porque puede conservar ' +
        'datos del contribuyente del informe de referencia'
      );
    }
    partes.push(...avisosDeMercado(htmlBase));
    setAvisoHidratacion(
      partes.length ? 'Revisa antes de radicar — ' + partes.join('. ') + '.' : ''
    );
  };

  /* Renderiza la plantilla marcada contra el estudio activo y calcula los
     avisos previos a generar. Se centraliza aquí porque son tres las rutas
     que renderizan por campo —al subir un PDF cuya plantilla ya estaba
     marcada, al confirmar marcas recién revisadas, y al abrir un estudio con
     plantilla marcada— y las tres deben avisar exactamente igual.

     `huecos` es cuántos huecos de anexo dejó el extractor en esta plantilla. */
  const renderizarYAvisar = (htmlMarcado, recursos, huecos = 0) => {
    const r = renderizar(htmlMarcado, study, recursos);
    /* Los valores que traía el informe de referencia salen del propio HTML
       marcado: el marcado envuelve el texto original sin alterarlo, así que el
       contenido de una marca `data-campo="nit"` es literalmente el NIT del
       cliente anterior. Con eso se revisa la SALIDA, que es lo único que
       comprueba de verdad el objetivo de todo este trabajo. */
    const valores = valoresDeReferencia(htmlMarcado);
    const nitRef = valores.find((v) => v.campo === 'nit');
    setHtmlContent(r.html);
    setAvisoHidratacion('');
    setAvisos(revisarAntesDeGenerar({
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
      if (vivo) {
        setMarcasPropuestas(null); setPlantillaPendiente(null); setTelemetriaMarcado(null);
      }
      if (!estudioId) return;
      /* Se asigna siempre, también cuando viene vacío: si no, al cambiar de
         estudio quedarían los avisos del anterior. */
      if (vivo) { setAvisos([]); setAvisoHidratacion(''); }
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
      /* La cuenta de huecos se guardó con la plantilla al subir el PDF: sin
         leerla aquí, al recargar el estudio no habría forma de saber que el
         documento tiene páginas de anexo sin rellenar. */
      const huecos = await leerHuecos(idPlantilla);
      if (vivo) setPlantillaActiva({ id: idPlantilla, html, huecos, marcada: !!marcado });
      if (vivo && marcado) {
        renderizarYAvisar(marcado, recursos, huecos);
      } else if (vivo && html) {
        /* Se guarda el HTML crudo del extractor y se hidrata al leerlo, no al
           guardarlo: el estudio puede cambiar después de haber subido la
           plantilla, y entonces los valores almacenados quedarían viejos. Sin
           esta línea, tras recargar se ven las cifras del informe de
           referencia en vez de las del estudio actual. */
        const hidratado = hydrateExactWordTemplate(html, study, analisisMercado, analisisSector);
        /* `recursos` se pasa explícito y no se lee de `recursosCargados`: el
           setState de arriba no ha surtido efecto todavía dentro de este mismo
           efecto, y las imágenes saldrían rotas en la primera pintada. */
        setHtmlContent(conImagenes(hidratado, recursos));
        revisarHidratacion(html, hidratado);
        /* El aviso de plantilla vieja vivía sólo en `renderizarYAvisar`, es decir
           sólo en la ruta marcada. Una plantilla guardada y sin marcar —la ruta de
           quien subió el PDF y no confirmó las marcas— se seguía sirviendo tal cual,
           callada, y el documento salía como el lector de entonces lo dejaba. Con la
           plantilla en IndexedDB y el PDF ya no, no hay forma de que el usuario
           adivine que lo que tiene que hacer es volver a subirlo. */
        const falta = loQueFaltaPorVersion(versionDe(html));
        if (falta.length) {
          setAvisos(revisarAntesDeGenerar({ faltaPorVersion: falta }));
        }
        /* Evita que el efecto de la plantilla maestra sobrescriba lo
           recuperado. Es lo que hacía fallar la recarga. */
        setCustomTemplateLoaded(true);
      }
    })();
    return () => { vivo = false; };
  }, [estudioId, analisisMercado, analisisSector]);

  // Carga la plantilla original 100% completa de 27 secciones (End Game 2024) y aplica el reemplazo de variables
  const loadExactMasterTemplate = () => {
    const hydrated = hydrateExactWordTemplate(MASTER_WORD_TEMPLATE, study, analisisMercado, analisisSector);
    setHtmlContent(hydrated);
    /* Esta es la ruta por defecto de todo estudio que no haya subido plantilla,
       es decir la de casi todo el mundo hoy, y va por valor literal. Si el NIT
       del estudio no aparece en la salida, la sustitución no ocurrió. */
    revisarHidratacion(MASTER_WORD_TEMPLATE, hydrated);
  };

  useEffect(() => {
    if (!customTemplateLoaded) {
      loadExactMasterTemplate();
    }
  }, [study, customTemplateLoaded, analisisMercado, analisisSector]);

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
          if (!marcadoPrevio) {
            /* Los avisos visibles corresponden a la plantilla anterior (u
               otro estudio): mientras se revisan las marcas nuevas no hay
               todavía un render del que calcularlos, y dejarlos puestos
               enseñaría al usuario a ignorar el banner. */
            setAvisos([]);
            setAvisoHidratacion('');
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
          const result = await mammoth.convertToHtml({ arrayBuffer });
          const html = result.value;

          /* Ruta de respaldo, sin marcado: mammoth ya incrusta las imágenes
             en el propio HTML, así que no hay recursos que resolver aparte.
             Se limpian los avisos porque, sin marcado, no hay de dónde
             recalcularlos, y los de la plantilla anterior ya no corresponden
             a este documento. */
          setAvisos([]);
          const hydrated = hydrateExactWordTemplate(html, study, analisisMercado, analisisSector);
          setHtmlContent(conImagenes(hydrated, []));
          /* Detección de fuga de la ruta legado. Estaba escrita y no se
             invocaba desde ningún sitio: la ruta aparentaba tenerla y no la
             tenía. */
          revisarHidratacion(html, hydrated);
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

  /* Resume el marcado en sí: trozos enviados, trozos perdidos y propuestas que
     el vocabulario rechazó. Un marcado parcial silencioso es exactamente el
     fallo que este proyecto ya sufrió dos veces con las imágenes: un PDF de 112
     páginas son unas 25 llamadas y basta un 429 para que un tramo entero quede
     sin marcar. Devuelve '' cuando todo salió bien, para no poner un banner que
     no dice nada. */
  const resumirMarcado = ({ trozosEnviados, trozosFallidos, rechazadasPorVocabulario },
                          { reintentable = true } = {}) => {
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
      setAvisoHidratacion('');
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
  const confirmarMarcas = async (marcas) => {
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
        'El informe se seguirá generando por la ruta antigua, que sustituye por valores ' +
        'literales y puede dejar datos del contribuyente anterior. Vuelve a subir el PDF ' +
        'para marcarlo de nuevo.'
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

  /* Sin páginas marcadas —la plantilla maestra, o un .docx por mammoth— no hay dónde
     cortar, así que el documento entero se pinta como una hoja larga. Mejor eso que
     fingir una paginación que Word no va a respetar. */
  const tienePaginas = /class="pagina"|class=pagina/.test(htmlContent);

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
          aviso={telemetriaMarcado ? resumirMarcado(telemetriaMarcado) : ''}
          onConfirmar={confirmarMarcas}
          onCancelar={() => {
            setMarcasPropuestas(null); setPlantillaPendiente(null); setTelemetriaMarcado(null);
          }}
        />
      )}

      {/* Aviso de la ruta de respaldo: la sustitución por valor literal no se
          pudo confirmar. Va aparte de `avisos` porque esa lista la produce la
          ruta de campos marcados, que en este caso no corrió. No es un alert
          porque el componente se monta cada vez que se abre el estudio y un
          modal bloqueante en cada apertura molestaría más de lo que informa. */}
      {avisoHidratacion && (
        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-300 rounded-xl px-5 py-4 text-xs leading-relaxed">
          <strong className="font-semibold">⚠ {avisoHidratacion}</strong>
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
