import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import {
  EEFF_PROMPT, EEFF_COMPARABLE_PROMPT, EEFF_COMPARABLES_LOTE_PROMPT,
  promptEeffContribuyente, bloqueDeTexto, valorDeRubro, rotuloDeRubro,
  CAMPO_POR_RUBRO, RUBROS_DE_COTEJO, extraerTextoEstructuradoPdf,
  verifyAccountingEqualities,
} from './eeffParser.js';
import { CLAVES_RUBROS_EXAMINADA } from './memoriaCalculoRangoOptimo.js';

const CAMPOS_NUEVOS_ANEXO_B = [
  'propiedad_planta_equipo',
  'efectivo_y_equivalentes',
  'gastos_investigacion_desarrollo',
  'gastos_publicidad',
];

test('el prompt de una sola comparable pide los campos nuevos del Anexo B', () => {
  CAMPOS_NUEVOS_ANEXO_B.forEach((campo) => {
    assert.ok(EEFF_COMPARABLE_PROMPT.includes(campo), `falta "${campo}" en EEFF_COMPARABLE_PROMPT`);
  });
});

test('el prompt de lote de comparables pide los campos nuevos del Anexo B', () => {
  CAMPOS_NUEVOS_ANEXO_B.forEach((campo) => {
    assert.ok(EEFF_COMPARABLES_LOTE_PROMPT.includes(campo), `falta "${campo}" en EEFF_COMPARABLES_LOTE_PROMPT`);
  });
});

test('los campos opcionales de gasto piden explícitamente null si no se desglosan', () => {
  assert.match(EEFF_COMPARABLE_PROMPT, /gastos_investigacion_desarrollo[\s\S]{0,200}null/i);
  assert.match(EEFF_COMPARABLE_PROMPT, /gastos_publicidad[\s\S]{0,200}null|null[\s\S]{0,200}gastos_publicidad/i);
});

test('ambos prompts exigen null (nunca 0) como convención general para cualquier rubro ausente', () => {
  // Regla general explícita: cualquier rubro no encontrado en el documento -> null, nunca 0.
  assert.match(EEFF_COMPARABLE_PROMPT, /nunca\s+0/i);
  assert.match(EEFF_COMPARABLES_LOTE_PROMPT, /nunca\s+en\s+0|nunca\s+0/i);

  // El "ponlo en 0" que antes exceptuaba solo a los dos campos opcionales ya no debe existir.
  assert.doesNotMatch(EEFF_COMPARABLES_LOTE_PROMPT, /ponlo en 0/i);

  // Las plantillas JSON de ejemplo ya no deben usar 0 como placeholder para rubros numéricos
  // (deben usar null, igual que los dos campos que ya eran opcionales).
  assert.doesNotMatch(EEFF_COMPARABLE_PROMPT, /"ingresos_operacionales":\s*0/);
  assert.doesNotMatch(EEFF_COMPARABLES_LOTE_PROMPT, /"ingresos_operacionales":\s*0/);
});

test('el prompt de lote pide pagina_inicio y pagina_fin por empresa, sobre el PDF completo', () => {
  assert.ok(EEFF_COMPARABLES_LOTE_PROMPT.includes('pagina_inicio'), 'falta "pagina_inicio"');
  assert.ok(EEFF_COMPARABLES_LOTE_PROMPT.includes('pagina_fin'), 'falta "pagina_fin"');
  assert.match(
    EEFF_COMPARABLES_LOTE_PROMPT,
    /pagina_inicio[\s\S]{0,400}null|null[\s\S]{0,400}pagina_inicio/i,
    'debe decir que se devuelve null si no se puede determinar con certeza',
  );
});

/* ══════ La IA no debe convertir la escala por su cuenta ══════ */

test('los tres prompts prohíben a la IA convertir la cifra aunque el documento declare la unidad', () => {
  [EEFF_PROMPT, EEFF_COMPARABLE_PROMPT, EEFF_COMPARABLES_LOTE_PROMPT].forEach((prompt) => {
    assert.match(prompt, /nunca.{0,20}multipliques.{0,20}ni.{0,20}conviert/i, 'falta prohibir la conversión');
    assert.match(prompt, /28,81[\s\S]{0,80}millones[\s\S]{0,40}28\.81[\s\S]{0,40}(no|NO)[\s\S]{0,20}28810000/,
      'falta el ejemplo concreto que fija qué significa "tal cual"');
  });
});

test('la regla de escala aplica sin excepción, aunque el documento rotule la columna en miles o millones', () => {
  [EEFF_PROMPT, EEFF_COMPARABLE_PROMPT, EEFF_COMPARABLES_LOTE_PROMPT].forEach((prompt) => {
    assert.match(prompt, /obligatoria.{0,10}y sin excepci[oó]n/i);
  });
});

/* ══════ El prompt del contribuyente ══════
   Su versión anterior tenía el vocabulario de un solo cliente y creía la primera fila que
   se pareciera a una utilidad operacional. Estas pruebas fijan lo que no puede volver a
   perderse: los rubros de cotejo, el rótulo de origen y la columna del año. */

test('el prompt pide los dos gastos del giro por separado, no un total', () => {
  /* De su suma sale la utilidad operacional, que ya no se lee de ninguna fila. Pedir un
     «total de gastos operativos» volvería a depender de que el documento lo imprima y de
     que la IA elija la fila correcta, que es justo lo que este cambio quita de en medio. */
  ['gastos_ventas', 'gastos_administracion'].forEach((campo) => assert.ok(
    EEFF_PROMPT.includes(campo), `falta "${campo}" en EEFF_PROMPT`));
});

test('el prompt NO pide ninguna utilidad operacional, y lo dice explícitamente', () => {
  /* La fila «RESULTADO DE ACTIVIDADES DE LA OPERACIÓN» de Montachem 2025 trae el total de
     los gastos, no la utilidad. Mientras se le pidiera al modelo «la utilidad operacional»
     había una fila que podía engañarlo; ahora se le manda ignorarla. */
  assert.ok(!EEFF_PROMPT.includes('"utilidad_operacional"'));
  assert.match(EEFF_PROMPT, /IGN[OÓ]RALA/);
  assert.match(EEFF_PROMPT, /el sistema la calcula/i);
});

test('el prompt exige las partidas de PARTES RELACIONADAS y descarta las comerciales', () => {
  /* El criterio del estudio: la operación es con la vinculada, así que el capital de
     trabajo que el ajuste neutraliza es el de esas partidas. Confundirlas metería los
     6.032.337.879 de deudores comerciales donde van 2.926.256.259. */
  assert.match(EEFF_PROMPT, /cuentas por cobrar A PARTES RELACIONADAS/i);
  assert.match(EEFF_PROMPT, /cuentas por pagar A PARTES RELACIONADAS/i);
  assert.match(EEFF_PROMPT, /NO uses aqu[ií] los deudores comerciales/i);
  assert.match(EEFF_PROMPT, /NO uses aqu[ií] proveedores de terceros/i);
});

test('el prompt del contribuyente pide los quince rubros del estudio', () => {
  Object.keys(CAMPO_POR_RUBRO).forEach((rubro) => assert.ok(
    EEFF_PROMPT.includes(rubro), `falta "${rubro}" en EEFF_PROMPT`));
});

test('el prompt exige el rótulo literal de cada cifra', () => {
  assert.match(EEFF_PROMPT, /"rotulo"/);
  assert.match(EEFF_PROMPT, /texto EXACTO de la fila/i);
});

test('el prompt pide los rubros que no encajaron en ningún campo', () => {
  assert.ok(EEFF_PROMPT.includes('rubros_no_asignados'));
  assert.match(EEFF_PROMPT, /partes relacionadas/i,
    'el caso típico: una cuenta con vinculadas que no es la comercial');
});

test('el prompt usa null y no 0 como placeholder, igual que los de comparables', () => {
  assert.doesNotMatch(EEFF_PROMPT, /"ingresos_operacionales":\s*\{"valor":\s*0/);
  assert.match(EEFF_PROMPT, /"ingresos_operacionales":\s*\{"valor":\s*null/);
});

test('el prompt ya no cita el plan de cuentas de un cliente concreto', () => {
  /* «Fiducuenta» y «Licencias» eran los rótulos de UNA empresa, y lo que no aparecía en
     esa lista salía en cero para todas las demás. */
  assert.doesNotMatch(EEFF_PROMPT, /fiducuenta/i);
});

test('el prompt admite los sinónimos que usan otros estados para lo que sí pide', () => {
  /* Sin nombres de un cliente concreto: la versión anterior citaba «Fiducuenta» y
     «Licencias», que eran los rótulos de UNA empresa. */
  [/ingresos de actividades ordinarias/i, /ventas netas/i,
    /costo de los servicios prestados/i, /existencias/i,
    /gastos de ventas y distribuci[oó]n/i, /gastos administrativos/i,
    /a vinculados/i, /compa[ñn][ií]as del grupo/i,
  ].forEach((patron) => assert.match(EEFF_PROMPT, patron));
});

test('con el año del estudio, el prompt manda leer esa columna y no la más reciente', () => {
  const p = promptEeffContribuyente(2024);
  assert.match(p, /ÚNICAMENTE la columna del año 2024/);
  assert.match(p, /No mezcles cifras de dos columnas/);
  assert.ok(p.startsWith(EEFF_PROMPT), 'se añade al prompt base, no lo reemplaza');
});

test('sin año no se inventa una instrucción de columna', () => {
  assert.strictEqual(promptEeffContribuyente(''), EEFF_PROMPT);
  assert.strictEqual(promptEeffContribuyente(null), EEFF_PROMPT);
});

/* ══════ El mapeo de la respuesta ══════ */

test('valorDeRubro acepta las tres formas en que responde el modelo', () => {
  /* La versión anterior exigía `typeof obj.valor === 'number'` y devolvía null para las
     otras dos, dejando la celda del libro en cero sin avisar. */
  assert.strictEqual(valorDeRubro({ valor: 337546138 }), 337546138);
  assert.strictEqual(valorDeRubro(337546138), 337546138);
  assert.strictEqual(valorDeRubro({ valor: '337.546.138' }), 337546138);
  assert.strictEqual(valorDeRubro('337.546.138,00'), 337546138);
});

test('valorDeRubro distingue el cero de la ausencia', () => {
  assert.strictEqual(valorDeRubro({ valor: 0 }), 0);
  assert.strictEqual(valorDeRubro({ valor: null }), null);
  assert.strictEqual(valorDeRubro(null), null);
  assert.strictEqual(valorDeRubro(undefined), null);
});

test('valorDeRubro lee el signo del documento, con menos o entre paréntesis', () => {
  assert.strictEqual(valorDeRubro({ valor: '(21.850.187.494)' }), -21850187494);
  assert.strictEqual(valorDeRubro({ valor: -21850187494 }), -21850187494);
});

test('rotuloDeRubro devuelve el texto de la fila, y cadena vacía si no vino', () => {
  assert.strictEqual(
    rotuloDeRubro({ valor: 1, rotulo: '  RESULTADO DE ACTIVIDADES DE LA OPERACIÓN ' }),
    'RESULTADO DE ACTIVIDADES DE LA OPERACIÓN');
  assert.strictEqual(rotuloDeRubro({ valor: 1 }), '');
  assert.strictEqual(rotuloDeRubro(1), '');
  assert.strictEqual(rotuloDeRubro(null), '');
});

test('el mapeo produce exactamente los campos del alcance, y todos son del libro', () => {
  /* Esta ingesta ya no llena las quince filas de la hoja Datos: toma tres partidas del
     balance, el subtotal del activo corriente, los ingresos y el costo, y calcula la
     utilidad operacional. Lo que sí tiene que cumplirse es que cada campo que produce sea
     un rubro que el libro conoce — si no, escribiría en un campo que nadie publica. */
  const producidos = [...Object.values(CAMPO_POR_RUBRO), 't_op'].sort();
  assert.deepStrictEqual(producidos,
    ['t_act_curr', 't_ap', 't_ar', 't_c', 't_inv', 't_op', 't_s'],
    'el alcance de la ingesta cambió sin que esta prueba lo diga');
  producidos.forEach((clave) => assert.ok(CLAVES_RUBROS_EXAMINADA.includes(clave),
    `${clave} no es un rubro de la hoja Datos`));
});

test('los rubros de cotejo no son campos del estudio', () => {
  /* Se leen para verificar, no para guardarse: si alguno se colara como `t_*`, el libro
     publicaría una fila que no existe en RUBROS_EXAMINADA. */
  RUBROS_DE_COTEJO.forEach((r) => assert.ok(
    !Object.keys(CAMPO_POR_RUBRO).includes(r) || r === 'utilidad_operacional',
    `${r} no debería ser a la vez campo del estudio y rubro de cotejo`));
});

/* ══════ El texto del documento ══════ */

test('el bloque de texto se omite cuando el PDF no tiene capa de texto', () => {
  assert.strictEqual(bloqueDeTexto(''), null);
  assert.strictEqual(bloqueDeTexto(null), null);
  assert.strictEqual(bloqueDeTexto('   '), null);
});

test('el bloque de texto dice que los dígitos del texto mandan sobre la imagen', () => {
  const b = bloqueDeTexto('TOTAL ACTIVO | 15.004.112.346');
  assert.match(b, /manda el texto/i);
  assert.match(b, /<texto_del_documento>/);
  assert.ok(b.includes('15.004.112.346'));
});

/* ══════ Lectura nativa del PDF: el orden de filas y columnas es el del documento ══════

   Es la razón de ser del extractor: el Vision OCR devolvía las filas
   desordenadas y los EEFF de las comparables salen de una macro de Word, así
   que el PDF trae capa de texto —y, en las fichas individuales, el árbol de
   estructura etiquetado— con el orden exacto. */

const DIR_COMPARABLES = 'frontend/Archivos Prueba/EEFF Comparables';
const PDF_LOTE = 'frontend/Archivos Prueba/EEFF Comparables 2025.pdf';

function archivoFalso(ruta) {
  return { name: ruta.split('/').pop(), arrayBuffer: async () => readFileSync(ruta) };
}

/* El orden en que la macro imprime los rubros, tal cual. */
const RUBROS_EN_ORDEN = [
  'Estado de resultados', 'Ventas netas', 'Costo de ventas', 'Utilidad bruta',
  'Gastos generales y administrativos (SG&A)', 'Depreciación', 'Gastos operativos',
  'Utilidad operativa', 'Balance general', 'Efectivo y equivalentes de efectivo',
  'Otras inversiones', 'Cuentas por cobrar', 'Inventarios', 'Propiedad, planta y equipo',
  'Total de activos', 'Activos operativos', 'Total de pasivos', 'Cuentas por pagar',
];

test('la ficha etiquetada de una comparable sale con las filas en el orden del documento', async () => {
  const texto = await extraerTextoEstructuradoPdf(archivoFalso(`${DIR_COMPARABLES}/1 QUBICGAMES S.A..pdf`));
  assert.ok(texto, 'el PDF trae capa de texto: no debería caer al OCR');

  /* Rótulo y cifra en la misma línea, y las líneas en el orden impreso. */
  const rotulos = texto.split('\n')
    .map((l) => l.split('|')[1]?.trim())
    .filter((r) => r && RUBROS_EN_ORDEN.includes(r));
  assert.deepStrictEqual(rotulos, RUBROS_EN_ORDEN);

  assert.match(texto, /Ventas netas \| 28,81/);
  assert.match(texto, /Cuentas por pagar \| 5,88/);
  assert.match(texto, /--- PÁGINA 1 ---/);
});

test('la etiqueta que Word parte en dos líneas de la misma celda no se separa de su cifra', async () => {
  const texto = await extraerTextoEstructuradoPdf(archivoFalso(`${DIR_COMPARABLES}/1 QUBICGAMES S.A..pdf`));
  /* El árbol de estructura devuelve la celda completa; el agrupado por
     coordenadas dejaba el 24,51 en una línea suelta entre "Gastos generales y
     administrativos" y "(SG&A)", que es justo lo que desordenaba la lectura. */
  assert.match(texto, /Gastos generales y administrativos \(SG&A\) \| 24,51/);
});

test('las 19 fichas de comparables se leen sin caer al OCR y con su rótulo pegado a la cifra', async () => {
  const fichas = readdirSync(DIR_COMPARABLES).filter((f) => f.toLowerCase().endsWith('.pdf'));
  assert.ok(fichas.length >= 19, `se esperaban las fichas de prueba, hay ${fichas.length}`);
  for (const ficha of fichas) {
    const texto = await extraerTextoEstructuradoPdf(archivoFalso(`${DIR_COMPARABLES}/${ficha}`));
    assert.ok(texto, `${ficha}: no se pudo leer la capa de texto`);
    assert.match(texto, /Ventas netas \| /, `${ficha}: la cifra de ventas no quedó en la fila del rótulo`);
    assert.match(texto, /Gastos generales y administrativos \(SG&A\) \| /, `${ficha}: la celda de dos líneas quedó partida`);
  }
});

test('el PDF de lote, que no viene etiquetado, se agrupa por coordenadas sin perder filas ni páginas', async () => {
  const texto = await extraerTextoEstructuradoPdf(archivoFalso(PDF_LOTE));
  assert.ok(texto, 'el PDF de lote trae capa de texto: no debería caer al OCR');

  /* El prompt del lote pide pagina_inicio y pagina_fin sobre el PDF completo:
     sin el marcador por página el modelo no tiene de dónde sacarlas. */
  const paginas = texto.match(/--- PÁGINA \d+ ---/g) || [];
  assert.deepStrictEqual(paginas, [1, 2, 3, 4, 5].map((n) => `--- PÁGINA ${n} ---`));

  /* Las razones sociales, en el orden del documento y sin pegarse al número de
     orden: "1AKATSUKI INC." no cruza con ninguna comparable. */
  const empresas = texto.split('\n').filter((l) => /^\d+ [A-Z]/.test(l));
  assert.deepStrictEqual(empresas.slice(0, 3), ['1 AKATSUKI INC.', '2 COLOPL, INC.', '3 EXTREME CO.,LTD.']);
  assert.strictEqual(empresas.length, 11);

  assert.match(texto, /Ventas netas \| 23\.652,00/);
});

test('sin capa de texto que leer devuelve null, para que la lectura caiga al Vision OCR', async () => {
  const noEsPdf = { name: 'escaneo.pdf', arrayBuffer: async () => Buffer.from('esto no es un PDF') };
  assert.strictEqual(await extraerTextoEstructuradoPdf(noEsPdf), null);
});

/* ══════ La verificación contable de una ficha de comparable ══════ */

const ecuacion = (r) => r.hallazgos.filter((h) => /Ecuaci[oó]n patrimonial/i.test(h));

/* Huaxin Resources, tal como la ficha de la macro la imprime: total de activos y total
   de pasivos, y NINGUNA fila de patrimonio, porque la macro no la produce. */
const FICHA_SIN_PATRIMONIO = {
  periodo: 2025,
  ingresos_operacionales: 1000, costo_ventas: 600, utilidad_bruta: 400,
  gastos_operacionales: 250, utilidad_operacional: 150,
  total_activos: 2619.3, total_pasivos: 422.17, patrimonio: null,
};

test('sin patrimonio impreso, la ecuación patrimonial no se comprueba en vez de fallar', () => {
  /* El defecto que esto cierra: las fichas de comparables no traen patrimonio, y con
     `pat = data.patrimonio || 0` la guarda se cumplía por los pasivos y la identidad
     fallaba SIEMPRE. En un estudio de 12 comparables salían 12 «Con Alertas» por una
     identidad que sin patrimonio no se puede comprobar, y el aviso real quedaba
     enterrado en el ruido. */
  const r = verifyAccountingEqualities(FICHA_SIN_PATRIMONIO, 2025);
  assert.deepStrictEqual(ecuacion(r), [], 'no hay identidad que comprobar sin patrimonio');
  assert.strictEqual(r.esValido, true);
});

test('un patrimonio en cero SÍ es un dato y la ecuación se comprueba', () => {
  /* La distinción que hace posible lo anterior: el prompt exige null para lo ausente y
     0 solo cuando la empresa reportó cero. Con cero explícito la identidad es
     comprobable, y aquí no cuadra. */
  const r = verifyAccountingEqualities({ ...FICHA_SIN_PATRIMONIO, patrimonio: 0 }, 2025);
  assert.strictEqual(ecuacion(r).length, 1);
  assert.strictEqual(r.esValido, false);
});

test('con patrimonio impreso, la ecuación se comprueba y avisa cuando no cuadra', () => {
  const cuadra = verifyAccountingEqualities(
    { ...FICHA_SIN_PATRIMONIO, total_pasivos: 422.17, patrimonio: 2197.13 }, 2025);
  assert.deepStrictEqual(ecuacion(cuadra), []);
  assert.strictEqual(cuadra.esValido, true);

  const noCuadra = verifyAccountingEqualities(
    { ...FICHA_SIN_PATRIMONIO, total_pasivos: 422.17, patrimonio: 1000 }, 2025);
  assert.strictEqual(ecuacion(noCuadra).length, 1);
  assert.match(ecuacion(noCuadra)[0], /2619\.3/);
  assert.strictEqual(noCuadra.esValido, false);
});

test('sin total de pasivos tampoco se comprueba, aunque haya patrimonio', () => {
  const r = verifyAccountingEqualities(
    { ...FICHA_SIN_PATRIMONIO, total_pasivos: null, patrimonio: 2197.13 }, 2025);
  assert.deepStrictEqual(ecuacion(r), []);
  assert.strictEqual(r.esValido, true);
});

test('las otras identidades siguen comprobándose', () => {
  /* Se fijan aquí porque no tenían ninguna prueba y el cambio de arriba toca la misma
     función: una utilidad bruta que no es ventas menos costo, y una operacional que no
     es bruta menos gastos, tienen que seguir avisando. */
  const brutaMal = verifyAccountingEqualities({ ...FICHA_SIN_PATRIMONIO, utilidad_bruta: 900 }, 2025);
  assert.ok(brutaMal.hallazgos.some((h) => /U\. Bruta/i.test(h)));
  assert.strictEqual(brutaMal.esValido, false);

  const opMal = verifyAccountingEqualities({ ...FICHA_SIN_PATRIMONIO, utilidad_operacional: 900 }, 2025);
  assert.ok(opMal.hallazgos.some((h) => /U\. Operacional/i.test(h)));
  assert.strictEqual(opMal.esValido, false);

  const otroAnio = verifyAccountingEqualities({ ...FICHA_SIN_PATRIMONIO, periodo: 2023 }, 2025);
  assert.ok(otroAnio.hallazgos.some((h) => /per[ií]odo le[ií]do/i.test(h)));
  assert.strictEqual(otroAnio.esValido, false);
});

test('una ficha limpia lo dice, para que el estado de la fila no quede en blanco', () => {
  const r = verifyAccountingEqualities(FICHA_SIN_PATRIMONIO, 2025);
  assert.strictEqual(r.hallazgos.length, 1);
  assert.match(r.hallazgos[0], /✅/);
});
