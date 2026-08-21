/* Tests del compactado de espacios en blanco del informe.

   El defecto se midió sobre el informe real de MONTACHEM 2025 que el usuario reportó
   («muchos huecos vacíos e incluso una hoja completa en blanco»): 552 de sus 1.421 párrafos
   fuera de tablas estaban vacíos, 147 renglones en rachas de hasta 31 seguidos ≈ 3 páginas
   de aire. La plantilla empuja cada capítulo a la hoja siguiente con párrafos vacíos, y ese
   relleno está calibrado a la longitud del contenido ORIGINAL: al sustituirlo por el del
   estudio nuevo, sobra o falta.

   Las dos afirmaciones que sostienen este módulo, y que estas pruebas separan:
     · los huecos de relleno desaparecen;
     · NO desaparece nada más — ni una letra, ni una tabla, ni un marcador del índice. */

import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import {
  compactarEspaciosOoxml, nivelesDeTitulo, esVacioDescartable, esTitulo,
} from './compactarEspaciosOoxml.js';

const STYLES = `<w:styles>
  <w:style w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:styleId="Ttulo1"><w:name w:val="heading 1"/>
    <w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
  <w:style w:styleId="Ttulo2"><w:name w:val="heading 2"/>
    <w:pPr><w:outlineLvl w:val="1"/></w:pPr></w:style>
</w:styles>`;

const vacio = () => '<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr></w:p>';
const conTexto = (t, estilo = 'Normal') => `<w:p><w:pPr><w:pStyle w:val="${estilo}"/></w:pPr>`
  + `<w:r><w:t>${t}</w:t></w:r></w:p>`;
const nVacios = (n) => vacio().repeat(n);
const cuerpo = (interior) => `<w:document><w:body>${interior}</w:body></w:document>`;

const cuenta = (xml, patron) => (xml.match(new RegExp(patron, 'g')) || []).length;

/* ══════ Lo que se compacta ══════ */

test('una racha larga de vacíos se convierte en un salto de página', () => {
  /* Ocho renglones en blanco no son separación: es alguien empujando el capítulo a la hoja
     siguiente. El salto hace lo mismo sin depender de cuánto midan las páginas anteriores. */
  const xml = cuerpo(conTexto('Fin del capítulo anterior.') + nVacios(10)
    + conTexto('INFORMACIÓN ESPECÍFICA', 'T1XMAY'));
  const r = compactarEspaciosOoxml(xml, STYLES);
  assert.strictEqual(r.saltos, 1);
  assert.strictEqual(r.vaciosQuitados, 10);
  assert.strictEqual(cuenta(r.xml, '<w:br w:type="page"/>'), 1);
  assert.match(r.xml, /INFORMACIÓN ESPECÍFICA/);
});

test('el estilo del capítulo no hace falta: manda la longitud de la racha', () => {
  /* En el informe de MONTACHEM los capítulos usan `T1XMAY` y `Prrafodelista`, y ninguno de
     los dos está declarado en `word/styles.xml` —solo `Ttulo1..9`, que el documento no usa—,
     así que no hay `outlineLvl` del que deducir nada. */
  const xml = cuerpo(conTexto('Prosa.') + nVacios(24) + conTexto('TENDENCIAS DE LA ECONOMÍA', 'DesconocidoXYZ'));
  const r = compactarEspaciosOoxml(xml, '<w:styles></w:styles>');
  assert.strictEqual(r.saltos, 1, 'sin styles.xml útil, la racha sola basta');
});

test('una racha corta ante un título declarado también salta de página', () => {
  /* Cuando el documento SÍ declara el nivel, tres vacíos ante un capítulo son relleno. */
  const xml = cuerpo(conTexto('Prosa.') + nVacios(3) + conTexto('ANEXO C', 'Ttulo1'));
  assert.strictEqual(compactarEspaciosOoxml(xml, STYLES).saltos, 1);
});

test('una racha corta que no precede a un capítulo se recorta, no salta', () => {
  /* El hueco entre la prosa y el título de una tabla: sobra, pero un salto de página ahí
     partiría la tabla de su párrafo introductorio. */
  const xml = cuerpo(conTexto('…el método apropiado es:') + nVacios(5)
    + conTexto('Tabla 5. Método de Precios de Transferencia Aplicable'));
  const r = compactarEspaciosOoxml(xml, STYLES);
  assert.strictEqual(r.saltos, 0);
  assert.strictEqual(r.vaciosQuitados, 3, 'de cinco quedan dos');
  assert.strictEqual(cuenta(r.xml, '<w:br w:type="page"/>'), 0);
});

test('los vacíos que preceden a un salto de página ya existente se van todos', () => {
  /* La hoja COMPLETAMENTE en blanco que reportó el usuario. En su informe, tras «En
     consecuencia, los resultados obtenidos…» vienen nueve vacíos y DESPUÉS un salto de
     página, antes de «INFORMACIÓN GENERAL»: los nueve llenan lo que queda de la hoja y el
     salto fuerza otra. Con el salto ya puesto, esos vacíos no sobran a medias. */
  const xml = cuerpo(conTexto('En consecuencia, los resultados obtenidos…') + nVacios(9)
    + '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' + conTexto('INFORMACIÓN GENERAL', 'T1XMAY'));
  const r = compactarEspaciosOoxml(xml, STYLES);
  assert.strictEqual(r.vaciosQuitados, 9, 'los nueve, no siete');
  assert.strictEqual(r.saltos, 0, 'no se añade un segundo salto');
  assert.strictEqual(cuenta(r.xml, '<w:br[^>]*w:type="page"'), 1, 'sigue habiendo exactamente uno');
});

test('dos vacíos seguidos son aire y se respetan', () => {
  const xml = cuerpo(conTexto('Uno.') + nVacios(2) + conTexto('Dos.'));
  const r = compactarEspaciosOoxml(xml, STYLES);
  assert.strictEqual(r.vaciosQuitados, 0);
  assert.strictEqual(r.xml, xml);
});

/* ══════ Lo que NO se toca ══════ */

test('una racha NO atraviesa una tabla: el defecto que se midió sobre el informe real', () => {
  /* Los párrafos de dentro de las tablas se excluyen del recorrido. Sin comprobar que dos
     vacíos sean CONTIGUOS en el XML, uno de antes de una tabla y otro de después quedaban
     «consecutivos» y el tramo que los sustituye se tragaba la tabla de en medio. Medido: en
     el informe de MONTACHEM desaparecía la tabla de la fórmula del Índice de Berry. */
  const tabla = '<w:tbl><w:tr><w:tc>' + conTexto('Razón Berry = (Ub/Go vs. V)* 100') + '</w:tc></w:tr></w:tbl>';
  const xml = cuerpo(conTexto('Antes.') + nVacios(5) + tabla + nVacios(5) + conTexto('Después.'));
  const r = compactarEspaciosOoxml(xml, STYLES);

  assert.match(r.xml, /Razón Berry/, 'la tabla no puede desaparecer');
  assert.strictEqual(cuenta(r.xml, '<w:tbl>'), 1);
  /* Las dos rachas se tratan por separado: cinco y cinco, dos que quedan de cada una. */
  assert.strictEqual(r.vaciosQuitados, 6);
});

test('el párrafo que lleva el sectPr no se quita nunca', () => {
  /* Define tamaño de hoja, márgenes y encabezados: quitarlo cambia el papel del informe. */
  const conSect = '<w:p><w:pPr><w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:pPr></w:p>';
  const xml = cuerpo(conTexto('Prosa.') + nVacios(6) + conSect + conTexto('Sigue.'));
  const r = compactarEspaciosOoxml(xml, STYLES);
  assert.strictEqual(cuenta(r.xml, '<w:sectPr'), 1);
  assert.match(r.xml, /w:w="12240"/);
});

test('el párrafo que ancla una entrada del índice no se quita', () => {
  const conMarca = '<w:p><w:bookmarkStart w:id="7" w:name="_Toc209078522"/><w:bookmarkEnd w:id="7"/></w:p>';
  const xml = cuerpo(conTexto('Prosa.') + nVacios(4) + conMarca + nVacios(4) + conTexto('Sigue.'));
  const r = compactarEspaciosOoxml(xml, STYLES);
  assert.strictEqual(cuenta(r.xml, '<w:bookmarkStart'), 1, 'el destino del índice sigue ahí');
  assert.match(r.xml, /_Toc209078522/);
});

test('un párrafo con imagen no está vacío aunque no tenga texto', () => {
  const conImagen = '<w:p><w:r><w:drawing><wp:inline/></w:drawing></w:r></w:p>';
  const xml = cuerpo(conTexto('Prosa.') + nVacios(4) + conImagen + nVacios(4) + conTexto('Sigue.'));
  const r = compactarEspaciosOoxml(xml, STYLES);
  assert.strictEqual(cuenta(r.xml, '<w:drawing'), 1);
});

test('un párrafo con un campo o una nota al pie tampoco', () => {
  [
    '<w:p><w:r><w:instrText>PAGEREF _Toc1 \\h</w:instrText></w:r></w:p>',
    '<w:p><w:r><w:footnoteReference w:id="3"/></w:r></w:p>',
  ].forEach((especial) => {
    const xml = cuerpo(conTexto('Prosa.') + nVacios(4) + especial + nVacios(4) + conTexto('Sigue.'));
    assert.ok(compactarEspaciosOoxml(xml, STYLES).xml.includes(especial),
      `no debería quitarse: ${especial}`);
  });
});

test('los párrafos vacíos DENTRO de una tabla se quedan como están', () => {
  /* La altura de una celda es diseño de la tabla, no relleno de página. */
  const tabla = '<w:tbl><w:tr><w:tc>' + nVacios(6) + conTexto('Dato') + '</w:tc></w:tr></w:tbl>';
  const xml = cuerpo(conTexto('Antes.') + tabla + conTexto('Después.'));
  const r = compactarEspaciosOoxml(xml, STYLES);
  assert.strictEqual(r.vaciosQuitados, 0);
  assert.strictEqual(r.xml, xml);
});

test('no se inserta un salto al final del cuerpo, que añadiría una hoja en blanco', () => {
  const xml = cuerpo(conTexto('Última frase del informe.') + nVacios(12));
  const r = compactarEspaciosOoxml(xml, STYLES);
  assert.strictEqual(r.saltos, 0, 'no hay contenido detrás al que llevar');
  assert.strictEqual(cuenta(r.xml, '<w:br[^>]*w:type="page"'), 0);
  assert.strictEqual(r.vaciosQuitados, 10, 'pero la racha se recorta igual');
});

/* ══════ Forma y degradación ══════ */

test('aplicarlo dos veces da el mismo resultado que una', () => {
  const xml = cuerpo(conTexto('Prosa.') + nVacios(10) + conTexto('CAPÍTULO', 'Ttulo1')
    + nVacios(5) + conTexto('Tabla 1.'));
  const una = compactarEspaciosOoxml(xml, STYLES).xml;
  const dos = compactarEspaciosOoxml(una, STYLES);
  assert.strictEqual(dos.xml, una);
  assert.strictEqual(dos.vaciosQuitados, 0);
});

test('sin XML no revienta', () => {
  assert.deepStrictEqual(compactarEspaciosOoxml('', STYLES), { xml: '', saltos: 0, vaciosQuitados: 0 });
  assert.deepStrictEqual(compactarEspaciosOoxml(null, STYLES), { xml: '', saltos: 0, vaciosQuitados: 0 });
});

test('un documento sin rachas sale idéntico', () => {
  const xml = cuerpo(conTexto('Uno.') + vacio() + conTexto('Dos.') + vacio() + conTexto('Tres.'));
  const r = compactarEspaciosOoxml(xml, STYLES);
  assert.strictEqual(r.xml, xml);
});

/* ══════ Los auxiliares ══════ */

test('nivelesDeTitulo lee el nivel del outlineLvl y del nombre canónico', () => {
  const n = nivelesDeTitulo(STYLES);
  assert.strictEqual(n.get('Ttulo1'), 0);
  assert.strictEqual(n.get('Ttulo2'), 1);
  assert.ok(!n.has('Normal'));
  /* Sin outlineLvl, el nombre «heading 1» todavía identifica el nivel. */
  const soloNombre = '<w:styles><w:style w:styleId="H1"><w:name w:val="heading 1"/></w:style></w:styles>';
  assert.strictEqual(nivelesDeTitulo(soloNombre).get('H1'), 0);
});

test('esTitulo acepta el outlineLvl puesto en el propio párrafo', () => {
  const p = '<w:p><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:r><w:t>CAP</w:t></w:r></w:p>';
  assert.ok(esTitulo(p, new Map(), 0));
  const sub = '<w:p><w:pPr><w:outlineLvl w:val="2"/></w:pPr><w:r><w:t>sub</w:t></w:r></w:p>';
  assert.ok(!esTitulo(sub, new Map(), 0), 'un nivel 2 no es capítulo');
});

test('esVacioDescartable distingue «sin texto» de «sin contenido»', () => {
  assert.ok(esVacioDescartable(vacio()));
  assert.ok(esVacioDescartable('<w:p/>'));
  assert.ok(!esVacioDescartable(conTexto('algo')));
  ['<w:sectPr/>', '<w:bookmarkStart w:id="1"/>', '<w:drawing/>', '<w:fldChar/>']
    .forEach((x) => assert.ok(!esVacioDescartable(`<w:p>${x}</w:p>`), `${x} es contenido`));
});

/* ══════ El informe real que reportó el usuario ══════ */

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const REAL = path.resolve(AQUI, '../../Archivos Prueba/Informe Local End Game _ 2024_v2.docx');

test('sobre la plantilla real: los huecos se van y no se pierde nada',
  { skip: !fs.existsSync(REAL) }, async () => {
    /* La plantilla del repositorio, que es la que produce el informe: 612 de sus 1.302
       párrafos fuera de tablas están vacíos, en rachas de hasta 35. Aquí se afirma lo que
       importa de verdad — que compactar no rompe el documento. */
    const zip = await JSZip.loadAsync(fs.readFileSync(REAL));
    const xml = await zip.file('word/document.xml').async('string');
    const styles = await zip.file('word/styles.xml').async('string');
    const r = compactarEspaciosOoxml(xml, styles);

    const soloTexto = (x) => (x.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [])
      .map((t) => t.replace(/<[^>]+>/g, '')).join('');
    assert.strictEqual(soloTexto(r.xml), soloTexto(xml), 'no se pierde ni una letra');
    assert.deepStrictEqual(r.xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g), xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g),
      'las tablas salen sin un byte de diferencia');

    [['<w:sectPr', 'la configuración de sección'], ['<w:bookmarkStart', 'los destinos del índice'],
      ['<w:drawing', 'las imágenes'], ['<w:footnoteReference', 'las notas al pie'],
      ['<w:fldChar', 'los campos']].forEach(([patron, que]) => {
      assert.strictEqual(cuenta(r.xml, patron), cuenta(xml, patron), `se perdieron ${que}`);
    });

    const errores = [];
    new DOMParser({ onError: (nivel, msg) => { if (nivel !== 'warning') errores.push(msg); } })
      .parseFromString(r.xml, 'text/xml');
    assert.deepStrictEqual(errores, [], 'el XML dejó de ser válido');

    assert.ok(r.vaciosQuitados > 50,
      `debería retirar decenas de renglones de relleno, retiró ${r.vaciosQuitados}`);

    /* Y no queda ninguna racha larga: es la afirmación que cierra el defecto. */
    /* Las tablas y los cuadros de texto quedan fuera de la cuenta: son contextos con su
       propia maquetación, y sus párrafos vacíos no empujan nada en la hoja. */
    const soloCuerpo = r.xml
      .replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, '§T§')
      .replace(/<w:txbxContent[\s\S]*?<\/w:txbxContent>/g, '§T§');
    const bloques = soloCuerpo.match(/<w:p(?:\s[^>]*)?\/>|<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>|§T§/g) || [];
    let racha = 0;
    let maxima = 0;
    bloques.forEach((b) => {
      if (b !== '§T§' && esVacioDescartable(b)) racha += 1;
      else { maxima = Math.max(maxima, racha); racha = 0; }
    });
    assert.ok(maxima <= 2, `no debería quedar ninguna racha de más de dos, quedó una de ${maxima}`);
  });

test('sobre la plantilla real: el resultado es estable al repetirlo',
  { skip: !fs.existsSync(REAL) }, async () => {
    const zip = await JSZip.loadAsync(fs.readFileSync(REAL));
    const xml = await zip.file('word/document.xml').async('string');
    const styles = await zip.file('word/styles.xml').async('string');
    const una = compactarEspaciosOoxml(xml, styles).xml;
    assert.strictEqual(compactarEspaciosOoxml(una, styles).vaciosQuitados, 0);
  });
