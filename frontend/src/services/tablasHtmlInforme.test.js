import { test } from 'node:test';
import assert from 'node:assert';
import {
  localizarTablaHtml, reescribirFilasHtml, envolturaDe, textoPlanoHtml,
  actualizarTablasMotorHtml, reescribirCeldaHtml, TABLA_MARGENES,
  actualizarTablasMacroHtml, reescribirRotuloHtml, TABLA_CRITERIOS,
  actualizarApartadosMacroHtml, localizarHitosHtml, reemplazarHuecosHtml,
  actualizarApartadoSectorialHtml,
} from './tablasHtmlInforme.js';
/* De namespace: un export que todavía no existe rompe la CARGA del módulo y tumba el archivo
   entero, en vez de fallar la aserción que lo comprueba. */
import * as tablas from './tablasHtmlInforme.js';
import { resolverSerie } from './analisisMercado.js';

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

test('la tabla se localiza aunque la plantilla la rotule sin «Compañías»', () => {
  /* El informe de MONTACHEM la titula «Margen Operacional Comparables». Los localizadores
     comparan por inclusión, así que la clave larga NO casa con este rótulo —«companias» queda en
     medio— y con una sola clave la tabla no se encontraba: se radicaba con los comparables del
     informe anterior y con su cita al pie intacta. Reportado con capturas el 2026-08-20. */
  for (const rotulo of [
    'Tabla 22. Margen Operacional Comparables',
    'Margen Operacional Comparables',
    'TABLA N° 22: MARGEN OPERACIONAL COMPARABLES',
  ]) {
    const html = conRotulo(rotulo);
    assert.ok(localizarTablaHtml(html, TABLA_MARGENES), `debe encontrarla con «${rotulo}»`);
  }
});

test('con el rótulo corto las filas quedan con las comparables del estudio', () => {
  const html = conRotulo('Tabla 22. Margen Operacional Comparables');
  const salida = actualizarTablasMotorHtml(html, ESTUDIO, []);

  for (const c of ESTUDIO.comparables) {
    assert.ok(salida.includes(c.name), `debe listar ${c.name}`);
  }
  for (const vieja of ['AKATSUKI INC.', 'COLOPL, INC.', 'IGG INC']) {
    assert.ok(!salida.includes(vieja), `${vieja} es del informe anterior y no debe sobrevivir`);
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

test('envolturaDe descarta el span de marca y conserva el resto de la envoltura', () => {
  /* El marcador de la IA envuelve la cifra del informe de referencia en
     `<span data-campo>`. Si el molde lo reproduce, `plantillaRenderer` rellena esa marca
     en TODAS las filas nuevas con el mismo campo. */
  assert.deepStrictEqual(envolturaDe('<p><span data-campo="t_cash">9.999</span></p>'),
    { abre: '<p>', cierra: '</p>' });
  assert.deepStrictEqual(envolturaDe('<span data-campo="t_cash">9.999</span>'),
    { abre: '', cierra: '' });
  /* Un span de ESTILO no es una marca y sigue conservándose. */
  assert.strictEqual(envolturaDe('<span style="font-size:9pt">Fuente</span>').abre,
    '<span style="font-size:9pt">');
});

test('el marcador del molde no se reproduce en las filas nuevas (Tabla 10)', () => {
  /* Regresión de la Tabla 10 «Activos a 31 de diciembre»: la primera fila de datos de la
     plantilla trae la marca `t_cash` sobre el efectivo, así que las diez filas heredaban
     esa marca y el informe publicaba el efectivo repetido en los diez rubros —con el
     análisis vertical correcto al lado, que es lo que delataba que las dos columnas no
     salían del mismo sitio. */
  const tabla = '<table>'
    + '<tr><th><p>Cifras Expresadas en pesos colombianos</p></th><th><p>2024</p></th><th><p>A.V. 2024</p></th></tr>'
    + '<tr><td><p>Efectivo y equivalentes de efectivo</p></td>'
    + '<td><p><span data-campo="t_cash">9.999</span></p></td><td><p>0.50%</p></td></tr>'
    + '<tr><td><p>Inversiones asociadas</p></td><td><p>888</p></td><td><p>47.00%</p></td></tr>'
    + '</table>';

  const salida = reescribirFilasHtml(tabla, [
    ['Efectivo y equivalentes de efectivo', '12.417.756', '0.57%'],
    ['Inversiones asociadas', '1.031.278.520', '47.34%'],
    ['Total, Activos', '2.178.554.000', '100.00%'],
  ]);

  assert.ok(!/data-campo/.test(salida), 'ninguna fila nueva conserva la marca del molde');
  assert.match(salida, /<td><p>12\.417\.756<\/p><\/td>/, 'cada fila publica su propia cifra');
  assert.match(salida, /<td><p>1\.031\.278\.520<\/p><\/td>/);
  assert.match(salida, /<td><p>2\.178\.554\.000<\/p><\/td>/);
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
  assert.match(salida, /18,000 %/, 'el margen se calcula con el motor del estudio');
  assert.ok(!avisos.includes(TABLA_MARGENES), 'esa tabla estaba: no hay que avisar de ella');
  assert.ok(salida.includes('<p>siguiente'), 'el resto del documento queda intacto');
});

test('sin la tabla en la plantilla se avisa y no se toca el documento', () => {
  const html = '<p>Un informe sin esa tabla</p>';
  const avisos = [];
  assert.strictEqual(actualizarTablasMotorHtml(html, ESTUDIO, avisos), html);
  assert.ok(avisos.includes(TABLA_MARGENES));
});

test('sin comparables en el estudio la tabla no se vacía, y se avisa', () => {
  /* Dejarla en blanco sería peor: el aviso ya no se emitiría y nadie sabría por qué. */
  const html = conRotulo('Tabla 19. Margen Operacional Compañías Comparables');
  const avisos = [];
  const salida = actualizarTablasMotorHtml(html, { ...ESTUDIO, comparables: [] }, avisos);
  assert.strictEqual(salida, html);
  assert.ok(avisos.includes(TABLA_MARGENES));
});

/* ══════ Las demás tablas del motor ══════ */

const TABLA_3COL = (cabecera) => '<table>'
  + `<tr><th><p>${cabecera[0]}</p></th><th><p>${cabecera[1]}</p></th><th><p>${cabecera[2]}</p></th></tr>`
  + '<tr><td><p>viejo A</p></td><td><p>viejo B</p></td><td><p>viejo C</p></td></tr>'
  + '<tr><td><p>viejo D</p></td><td><p>viejo E</p></td><td><p>viejo F</p></td></tr>'
  + '</table>';

const EMBUDO = {
  evaluadas: 100, seleccionadas: 4, reserva: 6,
  porMotivo: { holding: 30, perdidaOperativa: 25, actividadDistinta: 35 },
};

test('la muestra de comparables se numera y se rellena con el ámbito', () => {
  const html = '<p>Tabla 17. Muestra Compañías comparables</p>'
    + TABLA_3COL(['Número', 'Nombre de la Compañía', 'Ámbito']);
  const salida = actualizarTablasMotorHtml(html, ESTUDIO, []);
  assert.match(salida, /<td><p>1<\/p><\/td><td><p>ZETA COMPARABLE LTD<\/p><\/td><td><p>INTERNACIONAL<\/p><\/td>/);
  assert.match(salida, /<td><p>3<\/p><\/td><td><p>DELTA COMPARABLE SA<\/p><\/td><td><p>NACIONAL<\/p><\/td>/);
  assert.ok(!salida.includes('viejo A'), 'las filas de la plantilla se van');
});

test('las razones de rechazo salen del embudo y cierran con el universo', () => {
  const html = '<p>Tabla 16. Razones de rechazo</p>'
    + TABLA_3COL(['FILTRO APLICADO', 'FILTROS APLICADO', 'N° POR FILTRO']);
  const salida = actualizarTablasMotorHtml(html, { ...ESTUDIO, embudoSeleccion: EMBUDO }, []);
  assert.match(salida, /Compañías holding o de grupo/);
  assert.match(salida, /TOTAL, UNIVERSO/);
  assert.match(salida, /<td><p>100<\/p><\/td>/, 'el total del universo cierra la tabla');
  assert.ok(!salida.includes('viejo A'));
});

test('sin embudo se avisa de las razones de rechazo en vez de inventarlas', () => {
  const html = '<p>Tabla 16. Razones de rechazo</p>' + TABLA_3COL(['A', 'B', 'C']);
  const avisos = [];
  const salida = actualizarTablasMotorHtml(html, ESTUDIO, avisos);
  assert.ok(avisos.includes('Razones de rechazo'));
  assert.ok(salida.includes('viejo A'), 'la tabla de la plantilla no se toca');
});

test('el rango vertical se rellena con los percentiles del estudio', () => {
  const html = '<p>Tabla 18. Rango Intercuartil</p>'
    + TABLA_3COL(['RANGO INTERCUARTIL', 'RANGE MO NO AJUSTADO', 'RANGE MO AJUSTADO']);
  const salida = actualizarTablasMotorHtml(html, ESTUDIO, []);
  ['Mínimo', 'Percentil 25', 'Mediana', 'Percentil 75', 'Máximo'].forEach((e) =>
    assert.ok(salida.includes(e), `falta la fila ${e}`));
  assert.match(salida, /ACME COLOMBIA SAS/, 'el contribuyente cierra la tabla');
  assert.ok(!salida.includes('viejo A'));
});

test('las TRES apariciones del rango quedan con los mismos percentiles', () => {
  /* La horizontal de los resultados, la vertical del análisis y la del final con el
     rótulo dentro de su primera fila. Antes se elegía una y las otras se radicaban con
     los percentiles del informe anterior. */
  const horizontal = '<table>'
    + '<tr><th><p>ACME</p></th><th><p>Percentil 25</p></th><th><p>Mediana</p></th><th><p>Percentil 75</p></th></tr>'
    + '<tr><td><p>v1</p></td><td><p>v2</p></td><td><p>v3</p></td><td><p>v4</p></td></tr>'
    + '</table>';
  const embebida = '<table>'
    + '<tr><td><p>Tabla de rangos</p></td></tr>'
    + '<tr><th><p>RANGO INTERCUARTIL</p></th><th><p>NO AJUSTADO</p></th><th><p>AJUSTADO</p></th></tr>'
    + '<tr><td><p>viejo X</p></td><td><p>viejo Y</p></td><td><p>viejo Z</p></td></tr>'
    + '</table>';
  const html = '<p>Tabla 5. Rango Intercuartil</p>' + horizontal
    + '<p>Tabla 18. Rango Intercuartil</p>'
    + TABLA_3COL(['RANGO INTERCUARTIL', 'NO AJUSTADO', 'AJUSTADO'])
    + embebida;

  const avisos = [];
  const salida = actualizarTablasMotorHtml(html, ESTUDIO, avisos);

  assert.ok(!salida.includes('viejo A'), 'la vertical se actualizó');
  assert.ok(!salida.includes('viejo X'), 'la embebida también');
  assert.ok(!salida.includes('<p>v1</p>'), 'y la horizontal');
  assert.match(salida, /Tabla de rangos/, 'el rótulo embebido se conserva');
  assert.strictEqual((salida.match(/Percentil 75/g) || []).length, 3,
    'como fila en la vertical y en la embebida, y como encabezado en la horizontal');
  /* Y el percentil vale lo mismo en las tres: es el punto de esta prueba. */
  const p75 = /Percentil 75<\/p><\/td><td><p>([^<]+)<\/p>/.exec(salida);
  assert.ok(p75, 'la fila del P75 tiene que llevar su valor');
  assert.strictEqual((salida.match(new RegExp(p75[1].replace('.', '\\.'), 'g')) || []).length >= 2,
    true, 'el mismo valor aparece en las dos verticales');
  assert.ok(!avisos.includes('Rango Intercuartil'), 'estaban: no hay que avisar');
});

test('el encabezado de la horizontal deja de nombrar al contribuyente anterior', () => {
  /* Su primera celda es el nombre del contribuyente: en la plantilla de END GAME dice
     «END GAME», y dejarlo ahí publica el nombre del cliente anterior en el informe de
     otro. El resto del encabezado no se toca: es redacción de la plantilla. */
  const horizontal = '<table>'
    + '<tr><th><p><strong>END GAME</strong></p></th><th><p>Percentil 25</p></th>'
    + '<th><p>Mediana</p></th><th><p>Percentil 75</p></th></tr>'
    + '<tr><td><p>v1</p></td><td><p>v2</p></td><td><p>v3</p></td><td><p>v4</p></td></tr>'
    + '</table>';
  const salida = actualizarTablasMotorHtml(
    '<p>Tabla 5. Rango Intercuartil</p>' + horizontal, ESTUDIO, []);

  assert.ok(!salida.includes('END GAME'), 'el nombre del cliente anterior tiene que irse');
  assert.match(salida, /<th><p><strong>ACME COLOMBIA SAS<\/strong><\/p><\/th>/,
    'y el del estudio ocupa su lugar, con el mismo formato');
  assert.match(salida, /<th><p>Percentil 25<\/p><\/th>/, 'el resto del encabezado intacto');
});

test('reescribirCeldaHtml solo toca la celda pedida', () => {
  const tabla = '<table><tr><th><p>A</p></th><th><p>B</p></th></tr>'
    + '<tr><td><p>C</p></td><td><p>D</p></td></tr></table>';
  const salida = reescribirCeldaHtml(tabla, 0, 1, 'NUEVO');
  assert.match(salida, /<th><p>A<\/p><\/th><th><p>NUEVO<\/p><\/th>/);
  assert.match(salida, /<td><p>C<\/p><\/td><td><p>D<\/p><\/td>/, 'la otra fila no se toca');
  assert.strictEqual(reescribirCeldaHtml(tabla, 9, 0, 'X'), tabla, 'fila inexistente: sin cambios');
  assert.strictEqual(reescribirCeldaHtml(tabla, 0, 9, 'X'), tabla, 'celda inexistente: sin cambios');
});

test('con solo la horizontal se avisa de que falta el rango del análisis', () => {
  /* La horizontal no lleva los percentiles no ajustados, así que si es la única que trae
     la plantilla, el rango del análisis se queda con los datos viejos. */
  const horizontal = '<table>'
    + '<tr><th><p>ACME</p></th><th><p>P25</p></th><th><p>Med</p></th><th><p>P75</p></th></tr>'
    + '<tr><td><p>v1</p></td><td><p>v2</p></td><td><p>v3</p></td><td><p>v4</p></td></tr>'
    + '</table>';
  const avisos = [];
  actualizarTablasMotorHtml('<p>Tabla 5. Rango Intercuartil</p>' + horizontal, ESTUDIO, avisos);
  assert.ok(avisos.includes('Rango Intercuartil'));
});

test('las cuatro tablas del motor se actualizan en una sola pasada', () => {
  const html = '<p>Tabla 16. Razones de rechazo</p>' + TABLA_3COL(['A', 'B', 'C'])
    + '<p>Tabla 17. Muestra Compañías comparables</p>' + TABLA_3COL(['N', 'Nombre', 'Ámbito'])
    + '<p>Tabla 18. Rango Intercuartil</p>' + TABLA_3COL(['RANGO', 'NO AJ', 'AJ'])
    + '<p>Tabla 19. Margen Operacional Compañías Comparables</p>' + TABLA_3COL(['COMP', 'NO AJ', 'AJ']);
  const avisos = [];
  const salida = actualizarTablasMotorHtml(
    html, { ...ESTUDIO, embudoSeleccion: EMBUDO }, avisos);

  /* Las CUATRO que este caso ejercita. No se exige `avisos` vacío del todo porque el motor
     regenera además los criterios de búsqueda, que esta plantilla de prueba no trae: eso
     sí tiene que avisarse y no es un fallo de estas cuatro. */
  assert.deepStrictEqual(
    avisos.filter((a) => a !== TABLA_CRITERIOS), [], 'las cuatro estaban'
  );
  assert.ok(!salida.includes('viejo A'), 'ninguna conserva las filas de la plantilla');
  assert.match(salida, /TOTAL, UNIVERSO/, 'razones de rechazo');
  assert.match(salida, /INTERNACIONAL/, 'muestra');
  assert.match(salida, /Percentil 25/, 'rango');
  assert.strictEqual((salida.match(/ZETA COMPARABLE LTD/g) || []).length, 2,
    'la comparable aparece en la muestra y en los márgenes');
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

/* ══════ Tablas de tendencias de la economía ══════ */

const TABLA_MACRO = '<table>'
  + '<tr><th><p><strong>Año</strong></p></th><th><p><strong>Crecimiento Mundial (%)</strong></p></th></tr>'
  + '<tr><td><p>2022</p></td><td><p>3,4%</p></td></tr>'
  + '<tr><td><p>2023</p></td><td><p>3,1%</p></td></tr>'
  + '<tr><td><p>2024 (Proyección)</p></td><td><p>2,9%</p></td></tr>'
  + '</table>';

test('la tabla del PIB mundial se rellena con las series y el año del estudio', () => {
  const html = '<p>Crecimiento del PIB Mundial (2022-2024)</p>' + TABLA_MACRO;
  const avisos = [];
  const salida = actualizarTablasMacroHtml(html, null, 2025, avisos);

  assert.ok(!avisos.includes('PIB Mundial'), 'la tabla estaba');
  assert.match(salida, /<td><p>2024<\/p><\/td>/, 'el año anterior al gravable');
  assert.match(salida, /2026 \(Proyección\)/, 'y la proyección del siguiente');
  assert.ok(!salida.includes('<p>2022</p>'), 'los años del informe anterior se van');
});

test('el rótulo de una tabla macro se actualiza porque lleva los años', () => {
  /* «Crecimiento del PIB Mundial (2022-2024)» en un informe de 2025 publica el rango de
     años del informe del que salió la plantilla. El título es un dato aquí, no redacción. */
  const html = '<p>Crecimiento del PIB Mundial (2022-2024)</p>' + TABLA_MACRO;
  const salida = actualizarTablasMacroHtml(html, null, 2025, []);
  assert.match(salida, /<p>Crecimiento del PIB Mundial \(2024-2026\)<\/p>/);
  assert.ok(!salida.includes('(2022-2024)'));
});

test('el rótulo conserva el número que traía la plantilla', () => {
  /* Imponer nuestra numeración descuadraría el índice del cliente y las referencias del
     texto. */
  const html = '<p>Tabla 24. Crecimiento del PIB Mundial (2022-2024)</p>' + TABLA_MACRO;
  const salida = actualizarTablasMacroHtml(html, null, 2025, []);
  assert.match(salida, /Tabla 24\. Crecimiento del PIB Mundial \(2024-2026\)/);
});

test('reescribirRotuloHtml conserva la etiqueta y el énfasis del párrafo', () => {
  assert.strictEqual(
    reescribirRotuloHtml('<h4><strong>Inflación Global (2020-2022)</strong></h4>', 'Nuevo título'),
    '<h4><strong>Nuevo título</strong></h4>');
  /* Lo que no es un párrafo se devuelve tal cual: mejor no tocar nada que romper el markup. */
  assert.strictEqual(reescribirRotuloHtml('<table></table>', 'X'), '<table></table>');
});

test('las macro que la plantilla no trae se avisan una por una', () => {
  const avisos = [];
  actualizarTablasMacroHtml('<p>Un informe sin tablas macro</p>', null, 2025, avisos);
  assert.strictEqual(avisos.length, 8, 'son ocho tablas');
  assert.ok(avisos.includes('PIB Mundial'));
  assert.ok(avisos.includes('Desempleo en Colombia'));
});

test('las ocho macro se actualizan sin pisarse entre sí', () => {
  /* Cada sustitución mueve los offsets de lo que va después, así que se localizan de una en
     una sobre la salida ya modificada. */
  const dosColumnas = (a, b) => '<table>'
    + `<tr><th><p>${a}</p></th><th><p>${b}</p></th></tr>`
    + '<tr><td><p>viejo 1</p></td><td><p>viejo 2</p></td></tr></table>';
  const html = '<p>Crecimiento del PIB Mundial (2022-2024)</p>' + dosColumnas('Año', 'Mundial')
    + '<p>Crecimiento del PIB en Colombia (2022-2024)</p>' + dosColumnas('Año', 'PIB')
    + '<p>Tasas de Inflación Global (2022-2024)</p>' + dosColumnas('Año', 'Inflación')
    + '<p>Proyecciones de Crecimiento del PIB por Región/País (2024)</p>' + dosColumnas('Región/País', 'Crec')
    + '<p>Inflación en Colombia (2024 vs. Meta 2025)</p>' + dosColumnas('Indicador', 'Valor')
    + '<p>Tasa de Intervención del Banco de la República (Dic 2023 - Dic 2024)</p>' + dosColumnas('Fecha', 'Tasa')
    + '<p>Tasa Representativa del Mercado (TRM) Promedio (2023-2024)</p>' + dosColumnas('Año', 'TRM')
    + '<p>Tasa de Desempleo en Colombia (2024 vs. Proyección 2025)</p>' + dosColumnas('Indicador', 'Valor');

  const avisos = [];
  const salida = actualizarTablasMacroHtml(html, null, 2025, avisos);

  assert.deepStrictEqual(avisos, [], 'las ocho estaban');
  assert.ok(!salida.includes('viejo 1'), 'ninguna conserva las filas de la plantilla');
  assert.strictEqual((salida.match(/\(2024-2026\)/g) || []).length, 3,
    'los tres rótulos por años quedan con el rango del estudio');
  assert.match(salida, /Meta Inflación 2026/);
  assert.match(salida, /Desempleo Proyectado 2026/);
});

test('textoPlanoHtml deshace etiquetas y entidades', () => {
  assert.strictEqual(textoPlanoHtml('<p><strong>Tabla&nbsp;19.</strong> A &amp; B</p>'),
    'Tabla 19. A & B');
});
test('los criterios de búsqueda eliminan las tablas 13 y 15 redundantes y conservan la 14', () => {
  /* La plantilla trae «Códigos SIC utilizados» tres veces (Tablas 13, 14 y 15) correspondientes
     a las bases de datos de Ryan LLC, Capital IQ y Refinitiv. En este momento el sistema utiliza
     únicamente Capital IQ, por lo que las tablas 13 y 15 se eliminan del reporte final. */
  const tabla = (n) =>
    '<p><strong> Tabla ' + n + '. Códigos SIC utilizados</strong></p>' +
    '<table><tr><th><p><strong> Criterio de búsqueda</strong></p></th></tr>' +
    '<tr><th><p> Código SIC primario:</p></th><td><p> Entre 1111 y 2222</p></td></tr>' +
    '<tr><th><p> Y</p></th></tr>' +
    '<tr><th><p> Palabra clave:</p></th><td><p> Contiene viejo</p></td></tr></table>';
  const html = tabla(13) + '<p> Medio.</p>' + tabla(14) + '<p> Medio.</p>' + tabla(15);
  const estudio = {
    criteriosScreening: [
      { conector: null, etiqueta: 'Código SIC primario:', valor: 'Entre 7371 y 7375' },
      { conector: 'O', etiqueta: 'Palabra clave:', valor: 'Contiene juegos' },
    ],
  };
  const avisos = [];
  const salida = actualizarTablasMotorHtml(html, estudio, avisos);
  
  // Ahora solo queda la Tabla 14 (Capital IQ):
  assert.strictEqual((salida.match(/Entre 7371 y 7375/g) || []).length, 1, 'solo queda la tabla 14 con los criterios');
  assert.ok(!salida.includes('Tabla 13. Códigos SIC utilizados'), 'se eliminó la tabla 13');
  assert.ok(!salida.includes('Tabla 15. Códigos SIC utilizados'), 'se eliminó la tabla 15');
  assert.ok(salida.includes('Tabla 14. Códigos SIC utilizados'), 'se conservó la tabla 14');
  
  assert.ok(!salida.includes('Entre 1111 y 2222'), 'sobrevivió el criterio anterior');
  assert.ok(!salida.includes('Contiene viejo'), 'sobrevivió la palabra clave anterior');
  assert.ok(!avisos.includes('Códigos SIC utilizados'), 'las tablas sí estaban');
  assert.match(salida, /<p> Medio\.<\/p>/, 'el texto entre ellas sobrevive');
});

test('los criterios de búsqueda conservan y actualizan la del medio aunque la numeración no sea 13/14/15', () => {
  /* Caso real reportado 2026-08-20: un informe de BEUMER trae las tres copias renumeradas
     18/19/20. A diferencia de la ruta .docx (que necesitó el fix de 2026-08-20 porque
     distinguía «conservar» de «no tocar»), esta ruta ya lo resolvía bien: aquí no hay una
     rama de «conservar» aparte, todo lo que no cae en «eliminar» se reescribe — así que la
     del medio, sea el número que sea mientras no sea 13 o 15, siempre se actualiza. Esta
     prueba deja eso comprobado en vez de asumido. */
  const tabla = (n) =>
    '<p><strong> Tabla ' + n + '. Códigos SIC utilizados</strong></p>' +
    '<table><tr><th><p><strong> Criterio de búsqueda</strong></p></th></tr>' +
    '<tr><th><p> Código SIC primario:</p></th><td><p> Entre 1111 y 2222</p></td></tr>' +
    '<tr><th><p> Y</p></th></tr>' +
    '<tr><th><p> Palabra clave:</p></th><td><p> Contiene viejo</p></td></tr></table>';
  const html = tabla(18) + tabla(19) + tabla(20);
  const estudio = {
    criteriosScreening: [
      { conector: null, etiqueta: 'Código SIC primario:', valor: 'Entre 7371 y 7375' },
      { conector: 'O', etiqueta: 'Palabra clave:', valor: 'Contiene juegos' },
    ],
  };
  const avisos = [];
  const salida = actualizarTablasMotorHtml(html, estudio, avisos);

  assert.ok(!salida.includes('Tabla 18. Códigos SIC utilizados'), 'se eliminó la tabla 18');
  assert.ok(!salida.includes('Tabla 20. Códigos SIC utilizados'), 'se eliminó la tabla 20');
  assert.ok(salida.includes('Tabla 19. Códigos SIC utilizados'), 'se conservó la tabla 19 (la del medio)');
  assert.ok(salida.includes('Entre 7371 y 7375'), 'la tabla 19 se actualizó con los criterios nuevos');
  assert.ok(!salida.includes('Entre 1111 y 2222'), 'no debe sobrevivir el criterio del año anterior');
  assert.ok(!avisos.includes('Códigos SIC utilizados'), 'las tres tablas estaban, no hay nada que avisar');
});

test('sin criterios de cribado las tablas de SIC se conservan y se avisa', () => {
  const html =
    '<p><strong> Tabla 13. Códigos SIC utilizados</strong></p>' +
    '<table><tr><th><p><strong> Criterio de búsqueda</strong></p></th></tr>' +
    '<tr><th><p> Código SIC primario:</p></th><td><p> Entre 1111 y 2222</p></td></tr></table>';
  const avisos = [];
  const salida = actualizarTablasMotorHtml(html, {}, avisos);
  assert.strictEqual(salida, html, 'la tabla no debe alterarse');
  assert.ok(avisos.includes('Códigos SIC utilizados'), 'y hay que avisarlo');
});

test('actualizarApartadosMacroHtml reemplaza la prosa localizándola por encabezado', () => {
  const html = [
    '<h2>A. Análisis del Panorama de la Economía Mundial</h2>',
    '<p>Texto de END GAME sobre el mundo, 2024.</p>',
    '<h3>Crecimiento del PIB Mundial (2024-2026)</h3>',
    '<h3>Tasas de Inflación Global (2024-2026)</h3>',
    '<h3>Proyecciones de Crecimiento del PIB por Región/País (2026)</h3>',
    '<h2>B. Análisis del panorama de la economía colombiana</h2>',
    '<p>Texto de END GAME sobre Colombia, 2024.</p>',
    '<h3>Crecimiento del PIB en Colombia (2024-2026)</h3>',
    '<h3>Inflación en Colombia (2024 vs. Meta 2025)</h3>',
    '<h3>Tasa de Intervención del Banco de la República (Marzo 2023 - Diciembre 2024)</h3>',
    '<h3>Tasa Representativa del Mercado (TRM) Promedio (2023-2024)</h3>',
    '<h3>Tasa de Desempleo en Colombia (2024 vs. Proyección 2025)</h3>',
    '<h2>Análisis del Sector de la industria del software</h2>',
  ].join('');

  const datosMacro = {
    narrativa: {
      mundial: '<p>Narrativa real del mundo.</p>',
      colombia: '<p>Narrativa real de Colombia.</p>',
    },
  };
  const avisos = [];
  const salida = actualizarApartadosMacroHtml(html, datosMacro, 2026, avisos);

  assert.match(salida, /Narrativa real del mundo\./);
  assert.match(salida, /Narrativa real de Colombia\./);
  assert.doesNotMatch(salida, /Texto de END GAME/);
  assert.match(salida, /Crecimiento del PIB Mundial/); // la tabla que sigue no se toca
  assert.equal(avisos.length, 0);
});

test('actualizarApartadosMacroHtml reemplaza también los huecos intermedios, y protege una tabla que caiga en uno', () => {
  const html = [
    '<h2>A. Análisis del Panorama de la Economía Mundial</h2>',
    '<p>Texto de END GAME sobre el mundo, 2024.</p>',
    '<h3>Crecimiento del PIB Mundial (2024-2026)</h3>',
    '<table><tr><td>fila real de PIB Mundial</td></tr></table>',
    '<h3>Tasas de Inflación Global (2024-2026)</h3>',
    '<table><tr><td>fila real de Inflación Global</td></tr></table>',
    '<h3>Proyecciones de Crecimiento del PIB por Región/País (2026)</h3>',
    '<h2>B. Análisis del panorama de la economía colombiana</h2>',
    '<p>Texto de END GAME sobre Colombia, 2024.</p>',
    '<h3>Crecimiento del PIB en Colombia (2024-2026)</h3>',
    '<h3>Inflación en Colombia (2024 vs. Meta 2025)</h3>',
    '<h4>Política Monetaria</h4>',
    '<p>La tasa de intervención descendió al 9,50 %, texto viejo de referencia bastante largo para superar el umbral.</p>',
    '<h3>Tasa de Intervención del Banco de la República (Marzo 2023 - Diciembre 2024)</h3>',
    '<h3>Tasa Representativa del Mercado (TRM) Promedio (2023-2024)</h3>',
    '<h3>Tasa de Desempleo en Colombia (2024 vs. Proyección 2025)</h3>',
    '<h2>Análisis del Sector de la industria del software</h2>',
  ].join('');

  const datosMacro = {
    narrativa: { mundial: '<p>Narrativa real del mundo.</p>', colombia: '<p>Narrativa real de Colombia.</p>' },
  };
  const salida = actualizarApartadosMacroHtml(html, datosMacro, 2026, []);

  assert.doesNotMatch(salida, /texto viejo de referencia/);
  /* El subtítulo "Política Monetaria" cae DENTRO del hueco entre "Inflación en
     Colombia" y "Intervención del Banco" y se reemplaza junto con la prosa que
     describía — mismo criterio que la ruta .docx (ver docxRelleno.test.js): es la
     forma robusta de que funcione igual sin importar cómo cada plantilla titule ese
     hueco intermedio. Lo que sí no puede perderse son las tablas reales. */
  assert.match(salida, /fila real de PIB Mundial/);
  assert.match(salida, /fila real de Inflación Global/);
  assert.match(salida, /Tasa de Intervención del Banco de la República/);
});

test('actualizarApartadosMacroHtml ignora una entrada de Tabla de Contenido con número de página', () => {
  const html = [
    '<p>A. Análisis del Panorama de la Economía Mundial ... 13</p>', // entrada de TOC
    '<p>B. Análisis del panorama de la economía colombiana ... 20</p>', // otra entrada de TOC
    '<h2>A. Análisis del Panorama de la Economía Mundial</h2>', // encabezado real
    '<p>Texto de END GAME sobre el mundo, 2024.</p>',
    '<h3>Crecimiento del PIB Mundial (2024-2026)</h3>',
  ].join('');

  const datosMacro = { narrativa: { mundial: '<p>Narrativa real del mundo.</p>' } };
  const salida = actualizarApartadosMacroHtml(html, datosMacro, 2026, []);

  assert.doesNotMatch(salida, /Texto de END GAME/);
  assert.match(salida, /Narrativa real del mundo\./);
  assert.match(salida, /economía colombiana \.\.\. 20/, 'la entrada de TOC de colombia no se toca');
});

test('actualizarApartadosMacroHtml usa el marcador de pendiente si no hay narrativa, y avisa', () => {
  const html = [
    '<h2>A. Análisis del Panorama de la Economía Mundial</h2>',
    '<p>Texto de END GAME sobre el mundo, 2024.</p>',
    '<h3>Crecimiento del PIB Mundial (2024-2026)</h3>',
  ].join('');

  const avisos = [];
  const salida = actualizarApartadosMacroHtml(html, null, 2026, avisos);

  assert.doesNotMatch(salida, /Texto de END GAME/);
  assert.match(salida, /\[Actualizar con el análisis del panorama de la economía mundial/);
  assert.ok(avisos.length >= 1);
});

test('localizarHitosHtml no confunde un párrafo de prosa largo con el título real', () => {
  const html = [
    '<h3>PIB Mundial</h3>',
    '<p>La inflación global ha venido descendiendo gradualmente desde su pico en 2022, en parte por la normalización de las cadenas de suministro y la reducción de precios internacionales.</p>',
    '<h3>Inflación Global</h3>',
  ].join('');
  const hitos = localizarHitosHtml(html, ['PIB Mundial', 'Inflación Global']);
  assert.ok(hitos[0]);
  assert.ok(hitos[1]);
  assert.equal(hitos[1].inicio, html.indexOf('<h3>Inflación Global'), 'encontró el encabezado real, no el párrafo de prosa que lo menciona de pasada');
});

test('localizarHitosHtml: un título ausente no bloquea los que vienen después', () => {
  /* Un informe de referencia que predata un título —el caso de una plantilla más
     vieja que la sección que se busca insertar— no puede dejar sin buscar TODO lo
     que sigue: antes el cursor se quedaba clavado en el título ausente para siempre. */
  const html = [
    '<h3>Análisis del Sector</h3>',
    '<h3>Datos Clave del Sector</h3>',
    '<h3>Conclusiones y Perspectivas</h3>',
  ].join('');
  const hitos = localizarHitosHtml(
    html, ['Análisis del Sector', 'Comportamiento del Sector', 'Datos Clave del Sector', 'Conclusiones y Perspectivas']
  );
  assert.ok(hitos[0]);
  assert.equal(hitos[1], null, '"Comportamiento del Sector" no está en este documento');
  assert.ok(hitos[2], '"Datos Clave del Sector" sí está, y debe encontrarse pese al hueco anterior');
  assert.ok(hitos[3], '"Conclusiones y Perspectivas" también debe encontrarse');
});

test('reemplazarHuecosHtml inserta de respaldo al final de la sección cuando falta un título intermedio, pero sí se encuentra el límite final', () => {
  const html = '<h2>Encabezado A</h2><p>Prosa de A.</p><h2>Encabezado C</h2>';
  const avisos = [];
  const salida = reemplazarHuecosHtml(
    html,
    ['Encabezado A', 'Encabezado B', 'Encabezado C'],
    [() => null, () => '<p>Contenido de B, sin ancla propia.</p>'],
    avisos, 'III.X'
  );
  assert.match(salida, /Contenido de B, sin ancla propia\./);
  assert.ok(salida.indexOf('Contenido de B') < salida.indexOf('Encabezado C'));
  assert.ok(avisos.some((a) => /no se encontró el rótulo «Encabezado B»/.test(a)));
  assert.ok(avisos.some((a) => /"Encabezado B".*se insertó al final de esta sección/.test(a)));
});

test('reemplazarHuecosHtml NO inserta de respaldo si ni siquiera el límite final aparece', () => {
  const html = '<p>Un documento que no tiene nada que ver con esta cadena de títulos.</p>';
  const avisos = [];
  const salida = reemplazarHuecosHtml(
    html,
    ['Encabezado A', 'Encabezado B', 'Encabezado C'],
    [() => '<p>No debería aparecer.</p>', () => '<p>Tampoco esto.</p>'],
    avisos, 'III.X'
  );
  assert.doesNotMatch(salida, /No debería aparecer/);
  assert.doesNotMatch(salida, /Tampoco esto/);
});

test('reemplazarHuecosHtml avisa una vez por rótulo ausente, no una por par consecutivo', () => {
  /* Cada rótulo delimita DOS apartados, así que el aviso por pares repetía la misma
     causa: con «Dos» y «Tres» ausentes salían tres avisos de par para dos rótulos. Se
     filtran los de respaldo, que son otra cosa y sí van uno por apartado insertado. */
  const html = '<h2>Uno</h2><p>prosa</p><h2>Cuatro</h2>';
  const avisos = [];
  reemplazarHuecosHtml(html, ['Uno', 'Dos', 'Tres', 'Cuatro'],
    [() => '<p>a</p>', () => '<p>b</p>', () => '<p>c</p>'], avisos, 'III.B');
  const porRotulo = avisos.filter((a) => a.includes('no se encontró el rótulo'));
  assert.equal(porRotulo.length, 2, 'uno por cada rótulo que falta, no tres por los pares');
  assert.ok(porRotulo.some((a) => a.includes('«Dos»')), 'nombra el rótulo «Dos»');
  assert.ok(porRotulo.some((a) => a.includes('«Tres»')), 'nombra el rótulo «Tres»');
  assert.ok(porRotulo.every((a) => a.startsWith('III.B')), 'y cada aviso dice de qué sección habla');
});

test('reemplazarHuecosHtml no repite el aviso de un rótulo que cierra una cadena y abre la siguiente', () => {
  /* «Análisis del Sector» cierra la cadena de la economía colombiana y abre la del
     sector: sin deduplicar, un solo rótulo mal escrito se avisaba dos veces. */
  const html = '<h2>Uno</h2><p>prosa</p><h2>Tres</h2>';
  const avisos = [];
  reemplazarHuecosHtml(html, ['Uno', 'Dos'], [() => null], avisos, 'III.B');
  reemplazarHuecosHtml(html, ['Dos', 'Tres'], [() => null], avisos, 'III.C');
  const porRotulo = avisos.filter((a) => a.includes('no se encontró el rótulo'));
  assert.equal(porRotulo.length, 1, 'el rótulo ausente se avisa una sola vez, no una por cadena');
  assert.ok(porRotulo[0].includes('«Dos»'));
});

/* El respaldo INSERTA en el cursor, no reemplaza el tramo: cuando el rótulo ausente solo
   está escrito de otro modo, su subsección sigue en el documento y debe sobrevivir. */
test('el respaldo no se lleva la subsección intermedia cuyo rótulo no se reconoció', () => {
  const html = '<h2>Uno</h2><p>prosa uno</p><h3>Rotulo escrito de otro modo</h3>'
    + '<p>prosa que hay que conservar</p><h2>Cuatro</h2>';
  const salida = reemplazarHuecosHtml(html, ['Uno', 'Dos', 'Cuatro'],
    [() => '<p>nuevo</p>', () => '<p>nuevo</p>'], [], 'III.B');
  assert.match(salida, /prosa que hay que conservar/, 'no se borra el texto del cliente');
  assert.match(salida, /Rotulo escrito de otro modo/, 'ni su encabezado');
});

test('reemplazarHuecosHtml protege una tabla que cae justo después de un hito', () => {
  const html = '<h2>Encabezado A</h2><table><tr><td>dato real</td></tr></table><h2>Encabezado B</h2>';
  const salida = reemplazarHuecosHtml(html, ['Encabezado A', 'Encabezado B'], [() => '<p>marcador</p>'], []);
  assert.match(salida, /<table><tr><td>dato real/, 'la tabla entera sigue intacta, sin texto insertado dentro');
});

test('localizarHitosHtml acepta un arreglo de sinónimos por posición', () => {
  /* El contenido es universal (la sección de desempleo es la misma para todos los
     informes), pero el documento de referencia de cada contribuyente es un archivo
     distinto que un consultor distinto redactó en su momento — "Tasa de Desempleo" y
     "Desempleo en Colombia" son el mismo apartado con otra redacción. */
  const html = '<h3>Uno</h3><h3>Tasa de Desempleo</h3><h3>Tres</h3>';
  const hitos = localizarHitosHtml(html, ['Uno', ['Desempleo en Colombia', 'Tasa de Desempleo'], 'Tres']);
  assert.ok(hitos[1], 'debió reconocer el sinónimo "Tasa de Desempleo"');
});

test('reemplazarHuecosHtml encuentra el hito con un sinónimo, y el aviso muestra un nombre legible si falla', () => {
  const htmlOk = '<h2>Encabezado A</h2><h2>Tasa de Desempleo</h2>';
  const salidaOk = reemplazarHuecosHtml(
    htmlOk,
    ['Encabezado A', ['Desempleo en Colombia', 'Tasa de Desempleo']],
    [() => '<p>Prosa nueva.</p>'],
    []
  );
  assert.match(salidaOk, /Prosa nueva\./);

  const avisos = [];
  reemplazarHuecosHtml(
    '<h2>Encabezado A</h2>',
    ['Encabezado A', ['Desempleo en Colombia', 'Tasa de Desempleo']],
    [() => 'nunca se usa'],
    avisos
  );
  assert.ok(avisos.some((a) => a.includes('Desempleo en Colombia')));
  assert.ok(!avisos.some((a) => a.includes('[object Object]')));
});

test('actualizarApartadoSectorialHtml reemplaza los cuatro bloques y deja intacta la tabla de datos clave', () => {
  const html = [
    '<h2>Análisis del Sector de la industria del software y de los videojuegos</h2>',
    '<h3>Comportamiento del Sector de la Industria del Software y de los Videojuegos en 2024 y Comparación con 2023</h3>',
    '<p>Texto viejo de comportamiento.</p>',
    '<h3>Datos Clave del Sector de la Industria del Software y de los Videojuegos en Colombia (2023 vs. 2024)</h3>',
    '<table><tr><td>fila vieja</td></tr></table>',
    '<h3>Importaciones y exportaciones del sector de la industria del software y de los videojuegos</h3>',
    '<p>Texto viejo de comercio.</p>',
    '<h3>¿Qué se proyecta para el sector de la industria del software y de los videojuegos en 2025?</h3>',
    '<p>Texto viejo de proyección.</p>',
    '<h3>Conclusiones y Perspectivas</h3>',
    '<p>Texto viejo de conclusiones.</p>',
    '<h2>ANÁLISIS ECONÓMICO</h2>',
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
        datosClaveTabla: [{ indicador: 'Empleo', valorAnterior: '250.000', valorActual: '260.000' }],
      },
    },
  };

  const salida = actualizarApartadoSectorialHtml(html, analisisSector, { anio: 2026 }, 2026, []);
  assert.match(salida, /Comportamiento real 2026\./);
  assert.match(salida, /Comercio exterior real 2026\./);
  assert.match(salida, /Proyección real 2026\./);
  assert.match(salida, /Conclusiones reales 2026\./);
  assert.doesNotMatch(salida, /Texto viejo/);
  assert.match(salida, /<table>/); // la tabla sigue ahí: es de una sola fila, no hay molde que clonar
});

/* Tabla de datos clave como la trae la plantilla de END GAME: encabezado con los DOS años
   del informe anterior y filas de datos de aquel contribuyente. */
const TABLA_DATOS_CLAVE = '<table>'
  + '<tr><th>Indicador Clave</th><th>2023</th><th>2024</th></tr>'
  + '<tr><td>Empleo Sector Software y TI</td><td>250.000 empleos (+13,69% vs 2022)</td><td>Crecimiento sostenido</td></tr>'
  + '<tr><td>Exportaciones Software y TI</td><td>US$883 millones (+77% vs 2022)</td><td>Crecimiento de servicios +15,4%</td></tr>'
  + '</table>';

const htmlSectorial = (tabla) => [
  '<h2>Análisis del Sector de la industria del software y de los videojuegos</h2>',
  '<h3>Comportamiento del Sector de la Industria del Software y de los Videojuegos en 2024 y Comparación con 2023</h3>',
  '<p>Texto viejo de comportamiento.</p>',
  '<h3>Datos Clave del Sector de la Industria del Software y de los Videojuegos en Colombia (2023 vs. 2024)</h3>',
  tabla,
  '<h3>Importaciones y exportaciones del sector de la industria del software y de los videojuegos</h3>',
  '<p>Texto viejo de comercio.</p>',
  '<h3>¿Qué se proyecta para el sector de la industria del software y de los videojuegos en 2025?</h3>',
  '<p>Texto viejo de proyección.</p>',
  '<h3>Conclusiones y Perspectivas</h3>',
  '<p>Texto viejo de conclusiones.</p>',
  '<h2>ANÁLISIS ECONÓMICO</h2>',
].join('');

const sectorConTabla = {
  porAnio: {
    2025: {
      tituloSector: 'de los videojuegos y servicios digitales creativos',
      narrativa: {
        comportamiento: '<p>Comportamiento real 2025.</p>',
        comercioExterior: '<p>Comercio exterior real 2025.</p>',
        proyeccion: '<p>Proyección real 2025.</p>',
        conclusiones: '<p>Conclusiones reales 2025.</p>',
      },
      datosClaveTabla: [
        { indicador: 'Tamaño del mercado (Millones USD)', valorAnterior: '802,0', valorActual: '802,3' },
        { indicador: 'Estudios de desarrollo activos', valorAnterior: '80', valorActual: '100' },
        { indicador: 'Talento humano capacitado', valorAnterior: '', valorActual: '262.000' },
      ],
    },
  },
};

test('actualizarApartadoSectorialHtml regenera las filas de la tabla de datos clave', () => {
  const salida = actualizarApartadoSectorialHtml(
    htmlSectorial(TABLA_DATOS_CLAVE), sectorConTabla, { anio: 2025 }, 2025, []);

  assert.match(salida, /Tamaño del mercado \(Millones USD\)/);
  assert.match(salida, /Estudios de desarrollo activos/);
  /* Las cifras del contribuyente anterior no pueden sobrevivir: es el fallo que esta
     regeneración existe para evitar. */
  assert.doesNotMatch(salida, /250\.000 empleos/);
  assert.doesNotMatch(salida, /US\$883 millones/);
  /* `valorAnterior` vacío se publica como hueco visible, nunca como el valor de al lado. */
  assert.match(salida, /<td>—<\/td>/);
});

test('actualizarApartadoSectorialHtml pone el año del estudio en el encabezado y el rótulo de la tabla', () => {
  const salida = actualizarApartadoSectorialHtml(
    htmlSectorial(TABLA_DATOS_CLAVE), sectorConTabla, { anio: 2025 }, 2025, []);

  assert.match(salida, /<th>2024<\/th><th>2025<\/th>/);
  assert.match(
    salida,
    /Datos Clave del Sector de la Industria de los videojuegos y servicios digitales creativos en Colombia \(2024 vs\. 2025\)/
  );
  assert.doesNotMatch(salida, /\(2023 vs\. 2024\)/);
});

test('actualizarApartadoSectorialHtml retira las notas al pie de la tabla vieja y cita las nuevas fuentes', () => {
  /* Como en la plantilla de END GAME: tras la tabla vienen las notas al pie de SUS cifras,
     antes del encabezado siguiente. Dejarlas ahí atribuye a Canal Trece 2024 unas cifras
     de 2025. */
  const html = htmlSectorial(TABLA_DATOS_CLAVE).replace(
    '<h3>Importaciones y exportaciones',
    '<p>Canal Trece. (2024, agosto 29). Día del Gamer: Colombia. https://canaltrece.com.co/x</p>'
    + '<p>DANE. (s.f.). PIB Trimestral 2023-2024.</p>'
    + '<h3>Importaciones y exportaciones'
  );
  const conFuentes = {
    porAnio: {
      2025: {
        ...sectorConTabla.porAnio[2025],
        actualizadoEn: new Date('2026-08-13T15:42:46Z'),
        datosClaveTabla: [
          { indicador: 'Tamaño del mercado', valorAnterior: '802,0', valorActual: '802,3',
            fuente: 'Informes de Expertos', fuenteUrl: 'https://informesdeexpertos.com/x' },
          { indicador: 'Estudios activos', valorAnterior: '80', valorActual: '100',
            fuente: 'ProColombia', fuenteUrl: 'https://procolombia.co/y' },
          /* Fuente repetida: se cita una sola vez. */
          { indicador: 'Usuarios', valorAnterior: '10,0', valorActual: '10,0', fuente: 'ProColombia' },
        ],
      },
    },
  };

  const salida = actualizarApartadoSectorialHtml(html, conFuentes, { anio: 2025 }, 2025, []);
  assert.doesNotMatch(salida, /Canal Trece/);
  assert.doesNotMatch(salida, /PIB Trimestral 2023-2024/);
  assert.match(salida, /FUENTE:/);
  assert.match(salida, /Informes de Expertos \(https:\/\/informesdeexpertos\.com\/x\)/);
  assert.match(salida, /consultado el/);
  assert.strictEqual((salida.match(/ProColombia/g) || []).length, 1);
});

test('actualizarApartadoSectorialHtml no borra ese hueco si la corrida no dejó fuentes', () => {
  /* Sin fuentes verificadas no hay con qué sustituir la nota al pie, y borrarla sin poner
     nada deja la tabla sin la fuente que exige el numeral 4 del artículo 1.2.2.2.1.5. */
  const html = htmlSectorial(TABLA_DATOS_CLAVE).replace(
    '<h3>Importaciones y exportaciones',
    '<p>Canal Trece. (2024, agosto 29).</p><h3>Importaciones y exportaciones'
  );
  const salida = actualizarApartadoSectorialHtml(html, sectorConTabla, { anio: 2025 }, 2025, []);
  assert.match(salida, /Canal Trece/);
});

test('actualizarApartadoSectorialHtml escribe los encabezados de III.C con la industria y los años del estudio', () => {
  const salida = actualizarApartadoSectorialHtml(
    htmlSectorial(TABLA_DATOS_CLAVE), sectorConTabla, { anio: 2025 }, 2025, []);

  assert.match(salida, /Análisis del Sector de la industria de los videojuegos y servicios digitales creativos/);
  assert.match(
    salida,
    /Comportamiento del Sector de la Industria de los videojuegos y servicios digitales creativos en 2025 y Comparación con 2024/
  );
  assert.match(salida, /Importaciones y exportaciones del sector de la industria de los videojuegos y servicios digitales creativos/);
  /* La proyección es del año SIGUIENTE al gravable. */
  assert.match(salida, /¿Qué se proyecta para el sector de la industria de los videojuegos y servicios digitales creativos en 2026\?/);

  assert.doesNotMatch(salida, /en 2024 y Comparación con 2023/);
  assert.doesNotMatch(salida, /para el sector de la industria del software y de los videojuegos en 2025/);
  /* "Conclusiones y Perspectivas" no lleva industria ni años: se deja como estaba. */
  assert.match(salida, /Conclusiones y Perspectivas/);
});

test('actualizarApartadoSectorialHtml conserva la numeración del apartado del cliente', () => {
  const html = htmlSectorial(TABLA_DATOS_CLAVE)
    .replace('<h2>Análisis del Sector', '<h2>C. Análisis del Sector');
  const salida = actualizarApartadoSectorialHtml(html, sectorConTabla, { anio: 2025 }, 2025, []);
  assert.match(salida, /<h2>C\. Análisis del Sector de la industria de los videojuegos/);
});

test('actualizarApartadoSectorialHtml no toca los encabezados si no hay corrida del año', () => {
  const salida = actualizarApartadoSectorialHtml(
    htmlSectorial(TABLA_DATOS_CLAVE), null, { anio: 2025 }, 2025, []);
  /* Sin corrida no hay industria que escribir: inventar un encabezado sería peor que
     dejar el de la plantilla, que al menos el marcador de pendiente delata. */
  assert.match(salida, /en 2024 y Comparación con 2023/);
});

test('actualizarApartadoSectorialHtml avisa si la tabla de datos clave no se pudo regenerar', () => {
  /* Un solo `<tr>`: no hay fila de datos que sirva de molde, así que las filas no se
     pueden reescribir y la tabla se quedaría con lo que trajera la plantilla. Eso tiene
     que llegar al panel antes de radicar, no pasar en silencio. */
  const avisos = [];
  actualizarApartadoSectorialHtml(
    htmlSectorial('<table><tr><th>Indicador Clave</th><th>2023</th><th>2024</th></tr></table>'),
    sectorConTabla, { anio: 2025 }, 2025, avisos);
  assert.ok(avisos.some((a) => /Datos Clave del Sector/.test(a)), 'avisos: ' + JSON.stringify(avisos));
});

test('actualizarApartadoSectorialHtml avisa si la corrida del año no trae datos clave', () => {
  const avisos = [];
  const sinTabla = {
    porAnio: { 2025: { ...sectorConTabla.porAnio[2025], datosClaveTabla: [] } },
  };
  const salida = actualizarApartadoSectorialHtml(
    htmlSectorial(TABLA_DATOS_CLAVE), sinTabla, { anio: 2025 }, 2025, avisos);
  assert.ok(avisos.some((a) => /Datos Clave del Sector/.test(a)), 'avisos: ' + JSON.stringify(avisos));
  /* Sin datos verificados no se fabrica una tabla: se deja la de la plantilla y se avisa. */
  assert.match(salida, /250\.000 empleos/);
});

test('actualizarApartadoSectorialHtml usa el marcador de pendiente si no hay corrida para ese año', () => {
  const html = [
    '<h2>Análisis del Sector de la industria del software y de los videojuegos</h2>',
    '<h3>Comportamiento del Sector de la Industria del Software y de los Videojuegos en 2024 y Comparación con 2023</h3>',
    '<p>Texto viejo de comportamiento.</p>',
    '<h3>Datos Clave del Sector de la Industria del Software y de los Videojuegos en Colombia (2023 vs. 2024)</h3>',
    '<table><tr><td>fila vieja</td></tr></table>',
    '<h3>Importaciones y exportaciones del sector de la industria del software y de los videojuegos</h3>',
    '<p>Texto viejo de comercio.</p>',
    '<h3>¿Qué se proyecta para el sector de la industria del software y de los videojuegos en 2025?</h3>',
    '<p>Texto viejo de proyección.</p>',
    '<h3>Conclusiones y Perspectivas</h3>',
    '<p>Texto viejo de conclusiones.</p>',
    '<h2>ANÁLISIS ECONÓMICO</h2>',
  ].join('');

  const avisos = [];
  const salida = actualizarApartadoSectorialHtml(html, null, { anio: 2026 }, 2026, avisos);
  assert.doesNotMatch(salida, /Texto viejo/);
  assert.match(salida, /\[Actualizar con el análisis del comportamiento del sector/);
  assert.ok(avisos.length >= 1);
});

test('actualizarApartadosMacroHtml reemplaza el hueco de política monetaria con su propio párrafo y fuente', () => {
  const html = [
    '<h2>B. Análisis del panorama de la economía colombiana</h2>',
    '<p>Texto real de Colombia.</p>',
    '<h3>Crecimiento del PIB en Colombia (2024-2026)</h3>',
    /* Nota: evitar la frase literal "inflación en Colombia" en esta prosa — coincide
       con la clave normalizada del título "Inflación en Colombia" y
       `localizarHitosHtml` (por diseño, ver su comentario) toma por hito cualquier
       párrafo corto que la incluya, aunque sea prosa y no el encabezado real. */
    '<p>Texto de END GAME sobre la inflación colombiana, 2024, con contenido suficientemente largo.</p>',
    '<h3>Inflación en Colombia (2025 vs. Meta 2026)</h3>',
    '<p>Texto de END GAME sobre política monetaria, 2024, con contenido suficientemente largo.</p>',
    '<h3>Tasa de Intervención del Banco de la República</h3>',
    '<p>Texto de END GAME sobre TRM, 2024, con contenido suficientemente largo para el umbral.</p>',
    '<h3>Tasa Representativa del Mercado (TRM) Promedio</h3>',
    '<p>Texto de END GAME sobre desempleo, 2024, con contenido suficientemente largo para el umbral.</p>',
    '<h3>Tasa de Desempleo en Colombia</h3>',
    '<p>Texto de END GAME sobre conclusiones, 2024, con contenido suficientemente largo.</p>',
    '<h2>Análisis del Sector</h2>',
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
  const salida = actualizarApartadosMacroHtml(html, datosMacro, 2026, []);

  assert.match(salida, /tasa de intervención cerró en 12,00/);
  /* Mismo formato que imprime la tabla de esta serie justo debajo (`resolverSerie` en
     `analisisMercado.js`): URL entre paréntesis y fecha de consulta, no el formato
     "FUENTE: <fuente>, <url>" (sin fecha) que este módulo fabricaba antes por su cuenta. */
  assert.match(salida, /FUENTE: Banco de la República \(https:\/\/banrep\.gov\.co\/tasa\), consultado el/);
  assert.doesNotMatch(salida, /Texto de END GAME sobre política monetaria/);
  /* El encabezado "Inflación en Colombia" (el hito ANTERIOR a este hueco) no debe
     desaparecer: si `localizarHitosHtml` lo confunde con la prosa que lo precede, el
     título real se pierde dentro de un hueco que no le corresponde. */
  assert.match(salida, /Inflación en Colombia \(2025 vs\. Meta 2026\)/);
});

test('actualizarApartadosMacroHtml: cada tema cita la fuente/fecha de SU propia serie, no la de otra', () => {
  const PARES_TEMA_SERIE = [
    { tema: 'inflacionMundial', serieClave: 'inflacion_global' },
    { tema: 'proyeccionMundial', serieClave: 'crecimiento_por_region' },
    { tema: 'inflacionColombia', serieClave: 'inflacion_colombia' },
    { tema: 'politicaMonetaria', serieClave: 'tasa_intervencion' },
    { tema: 'tasaCambio', serieClave: 'trm_promedio' },
    { tema: 'mercadoLaboral', serieClave: 'desempleo_colombia' },
  ];

  const html = [
    '<h2>A. Análisis del Panorama de la Economía Mundial</h2>',
    '<p>Narrativa mundial.</p>',
    '<h3>Crecimiento del PIB Mundial (2024-2026)</h3>',
    '<h3>INFLACIÓN MUNDIAL</h3>',
    '<h3>Tasas de Inflación Global (2024-2026)</h3>',
    '<h3>Proyecciones de Crecimiento del PIB por Región/País (2026)</h3>',
    '<h2>B. Análisis del panorama de la economía colombiana</h2>',
    '<p>Narrativa colombia.</p>',
    '<h3>Crecimiento del PIB en Colombia (2024-2026)</h3>',
    '<h3>Inflación en Colombia (2025 vs. Meta 2026)</h3>',
    '<h3>Tasa de Intervención del Banco de la República</h3>',
    '<h3>Tasa Representativa del Mercado (TRM) Promedio</h3>',
    '<h3>Tasa de Desempleo en Colombia</h3>',
    '<h2>Análisis del Sector</h2>',
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
    const salida = actualizarApartadosMacroHtml(html, datosMacro, 2026, []);

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

test('actualizarApartadosMacroHtml deja el marcador especifico de tema (no el generico) cuando falta narrativa', () => {
  const html = [
    '<h2>B. Análisis del panorama de la economía colombiana</h2>',
    '<p>Texto real de Colombia.</p>',
    '<h3>Crecimiento del PIB en Colombia (2024-2026)</h3>',
    '<p>Texto de END GAME sobre la inflación colombiana, 2024, con contenido suficientemente largo.</p>',
    '<h3>Inflación en Colombia (2025 vs. Meta 2026)</h3>',
    '<h2>Análisis del Sector</h2>',
  ].join('');

  const datosMacro = { narrativa: { mundial: '<p>Mundial.</p>', colombia: '<p>Colombia.</p>' } };
  const salida = actualizarApartadosMacroHtml(html, datosMacro, 2026, []);

  assert.match(salida, /Actualizar con datos verificados sobre la inflación en Colombia/);
  assert.doesNotMatch(salida, /este párrafo del informe de referencia se retiró/i);
});

test('actualizarApartadoSectorialHtml reemplaza el hueco de entrada con la introduccion, sin fuente', () => {
  const html = [
    '<h2>Análisis del Sector de la industria del software y los videojuegos</h2>',
    '<p>Texto de END GAME de introducción al sector, con contenido suficientemente largo para no ser un hueco vacío.</p>',
    '<h3>Comportamiento del Sector</h3>',
    '<p>Texto real de comportamiento.</p>',
    '<h3>Datos Clave del Sector</h3>',
  ].join('');

  const analisisSector = {
    porAnio: { 2025: { narrativa: {
      introduccion: '<p>El sector de videojuegos mostró dinamismo en 2025.</p>',
      comportamiento: '<p>Texto real de comportamiento.</p>',
    } } },
  };
  const salida = actualizarApartadoSectorialHtml(html, analisisSector, { anio: 2025 }, 2025, []);

  assert.match(salida, /mostró dinamismo en 2025/);
  assert.doesNotMatch(salida, /Texto de END GAME de introducción/);
});

test('actualizarApartadoSectorialHtml no fabrica un marcador si el hueco de entrada ya estaba vacío', () => {
  const html = [
    '<h2>Análisis del Sector de la industria del software y de los videojuegos</h2>',
    '<h3>Comportamiento del Sector</h3>',
    '<p>Texto real de comportamiento.</p>',
    '<h3>Datos Clave del Sector</h3>',
  ].join('');

  const analisisSector = { porAnio: { 2025: { narrativa: {
    comportamiento: '<p>Texto real de comportamiento.</p>',
  } } } };
  const salida = actualizarApartadoSectorialHtml(html, analisisSector, { anio: 2025 }, 2025, []);

  assert.doesNotMatch(salida, /Actualizar con el análisis del contexto introductorio/);
});

test('actualizarApartadoSectorialHtml inserta la introduccion aunque el hueco de entrada ya estuviera vacío', () => {
  /* Regresión: el umbral solo gatea el marcador de pendiente, nunca la narrativa
     disponible. La plantilla no trae párrafo introductorio propio ("Análisis del
     Sector" va seguido directo de "Comportamiento del Sector"), pero SÍ hay narrativa
     real y verificada lista para ese hueco — debe insertarse igual, sin que el hueco
     corto la descarte (mismo caso que el reviewer confirmó como defecto real en la
     ruta .docx, corregido en docxRelleno.js). */
  const html = [
    '<h2>Análisis del Sector de la industria del software y de los videojuegos</h2>',
    '<h3>Comportamiento del Sector</h3>',
    '<p>Texto real de comportamiento.</p>',
    '<h3>Datos Clave del Sector</h3>',
  ].join('');

  const analisisSector = { porAnio: { 2025: { narrativa: {
    introduccion: '<p>El sector de videojuegos mostró dinamismo en 2025.</p>',
    comportamiento: '<p>Texto real de comportamiento.</p>',
  } } } };
  const salida = actualizarApartadoSectorialHtml(html, analisisSector, { anio: 2025 }, 2025, []);

  assert.match(salida, /mostró dinamismo en 2025/);
  assert.doesNotMatch(salida, /Actualizar con el análisis del contexto introductorio/);
});

/* ══════ Mayúsculas ══════
   Requisito del usuario (2026-08-19): la data de la tabla de márgenes, la de la muestra y todo
   el ANEXO C se publica en mayúscula, encabezados incluidos. La tabla de RAZONES DE RECHAZO
   queda fuera, explícitamente. */

test('mayusculasEnTablaHtml sube el texto sin tocar el marcado ni las entidades', () => {
  /* `&nbsp;` en mayúscula es `&NBSP;`, que no es una entidad: Word la imprimiría en crudo en
     medio del informe. Las letras acentuadas llegan como UTF-8 y `toUpperCase` las resuelve
     bien (ó → Ó); son las entidades con nombre las que hay que dejar en paz. */
  const tabla = '<table>'
    + '<tr><th>Nombre de la Compañía</th></tr>'
    + '<tr><td><span style="font-size:9pt">Información&nbsp;base &amp; datos</span></td></tr>'
    + '</table>';
  const salida = tablas.mayusculasEnTablaHtml(tabla);
  assert.ok(salida.includes('<th>NOMBRE DE LA COMPAÑÍA</th>'), 'el encabezado no subió');
  assert.ok(salida.includes('INFORMACIÓN&nbsp;BASE &amp; DATOS'), 'el texto no subió bien');
  assert.ok(salida.includes('style="font-size:9pt"'), 'se tocó un atributo');
  assert.ok(salida.includes('<span '), 'se tocó el nombre de una etiqueta');
  assert.ok(!salida.includes('&NBSP;'), 'la entidad se rompió');
  assert.ok(!salida.includes('&AMP;'), 'la entidad se rompió');
});

test('una letra acentuada escrita como entidad sube a su entidad mayúscula', () => {
  /* El extractor de PDF emite las tildes como UTF-8, pero una plantilla que llegó por otro
     camino puede traerlas como entidad. Dejarlas intactas publicaba «INFORMACIóN» —una
     minúscula en medio de una celda en mayúsculas—, visto en la prueba de humo del 2026-08-19.
     `&oacute;` y `&Oacute;` son entidades distintas y la segunda es la que toca. */
  const salida = tablas.mayusculasEnTablaHtml(
    '<table><tr><td>Informaci&oacute;n de la compa&ntilde;&iacute;a</td></tr></table>');
  assert.ok(salida.includes('INFORMACI&Oacute;N DE LA COMPA&Ntilde;&Iacute;A'),
    'las entidades de letra acentuada no subieron: ' + salida);
});

/* Las mismas comparables, con la caja mezclada que traen las bases de datos. */
const ESTUDIO_MIXTO = {
  ...ESTUDIO,
  comparables: [
    { name: 'Zeta Comparable Ltd', s: 5000, c: 3500, op: 900, amb: 'Int' },
    { name: 'Omega Comparable Plc', s: 8000, c: 5600, op: 1600, amb: 'Int' },
  ],
};

test('la muestra de comparables se publica en mayúscula, encabezado incluido', () => {
  const html = '<p>Tabla 17. Muestra Compañías comparables</p>'
    + TABLA_3COL(['Número', 'Nombre de la Compañía', 'Ámbito']);
  const salida = actualizarTablasMotorHtml(html, ESTUDIO_MIXTO, []);
  assert.match(salida, /ZETA COMPARABLE LTD/);
  assert.ok(!salida.includes('Zeta Comparable Ltd'), 'quedó una razón social sin subir');
  assert.match(salida, /NOMBRE DE LA COMPAÑÍA/, 'el encabezado de la plantilla no subió');
  assert.ok(!salida.includes('Nombre de la Compañía'));
});

test('los márgenes de las comparables se publican en mayúscula', () => {
  const html = conRotulo('Tabla 19. Margen Operacional Compañías Comparables',
    '<table><tr><th>Comparables</th><th>MO no ajustado</th><th>MO ajustado</th></tr>'
    + '<tr><td><strong>viejo</strong></td><td>1%</td><td>2%</td></tr></table>');
  const salida = actualizarTablasMotorHtml(html, ESTUDIO_MIXTO, []);
  assert.match(salida, /OMEGA COMPARABLE PLC/);
  assert.ok(!salida.includes('Omega Comparable Plc'));
  assert.match(salida, /MO NO AJUSTADO/, 'el encabezado no subió');
  assert.ok(!salida.includes('MO no ajustado'));
});

test('las razones de rechazo NO se pasan a mayúscula', () => {
  /* Excluida a mano por el usuario (2026-08-19). Va con su propio test porque es una
     excepción a una regla, y una excepción sin test es una regla que alguien va a
     "arreglar" el día que le parezca inconsistente. */
  const html = '<p>Tabla 16. Razones de rechazo</p>'
    + TABLA_3COL(['Filtro aplicado', 'Filtros aplicado', 'N° por filtro']);
  const salida = actualizarTablasMotorHtml(html, { ...ESTUDIO, embudoSeleccion: EMBUDO }, []);
  assert.match(salida, /Compañías holding o de grupo/, 'la razón de rechazo se pasó a mayúscula');
  assert.match(salida, /Filtro aplicado/, 'el encabezado de razones se pasó a mayúscula');
  });

  /* ══════ Reescritura de fuentes (reescribirFuenteHtml) ══════ */

  test('reescribirFuenteHtml reemplaza todo el contenido del párrafo previniendo fugas con runs partidos', () => {
  const casos = [
    {
      entrada: '<p><strong>FUENTE:</strong> Información suministrada por CLIENTE ANTERIOR S.A.</p>',
      esperado: '<p><strong>FUENTE: la Administración de la Compañía.</strong></p>',
    },
    {
      entrada: '<p><strong>FUENTE: </strong><strong>Información de CLIENTE ANTERIOR S.A.</strong></p>',
      esperado: '<p><strong>FUENTE: la Administración de la Compañía.</strong></p>',
    },
    {
      entrada: '<p><strong>FUENTE:</strong><span style="font-size:9pt"> Información de CLIENTE ANTERIOR S.A.</span></p>',
      esperado: '<p><strong>FUENTE: la Administración de la Compañía.</strong></p>',
    },
  ];

  for (const { entrada, esperado } of casos) {
    const salida = tablas.reescribirFuenteHtml(entrada, 0, 'la Administración de la Compañía.');
    assert.strictEqual(salida, esperado);
    assert.ok(!salida.includes('CLIENTE ANTERIOR S.A.'), 'sobrevivió el cliente anterior');
  }
  });

  test('reescribirFuenteHtml reconoce FUENTES en plural', () => {
  const entrada = '<p><strong>FUENTES:</strong> Información de CLIENTE ANTERIOR S.A.</p>';
  const salida = tablas.reescribirFuenteHtml(entrada, 0, 'la Administración de la Compañía.');
  assert.strictEqual(salida, '<p><strong>FUENTES: la Administración de la Compañía.</strong></p>');
  assert.ok(!salida.includes('CLIENTE ANTERIOR S.A.'), 'sobrevivió el cliente anterior en plural');
  });

  test('reescribirFuenteHtml no modifica si no hay línea de fuente', () => {
  const entrada = '<p>Prosa que sigue.</p>';
  const salida = tablas.reescribirFuenteHtml(entrada, 0, 'la Administración de la Compañía.');
  assert.strictEqual(salida, entrada);
  });

