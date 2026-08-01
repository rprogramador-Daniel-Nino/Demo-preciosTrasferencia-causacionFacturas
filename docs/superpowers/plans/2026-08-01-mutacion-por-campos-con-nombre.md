# Mutación por campos con nombre — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sustituir los datos del informe por **nombre de campo** en vez de por valor literal, de modo que la plantilla importada tome los datos ya ingeridos del estudio activo y ningún dato del cliente anterior sobreviva.

**Architecture:** Cuatro servicios puros y una pantalla. `plantillaVocabulario.js` define qué campos existen y cómo se resuelve cada uno contra el estudio. `plantillaMarcador.js` propone marcas con IA y las aplica al HTML verificando que cada fragmento exista literalmente. `plantillaRenderer.js` sustituye las marcas por valores y resuelve las imágenes. `plantillaGuardas.js` reúne los avisos previos a generar. `RevisorDeMarcas.jsx` es la confirmación humana. El marcado se paga una vez por plantilla y se guarda en IndexedDB.

**Tech Stack:** JavaScript ESM sin framework en los servicios, React 19 en la pantalla, `axios` contra `/api/gemini`, `node:test` para las pruebas. Sin dependencias nuevas.

## Global Constraints

- El código, los comentarios y la UI van **en español**. Es regla del repositorio.
- **Sin dependencias nuevas.** Todo lo que hace falta ya está en `frontend/package.json`.
- Las llamadas a IA van por el proxy, nunca directas: `axios.post('/api/gemini', { model: 'gemini-3-flash-preview', contents: [{ parts: [{ text: prompt }] }] })`. El texto se recompone uniendo **todas** las partes de `respuesta.data.candidates[0].content.parts`, no solo la primera.
- Las respuestas del modelo se parsean con `extraerJSON` de `frontend/src/services/comparablesEngine.js`, nunca con `JSON.parse` sobre el texto pelado.
- Los tests se llaman `frontend/src/services/<archivo>.test.js` y corren con `npm test` desde la raíz.
- Lint: `npm run lint --prefix frontend` (oxlint). No introducir warnings nuevos.
- **El informe se radica ante la DIAN.** Si un campo marcado no tiene dato, se emite un marcador visible; **jamás** se conserva el valor de la referencia. Publicar la cifra del año anterior como si fuera la del año en curso es peor que dejar un hueco evidente.
- No editar `public/index.html` ni `public/gestor-reportes/` a mano: son artefactos de `npm run build`.

---

## Estructura de archivos

| Archivo | Estado | Responsabilidad |
|---|---|---|
| `frontend/src/services/plantillaVocabulario.js` | crear | Vocabulario cerrado de campos y resolución de cada campo contra el estudio. No conoce HTML ni IA. |
| `frontend/src/services/plantillaMarcador.js` | crear | Propone marcas con IA y las aplica al HTML. No escribe en disco. |
| `frontend/src/services/plantillaRenderer.js` | crear | Plantilla marcada + estudio + recursos → HTML final. Reemplaza a `exactTemplateMapper.js`. |
| `frontend/src/services/plantillaGuardas.js` | crear | Avisos previos a generar. Función pura sobre datos ya cargados. |
| `frontend/src/components/RevisorDeMarcas.jsx` | crear | Pantalla de confirmación de marcas. |
| `frontend/src/components/ReporteGenerador.jsx` | modificar | Enganchar marcado, revisión, renderizador y guardas. |
| `frontend/src/services/plantillaStore.js` | modificar | Guardar y leer el HTML marcado. |
| `frontend/src/services/exactTemplateMapper.js` | conservar | Ruta de respaldo cuando no hay plantilla marcada. No se borra en este plan. |

Los cuatro servicios son funciones puras salvo la llamada a la IA, que se inyecta. Eso es lo que permite probarlos con `node --test` sin navegador y sin red.

---

### Task 0: Extraer el cálculo del rango a un módulo compartido

**Files:**
- Create: `frontend/src/services/rangoIntercuartil.js`
- Test: `frontend/src/services/rangoIntercuartil.test.js`
- Modify: `frontend/src/services/exactTemplateMapper.js:60-103`

**Interfaces:**
- Consumes: `num`, `pliOf`, `ratios`, `quart`, `adjustInfo` de `frontend/src/utils/calculations.js`.
- Produces: `analizarRango(estudio) => { stats: {p25, med, p75} | null, adj: object | null, cumple: string }`

El cálculo del rango intercuartil lo van a necesitar dos rutas: la nueva por campos con nombre (Task 1) y `exactTemplateMapper.js`, que se conserva como respaldo. Se extrae a un módulo propio para tener una sola copia.

**Esta tarea no debe cambiar ningún comportamiento.** `exactTemplateMapper.test.js` ya existe y debe seguir pasando sin tocarlo. En particular hay una rareza que **se conserva tal cual**: cuando no hay comparables suficientes, `cumpleStr` vale `'CUMPLE'`, no vacío ni nulo. Puede parecer un defecto, pero cambiarlo alteraría los informes que hoy salen por esa ruta, y esta tarea es una extracción, no un arreglo. Quien quiera discutir ese valor, que lo haga en otra tarea.

- [ ] **Step 1: Escribir el test que falla**

Crear `frontend/src/services/rangoIntercuartil.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { analizarRango } from './rangoIntercuartil.js';

const conComparables = {
  pli: 'MO', t_s: 100000, t_c: 80000, t_op: 10000,
  comparables: [
    { s: 1000, c: 800, op: 100 }, { s: 2000, c: 1600, op: 260 },
    { s: 3000, c: 2400, op: 300 }, { s: 4000, c: 3200, op: 520 },
  ],
};

test('con cuatro comparables sale el rango completo y ordenado', () => {
  const r = analizarRango(conComparables);
  assert.ok(r.stats, 'debería haber rango');
  assert.ok(r.stats.p25 <= r.stats.med && r.stats.med <= r.stats.p75, 'cuartiles desordenados');
});

test('con menos de tres comparables no hay rango', () => {
  assert.strictEqual(analizarRango({ ...conComparables, comparables: [{ s: 1, c: 1, op: 1 }] }).stats, null);
  assert.strictEqual(analizarRango({}).stats, null);
});

/* Comportamiento heredado de exactTemplateMapper.js. Se conserva exactamente:
   cambiarlo alteraría los informes que hoy salen por esa ruta. */
test('sin rango, la conclusión heredada sigue siendo CUMPLE', () => {
  assert.strictEqual(analizarRango({}).cumple, 'CUMPLE');
  assert.strictEqual(analizarRango({}).adj, null);
});

test('una comparable sin PLI calculable no rompe el resto', () => {
  const r = analizarRango({
    ...conComparables,
    comparables: [...conComparables.comparables, { s: null, c: null, op: null }],
  });
  assert.ok(r.stats, 'la comparable inservible debe descartarse, no tumbar el cálculo');
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

```bash
node --test frontend/src/services/rangoIntercuartil.test.js
```

Esperado: FALLA con `Cannot find module './rangoIntercuartil.js'`.

- [ ] **Step 3: Crear el módulo**

Crear `frontend/src/services/rangoIntercuartil.js` moviendo el bloque tal cual está hoy en `exactTemplateMapper.js:60-103`:

```js
/* Rango intercuartil de las comparables y conclusión de cumplimiento.
   Vive aparte porque lo usan dos rutas: la sustitución por campos con nombre y
   `exactTemplateMapper.js`, que queda como respaldo de las plantillas sin
   marcar. Cuando el mapper se retire, este módulo se queda donde está. */

import { num, pliOf, ratios, quart, adjustInfo } from '../utils/calculations.js';

export function analizarRango(estudio) {
  const study = estudio || {};
  const kind = study.pli || 'MO';
  const T = {
    s: num(study.t_s), c: num(study.t_c), op: num(study.t_op),
    ar: num(study.t_ar), inv: num(study.t_inv), ap: num(study.t_ap),
  };
  const tPLI = pliOf(T, kind);

  const useAdj = study.useadj || false;
  const interestRate = (num(study.prime) || 0) / 100;
  const tR = ratios(T);

  let stats = null;
  if (study.comparables && study.comparables.length >= 3) {
    const activeSeries = study.comparables
      .map((c) => {
        const rawVal = { s: num(c.s), c: num(c.c), op: num(c.op), ar: num(c.ar), inv: num(c.inv), ap: num(c.ap) };
        const pliVal = pliOf(rawVal, kind);
        if (pliVal === null) return null;
        let adjVal = 0;
        const cR = ratios(rawVal);
        if (useAdj && kind !== 'Berry' && tR && cR && tR.apC !== null && cR.apC !== null) {
          adjVal = interestRate * ((tR.arS - cR.arS) + (tR.invS - cR.invS) - (tR.apC - cR.apC));
        }
        return pliVal + adjVal;
      })
      .filter((val) => val !== null)
      .sort((a, b) => a - b);

    if (activeSeries.length >= 3) {
      stats = { p25: quart(activeSeries, 0.25), med: quart(activeSeries, 0.5), p75: quart(activeSeries, 0.75) };
    }
  }

  const adj = stats && tPLI !== null ? adjustInfo(T, tPLI, stats, T.s || 0, 1, study.egreso) : null;
  /* 'CUMPLE' cuando no hay ajuste es comportamiento heredado, no un descuido.
     Ver la nota de la Task 0 del plan antes de cambiarlo. */
  const cumple = adj ? (adj.within ? 'CUMPLE' : 'NO CUMPLE') : 'CUMPLE';

  return { stats, adj, cumple };
}
```

- [ ] **Step 4: Hacer que el mapper lo use**

En `frontend/src/services/exactTemplateMapper.js`, sustituir el bloque completo de las líneas 60-103 (desde el comentario `// Calculamos el Rango Intercuartil y Ajuste si hay comparables` hasta la línea de `const cumpleStr = ...`) por:

```js
  // El cálculo vive en su propio módulo: lo comparte la sustitución por campos.
  const { stats, adj, cumple: cumpleStr } = analizarRango(study);
```

Añadir el import al principio del archivo:

```js
import { analizarRango } from './rangoIntercuartil.js';
```

Después, quitar del import de `calculations.js` los símbolos que dejen de usarse en este archivo. Comprobar cuáles con:

```bash
grep -nE "\b(pliOf|ratios|quart|adjustInfo)\b" frontend/src/services/exactTemplateMapper.js
```

Si alguno ya no aparece fuera de la línea del import, quitarlo de ahí; oxlint avisa de los imports sin usar.

- [ ] **Step 5: Correr la suite completa y verificar que nada cambió**

```bash
npm test
npm run lint --prefix frontend
```

Esperado: todos los tests pasan, **incluidos los de `exactTemplateMapper.test.js` sin haberlos tocado**. Si alguno falla, la extracción cambió comportamiento y hay que corregirla, no ajustar el test.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/services/rangoIntercuartil.js frontend/src/services/rangoIntercuartil.test.js frontend/src/services/exactTemplateMapper.js
git commit -m "refactor: extraer el cálculo del rango intercuartil a su propio módulo"
```

---

### Task 1: Vocabulario de campos

**Files:**
- Create: `frontend/src/services/plantillaVocabulario.js`
- Test: `frontend/src/services/plantillaVocabulario.test.js`

**Interfaces:**
- Consumes: `fmt`, `num`, `pliOf`, `ratios`, `quart`, `adjustInfo`, `getUvtValue` de `frontend/src/utils/calculations.js`.
- Produces:
  - `VOCABULARIO: Array<{ campo: string, etiqueta: string, grupo: string }>` — lista cerrada.
  - `esCampoValido(campo: string) => boolean`
  - `valorDeCampo(estudio: object, campo: string) => string | null` — devuelve el valor ya formateado para insertar en el documento, o `null` si el estudio no lo trae.

- [ ] **Step 1: Escribir el test que falla**

Crear `frontend/src/services/plantillaVocabulario.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { VOCABULARIO, esCampoValido, valorDeCampo } from './plantillaVocabulario.js';

/* Estudio de un cliente que no es End Game, con los campos tal y como los
   escriben hoy DatosContribuyente.jsx e IngestaCifras.jsx. */
const estudio = {
  ent: 'ACME COLOMBIA S.A.S',
  nit: '800123456-7',
  ciiu: '6201',
  objeto: 'Desarrollo de software',
  representante: 'Ana Ruiz',
  anio: 2025,
  vinc: 'ACME INC',
  vinc_id: '999888777',
  vinc_tipo: 'Otros servicios (07)',
  pais_vinc: 'MÉXICO',
  accionistas: [{ nombre: 'ACME INC', pais: 'MÉXICO', acciones: 200000, valor_capital: 200000000 }],
  t_s: 5000000000,
  t_inv_assoc: 2000000000,
  t_intang: 9000000,
  t_dif: 50000000,
  t_act_nocurr: 300000000,
};

test('el vocabulario es cerrado y no admite nombres inventados', () => {
  assert.ok(esCampoValido('ent'), 'ent debería ser válido');
  assert.ok(esCampoValido('eeff.t_inv_assoc'), 'los campos de EEFF llevan prefijo');
  assert.ok(!esCampoValido('direccion'), 'direccion no existe en la ingesta');
  assert.ok(!esCampoValido('lo_que_sea'), 'no se aceptan campos inventados');
});

test('cada campo del vocabulario tiene etiqueta y grupo', () => {
  for (const v of VOCABULARIO) {
    assert.ok(v.campo && v.etiqueta && v.grupo, 'entrada incompleta: ' + JSON.stringify(v));
  }
});

test('el vocabulario cubre los quince campos de EEFF que captura la ingesta', () => {
  const eeff = VOCABULARIO.filter((v) => v.campo.startsWith('eeff.')).map((v) => v.campo);
  for (const c of ['t_cash', 't_ar', 't_inv', 't_tax', 't_ppe', 't_act_curr', 't_act_nocurr',
                   't_act_tot', 't_inv_assoc', 't_intang', 't_dif', 't_ap', 't_c', 't_op', 't_s']) {
    assert.ok(eeff.includes('eeff.' + c), 'falta el campo eeff.' + c);
  }
});

test('los valores salen formateados y los ausentes salen nulos', () => {
  assert.strictEqual(valorDeCampo(estudio, 'ent'), 'ACME COLOMBIA S.A.S');
  assert.strictEqual(valorDeCampo(estudio, 'nit'), '800123456-7');
  assert.strictEqual(valorDeCampo(estudio, 'anio'), '2025');
  assert.strictEqual(valorDeCampo(estudio, 'eeff.t_inv_assoc'), '2.000.000.000');
  assert.strictEqual(valorDeCampo(estudio, 'accionista.nombre'), 'ACME INC');
  assert.strictEqual(valorDeCampo(estudio, 'eeff.t_cash'), null, 'no ingresado -> null');
  assert.strictEqual(valorDeCampo({}, 'ent'), null, 'estudio vacío -> null');
});

test('un campo fuera del vocabulario nunca devuelve valor', () => {
  assert.strictEqual(valorDeCampo(estudio, 'direccion'), null);
});

/* Los topes UVT son de lo que más muta: cambian cada año gravable y hoy
   `exactTemplateMapper` los sustituye por valor literal. */
test('los topes UVT se calculan contra el año del estudio', () => {
  const de2025 = valorDeCampo({ anio: 2025 }, 'uvt.tope45k');
  const de2024 = valorDeCampo({ anio: 2024 }, 'uvt.tope45k');
  assert.ok(de2025 && de2024, 'ambos años deben resolver');
  assert.notStrictEqual(de2025, de2024, 'el tope debe cambiar con el año');
  assert.match(de2025, /^[\d.]+$/, 'debe salir formateado con separadores');
});

test('el rango intercuartil sale de las comparables y no del informe viejo', () => {
  const conComparables = {
    ...estudio,
    pli: 'MO',
    t_op: 100000, t_c: 800000,
    comparables: [
      { s: 1000, c: 800, op: 100 }, { s: 2000, c: 1600, op: 260 },
      { s: 3000, c: 2400, op: 300 }, { s: 4000, c: 3200, op: 520 },
    ],
  };
  const p25 = valorDeCampo(conComparables, 'rango.p25');
  const p75 = valorDeCampo(conComparables, 'rango.p75');
  assert.ok(p25 && p75, 'con cuatro comparables debe haber rango');
  assert.ok(['CUMPLE', 'NO CUMPLE'].includes(valorDeCampo(conComparables, 'rango.cumple')));
});

test('sin comparables suficientes el rango sale nulo, no inventado', () => {
  assert.strictEqual(valorDeCampo({ ...estudio, comparables: [] }, 'rango.p25'), null);
  assert.strictEqual(valorDeCampo(estudio, 'rango.mediana'), null);
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

```bash
node --test frontend/src/services/plantillaVocabulario.test.js
```

Esperado: FALLA con `Cannot find module './plantillaVocabulario.js'`.

- [ ] **Step 3: Escribir la implementación mínima**

Crear `frontend/src/services/plantillaVocabulario.js`:

```js
/* Vocabulario cerrado de campos sustituibles y su resolución contra el estudio.
   No conoce HTML ni IA: solo qué campos existen y qué valor les corresponde.

   La lista es cerrada a propósito. El modelo elige de aquí y no inventa nombres:
   un campo inventado produciría una marca que nunca se resuelve y dejaría el
   valor del cliente anterior en el documento sin que nada lo delate. */

import { fmt, num, getUvtValue } from '../utils/calculations.js';
import { analizarRango } from './rangoIntercuartil.js';

const EEFF = [
  ['t_cash', 'Efectivo'],
  ['t_ar', 'Cuentas por cobrar'],
  ['t_inv', 'Inventarios'],
  ['t_tax', 'Impuestos'],
  ['t_ppe', 'Propiedad, planta y equipo'],
  ['t_act_curr', 'Total activo corriente'],
  ['t_act_nocurr', 'Total activos no corrientes'],
  ['t_act_tot', 'Total activos'],
  ['t_inv_assoc', 'Inversiones asociadas'],
  ['t_intang', 'Intangibles'],
  ['t_dif', 'Diferidos'],
  ['t_ap', 'Cuentas por pagar'],
  ['t_c', 'Costos'],
  ['t_op', 'Gastos operacionales'],
  ['t_s', 'Ingresos'],
];

export const VOCABULARIO = [
  { campo: 'ent', etiqueta: 'Razón social', grupo: 'Contribuyente' },
  { campo: 'nit', etiqueta: 'NIT', grupo: 'Contribuyente' },
  { campo: 'ciiu', etiqueta: 'Código CIIU', grupo: 'Contribuyente' },
  { campo: 'objeto', etiqueta: 'Objeto social', grupo: 'Contribuyente' },
  { campo: 'representante', etiqueta: 'Representante legal', grupo: 'Contribuyente' },
  { campo: 'anio', etiqueta: 'Año gravable', grupo: 'Contribuyente' },
  { campo: 'vinc', etiqueta: 'Vinculado económico', grupo: 'Vinculada' },
  { campo: 'vinc_id', etiqueta: 'Identificación del vinculado', grupo: 'Vinculada' },
  { campo: 'vinc_tipo', etiqueta: 'Tipo de operación', grupo: 'Vinculada' },
  { campo: 'pais_vinc', etiqueta: 'País del vinculado', grupo: 'Vinculada' },
  { campo: 'accionista.nombre', etiqueta: 'Accionista principal', grupo: 'Accionistas' },
  { campo: 'accionista.pais', etiqueta: 'País del accionista', grupo: 'Accionistas' },
  { campo: 'accionista.acciones', etiqueta: 'Acciones', grupo: 'Accionistas' },
  { campo: 'accionista.valor_capital', etiqueta: 'Valor del capital', grupo: 'Accionistas' },
  ...EEFF.map(([c, etiqueta]) => ({ campo: 'eeff.' + c, etiqueta, grupo: 'Estados financieros' })),
  { campo: 'rango.p25', etiqueta: 'Cuartil inferior', grupo: 'Rango' },
  { campo: 'rango.mediana', etiqueta: 'Mediana', grupo: 'Rango' },
  { campo: 'rango.p75', etiqueta: 'Cuartil superior', grupo: 'Rango' },
  { campo: 'rango.cumple', etiqueta: 'Conclusión de cumplimiento', grupo: 'Rango' },
  { campo: 'uvt.tope45k', etiqueta: 'Tope de 45.000 UVT', grupo: 'Topes' },
  { campo: 'uvt.tope10k', etiqueta: 'Tope de 10.000 UVT', grupo: 'Topes' },
];

const CAMPOS = new Set(VOCABULARIO.map((v) => v.campo));

export const esCampoValido = (campo) => CAMPOS.has(campo);

/* El cálculo vive en `rangoIntercuartil.js` (Task 0), compartido con
   `exactTemplateMapper.js`. Aquí solo se decide qué se publica: si no hay
   rango, el campo sale nulo y el renderizador pondrá un hueco visible. Ojo con
   la diferencia deliberada respecto al mapper: aquel devuelve 'CUMPLE' cuando
   no hay comparables —comportamiento heredado que la Task 0 conserva— y esta
   ruta prefiere el hueco, porque afirmar cumplimiento sin haberlo calculado es
   justo lo que no debe llegar a un documento que se radica ante la DIAN. */

/* Devuelve el valor listo para insertar, o null si el estudio no lo trae.
   Nunca devuelve un valor por defecto: un campo sin dato tiene que verse como
   hueco, no heredar la cifra del informe de referencia. */
export function valorDeCampo(estudio, campo) {
  if (!estudio || !esCampoValido(campo)) return null;

  if (campo.startsWith('uvt.')) {
    const tasa = getUvtValue(estudio.anio);
    if (!tasa) return null;
    return fmt((campo === 'uvt.tope45k' ? 45000 : 10000) * tasa);
  }

  if (campo.startsWith('rango.')) {
    const { stats, cumple } = analizarRango(estudio);
    if (!stats) return null;
    if (campo === 'rango.cumple') return cumple;
    const v = { 'rango.p25': stats.p25, 'rango.mediana': stats.med, 'rango.p75': stats.p75 }[campo];
    return v === null || v === undefined ? null : fmt(v);
  }

  if (campo.startsWith('eeff.')) {
    const bruto = estudio[campo.slice(5)];
    return bruto === undefined || bruto === null || bruto === '' ? null : fmt(num(bruto));
  }

  if (campo.startsWith('accionista.')) {
    const a = (estudio.accionistas || [])[0];
    if (!a) return null;
    const clave = campo.slice(11);
    const bruto = a[clave];
    if (bruto === undefined || bruto === null || bruto === '') return null;
    return clave === 'acciones' || clave === 'valor_capital' ? fmt(num(bruto)) : String(bruto);
  }

  const bruto = estudio[campo];
  return bruto === undefined || bruto === null || bruto === '' ? null : String(bruto);
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

```bash
node --test frontend/src/services/plantillaVocabulario.test.js
```

Esperado: 8 tests, 8 pasan.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/plantillaVocabulario.js frontend/src/services/plantillaVocabulario.test.js
git commit -m "feat: vocabulario cerrado de campos sustituibles del informe"
```

---

### Task 2: Aplicar marcas al HTML sin tocar el resto

**Files:**
- Create: `frontend/src/services/plantillaMarcador.js`
- Test: `frontend/src/services/plantillaMarcador.test.js`

**Interfaces:**
- Consumes: `esCampoValido` de `./plantillaVocabulario.js` (Task 1).
- Produces:
  - `aplicarMarcas(html: string, marcas: Array<{fragmento, campo, ocurrencia}>) => { html: string, aplicadas: number, descartadas: Array<{marca, motivo}> }`

Esta es la pieza crítica del spec: el modelo no reescribe el documento, solo propone pares fragmento→campo, y **el código verifica que cada fragmento exista literalmente antes de marcarlo**. El documento original queda intocable por construcción.

- [ ] **Step 1: Escribir el test que falla**

Crear `frontend/src/services/plantillaMarcador.test.js`:

```js
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
  const html = '<p>Carrera 7</p>';
  const r = aplicarMarcas(html, [{ fragmento: 'Carrera 7', campo: 'direccion', ocurrencia: 1 }]);
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
```

- [ ] **Step 2: Correr el test y verificar que falla**

```bash
node --test frontend/src/services/plantillaMarcador.test.js
```

Esperado: FALLA con `Cannot find module './plantillaMarcador.js'`.

- [ ] **Step 3: Escribir la implementación mínima**

Crear `frontend/src/services/plantillaMarcador.js`:

```js
/* Aplica al HTML las marcas propuestas, verificando que cada fragmento exista
   literalmente antes de tocarlo.

   El modelo no reescribe el documento: devuelve pares fragmento→campo y las
   marcas las pone este código. Pedirle a un modelo que reescriba 112 páginas
   insertando etiquetas garantiza que altere texto por el camino —una tilde, una
   cifra, un párrafo resumido— y este documento se radica ante la DIAN. */

import { esCampoValido } from './plantillaVocabulario.js';

/* Trocea el HTML en segmentos de texto y de etiqueta. La búsqueda solo entra en
   los de texto: buscar sobre el HTML crudo permitiría marcar dentro de un
   atributo y romper la etiqueta. */
function segmentar(html) {
  const segmentos = [];
  let i = 0;
  while (i < html.length) {
    const abre = html.indexOf('<', i);
    if (abre === -1) {
      segmentos.push({ tipo: 'texto', valor: html.slice(i) });
      break;
    }
    if (abre > i) segmentos.push({ tipo: 'texto', valor: html.slice(i, abre) });
    const cierra = html.indexOf('>', abre);
    if (cierra === -1) {
      segmentos.push({ tipo: 'etiqueta', valor: html.slice(abre) });
      break;
    }
    segmentos.push({ tipo: 'etiqueta', valor: html.slice(abre, cierra + 1) });
    i = cierra + 1;
  }
  return segmentos;
}

export function aplicarMarcas(html, marcas) {
  const segmentos = segmentar(html);
  const descartadas = [];
  let aplicadas = 0;

  for (const marca of marcas || []) {
    const { fragmento, campo } = marca || {};
    const ocurrencia = marca && marca.ocurrencia ? marca.ocurrencia : 1;

    if (!campo || !esCampoValido(campo)) {
      descartadas.push({ marca, motivo: 'el campo no está en el vocabulario' });
      continue;
    }
    if (!fragmento) {
      descartadas.push({ marca, motivo: 'la marca no trae fragmento' });
      continue;
    }

    /* Se recorre contando apariciones en el texto ya segmentado, de modo que
       las marcas anteriores (que introdujeron etiquetas) no desplacen la
       cuenta ni se marquen dos veces. */
    let vistas = 0;
    let puesta = false;
    for (let s = 0; s < segmentos.length && !puesta; s++) {
      if (segmentos[s].tipo !== 'texto') continue;
      let desde = 0;
      for (;;) {
        const pos = segmentos[s].valor.indexOf(fragmento, desde);
        if (pos === -1) break;
        vistas++;
        if (vistas === ocurrencia) {
          const v = segmentos[s].valor;
          segmentos.splice(
            s, 1,
            { tipo: 'texto', valor: v.slice(0, pos) },
            { tipo: 'etiqueta', valor: '<span data-campo="' + campo + '">' },
            { tipo: 'texto', valor: fragmento },
            { tipo: 'etiqueta', valor: '</span>' },
            { tipo: 'texto', valor: v.slice(pos + fragmento.length) }
          );
          puesta = true;
          break;
        }
        desde = pos + fragmento.length;
      }
    }

    if (puesta) aplicadas++;
    else descartadas.push({ marca, motivo: 'el fragmento no aparece en el documento' });
  }

  return { html: segmentos.map((s) => s.valor).join(''), aplicadas, descartadas };
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

```bash
node --test frontend/src/services/plantillaMarcador.test.js
```

Esperado: 7 tests, 7 pasan.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/plantillaMarcador.js frontend/src/services/plantillaMarcador.test.js
git commit -m "feat: aplicar marcas al HTML verificando el fragmento literal"
```

---

### Task 3: Proponer marcas con IA, por secciones

**Files:**
- Modify: `frontend/src/services/plantillaMarcador.js`
- Modify: `frontend/src/services/plantillaMarcador.test.js`

**Interfaces:**
- Consumes: `VOCABULARIO`, `esCampoValido` de `./plantillaVocabulario.js`; `extraerJSON` de `./comparablesEngine.js`.
- Produces:
  - `trocear(html: string, maxCaracteres?: number) => string[]`
  - `proponerMarcas(html: string, opciones?: { pedir?: (prompt: string) => Promise<string>, maxCaracteres?: number }) => Promise<Array<{fragmento, campo, ocurrencia}>>`

`pedir` se inyecta para poder probar sin red. Por defecto llama al proxy.

- [ ] **Step 1: Escribir el test que falla**

Añadir al final de `frontend/src/services/plantillaMarcador.test.js`:

```js
import { trocear, proponerMarcas } from './plantillaMarcador.js';

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

test('proponerMarcas acepta solo campos del vocabulario', async () => {
  const respuesta = JSON.stringify({
    marcas: [
      { fragmento: 'ACME S.A.S', campo: 'ent', ocurrencia: 1 },
      { fragmento: 'Carrera 7', campo: 'direccion', ocurrencia: 1 },
    ],
  });
  const marcas = await proponerMarcas('<p>ACME S.A.S en Carrera 7</p>', {
    pedir: async () => 'Aquí van las marcas:\n```json\n' + respuesta + '\n```\nEso es todo.',
  });
  assert.deepStrictEqual(marcas, [{ fragmento: 'ACME S.A.S', campo: 'ent', ocurrencia: 1 }]);
});

test('un trozo que falla no tumba los demás', async () => {
  let llamada = 0;
  const marcas = await proponerMarcas('<p>' + 'a'.repeat(80) + '</p><p>ACME S.A.S</p>', {
    maxCaracteres: 60,
    pedir: async () => {
      llamada++;
      if (llamada === 1) throw new Error('502 del proxy');
      return JSON.stringify({ marcas: [{ fragmento: 'ACME S.A.S', campo: 'ent', ocurrencia: 1 }] });
    },
  });
  assert.strictEqual(marcas.length, 1, 'debería conservar lo que sí salió');
});

test('una respuesta que no trae JSON no rompe', async () => {
  const marcas = await proponerMarcas('<p>ACME</p>', { pedir: async () => 'No encontré nada.' });
  assert.deepStrictEqual(marcas, []);
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

```bash
node --test frontend/src/services/plantillaMarcador.test.js
```

Esperado: FALLA con `trocear is not a function` / `proponerMarcas is not a function`.

- [ ] **Step 3: Escribir la implementación mínima**

Añadir a `frontend/src/services/plantillaMarcador.js`:

```js
import axios from 'axios';
import { VOCABULARIO, esCampoValido } from './plantillaVocabulario.js';
import { extraerJSON } from './comparablesEngine.js';

/* 112 páginas no caben en una petición. Se trocea por límites de etiqueta para
   no partir el HTML por la mitad; las marcas se acumulan y cada fragmento se
   verifica después contra el documento completo. */
export function trocear(html, maxCaracteres = 12000) {
  const trozos = [];
  let actual = '';
  for (const parte of html.split(/(?=<)/)) {
    if (actual && actual.length + parte.length > maxCaracteres) {
      trozos.push(actual);
      actual = '';
    }
    actual += parte;
  }
  if (actual) trozos.push(actual);
  return trozos;
}

const listaDeCampos = () =>
  VOCABULARIO.map((v) => '- ' + v.campo + ': ' + v.etiqueta + ' (' + v.grupo + ')').join('\n');

const promptDe = (trozo) =>
  'Eres un asistente que prepara una plantilla de Informe Local de Precios de Transferencia.\n' +
  'Recibes un fragmento del informe del año anterior. Debes señalar qué textos concretos son ' +
  'datos del contribuyente que cambian de un informe a otro.\n\n' +
  'Campos disponibles (elige SOLO de esta lista, no inventes nombres):\n' + listaDeCampos() +
  '\n\nFragmento:\n' + trozo +
  '\n\nResponde ÚNICAMENTE con un objeto JSON válido, sin marcas markdown, con esta forma exacta:\n' +
  '{"marcas":[{"fragmento":"","campo":"","ocurrencia":1}]}\n' +
  '"fragmento" debe ser el texto EXACTO tal y como aparece en el fragmento, sin reescribirlo, ' +
  'sin corregir tildes y sin incluir etiquetas HTML. "ocurrencia" es 1 para la primera ' +
  'aparición de ese texto, 2 para la segunda, y así. Si no hay nada que marcar, responde ' +
  '{"marcas":[]}.';

/* Llamada real al proxy. Se aísla aquí para que los tests inyecten la suya. */
async function pedirAlModelo(prompt) {
  const respuesta = await axios.post('/api/gemini', {
    model: 'gemini-3-flash-preview',
    contents: [{ parts: [{ text: prompt }] }],
  });
  /* Todas las partes, no solo la primera: los modelos parten la respuesta. */
  return (respuesta.data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
}

export async function proponerMarcas(html, opciones = {}) {
  const pedir = opciones.pedir || pedirAlModelo;
  const marcas = [];

  for (const trozo of trocear(html, opciones.maxCaracteres)) {
    let texto;
    try {
      texto = await pedir(promptDe(trozo));
    } catch (err) {
      /* Un trozo que falla no debe tumbar el marcado entero: son decenas de
         llamadas y perder todo por una es inaceptable. */
      console.error('[marcado] un trozo falló:', err);
      continue;
    }
    let json;
    try {
      json = extraerJSON(texto);
    } catch {
      console.error('[marcado] respuesta sin JSON utilizable');
      continue;
    }
    for (const m of (json && json.marcas) || []) {
      if (!m || !m.fragmento || !esCampoValido(m.campo)) continue;
      marcas.push({
        fragmento: String(m.fragmento),
        campo: m.campo,
        ocurrencia: Number(m.ocurrencia) > 0 ? Number(m.ocurrencia) : 1,
      });
    }
  }
  return marcas;
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

```bash
node --test frontend/src/services/plantillaMarcador.test.js
```

Esperado: 11 tests, 11 pasan.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/plantillaMarcador.js frontend/src/services/plantillaMarcador.test.js
git commit -m "feat: proponer marcas con IA por secciones, con vocabulario cerrado"
```

---

### Task 4: Renderizador que sustituye por nombre de campo

**Files:**
- Create: `frontend/src/services/plantillaRenderer.js`
- Test: `frontend/src/services/plantillaRenderer.test.js`

**Interfaces:**
- Consumes: `valorDeCampo` de `./plantillaVocabulario.js` (Task 1).
- Produces:
  - `renderizar(htmlMarcado: string, estudio: object, recursos?: Array<{id, dataUrl}>) => { html: string, vacios: string[] }`

`vacios` es la lista de campos marcados que el estudio no trae. La consume la guarda de la Task 5.

- [ ] **Step 1: Escribir el test que falla**

Crear `frontend/src/services/plantillaRenderer.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { renderizar } from './plantillaRenderer.js';

const estudio = { ent: 'ACME COLOMBIA S.A.S', nit: '800123456-7', anio: 2025 };

test('sustituye el campo por su valor', () => {
  const r = renderizar('<p><span data-campo="ent">END GAME S.A.S</span></p>', estudio);
  assert.ok(r.html.includes('ACME COLOMBIA S.A.S'));
  assert.ok(!r.html.includes('END GAME'), 'sobrevivió el valor del cliente anterior');
  assert.deepStrictEqual(r.vacios, []);
});

test('un campo repetido se sustituye en todas sus apariciones', () => {
  const marcado = '<p><span data-campo="anio">2024</span> y <span data-campo="anio">2024</span></p>';
  const r = renderizar(marcado, estudio);
  assert.strictEqual((r.html.match(/2025/g) || []).length, 2);
  assert.ok(!r.html.includes('2024'));
});

/* El informe se radica ante la DIAN: una cifra del año anterior presentada como
   la del año en curso es peor que un hueco evidente. */
test('un campo sin dato deja marcador visible y se reporta, nunca el valor viejo', () => {
  const r = renderizar('<p><span data-campo="ciiu">6201</span></p>', estudio);
  assert.ok(!r.html.includes('6201'), 'no debe conservarse el valor de la referencia');
  assert.ok(r.html.includes('—'), 'debe quedar un marcador visible');
  assert.deepStrictEqual(r.vacios, ['ciiu']);
});

test('resuelve las imágenes contra el catálogo de recursos', () => {
  const recursos = [{ id: 'img_p0_1', dataUrl: 'data:image/png;base64,AAA' }];
  const r = renderizar('<p><img data-recurso="img_p0_1" /></p>', estudio, recursos);
  assert.ok(r.html.includes('src="data:image/png;base64,AAA"'));
});

test('una imagen repetida se resuelve en todas sus apariciones', () => {
  const recursos = [{ id: 'logo', dataUrl: 'data:image/png;base64,BBB' }];
  const marcado = '<img data-recurso="logo" /><p>x</p><img data-recurso="logo" />';
  const r = renderizar(marcado, estudio, recursos);
  assert.strictEqual((r.html.match(/base64,BBB/g) || []).length, 2);
});

test('el HTML sin marcas sale igual que entró', () => {
  const html = '<p>Texto fijo del informe</p>';
  assert.strictEqual(renderizar(html, estudio).html, html);
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

```bash
node --test frontend/src/services/plantillaRenderer.test.js
```

Esperado: FALLA con `Cannot find module './plantillaRenderer.js'`.

- [ ] **Step 3: Escribir la implementación mínima**

Crear `frontend/src/services/plantillaRenderer.js`:

```js
/* Plantilla marcada + estudio + recursos → HTML final.
   Sustituye por nombre de campo, no por valor literal: es lo que impide que un
   dato del cliente anterior sobreviva cuando alguien agrega texto a la
   plantilla sin acordarse de añadir su regla. */

import { valorDeCampo } from './plantillaVocabulario.js';

/* Resalta el valor sustituido en la vista previa. Los estilos se limpian al
   exportar, igual que hoy hace ReporteGenerador. */
const resaltar = (valor) =>
  '<span style="font-weight:600;color:#0B7C7A;border-bottom:1px dashed #0FA3A1;' +
  'background-color:#F0FDF4;padding:0 4px;border-radius:3px;">' + valor + '</span>';

const RX_MARCA = /<span data-campo="([^"]+)">([\s\S]*?)<\/span>/g;

export function renderizar(htmlMarcado, estudio, recursos = []) {
  const vacios = new Set();

  let html = String(htmlMarcado || '').replace(RX_MARCA, (_, campo) => {
    const valor = valorDeCampo(estudio, campo);
    if (valor === null) {
      vacios.add(campo);
      return resaltar('—');
    }
    return resaltar(valor);
  });

  for (const r of recursos) {
    html = html.replace(
      new RegExp('<img data-recurso="' + r.id + '"[^>]*>', 'g'),
      '<img data-recurso="' + r.id + '" src="' + r.dataUrl + '" />'
    );
  }

  return { html, vacios: [...vacios] };
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

```bash
node --test frontend/src/services/plantillaRenderer.test.js
```

Esperado: 6 tests, 6 pasan.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/plantillaRenderer.js frontend/src/services/plantillaRenderer.test.js
git commit -m "feat: renderizador que sustituye por nombre de campo"
```

---

### Task 5: Guardas previas a generar

**Files:**
- Create: `frontend/src/services/plantillaGuardas.js`
- Test: `frontend/src/services/plantillaGuardas.test.js`

**Interfaces:**
- Consumes: la lista `vacios` que produce `renderizar` (Task 4).
- Produces:
  - `revisarAntesDeGenerar({ estudio, nitDeReferencia, vacios, tieneAnexo }) => Array<{ nivel: 'aviso', texto: string }>`

Las tres guardas del spec. Ninguna bloquea: todas avisan y dejan continuar.

- [ ] **Step 1: Escribir el test que falla**

Crear `frontend/src/services/plantillaGuardas.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { revisarAntesDeGenerar } from './plantillaGuardas.js';

const base = { estudio: { nit: '800123456-7' }, nitDeReferencia: '800123456-7', vacios: [], tieneAnexo: true };

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
```

- [ ] **Step 2: Correr el test y verificar que falla**

```bash
node --test frontend/src/services/plantillaGuardas.test.js
```

Esperado: FALLA con `Cannot find module './plantillaGuardas.js'`.

- [ ] **Step 3: Escribir la implementación mínima**

Crear `frontend/src/services/plantillaGuardas.js`:

```js
/* Avisos previos a generar el informe. Ninguno bloquea: el spec decidió avisar
   y dejar continuar, porque quien redacta el informe sabe cosas que la
   herramienta no. Lo que no se admite es que el problema pase inadvertido. */

export function revisarAntesDeGenerar({ estudio, nitDeReferencia, vacios, tieneAnexo }) {
  const avisos = [];
  const nitEstudio = (estudio && estudio.nit) || '';

  if (nitDeReferencia && nitEstudio && nitDeReferencia !== nitEstudio) {
    avisos.push({
      nivel: 'aviso',
      texto:
        'El informe de referencia es del NIT ' + nitDeReferencia +
        ' y el estudio activo es del NIT ' + nitEstudio +
        '. Revisa que la plantilla corresponda a este contribuyente.',
    });
  }

  if (!tieneAnexo) {
    avisos.push({
      nivel: 'aviso',
      texto:
        'No se ha subido el anexo de estados financieros del año en curso: ' +
        'esas páginas saldrán marcadas y en blanco.',
    });
  }

  if (vacios && vacios.length) {
    avisos.push({
      nivel: 'aviso',
      texto:
        'Hay ' + vacios.length + ' campo(s) marcados sin dato en el estudio, que saldrán ' +
        'como “—”: ' + vacios.join(', ') + '.',
    });
  }

  return avisos;
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

```bash
node --test frontend/src/services/plantillaGuardas.test.js
```

Esperado: 6 tests, 6 pasan.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/plantillaGuardas.js frontend/src/services/plantillaGuardas.test.js
git commit -m "feat: guardas de NIT, anexo y campos sin dato antes de generar"
```

---

### Task 6: Persistir la plantilla marcada

**Files:**
- Modify: `frontend/src/services/plantillaStore.js`
- Test: `frontend/src/services/plantillaStore.test.js`

**Interfaces:**
- Produces:
  - `claveMarcado(plantillaId: string) => string` — derivación de la clave, pura y por tanto probable.
  - `guardarMarcado(plantillaId: string, html: string) => Promise<void>`
  - `leerMarcado(plantillaId: string) => Promise<string | null>`

Se guarda con prefijo dentro del almacén `plantillas`, igual que ya hace `guardarVinculo`, para no subir `VERSION` del esquema. El marcado se paga una vez por plantilla: dos estudios que carguen el mismo PDF lo comparten.

**Sobre las pruebas de esta tarea.** `plantillaStore.test.js` hoy prueba únicamente `hashPlantilla`, y no por descuido: **IndexedDB no existe en Node**, así que el viaje de ida y vuelta al almacén no se puede probar con `node --test`. Lo que sí es puro es la derivación de la clave, que es donde de verdad puede haber un fallo: una colisión entre el marcado, el HTML crudo y el vínculo dejaría a un estudio leyendo la plantilla de otro. Eso se prueba; el resto se verifica a mano en el navegador, en el Step 5.

- [ ] **Step 1: Escribir el test que falla**

Añadir a `frontend/src/services/plantillaStore.test.js`:

```js
import { claveMarcado } from './plantillaStore.js';

/* Las tres cosas viven en el mismo almacén distinguidas solo por prefijo. Si
   dos claves colisionaran, un estudio leería la plantilla de otro. */
test('la clave del marcado no colisiona con el HTML crudo ni con el vínculo', () => {
  assert.notStrictEqual(claveMarcado('abc123'), 'abc123', 'colisiona con el HTML crudo');
  assert.notStrictEqual(claveMarcado('abc123'), 'vinculo:abc123', 'colisiona con el vínculo');
  assert.strictEqual(claveMarcado('abc123'), 'marcado:abc123');
});

test('plantillas distintas dan claves de marcado distintas', () => {
  assert.notStrictEqual(claveMarcado('abc'), claveMarcado('abd'));
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

```bash
node --test frontend/src/services/plantillaStore.test.js
```

Esperado: FALLA con `claveMarcado is not a function`.

- [ ] **Step 3: Escribir la implementación mínima**

Añadir a `frontend/src/services/plantillaStore.js`, junto a `guardarVinculo`:

```js
/* HTML ya marcado con <span data-campo="...">. Va con prefijo dentro del
   almacén de plantillas, igual que el vínculo, para no subir VERSION del
   esquema. Se guarda por plantilla y no por estudio: el marcado se paga una
   vez y dos estudios que carguen el mismo PDF lo comparten.
   La derivación de la clave se exporta aparte porque es lo único de esto que
   se puede probar sin navegador. */
export const claveMarcado = (plantillaId) => 'marcado:' + plantillaId;

export const guardarMarcado = (plantillaId, html) =>
  guardarPlantilla(claveMarcado(plantillaId), html);

export const leerMarcado = (plantillaId) => leerPlantilla(claveMarcado(plantillaId));
```

- [ ] **Step 4: Correr el test y verificar que pasa**

```bash
node --test frontend/src/services/plantillaStore.test.js
```

Esperado: 4 tests, 4 pasan (los 2 de `hashPlantilla` que ya existían y los 2 nuevos).

- [ ] **Step 5: Verificar a mano el viaje de ida y vuelta**

Lo que Node no puede probar se comprueba por comportamiento. Con `npm start` corriendo, en `http://localhost:3000/gestor-reportes/`:

1. Subir un PDF y confirmar las marcas en el revisor.
2. Abrir las herramientas de desarrollo en la pestaña **Red** y filtrar por `gemini`.
3. **Recargar la página** y volver a abrir el mismo estudio.
4. La plantilla marcada debe volver **sin ninguna petición a `/api/gemini`**. Si aparece una, el marcado no se está guardando o se está leyendo con otra clave.
5. En la pestaña **Aplicación → IndexedDB → `pt-plantillas` → `plantillas`** deben verse dos entradas para el mismo PDF: la del hash a secas (HTML crudo) y la de `marcado:<hash>`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/services/plantillaStore.js frontend/src/services/plantillaStore.test.js
git commit -m "feat: persistir el HTML marcado por plantilla"
```

---

### Task 7: Pantalla de revisión de marcas

**Files:**
- Create: `frontend/src/components/RevisorDeMarcas.jsx`

**Interfaces:**
- Consumes: `VOCABULARIO` de `../services/plantillaVocabulario.js` (Task 1).
- Produces: componente `RevisorDeMarcas({ marcas, onConfirmar, onCancelar })`, donde `onConfirmar` recibe el array de marcas ya editado.

No hay infraestructura de tests de React en el repo, así que esta tarea se verifica a mano. El resto de la lógica ya está probada en las tareas anteriores, que es justo por qué la pantalla puede ser tonta.

- [ ] **Step 1: Crear el componente**

Crear `frontend/src/components/RevisorDeMarcas.jsx`:

```jsx
import React, { useState } from 'react';
import { Check, X, Trash2 } from 'lucide-react';
import { VOCABULARIO } from '../services/plantillaVocabulario.js';

/* Confirmación humana antes de guardar la plantilla marcada. Es el mismo patrón
   que el repositorio ya usa en la curación de comparables: la IA propone, la
   persona decide. Sin esta pantalla, una marca mal asignada se propagaría a
   todos los informes que usen esta plantilla. */
export default function RevisorDeMarcas({ marcas, onConfirmar, onCancelar }) {
  const [lista, setLista] = useState(marcas || []);

  const cambiarCampo = (i, campo) =>
    setLista(lista.map((m, j) => (j === i ? { ...m, campo } : m)));

  const quitar = (i) => setLista(lista.filter((_, j) => j !== i));

  return (
    <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm">
      <h3 className="text-md font-bold text-zinc-950 dark:text-zinc-50">
        Revisar marcas propuestas
      </h3>
      <p className="text-xs text-zinc-500 mt-1 mb-4">
        La IA propuso {lista.length} marca(s). Corrige el campo asignado o elimina las que no
        correspondan. Nada se guarda hasta que confirmes.
      </p>

      <div className="max-h-[420px] overflow-y-auto space-y-2">
        {lista.map((m, i) => (
          <div key={i} className="flex items-center gap-3 border border-zinc-200 dark:border-zinc-800 rounded-lg px-3 py-2">
            <span className="flex-1 text-xs font-mono text-zinc-700 dark:text-zinc-300 truncate">
              {m.fragmento}
            </span>
            <select
              value={m.campo}
              onChange={(e) => cambiarCampo(i, e.target.value)}
              className="text-xs border border-zinc-200 dark:border-zinc-700 rounded px-2 py-1 bg-white dark:bg-[#262626]"
            >
              {VOCABULARIO.map((v) => (
                <option key={v.campo} value={v.campo}>{v.grupo} — {v.etiqueta}</option>
              ))}
            </select>
            <button onClick={() => quitar(i)} className="text-zinc-400 hover:text-red-500" title="Eliminar">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        ))}
        {lista.length === 0 && (
          <p className="text-xs text-zinc-500">No quedan marcas. La plantilla se guardará sin sustituciones.</p>
        )}
      </div>

      <div className="flex gap-3 mt-5">
        <button
          onClick={() => onConfirmar(lista)}
          className="flex items-center gap-2 bg-[#0FA3A1] hover:bg-[#0B7C7A] text-white rounded-lg px-4 py-2 text-xs font-semibold"
        >
          <Check className="w-3.5 h-3.5" /> Confirmar y guardar plantilla
        </button>
        <button
          onClick={onCancelar}
          className="flex items-center gap-2 border border-zinc-200 dark:border-zinc-700 rounded-lg px-4 py-2 text-xs font-semibold"
        >
          <X className="w-3.5 h-3.5" /> Cancelar
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verificar que compila y no ensucia el lint**

```bash
npm run build --prefix frontend
npm run lint --prefix frontend
```

Esperado: build correcto y ningún warning nuevo en `RevisorDeMarcas.jsx`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/RevisorDeMarcas.jsx
git commit -m "feat: pantalla de revisión de marcas propuestas"
```

---

### Task 8: Enganchar todo en ReporteGenerador

**Files:**
- Modify: `frontend/src/components/ReporteGenerador.jsx`

**Interfaces:**
- Consumes: `proponerMarcas`, `aplicarMarcas` (Tasks 2-3), `renderizar` (Task 4), `revisarAntesDeGenerar` (Task 5), `guardarMarcado`, `leerMarcado` (Task 6), `RevisorDeMarcas` (Task 7).

El flujo queda: al subir un PDF se extrae, se proponen marcas, se revisan, se aplican y se guarda el marcado. Al abrir un estudio con plantilla marcada se renderiza contra el estudio activo. `exactTemplateMapper.js` **se conserva** como ruta de respaldo para plantillas sin marcar.

- [ ] **Step 1: Añadir los imports y el estado**

En `frontend/src/components/ReporteGenerador.jsx`, junto a los imports existentes:

```jsx
import RevisorDeMarcas from './RevisorDeMarcas.jsx';
import { proponerMarcas, aplicarMarcas } from '../services/plantillaMarcador.js';
import { renderizar } from '../services/plantillaRenderer.js';
import { revisarAntesDeGenerar } from '../services/plantillaGuardas.js';
import { guardarMarcado, leerMarcado } from '../services/plantillaStore.js';
```

Y junto a los `useState` existentes:

```jsx
/* Marcas propuestas a la espera de revisión humana, y el id de la plantilla a la
   que pertenecen. Mientras esto no sea null, la pantalla muestra el revisor. */
const [marcasPropuestas, setMarcasPropuestas] = useState(null);
const [plantillaPendiente, setPlantillaPendiente] = useState(null);
const [avisos, setAvisos] = useState([]);
```

- [ ] **Step 2: Proponer marcas tras extraer el PDF**

Dentro de `handleTemplateUpload`, en la rama `if (esPdf)`, después de `if (estudioId) await guardarVinculo(estudioId, idPlantilla);`:

```jsx
/* El marcado se paga una vez por plantilla. Si este PDF ya se marcó antes
   —otro estudio del mismo cliente, o un reintento— se reutiliza. */
const marcadoPrevio = await leerMarcado(idPlantilla);
if (!marcadoPrevio) {
  const propuestas = await proponerMarcas(ref.html);
  setPlantillaPendiente({ id: idPlantilla, html: ref.html });
  setMarcasPropuestas(propuestas);
}
```

- [ ] **Step 3: Confirmar las marcas y guardar**

Añadir junto a las demás funciones del componente:

```jsx
/* Aplica las marcas que la persona confirmó y guarda el resultado. Las
   descartadas se informan: una marca que el modelo propuso sobre texto que no
   existe indica que reescribió el fragmento, y eso conviene saberlo. */
const confirmarMarcas = async (marcas) => {
  const { html, aplicadas, descartadas } = aplicarMarcas(plantillaPendiente.html, marcas);
  await guardarMarcado(plantillaPendiente.id, html);
  const r = renderizar(html, study, recursosCargados);
  setHtmlContent(r.html);
  setCustomTemplateLoaded(true);
  setMarcasPropuestas(null);
  setPlantillaPendiente(null);
  if (descartadas.length) {
    alert('Se aplicaron ' + aplicadas + ' marcas. ' + descartadas.length +
          ' se descartaron porque su texto no aparece literalmente en el documento.');
  }
};
```

- [ ] **Step 4: Renderizar la plantilla marcada al abrir el estudio**

En el `useEffect` de rehidratación, sustituir la línea que hoy hidrata con `hydrateExactWordTemplate` por:

```jsx
/* Si la plantilla está marcada se renderiza por campo; si no, se cae a la
   sustitución por literales, que sigue siendo la ruta de las plantillas
   antiguas. Se resuelve al leer y no al guardar porque el estudio puede
   cambiar después de haber subido la plantilla. */
const marcado = await leerMarcado(idPlantilla);
if (vivo && marcado) {
  const r = renderizar(marcado, study, recursos);
  setHtmlContent(r.html);
  setAvisos(revisarAntesDeGenerar({
    estudio: study, nitDeReferencia: null, vacios: r.vacios, tieneAnexo: true,
  }));
  setCustomTemplateLoaded(true);
} else if (vivo && html) {
  setHtmlContent(conImagenes(hydrateExactWordTemplate(html, study), recursos));
  setCustomTemplateLoaded(true);
}
```

- [ ] **Step 5: Mostrar el revisor y los avisos**

En el `return` del componente, justo antes del contenedor del editor:

```jsx
{marcasPropuestas && (
  <RevisorDeMarcas
    marcas={marcasPropuestas}
    onConfirmar={confirmarMarcas}
    onCancelar={() => { setMarcasPropuestas(null); setPlantillaPendiente(null); }}
  />
)}

{avisos.length > 0 && (
  <div className="border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 rounded-xl p-4">
    <ul className="text-xs text-amber-900 dark:text-amber-200 space-y-1">
      {avisos.map((a, i) => <li key={i}>{a.texto}</li>)}
    </ul>
  </div>
)}
```

- [ ] **Step 6: Verificar build, lint y suite completa**

```bash
npm run build --prefix frontend
npm run lint --prefix frontend
npm test
```

Esperado: build correcto, ningún warning nuevo, y todos los tests pasan.

- [ ] **Step 7: Verificación manual en el navegador**

Levantar `npm start`, abrir `http://localhost:3000/gestor-reportes/` y comprobar, en este orden:

1. Subir `Cpanel/public_html/demo-precios-transferencia/Archivos Prueba/estudio pasado.pdf` con un estudio cuyo NIT **no** sea `901.337.576-6`.
2. Aparece el revisor con marcas propuestas. Corregir alguna y eliminar otra.
3. Confirmar. La vista previa muestra los datos del estudio activo.
4. **Buscar `901.337.576` en el documento generado: no debe aparecer.** Es el criterio que motivó todo el spec.
5. Recargar la página y comprobar que la plantilla marcada se recupera sin volver a llamar a la IA.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/ReporteGenerador.jsx
git commit -m "feat: enganchar marcado, revisión y renderizado por campos"
```

---

## Cierre

- [ ] **Correr `/revisar-ramas-equipo`** antes del merge. Es regla del repositorio y este trabajo toca `ReporteGenerador.jsx` y `plantillaStore.js`, que Daniel y Pablo también tocan.
- [ ] **Avisar al equipo** de que `exactTemplateMapper.js` deja de ser la ruta principal. El spec lo señala como riesgo: Daniel lo extendió el 2026-07-30 con el bloque de composición accionaria, cuya lógica queda absorbida por los campos `accionista.*`.
- [ ] El calco en `.docx` es el plan siguiente, derivado de `docs/superpowers/specs/2026-08-01-calco-docx-desde-pdf-design.md`.
