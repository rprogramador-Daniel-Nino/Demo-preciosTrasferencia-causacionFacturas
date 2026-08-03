/* Avisos previos a generar el informe. Ninguno bloquea: el spec decidió avisar
   y dejar continuar, porque quien redacta el informe sabe cosas que la
   herramienta no. Lo que no se admite es que el problema pase inadvertido. */

/* Normaliza un NIT para comparación: extrae solo los 9 dígitos base,
   ignorando puntos, espacios, guiones y dígito de verificación. */
function normalizarNIT(nit) {
  if (!nit) return '';
  // Remover puntos, espacios, guiones
  const limpio = String(nit).replace(/[-\s.]/g, '');
  // Extraer solo los primeros 9 dígitos (ignorar dígito de verificación)
  const digitos = limpio.replace(/\D/g, '');
  return digitos.substring(0, 9);
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
    const nitRefNormalizado = normalizarNIT(nitDeReferencia);
    const nitEstudioNormalizado = normalizarNIT(nitEstudio);

    if (nitRefNormalizado && nitEstudioNormalizado && nitRefNormalizado !== nitEstudioNormalizado) {
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
