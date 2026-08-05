/**
 * Dónde estaba el usuario: qué estudio tenía abierto y en qué paso.
 *
 * Sin esto, recargar la página devolvía al tablero con el estudio cerrado y había que
 * volver a buscarlo y abrirlo, perdiendo además lo que estuviera a medias en la pantalla.
 * Y no hace falta recargar a mano: basta que el navegador descarte la pestaña, que se
 * corte la conexión mientras carga un bundle o que se despliegue una versión nueva.
 *
 * Se guarda en el navegador y no con el estudio: es estado de la interfaz de *esta*
 * máquina, no del informe. Dos personas con el mismo estudio compartido no tienen por qué
 * ir por el mismo paso.
 *
 * Aquí no se toca React ni Firebase: son las reglas de qué se guarda y cómo se valida,
 * para poder probarlas sin navegador.
 */

export const CLAVE_SESION_UI = 'pt:ui:sesion';

/** Pestañas que exigen un estudio abierto, con el identificador que emite el Layout. */
export const VISTAS_DEL_ESTUDIO = [
  'contribuyente', 'Operaciones', 'Estados financieros', 'comparables', 'auditoria', 'informe',
];

/** Pestañas que se consultan sin estudio abierto. */
export const VISTAS_SIN_ESTUDIO = ['dashboard', 'clientes', 'catalogo'];

/* Nombres antiguos que siguen apareciendo en el código y en sesiones ya guardadas. Sin
   resolverlos, la misma pantalla se montaría dos veces —una por cada nombre— y cada copia
   escribiría en el estudio con su propio estado. */
const ALIAS = {
  operaciones: 'Operaciones',
  eeff: 'Estados financieros',
  cifras: 'Estados financieros',
};

/** Identificador único de una pestaña, resolviendo los alias heredados. */
export function tabCanonica(tab) {
  const t = String(tab || '');
  return ALIAS[t] || ALIAS[t.toLowerCase()] || t;
}

/** ¿Es una pestaña que la aplicación sabe mostrar? */
export function tabConocida(tab) {
  const t = tabCanonica(tab);
  return VISTAS_DEL_ESTUDIO.includes(t) || VISTAS_SIN_ESTUDIO.includes(t);
}

const almacenPorDefecto = () => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    /* Safari en modo privado y algunas políticas de empresa lanzan al solo tocarlo. */
    return null;
  }
};

/**
 * Lee dónde estaba el usuario. Devuelve null ante cualquier duda —sin dato, ilegible,
 * pestaña desconocida— porque el precio de equivocarse es abrir un estudio que no toca, y
 * el de no saberlo es solo empezar en el tablero.
 */
export function leerSesionUi(almacen = almacenPorDefecto()) {
  if (!almacen) return null;
  try {
    const crudo = almacen.getItem(CLAVE_SESION_UI);
    if (!crudo) return null;
    const datos = JSON.parse(crudo);
    const estudioId = typeof datos?.estudioId === 'string' ? datos.estudioId.trim() : '';
    if (!estudioId) return null;
    const tab = tabConocida(datos?.tab) ? tabCanonica(datos.tab) : 'contribuyente';
    return { estudioId, tab };
  } catch {
    return null;
  }
}

/**
 * Anota dónde está el usuario. Solo con un estudio abierto: sin él no hay nada que
 * restaurar, y el tablero ya es el punto de partida.
 */
export function guardarSesionUi({ estudioId, tab }, almacen = almacenPorDefecto()) {
  if (!almacen) return false;
  if (!estudioId) return false;
  try {
    almacen.setItem(CLAVE_SESION_UI, JSON.stringify({
      estudioId: String(estudioId),
      tab: tabConocida(tab) ? tabCanonica(tab) : 'contribuyente',
    }));
    return true;
  } catch {
    /* La cuota llena no puede impedir seguir trabajando: se pierde el recordatorio, no
       el estudio, que va a Firestore por su cuenta. */
    return false;
  }
}

/** Olvida dónde estaba: al cerrar el estudio o al borrarlo. */
export function limpiarSesionUi(almacen = almacenPorDefecto()) {
  if (!almacen) return;
  try {
    almacen.removeItem(CLAVE_SESION_UI);
  } catch { /* nada que hacer, y nada que romper */ }
}

/**
 * Acumula qué pantallas del estudio hay que mantener montadas.
 *
 * Cambiar de pestaña desmontaba la pantalla anterior, y con ella se iba su estado: el
 * registro de la importación, el avance de una lectura de documentos, una curación a
 * medias. Manteniéndolas montadas —ocultas, pero vivas— lo que está en marcha sigue en
 * marcha. Se montan a medida que se visitan y no todas de golpe: abrir un estudio no tiene
 * por qué pagar el arranque de seis pantallas que quizá no se usen.
 *
 * Al cambiar de estudio la lista empieza de cero: es lo que garantiza que el estado de un
 * estudio no acabe escrito en el siguiente.
 */
export function acumularVistaMontada(previo, { estudioId, tab }) {
  const vacio = { estudioId: null, tabs: [] };
  if (!estudioId) return (previo && previo.estudioId === null && previo.tabs.length === 0) ? previo : vacio;

  const canonica = tabCanonica(tab);
  const esDelEstudio = VISTAS_DEL_ESTUDIO.includes(canonica);

  if (!previo || previo.estudioId !== estudioId) {
    return { estudioId, tabs: esDelEstudio ? [canonica] : [] };
  }
  /* Estar en una vista que no es del estudio —el catálogo, los clientes— no retira lo ya
     montado: se vuelve del catálogo al motor y el trabajo sigue ahí. */
  if (!esDelEstudio || previo.tabs.includes(canonica)) return previo;
  return { estudioId, tabs: [...previo.tabs, canonica] };
}
