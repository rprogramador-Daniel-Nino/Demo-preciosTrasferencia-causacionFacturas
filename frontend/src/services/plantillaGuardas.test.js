import { test } from 'node:test';
import assert from 'node:assert';
import {
  revisarAntesDeGenerar, revisarSalidaRenderizada, valoresDeReferencia,
} from './plantillaGuardas.js';

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

// Tests para lógica de base y dígito de verificación según coordinador
test('NIT con puntos se normaliza y no dispara aviso si es igual', () => {
  const avisos = revisarAntesDeGenerar({
    ...base,
    estudio: { nit: '900123456-7' },
    nitDeReferencia: '900.123.456-7',
  });
  assert.strictEqual(avisos.length, 0);
});

test('NIT sin dígito de verificación no dispara aviso si la base coincide', () => {
  const avisos = revisarAntesDeGenerar({
    ...base,
    estudio: { nit: '900123456-7' },
    nitDeReferencia: '900123456',
  });
  assert.strictEqual(avisos.length, 0);
});

test('NIT con espacios alrededor no dispara aviso si es igual', () => {
  const avisos = revisarAntesDeGenerar({
    ...base,
    estudio: { nit: ' 900123456-7 ' },
    nitDeReferencia: '900123456-7',
  });
  assert.strictEqual(avisos.length, 0);
});

test('NIT que difiere solo en dígito de verificación debe avisar (es error de digitación)', () => {
  const avisos = revisarAntesDeGenerar({
    ...base,
    estudio: { nit: '800123456-7' },
    nitDeReferencia: '800123456-3',
  });
  assert.strictEqual(avisos.length, 1);
  assert.match(avisos[0].texto, /800123456-3/);
  assert.match(avisos[0].texto, /800123456-7/);
});

test('NIT con dígitos duplicados por error de OCR debe avisar', () => {
  const avisos = revisarAntesDeGenerar({
    ...base,
    estudio: { nit: '800123456-7' },
    nitDeReferencia: '8001234560007',
  });
  assert.strictEqual(avisos.length, 1);
  assert.match(avisos[0].texto, /8001234560007/);
});

test('NIT contra referencia con solo letras debe avisar', () => {
  const avisos = revisarAntesDeGenerar({
    ...base,
    estudio: { nit: '900123456-7' },
    nitDeReferencia: 'ABCDEFGHI',
  });
  assert.strictEqual(avisos.length, 1);
  assert.match(avisos[0].texto, /ABCDEFGHI/);
});

test('NIT contra referencia con solo espacios y guiones debe avisar', () => {
  const avisos = revisarAntesDeGenerar({
    ...base,
    estudio: { nit: '900123456-7' },
    nitDeReferencia: '   -  ',
  });
  assert.strictEqual(avisos.length, 1);
});

test('dos NIT de 9 dígitos sin guión donde uno es prefijo del otro debe avisar', () => {
  const avisos = revisarAntesDeGenerar({
    ...base,
    estudio: { nit: '123456789' },
    nitDeReferencia: '12345678',
  });
  assert.strictEqual(avisos.length, 1);
  assert.match(avisos[0].texto, /123456789/);
  assert.match(avisos[0].texto, /12345678/);
});

test('dos NIT sin dígito de verificación donde uno es prefijo del otro debe avisar', () => {
  const avisos = revisarAntesDeGenerar({
    ...base,
    estudio: { nit: '900111222' },
    nitDeReferencia: '90011122',
  });
  assert.strictEqual(avisos.length, 1);
  assert.match(avisos[0].texto, /900111222/);
  assert.match(avisos[0].texto, /90011122/);
});

test('NIT con bases distintas pero ambos con dígito de verificación debe avisar', () => {
  const avisos = revisarAntesDeGenerar({
    ...base,
    estudio: { nit: '900123456-7' },
    nitDeReferencia: '90012345-6',
  });
  assert.strictEqual(avisos.length, 1);
  assert.match(avisos[0].texto, /90012345-6/);
  assert.match(avisos[0].texto, /900123456-7/);
});

/* --- Bloqueante 3: nadie miraba el HTML ya renderizado. Los fallos de
   numeración de ocurrencias, de trozos perdidos y de campos fuera del
   vocabulario son invisibles para las guardas de entrada: todas opinan sobre
   los datos del estudio, no sobre el documento que se va a radicar. --- */

const estudioNuevo = { nit: '800123456-7', ent: 'ACME COLOMBIA S.A.S' };

test('los valores de referencia salen del contenido de las propias marcas', () => {
  const marcado =
    '<p>La sociedad <span data-campo="ent">END GAME INTERACTIVE COLOMBIA S.A.S</span> ' +
    'con NIT <span data-campo="nit">901.337.576-6</span> declara</p>';
  assert.deepStrictEqual(valoresDeReferencia(marcado), [
    { campo: 'ent', valor: 'END GAME INTERACTIVE COLOMBIA S.A.S' },
    { campo: 'nit', valor: '901.337.576-6' },
  ]);
});

test('los valores de referencia no se repiten aunque la marca aparezca cien veces', () => {
  const marcado = '<p><span data-campo="nit">901.337.576-6</span></p>'.repeat(5);
  assert.strictEqual(valoresDeReferencia(marcado).length, 1);
});

test('solo se vigilan los campos testigo, no el año', () => {
  const marcado = '<p><span data-campo="anio">2024</span></p>';
  assert.deepStrictEqual(valoresDeReferencia(marcado), [],
    'vigilar el año produciría avisos falsos en cada columna comparativa');
});

test('avisa con su cuenta si un dato de la referencia sobrevive en la salida', () => {
  const avisos = revisarSalidaRenderizada({
    estudio: estudioNuevo,
    htmlRenderizado:
      '<p>ACME COLOMBIA S.A.S declara</p><p>NIT 901.337.576-6</p><p>NIT 901.337.576-6</p>',
    valores: [{ campo: 'nit', valor: '901.337.576-6' }],
  });
  assert.strictEqual(avisos.length, 1);
  assert.strictEqual(avisos[0].cuenta, 2, 'debe decir cuántas veces sobrevivió');
  assert.match(avisos[0].texto, /901\.337\.576-6/);
  assert.match(avisos[0].texto, /800123456-7/, 'debe decir qué valor correspondía');
});

test('si nada de la referencia sobrevive no hay aviso', () => {
  const avisos = revisarSalidaRenderizada({
    estudio: estudioNuevo,
    htmlRenderizado: '<p>ACME COLOMBIA S.A.S con NIT 800123456-7 declara</p>',
    valores: [{ campo: 'nit', valor: '901.337.576-6' }, { campo: 'ent', valor: 'END GAME S.A.S' }],
  });
  assert.deepStrictEqual(avisos, []);
});

test('no avisa cuando el estudio activo es el mismo contribuyente de la referencia', () => {
  const avisos = revisarSalidaRenderizada({
    estudio: estudioNuevo,
    htmlRenderizado: '<p>NIT 800.123.456-7</p>',
    valores: [{ campo: 'nit', valor: '800.123.456-7' }],
  });
  assert.deepStrictEqual(avisos, [], 'el informe del año siguiente del mismo cliente no es fuga');
});

test('sin dato en el estudio no se inventa un aviso: la marca ya salió como hueco', () => {
  const avisos = revisarSalidaRenderizada({
    estudio: {},
    htmlRenderizado: '<p>NIT 901.337.576-6</p>',
    valores: [{ campo: 'nit', valor: '901.337.576-6' }],
  });
  assert.deepStrictEqual(avisos, []);
});

test('un base64 de imagen no dispara la guarda por casualidad', () => {
  const avisos = revisarSalidaRenderizada({
    estudio: estudioNuevo,
    htmlRenderizado: '<img src="data:image/png;base64,901337576609013375766" />',
    valores: [{ campo: 'nit', valor: '901337576609' }],
  });
  assert.deepStrictEqual(avisos, [], 'los atributos no se leen en el documento');
});

test('la guarda de salida se acumula con las demás dentro de revisarAntesDeGenerar', () => {
  const avisos = revisarAntesDeGenerar({
    estudio: estudioNuevo,
    nitDeReferencia: '800123456-7',
    vacios: [],
    tieneAnexo: true,
    recursosFaltantes: [],
    htmlRenderizado: '<p>END GAME INTERACTIVE COLOMBIA S.A.S</p>',
    valores: [{ campo: 'ent', valor: 'END GAME INTERACTIVE COLOMBIA S.A.S' }],
  });
  assert.strictEqual(avisos.length, 1);
  assert.match(avisos[0].texto, /END GAME INTERACTIVE COLOMBIA S\.A\.S/);
});

test('sin htmlRenderizado la guarda de salida no opina', () => {
  assert.deepStrictEqual(revisarAntesDeGenerar(base), []);
  assert.deepStrictEqual(
    revisarSalidaRenderizada({ estudio: estudioNuevo, htmlRenderizado: '', valores: [] }), []
  );
});
