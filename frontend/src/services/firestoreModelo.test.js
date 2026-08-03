import { test } from 'node:test';
import assert from 'node:assert';
import { nameKey } from './comparablesEngine.js';
import {
  normalizarNit, anioValido, separarEstudio, docEstudio, docCliente,
  normalizarComparableHistorica, fusionarComparableHistorica, docEeff, idEeff,
  estudiosPorMigrar, aNumero, CAMPOS_SOLO_LOCALES, TOPE_APARICIONES,
  comparablesConEeffReutilizable, aplicarEeffGuardadoEnFila,
  aniosDelCatalogo, filtrarCatalogo, catalogoAComparablesPrevias,
  pesoAproximado, camposMasPesados, verificarTamano, TOPE_DOCUMENTO,
} from './firestoreModelo.js';

const USUARIO = { uid: 'uid-antonio', nombre: 'Antonio Barreto', correo: 'antonio@crconsultorescolombia.com' };
const AHORA = 'CENTINELA_SERVER_TIMESTAMP';

/* ══════ identificadores ══════ */

test('normalizarNit unifica las tres formas de escribir el mismo NIT', () => {
  /* Sin esto el catálogo de clientes se llena de duplicados que no se pueden cruzar:
     el mismo contribuyente aparece una vez por cada forma de teclearlo. */
  assert.strictEqual(normalizarNit('900.123.456-7'), '900123456');
  assert.strictEqual(normalizarNit('900123456-7'), '900123456');
  assert.strictEqual(normalizarNit('900123456'), '900123456');
  assert.strictEqual(normalizarNit('  900 123 456 - 7 '), '900123456');
});

test('normalizarNit devuelve cadena vacía cuando no hay nada utilizable', () => {
  assert.strictEqual(normalizarNit(''), '');
  assert.strictEqual(normalizarNit(null), '');
  assert.strictEqual(normalizarNit('N/A'), '');
});

test('aNumero distingue el cero de la ausencia de dato', () => {
  /* `Number(null)` y `Number('')` valen 0, y 0 es un valor legítimo para estas cifras.
     Confundirlos escribía un margen del 0 % donde el informe no traía margen: una
     cifra falsa dentro de un estudio fiscal, no un dato faltante. */
  assert.strictEqual(aNumero(null), null);
  assert.strictEqual(aNumero(undefined), null);
  assert.strictEqual(aNumero(''), null);
  assert.strictEqual(aNumero('   '), null);
  assert.strictEqual(aNumero('no es número'), null);
  assert.strictEqual(aNumero(0), 0, 'un cero explícito sí es un dato');
  assert.strictEqual(aNumero('0'), 0);
  assert.strictEqual(aNumero('1000'), 1000);
  assert.strictEqual(aNumero(-0.05), -0.05);
});

test('normalizarComparableHistorica no convierte un margen ausente en 0 %', () => {
  assert.strictEqual(normalizarComparableHistorica({ name: 'X', margen: null }).margen, null);
  assert.strictEqual(normalizarComparableHistorica({ name: 'X' }).margen, null);
  assert.strictEqual(normalizarComparableHistorica({ name: 'X', margen: 0 }).margen, 0,
    'pero un margen de cero declarado en el informe se respeta');
});

test('anioValido acepta años gravables plausibles y rechaza el resto', () => {
  assert.strictEqual(anioValido('2024'), 2024);
  assert.strictEqual(anioValido(2024), 2024);
  assert.strictEqual(anioValido('1998'), null);
  assert.strictEqual(anioValido('no es un año'), null);
  assert.strictEqual(anioValido(''), null);
});

test('idEeff identifica una empresa por año gravable', () => {
  assert.strictEqual(idEeff('acmecorp', 2024), 'acmecorp_2024');
});

/* ══════ separación nube / navegador ══════ */

test('separarEstudio deja fuera de la nube los campos pesados', () => {
  /* Los tres son grandes y no se comparten: el universo son miles de filas con
     descripción de negocio, el veredicto un dictamen por candidata, y eeffImages las
     páginas del PDF de estados financieros en base64 —3,4 MB en un caso real, más del
     triple del techo de 1 MiB por documento. */
  const study = {
    ent: 'Acme', comparables: [],
    universo: [{ id: 1 }, { id: 2 }],
    iaMatch: { porId: { A: {} } },
    eeffImages: ['data:image/png;base64,AAAA'],
  };
  const { nube, local } = separarEstudio(study);
  assert.deepStrictEqual(Object.keys(nube).sort(), ['comparables', 'ent']);
  assert.deepStrictEqual(Object.keys(local).sort(), ['eeffImages', 'iaMatch', 'universo']);
  assert.deepStrictEqual(CAMPOS_SOLO_LOCALES, ['universo', 'iaMatch', 'eeffImages']);
});

test('separarEstudio no inventa campos locales que el estudio no traía', () => {
  const { nube, local } = separarEstudio({ ent: 'Acme' });
  assert.deepStrictEqual(nube, { ent: 'Acme' });
  assert.deepStrictEqual(local, {});
});

/* ══════ documento de estudio ══════ */

test('docEstudio firma la creación con el usuario de la sesión', () => {
  const doc = docEstudio({ study: { ent: 'Acme SAS', nit: '900123456-7', anio: 2024 }, usuario: USUARIO, marcaDeTiempo: AHORA });
  assert.strictEqual(doc.creadoPor, 'uid-antonio');
  assert.strictEqual(doc.creadoEn, AHORA);
  assert.strictEqual(doc.actualizadoPor, 'uid-antonio');
  assert.strictEqual(doc.creadoPorNombre, 'Antonio Barreto');
  assert.strictEqual(doc.anio, 2024);
  assert.strictEqual(doc.nit, '900123456-7', 'el NIT se guarda como lo escribió el usuario');
  assert.strictEqual(doc.clienteNit, '900123456', 'y normalizado como vínculo con el cliente');
});

test('docEstudio conserva el rastro de creación de quien creó el estudio', () => {
  /* Las reglas lo exigen inmutable, y el estudio pudo crearlo otra persona del equipo:
     sobrescribirlo con el usuario actual haría fallar la escritura entera. */
  const previo = { creadoPor: 'uid-juan', creadoEn: 'FECHA_ORIGINAL', creadoPorNombre: 'Juan Méndez' };
  const doc = docEstudio({ study: { ent: 'Acme', anio: 2024 }, usuario: USUARIO, previo, marcaDeTiempo: AHORA });
  assert.strictEqual(doc.creadoPor, 'uid-juan');
  assert.strictEqual(doc.creadoEn, 'FECHA_ORIGINAL');
  assert.strictEqual(doc.creadoPorNombre, 'Juan Méndez');
  assert.strictEqual(doc.actualizadoPor, 'uid-antonio', 'pero quien modifica es quien está en sesión');
  assert.strictEqual(doc.actualizadoPorNombre, 'Antonio Barreto');
});

test('docEstudio omite el nombre cuando el proveedor no lo entregó', () => {
  /* Las reglas comparan el nombre con el del token: un valor inventado hace fallar
     la escritura completa, así que es mejor no escribir el campo. */
  const doc = docEstudio({ study: { ent: 'Acme', anio: 2024 }, usuario: { uid: 'u1', nombre: '', correo: 'x@y.com' }, marcaDeTiempo: AHORA });
  assert.ok(!('creadoPorNombre' in doc));
  assert.ok(!('actualizadoPorNombre' in doc));
});

test('docEstudio no manda a la nube el universo ni el veredicto de la IA', () => {
  const doc = docEstudio({
    study: { ent: 'Acme', anio: 2024, universo: [{ id: 1 }], iaMatch: { porId: {} }, comparables: [{ name: 'X' }] },
    usuario: USUARIO, marcaDeTiempo: AHORA,
  });
  assert.ok(!('universo' in doc.datos));
  assert.ok(!('iaMatch' in doc.datos));
  assert.strictEqual(doc.datos.comparables.length, 1, 'lo demás del estudio sí viaja');
});

test('docEstudio sin año usable cae en el año en curso en lugar de escribir basura', () => {
  const doc = docEstudio({ study: { ent: 'Acme', anio: 'sin año' }, usuario: USUARIO, marcaDeTiempo: AHORA });
  assert.strictEqual(doc.anio, new Date().getFullYear());
});

/* ══════ tope de tamaño del documento ══════
   Un caso real fallo con 3,4 MB: las paginas del PDF de estados financieros se
   guardaban como PNG en base64 dentro del estudio. Firestore rechazaba la escritura
   entera y el mensaje solo decia cuanto pesaba, no que campo lo hacia pesar. */

test('eeffImages no viaja a la nube', () => {
  const study = { ent: 'Acme', eeffImages: ['data:image/png;base64,AAAA', 'data:image/png;base64,BBBB'] };
  const { nube, local } = separarEstudio(study);
  assert.ok(!('eeffImages' in nube), 'las páginas del ANEXO A van a IndexedDB, no a Firestore');
  assert.strictEqual(local.eeffImages.length, 2);
});

test('docEstudio deja fuera las imágenes del anexo', () => {
  const doc = docEstudio({
    study: { ent: 'Acme', anio: 2024, eeffImages: ['data:image/png;base64,' + 'A'.repeat(5000)] },
    usuario: USUARIO, marcaDeTiempo: AHORA,
  });
  assert.ok(!('eeffImages' in doc.datos));
});

test('pesoAproximado mide en bytes y no se rompe con lo no serializable', () => {
  assert.strictEqual(pesoAproximado({ a: 1 }), JSON.stringify({ a: 1 }).length);
  assert.ok(pesoAproximado('ñ') > 1, 'un carácter multibyte pesa más de un byte');
  const circular = {}; circular.yo = circular;
  assert.strictEqual(pesoAproximado(circular), 0, 'no puede tumbar el guardado');
});

test('camposMasPesados señala al culpable, de mayor a menor', () => {
  const datos = { chico: 'x', enorme: 'A'.repeat(5000), mediano: 'B'.repeat(100) };
  const ranking = camposMasPesados(datos, 2);
  assert.deepStrictEqual(ranking.map(c => c.campo), ['enorme', 'mediano']);
  assert.ok(ranking[0].bytes > 5000);
});

test('verificarTamano deja pasar un estudio normal', () => {
  const doc = docEstudio({ study: { ent: 'Acme', anio: 2024, comparables: [{ name: 'X' }] }, usuario: USUARIO, marcaDeTiempo: AHORA });
  assert.doesNotThrow(() => verificarTamano(doc));
});

test('verificarTamano falla antes de escribir y nombra el campo que sobra', () => {
  /* El aviso tiene que ser accionable: decir «pesa demasiado» sin decir qué campo deja
     al usuario sin nada que hacer. */
  const doc = docEstudio({
    study: { ent: 'Acme', anio: 2024, adjuntoGigante: 'A'.repeat(1_100_000) },
    usuario: USUARIO, marcaDeTiempo: AHORA,
  });
  assert.throws(() => verificarTamano(doc), (err) => {
    assert.strictEqual(err.name, 'ErrorEstudioDemasiadoGrande');
    assert.match(err.message, /adjuntoGigante/);
    assert.match(err.message, /KB/);
    assert.ok(err.bytes > TOPE_DOCUMENTO);
    return true;
  });
});

test('verificarTamano devuelve el peso cuando cabe, para poder vigilarlo', () => {
  const bytes = verificarTamano({ datos: { ent: 'Acme' } });
  assert.ok(bytes > 0 && bytes < TOPE_DOCUMENTO);
});

/* ══════ documento de cliente ══════ */

test('docCliente exige un NIT utilizable', () => {
  assert.strictEqual(docCliente({ study: { ent: 'Acme', nit: '' }, usuario: USUARIO, marcaDeTiempo: AHORA }), null);
  assert.strictEqual(docCliente({ study: { ent: 'Acme', nit: '123' }, usuario: USUARIO, marcaDeTiempo: AHORA }), null,
    'un NIT de tres dígitos no identifica a nadie');
});

test('docCliente no borra con un campo vacío lo que otro consultor ya diligenció', () => {
  const previo = { creadoPor: 'uid-juan', creadoEn: 'F', ciiu: '6201', representante: 'María Gómez' };
  const doc = docCliente({ study: { ent: 'Acme', nit: '900123456', ciiu: '', representante: '   ' }, usuario: USUARIO, previo, marcaDeTiempo: AHORA });
  assert.strictEqual(doc.ciiu, '6201');
  assert.strictEqual(doc.representante, 'María Gómez');
});

test('docCliente actualiza lo que sí trae contenido', () => {
  const previo = { creadoPor: 'uid-juan', creadoEn: 'F', ciiu: '6201' };
  const doc = docCliente({ study: { ent: 'Acme', nit: '900123456', ciiu: '6202', actividad_especifica: 'desarrollo de software' }, usuario: USUARIO, previo, marcaDeTiempo: AHORA });
  assert.strictEqual(doc.ciiu, '6202');
  assert.strictEqual(doc.actividadEspecifica, 'desarrollo de software');
});

/* ══════ catálogo de comparables históricas ══════ */

test('normalizarComparableHistorica descarta lo que no identifica a ninguna empresa', () => {
  assert.strictEqual(normalizarComparableHistorica({ name: '' }), null);
  assert.strictEqual(normalizarComparableHistorica({}), null);
  assert.strictEqual(normalizarComparableHistorica(null), null);
});

test('normalizarComparableHistorica acepta los nombres de campo de las dos fuentes', () => {
  /* El lector del informe devuelve `name`/`pais`; el motor de comparables usa
     `country`/`desc`. Las dos rutas alimentan el mismo catálogo. */
  const a = normalizarComparableHistorica({ name: 'Acme Corp', pais: 'Estados Unidos', actividad: 'servicios' });
  const b = normalizarComparableHistorica({ nombre: 'Acme Corp', country: 'Estados Unidos', desc: 'servicios' });
  assert.strictEqual(a.nombre, 'Acme Corp');
  assert.strictEqual(a.nameKey, b.nameKey);
  assert.strictEqual(b.pais, 'Estados Unidos');
  assert.strictEqual(b.actividad, 'servicios');
});

test('normalizarComparableHistorica ignora un margen imposible', () => {
  assert.strictEqual(normalizarComparableHistorica({ name: 'X', margen: 5000 }).margen, null);
  assert.strictEqual(normalizarComparableHistorica({ name: 'X', margen: 'muy alto' }).margen, null);
  assert.strictEqual(normalizarComparableHistorica({ name: 'X', margen: 0.0725 }).margen, 0.0725);
});

test('fusionarComparableHistorica acumula los años en que se usó la empresa', () => {
  const entrante = normalizarComparableHistorica({ name: 'Acme Corp' });
  const primera = fusionarComparableHistorica({
    existente: null, entrante, usuario: USUARIO, marcaDeTiempo: AHORA,
    aparicion: { estudioId: 'study_1', anio: 2023, archivo: 'informe2023.pdf' },
  });
  assert.deepStrictEqual(primera.anios, [2023]);

  const segunda = fusionarComparableHistorica({
    existente: primera, entrante, usuario: USUARIO, marcaDeTiempo: AHORA,
    aparicion: { estudioId: 'study_2', anio: 2024, archivo: 'informe2024.pdf' },
  });
  assert.deepStrictEqual(segunda.anios, [2024, 2023], 'del más reciente al más antiguo');
  assert.strictEqual(segunda.apariciones.length, 2);
});

test('fusionarComparableHistorica no repite la misma aparición al recargar el informe', () => {
  const entrante = normalizarComparableHistorica({ name: 'Acme Corp' });
  const aparicion = { estudioId: 'study_1', anio: 2023, archivo: 'informe2023.pdf' };
  const primera = fusionarComparableHistorica({ existente: null, entrante, aparicion, usuario: USUARIO, marcaDeTiempo: AHORA });
  const repetida = fusionarComparableHistorica({ existente: primera, entrante, aparicion, usuario: USUARIO, marcaDeTiempo: AHORA });
  assert.strictEqual(repetida.apariciones.length, 1, 'cargar dos veces el mismo archivo no duplica el rastro');
  assert.deepStrictEqual(repetida.anios, [2023]);
});

test('fusionarComparableHistorica conserva lo que ya se sabía de la empresa', () => {
  /* La lectura de un informe puede ser más pobre que la de otro: que este año no se
     haya podido leer la actividad no puede borrar la que se leyó el año pasado. */
  const existente = {
    nombre: 'Acme Corp', nameKey: 'acmecorp', pais: 'Estados Unidos',
    actividad: 'desarrollo de software por encargo', pli: 'Margen Operacional', margen: 0.08,
    anios: [2023], apariciones: [{ estudioId: 'study_1', anio: 2023, archivo: 'a.pdf' }],
    creadoPor: 'uid-juan', creadoEn: 'F',
  };
  const entrante = normalizarComparableHistorica({ name: 'Acme Corp', pais: '', actividad: '', pli: '', margen: null });
  const doc = fusionarComparableHistorica({ existente, entrante, usuario: USUARIO, marcaDeTiempo: AHORA, aparicion: null });
  assert.strictEqual(doc.pais, 'Estados Unidos');
  assert.strictEqual(doc.actividad, 'desarrollo de software por encargo');
  assert.strictEqual(doc.pli, 'Margen Operacional');
  assert.strictEqual(doc.margen, 0.08);
  assert.strictEqual(doc.creadoPor, 'uid-juan', 'y el rastro de creación es inmutable');
});

test('fusionarComparableHistorica completa el hueco cuando antes no se sabía', () => {
  const existente = { nombre: 'Acme', nameKey: 'acme', apariciones: [], creadoPor: 'uid-juan', creadoEn: 'F' };
  const entrante = normalizarComparableHistorica({ name: 'Acme', pais: 'Canadá', margen: 0.05 });
  const doc = fusionarComparableHistorica({ existente, entrante, usuario: USUARIO, marcaDeTiempo: AHORA, aparicion: null });
  assert.strictEqual(doc.pais, 'Canadá');
  assert.strictEqual(doc.margen, 0.05);
});

test('fusionarComparableHistorica respeta el tope de apariciones que exigen las reglas', () => {
  const entrante = normalizarComparableHistorica({ name: 'Acme' });
  const apariciones = Array.from({ length: TOPE_APARICIONES }, (_, i) => ({ estudioId: 's' + i, anio: 2024, archivo: 'a' + i + '.pdf' }));
  const existente = { nombre: 'Acme', nameKey: 'acme', apariciones, creadoPor: 'u', creadoEn: 'F' };
  const doc = fusionarComparableHistorica({
    existente, entrante, usuario: USUARIO, marcaDeTiempo: AHORA,
    aparicion: { estudioId: 'nueva', anio: 2024, archivo: 'nueva.pdf' },
  });
  assert.strictEqual(doc.apariciones.length, TOPE_APARICIONES, 'no crece más allá del tope');
  assert.strictEqual(doc.apariciones[doc.apariciones.length - 1].estudioId, 'nueva',
    'y la que se conserva es la nueva, no la más antigua');
});

/* ══════ estados financieros de comparables ══════ */

test('docEeff exige nombre y año', () => {
  assert.strictEqual(docEeff({ comparable: { name: '' }, anio: 2024, usuario: USUARIO, marcaDeTiempo: AHORA }), null);
  assert.strictEqual(docEeff({ comparable: { name: 'Acme' }, anio: 'sin año', usuario: USUARIO, marcaDeTiempo: AHORA }), null);
});

test('docEeff traduce los nombres de campo del gestor a los del documento', () => {
  const doc = docEeff({
    comparable: { name: 'Acme Corp', nameKey: 'acmecorp', s: 1000, c: 600, op: 150, ar: 200, inv: 50, ap: 80, eeffArchivo: 'eeff.pdf' },
    anio: 2024, usuario: USUARIO, marcaDeTiempo: AHORA,
  });
  assert.strictEqual(doc.ingresos, 1000);
  assert.strictEqual(doc.costos, 600);
  assert.strictEqual(doc.utilidadOperacional, 150);
  assert.strictEqual(doc.cartera, 200);
  assert.strictEqual(doc.inventarios, 50);
  assert.strictEqual(doc.proveedores, 80);
  assert.strictEqual(doc.fuente, 'eeff.pdf');
  assert.strictEqual(doc.anio, 2024);
});

test('docEeff no borra una cifra guardada con un valor que no es número', () => {
  const previo = { creadoPor: 'uid-juan', creadoEn: 'F', ingresos: 1000, costos: 600 };
  const doc = docEeff({
    comparable: { name: 'Acme', nameKey: 'acme', s: null, c: undefined, op: 150 },
    anio: 2024, usuario: USUARIO, previo, marcaDeTiempo: AHORA,
  });
  assert.strictEqual(doc.ingresos, 1000, 'se conserva lo que ya estaba');
  assert.strictEqual(doc.costos, 600);
  assert.strictEqual(doc.utilidadOperacional, 150, 'y se escribe lo nuevo que sí es número');
});

test('docEeff acota los hallazgos contables al tope de las reglas', () => {
  const doc = docEeff({
    comparable: { name: 'Acme', nameKey: 'acme', s: 1, eeffHallazgos: Array.from({ length: 80 }, (_, i) => 'h' + i) },
    anio: 2024, usuario: USUARIO, marcaDeTiempo: AHORA,
  });
  assert.strictEqual(doc.hallazgos.length, 50);
});

/* ══════ reutilización de estados financieros ══════ */

/* La clave se calcula con la función real: `nameKey` quita los sufijos societarios y
   pasa a mayúsculas, así que «Acme Corp» se guarda bajo «ACME». Inventar la clave en
   el test lo haría pasar o fallar por una razón que no es la que se quiere probar. */
const CLAVE_ACME = nameKey('Acme Corp');

const EEFF_GUARDADO = {
  [CLAVE_ACME]: { nameKey: CLAVE_ACME, nombre: 'Acme Corp', anio: 2024, ingresos: 5000, costos: 3000, utilidadOperacional: 700, fuente: 'eeff-acme.pdf', hallazgos: ['cuadra el estado de resultados'] },
};

test('comparablesConEeffReutilizable no propone pisar una cifra ya cargada', () => {
  /* La cifra que está en la fila pudo corregirse a mano o venir de un documento más
     reciente: el catálogo completa huecos, no reemplaza trabajo hecho. */
  const comparables = [{ name: 'Acme Corp', nameKey: CLAVE_ACME, s: 9999 }];
  assert.deepStrictEqual(comparablesConEeffReutilizable(comparables, EEFF_GUARDADO), []);
});

test('comparablesConEeffReutilizable propone las filas vacías que sí tienen cifras guardadas', () => {
  const comparables = [
    { name: 'Otra Compañía', nameKey: nameKey('Otra Compañía'), s: '' },
    { name: 'Acme Corp', nameKey: CLAVE_ACME, s: '' },
  ];
  const propuestas = comparablesConEeffReutilizable(comparables, EEFF_GUARDADO);
  assert.strictEqual(propuestas.length, 1);
  assert.strictEqual(propuestas[0].indice, 1, 'y dice en qué fila va');
  assert.strictEqual(propuestas[0].clave, CLAVE_ACME);
});

test('comparablesConEeffReutilizable ignora un registro guardado sin ingresos', () => {
  const guardados = { [CLAVE_ACME]: { nameKey: CLAVE_ACME, anio: 2024, costos: 3000 } };
  const comparables = [{ name: 'Acme Corp', nameKey: CLAVE_ACME, s: '' }];
  assert.deepStrictEqual(comparablesConEeffReutilizable(comparables, guardados), [],
    'sin ingresos no hay nada aprovechable para el rango');
});

test('comparablesConEeffReutilizable deriva la clave cuando la fila no la trae', () => {
  const comparables = [{ name: 'Acme Corp', s: '' }];
  const propuestas = comparablesConEeffReutilizable(comparables, EEFF_GUARDADO);
  assert.strictEqual(propuestas.length, 1, 'una comparable agregada a mano no tiene nameKey');
});

test('aplicarEeffGuardadoEnFila vuelca las cifras y deja el rastro de su origen', () => {
  const filas = [{ name: 'Acme Corp', nameKey: CLAVE_ACME, s: '', c: '', op: '' }];
  const nuevas = aplicarEeffGuardadoEnFila(filas, 0, EEFF_GUARDADO[CLAVE_ACME]);
  assert.strictEqual(nuevas[0].s, 5000);
  assert.strictEqual(nuevas[0].c, 3000);
  assert.strictEqual(nuevas[0].op, 700);
  assert.strictEqual(nuevas[0].eeffArchivo, 'eeff-acme.pdf');
  assert.deepStrictEqual(nuevas[0].eeffReutilizado, { anio: 2024, fuente: 'eeff-acme.pdf', nombre: 'Acme Corp' });
  assert.strictEqual(nuevas[0].eeffPorConfirmar, true,
    'la cifra no se leyó en este estudio: quien firma el informe debe darla por buena');
  assert.strictEqual(filas[0].s, '', 'no muta el arreglo original');
});

test('aplicarEeffGuardadoEnFila conserva las cifras que el registro no trae', () => {
  const filas = [{ name: 'Acme', nameKey: CLAVE_ACME, s: '', ar: 123 }];
  const nuevas = aplicarEeffGuardadoEnFila(filas, 0, EEFF_GUARDADO[CLAVE_ACME]);
  assert.strictEqual(nuevas[0].ar, 123, 'el registro no trae cartera y la de la fila se mantiene');
});

/* ══════ consulta del catálogo ══════ */

const CATALOGO = [
  { nombre: 'Acme Corp', pais: 'Estados Unidos', actividad: 'desarrollo de software', pli: 'Margen Operacional', anios: [2024, 2023] },
  { nombre: 'Beta SA', pais: 'México', actividad: 'manufactura por encargo', pli: 'Berry', anios: [2023] },
  { nombre: 'Gamma Ltd', pais: 'Canadá', actividad: 'servicios de tecnología', pli: '', anios: [2024] },
];

test('aniosDelCatalogo devuelve los años sin repetir y del más reciente al más antiguo', () => {
  assert.deepStrictEqual(aniosDelCatalogo(CATALOGO), [2024, 2023]);
  assert.deepStrictEqual(aniosDelCatalogo([]), []);
});

test('filtrarCatalogo busca sin acentos y sin distinguir mayúsculas', () => {
  /* Quien escribe «mexico» en el buscador tiene que encontrar «México». */
  assert.deepStrictEqual(filtrarCatalogo(CATALOGO, { texto: 'mexico' }).map(i => i.nombre), ['Beta SA']);
  assert.deepStrictEqual(filtrarCatalogo(CATALOGO, { texto: 'ACME' }).map(i => i.nombre), ['Acme Corp']);
});

test('filtrarCatalogo busca también en la actividad y en el indicador', () => {
  assert.deepStrictEqual(filtrarCatalogo(CATALOGO, { texto: 'encargo' }).map(i => i.nombre), ['Beta SA']);
  assert.deepStrictEqual(filtrarCatalogo(CATALOGO, { texto: 'berry' }).map(i => i.nombre), ['Beta SA']);
});

test('filtrarCatalogo por año deja solo las usadas ese año gravable', () => {
  assert.deepStrictEqual(filtrarCatalogo(CATALOGO, { anio: 2024 }).map(i => i.nombre), ['Acme Corp', 'Gamma Ltd']);
  assert.deepStrictEqual(filtrarCatalogo(CATALOGO, { anio: 2023 }).map(i => i.nombre), ['Acme Corp', 'Beta SA']);
});

test('filtrarCatalogo combina texto y año', () => {
  assert.deepStrictEqual(filtrarCatalogo(CATALOGO, { texto: 'software', anio: 2023 }).map(i => i.nombre), ['Acme Corp']);
  assert.deepStrictEqual(filtrarCatalogo(CATALOGO, { texto: 'software', anio: 2020 }), []);
});

test('filtrarCatalogo sin criterios devuelve todo', () => {
  assert.strictEqual(filtrarCatalogo(CATALOGO, {}).length, 3);
  assert.strictEqual(filtrarCatalogo(CATALOGO).length, 3);
});

test('catalogoAComparablesPrevias entrega la forma que espera el motor', () => {
  const previas = catalogoAComparablesPrevias(CATALOGO);
  assert.deepStrictEqual(previas[0], { name: 'Acme Corp', pais: 'Estados Unidos', actividad: 'desarrollo de software' });
  assert.strictEqual(catalogoAComparablesPrevias([{ pais: 'X' }]).length, 0, 'sin razón social no sirve para continuidad');
});

/* ══════ migración ══════ */

test('estudiosPorMigrar ignora las entradas del índice sin detalle guardado', () => {
  const indice = { study_1: { ent: 'A' }, study_2: { ent: 'B' }, study_3: { ent: 'C' } };
  const detalle = { study_1: { ent: 'A', anio: 2024 }, study_2: {}, study_3: undefined };
  const porMigrar = estudiosPorMigrar(indice, detalle);
  assert.deepStrictEqual(porMigrar.map(e => e.id), ['study_1'],
    'un índice puede quedar con entradas huérfanas y no hay nada que subir de ellas');
});
