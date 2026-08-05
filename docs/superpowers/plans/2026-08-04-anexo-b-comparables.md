# Anexo B dinámico: Descripciones de comparables y Estados Financieros — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar el bloque estático de ANEXO B del Word (Akatsuki Inc., Colopl Inc., Fun Yours, IGG) por las compañías comparables realmente seleccionadas y con EEFF verificado en el estudio activo, con su descripción de actividad redactada en español y sus tres tablas de cifras (descripción, P&L, balance).

**Architecture:** El Paso 4 del motor de comparables (`MotorComparables.jsx`) ya lee EEFF por OCR (`eeffParser.js`); se extiende ese pipeline para conservar todos los rubros que necesita el Anexo B y para redactar automáticamente la descripción de actividad con IA (`descripcionComparables.js`, nuevo). El generador de Word (`exactTemplateMapper.js`) gana un nuevo par de funciones (`generarAnexoBHtml` / `reemplazarAnexoB`) que sustituyen el bloque estático siguiendo el mismo patrón ya usado para el ANEXO A.

**Tech Stack:** React 19 (frontend/), `node:test` + `node:assert` (único framework de pruebas del repo, sin Jest/Vitest instalado), axios para las llamadas a `/api/claude` y `/api/gemini`.

## Global Constraints

- Todo el trabajo va en `frontend/`. No se toca `index.html` (raíz) — decisión del usuario de no dar desarrollo nuevo a ese archivo.
- Solo entran al Anexo B las comparables con `eeffVerificado === true`. Las seleccionadas sin EEFF cargado o sin verificar no aparecen.
- "Promedio" en las etiquetas de balance (Activos totales promedio, EPP neto promedio, Efectivo promedio...) = el valor del único período que lee el OCR. No se calcula un promedio real de dos años — mismo criterio que ya usa el informe con las cifras del contribuyente.
- En las tablas del Anexo B, un valor faltante renderiza **celda vacía**, nunca `—` y nunca `0`. Esto es una excepción específica de esta sección: el resto del documento sigue usando `—` (`wrap`/`cifra` en `exactTemplateMapper.js`) sin cambios.
- Si ninguna comparable califica para el Anexo B, no se deja el bloque estático de Akatsuki/Colopl/Fun Yours/IGG — se reemplaza por un aviso de "pendiente". Dejar cifras de otro caso es peor que un hueco.
- La app no tiene infraestructura de tests de UI (no hay React Testing Library ni jsdom instalados). Los cambios en componentes React (`MotorComparables.jsx`) se verifican con `grep` de que no queden referencias rotas y con prueba manual en el navegador — no se inventan tests automatizados donde no hay arnés para correrlos.
- Los archivos de test de `frontend/src/services/*.test.js` se corren directo con `node --test <archivo>` (ESM, sin bundler) — así lo hace ya `exactTemplateMapper.test.js`.

---

## Task 1: Extender los prompts del Paso 4 con los rubros que faltan

**Files:**
- Modify: `frontend/src/services/eeffParser.js:62-82` (`EEFF_COMPARABLE_PROMPT`), `:184-212` (`EEFF_COMPARABLES_LOTE_PROMPT`)
- Test: `frontend/src/services/eeffParser.test.js` (nuevo)

**Interfaces:**
- Produces: `EEFF_COMPARABLE_PROMPT` y `EEFF_COMPARABLES_LOTE_PROMPT` ahora **exportados** (antes eran `const` sin `export`), cada uno debe incluir las claves JSON `propiedad_planta_equipo`, `efectivo_y_equivalentes`, `gastos_investigacion_desarrollo`, `gastos_publicidad` en su schema de salida.

- [ ] **Step 1: Escribir el test que falla**

Crear `frontend/src/services/eeffParser.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { EEFF_COMPARABLE_PROMPT, EEFF_COMPARABLES_LOTE_PROMPT } from './eeffParser.js';

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
```

- [ ] **Step 2: Correr el test y confirmar que falla**

Run: `cd frontend && node --test src/services/eeffParser.test.js`
Expected: FAIL — `EEFF_COMPARABLE_PROMPT`/`EEFF_COMPARABLES_LOTE_PROMPT` no se pueden importar (no están exportados) y/o no contienen los campos nuevos.

- [ ] **Step 3: Exportar y extender los dos prompts**

En `frontend/src/services/eeffParser.js`, cambiar la declaración de `EEFF_COMPARABLE_PROMPT` (línea 62) de `const EEFF_COMPARABLE_PROMPT = ...` a `export const EEFF_COMPARABLE_PROMPT = ...`, y reemplazar su contenido completo por:

```js
export const EEFF_COMPARABLE_PROMPT = `Eres un analista senior de Precios de Transferencia. Lee los Estados Financieros de la empresa comparable y extrae la matriz contable completa.

Devuelve SOLO un JSON estricto con esta estructura:
{
  "nombre": "Razón social EXACTA de la empresa a la que pertenecen estos estados financieros, tal como aparece en el documento. Si no aparece, cadena vacía: no la inventes ni la deduzcas.",
  "identificador_fuente": "Identificador de la empresa si figura (Company ID de Capital IQ, NIT, tax ID). Cadena vacía si no aparece.",
  "periodo": "Año o rango del ejercicio (ej: 2025 o 2024)",
  "moneda": "USD, COP, EUR, etc.",
  "unidad_origen": "unidades|miles|millones",
  "ingresos_operacionales": 0,
  "costo_ventas": 0,
  "utilidad_bruta": 0,
  "gastos_operacionales": 0,
  "utilidad_operacional": 0,
  "cuentas_por_cobrar": 0,
  "inventarios": 0,
  "cuentas_por_pagar": 0,
  "total_activos": 0,
  "total_pasivos": 0,
  "patrimonio": 0,
  "propiedad_planta_equipo": 0,
  "efectivo_y_equivalentes": 0,
  "gastos_investigacion_desarrollo": null,
  "gastos_publicidad": null
}

Reglas para "gastos_investigacion_desarrollo" y "gastos_publicidad": son rubros OPCIONALES. Úsalos solo si la empresa los desglosa como línea propia en su estado de resultados. Si no aparecen desglosados, devuelve null — NO los deduzcas restando de gastos_operacionales, NO estimes.`;
```

Cambiar `EEFF_COMPARABLES_LOTE_PROMPT` (línea 184) de `const` a `export const`, y su contenido a:

```js
export const EEFF_COMPARABLES_LOTE_PROMPT = `Eres un analista senior de Precios de Transferencia. Este documento contiene los Estados Financieros de VARIAS empresas comparables, una tras otra.

Identifica CADA empresa presente y extrae su matriz contable por separado. No mezcles cifras de empresas distintas y no promedies nada.

Devuelve SOLO un JSON estricto con esta estructura:
{
  "empresas": [
    {
      "nombre": "Razón social EXACTA de la empresa, tal como aparece en el documento",
      "identificador_fuente": "Company ID de Capital IQ, NIT o tax ID si figura; cadena vacía si no",
      "periodo": "Año o rango del ejercicio",
      "moneda": "USD, COP, EUR, etc.",
      "unidad_origen": "unidades|miles|millones",
      "ingresos_operacionales": 0,
      "costo_ventas": 0,
      "utilidad_bruta": 0,
      "gastos_operacionales": 0,
      "utilidad_operacional": 0,
      "cuentas_por_cobrar": 0,
      "inventarios": 0,
      "cuentas_por_pagar": 0,
      "total_activos": 0,
      "total_pasivos": 0,
      "patrimonio": 0,
      "propiedad_planta_equipo": 0,
      "efectivo_y_equivalentes": 0,
      "gastos_investigacion_desarrollo": null,
      "gastos_publicidad": null
    }
  ]
}

Reglas: una entrada por empresa, en el orden en que aparecen. Si un rubro no figura para una empresa, ponlo en 0 — EXCEPTO "gastos_investigacion_desarrollo" y "gastos_publicidad": esos dos son OPCIONALES, van en null si la empresa no los desglosa como línea propia (no los deduzcas ni los estimes). Si el documento resulta contener una sola empresa, devuelve un arreglo de un elemento.`;
```

- [ ] **Step 4: Correr el test y confirmar que pasa**

Run: `cd frontend && node --test src/services/eeffParser.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Correr la suite completa de eeffParser y de todo services/ para verificar que no se rompió nada**

Run: `cd frontend && node --test src/services/*.test.js`
Expected: PASS en todos los archivos, incluyendo los que no se tocaron.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/services/eeffParser.js frontend/src/services/eeffParser.test.js
git commit -m "feat: extender prompts de EEFF de comparables con PP&E, efectivo, I+D y publicidad"
```

---

## Task 2: Conservar el JSON completo del EEFF en la fila de cada comparable

**Files:**
- Modify: `frontend/src/components/MotorComparables.jsx:423-442` (`aplicarEeffEnFila`)

**Interfaces:**
- Produces: cada fila de `comparables` gana un campo `eeffDatos` (el objeto completo devuelto por la IA, con las claves nuevas de la Task 1) cuando se le aplica un EEFF. Los campos existentes (`s, c, op, ar, inv, ap, eeffVerificado, eeffHallazgos, eeffArchivo, eeffCruce, eeffPorConfirmar`) no cambian.

No hay test automatizado para este paso: `aplicarEeffEnFila` es una función interna del componente `MotorComparables` y el repo no tiene React Testing Library ni jsdom instalados (confirmado: `frontend/package.json` no trae ningún test runner ni librería de testing de componentes). Se verifica con grep y con la prueba manual de la Task 7.

- [ ] **Step 1: Modificar `aplicarEeffEnFila`**

En `frontend/src/components/MotorComparables.jsx`, dentro de `aplicarEeffEnFila` (línea 423), agregar el campo `eeffDatos: datos` al objeto que se construye:

```js
  const aplicarEeffEnFila = (filas, indice, datos, verificacion, archivo, cruce) => {
    const copia = [...filas];
    copia[indice] = {
      ...copia[indice],
      s: datos.ingresos_operacionales || copia[indice].s,
      c: datos.costo_ventas || copia[indice].c,
      op: datos.utilidad_operacional || copia[indice].op,
      ar: datos.cuentas_por_cobrar || copia[indice].ar,
      inv: datos.inventarios || copia[indice].inv,
      ap: datos.cuentas_por_pagar || copia[indice].ap,
      /* Todo lo que ya devuelve la IA (utilidad_bruta, gastos_operacionales, total_activos,
         propiedad_planta_equipo, efectivo_y_equivalentes, gastos_investigacion_desarrollo,
         gastos_publicidad...) se conserva completo para el Anexo B del Word, en vez de
         tirarlo como se hacía antes. */
      eeffDatos: datos,
      eeffVerificado: verificacion.esValido,
      eeffHallazgos: verificacion.hallazgos,
      eeffArchivo: archivo,
      eeffCruce: cruce ? { modo: cruce.modo, punt: cruce.punt, nombreLeido: datos.nombre || '' } : null,
      eeffPorConfirmar: cruce ? !esCruceFirme(cruce) : false,
    };
    return copia;
  };
```

- [ ] **Step 2: Verificar con grep que no queda ninguna referencia rota**

Run: `cd frontend && grep -rn "aplicarEeffEnFila" src/`
Expected: solo las dos llamadas existentes (`handleComparableEEFFUpload` y `handleCargaMasivaEEFF`), sin cambios en su firma — el nuevo campo se agrega dentro de la función, no en sus parámetros.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/MotorComparables.jsx
git commit -m "feat: conservar el JSON completo del EEFF de cada comparable en eeffDatos"
```

---

## Task 3: Servicio de redacción de la descripción de actividad con IA

**Files:**
- Create: `frontend/src/services/descripcionComparables.js`
- Test: `frontend/src/services/descripcionComparables.test.js`

**Interfaces:**
- Consumes: `axios` (mismo patrón de mock-por-reasignación de `axios.post` que usa `comparablesEngine.test.js`), endpoint `/api/claude` (passthrough directo a `POST https://api.anthropic.com/v1/messages`, confirmado en `server.js:95-116` — el body se manda tal cual a Anthropic).
- Produces:
  - `redactarDescripcionActividad(nombre: string, descCruda: string): Promise<string|null>` — `null` si `descCruda` está vacía o si la llamada falla tras reintentos.
  - `redactarDescripcionesEnLote(items: Array<{nombre: string, descCruda: string}>, concurrencia = 4): Promise<Array<string|null>>` — resultado alineado por posición con `items`.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `frontend/src/services/descripcionComparables.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert';
import axios from 'axios';
import { redactarDescripcionActividad, redactarDescripcionesEnLote } from './descripcionComparables.js';

function mockClaude(responder) {
  const original = axios.post;
  const llamadas = [];
  axios.post = async (url, body) => {
    llamadas.push({ url, body });
    return { data: { content: [{ type: 'text', text: responder(body) }] } };
  };
  return { restore: () => { axios.post = original; }, llamadas };
}

test('redacta la descripción de una comparable con el texto que devuelve Claude', async () => {
  const { restore, llamadas } = mockClaude(() => 'Akatsuki Inc. se dedica al juego y cómic en Japón.');
  try {
    const texto = await redactarDescripcionActividad('AKATSUKI INC.', 'Akatsuki Inc. is engaged in game...');
    assert.strictEqual(texto, 'Akatsuki Inc. se dedica al juego y cómic en Japón.');
    assert.strictEqual(llamadas.length, 1);
    assert.strictEqual(llamadas[0].url, '/api/claude');
    assert.strictEqual(llamadas[0].body.model, 'claude-haiku-4-5');
    assert.ok(llamadas[0].body.messages[0].content.includes('AKATSUKI INC.'));
    assert.ok(llamadas[0].body.messages[0].content.includes('Akatsuki Inc. is engaged in game...'));
  } finally {
    restore();
  }
});

test('sin descripción cruda no llama a la IA y devuelve null', async () => {
  const { restore, llamadas } = mockClaude(() => 'no debería llamarse');
  try {
    const texto = await redactarDescripcionActividad('SIN DESCRIPCION', '   ');
    assert.strictEqual(texto, null);
    assert.strictEqual(llamadas.length, 0);
  } finally {
    restore();
  }
});

test('si Claude falla, devuelve null en vez de lanzar', async () => {
  const original = axios.post;
  axios.post = async () => { throw new Error('boom'); };
  try {
    const texto = await redactarDescripcionActividad('FALLA', 'raw description');
    assert.strictEqual(texto, null);
  } finally {
    axios.post = original;
  }
});

test('reintenta en 429 antes de rendirse', async () => {
  const original = axios.post;
  let intentos = 0;
  axios.post = async () => {
    intentos++;
    if (intentos < 2) {
      const err = new Error('rate limited');
      err.response = { status: 429 };
      throw err;
    }
    return { data: { content: [{ type: 'text', text: 'ok tras reintento' }] } };
  };
  try {
    const texto = await redactarDescripcionActividad('REINTENTO', 'raw');
    assert.strictEqual(texto, 'ok tras reintento');
    assert.strictEqual(intentos, 2);
  } finally {
    axios.post = original;
  }
});

test('redactarDescripcionesEnLote respeta el tope de concurrencia y alinea resultados por posición', async () => {
  let simultaneas = 0;
  let maxSimultaneas = 0;
  const original = axios.post;
  axios.post = async (url, body) => {
    simultaneas++;
    maxSimultaneas = Math.max(maxSimultaneas, simultaneas);
    await new Promise((r) => setTimeout(r, 5));
    simultaneas--;
    const nombre = body.messages[0].content.match(/Compañía: (.+)/)[1];
    return { data: { content: [{ type: 'text', text: 'desc de ' + nombre }] } };
  };
  try {
    const items = Array.from({ length: 10 }, (_, i) => ({ nombre: 'EMPRESA ' + i, descCruda: 'raw ' + i }));
    const resultados = await redactarDescripcionesEnLote(items, 3);
    assert.strictEqual(resultados.length, 10);
    resultados.forEach((r, i) => assert.strictEqual(r, 'desc de EMPRESA ' + i));
    assert.ok(maxSimultaneas <= 3, 'superó el tope de concurrencia: ' + maxSimultaneas);
  } finally {
    axios.post = original;
  }
});

test('redactarDescripcionesEnLote devuelve null en la posición de un ítem sin descripción cruda, sin afectar a los demás', async () => {
  const { restore } = mockClaude((body) => {
    const nombre = body.messages[0].content.match(/Compañía: (.+)/)[1];
    return 'desc de ' + nombre;
  });
  try {
    const items = [
      { nombre: 'CON DESCRIPCION', descCruda: 'raw' },
      { nombre: 'SIN DESCRIPCION', descCruda: '' },
    ];
    const resultados = await redactarDescripcionesEnLote(items, 2);
    assert.strictEqual(resultados[0], 'desc de CON DESCRIPCION');
    assert.strictEqual(resultados[1], null);
  } finally {
    restore();
  }
});
```

- [ ] **Step 2: Correr los tests y confirmar que fallan**

Run: `cd frontend && node --test src/services/descripcionComparables.test.js`
Expected: FAIL — el módulo `./descripcionComparables.js` no existe todavía.

- [ ] **Step 3: Implementar el servicio**

Crear `frontend/src/services/descripcionComparables.js`:

```js
import axios from 'axios';

const MODELO_REDACCION = 'claude-haiku-4-5';

/* Traduce y redacta en español la descripción de negocio cruda de Capital IQ (normalmente
   en inglés) en un párrafo estilo Anexo B: qué hace la compañía, marcas/productos si el
   texto los trae, año de constitución y sede si aparecen. Nunca inventa lo que no está en
   el texto crudo. */
function promptRedaccion(nombre, descCruda) {
  return `Eres redactor de un Informe Local de Precios de Transferencia en Colombia.
Traduce y redacta en español, en un solo párrafo de entre 80 y 120 palabras, la descripción de
actividad económica de la siguiente compañía comparable, a partir de su descripción de negocio
cruda (normalmente en inglés, tomada de Capital IQ). Menciona qué hace la compañía, sus
productos o marcas relevantes si el texto los trae, y su año de constitución y sede si
aparecen. No inventes datos que no estén en el texto crudo. Devuelve SOLO el párrafo, sin
encabezados ni comillas.

Compañía: ${nombre}
Descripción cruda: ${descCruda}`;
}

function textoDeRespuesta(data) {
  const bloques = (data && data.content) || [];
  return bloques.map((b) => b.text || '').join('').trim();
}

/* Mismo patrón de reintento en 429 que postGeminiWithRetry de eeffParser.js. */
async function postClaudeWithRetry(payload, maxRetries = 3) {
  for (let intento = 1; intento <= maxRetries; intento++) {
    try {
      return await axios.post('/api/claude', payload);
    } catch (err) {
      const es429 = err.response && err.response.status === 429;
      if (es429 && intento < maxRetries) {
        await new Promise((r) => setTimeout(r, intento * 3000));
      } else {
        throw err;
      }
    }
  }
}

/* Nunca lanza: un fallo de IA en una comparable no debe tumbar el lote de las demás. */
export async function redactarDescripcionActividad(nombre, descCruda) {
  const cruda = String(descCruda || '').trim();
  if (!cruda) return null;
  try {
    const response = await postClaudeWithRetry({
      model: MODELO_REDACCION,
      max_tokens: 500,
      messages: [{ role: 'user', content: promptRedaccion(nombre, cruda) }],
    });
    const texto = textoDeRespuesta(response.data);
    return texto || null;
  } catch (err) {
    console.error('[descripcionComparables] no se pudo redactar la descripción de ' + nombre, err);
    return null;
  }
}

/* Tope de concurrencia para no disparar N llamadas a Claude a la vez cuando N es el número
   de comparables seleccionadas. */
async function conConcurrencia(items, trabajo, limite) {
  const resultados = new Array(items.length);
  let siguiente = 0;
  async function corredor() {
    while (siguiente < items.length) {
      const mio = siguiente++;
      resultados[mio] = await trabajo(items[mio], mio);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limite, items.length) }, corredor));
  return resultados;
}

export async function redactarDescripcionesEnLote(items, concurrencia = 4) {
  return conConcurrencia(
    items || [],
    (item) => redactarDescripcionActividad(item.nombre, item.descCruda),
    concurrencia
  );
}
```

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Run: `cd frontend && node --test src/services/descripcionComparables.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/descripcionComparables.js frontend/src/services/descripcionComparables.test.js
git commit -m "feat: servicio de redacción con IA de la descripción de actividad de comparables"
```

---

## Task 4: Disparar la redacción automática y el backfill en el motor de comparables

**Files:**
- Modify: `frontend/src/components/MotorComparables.jsx` (imports en la cabecera; `handleComparableEEFFUpload` línea 522-582; `handleCargaMasivaEEFF` línea 587-634; sección de render del Paso 4, junto a las líneas 1259-1302)

**Interfaces:**
- Consumes: `redactarDescripcionesEnLote` de `../services/descripcionComparables.js` (Task 3).
- Produces: cada fila de `comparables` con `desc` no vacío gana `descActividad` (string) automáticamente tras aplicársele un EEFF, si no lo tenía ya. Botón "Redactar descripciones pendientes" para backfill de estudios guardados antes de este cambio.

No hay test automatizado (mismo motivo que la Task 2: componente React sin arnés de testing en el repo). Se verifica con grep y con la prueba manual de la Task 7.

- [ ] **Step 1: Importar el servicio nuevo**

En `frontend/src/components/MotorComparables.jsx`, junto a la línea 8 (`import { parseEEFFComparableOCR, parseEEFFComparablesLote } from '../services/eeffParser';`), agregar:

```js
import { redactarDescripcionesEnLote } from '../services/descripcionComparables';
```

- [ ] **Step 2: Agregar el disparador de redacción y el estado del backfill**

Junto a la declaración de `uploadingEEFF`/`cargaEeff` (alrededor de la línea 65-70), agregar:

```js
  /* Descripciones de actividad pendientes de redactar con IA: solo para el botón de
     backfill del Paso 4 — el disparo automático tras cargar un EEFF no usa este estado. */
  const [redactandoDescripciones, setRedactandoDescripciones] = useState(false);
```

Después de la declaración de `aplicarEeffEnFila` (después de la línea 442, ya modificada en la Task 2), agregar la función que dispara la redacción:

```js
  /* Redacta con IA la descripción de actividad de las filas indicadas que tengan `desc`
     crudo y no tengan `descActividad` todavía. Es idempotente: si ya está redactada, no
     se repite la llamada. Usa el actualizador de `setComparables` para no pisar cambios
     de estado hechos mientras la llamada a la IA estaba en curso. */
  const redactarDescripcionesDeFilas = async (filasActuales, indices) => {
    const objetivos = [...new Set(indices)]
      .map((i) => ({ indice: i, fila: filasActuales[i] }))
      .filter(({ fila }) => fila && String(fila.desc || '').trim() && !fila.descActividad);
    if (!objetivos.length) return;

    const resultados = await redactarDescripcionesEnLote(
      objetivos.map(({ fila }) => ({ nombre: fila.name, descCruda: fila.desc }))
    );

    setComparables((prev) => {
      const copia = [...prev];
      objetivos.forEach(({ indice }, pos) => {
        if (resultados[pos] && copia[indice]) {
          copia[indice] = { ...copia[indice], descActividad: resultados[pos] };
        }
      });
      return copia;
    });
  };
```

- [ ] **Step 3: Disparar la redacción tras la carga de un solo EEFF**

En `handleComparableEEFFUpload`, justo después de `await publicarEeff(filas, [compIndex]);` (línea 558), agregar:

```js
      redactarDescripcionesDeFilas(filas, [compIndex]).catch((err) =>
        console.error('[MotorComparables] no se pudo redactar la descripción de actividad', err)
      );
```

- [ ] **Step 4: Disparar la redacción tras la carga masiva**

En `handleCargaMasivaEEFF`, justo después de `await publicarEeff(filas, aplicadas.map(a => a.indice));` (línea 627), agregar:

```js
        redactarDescripcionesDeFilas(filas, aplicadas.map((a) => a.indice)).catch((err) =>
          console.error('[MotorComparables] no se pudo redactar la descripción de actividad', err)
        );
```

- [ ] **Step 5: Botón de backfill para estudios ya guardados**

Después de la declaración de `redactarDescripcionesDeFilas`, agregar la función que arma el backfill:

```js
  const redactarDescripcionesPendientes = async () => {
    setRedactandoDescripciones(true);
    try {
      const indices = comparables
        .map((c, i) => (c.eeffVerificado && String(c.desc || '').trim() && !c.descActividad ? i : -1))
        .filter((i) => i >= 0);
      await redactarDescripcionesDeFilas(comparables, indices);
    } finally {
      setRedactandoDescripciones(false);
    }
  };
```

En el JSX, después del `</div>` que cierra el bloque "Buscar cifras ya cargadas por el equipo" (línea 1302, justo antes del comentario `{/* Qué se subió a la base tras una carga */}` de la línea 1304), agregar:

```jsx
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={redactarDescripcionesPendientes}
              disabled={redactandoDescripciones || !comparables.some((c) => c.eeffVerificado && c.desc && !c.descActividad)}
              className="flex items-center gap-2 text-xs font-semibold px-3 py-2 rounded-lg border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Redacta en español, con IA, la descripción de actividad de las comparables verificadas que todavía no la tienen"
            >
              <Sparkles className="w-4 h-4" />
              {redactandoDescripciones ? 'Redactando…' : 'Redactar descripciones pendientes'}
            </button>
          </div>
```

`Sparkles` ya está importado en la cabecera del archivo (línea 3), no requiere un import nuevo.

- [ ] **Step 6: Verificar con grep que no queda ninguna referencia rota**

Run: `cd frontend && grep -n "redactarDescripcion" src/components/MotorComparables.jsx`
Expected: las llamadas a `redactarDescripcionesDeFilas` (2), la definición de `redactarDescripcionesPendientes`, y el botón en el JSX — sin ningún nombre desalineado (p. ej. `redactarDescripcionesDeFilas` escrito distinto en algún punto).

- [ ] **Step 7: Levantar el build de Vite para descartar errores de sintaxis**

Run: `cd frontend && npm run build`
Expected: build exitoso, sin errores de compilación en `MotorComparables.jsx`.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/MotorComparables.jsx
git commit -m "feat: redactar automáticamente con IA la descripción de actividad de las comparables"
```

---

## Task 5: Generar las tres tablas del Anexo B por comparable

**Files:**
- Modify: `frontend/src/services/exactTemplateMapper.js` (agregar funciones nuevas cerca de `generarAnexoAHtml`, línea 422)
- Test: `frontend/src/services/exactTemplateMapper.test.js` (agregar tests nuevos al final del archivo)

**Interfaces:**
- Consumes: `fmt` (ya importado, línea 1), comparables con la forma `{ name, eeffVerificado, desc, descActividad, s, c, op, ar, inv, ap, eeffDatos }` (`eeffDatos` con las claves de la Task 1).
- Produces: `generarAnexoBHtml(study, year, wrap): string` y `reemplazarAnexoB(html, study, year, wrap): string`, mismo estilo de firma que `generarAnexoAHtml(study, year, wrap)` (línea 422).

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final de `frontend/src/services/exactTemplateMapper.test.js`:

```js
import { generarAnexoBHtml, reemplazarAnexoB } from './exactTemplateMapper.js';
```

(agregar `generarAnexoBHtml, reemplazarAnexoB` al import existente de la línea 3-6 del archivo, no crear un import duplicado)

```js
const comparableCompleta = {
  name: 'AKATSUKI INC.',
  eeffVerificado: true,
  desc: 'Akatsuki Inc. is engaged in the game, comic and other businesses.',
  descActividad: 'Akatsuki Inc. se dedica al juego y cómic en Japón.',
  s: 23652000000, c: 9954000000, op: 3916000000, ar: 4252000000, inv: 626000000, ap: 975500000,
  eeffDatos: {
    periodo: '2024',
    utilidad_bruta: 13698000000,
    gastos_operacionales: 9782000000,
    total_activos: 53337500000,
    propiedad_planta_equipo: 468500000,
    efectivo_y_equivalentes: 29670500000,
    gastos_investigacion_desarrollo: null,
    gastos_publicidad: null,
  },
};

test('genera las tres tablas de una comparable con EEFF verificado', () => {
  const study = { anio: 2025, comparables: [comparableCompleta] };
  const html = generarAnexoBHtml(study, 2025, (v) => v);

  assert.ok(html.includes('<strong>AKATSUKI INC.</strong>'));
  assert.ok(html.includes('Akatsuki Inc. se dedica al juego y cómic en Japón.'));
  assert.ok(html.includes('Ventas netas'));
  assert.ok(html.includes('23.652.000.000'));
  assert.ok(html.includes('Beneficio bruto'));
  assert.ok(html.includes('13.698.000.000'));
  assert.ok(html.includes('EPP neto promedio'));
  assert.ok(html.includes('468.500.000'));
  assert.ok(html.includes('Efectivo promedio y equivalentes de efectivo'));
  assert.ok(html.includes('29.670.500.000'));
  // Encabezado de columna con el período leído por el OCR, no el año fijo del estudio
  assert.ok(html.includes('<strong>2024</strong>'));
});

test('las filas de I+D y publicidad solo salen si la comparable las trae', () => {
  const conAmbas = {
    ...comparableCompleta,
    name: 'IGG INC.',
    eeffDatos: { ...comparableCompleta.eeffDatos, gastos_investigacion_desarrollo: 787408000, gastos_publicidad: 2754598000 },
  };
  const html = generarAnexoBHtml({ anio: 2025, comparables: [comparableCompleta, conAmbas] }, 2025, (v) => v);

  const bloqueAkatsuki = html.slice(0, html.indexOf('IGG INC.'));
  assert.ok(!bloqueAkatsuki.includes('Gastos de investigación y desarrollo'));
  assert.ok(!bloqueAkatsuki.includes('Gastos de publicidad'));

  assert.ok(html.includes('Gastos de investigación y desarrollo'));
  assert.ok(html.includes('787.408.000'));
  assert.ok(html.includes('Gastos de publicidad'));
  assert.ok(html.includes('2.754.598.000'));
});

test('un rubro sin dato sale con celda vacía, no con guion ni con cero', () => {
  const sinEfectivo = {
    ...comparableCompleta,
    eeffDatos: { ...comparableCompleta.eeffDatos, efectivo_y_equivalentes: null },
  };
  const html = generarAnexoBHtml({ anio: 2025, comparables: [sinEfectivo] }, 2025, (v) => v);
  // La fila es <tr>\n<td>\n<p>\nEfectivo promedio y equivalentes de efectivo\n</p>\n</td>\n<td>\n<p>\nVALOR\n</p>\n</td>\n</tr>
  // Con VALOR vacío, la segunda celda queda "<p>\n\n</p>" (sin guion ni cero entre las etiquetas).
  const inicioFila = html.indexOf('Efectivo promedio y equivalentes de efectivo');
  const finFila = html.indexOf('</tr>', inicioFila);
  const fila = html.slice(inicioFila, finFila);
  assert.ok(!fila.includes('—'), 'la celda no debería traer guion: ' + fila);
  assert.ok(!/<p>\s*0\s*<\/p>/.test(fila), 'la celda no debería traer un cero inventado: ' + fila);
  assert.ok(/<td>\s*<p>\s*<\/p>\s*<\/td>\s*<\/tr>$/.test(fila.trimEnd()), 'la celda del valor debería estar vacía: ' + fila);
});

test('sin comparables con EEFF verificado, sale el aviso de pendiente y no el ejemplo estático', () => {
  const html = generarAnexoBHtml({ anio: 2025, comparables: [{ name: 'SIN VERIFICAR', eeffVerificado: false }] }, 2025, (v) => v);
  assert.ok(html.includes('Pendiente'));
  assert.ok(!html.includes('AKATSUKI'));
  assert.ok(!html.includes('COLOPL'));
});

test('reemplazarAnexoB sustituye el bloque estático completo, entre su título y el de ANEXO C', () => {
  const fragmentoConEjemploEstatico =
    '<h1>\n<a id="_Toc208931006"></a>ANEXO B. Descripciones de comparables y Estados Financieros\n</h1>\n' +
    '<table><thead><tr><th>NOMBRE</th></tr></thead><tbody><tr><td>AKATSUKI INC.</td></tr></tbody></table>\n' +
    '<h1>\n<a id="_Toc456190765"></a><a id="_Toc208931007"></a>ANEXO C. Matriz de Rechazo\n</h1>\n<table>otra tabla</table>';

  const study = { anio: 2025, comparables: [comparableCompleta] };
  const salida = reemplazarAnexoB(fragmentoConEjemploEstatico, study, 2025, (v) => v);

  // El fragmento estático de prueba tiene "AKATSUKI INC." en una tabla sin descripción;
  // el reemplazo debe borrar esa tabla y dejar solo la comparable real (que en este test
  // se llama distinto: comparableCompleta también es "AKATSUKI INC.", pero con descripción
  // redactada) — la señal inequívoca es que la descripción redactada aparece.
  assert.ok(salida.includes('Akatsuki Inc. se dedica al juego y cómic en Japón.'));
  assert.ok(!salida.includes('<td>AKATSUKI INC.</td>'), 'sobrevivió la fila estática sin descripción');
  assert.ok(salida.includes('ANEXO C. Matriz de Rechazo'), 'se perdió el título de ANEXO C');
  assert.ok(salida.includes('otra tabla'), 'se perdió contenido de ANEXO C');
});
```

- [ ] **Step 2: Correr los tests y confirmar que fallan**

Run: `cd frontend && node --test src/services/exactTemplateMapper.test.js`
Expected: FAIL — `generarAnexoBHtml`/`reemplazarAnexoB` no existen todavía.

- [ ] **Step 3: Implementar `generarAnexoBHtml` y `reemplazarAnexoB`**

En `frontend/src/services/exactTemplateMapper.js`, agregar después de `generarAnexoAHtml` (después de la línea 450, antes del comentario de `hydrateExactWordTemplate` en la línea 452):

```js
/* ══════════════ ANEXO B. Descripciones de comparables y Estados Financieros ══════════════
   La plantilla trae cuatro compañías de videojuegos del informe de referencia (Akatsuki,
   Colopl, Fun Yours, IGG). Solo entran aquí las comparables con EEFF verificado: una fila
   con cifras a medio cargar y sin confirmar es peor que no mostrarla. */

const ANEXO_B_ETIQUETAS_PL = [
  { etiqueta: 'Ventas netas', valor: (c) => c.s },
  { etiqueta: 'Costo de los bienes vendidos', valor: (c) => c.c },
  { etiqueta: 'Beneficio bruto', valor: (c) => c.eeffDatos && c.eeffDatos.utilidad_bruta },
  { etiqueta: 'Gastos operativos', valor: (c) => c.eeffDatos && c.eeffDatos.gastos_operacionales },
  { etiqueta: 'Utilidad de operación', valor: (c) => c.op },
];

const ANEXO_B_ETIQUETAS_BALANCE = [
  { etiqueta: 'Activos totales promedio', valor: (c) => c.eeffDatos && c.eeffDatos.total_activos },
  { etiqueta: 'Promedio de cuentas por pagar netas', valor: (c) => c.ap },
  { etiqueta: 'Promedio de cuentas por cobrar netas', valor: (c) => c.ar },
  { etiqueta: 'EPP neto promedio', valor: (c) => c.eeffDatos && c.eeffDatos.propiedad_planta_equipo },
  { etiqueta: 'Inventario neto promedio', valor: (c) => c.inv },
  { etiqueta: 'Efectivo promedio y equivalentes de efectivo', valor: (c) => c.eeffDatos && c.eeffDatos.efectivo_y_equivalentes },
];

/* Filas opcionales de la tabla de P&L: no todas las comparables desglosan I+D o
   publicidad como línea propia (ver ejemplos reales: Akatsuki ninguna, Colopl solo
   publicidad, Fun Yours solo I+D, IGG ambas). Solo se agregan si el dato no es nulo. */
function filasOpcionalesPL(c) {
  const filas = [];
  const rd = c.eeffDatos && c.eeffDatos.gastos_investigacion_desarrollo;
  const adv = c.eeffDatos && c.eeffDatos.gastos_publicidad;
  if (rd !== null && rd !== undefined) filas.push({ etiqueta: 'Gastos de investigación y desarrollo', valor: () => rd });
  if (adv !== null && adv !== undefined) filas.push({ etiqueta: 'Gastos de publicidad', valor: () => adv });
  return filas;
}

/* Las tres tablas de una comparable. Celda vacía cuando falta el dato: a diferencia del
   resto del informe, aquí no se marca con «—» porque el usuario lo pidió así para esta
   sección en particular. */
function generarBloqueComparableAnexoB(comp, year, wrap) {
  const celdaCifra = (v) => (v === null || v === undefined || v === '' ? '' : wrap(fmt(v)));
  const anioCol = (comp.eeffDatos && comp.eeffDatos.periodo) || year;

  const filaTabla = (etiqueta, valor) =>
    `<tr>\n${celdaTabla(etiqueta)}\n${celdaTabla(celdaCifra(valor))}\n</tr>`;

  const tablaCifras = (filas) =>
    `<table>\n<thead>\n<tr>\n<th>\n<p>\n<strong>Descripción</strong>\n</p>\n</th>\n<th>\n<p>\n<strong>${anioCol}</strong>\n</p>\n</th>\n</tr>\n</thead>\n<tbody>\n${filas.join('\n')}\n</tbody>\n</table>`;

  const filasPL = [...ANEXO_B_ETIQUETAS_PL, ...filasOpcionalesPL(comp)]
    .map((f) => filaTabla(f.etiqueta, f.valor(comp)));
  const filasBalance = ANEXO_B_ETIQUETAS_BALANCE.map((f) => filaTabla(f.etiqueta, f.valor(comp)));

  const descripcion = comp.descActividad || comp.desc || 'Descripción de actividad no disponible.';

  const tablaNombreDescripcion =
    `<table>\n<thead>\n<tr>\n<th>\n<p>\n<strong>NOMBRE DE LA COMPAÑÍA COMPARABLE</strong>\n</p>\n</th>\n<th>\n<p>\n<strong>DESCRIPCIÓN ACTIVIDAD</strong>\n</p>\n</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n${celdaTabla('<strong>' + comp.name + '</strong>')}\n${celdaTabla(descripcion)}\n</tr>\n</tbody>\n</table>`;

  return tablaNombreDescripcion + '\n' + tablaCifras(filasPL) + '\n' + tablaCifras(filasBalance);
}

/* Cuerpo dinámico del ANEXO B. Sin ninguna comparable verificada devuelve el aviso de
   pendiente en vez de las cuatro compañías de videojuegos del informe de referencia. */
export function generarAnexoBHtml(study, year, wrap) {
  const comparables = ((study && study.comparables) || []).filter((c) => c && c.name && c.eeffVerificado);
  const titulo = '<h1>\n<a id="_Toc208931006"></a>ANEXO B. Descripciones de comparables y Estados Financieros\n</h1>\n';

  if (!comparables.length) {
    return titulo + '<p>\nPendiente: cargue y verifique los Estados Financieros de las comparables en el Paso 4 del motor de comparables.\n</p>\n';
  }

  return titulo + comparables.map((c) => generarBloqueComparableAnexoB(c, year, wrap)).join('\n') + '\n';
}

/* Sustituye todo el bloque de ANEXO B, desde su título hasta (sin incluirlo) el título de
   ANEXO C. Se ubica por `indexOf` del id de cada uno y no con una sola regex de tramo largo:
   el `<h1>` de ANEXO C trae varios id de Word apilados antes del suyo (anclas de referencias
   cruzadas de versiones previas del documento), y anclar con una regex rígida sobre esa forma
   se rompería si cambia cuántos id se apilan. */
export function reemplazarAnexoB(html, study, year, wrap) {
  const posIdB = html.indexOf('id="_Toc208931006"');
  if (posIdB < 0) return html;
  const inicioH1 = html.lastIndexOf('<h1>', posIdB);
  if (inicioH1 < 0) return html;

  const posIdC = html.indexOf('id="_Toc208931007"', posIdB);
  if (posIdC < 0) return html;
  const finH1 = html.lastIndexOf('<h1>', posIdC);
  if (finH1 < 0 || finH1 <= inicioH1) return html;

  return html.slice(0, inicioH1) + generarAnexoBHtml(study, year, wrap) + html.slice(finH1);
}
```

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Run: `cd frontend && node --test src/services/exactTemplateMapper.test.js`
Expected: PASS en todos los tests del archivo, incluidos los nuevos.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/exactTemplateMapper.js frontend/src/services/exactTemplateMapper.test.js
git commit -m "feat: generar el ANEXO B dinámicamente a partir de las comparables verificadas"
```

---

## Task 6: Conectar el Anexo B a la hidratación completa del Word

**Files:**
- Modify: `frontend/src/services/exactTemplateMapper.js:658-660` (dentro de `hydrateExactWordTemplate`)
- Test: `frontend/src/services/exactTemplateMapper.test.js`

**Interfaces:**
- Consumes: `reemplazarAnexoB` (Task 5), `year` y `wrap` ya calculados dentro de `hydrateExactWordTemplate` (líneas 465 y 479).

- [ ] **Step 1: Escribir el test que falla**

Agregar a `frontend/src/services/exactTemplateMapper.test.js`:

```js
test('hydrateExactWordTemplate reemplaza el ANEXO B completo con las comparables del estudio activo, no las de End Game', () => {
  const estudio = {
    ent: 'ACME COLOMBIA S.A.S', nit: '800123456-7', anio: 2025,
    comparables: [{
      name: 'DISTRIBUIDORA ANDINA S.A.',
      eeffVerificado: true,
      desc: 'Distributes consumer goods across the Andean region.',
      descActividad: 'Distribuidora Andina S.A. distribuye bienes de consumo en la región andina.',
      s: 1000000, c: 400000, op: 100000, ar: 50000, inv: 30000, ap: 20000,
      eeffDatos: { periodo: '2025', utilidad_bruta: 600000, gastos_operacionales: 500000, total_activos: 900000, propiedad_planta_equipo: 200000, efectivo_y_equivalentes: 150000, gastos_investigacion_desarrollo: null, gastos_publicidad: null },
    }],
  };

  const salida = hydrateExactWordTemplate(MASTER_WORD_TEMPLATE, estudio);

  assert.ok(!salida.includes('AKATSUKI'), 'sobrevivió una comparable del informe de referencia');
  assert.ok(!salida.includes('COLOPL'), 'sobrevivió una comparable del informe de referencia');
  assert.ok(!salida.includes('FUN YOURS'), 'sobrevivió una comparable del informe de referencia');
  assert.ok(!salida.includes('IGG INC'), 'sobrevivió una comparable del informe de referencia');
  assert.ok(salida.includes('DISTRIBUIDORA ANDINA S.A.'), 'no entró la comparable del estudio activo');
  assert.ok(salida.includes('Distribuidora Andina S.A. distribuye bienes de consumo en la región andina.'));
  assert.ok(salida.includes('ANEXO C. Matriz de Rechazo'), 'se perdió el título de ANEXO C tras el reemplazo');
});
```

- [ ] **Step 2: Correr el test y confirmar que falla**

Run: `cd frontend && node --test src/services/exactTemplateMapper.test.js`
Expected: FAIL — `AKATSUKI`/`COLOPL`/etc. siguen en la salida porque `hydrateExactWordTemplate` todavía no llama a `reemplazarAnexoB`.

- [ ] **Step 3: Conectar `reemplazarAnexoB` en `hydrateExactWordTemplate`**

En `frontend/src/services/exactTemplateMapper.js`, justo después de la línea 660 (`html = html.replace(rxAnexoABody, () => generarAnexoAHtml(study, year, wrap));`), agregar:

```js
  /* ─── ANEXO B: Descripciones de comparables y Estados Financieros ─── */
  html = reemplazarAnexoB(html, study, year, wrap);
```

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Run: `cd frontend && node --test src/services/exactTemplateMapper.test.js`
Expected: PASS en todos los tests del archivo.

- [ ] **Step 5: Correr toda la suite de `frontend/src/services` para descartar regresiones**

Run: `cd frontend && node --test src/services/*.test.js`
Expected: PASS en todos los archivos.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/services/exactTemplateMapper.js frontend/src/services/exactTemplateMapper.test.js
git commit -m "feat: conectar el ANEXO B dinámico a la hidratación completa del Word"
```

---

## Task 7: Verificación manual end-to-end en el navegador

**Files:** ninguno (solo verificación, sin cambios de código)

Según el CLAUDE.md del repo, la aplicación no tiene tests de UI: la verificación de un cambio en `frontend/` es (a) grep de que ningún símbolo eliminado siga referenciado, y (b) prueba manual en el navegador. Las Tasks 1-6 ya corrieron su grep/build; esta Task cubre la (b).

- [ ] **Step 1: Levantar el servidor de desarrollo**

Run: `cd frontend && npm run dev`
Expected: Vite arranca en un puerto local (revisar la salida de la consola) con proxy `/api` hacia `:3000` — si `server.js` no está corriendo en paralelo, las llamadas a `/api/gemini` y `/api/claude` van a fallar; levantarlo también con `npm start` desde la raíz del repo en otra terminal si se quiere probar la ingesta real.

- [ ] **Step 2: Abrir un estudio y llegar al motor de comparables**

En el navegador, abrir `/gestor-reportes/`, crear o abrir un estudio, y navegar hasta el componente `MotorComparables` (Paso 4: Ingestar EEFF de Comparables).

- [ ] **Step 3: Verificar el flujo de importación y selección**

Importar un universo de Capital IQ (o usar datos de prueba) y ejecutar la selección de comparables, para tener filas en `comparables` con `desc` cargado desde el universo.

- [ ] **Step 4: Cargar un EEFF de una comparable y observar la redacción automática**

Subir un PDF de estado financiero para una de las comparables seleccionadas (carga individual o masiva). Confirmar en la fila de la tabla del Paso 4 que, tras quedar `eeffVerificado`, aparece observable indirectamente el efecto (no hay indicador visual explícito de "descripción redactada" en esta entrega — confirmar en la consola del navegador que no hay errores de `[MotorComparables] no se pudo redactar...`, y más adelante, en el Word exportado, que la descripción no es la cruda de Capital IQ sino un párrafo en español).

- [ ] **Step 5: Probar el botón de backfill**

Si se dispone de un estudio guardado antes de este cambio (con `eeffVerificado: true` pero sin `descActividad`), hacer clic en "Redactar descripciones pendientes" y confirmar que el botón se deshabilita mientras corre y que, al terminar, las descripciones quedan disponibles.

- [ ] **Step 6: Generar el Word y revisar el Anexo B**

Desde `ReporteGenerador.jsx`, generar y descargar el Word del estudio. Abrir el `.doc` y confirmar:
- El Anexo B trae únicamente las comparables con EEFF verificado del estudio activo (no Akatsuki/Colopl/Fun Yours/IGG).
- Cada compañía trae sus tres tablas (nombre/descripción, P&L, balance) con el mismo formato visual que la plantilla original.
- Las filas de "Gastos de investigación y desarrollo"/"Gastos de publicidad" solo aparecen si esa comparable trae el dato.
- Un rubro sin dato sale con la celda vacía, no con "0" ni con "—".

- [ ] **Step 7: Probar el caso sin comparables verificadas**

En un estudio nuevo, sin cargar ningún EEFF de comparables, generar el Word y confirmar que el Anexo B muestra el aviso de "Pendiente: cargue y verifique los Estados Financieros..." en vez de cualquier compañía de ejemplo.

- [ ] **Step 8: Reportar resultados**

Si algún paso no se pudo verificar (p. ej. no hay PDF de prueba disponible, o no hay estudio antiguo para probar el backfill), decirlo explícitamente en vez de asumir que pasó — según el CLAUDE.md, no afirmar éxito sin haber corrido la verificación real.
