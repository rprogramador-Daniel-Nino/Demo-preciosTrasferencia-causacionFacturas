# Mejorar con IA el texto de secciones tomadas del informe anterior — Design

## Contexto

En el módulo 8 (comparables) existe el panel **«📐 Estructura y extensión del informe anterior»**
(`_ui()` en `index.html`/`public/index.html`, IIFE de las líneas ~10727-11249). Levanta el esqueleto
de secciones del informe del año gravable anterior, compara su extensión con la del informe en
curso y, por cada sección ausente o corta, muestra un botón **«📋 Copiar del anterior»**
(`ptUsarSeccionAnterior(secId)`) que hoy **copia literalmente** el texto de esa sección del año
anterior (`ptExtraerTextoSeccionAnterior`) y lo inyecta en el informe actual vía
`window.PT_SECCIONES_INYECTADAS` + `ptAplicarSeccionesInyectadas()`. Existe también un botón masivo
**«⚡ Usar texto anterior en todas las ausentes (0%)»** (`ptCompletarTodasAusentesAnterior()`) que
llama a la misma función para cada sección ausente.

El problema: copiar el texto tal cual dejaría en el informe del año en curso cifras, años y hechos
del período anterior. El objetivo de este cambio es que, en vez de copiarlo literal, el texto
anterior se use como **base de redacción** que Gemini actualiza y mejora para el año actual,
usando los datos ya disponibles del estudio en curso, y que el resultado sea el que finalmente
quede insertado en el informe (reutilizando la misma tubería de inyección que ya existe).

## Alcance

- Editar `index.html` y `public/index.html` por igual (hoy son idénticos y se mantienen en sync
  commit a commit).
- No se toca `server.js` / `functions/index.js`: el endpoint `/api/gemini` ya existe y ya se usa
  para otras llamadas del mismo tipo (`extractPriorActivityWithGemini`,
  `ptExtraerComparablesEstudioAnteriorWithGemini`) — se reutiliza tal cual.
- No se toca el mecanismo de inyección en el informe (`PT_SECCIONES_INYECTADAS`,
  `ptAplicarSeccionesInyectadas`, `renderReport`) — sigue siendo el único camino por el que el
  texto llega al `#doc` del informe final.

## Diseño

### 1. Separar extracción de texto plano y envoltorio HTML

`ptExtraerTextoSeccionAnterior(secId)` hoy mezcla dos responsabilidades: extraer el texto crudo de
la sección del informe anterior (o el texto de reemplazo por defecto cuando no hay informe
anterior cargado) y convertirlo a HTML de informe (`<h3 class="rep">`/`<p class="norm">` por
línea). Se separa en:

- `ptExtraerTextoPlanoSeccionAnterior(secId)` → devuelve el texto crudo (string) o `null`. Contiene
  toda la lógica actual de localización por páginas/regex/plantilla por defecto.
- `ptTextoPlanoAHtmlSeccion(texto)` → aplica la lógica de líneas → encabezado/párrafo que hoy vive
  al final de `ptExtraerTextoSeccionAnterior`.
- `ptExtraerTextoSeccionAnterior(secId)` queda como función delgada: llama a las dos anteriores en
  secuencia (se conserva para no romper otros usos ni cambiar su contrato existente).

Esto permite obtener el texto plano tanto para la copia literal (comportamiento interno de
respaldo/depuración) como para mandarlo de base a Gemini, y reusar el mismo envoltorio HTML para
lo que Gemini devuelva.

### 2. Nueva función `ptMejorarSeccionConIA(secId, btnEl)`

Sustituye el cuerpo actual de `window.ptUsarSeccionAnterior`. Firma:
`window.ptUsarSeccionAnterior = async function (secId, btnEl) { ... }` (se conserva el nombre para
no tener que tocar los call sites existentes; `btnEl` es un segundo parámetro opcional nuevo con el
botón que disparó la acción, para poder mostrar el estado de carga).

Pasos:

1. Si `btnEl`: guardar su texto original, ponerlo en `disabled = true` y texto `⏳ Mejorando…`.
2. `var textoBase = ptExtraerTextoPlanoSeccionAnterior(secId);` — si es `null` o `< 20` caracteres,
   restaurar el botón, `moToast('No se pudo extraer el texto de «'+nom+'» del informe anterior.', 'red')`
   y devolver `false` (idéntico al comportamiento actual de fallo).
3. Construir el prompt (ver plantilla abajo) con: `textoBase`, `ptContextoCompleto()` (recortado a
   20000 caracteres, mismo criterio de tamaño que usa `redaccionIA` con 45000 para su contexto más
   grande), el nombre de la sección (`item.nom`) y `N = textoBase.trim().length` (la extensión
   objetivo que se pide conservar es la del propio texto base, no un valor aparte).
4. Llamar a `/api/gemini` con el mismo shape que usa `extractPriorActivityWithGemini`:
   `fetch('/api/gemini', {method:'POST', headers:{'Content-Type':'application/json'},
   body: JSON.stringify({contents:[{parts:[{text: prompt}]}]})})`.
5. Extraer el texto de la respuesta (`data.candidates[0].content.parts[...].text`), igual que en
   `extractPriorActivityWithGemini`; si no hay `res.ok` o no hay texto, lanzar error con el mensaje
   de `data.error` cuando exista.
6. `var j = extraerJSONDeRespuestaIA(raw);` y tomar `j.texto`. Si no hay `j.texto` con al menos 20
   caracteres, tratarlo como error (mismo criterio de longitud mínima que el paso 2).
7. Control anti-alucinación: se expone `window.ptVerificarCifras = verificarCifras;` junto a la
   definición existente de `verificarCifras` en el módulo de redacción-IA (viven en IIFEs distintos,
   así que no es visible por closure) y se llama desde aquí como
   `var ajenas = window.ptVerificarCifras(j.texto, textoBase + '\n' + ptContextoCompleto());`. Si
   `ajenas.length`, `moToast('El texto mejorado de «'+nom+'» contiene cifras que no constan en el texto anterior ni en el estudio actual: '+ajenas.join(', '), 'amber')` — se inserta igual (mismo criterio que ya sigue `redaccionIA`: avisar, no bloquear).
8. `var html = ptTextoPlanoAHtmlSeccion(j.texto);` y desde aquí en adelante, el mismo flujo que hoy:
   guardar en `PT_SECCIONES_INYECTADAS[secId]`, `ptAplicarSeccionesInyectadas()`,
   `ptCompararExtension()`, `ptPintarEstructura()`.
9. Toast verde: `'Sección «'+nom+'» mejorada con IA a partir del informe anterior.'`
10. En caso de error en cualquier punto (catch general alrededor de 3-8): si `btnEl`, restaurar su
    texto y estado habilitado; `moToast('No se pudo mejorar «'+nom+'» con IA: '+e.message, 'red')`;
    devolver `false`. **No hay respaldo a copia literal** (confirmado con el usuario: si Gemini
    falla, no se inserta nada).

Plantilla de prompt:

```
Eres especialista en precios de transferencia en Colombia. Tu tarea es ACTUALIZAR y MEJORAR
el texto de la sección «{nom}» del informe de precios de transferencia, tomando como BASE el
texto de esa misma sección en el informe del año gravable anterior, y adaptándolo al informe
del año gravable actual con los datos del estudio en curso.

REGLAS INQUEBRANTABLES:
1. Parte del texto anterior como base de redacción, estilo y estructura, pero AJUSTA cifras,
   años, nombres y hechos a los datos del CONTEXTO ACTUAL cuando ese contexto traiga el dato
   correspondiente.
2. No inventes cifras, hechos ni nombres que no consten ni en el texto anterior ni en el
   contexto actual. Si falta un dato para completar la actualización, escribe exactamente:
   "[dato pendiente de confirmar con el contribuyente]" en su lugar.
3. Conserva una extensión y nivel de detalle equivalentes a los del texto anterior (aprox.
   {N} caracteres) y el mismo tono técnico de un informe tributario.
4. Redacta en español, en tercera persona, en prosa, sin viñetas.

TEXTO DE LA SECCIÓN «{nom}» EN EL INFORME DEL AÑO ANTERIOR (base a mejorar):
---
{textoBase}
---

CONTEXTO DEL ESTUDIO DEL AÑO GRAVABLE ACTUAL:
---
{contexto recortado a 20000 caracteres}
---

Devuelve ÚNICAMENTE un JSON válido, sin marcas markdown, sin texto antes ni después:
{"texto":"..."}
```

### 3. Botón individual

En `ptPintarEstructura()`, el botón de cada fila pasa de:

```html
<button ... onclick="ptUsarSeccionAnterior('ID')">📋 Copiar del anterior</button>
```

a:

```html
<button ... onclick="ptUsarSeccionAnterior('ID', this)">🤖 Mejorar con IA (base: anterior)</button>
```

Mismo color/estilo actual (`background:#1E8449`). El único cambio funcional es pasar `this` para
que la función pueda mostrar el estado de carga en el propio botón.

### 4. Botón masivo

`window.ptCompletarTodasAusentesAnterior` pasa a ser `async` y a procesar las secciones ausentes
**secuencialmente** (no en paralelo), para no saturar la API y para poder mostrar progreso:

```js
window.ptCompletarTodasAusentesAnterior = async function () {
  // ... misma validación inicial de X.filas que hoy ...
  var ok = 0, fail = [];
  for (var i = 0; i < ausentes.length; i++) {
    var f = ausentes[i];
    moToast('Mejorando «' + f.nom + '» con IA… (' + (i + 1) + '/' + ausentes.length + ')', 'amber');
    var r = await window.ptUsarSeccionAnterior(f.id);
    if (r) ok++; else fail.push(f.nom);
  }
  if (ok) moToast('Se mejoraron con IA ' + ok + ' de ' + ausentes.length + ' sección(es)' +
    (fail.length ? '; fallaron: ' + fail.join(', ') : '') + '.', fail.length ? 'amber' : 'green');
  else moToast('No se pudo mejorar ninguna sección con IA.', 'red');
};
```

El botón que lo dispara (`_ui()`) cambia su texto de
«⚡ Usar texto anterior en todas las ausentes (0%)» a
«⚡ Mejorar con IA todas las ausentes (0%)», sin cambiar `onclick="ptCompletarTodasAusentesAnterior()"`.

### 5. Flujo de datos hacia el informe final

Sin cambios: `PT_SECCIONES_INYECTADAS[secId]` sigue siendo HTML aplicado por
`ptAplicarSeccionesInyectadas()` cada vez que corre `renderReport()`, que es lo que hoy pone el
texto (antes copiado literal, ahora mejorado por IA) dentro de `#doc`. No se requiere ningún cambio
en la exportación a Word ni en el render del informe: siguen leyendo el mismo `#doc`.

## Manejo de errores

| Caso | Comportamiento |
|---|---|
| No hay texto anterior extraíble (`ptExtraerTextoPlanoSeccionAnterior` devuelve `null`/vacío) | Toast rojo, no llama a Gemini, no inserta nada (igual que hoy). |
| Gemini responde error HTTP o sin candidatos | Toast rojo con el mensaje de error, no inserta nada, botón vuelve a su estado normal. |
| Gemini responde texto que no es JSON parseable ni con `extraerJSONDeRespuestaIA` | Se trata igual que el caso anterior (toast rojo, sin inserción). |
| Gemini responde `{"texto":""}` o con menos de 20 caracteres | Se trata como error (toast rojo, sin inserción) — evita insertar una sección vacía. |
| El texto devuelto trae cifras ajenas al texto anterior + contexto actual | Se inserta igual, con toast ámbar de advertencia (no bloquea). |
| Botón masivo: una sección falla | Se salta, sigue con las siguientes, se reporta en el resumen final. |

## Pruebas

Este proyecto no tiene suite de pruebas automatizadas para el frontend (un solo HTML con `<script>`
inline). Verificación:

1. Chequeo de sintaxis: parsear cada bloque `<script>` de `index.html`/`public/index.html` con
   `node -e "new Function(...)"` (mismo criterio ya usado en el plan previo de este módulo) para
   descartar errores de JS antes de probar en navegador.
2. Prueba manual en navegador: cargar un informe anterior, levantar la estructura, pulsar el botón
   individual de una sección ausente/corta y confirmar que (a) se ve el estado de carga, (b) sale
   la llamada de red a `/api/gemini`, (c) el texto insertado en el informe difiere del texto
   literal anterior (está adaptado), (d) aparece en el `#doc` del informe.
3. Prueba manual del botón masivo con al menos 2 secciones ausentes, confirmando el progreso
   sección por sección y el resumen final.
4. Prueba manual del camino de error: forzar un fallo (p. ej. desconectar el proxy o provocar un
   422) y confirmar que no se inserta nada y se ve el toast rojo, tanto en el botón individual como
   en uno de los pasos del botón masivo.

## Fuera de alcance

- No se agrega ninguna marca visual en el informe final indicando qué secciones fueron generadas
  por IA (no se pidió, y el resto del sistema tampoco lo hace para `redaccionIA`).
- No se cambia el comportamiento cuando no hay informe anterior cargado (sigue usando la plantilla
  de reemplazo por defecto ya existente en `ptExtraerTextoPlanoSeccionAnterior`, que ahora
  también se envía a Gemini como base a mejorar en lugar de insertarse literal).
