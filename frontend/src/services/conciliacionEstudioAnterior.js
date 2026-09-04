/* ─────────────────────────────────────────────────────────────────────────────
   conciliacionEstudioAnterior.js — por qué cada comparable del año pasado ya no está.

   POR QUÉ EXISTE. Reportado el 2026-09-02: «la continuidad de las comparables no me está
   trayendo las mismas comparables del año pasado y lo que necesito es eso», y enseguida «con
   eso podemos hacer una mejor justificación de porqué ya no esas comparables».

   El motor marcaba `esContinuidad` cruzando por nombre normalizado contra el universo del año
   corriente. Eso reconoce a la que SIGUE en el cribado, y nada más: una comparable del estudio
   pasado que este año no aparece en el screening de Capital IQ es INVISIBLE para el motor —no
   está entre las candidatas, así que no se puede seleccionar ni rechazar—. Simplemente no sale,
   y el analista descubre el hueco al cotejar los dos informes.

   Y ahí está el trabajo que este servicio quita de encima: la DIAN pregunta por qué la muestra
   cambió de un año al otro, y la respuesta hay que reconstruirla a mano contra el informe
   anterior. Aquí sale calculada, comparable por comparable, con el motivo real.

   LOS CUATRO ESTADOS, y cada uno se justifica distinto:

     · `enLaMuestra`          sigue. No hay nada que explicar.
     · `descartadaPorFiltro`  está en el cribado de este año pero un filtro la retiró. Se nombra
                              el filtro y su motivo, que es lo que se cita en el informe.
     · `enReserva`            está en el cribado, pasó los filtros, y no entró por cupo o por
                              puntaje. Es la más fácil de sustentar: sigue siendo comparable, no
                              hizo falta.
     · `fueraDelCribado`      el screening de este año no la devolvió. NINGÚN ajuste del motor
                              la trae, y eso hay que decirlo así: o se amplía el cribado del paso
                              1, o se sustenta que la compañía dejó de ser comparable (deslistada,
                              fusionada, cambió de actividad, dejó de publicar cifras).

   EL CRUCE ES POR NOMBRE, y no por identificador, porque el estudio anterior no trae el ID de
   Capital IQ: `priorStudyParser` extrae nombre, país y actividad del informe en PDF, y ahí ese
   dato no existe. `nameKey` normaliza mayúsculas, tildes, el sufijo de bolsa entre paréntesis
   y las formas societarias (INC, LTD, S.A.S., GMBH…), que es lo que hace coincidir «Furukawa
   Electric Co., Ltd.» con «Furukawa Electric Co Ltd (TSE:5801)».

   Y CUANDO NO COINCIDE EXACTO se busca un PARECIDO por palabras, porque el motivo más común de
   «no me trae las mismas» no es que la compañía se haya ido: es que el informe del año pasado
   escribió el nombre de otra forma. Un parecido NO se da por continuidad —eso lo decide el
   analista— pero se nombra, que es lo que permite corregirlo.

   Servicio puro, sin React y sin red, como `diagnosticoRango.js` y `previsualizarFiltros.js`.
   ───────────────────────────────────────────────────────────────────────────── */

/* `claveDeCruce` y no `nameKey`: la segunda es el identificador de documento del catálogo en
   Firestore y por eso tiene que ser estable, pero no limpia las formas societarias escritas con
   puntos y dejaba sin cruzar compañías que sí seguían en el cribado. Ver su nota en
   `comparablesEngine.js`. */
import { claveDeCruce } from './comparablesEngine.js';

/* Cuántas palabras en común hacen sospechar que son la misma compañía escrita distinto. Dos,
   porque con una sola «Electric» emparejaría a media industria.

   CON UNA EXCEPCION, y la destapó una prueba: «Sumitomo Electric Industries» tiene UNA sola
   palabra distintiva —ELECTRIC e INDUSTRIES no distinguen a nadie en una lista de comparables—
   así que el umbral de dos descartaba un nombre que coincide entero. La regla real es que las
   palabras en común cubran TODAS las distintivas del nombre anterior, o que haya al menos dos:
   así un nombre corto y específico vale, y un nombre largo necesita más de una coincidencia. */
const PALABRAS_PARA_SOSPECHAR = 2;

/* Palabras que no distinguen a nadie en una lista de comparables y por eso no cuentan para el
   parecido. `nameKey` ya retira las formas societarias, pero estas sobreviven porque son parte
   del nombre comercial. */
const PALABRAS_VACIAS = new Set([
  'GROUP', 'HOLDING', 'HOLDINGS', 'INTERNATIONAL', 'INDUSTRIES', 'INDUSTRIAL', 'TECHNOLOGY',
  'TECHNOLOGIES', 'TECH', 'ELECTRIC', 'ELECTRONICS', 'SYSTEMS', 'SOLUTIONS', 'SERVICES',
  'PRODUCTS', 'MANUFACTURING', 'DE', 'DEL', 'LA', 'EL', 'AND', 'THE',
]);

/** Las palabras con las que se mide el parecido: mayúsculas, sin tildes y sin las vacías. */
function palabrasDe(nombre) {
  return String(nombre || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\([^)]*\)/g, ' ')
    .split(/[^A-Z0-9]+/)
    .filter((p) => p.length >= 3 && !PALABRAS_VACIAS.has(p));
}

/**
 * La candidata del universo que MÁS se parece a este nombre sin ser una coincidencia exacta.
 *
 * No se usa para dar continuidad —un parecido no es una identidad, y confundir dos compañías
 * distintas mete en la muestra una que nadie evaluó— sino para poder decirle al analista «puede
 * que sea esta, escrita de otra forma», que es lo que le permite corregir el nombre en el
 * estudio anterior y recuperar el cruce.
 */
export function parecidoEnElUniverso(nombre, universo) {
  const mias = new Set(palabrasDe(nombre));
  if (mias.size === 0) return null;
  let mejor = null;
  (Array.isArray(universo) ? universo : []).forEach((c) => {
    const suyas = palabrasDe(c && c.name);
    const comunes = [...new Set(suyas.filter((p) => mias.has(p)))];
    const cubreTodoElNombre = comunes.length > 0 && comunes.length === mias.size;
    if (comunes.length < PALABRAS_PARA_SOSPECHAR && !cubreTodoElNombre) return;
    if (!mejor || comunes.length > mejor.comunes) {
      mejor = { name: (c && c.name) || '', id: (c && c.id) || '', comunes: comunes.length, palabras: comunes };
    }
  });
  return mejor;
}

/**
 * Estado de cada comparable del estudio anterior frente a la muestra de este año.
 *
 * @param {object} p
 * @param {Array}  p.previas    las comparables del estudio anterior (`{name}` como mínimo).
 * @param {Array}  p.universo   el cribado importado en el paso 1.
 * @param {Array}  p.muestra    las comparables seleccionadas este año.
 * @param {Array}  [p.rechazadas] las candidatas que el motor descartó, con `motivoRechazo`.
 * @param {Array}  [p.reserva]    las que pasaron los filtros y no entraron.
 * @returns {object|null} `null` si no hay estudio anterior: sin él no hay nada que conciliar.
 */
export function conciliarConEstudioAnterior({
  previas, universo, muestra, rechazadas = [], reserva = [],
} = {}) {
  const lista = (Array.isArray(previas) ? previas : []).filter((c) => c && (c.name || c.nombre));
  if (!lista.length) return null;

  const clave = (c) => claveDeCruce((c && (c.name || c.nombre)) || '');
  const indice = (arr) => {
    const m = new Map();
    (Array.isArray(arr) ? arr : []).forEach((c) => {
      const k = clave(c);
      if (k && !m.has(k)) m.set(k, c);
    });
    return m;
  };

  const enMuestra = indice(muestra);
  const enRechazadas = indice(rechazadas);
  const enReserva = indice(reserva);
  const enUniverso = indice(universo);

  const filas = lista.map((previa) => {
    const nombre = previa.name || previa.nombre || '';
    const k = clave(previa);
    const base = { name: nombre, clave: k };

    if (enMuestra.has(k)) {
      return { ...base, estado: 'enLaMuestra', motivo: '' };
    }
    if (enRechazadas.has(k)) {
      const c = enRechazadas.get(k);
      return {
        ...base,
        estado: 'descartadaPorFiltro',
        filtro: c.motivoClave || '',
        motivo: c.motivoRechazo || '',
      };
    }
    if (enReserva.has(k)) {
      return {
        ...base,
        estado: 'enReserva',
        motivo: 'Superó los filtros de comparabilidad pero no integró la muestra: el cupo se '
          + 'completó con candidatas de mayor puntaje. Sigue siendo comparable.',
      };
    }
    if (enUniverso.has(k)) {
      /* Está en el cribado y no aparece en ninguna de las tres listas del motor. Pasa cuando la
         corrida es anterior al cribado actual: se dice lo que se sabe y no se inventa un motivo. */
      return {
        ...base,
        estado: 'enElCribadoSinEvaluar',
        motivo: 'Figura en el cribado de este año pero no en el resultado de la última corrida '
          + 'del motor. Vuelva a ejecutar la selección para clasificarla.',
      };
    }

    /* El caso que el motor no podía ver: el screening de este año no la devolvió. */
    const parecido = parecidoEnElUniverso(nombre, universo);
    return {
      ...base,
      estado: 'fueraDelCribado',
      parecido: parecido ? { name: parecido.name, id: parecido.id, palabras: parecido.palabras } : null,
      motivo: parecido
        ? `El cribado de este año no la trae con ese nombre. Hay una candidata parecida —«${parecido.name}»— `
          + 'que podría ser la misma escrita de otra forma: confírmelo antes de darla por continuidad.'
        : 'El cribado de este año no la devolvió. Ningún ajuste del motor puede traerla: amplíe '
          + 'el cribado del paso 1 o sustente que dejó de ser comparable (deslistada, fusionada, '
          + 'cambio de actividad o dejó de publicar cifras).',
    };
  });

  const cuenta = (estado) => filas.filter((f) => f.estado === estado).length;
  return {
    filas,
    total: filas.length,
    enLaMuestra: cuenta('enLaMuestra'),
    descartadas: cuenta('descartadaPorFiltro'),
    enReserva: cuenta('enReserva'),
    fueraDelCribado: cuenta('fueraDelCribado'),
    sinEvaluar: cuenta('enElCribadoSinEvaluar'),
    /* Las que hay que explicar en el informe: todo lo que no siguió en la muestra. */
    porExplicar: filas.filter((f) => f.estado !== 'enLaMuestra').length,
    /* Las que probablemente SÍ están pero con otro nombre: es lo primero que hay que revisar,
       porque se recuperan corrigiendo el nombre y no ampliando el cribado. */
    posiblesCoincidencias: filas.filter((f) => f.estado === 'fueraDelCribado' && f.parecido).length,
  };
}
