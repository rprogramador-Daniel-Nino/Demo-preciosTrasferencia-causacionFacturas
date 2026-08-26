/* Pruebas de la orquestación: decide, sin red ni Firestore reales (todo inyectado), si
   hace falta la pasada angosta a notas y cómo se fusiona su resultado. */

import { test } from 'node:test';
import assert from 'node:assert';
import {
  resolverFaltantesConNotas, aprenderDeLecturaExitosa, aprenderRotuloConfirmado,
} from './notasEeffOrquestacion.js';
import { diccionarioVacio, UMBRAL_MADUREZ } from './vocabularioEeff.js';

const verificacionBase = () => ({
  campos: { t_s: 100, t_c: null, t_ar: null, t_ap: 5, t_inv: null, t_act_curr: 1, t_act_tot: 1, t_ppe: 1 },
  correcciones: [],
  advertencias: [
    { tipo: 'sin-costo-de-ventas', campo: 't_c', estado: 'no_verificado', mensaje: 'No se leyó el costo de ventas.' },
    { tipo: 'sin-partida-relacionada', campo: 't_ar', estado: 'no_verificado', mensaje: 'No se desglosa.' },
    { tipo: 'sin-inventarios', campo: 't_inv', estado: 'no_verificado', mensaje: 'No se leyeron inventarios.' },
  ],
  verificadoContraTexto: true,
});

const sinLlamadas = { leerVocabulario: async () => diccionarioVacio(), guardarVocabulario: async () => {} };

test('sin campos faltantes, no hace nada y devuelve la misma verificación', async () => {
  const verificacion = { ...verificacionBase(), campos: { t_c: 1, t_ar: 1, t_ap: 1, t_inv: 1 }, advertencias: [] };
  const resultado = await resolverFaltantesConNotas({
    file: {}, lectura: {}, verificacion, anioEstudio: 2025, ...sinLlamadas,
  });
  assert.strictEqual(resultado, verificacion);
});

test('con diccionario inmaduro y pocas páginas, no llama a la IA y deja no_verificado', async () => {
  let sePreguntoALaIA = false;
  const resultado = await resolverFaltantesConNotas({
    file: {}, lectura: { textoPdf: '' }, verificacion: verificacionBase(), anioEstudio: 2025,
    ...sinLlamadas,
    buscar: async () => { sePreguntoALaIA = true; return { hallazgos: {}, conclusion: '' }; },
    contarPaginas: async () => 5, // como el escaneo de LATV
  });
  assert.strictEqual(sePreguntoALaIA, false);
  assert.ok(resultado.advertencias.every((a) => a.estado === 'no_verificado'));
});

test('con diccionario maduro y ninguna palabra conocida en el texto, marca probable_ausente_por_vocabulario sin llamar a la IA', async () => {
  let sePreguntoALaIA = false;
  const diccionarioMaduro = { palabras: ['vinculadas economicas'], estudiosSinPalabraNueva: UMBRAL_MADUREZ };
  const resultado = await resolverFaltantesConNotas({
    file: {}, lectura: { textoPdf: 'un texto que no menciona nada de eso' },
    verificacion: verificacionBase(), anioEstudio: 2025,
    leerVocabulario: async () => diccionarioMaduro,
    guardarVocabulario: async () => {},
    buscar: async () => { sePreguntoALaIA = true; return { hallazgos: {}, conclusion: '' }; },
    contarPaginas: async () => 23,
  });
  assert.strictEqual(sePreguntoALaIA, false);
  const a = resultado.advertencias.find((x) => x.campo === 't_c');
  assert.strictEqual(a.estado, 'probable_ausente_por_vocabulario');
});

test('con diccionario maduro pero SIN capa de texto confiable, el diccionario no decide — cae a la rama de páginas', async () => {
  /* Sin texto, "no encontramos la palabra" no significa nada: no hay dónde haberla
     buscado. Es el caso del escaneo de LATV, solo que aquí SÍ hay páginas de sobra, para
     aislar que lo que impide la rama del diccionario es la falta de texto, no de páginas. */
  const diccionarioMaduro = { palabras: ['vinculadas economicas'], estudiosSinPalabraNueva: UMBRAL_MADUREZ };
  let sePreguntoALaIA = false;
  const resultado = await resolverFaltantesConNotas({
    file: {}, lectura: { textoPdf: '' }, // sin capa de texto
    verificacion: verificacionBase(), anioEstudio: 2025,
    leerVocabulario: async () => diccionarioMaduro,
    guardarVocabulario: async () => {},
    buscar: async (_file, faltantes) => {
      sePreguntoALaIA = true;
      const hallazgos = {};
      faltantes.forEach((campo) => { hallazgos[campo] = { valor: null, encontradoEn: null, palabra: '', cita: 'no encontrado' }; });
      return { hallazgos, conclusion: '' };
    },
    contarPaginas: async () => 23,
  });
  assert.strictEqual(sePreguntoALaIA, true, 'sin texto, el diccionario no puede decidir por sí solo');
  const a = resultado.advertencias.find((x) => x.campo === 't_c');
  assert.strictEqual(a.estado, 'confirmado_ausente', 'la IA sí decidió, no el diccionario');
});

test('con más de 6 páginas y algo pendiente, llama a la IA, fusiona lo encontrado y re-verifica', async () => {
  const resultado = await resolverFaltantesConNotas({
    file: {},
    /* t_ar, t_ap y t_inv van con el MISMO valor que ya tenía `verificacionBase().campos`:
       en el uso real, `lectura` es el objeto completo que devolvió la pasada 1
       (`res` de `parseEeffWithGeminiOCR`), así que nunca le falta un campo que ya se
       hubiera leído bien — reconstruirlo a medias aquí regresaría t_ap a null solo por
       un descuido del fixture, no por nada que haga el código real. */
    lectura: {
      t_s: 100, t_c: null, t_ar: null, t_ap: 5, t_inv: null,
      cotejo: { gastos_ventas: -10, gastos_administracion: -5 }, textoPdf: '',
    },
    verificacion: verificacionBase(),
    anioEstudio: 2025,
    ...sinLlamadas,
    buscar: async (_file, faltantes) => {
      const hallazgos = {};
      faltantes.forEach((campo) => {
        hallazgos[campo] = campo === 't_c'
          ? { valor: 20, encontradoEn: 'nota', palabra: 'costo del servicio', cita: '' }
          : { valor: null, encontradoEn: null, palabra: '', cita: 'Revisé las notas, no lo desglosa.' };
      });
      return { hallazgos, conclusion: 'Se encontró el costo de ventas en la Nota 19.' };
    },
    contarPaginas: async () => 23,
  });
  assert.strictEqual(resultado.campos.t_c, 20, 're-verificó con el costo encontrado');
  assert.strictEqual(resultado.campos.t_ap, 5, 't_ap no estaba entre los faltantes, no debía tocarse');
  assert.strictEqual(resultado.campos.t_op, 100 - 20 - 15, 'la utilidad operacional se recalculó');
  assert.strictEqual(resultado.conclusionNotas, 'Se encontró el costo de ventas en la Nota 19.');
  assert.ok(!resultado.advertencias.some((a) => a.campo === 't_ap'), 't_ap se encontró, no debe quedar advertencia');
});

test('con más de 6 páginas y algo pendiente que la IA no encuentra, queda confirmado_ausente con cita', async () => {
  const resultado = await resolverFaltantesConNotas({
    file: {},
    lectura: { t_s: 100, t_c: null, cotejo: {}, textoPdf: '' },
    verificacion: verificacionBase(),
    anioEstudio: 2025,
    ...sinLlamadas,
    buscar: async (_file, faltantes) => {
      const hallazgos = {};
      faltantes.forEach((campo) => {
        hallazgos[campo] = { valor: null, encontradoEn: null, palabra: '', cita: 'Revisé todas las notas: no aparece.' };
      });
      return { hallazgos, conclusion: 'No se encontró nada de lo faltante.' };
    },
    contarPaginas: async () => 23,
  });
  const a = resultado.advertencias.find((x) => x.campo === 't_c');
  assert.strictEqual(a.estado, 'confirmado_ausente');
  assert.match(a.mensaje, /Revisé todas las notas/);
});

test('aprenderDeLecturaExitosa guarda la palabra del rótulo cuando el campo sí se encontró', async () => {
  let guardado = null;
  await aprenderDeLecturaExitosa({
    campos: { t_c: 42, t_ar: null, t_ap: null, t_inv: null },
    rotulos: { costo_ventas: 'COSTO DE SERVICIOS PRESTADOS' },
    leerVocabulario: async () => diccionarioVacio(),
    guardarVocabulario: async (campo, diccionario) => { guardado = { campo, diccionario }; },
  });
  assert.strictEqual(guardado.campo, 't_c');
  assert.deepStrictEqual(guardado.diccionario.palabras, ['costo de servicios prestados']);
});

test('aprenderDeLecturaExitosa no guarda nada si ningún campo con fallback se encontró', async () => {
  let sellamo = false;
  await aprenderDeLecturaExitosa({
    campos: { t_c: null, t_ar: null, t_ap: null, t_inv: null },
    rotulos: {},
    leerVocabulario: async () => diccionarioVacio(),
    guardarVocabulario: async () => { sellamo = true; },
  });
  assert.strictEqual(sellamo, false);
});

/* ══════ aprenderRotuloConfirmado: dónde recordar una candidata que el analista confirmó ══════ */

test('un rótulo explícito se guarda en el diccionario global bajo "<campo>_relacionada"', async () => {
  let guardado = null;
  await aprenderRotuloConfirmado({
    campo: 't_ap',
    rotulo: 'CUENTAS POR PAGAR COMPAÑÍAS VINCULADAS',
    nit: '900213910',
    leerVocabulario: async () => diccionarioVacio(),
    guardarVocabulario: async (clave, diccionario) => { guardado = { clave, diccionario }; },
    leerRotulosEmpresa: async () => { throw new Error('no debería consultarse: el rótulo es explícito'); },
    guardarRotulosEmpresa: async () => { throw new Error('no debería escribirse: el rótulo es explícito'); },
  });
  assert.strictEqual(guardado.clave, 't_ap_relacionada');
  assert.deepStrictEqual(guardado.diccionario.palabras, ['cuentas por pagar companias vinculadas']);
});

test('un rótulo genérico se guarda por NIT, sin tocar el diccionario global', async () => {
  let guardadoGlobal = false;
  let guardadoEmpresa = null;
  await aprenderRotuloConfirmado({
    campo: 't_ap',
    rotulo: 'Cuentas comerciales por pagar',
    nit: '900.213.910-7',
    leerVocabulario: async () => { guardadoGlobal = true; return diccionarioVacio(); },
    guardarVocabulario: async () => { guardadoGlobal = true; },
    leerRotulosEmpresa: async () => ({ t_ap: ['un rotulo ya confirmado antes'] }),
    guardarRotulosEmpresa: async (nit, datos) => { guardadoEmpresa = { nit, datos }; },
  });
  assert.strictEqual(guardadoGlobal, false, 'un rótulo genérico no toca el diccionario compartido');
  assert.strictEqual(guardadoEmpresa.nit, '900.213.910-7');
  assert.deepStrictEqual(
    guardadoEmpresa.datos.t_ap,
    ['un rotulo ya confirmado antes', 'cuentas comerciales por pagar'],
  );
});

test('un rótulo genérico ya confirmado antes no se duplica en la lista', async () => {
  let sellamo = false;
  await aprenderRotuloConfirmado({
    campo: 't_ar',
    rotulo: 'Cuentas comerciales por cobrar',
    nit: '900213910',
    leerVocabulario: async () => diccionarioVacio(),
    guardarVocabulario: async () => {},
    leerRotulosEmpresa: async () => ({ t_ar: ['cuentas comerciales por cobrar'] }),
    guardarRotulosEmpresa: async () => { sellamo = true; },
  });
  assert.strictEqual(sellamo, false);
});

test('un rótulo genérico sin NIT no se aprende: no hay dónde guardarlo', async () => {
  let sellamo = false;
  await aprenderRotuloConfirmado({
    campo: 't_ar',
    rotulo: 'Cuentas comerciales por cobrar',
    nit: '',
    leerVocabulario: async () => diccionarioVacio(),
    guardarVocabulario: async () => {},
    leerRotulosEmpresa: async () => { sellamo = true; return {}; },
    guardarRotulosEmpresa: async () => { sellamo = true; },
  });
  assert.strictEqual(sellamo, false);
});
