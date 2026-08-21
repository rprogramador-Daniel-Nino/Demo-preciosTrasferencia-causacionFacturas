import { test } from 'node:test';
import assert from 'node:assert';
import {
  filasRazonesRechazo, filasComparablesInforme, diagnosticarCobertura,
  filasRangoIntercuartil, filasCriteriosScreening,
} from './tablasInforme.js';
import { analizarRango } from './rangoIntercuartil.js';

/* Estudio de un cliente que NO es End Game. */
const otroCliente = {
  ent: 'ACME COLOMBIA S.A.S',
  nit: '800123456-7',
  anio: 2025,
};

/* ══════ Razones de rechazo ══════ */

const embudoReal = {
  evaluadas: 100,
  seleccionadas: 8,
  reserva: 12,
  porMotivo: {
    holding: 30, saldoNegativo: 5, perdidaOperativa: 15,
    sinDescripcion: 0, actividadDistinta: 25, rigorFuncional: 5,
  },
};

test('filasRazonesRechazo omite los criterios que no descartaron a nadie', () => {
  /* Un informe que declara «Pérdidas operativas: 0» cuando el criterio se puso en
     «incluir» confunde a quien lo revisa. */
  const { filas } = filasRazonesRechazo(embudoReal);
  assert.ok(!filas.some(f => f.clave === 'sinDescripcion'), 'la fila con cero no aparece');
  assert.ok(filas.some(f => f.clave === 'holding'));
});

test('filasRazonesRechazo asigna letras corridas sobre las filas que quedan', () => {
  /* Cuatro criterios con descartes más las aceptadas: cinco filas, letras A a E sin
     huecos. Ni la reserva ni los motivos que se funden en «Diferencias funcionales»
     tienen fila propia. */
  const { filas } = filasRazonesRechazo(embudoReal);
  assert.deepStrictEqual(filas.map(f => f.letra), ['A', 'B', 'C', 'D', 'E']);
  assert.deepStrictEqual(filas.map(f => f.clave), [
    'rigorFuncional', 'holding', 'perdidaOperativa', 'saldoNegativo', 'aceptadas',
  ]);
});

test('la actividad distinta no tiene fila propia: va en las diferencias funcionales', () => {
  /* El informe tiene que declarar la misma cifra que la hoja «Matriz de rechazo» del
     libro de soporte, que presenta los tres motivos de comparabilidad funcional juntos
     (`memoriaCalculoRangoOptimo.js:885`). Con filas separadas, el documento publicaba
     dos cifras donde el Excel publica una sola. */
  const { filas } = filasRazonesRechazo(embudoReal);
  assert.ok(!filas.some(f => f.clave === 'actividadDistinta'), 'no puede tener fila propia');
  const rigor = filas.find(f => f.clave === 'rigorFuncional');
  assert.strictEqual(rigor.etiqueta, 'Diferencias funcionales');
  assert.strictEqual(rigor.cuantas, 42, '5 por rigor + 25 por actividad + 12 de reserva');
});

test('la reserva se cuenta dentro de las diferencias funcionales', () => {
  /* Declarar en el informe que hubo compañías que superaron todos los criterios y aun
     así quedaron fuera invita a una pregunta que el cupo de muestra no puede responder.
     Van con las diferencias funcionales, que es lo que las apartó: el corte del cupo es
     por puntaje de comparabilidad. */
  const { filas } = filasRazonesRechazo(embudoReal);
  assert.ok(!filas.some(f => f.clave === 'reserva'), 'la reserva no puede tener fila propia');
  const rigor = filas.find(f => f.clave === 'rigorFuncional');
  assert.strictEqual(rigor.cuantas, 42, '5 por rigor + 25 por actividad distinta + 12 de reserva');
});

test('la fila de diferencias funcionales aparece aunque solo la sostenga la reserva', () => {
  /* Sin este caso la suma de la columna se rompe: la fila se omitiría por valer cero en
     `porMotivo` y las 12 de reserva desaparecerían del universo. */
  const soloReserva = { evaluadas: 20, seleccionadas: 8, reserva: 12, porMotivo: {} };
  const { filas, cuadra } = filasRazonesRechazo(soloReserva);
  const rigor = filas.find(f => f.clave === 'rigorFuncional');
  assert.ok(rigor, 'la fila tiene que aparecer');
  assert.strictEqual(rigor.cuantas, 12);
  assert.ok(cuadra, '12 + 8 = 20');
});

test('las retiradas por no traer EEFF se cuentan en las diferencias funcionales', () => {
  /* Al cargar los estados financieros, una comparable cuyo documento no trae cifras sale
     de la muestra: el componente baja `seleccionadas` y anota `sinEeff`. Si esta fila no
     las recogiera, la suma dejaría de dar el universo y el generador avisaría de un
     descuadre inexistente. */
  const conRetiradas = { ...embudoReal, seleccionadas: 6, sinEeff: 2 };
  const { filas, cuadra } = filasRazonesRechazo(conRetiradas);
  assert.ok(!filas.some(f => f.clave === 'sinEeff'), 'no puede tener fila propia en el informe');
  const rigor = filas.find(f => f.clave === 'rigorFuncional');
  assert.strictEqual(rigor.cuantas, 44, '5 por rigor + 25 por actividad + 12 de reserva + 2 sin EEFF');
  assert.ok(cuadra, 'la suma sigue dando el universo evaluado');
});

test('la fila de diferencias funcionales aparece aunque solo la sostengan las retiradas', () => {
  const soloSinEeff = { evaluadas: 10, seleccionadas: 9, reserva: 0, sinEeff: 1, porMotivo: {} };
  const { filas, cuadra } = filasRazonesRechazo(soloSinEeff);
  const rigor = filas.find(f => f.clave === 'rigorFuncional');
  assert.ok(rigor, 'la fila tiene que aparecer');
  assert.strictEqual(rigor.cuantas, 1);
  assert.ok(cuadra, '1 + 9 = 10');
});

test('la comparable que el analista retira a mano también va a las diferencias funcionales', () => {
  /* El borrado con la papelera del paso 4 solo quitaba la fila de la pantalla. El embudo seguía
     declarando las aceptadas de antes, así que el informe decía una cifra de comparables
     aceptadas y la tabla de márgenes listaba otra —una menos—, con el rango calculado sobre esa
     otra. Y el descuadre no se veía: los conteos del embudo no habían cambiado y seguían sumando
     el universo, así que `cuadra` daba true y nada avisaba antes de radicar.

     El destino es el mismo que ya les da el ANEXO C, que clasifica por el estado real de la
     muestra: una comparable que sale de ella y no tiene motivo de rechazo cae en diferencias
     funcionales. Con esto la Tabla 16 dice lo que el anexo sustenta. */
  const conRetiroManual = { ...embudoReal, seleccionadas: 7, retiradasManual: ['acme'] };
  const { filas, cuadra } = filasRazonesRechazo(conRetiroManual);
  assert.ok(!filas.some((f) => f.clave === 'retiradasManual'), 'no puede tener fila propia');
  const rigor = filas.find((f) => f.clave === 'rigorFuncional');
  assert.strictEqual(rigor.cuantas, 43, '5 por rigor + 25 por actividad + 12 de reserva + 1 a mano');
  const aceptadas = filas.find((f) => f.clave === 'aceptadas');
  assert.strictEqual(aceptadas.cuantas, 7, 'la tabla declara la muestra que de verdad quedó');
  assert.ok(cuadra, 'la suma sigue dando el universo evaluado');
});

test('retirar dos veces la misma comparable no la cuenta dos veces', () => {
  /* Por eso el embudo guarda la LISTA de retiradas y no un contador: un contador se incrementaría
     otra vez y la tabla declararía una baja que no existe. */
  const unaVez = filasRazonesRechazo({ ...embudoReal, seleccionadas: 7, retiradasManual: ['acme'] });
  const dosVeces = filasRazonesRechazo({ ...embudoReal, seleccionadas: 7, retiradasManual: ['acme'] });
  assert.deepStrictEqual(dosVeces.filas, unaVez.filas);
});

test('un embudo guardado antes de este cambio sigue cuadrando', () => {
  /* Los estudios ya guardados no traen `retiradasManual`. No puede convertirse en un NaN ni en
     una fila fantasma. */
  const viejo = { ...embudoReal };
  delete viejo.retiradasManual;
  const { filas, cuadra } = filasRazonesRechazo(viejo);
  const rigor = filas.find((f) => f.clave === 'rigorFuncional');
  assert.strictEqual(rigor.cuantas, 42, 'el conteo es el de siempre: 5 + 25 + 12 de reserva');
  assert.ok(cuadra);
});

test('un embudo sin `sinEeff` sigue cuadrando igual', () => {
  /* Los estudios guardados antes de este cambio no traen la clave. */
  const { cuadra } = filasRazonesRechazo(embudoReal);
  assert.ok(cuadra);
});

test('las filas del rango respetan el filtro de ámbito en las DOS columnas', () => {
  /* `rangoIntercuartil.test.js` ya comprueba que el motor publica `statsNoAjustado` con el
     ámbito aplicado. Esta prueba cierra el tramo siguiente: que las filas del informe lo
     consuman en vez de reordenar la serie por su cuenta.

     Hace falta porque el defecto ya viajó una vez. El cálculo a mano vivía en
     `docxRelleno.js`, se corrigió en el motor, y al extraer estas filas a este módulo el
     cálculo antiguo vino con ellas: al integrar las dos ramas la corrección se quedaba sin
     consumidor y git no marcaba nada, porque cada cambio estaba en un archivo distinto. */
  const estudio = {
    pli: 'MO', useadj: true, cmode: 'nac', prime: 7.37, ent: 'ACME',
    t_s: 1000, t_c: 600, t_op: 200, t_ar: 100, t_inv: 50, t_ap: 80, t_ppe: 300,
    comparables: [
      { name: 'Nacional A', amb: 'Nac', s: 500, c: 300, op: 120, ar: 50, inv: 20, ap: 40, ppe: 100 },
      { name: 'Nacional B', amb: 'Nac', s: 800, c: 500, op: 180, ar: 70, inv: 30, ap: 50, ppe: 120 },
      { name: 'Nacional C', amb: 'Nac', s: 600, c: 350, op: 150, ar: 60, inv: 25, ap: 45, ppe: 110 },
      /* Margen deliberadamente extremo: si entra, mueve el mínimo y el máximo. */
      { name: 'Internacional X', amb: 'Int', s: 900, c: 100, op: 100, ar: 10, inv: 5, ap: 5, ppe: 10 },
    ],
  };

  const { filas } = filasRangoIntercuartil(estudio);
  const de = (etiqueta) => filas.find((f) => f.etiqueta === etiqueta);
  const extremos = [de('Mínimo'), de('Máximo')];

  /* El margen de la internacional excluida, que es el que no debe asomar. */
  const rEsperado = analizarRango(estudio);
  extremos.forEach((f) => {
    assert.strictEqual(f.noAjustado, rEsperado.statsNoAjustado[f.etiqueta === 'Mínimo' ? 'min' : 'max'],
      `el ${f.etiqueta.toLowerCase()} no ajustado sale del motor, no de un cálculo propio`);
  });

  ['Percentil 25', 'Mediana', 'Percentil 75'].forEach((etiqueta) => {
    const clave = etiqueta === 'Mediana' ? 'med' : (etiqueta === 'Percentil 25' ? 'p25' : 'p75');
    assert.strictEqual(de(etiqueta).noAjustado, rEsperado.statsNoAjustado[clave],
      `${etiqueta} no ajustado sale del motor`);
    assert.strictEqual(de(etiqueta).ajustado, rEsperado.stats[clave],
      `${etiqueta} ajustado sale del motor`);
  });
});

test('filasRazonesRechazo cuadra la suma con el universo evaluado', () => {
  /* 30+5+15+25 rechazos + (5 de rigor + 12 de reserva) + 8 aceptadas = 100 */
  const { cuadra, suma, total } = filasRazonesRechazo(embudoReal);
  assert.strictEqual(suma, 100);
  assert.strictEqual(total, 100);
  assert.ok(cuadra);
});

test('filasRazonesRechazo avisa cuando los conteos no suman el universo', () => {
  const desfasado = { ...embudoReal, evaluadas: 500 };
  const { cuadra } = filasRazonesRechazo(desfasado);
  assert.ok(!cuadra, 'un estudio cambiado tras la selección deja la tabla inconsistente');
});

test('filasRazonesRechazo sin selección ejecutada no inventa nada', () => {
  assert.ok(filasRazonesRechazo(null).sinDatos);
  assert.ok(filasRazonesRechazo({}).sinDatos);
  assert.deepStrictEqual(filasRazonesRechazo(null).filas, []);
});

/* ══════ Motivo «controlada»: falta de independencia (Art. 260-1 E.T.) ══════ */

test('filasRazonesRechazo cuenta las vinculadas aparte de las holding', () => {
  const embudo = {
    evaluadas: 100, seleccionadas: 10, reserva: 0,
    porMotivo: {
      holding: 30, controlada: 20, saldoNegativo: 5, perdidaOperativa: 15,
      sinDescripcion: 0, actividadDistinta: 15, rigorFuncional: 5,
    },
  };
  const { filas, cuadra, suma, total } = filasRazonesRechazo(embudo);
  const controlada = filas.find(f => f.clave === 'controlada');
  assert.ok(controlada, 'la fila de vinculadas aparece');
  assert.strictEqual(controlada.cuantas, 20);
  assert.ok(filas.find(f => f.clave === 'holding'), 'y no desplaza a la de holding');
  assert.strictEqual(cuadra, true, `los conteos deben sumar el universo (${suma} vs ${total})`);
  /* Seis filas, no siete: la actividad distinta va dentro de «Diferencias funcionales». */
  assert.deepStrictEqual(filas.map(f => f.letra), ['A', 'B', 'C', 'D', 'E', 'F']);
});

test('un estudio guardado antes del cambio sigue cuadrando sin la clave controlada', () => {
  /* Compatibilidad hacia atrás: los estudios en Firestore no traen `controlada`.
     La fila cuenta 0, se omite, y la tabla sigue sumando el universo. */
  const embudo = {
    evaluadas: 100, seleccionadas: 10, reserva: 0,
    porMotivo: {
      holding: 50, saldoNegativo: 5, perdidaOperativa: 15,
      sinDescripcion: 0, actividadDistinta: 15, rigorFuncional: 5,
    },
  };
  const { filas, cuadra } = filasRazonesRechazo(embudo);
  assert.ok(!filas.some(f => f.clave === 'controlada'), 'sin dato no se inventa la fila');
  assert.strictEqual(cuadra, true);
});

/* ══════ Muestra de comparables ══════ */

const conComparables = {
  ...otroCliente,
  pli: 'MO',
  t_s: 4000, t_c: 3300, t_op: 300,
  comparables: [
    { name: 'DISTRIBUIDORA ANDINA S.A.', amb: 'Nac', s: 1000, c: 800, op: 100 },
    { name: 'GULF FUEL TRADING CO', amb: 'Int', s: 2000, c: 1600, op: 260 },
    { name: 'SIN CIFRAS S.A.', amb: 'Int', s: '', c: '', op: '' },
  ],
};

test('filasComparablesInforme descarta las filas sin razón social', () => {
  /* La tabla del motor arranca con filas en blanco que el usuario va llenando: una fila
     numerada y sin nombre en la muestra final no dice nada. */
  const filas = filasComparablesInforme({
    ...conComparables,
    comparables: [...conComparables.comparables, { name: '   ', s: 500, c: 400, op: 50 }],
  });
  assert.strictEqual(filas.length, 3);
  assert.ok(filas.every((f) => f.nombre), 'se coló una fila sin nombre');
});

/* ══════ Diagnóstico de cobertura ══════ */

test('el diagnóstico avisa cuando no se ejecutó la selección del motor', () => {
  /* Sin embudo, la tabla de razones de rechazo se queda con las cifras que trajera la
     plantilla. Preferible que se vea que falta ejecutar el motor a que salgan cifras
     ajenas: el aviso de cobertura es el que se encarga de decirlo. */
  const d = diagnosticarCobertura('<p>Un informe cualquiera.</p>', otroCliente);
  assert.strictEqual(d.razonesRechazoCubiertas, false);
  assert.strictEqual(d.razonesRechazoDescuadradas, false, 'sin datos no se puede descuadrar');
});

test('el diagnóstico avisa cuando la tabla de razones de rechazo quedó descuadrada', () => {
  const d = diagnosticarCobertura('<p>x</p>', {
    ...otroCliente, embudoSeleccion: { ...embudoReal, evaluadas: 500 },
  });
  assert.strictEqual(d.razonesRechazoCubiertas, true);
  assert.strictEqual(d.razonesRechazoDescuadradas, true);
});

test('el diagnóstico avisa de la muestra sin cargar y de las comparables sin cifras', () => {
  const sinMuestra = diagnosticarCobertura('<p>x</p>', otroCliente);
  assert.strictEqual(sinMuestra.comparablesCubiertas, false);

  const con = diagnosticarCobertura('<p>x</p>', conComparables);
  assert.strictEqual(con.comparablesCubiertas, true);
  assert.strictEqual(con.comparablesSinCifras, 1, 'la comparable sin estados financieros');
});

test('el diagnóstico reporta las series macro sin datos para el año del estudio', () => {
  const d = diagnosticarCobertura('<p>x</p>', { anio: 2031 });
  assert.ok(d.seriesFaltantes.length >= 6, 'debió reportar las series sin datos para 2031');
  assert.strictEqual(d.year, 2031);
});

/* El apartado sectorial se reconoce por TEXTO y ya no por el ancla `_Toc208930979`
   del .docx de End Game: ese identificador no existe en la plantilla de ningún otro
   cliente, así que el diagnóstico daba «no cubierto» para todos y el aviso era ruido. */

test('reconoce el apartado sectorial en la plantilla de cualquier cliente', () => {
  const casos = [
    '<ol><li><strong>Análisis del Sector de la industria del software</strong></li></ol>',
    '<h2>ANALISIS DEL SECTOR ECONOMICO DE LA COMPAÑIA</h2>',
    '<p><strong>C. Análisis del sector de la actividad agroindustrial</strong></p>',
    '<p>Descripción del sector de cultivo de cereales en Colombia.</p>',
  ];
  casos.forEach((html) => {
    assert.strictEqual(
      diagnosticarCobertura(html, otroCliente).sectorialCubierto, true,
      'no reconoció el apartado sectorial en: ' + html
    );
  });
});

test('una plantilla que no habla del sector se reporta como no cubierta', () => {
  const sinSectorial = '<p>Una plantilla que solo trae la información general y el FAR.</p>';
  assert.strictEqual(
    diagnosticarCobertura(sinSectorial, otroCliente).sectorialCubierto, false,
    'debió reportar que no hay apartado sectorial que reemplazar'
  );
});

test('el apartado sectorial se reconoce aunque el título venga partido en varias etiquetas', () => {
  /* Word parte una misma frase en varios runs por rsid o por un cambio de formato:
     buscar la cadena en el HTML crudo no la encontraría. */
  const partido = '<strong>Análisis</strong> <em>del</em> <strong>Sector</strong> económico';
  assert.strictEqual(diagnosticarCobertura(partido, otroCliente).sectorialCubierto, true);
});

/* ══════════════ Criterios de búsqueda (Tablas 13 a 15) ══════════════ */

test('los criterios de búsqueda salen uno por fila, sin fila de conector entre ellos', () => {
  /* El conector lógico con el que Capital IQ combina un criterio con el anterior (Y/O) no
     se muestra como fila propia — solo importa dentro del valor de un mismo criterio (ver
     el test de traducción más abajo). */
  const filas = filasCriteriosScreening({
    criteriosScreening: [
      { conector: null, etiqueta: 'Código SIC primario', valor: 'Entre 7371 y 7375' },
      { conector: 'Y', etiqueta: 'Nivel de propiedad', valor: 'Menos del 50%' },
      { conector: 'O', etiqueta: 'Palabra clave', valor: 'Contiene juegos' },
    ],
  });
  assert.deepStrictEqual(filas, [
    ['Código SIC primario', 'Entre 7371 y 7375'],
    ['Nivel de propiedad', 'Menos del 50%'],
    ['Palabra clave', 'Contiene juegos'],
  ]);
});

test('un solo criterio sale igual que varios: una fila, sin conector', () => {
  assert.deepStrictEqual(
    filasCriteriosScreening({ criteriosScreening: [{ conector: null, etiqueta: 'SIC', valor: '7371' }] }),
    [['SIC', '7371']]
  );
});

test('sin criterios ingeridos no se emite ninguna fila', () => {
  /* La tabla conserva entonces lo que traía la plantilla y el motor lo avisa. Blanquearla
     sería peor: quien revisa no sabría que el cribado de este año no dejó criterios. */
  assert.deepStrictEqual(filasCriteriosScreening({}), []);
  assert.deepStrictEqual(filasCriteriosScreening({ criteriosScreening: [] }), []);
});

test('los criterios crudos de Capital IQ salen traducidos al español', () => {
  /* La hoja «Screen Criteria» viene en inglés y hasta ahora entraba tal cual al informe
     que se radica ante la DIAN. Se traduce aquí, en el render, para que los estudios ya
     guardados salgan en español sin reimportar el Excel (`criteriosScreeningEs.js`). */
  const filas = filasCriteriosScreening({
    criteriosScreening: [
      { conector: null, etiqueta: 'Company Type', valor: 'Public Company OR Private Company' },
      { conector: 'O', etiqueta: 'SIC Codes', valor: '7371 Computer Programming Services OR 7372 Prepackaged Software' },
      { conector: 'Y', etiqueta: 'Total Revenue [FY 2025] ($USDmm, Historical rate)', valor: 'is greater than 0 (Unreported data set to 0)' },
    ],
  });
  assert.deepStrictEqual(filas, [
    ['Tipo de compañía', 'Compañía pública O compañía privada'],
    ['Códigos SIC', '7371 Servicios de programación de computadores O 7372 Software preempaquetado'],
    ['Ingresos totales [año fiscal 2025] (millones de USD, tasa histórica)',
      'es mayor que 0 (los datos no reportados se toman como 0)'],
  ]);
});

test('la traducción que cacheó la IA gana sobre el diccionario', () => {
  assert.deepStrictEqual(
    filasCriteriosScreening({
      criteriosScreening: [{
        conector: null, etiqueta: 'Implied Enterprise Value', valor: 'is greater than 100',
        etiquetaEs: 'Valor implícito de la empresa', valorEs: 'es mayor que 100',
      }],
    }),
    [['Valor implícito de la empresa', 'es mayor que 100']]
  );
});

test('un criterio sin conector sale igual, sin fila de conector', () => {
  const filas = filasCriteriosScreening({
    criteriosScreening: [
      { conector: null, etiqueta: 'A', valor: '1' },
      { etiqueta: 'B', valor: '2' },
    ],
  });
  assert.deepStrictEqual(filas, [['A', '1'], ['B', '2']]);
});
