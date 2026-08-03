import { test } from 'node:test';
import assert from 'node:assert';
import {
  hashPlantilla, guardarRecursos, guardarAnexoEeff, guardarVinculo, guardarPlantilla,
  leerRecursos, leerAnexoEeff, leerVinculo, leerPlantilla, borrarRecursosDelEstudio,
} from './plantillaStore.js';

/* IndexedDB no existe en node: se simula el mínimo que usa el módulo —abrir, una
   transacción por operación, y put/get/delete sobre el almacén—, con los eventos en
   `setImmediate` para respetar el orden real: el código asigna `oncomplete` después de
   pedir la operación. `fallarEn` permite comprobar que un borrado caído no impide los
   demás. */
function conIndexedDBSimulado(fn, { fallarEn = null } = {}) {
  const almacenes = { plantillas: new Map(), recursos: new Map(), anexos: new Map() };
  const previo = global.indexedDB;

  global.indexedDB = {
    open() {
      const solicitud = {};
      setImmediate(() => {
        solicitud.result = {
          objectStoreNames: { contains: (nombre) => nombre in almacenes },
          createObjectStore(nombre) { almacenes[nombre] = almacenes[nombre] || new Map(); },
          transaction(nombre) {
            const tx = {
              objectStore: () => ({
                put(valor, clave) { almacenes[nombre].set(clave, valor); return {}; },
                get(clave) { return { result: almacenes[nombre].get(clave) }; },
                delete(clave) { almacenes[nombre].delete(clave); return {}; },
              }),
            };
            setImmediate(() => {
              if (fallarEn === nombre) {
                tx.error = new Error('fallo simulado en ' + nombre);
                if (tx.onerror) tx.onerror();
              } else if (tx.oncomplete) tx.oncomplete();
            });
            return tx;
          },
          close() {},
        };
        if (solicitud.onsuccess) solicitud.onsuccess();
      });
      return solicitud;
    },
  };

  return Promise.resolve(fn(almacenes)).finally(() => {
    if (previo) global.indexedDB = previo; else delete global.indexedDB;
  });
}

test('el hash no colisiona con el de cero bytes', async () => {
  /* Regresión: si se hashea un buffer ya desprendido por pdf.js, digest no
     falla, hashea cero bytes, y todos los PDF comparten identificador. */
  const vacio = await hashPlantilla(new Uint8Array(0));
  const conDatos = await hashPlantilla(new Uint8Array([1, 2, 3, 4, 5]));
  assert.notStrictEqual(conDatos, vacio, 'el hash de datos reales igualó al de cero bytes');
});

test('el hash identifica la plantilla por contenido, no por nombre', async () => {
  const a = await hashPlantilla(new Uint8Array([1, 2, 3]));
  const b = await hashPlantilla(new Uint8Array([1, 2, 3]));
  const c = await hashPlantilla(new Uint8Array([1, 2, 4]));
  assert.strictEqual(a, b, 'mismo contenido debe dar el mismo hash');
  assert.notStrictEqual(a, c, 'contenido distinto debe dar hash distinto');
  assert.match(a, /^[0-9a-f]{16}$/, 'formato del hash');
});

/* ══════ limpieza al borrar un estudio ══════
   `borrarRecursos` existía y nadie la llamaba: al eliminar un estudio, las imágenes de
   su plantilla quedaban en IndexedDB sin dueño y sin forma de llegar a ellas, y un PDF
   de referencia ronda los 5 MB en base64. */

test('borrar un estudio se lleva sus recursos, su anexo y su vínculo', async () => {
  await conIndexedDBSimulado(async () => {
    await guardarRecursos('study_1', ['data:image/png;base64,LOGO']);
    await guardarAnexoEeff('study_1', ['data:image/png;base64,PAGINA']);
    await guardarVinculo('study_1', 'hash-plantilla');

    const resumen = await borrarRecursosDelEstudio('study_1');

    assert.deepStrictEqual(await leerRecursos('study_1'), []);
    assert.deepStrictEqual(await leerAnexoEeff('study_1'), []);
    assert.strictEqual(await leerVinculo('study_1'), null);
    assert.strictEqual(resumen.fallidos, 0);
  });
});

test('borrar un estudio NO borra la plantilla, que es compartida', async () => {
  /* Su clave es el hash del contenido del PDF, así que la usan todos los estudios que
     subieron el mismo documento: borrarla dejaría a los demás sin plantilla. */
  await conIndexedDBSimulado(async () => {
    await guardarPlantilla('hash-compartido', '<p>plantilla</p>');
    await guardarVinculo('study_1', 'hash-compartido');
    await guardarVinculo('study_2', 'hash-compartido');

    await borrarRecursosDelEstudio('study_1');

    assert.strictEqual(await leerPlantilla('hash-compartido'), '<p>plantilla</p>',
      'la plantilla sigue ahí');
    assert.strictEqual(await leerVinculo('study_2'), 'hash-compartido',
      'y el otro estudio conserva su vínculo');
  });
});

test('borrar un estudio no deja recursos de otro por delante', async () => {
  await conIndexedDBSimulado(async () => {
    await guardarRecursos('study_1', ['A']);
    await guardarRecursos('study_2', ['B']);
    await borrarRecursosDelEstudio('study_1');
    assert.deepStrictEqual(await leerRecursos('study_2'), ['B']);
  });
});

test('un borrado que falla no impide los demás', async () => {
  /* El estudio ya se eliminó de la base: dejar un recurso suelto es menos grave que
     abortar la limpieza a medias. */
  await conIndexedDBSimulado(async () => {
    /* Solo se prepara lo que no vive en el almacén caído: ahí toda operación falla,
       también la escritura, y el objetivo es probar el borrado. */
    await guardarRecursos('study_1', ['A']);

    const resumen = await borrarRecursosDelEstudio('study_1');

    assert.strictEqual(resumen.fallidos, 1, 'el almacén caído se cuenta');
    assert.strictEqual(resumen.borrados, 2, 'los otros dos sí se borraron');
    assert.deepStrictEqual(await leerRecursos('study_1'), [], 'este no dependía del caído');
  }, { fallarEn: 'anexos' });
});
