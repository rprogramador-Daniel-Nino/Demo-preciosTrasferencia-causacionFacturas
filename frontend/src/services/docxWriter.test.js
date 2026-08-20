import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import PizZip from 'pizzip';
import { aDocxBuffer } from './docxWriter.js';
import { extraerReferencia } from './pdfReferenceExtractor.js';
import { HOJA_TWIPS, PUNTOS_TABLA, FUENTE_MACRO, PUNTOS_MACRO } from './estiloDocumento.js';

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

test('las entradas del índice llevan la guía de puntos de Word, no puntos de texto', async () => {
  /* Con puntos literales, la fila deja de terminar donde debe en cuanto cambia la métrica de
     la fuente: es lo que hacía que el índice se viera desordenado. */
  const { doc } = await abrir(
    '<p>1.2. Derechos y Obligaciones ........................ 25</p>');
  assert.match(doc, /w:leader="dot"/, 'no hay guía de puntos');
  assert.match(doc, /1\.2\. Derechos y Obligaciones/);
  assert.match(doc, /25/);
  /* Y los puntos literales desaparecen. */
  assert.doesNotMatch(doc, /\.{8}/);
});

test('una entrada con un solo punto también se alinea', async () => {
  /* Es una entrada real del informe de referencia. Con la regla anterior, de cuatro puntos,
     se quedaba fuera. */
  const { doc } = await abrir(
    '<p>1.5 Razones de rechazo (Filtros Cuantitativos – Filtros Cualitativos) . 33</p>');
  assert.match(doc, /w:leader="dot"/, 'no hay guía de puntos');
  assert.match(doc, /1\.5 Razones de rechazo \(Filtros Cuantitativos – Filtros Cualitativos\)/);
  assert.match(doc, /33/);
});

test('un párrafo normal del informe no se convierte en entrada de índice', async () => {
  /* Este test sostiene la relajación de la regla: si alguien la afloja más, aquí se nota.
     Se comprueba que ninguno de estos produce w:leader="dot". */
  const casos = [
    '<p>y así sucesivamente... hasta el final</p>',
    '<p>El margen fue de 3.5 puntos porcentuales en 2024</p>',
    '<p>Ver anexo A ....... y también el B</p>',
    '<p>Los topes en UVT para 2024 fueron 45.000 y 10.000</p>',
    '<p>La utilidad operacional creció 2.3 veces</p>',
  ];
  for (const html of casos) {
    const { doc } = await abrir(html);
    assert.doesNotMatch(doc, /w:leader="dot"/, 'se detectó como entrada: ' + html);
  }
});

test('un encabezado con puntos y número no se convierte en entrada de índice', async () => {
  /* La detección solo corre cuando el bloque no es encabezado. */
  const { doc } = await abrir('<h2>1. Descripción de la Compañía ........... 6</h2>');
  assert.doesNotMatch(doc, /w:leader="dot"/, 'un encabezado no debe tener guía de puntos');
  assert.match(doc, /1\. Descripción de la Compañía/);
});

test('las tablas salen como tablas de Word, con anchos en DXA', async () => {
  /* La skill de docx lo marca como trampa: hacen falta columnWidths en la tabla Y width en
     cada celda, las dos en DXA. Con porcentajes, Google Docs rompe. */
  const { doc } = await abrir(
    '<table><tr><th>Concepto</th><th>Valor</th></tr>' +
    '<tr><td>Activo</td><td>1.000</td></tr></table>');
  assert.match(doc, /<w:tbl>/);
  assert.match(doc, /<w:tblGrid>/);
  assert.match(doc, /w:type="dxa"/);
  assert.match(doc, /Concepto/);
  assert.match(doc, /1\.000/);
  assert.equal((doc.match(/<w:tr[ >]/g) || []).length, 2, 'deben ser dos filas');
});

test('los anchos de columna suman el ancho de la caja de texto', async () => {
  /* Si no suman, Word recalcula y las columnas salen donde quiera. La caja del informe mide
     21,6 − 2 × 2,5 = 16,6 cm. */
  const { doc } = await abrir('<table><tr><td>a</td><td>b</td><td>c</td></tr></table>');
  const grid = /<w:tblGrid>([\s\S]*?)<\/w:tblGrid>/.exec(doc)[1];
  const anchos = [...grid.matchAll(/w:w="(\d+)"/g)].map((m) => Number(m[1]));
  assert.equal(anchos.length, 3);
  const caja = HOJA_TWIPS.ancho - 2 * HOJA_TWIPS.margen;
  assert.ok(Math.abs(anchos.reduce((a, b) => a + b, 0) - caja) <= 3,
    'los anchos suman ' + anchos.reduce((a, b) => a + b, 0) + ' y la caja mide ' + caja);
});

test('una fila sin celdas no produce una tabla inválida', async () => {
  /* El PDF cuelga un `P` vacío de cada `TR`. En el .doc eso fue un documento de 834 páginas
     porque Word sacaba el párrafo de la tabla. Aquí una fila que se queda sin celdas
     simplemente no se emite. */
  const { doc } = await abrir('<table><tr><p></p></tr><tr><td>a</td></tr></table>');
  assert.equal((doc.match(/<w:tr[ >]/g) || []).length, 1);
  assert.match(doc, /<w:tbl>/);
});

test('una tabla sin ninguna fila válida no se emite', async () => {
  const { doc } = await abrir('<table><tr><p></p></tr></table><p>después</p>');
  assert.doesNotMatch(doc, /<w:tbl>/);
  assert.match(doc, /después/);
});

test('la letra del encabezado de tabla sale negra y en negrita sobre el gris', async () => {
  /* Antes, el fallback que ponía el color era código muerto: `bloquesDe` siempre vuelca el
     texto suelto de una celda como párrafo (el `volcar()` final, fuera del `for`), así que la
     rama que llevaba el color nunca se alcanzaba y los encabezados salían con letra oscura
     sobre un fondo oscuro — ilegibles. Desde el 2026-08-19 el fondo es gris (#999999) y la
     letra negra en negrita, por el modelo que fijó el usuario. La negrita va explícita: en el
     previo la pone el navegador por defecto para `th`, y el .docx no tiene tal defecto, así
     que sin esto la pantalla y el archivo divergían en toda cabecera del informe. */
  const { doc } = await abrir(
    '<table><tr><th>Concepto</th><th>Valor</th></tr><tr><td>Activo</td></tr></table>');
  assert.match(doc, /<w:shd[^>]*w:fill="999999"[^>]*\/>/);
  assert.match(doc, /<w:shd[^>]*w:val="clear"[^>]*\/>/, 'CLEAR y no SOLID: SOLID sale negro');
  const negros = (doc.match(/<w:color w:val="000000"\/>/g) || []).length;
  assert.equal(negros, 2, 'debe haber un <w:color w:val="000000"/> por cada th, ni uno más');
  assert.equal((doc.match(/<w:b\/>/g) || []).length, 2, 'cada th va en negrita, y sólo los th');
  assert.doesNotMatch(doc, /FFFFFF/, 'queda letra blanca de la cabecera vieja');
  assert.doesNotMatch(doc, /0E1726/, 'queda el fondo oscuro viejo');
  /* La celda de datos (`td`) no lleva ni el relleno ni la negrita del encabezado. */
  const celdaActivo = /<w:tc>(?:(?!<w:tc>)[\s\S])*?Activo[\s\S]*?<\/w:tc>/.exec(doc)[0];
  assert.doesNotMatch(celdaActivo, /w:fill="999999"/);
});

test('la rejilla de la tabla es negra, con el borde exterior más grueso', async () => {
  /* El modelo del usuario lleva rejilla completa: 1px negro entre celdas y 1,5px alrededor.
     Antes eran bordes #E2E8F0 en las cuatro caras de CADA celda, lo que dejaba el contorno
     exterior del mismo grosor que el interior. Los bordes van en la TABLA y no en la celda a
     propósito: en OOXML `tblBorders` se aplica donde la celda no declara los suyos, y es la
     única forma de que el contorno sea más grueso que la rejilla sin calcular, celda a celda,
     cuál toca el borde de la tabla — sobre las 890 filas del informe. En octavos de punto:
     1px = 0,75pt = 6; 1,5px = 1,5pt = 12 (el redondeo hacia arriba se ve mejor que 9). */
  const { doc } = await abrir('<table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table>');
  const bordes = /<w:tblBorders>([\s\S]*?)<\/w:tblBorders>/.exec(doc);
  assert.ok(bordes, 'la tabla no declara bordes propios');
  /* Atributo a atributo y no como cadena literal: `docx` los emite en su propio orden
     (val, color, sz) y fijarlo aquí ataría el test a un detalle de la librería en vez de a
     lo que el informe tiene que llevar. */
  const atributosDe = (nombre) => new RegExp('<w:' + nombre + '\\s([^>]*)/>').exec(bordes[1]);
  for (const [lados, sz, que] of [
    [['top', 'bottom', 'left', 'right'], '12', 'el borde exterior'],
    [['insideH', 'insideV'], '6', 'la rejilla'],
  ]) {
    for (const lado of lados) {
      const attrs = atributosDe(lado);
      assert.ok(attrs, 'falta ' + que + ' ' + lado);
      assert.match(attrs[1], /w:val="single"/, que + ' ' + lado + ' no es una línea simple');
      assert.match(attrs[1], /w:color="000000"/, que + ' ' + lado + ' no es negro');
      assert.match(attrs[1], new RegExp('w:sz="' + sz + '"'), que + ' ' + lado + ' no mide lo debido');
    }
  }
  assert.doesNotMatch(doc, /E2E8F0/, 'queda el borde gris claro viejo');
  /* Y la celda ya no declara los suyos, o pisaría el contorno grueso de la tabla. */
  assert.doesNotMatch(doc, /<w:tcBorders>/, 'la celda sigue declarando bordes propios');
});

test('las celdas van centradas y a 10 pt en Arial, sin heredar del cuerpo', async () => {
  /* Decisión del usuario (2026-08-19): la tabla se ve igual en todos los informes. Se usa una
     base DISTINTA a propósito —Times New Roman 14, que son 28 medios puntos— porque con Arial
     12 el test pasaría igual si la celda heredara del cuerpo, y no demostraría nada. */
  const { doc } = await abrir(
    '<div data-extractor="7" data-estilo-base="Times New Roman|14"></div>' +
    '<table><tr><td>Activo</td></tr></table>');
  const celda = /<w:tc>[\s\S]*?<\/w:tc>/.exec(doc)[0];
  assert.match(celda, /<w:sz w:val="20"\/>/, 'la celda no va a 10 pt');
  assert.doesNotMatch(celda, /<w:sz w:val="28"\/>/, 'la celda heredó el cuerpo de 14 pt');
  assert.match(celda, /w:ascii="Arial"/, 'la celda no va en Arial');
  assert.doesNotMatch(celda, /w:ascii="Times New Roman"/, 'la celda heredó la letra del cuerpo');
  assert.match(celda, /<w:jc w:val="center"\/>/, 'el párrafo de la celda no va centrado');
  assert.match(celda, /<w:vAlign w:val="center"\/>/, 'la celda no va centrada en vertical');
});

test('una tabla dentro de una celda no se aplana en la de fuera', async () => {
  /* Dos causas, no una: `recogerFilas` recorría todos los descendientes buscando `tr` (así que
     las filas de una tabla anidada salían como filas hermanas de la exterior), y antes de eso
     `htmlAArbol` ya aplanaba el árbol: el cierre implícito de `tr` buscaba la última `tr` en
     toda la pila sin respetar el límite de una tabla anidada, y encontraba la del exterior. */
  const { doc } = await abrir(
    '<table><tr><td>fuera<table><tr><td>dentro</td></tr></table></td></tr></table>');
  assert.equal((doc.match(/<w:tbl>/g) || []).length, 2, 'deben ser dos tablas');
  const exterior = /<w:tbl>([\s\S]*)<\/w:tbl>/.exec(doc)[1];
  const filasExterior = exterior.split('<w:tbl>')[0];
  assert.equal((filasExterior.match(/<w:tr[ >]/g) || []).length, 1,
    'la tabla exterior debe tener una sola fila');
  assert.match(doc, /fuera/);
  assert.match(doc, /dentro/);
  assert.equal((doc.match(/fuera/g) || []).length, 1);
  assert.equal((doc.match(/dentro/g) || []).length, 1);
});

/* PNG de 1×1 válido, para no depender del PDF real en los tests de unidad. */
const PNG_1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJ' +
  'AAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

test('las imágenes van como binario en word/media, no en base64', async () => {
  /* En el .doc iban en base64 dentro del propio archivo y pesaba 3,3 MB. */
  const { zip } = await abrir(
    '<p><img data-recurso="logo" style="width:5.53cm;height:1.23cm" /></p>',
    [{ id: 'logo', dataUrl: PNG_1x1 }]);
  const media = Object.keys(zip.files).filter((f) => /^word\/media\/.+\./.test(f));
  assert.equal(media.length, 1, 'debe haber un archivo por imagen');
  assert.match(zip.file('word/_rels/document.xml.rels').asText(), /media\//);
});

test('la imagen sale con el tamaño que le da el PDF, no con el natural del PNG', async () => {
  /* Este es el fallo que produjo "una página por cada separación entre párrafos": sin tamaño,
     la figura de la página 11 medía 29,9 cm sobre papel de 21,6 y Word repartía el desborde
     en hojas nuevas. 5,53 cm × 37,795 px/cm = 209 px, 1,23 cm × 37,795 px/cm = 46 px (redondeo
     al entero más cercano, igual que `cmAPixeles` en `estiloDocumento.js`), y docx emite 9525
     EMU por px. */
  const { doc } = await abrir(
    '<p><img data-recurso="logo" style="width:5.53cm;height:1.23cm" /></p>',
    [{ id: 'logo', dataUrl: PNG_1x1 }]);
  const m = /<wp:extent cx="(\d+)" cy="(\d+)"/.exec(doc);
  assert.ok(m, 'la imagen no se emitió');
  assert.equal(Number(m[1]), 209 * 9525);
  assert.equal(Number(m[2]), 46 * 9525);
});

test('la imagen en docx se auto-escala si supera el ancho máximo de la caja', async () => {
  /* La caja es 21.59 - 5 = 16.59 cm.
     Si una imagen mide 20cm x 10cm, debe escalarse a 16.59cm de ancho y 8.295cm de alto.
     16.59cm en píxeles es 627. 8.295cm en píxeles es 314.
     docx emite 9525 EMU por píxel. */
  const { doc } = await abrir(
    '<p><img data-recurso="portada" style="width:20cm;height:10cm" /></p>',
    [{ id: 'portada', dataUrl: PNG_1x1 }]);
  const m = /<wp:extent cx="(\d+)" cy="(\d+)"/.exec(doc);
  assert.ok(m, 'la imagen no se emitió');
  assert.equal(Number(m[1]), 627 * 9525);
  assert.equal(Number(m[2]), 314 * 9525);
});

test('una imagen cuyo recurso no está en el catálogo no rompe el documento', async () => {
  /* Pasa si el catálogo y la plantilla se desincronizan. Mejor un hueco que un throw que deja
     al usuario sin documento y sin explicación. */
  const { doc } = await abrir(
    '<p>antes<img data-recurso="fantasma" style="width:1cm;height:1cm" />después</p>');
  assert.match(doc, /antes/);
  assert.match(doc, /después/);
});

test('las listas usan viñetas de Word, no un punto escrito a mano', async () => {
  /* La skill lo marca: un `•` literal no es una lista y no se puede renumerar. */
  const { doc } = await abrir('<ul><li>uno</li><li>dos</li></ul>');
  assert.match(doc, /<w:numPr>/, 'no hay numeración de lista');
  assert.match(doc, /uno/);
  assert.match(doc, /dos/);
  assert.doesNotMatch(doc, /•/);
});

test('una imagen suelta en una celda no se pierde', async () => {
  /* `bloquesDe` trataba un fragmento en línea colgado directamente de un bloque —sin `<p>` de
     por medio— llamando a `runsDe(h, heredado)`, y `runsDe` traduce los HIJOS de lo que recibe,
     no al nodo mismo: la imagen se perdía en silencio, sin excepción ni aviso, con el texto de
     alrededor intacto. Antes de la tarea 7 esto era invisible porque `runDeImagen` devolvía
     siempre `[]`; ahora que traduce imágenes de verdad, el hueco se nota. */
  const { doc } = await abrir(
    '<table><tr><td>antes<img data-recurso="logo" style="width:2cm;height:1cm" />después' +
    '</td></tr></table>',
    [{ id: 'logo', dataUrl: PNG_1x1 }]);
  assert.match(doc, /<wp:extent/, 'la imagen no se emitió');
  assert.equal((doc.match(/antes/g) || []).length, 1);
  assert.equal((doc.match(/después/g) || []).length, 1);
});

test('un fragmento con estilo suelto en una celda conserva su estilo', async () => {
  /* Mismo fallo que la imagen suelta, pero con un `<strong>`: se perdía la negrita porque
     `runsDe(h, heredado)` iteraba los hijos de ese `<strong>` en vez de traducirlo a él. */
  const { doc } = await abrir(
    '<table><tr><td>antes<strong>medio</strong>después</td></tr></table>');
  assert.match(doc, /<w:b\/>/, 'no hay negrita');
  assert.equal((doc.match(/antes/g) || []).length, 1);
  assert.equal((doc.match(/medio/g) || []).length, 1);
  assert.equal((doc.match(/después/g) || []).length, 1);
});

test('una imagen suelta en un div tampoco se pierde', async () => {
  /* El mismo fallo, pero en el otro contenedor que llega sin `<p>` de por medio: el `<div>` del
     contentEditable. */
  const { doc } = await abrir(
    '<div>antes<img data-recurso="logo" style="width:2cm;height:1cm" />después</div>',
    [{ id: 'logo', dataUrl: PNG_1x1 }]);
  assert.match(doc, /<wp:extent/, 'la imagen no se emitió');
  assert.equal((doc.match(/antes/g) || []).length, 1);
  assert.equal((doc.match(/después/g) || []).length, 1);
});

test('las páginas del mismo tipo de orientación fluyen de forma continua (con salto solo después de la portada)', async () => {
  const html = '<div class="pagina" data-pagina="1" data-orientacion="vertical"><p>una</p></div>' +
    '<div class="pagina" data-pagina="2" data-orientacion="vertical"><p>dos</p></div>' +
    '<div class="pagina" data-pagina="3" data-orientacion="vertical"><p>tres</p></div>';
  const { doc } = await abrir(html);
  /* Un solo salto manual para separar la portada (página 1) del resto; el resto fluye de forma continua */
  assert.equal((doc.match(/<w:br w:type="page"\/>/g) || []).length, 1);
});

test('la página apaisada abre su propia sección', async () => {
  const html = '<div class="pagina" data-pagina="1" data-orientacion="vertical"><p>a</p></div>' +
    '<div class="pagina" data-pagina="2" data-orientacion="apaisada"><p>b</p></div>' +
    '<div class="pagina" data-pagina="3" data-orientacion="vertical"><p>c</p></div>';
  const { doc } = await abrir(html);
  assert.match(doc, /w:orient="landscape"/, 'no hay página apaisada');
  /* Tres secciones: vertical, apaisada, vertical. */
  assert.equal((doc.match(/<w:sectPr/g) || []).length, 3);
});

test('sin páginas marcadas se emite una sola sección', async () => {
  /* La plantilla maestra y un .docx por mammoth no traen páginas. Mejor un documento corrido
     que una paginación inventada. */
  const { doc } = await abrir('<p>a</p><p>b</p>');
  assert.equal((doc.match(/<w:sectPr/g) || []).length, 1);
  assert.doesNotMatch(doc, /<w:br w:type="page"\/>/);
});

const ENCABEZADO = '<div data-encabezado="1" data-lado="derecha" data-desde-pagina="5">' +
  '<img data-recurso="logo" style="width:5.53cm;height:1.23cm" /></div>';

test('el logo va en el encabezado de página, una sola vez', async () => {
  /* En el .doc llegó a repetirse 96 veces dentro del cuerpo. */
  const { zip, doc } = await abrir(
    ENCABEZADO + '<div class="pagina" data-pagina="1"><p>a</p></div>',
    [{ id: 'logo', dataUrl: PNG_1x1 }]);
  assert.ok(zip.file('word/header1.xml'), 'no hay encabezado');
  assert.match(zip.file('word/header1.xml').asText(), /<w:drawing>/);
  /* Y no se queda además en el cuerpo. */
  assert.doesNotMatch(doc, /data-encabezado/);
  assert.equal((doc.match(/<w:drawing>/g) || []).length, 0,
    'el logo del encabezado no debe estar también en el cuerpo');
});

test('el encabezado va al lado que dice el PDF', async () => {
  const { zip } = await abrir(ENCABEZADO + '<p>a</p>', [{ id: 'logo', dataUrl: PNG_1x1 }]);
  assert.match(zip.file('word/header1.xml').asText(), /w:val="right"/);
});

test('si el informe no lleva encabezado en la portada, la portada va sin él', async () => {
  /* Ponerlo en la primera lo superponía con el logo grande de la portada: son los dos logos
     encimados que se veían en el .doc. */
  const { doc } = await abrir(ENCABEZADO + '<p>a</p>', [{ id: 'logo', dataUrl: PNG_1x1 }]);
  assert.match(doc, /<w:titlePg\/>/);
});

test('si el encabezado empieza en la página 1, no se activa la primera distinta', async () => {
  const enc = '<div data-encabezado="1" data-lado="centro" data-desde-pagina="1">' +
    '<img data-recurso="logo" style="width:2cm;height:1cm" /></div>';
  const { doc } = await abrir(enc + '<p>a</p>', [{ id: 'logo', dataUrl: PNG_1x1 }]);
  assert.doesNotMatch(doc, /<w:titlePg\/>/);
});

test('un documento sin encabezado no declara uno vacío', async () => {
  const { zip } = await abrir('<p>a</p>');
  assert.equal(zip.file('word/header1.xml'), null);
});

/* El anexo A: las páginas de estados financieros firmados que el usuario sube para llenar el
   hueco que deja el extractor —éste no puede reproducir un documento firmado por otro
   contribuyente y de otro año, así que marca dónde iba cada página con `data-hueco`—. */
const HUECO = '<div class="pagina" data-pagina="98">' +
  '<div data-hueco="anexo_eeff" data-id="hueco_98">' +
  '<p>[Falta el anexo de estados financieros firmados — corresponde a la página 98 del ' +
  'informe de referencia. Adjúntelo antes de radicar.]</p></div></div>';

test('con el anexo subido, sus páginas entran en el sitio del hueco', async () => {
  const { doc } = await abrir(HUECO, [], [PNG_1x1]);
  assert.match(doc, /<w:drawing>/, 'la página del anexo no entró');
  /* Y el texto del hueco desaparece: ya no falta nada. */
  assert.doesNotMatch(doc, /Falta el anexo/);
});

test('sin anexo subido, el hueco se ve y dice qué falta', async () => {
  /* Un div vacío no se ve ni en pantalla ni en Word, y en la salida anterior las 15 páginas
     del anexo desaparecían sin dejar rastro. El informe se radica ante la DIAN: que diga qué
     falta es lo mínimo. */
  const { doc } = await abrir(HUECO, [], []);
  assert.match(doc, /Falta el anexo de estados financieros firmados/);
});

test('las páginas del anexo se reparten en orden entre los huecos', async () => {
  const dos = HUECO + HUECO.replace(/98/g, '99');
  const { doc } = await abrir(dos, [], [PNG_1x1, PNG_1x1]);
  assert.equal((doc.match(/<w:drawing>/g) || []).length, 2);
});

test('con menos páginas de anexo que huecos, los que sobran siguen avisando', async () => {
  const dos = HUECO + HUECO.replace(/98/g, '99');
  const { doc } = await abrir(dos, [], [PNG_1x1]);
  assert.equal((doc.match(/<w:drawing>/g) || []).length, 1);
  assert.match(doc, /Falta el anexo/);
});

test('avisa cuando el anexo trae más páginas que huecos', async () => {
  /* Perder páginas de un anexo de estados financieros firmados en un documento que se radica
     ante la DIAN sería grave, y este aviso por consola es lo único que lo delata: nada en el
     .docx generado —ni el `<w:drawing>`, ni el texto del hueco— refleja que algo quedó fuera;
     sólo la consola lo dice. Se reemplaza `console.warn` mientras dura el test y se restaura
     en un `finally`, para no dejarlo puesto y estropear otros tests. Se filtra por contenido
     del mensaje y no se cuentan llamadas a ciegas: otro camino del writer dispara
     `console.warn` por un motivo distinto (una imagen sin recurso, por ejemplo). */
  const original = console.warn;
  const llamadas = [];
  console.warn = (...args) => llamadas.push(args.join(' '));
  const avisoDeAnexo = () => llamadas.find((m) => m.includes('[docxWriter]') && m.includes('anexo'));
  try {
    /* 1. Un hueco, dos páginas: sobra una, y avisa mencionando cuántas. */
    const { doc } = await abrir(HUECO, [], [PNG_1x1, PNG_1x1]);
    const aviso = avisoDeAnexo();
    assert.ok(aviso, 'no avisó de las páginas de anexo sobrantes');
    assert.match(aviso, /sobran 1 página/);

    /* 2. La primera página sí entra en el hueco: avisar de la que sobra no le cuesta la que
       sí cabe. */
    assert.equal((doc.match(/<w:drawing>/g) || []).length, 1);
    assert.doesNotMatch(doc, /Falta el anexo/);

    /* 3. Si la cuenta cuadra, o si sobran huecos en vez de páginas, no avisa: el aviso sólo
       tiene sentido cuando de verdad se pierde algo, si no se vuelve ruido que la gente
       aprende a ignorar. */
    llamadas.length = 0;
    const dos = HUECO + HUECO.replace(/98/g, '99');
    await abrir(dos, [], [PNG_1x1, PNG_1x1]); /* dos huecos, dos páginas: cuenta exacta */
    await abrir(dos, [], [PNG_1x1]); /* dos huecos, una página: sobra hueco, no página */
    assert.equal(avisoDeAnexo(), undefined, 'avisó de páginas sobrantes sin que sobrara ninguna');
  } finally {
    console.warn = original;
  }
});

/* Extremo a extremo sobre el PDF real: el que ha atrapado todos los fallos de esta sesión.
   Una sola extracción compartida entre los dos tests de este bloque — 112 páginas tarda, y
   procesarlas dos veces duplicaría el tiempo sin aportar nada. Mismo patrón de caché que
   `pdfReferenceExtractor.test.js`. */
const RUTA_PDF = 'Cpanel/public_html/demo-precios-transferencia/Archivos Prueba/estudio pasado.pdf';
let cacheRef = null;
const referencia = async () => {
  if (!cacheRef) cacheRef = await extraerReferencia(new Uint8Array(readFileSync(RUTA_PDF)));
  return cacheRef;
};

test('extremo a extremo: el informe real sale como .docx', async () => {
  const ref = await referencia();
  const zip = new PizZip(await aDocxBuffer({
    html: ref.html, recursos: ref.imagenes, anexo: [],
  }));
  const doc = zip.file('word/document.xml').asText();

  /* Declara las 112 páginas del original. */
  /* Con flujo continuo, ya no hay un salto manual ni una sección por cada página individual del PDF original,
     sino que fluye de forma continua. El número de secciones corresponde únicamente a los cambios de orientación. */
  assert.equal((doc.match(/<w:sectPr/g) || []).length, 3,
    'las secciones deben corresponder a los cambios de orientación de página');
  assert.equal((doc.match(/<w:br w:type="page"\/>/g) || []).length, 1,
    'debe haber exactamente un salto de página manual para la portada');

  /* El texto del informe está. */
  assert.match(doc, /INTRODUCCIÓN/);
  assert.match(doc, /END GAME/);

  /* La negrita del informe llegó: medido sobre el PDF real, 931 fragmentos en negrita. El
     umbral de 500 es conservador a propósito, no un ajuste a la baja de una medición menor. */
  assert.ok((doc.match(/<w:b\/>/g) || []).length > 500,
    'se perdió la negrita del informe');

  /* Una imagen por recurso en word/media, y ninguna más ancha que la caja de texto. */
  const media = Object.keys(zip.files).filter((f) => /^word\/media\/.+\./.test(f));
  assert.ok(media.length >= 3, 'faltan imágenes: ' + media.length);
  const anchos = [...doc.matchAll(/<wp:extent cx="(\d+)"/g)].map((m) => Number(m[1]));
  const cajaEmu = (21.6 - 5) * 360000;
  for (const cx of anchos) {
    assert.ok(cx <= cajaEmu, 'una imagen mide más que la caja de texto: ' + cx);
  }

  /* La página apaisada abrió su sección. */
  assert.match(doc, /w:orient="landscape"/);

  /* El encabezado va una vez, a la derecha, y la portada sin él. */
  assert.ok(zip.file('word/header1.xml'));
  assert.match(zip.file('word/header1.xml').asText(), /w:val="right"/);
  assert.match(doc, /<w:titlePg\/>/);

  /* Y nada del resaltado de pantalla. */
  assert.doesNotMatch(doc, /pt-valor/);
});

test('el .docx del informe real es XML bien formado', async () => {
  /* Un XML mal formado hace que Word ofrezca "reparar" el documento, y ahí el usuario ya
     perdió la confianza en la herramienta. */
  const ref = await referencia();
  const zip = new PizZip(await aDocxBuffer({ html: ref.html, recursos: ref.imagenes }));
  for (const parte of ['word/document.xml', 'word/styles.xml', 'word/header1.xml',
    'word/footer1.xml', '[Content_Types].xml']) {
    const xml = zip.file(parte);
    assert.ok(xml, 'falta ' + parte);
    const texto = xml.asText();
    /* Comprobación de equilibrio de etiquetas, que es lo que se puede hacer sin parser XML.

       Corrección medida sobre el PDF real: el regex del brief cuenta como "abierta" cualquier
       `<letra...>` sin barra justo antes del `>`, pero eso falla en cuanto un atributo trae una
       barra —los `xmlns` de `http://schemas.openxmlformats.org/...` que trae `<w:document>` y,
       dentro de cada dibujo de imagen, `<a:graphic>`, `<a:graphicData>` y `<pic:pic>`—: el
       carácter excluido `[^>/]*` se detiene en la barra de la URL y el `<a:graphic ...>` entero
       deja de calzar como apertura, aunque SÍ tiene su `</a:graphic>` de cierre. Sobre
       `word/document.xml` esto descontaba 10 aperturas (1 `w:document` + 3 de cada una de
       `a:graphic`/`a:graphicData`/`pic:pic`, una por cada imagen del cuerpo) y el conteo daba
       27326 aperturas contra 27336 cierres: parecía descompensado sin estarlo. Confirmado con
       un parser XML de verdad (`xml.dom.minidom` de Python) que `word/document.xml` sí es XML
       bien formado. El arreglo, sin necesitar parser: vaciar el contenido de los atributos
       (`="..."` → `=""`) antes de contar, así ninguna URL puede colarse en la cuenta. */
    const sinAtributos = texto.replace(/="[^"]*"/g, '=""');
    const abiertas = (sinAtributos.match(/<[a-zA-Z][^>/]*(?<!\/)>/g) || []).length;
    const cerradas = (sinAtributos.match(/<\/[a-zA-Z][^>]*>/g) || []).length;
    assert.equal(abiertas, cerradas, parte + ': etiquetas descompensadas');
  }
});

test('el tamaño de fuente de cada fragmento llega al documento', async () => {
  /* Las tablas del informe van a 8 y 9 puntos, no al cuerpo de 12. El writer sólo leía la
     familia del `style` y tiraba el tamaño, así que las emitía todas a 12 pt: un 33 % más de
     alto por línea sobre 890 filas. Medido sobre el informe real, eso eran 61 hojas de más
     sobre las 112 del original, y TODAS en páginas con tabla —las que llevan tabla ocupaban
     1,48 veces la caja de texto; las que no, 0,32—. */
  const { doc } = await abrir(
    '<p><span style="font-size:9pt">nueve</span> ' +
    '<span style="font-size:8pt">ocho</span> doce</p>');
  assert.match(doc, /<w:sz w:val="18"\/>/, 'falta el tamaño de 9 pt');
  assert.match(doc, /<w:sz w:val="16"\/>/, 'falta el tamaño de 8 pt');
  /* Y el texto sin declaración se queda con el cuerpo del documento, sin `w:sz` propio. */
  assert.match(doc, /nueve/);
  assert.match(doc, /doce/);
});

test('el tamaño se hereda dentro de un fragmento con estilo', async () => {
  /* Una celda de tabla del informe es `<span style="font-size:9pt"><strong>x</strong></span>`:
     la negrita no puede devolver el texto a 12 pt. */
  const { doc } = await abrir(
    '<p><span style="font-size:9pt"><strong>cifra</strong></span></p>');
  assert.match(doc, /<w:sz w:val="18"\/>/);
  assert.match(doc, /<w:b\/>/);
});

test('el estilo por defecto fija el espacio entre párrafos en cero', async () => {
  /* Sin `w:after` explícito, Word aplica su valor de fábrica: 200 twips = 10 pt DESPUÉS DE CADA
     párrafo. Sobre los 3867 párrafos del informe son unas 49 hojas de espaciado puro, y era la
     causa principal de que el documento saliera con 173 hojas donde el original tiene 112.

     La vista previa no lo sufría —su CSS no añade ese margen—, así que era la última asimetría
     pantalla/archivo de este trabajo. El informe separa sus párrafos con párrafos vacíos que
     trae el propio PDF, así que el espacio que hace falta ya está en el contenido. */
  const { leer } = await abrir('<p>hola</p>');
  const estilos = leer('word/styles.xml');
  assert.match(estilos, /<w:spacing[^>]*w:after="0"/, 'falta el after:0 del estilo por defecto');
  /* Y el interlineado va proporcional, no fijo: una celda de tabla a 9 pt no debe arrastrar el
     interlineado del cuerpo de 12. */
  assert.match(estilos, /<w:spacing[^>]*w:lineRule="auto"/);
  assert.match(estilos, /<w:spacing[^>]*w:line="276"/);
});

test('el índice del .docx asocia hipervínculos internos (redirecciones) a los marcadores de las secciones', async () => {
  const html =
    '<h1>1. RESUMEN EJECUTIVO</h1>' +
    '<p>1. RESUMEN EJECUTIVO ....................... 12</p>' +
    '<h2>1.1 Antecedentes</h2>' +
    '<p>1.1 Antecedentes ....................... 13</p>';
  const { doc } = await abrir(html);

  // Verificamos que se hayan creado los marcadores (BookmarkStart) en los encabezados
  assert.match(doc, /<w:bookmarkStart[^>]*w:name="heading_ref_1"/, 'falta el marcador del h1');
  assert.match(doc, /<w:bookmarkStart[^>]*w:name="heading_ref_2"/, 'falta el marcador del h2');

  // Verificamos que se hayan creado los hipervínculos internos (hyperlink) en las entradas del índice
  assert.match(doc, /<w:hyperlink[^>]*w:anchor="heading_ref_1"/, 'falta el hipervínculo del h1 en el índice');
  assert.match(doc, /<w:hyperlink[^>]*w:anchor="heading_ref_2"/, 'falta el hipervínculo del h2 en el índice');
});

/* ── Notas al pie ──────────────────────────────────────────────────────────────────────────
   El informe lleva sus citas legales al pie de la hoja. El árbol del PDF las ancla detrás del
   párrafo que las cita, así que emitirlas ahí las dejaba en mitad de la página y empujaba el
   resto del texto hacia abajo: el diseño de las páginas siguientes dejaba de parecerse al
   original. Se emiten como notas al pie de VERDAD para que Word las coloque, las numere y las
   mueva al repaginar. */

/* El mismo informe tal como lo emitía el lector 8, que es el que sigue guardado en IndexedDB: la
   nota en el flujo con su número dentro, y la llamada como un dígito en letra pequeña sin `sup`.
   Es lo que ejercita la vía de respaldo, y se deriva del PDF real para que no sea una fixture
   inventada que pueda dejar de parecerse al informe. */
const comoElLector8 = (html) => html
  .replace(
    /<div data-nota-pie="(\d+)">([\s\S]*?)<\/div>/g,
    (_, n, cuerpo) => cuerpo.replace(/^<p>/, '<p><span style="font-size:5pt"> ' + n + '</span>')
  )
  .replace(/<sup data-ref-nota="\d+">(\d+)<\/sup>/g, '<span style="font-size:8pt">$1</span>');

test('las citas del informe salen como notas al pie de Word, no como párrafos', async () => {
  const ref = await referencia();
  const zip = new PizZip(await aDocxBuffer({ html: ref.html, recursos: ref.imagenes }));

  /* La parte del documento donde viven las notas, y su relación: sin ellas Word no las muestra
     aunque el cuerpo traiga las referencias. */
  const notas = zip.file('word/footnotes.xml');
  assert.ok(notas, 'el .docx salió sin word/footnotes.xml');
  assert.match(zip.file('word/_rels/document.xml.rels').asText(), /footnotes\.xml/,
    'las notas no están declaradas en las relaciones del documento');
  assert.match(zip.file('[Content_Types].xml').asText(), /footnotes/,
    'falta el tipo de contenido de las notas');

  /* Las 42 del informe, cada una con su referencia en el cuerpo. Los dos separadores que Word
     necesita —la línea y la de continuación— van además de las notas, de ahí el 44. */
  assert.equal((notas.asText().match(/<w:footnote /g) || []).length, 44,
    'no salieron las 42 notas del informe');
  assert.equal(
    (zip.file('word/document.xml').asText().match(/footnoteReference/g) || []).length, 42,
    'no hay una referencia por nota en el cuerpo'
  );
});

test('el texto de la cita va en la nota y no se repite en el cuerpo', async () => {
  const ref = await referencia();
  const zip = new PizZip(await aDocxBuffer({ html: ref.html, recursos: ref.imagenes }));
  const doc = zip.file('word/document.xml').asText();
  const notas = zip.file('word/footnotes.xml').asText();

  /* La primera cita del informe, la del artículo 260-2, y la última, la de la muestra
     estadística: al pie y sólo al pie. Si siguieran en el cuerpo seguirían ocupando el espacio
     que descuadraba la página. */
  for (const cita of ['En virtud de lo expresado en', 'En una muestra estadística cuyos']) {
    assert.ok(notas.includes(cita), 'la cita no llegó a la nota: ' + cita);
    assert.ok(!doc.includes(cita), 'la cita sigue en el cuerpo del documento: ' + cita);
  }

  /* Una nota de dos párrafos llega entera: la primera del informe cita el artículo y después lo
     transcribe. */
  assert.ok(notas.includes('están obligados a determinar'),
    'se perdió el segundo párrafo de la primera nota');

  /* Y el párrafo que la citaba conserva su texto: la nota se fue, el cuerpo se queda. */
  assert.ok(doc.includes('de acuerdo al artículo 1 del decreto 2120'),
    'el cuerpo perdió el texto que rodeaba a una llamada');
});

test('una plantilla del lector anterior también saca sus citas al pie', async () => {
  /* Es lo que evita obligar a subir otra vez el PDF y a volver a marcar con IA sólo para
     arreglar el diseño: la plantilla ya marcada sigue viva en IndexedDB. */
  const ref = await referencia();
  const html = comoElLector8(ref.html);
  assert.ok(!/data-nota-pie|data-ref-nota/.test(html),
    'la fixture del lector 8 no debería llevar marcas del 9');

  const zip = new PizZip(await aDocxBuffer({ html, recursos: ref.imagenes }));
  const doc = zip.file('word/document.xml').asText();
  const notas = zip.file('word/footnotes.xml');
  assert.ok(notas, 'sin footnotes.xml: el respaldo no reconoció ninguna cita');
  assert.equal((notas.asText().match(/<w:footnote /g) || []).length, 44,
    'el respaldo no reconoció las 42 citas del informe');
  assert.equal((doc.match(/footnoteReference/g) || []).length, 42,
    'el respaldo no emparejó cada cita con su llamada');
  assert.ok(!doc.includes('En virtud de lo expresado en'),
    'la cita sigue en el cuerpo con el respaldo');
});

test('un párrafo que empieza por un número no es una cita al pie', async () => {
  /* En el informe hay una razón social que empieza por número, «11 BIT STUDIOS S.A.», y vive en
     una celda de tabla. Tomarla por cita la sacaría de su fila y la mandaría al pie de la hoja.
     Lo que la salva es que el reconocimiento no entra en las tablas. */
  const html =
    '<div class="pagina" data-pagina="1">' +
    '<p>El comparable seleccionado<span style="font-size:8pt">1</span> es europeo.</p>' +
    '<table><tr><td><span style="font-size:9pt">11 BIT STUDIOS S.A.</span></td></tr></table>' +
    '<p><span style="font-size:8pt">1 Estatuto tributario, Articulo 206-4.</span></p>' +
    '</div>';
  const { zip, doc } = await abrir(html);
  assert.ok(doc.includes('11 BIT STUDIOS S.A.'), 'la razón social salió del cuerpo');
  assert.match(doc, /<w:tbl>/, 'la tabla se deshizo');
  /* Y la cita de verdad sí se fue al pie. */
  const notas = zip.file('word/footnotes.xml');
  assert.ok(notas && notas.asText().includes('Estatuto tributario'),
    'la cita real no llegó a la nota');
  assert.ok(!doc.includes('Estatuto tributario'), 'la cita real sigue en el cuerpo');
});

test('una cita sin llamada en el texto se queda en el cuerpo y avisa', async () => {
  /* En Word una nota al pie sin llamada no se ve. Perder texto de un informe que se radica ante
     la DIAN es peor que dejarlo donde estaba, así que se conserva y se dice por consola. */
  const html =
    '<div class="pagina" data-pagina="1">' +
    '<p>Un párrafo del cuerpo sin ninguna llamada.</p>' +
    '<div data-nota-pie="7"><p><span style="font-size:8pt">Cita sin dueño.</span></p></div>' +
    '</div>';
  const avisos = [];
  const original = console.warn;
  console.warn = (m) => { avisos.push(String(m)); };
  let doc;
  try {
    ({ doc } = await abrir(html));
  } finally {
    console.warn = original;
  }
  assert.ok(doc.includes('Cita sin dueño.'), 'se perdió el texto de una cita sin llamada');
  assert.ok(avisos.some((a) => /cita al pie 7 no tiene llamada/.test(a)),
    'no avisó de la cita sin llamada: ' + avisos.join(' | '));
});

test('la llamada de la cita es la referencia de Word, no un dígito escrito', async () => {
  /* Antes el número llegaba como texto en letra pequeña, a media altura de línea. Como
     referencia de Word es lo que arrastra la nota al pie de la hoja donde acabe cayendo. */
  const html =
    '<div class="pagina" data-pagina="1">' +
    '<p>Naturaleza <em>Arm’s Length</em><sup data-ref-nota="1">1</sup> de la operación.</p>' +
    '<div data-nota-pie="1"><p><span style="font-size:8pt">Art. 260-2.</span></p></div>' +
    '</div>';
  const { doc } = await abrir(html);
  assert.match(doc, /<w:footnoteReference w:id="1"/, 'la llamada no es una referencia de Word');
  /* El dígito ya no está escrito en el párrafo: lo pone Word al numerar. */
  const parrafo = /<w:p>[\s\S]*?Naturaleza[\s\S]*?<\/w:p>/.exec(doc);
  assert.ok(parrafo, 'no se encontró el párrafo de la llamada');
  assert.ok(!/<w:t[^>]*>1<\/w:t>/.test(parrafo[0]),
    'el número de la llamada sigue escrito a mano en el párrafo');
});

test('la ecuación marcada sale con el motor matemático de Word', async () => {
  /* `data-formula` es lo que el extractor declara al leer el PDF. La forma exacta del OMML la
     fija `formulasOmml.test.js`; aquí sólo importa que la marca llegue a la ecuación. */
  const { doc } = await abrir('<p data-formula="AP">lo que diga el texto da igual</p>');
  assert.match(doc, /<m:oMath>/, 'falta el bloque oMath de Word');
  assert.match(doc, /<m:t>AP Adjustment = <\/m:t>/, 'no es la ecuación del ajuste de pagar');
  assert.ok(!doc.includes('lo que diga el texto'),
    'el texto de respaldo se coló en el documento en vez de la ecuación');
});

test('la marca gana a la heurística de la entrada del índice', async () => {
  /* Una ecuación seguida de un número parece una entrada del índice si se la juzga por la forma.
     Un dato declarado por el extractor gana a cualquier prueba sobre el texto. */
  const { doc } = await abrir('<p data-formula="AR">AR Adjustment ....... 33</p>');
  assert.match(doc, /<m:oMath>/, 'la ecuación se tomó por una entrada del índice');
  assert.match(doc, /<m:t>ANC<\/m:t>/, 'no es la ecuación del ajuste de cobrar');
});

test('la marca sobrevive a que alguien edite el párrafo en la vista previa', async () => {
  /* La vista previa es un `contentEditable` que reescribe el HTML con `innerHTML`. Los `data-*`
     se serializan enteros, así que la ecuación no depende de que el texto quede intacto. */
  const { doc } = await abrir(
    '<p data-formula="AP">AP Adjustment <span data-campo="anio">2024</span> tocado a mano</p>');
  assert.match(doc, /<m:oMath>/);
  assert.ok(!doc.includes('tocado a mano'), 'se emitió el párrafo editado en vez de la ecuación');
});

test('una plantilla guardada por un lector anterior no se lleva la basura al .docx', async () => {
  /* Dos formas heredadas. La de los lectores 9 y 10 escribe la ecuación en una línea; la
     anterior ni la reconoció y dejó lo que salió del PDF: letras colapsadas al mismo code point
     y rombos de reemplazo. De qué ajuste es lo dice el rótulo que la precede. */
  const lineal = await abrir(
    '<p>AR Adjustment = (((ANC_TP / TNS_TP) * TNS_comp) - ANC_comp) * (R / (1 + R))</p>');
  assert.match(lineal.doc, /<m:oMath>/, 'no se reconoció la ecuación en una línea del lector 9');
  assert.match(lineal.doc, /<m:t>ANC<\/m:t>/);

  const corrupta = await abrir(
    '<p>FORMULA AJUSTE CUENTAS POR PAGAR</p>' +
    '<p>' + '𝐴'.repeat(24) + '�'.repeat(8) + '</p>');
  assert.match(corrupta.doc, /<m:oMath>/, 'no se reconoció la ecuación corrupta');
  assert.match(corrupta.doc, /<m:t>ANP<\/m:t>/, 'el rótulo de pagar no decidió el ajuste');
  assert.ok(!/[\u{1D400}-\u{1D7FF}]/u.test(corrupta.doc), 'la basura del PDF llegó al .docx');
});

test('un párrafo normal no se convierte en ecuación', async () => {
  const { doc } = await abrir(
    '<p>El ajuste de las cuentas por pagar se calcula sobre el promedio del año</p>');
  assert.ok(!doc.includes('<m:oMath>'), 'se emitió una ecuación donde sólo había prosa');
});

/* ══════ La letra de la Sección III ══════ */

/* Un informe con la forma del real: el índice, un capítulo, la Sección III con su encabezado, un
   subapartado, prosa, una tabla y el capítulo siguiente. La entrada del índice lleva el número de
   página pegado, que es lo que la distingue del encabezado de verdad. */
const HTML_CON_SECCION_III =
  '<div class="pagina" data-pagina="1">' +
  '<p>III. TENDENCIAS DE LA ECONOMÍA 13</p>' +
  '<h1>II. ANÁLISIS FUNCIONAL</h1>' +
  '<p>Prosa del análisis funcional.</p>' +
  '<h1>III. TENDENCIAS DE LA ECONOMÍA</h1>' +
  '<h2>A. Análisis del Panorama de la Economía Mundial</h2>' +
  '<p>La economía mundial creció un 3,2 %.</p>' +
  '<p><span style="font-size:9pt">FUENTE: Banco Mundial</span></p>' +
  '<table><tr><td>2024</td></tr></table>' +
  '<h1>IV. ANÁLISIS DE COMPARABILIDAD</h1>' +
  '<p>Prosa de la sección cuarta.</p>' +
  '</div>';

/* El párrafo que contiene este texto, del `document.xml`. El ÚLTIMO, no el primero: la tabla de
   contenido repite cada encabezado del informe, y el que interesa es el de verdad — la entrada del
   índice se queda a propósito sin la letra de la sección. */
const parrafoCon = (doc, texto) =>
  (doc.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || [])
    .filter((p) => p.replace(/<[^>]*>/g, '').includes(texto)).at(-1);

test('la prosa de la Sección III sale en Arial 12', async () => {
  /* Antes no tenía trato propio: salía en la letra que el extractor hubiera leído del PDF del
     cliente. Se declara una base DISTINTA a propósito —Times New Roman 10— para que el test no
     pueda pasar por casualidad si la sección siguiera heredando del cuerpo. */
  const { doc } = await abrir(
    '<div data-extractor="7" data-estilo-base="Times New Roman|10"></div>' + HTML_CON_SECCION_III);
  const prosa = parrafoCon(doc, 'La economía mundial creció');
  assert.ok(prosa, 'no se encontró el párrafo de prosa');
  assert.match(prosa, new RegExp('w:ascii="' + FUENTE_MACRO + '"'));
  assert.match(prosa, new RegExp('<w:sz w:val="' + PUNTOS_MACRO * 2 + '"'));
});

test('los títulos de la Sección III salen en Arial 12 negrita', async () => {
  /* Al quedar del tamaño del cuerpo, la negrita es lo único que los distingue. */
  const { doc } = await abrir(HTML_CON_SECCION_III);
  for (const titulo of ['III. TENDENCIAS DE LA ECONOMÍA', 'A. Análisis del Panorama']) {
    const parrafo = parrafoCon(doc, titulo);
    assert.ok(parrafo, 'no se encontró «' + titulo + '»');
    assert.match(parrafo, new RegExp('w:ascii="' + FUENTE_MACRO + '"'), titulo);
    assert.match(parrafo, new RegExp('<w:sz w:val="' + PUNTOS_MACRO * 2 + '"'), titulo);
    assert.match(parrafo, /<w:b\/>/, titulo + ': los títulos van en negrita');
  }
});

test('la letra de la Sección III no se sale de la sección', async () => {
  /* La entrada del índice —que repite el encabezado con el número de página— no abre la zona, y el
     capítulo siguiente la cierra. Si alguna de las dos cosas fallara, el informe entero saldría en
     la letra de la sección. */
  const { doc } = await abrir(
    '<div data-extractor="7" data-estilo-base="Times New Roman|10"></div>' + HTML_CON_SECCION_III);
  for (const fuera of ['Prosa del análisis funcional', 'Prosa de la sección cuarta']) {
    const parrafo = parrafoCon(doc, fuera);
    assert.ok(parrafo, 'no se encontró «' + fuera + '»');
    assert.doesNotMatch(parrafo, new RegExp('w:ascii="' + FUENTE_MACRO + '"'), fuera);
  }
});

test('las tablas de la Sección III siguen en la tipografía de tabla', async () => {
  /* Las tablas del informe se ven iguales en todas las secciones (decisión del usuario,
     2026-08-19): la letra de la sección no puede alcanzarlas. */
  const { doc } = await abrir(HTML_CON_SECCION_III);
  const tabla = /<w:tbl>[\s\S]*?<\/w:tbl>/.exec(doc)[0];
  assert.match(tabla, new RegExp('<w:sz w:val="' + PUNTOS_TABLA * 2 + '"'));
  assert.doesNotMatch(tabla, new RegExp('<w:sz w:val="' + PUNTOS_MACRO * 2 + '"'));
});

test('la línea «FUENTE:» de la Sección III conserva su tamaño', async () => {
  /* Sube de familia pero no de tamaño: a 12 dejaría de leerse como la fuente de una tabla. */
  const { doc } = await abrir(HTML_CON_SECCION_III);
  const fuente = parrafoCon(doc, 'FUENTE: Banco Mundial');
  assert.ok(fuente, 'no se encontró la línea FUENTE');
  assert.match(fuente, new RegExp('w:ascii="' + FUENTE_MACRO + '"'));
  assert.match(fuente, /<w:sz w:val="18"/);
  assert.doesNotMatch(fuente, new RegExp('<w:sz w:val="' + PUNTOS_MACRO * 2 + '"'));
});

test('las viñetas de la Sección III salen en Arial 12', async () => {
  /* Regresión: la letra de la sección se aplicaba en la rama de párrafos y encabezados, y las
     listas se resuelven en una rama anterior que no la consultaba. Las viñetas de III salían en
     la letra que el extractor hubiera leído del PDF. */
  const { doc } = await abrir(
    '<div data-extractor="7" data-estilo-base="Times New Roman|12"></div>' +
    '<h1>III. TENDENCIAS DE LA ECONOMÍA</h1>' +
    '<ul><li>Primera viñeta del apartado.</li></ul>' +
    '<h1>IV. ANÁLISIS DE COMPARABILIDAD</h1><ul><li>Viñeta de la cuarta.</li></ul>');
  const dentro = parrafoCon(doc, 'Primera viñeta del apartado');
  assert.match(dentro, new RegExp('w:ascii="' + FUENTE_MACRO + '"'));
  assert.match(dentro, new RegExp('<w:sz w:val="' + PUNTOS_MACRO * 2 + '"'));
  /* Y la viñeta del capítulo siguiente no se contagia. */
  assert.doesNotMatch(parrafoCon(doc, 'Viñeta de la cuarta'),
    new RegExp('w:ascii="' + FUENTE_MACRO + '"'));
});

test('las citas al pie de la Sección III salen en Arial y siguen pequeñas', async () => {
  /* Regresión: las notas se emiten fuera del recorrido del cuerpo, cuando la bandera de zona ya
     no vale, así que las citas de la Sección III salían en la letra del documento. La sección
     cita el Banco Mundial, el DANE y el Banco de la República en casi cada apartado. */
  const { leer } = await abrir(
    '<div data-extractor="7" data-estilo-base="Times New Roman|12"></div>' +
    '<h1>III. TENDENCIAS DE LA ECONOMÍA</h1>' +
    '<p>El PIB mundial creció<sup data-ref-nota="1">1</sup>.</p>' +
    '<div data-nota-pie="1"><span style="font-size:8pt">1 Banco Mundial, Global Economic Prospects.</span></div>' +
    /* El capítulo siguiente es imprescindible en este montaje: las notas se emiten al FINAL del
       documento, así que si la Sección III fuera lo último la bandera de zona seguiría puesta y el
       test pasaría sin demostrar nada. El informe real tiene IV a VIII y los anexos detrás. */
    '<h1>IV. ANÁLISIS DE COMPARABILIDAD</h1><p>Prosa de la cuarta.</p>');
  const notas = leer('word/footnotes.xml');
  assert.ok(notas, 'el .docx no trae notas al pie');
  /* Sobre el PÁRRAFO de la cita, no sobre el archivo entero: `footnotes.xml` trae además el
     separador y la continuación que Word exige, y un `w:ascii` suelto ahí haría pasar el test
     sin que la cita hubiera cambiado de letra. */
  const cita = parrafoCon(notas, 'Banco Mundial, Global Economic Prospects');
  assert.ok(cita, 'no se encontró el párrafo de la cita');
  assert.match(cita, new RegExp('w:ascii="' + FUENTE_MACRO + '"'));
  /* El tamaño reducido se conserva: 8 pt son 16 medios puntos. */
  assert.match(cita, /<w:sz w:val="16"/);
  assert.doesNotMatch(cita, new RegExp('<w:sz w:val="' + PUNTOS_MACRO * 2 + '"'));
});

test('un numeral romano dentro de la Sección III no la corta', async () => {
  /* Regresión y la peor de las tres: cualquier párrafo que empezara por un romano y punto
     —«I. Producto Interno Bruto», «V. Tasa de Cambio», o el numeral de una lista— se tomaba por
     el capítulo siguiente y cerraba la sección. Desde ahí, TODO el resto de la Sección III
     —incluido III.C— salía en la letra de la plantilla. */
  const { doc } = await abrir(
    '<div data-extractor="7" data-estilo-base="Times New Roman|12"></div>' +
    '<h1>III. TENDENCIAS DE LA ECONOMÍA</h1>' +
    '<p>I. Producto Interno Bruto</p>' +
    '<p>Prosa que sigue al numeral romano.</p>' +
    '<h2>C. Análisis del Sector</h2>' +
    '<p>Prosa del análisis sectorial.</p>' +
    '<h1>IV. ANÁLISIS DE COMPARABILIDAD</h1>' +
    '<p>Prosa de la cuarta, que sí queda fuera.</p>');
  for (const dentro of ['I. Producto Interno Bruto', 'Prosa que sigue al numeral romano',
    'C. Análisis del Sector', 'Prosa del análisis sectorial']) {
    assert.match(parrafoCon(doc, dentro),
      new RegExp('w:ascii="' + FUENTE_MACRO + '"'), dentro);
  }
  assert.doesNotMatch(parrafoCon(doc, 'Prosa de la cuarta'),
    new RegExp('w:ascii="' + FUENTE_MACRO + '"'), 'la sección no se cerró en IV');
});
