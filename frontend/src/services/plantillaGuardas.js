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

const escaparRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* Un tramo de texto sustituible, por ruta. En el OOXML de Word es el contenido de un `<w:t>`; en
   el HTML renderizado, lo que hay entre el cierre de una etiqueta y la apertura de la siguiente.
   Los tres grupos son: lo que abre, el texto, lo que cierra.

   Delimitarlo así es lo que mantiene la sustitución fuera de los atributos, y eso no es un
   detalle: los `data:image/png;base64,…` de las imágenes son megabytes de texto donde cualquier
   cosa aparece por casualidad. */
export const TRAMO_OOXML = /(<w:t[^>]*>)([^<]*)(<\/w:t>)/g;
export const TRAMO_HTML = /(>)([^<]*)(<)/g;

/* ── El mismo nombre escrito de otra forma ──────────────────────────────────────────────────
   La razón social del contribuyente anterior no aparece de una sola manera en el informe:
   medido sobre el informe de referencia, «END GAME INTERACTIVE COLOMBIA SAS» sale 27 veces y
   «END GAME INTERACTIVE COLOMBIA S.A.S» —la misma, con los puntos de la forma jurídica— otras
   17. El marcado captura una de las dos, así que buscar el valor literal dejaba las otras 17
   sin detectar ni corregir, y se radicaban con el dato del contribuyente anterior.

   Se comparan ignorando puntos y espacios, que es la misma regla que ya usa `normalizar` para
   decidir si un valor cambió. Se hace con un índice y no con una expresión regular flexible
   —«S[.\s]*A[.\s]*S»— por dos razones: el índice es exacto y recorre el texto una sola vez,
   mientras que un patrón con treinta cuantificadores codiciosos sobre las 300 000 letras del
   informe invita al backtracking. */

/* El texto sin puntos ni espacios y en mayúsculas, con la posición original de cada carácter
   que sobrevive. Es lo que permite encontrar una coincidencia sobre el texto normalizado y
   devolver el tramo exacto del original al que corresponde. */
function indexarSinPuntuacion(texto) {
  const s = String(texto == null ? '' : texto);
  let plano = '';
  const posiciones = [];
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (c === '.' || /\s/.test(c)) continue;
    plano += c.toUpperCase();
    posiciones.push(i);
  }
  return { plano, posiciones };
}

/* Los tramos `[inicio, fin)` de `texto` donde aparece `valor`, tolerando que la puntuación, los
   espacios y las mayúsculas no coincidan. Vacío si `valor` no tiene sustancia.

   El mínimo de ocho caracteres no es un número al azar: sin él, un valor corto como «SAS»
   casaría dentro de cualquier palabra que lleve esas letras seguidas. Los campos testigo son
   razones sociales, NIT y direcciones —largos por naturaleza—, así que el mínimo no excluye
   ninguno de los que importan. */
export function aparicionesTolerantes(texto, valor) {
  const aguja = indexarSinPuntuacion(valor).plano;
  if (aguja.length < 8) return [];
  const { plano, posiciones } = indexarSinPuntuacion(texto);
  const rangos = [];
  let desde = 0;
  for (;;) {
    const k = plano.indexOf(aguja, desde);
    if (k === -1) break;
    rangos.push([posiciones[k], posiciones[k + aguja.length - 1] + 1]);
    desde = k + aguja.length;
  }
  return rangos;
}

/* Los tramos donde aparece `valor`: tolerando puntuación si el valor da para ello, y literales
   si es corto. El respaldo literal no es un detalle: «END GAME» son siete caracteres sin
   espacios y se queda por debajo del mínimo, así que sin él las apariciones del nombre corto
   dejarían de detectarse, que es justo lo contrario de lo que se busca. */
export function aparicionesDe(texto, valor) {
  const flexibles = aparicionesTolerantes(texto, valor);
  if (flexibles.length) return flexibles;
  if (indexarSinPuntuacion(valor).plano.length >= 8) return [];

  const s = String(texto == null ? '' : texto);
  const aguja = String(valor == null ? '' : valor);
  if (!aguja) return [];
  const rangos = [];
  let desde = 0;
  for (;;) {
    const pos = s.indexOf(aguja, desde);
    if (pos === -1) break;
    rangos.push([pos, pos + aguja.length]);
    desde = pos + aguja.length;
  }
  return rangos;
}

/* ¿Contiene `contenedor` a `parte`, ignorando puntuación? Para las guardas, que comparan valores
   entre sí y no contra el documento. */
const contieneTolerante = (contenedor, parte) => {
  const a = indexarSinPuntuacion(contenedor).plano;
  const b = indexarSinPuntuacion(parte).plano;
  return !!b && a.includes(b);
};

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

  /* Los tramos que ocupan los valores NUEVOS, que es lo que ya está bien. Sin esto el aviso
     cuenta como fuga las apariciones del valor viejo que viven DENTRO del nuevo, y eso lo
     dispara cualquier razón social que sea una ampliación de la anterior: con «END GAME
     INTERACTIVE» → «END GAME INTERACTIVE INC» y «END GAME» → «END GAME INTERACTIVE COLOMBIA
     SOCIEDAD POR ACCIONES SIMPLIFICADA», un documento SIN una sola fuga real avisaba de 73
     apariciones de cada uno. Un aviso que grita cuando todo está bien enseña a ignorar el
     banner, que es justo lo que este banner no puede permitirse.

     Se juntan los nuevos de TODOS los campos y no solo el del que se revisa: «END GAME», que
     es el valor viejo de `ent`, también vive dentro de «END GAME INTERACTIVE INC», que es el
     nuevo de `vinc`. */
  const cubiertos = [];
  for (const { campo } of valores || []) {
    const nuevo = valorDeCampo(estudio, campo);
    if (nuevo === null || nuevo === undefined || !String(nuevo).trim()) continue;
    cubiertos.push(...aparicionesDe(texto, String(nuevo)));
  }
  const estaCubierta = (inicio, fin) =>
    cubiertos.some(([a, b]) => inicio >= a && fin <= b);

  /* De más largo a más corto, y cada fuga encontrada tapa su propio tramo. Así una sola
     aparición se atribuye al valor MÁS ESPECÍFICO que la explica y no se cuenta tres veces:
     «END GAME INTERACTIVE COLOMBIA SAS» contiene «END GAME INTERACTIVE» y «END GAME», así que
     una única fuga de la razón social vieja producía tres avisos que parecían tres problemas
     distintos. */
  const aRevisar = (valores || [])
    .slice()
    .sort((a, b) => String(b.valor || '').length - String(a.valor || '').length);

  for (const { campo, valor } of aRevisar) {
    const nuevo = valorDeCampo(estudio, campo);
    if (nuevo === null || normalizar(nuevo) === normalizar(valor)) continue;

    let cuenta = 0;
    for (const [ini, fin] of aparicionesDe(texto, valor)) {
      /* Dentro de un valor nuevo no es una fuga: es la sustitución que sí funcionó. Dentro de
         una fuga más específica ya reportada, tampoco: es la misma. */
      if (estaCubierta(ini, fin)) continue;
      cuenta++;
      cubiertos.push([ini, fin]);
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

/**
 * Sustituye en el OOXML los datos del informe de referencia que sobrevivieron al marcado.
 *
 * `revisarSalidaRenderizada` ya los detecta y avisa, pero avisar deja el trabajo al ojo de
 * quien radica: en un informe real sobreviven decenas de apariciones. Aquí se corrigen las
 * que se pueden corregir sin riesgo, y se informa de las que no.
 *
 * DOS GUARDAS, y sin ellas esto destroza el documento:
 *
 *  1. Un valor que es parte de otro valor de la lista NO se toca. «END GAME» (el
 *     contribuyente) está dentro de «END GAME INTERACTIVE» (la vinculada): sustituirlo
 *     reescribiría también las menciones de la otra empresa. Es la misma cautela que ya
 *     aplica el marcado cuando el texto «no identifica el dato por sí solo».
 *
 *  2. Cuando el valor viejo es el principio del nuevo —«END GAME INTERACTIVE» →
 *     «END GAME INTERACTIVE INC»—, solo se sustituyen las apariciones que NO vengan ya
 *     seguidas del resto. Sin esto, las que ya estaban correctas se convertirían en
 *     «END GAME INTERACTIVE INC INC» a cada generación.
 *
 * Solo se toca texto contenido íntegro en un tramo: si Word partió el valor entre varios runs se
 * deja como está y se cuenta en `omitidos`, antes que romper el marcado del párrafo.
 *
 * LO YA SUSTITUIDO SE PROTEGE. Cada sustitución se escribe primero como un token y los tokens se
 * resuelven al final. Sin eso, un par posterior reescribe lo que otro acaba de poner: al cambiar
 * «END GAME INTERACTIVE COLOMBIA SAS» por «END GAME INTERACTIVE COLOMBIA SOCIEDAD POR ACCIONES
 * SIMPLIFICADA», el resultado contiene «END GAME INTERACTIVE», que es el valor viejo de la
 * vinculada, y el par de esa vinculada lo convertía en «END GAME INTERACTIVE INC COLOMBIA
 * SOCIEDAD POR ACCIONES SIMPLIFICADA». También se protege lo que la guarda 2 decide CONSERVAR,
 * por el mismo motivo.
 *
 * @param {string} texto  el OOXML de `word/document.xml`, o el HTML ya renderizado.
 * @param {{estudio:object, valores:Array, rxTramo?:RegExp}} opciones  `rxTramo` delimita un tramo
 *        de texto sustituible; por defecto el `<w:t>` de Word. Para HTML se pasa `TRAMO_HTML`.
 * @returns {{xml:string, sustituidos:Array, omitidos:Array}}
 */
export function sustituirDatosDeReferencia(xml, { estudio, valores, rxTramo } = {}) {
  let salida = String(xml || '');
  const sustituidos = [];
  const omitidos = [];
  const tramo = rxTramo || TRAMO_OOXML;
  if (!salida || !Array.isArray(valores) || !valores.length) return { xml: salida, sustituidos, omitidos };

  /* Marcador para lo ya resuelto. Se comprueba que no exista en el documento antes de usarlo:
     si existiera, resolverlo al final corrompería texto del informe. */
  let marca = '@@PT-REF@@';
  while (salida.includes(marca)) marca += '@';
  const puestos = [];
  const tokenizar = (valorFinal) => {
    puestos.push(valorFinal);
    return marca + (puestos.length - 1) + marca;
  };

  /* Pares realmente distintos: si el estudio no trae el campo, o trae el mismo valor, no hay
     nada que corregir (mismo contribuyente al año siguiente, por ejemplo). */
  const pares = [];
  for (const { campo, valor } of valores) {
    const viejo = String(valor || '');
    if (!viejo.trim()) continue;
    const nuevo = valorDeCampo(estudio, campo);
    if (nuevo === null || nuevo === undefined) continue;
    if (normalizar(nuevo) === normalizar(viejo)) continue;
    pares.push({ campo, viejo, nuevo: String(nuevo) });
  }

  /* De más largo a más corto: el orden importa cuando uno contiene a otro. */
  pares.sort((a, b) => b.viejo.length - a.viejo.length);

  /* Para la guarda 1 se miran TODOS los valores de referencia, no sólo los que quedaron por
     corregir. Un valor sigue siendo ambiguo aunque el que lo contiene ya esté bien en el
     documento, y mirar sólo los pares pendientes abría un agujero grave: si el contribuyente
     conserva su razón social y sólo cambia su puntuación —«COLOMBIA SAS» a «COLOMBIA S.A.S.»,
     el caso más común, el mismo cliente al año siguiente—, ese par se descarta por no tener
     nada que corregir, la guarda se quedaba sin contenedor y «END GAME INTERACTIVE» se
     sustituía dentro de las 45 menciones del contribuyente, dejándolas en «END GAME
     INTERACTIVE INC COLOMBIA S.A.S». Medido sobre el informe real. */
  const todosLosViejos = (valores || [])
    .map((v) => String(v.valor || ''))
    .filter((v) => v.trim());

  for (const par of pares) {
    /* Guarda 1: ambiguo porque otro valor de referencia lo contiene. Tolerante a la puntuación,
       o «END GAME INTERACTIVE» pasaría por inequívoco frente a «END GAME INTERACTIVE COLOMBIA
       S.A.S» sólo porque el otro valor está escrito sin puntos. */
    const contenedor = todosLosViejos.find((otro) =>
      !contieneTolerante(par.viejo, otro) && contieneTolerante(otro, par.viejo));
    if (contenedor) {
      omitidos.push({
        campo: par.campo, valor: par.viejo,
        motivo: `«${par.viejo}» es parte de «${contenedor}», así que sustituirlo `
          + 'reescribiría también las menciones de ese otro dato. Revísalo a mano.',
      });
      continue;
    }

    /* Guarda 2: el viejo es el principio del nuevo. Se exige que no siga el resto. */
    const esPrefijo = par.nuevo.startsWith(par.viejo);
    const resto = esPrefijo ? par.nuevo.slice(par.viejo.length) : '';

    let cuenta = 0;
    let partidos = 0;
    tramo.lastIndex = 0;
    salida = salida.replace(tramo, (todo, abre, contenido, cierra) => {
      /* Tolerante a la puntuación: la razón social vieja aparece en el informe como «COLOMBIA
         SAS» y también como «COLOMBIA S.A.S», y el marcado sólo captura una de las dos. Lo que
         se ESCRIBE es el valor del estudio tal cual, con su puntuación: aquí se ignora para
         encontrar, nunca para sustituir. */
      const donde = aparicionesDe(contenido, par.viejo);
      if (!donde.length) return todo;
      let hecho = contenido;
      /* De atrás hacia adelante: cada sustitución mueve los índices de lo que va después. */
      for (let i = donde.length - 1; i >= 0; i -= 1) {
        const [ini, fin] = donde[i];
        let reemplazo;
        if (esPrefijo && resto) {
          /* Sólo las que no traen ya el sufijo. Las que ya lo traen se tokenizan igual: si se
             dejaran en claro, un par más corto contenido en ellas las reescribiría. */
          const sigue = hecho.slice(fin);
          const yaCompleto = indexarSinPuntuacion(sigue).plano
            .startsWith(indexarSinPuntuacion(resto).plano);
          if (yaCompleto) {
            reemplazo = tokenizar(hecho.slice(ini, fin));
          } else {
            reemplazo = tokenizar(par.nuevo);
            cuenta += 1;
          }
        } else {
          reemplazo = tokenizar(par.nuevo);
          cuenta += 1;
        }
        hecho = hecho.slice(0, ini) + reemplazo + hecho.slice(fin);
      }
      return hecho === contenido ? todo : abre + hecho + cierra;
    });

    /* Lo que queda al concatenar los tramos y no se pudo tocar es que estaba partido entre
       varios de ellos. Se concatenan los tramos y no se usa `soloTexto`, que está hecho para el
       HTML renderizado y no ve el OOXML. */
    tramo.lastIndex = 0;
    const plano = (salida.match(tramo) || [])
      .map((t) => t.replace(/<[^>]+>/g, '')).join('');
    if (aparicionesDe(plano, par.viejo).length && !(esPrefijo && resto)) {
      partidos = 1;
      omitidos.push({
        campo: par.campo, valor: par.viejo,
        motivo: `«${par.viejo}» sigue apareciendo con el texto repartido entre varios tramos `
          + 'del párrafo, donde no se puede sustituir sin romper el formato. Revísalo a mano.',
      });
    }
    if (cuenta) sustituidos.push({ campo: par.campo, valor: par.viejo, nuevo: par.nuevo, cuenta, partidos });
  }

  /* Los tokens vuelven a ser texto. Ya no queda ningún par por aplicar, así que nada puede
     reescribirlos. */
  if (puestos.length) {
    salida = salida.replace(
      new RegExp(escaparRegex(marca) + '(\\d+)' + escaparRegex(marca), 'g'),
      (todo, i) => (puestos[Number(i)] !== undefined ? puestos[Number(i)] : todo)
    );
  }

  return { xml: salida, sustituidos, omitidos };
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
  faltaPorVersion,
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

  /* Plantilla extraída con un lector anterior. Va antes de la revisión de la salida
     porque explica por qué el documento no se parece al original, y la acción no es
     revisar nada: es volver a subir el PDF. Volver a marcar no sirve, porque reusa
     el mismo HTML guardado. */
  if (faltaPorVersion && faltaPorVersion.length) {
    avisos.push({
      nivel: 'aviso',
      texto:
        'Esta plantilla se leyó con una versión anterior del lector de PDF, así que ' +
        faltaPorVersion.join('; y ') + '. Vuelve a subir el mismo PDF de referencia ' +
        'para recuperarlo (volver a marcar no basta: reutiliza lo ya guardado).',
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
