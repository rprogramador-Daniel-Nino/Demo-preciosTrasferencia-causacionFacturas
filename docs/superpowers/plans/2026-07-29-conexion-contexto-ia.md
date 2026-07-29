# Conectar el contexto completo del estudio a la IA de redacción — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que `ptContextoCompleto()` (la única función que arma el contexto que reciben ambos motores de redacción) incluya actividad/margen por comparable, motivo de rechazo por compañía y el contexto económico ya cargado (`e_mundo/e_col/e_sec`); y que las referencias normativas de internet (`PT_NORMATIVA_WEB`) se impriman en el informe final sin depender de que se haya aplicado el Motor 2.

**Architecture:** Cinco ediciones quirúrgicas dentro de `index.html` (archivo raíz — nunca `public/index.html`, que se genera con `npm run build`). No se crean archivos nuevos ni abstracciones: se extienden los `P.push(...)` que ya arma `ptContextoCompleto()`, se separa un `if` en `ptIntegralInformeHTML()`, y se sube el tope de dos `.slice()` reemplazándolos por un helper nuevo (`ptTruncarContexto`) que no corta un bloque a la mitad.

**Tech Stack:** JavaScript vanilla embebido en `index.html` (sin build tool ni framework de test). Verificación de sintaxis vía Node (`new Function(...)` sobre cada bloque `<script>`, sin ejecutar el código). Verificación funcional manual en el navegador (no hay DOM en Node).

## Global Constraints

- Editar siempre `index.html` (raíz). Nunca `public/index.html` directamente — `npm run build` (que corre `node scripts/sync-index.js`) lo sincroniza desde la raíz; editar `public/` causa drift.
- No inventar ni completar cifras: todo texto agregado al contexto debe ser el dato ya existente en el estado de la app (`o.pli`, `o.sic`, `DESCS[o.name]`, `m.motivo`, valores de los campos del formulario). Ningún valor se calcula ni se estima de nuevo.
- Cada tarea es una edición aislada y verificable por separado; no mezclar dos tareas en un mismo commit.
- Al final de todas las tareas, correr `npm run build` una sola vez para sincronizar `public/index.html`.

---

## Verificación de sintaxis (se usa en cada tarea)

El archivo no tiene test runner. La verificación automática de cada tarea es un chequeo de sintaxis: extrae los 3 bloques `<script>...</script>` de `index.html` y los compila (sin ejecutar) con `new Function(...)`. Esto detecta errores de sintaxis (paréntesis/comillas mal cerrados) introducidos por la edición, sin necesitar DOM.

Comando reutilizable (Node, sin dependencias):

```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const blocks = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if (blocks.length !== 3) { console.error('Se esperaban 3 bloques <script>, se encontraron ' + blocks.length); process.exit(1); }
blocks.forEach((s, i) => { try { new Function(s); } catch (e) { console.error('Bloque ' + i + ' ERROR: ' + e.message); process.exit(1); } });
console.log('OK: los 3 bloques <script> compilan sin errores de sintaxis.');
"
```

Expected en cada tarea: `OK: los 3 bloques <script> compilan sin errores de sintaxis.`

---

### Task 1: Comparables seleccionadas con SIC, PLI individual y actividad

**Files:**
- Modify: `index.html:9619-9624` (dentro de `window.ptContextoCompleto`, bloque `if (window.MOTOR && MOTOR.activo)`)

**Interfaces:**
- Consumes: `moRows()` (ya calcula `o.pli`, `o.sic`, `o.id`, `o.previa` por fila — `index.html:3588`), `DESCS` (mapa global `nombre → descripción`, `index.html:1985`).
- Produces: ningún símbolo nuevo; el string devuelto por `ptContextoCompleto()` simplemente incluye más detalle en el bloque `CONJUNTO DE COMPARABLES`.

- [ ] **Step 1: Confirmar el texto actual exacto antes de editar**

Buscar en `index.html` el bloque exacto (debe aparecer una sola vez):

```js
          if (window.MOTOR && MOTOR.activo) {
            var seleccionadas = moRows().filter(function (o) { return MOTOR.sel[nameKey(o.name)] === true; });
            var nPrevias = seleccionadas.filter(function (o) { return o.previa; }).length;
            P.push('CONJUNTO DE COMPARABLES\n· ' + seleccionadas.length + ' compañías: ' +
              seleccionadas.map(function (o) { return o.name + ' [' + (o.id || 's/id') + ']'; }).join(' · ') +
              '\n· Del estudio anterior: ' + nPrevias + ' · nuevas: ' + (seleccionadas.length - nPrevias));
          }
```

Si el texto no coincide exactamente (por ejemplo porque otra sesión volvió a tocar esta función), releer `index.html` alrededor de la línea donde aparece `CONJUNTO DE COMPARABLES` antes de continuar — no adivinar la ubicación por número de línea.

- [ ] **Step 2: Reemplazar por la versión con detalle por comparable**

```js
          if (window.MOTOR && MOTOR.activo) {
            var seleccionadas = moRows().filter(function (o) { return MOTOR.sel[nameKey(o.name)] === true; });
            var nPrevias = seleccionadas.filter(function (o) { return o.previa; }).length;
            P.push('CONJUNTO DE COMPARABLES\n· ' + seleccionadas.length + ' compañías (nombre [id · SIC] · PLI individual · actividad):\n' +
              seleccionadas.map(function (o) {
                var pliPct = (o.pli !== null && o.pli !== undefined) ? (o.pli * 100).toFixed(2) + ' %' : 's/d';
                var desc = (DESCS[o.name] || '').replace(/\s+/g, ' ').trim().slice(0, 220);
                return '  - ' + o.name + ' [' + (o.id || 's/id') + ' · SIC ' + (o.sic || 's/d') + '] · PLI ' + pliPct + (desc ? ' · ' + desc : '');
              }).join('\n') +
              '\n· Del estudio anterior: ' + nPrevias + ' · nuevas: ' + (seleccionadas.length - nPrevias));
          }
```

- [ ] **Step 3: Verificar sintaxis**

Correr el comando de verificación de sintaxis de la sección de arriba.
Expected: `OK: los 3 bloques <script> compilan sin errores de sintaxis.`

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
Incluir SIC, PLI individual y actividad de cada comparable en el contexto de la IA

ptContextoCompleto() solo enviaba nombre e id por comparable seleccionada;
la IA no tenía base real para redactar el análisis competitivo ni el
sustento de comparabilidad.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Motivo de rechazo por compañía (no solo agregado)

**Files:**
- Modify: `index.html:9609-9618` (dentro de `window.ptContextoCompleto`, bloque `if (window.MATRIX && MATRIX.length)`)

**Interfaces:**
- Consumes: `MATRIX` (array global `{name, sic, country, rev, status, motivo}` por compañía del universo evaluado — poblado en `index.html:3913` y `index.html:8260`).
- Produces: el bloque `DEPURACIÓN DEL UNIVERSO` del contexto pasa a incluir una línea por compañía rechazada.

- [ ] **Step 1: Confirmar el texto actual exacto antes de editar**

```js
          if (window.MATRIX && MATRIX.length) {
            var acc = MATRIX.filter(function (m) { return /acept/i.test(m.status || ''); }).length;
            var motivos = {};
            MATRIX.filter(function (m) { return !/acept/i.test(m.status || ''); }).forEach(function (m) {
              var k = m.motivo || 'Sin motivo registrado'; motivos[k] = (motivos[k] || 0) + 1;
            });
            P.push('DEPURACIÓN DEL UNIVERSO\n· Universo ' + MATRIX.length + ' · aceptadas ' + acc +
              ' · rechazadas ' + (MATRIX.length - acc) + '\n· Motivos: ' + Object.keys(motivos).map(function (k) { return k + ' (' + motivos[k] + ')'; }).join(' · '));
          }
```

Si no coincide exactamente, releer `index.html` alrededor de `DEPURACIÓN DEL UNIVERSO` antes de continuar.

- [ ] **Step 2: Reemplazar por la versión con detalle por compañía**

```js
          if (window.MATRIX && MATRIX.length) {
            var acc = MATRIX.filter(function (m) { return /acept/i.test(m.status || ''); }).length;
            var rechazadas = MATRIX.filter(function (m) { return !/acept/i.test(m.status || ''); });
            var motivos = {};
            rechazadas.forEach(function (m) {
              var k = m.motivo || 'Sin motivo registrado'; motivos[k] = (motivos[k] || 0) + 1;
            });
            P.push('DEPURACIÓN DEL UNIVERSO\n· Universo ' + MATRIX.length + ' · aceptadas ' + acc +
              ' · rechazadas ' + rechazadas.length + '\n· Motivos: ' + Object.keys(motivos).map(function (k) { return k + ' (' + motivos[k] + ')'; }).join(' · ') +
              '\n· Detalle por compañía rechazada:\n' + rechazadas.map(function (m) { return '  - ' + m.name + ': ' + (m.motivo || 'Sin motivo registrado'); }).join('\n'));
          }
```

- [ ] **Step 3: Verificar sintaxis**

Mismo comando de la sección de arriba.
Expected: `OK: los 3 bloques <script> compilan sin errores de sintaxis.`

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
Enviar el motivo de rechazo por compañía a la IA, no solo el conteo agregado

MATRIX ya guarda el motivo individual real de cada compañía rechazada, pero
ptContextoCompleto() solo enviaba conteos por categoría de motivo. La DIAN
exige sustentar la aceptación/rechazo de cada comparable (Decreto 1625 de
2016, art. 1.2.2.2.1.5 num. 4); la IA necesita ese detalle para redactarlo.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Contexto económico ya cargado (`e_mundo`/`e_col`/`e_sec`)

**Files:**
- Modify: `index.html:9595-9598` (dentro de `window.ptContextoCompleto`, entre el `P.push` de estados financieros y el comentario `/* operaciones */`)

**Interfaces:**
- Consumes: el helper local `g(id)` ya definido al inicio de `ptContextoCompleto` (`var g = function (id) { ... }`, lee `$(id).value`).
- Produces: nuevo bloque `CONTEXTO ECONÓMICO YA CARGADO EN EL ESTUDIO` en el string devuelto, presente solo si alguno de los tres campos tiene contenido.

- [ ] **Step 1: Confirmar el texto actual exacto antes de editar**

```js
        P.push('ESTADOS FINANCIEROS DE LA PARTE EXAMINADA\n· ' + eeff +
          (window.LAST && window.LAST.tPLI !== null && window.LAST.tPLI !== undefined ? '\n· Indicador aplicado: ' + g('pli') + ' = ' + (window.LAST.tPLI * 100).toFixed(3) + ' %' : ''));

        /* operaciones */
```

Si no coincide exactamente, releer `index.html` alrededor de `ESTADOS FINANCIEROS DE LA PARTE EXAMINADA` antes de continuar.

- [ ] **Step 2: Insertar el nuevo bloque entre ambos, sin tocar ninguno de los dos**

```js
        P.push('ESTADOS FINANCIEROS DE LA PARTE EXAMINADA\n· ' + eeff +
          (window.LAST && window.LAST.tPLI !== null && window.LAST.tPLI !== undefined ? '\n· Indicador aplicado: ' + g('pli') + ' = ' + (window.LAST.tPLI * 100).toFixed(3) + ' %' : ''));

        /* contexto económico ya cargado en el estudio (plantilla ECON del sistema o edición manual del usuario) */
        try {
          var econTxt = ['e_mundo', 'e_col', 'e_sec'].map(function (id) { return g(id); });
          if (econTxt[0] || econTxt[1] || econTxt[2]) {
            P.push('CONTEXTO ECONÓMICO YA CARGADO EN EL ESTUDIO\n' +
              (econTxt[0] ? '· Economía mundial: ' + econTxt[0] + '\n' : '') +
              (econTxt[1] ? '· Economía colombiana: ' + econTxt[1] + '\n' : '') +
              (econTxt[2] ? '· Sector: ' + econTxt[2] : ''));
          }
        } catch (e) { }

        /* operaciones */
```

- [ ] **Step 3: Verificar sintaxis**

Mismo comando de la sección de arriba.
Expected: `OK: los 3 bloques <script> compilan sin errores de sintaxis.`

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
Incluir en el contexto de la IA el análisis económico ya cargado (e_mundo/e_col/e_sec)

ptEconomiaAuto() aplica la plantilla ECON[año] (o el usuario la edita a
mano) directo en los campos del formulario, pero ptContextoCompleto() nunca
los leía. La IA redactaba otros apartados (método, sector) sin ver los
datos macro/sectoriales que el propio estudio ya tenía cargados.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: `PT_NORMATIVA_WEB` deja de depender de `PT_INFORME_IA.aplicado`

**Files:**
- Modify: `index.html:11268-11290` (`window.ptIntegralInformeHTML`)

**Interfaces:**
- Consumes: `window.PT_INFORME_IA` (resultado del Motor 2), `window.PT_NORMATIVA_WEB` (array poblado de forma independiente por `ptBuscarNormativa`).
- Produces: `window.ptIntegralInformeHTML()` sigue devolviendo un string HTML (mismo contrato); ya no depende exclusivamente de `PT_INFORME_IA.aplicado` para incluir la sección de normativa.

- [ ] **Step 1: Confirmar el texto actual exacto antes de editar**

```js
      window.ptIntegralInformeHTML = function () {
        var R = window.PT_INFORME_IA;
        if (!R || !R.aplicado) return '';
        var x = '<h3 class="rep">Fuentes consultadas para la elaboración de este informe</h3>' +
          '<p class="norm">Los apartados económicos y sectoriales se elaboraron consultando las fuentes que se relacionan, ' +
          'conforme al deber de identificar el origen de la información utilizada en el análisis (Decreto 1625 de 2016, art. 1.2.2.2.1.5 num. 4). ' +
          'Las cifras de la compañía y del grupo provienen de la documentación aportada por el contribuyente.</p>';
        if (R.fuentes.length) {
          x += '<table class="rep"><thead><tr><th>Apartado</th><th>Fuentes consultadas</th></tr></thead><tbody>' +
            Object.keys(R.campos).filter(function (k) { return (R.campos[k].fuentes || []).length; }).map(function (k) {
              return '<tr><td>' + escH(R.campos[k].tit) + '</td><td>' + (R.campos[k].fuentes || []).map(escH).join('<br>') + '</td></tr>';
            }).join('') + '</tbody></table>';
        }
        if (window.PT_NORMATIVA_WEB && PT_NORMATIVA_WEB.length) {
          x += '<h3 class="rep">Referencias normativas incorporadas</h3>' +
            '<table class="rep"><thead><tr><th>Tipo</th><th>Referencia</th><th>Tesis</th><th>Estado</th></tr></thead><tbody>' +
            PT_NORMATIVA_WEB.map(function (n) {
              return '<tr><td>' + escH(n.tipo || '') + '</td><td>' + escH(n.ref || '') + '</td><td>' + escH((n.tesis || '').slice(0, 160)) + '</td><td>' +
                (n.verificada ? 'Verificada' : 'Pendiente de verificar contra el texto oficial') + '</td></tr>';
            }).join('') + '</tbody></table>';
        }
        return x;
      };
```

Si no coincide exactamente, releer `index.html` alrededor de `ptIntegralInformeHTML` antes de continuar.

- [ ] **Step 2: Separar el guard: la tabla de fuentes por apartado sigue exigiendo `R.aplicado`; la de normativa no**

```js
      window.ptIntegralInformeHTML = function () {
        var R = window.PT_INFORME_IA;
        var x = '';
        if (R && R.aplicado) {
          x += '<h3 class="rep">Fuentes consultadas para la elaboración de este informe</h3>' +
            '<p class="norm">Los apartados económicos y sectoriales se elaboraron consultando las fuentes que se relacionan, ' +
            'conforme al deber de identificar el origen de la información utilizada en el análisis (Decreto 1625 de 2016, art. 1.2.2.2.1.5 num. 4). ' +
            'Las cifras de la compañía y del grupo provienen de la documentación aportada por el contribuyente.</p>';
          if (R.fuentes.length) {
            x += '<table class="rep"><thead><tr><th>Apartado</th><th>Fuentes consultadas</th></tr></thead><tbody>' +
              Object.keys(R.campos).filter(function (k) { return (R.campos[k].fuentes || []).length; }).map(function (k) {
                return '<tr><td>' + escH(R.campos[k].tit) + '</td><td>' + (R.campos[k].fuentes || []).map(escH).join('<br>') + '</td></tr>';
              }).join('') + '</tbody></table>';
          }
        }
        if (window.PT_NORMATIVA_WEB && PT_NORMATIVA_WEB.length) {
          x += '<h3 class="rep">Referencias normativas incorporadas</h3>' +
            '<table class="rep"><thead><tr><th>Tipo</th><th>Referencia</th><th>Tesis</th><th>Estado</th></tr></thead><tbody>' +
            PT_NORMATIVA_WEB.map(function (n) {
              return '<tr><td>' + escH(n.tipo || '') + '</td><td>' + escH(n.ref || '') + '</td><td>' + escH((n.tesis || '').slice(0, 160)) + '</td><td>' +
                (n.verificada ? 'Verificada' : 'Pendiente de verificar contra el texto oficial') + '</td></tr>';
            }).join('') + '</tbody></table>';
        }
        return x;
      };
```

- [ ] **Step 3: Verificar sintaxis**

Mismo comando de la sección de arriba.
Expected: `OK: los 3 bloques <script> compilan sin errores de sintaxis.`

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
Imprimir referencias normativas de internet aunque no se haya aplicado el Motor 2

ptBuscarNormativa() puebla PT_NORMATIVA_WEB de forma independiente de
cualquier motor de redacción, pero ptIntegralInformeHTML() solo la
imprimía si PT_INFORME_IA.aplicado existía — quedaba huérfana si el
usuario solo usó el Motor 1 o solo buscó normativa sin redactar.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Subir el presupuesto de contexto y no cortar un bloque a la mitad

**Files:**
- Modify: `index.html:9648` (agregar `window.ptTruncarContexto` justo después del cierre de `window.ptContextoCompleto`)
- Modify: `index.html:9822` (`redaccionIA`, Motor 1)
- Modify: `index.html:11124` (`redactarSeccion`, Motor 2)

**Interfaces:**
- Produces: `window.ptTruncarContexto(str, max) → string` — global, usable desde cualquier IIFE del archivo.
- Consumes (en los otros dos puntos): `window.ptTruncarContexto`.

- [ ] **Step 1: Confirmar el texto actual exacto del cierre de `ptContextoCompleto`**

```js
        return P.join('\n\n────────────────\n\n');
      };

      /* ───────────────────────────────────────────────────────────────────────
         3. SUSTENTO NORMATIVO POR TEMA
```

Si no coincide exactamente, buscar el cierre real de `window.ptContextoCompleto` (el `return P.join(...)` seguido del `};` que cierra la función) antes de continuar.

- [ ] **Step 2: Agregar el helper de truncado justo después**

```js
        return P.join('\n\n────────────────\n\n');
      };

      /* Corta el contexto sin partir un bloque a la mitad: busca el último
         separador de bloque anterior al límite. Si no hay separador dentro
         del límite, corta tal cual (mejor eso que fallar). */
      window.ptTruncarContexto = function (str, max) {
        str = String(str || '');
        if (str.length <= max) return str;
        var sep = '\n\n────────────────\n\n';
        var corte = str.lastIndexOf(sep, max);
        return corte > 0 ? str.slice(0, corte) : str.slice(0, max);
      };

      /* ───────────────────────────────────────────────────────────────────────
         3. SUSTENTO NORMATIVO POR TEMA
```

- [ ] **Step 3: Confirmar el texto actual exacto en `redaccionIA` (Motor 1)**

Buscar en `index.html` (debe aparecer una sola vez):

```js
          'CONTEXTO DEL ESTUDIO:\n' + contexto.slice(0, 45000) + '\n\n' +
```

- [ ] **Step 4: Reemplazar por el helper con el tope nuevo**

```js
          'CONTEXTO DEL ESTUDIO:\n' + ptTruncarContexto(contexto, 100000) + '\n\n' +
```

- [ ] **Step 5: Confirmar el texto actual exacto en `redactarSeccion` (Motor 2)**

Buscar en `index.html` (debe aparecer una sola vez):

```js
          'CONTEXTO DEL ESTUDIO:\n' + ctx.slice(0, 30000) + '\n\n' +
```

- [ ] **Step 6: Reemplazar por el helper con el tope nuevo**

```js
          'CONTEXTO DEL ESTUDIO:\n' + ptTruncarContexto(ctx, 70000) + '\n\n' +
```

- [ ] **Step 7: Verificar sintaxis**

Mismo comando de la sección de arriba.
Expected: `OK: los 3 bloques <script> compilan sin errores de sintaxis.`

- [ ] **Step 8: Verificación funcional del helper (Node, sin DOM)**

```bash
node -e "
function ptTruncarContexto(str, max) {
  str = String(str || '');
  if (str.length <= max) return str;
  var sep = '\n\n────────────────\n\n';
  var corte = str.lastIndexOf(sep, max);
  return corte > 0 ? str.slice(0, corte) : str.slice(0, max);
}
var bloque1 = 'A'.repeat(50);
var bloque2 = 'B'.repeat(50);
var s = bloque1 + '\n\n────────────────\n\n' + bloque2;
var r = ptTruncarContexto(s, 60);
console.assert(r === bloque1, 'debe cortar en el separador, no a mitad de bloque2. Obtuvo: ' + JSON.stringify(r));
console.assert(ptTruncarContexto('corto', 100) === 'corto', 'no debe tocar strings ya cortos');
console.log('OK: ptTruncarContexto corta en el separador de bloque, no a mitad de contenido.');
"
```

Expected: `OK: ptTruncarContexto corta en el separador de bloque, no a mitad de contenido.` (sin ningún `Assertion failed`).

- [ ] **Step 9: Commit**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
Subir el tope de contexto enviado a la IA y no cortarlo a mitad de un bloque

Las tres tareas anteriores alargan el contexto que arma ptContextoCompleto().
Los topes previos (45000/30000 caracteres) eran conservadores frente a la
ventana real de los modelos usados. Se suben a 100000/70000 y se agrega
ptTruncarContexto(), que si de todas formas hace falta cortar, corta en el
separador de bloque más cercano en vez de partir una compañía o un párrafo
por la mitad.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Sincronizar `public/index.html` y smoke test manual en el navegador

**Files:**
- Modify: `public/index.html` (generado, no se edita a mano)

- [ ] **Step 1: Sincronizar el build**

```bash
npm run build
```

Expected: el script `scripts/sync-index.js` corre sin error y `public/index.html` queda idéntico a `index.html`.

- [ ] **Step 2: Verificar que no quedaron cambios sin commitear**

```bash
git status --short
```

Expected: solo debe aparecer `public/index.html` modificado (por el build), nada más.

- [ ] **Step 3: Commit del build sincronizado**

```bash
git add public/index.html
git commit -m "$(cat <<'EOF'
Sincronizar public/index.html (npm run build) con la conexión de contexto a la IA

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 4: Smoke test manual — arrancar la app**

```bash
npm start
```

Abrir la app en el navegador (la URL que imprima `server.js`, normalmente `http://localhost:3000`).

- [ ] **Step 5: Smoke test manual — cargar un caso con comparables y universo depurado**

Cargar (o reutilizar) un estudio que ya tenga: comparables seleccionadas en el Motor TOP-N, universo evaluado con rechazadas, y opcionalmente el análisis económico cargado (`ptEconomiaAuto()` o edición manual de `e_mundo/e_col/e_sec`).

- [ ] **Step 6: Smoke test manual — inspeccionar el contexto desde la consola del navegador**

En la consola de DevTools:

```js
console.log(ptContextoCompleto());
```

Expected en el string impreso:
- El bloque `CONJUNTO DE COMPARABLES` trae, por cada compañía, `[id · SIC]`, `PLI` en porcentaje y (si `DESCS` tiene el nombre) una descripción.
- El bloque `DEPURACIÓN DEL UNIVERSO` trae, además del conteo agregado, la lista `Detalle por compañía rechazada:` con nombre + motivo por cada una.
- Si `e_mundo`/`e_col`/`e_sec` tienen contenido, aparece el bloque `CONTEXTO ECONÓMICO YA CARGADO EN EL ESTUDIO`.

- [ ] **Step 7: Smoke test manual — normativa huérfana**

Sin aplicar el Motor 2 (no tocar «Redactar apartados pendientes» / «Incorporar al informe»), usar el botón «Buscar norma y jurisprudencia» una vez. Luego generar el informe (el flujo que llama a `renderReport()`).

Expected: la sección «Referencias normativas incorporadas» aparece al final del documento impreso, aunque `PT_INFORME_IA.aplicado` nunca se haya seteado.

- [ ] **Step 8: Si algo no coincide con lo esperado**

No commitear. Volver a la tarea correspondiente (1-5), releer el estado actual de esa función en `index.html` (puede haber cambiado si hay otra sesión trabajando en paralelo — verificar `git log -5 --oneline` antes de asumir que el problema es la edición propia) y corregir ahí.

---

## Self-Review

**Cobertura del spec:** Task 1 → sección 1 del spec (comparables). Task 2 → sección 2 (motivo de rechazo). Task 3 → sección 3 (`ECON`/campos económicos). Task 4 → sección 4 (`PT_NORMATIVA_WEB`). Task 5 → sección 5 (presupuesto de contexto + corte limpio). Task 6 → build + pruebas manuales de la sección "Pruebas" del spec. El punto 5 original del análisis (motor de comparables/videojuegos) queda fuera, como ya se acordó — cubierto por su propio spec/plan.

**Placeholders:** ninguno — cada step trae el código exacto a escribir y el comando exacto a correr.

**Consistencia de nombres:** `ptTruncarContexto` se define una sola vez (Task 5, Step 2) y se consume igual en los otros dos puntos (Task 5, Steps 4 y 6) — mismo nombre, misma firma `(str, max)`.

**Riesgo de líneas movidas:** dado que otra sesión ya modificó este archivo una vez durante el mismo día (ver commits de 10:32 a 11:17 sobre unificación del motor de comparables), cada tarea empieza con un "Step 1: confirmar el texto actual exacto" antes de tocar nada — si no coincide, se busca por contenido (el comentario o el nombre de función), nunca por número de línea a ciegas.
