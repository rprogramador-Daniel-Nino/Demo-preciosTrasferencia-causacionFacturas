import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  actualizarProsaBaseDatos, BASE_DATOS_ACTUAL, BASE_DATOS_FUENTE, AVISO_BASE_DATOS,
} from './prosaBaseDatos.js';
import { PARRAFO_OOXML, textoVisibleConMapa } from './prosaVecindad.js';

/* Lo que se lee en el documento, sin etiquetas y con las entidades resueltas. Las pruebas
   comprueban contra esto y no contra el marcado: lo que importa es lo que llega al lector, y
   `&amp;` y `&` son el mismo carácter para él. */
const leido = (marcado) => textoVisibleConMapa(marcado).plano;

/* Las dos frases de «1.3 Proceso General de búsqueda», tal como están en el informe de
   referencia (`brain_estudio_pasado.txt:1055-1067`). */
const FRASE_ESTADOS_FINANCIEROS = 'En relación a régimen de Precios de Transferencia, se realiza'
  + ' el estudio y análisis estadístico del rango intercuartil sobre la base de los estados'
  + ' financieros obtenidos por medio de la base de datos OneSource de Thomson Reuters; así pues,'
  + ' el grupo de sociedades que conformaran dicha base de datos para ser comparada y analizada'
  + ' depende de diferentes requisitos mínimos.';

const FRASE_BUSQUEDA_SIC = 'Por tanto, para el caso analizado de END GAME INTERACTIVE COLOMBIA'
  + ' SAS. se realiza una búsqueda por sectores económicos y palabras claves del objeto social'
  + ' registrada en las bases de datos OneSource de Thomson Reuters con el código Standard'
  + ' Industrial Classification (SIC).';

test('en la prosa de los estados financieros pone la base de datos actual', () => {
  const avisos = [];
  const salida = actualizarProsaBaseDatos(`<p>${FRASE_ESTADOS_FINANCIEROS}</p>`, avisos);
  const texto = leido(salida);

  assert.match(texto, /la base de datos Capital IQ de Standard & Poor's; así pues/);
  assert.ok(!/OneSource|Thomson/i.test(texto), 'no queda rastro de la base anterior');
  assert.deepStrictEqual(avisos, [], 'la sustitución limpia no genera aviso');
});

test('conserva el plural de la plantilla: «las bases de datos»', () => {
  const salida = leido(actualizarProsaBaseDatos(`<p>${FRASE_BUSQUEDA_SIC}</p>`, []));

  assert.match(salida, /las bases de datos Capital IQ de Standard & Poor's con el código/);
  /* El nombre se sustituye, el giro que lo introduce no: reescribirlo sería redactar. */
  assert.match(salida, /Por tanto, para el caso analizado de END GAME/);
});

test('las dos frases de la sección se corrigen en una sola pasada', () => {
  const html = `<p>${FRASE_ESTADOS_FINANCIEROS}</p><p>${FRASE_BUSQUEDA_SIC}</p>`;
  const texto = leido(actualizarProsaBaseDatos(html, []));

  const cuantas = (texto.match(/Capital IQ de Standard & Poor's/g) || []).length;
  assert.strictEqual(cuantas, 2, 'las dos menciones quedaron con la base actual');
});

test('el & del nombre queda escapado, no crudo', () => {
  const salida = actualizarProsaBaseDatos(`<p>${FRASE_ESTADOS_FINANCIEROS}</p>`, []);

  assert.match(salida, /Standard &amp; Poor's/, 'va como entidad en el marcado');
  /* Un `&` sin entidad rompe el OOXML y Word se niega a abrir el documento. */
  const crudos = salida.match(/&(?!amp;|lt;|gt;|quot;|apos;|#)/g) || [];
  assert.deepStrictEqual(crudos, [], 'ningún & suelto en la salida');
});

test('en Word sustituye una frase partida en varios runs sin tocar las etiquetas', () => {
  const xml = '<w:p><w:r><w:t xml:space="preserve">financieros obtenidos por medio de la base'
    + ' de datos OneSource de </w:t></w:r>'
    + '<w:r><w:rPr><w:b/></w:rPr><w:t>Thomson</w:t></w:r>'
    + '<w:r><w:t xml:space="preserve"> Reuters; así pues, el grupo</w:t></w:r></w:p>';

  const salida = actualizarProsaBaseDatos(xml, [], { rxParrafo: PARRAFO_OOXML });

  assert.match(leido(salida), /la base de datos Capital IQ de Standard & Poor's; así pues, el grupo/);
  /* Mismo número de runs y de textos: borrar un `<w:r>` se llevaría su `<w:rPr>` y con él el
     formato de lo que venga después. */
  assert.strictEqual((salida.match(/<w:t/g) || []).length, 3, 'los tres <w:t> siguen ahí');
  assert.strictEqual((salida.match(/<w:r>/g) || []).length, 3, 'los tres runs siguen ahí');
  assert.match(salida, /<w:b\/>/, 'el formato del run del medio se conserva');
});

test('la mención partida por el salto de línea del PDF también se reconoce', () => {
  /* El lector de PDF entrega la frase con el salto de la página en medio. */
  const html = '<p>obtenidos por medio de la base de datos OneSource de Thomson\nReuters; así pues</p>';
  const texto = leido(actualizarProsaBaseDatos(html, []));

  assert.match(texto, /la base de datos Capital IQ de Standard & Poor's; así pues/);
});

test('reconoce «Thomson-Reuters» y la cola «-Refinitiv Fundamentals»', () => {
  const html = '<p>la base de datos OneSource de Thomson Reuters-Refinitiv Fundamentals, con</p>';
  const texto = leido(actualizarProsaBaseDatos(html, []));

  assert.match(texto, /la base de datos Capital IQ de Standard & Poor's, con/);
  assert.ok(!/Refinitiv/i.test(texto), 'la cola de la base anterior no queda colgando');
});

test('una plantilla que ya nombra Capital IQ se queda igual y sin avisos', () => {
  const avisos = [];
  const html = `<p>obtenidos por medio de la base de datos ${BASE_DATOS_ACTUAL}, así pues</p>`;
  const salida = actualizarProsaBaseDatos(html, avisos);

  assert.strictEqual(salida, html, 'no se toca nada');
  assert.deepStrictEqual(avisos, []);
});

test('la cita al pie de una tabla queda con el proveedor entre paréntesis', () => {
  /* Tal como salía en el informe que se reportó el 2026-08-20: una tabla con los comparables del
     estudio y, debajo, la base de datos del informe del año anterior. */
  const avisos = [];
  const html = '<p>Información Base Datos ONESOURCE (Thomson Reuters). Fecha de consulta:'
    + ' julio de 2024.</p>';
  const texto = leido(actualizarProsaBaseDatos(html, avisos));

  assert.match(texto, /Información Base Datos Capital IQ \(Standard & Poor's\)\./);
  /* La fecha de consulta no la gobierna este módulo: se conserva tal cual. */
  assert.match(texto, /Fecha de consulta: julio de 2024\./);
  assert.deepStrictEqual(avisos, [], 'sustituida limpiamente, sin aviso');
});

test('en la cita al pie el proveedor va entre paréntesis y en la prosa con «de»', () => {
  const html = `<p>la base de datos OneSource de Thomson Reuters, y</p>`
    + `<p>Información Base Datos ONESOURCE (Thomson Reuters).</p>`;
  const texto = leido(actualizarProsaBaseDatos(html, []));

  assert.ok(texto.includes(`la base de datos ${BASE_DATOS_ACTUAL},`), 'la prosa lleva «de»');
  assert.ok(texto.includes(`Información Base Datos ${BASE_DATOS_FUENTE}.`), 'el pie, paréntesis');
});

test('el pie sin proveedor también se corrige', () => {
  const avisos = [];
  const html = '<p><span style="font-size:9pt">Información Base Datos ONESOURCE.</span></p>';
  const texto = leido(actualizarProsaBaseDatos(html, avisos));

  assert.match(texto, /Información Base Datos Capital IQ \(Standard & Poor's\)\./);
  assert.deepStrictEqual(avisos, []);
});

test('el pie con la cola de Refinitiv se resuelve como cita, no como prosa', () => {
  const html = '<p>Información Base Datos ONESOURCE (Thomson Reuters-Refinitiv Fundamentals)</p>';
  const texto = leido(actualizarProsaBaseDatos(html, []));

  assert.match(texto, /Información Base Datos Capital IQ \(Standard & Poor's\)/);
  assert.ok(!/Refinitiv|Thomson/i.test(texto), 'no queda rastro del proveedor anterior');
});

test('avisa cuando la plantilla nombra la base anterior de otra manera', () => {
  const avisos = [];
  const html = '<p>los estados financieros se obtuvieron de la base de datos OneSource, que</p>';
  const salida = actualizarProsaBaseDatos(html, avisos);

  assert.strictEqual(salida, html, 'no se adivina la sustitución');
  assert.deepStrictEqual(avisos, [AVISO_BASE_DATOS], 'pero se avisa para que alguien lo mire');
});

test('el aviso no se repite aunque haya varios párrafos con el rastro', () => {
  const avisos = [];
  const html = '<p>la base de datos OneSource, que</p><p>y también Thomson Reuters aparte</p>';
  actualizarProsaBaseDatos(html, avisos);

  assert.strictEqual(avisos.length, 1, 'un recado, no uno por párrafo');
});

test('un texto sin menciones vuelve idéntico y sin recorrer párrafos', () => {
  const html = '<p>La muestra final quedó conformada por 13 compañías comparables.</p>';
  assert.strictEqual(actualizarProsaBaseDatos(html, []), html);
});

test('tolera texto vacío o ausente', () => {
  assert.strictEqual(actualizarProsaBaseDatos('', []), '');
  assert.strictEqual(actualizarProsaBaseDatos(null, []), '');
  assert.strictEqual(actualizarProsaBaseDatos(undefined), '');
});
