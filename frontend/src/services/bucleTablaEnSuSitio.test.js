import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  envolverTablaEnBucle, retirarBucleFueraDeSitio, tablaInmediataOoxml, BUCLES_DE_TABLA,
} from './docxPlantilla.js';

/* El caso que lo motivó (usuario, 2026-08-24, con capturas): la Tabla 1 «Operación con
   vinculados económicos» del informe salía con «A | Diferencias funcionales», «B | Compañías
   holding o de grupo…», que son las RAZONES DE RECHAZO. El bucle se anclaba en el primer
   párrafo que mencionara el nombre de la tabla y en un informe eso es el ÍNDICE —en la
   plantilla de Shandong, «2.5.Razones de rechazo (Filtros Cuantitativos – Filtros
   Cualitativos)77»—, así que se envolvía en la primera tabla que hubiera después. */

const p = (texto) => `<w:p><w:r><w:t>${texto}</w:t></w:r></w:p>`;
const vacio = '<w:p/>';
/** Una tabla con una fila de encabezado y `filas` de cuerpo, de 3 celdas. */
const tabla = (...filas) => '<w:tbl>'
  + filas.map((celdas) => '<w:tr>'
    + celdas.map((c) => `<w:tc><w:p><w:r><w:t>${c}</w:t></w:r></w:p></w:tc>`).join('')
    + '</w:tr>').join('')
  + '</w:tbl>';
const doc = (...partes) => `<w:document><w:body>${partes.join('')}</w:body></w:document>`;

/* Un documento como el real: índice al principio, la Tabla 1 después y la de razones al final. */
const PLANTILLA = doc(
  p('2.5.Razones de rechazo (Filtros Cuantitativos – Filtros Cualitativos)77'),
  p('2.2.Selección de Compañías comparables72'),
  p('Tabla 1. Operación con vinculados económicos'),
  tabla(['Operaciones para analizar', 'Monto', ''],
    ['Egreso Servicios técnicos (35)', '6.719.644.000', '']),
  p('Tabla 31. Razones de rechazo (Filtros Cuantitativos – Filtros Cualitativos)'),
  tabla(['FILTRO', 'LETRA', 'N°'], ['Diferencias funcionales', 'A', '275']),
);

const CFG_RAZONES = {
  ancla: 'Razones de rechazo', coleccion: 'razonesRechazo', campos: ['criterio', 'letra', 'cantidad'],
};

/* ══════════════════ Dónde se envuelve ══════════════════ */

test('el bucle se envuelve en SU tabla, no en la primera que siga al índice', () => {
  const r = envolverTablaEnBucle(PLANTILLA, CFG_RAZONES);
  assert.ok(r.envuelta, 'debe envolverse');

  /* La marca tiene que caer después del rótulo de la Tabla 31, no en la Tabla 1. */
  const iBucle = r.xml.indexOf('{#razonesRechazo}');
  const iTabla31 = r.xml.indexOf('Tabla 31. Razones de rechazo');
  const iTabla1 = r.xml.indexOf('Tabla 1. Operación con vinculados');
  assert.ok(iBucle > iTabla31, 'el bucle quedó antes de la Tabla 31: se ancló en el índice');
  assert.ok(iBucle > iTabla1);
  /* Y la Tabla 1 sigue con sus datos intactos. */
  assert.ok(r.xml.includes('6.719.644.000'), 'la fila de la Tabla 1 no se puede tocar');
  assert.ok(r.xml.includes('Egreso Servicios técnicos (35)'));
});

test('un rótulo sin tabla detrás no sirve de ancla', () => {
  const soloIndice = doc(
    p('2.5.Razones de rechazo (Filtros Cuantitativos)77'),
    p('Un párrafo de prosa cualquiera.'),
    tabla(['A', 'B', 'C'], ['1', '2', '3']),
  );
  const r = envolverTablaEnBucle(soloIndice, CFG_RAZONES);
  assert.ok(!r.envuelta, 'no debe envolver nada');
  assert.match(r.motivo, /no va seguido de una tabla/);
});

test('entre el rótulo y la tabla caben los huecos que deja Word', () => {
  const conHuecos = doc(
    p('Tabla 31. Razones de rechazo'),
    vacio,
    '<w:bookmarkStart w:id="1" w:name="_Toc1"/><w:bookmarkEnd w:id="1"/>',
    tabla(['FILTRO', 'LETRA', 'N°'], ['Diferencias funcionales', 'A', '275']),
  );
  const r = envolverTablaEnBucle(conHuecos, CFG_RAZONES);
  assert.ok(r.envuelta, 'un párrafo vacío o una marca de índice no rompen el anclaje');
});

test('tablaInmediataOoxml distingue el hueco del contenido', () => {
  const conTabla = p('Rótulo') + vacio + tabla(['a', 'b', 'c']);
  assert.ok(tablaInmediataOoxml(conTabla, conTabla.indexOf('</w:p>') + 6) > 0);
  const conProsa = p('Rótulo') + p('Prosa por medio.') + tabla(['a', 'b', 'c']);
  assert.strictEqual(tablaInmediataOoxml(conProsa, conProsa.indexOf('</w:p>') + 6), -1);
});

/* ══════════════════ Reparar lo ya marcado ══════════════════ */

test('un bucle envuelto en la tabla equivocada se retira', () => {
  /* Como quedó la plantilla de Shandong con el marcado antiguo: el bucle dentro de la
     Tabla 1. Al retirarlo, la Tabla 1 deja de publicar las razones de rechazo. */
  const malMarcada = doc(
    p('Tabla 1. Operación con vinculados económicos'),
    tabla(['Operaciones para analizar', 'Monto', ''],
      ['{#razonesRechazo}{criterio}', '{letra}', '{cantidad}{/razonesRechazo}']),
    p('Tabla 31. Razones de rechazo (Filtros Cuantitativos)'),
    tabla(['FILTRO', 'LETRA', 'N°'], ['Diferencias funcionales', 'A', '275']),
  );
  const r = retirarBucleFueraDeSitio(malMarcada, CFG_RAZONES);
  assert.ok(r.retirado, 'tiene que retirarse');
  assert.ok(!r.xml.includes('{#razonesRechazo}'), 'la apertura del bucle se va');
  assert.ok(!r.xml.includes('{/razonesRechazo}'), 'y el cierre también');
  /* Las marcas de campo se quedan: `restaurarCamposSinDato` las devolverá a su texto. */
  assert.ok(r.xml.includes('{criterio}') && r.xml.includes('{letra}'));
});

test('un bucle que está en su sitio no se toca', () => {
  const bienMarcada = envolverTablaEnBucle(PLANTILLA, CFG_RAZONES).xml;
  const r = retirarBucleFueraDeSitio(bienMarcada, CFG_RAZONES);
  assert.ok(!r.retirado, 'no hay nada que reparar');
  assert.strictEqual(r.xml, bienMarcada);
  assert.ok(r.xml.includes('{#razonesRechazo}'), 'el bucle sigue en pie');
});

test('sin bucle en la plantilla no hay nada que retirar', () => {
  const r = retirarBucleFueraDeSitio(PLANTILLA, CFG_RAZONES);
  assert.ok(!r.retirado);
  assert.match(r.motivo, /no trae ese bucle/);
});

test('si no se puede ubicar la tabla propia, el bucle se deja donde está', () => {
  /* Quitarlo a ciegas dejaría la colección sin publicar en ninguna parte. */
  const sinTablaPropia = doc(
    p('Tabla 1. Operación con vinculados económicos'),
    tabla(['a', 'b', 'c'], ['{#razonesRechazo}{criterio}', '{letra}', '{cantidad}{/razonesRechazo}']),
  );
  const r = retirarBucleFueraDeSitio(sinTablaPropia, CFG_RAZONES);
  assert.ok(!r.retirado);
  assert.match(r.motivo, /no se pudo ubicar/);
});

test('la lista de bucles es una sola, y trae las dos colecciones', () => {
  /* El componente la usa para marcar y el relleno para reparar: con una copia en cada sitio
     podían divergir y la reparación buscaría un bucle con otro nombre. */
  assert.deepStrictEqual(BUCLES_DE_TABLA.map((b) => b.coleccion), ['comparables', 'razonesRechazo']);
});

/* ══════════════════ Multiempresa: cada plantilla rotula a su manera ══════════════════ */

test('el número de la tabla no decide nada: manda el nombre', () => {
  /* La misma tabla va numerada 14 en Beumer, 16 en Tyazhmash, 19 en Grupo VDT y 31 en
     Shandong, y hay plantillas que no la numeran. Anclar por número las rompería todas
     menos una. */
  for (const rotulo of [
    'Tabla 14. Razones de rechazo', 'Tabla 31. Razones de rechazo',
    'Razones de rechazo (Filtros Cuantitativos – Filtros Cualitativos)',
  ]) {
    const xml = doc(p(rotulo), tabla(['FILTRO', 'LETRA', 'N°'], ['Diferencias', 'A', '275']));
    const r = envolverTablaEnBucle(xml, CFG_RAZONES);
    assert.ok(r.envuelta, `no ancló con «${rotulo}»`);
  }
});

test('la caja y las tildes del rótulo no impiden el anclaje', () => {
  /* Cada firma escribe el rótulo a su manera: en versales, sin tildes o con dobles
     espacios. El resto del sistema ya compara normalizando (`claveTitulo`). */
  for (const rotulo of [
    'Tabla 20. MUESTRA COMPAÑÍAS COMPARABLES',
    'Tabla 20. Muestra Compañias Comparables',
    'Tabla 20.  Muestra   Compañías   comparables',
  ]) {
    const xml = doc(p(rotulo), tabla(['N', 'NOMBRE', 'ÁMBITO'], ['1', 'BAKER HUGHES', 'INTERNACIONAL']));
    const r = envolverTablaEnBucle(xml, BUCLES_DE_TABLA[0]);
    assert.ok(r.envuelta, `no ancló con «${rotulo}»`);
  }
});

test('una plantilla que no trae esa tabla no se toca ni se rompe', () => {
  /* Los estudios de financiamiento —método PC sobre tasas de interés— no llevan muestra de
     comparables ni razones de rechazo: INVERSIONES RASEG y PAYC son así. No hay nada que
     envolver y eso no es un fallo. */
  const sinEsaTabla = doc(p('Tabla 1. Operación con vinculados'), tabla(['a', 'b', 'c'], ['x', 'y', 'z']));
  const r = envolverTablaEnBucle(sinEsaTabla, CFG_RAZONES);
  assert.ok(!r.envuelta);
  assert.strictEqual(r.xml, sinEsaTabla, 'el documento se devuelve intacto');
});
