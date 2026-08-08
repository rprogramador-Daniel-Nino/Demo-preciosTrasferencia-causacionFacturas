# Anexo B: reemplazar la tabla transcrita de cifras por la imagen del EEFF

**Fecha:** 2026-08-06
**Estado:** Aprobado, pendiente de plan de implementación
**Supersede parcialmente:** `2026-08-04-anexo-b-comparables-design.md` (Partes A.1-A.3 y C —
las tablas 2 y 3 de cifras que ese spec diseñó). La Parte B (redacción de la descripción de
actividad, tabla 1) y el resto de la arquitectura de ese spec no cambian.

## Problema

El Anexo B ("Descripciones de comparables y Estados Financieros") pinta, por cada comparable,
tres tablas: nombre+descripción (texto), y dos tablas de cifras (P&L y balance) construidas a
partir de lo que Gemini OCR leyó del EEFF cargado en el Paso 4
(`frontend/src/services/eeffParser.js`, `EEFF_COMPARABLE_PROMPT`/`EEFF_COMPARABLES_LOTE_PROMPT`)
y que `generarBloqueComparableAnexoB` (`exactTemplateMapper.js:523-546`) formatea con `fmt()`.

`fmt()` redondea a 0 decimales, así que una cifra como 28,81 sale como 29 en el documento final.
Comparado contra el EEFF original que el analista subió, el número "cambió". El riesgo de fondo
no es solo el redondeo: es cualquier lectura de Gemini que no coincida exactamente con el
documento fuente, en un informe que se radica ante la DIAN.

Decisión: en vez de seguir transcribiendo cifras vía OCR a una tabla HTML, se incrusta como
imagen la página original del EEFF que el analista ya subió en el Paso 4 — el mismo patrón que
ya usa el ANEXO A (`generarAnexoAHtml`, `exactTemplateMapper.js:455-483`) para el EEFF del propio
contribuyente.

## Alcance

Dentro de esta entrega:
- Rasterizar a imagen el EEFF de cada comparable cargado en el Paso 4 (fila individual o lote) y
  persistirlo fuera de Firestore, igual que ya se hace para el ANEXO A.
- Reemplazar las tablas 2 y 3 (P&L y balance) de `generarBloqueComparableAnexoB` por esas
  imágenes. La tabla 1 (nombre + descripción, Parte B del spec 2026-08-04) no cambia.
- Cuando el EEFF de una comparable llega en un PDF de lote que trae varias empresas, recortar el
  rasterizado para que el bloque de cada comparable muestre solo sus propias páginas.
- Reintento del rasterizado ante fallo transitorio, antes de degradar al aviso de "no se pudo
  adjuntar".

Fuera de alcance:
- Eliminar la lectura de Gemini OCR de estos documentos. Se conserva para el cruce automático
  con la fila correcta y la validación contable (`verifyAccountingEqualities`) — ver Decisiones,
  punto 4.
- Cambios a `index.html` (raíz). Todo el trabajo es en `frontend/`.
- Tocar la tabla 1 (nombre + descripción) o `descripcionComparables.js` — sin cambios.
- Recalcular o promediar cifras de balance — no aplica: ya no hay cifras en el Anexo B.

## Decisiones (confirmadas con el usuario)

1. **Documento completo, no solo la página de las tablas.** Cuando el EEFF de una comparable
   tiene varias páginas y el archivo pertenece a una sola empresa (carga por fila), se incrustan
   TODAS sus páginas, en orden — igual que ya hace el ANEXO A con el EEFF del contribuyente.
2. **Persistencia en el mismo almacén IndexedDB que el ANEXO A**, como un mapa por comparable en
   vez de un arreglo plano por estudio (ver Parte B).
3. **PDF de lote con varias empresas: recortar por empresa.** Si un solo PDF trae los EEFF de 3
   comparables, el bloque de cada una en el Anexo B muestra solo sus páginas — nunca las de las
   otras dos.
4. **Se conserva el OCR de Gemini** para cruzar el documento con la fila correcta y validar
   consistencia contable, aunque esas cifras ya no pinten ninguna tabla del informe. Además, en
   la carga de lote, esa misma lectura es la que determina qué páginas del PDF le pertenecen a
   cada empresa (ver Parte A.2).
5. **Reintento ante fallo del rasterizado** (agregado en la ronda de aprobación de este spec):
   antes de degradar al aviso de "no se pudo adjuntar", se reintenta.

## Parte A — Captura en el Paso 4 (`MotorComparables.jsx`, `eeffParser.js`)

### A.1 Carga por fila (`handleComparableEEFFUpload`)

Sin cambios en la llamada a `parseEEFFComparableOCR` (cruce + verificación, igual que hoy).
Se agrega, en paralelo:

```js
const imagenes = await rasterizarConReintento(file);
```

`rasterizarConReintento` es una función nueva en `pdfRenderer.js` que envuelve
`convertPdfToImages`: hasta 2 reintentos con una espera corta (p. ej. 1 s) entre intentos —
rasterizar es trabajo local de CPU (canvas/pdf.js), no una llamada de red, así que no aplica el
backoff exponencial que usa `postGeminiWithRetry` para errores HTTP transitorios. Si los 3
intentos devuelven `[]` o lanzan, se resuelve a `[]` y el llamador decide el aviso (ver Parte C).

El archivo pertenece 100% a esta fila (decisión 1), así que **todas** las páginas rasterizadas
se guardan bajo el `nameKey` de esa comparable — no hay recorte.

### A.2 Carga en lote (`handleCargaMasivaEEFF`, `parseEEFFComparablesLote`)

`EEFF_COMPARABLES_LOTE_PROMPT` (`eeffParser.js`) agrega dos campos numéricos al JSON que ya
devuelve por empresa:

```
"pagina_inicio": 1,   // primera página (1-indexada) del PDF donde aparecen sus EEFF
"pagina_fin": 1       // última página (1-indexada); igual a pagina_inicio si es una sola
```

Regla agregada al prompt: estas dos páginas son sobre el PDF COMPLETO tal como se envió, no un
conteo relativo a la empresa. Si el documento no permite determinarlas con certeza, devolver
`null` en ambas — no estimar.

`parseEEFFComparablesLote` devuelve `paginaInicio`/`paginaFin` junto a `datos`/`verificacion` por
empresa (mismo objeto que ya arma esa función, dos campos más).

En `handleCargaMasivaEEFF`: por cada archivo se rasteriza una sola vez
(`rasterizarConReintento(file)`), y por cada empresa que cruzó con una fila
(`aplicadas`, ver `repartir` en `cruceComparables.js`) se recorta ese arreglo con
`paginaInicio`/`paginaFin` (ambos 1-indexados; `slice(paginaInicio - 1, paginaFin)`).

Si `paginaInicio`/`paginaFin` son `null`, están fuera del rango de páginas reales del documento,
o `paginaInicio > paginaFin`: no se descarta la imagen. Se adjunta el PDF completo rasterizado a
esa comparable, y se agrega a `resultadoCarga` el aviso "no se pudo delimitar la página de esta
empresa dentro del documento; se adjuntó el PDF completo — revisar que no incluya páginas de
otras comparables."

### A.3 Función `rasterizarConReintento` (`pdfRenderer.js`)

```js
export async function rasterizarConReintento(file, intentos = 3) {
  let ultimoError;
  for (let i = 1; i <= intentos; i++) {
    try {
      const imagenes = await convertPdfToImages(file);
      if (imagenes.length) return imagenes;
      ultimoError = new Error('convertPdfToImages devolvió un arreglo vacío');
    } catch (err) {
      ultimoError = err;
    }
    if (i < intentos) await new Promise((r) => setTimeout(r, 1000));
  }
  console.error('[rasterizarConReintento] agotados los intentos:', ultimoError);
  return [];
}
```

No relanza: el llamador siempre recibe un arreglo (posiblemente vacío) y decide el aviso.

## Parte B — Persistencia (`plantillaStore.js`, `firestoreModelo.js`, `App.jsx`)

### B.1 Nuevo par de funciones en `plantillaStore.js`

Mismo almacén `anexos` que ya usa `guardarAnexoEeff`/`leerAnexoEeff` (ANEXO A) — no se crea
ningún almacén ni se sube `VERSION` del esquema IndexedDB. Clave distinta para no colisionar:

```js
export const guardarAnexoBImagenes = (estudioId, mapaPorComparable) =>
  operar('anexos', 'readwrite', (s) => s.put(mapaPorComparable, esc(estudioId) + ':cmpB'));

export const leerAnexoBImagenes = (estudioId) =>
  operar('anexos', 'readonly', (s) => s.get(esc(estudioId) + ':cmpB')).then((r) => r || {});
```

`mapaPorComparable` tiene la forma `{ [nameKey]: string[] }` (arreglo de data URLs PNG, mismo
formato que ya produce `convertPdfToImages`/`eeffImages`).

`borrarRecursosDelEstudio` (línea 185) se extiende para borrar también esta clave al borrar un
estudio — mismo criterio que ya aplica a la clave del ANEXO A.

### B.2 Campo local-only en el estudio

Se agrega `eeffImagenesComparables` a `CAMPOS_SOLO_LOCALES` en `firestoreModelo.js` (línea 97),
junto a `eeffImages` — mismo motivo: pesa demasiado para el límite de 1 MiB por documento de
Firestore. `App.jsx` lo carga (`leerAnexoBImagenes`) y lo guarda (`guardarAnexoBImagenes`) en los
mismos efectos que ya hacen esto para `eeffImages` (líneas ~137, ~197-198, ~232-243).

Se indexa por `nameKey(comp.name)` (`comparablesEngine.js`), el identificador que ya usa el resto
del módulo para cruzar comparables entre EEFF compartidos y catálogo histórico — no por `id`,
que no todas las filas tienen garantizado (p. ej. las agregadas a mano con `addComparable` sí,
pero conviene no depender de eso).

## Parte C — Render (`exactTemplateMapper.js`)

### C.1 `generarBloqueComparableAnexoB(comp, year, wrap, imagenes)`

Firma nueva: recibe `imagenes` (el arreglo de esa comparable, ya resuelto por el llamador desde
`study.eeffImagenesComparables[nameKey(comp.name)]`).

- Tabla 1 (nombre + descripción): sin cambios.
- Si `imagenes.length > 0`: en vez de las tablas 2 y 3, se pintan como `<img>` con el mismo
  estilo que usa `generarAnexoAHtml` (`max-width:100%`, borde, sombra suave), una por página.
- Si `imagenes.length === 0`: párrafo "Pendiente: vuelva a cargar el Estado Financiero de esta
  comparable en el Paso 4 del motor de comparables." — no se cae de vuelta a las tablas viejas de
  cifras (evita mantener dos caminos de render en paralelo).

`ANEXO_B_ETIQUETAS_PL`, `ANEXO_B_ETIQUETAS_BALANCE` y `filasOpcionalesPL` (líneas 491-518) se
eliminan: ya no las usa nadie.

### C.2 `generarAnexoBHtml(study, year, wrap)`

Pasa a recibir también `imagenesPorComparable` (el mapa completo), y lo indexa por
`nameKey(c.name)` al llamar a `generarBloqueComparableAnexoB` por cada fila. El filtro de qué
comparables entran (`c && c.name && c.eeffArchivo`) no cambia.

### C.3 `hydrateExactWordTemplate`

El único cambio es pasar `study.eeffImagenesComparables` (ya cargado por `App.jsx` en el estudio,
Parte B.2) hasta `generarAnexoBHtml`/`reemplazarAnexoB`.

## Manejo de errores (resumen)

| Falla | Efecto |
|---|---|
| `convertPdfToImages` falla tras los reintentos | Cifras/cruce se aplican igual; aviso en `resultadoCarga`: "no se pudieron adjuntar las páginas del EEFF para el ANEXO B; las cifras se aplicaron igual." |
| Rango de página ausente/inválido en carga de lote | Se adjunta el PDF completo a esa comparable; aviso de posible contaminación con páginas de otras empresas. |
| Sin `nameKey`/nombre | Se descarta, mismo aviso que ya usa `parseEEFFComparablesLote` para filas sin razón social. |
| `guardarAnexoBImagenes` lanza (IndexedDB no disponible, cuota) | No relanza; ese comparable queda sin imagen para el Anexo B, el resto del estudio sigue funcionando — mismo criterio que ya usan `guardarRecursos`/`guardarAnexoEeff`. |
| Estudio ajeno (solo lectura) | No se escribe nada en IndexedDB, igual que hoy para el resto del autoguardado. |

## Testing

Sigue el patrón ya establecido (`node --test`, cubierto por el glob de la raíz que ya incluye
`frontend/src/services/*.test.js` — ver `package.json` raíz, script `test`):

- `plantillaStore.test.js`: `guardarAnexoBImagenes`/`leerAnexoBImagenes` — guardar y leer el
  mapa, clave distinta de `guardarAnexoEeff` (no colisiona), lectura vacía cuando no existe,
  `borrarRecursosDelEstudio` también borra esta clave.
- `pdfRenderer.test.js` (nuevo): `rasterizarConReintento` reintenta ante `[]`/excepción y se
  resuelve a `[]` tras agotar los intentos, sin relanzar.
- `eeffParser.test.js`: `parseEEFFComparablesLote` devuelve `paginaInicio`/`paginaFin` por
  empresa; casos con rango ausente/inválido no rompen el parseo.
- `exactTemplateMapper.test.js`: `generarBloqueComparableAnexoB` pinta `<img>` cuando hay
  imágenes, conserva la tabla 1 intacta, cae al mensaje de pendiente sin imágenes, y ya no
  produce las tablas 2/3 de cifras en ningún caso.

Fuera de test automatizado (la UI de React no tiene tests, ver CLAUDE.md): prueba manual en el
navegador — subir un EEFF de una sola comparable, subir un lote con 2-3 empresas en un solo PDF,
y exportar el Word verificando que cada bloque del Anexo B muestre solo sus propias páginas.

## Riesgos / notas

- El recorte por rango de página (A.2) depende de que Gemini identifique correctamente los
  límites de cada empresa dentro del PDF de lote. Es una lectura más sobre el mismo documento que
  ya se envía hoy (no una llamada adicional), pero es la pieza menos probada de este diseño — si
  en la práctica falla seguido, el degradado (PDF completo con aviso) es el piso, no un bloqueo.
- Migración: estudios que ya tienen comparables con `eeffDatos`/tablas viejas pero nunca
  recargaron el EEFF bajo este esquema mostrarán el aviso de "Pendiente" en el Anexo B hasta que
  alguien vuelva a subir el documento en el Paso 4. No hay backfill automático — implica volver
  a leer archivos que ya no están en memoria del navegador (solo se guardó `eeffDatos`, nunca el
  archivo original).
