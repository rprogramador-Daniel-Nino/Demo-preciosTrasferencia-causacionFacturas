# Fallback a notas para EEFF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cuando la lectura de un EEFF del contribuyente deja costo de ventas, cuentas por
cobrar/pagar a partes relacionadas o inventarios en `null`, el sistema decide —antes de
rendirse con un aviso genérico— si vale la pena una pasada angosta de IA a las notas del
documento, aprende con el tiempo qué vocabulario usa cada concepto para no tener que volver
a preguntarle a la IA, y le muestra al analista un popup claro con lo que de verdad falta y
por qué, para que sepa si tiene que pedirle algo al cliente.

**Architecture:** Tres piezas nuevas y puras (`vocabularioEeff.js`,
`notasEeffOrquestacion.js`, y extensiones a `eeffVerificacion.js`/`eeffParser.js`) que se
insertan entre la lectura de Gemini (`parseEeffWithGeminiOCR`, ya existente) y la UI
(`IngestaCifras.jsx`). La orquestación decide en tres ramas — diccionario maduro → cantidad
de páginas → nada — si dispara la pasada angosta, todo con dependencias inyectables para
poder probarlo sin red ni Firestore real.

**Tech Stack:** React 19 (frontend/), Firestore (colección nueva sin scoping por `uid`),
Gemini vía el proxy `/api/gemini` ya existente, `node --test` para pruebas unitarias.

**Spec:** `docs/superpowers/specs/2026-08-25-fallback-notas-utilidad-operacional-design.md`

## Global Constraints

- Código, comentarios y UI en español (CLAUDE.md).
- Ninguna llamada a Firestore ni a `/api/gemini` desde código "puro": la lógica de negocio
  (qué campo falta, si el diccionario decide, cómo se fusiona un hallazgo) vive en
  funciones puras y testeables; el I/O se inyecta como dependencia con un valor por
  defecto — mismo patrón que ya usa `extraerTextoPdf(file, { getDocument })`.
- Los cuatro campos con fallback a notas son exactamente `t_c`, `t_ar`, `t_ap`, `t_inv`
  (`CAMPOS_CON_FALLBACK_NOTAS` en `eeffParser.js`) — no todo `LEIDOS`: los demás
  (`t_s`, `t_act_curr`, `t_act_tot`, `t_ppe`) son cifras que un balance colombiano siempre
  imprime en su cuerpo principal, sin precedente real de vivir solo en una nota.
- Umbral de madurez del diccionario: `UMBRAL_MADUREZ = 20` estudios seguidos sin aportar
  palabra nueva (constante exportada, ajustable).
- Umbral de páginas para intentar la pasada angosta: `> 6` páginas.
- `firestore.rules`: la colección `vocabularioEeff/{campo}` es la primera de la app sin
  scoping por `uid` — lectura/escritura para cualquier usuario autenticado
  (`esMiembro()`), validada con una función `vocabularioEeffValido`, mismo criterio que
  `narrativaMacroPorEstudio`.
- `npm test` debe seguir en 100 % verde después de cada tarea.

---

### Task 1: `contarPaginasPdf` en `eeffTextoPdf.js`

**Files:**
- Modify: `frontend/src/services/eeffTextoPdf.js`
- Test: `frontend/src/services/eeffTextoPdf.test.js`

**Interfaces:**
- Produces: `contarPaginasPdf(file, { getDocument } = {}) => Promise<number>` — 0 si el
  archivo es null, no se puede abrir, o pdf.js falla; 1 para una imagen; `doc.numPages`
  para un PDF.

- [ ] **Step 1: Escribir la prueba que falla**

Añadir al final de `frontend/src/services/eeffTextoPdf.test.js` (después del último
`test(...)` del archivo, antes de que termine el módulo):

```js
/* ══════ Cuántas páginas trae el PDF ══════
   Sirve para decidir si vale la pena una pasada angosta a las notas: un documento con
   pocas páginas (el escaneo de 5 de LATV) casi seguro no las trae. */

test('contarPaginasPdf cuenta las páginas de un PDF con texto', async () => {
  const archivo = { type: 'application/pdf', name: 'eeff.pdf', arrayBuffer: async () => new ArrayBuffer(8) };
  const paginas = await contarPaginasPdf(archivo, {
    getDocument: () => ({ promise: Promise.resolve({ numPages: 23 }) }),
  });
  assert.strictEqual(paginas, 23);
});

test('contarPaginasPdf devuelve 1 para una imagen', async () => {
  const archivo = { type: 'image/png', name: 'balance.png', arrayBuffer: async () => { throw new Error('no debería llegar aquí'); } };
  assert.strictEqual(await contarPaginasPdf(archivo), 1);
});

test('contarPaginasPdf devuelve 0 si pdf.js no puede abrirlo', async () => {
  const archivo = { type: 'application/pdf', name: 'roto.pdf', arrayBuffer: async () => new ArrayBuffer(8) };
  const paginas = await contarPaginasPdf(archivo, {
    getDocument: () => ({ promise: Promise.reject(new Error('formato inválido')) }),
  });
  assert.strictEqual(paginas, 0);
});

test('contarPaginasPdf devuelve 0 sin archivo', async () => {
  assert.strictEqual(await contarPaginasPdf(null), 0);
});
```

Y ajustar el `import` del principio del archivo:

```js
import {
  agruparEnLineas, cifrasDelTexto, cifraApareceEnTexto, extraerTextoPdf, textoEsConfiable,
  contarPaginasPdf,
} from './eeffTextoPdf.js';
```

- [ ] **Step 2: Correr la prueba y confirmar que falla**

Run: `node --test frontend/src/services/eeffTextoPdf.test.js`
Expected: FAIL — `contarPaginasPdf is not a function` (o `undefined`).

- [ ] **Step 3: Implementar `contarPaginasPdf`**

En `frontend/src/services/eeffTextoPdf.js`, justo antes de `export async function
extraerTextoPdf(...)`:

```js
/**
 * Cuántas páginas trae el PDF, o 1 para una imagen y 0 si no se puede abrir.
 *
 * Sirve para decidir si vale la pena una pasada angosta a las notas del documento: un
 * archivo corto (el escaneo de 5 páginas de LATV, por ejemplo) casi seguro no las trae, y
 * preguntarle a Gemini de todas formas solo gastaría la llamada en vano.
 */
export async function contarPaginasPdf(file, { getDocument = pdfjs.getDocument } = {}) {
  if (!file) return 0;
  if (file.type && file.type.startsWith('image/')) return 1;

  try {
    const arrayBuffer = await file.arrayBuffer();
    const doc = await getDocument({
      data: new Uint8Array(arrayBuffer),
      isOffscreenCanvasSupported: false,
    }).promise;
    return doc.numPages;
  } catch (err) {
    console.warn('[contarPaginasPdf] no se pudo abrir el documento:', err && err.message);
    return 0;
  }
}
```

- [ ] **Step 4: Correr la prueba y confirmar que pasa**

Run: `node --test frontend/src/services/eeffTextoPdf.test.js`
Expected: PASS — todas las pruebas del archivo, incluidas las 4 nuevas.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/eeffTextoPdf.js frontend/src/services/eeffTextoPdf.test.js
git commit -m "feat: contar páginas de un PDF para decidir si buscar notas"
```

---

### Task 2: `services/vocabularioEeff.js` — el diccionario, puro

**Files:**
- Create: `frontend/src/services/vocabularioEeff.js`
- Test: `frontend/src/services/vocabularioEeff.test.js`

**Interfaces:**
- Produces:
  - `UMBRAL_MADUREZ` (número, 20)
  - `diccionarioVacio() => { palabras: string[], estudiosSinPalabraNueva: number }`
  - `normalizarPalabra(palabra) => string`
  - `esMaduro(diccionario, umbral = UMBRAL_MADUREZ) => boolean`
  - `contienePalabraConocida(texto, diccionario) => boolean`
  - `agregarPalabras(diccionario, palabrasNuevas) => diccionario` (nuevo objeto, no muta)

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `frontend/src/services/vocabularioEeff.test.js`:

```js
/* Pruebas del diccionario compartido de vocabulario para los campos de EEFF que pueden
   desglosarse solo en una nota (costo de ventas, partes relacionadas, inventarios). Puro:
   sin Firestore — eso vive en firestoreRepo.js. */

import { test } from 'node:test';
import assert from 'node:assert';
import {
  UMBRAL_MADUREZ, diccionarioVacio, normalizarPalabra, esMaduro, contienePalabraConocida,
  agregarPalabras,
} from './vocabularioEeff.js';

test('un diccionario vacío no tiene palabras ni madurez', () => {
  assert.deepStrictEqual(diccionarioVacio(), { palabras: [], estudiosSinPalabraNueva: 0 });
});

test('normaliza minúsculas, tildes y espacios de más', () => {
  assert.strictEqual(normalizarPalabra('  Relacionadas  '), 'relacionadas');
  assert.strictEqual(normalizarPalabra('VINCULADAS ECONÓMICAS'), 'vinculadas economicas');
});

test('normalizarPalabra de algo vacío es cadena vacía, no lanza', () => {
  assert.strictEqual(normalizarPalabra(null), '');
  assert.strictEqual(normalizarPalabra(undefined), '');
});

test('un diccionario nuevo (contador en 0) no es maduro', () => {
  assert.strictEqual(esMaduro(diccionarioVacio()), false);
});

test('un diccionario con el contador por debajo del umbral no es maduro', () => {
  assert.strictEqual(esMaduro({ palabras: ['relacionadas'], estudiosSinPalabraNueva: UMBRAL_MADUREZ - 1 }), false);
});

test('un diccionario con el contador en el umbral (o más) sí es maduro', () => {
  assert.strictEqual(esMaduro({ palabras: ['relacionadas'], estudiosSinPalabraNueva: UMBRAL_MADUREZ }), true);
  assert.strictEqual(esMaduro({ palabras: ['relacionadas'], estudiosSinPalabraNueva: UMBRAL_MADUREZ + 5 }), true);
});

test('esMaduro admite un umbral distinto, para poder probar sin esperar 20', () => {
  assert.strictEqual(esMaduro({ palabras: [], estudiosSinPalabraNueva: 2 }, 2), true);
});

test('contienePalabraConocida encuentra una palabra del diccionario en el texto, sin importar mayúsculas', () => {
  const diccionario = { palabras: ['vinculadas economicas', 'matriz'], estudiosSinPalabraNueva: 30 };
  assert.strictEqual(contienePalabraConocida('Cuentas por pagar a VINCULADAS ECONÓMICAS', diccionario), true);
});

test('contienePalabraConocida no encuentra nada si ninguna palabra aparece', () => {
  const diccionario = { palabras: ['vinculadas economicas', 'matriz'], estudiosSinPalabraNueva: 30 };
  assert.strictEqual(contienePalabraConocida('Cuentas por pagar comerciales y otras cuentas por pagar', diccionario), false);
});

test('contienePalabraConocida con texto vacío o diccionario vacío no lanza y da false', () => {
  assert.strictEqual(contienePalabraConocida('', diccionarioVacio()), false);
  assert.strictEqual(contienePalabraConocida('algo', diccionarioVacio()), false);
  assert.strictEqual(contienePalabraConocida(null, { palabras: ['x'], estudiosSinPalabraNueva: 5 }), false);
});

test('agregarPalabras con una palabra nueva la agrega y resetea el contador', () => {
  const previo = { palabras: ['matriz'], estudiosSinPalabraNueva: 15 };
  const actualizado = agregarPalabras(previo, ['Subsidiaria']);
  assert.deepStrictEqual(actualizado.palabras, ['matriz', 'subsidiaria']);
  assert.strictEqual(actualizado.estudiosSinPalabraNueva, 0);
});

test('agregarPalabras con una palabra ya conocida solo incrementa el contador', () => {
  const previo = { palabras: ['matriz'], estudiosSinPalabraNueva: 15 };
  const actualizado = agregarPalabras(previo, ['Matriz']);
  assert.deepStrictEqual(actualizado.palabras, ['matriz']);
  assert.strictEqual(actualizado.estudiosSinPalabraNueva, 16);
});

test('agregarPalabras no muta el diccionario original', () => {
  const previo = { palabras: ['matriz'], estudiosSinPalabraNueva: 15 };
  agregarPalabras(previo, ['nueva']);
  assert.deepStrictEqual(previo, { palabras: ['matriz'], estudiosSinPalabraNueva: 15 });
});

test('agregarPalabras sobre un diccionario nulo arranca de uno vacío', () => {
  const actualizado = agregarPalabras(null, ['matriz']);
  assert.deepStrictEqual(actualizado, { palabras: ['matriz'], estudiosSinPalabraNueva: 0 });
});

test('agregarPalabras con lista vacía o nula solo incrementa el contador', () => {
  const previo = { palabras: ['matriz'], estudiosSinPalabraNueva: 3 };
  assert.strictEqual(agregarPalabras(previo, []).estudiosSinPalabraNueva, 4);
  assert.strictEqual(agregarPalabras(previo, null).estudiosSinPalabraNueva, 4);
});
```

- [ ] **Step 2: Correr las pruebas y confirmar que fallan**

Run: `node --test frontend/src/services/vocabularioEeff.test.js`
Expected: FAIL — `Cannot find module './vocabularioEeff.js'`.

- [ ] **Step 3: Implementar `vocabularioEeff.js`**

Crear `frontend/src/services/vocabularioEeff.js`:

```js
/* ─────────────────────────────────────────────────────────────────────────────
   El diccionario compartido de vocabulario para los campos de EEFF que pueden
   desglosarse solo en una nota — o no existir en el documento en absoluto: costo de
   ventas, cuentas por cobrar/pagar a partes relacionadas, inventarios.

   Cada campo aprende, con el tiempo, qué palabras usa un documento real para referirse a
   ese concepto (ver `agregarPalabras`), y solo se le confía la decisión de "esto no está
   en ninguna parte, ni vale la pena preguntarle a la IA" cuando lleva muchos estudios
   seguidos sin aportar una palabra nueva (`esMaduro`) — antes de eso, la pasada angosta a
   Gemini sigue corriendo igual que si el diccionario no existiera.

   Puro: sin Firestore, sin red. El acceso a la nube vive en `firestoreRepo.js`.
   Ver docs/superpowers/specs/2026-08-25-fallback-notas-utilidad-operacional-design.md.
   ───────────────────────────────────────────────────────────────────────────── */

/* Cuántos estudios seguidos sin aportar una palabra nueva hacen falta para confiar en el
   diccionario y saltarse la pasada angosta. Arranca conservador a propósito: un diccionario
   que decide solo, mientras todavía puede estar incompleto, repite el error de un
   vocabulario fijo de un solo cliente (ver el defecto D5 del spec de 2026-08-21), esta vez
   por incompletitud en vez de por diseño fijo. */
export const UMBRAL_MADUREZ = 20;

export function diccionarioVacio() {
  return { palabras: [], estudiosSinPalabraNueva: 0 };
}

/** minúsculas, sin tildes, sin espacios de más — para que «Relacionadas» y
 *  «relacionadas  » cuenten como la misma palabra del diccionario. */
export function normalizarPalabra(palabra) {
  return String(palabra || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ');
}

export function esMaduro(diccionario, umbral = UMBRAL_MADUREZ) {
  return Boolean(diccionario) && (diccionario.estudiosSinPalabraNueva || 0) >= umbral;
}

/** ¿Aparece alguna palabra del diccionario en el texto completo del documento? Insensible
 *  a mayúsculas y tildes, igual que `normalizarPalabra`. */
export function contienePalabraConocida(texto, diccionario) {
  const normalizado = normalizarPalabra(texto);
  if (!normalizado) return false;
  const palabras = (diccionario && diccionario.palabras) || [];
  return palabras.some((p) => p && normalizado.includes(p));
}

/**
 * Agrega palabras nuevas al diccionario. Si ninguna es nueva, solo incrementa el contador
 * de madurez; si alguna sí lo es, se agrega y el contador vuelve a cero — un diccionario
 * que sigue aprendiendo no está maduro todavía. No muta el diccionario recibido.
 */
export function agregarPalabras(diccionario, palabrasNuevas) {
  const base = diccionario || diccionarioVacio();
  const normalizadas = Array.from(new Set(
    (palabrasNuevas || []).map(normalizarPalabra).filter(Boolean),
  ));
  const yaConocidas = new Set(base.palabras || []);
  const nuevas = normalizadas.filter((p) => !yaConocidas.has(p));

  if (nuevas.length === 0) {
    return { ...base, estudiosSinPalabraNueva: (base.estudiosSinPalabraNueva || 0) + 1 };
  }
  return {
    palabras: [...(base.palabras || []), ...nuevas],
    estudiosSinPalabraNueva: 0,
  };
}
```

- [ ] **Step 4: Correr las pruebas y confirmar que pasan**

Run: `node --test frontend/src/services/vocabularioEeff.test.js`
Expected: PASS — las 15 pruebas.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/vocabularioEeff.js frontend/src/services/vocabularioEeff.test.js
git commit -m "feat: diccionario compartido de vocabulario para campos de EEFF"
```

---

### Task 3: Firestore — colección `vocabularioEeff` (regla + repo)

**Files:**
- Modify: `firestore.rules`
- Modify: `frontend/src/services/firestoreRepo.js`

**Interfaces:**
- Consumes: `diccionarioVacio()` de `vocabularioEeff.js` (Task 2)
- Produces:
  - `leerVocabularioEeff(campo) => Promise<{ palabras, estudiosSinPalabraNueva }>`
  - `guardarVocabularioEeff(campo, diccionario) => Promise<void>`

No lleva prueba unitaria propia — `firestoreRepo.js` no las tiene (ver su comentario de
cabecera: la lógica que sí se prueba vive en el módulo puro, aquí solo se traduce a
llamadas del SDK). Mismo criterio que `leerAnalisisSector`/`guardarNarrativaMacroEstudio`,
que tampoco las tienen.

- [ ] **Step 1: Añadir la regla en `firestore.rules`**

Justo después del bloque `narrativaMacroValida` (busca la función, alrededor de la línea
246, termina en `&& d.narrativa is map;\n    }`), añadir la función de validación:

```
    // `guardarVocabularioEeff` (firestoreRepo.js) siempre escribe el documento completo
    // con `setDoc`, con estos dos campos y ningún otro.
    function vocabularioEeffValido(d) {
      return soloEstosCampos(['palabras', 'estudiosSinPalabraNueva'])
        && tieneTodos(['palabras', 'estudiosSinPalabraNueva'])
        && d.palabras is list && d.palabras.size() <= 200
        && d.estudiosSinPalabraNueva is number && d.estudiosSinPalabraNueva >= 0;
    }
```

Y, justo después del bloque `match /narrativaMacroPorEstudio/{estudioId} { ... }` (busca
ese bloque completo, termina en la línea con `narrativaMacroValida(request.resource.data);`
seguida de `}`), añadir el bloque de la colección nueva:

```
    // =============================================================
    // vocabularioEeff — diccionario compartido de sinónimos por campo de EEFF
    // (costo de ventas, partes relacionadas, inventarios), que aprende de cada
    // estudio para decidir cuándo ya no hace falta preguntarle a la IA si un
    // concepto está ausente. Dato compartido entre todos los consultores, no
    // por usuario ni por cliente — mismo criterio que analisisMercado y
    // analisisSector, salvo que aquí SÍ escribe el cliente directamente.
    // =============================================================

    match /vocabularioEeff/{campo} {
      allow read: if esMiembro();
      allow write: if esMiembro() && vocabularioEeffValido(request.resource.data);
    }
```

- [ ] **Step 2: Añadir las funciones en `firestoreRepo.js`**

Al principio del archivo, añadir el import de `diccionarioVacio`:

```js
import { diccionarioVacio } from './vocabularioEeff';
```

Y, después del bloque `/* ══════════════════════ análisis de mercado (Sección III) ══════════════════════ */`
completo (después de `guardarNarrativaMacroEstudio`, antes de
`/* ══════════════════════ migraciones ══════════════════════ */`), añadir:

```js
/* ══════════════════════ vocabulario de EEFF (diccionario compartido) ══════════════════════ */

const VOCABULARIO_EEFF = 'vocabularioEeff';

/** El diccionario compartido de un campo (costo de ventas, partes relacionadas,
 *  inventarios), o uno vacío si nunca se ha escrito. Dato compartido entre todos los
 *  consultores, igual que `analisisSector` — no pasa por `usuarios/{uid}`. */
export async function leerVocabularioEeff(campo) {
  const instantanea = await getDoc(doc(db, VOCABULARIO_EEFF, campo));
  return instantanea.exists() ? instantanea.data() : diccionarioVacio();
}

export async function guardarVocabularioEeff(campo, diccionario) {
  await setDoc(doc(db, VOCABULARIO_EEFF, campo), diccionario);
}
```

- [ ] **Step 3: Verificar que el archivo sigue siendo válido JS**

Run: `node --check frontend/src/services/firestoreRepo.js`
Expected: sin salida (sale limpio).

- [ ] **Step 4: Correr la suite completa (nada de esto tiene prueba propia, pero no debe romper nada)**

Run: `node --test scripts/lib/*.test.js frontend/src/services/*.test.js frontend/src/utils/*.test.js functions/*.test.js`
Expected: PASS — mismo conteo que antes de esta tarea, sin fallos nuevos.

- [ ] **Step 5: Commit**

```bash
git add firestore.rules frontend/src/services/firestoreRepo.js
git commit -m "feat: colección Firestore compartida para el diccionario de vocabulario de EEFF"
```

---

### Task 4: `eeffVerificacion.js` — costo implícito en cero y estados por campo

**Files:**
- Modify: `frontend/src/services/eeffVerificacion.js`
- Test: `frontend/src/services/eeffVerificacion.test.js`

**Interfaces:**
- Consumes: nada nuevo (mismos imports).
- Produces: `verificarEeff(...).advertencias` — cada advertencia con `campo` en
  `['t_c', 't_ar', 't_ap', 't_inv']` trae ahora un `estado` (`'implicito_cero'` o
  `'no_verificado'`), y aparece una nueva advertencia `tipo: 'sin-costo-de-ventas'` cuando
  `campos.t_c` es `null`.

- [ ] **Step 1: Escribir las pruebas que fallan**

Añadir al final de `frontend/src/services/eeffVerificacion.test.js`:

```js
/* ══════ Costo de ventas ausente: implícito en cero, o genuinamente sin dato ══════
   Caso real: LATV Sucursal Colombia (2026-08-25). Su Estado de Resultados imprime
   Utilidad Bruta == Ingresos, sin línea de Costo de Ventas en ningún lado del documento
   (ni en sus notas) — el propio estado está afirmando que el costo es cero, no que sea
   desconocido. */

test('sin costo de ventas se avisa con su propio tipo, con campo t_c', () => {
  const r = verificar({ t_c: null });
  const a = r.advertencias.find((x) => x.tipo === 'sin-costo-de-ventas');
  assert.ok(a, 'debe haber una advertencia dedicada al costo de ventas');
  assert.strictEqual(a.campo, 't_c');
});

test('si la utilidad bruta impresa es igual a los ingresos, el costo ausente es "implicito_cero"', () => {
  const r = verificar({
    t_c: null,
    cotejo: { gastos_ventas: -2409923291, gastos_administracion: -572260813, utilidad_bruta: 23741367744 },
  });
  const a = r.advertencias.find((x) => x.tipo === 'sin-costo-de-ventas');
  assert.strictEqual(a.estado, 'implicito_cero');
  assert.match(a.mensaje, /cero/);
});

test('si la utilidad bruta impresa NO es igual a los ingresos, el costo ausente queda "no_verificado"', () => {
  const r = verificar({ t_c: null }); // LECTURA.cotejo.utilidad_bruta = 1.891.180.250, distinto de t_s
  const a = r.advertencias.find((x) => x.tipo === 'sin-costo-de-ventas');
  assert.strictEqual(a.estado, 'no_verificado');
});

test('sin utilidad bruta impresa, el costo ausente tampoco es implicito_cero', () => {
  const r = verificar({ t_c: null, cotejo: { ...LECTURA.cotejo, utilidad_bruta: null } });
  const a = r.advertencias.find((x) => x.tipo === 'sin-costo-de-ventas');
  assert.strictEqual(a.estado, 'no_verificado');
});

test('el costo implícito en cero NO se asigna solo: t_c sigue en null', () => {
  const r = verificar({
    t_c: null,
    cotejo: { gastos_ventas: -2409923291, gastos_administracion: -572260813, utilidad_bruta: 23741367744 },
  });
  assert.strictEqual(r.campos.t_c, null, 'se sugiere, no se asigna — el analista decide');
});

/* ══════ Estado por campo en las advertencias ya existentes ══════ */

test('las advertencias de partes relacionadas e inventarios llevan estado "no_verificado" por defecto', () => {
  const r = verificar({ t_ap: null, t_ar: null, t_inv: null });
  ['t_ap', 't_ar'].forEach((campo) => {
    const a = r.advertencias.find((x) => x.tipo === 'sin-partida-relacionada' && x.campo === campo);
    assert.strictEqual(a.estado, 'no_verificado');
  });
  const inv = r.advertencias.find((x) => x.tipo === 'sin-inventarios');
  assert.strictEqual(inv.estado, 'no_verificado');
});
```

- [ ] **Step 2: Correr las pruebas y confirmar que fallan**

Run: `node --test frontend/src/services/eeffVerificacion.test.js`
Expected: FAIL — no existe la advertencia `sin-costo-de-ventas`, y `estado` sale
`undefined` en las existentes.

- [ ] **Step 3: Implementar el cambio**

En `frontend/src/services/eeffVerificacion.js`, dentro de `verificarEeff`, justo después de
la línea que calcula `utilidadBrutaLeida` (`const utilidadBrutaLeida = num(cotejo.utilidad_bruta);`),
añadir:

```js
  /* ── Costo de ventas implícito en cero ──
     Si la utilidad bruta impresa es igual a los ingresos, el propio documento está
     afirmando que no hay costo de ventas que restar — no es una ausencia sin explicación,
     es una cifra de cero que el documento no imprime como fila propia. Caso real: LATV
     Sucursal Colombia (2026-08-25), Utilidad Bruta == Ingresos exactos, sin línea de Costo
     de Ventas en ningún lado del documento (ni en sus notas). No se asigna sola: se
     ofrece como sugerencia y el analista decide (ver Fuera de alcance del spec). */
  const costoImplicitoCero = costo === null && ventas !== null && utilidadBrutaLeida !== null
    && cuadra(utilidadBrutaLeida, ventas, ventas);
```

Y, más abajo, justo antes del bloque `if (campos.t_inv === null) { ... }` (dentro de la
sección `── 3. Lo que falta y hay que decir ──`), añadir la advertencia dedicada de costo
de ventas:

```js
  if (campos.t_c === null) {
    advertencias.push({
      tipo: 'sin-costo-de-ventas',
      campo: 't_c',
      estado: costoImplicitoCero ? 'implicito_cero' : 'no_verificado',
      mensaje: costoImplicitoCero
        ? `No se leyó una fila de costo de ventas, pero la utilidad bruta que imprime el `
          + `documento (${fmtCop(utilidadBrutaLeida)}) es igual a los ingresos: el propio `
          + 'documento implica que el costo de ventas es cero. Puede aceptarlo escribiendo '
          + '0, o pedir al cliente el detalle si sabe que sí existe.'
        : 'No se leyó el costo de ventas. Sin él no hay margen operacional ni Índice de '
          + 'Berry — escríbalo a mano si lo tiene, o verifique si el documento lo '
          + 'desglosa en otra parte.',
    });
  }
```

Y, en las dos advertencias ya existentes, añadir la clave `estado: 'no_verificado'` (sin
cambiar nada más): la de `relacionadas.forEach(...)` (tipo `'sin-partida-relacionada'`) y
la de `if (campos.t_inv === null)` (tipo `'sin-inventarios'`):

```js
  relacionadas.forEach(({ campo, patron }) => {
    if (campos[campo] !== null) return;
    const candidatas = noAsignados.filter((r) => patron.test(r.rotulo) && Math.abs(r.valor) > 0);
    advertencias.push({
      tipo: 'sin-partida-relacionada',
      campo,
      estado: 'no_verificado',
      mensaje: `«${ETIQUETA[campo]}»: el documento no desglosa esa partida con partes `
        + 'relacionadas, así que su ajuste de capital de trabajo quedará en cero.'
        + (candidatas.length
          ? ` Las que sí trae son: ${candidatas.map((r) => `«${r.rotulo}» ${fmtCop(r.valor)}`).join(', ')}. `
            + 'Si alguna corresponde a la operación, escríbala a mano.'
          : ''),
    });
  });

  if (campos.t_inv === null) {
    advertencias.push({
      tipo: 'sin-inventarios',
      campo: 't_inv',
      estado: 'no_verificado',
      mensaje: 'No se leyeron inventarios. Si la compañía los tiene, escríbalos: su ajuste '
        + 'de capital de trabajo se está calculando contra cero.',
    });
  }
```

- [ ] **Step 4: Correr las pruebas y confirmar que pasan**

Run: `node --test frontend/src/services/eeffVerificacion.test.js`
Expected: PASS — todas, incluidas las nuevas.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/eeffVerificacion.js frontend/src/services/eeffVerificacion.test.js
git commit -m "feat: distinguir costo de ventas implícito en cero y etiquetar estado por campo"
```

---

### Task 5: `eeffVerificacion.js` — fusionar hallazgos de la pasada angosta

**Files:**
- Modify: `frontend/src/services/eeffVerificacion.js`
- Test: `frontend/src/services/eeffVerificacion.test.js`

**Interfaces:**
- Produces:
  - `fusionarHallazgosEnLectura(lectura, hallazgos) => lectura` (nuevo objeto)
  - `marcarEstadosConHallazgos(advertencias, hallazgos) => advertencias` (nuevo array)
  - `marcarProbableAusentePorVocabulario(advertencias, campos) => advertencias` (nuevo array)
- `hallazgos` tiene la forma `{ [campo]: { valor, encontradoEn, palabra, cita } }` (la que
  producirá `buscarFaltantesEnNotas` en la Task 6).

- [ ] **Step 1: Escribir las pruebas que fallan**

Primero, ampliar el import ya existente al principio de
`frontend/src/services/eeffVerificacion.test.js` (los `import` de un módulo van todos
juntos arriba, no sueltos más abajo en el archivo):

```js
import {
  verificarEeff, camposAplicables, utilidadOperacionalDe, gastosOperativosDe,
  fusionarHallazgosEnLectura, marcarEstadosConHallazgos, marcarProbableAusentePorVocabulario,
} from './eeffVerificacion.js';
```

Y añadir al final del archivo:

```js
/* ══════ Fusionar los hallazgos de la pasada angosta a notas ══════ */

test('fusionarHallazgosEnLectura escribe el valor encontrado sobre la lectura original', () => {
  const lectura = { t_c: null, t_s: 100 };
  const hallazgos = { t_c: { valor: 42, encontradoEn: 'nota', palabra: 'costo del servicio', cita: 'Nota 19' } };
  const fusionada = fusionarHallazgosEnLectura(lectura, hallazgos);
  assert.strictEqual(fusionada.t_c, 42);
  assert.strictEqual(fusionada.t_s, 100, 'no toca lo que no vino en hallazgos');
});

test('fusionarHallazgosEnLectura no pisa con null lo que ya venía en la lectura', () => {
  const lectura = { t_ap: null };
  const hallazgos = { t_ap: { valor: null, encontradoEn: null, palabra: '', cita: 'Revisé la Nota 13, no lo desglosa.' } };
  assert.strictEqual(fusionarHallazgosEnLectura(lectura, hallazgos).t_ap, null);
});

test('fusionarHallazgosEnLectura no muta la lectura original', () => {
  const lectura = { t_c: null };
  fusionarHallazgosEnLectura(lectura, { t_c: { valor: 42 } });
  assert.strictEqual(lectura.t_c, null);
});

test('marcarEstadosConHallazgos marca confirmado_ausente con su cita cuando la IA no lo encontró', () => {
  const advertencias = [{ tipo: 'sin-costo-de-ventas', campo: 't_c', estado: 'no_verificado', mensaje: 'No se leyó el costo de ventas.' }];
  const hallazgos = { t_c: { valor: null, encontradoEn: null, palabra: '', cita: 'Revisé la Nota 19: solo trae gastos de administración, sin desglose de costo.' } };
  const [a] = marcarEstadosConHallazgos(advertencias, hallazgos);
  assert.strictEqual(a.estado, 'confirmado_ausente');
  assert.match(a.mensaje, /Nota 19/);
});

test('marcarEstadosConHallazgos no toca una advertencia cuyo campo sí se encontró', () => {
  const advertencias = [{ tipo: 'sin-costo-de-ventas', campo: 't_c', estado: 'no_verificado', mensaje: 'No se leyó el costo de ventas.' }];
  const hallazgos = { t_c: { valor: 42, encontradoEn: 'nota', palabra: 'costo del servicio', cita: '' } };
  const [a] = marcarEstadosConHallazgos(advertencias, hallazgos);
  assert.strictEqual(a.estado, 'no_verificado', 'se resuelve por re-verificación, no por esta función');
});

test('marcarEstadosConHallazgos no toca advertencias sin campo, o de campos fuera de hallazgos', () => {
  const advertencias = [{ tipo: 'periodo-distinto', mensaje: 'x' }];
  assert.deepStrictEqual(marcarEstadosConHallazgos(advertencias, { t_c: { valor: null } }), advertencias);
});

test('marcarProbableAusentePorVocabulario marca solo los campos indicados', () => {
  const advertencias = [
    { tipo: 'sin-inventarios', campo: 't_inv', estado: 'no_verificado', mensaje: 'No se leyeron inventarios.' },
    { tipo: 'sin-costo-de-ventas', campo: 't_c', estado: 'no_verificado', mensaje: 'No se leyó el costo de ventas.' },
  ];
  const marcadas = marcarProbableAusentePorVocabulario(advertencias, ['t_inv']);
  assert.strictEqual(marcadas.find((a) => a.campo === 't_inv').estado, 'probable_ausente_por_vocabulario');
  assert.strictEqual(marcadas.find((a) => a.campo === 't_c').estado, 'no_verificado');
});
```

- [ ] **Step 2: Correr las pruebas y confirmar que fallan**

Run: `node --test frontend/src/services/eeffVerificacion.test.js`
Expected: FAIL — las tres funciones no existen todavía.

- [ ] **Step 3: Implementar las tres funciones**

Al final de `frontend/src/services/eeffVerificacion.js`, después de `camposAplicables`:

```js
/**
 * Fusiona en una lectura los hallazgos de la pasada angosta a notas, para volver a
 * verificar con `verificarEeff()` — reutiliza todo su cálculo (utilidad operacional,
 * identidades) en vez de repetirlo aquí. Solo escribe los campos con valor encontrado:
 * un hallazgo sin valor no debe pisar con `null` lo que ya hubiera. Puro, no muta.
 */
export function fusionarHallazgosEnLectura(lectura, hallazgos) {
  const fusionada = { ...(lectura || {}) };
  Object.entries(hallazgos || {}).forEach(([campo, hallazgo]) => {
    if (hallazgo && hallazgo.valor !== null && hallazgo.valor !== undefined) {
      fusionada[campo] = hallazgo.valor;
    }
  });
  return fusionada;
}

/**
 * Marca `confirmado_ausente`, con su cita, las advertencias cuyo campo la pasada angosta
 * revisó y no encontró en ninguna parte. Las que sí se encontraron no se tocan aquí: al
 * fusionar el hallazgo y volver a llamar `verificarEeff()`, esa advertencia ya no se
 * genera. Puro.
 */
export function marcarEstadosConHallazgos(advertencias, hallazgos) {
  if (!hallazgos) return advertencias;
  return (advertencias || []).map((a) => {
    const hallazgo = a.campo ? hallazgos[a.campo] : null;
    if (!hallazgo || (hallazgo.valor !== null && hallazgo.valor !== undefined)) return a;
    return {
      ...a,
      estado: 'confirmado_ausente',
      mensaje: `${a.mensaje} La IA revisó el documento completo, incluidas sus notas, y `
        + `confirma que no aparece${hallazgo.cita ? ` (${hallazgo.cita})` : ''}.`,
    };
  });
}

/**
 * Marca `probable_ausente_por_vocabulario` las advertencias de los campos que el
 * diccionario compartido (ya maduro) no encontró en el texto del documento — una señal
 * más débil que `confirmado_ausente`, porque el diccionario pudo simplemente no conocer
 * el sinónimo que usa esta empresa. Puro.
 */
export function marcarProbableAusentePorVocabulario(advertencias, campos) {
  const objetivo = new Set(campos || []);
  return (advertencias || []).map((a) => (a.campo && objetivo.has(a.campo)
    ? {
      ...a,
      estado: 'probable_ausente_por_vocabulario',
      mensaje: `${a.mensaje} No encontramos ninguna palabra relacionada con este rubro en `
        + 'todo el documento, según lo aprendido de otros estudios similares — puede que '
        + 'use un término distinto; revíselo manualmente antes de descartarlo.',
    }
    : a));
}
```

- [ ] **Step 4: Correr las pruebas y confirmar que pasan**

Run: `node --test frontend/src/services/eeffVerificacion.test.js`
Expected: PASS — todas.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/eeffVerificacion.js frontend/src/services/eeffVerificacion.test.js
git commit -m "feat: fusionar hallazgos de la pasada angosta a notas en la verificación"
```

---

### Task 6: `eeffParser.js` — la pasada angosta a Gemini

**Files:**
- Modify: `frontend/src/services/eeffParser.js`
- Test: `frontend/src/services/eeffParser.test.js`

**Interfaces:**
- Produces:
  - `CAMPOS_CON_FALLBACK_NOTAS = { t_c, t_ar, t_ap, t_inv }` (objeto campo → descripción)
  - `promptFaltantesEnNotas(faltantes: string[]) => string`
  - `buscarFaltantesEnNotas(file, faltantes: string[]) => Promise<{ hallazgos: {[campo]: {valor, encontradoEn, palabra, cita}}, conclusion: string }>`

- [ ] **Step 1: Escribir las pruebas que fallan**

Primero, ampliar el import ya existente al principio de
`frontend/src/services/eeffParser.test.js` (los `import` de un módulo van todos juntos
arriba, no sueltos más abajo en el archivo):

```js
import {
  EEFF_PROMPT, EEFF_COMPARABLE_PROMPT, EEFF_COMPARABLES_LOTE_PROMPT,
  promptEeffContribuyente, bloqueDeTexto, valorDeRubro, rotuloDeRubro,
  CAMPO_POR_RUBRO, RUBROS_DE_COTEJO, extraerTextoEstructuradoPdf,
  verifyAccountingEqualities,
  CAMPOS_CON_FALLBACK_NOTAS, promptFaltantesEnNotas, buscarFaltantesEnNotas,
} from './eeffParser.js';
```

Y añadir al final del archivo:

```js
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
```

Confirmar que el archivo ya importa `assert` desde `node:assert` y `test` desde
`node:test` (ya lo hace, ver el resto del archivo).

- [ ] **Step 2: Correr las pruebas y confirmar que fallan**

Run: `node --test frontend/src/services/eeffParser.test.js`
Expected: FAIL — `CAMPOS_CON_FALLBACK_NOTAS`, `promptFaltantesEnNotas` y
`buscarFaltantesEnNotas` no existen todavía.

- [ ] **Step 3: Implementar en `eeffParser.js`**

Después del bloque `export const RUBROS_DE_COTEJO = [...]`, añadir:

```js
/* Los campos donde, por evidencia real (LATV Sucursal Colombia, 2026-08-25), el desglose
   puede vivir solo en una nota — o genuinamente no existir en ninguna parte del
   documento. Acotado a estos cuatro y no a todo `LEIDOS` de `eeffVerificacion.js`: los
   demás (ingresos, los dos totales de activo, PP&E) son cifras que un balance colombiano
   siempre imprime en su cuerpo principal; preguntar por ellas en las notas no tiene
   precedente real y solo gastaría la llamada en vano. */
export const CAMPOS_CON_FALLBACK_NOTAS = {
  t_c: 'costo de ventas',
  t_ar: 'cuentas por cobrar a partes relacionadas',
  t_ap: 'cuentas por pagar a partes relacionadas',
  t_inv: 'inventarios',
};

/**
 * El prompt de la pasada angosta: un solo objetivo (los campos que `verificarEeff()`
 * dejó en null) en vez de los ~15 que compiten por atención en `EEFF_PROMPT`. Exige, por
 * campo, la palabra/frase literal si lo encuentra, o una cita de qué nota revisó y por
 * qué no lo contiene si no lo encuentra en ninguna parte — un `null` sin más no es una
 * respuesta aceptable, porque es lo único que hace verificable una ausencia.
 */
export function promptFaltantesEnNotas(faltantes) {
  const lista = faltantes
    .map((campo) => `· ${campo}: ${CAMPOS_CON_FALLBACK_NOTAS[campo]}`)
    .join('\n');
  const esqueleto = faltantes
    .map((campo) => `    "${campo}": {"valor": null, "encontrado_en": null, "palabra": "", "cita": ""}`)
    .join(',\n');

  return `Eres un contador público que lee estados financieros colombianos preparados bajo NIIF.

Ya se leyó este documento una vez y los siguientes datos quedaron sin encontrar en el cuerpo principal de los estados. Busca ESPECÍFICAMENTE estos datos EN TODO EL DOCUMENTO, incluyendo cualquier nota a los estados financieros que traiga (no solo el Estado de Situación Financiera y el Estado de Resultados):

${lista}

Para CADA uno de los campos de arriba, devuelve un objeto con esta forma exacta:
{"valor": <número o null>, "encontrado_en": "estado_principal"|"nota"|null, "palabra": "<palabra o frase literal con la que el documento lo llama, o cadena vacía>", "cita": "<en qué nota o página lo buscaste y por qué no lo contiene, o cadena vacía si sí lo encontraste>"}

Si genuinamente no aparece en ninguna parte tras revisar el documento completo (estados y notas), "valor" y "encontrado_en" van en null, pero "cita" es OBLIGATORIA: no basta un null sin sustento, di explícitamente en qué nota(s) buscaste y por qué esa nota no lo contiene.

Devuelve también una "conclusion": una frase breve en español explicando qué encontraste y qué sigue faltando, para mostrarle al analista.

Devuelve SOLO este JSON, sin marcas markdown:
{
  "hallazgos": {
${esqueleto}
  },
  "conclusion": ""
}`;
}

/**
 * La pasada angosta: reintenta con el mismo documento ya en base64, preguntando solo por
 * los campos que `verificarEeff()` dejó en null. No rasteriza nada nuevo: Gemini ya
 * recibió el PDF completo (con sus notas, si las trae) en `parseEeffWithGeminiOCR`.
 */
export async function buscarFaltantesEnNotas(file, faltantes) {
  if (!faltantes || faltantes.length === 0) return { hallazgos: {}, conclusion: '' };

  const base64Data = await leerBase64(file);
  const mimeType = mimeDe(file);

  const response = await postGeminiWithRetry({
    model: 'gemini-3.5-flash',
    contents: [{
      parts: [
        { inline_data: { mime_type: mimeType, data: base64Data } },
        { text: promptFaltantesEnNotas(faltantes) },
      ],
    }],
  });

  const text = response.data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || '';
  const parsed = extraerJSON(text);
  if (!parsed) throw new Error('La respuesta de la pasada a notas no traía un JSON reconocible.');

  const hallazgos = {};
  faltantes.forEach((campo) => {
    const h = (parsed.hallazgos && parsed.hallazgos[campo]) || {};
    hallazgos[campo] = {
      valor: valorDeRubro(h.valor !== undefined ? { valor: h.valor } : null),
      encontradoEn: (h.encontrado_en === 'estado_principal' || h.encontrado_en === 'nota') ? h.encontrado_en : null,
      palabra: String(h.palabra || '').trim(),
      cita: String(h.cita || '').trim(),
    };
  });

  return { hallazgos, conclusion: String(parsed.conclusion || '').trim() };
}
```

- [ ] **Step 4: Correr las pruebas y confirmar que pasan**

Run: `node --test frontend/src/services/eeffParser.test.js`
Expected: PASS — todas, incluidas las 5 nuevas.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/eeffParser.js frontend/src/services/eeffParser.test.js
git commit -m "feat: pasada angosta a Gemini para buscar campos faltantes en las notas"
```

---

### Task 7: `services/notasEeffOrquestacion.js` — las tres ramas del disparo

**Files:**
- Create: `frontend/src/services/notasEeffOrquestacion.js`
- Test: `frontend/src/services/notasEeffOrquestacion.test.js`

**Interfaces:**
- Consumes:
  - `CAMPOS_CON_FALLBACK_NOTAS`, `buscarFaltantesEnNotas`, `CAMPO_POR_RUBRO` (`eeffParser.js`)
  - `verificarEeff`, `fusionarHallazgosEnLectura`, `marcarEstadosConHallazgos`,
    `marcarProbableAusentePorVocabulario` (`eeffVerificacion.js`)
  - `contarPaginasPdf` (`eeffTextoPdf.js`)
  - `diccionarioVacio`, `esMaduro`, `contienePalabraConocida`, `agregarPalabras`
    (`vocabularioEeff.js`)
- Produces:
  - `resolverFaltantesConNotas({ file, lectura, verificacion, anioEstudio, leerVocabulario, guardarVocabulario, buscar, contarPaginas }) => Promise<verificacion>`
  - `aprenderDeLecturaExitosa({ campos, rotulos, leerVocabulario, guardarVocabulario }) => Promise<void>`

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `frontend/src/services/notasEeffOrquestacion.test.js`:

```js
/* Pruebas de la orquestación: decide, sin red ni Firestore reales (todo inyectado), si
   hace falta la pasada angosta a notas y cómo se fusiona su resultado. */

import { test } from 'node:test';
import assert from 'node:assert';
import { resolverFaltantesConNotas, aprenderDeLecturaExitosa } from './notasEeffOrquestacion.js';
import { diccionarioVacio, UMBRAL_MADUREZ } from './vocabularioEeff.js';

const verificacionBase = () => ({
  campos: { t_s: 100, t_c: null, t_ar: null, t_ap: 5, t_inv: null, t_act_curr: 1, t_act_tot: 1, t_ppe: 1 },
  correcciones: [],
  advertencias: [
    { tipo: 'sin-costo-de-ventas', campo: 't_c', estado: 'no_verificado', mensaje: 'No se leyó el costo de ventas.' },
    { tipo: 'sin-partida-relacionada', campo: 't_ar', estado: 'no_verificado', mensaje: 'No se desglosa.' },
    { tipo: 'sin-inventarios', campo: 't_inv', estado: 'no_verificado', mensaje: 'No se leyeron inventarios.' },
  ],
  verificadoContraTexto: true,
});

const sinLlamadas = { leerVocabulario: async () => diccionarioVacio(), guardarVocabulario: async () => {} };

test('sin campos faltantes, no hace nada y devuelve la misma verificación', async () => {
  const verificacion = { ...verificacionBase(), campos: { t_c: 1, t_ar: 1, t_ap: 1, t_inv: 1 }, advertencias: [] };
  const resultado = await resolverFaltantesConNotas({
    file: {}, lectura: {}, verificacion, anioEstudio: 2025, ...sinLlamadas,
  });
  assert.strictEqual(resultado, verificacion);
});

test('con diccionario inmaduro y pocas páginas, no llama a la IA y deja no_verificado', async () => {
  let sePreguntoALaIA = false;
  const resultado = await resolverFaltantesConNotas({
    file: {}, lectura: { textoPdf: '' }, verificacion: verificacionBase(), anioEstudio: 2025,
    ...sinLlamadas,
    buscar: async () => { sePreguntoALaIA = true; return { hallazgos: {}, conclusion: '' }; },
    contarPaginas: async () => 5, // como el escaneo de LATV
  });
  assert.strictEqual(sePreguntoALaIA, false);
  assert.ok(resultado.advertencias.every((a) => a.estado === 'no_verificado'));
});

test('con diccionario maduro y ninguna palabra conocida en el texto, marca probable_ausente_por_vocabulario sin llamar a la IA', async () => {
  let sePreguntoALaIA = false;
  const diccionarioMaduro = { palabras: ['vinculadas economicas'], estudiosSinPalabraNueva: UMBRAL_MADUREZ };
  const resultado = await resolverFaltantesConNotas({
    file: {}, lectura: { textoPdf: 'un texto que no menciona nada de eso' },
    verificacion: verificacionBase(), anioEstudio: 2025,
    leerVocabulario: async () => diccionarioMaduro,
    guardarVocabulario: async () => {},
    buscar: async () => { sePreguntoALaIA = true; return { hallazgos: {}, conclusion: '' }; },
    contarPaginas: async () => 23,
  });
  assert.strictEqual(sePreguntoALaIA, false);
  const a = resultado.advertencias.find((x) => x.campo === 't_c');
  assert.strictEqual(a.estado, 'probable_ausente_por_vocabulario');
});

test('con diccionario maduro pero SIN capa de texto confiable, el diccionario no decide — cae a la rama de páginas', async () => {
  /* Sin texto, "no encontramos la palabra" no significa nada: no hay dónde haberla
     buscado. Es el caso del escaneo de LATV, solo que aquí SÍ hay páginas de sobra, para
     aislar que lo que impide la rama del diccionario es la falta de texto, no de páginas. */
  const diccionarioMaduro = { palabras: ['vinculadas economicas'], estudiosSinPalabraNueva: UMBRAL_MADUREZ };
  let sePreguntoALaIA = false;
  const resultado = await resolverFaltantesConNotas({
    file: {}, lectura: { textoPdf: '' }, // sin capa de texto
    verificacion: verificacionBase(), anioEstudio: 2025,
    leerVocabulario: async () => diccionarioMaduro,
    guardarVocabulario: async () => {},
    buscar: async (_file, faltantes) => {
      sePreguntoALaIA = true;
      const hallazgos = {};
      faltantes.forEach((campo) => { hallazgos[campo] = { valor: null, encontradoEn: null, palabra: '', cita: 'no encontrado' }; });
      return { hallazgos, conclusion: '' };
    },
    contarPaginas: async () => 23,
  });
  assert.strictEqual(sePreguntoALaIA, true, 'sin texto, el diccionario no puede decidir por sí solo');
  const a = resultado.advertencias.find((x) => x.campo === 't_c');
  assert.strictEqual(a.estado, 'confirmado_ausente', 'la IA sí decidió, no el diccionario');
});

test('con más de 6 páginas y algo pendiente, llama a la IA, fusiona lo encontrado y re-verifica', async () => {
  const resultado = await resolverFaltantesConNotas({
    file: {},
    /* t_ar, t_ap y t_inv van con el MISMO valor que ya tenía `verificacionBase().campos`:
       en el uso real, `lectura` es el objeto completo que devolvió la pasada 1
       (`res` de `parseEeffWithGeminiOCR`), así que nunca le falta un campo que ya se
       hubiera leído bien — reconstruirlo a medias aquí regresaría t_ap a null solo por
       un descuido del fixture, no por nada que haga el código real. */
    lectura: {
      t_s: 100, t_c: null, t_ar: null, t_ap: 5, t_inv: null,
      cotejo: { gastos_ventas: -10, gastos_administracion: -5 }, textoPdf: '',
    },
    verificacion: verificacionBase(),
    anioEstudio: 2025,
    ...sinLlamadas,
    buscar: async (_file, faltantes) => {
      const hallazgos = {};
      faltantes.forEach((campo) => {
        hallazgos[campo] = campo === 't_c'
          ? { valor: 20, encontradoEn: 'nota', palabra: 'costo del servicio', cita: '' }
          : { valor: null, encontradoEn: null, palabra: '', cita: 'Revisé las notas, no lo desglosa.' };
      });
      return { hallazgos, conclusion: 'Se encontró el costo de ventas en la Nota 19.' };
    },
    contarPaginas: async () => 23,
  });
  assert.strictEqual(resultado.campos.t_c, 20, 're-verificó con el costo encontrado');
  assert.strictEqual(resultado.campos.t_ap, 5, 't_ap no estaba entre los faltantes, no debía tocarse');
  assert.strictEqual(resultado.campos.t_op, 100 - 20 - 15, 'la utilidad operacional se recalculó');
  assert.strictEqual(resultado.conclusionNotas, 'Se encontró el costo de ventas en la Nota 19.');
  assert.ok(!resultado.advertencias.some((a) => a.campo === 't_ap'), 't_ap se encontró, no debe quedar advertencia');
});

test('con más de 6 páginas y algo pendiente que la IA no encuentra, queda confirmado_ausente con cita', async () => {
  const resultado = await resolverFaltantesConNotas({
    file: {},
    lectura: { t_s: 100, t_c: null, cotejo: {}, textoPdf: '' },
    verificacion: verificacionBase(),
    anioEstudio: 2025,
    ...sinLlamadas,
    buscar: async (_file, faltantes) => {
      const hallazgos = {};
      faltantes.forEach((campo) => {
        hallazgos[campo] = { valor: null, encontradoEn: null, palabra: '', cita: 'Revisé todas las notas: no aparece.' };
      });
      return { hallazgos, conclusion: 'No se encontró nada de lo faltante.' };
    },
    contarPaginas: async () => 23,
  });
  const a = resultado.advertencias.find((x) => x.campo === 't_c');
  assert.strictEqual(a.estado, 'confirmado_ausente');
  assert.match(a.mensaje, /Revisé todas las notas/);
});

test('aprenderDeLecturaExitosa guarda la palabra del rótulo cuando el campo sí se encontró', async () => {
  let guardado = null;
  await aprenderDeLecturaExitosa({
    campos: { t_c: 42, t_ar: null, t_ap: null, t_inv: null },
    rotulos: { costo_ventas: 'COSTO DE SERVICIOS PRESTADOS' },
    leerVocabulario: async () => diccionarioVacio(),
    guardarVocabulario: async (campo, diccionario) => { guardado = { campo, diccionario }; },
  });
  assert.strictEqual(guardado.campo, 't_c');
  assert.deepStrictEqual(guardado.diccionario.palabras, ['costo de servicios prestados']);
});

test('aprenderDeLecturaExitosa no guarda nada si ningún campo con fallback se encontró', async () => {
  let sellamo = false;
  await aprenderDeLecturaExitosa({
    campos: { t_c: null, t_ar: null, t_ap: null, t_inv: null },
    rotulos: {},
    leerVocabulario: async () => diccionarioVacio(),
    guardarVocabulario: async () => { sellamo = true; },
  });
  assert.strictEqual(sellamo, false);
});
```

- [ ] **Step 2: Correr las pruebas y confirmar que fallan**

Run: `node --test frontend/src/services/notasEeffOrquestacion.test.js`
Expected: FAIL — `Cannot find module './notasEeffOrquestacion.js'`.

- [ ] **Step 3: Implementar `notasEeffOrquestacion.js`**

Crear `frontend/src/services/notasEeffOrquestacion.js`:

```js
/* ─────────────────────────────────────────────────────────────────────────────
   Orquesta las tres ramas del fallback a notas cuando `verificarEeff()` deja costo de
   ventas, partes relacionadas o inventarios en null (ver
   docs/superpowers/specs/2026-08-25-fallback-notas-utilidad-operacional-design.md):

     1. Si el diccionario de ese campo ya es maduro y ninguna de sus palabras aparece en
        el texto del documento, se marca `probable_ausente_por_vocabulario` SIN llamar a
        Gemini.
     2. Si no, y el documento trae más de `UMBRAL_PAGINAS_CON_NOTAS` páginas, se ejecuta
        la pasada angosta y se re-verifica con lo que encuentre.
     3. Si no se cumple ninguna de las dos, el campo queda como estaba (`no_verificado`).

   Todo el I/O (Firestore, la llamada a Gemini, abrir el PDF para contar páginas) se
   inyecta con un valor por defecto — mismo patrón que ya usa `extraerTextoPdf(file,
   { getDocument })} —, así que este módulo se prueba sin red ni base de datos real. */

import {
  verificarEeff, fusionarHallazgosEnLectura, marcarEstadosConHallazgos,
  marcarProbableAusentePorVocabulario,
} from './eeffVerificacion.js';
import { CAMPOS_CON_FALLBACK_NOTAS, CAMPO_POR_RUBRO, buscarFaltantesEnNotas } from './eeffParser.js';
import { contarPaginasPdf } from './eeffTextoPdf.js';
import { diccionarioVacio, esMaduro, contienePalabraConocida, agregarPalabras } from './vocabularioEeff.js';

/* Heurística: portada + los 4 estados principales ≈ 5-6 páginas en los casos vistos. No
   pretende ser exacta, solo evitar la llamada cuando es obvio que no hay notas (el
   escaneo de 5 páginas de LATV, por ejemplo). */
const UMBRAL_PAGINAS_CON_NOTAS = 6;

const RUBRO_POR_CAMPO = Object.fromEntries(
  Object.entries(CAMPO_POR_RUBRO).map(([rubro, campo]) => [campo, rubro]),
);

/** Los campos con fallback que la verificación dejó en `null`, sin contar los que ya
 *  quedaron `implicito_cero` — ese caso se sugiere en pantalla, no se busca en notas. */
function camposFaltantes(verificacion) {
  return Object.keys(CAMPOS_CON_FALLBACK_NOTAS).filter((campo) => {
    if (verificacion.campos[campo] !== null) return false;
    return !verificacion.advertencias.some((a) => a.campo === campo && a.estado === 'implicito_cero');
  });
}

export async function resolverFaltantesConNotas({
  file, lectura, verificacion, anioEstudio,
  leerVocabulario, guardarVocabulario,
  buscar = buscarFaltantesEnNotas,
  contarPaginas = contarPaginasPdf,
}) {
  const faltantes = camposFaltantes(verificacion);
  if (faltantes.length === 0) return verificacion;

  const diccionarios = {};
  await Promise.all(faltantes.map(async (campo) => {
    try {
      diccionarios[campo] = await leerVocabulario(campo);
    } catch (err) {
      console.warn(`[notasEeffOrquestacion] no se pudo leer el diccionario de ${campo}`, err);
      diccionarios[campo] = diccionarioVacio();
    }
  }));

  /* La rama del diccionario exige capa de texto confiable: sin ella, "no encontramos la
     palabra" no significa nada — no hay texto donde buscarla, no es que se buscó y no
     estaba. Un escaneo sin texto (el de 5 páginas de LATV, por ejemplo) nunca puede
     resolverse por esta vía, así que cae directo a la rama de páginas/pasada angosta. */
  const hayTextoConfiable = Boolean(lectura.textoPdf && String(lectura.textoPdf).trim());
  const porVocabulario = hayTextoConfiable
    ? faltantes.filter((campo) => (
      esMaduro(diccionarios[campo]) && !contienePalabraConocida(lectura.textoPdf, diccionarios[campo])
    ))
    : [];
  const pendientes = faltantes.filter((campo) => !porVocabulario.includes(campo));

  let resultado = {
    ...verificacion,
    advertencias: marcarProbableAusentePorVocabulario(verificacion.advertencias, porVocabulario),
  };

  if (pendientes.length === 0) return resultado;

  const numPaginas = await contarPaginas(file);
  if (numPaginas <= UMBRAL_PAGINAS_CON_NOTAS) return resultado;

  const { hallazgos, conclusion } = await buscar(file, pendientes);
  const lecturaFusionada = fusionarHallazgosEnLectura(lectura, hallazgos);
  const reverificada = verificarEeff(lecturaFusionada, { anioEstudio });

  resultado = {
    ...reverificada,
    advertencias: marcarEstadosConHallazgos(
      marcarProbableAusentePorVocabulario(reverificada.advertencias, porVocabulario),
      hallazgos,
    ),
    conclusionNotas: conclusion,
  };

  await Promise.all(pendientes.map(async (campo) => {
    const hallazgo = hallazgos[campo];
    if (!hallazgo || !hallazgo.palabra) return;
    try {
      const actualizado = agregarPalabras(diccionarios[campo], [hallazgo.palabra]);
      await guardarVocabulario(campo, actualizado);
    } catch (err) {
      console.warn(`[notasEeffOrquestacion] no se pudo guardar el diccionario de ${campo}`, err);
    }
  }));

  return resultado;
}

/**
 * Alimenta el diccionario con los éxitos de la pasada 1, no solo con los fallos de la
 * pasada angosta: si un campo con fallback SÍ se encontró, el rótulo que le atribuyó
 * `parseEeffWithGeminiOCR` (`rotulos`, indexado por RUBRO — ver `CAMPO_POR_RUBRO`) es la
 * palabra con la que este documento lo llamó. La mayoría de estudios nunca necesitan el
 * fallback, y aun así alimentan el diccionario.
 */
export async function aprenderDeLecturaExitosa({ campos, rotulos, leerVocabulario, guardarVocabulario }) {
  const objetivo = Object.keys(CAMPOS_CON_FALLBACK_NOTAS);
  await Promise.all(objetivo.map(async (campo) => {
    if (campos[campo] === null || campos[campo] === undefined) return;
    const rubro = RUBRO_POR_CAMPO[campo];
    const palabra = rubro ? (rotulos || {})[rubro] : '';
    if (!palabra) return;
    try {
      const diccionario = await leerVocabulario(campo);
      const actualizado = agregarPalabras(diccionario, [palabra]);
      await guardarVocabulario(campo, actualizado);
    } catch (err) {
      console.warn(`[notasEeffOrquestacion] no se pudo aprender del éxito de ${campo}`, err);
    }
  }));
}
```

- [ ] **Step 4: Correr las pruebas y confirmar que pasan**

Run: `node --test frontend/src/services/notasEeffOrquestacion.test.js`
Expected: PASS — las 8 pruebas.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/notasEeffOrquestacion.js frontend/src/services/notasEeffOrquestacion.test.js
git commit -m "feat: orquestar el fallback a notas con diccionario, páginas y re-verificación"
```

---

### Task 8: `components/PopupFaltantesEeff.jsx` — el modal

**Files:**
- Create: `frontend/src/components/PopupFaltantesEeff.jsx`

No lleva prueba automatizada: `frontend/src/components/` no entra en `npm test` (mismo
criterio que el resto de la carpeta — ver la nota del spec de 2026-08-21). Se verifica a
mano en el navegador en la Task 10.

**Interfaces:**
- Consumes: nada nuevo.
- Produces: `<PopupFaltantesEeff advertencias={[...]} conclusion={string} alCerrar={fn} />`

- [ ] **Step 1: Crear el componente**

Crear `frontend/src/components/PopupFaltantesEeff.jsx`. El patrón del modal (overlay fijo,
`onClick` para cerrar al hacer click fuera, `stopPropagation` dentro) es el mismo que ya
usa `MemoriaRangoModal.jsx`:

```jsx
import React from 'react';
import { X, AlertTriangle } from 'lucide-react';

/* Un color por estado, con la clase completa y literal — Tailwind no reconoce clases
   armadas con interpolación de cadenas (`bg-${x}-100`), así que cada estado tiene la suya
   entera aquí, no un color que se compone en tiempo de ejecución. */
const ESTILO_ESTADO = {
  confirmado_ausente: {
    titulo: 'Confirmado ausente',
    clase: 'bg-rose-100 text-rose-800 dark:bg-rose-950/30 dark:text-rose-300',
  },
  probable_ausente_por_vocabulario: {
    titulo: 'Probablemente ausente',
    clase: 'bg-amber-100 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300',
  },
  implicito_cero: {
    titulo: 'Implícito en cero',
    clase: 'bg-amber-100 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300',
  },
  no_verificado: {
    titulo: 'No se pudo revisar',
    clase: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-300',
  },
};

/**
 * Popup dedicado para los campos de EEFF que quedaron sin cifra después del fallback a
 * notas (costo de ventas, partes relacionadas, inventarios) — no la caja de advertencias
 * de siempre: el usuario pidió una notificación clara de lo que falta, con una conclusión
 * en lenguaje natural cuando la hay.
 *
 * `advertencias` son las de `verificarEeff()`/`resolverFaltantesConNotas()` cuyo `estado`
 * ya no es el default; `conclusion` es `verificacion.conclusionNotas`, si la pasada
 * angosta corrió.
 */
export default function PopupFaltantesEeff({ advertencias, conclusion, alCerrar }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={alCerrar}
    >
      <div
        className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
          <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-500" />
            Datos que faltan en el documento
          </h3>
          <button onClick={alCerrar} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 p-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto">
          {conclusion && (
            <p className="text-xs text-zinc-700 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-900/40 rounded-lg p-3 leading-snug">
              {conclusion}
            </p>
          )}
          <ul className="space-y-2">
            {advertencias.map((a, i) => {
              const info = ESTILO_ESTADO[a.estado] || ESTILO_ESTADO.no_verificado;
              return (
                <li key={i} className="text-[11px] leading-snug text-zinc-800 dark:text-zinc-200">
                  <span className={`inline-block text-[9px] font-bold uppercase tracking-wide mr-1.5 px-1.5 py-0.5 rounded ${info.clase}`}>
                    {info.titulo}
                  </span>
                  {a.mensaje}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verificar que el archivo es JSX válido**

Run: `npx --prefix frontend eslint src/components/PopupFaltantesEeff.jsx` (o el comando de
lint que ya use el repo — `npm run lint --prefix frontend`, que corre sobre todo
`frontend/src`).
Expected: sin errores nuevos.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/PopupFaltantesEeff.jsx
git commit -m "feat: popup dedicado para los campos de EEFF confirmados ausentes"
```

---

### Task 9: Conectar todo en `IngestaCifras.jsx`

**Files:**
- Modify: `frontend/src/components/IngestaCifras.jsx`

No lleva prueba automatizada por la misma razón que la Task 8. Se verifica a mano en la
Task 10.

**Interfaces:**
- Consumes: `resolverFaltantesConNotas`, `aprenderDeLecturaExitosa`
  (`notasEeffOrquestacion.js`); `leerVocabularioEeff`, `guardarVocabularioEeff`
  (`firestoreRepo.js`); `PopupFaltantesEeff` (Task 8); `CAMPOS_CON_FALLBACK_NOTAS`
  (`eeffParser.js`).

- [ ] **Step 1: Importar lo nuevo**

En `frontend/src/components/IngestaCifras.jsx`, ampliar los imports del principio:

```jsx
import { parseEeffWithGeminiOCR, CAMPOS_CON_FALLBACK_NOTAS } from '../services/eeffParser';
import {
  verificarEeff, camposAplicables, utilidadOperacionalDe,
} from '../services/eeffVerificacion';
import { resolverFaltantesConNotas, aprenderDeLecturaExitosa } from '../services/notasEeffOrquestacion';
import { leerVocabularioEeff, guardarVocabularioEeff } from '../services/firestoreRepo';
import { convertPdfToImages } from '../services/pdfRenderer';
import PopupFaltantesEeff from './PopupFaltantesEeff';
```

- [ ] **Step 2: Añadir el estado del popup**

Junto a los demás `useState` del componente:

```jsx
  /* Los estados por campo que la ingesta no pudo resolver ni con la pasada a notas —
     solo se llena cuando hay algo que de verdad merece un popup, no en cada carga. */
  const [popupFaltantes, setPopupFaltantes] = useState(null);
```

- [ ] **Step 3: Llamar la orquestación dentro de `handleEeffUpload`**

Reemplazar el bloque que hoy dice:

```jsx
      const verificacion = verificarEeff(res, { anioEstudio: study.anio });
      Object.assign(updates, camposAplicables(verificacion.campos));
      updates.t_correcciones = verificacion.correcciones;

      updateStudy(updates);
      setHallazgos(verificacion);
```

por:

```jsx
      const primeraVerificacion = verificarEeff(res, { anioEstudio: study.anio });

      /* La pasada a notas solo corre si algo de costo de ventas, partes relacionadas o
         inventarios quedó en null — con diccionario y páginas decidiendo si vale la pena
         gastar la llamada. Un fallo aquí (Firestore o Gemini caídos) no debe tumbar la
         ingesta: se sigue con lo que ya se tenía de la primera pasada. */
      let verificacion = primeraVerificacion;
      try {
        verificacion = await resolverFaltantesConNotas({
          file,
          lectura: res,
          verificacion: primeraVerificacion,
          anioEstudio: study.anio,
          leerVocabulario: leerVocabularioEeff,
          guardarVocabulario: guardarVocabularioEeff,
        });
      } catch (err) {
        console.error('No se pudo completar la pasada a notas:', err);
      }

      /* Alimenta el diccionario con lo que la pasada 1 SÍ encontró, para que madure con
         cada estudio exitoso y no solo con los que necesitaron el fallback. No bloquea la
         ingesta si falla. */
      aprenderDeLecturaExitosa({
        campos: verificacion.campos,
        rotulos: res.rotulos,
        leerVocabulario: leerVocabularioEeff,
        guardarVocabulario: guardarVocabularioEeff,
      }).catch((err) => console.warn('No se pudo actualizar el diccionario de vocabulario:', err));

      Object.assign(updates, camposAplicables(verificacion.campos));
      updates.t_correcciones = verificacion.correcciones;

      updateStudy(updates);
      setHallazgos(verificacion);

      /* El popup solo aparece si queda algo confirmado ausente, probablemente ausente
         por vocabulario, o sin poder revisar por falta de páginas — el caso feliz (todo
         resuelto o nunca hizo falta el fallback) no debe interrumpir al analista. */
      const necesitanPopup = verificacion.advertencias.filter((a) => (
        a.campo && CAMPOS_CON_FALLBACK_NOTAS[a.campo]
        && ['confirmado_ausente', 'probable_ausente_por_vocabulario', 'implicito_cero'].includes(a.estado)
      ));
      if (necesitanPopup.length > 0) {
        setPopupFaltantes({ advertencias: necesitanPopup, conclusion: verificacion.conclusionNotas || '' });
      }
```

- [ ] **Step 4: Renderizar el popup**

Al final del `return (...)` del componente, justo antes del último `</div>` de cierre
(el que cierra el `<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">` inicial),
añadir:

```jsx
      {popupFaltantes && (
        <PopupFaltantesEeff
          advertencias={popupFaltantes.advertencias}
          conclusion={popupFaltantes.conclusion}
          alCerrar={() => setPopupFaltantes(null)}
        />
      )}
```

- [ ] **Step 5: Correr el lint del frontend**

Run: `npm run lint --prefix frontend`
Expected: sin errores nuevos (oxlint es la única herramienta de lint del repo, per
CLAUDE.md).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/IngestaCifras.jsx
git commit -m "feat: conectar el fallback a notas y su popup a la ingesta de EEFF"
```

---

### Task 10: Verificación completa

**Files:** ninguno nuevo — solo verificación.

- [ ] **Step 1: Suite completa en verde**

Run: `node --test scripts/lib/*.test.js frontend/src/services/*.test.js frontend/src/utils/*.test.js functions/*.test.js`
Expected: PASS — 0 fallos, con más pruebas que las que había antes de este plan.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: compila sin errores.

- [ ] **Step 3: Prueba manual en el navegador — el caso real de LATV**

Levantar `npm run dev --prefix frontend` (con `npm start` corriendo el backend en otra
terminal, o apuntando a pruebas). Crear o abrir un estudio, ir a la ingesta de EEFF y subir
`LATV EEFF 2025 Vs 2024.pdf` (el de 23 páginas, con notas).

Verificar:
- Costo de ventas, cuentas por cobrar/pagar a partes relacionadas e inventarios quedan en
  blanco (siguen sin estar en el documento, ni en sus notas).
- Aparece el popup nuevo (no un `window.alert`) con esos cuatro puntos, cada uno con su
  etiqueta de estado (confirmado ausente / implícito en cero, según corresponda) y, si la
  pasada angosta corrió, con una conclusión en español.
- La caja roja de advertencias de siempre sigue apareciendo igual que antes, ahora con los
  mensajes ampliados (la frase "La IA revisó el documento completo..." al final de las que
  se confirmaron ausentes).
- Los colores del popup se ven correctos (rosa/ámbar/gris) — confirma que Tailwind no
  descartó ninguna clase en el build de producción (`npm run build` + revisar el HTML
  servido, o simplemente mirar el popup en pantalla).

- [ ] **Step 4: Prueba manual — el escaneo corto**

Subir `EEFF DE LATV.pdf` (el escaneo de 5 páginas). Verificar que NO aparece el popup
nuevo (documento demasiado corto para intentar la pasada a notas) y que el aviso de
"sin capa de texto" sigue apareciendo como antes.

- [ ] **Step 5: Desplegar las reglas de Firestore**

Run: `firebase deploy --only firestore:rules` (o `firebase deploy --only firestore:rules -P pruebas` primero, para probar sin tocar producción).
Expected: despliegue sin errores; sin esto, `leerVocabularioEeff`/`guardarVocabularioEeff`
fallarán con `permission-denied` en cualquier entorno donde no se hayan desplegado.
