# Wizard secuencial de 3 pasos en Comparables — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reordenar físicamente la tarjeta "Comparables" para que el orden visual de arriba a abajo coincida con el orden real de uso: ① definir filtros → ② importar Excel de Capital IQ → ③ ejecutar selección — con insignias numeradas en estilo corporativo serio.

**Architecture:** Cambio puramente de HTML/CSS dentro de `index.html`, en la sección `<div class="bd">` de la tarjeta cuyo `<h3>` es "Comparables". Ningún `id`, `onclick` ni estructura interna de los controles existentes cambia — solo su posición en el DOM y tres encabezados numerados nuevos entre ellos. El JavaScript que los referencia (`motorEjecutar`, `importCompsFile`, `curarCandidatosConIA`, `motorRefreshUI`, `motorPintarEmbudo`, `toggleCompsTable`) sigue funcionando sin cambios.

**Tech Stack:** HTML/CSS inline, sin framework de estilos (mismo patrón del resto del archivo).

## Global Constraints

- Editar únicamente el `index.html` de la raíz del repo (no `public/index.html`).
- Al terminar, correr `npm run build` para sincronizar `public/index.html`.
- No cambiar ningún `id` existente: `mo_pesos_label`, `mo_n`, `mo_perd`, `mo_holding`, `mo_saldoneg`, `mo_geo`, `mo_act`, `mo_justw`, `mo_just`, `mo_ia_status`, `mo_info`, `mo_resultados`, `mo_embudo`, `mo_esc`, `mo_esc_cards`, `mo_esc_justw`, `mo_esc_just`, `evid-comps`, `toggleCompsBtn`, `compsSummaryBadge`, `compsBadgeCount`, `sicexp`, `compsTblWrap`, `ctbl`, `cbody`.
- No hay test runner en este proyecto. Verificación: `grep` estructural + sanity-check de sintaxis con `node -e "new Function(...)"` sobre los bloques `<script>` + verificación manual en navegador.
- Insignias numeradas en estilo serio/corporativo: círculo `#334155` (gris pizarra oscuro), número blanco, sin colores llamativos.

---

### Task 1: Reordenar la tarjeta Comparables en un wizard de 3 pasos

**Files:**
- Modify: `index.html` — dentro de la tarjeta "Comparables", desde el comentario `<!-- ══════ MOTOR DE SELECCIÓN (paso 1: filtros, antes de importar) ══════ -->` hasta el cierre del bloque `<!-- ══════ PASO 2: importar el universo de Capital IQ ══════ -->` (líneas ~1474-1555 antes de este cambio).

**Interfaces:**
- Consumes: nada nuevo — reordena controles ya existentes (`motorEjecutar()`, `motorMas(3)`, `motorEscenarios()`, `importCompsFile(this.files[0])`, `attachEvidence('comps', ...)`, `toggleCompsTable()`, `motorConfirmarEsc()`).
- Produces: mismo conjunto de IDs, en nuevo orden en el DOM. Nada nuevo que otras tareas deban conocer (no hay Task 2).

- [ ] **Step 1: Reordenar el bloque en un único wizard de 3 pasos**

Con la herramienta Edit, en `index.html` reemplaza:

```html
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
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:8px;margin-top:10px">
              <label class="f"><span class="l">N objetivo</span><input class="i" id="mo_n" type="number" value="12"
                  min="4" max="30" title="Tope 30: por encima la muestra pierde homogeneidad funcional"></label>
              <label class="f"><span class="l">Pérdidas operativas</span><select class="i" id="mo_perd">
                  <option value="excluir">Excluir (conservador DIAN)</option>
                  <option value="incluir">Incluir (OCDE: no es causal por sí sola)</option>
                  <option value="preferir">Preferir (exige justificación)</option>
                </select></label>
              <label class="f"><span class="l">Sociedades holding</span><select class="i" id="mo_holding">
                  <option value="excluir">Excluir (sin actividad operativa propia)</option>
                  <option value="incluir">Incluir</option>
                </select></label>
              <label class="f"><span class="l">Saldos negativos (CxC/Inv/CxP)</span><select class="i" id="mo_saldoneg">
                  <option value="excluir">Excluir (dato no verosímil)</option>
                  <option value="incluir">Incluir</option>
                </select></label>
              <label class="f"><span class="l">Prioridad geográfica</span><select class="i" id="mo_geo">
                  <option value="ninguna">Global</option>
                  <option value="LATAM">América Latina</option>
                  <option value="ASIA">Asia-Pacífico</option>
                  <option value="EUROPA">Europa</option>
                  <option value="NORTEAM">Norteamérica</option>
                </select></label>
              <label class="f"><span class="l">Rigor funcional</span><select class="i" id="mo_act">
                  <option value="estandar">Estándar (servicios+mixtos)</option>
                  <option value="estricto">Estricto (solo servicios)</option>
                  <option value="amplio">Amplio (incluye indefinidos)</option>
                </select></label>
            </div>
            <label class="f" id="mo_justw" style="display:none;margin-top:6px"><span class="l">Justificación de
                preferir
                pérdidas (≥120 car., va al informe)</span><textarea class="i" id="mo_just" rows="2"></textarea></label>
            <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn solid" onclick="motorEjecutar()">Ejecutar selección</button>
              <button class="btn ghost" onclick="motorMas(3)">+ Solicitar 3 más</button>
              <button class="btn ghost" onclick="motorEscenarios()">⚖ Comparar escenarios</button>

              <span id="mo_info" style="font-size:12px;color:var(--muted);align-self:center"></span>
            </div>
            <div id="mo_resultados"></div>
            <div id="mo_embudo"></div>
            <div id="mo_esc" style="display:none;margin-top:12px">
              <div style="font-size:11px;color:var(--muted);margin-bottom:6px">▲ = parte examinada · franja =
                P25–P75 ·
                línea = mediana. Elegir un escenario lo aplica, ejecuta el motor y documenta la elección en el
                informe.
              </div>
              <div id="mo_esc_cards"
                style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px"></div>
              <label class="f" id="mo_esc_justw" style="display:none;margin-top:8px"><span class="l">¿Por qué este
                  escenario? (≥80 car., va a la metodología)</span><textarea class="i" id="mo_esc_just"
                  rows="2"></textarea>
                <button class="btn" style="margin-top:6px" onclick="motorConfirmarEsc()">Confirmar y
                  aplicar</button></label>
            </div>
          </div>

          <!-- ══════ PASO 2: importar el universo de Capital IQ ══════ -->
          <div class="pi-btns"
            style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
            <div style="display:flex;gap:6px;align-items:center"><label class="mini" style="cursor:pointer">📥 Importar
                Excel (Capital IQ)<input type="file" accept=".xlsx,.xls,.csv,.txt" style="display:none"
                  onchange="importCompsFile(this.files[0])"></label>

              <label class="mini" style="cursor:pointer">📎
                Adjuntar<input type="file" style="display:none"
                  onchange="attachEvidence('comps',this.files[0])"></label><span id="evid-comps"
                style="font-size:10.5px;color:#1F6D4F"></span>
            </div><button type="button" class="btn mini violet" id="toggleCompsBtn" onclick="toggleCompsTable()"
              style="margin-left:auto;font-weight:600">👁️ Ocultar /
              Mostrar tabla</button>
          </div>
```

con:

```html
          <!-- ══════ MOTOR DE SELECCIÓN AUTOMÁTICA — wizard de 3 pasos ══════ -->
          <div
            style="border:1.5px solid var(--hair);border-radius:10px;padding:14px;margin:0 0 14px;background:var(--white)">
            <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
              <b style="font-size:13px">⚙ Motor de selección automática (TOP-N)</b>
              <span id="mo_pesos_label" style="font-size:11px;color:var(--muted)">Puntúa: actividad 40 · tamaño 20 ·
                geografía 15 ·
                rentabilidad 15 · datos 10</span>
            </div>

            <!-- Paso 1: filtros -->
            <div style="display:flex;align-items:center;gap:10px;margin:16px 0 10px">
              <span
                style="flex:none;width:24px;height:24px;border-radius:50%;background:#334155;color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center">1</span>
              <b style="font-size:12.5px;color:#1E293B">Definir los filtros del motor</b>
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:8px">
              <label class="f"><span class="l">N objetivo</span><input class="i" id="mo_n" type="number" value="12"
                  min="4" max="30" title="Tope 30: por encima la muestra pierde homogeneidad funcional"></label>
              <label class="f"><span class="l">Pérdidas operativas</span><select class="i" id="mo_perd">
                  <option value="excluir">Excluir (conservador DIAN)</option>
                  <option value="incluir">Incluir (OCDE: no es causal por sí sola)</option>
                  <option value="preferir">Preferir (exige justificación)</option>
                </select></label>
              <label class="f"><span class="l">Sociedades holding</span><select class="i" id="mo_holding">
                  <option value="excluir">Excluir (sin actividad operativa propia)</option>
                  <option value="incluir">Incluir</option>
                </select></label>
              <label class="f"><span class="l">Saldos negativos (CxC/Inv/CxP)</span><select class="i" id="mo_saldoneg">
                  <option value="excluir">Excluir (dato no verosímil)</option>
                  <option value="incluir">Incluir</option>
                </select></label>
              <label class="f"><span class="l">Prioridad geográfica</span><select class="i" id="mo_geo">
                  <option value="ninguna">Global</option>
                  <option value="LATAM">América Latina</option>
                  <option value="ASIA">Asia-Pacífico</option>
                  <option value="EUROPA">Europa</option>
                  <option value="NORTEAM">Norteamérica</option>
                </select></label>
              <label class="f"><span class="l">Rigor funcional</span><select class="i" id="mo_act">
                  <option value="estandar">Estándar (servicios+mixtos)</option>
                  <option value="estricto">Estricto (solo servicios)</option>
                  <option value="amplio">Amplio (incluye indefinidos)</option>
                </select></label>
            </div>
            <label class="f" id="mo_justw" style="display:none;margin-top:6px"><span class="l">Justificación de
                preferir
                pérdidas (≥120 car., va al informe)</span><textarea class="i" id="mo_just" rows="2"></textarea></label>

            <!-- Paso 2: importar Capital IQ -->
            <div
              style="display:flex;align-items:center;gap:10px;margin:16px 0 10px;padding-top:14px;border-top:1px solid var(--hair)">
              <span
                style="flex:none;width:24px;height:24px;border-radius:50%;background:#334155;color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center">2</span>
              <b style="font-size:12.5px;color:#1E293B">Importar el Excel de Capital IQ</b>
            </div>
            <div class="pi-btns"
              style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
              <div style="display:flex;gap:6px;align-items:center"><label class="mini" style="cursor:pointer">📥 Importar
                  Excel (Capital IQ)<input type="file" accept=".xlsx,.xls,.csv,.txt" style="display:none"
                    onchange="importCompsFile(this.files[0])"></label>

                <label class="mini" style="cursor:pointer">📎
                  Adjuntar<input type="file" style="display:none"
                    onchange="attachEvidence('comps',this.files[0])"></label><span id="evid-comps"
                  style="font-size:10.5px;color:#1F6D4F"></span>
              </div><button type="button" class="btn mini violet" id="toggleCompsBtn" onclick="toggleCompsTable()"
                style="margin-left:auto;font-weight:600">👁️ Ocultar /
                Mostrar tabla</button>
            </div>
            <div id="mo_ia_status" style="font-size:11.5px;color:var(--muted);margin-top:8px"></div>

            <!-- Paso 3: ejecutar -->
            <div
              style="display:flex;align-items:center;gap:10px;margin:16px 0 10px;padding-top:14px;border-top:1px solid var(--hair)">
              <span
                style="flex:none;width:24px;height:24px;border-radius:50%;background:#334155;color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center">3</span>
              <b style="font-size:12.5px;color:#1E293B">Ejecutar la selección</b>
            </div>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button class="btn solid" onclick="motorEjecutar()">Ejecutar selección</button>
              <button class="btn ghost" onclick="motorMas(3)">+ Solicitar 3 más</button>
              <button class="btn ghost" onclick="motorEscenarios()">⚖ Comparar escenarios</button>

              <span id="mo_info" style="font-size:12px;color:var(--muted);align-self:center"></span>
            </div>
            <div id="mo_resultados"></div>
            <div id="mo_embudo"></div>
            <div id="mo_esc" style="display:none;margin-top:12px">
              <div style="font-size:11px;color:var(--muted);margin-bottom:6px">▲ = parte examinada · franja =
                P25–P75 ·
                línea = mediana. Elegir un escenario lo aplica, ejecuta el motor y documenta la elección en el
                informe.
              </div>
              <div id="mo_esc_cards"
                style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:10px"></div>
              <label class="f" id="mo_esc_justw" style="display:none;margin-top:8px"><span class="l">¿Por qué este
                  escenario? (≥80 car., va a la metodología)</span><textarea class="i" id="mo_esc_just"
                  rows="2"></textarea>
                <button class="btn" style="margin-top:6px" onclick="motorConfirmarEsc()">Confirmar y
                  aplicar</button></label>
            </div>
          </div>
```

- [ ] **Step 2: Verificar que los IDs no se duplicaron ni se perdieron**

Run: `grep -c "id=\"mo_ia_status\"\|id=\"mo_n\"\|id=\"mo_perd\"\|id=\"mo_holding\"\|id=\"mo_saldoneg\"\|id=\"mo_geo\"\|id=\"mo_act\"\|id=\"mo_justw\"\|id=\"mo_just\"\|id=\"mo_info\"\|id=\"mo_resultados\"\|id=\"mo_embudo\"\|id=\"mo_esc\"\|id=\"toggleCompsBtn\"\|id=\"evid-comps\"" "index.html"`

Ejecuta cada patrón por separado con `grep -c "id=\"X\"" index.html` si el conteo combinado no es claro — cada uno debe dar exactamente `1` (o `2` para `mo_esc` porque `mo_esc_cards`/`mo_esc_justw`/`mo_esc_just` comparten el prefijo — confírmalo revisando las líneas con `grep -n`).

Run: `grep -n "PASO 2: importar el universo de Capital IQ" "index.html"`
Expected: sin coincidencias (el comentario viejo se reemplazó por "Paso 2: importar Capital IQ").

- [ ] **Step 3: Verificación de sintaxis**

Run:
```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('index.html', 'utf8');
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
let ok = true;
scripts.forEach((s, i) => { try { new Function(s); } catch (e) { ok = false; console.log('ERROR en bloque', i, ':', e.message); } });
console.log(ok ? 'TODOS LOS BLOQUES <script> PARSEAN OK' : 'HAY ERRORES DE SINTAXIS');
"
```
Expected: `TODOS LOS BLOQUES <script> PARSEAN OK`

- [ ] **Step 4: Sincronizar el build**

Run: `npm run build`
Expected: termina sin errores; `public/index.html` queda idéntico a `index.html` (verificar con `diff -q index.html public/index.html`, sin salida).

- [ ] **Step 5: Verificación manual (requiere `npm start`)**

Run: `npm start` (matar el proceso con su PID específico al terminar, **no** `taskkill /IM node.exe` que mata todos los procesos Node del sistema), abre `http://localhost:3000`.

Confirma visualmente en la tarjeta Comparables, de arriba a abajo:
1. Panel "🧠 Actividad de la empresa" (sin numerar).
2. Círculo "1" + "Definir los filtros del motor" + la grilla de filtros.
3. Círculo "2" + "Importar el Excel de Capital IQ" + los tres controles (Importar, Adjuntar, Ocultar/Mostrar tabla) + la línea de estado de la IA debajo.
4. Círculo "3" + "Ejecutar la selección" + los tres botones + resultados/embudo/escenarios.
5. Debajo de todo: la tabla de comparables, igual que antes.

Prueba que los tres botones (Ejecutar selección, Importar Excel, editar actividad) sigan funcionando exactamente igual que antes del reordeno.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "$(cat <<'EOF'
Reordenar la tarjeta Comparables en un wizard de 3 pasos numerados

Ejecutar selección aparecía antes que Importar Excel, contradiciendo
el orden real de uso. Ahora el DOM sigue exactamente ① filtros →
② importar Capital IQ (con el estado de curación IA justo debajo) →
③ ejecutar selección, con insignias numeradas en estilo corporativo.
Ningún id ni comportamiento cambia, solo la posición en el DOM.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review Notes

- **Cobertura del spec:** el spec pide reordenar filtros → importar → ejecutar con insignias numeradas serio-corporativas y sin tocar IDs/JS; la única tarea del plan cubre exactamente eso en un solo Edit atómico.
- **Sin placeholders:** el HTML nuevo está completo, carácter por carácter, tomado del archivo real.
- **Consistencia:** los mismos `id` (`mo_ia_status`, `mo_n`, `mo_perd`, `mo_holding`, `mo_saldoneg`, `mo_geo`, `mo_act`, `mo_justw`, `mo_just`, `mo_info`, `mo_resultados`, `mo_embudo`, `mo_esc*`, `toggleCompsBtn`, `evid-comps`) aparecen en el nuevo bloque exactamente como en el viejo — solo cambia el orden y se agregan tres `<div>` de encabezado numerado y dos `<div style="border-top...">` separadores.
- **Lección aplicada:** el Step 5 incluye explícitamente la advertencia de no volver a matar todos los procesos `node.exe` del sistema al limpiar el servidor de prueba (incidente de la sesión anterior).
