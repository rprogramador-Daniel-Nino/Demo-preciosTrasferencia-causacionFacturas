import { test } from 'node:test';
import assert from 'node:assert';
import {
  CLAVE_SESION_UI, VISTAS_DEL_ESTUDIO, tabCanonica, tabConocida,
  leerSesionUi, guardarSesionUi, limpiarSesionUi, acumularVistaMontada,
} from './sesionUi.js';

/** localStorage mínimo, para probar sin navegador. */
function almacenFalso(inicial = {}) {
  const datos = { ...inicial };
  return {
    datos,
    getItem: (k) => (k in datos ? datos[k] : null),
    setItem: (k, v) => { datos[k] = String(v); },
    removeItem: (k) => { delete datos[k]; },
  };
}

/** Uno que falla en todo, como el de Safari en modo privado o con la cuota llena. */
function almacenRoto() {
  return {
    getItem: () => { throw new Error('acceso denegado'); },
    setItem: () => { throw new Error('cuota excedida'); },
    removeItem: () => { throw new Error('acceso denegado'); },
  };
}

test('los nombres antiguos de pestaña se resuelven al identificador real', () => {
  /* Sin esto la misma pantalla se montaría dos veces, una por cada nombre, y cada copia
     escribiría en el estudio con su propio estado. */
  assert.strictEqual(tabCanonica('eeff'), 'Estados financieros');
  assert.strictEqual(tabCanonica('cifras'), 'Estados financieros');
  assert.strictEqual(tabCanonica('operaciones'), 'Operaciones');
  assert.strictEqual(tabCanonica('Operaciones'), 'Operaciones', 'el ya canónico no cambia');
  assert.strictEqual(tabCanonica('comparables'), 'comparables');
});

test('se reconocen las pestañas que la aplicación sabe mostrar', () => {
  assert.strictEqual(tabConocida('comparables'), true);
  assert.strictEqual(tabConocida('eeff'), true, 'por su alias');
  assert.strictEqual(tabConocida('dashboard'), true);
  assert.strictEqual(tabConocida('inventada'), false);
  assert.strictEqual(tabConocida(''), false);
  assert.strictEqual(tabConocida(null), false);
});

test('se guarda y se recupera dónde estaba el usuario', () => {
  const almacen = almacenFalso();
  assert.strictEqual(guardarSesionUi({ estudioId: 'study_1', tab: 'comparables' }, almacen), true);
  assert.deepStrictEqual(leerSesionUi(almacen), { estudioId: 'study_1', tab: 'comparables' });
  assert.ok(almacen.datos[CLAVE_SESION_UI], 'queda bajo la clave declarada');
});

test('la pestaña guardada se normaliza al leer y al escribir', () => {
  const almacen = almacenFalso();
  guardarSesionUi({ estudioId: 'study_1', tab: 'cifras' }, almacen);
  assert.deepStrictEqual(leerSesionUi(almacen), { estudioId: 'study_1', tab: 'Estados financieros' });

  /* Una sesión escrita por una versión anterior sigue sirviendo. */
  const viejo = almacenFalso({ [CLAVE_SESION_UI]: JSON.stringify({ estudioId: 'study_2', tab: 'eeff' }) });
  assert.deepStrictEqual(leerSesionUi(viejo), { estudioId: 'study_2', tab: 'Estados financieros' });
});

test('sin estudio no se guarda nada: el tablero ya es el punto de partida', () => {
  const almacen = almacenFalso();
  assert.strictEqual(guardarSesionUi({ estudioId: '', tab: 'comparables' }, almacen), false);
  assert.strictEqual(leerSesionUi(almacen), null);
});

test('ante cualquier duda no se restaura nada', () => {
  /* Abrir un estudio equivocado es peor que empezar en el tablero. */
  assert.strictEqual(leerSesionUi(almacenFalso()), null, 'sin dato guardado');
  assert.strictEqual(leerSesionUi(almacenFalso({ [CLAVE_SESION_UI]: 'no es json' })), null);
  assert.strictEqual(leerSesionUi(almacenFalso({ [CLAVE_SESION_UI]: '{"tab":"comparables"}' })), null,
    'sin identificador de estudio no hay nada que abrir');
  assert.strictEqual(leerSesionUi(almacenFalso({ [CLAVE_SESION_UI]: '{"estudioId":"   "}' })), null);
  assert.strictEqual(leerSesionUi(null), null, 'sin almacén disponible');
});

test('una pestaña desconocida cae al primer paso en vez de descartar el estudio', () => {
  const almacen = almacenFalso({ [CLAVE_SESION_UI]: JSON.stringify({ estudioId: 'study_1', tab: 'retirada' }) });
  assert.deepStrictEqual(leerSesionUi(almacen), { estudioId: 'study_1', tab: 'contribuyente' },
    'el estudio se abre igual: lo que no se reconoce es el paso, no el estudio');
});

test('un almacén que lanza no impide seguir trabajando', () => {
  /* La cuota llena o el modo privado no pueden tumbar la aplicación: se pierde el
     recordatorio, no el estudio, que va a Firestore por su cuenta. */
  const roto = almacenRoto();
  assert.strictEqual(leerSesionUi(roto), null);
  assert.strictEqual(guardarSesionUi({ estudioId: 'study_1', tab: 'comparables' }, roto), false);
  assert.doesNotThrow(() => limpiarSesionUi(roto));
});

test('limpiar olvida dónde estaba', () => {
  const almacen = almacenFalso();
  guardarSesionUi({ estudioId: 'study_1', tab: 'comparables' }, almacen);
  limpiarSesionUi(almacen);
  assert.strictEqual(leerSesionUi(almacen), null);
});

/* ══════════ qué pantallas se mantienen montadas ══════════ */

test('la primera vista visitada queda montada', () => {
  const estado = acumularVistaMontada(null, { estudioId: 'e1', tab: 'contribuyente' });
  assert.deepStrictEqual(estado, { estudioId: 'e1', tabs: ['contribuyente'] });
});

test('las vistas se acumulan a medida que se visitan, sin repetirse', () => {
  /* Se montan al visitarlas y no todas de golpe: abrir un estudio no tiene por qué pagar
     el arranque de seis pantallas que quizá no se usen. */
  let e = acumularVistaMontada(null, { estudioId: 'e1', tab: 'contribuyente' });
  e = acumularVistaMontada(e, { estudioId: 'e1', tab: 'comparables' });
  e = acumularVistaMontada(e, { estudioId: 'e1', tab: 'informe' });
  assert.deepStrictEqual(e.tabs, ['contribuyente', 'comparables', 'informe']);

  const mismo = acumularVistaMontada(e, { estudioId: 'e1', tab: 'comparables' });
  assert.strictEqual(mismo, e, 'volver a una ya montada no cambia el estado ni provoca un render');
});

test('un alias no monta una segunda copia de la misma pantalla', () => {
  let e = acumularVistaMontada(null, { estudioId: 'e1', tab: 'Estados financieros' });
  e = acumularVistaMontada(e, { estudioId: 'e1', tab: 'eeff' });
  assert.deepStrictEqual(e.tabs, ['Estados financieros'], 'una sola, o cada copia escribiría por su cuenta');
});

test('pasar por el catálogo o los clientes no retira lo montado', () => {
  let e = acumularVistaMontada(null, { estudioId: 'e1', tab: 'comparables' });
  e = acumularVistaMontada(e, { estudioId: 'e1', tab: 'catalogo' });
  assert.deepStrictEqual(e.tabs, ['comparables'],
    'se vuelve del catálogo al motor y el trabajo sigue ahí');
  e = acumularVistaMontada(e, { estudioId: 'e1', tab: 'clientes' });
  assert.deepStrictEqual(e.tabs, ['comparables']);
});

test('cambiar de estudio empieza de cero', () => {
  /* Es lo que garantiza que el estado de un estudio no acabe escrito en el siguiente:
     el mismo motivo por el que el render lleva `key` con el identificador. */
  let e = acumularVistaMontada(null, { estudioId: 'e1', tab: 'comparables' });
  e = acumularVistaMontada(e, { estudioId: 'e1', tab: 'informe' });
  const otro = acumularVistaMontada(e, { estudioId: 'e2', tab: 'contribuyente' });
  assert.deepStrictEqual(otro, { estudioId: 'e2', tabs: ['contribuyente'] });
});

test('cerrar el estudio desmonta todo', () => {
  const e = acumularVistaMontada(null, { estudioId: 'e1', tab: 'comparables' });
  const cerrado = acumularVistaMontada(e, { estudioId: null, tab: 'dashboard' });
  assert.deepStrictEqual(cerrado, { estudioId: null, tabs: [] });
  const otraVez = acumularVistaMontada(cerrado, { estudioId: null, tab: 'clientes' });
  assert.strictEqual(otraVez, cerrado, 'y seguir sin estudio no provoca renders nuevos');
});

test('todas las vistas del estudio son acumulables', () => {
  let e = null;
  VISTAS_DEL_ESTUDIO.forEach(tab => { e = acumularVistaMontada(e, { estudioId: 'e1', tab }); });
  assert.deepStrictEqual(e.tabs, VISTAS_DEL_ESTUDIO);
});
