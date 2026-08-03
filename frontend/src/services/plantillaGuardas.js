/* Avisos previos a generar el informe. Ninguno bloquea: el spec decidió avisar
   y dejar continuar, porque quien redacta el informe sabe cosas que la
   herramienta no. Lo que no se admite es que el problema pase inadvertido. */

/* Compara dos NITs después de normalizar. Retorna true si son equivalentes,
   false si son claramente distintos. La comparación:
   1. Normaliza quitando puntos, espacios, guiones
   2. Si ambos tienen dígitos de igual longitud: compara exactamente
   3. Si difieren por 1 dígito y el más corto es prefijo del más largo: son equivalentes
   4. Cualquier otra diferencia: son distintos
   5. Si alguno no tiene dígitos pero no estaba vacío: compara originales sin espacios */
function sonNITsIguales(nit1, nit2) {
  if (!nit1 || !nit2) return nit1 === nit2;

  // Normalizar: quitar puntos, espacios, guiones
  const limpio1 = String(nit1).replace(/[-\s.]/g, '');
  const limpio2 = String(nit2).replace(/[-\s.]/g, '');

  // Extraer dígitos
  const digitos1 = limpio1.replace(/\D/g, '');
  const digitos2 = limpio2.replace(/\D/g, '');

  // Si ambos tienen dígitos
  if (digitos1 && digitos2) {
    const len1 = digitos1.length;
    const len2 = digitos2.length;

    // Misma longitud: comparar exactamente
    if (len1 === len2) {
      return digitos1 === digitos2;
    }

    // Difieren por exactamente 1 dígito: verificar si el más corto es prefijo del más largo
    if (Math.abs(len1 - len2) === 1) {
      const corto = len1 < len2 ? digitos1 : digitos2;
      const largo = len1 < len2 ? digitos2 : digitos1;
      return largo.startsWith(corto);
    }

    // Cualquier otra diferencia de longitud
    return false;
  }

  // Si alguno no tiene dígitos pero no estaba vacío: caer a comparación de originales sin espacios
  if ((digitos1 === '' && limpio1 !== '') || (digitos2 === '' && limpio2 !== '')) {
    return limpio1 === limpio2;
  }

  // Si ambos están vacíos
  return digitos1 === digitos2;
}

export function revisarAntesDeGenerar({
  estudio,
  nitDeReferencia,
  vacios,
  tieneAnexo = true,
  recursosFaltantes,
} = {}) {
  const avisos = [];
  const nitEstudio = (estudio && estudio.nit) || '';

  if (nitDeReferencia && nitEstudio) {
    if (!sonNITsIguales(nitDeReferencia, nitEstudio)) {
      avisos.push({
        nivel: 'aviso',
        texto:
          'El informe de referencia es del NIT ' + nitDeReferencia +
          ' y el estudio activo es del NIT ' + nitEstudio +
          '. Revisa que la plantilla corresponda a este contribuyente.',
      });
    }
  }

  if (!tieneAnexo) {
    avisos.push({
      nivel: 'aviso',
      texto:
        'No se ha subido el anexo de estados financieros del año en curso: ' +
        'esas páginas saldrán marcadas y en blanco.',
    });
  }

  if (vacios && vacios.length) {
    avisos.push({
      nivel: 'aviso',
      texto:
        'Hay ' + vacios.length + ' campo(s) marcados sin dato en el estudio, que saldrán ' +
        'como "—": ' + vacios.join(', ') + '.',
    });
  }

  if (recursosFaltantes && recursosFaltantes.length) {
    avisos.push({
      nivel: 'aviso',
      texto:
        'Hay ' + recursosFaltantes.length + ' imagen(s) faltante(s) en el catálogo: ' +
        recursosFaltantes.join(', ') + '. El informe saldrá con esos espacios en blanco.',
    });
  }

  return avisos;
}
