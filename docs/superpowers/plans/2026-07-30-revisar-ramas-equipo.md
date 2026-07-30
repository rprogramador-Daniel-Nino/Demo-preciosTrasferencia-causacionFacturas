# Verificación de ramas de compañeros — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que antes de aplicar cambios propios se pueda correr una skill que trae las ramas remotas de los compañeros, reporta qué cambió cada quien mapeado al bloque concreto de `index.html` que toca, y las integra abortando ante cualquier conflicto fuera de `public/`.

**Architecture:** Un script Node sin dependencias hace la parte determinista y emite JSON; la skill lo consume, reporta en prosa e integra. La lógica pura (parseo de anclas, mapeo de hunks, solapamiento) vive en `scripts/lib/analisis-ramas.js` y se prueba con el runner integrado de Node; la capa que habla con git vive en `scripts/revisar-ramas.js` y se verifica a mano contra el repo real.

**Tech Stack:** Node ≥18 (instalado: v25.2.1), CommonJS, sin dependencias externas. Tests con `node --test`. Git por CLI vía `child_process.execFileSync`.

## Global Constraints

- **Idioma:** todo el código, comentarios, mensajes y documentación en español. Es la convención del repo.
- **Sin dependencias nuevas.** `scripts/` no tiene `node_modules` propio y no debe tenerlo. Solo módulos nativos (`node:fs`, `node:path`, `node:child_process`, `node:test`, `node:assert`).
- **CommonJS.** El `package.json` de la raíz no declara `"type": "module"`, así que los archivos de `scripts/` usan `require`/`module.exports`. (`frontend/` sí es ESM — no confundir.)
- **Comando de tests:** `node --test "scripts/lib/*.test.js"`, con las comillas. Verificado: la forma de directorio (`node --test scripts/lib/`) falla en Node 25 en este entorno.
- **Fin de línea:** el repo está en CRLF. Todo parseo de contenido de archivo divide con `/\r?\n/`, nunca con `'\n'` a secas.
- **Nunca editar `public/index.html` a mano.** Es artefacto de `npm run build` desde `index.html` de la raíz.
- **Rama de trabajo:** `juandev`. Ya existe y está activa.
- El script **no escribe nada en disco** y **no ejecuta comandos que muten el repo**. Solo lee. Toda mutación (merge, build) la hace la skill, no el script.

---

### Task 1: Corregir `.gitignore` y sacar `config.php` del índice

Dos patrones del `.gitignore` actual nunca aplicaron por estar anclados a la raíz. Esta tarea los arregla y saca del índice el archivo con secretos que se coló por esa falla.

**Files:**
- Modify: `.gitignore` — línea 3 (`.claude`) y las dos últimas líneas (`api/config.php`, `api/usage_data.json`)
- Modify: `package.json` — agregar script `test`

**Interfaces:**
- Consumes: nada.
- Produces: la ruta `.claude/skills/` deja de estar ignorada, requisito de la Task 6. El script `npm test` queda disponible para las Tasks 2-4.

- [ ] **Step 1: Verificar el estado de partida**

Run:
```bash
git check-ignore -v .claude/skills/prueba/SKILL.md ; echo "---" ; git ls-files Cpanel/public_html/api/config.php
```

Expected: la primera línea muestra que `.gitignore:3:.claude` lo está ignorando; la segunda imprime `Cpanel/public_html/api/config.php`, confirmando que está trackeado.

- [ ] **Step 2: Reemplazar la regla de `.claude` y agregar la de Google Drive**

En `.gitignore`, buscar (debe ser único):

```
# Logs
.agents
.claude
logs
```

Reemplazar por:

```
# Logs
.agents
logs
```

Luego agregar al final del archivo:

```
# Google Drive File Stream crea desktop.ini en cada carpeta que sincroniza.
# Sin barra inicial, el patrón aplica en todo el árbol. Se incluye la variante
# con mayúscula porque NTFS no distingue mayúsculas pero git sí.
desktop.ini
Desktop.ini

# Claude Code — se versiona .claude/skills/ para compartir skills con el equipo;
# el resto (settings.local.json, cachés) es local de cada máquina.
.claude/*
!.claude/skills/

# Scratch de ejecución de planes (superpowers). Efímero, no se comparte.
.superpowers/
```

El orden importa: git no desciende a un directorio excluido, así que `!.claude/skills/` tiene que venir después de `.claude/*` para reincorporarlo.

- [ ] **Step 3: Corregir los dos patrones anclados de cPanel**

En `.gitignore`, buscar (debe ser único):

```
# cPanel PHP secret config
api/config.php
api/usage_data.json
```

Reemplazar por:

```
# cPanel PHP secret config.
# Los patrones anteriores (api/config.php) llevaban barra, así que git los
# anclaba a la raíz del repo y nunca alcanzaron los archivos reales, que viven
# en Cpanel/public_html/api/. Por esa falla se filtró una API key en 318d187.
**/api/config.php
**/api/usage_data.json
```

- [ ] **Step 4: Verificar que los patrones ahora sí aplican**

Run:
```bash
git check-ignore -v Cpanel/public_html/api/config.php docs/desktop.ini .claude/settings.local.json
echo "--- skills NO debe salir ignorado ---"
git check-ignore -v .claude/skills/prueba/SKILL.md ; echo "exit=$?"
```

Expected: las tres primeras rutas aparecen con la regla que las ignora. La última no imprime nada y sale con `exit=1` (git usa 1 para "no ignorado"), confirmando que `.claude/skills/` sí se puede versionar.

- [ ] **Step 5: Sacar `config.php` del índice conservándolo en disco**

`.gitignore` no tiene efecto sobre archivos que git ya sigue, así que hay que sacarlo explícitamente. El despliegue de cPanel necesita el archivo en disco, por eso `--cached`.

Run:
```bash
git rm --cached Cpanel/public_html/api/config.php
ls -la Cpanel/public_html/api/config.php
```

Expected: git reporta `rm 'Cpanel/public_html/api/config.php'` y el `ls` confirma que el archivo **sigue existiendo** en disco.

`git rm --cached` ya deja la eliminación *staged*. En el Step 7 **no** hay que volver a hacer
`git add` sobre esa ruta: tras el nuevo `.gitignore` está ignorada, y `git add` sobre un
archivo ignorado falla con `paths are ignored by one of your .gitignore files`.

- [ ] **Step 6: Agregar el script de tests a `package.json`**

En `package.json`, buscar:

```json
  "scripts": {
    "build": "node scripts/sync-index.js && npm run build --prefix frontend",
    "prestart": "npm run build",
    "start": "node server.js"
  },
```

Reemplazar por:

```json
  "scripts": {
    "build": "node scripts/sync-index.js && npm run build --prefix frontend",
    "prestart": "npm run build",
    "start": "node server.js",
    "test": "node --test \"scripts/lib/*.test.js\""
  },
```

- [ ] **Step 7: Commit**

```bash
git add .gitignore package.json
git commit -m "Corregir patrones de .gitignore anclados a la raíz

desktop.ini de Google Drive no estaba ignorado y ensuciaba git status.
La regla .claude bloqueaba versionar .claude/skills/, necesario para
compartir skills con el equipo.

Los patrones api/config.php y api/usage_data.json llevaban barra, así que
git los anclaba a la raíz y nunca alcanzaron Cpanel/public_html/api/. Por
eso config.php quedó trackeado con una API key desde 318d187. Se corrige
el patrón y se saca del índice conservando el archivo en disco, que el
despliegue de cPanel necesita."
```

---

### Task 2: `extraerAnclas()` — mapa de bloques de `index.html`

Convierte el contenido de `index.html` en una lista de anclas (línea → etiqueta) que permite decir "esto cayó en el Bloque 9" en vez de "esto cayó en index.html".

**Files:**
- Create: `scripts/lib/analisis-ramas.js`
- Create: `scripts/lib/analisis-ramas.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: `extraerAnclas(contenido: string) => Array<{linea: number, etiqueta: string}>`, ordenado ascendente por `linea`. Lo consumen las Tasks 3 y 5.

- [ ] **Step 1: Escribir el test que falla**

Crear `scripts/lib/analisis-ramas.test.js`:

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { extraerAnclas } = require('./analisis-ramas');

test('extraerAnclas reconoce banners de una línea', () => {
  const src = [
    'let x = 1;',
    '    /* ================= STATE ================= */',
    'let y = 2;',
  ].join('\n');
  assert.deepStrictEqual(extraerAnclas(src), [{ linea: 2, etiqueta: 'STATE' }]);
});

test('extraerAnclas reconoce bloques PARCHE PT y conserva su título', () => {
  const src = [
    'a',
    '       PARCHE PT — Bloque 9:  MÁRGENES ATÍPICOS · COMPARABLES LOCALES ·',
    'b',
  ].join('\n');
  const anclas = extraerAnclas(src);
  assert.strictEqual(anclas.length, 1);
  assert.strictEqual(anclas[0].linea, 2);
  assert.match(anclas[0].etiqueta, /^PARCHE PT — Bloque 9: MÁRGENES ATÍPICOS/);
});

test('extraerAnclas reconoce MÓDULO en comentario', () => {
  const src = '// MÓDULO V3.5 — PERSISTENCIA IndexedDB + BASE AÑO ANTERIOR';
  assert.deepStrictEqual(extraerAnclas(src), [
    { linea: 1, etiqueta: 'MÓDULO V3.5 — PERSISTENCIA IndexedDB + BASE AÑO ANTERIOR' },
  ]);
});

test('extraerAnclas usa function/window como respaldo', () => {
  const src = [
    '    function moRows() {',
    '      return 1;',
    '    }',
    '    window.ORQ_OCR = {',
  ].join('\n');
  assert.deepStrictEqual(extraerAnclas(src), [
    { linea: 1, etiqueta: 'función moRows()' },
    { linea: 4, etiqueta: 'window.ORQ_OCR' },
  ]);
});

test('extraerAnclas prioriza el banner sobre el respaldo en la misma línea', () => {
  const src = '/* ===== ALGO ===== */ function noImporta() {';
  assert.deepStrictEqual(extraerAnclas(src), [{ linea: 1, etiqueta: 'ALGO' }]);
});

test('extraerAnclas maneja CRLF', () => {
  const src = 'a\r\n/* ==== UNO ==== */\r\nb';
  assert.deepStrictEqual(extraerAnclas(src), [{ linea: 2, etiqueta: 'UNO' }]);
});

test('extraerAnclas devuelve lista vacía si no hay anclas', () => {
  assert.deepStrictEqual(extraerAnclas('let a = 1;\nlet b = 2;'), []);
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `npm test`
Expected: FAIL con `Cannot find module './analisis-ramas'`.

- [ ] **Step 3: Implementar `extraerAnclas`**

Crear `scripts/lib/analisis-ramas.js`:

```js
'use strict';

/* Análisis de ramas: funciones puras, sin git y sin disco.
   Todo lo que toca el sistema vive en scripts/revisar-ramas.js. */

/* Deja una etiqueta legible: quita marcas de comentario, runs de = o ═ en los
   extremos, y colapsa espacios. */
function _normalizar(texto) {
  return String(texto)
    .replace(/^\s*\/\*+/, '')
    .replace(/\*+\/\s*$/, '')
    .replace(/^\s*(?:\/\/+|\*+)/, '')
    .replace(/^[\s=═─-]+/, '')
    .replace(/[\s=═─-]+$/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/* Banner de una línea: /* ===== ETIQUETA ===== *\/ — al menos 3 signos por lado. */
const RE_BANNER = /\/\*\s*[=═]{3,}\s*(.+?)\s*[=═]{3,}\s*\*\//;
const RE_PARCHE = /PARCHE PT\s*[—–-]\s*Bloque\b/;
const RE_MODULO = /^\s*(?:\/\*+|\/\/+|\*+)?\s*(MÓDULO\s+\S.*?)\s*$/;
const RE_FUNCION = /^\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/;
const RE_WINDOW = /^\s*window\.([A-Za-z_$][\w$]*)\s*=/;

/* Convierte el contenido de index.html en anclas {linea, etiqueta}, ordenadas
   por línea ascendente. Las etiquetas son estables entre versiones del archivo;
   los números de línea no lo son, y por eso el solapamiento se calcula siempre
   sobre etiquetas. */
function extraerAnclas(contenido) {
  const lineas = String(contenido).split(/\r?\n/);
  const anclas = [];

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i];
    let etiqueta = null;

    const banner = linea.match(RE_BANNER);
    if (banner) {
      etiqueta = _normalizar(banner[1]);
    } else if (RE_PARCHE.test(linea)) {
      etiqueta = _normalizar(linea);
    } else if (RE_MODULO.test(linea) && /^\s*(?:\/\*+|\/\/+|\*+)/.test(linea)) {
      etiqueta = _normalizar(linea);
    } else {
      const fn = linea.match(RE_FUNCION);
      const win = linea.match(RE_WINDOW);
      if (fn) etiqueta = 'función ' + fn[1] + '()';
      else if (win) etiqueta = 'window.' + win[1];
    }

    if (etiqueta) anclas.push({ linea: i + 1, etiqueta });
  }

  return anclas;
}

module.exports = { extraerAnclas };
```

- [ ] **Step 4: Correr los tests**

Run: `npm test`
Expected: PASS, 7 tests.

- [ ] **Step 5: Verificar contra el archivo real**

Run:
```bash
node -e "const {extraerAnclas}=require('./scripts/lib/analisis-ramas');const fs=require('fs');const a=extraerAnclas(fs.readFileSync('index.html','utf8'));console.log('anclas:',a.length);console.log(a.filter(x=>/PARCHE PT/.test(x.etiqueta)).slice(0,3));"
```

Expected: reporta varios cientos de anclas y las primeras entradas `PARCHE PT — Bloque 1 de 4: …`, `Bloque 2 de 4: COMPARABLES`, `Bloque 3 de 4: …`. Si no aparece ningún `PARCHE PT`, el regex está mal y hay que corregirlo antes de seguir.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/analisis-ramas.js scripts/lib/analisis-ramas.test.js package.json
git commit -m "Agregar extraerAnclas: mapa de bloques de index.html

Convierte el monolito en una lista de anclas linea->etiqueta para poder
reportar 'PARCHE PT — Bloque 9' en vez de 'conflicto en index.html', que
en 13k líneas no informa nada."
```

---

### Task 3: `parsearHunks()` y `etiquetasDeHunks()` — de diff a bloques

**Files:**
- Modify: `scripts/lib/analisis-ramas.js`
- Modify: `scripts/lib/analisis-ramas.test.js`

**Interfaces:**
- Consumes: `extraerAnclas` de la Task 2.
- Produces:
  - `parsearHunks(textoDiff: string) => Array<{inicio: number, fin: number}>` — rangos en la numeración del lado **nuevo** del diff.
  - `etiquetasDeHunks(hunks, anclas) => string[]` — etiquetas únicas, en el orden en que aparecen las anclas.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final de `scripts/lib/analisis-ramas.test.js`:

```js
const { parsearHunks, etiquetasDeHunks } = require('./analisis-ramas');

test('parsearHunks lee el rango del lado nuevo', () => {
  const diff = [
    'diff --git a/index.html b/index.html',
    '@@ -10,3 +12,5 @@ contexto',
    '+linea',
    '@@ -100 +200 @@',
    '+otra',
  ].join('\n');
  assert.deepStrictEqual(parsearHunks(diff), [
    { inicio: 12, fin: 16 },
    { inicio: 200, fin: 200 },
  ]);
});

test('parsearHunks trata el borrado puro (+c,0) como un punto', () => {
  assert.deepStrictEqual(parsearHunks('@@ -5,4 +7,0 @@'), [{ inicio: 7, fin: 7 }]);
});

test('parsearHunks devuelve vacío si no hay hunks', () => {
  assert.deepStrictEqual(parsearHunks('diff --git a/x b/x\nBinary files differ\n'), []);
});

test('etiquetasDeHunks atribuye el cambio al ancla anterior más cercana', () => {
  const anclas = [
    { linea: 10, etiqueta: 'UNO' },
    { linea: 50, etiqueta: 'DOS' },
    { linea: 90, etiqueta: 'TRES' },
  ];
  assert.deepStrictEqual(etiquetasDeHunks([{ inicio: 60, fin: 62 }], anclas), ['DOS']);
});

test('etiquetasDeHunks incluye todas las anclas que el hunk abarca', () => {
  const anclas = [
    { linea: 10, etiqueta: 'UNO' },
    { linea: 50, etiqueta: 'DOS' },
    { linea: 90, etiqueta: 'TRES' },
  ];
  assert.deepStrictEqual(
    etiquetasDeHunks([{ inicio: 40, fin: 95 }], anclas),
    ['UNO', 'DOS', 'TRES']
  );
});

test('etiquetasDeHunks marca lo anterior a la primera ancla', () => {
  const anclas = [{ linea: 100, etiqueta: 'UNO' }];
  assert.deepStrictEqual(etiquetasDeHunks([{ inicio: 5, fin: 6 }], anclas), [
    '(antes del primer bloque)',
  ]);
});

test('etiquetasDeHunks no repite etiquetas', () => {
  const anclas = [{ linea: 10, etiqueta: 'UNO' }];
  assert.deepStrictEqual(
    etiquetasDeHunks([{ inicio: 20, fin: 21 }, { inicio: 30, fin: 31 }], anclas),
    ['UNO']
  );
});

test('etiquetasDeHunks devuelve vacío sin anclas ni hunks', () => {
  assert.deepStrictEqual(etiquetasDeHunks([], []), []);
});
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `npm test`
Expected: FAIL con `parsearHunks is not a function`.

- [ ] **Step 3: Implementar ambas funciones**

En `scripts/lib/analisis-ramas.js`, agregar antes de `module.exports`:

```js
/* Cabecera de hunk: @@ -viejo,n +nuevo,m @@ — los conteos son opcionales.
   Interesa solo el lado nuevo, porque las anclas se calculan sobre la punta. */
const RE_HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/;

const SIN_BLOQUE = '(antes del primer bloque)';

/* Extrae los rangos de líneas modificadas, en la numeración del lado nuevo. */
function parsearHunks(textoDiff) {
  const hunks = [];
  for (const linea of String(textoDiff).split(/\r?\n/)) {
    const m = linea.match(RE_HUNK);
    if (!m) continue;
    const inicio = parseInt(m[1], 10);
    /* Sin conteo explícito el hunk es de una línea. Con conteo 0 el hunk es un
       borrado puro: no hay líneas nuevas, pero el cambio ocurre en ese punto. */
    const cantidad = m[2] === undefined ? 1 : parseInt(m[2], 10);
    const fin = cantidad === 0 ? inicio : inicio + cantidad - 1;
    hunks.push({ inicio, fin });
  }
  return hunks;
}

/* Atribuye cada hunk a los bloques que toca: el ancla vigente donde empieza,
   más todas las que caigan dentro del rango. */
function etiquetasDeHunks(hunks, anclas) {
  const ordenadas = [...anclas].sort((a, b) => a.linea - b.linea);
  const vistas = new Set();

  for (const hunk of hunks) {
    let vigente = null;
    for (const ancla of ordenadas) {
      if (ancla.linea <= hunk.inicio) vigente = ancla.etiqueta;
      else if (ancla.linea <= hunk.fin) vistas.add(ancla.etiqueta);
    }
    vistas.add(vigente === null ? SIN_BLOQUE : vigente);
  }

  /* Se devuelve en orden de aparición en el archivo, no de descubrimiento. */
  const orden = [SIN_BLOQUE, ...ordenadas.map((a) => a.etiqueta)];
  return orden.filter((e, i) => vistas.has(e) && orden.indexOf(e) === i);
}
```

Y cambiar la última línea del archivo por:

```js
module.exports = { extraerAnclas, parsearHunks, etiquetasDeHunks, SIN_BLOQUE };
```

- [ ] **Step 4: Correr los tests**

Run: `npm test`
Expected: PASS, 15 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/analisis-ramas.js scripts/lib/analisis-ramas.test.js
git commit -m "Agregar parsearHunks y etiquetasDeHunks

Traduce los rangos de un diff a los bloques de index.html que tocan,
usando la numeración del lado nuevo porque las anclas se calculan sobre
la punta de cada rama."
```

---

### Task 4: `interseccion()` y `ordenarPorSolapamiento()`

**Files:**
- Modify: `scripts/lib/analisis-ramas.js`
- Modify: `scripts/lib/analisis-ramas.test.js`

**Interfaces:**
- Consumes: nada de tareas previas.
- Produces:
  - `interseccion(a: string[], b: string[]) => string[]` — elementos de `a` presentes en `b`, sin repetir, en el orden de `a`.
  - `ordenarPorSolapamiento(companeros) => companeros` — copia ordenada ascendente por cantidad de bloques en conflicto y luego por archivos solapados. Lo usa la skill para integrar primero lo que menos choca.

- [ ] **Step 1: Escribir los tests que fallan**

Agregar al final de `scripts/lib/analisis-ramas.test.js`:

```js
const { interseccion, ordenarPorSolapamiento } = require('./analisis-ramas');

test('interseccion conserva el orden del primer arreglo', () => {
  assert.deepStrictEqual(interseccion(['c', 'a', 'b'], ['b', 'c']), ['c', 'b']);
});

test('interseccion no repite', () => {
  assert.deepStrictEqual(interseccion(['a', 'a'], ['a']), ['a']);
});

test('interseccion sin coincidencias devuelve vacío', () => {
  assert.deepStrictEqual(interseccion(['a'], ['b']), []);
});

test('ordenarPorSolapamiento pone primero lo que menos choca', () => {
  const entrada = [
    { rama: 'origin/c', solapamiento: ['x'], bloques_en_conflicto_potencial: ['A', 'B'] },
    { rama: 'origin/a', solapamiento: [], bloques_en_conflicto_potencial: [] },
    { rama: 'origin/b', solapamiento: ['x'], bloques_en_conflicto_potencial: ['A'] },
  ];
  assert.deepStrictEqual(
    ordenarPorSolapamiento(entrada).map((c) => c.rama),
    ['origin/a', 'origin/b', 'origin/c']
  );
});

test('ordenarPorSolapamiento no muta la entrada', () => {
  const entrada = [
    { rama: 'origin/b', solapamiento: ['x'], bloques_en_conflicto_potencial: ['A'] },
    { rama: 'origin/a', solapamiento: [], bloques_en_conflicto_potencial: [] },
  ];
  ordenarPorSolapamiento(entrada);
  assert.strictEqual(entrada[0].rama, 'origin/b');
});
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `npm test`
Expected: FAIL con `interseccion is not a function`.

- [ ] **Step 3: Implementar**

En `scripts/lib/analisis-ramas.js`, agregar antes de `module.exports`:

```js
/* Elementos de `a` presentes en `b`, sin repetir y en el orden de `a`. */
function interseccion(a, b) {
  const enB = new Set(b);
  const vistos = new Set();
  return a.filter((x) => {
    if (!enB.has(x) || vistos.has(x)) return false;
    vistos.add(x);
    return true;
  });
}

/* Ordena de menor a mayor roce con el trabajo propio. La skill integra en este
   orden para que, si algo revienta, ya esté integrado lo más simple. */
function ordenarPorSolapamiento(companeros) {
  return [...companeros].sort((x, y) => {
    const bx = (x.bloques_en_conflicto_potencial || []).length;
    const by = (y.bloques_en_conflicto_potencial || []).length;
    if (bx !== by) return bx - by;
    return (x.solapamiento || []).length - (y.solapamiento || []).length;
  });
}
```

Y cambiar la última línea del archivo por:

```js
module.exports = {
  extraerAnclas,
  parsearHunks,
  etiquetasDeHunks,
  interseccion,
  ordenarPorSolapamiento,
  SIN_BLOQUE,
};
```

- [ ] **Step 4: Correr los tests**

Run: `npm test`
Expected: PASS, 20 tests.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/analisis-ramas.js scripts/lib/analisis-ramas.test.js
git commit -m "Agregar interseccion y ordenarPorSolapamiento

El orden ascendente de solapamiento define en qué secuencia integra la
skill: primero la rama que menos choca, para acumular riesgo lo más tarde
posible."
```

---

### Task 5: `scripts/revisar-ramas.js` — capa git y salida JSON

**Files:**
- Create: `scripts/revisar-ramas.js`

**Interfaces:**
- Consumes: `extraerAnclas`, `parsearHunks`, `etiquetasDeHunks`, `interseccion`, `ordenarPorSolapamiento` de `scripts/lib/analisis-ramas.js`.
- Produces: ejecutable `node scripts/revisar-ramas.js` que emite por stdout el JSON descrito en el spec. Sale con código `0` siempre que haya podido emitir JSON —incluido `fetch_ok: false`— y con `1` solo si el directorio no es un repositorio git.

- [ ] **Step 1: Escribir el script completo**

Crear `scripts/revisar-ramas.js`:

```js
#!/usr/bin/env node
'use strict';

/* Escaneo determinista de las ramas de los compañeros.
   Solo lee: no muta el repo, no escribe en disco. Toda integración la decide y
   ejecuta la skill revisar-ramas-equipo a partir de este JSON. */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {
  extraerAnclas,
  parsearHunks,
  etiquetasDeHunks,
  interseccion,
  ordenarPorSolapamiento,
} = require('./lib/analisis-ramas');

const PRINCIPAL = 'origin/main';

/* Corre git y devuelve stdout. Lanza si git falla. */
function git(args) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

/* Igual, pero devuelve `null` en vez de lanzar. Para consultas que legítimamente
   pueden fallar, como merge-base entre historias no relacionadas. */
function gitOpcional(args) {
  try {
    return git(args);
  } catch (e) {
    return null;
  }
}

const lineas = (salida) =>
  String(salida || '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

/* Google Drive File Stream recrea desktop.ini dentro de .git/ cada vez que
   sincroniza. Git los lee como refs corruptas y fetch falla. No se puede
   prevenir con .gitignore, así que se detecta para dar un mensaje accionable. */
function desktopIniEnGit(dirGit) {
  const encontrados = [];
  const recorrer = (dir) => {
    let entradas;
    try {
      entradas = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const entrada of entradas) {
      const completo = path.join(dir, entrada.name);
      if (entrada.isDirectory()) recorrer(completo);
      else if (entrada.name.toLowerCase() === 'desktop.ini') encontrados.push(completo);
    }
  };
  recorrer(dirGit);
  return encontrados;
}

function main() {
  let dirGit;
  try {
    dirGit = git(['rev-parse', '--absolute-git-dir']).trim();
  } catch (e) {
    process.stderr.write('No es un repositorio git: ' + e.message + '\n');
    process.exit(1);
  }

  const resultado = {
    rama_actual: null,
    fetch_ok: false,
    error_fetch: null,
    arbol_limpio: true,
    mis_archivos_sin_commitear: [],
    mis_bloques_tocados: [],
    atras_de_main: 0,
    companeros: [],
  };

  const rama = git(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  resultado.rama_actual = rama === 'HEAD' ? null : rama;
  const yo = resultado.rama_actual || 'HEAD';

  /* --- fetch --- */
  try {
    git(['fetch', '--prune']);
    resultado.fetch_ok = true;
  } catch (e) {
    const sucios = desktopIniEnGit(dirGit);
    resultado.error_fetch =
      String(e.stderr || e.message).trim() +
      (sucios.length
        ? '\n\nCausa probable: hay ' +
          sucios.length +
          ' archivo(s) desktop.ini dentro de .git/, creados por Google Drive. ' +
          'Git los lee como refs corruptas. Limpiar con:\n' +
          "  find .git -name desktop.ini -delete"
        : '');
    /* Se sigue con los datos locales que haya: es mejor un reporte parcial y
       marcado que ninguno. La skill decide si continuar. */
  }

  /* --- estado del árbol propio --- */
  const sinCommitear = lineas(git(['diff', '--name-only', 'HEAD']));
  const noTrackeados = lineas(git(['ls-files', '--others', '--exclude-standard']));
  resultado.mis_archivos_sin_commitear = [...new Set([...sinCommitear, ...noTrackeados])];
  resultado.arbol_limpio = resultado.mis_archivos_sin_commitear.length === 0;

  /* --- cuánto me falta de main --- */
  const cuenta = gitOpcional(['rev-list', '--count', yo + '..' + PRINCIPAL]);
  resultado.atras_de_main = cuenta === null ? 0 : parseInt(cuenta.trim(), 10) || 0;

  /* --- mis propios cambios: archivos y bloques --- */
  const baseMain = gitOpcional(['merge-base', yo, PRINCIPAL]);
  const misArchivos = new Set(resultado.mis_archivos_sin_commitear);
  if (baseMain) {
    for (const f of lineas(git(['diff', '--name-only', baseMain.trim(), yo]))) {
      misArchivos.add(f);
    }
  }

  if (misArchivos.has('index.html') && fs.existsSync('index.html')) {
    const anclasMias = extraerAnclas(fs.readFileSync('index.html', 'utf8'));
    const partes = [];
    if (baseMain) {
      partes.push(gitOpcional(['diff', '-U0', baseMain.trim(), yo, '--', 'index.html']) || '');
    }
    partes.push(gitOpcional(['diff', '-U0', 'HEAD', '--', 'index.html']) || '');
    resultado.mis_bloques_tocados = etiquetasDeHunks(
      parsearHunks(partes.join('\n')),
      anclasMias
    );
  }

  /* --- ramas de compañeros --- */
  const remotas = lineas(
    gitOpcional(['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin']) || ''
  ).filter((r) => r !== PRINCIPAL && r !== 'origin/HEAD' && r !== 'origin/' + yo);

  for (const remota of remotas) {
    const compa = {
      rama: remota,
      ultimo: null,
      commits_que_me_faltan: [],
      archivos_tocados: [],
      solapamiento: [],
      bloques_en_conflicto_potencial: [],
      nota: null,
    };

    const base = gitOpcional(['merge-base', yo, remota]);
    if (!base) {
      compa.nota = 'Sin ancestro común con ' + yo + '; no se propone integrarla.';
      resultado.companeros.push(compa);
      continue;
    }
    const desde = base.trim();

    const ultimo = gitOpcional(['log', '-1', '--format=%an%x1f%ad%x1f%s', '--date=short', remota]);
    if (ultimo) {
      const [autor, fecha, asunto] = ultimo.trim().split('\x1f');
      compa.ultimo = { autor, fecha, asunto };
    }

    const log = gitOpcional(['log', '--format=%h%x1f%an%x1f%s', desde + '..' + remota]) || '';
    compa.commits_que_me_faltan = lineas(log).map((l) => {
      const [sha, autor, asunto] = l.split('\x1f');
      return { sha, autor, asunto };
    });

    compa.archivos_tocados = lineas(
      gitOpcional(['diff', '--name-only', desde, remota]) || ''
    );
    compa.solapamiento = interseccion(compa.archivos_tocados, [...misArchivos]);

    /* Bloques solo si ambos tocamos index.html: si no, no hay nada que cruzar. */
    if (compa.solapamiento.includes('index.html')) {
      const contenido = gitOpcional(['show', remota + ':index.html']);
      if (contenido === null) {
        compa.nota = 'index.html no existe en ' + remota + '; se omite el mapeo de bloques.';
      } else {
        const suyos = etiquetasDeHunks(
          parsearHunks(gitOpcional(['diff', '-U0', desde, remota, '--', 'index.html']) || ''),
          extraerAnclas(contenido)
        );
        compa.bloques_en_conflicto_potencial = interseccion(suyos, resultado.mis_bloques_tocados);
      }
    }

    resultado.companeros.push(compa);
  }

  resultado.companeros = ordenarPorSolapamiento(resultado.companeros);
  process.stdout.write(JSON.stringify(resultado, null, 2) + '\n');
}

main();
```

- [ ] **Step 2: Verificar la degradación limpia (criterio 1 del spec)**

Hoy solo existe `origin/main`, así que no hay ramas de compañeros. El script debe reportarlo sin reventar.

Run:
```bash
node scripts/revisar-ramas.js > salida-tmp.json ; echo "exit=$?"
node -e "const r=require('./salida-tmp.json');console.log('fetch_ok:',r.fetch_ok);console.log('rama:',r.rama_actual);console.log('companeros:',r.companeros.length);console.log('arbol_limpio:',r.arbol_limpio);"
```

(Ruta relativa a propósito: `require('/tmp/...')` en Windows resuelve contra la raíz de la
unidad, no contra el `/tmp` de Git Bash. El archivo se borra en el Step 4.)

Expected: `exit=0`, `fetch_ok: true`, `rama: juandev`, `companeros: 0`. Si `fetch_ok` sale `false`, revisar `error_fetch` — probablemente Google Drive recreó los `desktop.ini` en `.git/`.

- [ ] **Step 3: Verificar que el JSON es válido y completo**

Run:
```bash
node -e "const r=require('./salida-tmp.json');const req=['rama_actual','fetch_ok','error_fetch','arbol_limpio','mis_archivos_sin_commitear','mis_bloques_tocados','atras_de_main','companeros'];const faltan=req.filter(k=>!(k in r));console.log(faltan.length?'FALTAN: '+faltan:'todas las llaves presentes');"
```

Expected: `todas las llaves presentes`.

- [ ] **Step 4: Verificar la precisión del mapeo (criterio 2 del spec)**

Crear una rama de prueba que toque un bloque conocido y confirmar que el script lo nombra.

El script se corre **estando parado en la rama de prueba**: `mis_bloques_tocados` describe la
rama actual, así que volver a `juandev` antes de medir daría vacío.

Run:
```bash
rm -f salida-tmp.json
git stash push -u -m "antes-de-probar-revisar-ramas" || true
git checkout -b prueba-solapamiento
node -e "
const fs=require('fs');
const src=fs.readFileSync('index.html','utf8').split(/\r?\n/);
const i=src.findIndex(l=>/PARCHE PT\s*[—–-]\s*Bloque 9/.test(l));
if(i<0){console.error('no se encontró el Bloque 9');process.exit(1);}
src.splice(i+3,0,'      /* marca temporal de prueba */');
fs.writeFileSync('index.html',src.join('\r\n'));
console.log('marca insertada en la línea '+(i+4));
"
git commit -qam "temporal: marca de prueba en el Bloque 9"
node scripts/revisar-ramas.js | node -e "
let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{
  const r=JSON.parse(s);
  console.log('mis_bloques_tocados:',r.mis_bloques_tocados);
});"
```

Expected: `mis_bloques_tocados` contiene una etiqueta que empieza con `PARCHE PT — Bloque 9`.
Si nombra un bloque vecino, el mapeo está corrido y hay que revisar `etiquetasDeHunks` antes
de seguir.

- [ ] **Step 5: Limpiar la rama de prueba**

Run:
```bash
git checkout juandev
git branch -D prueba-solapamiento
git stash pop || true
git status --short
```

Expected: vuelve a `juandev`, la rama de prueba desaparece y el árbol queda como estaba antes
del Step 4.

- [ ] **Step 6: Commit**

```bash
git add scripts/revisar-ramas.js
git commit -m "Agregar scripts/revisar-ramas.js

Escaneo determinista de ramas remotas: commits que faltan, archivos
tocados, solapamiento con el trabajo propio y bloques de index.html en
conflicto potencial. Solo lee; no muta el repo.

Detecta el desktop.ini de Google Drive dentro de .git/ como causa
probable cuando fetch falla, porque .gitignore no cubre .git/ y el
problema se repite en cada sincronización."
```

---

### Task 6: La skill `revisar-ramas-equipo`

**Files:**
- Create: `.claude/skills/revisar-ramas-equipo/SKILL.md`

**Interfaces:**
- Consumes: `node scripts/revisar-ramas.js` de la Task 5, y `.claude/skills/` versionado por la Task 1.
- Produces: skill invocable como `/revisar-ramas-equipo`.

- [ ] **Step 1: Confirmar que la ruta ya no está ignorada**

Run: `git check-ignore -v .claude/skills/revisar-ramas-equipo/SKILL.md ; echo "exit=$?"`
Expected: sin salida y `exit=1`. Si imprime una regla, la Task 1 quedó mal y hay que corregirla antes de seguir — si no, el archivo se creará pero nunca llegará a los compañeros.

- [ ] **Step 2: Crear el SKILL.md**

Crear `.claude/skills/revisar-ramas-equipo/SKILL.md`:

````markdown
---
name: revisar-ramas-equipo
description: Usar al empezar a trabajar en este repo o antes de aplicar cambios propios — trae las ramas remotas de los compañeros, reporta qué cambiaron y dónde se solapa con tu trabajo en index.html, y las integra abortando ante cualquier conflicto fuera de public/.
---

# Revisar las ramas del equipo antes de seguir

El equipo trabaja en ramas separadas sobre un `index.html` de ~13 000 líneas que
todos editan. El riesgo no es el conflicto de git —ese avisa— sino descubrir
tarde que alguien ya arregló lo que estás arreglando.

Anunciar al empezar: "Usando revisar-ramas-equipo para ver qué cambiaron tus compañeros."

## Procedimiento

### 1. Escanear

```bash
node scripts/revisar-ramas.js
```

Emite JSON por stdout. **No volcarlo al usuario**: es insumo, no reporte.

### 2. Si `fetch_ok` es `false`, parar

Mostrar `error_fetch` tal cual. Si menciona `desktop.ini`, dar el comando de
limpieza y explicar que Google Drive los recrea en cada sincronización, así que
va a repetirse. No continuar con datos viejos: un reporte de ramas
desactualizadas es peor que ninguno, porque da falsa confianza.

### 3. Si `companeros` está vacío, terminar

No es un error. Informar que no hay ramas de compañeros además de `main`, y
mencionar `atras_de_main` si es mayor que cero.

### 4. Reportar en prosa

Por cada compañero: quién, cuándo, qué hizo (a partir de `commits_que_me_faltan`),
y si `bloques_en_conflicto_potencial` no está vacío, decir explícitamente en qué
bloques de `index.html` chocan. Esa es la información que importa; el resto es
contexto.

Si `atras_de_main` es mayor que cero, mencionarlo también.

### 5. Compuerta: árbol limpio

Si `arbol_limpio` es `false`, **parar** y pedir al usuario que haga commit o
stash de `mis_archivos_sin_commitear`. No integrar sobre trabajo sin guardar.

### 6. Punto de retorno

Antes de tocar nada:

```bash
git rev-parse HEAD
```

Comunicar el SHA al usuario de forma explícita, diciéndole que puede volver con
`git reset --hard <sha>`. Debe quedar en el chat, no solo en memoria de la
sesión.

### 7. Integrar, de menor a mayor solapamiento

`companeros` ya viene ordenado así. Una rama a la vez:

```bash
git merge --no-ff origin/<rama>
```

### 8. Ante conflicto, mirar dónde cayó

```bash
git diff --name-only --diff-filter=U
```

**Si todas las rutas están bajo `public/`:** no es un conflicto real, ese
directorio es 100 % generado. Resolver regenerando:

```bash
git checkout --ours -- public/
npm run build
git add public/
git commit --no-edit
```

**Si alguna ruta está fuera de `public/`:** abortar y parar.

```bash
git merge --abort
```

Reportar qué bloques chocaron y esperar instrucciones. No intentar resolver el
conflicto: no hay tests que atrapen un merge mal hecho en este repo.

### 9. Cerrar

Tras integrar todas las ramas:

```bash
npm run build
git diff --stat
```

Confirmar que `public/index.html` quedó sincronizado. Recordar al usuario que la
verificación funcional es manual en el navegador, porque el repo no tiene tests
de la aplicación.

## Qué no hacer

- No resolver conflictos de lógica automáticamente.
- No integrar con el árbol sucio.
- No editar `public/index.html` a mano: se regenera con `npm run build` desde
  `index.html` de la raíz.
- No seguir si `fetch` falló.
````

- [ ] **Step 3: Verificar que la skill se detecta**

Run: `ls -la .claude/skills/revisar-ramas-equipo/ && head -4 .claude/skills/revisar-ramas-equipo/SKILL.md`
Expected: el archivo existe y el frontmatter tiene `name` y `description`. La skill aparece en el listado tras reiniciar Claude Code.

- [ ] **Step 4: Commit**

```bash
git add .claude/skills/revisar-ramas-equipo/SKILL.md
git commit -m "Agregar skill revisar-ramas-equipo

Consume el JSON de scripts/revisar-ramas.js, reporta en prosa e integra
de menor a mayor solapamiento. Aborta ante cualquier conflicto fuera de
public/, que al ser directorio generado se resuelve regenerándolo.

Va versionada en .claude/skills/ para que llegue al equipo con git pull."
```

---

### Task 7: Documentar en `CLAUDE.md` y verificación final

**Files:**
- Modify: `CLAUDE.md` — sección "Comandos" y una sección nueva

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: nada que consuman otras tareas.

- [ ] **Step 1: Agregar el comando de tests a la sección Comandos**

En `CLAUDE.md`, buscar:

```
npm run lint --prefix frontend    # oxlint (única herramienta de lint del repo)
```

Reemplazar por:

```
npm run lint --prefix frontend    # oxlint (única herramienta de lint del repo)
npm test               # node --test sobre scripts/lib/ — cubre solo los helpers de scripts/
```

- [ ] **Step 2: Ajustar la afirmación sobre tests**

En `CLAUDE.md`, buscar:

```
**No hay suite de tests automatizada.** La verificación de un cambio es: (a) `grep` de que
ningún símbolo eliminado siga referenciado, y (b) prueba manual en el navegador. No afirmes
que algo "pasa los tests"; describe qué verificaste y cómo.
```

Reemplazar por:

```
**La aplicación no tiene tests.** `npm test` cubre únicamente los helpers de `scripts/lib/`;
nada de `index.html` ni de `frontend/` está bajo test. Para un cambio en la aplicación la
verificación es: (a) `grep` de que ningún símbolo eliminado siga referenciado, y (b) prueba
manual en el navegador. No afirmes que algo "pasa los tests" apoyándote en `npm test` si
tocaste la aplicación; describe qué verificaste y cómo.
```

- [ ] **Step 3: Agregar la sección de trabajo en equipo**

En `CLAUDE.md`, buscar:

```
## Notas sueltas
```

Reemplazar por:

```
## Trabajo en equipo

Cada quien trabaja en su rama (`juandev` y las que definan los demás) sobre un `index.html`
que todos editan. Antes de empezar a aplicar cambios propios, correr:

```
/revisar-ramas-equipo
```

Trae las ramas remotas, reporta qué cambió cada compañero **mapeado al bloque concreto de
`index.html` que toca** —no "conflicto en index.html", que en 13 000 líneas no informa nada—
e integra de menor a mayor solapamiento, abortando ante cualquier conflicto fuera de
`public/`. Correrla al empezar, no al terminar: el punto es enterarse antes de duplicar
trabajo.

No requiere instalación. Vive en `.claude/skills/` y llega con `git pull`.

Su parte determinista es `scripts/revisar-ramas.js`, que solo lee y se puede correr suelto
si se quiere el JSON crudo.

**Si `git fetch` falla con `bad object refs/desktop.ini`**, es Google Drive: crea
`desktop.ini` dentro de `.git/refs/` y git los lee como refs corruptas. `.gitignore` no cubre
`.git/`, así que se repite en cada sincronización. Limpiar con
`find .git -name desktop.ini -delete`.

## Notas sueltas
```

- [ ] **Step 4: Verificar el criterio 3 del spec — el abort no deja rastro**

Es el criterio más importante: si el abort no deja el árbol intacto, la skill es peligrosa.

Los Steps 4 y 5 corren en invocaciones de shell distintas y **las variables de entorno no
sobreviven entre ellas**. Por eso el punto de retorno se marca con un tag de git, que sí
persiste, en vez de con una variable.

Run:
```bash
git tag sdd-punto-retorno
git checkout -b prueba-conflicto
node -e "
const fs=require('fs');
const s=fs.readFileSync('index.html','utf8').split(/\r?\n/);
s.splice(2000,0,'/* version rama de prueba */');
fs.writeFileSync('index.html',s.join('\r\n'));
"
git commit -qam "temporal: conflicto A"
git checkout juandev
node -e "
const fs=require('fs');
const s=fs.readFileSync('index.html','utf8').split(/\r?\n/);
s.splice(2000,0,'/* version juandev incompatible */');
fs.writeFileSync('index.html',s.join('\r\n'));
"
git commit -qam "temporal: conflicto B"
SHA_PRE_MERGE=$(git rev-parse HEAD)
git merge --no-ff prueba-conflicto ; echo "merge exit=$?"
git merge --abort
echo "--- despues del abort ---"
git status --short
echo "SHA igual: $([ "$(git rev-parse HEAD)" = "$SHA_PRE_MERGE" ] && echo SI || echo NO)"
```

Expected: el merge falla con conflicto, y tras el abort `git status --short` sale **vacío** y `SHA igual: SI`.

- [ ] **Step 5: Deshacer la prueba**

Run:
```bash
git reset --hard "$SHA_ANTES"
git branch -D prueba-conflicto
git log --oneline -1
git status --short
```

Expected: `git log` muestra el commit previo a la prueba y `git status` sale vacío.

Nota: el criterio 4 del spec (excepción de `public/`) se verifica en la primera integración real con una rama de compañero, porque provocar un conflicto que caiga *solo* en `public/` requiere que dos ramas hayan corrido `npm run build` sobre fuentes distintas. Anotarlo como pendiente y confirmarlo la primera vez que ocurra.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md
git commit -m "Documentar la skill de revisión de ramas en CLAUDE.md

Agrega la sección de trabajo en equipo, el comando npm test y precisa que
los tests cubren scripts/lib/ pero no la aplicación, para que nadie
concluya que 'npm test pasa' significa que index.html funciona."
```

---

## Verificación final

Con las siete tareas hechas:

```bash
npm test                                    # 20 tests en verde
node scripts/revisar-ramas.js | head -20    # JSON válido, fetch_ok: true
git check-ignore -v docs/desktop.ini        # ignorado
git check-ignore .claude/skills/x ; echo $? # 1 = no ignorado
git ls-files Cpanel/public_html/api/config.php   # sin salida
git status --short                          # limpio
```

Queda pendiente, y es acción del usuario, no de este plan: **revocar la API key de Anthropic
filtrada en `318d187`** y decidir si se purga de la historia. Corregir `.gitignore` evita la
próxima filtración; no neutraliza la actual.
