import { test } from 'node:test';
import assert from 'node:assert';
import { rutaPlantilla } from './cribadoModelo.js';
import { VERSION_PAQUETE, paqueteDePlantilla, paqueteUtil } from './plantillaNubeModelo.js';

test('la ruta de la plantilla cuelga del espacio privado del usuario', () => {
  /* Igual que el cribado: el aislamiento de storage.rules es estructural y depende de que
     el uid esté en la ruta. */
  assert.strictEqual(
    rutaPlantilla('uid123', 'est456'),
    'usuarios/uid123/estudios/est456/plantilla.json'
  );
  assert.throws(() => rutaPlantilla('', 'est456'), /Sin usuario/);
  assert.throws(() => rutaPlantilla('uid123', ''), /identificador de estudio/);
});

test('el paquete lleva lo que hace falta para reproducir el formato en otro equipo', () => {
  const p = paqueteDePlantilla({
    plantillaId: 'ab12cd34', html: '<p>crudo</p>', marcado: '<p data-campo="nit">x</p>',
    huecos: 16, recursos: [{ nombre: 'logo', datos: 'data:image/png;base64,AAA' }],
    ahora: '2026-08-05T12:00:00.000Z',
  });
  assert.strictEqual(p.version, VERSION_PAQUETE, 'versionado: al leer uno viejo hay que saber qué falta');
  assert.strictEqual(p.plantillaId, 'ab12cd34');
  assert.strictEqual(p.huecos, 16, 'los huecos del anexo, o la guarda se queda sin nada que mirar');
  assert.strictEqual(p.recursos.length, 1);
  assert.strictEqual(p.subidoEn, '2026-08-05T12:00:00.000Z');
});

test('el paquete normaliza lo que falta en vez de arrastrar undefined', () => {
  const p = paqueteDePlantilla({ plantillaId: 'ab12', ahora: 'x' });
  assert.strictEqual(p.html, null);
  assert.strictEqual(p.marcado, null);
  assert.strictEqual(p.huecos, 0, 'una plantilla sin huecos no debe disparar el aviso del anexo');
  assert.deepStrictEqual(p.recursos, []);
});

test('solo se restaura un paquete con el que se pueda generar algo', () => {
  const base = { plantillaId: 'ab12', huecos: 0, recursos: [] };
  assert.strictEqual(paqueteUtil({ ...base, html: '<p>x</p>' }), true);
  assert.strictEqual(paqueteUtil({ ...base, marcado: '<p>x</p>' }), true,
    'con solo el marcado basta: es la ruta buena del generador');
  assert.strictEqual(paqueteUtil(base), false, 'sin html ni marcado no hay nada que renderizar');
  assert.strictEqual(paqueteUtil({ html: '<p>x</p>' }), false,
    'sin identificador no se puede guardar en IndexedDB, que indexa por plantilla');
  assert.strictEqual(paqueteUtil(null), false);
  assert.strictEqual(paqueteUtil('{}'), false, 'una cadena no es un paquete');
});
