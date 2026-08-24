import { test } from 'node:test';
import assert from 'node:assert/strict';
import { restaurarCamposSinDato, valoresQueSustituyoElMarcado } from './docxPlantilla.js';

/* El caso que lo motivó (usuario, 2026-08-24, informe de SHANDONG KERUI 2025): las celdas de
   las Tablas 2, 3, 5, 6 y 7 salían en guiones porque su contenido es una marca `{vinc}` y el
   estudio no traía el vinculado. La plantilla publicaba «SHANDONG RUICHENG PETROLEUM
   EQUIPMENT CO.,LTD | CHINA | 6.719.644.000» y eso es lo que hay que conservar. */

/** Un párrafo con su texto en un solo run. */
const p = (texto) => `<w:p><w:r><w:t>${texto}</w:t></w:r></w:p>`;
/** Envuelve párrafos en un documento mínimo. */
const doc = (...parrafos) => `<w:document><w:body>${parrafos.join('')}</w:body></w:document>`;

/** Todos los campos sin dato menos los que se listen. */
const salvo = (...conDato) => (campo) => !conDato.includes(campo);

const RX = /\{([^}\s#/^]+)\}/g;

/* ══════════════════ Extracción dentro de un párrafo ══════════════════ */

test('una celda que es solo una marca recupera el texto entero del original', () => {
  const r = valoresQueSustituyoElMarcado('{vinc}', 'SHANDONG RUICHENG PETROLEUM EQUIPMENT CO.,LTD', RX);
  assert.deepStrictEqual(r, [{
    campo: 'vinc', pos: 0, largo: 6, valor: 'SHANDONG RUICHENG PETROLEUM EQUIPMENT CO.,LTD',
  }]);
});

test('con texto fijo alrededor, el valor sale delimitado por ese texto', () => {
  const r = valoresQueSustituyoElMarcado(
    'La sociedad {ent} con NIT {nit} declara.',
    'La sociedad ACME COLOMBIA S.A.S con NIT 900.123.456-7 declara.', RX);
  assert.deepStrictEqual(r.map((x) => [x.campo, x.valor]), [
    ['ent', 'ACME COLOMBIA S.A.S'], ['nit', '900.123.456-7'],
  ]);
});

test('un tramo fijo que no está en el original significa que no son el mismo párrafo', () => {
  assert.strictEqual(
    valoresQueSustituyoElMarcado('La sociedad {ent} declara.', 'Otro párrafo cualquiera.', RX),
    null);
});

test('dos marcas seguidas sin texto entre ellas no se restauran: es ambiguo', () => {
  /* No hay forma de saber dónde acaba el valor de la primera y empieza el de la segunda. */
  assert.strictEqual(valoresQueSustituyoElMarcado('{vinc}{pais_vinc}', 'ACME INCCHINA', RX), null);
});

test('un párrafo sin marcas no tiene nada que extraer', () => {
  assert.strictEqual(valoresQueSustituyoElMarcado('Texto normal.', 'Texto normal.', RX), null);
});

/* ══════════════════ Sobre el documento ══════════════════ */

test('el campo sin dato vuelve al texto que la plantilla publicaba', () => {
  const marcado = doc(p('{vinc}'), p('{pais_vinc}'), p('{monto_operacion}'));
  const original = doc(p('SHANDONG RUICHENG PETROLEUM EQUIPMENT CO.,LTD'), p('CHINA'), p('6.719.644.000'));
  const r = restaurarCamposSinDato(marcado, original, { sinDato: salvo() });

  assert.ok(r.xml.includes('SHANDONG RUICHENG PETROLEUM EQUIPMENT CO.,LTD'));
  assert.ok(r.xml.includes('CHINA') && r.xml.includes('6.719.644.000'));
  assert.ok(!r.xml.includes('{vinc}'), 'la marca ya no queda para que el relleno la vacíe');
  assert.deepStrictEqual(r.restaurados.map((x) => x.campo), ['monto_operacion', 'pais_vinc', 'vinc']);
  assert.deepStrictEqual(r.sinRespaldo, []);
});

test('el campo que SÍ tiene dato se queda como marca, para que el relleno lo sustituya', () => {
  const marcado = doc(p('{vinc}'), p('{pais_vinc}'));
  const original = doc(p('SHANDONG RUICHENG'), p('CHINA'));
  const r = restaurarCamposSinDato(marcado, original, { sinDato: salvo('vinc') });

  assert.ok(r.xml.includes('{vinc}'), 'el que tiene dato sigue siendo una marca');
  assert.ok(!r.xml.includes('SHANDONG RUICHENG'), 'y no se le pone el valor del año anterior');
  assert.ok(r.xml.includes('CHINA'), 'el que no tiene dato conserva el de la plantilla');
});

test('cada ocurrencia recupera SU valor, no el de la primera', () => {
  /* Es la razón por la que esto va por posición y no por nombre de campo: la Tabla 3 de la
     plantilla de Shandong lista tres vinculados distintos, las tres celdas con `{vinc}`. */
  const marcado = doc(p('{vinc}'), p('{vinc}'), p('{vinc}'));
  const original = doc(p('RIO PETROLEO EQUIPAMENTOS'), p('KERUI PERU S.A.C'), p('TOYAR ENERGY'));
  const r = restaurarCamposSinDato(marcado, original, { sinDato: salvo() });

  assert.ok(r.xml.includes('RIO PETROLEO EQUIPAMENTOS'));
  assert.ok(r.xml.includes('KERUI PERU S.A.C'));
  assert.ok(r.xml.includes('TOYAR ENERGY'));
  assert.strictEqual(r.restaurados.length, 3);
});

test('los campos de las colecciones no se tocan: los resuelve la fila del bucle', () => {
  const marcado = doc(p('{#comparables}'), p('{nombre}'), p('{/comparables}'));
  const original = doc(p(''), p('BAKER HUGHES COMPANY'), p(''));
  const r = restaurarCamposSinDato(marcado, original, {
    sinDato: salvo(), excluir: ['nombre', 'ambito'],
  });

  assert.ok(r.xml.includes('{nombre}'), 'la marca del bucle sigue en pie');
  assert.ok(!r.xml.includes('BAKER HUGHES COMPANY'));
  assert.deepStrictEqual(r.restaurados, []);
});

test('las marcas de bucle no son campos y nunca se restauran', () => {
  const marcado = doc(p('{#comparables}'), p('{/comparables}'));
  const original = doc(p('lo que fuera'), p('y lo que fuera'));
  const r = restaurarCamposSinDato(marcado, original, { sinDato: salvo() });
  assert.ok(r.xml.includes('{#comparables}') && r.xml.includes('{/comparables}'));
  assert.deepStrictEqual(r.restaurados, []);
});

test('si los dos documentos no traen los mismos párrafos no se adivina, se avisa', () => {
  const marcado = doc(p('{vinc}'), p('{pais_vinc}'));
  const original = doc(p('SHANDONG RUICHENG'));
  const r = restaurarCamposSinDato(marcado, original, { sinDato: salvo() });

  assert.strictEqual(r.xml, marcado, 'el documento no se toca');
  assert.deepStrictEqual(r.restaurados, []);
  assert.deepStrictEqual(r.sinRespaldo.sort(), ['pais_vinc', 'vinc']);
});

test('un párrafo que no se puede alinear deja sus campos sin respaldo, y lo dice', () => {
  const marcado = doc(p('La sociedad {ent} declara.'), p('{vinc}'));
  const original = doc(p('Un párrafo que no se parece.'), p('SHANDONG RUICHENG'));
  const r = restaurarCamposSinDato(marcado, original, { sinDato: salvo() });

  assert.deepStrictEqual(r.sinRespaldo, ['ent']);
  assert.ok(r.xml.includes('SHANDONG RUICHENG'), 'el párrafo que sí se alineó se restaura igual');
});

test('sin el .docx sin marcar no se restaura nada y el relleno sigue como antes', () => {
  const marcado = doc(p('{vinc}'));
  const r = restaurarCamposSinDato(marcado, null, { sinDato: salvo() });
  assert.strictEqual(r.xml, marcado);
  assert.deepStrictEqual(r.restaurados, []);
});

test('un original vacío en esa celda no se restaura: dejaría la celda en blanco', () => {
  /* Que la plantilla tampoco dijera nada ahí no es un respaldo: se deja la marca y el campo
     sale como «—», que al menos se ve. */
  const marcado = doc(p('{vinc}'));
  const original = doc(p('   '));
  const r = restaurarCamposSinDato(marcado, original, { sinDato: salvo() });
  assert.ok(r.xml.includes('{vinc}'));
  assert.deepStrictEqual(r.restaurados, []);
});

test('el texto restaurado se escapa: un & del original no rompe el XML', () => {
  const marcado = doc(p('{vinc}'));
  const original = doc(p('BAKER HUGHES &amp; COMPANY'));
  const r = restaurarCamposSinDato(marcado, original, { sinDato: salvo() });
  assert.ok(r.xml.includes('BAKER HUGHES &amp; COMPANY'), 'sigue escapado una sola vez');
  assert.ok(!r.xml.includes('&amp;amp;'), 'y no doblemente escapado');
});

test('la marca partida en varios runs también se restaura', () => {
  /* Word parte una frase en varios `<w:r><w:t>` por rsid o por el corrector, así que el
     marcador no aparece contiguo en el XML: es el mismo motivo por el que todo este módulo
     trabaja sobre el texto ya unido del párrafo. */
  const marcado = doc('<w:p><w:r><w:t>{vi</w:t></w:r><w:r><w:t>nc}</w:t></w:r></w:p>');
  const original = doc(p('SHANDONG RUICHENG'));
  const r = restaurarCamposSinDato(marcado, original, { sinDato: salvo() });
  assert.ok(r.xml.includes('SHANDONG RUICHENG'));
  assert.strictEqual(r.restaurados.length, 1);
});

test('los delimitadores de la plantilla se respetan', () => {
  const marcado = doc('<w:p><w:r><w:t>[[vinc]]</w:t></w:r></w:p>');
  const original = doc(p('SHANDONG RUICHENG'));
  const r = restaurarCamposSinDato(marcado, original, {
    sinDato: salvo(), abrir: '[[', cerrar: ']]',
  });
  assert.ok(r.xml.includes('SHANDONG RUICHENG'));
});

test('el valor que contiene el texto de cierre no se trunca', () => {
  /* «El vinculado es {vinc}.» cierra con un punto, y el nombre lleva puntos dentro:
     buscar la primera aparición del cierre dejaba «…EQUIPMENT CO.» y perdía «,LTD».
     Reproducido con el .docx de SHANDONG KERUI 2025. */
  const r = valoresQueSustituyoElMarcado(
    'El vinculado es {vinc}.',
    'El vinculado es SHANDONG RUICHENG PETROLEUM EQUIPMENT CO.,LTD.', RX);
  assert.deepStrictEqual(r.map((x) => x.valor), ['SHANDONG RUICHENG PETROLEUM EQUIPMENT CO.,LTD']);
});

test('el prefijo tiene que estar al principio, no en cualquier sitio', () => {
  /* Si el párrafo del original solo CONTIENE el texto fijo en medio, no es el mismo
     párrafo: se prefiere no restaurar a restaurar un tramo cogido de otro sitio. */
  assert.strictEqual(valoresQueSustituyoElMarcado(
    'Nota: {vinc} es la vinculada.', 'Al cierre, Nota: ACME es la vinculada.', RX), null);
});
