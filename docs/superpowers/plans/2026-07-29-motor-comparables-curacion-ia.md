# Motor de comparables con curación de candidatas por IA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unificar el perfil de actividad de la empresa y el motor de selección de comparables en la tarjeta "Comparables", con detección automática de la actividad (Gemini) y curación automática de candidatas del Excel de Capital IQ por su Business Description real, antes de que el motor aplique sus filtros cuantitativos de siempre.

**Architecture:** Todo vive en `index.html` (aplicación de una sola página, sin build de JS — `npm run build` solo copia `index.html` → `public/index.html`). Se agregan dos llamadas automáticas a Gemini vía el proxy `/api/gemini` ya existente: (1) detección de actividad al cargar el informe del año anterior, (2) curación por lotes de candidatas al importar el Excel de Capital IQ. El resultado de (2) se integra como un filtro más dentro de `moScore`/`moActMatch`, con degradación automática a la heurística de texto existente cuando la IA no está disponible para una fila.

**Tech Stack:** HTML/JS vainilla en un único archivo, fetch a `/api/gemini` (proxy Express ya existente en `server.js`, sin cambios), sin framework de pruebas (no hay test runner en este proyecto).

## Global Constraints

- Editar únicamente el `index.html` de la raíz del repo. Nunca editar `public/index.html` directamente (lo pisa `npm run build`, que corre `scripts/sync-index.js`).
- Al terminar todas las tareas de código, correr `npm run build` para sincronizar `public/index.html`.
- No modificar `server.js` ni el contrato del endpoint `/api/gemini` (se reutiliza tal cual: `POST { contents: [{ parts: [{ text }] }] }` → responde el JSON crudo de Gemini con `candidates[0].content.parts[].text`).
- Todo el texto de interfaz y de comentarios de negocio va en español, seguiendo el estilo ya existente en el archivo.
- No hay test runner en este proyecto (no hay Jest/Mocha, no hay carpeta `tests/`). La verificación de cada tarea es: (a) comandos `grep`/`node -e` deterministas contra `index.html` para confirmar que el texto exacto quedó como se espera, y (b) al final del plan, una pasada manual en el navegador con `npm start`. No introducir un framework de pruebas nuevo.
- Mantener el mismo estilo de manejo de errores del archivo: nunca dejar una promesa sin `catch`, nunca bloquear la interfaz por un fallo de IA (siempre degradar con un mensaje, nunca un error sin capturar).

---

### Task 1: Detección automática de actividad — un solo campo, sin botón

**Files:**
- Modify: `index.html` — función `cargarInformeAnterior` (líneas ~2092-2130)
- Modify: `index.html` — bloque `getActividadEspecifica`/`setActividadEspecifica`/`renderActividadEspecifica`/`renderActChips` (líneas ~2132-2159)
- Modify: `index.html` — bloque `actividadAgregarChip`/`actividadQuitarChip`/`actividadEditada`/`sicexpDesdeActividad` (líneas ~2218-2247)
- Modify: `index.html` — función `extractPriorActivityWithGemini` (líneas ~2249-2310)

**Interfaces:**
- Consumes: `$(id)` (helper de `document.getElementById` ya existente), `escH()`, `moToast()`, `saveActive()`, `calcD()`, `extraerJSONDeRespuestaIA()` — todos ya definidos en el archivo.
- Produces (usado por Task 2 y Task 3):
  - `getActividadEspecifica()` → `{ resumen, perfil, productos: [], keywords: [resumen], sic: [], justificacion, fuente, fecha, estado }` o `null`. `estado` es `'procesando' | 'listo' | 'error'`.
  - `setActividadEspecifica(obj)` — guarda y re-renderiza.
  - `renderActividadEspecifica()` — pinta el estado en los elementos `#act_status_icon`, `#act_status_text`, `#act_btn_edit`, `#act_btn_retry` (creados en Task 2; en esta tarea la función ya los referencia aunque el HTML todavía no exista — no falla, `$(id)` devuelve `null` y la función retorna temprano).
  - `actEditarToggle()` — abre/cierra `#act_edit_box` con `#act_edit_input` prellenado.
  - `actGuardarEdicion()` — guarda la frase editada a mano y relanza `curarCandidatosConIA` si ya hay un Excel importado (`window.PT_ULTIMO_IMPORT_COMPS`, definido en Task 3 — en esta tarea el `typeof curarCandidatosConIA === 'function'` protege la llamada mientras esa función no exista todavía).
  - `sicexpDesdeActividad()` — sigue llenando `$('sicexp')` con `obj.resumen` (antes llenaba con `sic + keywords`).
  - `extractPriorActivityWithGemini()` — ya no depende de ningún botón; se autoinvoca desde `cargarInformeAnterior()` y sigue siendo invocable manualmente por el botón "↻ Reintentar análisis" (Task 2).

- [ ] **Step 1: Reemplazar `cargarInformeAnterior` para que dispare la extracción sola**

Con la herramienta Edit, en `index.html` reemplaza:

```javascript
    async function cargarInformeAnterior(file) {
      if (!file) return;
      histMsg('Procesando informe del año anterior («' + file.name + '»)…');
      const nm = (file.name || '').toLowerCase();
      try {
        if (nm.endsWith('.json')) {
          const txt = await file.text();
          const data = JSON.parse(txt);
          const s = Array.isArray(data) ? data[0] : data;
          if (s) {
            window.PT_ANTERIOR = { texto: JSON.stringify(s), comparables: s.comps || [], fuente: file.name };
            histMsg('✓ Informe JSON del año anterior cargado («' + file.name + '»).');
            if (typeof extractPriorActivityWithGemini === 'function' && $('btnExtraerActividad')) {
              if ($('actmsg')) $('actmsg').textContent = 'Estudio anterior cargado («' + file.name + '»). Clic en 🤖 Extraer actividad específica con Gemini.';
            }
          }
        } else if (nm.endsWith('.pdf')) {
          if (typeof readPDF === 'function') {
            readPDF(file, function (txt) {
              window.PT_ANTERIOR = { texto: txt, fuente: file.name };
              histMsg('✓ Informe PDF del año anterior cargado («' + file.name + '», ' + txt.length.toLocaleString('es-CO') + ' caracteres).');
              if ($('actmsg')) $('actmsg').textContent = 'Estudio anterior cargado («' + file.name + '»). Clic en 🤖 Extraer actividad específica con Gemini.';
            });
          } else {
            const txt = await file.text();
            window.PT_ANTERIOR = { texto: txt, fuente: file.name };
            histMsg('✓ Informe del año anterior cargado («' + file.name + '»).');
            if ($('actmsg')) $('actmsg').textContent = 'Estudio anterior cargado («' + file.name + '»). Clic en 🤖 Extraer actividad específica con Gemini.';
          }
        } else {
          const txt = await file.text();
          window.PT_ANTERIOR = { texto: txt, fuente: file.name };
          histMsg('✓ Informe del año anterior cargado («' + file.name + '», ' + txt.length.toLocaleString('es-CO') + ' caracteres).');
          if ($('actmsg')) $('actmsg').textContent = 'Estudio anterior cargado («' + file.name + '»). Clic en 🤖 Extraer actividad específica con Gemini.';
        }
      } catch (e) {
        histMsg('⚠ Error al leer el informe del año anterior: ' + e.message);
      }
    }
```

con:

```javascript
    async function cargarInformeAnterior(file) {
      if (!file) return;
      histMsg('Procesando informe del año anterior («' + file.name + '»)…');
      const nm = (file.name || '').toLowerCase();
      try {
        if (nm.endsWith('.json')) {
          const txt = await file.text();
          const data = JSON.parse(txt);
          const s = Array.isArray(data) ? data[0] : data;
          if (s) {
            window.PT_ANTERIOR = { texto: JSON.stringify(s), comparables: s.comps || [], fuente: file.name };
            histMsg('✓ Informe JSON del año anterior cargado («' + file.name + '»). Detectando la actividad de la empresa…');
            if (typeof extractPriorActivityWithGemini === 'function') extractPriorActivityWithGemini();
          }
        } else if (nm.endsWith('.pdf')) {
          if (typeof readPDF === 'function') {
            readPDF(file, function (txt) {
              window.PT_ANTERIOR = { texto: txt, fuente: file.name };
              histMsg('✓ Informe PDF del año anterior cargado («' + file.name + '», ' + txt.length.toLocaleString('es-CO') + ' caracteres). Detectando la actividad de la empresa…');
              if (typeof extractPriorActivityWithGemini === 'function') extractPriorActivityWithGemini();
            });
          } else {
            const txt = await file.text();
            window.PT_ANTERIOR = { texto: txt, fuente: file.name };
            histMsg('✓ Informe del año anterior cargado («' + file.name + '»). Detectando la actividad de la empresa…');
            if (typeof extractPriorActivityWithGemini === 'function') extractPriorActivityWithGemini();
          }
        } else {
          const txt = await file.text();
          window.PT_ANTERIOR = { texto: txt, fuente: file.name };
          histMsg('✓ Informe del año anterior cargado («' + file.name + '», ' + txt.length.toLocaleString('es-CO') + ' caracteres). Detectando la actividad de la empresa…');
          if (typeof extractPriorActivityWithGemini === 'function') extractPriorActivityWithGemini();
        }
      } catch (e) {
        histMsg('⚠ Error al leer el informe del año anterior: ' + e.message);
      }
    }
```

- [ ] **Step 2: Verificar el reemplazo del Step 1**

Run: `grep -n "Detectando la actividad de la empresa" "index.html"`
Expected: 4 líneas (una por cada rama de `cargarInformeAnterior`).

Run: `grep -n "btnExtraerActividad\|Clic en 🤖 Extraer actividad" "index.html"`
Expected: sin coincidencias dentro de `cargarInformeAnterior` (todavía habrá 3-4 coincidencias del panel HTML viejo y de `extractPriorActivityWithGemini`, que se limpian en los pasos siguientes de esta misma tarea y en la Task 2 — por ahora solo confirma que ya no quedan dentro de las cuatro ramas que acabas de editar).

- [ ] **Step 3: Reemplazar `getActividadEspecifica`/`setActividadEspecifica`/`renderActividadEspecifica`/`renderActChips`**

Reemplaza:

```javascript
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
```

con:

```javascript
    /* ================= ACTIVIDAD ESPECÍFICA (extracción automática, Gemini) =================
       Se guarda en el estudio activo (actividad_json), NO en MOTOR: MOTOR se reinicia por
       completo en cada motorEjecutar() y perdería el dato. Modelo simplificado a una sola
       frase precisa (resumen === keywords[0]); perfil/productos/sic se conservan solo para
       alimentar el informe (buildClaudeContext, Anexo B/D) y ya no se piden a Gemini ni se
       muestran en pantalla. */
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
      const icon = $('act_status_icon'), txt = $('act_status_text'), btnEdit = $('act_btn_edit'), btnRetry = $('act_btn_retry');
      if (!icon || !txt) return;
      if (!obj || !obj.estado) {
        icon.textContent = '🔴'; txt.style.color = '#7a241c';
        txt.textContent = 'Suba el informe del año anterior (tarjeta de arriba) para que el sistema detecte automáticamente la actividad de la empresa.';
        if (btnEdit) btnEdit.style.display = 'none';
        if (btnRetry) btnRetry.style.display = 'none';
        return;
      }
      if (obj.estado === 'procesando') {
        icon.textContent = '⏳'; txt.style.color = '#6b5010';
        txt.textContent = 'Detectando la actividad de la empresa…';
        if (btnEdit) btnEdit.style.display = 'none';
        if (btnRetry) btnRetry.style.display = 'none';
      } else if (obj.estado === 'error') {
        icon.textContent = '⚠️'; txt.style.color = '#7a241c';
        txt.textContent = 'No se pudo detectar la actividad automáticamente' + (obj.errorMsg ? (': ' + obj.errorMsg) : '') + '.';
        if (btnEdit) btnEdit.style.display = 'none';
        if (btnRetry) btnRetry.style.display = 'inline-flex';
      } else {
        icon.textContent = '✅'; txt.style.color = '#14532d';
        txt.innerHTML = '<b>Actividad detectada:</b> «' + escH(obj.resumen || '') + '»';
        if (btnEdit) btnEdit.style.display = 'inline-flex';
        if (btnRetry) btnRetry.style.display = 'none';
      }
    }
    function actEditarToggle() {
      const obj = getActividadEspecifica() || { resumen: '', perfil: '', productos: [], keywords: [], sic: [], justificacion: '', estado: 'listo' };
      const box = $('act_edit_box'), input = $('act_edit_input');
      if (!box || !input) return;
      const abriendo = box.style.display === 'none';
      box.style.display = abriendo ? 'block' : 'none';
      if (abriendo) { input.value = obj.resumen || ''; input.focus(); }
    }
    function actGuardarEdicion() {
      const input = $('act_edit_input'); if (!input) return;
      const frase = input.value.trim();
      if (!frase) { moToast('La actividad no puede quedar vacía', 'amber'); return; }
      const obj = getActividadEspecifica() || { perfil: '', productos: [], sic: [], justificacion: '' };
      obj.resumen = frase; obj.keywords = [frase]; obj.estado = 'listo';
      setActividadEspecifica(obj);
      sicexpDesdeActividad();
      $('act_edit_box').style.display = 'none';
      moToast('Actividad actualizada', 'green');
      if (window.PT_ULTIMO_IMPORT_COMPS && window.PT_ULTIMO_IMPORT_COMPS.length && typeof curarCandidatosConIA === 'function') {
        curarCandidatosConIA(window.PT_ULTIMO_IMPORT_COMPS);
      }
    }
```

- [ ] **Step 4: Reemplazar `actividadAgregarChip`/`actividadQuitarChip`/`actividadEditada`/`sicexpDesdeActividad`**

Reemplaza:

```javascript
    function actividadAgregarChip(campo, valor) {
      valor = (valor || '').trim(); if (!valor) return;
      if (campo === 'keywords') {
        valor = ptTraducirKeyword(valor);
      }
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
```

con:

```javascript
    function sicexpDesdeActividad() {
      const obj = getActividadEspecifica(); if (!obj || !$('sicexp')) return;
      if (obj.resumen) { $('sicexp').value = obj.resumen; calcD(); }
    }
```

- [ ] **Step 5: Reemplazar `extractPriorActivityWithGemini` por la versión de un solo campo**

Reemplaza:

```javascript
    async function extractPriorActivityWithGemini() {
      /* helpers para cambiar el estado visual del botón/mensaje de actividad */
      function _actEstado(estado, texto) {
        const btn = $('btnExtraerActividad'), msg = $('actmsg'), icon = $('actmsg_icon');
        const badge = $('badge_actividad'), hint = $('act_steps_hint');
        const estados = {
          pendiente: { bg: '#C0473B', label: '🤖 Analizar empresa con IA', icono: '🔴', color: '#7a241c', badge: '🔴 Pendiente', badgeClass: 'pending' },
          procesando: { bg: '#B67A0E', label: '⏳ Analizando…', icono: '⏳', color: '#6b5010', badge: '⏳ Procesando', badgeClass: 'partial' },
          listo: { bg: '#2E8B6B', label: '✅ Volver a analizar', icono: '✅', color: '#14532d', badge: '✅ Listo', badgeClass: 'ok' },
          error: { bg: '#C0473B', label: '⚠ Reintentar análisis', icono: '⚠️', color: '#7a241c', badge: '⚠ Error', badgeClass: 'pending' }
        };
        const e = estados[estado] || estados.pendiente;
        if (btn) { btn.style.background = e.bg; btn.textContent = e.label; btn.disabled = (estado === 'procesando'); }
        if (icon) icon.textContent = e.icono;
        if (msg) { msg.textContent = texto || ''; msg.style.color = e.color; msg.style.fontWeight = (estado === 'listo') ? '500' : '600'; }
        if (badge) { badge.textContent = e.badge; badge.className = 'card-status-badge ' + e.badgeClass; }
        if (hint) hint.style.display = (estado === 'listo') ? 'none' : '';
      }

      const msg = $('actmsg'), btn = $('btnExtraerActividad');
      if (!window.PT_ANTERIOR || !PT_ANTERIOR.texto) {
        _actEstado('pendiente', '⚠ No hay estudio del año anterior cargado. Cárguelo primero en la tarjeta de arriba y luego pulse «Analizar empresa con IA».');
        return;
      }
      _actEstado('procesando', 'Analizando el estudio con Gemini, esto puede tardar unos segundos…');
      const texto = PT_ANTERIOR.texto.slice(0, 28000);
      const prompt =
        'Eres un experto en precios de transferencia y búsqueda de comparables en bases de datos como Capital IQ, Orbis y SuperSociedades.\n\n' +
        'Tu única tarea: leer el texto del estudio de precios de transferencia del año anterior que aparece al final, e identificar CON MÁXIMO DETALLE OPERATIVO cuál es la actividad económica REAL Y ESPECIALIZADA que ejerce la Compañía examinada.\n\n' +
        'REGLAS CRÍTICAS — léelas antes de responder:\n' +
        '1. NO uses el objeto social del Certificado de Cámara de Comercio (ese es genérico y jurídico). Busca en el texto del estudio cuál fue la operación real analizada, qué productos o servicios específicos vende o presta, a qué clientes, en qué segmento de mercado, bajo qué modelo de negocio (compra-reventa, agencia, manufactura, servicios, etc.).\n' +
        '2. "actividad_especifica_corta": máximo 2 oraciones. Debe decir exactamente QUÉ hace la empresa, con QUÉ productos/servicios, para QUIÉN, y bajo QUÉ modelo (ej: "Distribución mayorista de fungicidas e insecticidas técnicos para el sector cafetero y arrocero en Colombia, importados del vinculado en Estados Unidos, bajo modelo de compra-reventa con riesgo de inventario completo"). NUNCA escribas algo tan genérico como "distribución de productos" o "prestación de servicios".\n' +
        '3. "perfil_funcional_far": describe con precisión qué FUNCIONES ejerce (compra, almacenamiento, distribución, manufactura, servicio posventa…), qué ACTIVOS controla (bodegas, equipos, licencias, marca…) y qué RIESGOS asume (inventario, crédito, tipo de cambio, obsolescencia…).\n' +
        '4. "productos_servicios_clave": lista los productos o servicios concretos mencionados en el estudio (ej: ["fungicidas sistémicos", "herbicidas de contacto", "insecticidas piretroides"]). Si son servicios, el tipo exacto de servicio.\n' +
        '5. "keyword": término en INGLÉS para buscar en Capital IQ / Orbis. Deben ser específico, no genéricos. Ej: ["agrochemical distributor", "crop protection wholesale", "pesticide distribution Latin America"]. Incluye el sector y la función.\n' +
        '6. "codigos_sic_sugeridos": al menos 2 códigos SIC de 4 dígitos que correspondan exactamente al negocio. Si es distribución de agroquímicos: 5169. Si es manufactura de plásticos: 3089. Busca el más específico.\n' +
        '7. "justificacion_perfil": explica en 2-3 oraciones por qué estos keywords y SIC son los correctos para encontrar empresas comparables independientes con el mismo perfil de riesgos y funciones.\n\n' +
        'Responde ÚNICAMENTE con un objeto JSON válido, sin marcas markdown, sin texto antes ni después:\n' +
        '{"actividad_especifica_corta":"","perfil_funcional_far":"","productos_servicios_clave":[],"keywords_busqueda_comparables":[],"codigos_sic_sugeridos":[],"justificacion_perfil":""}\n\n' +
        '--- TEXTO DEL ESTUDIO DEL AÑO ANTERIOR ---\n' + texto;
      try {
        const res = await fetch('/api/gemini', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        const data = await res.json();
        const cand = data && data.candidates && data.candidates[0];
        const raw = cand && cand.content && cand.content.parts ? cand.content.parts.map(p => p.text || '').join('') : '';
        if (!res.ok || !raw) throw new Error((data && data.error && (data.error.message || JSON.stringify(data.error))) || 'Respuesta vacía de Gemini');
        const j = extraerJSONDeRespuestaIA(raw);
        setActividadEspecifica({
          resumen: j.actividad_especifica_corta || '', perfil: j.perfil_funcional_far || '',
          productos: j.productos_servicios_clave || [], keywords: j.keywords_busqueda_comparables || [],
          sic: j.codigos_sic_sugeridos || [], justificacion: j.justificacion_perfil || '',
          fuente: PT_ANTERIOR.fuente || 'estudio del año anterior', fecha: new Date().toISOString()
        });
        sicexpDesdeActividad();
        _actEstado('listo', '✓ Actividad detectada y aplicada. Revise los campos y ajuste si es necesario antes de buscar comparables.');
      } catch (e) {
        _actEstado('error', '⚠ No se pudo analizar con Gemini: ' + e.message + '. Puede completar los campos manualmente.');
      }
    }
```

con:

```javascript
    async function extractPriorActivityWithGemini() {
      if (!window.PT_ANTERIOR || !PT_ANTERIOR.texto) {
        setActividadEspecifica({ estado: 'error', errorMsg: 'no hay estudio del año anterior cargado', resumen: '', perfil: '', productos: [], keywords: [], sic: [], justificacion: '' });
        return;
      }
      setActividadEspecifica({ estado: 'procesando', resumen: '', perfil: '', productos: [], keywords: [], sic: [], justificacion: '' });
      const texto = PT_ANTERIOR.texto.slice(0, 28000);
      const prompt =
        'Eres un experto en precios de transferencia y búsqueda de comparables en bases de datos como Capital IQ, Orbis y SuperSociedades.\n\n' +
        'Tu única tarea: leer el texto del estudio de precios de transferencia del año anterior que aparece al final, e identificar CON MÁXIMO DETALLE OPERATIVO cuál es la actividad económica REAL Y ESPECIALIZADA que ejerce la Compañía examinada.\n\n' +
        'REGLAS CRÍTICAS — léelas antes de responder:\n' +
        '1. NO uses el objeto social del Certificado de Cámara de Comercio (ese es genérico y jurídico). Busca en el texto del estudio cuál fue la operación real analizada, qué productos o servicios específicos vende o presta, a qué clientes, en qué segmento de mercado, bajo qué modelo de negocio (compra-reventa, agencia, manufactura, servicios, etc.).\n' +
        '2. "actividad_especifica_corta": máximo 2 oraciones, en español. Debe decir exactamente QUÉ hace la empresa, con QUÉ productos/servicios, para QUIÉN, y bajo QUÉ modelo (ej: "Distribución mayorista de fungicidas e insecticidas técnicos para el sector cafetero y arrocero en Colombia, importados del vinculado en Estados Unidos, bajo modelo de compra-reventa con riesgo de inventario completo"). NUNCA escribas algo tan genérico como "distribución de productos" o "prestación de servicios". Esta frase se usará TAL CUAL para comparar contra la Business Description (en inglés) de empresas candidatas en Capital IQ, así que debe ser suficientemente descriptiva para que un analista experto entienda de inmediato si otra empresa hace lo mismo.\n' +
        '3. "perfil_funcional_far": describe con precisión qué FUNCIONES ejerce (compra, almacenamiento, distribución, manufactura, servicio posventa…), qué ACTIVOS controla (bodegas, equipos, licencias, marca…) y qué RIESGOS asume (inventario, crédito, tipo de cambio, obsolescencia…).\n' +
        '4. "justificacion_perfil": explica en 2-3 oraciones por qué esa descripción de actividad es la correcta para encontrar empresas comparables independientes con el mismo perfil de riesgos y funciones.\n\n' +
        'Responde ÚNICAMENTE con un objeto JSON válido, sin marcas markdown, sin texto antes ni después:\n' +
        '{"actividad_especifica_corta":"","perfil_funcional_far":"","justificacion_perfil":""}\n\n' +
        '--- TEXTO DEL ESTUDIO DEL AÑO ANTERIOR ---\n' + texto;
      try {
        const res = await fetch('/api/gemini', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
        });
        const data = await res.json();
        const cand = data && data.candidates && data.candidates[0];
        const raw = cand && cand.content && cand.content.parts ? cand.content.parts.map(p => p.text || '').join('') : '';
        if (!res.ok || !raw) throw new Error((data && data.error && (data.error.message || JSON.stringify(data.error))) || 'Respuesta vacía de Gemini');
        const j = extraerJSONDeRespuestaIA(raw);
        const frase = j.actividad_especifica_corta || '';
        if (!frase) throw new Error('Gemini no devolvió una actividad específica');
        setActividadEspecifica({
          resumen: frase, perfil: j.perfil_funcional_far || '',
          productos: [], keywords: [frase], sic: [], justificacion: j.justificacion_perfil || '',
          fuente: PT_ANTERIOR.fuente || 'estudio del año anterior', fecha: new Date().toISOString(), estado: 'listo'
        });
        sicexpDesdeActividad();
        if (window.PT_ULTIMO_IMPORT_COMPS && window.PT_ULTIMO_IMPORT_COMPS.length && typeof curarCandidatosConIA === 'function') {
          curarCandidatosConIA(window.PT_ULTIMO_IMPORT_COMPS);
        }
      } catch (e) {
        setActividadEspecifica({ estado: 'error', errorMsg: e.message, resumen: '', perfil: '', productos: [], keywords: [], sic: [], justificacion: '' });
      }
    }
```

- [ ] **Step 6: Verificar los reemplazos de los Steps 3-5**

Run: `grep -n "function actividadAgregarChip\|function actividadQuitarChip\|function actividadEditada\|function renderActChips" "index.html"`
Expected: sin coincidencias (las cuatro funciones ya no existen).

Run: `grep -n "function getActividadEspecifica\|function setActividadEspecifica\|function renderActividadEspecifica\|function actEditarToggle\|function actGuardarEdicion\|function sicexpDesdeActividad\|async function extractPriorActivityWithGemini" "index.html"`
Expected: 7 líneas, una por cada función (todas presentes exactamente una vez).

Run: `grep -n "actmsg\|btnExtraerActividad\|badge_actividad\b" "index.html"`
Expected: solo las coincidencias que quedan dentro del bloque HTML todavía sin tocar (Task 2 lo elimina) — en este punto NINGUNA coincidencia debe estar dentro del `<script>` (busca que las únicas líneas reportadas tengan `<` al inicio del contenido, es decir, sean HTML, no JS).

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
Simplificar el perfil de actividad a una sola frase, con extracción automática

extractPriorActivityWithGemini ya no depende de un botón: se autoinvoca
al cargar el informe del año anterior. El modelo de datos colapsa a una
única frase precisa (resumen === keywords[0]); perfil/productos/sic se
conservan solo para el informe y ya no se piden a Gemini ni se muestran
en pantalla.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Reubicar la UI en la tarjeta Comparables

**Files:**
- Modify: `index.html` — sub-panel "Perfil de actividad" dentro de la tarjeta "Documentación comprobatoria..." (líneas ~1202-1289)
- Modify: `index.html` — encabezado de la tarjeta "Comparables" (líneas ~1541-1554)

**Interfaces:**
- Consumes: `renderActividadEspecifica()`, `actEditarToggle()`, `actGuardarEdicion()`, `extractPriorActivityWithGemini()` (Task 1).
- Produces: elementos DOM `#act_status_box`, `#actividad_json` (reubicado), `#act_status_icon`, `#act_status_text`, `#act_btn_edit`, `#act_btn_retry`, `#act_edit_box`, `#act_edit_input`, y `#mo_ia_status` — todos consumidos por Task 1 (ya escrito) y Task 3 (siguiente).

- [ ] **Step 1: Eliminar el panel viejo de la tarjeta "Documentación comprobatoria..."**

Con la herramienta Edit, en `index.html` reemplaza (nota: el bloque incluye el `<input type="hidden" id="actividad_json">`, que se reubica en el Step 2 de esta misma tarea — por eso este Step elimina TODO el bloque, incluido ese input):

```html
          <!-- Sub-panel embebido: Perfil de Actividad de la Empresa -->
          <div style="border:1px solid #E2E8F0;border-radius:12px;background:#FAFAFE;padding:16px;margin-top:10px">
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap">
              <h4 style="margin:0;font-size:14px;font-weight:700;color:#1E293B;display:flex;align-items:center;gap:6px">
                🧠 Perfil de actividad de la empresa <span
                  style="font-size:11.5px;font-weight:normal;color:#64748B">(paso clave antes de buscar
                  comparables)</span>
              </h4>
              <span class="card-status-badge pending" id="badge_actividad">🔴 Pendiente</span>
              <span class="eyebrow" style="margin-left:auto">IA · firma de actividad</span>
            </div>

            <div class="tip" style="border-left-color:#6B5BD1;background:#F5F3FF;margin-bottom:12px">
              <b>¿Para qué sirve esto?</b> El sistema necesita saber exactamente en qué trabaja su empresa
              (no el objeto social genérico, sino la actividad real: qué vende, a quién, cómo) para buscar
              empresas comparables que hagan lo mismo. Gemini lee el estudio del año anterior y extrae esa
              información automáticamente. <b>Sin este paso, las comparables pueden ser irrelevantes.</b>
            </div>

            <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:12px">
              <button id="btnExtraerActividad" onclick="extractPriorActivityWithGemini()" style="padding:10px 18px;border-radius:9px;font-size:13px;font-weight:700;
                   background:#C0473B;color:#fff;border:none;cursor:pointer;
                   display:inline-flex;align-items:center;gap:7px;transition:background .2s">
                🤖 Analizar empresa con IA
              </button>
              <div id="actmsg_wrap" style="display:flex;align-items:center;gap:8px">
                <span id="actmsg_icon" style="font-size:18px">🔴</span>
                <span id="actmsg" style="font-size:12.5px;color:#7a241c;font-weight:600">
                  Pendiente — cargue primero el estudio del año anterior (arriba) y luego pulse «Analizar empresa con
                  IA»
                </span>
              </div>
            </div>

            <div
              style="background:#FFF5F5;border:1px solid #FECACA;border-radius:9px;padding:10px 14px;font-size:12px;color:#7f1d1d;margin-bottom:12px"
              id="act_steps_hint">
              <b>Pasos:</b>
              <span style="margin:0 6px">①</span> Cargue el informe del año anterior (arriba)
              <span style="margin:0 6px">→</span>
              <span style="margin:0 6px">②</span> Pulse <b>«Analizar empresa con IA»</b>
              <span style="margin:0 6px">→</span>
              <span style="margin:0 6px">③</span> Revise y ajuste los campos generados
              <span style="margin:0 6px">→</span>
              <span style="margin:0 6px">④</span> Use las palabras clave para buscar comparables
            </div>

            <input type="hidden" id="actividad_json" value="">
            <div id="activity_spec_card" style="display:none;margin-top:12px">
              <div
                style="background:#F0FDF4;border:1px solid #86EFAC;border-radius:9px;padding:10px 14px;font-size:12px;color:#14532d;margin-bottom:12px">
                ✅ <b>Actividad extraída correctamente.</b> Puede editar los campos si Gemini no fue preciso. Los
                cambios se guardan automáticamente y se usan en la búsqueda de comparables.
              </div>
              <div class="row2">
                <label class="f"><span class="l">¿Qué hace la empresa? (actividad específica real)</span>
                  <textarea class="i" id="act_resumen" rows="3" oninput="actividadEditada()"
                    placeholder="Ej: Distribución mayorista de fungicidas e insecticidas importados del vinculado en EE.UU., bajo modelo de compra-reventa con riesgo de inventario completo, para el sector agrícola colombiano."></textarea>
                </label>
                <label class="f"><span class="l">Perfil funcional (funciones / activos / riesgos asumidos)</span>
                  <textarea class="i" id="act_perfil" rows="3" oninput="actividadEditada()"
                    placeholder="Ej: Funciones: compra, almacenamiento, distribución. Activos: bodega, flota. Riesgos: inventario, crédito, tipo de cambio."></textarea>
                </label>
              </div>
              <div class="row2">
                <label class="f"><span class="l">Palabras clave para buscar comparables en Capital IQ / Orbis (puedes
                    escribir en español — se traducen automáticamente)</span>
                  <div style="font-size:11px;color:#64748B;margin:2px 0 6px">✨ <b>Traducción automática activada:</b>
                    Escribe palabras en español (ej: <i>"desarrollo de videojuegos"</i> o <i>"distribuidor
                      mayorista"</i>) y al presionar Enter el sistema las traducirá inmediatamente al inglés para
                    Capital IQ / Orbis.
                  </div>
                  <div class="actchips" id="act_keywords_chips"></div>
                  <input class="i" id="act_keyword_new"
                    placeholder="ej: desarrollo de videojuegos, distribuidor agroquímico…"
                    onkeydown="if(event.key==='Enter'){event.preventDefault();actividadAgregarChip('keywords', this.value); this.value='';}">
                </label>
                <label class="f"><span class="l">Códigos SIC sugeridos (pulse Enter para agregar)</span>
                  <div class="actchips" id="act_sic_chips"></div>
                  <input class="i" id="act_sic_new" placeholder="ej: 5169…"
                    onkeydown="if(event.key==='Enter'){event.preventDefault();actividadAgregarChip('sic', this.value); this.value='';}">
                </label>
              </div>
              <div class="hint" id="act_justificacion"
                style="background:#F8FAFC;border:1px solid var(--hair);border-radius:8px;padding:8px 12px;margin-top:4px">
              </div>
            </div>
          </div>
        
```

con: (una cadena vacía — el bloque completo desaparece; deja intactas las líneas en blanco que había antes/después)

- [ ] **Step 2: Insertar el nuevo bloque de estado en la tarjeta "Comparables"**

Reemplaza (dentro de la tarjeta cuyo `<h3>` es "Comparables"):

```html
        <div class="bd">
          <div class="tip">Las comparables son las empresas contra las que se mide el rango de mercado. Defina primero
            los filtros del motor, importe el Excel de Capital IQ y luego ejecute la selección para que el sistema
            traiga directamente las mejores candidatas del universo importado.</div>

          <!-- ══════ MOTOR DE SELECCIÓN (paso 1: filtros, antes de importar) ══════ -->
          <div
            style="border:1.5px solid var(--hair);border-radius:10px;padding:14px;margin:0 0 14px;background:var(--white)">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
              <b style="font-size:13px">⚙ Motor de selección automática (TOP-N)</b>
              <span id="mo_pesos_label" style="font-size:11px;color:var(--muted)">Puntúa: actividad 40 · tamaño 20 ·
                geografía 15 ·
                rentabilidad 15 · datos 10</span>
            </div>
```

con:

```html
        <div class="bd">
          <div class="tip">Las comparables son las empresas contra las que se mide el rango de mercado. El sistema detecta
            la actividad de la empresa automáticamente al cargar el informe del año anterior; defina los filtros del
            motor, importe el Excel de Capital IQ y luego ejecute la selección para que la IA cure primero qué
            candidatas coinciden con esa actividad y el motor traiga directamente las mejores del universo curado.</div>

          <!-- ══════ ACTIVIDAD DE LA EMPRESA (automática, Gemini) ══════ -->
          <div id="act_status_box" style="border:1px solid #E2E8F0;border-radius:10px;background:#FAFAFE;padding:12px 14px;margin:0 0 14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <input type="hidden" id="actividad_json" value="">
            <span id="act_status_icon" style="font-size:16px">🔴</span>
            <span id="act_status_text" style="font-size:12.5px;font-weight:600;color:#7a241c;flex:1;min-width:220px">Suba el informe del año anterior (tarjeta de arriba) para que el sistema detecte automáticamente la actividad de la empresa.</span>
            <button type="button" id="act_btn_edit" onclick="actEditarToggle()" style="display:none;padding:5px 9px;border-radius:7px;border:1px solid #CBD5E1;background:#fff;cursor:pointer;font-size:13px" title="Editar la actividad detectada">✏️</button>
            <button type="button" id="act_btn_retry" onclick="extractPriorActivityWithGemini()" style="display:none;padding:6px 12px;border-radius:7px;border:none;background:#C0473B;color:#fff;font-weight:700;font-size:12px;cursor:pointer">↻ Reintentar análisis</button>
            <div id="act_edit_box" style="display:none;width:100%;margin-top:6px">
              <input class="i" id="act_edit_input" style="width:100%" type="text">
              <div style="margin-top:6px;display:flex;gap:8px">
                <button type="button" class="btn solid" onclick="actGuardarEdicion()">Guardar</button>
                <button type="button" class="btn ghost" onclick="actEditarToggle()">Cancelar</button>
              </div>
            </div>
          </div>

          <!-- ══════ MOTOR DE SELECCIÓN (paso 1: filtros, antes de importar) ══════ -->
          <div
            style="border:1.5px solid var(--hair);border-radius:10px;padding:14px;margin:0 0 14px;background:var(--white)">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
              <b style="font-size:13px">⚙ Motor de selección automática (TOP-N)</b>
              <span id="mo_pesos_label" style="font-size:11px;color:var(--muted)">Puntúa: actividad 40 · tamaño 20 ·
                geografía 15 ·
                rentabilidad 15 · datos 10</span>
            </div>
            <div id="mo_ia_status" style="font-size:11.5px;color:var(--muted);margin-top:6px"></div>
```

- [ ] **Step 3: Verificar la reubicación**

Run: `grep -c "id=\"actividad_json\"" "index.html"`
Expected: `1` (una sola vez en todo el archivo, ahora dentro de la tarjeta Comparables).

Run: `grep -n "act_status_box\|act_status_icon\|act_status_text\|act_btn_edit\|act_btn_retry\|act_edit_box\|act_edit_input\|mo_ia_status" "index.html"`
Expected: cada ID aparece exactamente 2 veces (una en el HTML nuevo de esta tarea, otra en el JS de Task 1/3 que lo referencia) — ninguno debe faltar.

Run: `grep -n "activity_spec_card\|act_resumen\|act_perfil\|act_keywords_chips\|act_sic_chips\|badge_actividad" "index.html"`
Expected: sin coincidencias (el panel viejo desapareció por completo).

- [ ] **Step 4: Verificación manual mínima (requiere `npm start`)**

Run: `npm start` (deja corriendo el servidor), abre `http://localhost:3000` en el navegador.

Verifica en el navegador:
1. La tarjeta "Documentación comprobatoria del año anterior" ya NO muestra el panel "🧠 Perfil de actividad".
2. La tarjeta "Comparables" muestra, arriba del Motor, la línea "🔴 Suba el informe del año anterior…".
3. Sube cualquier archivo `.txt` con un párrafo de texto en el input "📎 Cargar informe del año anterior" — el estado debe pasar a "⏳ Detectando la actividad de la empresa…" y luego (si `GEMINI_API_KEY` está configurada en `.env`) a "✅ Actividad detectada: «…»" con el ✏️ visible.
4. Pulsa ✏️ — debe abrirse un cuadro de texto con la frase, con botones "Guardar"/"Cancelar".

Detén el servidor con `Ctrl+C` cuando termines de verificar.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
Mover el perfil de actividad a la tarjeta Comparables, junto al Motor

El panel de actividad ya no vive separado en Documentación: ahora es
una línea de estado de solo lectura dentro de Comparables, con un ✏️
para editar y un botón de reintentar si Gemini falla — sin chips de
keywords ni campo de SIC.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: Curación de candidatas por IA al importar el Excel de Capital IQ

**Files:**
- Modify: `index.html` — función `importCompsFile` (líneas ~2071-2090)
- Modify: `index.html` — justo antes de `function motorEjecutar(silencioso) {` (líneas ~3859)
- Modify: `index.html` — primeras líneas del cuerpo de `motorEjecutar`

**Interfaces:**
- Consumes: `getActividadEspecifica()` (Task 1), `$()`, `extraerJSONDeRespuestaIA()`, `moToast()`, `saveActive()`.
- Produces (usado por Task 4 y Task 5):
  - `window.AI_MATCH_COMPS = { porId: { [id]: {coincide: boolean, motivo: string} }, fecha, actividadUsada, fuenteExcel }` o `undefined` si nunca corrió.
  - `window.PT_CURANDO_IA` (boolean) — `true` mientras la curación está en curso.
  - `window.PT_ULTIMO_IMPORT_COMPS` (array) — última lista importada, para poder re-curar tras una edición manual de la actividad.
  - `curarCandidatosConIA(list)` — función async, sin valor de retorno útil (efectos vía los globals de arriba).

- [ ] **Step 1: Disparar la curación al terminar de importar el Excel**

Reemplaza:

```javascript
    function importCompsFile(file) {
      if (!file) return; const nm = (file.name || '').toLowerCase();
      const done = (list) => {
        let n = 0;
        list.forEach(x => {
          if (!x.name && !x.nit) return;
          const amb = (x.country && x.country.includes('colombia')) ? 'Nac' : 'Int';
          if (x.desc) DESCS[x.name] = x.desc;
          $('cbody').appendChild(compRow([x.name, amb, x.s, x.c, x.op, x.ar, x.inv, x.ap, x.sic || '', x.id || '']));
          n++;
        });
        calc();
        if ($('compalert')) $('compalert').innerHTML = '<div class="alert-green">✓ ' + n + ' comparable(s) importada(s) del Excel (mapeo automático; descripciones al Anexo B).</div>';
      };
      if (nm.endsWith('.xlsx') || nm.endsWith('.xls')) {
        readExcelRows(file).then(rows => done(smartMapRows(rows))).catch(e => { if ($('compalert')) $('compalert').innerHTML = '<div class="alert-amber">No se pudo leer el Excel (' + e.message + ').</div>'; });
      } else {
        readFileText(file, t => done(smartMapRows(t.split(/\r?\n/).map(l => l.split(/\t|;|,/)))));
      }
    }
```

con:

```javascript
    function importCompsFile(file) {
      if (!file) return; const nm = (file.name || '').toLowerCase();
      const done = (list) => {
        let n = 0;
        list.forEach(x => {
          if (!x.name && !x.nit) return;
          const amb = (x.country && x.country.includes('colombia')) ? 'Nac' : 'Int';
          if (x.desc) DESCS[x.name] = x.desc;
          $('cbody').appendChild(compRow([x.name, amb, x.s, x.c, x.op, x.ar, x.inv, x.ap, x.sic || '', x.id || '']));
          n++;
        });
        calc();
        if ($('compalert')) $('compalert').innerHTML = '<div class="alert-green">✓ ' + n + ' comparable(s) importada(s) del Excel (mapeo automático; descripciones al Anexo B).</div>';
        window.PT_ULTIMO_IMPORT_COMPS = list;
        if (typeof curarCandidatosConIA === 'function') curarCandidatosConIA(list);
      };
      if (nm.endsWith('.xlsx') || nm.endsWith('.xls')) {
        readExcelRows(file).then(rows => done(smartMapRows(rows))).catch(e => { if ($('compalert')) $('compalert').innerHTML = '<div class="alert-amber">No se pudo leer el Excel (' + e.message + ').</div>'; });
      } else {
        readFileText(file, t => done(smartMapRows(t.split(/\r?\n/).map(l => l.split(/\t|;|,/)))));
      }
    }
```

- [ ] **Step 2: Agregar `curarCandidatosConIA` y sus helpers, antes de `motorEjecutar`**

Reemplaza:

```javascript
    function motorEjecutar(silencioso) {
```

con:

```javascript
    /* ================= CURACIÓN DE CANDIDATAS POR IA (Business Description real de Capital IQ) =================
       Al importar el Excel de Capital IQ, se compara la actividad detectada (getActividadEspecifica().resumen)
       contra el Business Description real de cada candidata (DESCS/o.desc), en lotes, vía /api/gemini.
       Resultado en window.AI_MATCH_COMPS = { porId: { [id]: {coincide, motivo} }, fecha, actividadUsada, fuenteExcel }.
       Se integra en moScore/moActMatch (más abajo). Si Gemini falla o no hay actividad, el motor sigue
       funcionando con la heurística de texto existente — nunca bloquea el flujo. */
    window.PT_CURANDO_IA = false;
    function _ptChunk(arr, size) {
      const out = [];
      for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
      return out;
    }
    async function _ptPool(items, worker, limite) {
      const resultados = new Array(items.length);
      let idx = 0;
      async function siguiente() {
        while (idx < items.length) {
          const mio = idx++;
          resultados[mio] = await worker(items[mio], mio);
        }
      }
      const corredores = Array.from({ length: Math.min(limite, items.length) }, siguiente);
      await Promise.all(corredores);
      return resultados;
    }
    function _moIaInfo(texto) { const el = $('mo_ia_status'); if (el) el.textContent = texto || ''; }
    async function curarCandidatosConIA(list) {
      window.PT_ULTIMO_IMPORT_COMPS = list;
      const act = (typeof getActividadEspecifica === 'function') ? getActividadEspecifica() : null;
      if (!act || act.estado !== 'listo' || !act.resumen) { _moIaInfo(''); return; }
      const evaluables = (list || []).filter(o => o && o.id && String(o.id).trim() && o.desc && String(o.desc).trim());
      if (!evaluables.length) { _moIaInfo('ℹ Ninguna candidata importada trae ID IQ + Business Description para curar con IA; el motor usará el emparejamiento por palabras clave.'); return; }
      window.PT_CURANDO_IA = true;
      window.AI_MATCH_COMPS = { porId: {}, fecha: new Date().toISOString(), actividadUsada: act.resumen, fuenteExcel: (window.CIQ_FUENTE && CIQ_FUENTE.archivo) || '' };
      const lotes = _ptChunk(evaluables, 60);
      let evaluadas = 0, fallidas = 0;
      _moIaInfo('🤖 IA curando candidatas… (0 de ' + evaluables.length + ' evaluadas)');
      await _ptPool(lotes, async (lote) => {
        const candidatos = lote.map(o => ({ id: String(o.id).trim(), name: o.name || '', desc: String(o.desc || '').slice(0, 300), country: o.country || o.pais || '' }));
        const prompt =
          'Eres un experto en precios de transferencia que revisa comparables de Capital IQ.\n\n' +
          'La empresa examinada tiene esta actividad económica real:\n"' + act.resumen + '"\n\n' +
          'A continuación hay una lista de empresas candidatas con su Business Description real de Capital IQ (en inglés). ' +
          'Para cada una, decide si su actividad real coincide con la de la empresa examinada (mismo tipo de negocio, mismos productos/servicios o función equivalente), ' +
          'sin importar el idioma en que esté escrita la descripción. No la aceptes solo por pertenecer al mismo sector amplio: debe ser la misma actividad específica.\n\n' +
          'Candidatas:\n' + JSON.stringify(candidatos) + '\n\n' +
          'Responde ÚNICAMENTE con un objeto JSON válido, sin marcas markdown, con esta forma exacta:\n' +
          '{"resultados":[{"id":"","coincide":true,"motivo":""}]}\n' +
          'Incluye una entrada por cada ID recibido, en el mismo orden.';
        try {
          const res = await fetch('/api/gemini', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
          });
          const data = await res.json();
          const cand = data && data.candidates && data.candidates[0];
          const raw = cand && cand.content && cand.content.parts ? cand.content.parts.map(p => p.text || '').join('') : '';
          if (!res.ok || !raw) throw new Error((data && data.error && (data.error.message || JSON.stringify(data.error))) || 'Respuesta vacía de Gemini');
          const j = extraerJSONDeRespuestaIA(raw);
          (j.resultados || []).forEach(r => {
            if (!r || !r.id) return;
            window.AI_MATCH_COMPS.porId[String(r.id).trim()] = { coincide: !!r.coincide, motivo: r.motivo || '' };
          });
          evaluadas += lote.length;
        } catch (e) {
          fallidas += lote.length;
          console.error('[curarCandidatosConIA] lote falló:', e);
        }
        _moIaInfo('🤖 IA curando candidatas… (' + (evaluadas + fallidas) + ' de ' + evaluables.length + ' procesadas)');
      }, 3);
      window.PT_CURANDO_IA = false;
      const nMatch = Object.values(AI_MATCH_COMPS.porId).filter(v => v.coincide).length;
      _moIaInfo(fallidas
        ? ('✓ ' + nMatch + ' de ' + evaluables.length + ' candidatas coinciden con la actividad · ⚠ ' + fallidas + ' no se pudieron evaluar (se dejan pasar sin descartarlas por actividad)')
        : ('✓ ' + nMatch + ' de ' + evaluables.length + ' candidatas coinciden con la actividad'));
      saveActive();
    }
    function motorEjecutar(silencioso) {
```

- [ ] **Step 3: Bloquear "Ejecutar selección" mientras la curación está en curso**

Reemplaza:

```javascript
    function motorEjecutar(silencioso) {
      const cfg = moCfg(); const rows = moRows();
      if (rows.length > 150 && !silencioso) moToast('Puntuando ' + rows.length + ' candidatas…', 'amber');
      if (!rows.length) {
        moToast('No hay comparables con datos en la tabla', 'red');
        if (!silencioso) moMostrarModalSinCandidatas('No hay empresas comparables ingresadas en la tabla actual.');
        return;
      }
```

con:

```javascript
    function motorEjecutar(silencioso) {
      if (window.PT_CURANDO_IA) {
        if (!silencioso) moToast('IA aún analizando candidatas por actividad, intente de nuevo en unos segundos', 'amber');
        return;
      }
      const cfg = moCfg(); const rows = moRows();
      if (rows.length > 150 && !silencioso) moToast('Puntuando ' + rows.length + ' candidatas…', 'amber');
      if (!rows.length) {
        moToast('No hay comparables con datos en la tabla', 'red');
        if (!silencioso) moMostrarModalSinCandidatas('No hay empresas comparables ingresadas en la tabla actual.');
        return;
      }
```

- [ ] **Step 4: Verificación estructural**

Run: `grep -n "function curarCandidatosConIA\|function _ptChunk\|function _ptPool\|function _moIaInfo\|PT_CURANDO_IA" "index.html"`
Expected: `curarCandidatosConIA`, `_ptChunk`, `_ptPool`, `_moIaInfo` cada uno exactamente 1 vez como definición; `PT_CURANDO_IA` aparece 3 veces (la inicialización y las dos veces que se lee/escribe en `curarCandidatosConIA`, más 1 vez en el guard de `motorEjecutar` — 4 en total).

Run: `node -e "
function _ptChunk(arr, size) { const out = []; for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size)); return out; }
const chunks = _ptChunk(Array.from({length: 130}, (_, i) => i), 60);
console.assert(chunks.length === 3, 'esperaba 3 lotes, obtuvo ' + chunks.length);
console.assert(chunks[0].length === 60 && chunks[1].length === 60 && chunks[2].length === 10, 'tamaños de lote incorrectos: ' + chunks.map(c => c.length));
console.log('OK _ptChunk');
"`
Expected: imprime `OK _ptChunk` sin errores de `console.assert`.

Run: `node -e "
async function _ptPool(items, worker, limite) {
  const resultados = new Array(items.length);
  let idx = 0;
  async function siguiente() {
    while (idx < items.length) { const mio = idx++; resultados[mio] = await worker(items[mio], mio); }
  }
  const corredores = Array.from({ length: Math.min(limite, items.length) }, siguiente);
  await Promise.all(corredores);
  return resultados;
}
(async () => {
  let enVuelo = 0, maxEnVuelo = 0;
  const out = await _ptPool([1,2,3,4,5,6,7,8], async (x) => {
    enVuelo++; maxEnVuelo = Math.max(maxEnVuelo, enVuelo);
    await new Promise(r => setTimeout(r, 10));
    enVuelo--;
    return x * 2;
  }, 3);
  console.assert(JSON.stringify(out) === JSON.stringify([2,4,6,8,10,12,14,16]), 'resultado en orden incorrecto: ' + JSON.stringify(out));
  console.assert(maxEnVuelo <= 3, 'la concurrencia superó el límite: ' + maxEnVuelo);
  console.log('OK _ptPool, concurrencia máxima observada:', maxEnVuelo);
})();
"`
Expected: imprime `OK _ptPool, concurrencia máxima observada: 3` (o un valor ≤ 3) sin errores de `console.assert`.

- [ ] **Step 5: Verificación manual (requiere `npm start` y `GEMINI_API_KEY` configurada)**

Run: `npm start`, abre `http://localhost:3000`.

1. Carga un informe del año anterior (texto plano con un párrafo describiendo un negocio, ej. "La compañía distribuye al por mayor fungicidas e insecticidas importados de su vinculada en EE.UU.") y espera a que el estado de actividad diga "✅ Actividad detectada".
2. Importa el archivo `Cpanel/public_html/demo-precios-transferencia/Archivos Prueba/END GAME 2025.xls` (u otro Excel de Capital IQ con columna Business Description) en "📥 Importar Excel (Capital IQ)".
3. Verifica que aparece la línea "🤖 IA curando candidatas… (X de Y evaluadas)" bajo el encabezado del Motor, que avanza, y termina en "✓ N de Y candidatas coinciden con la actividad".
4. Abre la consola del navegador y ejecuta `AI_MATCH_COMPS` — confirma que `porId` tiene entradas con `{coincide, motivo}` por cada ID evaluado.

Detén el servidor cuando termines.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
Curar candidatas del Excel de Capital IQ por IA al importarlas

Al terminar de importar el Excel, si ya hay actividad detectada, se
llama a Gemini en lotes de 60 (concurrencia 3) comparando la Business
Description real de cada candidata contra la actividad de la empresa.
El resultado queda en window.AI_MATCH_COMPS, listo para que el motor
lo use como filtro (siguiente commit). Ejecutar selección se bloquea
con un aviso mientras la curación sigue en curso.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Integrar la curación de IA en `moScore`/`moActMatch`

**Files:**
- Modify: `index.html` — comentario + función `moActMatch` (líneas ~3610-3632)
- Modify: `index.html` — función `moScore` (líneas ~3640-3678)

**Interfaces:**
- Consumes: `window.AI_MATCH_COMPS` (Task 3), `DESCS` (global existente), `ptTraducirKeyword()` (helper existente sin cambios).
- Produces: `moActMatch(o, act, aiRec)` (firma con un tercer parámetro opcional) y `moScore(o, cfg, medPool, sTP, act)` (misma firma pública, comportamiento extendido) — consumidos por `motorEjecutar`/`moSimula`, que ya los invocan sin cambios en esos sitios de llamada.

- [ ] **Step 1: Reemplazar `moActMatch` (con su comentario) por la versión con `aiRec`**

Reemplaza:

```javascript
    /* Coincidencia del candidato con la actividad específica extraída del estudio
       del año anterior (setActividadEspecifica): palabras clave y SIC contra la
       descripción/SIC del candidato.
       Devuelve un objeto {factor, hits, posibles, hayAct}.
       Sin actividad específica cargada → hayAct=false, pesos originales.
       CON actividad cargada:
         - hits=0 → moScore EXCLUYE al candidato (no coincide con la especialidad)
         - hits>0 → fK se pondera al 40% del puntaje total (filtro por nicho). */
    function moActMatch(o, act) {
      if (!act) return { factor: 1, hits: 0, posibles: 0, hayAct: false, tieneDesc: false };
      const descText = (DESCS[o.name] || '');
      const base = (o.name + ' ' + descText + ' ' + (o.sic || '')).toLowerCase();
      let hits = 0;
      const kws = [].concat(act.keywords || [], act.productos || []).filter(Boolean);
      kws.forEach(k => { if (base.indexOf(String(k).toLowerCase()) >= 0) hits++; });
      const sics = (act.sic || []).filter(Boolean);
      sics.forEach(c => {
        if ((o.sic || '').indexOf(String(c)) >= 0) hits += 2;
        else if ((o.sic || '').indexOf(String(c).slice(0, 3)) >= 0) hits += 1;
      });
      const posibles = kws.length + sics.length;
      return { factor: Math.max(0.15, Math.min(1, hits / 4)), hits: hits, posibles: posibles, hayAct: true, tieneDesc: !!descText.trim() };
    }
```

con:

```javascript
    /* Coincidencia del candidato con la actividad específica.
       Devuelve un objeto {factor, hits, posibles, hayAct, tieneDesc}.
       Si aiRec viene de la curación por IA (curarCandidatosConIA) con coincide:true, se usa
       tal cual (factor máximo) porque la IA ya leyó la Business Description real y decidió
       que sí es la misma actividad — no hace falta recalcular por palabras clave.
       Sin aiRec (candidata no evaluada por IA: agregada a mano, sin ID/descripción, Excel no
       importado, o el lote de su ID falló) se usa la heurística de texto de siempre, ahora
       por solapamiento de palabras significativas entre la frase de actividad (español) y su
       traducción aproximada al inglés (ptTraducirKeyword) contra el nombre/descripción/SIC. */
    function _ptTokensSignificativos(frase) {
      return String(frase || '').toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(function (t) { return t.length >= 4; });
    }
    function moActMatch(o, act, aiRec) {
      if (aiRec && aiRec.coincide === true) return { factor: 1, hits: 4, posibles: 4, hayAct: true, tieneDesc: true };
      if (!act || !act.resumen) return { factor: 1, hits: 0, posibles: 0, hayAct: false, tieneDesc: false };
      const descText = (DESCS[o.name] || '');
      const base = (o.name + ' ' + descText + ' ' + (o.sic || '')).toLowerCase();
      const fraseIngles = (typeof ptTraducirKeyword === 'function') ? ptTraducirKeyword(act.resumen) : act.resumen;
      const tokens = _ptTokensSignificativos(fraseIngles).concat(_ptTokensSignificativos(act.resumen));
      let hits = 0;
      tokens.forEach(function (t) { if (base.indexOf(t) >= 0) hits++; });
      const posibles = tokens.length;
      return { factor: Math.max(0.15, Math.min(1, hits / 4)), hits: hits, posibles: posibles, hayAct: true, tieneDesc: !!descText.trim() };
    }
```

- [ ] **Step 2: Reemplazar `moScore` para usar la curación de IA**

Reemplaza:

```javascript
    function moScore(o, cfg, medPool, sTP, act) {
      if (o.holding && cfg.holding === 'excluir') return { out: 'Sociedad de inversión/holding sin actividad operativa propia: excluida (funciones, activos y riesgos no comparables, Art. 260-4 E.T.)' };
      var socioMax = maxParticipacion(o.holders);
      var topeIndep = (window.PT_CRITERIOS && PT_CRITERIOS.independenciaTope) || 50;
      if (socioMax !== null && socioMax > topeIndep) return { out: 'No independiente: un solo accionista concentra el ' + socioMax.toFixed(2) + ' % de la propiedad, superior al ' + topeIndep + ' % admitido; existe vinculación por control (Art. 260-1 E.T.).' };
      if (o.saldoNeg && o.saldoNeg.length && cfg.saldoneg === 'excluir') return { out: 'Saldo negativo en ' + o.saldoNeg.map(k => ({ ar: 'Cuentas por cobrar', inv: 'Inventario', ap: 'Cuentas por pagar' }[k])).join('/') + ': dato no verosímil, se excluye de la muestra' };
      if (cfg.act === 'estricto' && o.perfil !== 'SERVICIO') return { out: 'Perfil ' + o.perfil + ': excluido en modo estricto (Art. 260-4 — solo prestadores de servicios)' };
      if (cfg.act === 'estandar' && o.perfil === 'INDEFINIDO') return { out: 'Perfil funcional indefinido: excluido en modo estándar; disponible en modo amplio con revisión manual' };
      if (o.perfil === 'EMPRESARIO') return { out: 'Empresario pleno (IP propia, riesgo de mercado): funciones/activos/riesgos incomparables (Art. 260-4 E.T.)' };
      if (o.perdida && cfg.perd === 'excluir') return { out: 'Pérdida operativa: excluida por criterio conservador del analista (posibles circunstancias económicas anormales)' };
      /* ── Coincidencia con la actividad específica (nicho/especialidad) ── */
      const actM = moActMatch(o, act);
      /* Exclusión por especialidad: solo en modo estricto si la candidata cuenta con descripción/SIC y 0 coincidencia.
         En modo estándar/amplio, 0 coincidencias asigna un puntaje bajo en el factor de especialidad (peso del 40%)
         para priorizar las que sí coinciden, sin descartar masivamente cuando faltan descripciones detalladas. */
      if (actM.hayAct && actM.posibles > 0 && actM.hits === 0 && cfg.act === 'estricto' && actM.tieneDesc) {
        const resumen = (act.resumen || '').slice(0, 90);
        return { out: 'Sin coincidencia con la actividad específica: la descripción del candidato no coincide con ninguna palabra clave del perfil (' + resumen + (resumen.length >= 90 ? '…' : '') + ')' };
      }
      const fA = o.perfil === 'SERVICIO' ? 1 : (o.perfil === 'MIXTO' ? 0.6 : 0.35);
      const fK = actM.factor;
      const kTag = (actM.hayAct && fK >= 0.5) ? 'coincide con la actividad específica (' + actM.hits + ' coincidencias)' : (actM.hayAct ? 'coincidencia parcial (' + actM.hits + ')' : '');
      let fG = 1, gTag = ''; if (cfg.geo !== 'ninguna') { const r = moRegion(o.pais); fG = r === cfg.geo ? 1 : (r === 'OTRA' ? 0.5 : 0.65); if (r === cfg.geo) gTag = 'región prioritaria (' + (o.pais || '') + ')'; }
      let fT = 0.5, tTag = ''; if (sTP && o.s) { const d = Math.abs(Math.log10(o.s / sTP)); fT = 1 / (1 + d); if (d < 1) tTag = 'tamaño próximo'; }
      let fR; if (o.perdida) { fR = cfg.perd === 'preferir' ? 1 : 0.4; } else { fR = cfg.perd === 'preferir' ? 0.4 : Math.max(0, 1 - Math.min(1, Math.abs((o.pli ?? 0) - medPool) / 0.5)); }
      /* Pesos dinámicos: cuando hay actividad específica cargada, el nicho
         pesa 40% (filtro fuerte) y el perfil genérico baja a 20%.
         Sin actividad, se conservan los pesos originales. */
      const wA = actM.hayAct ? 0.20 : 0.35;
      const wK = actM.hayAct ? 0.40 : 0.15;
      const wG = actM.hayAct ? 0.10 : 0.15;
      const wT = actM.hayAct ? 0.15 : 0.20;
      const wR = actM.hayAct ? 0.15 : 0.15;
      const scBase = wA * fA + wK * fK + wG * fG + wT * fT + wR * fR;
      const bonoContinuidad = o.previa ? 0.08 : 0;
      const sc = scBase + bonoContinuidad;
      const raz = ['perfil ' + o.perfil.toLowerCase(), kTag, gTag, tTag, (o.perdida ? 'con pérdida (' + cfg.perd + ')' : ''), (o.previa ? 'continuidad con el año anterior' : '')].filter(x => x).join(', ');
      return { sc, raz };
    }
```

con:

```javascript
    function moScore(o, cfg, medPool, sTP, act) {
      if (o.holding && cfg.holding === 'excluir') return { out: 'Sociedad de inversión/holding sin actividad operativa propia: excluida (funciones, activos y riesgos no comparables, Art. 260-4 E.T.)' };
      var socioMax = maxParticipacion(o.holders);
      var topeIndep = (window.PT_CRITERIOS && PT_CRITERIOS.independenciaTope) || 50;
      if (socioMax !== null && socioMax > topeIndep) return { out: 'No independiente: un solo accionista concentra el ' + socioMax.toFixed(2) + ' % de la propiedad, superior al ' + topeIndep + ' % admitido; existe vinculación por control (Art. 260-1 E.T.).' };
      if (o.saldoNeg && o.saldoNeg.length && cfg.saldoneg === 'excluir') return { out: 'Saldo negativo en ' + o.saldoNeg.map(k => ({ ar: 'Cuentas por cobrar', inv: 'Inventario', ap: 'Cuentas por pagar' }[k])).join('/') + ': dato no verosímil, se excluye de la muestra' };
      if (cfg.act === 'estricto' && o.perfil !== 'SERVICIO') return { out: 'Perfil ' + o.perfil + ': excluido en modo estricto (Art. 260-4 — solo prestadores de servicios)' };
      if (cfg.act === 'estandar' && o.perfil === 'INDEFINIDO') return { out: 'Perfil funcional indefinido: excluido en modo estándar; disponible en modo amplio con revisión manual' };
      if (o.perfil === 'EMPRESARIO') return { out: 'Empresario pleno (IP propia, riesgo de mercado): funciones/activos/riesgos incomparables (Art. 260-4 E.T.)' };
      if (o.perdida && cfg.perd === 'excluir') return { out: 'Pérdida operativa: excluida por criterio conservador del analista (posibles circunstancias económicas anormales)' };
      /* ── Curación de candidatas por IA (Business Description real de Capital IQ) ──
         Solo aplica a filas con ID IQ (vinieron del Excel de Capital IQ); las agregadas a
         mano o de otras fuentes (SuperSociedades, continuidad) no tienen ID y siguen de
         largo hacia la heurística de texto de moActMatch, sin verse afectadas. */
      const descTextIA = DESCS[o.name] || '';
      const aiRec = (window.AI_MATCH_COMPS && o.id) ? AI_MATCH_COMPS.porId[String(o.id).trim()] : null;
      if (o.id && window.AI_MATCH_COMPS && !descTextIA.trim()) {
        return { out: 'Sin descripción de negocio de Capital IQ para verificar la actividad (ID ' + o.id + ')' };
      }
      if (aiRec && aiRec.coincide === false) {
        return { out: 'Rechazada por IA: la descripción de negocio no coincide con la actividad (' + (aiRec.motivo || 'sin motivo detallado') + ')' };
      }
      /* ── Coincidencia con la actividad específica (nicho/especialidad) ── */
      const actM = moActMatch(o, act, aiRec);
      /* Exclusión por especialidad: solo en modo estricto si la candidata cuenta con descripción/SIC y 0 coincidencia.
         En modo estándar/amplio, 0 coincidencias asigna un puntaje bajo en el factor de especialidad (peso del 40%)
         para priorizar las que sí coinciden, sin descartar masivamente cuando faltan descripciones detalladas. */
      if (actM.hayAct && actM.posibles > 0 && actM.hits === 0 && cfg.act === 'estricto' && actM.tieneDesc) {
        const resumen = (act.resumen || '').slice(0, 90);
        return { out: 'Sin coincidencia con la actividad específica: la descripción del candidato no coincide con ninguna palabra clave del perfil (' + resumen + (resumen.length >= 90 ? '…' : '') + ')' };
      }
      const fA = o.perfil === 'SERVICIO' ? 1 : (o.perfil === 'MIXTO' ? 0.6 : 0.35);
      const fK = actM.factor;
      const kTag = (aiRec && aiRec.coincide) ? 'coincidencia de actividad confirmada por IA (' + (aiRec.motivo || 'Business Description de Capital IQ') + ')' : ((actM.hayAct && fK >= 0.5) ? 'coincide con la actividad específica (' + actM.hits + ' coincidencias)' : (actM.hayAct ? 'coincidencia parcial (' + actM.hits + ')' : ''));
      let fG = 1, gTag = ''; if (cfg.geo !== 'ninguna') { const r = moRegion(o.pais); fG = r === cfg.geo ? 1 : (r === 'OTRA' ? 0.5 : 0.65); if (r === cfg.geo) gTag = 'región prioritaria (' + (o.pais || '') + ')'; }
      let fT = 0.5, tTag = ''; if (sTP && o.s) { const d = Math.abs(Math.log10(o.s / sTP)); fT = 1 / (1 + d); if (d < 1) tTag = 'tamaño próximo'; }
      let fR; if (o.perdida) { fR = cfg.perd === 'preferir' ? 1 : 0.4; } else { fR = cfg.perd === 'preferir' ? 0.4 : Math.max(0, 1 - Math.min(1, Math.abs((o.pli ?? 0) - medPool) / 0.5)); }
      /* Pesos dinámicos: cuando hay actividad específica cargada, el nicho
         pesa 40% (filtro fuerte) y el perfil genérico baja a 20%.
         Sin actividad, se conservan los pesos originales. */
      const wA = actM.hayAct ? 0.20 : 0.35;
      const wK = actM.hayAct ? 0.40 : 0.15;
      const wG = actM.hayAct ? 0.10 : 0.15;
      const wT = actM.hayAct ? 0.15 : 0.20;
      const wR = actM.hayAct ? 0.15 : 0.15;
      const scBase = wA * fA + wK * fK + wG * fG + wT * fT + wR * fR;
      const bonoContinuidad = o.previa ? 0.08 : 0;
      const sc = scBase + bonoContinuidad;
      const raz = ['perfil ' + o.perfil.toLowerCase(), kTag, gTag, tTag, (o.perdida ? 'con pérdida (' + cfg.perd + ')' : ''), (o.previa ? 'continuidad con el año anterior' : '')].filter(x => x).join(', ');
      return { sc, raz };
    }
```

- [ ] **Step 3: Verificación estructural**

Run: `grep -n "function moActMatch\|function _ptTokensSignificativos" "index.html"`
Expected: cada una exactamente 1 vez.

Run: `grep -n "Rechazada por IA\|Sin descripción de negocio de Capital IQ" "index.html"`
Expected: cada frase aparece exactamente 1 vez, dentro de `moScore`.

Run: `node -e "
function _ptTokensSignificativos(frase) {
  return String(frase || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(function (t) { return t.length >= 4; });
}
const t = _ptTokensSignificativos('Distribución mayorista de fungicidas e insecticidas');
console.assert(t.includes('distribucion'), 'no tokenizó distribución sin tilde: ' + JSON.stringify(t));
console.assert(t.includes('mayorista'), 'falta mayorista: ' + JSON.stringify(t));
console.assert(!t.includes('de') && !t.includes('e'), 'no debería incluir palabras cortas: ' + JSON.stringify(t));
console.log('OK _ptTokensSignificativos:', t);
"`
Expected: imprime `OK _ptTokensSignificativos: [...]` sin errores de `console.assert`.

- [ ] **Step 4: Verificación manual (requiere `npm start` y `GEMINI_API_KEY`)**

Repite el flujo del Step 5 de Task 3 (cargar informe → importar Excel → esperar curación) y luego:

1. Pulsa "Ejecutar selección".
2. Abre el "📊 Embudo de depuración del universo" y confirma que, si hubo candidatas rechazadas por la IA, aparece la fila "Rechazada por IA: la descripción de negocio no coincide con la actividad (…)" en la tabla de motivos de descarte.
3. Si alguna candidata importada no traía Business Description, confirma que aparece con el motivo "Sin descripción de negocio de Capital IQ para verificar la actividad (ID …)".

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
Integrar la curación de IA como filtro del motor de comparables

moScore excluye de plano las candidatas que la IA marcó sin coincidir
con la actividad (y las que traían ID IQ pero sin Business Description
para verificar), y trata como coincidencia máxima las que la IA sí
confirmó. Las filas sin evaluación de IA (agregadas a mano, u otras
fuentes) siguen la heurística de texto existente, ahora por
solapamiento de palabras significativas en vez de sub-frase literal.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Persistir la curación de IA con el estudio

**Files:**
- Modify: `index.html` — función `readForm` (líneas ~2805-2818)
- Modify: `index.html` — función `writeForm` (líneas ~2819-2837)

**Interfaces:**
- Consumes: `window.AI_MATCH_COMPS` (Task 3).
- Produces: campo `aiMatch` dentro del objeto de estudio guardado/restaurado por `readForm()`/`writeForm()`.

- [ ] **Step 1: Agregar `aiMatch` a `readForm`**

Reemplaza:

```javascript
    function readForm() {
      const s = {
        name: studies[active] ? studies[active].name : 'Estudio',
        t: { s: num($('t_s').value), c: num($('t_c').value), op: num($('t_op').value), ar: num($('t_ar').value), inv: num($('t_inv').value), ap: num($('t_ap').value) },
        comps: [...$('cbody').children].map(tr => { const v = [...tr.querySelectorAll('input,select')].map(i => i.value); return [v[0], v[1], num(v[2]), num(v[3]), num(v[4]), num(v[5]), num(v[6]), num(v[7]), v[8] || '']; }),
        actividad_json: $('actividad_json') ? $('actividad_json').value : '',
        useadj: $('useadj') ? $('useadj').checked : true,
        adj: (typeof ADJ !== 'undefined') ? JSON.parse(JSON.stringify(ADJ)) : null,
        motor: (typeof MOTOR !== 'undefined') ? JSON.parse(JSON.stringify(MOTOR)) : null,
        eeffIA: window.PT_EEFF_IA ? JSON.parse(JSON.stringify(window.PT_EEFF_IA)) : null
      };
      CAMPOS_ESTUDIO.forEach(id => { const el = $(id); if (el) s[id] = el.value; });
      return s;
    }
```

con:

```javascript
    function readForm() {
      const s = {
        name: studies[active] ? studies[active].name : 'Estudio',
        t: { s: num($('t_s').value), c: num($('t_c').value), op: num($('t_op').value), ar: num($('t_ar').value), inv: num($('t_inv').value), ap: num($('t_ap').value) },
        comps: [...$('cbody').children].map(tr => { const v = [...tr.querySelectorAll('input,select')].map(i => i.value); return [v[0], v[1], num(v[2]), num(v[3]), num(v[4]), num(v[5]), num(v[6]), num(v[7]), v[8] || '']; }),
        actividad_json: $('actividad_json') ? $('actividad_json').value : '',
        useadj: $('useadj') ? $('useadj').checked : true,
        adj: (typeof ADJ !== 'undefined') ? JSON.parse(JSON.stringify(ADJ)) : null,
        motor: (typeof MOTOR !== 'undefined') ? JSON.parse(JSON.stringify(MOTOR)) : null,
        eeffIA: window.PT_EEFF_IA ? JSON.parse(JSON.stringify(window.PT_EEFF_IA)) : null,
        aiMatch: window.AI_MATCH_COMPS ? JSON.parse(JSON.stringify(window.AI_MATCH_COMPS)) : null
      };
      CAMPOS_ESTUDIO.forEach(id => { const el = $(id); if (el) s[id] = el.value; });
      return s;
    }
```

- [ ] **Step 2: Restaurar `aiMatch` en `writeForm`**

Reemplaza:

```javascript
    function writeForm(s) {
      CAMPOS_ESTUDIO.forEach(id => { const el = $(id); if (el) el.value = s[id] || ''; });
      if ($('useadj')) $('useadj').checked = (s.useadj !== undefined) ? !!s.useadj : true;
      const t = s.t || {};['s', 'c', 'op', 'ar', 'inv', 'ap'].forEach(k => $('t_' + k).value = t[k] ?? '');
      $('cbody').innerHTML = ''; const frag = document.createDocumentFragment(); (s.comps || []).forEach(c => frag.appendChild(compRow(c))); $('cbody').appendChild(frag);
      if ($('actividad_json')) { $('actividad_json').value = s.actividad_json || ''; }
      if (typeof renderActividadEspecifica === 'function') renderActividadEspecifica();
      if (typeof ADJ !== 'undefined') {
        window.ADJ = s.adj ? JSON.parse(JSON.stringify(s.adj)) : { logoempresa: [], logofirma: [], eeff: [], eeffcomp: [], organigrama: [], productos: [], sector: [], otros: [] };
        try { if (typeof adjRefreshUI === 'function') adjRefreshUI(); } catch (e) { }
      }
      if (typeof MOTOR !== 'undefined') {
        window.MOTOR = s.motor ? JSON.parse(JSON.stringify(s.motor)) : { activo: false, sel: {}, motivo: {}, score: {}, cfg: null, just: '', escenario: '' };
        try { if (typeof motorRefreshUI === 'function') motorRefreshUI(); } catch (e) { }
      }
      window.PT_EEFF_IA = s.eeffIA ? JSON.parse(JSON.stringify(s.eeffIA)) : null;
      const hostIA = document.getElementById('ptEeffIA'); if (hostIA && !s.eeffIA) hostIA.innerHTML = '';
      try { if (typeof ptPintarEeffIA === 'function') ptPintarEeffIA(); } catch (e) { }
    }
```

con:

```javascript
    function writeForm(s) {
      CAMPOS_ESTUDIO.forEach(id => { const el = $(id); if (el) el.value = s[id] || ''; });
      if ($('useadj')) $('useadj').checked = (s.useadj !== undefined) ? !!s.useadj : true;
      const t = s.t || {};['s', 'c', 'op', 'ar', 'inv', 'ap'].forEach(k => $('t_' + k).value = t[k] ?? '');
      $('cbody').innerHTML = ''; const frag = document.createDocumentFragment(); (s.comps || []).forEach(c => frag.appendChild(compRow(c))); $('cbody').appendChild(frag);
      if ($('actividad_json')) { $('actividad_json').value = s.actividad_json || ''; }
      if (typeof renderActividadEspecifica === 'function') renderActividadEspecifica();
      if (typeof ADJ !== 'undefined') {
        window.ADJ = s.adj ? JSON.parse(JSON.stringify(s.adj)) : { logoempresa: [], logofirma: [], eeff: [], eeffcomp: [], organigrama: [], productos: [], sector: [], otros: [] };
        try { if (typeof adjRefreshUI === 'function') adjRefreshUI(); } catch (e) { }
      }
      if (typeof MOTOR !== 'undefined') {
        window.MOTOR = s.motor ? JSON.parse(JSON.stringify(s.motor)) : { activo: false, sel: {}, motivo: {}, score: {}, cfg: null, just: '', escenario: '' };
        try { if (typeof motorRefreshUI === 'function') motorRefreshUI(); } catch (e) { }
      }
      window.PT_EEFF_IA = s.eeffIA ? JSON.parse(JSON.stringify(s.eeffIA)) : null;
      const hostIA = document.getElementById('ptEeffIA'); if (hostIA && !s.eeffIA) hostIA.innerHTML = '';
      try { if (typeof ptPintarEeffIA === 'function') ptPintarEeffIA(); } catch (e) { }
      window.AI_MATCH_COMPS = s.aiMatch ? JSON.parse(JSON.stringify(s.aiMatch)) : null;
      try {
        const elIa = $('mo_ia_status');
        if (elIa) {
          if (window.AI_MATCH_COMPS && window.AI_MATCH_COMPS.porId) {
            const valores = Object.values(window.AI_MATCH_COMPS.porId);
            const nMatch = valores.filter(v => v.coincide).length;
            elIa.textContent = '✓ ' + nMatch + ' de ' + valores.length + ' candidatas coinciden con la actividad (curación guardada del estudio)';
          } else {
            elIa.textContent = '';
          }
        }
      } catch (e) { }
    }
```

- [ ] **Step 2: Verificación estructural**

Run: `grep -n "aiMatch" "index.html"`
Expected: 3 coincidencias (una en `readForm`, dos en `writeForm`: la asignación y la lectura dentro del `try`).

- [ ] **Step 3: Verificación manual (requiere `npm start`)**

1. Repite el flujo de importación + curación de la Task 3.
2. Guarda el estudio ("Guardado en memoria" / `saveToMemory`).
3. Recarga la página (`F5`) y vuelve a cargar el mismo estudio desde "Estudios guardados".
4. Confirma que la línea junto al Motor dice "✓ N de Y candidatas coinciden con la actividad (curación guardada del estudio)" sin haber vuelto a importar el Excel.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
Persistir la curación de candidatas por IA con el estudio guardado

AI_MATCH_COMPS viaja en readForm/writeForm igual que MOTOR o eeffIA,
para que al recargar o cambiar de estudio no haya que reimportar el
Excel de Capital IQ para recuperar qué candidatas ya fueron curadas.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Sincronizar el build y verificación final de extremo a extremo

**Files:**
- Modify: `public/index.html` (generado, no se edita a mano — lo produce `npm run build`)

**Interfaces:**
- Consumes: todo lo producido por las Tasks 1-5.
- Produces: `public/index.html` sincronizado, listo para servir.

- [ ] **Step 1: Sincronizar `public/index.html`**

Run: `npm run build`
Expected: termina sin errores (el script `scripts/sync-index.js` copia `index.html` → `public/index.html`).

- [ ] **Step 2: Verificar que la copia quedó idéntica**

Run (PowerShell, ya que el proyecto corre en Windows): `Compare-Object (Get-Content "index.html") (Get-Content "public/index.html")`
Expected: sin salida (los archivos son idénticos).

- [ ] **Step 3: Pasada manual final de extremo a extremo**

Run: `npm start`, abre `http://localhost:3000`.

Sigue la lista de verificación completa del spec (`docs/superpowers/specs/2026-07-29-motor-comparables-curacion-ia-design.md`, sección "Verificación"):

1. Cargar un informe del año anterior (PDF/JSON/TXT) y confirmar que la actividad se detecta sola, sin pulsar nada, pasando por pendiente → procesando → listo.
2. Editar la frase con el ✏️, confirmar que se guarda y (si ya hay Excel importado) se relanza la curación.
3. Importar `END GAME 2025.xls` (u otro Excel de Capital IQ con Business Description) y confirmar que la curación corre en lotes, se ve el progreso, y termina con un conteo coherente de coincidencias.
4. Ejecutar el motor y confirmar en el embudo de depuración que aparecen las nuevas categorías de rechazo ("Rechazada por IA…", "Sin descripción de negocio…") junto a las existentes.
5. Simular un fallo de red hacia `/api/gemini` (por ejemplo, deteniendo el servidor a mitad de la curación) y confirmar que el motor sigue funcionando con la heurística de texto para las candidatas no evaluadas, sin bloquear "Ejecutar selección" de forma permanente.
6. Guardar el estudio, recargar la página, y confirmar que `AI_MATCH_COMPS` y la actividad detectada persisten sin tener que re-importar el Excel.

Detén el servidor cuando termines.

- [ ] **Step 4: Commit final**

```bash
git add public/index.html
git commit -m "$(cat <<'EOF'
Sincronizar public/index.html (npm run build) con el motor de comparables + IA

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review Notes

- **Cobertura del spec:** cada sección del spec (flujo automático, reubicación de UI, modelo de datos de un solo campo, curación por lotes con concurrencia 3, exclusión dura + fallback, categoría "sin descripción", persistencia, manejo de errores) tiene una tarea que la implementa (Tasks 1-5) y una tarea de verificación de extremo a extremo (Task 6).
- **Sin placeholders:** todos los pasos incluyen el código exacto a escribir; ninguno dice "agregar validación" o "similar a la tarea N" sin el código real.
- **Consistencia de tipos/firmas:** `moActMatch(o, act, aiRec)` se define en Task 4 con esa firma exacta y se llama así en el `moScore` de esa misma tarea; `curarCandidatosConIA(list)` se define en Task 3 y se llama igual desde `importCompsFile` (Task 3) y `actGuardarEdicion`/`extractPriorActivityWithGemini` (Task 1, con guardas `typeof` porque en ese momento del archivo la función aún no existe en el orden de lectura — la ejecución real ocurre después de cargar todo el script, así que funciona por hoisting).
- **Riesgo conocido y documentado:** en Task 4, la heurística de respaldo (`moActMatch` sin `aiRec`) ya no compara contra una lista de keywords en inglés escritas a mano, sino contra una traducción aproximada de una frase completa — es deliberadamente más débil que antes para los casos SIN curación de IA, documentado en el propio comentario del código y en el spec como "heurística de texto existente" de último recurso.
