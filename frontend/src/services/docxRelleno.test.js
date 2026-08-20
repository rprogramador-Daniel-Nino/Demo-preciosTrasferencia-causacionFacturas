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
  actualizarTablasOperacionesOoxml,
  coleccionesDelEstudio,
  textoPlanoOoxml, claveTitulo, numeroDeTabla, localizarBloqueTabla,
  localizarBloquesTabla, reescribirFilasOoxml,
  insertarAnexoA, insertarAnexoC, insertarImagenesAnexoB, actualizarProsaTrasTabla, actualizarAnioConclusionRango,
  localizarBloqueProsa, parrafosOoxmlDesdeHtml, actualizarApartadosMacroOoxml,
  localizarHitos, reemplazarPorHitos, actualizarApartadoSectorialOoxml,
  reescribirTextoParrafoOoxml, prefijoDeEncabezado,
  actualizarFormulasMatematicasOoxml,
  localizarAnexosOoxml, anexosDelDocumento, problemaDeIntegridadOoxml,
  generarTablaOoxml,
} from './docxRelleno.js';
import { FORMULA_AR, ooxmlDeFormula } from './formulasOmml.js';
import { filasRazonesRechazo } from './tablasInforme.js';
import { resolverSerie } from './analisisMercado.js';

/** Donde vive el cuerpo del documento dentro del .docx. */
const RUTA_DOC_TEST = 'word/document.xml';


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
    colecciones: {
      comparables: [
        { nombre: 'Alpha SA', margen: '12,5 %' },
        { nombre: 'Beta Ltd', margen: '7,1 %' },
        { nombre: 'Gamma SAS', margen: '3,4 %' },
      ]
    },
  });
  const xml = zip.file('word/document.xml').asText();
  const texto = textoDe(zip, 'word/document.xml');
  assert.match(texto, /Alpha SA.*Beta Ltd.*Gamma SAS/, 'las tres filas, en orden');
  assert.strictEqual((xml.match(/<w:tr>/g) || []).length, 4, 'encabezado + una fila por comparable');
  assert.strictEqual((xml.match(/DDDDDD/g) || []).length, 8, 'cada celda conserva su sombreado');
});

test('un bucle sin elementos no deja filas ni marcadores', async () => {
  const buf = await plantilla([
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE }, rows: [
        new TableRow({ children: [new TableCell({ children: [new Paragraph('Compañía')] })] }),
        new TableRow({ children: [new TableCell({ children: [new Paragraph('{#comparables}{nombre}{/comparables}')] })] }),
      ]
    }),
  ]);
  const { zip } = renderizarDocx(buf, ESTUDIO, { colecciones: { comparables: [] } });
  const texto = textoDe(zip, 'word/document.xml');
  assert.ok(!texto.includes('{'), 'sin marcadores sueltos');
  assert.ok(!texto.includes('nombre'), 'y sin restos del bucle');
});

test('un bucle huérfano en la plantilla no tumba el render completo', async () => {
  /* Si el marcado dejó `{/coleccion}` sin su `{#coleccion}` -algo que pasaba en
     silencio cuando la celda de apertura no tenía `<w:t>`, ver `escribirEnCelda` en
     `docxPlantilla.js`-, Docxtemplater revienta con "Unopened loop" y ningún informe se
     genera, aunque el resto del documento esté perfecto. */
  const buf = await plantilla([parrafo('Antes. {/razonesRechazo} Después.')]);
  const { zip, avisosTablas } = renderizarDocx(buf, ESTUDIO, { colecciones: { razonesRechazo: [] } });
  const texto = textoDe(zip, 'word/document.xml');
  assert.ok(!texto.includes('{'), 'el tag suelto se retira en vez de reventar el render');
  assert.ok(texto.includes('Antes.') && texto.includes('Después.'), 'el resto del párrafo no se toca');
  assert.ok(avisosTablas.some((a) => a.includes('razonesRechazo')), 'se avisa del bucle desbalanceado');
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
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE }, rows: [
        new TableRow({ children: [new TableCell({ children: [new Paragraph('{#comparables}{nombre}{/comparables}')] })] }),
      ]
    }),
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

/* ══════════════════ ANEXO A: estados financieros del contribuyente ══════════════════ */

/* Las cifras que la ingesta ya parsea, con los nombres que escribe `eeffParser.js`. */
const ESTUDIO_EEFF = {
  ent: 'ACME COLOMBIA S.A.S', anio: 2025,
  t_cash: 12417756, t_inv_assoc: 1031832388, t_ar: 578289605, t_tax: 388909218,
  t_act_curr: 2011448966, t_ppe: 114783610, t_intang: 4620815, t_dif: 48626297,
  t_act_nocurr: 168030721, t_act_tot: 2179479687, t_ap: 27255376,
  t_s: 5271105507, t_c: 2761202249, t_op: 262820000, seg_excluido: 983180000,
};

const conAnexoA = () => '<w:p><w:t>VIII. ANEXOS</w:t></w:p>'
  + '<w:p><w:t>ANEXO A. Estados financieros END GAME INTERACTIVE COLOMBIA</w:t></w:p>'
  + '<w:p><w:t>páginas del informe anterior</w:t></w:p>'
  + '<w:p><w:t>ANEXO B. Descripciones de comparables y Estados Financieros</w:t></w:p>'
  + '<w:p><w:t>fichas de comparables</w:t></w:p>';

async function zipConAnexoA() {
  const buf = await plantilla([parrafo('x')]);
  const zip = new PizZip(buf);
  zip.file(RUTA_DOC_TEST, zip.file(RUTA_DOC_TEST).asText()
    .replace('</w:body>', conAnexoA() + '</w:body>'));
  return zip;
}

test('el ANEXO A se ancla en su encabezado, sin depender del centinela', async () => {
  /* La plantilla del cliente no trae @@ANEXO_EEFF@@ —verificado: cero ocurrencias en el
     informe del 2026-08-10—, así que las páginas ingestadas nunca entraban y el anexo se
     radicaba vacío. El ANEXO B ya se ancla por su encabezado; el A no tenía equivalente. */
  const zip = await zipConAnexoA();
  const { insertadas } = insertarAnexoA(zip, ESTUDIO_EEFF, {
    imagenes: [{ dataUrl: PNG_DATA_URL }, { dataUrl: PNG_DATA_URL }],
  });
  const texto = textoDe(zip, RUTA_DOC_TEST);

  assert.strictEqual(insertadas, 2, 'las páginas del PDF van como soporte');
  assert.ok(!texto.includes('páginas del informe anterior'), 'lo viejo del anexo debe irse');
  assert.match(texto, /ANEXO B\. Descripciones de comparables/, 'y el ANEXO B queda intacto');
  assert.match(texto, /fichas de comparables/);
  assert.ok(zip.file('word/media/anexo_a_1.png'), 'la primera página quedó en el paquete');
});

test('el ANEXO A trae el ESF y el ERI como tablas nativas, no como imagen', async () => {
  const zip = await zipConAnexoA();
  insertarAnexoA(zip, ESTUDIO_EEFF, {});
  const texto = textoDe(zip, RUTA_DOC_TEST);
  assert.match(texto, /Estado de Situación Financiera/);
  assert.match(texto, /Estado de Resultados/);
  assert.match(texto, /2\.179\.479\.687/, 'el total de activos, formateado en pesos');
  assert.match(texto, /5\.271\.105\.507/, 'los ingresos del ERI');
});

test('el A.V. del ANEXO A sale de la misma cuenta que la Tabla 10', async () => {
  /* Si cada uno calculara su porcentaje, el anexo y el cuerpo del informe publicarían
     verticales distintos para el mismo estado financiero. */
  const zip = await zipConAnexoA();
  insertarAnexoA(zip, ESTUDIO_EEFF, {});
  const anexo = textoDe(zip, RUTA_DOC_TEST);

  const tabla10 = actualizarTablasOperacionesOoxml(
    conTabla('<w:p><w:t>Tabla 10. Activos a 31 de diciembre de 2025</w:t></w:p>'),
    ESTUDIO_EEFF,
  );
  /* 12.417.756 sobre 2.179.479.687 es 0,570 %. */
  assert.match(tabla10, /0,570 %/, 'la Tabla 10 calcula el vertical sobre el total de activos');
  assert.match(anexo, /0,570 %/, 'y el anexo tiene que dar lo mismo');
});

test('el ERI del ANEXO A declara el ajuste excluido', async () => {
  /* Los $983.180.000 del proyecto CoCrea son lo que sostiene el margen que el informe
     declara. Un estado de resultados que no los nombre no cuadra con el rango. */
  const zip = await zipConAnexoA();
  insertarAnexoA(zip, ESTUDIO_EEFF, {});
  const texto = textoDe(zip, RUTA_DOC_TEST);
  assert.match(texto, /983\.180\.000/);
});

test('sin cifras parseadas el ANEXO A avisa en vez de salir vacío', async () => {
  const zip = await zipConAnexoA();
  const { insertadas } = insertarAnexoA(zip, { ent: 'ACME', anio: 2025 }, {});
  const texto = textoDe(zip, RUTA_DOC_TEST);
  assert.strictEqual(insertadas, 0);
  assert.match(texto, /Pendiente/, 'el hueco tiene que verse');
  assert.ok(!texto.includes('páginas del informe anterior'),
    'y no conservar el anexo del informe anterior');
});

test('una plantilla sin ANEXO A no se toca', async () => {
  const buf = await plantilla([parrafo('Informe sin anexos')]);
  const zip = new PizZip(buf);
  const antes = zip.file(RUTA_DOC_TEST).asText();
  const { insertadas } = insertarAnexoA(zip, ESTUDIO_EEFF, { imagenes: [{ dataUrl: PNG_DATA_URL }] });
  assert.strictEqual(insertadas, 0);
  assert.strictEqual(zip.file(RUTA_DOC_TEST).asText(), antes, 'el documento debe quedar igual');
});

test('rellenarDocx llena el ANEXO A con lo que trae el estudio', async () => {
  /* La cadena completa: sin centinela en la plantilla, el anexo se llena igual. */
  const buf = await plantilla([parrafo('Informe de {ent}')]);
  const zip = new PizZip(buf);
  zip.file(RUTA_DOC_TEST, zip.file(RUTA_DOC_TEST).asText()
    .replace('</w:body>', conAnexoA() + '</w:body>'));

  const { salida } = rellenarDocx({
    binario: zip.generate({ type: 'nodebuffer' }),
    estudio: ESTUDIO_EEFF,
    imagenesAnexo: [{ dataUrl: PNG_DATA_URL }],
    tipoSalida: 'nodebuffer',
  });
  const texto = textoDe(new PizZip(salida), RUTA_DOC_TEST);
  assert.match(texto, /Estado de Situación Financiera/);
  assert.ok(!texto.includes('páginas del informe anterior'));
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

test('actualización de tablas operativas en el OOXML de docxRelleno (Fase 3)', () => {
  const estudio = {
    ent: 'END GAME COLOMBIA S.A.S',
    nit: '901.337.576-6',
    anio: '2024',
    vinc: 'END GAME INTERACTIVE INC',
    vinc_id: '604477955',
    pais_vinc: 'ESTADOS UNIDOS',
    vinc_tipo: 'Otros servicios (07)',
    monto_operacion: 3435357400,
    pli: 'MO',
    metodo: 'TU',
    egreso: false,
    t_s: 100000000,
    t_c: 60000000,
    t_op: 10000000,
    t_act_tot: 100000000,
    t_cash: 5000000,
    accionistas: [
      { nombre: 'Accionista Principal', pais: 'ESTADOS UNIDOS', acciones: 200000, valor_capital: 200000000, participacion_pct: 100 }
    ],
    embudoSeleccion: {
      evaluadas: 442,
      seleccionadas: 2,
      porMotivo: {
        rigorFuncional: 327,
        holding: 36,
        sinDescripcion: 66
      }
    },
    comparables: [
      { name: 'AKATSUKI INC.', amb: 'Int', s: 1000, c: 600, op: 100 },
      { name: 'COLOPL, INC.', amb: 'Int', s: 1000, c: 700, op: 200 }
    ]
  };

  const xmlOriginal = `
    <w:p><w:t>Tabla 1. Operaciones de Ingreso</w:t></w:p><w:tbl><w:tr><w:tc><w:p><w:t>Old Table 1</w:t></w:p></w:tc></w:tr></w:tbl>
    <w:p><w:t>Tabla 2. Operación analizar</w:t></w:p><w:tbl><w:tr><w:tc><w:p><w:t>Old Table 2</w:t></w:p></w:tc></w:tr></w:tbl>
    <w:p><w:t>Tabla 3. Transacciones Inter compañía</w:t></w:p><w:tbl><w:tr><w:tc><w:p><w:t>Old Table 3</w:t></w:p></w:tc></w:tr></w:tbl>
    <w:p><w:t>Tabla 6. Composición accionaria</w:t></w:p><w:tbl><w:tr><w:tc><w:p><w:t>Old Table 6</w:t></w:p></w:tc></w:tr></w:tbl>
    <w:p><w:t>Tabla 10. Activos a 31 de diciembre</w:t></w:p><w:tbl><w:tr><w:tc><w:p><w:t>Old Table 10</w:t></w:p></w:tc></w:tr></w:tbl>
  `;

  const xmlActualizado = actualizarTablasOperacionesOoxml(xmlOriginal, estudio);

  assert.ok(xmlActualizado.includes('Tabla 1. Operaciones de Ingreso'), 'No se reemplazó la Tabla 1');
  assert.ok(xmlActualizado.includes('Otros servicios (07)'), 'Falta el concepto en la Tabla 1');
  assert.ok(xmlActualizado.includes('3.435.357.400'), 'Falta el monto formateado en la Tabla 1');

  assert.ok(xmlActualizado.includes('Tabla 2. Operación analizar'), 'No se reemplazó la Tabla 2');
  assert.ok(xmlActualizado.includes('Ingreso (07)'), 'Falta el tipo de operación en la Tabla 2');
  assert.ok(xmlActualizado.includes('Otros servicios'), 'Falta la descripción en la Tabla 2');

  /* «Tabla 3. Transacciones», con espacio tras el punto: el título de todas las tablas
     lo compone ahora un solo helper a partir del número que traía la plantilla, así que
     dejan de convivir dos formatos. */
  assert.ok(xmlActualizado.includes('Tabla 3. Transacciones Inter compañía'), 'No se reemplazó la Tabla 3');
  assert.ok(xmlActualizado.includes('604477955'), 'Falta la identificación fiscal en la Tabla 3');

  assert.ok(xmlActualizado.includes('Tabla 6. Composición accionaria'), 'No se reemplazó la Tabla 6');
  assert.ok(xmlActualizado.includes('Accionista Principal'), 'Falta el nombre de accionista en la Tabla 6');
  assert.ok(xmlActualizado.includes('200.000'), 'Falta el número de acciones formateado en la Tabla 6');

  assert.ok(xmlActualizado.includes('Tabla 10. Activos a 31 de diciembre de 2024'), 'No se reemplazó la Tabla 10');
  assert.ok(xmlActualizado.includes('5.000.000'), 'Falta el valor del efectivo formateado en la Tabla 10');
  assert.ok(xmlActualizado.includes('5,000 %'), 'Falta el análisis vertical de efectivo en la Tabla 10');
});



/* ─────────────────────────────────────────────────────────────────────────────
   Códigos SIC utilizados (Criterios de búsqueda), ruta .docx.

   Mismo defecto y mismo arreglo ya probado en `tablasHtmlInforme.test.js` para la ruta
   HTML: la tabla se radicaba con el cribado del informe del que salió la plantilla. Estos
   tests son el espejo OOXML de esos, con la forma real de la tabla (fila de 2 celdas por
   criterio, fila de 1 celda fusionada para el conector «Y»/«O»).
   ───────────────────────────────────────────────────────────────────────────── */

const filaDosCeldasOoxml = (a, b) =>
  '<w:tr><w:tc><w:tcPr><w:tcW w:w="3000" w:type="dxa"/></w:tcPr><w:p><w:t>' + a + '</w:t></w:p></w:tc>'
  + '<w:tc><w:tcPr><w:tcW w:w="6000" w:type="dxa"/></w:tcPr><w:p><w:t>' + b + '</w:t></w:p></w:tc></w:tr>';

const filaUnaCeldaOoxml = (c) =>
  '<w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:t>' + c + '</w:t></w:p></w:tc></w:tr>';

const tablaSicOoxml = (numero, cuerpo, fuente) =>
  '<w:p><w:t>' + (numero != null ? 'Tabla ' + numero + '. ' : '') + 'Códigos SIC utilizados</w:t></w:p><w:tbl>'
  + filaDosCeldasOoxml('Criterio de búsqueda', '')
  + cuerpo
  + (fuente ? filaUnaCeldaOoxml(fuente) : '')
  + '</w:tbl>';

const CUERPO_SIC_VIEJO = filaDosCeldasOoxml('Código SIC primario:', 'Entre 1111 y 2222')
  + filaUnaCeldaOoxml('Y')
  + filaDosCeldasOoxml('Palabra clave:', 'Contiene viejo');

const ESTUDIO_SIC = {
  anio: 2025, ent: 'ACME', pli: 'MO',
  criteriosScreening: [
    { conector: null, etiqueta: 'Código SIC primario:', valor: 'Entre 7371 y 7375' },
    { conector: 'O', etiqueta: 'Palabra clave:', valor: 'Contiene juegos' },
  ],
};

test('Códigos SIC: tabla única (Tabla 14) se reescribe con los criterios del estudio', () => {
  const xml = tablaSicOoxml(
    14, CUERPO_SIC_VIEJO,
    'Fuente: Búsqueda de Capital IQ, publicado en agosto de 2025 por Standard &amp; Poor&apos;s.'
  );
  const avisos = [];
  const salida = actualizarTablasOperacionesOoxml(xml, ESTUDIO_SIC, avisos);

  assert.ok(salida.includes('Entre 7371 y 7375'), 'faltan los criterios nuevos');
  assert.ok(salida.includes('Contiene juegos'), 'falta la palabra clave nueva');
  assert.ok(!salida.includes('Entre 1111 y 2222'), 'sobrevivió el criterio anterior');
  assert.ok(!salida.includes('Contiene viejo'), 'sobrevivió la palabra clave anterior');
  assert.ok(salida.includes('Fuente: Búsqueda de Capital IQ, publicado en agosto de 2025'),
    'el pie de fuente no debe regenerarse');
  assert.match(salida, /<w:gridSpan w:val="2"\/>/, 'la fila del conector conserva su fusión');
  assert.ok(!avisos.includes('Códigos SIC utilizados'), 'la tabla sí estaba y sí se pudo reescribir');
});

test('Códigos SIC: tres ocurrencias numeradas 13/14/15 eliminan 13 y 15, conservan la 14', () => {
  const xml = tablaSicOoxml(13, CUERPO_SIC_VIEJO, 'Fuente: Ryan LLC.')
    + '<w:p><w:t>Medio.</w:t></w:p>'
    + tablaSicOoxml(14, CUERPO_SIC_VIEJO, 'Fuente: Búsqueda de Capital IQ, publicado en agosto de 2025.')
    + '<w:p><w:t>Medio.</w:t></w:p>'
    + tablaSicOoxml(15, CUERPO_SIC_VIEJO, 'Fuente: Refinitiv.');
  const avisos = [];
  const salida = actualizarTablasOperacionesOoxml(xml, ESTUDIO_SIC, avisos);

  assert.ok(!salida.includes('Tabla 13. Códigos SIC utilizados'), 'se eliminó la tabla 13');
  assert.ok(!salida.includes('Tabla 15. Códigos SIC utilizados'), 'se eliminó la tabla 15');
  assert.ok(salida.includes('Tabla 14. Códigos SIC utilizados'), 'se conservó la tabla 14');
  assert.strictEqual((salida.match(/Entre 7371 y 7375/g) || []).length, 1,
    'solo la tabla 14 trae los criterios nuevos');
  assert.ok(salida.includes('<w:t>Medio.</w:t>'), 'el texto intercalado entre las tres tablas sobrevive');
  assert.ok(!avisos.includes('Códigos SIC utilizados'), 'las tres tablas estaban, no hay nada que avisar');
});

test('Códigos SIC: tres ocurrencias SIN numerar eliminan la primera y la tercera por posición', () => {
  const xml = tablaSicOoxml(null, CUERPO_SIC_VIEJO, 'Fuente: Ryan LLC.')
    + tablaSicOoxml(null, CUERPO_SIC_VIEJO, 'Fuente: Capital IQ.')
    + tablaSicOoxml(null, CUERPO_SIC_VIEJO, 'Fuente: Refinitiv.');
  const avisos = [];
  const salida = actualizarTablasOperacionesOoxml(xml, ESTUDIO_SIC, avisos);

  assert.strictEqual((salida.match(/Códigos SIC utilizados/g) || []).length, 1,
    'solo debe sobrevivir una copia de la tabla');
  assert.ok(salida.includes('Fuente: Capital IQ.'), 'sobrevivió la del medio');
  assert.ok(!salida.includes('Fuente: Ryan LLC.'), 'se eliminó la primera');
  assert.ok(!salida.includes('Fuente: Refinitiv.'), 'se eliminó la tercera');
  assert.ok(salida.includes('Entre 7371 y 7375'), 'la que sobrevive trae los criterios nuevos');
});

test('Códigos SIC: sin criteriosScreening no se toca nada y se avisa', () => {
  const xml = tablaSicOoxml(14, CUERPO_SIC_VIEJO, 'Fuente: Capital IQ.');
  const avisos = [];
  const salida = actualizarTablasOperacionesOoxml(xml, { anio: 2025, ent: 'ACME', pli: 'MO' }, avisos);

  assert.ok(salida.includes('Entre 1111 y 2222'), 'la tabla debe quedar exactamente igual');
  assert.ok(avisos.includes('Códigos SIC utilizados'), 'y hay que avisarlo');
});

test('Códigos SIC: dos ocurrencias sin numerar (ni 13/14/15) no se tocan y se avisa', () => {
  /* El caso real reportado: la plantilla trae la tabla dos veces, ninguna numerada 13/14/15.
     Sin forma de saber cuál es la copia vigente, se prefiere no arriesgar borrar o mezclar la
     equivocada antes que adivinar — mismo criterio que el resto del módulo ante ambigüedad. */
  const xml = tablaSicOoxml(18, CUERPO_SIC_VIEJO, 'Fuente: Búsqueda de Capital IQ, publicado en agosto de 2025.')
    + tablaSicOoxml(19, CUERPO_SIC_VIEJO, 'Fuente: Búsqueda de fundamentos de Refinitiv, publicado en octubre de 2024.');
  const avisos = [];
  const salida = actualizarTablasOperacionesOoxml(xml, ESTUDIO_SIC, avisos);

  assert.strictEqual(salida, xml, 'ninguna de las dos copias debe alterarse');
  assert.ok(avisos.includes('Códigos SIC utilizados'), 'y hay que avisarlo');
});

test('reescribirFilasOoxml preserva el tcPr del molde (sombreado, gridSpan) en las filas nuevas', () => {
  const cuerpoConSombreado = '<w:tr><w:tc><w:tcPr><w:shd w:val="clear" w:fill="FFF2CC"/></w:tcPr>'
    + '<w:p><w:t>Código SIC primario:</w:t></w:p></w:tc>'
    + '<w:tc><w:tcPr><w:tcW w:w="6000" w:type="dxa"/></w:tcPr><w:p><w:t>Entre 1111 y 2222</w:t></w:p></w:tc></w:tr>'
    + filaUnaCeldaOoxml('Y');
  const tabla = tablaSicOoxml(null, cuerpoConSombreado, 'Fuente: Capital IQ.');

  const salida = reescribirFilasOoxml(tabla, [
    ['Código SIC primario:', 'Entre 7371 y 7375'],
    ['O'],
  ]);

  assert.match(salida, /<w:shd w:val="clear" w:fill="FFF2CC"\/>/, 'se perdió el sombreado del molde');
  assert.match(salida, /<w:gridSpan w:val="2"\/>/, 'se perdió el gridSpan del molde del conector');
  assert.ok(salida.includes('Entre 7371 y 7375'), 'faltan los valores nuevos');
  assert.ok(salida.includes('Fuente: Capital IQ.'), 'el pie de fuente no debe tocarse');
});

test('localizarBloquesTabla devuelve todas las ocurrencias homónimas en orden de documento', () => {
  const xml = tablaSicOoxml(13, CUERPO_SIC_VIEJO, 'a')
    + tablaSicOoxml(14, CUERPO_SIC_VIEJO, 'b')
    + tablaSicOoxml(15, CUERPO_SIC_VIEJO, 'c');
  const bloques = localizarBloquesTabla(xml, 'Códigos SIC utilizados');

  assert.strictEqual(bloques.length, 3);
  assert.deepStrictEqual(bloques.map((b) => b.numero), [13, 14, 15]);
  assert.ok(bloques[0].inicio < bloques[1].inicio && bloques[1].inicio < bloques[2].inicio,
    'deben venir en orden de documento');
});



/* ─────────────────────────────────────────────────────────────────────────────
   Localización de tablas por nombre.

   La numeración de la plantilla no es fiable —cambia de un informe a otro— y el
   texto de un título viene partido en varios runs. Estos tests fijan las dos cosas
   que hacen que la tabla se encuentre igual.
   ───────────────────────────────────────────────────────────────────────────── */

const conTabla = (parrafoXml) =>
  `${parrafoXml}<w:tbl><w:tr><w:tc><w:p><w:t>vieja</w:t></w:p></w:tc></w:tr></w:tbl>`;

test('textoPlanoOoxml une los runs en que Word parte una frase', () => {
  /* Word corta por rsid, por el corrector o por un cambio de formato; el título
     completo no aparece contiguo en el XML aunque se lea entero en pantalla. */
  const xml = '<w:p><w:r><w:t>Tabla 1</w:t></w:r><w:r><w:t>7. Muestra Com</w:t></w:r>'
    + '<w:r><w:t xml:space="preserve">pañías comparables</w:t></w:r></w:p>';
  assert.strictEqual(textoPlanoOoxml(xml), 'Tabla 17. Muestra Compañías comparables');
});

test('textoPlanoOoxml deshace las entidades y el espacio duro', () => {
  const xml = '<w:p><w:t>Ingresos&#160;y&amp;gastos</w:t></w:p>';
  assert.strictEqual(textoPlanoOoxml(xml), 'Ingresos y&gastos');
});

test('claveTitulo ignora el número, las tildes y las mayúsculas', () => {
  const esperada = 'muestra companias comparables';
  ['Tabla 17. Muestra Compañías comparables',
    'TABLA 3. MUESTRA COMPAÑIAS COMPARABLES',
    'Tabla N° 21 – Muestra compañías comparables',
    'Muestra Compañías Comparables',
  ].forEach((t) => assert.strictEqual(claveTitulo(t), esperada, t));
});

test('claveTitulo solo descarta el prefijo cuando trae número', () => {
  /* «Tabla de rangos» es el NOMBRE de una tabla del informe, no un prefijo numerado.
     Quitarle la palabra «Tabla» dejaba la clave en «de rangos», que no es comparable con
     nada de forma exacta y solo funcionaba por inclusión. */
  assert.strictEqual(claveTitulo('Tabla de rangos'), 'tabla de rangos');
  assert.strictEqual(claveTitulo('Tabla 20. Tabla de rangos'), 'tabla de rangos');
});

test('numeroDeTabla lee el número cuando está y devuelve null cuando no', () => {
  assert.strictEqual(numeroDeTabla('Tabla 17. Muestra'), 17);
  assert.strictEqual(numeroDeTabla('Tabla N° 4 – Método'), 4);
  assert.strictEqual(numeroDeTabla('Muestra Compañías comparables'), null);
});

test('la tabla se encuentra aunque la plantilla la renumere', () => {
  /* El mismo nombre con tres numeraciones distintas: es el caso que rompía el
     patrón anterior, que exigía «Tabla 17» literal. */
  ['Tabla 17.', 'Tabla 21.', 'Tabla 9.', ''].forEach((prefijo) => {
    const xml = conTabla(`<w:p><w:t>${prefijo} Muestra Compañías comparables</w:t></w:p>`);
    const b = localizarBloqueTabla(xml, 'Muestra Compañías comparables', { numeros: [17] });
    assert.ok(b, `no la encontró con «${prefijo || 'sin número'}»`);
    assert.strictEqual(b.inicio, 0);
    assert.ok(xml.slice(b.fin) === '', 'el bloque debe llegar hasta el cierre de la tabla');
  });
});

test('la tabla se encuentra aunque el título venga partido en runs', () => {
  const xml = conTabla('<w:p><w:r><w:t>Tabla 1</w:t></w:r><w:r><w:t>0. Activos a 31 de dic</w:t></w:r>'
    + '<w:r><w:t>iembre</w:t></w:r></w:p>');
  const b = localizarBloqueTabla(xml, 'Activos a 31 de diciembre');
  assert.ok(b, 'el título partido debe localizarse igual');
  assert.strictEqual(b.numero, 10, 'y conserva el número que traía la plantilla');
});

test('el número desempata dos tablas con el mismo nombre', () => {
  const xml = conTabla('<w:p><w:t>Tabla 5. Rango Intercuartil</w:t></w:p>')
    + conTabla('<w:p><w:t>Tabla 18. Rango Intercuartil</w:t></w:p>');
  assert.strictEqual(localizarBloqueTabla(xml, 'Rango Intercuartil', { numeros: [18] }).numero, 18);
  assert.strictEqual(localizarBloqueTabla(xml, 'Rango Intercuartil', { numeros: [5] }).numero, 5);
  /* Y si la plantilla renumeró, el nombre sigue mandando en vez de no encontrar nada. */
  assert.strictEqual(localizarBloqueTabla(xml, 'Rango Intercuartil', { numeros: [99] }).numero, 5);
  assert.strictEqual(localizarBloqueTabla(xml, 'Rango Intercuartil', { ocurrencia: 1 }).numero, 18);
});

test('el bloque cierra en la tabla que corresponde, no en una anidada', () => {
  /* Word admite tablas dentro de una celda. Parar en el primer </w:tbl> partía el
     bloque por la mitad y dejaba medio esqueleto suelto en el documento. */
  const xml = '<w:p><w:t>Tabla 6. Composición accionaria</w:t></w:p>'
    + '<w:tbl><w:tr><w:tc><w:tbl><w:tr><w:tc><w:p><w:t>interna</w:t></w:p></w:tc></w:tr></w:tbl>'
    + '</w:tc></w:tr></w:tbl><w:p><w:t>siguiente</w:t></w:p>';
  const b = localizarBloqueTabla(xml, 'Composición accionaria');
  assert.ok(b);
  assert.ok(xml.slice(b.inicio, b.fin).endsWith('</w:tbl></w:tc></w:tr></w:tbl>'),
    'debe abarcar la tabla externa completa');
  assert.ok(xml.slice(b.fin).startsWith('<w:p>'), 'y no llevarse el párrafo siguiente');
});

test('la tabla se encuentra cuando su título es la primera fila, y no un párrafo aparte', () => {
  /* Es como la plantilla de End Game trae la «Tabla 20. Tabla de rangos» del final: el
     título no precede a la tabla, vive dentro de su primera fila. Con el localizador que
     exigía «párrafo de título + <w:tbl>» esa tabla era inalcanzable y se radicaba con los
     percentiles del informe anterior. Verificado contra su word/document.xml. */
  const xml = '<w:p><w:t>texto previo</w:t></w:p>'
    + '<w:tbl><w:tr><w:tc><w:p><w:t>Tabla 20. Tabla de rangos</w:t></w:p></w:tc></w:tr>'
    + '<w:tr><w:tc><w:p><w:t>Percentil 25</w:t></w:p></w:tc></w:tr></w:tbl>'
    + '<w:p><w:t>siguiente</w:t></w:p>';
  const b = localizarBloqueTabla(xml, 'Tabla de rangos');
  assert.ok(b, 'debe encontrarla con el título embebido en la primera fila');
  assert.strictEqual(b.numero, 20, 'y conservar el número que traía la plantilla');
  assert.ok(xml.slice(b.inicio).startsWith('<w:tbl>'), 'el bloque empieza en la tabla');
  assert.ok(xml.slice(b.fin).startsWith('<w:p><w:t>siguiente'),
    'y termina al cerrar la tabla, sin llevarse lo que sigue');
});

test('el rótulo embebido exige el nombre exacto y no una celda que lo contenga', () => {
  /* La plantilla trae una tabla de definiciones cuya primera fila es «MO | Margen
     operacional de utilidad o rentabilidad operacional». Si al rótulo embebido le bastara
     con contener el nombre, esa tabla se haría pasar por la «Tabla 19. Margen Operacional
     Compañías Comparables» y la sustitución borraría las definiciones del método. */
  const xml = '<w:tbl><w:tr><w:tc><w:p><w:t>MO</w:t></w:p></w:tc>'
    + '<w:tc><w:p><w:t>Margen operacional de utilidad o rentabilidad operacional</w:t></w:p>'
    + '</w:tc></w:tr></w:tbl>';
  assert.strictEqual(localizarBloqueTabla(xml, 'Margen Operacional'), null);
});

/* Prosa real de la plantilla de End Game: el párrafo va seguido de la tabla de definiciones
   del método TU, 79 000 caracteres antes del rótulo verdadero de la tabla de márgenes. */
const PROSA_METODO = '<w:p><w:t>Para el análisis del método TU se consideró que el indicador '
  + 'financiero de rentabilidad más apropiado es el Margen Operacional (MO).</w:t></w:p>';

test('la tabla de márgenes se localiza por su nombre, sea cual sea el prefijo del rótulo', () => {
  /* El nombre de la tabla es lo único estable: el prefijo se renumera al reordenar el informe y
     hay plantillas que lo rotulan sin número. La clave corta «Margen Operacional», en cambio,
     casa por inclusión con la prosa del método —que también va seguida de una tabla— y esa
     prosa está antes en el documento, así que gana por posición en cuanto el número no
     desempata. Verificado contra el word/document.xml de End Game. */
  const completo = 'Margen Operacional Compañías Comparables';
  const conRotulo = (rotulo) => conTabla(PROSA_METODO)
    + `<w:p><w:t>${rotulo}</w:t></w:p>`
    + '<w:tbl><w:tr><w:tc><w:p><w:t>márgenes viejos</w:t></w:p></w:tc></w:tr></w:tbl>';

  for (const rotulo of [
    'Tabla 19. Margen Operacional Compañías Comparables',
    'Tabla 21. Margen Operacional Compañías Comparables',
    'Margen Operacional Compañías Comparables',
    'TABLA N° 7: MARGEN OPERACIONAL COMPAÑÍAS COMPARABLES',
  ]) {
    const xml = conRotulo(rotulo);
    const b = localizarBloqueTabla(xml, completo);
    assert.ok(b, `debe encontrarla con el rótulo «${rotulo}»`);
    assert.strictEqual(xml.slice(b.inicio, b.fin).includes('márgenes viejos'), true,
      `el bloque de «${rotulo}» debe abarcar la tabla de márgenes y no otra`);
    /* Y el nombre corto se lleva la prosa en su lugar, que es el fallo que esto cierra. */
    assert.ok(localizarBloqueTabla(xml, 'Margen Operacional', { numeros: [19] })
      .titulo.startsWith('Para el análisis') || /Tabla 19\./.test(rotulo),
      `con «${rotulo}» el nombre corto se queda con la prosa`);
  }
});

test('un título dentro de una fila que no es la primera no se toma por título de la tabla', () => {
  /* Si valiera cualquier fila, una celda que mencione el nombre —el cuerpo de la matriz de
     rechazo lo hace— secuestraría la sustitución de la tabla entera. */
  const xml = '<w:tbl><w:tr><w:tc><w:p><w:t>cabecera</w:t></w:p></w:tc></w:tr>'
    + '<w:tr><w:tc><w:p><w:t>Tabla de rangos</w:t></w:p></w:tc></w:tr></w:tbl>';
  assert.strictEqual(localizarBloqueTabla(xml, 'Tabla de rangos'), null);
});

test('un título sin tabla detrás no se toma por tabla', () => {
  const xml = '<w:p><w:t>Tabla 6. Composición accionaria</w:t></w:p><w:p><w:t>texto suelto</w:t></w:p>';
  assert.strictEqual(localizarBloqueTabla(xml, 'Composición accionaria'), null);
});

test('los párrafos vacíos entre el título y la tabla no rompen la búsqueda', () => {
  const xml = '<w:p><w:t>Tabla 9. Criterios de vinculación</w:t></w:p><w:p/><w:p><w:t></w:t></w:p>'
    + '<w:tbl><w:tr><w:tc><w:p><w:t>vieja</w:t></w:p></w:tc></w:tr></w:tbl>';
  assert.ok(localizarBloqueTabla(xml, 'Criterios de vinculación'));
});

test('las tablas que la plantilla no trae se reportan en vez de fallar en silencio', () => {
  /* Sin este aviso, una tabla que no se encuentra deja en el informe los datos del
     cliente anterior y nadie se entera hasta que el documento ya está radicado. */
  const avisos = [];
  actualizarTablasOperacionesOoxml(
    conTabla('<w:p><w:t>Tabla 2. Operación analizar</w:t></w:p>'),
    { anio: 2025, ent: 'ACME', vinc_tipo: 'Otros servicios (07)' },
    avisos,
  );
  assert.ok(avisos.length > 0, 'debería avisar de las que faltan');
  assert.ok(!avisos.includes('Operación analizar'), 'y no de la que sí estaba');
  assert.ok(avisos.includes('Muestra Compañías comparables'));
});

test('renderizarDocx publica qué tablas no trae la plantilla', async () => {
  /* `sustituidorDeTablas` sabe anotar las que faltan, pero `renderizarDocx` llamaba a los
     dos actualizadores sin pasarles el arreglo: el aviso se calculaba y se tiraba. Una tabla
     no sustituida se radica con los datos del cliente anterior, que es justo el fallo que
     ese mecanismo existe para evitar. */
  const binario = await plantilla([parrafo('Informe de {ent}')]);
  const { avisosTablas } = renderizarDocx(binario, ESTUDIO);
  assert.ok(Array.isArray(avisosTablas), 'debe devolver la lista de tablas no encontradas');
  assert.ok(avisosTablas.includes('Muestra Compañías comparables'),
    'una plantilla sin tablas debe reportarlas todas');
  assert.ok(avisosTablas.includes('PIB Mundial'), 'también las de macroeconomía');
});

test('rellenarDocx propaga los avisos de tablas hasta quien genera el informe', async () => {
  const binario = await plantilla([parrafo('Informe de {ent}')]);
  const { avisosTablas } = rellenarDocx({ binario, estudio: ESTUDIO, tipoSalida: 'nodebuffer' });
  assert.ok(avisosTablas && avisosTablas.length > 0, 'el aviso tiene que llegar a la UI');
});

test('las DOS tablas de rango vertical se actualizan, no una u otra', () => {
  /* La plantilla trae el rango vertical dos veces: la «Tabla 18. Rango Intercuartil» de
     los resultados y la «Tabla 20. Tabla de rangos» de las conclusiones, esta última con
     el rótulo dentro de su primera fila. El código elegía una de las dos con un if/else,
     así que la otra se radicaba con los percentiles del informe anterior. */
  const xml = '<w:p><w:t>Tabla 5. Rango Intercuartil</w:t></w:p>'
    + '<w:tbl><w:tr><w:tc><w:p><w:t>horizontal vieja</w:t></w:p></w:tc></w:tr></w:tbl>'
    + '<w:p><w:t>Tabla 18. Rango Intercuartil</w:t></w:p>'
    + '<w:tbl><w:tr><w:tc><w:p><w:t>vertical vieja</w:t></w:p></w:tc></w:tr></w:tbl>'
    + '<w:tbl><w:tr><w:tc><w:p><w:t>Tabla 20. Tabla de rangos</w:t></w:p></w:tc></w:tr>'
    + '<w:tr><w:tc><w:p><w:t>conclusiones vieja</w:t></w:p></w:tc></w:tr></w:tbl>';
  const salida = actualizarTablasOperacionesOoxml(xml, { anio: 2025, ent: 'ACME', pli: 'MO' });
  assert.ok(!salida.includes('vertical vieja'), 'la Tabla 18 debe actualizarse');
  assert.ok(!salida.includes('conclusiones vieja'), 'la Tabla 20 también');
  assert.strictEqual((salida.match(/RANGE MO NO AJUSTADO/g) || []).length, 2,
    'deben quedar las dos tablas verticales regeneradas');
});

test('la tabla de márgenes se actualiza con cualquier prefijo, sin tocar las definiciones', () => {
  /* El caso que se reportó el 2026-08-11: la tabla del informe salía con los márgenes del
     cliente anterior. Con la clave corta, la prosa del método ganaba por posición y se llevaba
     la sustitución, dejando además destruida la tabla de definiciones: dos tablas mal. */
  for (const rotulo of [
    'Tabla 21. Margen Operacional Compañías Comparables',
    'Margen Operacional Compañías Comparables',
  ]) {
    const xml = conTabla(PROSA_METODO)
      + `<w:p><w:t>${rotulo}</w:t></w:p>`
      + '<w:tbl><w:tr><w:tc><w:p><w:t>márgenes viejos</w:t></w:p></w:tc></w:tr></w:tbl>';
    const avisos = [];
    const salida = actualizarTablasOperacionesOoxml(xml, {
      anio: 2025, ent: 'ACME', pli: 'MO',
      comparables: [{ name: 'Alfa SA', s: 1000, c: 700, op: 200 }],
    }, avisos);

    assert.ok(!salida.includes('márgenes viejos'), `con «${rotulo}» debe actualizarse`);
    assert.ok(salida.includes('vieja'), 'y la tabla de definiciones del método quedar intacta');
    assert.match(salida, /MO NO AJUSTADO/, 'la tabla regenerada es la de márgenes');
    /* En mayúscula desde el 2026-08-19: esta tabla es una de las que el usuario pidió subir.
       El estudio la trae como «Alfa SA», así que esto comprueba de paso que el que sube es el
       generador y no el dato de entrada. */
    assert.ok(salida.includes('ALFA SA'), 'con los comparables del estudio');
    assert.ok(!avisos.includes('Margen Operacional Compañías Comparables'),
      'no debe reportarse como ausente una tabla que sí estaba');
  }
});

test('sin el rótulo de la tabla de márgenes se avisa, en vez de sustituir la prosa del método', () => {
  /* Antes el nombre corto encontraba la prosa y sustituía ahí: se perdían las definiciones del
     método y los márgenes seguían siendo los del informe anterior, en silencio. Avisar deja el
     documento intacto y el panel lo dice antes de radicar. */
  const xml = conTabla(PROSA_METODO);
  const avisos = [];
  const salida = actualizarTablasOperacionesOoxml(xml, { anio: 2025, ent: 'ACME', pli: 'MO' }, avisos);

  assert.ok(salida.includes('vieja'), 'la tabla que sigue a la prosa no se toca');
  assert.ok(!/MO NO AJUSTADO/.test(salida), 'y no se emite la tabla de márgenes donde no va');
  assert.ok(avisos.includes('Margen Operacional Compañías Comparables'),
    'la ausencia tiene que llegar al aviso');
});

test('una tabla macro se encuentra con el título partido en runs', () => {
  /* Estas ocho no llevan número, así que la numeración nunca fue su problema; lo que
     sí las alcanzaba es que el título tuviera que estar contiguo en el XML. */
  const xml = '<w:p><w:r><w:t>Crecimiento del PIB Mun</w:t></w:r><w:r><w:t>dial</w:t></w:r></w:p>'
    + '<w:tbl><w:tr><w:tc><w:p><w:t>vieja</w:t></w:p></w:tc></w:tr></w:tbl>';
  const salida = actualizarTablasMacroOoxml(xml, null, 2025);
  assert.ok(!salida.includes('vieja'), 'la tabla partida en runs debe sustituirse igual');
  assert.match(salida, /Crecimiento Mundial/);
});

test('una tabla macro se encuentra sin tildes y en mayúsculas', () => {
  const xml = '<w:p><w:t>TASAS DE INFLACION GLOBAL</w:t></w:p>'
    + '<w:tbl><w:tr><w:tc><w:p><w:t>vieja</w:t></w:p></w:tc></w:tr></w:tbl>';
  const salida = actualizarTablasMacroOoxml(xml, null, 2025);
  assert.ok(!salida.includes('vieja'));
});

test('las tablas macro ausentes también se reportan', () => {
  const avisos = [];
  actualizarTablasMacroOoxml(
    '<w:p><w:t>Crecimiento del PIB Mundial</w:t></w:p><w:tbl><w:tr><w:tc><w:p><w:t>v</w:t></w:p></w:tc></w:tr></w:tbl>',
    null, 2025, avisos,
  );
  assert.strictEqual(avisos.length, 7, 'siete de las ocho no están en esta plantilla');
  assert.ok(!avisos.includes('PIB Mundial'));
  assert.ok(avisos.includes('Desempleo en Colombia'));
});

test('la Tabla 4 declara el código de operación y no lo inventa cuando no se puede resolver', async () => {
  /* La Tabla 4 («Método de Precios de Transferencia Aplicable») publica el código de
     operación en su propia columna. Compartía el helper que devolvía '07' fijo, así que un
     tipo en texto libre —«VENTA SERVICIOS», lo que trae el Excel de 2025— salía declarado
     ante la DIAN como el 07 de END GAME 2024. */
  const xml = '<w:p><w:t>Tabla 4. Método de Precios de Transferencia Aplicable</w:t></w:p>' +
    '<w:tbl><w:tr><w:tc><w:p><w:t>Old Table 4</w:t></w:p></w:tc></w:tr></w:tbl>';

  const conCodigo = actualizarTablasOperacionesOoxml(xml, {
    anio: 2025, vinc_tipo: 'Otros servicios (07)', metodo: 'TU', pli: 'MO',
  });
  assert.ok(conCodigo.includes('07'), 'el código escrito en el tipo tiene que publicarse');
  assert.ok(conCodigo.includes('Otros servicios'), 'y la descripción sin el código');

  const sinCodigo = actualizarTablasOperacionesOoxml(xml, {
    anio: 2025, vinc_tipo: 'VENTA SERVICIOS', metodo: 'TU', pli: 'MO',
  });
  assert.ok(!sinCodigo.includes('Old Table 4'), 'la Tabla 4 tiene que haberse reemplazado');
  assert.ok(sinCodigo.includes('VENTA SERVICIOS'), 'la descripción es la del estudio');
  assert.ok(!sinCodigo.includes('>07<'), 'no debe inventar el código 07');
});

/* ══════════════════ prosa que describe una tabla ══════════════════ */

/* La plantilla parte la frase en varios runs y deja cada cifra en el suyo, que es lo que
   permite cambiarlas sin tocar el texto. Así viene el informe del cliente. */
const parrafoConCifras = (cifras) => new Paragraph({
  children: [
    new TextRun({ text: 'Como se observa en el cuadro anterior, el rango Intercuartil obtenido por las compañías comparables se ubica entre el percentil 25 (' }),
    new TextRun({ text: cifras[0] }),
    new TextRun({ text: ') y (' }),
    new TextRun({ text: cifras[1] }),
    new TextRun({ text: ') percentil 75, la mediana con (' }),
    new TextRun({ text: cifras[2] }),
    new TextRun({ text: ').' }),
  ],
});

const tablaRango = () => new Table({
  rows: [
    new TableRow({
      children: ['RANGO', 'Percentil 25', 'Mediana', 'Percentil 75'].map(
        (t) => new TableCell({ children: [new Paragraph(t)] }))
    }),
    new TableRow({
      children: ['5.58%', '1.78%', '2.34%', '8.80%'].map(
        (t) => new TableCell({ children: [new Paragraph(t)] }))
    }),
  ],
});

test('la descripción de una tabla se actualiza con las cifras del estudio', async () => {
  /* La tabla se rehacía con el estudio y la frase de debajo se quedaba con las cifras del
     informe del año anterior, contradiciéndola en el mismo documento. */
  const buf = await plantilla([
    new Paragraph('Tabla 5. Rango Intercuartil'),
    tablaRango(),
    parrafoConCifras(['-3.001%', '6.418%', '-1.075%']),
  ]);
  const xml = new PizZip(buf).file(RUTA_DOC_TEST).asText();

  const salida = actualizarProsaTrasTabla(xml, 'Rango Intercuartil', ['1,780%', '8,800%', '2,340%']);
  const texto = textoPlanoOoxml(salida);

  assert.ok(texto.includes('percentil 25 (1,780%)'), 'el P25 nuevo');
  assert.ok(texto.includes('(8,800%) percentil 75'), 'el P75 nuevo');
  assert.ok(texto.includes('la mediana con (2,340%)'), 'y la mediana');
  ['-3.001', '6.418', '-1.075'].forEach((v) =>
    assert.ok(!texto.includes(v), `la cifra vieja ${v} tiene que irse`));
  /* Y la redacción intacta, que es la del cliente. */
  assert.ok(texto.includes('Como se observa en el cuadro anterior, el rango Intercuartil obtenido'),
    'no se toca una sola palabra');
});

test('la descripción actualizada llega al documento que se descarga', async () => {
  /* El primer intento no servía de nada: el generador hacía `xml = actualizarProsa(xml…)`
     sobre una variable local, pero devuelve el XML del sustituidor, así que el cambio se
     descartaba en silencio. La prueba de la función pasaba y el informe salía igual. Esta
     va por la ruta completa —`rellenarDocx`— para que eso no vuelva a colarse. */
  const buf = await plantilla([
    new Paragraph('Tabla 18. Rango Intercuartil'),
    tablaRango(),
    parrafoConCifras(['-3.001%', '6.418%', '-1.075%']),
  ]);
  const { salida } = rellenarDocx({
    binario: buf,
    estudio: {
      ...ESTUDIO, pli: 'MO', cmode: 'all', useadj: false, prime: '7.37',
      t_s: 1000, t_c: 600, t_op: 100,
      comparables: [
        { name: 'Uno', s: 1000, c: 600, op: 100 },
        { name: 'Dos', s: 2000, c: 1600, op: 260 },
        { name: 'Tres', s: 3000, c: 2400, op: 300 },
        { name: 'Cuatro', s: 1500, c: 900, op: 200 },
      ],
    },
    tipoSalida: 'uint8array',
  });
  const texto = textoDe(new PizZip(salida), RUTA_DOC_TEST);
  ['-3.001', '6.418', '-1.075'].forEach((v) =>
    assert.ok(!texto.includes(v), `la cifra ${v} de la plantilla tenía que irse del .docx`));
  assert.ok(/percentil 25 \([\d.,]+ ?%\)/.test(texto), 'y quedar una cifra del estudio');
});

test('si la descripción no trae las cifras esperadas se deja como estaba', async () => {
  /* Con más números de los previstos —o en otro orden— la sustitución pondría una cifra en
     el sitio de otra, y publicar el P75 donde va la mediana es peor que no tocar nada. */
  const avisos = [];
  const buf = await plantilla([
    new Paragraph('Tabla 5. Rango Intercuartil'),
    tablaRango(),
    parrafoConCifras(['1.11%', '2.22%', '3.33%']),
  ]);
  const xml = new PizZip(buf).file(RUTA_DOC_TEST).asText();

  const salida = actualizarProsaTrasTabla(xml, 'Rango Intercuartil', ['9,990%', '8,880%'], avisos);
  const texto = textoPlanoOoxml(salida);
  assert.ok(texto.includes('1.11%') && texto.includes('3.33%'), 'la frase queda intacta');
  assert.ok(!texto.includes('9,990'), 'y no se escribe nada');
  assert.strictEqual(avisos.length, 1, 'pero se avisa');
  assert.match(avisos[0], /no trae las 2 cifras que se esperaban/);
});

test('una plantilla cuya frase sí se actualizó no se queda sin el año de la conclusión', async () => {
  /* El año estaba dentro del `if` que dispara el respaldo posicional, y eso funcionaba mientras
     las plantillas que necesitaban el año fueran justo las que la prosa no sabía tocar. Esta
     escribe las cifras sin paréntesis —«…entre 10.925% percentil 25 y 17.258% percentil 75 y la
     mediana con 15.356%»—, que ahora sí se actualizan por cercanía, así que el `if` ya no entra;
     y su «ajustado durante el» vive en otro párrafo, donde la prosa del rango no llega. */
  const buf = await plantilla([
    new Paragraph('Tabla 6. Rango Intercuartil'),
    tablaRango(),
    parrafo('Como se observa en el cuadro anterior, el rango Intercuartil obtenido por las '
      + 'compañías comparables se ubica entre 10.925% percentil 25 y 17.258% percentil 75 y la '
      + 'mediana con 15.356%.'),
    parrafo('El margen de las comparables ajustado durante el 2019 se calculó con la '
      + 'metodología descrita en el apartado anterior.'),
  ]);
  const { salida } = rellenarDocx({
    binario: buf,
    estudio: {
      ...ESTUDIO, anio: 2025, pli: 'MO', cmode: 'all', useadj: false, prime: '7.37',
      t_s: 1000, t_c: 600, t_op: 100,
      comparables: [
        { name: 'Uno', s: 1000, c: 600, op: 100 },
        { name: 'Dos', s: 2000, c: 1600, op: 260 },
        { name: 'Tres', s: 3000, c: 2400, op: 300 },
        { name: 'Cuatro', s: 1500, c: 900, op: 200 },
      ],
    },
    tipoSalida: 'uint8array',
  });
  const texto = textoDe(new PizZip(salida), RUTA_DOC_TEST);

  assert.ok(texto.includes('ajustado durante el 2025'),
    'el año de la conclusión se quedó en el de la plantilla: ' + texto);
  /* Y la frase, que es lo que dejaba de disparar el respaldo, sí trae las cifras del estudio. */
  ['10.925%', '17.258%', '15.356%'].forEach((v) => assert.ok(!texto.includes(v),
    'sobrevive la cifra ' + v + ' del informe de referencia'));
});

test('la prosa de la muestra y de la operación llega al documento que se descarga', async () => {
  /* Por la ruta completa y no por la función suelta, por lo mismo que la del rango: el primer
     enganche de aquélla se descartaba en silencio porque escribía sobre una variable local, la
     prueba de la función pasaba y el informe salía igual. */
  const buf = await plantilla([
    parrafo('A partir del anterior criterio de búsqueda se identificó un total de 442 '
      + 'Compañías comparables potenciales.'),
    parrafo('De esta manera, después de aplicar dichos criterios, quedaron 13 compañías '
      + 'comparables.'),
    parrafo('En el año 2019, ACME tuvo operaciones de ingreso con sus vinculados económicos '
      + 'por un valor total de $ 3.435.357.400'),
    parrafo('El siguiente cuadro presenta las utilidades operacionales sobre ventas para el '
      + 'conjunto de compañías comparables para los estados financieros correspondientes al '
      + 'año 2019:'),
  ]);
  const { salida } = rellenarDocx({
    binario: buf,
    estudio: {
      ...ESTUDIO, anio: 2025, pli: 'MO', cmode: 'all', useadj: false, prime: '7.37',
      monto_operacion: 5230114900,
      t_s: 1000, t_c: 600, t_op: 100,
      embudoSeleccion: {
        evaluadas: 500, seleccionadas: 4, reserva: 0, porMotivo: { actividad: 496 },
      },
      comparables: [
        { name: 'Uno', s: 1000, c: 600, op: 100 },
        { name: 'Dos', s: 2000, c: 1600, op: 260 },
        { name: 'Tres', s: 3000, c: 2400, op: 300 },
        { name: 'Cuatro', s: 1500, c: 900, op: 200 },
      ],
    },
    tipoSalida: 'uint8array',
  });
  const texto = textoDe(new PizZip(salida), RUTA_DOC_TEST);

  assert.ok(texto.includes('un total de 500 Compañías'), 'el universo no llegó al .docx');
  assert.ok(texto.includes('quedaron 4 compañías comparables'), 'las aceptadas no llegaron');
  assert.ok(texto.includes('$ 5.230.114.900'), 'el monto no llegó al .docx');
  assert.ok(texto.includes('En el año 2025'), 'el año de la operación no llegó');
  assert.ok(texto.includes('correspondientes al año 2025'), 'el año de los márgenes no llegó');
  ['442', '3.435.357.400'].forEach((v) => assert.ok(!texto.includes(v),
    'sobrevive ' + v + ' del informe de referencia'));
});

/* ══════════════════ ANEXO B — descripciones de comparables ══════════════════ */

test('el ANEXO B se escribe en el cuerpo y no dentro del índice', async () => {
  /* El título sale dos veces: en la tabla de contenidos y en el cuerpo. Tomando la
     PRIMERA aparición, el inicio y el final de la sección caían los dos dentro del índice
     —a unos cientos de caracteres uno del otro—, así que las descripciones y los estados
     financieros se escribían ahí, se destruía la entrada del índice, y el ANEXO B de
     verdad se quedaba con lo que trajera la plantilla: el del año anterior. */
  const buf = await plantilla([
    parrafo('ANEXO A. Estados financieros . 40'),
    parrafo('ANEXO B. Descripciones de comparables . 45'),
    parrafo('ANEXO C. Matriz de Rechazo . 88'),
    parrafo('Cuerpo del informe que no se puede perder.'),
    parrafo('ANEXO B. Descripciones de comparables y Estados Financieros'),
    parrafo('DESCRIPCION VIEJA DE LA PLANTILLA'),
    parrafo('ANEXO C. Matriz de Rechazo'),
    parrafo('MATRIZ VIEJA'),
  ]);
  const zip = new PizZip(buf);
  insertarImagenesAnexoB(zip, {
    comparables: [{ name: 'ACME COMPARABLE SA', eeffArchivo: 'acme.pdf', descActividad: 'Desarrolla videojuegos.' }],
  });

  const xml = zip.file(RUTA_DOC_TEST).asText();
  const texto = textoDe(zip, RUTA_DOC_TEST);
  assert.ok(texto.includes('ACME COMPARABLE SA'), 'la comparable tiene que aparecer');
  assert.ok(!texto.includes('DESCRIPCION VIEJA'), 'y la descripción de la plantilla irse');

  /* El índice queda intacto: sus tres entradas siguen, y con ellas el cuerpo intermedio. */
  assert.ok(texto.includes('ANEXO A. Estados financieros . 40'), 'la entrada del índice del A');
  assert.ok(texto.includes('ANEXO C. Matriz de Rechazo . 88'), 'y la del C, que era la que se perdía');
  assert.ok(texto.includes('Cuerpo del informe que no se puede perder'), 'y lo que va en medio');
  /* Y el ANEXO C del cuerpo sigue en pie: es el corte de la sección, no parte de ella. */
  assert.ok(texto.includes('MATRIZ VIEJA'), 'el anexo siguiente no se toca');
  assert.ok(xml.includes('</w:body>'), 'el documento queda bien cerrado');
});

test('en el ANEXO B del .docx salen también las comparables sin estado financiero', async () => {
  /* El filtro por `eeffArchivo` las dejaba fuera y en su lugar quedaba el bloque del
     contribuyente ANTERIOR. Ahora entran todas: las que falten, con un [PENDIENTE] que se
     ve, porque un hueco señalado se completa y unas cifras del año pasado se radican. */
  const buf = await plantilla([
    parrafo('ANEXO B. Descripciones de comparables . 45'),
    parrafo('ANEXO C. Matriz de Rechazo . 88'),
    parrafo('ANEXO B. Descripciones de comparables y Estados Financieros'),
    parrafo('BLOQUE VIEJO DEL INFORME ANTERIOR'),
    parrafo('ANEXO C. Matriz de Rechazo'),
  ]);
  const zip = new PizZip(buf);
  insertarImagenesAnexoB(zip, {
    comparables: [
      { name: 'CON EEFF SA', eeffArchivo: 'a.pdf', descActividad: 'Desarrolla juegos.' },
      { name: 'SIN EEFF SA', descActividad: 'Publica juegos.' },
    ],
  });

  const texto = textoDe(zip, RUTA_DOC_TEST);
  assert.ok(texto.includes('CON EEFF SA'), 'la que tiene documento');
  assert.ok(texto.includes('SIN EEFF SA'), 'y la que no, que antes desaparecía');
  assert.ok(texto.includes('[PENDIENTE]') && texto.includes('SIN EEFF SA'),
    'con el hueco señalado y nombrando a cuál le falta');
  assert.ok(!texto.includes('BLOQUE VIEJO'), 'y nada del informe anterior sobrevive');
});

/* ══════════════════ ANEXO C — matriz de rechazo ══════════════════ */

const ESTUDIO_ANEXO_C = {
  embudoSeleccion: {
    evaluadas: 12, seleccionadas: 2, reserva: 0,
    porMotivo: { rigorFuncional: 2, actividadDistinta: 4, holding: 3, perdidaOperativa: 1 },
  },
  matrizRechazo: {
    universo: 12,
    porMotivo: {
      rigorFuncional: ['RIGOR UNO', 'RIGOR DOS'],
      actividadDistinta: ['ACT UNO', 'ACT DOS', 'ACT TRES', 'ACT CUATRO'],
      holding: ['HOLD UNO', 'HOLD DOS', 'HOLD TRES'],
      perdidaOperativa: ['PERD UNO'],
      aceptadas: ['OK UNO', 'OK DOS'],
    },
  },
};

/* Una plantilla con las DOS menciones del anexo que trae un informe real: la del índice,
   al principio, y la del cuerpo. */
async function zipConAnexoC() {
  const buf = await plantilla([
    parrafo('ANEXO C. Matriz de Rechazo . 88'),
    parrafo('Cuerpo del informe que no se puede perder.'),
    parrafo('ANEXO C. Matriz de Rechazo'),
    parrafo('MATRIZ VIEJA DEL AÑO PASADO'),
    parrafo('Diferencias funcionales 327'),
  ]);
  return new PizZip(buf);
}

test('el ANEXO C se rehace con la matriz del estudio', async () => {
  const zip = await zipConAnexoC();
  const r = insertarAnexoC(zip, ESTUDIO_ANEXO_C);
  assert.strictEqual(r.reescrito, true);
  assert.strictEqual(r.grupos, 4, 'diferencias funcionales, holding, pérdidas y aceptadas');

  const texto = textoDe(zip, RUTA_DOC_TEST);
  assert.ok(!texto.includes('MATRIZ VIEJA'), 'la matriz de la plantilla tiene que irse');
  assert.ok(!texto.includes('327'), 'y con ella sus conteos del año pasado');
  /* En MAYÚSCULA desde el 2026-08-19: el ANEXO C entero va en mayúscula por pedido del
     usuario, y su resumen es parte del anexo. La «Tabla 16. Razones de rechazo» del CUERPO,
     que publica esta misma fila, sigue en caja mixta — su test está más abajo.

     Se comprueba que la caja mixta DESAPARECIÓ y no que la mayúscula aparece: el título del
     grupo ya se emitía en mayúscula (`tituloDeGrupoAnexoC`), así que buscar «DIFERENCIAS
     FUNCIONALES» daba verde aunque el resumen siguiera en caja mixta. */
  assert.ok(texto.includes('DIFERENCIAS FUNCIONALES'), 'el resumen lleva la fila fundida');
  assert.ok(!texto.includes('Diferencias funcionales'), 'el resumen del anexo no subió');
  ['ACT UNO', 'RIGOR UNO', 'HOLD UNO', 'PERD UNO', 'OK UNO'].forEach((c) =>
    assert.ok(texto.includes(c), `la compañía ${c} tiene que aparecer en su listado`));
});

test('el ANEXO C no se lleva por delante el índice ni la maquetación', async () => {
  /* «ANEXO C» sale también en la tabla de contenidos. Cortar por la PRIMERA aparición
     borraría el informe entero, y perder el `<w:sectPr>` del final deja el documento con
     el tamaño de página por defecto. */
  const zip = await zipConAnexoC();
  insertarAnexoC(zip, ESTUDIO_ANEXO_C);

  const xml = zip.file(RUTA_DOC_TEST).asText();
  assert.ok(textoDe(zip, RUTA_DOC_TEST).includes('Cuerpo del informe que no se puede perder'),
    'lo que va entre el índice y el anexo se conserva');
  assert.ok(xml.includes('<w:sectPr'), 'las propiedades de sección siguen en el documento');
  assert.ok(xml.includes('</w:body>'), 'el cuerpo queda bien cerrado');
});

test('sin matriz en el estudio el ANEXO C se deja como estaba, con aviso', async () => {
  /* Vaciarlo sería peor que dejarlo: el informe perdería el respaldo de la Tabla 16 sin
     que nada lo señale. */
  const zip = await zipConAnexoC();
  const r = insertarAnexoC(zip, { embudoSeleccion: ESTUDIO_ANEXO_C.embudoSeleccion });
  assert.strictEqual(r.reescrito, false);
  /* El aviso nombra el anexo y NO su letra: aquí todavía no se ha localizado en la plantilla,
     y la letra del informe de referencia no vale para todas —MC Internacional numera sus
     anexos A, C, D, E, F y ahí la matriz de rechazo es el D—. */
  assert.match(r.aviso, /Matriz de Rechazo/);
  assert.ok(textoDe(zip, RUTA_DOC_TEST).includes('MATRIZ VIEJA'), 'no se toca la plantilla');
});

test('las letras del ANEXO C son las de la Tabla 16', async () => {
  /* El anexo es el respaldo nominal de esa tabla: si una compañía figura bajo «B» en el
     anexo y su motivo es «C» en el cuerpo, el informe no se puede cotejar. */
  const zip = await zipConAnexoC();
  insertarAnexoC(zip, ESTUDIO_ANEXO_C);
  const texto = textoDe(zip, RUTA_DOC_TEST);

  const { filas } = filasRazonesRechazo(ESTUDIO_ANEXO_C.embudoSeleccion);
  const letraDe = (clave) => (filas.find((f) => f.clave === clave) || {}).letra;
  /* La primera compañía de cada grupo va seguida de la letra que la tabla le da. */
  assert.ok(texto.includes('RIGOR UNO' + letraDe('rigorFuncional')), 'diferencias funcionales');
  assert.ok(texto.includes('HOLD UNO' + letraDe('holding')), 'holding');
  assert.ok(texto.includes('OK UNO' + letraDe('aceptadas')), 'aceptadas');
});

const parrafoXml = (texto) => `<w:p><w:r><w:t>${texto}</w:t></w:r></w:p>`;

test('localizarBloqueProsa delimita desde el encabezado de inicio hasta el de fin, sin incluirlo', () => {
  const xml = [
    parrafoXml('Preámbulo'),
    parrafoXml('A. Análisis del Panorama de la Economía Mundial'),
    parrafoXml('CRECIMIENTO MUNDIAL'),
    parrafoXml('La economía mundial transitó durante el bienio 2024-2025...'),
    parrafoXml('Crecimiento del PIB Mundial (2024-2026)'),
    parrafoXml('Cierre'),
  ].join('');

  const bloque = localizarBloqueProsa(
    xml, 'Análisis del Panorama de la Economía Mundial', ['PIB Mundial']
  );

  assert.ok(bloque);
  const dentro = xml.slice(bloque.inicio, bloque.fin);
  assert.match(dentro, /A\. Análisis del Panorama/);
  assert.match(dentro, /CRECIMIENTO MUNDIAL/);
  assert.match(dentro, /bienio 2024-2025/);
  assert.doesNotMatch(dentro, /Crecimiento del PIB Mundial \(2024-2026\)/);
});

test('localizarBloqueProsa devuelve null si no encuentra el encabezado de inicio', () => {
  const xml = parrafoXml('Algo que no es el encabezado buscado');
  assert.equal(localizarBloqueProsa(xml, 'Análisis del Panorama de la Economía Mundial', ['PIB Mundial']), null);
});

test('localizarBloqueProsa devuelve null si el encabezado de inicio existe pero ningún tituloFin aparece después', () => {
  const xml = parrafoXml('A. Análisis del Panorama de la Economía Mundial') + parrafoXml('Cierre sin tabla');
  assert.equal(localizarBloqueProsa(xml, 'Análisis del Panorama de la Economía Mundial', ['PIB Mundial']), null);
});

test('localizarBloqueProsa ignora la entrada de la Tabla de Contenido y encuentra el encabezado real del cuerpo', () => {
  const entradaToc = '<w:p><w:pPr><w:pStyle w:val="TDC2"/></w:pPr><w:r><w:t>Análisis del Panorama de la Economía Mundial</w:t></w:r>'
    + '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGEREF _Toc1 \\h </w:instrText></w:r></w:p>';
  const xml = [
    entradaToc,
    parrafoXml('B. Análisis del panorama de la economía colombiana'), // otra entrada del TOC, distinta
    parrafoXml('A. Análisis del Panorama de la Economía Mundial'), // encabezado real del cuerpo
    parrafoXml('La prosa real que hay que reemplazar.'),
    parrafoXml('Crecimiento del PIB Mundial (2024-2026)'),
  ].join('');

  const bloque = localizarBloqueProsa(xml, 'Análisis del Panorama de la Economía Mundial', ['PIB Mundial']);
  assert.ok(bloque);
  const dentro = xml.slice(bloque.inicio, bloque.fin);
  assert.doesNotMatch(dentro, /economía colombiana/);
  assert.match(dentro, /La prosa real que hay que reemplazar/);
});

test('parrafosOoxmlDesdeHtml convierte cada <p> en un párrafo y <strong> en negrita', () => {
  const html = '<p>Primer párrafo con <strong>énfasis</strong> normal.</p><p>Segundo párrafo.</p>';
  const xml = parrafosOoxmlDesdeHtml(html);

  assert.equal((xml.match(/<w:p>/g) || []).length, 2);
  assert.match(xml, /<w:rPr><w:b\/><\/w:rPr><w:t xml:space="preserve">énfasis<\/w:t>/);
  assert.match(xml, /<w:t xml:space="preserve">Primer párrafo con <\/w:t>/);
  assert.match(xml, /<w:t xml:space="preserve"> normal\.<\/w:t>/);
  assert.match(xml, /<w:t xml:space="preserve">Segundo párrafo\.<\/w:t>/);
});

test('parrafosOoxmlDesdeHtml aplana enlaces a su texto visible, sin dejar el <a>', () => {
  const html = '<p>Fuente: <a href="https://dane.gov.co">DANE</a>.</p>';
  const xml = parrafosOoxmlDesdeHtml(html);
  assert.match(xml, /<w:t xml:space="preserve">Fuente: DANE\.<\/w:t>/);
  assert.doesNotMatch(xml, /<a /);
});

test('parrafosOoxmlDesdeHtml devuelve cadena vacía si el HTML no trae <p>', () => {
  assert.equal(parrafosOoxmlDesdeHtml(''), '');
  assert.equal(parrafosOoxmlDesdeHtml(null), '');
});

test('actualizarApartadosMacroOoxml reemplaza la prosa de mundial y colombia con la narrativa de Firestore', () => {
  const xml = [
    parrafoXml('A. Análisis del Panorama de la Economía Mundial'),
    parrafoXml('Texto de END GAME sobre el mundo, 2024.'),
    parrafoXml('Crecimiento del PIB Mundial (2024-2026)'),
    parrafoXml('Tasas de Inflación Global (2024-2026)'),
    parrafoXml('Proyecciones de Crecimiento del PIB por Región/País (2026)'),
    parrafoXml('B. Análisis del panorama de la economía colombiana'),
    parrafoXml('Texto de END GAME sobre Colombia, 2024.'),
    parrafoXml('Crecimiento del PIB en Colombia (2024-2026)'),
    parrafoXml('Inflación en Colombia (2024 vs. Meta 2025)'),
    parrafoXml('Tasa de Intervención del Banco de la República (Marzo 2023 - Diciembre 2024)'),
    parrafoXml('Tasa Representativa del Mercado (TRM) Promedio (2023-2024)'),
    parrafoXml('Tasa de Desempleo en Colombia (2024 vs. Proyección 2025)'),
    parrafoXml('Análisis del Sector de la industria del software'),
  ].join('');

  const datosMacro = {
    narrativa: {
      mundial: '<p>Narrativa real del mundo para este cliente.</p>',
      colombia: '<p>Narrativa real de Colombia para este cliente.</p>',
    },
  };

  const avisos = [];
  const salida = actualizarApartadosMacroOoxml(xml, datosMacro, 2026, avisos);

  assert.match(salida, /Narrativa real del mundo para este cliente\./);
  assert.match(salida, /Narrativa real de Colombia para este cliente\./);
  assert.doesNotMatch(salida, /Texto de END GAME/);
  assert.equal(avisos.length, 0);
});

test('actualizarApartadosMacroOoxml usa el marcador de pendiente si no hay narrativa, y avisa', () => {
  const xml = [
    parrafoXml('A. Análisis del Panorama de la Economía Mundial'),
    parrafoXml('Texto de END GAME sobre el mundo, 2024.'),
    parrafoXml('Crecimiento del PIB Mundial (2024-2026)'),
  ].join('');

  const avisos = [];
  const salida = actualizarApartadosMacroOoxml(xml, null, 2026, avisos);

  assert.doesNotMatch(salida, /Texto de END GAME/);
  assert.match(salida, /\[Actualizar con el análisis del panorama de la economía mundial/);
  assert.ok(avisos.length >= 1);
});

test('localizarHitos encuentra los encabezados en orden y da el fin de cada uno', () => {
  const xml = [
    parrafoXml('Uno'),
    parrafoXml('Dos'),
    parrafoXml('Tres'),
  ].join('');
  const hitos = localizarHitos(xml, ['Uno', 'Tres']);
  assert.equal(hitos.length, 2);
  assert.ok(hitos[0]);
  assert.ok(hitos[1]);
  assert.ok(hitos[0].inicio < hitos[0].finPropio);
  assert.ok(hitos[0].finPropio <= hitos[1].inicio);
});

test('localizarHitos devuelve null en las posiciones que no encuentra, sin lanzar', () => {
  const xml = parrafoXml('Uno') + parrafoXml('Tres');
  const hitos = localizarHitos(xml, ['Uno', 'Dos', 'Tres']);
  assert.ok(hitos[0]);
  assert.equal(hitos[1], null);
  /* Que "Dos" no aparezca —una plantilla de referencia más vieja que ese título— no
     puede impedir que "Tres" sí se encuentre después: antes el cursor se quedaba
     clavado en "Dos" para siempre y ningún título posterior llegaba a probarse. */
  assert.ok(hitos[2], 'un título ausente no debe bloquear los que vienen después');
});

/* Un rótulo que la plantilla escribe de otro modo no puede arrastrar a los que vienen
   detrás. Antes el recorrido esperaba el rótulo `objetivo` sin avanzar, así que se comía
   el resto del documento y toda la cadena salía null; medido sobre el informe de un
   segundo cliente daba 0 de 7 hitos con dos de esos rótulos presentes en el texto. */
test('localizarHitos no pierde los hitos que siguen a un rótulo ausente', () => {
  const xml = parrafoXml('Uno') + parrafoXml('Tres') + parrafoXml('Cuatro');
  const hitos = localizarHitos(xml, ['Uno', 'Dos', 'Tres', 'Cuatro']);
  assert.ok(hitos[0], 'el primero se encuentra');
  assert.equal(hitos[1], null, '«Dos» no está en esta plantilla');
  assert.ok(hitos[2], '«Tres» se encuentra aunque falte el rótulo anterior');
  assert.ok(hitos[3], 'y «Cuatro» también');
  assert.ok(hitos[2].inicio < hitos[3].inicio, 'en orden documental');
});

test('localizarHitos sigue prefiriendo el rótulo esperado cuando sí está', () => {
  /* El look-ahead no puede adelantarse: con los dos rótulos presentes, cada uno tiene
     que caer en su propio párrafo y en su propia posición de la lista. */
  const xml = parrafoXml('Uno') + parrafoXml('Dos');
  const hitos = localizarHitos(xml, ['Uno', 'Dos']);
  assert.equal(hitos[0].inicio, xml.indexOf(parrafoXml('Uno')));
  assert.equal(hitos[1].inicio, xml.indexOf(parrafoXml('Dos')));
});

test('localizarHitos ignora las entradas de la Tabla de Contenido (PAGEREF)', () => {
  const entradaToc = '<w:p><w:r><w:t>Uno</w:t></w:r><w:r><w:instrText xml:space="preserve"> PAGEREF _Toc1 \\h </w:instrText></w:r></w:p>';
  const xml = entradaToc + parrafoXml('Uno') + parrafoXml('Dos');
  const hitos = localizarHitos(xml, ['Uno', 'Dos']);
  assert.ok(hitos[0].inicio > entradaToc.length - 1);
});

test('localizarHitos acepta un arreglo de sinónimos por posición', () => {
  /* El contenido es universal (la sección de desempleo es la misma para todos los
     informes), pero el .docx de cada contribuyente es un archivo distinto que un
     consultor distinto redactó en su momento — "Tasa de Desempleo" y "Desempleo en
     Colombia" son el mismo apartado con otra redacción, no dos secciones distintas. */
  const xml = [parrafoXml('Uno'), parrafoXml('Tasa de Desempleo'), parrafoXml('Tres')].join('');
  const hitos = localizarHitos(xml, ['Uno', ['Desempleo en Colombia', 'Tasa de Desempleo'], 'Tres']);
  assert.ok(hitos[1], 'debió reconocer el sinónimo "Tasa de Desempleo"');
  assert.ok(hitos[0].finPropio <= hitos[1].inicio);
  assert.ok(hitos[1].finPropio <= hitos[2].inicio);
});

test('localizarHitos con sinónimos no encuentra nada si ninguno de los dos aparece', () => {
  const xml = [parrafoXml('Uno'), parrafoXml('Otra cosa'), parrafoXml('Tres')].join('');
  const hitos = localizarHitos(xml, ['Uno', ['Desempleo en Colombia', 'Tasa de Desempleo'], 'Tres']);
  assert.equal(hitos[1], null);
});

test('reemplazarPorHitos reemplaza el hueco cuando la función de contenido devuelve texto', () => {
  const xml = [
    parrafoXml('Encabezado A'),
    parrafoXml('Prosa vieja que debe irse.'),
    parrafoXml('Encabezado B'),
  ].join('');
  const doc = { xmlInterno: xml, aplicar(t) { this.xmlInterno = t(this.xmlInterno); }, get xml() { return this.xmlInterno; } };
  reemplazarPorHitos(doc, ['Encabezado A', 'Encabezado B'], [() => parrafoXml('Prosa nueva.')], []);
  assert.match(doc.xml, /Prosa nueva\./);
  assert.doesNotMatch(doc.xml, /Prosa vieja/);
  assert.match(doc.xml, /Encabezado A/);
  assert.match(doc.xml, /Encabezado B/);
});

test('reemplazarPorHitos no toca el hueco cuando la función de contenido devuelve null', () => {
  const xml = [
    parrafoXml('Encabezado A'),
    parrafoXml('Tabla que no hay que tocar.'),
    parrafoXml('Encabezado B'),
  ].join('');
  const doc = { xmlInterno: xml, aplicar(t) { this.xmlInterno = t(this.xmlInterno); }, get xml() { return this.xmlInterno; } };
  reemplazarPorHitos(doc, ['Encabezado A', 'Encabezado B'], [() => null], []);
  assert.match(doc.xml, /Tabla que no hay que tocar\./);
});

test('reemplazarPorHitos avisa cuando un hito no se encuentra, sin lanzar', () => {
  const xml = parrafoXml('Encabezado A');
  const doc = { xmlInterno: xml, aplicar(t) { this.xmlInterno = t(this.xmlInterno); }, get xml() { return this.xmlInterno; } };
  const avisos = [];
  reemplazarPorHitos(doc, ['Encabezado A', 'Encabezado B'], [() => 'nunca se usa'], avisos, 'III.A');
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /III\.A/);
});

test('reemplazarPorHitos encuentra el hito con un sinónimo, y el aviso muestra un nombre legible si falla', () => {
  /* Camino positivo: la plantilla trae "Tasa de Desempleo" en vez de "Desempleo en
     Colombia" y aun así debe localizar el hueco. */
  const xmlOk = [parrafoXml('Encabezado A'), parrafoXml('Tasa de Desempleo')].join('');
  const docOk = { xmlInterno: xmlOk, aplicar(t) { this.xmlInterno = t(this.xmlInterno); }, get xml() { return this.xmlInterno; } };
  reemplazarPorHitos(
    docOk,
    ['Encabezado A', ['Desempleo en Colombia', 'Tasa de Desempleo']],
    [() => parrafoXml('Prosa nueva.')],
    []
  );
  assert.match(docOk.xml, /Prosa nueva\./);

  /* Camino negativo: sin ninguno de los dos sinónimos, el aviso debe leerse como texto —
     "Desempleo en Colombia", el primero de la lista— y no como `[object Object]`. */
  const xmlFalta = parrafoXml('Encabezado A');
  const docFalta = { xmlInterno: xmlFalta, aplicar(t) { this.xmlInterno = t(this.xmlInterno); }, get xml() { return this.xmlInterno; } };
  const avisos = [];
  reemplazarPorHitos(
    docFalta,
    ['Encabezado A', ['Desempleo en Colombia', 'Tasa de Desempleo']],
    [() => 'nunca se usa'],
    avisos
  );
  assert.ok(avisos.some((a) => a.includes('Desempleo en Colombia')));
  assert.ok(!avisos.some((a) => a.includes('[object Object]')));
});

test('reemplazarPorHitos inserta de respaldo al final de la sección cuando falta un título intermedio, pero sí se encuentra el límite final', () => {
  /* Una plantilla más vieja que "Encabezado B" no puede impedir que el contenido de
     "Encabezado B" se inserte en algún lado: se apoya en "Encabezado C", que sí existe
     (el límite de la sección siguiente), en vez de perderse en silencio. */
  const xml = [
    parrafoXml('Encabezado A'),
    parrafoXml('Prosa de A.'),
    parrafoXml('Encabezado C'),
  ].join('');
  const doc = { xmlInterno: xml, aplicar(t) { this.xmlInterno = t(this.xmlInterno); }, get xml() { return this.xmlInterno; } };
  const avisos = [];
  reemplazarPorHitos(
    doc,
    ['Encabezado A', 'Encabezado B', 'Encabezado C'],
    [() => null, () => parrafoXml('Contenido de B, sin ancla propia.')],
    avisos, 'III.X'
  );
  assert.match(doc.xml, /Contenido de B, sin ancla propia\./);
  /* Antes del límite final, no después: se insertó DENTRO de la sección. */
  assert.ok(doc.xml.indexOf('Contenido de B') < doc.xml.indexOf('Encabezado C'));
  assert.ok(avisos.some((a) => /no se encontró el rótulo «Encabezado B»/.test(a)));
  assert.ok(avisos.some((a) => /"Encabezado B".*se insertó al final de esta sección/.test(a)));
});

test('reemplazarPorHitos NO inserta de respaldo si ni siquiera el límite final aparece', () => {
  /* Sin ningún título de la cadena en el documento, no hay evidencia de que esta
     sección exista aquí en absoluto: mejor no tocar nada que adivinar un lugar. */
  const xml = parrafoXml('Un documento que no tiene nada que ver con esta cadena de títulos.');
  const doc = { xmlInterno: xml, aplicar(t) { this.xmlInterno = t(this.xmlInterno); }, get xml() { return this.xmlInterno; } };
  const avisos = [];
  reemplazarPorHitos(
    doc,
    ['Encabezado A', 'Encabezado B', 'Encabezado C'],
    [() => parrafoXml('No debería aparecer.'), () => parrafoXml('Tampoco esto.')],
    avisos, 'III.X'
  );
  assert.doesNotMatch(doc.xml, /No debería aparecer/);
  assert.doesNotMatch(doc.xml, /Tampoco esto/);
});

test('reemplazarPorHitos avisa una vez por rótulo ausente, no una por par consecutivo', () => {
  /* Cada rótulo delimita DOS apartados, así que el aviso por pares contaba la misma
     causa dos veces: con «Dos» y «Tres» ausentes salían tres avisos de par para dos
     rótulos, y una cadena de siete rotos por el primero producía seis líneas. Se filtran
     los avisos de respaldo, que son otra cosa y sí van uno por apartado insertado. */
  const xml = parrafoXml('Uno') + parrafoXml('Prosa.') + parrafoXml('Cuatro');
  const doc = { xmlInterno: xml, aplicar(t) { this.xmlInterno = t(this.xmlInterno); }, get xml() { return this.xmlInterno; } };
  const avisos = [];
  reemplazarPorHitos(doc, ['Uno', 'Dos', 'Tres', 'Cuatro'],
    [() => 'a', () => 'b', () => 'c'], avisos, 'III.B');
  const porRotulo = avisos.filter((a) => a.includes('no se encontró el rótulo'));
  assert.equal(porRotulo.length, 2, 'uno por cada rótulo que falta, no tres por los pares');
  assert.ok(porRotulo.some((a) => a.includes('«Dos»')), 'nombra el rótulo «Dos»');
  assert.ok(porRotulo.some((a) => a.includes('«Tres»')), 'nombra el rótulo «Tres»');
});

/* El respaldo INSERTA en el cursor, no reemplaza el tramo, y esa distinción es la que
   permite recuperar el contenido sin arriesgar nada: cuando el rótulo ausente solo está
   escrito de otro modo, su subsección sigue en el documento y debe sobrevivir. */
test('el respaldo no se lleva la subsección intermedia cuyo rótulo no se reconoció', () => {
  const xml = parrafoXml('Uno') + parrafoXml('Rotulo escrito de otro modo')
    + parrafoXml('Prosa que hay que conservar.') + parrafoXml('Cuatro');
  const doc = { xmlInterno: xml, aplicar(t) { this.xmlInterno = t(this.xmlInterno); }, get xml() { return this.xmlInterno; } };
  reemplazarPorHitos(doc, ['Uno', 'Dos', 'Cuatro'],
    [() => parrafoXml('nuevo'), () => parrafoXml('nuevo')], [], 'III.B');
  assert.match(doc.xml, /Prosa que hay que conservar\./, 'no se borra el texto del cliente');
  assert.match(doc.xml, /Rotulo escrito de otro modo/, 'ni su encabezado');
});

test('actualizarApartadosMacroOoxml reemplaza también los huecos intermedios entre tablas', () => {
  const xml = [
    parrafoXml('A. Análisis del Panorama de la Economía Mundial'),
    parrafoXml('Texto de END GAME sobre el mundo, 2024.'),
    parrafoXml('Crecimiento del PIB Mundial (2024-2026)'),
    parrafoXml('Tasas de Inflación Global (2024-2026)'),
    parrafoXml('Proyecciones de Crecimiento del PIB por Región/País (2026)'),
    parrafoXml('B. Análisis del panorama de la economía colombiana'),
    parrafoXml('Texto de END GAME sobre Colombia, 2024.'),
    parrafoXml('Crecimiento del PIB en Colombia (2024-2026)'),
    parrafoXml('Inflación en Colombia (2024 vs. Meta 2025)'),
    parrafoXml('Política Monetaria'),
    parrafoXml('La tasa de intervención descendió desde el 13,25 % hasta el 9,50 % en 2024, texto viejo de referencia.'),
    parrafoXml('Tasa de Intervención del Banco de la República (Marzo 2023 - Diciembre 2024)'),
    parrafoXml('Tasa de Cambio (TRM)'),
    parrafoXml('La TRM promedió $4.062 en 2024, texto viejo de referencia.'),
    parrafoXml('Tasa Representativa del Mercado (TRM) Promedio (2023-2024)'),
    parrafoXml('Mercado Laboral'),
    parrafoXml('El desempleo bajó a 9,7 % en 2024, texto viejo de referencia.'),
    parrafoXml('Tasa de Desempleo en Colombia (2024 vs. Proyección 2025)'),
    parrafoXml('CONCLUSIONES'),
    parrafoXml('La economía mundial se encuentra en desaceleración, texto viejo de referencia.'),
    parrafoXml('Análisis del Sector de la industria del software'),
  ].join('');

  const datosMacro = {
    narrativa: {
      mundial: '<p>Narrativa real del mundo.</p>',
      colombia: '<p>Narrativa real de Colombia.</p>',
    },
  };

  const avisos = [];
  const salida = actualizarApartadosMacroOoxml(xml, datosMacro, 2026, avisos);

  assert.match(salida, /Narrativa real del mundo\./);
  assert.match(salida, /Narrativa real de Colombia\./);
  assert.doesNotMatch(salida, /texto viejo de referencia/);
  assert.doesNotMatch(salida, /13,25 %/);
  /* Los propios títulos de tabla —los hitos— nunca se tocan; los subtítulos que había
     ENTRE dos hitos ("Política Monetaria", "CONCLUSIONES") caen dentro del hueco que
     se reemplaza, junto con la prosa que describían: es la forma robusta de que
     funcione igual sin importar cómo cada plantilla titule ese hueco intermedio. */
  assert.match(salida, /Tasa de Intervención del Banco de la República/);
  assert.match(salida, /Tasa de Desempleo en Colombia/);
  /* 4 huecos con prosa sustancial en este fixture: Política Monetaria, Tasa de Cambio,
     Mercado Laboral y CONCLUSIONES. El de "INFLACIÓN COLOMBIA" no lleva prosa en este
     fixture (va directo del título de la tabla anterior al de la siguiente), así que
     queda bajo el umbral y no se marca — es el mismo caso que prueba el siguiente test. */
  assert.doesNotMatch(salida, /Este párrafo del informe de referencia se retiró/);
  ['la política monetaria', 'la tasa de cambio \\(TRM\\)', 'el mercado laboral en Colombia',
    'las conclusiones del panorama económico'].forEach((tema) => {
    assert.match(salida, new RegExp('Actualizar con datos verificados sobre ' + tema));
  });
});

test('actualizarApartadosMacroOoxml no toca un hueco intermedio corto (sin prosa real)', () => {
  const xml = [
    parrafoXml('A. Análisis del Panorama de la Economía Mundial'),
    parrafoXml('Narrativa que sí se reemplaza.'),
    parrafoXml('Crecimiento del PIB Mundial (2024-2026)'),
    parrafoXml('INFLACIÓN MUNDIAL'),
    parrafoXml('Tasas de Inflación Global (2024-2026)'),
    parrafoXml('Proyecciones de Crecimiento del PIB por Región/País (2026)'),
    parrafoXml('B. Análisis del panorama de la economía colombiana'),
  ].join('');

  const datosMacro = { narrativa: { mundial: '<p>Narrativa real.</p>' } };
  const salida = actualizarApartadosMacroOoxml(xml, datosMacro, 2026, []);
  assert.match(salida, /INFLACIÓN MUNDIAL/);
  assert.doesNotMatch(salida, /\[Este párrafo del informe de referencia/);
});

test('actualizarApartadosMacroOoxml reemplaza el hueco de política monetaria con su propio párrafo y fuente', () => {
  const xml = [
    parrafoXml('B. Análisis del panorama de la economía colombiana'),
    parrafoXml('Texto real de Colombia.'),
    parrafoXml('Crecimiento del PIB en Colombia (2024-2026)'),
    /* Nota: evitar la frase literal "inflación en Colombia" en esta prosa — coincide
       con la clave normalizada del título "Inflación en Colombia" y `localizarHitos`
       (por diseño, ver su comentario) toma por hito cualquier párrafo corto que la
       incluya, aunque sea prosa y no el encabezado real. */
    parrafoXml('Texto de END GAME sobre la inflación colombiana, 2024.'),
    parrafoXml('Inflación en Colombia (2025 vs. Meta 2026)'),
    parrafoXml('Texto de END GAME sobre política monetaria, 2024.'),
    parrafoXml('Tasa de Intervención del Banco de la República'),
    parrafoXml('Texto de END GAME sobre TRM, 2024.'),
    parrafoXml('Tasa Representativa del Mercado (TRM) Promedio'),
    parrafoXml('Texto de END GAME sobre desempleo, 2024.'),
    parrafoXml('Tasa de Desempleo en Colombia'),
    parrafoXml('Texto de END GAME sobre conclusiones, 2024.'),
    parrafoXml('Análisis del Sector'),
  ].join('');

  const datosMacro = {
    narrativa: {
      mundial: '<p>Mundial.</p>', colombia: '<p>Colombia.</p>',
      politicaMonetaria: '<p>La tasa de intervención cerró en 12,00 % en julio de 2026.</p>',
    },
    series: {
      tasa_intervencion: {
        valores: { 2026: { etiqueta: 'Agosto 2026', valor: '12.00' } },
        fuente: 'Banco de la República',
        fuenteUrl: 'https://banrep.gov.co/tasa',
        fechaConsulta: new Date('2026-08-04'),
      },
    },
  };
  const avisos = [];
  const salida = actualizarApartadosMacroOoxml(xml, datosMacro, 2026, avisos);

  assert.match(salida, /tasa de intervención cerró en 12,00/);
  /* Mismo formato que imprime la tabla de esta serie justo debajo (`resolverSerie` en
     `analisisMercado.js`): URL entre paréntesis y fecha de consulta, no el formato
     "FUENTE: <fuente>, <url>" (sin fecha) que este módulo fabricaba antes por su cuenta. */
  assert.match(salida, /FUENTE: Banco de la República \(https:\/\/banrep\.gov\.co\/tasa\), consultado el/);
  assert.doesNotMatch(salida, /Texto de END GAME sobre política monetaria/);
  /* El encabezado "Inflación en Colombia" (el hito ANTERIOR a este hueco) no debe
     desaparecer: si `localizarHitos` lo confunde con la prosa que lo precede, el
     título real se pierde dentro de un hueco que no le corresponde. */
  assert.match(salida, /Inflación en Colombia \(2025 vs\. Meta 2026\)/);
});

test('actualizarApartadosMacroOoxml: cada tema cita la fuente/fecha de SU propia serie, no la de otra', () => {
  const PARES_TEMA_SERIE = [
    { tema: 'inflacionMundial', serieClave: 'inflacion_global' },
    { tema: 'proyeccionMundial', serieClave: 'crecimiento_por_region' },
    { tema: 'inflacionColombia', serieClave: 'inflacion_colombia' },
    { tema: 'politicaMonetaria', serieClave: 'tasa_intervencion' },
    { tema: 'tasaCambio', serieClave: 'trm_promedio' },
    { tema: 'mercadoLaboral', serieClave: 'desempleo_colombia' },
  ];

  const xml = [
    parrafoXml('A. Análisis del Panorama de la Economía Mundial'),
    parrafoXml('Narrativa mundial.'),
    parrafoXml('Crecimiento del PIB Mundial (2024-2026)'),
    parrafoXml('INFLACIÓN MUNDIAL'),
    parrafoXml('Tasas de Inflación Global (2024-2026)'),
    parrafoXml('Proyecciones de Crecimiento del PIB por Región/País (2026)'),
    parrafoXml('B. Análisis del panorama de la economía colombiana'),
    parrafoXml('Narrativa colombia.'),
    parrafoXml('Crecimiento del PIB en Colombia (2024-2026)'),
    parrafoXml('Inflación en Colombia (2025 vs. Meta 2026)'),
    parrafoXml('Tasa de Intervención del Banco de la República'),
    parrafoXml('Tasa Representativa del Mercado (TRM) Promedio'),
    parrafoXml('Tasa de Desempleo en Colombia'),
    parrafoXml('Análisis del Sector'),
  ].join('');

  PARES_TEMA_SERIE.forEach(({ tema, serieClave }) => {
    const datosMacro = {
      narrativa: {
        mundial: '<p>Mundial.</p>', colombia: '<p>Colombia.</p>',
        [tema]: '<p>Narrativa distintiva de ' + tema + '.</p>',
      },
      series: {
        [serieClave]: {
          valores: { 2026: '1' },
          fuente: 'Fuente distintiva de ' + serieClave,
          fuenteUrl: 'https://ejemplo.test/' + serieClave,
          fechaConsulta: new Date('2026-08-04'),
        },
      },
    };
    const { fuente: fuenteEsperada } = resolverSerie(datosMacro, serieClave);
    const salida = actualizarApartadosMacroOoxml(xml, datosMacro, 2026, []);

    assert.ok(
      salida.includes('Narrativa distintiva de ' + tema + '.'),
      tema + ': no se insertó su propia narrativa'
    );
    assert.ok(
      salida.includes('FUENTE: ' + fuenteEsperada),
      tema + ': no citó la fuente/fecha de su propia serie (' + serieClave + ')'
    );
  });
});

test('actualizarApartadosMacroOoxml deja el marcador especifico de tema (no el generico) cuando falta narrativa', () => {
  const xml = [
    parrafoXml('B. Análisis del panorama de la economía colombiana'),
    parrafoXml('Texto real de Colombia.'),
    parrafoXml('Crecimiento del PIB en Colombia (2024-2026)'),
    parrafoXml('Texto de END GAME sobre la inflación colombiana, 2024, con contenido suficientemente largo.'),
    parrafoXml('Inflación en Colombia (2025 vs. Meta 2026)'),
    parrafoXml('Análisis del Sector'),
  ].join('');

  const datosMacro = { narrativa: { mundial: '<p>Mundial.</p>', colombia: '<p>Colombia.</p>' } };
  const salida = actualizarApartadosMacroOoxml(xml, datosMacro, 2026, []);

  assert.match(salida, /Actualizar con datos verificados sobre la inflación en Colombia/);
  assert.doesNotMatch(salida, /este párrafo del informe de referencia se retiró/i);
});

const tablaXml = (texto) => `<w:tbl><w:tr><w:tc><w:p><w:t>${texto}</w:t></w:p></w:tc></w:tr></w:tbl>`;

test('actualizarApartadoSectorialOoxml reemplaza los cuatro bloques de prosa y la tabla de datos clave', () => {
  const xml = [
    parrafoXml('Análisis del Sector de la industria del software y de los videojuegos'),
    parrafoXml('Comportamiento del Sector de la Industria del Software y de los Videojuegos en 2024 y Comparación con 2023'),
    parrafoXml('Texto viejo de comportamiento, referencia 2024.'),
    parrafoXml('Datos Clave del Sector de la Industria del Software y de los Videojuegos en Colombia (2023 vs. 2024)'),
    tablaXml('fila vieja'),
    parrafoXml('Importaciones y exportaciones del sector de la industria del software y de los videojuegos'),
    parrafoXml('Texto viejo de comercio exterior, referencia 2024.'),
    parrafoXml('¿Qué se proyecta para el sector de la industria del software y de los videojuegos en 2025?'),
    parrafoXml('Texto viejo de proyección, referencia 2024.'),
    parrafoXml('Conclusiones y Perspectivas'),
    parrafoXml('Texto viejo de conclusiones, referencia 2024.'),
    parrafoXml('ANÁLISIS ECONÓMICO'),
  ].join('');

  const analisisSector = {
    porAnio: {
      2026: {
        tituloSector: 'Software y Videojuegos',
        narrativa: {
          comportamiento: '<p>Comportamiento real 2026.</p>',
          comercioExterior: '<p>Comercio exterior real 2026.</p>',
          proyeccion: '<p>Proyección real 2026.</p>',
          conclusiones: '<p>Conclusiones reales 2026.</p>',
        },
        datosClaveTabla: [
          { indicador: 'Empleo', valorAnterior: '250.000', valorActual: '260.000' },
        ],
      },
    },
  };

  const avisos = [];
  const salida = actualizarApartadoSectorialOoxml(xml, analisisSector, { anio: 2026 }, 2026, avisos);

  assert.match(salida, /Comportamiento real 2026\./);
  assert.match(salida, /Comercio exterior real 2026\./);
  assert.match(salida, /Proyección real 2026\./);
  assert.match(salida, /Conclusiones reales 2026\./);
  assert.doesNotMatch(salida, /Texto viejo/);
  assert.match(salida, /260\.000/);
  assert.doesNotMatch(salida, /fila vieja/);
});

test('actualizarApartadoSectorialOoxml escribe los encabezados de III.C con la industria y los años', () => {
  const xml = [
    parrafoXml('C. Análisis del Sector de la industria del software y de los videojuegos'),
    parrafoXml('Comportamiento del Sector de la Industria del Software y de los Videojuegos en 2024 y Comparación con 2023'),
    parrafoXml('Texto viejo de comportamiento, referencia 2024.'),
    parrafoXml('Datos Clave del Sector de la Industria del Software y de los Videojuegos en Colombia (2023 vs. 2024)'),
    tablaXml('fila vieja'),
    parrafoXml('Importaciones y exportaciones del sector de la industria del software y de los videojuegos'),
    parrafoXml('Texto viejo de comercio exterior, referencia 2024.'),
    parrafoXml('¿Qué se proyecta para el sector de la industria del software y de los videojuegos en 2025?'),
    parrafoXml('Texto viejo de proyección, referencia 2024.'),
    parrafoXml('Conclusiones y Perspectivas'),
    parrafoXml('Texto viejo de conclusiones, referencia 2024.'),
    parrafoXml('ANÁLISIS ECONÓMICO'),
  ].join('');

  const analisisSector = {
    porAnio: {
      2025: {
        tituloSector: 'de los videojuegos y servicios digitales creativos',
        narrativa: {
          comportamiento: '<p>Comportamiento real 2025.</p>',
          comercioExterior: '<p>Comercio real 2025.</p>',
          proyeccion: '<p>Proyección real 2025.</p>',
          conclusiones: '<p>Conclusiones reales 2025.</p>',
        },
        datosClaveTabla: [{ indicador: 'Empleo', valorAnterior: '250.000', valorActual: '262.000' }],
      },
    },
  };

  const salida = actualizarApartadoSectorialOoxml(xml, analisisSector, { anio: 2025 }, 2025, []);
  const texto = salida.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

  /* La numeración del cliente se conserva. */
  assert.match(texto, /C\. Análisis del Sector de la industria de los videojuegos y servicios digitales creativos/);
  assert.match(texto, /Comportamiento del Sector de la Industria de los videojuegos y servicios digitales creativos en 2025 y Comparación con 2024/);
  assert.match(texto, /Importaciones y exportaciones del sector de la industria de los videojuegos y servicios digitales creativos/);
  /* La proyección es del año siguiente al gravable. */
  assert.match(texto, /¿Qué se proyecta para el sector de la industria de los videojuegos y servicios digitales creativos en 2026\?/);

  assert.doesNotMatch(texto, /en 2024 y Comparación con 2023/);
  assert.doesNotMatch(texto, /del software y de los videojuegos/);
  assert.match(texto, /Conclusiones y Perspectivas/);
});

test('reescribirTextoParrafoOoxml deja el texto nuevo en el primer run y vacía los demás', () => {
  /* Word parte el encabezado en varios runs; el texto nuevo no puede quedar repetido ni
     partido, y las propiedades de cada run se conservan. */
  const parrafo = '<w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Datos Clave del Sector de la Industria del Software</w:t></w:r>'
    + '<w:r><w:t xml:space="preserve"> y de los Videojuegos (2023 vs. 2024)</w:t></w:r></w:p>';
  const salida = reescribirTextoParrafoOoxml(parrafo, 'Título nuevo & correcto');

  assert.match(salida, /<w:t xml:space="preserve">Título nuevo &amp; correcto<\/w:t>/);
  assert.doesNotMatch(salida, /Videojuegos/);
  assert.doesNotMatch(salida, /del Software/);
  assert.match(salida, /<w:rPr><w:b\/><\/w:rPr>/, 'se perdió el formato del primer run');
  assert.strictEqual((salida.match(/<w:r>/g) || []).length, 2, 'no se conservaron los dos runs');
});

test('prefijoDeEncabezado distingue la numeración del cliente de una primera palabra', () => {
  assert.strictEqual(prefijoDeEncabezado('C. Análisis del Sector'), 'C. ');
  assert.strictEqual(prefijoDeEncabezado('III. TENDENCIAS DE LA ECONOMÍA'), 'III. ');
  assert.strictEqual(prefijoDeEncabezado('1.4 Zona Geográfica'), '1.4 ');
  /* «Conclusiones» no es un rótulo aunque empiece por una letra mayúscula suelta. */
  assert.strictEqual(prefijoDeEncabezado('Conclusiones y Perspectivas'), '');
  assert.strictEqual(prefijoDeEncabezado('Comportamiento del Sector'), '');
  assert.strictEqual(prefijoDeEncabezado(''), '');
});

test('actualizarApartadoSectorialOoxml usa el marcador de pendiente si no hay corrida para ese año', () => {
  const xml = [
    parrafoXml('Análisis del Sector de la industria del software y de los videojuegos'),
    parrafoXml('Comportamiento del Sector de la Industria del Software y de los Videojuegos en 2024 y Comparación con 2023'),
    parrafoXml('Texto viejo de comportamiento, referencia 2024.'),
    parrafoXml('Datos Clave del Sector de la Industria del Software y de los Videojuegos en Colombia (2023 vs. 2024)'),
    tablaXml('fila vieja'),
    parrafoXml('Importaciones y exportaciones del sector de la industria del software y de los videojuegos'),
    parrafoXml('Texto viejo de comercio, referencia 2024.'),
    parrafoXml('¿Qué se proyecta para el sector de la industria del software y de los videojuegos en 2025?'),
    parrafoXml('Texto viejo de proyección, referencia 2024.'),
    parrafoXml('Conclusiones y Perspectivas'),
    parrafoXml('Texto viejo de conclusiones, referencia 2024.'),
    parrafoXml('ANÁLISIS ECONÓMICO'),
  ].join('');

  const avisos = [];
  const salida = actualizarApartadoSectorialOoxml(xml, null, { anio: 2026 }, 2026, avisos);

  assert.doesNotMatch(salida, /Texto viejo/);
  assert.match(salida, /\[Actualizar con el análisis del comportamiento del sector/);
  assert.ok(avisos.length >= 1);
});

test('actualizarApartadoSectorialOoxml reemplaza el hueco de entrada con la introduccion y sin fuente', () => {
  const xml = [
    parrafoXml('Análisis del Sector de la industria del software y los videojuegos'),
    parrafoXml('Texto de END GAME de introducción al sector, con contenido suficientemente largo para no ser un hueco vacío.'),
    parrafoXml('Comportamiento del Sector'),
    parrafoXml('Texto real de comportamiento.'),
    parrafoXml('Datos Clave del Sector'),
  ].join('');

  const analisisSector = {
    porAnio: { '2025': { narrativa: {
      introduccion: '<p>El sector de videojuegos mostró dinamismo en 2025.</p>',
      comportamiento: '<p>Texto real de comportamiento.</p>',
    } } },
  };
  const salida = actualizarApartadoSectorialOoxml(xml, analisisSector, { anio: 2025 }, 2025, []);

  assert.match(salida, /mostró dinamismo en 2025/);
  assert.doesNotMatch(salida, /Texto de END GAME de introducción/);
});

test('actualizarApartadoSectorialOoxml no fabrica un marcador si el hueco de entrada ya estaba vacío', () => {
  const xml = [
    parrafoXml('Análisis del Sector de la industria del software y de los videojuegos'),
    parrafoXml('Comportamiento del Sector'),
    parrafoXml('Texto real de comportamiento.'),
    parrafoXml('Datos Clave del Sector'),
  ].join('');

  const analisisSector = { porAnio: { '2025': { narrativa: {
    comportamiento: '<p>Texto real de comportamiento.</p>',
  } } } };
  const salida = actualizarApartadoSectorialOoxml(xml, analisisSector, { anio: 2025 }, 2025, []);

  assert.doesNotMatch(salida, /Actualizar con el análisis del contexto introductorio/);
});

test('actualizarApartadoSectorialOoxml inserta la introduccion aunque el hueco de entrada ya estuviera vacío', () => {
  /* Caso que el brief marca como el más común: la plantilla no trae párrafo
     introductorio propio ("Análisis del Sector" va seguido directo de "Comportamiento
     del Sector"), pero SÍ hay narrativa real y verificada lista para ese hueco. No
     fabricar un marcador ahí (umbral, cubierto por la prueba anterior) no debe
     confundirse con no insertar contenido real cuando lo hay — el umbral solo gatea el
     marcador de pendiente, nunca la narrativa disponible. */
  const xml = [
    parrafoXml('Análisis del Sector de la industria del software y de los videojuegos'),
    parrafoXml('Comportamiento del Sector'),
    parrafoXml('Texto real de comportamiento.'),
    parrafoXml('Datos Clave del Sector'),
  ].join('');

  const analisisSector = { porAnio: { '2025': { narrativa: {
    introduccion: '<p>El sector de videojuegos mostró dinamismo en 2025.</p>',
    comportamiento: '<p>Texto real de comportamiento.</p>',
  } } } };
  const salida = actualizarApartadoSectorialOoxml(xml, analisisSector, { anio: 2025 }, 2025, []);

  assert.match(salida, /mostró dinamismo en 2025/);
  assert.doesNotMatch(salida, /Actualizar con el análisis del contexto introductorio/);
});

test('el año de la conclusión del rango pasa a ser el gravable, y solo ese', async () => {
  /* Medido antes contra el .docx del cliente: «ajustado durante el 2024» pasó a 2025 y las
     apariciones de «2024» en el documento entero bajaron de 88 a 87 — una sola sustitución.
     Los otros años son correctos y no se pueden tocar: los encabezados del ANEXO B son los
     estados financieros disponibles de las comparables, del año anterior. */
  const buf = await plantilla([
    parrafo('), del margen operacional ajustado durante el 2024, demostrando un comportamiento.'),
    parrafo('Los estados financieros de las comparables son del 2024.'),
    parrafo('Fondo Monetario Internacional (2023). World Economic Outlook, April 2022.'),
  ]);
  const xml = new PizZip(buf).file(RUTA_DOC_TEST).asText();
  const texto = textoPlanoOoxml(actualizarAnioConclusionRango(xml, 2025, []));

  assert.ok(texto.includes('ajustado durante el 2025'), 'el año de la conclusión');
  assert.ok(texto.includes('comparables son del 2024'), 'el del ANEXO B NO se toca');
  assert.ok(texto.includes('(2023)') && texto.includes('April 2022'), 'ni las fuentes citadas');
});

test('sin la frase de la conclusión se avisa; con un año ilegible también', async () => {
  const sinFrase = [];
  const buf = await plantilla([parrafo('Otra redacción del 2024 cualquiera.')]);
  const xml = new PizZip(buf).file(RUTA_DOC_TEST).asText();
  assert.strictEqual(actualizarAnioConclusionRango(xml, 2025, sinFrase), xml);
  assert.match(sinFrase[0], /revísalo a mano/);

  /* Y nunca en silencio: un año que no se puede leer dejaba el informe con el de la
     plantilla y el panel de avisos limpio, indistinguible de haberlo actualizado. */
  const sinAnio = [];
  actualizarAnioConclusionRango(xml, undefined, sinAnio);
  assert.match(sinAnio[0], /no se pudo leer el año gravable/);
});

/* ══════════════════ Ecuaciones de ajuste (OMML) ══════════════════ */

const ROTULO_AR = 'FORMULA AJUSTE CUENTAS POR COBRAR';
const ROTULO_AP = 'FORMULA AJUSTE CUENTAS POR PAGAR';
/* Lo que el editor de ecuaciones del PDF deja en la plantilla: letras colapsadas al mismo code
   point y rombos de reemplazo donde iban las barras y los paréntesis. */
const BASURA = '𝐴'.repeat(24) + '�'.repeat(8);

const docDe = (zip) => zip.file(RUTA_DOC_TEST).asText();
const cuentaEn = (xml, etiqueta) => (xml.match(new RegExp(etiqueta, 'g')) || []).length;

test('la ecuación de ajuste se escribe con el motor matemático de Word', async () => {
  const buf = await plantilla([
    parrafo(ROTULO_AR), parrafo(BASURA),
    parrafo(ROTULO_AP), parrafo(BASURA),
  ]);
  const { zip, avisosTablas } = renderizarDocx(buf, ESTUDIO);
  const xml = docDe(zip);

  assert.strictEqual(cuentaEn(xml, '<m:oMath>'), 2, 'no son dos ecuaciones');
  /* La forma exacta la fija `formulasOmml.test.js`; aquí basta con que sea la de la plantilla. */
  assert.strictEqual(cuentaEn(xml, '<m:d>'), 10, 'no son cinco paréntesis por ecuación');
  assert.ok(xml.includes('<m:t>ANC</m:t>') && xml.includes('<m:t>ANP</m:t>'),
    'las dos ecuaciones promedian la misma cuenta');
  assert.ok(!/[\u{1D400}-\u{1D7FF}]/u.test(xml), 'sobrevive la basura del editor de ecuaciones');
  /* Los rótulos se quedan: en la plantilla se leen como un renglón más. */
  assert.ok(textoDe(zip, RUTA_DOC_TEST).includes(ROTULO_AR));
  assert.ok(!avisosTablas.some((a) => /ecuación/.test(a)), 'avisó de una ecuación que sí escribió');
});

test('el rótulo vale aunque Word lo haya partido en varios runs', async () => {
  /* El defecto que dejaba la basura en el informe sin decir nada: se buscaba la cadena entera en
     el XML crudo, y Word parte el texto por rsid o por el corrector —«FORMULA» sin tilde es justo
     lo que subraya—, así que la cadena no existía y no se sustituía nada. */
  const buf = await plantilla([
    parrafo('FORMULA AJUSTE ', 'CUENTAS POR ', { text: 'PAGAR', bold: true }),
    parrafo(BASURA),
  ]);
  const { zip } = renderizarDocx(buf, ESTUDIO);
  const xml = docDe(zip);
  assert.strictEqual(cuentaEn(xml, '<m:oMath>'), 1, 'no se reconoció el rótulo partido en runs');
  assert.ok(!/[\u{1D400}-\u{1D7FF}]/u.test(xml), 'sobrevive la basura');
});

test('la entrada del índice no se lleva la ecuación ni borra lo que la sigue', async () => {
  /* El rótulo aparece igual en la tabla de contenido. Reemplazar ahí inyectaba una segunda
     ecuación dentro del índice y borraba el párrafo siguiente. */
  const buf = await plantilla([parrafo('x'), parrafo(ROTULO_AR), parrafo(BASURA)]);
  const conIndice = docDe(new PizZip(buf)).replace(
    '<w:p><w:r><w:t xml:space="preserve">x</w:t></w:r></w:p>',
    '<w:p><w:pPr><w:pStyle w:val="TDC1"/></w:pPr><w:r>'
    + '<w:instrText> PAGEREF _Toc123 \\h </w:instrText>'
    + '<w:t>' + ROTULO_AR + '</w:t><w:t>80</w:t></w:r></w:p>'
    + '<w:p><w:r><w:t>victima del indice</w:t></w:r></w:p>');
  assert.ok(conIndice.includes('PAGEREF'), 'el montaje del test no insertó la entrada del índice');

  const salida = actualizarFormulasMatematicasOoxml(conIndice, []);
  assert.strictEqual(cuentaEn(salida, '<m:oMath>'), 1, 'se escribió también dentro del índice');
  assert.ok(salida.includes('victima del indice'), 'se borró el párrafo que seguía al índice');
});

test('una tabla tras el rótulo no se destruye', async () => {
  /* Buscar el siguiente `<w:p` a pelo entraba en la primera celda y la vaciaba. */
  const buf = await plantilla([
    parrafo(ROTULO_AP),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [new TableRow({ children: [new TableCell({ children: [parrafo('celda uno')] })] })],
    }),
  ]);
  const avisos = [];
  const salida = actualizarFormulasMatematicasOoxml(docDe(new PizZip(buf)), avisos);

  assert.ok(salida.includes('celda uno'), 'se destruyó el contenido de la celda');
  assert.strictEqual(cuentaEn(salida, '<m:oMath>'), 1);
  const celda = /<w:tc>[\s\S]*?<\/w:tc>/.exec(salida);
  assert.ok(!celda[0].includes('<m:oMath>'), 'la ecuación quedó dentro de la celda');
  /* Y entre el rótulo y la tabla, no después de ella. */
  assert.ok(salida.indexOf('<m:oMath>') < salida.indexOf('<w:tbl'));
  assert.ok(avisos.some((a) => /ecuación/.test(a)), 'no se avisó de que hubo que insertar');
});

test('un aviso del corrector tras el rótulo no desbalancea el documento', async () => {
  /* `indexOf('<w:p', …)` casaba con `<w:proofErr`, y la ecuación acababa ANIDADA dentro del
     párrafo del rótulo: tres aperturas, dos cierres, y Word declaraba el .docx dañado. */
  const buf = await plantilla([parrafo(ROTULO_AR), parrafo(BASURA)]);
  const conProofErr = docDe(new PizZip(buf)).replace(
    '<w:t xml:space="preserve">' + ROTULO_AR + '</w:t></w:r>',
    '<w:t xml:space="preserve">' + ROTULO_AR + '</w:t></w:r><w:proofErr w:type="spellEnd"/>');
  assert.ok(conProofErr.includes('proofErr'), 'el montaje del test no insertó el aviso');

  const salida = actualizarFormulasMatematicasOoxml(conProofErr, []);
  assert.strictEqual(cuentaEn(salida, '<w:p(?:\\s[^>]*)?>'), cuentaEn(salida, '</w:p>'),
    'el documento quedó con más aperturas de párrafo que cierres');
  assert.strictEqual(cuentaEn(salida, '<m:oMath>'), 1);
});

test('una plantilla sin el namespace de ecuaciones lo recupera', async () => {
  /* Un .docx de LibreOffice o de Google Docs sin una sola ecuación puede no declarar `xmlns:m`, y
     entonces Word abre el resultado diciendo que está dañado. La librería `docx` sí lo declara,
     así que hay que quitarlo a mano para que el test pruebe algo. */
  const buf = await plantilla([parrafo(ROTULO_AR), parrafo(BASURA)]);
  const sinNs = docDe(new PizZip(buf)).replace(/\s*xmlns:m="[^"]*"/, '');
  assert.ok(!/xmlns:m=/.test(sinNs), 'el montaje del test no quitó el namespace');

  const salida = actualizarFormulasMatematicasOoxml(sinNs, []);
  assert.strictEqual(cuentaEn(salida, 'xmlns:m='), 1, 'el namespace falta o se duplicó');
});

test('el namespace de ecuaciones no se duplica si ya estaba', async () => {
  const buf = await plantilla([parrafo(ROTULO_AR), parrafo(BASURA)]);
  const salida = actualizarFormulasMatematicasOoxml(docDe(new PizZip(buf)), []);
  assert.strictEqual(cuentaEn(salida, 'xmlns:m='), 1);
});

test('sin el rótulo se avisa en vez de callar', async () => {
  const buf = await plantilla([parrafo('El informe no anuncia ninguna ecuación.')]);
  const { zip, avisosTablas } = renderizarDocx(buf, ESTUDIO);
  assert.ok(!docDe(zip).includes('<m:oMath>'));
  assert.strictEqual(avisosTablas.filter((a) => /ecuación del ajuste/.test(a)).length, 2,
    'no se avisó de las dos ecuaciones que faltan');
});

test('lo que sigue al rótulo se conserva si no parece la ecuación vieja', async () => {
  /* No se sabe qué trae el .docx del cliente detrás del rótulo. Si no parece la ecuación, se
     escribe la nueva sin borrar: perder texto de un informe que se radica es peor. */
  const buf = await plantilla([
    parrafo(ROTULO_AP), parrafo('Dónde: Comp = Contribuyente comparable'),
  ]);
  const avisos = [];
  const salida = actualizarFormulasMatematicasOoxml(docDe(new PizZip(buf)), avisos);
  assert.ok(salida.includes('Contribuyente comparable'), 'se borró un párrafo de prosa');
  assert.strictEqual(cuentaEn(salida, '<m:oMath>'), 1);
  assert.ok(avisos.some((a) => /sin borrar/.test(a)));
});

test('escribir las ecuaciones dos veces da el mismo resultado', async () => {
  const buf = await plantilla([
    parrafo(ROTULO_AR), parrafo(BASURA), parrafo(ROTULO_AP), parrafo(BASURA),
  ]);
  const una = actualizarFormulasMatematicasOoxml(docDe(new PizZip(buf)), []);
  const dos = actualizarFormulasMatematicasOoxml(una, []);
  assert.strictEqual(dos, una);
  assert.strictEqual(cuentaEn(dos, '<m:oMath>'), 2);
});

test('docxtemplater no toca el texto de dentro de la ecuación', async () => {
  /* Su configuración incluye `m:t` entre las etiquetas de texto de plantilla, así que una llave
     dentro de la ecuación se tomaría por marcador y saldría un guion largo. Por eso la inyección
     va después del render. Si alguien la devuelve a antes, este test se entera. */
  const buf = await plantilla([
    parrafo('La sociedad {ent} declara.'), parrafo(ROTULO_AR), parrafo(BASURA),
  ]);
  const { zip } = renderizarDocx(buf, ESTUDIO);
  const xml = docDe(zip);
  assert.ok(textoDe(zip, RUTA_DOC_TEST).includes('ACME COLOMBIA S.A.S'), 'el campo no se resolvió');
  assert.ok(xml.includes('<m:t>AR Adjustment = </m:t>'), 'el texto de la ecuación llegó tocado');
  assert.ok(!xml.includes('<m:t>' + SIN_DATO + '</m:t>'),
    'docxtemplater escribió dentro de la ecuación');
});

test('una ecuación entre el título de una tabla y su tabla no se la traga el bloque', async () => {
  /* `textoPlanoOoxml` sólo lee los `<w:t>`, así que un párrafo con sólo una ecuación le parece
     vacío y `localizarBloqueTabla` lo contaba como hueco de maquetación: al sustituir la tabla,
     la ecuación se iba con ella. */
  const buf = await plantilla([
    parrafo('Tabla 1. Composición accionaria'),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [new TableRow({ children: [new TableCell({ children: [parrafo('a')] })] })],
    }),
  ]);
  const conEcuacion = docDe(new PizZip(buf))
    .replace('<w:tbl>', ooxmlDeFormula(FORMULA_AR) + '<w:tbl>');
  assert.ok(conEcuacion.includes('<m:oMath>'), 'el montaje del test no insertó la ecuación');

  const bloque = localizarBloqueTabla(conEcuacion, 'Composición accionaria');
  assert.strictEqual(bloque, null, 'el bloque de la tabla se tragó el párrafo de la ecuación');
});

/* ══════════════════ Numeración de los anexos: multiempresa ══════════════════ */

/* La plantilla de MC Internacional, reducida a lo que importa: los anexos van A, C, D, E, F
   —no hay B—, el índice repite los títulos con su número de página, y los encabezados del
   cuerpo vienen PARTIDOS en varios runs, que es como los deja Word en cuanto alguien los
   edita. Sobre esta forma, el localizador por letra borraba 5,9 MB de `word/document.xml`
   y dejaba un archivo que ni mammoth podía abrir para la vista previa. */
const conAnexosSinB = () => ''
  + '<w:p><w:t>ANEXO A. Estados Financieros52</w:t></w:p>'
  + '<w:p><w:t>ANEXO C. Descripciones de comparables y Estados Financieros86</w:t></w:p>'
  + '<w:p><w:t>ANEXO D. Matriz de Rechazo95</w:t></w:p>'
  + '<w:p><w:t>Cuerpo del informe que no se puede perder.</w:t></w:p>'
  + '<w:p><w:t>ANEXO </w:t><w:t>A. Estados Financieros</w:t></w:p>'
  + '<w:p><w:t>EEFF DEL CLIENTE ANTERIOR</w:t></w:p>'
  + '<w:p><w:t>ANEXO </w:t><w:t>C. Descripciones de comparables y Estados Financieros</w:t></w:p>'
  + '<w:p><w:t>FICHAS DEL CLIENTE ANTERIOR</w:t></w:p>'
  + '<w:p><w:t>ANEXO </w:t><w:t>D. Matriz de Rechazo</w:t></w:p>'
  + '<w:p><w:t>MATRIZ DEL CLIENTE ANTERIOR</w:t></w:p>';

async function zipSinAnexoB() {
  const buf = await plantilla([parrafo('Informe')]);
  const zip = new PizZip(buf);
  zip.file(RUTA_DOC_TEST, zip.file(RUTA_DOC_TEST).asText()
    .replace('</w:body>', conAnexosSinB() + '</w:body>'));
  return zip;
}

test('los anexos se localizan en el cuerpo aunque el título esté partido en runs', async () => {
  const zip = await zipSinAnexoB();
  const xml = zip.file(RUTA_DOC_TEST).asText();
  const anexos = localizarAnexosOoxml(xml);
  assert.deepStrictEqual(anexos.map((a) => a.letra), ['A', 'C', 'D'],
    'los tres del cuerpo, y ninguna entrada del índice');

  const porNombre = anexosDelDocumento(xml);
  assert.strictEqual(porNombre.eeff.letra, 'A');
  assert.strictEqual(porNombre.descripciones.letra, 'C', 'aquí las descripciones son el C');
  assert.strictEqual(porNombre.matriz.letra, 'D', 'y la matriz de rechazo el D');
});

test('el anexo de estados financieros no se lleva el documento cuando no hay ANEXO B', async () => {
  /* La regresión que rompía la vista previa: `bloqueDeAnexo` cerraba en `xml.length` al no
     encontrar «ANEXO B», así que se llevaba `</w:body></w:document>` y todo lo de en medio. */
  const zip = await zipSinAnexoB();
  const antes = zip.file(RUTA_DOC_TEST).asText();
  insertarAnexoA(zip, ESTUDIO_EEFF, {});
  const xml = zip.file(RUTA_DOC_TEST).asText();
  const texto = textoDe(zip, RUTA_DOC_TEST);

  assert.strictEqual(problemaDeIntegridadOoxml(xml), '', 'el documento tiene que seguir cerrando');
  assert.ok(xml.length > antes.length * 0.9, 'y no perder el cuerpo del informe');
  assert.ok(!texto.includes('EEFF DEL CLIENTE ANTERIOR'), 'el anexo se rehace');
  assert.match(texto, /Estado de Situación Financiera/);
  assert.ok(texto.includes('FICHAS DEL CLIENTE ANTERIOR'), 'y el anexo siguiente no se toca');
  assert.ok(texto.includes('MATRIZ DEL CLIENTE ANTERIOR'), 'ni el de después');
  assert.ok(texto.includes('Cuerpo del informe que no se puede perder'), 'ni el cuerpo');
});

test('cada anexo se rellena por su nombre y no por su letra', async () => {
  /* En esta plantilla el ANEXO C son las descripciones y el D la matriz. Buscando la letra,
     las descripciones no se escribían en ninguna parte y la matriz caía sobre el anexo
     equivocado, borrando de paso todo lo que le seguía. */
  const zip = await zipSinAnexoB();
  insertarImagenesAnexoB(zip, {
    comparables: [{ name: 'ACME COMPARABLE SA', descActividad: 'Desarrolla videojuegos.' }],
  });
  insertarAnexoC(zip, ESTUDIO_ANEXO_C);
  const texto = textoDe(zip, RUTA_DOC_TEST);

  assert.ok(texto.includes('ACME COMPARABLE SA'), 'las descripciones van al anexo C de esta plantilla');
  assert.ok(!texto.includes('FICHAS DEL CLIENTE ANTERIOR'));
  assert.ok(texto.includes('RIGOR UNO'), 'y la matriz al D');
  assert.ok(!texto.includes('MATRIZ DEL CLIENTE ANTERIOR'));
  assert.strictEqual(problemaDeIntegridadOoxml(zip.file(RUTA_DOC_TEST).asText()), '');
});

test('los rótulos conservan la letra de la plantilla', async () => {
  /* Escribir «ANEXO B. Descripciones…» en un informe que numera A, C, D deja el cuerpo
     contradiciendo a su propio índice. Lo que sí se reescribe es el nombre del
     contribuyente, que en la plantilla es el del cliente anterior. */
  const zip = await zipSinAnexoB();
  insertarAnexoA(zip, ESTUDIO_EEFF, {});
  insertarImagenesAnexoB(zip, { comparables: [{ name: 'ACME SA', descActividad: 'x' }] });
  insertarAnexoC(zip, ESTUDIO_ANEXO_C);
  const texto = textoDe(zip, RUTA_DOC_TEST);

  assert.match(texto, /ANEXO A\. Estados financieros ACME COLOMBIA S\.A\.S/);
  assert.match(texto, /ANEXO C\. Descripciones de comparables/);
  assert.match(texto, /ANEXO D\. Matriz de Rechazo/);
  assert.ok(!/ANEXO B\./.test(texto), 'no se inventa un ANEXO B que esta plantilla no tiene');
});

test('el índice con campos PAGEREF no se toma por el encabezado del anexo', async () => {
  /* Así trae Word la tabla de contenido, y es donde anclaba el localizador viejo: el anexo
     se rellenaba al 4 % del documento y el de verdad se radicaba con los datos anteriores. */
  const buf = await plantilla([parrafo('Informe')]);
  const zip = new PizZip(buf);
  const indice = '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r>'
    + '<w:r><w:instrText> PAGEREF _Toc123 \\h </w:instrText></w:r>'
    + '<w:r><w:t>ANEXO A. Estados financieros</w:t></w:r>'
    + '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>';
  zip.file(RUTA_DOC_TEST, zip.file(RUTA_DOC_TEST).asText()
    .replace('</w:body>', indice + conAnexoA() + '</w:body>'));

  const anexos = localizarAnexosOoxml(zip.file(RUTA_DOC_TEST).asText());
  assert.deepStrictEqual(anexos.map((a) => a.letra), ['A', 'B'], 'solo los del cuerpo');
  insertarAnexoA(zip, ESTUDIO_EEFF, {});
  assert.match(textoDe(zip, RUTA_DOC_TEST), /ANEXO A\. Estados financieros<?/);
  assert.ok(!textoDe(zip, RUTA_DOC_TEST).includes('páginas del informe anterior'));
});

test('un anexo que la plantilla no trae se avisa en vez de romper nada', async () => {
  const buf = await plantilla([parrafo('Informe sin anexos')]);
  const zip = new PizZip(buf);
  const antes = zip.file(RUTA_DOC_TEST).asText();
  const avisos = [];

  insertarAnexoA(zip, ESTUDIO_EEFF, { avisos });
  insertarImagenesAnexoB(zip, { comparables: [{ name: 'ACME SA', descActividad: 'x' }] }, avisos);

  assert.strictEqual(zip.file(RUTA_DOC_TEST).asText(), antes, 'el documento no se toca');
  assert.strictEqual(avisos.length, 2, 'y los dos anexos se reportan');
  assert.match(avisos.join(' | '), /Estados financieros del contribuyente/);
  assert.match(avisos.join(' | '), /Descripciones de comparables/);
});

/* ══════════════════ Guarda de integridad ══════════════════ */

test('la guarda reconoce un documento bien cerrado y uno partido', () => {
  const bueno = '<w:document><w:body><w:p><w:pPr/><w:t>x</w:t></w:p></w:body></w:document>';
  assert.strictEqual(problemaDeIntegridadOoxml(bueno), '');

  assert.match(problemaDeIntegridadOoxml('<w:document><w:body><w:p><w:t>x</w:t>'),
    /no cierra una sola vez/, 'lo que dejaba el corte hasta xml.length');
  assert.match(problemaDeIntegridadOoxml(
    '<w:document><w:body><w:p><w:p><w:t>x</w:t></w:p></w:body></w:document>'),
    /<w:p> sin cerrar/, 'el párrafo anidado que Word declara dañado');
  assert.match(problemaDeIntegridadOoxml(
    '<w:document><w:body><w:p/></w:p></w:body></w:document>'),
    /sobran 1 <\/w:p>/, 'y el cierre de más');
});

test('una cirugía que rompería el documento no se aplica y se avisa', async () => {
  /* La red de seguridad: antes, un corte mal calculado producía un .docx del que mammoth solo
     sabía decir «Hierarchy request error», y eso era todo lo que llegaba a quien radica. */
  const zip = await zipConAnexoA();
  const roto = zip.file(RUTA_DOC_TEST).asText().replace('</w:body></w:document>', '');
  zip.file(RUTA_DOC_TEST, roto);
  const avisos = [];

  const { insertadas } = insertarAnexoA(zip, ESTUDIO_EEFF, { avisos });
  assert.strictEqual(insertadas, 0);
  assert.strictEqual(zip.file(RUTA_DOC_TEST).asText(), roto, 'no se escribe nada encima');
  assert.match(avisos.join(' '), /no se pudo reescribir sin romper el documento/);
});

/* ── Estilo de las tablas que esta ruta genera de cero ──
   `generarTablaOoxml` arma las tablas del .docx cuando la plantilla es un .docx (Tablas 3/12,
   15, 16, 19, 20, rango, anexos B y C, datos macro). Es el tercer emisor del informe, junto al
   CSS de `estiloDocumento.js` y el writer de `docxWriter.js`, y los tres tienen que decir lo
   mismo: si uno se queda atrás, el cliente ve una tabla distinta según por qué ruta salió su
   informe, que es exactamente el fallo que este proyecto ya pagó cuatro veces. */

const tablaDe = (xml) => /<w:tbl>[\s\S]*?<\/w:tbl>/.exec(xml)[0];

test('la tabla generada lleva la rejilla negra completa, no media rejilla gris', () => {
  /* `left`, `right` e `insideV` eran `<w:val="none"/>`: la tabla salía sin bordes verticales,
     mientras el previo los pintaba. El modelo del usuario (2026-08-19) lleva rejilla completa
     en negro, con el contorno más grueso. En octavos de punto: 1px = 6, 1,5px = 12. */
  const tbl = tablaDe(generarTablaOoxml('T', ['A', 'B'], [['1', '2']]));
  const bordes = /<w:tblBorders>([\s\S]*?)<\/w:tblBorders>/.exec(tbl)[1];
  for (const [lados, sz] of [[['top', 'bottom', 'left', 'right'], '12'], [['insideH', 'insideV'], '6']]) {
    for (const lado of lados) {
      assert.match(bordes, new RegExp('<w:' + lado + ' w:val="single" w:sz="' + sz +
        '" w:space="0" w:color="000000"/>'), 'el borde ' + lado + ' no es el del modelo');
    }
  }
  assert.doesNotMatch(bordes, /none/, 'quedan lados sin borde');
  assert.doesNotMatch(tbl, /E2E8F0/, 'queda el gris claro viejo');
});

test('la cabecera de la tabla generada va gris con letra negra', () => {
  const tbl = tablaDe(generarTablaOoxml('T', ['Concepto'], [['dato']]));
  assert.match(tbl, /<w:shd w:val="clear" w:color="auto" w:fill="999999"\/>/);
  assert.match(tbl, /<w:color w:val="000000"\/>/);
  assert.doesNotMatch(tbl, /0E1726/, 'queda el fondo oscuro viejo');
  assert.doesNotMatch(tbl, /FFFFFF/, 'queda la letra blanca vieja');
});

test('las celdas de la tabla generada van centradas y en Arial 10pt', () => {
  /* Antes iban `w:jc w:val="left"` y sin tipografía propia, así que heredaban el cuerpo del
     documento: la misma tabla salía a 12 pt en un informe y a 10 en otro. */
  const tbl = tablaDe(generarTablaOoxml('T', ['Concepto'], [['dato']]));
  assert.equal((tbl.match(/<w:jc w:val="center"\/>/g) || []).length, 2,
    'cabecera y dato tienen que ir centrados los dos');
  assert.doesNotMatch(tbl, /w:val="left"/, 'queda una celda alineada a la izquierda');
  assert.equal((tbl.match(/<w:vAlign w:val="center"\/>/g) || []).length, 2,
    'las dos celdas van centradas en vertical');
  assert.equal((tbl.match(/<w:rFonts w:ascii="Arial" w:hAnsi="Arial"\/>/g) || []).length, 2);
  assert.equal((tbl.match(/<w:sz w:val="20"\/>/g) || []).length, 2);
});

test('la tabla generada respeta el aire de celda del modelo', () => {
  /* `padding:5px 6px` en twips. Word trae 108 a los lados y CERO arriba y abajo por defecto,
     así que sin esto las filas del archivo salen más apretadas que las del previo. */
  const tbl = tablaDe(generarTablaOoxml('T', ['A'], [['1']]));
  const mar = /<w:tblCellMar>([\s\S]*?)<\/w:tblCellMar>/.exec(tbl);
  assert.ok(mar, 'la tabla no declara márgenes de celda');
  assert.match(mar[1], /<w:top w:w="75" w:type="dxa"\/>/);
  assert.match(mar[1], /<w:left w:w="90" w:type="dxa"\/>/);
  assert.match(mar[1], /<w:bottom w:w="75" w:type="dxa"\/>/);
  assert.match(mar[1], /<w:right w:w="90" w:type="dxa"\/>/);
});

/* ══════ Mayúsculas ══════
   Requisito del usuario (2026-08-19): la tabla de márgenes, la de la muestra y el ANEXO C
   entero se publican en mayúscula, encabezados incluidos. La «Tabla 16. Razones de rechazo»
   queda fuera, y es la razón de que esto no se aplique dentro de `generarTablaOoxml`: ahí
   subiría TODA tabla del informe. Sube quien arma las filas, tabla por tabla. */

const ESTUDIO_MIXTO_DOCX = {
  anio: 2025, ent: 'ACME COLOMBIA SAS', pli: 'MO', cmode: 'all',
  t_s: 10000, t_c: 7000, t_op: 2000,
  embudoSeleccion: { evaluadas: 100, seleccionadas: 2, reserva: 0, porMotivo: { holding: 30 } },
  comparables: [
    { name: 'Zeta Comparable Ltd', amb: 'Int', s: 5000, c: 3500, op: 900 },
    { name: 'Omega Comparable Plc', amb: 'Int', s: 8000, c: 5600, op: 1600 },
  ],
};

test('.docx: la muestra y los márgenes se emiten en mayúscula, encabezado incluido', () => {
  const xml = conTabla('<w:p><w:t>Tabla 17. Muestra Compañías comparables</w:t></w:p>')
    + conTabla('<w:p><w:t>Tabla 19. Margen Operacional Compañías Comparables</w:t></w:p>');
  const texto = textoPlanoOoxml(actualizarTablasOperacionesOoxml(xml, ESTUDIO_MIXTO_DOCX));
  assert.match(texto, /ZETA COMPARABLE LTD/, 'la razón social no subió');
  assert.ok(!texto.includes('Zeta Comparable Ltd'));
  assert.match(texto, /OMEGA COMPARABLE PLC/);
  /* El encabezado que emite esta ruta: `['Número', 'Nombre de la Compañía', 'Ámbito']`. */
  assert.match(texto, /NOMBRE DE LA COMPAÑÍA/, 'el encabezado de la muestra no subió');
  assert.ok(!texto.includes('Nombre de la Compañía'));
});

test('.docx: las razones de rechazo NO se pasan a mayúscula', () => {
  /* La excepción que pidió el usuario, con su propio test: una excepción sin test es una
     regla que alguien va a "arreglar" el día que le parezca inconsistente. */
  const xml = conTabla('<w:p><w:t>Tabla 16. Razones de rechazo</w:t></w:p>');
  const texto = textoPlanoOoxml(actualizarTablasOperacionesOoxml(xml, ESTUDIO_MIXTO_DOCX));
  assert.match(texto, /Compañías holding o de grupo/, 'la razón de rechazo se pasó a mayúscula');
});

test('coleccionesDelEstudio sube las comparables y deja las razones como están', () => {
  /* Estas colecciones alimentan el bucle de la plantilla .docx marcada (`envolverTablaEnBucle`),
     que es una TERCERA ruta hacia la misma tabla de comparables: sin esto, el informe salía en
     mayúscula por dos caminos y en caja mixta por el otro. */
  const { comparables, razonesRechazo } = coleccionesDelEstudio(ESTUDIO_MIXTO_DOCX);
  assert.strictEqual(comparables[0].nombre, 'ZETA COMPARABLE LTD');
  assert.strictEqual(comparables[0].ambito, 'INTERNACIONAL');
  assert.ok(razonesRechazo.length, 'el estudio de prueba tiene que traer razones');
  assert.match(razonesRechazo[0].criterio, /[a-záéíóúñ]/,
    'las razones de rechazo tienen que conservar su caja mixta');
});

test('el ANEXO C del .docx se emite entero en mayúscula', async () => {
  const zip = await zipConAnexoC();
  insertarAnexoC(zip, {
    embudoSeleccion: { evaluadas: 3, seleccionadas: 1, reserva: 0, porMotivo: { holding: 1 } },
    matrizRechazo: {
      universo: 3,
      porMotivo: { holding: ['Holding Uno Sa'], aceptadas: ['Zeta Comparable Ltd'] },
    },
  });
  const texto = textoDe(zip, RUTA_DOC_TEST);
  assert.ok(texto.includes('HOLDING UNO SA'), 'la razón social del listado no subió');
  assert.ok(!texto.includes('Holding Uno Sa'));
  assert.ok(texto.includes('ZETA COMPARABLE LTD'));
  /* Y el encabezado del listado, que esta ruta emite como `['Nº', 'NOMBRE DE LA COMPAÑÍA', …]`. */
  assert.ok(texto.includes('NOMBRE DE LA COMPAÑÍA'));
});
