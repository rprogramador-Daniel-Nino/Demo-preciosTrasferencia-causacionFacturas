# Rubros adicionales del balance en la Ingesta de EEFF — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hacer editables desde "3. Ingesta Estados financieros" los seis rubros del balance que hoy solo existen en la hoja Datos del Excel Soporte Motor (`t_cash`, `t_inv_assoc`, `t_tax`, `t_intang`, `t_dif`, `t_act_nocurr`) pero que ningún punto de la interfaz permite corregir, quedando siempre en 0,00 salvo que alguien edite el objeto `study` fuera de la UI.

**Architecture:** Estos seis rubros ya son campos del objeto `study` (inicializados en `App.jsx`) y ya tienen fila propia en `RUBROS_EXAMINADA` (`memoriaCalculoRangoOptimo.js`), que es lo que exporta el Excel. Lo único que falta es una casilla en `IngestaCifras.jsx` que llame a `handleFieldChange(clave, valor)` — el mismo camino que usan hoy `t_ar`, `t_inv`, `t_ap`, `t_act_curr` y `t_ppe` — porque ese camino ya termina en `updateStudy()` → `setStudy()` en `App.jsx`, que es el único estado del que cuelga todo el sistema (Excel, informe, declaración, Formato 1125). No hace falta tocar la propagación: ya es en vivo para cualquier campo de `study`. Para que la etiqueta de cada casilla no pueda divergir de la etiqueta que ya lleva la hoja Datos del Excel, se exporta `RUBROS_EXAMINADA` desde `memoriaCalculoRangoOptimo.js` y la ingesta deriva sus etiquetas de ahí en vez de escribirlas de nuevo.

**Tech Stack:** React 19 (`frontend/src/components/IngestaCifras.jsx`), Node `node:test`/`node:assert` para `frontend/src/services/`.

**Spec:** No hay spec/diseño separado — los requisitos salen directo de la conversación con el usuario (2026-08-28): (1) confirmar que estos seis rubros no intervienen en el margen operacional (verificado: solo alimentan el % de Análisis Vertical de la hoja Datos y el ANEXO A/Tabla 10, no `t_op` ni los ajustes de capital de trabajo), y (2) agregar las casillas que faltan, con el mismo estado en vivo que ya tiene el resto de la ingesta.

## Global Constraints

- No modificar `motorExcelExport.js` ni `memoriaCalculoRangoOptimo.js` más allá de exportar la lista que ya existe — el Excel ya sabe leer estos seis campos de `study`, el problema es solo de la UI.
- No agregar lógica de suma automática (p. ej. que `t_act_nocurr` se calcule solo de `t_ppe + t_intang + t_dif`): el patrón existente (`t_act_curr`, `t_act_tot`) ya trata los subtotales como campos independientes y editables, no derivados — mantener esa misma convención.
- No tocar `eeffParser.js` ni `CAMPO_POR_RUBRO`: el alcance pedido es corrección MANUAL, no lectura automática por OCR. Ampliar el alcance de la OCR es una decisión aparte que no se pidió aquí.
- Código, comentarios y UI en español, siguiendo el estilo ya presente en `IngestaCifras.jsx` (comentarios cortos solo donde el porqué no es obvio).
- Cambios puramente visuales: la verificación es manual en el navegador (`npm run dev --prefix frontend`), no hay suite automatizada de componentes en este repo.

---

### Task 1: Exportar `RUBROS_EXAMINADA` para que la ingesta reutilice sus etiquetas

**Files:**
- Modify: `frontend/src/services/memoriaCalculoRangoOptimo.js:85` (agregar `export` a la constante)
- Test: `frontend/src/services/memoriaCalculoRangoOptimo.test.js`

**Interfaces:**
- Produces: `export const RUBROS_EXAMINADA: Array<{ clave: string, etiqueta: string, av: boolean, egreso?: boolean }>` — la misma constante que ya usa el módulo internamente, ahora también importable.

- [ ] **Step 1: Escribir la prueba que falla**

Agregar al final de `frontend/src/services/memoriaCalculoRangoOptimo.test.js`:

```js
import { RUBROS_EXAMINADA } from './memoriaCalculoRangoOptimo.js';

test('RUBROS_EXAMINADA expone clave y etiqueta de los seis rubros que la ingesta aún no permite editar', () => {
  const claves = ['t_cash', 't_inv_assoc', 't_tax', 't_intang', 't_dif', 't_act_nocurr'];
  const etiquetasEsperadas = {
    t_cash: 'Efectivo y equivalentes de efectivo',
    t_inv_assoc: 'Inversiones asociadas',
    t_tax: 'Activos por impuestos corrientes',
    t_intang: 'Intangibles',
    t_dif: 'Diferidos',
    t_act_nocurr: 'Total, Activos no corrientes',
  };
  for (const clave of claves) {
    const rubro = RUBROS_EXAMINADA.find((r) => r.clave === clave);
    assert.ok(rubro, `falta el rubro ${clave} en RUBROS_EXAMINADA`);
    assert.strictEqual(rubro.etiqueta, etiquetasEsperadas[clave]);
  }
});
```

- [ ] **Step 2: Correr la prueba y confirmar que falla**

Run: `node --test frontend/src/services/memoriaCalculoRangoOptimo.test.js`
Expected: FAIL con `SyntaxError` o `RUBROS_EXAMINADA is not exported` (la constante hoy es privada del módulo).

- [ ] **Step 3: Exportar la constante**

En `frontend/src/services/memoriaCalculoRangoOptimo.js:85`, cambiar:

```js
const RUBROS_EXAMINADA = [
```

por:

```js
export const RUBROS_EXAMINADA = [
```

No cambiar nada más del arreglo: las seis filas y sus etiquetas ya existen tal cual las espera la prueba.

- [ ] **Step 4: Correr la prueba y confirmar que pasa**

Run: `node --test frontend/src/services/memoriaCalculoRangoOptimo.test.js`
Expected: PASS, y las pruebas ya existentes del archivo siguen en verde (la exportación no cambia el comportamiento interno del módulo).

- [ ] **Step 5: Correr la suite completa antes de comprometer**

Run: `npm test`
Expected: los ~895+1 casos en verde.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/services/memoriaCalculoRangoOptimo.js frontend/src/services/memoriaCalculoRangoOptimo.test.js
git commit -m "feat: exportar RUBROS_EXAMINADA para reutilizar sus etiquetas fuera del módulo"
```

---

### Task 2: Agregar las seis casillas a "3. Ingesta Estados financieros"

**Files:**
- Modify: `frontend/src/components/IngestaCifras.jsx:1-45` (import + nueva lista) y `:499-525` (JSX de la sección "Cifras del Estado de Situación Financiera")

**Interfaces:**
- Consumes: `RUBROS_EXAMINADA` de `../services/memoriaCalculoRangoOptimo.js` (Task 1); `handleFieldChange(clave, valor)` y `CampoMoneda` ya existentes en el propio archivo — mismo contrato que usan hoy `t_ar`/`t_inv`/`t_ap`/`t_act_curr`/`t_ppe`.
- Produces: nada que otro archivo consuma — es la hoja final de la cadena de edición.

- [ ] **Step 1: Importar `RUBROS_EXAMINADA` y derivar la lista de rubros adicionales**

En `frontend/src/components/IngestaCifras.jsx`, junto al resto de imports (cerca de la línea 17), agregar:

```js
import { RUBROS_EXAMINADA } from '../services/memoriaCalculoRangoOptimo.js';
```

Después de la definición de `RUBROS_BALANCE` (línea 32-43), agregar:

```js
/* Los seis rubros que el Excel Soporte Motor ya publica (hoja Datos, columna A.V.) pero
   que hasta ahora ningún punto de la interfaz permitía corregir: solo los escribía la
   lectura del documento, y esta no los toma (ver `CAMPO_POR_RUBRO` en eeffParser.js), así
   que quedaban siempre en 0,00. No alimentan la utilidad operacional ni los ajustes de
   capital de trabajo — solo el Análisis Vertical de la hoja Datos y del ANEXO A/Tabla 10.

   Las etiquetas se toman de `RUBROS_EXAMINADA` y no se repiten aquí a mano: es la misma
   fila que el Excel escribe, y una etiqueta distinta en los dos sitios confundiría a quien
   audite el libro contra la pantalla. */
const CLAVES_BALANCE_ADICIONALES = ['t_cash', 't_inv_assoc', 't_tax', 't_intang', 't_dif', 't_act_nocurr'];
const RUBROS_BALANCE_ADICIONALES = CLAVES_BALANCE_ADICIONALES.map(
  (clave) => RUBROS_EXAMINADA.find((r) => r.clave === clave),
);
```

- [ ] **Step 2: Renderizar las nuevas casillas**

En la sección "Cifras del Estado de Situación Financiera" (`frontend/src/components/IngestaCifras.jsx:499-525`), después del `</div>` que cierra el grid de `RUBROS_BALANCE.map(...)` (línea 524) y antes del `</div>` que cierra la tarjeta (línea 525), agregar:

```jsx
          <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800">
            <p className="text-xs text-zinc-500 leading-relaxed mb-3">
              Estos rubros no cambian la utilidad ni los ajustes de capital de trabajo: solo
              alimentan el Análisis Vertical de la hoja Datos del Excel de soporte y del
              ANEXO A / Tabla 10. La lectura del documento no los completa todavía —
              escríbalos a mano si el balance los trae.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {RUBROS_BALANCE_ADICIONALES.map(({ clave, etiqueta }) => (
                <div key={clave} className="flex flex-col">
                  <label className="text-xs font-semibold text-zinc-500 mb-1.5">{etiqueta}</label>
                  <CampoMoneda
                    value={study[clave] ?? ''}
                    onChange={(v) => handleFieldChange(clave, v)}
                    placeholder="COP"
                    className={CLASE_CASILLA}
                  />
                </div>
              ))}
            </div>
          </div>
```

No hace falta ningún cambio en `handleFieldChange`: estas seis claves no están en `INSUMOS_UTILIDAD` ni en `CAMPOS_RELACIONADAS_APRENDIBLES`, así que caen directo en `updateStudy(cambios)` (línea 102) — la misma ruta en vivo que ya usa `t_ar`.

- [ ] **Step 3: Verificar en el navegador**

Run: `npm run dev --prefix frontend`

1. Abrir un estudio existente (o crear uno) y entrar a "3. Ingesta Estados financieros".
2. Confirmar que aparecen las seis casillas nuevas bajo "Cifras del Estado de Situación Financiera", con las mismas etiquetas que trae la hoja Datos del Excel (Efectivo y equivalentes de efectivo, Inversiones asociadas, Activos por impuestos corrientes, Intangibles, Diferidos, Total, Activos no corrientes).
3. Escribir un valor en "Efectivo y equivalentes de efectivo" y confirmar en React DevTools (o con un `console.log(study.t_cash)` temporal en `ReporteGenerador.jsx`) que el cambio queda en el `study` inmediatamente, sin recargar.
4. Esperar el retardo del autoguardado y recargar la página: el valor debe seguir ahí (confirma persistencia en `localStorage`/Firestore, no solo en el estado de React).
5. Descargar el Excel Soporte Motor (Motor de Comparables) y confirmar que la hoja Datos ya no muestra 0,00 en esas filas, sino el valor recién escrito, y que su columna de Análisis Vertical (%) ahora sí se relaciona con el total de activos.
6. Confirmar que la Utilidad Operacional y el margen que se muestran en la propia ingesta **no cambiaron** al escribir estos seis valores — es la verificación de que siguen sin intervenir en el margen.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/IngestaCifras.jsx
git commit -m "feat: permitir corregir en la ingesta los seis rubros de balance que solo llegaban al Excel en cero"
```
