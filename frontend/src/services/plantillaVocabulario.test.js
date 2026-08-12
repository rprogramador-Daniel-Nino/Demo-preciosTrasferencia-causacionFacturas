import { test } from 'node:test';
import assert from 'node:assert';
import { VOCABULARIO, esCampoValido, valorDeCampo } from './plantillaVocabulario.js';

/* Estudio de un cliente que no es End Game, con los campos tal y como los
   escriben hoy DatosContribuyente.jsx e IngestaCifras.jsx. */
const estudio = {
  ent: 'ACME COLOMBIA S.A.S',
  nit: '800123456-7',
  ciiu: '6201',
  objeto: 'Desarrollo de software',
  representante: 'Ana Ruiz',
  anio: 2025,
  vinc: 'ACME INC',
  vinc_id: '999888777',
  vinc_tipo: 'Otros servicios (07)',
  pais_vinc: 'MÉXICO',
  accionistas: [{ nombre: 'ACME INC', pais: 'MÉXICO', acciones: 200000, valor_capital: 200000000 }],
  t_s: 5000000000,
  t_inv_assoc: 2000000000,
  t_intang: 9000000,
  t_dif: 50000000,
  t_act_nocurr: 300000000,
};

test('el vocabulario es cerrado y no admite nombres inventados', () => {
  assert.ok(esCampoValido('ent'), 'ent debería ser válido');
  assert.ok(esCampoValido('eeff.t_inv_assoc'), 'los campos de EEFF llevan prefijo');
  /* `direccion` SÍ existe en la ingesta: `DatosContribuyente.jsx:39` escribe
     `updates.direccion` desde la extracción del RUT. La aserción anterior
     afirmaba lo contrario y con eso justificaba dejar el campo fuera del
     vocabulario, así que el domicilio del contribuyente anterior se quedaba
     sin marcar y viajaba al informe nuevo. */
  assert.ok(esCampoValido('direccion'), 'direccion la escribe DatosContribuyente.jsx desde el RUT');
  assert.ok(!esCampoValido('lo_que_sea'), 'no se aceptan campos inventados');
});

/* La etiqueta no es decorativa: es lo que ve el modelo al elegir qué marcar
   (`plantillaMarcador.js` la manda en el prompt). `eeffParser.js` llena `t_op` desde
   `utilidad_operacional` y `pliOf` lo consume como utilidad —«op llega como UTILIDAD
   operacional (convenio del sistema)»—, así que llamarlo «Gastos operacionales» hacía que
   el modelo marcara el número equivocado del estado de resultados. */
test('la etiqueta de t_op dice que es la utilidad operacional, no los gastos', () => {
  const entrada = VOCABULARIO.find((v) => v.campo === 'eeff.t_op');
  assert.ok(entrada, 'eeff.t_op debe estar en el vocabulario');
  assert.match(entrada.etiqueta, /utilidad/i, 'la etiqueta debe nombrar la utilidad operacional');
  assert.doesNotMatch(entrada.etiqueta, /gastos/i, 'no es la cuenta de gastos');
});

test('la dirección del RUT se resuelve contra el estudio', () => {
  assert.strictEqual(
    valorDeCampo({ direccion: 'CL 100 # 11-20 OF 301' }, 'direccion'),
    'CL 100 # 11-20 OF 301'
  );
  assert.strictEqual(valorDeCampo({}, 'direccion'), null, 'sin dirección -> hueco, no valor viejo');
});

test('cada campo del vocabulario tiene etiqueta y grupo', () => {
  for (const v of VOCABULARIO) {
    assert.ok(v.campo && v.etiqueta && v.grupo, 'entrada incompleta: ' + JSON.stringify(v));
  }
});

test('el vocabulario cubre los quince campos de EEFF que captura la ingesta', () => {
  const eeff = VOCABULARIO.filter((v) => v.campo.startsWith('eeff.')).map((v) => v.campo);
  for (const c of ['t_cash', 't_ar', 't_inv', 't_tax', 't_ppe', 't_act_curr', 't_act_nocurr',
                   't_act_tot', 't_inv_assoc', 't_intang', 't_dif', 't_ap', 't_c', 't_op', 't_s']) {
    assert.ok(eeff.includes('eeff.' + c), 'falta el campo eeff.' + c);
  }
});

test('los valores salen formateados y los ausentes salen nulos', () => {
  assert.strictEqual(valorDeCampo(estudio, 'ent'), 'ACME COLOMBIA S.A.S');
  assert.strictEqual(valorDeCampo(estudio, 'nit'), '800123456-7');
  assert.strictEqual(valorDeCampo(estudio, 'anio'), '2025');
  assert.strictEqual(valorDeCampo(estudio, 'eeff.t_inv_assoc'), '2.000.000.000');
  assert.strictEqual(valorDeCampo(estudio, 'accionista.nombre'), 'ACME INC');
  assert.strictEqual(valorDeCampo(estudio, 'eeff.t_cash'), null, 'no ingresado -> null');
  assert.strictEqual(valorDeCampo({}, 'ent'), null, 'estudio vacío -> null');
});

test('un campo fuera del vocabulario nunca devuelve valor', () => {
  /* Se usa un nombre que de verdad no está en el vocabulario: `direccion` sí
     está desde que se corrigió el hueco del vocabulario cerrado. */
  assert.strictEqual(valorDeCampo({ ...estudio, telefono: '3001234567' }, 'telefono'), null);
});

/* Los topes UVT son de lo que más muta: cambian cada año gravable. */
test('los topes UVT se calculan contra el año del estudio', () => {
  const de2025 = valorDeCampo({ anio: 2025 }, 'uvt.tope45k');
  const de2024 = valorDeCampo({ anio: 2024 }, 'uvt.tope45k');
  assert.ok(de2025 && de2024, 'ambos años deben resolver');
  assert.notStrictEqual(de2025, de2024, 'el tope debe cambiar con el año');
  assert.match(de2025, /^[\d.]+$/, 'debe salir formateado con separadores');
});

test('el rango intercuartil sale de las comparables y no del informe viejo', () => {
  const conComparables = {
    ...estudio,
    pli: 'MO',
    t_op: 100000, t_c: 800000,
    comparables: [
      { s: 1000, c: 800, op: 100 }, { s: 2000, c: 1600, op: 260 },
      { s: 3000, c: 2400, op: 300 }, { s: 4000, c: 3200, op: 520 },
    ],
  };
  const p25 = valorDeCampo(conComparables, 'rango.p25');
  const p75 = valorDeCampo(conComparables, 'rango.p75');
  assert.ok(p25 && p75, 'con cuatro comparables debe haber rango');
  assert.ok(['CUMPLE', 'NO CUMPLE'].includes(valorDeCampo(conComparables, 'rango.cumple')));
});

/* El informe del 2026-08-10 salió con «Percentil 25 (0), Mediana (0), Percentil 75 (0)»
   en las tablas 5, 18 y 20 y en las narrativas que las citan. La causa era formatear los
   percentiles con `fmt`, el formateador de PESOS: los percentiles son fracciones, y
   `Math.round(0.0432).toLocaleString('es-CO')` da «0». La prueba anterior solo exigía que
   el valor fuera truthy, y «0» lo es, así que no lo atrapaba. */
test('los percentiles del rango salen como porcentaje y no como pesos redondeados', () => {
  const conComparables = {
    ...estudio,
    pli: 'MO',
    t_op: 100000, t_c: 800000,
    comparables: [
      { s: 1000, c: 800, op: 100 }, { s: 2000, c: 1600, op: 260 },
      { s: 3000, c: 2400, op: 300 }, { s: 4000, c: 3200, op: 520 },
    ],
  };
  for (const campo of ['rango.p25', 'rango.mediana', 'rango.p75']) {
    const v = valorDeCampo(conComparables, campo);
    /* Coma decimal, TRES decimales y espacio antes del signo: es el formato de `pctf` desde
       que se unificó con el del monolito. Lo que esta prueba defiende no ha cambiado —que el
       percentil salga como porcentaje y no como un peso redondeado, que era el defecto de
       formatear con `fmt`—; solo se actualizó el formato que espera. */
    assert.match(v, /^-?[\d.]+,\d{3} %$/, campo + ' debe salir como porcentaje, no como «' + v + '»');
    assert.notStrictEqual(v, '0', campo + ' no puede colapsar a cero');
  }
});

test('sin comparables suficientes el rango sale nulo, no inventado', () => {
  assert.strictEqual(valorDeCampo({ ...estudio, comparables: [] }, 'rango.p25'), null);
  assert.strictEqual(valorDeCampo(estudio, 'rango.mediana'), null);
});

test('sin año gravable el tope UVT sale nulo, no por defecto', () => {
  assert.strictEqual(valorDeCampo({}, 'uvt.tope45k'), null, 'estudio sin anio -> null');
  assert.strictEqual(valorDeCampo({}, 'uvt.tope10k'), null, 'estudio sin anio -> null');
});

test('con año fuera de UVT_VALUES el tope sale nulo, no por defecto', () => {
  assert.strictEqual(valorDeCampo({ anio: 2030 }, 'uvt.tope45k'), null, 'año 2030 no existe -> null');
  assert.strictEqual(valorDeCampo({ anio: 2030 }, 'uvt.tope10k'), null, 'año 2030 no existe -> null');
});

test('dato no numérico en EEFF sale nulo, no como placeholder', () => {
  assert.strictEqual(valorDeCampo({ t_cash: 'abc' }, 'eeff.t_cash'), null, 'dato inválido -> null');
  assert.strictEqual(valorDeCampo({ t_inv: 'xyz' }, 'eeff.t_inv'), null, 'dato no parseble -> null');
});

test('dato no numérico en accionista sale nulo, no como placeholder', () => {
  const conAccionistaMalo = {
    ...estudio,
    accionistas: [{ nombre: 'ACME INC', pais: 'MÉXICO', acciones: 'abc', valor_capital: 200000000 }],
  };
  assert.strictEqual(valorDeCampo(conAccionistaMalo, 'accionista.acciones'), null, 'acciones inválidas -> null');
  const conValorMalo = {
    ...estudio,
    accionistas: [{ nombre: 'ACME INC', pais: 'MÉXICO', acciones: 200000, valor_capital: 'xyz' }],
  };
  assert.strictEqual(valorDeCampo(conValorMalo, 'accionista.valor_capital'), null, 'valor_capital inválido -> null');
});

/* ══════════════ Pruebas de la Fase 2 ══════════════ */

test('el monto de la operación y el formato DIAN se resuelven correctamente', () => {
  const conMonto = { ...estudio, monto_operacion: 1250000000 };
  assert.strictEqual(valorDeCampo(conMonto, 'monto_operacion'), '1.250.000.000');
  assert.strictEqual(valorDeCampo(conMonto, 'vinc_monto'), '1.250.000.000');
  assert.strictEqual(valorDeCampo(conMonto, 'vinc_formato'), 'Formato 1125');
});

test('el valor de la UVT se resuelve correctamente', () => {
  assert.strictEqual(valorDeCampo({ anio: 2025 }, 'uvt.valor'), '49.799');
  assert.strictEqual(valorDeCampo({ anio: 2024 }, 'uvt.valor'), '47.065');
});

test('la participación de accionista se resuelve e incluye el signo de porcentaje', () => {
  const conParticipacion = {
    ...estudio,
    accionistas: [{ nombre: 'ACME INC', pais: 'MÉXICO', participacion_pct: 85.5 }],
  };
  assert.strictEqual(valorDeCampo(conParticipacion, 'accionista.participacion'), '85.5%');
});

test('capital pagado y total de acciones se resuelven y formatean correctamente', () => {
  const conCapital = { ...estudio, capital_pagado: 500000000, total_acciones: 1000000 };
  assert.strictEqual(valorDeCampo(conCapital, 'capital_pagado'), '500.000.000');
  assert.strictEqual(valorDeCampo(conCapital, 'total_acciones'), '1.000.000');
});

test('las narrativas e información de la IA se resuelven y limpian el HTML de forma segura', () => {
  const datosMacro = {
    narrativa: {
      mundial: '<p>La economía mundial creció.</p><p>Se proyecta estabilización.</p>',
      colombia: '<p>Colombia mostró resiliencia.</p>'
    }
  };
  const analisisSector = {
    porAnio: {
      '2025': {
        tituloSector: 'Videojuegos y Entretenimiento',
        narrativa: {
          comportamiento: '<p>Ventas estables en 2025.</p>',
          comercioExterior: '<p>Altas exportaciones.</p>',
          proyeccion: '<p>Crecimiento en móviles.</p>',
          conclusiones: '<p>Cumplimiento del sector.</p>'
        }
      }
    }
  };

  const opciones = { datosMacro, analisisSector };

  assert.strictEqual(
    valorDeCampo({ anio: 2025 }, 'ia.economia_mundial', opciones),
    'La economía mundial creció.\nSe proyecta estabilización.'
  );
  assert.strictEqual(
    valorDeCampo({ anio: 2025 }, 'ia.economia_colombia', opciones),
    'Colombia mostró resiliencia.'
  );
  assert.strictEqual(
    valorDeCampo({ anio: 2025 }, 'ia.sector_titulo', opciones),
    'Videojuegos y Entretenimiento'
  );
  assert.strictEqual(
    valorDeCampo({ anio: 2025 }, 'ia.sector_comportamiento', opciones),
    'Ventas estables en 2025.'
  );
  assert.strictEqual(
    valorDeCampo({ anio: 2025 }, 'ia.sector_comercio', opciones),
    'Altas exportaciones.'
  );
  assert.strictEqual(
    valorDeCampo({ anio: 2025 }, 'ia.sector_proyeccion', opciones),
    'Crecimiento en móviles.'
  );
  assert.strictEqual(
    valorDeCampo({ anio: 2025 }, 'ia.sector_conclusiones', opciones),
    'Cumplimiento del sector.'
  );
});

