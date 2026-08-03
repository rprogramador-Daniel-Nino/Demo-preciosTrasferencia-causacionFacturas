import { test } from 'node:test';
import assert from 'node:assert';
import { revisarAntesDeGenerar } from './plantillaGuardas.js';

const base = { estudio: { nit: '800123456-7' }, nitDeReferencia: '800123456-7', vacios: [], tieneAnexo: true, recursosFaltantes: [] };

test('sin problemas no hay avisos', () => {
  assert.deepStrictEqual(revisarAntesDeGenerar(base), []);
});

test('avisa si el NIT de la referencia no es el del estudio', () => {
  const avisos = revisarAntesDeGenerar({ ...base, nitDeReferencia: '901337576-6' });
  assert.strictEqual(avisos.length, 1);
  assert.match(avisos[0].texto, /901337576-6/);
  assert.match(avisos[0].texto, /800123456-7/);
});

test('avisa si el anexo no se ha subido', () => {
  const avisos = revisarAntesDeGenerar({ ...base, tieneAnexo: false });
  assert.strictEqual(avisos.length, 1);
  assert.match(avisos[0].texto, /anexo/i);
});

test('lista todos los campos sin dato, no solo el primero', () => {
  const avisos = revisarAntesDeGenerar({ ...base, vacios: ['ciiu', 'eeff.t_cash'] });
  assert.strictEqual(avisos.length, 1);
  assert.match(avisos[0].texto, /ciiu/);
  assert.match(avisos[0].texto, /eeff\.t_cash/);
});

test('los avisos se acumulan', () => {
  const avisos = revisarAntesDeGenerar({
    ...base, nitDeReferencia: '901337576-6', tieneAnexo: false, vacios: ['ciiu'],
  });
  assert.strictEqual(avisos.length, 3);
});

test('sin NIT de referencia no se inventa un aviso', () => {
  assert.deepStrictEqual(revisarAntesDeGenerar({ ...base, nitDeReferencia: null }), []);
});

test('avisa si hay imágenes faltantes', () => {
  const avisos = revisarAntesDeGenerar({ ...base, recursosFaltantes: ['logo-encabezado', 'imagen-tabla'] });
  assert.strictEqual(avisos.length, 1);
  assert.match(avisos[0].texto, /2/);
  assert.match(avisos[0].texto, /logo-encabezado/);
  assert.match(avisos[0].texto, /imagen-tabla/);
});

test('sin recursosFaltantes no hay aviso', () => {
  const avisos = revisarAntesDeGenerar({ ...base, recursosFaltantes: [] });
  assert.strictEqual(avisos.length, 0);
});

test('con recursosFaltantes undefined no hay aviso', () => {
  const avisos = revisarAntesDeGenerar({ ...base, recursosFaltantes: undefined });
  assert.strictEqual(avisos.length, 0);
});

test('con recursosFaltantes absent no hay aviso', () => {
  const avisos = revisarAntesDeGenerar({ estudio: { nit: '800123456-7' }, nitDeReferencia: '800123456-7', vacios: [], tieneAnexo: true });
  assert.strictEqual(avisos.length, 0);
});

test('avisos se acumulan incluyendo recursosFaltantes', () => {
  const avisos = revisarAntesDeGenerar({
    ...base, nitDeReferencia: '901337576-6', tieneAnexo: false, vacios: ['ciiu'], recursosFaltantes: ['logo'],
  });
  assert.strictEqual(avisos.length, 4);
});

// Tests para normalización de NIT
test('NIT con puntos se normaliza y no dispara aviso si es igual', () => {
  const avisos = revisarAntesDeGenerar({
    ...base,
    estudio: { nit: '800.123.456-7' },
    nitDeReferencia: '800123456-7',
  });
  assert.strictEqual(avisos.length, 0);
});

test('NIT con espacios se normaliza y no dispara aviso si es igual', () => {
  const avisos = revisarAntesDeGenerar({
    ...base,
    estudio: { nit: '800 123 456-7' },
    nitDeReferencia: '800123456-7',
  });
  assert.strictEqual(avisos.length, 0);
});

test('NIT con puntos y espacios se normaliza correctamente', () => {
  const avisos = revisarAntesDeGenerar({
    ...base,
    estudio: { nit: '800.123.456 - 7' },
    nitDeReferencia: '800123456-7',
  });
  assert.strictEqual(avisos.length, 0);
});

test('NIT sin dígito de verificación iguala a NIT con dígito de verificación si la base coincide', () => {
  const avisos = revisarAntesDeGenerar({
    ...base,
    estudio: { nit: '800123456' },
    nitDeReferencia: '800123456-7',
  });
  assert.strictEqual(avisos.length, 0);
});

test('NIT con dígito de verificación iguala a NIT sin dígito si la base coincide', () => {
  const avisos = revisarAntesDeGenerar({
    ...base,
    estudio: { nit: '800123456-7' },
    nitDeReferencia: '800123456',
  });
  assert.strictEqual(avisos.length, 0);
});

test('NIT verdaderamente distinto sigue disparando aviso a pesar de normalización', () => {
  const avisos = revisarAntesDeGenerar({
    ...base,
    estudio: { nit: '800.123.456-7' },
    nitDeReferencia: '901337576-6',
  });
  assert.strictEqual(avisos.length, 1);
  assert.match(avisos[0].texto, /901337576-6/);
  assert.match(avisos[0].texto, /800\.123\.456-7/);
});

// Tests para entradas degeneradas
test('sin argumento no lanza y devuelve aviso vacío', () => {
  const avisos = revisarAntesDeGenerar();
  assert.deepStrictEqual(avisos, []);
});

test('argumento undefined no lanza y devuelve aviso vacío', () => {
  const avisos = revisarAntesDeGenerar(undefined);
  assert.deepStrictEqual(avisos, []);
});

test('objeto vacío {} no lanza y devuelve aviso vacío', () => {
  const avisos = revisarAntesDeGenerar({});
  assert.deepStrictEqual(avisos, []);
});

test('estudio null no lanza y devuelve aviso vacío', () => {
  const avisos = revisarAntesDeGenerar({ ...base, estudio: null });
  assert.deepStrictEqual(avisos, []);
});

test('vacios null no lanza', () => {
  const avisos = revisarAntesDeGenerar({ ...base, vacios: null });
  assert.strictEqual(avisos.length, 0);
});

test('recursosFaltantes null no lanza', () => {
  const avisos = revisarAntesDeGenerar({ ...base, recursosFaltantes: null });
  assert.strictEqual(avisos.length, 0);
});
