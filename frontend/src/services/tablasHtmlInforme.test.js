import { test } from 'node:test';
import assert from 'node:assert';
import {
  localizarTablaHtml, reescribirFilasHtml, envolturaDe, textoPlanoHtml,
  actualizarTablasMotorHtml, reescribirCeldaHtml, TABLA_MARGENES,
  actualizarTablasMacroHtml, reescribirRotuloHtml, TABLA_CRITERIOS,
  actualizarApartadosMacroHtml, localizarHitosHtml, reemplazarHuecosHtml,
  actualizarApartadoSectorialHtml,
} from './tablasHtmlInforme.js';
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

test('reemplazarHuecosHtml protege una tabla que cae justo después de un hito', () => {
  const html = '<h2>Encabezado A</h2><table><tr><td>dato real</td></tr></table><h2>Encabezado B</h2>';
  const salida = reemplazarHuecosHtml(html, ['Encabezado A', 'Encabezado B'], [() => '<p>marcador</p>'], []);
  assert.match(salida, /<table><tr><td>dato real/, 'la tabla entera sigue intacta, sin texto insertado dentro');
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
