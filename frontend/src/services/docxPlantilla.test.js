import { test } from 'node:test';
import assert from 'node:assert';
import {
  Document, Packer, Paragraph, TextRun, Header,
  Table, TableRow, TableCell, WidthType, ShadingType,
} from 'docx';
import PizZip from 'pizzip';
import {
  textoPorParrafo, aHtmlSintetico, htmlParaMarcar, aplicarMarcasOoxml, camposMarcados,
  envolverTablaEnBucle,
} from './docxPlantilla.js';
import { proponerMarcas, MOTIVO_NO_APARECE, MOTIVO_SIN_APARICION_LIBRE } from './plantillaMarcador.js';

/* Estos tests construyen .docx de verdad con la librería `docx` y los releen con
   PizZip, que es el patrón de docxWriter.test.js: sin navegador y sin fixtures
   binarios en el repo. Lo que no pueden comprobar es que Word abra el resultado —no
   hay con qué renderizar en esta máquina—, así que verifican el XML emitido. */

/** Construye un .docx y devuelve su `word/document.xml`. */
async function documentXml(parrafos, opciones = {}) {
  const doc = new Document({ sections: [{ ...opciones, children: parrafos }] });
  const buf = await Packer.toBuffer(doc);
  return new PizZip(buf).file('word/document.xml').asText();
}

const parrafo = (...runs) => new Paragraph({ children: runs.map((r) => (typeof r === 'string' ? new TextRun({ text: r }) : new TextRun(r))) });

/* ══════════════════ textoPorParrafo ══════════════════ */

test('textoPorParrafo une el texto que Word dejó partido en varios runs', async () => {
  const xml = await documentXml([
    parrafo('La sociedad ', 'END GAME ', { text: 'COLOMBIA', bold: true }, ' S.A.S declara.'),
  ]);
  const ps = textoPorParrafo(xml);
  assert.strictEqual(ps.length, 1);
  assert.strictEqual(ps[0].texto, 'La sociedad END GAME COLOMBIA S.A.S declara.');
  assert.strictEqual(ps[0].partes, 4, 'venía en cuatro <w:t>');
});

test('textoPorParrafo devuelve un párrafo por cada w:p y en orden', async () => {
  const xml = await documentXml([parrafo('Primero'), parrafo('Segundo'), parrafo('Tercero')]);
  assert.deepStrictEqual(textoPorParrafo(xml).map((p) => p.texto), ['Primero', 'Segundo', 'Tercero']);
});

test('textoPorParrafo desescapa las entidades XML', async () => {
  const xml = await documentXml([parrafo('Pérez & Cía. <sociedad>')]);
  assert.strictEqual(textoPorParrafo(xml)[0].texto, 'Pérez & Cía. <sociedad>');
});

test('un párrafo sin texto no rompe ni desaparece', async () => {
  const xml = await documentXml([parrafo('Uno'), new Paragraph({}), parrafo('Dos')]);
  const ps = textoPorParrafo(xml);
  assert.strictEqual(ps.length, 3);
  assert.strictEqual(ps[1].texto, '');
  assert.strictEqual(ps[1].partes, 0);
});

/* ══════════════════ HTML sintético ══════════════════ */

test('aHtmlSintetico da un <p> por párrafo con el texto unido', async () => {
  const xml = await documentXml([parrafo('END ', 'GAME'), parrafo('Otro')]);
  assert.strictEqual(htmlParaMarcar(xml), '<p>END GAME</p><p>Otro</p>');
});

test('el HTML sintético escapa lo que rompería el marcado', () => {
  const html = aHtmlSintetico([{ texto: 'A & B <c>' }]);
  assert.strictEqual(html, '<p>A &amp; B &lt;c&gt;</p>');
});

test('proponerMarcas funciona sobre el HTML sintético sin tocarlo', async () => {
  /* La razón de ser de aHtmlSintetico: que el marcado existente sirva para .docx.
     Se sustituye la llamada al modelo por una respuesta fija. */
  const xml = await documentXml([
    parrafo('La sociedad ', 'END GAME ', { text: 'COLOMBIA', bold: true }, ' S.A.S declara.'),
  ]);
  const pedir = async () => JSON.stringify({
    marcas: [{ fragmento: 'END GAME COLOMBIA S.A.S', campo: 'ent', ocurrencia: 1 }],
  });
  const propuestas = await proponerMarcas(htmlParaMarcar(xml), { pedir });
  assert.strictEqual(propuestas.marcas.length, 1);
  assert.strictEqual(propuestas.marcas[0].campo, 'ent');
  assert.strictEqual(propuestas.trozosFallidos, 0);
});

/* ══════════════════ aplicarMarcasOoxml ══════════════════ */

test('marca un fragmento que Word partió en tres runs', async () => {
  const xml = await documentXml([
    parrafo('La sociedad ', 'END GAME ', { text: 'COLOMBIA', bold: true }, ' S.A.S declara.'),
  ]);
  const r = aplicarMarcasOoxml(xml, [{ fragmento: 'END GAME COLOMBIA S.A.S', campo: 'ent' }]);
  assert.strictEqual(r.aplicadas, 1);
  assert.deepStrictEqual(r.descartadas, []);
  assert.strictEqual(textoPorParrafo(r.xml)[0].texto, 'La sociedad {ent} declara.');
});

test('el texto de alrededor sobrevive intacto', async () => {
  const xml = await documentXml([parrafo('NIT 901.337.576-6 del contribuyente')]);
  const r = aplicarMarcasOoxml(xml, [{ fragmento: '901.337.576-6', campo: 'nit' }]);
  assert.strictEqual(textoPorParrafo(r.xml)[0].texto, 'NIT {nit} del contribuyente');
});

test('la ocurrencia se cuenta sobre todo el documento, no por párrafo', async () => {
  const xml = await documentXml([
    parrafo('Primera mención de ACME S.A.S aquí'),
    parrafo('Segunda mención de ACME S.A.S allá'),
    parrafo('Tercera mención de ACME S.A.S al final'),
  ]);
  const r = aplicarMarcasOoxml(xml, [{ fragmento: 'ACME S.A.S', campo: 'ent', ocurrencia: 2 }]);
  assert.strictEqual(r.aplicadas, 1);
  const textos = textoPorParrafo(r.xml).map((p) => p.texto);
  assert.ok(textos[0].includes('ACME S.A.S'), 'la primera no se toca');
  assert.ok(textos[1].includes('{ent}'), 'se marca la segunda');
  assert.ok(textos[2].includes('ACME S.A.S'), 'la tercera tampoco');
});

test('varias ocurrencias del mismo fragmento en un mismo párrafo', async () => {
  const xml = await documentXml([parrafo('2024 y 2024 y 2024')]);
  const r = aplicarMarcasOoxml(xml, [
    { fragmento: '2024', campo: 'anio', ocurrencia: 1 },
    { fragmento: '2024', campo: 'anio', ocurrencia: 2 },
    { fragmento: '2024', campo: 'anio', ocurrencia: 3 },
  ]);
  assert.strictEqual(r.aplicadas, 3);
  assert.strictEqual(textoPorParrafo(r.xml)[0].texto, '{anio} y {anio} y {anio}');
});

test('numerar las marcas al revés no las descoloca', async () => {
  /* Regresión del error que documenta aplicarMarcas: si la numeración se
     recalculara tras cada marca, la 1 acabaría en el sitio de la 2. */
  const xml = await documentXml([parrafo('A ACME B ACME C')]);
  const r = aplicarMarcasOoxml(xml, [
    { fragmento: 'ACME', campo: 'ent', ocurrencia: 2 },
    { fragmento: 'ACME', campo: 'ent', ocurrencia: 1 },
  ]);
  assert.strictEqual(r.aplicadas, 2);
  assert.strictEqual(textoPorParrafo(r.xml)[0].texto, 'A {ent} B {ent} C');
});

test('un campo fuera del vocabulario se descarta con su motivo', async () => {
  const xml = await documentXml([parrafo('Texto ACME aquí')]);
  const r = aplicarMarcasOoxml(xml, [{ fragmento: 'ACME', campo: 'inventado' }]);
  assert.strictEqual(r.aplicadas, 0);
  assert.match(r.descartadas[0].motivo, /vocabulario/);
});

test('un fragmento que no está se descarta como no aparece', async () => {
  const xml = await documentXml([parrafo('Texto cualquiera')]);
  const r = aplicarMarcasOoxml(xml, [{ fragmento: 'NO ESTÁ', campo: 'ent' }]);
  assert.strictEqual(r.descartadas[0].motivo, MOTIVO_NO_APARECE);
});

test('pedir una ocurrencia que no existe no marca en el sitio equivocado', async () => {
  /* El caso peligroso: si cayera en la 1.ª, el dato del cliente anterior
     sobreviviría en otro punto del informe sin que nadie lo note. */
  const xml = await documentXml([parrafo('Solo una vez ACME')]);
  const r = aplicarMarcasOoxml(xml, [{ fragmento: 'ACME', campo: 'ent', ocurrencia: 3 }]);
  assert.strictEqual(r.aplicadas, 0);
  assert.strictEqual(r.descartadas[0].motivo, MOTIVO_SIN_APARICION_LIBRE);
  assert.ok(textoPorParrafo(r.xml)[0].texto.includes('ACME'), 'el texto queda como estaba');
});

test('dos marcas que pisan el mismo texto: la segunda se descarta como solape', async () => {
  const xml = await documentXml([parrafo('ACME COLOMBIA S.A.S declara')]);
  const r = aplicarMarcasOoxml(xml, [
    { fragmento: 'ACME COLOMBIA S.A.S', campo: 'ent' },
    { fragmento: 'COLOMBIA', campo: 'pais_vinc' },
  ]);
  assert.strictEqual(r.aplicadas, 1, 'solo entra la primera');
  assert.strictEqual(r.descartadas.length, 1);
  assert.match(r.descartadas[0].motivo, /solapa/);
  assert.strictEqual(textoPorParrafo(r.xml)[0].texto, '{ent} declara');
});

test('dos marcas contiguas que no se pisan entran las dos', async () => {
  const xml = await documentXml([parrafo('ACME y 2024 juntos')]);
  const r = aplicarMarcasOoxml(xml, [
    { fragmento: 'ACME', campo: 'ent' },
    { fragmento: '2024', campo: 'anio' },
  ]);
  assert.strictEqual(r.aplicadas, 2);
  assert.strictEqual(textoPorParrafo(r.xml)[0].texto, '{ent} y {anio} juntos');
});

test('sin marcas el XML sale byte a byte igual', async () => {
  const xml = await documentXml([parrafo('Uno'), parrafo('Dos')]);
  assert.strictEqual(aplicarMarcasOoxml(xml, []).xml, xml);
  assert.strictEqual(aplicarMarcasOoxml(xml, null).xml, xml);
});

test('quitar los marcadores devuelve el texto original', async () => {
  /* El invariante que plantillaMarcador se exige a sí mismo: el marcado no
     inventa ni pierde contenido. Se comprueba sobre el texto visible, porque la
     redistribución sí mueve el contenido entre runs. */
  const original = 'La sociedad ACME S.A.S con NIT 900.1-2 en 2024';
  const xml = await documentXml([parrafo('La sociedad ', 'ACME S.A.S', ' con NIT ', '900.1-2', ' en 2024')]);
  const r = aplicarMarcasOoxml(xml, [
    { fragmento: 'ACME S.A.S', campo: 'ent' },
    { fragmento: '900.1-2', campo: 'nit' },
    { fragmento: '2024', campo: 'anio' },
  ]);
  const desmarcado = textoPorParrafo(r.xml)[0].texto
    .replace('{ent}', 'ACME S.A.S').replace('{nit}', '900.1-2').replace('{anio}', '2024');
  assert.strictEqual(desmarcado, original);
});

test('los espacios de los extremos se conservan con xml:space', async () => {
  const xml = await documentXml([parrafo('Antes ', 'ACME', ' después')]);
  const r = aplicarMarcasOoxml(xml, [{ fragmento: 'ACME', campo: 'ent' }]);
  assert.strictEqual(textoPorParrafo(r.xml)[0].texto, 'Antes {ent} después');
  assert.match(r.xml, /<w:t xml:space="preserve">/);
});

test('un texto con & se marca sin romper el XML', async () => {
  const xml = await documentXml([parrafo('Pérez & Cía. S.A.S declara')]);
  const r = aplicarMarcasOoxml(xml, [{ fragmento: 'Pérez & Cía. S.A.S', campo: 'ent' }]);
  assert.strictEqual(r.aplicadas, 1);
  assert.strictEqual(textoPorParrafo(r.xml)[0].texto, '{ent} declara');
  assert.ok(!/&(?!amp;|lt;|gt;|quot;|apos;)/.test(r.xml), 'no quedan & sin escapar');
});

test('los runs vacíos se conservan para no perder su formato', async () => {
  const xml = await documentXml([parrafo('a ', { text: 'ACME', bold: true }, ' b')]);
  const antes = (xml.match(/<w:t/g) || []).length;
  const r = aplicarMarcasOoxml(xml, [{ fragmento: 'ACME', campo: 'ent' }]);
  assert.strictEqual((r.xml.match(/<w:t/g) || []).length, antes, 'mismo número de <w:t>');
  assert.strictEqual((r.xml.match(/<w:r>/g) || []).length, (xml.match(/<w:r>/g) || []).length);
});

test('marcar un párrafo no altera los demás', async () => {
  const xml = await documentXml([parrafo('Intacto uno'), parrafo('ACME aquí'), parrafo('Intacto dos')]);
  const r = aplicarMarcasOoxml(xml, [{ fragmento: 'ACME', campo: 'ent' }]);
  const t = textoPorParrafo(r.xml).map((p) => p.texto);
  assert.deepStrictEqual(t, ['Intacto uno', '{ent} aquí', 'Intacto dos']);
});

test('se pueden usar otros delimitadores', async () => {
  const xml = await documentXml([parrafo('Texto ACME aquí')]);
  const r = aplicarMarcasOoxml(xml, [{ fragmento: 'ACME', campo: 'ent' }], { abrir: '«', cerrar: '»' });
  assert.strictEqual(textoPorParrafo(r.xml)[0].texto, 'Texto «ent» aquí');
});

test('marca también dentro de un encabezado', async () => {
  /* Es la mitad del valor de esta ruta: el encabezado es justo lo que la
     conversión a HTML perdía por completo. */
  const doc = new Document({ sections: [{
    headers: { default: new Header({ children: [parrafo('Informe de ACME S.A.S')] }) },
    children: [parrafo('Cuerpo')],
  }] });
  const zip = new PizZip(await Packer.toBuffer(doc));
  const nombre = Object.keys(zip.files).find((f) => /word\/header\d*\.xml$/.test(f));
  assert.ok(nombre, 'el .docx trae encabezado');
  const r = aplicarMarcasOoxml(zip.file(nombre).asText(), [{ fragmento: 'ACME S.A.S', campo: 'ent' }]);
  assert.strictEqual(r.aplicadas, 1);
  assert.strictEqual(textoPorParrafo(r.xml)[0].texto, 'Informe de {ent}');
});

/* ══════════════════ camposMarcados ══════════════════ */

test('camposMarcados lista los campos de una plantilla ya marcada', async () => {
  const xml = await documentXml([parrafo('{ent} con NIT {nit}'), parrafo('en {anio}, otra vez {ent}')]);
  assert.deepStrictEqual(camposMarcados(xml).sort(), ['anio', 'ent', 'nit']);
});

test('camposMarcados ve un marcador partido entre runs', async () => {
  const xml = await documentXml([parrafo('Soc. ', '{en', { text: 't}', bold: true }, ' fin')]);
  assert.deepStrictEqual(camposMarcados(xml), ['ent'],
    'lo ve porque busca sobre el texto unido, no sobre el XML');
});

test('camposMarcados ignora los tags de bucle', async () => {
  const xml = await documentXml([parrafo('{#comparables}{nombre}{/comparables}')]);
  assert.deepStrictEqual(camposMarcados(xml), ['nombre']);
});

test('camposMarcados devuelve vacío en una plantilla sin marcar', async () => {
  const xml = await documentXml([parrafo('Texto normal sin nada')]);
  assert.deepStrictEqual(camposMarcados(xml), []);
});

/* ══════════════════ envolverTablaEnBucle ══════════════════ */

/** Una tabla con encabezado y una fila de datos, precedida de su título. */
function tablaConTitulo(titulo, encabezados, datos) {
  const fila = (celdas, negrita) => new TableRow({
    children: celdas.map((t) => new TableCell({
      shading: { type: ShadingType.CLEAR, fill: 'CCCCCC' },
      children: [new Paragraph({ children: [new TextRun({ text: t, bold: !!negrita })] })],
    })),
  });
  return [
    parrafo(titulo),
    new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [fila(encabezados, true), fila(datos)] }),
  ];
}

test('envolverTablaEnBucle marca la fila de datos y respeta el encabezado', async () => {
  const xml = await documentXml(tablaConTitulo(
    'Tabla 15. Muestra Compañías comparables',
    ['No.', 'Razón social', 'Ámbito'],
    ['1', 'Sega Corp', 'INTERNACIONAL'],
  ));
  const r = envolverTablaEnBucle(xml, {
    ancla: 'Tabla 15', coleccion: 'comparables', campos: ['n', 'nombre', 'ambito'],
  });
  assert.strictEqual(r.envuelta, true);
  const textos = textoPorParrafo(r.xml).map((p) => p.texto);
  assert.ok(textos.includes('Razón social'), 'el encabezado no se toca');
  assert.ok(!textos.includes('Sega Corp'), 'el dato del informe anterior desaparece');
  assert.ok(textos.some((t) => t === '{#comparables}{n}'), 'la primera celda abre el bucle');
  assert.ok(textos.some((t) => t === '{ambito}{/comparables}'), 'la última lo cierra');
});

test('la fila modelo conserva su formato al envolverse', async () => {
  const xml = await documentXml(tablaConTitulo('Tabla 15.', ['A', 'B'], ['x', 'y']));
  const r = envolverTablaEnBucle(xml, { ancla: 'Tabla 15', coleccion: 'comparables', campos: ['n', 'nombre'] });
  assert.strictEqual((r.xml.match(/CCCCCC/g) || []).length, 4, 'las cuatro celdas mantienen el sombreado');
  assert.strictEqual((r.xml.match(/<w:tr[ >]/g) || []).length, 2, 'sigue habiendo dos filas');
});

test('envolverTablaEnBucle no toca otras tablas del documento', async () => {
  const xml = await documentXml([
    ...tablaConTitulo('Tabla 14. Otra cosa', ['P', 'Q'], ['no', 'tocar']),
    ...tablaConTitulo('Tabla 15. Comparables', ['A', 'B'], ['sí', 'tocar']),
  ]);
  const r = envolverTablaEnBucle(xml, { ancla: 'Tabla 15', coleccion: 'comparables', campos: ['n', 'nombre'] });
  const textos = textoPorParrafo(r.xml).map((p) => p.texto);
  assert.ok(textos.includes('no') && textos.includes('tocar'), 'la tabla 14 queda intacta');
  assert.ok(textos.some((t) => t.startsWith('{#comparables}')), 'y la 15 sí se envuelve');
});

test('un título que no existe devuelve el motivo y no altera el XML', async () => {
  const xml = await documentXml(tablaConTitulo('Tabla 15.', ['A'], ['x']));
  const r = envolverTablaEnBucle(xml, { ancla: 'Tabla 99', coleccion: 'c', campos: ['n'] });
  assert.strictEqual(r.envuelta, false);
  assert.match(r.motivo, /no se encontró/);
  assert.strictEqual(r.xml, xml);
});

test('un título sin tabla detrás no rompe', async () => {
  const xml = await documentXml([parrafo('Tabla 15. Pendiente de incluir')]);
  const r = envolverTablaEnBucle(xml, { ancla: 'Tabla 15', coleccion: 'c', campos: ['n'] });
  assert.strictEqual(r.envuelta, false);
  assert.match(r.motivo, /no hay ninguna tabla/);
});

test('una configuración incompleta se rechaza sin tocar nada', async () => {
  const xml = await documentXml(tablaConTitulo('Tabla 15.', ['A'], ['x']));
  assert.strictEqual(envolverTablaEnBucle(xml, {}).envuelta, false);
  assert.strictEqual(envolverTablaEnBucle(xml, { ancla: 'Tabla 15' }).xml, xml);
});

test('envolverTablaEnBucle escribe el bucle aunque la celda de apertura no tenga texto', async () => {
  /* Una celda vacía —sin ningún `<w:t>`, solo su `<w:p>` en blanco— es el caso real que
     dejaba `{#razonesRechazo}` sin escribir y el .docx marcado con un bucle
     desbalanceado para siempre: "Unopened loop" en cuanto se intentaba rellenar. */
  const filaMixta = (celdas) => new TableRow({
    children: celdas.map((c) => new TableCell({
      children: [c == null ? new Paragraph({}) : new Paragraph({ children: [new TextRun({ text: c })] })],
    })),
  });
  const xml = await documentXml([
    parrafo('Tabla 16. Razones de rechazo'),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [filaMixta(['Filtro', 'N°']), filaMixta([null, '5'])],
    }),
  ]);
  const r = envolverTablaEnBucle(xml, {
    ancla: 'Tabla 16', coleccion: 'razonesRechazo', campos: ['letra', 'cantidad'],
  });
  assert.strictEqual(r.envuelta, true);
  assert.ok(r.xml.includes('{#razonesRechazo}'), 'la apertura se escribe aunque la celda estuviera vacía');
  assert.ok(r.xml.includes('{/razonesRechazo}'), 'el cierre también se escribe');
});
