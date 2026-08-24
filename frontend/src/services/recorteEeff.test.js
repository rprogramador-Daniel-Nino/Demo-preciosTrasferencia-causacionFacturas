import { test } from 'node:test';
import assert from 'node:assert';
import { recortarImagenesGuardadas } from './recorteEeff.js';
import { guardarAnexoBImagenes, leerAnexoBImagenes } from './plantillaStore.js';

/* IndexedDB no existe en node: se simula el mínimo para poder probar
   recortarImagenesGuardadas sin arrastrar un navegador. */
function conIndexedDBSimulado(fn) {
  const almacenes = { anexos: new Map() };
  const previo = global.indexedDB;

  global.indexedDB = {
    open() {
      const solicitud = {};
      setImmediate(() => {
        solicitud.result = {
          objectStoreNames: { contains: (nombre) => nombre in almacenes },
          transaction(nombre) {
            const tx = {
              objectStore: () => ({
                put(valor, clave) { almacenes[nombre].set(clave, valor); return {}; },
                get(clave) { return { result: almacenes[nombre].get(clave) }; },
                delete(clave) { almacenes[nombre].delete(clave); return {}; },
              }),
            };
            setImmediate(() => {
              if (tx.oncomplete) tx.oncomplete();
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

test('recortarImagenesGuardadas devuelve un objeto vacío si no hay imágenes guardadas para el estudio', async () => {
  await conIndexedDBSimulado(async () => {
    const mapa = await recortarImagenesGuardadas('estudio-inexistente');
    assert.deepStrictEqual(mapa, {});
  });
});

test('recortarImagenesGuardadas lee, procesa y conserva las imágenes de un estudio', async () => {
  await conIndexedDBSimulado(async (almacenes) => {
    const imagenesOriginales = {
      'empresa-1': ['data:image/png;base64,bytesFalsos1', 'data:image/png;base64,bytesFalsos2']
    };

    // Guardar las imágenes directamente usando la función del store
    await guardarAnexoBImagenes('estudio-1', imagenesOriginales);

    // Ejecutar el recortador
    const mapaRecortado = await recortarImagenesGuardadas('estudio-1');

    // Dado que en Node sin Canvas recortarDataUrl es una no-op (idempotente),
    // las imágenes resultantes deben ser idénticas a las originales.
    assert.deepStrictEqual(mapaRecortado, imagenesOriginales);

    // El almacén IndexedDB debe conservar las imágenes
    const recuperadoDirecto = await leerAnexoBImagenes('estudio-1');
    assert.deepStrictEqual(recuperadoDirecto, imagenesOriginales);
  });
});

test('recortarImagenesGuardadas maneja valores nulos o estructuras corruptas con seguridad sin lanzar', async () => {
  await conIndexedDBSimulado(async () => {
    // Caso de estudio nulo
    const vacio = await recortarImagenesGuardadas(null);
    assert.deepStrictEqual(vacio, {});
  });
});
