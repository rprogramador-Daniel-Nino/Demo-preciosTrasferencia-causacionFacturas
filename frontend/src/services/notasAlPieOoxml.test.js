import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  idsDeNotas, siguienteIdDeNota, notaAlPieOoxml, referenciaDeNotaOoxml, agregarNotasAlPie,
  relsDeNotasAlPie, idsDeRelacionLibres, contentTypesConNotasAlPie, relsDocumentoConNotasAlPie,
  estilosDeNota, anclarEnUltimoParrafo, crearRecolectorDeNotas,
} from './notasAlPieOoxml.js';

/* Un `footnotes.xml` como el de la plantilla de END GAME: los dos separadores —con `w:type`
   DELANTE del `w:id`— y seis notas de contenido. */
const FOOTNOTES_PLANTILLA = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
  + '<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>'
  + '<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>'
  + [1, 2, 3, 4, 5, 6].map((i) =>
    `<w:footnote w:id="${i}"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t>nota ${i}</w:t></w:r></w:p></w:footnote>`).join('')
  + '</w:footnotes>';

const ESTILOS = { textoNota: 'Textonotapie', refNota: 'Refdenotaalpie', hipervinculo: 'Hipervnculo' };

test('los ids se leen aunque el separador lleve w:type antes del w:id', () => {
  /* Es el orden que escribe Word y el que tumbaba un patrón que exigiera `w:id` pegado. */
  assert.deepStrictEqual(idsDeNotas(FOOTNOTES_PLANTILLA), [-1, 0, 1, 2, 3, 4, 5, 6]);
});

test('el id nuevo continúa desde el mayor existente', () => {
  assert.strictEqual(siguienteIdDeNota(FOOTNOTES_PLANTILLA), 7);
  /* Repetir un id ya usado hace que Word declare el documento dañado. */
  assert.ok(!idsDeNotas(FOOTNOTES_PLANTILLA).includes(7));
});

test('sin archivo previo la primera nota de contenido es la 1', () => {
  assert.strictEqual(siguienteIdDeNota(''), 1);
  assert.strictEqual(siguienteIdDeNota(null), 1);
});

test('la nota lleva el número, la cita y el enlace como hipervínculo', () => {
  const xml = notaAlPieOoxml({
    id: 7,
    cita: 'DANE. (s.f.). Producción industrial. Recuperado de https://www.dane.gov.co/x',
    url: 'https://www.dane.gov.co/x',
    idRel: 'rIdNota1',
  }, ESTILOS);

  assert.match(xml, /^<w:footnote w:id="7">/);
  assert.match(xml, /<w:footnoteRef\/>/, 'el número lo pone Word, no el generador');
  assert.ok(!/>7</.test(xml), 'no se escribe el número a mano');
  assert.match(xml, /<w:pStyle w:val="Textonotapie"\/>/);
  assert.match(xml, /<w:rStyle w:val="Refdenotaalpie"\/>/);
  assert.match(xml, /<w:hyperlink r:id="rIdNota1" w:history="1">/);
  assert.match(xml, /<w:t xml:space="preserve">https:\/\/www\.dane\.gov\.co\/x<\/w:t>/);
  /* El texto anterior a la URL va aparte, sin enlazar. */
  assert.match(xml, /DANE\. \(s\.f\.\)\. Producción industrial\. Recuperado de /);
});

test('sin relación el enlace se ve como enlace pero no se inventa un r:id', () => {
  const xml = notaAlPieOoxml({
    id: 7, cita: 'DANE. (s.f.). X. Recuperado de https://d.co/x', url: 'https://d.co/x',
  }, ESTILOS);

  assert.ok(!/<w:hyperlink/.test(xml), 'sin r:id no se emite el hipervínculo');
  assert.match(xml, /<w:color w:val="0563C1"\/><w:u w:val="single"\/>/, 'pero sí su aspecto');
});

test('sin los estilos de la plantilla la nota conserva el aspecto por formato directo', () => {
  const xml = notaAlPieOoxml({ id: 3, cita: 'DANE. (2025). X.' }, {});
  assert.ok(!/w:pStyle/.test(xml), 'no se impone un estilo que la plantilla no tiene');
  assert.match(xml, /<w:sz w:val="16"\/>/, 'y el tamaño de nota se aplica igual');
});

test('una URL que no está al final de la cita no se parte', () => {
  /* Puede aparecer citada dentro del título; cortar por dentro dejaría la cita partida. */
  const cita = 'Medio. (2025). Sobre https://otra.com/x y su impacto.';
  const xml = notaAlPieOoxml({ id: 4, cita, url: 'https://otra.com/x', idRel: 'r1' }, ESTILOS);

  assert.ok(!/<w:hyperlink/.test(xml), 'no se enlaza lo que no cierra la cita');
  assert.match(xml, /Sobre https:\/\/otra\.com\/x y su impacto\./);
});

test('una cita vacía no produce nota', () => {
  assert.strictEqual(notaAlPieOoxml({ id: 7, cita: '' }, ESTILOS), '');
  assert.strictEqual(notaAlPieOoxml({ id: 7, cita: '   ' }, ESTILOS), '');
  assert.strictEqual(notaAlPieOoxml(null, ESTILOS), '');
});

test('el & de la cita se escapa', () => {
  const xml = notaAlPieOoxml({ id: 7, cita: "Standard & Poor's. (2025). X." }, ESTILOS);
  assert.match(xml, /Standard &amp; Poor/);
  assert.deepStrictEqual(xml.match(/&(?!amp;|lt;|gt;|quot;|apos;|#)/g) || [], []);
});

test('la referencia del cuerpo apunta a la nota y va en superíndice', () => {
  const ref = referenciaDeNotaOoxml(7, ESTILOS);
  assert.match(ref, /<w:footnoteReference w:id="7"\/>/);
  assert.match(ref, /<w:vertAlign w:val="superscript"\/>/);
  assert.match(ref, /<w:rStyle w:val="Refdenotaalpie"\/>/);
});

test('las notas nuevas se añaden conservando las de la plantilla', () => {
  const nueva = notaAlPieOoxml({ id: 7, cita: 'DANE. (2025). X.' }, ESTILOS);
  const xml = agregarNotasAlPie(FOOTNOTES_PLANTILLA, [nueva]);

  assert.strictEqual(idsDeNotas(xml).length, 9, 'las ocho de antes más la nueva');
  assert.match(xml, /nota 6[\s\S]*w:id="7"/, 'la nueva va al final');
  assert.match(xml, /<\/w:footnotes>$/, 'y el archivo queda bien cerrado');
});

test('si la plantilla no traía footnotes.xml se crea con sus separadores', () => {
  const nueva = notaAlPieOoxml({ id: 1, cita: 'DANE. (2025). X.' }, {});
  const xml = agregarNotasAlPie('', [nueva]);

  assert.match(xml, /^<\?xml version="1\.0"/);
  assert.match(xml, /w:type="separator" w:id="-1"/, 'la línea que separa las notas del cuerpo');
  assert.match(xml, /w:type="continuationSeparator" w:id="0"/);
  assert.match(xml, /<w:footnote w:id="1">/);
  assert.match(xml, /<\/w:footnotes>$/);
});

test('sin notas nuevas el archivo no se toca', () => {
  assert.strictEqual(agregarNotasAlPie(FOOTNOTES_PLANTILLA, []), FOOTNOTES_PLANTILLA);
  assert.strictEqual(agregarNotasAlPie(FOOTNOTES_PLANTILLA, ['']), FOOTNOTES_PLANTILLA);
});

test('las relaciones de los enlaces se crean si el archivo no existe', () => {
  const rels = relsDeNotasAlPie('', [{ idRel: 'rIdNota1', url: 'https://d.co/x' }]);
  assert.match(rels, /<Relationships xmlns="http:\/\/schemas\.openxmlformats\.org\/package/);
  assert.match(rels, /Id="rIdNota1"/);
  assert.match(rels, /TargetMode="External"/);
  assert.match(rels, /Target="https:\/\/d\.co\/x"/);
});

test('las relaciones se añaden a las que ya hubiera', () => {
  const previo = '<?xml version="1.0"?><Relationships xmlns="x">'
    + '<Relationship Id="rId1" Type="t" Target="a"/></Relationships>';
  const rels = relsDeNotasAlPie(previo, [{ idRel: 'rIdNota1', url: 'https://d.co/x' }]);
  assert.match(rels, /Id="rId1"/, 'la que ya estaba sigue ahí');
  assert.match(rels, /Id="rIdNota1"/);
});

test('los r:id nuevos no chocan con los usados', () => {
  const previo = '<Relationships><Relationship Id="rIdNota1" Type="t" Target="a"/></Relationships>';
  assert.deepStrictEqual(idsDeRelacionLibres(previo, 2), ['rIdNota2', 'rIdNota3']);
  assert.deepStrictEqual(idsDeRelacionLibres('', 3), ['rIdNota1', 'rIdNota2', 'rIdNota3']);
  assert.deepStrictEqual(idsDeRelacionLibres('', 0), []);
});

test('la parte de notas se declara en Content_Types una sola vez', () => {
  const ct = '<?xml version="1.0"?><Types xmlns="x"><Override PartName="/word/document.xml" ContentType="d"/></Types>';
  const conNotas = contentTypesConNotasAlPie(ct);
  assert.match(conNotas, /PartName="\/word\/footnotes\.xml"/);
  assert.match(conNotas, /footnotes\+xml/);
  /* Idempotente: si ya estaba, no se duplica. */
  assert.strictEqual(contentTypesConNotasAlPie(conNotas), conNotas);
});

test('footnotes.xml se relaciona desde el documento una sola vez', () => {
  const rels = '<?xml version="1.0"?><Relationships xmlns="x">'
    + '<Relationship Id="rId1" Type="otro" Target="styles.xml"/></Relationships>';
  const con = relsDocumentoConNotasAlPie(rels, 'rIdNotasParte');
  assert.match(con, /Target="footnotes\.xml"/);
  assert.match(con, /relationships\/footnotes/);
  assert.strictEqual(relsDocumentoConNotasAlPie(con, 'rIdOtro'), con, 'no se añade dos veces');
});

test('los estilos de nota se toman de la plantilla, en español o en inglés', () => {
  const es = '<w:style w:styleId="Textonotapie"/><w:style w:styleId="Refdenotaalpie"/>'
    + '<w:style w:styleId="Hipervnculo"/>';
  assert.deepStrictEqual(estilosDeNota(es), {
    textoNota: 'Textonotapie', refNota: 'Refdenotaalpie', hipervinculo: 'Hipervnculo',
  });

  const en = '<w:style w:styleId="FootnoteText"/><w:style w:styleId="FootnoteReference"/>'
    + '<w:style w:styleId="Hyperlink"/>';
  assert.deepStrictEqual(estilosDeNota(en), {
    textoNota: 'FootnoteText', refNota: 'FootnoteReference', hipervinculo: 'Hyperlink',
  });

  /* Una plantilla sin ellos: cadena vacía, y la nota se emite con formato directo. */
  assert.deepStrictEqual(estilosDeNota('<w:styles/>'),
    { textoNota: '', refNota: '', hipervinculo: '' });
});

test('la referencia se ancla al final del último párrafo, no en uno propio', () => {
  /* El número tiene que ir donde se afirma el dato: un párrafo con solo números deja el cuerpo
     del informe con cifras huérfanas. */
  const parrafos = '<w:p><w:r><w:t>Primero.</w:t></w:r></w:p>'
    + '<w:p><w:r><w:t>Y el último.</w:t></w:r></w:p>';
  const salida = anclarEnUltimoParrafo(parrafos, '<w:r>REF</w:r>');

  assert.match(salida, /Y el último\.<\/w:t><\/w:r><w:r>REF<\/w:r><\/w:p>$/);
  assert.strictEqual((salida.match(/<w:p>/g) || []).length, 2, 'no crea párrafos');
});

test('sin párrafos donde anclar el fragmento no se toca', () => {
  assert.strictEqual(anclarEnUltimoParrafo('', '<w:r>REF</w:r>'), '');
  assert.strictEqual(anclarEnUltimoParrafo('texto suelto', '<w:r>REF</w:r>'), 'texto suelto');
  const p = '<w:p><w:r><w:t>x</w:t></w:r></w:p>';
  assert.strictEqual(anclarEnUltimoParrafo(p, ''), p, 'sin run no cambia nada');
});

test('el recolector numera desde el primer id libre y acumula las notas', () => {
  const recolector = crearRecolectorDeNotas({
    idInicial: 7,
    estilos: { textoNota: 'Textonotapie', refNota: 'Refdenotaalpie' },
  });

  const ref1 = recolector.referencia("DANE. (2025). PIB. Recuperado de https://dane.gov.co/pib", 'https://dane.gov.co/pib');
  const ref2 = recolector.referencia('Banco de la República. (s.f.). Inflación.');

  assert.match(ref1, /w:id="7"/);
  assert.match(ref2, /w:id="8"/, 'la segunda continúa la numeración');
  assert.strictEqual(recolector.cuantas(), 2);

  const notas = recolector.notasXml();
  assert.match(notas[0], /<w:footnote w:id="7">/);
  assert.match(notas[0], /<w:hyperlink r:id="rIdNota1"/, 'la que tiene URL lleva su relación');
  assert.ok(!/<w:hyperlink/.test(notas[1]), 'la que no tiene URL, no');

  assert.deepStrictEqual(recolector.enlaces(),
    [{ idRel: 'rIdNota1', url: 'https://dane.gov.co/pib' }]);
});

test('una cita vacía no consume número ni ancla nada', () => {
  /* Si no hay fuente que citar, el cuerpo no puede quedar con un número que no lleva a ninguna
     nota. */
  const recolector = crearRecolectorDeNotas({ idInicial: 3 });

  assert.strictEqual(recolector.referencia(''), '');
  assert.strictEqual(recolector.referencia('   '), '');
  assert.strictEqual(recolector.referencia(null), '');
  assert.strictEqual(recolector.cuantas(), 0);

  /* Y la siguiente cita real se queda con el id 3, que no se gastó. */
  assert.match(recolector.referencia('DANE. (2025). X.'), /w:id="3"/);
});

test('los r:id del recolector arrancan donde le digan, para no chocar', () => {
  const recolector = crearRecolectorDeNotas({ idInicial: 1, inicioRel: 5 });
  recolector.referencia('A. (2025). X. Recuperado de https://a.co', 'https://a.co');
  recolector.referencia('B. (2025). Y. Recuperado de https://b.co', 'https://b.co');

  assert.deepStrictEqual(recolector.enlaces().map((e) => e.idRel), ['rIdNota5', 'rIdNota6']);
});

test('una URL que no cierra la cita no reserva relación', () => {
  /* Si no se va a enlazar, no puede quedar un Relationship apuntando a ninguna parte. */
  const recolector = crearRecolectorDeNotas({ idInicial: 1 });
  recolector.referencia('Medio. (2025). Habla de https://x.co y otras cosas.', 'https://x.co');

  assert.strictEqual(recolector.cuantas(), 1, 'la nota sí se publica');
  assert.deepStrictEqual(recolector.enlaces(), [], 'pero sin relación huérfana');
});

test('una raíz auto-cerrada también admite las relaciones nuevas', () => {
  /* Un archivo de relaciones sin ninguna relación se escribe `<Relationships …/>`, sin etiqueta
     de cierre. Buscando solo `</Relationships>` la relación se perdía en silencio y el enlace de
     la cita no apuntaba a nada: lo cazó la prueba de integración del paquete. */
  const vacio = '<?xml version="1.0" encoding="UTF-8"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>';
  const rels = relsDeNotasAlPie(vacio, [{ idRel: 'rIdNota1', url: 'https://d.co/x' }]);

  assert.match(rels, /Id="rIdNota1"/);
  assert.match(rels, /TargetMode="External"/);
  assert.match(rels, /<\/Relationships>$/, 'la raíz queda abierta y cerrada en regla');
  assert.match(rels, /xmlns="http:\/\/schemas\.openxmlformats\.org\/package/, 'conserva el xmlns');
});

test('un Content_Types con raíz auto-cerrada admite la parte de notas', () => {
  const ct = '<?xml version="1.0"?><Types xmlns="http://x"/>';
  const conNotas = contentTypesConNotasAlPie(ct);
  assert.match(conNotas, /PartName="\/word\/footnotes\.xml"/);
  assert.match(conNotas, /<\/Types>$/);
});

test('el documento relaciona footnotes.xml aunque su rels venga auto-cerrado', () => {
  const rels = '<?xml version="1.0"?><Relationships xmlns="http://x"/>';
  const con = relsDocumentoConNotasAlPie(rels, 'rIdNotasAlPie');
  assert.match(con, /Target="footnotes\.xml"/);
  assert.match(con, /<\/Relationships>$/);
});
