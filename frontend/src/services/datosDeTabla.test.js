import { test } from 'node:test';
import assert from 'node:assert/strict';
import { celdaSinDato, sinNingunDato, tablaSinDatos } from './datosDeTabla.js';
import {
  filasOperacionesDeIngreso, filasOperacionAnalizar, filasTransaccionesIntercompania,
  filasMetodoAplicable, filasCompaniasVinculadas, filasCriteriosVinculacion,
} from './tablasOperaciones.js';
import { filasActivos } from './tablasContribuyente.js';

/* ══════════════════ El criterio ══════════════════ */

test('una celda sin dato es la ausente, la vacía y la que ya es un guion', () => {
  for (const v of [null, undefined, '', '   ', '—', '-']) {
    assert.ok(celdaSinDato(v), `«${v}» no debería contar como dato`);
  }
});

test('el cero SÍ es un dato: un rubro en cero no es un rubro que nadie cargó', () => {
  assert.ok(!celdaSinDato(0));
  assert.ok(!celdaSinDato('0'));
});

test('sinNingunDato mira todos los valores, no el primero', () => {
  assert.ok(sinNingunDato([null, '', '—']));
  assert.ok(!sinNingunDato([null, 'ACME INC', '—']));
});

test('tablaSinDatos respeta la declaración de la tabla por encima del texto', () => {
  /* «Operación analizar» arma su celda como «Ingreso (—)»: hay texto, pero no es un dato.
     Sin la declaración, el criterio del texto la daría por llena. */
  assert.ok(tablaSinDatos({ filas: [['Ingreso (—)', '—']], sinDatos: true }));
  assert.ok(!tablaSinDatos({ filas: [['—', '—']], sinDatos: false }));
});

test('sin declaración cae en el criterio del texto, para que una tabla nueva no quede sin red', () => {
  assert.ok(tablaSinDatos({ filas: [['—', ''], ['—', '—']] }));
  assert.ok(tablaSinDatos({ filas: [] }));
  assert.ok(tablaSinDatos(null), 'null es «no aplica», que ya usaban otros generadores');
  assert.ok(!tablaSinDatos({ filas: [['—', 'ACME INC']] }));
});

/* ══════════════════ Lo que declara cada tabla ══════════════════ */

test('las tablas del contribuyente se declaran sin datos con el estudio vacío', () => {
  for (const [nombre, fn] of [
    ['Operaciones de Ingreso', filasOperacionesDeIngreso],
    ['Operación analizar', filasOperacionAnalizar],
    ['Transacciones Inter compañía', filasTransaccionesIntercompania],
    ['Método de Precios de Transferencia', filasMetodoAplicable],
    ['Compañías vinculadas', filasCompaniasVinculadas],
    ['Criterios de vinculación', filasCriteriosVinculacion],
    ['Activos a 31 de diciembre', filasActivos],
  ]) {
    assert.ok(tablaSinDatos(fn({})), `${nombre} debería conservar la de la plantilla`);
    assert.ok(tablaSinDatos(fn({ anio: 2025 })), `${nombre}, con solo el año, tampoco tiene datos`);
  }
});

test('un solo campo del estudio ya alcanza para publicar la tabla', () => {
  /* No hace falta que estén todos: lo que se evita es sustituir una tabla completa por
     guiones, no publicar una fila incompleta cuando hay algo que declarar. */
  assert.ok(!tablaSinDatos(filasCompaniasVinculadas({ vinc: 'ACME INC' })));
  assert.ok(!tablaSinDatos(filasOperacionesDeIngreso({ monto_operacion: 6719644000 })));
  assert.ok(!tablaSinDatos(filasOperacionAnalizar({ vinc_tipo: 'Servicios técnicos (35)' })));
  assert.ok(!tablaSinDatos(filasActivos({ t_cash: 10570918 })));
});

test('el método y el indicador por defecto no cuentan como datos propios', () => {
  /* «TU» y «MO» los pone el generador, así que una Tabla 8 con solo eso publicaría el método
     del sistema sobre el que la plantilla ya declaraba, con el código y la descripción en
     guiones — así salió en el informe de SHANDONG KERUI 2025 («——TUMO»). */
  assert.ok(tablaSinDatos(filasMetodoAplicable({})));
  assert.ok(!tablaSinDatos(filasMetodoAplicable({ metodo: 'PC' })), 'un método elegido sí es dato');
});

test('el inciso de vinculación por defecto no hace que la ficha se dé por llena', () => {
  /* La ficha vertical lleva sus rótulos en la primera columna y el inciso «Art 260-1 E-T
     Inciso 1» tiene valor por defecto: sin los campos del vinculado no hay ficha que poner. */
  assert.ok(tablaSinDatos(filasTransaccionesIntercompania({})));
  assert.ok(!tablaSinDatos(filasTransaccionesIntercompania({ vinc_id: '91370502MACMFHA' })));
});

test('la cita de la norma tampoco llena por sí sola los criterios de vinculación', () => {
  assert.ok(tablaSinDatos(filasCriteriosVinculacion({})));
  assert.ok(!tablaSinDatos(filasCriteriosVinculacion({ pais_vinc: 'CHINA' })));
});

test('los subtotales del balance no cuentan como cifras cargadas', () => {
  /* «Total, Activo corriente» y los otros dos se publican siempre, con «—» si falta el dato:
     sin ninguna cifra la tabla queda con tres rótulos y seis guiones. */
  const t = filasActivos({ anio: 2025 });
  assert.ok(t.filas.length >= 3, 'los subtotales siguen emitiéndose');
  assert.ok(tablaSinDatos(t), 'pero la tabla no se publica solo por ellos');
});
