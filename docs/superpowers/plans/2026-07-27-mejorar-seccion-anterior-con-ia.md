# Mejorar con IA el texto de secciones del informe anterior — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change the module-8 "📋 Copiar del anterior" button (and its bulk counterpart) so that instead of copying the previous year's report text verbatim into the current report, it sends that text to Gemini as a drafting base together with the current study's data, and inserts the AI-updated result through the existing injection pipeline — so it ends up in the final report exactly like the literal copy does today.

**Architecture:** Everything lives in `index.html` and `public/index.html` (identical files, kept in sync commit-by-commit — every task edits both). No backend changes: the existing generic `/api/gemini` proxy is reused with the same request/response shape already used by `extractPriorActivityWithGemini`. The existing injection pipeline (`PT_SECCIONES_INYECTADAS` → `ptAplicarSeccionesInyectadas()` → `renderReport()`) is untouched — only what gets put into `PT_SECCIONES_INYECTADAS[secId]` changes, from a literal HTML copy to an AI-improved one.

**Tech Stack:** Vanilla JS (no build step, no framework), inline `<script>` in a single HTML file, existing `/api/gemini` Express/Cloud-Function proxy.

**Spec:** `docs/superpowers/specs/2026-07-27-mejorar-seccion-anterior-con-ia-design.md`

## Global Constraints

- Edit `index.html` and `public/index.html` identically in every task — they are byte-identical today (confirmed via `diff -q`) and must stay that way.
- Do NOT touch `server.js` or `functions/index.js` — the `/api/gemini` endpoint already exists and already works for this exact request shape.
- Do NOT change `ptAplicarSeccionesInyectadas`, `renderReport`, or anything downstream of `PT_SECCIONES_INYECTADAS` — that pipeline is what puts text into the final report and must keep working unchanged.
- This project has **no automated test suite** (no Jest/Mocha — `package.json` only has `build`/`start` scripts). "Testing" for every task below means: (1) a Node syntax-check command that parses every inline `<script>` block with `new Function(...)` to catch JS syntax errors immediately, and (2) targeted manual browser-console/UI checks described per task. Do not invent fake unit tests.
- Follow existing code conventions exactly: `$(id)` for `document.getElementById`, `escH()` to escape text before inserting as HTML, `moToast(msg, color)` for user-facing toasts (`'red'`/`'amber'`/`'green'`), and the existing `/api/gemini` call shape: `fetch('/api/gemini', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({contents:[{parts:[{text: prompt}]}]})})` with the response read as `data.candidates[0].content.parts.map(p => p.text).join('')`.
- All new user-facing text (toasts, button labels) is Spanish, matching the rest of the app's tone (formal, transfer-pricing domain language).
- If Gemini fails or returns something unusable, **do not fall back to the literal copy** — show a red toast and insert nothing (confirmed with the user during design).

---

### Task 1: Separar extracción de texto plano y envoltorio HTML

**Files:**
- Modify: `index.html` (function `ptExtraerTextoSeccionAnterior`, currently ~line 11024-11091, inside the "4-bis. REUTILIZACIÓN DE TEXTO DEL INFORME ANTERIOR POR SECCIÓN" block)
- Modify: `public/index.html` (identical block, same line range — apply the same edit)

**Interfaces:**
- Consumes: `window.PT_ANTERIOR`, `window.PT_ESTRUCTURA`, `ESQUELETO` (array already defined earlier in the same IIFE), `escH()` (global helper).
- Produces: `window.ptExtraerTextoPlanoSeccionAnterior(secId) -> string|null` (raw text, no HTML), `window.ptTextoPlanoAHtmlSeccion(texto) -> string|null` (wraps plain text into `<h3 class="rep">`/`<p class="norm">` HTML). `window.ptExtraerTextoSeccionAnterior(secId) -> string|null` keeps its existing signature/behavior, now implemented as a thin wrapper of the two above — Task 2 and Task 4 will consume `ptExtraerTextoPlanoSeccionAnterior` and `ptTextoPlanoAHtmlSeccion` directly.

- [ ] **Step 1: Replace the function in `index.html`**

Find this exact block (the whole `ptExtraerTextoSeccionAnterior` function plus its window export):

```js
      function ptExtraerTextoSeccionAnterior(secId) {
        var A = window.PT_ANTERIOR, E = window.PT_ESTRUCTURA;
        var item = ESQUELETO.find(function (e) { return e.id === secId; });
        if (!item) return null;

        var textoExtraido = '';

        if (A && A.texto) {
          if (E && E.secciones && A.paginas && A.paginas.length) {
            var secMatch = E.secciones.find(function (s) { return item.rx.test(s.titulo); });
            if (secMatch && secMatch.pagIni) {
              var ini = Math.max(0, secMatch.pagIni - 1);
              var fin = Math.min(A.paginas.length, secMatch.pagFin || (ini + 3));
              textoExtraido = A.paginas.slice(ini, fin).join('\n\n');
            }
          }

          if (!textoExtraido || textoExtraido.trim().length < 50) {
            var textFull = A.texto;
            var matchThis = item.rx.exec(textFull);
            if (matchThis) {
              var posIni = matchThis.index;
              var posFin = textFull.length;
              var idxThis = ESQUELETO.findIndex(function (e) { return e.id === secId; });
              for (var i = idxThis + 1; i < ESQUELETO.length; i++) {
                var rxNext = ESQUELETO[i].rx;
                var matchNext = rxNext.exec(textFull.slice(posIni + 60));
                if (matchNext) {
                  posFin = posIni + 60 + matchNext.index;
                  break;
                }
              }
              textoExtraido = textFull.slice(posIni, posFin);
            }
          }
        }

        if (!textoExtraido || textoExtraido.trim().length < 30) {
          if (secId === 'intro') {
            textoExtraido = 'INTRODUCCIÓN\n\nEl presente estudio de Precios de Transferencia se elabora en cumplimiento de las obligaciones establecidas en los artículos 260-1 y siguientes del Estatuto Tributario colombiano. El objetivo del informe es evaluar la razonabilidad de las operaciones celebradas con vinculados económicos del exterior durante el año gravable en curso, verificando la observancia del principio de plena competencia (Arm\'s Length).';
          } else if (secId === 'resumen') {
            textoExtraido = 'RESUMEN EJECUTIVO\n\nDe conformidad con la normatividad vigente, se examinaron las operaciones vinculadas ejecutadas durante el período gravable. A partir del análisis funcional, la selección de la parte examinada, el método de precios de transferencia aplicado y la depuración del conjunto de compañías comparables, los resultados obtenidos se ubican dentro del rango intercuartil de libre competencia.';
          } else if (secId === 'conclusiones') {
            textoExtraido = 'CONCLUSIONES\n\nCon base en el análisis técnico y económico desarrollado en este Informe Local, se concluye que las operaciones pactadas entre la compañía y sus vinculados económicos del exterior durante el año gravable se realizaron observando precios y márgenes comparables a los que habrían utilizado partes independientes en operaciones similares, cumpliendo con el principio de plena competencia y la legislación tributaria colombiana.';
          } else if (secId === 'economia') {
            textoExtraido = 'TENDENCIAS DE LA ECONOMÍA Y DEL SECTOR\n\nDurante el año gravable en curso, la economía global y el sector tecnológico registraron un comportamiento dinámico impulsado por la transformación digital y la demanda de software especializado. El mercado colombiano mantuvo condiciones estables de crecimiento en el sector de servicios informáticos y tecnología.';
          } else if (secId === 'operacion') {
            textoExtraido = 'ANÁLISIS ECONÓMICO DE LA OPERACIÓN\n\nSe analizó la operación de prestación de servicios entre partes vinculadas observando las condiciones contractuales, las funciones desempeñadas, los activos empleados y los riesgos asumidos por cada una de las partes en el desarrollo de la transacción.';
          } else if (secId === 'metodo') {
            textoExtraido = 'SELECCIÓN DEL MÉTODO, COMPARABLES Y DEPURACIÓN\n\nSe aplicó el Método de Margen Neto de la Transacción (MMNT) utilizando como indicador de rentabilidad el Margen Operativo sobre Costos y Gastos Total (MNC). Se realizó un proceso sistemático de depuración en bases financieras para seleccionar la muestra final de empresas comparables.';
          } else if (secId === 'rango') {
            textoExtraido = 'RESULTADOS: INDICADOR Y RANGO INTERCUARTIL\n\nA partir del análisis de las empresas comparables seleccionadas, se determinó el rango intercuartil de rentabilidad operativa. El indicador obtenido por la parte examinada se encuentra dentro del rango de libre competencia.';
          }
        }

        if (!textoExtraido || textoExtraido.trim().length < 20) return null;

        var lineas = textoExtraido.split(/\n+/).map(function (l) { return l.trim(); }).filter(Boolean);
        var html = lineas.map(function (linea) {
          if (/^[I|V|X|L]+\.\s+|^\d+\.\s+/i.test(linea) || (linea.length < 80 && /^[A-ZÁÉÍÓÚÑ\s\.\,\:\-\(\)]{5,}$/.test(linea))) {
            return '<h3 class="rep">' + escH(linea) + '</h3>';
          }
          return '<p class="norm">' + escH(linea) + '</p>';
        }).join('');

        return html;
      }
      window.ptExtraerTextoSeccionAnterior = ptExtraerTextoSeccionAnterior;
```

Replace it with:

```js
      function ptExtraerTextoPlanoSeccionAnterior(secId) {
        var A = window.PT_ANTERIOR, E = window.PT_ESTRUCTURA;
        var item = ESQUELETO.find(function (e) { return e.id === secId; });
        if (!item) return null;

        var textoExtraido = '';

        if (A && A.texto) {
          if (E && E.secciones && A.paginas && A.paginas.length) {
            var secMatch = E.secciones.find(function (s) { return item.rx.test(s.titulo); });
            if (secMatch && secMatch.pagIni) {
              var ini = Math.max(0, secMatch.pagIni - 1);
              var fin = Math.min(A.paginas.length, secMatch.pagFin || (ini + 3));
              textoExtraido = A.paginas.slice(ini, fin).join('\n\n');
            }
          }

          if (!textoExtraido || textoExtraido.trim().length < 50) {
            var textFull = A.texto;
            var matchThis = item.rx.exec(textFull);
            if (matchThis) {
              var posIni = matchThis.index;
              var posFin = textFull.length;
              var idxThis = ESQUELETO.findIndex(function (e) { return e.id === secId; });
              for (var i = idxThis + 1; i < ESQUELETO.length; i++) {
                var rxNext = ESQUELETO[i].rx;
                var matchNext = rxNext.exec(textFull.slice(posIni + 60));
                if (matchNext) {
                  posFin = posIni + 60 + matchNext.index;
                  break;
                }
              }
              textoExtraido = textFull.slice(posIni, posFin);
            }
          }
        }

        if (!textoExtraido || textoExtraido.trim().length < 30) {
          if (secId === 'intro') {
            textoExtraido = 'INTRODUCCIÓN\n\nEl presente estudio de Precios de Transferencia se elabora en cumplimiento de las obligaciones establecidas en los artículos 260-1 y siguientes del Estatuto Tributario colombiano. El objetivo del informe es evaluar la razonabilidad de las operaciones celebradas con vinculados económicos del exterior durante el año gravable en curso, verificando la observancia del principio de plena competencia (Arm\'s Length).';
          } else if (secId === 'resumen') {
            textoExtraido = 'RESUMEN EJECUTIVO\n\nDe conformidad con la normatividad vigente, se examinaron las operaciones vinculadas ejecutadas durante el período gravable. A partir del análisis funcional, la selección de la parte examinada, el método de precios de transferencia aplicado y la depuración del conjunto de compañías comparables, los resultados obtenidos se ubican dentro del rango intercuartil de libre competencia.';
          } else if (secId === 'conclusiones') {
            textoExtraido = 'CONCLUSIONES\n\nCon base en el análisis técnico y económico desarrollado en este Informe Local, se concluye que las operaciones pactadas entre la compañía y sus vinculados económicos del exterior durante el año gravable se realizaron observando precios y márgenes comparables a los que habrían utilizado partes independientes en operaciones similares, cumpliendo con el principio de plena competencia y la legislación tributaria colombiana.';
          } else if (secId === 'economia') {
            textoExtraido = 'TENDENCIAS DE LA ECONOMÍA Y DEL SECTOR\n\nDurante el año gravable en curso, la economía global y el sector tecnológico registraron un comportamiento dinámico impulsado por la transformación digital y la demanda de software especializado. El mercado colombiano mantuvo condiciones estables de crecimiento en el sector de servicios informáticos y tecnología.';
          } else if (secId === 'operacion') {
            textoExtraido = 'ANÁLISIS ECONÓMICO DE LA OPERACIÓN\n\nSe analizó la operación de prestación de servicios entre partes vinculadas observando las condiciones contractuales, las funciones desempeñadas, los activos empleados y los riesgos asumidos por cada una de las partes en el desarrollo de la transacción.';
          } else if (secId === 'metodo') {
            textoExtraido = 'SELECCIÓN DEL MÉTODO, COMPARABLES Y DEPURACIÓN\n\nSe aplicó el Método de Margen Neto de la Transacción (MMNT) utilizando como indicador de rentabilidad el Margen Operativo sobre Costos y Gastos Total (MNC). Se realizó un proceso sistemático de depuración en bases financieras para seleccionar la muestra final de empresas comparables.';
          } else if (secId === 'rango') {
            textoExtraido = 'RESULTADOS: INDICADOR Y RANGO INTERCUARTIL\n\nA partir del análisis de las empresas comparables seleccionadas, se determinó el rango intercuartil de rentabilidad operativa. El indicador obtenido por la parte examinada se encuentra dentro del rango de libre competencia.';
          }
        }

        if (!textoExtraido || textoExtraido.trim().length < 20) return null;
        return textoExtraido;
      }
      window.ptExtraerTextoPlanoSeccionAnterior = ptExtraerTextoPlanoSeccionAnterior;

      function ptTextoPlanoAHtmlSeccion(texto) {
        if (!texto || !String(texto).trim()) return null;
        var lineas = String(texto).split(/\n+/).map(function (l) { return l.trim(); }).filter(Boolean);
        if (!lineas.length) return null;
        var html = lineas.map(function (linea) {
          if (/^[I|V|X|L]+\.\s+|^\d+\.\s+/i.test(linea) || (linea.length < 80 && /^[A-ZÁÉÍÓÚÑ\s\.\,\:\-\(\)]{5,}$/.test(linea))) {
            return '<h3 class="rep">' + escH(linea) + '</h3>';
          }
          return '<p class="norm">' + escH(linea) + '</p>';
        }).join('');
        return html;
      }
      window.ptTextoPlanoAHtmlSeccion = ptTextoPlanoAHtmlSeccion;

      function ptExtraerTextoSeccionAnterior(secId) {
        var texto = ptExtraerTextoPlanoSeccionAnterior(secId);
        if (!texto) return null;
        return ptTextoPlanoAHtmlSeccion(texto);
      }
      window.ptExtraerTextoSeccionAnterior = ptExtraerTextoSeccionAnterior;
```

- [ ] **Step 2: Apply the identical replacement to `public/index.html`**

Same find/replace as Step 1, on `public/index.html` (byte-identical block).

- [ ] **Step 3: Run the syntax-check on both files**

Run:

```bash
node -e "const fs=require('fs');['index.html','public/index.html'].forEach(function(f){const html=fs.readFileSync(f,'utf8');const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);scripts.forEach((s,i)=>{try{new Function(s);}catch(e){console.error(f+' script block '+i+' error:',e.message);process.exit(1);}});console.log('OK '+f+': '+scripts.length+' script blocks parsed');});"
```

Expected: `OK index.html: 3 script blocks parsed` and `OK public/index.html: 3 script blocks parsed`, no errors.

- [ ] **Step 4: Manual check in the browser console**

Open the app, open devtools console, and run:

```js
window.ptExtraerTextoPlanoSeccionAnterior('intro')
```

Expected (with no `PT_ANTERIOR` loaded): the default Spanish "INTRODUCCIÓN..." template string is returned (not HTML — no `<h3>`/`<p>` tags).

```js
window.ptExtraerTextoSeccionAnterior('intro')
```

Expected: the same content wrapped in `<h3 class="rep">...</h3><p class="norm">...</p>` — identical to what this function returned before the refactor.

- [ ] **Step 5: Commit**

```bash
git add index.html public/index.html
git commit -m "$(cat <<'EOF'
Separar extracción de texto plano y envoltorio HTML del informe anterior

Prepara ptExtraerTextoSeccionAnterior para poder mandar el texto plano
de una sección a Gemini y reusar el mismo envoltorio HTML para el
resultado, sin cambiar su comportamiento actual.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Exponer `verificarCifras` y reescribir `ptUsarSeccionAnterior` para mejorar con Gemini

**Files:**
- Modify: `index.html` (function `verificarCifras`, ~line 10548, inside the "5. REDACCIÓN ASISTIDA POR IA" block; function `window.ptUsarSeccionAnterior`, in the "4-bis" block after Task 1's edit)
- Modify: `public/index.html` (identical edits)

**Interfaces:**
- Consumes: `window.ptExtraerTextoPlanoSeccionAnterior(secId)`, `window.ptTextoPlanoAHtmlSeccion(texto)` (from Task 1), `ptContextoCompleto()` (global, already exists), `extraerJSONDeRespuestaIA(texto)` (global, already exists), `moToast(msg, color)` (global, already exists), `window.PT_SECCIONES_INYECTADAS`, `ptAplicarSeccionesInyectadas()`, `ptCompararExtension()`, `ptPintarEstructura()` (all pre-existing, unchanged).
- Produces: `window.ptVerificarCifras(texto, contexto) -> string[]` (same logic as the existing local `verificarCifras`, now callable from other IIFEs). `window.ptUsarSeccionAnterior(secId, btnEl?) -> Promise<boolean>` — **signature change**: was synchronous returning `boolean`, is now `async` returning a `Promise<boolean>`; takes an optional second parameter `btnEl` (the button DOM element that triggered it, used to show a loading state). Task 3 and Task 4 depend on this new async signature.

- [ ] **Step 1: Expose `verificarCifras` on `window` in `index.html`**

Find:

```js
      /* Control: ninguna cifra del texto puede ser ajena al contexto */
      function verificarCifras(texto, contexto) {
        var nums = String(texto).match(/\b\d[\d.,]{2,}\b/g) || [];
        var ctx = String(contexto).replace(/[.,\s]/g, '');
        var ajenas = [];
        nums.forEach(function (n) {
          var limpio = n.replace(/[.,]/g, '');
          if (limpio.length < 3) return;
          if (ctx.indexOf(limpio) < 0 && ajenas.indexOf(n) < 0) ajenas.push(n);
        });
        return ajenas;
      }
```

Replace with:

```js
      /* Control: ninguna cifra del texto puede ser ajena al contexto */
      function verificarCifras(texto, contexto) {
        var nums = String(texto).match(/\b\d[\d.,]{2,}\b/g) || [];
        var ctx = String(contexto).replace(/[.,\s]/g, '');
        var ajenas = [];
        nums.forEach(function (n) {
          var limpio = n.replace(/[.,]/g, '');
          if (limpio.length < 3) return;
          if (ctx.indexOf(limpio) < 0 && ajenas.indexOf(n) < 0) ajenas.push(n);
        });
        return ajenas;
      }
      window.ptVerificarCifras = verificarCifras;
```

- [ ] **Step 2: Apply the identical change to `public/index.html`**

- [ ] **Step 3: Replace `window.ptUsarSeccionAnterior` in `index.html`**

Find (this is the function as it stands after Task 1 — Task 1 did not touch this function, only the ones above it):

```js
      window.ptUsarSeccionAnterior = function (secId) {
        var item = ESQUELETO.find(function (e) { return e.id === secId; });
        var nom = item ? item.nom : secId;

        var html = ptExtraerTextoSeccionAnterior(secId);
        if (!html) {
          moToast('No se pudo extraer el texto de «' + nom + '» del informe anterior.', 'red');
          return false;
        }

        window.PT_SECCIONES_INYECTADAS = window.PT_SECCIONES_INYECTADAS || {};
        window.PT_SECCIONES_INYECTADAS[secId] = html;

        try { ptAplicarSeccionesInyectadas(); } catch (e) { }
        try { ptCompararExtension(); } catch (e) { }
        try { ptPintarEstructura(); } catch (e) { }
        moToast('Sección «' + nom + '» completada con el texto del informe anterior.', 'green');
        return true;
      };
```

Replace with:

```js
      window.ptUsarSeccionAnterior = async function (secId, btnEl) {
        var item = ESQUELETO.find(function (e) { return e.id === secId; });
        var nom = item ? item.nom : secId;

        var btnTextoOriginal = btnEl ? btnEl.textContent : null;
        if (btnEl) { btnEl.disabled = true; btnEl.textContent = '⏳ Mejorando…'; }
        var restaurarBoton = function () {
          if (btnEl) { btnEl.disabled = false; btnEl.textContent = btnTextoOriginal; }
        };

        var textoBase = ptExtraerTextoPlanoSeccionAnterior(secId);
        if (!textoBase) {
          restaurarBoton();
          moToast('No se pudo extraer el texto de «' + nom + '» del informe anterior.', 'red');
          return false;
        }

        try {
          var contextoActual = ptContextoCompleto().slice(0, 20000);
          var prompt =
            'Eres especialista en precios de transferencia en Colombia. Tu tarea es ACTUALIZAR y MEJORAR\n' +
            'el texto de la sección «' + nom + '» del informe de precios de transferencia, tomando como BASE el\n' +
            'texto de esa misma sección en el informe del año gravable anterior, y adaptándolo al informe\n' +
            'del año gravable actual con los datos del estudio en curso.\n\n' +
            'REGLAS INQUEBRANTABLES:\n' +
            '1. Parte del texto anterior como base de redacción, estilo y estructura, pero AJUSTA cifras,\n' +
            '   años, nombres y hechos a los datos del CONTEXTO ACTUAL cuando ese contexto traiga el dato\n' +
            '   correspondiente.\n' +
            '2. No inventes cifras, hechos ni nombres que no consten ni en el texto anterior ni en el\n' +
            '   contexto actual. Si falta un dato para completar la actualización, escribe exactamente:\n' +
            '   "[dato pendiente de confirmar con el contribuyente]" en su lugar.\n' +
            '3. Conserva una extensión y nivel de detalle equivalentes a los del texto anterior (aprox.\n' +
            '   ' + textoBase.trim().length + ' caracteres) y el mismo tono técnico de un informe tributario.\n' +
            '4. Redacta en español, en tercera persona, en prosa, sin viñetas.\n\n' +
            'TEXTO DE LA SECCIÓN «' + nom + '» EN EL INFORME DEL AÑO ANTERIOR (base a mejorar):\n' +
            '---\n' + textoBase + '\n---\n\n' +
            'CONTEXTO DEL ESTUDIO DEL AÑO GRAVABLE ACTUAL:\n' +
            '---\n' + contextoActual + '\n---\n\n' +
            'Devuelve ÚNICAMENTE un JSON válido, sin marcas markdown, sin texto antes ni después:\n' +
            '{"texto":"..."}';

          var res = await fetch('/api/gemini', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
          });
          var data = await res.json();
          var cand = data && data.candidates && data.candidates[0];
          var raw = cand && cand.content && cand.content.parts ? cand.content.parts.map(function (p) { return p.text || ''; }).join('') : '';
          if (!res.ok || !raw) throw new Error((data && data.error && (data.error.message || JSON.stringify(data.error))) || 'Respuesta vacía de Gemini');

          var j = extraerJSONDeRespuestaIA(raw);
          var textoMejorado = j && j.texto ? String(j.texto).trim() : '';
          if (textoMejorado.length < 20) throw new Error('Gemini no devolvió un texto mejorado válido para «' + nom + '».');

          if (typeof window.ptVerificarCifras === 'function') {
            var ajenas = window.ptVerificarCifras(textoMejorado, textoBase + '\n' + contextoActual);
            if (ajenas.length) {
              moToast('El texto mejorado de «' + nom + '» contiene cifras que no constan en el texto anterior ni en el estudio actual: ' + ajenas.join(', '), 'amber');
            }
          }

          var html = ptTextoPlanoAHtmlSeccion(textoMejorado);
          if (!html) throw new Error('No se pudo dar formato al texto mejorado de «' + nom + '».');

          window.PT_SECCIONES_INYECTADAS = window.PT_SECCIONES_INYECTADAS || {};
          window.PT_SECCIONES_INYECTADAS[secId] = html;

          try { ptAplicarSeccionesInyectadas(); } catch (e) { }
          try { ptCompararExtension(); } catch (e) { }
          try { ptPintarEstructura(); } catch (e) { }
          moToast('Sección «' + nom + '» mejorada con IA a partir del informe anterior.', 'green');
          return true;
        } catch (e) {
          restaurarBoton();
          moToast('No se pudo mejorar «' + nom + '» con IA: ' + e.message, 'red');
          return false;
        }
      };
```

- [ ] **Step 4: Apply the identical change to `public/index.html`**

- [ ] **Step 5: Run the syntax-check on both files**

Run the same command as Task 1 Step 3. Expected: `OK index.html: 3 script blocks parsed` / `OK public/index.html: 3 script blocks parsed`, no errors.

- [ ] **Step 6: Manual check in the browser (happy path)**

1. Load a previous-year report (`PT_ANTERIOR`) in the app so at least one section has real prior text (or rely on the default templates if none loaded).
2. Open devtools → Network tab.
3. In the console, run: `window.ptUsarSeccionAnterior('intro').then(function(r){ console.log('resultado:', r); })`.
4. Confirm a `POST /api/gemini` request fires in the Network tab.
5. Confirm the promise resolves to `true` (assuming Gemini is reachable and configured) and a green toast reading "Sección «Introducción» mejorada con IA a partir del informe anterior." appears.
6. Confirm `window.PT_SECCIONES_INYECTADAS.intro` now holds HTML whose text differs from the raw previous text (i.e., it went through the model, not a literal copy).

- [ ] **Step 7: Manual check in the browser (error path)**

Temporarily break the endpoint (e.g., run `window.fetch = function(){ return Promise.reject(new Error('offline test')); }` in the console as a throwaway override for this check, then reload the page afterward to restore the real `fetch`), then run `window.ptUsarSeccionAnterior('intro')`. Confirm: the promise resolves to `false`, a red toast with "No se pudo mejorar «Introducción» con IA: offline test" appears, and `window.PT_SECCIONES_INYECTADAS.intro` is unchanged (nothing inserted).

- [ ] **Step 8: Commit**

```bash
git add index.html public/index.html
git commit -m "$(cat <<'EOF'
Mejorar con Gemini el texto de una sección en vez de copiarlo literal

ptUsarSeccionAnterior ahora usa el texto de la sección del informe
anterior como base que Gemini actualiza con los datos del estudio
actual, en vez de insertarlo tal cual. Se conserva la misma tubería de
inyección hacia el informe final. Si Gemini falla no se inserta nada.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Actualizar el botón individual en el panel

**Files:**
- Modify: `index.html` (function `ptPintarEstructura`, in the "5. PANEL" block)
- Modify: `public/index.html` (identical edit)

**Interfaces:**
- Consumes: `window.ptUsarSeccionAnterior(secId, btnEl)` (from Task 2 — now expects the button element as second argument to show a loading state).
- Produces: nothing new consumed elsewhere; this only changes the generated button markup.

- [ ] **Step 1: Update the button markup in `index.html`**

Find:

```js
              if (f.actual === 0 || f.estado === 'ausente' || f.estado === 'muy_corta' || f.estado === 'corta') {
                btnAccion = '<button type="button" onclick="ptUsarSeccionAnterior(\'' + f.id + '\')" style="padding:3px 8px;background:#1E8449;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:10.5px;font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,0.15)">📋 Copiar del anterior</button>';
              }
```

Replace with:

```js
              if (f.actual === 0 || f.estado === 'ausente' || f.estado === 'muy_corta' || f.estado === 'corta') {
                btnAccion = '<button type="button" onclick="ptUsarSeccionAnterior(\'' + f.id + '\', this)" style="padding:3px 8px;background:#1E8449;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:10.5px;font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,0.15)">🤖 Mejorar con IA (base: anterior)</button>';
              }
```

- [ ] **Step 2: Apply the identical change to `public/index.html`**

- [ ] **Step 3: Run the syntax-check on both files**

Same command as Task 1 Step 3. Expected: no errors, 3 script blocks each file.

- [ ] **Step 4: Manual check in the browser**

1. Get the module-8 panel into a state where at least one row shows the action button (an "ausente"/"corta"/"muy_corta" section).
2. Confirm the button now reads "🤖 Mejorar con IA (base: anterior)".
3. Click it and confirm it immediately shows "⏳ Mejorando…" and becomes disabled while the request is in flight.
4. Confirm that once it resolves, the whole panel re-renders (via `ptPintarEstructura()`) and the button either disappears (section now conforming) or returns to its normal enabled state with the original label (if it failed and stayed non-conforming).

- [ ] **Step 5: Commit**

```bash
git add index.html public/index.html
git commit -m "$(cat <<'EOF'
Actualizar el botón individual a «Mejorar con IA (base: anterior)»

Refleja que el botón ya no copia literal: pasa el elemento del botón
para mostrar el estado de carga mientras Gemini procesa la sección.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Botón masivo secuencial con progreso

**Files:**
- Modify: `index.html` (function `window.ptCompletarTodasAusentesAnterior`, in the "4-bis" block; and the bulk button markup inside `ptPintarEstructura`, in the "5. PANEL" block)
- Modify: `public/index.html` (identical edits)

**Interfaces:**
- Consumes: `window.ptUsarSeccionAnterior(secId)` (from Task 2, called without `btnEl` since the bulk flow has no single button per row — awaited, since it now returns a `Promise<boolean>`).
- Produces: `window.ptCompletarTodasAusentesAnterior() -> Promise<number>` — **signature change**: was synchronous, no return value used by callers; is now `async`, resolves to the count of sections successfully improved. No other code currently calls this function directly (only the `onclick` in the bulk button), so the signature change is safe.

- [ ] **Step 1: Replace `window.ptCompletarTodasAusentesAnterior` in `index.html`**

Find:

```js
      window.ptCompletarTodasAusentesAnterior = function () {
        var X = window.PT_EXTENSION;
        if (!X || !X.filas) {
          try { X = ptCompararExtension(); } catch (e) { }
        }
        if (!X || !X.filas) {
          moToast('Levante primero la estructura del informe anterior.', 'amber');
          return false;
        }

        var ausentes = X.filas.filter(function (f) { return f.actual === 0 || f.estado === 'ausente'; });
        if (!ausentes.length) {
          moToast('No hay secciones ausentes (en 0%) para completar.', 'amber');
          return false;
        }

        var cont = 0;
        ausentes.forEach(function (f) {
          if (window.ptUsarSeccionAnterior(f.id)) cont++;
        });

        if (cont > 0) {
          moToast('Se completaron ' + cont + ' sección(es) ausente(s) usando el informe anterior.', 'green');
        }
      };
```

Replace with:

```js
      window.ptCompletarTodasAusentesAnterior = async function () {
        var X = window.PT_EXTENSION;
        if (!X || !X.filas) {
          try { X = ptCompararExtension(); } catch (e) { }
        }
        if (!X || !X.filas) {
          moToast('Levante primero la estructura del informe anterior.', 'amber');
          return false;
        }

        var ausentes = X.filas.filter(function (f) { return f.actual === 0 || f.estado === 'ausente'; });
        if (!ausentes.length) {
          moToast('No hay secciones ausentes (en 0%) para completar.', 'amber');
          return false;
        }

        var ok = 0, fallidas = [];
        for (var i = 0; i < ausentes.length; i++) {
          var f = ausentes[i];
          moToast('Mejorando «' + f.nom + '» con IA… (' + (i + 1) + '/' + ausentes.length + ')', 'amber');
          var r = await window.ptUsarSeccionAnterior(f.id);
          if (r) ok++; else fallidas.push(f.nom);
        }

        if (ok > 0) {
          moToast('Se mejoraron con IA ' + ok + ' de ' + ausentes.length + ' sección(es)' +
            (fallidas.length ? '; fallaron: ' + fallidas.join(', ') : '') + '.', fallidas.length ? 'amber' : 'green');
        } else {
          moToast('No se pudo mejorar ninguna sección con IA.', 'red');
        }
        return ok;
      };
```

- [ ] **Step 2: Update the bulk button label in `index.html`**

Find:

```js
            (X.filas.some(function (f) { return f.actual === 0 || f.estado === 'ausente'; })
              ? '<button type="button" onclick="ptCompletarTodasAusentesAnterior()" style="padding:6px 12px;background:#7D3C98;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700;box-shadow:0 2px 6px rgba(125,60,152,0.3)">⚡ Usar texto anterior en todas las ausentes (0%)</button>'
              : '') +
```

Replace with:

```js
            (X.filas.some(function (f) { return f.actual === 0 || f.estado === 'ausente'; })
              ? '<button type="button" onclick="ptCompletarTodasAusentesAnterior()" style="padding:6px 12px;background:#7D3C98;color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:11px;font-weight:700;box-shadow:0 2px 6px rgba(125,60,152,0.3)">⚡ Mejorar con IA todas las ausentes (0%)</button>'
              : '') +
```

- [ ] **Step 3: Apply both identical changes to `public/index.html`**

- [ ] **Step 4: Run the syntax-check on both files**

Same command as Task 1 Step 3. Expected: no errors, 3 script blocks each file.

- [ ] **Step 5: Manual check in the browser**

1. Get the panel into a state with at least 2 sections marked "ausente" (0%).
2. Confirm the button reads "⚡ Mejorar con IA todas las ausentes (0%)".
3. Click it and confirm a sequence of amber toasts appears, one per section ("Mejorando «X» con IA… (1/2)", then "(2/2)"), in order, not all at once.
4. Confirm a final summary toast appears ("Se mejoraron con IA N de M sección(es)...").
5. Confirm the table re-renders after each individual section completes (via the existing `ptPintarEstructura()` call inside `ptUsarSeccionAnterior`), so progress is visible row by row, not just at the end.

- [ ] **Step 6: Commit**

```bash
git add index.html public/index.html
git commit -m "$(cat <<'EOF'
Hacer secuencial el botón masivo y usar Gemini por sección

ptCompletarTodasAusentesAnterior ahora espera cada mejora con IA una
por una (no en paralelo) y reporta el progreso sección por sección,
en vez de copiar todas literal de una sola vez.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Verificación final end-to-end

**Files:**
- None (verification only).

**Interfaces:**
- Consumes: everything produced by Tasks 1-4.
- Produces: nothing (final gate before considering the feature done).

- [ ] **Step 1: Full syntax-check**

Run the same command as Task 1 Step 3 one more time against both files, confirming zero errors after all four tasks' edits have landed.

- [ ] **Step 2: End-to-end manual walkthrough in the browser**

1. Load a real previous-year report into `PT_ANTERIOR`.
2. Click "Levantar estructura del año anterior", then "Comparar con el informe actual".
3. For a section marked "ausente" or "por debajo", click "🤖 Mejorar con IA (base: anterior)" and confirm: loading state shows, a `POST /api/gemini` fires, a green success toast appears, and the section's text now appears inside the rendered report (`#doc`) — open the report preview and confirm the text is there and reads as an adapted/updated version of the prior text (different figures/year references where the current study's data differs), not a verbatim copy.
4. Export the report to Word (existing feature) and confirm the AI-improved section text is present in the exported document — this proves the "se indexe o se coloque en el informe final" requirement end-to-end, since the export reads from the same `#doc` that step 3 already writes to.
5. Repeat with the bulk button "⚡ Mejorar con IA todas las ausentes (0%)" over at least two ausente sections and confirm sequential progress toasts plus the final summary.
6. Force one failure (temporarily override `fetch` to reject, as in Task 2 Step 7) mid-way through a bulk run and confirm that section is skipped (listed in "fallaron: ...") while the rest still complete.

- [ ] **Step 3: Confirm no regressions in the existing structure/extension panel**

With no AI involved, confirm "Levantar estructura del año anterior" and "Comparar con el informe actual" still work exactly as before (they were not touched by any task) — the table, percentages, and status colors render the same as before this feature existed.

If every check in Steps 1-3 passes, the feature is complete. If any step fails, return to the relevant task above, fix it, redo that task's syntax-check step, and re-run this walkthrough before considering the plan done.
