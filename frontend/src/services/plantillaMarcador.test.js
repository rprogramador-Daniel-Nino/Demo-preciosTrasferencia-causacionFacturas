import { test } from 'node:test';
import assert from 'node:assert';
import { aplicarMarcas } from './plantillaMarcador.js';

test('marca un fragmento que existe y deja el resto intacto', () => {
  const html = '<p>La sociedad ACME COLOMBIA S.A.S declara</p>';
  const r = aplicarMarcas(html, [{ fragmento: 'ACME COLOMBIA S.A.S', campo: 'ent', ocurrencia: 1 }]);
  assert.strictEqual(r.aplicadas, 1);
  assert.strictEqual(
    r.html,
    '<p>La sociedad <span data-campo="ent">ACME COLOMBIA S.A.S</span> declara</p>'
  );
});

test('descarta el fragmento que no existe y dice por qué', () => {
  const html = '<p>La sociedad ACME declara</p>';
  const r = aplicarMarcas(html, [{ fragmento: 'NO ESTÁ', campo: 'ent', ocurrencia: 1 }]);
  assert.strictEqual(r.aplicadas, 0);
  assert.strictEqual(r.html, html, 'el documento no debe cambiar');
  assert.strictEqual(r.descartadas.length, 1);
  assert.match(r.descartadas[0].motivo, /no aparece/i);
});

test('descarta el campo que no está en el vocabulario', () => {
  const html = '<p>3001234567</p>';
  /* `telefono` no está en el vocabulario; `direccion` sí lo está desde que se
     corrigió ese hueco, así que ya no sirve como campo inválido de ejemplo. */
  const r = aplicarMarcas(html, [{ fragmento: '3001234567', campo: 'telefono', ocurrencia: 1 }]);
  assert.strictEqual(r.aplicadas, 0);
  assert.match(r.descartadas[0].motivo, /vocabulario/i);
});

/* El fragmento debe buscarse solo en el texto visible. Si se buscara sobre el
   HTML crudo, un fragmento que coincida con el valor de un atributo rompería
   la etiqueta y el documento dejaría de ser válido. */
test('no marca dentro de una etiqueta ni de un atributo', () => {
  const html = '<p title="ent">ent aparece aquí</p>';
  const r = aplicarMarcas(html, [{ fragmento: 'ent', campo: 'ent', ocurrencia: 1 }]);
  assert.ok(r.html.includes('title="ent"'), 'el atributo no debe tocarse');
  assert.ok(r.html.includes('<span data-campo="ent">ent</span> aparece'), 'debe marcar el texto');
});

test('la ocurrencia elige cuál de las repeticiones se marca', () => {
  const html = '<p>2024 y 2024</p>';
  const r = aplicarMarcas(html, [{ fragmento: '2024', campo: 'anio', ocurrencia: 2 }]);
  assert.strictEqual(r.html, '<p>2024 y <span data-campo="anio">2024</span></p>');
});

test('una ocurrencia que no existe se descarta en vez de marcar otra', () => {
  const html = '<p>2024</p>';
  const r = aplicarMarcas(html, [{ fragmento: '2024', campo: 'anio', ocurrencia: 3 }]);
  assert.strictEqual(r.aplicadas, 0);
  assert.strictEqual(r.html, html);
});

test('marcas sobre el mismo texto no se pisan entre sí', () => {
  const html = '<p>ACME S.A.S con NIT 800123456-7</p>';
  const r = aplicarMarcas(html, [
    { fragmento: 'ACME S.A.S', campo: 'ent', ocurrencia: 1 },
    { fragmento: '800123456-7', campo: 'nit', ocurrencia: 1 },
  ]);
  assert.strictEqual(r.aplicadas, 2);
  assert.ok(r.html.includes('<span data-campo="ent">ACME S.A.S</span>'));
  assert.ok(r.html.includes('<span data-campo="nit">800123456-7</span>'));
});

test('solapamiento: contenedora primero, contenida después se rechaza', () => {
  const original = '<p>ACME COLOMBIA S.A.S</p>';
  const r = aplicarMarcas(original, [
    { fragmento: 'ACME COLOMBIA S.A.S', campo: 'ent', ocurrencia: 1 },
    { fragmento: 'COLOMBIA', campo: 'nit', ocurrencia: 1 },
  ]);
  assert.strictEqual(r.aplicadas, 1, 'solo la primera marca debe aplicarse');
  assert.strictEqual(r.descartadas.length, 1);
  assert.match(r.descartadas[0].motivo, /solapa/i);
  assert.ok(r.html.includes('<span data-campo="ent">ACME COLOMBIA S.A.S</span>'));
  const sinSpans = r.html.replace(/<span[^>]*>/g, '').replace(/<\/span>/g, '');
  assert.strictEqual(sinSpans, original);
});

test('solapamiento: contenida primero, contenedora después se rechaza', () => {
  const original = '<p>ACME COLOMBIA S.A.S</p>';
  const r = aplicarMarcas(original, [
    { fragmento: 'COLOMBIA', campo: 'nit', ocurrencia: 1 },
    { fragmento: 'ACME COLOMBIA S.A.S', campo: 'ent', ocurrencia: 1 },
  ]);
  assert.strictEqual(r.aplicadas, 1, 'solo la primera marca debe aplicarse');
  assert.strictEqual(r.descartadas.length, 1);
  assert.match(r.descartadas[0].motivo, /solapa/i);
  assert.ok(r.html.includes('<span data-campo="nit">COLOMBIA</span>'));
  const sinSpans = r.html.replace(/<span[^>]*>/g, '').replace(/<\/span>/g, '');
  assert.strictEqual(sinSpans, original);
});

test('solapamiento parcial: dos fragmentos que comparten parte se rechazan', () => {
  const original = '<p>ACME COLOMBIA S.A.S</p>';
  const r = aplicarMarcas(original, [
    { fragmento: 'ACME COLOMBIA', campo: 'ent', ocurrencia: 1 },
    { fragmento: 'COLOMBIA S.A.S', campo: 'nit', ocurrencia: 1 },
  ]);
  assert.strictEqual(r.aplicadas, 1);
  assert.strictEqual(r.descartadas.length, 1);
  assert.match(r.descartadas[0].motivo, /solapa/i);
  const sinSpans = r.html.replace(/<span[^>]*>/g, '').replace(/<\/span>/g, '');
  assert.strictEqual(sinSpans, original);
});

test('caso realista: cifra menor dentro de mayor se rechaza', () => {
  const original = '<p>Total 1.234.567</p>';
  const r = aplicarMarcas(original, [
    { fragmento: '1.234.567', campo: 'eeff.t_act_tot', ocurrencia: 1 },
    { fragmento: '234.567', campo: 'eeff.t_inv', ocurrencia: 1 },
  ]);
  assert.strictEqual(r.aplicadas, 1);
  assert.strictEqual(r.descartadas.length, 1);
  assert.match(r.descartadas[0].motivo, /solapa/i);
  const sinSpans = r.html.replace(/<span[^>]*>/g, '').replace(/<\/span>/g, '');
  assert.strictEqual(sinSpans, original);
});

test('fragmento partido por etiqueta original se rechaza con "no aparece"', () => {
  const html = '<p>ACME</p><p>COLOMBIA</p>';
  const r = aplicarMarcas(html, [{ fragmento: 'MECOLOM', campo: 'ent', ocurrencia: 1 }]);
  assert.strictEqual(r.aplicadas, 0);
  assert.strictEqual(r.html, html, 'el documento no debe cambiar');
  assert.strictEqual(r.descartadas.length, 1);
  assert.match(r.descartadas[0].motivo, /no aparece/i);
  assert.doesNotMatch(r.descartadas[0].motivo, /solapa/i);
});

test('remover los spans recupera el documento original', () => {
  const original = '<p>ACME COLOMBIA S.A.S</p>';
  const r = aplicarMarcas(original, [
    { fragmento: 'ACME COLOMBIA S.A.S', campo: 'ent', ocurrencia: 1 },
  ]);
  const sinSpans = r.html.replace(/<span[^>]*>/g, '').replace(/<\/span>/g, '');
  assert.strictEqual(sinSpans, original);
});

test('remover los spans con múltiples marcas recupera el original', () => {
  const original = '<p>ACME S.A.S con NIT 800123456-7</p>';
  const r = aplicarMarcas(original, [
    { fragmento: 'ACME S.A.S', campo: 'ent', ocurrencia: 1 },
    { fragmento: '800123456-7', campo: 'nit', ocurrencia: 1 },
  ]);
  const sinSpans = r.html.replace(/<span[^>]*>/g, '').replace(/<\/span>/g, '');
  assert.strictEqual(sinSpans, original);
});

import {
  trocear, proponerMarcas, contarApariciones, contextoDeMarca,
  MOTIVO_SOLAPE, MOTIVO_SIN_APARICION_LIBRE,
} from './plantillaMarcador.js';

test('trocear no parte por la mitad una etiqueta', () => {
  const html = '<p>' + 'a'.repeat(50) + '</p><p>' + 'b'.repeat(50) + '</p>';
  const trozos = trocear(html, 60);
  assert.ok(trozos.length > 1, 'debería trocearse');
  assert.strictEqual(trozos.join(''), html, 'los trozos deben reconstruir el original');
  for (const t of trozos) {
    const abiertas = (t.match(/</g) || []).length;
    const cerradas = (t.match(/>/g) || []).length;
    assert.strictEqual(abiertas, cerradas, 'trozo con una etiqueta partida: ' + t);
  }
});

test('proponerMarcas acepta solo campos del vocabulario y cuenta lo rechazado', async () => {
  const respuesta = JSON.stringify({
    marcas: [
      { fragmento: 'ACME S.A.S', campo: 'ent', ocurrencia: 1 },
      { fragmento: '3001234567', campo: 'telefono', ocurrencia: 1 },
    ],
  });
  const r = await proponerMarcas('<p>ACME S.A.S, tel 3001234567</p>', {
    pedir: async () => 'Aquí van las marcas:\n```json\n' + respuesta + '\n```\nEso es todo.',
  });
  assert.strictEqual(r.marcas.length, 1);
  assert.strictEqual(r.marcas[0].fragmento, 'ACME S.A.S');
  assert.strictEqual(r.marcas[0].campo, 'ent');
  assert.strictEqual(r.marcas[0].ocurrencia, 1);
  /* Que el modelo señale un dato con un nombre inexistente no es ruido: estaba
     diciendo "aquí hay un dato del cliente anterior". Se cuenta. */
  assert.strictEqual(r.rechazadasPorVocabulario, 1);
  assert.strictEqual(r.trozosFallidos, 0);
});

test('un trozo que falla no tumba los demás, pero se cuenta', async () => {
  let llamada = 0;
  const r = await proponerMarcas('<p>' + 'a'.repeat(80) + '</p><p>ACME S.A.S</p>', {
    maxCaracteres: 60,
    pedir: async () => {
      llamada++;
      if (llamada === 1) throw new Error('502 del proxy');
      return JSON.stringify({ marcas: [{ fragmento: 'ACME S.A.S', campo: 'ent', ocurrencia: 1 }] });
    },
  });
  assert.strictEqual(r.marcas.length, 1, 'debería conservar lo que sí salió');
  assert.strictEqual(r.trozosFallidos, 1, 'el trozo perdido tiene que quedar contado');
  assert.ok(r.trozosEnviados >= 2, 'debe reportar cuántos trozos se enviaron');
});

test('una respuesta que no trae JSON no rompe y cuenta como trozo fallido', async () => {
  const r = await proponerMarcas('<p>ACME</p>', { pedir: async () => 'No encontré nada.' });
  assert.deepStrictEqual(r.marcas, []);
  assert.strictEqual(r.trozosEnviados, 1);
  assert.strictEqual(r.trozosFallidos, 1);
});

/* --- Bloqueante 1: la ocurrencia se numeraba por trozo y se contaba por
   documento. El caso reproducido: tres apariciones de la misma razón social,
   una en el trozo 1 y dos en el trozo 2. El modelo, que solo ve su trozo,
   devuelve ocurrencias [1, 1, 2]; sin traducir a global se aplicaban 2 marcas,
   una caía en la posición equivocada y una aparición del cliente anterior
   sobrevivía. --- */
test('la ocurrencia local de cada trozo se traduce a ocurrencia global', async () => {
  const relleno = '<p>' + 'x'.repeat(70) + '</p>';
  const html =
    '<p>Informe de END GAME COLOMBIA S.A.S para el año</p>' + relleno +
    '<p>END GAME COLOMBIA S.A.S declara</p><p>y END GAME COLOMBIA S.A.S concluye</p>';

  const porTrozo = [
    { marcas: [{ fragmento: 'END GAME COLOMBIA S.A.S', campo: 'ent', ocurrencia: 1 }] },
    { marcas: [] },
    {
      marcas: [
        { fragmento: 'END GAME COLOMBIA S.A.S', campo: 'ent', ocurrencia: 1 },
        { fragmento: 'END GAME COLOMBIA S.A.S', campo: 'ent', ocurrencia: 2 },
      ],
    },
  ];
  let i = 0;
  const r = await proponerMarcas(html, {
    maxCaracteres: 80,
    pedir: async () => JSON.stringify(porTrozo[i++] || { marcas: [] }),
  });

  assert.deepStrictEqual(
    r.marcas.map((m) => m.ocurrencia), [1, 2, 3],
    'las ocurrencias locales debían salir traducidas a 1, 2 y 3 del documento'
  );

  const aplicado = aplicarMarcas(html, r.marcas);
  assert.strictEqual(aplicado.aplicadas, 3, 'las tres apariciones debían marcarse');
  assert.strictEqual(aplicado.descartadas.length, 0);
  /* Lo que de verdad importa: ninguna aparición del cliente anterior queda
     fuera de una marca, así que ninguna sobrevive al renderizar. */
  const sinMarcar = aplicado.html.replace(
    /<span data-campo="ent">END GAME COLOMBIA S\.A\.S<\/span>/g, ''
  );
  assert.ok(
    !sinMarcar.includes('END GAME COLOMBIA S.A.S'),
    'sobrevivió una aparición sin marcar del dato del cliente anterior'
  );
  /* Y el documento no se alteró: quitar los spans devuelve el original. */
  assert.strictEqual(
    aplicado.html.replace(/<span[^>]*>/g, '').replace(/<\/span>/g, ''), html
  );
});

test('las marcas del mismo fragmento se aplican cada una en su propia aparición', () => {
  const html = '<p>2024 y 2024 y 2024</p>';
  const r = aplicarMarcas(html, [
    { fragmento: '2024', campo: 'anio', ocurrencia: 1 },
    { fragmento: '2024', campo: 'anio', ocurrencia: 2 },
    { fragmento: '2024', campo: 'anio', ocurrencia: 3 },
  ]);
  assert.strictEqual(r.aplicadas, 3);
  assert.strictEqual(
    r.html,
    '<p><span data-campo="anio">2024</span> y <span data-campo="anio">2024</span>' +
    ' y <span data-campo="anio">2024</span></p>'
  );
});

test('contarApariciones cuenta igual que aplicarMarcas: ni atributos ni cruces de etiqueta', () => {
  assert.strictEqual(contarApariciones('<p title="ent">ent y ent</p>', 'ent'), 2,
    'el valor del atributo no debe contarse');
  assert.strictEqual(contarApariciones('<p>ACME</p><p>COLOMBIA</p>', 'MECOLOM'), 0,
    'un fragmento partido por una etiqueta original no existe');
  assert.strictEqual(contarApariciones('<p>2024 y 2024</p>', '2024'), 2);
});

test('una ocurrencia que el documento no tiene se descarta con motivo propio, no como solape', () => {
  const r = aplicarMarcas('<p>2024</p>', [{ fragmento: '2024', campo: 'anio', ocurrencia: 3 }]);
  assert.strictEqual(r.aplicadas, 0);
  assert.strictEqual(r.descartadas[0].motivo, MOTIVO_SIN_APARICION_LIBRE);
  assert.notStrictEqual(r.descartadas[0].motivo, MOTIVO_SOLAPE,
    'este caso no es benigno y no debe anunciarse como un solape');
});

/* --- Hueco del spec §4: el revisor necesita contexto para poder decidir --- */
test('contextoDeMarca da texto a los dos lados de la aparición pedida', () => {
  const html =
    '<p>El contribuyente con NIT 900111222-3 celebró operaciones</p>' +
    '<p>con el vinculado cuyo NIT 900111222-3 figura en el anexo</p>';
  const primera = contextoDeMarca(html, '900111222-3', 1);
  const segunda = contextoDeMarca(html, '900111222-3', 2);
  assert.ok(primera.antes.includes('contribuyente'), 'la 1.ª debe verse como la del contribuyente');
  assert.ok(segunda.antes.includes('vinculado'), 'la 2.ª debe verse como la del vinculado');
  assert.ok(segunda.despues.includes('figura'), 'debe traer también el texto de la derecha');
  assert.ok(primera.antes.length <= 60 && primera.despues.length <= 60, 'el contexto va acotado');
});

test('contextoDeMarca cruza la frontera del párrafo sin pegar palabras', () => {
  const html = '<p>ACME</p><p>COLOMBIA declara</p>';
  const c = contextoDeMarca(html, 'COLOMBIA', 1);
  assert.ok(!c.antes.endsWith('ACME') || c.antes.endsWith('ACME '), 'debe separar los párrafos');
  assert.match(c.antes, /ACME\s$/);
});

test('contextoDeMarca devuelve null si la aparición no existe', () => {
  assert.strictEqual(contextoDeMarca('<p>ACME</p>', 'ACME', 2), null);
  assert.strictEqual(contextoDeMarca('<p>ACME</p>', 'NO ESTÁ', 1), null);
});

test('las marcas propuestas llegan al revisor con su contexto', async () => {
  const html =
    '<p>El contribuyente con NIT 900111222-3 celebró operaciones</p>' +
    '<p>con el vinculado cuyo NIT 900111222-3 figura en el anexo</p>';
  const r = await proponerMarcas(html, {
    pedir: async () => JSON.stringify({
      marcas: [
        { fragmento: '900111222-3', campo: 'nit', ocurrencia: 1 },
        { fragmento: '900111222-3', campo: 'vinc_id', ocurrencia: 2 },
      ],
    }),
  });
  assert.ok(r.marcas[0].contexto.antes.includes('contribuyente'));
  assert.ok(r.marcas[1].contexto.antes.includes('vinculado'),
    'el contexto debe corresponder a la aparición que se va a marcar, no a la primera');
});

test('el contexto de una marca traducida corresponde a su aparición global', async () => {
  /* El fragmento aparece en el trozo 1 y en el trozo 2. La marca del trozo 2
     llega con ocurrencia local 1 y su contexto debe ser el del trozo 2. */
  const html =
    '<p>Ingresos del contribuyente 1.234.567 en el año</p>' +
    '<p>' + 'y'.repeat(70) + '</p>' +
    '<p>Ingresos del vinculado 1.234.567 en el año</p>';
  let i = 0;
  const r = await proponerMarcas(html, {
    maxCaracteres: 70,
    pedir: async () => {
      i++;
      return JSON.stringify(i === 1 || i === 3
        ? { marcas: [{ fragmento: '1.234.567', campo: 'eeff.t_s', ocurrencia: 1 }] }
        : { marcas: [] });
    },
  });
  assert.deepStrictEqual(r.marcas.map((m) => m.ocurrencia), [1, 2]);
  assert.ok(r.marcas[0].contexto.antes.includes('contribuyente'));
  assert.ok(r.marcas[1].contexto.antes.includes('vinculado'));
});

/* --- Avance y concurrencia del marcado --- */

test('avisa del avance en cada trozo terminado', async () => {
  const avances = [];
  const html = '<p>' + 'a'.repeat(80) + '</p><p>' + 'b'.repeat(80) + '</p><p>' + 'c'.repeat(80) + '</p>';
  const r = await proponerMarcas(html, {
    maxCaracteres: 60,
    pedir: async () => JSON.stringify({ marcas: [] }),
    avisar: (p) => avances.push({ ...p }),
  });
  assert.strictEqual(avances.length, r.trozosEnviados, 'un aviso por trozo');
  assert.ok(avances.every((a) => a.total === r.trozosEnviados), 'el total debe ser estable');
  /* Con concurrencia los avisos pueden intercalarse, pero la cuenta de
     terminados tiene que crecer de uno en uno hasta el total. */
  assert.deepStrictEqual(
    avances.map((a) => a.terminados),
    Array.from({ length: avances.length }, (_, i) => i + 1)
  );
  assert.strictEqual(avances[avances.length - 1].terminados, r.trozosEnviados);
});

test('el orden de las marcas no depende de cuál respondió primero', async () => {
  /* El primer trozo tarda más que el segundo: si el orden dependiera de la
     respuesta, las marcas saldrían invertidas y las ocurrencias con ellas. */
  const html = '<p>PRIMERO ' + 'x'.repeat(70) + '</p><p>SEGUNDO ' + 'y'.repeat(70) + '</p>';
  let llamada = 0;
  const r = await proponerMarcas(html, {
    maxCaracteres: 60,
    concurrencia: 4,
    pedir: async (prompt) => {
      const mio = ++llamada;
      await new Promise((res) => setTimeout(res, mio === 1 ? 30 : 1));
      const frag = prompt.includes('PRIMERO') ? 'PRIMERO' : (prompt.includes('SEGUNDO') ? 'SEGUNDO' : null);
      return JSON.stringify({ marcas: frag ? [{ fragmento: frag, campo: 'ent', ocurrencia: 1 }] : [] });
    },
  });
  const frags = r.marcas.map((m) => m.fragmento);
  assert.deepStrictEqual(frags, ['PRIMERO', 'SEGUNDO'], 'salieron en el orden de respuesta');
});

test('la concurrencia no pierde trozos ni marcas', async () => {
  const html = Array.from({ length: 12 }, (_, i) => '<p>ACME ' + i + ' ' + 'z'.repeat(60) + '</p>').join('');
  const r = await proponerMarcas(html, {
    maxCaracteres: 70,
    concurrencia: 4,
    pedir: async () => JSON.stringify({ marcas: [] }),
  });
  assert.strictEqual(r.trozosEnviados, trocear(html, 70).length, 'faltaron trozos por enviar');
  assert.strictEqual(r.trozosFallidos, 0);
});

test('un trozo que falla se cuenta y no impide los demás, con concurrencia', async () => {
  const html = Array.from({ length: 6 }, (_, i) => '<p>ACME S.A.S ' + i + ' ' + 'w'.repeat(60) + '</p>').join('');
  let llamada = 0;
  const r = await proponerMarcas(html, {
    maxCaracteres: 70,
    concurrencia: 3,
    pedir: async () => {
      if (++llamada === 2) throw new Error('429 del proxy');
      return JSON.stringify({ marcas: [] });
    },
  });
  assert.strictEqual(r.trozosFallidos, 1);
  assert.ok(r.trozosEnviados > 1, 'los demás trozos deben haberse enviado igual');
});

/* --- Extensión a todas las apariciones del mismo texto --- */

test('una marca se extiende a las apariciones que el modelo no miró', async () => {
  /* El modelo ve un trozo a la vez: de un texto que se repite marca lo que ve y
     deja el resto. Sin extender, esas apariciones se radican con el dato del
     contribuyente anterior. */
  const html = '<p>ACME S.A.S uno</p><p>ACME S.A.S dos</p><p>ACME S.A.S tres</p>';
  const r = await proponerMarcas(html, {
    /* Sólo propone la primera, como si el resto hubiera caído en otro trozo. */
    pedir: async () => JSON.stringify({
      marcas: [{ fragmento: 'ACME S.A.S', campo: 'ent', ocurrencia: 1 }],
    }),
  });
  const ocurrencias = r.marcas.filter((m) => m.fragmento === 'ACME S.A.S')
    .map((m) => m.ocurrencia).sort((a, b) => a - b);
  assert.deepStrictEqual(ocurrencias, [1, 2, 3], 'faltaron apariciones por marcar');
  assert.strictEqual(r.extendidas, 2);

  const ap = aplicarMarcas(html, r.marcas);
  assert.strictEqual(ap.aplicadas, 3);
  assert.ok(!ap.html.includes('ACME S.A.S uno</p>'), 'la primera quedó sin marcar');
});

test('lo extendido se distingue de lo que propuso el modelo', async () => {
  const html = '<p>ACME uno</p><p>ACME dos</p>';
  const r = await proponerMarcas(html, {
    pedir: async () => JSON.stringify({
      marcas: [{ fragmento: 'ACME', campo: 'ent', ocurrencia: 1 }],
    }),
  });
  const propuesta = r.marcas.find((m) => m.ocurrencia === 1);
  const extendida = r.marcas.find((m) => m.ocurrencia === 2);
  assert.ok(!propuesta.extendida, 'la del modelo no debe marcarse como extendida');
  assert.strictEqual(extendida.extendida, true, 'la completada debe distinguirse');
});

test('no se extiende un texto al que el modelo dio dos campos distintos', async () => {
  /* Sin saber cuál de los dos vale, elegir a ciegas pondría el dato equivocado en
     las apariciones que nadie revisó. Se deja y se reporta. */
  const html = '<p>800123456 uno</p><p>800123456 dos</p><p>800123456 tres</p>';
  let n = 0;
  const r = await proponerMarcas(html, {
    maxCaracteres: 30,
    pedir: async () => JSON.stringify({
      marcas: [{ fragmento: '800123456', campo: ++n === 1 ? 'nit' : 'vinc_id', ocurrencia: 1 }],
    }),
  });
  assert.ok(r.fragmentosAmbiguos.includes('800123456'), 'no se reportó la ambigüedad');
  assert.strictEqual(r.extendidas, 0, 'no debió extender un fragmento ambiguo');
});

/* --- Zonas del documento --- */

const conZonas = (...parrafos) => parrafos.map((p) => '<p>' + p + '</p>').join('');

test('los campos del contribuyente no se marcan dentro del ANEXO B', async () => {
  /* En el informe del 2026-08-10 la ficha de COLOPL, INC. salió con las cifras de END GAME:
     ventas netas 5.271.105.507, activos 2.179.479.687, efectivo 12.417.756. El ANEXO B es
     de las comparables, y ningún dato del contribuyente puede aterrizar ahí. */
  const html = conZonas(
    'En 2025 la compañía tuvo ingresos por 5.271.105.507 con su vinculada.',
    'ANEXO B. Descripciones de comparables y Estados Financieros',
    'COLOPL, INC. Ventas netas 5.271.105.507',
  );
  const r = await proponerMarcas(html, {
    pedir: async () => JSON.stringify({
      marcas: [{ fragmento: '5.271.105.507', campo: 'monto_operacion', ocurrencia: 1 }],
    }),
  });
  const ocurrencias = r.marcas.map((m) => m.ocurrencia);
  assert.deepStrictEqual(ocurrencias, [1], 'la del ANEXO B no debía marcarse');
  assert.ok(r.bloqueadasPorZona > 0, 'y el bloqueo tiene que reportarse');
});

test('la tabla de contenido no abre la zona del anexo', async () => {
  /* El índice del informe lista «ANEXO B. Descripciones de comparables y Estados
     Financieros55», con el número de página pegado. Si eso abriera la zona, el documento
     entero quedaría marcado como anexo y no se sustituiría ni un dato. */
  const html = conZonas(
    'ANEXO B. Descripciones de comparables y Estados Financieros55',
    'El estudio de ACME S.A.S para el año gravable 2025.',
  );
  const r = await proponerMarcas(html, {
    pedir: async () => JSON.stringify({
      marcas: [{ fragmento: 'ACME S.A.S', campo: 'ent', ocurrencia: 1 }],
    }),
  });
  assert.strictEqual(r.marcas.length, 1, 'el cuerpo sigue siendo marcable tras el índice');
});

test('la entrada del índice no abre zona cuando el número de página va en un <span> aparte', async () => {
  /* Forma REAL de `pdfReferenceExtractor`: el título va en un `<strong>` y el número de
     página en otro, dentro de un `<span>`. El test de arriba pega el número al título en
     el mismo nodo de texto («…Financieros55»), forma que el extractor no produce, y por
     eso pasaba mientras el documento real fallaba.

     Contando por corridas —tramos de texto entre dos etiquetas cualesquiera— el `83` cae
     en otra corrida y `RX_ENTRADA_INDICE` nunca lo ve: la zona `anexoE` se abría dentro
     del índice y, como los anexos no se cierran, se arrastraba sobre el RESUMEN EJECUTIVO.
     Medido en `Archivos Prueba/estudio pasado.pdf`: zona anexoE del offset 12725 al 31096,
     con las celdas de las Tablas 1 y 2 en el 25347-25873. Ahí es donde el informe se
     radicaba con el concepto, el vinculado, el país y el monto del año anterior. */
  const html =
    '<p><strong> ANEXO E. Legislación Colombiana en materia de Precios de Transferencia </strong>' +
    '<strong><span style="font-family:\'Times New Roman\'">83</span></strong></p>' +
    '<h1><strong> RESUMEN EJECUTIVO</strong></h1>' +
    '<p> El estudio de ACME S.A.S para el año gravable 2025.</p>';
  const r = await proponerMarcas(html, {
    pedir: async () => JSON.stringify({
      marcas: [{ fragmento: 'ACME S.A.S', campo: 'ent', ocurrencia: 1 }],
    }),
  });
  assert.strictEqual(r.marcas.length, 1, 'el RESUMEN EJECUTIVO tiene que seguir siendo marcable');
  assert.strictEqual(r.bloqueadasPorZona, 0, 'no debe haber bloqueo por zona');
});

test('el encabezado real de un anexo sí abre zona aunque el título esté en un <strong>', async () => {
  /* La otra mitad de la guarda: al mirar el bloque completo no se puede perder la
     detección del anexo de verdad, que es lo que impide que las cifras del contribuyente
     aterricen en la ficha de una comparable. */
  const html =
    '<p> La compañía tuvo ingresos por 5.271.105.507 con su vinculada.</p>' +
    '<h1><strong> ANEXO B. Descripciones de comparables y Estados Financieros</strong></h1>' +
    '<p> COLOPL, INC. Ventas netas 5.271.105.507</p>';
  const r = await proponerMarcas(html, {
    pedir: async () => JSON.stringify({
      marcas: [{ fragmento: '5.271.105.507', campo: 'monto_operacion', ocurrencia: 1 }],
    }),
  });
  assert.deepStrictEqual(r.marcas.map((m) => m.ocurrencia), [1], 'la del ANEXO B no debía marcarse');
  assert.ok(r.bloqueadasPorZona > 0, 'y el bloqueo tiene que reportarse');
});

test('la sección de tendencias de la economía no se marca', async () => {
  /* Sus ocho tablas las regenera actualizarTablasMacroOoxml y su prosa viene de
     ia.economia_*. Marcar ahí es lo que dejó «En 2023 el crecimiento fue 3,2 %. Para 2025
     se mantuvo en 3,2 %», con la serie histórica falseada. */
  const html = conZonas(
    'III. TENDENCIAS DE LA ECONOMÍA',
    'En 2024 el crecimiento mundial fue del 3,2 %.',
    'IV. ANÁLISIS ECONÓMICO',
    'La operación del año 2024 fue de venta de servicios.',
  );
  const r = await proponerMarcas(html, {
    pedir: async () => JSON.stringify({
      marcas: [{ fragmento: '2024', campo: 'anio', ocurrencia: 1 }],
    }),
  });
  assert.deepStrictEqual(r.marcas.map((m) => m.ocurrencia), [2],
    'la de la serie histórica no, la del análisis sí');
});

test('los párrafos de cita no se marcan', async () => {
  /* «4 Fondo Monetario Internacional (2024). World Economic Outlook…» es una referencia
     bibliográfica: su año es la fecha de la publicación, no el año gravable. */
  const html = conZonas(
    'La operación del año gravable 2024.',
    '4 Fondo Monetario Internacional (2024). World Economic Outlook: April 2024 Edition.',
  );
  const r = await proponerMarcas(html, {
    pedir: async () => JSON.stringify({
      marcas: [{ fragmento: '2024', campo: 'anio', ocurrencia: 1 }],
    }),
  });
  assert.deepStrictEqual(r.marcas.map((m) => m.ocurrencia), [1],
    'solo la del cuerpo; las tres de la cita quedan fuera');
});

/* --- Guardas de extensión --- */

test('un fragmento no se extiende dentro de una palabra más larga', async () => {
  /* De aquí salió «CUMPLEn con el propósito fundamental»: el fragmento «cumple» cayó
     dentro de «cumplen». */
  const html = conZonas('La compañía cumple con la norma.', 'Las operaciones cumplen la norma.');
  const r = await proponerMarcas(html, {
    pedir: async () => JSON.stringify({
      marcas: [{ fragmento: 'cumple', campo: 'rango.cumple', ocurrencia: 1 }],
    }),
  });
  assert.deepStrictEqual(r.marcas.map((m) => m.ocurrencia), [1],
    'la aparición dentro de «cumplen» no es la palabra «cumple»');
});

test('una palabra suelta en minúsculas no se extiende', async () => {
  /* No identifica un dato: es lenguaje. Extenderla reescribe la prosa del informe. */
  const html = conZonas('La compañía cumple.', 'El vinculado cumple.', 'El grupo cumple.');
  const r = await proponerMarcas(html, {
    pedir: async () => JSON.stringify({
      marcas: [{ fragmento: 'cumple', campo: 'rango.cumple', ocurrencia: 1 }],
    }),
  });
  assert.strictEqual(r.extendidas, 0, 'no debió extenderse a las otras dos');
  assert.ok(r.bloqueadasPorGuarda > 0, 'y el bloqueo tiene que reportarse');
});

test('un año solo se marca donde el contexto lo respalda', async () => {
  /* «Último estado financiero entre junio de 2024 y mayo de 2025» es una ventana de la
     búsqueda de comparables, no el año gravable: sustituirla ahí deja «entre junio de 2025
     y mayo de 2025», que no es ninguna ventana. */
  const html = conZonas(
    'Estudio para el año gravable 2024.',
    'Último estado financiero entre junio de 2024 y mayo de 2025.',
  );
  const r = await proponerMarcas(html, {
    pedir: async () => JSON.stringify({
      marcas: [{ fragmento: '2024', campo: 'anio', ocurrencia: 1 }],
    }),
  });
  assert.deepStrictEqual(r.marcas.map((m) => m.ocurrencia), [1],
    'la ventana de búsqueda no lleva el año gravable');
});

test('el año sí se extiende donde la frase lo sostiene', async () => {
  /* La otra cara: el año es el campo más repetido del informe. Si no se extiende, el
     documento se radica con el año del cliente anterior en media docena de sitios. */
  const html = conZonas(
    'Estudio para el año gravable 2024.',
    'Operaciones al 31 de diciembre de 2024.',
    'PERÍODO FISCAL AL 31 DE DICIEMBRE DE 2024',
  );
  const r = await proponerMarcas(html, {
    pedir: async () => JSON.stringify({
      marcas: [{ fragmento: '2024', campo: 'anio', ocurrencia: 1 }],
    }),
  });
  assert.deepStrictEqual(r.marcas.map((m) => m.ocurrencia).sort((a, b) => a - b), [1, 2, 3]);
});

test('la razón social se sigue extendiendo, que es para lo que existe la extensión', async () => {
  /* Medido con el informe real: sin extender, la razón social sobrevivía 31 veces sin
     marcar. Las guardas no pueden llevarse por delante el caso que justifica todo esto. */
  const html = conZonas('ACME INC uno', 'ACME INC dos', 'ACME INC tres');
  const r = await proponerMarcas(html, {
    pedir: async () => JSON.stringify({
      marcas: [{ fragmento: 'ACME INC', campo: 'vinc', ocurrencia: 1 }],
    }),
  });
  assert.strictEqual(r.extendidas, 2);
});

test('extender no duplica lo que el modelo ya marcó', async () => {
  const html = '<p>ACME uno</p><p>ACME dos</p>';
  const r = await proponerMarcas(html, {
    pedir: async () => JSON.stringify({
      marcas: [
        { fragmento: 'ACME', campo: 'ent', ocurrencia: 1 },
        { fragmento: 'ACME', campo: 'ent', ocurrencia: 2 },
      ],
    }),
  });
  assert.strictEqual(r.marcas.length, 2, 'se duplicaron marcas: ' + JSON.stringify(r.marcas));
  assert.strictEqual(r.extendidas, 0);
});
