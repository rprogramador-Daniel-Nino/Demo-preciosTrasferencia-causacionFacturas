/* Tests del año del período fiscal en el informe.

   El defecto: la portada del informe de MONTACHEM 2025 decía «PERÍODO FISCAL AL 31 DE
   DCIEMBRE DE 2024» con un estudio del año gravable 2025. No era por estar en un cuadro de
   texto —el marcado sí entra ahí— sino porque nada actualizaba ese año, y porque Word parte
   el texto en runs arbitrarios: en la plantilla de MC INTERNACIONAL el año viaja como
   «20» + «2» + «4», así que ninguna búsqueda dentro de un `<w:t>` lo encuentra.

   Lo que estas pruebas separan:
     · el año del período fiscal se actualiza, aunque llegue troceado;
     · los años que son de OTRO ejercicio a propósito no se tocan. */

import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { actualizarAnioPeriodo } from './anioPeriodoOoxml.js';

/* Un párrafo con el texto repartido en los runs que se le pasen, que es lo que hace Word. */
const parrafo = (...runs) => '<w:p>' + runs.map((r) => (r === 'BR'
  ? '<w:r><w:br/></w:r>'
  : `<w:r><w:t xml:space="preserve">${r}</w:t></w:r>`)).join('') + '</w:p>';
const cuerpo = (...ps) => `<w:document><w:body>${ps.join('')}</w:body></w:document>`;
const textoDe = (xml) => (xml.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [])
  .map((t) => t.replace(/<[^>]+>/g, '')).join('');

/* ══════ El año se actualiza, venga como venga ══════ */

test('la portada se actualiza cuando el año viaja entero', () => {
  const xml = cuerpo(parrafo('PERÍODO FISCAL AL 31 DE DICIEMBRE DE ', '2024'));
  const r = actualizarAnioPeriodo(xml, 2025);
  assert.strictEqual(r.cambiados, 1);
  assert.strictEqual(textoDe(r.xml), 'PERÍODO FISCAL AL 31 DE DICIEMBRE DE 2025');
});

test('la portada se actualiza cuando Word partió el año en tres runs', () => {
  /* El caso de MC INTERNACIONAL: «…DE 20» + «2» + «4». Una regex por `<w:t>` no lo ve. */
  const xml = cuerpo(parrafo('PERÍODO FISCAL AL 31 DE DICIEMBRE DE 20', '2', '4'));
  const r = actualizarAnioPeriodo(xml, 2025);
  assert.strictEqual(r.cambiados, 1);
  assert.strictEqual(textoDe(r.xml), 'PERÍODO FISCAL AL 31 DE DICIEMBRE DE 2025');
});

test('también cuando el mes está partido, como en END GAME', () => {
  /* «…31 DE D» + «I» + «CIEMBRE DE » + «2024». */
  const xml = cuerpo(parrafo('PERÍODO FISCAL AL 31 DE D', 'I', 'CIEMBRE DE ', '2024'));
  const r = actualizarAnioPeriodo(xml, 2025);
  assert.strictEqual(r.cambiados, 1);
  assert.strictEqual(textoDe(r.xml), 'PERÍODO FISCAL AL 31 DE DICIEMBRE DE 2025');
});

test('reconoce «DCIEMBRE», el error de mecanografía de la plantilla de MONTACHEM', () => {
  /* No reconocerlo dejaría esa portada sin actualizar por una letra que falta. */
  const xml = cuerpo(parrafo('PERÍODO FISCAL AL 31 DE DCIEMBRE DE 20', '2', '4'));
  assert.strictEqual(actualizarAnioPeriodo(xml, 2025).cambiados, 1);
});

test('la prosa del período fiscal también', () => {
  const xml = cuerpo(parrafo(
    'A continuación, se encuentra un cuadro resumen de las operaciones realizadas durante el ',
    'periodo fiscal', ' ', '20', '2', '4', ', por la Compañía, con sus vinculadas.'));
  const r = actualizarAnioPeriodo(xml, 2025);
  assert.strictEqual(r.cambiados, 1);
  assert.match(textoDe(r.xml), /durante el periodo fiscal 2025, por la Compañía/);
});

test('la conclusión del rango, que antes solo funcionaba con el año entero', () => {
  const xml = cuerpo(parrafo('el margen ajustado durante el ', '20', '2', '4', ' cumple'));
  const r = actualizarAnioPeriodo(xml, 2025);
  assert.strictEqual(r.cambiados, 1);
  assert.match(textoDe(r.xml), /ajustado durante el 2025 cumple/);
});

test('«período» con y sin acento, y en mayúsculas o minúsculas', () => {
  ['PERÍODO FISCAL 2024', 'PERIODO FISCAL 2024', 'Período Fiscal 2024', 'periodo fiscal 2024']
    .forEach((frase) => {
      const r = actualizarAnioPeriodo(cuerpo(parrafo(frase)), 2025);
      assert.strictEqual(r.cambiados, 1, `no reconoció «${frase}»`);
      assert.match(textoDe(r.xml), /2025/);
    });
});

test('un año que ya es el del estudio no se cuenta como cambio', () => {
  const xml = cuerpo(parrafo('PERÍODO FISCAL AL 31 DE DICIEMBRE DE 2025'));
  const r = actualizarAnioPeriodo(xml, 2025);
  assert.strictEqual(r.cambiados, 0);
  assert.strictEqual(r.xml, xml, 'el documento sale idéntico');
});

/* ══════ Lo que NO se toca ══════ */

test('los años del ANEXO B se quedan: son de los estados financieros de las comparables', () => {
  /* Alcance fijado por el usuario. Son del ejercicio anterior a propósito. */
  const xml = cuerpo(parrafo('ANEXO B. Estados financieros de las comparables, periodo fiscal 2024'));
  const r = actualizarAnioPeriodo(xml, 2025);
  assert.strictEqual(r.cambiados, 0);
  assert.strictEqual(r.xml, xml);
});

test('una columna comparativa «2024 / 2023» no se toca', () => {
  /* No lleva ninguna de las frases, así que ni se mira. */
  const xml = cuerpo(parrafo('2024'), parrafo('2023'));
  const r = actualizarAnioPeriodo(xml, 2025);
  assert.strictEqual(r.cambiados, 0);
  assert.strictEqual(r.xml, xml);
});

test('un año suelto en la prosa, sin la frase, se queda', () => {
  const xml = cuerpo(parrafo('La Reserva Federal publicó la serie en 2024 con base anual.'));
  assert.strictEqual(actualizarAnioPeriodo(xml, 2025).cambiados, 0);
});

test('las fuentes citadas conservan su fecha', () => {
  const xml = cuerpo(parrafo('Banco Mundial (2024). Perspectivas económicas mundiales.'));
  assert.strictEqual(actualizarAnioPeriodo(xml, 2025).cambiados, 0);
});

/* ══════ Integridad ══════ */

test('solo cambian los cuatro dígitos: el resto del párrafo queda intacto', () => {
  const xml = cuerpo(parrafo('PERÍODO FISCAL AL 31 DE DICIEMBRE DE ', '2024'));
  const r = actualizarAnioPeriodo(xml, 2025);
  assert.strictEqual(textoDe(xml).length, textoDe(r.xml).length,
    'un año por otro año: la longitud del texto no puede cambiar');
});

test('el formato de cada run y los saltos de línea sobreviven', () => {
  const xml = '<w:document><w:body><w:p>'
    + '<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">PERÍODO FISCAL DE </w:t></w:r>'
    + '<w:r><w:br/></w:r>'
    + '<w:r><w:rPr><w:i/></w:rPr><w:t>2024</w:t></w:r>'
    + '</w:p></w:body></w:document>';
  const r = actualizarAnioPeriodo(xml, 2025);
  assert.strictEqual(r.cambiados, 1);
  assert.match(r.xml, /<w:r><w:br\/><\/w:r>/, 'el salto de línea sigue en su sitio');
  assert.match(r.xml, /<w:rPr><w:b\/><\/w:rPr>/, 'la negrita del primer run');
  assert.match(r.xml, /<w:rPr><w:i\/><\/w:rPr><w:t[^>]*>2025<\/w:t>/, 'la cursiva del año');
});

test('un año gravable ilegible no toca el documento y lo avisa', () => {
  const xml = cuerpo(parrafo('PERÍODO FISCAL DE 2024'));
  const avisos = [];
  const r = actualizarAnioPeriodo(xml, 'no es un año', avisos);
  assert.strictEqual(r.xml, xml);
  assert.strictEqual(r.cambiados, 0);
  assert.ok(avisos.some((a) => /no se pudo leer el año gravable/.test(a)));
});

test('si la plantilla no trae ninguna de las frases, se avisa en vez de callar', () => {
  const avisos = [];
  actualizarAnioPeriodo(cuerpo(parrafo('Un informe sin la frase del período.')), 2025, avisos);
  assert.ok(avisos.some((a) => /no se encontró el año del período fiscal/.test(a)));
});

test('sin XML no revienta', () => {
  assert.deepStrictEqual(actualizarAnioPeriodo('', 2025), { xml: '', cambiados: 0, frases: [] });
  assert.deepStrictEqual(actualizarAnioPeriodo(null, 2025), { xml: '', cambiados: 0, frases: [] });
});

test('aplicarlo dos veces no cambia nada la segunda', () => {
  const xml = cuerpo(parrafo('PERÍODO FISCAL AL 31 DE DICIEMBRE DE 20', '2', '4'));
  const una = actualizarAnioPeriodo(xml, 2025).xml;
  assert.strictEqual(actualizarAnioPeriodo(una, 2025).cambiados, 0);
});

/* ══════ Los documentos reales ══════ */

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PLANTILLAS = [
  ['END GAME 2024', '../../Archivos Prueba/Informe Local End Game _ 2024_v2.docx'],
  ['MC INTERNACIONAL 2024',
    '../../../Cpanel/public_html/demo-precios-transferencia/Archivos Prueba/MC Internacional/Informe local 2024 MC INTERNACIONAL.docx'],
];

PLANTILLAS.forEach(([nombre, rel]) => {
  const ruta = path.resolve(AQUI, rel);
  test(`${nombre}: la portada queda con el año del estudio, sin romper el documento`,
    { skip: !fs.existsSync(ruta) }, async () => {
      const zip = await JSZip.loadAsync(fs.readFileSync(ruta));
      const xml = await zip.file('word/document.xml').async('string');
      const r = actualizarAnioPeriodo(xml, 2025);

      /* La portada, que es lo que reportó el usuario. */
      /* Los párrafos que traen la frase Y un año. Uno que dice «se recomienda analizar el
         mismo periodo fiscal tanto para las comparables como para la parte analizada» no
         lleva año y no hay nada que actualizar en él. */
      const conAnio = (x) => (x.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || [])
        .map(textoDe)
        .filter((t) => /PER[IÍ]ODO FISCAL/i.test(t) && /\b20\d{2}\b/.test(t));
      const antes = conAnio(xml);
      assert.ok(antes.length > 0, 'la plantilla trae la frase del período fiscal con su año');
      assert.ok(antes.some((t) => /2024/.test(t)), 'y ese año es el del informe anterior');
      conAnio(r.xml).forEach((t) => assert.match(t, /2025/,
        `quedó con el año viejo: «${t}»`));

      /* Y el documento sigue siendo el mismo salvo esos dígitos. */
      assert.strictEqual(textoDe(r.xml).length, textoDe(xml).length,
        'un año por otro: la longitud del texto no puede cambiar');
      assert.deepStrictEqual(r.xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g), xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g),
        'las tablas salen sin un byte de diferencia');
      ['<w:sectPr', '<w:bookmarkStart', '<w:drawing', '<w:br'].forEach((patron) => {
        const c = (x) => (x.match(new RegExp(patron, 'g')) || []).length;
        assert.strictEqual(c(r.xml), c(xml), `cambió el número de ${patron}`);
      });

      const errores = [];
      new DOMParser({ onError: (nivel, msg) => { if (nivel !== 'warning') errores.push(msg); } })
        .parseFromString(r.xml, 'text/xml');
      assert.deepStrictEqual(errores, [], 'el XML dejó de ser válido');
    });
});
