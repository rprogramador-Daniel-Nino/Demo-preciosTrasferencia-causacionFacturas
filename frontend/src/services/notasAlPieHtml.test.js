import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  notasApartadoHtml, anclarReferenciasHtml, crearNumeradorDeNotasHtml,
} from './notasAlPieHtml.js';

const FUENTE_DANE = {
  medio: 'DANE',
  titulo: 'Encuesta Mensual de Industria - EMIM',
  url: 'https://www.dane.gov.co/emim',
};

test('cada fuente da un superíndice y su referencia debajo', () => {
  const { referencias, notas, siguiente } = notasApartadoHtml([FUENTE_DANE], 1);

  assert.strictEqual(referencias, '<sup>1</sup>');
  assert.match(notas, /<sup>1<\/sup> DANE\. \(s\.f\.\)\. Encuesta Mensual de Industria - EMIM\./);
  assert.strictEqual(siguiente, 2, 'el siguiente apartado continúa la numeración');
});

test('la URL que cierra la cita se publica como enlace', () => {
  const { notas } = notasApartadoHtml([FUENTE_DANE], 1);
  assert.match(notas, /<a href="https:\/\/www\.dane\.gov\.co\/emim">https:\/\/www\.dane\.gov\.co\/emim<\/a>/);
  assert.ok(!/<a[^>]*>[^<]*<a/.test(notas), 'un solo enlace, no anidados');
});

test('un esquema que no sea http(s) no se convierte en enlace', () => {
  /* La URL la escribe el modelo: un `javascript:` en el href de un informe que se abre en el
     navegador no tiene por qué existir. */
  const { notas } = notasApartadoHtml(
    [{ medio: 'X', titulo: 'Y', url: 'javascript:alert(1)' }], 1);

  assert.ok(!/<a /.test(notas), 'no se enlaza');
  assert.match(notas, /javascript:alert\(1\)/, 'pero el texto se conserva, escapado');
});

test('el HTML de la cita va escapado', () => {
  const { notas } = notasApartadoHtml(
    [{ medio: "Standard & Poor's", titulo: '<b>Ojo</b>' }], 1);

  assert.match(notas, /Standard &amp; Poor/);
  assert.match(notas, /&lt;b&gt;Ojo&lt;\/b&gt;/, 'el marcado de la fuente no se interpreta');
});

test('la numeración corrida no se reinicia entre apartados', () => {
  const primero = notasApartadoHtml([FUENTE_DANE, { medio: 'FMI', titulo: 'WEO' }], 1);
  assert.strictEqual(primero.referencias, '<sup>1</sup><sup>2</sup>');
  assert.strictEqual(primero.siguiente, 3);

  const segundo = notasApartadoHtml([{ medio: 'OCDE', titulo: 'Outlook' }], primero.siguiente);
  assert.strictEqual(segundo.referencias, '<sup>3</sup>');
});

test('sin fuentes no se publica nada y el contador no avanza', () => {
  assert.deepStrictEqual(notasApartadoHtml([], 5), { referencias: '', notas: '', siguiente: 5 });
  assert.deepStrictEqual(notasApartadoHtml(null, 5), { referencias: '', notas: '', siguiente: 5 });
  /* Una fuente sin medio no sostiene una cita: tampoco gasta número. */
  assert.deepStrictEqual(notasApartadoHtml([{ titulo: 'huérfano' }], 5),
    { referencias: '', notas: '', siguiente: 5 });
});

test('las referencias se anclan al final del último párrafo', () => {
  const html = '<p>Primero.</p><p>Y el último.</p>';
  assert.strictEqual(anclarReferenciasHtml(html, '<sup>1</sup>'),
    '<p>Primero.</p><p>Y el último.<sup>1</sup></p>');
});

test('sin párrafo donde anclar, las referencias van detrás', () => {
  assert.strictEqual(anclarReferenciasHtml('texto suelto', '<sup>1</sup>'),
    'texto suelto<sup>1</sup>');
  assert.strictEqual(anclarReferenciasHtml('', '<sup>1</sup>'), '');
  assert.strictEqual(anclarReferenciasHtml('<p>x</p>', ''), '<p>x</p>');
});

test('el numerador del documento publica narrativa, superíndices y notas', () => {
  const numerador = crearNumeradorDeNotasHtml();

  const uno = numerador.publicar('<p>La inflación cedió.</p>', [FUENTE_DANE]);
  assert.match(uno, /La inflación cedió\.<sup>1<\/sup><\/p>/);
  assert.match(uno, /<sup>1<\/sup> DANE\./);

  const dos = numerador.publicar('<p>El PIB creció.</p>', [{ medio: 'FMI', titulo: 'WEO' }]);
  assert.match(dos, /El PIB creció\.<sup>2<\/sup><\/p>/, 'sigue la numeración del documento');
  assert.strictEqual(numerador.cuantas(), 2);
});

test('un apartado sin fuentes se devuelve tal cual', () => {
  const numerador = crearNumeradorDeNotasHtml();
  const html = '<p>Conclusiones, que sintetizan y no citan.</p>';
  assert.strictEqual(numerador.publicar(html, []), html);
  assert.strictEqual(numerador.cuantas(), 0);
});
