import { test } from 'node:test';
import assert from 'node:assert';
import {
  revisarAntesDeGenerar, revisarSalidaRenderizada, valoresDeReferencia, sustituirDatosDeReferencia,
  TRAMO_HTML,
} from './plantillaGuardas.js';

const base = { estudio: { nit: '800123456-7' }, nitDeReferencia: '800123456-7', vacios: [], tieneAnexo: true, recursosFaltantes: [] };

test('sin problemas no hay avisos', () => {
  assert.deepStrictEqual(revisarAntesDeGenerar(base), []);
});

test('avisa si el NIT de la referencia no es el del estudio', () => {
  const avisos = revisarAntesDeGenerar({ ...base, nitDeReferencia: '901337576-6' });
  assert.strictEqual(avisos.length, 1);
  assert.match(avisos[0].texto, /901337576-6/);
  assert.match(avisos[0].texto, /800123456-7/);
});

test('avisa si el anexo no se ha subido', () => {
  const avisos = revisarAntesDeGenerar({ ...base, tieneAnexo: false });
  assert.strictEqual(avisos.length, 1);
  assert.match(avisos[0].texto, /anexo/i);
});

test('lista todos los campos sin dato, no solo el primero', () => {
  const avisos = revisarAntesDeGenerar({ ...base, vacios: ['ciiu', 'eeff.t_cash'] });
  assert.strictEqual(avisos.length, 1);
  assert.match(avisos[0].texto, /ciiu/);
  assert.match(avisos[0].texto, /eeff\.t_cash/);
});

test('los avisos se acumulan', () => {
  const avisos = revisarAntesDeGenerar({
    ...base, nitDeReferencia: '901337576-6', tieneAnexo: false, vacios: ['ciiu'],
  });
  assert.strictEqual(avisos.length, 3);
});

test('sin NIT de referencia no se inventa un aviso', () => {
  assert.deepStrictEqual(revisarAntesDeGenerar({ ...base, nitDeReferencia: null }), []);
});

test('avisa si hay imágenes faltantes', () => {
  const avisos = revisarAntesDeGenerar({ ...base, recursosFaltantes: ['logo-encabezado', 'imagen-tabla'] });
  assert.strictEqual(avisos.length, 1);
  assert.match(avisos[0].texto, /2/);
  assert.match(avisos[0].texto, /logo-encabezado/);
  assert.match(avisos[0].texto, /imagen-tabla/);
});

test('sin recursosFaltantes no hay aviso', () => {
  const avisos = revisarAntesDeGenerar({ ...base, recursosFaltantes: [] });
  assert.strictEqual(avisos.length, 0);
});

test('con recursosFaltantes undefined no hay aviso', () => {
  const avisos = revisarAntesDeGenerar({ ...base, recursosFaltantes: undefined });
  assert.strictEqual(avisos.length, 0);
});

test('con recursosFaltantes absent no hay aviso', () => {
  const avisos = revisarAntesDeGenerar({ estudio: { nit: '800123456-7' }, nitDeReferencia: '800123456-7', vacios: [], tieneAnexo: true });
  assert.strictEqual(avisos.length, 0);
});

test('avisos se acumulan incluyendo recursosFaltantes', () => {
  const avisos = revisarAntesDeGenerar({
    ...base, nitDeReferencia: '901337576-6', tieneAnexo: false, vacios: ['ciiu'], recursosFaltantes: ['logo'],
  });
  assert.strictEqual(avisos.length, 4);
});

// Tests para normalización de NIT
test('NIT con puntos se normaliza y no dispara aviso si es igual', () => {
  const avisos = revisarAntesDeGenerar({
    ...base,
    estudio: { nit: '800.123.456-7' },
    nitDeReferencia: '800123456-7',
  });
  assert.strictEqual(avisos.length, 0);
});

test('NIT con espacios se normaliza y no dispara aviso si es igual', () => {
  const avisos = revisarAntesDeGenerar({
    ...base,
    estudio: { nit: '800 123 456-7' },
    nitDeReferencia: '800123456-7',
  });
  assert.strictEqual(avisos.length, 0);
});

test('NIT con puntos y espacios se normaliza correctamente', () => {
  const avisos = revisarAntesDeGenerar({
    ...base,
    estudio: { nit: '800.123.456 - 7' },
    nitDeReferencia: '800123456-7',
  });
  assert.strictEqual(avisos.length, 0);
});

test('NIT sin dígito de verificación iguala a NIT con dígito de verificación si la base coincide', () => {
  const avisos = revisarAntesDeGenerar({
    ...base,
    estudio: { nit: '800123456' },
    nitDeReferencia: '800123456-7',
  });
  assert.strictEqual(avisos.length, 0);
});

test('NIT con dígito de verificación iguala a NIT sin dígito si la base coincide', () => {
  const avisos = revisarAntesDeGenerar({
    ...base,
    estudio: { nit: '800123456-7' },
    nitDeReferencia: '800123456',
  });
  assert.strictEqual(avisos.length, 0);
});

test('NIT verdaderamente distinto sigue disparando aviso a pesar de normalización', () => {
  const avisos = revisarAntesDeGenerar({
    ...base,
    estudio: { nit: '800.123.456-7' },
    nitDeReferencia: '901337576-6',
  });
  assert.strictEqual(avisos.length, 1);
  assert.match(avisos[0].texto, /901337576-6/);
  assert.match(avisos[0].texto, /800\.123\.456-7/);
});

// Tests para entradas degeneradas
test('sin argumento no lanza y devuelve aviso vacío', () => {
  const avisos = revisarAntesDeGenerar();
  assert.deepStrictEqual(avisos, []);
});

test('argumento undefined no lanza y devuelve aviso vacío', () => {
  const avisos = revisarAntesDeGenerar(undefined);
  assert.deepStrictEqual(avisos, []);
});

test('objeto vacío {} no lanza y devuelve aviso vacío', () => {
  const avisos = revisarAntesDeGenerar({});
  assert.deepStrictEqual(avisos, []);
});

test('estudio null no lanza y devuelve aviso vacío', () => {
  const avisos = revisarAntesDeGenerar({ ...base, estudio: null });
  assert.deepStrictEqual(avisos, []);
});

test('vacios null no lanza', () => {
  const avisos = revisarAntesDeGenerar({ ...base, vacios: null });
  assert.strictEqual(avisos.length, 0);
});

test('recursosFaltantes null no lanza', () => {
  const avisos = revisarAntesDeGenerar({ ...base, recursosFaltantes: null });
  assert.strictEqual(avisos.length, 0);
});

// Tests para lógica de base y dígito de verificación según coordinador
test('NIT con puntos se normaliza y no dispara aviso si es igual', () => {
  const avisos = revisarAntesDeGenerar({
    ...base,
    estudio: { nit: '900123456-7' },
    nitDeReferencia: '900.123.456-7',
  });
  assert.strictEqual(avisos.length, 0);
});

test('NIT sin dígito de verificación no dispara aviso si la base coincide', () => {
  const avisos = revisarAntesDeGenerar({
    ...base,
    estudio: { nit: '900123456-7' },
    nitDeReferencia: '900123456',
  });
  assert.strictEqual(avisos.length, 0);
});

test('NIT con espacios alrededor no dispara aviso si es igual', () => {
  const avisos = revisarAntesDeGenerar({
    ...base,
    estudio: { nit: ' 900123456-7 ' },
    nitDeReferencia: '900123456-7',
  });
  assert.strictEqual(avisos.length, 0);
});

test('NIT que difiere solo en dígito de verificación debe avisar (es error de digitación)', () => {
  const avisos = revisarAntesDeGenerar({
    ...base,
    estudio: { nit: '800123456-7' },
    nitDeReferencia: '800123456-3',
  });
  assert.strictEqual(avisos.length, 1);
  assert.match(avisos[0].texto, /800123456-3/);
  assert.match(avisos[0].texto, /800123456-7/);
});

test('NIT con dígitos duplicados por error de OCR debe avisar', () => {
  const avisos = revisarAntesDeGenerar({
    ...base,
    estudio: { nit: '800123456-7' },
    nitDeReferencia: '8001234560007',
  });
  assert.strictEqual(avisos.length, 1);
  assert.match(avisos[0].texto, /8001234560007/);
});

test('NIT contra referencia con solo letras debe avisar', () => {
  const avisos = revisarAntesDeGenerar({
    ...base,
    estudio: { nit: '900123456-7' },
    nitDeReferencia: 'ABCDEFGHI',
  });
  assert.strictEqual(avisos.length, 1);
  assert.match(avisos[0].texto, /ABCDEFGHI/);
});

test('NIT contra referencia con solo espacios y guiones debe avisar', () => {
  const avisos = revisarAntesDeGenerar({
    ...base,
    estudio: { nit: '900123456-7' },
    nitDeReferencia: '   -  ',
  });
  assert.strictEqual(avisos.length, 1);
});

test('dos NIT de 9 dígitos sin guión donde uno es prefijo del otro debe avisar', () => {
  const avisos = revisarAntesDeGenerar({
    ...base,
    estudio: { nit: '123456789' },
    nitDeReferencia: '12345678',
  });
  assert.strictEqual(avisos.length, 1);
  assert.match(avisos[0].texto, /123456789/);
  assert.match(avisos[0].texto, /12345678/);
});

test('dos NIT sin dígito de verificación donde uno es prefijo del otro debe avisar', () => {
  const avisos = revisarAntesDeGenerar({
    ...base,
    estudio: { nit: '900111222' },
    nitDeReferencia: '90011122',
  });
  assert.strictEqual(avisos.length, 1);
  assert.match(avisos[0].texto, /900111222/);
  assert.match(avisos[0].texto, /90011122/);
});

test('NIT con bases distintas pero ambos con dígito de verificación debe avisar', () => {
  const avisos = revisarAntesDeGenerar({
    ...base,
    estudio: { nit: '900123456-7' },
    nitDeReferencia: '90012345-6',
  });
  assert.strictEqual(avisos.length, 1);
  assert.match(avisos[0].texto, /90012345-6/);
  assert.match(avisos[0].texto, /900123456-7/);
});

/* --- Bloqueante 3: nadie miraba el HTML ya renderizado. Los fallos de
   numeración de ocurrencias, de trozos perdidos y de campos fuera del
   vocabulario son invisibles para las guardas de entrada: todas opinan sobre
   los datos del estudio, no sobre el documento que se va a radicar. --- */

const estudioNuevo = { nit: '800123456-7', ent: 'ACME COLOMBIA S.A.S' };

test('los valores de referencia salen del contenido de las propias marcas', () => {
  const marcado =
    '<p>La sociedad <span data-campo="ent">END GAME INTERACTIVE COLOMBIA S.A.S</span> ' +
    'con NIT <span data-campo="nit">901.337.576-6</span> declara</p>';
  assert.deepStrictEqual(valoresDeReferencia(marcado), [
    { campo: 'ent', valor: 'END GAME INTERACTIVE COLOMBIA S.A.S' },
    { campo: 'nit', valor: '901.337.576-6' },
  ]);
});

test('los valores de referencia no se repiten aunque la marca aparezca cien veces', () => {
  const marcado = '<p><span data-campo="nit">901.337.576-6</span></p>'.repeat(5);
  assert.strictEqual(valoresDeReferencia(marcado).length, 1);
});

test('solo se vigilan los campos testigo, no el año', () => {
  const marcado = '<p><span data-campo="anio">2024</span></p>';
  assert.deepStrictEqual(valoresDeReferencia(marcado), [],
    'vigilar el año produciría avisos falsos en cada columna comparativa');
});

test('avisa con su cuenta si un dato de la referencia sobrevive en la salida', () => {
  const avisos = revisarSalidaRenderizada({
    estudio: estudioNuevo,
    htmlRenderizado:
      '<p>ACME COLOMBIA S.A.S declara</p><p>NIT 901.337.576-6</p><p>NIT 901.337.576-6</p>',
    valores: [{ campo: 'nit', valor: '901.337.576-6' }],
  });
  assert.strictEqual(avisos.length, 1);
  assert.strictEqual(avisos[0].cuenta, 2, 'debe decir cuántas veces sobrevivió');
  assert.match(avisos[0].texto, /901\.337\.576-6/);
  assert.match(avisos[0].texto, /800123456-7/, 'debe decir qué valor correspondía');
});

test('si nada de la referencia sobrevive no hay aviso', () => {
  const avisos = revisarSalidaRenderizada({
    estudio: estudioNuevo,
    htmlRenderizado: '<p>ACME COLOMBIA S.A.S con NIT 800123456-7 declara</p>',
    valores: [{ campo: 'nit', valor: '901.337.576-6' }, { campo: 'ent', valor: 'END GAME S.A.S' }],
  });
  assert.deepStrictEqual(avisos, []);
});

test('no avisa cuando el estudio activo es el mismo contribuyente de la referencia', () => {
  const avisos = revisarSalidaRenderizada({
    estudio: estudioNuevo,
    htmlRenderizado: '<p>NIT 800.123.456-7</p>',
    valores: [{ campo: 'nit', valor: '800.123.456-7' }],
  });
  assert.deepStrictEqual(avisos, [], 'el informe del año siguiente del mismo cliente no es fuga');
});

test('sin dato en el estudio no se inventa un aviso: la marca ya salió como hueco', () => {
  const avisos = revisarSalidaRenderizada({
    estudio: {},
    htmlRenderizado: '<p>NIT 901.337.576-6</p>',
    valores: [{ campo: 'nit', valor: '901.337.576-6' }],
  });
  assert.deepStrictEqual(avisos, []);
});

test('un base64 de imagen no dispara la guarda por casualidad', () => {
  const avisos = revisarSalidaRenderizada({
    estudio: estudioNuevo,
    htmlRenderizado: '<img src="data:image/png;base64,901337576609013375766" />',
    valores: [{ campo: 'nit', valor: '901337576609' }],
  });
  assert.deepStrictEqual(avisos, [], 'los atributos no se leen en el documento');
});

test('la guarda de salida se acumula con las demás dentro de revisarAntesDeGenerar', () => {
  const avisos = revisarAntesDeGenerar({
    estudio: estudioNuevo,
    nitDeReferencia: '800123456-7',
    vacios: [],
    tieneAnexo: true,
    recursosFaltantes: [],
    htmlRenderizado: '<p>END GAME INTERACTIVE COLOMBIA S.A.S</p>',
    valores: [{ campo: 'ent', valor: 'END GAME INTERACTIVE COLOMBIA S.A.S' }],
  });
  assert.strictEqual(avisos.length, 1);
  assert.match(avisos[0].texto, /END GAME INTERACTIVE COLOMBIA S\.A\.S/);
});

test('sin htmlRenderizado la guarda de salida no opina', () => {
  assert.deepStrictEqual(revisarAntesDeGenerar(base), []);
  assert.deepStrictEqual(
    revisarSalidaRenderizada({ estudio: estudioNuevo, htmlRenderizado: '', valores: [] }), []
  );
});

/* --- Residuales cerrados tras la revisión de rama --- */

/* R3: el domicilio y el representante son de la misma clase que la razón
   social —largos, específicos, sin repetirse en tablas comparativas— y antes
   quedaban fuera de la revisión de la salida. `direccion` es el caso que
   motivó agregarla al vocabulario, así que dejarla sin vigilar dejaba el
   arreglo a medias. */
test('la revisión de la salida vigila también domicilio, representante y objeto', () => {
  const marcado =
    '<p><span data-campo="direccion">carrera 48 No 20-34 Medellín</span></p>' +
    '<p><span data-campo="representante">Juan Pérez</span></p>' +
    '<p><span data-campo="objeto">Desarrollo de videojuegos</span></p>' +
    '<p><span data-campo="accionista.nombre">END GAME INTERACTIVE INC</span></p>' +
    '<p><span data-campo="vinc_tipo">Otros servicios (07)</span></p>';
  const campos = valoresDeReferencia(marcado).map((v) => v.campo);
  for (const c of ['direccion', 'representante', 'objeto', 'accionista.nombre', 'vinc_tipo']) {
    assert.ok(campos.includes(c), 'no se vigila el campo ' + c);
  }
});

test('un domicilio del cliente anterior que sobrevive sin marcar se reporta', () => {
  const estudio = { nit: '800123456-7', direccion: 'calle 10 No 5-20 Bogotá' };
  const marcado = '<p><span data-campo="direccion">carrera 48 No 20-34 Medellín</span></p>';
  const avisos = revisarAntesDeGenerar({
    estudio,
    vacios: [],
    tieneAnexo: true,
    recursosFaltantes: [],
    /* La salida trae el domicilio viejo en un párrafo que nadie marcó. */
    htmlRenderizado: '<p>El domicilio es carrera 48 No 20-34 Medellín</p>',
    valores: valoresDeReferencia(marcado),
  });
  assert.strictEqual(avisos.length, 1, JSON.stringify(avisos));
  assert.match(avisos[0].texto, /carrera 48 No 20-34 Medellín/);
  assert.strictEqual(avisos[0].campo, 'direccion');
});

/* R2: si el marcado no dejó ninguna marca de los campos testigo, la revisión de
   la salida se queda sin nada que comparar. Callar en ese caso sería
   indistinguible de un visto bueno, y es justo el peor caso: pasaba cuando
   todas las llamadas del marcado fallaban. */
test('una plantilla marcada sin ningún valor de referencia avisa de su propia ceguera', () => {
  const avisos = revisarAntesDeGenerar({
    estudio: estudioNuevo,
    vacios: [],
    tieneAnexo: true,
    recursosFaltantes: [],
    htmlRenderizado: '<p>END GAME INTERACTIVE COLOMBIA S.A.S con NIT 901.337.576-6</p>',
    valores: [],
  });
  assert.strictEqual(avisos.length, 1, JSON.stringify(avisos));
  assert.match(avisos[0].texto, /no se puede comprobar/i);
});

test('con valores de referencia presentes no se avisa de ceguera', () => {
  const avisos = revisarAntesDeGenerar({
    estudio: estudioNuevo,
    vacios: [],
    tieneAnexo: true,
    recursosFaltantes: [],
    /* El nombre viejo ya no está: la sustitución funcionó y no hay nada que decir. */
    htmlRenderizado: '<p>ACME COLOMBIA S.A.S</p>',
    valores: [{ campo: 'ent', valor: 'END GAME INTERACTIVE COLOMBIA S.A.S' }],
  });
  assert.deepStrictEqual(avisos, []);
});

/* --- Plantilla extraída con un lector anterior --- */

test('avisa cuando la plantilla viene de un lector de PDF anterior', () => {
  /* Las plantillas se guardan y se reutilizan, así que una extraída hace dos
     versiones sigue produciendo el documento de entonces. Pasó de verdad: un
     informe salió sin negritas porque su plantilla se había marcado antes del
     cambio de tipografía, y no había forma de saberlo. */
  const avisos = revisarAntesDeGenerar({
    estudio: estudioNuevo,
    vacios: [],
    tieneAnexo: true,
    recursosFaltantes: [],
    faltaPorVersion: ['el documento sale sin la tipografía del informe'],
  });
  assert.strictEqual(avisos.length, 1, JSON.stringify(avisos));
  assert.match(avisos[0].texto, /tipografía/);
  /* La acción tiene que quedar clara: volver a marcar no basta, porque reutiliza
     el HTML ya guardado. */
  assert.match(avisos[0].texto, /vuelve a subir/i);
  assert.match(avisos[0].texto, /volver a marcar no basta/i);
});

test('una plantilla al día no dispara el aviso de versión', () => {
  for (const v of [undefined, null, []]) {
    assert.deepStrictEqual(
      revisarAntesDeGenerar({
        estudio: estudioNuevo, vacios: [], tieneAnexo: true, recursosFaltantes: [],
        faltaPorVersion: v,
      }),
      [],
      'avisó con faltaPorVersion = ' + JSON.stringify(v)
    );
  }
});

test('el aviso de plantilla vieja no necesita nada más para salir', () => {
  /* La ruta de una plantilla guardada y sin marcar no tiene render, ni valores de
     referencia, ni estudio a mano cuando avisa. Antes esa ruta callaba, y el
     documento salía como el lector de entonces lo dejaba sin que nadie lo supiera. */
  const a = revisarAntesDeGenerar({ faltaPorVersion: ['le falta X'] });
  assert.strictEqual(a.length, 1);
  assert.match(a[0].texto, /Vuelve a subir el mismo PDF/);
  assert.match(a[0].texto, /le falta X/);
  /* Y sin nada que avisar no inventa avisos. */
  assert.deepStrictEqual(revisarAntesDeGenerar({ faltaPorVersion: [] }), []);
  assert.deepStrictEqual(revisarAntesDeGenerar({}), []);
});

/* ══════════════════ sustitución de los datos del informe de referencia ══════════════════ */

const wt = (t) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;

test('sustituye el dato del informe de referencia por el del estudio', () => {
  /* Avisar no basta: en un informe real sobreviven decenas de apariciones y el trabajo
     quedaba para el ojo de quien radica. */
  const xml = wt('Estudio de ACME ANTERIOR SAS para el año.') + wt('Otra vez ACME ANTERIOR SAS aquí.');
  const r = sustituirDatosDeReferencia(xml, {
    estudio: { ent: 'NUEVA COMPAÑIA SAS' },
    valores: [{ campo: 'ent', valor: 'ACME ANTERIOR SAS' }],
  });
  assert.ok(!r.xml.includes('ACME ANTERIOR'), 'el dato anterior no puede sobrevivir');
  assert.strictEqual((r.xml.match(/NUEVA COMPAÑIA SAS/g) || []).length, 2, 'en las dos apariciones');
  assert.strictEqual(r.sustituidos[0].cuenta, 2);
});

test('no toca un valor que es parte de otro valor de la lista', () => {
  /* «END GAME» está dentro de «END GAME INTERACTIVE»: sustituirlo reescribiría también las
     menciones de la vinculada, que es otra empresa. */
  const xml = wt('END GAME INTERACTIVE es la vinculada de END GAME.');
  const r = sustituirDatosDeReferencia(xml, {
    estudio: { ent: 'CONTRIBUYENTE NUEVO SAS', vinc: 'OTRA VINCULADA INC' },
    valores: [
      { campo: 'ent', valor: 'END GAME' },
      { campo: 'vinc', valor: 'END GAME INTERACTIVE' },
    ],
  });
  assert.ok(r.xml.includes('END GAME.'), 'la mención corta se queda como estaba');
  assert.ok(r.omitidos.some((o) => o.valor === 'END GAME'), 'y se informa de por qué');
  assert.match(r.omitidos.find((o) => o.valor === 'END GAME').motivo, /es parte de/);
  assert.ok(r.xml.includes('OTRA VINCULADA INC'), 'la que sí es inequívoca se corrige');
});

test('no duplica el sufijo cuando el valor viejo es el principio del nuevo', () => {
  /* «END GAME INTERACTIVE» → «END GAME INTERACTIVE INC». Sin la guarda, las apariciones ya
     correctas se volvían «END GAME INTERACTIVE INC INC» en cada generación. */
  const xml = wt('Aquí END GAME INTERACTIVE INC ya está bien.') + wt('Y aquí END GAME INTERACTIVE falta.');
  const r = sustituirDatosDeReferencia(xml, {
    estudio: { vinc: 'END GAME INTERACTIVE INC' },
    valores: [{ campo: 'vinc', valor: 'END GAME INTERACTIVE' }],
  });
  assert.ok(!r.xml.includes('INC INC'), 'nunca se duplica el sufijo');
  assert.strictEqual((r.xml.match(/END GAME INTERACTIVE INC/g) || []).length, 2,
    'las dos quedan completas');
  assert.strictEqual(r.sustituidos[0].cuenta, 1, 'solo se tocó la que faltaba');
});

test('si el estudio trae el mismo dato no se toca nada', () => {
  /* El mismo contribuyente el año siguiente: no hay fuga que corregir. */
  const xml = wt('Estudio de ACME SAS.');
  const r = sustituirDatosDeReferencia(xml, {
    estudio: { ent: 'ACME SAS' },
    valores: [{ campo: 'ent', valor: 'ACME SAS' }],
  });
  assert.strictEqual(r.xml, xml);
  assert.strictEqual(r.sustituidos.length, 0);
});

test('un valor partido entre varios tramos del párrafo se deja y se informa', () => {
  /* Word parte el texto por revisiones ortográficas. Sustituir a través de los runs
     rompería el formato del párrafo. */
  const xml = '<w:p><w:r><w:t>ACME ANT</w:t></w:r><w:r><w:t>ERIOR SAS cerró.</w:t></w:r></w:p>';
  const r = sustituirDatosDeReferencia(xml, {
    estudio: { ent: 'NUEVA SAS' },
    valores: [{ campo: 'ent', valor: 'ACME ANTERIOR SAS' }],
  });
  assert.strictEqual(r.xml, xml, 'no se toca');
  assert.ok(r.omitidos.some((o) => /repartido entre varios tramos/.test(o.motivo)));
});

/* ══════ el aviso no puede contar como fuga lo que ya está bien ══════ */

/* Los valores del caso real que lo destapó: la razón social nueva es una ampliación de la vieja
   —«SAS» pasa a «SOCIEDAD POR ACCIONES SIMPLIFICADA»— y la vinculada gana un «INC», así que
   ambos valores NUEVOS empiezan por los VIEJOS. */
const ESTUDIO_AMPLIADO = {
  ent: 'END GAME INTERACTIVE COLOMBIA SOCIEDAD POR ACCIONES SIMPLIFICADA',
  vinc: 'END GAME INTERACTIVE INC',
};
const VALORES_AMPLIADO = [
  { campo: 'ent', valor: 'END GAME INTERACTIVE COLOMBIA SAS' },
  { campo: 'ent', valor: 'END GAME' },
  { campo: 'vinc', valor: 'END GAME INTERACTIVE' },
];

test('un documento sin fugas no produce ni un aviso, aunque el valor nuevo contenga al viejo', () => {
  /* Éste es el defecto que se reportó: con estos valores, un documento COMPLETAMENTE correcto
     avisaba de 73 apariciones de «END GAME» y otras 73 de «END GAME INTERACTIVE», porque el
     conteo no distinguía una fuga de una sustitución que sí funcionó. Un banner que grita
     cuando todo está bien enseña a ignorarlo, y este banner es el único que mira la salida. */
  const html = '<p>El contribuyente END GAME INTERACTIVE COLOMBIA SOCIEDAD POR ACCIONES '
    + 'SIMPLIFICADA opera con su vinculada END GAME INTERACTIVE INC.</p>';
  const avisos = revisarSalidaRenderizada({
    estudio: ESTUDIO_AMPLIADO, htmlRenderizado: html, valores: VALORES_AMPLIADO,
  });
  assert.deepStrictEqual(avisos, [], 'avisó de una fuga inexistente: '
    + avisos.map((a) => a.texto).join(' | '));
});

test('una sola fuga produce un solo aviso, el del valor más específico', () => {
  /* «END GAME INTERACTIVE COLOMBIA SAS» contiene «END GAME INTERACTIVE» y «END GAME», así que
     una única aparición de la razón social vieja daba tres avisos y parecían tres problemas. */
  const html = '<p>Estudio de END GAME INTERACTIVE COLOMBIA SAS del año.</p>';
  const avisos = revisarSalidaRenderizada({
    estudio: ESTUDIO_AMPLIADO, htmlRenderizado: html, valores: VALORES_AMPLIADO,
  });
  assert.strictEqual(avisos.length, 1, 'la misma fuga se contó más de una vez: '
    + avisos.map((a) => a.campo + '/' + a.cuenta).join(' | '));
  assert.strictEqual(avisos[0].cuenta, 1);
  assert.match(avisos[0].texto, /END GAME INTERACTIVE COLOMBIA SAS/);
});

test('la fuga que queda suelta sí se cuenta, y una sola vez', () => {
  const html = '<p>END GAME INTERACTIVE INC y la matriz permiten a END GAME crecer.</p>';
  const avisos = revisarSalidaRenderizada({
    estudio: ESTUDIO_AMPLIADO, htmlRenderizado: html, valores: VALORES_AMPLIADO,
  });
  assert.strictEqual(avisos.length, 1, 'esperaba solo la del nombre corto suelto');
  assert.strictEqual(avisos[0].campo, 'ent');
  assert.strictEqual(avisos[0].cuenta, 1, 'la mención correcta de la vinculada no es una fuga');
});

/* ══════ la sustitución no se pisa a sí misma ══════ */

test('lo ya sustituido no lo reescribe el par siguiente', () => {
  /* Al cambiar «END GAME INTERACTIVE COLOMBIA SAS» por la razón social larga, el resultado
     contiene «END GAME INTERACTIVE», que es el valor viejo de la vinculada. Sin proteger lo ya
     escrito, el par de la vinculada lo convertía en «END GAME INTERACTIVE INC COLOMBIA SOCIEDAD
     POR ACCIONES SIMPLIFICADA». */
  const html = '<p>Estudio de END GAME INTERACTIVE COLOMBIA SAS del año.</p>';
  const r = sustituirDatosDeReferencia(html, {
    estudio: ESTUDIO_AMPLIADO, valores: VALORES_AMPLIADO, rxTramo: TRAMO_HTML,
  });
  assert.ok(r.xml.includes('END GAME INTERACTIVE COLOMBIA SOCIEDAD POR ACCIONES SIMPLIFICADA'),
    'la razón social nueva no quedó entera: ' + r.xml);
  assert.ok(!r.xml.includes('INC COLOMBIA'), 'un par posterior reescribió lo ya sustituido');
  assert.ok(!/@@PT-REF/.test(r.xml), 'quedó un token sin resolver');
});

test('la sustitución funciona igual sobre HTML que sobre OOXML', () => {
  /* La plantilla puede ser un .docx —cuyo OOXML se edita— o un PDF —que se lee a HTML—, y el
     dato del contribuyente anterior sobrevive igual en las dos. */
  const html = '<p>Estudio de ACME ANTERIOR SAS.</p>';
  const r = sustituirDatosDeReferencia(html, {
    estudio: { ent: 'NUEVA COMPAÑIA SAS' },
    valores: [{ campo: 'ent', valor: 'ACME ANTERIOR SAS' }],
    rxTramo: TRAMO_HTML,
  });
  assert.ok(r.xml.includes('NUEVA COMPAÑIA SAS'), 'no sustituyó en HTML');
  assert.ok(!r.xml.includes('ACME ANTERIOR'), 'sobrevivió el dato anterior');
  assert.strictEqual(r.sustituidos[0].cuenta, 1);
});

test('no se toca nada dentro de un atributo, ni de un data URL', () => {
  /* Los `data:image/png;base64,…` son megabytes de texto donde cualquier cosa aparece por
     casualidad, y un atributo no se lee en el documento. */
  const html = '<img alt="ACME ANTERIOR SAS" src="data:image/png;base64,QUNNRSBBTlRFUklPUiBTQVM=" />'
    + '<p>Estudio de ACME ANTERIOR SAS.</p>';
  const r = sustituirDatosDeReferencia(html, {
    estudio: { ent: 'NUEVA SAS' },
    valores: [{ campo: 'ent', valor: 'ACME ANTERIOR SAS' }],
    rxTramo: TRAMO_HTML,
  });
  assert.ok(r.xml.includes('alt="ACME ANTERIOR SAS"'), 'se tocó un atributo');
  assert.ok(r.xml.includes('base64,QUNNRSBBTlRFUklPUiBTQVM='), 'se tocó un data URL');
  assert.ok(r.xml.includes('<p>Estudio de NUEVA SAS.</p>'), 'no sustituyó donde debía');
});

/* ══════ el mismo nombre escrito con otra puntuación ══════ */

test('encuentra la razón social vieja aunque la puntuación no coincida', () => {
  /* Medido sobre el informe de referencia: la razón social del contribuyente anterior aparece 27
     veces como «COLOMBIA SAS» y otras 17 como «COLOMBIA S.A.S». El marcado captura una sola de
     las dos formas, así que buscar el valor literal dejaba las otras sin corregir y se radicaban
     con el dato del contribuyente anterior. */
  const html = '<p>De ACME ANTERIOR SAS y de ACME ANTERIOR S.A.S. y de Acme Anterior S A S.</p>';
  const r = sustituirDatosDeReferencia(html, {
    estudio: { ent: 'NUEVA COMPAÑIA SAS' },
    valores: [{ campo: 'ent', valor: 'ACME ANTERIOR SAS' }],
    rxTramo: TRAMO_HTML,
  });
  assert.strictEqual(r.sustituidos[0].cuenta, 3, 'no encontró las tres formas: ' + r.xml);
  assert.ok(!/ACME ANTERIOR/i.test(r.xml), 'sobrevive alguna forma del dato anterior: ' + r.xml);
});

test('la puntuación que se ESCRIBE es la del estudio, no la normalizada', () => {
  /* Se ignora la puntuación para ENCONTRAR, nunca para sustituir: lo que entra al documento es
     el valor del estudio tal cual, con sus puntos. */
  const html = '<p>Estudio de ACME ANTERIOR SAS.</p>';
  const r = sustituirDatosDeReferencia(html, {
    estudio: { ent: 'NUEVA COMPAÑIA S.A.S.' },
    valores: [{ campo: 'ent', valor: 'ACME ANTERIOR SAS' }],
    rxTramo: TRAMO_HTML,
  });
  assert.ok(r.xml.includes('NUEVA COMPAÑIA S.A.S.'),
    'se perdió la puntuación del valor del estudio: ' + r.xml);
});

test('un valor corto se sigue buscando literal, sin tolerancia', () => {
  /* «END GAME» son siete caracteres sin espacios y no llega al mínimo de la búsqueda tolerante.
     Sin el respaldo literal, las apariciones del nombre corto dejarían de detectarse. */
  const html = '<p>permite a END GAME crecer.</p>';
  const avisos = revisarSalidaRenderizada({
    estudio: ESTUDIO_AMPLIADO, htmlRenderizado: html, valores: VALORES_AMPLIADO,
  });
  assert.strictEqual(avisos.length, 1, 'dejó de ver el nombre corto');
  assert.strictEqual(avisos[0].cuenta, 1);
});

test('si el contribuyente conserva su razón social y solo cambia la puntuación, no se destroza nada', () => {
  /* El caso más común: el mismo cliente al año siguiente. Ese par no tiene nada que corregir, así
     que se descarta — y por eso la guarda de ambigüedad tiene que mirar TODOS los valores de
     referencia y no sólo los que quedaron por corregir. Mirando sólo los pendientes, «END GAME
     INTERACTIVE» se quedaba sin contenedor y se sustituía dentro de las menciones del
     contribuyente, dejándolas en «END GAME INTERACTIVE INC COLOMBIA S.A.S». Medido: 45
     apariciones destrozadas en el informe real. */
  const html = '<p>END GAME INTERACTIVE COLOMBIA S.A.S. presta servicios a su vinculada.</p>';
  const r = sustituirDatosDeReferencia(html, {
    estudio: {
      ent: 'END GAME INTERACTIVE COLOMBIA S.A.S.',
      vinc: 'END GAME INTERACTIVE INC',
    },
    valores: [
      { campo: 'ent', valor: 'END GAME INTERACTIVE COLOMBIA SAS' },
      { campo: 'vinc', valor: 'END GAME INTERACTIVE' },
    ],
    rxTramo: TRAMO_HTML,
  });
  assert.ok(!r.xml.includes('INC COLOMBIA'),
    'se metió el sufijo de la vinculada dentro del nombre del contribuyente: ' + r.xml);
  assert.ok(r.xml.includes('END GAME INTERACTIVE COLOMBIA S.A.S. presta'),
    'se alteró el nombre del contribuyente, que estaba bien: ' + r.xml);
  assert.ok(r.omitidos.some((o) => /es parte de/.test(o.motivo)),
    'no explicó por qué no tocó la vinculada');
});

test('aplicarla dos veces no cambia el resultado', () => {
  /* La vista previa se re-renderiza a cada cambio del estudio. */
  const html = '<p>Estudio de END GAME INTERACTIVE COLOMBIA SAS con END GAME INTERACTIVE INC.</p>';
  const opciones = {
    estudio: ESTUDIO_AMPLIADO, valores: VALORES_AMPLIADO, rxTramo: TRAMO_HTML,
  };
  const una = sustituirDatosDeReferencia(html, opciones).xml;
  const dos = sustituirDatosDeReferencia(una, opciones).xml;
  assert.strictEqual(dos, una, 'la segunda pasada vuelve a cambiar el documento');
});
