/* Acceso a Firestore. Traduce a llamadas del SDK las decisiones que toma
   `firestoreModelo.js`; aquí no hay reglas de negocio, para que lo que sí las tiene
   quede cubierto por `npm test`.

   Cuidado con el costo: cada `getDoc` y cada `setDoc` se factura. Dos medidas
   deliberadas contra eso:

   1. El rastro de creación de cada documento (`creadoPor`, `creadoEn`) se guarda en
      un caché en memoria la primera vez que se lee o se escribe. Las reglas lo exigen
      inmutable, así que sin caché haría falta un `getDoc` antes de cada guardado, y
      el autoguardado del gestor dispara en cada cambio del estudio.
   2. El autoguardado llega con retardo desde `App.jsx`. Sin él, escribir una razón
      social letra por letra serían veinte escrituras del mismo documento. */

import {
  doc, getDoc, getDocs, setDoc, deleteDoc, collection, query, orderBy, where,
  limit, serverTimestamp, runTransaction,
} from 'firebase/firestore';
import { db } from './firebase';
import {
  docEstudio, docCliente, docEeff, idEeff, normalizarNit, anioValido, aNumero,
  normalizarComparableHistorica, fusionarComparableHistorica, separarEstudio,
  verificarTamano,
} from './firestoreModelo';

const ESTUDIOS = 'estudios';
const CLIENTES = 'clientes';
const COMPARABLES = 'comparablesHistoricas';
const EEFF = 'eeffComparables';

/* Rastro de creación por documento ya visto en esta sesión: { 'estudios/x': {...} } */
const cacheMeta = new Map();

const claveCache = (coleccion, id) => `${coleccion}/${id}`;

function recordarMeta(coleccion, id, datos) {
  if (!datos) return;
  cacheMeta.set(claveCache(coleccion, id), {
    creadoPor: datos.creadoPor,
    creadoEn: datos.creadoEn,
    creadoPorNombre: datos.creadoPorNombre,
  });
}

/**
 * Rastro de creación conocido, o el que traiga la nube si es la primera vez. Devuelve
 * null cuando el documento no existe todavía.
 */
async function metaPrevia(coleccion, id) {
  const enCache = cacheMeta.get(claveCache(coleccion, id));
  if (enCache) return enCache;
  const instantanea = await getDoc(doc(db, coleccion, id));
  if (!instantanea.exists()) return null;
  recordarMeta(coleccion, id, instantanea.data());
  return cacheMeta.get(claveCache(coleccion, id));
}

/** Datos del usuario que las reglas esperan ver en los documentos. */
export function usuarioDeSesion(user) {
  if (!user) return null;
  return { uid: user.uid, nombre: user.displayName || '', correo: user.email || '' };
}

/* ══════════════════════ estudios ══════════════════════ */

export async function guardarEstudio(id, study, usuario) {
  const previo = await metaPrevia(ESTUDIOS, id);
  const documento = docEstudio({ study, usuario, previo, marcaDeTiempo: serverTimestamp() });
  /* Antes de gastar la escritura: si excede el máximo, el error explica qué campo lo
     hace pesar. Firestore solo dice cuánto pesa, y con decenas de campos eso no basta
     para saber qué sacar. */
  verificarTamano(documento);
  await setDoc(doc(db, ESTUDIOS, id), documento);
  /* Se recuerda con lo que ya había: `serverTimestamp()` es un centinela, no una
     fecha, y guardarlo en el caché haría fallar la comparación de inmutabilidad en
     el guardado siguiente. Si el documento es nuevo, la fecha real se leerá cuando
     alguien lo abra. */
  if (previo) recordarMeta(ESTUDIOS, id, { ...previo });
  return id;
}

export async function leerEstudio(id) {
  const instantanea = await getDoc(doc(db, ESTUDIOS, id));
  if (!instantanea.exists()) return null;
  const datos = instantanea.data();
  recordarMeta(ESTUDIOS, id, datos);
  return datos.datos || {};
}

/** Índice para el tablero: lo mínimo para listar, sin traer los estudios completos. */
export async function listarEstudios(tope = 200) {
  const consulta = query(collection(db, ESTUDIOS), orderBy('actualizadoEn', 'desc'), limit(tope));
  const instantanea = await getDocs(consulta);
  return instantanea.docs.map(d => {
    const datos = d.data();
    recordarMeta(ESTUDIOS, d.id, datos);
    return {
      id: d.id,
      ent: datos.ent || 'Sin razón social',
      nit: datos.nit || '—',
      anio: datos.anio || '—',
      actualizadoPorNombre: datos.actualizadoPorNombre || '',
      /* El tablero suma los ingresos de la parte examinada. Se toma de `datos`, que ya
         viene en la respuesta —Firestore cobra por documento leído, no por campo—, en
         vez de duplicar la cifra en un campo propio que habría que mantener al día. */
      monto: Number((datos.datos && datos.datos.t_s) || 0) || 0,
      /* Timestamp de Firestore -> milisegundos, que es lo que ya consumía el tablero.
         Puede venir null si se lee justo después de escribir, antes de que el
         servidor resuelva el centinela. */
      updated: datos.actualizadoEn ? datos.actualizadoEn.toMillis() : 0,
    };
  });
}

export async function borrarEstudio(id) {
  await deleteDoc(doc(db, ESTUDIOS, id));
  cacheMeta.delete(claveCache(ESTUDIOS, id));
}

/* ══════════════════════ clientes ══════════════════════ */

/** Guarda o completa el contribuyente del estudio. Devuelve el NIT normalizado. */
export async function guardarCliente(study, usuario) {
  const nit = normalizarNit(study && study.nit);
  if (!nit || nit.length < 5) return null;
  const instantanea = await getDoc(doc(db, CLIENTES, nit));
  const previo = instantanea.exists() ? instantanea.data() : null;
  const documento = docCliente({ study, usuario, previo, marcaDeTiempo: serverTimestamp() });
  if (!documento) return null;
  await setDoc(doc(db, CLIENTES, nit), documento);
  return nit;
}

export async function listarClientes(tope = 500) {
  const consulta = query(collection(db, CLIENTES), orderBy('razonSocial'), limit(tope));
  const instantanea = await getDocs(consulta);
  return instantanea.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function leerCliente(nit) {
  const clave = normalizarNit(nit);
  if (!clave) return null;
  const instantanea = await getDoc(doc(db, CLIENTES, clave));
  return instantanea.exists() ? { id: instantanea.id, ...instantanea.data() } : null;
}

/** Estudios de un mismo contribuyente, del más reciente al más antiguo. */
export async function estudiosDelCliente(nit, tope = 20) {
  const clave = normalizarNit(nit);
  if (!clave) return [];
  const consulta = query(
    collection(db, ESTUDIOS), where('clienteNit', '==', clave), orderBy('anio', 'desc'), limit(tope)
  );
  const instantanea = await getDocs(consulta);
  return instantanea.docs.map(d => ({ id: d.id, ent: d.data().ent, anio: d.data().anio }));
}

/* ══════════════ comparables históricas (el catálogo) ══════════════ */

/**
 * Registra en el catálogo las empresas leídas de la documentación comprobatoria de un
 * año anterior. Cada una se fusiona con lo que ya hubiera: la misma empresa vista en
 * varios estudios es un solo documento, con el rastro de todas sus apariciones.
 *
 * Va en transacción por documento porque la fusión necesita leer antes de escribir y
 * dos consultores pueden cargar informes distintos a la vez. Devuelve un resumen para
 * poder decir en pantalla qué se guardó y qué se descartó.
 */
export async function registrarComparablesHistoricas({ comparables, aparicion, usuario }) {
  const normalizadas = (comparables || [])
    .map(normalizarComparableHistorica)
    .filter(Boolean);

  /* Dos filas del mismo informe pueden ser la misma empresa escrita distinto; se
     unifican antes de escribir para no pelear con la transacción de la otra. */
  const porClave = new Map();
  normalizadas.forEach(c => { if (!porClave.has(c.nameKey)) porClave.set(c.nameKey, c); });

  const resumen = { guardadas: 0, nuevas: 0, actualizadas: 0, descartadas: (comparables || []).length - normalizadas.length, fallidas: 0 };

  for (const entrante of porClave.values()) {
    const referencia = doc(db, COMPARABLES, entrante.nameKey);
    try {
      const eraNueva = await runTransaction(db, async (tx) => {
        const instantanea = await tx.get(referencia);
        const existente = instantanea.exists() ? instantanea.data() : null;
        const documento = fusionarComparableHistorica({
          existente, entrante, aparicion, usuario, marcaDeTiempo: serverTimestamp(),
        });
        tx.set(referencia, documento);
        return !existente;
      });
      resumen.guardadas++;
      if (eraNueva) resumen.nuevas++; else resumen.actualizadas++;
    } catch (err) {
      resumen.fallidas++;
      console.error('[catálogo histórico] no se pudo guardar ' + entrante.nombre, err);
    }
  }
  return resumen;
}

export async function listarComparablesHistoricas(tope = 500) {
  const consulta = query(collection(db, COMPARABLES), orderBy('nombre'), limit(tope));
  const instantanea = await getDocs(consulta);
  return instantanea.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** Las que se usaron en un año gravable concreto. */
export async function comparablesHistoricasDelAnio(anio, tope = 500) {
  const n = anioValido(anio);
  if (!n) return [];
  const consulta = query(
    collection(db, COMPARABLES), where('anios', 'array-contains', n), orderBy('nombre'), limit(tope)
  );
  const instantanea = await getDocs(consulta);
  return instantanea.docs.map(d => ({ id: d.id, ...d.data() }));
}

/* ══════════════ estados financieros de comparables ══════════════ */

/**
 * Guarda las cifras ya leídas de las comparables con estado financiero cargado. Solo
 * sube las que traen ingresos: sin esa cifra no hay nada aprovechable que reutilizar.
 */
export async function guardarEeffComparables({ comparables, anio, usuario }) {
  const resumen = { guardadas: 0, omitidas: 0, fallidas: 0 };
  for (const comparable of comparables || []) {
    if (aNumero(comparable && comparable.s) === null) { resumen.omitidas++; continue; }
    const clave = comparable.nameKey || '';
    const anioNum = anioValido(anio);
    const id = idEeff(clave || comparable.name, anioNum);
    try {
      const instantanea = await getDoc(doc(db, EEFF, id));
      const previo = instantanea.exists() ? instantanea.data() : null;
      const documento = docEeff({ comparable, anio: anioNum, usuario, previo, marcaDeTiempo: serverTimestamp() });
      if (!documento) { resumen.omitidas++; continue; }
      await setDoc(doc(db, EEFF, id), documento);
      resumen.guardadas++;
    } catch (err) {
      resumen.fallidas++;
      console.error('[EEFF] no se pudo guardar ' + (comparable.name || id), err);
    }
  }
  return resumen;
}

/** Cifras ya cargadas de una empresa, por año. Devuelve un mapa clave -> documento. */
export async function leerEeffDeComparables(claves, anio) {
  const anioNum = anioValido(anio);
  const encontrados = {};
  if (!anioNum) return encontrados;
  for (const clave of claves || []) {
    if (!clave) continue;
    const instantanea = await getDoc(doc(db, EEFF, idEeff(clave, anioNum)));
    if (instantanea.exists()) encontrados[clave] = instantanea.data();
  }
  return encontrados;
}

/* ══════════════════════ migración ══════════════════════ */

const MARCA_MIGRACION = 'pt:migracion:firestore';

/**
 * Sube a la nube los estudios que ya estaban en localStorage. Se ejecuta una vez por
 * navegador —queda una marca— y no borra nada del almacenamiento local: si algo sale
 * mal, el original sigue ahí.
 */
export async function migrarDesdeLocalStorage(usuario, { guardarLocales } = {}) {
  if (localStorage.getItem(MARCA_MIGRACION)) return { yaHecha: true, subidos: 0, fallidos: 0 };

  const crudo = localStorage.getItem('pt:study:index');
  const indice = crudo ? JSON.parse(crudo) : {};
  const ids = Object.keys(indice);
  const resultado = { yaHecha: false, subidos: 0, fallidos: 0, total: ids.length, errores: [] };

  for (const id of ids) {
    const detalle = localStorage.getItem(`pt:study:${id}`);
    if (!detalle) continue;
    try {
      const study = JSON.parse(detalle);
      /* Los campos que se quedan en el navegador se separan aquí para que el documento
         de la nube no los lleve. El veredicto de la curación va a localStorage y el
         resto —las páginas del ANEXO A— lo coloca quien llame, que es el que sabe de
         IndexedDB; así este módulo no necesita conocer ese almacén. */
      const { local } = separarEstudio(study);
      if (local.iaMatch) localStorage.setItem(`pt:iaMatch:${id}`, JSON.stringify(local.iaMatch));
      if (typeof guardarLocales === 'function') await guardarLocales(id, local);
      await guardarEstudio(id, study, usuario);
      await guardarCliente(study, usuario);
      resultado.subidos++;
    } catch (err) {
      resultado.fallidos++;
      resultado.errores.push(`${id}: ${err && err.message ? err.message : 'error desconocido'}`);
      console.error('[migración] falló el estudio ' + id, err);
    }
  }

  /* La marca solo se pone si no quedó nada pendiente: con un fallo a medias, el
     siguiente arranque vuelve a intentarlo en lugar de dar por buena una migración
     incompleta. Volver a subir un estudio ya subido es inofensivo. */
  if (!resultado.fallidos) localStorage.setItem(MARCA_MIGRACION, new Date().toISOString());
  return resultado;
}
