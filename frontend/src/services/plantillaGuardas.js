/* Avisos previos a generar el informe. Ninguno bloquea: el spec decidió avisar
   y dejar continuar, porque quien redacta el informe sabe cosas que la
   herramienta no. Lo que no se admite es que el problema pase inadvertido. */

/* Extrae la base (dígitos sin guión) y el dígito de verificación de un NIT normalizado.
   Retorna { base: string de dígitos, dv: string de 1 dígito, dvConocido: boolean } */
function extraerBaseYDV(nit) {
  // Patrón: base de dígitos seguida de guión y un único dígito
  const match = nit.match(/^(\d+)-(\d)$/);

  if (match) {
    // Tiene formato explícito base-DV
    const base = match[1];
    const dv = match[2];
    return { base, dv, dvConocido: true };
  }

  // No tiene formato explícito: toda la cadena de dígitos es la base
  const soloDigitos = nit.replace(/\D/g, '');
  return { base: soloDigitos, dv: '', dvConocido: false };
}

/* Compara dos NITs usando lógica de base y dígito de verificación.
   Normaliza quitando puntos y espacios (pero mantiene guión).
   Para cada lado determina si tiene formato base-DV o solo base.
   Luego compara bases; si ambos tienen DV conocido, también compara dígito de verificación. */
function sonNITsIguales(nit1, nit2) {
  if (!nit1 || !nit2) return nit1 === nit2;

  // Normalizar: quitar puntos y espacios, mantener guión
  const limpio1 = String(nit1).replace(/[\s.]/g, '');
  const limpio2 = String(nit2).replace(/[\s.]/g, '');

  // Extraer información de cada lado
  const info1 = extraerBaseYDV(limpio1);
  const info2 = extraerBaseYDV(limpio2);

  // Si alguno no tiene dígitos pero el original no estaba vacío: caer a comparación de originales
  if ((info1.base === '' && limpio1 !== '') || (info2.base === '' && limpio2 !== '')) {
    return limpio1 === limpio2;
  }

  // Las bases tienen que coincidir exactamente
  if (info1.base !== info2.base) {
    return false;
  }

  // Si ambos tienen dígito de verificación conocido, tiene que coincidir
  if (info1.dvConocido && info2.dvConocido) {
    return info1.dv === info2.dv;
  }

  // Si uno o ambos tienen DV desconocido, se ignora
  return true;
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
