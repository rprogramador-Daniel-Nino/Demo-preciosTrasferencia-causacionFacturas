import { test } from 'node:test';
import assert from 'node:assert';
import {
  avisoIdentificacionVinculado, normalizarIdentificacion, normalizarRazonSocial,
} from './cotejoVinculado.js';

/* El caso real: END GAME INTERACTIVE INC figura con 604477955 en el informe 2024 y con
   444444001 en el Excel de operaciones 2025. */
const estudio = {
  vinc: 'END GAME INTERACTIVE INC',
  vinc_id: '444444001',
  estudioAnterior: {
    anio: 2024,
    vinculado: { razon_social: 'END GAME INTERACTIVE INC', identificacion: '604477955' },
  },
};

test('avisa cuando la misma contraparte cambia de identificación', () => {
  const aviso = avisoIdentificacionVinculado(estudio);
  assert.match(aviso, /444444001/);
  assert.match(aviso, /604477955/);
  assert.match(aviso, /2024/);
});

test('no avisa cuando las dos identificaciones coinciden', () => {
  const aviso = avisoIdentificacionVinculado({
    ...estudio,
    estudioAnterior: {
      anio: 2024,
      vinculado: { razon_social: 'END GAME INTERACTIVE INC', identificacion: '444444001' },
    },
  });
  assert.strictEqual(aviso, '');
});

test('los puntos y guiones no cuentan como diferencia', () => {
  const aviso = avisoIdentificacionVinculado({
    ...estudio,
    vinc_id: '444.444.001',
    estudioAnterior: {
      anio: 2024,
      vinculado: { razon_social: 'END GAME INTERACTIVE INC', identificacion: '444-444-001' },
    },
  });
  assert.strictEqual(aviso, '', 'es el mismo número escrito de dos maneras');
});

test('sin informe anterior cargado no hay nada que advertir', () => {
  assert.strictEqual(avisoIdentificacionVinculado({ vinc_id: '444444001' }), '');
  assert.strictEqual(avisoIdentificacionVinculado({}), '');
  assert.strictEqual(avisoIdentificacionVinculado(null), '');
});

test('si el informe anterior no trajo la identificación, tampoco se avisa', () => {
  /* Una ausencia no es una discrepancia: avisar de ella entrena a ignorar el banner. */
  const aviso = avisoIdentificacionVinculado({
    ...estudio,
    estudioAnterior: { anio: 2024, vinculado: { razon_social: 'END GAME INTERACTIVE INC', identificacion: '' } },
  });
  assert.strictEqual(aviso, '');
});

test('si además cambió la razón social, el aviso lo dice distinto', () => {
  const aviso = avisoIdentificacionVinculado({
    ...estudio,
    estudioAnterior: {
      anio: 2024,
      vinculado: { razon_social: 'OTRA COMPAÑÍA LLC', identificacion: '604477955' },
    },
  });
  assert.match(aviso, /misma contraparte/);
  assert.match(aviso, /OTRA COMPAÑÍA LLC/);
});

test('la razón social se compara sin acentos ni espacios de más', () => {
  assert.strictEqual(
    normalizarRazonSocial('  End  Gáme   Interactive Inc '),
    'END GAME INTERACTIVE INC'
  );
});

test('la identificación se compara solo por sus caracteres alfanuméricos', () => {
  assert.strictEqual(normalizarIdentificacion('444.444-001 '), '444444001');
  assert.strictEqual(normalizarIdentificacion(null), '');
});
