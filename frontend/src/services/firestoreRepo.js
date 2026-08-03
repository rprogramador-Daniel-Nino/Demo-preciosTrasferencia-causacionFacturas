/* Acceso a Firestore. Traduce a llamadas del SDK las decisiones que toma
   `firestoreModelo.js`; aquí no hay reglas de negocio, para que lo que sí las tiene
   quede cubierto por `npm test`.

   Todo vive bajo `usuarios/{uid}/…`: cada consultor tiene sus estudios, sus clientes,
   su catálogo y sus estados financieros, y nadie ve lo de otro. Antes eran colecciones
   comunes y el equipo se pisaba —un estudio creado por una persona aparecía modificado
   por otra—, además de que los identificadores derivados del dato (el NIT en
   `clientes`, la razón social normalizada en `comparablesHistoricas`) hacían que dos
   personas pelearan por el mismo documento.

   Por eso cada función necesita saber de quién es el espacio: el `usuario` no es
   opcional en ninguna, y sin él se lanza en lugar de escribir en una ruta a medias.

   Cuidado con el costo: cada `getDoc` y cada `setDoc` se factura. Dos medidas
   deliberadas contra eso:

   1. El rastro de creación de cada documento (`creadoPor`, `creadoEn`) se guarda en
      un caché en memoria la primera vez que se lee o se escribe. Las reglas lo exigen
      inmutable, así que sin caché haría falta un `getDoc` antes de cada guardado, y
      el autoguardado del gestor dispara en cada cambio del estudio.
   2. El autoguardado llega con retardo desde `App.jsx`. Sin él, escribir una razón
      social letra por letra serían veinte escrituras del mismo documento. */

import {
  doc, getDoc, getDocs, setDoc, deleteDoc, collection, collectionGroup, query,
  orderBy, where, limit, serverTimestamp, runTransaction,
} from 'firebase/firestore';
import { db } from './firebase';
import { montoOperacion } from '../utils/calculations';
import {
  docEstudio, docCliente, docEeff, idEeff, normalizarNit, anioValido, aNumero,
  normalizarComparableHistorica, fusionarComparableHistorica, separarEstudio,
  verificarTamano, agregarCompartido, quitarCompartido, rastroPropio,
} from './firestoreModelo';

const ESTUDIOS = 'estudios';
const CLIENTES = 'clientes';
const COMPARABLES = 'comparablesHistoricas';
const EEFF = 'eeffComparables';

/* Colecciones del modelo compartido anterior, para la migración. */
const COLECCIONES_MIGRABLES = [ESTUDIOS, CLIENTES, COMPARABLES, EEFF];

/** Identificador del dueño del espacio, exigido de forma explícita. */
function uidDe(usuario) {
  const uid = usuario && usuario.uid;
  if (!uid) {
    throw new Error('Falta la sesión: no se puede acceder a los datos sin saber de quién son.');
  }
  return uid;
}

const coleccion = (usuario, nombre) => collection(db, 'usuarios', uidDe(usuario), nombre);
const documento = (usuario, nombre, id) => doc(db, 'usuarios', uidDe(usuario), nombre, id);

/* Rastro de creación por documento ya visto en esta sesión. La clave incluye el uid
   porque dos consultores pueden tener un estudio con el mismo identificador. */
const cacheMeta = new Map();

const claveCache = (uid, nombre, id) => `${uid}/${nombre}/${id}`;

function recordarMeta(uid, nombre, id, datos) {
  if (!datos) return;
  cacheMeta.set(claveCache(uid, nombre, id), {
    creadoPor: datos.creadoPor,
    creadoEn: datos.creadoEn,
    creadoPorNombre: datos.creadoPorNombre,
  });
}

/**
 * Rastro de creación conocido, o el que traiga la nube si es la primera vez. Devuelve
 * null cuando el documento no existe todavía.
 */
async function metaPrevia(usuario, nombre, id) {
  const uid = uidDe(usuario);
  const enCache = cacheMeta.get(claveCache(uid, nombre, id));
  if (enCache) return enCache;
  const instantanea = await getDoc(documento(usuario, nombre, id));
  if (!instantanea.exists()) return null;
  recordarMeta(uid, nombre, id, instantanea.data());
  return cacheMeta.get(claveCache(uid, nombre, id));
}

/** Datos del usuario que las reglas esperan ver en los documentos. */
export function usuarioDeSesion(user) {
  if (!user) return null;
  return { uid: user.uid, nombre: user.displayName || '', correo: user.email || '' };
}

/* ══════════════════════ estudios ══════════════════════ */

export async function guardarEstudio(id, study, usuario) {
  const previo = await metaPrevia(usuario, ESTUDIOS, id);
  const documentoNuevo = docEstudio({ study, usuario, previo, marcaDeTiempo: serverTimestamp() });
  /* Antes de gastar la escritura: si excede el máximo, el error explica qué campo lo
     hace pesar. Firestore solo dice cuánto pesa, y con decenas de campos eso no basta
     para saber qué sacar. */
  verificarTamano(documentoNuevo);
  await setDoc(documento(usuario, ESTUDIOS, id), documentoNuevo);
  /* Se recuerda con lo que ya había: `serverTimestamp()` es un centinela, no una
     fecha, y guardarlo en el caché haría fallar la comparación de inmutabilidad en
     el guardado siguiente. */
  if (previo) recordarMeta(uidDe(usuario), ESTUDIOS, id, { ...previo });
  return id;
}

export async function leerEstudio(id, usuario) {
  const instantanea = await getDoc(documento(usuario, ESTUDIOS, id));
  if (!instantanea.exists()) return null;
  const datos = instantanea.data();
  recordarMeta(uidDe(usuario), ESTUDIOS, id, datos);
  return datos.datos || {};
}

/** Índice para el tablero: solo los estudios del consultor en sesión. */
export async function listarEstudios(usuario, tope = 200) {
  const consulta = query(coleccion(usuario, ESTUDIOS), orderBy('actualizadoEn', 'desc'), limit(tope));
  const instantanea = await getDocs(consulta);
  const uid = uidDe(usuario);
  return instantanea.docs.map(d => {
    const datos = d.data();
    recordarMeta(uid, ESTUDIOS, d.id, datos);
    return {
      id: d.id,
      ent: datos.ent || 'Sin razón social',
      nit: datos.nit || '—',
      anio: datos.anio || '—',
      actualizadoPorNombre: datos.actualizadoPorNombre || '',
      /* El monto de operaciones con vinculados, que es lo que anuncia la columna del
         tablero. Se lee de `datos`, que ya viene en la respuesta —Firestore cobra por
         documento leído, no por campo—, en vez de duplicar la cifra en un campo propio. */
      monto: montoOperacion(datos.datos) || 0,
      /* Timestamp de Firestore -> milisegundos, que es lo que ya consumía el tablero.
         Puede venir null si se lee justo después de escribir, antes de que el
         servidor resuelva el centinela. */
      updated: datos.actualizadoEn ? datos.actualizadoEn.toMillis() : 0,
    };
  });
}

export async function borrarEstudio(id, usuario) {
  await deleteDoc(documento(usuario, ESTUDIOS, id));
  cacheMeta.delete(claveCache(uidDe(usuario), ESTUDIOS, id));
}

/* ══════════════════════ compartir un estudio ══════════════════════ */

/** Con quiénes está compartido hoy este estudio. Lista de correos, o vacía. */
export async function leerCompartidoCon(id, usuario) {
  const instantanea = await getDoc(documento(usuario, ESTUDIOS, id));
  if (!instantanea.exists()) return [];
  return instantanea.data().compartidoCon || [];
}

/**
 * Habilita o retira a una persona en un estudio. Devuelve la lista resultante, o el
 * motivo por el que no se pudo.
 *
 * Se escribe con transacción y no con el estudio en memoria: el permiso no es un dato
 * del informe, y un autoguardado disparado a la vez no debe poder pisar la lista de
 * accesos ni al contrario.
 */
export async function cambiarCompartido(id, correo, usuario, { quitar = false } = {}) {
  const referencia = documento(usuario, ESTUDIOS, id);
  try {
    return await runTransaction(db, async (tx) => {
      const instantanea = await tx.get(referencia);
      if (!instantanea.exists()) return { error: 'El estudio no existe en la nube todavía.' };
      const datos = instantanea.data();
      const actuales = datos.compartidoCon || [];

      let lista, error = null;
      if (quitar) {
        lista = quitarCompartido(actuales, correo);
      } else {
        const resultado = agregarCompartido(actuales, correo, { correoPropio: usuario.correo });
        lista = resultado.lista;
        error = resultado.error;
      }
      if (error) return { error, lista: actuales };

      const documentoNuevo = docEstudio({
        /* `datos.datos` es el estudio tal como está en la nube: se reescribe igual, y
           solo cambia la lista. Tomarlo de la memoria del navegador podría subir una
           versión distinta de la que hay guardada. */
        study: datos.datos || {},
        usuario,
        previo: datos,
        marcaDeTiempo: serverTimestamp(),
        compartidoCon: lista,
      });
      tx.set(referencia, documentoNuevo);
      return { lista, error: null };
    });
  } catch (err) {
    console.error('[compartir] no se pudo cambiar el acceso de ' + id, err);
    return { error: (err && err.message) || 'No se pudo cambiar el acceso.' };
  }
}

/**
 * Estudios que otras personas compartieron con quien está en sesión.
 *
 * Va por grupo de colecciones porque están dentro del espacio de cada dueño y aquí no
 * se sabe de quién: la consulta recorre todas las subcolecciones `estudios` y las
 * reglas solo devuelven aquellas cuya lista incluye el correo del solicitante.
 */
export async function listarEstudiosCompartidosConmigo(usuario, tope = 100) {
  const correo = String((usuario && usuario.correo) || '').toLowerCase();
  if (!correo) return [];
  try {
    /* El `orderBy` no es solo presentación: junto con `array-contains` es lo que hace
       que la consulta use el índice de grupo declarado en firestore.indexes.json. Sin
       ordenar haría falta además un índice de campo único con ámbito de grupo, que es
       otro despliegue. Y de paso los más recientes quedan arriba. */
    const consulta = query(
      collectionGroup(db, ESTUDIOS),
      where('compartidoCon', 'array-contains', correo),
      orderBy('actualizadoEn', 'desc'),
      limit(tope)
    );
    const instantanea = await getDocs(consulta);
    return instantanea.docs.map(d => {
      const datos = d.data();
      return {
        id: d.id,
        /* El uid del dueño sale de la ruta: usuarios/{uid}/estudios/{id} */
        duenoUid: d.ref.parent.parent ? d.ref.parent.parent.id : '',
        ent: datos.ent || 'Sin razón social',
        nit: datos.nit || '—',
        anio: datos.anio || '—',
        duenoNombre: datos.creadoPorNombre || '',
        monto: montoOperacion(datos.datos) || 0,
        updated: datos.actualizadoEn ? datos.actualizadoEn.toMillis() : 0,
      };
    });
  } catch (err) {
    /* Se relanza con el motivo traducido para que la pantalla lo diga: los dos fallos
       posibles se arreglan con un despliegue distinto, y «no se pudieron leer» a secas
       obliga a abrir la consola para averiguar cuál. */
    if (esSinPermiso(err)) {
      throw new Error(
        'Las reglas todavía no permiten la consulta de estudios compartidos. ' +
        'Hay que desplegar firestore.rules.'
      );
    }
    if (err && err.code === 'failed-precondition') {
      throw new Error(
        'Falta el índice de grupo de colecciones para los estudios compartidos. ' +
        'Hay que desplegar firestore.indexes.json.'
      );
    }
    throw err;
  }
}

/** Lee un estudio que otra persona compartió. Solo lectura: no se cachea su rastro. */
export async function leerEstudioCompartido(duenoUid, id) {
  if (!duenoUid || !id) return null;
  const instantanea = await getDoc(doc(db, 'usuarios', duenoUid, ESTUDIOS, id));
  if (!instantanea.exists()) return null;
  return instantanea.data().datos || {};
}

/* ══════════════════════ clientes ══════════════════════ */

/** Guarda o completa el contribuyente del estudio. Devuelve el NIT normalizado. */
export async function guardarCliente(study, usuario) {
  const nit = normalizarNit(study && study.nit);
  if (!nit || nit.length < 5) return null;
  const instantanea = await getDoc(documento(usuario, CLIENTES, nit));
  const previo = instantanea.exists() ? instantanea.data() : null;
  const documentoNuevo = docCliente({ study, usuario, previo, marcaDeTiempo: serverTimestamp() });
  if (!documentoNuevo) return null;
  await setDoc(documento(usuario, CLIENTES, nit), documentoNuevo);
  return nit;
}

export async function listarClientes(usuario, tope = 500) {
  const consulta = query(coleccion(usuario, CLIENTES), orderBy('razonSocial'), limit(tope));
  const instantanea = await getDocs(consulta);
  return instantanea.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function leerCliente(nit, usuario) {
  const clave = normalizarNit(nit);
  if (!clave) return null;
  const instantanea = await getDoc(documento(usuario, CLIENTES, clave));
  return instantanea.exists() ? { id: instantanea.id, ...instantanea.data() } : null;
}

/** Estudios de un mismo contribuyente, del más reciente al más antiguo. */
export async function estudiosDelCliente(nit, usuario, tope = 20) {
  const clave = normalizarNit(nit);
  if (!clave) return [];
  const consulta = query(
    coleccion(usuario, ESTUDIOS), where('clienteNit', '==', clave), orderBy('anio', 'desc'), limit(tope)
  );
  const instantanea = await getDocs(consulta);
  return instantanea.docs.map(d => ({ id: d.id, ent: d.data().ent, anio: d.data().anio }));
}

/* ══════════════ comparables históricas (el catálogo) ══════════════ */

/**
 * Registra en el catálogo del consultor las empresas leídas de la documentación
 * comprobatoria de un año anterior. Cada una se fusiona con lo que ya hubiera: la
 * misma empresa vista en varios de sus estudios es un solo documento, con el rastro de
 * todas sus apariciones.
 *
 * Va en transacción por documento porque la fusión necesita leer antes de escribir.
 * Devuelve un resumen para poder decir en pantalla qué se guardó y qué se descartó.
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
    const referencia = documento(usuario, COMPARABLES, entrante.nameKey);
    try {
      const eraNueva = await runTransaction(db, async (tx) => {
        const instantanea = await tx.get(referencia);
        const existente = instantanea.exists() ? instantanea.data() : null;
        const documentoNuevo = fusionarComparableHistorica({
          existente, entrante, aparicion, usuario, marcaDeTiempo: serverTimestamp(),
        });
        tx.set(referencia, documentoNuevo);
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

export async function listarComparablesHistoricas(usuario, tope = 500) {
  const consulta = query(coleccion(usuario, COMPARABLES), orderBy('nombre'), limit(tope));
  const instantanea = await getDocs(consulta);
  return instantanea.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** Las que se usaron en un año gravable concreto. */
export async function comparablesHistoricasDelAnio(anio, usuario, tope = 500) {
  const n = anioValido(anio);
  if (!n) return [];
  const consulta = query(
    coleccion(usuario, COMPARABLES), where('anios', 'array-contains', n), orderBy('nombre'), limit(tope)
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
      const instantanea = await getDoc(documento(usuario, EEFF, id));
      const previo = instantanea.exists() ? instantanea.data() : null;
      const documentoNuevo = docEeff({ comparable, anio: anioNum, usuario, previo, marcaDeTiempo: serverTimestamp() });
      if (!documentoNuevo) { resumen.omitidas++; continue; }
      await setDoc(documento(usuario, EEFF, id), documentoNuevo);
      resumen.guardadas++;
    } catch (err) {
      resumen.fallidas++;
      console.error('[EEFF] no se pudo guardar ' + (comparable.name || id), err);
    }
  }
  return resumen;
}

/** Cifras ya cargadas de una empresa, por año. Devuelve un mapa clave -> documento. */
export async function leerEeffDeComparables(claves, anio, usuario) {
  const anioNum = anioValido(anio);
  const encontrados = {};
  if (!anioNum) return encontrados;
  for (const clave of claves || []) {
    if (!clave) continue;
    const instantanea = await getDoc(documento(usuario, EEFF, idEeff(clave, anioNum)));
    if (instantanea.exists()) encontrados[clave] = instantanea.data();
  }
  return encontrados;
}

/* ══════════════════════ migraciones ══════════════════════ */

const MARCA_MIGRACION = 'pt:migracion:firestore';

/**
 * Sube al espacio del consultor los estudios que ya estaban en localStorage. Se
 * ejecuta una vez por navegador —queda una marca— y no borra nada del almacenamiento
 * local: si algo sale mal, el original sigue ahí.
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

/**
 * Traslada al espacio privado del consultor lo que él mismo creó cuando las
 * colecciones eran comunes al equipo.
 *
 * Solo alcanza a sus propios documentos: la consulta filtra por `creadoPor` y las
 * reglas, además, no le dejarían leer los de otro. Cada consultor recupera lo suyo la
 * primera vez que entra, y lo que otro creó lo recupera esa otra persona.
 *
 * El documento se copia y solo entonces se borra del sitio viejo: si la copia falla, no
 * se pierde nada y el siguiente arranque vuelve a intentarlo.
 */
/** `permission-denied` tal como lo emite el SDK web, y con el prefijo del servicio por
    si alguna versión lo entrega así. Ver una sola vez cuál llega no basta: el código es
    lo único que distingue «las reglas no lo permiten» de un fallo de red. */
const esSinPermiso = (err) =>
  !!err && (err.code === 'permission-denied' || err.code === 'firestore/permission-denied');

export async function migrarDesdeRaiz(usuario) {
  const uid = uidDe(usuario);
  const resumen = { movidos: 0, fallidos: 0, sinPermiso: false, porColeccion: {} };

  for (const nombre of COLECCIONES_MIGRABLES) {
    const cuenta = { movidos: 0, fallidos: 0 };
    try {
      const consulta = query(collection(db, nombre), where('creadoPor', '==', uid), limit(500));
      const instantanea = await getDocs(consulta);
      for (const d of instantanea.docs) {
        try {
          await setDoc(doc(db, 'usuarios', uid, nombre, d.id), rastroPropio(d.data(), usuario));
          await deleteDoc(d.ref);
          cuenta.movidos++;
        } catch (err) {
          cuenta.fallidos++;
          /* `permission-denied` aquí no es cosa de este documento: significa que las
             reglas del espacio privado no están desplegadas todavía, así que van a
             fallar todos. Se corta y se informa una vez, en lugar de dejar un error por
             documento en la consola —cientos de líneas para una única causa. */
          if (esSinPermiso(err)) {
            resumen.sinPermiso = true;
            console.warn(
              '[migración privada] las reglas del espacio privado no están desplegadas: ' +
              'no se movió nada. Al desplegarlas, la migración se reintenta al abrir la aplicación.'
            );
            resumen.porColeccion[nombre] = cuenta;
            resumen.fallidos += cuenta.fallidos;
            return resumen;
          }
          console.error(`[migración privada] no se pudo mover ${nombre}/${d.id}`, err);
        }
      }
    } catch (err) {
      /* Sin permiso de lectura o sin la colección: no hay nada que mover y no es un
         fallo que deba impedir entrar a la aplicación. */
      if (esSinPermiso(err)) resumen.sinPermiso = true;
      console.warn(`[migración privada] no se pudo revisar ${nombre}`, err && err.code ? err.code : err);
    }
    resumen.porColeccion[nombre] = cuenta;
    resumen.movidos += cuenta.movidos;
    resumen.fallidos += cuenta.fallidos;
  }

  return resumen;
}
