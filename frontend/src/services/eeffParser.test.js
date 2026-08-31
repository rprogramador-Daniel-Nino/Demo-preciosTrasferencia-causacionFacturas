import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import {
  EEFF_PROMPT, EEFF_COMPARABLE_PROMPT, EEFF_COMPARABLES_LOTE_PROMPT,
  promptEeffContribuyente, bloqueDeTexto, valorDeRubro, rotuloDeRubro,
  CAMPO_POR_RUBRO, RUBROS_DE_COTEJO, extraerTextoEstructuradoPdf,
  verifyAccountingEqualities,
  CAMPOS_CON_FALLBACK_NOTAS, promptFaltantesEnNotas, buscarFaltantesEnNotas,
} from './eeffParser.js';
import { CLAVES_RUBROS_EXAMINADA } from './memoriaCalculoRangoOptimo.js';

const CAMPOS_NUEVOS_ANEXO_B = [
  'propiedad_planta_equipo',
  'efectivo_y_equivalentes',
  'otras_inversiones',
  'gastos_generales_administrativos',
  'depreciacion',
  'activos_operativos',
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

test('el prompt no pide "utilidad_operacional" como campo del estudio; la calculada manda', () => {
  /* La fila «RESULTADO DE ACTIVIDADES DE LA OPERACIÓN» de Montachem 2025 trae el total de
     los gastos, no la utilidad, así que no se le pide al modelo esa utilidad como campo
     primario del estudio: se calcula. La fila impresa SÍ se pide, pero bajo otro nombre
     (`utilidad_operacional_impresa`, ver test de más abajo) y solo como último recurso —
     `eeffVerificacion.js` la verifica contra el resto del estado antes de usarla. */
  assert.ok(!EEFF_PROMPT.includes('"utilidad_operacional"'));
  assert.match(EEFF_PROMPT, /NO usa esta fila como la utilidad operacional del estudio/i);
  assert.match(EEFF_PROMPT, /la calcula como ingresos/i);
});

test('el prompt exige las partidas COMERCIALES y descarta las de partes relacionadas', () => {
  /* Criterio del usuario (2026-08-31), que REVIERTE el anterior: entra la fila comercial —o
     de clientes y proveedores— y no la de la vinculada. El detalle de por qué está junto a
     `CAMPO_POR_RUBRO` en eeffParser.js. */
  assert.match(EEFF_PROMPT, /cuentas por cobrar COMERCIALES/i);
  assert.match(EEFF_PROMPT, /cuentas por pagar COMERCIALES/i);
  assert.match(EEFF_PROMPT, /cuentas por cobrar a CLIENTES/i);
  /* Y lo que NO debe entrar, nombrado explícitamente para que el modelo no lo agregue. */
  assert.match(EEFF_PROMPT, /«Otras cuentas por cobrar».*NO las sumes ni las uses/is);
  assert.match(EEFF_PROMPT, /«Otras cuentas por pagar».*NO las sumes ni las uses/is);
});

test('el prompt NO admite sumar filas para las cuentas comerciales', () => {
  /* La única excepción a «no sumar filas» que queda es la del costo de ventas desglosado
     (decisión del usuario, 2026-08-31). Antes había otras dos, para sumar la fila corriente
     con la no corriente de partes relacionadas; se retiraron con el cambio de criterio. */
  ['cuentas_por_cobrar_comerciales', 'cuentas_por_pagar_comerciales'].forEach((campo) => {
    const inicio = EEFF_PROMPT.indexOf(`· ${campo}:`);
    assert.ok(inicio !== -1, `no se encontró la definición de ${campo} en EEFF_PROMPT`);
    const siguiente = EEFF_PROMPT.indexOf('\n·', inicio + 1);
    const bloque = EEFF_PROMPT.slice(inicio, siguiente === -1 ? inicio + 900 : siguiente);
    assert.doesNotMatch(bloque, /EXCEPCI[OÓ]N/i,
      `${campo} no debe traer excepción de suma: solo costo_ventas la tiene`);
    assert.match(bloque, /sin sumar nada/i);
  });
  /* La del costo sí sigue en pie, y ahora nombra la depreciación. */
  const costo = EEFF_PROMPT.slice(EEFF_PROMPT.indexOf('· costo_ventas:'));
  assert.match(costo, /EXCEPCI[OÓ]N/i);
  assert.match(costo, /Incluye la depreciaci[oó]n en esa suma SOLO si/i);
  assert.match(EEFF_PROMPT, /NO sumes varias filas para armar un rubro/i,
    'la regla central para el resto de rubros debe seguir intacta');
});

test('el prompt pide la depreciación y dónde la presenta el documento', () => {
  /* Se lee como rubro propio para poder VERLA, y con `dentro_del_costo` para que el
     documento —no el sistema— decida si suma al costo. Es lo que impide contarla dos veces:
     si va abajo de la utilidad bruta ya la recoge `gastos_operacionales`. */
  assert.match(EEFF_PROMPT, /· depreciacion:/);
  assert.match(EEFF_PROMPT, /"dentro_del_costo"/);
  assert.match(EEFF_PROMPT, /no la sumes t[uú] a ning[uú]n rubro/i);
  assert.ok(RUBROS_DE_COTEJO.includes('depreciacion'),
    'depreciacion debe ser rubro de cotejo: no hay campo t_* al que vaya');
});

test('el prompt del contribuyente pide los quince rubros del estudio', () => {
  Object.keys(CAMPO_POR_RUBRO).forEach((rubro) => assert.ok(
    EEFF_PROMPT.includes(rubro), `falta "${rubro}" en EEFF_PROMPT`));
});

/* ══════ Detalle completo de Activos (Tabla 10 / ANEXO A) ══════
   Las tres partidas de partes relacionadas alimentan el ajuste de capital de trabajo, pero
   no bastan para pintar la Tabla 10: distintos EEFF traen distintas filas de activo (ver
   Montachem, End Game y Lamberti en tablasContribuyente.test.js), así que en vez de una
   lista fija de campos con nombre se pide la sección ACTIVOS completa, transcrita fila por
   fila tal como el documento la imprime. */

test('el prompt pide el total de activos y el detalle completo de la sección ACTIVOS', () => {
  assert.ok(EEFF_PROMPT.includes('total_activos'), 'falta "total_activos" en EEFF_PROMPT');
  assert.ok(EEFF_PROMPT.includes('activos_detalle'), 'falta "activos_detalle" en EEFF_PROMPT');
  assert.match(EEFF_PROMPT, /es_subtotal/);
});

test('el detalle de activos no agrupa ni renombra filas, y descarta los títulos de sección', () => {
  assert.match(EEFF_PROMPT, /NO agrupes ni renombres/i);
  assert.match(EEFF_PROMPT, /no la incluyas/i);
});

test('total_activos entra al mapeo de campos del estudio, como el total de activos', () => {
  assert.strictEqual(CAMPO_POR_RUBRO.total_activos, 't_act_tot');
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
    /deudores comerciales/i, /acreedores comerciales/i, /proveedores/i,
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
     balance, el subtotal del activo corriente, PP&E, los ingresos y el costo, y calcula la
     utilidad operacional (con su fallback a la impresa, ver eeffVerificacion.js). Lo que sí
     tiene que cumplirse es que cada campo que produce sea un rubro que el libro conoce — si
     no, escribiría en un campo que nadie publica. */
  const producidos = [...Object.values(CAMPO_POR_RUBRO), 't_op'].sort();
  assert.deepStrictEqual(producidos,
    ['t_act_curr', 't_act_tot', 't_ap', 't_ar', 't_c', 't_inv', 't_op', 't_ppe', 't_s'],
    'el alcance de la ingesta cambió sin que esta prueba lo diga');
  producidos.forEach((clave) => assert.ok(CLAVES_RUBROS_EXAMINADA.includes(clave),
    `${clave} no es un rubro de la hoja Datos`));
});

test('propiedad_planta_equipo entra al mapeo de campos del estudio, como t_ppe', () => {
  /* A diferencia de las tres partidas de partes relacionadas, PP&E no depende de con quién
     sea la operación: es una partida universal del balance, y por eso se lee y se mapea
     igual que `total_activos`. */
  assert.strictEqual(CAMPO_POR_RUBRO.propiedad_planta_equipo, 't_ppe');
});

test('los rubros de cotejo no son campos del estudio', () => {
  /* Se leen para verificar, no para guardarse: si alguno se colara como `t_*`, el libro
     publicaría una fila que no existe en RUBROS_EXAMINADA. */
  RUBROS_DE_COTEJO.forEach((r) => assert.ok(
    !Object.keys(CAMPO_POR_RUBRO).includes(r) || r === 'utilidad_operacional',
    `${r} no debería ser a la vez campo del estudio y rubro de cotejo`));
});

/* ══════ Utilidad operacional impresa: cotejo para el fallback de eeffVerificacion.js ══════ */

test('el prompt pide la utilidad operacional impresa, como rubro de cotejo y no de cálculo', () => {
  /* No sustituye el cálculo (ingresos − costo − gastos): es la cifra que `eeffVerificacion.js`
     usa como último recurso cuando ese cálculo no basta, y solo si cuadra con la identidad
     utilidad bruta − gastos. El prompt sigue diciendo que el sistema calcula la utilidad
     operacional; esto solo agrega de dónde sale el fallback. */
  assert.ok(EEFF_PROMPT.includes('utilidad_operacional_impresa'),
    'falta "utilidad_operacional_impresa" en EEFF_PROMPT');
  assert.ok(RUBROS_DE_COTEJO.includes('utilidad_operacional_impresa'));
  assert.ok(!Object.keys(CAMPO_POR_RUBRO).includes('utilidad_operacional_impresa'),
    'no debe escribirse directo en el estudio: eeffVerificacion.js decide si se usa');
});

/* ══════ Costo de ventas desglosado en varios renglones ══════ */

test('el prompt permite sumar renglones de costo, pero solo para costo_ventas', () => {
  /* Symtek no imprime un total de "Costo de Ventas": lo desglosa en "Costo de servicios
     prestados" + "Costo de venta de mercancía". La regla central sigue prohibiendo sumar
     filas para todo lo demás — esto es una excepción angosta, no un permiso general. */
  const defCostoVentas = EEFF_PROMPT.slice(EEFF_PROMPT.indexOf('· costo_ventas:'));
  const finDefCostoVentas = defCostoVentas.indexOf('\n· gastos_ventas');
  const bloqueCostoVentas = defCostoVentas.slice(0, finDefCostoVentas === -1 ? 400 : finDefCostoVentas);
  assert.match(bloqueCostoVentas, /EXCEPCI[OÓ]N/i,
    'la excepción debe estar en la propia definición de costo_ventas, no suelta en el prompt');
  assert.match(bloqueCostoVentas, /su[mn]a/i,
    'falta el permiso de sumar renglones cuando el documento desglosa el costo');
  assert.match(EEFF_PROMPT, /NO sumes varias filas para armar un rubro/i,
    'la regla central para el resto de rubros debe seguir intacta');
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

/* ══════ Pruebas de Integración (Mocking API) ══════ */

test('parseEEFFComparableOCR integra la extracción nativa con la llamada a la API de Gemini (modelo texto)', async () => {
  const axios = (await import('axios')).default;
  const originalPost = axios.post;

  let apiPayloadRecibido = null;

  // Mock de la llamada API
  axios.post = async (url, payload) => {
    apiPayloadRecibido = payload;
    return {
      data: {
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                nombre: "QUBICGAMES S.A.",
                identificador_fuente: "",
                periodo: "2025",
                moneda: "COP",
                unidad_origen: "unidades",
                ingresos_operacionales: 28.81,
                costo_ventas: 0.15,
                utilidad_bruta: 28.66,
                gastos_operacionales: 28.23,
                utilidad_operacional: 0.43,
                cuentas_por_cobrar: 5.94,
                inventarios: 0.06,
                cuentas_por_pagar: 5.88,
                total_activos: 16.58,
                total_pasivos: 8.39,
                patrimonio: 8.19,
                propiedad_planta_equipo: 0.42,
                efectivo_y_equivalentes: 3.05,
                gastos_investigacion_desarrollo: null,
                gastos_publicidad: null
              })
            }]
          }
        }]
      }
    };
  };

  try {
    const mockFile = {
      name: '1 QUBICGAMES S.A..pdf',
      arrayBuffer: async () => {
        return readFileSync('Cpanel/public_html/demo-precios-transferencia/Archivos Prueba/EEFF Comparables/1 QUBICGAMES S.A..pdf');
      }
    };

    const result = await (await import('./eeffParser.js')).parseEEFFComparableOCR(mockFile, 2025);

    assert.ok(result, 'Debe devolver un resultado');
    assert.strictEqual(result.data.nombre, 'QUBICGAMES S.A.');
    assert.strictEqual(result.data.ingresos_operacionales, 28.81);
    assert.strictEqual(result.verificacion.esValido, true, 'La verificación de cuadre contable debe ser exitosa');

    // Verificar que se haya llamado al modelo de TEXTO de Gemini
    assert.ok(apiPayloadRecibido, 'Debe haber enviado un payload a la API');
    assert.ok(apiPayloadRecibido.contents[0].parts[0].text.includes('QUBICGAMES S.A.'), 'El payload debe contener el texto del PDF');
    assert.ok(!apiPayloadRecibido.contents[0].parts[0].inline_data, 'No debe enviar datos inline/base64 ya que usó la extracción nativa');

  } finally {
    // Restaurar original
    axios.post = originalPost;
  }
});

test('parseEEFFComparableOCR cae correctamente al Vision OCR original si es una imagen o PDF escaneado', async () => {
  const axios = (await import('axios')).default;
  const originalPost = axios.post;

  let apiPayloadRecibido = null;

  // Mock de la llamada API para el fallback de imagen
  axios.post = async (url, payload) => {
    apiPayloadRecibido = payload;
    return {
      data: {
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                nombre: "QUBICGAMES S.A.",
                identificador_fuente: "",
                periodo: "2025",
                moneda: "COP",
                unidad_origen: "unidades",
                ingresos_operacionales: 28.81,
                costo_ventas: 0.15,
                utilidad_bruta: 28.66,
                gastos_operacionales: 28.23,
                utilidad_operacional: 0.43,
                cuentas_por_cobrar: 5.94,
                inventarios: 0.06,
                cuentas_por_pagar: 5.88,
                total_activos: 16.58,
                total_pasivos: 8.39,
                patrimonio: 8.19,
                propiedad_planta_equipo: 0.42,
                efectivo_y_equivalentes: 3.05,
                gastos_investigacion_desarrollo: null,
                gastos_publicidad: null
              })
            }]
          }
        }]
      }
    };
  };

  try {
    const mockFile = {
      name: 'imagen_escaneada.png',
      type: 'image/png',
      arrayBuffer: async () => Buffer.from('bytes falsos de imagen')
    };

    const result = await (await import('./eeffParser.js')).parseEEFFComparableOCR(mockFile, 2025);

    assert.ok(result, 'Debe devolver un resultado');
    assert.strictEqual(result.data.nombre, 'QUBICGAMES S.A.');

    // Verificar que se haya llamado a Vision OCR con datos base64 inline
    assert.ok(apiPayloadRecibido, 'Debe haber enviado un payload a la API');
    assert.ok(apiPayloadRecibido.contents[0].parts[0].inline_data, 'Debe enviar inline_data (base64) para Vision OCR');
    assert.strictEqual(apiPayloadRecibido.contents[0].parts[0].inline_data.mime_type, 'image/png');

  } finally {
    // Restaurar original
    axios.post = originalPost;
  }
});

/* ══════ La pasada angosta a notas, cuando algo quedó en null ══════ */

test('CAMPOS_CON_FALLBACK_NOTAS son exactamente costo de ventas, partes relacionadas e inventarios', () => {
  assert.deepStrictEqual(Object.keys(CAMPOS_CON_FALLBACK_NOTAS).sort(), ['t_ap', 't_ar', 't_c', 't_inv']);
});

test('promptFaltantesEnNotas solo pide los campos indicados, con su definición', () => {
  const prompt = promptFaltantesEnNotas(['t_c']);
  assert.match(prompt, /costo de ventas/);
  assert.doesNotMatch(prompt, /inventarios/);
  assert.match(prompt, /"t_c"/);
});

test('promptFaltantesEnNotas exige revisar notas y citar la ausencia', () => {
  const prompt = promptFaltantesEnNotas(['t_ap']);
  assert.match(prompt, /nota/i);
  assert.match(prompt, /cita/i);
});

test('buscarFaltantesEnNotas sin faltantes no llama a la API', async () => {
  const axios = (await import('axios')).default;
  const originalPost = axios.post;
  let llamado = false;
  axios.post = async () => { llamado = true; return { data: {} }; };
  try {
    const r = await buscarFaltantesEnNotas({}, []);
    assert.deepStrictEqual(r, { hallazgos: {}, conclusion: '' });
    assert.strictEqual(llamado, false);
  } finally {
    axios.post = originalPost;
  }
});

test('buscarFaltantesEnNotas interpreta la respuesta de Gemini, encontrado y ausente', async () => {
  const axios = (await import('axios')).default;
  const originalPost = axios.post;
  axios.post = async () => ({
    data: {
      candidates: [{
        content: {
          parts: [{
            text: JSON.stringify({
              hallazgos: {
                t_c: { valor: null, encontrado_en: null, palabra: '', cita: 'Revisé la Nota 19: solo trae gastos de administración.' },
                t_inv: { valor: 4200, encontrado_en: 'nota', palabra: 'existencias', cita: '' },
              },
              conclusion: 'No se encontró el costo de ventas ni en el estado ni en las notas; sí se encontraron los inventarios en la Nota 8.',
            }),
          }],
        },
      }],
    },
  });

  const mockFile = { type: 'application/pdf', name: 'x.pdf', arrayBuffer: async () => new ArrayBuffer(8) };
  try {
    const { hallazgos, conclusion } = await buscarFaltantesEnNotas(mockFile, ['t_c', 't_inv']);
    assert.strictEqual(hallazgos.t_c.valor, null);
    assert.match(hallazgos.t_c.cita, /Nota 19/);
    assert.strictEqual(hallazgos.t_inv.valor, 4200);
    assert.strictEqual(hallazgos.t_inv.encontradoEn, 'nota');
    assert.match(conclusion, /inventarios/);
  } finally {
    axios.post = originalPost;
  }
});
