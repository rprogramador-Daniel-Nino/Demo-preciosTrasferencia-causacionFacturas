/* ─────────────────────────────────────────────────────────────────────────────
   El año del período fiscal en el informe, en la ruta de plantilla .docx.

   ── El defecto, medido ──

   La portada del informe de MONTACHEM 2025 salía diciendo «PERÍODO FISCAL AL 31 DE
   DCIEMBRE DE 2024» con el estudio del año gravable 2025. Y no era por estar dentro de un
   cuadro de texto —el marcado de campos sí entra ahí; el nombre de la compañía se
   sustituyó bien— sino por dos cosas que se suman:

     1. Nada actualiza ese año. La única sustitución automática que existía,
        `actualizarAnioConclusionRango`, está anclada a «ajustado durante el AÑO».
     2. Word parte el texto en runs arbitrarios, y buscar dentro de cada `<w:t>` por
        separado no encuentra un año troceado. Medido sobre las dos plantillas del
        repositorio, en la misma frase de portada:

          END GAME          «PERÍODO FISCAL AL 31 DE D» + «I» + «CIEMBRE DE » + «2024»
          MC INTERNACIONAL  «PERÍODO FISCAL AL 31 DE DICIEMBRE DE 20» + «2» + «4»

        En la segunda, «2024» no existe entero en ningún `<w:t>`: una regex por run no lo
        ve. Y en la primera, ni siquiera «DICIEMBRE» está entero.

   Por eso este módulo trabaja sobre el texto UNIDO de cada párrafo y escribe de vuelta con
   `sustituirRangosEnParrafo`, que cambia solo los caracteres del año y deja intacto todo lo
   demás: el resto del texto, el formato de cada run y los `<w:br/>` de en medio.

   ── Alcance, fijado por el usuario el 2026-08-21 ──

   Se actualiza el año de la PORTADA y el de la prosa del período fiscal. NO se toca:

     · los encabezados de años del ANEXO B — son los estados financieros disponibles de las
       comparables, que son del año anterior a propósito;
     · las fuentes citadas, que llevan su propia fecha;
     · las columnas comparativas «2024 / 2023» de las tablas.

   De ahí que las frases se reconozcan por su contexto y no por el año suelto: cambiar todo
   «20\d\d» del documento rompería justamente esas tres cosas.
   ───────────────────────────────────────────────────────────────────────────── */

import { textoPorParrafo, sustituirRangosEnParrafo } from './docxPlantilla.js';

/* Las frases cuyo año ES el del estudio. Cada una tiene que capturar el año en su primer
   grupo, y se aplican sobre el texto unido del párrafo.

   El acento de «período» y la mayúscula son opcionales porque las plantillas varían, y
   «DCIEMBRE» —sin la i— entra a propósito: es el error de mecanografía que trae la
   plantilla de MONTACHEM, y no reconocerlo dejaría su portada sin actualizar por una letra.
   Lo mismo con «DIC.» abreviado. */
const FRASES = [
  /* «PERÍODO FISCAL AL 31 DE DICIEMBRE DE 2024» y sus variantes, que es la portada. */
  {
    nombre: 'portada',
    /* El año puede venir pegado a «fiscal», tras un «de», o tras la fecha de cierre
       completa: las tres formas aparecen en las plantillas del equipo. */
    rx: /(?:per[ií]odo|periodo)\s+fiscal\s+(?:al\s+\d{1,2}\s+de\s+[a-záéíóúñ.]+\s+)?(?:de\s+)?(20\d{2})/gi,
  },
  /* «al 31 de diciembre de 2024» a secas, para las portadas que no repiten «período
     fiscal» en la misma línea. */
  {
    nombre: 'fecha de cierre',
    rx: /al\s+\d{1,2}\s+de\s+(?:diciembre|dciembre|dic\.?)\s+de\s+(20\d{2})/gi,
  },
  /* La prosa: «…realizadas durante el periodo fiscal 2024, por la Compañía…» y
     «…durante el periodo fiscal 2024, cumplieron con el principio Arm's Length». */
  {
    nombre: 'prosa del período',
    rx: /durante\s+el\s+(?:per[ií]odo|periodo)\s+(?:fiscal|gravable)\s+(20\d{2})/gi,
  },
  /* La que ya cubría `actualizarAnioConclusionRango`, aquí para que también funcione
     cuando el año viaja troceado entre runs. */
  {
    nombre: 'conclusión del rango',
    rx: /(?:ajustado|analizado|operacional)\s+durante\s+el\s+(20\d{2})/gi,
  },
];

/* Un párrafo que NO se toca aunque contenga una de las frases: los encabezados y las filas
   de los anexos, donde el año es el de los estados financieros de las comparables.

   Se reconoce por el propio texto del párrafo y no por su posición, que es lo que hace que
   valga para cualquier plantilla: la de un cliente pone el ANEXO B en la página 40 y la de
   otro en la 55. */
const RX_ZONA_INTOCABLE = /anexo\s+[ab]\b|estados?\s+financieros?\s+de\s+las?\s+comparables/i;

/**
 * Pone el año gravable del estudio en las frases del período fiscal.
 *
 * @param {string} documentXml `word/document.xml`.
 * @param {number|string} anioGravable el año del estudio.
 * @param {string[]} [avisos] donde se anota si no se encontró ninguna frase.
 * @returns {{xml: string, cambiados: number, frases: string[]}} el XML, cuántos años se
 *   cambiaron y qué frases los traían, que es lo que permite al generador decir si la
 *   pasada hizo algo.
 */
export function actualizarAnioPeriodo(documentXml, anioGravable, avisos) {
  const xml = String(documentXml || '');
  const gravable = Number(anioGravable);

  if (!Number.isInteger(gravable) || gravable < 2000 || gravable > 2100) {
    if (Array.isArray(avisos)) {
      avisos.push('no se pudo leer el año gravable ("' + String(anioGravable) + '"), así que '
        + 'el año del período fiscal se queda como lo trajo la plantilla');
    }
    return { xml, cambiados: 0, frases: [] };
  }
  if (!xml) return { xml, cambiados: 0, frases: [] };

  const parrafos = textoPorParrafo(xml);
  const nuevo = String(gravable);
  const frases = new Set();
  let cambiados = 0;

  /* De atrás hacia delante: sustituir en un párrafo mueve los offsets de los siguientes. */
  let salida = xml;
  [...parrafos].sort((a, b) => b.inicio - a.inicio).forEach((p) => {
    if (RX_ZONA_INTOCABLE.test(p.texto)) return;

    const rangos = [];
    FRASES.forEach(({ nombre, rx }) => {
      rx.lastIndex = 0;
      let m;
      while ((m = rx.exec(p.texto)) !== null) {
        const anio = m[1];
        if (Number(anio) === gravable) continue;
        /* La posición del AÑO dentro de la frase, no la de la frase: solo se cambian esos
           cuatro caracteres. */
        const pos = m.index + m[0].lastIndexOf(anio);
        /* Dos frases pueden solapar sobre el mismo año —«período fiscal al 31 de diciembre
           de 2024» encaja en las dos primeras—; se cuenta y se cambia una sola vez. */
        if (rangos.some((r) => r.pos === pos)) continue;
        rangos.push({ pos, largo: anio.length, texto: nuevo });
        frases.add(nombre);
        cambiados += 1;
      }
    });

    if (!rangos.length) return;
    const bloque = salida.slice(p.inicio, p.fin);
    salida = salida.slice(0, p.inicio)
      + sustituirRangosEnParrafo(bloque, rangos)
      + salida.slice(p.fin);
  });

  if (!cambiados && Array.isArray(avisos)) {
    avisos.push('no se encontró el año del período fiscal en la plantilla («PERÍODO FISCAL AL '
      + '31 DE DICIEMBRE DE AÑO» o «durante el periodo fiscal AÑO»): si tu plantilla lo '
      + 'redacta de otro modo, revisa la portada a mano antes de radicar');
  }

  return { xml: salida, cambiados, frases: [...frases] };
}
