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
import { pctf } from '../utils/calculations.js';

/* Umbral de solapamiento de palabras por debajo del cual no se acepta el cruce.
   0,5 es el valor del Bloque 18: con la mitad de las palabras significativas en
   común, dos razones sociales son la misma empresa escrita distinto casi siempre;
   por debajo, empieza a cruzar empresas del mismo sector entre sí. */
export const UMBRAL_TOKENS = 0.5;

/* Palabras que no distinguen una empresa de otra: si «HOLDING» contara, dos
   holdings sin relación se parecerían. Misma lista del monolito, más el ruido que
   traen los nombres de archivo de un estado financiero.

   Ese ruido no es un detalle: los documentos reales se llaman «10 HYBRID TECHNOLOGIES
   CO. LTD. Estado de resultados 2025 Ventas netas.pdf», y contar ESTADO, RESULTADOS,
   VENTAS y NETAS como parte de la razón social hundía el parecido por debajo del
   umbral. De 19 documentos cruzaban 12. */
const VACIAS = /^(SOCIEDAD|LIMITED|COMPANY|GROUP|HOLDING|COLOMBIA|INTERNATIONAL|SERVICES|TECHNOLOGIES|ESTADO|ESTADOS|RESULTADO|RESULTADOS|RESULTAD|FINANCIERO|FINANCIEROS|BALANCE|SITUACION|VENTAS|NETAS|NETOS|INGRESOS|EEFF|20\d\d|19\d\d)$/;

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
    /* El sufijo de bolsa que agrega Capital IQ —«(TSE:4260)», «(KOSDAQ:A217270)»— se
       quita antes de partir en palabras: si no, KOSDAQ y A217270 cuentan como parte de
       la razón social y diluyen el parecido. `nameKey` ya lo hacía; aquí faltaba. */
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^A-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 4 && !VACIAS.test(t));
}

/**
 * Qué parte de la razón social aparece en el texto candidato, de 0 a 1.
 *
 * Es asimétrica a propósito, y ahí está la diferencia con `parecido`: lo que importa no
 * es que los dos textos se parezcan, sino que el documento mencione la razón social
 * completa. Un archivo llamado «AERIA INC. Estado de resultados 2025 Ventas netas»
 * contiene «Aeria» entera, pero al dividir por el lado más largo daba 0,20 y se
 * rechazaba.
 */
export function cobertura(razonSocial, candidato) {
  const tr = tokensNombre(razonSocial);
  if (!tr.length) return 0;
  const tc = tokensNombre(candidato);
  if (!tc.length) return 0;
  const hits = tr.filter((t) => tc.indexOf(t) >= 0).length;
  return hits / tr.length;
}

/* Cobertura mínima para aceptar que el documento nombra a la comparable. Se exige la
   razón social prácticamente entera: meter las cifras de otra empresa en el rango
   intercuartil es peor que no cruzar. */
export const UMBRAL_COBERTURA = 0.8;

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

  /* Sin comparables no hay contra qué cruzar, y hay que decirlo así.
     Antes esto caía en el mismo «no se parece a ninguna de las comparables del estudio»
     que un documento de otra empresa, con un mensaje por documento: quince rechazos
     idénticos y ninguna pista de que lo que faltaba era ejecutar la selección del paso 3.
     Es un estado distinto y merece un motivo distinto. */
  if (!filas.length) {
    return { indice: -1, comparable: null, modo: 'sin-comparables', punt: 0, masCercana: null };
  }

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
  let empatesTokens = 0;
  filas.forEach((f, i) => {
    const p = Math.max(parecido(nomDoc, f && f.name), parecido(nombreArchivo, f && f.name));
    if (p > mejorPunt) { mejorPunt = p; mejor = i; empatesTokens = 1; }
    else if (p === mejorPunt && p > 0) empatesTokens++;
  });

  /* Se exige que el mejor parecido sea único. Sin esto ganaba la primera fila del
     arreglo, por orden y no por criterio: con «Neptune Company» y «Neptune» en la misma
     muestra, un documento de una entraba en la otra y sus cifras acababan en el rango
     intercuartil sin que nada lo delatara. */
  if (mejor >= 0 && mejorPunt >= UMBRAL_TOKENS && empatesTokens === 1) {
    return { indice: mejor, comparable: filas[mejor], modo: 'tokens', punt: mejorPunt };
  }
  if (mejor >= 0 && mejorPunt >= UMBRAL_TOKENS && empatesTokens > 1) {
    return {
      indice: -1, comparable: null, modo: 'ambiguo', punt: mejorPunt,
      masCercana: filas[mejor], empatados: empatesTokens,
    };
  }

  /* Último criterio: que el documento nombre la razón social completa, aunque traiga
     mucho texto más. Es el caso de los archivos titulados «AERIA INC. Estado de
     resultados 2025 Ventas netas», que con la métrica simétrica se quedaban en 0,20.

     Se exige que la mejor cobertura sea ÚNICA. Con dos comparables igual de cubiertas
     —«Neptune Company» y «Neptune Games», por ejemplo— no hay forma de saber cuál es, y
     aplicar las cifras a la equivocada las mete en el rango intercuartil sin que nadie
     lo note. Ante la duda, se rechaza y se explica. */
  const texto = String(nomDoc || '') + ' ' + String(nombreArchivo || '');
  let mejorCob = 0, iCob = -1, empatados = 0;
  filas.forEach((f, i) => {
    const c = cobertura(f && f.name, texto);
    if (c > mejorCob) { mejorCob = c; iCob = i; empatados = 1; }
    else if (c === mejorCob && c > 0) empatados++;
  });

  if (iCob >= 0 && mejorCob >= UMBRAL_COBERTURA && empatados === 1) {
    return { indice: iCob, comparable: filas[iCob], modo: 'contenido', punt: mejorCob };
  }
  if (mejorCob >= UMBRAL_COBERTURA && empatados > 1) {
    return {
      indice: -1, comparable: null, modo: 'ambiguo', punt: mejorCob,
      masCercana: filas[iCob] || null, empatados,
    };
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
  contenido: 'el documento nombra la razón social completa',
  manual: 'lo asignaste a mano',
};

/** Explicación en prosa de por qué cruzó —o por qué no—, para mostrar al usuario.
 *  Un rechazo sin motivo no se puede corregir. */
export function motivoCruce(cruce, entrada, nombreArchivo) {
  const leido = String((entrada && entrada.nombre) || '').trim() || nombreArchivo || 'documento sin nombre';
  /* `pctf` recibe la fracción y pone el signo, así que aquí desaparece el `* 100` y de los
     literales de abajo desaparece el « %»: dejar cualquiera de los dos daba una cadena
     creíble y falsa —«8.700,000 %» o «87,000 % %»—. */
  const pct = pctf(cruce.punt || 0);

  /* ── ESTA RAMA YA NO SE ALCANZA, y se conserva por si algún llamador nuevo la pide ──
     Decía «ejecute la selección del paso 3 y vuelva a cargar los estados financieros», que era
     cierto mientras la muestra solo podía salir del cribado. Desde el 2026-09-04 un documento
     que no cruza con ninguna fila CREA su comparable, así que `repartir` manda el caso a
     `nuevas` antes de llegar aquí, y la carga por fila necesita una fila seleccionada —o sea,
     que la tabla no esté vacía—.

     Se deja el texto corregido en vez de un mensaje que contradiga el comportamiento: si
     reaparece, que no mande al analista a un paso que ya no hace falta. */
  if (cruce.modo === 'sin-comparables') {
    return 'El estudio todavía no tiene comparables en la tabla. Cargue este documento desde la ' +
      'carga masiva, que crea la comparable a partir de su razón social y sus cifras.';
  }

  if (cruce.modo === 'ambiguo') {
    return 'El documento de «' + leido + '» encaja igual de bien con ' + cruce.empatados +
      ' comparables del estudio, así que no se aplicó a ninguna: cargarlo en la equivocada ' +
      'metería sus cifras en el rango intercuartil. Súbelo desde la fila que corresponda.';
  }

  if (cruce.modo === 'sin-cruce') {
    const cerca = cruce.masCercana && cruce.masCercana.name;
    return cerca
      ? 'El documento es de «' + leido + '», que no está entre las comparables del estudio. ' +
        'Lo más parecido era «' + cerca + '», con ' + pct + ' de coincidencia — por debajo del ' +
        pctf(UMBRAL_TOKENS) + ' que se exige.'
      : 'El documento es de «' + leido + '» y no se parece a ninguna de las comparables del estudio.';
  }

  const base = 'Asignado a «' + cruce.comparable.name + '» porque ' + (NOMBRE_MODO[cruce.modo] || cruce.modo);
  return esCruceFirme(cruce)
    ? base + '.'
    : base + ' (' + pct + '). Se leyó «' + leido + '»: confírmalo antes de radicar.';
}

/** Motivo del rechazo cuando el documento se sube a una fila concreta y resulta
 *  ser de otra empresa. Es el caso que antes entraba sin decir nada. */
export function motivoRechazoEnFila(entrada, comparableDestino, nombreArchivo) {
  const leido = String((entrada && entrada.nombre) || '').trim() || nombreArchivo || 'documento sin nombre';
  const destino = (comparableDestino && comparableDestino.name) || 'la fila seleccionada';
  const pct = pctf(parecido(leido, destino));
  return 'El documento es de «' + leido + '» y lo estás cargando en «' + destino + '» (' + pct +
    ' de coincidencia). No se aplicaron las cifras: si de verdad corresponde, corrige la razón ' +
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

  /* ── EL DOCUMENTO QUE NO CRUZA CON NINGUNA FILA CREA SU COMPARABLE ──
     Pedido el 2026-09-02: «al cargar un estado financiero lo que debe hacer es crear la
     comparable si esta no existe».

     Es el segundo camino del proceso, y el usuario lo describió así: «hicimos la búsqueda de
     las comparables de manera manual y ya tenemos las comparables; si cargamos los EEFF de
     estas comparables debería agregarlos y generar los análisis con estos datos». Antes había
     que crear la fila a mano y con la razón social exacta, o el documento se rechazaba con
     «0,000 % de coincidencia».

     La verificación de identidad NO se debilita: sigue atrapando el documento que cruza con
     OTRA fila y el duplicado que llega a una fila ya ocupada. Lo que cambia es el caso en que
     no hay con qué chocar — no existe la comparable— y ahí crearla es lo correcto: el documento
     trae la razón social y las cifras, que es todo lo que la fila necesita.

     Se exige que el documento traiga RAZON SOCIAL. Sin ella no se puede nombrar la comparable, y
     una fila anónima con cifras es peor que un rechazo: entra al rango sin que nadie sepa de
     quién es. */
  const nuevas = [];

  orden.forEach(({ entrada, cruce }) => {
    if (cruce.indice < 0) {
      const nombreDoc = String((entrada.datos && entrada.datos.nombre) || '').trim();
      if (!nombreDoc) {
        rechazadas.push({
          ...entrada,
          motivo: 'El documento no cruza con ninguna comparable de la muestra y tampoco trae la '
            + 'razón social, así que no se puede crear una para él: una fila con cifras y sin '
            + 'nombre entraría al rango sin que nadie sepa de quién es. Escriba la razón social '
            + 'en una fila y vuelva a cargarlo ahí.',
          cruce,
        });
        return;
      }
      nuevas.push({
        ...entrada,
        /* El índice se le asigna al crear la fila, en el llamador: aquí solo se declara que
           hace falta una. */
        indice: -1,
        crearComparable: true,
        nombre: nombreDoc,
        identificador: String((entrada.datos && entrada.datos.identificador_fuente) || '').trim(),
        cruce: { ...cruce, modo: 'manual', punt: 1 },
        firme: false,
        motivo: 'No estaba en la muestra: se creó la comparable «' + nombreDoc + '» con la razón '
          + 'social y las cifras de este documento. Verifique que corresponde al estudio.',
      });
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

  /* `nuevas` va aparte de `aplicadas` porque el llamador tiene que CREAR la fila antes de
     aplicarles las cifras: mezclarlas obligaría a distinguirlas por un campo dentro del bucle
     que ya las aplica, y ahí es donde se cuela un índice equivocado. */
  return { aplicadas, rechazadas, nuevas };
}
