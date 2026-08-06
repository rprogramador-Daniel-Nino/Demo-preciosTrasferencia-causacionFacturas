import { test } from 'node:test';
import assert from 'node:assert';
import {
  hashPlantilla, claveMarcado, claveHuecos, claveDocx, claveDocxMarcado,
  guardarRecursos, guardarAnexoEeff, guardarVinculo, guardarPlantilla,
  leerRecursos, leerAnexoEeff, leerVinculo, leerPlantilla, borrarRecursosDelEstudio,
  guardarMarcado, leerMarcado, guardarHuecos, leerHuecos,
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

/* Las tres cosas viven en el mismo almacén distinguidas solo por prefijo. Si
   dos claves colisionaran, un estudio leería la plantilla de otro. */
test('la clave del marcado no colisiona con el HTML crudo ni con el vínculo', () => {
  assert.notStrictEqual(claveMarcado('abc123'), 'abc123', 'colisiona con el HTML crudo');
  assert.notStrictEqual(claveMarcado('abc123'), 'vinculo:abc123', 'colisiona con el vínculo');
  assert.strictEqual(claveMarcado('abc123'), 'marcado:abc123');
});

test('plantillas distintas dan claves de marcado distintas', () => {
  assert.notStrictEqual(claveMarcado('abc'), claveMarcado('abd'));
});

test('la clave de huecos no colisiona con ninguna de las otras tres', () => {
  assert.strictEqual(claveHuecos('abc123'), 'huecos:abc123');
  assert.notStrictEqual(claveHuecos('abc123'), 'abc123', 'colisiona con el HTML crudo');
  assert.notStrictEqual(claveHuecos('abc123'), 'vinculo:abc123', 'colisiona con el vinculo');
  assert.notStrictEqual(claveHuecos('abc123'), claveMarcado('abc123'), 'colisiona con el marcado');
});

/* ══════ ida y vuelta del marcado y de los huecos ══════
   Esto quedó como verificación manual porque IndexedDB no existe en node. El
   simulador de más arriba, que llegó con la limpieza de estudios, lo vuelve
   probable sin navegador y sin dependencias: se aprovecha. */

test('el marcado se guarda y se recupera por id de plantilla', async () => {
  await conIndexedDBSimulado(async () => {
    await guardarMarcado('hash-1', '<p><span data-campo="ent">X</span></p>');
    assert.strictEqual(await leerMarcado('hash-1'), '<p><span data-campo="ent">X</span></p>');
    assert.strictEqual(await leerMarcado('hash-2'), null, 'una plantilla sin marcar debe dar null');
  });
});

test('el marcado y el HTML crudo de la misma plantilla no se pisan', async () => {
  await conIndexedDBSimulado(async () => {
    await guardarPlantilla('hash-1', '<p>crudo</p>');
    await guardarMarcado('hash-1', '<p>marcado</p>');
    assert.strictEqual(await leerPlantilla('hash-1'), '<p>crudo</p>');
    assert.strictEqual(await leerMarcado('hash-1'), '<p>marcado</p>');
  });
});

test('la cuenta de huecos sobrevive y vale 0 cuando nunca se guardó', async () => {
  await conIndexedDBSimulado(async () => {
    await guardarHuecos('hash-1', 16);
    assert.strictEqual(await leerHuecos('hash-1'), 16);
    /* Cero y no null: una plantilla anterior a este cambio, o un .docx sin
       huecos, no debe disparar el aviso del anexo. */
    assert.strictEqual(await leerHuecos('hash-sin-guardar'), 0);
  });
});

test('borrar un estudio NO se lleva el marcado ni los huecos de su plantilla', async () => {
  /* Van por plantilla y no por estudio: borrarlos obligaría a los demás estudios
     que usan ese mismo PDF a volver a pagar el marcado por IA. */
  await conIndexedDBSimulado(async () => {
    await guardarVinculo('study_1', 'hash-compartido');
    await guardarMarcado('hash-compartido', '<p>marcado</p>');
    await guardarHuecos('hash-compartido', 16);

    await borrarRecursosDelEstudio('study_1');

    assert.strictEqual(await leerMarcado('hash-compartido'), '<p>marcado</p>');
    assert.strictEqual(await leerHuecos('hash-compartido'), 16);
    assert.strictEqual(await leerVinculo('study_1'), null, 'el vínculo sí debe irse');
  });
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

/* ══════════════ Claves del .docx original y del marcado ══════════════ */

test('las claves del .docx no colisionan con las demás del almacén', () => {
  /* Todo convive en el mismo almacén con prefijos, para no subir VERSION del
     esquema. Un prefijo repetido sobrescribiría datos de otra cosa en silencio. */
  const id = 'abc123';
  const claves = [id, 'vinculo:' + id, claveMarcado(id), claveHuecos(id), claveDocx(id), claveDocxMarcado(id)];
  assert.strictEqual(new Set(claves).size, claves.length, 'las seis han de ser distintas');
});

test('claveDocx y claveDocxMarcado son estables y distinguen plantillas', () => {
  assert.strictEqual(claveDocx('abc123'), 'docx:abc123');
  assert.strictEqual(claveDocxMarcado('abc123'), 'docx-marcado:abc123');
  assert.notStrictEqual(claveDocx('abc'), claveDocx('abd'));
  assert.notStrictEqual(claveDocxMarcado('abc'), claveDocxMarcado('abd'));
});

test('el prefijo del .docx marcado no es prefijo de otra clave', () => {
  /* `docx:` y `docx-marcado:` empiezan igual: si alguien recorriera el almacén por
     prefijo, `docx:` no debe arrastrar los marcados. */
  assert.ok(!claveDocxMarcado('x').startsWith(claveDocx('')), 'docx-marcado no cae bajo docx:');
});
