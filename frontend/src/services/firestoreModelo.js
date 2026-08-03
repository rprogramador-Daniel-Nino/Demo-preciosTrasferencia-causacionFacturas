/* Forma de los documentos que van a Firestore, sin tocar el SDK.
   Está separado de `firestoreRepo.js` a propósito: aquí vive la lógica que decide
   qué se guarda y cómo se fusiona, y por eso es lo único de la capa de datos que se
   puede probar con `npm test`. El repositorio, que solo traduce esto a llamadas del
   SDK, se verifica en el navegador.

   Los nombres de campo son los que documenta y valida `firestore.rules`: cambiar uno
   aquí sin cambiarlo allá produce un `permission-denied` que no dice qué campo
   sobra, así que los dos archivos se leen juntos. */

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

/* Campos del estudio que NO viajan a la nube. Decisión del usuario: el universo de
   Capital IQ y el veredicto de la curación se quedan en el navegador. Son también los
   dos más pesados —el universo son miles de filas con descripción de negocio y el
   veredicto un dictamen por candidata—, así que dejarlos fuera es lo que mantiene el
   documento del estudio lejos del techo de 1 MiB de Firestore. */
export const CAMPOS_SOLO_LOCALES = ['universo', 'iaMatch'];

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

/**
 * Documento de `estudios`. `previo` es el documento que ya estaba en la nube: si
 * existe, se conserva su rastro de creación, porque las reglas lo exigen inmutable y
 * porque el estudio pudo crearlo otra persona.
 */
export function docEstudio({ study, usuario, previo = null, marcaDeTiempo }) {
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
