import { test } from 'node:test';
import assert from 'node:assert';
import {
  Document, Packer, Paragraph, TextRun, Header, Footer, PageNumber,
  Table, TableRow, TableCell, WidthType, ShadingType,
} from 'docx';
import PizZip from 'pizzip';
import {
  renderizarDocx, insertarImagenes, rellenarDocx, desdeDataUrl,
  CENTINELA_ANEXO, SIN_DATO, EMU_POR_CM, actualizarTablasMacroOoxml,
  coleccionesDelEstudio,
} from './docxRelleno.js';


/* Un PNG de 1×1 válido, para no meter binarios en el repo. */
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG_DATA_URL = 'data:image/png;base64,' + PNG_B64;

const ESTUDIO = {
  ent: 'ACME COLOMBIA S.A.S', nit: '900.123.456-7', anio: '2024',
  vinc: 'ACME INC', pais_vinc: 'ESTADOS UNIDOS',
  t_cash: 87957645,
};

const parrafo = (...runs) => new Paragraph({
  children: runs.map((r) => (typeof r === 'string' ? new TextRun({ text: r }) : new TextRun(r))),
});

async function plantilla(parrafos, opciones = {}) {
  return Packer.toBuffer(new Document({ sections: [{ ...opciones, children: parrafos }] }));
}

/** Texto visible de una parte del zip. */
const textoDe = (zip, ruta) => {
  const f = zip.file(ruta);
  if (!f) return '';
  return (f.asText().match(/<w:t[^>]*>([^<]*)<\/w:t>/g) || [])
    .map((s) => s.replace(/<[^>]+>/g, '')).join('');
};

/* ══════════════════ Sustitución de campos ══════════════════ */

test('sustituye los campos del estudio conservando el texto de alrededor', async () => {
  const buf = await plantilla([parrafo('La sociedad {ent} con NIT {nit} declara por {anio}.')]);
  const { zip } = renderizarDocx(buf, ESTUDIO);
  assert.strictEqual(textoDe(zip, 'word/document.xml'),
    'La sociedad ACME COLOMBIA S.A.S con NIT 900.123.456-7 declara por 2024.');
});

test('resuelve un marcador que Word partió en varios runs', async () => {
  /* El riesgo principal de esta ruta: Word parte las frases en runs y un
     `.replace` sobre el XML no encontraría nada. */
  const buf = await plantilla([parrafo('Soc. ', '{en', { text: 't}', bold: true }, ' fin')]);
  const { zip } = renderizarDocx(buf, ESTUDIO);
  assert.strictEqual(textoDe(zip, 'word/document.xml'), 'Soc. ACME COLOMBIA S.A.S fin');
});

test('resuelve los marcadores del encabezado y del pie', async () => {
  /* Es justo lo que la conversión a HTML perdía entero. */
  const buf = await plantilla([parrafo('Cuerpo')], {
    headers: { default: new Header({ children: [parrafo('Informe de {ent}')] }) },
    footers: { default: new Footer({ children: [new Paragraph({ children: [new TextRun({ children: ['Pág. ', PageNumber.CURRENT] })] })] }) },
  });
  const { zip } = renderizarDocx(buf, ESTUDIO);
  const cab = Object.keys(zip.files).find((f) => /word\/header\d*\.xml$/.test(f));
  const pie = Object.keys(zip.files).find((f) => /word\/footer\d*\.xml$/.test(f));
  assert.strictEqual(textoDe(zip, cab), 'Informe de ACME COLOMBIA S.A.S');
  assert.match(zip.file(pie).asText(), /PAGE/, 'el campo PAGE del pie sigue siendo un campo');
});

test('los campos con punto se resuelven por valorDeCampo', async () => {
  const buf = await plantilla([parrafo('Efectivo: {eeff.t_cash}. Tope: {uvt.tope45k}.')]);
  const { zip } = renderizarDocx(buf, ESTUDIO);
  const texto = textoDe(zip, 'word/document.xml');
  assert.match(texto, /Efectivo: 87\.957\.645/, 'formatea con separador de miles');
  assert.ok(!texto.includes('{uvt.tope45k}'), 'el tope se resuelve');
  assert.ok(!texto.includes(SIN_DATO), 'y no queda como hueco');
});

test('un campo sin dato sale como hueco y se reporta', async () => {
  /* La regla del vocabulario: nunca un valor por defecto. El informe se radica
     ante la DIAN y heredar la cifra del cliente anterior es el error grave. */
  const buf = await plantilla([parrafo('Representante: {representante}.')]);
  const { zip, camposVacios } = renderizarDocx(buf, ESTUDIO);
  assert.strictEqual(textoDe(zip, 'word/document.xml'), `Representante: ${SIN_DATO}.`);
  assert.deepStrictEqual(camposVacios, ['representante']);
});

test('sin marcadores el documento pasa sin cambios en su texto', async () => {
  const buf = await plantilla([parrafo('Un texto sin ningún marcador.')]);
  const { zip, camposVacios } = renderizarDocx(buf, ESTUDIO);
  assert.strictEqual(textoDe(zip, 'word/document.xml'), 'Un texto sin ningún marcador.');
  assert.deepStrictEqual(camposVacios, []);
});

test('acepta otros delimitadores', async () => {
  const buf = await plantilla([parrafo('Sociedad «ent» aquí')]);
  const { zip } = renderizarDocx(buf, ESTUDIO, { delimitadores: { abrir: '«', cerrar: '»' } });
  assert.strictEqual(textoDe(zip, 'word/document.xml'), 'Sociedad ACME COLOMBIA S.A.S aquí');
});

/* ══════════════════ El formato se conserva ══════════════════ */

test('el formato de la plantilla sobrevive al relleno', async () => {
  const buf = await plantilla([
    parrafo({ text: '{ent}', font: 'Garamond', size: 22, color: '1F3864' }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [new TableRow({
        children: ['Compañía', 'Margen'].map((t) => new TableCell({
          shading: { type: ShadingType.CLEAR, fill: '1F3864' },
          children: [new Paragraph({ children: [new TextRun({ text: t, bold: true })] })],
        })),
      })],
    }),
  ]);
  const { zip } = renderizarDocx(buf, ESTUDIO);
  const xml = zip.file('word/document.xml').asText();
  assert.match(xml, /Garamond/, 'la fuente sigue ahí');
  assert.match(xml, /1F3864/, 'el color y el sombreado también');
  assert.match(xml, /<w:tbl>/, 'la tabla sigue siendo una tabla');
  assert.match(xml, /ACME COLOMBIA S\.A\.S/, 'y el dato entró');
});

/* ══════════════════ Bucles de tabla ══════════════════ */

test('un bucle genera una fila por elemento conservando el formato', async () => {
  const filaModelo = (a, b) => new TableRow({
    children: [a, b].map((t) => new TableCell({
      shading: { type: ShadingType.CLEAR, fill: 'DDDDDD' },
      children: [new Paragraph({ children: [new TextRun({ text: t })] })],
    })),
  });
  const buf = await plantilla([
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [filaModelo('Compañía', 'Margen'), filaModelo('{#comparables}{nombre}', '{margen}{/comparables}')],
    }),
  ]);
  const { zip } = renderizarDocx(buf, ESTUDIO, {
    colecciones: { comparables: [
      { nombre: 'Alpha SA', margen: '12,5 %' },
      { nombre: 'Beta Ltd', margen: '7,1 %' },
      { nombre: 'Gamma SAS', margen: '3,4 %' },
    ] },
  });
  const xml = zip.file('word/document.xml').asText();
  const texto = textoDe(zip, 'word/document.xml');
  assert.match(texto, /Alpha SA.*Beta Ltd.*Gamma SAS/, 'las tres filas, en orden');
  assert.strictEqual((xml.match(/<w:tr>/g) || []).length, 4, 'encabezado + una fila por comparable');
  assert.strictEqual((xml.match(/DDDDDD/g) || []).length, 8, 'cada celda conserva su sombreado');
});

test('un bucle sin elementos no deja filas ni marcadores', async () => {
  const buf = await plantilla([
    new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [
      new TableRow({ children: [new TableCell({ children: [new Paragraph('Compañía')] })] }),
      new TableRow({ children: [new TableCell({ children: [new Paragraph('{#comparables}{nombre}{/comparables}')] })] }),
    ] }),
  ]);
  const { zip } = renderizarDocx(buf, ESTUDIO, { colecciones: { comparables: [] } });
  const texto = textoDe(zip, 'word/document.xml');
  assert.ok(!texto.includes('{'), 'sin marcadores sueltos');
  assert.ok(!texto.includes('nombre'), 'y sin restos del bucle');
});

test('dentro de un bucle manda el elemento, no el estudio', async () => {
  /* `{ent}` dentro de una fila de comparables debe ser el de la fila si la
     colección lo trae; si no, cae al estudio. */
  const buf = await plantilla([parrafo('{#filas}{ent}|{/filas}')]);
  const { zip } = renderizarDocx(buf, ESTUDIO, { colecciones: { filas: [{ ent: 'Uno' }, { ent: 'Dos' }] } });
  assert.strictEqual(textoDe(zip, 'word/document.xml'), 'Uno|Dos|');
});

/* ══════════════════ Imágenes del anexo ══════════════════ */

test('desdeDataUrl reconoce png y jpeg y rechaza lo demás', () => {
  assert.deepStrictEqual(desdeDataUrl(PNG_DATA_URL), { ext: 'png', base64: PNG_B64 });
  assert.strictEqual(desdeDataUrl('data:image/jpeg;base64,AAAA').ext, 'jpeg');
  assert.strictEqual(desdeDataUrl('data:image/jpg;base64,AAAA').ext, 'jpeg', 'jpg se normaliza a jpeg');
  assert.strictEqual(desdeDataUrl('no es una data url'), null);
  assert.strictEqual(desdeDataUrl(''), null);
});

test('inserta una imagen por página en el sitio del centinela', async () => {
  const buf = await plantilla([
    parrafo('ANEXO A — {ent}'), parrafo(CENTINELA_ANEXO), parrafo('Fin del anexo.'),
  ]);
  const { zip } = renderizarDocx(buf, ESTUDIO);
  const { insertadas } = insertarImagenes(zip, [{ dataUrl: PNG_DATA_URL }, { dataUrl: PNG_DATA_URL }]);

  assert.strictEqual(insertadas, 2);
  const xml = zip.file('word/document.xml').asText();
  const rels = zip.file('word/_rels/document.xml.rels').asText();

  assert.ok(zip.file('word/media/anexo_eeff_1.png'), 'el binario queda en word/media');
  assert.ok(zip.file('word/media/anexo_eeff_2.png'));
  assert.match(zip.file('[Content_Types].xml').asText(), /Extension="png"/);
  assert.strictEqual((xml.match(/<w:drawing>/g) || []).length, 2);
  assert.ok(!xml.includes(CENTINELA_ANEXO), 'el centinela desaparece');
  assert.match(textoDe(zip, 'word/document.xml'), /ANEXO A — ACME COLOMBIA S\.A\.S/);
  assert.match(textoDe(zip, 'word/document.xml'), /Fin del anexo\./, 'lo de después sobrevive');

  const ids = [...xml.matchAll(/r:embed="(rId\d+)"/g)].map((m) => m[1]);
  assert.strictEqual(ids.length, 2);
  ids.forEach((id) => assert.ok(rels.includes(`Id="${id}"`), `${id} debe existir en las relaciones`));
  assert.strictEqual(new Set(ids).size, ids.length, 'sin rId repetidos');
});

test('los rId nuevos no pisan los que ya usaba la plantilla', async () => {
  const buf = await plantilla([parrafo(CENTINELA_ANEXO)]);
  const { zip } = renderizarDocx(buf, ESTUDIO);
  const previos = [...zip.file('word/_rels/document.xml.rels').asText().matchAll(/Id="rId(\d+)"/g)]
    .map((m) => Number(m[1]));
  insertarImagenes(zip, [{ dataUrl: PNG_DATA_URL }]);
  const nuevo = [...zip.file('word/document.xml').asText().matchAll(/r:embed="rId(\d+)"/g)]
    .map((m) => Number(m[1]))[0];
  assert.ok(nuevo > Math.max(0, ...previos), `rId${nuevo} debe superar a los previos`);
});

test('los identificadores de dibujo no se repiten', async () => {
  const buf = await plantilla([parrafo(CENTINELA_ANEXO)]);
  const { zip } = renderizarDocx(buf, ESTUDIO);
  insertarImagenes(zip, [{ dataUrl: PNG_DATA_URL }, { dataUrl: PNG_DATA_URL }, { dataUrl: PNG_DATA_URL }]);
  const ids = [...zip.file('word/document.xml').asText().matchAll(/<wp:docPr\s+id="(\d+)"/g)].map((m) => m[1]);
  assert.strictEqual(ids.length, 3);
  assert.strictEqual(new Set(ids).size, 3, 'Word exige que sean únicos');
});

test('el XML con imágenes queda balanceado y con su namespace', async () => {
  const buf = await plantilla([parrafo('Antes'), parrafo(CENTINELA_ANEXO), parrafo('Después')]);
  const { zip } = renderizarDocx(buf, ESTUDIO);
  insertarImagenes(zip, [{ dataUrl: PNG_DATA_URL }, { dataUrl: PNG_DATA_URL }]);
  const xml = zip.file('word/document.xml').asText();
  assert.strictEqual((xml.match(/<w:p[ >]/g) || []).length, (xml.match(/<\/w:p>/g) || []).length,
    'párrafos balanceados');
  assert.strictEqual((xml.match(/<w:drawing>/g) || []).length, (xml.match(/<\/w:drawing>/g) || []).length);
  assert.match(xml, /xmlns:wp=/, 'el namespace wp está declarado');
});

test('sin centinela no se inserta nada y el documento no se toca', async () => {
  const buf = await plantilla([parrafo('Un informe sin anexo.')]);
  const { zip } = renderizarDocx(buf, ESTUDIO);
  const antes = zip.file('word/document.xml').asText();
  const { insertadas } = insertarImagenes(zip, [{ dataUrl: PNG_DATA_URL }]);
  assert.strictEqual(insertadas, 0);
  assert.strictEqual(zip.file('word/document.xml').asText(), antes);
});

test('sin imágenes el centinela se retira igual', async () => {
  /* Dejarlo visible imprimiría «@@ANEXO_EEFF@@» en un informe que se radica. */
  const buf = await plantilla([parrafo('Antes'), parrafo(CENTINELA_ANEXO), parrafo('Después')]);
  const { zip } = renderizarDocx(buf, ESTUDIO);
  insertarImagenes(zip, []);
  const texto = textoDe(zip, 'word/document.xml');
  assert.ok(!texto.includes(CENTINELA_ANEXO), 'el centinela no llega al informe');
  assert.match(texto, /AntesDespués/);
});

test('el tamaño por defecto ocupa el ancho útil de la hoja', async () => {
  const buf = await plantilla([parrafo(CENTINELA_ANEXO)]);
  const { zip } = renderizarDocx(buf, ESTUDIO);
  insertarImagenes(zip, [{ dataUrl: PNG_DATA_URL }]);
  const m = /<wp:extent cx="(\d+)" cy="(\d+)"\/>/.exec(zip.file('word/document.xml').asText());
  assert.ok(m, 'la imagen declara su tamaño');
  assert.strictEqual(Number(m[1]), 16 * EMU_POR_CM, '16 cm de ancho');
  assert.ok(Number(m[2]) > Number(m[1]), 'y proporción vertical, como una hoja escaneada');
});

test('una imagen ilegible se salta sin tumbar el anexo', async () => {
  const buf = await plantilla([parrafo(CENTINELA_ANEXO)]);
  const { zip } = renderizarDocx(buf, ESTUDIO);
  const { insertadas } = insertarImagenes(zip, [
    { dataUrl: PNG_DATA_URL }, { dataUrl: 'basura' }, { dataUrl: PNG_DATA_URL },
  ]);
  assert.strictEqual(insertadas, 2, 'entran las dos buenas');
});

/* ══════════════════ El camino completo ══════════════════ */

test('rellenarDocx entrega un .docx válido con datos, tabla e imágenes', async () => {
  const buf = await plantilla([
    parrafo({ text: 'Informe de {ent} — {anio}', font: 'Garamond' }),
    new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [
      new TableRow({ children: [new TableCell({ children: [new Paragraph('{#comparables}{nombre}{/comparables}')] })] }),
    ] }),
    parrafo(CENTINELA_ANEXO),
    parrafo('Representante: {representante}'),
  ]);
  const { salida, camposVacios, imagenesInsertadas } = rellenarDocx({
    binario: buf, estudio: ESTUDIO,
    colecciones: { comparables: [{ nombre: 'Alpha SA' }, { nombre: 'Beta Ltd' }] },
    imagenesAnexo: [{ dataUrl: PNG_DATA_URL }],
    tipoSalida: 'nodebuffer',
  });

  assert.ok(Buffer.isBuffer(salida) && salida.length > 0, 'devuelve el binario');
  assert.strictEqual(imagenesInsertadas, 1);
  assert.deepStrictEqual(camposVacios, ['representante']);

  const z = new PizZip(salida);
  const texto = textoDe(z, 'word/document.xml');
  assert.match(texto, /Informe de ACME COLOMBIA S\.A\.S — 2024/);
  assert.match(texto, /Alpha SA/);
  assert.match(texto, /Beta Ltd/);
  assert.match(texto, new RegExp(`Representante: ${SIN_DATO}`));
  assert.ok(!texto.includes(CENTINELA_ANEXO));
  assert.match(z.file('word/document.xml').asText(), /Garamond/, 'el formato sigue intacto');
  assert.ok(z.file('word/media/anexo_eeff_1.png'), 'y la imagen quedó dentro');
});

test('el .docx resultante conserva las partes obligatorias del paquete', async () => {
  const buf = await plantilla([parrafo('{ent}')]);
  const { salida } = rellenarDocx({ binario: buf, estudio: ESTUDIO, tipoSalida: 'nodebuffer' });
  const z = new PizZip(salida);
  ['[Content_Types].xml', '_rels/.rels', 'word/document.xml'].forEach((ruta) => {
    assert.ok(z.file(ruta), `falta ${ruta}, el paquete no sería un .docx`);
  });
});

test('rellenar dos veces la misma plantilla da el mismo resultado', async () => {
  /* Sin esto, un segundo relleno sobre el mismo buffer podría arrastrar estado. */
  const buf = await plantilla([parrafo('{ent} en {anio}')]);
  const uno = rellenarDocx({ binario: buf, estudio: ESTUDIO, tipoSalida: 'nodebuffer' });
  const dos = rellenarDocx({ binario: buf, estudio: ESTUDIO, tipoSalida: 'nodebuffer' });
  assert.strictEqual(
    textoDe(new PizZip(uno.salida), 'word/document.xml'),
    textoDe(new PizZip(dos.salida), 'word/document.xml'),
  );
});

test('el ciclo real: marcar la plantilla y luego rellenarla', async () => {
  /* La cadena completa que verá el usuario: sube su Word con los datos del
     cliente anterior, la IA marca, y el informe sale con los datos nuevos. */
  const { aplicarMarcasOoxml } = await import('./docxPlantilla.js');
  const buf = await plantilla([
    parrafo('La sociedad ', 'END GAME ', { text: 'COLOMBIA', bold: true }, ' S.A.S, NIT 901.337.576-6.'),
  ]);
  const zipOrigen = new PizZip(buf);
  const marcado = aplicarMarcasOoxml(zipOrigen.file('word/document.xml').asText(), [
    { fragmento: 'END GAME COLOMBIA S.A.S', campo: 'ent' },
    { fragmento: '901.337.576-6', campo: 'nit' },
  ]);
  assert.strictEqual(marcado.aplicadas, 2);
  zipOrigen.file('word/document.xml', marcado.xml);

  const { salida } = rellenarDocx({
    binario: zipOrigen.generate({ type: 'nodebuffer' }), estudio: ESTUDIO, tipoSalida: 'nodebuffer',
  });
  const texto = textoDe(new PizZip(salida), 'word/document.xml');
  assert.strictEqual(texto, 'La sociedad ACME COLOMBIA S.A.S, NIT 900.123.456-7.');
  assert.ok(!texto.includes('END GAME'), 'no queda rastro del cliente anterior');
});

test('actualización de tablas macroeconómicas en el OOXML de docxRelleno', async () => {
  const xmlOriginal = '<w:p><w:t>Crecimiento del PIB Mundial (2023-2025)</w:t></w:p><w:tbl><w:tr><w:tc><w:p><w:t>Header</w:t></w:p></w:tc></w:tr></w:tbl>';
  const year = 2025;
  const datosMacro = {
    series: {
      pib_mundial: {
        valores: { 2024: '3.3', 2025: '3.2', 2026: '2.8' },
        fuente: 'FMI',
      }
    }
  };
  const xmlActualizado = actualizarTablasMacroOoxml(xmlOriginal, datosMacro, year);
  assert.ok(xmlActualizado.includes('Crecimiento del PIB Mundial (2024-2026)'), 'No actualizó el rango del título en la tabla de PIB mundial');
  assert.ok(xmlActualizado.includes('2024'), 'Falta el año 2024 en la tabla de PIB mundial');
  assert.ok(xmlActualizado.includes('3.3'), 'Falta el valor 3.3 en la tabla de PIB mundial');
  assert.ok(xmlActualizado.includes('2.8'), 'Falta el valor 2.8 en la tabla de PIB mundial');
});

test('coleccionesDelEstudio arma las comparables, razones de rechazo y los accionistas correctamente', () => {
  const estudioConAccionistas = {
    embudoSeleccion: {
      evaluadas: 10,
      seleccionadas: 2,
      porMotivo: { holding: 8 }
    },
    comparables: [
      { name: 'Comp A', amb: 'Int', s: 1000, c: 800, op: 100 },
      { name: 'Comp B', amb: 'Nac', s: 2000, c: 1500, op: 200 }
    ],
    accionistas: [
      { nombre: 'Accionista A', pais: 'USA', acciones: 150000, valor_capital: 150000000, participacion_pct: 75 },
      { nombre: 'Accionista B', pais: 'COLOMBIA', acciones: 50000, valor_capital: 50000000, participacion_pct: 25 }
    ]
  };

  const colecciones = coleccionesDelEstudio(estudioConAccionistas);
  assert.ok(Array.isArray(colecciones.comparables), 'Debe tener la colección comparables');
  assert.ok(Array.isArray(colecciones.razonesRechazo), 'Debe tener la colección razonesRechazo');
  assert.ok(Array.isArray(colecciones.accionistas), 'Debe tener la colección accionistas de la Fase 2');

  assert.strictEqual(colecciones.accionistas.length, 2);
  assert.strictEqual(colecciones.accionistas[0].nombre, 'Accionista A');
  assert.strictEqual(colecciones.accionistas[0].acciones, '150.000');
  assert.strictEqual(colecciones.accionistas[0].participacion, '75');
});

