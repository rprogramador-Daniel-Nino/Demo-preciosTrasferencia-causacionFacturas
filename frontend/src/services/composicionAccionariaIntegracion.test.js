import { test } from 'node:test';
import assert from 'node:assert';
import {
  resolverComposicionAccionaria,
  filasComposicionAccionaria,
} from './tablasContribuyente.js';
import { valorDeCampo } from './plantillaVocabulario.js';

test('Integración: Jerarquía Nivel 3 (Plantilla del Cliente como fallback)', () => {
  const estudio = {
    ent: 'CLIENTE PRUEBA S.A.S.',
    plantillaAccionistas: {
      capital_pagado: 50000000,
      total_acciones: 50000,
      accionistas: [
        {
          nombre: 'GLOBAL HOLDINGS LLC',
          pais: 'ESTADOS UNIDOS',
          acciones: 45000,
          valor_capital: 45000000,
          participacion_pct: 90,
        },
        {
          nombre: 'SOCIO LOCAL',
          pais: 'COLOMBIA',
          acciones: 5000,
          valor_capital: 5000000,
          participacion_pct: 10,
        },
      ],
    },
  };

  const res = resolverComposicionAccionaria(estudio);
  assert.strictEqual(res.fuente, 'plantilla');
  assert.strictEqual(res.capital_pagado, 50000000);
  assert.strictEqual(res.total_acciones, 50000);
  assert.strictEqual(res.accionistas.length, 2);

  /* La Tabla 6 NO se regenera con lo que se leyó de la plantilla: se deja la que la plantilla
     ya trae, con sus filas y sus cifras (decisión del usuario, 2026-08-22). La extracción con
     IA de esa misma tabla no siempre recupera el número de acciones ni el valor del capital, y
     reescribirla con eso publicaba «—» donde la plantilla traía las cifras.
     Los CAMPOS del texto sí siguen resolviéndose con ella: son huecos del vocabulario que no
     tienen otra fuente, y ahí un dato del mismo documento es lo mejor que hay. */
  assert.strictEqual(filasComposicionAccionaria(estudio), null);

  // Verificación de resolución de variables en plantillaVocabulario
  assert.strictEqual(valorDeCampo(estudio, 'accionista.nombre'), 'GLOBAL HOLDINGS LLC');
  assert.strictEqual(valorDeCampo(estudio, 'accionista.pais'), 'ESTADOS UNIDOS');
  assert.strictEqual(valorDeCampo(estudio, 'accionista.participacion'), '90%');
  assert.strictEqual(valorDeCampo(estudio, 'capital_pagado'), '50.000.000');
  assert.strictEqual(valorDeCampo(estudio, 'total_acciones'), '50.000');
});

test('Integración: Jerarquía Nivel 2 (Informe Año Anterior sobreescribe Plantilla)', () => {
  const estudio = {
    ent: 'CLIENTE PRUEBA S.A.S.',
    estudioAnterior: {
      capital_pagado: 100000000,
      total_acciones: 1000,
      accionistas: [
        {
          nombre: 'MATRIZ ANTERIOR CORP',
          pais: 'PANAMÁ',
          acciones: 1000,
          valor_capital: 100000000,
          participacion_pct: 100,
        },
      ],
    },
    plantillaAccionistas: {
      capital_pagado: 50000000,
      total_acciones: 50000,
      accionistas: [
        {
          nombre: 'GLOBAL HOLDINGS LLC',
          pais: 'ESTADOS UNIDOS',
          acciones: 50000,
          valor_capital: 50000000,
          participacion_pct: 100,
        },
      ],
    },
  };

  const res = resolverComposicionAccionaria(estudio);
  assert.strictEqual(res.fuente, 'estudioAnterior');
  assert.strictEqual(res.accionistas[0].nombre, 'MATRIZ ANTERIOR CORP');

  const tabla = filasComposicionAccionaria(estudio);
  assert.deepStrictEqual(tabla.filas[0], ['MATRIZ ANTERIOR CORP', 'PANAMÁ', '1.000', '100.000.000', '100%']);
  assert.deepStrictEqual(tabla.filas[1], ['Total', '', '1.000', '100.000.000', '100%']);

  assert.strictEqual(valorDeCampo(estudio, 'accionista.nombre'), 'MATRIZ ANTERIOR CORP');
});

test('Integración: Jerarquía Nivel 1 (Certificado Sección 1 máxima prioridad sobre todo)', () => {
  const estudio = {
    ent: 'CLIENTE PRUEBA S.A.S.',
    accionistas: [
      {
        nombre: 'CERTIFICADO OFICIAL S.A.',
        pais: 'ESPAÑA',
        acciones: 2000,
        valor_capital: 200000000,
        participacion_pct: 100,
      },
    ],
    capital_pagado: 200000000,
    total_acciones: 2000,
    estudioAnterior: {
      accionistas: [{ nombre: 'MATRIZ ANTERIOR CORP', participacion_pct: 100 }],
    },
    plantillaAccionistas: {
      accionistas: [{ nombre: 'GLOBAL HOLDINGS LLC', participacion_pct: 100 }],
    },
  };

  const res = resolverComposicionAccionaria(estudio);
  assert.strictEqual(res.fuente, 'certificado');
  assert.strictEqual(res.accionistas[0].nombre, 'CERTIFICADO OFICIAL S.A.');

  const tabla = filasComposicionAccionaria(estudio);
  assert.deepStrictEqual(tabla.filas[0], ['CERTIFICADO OFICIAL S.A.', 'ESPAÑA', '2.000', '200.000.000', '100%']);

  assert.strictEqual(valorDeCampo(estudio, 'accionista.nombre'), 'CERTIFICADO OFICIAL S.A.');
  assert.strictEqual(valorDeCampo(estudio, 'capital_pagado'), '200.000.000');
});
