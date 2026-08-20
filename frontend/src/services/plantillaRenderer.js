/* Plantilla marcada + estudio + recursos → HTML final.
   Sustituye por nombre de campo, no por valor literal: es lo que impide que un
   dato del cliente anterior sobreviva cuando alguien agrega texto a la
   plantilla sin acordarse de añadir su regla. */

import { valorDeCampo } from './plantillaVocabulario.js';
import { resaltarValor } from './estiloDocumento.js';
import {
  actualizarTablasMotorHtml, actualizarTablasMacroHtml, actualizarApartadosMacroHtml,
  actualizarApartadoSectorialHtml,
} from './tablasHtmlInforme.js';
import { actualizarProsaRango } from './prosaRangoInforme.js';
import { actualizarProsaTablas } from './prosaTablasInforme.js';
import { actualizarProsaBaseDatos } from './prosaBaseDatos.js';
import { actualizarTablasOperacionesHtml } from './tablasOperacionesHtml.js';
import { actualizarAnexoBHtml } from './anexoBHtml.js';
import { actualizarAnexoCHtml } from './anexoCHtml.js';

/* Escapa caracteres especiales para usar en una expresión regular. */
const escaparParaRegex = (texto) => String(texto).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* Escapa caracteres HTML para evitar inyección. */
const escaparHTML = (texto) => {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return String(texto).replace(/[&<>"']/g, (c) => map[c]);
};

/* Resalta el valor sustituido en la vista previa. Va por clase, y el estilo lo pinta
   sólo el CSS del previo: así no hay nada que limpiar al exportar. Antes era un `style=`
   inline y la exportación quitaba tres de sus seis propiedades a mano, así que las otras
   tres se colaban en el documento que se radica. */
const resaltar = resaltarValor;

const RX_MARCA = /<span data-campo="([^"]+)">([\s\S]*?)<\/span>/g;

/**
 * @param {string} htmlMarcado
 * @param {object} estudio
 * @param {Array} [recursos]
 * @param {{datosMacro?:object, analisisSector?:object}} [opciones]  `datosMacro` alimenta
 *        las ocho tablas y la prosa de tendencias de la economía (III.A/III.B); sin él
 *        se usan las series de respaldo de `analisisMercado.js`, igual que en la ruta
 *        .docx. `analisisSector` hace lo mismo para la prosa y la tabla de III.C.
 */
export function renderizar(htmlMarcado, estudio, recursos = [], opciones = {}) {
  const vacios = new Set();
  const recursosFaltantes = new Set();

  /* Las tablas se regeneran ANTES de sustituir las marcas, y no después, por dos razones.
     Una: las marcas que la IA hubiera puesto dentro de la tabla vieja se van con ella, así
     que no se cuentan como campos vacíos por un texto que ya no existe. Otra: el número de
     filas depende del estudio, no de la plantilla, y sustituir marca por marca no puede
     añadirlas ni quitarlas — es lo que dejaba la tabla de márgenes con las comparables del
     informe del que salió la plantilla y unas pocas celdas del estudio nuevo. */
  const avisosTablas = [];
  let html = actualizarTablasMotorHtml(htmlMarcado, estudio, avisosTablas);
  /* Las Tablas 1 y 2 —las de la operación con el vinculado— por el mismo motivo que las
     del motor: sus celdas no corresponden a ningún campo del vocabulario, así que el
     marcado no las alcanza y se radicaban con el concepto, el vinculado, el país y el
     monto del cliente anterior. */
  html = actualizarTablasOperacionesHtml(html, estudio, avisosTablas);
  html = actualizarApartadosMacroHtml(
    html, opciones.datosMacro || null, Number(estudio && estudio.anio) || 2025, avisosTablas);
  html = actualizarApartadoSectorialHtml(
    html, opciones.analisisSector || null, estudio, Number(estudio && estudio.anio) || 2025, avisosTablas);
  html = actualizarTablasMacroHtml(
    html, opciones.datosMacro || null, Number(estudio && estudio.anio) || 2025, avisosTablas);
  /* El ANEXO B va aparte porque no es una tabla sino un bloque de tres por comparable, y su
     número depende de la muestra: hay que crear y retirar bloques enteros. */
  html = actualizarAnexoBHtml(html, estudio, avisosTablas);
  /* El ANEXO C, por lo mismo: una tabla por motivo que descartó a alguien, y su
     tabla-resumen no tiene rótulo del que agarrarse —va pegada al encabezado del anexo—, así
     que el localizador de tablas no la alcanzaba y se radicaba con los conteos del informe
     del que salió la plantilla, contradiciendo a la Tabla 16 del cuerpo. */
  html = actualizarAnexoCHtml(html, estudio, avisosTablas);
  /* La frase que comenta el rango intercuartil, por el mismo motivo que las tablas: sus cifras
     y su año no son campos que el marcado pueda alcanzar —el modelo no los reconoce, y aunque
     los marcara, una marca no sabe qué cuartil introduce cada paréntesis—, así que la frase se
     radicaba con las cifras del informe de referencia mientras la tabla de arriba ya traía las
     del estudio. La misma función atiende la ruta .docx, cambiando cómo se delimita el párrafo. */
  html = actualizarProsaRango(html, estudio, avisosTablas);
  /* Y por el mismo motivo, las otras frases que citan cifras de una tabla: cuántas comparables
     se identificaron y cuántas quedaron, el monto de la operación con el vinculado y el año de
     los estados financieros de las comparables. Ninguna de esas cifras es un campo que el
     marcado alcance de forma fiable, así que se radicaban con las del informe de referencia. */
  html = actualizarProsaTablas(html, estudio, avisosTablas);
  /* Y el nombre de la base de datos de la que salieron los comparables: la plantilla es el
     informe del año anterior y nombra OneSource de Thomson Reuters, pero el cribado sale de
     Capital IQ —la ruta de tablas ya elimina por eso las copias de «Códigos SIC utilizados» de
     Ryan LLC y Refinitiv—, así que la prosa atribuía los estados financieros a una base que no
     se consultó. Misma función que la ruta .docx. */
  html = actualizarProsaBaseDatos(html, avisosTablas);

  html = html.replace(RX_MARCA, (_, campo) => {
    const valor = valorDeCampo(estudio, campo);
    if (valor === null) {
      vacios.add(campo);
      return resaltar('—');
    }
    return resaltar(escaparHTML(valor));
  });

  /* Rastrea qué recursos están presentes en el HTML. */
  const recursosEnHTML = new Set();
  const rxRecurso = /data-recurso="([^"]+)"/g;
  let m;
  while ((m = rxRecurso.exec(html)) !== null) {
    recursosEnHTML.add(m[1]);
  }

  /* Resuelve los recursos contra el catálogo. */
  const recursoMap = new Map(recursos.map((r) => [r.id, r.dataUrl]));

  for (const id of recursosEnHTML) {
    if (recursoMap.has(id)) {
      const dataUrl = recursoMap.get(id);
      html = html.replace(
        new RegExp('<img data-recurso="' + escaparParaRegex(id) + '"([^>]*)>', 'g'),
        (_, resto) => {
          /* Se CONSERVAN los demás atributos de la marca en vez de reescribir la etiqueta
             entera. Desde la versión 7 del lector cada imagen lleva su tamaño en el `style`
             —el que le da el PDF—, y reescribir la etiqueta lo tiraba: la imagen volvía a su
             tamaño natural en píxeles y desbordaba la hoja. Ese fallo ya se arregló una vez en
             `conImagenes`, pero esta es la ruta que se usa de verdad —la de plantilla marcada—
             así que seguía perdiéndose por aquí.

             El `src` previo se quita antes de poner el nuevo para que aplicarlo dos veces sobre
             el mismo HTML no acumule dos. El callback evita además que los caracteres
             especiales del data URL se interpreten como referencias de sustitución. */
          const atributos = resto
            .replace(/\s*\/?$/, '')
            .replace(/\s+src="[^"]*"/g, '');
          return '<img data-recurso="' + id + '"' + atributos +
            ' src="' + dataUrl + '" />';
        }
      );
    } else {
      recursosFaltantes.add(id);
    }
  }

  if (recursosFaltantes.size > 0) {
    console.warn('[plantillaRenderer] Recursos faltantes: ' + [...recursosFaltantes].join(', '));
  }

  return {
    html, vacios: [...vacios], recursosFaltantes: [...recursosFaltantes],
    /* Qué tabla del motor no se encontró en la plantilla. Se devuelve para que la UI lo
       diga: una tabla que no se regenera se radica con los datos del informe del que
       salió la plantilla, y ese fallo tiene que dejar de ser mudo también aquí. */
    avisosTablas,
  };
}
