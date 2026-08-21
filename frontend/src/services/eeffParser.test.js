import { test } from 'node:test';
import assert from 'node:assert';
import {
  EEFF_PROMPT, EEFF_COMPARABLE_PROMPT, EEFF_COMPARABLES_LOTE_PROMPT,
  promptEeffContribuyente, bloqueDeTexto, valorDeRubro, rotuloDeRubro,
  CAMPO_POR_RUBRO, RUBROS_DE_COTEJO,
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

test('el prompt del contribuyente pide los rubros que permiten cotejar', () => {
  /* Sin ellos, un rótulo engañoso no tiene quién lo contradiga: es lo que dejó entrar
     −2.986.236.031 como utilidad operacional de un estado cuya utilidad operacional es
     −1.095.055.781. */
  ['utilidad_bruta', 'gastos_operacionales', 'utilidad_antes_impuestos',
    'resultado_financiero_neto', 'total_pasivos', 'patrimonio',
  ].forEach((campo) => assert.ok(EEFF_PROMPT.includes(campo),
    `falta "${campo}" en EEFF_PROMPT`));
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

test('el prompt admite la nomenclatura NIIF que usan otros estados', () => {
  [/deudores comerciales/i, /gastos pagados por anticipado/i, /impuesto diferido/i,
    /depreciaci[oó]n acumulada/i, /acreedores comerciales/i,
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

test('el mapeo cubre los quince rubros del libro, sin faltar ninguno', () => {
  assert.deepStrictEqual(
    [...CLAVES_RUBROS_EXAMINADA].sort(),
    [...Object.values(CAMPO_POR_RUBRO), 't_op'].sort(),
    'los campos que la lectura produce tienen que ser los que la hoja Datos publica');
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
