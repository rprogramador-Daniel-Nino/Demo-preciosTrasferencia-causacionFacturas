/* Coteja la identificación del vinculado del año en curso contra la del informe anterior.
   ─────────────────────────────────────────────────────────────────────────────────────
   Sale de un caso real: en los archivos de END GAME, la misma razón social
   «END GAME INTERACTIVE INC» aparece con identificación 604477955 en el informe 2024,
   444444001 en la sección de ingreso del Excel de operaciones 2025 y 444444031 en la de
   egreso. `excelOperationsParser` ya detecta las dos del archivo; ésta cubre la tercera,
   la del año anterior, que no era visible porque `study.estudioAnterior` no guardaba la
   identificación del vinculado.

   Un revisor que compare el informe año contra año ve cambiar el Tax ID de la contraparte
   sin explicación. Puede ser legítimo —una reorganización, una fusión— pero tiene que
   quedar dicho, no descubrirse después de radicar.

   Vive aparte de `priorStudyParser.js` a propósito: ese módulo importa axios y mammoth
   para hablar con Gemini, y esto es una comparación de cadenas que debe poder probarse
   sin red ni navegador. */

/** Deja solo dígitos y letras: los NIT y Tax ID viajan con puntos, guiones y espacios
 *  según quién los escriba, y «444.444.001» y «444444001» son el mismo número. */
export function normalizarIdentificacion(valor) {
  return String(valor == null ? '' : valor).replace(/[^0-9a-zA-Z]/g, '').toUpperCase();
}

/** Razón social comparable: mayúsculas, sin acentos y con los espacios colapsados. */
export function normalizarRazonSocial(valor) {
  return String(valor == null ? '' : valor)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/**
 * Devuelve el texto de la advertencia, o cadena vacía si no hay nada que advertir.
 *
 * No advierte cuando falta alguno de los dos datos: un estudio sin informe anterior
 * cargado, o un informe anterior del que el modelo no pudo leer la identificación, no
 * son discrepancias — son ausencias, y avisar de ellas como si fueran un hallazgo
 * entrena al usuario a ignorar el banner.
 */
export function avisoIdentificacionVinculado(estudio) {
  const study = estudio || {};
  const previo = (study.estudioAnterior && study.estudioAnterior.vinculado) || null;
  if (!previo) return '';

  const idActual = normalizarIdentificacion(study.vinc_id);
  const idPrevia = normalizarIdentificacion(previo.identificacion);
  if (!idActual || !idPrevia || idActual === idPrevia) return '';

  const nombreActual = normalizarRazonSocial(study.vinc);
  const nombrePrevio = normalizarRazonSocial(previo.razon_social);
  const anioPrevio = study.estudioAnterior.anio || 'el año anterior';

  /* Si además cambió la razón social, es más probable que sea otra contraparte que un
     error de captura, y el aviso lo dice distinto: no es lo mismo revisar un dígito que
     revisar si se está comparando con la empresa equivocada. */
  const mismaEmpresa = nombreActual && nombrePrevio && nombreActual === nombrePrevio;

  return mismaEmpresa
    ? `⚠ «${study.vinc}» figura con identificación ${study.vinc_id} en este estudio y ` +
      `${previo.identificacion} en el informe de ${anioPrevio}: verifique cuál es la correcta ` +
      'antes de radicar'
    : `⚠ el vinculado de este estudio (${study.vinc || 'sin razón social'}, ` +
      `${study.vinc_id}) no coincide con el del informe de ${anioPrevio} ` +
      `(${previo.razon_social || 'sin razón social'}, ${previo.identificacion}): confirme que ` +
      'la operación analizada es con la misma contraparte';
}
