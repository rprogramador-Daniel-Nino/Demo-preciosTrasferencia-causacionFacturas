import { test } from 'node:test';
import assert from 'node:assert/strict';
import PizZip from 'pizzip';
import { aDocxBuffer } from './docxWriter.js';
import { HOJA_TWIPS } from './estiloDocumento.js';

/* Relee el .docx generado. Es lo que hace que todo esto se pueda probar sin Word. */
const abrir = async (html, recursos = [], anexo = []) => {
  const zip = new PizZip(await aDocxBuffer({ html, recursos, anexo }));
  const leer = (p) => (zip.file(p) ? zip.file(p).asText() : null);
  return { zip, leer, doc: leer('word/document.xml') };
};

test('el .docx trae las partes que Word necesita', async () => {
  const { zip } = await abrir('<div class="pagina" data-pagina="1"><p>hola</p></div>');
  for (const parte of [
    '[Content_Types].xml', '_rels/.rels', 'word/document.xml',
    'word/_rels/document.xml.rels', 'word/styles.xml', 'word/footer1.xml',
  ]) {
    assert.ok(zip.file(parte), 'falta ' + parte);
  }
});

test('la hoja del .docx es la misma que la del previo', async () => {
  /* Si se separan, los saltos que se ven en pantalla caen donde no van. */
  const { doc } = await abrir('<p>hola</p>');
  assert.match(doc, new RegExp('w:w="' + HOJA_TWIPS.ancho + '"'));
  assert.match(doc, new RegExp('w:h="' + HOJA_TWIPS.alto + '"'));
  assert.match(doc, new RegExp('w:top="' + HOJA_TWIPS.margen + '"'));
  assert.match(doc, new RegExp('w:bottom="' + HOJA_TWIPS.pie + '"'));
  assert.match(doc, new RegExp('w:footer="' + HOJA_TWIPS.borde + '"'));
});

test('la tipografía sale del informe, no de un gusto propio', async () => {
  /* El extractor la anota en el HTML al leer las fuentes del PDF. En medios puntos: 10 pt son
     20. Se usa a propósito una tipografía DISTINTA de la de reserva (Arial 12): con Arial 12
     el test pasaría igual si el writer ignorara el HTML y escribiera Arial a mano, y entonces
     no demostraría nada. Junto con el test siguiente, el par distingue los dos casos. */
  const { leer } = await abrir(
    '<div data-extractor="7" data-estilo-base="Times New Roman|10"></div><p>hola</p>');
  const estilos = leer('word/styles.xml');
  assert.match(estilos, /w:ascii="Times New Roman"/);
  assert.match(estilos, /w:sz w:val="20"/);
});

test('sin marca de tipografía cae en Arial 12, no en una serif de pantalla', async () => {
  const { leer } = await abrir('<p>hola</p>');
  assert.match(leer('word/styles.xml'), /w:ascii="Arial"/);
  assert.match(leer('word/styles.xml'), /w:sz w:val="24"/);
});

test('el pie lleva el campo PAGE de Word, no un número literal', async () => {
  /* Un número literal miente en cuanto Word repagina. */
  const { leer } = await abrir('<p>hola</p>');
  assert.match(leer('word/footer1.xml'), /PAGE/);
});

test('el texto del documento llega', async () => {
  const { doc } = await abrir('<p>informe local de precios de transferencia</p>');
  assert.match(doc, /informe local de precios de transferencia/);
});

test('la negrita y la cursiva del informe llegan al .docx', async () => {
  const { doc } = await abrir(
    '<p>normal <strong>negrita</strong> <em>cursiva</em></p>');
  assert.match(doc, /<w:b\/>/, 'no hay negrita');
  assert.match(doc, /<w:i\/>/, 'no hay cursiva');
});

test('la negrita anidada en un span con familia propia no se pierde', async () => {
  /* Es la forma exacta que emite el extractor, y en el .doc hubo que forzarla con CSS. */
  const { doc } = await abrir(
    '<p><strong><span style="font-family:\'Britannic\'">TÍTULO</span></strong></p>');
  assert.match(doc, /<w:b\/>/);
  assert.match(doc, /w:ascii="Britannic"/);
  assert.match(doc, /TÍTULO/);
});

test('los encabezados usan los estilos de serie, o el índice de Word no los ve', async () => {
  const { doc } = await abrir('<h1>UNO</h1><h2>DOS</h2><h3>TRES</h3><h4>CUATRO</h4>');
  for (const estilo of ['Heading1', 'Heading2', 'Heading3', 'Heading4']) {
    assert.match(doc, new RegExp('w:val="' + estilo + '"'), 'falta ' + estilo);
  }
});

test('los párrafos van justificados, como el informe', async () => {
  const { doc } = await abrir('<p>texto</p>');
  assert.match(doc, /w:val="both"/);
});

test('el resaltado de pantalla no llega al documento', async () => {
  /* En el .doc se colaba y cada dato sustituido salía más negrita y con aire a los lados. */
  const { doc } = await abrir('<p>NIT <span class="pt-valor">900123456-7</span></p>');
  assert.match(doc, /900123456-7/);
  assert.doesNotMatch(doc, /pt-valor/);
  assert.doesNotMatch(doc, /F0FDF4/);
});

test('un párrafo vacío sigue siendo un párrafo', async () => {
  /* El informe centra la portada con párrafos vacíos: 35 seguidos. Descartarlos movería la
     portada entera. */
  const { doc } = await abrir('<p></p><p></p><p>algo</p>');
  assert.equal((doc.match(/<w:p[ >]/g) || []).length >= 3, true);
});

test('la familia tipográfica se lee con comillas simples, dobles o sin ellas', async () => {
  const casos = [
    ['<span style="font-family:\'Britannic\'">x</span>', 'Britannic'],
    ['<span style=\'font-family:"Times New Roman"\'>x</span>', 'Times New Roman'],
    ['<span style="font-family:Georgia">x</span>', 'Georgia'],
  ];
  for (const [html, familia] of casos) {
    const { doc } = await abrir('<p>' + html + '</p>');
    assert.match(doc, new RegExp('w:ascii="' + familia + '"'), 'falta ' + familia);
  }
});

test('un párrafo anidado en otro no se funde con él', async () => {
  /* El HTML del contentEditable puede tener párrafos sin cerrar, y `htmlAArbol` los cierra
     implícitamente. Pero la función tiene que aguantar recibirlos anidados. */
  const { doc } = await abrir('<p>fuera<p>dentro</p></p>');
  const parrafos = (doc.match(/<w:p[ >]/g) || []).length;
  assert.ok(parrafos >= 2, 'debería haber al menos 2 párrafos, tiene ' + parrafos);
  assert.match(doc, /fuera/);
  assert.match(doc, /dentro/);
});

test('un fragmento en línea no sale además como párrafo suelto', async () => {
  /* Un arreglo anterior duplicaba el texto: salía una vez bien formateado y otra como
     párrafo espurio. Esto ocurría con <p><strong>...</strong></p>. */
  const { doc } = await abrir(
    '<p><strong><span style="font-family:\'Britannic\'">TÍTULO</span></strong></p>');
  const conteo = (doc.match(/TÍTULO/g) || []).length;
  assert.equal(conteo, 1, 'TÍTULO debe aparecer exactamente una vez, aparece ' + conteo);
  const parrafos = (doc.match(/<w:p[ >]/g) || []).length;
  assert.equal(parrafos, 1, 'debe haber exactamente un párrafo, hay ' + parrafos);
});

test('ningún texto sale dos veces', async () => {
  /* Este test existe porque un arreglo anterior duplicaba el texto en línea: salía una vez
     bien formateado y otra como párrafo espurio sin formato. */
  const casos = [
    '<p><strong>a</strong></p>',
    '<p>a<div>b</div>c',
    '<p><span>a</span>b</p>',
    '<div><p>a</p></div>',
    '<table><tr><td>a</td><td>b</td></tr></table>',
    '<p>fuera<p>dentro</p></p>',
  ];
  for (const html of casos) {
    const { doc } = await abrir(html);
    /* Extraer solo el texto de los elementos <w:t>, no de todo el XML. */
    const textos = (doc.match(/<w:t[^>]*>([^<]+)<\/w:t>/g) || [])
      .map((m) => m.replace(/<w:t[^>]*>/, '').replace(/<\/w:t>/, ''));
    for (const texto of textos) {
      if (texto.trim()) {
        const conteo = (doc.match(new RegExp('<w:t[^>]*>' + texto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '<\\/w:t>', 'g')) || []).length;
        assert.equal(conteo, 1, html + ': "' + texto + '" aparece ' + conteo + ' veces en <w:t>');
      }
    }
  }
});

test('el orden del documento se conserva', async () => {
  const { doc } = await abrir('<p>uno</p>texto suelto<p>dos</p>');
  const indUno = doc.indexOf('uno');
  const indSuelto = doc.indexOf('texto suelto');
  const indDos = doc.indexOf('dos');
  assert.ok(indUno > -1 && indSuelto > -1 && indDos > -1, 'faltan textos');
  assert.ok(indUno < indSuelto, 'uno debe venir antes que texto suelto');
  assert.ok(indSuelto < indDos, 'texto suelto debe venir antes que dos');
});
