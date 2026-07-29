# Unificar el motor de comparables y eliminar la lógica quemada a videojuegos — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un solo motor de selección de comparables (Motor TOP-N, ya agnóstico vía Gemini) gobierna toda la tabla de comparables, eliminando el motor FAR/Conjunto hardcodeado a videojuegos y las secciones del informe que dependen de él, sin perder la funcionalidad legal genérica (independencia societaria, factores Art. 260-4, continuidad con el año anterior) que hoy vive mal ubicada dentro del motor viejo.

**Architecture:** Se extiende `moRows()`/`moScore()` (el motor ya agnóstico) con los datos y reglas que hoy solo existen en el motor FAR. Se reescribe `ptCorregirTablaAutomaticamente()` para que use exclusivamente ese motor. Se repuntan las funciones de informe/compliance que dependían de `PT_CRIBA`/`PT_SELECCION`/`PT_FAR` para que lean de `MOTOR`/`MATRIX`/`moRows()`/`getActividadEspecifica()`. Se borra, sin reemplazo, el código que solo servía para clasificar por industria de videojuegos.

**Tech Stack:** HTML + JavaScript vanilla en un único archivo (`index.html`), sin framework, sin bundler, sin suite de tests automatizada.

## Global Constraints

- **Editar siempre el `index.html` de la raíz del repo, nunca `public/index.html` directamente** — `npm run build` copia raíz→public; editar `public/` causa drift y los cambios se perderían en el próximo build.
- **El archivo puede estar bajo edición activa fuera de esta sesión.** Se observó, durante el diseño de este plan, que los números de línea de una misma función cambiaron entre lecturas separadas por pocos minutos (sin que esta conversación hubiera editado nada). **Antes de cada edición, localizar el texto exacto a modificar con Grep/Read en el momento — nunca confiar en el número de línea citado en este plan.** Los números de línea aquí son "última observación conocida", útiles como punto de partida, no como verdad absoluta.
- Antes de empezar, correr `git status` y `git diff` para confirmar el estado real del working tree (git status al inicio de esta conversación ya mostraba `index.html` y `public/index.html` modificados sin commitear) y no pisar trabajo en curso sin entenderlo primero.
- No hay suite de tests automatizada. La verificación "automática" de cada tarea es, cuando aplica, un `grep` de que ningún símbolo borrado sigue siendo referenciado; la verificación funcional es manual en navegador (Tarea 11).
- Solo se toca lo descrito en `docs/superpowers/specs/2026-07-29-motor-comparables-unificado-design.md`. No se refactoriza nada fuera de ese alcance.

---

### Task 1: Extender `moRows()`/`moScore()` — independencia societaria, holding reforzado, bono de continuidad

**Files:**
- Modify: `index.html` — funciones `moRows()`, `moScore()` (bloque del "Motor de selección automática (TOP-N)", cerca de las funciones `moCfg`, `moActMatch`; última ubicación observada alrededor de la línea 3583-3656).

**Interfaces:**
- Consumes: `nameKey(str)`, `num(str)`, `DESCS` (map global), `COMP_META` (map global), `window.PT_ANTERIOR.comparables` (array, ya existente) — todos ya presentes en el archivo, sin cambios.
- Produces: `o.holders`, `o.previa` en cada fila de `moRows()`; `maxParticipacion(txt)` como función standalone junto a `moScore` (nuevo nombre en este ámbito — hoy solo existe dentro del bloque FAR que se borra en la Tarea 9); `moScore()` ahora puede devolver `{ out: '...' }` por independencia societaria, y su `sc` incluye el bono de continuidad.

- [ ] **Step 1: Localizar el texto actual de `moRows()`, `moCfg()` y `moScore()`**

Ejecutar Grep sobre `index.html` con el patrón `function moRows\(\)` para confirmar la ubicación actual y leer el bloque completo (unas 75 líneas desde ahí) para verificar que el texto coincide con el capturado en el spec antes de editar.

- [ ] **Step 2: Reemplazar `moRows()` para agregar `o.holders`, `o.previa` y reforzar `o.holding`**

Buscar (old_string, debe ser único en el archivo):

```js
    function moRows() {
      const kind = $('pli').value;
      const sig = kind + '|' + [...$('cbody').children].map(tr => { const i = tr.querySelector('input'); return i ? i.value : ''; }).join('~');
      if (_moCache.sig === sig && _moCache.rows) return _moCache.rows;
      const out = [...$('cbody').children].map(tr => {
        const v = [...tr.querySelectorAll('input,select')].map(i => i.value);
        const o = { name: v[0], amb: v[1], s: num(v[2]), c: num(v[3]), op: num(v[4]), ar: num(v[5]), inv: num(v[6]), ap: num(v[7]), sic: (v[8] || '').trim(), id: (v[9] || '').trim() };
        if (!o.name.trim() || o.s === null) return null;
        o.pli = pliOf({ s: o.s, c: o.c, op: o.op }, kind); o.perfil = moPerfil(o.name); o.pais = moPais(o.name, o.amb);
        o.perdida = (o.op !== null && o.op <= 0);
        o.holding = /\b(investment holding company|holding company|sociedad de inversi[oó]n|sociedad holding)\b/i.test(DESCS[o.name] || '');
        o.saldoNeg = ['ar', 'inv', 'ap'].filter(k => o[k] !== null && o[k] < 0);
        return o;
      }).filter(x => x);
      _moCache = { sig, rows: out }; return out;
    }
```

Reemplazar por (new_string):

```js
    function moPrevias() {
      const map = {};
      ((window.PT_ANTERIOR && PT_ANTERIOR.comparables) || []).forEach(function (c) {
        const k = nameKey(c.name || ''); if (k) map[k] = true;
      });
      return map;
    }
    function moRows() {
      const kind = $('pli').value;
      const sig = kind + '|' + [...$('cbody').children].map(tr => { const i = tr.querySelector('input'); return i ? i.value : ''; }).join('~');
      if (_moCache.sig === sig && _moCache.rows) return _moCache.rows;
      const previas = moPrevias();
      const out = [...$('cbody').children].map(tr => {
        const v = [...tr.querySelectorAll('input,select')].map(i => i.value);
        const o = { name: v[0], amb: v[1], s: num(v[2]), c: num(v[3]), op: num(v[4]), ar: num(v[5]), inv: num(v[6]), ap: num(v[7]), sic: (v[8] || '').trim(), id: (v[9] || '').trim() };
        if (!o.name.trim() || o.s === null) return null;
        o.pli = pliOf({ s: o.s, c: o.c, op: o.op }, kind); o.perfil = moPerfil(o.name); o.pais = moPais(o.name, o.amb);
        o.perdida = (o.op !== null && o.op <= 0);
        const meta = (window.COMP_META && COMP_META[o.name]) || {};
        o.holders = meta.holders || '';
        o.holding = /\b(investment holding company|holding company|sociedad de inversi[oó]n|sociedad holding)\b/i.test(DESCS[o.name] || '')
          || /^6719/.test(o.sic || '')
          || /\bholdings?\b/i.test(o.name || '');
        o.saldoNeg = ['ar', 'inv', 'ap'].filter(k => o[k] !== null && o[k] < 0);
        o.previa = !!previas[nameKey(o.name)];
        return o;
      }).filter(x => x);
      _moCache = { sig, rows: out }; return out;
    }
```

- [ ] **Step 3: Agregar `maxParticipacion` justo antes de `moScore()`**

Buscar (old_string, único — es la línea que abre `moScore`):

```js
    function moScore(o, cfg, medPool, sTP, act) {
      if (o.holding && cfg.holding === 'excluir') return { out: 'Sociedad de inversión/holding sin actividad operativa propia: excluida (funciones, activos y riesgos no comparables, Art. 260-4 E.T.)' };
```

Reemplazar por:

```js
    function maxParticipacion(txt) {
      if (!txt) return null;
      var v = String(txt).match(/\(([\d.]+)\)/g);
      if (!v) return null;
      var m = v.map(function (x) { return parseFloat(x.replace(/[()]/g, '')); }).filter(function (n) { return isFinite(n); });
      return m.length ? Math.max.apply(null, m) : null;
    }
    function moScore(o, cfg, medPool, sTP, act) {
      if (o.holding && cfg.holding === 'excluir') return { out: 'Sociedad de inversión/holding sin actividad operativa propia: excluida (funciones, activos y riesgos no comparables, Art. 260-4 E.T.)' };
      var socioMax = maxParticipacion(o.holders);
      var topeIndep = (window.PT_CRITERIOS && PT_CRITERIOS.independenciaTope) || 50;
      if (socioMax !== null && socioMax > topeIndep) return { out: 'No independiente: un solo accionista concentra el ' + socioMax.toFixed(2) + ' % de la propiedad, superior al ' + topeIndep + ' % admitido; existe vinculación por control (Art. 260-1 E.T.).' };
```

- [ ] **Step 4: Agregar el bono de continuidad al final de `moScore()`**

Buscar (old_string, único — es el cierre de `moScore`):

```js
      const sc = wA * fA + wK * fK + wG * fG + wT * fT + wR * fR;
      const raz = ['perfil ' + o.perfil.toLowerCase(), kTag, gTag, tTag, (o.perdida ? 'con pérdida (' + cfg.perd + ')' : '')].filter(x => x).join(', ');
      return { sc, raz };
    }
```

Reemplazar por:

```js
      const scBase = wA * fA + wK * fK + wG * fG + wT * fT + wR * fR;
      const bonoContinuidad = o.previa ? 0.08 : 0;
      const sc = scBase + bonoContinuidad;
      const raz = ['perfil ' + o.perfil.toLowerCase(), kTag, gTag, tTag, (o.perdida ? 'con pérdida (' + cfg.perd + ')' : ''), (o.previa ? 'continuidad con el año anterior' : '')].filter(x => x).join(', ');
      return { sc, raz };
    }
```

- [ ] **Step 5: Verificación manual mínima**

Abrir la app (skill `run`), cargar comparables manualmente en la tabla (una con "Holding" en el nombre, sin marcarla como tal en la descripción), ejecutar "Ejecutar selección" y confirmar en el toast/consola que esa fila aparece excluida con el motivo de holding. No requiere estudio del año anterior para probar este paso.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "Extender moRows/moScore: independencia societaria, holding por SIC/nombre y bono de continuidad"
```

---

### Task 2: Generalizar `ptIndustriaExaminada()` / `ptPerteneceIndustria()` y borrar `IND_DEFECTO`

**Files:**
- Modify: `index.html` — bloque "GUARDAS DE PRODUCCIÓN E INDUSTRIA ESPECÍFICA" (última ubicación observada alrededor de la línea 12933-12976).

**Interfaces:**
- Consumes: `getActividadEspecifica()` (ya existente, `index.html:2138`, devuelve `{resumen, perfil, productos, keywords, sic, justificacion, fuente, fecha}` o `null`).
- Produces: `window.ptIndustriaExaminada()` → `{nombre, positivas: RegExp, negativas: RegExp, sicAfines: string[], generica: bool}`; `window.ptPerteneceIndustria(nombre, desc, sic)` → `{ok: true|false|null, motivo: string}`. Firma idéntica a la actual — todos los llamadores existentes (`ptVerificarIndustriaTabla`, `ptGuardaInforme`) siguen funcionando sin cambios.

- [ ] **Step 1: Localizar el bloque actual**

Grep por el patrón `var IND_DEFECTO = \{` para confirmar la ubicación vigente; leer desde ahí hasta el cierre de `ptPerteneceIndustria` para confirmar que el texto coincide con lo documentado en el spec.

- [ ] **Step 2: Reemplazar `IND_DEFECTO` + `ptIndustriaExaminada` + `ptPerteneceIndustria`**

Buscar (old_string):

```js
      var IND_DEFECTO = {
        nombre: 'desarrollo de videojuegos',
        positivas: /\b(video\s?games?|videojuegos?|game\s?(development|developer|studio|software|publisher|publishing)|(mobile|online|web|pc|browser|social|casual|console)[\s-]{0,3}(and\s+\w+\s+)?games?|gaming(?!\s?(machine|table|casino))|interactive\s+entertainment|game\s+titles?|videogame)\b|\b(develops?|operates?|publishes?|distributes?|produc\w+)[^.]{0,80}\bgames?\b|\bgames?\b[^.]{0,50}\b(develop|operat|publish|studio)/i,
        negativas: /\b(casino|gambling|betting|lottery|slot\s?machine|igaming|wager)\b/i,
        sicAfines: ['7372', '7371', '7999', '7929']
      };

      /* la industria se deriva del objeto social / perfil funcional cuando existe */
      window.ptIndustriaExaminada = function () {
        try {
          var F = window.PT_FAR || {};
          var obj = (($('objeto') && $('objeto').value) || '') + ' ' +
            ((F.funcionesClave || []).join(' ')) + ' ' +
            ((F.palabrasClave || []).join(' ')) + ' ' +
            (F.ingresoConcepto || '');
          if (/videojuego|video\s?game|gaming|game|juegos?\b/i.test(obj)) return IND_DEFECTO;
          /* industria distinta o indeterminable: se declara GENÉRICA. En ese
             caso la doble prueba NO excluye automáticamente — exige verificación
             manual — porque un patrón construido con palabras sueltas del objeto
             social no es criterio suficiente para descartar compañías. */
          return {
            nombre: 'industria de la parte examinada (no determinada automáticamente)',
            positivas: /$^/, negativas: IND_DEFECTO.negativas, sicAfines: [], generica: true
          };
        } catch (e) { }
        return IND_DEFECTO;
      };

      /* doble prueba: industria + función básica */
      window.ptPerteneceIndustria = function (nombre, desc, sic) {
        var IND = ptIndustriaExaminada();
        desc = String(desc || (window.DESCS && DESCS[nombre]) || '');
        sic = String(sic || '');
        if (IND.generica) return { ok: null, motivo: 'La industria de la parte examinada no pudo determinarse automáticamente del objeto social; la pertenencia de esta compañía debe verificarse manualmente.' };
        if (!desc.trim()) return { ok: null, motivo: 'La fuente no publica descripción de negocio: la pertenencia a la industria no puede verificarse automáticamente.' };
        if (IND.negativas.test(desc)) return { ok: false, motivo: 'Su actividad corresponde a apuestas o casinos, industria distinta y expresamente excluida.' };
        var enDesc = IND.positivas.test(desc);
        var rol = '';
        try { rol = ptClasificarFAR(desc, sic).rol; } catch (e) { }
        var funcionOK = /^DESARROLLADOR_/.test(rol);
        if (enDesc && funcionOK) return { ok: true, motivo: 'Pertenece a la industria de ' + IND.nombre + ' y desempeña la función de desarrollo (' + (window.PT_FAR_ROLES && PT_FAR_ROLES[rol] || rol) + ').', rol: rol };
        if (enDesc && !funcionOK) return { ok: false, motivo: 'Menciona la industria pero su función principal es otra (' + (window.PT_FAR_ROLES && PT_FAR_ROLES[rol] || rol || 'no determinada') + '): no comparte la función básica de desarrollo.', rol: rol };
```

Nota: el old_string de arriba puede no incluir literalmente las últimas líneas de la función (el archivo tiene más código después de esa última línea mostrada, con al menos un `return` adicional y el cierre `};`). Antes de aplicar el reemplazo, leer con la herramienta Read el rango completo desde `var IND_DEFECTO` hasta el `};` que cierra `ptPerteneceIndustria` (identificable porque la siguiente línea no vacía es un comentario o `window.` de otra función), y usar ESE texto completo como old_string real.

Reemplazar por (new_string — reemplaza el bloque completo, incluida cualquier línea final no capturada arriba):

```js
      /* la industria se deriva de la actividad específica (Gemini) cuando existe */
      window.ptIndustriaExaminada = function () {
        try {
          var act = (typeof getActividadEspecifica === 'function') ? getActividadEspecifica() : null;
          if (!act || !((act.keywords && act.keywords.length) || (act.sic && act.sic.length))) {
            return {
              nombre: 'industria de la parte examinada (no determinada automáticamente)',
              positivas: /$^/, negativas: /$^/, sicAfines: [], generica: true
            };
          }
          var kws = [].concat(act.keywords || [], act.productos || []).filter(Boolean)
            .map(function (k) { return String(k).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); });
          var positivas = kws.length ? new RegExp('\\b(' + kws.join('|') + ')\\b', 'i') : /$^/;
          return {
            nombre: act.resumen || (act.keywords || []).join(', ') || 'actividad específica de la parte examinada',
            positivas: positivas, negativas: /$^/, sicAfines: (act.sic || []).slice(), generica: false
          };
        } catch (e) { }
        return { nombre: 'industria de la parte examinada (no determinada automáticamente)', positivas: /$^/, negativas: /$^/, sicAfines: [], generica: true };
      };

      /* doble prueba: industria + coincidencia con la actividad específica */
      window.ptPerteneceIndustria = function (nombre, desc, sic) {
        var IND = ptIndustriaExaminada();
        desc = String(desc || (window.DESCS && DESCS[nombre]) || '');
        sic = String(sic || '');
        if (IND.generica) return { ok: null, motivo: 'La actividad específica de la parte examinada no ha sido extraída (use «Analizar empresa con IA»); la pertenencia de esta compañía debe verificarse manualmente.' };
        if (!desc.trim() && !sic.trim()) return { ok: null, motivo: 'La fuente no publica descripción de negocio ni SIC: la pertenencia a la industria no puede verificarse automáticamente.' };
        if (IND.negativas.test(desc)) return { ok: false, motivo: 'Su actividad corresponde a un giro expresamente excluido de la actividad específica.' };
        var enDesc = IND.positivas.test(desc) || IND.positivas.test(nombre || '');
        var sicOK = IND.sicAfines.some(function (c) { return sic.indexOf(c) >= 0; });
        if (enDesc || sicOK) return { ok: true, motivo: 'Coincide con la actividad específica (' + IND.nombre + ').' };
        return { ok: false, motivo: 'Ni su descripción de negocio ni su SIC coinciden con la actividad específica (' + IND.nombre + ').' };
      };
```

- [ ] **Step 3: Verificar que no queda ninguna referencia a `IND_DEFECTO` ni a `ptClasificarFAR` dentro de este bloque**

```bash
grep -n "IND_DEFECTO" index.html
```

Debe devolver cero resultados.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "Generalizar ptIndustriaExaminada/ptPerteneceIndustria con getActividadEspecifica(), eliminar IND_DEFECTO"
```

---

### Task 3: Nueva `ptVerificarIndustriaTabla_yAplicar()` y reescritura de `ptCorregirTablaAutomaticamente()`

**Files:**
- Modify: `index.html` — bloque "GUARDA DE GENERACIÓN" (última ubicación observada: la función objetivo alrededor de la línea 13127; su predecesora envoltorio de `ptAplicarSeleccion` alrededor de la línea 13003-13037).

**Interfaces:**
- Consumes: `motorEjecutar(silencioso)`, `motorAplicarSeleccion()`, `ptVerificarIndustriaTabla()`, `ptFiltrarAtipicos()` (todas ya existentes, sin cambios de firma).
- Produces: `window.ptVerificarIndustriaTabla_yAplicar()` (nueva, sin argumentos, sin retorno significativo — actúa por efecto lateral sobre `#cbody` y `moToast`); `window.ptCorregirTablaAutomaticamente()` (firma igual: sin argumentos, devuelve `true`/`false`).

- [ ] **Step 1: Localizar y confirmar el texto vigente**

Grep por `ptAplicarSeleccion === 'function'` y por `window.ptCorregirTablaAutomaticamente = function` para confirmar ubicación y comparar contra el texto de abajo antes de editar.

- [ ] **Step 2: Reemplazar el envoltorio de `ptAplicarSeleccion` por la función independiente**

Buscar (old_string):

```js
      if (typeof window.ptAplicarSeleccion === 'function') {
        var _aplicarPrev = window.ptAplicarSeleccion;
        window.ptAplicarSeleccion = function () {
          var r = _aplicarPrev.apply(null, arguments);
          try {
            var I = ptVerificarIndustriaTabla();
            var totalTabla = $('cbody').children.length;
            /* salvaguardas: si la verificación declara ajena a la totalidad, el
               problema es de la detección de industria, no del conjunto; y la
               remoción nunca deja el conjunto por debajo del mínimo legalmente
               defendible */
            var minimo = (window.PT_CRITERIOS && PT_CRITERIOS.minConjunto) || 8;
            if (I.ajenas.length && I.ajenas.length >= totalTabla) {
              moToast('La verificación de industria marcó como ajenas a TODAS las compañías: eso indica un problema de detección de la industria de la parte examinada, no del conjunto. No se removió ninguna; verifique el objeto social.', 'red');
            } else if (I.ajenas.length && (totalTabla - I.ajenas.length) < minimo) {
              moToast(I.ajenas.length + ' compañía(s) no superan la doble prueba de industria, pero removerlas dejaría el conjunto por debajo del mínimo de ' + minimo + '. Se conservan CON CONSTANCIA; revise manualmente.', 'amber');
              window.PT_INDUSTRIA_OBSERVADAS = I.ajenas;
            } else if (I.ajenas.length) {
              var quitadas = [];
              [].slice.call($('cbody').children).forEach(function (tr) {
                var nom = (tr.querySelector('input') || {}).value || '';
                var aj = I.ajenas.find(function (x) { return x.name === nom; });
                if (aj) { quitadas.push(aj); tr.remove(); }
              });
              window.PT_INDUSTRIA_EXCLUIDAS = (window.PT_INDUSTRIA_EXCLUIDAS || []).concat(quitadas);
              if (quitadas.length) {
                moToast(quitadas.length + ' compañía(s) excluidas del conjunto por no pertenecer a la industria de la parte examinada: ' + quitadas.map(function (x) { return x.name.split('(')[0].trim(); }).join(', '), 'amber');
                try { calc(); } catch (e) { }
              }
              ptVerificarIndustriaTabla();
            }
          } catch (e) { }
          return r;
        };
      }
```

Reemplazar por (new_string — la lógica es la misma, ahora como función independiente que no envuelve nada):

```js
      window.ptVerificarIndustriaTabla_yAplicar = function () {
        var I = ptVerificarIndustriaTabla();
        var totalTabla = $('cbody').children.length;
        var minimo = (window.PT_CRITERIOS && PT_CRITERIOS.minConjunto) || 8;
        if (I.ajenas.length && I.ajenas.length >= totalTabla) {
          moToast('La verificación de industria marcó como ajenas a TODAS las compañías: eso indica un problema de detección de la actividad de la parte examinada, no del conjunto. No se removió ninguna; verifique la actividad específica.', 'red');
          return;
        }
        if (I.ajenas.length && (totalTabla - I.ajenas.length) < minimo) {
          moToast(I.ajenas.length + ' compañía(s) no superan la doble prueba de industria, pero removerlas dejaría el conjunto por debajo del mínimo de ' + minimo + '. Se conservan CON CONSTANCIA; revise manualmente.', 'amber');
          window.PT_INDUSTRIA_OBSERVADAS = I.ajenas;
          return;
        }
        if (I.ajenas.length) {
          var quitadas = [];
          [].slice.call($('cbody').children).forEach(function (tr) {
            var nom = (tr.querySelector('input') || {}).value || '';
            var aj = I.ajenas.find(function (x) { return x.name === nom; });
            if (aj) { quitadas.push(aj); tr.remove(); }
          });
          window.PT_INDUSTRIA_EXCLUIDAS = (window.PT_INDUSTRIA_EXCLUIDAS || []).concat(quitadas);
          if (quitadas.length) {
            moToast(quitadas.length + ' compañía(s) excluidas del conjunto por no pertenecer a la actividad específica de la parte examinada: ' + quitadas.map(function (x) { return x.name.split('(')[0].trim(); }).join(', '), 'amber');
            try { calc(); } catch (e) { }
          }
          ptVerificarIndustriaTabla();
        }
      };
```

- [ ] **Step 3: Reescribir `ptCorregirTablaAutomaticamente()`**

Buscar (old_string):

```js
      window.ptCorregirTablaAutomaticamente = function () {
        if (!(window.CIQ_UNIVERSO && CIQ_UNIVERSO.length)) {
          moToast('No hay universo cargado en memoria: cargue el archivo de la fuente y ejecute la depuración.', 'red');
          return false;
        }
        try {
          ptCribarUniverso();
          ptSeleccionarConjunto();
          ptAplicarSeleccion();
          try { ptFiltrarAtipicos(); } catch (e) { }
          try { calc(); } catch (e) { }
          var filasTrasFAR = [].slice.call($('cbody').children).filter(function (tr) {
            var i = tr.querySelector('input'); return i && String(i.value || '').trim();
          }).length;
          if (filasTrasFAR > LIMITE_TABLA) {
            /* la vía que compara con el perfil funcional del año anterior no pudo
               depurar (típicamente porque no hay estudio del año anterior cargado):
               se usa el motor de selección, que no depende de esa documentación. */
            moToast('No se pudo depurar con el perfil del año anterior (¿está cargado el estudio anterior?): se usa el motor de selección automática como respaldo…', 'amber');
            try { motorEjecutar(true); } catch (e) { }
            if (!motorAplicarSeleccion()) {
              moToast('La corrección automática no logró reducir la tabla. Cargue el estudio del año anterior, o seleccione manualmente con el «Motor de selección automática» y aplique su resultado.', 'red');
              return false;
            }
          }
          moToast('Tabla corregida: ' + $('cbody').children.length + ' comparable(s) en el conjunto final.', 'green');
          return true;
        } catch (e) { moToast('La corrección automática falló: ' + e.message, 'red'); return false; }
      };
```

Reemplazar por (new_string):

```js
      window.ptCorregirTablaAutomaticamente = function () {
        if (!$('cbody').children.length) {
          moToast('No hay comparables cargadas: importe el Excel del universo de búsqueda (Capital IQ) primero.', 'red');
          return false;
        }
        try {
          motorEjecutar(false);
          if (!motorAplicarSeleccion()) {
            moToast('El motor no dejó ninguna comparable seleccionada. Ajuste los criterios del «Motor de selección automática» e intente de nuevo.', 'red');
            return false;
          }
          try { ptVerificarIndustriaTabla_yAplicar(); } catch (e) { }
          try { ptFiltrarAtipicos(); } catch (e) { }
          moToast('Tabla corregida: ' + $('cbody').children.length + ' comparable(s) en el conjunto final.', 'green');
          return true;
        } catch (e) { moToast('La corrección automática falló: ' + e.message, 'red'); return false; }
      };
```

- [ ] **Step 4: Verificación manual — reproducir el bug original**

Con la app corriendo: importar un Excel con >50 filas incluyendo alguna con "Holding" en el nombre o SIC 6719, configurar el panel Motor TOP-N con N y "excluir holding" distintos del default, pulsar "Solucionar todo automáticamente en 1 clic", y confirmar que el resultado respeta exactamente esa configuración y que ninguna holding sobrevive. Este es el bug reportado originalmente — debe quedar resuelto después de este paso.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "Unificar la corrección automática de comparables en el Motor TOP-N; portar la doble prueba de industria"
```

---

### Task 4: Repuntar `ptFactores260_4()` y `ptTestSuficienciaHTML()` al motor unificado

**Files:**
- Modify: `index.html` — Bloque 7 "FACTORES DE COMPARABILIDAD DEL ART. 260-4 COMPLETOS" (última ubicación observada: `ptFactores260_4` ~línea 9273-9359, `ptTestSuficienciaHTML` ~línea 9365-9448); y el final de `motorEjecutar()` (última ubicación observada ~línea 3898).

**Interfaces:**
- Consumes: `moRows()`, `MOTOR.sel`/`MOTOR.score`/`MOTOR.motivo` (ya existentes), `maxParticipacion()` (de la Tarea 1), `nameKey()`.
- Produces: `window.ptFactores260_4()` sigue devolviendo `{geoFuera, tamanoFuera, perdida, sinDatoIndep, sinBalance, evaluadas}` o `null` — misma forma que antes, para que `ptTestSuficienciaHTML` no tenga que cambiar su lectura de `F.*`.

- [ ] **Step 1: Localizar y confirmar el texto vigente de `ptFactores260_4`**

Grep por `window.ptFactores260_4 = function` y leer el bloque completo (unas 80 líneas) para confirmar contra el texto de abajo.

- [ ] **Step 2: Reemplazar `ptFactores260_4()`**

Buscar (old_string):

```js
      window.ptFactores260_4 = function () {
        var C = window.PT_CRIBA;
        if (!C) return null;
        var K = window.PT_CRITERIOS;
        var ingPE = ingresoParteExaminada();
        var ingPE_USDmm = ingPE ? (ingPE / window.PT_TRM) / 1e6 : null;

        var stats = {
          geoFuera: 0, tamanoFuera: 0, perdida: 0, sinDatoIndep: 0,
          sinBalance: 0, evaluadas: 0
        };

        C.filas.forEach(function (f) {
          if (f.estado !== 'Aceptada') return;
          stats.evaluadas++;
          var añadir = [];

          /* d.1 · mercado geográfico (Art. 260-4, circunstancias económicas) */
          var pais = String(f.pais || '').toLowerCase();
          var enRegion = K.regiones.some(function (r) { return pais.indexOf(r) >= 0; });
          f.geoOK = (K.geografia === 'global') ? true : (K.geografia === 'region' ? enRegion : /colombia/.test(pais));
          if (!enRegion) stats.geoFuera++;          /* se cuenta siempre, sea cual sea el criterio */
          if (!f.geoOK) {
            f.estado = 'Rechazada';
            añadir.push('Opera en un mercado geográfico distinto del exigido por el criterio adoptado (' + escH(f.pais || 'país no reportado') + ').');
          }
          if (K.geografia === 'global' && !enRegion) {
            añadir.push('Mercado geográfico: ' + (f.pais || 'no reportado') + ', distinto del de la parte examinada. Se admite por inexistencia de comparables locales suficientes; la justificación consta en el apartado de criterios.');
          }

          /* d.2 · escala */
          if (ingPE_USDmm && f.s) {
            var razon = f.s / ingPE_USDmm;
            f.escalaVeces = razon;
            if (razon > K.tamanoFactor || razon < (1 / K.tamanoFactor)) {
              stats.tamanoFuera++;
              if (K.tamanoModo === 'limitar') { f.estado = 'Rechazada'; añadir.push('Escala incomparable: sus ingresos son ' + razon.toFixed(0) + ' veces los de la parte examinada, por encima del factor admitido de ' + K.tamanoFactor + '.'); }
              else añadir.push('Diferencia de escala: sus ingresos equivalen a ' + (razon >= 1 ? razon.toFixed(0) + ' veces' : '1/' + (1 / razon).toFixed(0)) + ' los de la parte examinada. Se conserva porque el indicador aplicado es un margen —una razón, no un valor absoluto—, dejando constancia de la diferencia.');
            }
          }

          /* d.3 · resultados negativos */
          if (f.s && f.op !== null && f.op < 0) {
            stats.perdida++;
            f.perdida = true;
            if (K.perdidas === 'excluir') { f.estado = 'Rechazada'; añadir.push('Presenta pérdida operacional en el período; conforme al criterio adoptado, las compañías con pérdida se excluyen del conjunto.'); }
            else if (K.perdidas === 'marcar') añadir.push('Presenta pérdida operacional en el período (margen ' + ((f.op / f.s) * 100).toFixed(2) + ' %). Las Directrices de la OCDE no imponen su exclusión automática: se conserva tras verificar que la pérdida no obedece a circunstancias extraordinarias ajenas al giro ordinario. Esta verificación debe documentarse.');
          }

          /* a/c · datos de balance para los ajustes de capital de trabajo */
          if (f.ar === null || f.ap === null) {
            stats.sinBalance++;
            f.sinBalance = true;
          }

          /* independencia sin dato */
          if (f.socio === null || f.socio === undefined) {
            stats.sinDatoIndep++;
            if (K.independenciaSinDato === 'excluir') { f.estado = 'Rechazada'; añadir.push('La fuente no reporta la composición accionaria: no es posible acreditar su independencia.'); }
            else añadir.push('La fuente no reporta un accionista con participación de control; se admite su independencia sobre esa base, sin verificación adicional.');
          }

          if (añadir.length) f.motivo = (f.motivo || '') + ' ' + añadir.join(' ');
        });

        C.aceptadas = C.filas.filter(function (f) { return f.estado === 'Aceptada'; })
          .sort(function (a, b) { return b.especificidad - a.especificidad; });
        C.factores = stats;

        /* la matriz del Anexo D se actualiza con los motivos enriquecidos */
        try {
          MATRIX = C.filas.map(function (f) {
            return { name: f.name, sic: f.sic, country: f.pais, rev: f.s, status: f.estado, motivo: f.motivo };
          });
        } catch (e) { }

        return stats;
      };

      /* Se encadena a la depuración funcional: siempre se aplican los factores */
      var _cribaPrev = window.ptCribarUniverso;
      window.ptCribarUniverso = function (opts) {
        var r = _cribaPrev(opts);
        if (r) { try { ptFactores260_4(); } catch (e) { console.warn('[PARCHE] factores 260-4:', e); } }
        try { if (typeof ptPintarCriba === 'function') ptPintarCriba(); } catch (e) { }
        return window.PT_CRIBA;
      };
```

Reemplazar por (new_string — nótese que se elimina el envoltorio de `ptCribarUniverso`, que se borra en la Tarea 9; el disparo de `ptFactores260_4()` se mueve al Step 3 de esta tarea):

```js
      window.ptFactores260_4 = function () {
        if (!window.MOTOR || !MOTOR.activo) return null;
        var K = window.PT_CRITERIOS;
        var rows = moRows();
        var ingPE = ingresoParteExaminada();
        var ingPE_USDmm = ingPE ? (ingPE / window.PT_TRM) / 1e6 : null;

        var stats = {
          geoFuera: 0, tamanoFuera: 0, perdida: 0, sinDatoIndep: 0,
          sinBalance: 0, evaluadas: 0
        };

        rows.forEach(function (o) {
          var k = nameKey(o.name);
          if (MOTOR.sel[k] !== true) return;
          stats.evaluadas++;
          var añadir = [];

          var pais = String(o.pais || '').toLowerCase();
          var enRegion = K.regiones.some(function (r) { return pais.indexOf(r) >= 0; });
          if (!enRegion) stats.geoFuera++;
          if (K.geografia === 'global' && !enRegion) {
            añadir.push('Mercado geográfico: ' + (o.pais || 'no reportado') + ', distinto del de la parte examinada. Se admite por inexistencia de comparables locales suficientes; la justificación consta en el apartado de criterios.');
          }

          if (ingPE_USDmm && o.s) {
            var razon = o.s / ingPE_USDmm;
            if (razon > K.tamanoFactor || razon < (1 / K.tamanoFactor)) {
              stats.tamanoFuera++;
              añadir.push('Diferencia de escala: sus ingresos equivalen a ' + (razon >= 1 ? razon.toFixed(0) + ' veces' : '1/' + (1 / razon).toFixed(0)) + ' los de la parte examinada. Se conserva porque el indicador aplicado es un margen —una razón, no un valor absoluto—, dejando constancia de la diferencia.');
            }
          }

          if (o.perdida) {
            stats.perdida++;
            añadir.push('Presenta pérdida operacional en el período. Las Directrices de la OCDE no imponen su exclusión automática; se conserva conforme al criterio adoptado, dejando constancia.');
          }

          if (o.ar === null || o.ap === null) stats.sinBalance++;

          var socio = maxParticipacion(o.holders);
          if (socio === null || socio === undefined) {
            stats.sinDatoIndep++;
            añadir.push('La fuente no reporta un accionista con participación de control; se admite su independencia sobre esa base, sin verificación adicional.');
          }

          if (añadir.length) MOTOR.motivo[k] = (MOTOR.motivo[k] || '') + ' ' + añadir.join(' ');
        });

        try {
          MATRIX = rows.map(function (o) {
            var k = nameKey(o.name);
            return { name: o.name, sic: o.sic, country: o.pais, rev: o.s, status: (MOTOR.score[k] > 0) ? 'Aceptada' : 'Rechazada', motivo: MOTOR.motivo[k] || '' };
          });
        } catch (e) { }

        return stats;
      };
```

- [ ] **Step 3: Disparar `ptFactores260_4()` desde el final de `motorEjecutar()`**

Buscar (old_string, único):

```js
      MOTOR.universo = rows;
      try { motorRenderTabla(); } catch (e) { }
```

Reemplazar por:

```js
      MOTOR.universo = rows;
      try { motorRenderTabla(); } catch (e) { }
      try { ptFactores260_4(); } catch (e) { }
```

- [ ] **Step 4: Repuntar los 6 puntos de `ptTestSuficienciaHTML()` que preguntan por `C`/`S`**

Localizar `window.ptTestSuficienciaHTML = function () {` (última ubicación observada línea 9365) y confirmar que su primera línea es:

```js
        var C = window.PT_CRIBA, K = window.PT_CRITERIOS, S = window.PT_SELECCION;
        var F = C && C.factores;
```

Reemplazar por:

```js
        var C = (window.MOTOR && MOTOR.activo) ? true : false, K = window.PT_CRITERIOS, S = null;
        var F = C ? (function () { try { return ptFactores260_4() || {}; } catch (e) { return {}; } })() : null;
```

Esto conserva el resto de la función sin tocar: cada `C ? ... : 'no'`/`C && F ? ... : 'no'` sigue funcionando igual, porque `C` ahora es `true`/`false` (según si el motor unificado corrió) en vez de un objeto `PT_CRIBA`, y `F` sigue teniendo `geoFuera`, `tamanoFuera`, `perdida`, `sinDatoIndep`, `sinBalance`, `evaluadas`. `S` queda en `null` porque `PT_SELECCION` se elimina en la Tarea 9 y el único uso de `S` en esta función es `if (S && S.nivelMax > 1) {...}` (constancia sobre ampliación de nivel funcional, un concepto exclusivo del motor FAR que ya no existe) — ese bloque queda inerte de forma segura sin necesidad de tocarlo más.

- [ ] **Step 5: Verificar referencias muertas**

```bash
grep -n "PT_CRIBA\|PT_SELECCION" index.html
```

Confirmar que ninguna coincidencia queda dentro de `ptFactores260_4` ni en el fragmento repuntado de `ptTestSuficienciaHTML` (las que sigan en otras funciones se resuelven en las Tareas 5 y 9).

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "Repuntar ptFactores260_4/ptTestSuficienciaHTML al motor unificado (MOTOR/moRows/MATRIX)"
```

---

### Task 5: Generalizar el panel explicativo `ptExplicacionCriteriosHTML()`

**Files:**
- Modify: `index.html` — función `window.ptExplicacionCriteriosHTML` (última ubicación observada ~línea 9496 en adelante; es una función larga con varios bloques de ejemplo, no capturada en su totalidad durante el diseño).

**Interfaces:**
- Consumes: mismos datos que la Tarea 4 (`moRows()`, `MOTOR`, `maxParticipacion`).
- Produces: mismo HTML explicativo, sin cambiar su firma (`window.ptExplicacionCriteriosHTML()`, sin argumentos, devuelve string HTML).

- [ ] **Step 1: Leer la función completa**

Con Read, leer desde `window.ptExplicacionCriteriosHTML = function () {` hasta su `};` de cierre (son varios bloques `bloque(...)`, probablemente 150-250 líneas). Confirmar cuántos bloques de ejemplo tiene y cuáles usan `C`/`S`/`f.socio`/`f.escalaVeces`/`f.perdida`/`f.pais`/`f.estado`.

- [ ] **Step 2: Reemplazar la obtención de datos y los ejemplos**

Buscar (old_string, ya verificado en el diseño):

```js
      window.ptExplicacionCriteriosHTML = function () {
        var C = window.PT_CRIBA, S = window.PT_SELECCION, K = window.PT_CRITERIOS;
        var ent = ($('ent') && $('ent').value) || 'la parte examinada';

        /* los ejemplos se toman de la depuración en curso cuando existe */
        function ejemploDe(pred, fallback) {
          if (!C || !C.filas) return fallback;
          var f = C.filas.filter(pred)[0];
          return f ? f : fallback;
        }
        var elControl = ejemploDe(function (f) { return f.socio !== null && f.socio > K.independenciaTope; }, null);
        var elGrande = ejemploDe(function (f) { return f.estado === 'Aceptada' && f.escalaVeces && f.escalaVeces > 100; }, null);
        var elPerdida = ejemploDe(function (f) { return f.estado === 'Aceptada' && f.perdida; }, null);
        var elFuera = ejemploDe(function (f) { return f.estado === 'Aceptada' && !/colombia/i.test(f.pais || ''); }, null);
```

Reemplazar por (new_string — mismo propósito, tomando los ejemplos de `moRows()`/`MOTOR` en vez de `PT_CRIBA`/`PT_SELECCION`; `f.escalaVeces` no existe en `moRows()`, se calcula aquí igual que en la Tarea 4):

```js
      window.ptExplicacionCriteriosHTML = function () {
        var C = !!(window.MOTOR && MOTOR.activo), S = null, K = window.PT_CRITERIOS;
        var ent = ($('ent') && $('ent').value) || 'la parte examinada';
        var ingPE = ingresoParteExaminada();
        var ingPE_USDmm = ingPE ? (ingPE / window.PT_TRM) / 1e6 : null;

        /* los ejemplos se toman de las filas seleccionadas por el motor unificado */
        function ejemploDe(pred, fallback) {
          if (!C) return fallback;
          var seleccionadas = moRows().filter(function (o) { return MOTOR.sel[nameKey(o.name)] === true; });
          var f = seleccionadas.filter(pred)[0];
          return f ? f : fallback;
        }
        var elControl = ejemploDe(function (o) { var s = maxParticipacion(o.holders); return s !== null && s > K.independenciaTope; }, null);
        var elGrande = ejemploDe(function (o) { if (!ingPE_USDmm || !o.s) return false; o.escalaVeces = o.s / ingPE_USDmm; return o.escalaVeces > 100; }, null);
        var elPerdida = ejemploDe(function (o) { return o.perdida; }, null);
        var elFuera = ejemploDe(function (o) { return !/colombia/i.test(o.pais || ''); }, null);
```

- [ ] **Step 3: Reemplazar las dos referencias literales a "videojuegos" en el texto de ejemplo**

Buscar (old_string, verificado):

```js
          elFuera
            ? 'En este estudio, <b>' + escH(elFuera.name) + '</b> opera en ' + escH(elFuera.pais || 'el exterior') + '. Con el criterio <i>Global</i> se acepta y el informe deja constancia de la diferencia de mercado. Si se cambiara a <i>Mismo país</i>, esta compañía y otras ' + (C.factores ? (C.factores.geoFuera - 1) : '') + ' quedarían rechazadas, y el conjunto se quedaría sin comparables: en Colombia no cotizan desarrolladoras de videojuegos independientes. Por eso se elige Global y se justifica.'
            : 'Si ' + escH(ent) + ' desarrolla videojuegos y en Colombia no existen compañías independientes de esa actividad con información pública, se elige <i>Global</i> y se escribe la razón en el campo de justificación.');
```

Reemplazar por (new_string — mismo mensaje, sin nombrar una industria fija; usa el resumen de la actividad específica cuando existe):

```js
          elFuera
            ? 'En este estudio, <b>' + escH(elFuera.name) + '</b> opera en ' + escH(elFuera.pais || 'el exterior') + '. Con el criterio <i>Global</i> se acepta y el informe deja constancia de la diferencia de mercado. Si se cambiara a <i>Mismo país</i>, esta compañía y otras quedarían rechazadas, y el conjunto podría quedarse sin comparables suficientes si no existen compañías independientes locales de la misma actividad. Por eso se elige Global y se justifica.'
            : 'Si en Colombia no existen compañías independientes de la actividad de ' + escH(ent) + ' con información pública, se elige <i>Global</i> y se escribe la razón en el campo de justificación.');
```

- [ ] **Step 4: Aplicar el mismo patrón de sustitución al resto de la función**

Para cada bloque de ejemplo restante que se haya identificado en el Step 1 (probablemente incluye escala, pérdidas y algún cierre), sustituir:
- `f.socio` → `maxParticipacion(o.holders)` (variable de iteración renombrada de `f` a `o`, coherente con `moRows()`).
- `f.escalaVeces` → `o.escalaVeces` (ya calculado en el Step 2 dentro de `ejemploDe`).
- `f.perdida` → `o.perdida`.
- `f.pais`/`f.name`/`f.estado` → `o.pais`/`o.name` (el filtro de "aceptada" ya lo aplica `ejemploDe` al tomar solo `MOTOR.sel[...] === true`).
- Cualquier `C.factores.X` → `(F.X)` donde `F` es el resultado de `ptFactores260_4()` calculado igual que en la Tarea 4, Step 4 (agregar `var F = C ? (ptFactores260_4() || {}) : {};` junto a la declaración de `C`/`K` si el resto de la función lo necesita).
- Cualquier mención literal a "videojuegos" en el texto explicativo se redacta en términos neutros, siguiendo el patrón del Step 3 (afirmar el hecho general — mercado sin comparables locales, diferencia de escala, pérdida operacional — sin nombrar una industria).

- [ ] **Step 5: Verificación manual**

Generar un informe con el motor unificado activo y abrir el panel "📖 ¿A qué corresponde cada criterio?" — confirmar que no aparece la palabra "videojuegos" en ningún ejemplo cuando el estudio cargado es de otra industria, y que los ejemplos (accionista, escala, pérdida, geografía) muestran datos reales de las comparables seleccionadas.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "Generalizar ptExplicacionCriteriosHTML al motor unificado, quitar ejemplos fijos de videojuegos"
```

---

### Task 6: Repuntar `ptContextoCompleto()` (contexto de redacción con IA)

**Files:**
- Modify: `index.html` — función `window.ptContextoCompleto` (última ubicación observada ~línea 10561-10638).

**Interfaces:**
- Consumes: `MATRIX`, `MOTOR`, `moRows()`, `getActividadEspecifica()`.
- Produces: mismo string de contexto (sin cambio de firma), con los mismos títulos de bloque ("ANÁLISIS FUNCIONAL...", "DEPURACIÓN DEL UNIVERSO", "CONJUNTO DE COMPARABLES") para no romper los prompts que lo consumen.

- [ ] **Step 1: Confirmar el texto vigente**

Grep por `window.ptContextoCompleto = function` y leer el bloque completo (~80 líneas) para confirmar contra lo siguiente.

- [ ] **Step 2: Repuntar el bloque "ANÁLISIS FUNCIONAL"**

Buscar (old_string):

```js
        /* perfil funcional */
        try {
          var F = window.PT_FAR;
          if (F && F.rol) {
            P.push('ANÁLISIS FUNCIONAL DE LA PARTE EXAMINADA\n· Rol: ' + (window.PT_FAR_ROLES[F.rol] || F.rol) +
              '\n· Funciones clave: ' + (F.funcionesClave || []).join('; ') +
              '\n· Funciones del vinculado: ' + (F.funcionesNoAsumidas || []).join('; ') +
              '\n· Intangibles: ' + ((F.activosNoPropios || []).length ? 'no es titular — ' + F.activosNoPropios.join('; ') : '[no determinado]') +
              '\n· Riesgos no asumidos: ' + (F.riesgosNoAsumidos || []).join('; ') +
              '\n· Origen del ingreso: ' + (F.ingresoConcepto || '[no determinado]') +
              '\n· Fuente del perfil: ' + (F.origen || ''));
          }
        } catch (e) { }
```

Reemplazar por:

```js
        /* actividad específica (Gemini) */
        try {
          var act = (typeof getActividadEspecifica === 'function') ? getActividadEspecifica() : null;
          if (act && (act.resumen || act.perfil)) {
            P.push('ACTIVIDAD ESPECÍFICA DE LA PARTE EXAMINADA (extraída con IA del estudio del año anterior; prevalece sobre el objeto social genérico)\n· Resumen: ' + (act.resumen || '[no determinado]') +
              '\n· Perfil funcional: ' + (act.perfil || '[no determinado]') +
              '\n· Productos/servicios clave: ' + (act.productos || []).join('; ') +
              '\n· Palabras clave de búsqueda: ' + (act.keywords || []).join('; ') +
              '\n· SIC objetivo: ' + (act.sic || []).join('; ') +
              '\n· Fuente: ' + (act.fuente || ''));
          }
        } catch (e) { }
```

- [ ] **Step 3: Repuntar el bloque "DEPURACIÓN DEL UNIVERSO" / "CONJUNTO DE COMPARABLES"**

Buscar (old_string):

```js
        /* comparables y rango */
        try {
          var S = window.PT_SELECCION, C = window.PT_CRIBA;
          if (C) P.push('DEPURACIÓN DEL UNIVERSO\n· Universo ' + C.universo + ' · aceptadas ' + C.aceptadas.length +
            ' · rechazadas ' + C.rechazadas + '\n· Motivos: ' + Object.keys(C.motivosRechazo).map(function (k) { return k + ' (' + C.motivosRechazo[k] + ')'; }).join(' · '));
          if (S) P.push('CONJUNTO DE COMPARABLES\n· ' + S.conjunto.length + ' compañías: ' +
            S.conjunto.map(function (f) { return f.name + ' [' + (f.id || 's/id') + ']'; }).join(' · ') +
            '\n· Del estudio anterior: ' + S.nPrevias + ' · nuevas: ' + S.nNuevas);
          if (window.LAST && LAST.st) P.push('RANGO\n· P25 ' + (LAST.st.p25 * 100).toFixed(3) + ' % · mediana ' +
            (LAST.st.med * 100).toFixed(3) + ' % · P75 ' + (LAST.st.p75 * 100).toFixed(3) + ' %');
        } catch (e) { }
```

Reemplazar por:

```js
        /* comparables y rango */
        try {
          if (window.MATRIX && MATRIX.length) {
            var acc = MATRIX.filter(function (m) { return /acept/i.test(m.status || ''); }).length;
            var motivos = {};
            MATRIX.filter(function (m) { return !/acept/i.test(m.status || ''); }).forEach(function (m) {
              var k = m.motivo || 'Sin motivo registrado'; motivos[k] = (motivos[k] || 0) + 1;
            });
            P.push('DEPURACIÓN DEL UNIVERSO\n· Universo ' + MATRIX.length + ' · aceptadas ' + acc +
              ' · rechazadas ' + (MATRIX.length - acc) + '\n· Motivos: ' + Object.keys(motivos).map(function (k) { return k + ' (' + motivos[k] + ')'; }).join(' · '));
          }
          if (window.MOTOR && MOTOR.activo) {
            var seleccionadas = moRows().filter(function (o) { return MOTOR.sel[nameKey(o.name)] === true; });
            var nPrevias = seleccionadas.filter(function (o) { return o.previa; }).length;
            P.push('CONJUNTO DE COMPARABLES\n· ' + seleccionadas.length + ' compañías: ' +
              seleccionadas.map(function (o) { return o.name + ' [' + (o.id || 's/id') + ']'; }).join(' · ') +
              '\n· Del estudio anterior: ' + nPrevias + ' · nuevas: ' + (seleccionadas.length - nPrevias));
          }
          if (window.LAST && LAST.st) P.push('RANGO\n· P25 ' + (LAST.st.p25 * 100).toFixed(3) + ' % · mediana ' +
            (LAST.st.med * 100).toFixed(3) + ' % · P75 ' + (LAST.st.p75 * 100).toFixed(3) + ' %');
        } catch (e) { }
```

- [ ] **Step 4: Verificar referencias muertas propias de esta función**

```bash
grep -n "PT_FAR\b\|PT_CRIBA\|PT_SELECCION" index.html
```

Confirmar que ninguna coincidencia sigue dentro de `ptContextoCompleto`.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "Repuntar ptContextoCompleto a MATRIX/MOTOR/getActividadEspecifica"
```

---

### Task 7: Recortar `ptFARInformeHTML()` (quitar secciones B y C, conservar fundamento normativo y A)

**Files:**
- Modify: `index.html` — función `window.ptFARInformeHTML` y su hook en `renderReport` (última ubicación observada ~línea 8549-8608).

**Interfaces:**
- Consumes: `getActividadEspecifica()` (en vez de `PT_FAR`/`ROLES`).
- Produces: `window.ptFARInformeHTML()` sigue devolviendo un string HTML (misma firma), ahora más corto: fundamento normativo + "A. Perfil funcional" repuntado. El hook de `renderReport` no cambia su forma (sigue insertando el resultado si `PT_CRIBA`... — ver Step 3, esa condición también se repunta).

- [ ] **Step 1: Confirmar el texto vigente**

Grep por `window.ptFARInformeHTML = function` y leer hasta el hook de `renderReport` que le sigue, para confirmar contra el texto de abajo.

- [ ] **Step 2: Reemplazar la función completa**

Buscar (old_string):

```js
      window.ptFARInformeHTML = function () {
        var C = window.PT_CRIBA; if (!C) return '';
        var F = C.perfil;
        var x = '<h2 class="rep">Depuración funcional del universo de búsqueda</h2>' +
          '<p class="norm">La selección de comparables parte del análisis funcional de la parte examinada y no de la mera coincidencia de códigos de actividad. ' +
          'Conforme al Art. 260-4 del Estatuto Tributario y a las Directrices de la OCDE (Cap. I, secc. D.1.2, y Cap. III), la comparabilidad se determina por las funciones desempeñadas, ' +
          'los activos empleados y los riesgos asumidos, además de las características de las operaciones, los términos contractuales, las circunstancias económicas y las estrategias de negocio. ' +
          'El motivo individual de aceptación o rechazo de cada compañía del universo consta en el Anexo D, conforme al numeral 4 del Art. 1.2.2.2.1.5 del Decreto 1625 de 2016.</p>' +
          '<table class="rep"><thead><tr><th>Fundamento</th><th>Regla aplicada en la depuración</th></tr></thead><tbody>' +
          '<tr><td>Art. 260-4 E.T.</td><td>Se descartan las compañías cuyas funciones, activos y riesgos difieren sustancialmente de los de la parte examinada, por existir diferencias que afectan materialmente el indicador de rentabilidad.</td></tr>' +
          '<tr><td>Art. 260-1 E.T.</td><td>Se descartan las compañías que no son independientes: aquellas en las que un solo accionista concentra más del 50 % de la propiedad se consideran vinculadas por control.</td></tr>' +
          '<tr><td>Decreto 1625 de 2016, Art. 1.2.2.2.1.5 num. 4</td><td>Cada compañía del universo de búsqueda queda con su motivo individual y expreso de aceptación o rechazo (Anexo D).</td></tr>' +
          '<tr><td>Directrices OCDE 2022, Cap. I secc. D.1.2</td><td>El análisis funcional es el eje de la comparabilidad: se identifica el rol económico de la parte examinada y se exige equivalencia funcional en las comparables.</td></tr>' +
          '<tr><td>Directrices OCDE 2022, Cap. III</td><td>Al cribado cuantitativo (actividad, tamaño, disponibilidad de datos) se añade un cribado cualitativo sobre la información pública de cada candidata.</td></tr>' +
          '<tr><td>C.E. Secc. 4ª, exp. 20821 de 2018</td><td>La comparabilidad exige ausencia de diferencias materiales o su neutralización mediante ajustes razonables; las diferencias funcionales no ajustables motivan el rechazo.</td></tr>' +
          '<tr><td>C.E. Secc. 4ª, rad. 27433 de 2024</td><td>La carga probatoria del análisis de comparabilidad recae en el contribuyente: por ello se documenta la verificación de cada comparable en fuentes públicas.</td></tr>' +
          '</tbody></table>' +
          '<h3 class="rep">A. Perfil funcional de la parte examinada</h3>' +
          '<table class="rep"><tbody>' +
          '<tr><td><b>Rol económico</b></td><td>' + escH(ROLES[F.rol] || F.rol) + '</td></tr>' +
          '<tr><td><b>Funciones clave desempeñadas</b></td><td>' + escH((F.funcionesClave || []).join('; ') || '—') + '</td></tr>' +
          '<tr><td><b>Funciones asumidas por el vinculado</b></td><td>' + escH((F.funcionesNoAsumidas || []).join('; ') || '—') + '</td></tr>' +
          '<tr><td><b>Intangibles</b></td><td>' + escH((F.activosNoPropios || []).length ? 'La parte examinada no es titular de intangibles no rutinarios: ' + F.activosNoPropios.join('; ') : 'Ver análisis funcional') + '</td></tr>' +
          '<tr><td><b>Riesgos no asumidos</b></td><td>' + escH((F.riesgosNoAsumidos || []).join('; ') || '—') + '</td></tr>' +
          '<tr><td><b>Origen y concepto del ingreso</b></td><td>' + escH(F.ingresoConcepto || '—') + '</td></tr>' +
          '<tr><td><b>Fuente del perfil</b></td><td>' + escH(F.origen || '—') + '</td></tr>' +
          '</tbody></table>' +
          '<h3 class="rep">B. Resultado de la depuración</h3>' +
          '<p class="norm">Del universo de <b>' + C.universo + '</b> compañías se aceptaron <b>' + C.aceptadas.length + '</b> y se rechazaron <b>' + C.rechazadas + '</b>. ' +
          'De las comparables aceptadas en el estudio del año gravable anterior, <b>' + C.previasMantenidas + '</b> se mantienen tras verificar su permanencia en el universo, su independencia y la disponibilidad de información financiera del período corriente.</p>' +
          '<table class="rep"><thead><tr><th>Motivo de rechazo</th><th>Compañías</th></tr></thead><tbody>' +
          Object.keys(C.motivosRechazo).sort(function (a, b) { return C.motivosRechazo[b] - C.motivosRechazo[a]; })
            .map(function (k) { return '<tr><td>' + escH(k) + '</td><td>' + C.motivosRechazo[k] + '</td></tr>'; }).join('') +
          '</tbody></table>';

        var ver = C.aceptadas.filter(function (f) { return f.verificacion; });
        if (ver.length) {
          x += '<h3 class="rep">C. Verificación de la actividad en fuentes públicas</h3>' +
            '<p class="norm">Cada comparable finalista fue contrastada contra información pública de la propia compañía para confirmar que desarrolla efectivamente las mismas funciones que la parte examinada. ' +
            'La carga probatoria del análisis de comparabilidad corresponde al contribuyente (C.E. Secc. 4ª, rad. 27433 de 2024).</p>' +
            '<table class="rep"><thead><tr><th>Excel Company ID</th><th>Compañía</th><th>Resultado</th><th>Fundamento</th></tr></thead><tbody>' +
            ver.map(function (f) {
              var v = f.verificacion;
              return '<tr><td>' + escH(f.id || '—') + '</td><td>' + escH(f.name) + '</td><td>' +
                (v.estado === 'aceptar' ? 'Actividad confirmada' : v.estado === 'rechazar' ? 'No coincide' : v.estado === 'pendiente' ? 'Verificación manual pendiente' : 'Requiere revisión') +
                '</td><td>' + escH((v.motivo || '').slice(0, 300)) + (v.fuentes && v.fuentes.length ? ' <i>Fuente: ' + escH(v.fuentes.join(' · ')) + '</i>' : '') + '</td></tr>';
            }).join('') + '</tbody></table>';
        }
        return x;
      };
```

Reemplazar por (new_string — se conserva la tabla de fundamento normativo y "A. Perfil funcional" repuntado a `getActividadEspecifica()`; se elimina "B" — ya la cubre `annexRechazoD` — y "C" — dependía de `ptVerificarEnWeb`, que se borra en la Tarea 9 sin reemplazo):

```js
      window.ptFARInformeHTML = function () {
        if (!window.MOTOR || !MOTOR.activo) return '';
        var act = (typeof getActividadEspecifica === 'function') ? getActividadEspecifica() : null;
        var x = '<h2 class="rep">Depuración funcional del universo de búsqueda</h2>' +
          '<p class="norm">La selección de comparables parte del análisis funcional de la parte examinada y no de la mera coincidencia de códigos de actividad. ' +
          'Conforme al Art. 260-4 del Estatuto Tributario y a las Directrices de la OCDE (Cap. I, secc. D.1.2, y Cap. III), la comparabilidad se determina por las funciones desempeñadas, ' +
          'los activos empleados y los riesgos asumidos, además de las características de las operaciones, los términos contractuales, las circunstancias económicas y las estrategias de negocio. ' +
          'El motivo individual de aceptación o rechazo de cada compañía del universo consta en el Anexo D, conforme al numeral 4 del Art. 1.2.2.2.1.5 del Decreto 1625 de 2016.</p>' +
          '<table class="rep"><thead><tr><th>Fundamento</th><th>Regla aplicada en la depuración</th></tr></thead><tbody>' +
          '<tr><td>Art. 260-4 E.T.</td><td>Se descartan las compañías cuyas funciones, activos y riesgos difieren sustancialmente de los de la parte examinada, por existir diferencias que afectan materialmente el indicador de rentabilidad.</td></tr>' +
          '<tr><td>Art. 260-1 E.T.</td><td>Se descartan las compañías que no son independientes: aquellas en las que un solo accionista concentra más del 50 % de la propiedad se consideran vinculadas por control.</td></tr>' +
          '<tr><td>Decreto 1625 de 2016, Art. 1.2.2.2.1.5 num. 4</td><td>Cada compañía del universo de búsqueda queda con su motivo individual y expreso de aceptación o rechazo (Anexo D).</td></tr>' +
          '<tr><td>Directrices OCDE 2022, Cap. I secc. D.1.2</td><td>El análisis funcional es el eje de la comparabilidad: se identifica la actividad específica de la parte examinada y se exige equivalencia funcional en las comparables.</td></tr>' +
          '<tr><td>Directrices OCDE 2022, Cap. III</td><td>Al cribado cuantitativo (actividad, tamaño, disponibilidad de datos) se añade un cribado cualitativo sobre la información pública de cada candidata.</td></tr>' +
          '<tr><td>C.E. Secc. 4ª, exp. 20821 de 2018</td><td>La comparabilidad exige ausencia de diferencias materiales o su neutralización mediante ajustes razonables; las diferencias funcionales no ajustables motivan el rechazo.</td></tr>' +
          '<tr><td>C.E. Secc. 4ª, rad. 27433 de 2024</td><td>La carga probatoria del análisis de comparabilidad recae en el contribuyente: por ello se documenta el motivo individual de cada comparable.</td></tr>' +
          '</tbody></table>' +
          '<h3 class="rep">A. Perfil de la actividad específica de la parte examinada</h3>' +
          '<table class="rep"><tbody>' +
          '<tr><td><b>Actividad específica</b></td><td>' + escH((act && act.resumen) || 'No extraída — use «Analizar empresa con IA»') + '</td></tr>' +
          '<tr><td><b>Perfil funcional</b></td><td>' + escH((act && act.perfil) || '—') + '</td></tr>' +
          '<tr><td><b>Productos/servicios clave</b></td><td>' + escH((act && act.productos || []).join('; ') || '—') + '</td></tr>' +
          '<tr><td><b>Palabras clave de búsqueda</b></td><td>' + escH((act && act.keywords || []).join('; ') || '—') + '</td></tr>' +
          '<tr><td><b>SIC objetivo</b></td><td>' + escH((act && act.sic || []).join('; ') || '—') + '</td></tr>' +
          '<tr><td><b>Fuente del perfil</b></td><td>' + escH((act && act.fuente) || '—') + '</td></tr>' +
          '</tbody></table>';
        return x;
      };
```

- [ ] **Step 3: Repuntar la condición del hook en `renderReport`**

Buscar (old_string):

```js
          if (window.PT_CRIBA) {
```

Este texto puede no ser único en el archivo (varias funciones comprueban `window.PT_CRIBA`); usar Read para confirmar que la ocurrencia a modificar es la que está dentro del hook `renderReport` inmediatamente posterior a la función anterior (el hook que llama `ptFARInformeHTML()`), e incluir suficiente contexto de las líneas vecinas para que el reemplazo sea único. Reemplazar esa ocurrencia por:

```js
          if (window.MOTOR && MOTOR.activo) {
```

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "Recortar ptFARInformeHTML: quitar secciones B y C (redundantes/obsoletas), repuntar A a getActividadEspecifica"
```

---

### Task 8: Eliminar Bloque 17 · Parte C completo (afinidad de negocio por videojuegos)

**Files:**
- Modify: `index.html` — IIFE completa "Bloque 17 · Parte C" (última ubicación observada ~línea 13787-13999).

**Interfaces:**
- Consumes: nada nuevo.
- Produces: nada — se elimina código, sin reemplazo (la función que cumple este propósito de forma agnóstica es `moActMatch`, ya existente y sin cambios).

- [ ] **Step 1: Confirmar el alcance exacto a borrar**

Grep por `PARCHE PT — Bloque 17 · PARTE C` para ubicar el inicio del comentario de bloque, y por `PARCHE PT — Bloque 17 · PARTE D` (o el siguiente encabezado de bloque) para ubicar dónde empieza el bloque siguiente — el borrado va desde el comentario de encabezado de la Parte C hasta el `})();` que cierra su IIFE, **sin tocar nada del siguiente bloque**.

- [ ] **Step 2: Confirmar qué queda dentro de la IIFE de Parte C que NO se debe borrar**

Dentro de esta IIFE existe también `window.ptOrigenCifrasComparablesHTML` (Queja 7) y el hook de `renderReport` que combina `s6` y `s7`. Leer la IIFE completa para localizar exactamente dónde termina `ptPerfilNegocioInformeHTML` y empieza `ptOrigenCifrasComparablesHTML`, y dónde el hook usa `s6`/`s7`.

- [ ] **Step 3: Borrar `PT_PERFIL_NEGOCIO`, `BASE_JUEGOS`, `construirPerfilNegocio`, `ptConstruirPerfilNegocio`, `ptAfinidadNegocio`**

Buscar (old_string, verificado en el diseño):

```js
      window.PT_PERFIL_NEGOCIO = null;

      /* términos base del dominio de videojuegos, siempre disponibles para medir
         afinidad aunque no se haya cargado el informe anterior */
      var BASE_JUEGOS = {
        'video ?game': 5, 'videojuego': 5, 'mobile game': 4, 'online game': 4, 'web game': 4,
        'game develop': 5, 'game studio': 4, 'develops? .{0,30}games?': 4, 'operates? .{0,30}games?': 4,
        'publish.{0,30}games?': 4, 'gaming': 3, 'juego': 3, 'interactive entertainment': 4,
        'game titles?': 3, 'game': 2, 'develop': 1, 'software': 1, 'mobile': 1, 'app': 1, 'entertainment': 2
      };

      function construirPerfilNegocio() {
```

Y siguiendo desde ahí hasta (incluir, old_string continúa):

```js
      window.ptConstruirPerfilNegocio = construirPerfilNegocio;

      /* afinidad de una descripción con el perfil del negocio (0..N) */
      window.ptAfinidadNegocio = function (desc) {
```

y su cuerpo completo (leído en el diseño: itera `P.terminos` sumando pesos por regex) hasta su cierre `};`.

Y el envoltorio de `ptSeleccionarConjunto` que sigue (verificado en el diseño):

```js
      /* la conformación del conjunto ordena las candidatas nuevas por afinidad de
         negocio antes de aplicar el orden por tamaño */
      if (typeof window.ptSeleccionarConjunto === 'function') {
        var _selPrev = window.ptSeleccionarConjunto;
        window.ptSeleccionarConjunto = function (cfg) {
          construirPerfilNegocio();
          var r = _selPrev.apply(null, arguments);
          try {
            if (r && r.conjunto) {
              r.conjunto.forEach(function (f) {
                var meta = (window.COMP_META && COMP_META[f.name]) || {};
                f.afinidadNegocio = ptAfinidadNegocio(f.desc || meta.desc);
              });
              /* el nivel de correspondencia es el criterio primario (no se altera el
                 orden por nivel que exige la depuración); dentro del mismo nivel,
                 primero las previas y luego, entre las nuevas, mayor afinidad de
                 negocio primero */
              r.conjunto.sort(function (a, b) {
                if ((a.nivel || 9) !== (b.nivel || 9)) return (a.nivel || 9) - (b.nivel || 9);
                if (!!b.previa !== !!a.previa) return (b.previa ? 1 : 0) - (a.previa ? 1 : 0);
                return (b.afinidadNegocio || 0) - (a.afinidadNegocio || 0);
              });
              r.perfilNegocio = window.PT_PERFIL_NEGOCIO;
            }
          } catch (e) { }
          return r;
        };
      }
```

Y `ptPerfilNegocioInformeHTML` completa (verificado en el diseño):

```js
      window.ptPerfilNegocioInformeHTML = function () {
        var P = window.PT_PERFIL_NEGOCIO;
        if (!P || !P.positivos.length) return '';
        return '<p class="norm">La selección de las compañías comparables nuevas —adicionales a las conservadas del estudio anterior— se orientó por la descripción del negocio de la parte examinada tomada de la documentación previa: ' +
          'se privilegiaron las candidatas cuya actividad, según la descripción publicada por la fuente, hace referencia al desarrollo de videojuegos y actividades afines, ' +
          'antes que compañías de perfil general de tecnología o servicios de software.</p>';
      };
```

Todo lo anterior (desde `window.PT_PERFIL_NEGOCIO = null;` hasta el cierre de `ptPerfilNegocioInformeHTML`) se borra sin reemplazo.

- [ ] **Step 4: Repuntar el hook de `renderReport` que usaba `s6`**

Buscar (old_string, verificado):

```js
      var _renderC = renderReport;
      renderReport = function () {
        _renderC.apply(null, arguments);
        try {
          var d = $('doc'); if (!d) return;
          var s6 = ptPerfilNegocioInformeHTML();
          var s7 = ptOrigenCifrasComparablesHTML();
          /* se insertan tras la sección de comparables si existe, si no al final */
          var ancla = [].slice.call(d.querySelectorAll('h2')).filter(function (h) { return /comparabilidad|comparables|selecci[oó]n del m[eé]todo/i.test(h.textContent); })[0];
          var bloque = (s6 || '') + (s7 || '');
          if (bloque) {
            if (ancla) ancla.insertAdjacentHTML('afterend', bloque);
            else d.insertAdjacentHTML('beforeend', bloque);
          }
        } catch (e) { }
      };
```

Reemplazar por (new_string — se retira `s6`, se conserva `s7`):

```js
      var _renderC = renderReport;
      renderReport = function () {
        _renderC.apply(null, arguments);
        try {
          var d = $('doc'); if (!d) return;
          var s7 = ptOrigenCifrasComparablesHTML();
          /* se inserta tras la sección de comparables si existe, si no al final */
          var ancla = [].slice.call(d.querySelectorAll('h2')).filter(function (h) { return /comparabilidad|comparables|selecci[oó]n del m[eé]todo/i.test(h.textContent); })[0];
          if (s7) {
            if (ancla) ancla.insertAdjacentHTML('afterend', s7);
            else d.insertAdjacentHTML('beforeend', s7);
          }
        } catch (e) { }
      };
```

- [ ] **Step 5: Verificar que no queda ninguna referencia**

```bash
grep -n "PT_PERFIL_NEGOCIO\|BASE_JUEGOS\|construirPerfilNegocio\|ptAfinidadNegocio\|ptPerfilNegocioInformeHTML" index.html
```

Debe devolver cero resultados.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "Eliminar Bloque 17-C: afinidad de negocio hardcodeada a videojuegos y la frase falsa en el informe"
```

---

### Task 9: Eliminar Bloques 5 y 6 (motor FAR/Conjunto base) y su configuración huérfana

**Files:**
- Modify: `index.html` — IIFE "Bloque 5: DEPURACIÓN FUNCIONAL DE COMPARABLES (FAR)" y "Bloque 6: CONFORMACIÓN DEL CONJUNTO E INFORME ESPECIAL" completas (última ubicación observada, Bloque 5 termina justo antes del comentario "PARCHE PT — Bloque 6", que a su vez contiene `PT_SELECCION`/`PT_CONJUNTO_CFG`/`ptSeleccionarConjunto`/`ptAplicarSeleccion`).

**Interfaces:** ninguna — se elimina código sin reemplazo (todo lo real ya se trasladó en las Tareas 1-4).

- [ ] **Step 1: Confirmar el alcance de Bloque 5**

Grep por `PARCHE PT — Bloque 5` y por `PARCHE PT — Bloque 6` (o el siguiente encabezado de bloque, "Bloque 7" ya fue modificado en la Tarea 4 pero su encabezado de comentario sigue existiendo) para delimitar exactamente dónde empieza y termina la IIFE de Bloque 5 (`(function () { 'use strict'; ... })();`). Confirmar que dentro solo quedan, sin ningún llamador ya (verificado en las Tareas 1-4 y 7): `PT_FAR`, `ROLES`, `RX_FIN_ORACION`, `ptPrimeraOracion`, `RX` (el set de regex), `ptClasificarFAR`, `COMPAT`, `gradoDe`/`ptGradoFAR`, `maxParticipacion` (ya duplicada en la Tarea 1, esta copia se borra), `ptDerivarFAR`, `PT_CRIBA`, `ptCribarUniverso`, `ptVerificarEnWeb`, `ptAplicarCriba`, `ptFARInformeHTML` (ya reemplazada en la Tarea 7 — verificar que la función que se borra aquí NO es la nueva de la Tarea 7; si el orden de tareas se respetó, la Tarea 7 ya dejó la versión correcta en su lugar, y este Step 1 solo debe confirmar que el resto de Bloque 5 alrededor de ella no tiene más llamadores activos), el panel `_ui()`/`ptFarPanel` con sus 4 botones y el input `ptFarN`.

- [ ] **Step 2: Borrar la IIFE completa de Bloque 5**

Usando el rango confirmado en el Step 1, borrar desde el comentario `/* ═══ PARCHE PT — Bloque 5: ... ═══ */` hasta el `})();` que cierra esa IIFE — **excepto** la función `ptFARInformeHTML` si el Step 1 confirma que ya fue reemplazada en su sitio por la Tarea 7 (en ese caso esa función ya no forma parte de "lo que sobra de Bloque 5"; se deja donde está, ya con su contenido nuevo).

- [ ] **Step 3: Confirmar el alcance de Bloque 6 y borrarlo**

Grep por `PARCHE PT — Bloque 6` para ubicar el inicio; su IIFE contiene `PT_SELECCION`, `PT_CONJUNTO_CFG`, `rolParte`, `nivelDe`, `NOMBRE_NIVEL`, `ptSeleccionarConjunto`, `ptAplicarSeleccion` y su panel de UI ("Conformar conjunto"/"Aplicar al estudio", con inputs `ptSelMin`/`ptSelObj`/`ptSelMax`). Confirmar que, tras las Tareas 3 y 8, ninguna de estas queda referenciada fuera de este bloque, y borrar la IIFE completa hasta su `})();`.

- [ ] **Step 4: Verificar que no queda ninguna referencia a los símbolos borrados**

```bash
grep -n "ptDerivarFAR\|ptClasificarFAR\|ROLES\[\|window\.PT_FAR\b\|PT_FAR_ROLES\|ptGradoFAR\|window\.PT_CRIBA\|window\.PT_SELECCION\|PT_CONJUNTO_CFG\|ptCribarUniverso\|ptSeleccionarConjunto\|ptAplicarSeleccion\|ptVerificarEnWeb\|ptAplicarCriba\|ptFarPanel\|ptFarN" index.html
```

Debe devolver cero resultados (si aparece algo dentro de comentarios explicativos de este mismo plan o del spec, no cuenta; debe ser cero dentro de `index.html`).

- [ ] **Step 5: Eliminar el sync huérfano de `PT_CONJUNTO_CFG` y los inputs de tamaño de conjunto obsoletos**

Buscar (old_string, dentro de `ptGuardarCriterios`, ya debería no encontrar `PT_CONJUNTO_CFG` tras el Step 3, pero por si la IIFE de Bloque 7 conserva el `if`):

```js
        if (window.PT_CONJUNTO_CFG) {
          PT_CONJUNTO_CFG.min = PT_CRITERIOS.minConjunto;
          PT_CONJUNTO_CFG.objetivo = PT_CRITERIOS.objetivoConjunto;
          PT_CONJUNTO_CFG.max = PT_CRITERIOS.maxConjunto;
        }
```

Si todavía existe, borrarlo (queda huérfano — ya no hay `PT_CONJUNTO_CFG` que sincronizar).

Buscar (old_string, panel de criterios):

```js
          '<label>Tamaño del conjunto<br>mín <input id="ptc_minConjunto" type="number" value="' + K.minConjunto + '" style="width:48px">' +
          ' obj <input id="ptc_objetivoConjunto" type="number" value="' + K.objetivoConjunto + '" style="width:48px">' +
          ' máx <input id="ptc_maxConjunto" type="number" value="' + K.maxConjunto + '" style="width:48px"></label>' +
```

Reemplazar por:

```js
          '<label>Tamaño mínimo defendible del conjunto<br>mín <input id="ptc_minConjunto" type="number" value="' + K.minConjunto + '" style="width:48px" title="Piso legal: no se remueven comparables de la doble prueba de industria si eso deja el conjunto por debajo de este número"></label>' +
```

- [ ] **Step 6: Quitar `objetivoConjunto`/`maxConjunto` de `POR_DEFECTO` y de `ptGuardarCriterios`**

Buscar (old_string, dentro de Bloque 7):

```js
        minConjunto: 8, objetivoConjunto: 10, maxConjunto: 15
      };
```

Reemplazar por:

```js
        minConjunto: 8
      };
```

Buscar (old_string):

```js
        ['tamanoFactor', 'independenciaTope', 'anios', 'minConjunto', 'objetivoConjunto', 'maxConjunto'].forEach(function (k) {
```

Reemplazar por:

```js
        ['tamanoFactor', 'independenciaTope', 'anios', 'minConjunto'].forEach(function (k) {
```

- [ ] **Step 7: Verificar referencias muertas finales**

```bash
grep -n "objetivoConjunto\|maxConjunto\|ptc_objetivoConjunto\|ptc_maxConjunto" index.html
```

Debe devolver cero resultados.

- [ ] **Step 8: Confirmar que los paneles que anclaban en `ptFarPanel` siguen funcionando**

Grep por `getElementById('ptFarPanel')` — cada resultado debe formar parte de una cadena `||` con al menos otro fallback (`compalert`, `cbody`, `ptConectorPanel`, `ptSelPanel`). Si algún panel dependiera de `ptFarPanel` como ÚNICO ancla (sin fallback), anotarlo y decidir un ancla alternativa antes de continuar — no se espera este caso según la auditoría del spec, pero debe confirmarse aquí porque `ptFarPanel` ya no se crea.

- [ ] **Step 9: Commit**

```bash
git add index.html
git commit -m "Eliminar Bloques 5 y 6 (motor FAR/Conjunto hardcodeado) y su configuración huérfana"
```

---

### Task 10: Repuntar `ptGuardaInforme()` (el aviso de la imagen 1) a `MATRIX`

**Files:**
- Modify: `index.html` — función `window.ptGuardaInforme` (última ubicación observada ~línea 13044, el chequeo específico ~línea 13062).

**Interfaces:** sin cambios de firma; sigue devolviendo `{fallas, avisos, requisitos, ok}`.

- [ ] **Step 1: Confirmar el texto vigente**

Grep por `matrixLen === 0` para ubicar la línea exacta.

- [ ] **Step 2: Simplificar el chequeo de "depuración no ejecutada"**

Buscar (old_string):

```js
        if (nFilas > 0 && matrixLen === 0 && !(window.PT_CRIBA && PT_CRIBA.filas && PT_CRIBA.filas.length)) {
```

Reemplazar por:

```js
        if (nFilas > 0 && matrixLen === 0) {
```

- [ ] **Step 3: Verificar que la falla de "empresas fuera de industria" (que llama a `ptVerificarIndustriaTabla`) sigue intacta**

Leer las ~15 líneas siguientes a la del Step 2 y confirmar que el bloque que arma `fallas.push({id:'industria', ...})` sigue llamando a `ptVerificarIndustriaTabla()`/`ptIndustriaExaminada()` sin cambios — esas funciones ya quedaron generalizadas en la Tarea 2, no requieren tocarse aquí.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "Repuntar ptGuardaInforme: la depuración ejecutada se verifica por MATRIX, no por PT_CRIBA"
```

---

### Task 11: Verificación funcional completa en navegador

**Files:** ninguno (solo pruebas manuales).

- [ ] **Step 1: Confirmar que no queda ningún símbolo borrado referenciado en todo el archivo**

```bash
grep -n "PT_CRIBA\|PT_SELECCION\|PT_CONJUNTO_CFG\|ptCribarUniverso\|ptSeleccionarConjunto\|ptAplicarSeleccion\|ptVerificarEnWeb\|ptAplicarCriba\|IND_DEFECTO\|ptClasificarFAR\|ptDerivarFAR\|PT_PERFIL_NEGOCIO\|BASE_JUEGOS\|ptAfinidadNegocio\|ptPerfilNegocioInformeHTML\|window\.PT_FAR\b\|PT_FAR_ROLES\|ptFarPanel\|ptFarN" index.html
```

Debe devolver cero resultados. Si aparece algo, resolverlo antes de continuar (probablemente una tarea anterior quedó incompleta).

- [ ] **Step 2: Levantar la app**

Usar el skill `run` para lanzar la aplicación en el navegador.

- [ ] **Step 3: Reproducir el bug original**

Importar un Excel de Capital IQ con >50 filas, incluyendo compañías con SIC 6719 y/o "Holding(s)" en el nombre. Configurar el Motor TOP-N con N=20 y "Sociedades holding: Excluir". Pulsar "Solucionar todo automáticamente en 1 clic". Confirmar que el resultado tiene como máximo 20 filas, ninguna con SIC 6719 ni "Holding" en el nombre.

- [ ] **Step 4: Probar el test de independencia**

Con una fila cuya columna de accionistas (importada del Excel, visible en `COMP_META`) indique más de 50% de un solo accionista, confirmar que el motor la excluye con el motivo correspondiente (Art. 260-1 E.T.).

- [ ] **Step 5: Probar el bono de continuidad**

Cargar un estudio del año anterior con comparables aceptadas (usar el flujo existente de "Estudio base"), asegurarse de que al menos una coincide por nombre con una fila de la tabla actual, ejecutar el motor y confirmar en el detalle del motivo que aparece "continuidad con el año anterior" para esa fila.

- [ ] **Step 6: Generar el informe completo**

Confirmar: (a) el Anexo D aparece una sola vez; (b) no existe ninguna sección "B. Resultado de la depuración" con categorías fijas de industria; (c) "A. Perfil de la actividad específica" muestra el resumen real (Gemini), no un rol fijo; (d) la tabla "Verificación de los factores de comparabilidad (Art. 260-4 E.T.)" no dice "Pendiente" en ninguna fila cuando el motor ya corrió; (e) no aparece la palabra "videojuegos" en ningún lado si el estudio cargado es de otra industria.

- [ ] **Step 7: Repetir con una industria distinta a videojuegos**

Cargar (o simular) un estudio de una industria distinta (p. ej. distribución de agroquímicos) y repetir el Step 6 completo, confirmando que absolutamente ningún texto de la industria anterior (videojuegos) aparece en el informe generado.

- [ ] **Step 8: Confirmar que "Ejecutar selección" manual sigue funcionando**

Sin pasar por "corrección automática", cargar comparables manualmente y usar el botón "Ejecutar selección" del panel Motor TOP-N — debe comportarse igual que antes de este trabajo.

- [ ] **Step 9: Confirmar los paneles que anclaban en `ptFarPanel`**

Verificar visualmente que ningún panel de la tarjeta de Comparables quedó "perdido" o dejó de aparecer por la eliminación de `ptFarPanel` (deben seguir apareciendo en su fallback, conforme a lo verificado en la Tarea 9, Step 8).

- [ ] **Step 10: Commit final (si hubo ajustes durante la verificación)**

```bash
git add index.html
git commit -m "Ajustes de verificación funcional tras unificar el motor de comparables"
```
