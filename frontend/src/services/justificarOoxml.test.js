/* Tests de la justificación del cuerpo en la ruta de plantilla .docx.

   Los casos no son inventados: salen de las dos plantillas reales del repositorio, que
   fallan por causas distintas —END GAME trae 339 párrafos sin `w:jc` y un estilo `Normal`
   que tampoco lo declara; MC INTERNACIONAL trae 30 con `w:jc="left"` explícito—. Y las
   exclusiones también: el índice con sus PAGEREF, los títulos con `w:outlineLvl`, la
   portada centrada y las tablas, que van centradas por decisión del usuario. */

import { test } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { DOMParser } from '@xmldom/xmldom';
import { justificarCuerpoOoxml, estilosNoJustificables } from './justificarOoxml.js';

const STYLES = `<w:styles>
  <w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Ttulo1"><w:name w:val="heading 1"/>
    <w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="TDC1"><w:name w:val="toc 1"/></w:style>
  <w:style w:type="paragraph" w:styleId="TDC3"><w:name w:val="toc 3"/></w:style>
  <w:style w:type="paragraph" w:styleId="Textoindependiente"><w:name w:val="Body Text"/></w:style>
</w:styles>`;

const jcDe = (xml) => (/<w:jc w:val="(\w+)"/.exec(xml) || [])[1];
const p = (interior) => `<w:p>${interior}</w:p>`;
const conTexto = (t) => `<w:r><w:t>${t}</w:t></w:r>`;

/* ══════ Lo que se justifica ══════ */

test('un párrafo sin w:jc recibe la justificación: el caso de END GAME', () => {
  /* 339 párrafos de esa plantilla no declaran alineación, y su estilo Normal tampoco, así
     que salían a la izquierda. */
  const xml = p(`<w:pPr><w:pStyle w:val="Normal"/></w:pPr>${conTexto('Prosa del informe.')}`);
  const r = justificarCuerpoOoxml(xml, STYLES);
  assert.strictEqual(r.justificados, 1);
  assert.strictEqual(jcDe(r.xml), 'both');
});

test('un párrafo con w:jc="left" pasa a justificado: el caso de MC INTERNACIONAL', () => {
  const xml = p(`<w:pPr><w:jc w:val="left"/></w:pPr>${conTexto('Prosa del informe.')}`);
  const r = justificarCuerpoOoxml(xml, STYLES);
  assert.strictEqual(r.justificados, 1);
  assert.strictEqual(jcDe(r.xml), 'both');
  assert.ok(!r.xml.includes('w:val="left"'), 'no puede quedar el left viejo');
});

test('«start» es el mismo left en la otra versión del formato', () => {
  const xml = p(`<w:pPr><w:jc w:val="start"/></w:pPr>${conTexto('Prosa.')}`);
  assert.strictEqual(jcDe(justificarCuerpoOoxml(xml, STYLES).xml), 'both');
});

test('un párrafo sin w:pPr recibe uno, y como primer hijo del párrafo', () => {
  /* El esquema no admite propiedades de párrafo después del contenido: si el `w:pPr` se
     cuela detrás del primer `w:r`, Word abre el documento con el aviso de contenido
     ilegible. */
  const xml = p(conTexto('Prosa sin propiedades.'));
  const r = justificarCuerpoOoxml(xml, STYLES);
  assert.strictEqual(r.xml, `<w:p><w:pPr><w:jc w:val="both"/></w:pPr>${conTexto('Prosa sin propiedades.')}</w:p>`);
});

test('un w:pPr vacío se rellena en lugar de duplicarse', () => {
  const xml = `<w:p><w:pPr/>${conTexto('Prosa.')}</w:p>`;
  const r = justificarCuerpoOoxml(xml, STYLES);
  assert.strictEqual((r.xml.match(/<w:pPr/g) || []).length, 1);
  assert.strictEqual(jcDe(r.xml), 'both');
});

test('el estilo de cuerpo de texto del cliente se justifica', () => {
  /* `Textoindependiente` es el estilo con 81 párrafos —50 de ellos de más de 150
     caracteres— que MC INTERNACIONAL usa para su prosa. No tiene outlineLvl y no es índice:
     tiene que entrar. */
  const xml = p(`<w:pPr><w:pStyle w:val="Textoindependiente"/></w:pPr>${conTexto('Prosa larga.')}`);
  assert.strictEqual(jcDe(justificarCuerpoOoxml(xml, STYLES).xml), 'both');
});

/* ══════ Lo que se respeta ══════ */

test('las entradas del índice no se tocan, ni por estilo ni por su campo PAGEREF', () => {
  /* Justificarlas separa el título de sus puntos de relleno y descuadra la columna de
     números de página. */
  const porEstilo = p(`<w:pPr><w:pStyle w:val="TDC3"/></w:pPr>${conTexto('1. Accionistas')}`);
  assert.strictEqual(justificarCuerpoOoxml(porEstilo, STYLES).justificados, 0);

  const porCampo = p('<w:pPr><w:pStyle w:val="Normal"/></w:pPr>'
    + '<w:r><w:instrText xml:space="preserve"> PAGEREF _Toc208930956 \\h </w:instrText></w:r>');
  assert.strictEqual(justificarCuerpoOoxml(porCampo, STYLES).justificados, 0);
});

test('los títulos se reconocen por el outlineLvl de su estilo, no por su nombre', () => {
  const xml = p(`<w:pPr><w:pStyle w:val="Ttulo1"/></w:pPr>${conTexto('INFORMACIÓN GENERAL')}`);
  assert.strictEqual(justificarCuerpoOoxml(xml, STYLES).justificados, 0);
});

test('lo centrado y lo alineado a la derecha se queda como está', () => {
  /* La portada, los pies de tabla, las firmas y las imágenes. Una alineación explícita
     distinta de la izquierda es decisión de quien hizo la plantilla. */
  ['center', 'right', 'end'].forEach((val) => {
    const xml = p(`<w:pPr><w:jc w:val="${val}"/></w:pPr>${conTexto('Tabla 1. Operaciones')}`);
    const r = justificarCuerpoOoxml(xml, STYLES);
    assert.strictEqual(r.justificados, 0, `${val} no debería tocarse`);
    assert.strictEqual(jcDe(r.xml), val);
  });
});

test('los párrafos de las tablas se quedan centrados', () => {
  const xml = '<w:tbl><w:tr><w:tc>'
    + p(`<w:pPr><w:jc w:val="center"/></w:pPr>${conTexto('23.741.367.744')}`)
    + p(conTexto('sin jc, dentro de la celda'))
    + '</w:tc></w:tr></w:tbl>';
  const r = justificarCuerpoOoxml(xml, STYLES);
  assert.strictEqual(r.justificados, 0);
  assert.strictEqual(r.xml, xml, 'la tabla sale intacta');
});

test('una tabla anidada no deja fuera el resto de la tabla que la contiene', () => {
  /* El ANEXO B anida una tabla por comparable: buscando el primer `</w:tbl>` se cerraría
     la región en la tabla interna y los párrafos posteriores de la externa —celdas de
     cifras— se justificarían. */
  const xml = '<w:tbl><w:tr><w:tc>'
    + '<w:tbl><w:tr><w:tc>' + p(conTexto('interna')) + '</w:tc></w:tr></w:tbl>'
    + p(conTexto('sigue en la celda externa'))
    + '</w:tc></w:tr></w:tbl>';
  const r = justificarCuerpoOoxml(xml, STYLES);
  assert.strictEqual(r.justificados, 0);
  assert.strictEqual(r.xml, xml);
});

/* ══════ El orden que exige el esquema ══════ */

test('el w:jc se inserta antes del w:rPr, no al final del w:pPr', () => {
  /* `w:pPr` es una secuencia ordenada (CT_PPr): un `w:jc` detrás del `w:rPr` produce un
     documento que Word rechaza al abrir. */
  const xml = p('<w:pPr><w:pStyle w:val="Normal"/><w:spacing w:after="120"/>'
    + '<w:rPr><w:b/></w:rPr></w:pPr>' + conTexto('Prosa.'));
  const r = justificarCuerpoOoxml(xml, STYLES);
  assert.ok(r.xml.indexOf('<w:jc') < r.xml.indexOf('<w:rPr'), 'el jc va antes del rPr');
  assert.ok(r.xml.indexOf('<w:spacing') < r.xml.indexOf('<w:jc'), 'y después del spacing');
});

test('el w:jc se inserta antes del sectPr de un párrafo de fin de sección', () => {
  const xml = p('<w:pPr><w:sectPr><w:pgSz w:w="12240"/></w:sectPr></w:pPr>' + conTexto('x'));
  const r = justificarCuerpoOoxml(xml, STYLES);
  assert.ok(r.xml.indexOf('<w:jc') < r.xml.indexOf('<w:sectPr'));
});

test('respeta el sitio del w:ind y del w:numPr de una lista', () => {
  const xml = p('<w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr>'
    + '<w:ind w:left="720"/></w:pPr>' + conTexto('viñeta con prosa larga'));
  const r = justificarCuerpoOoxml(xml, STYLES);
  assert.ok(r.xml.indexOf('<w:ind') < r.xml.indexOf('<w:jc'), 'el jc va después del ind');
  assert.strictEqual(jcDe(r.xml), 'both');
});

/* ══════ Idempotencia y forma ══════ */

test('sobre un párrafo ya justificado no cambia nada', () => {
  const xml = p(`<w:pPr><w:jc w:val="both"/></w:pPr>${conTexto('Ya estaba.')}`);
  const r = justificarCuerpoOoxml(xml, STYLES);
  assert.strictEqual(r.justificados, 0);
  assert.strictEqual(r.xml, xml);
});

test('aplicarlo dos veces da el mismo resultado que una', () => {
  const xml = p(`<w:pPr><w:pStyle w:val="Normal"/></w:pPr>${conTexto('Prosa.')}`);
  const una = justificarCuerpoOoxml(xml, STYLES).xml;
  const dos = justificarCuerpoOoxml(una, STYLES);
  assert.strictEqual(dos.xml, una);
  assert.strictEqual(dos.justificados, 0);
});

test('el resto del documento no se altera ni una coma', () => {
  const xml = '<w:document><w:body>'
    + p(`<w:pPr><w:pStyle w:val="Normal"/></w:pPr>${conTexto('Uno.')}`)
    + '<w:bookmarkStart w:id="1" w:name="x"/>'
    + p(`<w:pPr><w:jc w:val="center"/></w:pPr>${conTexto('Centrado.')}`)
    + '<w:bookmarkEnd w:id="1"/>'
    + '</w:body></w:document>';
  const r = justificarCuerpoOoxml(xml, STYLES);
  assert.strictEqual(r.justificados, 1);
  assert.ok(r.xml.includes('<w:bookmarkStart w:id="1" w:name="x"/>'));
  assert.ok(r.xml.includes('<w:bookmarkEnd w:id="1"/>'));
  assert.ok(r.xml.startsWith('<w:document><w:body>') && r.xml.endsWith('</w:body></w:document>'));
});

test('cuenta los párrafos que cambió, para que el generador pueda decirlo', () => {
  const xml = p(conTexto('a')) + p(conTexto('b'))
    + p(`<w:pPr><w:jc w:val="center"/></w:pPr>${conTexto('c')}`);
  assert.strictEqual(justificarCuerpoOoxml(xml, STYLES).justificados, 2);
});

test('sin XML no revienta', () => {
  assert.deepStrictEqual(justificarCuerpoOoxml('', STYLES), { xml: '', justificados: 0 });
  assert.deepStrictEqual(justificarCuerpoOoxml(null, STYLES), { xml: '', justificados: 0 });
});

test('sin styles.xml sigue funcionando, aunque sin reconocer títulos', () => {
  const xml = p(`<w:pPr><w:pStyle w:val="Normal"/></w:pPr>${conTexto('Prosa.')}`);
  assert.strictEqual(justificarCuerpoOoxml(xml, '').justificados, 1);
});

/* ══════ estilosNoJustificables ══════ */

test('reconoce los títulos por outlineLvl y el índice por su nombre interno', () => {
  const e = estilosNoJustificables(STYLES);
  assert.ok(e.has('Ttulo1'), 'un estilo con outlineLvl es título');
  assert.ok(e.has('TDC1') && e.has('TDC3'), 'los «toc N» son entradas de índice');
  assert.ok(!e.has('Normal'));
  assert.ok(!e.has('Textoindependiente'), 'el cuerpo de texto no se excluye');
});

test('el nombre interno del índice se reconoce en cualquier idioma de Word', () => {
  /* Word guarda «toc 1» en `w:name` sea la instalación española, inglesa o portuguesa; el
     `w:styleId` en cambio cambia (TDC1 / TOC1). Por eso el criterio es el nombre. */
  const otros = `<w:styles>
    <w:style w:styleId="TOC1"><w:name w:val="toc 1"/></w:style>
    <w:style w:styleId="Sumario2"><w:name w:val="toc 2"/></w:style>
    <w:style w:styleId="TocEnMiEmpresa"><w:name w:val="TOC 3"/></w:style>
  </w:styles>`;
  const e = estilosNoJustificables(otros);
  assert.ok(e.has('TOC1') && e.has('Sumario2') && e.has('TocEnMiEmpresa'));
});

test('un estilo cuyo nombre solo contiene «toc» no se confunde con el índice', () => {
  const raro = '<w:styles><w:style w:styleId="X"><w:name w:val="Tocata y fuga"/></w:style></w:styles>';
  assert.ok(!estilosNoJustificables(raro).has('X'));
});

/* ══════ Las plantillas reales del repositorio ══════
   Los casos sintéticos de arriba fijan cada regla; estos dos afirman el resultado sobre los
   documentos que el equipo usa de verdad, que es donde el defecto se vio y donde un
   documento inválido costaría un informe irradicable. Se saltan si el archivo no está en el
   clon, igual que hace `comparablesEngine.test.js` con el export de Capital IQ. */

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const PLANTILLAS = [
  ['END GAME 2024', '../../Archivos Prueba/Informe Local End Game _ 2024_v2.docx'],
  ['MC INTERNACIONAL 2024',
    '../../../Cpanel/public_html/demo-precios-transferencia/Archivos Prueba/MC Internacional/Informe local 2024 MC INTERNACIONAL.docx'],
];

/* Los elementos que el esquema CT_PPr coloca después de `w:jc`. Se repiten aquí a
   propósito, en vez de importarlos: si alguien cambia la lista del servicio, esta prueba
   tiene que seguir afirmando el orden real del formato y no el que el servicio crea. */
const POSTERIORES = ['w:textDirection', 'w:textAlignment', 'w:textboxTightWrap',
  'w:outlineLvl', 'w:divId', 'w:cnfStyle', 'w:rPr', 'w:sectPr', 'w:pPrChange'];

const sinTablas = (xml) => xml.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, '');
const parrafosDe = (xml) => sinTablas(xml).match(/<w:p[ >][\s\S]*?<\/w:p>/g) || [];
const textoDe = (par) => (par.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [])
  .map((t) => t.replace(/<[^>]+>/g, '')).join('').trim();
const alineacionDe = (par) => (/<w:jc w:val="(\w+)"/.exec(par) || [])[1] || null;

async function partesDe(rutaRelativa) {
  const zip = await JSZip.loadAsync(fs.readFileSync(path.resolve(AQUI, rutaRelativa)));
  return {
    doc: await zip.file('word/document.xml').async('string'),
    styles: await zip.file('word/styles.xml').async('string'),
  };
}

PLANTILLAS.forEach(([nombre, rel]) => {
  const ruta = path.resolve(AQUI, rel);

  test(nombre + ': no queda un solo párrafo de prosa sin justificar', { skip: !fs.existsSync(ruta) }, async () => {
    const { doc, styles } = await partesDe(rel);
    const r = justificarCuerpoOoxml(doc, styles);

    const pendientes = parrafosDe(r.xml).filter((par) => {
      const jc = alineacionDe(par);
      return (!jc || jc === 'left') && textoDe(par).length > 0;
    });
    /* Lo que queda tiene que ser índice o título, sin excepción. Un párrafo de prosa aquí
       significa que la plantilla usa una forma de declarar la alineación que este servicio
       no contempla. */
    const prosa = pendientes.filter((par) => !/PAGEREF/.test(par) && textoDe(par).length > 150);
    assert.deepStrictEqual(prosa.map((par) => textoDe(par).slice(0, 80)), [],
      'quedaron párrafos largos sin justificar que no son entradas de índice');
  });

  test(nombre + ': el documento sigue siendo válido y con el orden del esquema', { skip: !fs.existsSync(ruta) }, async () => {
    const { doc, styles } = await partesDe(rel);
    const r = justificarCuerpoOoxml(doc, styles);

    /* Bien formado, con el mismo criterio que aplica `escribirDocSiEsValido` antes de
       guardar el .docx. */
    const errores = [];
    new DOMParser({ onError: (nivel, msg) => { if (nivel !== 'warning') errores.push(msg); } })
      .parseFromString(r.xml, 'text/xml');
    assert.deepStrictEqual(errores, [], 'el XML del documento dejó de ser válido');

    /* Y el `w:jc` en su sitio dentro de cada `w:pPr`: `w:pPr` es una secuencia ordenada, y
       un `w:jc` detrás del `w:rPr` o del `w:sectPr` hace que Word abra el archivo con el
       aviso de contenido ilegible — que es un informe que no se puede radicar. */
    const fueraDeOrden = (r.xml.match(/<w:pPr[ >][\s\S]*?<\/w:pPr>/g) || []).filter((pPr) => {
      const iJc = pPr.indexOf('<w:jc');
      return iJc >= 0 && POSTERIORES.some((t) => {
        const i = pPr.indexOf('<' + t);
        return i >= 0 && i < iJc;
      });
    });
    assert.strictEqual(fueraDeOrden.length, 0,
      fueraDeOrden.length + ' pPr con el w:jc fuera del orden del esquema: ' + (fueraDeOrden[0] || ''));
  });

  test(nombre + ': el índice, los títulos, las tablas y el texto salen intactos', { skip: !fs.existsSync(ruta) }, async () => {
    const { doc, styles } = await partesDe(rel);
    const r = justificarCuerpoOoxml(doc, styles);

    assert.strictEqual((r.xml.match(/<w:p[ >]/g) || []).length, (doc.match(/<w:p[ >]/g) || []).length,
      'no se pierde ni se duplica ningún párrafo');
    assert.deepStrictEqual(parrafosDe(r.xml).map(textoDe), parrafosDe(doc).map(textoDe),
      'el texto del informe no se toca');
    assert.deepStrictEqual(doc.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g), r.xml.match(/<w:tbl>[\s\S]*?<\/w:tbl>/g),
      'las tablas salen centradas, sin cambio alguno');

    const indice = (xml) => parrafosDe(xml).filter((par) => /PAGEREF/.test(par)).map(alineacionDe);
    assert.deepStrictEqual(indice(r.xml), indice(doc),
      'las entradas del índice conservan su alineación: justificarlas descuadra los números de página');

    /* Ningún párrafo con más de un `w:pPr` propio. El `w:pPr` que anida un `w:sectPr` es
       legítimo y esta plantilla trae uno, así que se compara contra el original en lugar de
       exigir cero. */
    const conDosPPr = (xml) => (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) || []).filter((par) => {
      const propio = par.replace(/<w:sectPr[\s\S]*?<\/w:sectPr>/g, '')
        .replace(/<w:pPrChange[\s\S]*?<\/w:pPrChange>/g, '');
      return (propio.match(/<w:pPr[ />]/g) || []).length > 1;
    }).length;
    assert.strictEqual(conDosPPr(r.xml), conDosPPr(doc),
      'un w:p con dos w:pPr es un documento que Word rechaza');
  });
});

test('END GAME 2024: justifica los párrafos que la plantilla dejaba a la izquierda',
  { skip: !fs.existsSync(path.resolve(AQUI, PLANTILLAS[0][1])) }, async () => {
    /* La medición que motivó el cambio: 339 párrafos fuera de tabla sin `w:jc`, con un
       estilo `Normal` que tampoco lo declara. Los que quedan sin justificar son el índice y
       los títulos, y son menos de la mitad. */
    const { doc, styles } = await partesDe(PLANTILLAS[0][1]);
    const antes = parrafosDe(doc).filter((par) => !alineacionDe(par)).length;
    const r = justificarCuerpoOoxml(doc, styles);
    const despues = parrafosDe(r.xml).filter((par) => !alineacionDe(par)).length;
    assert.ok(antes > 300, 'la plantilla debería traer más de 300 párrafos sin alineación, trae ' + antes);
    assert.ok(despues < antes / 2, 'deberían quedar menos de la mitad, quedan ' + despues + ' de ' + antes);
    assert.ok(r.justificados > 200, 'debería justificar más de 200 párrafos, justificó ' + r.justificados);
  });

test('MC INTERNACIONAL 2024: los w:jc="left" explícitos pasan a justificado',
  { skip: !fs.existsSync(path.resolve(AQUI, PLANTILLAS[1][1])) }, async () => {
    /* El otro caso: esa plantilla no trae ni un `both` explícito —los hereda del estilo
       `Normal`— pero sí 30 párrafos con `left` puesto a mano, que salían a la izquierda
       pese al estilo. */
    const { doc, styles } = await partesDe(PLANTILLAS[1][1]);
    const izquierda = (xml) => parrafosDe(xml).filter((par) => alineacionDe(par) === 'left').length;
    assert.ok(izquierda(doc) > 0, 'la plantilla trae párrafos con left explícito');
    assert.strictEqual(izquierda(justificarCuerpoOoxml(doc, styles).xml), 0,
      'ninguno puede quedar a la izquierda');
  });
