# Continuidad automática de comparables — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconocer la tabla "Muestra Compañías comparables" del estudio anterior, cruzarla
automáticamente contra el universo IQ importado, proteger esas candidatas de los filtros de
perfil/IA que hoy las descartan, y dejar de excluir siempre el perfil EMPRESARIO en Rigor
Funcional Amplio.

**Architecture:** Todo el cambio vive en `index.html` (monolito único, sin build step para la
app). Se editan funciones existentes en el script base (`moRows`, `moScore`,
`curarCandidatosConIA`) y en dos de los bloques `PARCHE PT` ya presentes (Bloque 2 —
comparables/continuidad— y Bloque 3 —informe del año anterior—), siguiendo el patrón ya
establecido de ese archivo: los bloques reasignan `window.<funcion>` guardando la versión
anterior cuando corresponde.

**Tech Stack:** JavaScript vanilla (sin framework), ejecutado directamente en el navegador desde
`index.html`. Sin bundler, sin transpilado, sin dependencias nuevas.

## Global Constraints

- **La aplicación no tiene tests automatizados.** Por instrucción explícita de
  `CLAUDE.md`, la verificación de cada tarea es: (a) `grep` para confirmar que ningún símbolo
  eliminado/renombrado sigue referenciado en otra parte del archivo, y (b) prueba manual en el
  navegador de la ruta afectada. Los pasos de este plan reemplazan el ciclo
  test-driven de la skill (`escribir test → falla → implementar → pasa`) por
  `grep de ubicación → editar → grep de verificación → probar en navegador`, tal como exige el
  proyecto.
- **Editar siempre la raíz `index.html`**, nunca `public/index.html` (artefacto generado por
  `npm run build`/`scripts/sync-index.js`).
- **Los números de línea citados abajo son de referencia** (tomados en el momento de escribir
  este plan): antes de editar, localiza el texto exacto con Grep — el archivo se edita entre
  varias personas y las líneas se mueven.
- Todo el código, comentarios y mensajes de UI van en español, siguiendo el resto del archivo.
- No se toca el backend (`server.js`, `functions/index.js`, `Cpanel/.../api/*.php`) ni sus
  contratos: todo el trabajo es del lado del navegador.

---

## Nota sobre un ajuste respecto del spec

El spec (`docs/superpowers/specs/2026-07-31-continuidad-automatica-comparables-design.md`,
sección G) proponía reforzar el prompt de `extractPriorActivityWithGemini()`. Al mirar el código
real se encontró un problema de orden: en el flujo que describiste (subes primero el estudio
anterior, luego el Excel de Capital IQ), `extractPriorActivityWithGemini()` se dispara
automáticamente apenas se sube el estudio anterior — en ese momento `COMP_META` (de donde sale
la Business Description real) todavía no existe, porque el Excel no se ha importado. El refuerzo
ahí se quedaría vacío casi siempre.

`curarCandidatosConIA()`, en cambio, se dispara automáticamente justo después de importar el
Excel (momento en que `COMP_META` ya está poblado, sin importar el orden en que subiste los dos
archivos) y es la función que de verdad juzga candidata por candidata si coincide con la
actividad — es el lugar donde el refuerzo tiene efecto real. La Tarea 5 de este plan implementa
el refuerzo ahí en lugar de en `extractPriorActivityWithGemini()`. El resto del spec se
implementa tal cual.

---

### Task 1: Rigor Funcional deja de excluir EMPRESARIO siempre + holding/grupo por nombre

**Files:**
- Modify: `index.html` (función `moRows()`, ~línea 3598-3600; función `moScore()`, ~línea 3652)

**Interfaces:**
- Consumes: nada nuevo — usa `o.name`, `o.perfil`, `cfg.act` que ya existen en `moRows`/`moScore`.
- Produces: ningún símbolo nuevo. Cambia el comportamiento de dos condicionales existentes,
  que las tareas 3 y 4 más adelante van a volver a tocar (se agrega ahí la excepción de
  `o.continuidadTabla`).

- [ ] **Step 1: Localizar el texto exacto**

Ejecuta:
```bash
grep -n "holdings?\\\\b/i.test(o.name" "index.html"
grep -n "Empresario pleno (IP propia" "index.html"
```
Confirma que cada patrón aparece **una sola vez** (si aparece más de una, hay que revisar cuál
gana en tiempo de ejecución antes de tocar nada — ver "Regla crítica" de `CLAUDE.md`).

- [ ] **Step 2: Ampliar la detección de holding por nombre**

Texto actual (dentro de `moRows()`):
```js
        o.holding = /\b(investment holding company|holding company|sociedad de inversi[oó]n|sociedad holding)\b/i.test(DESCS[o.name] || '')
          || /^6719/.test(o.sic || '')
          || /\bholdings?\b/i.test(o.name || '');
```
Reemplázalo por:
```js
        o.holding = /\b(investment holding company|holding company|sociedad de inversi[oó]n|sociedad holding)\b/i.test(DESCS[o.name] || '')
          || /^6719/.test(o.sic || '')
          || /\b(holdings?|grupo|group|groupe|gruppo)\b/i.test(o.name || '');
```

- [ ] **Step 3: Hacer condicional la exclusión de perfil EMPRESARIO**

Texto actual (dentro de `moScore()`):
```js
      if (o.perfil === 'EMPRESARIO') return { out: 'Empresario pleno (IP propia, riesgo de mercado): funciones/activos/riesgos incomparables (Art. 260-4 E.T.)' };
```
Reemplázalo por:
```js
      if (o.perfil === 'EMPRESARIO' && cfg.act !== 'amplio') return { out: 'Empresario pleno (IP propia, riesgo de mercado): funciones/activos/riesgos incomparables (Art. 260-4 E.T.)' };
```

- [ ] **Step 4: Verificar que no queda ninguna referencia rota**

```bash
grep -n "o.perfil === 'EMPRESARIO'" "index.html"
grep -n "grupo|group|groupe|gruppo" "index.html"
```
Debe aparecer exactamente una vez cada uno (el de `moScore` con la nueva condición
`&& cfg.act !== 'amplio'`).

- [ ] **Step 5: Prueba manual en el navegador**

1. Abre la app (`npm start`), abre un estudio con Excel de Capital IQ ya importado (o importa
   uno con al menos una empresa cuya Business Description use "publish"/"its own IP"/"licenses
   its"/similares — perfil EMPRESARIO).
2. En el panel del Motor, deja Rigor Funcional en **"Estándar"**, ejecuta la selección y confirma
   en el embudo de depuración que esa candidata sigue excluida con el motivo "Empresario
   pleno...".
3. Cambia Rigor Funcional a **"Amplio"**, vuelve a ejecutar, y confirma que esa misma candidata
   **ya no aparece con ese motivo de exclusión** (puede seguir fuera del TOP-N por puntaje, pero
   no por el motivo EMPRESARIO).
4. Con una candidata cuyo nombre contenga "Group", "Holdings" o "Grupo" (agrégala a mano en la
   tabla si no tienes una a la mano en el universo), confirma que **sigue excluida** incluso en
   modo Amplio, con el motivo de holding.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
Rigor Funcional Amplio permite perfil EMPRESARIO salvo holdings/grupos

Antes moScore() excluía siempre cualquier candidata con perfil EMPRESARIO
(dueña de su propia IP/producto), sin importar el Rigor Funcional. Esto
descartaba de forma permanente comparables legítimas en operaciones de
licenciamiento (p. ej. publishers de videojuegos). Ahora solo se excluye
en Estándar/Estricto; en Amplio se permite, salvo que el nombre indique
que es una holding o un grupo/conglomerado.
EOF
)"
```

---

### Task 2: Reconocer la tabla "Muestra Compañías comparables" del estudio anterior

**Files:**
- Modify: `index.html` (Bloque 3 — "INFORME DEL AÑO ANTERIOR", cerca de `ptComparablesDelTexto`,
  ~línea 7722; y `ptProcesarTextoAnterior`, ~línea 7795)

**Interfaces:**
- Produces: `function ptTablaComparablesEstudioAnterior(texto)` → `[{numero, name}, ...]`.
  `PT_ANTERIOR.comparablesTabla` (arreglo crudo, sin fusionar) y fusión dentro de
  `PT_ANTERIOR.comparables` (deduplicada por `nameKey`). Tarea 3 consume
  `PT_ANTERIOR.comparablesTabla`; Tarea 5 consume `PT_ANTERIOR.comparablesTabla` también.

- [ ] **Step 1: Localizar el punto de inserción**

```bash
grep -n "function ptComparablesDelTexto" "index.html"
grep -n "var comps = ptComparablesDelTexto(texto);" "index.html"
```

- [ ] **Step 2: Agregar la nueva función de extracción de la tabla**

Justo después del cierre de `ptComparablesDelTexto` (después de su `}` de cierre, antes del
comentario `/* ─── 3. CARGA DEL INFORME ANTERIOR ... ─── */`), agrega:

```js
      /* Tabla "Muestra Compañías comparables" del estudio anterior: patrón
         recurrente en todos los estudios (con o sin el prefijo "Tabla N."),
         con columnas Número / Nombre de la Compañía / Ámbito (Internacional|
         Nacional). El texto llega aquí ya aplanado por pdfjs (una página =
         una sola línea larga, ver cargarInformeAnterior más abajo), así que
         NO se puede depender de saltos de línea entre filas: se localiza el
         encabezado y se recorren las filas por posición dentro del bloque de
         texto que sigue, ignorando la columna de Ámbito. */
      function ptTablaComparablesEstudioAnterior(texto) {
        var out = [], vistos = {};
        var t = String(texto || '');
        var rxTitulo = /(?:tabla\s*\d+\.?\s*)?(?:muestra\s+)?compañ[ií]as?\s+comparables?/i;
        var mTitulo = rxTitulo.exec(t);
        if (!mTitulo) return out;
        var desde = mTitulo.index + mTitulo[0].length;
        var corte = t.slice(desde).search(/fuente\s*:/i);
        var bloque = corte >= 0 ? t.slice(desde, desde + corte) : t.slice(desde, desde + 6000);
        var rxFila = /(\d{1,3})\s+([A-ZÁÉÍÓÚÑ0-9][A-Za-zÁÉÍÓÚÑáéíóúñ0-9&.,'()\-\s]{2,90}?)\s+(INTERNACIONAL|NACIONAL)\b/g;
        var m;
        while ((m = rxFila.exec(bloque))) {
          var nombre = m[2].replace(/\s+/g, ' ').trim();
          if (nombre.length < 3) continue;
          var k = nombre.toUpperCase().replace(/[^A-Z0-9]/g, '');
          if (vistos[k]) continue;
          vistos[k] = 1;
          out.push({ numero: parseInt(m[1], 10), name: nombre });
        }
        return out;
      }
```

- [ ] **Step 3: Fusionarla dentro de `ptProcesarTextoAnterior`**

Texto actual:
```js
      window.ptProcesarTextoAnterior = function (texto, nombre) {
        var r = ptDistribuir(texto, nombre);
        var comps = ptComparablesDelTexto(texto);
        window.PT_ANTERIOR = {
          fuente: nombre, texto: texto, comparables: comps,
          paginas: window.__PT_PAGINAS_PREV || null,
          descripcionNegocio: [INFOGEN.productos, INFOGEN.clientes, INFOGEN.sector].filter(Boolean).join(' '),
          fecha: new Date().toISOString()
        };
```
Reemplázalo por:
```js
      window.ptProcesarTextoAnterior = function (texto, nombre) {
        var r = ptDistribuir(texto, nombre);
        var comps = ptComparablesDelTexto(texto);
        var tablaComps = ptTablaComparablesEstudioAnterior(texto);
        if (tablaComps.length) {
          var vistosFusion = {};
          comps.forEach(function (c) { vistosFusion[nameKey(c.name)] = 1; });
          tablaComps.forEach(function (tc) {
            var k = nameKey(tc.name);
            if (!vistosFusion[k]) { vistosFusion[k] = 1; comps.push({ name: tc.name, id: '', sic: '', desc: '' }); }
          });
        }
        window.PT_ANTERIOR = {
          fuente: nombre, texto: texto, comparables: comps, comparablesTabla: tablaComps,
          paginas: window.__PT_PAGINAS_PREV || null,
          descripcionNegocio: [INFOGEN.productos, INFOGEN.clientes, INFOGEN.sector].filter(Boolean).join(' '),
          fecha: new Date().toISOString()
        };
```

- [ ] **Step 4: Verificar referencias**

```bash
grep -n "ptTablaComparablesEstudioAnterior" "index.html"
grep -n "comparablesTabla" "index.html"
```
En este punto del plan, `comparablesTabla` debe aparecer solo en `ptProcesarTextoAnterior` (Tarea
3 y 5 lo van a consumir después).

- [ ] **Step 5: Prueba manual en el navegador**

1. Sube `Cpanel/public_html/demo-precios-transferencia/Archivos Prueba/estudio pasado.pdf` (o el
   PDF de prueba que tengas con la tabla "Muestra Compañías comparables") en la tarjeta
   "Documentación comprobatoria del año anterior".
2. Abre la consola del navegador y ejecuta `PT_ANTERIOR.comparablesTabla` — confirma que trae los
   nombres de la tabla (p. ej. los 13 de tu ejemplo), sin la columna de Ámbito.
3. Ejecuta `PT_ANTERIOR.comparables` y confirma que esos mismos nombres están incluidos (sin
   duplicados si `ptComparablesDelTexto` ya había capturado alguno).
4. Sube un documento que **no** tenga esa tabla (cualquier PDF de prueba sin ese patrón) y
   confirma que no truena nada y `comparablesTabla` queda `[]`.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
Reconocer la tabla "Muestra Compañías comparables" del estudio anterior

ptComparablesDelTexto() solo capturaba nombres por una regex genérica de
sufijo corporativo, ciega al patrón de tabla (Número/Nombre/Ámbito) que
se repite en todos los estudios anteriores. La nueva
ptTablaComparablesEstudioAnterior() localiza esa tabla específica y
fusiona sus nombres dentro de PT_ANTERIOR.comparables.
EOF
)"
```

---

### Task 3: Cruce automático de la tabla contra el universo IQ

**Files:**
- Modify: `index.html` (Bloque 2 — "COMPARABLES", junto a `ptComparablesContinuidad`, ~línea
  7301-7350; final de `smartMapRows`, ~línea 7205-7207; final de `ptProcesarTextoAnterior` en
  Bloque 3, ~línea 7810)

**Interfaces:**
- Consumes: `PT_ANTERIOR.comparablesTabla` (Task 2), `CIQ_UNIVERSO`/`COMP_META` (ya existentes),
  `K(s)`, `_fila(u)`, `_registrar(u)`, `ptComparablesEnTabla()`, `compRow(...)`, `calc()` — todos
  ya definidos en Bloque 2.
- Produces: `window.PT_CONTINUIDAD_TABLA_KEYS = { "<nameKey>": {name, id} }` (persistido en Task
  6) y `window.ptCruceContinuidadTablaAuto()`. Task 4 consume `PT_CONTINUIDAD_TABLA_KEYS`.

- [ ] **Step 1: Localizar el punto de inserción**

```bash
grep -n "window.PT_CONTINUIDAD = null;" "index.html"
grep -n "if (out.length > 20) window.CIQ_UNIVERSO = out.slice();" "index.html"
```

- [ ] **Step 2: Declarar el mapa de continuidad y la función de cruce**

Justo después de `window.PT_CONTINUIDAD = null;` (Bloque 2), agrega:

```js
      window.PT_CONTINUIDAD_TABLA_KEYS = window.PT_CONTINUIDAD_TABLA_KEYS || {};

      /* Cruce automático (sin botón) de la tabla "Muestra Compañías comparables"
         del estudio anterior contra el universo de Capital IQ ya importado.
         Se dispara sola desde smartMapRows() (al terminar de importar el Excel)
         y desde ptProcesarTextoAnterior() en el Bloque 3 (al terminar de leer el
         estudio anterior) — cubre los dos órdenes de carga posibles. */
      window.ptCruceContinuidadTablaAuto = function () {
        var tabla = (window.PT_ANTERIOR && PT_ANTERIOR.comparablesTabla) || [];
        if (!tabla.length || !CIQ_UNIVERSO.length) return null;
        var porNombre = {};
        CIQ_UNIVERSO.forEach(function (u) { if (u.name) porNombre[K(u.name)] = u; });
        var existentes = {};
        ptComparablesEnTabla().forEach(function (c) { existentes[K(c.name)] = 1; });
        var encontradas = [], noEncontradas = [];
        var frag = document.createDocumentFragment(), n = 0;
        tabla.forEach(function (p) {
          var hit = porNombre[K(p.name)];
          if (!hit) { noEncontradas.push(p.name); return; }
          window.PT_CONTINUIDAD_TABLA_KEYS[K(hit.name)] = { name: hit.name, id: hit.id || '' };
          encontradas.push(hit.name);
          if (existentes[K(hit.name)]) return;
          _registrar(hit);
          frag.appendChild(compRow(_fila(hit)));
          existentes[K(hit.name)] = 1; n++;
        });
        if (n) { $('cbody').appendChild(frag); calc(); }
        ptPintarCruceContinuidadTabla(encontradas, noEncontradas);
        return { encontradas: encontradas, noEncontradas: noEncontradas };
      };

      function ptPintarCruceContinuidadTabla(encontradas, noEncontradas) {
        var host = document.getElementById('ptContTablaAlerta');
        if (!noEncontradas.length) { if (host) host.innerHTML = ''; return; }
        if (!host) {
          var ancla = document.getElementById('compalert') || $('cbody');
          if (!ancla || !ancla.parentNode) return;
          host = document.createElement('div'); host.id = 'ptContTablaAlerta';
          ancla.parentNode.insertBefore(host, ancla);
        }
        host.innerHTML = '<div style="margin:8px 0;padding:8px 10px;border:1px solid #C0392B;background:#FDEDEC;border-radius:6px;font-size:11.5px">' +
          '<b>⚠ ' + noEncontradas.length + ' comparable(s) de la tabla del estudio anterior no aparecen en el universo de este año:</b> ' +
          noEncontradas.map(escH).join(', ') +
          '. No aparece en el universo de búsqueda del año corriente (posible fusión, deslistamiento o cambio de razón social). Verificar en la fuente antes de descartarla.</div>';
      }
```

- [ ] **Step 3: Disparar el cruce al terminar de importar el Excel**

Texto actual (final de `smartMapRows`, Bloque 2):
```js
        /* el universo completo queda disponible para el motor de continuidad */
        try { if (out.length > 20) window.CIQ_UNIVERSO = out.slice(); } catch (e) { }
        return out;
      };
```
Reemplázalo por:
```js
        /* el universo completo queda disponible para el motor de continuidad */
        try { if (out.length > 20) window.CIQ_UNIVERSO = out.slice(); } catch (e) { }
        try { ptCruceContinuidadTablaAuto(); } catch (e) { console.warn('[PARCHE] cruce de continuidad automático:', e); }
        return out;
      };
```

- [ ] **Step 4: Disparar el cruce al terminar de leer el estudio anterior**

En Bloque 3, dentro de `ptProcesarTextoAnterior`, localiza:
```js
        if (typeof extractPriorActivityWithGemini === 'function') extractPriorActivityWithGemini();
```
Y agrega justo después:
```js
        try { if (typeof ptCruceContinuidadTablaAuto === 'function') ptCruceContinuidadTablaAuto(); } catch (e) { }
```

- [ ] **Step 5: Verificar referencias**

```bash
grep -n "ptCruceContinuidadTablaAuto" "index.html"
grep -n "PT_CONTINUIDAD_TABLA_KEYS" "index.html"
```
`ptCruceContinuidadTablaAuto` debe aparecer: 1 definición + 2 llamadas (una en cada bloque).

- [ ] **Step 6: Prueba manual en el navegador**

1. Sube el estudio anterior con la tabla (deja que termine de leerse).
2. Importa `END GAME 2025.xls` (o el Excel de Capital IQ de prueba que sí incluya alguna de esas
   compañías, p. ej. con nombre "AKATSUKI INC." en la columna de nombre).
3. Confirma que esa fila aparece sola en la tabla de comparables (`#cbody`), sin haber pulsado el
   botón morado "Continuidad de comparables…".
4. En consola, ejecuta `PT_CONTINUIDAD_TABLA_KEYS` y confirma que trae esa compañía.
5. Invierte el orden: recarga, importa primero el Excel y sube el estudio anterior después;
   confirma que el cruce también ocurre en ese orden.
6. Con un nombre de la tabla que no exista en el Excel importado, confirma que aparece el aviso
   rojo junto a la tabla de comparables listando esa compañía como no encontrada.

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
Cruzar automáticamente la tabla del estudio anterior contra el universo IQ

Antes el cruce de continuidad (ptComparablesContinuidad) requería pulsar
un botón manual. Ahora, apenas se tienen ambos insumos (Excel de Capital
IQ y tabla de comparables del estudio anterior, en cualquier orden de
carga), las compañías encontradas se agregan solas a la tabla de
comparables y quedan registradas en PT_CONTINUIDAD_TABLA_KEYS.
EOF
)"
```

---

### Task 4: Proteger las comparables de continuidad de los filtros de perfil/IA

**Files:**
- Modify: `index.html` (`moRows()`, ~línea 3602; `moScore()`, ~línea 3644-3693)

**Interfaces:**
- Consumes: `PT_CONTINUIDAD_TABLA_KEYS` (Task 3), `nameKey(s)` (ya existente).
- Produces: `o.continuidadTabla` (booleano, calculado en cada fila dentro de `moRows()`).

- [ ] **Step 1: Localizar el texto exacto**

```bash
grep -n "o.previa = !!previas\[nameKey(o.name)\];" "index.html"
grep -n "const bonoContinuidad = o.previa" "index.html"
```

- [ ] **Step 2: Calcular `o.continuidadTabla` en `moRows()`**

Texto actual:
```js
        o.previa = !!previas[nameKey(o.name)];
        return o;
```
Reemplázalo por:
```js
        o.previa = !!previas[nameKey(o.name)];
        o.continuidadTabla = !!(window.PT_CONTINUIDAD_TABLA_KEYS && PT_CONTINUIDAD_TABLA_KEYS[nameKey(o.name)]);
        return o;
```

- [ ] **Step 3: Eximir a `o.continuidadTabla` de los filtros de perfil/Rigor Funcional**

Texto actual (dentro de `moScore()`, ya con el cambio de la Tarea 1 aplicado):
```js
      if (cfg.act === 'estricto' && o.perfil !== 'SERVICIO') return { out: 'Perfil ' + o.perfil + ': excluido en modo estricto (Art. 260-4 — solo prestadores de servicios)' };
      if (cfg.act === 'estandar' && o.perfil === 'INDEFINIDO') return { out: 'Perfil funcional indefinido: excluido en modo estándar; disponible en modo amplio con revisión manual' };
      if (o.perfil === 'EMPRESARIO' && cfg.act !== 'amplio') return { out: 'Empresario pleno (IP propia, riesgo de mercado): funciones/activos/riesgos incomparables (Art. 260-4 E.T.)' };
```
Reemplázalo por:
```js
      if (cfg.act === 'estricto' && o.perfil !== 'SERVICIO' && !o.continuidadTabla) return { out: 'Perfil ' + o.perfil + ': excluido en modo estricto (Art. 260-4 — solo prestadores de servicios)' };
      if (cfg.act === 'estandar' && o.perfil === 'INDEFINIDO' && !o.continuidadTabla) return { out: 'Perfil funcional indefinido: excluido en modo estándar; disponible en modo amplio con revisión manual' };
      if (o.perfil === 'EMPRESARIO' && cfg.act !== 'amplio' && !o.continuidadTabla) return { out: 'Empresario pleno (IP propia, riesgo de mercado): funciones/activos/riesgos incomparables (Art. 260-4 E.T.)' };
```

- [ ] **Step 4: Eximirla del rechazo de la curación por IA**

Texto actual:
```js
      if (aiRec && aiRec.coincide === false) {
        return { out: 'Rechazada por IA: la descripción de negocio no coincide con la actividad (' + (aiRec.motivo || 'sin motivo detallado') + ')' };
      }
```
Reemplázalo por:
```js
      if (aiRec && aiRec.coincide === false && !o.continuidadTabla) {
        return { out: 'Rechazada por IA: la descripción de negocio no coincide con la actividad (' + (aiRec.motivo || 'sin motivo detallado') + ')' };
      }
```

- [ ] **Step 5: Eximirla del filtro estricto de "sin coincidencia de actividad"**

Texto actual:
```js
      if (actM.hayAct && actM.posibles > 0 && actM.hits === 0 && cfg.act === 'estricto' && actM.tieneDesc) {
        const resumen = (act.resumen || '').slice(0, 90);
        return { out: 'Sin coincidencia con la actividad específica: la descripción del candidato no coincide con ninguna palabra clave del perfil (' + resumen + (resumen.length >= 90 ? '…' : '') + ')' };
      }
```
Reemplázalo por:
```js
      if (actM.hayAct && actM.posibles > 0 && actM.hits === 0 && cfg.act === 'estricto' && actM.tieneDesc && !o.continuidadTabla) {
        const resumen = (act.resumen || '').slice(0, 90);
        return { out: 'Sin coincidencia con la actividad específica: la descripción del candidato no coincide con ninguna palabra clave del perfil (' + resumen + (resumen.length >= 90 ? '…' : '') + ')' };
      }
```

- [ ] **Step 6: Anotar el motivo cuando aplica la exención**

Texto actual:
```js
      const raz = ['perfil ' + o.perfil.toLowerCase(), kTag, gTag, tTag, (o.perdida ? 'con pérdida (' + cfg.perd + ')' : ''), (o.previa ? 'continuidad con el año anterior' : '')].filter(x => x).join(', ');
```
Reemplázalo por:
```js
      const raz = ['perfil ' + o.perfil.toLowerCase(), kTag, gTag, tTag, (o.perdida ? 'con pérdida (' + cfg.perd + ')' : ''), (o.previa ? 'continuidad con el año anterior' : ''), (o.continuidadTabla ? 'comparable confirmada en la tabla del estudio anterior' : '')].filter(x => x).join(', ');
```

- [ ] **Step 7: Verificar que las exclusiones legales/financieras siguen intactas**

```bash
grep -n "Sociedad de inversión/holding sin actividad" "index.html"
grep -n "No independiente: un solo accionista" "index.html"
grep -n "Saldo negativo en" "index.html"
```
Confirma que **ninguna** de estas tres líneas quedó tocada por este cambio (deben seguir sin
`!o.continuidadTabla`) — son las exclusiones que el spec exige mantener siempre.

- [ ] **Step 8: Prueba manual en el navegador**

1. Repite el escenario de la Tarea 3 (compañía de la tabla encontrada en el universo) y ejecuta
   el motor con Rigor Funcional en **"Estricto"**.
2. Confirma en el embudo de depuración que esa candidata **no** aparece con motivo "Empresario
   pleno..." ni "Rechazada por IA..." ni "Sin coincidencia con la actividad específica", y que su
   motivo de aceptación incluye "comparable confirmada en la tabla del estudio anterior".
3. Edita a mano esa misma fila para que su nombre incluya "Group" o para que tenga un accionista
   con más del 50 % (`holders`) — confirma que **sí** se excluye pese a estar en
   `PT_CONTINUIDAD_TABLA_KEYS` (holding/independencia siguen aplicando siempre).

- [ ] **Step 9: Commit**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
Eximir a las comparables de continuidad de los filtros de perfil/IA

o.continuidadTabla (Task 3) exime a una candidata del rechazo por IA, del
filtro de Rigor Funcional por perfil y del filtro estricto de actividad
en moScore() — pero no de las exclusiones legales/financieras (holding,
independencia, saldos negativos), que siguen aplicando siempre.
EOF
)"
```

---

### Task 5: Reforzar el prompt de `curarCandidatosConIA` con las comparables confirmadas

**Files:**
- Modify: `index.html` (cerca de `curarCandidatosConIA`, ~línea 3900-3929)

**Interfaces:**
- Consumes: `PT_ANTERIOR.comparablesTabla` (Task 2), `COMP_META` (ya existente), `nameKey(s)`.
- Produces: `function _ptBloqueComparablesConfirmadas()` → `string` (vacío si no hay datos).

- [ ] **Step 1: Localizar el punto de inserción**

```bash
grep -n "function _moIaInfo" "index.html"
grep -n "'Candidatas:\\\\n' + JSON.stringify(candidatos)" "index.html"
```

- [ ] **Step 2: Agregar la función que arma el bloque de refuerzo**

Justo antes de `async function curarCandidatosConIA(list) {`, agrega:

```js
    function _ptBloqueComparablesConfirmadas() {
      var tabla = (window.PT_ANTERIOR && PT_ANTERIOR.comparablesTabla) || [];
      if (!tabla.length || !window.COMP_META) return '';
      var idx = {};
      Object.keys(COMP_META).forEach(function (nombre) { idx[nameKey(nombre)] = nombre; });
      var lineas = [];
      tabla.forEach(function (t) {
        var real = idx[nameKey(t.name)];
        var desc = real && COMP_META[real] && COMP_META[real].desc;
        if (desc) lineas.push('- ' + real + ': ' + desc.slice(0, 300));
      });
      if (!lineas.length) return '';
      return 'Estas empresas fueron confirmadas como comparables reales en el estudio de precios de transferencia del año anterior (su actividad SÍ coincide con la de la empresa examinada) — úsalas como referencia de qué tipo de negocio es realmente comparable:\n' + lineas.join('\n') + '\n\n';
    }
```

- [ ] **Step 3: Calcularlo una vez e inyectarlo en el prompt por lote**

Texto actual:
```js
      window.PT_CURANDO_IA = true;
      window.AI_MATCH_COMPS = { porId: {}, fecha: new Date().toISOString(), actividadUsada: act.resumen, fuenteExcel: (window.CIQ_FUENTE && CIQ_FUENTE.archivo) || '' };
      const CONCURRENCIA = 6;
```
Reemplázalo por:
```js
      window.PT_CURANDO_IA = true;
      window.AI_MATCH_COMPS = { porId: {}, fecha: new Date().toISOString(), actividadUsada: act.resumen, fuenteExcel: (window.CIQ_FUENTE && CIQ_FUENTE.archivo) || '' };
      const bloqueConfirmadas = _ptBloqueComparablesConfirmadas();
      const CONCURRENCIA = 6;
```
Y el prompt del lote, texto actual:
```js
        const prompt =
          'Eres un experto en precios de transferencia que revisa comparables de Capital IQ.\n\n' +
          'La empresa examinada tiene esta actividad económica real:\n"' + act.resumen + '"\n\n' +
          'A continuación hay una lista de empresas candidatas con su Business Description real de Capital IQ (en inglés). ' +
```
Reemplázalo por:
```js
        const prompt =
          'Eres un experto en precios de transferencia que revisa comparables de Capital IQ.\n\n' +
          'La empresa examinada tiene esta actividad económica real:\n"' + act.resumen + '"\n\n' +
          bloqueConfirmadas +
          'A continuación hay una lista de empresas candidatas con su Business Description real de Capital IQ (en inglés). ' +
```

- [ ] **Step 4: Verificar referencias**

```bash
grep -n "_ptBloqueComparablesConfirmadas" "index.html"
```
Debe aparecer: 1 definición + 2 usos (la asignación a `bloqueConfirmadas` y su uso en el prompt).

- [ ] **Step 5: Prueba manual en el navegador**

1. Repite el flujo completo: sube el estudio anterior con la tabla, importa el Excel de Capital
   IQ (con al menos una de esas compañías presente, para que `COMP_META` tenga su descripción).
2. Antes de que `curarCandidatosConIA` dispare la llamada real a Gemini, agrega un
   `console.log(bloqueConfirmadas)` temporal (o inspecciona con el debugger) para confirmar que
   el bloque trae la compañía con su Business Description real. Quítalo antes de continuar.
3. Deja correr la curación y confirma en `mo_ia_status` que termina con un conteo de
   coincidencias razonable (no hace falta un valor exacto: solo que el flujo no truena y que el
   prompt efectivamente incluye el bloque cuando corresponde).
4. Repite sin haber subido estudio anterior (o sin tabla reconocida) y confirma que
   `_ptBloqueComparablesConfirmadas()` devuelve `''` y el prompt queda igual que antes de este
   cambio.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
Reforzar el prompt de curarCandidatosConIA con comparables confirmadas

Se agrega al prompt por lote la lista de compañías de la tabla del
estudio anterior que sí aparecen en el universo de este año, junto con
su Business Description real (COMP_META), para anclar mejor el criterio
de la IA al juzgar coincidencia de actividad en el resto del universo.
EOF
)"
```

---

### Task 6: Persistir `PT_CONTINUIDAD_TABLA_KEYS` con el estudio

**Files:**
- Modify: `index.html` (`readForm()`/`writeForm()`, ~línea 2789-2834)

**Interfaces:**
- Consumes: `window.PT_CONTINUIDAD_TABLA_KEYS` (Task 3).
- Produces: campo `continuidadTabla` en el objeto que `readForm()`/`writeForm()` guardan y
  restauran con cada estudio (mismo patrón que `aiMatch`/`AI_MATCH_COMPS`).

- [ ] **Step 1: Localizar el texto exacto**

```bash
grep -n "aiMatch: window.AI_MATCH_COMPS" "index.html"
grep -n "window.AI_MATCH_COMPS = s.aiMatch" "index.html"
```

- [ ] **Step 2: Agregarlo a `readForm()`**

Texto actual:
```js
        eeffIA: window.PT_EEFF_IA ? JSON.parse(JSON.stringify(window.PT_EEFF_IA)) : null,
        aiMatch: window.AI_MATCH_COMPS ? JSON.parse(JSON.stringify(window.AI_MATCH_COMPS)) : null
      };
```
Reemplázalo por:
```js
        eeffIA: window.PT_EEFF_IA ? JSON.parse(JSON.stringify(window.PT_EEFF_IA)) : null,
        aiMatch: window.AI_MATCH_COMPS ? JSON.parse(JSON.stringify(window.AI_MATCH_COMPS)) : null,
        continuidadTabla: window.PT_CONTINUIDAD_TABLA_KEYS ? JSON.parse(JSON.stringify(window.PT_CONTINUIDAD_TABLA_KEYS)) : null
      };
```

- [ ] **Step 3: Restaurarlo en `writeForm()`**

Texto actual:
```js
      window.AI_MATCH_COMPS = s.aiMatch ? JSON.parse(JSON.stringify(s.aiMatch)) : null;
```
Reemplázalo por:
```js
      window.AI_MATCH_COMPS = s.aiMatch ? JSON.parse(JSON.stringify(s.aiMatch)) : null;
      window.PT_CONTINUIDAD_TABLA_KEYS = s.continuidadTabla ? JSON.parse(JSON.stringify(s.continuidadTabla)) : {};
```

- [ ] **Step 4: Verificar referencias**

```bash
grep -n "continuidadTabla" "index.html"
```
Debe aparecer en: `readForm()`, `writeForm()`, y (de la Tarea 4) la línea de `moRows()` que
calcula `o.continuidadTabla` — son símbolos distintos (`s.continuidadTabla` vs
`o.continuidadTabla`), confirma que no se mezclaron por error.

- [ ] **Step 5: Prueba manual en el navegador**

1. Repite el flujo de la Tarea 3 hasta tener `PT_CONTINUIDAD_TABLA_KEYS` con al menos una
   compañía.
2. Guarda el estudio (el botón/flujo de guardado que ya use la app) y recarga la página.
3. Vuelve a abrir el mismo estudio y en consola ejecuta `PT_CONTINUIDAD_TABLA_KEYS` — confirma
   que sigue teniendo esa compañía **sin** haber vuelto a subir el estudio anterior ni a
   reimportar el Excel.
4. Ejecuta el motor sobre ese estudio recargado y confirma que la fila sigue protegida (motivo
   "comparable confirmada en la tabla del estudio anterior" en el embudo de depuración).

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
Persistir PT_CONTINUIDAD_TABLA_KEYS con el estudio

Sin esto, recargar la página perdía la protección de continuidad de las
comparables aunque las filas siguieran en la tabla (comps ya viaja con
el estudio), porque moScore() la exime por PT_CONTINUIDAD_TABLA_KEYS y
ese mapa no sobrevivía a guardar/recargar. Se persiste igual que
AI_MATCH_COMPS.
EOF
)"
```

---

## Self-Review

**1. Cobertura del spec:**
- Componente A (Rigor Funcional / EMPRESARIO) → Task 1. ✓
- Componente B (holding/grupo por nombre) → Task 1. ✓
- Componente C (`ptTablaComparablesEstudioAnterior`) → Task 2. ✓
- Componente D (fusión en `ptProcesarTextoAnterior`) → Task 2. ✓
- Componente E (cruce automático + inserción + aviso de no encontradas) → Task 3. ✓
- Componente F (`o.continuidadTabla` en `moRows`/`moScore`) → Task 4. ✓
- Componente G (refuerzo del prompt) → Task 5, **reubicado** de `extractPriorActivityWithGemini`
  a `curarCandidatosConIA` por el problema de orden de carga explicado arriba. ✓
- Persistencia (`PT_CONTINUIDAD_TABLA_KEYS`, mencionada en el spec sección E y en la
  Verificación) → Task 6. ✓ (Nota: `PT_ANTERIOR.comparablesTabla` en sí **no** se persiste,
  porque `PT_ANTERIOR` como un todo tampoco se persiste hoy en `readForm`/`writeForm` — no es
  una regresión de este cambio. El efecto que sí importa, que la protección sobreviva a
  recargar, queda cubierto porque `PT_CONTINUIDAD_TABLA_KEYS` sí se persiste.)

**2. Placeholders:** ninguno — cada step trae el código completo a escribir, sin "TBD" ni
"similar a la tarea N".

**3. Consistencia de tipos/nombres:** `o.continuidadTabla` (booleano, en `moRows`/`moScore`) vs
`PT_CONTINUIDAD_TABLA_KEYS` (mapa `nameKey → {name, id}`, global) vs `s.continuidadTabla` (el
mismo mapa, serializado dentro del objeto de estudio) — tres nombres distintos a propósito
porque son tres cosas distintas (campo calculado / global en memoria / campo persistido); no hay
colisión con `PT_CONTINUIDAD` (el objeto del cruce manual existente, que esta plan no toca).

---

Plan completo y guardado en `docs/superpowers/plans/2026-07-31-continuidad-automatica-comparables.md`.

**Dos opciones de ejecución:**

1. **Subagent-Driven (recomendado)** — despacho un subagente nuevo por tarea, con revisión entre
   tareas e iteración rápida.
2. **Ejecución en esta sesión** — ejecuto las tareas en este chat con `executing-plans`, por
   lotes con puntos de revisión.

¿Cuál prefieres?
