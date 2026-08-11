import { test } from 'node:test';
import assert from 'node:assert';
import {
  localizarTablaHtml, reescribirFilasHtml, envolturaDe, textoPlanoHtml,
  actualizarTablasMotorHtml, TABLA_MARGENES,
} from './tablasHtmlInforme.js';

/* Tabla como la emite el extractor de PDF: HTML semántico, sin estilos en las celdas,
   con la razón social en negrita y la fuente al pie dentro de la propia tabla.
   Reproduce la «Tabla 19» de la plantilla de END GAME. */
const TABLA_ENDGAME = '<table>'
  + '<tr><th>COMPARABLES</th><th>MO NO AJUSTADO</th><th>MO AJUSTADO</th></tr>'
  + '<tr><td><strong>AKATSUKI INC.</strong></td><td>16.557%</td><td>16.132%</td></tr>'
  + '<tr><td><strong>COLOPL, INC.</strong></td><td>-4.647%</td><td>-8.675%</td></tr>'
  + '<tr><td><strong>IGG INC</strong></td><td>11.815%</td><td>12.719%</td></tr>'
  + '<tr><td><span style="font-size:9pt">Información Base Datos ONESOURCE.</span></td></tr>'
  + '</table>';

const conRotulo = (rotulo, tabla = TABLA_ENDGAME) =>
  '<p>texto previo del informe</p>' + `<p>${rotulo}</p>` + tabla + '<p>siguiente</p>';

/* Estudio con tres comparables cuyos márgenes salen del mismo motor que la ruta .docx. */
const ESTUDIO = {
  anio: 2025, ent: 'ACME COLOMBIA SAS', pli: 'MO', cmode: 'all',
  t_s: 10000, t_c: 7000, t_op: 2000,
  comparables: [
    { name: 'ZETA COMPARABLE LTD', s: 5000, c: 3500, op: 900, amb: 'Int' },
    { name: 'OMEGA COMPARABLE PLC', s: 8000, c: 5600, op: 1600, amb: 'Int' },
    { name: 'DELTA COMPARABLE SA', s: 3000, c: 2100, op: 500, amb: 'Nac' },
  ],
};

/* ══════ Localización ══════ */

test('la tabla se localiza por su nombre, con cualquier prefijo de rótulo', () => {
  /* Mismo criterio que la ruta .docx: el prefijo se renumera al reordenar el informe y
     hay plantillas que no lo traen, así que el nombre es lo único estable. */
  for (const rotulo of [
    'Tabla 19. Margen Operacional Compañías Comparables',
    'Tabla 21. Margen Operacional Compañías Comparables',
    'Margen Operacional Compañías Comparables',
    'TABLA N° 7: MARGEN OPERACIONAL COMPAÑÍAS COMPARABLES',
  ]) {
    const html = conRotulo(rotulo);
    const b = localizarTablaHtml(html, TABLA_MARGENES);
    assert.ok(b, `debe encontrarla con «${rotulo}»`);
    assert.ok(html.slice(b.inicio, b.fin).startsWith('<table'), 'el bloque empieza en la tabla');
    assert.ok(html.slice(b.fin).startsWith('<p>siguiente'), 'y termina al cerrarla');
  }
});

test('los párrafos vacíos entre el rótulo y la tabla no rompen la búsqueda', () => {
  /* El extractor cuelga un párrafo vacío por fila: es la marca de párrafo que Word deja
     al exportar la tabla. */
  const html = '<p>Tabla 19. Margen Operacional Compañías Comparables</p><p></p><p> </p>'
    + TABLA_ENDGAME;
  assert.ok(localizarTablaHtml(html, TABLA_MARGENES));
});

test('un rótulo con texto de por medio no se toma por el de la tabla', () => {
  const html = '<p>Margen Operacional Compañías Comparables</p><p>Un párrafo de prosa.</p>'
    + TABLA_ENDGAME;
  assert.strictEqual(localizarTablaHtml(html, TABLA_MARGENES), null);
});

test('la prosa que menciona el margen operacional no secuestra la tabla', () => {
  /* En la plantilla, «…el indicador financiero más apropiado es el Margen Operacional…»
     va seguida de la tabla de definiciones del método. Con el nombre completo no casa. */
  const html = '<p>Para el análisis del método TU se consideró que el indicador financiero '
    + 'de rentabilidad más apropiado es el Margen Operacional (MO).</p>'
    + '<table><tr><td>MO</td><td>Definición</td></tr></table>'
    + conRotulo('Tabla 19. Margen Operacional Compañías Comparables');
  const b = localizarTablaHtml(html, TABLA_MARGENES);
  assert.ok(b);
  assert.ok(html.slice(b.inicio, b.fin).includes('AKATSUKI'), 'debe ser la tabla de márgenes');
});

test('una tabla anidada no corta el bloque por la mitad', () => {
  const anidada = '<table><tr><td><table><tr><td>interna</td></tr></table></td></tr>'
    + '<tr><td><strong>A</strong></td><td>1%</td></tr></table>';
  const html = conRotulo('Tabla 19. Margen Operacional Compañías Comparables', anidada);
  const b = localizarTablaHtml(html, TABLA_MARGENES);
  assert.ok(html.slice(b.inicio, b.fin).endsWith('</table>'));
  assert.ok(html.slice(b.fin).startsWith('<p>siguiente'), 'no se lleva lo que sigue');
});

test('sin la tabla en la plantilla no se inventa una posición', () => {
  assert.strictEqual(localizarTablaHtml('<p>Otro informe</p>', TABLA_MARGENES), null);
  assert.strictEqual(localizarTablaHtml('', TABLA_MARGENES), null);
});

/* ══════ Reescritura de filas ══════ */

test('envolturaDe reproduce la envoltura del molde', () => {
  assert.deepStrictEqual(envolturaDe('<strong>ACME</strong>'), { abre: '<strong>', cierra: '</strong>' });
  assert.deepStrictEqual(envolturaDe('16.557%'), { abre: '', cierra: '' });
  const span = envolturaDe('<span style="font-size:9pt">Fuente</span>');
  assert.strictEqual(span.abre, '<span style="font-size:9pt">');
});

test('el párrafo de dentro de la celda se conserva', () => {
  /* Medido sobre la plantilla de END GAME: sus celdas son `<td><p>AKATSUKI INC.</p></td>`.
     El CSS del previo estiliza `td p`, así que emitir `<td>` a secas cambiaba el
     interlineado y los márgenes de la tabla entera. */
  assert.deepStrictEqual(envolturaDe('<p>AKATSUKI INC.</p>'), { abre: '<p>', cierra: '</p>' });
  assert.deepStrictEqual(envolturaDe('<p><strong>ACME</strong></p>'),
    { abre: '<p><strong>', cierra: '</strong></p>' });

  const tablaConParrafos = '<table>'
    + '<tr><th><p><strong>COMPARABLES</strong></p></th><th><p><strong>MO</strong></p></th></tr>'
    + '<tr><td><p>AKATSUKI INC.</p></td><td><p>16.557%</p></td></tr>'
    + '</table>';
  const salida = reescribirFilasHtml(tablaConParrafos, [['ZETA LTD', '18.00%']]);
  assert.match(salida, /<td><p>ZETA LTD<\/p><\/td>/, 'la celda nueva conserva su párrafo');
  assert.match(salida, /<th><p><strong>COMPARABLES<\/strong><\/p><\/th>/, 'el encabezado intacto');
});

test('las filas nuevas heredan la negrita de la razón social', () => {
  /* La ruta de PDF existe para conservar la presentación del informe del cliente: una
     tabla con media columna sin negrita delata que se reconstruyó. */
  const salida = reescribirFilasHtml(TABLA_ENDGAME, [['ZETA LTD', '18.00%', '18.03%']]);
  assert.match(salida, /<td><strong>ZETA LTD<\/strong><\/td>/);
  assert.match(salida, /<td>18\.00%<\/td>/, 'las numéricas no llevan énfasis');
});

test('el encabezado y la fuente al pie se conservan', () => {
  const salida = reescribirFilasHtml(TABLA_ENDGAME, [['ZETA LTD', '18.00%', '18.03%']]);
  assert.match(salida, /<th>COMPARABLES<\/th>/, 'el encabezado no se toca');
  assert.match(salida, /Información Base Datos ONESOURCE/, 'la fuente al pie tampoco');
  assert.ok(!salida.includes('AKATSUKI'), 'y las comparables viejas desaparecen');
});

test('la tabla admite más filas de las que traía la plantilla', () => {
  /* Es lo que el marcado por campos no podía hacer: la plantilla trae tres comparables y
     la muestra de este estudio tiene cinco. */
  const filas = ['A', 'B', 'C', 'D', 'E'].map((n, i) => [n, i + '.00%', i + '.10%']);
  const salida = reescribirFilasHtml(TABLA_ENDGAME, filas);
  const cuerpo = [...salida.matchAll(/<tr>/g)].length;
  assert.strictEqual(cuerpo, 1 + 5 + 1, 'encabezado + cinco datos + fuente');
  ['A', 'B', 'C', 'D', 'E'].forEach((n) => assert.ok(salida.includes('>' + n + '<')));
});

test('y también menos: de tres pasa a una', () => {
  const salida = reescribirFilasHtml(TABLA_ENDGAME, [['SOLA SA', '1.00%', '1.10%']]);
  assert.strictEqual([...salida.matchAll(/<tr>/g)].length, 3, 'encabezado + una + fuente');
});

test('el texto de las filas se escapa', () => {
  const salida = reescribirFilasHtml(TABLA_ENDGAME, [['A & B <script>', '1%', '2%']]);
  assert.match(salida, /A &amp; B &lt;script&gt;/);
  assert.ok(!salida.includes('<script>'));
});

test('una tabla sin filas de datos se deja como está', () => {
  const soloEncabezado = '<table><tr><th>COMPARABLES</th><th>MO</th></tr></table>';
  assert.strictEqual(reescribirFilasHtml(soloEncabezado, [['A', '1%']]), soloEncabezado);
});

/* ══════ Integración ══════ */

test('actualizarTablasMotorHtml pone las comparables del estudio en la tabla', () => {
  const html = conRotulo('Tabla 19. Margen Operacional Compañías Comparables');
  const avisos = [];
  const salida = actualizarTablasMotorHtml(html, ESTUDIO, avisos);

  ['ZETA COMPARABLE LTD', 'OMEGA COMPARABLE PLC', 'DELTA COMPARABLE SA'].forEach((n) =>
    assert.ok(salida.includes(n), `debe aparecer ${n}`));
  assert.ok(!salida.includes('AKATSUKI'), 'y no las del informe anterior');
  assert.ok(!salida.includes('16.557%'), 'ni sus márgenes');
  assert.match(salida, /18\.00%/, 'el margen se calcula con el motor del estudio');
  assert.deepStrictEqual(avisos, [], 'la tabla estaba: no hay nada que avisar');
  assert.ok(salida.includes('<p>siguiente'), 'el resto del documento queda intacto');
});

test('sin la tabla en la plantilla se avisa y no se toca el documento', () => {
  const html = '<p>Un informe sin esa tabla</p>';
  const avisos = [];
  assert.strictEqual(actualizarTablasMotorHtml(html, ESTUDIO, avisos), html);
  assert.deepStrictEqual(avisos, [TABLA_MARGENES]);
});

test('sin comparables en el estudio la tabla no se vacía, y se avisa', () => {
  /* Dejarla en blanco sería peor: el aviso ya no se emitiría y nadie sabría por qué. */
  const html = conRotulo('Tabla 19. Margen Operacional Compañías Comparables');
  const avisos = [];
  const salida = actualizarTablasMotorHtml(html, { ...ESTUDIO, comparables: [] }, avisos);
  assert.strictEqual(salida, html);
  assert.deepStrictEqual(avisos, [TABLA_MARGENES]);
});

test('una comparable sin margen calculable sale con un hueco visible, no con un cero', () => {
  /* Un cero se lee como «esta comparable no tuvo margen», que es afirmar un dato que no
     se tiene. El informe se radica ante la DIAN. */
  const salida = actualizarTablasMotorHtml(
    conRotulo('Tabla 19. Margen Operacional Compañías Comparables'),
    { ...ESTUDIO, comparables: [{ name: 'SIN VENTAS SA', s: 0, c: 0, op: 0, amb: 'Int' }] },
    [],
  );
  assert.ok(salida.includes('SIN VENTAS SA'));
  assert.ok(salida.includes('—'), 'el margen ausente se publica como hueco');
});

test('textoPlanoHtml deshace etiquetas y entidades', () => {
  assert.strictEqual(textoPlanoHtml('<p><strong>Tabla&nbsp;19.</strong> A &amp; B</p>'),
    'Tabla 19. A & B');
});