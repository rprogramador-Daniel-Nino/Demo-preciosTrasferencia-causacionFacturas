import { test } from 'node:test';
import assert from 'node:assert';
import {
  localizarTablaHtml, reescribirFilasHtml, envolturaDe, textoPlanoHtml,
  actualizarTablasMotorHtml, reescribirCeldaHtml, TABLA_MARGENES,
  actualizarTablasMacroHtml, reescribirRotuloHtml,
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

  assert.deepStrictEqual(avisos, [], 'las cuatro estaban');
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