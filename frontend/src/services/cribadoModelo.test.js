import { test } from 'node:test';
import assert from 'node:assert';
import {
  nombreSeguro, rutaCribado, rutaCuracion, esStorageNoHabilitado,
  debeRestaurarCribado, referenciaCribado, TOPE_CRIBADO_BYTES,
  podriaFaltarElBucket, urlSondaBucket, faltaElBucket, AVISO_STORAGE_APAGADO,
} from './cribadoModelo.js';

test('el nombre del archivo pierde la ruta del disco', () => {
  /* Una barra en el nombre crearía carpetas dentro de la ruta de Storage y la subida
     acabaría en un sitio que las reglas no autorizan. */
  assert.strictEqual(nombreSeguro('C:\\Users\\ana\\Screening.xlsx'), 'Screening.xlsx');
  assert.strictEqual(nombreSeguro('/home/ana/cribados/Screening.xlsx'), 'Screening.xlsx');
});

test('el nombre pierde los acentos y los caracteres que rompen una ruta', () => {
  assert.strictEqual(nombreSeguro('Información Operaciones 2025.xlsx'), 'Informacion Operaciones 2025.xlsx');
  assert.strictEqual(nombreSeguro('cribado#2?final.xlsx'), 'cribado-2-final.xlsx');
  assert.strictEqual(nombreSeguro('../../secreto.xlsx'), 'secreto.xlsx');
});

test('se conserva la extensión que admiten las reglas y se cae a .xlsx si no hay', () => {
  assert.strictEqual(nombreSeguro('datos.csv'), 'datos.csv');
  assert.strictEqual(nombreSeguro('datos.XLS'), 'datos.xls', 'la extensión se normaliza a minúsculas');
  assert.strictEqual(nombreSeguro('datos.txt'), 'datos.xlsx',
    'una extensión que las reglas rechazan se sustituye por la del cribado; el nombre ' +
    'original queda en los metadatos del objeto');
  assert.strictEqual(nombreSeguro('sinextension'), 'sinextension.xlsx');
});

test('un nombre que se queda en nada tiene respaldo', () => {
  /* Sin esto la ruta acabaría en «/cribado/.xlsx» y la subida fallaría con un error de
     permisos que no dice nada de la causa. */
  assert.strictEqual(nombreSeguro('###.xlsx'), 'cribado.xlsx');
  assert.strictEqual(nombreSeguro(''), 'cribado.xlsx');
  assert.strictEqual(nombreSeguro(null), 'cribado.xlsx');
});

test('la ruta del cribado cuelga del espacio privado del usuario', () => {
  /* El aislamiento de storage.rules es estructural: depende de que el uid esté en la
     ruta, así que esta forma es la que autoriza la escritura. */
  assert.strictEqual(
    rutaCribado('uid123', 'est456', 'Screening 2024.xlsx'),
    'usuarios/uid123/estudios/est456/cribado/Screening 2024.xlsx'
  );
  assert.strictEqual(rutaCuracion('uid123', 'est456'), 'usuarios/uid123/estudios/est456/curacion.json');
});

test('sin usuario o sin estudio no se construye ninguna ruta', () => {
  /* Antes que escribir en una ruta incompleta —que las reglas rechazarían con un error
     opaco— conviene decir qué falta. */
  assert.throws(() => rutaCribado('', 'est456', 'a.xlsx'), /Sin usuario/);
  assert.throws(() => rutaCribado('uid123', '', 'a.xlsx'), /identificador de estudio/);
  assert.throws(() => rutaCuracion(null, 'est456'), /Sin usuario/);
  assert.throws(() => rutaCuracion('uid123', null), /identificador de estudio/);
});

test('solo se restaura cuando falta el universo y hay algo guardado', () => {
  const ref = { ruta: 'usuarios/u/estudios/e/cribado/a.xlsx' };
  assert.strictEqual(debeRestaurarCribado({ universo: [], cribadoIQ: ref }), true);
  assert.strictEqual(debeRestaurarCribado({ universo: [{ id: 'A' }], cribadoIQ: ref }), false,
    'con el universo en memoria, descargar dos megas sería tráfico pagado por nada');
  assert.strictEqual(debeRestaurarCribado({ universo: [], cribadoIQ: null }), false);
  assert.strictEqual(debeRestaurarCribado({ universo: [], cribadoIQ: {} }), false,
    'una referencia sin ruta no sirve para descargar nada');
  assert.strictEqual(debeRestaurarCribado(), false, 'sin argumentos no revienta');
});

test('se reconoce el fallo de Storage no habilitado, que no se arregla reintentando', () => {
  assert.strictEqual(esStorageNoHabilitado({ code: 'storage/bucket-not-found' }), true);
  assert.strictEqual(esStorageNoHabilitado({ code: 'storage/project-not-found' }), true);
  assert.strictEqual(esStorageNoHabilitado({ code: 'storage/unknown', message: 'Server returned 404' }), true,
    'el SDK reporta el bucket ausente como «unknown» con un 404 dentro');
  assert.strictEqual(esStorageNoHabilitado({ code: 'storage/unauthorized' }), false,
    'un permiso denegado es otra cosa: las reglas están, el usuario no encaja');
  assert.strictEqual(esStorageNoHabilitado(null), false);
});

test('un límite de reintentos agotado obliga a sondear antes de concluir', () => {
  /* Es el código que devuelve de verdad un bucket que no existe: el preflight responde
     404, el navegador lo enseña como bloqueo de CORS, el SDK lo toma por fallo de red y
     reintenta hasta agotarse. Y es el mismo código que da una conexión mala, así que por
     sí solo no permite mandar a nadie a habilitar Storage. */
  assert.strictEqual(esStorageNoHabilitado({ code: 'storage/retry-limit-exceeded' }), false,
    'no concluye por sí mismo');
  assert.strictEqual(podriaFaltarElBucket({ code: 'storage/retry-limit-exceeded' }), true,
    'pero sí justifica preguntar por el bucket');
  assert.strictEqual(podriaFaltarElBucket({ code: 'storage/unknown' }), true);
  assert.strictEqual(podriaFaltarElBucket({ code: 'storage/bucket-not-found' }), true,
    'lo ya concluyente no necesita sonda, pero tampoco la estorba');
  assert.strictEqual(podriaFaltarElBucket({ code: 'storage/unauthorized' }), false,
    'un permiso denegado prueba que el bucket está ahí');
  assert.strictEqual(podriaFaltarElBucket({ code: 'storage/quota-exceeded' }), false);
  assert.strictEqual(podriaFaltarElBucket(null), false);
});

test('la sonda del bucket solo afirma su ausencia con un 404', () => {
  assert.strictEqual(faltaElBucket(404), true);
  assert.strictEqual(faltaElBucket(401), false, 'existe, pero pide credenciales');
  assert.strictEqual(faltaElBucket(403), false, 'existe, y las reglas niegan listarlo');
  assert.strictEqual(faltaElBucket(200), false);
  assert.strictEqual(faltaElBucket(500), false, 'un fallo del servidor no dice nada del bucket');
});

test('la URL de la sonda escapa el nombre del bucket', () => {
  assert.strictEqual(
    urlSondaBucket('precios-trasnferencia.firebasestorage.app'),
    'https://firebasestorage.googleapis.com/v0/b/precios-trasnferencia.firebasestorage.app/o?maxResults=1'
  );
});

test('el aviso dice que no hay que configurar CORS', () => {
  /* El síntoma en el navegador es «blocked by CORS policy», y quien lo lea sin más se
     pondrá a configurar CORS sobre un bucket que no existe. */
  assert.match(AVISO_STORAGE_APAGADO, /no hay que configurar\s+CORS/);
  assert.match(AVISO_STORAGE_APAGADO, /Compilación → Storage/);
});

test('la referencia guardada lleva con qué explicar en pantalla lo que hay', () => {
  const r = referenciaCribado({
    ruta: 'usuarios/u/estudios/e/cribado/a.xlsx', archivo: 'Screening 2024.xlsx',
    bytes: 2048, filas: 2990, hoja: 'Screening', uid: 'u', ahora: '2026-08-05T12:00:00.000Z',
  });
  assert.deepStrictEqual(r, {
    ruta: 'usuarios/u/estudios/e/cribado/a.xlsx',
    archivo: 'Screening 2024.xlsx',
    bytes: 2048,
    filas: 2990,
    hoja: 'Screening',
    subidoEn: '2026-08-05T12:00:00.000Z',
    subidoPor: 'u',
  });
});

test('el tope declarado coincide con el de las reglas de Storage', () => {
  /* Si los dos se separan, el usuario recibe un error de permisos en vez del aviso de
     tamaño, que sí dice qué hacer. */
  assert.strictEqual(TOPE_CRIBADO_BYTES, 50 * 1024 * 1024);
});
