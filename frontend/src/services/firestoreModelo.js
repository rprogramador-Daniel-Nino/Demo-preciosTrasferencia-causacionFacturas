/* Forma de los documentos que van a Firestore, sin tocar el SDK.
   Está separado de `firestoreRepo.js` a propósito: aquí vive la lógica que decide
   qué se guarda y cómo se fusiona, y por eso es lo único de la capa de datos que se
   puede probar con `npm test`. El repositorio, que solo traduce esto a llamadas del
   SDK, se verifica en el navegador.

   Los nombres de campo son los que documenta y valida `firestore.rules`: cambiar uno
   aquí sin cambiarlo allá produce un `permission-denied` que no dice qué campo
   sobra, así que los dos archivos se leen juntos. */

//
// Colección: analisisMercado
// ID del documento: "actual" (uno solo, más la subcolección "historial")
// Escrito exclusivamente por la Cloud Function programada `actualizarAnalisisMercadoScheduled`
// (Admin SDK); los miembros del dominio solo leen.
// Campos:
//   - actualizadoEn: timestamp
//   - series: map de clave de serie -> { valores, fuente, fuenteUrl, fechaConsulta, confiable }
//   - narrativa: { mundial: string (HTML), colombia: string (HTML) }
//
// Subcolección: analisisMercado/actual/historial
// ID del documento: "YYYY-MM" — una copia congelada de cada corrida, para poder responder
// con qué cifra y fuente se radicó un informe de una fecha dada.
//
// No hay funciones de validación en este archivo para `analisisMercado`: el gestor nunca
// escribe esta colección (solo la Cloud Function, vía Admin SDK). La lectura desde el
// frontend va por `leerAnalisisMercado()` en `firestoreRepo.js`.

import { nameKey } from './comparablesEngine.js';

/** Tope de `apariciones` en cada comparable histórica, el mismo que exigen las reglas. */
export const TOPE_APARICIONES = 200;
/** Tope de `anios`, igual que en las reglas. */
export const TOPE_ANIOS = 40;

/**
 * NIT como identificador de documento: solo los dígitos de la raíz, sin el dígito de
 * verificación. «900.123.456-7», «900123456-7» y «900123456» son el mismo
 * contribuyente, y si cada forma creara su propio documento el catálogo de clientes
 * se llenaría de duplicados que nadie podría cruzar.
 */
export function normalizarNit(nit) {
  const crudo = String(nit || '').trim();
  if (!crudo) return '';
  const raiz = crudo.split('-')[0];
  return raiz.replace(/\D/g, '');
}

/**
 * Número, o null si el valor está ausente o no es numérico.
 *
 * No basta `Number(valor)`: `Number(null)` y `Number('')` devuelven 0, y 0 es un
 * número perfectamente válido para estas cifras. Con esa confusión, una comparable sin
 * estado financiero cargado escribía 0 en ingresos y una sin margen conocido escribía
 * un margen de 0 % —una cifra falsa dentro de un informe fiscal, no un dato faltante.
 */
export function aNumero(valor) {
  if (valor === null || valor === undefined) return null;
  if (typeof valor === 'string' && valor.trim() === '') return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

/** Año gravable como número, o null si no se puede leer. */
export function anioValido(valor) {
  const n = Number(String(valor || '').trim());
  return Number.isInteger(n) && n >= 2000 && n <= 2100 ? n : null;
}

/* Campos del estudio que NO viajan a la nube, porque son grandes y no se comparten:

   - `universo`: el Excel de Capital IQ completo, miles de filas con descripción de
     negocio. Nunca se persistió.
   - `iaMatch`: el veredicto de la curación, un dictamen por candidata. Se guarda en
     localStorage por decisión del usuario.
   - `eeffImages`: las páginas del PDF de estados financieros rasterizadas a PNG para
     el ANEXO A. Un caso real pesó 3,4 MB —más del triple del máximo de 1 MiB por
     documento— y hacía que el estudio entero dejara de guardarse con un
     `FirebaseError` en consola. Van a IndexedDB, que es donde ya viven los demás
     recursos binarios del informe.
   - `eeffImagenesComparables`: las páginas del EEFF de cada comparable para el ANEXO B,
     mismo motivo de tamaño que `eeffImages` — un mapa por comparable en vez de un arreglo
     plano. Va a IndexedDB junto con el resto de recursos binarios del informe.

   Dejarlos fuera es lo que mantiene el documento del estudio lejos del techo. */
/**
 * Sello con el id del estudio del que se leyeron los datos que hay en memoria.
 *
 * Existe porque un estudio acabó con los datos de otro: dos documentos distintos, misma
 * razón social, mismo NIT y mismo monto. Cada pantalla del gestor guarda su propio estado
 * y lo escribe en «el estudio activo», sin comprobar de qué estudio salió; con `setDoc`
 * sin `merge`, esa escritura reemplaza el documento entero.
 *
 * El sello lo pone quien carga o crea el estudio y lo comprueba el autoguardado: si no
 * coincide con el estudio activo, la escritura no sale. No viaja a la nube —está en
 * CAMPOS_SOLO_LOCALES— porque es un dato de la sesión, no del estudio.
 */
export const SELLO_ESTUDIO = '_estudioId';

/* `matrizRechazo` VIAJA a Firestore, y esta lista es justamente donde no debe estar.
   Estuvo aquí por un motivo que no se sostiene al medirlo: un nombre por cada compañía
   evaluada pesa 154 KB para un universo de 3.000 —el 15 % de `TOPE_DOCUMENTO`—, porque son
   solo razones sociales, sin las descripciones de negocio que hacen enorme al universo.

   Y quedarse fuera del documento no la mandaba a ninguna otra parte: al contrario del
   `iaMatch` (localStorage) o de las imágenes de los anexos (IndexedDB), nadie la guardaba,
   así que se descartaba en cada guardado. El estudio la calculaba al correr el motor, la
   usaba en pantalla y la perdía; el ANEXO C del informe salía entonces con la matriz que
   trajera la plantilla —la del año anterior— sin que nada lo delatara.

   Si algún día un cribado la hiciera desbordar el documento, `verificarTamano` lo dice con
   el campo señalado antes de gastar la escritura, y el sitio al que movería es Cloud
   Storage, por donde ya viaja el cribado de Capital IQ. No localStorage. */
export const CAMPOS_SOLO_LOCALES = ['universo', 'iaMatch', 'eeffImages', 'eeffImagenesComparables', SELLO_ESTUDIO];

/** Máximo que admite un documento de Firestore. */
export const TOPE_DOCUMENTO = 1048576;

/**
 * Peso aproximado en bytes de lo que se va a escribir. Aproximado porque Firestore
 * cuenta además el nombre de cada campo y algo de sobrecarga por tipo, así que se
 * compara contra un umbral con margen y no contra el techo exacto.
 */
export function pesoAproximado(valor) {
  try {
    return new TextEncoder().encode(JSON.stringify(valor === undefined ? null : valor)).length;
  } catch {
    /* referencias circulares u objetos no serializables: no se puede medir, y decir
       cero es menos dañino que romper el guardado */
    return 0;
  }
}

/** Campos ordenados por lo que ocupan, para poder señalar al culpable. */
export function camposMasPesados(datos, cuantos = 5) {
  return Object.entries(datos || {})
    .map(([campo, valor]) => ({ campo, bytes: pesoAproximado(valor) }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, cuantos);
}

/**
 * Error con el diagnóstico ya hecho. El mensaje de Firestore dice cuánto pesa el
 * documento pero no qué lo hace pesar, y en un estudio con decenas de campos eso deja
 * al usuario sin nada que hacer. Aquí se nombran los tres campos más grandes.
 */
export class ErrorEstudioDemasiadoGrande extends Error {
  constructor(bytes, culpables) {
    const detalle = (culpables || [])
      .map(c => `${c.campo} (${Math.round(c.bytes / 1024)} KB)`)
      .join(', ');
    super(
      `El estudio pesa ${Math.round(bytes / 1024)} KB y el máximo por documento es ` +
      `${Math.round(TOPE_DOCUMENTO / 1024)} KB, así que no se guardó en la nube. ` +
      `Lo que más ocupa: ${detalle || 'no se pudo determinar'}. ` +
      'Si es un documento adjunto o una imagen, tiene que guardarse fuera del estudio.'
    );
    this.name = 'ErrorEstudioDemasiadoGrande';
    this.bytes = bytes;
    this.culpables = culpables || [];
  }
}

/**
 * Comprueba el tamaño antes de intentar la escritura. Se deja un 5 % de margen porque
 * la cuenta de Firestore incluye sobrecarga que aquí no se mide.
 */
export function verificarTamano(documento) {
  const bytes = pesoAproximado(documento);
  if (bytes > TOPE_DOCUMENTO * 0.95) {
    throw new ErrorEstudioDemasiadoGrande(bytes, camposMasPesados(documento && documento.datos, 3));
  }
  return bytes;
}

/**
 * Parte el estudio en lo que va a Firestore y lo que se queda en localStorage.
 * Devolver los dos lados por separado evita el error de guardar el objeto entero en
 * ambos sitios y que cada uno acabe con una versión distinta de la verdad.
 */
export function separarEstudio(study) {
  const s = study || {};
  const nube = {}, local = {};
  Object.keys(s).forEach(clave => {
    if (CAMPOS_SOLO_LOCALES.includes(clave)) local[clave] = s[clave];
    else nube[clave] = s[clave];
  });
  return { nube, local };
}

/* Máximo de personas con las que se puede compartir un mismo estudio. Las reglas
   comprueban el tope: sin él, la lista sería un campo de crecimiento libre. */
export const TOPE_COMPARTIDO = 25;

/**
 * Correo corporativo normalizado, tal como se compara en las reglas.
 *
 * La compartición se hace por correo y no por identificador de usuario a propósito: no
 * existe un directorio del equipo, así que nadie puede averiguar el uid de un
 * compañero, mientras que su correo se conoce. Las reglas contrastan este valor con
 * `request.auth.token.email`, que Google emite en minúsculas y verificado.
 */
export function normalizarCorreo(correo) {
  return String(correo || '').trim().toLowerCase();
}

/**
 * ¿Tiene forma de correo? Ya no se exige un dominio concreto: entra cualquier cuenta de
 * Google, así que restringir a quién se comparte dejaría fuera a personas que sí pueden
 * iniciar sesión. Se valida solo la forma, con un dominio de al menos dos partes, para
 * atajar el error de tecleo antes de guardar un acceso que nunca serviría.
 */
export function esCorreoCompartible(correo) {
  const limpio = normalizarCorreo(correo);
  return /^[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(limpio);
}

/**
 * Añade un correo a la lista de habilitados, sin repetir y respetando el tope.
 * Devuelve la lista nueva y por qué, si no se pudo.
 */
export function agregarCompartido(lista, correo, { correoPropio } = {}) {
  const actual = (lista || []).map(normalizarCorreo).filter(Boolean);
  const limpio = normalizarCorreo(correo);
  if (!limpio) return { lista: actual, error: 'Escriba el correo de la persona.' };
  if (!esCorreoCompartible(limpio)) {
    return { lista: actual, error: 'Ese no parece un correo válido.' };
  }
  if (limpio === normalizarCorreo(correoPropio)) {
    return { lista: actual, error: 'El estudio ya es suyo: no hace falta compartirlo consigo mismo.' };
  }
  if (actual.includes(limpio)) {
    return { lista: actual, error: 'Ya tiene acceso a este estudio.' };
  }
  if (actual.length >= TOPE_COMPARTIDO) {
    return { lista: actual, error: `No se puede compartir con más de ${TOPE_COMPARTIDO} personas.` };
  }
  return { lista: [...actual, limpio], error: null };
}

/** Retira un correo de la lista de habilitados. */
export function quitarCompartido(lista, correo) {
  const limpio = normalizarCorreo(correo);
  return (lista || []).map(normalizarCorreo).filter(c => c && c !== limpio);
}

/**
 * Documento de `estudios`. `previo` es el documento que ya estaba en la nube: si
 * existe, se conserva su rastro de creación, porque las reglas lo exigen inmutable.
 *
 * `compartidoCon` viaja aparte del resto del estudio, en `opciones`: no es un dato del
 * informe sino un permiso, y quien edita el estudio no debería poder alterarlo sin
 * querer. Si no se pasa, se conserva el que ya tuviera el documento —así un guardado
 * normal no retira accesos concedidos antes.
 */
export function docEstudio({ study, usuario, previo = null, marcaDeTiempo, compartidoCon }) {
  const { nube } = separarEstudio(study);
  const nit = String(nube.nit || '').trim();
  const doc = {
    ent: String(nube.ent || 'Sin razón social').slice(0, 200),
    anio: anioValido(nube.anio) ?? new Date().getFullYear(),
    datos: nube,
    creadoPor: previo ? previo.creadoPor : usuario.uid,
    creadoEn: previo ? previo.creadoEn : marcaDeTiempo,
    actualizadoPor: usuario.uid,
    actualizadoEn: marcaDeTiempo,
  };
  if (nit) doc.nit = nit.slice(0, 30);
  const clienteNit = normalizarNit(nube.nit);
  if (clienteNit) doc.clienteNit = clienteNit.slice(0, 30);

  /* Lista de habilitados: la que se pase, o la que ya tenía el documento. Solo se
     escribe el campo si hay alguien, para no dejar arrays vacíos en documentos que
     nunca se compartieron. */
  const habilitados = (compartidoCon !== undefined ? compartidoCon : (previo && previo.compartidoCon)) || [];
  const limpios = [...new Set(habilitados.map(normalizarCorreo).filter(Boolean))].slice(0, TOPE_COMPARTIDO);
  if (limpios.length) doc.compartidoCon = limpios;
  /* El nombre solo se escribe si el proveedor lo entregó: las reglas lo comparan con
     el del token, y un valor inventado hace fallar la escritura entera. */
  if (usuario.nombre) doc.actualizadoPorNombre = usuario.nombre.slice(0, 120);
  if (previo && previo.creadoPorNombre) doc.creadoPorNombre = previo.creadoPorNombre;
  else if (!previo && usuario.nombre) doc.creadoPorNombre = usuario.nombre.slice(0, 120);
  return doc;
}

/**
 * Documento de `clientes`, con el contribuyente reutilizable entre años. Solo se
 * escriben los campos con contenido: un `''` sobrescribiría en la nube el dato bueno
 * que otro consultor ya había diligenciado.
 */
export function docCliente({ study, usuario, previo = null, marcaDeTiempo }) {
  const s = study || {};
  const nit = normalizarNit(s.nit);
  if (!nit || nit.length < 5) return null;
  const doc = {
    nit,
    razonSocial: String(s.ent || previo?.razonSocial || 'Sin razón social').slice(0, 200),
    creadoPor: previo ? previo.creadoPor : usuario.uid,
    creadoEn: previo ? previo.creadoEn : marcaDeTiempo,
    actualizadoPor: usuario.uid,
    actualizadoEn: marcaDeTiempo,
  };
  const opcionales = {
    ciiu: [s.ciiu, 20],
    objeto: [s.objeto, 4000],
    representante: [s.representante, 200],
    actividadEspecifica: [s.actividad_especifica, 4000],
  };
  Object.entries(opcionales).forEach(([campo, [valor, tope]]) => {
    const texto = String(valor || '').trim();
    if (texto) doc[campo] = texto.slice(0, tope);
    else if (previo && previo[campo]) doc[campo] = previo[campo];
  });
  if (usuario.nombre) doc.actualizadoPorNombre = usuario.nombre.slice(0, 120);
  if (previo && previo.creadoPorNombre) doc.creadoPorNombre = previo.creadoPorNombre;
  else if (!previo && usuario.nombre) doc.creadoPorNombre = usuario.nombre.slice(0, 120);
  return doc;
}

/**
 * Normaliza una comparable tal como la devuelve el lector de la documentación
 * comprobatoria. Descarta las que no traen nombre utilizable: una fila sin razón
 * social no identifica a ninguna empresa y ensuciaría el catálogo con documentos
 * imposibles de cruzar.
 */
export function normalizarComparableHistorica(cruda) {
  const nombre = String((cruda && (cruda.name || cruda.nombre)) || '').trim();
  if (!nombre) return null;
  const clave = nameKey(nombre);
  if (!clave) return null;
  const margen = aNumero(cruda.margen ?? cruda.margin);
  return {
    nombre: nombre.slice(0, 200),
    nameKey: clave.slice(0, 200),
    pais: String(cruda.pais || cruda.country || '').trim().slice(0, 80),
    actividad: String(cruda.actividad || cruda.desc || cruda.descripcion || '').trim().slice(0, 4000),
    pli: String(cruda.pli || cruda.indicador || '').trim().slice(0, 40),
    margen: margen !== null && margen >= -100 && margen <= 100 ? margen : null,
  };
}

/**
 * Fusiona lo que ya hay en el catálogo con lo que trae una carga nueva.
 *
 * Regla de fusión: lo que ya estaba no se pierde. Un dato nuevo solo reemplaza al
 * anterior si el anterior está vacío, porque la misma empresa aparece en estudios de
 * distintos años y la lectura de un documento puede ser más pobre que la de otro
 * —el margen de un año no invalida el del año pasado, y una actividad que la IA no
 * pudo leer no debe borrar la que sí se leyó antes.
 *
 * `apariciones` y `anios` acumulan sin repetir y con tope, que es lo que las reglas
 * pueden verificar (no saben iterar listas, así que el orden y la unicidad se
 * garantizan aquí).
 */
export function fusionarComparableHistorica({ existente, entrante, aparicion, usuario, marcaDeTiempo }) {
  const previo = existente || null;
  const anios = [...(previo?.anios || [])];
  if (aparicion && anioValido(aparicion.anio) && !anios.includes(aparicion.anio)) {
    anios.push(aparicion.anio);
  }
  anios.sort((a, b) => b - a);

  const apariciones = [...(previo?.apariciones || [])];
  if (aparicion) {
    const yaEsta = apariciones.some(a =>
      a && a.estudioId === aparicion.estudioId && a.anio === aparicion.anio && a.archivo === aparicion.archivo);
    if (!yaEsta) apariciones.push(aparicion);
  }

  const doc = {
    nombre: entrante.nombre || previo?.nombre || '',
    nameKey: entrante.nameKey,
    /* se recortan por la cola: la aparición más antigua es la que se sacrifica */
    apariciones: apariciones.slice(-TOPE_APARICIONES),
    creadoPor: previo ? previo.creadoPor : usuario.uid,
    creadoEn: previo ? previo.creadoEn : marcaDeTiempo,
    actualizadoPor: usuario.uid,
    actualizadoEn: marcaDeTiempo,
  };
  if (anios.length) doc.anios = anios.slice(0, TOPE_ANIOS);

  ['pais', 'actividad', 'pli'].forEach(campo => {
    const nuevo = String(entrante[campo] || '').trim();
    const viejo = String(previo?.[campo] || '').trim();
    const valor = viejo || nuevo;
    if (valor) doc[campo] = valor;
  });

  const margen = previo && previo.margen !== null && previo.margen !== undefined
    ? previo.margen
    : entrante.margen;
  if (margen !== null && margen !== undefined) doc.margen = margen;

  if (usuario.nombre) doc.actualizadoPorNombre = usuario.nombre.slice(0, 120);
  if (previo && previo.creadoPorNombre) doc.creadoPorNombre = previo.creadoPorNombre;
  else if (!previo && usuario.nombre) doc.creadoPorNombre = usuario.nombre.slice(0, 120);
  return doc;
}

/** Identificador del registro de estados financieros: una empresa por año gravable. */
export function idEeff(clave, anio) {
  return `${String(clave || '').slice(0, 200)}_${anio}`;
}

/**
 * Documento de `eeffComparables`. Las cifras ya leídas de un estado financiero se
 * guardan por empresa y año para no volver a pagar la lectura del PDF cuando la misma
 * comparable reaparece en otro estudio.
 */
export function docEeff({ comparable, anio, usuario, previo = null, marcaDeTiempo }) {
  const nombre = String(comparable.name || comparable.nombre || '').trim();
  const clave = comparable.nameKey || nameKey(nombre);
  const anioNum = anioValido(anio);
  if (!nombre || !clave || !anioNum) return null;

  const doc = {
    nameKey: clave.slice(0, 200),
    nombre: nombre.slice(0, 200),
    anio: anioNum,
    creadoPor: previo ? previo.creadoPor : usuario.uid,
    creadoEn: previo ? previo.creadoEn : marcaDeTiempo,
    actualizadoPor: usuario.uid,
    actualizadoEn: marcaDeTiempo,
  };

  /* Nombres de campo del gestor -> nombres del documento. Solo se escribe lo que es
     un número: un null explícito borraría una cifra ya guardada. */
  const cifras = {
    ingresos: comparable.s,
    costos: comparable.c,
    utilidadOperacional: comparable.op,
    cartera: comparable.ar,
    inventarios: comparable.inv,
    proveedores: comparable.ap,
  };
  Object.entries(cifras).forEach(([campo, valor]) => {
    const n = aNumero(valor);
    if (n !== null) doc[campo] = n;
    else if (previo && aNumero(previo[campo]) !== null) doc[campo] = previo[campo];
  });

  const fuente = String(comparable.eeffArchivo || comparable.fuente || '').trim();
  if (fuente) doc.fuente = fuente.slice(0, 300);
  else if (previo && previo.fuente) doc.fuente = previo.fuente;

  const hallazgos = comparable.eeffHallazgos || comparable.hallazgos;
  if (Array.isArray(hallazgos) && hallazgos.length) {
    doc.hallazgos = hallazgos.slice(0, 50).map(h => String(h).slice(0, 500));
  } else if (previo && Array.isArray(previo.hallazgos) && previo.hallazgos.length) {
    doc.hallazgos = previo.hallazgos;
  }

  if (usuario.nombre) doc.actualizadoPorNombre = usuario.nombre.slice(0, 120);
  if (previo && previo.creadoPorNombre) doc.creadoPorNombre = previo.creadoPorNombre;
  else if (!previo && usuario.nombre) doc.creadoPorNombre = usuario.nombre.slice(0, 120);
  return doc;
}

/* ══════════════ reutilización de estados financieros ══════════════ */

/**
 * Comparables del estudio que podrían completarse con cifras ya guardadas por otro
 * estudio del equipo.
 *
 * Solo propone las que NO tienen ingresos: una cifra ya cargada aquí manda sobre la
 * del catálogo, porque puede haberse corregido a mano o venir de un documento más
 * reciente. Nunca sobrescribe en silencio.
 */
export function comparablesConEeffReutilizable(comparables, guardados) {
  const disponibles = guardados || {};
  return (comparables || []).reduce((acum, fila, indice) => {
    if (!fila) return acum;
    const clave = fila.nameKey || nameKey(fila.name || '');
    if (!clave) return acum;
    const doc = disponibles[clave];
    if (!doc) return acum;
    if (aNumero(fila.s) !== null) return acum;
    if (aNumero(doc.ingresos) === null) return acum;
    acum.push({ indice, clave, nombre: fila.name || doc.nombre || '', doc });
    return acum;
  }, []);
}

/**
 * Vuelca en una fila las cifras guardadas de un año anterior. Devuelve el arreglo
 * nuevo, sin tocar el original, igual que hace la carga por documento.
 *
 * Queda marcada como reutilizada y con el archivo del que salió originalmente: en el
 * informe hay que poder sustentar de dónde viene cada cifra, y una traída del catálogo
 * no es lo mismo que una leída de un PDF cargado en este estudio.
 */
export function aplicarEeffGuardadoEnFila(filas, indice, doc) {
  const copia = [...(filas || [])];
  const fila = copia[indice];
  if (!fila || !doc) return copia;
  const cifra = (valor, actual) => (aNumero(valor) !== null ? aNumero(valor) : actual);
  copia[indice] = {
    ...fila,
    s: cifra(doc.ingresos, fila.s),
    c: cifra(doc.costos, fila.c),
    op: cifra(doc.utilidadOperacional, fila.op),
    ar: cifra(doc.cartera, fila.ar),
    inv: cifra(doc.inventarios, fila.inv),
    ap: cifra(doc.proveedores, fila.ap),
    eeffHallazgos: Array.isArray(doc.hallazgos) ? doc.hallazgos : (fila.eeffHallazgos || []),
    eeffArchivo: doc.fuente || fila.eeffArchivo || '',
    eeffReutilizado: { anio: doc.anio, fuente: doc.fuente || '', nombre: doc.nombre || '' },
    /* Se marca por confirmar a propósito: la cifra no se leyó en este estudio y quien
       firma el informe debe darla por buena antes de que entre al rango. */
    eeffPorConfirmar: true,
  };
  return copia;
}

/* ══════════════ consulta del catálogo histórico ══════════════ */

/** Años presentes en el catálogo, del más reciente al más antiguo, sin repetir. */
export function aniosDelCatalogo(items) {
  const vistos = new Set();
  (items || []).forEach(item => {
    (item && item.anios ? item.anios : []).forEach(a => {
      const n = anioValido(a);
      if (n) vistos.add(n);
    });
  });
  return [...vistos].sort((a, b) => b - a);
}

/**
 * Filtra el catálogo por texto libre y por año gravable. El texto busca en razón
 * social, país, actividad e indicador, sin acentos y sin distinguir mayúsculas: quien
 * busca «mexico» tiene que encontrar «México».
 */
export function filtrarCatalogo(items, { texto = '', anio = null } = {}) {
  const aguja = String(texto || '')
    .trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const anioNum = anioValido(anio);

  return (items || []).filter(item => {
    if (!item) return false;
    if (anioNum && !(item.anios || []).includes(anioNum)) return false;
    if (!aguja) return true;
    const pajar = [item.nombre, item.pais, item.actividad, item.pli]
      .map(v => String(v || '')).join(' ')
      .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    return pajar.includes(aguja);
  });
}

/**
 * Convierte entradas del catálogo en la forma que espera el motor para las
 * comparables del estudio anterior, que es lo que alimenta la continuidad.
 */
export function catalogoAComparablesPrevias(items) {
  return (items || [])
    .filter(item => item && item.nombre)
    .map(item => ({ name: item.nombre, pais: item.pais || '', actividad: item.actividad || '' }));
}

/**
 * Deja el rastro de modificación a nombre de quien migra un documento a su espacio.
 *
 * Hace falta porque las reglas exigen que el nombre escrito sea el del token de quien
 * escribe, y un documento del modelo compartido puede traer el de otra persona: cuando
 * la base era común, alguien creaba el estudio y otro lo modificaba, así que
 * `actualizadoPorNombre` quedaba con un nombre ajeno. Copiarlo tal cual hacía que
 * Firestore rechazara la escritura completa con `permission-denied`, sin decir qué campo
 * sobraba.
 *
 * El rastro de creación se conserva: la migración solo alcanza documentos cuyo
 * `creadoPor` es el propio uid, y su fecha original es justamente el dato a mantener.
 */
export function rastroPropio(datos, usuario) {
  const copia = { ...(datos || {}) };
  const nombre = (usuario && usuario.nombre) || '';
  copia.actualizadoPor = (usuario && usuario.uid) || '';
  if (nombre) copia.actualizadoPorNombre = nombre.slice(0, 120);
  else delete copia.actualizadoPorNombre;
  /* Si el nombre de creación no es el que hoy emite el proveedor —porque cambió, o
     porque lo escribió otra persona— se retira en lugar de arriesgar el rechazo: es un
     campo de conveniencia, y el uid de `creadoPor` es el dato de verdad. */
  if (copia.creadoPorNombre && copia.creadoPorNombre !== nombre) {
    delete copia.creadoPorNombre;
  }
  return copia;
}

/**
 * Lee el índice de estudios de localStorage y devuelve lo que hay que subir.
 * Se usa una sola vez por navegador, para que nadie pierda lo que tenía guardado
 * antes de que existiera la base.
 */
export function estudiosPorMigrar(indice, detallePorId) {
  const ids = Object.keys(indice || {});
  return ids
    .map(id => ({ id, resumen: indice[id], study: detallePorId[id] }))
    .filter(e => e.study && Object.keys(e.study).length > 0);
}
