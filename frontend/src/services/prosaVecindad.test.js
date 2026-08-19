import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  textoVisibleConMapa, escribirEnTextoVisible, cifrasDe, rotulosDe, emparejarPorVecindad,
  sincronizarCifrasDeProsa, RX_CIFRA_PCT,
} from './prosaVecindad.js';

const PARRAFO_HTML = /<p\b[^>]*>[\s\S]*?<\/p>/gi;

const ROTULOS = [
  { clave: 'p25', rx: /(?:el\s+)?percentil\s+25/i },
  { clave: 'p75', rx: /(?:el\s+)?percentil\s+75/i },
  { clave: 'med', rx: /(?:la\s+)?mediana/i },
];

/* ══════ el texto visible y el mapa de vuelta ══════ */

test('el texto visible deja fuera las etiquetas y resuelve las entidades', () => {
  const { plano } = textoVisibleConMapa('<p>la <strong>mediana</strong>&nbsp;es 5&nbsp;%</p>');
  assert.equal(plano, 'la mediana es 5 %');
});

test('cada carácter del plano apunta al tramo del original que lo produjo', () => {
  /* Un tramo por carácter y no un desplazamiento global: `&amp;` ocupa uno visible y cinco del
     original, así que sumar longitudes se desalinea a la primera. */
  const src = '<p>A&amp;B 7 %</p>';
  const mapa = textoVisibleConMapa(src);
  assert.equal(mapa.plano, 'A&B 7 %');
  for (let i = 0; i < mapa.plano.length; i += 1) {
    const tramo = src.slice(mapa.desde[i], mapa.hasta[i]);
    const esperado = i === 1 ? '&amp;' : mapa.plano[i];
    assert.equal(tramo, esperado, 'el tramo del carácter ' + i + ' no cuadra: ' + tramo);
  }
});

test('el texto borrado con control de cambios no se lee', () => {
  /* `w:delText` es texto que Word no muestra. Contar sus cifras nos haría emparejar contra lo
     que el revisor no ve, y sustituirlas escribiría en una revisión rechazada. */
  const ooxml = '<w:p><w:r><w:delText>la mediana con 1,000 %</w:delText></w:r>'
    + '<w:r><w:t>la mediana con 2,000 %</w:t></w:r></w:p>';
  const { plano } = textoVisibleConMapa(ooxml);
  assert.equal(plano, 'la mediana con 2,000 %');
});

test('las instrucciones de campo tampoco se leen', () => {
  const ooxml = '<w:p><w:r><w:instrText> PAGEREF _Toc123 </w:instrText></w:r>'
    + '<w:r><w:t>Mediana</w:t></w:r></w:p>';
  assert.equal(textoVisibleConMapa(ooxml).plano, 'Mediana');
});

test('una etiqueta autocerrada no se lleva por delante lo que viene después', () => {
  const ooxml = '<w:p><w:r><w:br/><w:t>Mediana 5 %</w:t></w:r></w:p>';
  assert.equal(textoVisibleConMapa(ooxml).plano, 'Mediana 5 %');
});

/* ══════ escribir de vuelta ══════ */

test('escribir un tramo partido en dos runs no funde los runs', () => {
  /* Borrar un run se llevaría su `<w:rPr>` y con él el formato de lo que venga después, así que
     el texto nuevo va entero en el primer trozo y los demás quedan vacíos. */
  const ooxml = '<w:p><w:r><w:t xml:space="preserve">es </w:t></w:r>'
    + '<w:r><w:t>10.9</w:t></w:r><w:r><w:t>25%</w:t></w:r></w:p>';
  const mapa = textoVisibleConMapa(ooxml);
  assert.equal(mapa.plano, 'es 10.925%');
  const salida = escribirEnTextoVisible(ooxml, mapa, [{ inicio: 3, fin: 10, texto: '2,327 %' }]);

  assert.equal(textoVisibleConMapa(salida).plano, 'es 2,327 %');
  assert.equal((salida.match(/<w:r>/g) || []).length, 3, 'cambió el número de runs');
  assert.ok(salida.includes('xml:space="preserve"'), 'se perdió el xml:space');
});

test('dos escrituras en el mismo párrafo no se desplazan una a otra', () => {
  const html = '<p>de 1 % a 2 %</p>';
  const mapa = textoVisibleConMapa(html);
  assert.equal(mapa.plano, 'de 1 % a 2 %');
  const salida = escribirEnTextoVisible(html, mapa, [
    { inicio: 3, fin: 6, texto: '11,000 %' },
    { inicio: 9, fin: 12, texto: '22,000 %' },
  ]);
  assert.equal(salida, '<p>de 11,000 % a 22,000 %</p>');
});

/* ══════ cifras y rótulos ══════ */

test('una cifra con separador de miles se delimita entera', () => {
  /* Si el tramo fuera «234,567 %», sustituirlo dejaría «1.2,327 %» en un documento que se
     radica ante la DIAN. */
  const cifras = cifrasDe('la mediana con 1.234,567 % para el ejercicio');
  assert.equal(cifras.length, 1);
  assert.equal(cifras[0].texto, '1.234,567 %');
});

test('las cifras negativas y sin espacio antes del signo también se reconocen', () => {
  const cifras = cifrasDe('entre -1.075% y 6,418 %').map((c) => c.texto);
  assert.deepEqual(cifras, ['-1.075%', '6,418 %']);
});

test('una cifra vetada se marca pero no desaparece de la lista', () => {
  /* Sigue contando como barrera: es lo que impide que un rótulo de más allá salte por encima de
     ella a buscarse una cifra. */
  const vetos = [{ despues: /^\s*(?:superior|inferior)\b/i }];
  const cifras = cifrasDe('se eliminó el 25 % superior y la mediana es 3 %', RX_CIFRA_PCT, vetos);
  assert.equal(cifras.length, 2);
  assert.equal(cifras[0].vetada, true, 'el 25 % del método no quedó vetado');
  assert.equal(cifras[1].vetada, false);
});

test('los rótulos salen en el orden en que aparecen', () => {
  const rots = rotulosDe('el percentil 75 y la mediana y el percentil 25', ROTULOS);
  assert.deepEqual(rots.map((r) => r.clave), ['p75', 'med', 'p25']);
});

/* ══════ el emparejamiento ══════ */

const emparejar = (plano) => {
  const cifras = cifrasDe(plano);
  const rots = rotulosDe(plano, ROTULOS);
  return emparejarPorVecindad(plano, rots, cifras);
};

test('cada rótulo se lleva la cifra que tiene al lado, delante o detrás', () => {
  const { pares, sinPareja } = emparejar(
    'entre 10.925% percentil 25 y 17.258% percentil 75 y la mediana con 15.356%');
  assert.deepEqual(sinPareja, []);
  assert.deepEqual(
    pares.map((p) => [p.clave, p.cifra.texto]).sort(),
    [['med', '15.356%'], ['p25', '10.925%'], ['p75', '17.258%']],
  );
});

test('un rótulo por el medio corta el paso a la cifra de más allá', () => {
  const { pares } = emparejar('el percentil 25 y el percentil 75 valen 3 %');
  assert.deepEqual(pares.map((p) => p.clave), ['p75'],
    'el percentil 25 alcanzó una cifra que tenía otro rótulo por el medio');
});

test('una cifra por el medio también corta el paso', () => {
  const { pares } = emparejar('la mediana 1 % y 2 % de otra cosa y el percentil 75');
  assert.ok(!pares.some((p) => p.clave === 'p75' && p.cifra.texto === '1 %'),
    'el percentil 75 saltó por encima de una cifra ajena');
});

test('más allá del hueco máximo la cifra ya no es de ese rótulo', () => {
  const { sinPareja } = emparejar(
    'la mediana del conjunto de compañías comparables terminó valiendo 3 %');
  assert.deepEqual(sinPareja, ['med'], 'se emparejó una cifra a treinta caracteres del rótulo');
});

test('cruzar una conjunción liga menos que un conector, aunque quede más cerca', () => {
  /* En «la mediana con X y el percentil 75 con Y» la « y » es más corta que el « con », y por
     distancia sola el percentil 75 se llevaba la cifra de la mediana. */
  const { pares, sinPareja } = emparejar(
    'la mediana con 1.234,567 % y el percentil 75 con 2.000,111 %');
  assert.deepEqual(sinPareja, []);
  assert.deepEqual(
    pares.map((p) => [p.clave, p.cifra.texto]).sort(),
    [['med', '1.234,567 %'], ['p75', '2.000,111 %']],
  );
});

test('una cifra a la misma distancia de dos rótulos no se le da a ninguno', () => {
  const { pares, ambiguas } = emparejar('del percentil 25 6.418 % percentil 75 según');
  assert.deepEqual(pares, []);
  assert.deepEqual(ambiguas.sort(), ['p25', 'p75']);
});

test('un rótulo a la misma distancia de dos cifras tampoco elige', () => {
  const { pares, ambiguas } = emparejar('el 3 % percentil 25 4 % del rango');
  assert.deepEqual(pares, []);
  assert.deepEqual(ambiguas, ['p25']);
});

test('una cifra vetada no se asigna, pero sí tapa el paso', () => {
  const vetos = [{ despues: /^\s*superior\b/i }];
  const plano = 'se eliminó el 25 % superior y el percentil 75 del rango';
  const cifras = cifrasDe(plano, RX_CIFRA_PCT, vetos);
  const { pares, sinPareja } = emparejarPorVecindad(plano, rotulosDe(plano, ROTULOS), cifras);
  assert.deepEqual(pares, [], 'se asignó una cifra vetada');
  assert.deepEqual(sinPareja, ['p75']);
});

/* ══════ el todo-o-nada y los avisos ══════ */

const VALORES = { p25: '2,327 %', p75: '8,014 %', med: '3,775 %' };

const sincronizar = (texto, extra = {}) => sincronizarCifrasDeProsa(texto, {
  rxParrafo: PARRAFO_HTML,
  reconocedor: /percentil|mediana/i,
  rotulos: ROTULOS,
  valores: VALORES,
  ...extra,
});

test('si un rótulo del párrafo se queda sin cifra, no se escribe ninguna', () => {
  /* Publicar una cifra en el sitio equivocado es peor que dejar la de la plantilla: una cifra
     creíble en el lugar equivocado ya no se nota al revisar. */
  const html = '<p>Como se observa en el cuadro, el percentil 25 y el percentil 75 del rango de '
    + 'las comparables son 10.925 % y 17.258 % respectivamente.</p>';
  assert.equal(sincronizar(html), html);
});

test('un valor nulo no se escribe y no arrastra a los demás a la abstención', () => {
  const html = '<p>Como se observa en el cuadro, la mediana del rango de las compañías '
    + 'comparables es 15.356 % para el ejercicio analizado.</p>';
  assert.equal(sincronizar(html, { valores: { ...VALORES, med: null } }), html,
    'se escribió algo pese a no haber dato');
});

test('nunca se escribe un texto sin dígitos', () => {
  /* Un guion largo donde la plantilla tenía una cifra es peor que la cifra vieja: el hueco
     visible es para los campos del vocabulario, no para la prosa. */
  const html = '<p>Como se observa en el cuadro, la mediana del rango de las compañías '
    + 'comparables es 15.356 % para el ejercicio analizado.</p>';
  assert.equal(sincronizar(html, { valores: { ...VALORES, med: '—' } }), html);
});

test('el reporte dice qué se puso y qué quedó sin resolver', () => {
  const reporte = {};
  sincronizar('<p>Como se observa en el cuadro, el rango de las compañías comparables tiene la '
    + 'mediana con 15.356 % y el percentil 75 con 17.258 % este año.</p>', { reporte });
  assert.equal(reporte.parrafosReconocidos, 1);
  assert.equal(reporte.cifrasPuestas, 2);
  assert.deepEqual(reporte.sinResolver, []);
});

test('las anclas mandan sobre el emparejamiento', () => {
  /* El indicador del contribuyente sólo puede entrar por un ancla medida contra el informe: su
     rótulo sería «rentabilidad», que aparece por todo el documento. */
  const html = '<p>Como se observa en el cuadro, el margen de la compañía se sitúa en 4.985 % '
    + 'dentro del rango de las comparables analizadas este año.</p>';
  const salida = sincronizarCifrasDeProsa(html, {
    rxParrafo: PARRAFO_HTML,
    reconocedor: /se\s+sit[úu]a\s+en/i,
    rotulos: [],
    valores: { tpli: '6,456 %' },
    anclas: [{ clave: 'tpli', grupoCifra: 2, rx: /(se\s+sit[úu]a\s+en\s+)(-?\d+(?:[.,]\d+)?\s*%)/i }],
  });
  assert.ok(salida.includes('se sitúa en 6,456 %'), 'el ancla no entró: ' + salida);
});

test('una sustitución que no es una cifra de la tabla se aplica aparte', () => {
  const html = '<p>Como se observa en el cuadro anterior, la mediana fue 15.356 % del margen '
    + 'operacional de las comparables ajustado durante el 2024.</p>';
  const salida = sincronizar(html, {
    sustituciones: [{
      clave: 'anio',
      rx: /(ajustado\s+durante\s+el\s+)(20\d{2})/gi,
      valor: '2025',
    }],
  });
  assert.ok(salida.includes('durante el 2025'), 'el año no entró: ' + salida);
  assert.ok(salida.includes('fue 3,775 %'), 'la mediana no entró: ' + salida);
});

test('una sustitución marcada como «sólo con cifras» no entra si no se puso ninguna', () => {
  const html = '<p>Como se observa en el cuadro, el percentil 25 y el percentil 75 del rango se '
    + 'calcularon con las directrices publicadas en el año 2019 por la OCDE.</p>';
  const salida = sincronizar(html, {
    sustituciones: [{
      clave: 'anio',
      rx: /(en\s+el\s+a[ñn]o\s+)(20\d{2})/gi,
      valor: '2025',
      soloConCifras: true,
    }],
  });
  assert.equal(salida, html, 'se tocó un año en un párrafo cuyas cifras no se reconocieron');
});

test('un párrafo que el reconocedor descarta no se toca ni se tokeniza', () => {
  const html = '<p>Un párrafo cualquiera con un 5 % que no comenta ningún rango.</p>';
  assert.equal(sincronizar(html), html);
});

test('aplicarlo dos veces da el mismo resultado', () => {
  const html = '<p>Como se observa en el cuadro, el rango de las compañías comparables tiene la '
    + 'mediana con 15.356 % y el percentil 75 con 17.258 % este año.</p>';
  const una = sincronizar(html);
  assert.equal(sincronizar(una), una);
});
