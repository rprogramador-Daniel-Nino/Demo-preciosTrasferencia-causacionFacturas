/* ─────────────────────────────────────────────────────────────────────────────
   semaforoRadicacion.js — un solo veredicto de "¿está listo para radicar?".

   Junta lo que ya calculan `diagnosticarCobertura` (tablasInforme.js) y
   `revisarSalidaRenderizada`/`valoresDeReferencia` (plantillaGuardas.js), hoy
   dispersos en avisos de texto sueltos (ReporteGenerador.jsx). La distinción que
   importa es DE QUÉ CLASE es cada hueco:

     - BLOQUEANTE: el documento tiene un dato de OTRO contribuyente con aspecto de
       estar completo (una fuga de referencia, o una tabla de comparables con la
       muestra de la plantilla). Eso no se radica.
     - ADVERTENCIA: el documento tiene un marcador visible de "falta esto" (series
       macro sin dato, sector sin generar). Se ve, se completa, no engaña a nadie
       mientras tanto.
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * @param {object} args
 * @param {object} args.diagnostico        salida de `diagnosticarCobertura`.
 * @param {Array<{campo:string, cuenta:number, texto:string}>} [args.fugasReferencia]
 *        salida de `revisarSalidaRenderizada` — el `texto` ya trae redactado el valor
 *        de referencia, cuántas veces sobrevive y cuál debía ser.
 * @param {string[]} [args.avisosTablas]   tablas que no se encontraron en la plantilla.
 * @param {string[]} [args.camposVacios]   campos marcados sin dato del estudio.
 * @returns {{listo:boolean, bloqueantes:string[], advertencias:string[]}}
 */
export function evaluarRadicacion({ diagnostico, fugasReferencia, avisosTablas, camposVacios } = {}) {
  const d = diagnostico || {};
  const bloqueantes = [];
  const advertencias = [];

  (fugasReferencia || []).forEach((f) => {
    bloqueantes.push(f.texto);
  });

  if (!d.comparablesCubiertas) {
    bloqueantes.push('Las tablas de comparables conservan la muestra del informe de referencia.');
  }
  if (!d.razonesRechazoCubiertas) {
    bloqueantes.push('La tabla de razones de rechazo conserva las cifras del informe de referencia.');
  }

  if (d.seriesFaltantes && d.seriesFaltantes.length) {
    advertencias.push('Faltan datos de ' + d.seriesFaltantes.join(', ') + ' en las tablas macro.');
  }
  if (!d.sectorialCubierto) {
    advertencias.push('La plantilla no trae la sección del análisis del sector.');
  } else if (!d.sectorNarrativaCubierta) {
    advertencias.push('El análisis del sector (III.C) todavía no está generado para esta actividad y año.');
  }
  if (!d.narrativaCubierta) {
    advertencias.push('La narrativa de III.A/III.B todavía no está disponible.');
  }
  if (d.razonesRechazoDescuadradas) {
    advertencias.push('Los conteos de la tabla de razones de rechazo no cuadran con el universo evaluado.');
  }
  if (d.comparablesSinCifras) {
    advertencias.push(d.comparablesSinCifras + ' comparable(s) sin estados financieros cargados.');
  }
  /* ── SIN ACTIVIDAD, EL ANEXO B LO DICE EN VOZ ALTA ──
     Faltando la descripción, el anexo imprime «Descripción de actividad no disponible.» junto a
     la comparable. No es una fuga de la plantilla —nada de otro contribuyente se cuela— así que
     no bloquea; pero es un hueco visible en el sustento de comparabilidad (Art. 260-4 E.T.), y
     radicarlo sin saberlo era posible hasta el 2026-09-05.

     Se nombran las compañías: es lo que permite ir a la fila y escribirla. Con muchas se citan
     las primeras y se dice cuántas quedan, para no convertir el aviso en un listado ilegible. */
  const sinActividad = d.comparablesSinActividad || [];
  if (sinActividad.length) {
    const primeras = sinActividad.slice(0, 5).join(', ');
    const resto = sinActividad.length > 5 ? ` y ${sinActividad.length - 5} más` : '';
    advertencias.push(
      `${sinActividad.length} comparable(s) saldrían en el ANEXO B con «Descripción de actividad `
      + `no disponible»: ${primeras}${resto}. Escriba su actividad en el paso 4.`
    );
  }
  (avisosTablas || []).forEach((t) => advertencias.push('No se encontró en la plantilla: ' + t + '.'));
  (camposVacios || []).forEach((c) => advertencias.push('Campo sin dato: ' + c + '.'));

  return { listo: bloqueantes.length === 0, bloqueantes, advertencias };
}
