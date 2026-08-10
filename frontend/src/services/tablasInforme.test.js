import { test } from 'node:test';
import assert from 'node:assert';
import {
  filasRazonesRechazo, filasComparablesInforme, diagnosticarCobertura,
} from './tablasInforme.js';

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
  /* Cinco criterios con descartes (el de «sin descripción» quedó en cero y se omite)
     más las aceptadas: seis filas, letras A a F sin huecos. La reserva ya no es una
     fila propia. */
  const { filas } = filasRazonesRechazo(embudoReal);
  assert.deepStrictEqual(filas.map(f => f.letra), ['A', 'B', 'C', 'D', 'E', 'F']);
  assert.deepStrictEqual(filas.map(f => f.clave), [
    'rigorFuncional', 'actividadDistinta', 'holding', 'perdidaOperativa', 'saldoNegativo',
    'aceptadas',
  ]);
});

test('la reserva se cuenta dentro de las diferencias funcionales', () => {
  /* Declarar en el informe que hubo compañías que superaron todos los criterios y aun
     así quedaron fuera invita a una pregunta que el cupo de muestra no puede responder.
     Van con las diferencias funcionales, que es lo que las apartó: el corte del cupo es
     por puntaje de comparabilidad. */
  const { filas } = filasRazonesRechazo(embudoReal);
  assert.ok(!filas.some(f => f.clave === 'reserva'), 'la reserva no puede tener fila propia');
  const rigor = filas.find(f => f.clave === 'rigorFuncional');
  assert.strictEqual(rigor.cuantas, 17, '5 por rigor + 12 de reserva');
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
  assert.deepStrictEqual(filas.map(f => f.letra), ['A', 'B', 'C', 'D', 'E', 'F', 'G']);
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
