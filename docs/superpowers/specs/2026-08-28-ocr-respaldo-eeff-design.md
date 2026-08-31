# Diseño — OCR de respaldo para páginas de EEFF sin capa de texto

Fecha: 2026-08-28

## De dónde sale este diseño

Analizando 4 PDFs reales que el usuario reportó como fuente de "datos incorrectos o
faltantes" (Helios, HH Colombia, Inoxpa, Avgus), se diagnosticó con un script ad hoc
(`pdfjs-dist`, ya dependencia del repo) qué capa de texto le llega hoy al modelo:

- **HH Colombia** — tenía causa raíz de prompt (partidas de partes relacionadas repartidas
  en fila corriente y no corriente); ya corregido, no es parte de este diseño.
- **Helios** — el PDF no tiene NINGUNA capa de texto: `content.items.length === 0` en las 5
  páginas. Escaneo puro.
- **Inoxpa** — documento mixto de 29 páginas: 1-2, 20-22 traen texto (balance, P&G),
  3-19 y 23-29 (las notas, donde vive casi cualquier desglose de partes relacionadas) son
  escaneo puro. Ninguna palabra "vinculad*"/"relacionad*" aparece en el texto extraíble.
- **Avgus** — texto de prosa con palabras pegadas por el criterio ya documentado de
  `unirTrozos`/`FACTOR_MISMA_CELDA`; sin evidencia de que rompa una cifra real. No es parte
  de este diseño (ver "Fuera de alcance").

Además, se encontró que `verificarEeff()` ya calcula `verificadoContraTexto`
(`eeffVerificacion.js:202`) pero **la UI nunca lo leía** — un documento 100% escaneado se
veía en pantalla igual que uno verificado cifra por cifra. Eso ya se corrigió por separado
(aviso ámbar en `IngestaCifras.jsx` cuando `verificadoContraTexto === false`).

**El problema que queda:** para Helios e Inoxpa, ese aviso es honesto pero no soluciona
nada — el analista sabe que no hay verificación, pero sigue sin ninguna. Este diseño ataca
eso: producir una capa de texto sintética, vía OCR, para las páginas que hoy no la tienen,
y usarla exactamente donde `eeffVerificacion.js` ya usa la capa nativa.

## Qué NO es este diseño

Se acordó explícitamente con el usuario, antes de diseñar, cuál de dos problemas se ataca:

- ❌ "Gemini no encuentra bien los datos en páginas escaneadas" — hoy `parseEeffWithGeminiOCR`
  ya manda el PDF completo como `inline_data` a Gemini (`eeffParser.js:439-440`), tenga o no
  capa de texto nativa. Un OCR paralelo no cambia qué tan bien lee esa llamada; si el
  problema fuera ese, la solución sería otra (mejor resolución de imagen, recortes, prompt).
- ✅ "No hay ninguna red de verificación para lo que Gemini ya devolvió en esas páginas" — el
  problema real, confirmado por el usuario. Este diseño produce una capa de texto **solo
  para alimentar la verificación cruzada que ya existe** (`cifraApareceEnTexto`), nunca para
  mejorar ni reemplazar la lectura principal.

Por eso el texto OCR **no se reenvía a la llamada principal de extracción** como si fuera
"exacto" (la forma en que `bloqueDeTexto` sí trata la capa nativa, con razón: viene del
propio PDF, no de una segunda IA). Se mantiene como una pieza aparte, consumida únicamente
por la verificación.

## Diseño

### 1. Detectar qué páginas no tienen texto utilizable

Nuevo export en `eeffTextoPdf.js`, sin tocar `extraerTextoPdf` (que sigue devolviendo
exactamente lo mismo que hoy — sus pruebas actuales no cambian):

```
paginasSinTextoUtilizable(file, { getDocument } = {}) → Promise<number[]>
```

Recorre las páginas (mismo patrón de apertura que `extraerTextoPdf`) y marca sin texto las
que no aportaron ningún fragmento (`contenido.items` vacío o solo con cadenas en blanco) —
cubre Helios (las 5) e Inoxpa (3-19, 23-29).

Caso aparte: si el documento entero falla el chequeo de confiabilidad que ya existe
(`textoEsConfiable`, el caso LATV — hay texto pero es basura porque las fuentes no traen
`ToUnicode`), `extraerTextoPdf` ya devuelve `''` para todo el documento. Cuando eso pasa,
`paginasSinTextoUtilizable` marca **todas** las páginas como sin texto, aunque
individualmente tuvieran fragmentos — un mismo mecanismo cubre los dos problemas reales
detectados (ausencia total de texto y texto ilegible), sin duplicar la heurística de
confiabilidad por página.

### 2. Rasterizar solo esas páginas

Nuevo export en `pdfRenderer.js`:

```
rasterizarPaginas(file, numerosPagina) → Promise<string[]>   // dataURLs, mismo orden que numerosPagina
```

Reusa el mismo render por canvas que ya usa `convertPdfToImages` (factorizado a un helper
compartido, `renderizarPagina(page, escala)`), pero solo para los números de página pedidos
— no rasteriza el documento completo.

### 3. La llamada de OCR

Nuevo módulo, `eeffOcrRespaldo.js` (mismo patrón de orquestación que
`notasEeffOrquestacion.js`: I/O inyectado, sin red real en las pruebas).

**El prompt** es deliberadamente angosto y honesto — transcripción, no interpretación:

```
Eres un transcriptor. Tu única tarea es transcribir LITERALMENTE cada cifra, palabra y
rótulo que veas en las imágenes adjuntas, en el orden en que aparecen, sin interpretar de
qué rubro se trata, sin clasificar, sin resumir y sin omitir nada.

Cada imagen es una página de un estado financiero o sus notas, indicada antes de la imagen
con su número real dentro del documento. Devuelve el texto de cada página por separado:

--- Página <N> ---
<texto transcrito, línea por línea>

Transcribe los números tal como están impresos, con los mismos separadores de miles y
decimales, con signo negativo si vienen entre paréntesis o con guion. Si algo es
ilegible, escribe [ilegible] en su lugar en vez de adivinar.
```

Una imagen por página marcada, cada una precedida por un `{text: "Página N del
documento:"}` para que el número no dependa de que Gemini cuente bien las imágenes. Una
sola llamada a `/api/gemini` (modelo `gemini-3.5-flash`, igual que el resto del flujo de
EEFF) — sin endpoint ni secreto nuevos.

**Límite duro:** `MAX_PAGINAS_OCR_RESPALDO = 30`. Inoxpa —el caso real más exigente de los
cuatro— necesita 24 páginas (3-19 y 23-29): el límite se fija por encima de eso, con margen,
en vez de un número redondo sin verificar contra el caso que motivó el diseño. Si
`paginasSinTextoUtilizable` devuelve más páginas que el límite (un documento largo
enteramente ilegible, un LATV mucho más extenso), el respaldo se salta por completo — el
documento queda exactamente como hoy (`verificadoContraTexto: false`, con su aviso), sin
disparar una petición desproporcionada.

### 4. Orquestación y dónde entra al flujo

```
reforzarVerificacionConOcr({
  file, lectura, verificacion, anioEstudio,
  diccionarioRelacionadaGlobal, rotulosConfirmadosEmpresa,
  paginasSinTexto = paginasSinTextoUtilizable,
  rasterizar = rasterizarPaginas,
  pedirOcr = pedirTranscripcionOcr,
}) → Promise<verificacion>
```

1. `paginas = await paginasSinTexto(file)`. Si está vacío, devuelve `verificacion` sin
   cambios — la inmensa mayoría de documentos (con texto nativo completo) no gasta nada.
2. Si `paginas.length > MAX_PAGINAS_OCR_RESPALDO`, devuelve `verificacion` sin cambios.
3. `imagenes = await rasterizar(file, paginas)`.
4. `textoOcr = await pedirOcr(imagenes, paginas)`.
5. Funde: `textoPdf = [lectura.textoPdf, textoOcr].filter(Boolean).join('\n\n')`.
6. Re-verifica: `return verificarEeff({ ...lectura, textoPdf }, { anioEstudio,
   diccionarioRelacionadaGlobal, rotulosConfirmadosEmpresa })` — mismo patrón que
   `resolverFaltantesConNotas` al fusionar y re-verificar.

Se llama desde `IngestaCifras.jsx`, como un paso hermano **después** de
`resolverFaltantesConNotas` (no depende de su resultado; el disparador es estructural —
páginas sin texto — no los campos que hayan quedado en `null`):

```
primeraVerificacion = verificarEeff(...)
verificacion = await resolverFaltantesConNotas(...)          // ya existe
verificacion = await reforzarVerificacionConOcr({ ...,       // nuevo
  verificacion, lectura: res })
```

`verificadoContraTexto` es simplemente `Boolean(textoPdf.trim())` (`eeffVerificacion.js:202`):
si el OCR devuelve algo, el `textoPdf` fusionado deja de estar vacío y pasa a `true` sin
necesidad de ninguna lógica adicional — el aviso ámbar agregado en el cambio anterior
desaparece solo, no hace falta tocar la UI de nuevo.

### 5. Errores

Mismo criterio que el resto de este archivo (`resolverFaltantesConNotas`,
`aprenderDeLecturaExitosa`): cualquier fallo (red, Gemini caído, límite de páginas, error de
rasterizado) se captura y devuelve la `verificacion` que ya había — nunca tumba la ingesta.

## Decisiones tomadas

| Decisión | Elegido | Por qué |
|---|---|---|
| Qué problema ataca | Solo reforzar la verificación cruzada, no mejorar la lectura principal | Confirmado con el usuario: Gemini ya ve las páginas escaneadas como imagen en la llamada principal; un OCR paralelo no cambia eso, sí puede darle a `eeffVerificacion.js` algo contra qué cotejar. |
| Alcance del OCR | Solo las páginas sin texto (no el documento completo) | Más preciso y barato que reenviar todo el PDF; evita depender de que Gemini no se salte páginas en un documento largo (Avgus, 51 páginas) — decisión explícita del usuario sobre las dos opciones presentadas. |
| Motor de OCR | Reutilizar Gemini vía `/api/gemini` | Ya es el motor de OCR/lectura de documentos de la app (más barato, según CLAUDE.md); Tesseract.js es una dependencia nueva y pesada, Google Cloud Vision exige un endpoint y un secreto nuevos duplicados en tres backends. Ninguno se justifica solo para este refuerzo. |
| El texto OCR, ¿se reenvía a la extracción principal? | No — solo alimenta la verificación | Es una segunda lectura de IA, no el texto nativo del documento; tratarlo como "exacto" en el prompt principal (como sí hace `bloqueDeTexto` con la capa nativa) sería engañoso y podría encadenar una alucinación sobre otra. |
| Página con fuente sin `ToUnicode` (documento entero) | Tratar TODAS las páginas como sin texto | Mismo mecanismo que ya cubre Helios/Inoxpa, sin duplicar la heurística de confiabilidad por página — evita over-engineering para un caso (garbage por página individual) que no se ha observado. |
| Límite de páginas por llamada | `MAX_PAGINAS_OCR_RESPALDO = 30` | Evita una petición desproporcionada en un documento largo enteramente ilegible; se degrada al comportamiento actual (aviso, sin OCR) en vez de fallar o disparar un costo alto sin control. |
| Dónde entra al flujo | Paso nuevo en `IngestaCifras.jsx`, después de `resolverFaltantesConNotas`, disparado por `verificadoContraTexto`, no por campos en `null` | Es un problema estructural del documento (¿hay texto o no?), independiente de qué campos haya resuelto o no el fallback de notas. |
| Cambios de UI | Ninguno nuevo | El aviso ámbar ya agregado se apaga solo cuando `verificadoContraTexto` vuelve a `true`. |

## Contrato de datos — qué cambia

- `eeffTextoPdf.js`: nuevo export `paginasSinTextoUtilizable(file, { getDocument } = {})`.
  `extraerTextoPdf` y `contarPaginasPdf` no cambian.
- `pdfRenderer.js`: nuevo export `rasterizarPaginas(file, numerosPagina)`; `convertPdfToImages`
  se refactoriza internamente para compartir el helper de render por página, sin cambiar su
  firma ni su comportamiento observable.
- `eeffOcrRespaldo.js` (nuevo módulo): `promptOcrRespaldo(numerosPagina)`,
  `pedirTranscripcionOcr(imagenes, numerosPagina)`, `reforzarVerificacionConOcr({...})`.
- `IngestaCifras.jsx`: una línea más en la secuencia de ingesta, llamando a
  `reforzarVerificacionConOcr` después de `resolverFaltantesConNotas`.
- `eeffVerificacion.js`, `eeffParser.js`: sin cambios de contrato — `verificarEeff` ya acepta
  `textoPdf` como parte de la lectura; solo se le pasa un `textoPdf` más largo cuando aplica.

## Cómo se va a verificar

- `paginasSinTextoUtilizable`: pruebas con `getDocument` inyectado (mismo patrón que ya usan
  las pruebas de `extraerTextoPdf`/`contarPaginasPdf`) — documento con texto completo (vacío),
  documento mixto (algunas páginas), documento sin texto en ninguna página, documento donde
  `textoEsConfiable` rechaza el conjunto (todas las páginas marcadas).
- `rasterizarPaginas` no se prueba de forma unitaria directamente (depende de Canvas/DOM real,
  igual que `convertPdfToImages` hoy, que tampoco tiene prueba unitaria propia) — se prueba a
  través de `reforzarVerificacionConOcr` con un `rasterizar` falso inyectado.
- `reforzarVerificacionConOcr`: pruebas puras con las tres dependencias inyectadas (fakes, sin
  red) — casos: cero páginas sin texto (no dispara nada), documento parcial tipo Inoxpa,
  documento completo tipo Helios/LATV, límite de páginas excedido, fallo de la llamada de OCR
  (verificación queda intacta).
- `promptOcrRespaldo`: prueba de forma (pide transcripción literal, no interpretación; exige
  marcar páginas ilegibles en vez de adivinar), igual que ya se prueba `EEFF_PROMPT`.
- Manual en navegador: subir Helios (documento completo) y una copia de prueba equivalente al
  caso Inoxpa (documento mixto), confirmar que el aviso ámbar desaparece cuando el OCR tiene
  éxito y que las cifras que antes no tenían respaldo ahora sí se cotejan.
- `npm test` completo en verde antes de cerrar (con el glob expandido a mano, ver nota de
  proyecto: Node 20 no expande `--test <glob>` solo).

## Fuera de alcance

- No mejora la lectura principal de páginas escaneadas (resolución de imagen, recortes,
  cambios al prompt de extracción) — expresamente descartado como objetivo de este diseño.
- No detecta páginas individuales con fuente sin `ToUnicode` dentro de un documento que sí
  pasa el chequeo de confiabilidad global — solo el caso "documento completo rechazado" se
  trata como "todas las páginas sin texto". Si aparece un caso real de esa mezcla, amerita
  revisar esta heurística.
- No se extiende a los prompts de comparables (`EEFF_COMPARABLE_PROMPT`,
  `EEFF_COMPARABLES_LOTE_PROMPT`) — mismo criterio que los dos diseños anteriores de EEFF
  (2026-08-21, 2026-08-25), que tampoco los tocaron.
- No hay botón manual para forzar el OCR de respaldo ni reintento — automático, una vez por
  ingesta, mismo criterio que el fallback de notas.
- No cambia el texto del aviso ámbar existente para distinguir "no se intentó OCR" de "se
  intentó y no se pudo" — ambos casos comunican correctamente "no hay verificación, revise a
  mano"; una redacción más fina puede añadirse después si hace falta.
- No se introduce un motor de OCR de terceros (Tesseract.js, Google Cloud Vision) — descartado
  en la sección de decisiones.
- No se cambia ningún backend (`server.js`, `functions/index.js`, PHP de cPanel): sigue yendo
  por el proxy genérico `/api/gemini`, sin endpoint propio ni secreto nuevo.

## Lo que cambió al implementarlo (2026-08-31)

Se construyó en la rama `juandev`. Tres decisiones de este diseño **no sobrevivieron al
contacto con los límites reales** y quedaron distintas en el código. Quien lea este spec sin
esta sección reimplementaría un diseño que no puede funcionar.

### 1. La llamada única se partió en lotes — el diseño era irrealizable

El diseño mandaba «una sola llamada a `/api/gemini`» con todas las páginas marcadas. Contra los
topes que ya existen en el repo eso falla siempre:

| Tope | Dónde | Qué pasa con 24-25 páginas |
|---|---|---|
| Corte de 50 s a Gemini | `GEMINI_CORTE_MS`, `functions/index.js:120` | Transcribir una página escaneada cuesta del orden de 5-10 s: veinticinco no caben. La función devuelve 504. |
| 32 MiB de cuerpo | Cloud Run tras el rewrite de Hosting (`express.json({limit:'50mb'})` en local, más permisivo) | Un escaneo en PNG a escala 1.5 pesa 1-3 MB por página; 25 en base64 son decenas de MB. |

Implementado: `PAGINAS_POR_LOTE = 4`, lotes **secuenciales**, y **lo que un lote entrega se
conserva aunque el siguiente falle** — media transcripción verifica la mitad de las cifras, que
es más que ninguna. `enLotes` está probada, incluida la guarda contra `tamano = 0`, que habría
sido un bucle infinito con el navegador congelado.

### 2. El tope de páginas dejó de ser «se salta todo» y pasó a ser un presupuesto

El diseño fijaba `MAX_PAGINAS_OCR_RESPALDO = 30` para «saltar el respaldo por completo» si se
excedía. Con ese criterio y las páginas reales, **Robertet (25) e Inoxpa (24) quedaban dentro
del tope y disparaban la petición imposible** de arriba; el tope no protegía de nada.

Implementado: `MAX_PAGINAS_OCR_RESPALDO = 12`, y no es un límite técnico sino de fricción —cada
lote es una llamada de segundos y el analista espera—. Se transcriben las **primeras** doce, en
orden de documento, y las que quedan fuera **se nombran** en el mensaje de la ingesta.

Cuesta poco porque en un estado financiero el balance y el estado de resultados van al principio
y las notas después —así están los seis documentos reales—, y las cifras que la verificación
necesita son las de esos dos estados. Medido:

| Documento | Sin capa de texto | Transcribe | Lotes | Fuera |
|---|---|---|---|---|
| Robertet | 25 de 25 (1-25) | 12 (1-12) | 3 | 13 (notas) |
| Inoxpa | 24 de 29 (3-19, 23-29) | 12 (3-14) | 3 | 12 (notas) |
| Aluminios y Vidrios | 5 de 50 (46-50) | 5 (46-50) | 2 | 0 |
| Inmotion, PFI, HH Colombia | ninguna | — | 0 | — |

Los tres últimos **no gastan nada**: ni rasterizado, ni llamada, ni cuota.

### 3. Corre ANTES de la primera verificación, no después de la pasada a notas

El diseño lo ponía «como paso hermano después de `resolverFaltantesConNotas`». Eso pierde
trabajo: `resolverFaltantesConNotas` re-verifica desde la lectura **original**
(`fusionarHallazgosEnLectura(lectura, hallazgos)`, `eeffVerificacion.js:835`), así que una
re-verificación posterior con el texto del OCR **borraría los campos que las notas acabaran de
resolver** y también su `conclusionNotas`.

Implementado: el respaldo enriquece la lectura antes de verificar, y las dos pasadas siguientes
—verificación y fallback de notas— ven el mismo texto. El disparador sigue siendo estructural
(hay páginas sin texto), no los campos en `null`, que era el punto de esa decisión.

Como consecuencia, el contrato del módulo cambió de forma: en vez de
`reforzarVerificacionConOcr({...}) → verificacion`, es
`respaldarLecturaConOcr({file, lectura, alAvanzar}) → {lectura, respaldoOcr}`. No re-verifica:
devuelve la lectura enriquecida y quien la llama verifica una sola vez.

### 4. El rasterizado del OCR sale en JPEG; el ANEXO A sigue en PNG

No estaba en el diseño. `renderizarPagina(page, escala, formato, calidad)` pinta fondo blanco
antes de rasterizar a JPEG —sin fondo, el canvas transparente se revela como negro y la página
sale en negativo—. La pérdida de JPEG se nota en degradados, no en tinta negra sobre papel, y
recorta el cuerpo de la petición en un orden de magnitud.

### 5. El aviso ámbar NO se apaga en silencio

El diseño decía «ningún cambio de UI: el aviso ámbar se apaga solo cuando `verificadoContraTexto`
vuelve a `true`». Se implementó distinto a propósito: eso convertiría una verificación de segunda
en una de primera. `respaldoOcr` viaja en `t_lecturaEeff` hasta la tarjeta de cumplimiento del
paso 4, que publica la salvedad **en gris y no en ámbar** («las cifras se comprobaron contra una
transcripción por OCR, no contra la capa de texto del documento»), y la ingesta lo dice también
en su mensaje de éxito. Bloquear por ello devolvería el estudio al punto de partida; callarlo
sería afirmar más de lo que se verificó.

La salvedad se apaga cuando el analista digita a mano las tres cifras del margen: esas no
dependen de ninguna transcripción.

### Lo que se cumplió tal como estaba diseñado

- El texto del OCR **no** se reenvía al prompt de extracción, solo alimenta la verificación.
- «Documento entero sin `ToUnicode`» marca **todas** las páginas (mismo mecanismo, sin
  heurística por página).
- Motor de OCR: Gemini vía `/api/gemini`, sin endpoint ni secreto nuevos, sin tocar los tres
  backends.
- Cualquier fallo devuelve lo que ya había; la ingesta nunca queda peor que antes.
- `paginasSinTextoUtilizable` en `eeffTextoPdf.js` y `rasterizarPaginas` en `pdfRenderer.js`,
  con `convertPdfToImages` sin cambio observable.

### Alcance que sigue fuera

- **No verifica por columna.** `eeffColumnas.js` distingue el ejercicio de cada cifra por la
  posición horizontal de su celda, y una transcripción no trae geometría: deducir la columna del
  orden de las celdas sería la misma inferencia posicional que causaba el defecto original. En
  las páginas escaneadas el respaldo llega hasta «la cifra está impresa en el documento».
- **Las notas más allá de la página 12 de un escaneo completo** no se transcriben. Siguen
  llegando al modelo como imagen en la lectura principal, que es el comportamiento de hoy.

## Próximo paso

Plan de implementación vía la skill `writing-plans`, a partir de este spec.
