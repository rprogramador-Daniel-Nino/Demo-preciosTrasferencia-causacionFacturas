# Actividad Específica y Perfil Funcional (Gemini) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a self-contained "extraction service" that pulls the real commercial activity, functional/risk profile (FAR), search keywords and SIC codes out of the prior year's study (already loaded in `window.PT_ANTERIOR`) using Gemini, show the result to the user as an editable panel, and feed it into the existing comparables-matching engine (`ptPerfilNegocio`, `sicexp`) and into the Claude report-drafting context (`buildClaudeContext`). Also remove the obsolete `pt314bar` sticky bar.

**Architecture:** Everything lives in `index_CORREGIDO.html` only (confirmed with the user — `public/index.html` is out of scope for this change and will NOT be touched). No backend changes are needed: the existing generic `/api/gemini` proxy (`server.js:55-79` / `functions/index.js` `exports.gemini`) already forwards any `{contents:[...]}` body to Gemini, so a plain-text extraction prompt works exactly like the existing OCR call in `public/index.html` — just without an `inline_data` image part. The extracted data is stored as a JSON string in a new per-study field (`actividad_json`), threaded through the existing `blank()` / `readForm()` / `writeForm()` round-trip so it persists across save-to-memory / load-from-memory like every other field.

**Tech Stack:** Vanilla JS (no build step, no framework), inline `<style>`/`<script>` in a single HTML file, existing `/api/gemini` Express/Cloud-Function proxy.

## Global Constraints

- Only edit `index_CORREGIDO.html`. Do NOT touch `public/index.html`, `server.js`, or `functions/index.js` — confirmed with the user, since `index_CORREGIDO.html` is not the file actually deployed and the two copies already diverge (public/index.html has a Gemini OCR feature index_CORREGIDO.html lacks).
- This project has **no automated test suite** (no Jest/Mocha — `package.json` only has `build`/`start` scripts). "Testing" for every task below means: (1) a Node syntax-check command that parses every inline `<script>` block with `new Function(...)` to catch JS syntax errors immediately, and (2) targeted `grep`/manual checks described per task. Do not invent fake unit tests.
- Follow existing code conventions exactly: `$(id)` for `document.getElementById`, `calc()`/`calcD()` to recompute/debounce, `saveActive()` to persist the in-memory form into `studies[active]`, `escH()` to escape any user/AI text before inserting as HTML, CSS variables from `:root` (`--teal`, `--teal-d`, `--violet`, `--muted`, `--hair`, `--text`), and the `.card`/`.hd`/`.bd`/`.f`/`.l`/`.i`/`.mini`/`.hint` class system already used throughout the file.
- Never store durable data on the `MOTOR` object — it is the ephemeral state of the automatic comparable-scoring engine and gets fully overwritten (`MOTOR = {...}`) every time `motorEjecutar()` runs (`index_CORREGIDO.html:2916`). The activity signature must survive that, so it lives on the study object instead (same lifecycle as `sicexp`, `objeto`, etc.).
- All new user-facing text is Spanish, matching the rest of the app's tone (formal, transfer-pricing domain language).

---

### Task 1: Eliminar la barra fija `pt314bar`

**Files:**
- Modify: `index_CORREGIDO.html:4811-4862`

**Interfaces:**
- Consumes: nothing (self-contained block).
- Produces: nothing later depends on this block — confirmed by grep that `pt314bar`/`pt314anio`/`pt314ingesta`/`pt314msg` appear nowhere else in the file.

- [ ] **Step 1: Delete the whole `_pt314Bar` block**

Delete these exact lines (the comment header, the function, and its two scheduling lines):

```js
    /* ═══ PT3.14 — Barra fija: AÑO + ingesta universal siempre disponible ═══ */
    function _pt314Bar() {
      if (document.getElementById('pt314bar')) return;
      var bar = document.createElement('div'); bar.id = 'pt314bar';
      bar.style.cssText = 'position:sticky;top:0;z-index:500;display:flex;gap:12px;align-items:center;flex-wrap:wrap;' +
        'padding:10px 14px;background:#0B5563;color:#fff;border-radius:0 0 10px 10px;margin:-4px 0 14px;box-shadow:0 2px 8px rgba(0,0,0,.15)';
      bar.innerHTML =
        '<b style="font-size:14px">📅 Año de la documentación</b>' +
        '<select id="pt314anio" style="font-size:15px;font-weight:700;padding:5px 10px;border-radius:6px;border:none;min-width:110px"></select>' +
        '<span style="opacity:.85;font-size:12px">La base histórica será exclusivamente la documentación comprobatoria del año anterior.</span>' +
        '<label style="margin-left:auto;cursor:pointer;background:#fff;color:#0B5563;font-weight:700;padding:7px 14px;border-radius:6px">' +
        '📎 Ingresar información (cualquier documento)<input type="file" id="pt314ingesta" multiple accept=".pdf,.txt,.xlsx,.xls,.csv,.json,image/*" style="display:none"></label>' +
        '<span id="pt314msg" style="font-size:12px;opacity:.9"></span>';
      var cont = document.querySelector('.wrap') || document.querySelector('main') || document.body;
      cont.insertBefore(bar, cont.firstChild);

      // poblar años (año actual y 4 atrás), sincronizado con #anio y #histyear
      var sel = document.getElementById('pt314anio'), now = new Date().getFullYear();
      for (var y = now; y >= now - 5; y--) { var o = document.createElement('option'); o.value = y; o.textContent = y; sel.appendChild(o); }
      var actual = ($('anio') && $('anio').value) || ($('histyear') && $('histyear').value) || String(now - 1);
      sel.value = actual;
      function fijarAnio(v) {
        if ($('anio')) { $('anio').value = v; try { $('anio').dispatchEvent(new Event('change', { bubbles: true })); } catch (e) { } }
        if ($('histyear')) $('histyear').value = v;
        try { if (typeof _pt310EconAuto === 'function') _pt310EconAuto(); } catch (e) { }
        try { if (typeof _pt312DelAnioAnterior === 'function') _pt312DelAnioAnterior(); } catch (e) { }
        try { calc(); } catch (e) { }
      }
      sel.addEventListener('change', function () { fijarAnio(sel.value); });
      fijarAnio(sel.value);

      // ingesta universal: enruta cada archivo por su nombre a la función correcta
      document.getElementById('pt314ingesta').addEventListener('change', function (ev) {
        var files = [].slice.call(ev.target.files || []); if (!files.length) return;
        var msg = document.getElementById('pt314msg'); var hechos = [];
        files.forEach(function (f) {
          var n = (f.name || '').toLowerCase();
          if (/rut/.test(n)) { readFileText(f, applyRUT); hechos.push('RUT'); }
          else if (/camara|cámara|mercantil/.test(n)) { readFileText(f, applyCamara); hechos.push('Cámara'); }
          else if (/renta|110|declaraci/.test(n)) { readFileText(f, applyRenta); hechos.push('Renta'); }
          else if (/operacion|1125|vinculad/.test(n)) { adjCargar([f], 'otros', function () { pt36AnalizarOperaciones && pt36AnalizarOperaciones(); }); hechos.push('Operaciones'); }
          else if (/eeff|financ|estado|niif|esf|eri/.test(n)) { adjCargar([f], 'eeff'); setTimeout(function () { extraerEEFF && extraerEEFF(); }, 200); hechos.push('EEFF'); }
          else if (/comparabl|capital\s*iq|screening|orbis/.test(n)) { adjCargar([f], 'otros'); if (typeof importCompsFile === 'function') importCompsFile(f); hechos.push('Comparables'); }
          else if (/\.json$/.test(n)) { if (typeof cargarInformeAnterior === 'function') cargarInformeAnterior(f); hechos.push('Informe anterior'); }
          else { adjCargar([f], 'otros'); hechos.push(f.name); }
        });
        if (msg) msg.textContent = '✓ Ingresado: ' + hechos.join(', ');
        ev.target.value = '';
      });
    }
    if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', function () { setTimeout(_pt314Bar, 1200); }); }
    else { setTimeout(_pt314Bar, 1200); }
```

Leave the surrounding blocks (`_pt313Numerar` above it, `_pt315JustificacionAuto` below it) untouched.

- [ ] **Step 2: Verify no dangling references remain**

Run:
```bash
grep -n "pt314" "index_CORREGIDO.html"
```
Expected: no output (zero matches).

- [ ] **Step 3: Verify JS syntax is still valid**

Run:
```bash
node -e "const fs=require('fs');const html=fs.readFileSync('index_CORREGIDO.html','utf8');const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);scripts.forEach((s,i)=>{try{new Function(s);}catch(e){console.error('Script block '+i+' error:',e.message);process.exit(1);}});console.log('OK: '+scripts.length+' script blocks parsed');"
```
Expected: `OK: N script blocks parsed` with no error thrown.

- [ ] **Step 4: Commit**

```bash
git add index_CORREGIDO.html
git commit -m "Quitar la barra fija pt314bar (año + ingesta universal) de index_CORREGIDO.html"
```

---

### Task 2: Modelo de datos — campo persistente `actividad_json`

**Files:**
- Modify: `index_CORREGIDO.html:1753-1757` (`blank()`)
- Modify: `index_CORREGIDO.html:2151-2160` (`readForm()` / `writeForm()`)

**Interfaces:**
- Produces: a DOM input `#actividad_json` (created in Task 3, but referenced by `readForm`/`writeForm` from this task on) whose `.value` holds `JSON.stringify({resumen, perfil, productos, keywords, sic, justificacion, fuente, fecha})` or `''` when nothing has been extracted yet. Every later task reads/writes this exclusively through `getActividadEspecifica()`/`setActividadEspecifica()` (added in Task 4) — never by touching `#actividad_json` directly outside those two functions.

- [ ] **Step 1: Add the field to `blank()`**

Change (`index_CORREGIDO.html:1753-1757`):
```js
    const blank = () => ({
      name: 'Estudio nuevo', ent: '', nit: '', vinc: '', pais: '', oper: '', cod: '', monto: '', anio: '', base: '', pli: 'MO', cmode: 'all',
      prime: '', uvt: '', umbral: '45000', egreso: '', unidad: 'miles', qmethod: 'inc', useadj: true, t: { s: null, c: null, op: null, ar: null, inv: null, ap: null },
      e_mundo: '', e_col: '', e_sec: '', sicexp: '', vincid: '', vincdoc: '42', paiscod: '', tipovinc: '1', natur: 'Egreso', costoren: '', comps: [['', 'Int', null, null, null, null, null, null, ''], ['', 'Int', null, null, null, null, null, null, ''], ['', 'Int', null, null, null, null, null, null, '']]
    });
```
to:
```js
    const blank = () => ({
      name: 'Estudio nuevo', ent: '', nit: '', vinc: '', pais: '', oper: '', cod: '', monto: '', anio: '', base: '', pli: 'MO', cmode: 'all',
      prime: '', uvt: '', umbral: '45000', egreso: '', unidad: 'miles', qmethod: 'inc', useadj: true, t: { s: null, c: null, op: null, ar: null, inv: null, ap: null },
      e_mundo: '', e_col: '', e_sec: '', sicexp: '', vincid: '', vincdoc: '42', paiscod: '', tipovinc: '1', natur: 'Egreso', costoren: '', actividad_json: '', comps: [['', 'Int', null, null, null, null, null, null, ''], ['', 'Int', null, null, null, null, null, null, ''], ['', 'Int', null, null, null, null, null, null, '']]
    });
```

- [ ] **Step 2: Read the field in `readForm()`**

Change (`index_CORREGIDO.html:2151-2155`):
```js
    function readForm() {
      return {
        name: studies[active] ? studies[active].name : 'Estudio', ent: $('ent').value, nit: $('nit').value, ciiu: $('ciiu').value, replegal: $('replegal').value, objeto: $('objeto').value, constitucion: $('constitucion').value, vinc: $('vinc').value, pais: $('pais').value, oper: $('oper').value, cod: $('cod').value, monto: $('monto').value, anio: $('anio').value, base: $('base').value, pli: $('pli').value, t: { s: num($('t_s').value), c: num($('t_c').value), op: num($('t_op').value), ar: num($('t_ar').value), inv: num($('t_inv').value), ap: num($('t_ap').value) }, comps: [...$('cbody').children].map(tr => { const v = [...tr.querySelectorAll('input,select')].map(i => i.value); return [v[0], v[1], num(v[2]), num(v[3]), num(v[4]), num(v[5]), num(v[6]), num(v[7]), v[8] || '']; })
      };
    }
```
to:
```js
    function readForm() {
      return {
        name: studies[active] ? studies[active].name : 'Estudio', ent: $('ent').value, nit: $('nit').value, ciiu: $('ciiu').value, replegal: $('replegal').value, objeto: $('objeto').value, constitucion: $('constitucion').value, vinc: $('vinc').value, pais: $('pais').value, oper: $('oper').value, cod: $('cod').value, monto: $('monto').value, anio: $('anio').value, base: $('base').value, pli: $('pli').value, actividad_json: $('actividad_json') ? $('actividad_json').value : '', t: { s: num($('t_s').value), c: num($('t_c').value), op: num($('t_op').value), ar: num($('t_ar').value), inv: num($('t_inv').value), ap: num($('t_ap').value) }, comps: [...$('cbody').children].map(tr => { const v = [...tr.querySelectorAll('input,select')].map(i => i.value); return [v[0], v[1], num(v[2]), num(v[3]), num(v[4]), num(v[5]), num(v[6]), num(v[7]), v[8] || '']; })
      };
    }
```
(Guarded with `$('actividad_json') ?` because Task 2 runs before Task 3 creates the element — keep the guard permanently anyway, it costs nothing and matches the file's existing defensive style.)

- [ ] **Step 3: Write the field back in `writeForm()` and refresh its UI**

Change (`index_CORREGIDO.html:2156-2160`):
```js
    function writeForm(s) {
      ['ent', 'nit', 'ciiu', 'replegal', 'objeto', 'constitucion', 'vinc', 'pais', 'oper', 'cod', 'monto', 'anio', 'base', 'pli'].forEach(k => $(k).value = s[k] || '');
      const t = s.t || {}; ['s', 'c', 'op', 'ar', 'inv', 'ap'].forEach(k => $('t_' + k).value = t[k] ?? '');
      $('cbody').innerHTML = ''; const frag = document.createDocumentFragment(); (s.comps || []).forEach(c => frag.appendChild(compRow(c))); $('cbody').appendChild(frag);
    }
```
to:
```js
    function writeForm(s) {
      ['ent', 'nit', 'ciiu', 'replegal', 'objeto', 'constitucion', 'vinc', 'pais', 'oper', 'cod', 'monto', 'anio', 'base', 'pli'].forEach(k => $(k).value = s[k] || '');
      const t = s.t || {}; ['s', 'c', 'op', 'ar', 'inv', 'ap'].forEach(k => $('t_' + k).value = t[k] ?? '');
      $('cbody').innerHTML = ''; const frag = document.createDocumentFragment(); (s.comps || []).forEach(c => frag.appendChild(compRow(c))); $('cbody').appendChild(frag);
      if ($('actividad_json')) { $('actividad_json').value = s.actividad_json || ''; }
      if (typeof renderActividadEspecifica === 'function') renderActividadEspecifica();
    }
```
(`renderActividadEspecifica` is added in Task 4; the `typeof` guard means this task's edit is safe to commit on its own before that function exists.)

- [ ] **Step 4: Verify JS syntax is still valid**

Run the same command as Task 1 Step 3. Expected: `OK: N script blocks parsed`.

- [ ] **Step 5: Commit**

```bash
git add index_CORREGIDO.html
git commit -m "Agregar campo persistente actividad_json al modelo de estudio (blank/readForm/writeForm)"
```

---

### Task 3: Tarjeta UI + estilos de chips

**Files:**
- Modify: `index_CORREGIDO.html` (CSS `<style>` block, insert after the `.hint {...}` rule)
- Modify: `index_CORREGIDO.html:1172-1174` (insert new card between the "Documentación comprobatoria del año anterior" card and the "Operación analizada" card)

**Interfaces:**
- Produces: DOM elements `#btnExtraerActividad`, `#actmsg`, `#activity_spec_card`, `#act_resumen`, `#act_perfil`, `#act_keywords_chips`, `#act_keyword_new`, `#act_sic_chips`, `#act_sic_new`, `#act_justificacion`, `#actividad_json` (hidden input) — all consumed by Task 4's JS.
- Consumes: nothing yet (buttons reference functions added in Task 4 — the page will show a "not defined" console error if you open it between Task 3 and Task 4; that's expected and resolved by the end of Task 4).

- [ ] **Step 1: Add chip CSS**

Find this existing rule:
```css
    .hint {
      font-size: 11px;
      color: var(--muted);
      margin-top: 3px
    }
```
and insert immediately after it:
```css

    .actchips {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin: 6px 0
    }

    .actchip {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 6px 4px 10px;
      border-radius: 999px;
      background: #E3F6F5;
      border: 1px solid var(--teal);
      color: var(--teal-d);
      font-size: 12px;
      font-weight: 600
    }

    .actchip.sic {
      background: #F5EEF8;
      border-color: var(--violet);
      color: #5B3A99
    }

    .actchip button {
      border: none;
      background: transparent;
      color: inherit;
      cursor: pointer;
      font-size: 13px;
      line-height: 1;
      padding: 0
    }
```

- [ ] **Step 2: Insert the new card**

Find (`index_CORREGIDO.html:1172-1174`):
```html
        </div>
      </div>

      <div class="card">
        <div class="hd">
          <h3>Operación analizada (requiere el Excel de operaciones)</h3><span class="card-status-badge pending"
```
Insert the new card between the closing `</div>` of the memoria-histórica card and the "Operación analizada" card, so it reads:
```html
        </div>
      </div>

      <div class="card full">
        <div class="hd">
          <h3>Actividad específica y perfil funcional (extraída con IA del estudio del año anterior)</h3><span
            class="eyebrow">firma de actividad · para comparables</span>
        </div>
        <div class="bd">
          <div class="tip">Este dato reemplaza el objeto social genérico de Cámara de Comercio como criterio de
            búsqueda de comparables. Se extrae del <b>estudio del año anterior</b> ya cargado como fuente histórica
            (tarjeta de arriba) y alimenta directamente las palabras clave de comparables y el contexto que recibe
            Claude para justificarlos.</div>
          <button class="mini" onclick="extractPriorActivityWithGemini()" id="btnExtraerActividad">🤖 Extraer
            actividad específica con Gemini (desde año anterior)</button>
          <div class="hint" id="actmsg">Aún no se ha extraído la actividad específica. Cargue primero el estudio del
            año anterior arriba y luego pulse el botón.</div>
          <input type="hidden" id="actividad_json" value="">
          <div id="activity_spec_card" style="display:none;margin-top:10px">
            <div class="row2">
              <label class="f"><span class="l">Actividad específica detectada (resumen corto)</span>
                <textarea class="i" id="act_resumen" rows="2" oninput="actividadEditada()"></textarea>
              </label>
              <label class="f"><span class="l">Perfil funcional (FAR) detectado</span>
                <textarea class="i" id="act_perfil" rows="2" oninput="actividadEditada()"></textarea>
              </label>
            </div>
            <label class="f"><span class="l">Palabras clave para buscar comparables (clic en × para quitar; escriba
                y presione Enter para agregar)</span>
              <div class="actchips" id="act_keywords_chips"></div>
              <input class="i" id="act_keyword_new" placeholder="agregar palabra clave…"
                onkeydown="if(event.key==='Enter'){event.preventDefault();actividadAgregarChip('keywords', this.value); this.value='';}">
            </label>
            <label class="f"><span class="l">Códigos SIC sugeridos (editable)</span>
              <div class="actchips" id="act_sic_chips"></div>
              <input class="i" id="act_sic_new" placeholder="agregar código SIC…"
                onkeydown="if(event.key==='Enter'){event.preventDefault();actividadAgregarChip('sic', this.value); this.value='';}">
            </label>
            <div class="hint" id="act_justificacion"></div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="hd">
          <h3>Operación analizada (requiere el Excel de operaciones)</h3><span class="card-status-badge pending"
```

- [ ] **Step 3: Verify JS syntax is still valid**

Run the same command as Task 1 Step 3 (the added markup is plain HTML, but the check also confirms the surrounding `<script>` blocks are still intact).

- [ ] **Step 4: Manual check — card renders**

Open `index_CORREGIDO.html` directly in a browser (double-click or `file://` path is enough for this visual check only, no API calls yet) and confirm the new card "Actividad específica y perfil funcional…" appears right after "Documentación comprobatoria del año anterior" and before "Operación analizada", with the button, hint text, and an empty (hidden) panel. Ignore any console error about `extractPriorActivityWithGemini is not defined` — that's expected until Task 4.

- [ ] **Step 5: Commit**

```bash
git add index_CORREGIDO.html
git commit -m "Agregar tarjeta UI y estilos de chips para actividad específica extraída"
```

---

### Task 4: Lógica de extracción con Gemini y edición de chips

**Files:**
- Modify: `index_CORREGIDO.html` (insert new functions right after `buildFromScratch()`, i.e. after `index_CORREGIDO.html:1799`, before the `/* ================= SUSTENTACIÓN DEL MÉTODO ================= */` comment)

**Interfaces:**
- Consumes: `$()`, `escH()`, `calc()`, `calcD()`, `saveActive()` (all defined earlier in the same script, function-hoisted so call order doesn't matter), `window.PT_ANTERIOR.texto` / `.fuente` (set by the existing "informe anterior" ingestion flow at `index_CORREGIDO.html:6582-6618`), and the DOM ids from Task 3.
- Produces: `getActividadEspecifica()` → `object|null`, `setActividadEspecifica(obj)` → `void`, `renderActividadEspecifica()` → `void` (called by `writeForm()` from Task 3, and by itself), `renderActChips(campo, lista)` → `void`, `actividadAgregarChip(campo, valor)` → `void`, `actividadQuitarChip(campo, idx)` → `void`, `actividadEditada()` → `void`, `sicexpDesdeActividad()` → `void`, `extractPriorActivityWithGemini()` → `Promise<void>` (bound to `#btnExtraerActividad` in Task 3). Task 5 calls `getActividadEspecifica()`.

- [ ] **Step 1: Insert the extraction service**

Find (`index_CORREGIDO.html:1799`):
```js
    function buildFromScratch() { const ent = ($('histent').value || $('ent').value || '').trim(); const yr = ($('histyear').value || '').trim(); saveActive(); const b = blank(); b.ent = ent; b.anio = yr; b.name = (ent || 'Estudio') + ' ' + yr; studies.push(b); active = studies.length - 1; writeForm(studies[active]); refreshSel(); calc(); histMsg('Estudio ' + (yr || '') + ' iniciado desde cero' + (ent ? (' para ' + ent) : '') + '.'); }
```
Insert immediately after it (before the `/* ================= SUSTENTACIÓN DEL MÉTODO ================= */` comment):
```js

    /* ================= ACTIVIDAD ESPECÍFICA (servicio independiente, Gemini) =================
       Se guarda en el estudio activo (actividad_json), NO en MOTOR: MOTOR se reinicia por
       completo en cada motorEjecutar() y perdería el dato. */
    function getActividadEspecifica() {
      try { const el = $('actividad_json'); const v = el ? el.value : ''; return v ? JSON.parse(v) : null; } catch (e) { return null; }
    }
    function setActividadEspecifica(obj) {
      if (!$('actividad_json')) return;
      $('actividad_json').value = obj ? JSON.stringify(obj) : '';
      renderActividadEspecifica();
      saveActive();
    }
    function renderActividadEspecifica() {
      const obj = getActividadEspecifica();
      const panel = $('activity_spec_card'), msg = $('actmsg');
      if (!obj) { if (panel) panel.style.display = 'none'; return; }
      if (panel) panel.style.display = 'block';
      if ($('act_resumen')) $('act_resumen').value = obj.resumen || '';
      if ($('act_perfil')) $('act_perfil').value = obj.perfil || '';
      if ($('act_justificacion')) $('act_justificacion').textContent = obj.justificacion ? ('Justificación de la IA: ' + obj.justificacion) : '';
      renderActChips('keywords', obj.keywords || []);
      renderActChips('sic', obj.sic || []);
      if (msg) msg.textContent = 'Extraído' + (obj.fuente ? (' de «' + obj.fuente + '»') : '') + (obj.fecha ? (' el ' + new Date(obj.fecha).toLocaleString('es-CO')) : '') + '. Edite lo que considere antes de buscar comparables.';
    }
    function renderActChips(campo, lista) {
      const cont = $(campo === 'sic' ? 'act_sic_chips' : 'act_keywords_chips'); if (!cont) return;
      cont.innerHTML = (lista || []).map((v, i) => '<span class="actchip' + (campo === 'sic' ? ' sic' : '') + '">' + escH(v) + '<button type="button" onclick="actividadQuitarChip(\'' + campo + '\',' + i + ')" aria-label="Quitar ' + escH(v) + '">×</button></span>').join('');
    }
    function actividadAgregarChip(campo, valor) {
      valor = (valor || '').trim(); if (!valor) return;
      const obj = getActividadEspecifica() || { resumen: '', perfil: '', productos: [], keywords: [], sic: [], justificacion: '' };
      const arr = obj[campo] || [];
      if (!arr.some(x => x.toLowerCase() === valor.toLowerCase())) arr.push(valor);
      obj[campo] = arr;
      setActividadEspecifica(obj);
      sicexpDesdeActividad();
    }
    function actividadQuitarChip(campo, idx) {
      const obj = getActividadEspecifica(); if (!obj) return;
      (obj[campo] || []).splice(idx, 1);
      setActividadEspecifica(obj);
      sicexpDesdeActividad();
    }
    function actividadEditada() {
      const obj = getActividadEspecifica() || { resumen: '', perfil: '', productos: [], keywords: [], sic: [], justificacion: '' };
      if ($('act_resumen')) obj.resumen = $('act_resumen').value;
      if ($('act_perfil')) obj.perfil = $('act_perfil').value;
      if ($('actividad_json')) $('actividad_json').value = JSON.stringify(obj);
      saveActive(); calc();
    }
    function sicexpDesdeActividad() {
      const obj = getActividadEspecifica(); if (!obj || !$('sicexp')) return;
      const partes = [].concat(obj.sic || [], obj.keywords || []);
      if (partes.length) { $('sicexp').value = partes.join(', '); calcD(); }
    }

    async function extractPriorActivityWithGemini() {
      const msg = $('actmsg'), btn = $('btnExtraerActividad');
      if (!window.PT_ANTERIOR || !PT_ANTERIOR.texto) {
        if (msg) msg.textContent = '⚠ No hay estudio del año anterior cargado en memoria. Cárguelo primero en la tarjeta «Documentación comprobatoria del año anterior».';
        return;
      }
      if (btn) btn.disabled = true;
      if (msg) msg.textContent = '⏳ Extrayendo actividad específica con Gemini…';
      const texto = PT_ANTERIOR.texto.slice(0, 24000);
      const prompt = 'Eres especialista en precios de transferencia en Colombia. Del siguiente texto de un estudio de precios de transferencia del año anterior, extrae EXCLUSIVAMENTE la actividad económica real de la Compañía (no la redacción jurídica genérica del objeto social ni el código CIIU), su perfil funcional y de riesgos (FAR), y palabras clave y códigos SIC útiles para buscar comparables en bases de datos como Capital IQ, Orbis o SuperSociedades.\n\n' +
        'Responde ÚNICAMENTE con un objeto JSON válido, sin marcas markdown, con esta forma exacta:\n' +
        '{"actividad_especifica_corta":"","perfil_funcional_far":"","productos_servicios_clave":[],"keywords_busqueda_comparables":[],"codigos_sic_sugeridos":[],"justificacion_perfil":""}\n\n' +
        'Texto del estudio del año anterior:\n' + texto;
      try {
        const res = await fetch('/api/gemini', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        const data = await res.json();
        const cand = data && data.candidates && data.candidates[0];
        const raw = cand && cand.content && cand.content.parts ? cand.content.parts.map(p => p.text || '').join('') : '';
        if (!res.ok || !raw) throw new Error((data && data.error && (data.error.message || JSON.stringify(data.error))) || 'Respuesta vacía de Gemini');
        const limpio = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
        const j = JSON.parse(limpio);
        setActividadEspecifica({
          resumen: j.actividad_especifica_corta || '', perfil: j.perfil_funcional_far || '',
          productos: j.productos_servicios_clave || [], keywords: j.keywords_busqueda_comparables || [],
          sic: j.codigos_sic_sugeridos || [], justificacion: j.justificacion_perfil || '',
          fuente: PT_ANTERIOR.fuente || 'estudio del año anterior', fecha: new Date().toISOString()
        });
        sicexpDesdeActividad();
        if (msg) msg.textContent = '✓ Actividad específica extraída y aplicada. Revise y edite los campos antes de buscar comparables.';
      } catch (e) {
        if (msg) msg.textContent = '⚠ No se pudo extraer con Gemini: ' + e.message + '. Puede diligenciar los campos manualmente.';
      } finally {
        if (btn) btn.disabled = false;
      }
    }
```

- [ ] **Step 2: Verify JS syntax is still valid**

Run the same command as Task 1 Step 3. Expected: `OK: N script blocks parsed`.

- [ ] **Step 3: Manual check — chip add/remove works without the backend**

Serve the file so relative paths resolve consistently (any static server is fine for this DOM-only check, e.g. `npx serve .` from the repo root, or simply open via `file://`). In the new card, type a word into "agregar palabra clave…" and press Enter — a chip should appear. Click its `×` — it should disappear. Confirm no console errors. (This exercises `actividadAgregarChip`/`actividadQuitarChip`/`renderActChips` without needing a working `/api/gemini` call.)

- [ ] **Step 4: Commit**

```bash
git add index_CORREGIDO.html
git commit -m "Implementar servicio de extracción de actividad específica con Gemini y edición de chips"
```

---

### Task 5: Conexión con el motor de comparables y con Claude

**Files:**
- Modify: `index_CORREGIDO.html:1809` (`buildClaudeContext()`)
- Modify: `index_CORREGIDO.html:6036-6046` (`ptPerfilNegocio()`)

**Interfaces:**
- Consumes: `getActividadEspecifica()` from Task 4.
- Produces: nothing new — this task only enriches two existing functions' return values. `buildClaudeContext()`'s callers (`askClaude()` at both its definitions, `sugerirIndicador()`) and `ptPerfilNegocio()`'s caller (the comparables-continuity matcher at `index_CORREGIDO.html:6130`) get the richer text automatically, unchanged signatures.

- [ ] **Step 1: Enrich `buildClaudeContext()`**

Change (`index_CORREGIDO.html:1809`):
```js
    function buildClaudeContext() { const g = k => $(k).value || ''; return ['Entidad: ' + g('ent'), 'Año gravable: ' + g('anio'), 'Vinculado: ' + g('vinc') + ' (' + g('pais') + ')', 'Operación: ' + g('oper') + ' por COP ' + g('monto'), 'Indicador (PLI): ' + $('pli').value, 'CIIU: ' + g('ciiu'), 'Objeto social: ' + g('objeto')].join('\n'); }
```
to:
```js
    function buildClaudeContext() {
      const g = k => $(k).value || '';
      const partes = ['Entidad: ' + g('ent'), 'Año gravable: ' + g('anio'), 'Vinculado: ' + g('vinc') + ' (' + g('pais') + ')', 'Operación: ' + g('oper') + ' por COP ' + g('monto'), 'Indicador (PLI): ' + $('pli').value, 'CIIU: ' + g('ciiu'), 'Objeto social: ' + g('objeto')];
      const act = (typeof getActividadEspecifica === 'function') ? getActividadEspecifica() : null;
      if (act) {
        if (act.resumen) partes.push('Actividad comercial específica (extraída del estudio del año anterior; prevalece sobre el objeto social genérico): ' + act.resumen);
        if (act.perfil) partes.push('Perfil funcional (FAR): ' + act.perfil);
        if (act.keywords && act.keywords.length) partes.push('Palabras clave de búsqueda de comparables: ' + act.keywords.join(', '));
        if (act.sic && act.sic.length) partes.push('Códigos SIC objetivo: ' + act.sic.join(', '));
      }
      return partes.join('\n');
    }
```

- [ ] **Step 2: Enrich `ptPerfilNegocio()`**

Change (`index_CORREGIDO.html:6036-6046`):
```js
  function ptPerfilNegocio() {
    var partes = [];
    ['objeto', 'sicexp', 'ec_vision', 'ec_prod', 'ec_ingr'].forEach(function (id) {
      var el = $(id); if (el && el.value) partes.push(el.value);
    });
    if (window.PT_ANTERIOR && PT_ANTERIOR.descripcionNegocio) partes.push(PT_ANTERIOR.descripcionNegocio);
    var sics = [];
    var sx = ($('sicexp') && $('sicexp').value) || '';
    (sx.match(/\b\d{4}\b/g) || []).forEach(function (s) { sics.push(s); });
    return { texto: partes.join(' \n '), tokens: tokens(partes.join(' ')), sics: sics };
  }
```
to:
```js
  function ptPerfilNegocio() {
    var partes = [];
    ['objeto', 'sicexp', 'ec_vision', 'ec_prod', 'ec_ingr'].forEach(function (id) {
      var el = $(id); if (el && el.value) partes.push(el.value);
    });
    if (window.PT_ANTERIOR && PT_ANTERIOR.descripcionNegocio) partes.push(PT_ANTERIOR.descripcionNegocio);
    var act = (typeof getActividadEspecifica === 'function') ? getActividadEspecifica() : null;
    if (act) {
      if (act.resumen) partes.push(act.resumen);
      if (act.perfil) partes.push(act.perfil);
      if (act.productos && act.productos.length) partes.push(act.productos.join(' '));
    }
    var sics = [];
    var sx = ($('sicexp') && $('sicexp').value) || '';
    (sx.match(/\b\d{4}\b/g) || []).forEach(function (s) { sics.push(s); });
    if (act && act.sic && act.sic.length) act.sic.forEach(function (s) { if (/^\d{4}$/.test(s) && sics.indexOf(s) < 0) sics.push(s); });
    return { texto: partes.join(' \n '), tokens: tokens(partes.join(' ')), sics: sics };
  }
```

- [ ] **Step 3: Verify JS syntax is still valid**

Run the same command as Task 1 Step 3. Expected: `OK: N script blocks parsed`.

- [ ] **Step 4: Manual check — context includes the activity signature**

Serve the file locally (see Task 6 for the exact steps to get `/api/gemini`-style calls working through the real server; for this check a plain static server is enough since we're only calling a synchronous local function from DevTools). In the browser console, run:
```js
setActividadEspecifica({resumen:'Distribución mayorista de fungicidas agrícolas', perfil:'Distribuidor de riesgo limitado, sin I+D propia', keywords:['agrochemicals','pesticides'], sic:['2879'], justificacion:'prueba'});
console.log(buildClaudeContext());
console.log(ptPerfilNegocio());
```
Expected: `buildClaudeContext()`'s output includes the four new lines (Actividad comercial específica / Perfil funcional / Palabras clave / Códigos SIC), and `ptPerfilNegocio().sics` includes `'2879'` and `.texto` includes the resumen/perfil text.

- [ ] **Step 5: Commit**

```bash
git add index_CORREGIDO.html
git commit -m "Conectar la actividad específica extraída con buildClaudeContext() y ptPerfilNegocio()"
```

---

### Task 6: Verificación manual end-to-end en navegador

**Files:** none (verification only).

**Interfaces:** none.

- [ ] **Step 1: Confirm `GEMINI_API_KEY` is configured locally**

Check `.env` in the repo root has a `GEMINI_API_KEY=...` line (the same key `server.js` already uses for the RUT-extraction endpoint). If it's missing, the extraction call will fail gracefully (Task 4's `catch` branch shows the error message in `#actmsg`) — still useful to verify the error path, but to see the success path you need the key configured.

- [ ] **Step 2: Serve `index_CORREGIDO.html` through the real backend**

`server.js` only serves the `public/` folder, and `index_CORREGIDO.html` intentionally stays out of `public/` per the user's decision (Global Constraints). To exercise the real `/api/gemini` proxy without touching `public/index.html`, temporarily copy the file in:
```bash
cp "index_CORREGIDO.html" "public/_test_index_CORREGIDO.html"
npm start
```
Then browse to `http://localhost:3000/_test_index_CORREGIDO.html`.

- [ ] **Step 3: Walk through the feature**

1. In "Documentación comprobatoria del año anterior", load a prior-year study (upload a `.pdf`/`.docx`/`.json` export via the existing ingestion, or via the `.json` route through `cargarInformeAnterior`) so `window.PT_ANTERIOR.texto` gets populated.
2. Confirm the new "Actividad específica y perfil funcional…" card is visible right below it.
3. Click "🤖 Extraer actividad específica con Gemini (desde año anterior)".
4. Confirm `#actmsg` shows "⏳ Extrayendo…" then either "✓ Actividad específica extraída y aplicada…" or a clear `⚠` error.
5. On success, confirm the panel shows the resumen/perfil textareas filled in, keyword chips, and SIC chips.
6. Remove one chip and add a new one manually; confirm it persists after switching to another loaded study and back (via `histlist`), i.e. it round-trips through `saveToMemory()`/`loadFromMemory()`.
7. Confirm the hidden `#sicexp` field got populated with the merged SIC codes + keywords (inspect via DevTools: `document.getElementById('sicexp').value`).
8. Open DevTools console and run `buildClaudeContext()` — confirm it includes the activity/FAR/keywords/SIC lines.

- [ ] **Step 4: Clean up the temporary copy**

```bash
rm "public/_test_index_CORREGIDO.html"
```
Do not commit this file — it was only a local convenience to route `/api/gemini` through the real server for manual testing.

- [ ] **Step 5: Report results**

If every check in Step 3 passes, the feature is complete. If any step fails, return to the relevant task above, fix it, redo that task's syntax-check step, and re-run this walkthrough before considering the plan done.

---
