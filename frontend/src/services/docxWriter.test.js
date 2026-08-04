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

test('la letra del encabezado de tabla sale blanca sobre el fondo oscuro', async () => {
  /* Antes, el fallback que ponía `color: 'FFFFFF'` era código muerto: `bloquesDe` siempre
     vuelca el texto suelto de una celda como párrafo (el `volcar()` final, fuera del `for`),
     así que la rama que llevaba el color nunca se alcanzaba y los encabezados salían con
     letra oscura sobre el fondo `#0E1726` — ilegibles. */
  const { doc } = await abrir(
    '<table><tr><th>Concepto</th><th>Valor</th></tr><tr><td>Activo</td></tr></table>');
  assert.match(doc, /<w:color w:val="FFFFFF"\/>/);
  assert.match(doc, /w:val="clear"/);
  const blancos = (doc.match(/<w:color w:val="FFFFFF"\/>/g) || []).length;
  assert.equal(blancos, 2, 'debe haber un <w:color w:val="FFFFFF"/> por cada th, ni uno más');
  /* La celda de datos (`td`) no lleva el color del encabezado. */
  const celdaActivo = /<w:tc>(?:(?!<w:tc>)[\s\S])*?Activo[\s\S]*?<\/w:tc>/.exec(doc)[0];
  assert.doesNotMatch(celdaActivo, /w:color="FFFFFF"/);
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

test('cada página del original empieza en una hoja nueva', async () => {
  const html = '<div class="pagina" data-pagina="1" data-orientacion="vertical"><p>una</p></div>' +
    '<div class="pagina" data-pagina="2" data-orientacion="vertical"><p>dos</p></div>' +
    '<div class="pagina" data-pagina="3" data-orientacion="vertical"><p>tres</p></div>';
  const { doc } = await abrir(html);
  /* Dos saltos para tres páginas: la primera no lleva salto delante. */
  assert.equal((doc.match(/<w:br w:type="page"\/>/g) || []).length, 2);
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
