/* Cruce entre un documento de estados financieros y la comparable a la que
   pertenece.

   Por qué existe: la carga de EEFF por comparable metía las cifras en la fila
   donde se soltaba el archivo, sin comprobar de qué empresa era el documento. Un
   PDF equivocado entraba sin avisar y sus cifras pasaban al rango intercuartil.

   Port de la función `cruzar` del Bloque 18 del monolito (index.html), que ya
   resolvió esto: una cascada de cuatro criterios, de más fuerte a más débil, que
   devuelve además CÓMO cruzó y con qué confianza. Eso es lo que permite explicar
   un rechazo en lugar de limitarse a negarlo. */

import { nameKey } from './comparablesEngine.js';

/* Umbral de solapamiento de palabras por debajo del cual no se acepta el cruce.
   0,5 es el valor del Bloque 18: con la mitad de las palabras significativas en
   común, dos razones sociales son la misma empresa escrita distinto casi siempre;
   por debajo, empieza a cruzar empresas del mismo sector entre sí. */
export const UMBRAL_TOKENS = 0.5;

/* Palabras que no distinguen una empresa de otra: si «HOLDING» contara, dos
   holdings sin relación se parecerían. Misma lista del monolito. */
const VACIAS = /^(SOCIEDAD|LIMITED|COMPANY|GROUP|HOLDING|COLOMBIA|INTERNATIONAL|SERVICES|TECHNOLOGIES)$/;

/* nameKey elimina los sufijos societarios con \b(…|SAS|S\.A\.|SA|…)\b, pero el \b
   final no coincide después de un punto: «GLOBANT S.A.» al final de la cadena
   conserva el sufijo y sale como GLOBANTSA, mientras «Globant SAS» sale como
   GLOBANT. Escritas de las dos formas, la misma empresa no cruzaba.

   Se quitan los puntos de las siglas ANTES de llamar a nameKey, en lugar de
   corregir nameKey: esa función también la usa el motor de continuidad de
   comparables, y ampliar lo que considera equivalente podría hacer cruzar
   empresas que hoy no cruzan, cambiando en silencio qué comparables se mantienen
   de un año a otro. Eso hay que decidirlo aparte. */
function claveNombre(s) {
  /* El punto se borra, no se cambia por espacio: «S.A.» → «SA» sí coincide con
     \bSA\b y nameKey lo elimina, mientras «S A» quedan dos letras sueltas que la
     regex no reconoce y que al final se repegan igual como SA. */
  return nameKey(String(s || '').replace(/\./g, ''));
}

export function tokensNombre(s) {
  return String(s || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !VACIAS.test(t));
}

/** Proporción de palabras significativas en común, de 0 a 1. */
export function parecido(a, b) {
  const ta = tokensNombre(a);
  const tb = tokensNombre(b);
  if (!ta.length || !tb.length) return 0;
  const hits = ta.filter((t) => tb.indexOf(t) >= 0).length;
  return hits / Math.max(ta.length, tb.length);
}

/**
 * Empareja lo leído en un documento con una de las comparables del estudio.
 *
 * @param entrada     objeto leído por la IA: { nombre, identificador_fuente }
 * @param nombreArchivo  nombre del archivo, que suele traer la razón social
 * @param comparables    filas del estudio: [{ name, id, ... }]
 * @returns { indice, comparable, modo, punt } — indice -1 si no cruzó.
 *
 * La cascada va de más fuerte a más débil y se detiene en el primer acierto:
 *   id      → coincide el identificador de Capital IQ (certeza)
 *   nombre  → la razón social normalizada es la misma
 *   archivo → el nombre del archivo coincide con una razón social
 *   tokens  → solapamiento de palabras por encima del umbral (a confirmar)
 */
export function cruzar(entrada, nombreArchivo, comparables) {
  const filas = comparables || [];
  const idDoc = String((entrada && entrada.identificador_fuente) || '').trim().toUpperCase();
  const nomDoc = String((entrada && entrada.nombre) || '').trim();

  if (idDoc) {
    const i = filas.findIndex((f) => f && f.id && String(f.id).trim().toUpperCase() === idDoc);
    if (i >= 0) return { indice: i, comparable: filas[i], modo: 'id', punt: 1 };
  }

  const nk = claveNombre(nomDoc);
  if (nk) {
    const i = filas.findIndex((f) => f && claveNombre(f.name) === nk);
    if (i >= 0) return { indice: i, comparable: filas[i], modo: 'nombre', punt: 1 };
  }

  const nkArchivo = claveNombre(String(nombreArchivo || '').replace(/\.[a-z0-9]+$/i, ''));
  if (nkArchivo) {
    const i = filas.findIndex((f) => f && claveNombre(f.name) === nkArchivo);
    if (i >= 0) return { indice: i, comparable: filas[i], modo: 'archivo', punt: 0.9 };
  }

  let mejor = -1;
  let mejorPunt = 0;
  filas.forEach((f, i) => {
    const p = Math.max(parecido(nomDoc, f && f.name), parecido(nombreArchivo, f && f.name));
    if (p > mejorPunt) { mejorPunt = p; mejor = i; }
  });

  if (mejor >= 0 && mejorPunt >= UMBRAL_TOKENS) {
    return { indice: mejor, comparable: filas[mejor], modo: 'tokens', punt: mejorPunt };
  }

  /* Sin cruce: se devuelve de todos modos la candidata más cercana y su puntaje,
     porque el motivo útil no es «no cruzó» sino «lo más parecido era X, al 30 %». */
  return {
    indice: -1,
    comparable: null,
    modo: 'sin-cruce',
    punt: mejorPunt,
    masCercana: mejor >= 0 ? filas[mejor] : null,
  };
}

/** ¿El cruce es firme o hay que confirmarlo a ojo? */
export function esCruceFirme(cruce) {
  return !!cruce && (cruce.modo === 'id' || cruce.modo === 'nombre');
}

const NOMBRE_MODO = {
  id: 'el identificador de Capital IQ coincide',
  nombre: 'la razón social coincide',
  archivo: 'el nombre del archivo coincide con la razón social',
  tokens: 'coinciden parte de las palabras de la razón social',
  manual: 'lo asignaste a mano',
};

/** Explicación en prosa de por qué cruzó —o por qué no—, para mostrar al usuario.
 *  Un rechazo sin motivo no se puede corregir. */
export function motivoCruce(cruce, entrada, nombreArchivo) {
  const leido = String((entrada && entrada.nombre) || '').trim() || nombreArchivo || 'documento sin nombre';
  const pct = Math.round((cruce.punt || 0) * 100);

  if (cruce.modo === 'sin-cruce') {
    const cerca = cruce.masCercana && cruce.masCercana.name;
    return cerca
      ? 'El documento es de «' + leido + '», que no está entre las comparables del estudio. ' +
        'Lo más parecido era «' + cerca + '», con ' + pct + ' % de coincidencia — por debajo del ' +
        Math.round(UMBRAL_TOKENS * 100) + ' % que se exige.'
      : 'El documento es de «' + leido + '» y no se parece a ninguna de las comparables del estudio.';
  }

  const base = 'Asignado a «' + cruce.comparable.name + '» porque ' + (NOMBRE_MODO[cruce.modo] || cruce.modo);
  return esCruceFirme(cruce)
    ? base + '.'
    : base + ' (' + pct + ' %). Se leyó «' + leido + '»: confírmalo antes de radicar.';
}

/** Motivo del rechazo cuando el documento se sube a una fila concreta y resulta
 *  ser de otra empresa. Es el caso que antes entraba sin decir nada. */
export function motivoRechazoEnFila(entrada, comparableDestino, nombreArchivo) {
  const leido = String((entrada && entrada.nombre) || '').trim() || nombreArchivo || 'documento sin nombre';
  const destino = (comparableDestino && comparableDestino.name) || 'la fila seleccionada';
  const pct = Math.round(parecido(leido, destino) * 100);
  return 'El documento es de «' + leido + '» y lo estás cargando en «' + destino + '» (' + pct +
    ' % de coincidencia). No se aplicaron las cifras: si de verdad corresponde, corrige la razón ' +
    'social de la comparable o usa la carga masiva, que reparte cada documento a su fila.';
}

/**
 * Reparte las empresas leídas de uno o varios documentos entre las comparables.
 * Devuelve { aplicadas, rechazadas } — las rechazadas con su motivo, nunca en
 * silencio: un cruce que falla por una razón social mal escrita se corrige, pero
 * solo si se ve.
 */
export function repartir(entradas, comparables) {
  const aplicadas = [];
  const rechazadas = [];
  const ocupadas = new Set();

  /* Los cruces firmes se resuelven primero: si un documento dudoso reclama la
     misma fila que uno con identificador, gana el firme. Sin este orden, el
     primero en llegar se queda la fila y el bueno acaba rechazado. */
  const conCruce = entradas.map((e) => ({ entrada: e, cruce: cruzar(e.datos, e.archivo, comparables) }));
  const orden = [...conCruce].sort((a, b) => (b.cruce.punt || 0) - (a.cruce.punt || 0));

  orden.forEach(({ entrada, cruce }) => {
    if (cruce.indice < 0) {
      rechazadas.push({ ...entrada, motivo: motivoCruce(cruce, entrada.datos, entrada.archivo), cruce });
      return;
    }
    if (ocupadas.has(cruce.indice)) {
      rechazadas.push({
        ...entrada,
        motivo: 'Otro documento ya se aplicó a «' + cruce.comparable.name +
          '» con un cruce más firme. Revisa si este archivo está duplicado o si es de otra empresa.',
        cruce,
      });
      return;
    }
    ocupadas.add(cruce.indice);
    aplicadas.push({
      ...entrada,
      indice: cruce.indice,
      cruce,
      firme: esCruceFirme(cruce),
      motivo: motivoCruce(cruce, entrada.datos, entrada.archivo),
    });
  });

  return { aplicadas, rechazadas };
}
