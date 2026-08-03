/* Avisos previos a generar el informe. Ninguno bloquea: el spec decidió avisar
   y dejar continuar, porque quien redacta el informe sabe cosas que la
   herramienta no. Lo que no se admite es que el problema pase inadvertido. */

import { valorDeCampo } from './plantillaVocabulario.js';

/* Campos testigo para la revisión de la salida. Son los que identifican a un
   contribuyente y a su vinculada, es decir los que delatan de inmediato que el
   informe salió con datos de otro cliente.

   No se usan todos los campos del vocabulario a propósito: `anio` vale "2024" y
   aparece legítimamente en columnas comparativas y en tablas macroeconómicas,
   así que revisarlo produciría decenas de avisos falsos y enseñaría a ignorar
   el banner. Por lo mismo quedan fuera `ciiu`, los topes UVT y el rango: son
   cortos o se repiten por diseño.

   Los de esta lista son largos, específicos y no se repiten en tablas
   comparativas: si sobreviven, sobran. `direccion` está aquí porque el domicilio
   del contribuyente anterior viajaba al informe nuevo —es la razón por la que se
   agregó al vocabulario—, y dejarlo fuera de esta revisión dejaba el arreglo a
   medias. */
const CAMPOS_TESTIGO = [
  'nit', 'ent', 'vinc', 'vinc_id', 'vinc_tipo',
  'direccion', 'representante', 'objeto', 'accionista.nombre',
];

/* Solo el texto visible: los `data:image/png;base64,...` de las imágenes son
   megabytes de dígitos donde cualquier NIT aparece por casualidad, y los
   atributos no se leen en el documento. */
const soloTexto = (html) => String(html || '').replace(/<[^>]*>/g, ' ');

const normalizar = (v) => String(v == null ? '' : v).replace(/[\s.]/g, '').toUpperCase();

/* Extrae de la plantilla marcada los valores que traía el informe de
   referencia. El marcado envuelve el texto original sin alterarlo, así que el
   contenido de una marca `data-campo="nit"` es literalmente el NIT del cliente
   anterior. Devuelve `[{ campo, valor }]` sin repetir. */
export function valoresDeReferencia(htmlMarcado, campos = CAMPOS_TESTIGO) {
  const permitidos = new Set(campos);
  const vistos = new Set();
  const salida = [];
  const rx = /<span data-campo="([^"]+)">([\s\S]*?)<\/span>/g;
  let m;
  while ((m = rx.exec(String(htmlMarcado || ''))) !== null) {
    const campo = m[1];
    const valor = m[2].trim();
    if (!permitidos.has(campo) || !valor) continue;
    const clave = campo + '|' + valor;
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    salida.push({ campo, valor });
  }
  return salida;
}

/* Única verificación automática del objetivo de toda la rama: mira la SALIDA.
   Las guardas de campos vacíos, imágenes y NIT opinan sobre las entradas, así
   que un dato del cliente anterior que sobrevive sin marcar les es invisible.

   Solo avisa cuando el estudio activo trae un valor distinto para ese campo: si
   coincide (el mismo contribuyente el año siguiente, o el mismo país de la
   vinculada) no hay fuga, y si el estudio no lo trae la marca ya salió como
   hueco y no hay con qué comparar. */
export function revisarSalidaRenderizada({ estudio, htmlRenderizado, valores } = {}) {
  const avisos = [];
  const texto = soloTexto(htmlRenderizado);
  if (!texto.trim()) return avisos;

  for (const { campo, valor } of valores || []) {
    const nuevo = valorDeCampo(estudio, campo);
    if (nuevo === null || normalizar(nuevo) === normalizar(valor)) continue;

    let cuenta = 0;
    let desde = 0;
    for (;;) {
      const pos = texto.indexOf(valor, desde);
      if (pos === -1) break;
      cuenta++;
      desde = pos + valor.length;
    }
    if (!cuenta) continue;

    avisos.push({
      nivel: 'aviso',
      campo,
      cuenta,
      texto:
        'El dato del informe de referencia "' + valor + '" (' + campo + ') sobrevive ' +
        cuenta + ' vez(ces) en el documento generado, sin marcar. Debía ser "' + nuevo +
        '": esas apariciones se van a radicar con el dato del contribuyente anterior.',
    });
  }
  return avisos;
}

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
  htmlRenderizado,
  valores,
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

  /* Va al final porque es la más grave: si algo sobrevive aquí, el documento
     que se va a radicar lleva datos de otro contribuyente. */
  if (htmlRenderizado) {
    /* Una plantilla marcada de la que no sale ni un valor de referencia no es
       una plantilla limpia: es una plantilla sin marcas útiles. Pasaba cuando
       todas las llamadas del marcado fallaban y se confirmaba igual, y era el
       peor caso posible —la revisión de la salida se queda sin nada que
       comparar, así que callaba justo cuando el informe entero salía con los
       datos del cliente anterior—. Avisar de la ceguera es lo que impide que se
       confunda con un visto bueno. */
    if (!valores || !valores.length) {
      avisos.push({
        nivel: 'aviso',
        texto:
          'La plantilla no tiene ninguna marca de los campos que identifican al contribuyente, ' +
          'así que no se puede comprobar si el documento salió con datos del cliente anterior. ' +
          'Vuelve a marcar la plantilla o revisa el informe entero a mano antes de radicar.',
      });
    }
    avisos.push(...revisarSalidaRenderizada({ estudio, htmlRenderizado, valores }));
  }

  return avisos;
}
