# Diseño — Fallback a notas cuando un campo de EEFF queda en null

Fecha: 2026-08-25

## De dónde sale este diseño

De procesar los EEFF de LATV Sucursal Colombia (dos versiones del mismo estudio: un PDF
escaneado de 5 páginas sin notas, y uno de 23 páginas con notas 1-23 e informe del Revisor
Fiscal). El primero disparó 6 avisos de revisión; se investigó cada uno contra el código y
contra los propios documentos (con `pdftotext`/`python`, no solo con lectura visual). Tres
hallazgos, verificados:

1. **Costo de ventas, partes relacionadas e inventarios no están en el documento, ni
   siquiera en las notas.** Se revisaron las notas 7 (`CUENTAS POR COBRAR COMERCIALES...`),
   13 (`CUENTAS POR PAGAR COMERCIALES...`) y 20 (`GASTOS DE ADMINISTRACIÓN`/`DE VENTAS`) del
   PDF con notas: ninguna desglosa partes relacionadas ni costo de ventas por separado. El
   Estado de Resultados imprime `Utilidad bruta == Ingresos` — la compañía no separa costo
   de servicio de gasto administrativo en su presentación.
2. **El PDF con notas reveló un bug real, ya corregido aparte** (`eeffTextoPdf.js`, commit
   previo a este diseño): sus 92 fuentes embebidas no traen tabla `ToUnicode`, así que
   `pdf.js` extrae texto irreconocible. `eeffVerificacion.js` lo trataba como capa de texto
   válida y descartaba cifras correctas (ingresos, total activo, PP&E, 9 filas de detalle)
   creyendo que la IA las había inventado. Ese bug es independiente de este diseño — ya
   quedó cerrado con una heurística de "texto confiable" en `extraerTextoPdf`.
3. **El documento completo ya se le manda entero a Gemini hoy.** `parseEeffWithGeminiOCR`
   (`eeffParser.js:341-417`) empaqueta el PDF completo en base64 como `inline_data` con
   `mime_type: 'application/pdf'` (`eeffParser.js:346-347`) — no hay rasterización previa
   por página en el cliente. Si el archivo trae notas, Gemini ya las "vio" en la primera
   pasada. El prompt (`EEFF_PROMPT`, `eeffParser.js:59-121`) nunca le pide explícitamente
   revisar notas; compite por atención entre ~15 campos a la vez en una sola pasada.

El problema de fondo que este diseño ataca: hoy, cada campo que queda en `null` tras
`verificarEeff()` recibe un aviso de texto fijo ("no se pudo calcular...", "escríbalo a
mano"), pero ese texto nunca distingue si genuinamente no está en ningún lado del documento
(hay que pedirlo al cliente) o si simplemente no se buscó a fondo (una pregunta más angosta
podría encontrarlo) — es la misma incertidumbre en los tres avisos distintos que ya existen
para utilidad operacional, partes relacionadas e inventarios.

## Causísticas — los estados que hoy no se distinguen

| Estado | Significa | Requiere IA | Ejemplo real |
|---|---|---|---|
| `no_verificado` (implícito hoy) | Pass 1 no lo encontró; no se sabe si no está o no se buscó bien | — | Cualquier `null` de hoy |
| `implicito_cero` | No está impreso, pero otra cifra impresa lo implica en cero | No — aritmética pura sobre `cotejo` | `Utilidad Bruta == Ingresos` ⇒ costo de ventas = 0 (LATV) |
| `probable_ausente_por_vocabulario` | El diccionario compartido (ya maduro para ese campo) no encontró ninguna palabra conocida en todo el texto | No — grep contra `textoPdf` completo | Señal más débil que `confirmado_ausente`: el diccionario pudo no conocer el sinónimo que usa *esta* empresa |
| `confirmado_ausente` | Una IA revisó el documento completo (estados + notas) y afirmó explícitamente que no aparece, citando qué revisó | Sí — pasada angosta | Partes relacionadas e inventarios de LATV, tras revisar sus notas |
| `encontrado_en_notas` | La pasada angosta lo halló en una nota que pass 1 no había capturado | Sí — pasada angosta | (no observado en LATV; sí es el caso que la pasada angosta debe cubrir para otros clientes) |

Solo `confirmado_ausente` justifica decirle al analista, con la misma seguridad, "pídaselo al
cliente". `probable_ausente_por_vocabulario` se comunica más suave — invita a revisar
manualmente, no a pedirle algo al cliente con la misma certeza. Hoy todo `null` recibe el
mismo texto, sin ninguna de estas distinciones.

## Diseño

### 1. Disparo condicional de la pasada angosta

Vive en `IngestaCifras.jsx` (ya orquesta parse → verify; `eeffVerificacion.js` se mantiene
puro, sin I/O). Tres ramas, en orden — el diccionario decide primero si hace falta gastar
IA en absoluto:

```
para cada campo en null tras verificarEeff() (excluyendo los ya implicito_cero):

  1. si el diccionario de ese campo está MADURO
        (estudiosSinPalabraNueva >= UMBRAL_MADUREZ, ver sección "Diccionario compartido")
     Y ninguna de sus palabras conocidas aparece en `textoPdf` completo (si hay texto
        confiable; si el documento es un escaneo sin texto, esta rama no aplica):
       estado = 'probable_ausente_por_vocabulario'    // sin llamar a Gemini

  2. si no, y numPaginas(pdf) > 6 (heurística: probablemente trae notas):
       ejecutar pasada 2 (Gemini, prompt angosto, con cita obligatoria)
       fusionar hallazgos en `campos`, re-verificar
       actualizar el diccionario (ver más abajo)

  3. si no:
       estado = 'no_verificado'   // documento corto, sin dónde buscar y sin diccionario
                                   // maduro que decida; queda como hoy
```

El umbral de 6 páginas sigue siendo una heurística (portada + 4 estados principales ≈ 5-6
páginas en los casos vistos), solo para evitar la llamada cuando es obvio que no hay notas
que revisar (el escaneo de 5 páginas de LATV, por ejemplo) — independiente de si el
diccionario ya es maduro o no.

`numPaginas` es un dato nuevo y pequeño: `eeffTextoPdf.js` ya abre el documento con `pdf.js`
dentro de `extraerTextoPdf` y conoce `doc.numPages`. Se expone con una función nueva y
exportada, `contarPaginasPdf(file, opts)`, en vez de cambiar el contrato de
`extraerTextoPdf` (que ya usan los tests existentes y sigue devolviendo solo el string).

### 2. La pasada angosta (Gemini, pass 2)

Nueva función en `eeffParser.js` (p. ej. `buscarFaltantesEnNotas(file, faltantes)`), que
reutiliza el mismo archivo ya en base64 — no hay que rasterizar nada nuevo, Gemini ya recibe
el PDF completo en pass 1. El prompt es deliberadamente angosto — un solo objetivo en vez de
~15 campos disputando atención:

> "Busca específicamente estos datos EN TODO EL DOCUMENTO, incluyendo cualquier nota a los
> estados financieros que traiga: [lista de `faltantes` con su definición — reusando las
> mismas descripciones por rubro que ya existen en `EEFF_PROMPT`, sin duplicarlas a mano].
> Para cada uno, responde el valor si lo encuentras impreso en cualquier parte (estado
> principal o nota) **y la palabra o frase literal con la que el documento lo llama**; o,
> si genuinamente no aparece en ninguna parte tras revisar el documento completo, dilo
> explícitamente **citando en qué nota(s) lo buscaste y por qué esa nota no lo contiene**
> (no basta un `null` sin más). Incluye una `conclusion` en español, breve, explicando qué
> encontraste y qué sigue faltando."

La respuesta trae, por campo, `{ valor, encontrado_en: 'estado_principal'|'nota'|null,
palabra, cita }` y una `conclusion` de cierre en una sola llamada — así no hace falta una
tercera llamada solo para redactar: Gemini ya tiene el contexto fresco de qué buscó y no
encontró, y es quien mejor puede explicarlo en el momento. Exigir `palabra` y `cita` no es
cosmético: es lo que hace verificable una ausencia (ver siguiente sección) y lo que alimenta
el diccionario compartido.

### 3. Cómo se confirma una ausencia, sin depender solo de que la IA diga "no está"

Dos verificaciones, de más barata a más cara, ninguna es "confiar en que el modelo buscó
bien":

- **Mecánica (gratis):** contra el diccionario compartido (siguiente sección), buscar en
  **todo** el texto del documento —no solo las filas del estado principal, también las
  notas— si aparece alguna palabra conocida para ese campo. Solo se usa para decidir
  `probable_ausente_por_vocabulario` cuando el diccionario ya es maduro; nunca decide sola
  mientras el diccionario todavía está aprendiendo ese campo (ver umbral de madurez).
- **Con cita (cuando sí hace falta IA):** la pasada angosta no puede responder `null` sin
  más — tiene que decir en qué nota buscó y por qué esa nota no contiene el dato. Es el
  mismo principio que ya aplica `eeffTextoPdf.js` para las cifras encontradas
  (`cifraApareceEnTexto`, cada cifra debe estar impresa literalmente): aquí, en vez de
  verificar una cifra positiva contra el texto, se le pide al modelo una cita que el
  analista puede comprobar en segundos abriendo esa nota puntual, en vez de tener que
  releer el documento completo para desconfiar de un "no está" sin sustento.

### 4. Diccionario compartido de vocabulario

Nueva colección de Firestore, **la primera de la app sin scoping por `uid`** — el punto es
que lo que se aprende del EEFF de una compañía sirva para la siguiente, sin importar quién
la subió:

```
vocabularioEeff/{campo}              (p. ej. campo = "t_ap_relacionadas")
  palabras: string[]                  // normalizadas: minúsculas, sin tildes, dedupe
  estudiosSinPalabraNueva: number     // se resetea a 0 cada vez que se agrega una palabra
```

Necesita una regla nueva en `firestore.rules` (lectura/escritura para cualquier usuario
autenticado de la firma, sin `uid` de por medio — documentado como la excepción a la regla
de scoping por usuario que sigue el resto de la app).

**Madurez, no confianza inmediata.** Un campo se considera maduro (se le puede confiar el
`probable_ausente_por_vocabulario` sin gastar IA) solo cuando lleva
`estudiosSinPalabraNueva >= UMBRAL_MADUREZ` (constante configurable, arranca en 20). Hasta
entonces, la pasada angosta sigue corriendo igual que si el diccionario no existiera —el
ahorro llega solo, nunca se fuerza mientras el diccionario todavía puede estar incompleto.

**Aprende gratis de los éxitos, no solo de los fallos.** Cada vez que la pasada 1 SÍ
encuentra un campo, `rotulos[campo]` (que ya existe en `eeffParser.js`) es la palabra o
frase con la que ese documento lo llamó — se normaliza y se agrega al diccionario exactamente
igual que si viniera de la pasada angosta. Así el diccionario madura con cada estudio
exitoso, no solo con los que necesitaron el fallback: la mayoría de estudios nunca gastan
una llamada extra y aun así lo alimentan.

### 5. El caso `implicito_cero` (sin IA)

Regla puramente aritmética, agregada a `eeffVerificacion.js`: si `cotejo.utilidad_bruta`
(o el rubro de ventas) coincide con `campos.t_s` dentro de tolerancia y `campos.t_c` es
`null`, se marca `t_c` como `implicito_cero` en vez de `no_verificado` — sin gastar ninguna
llamada adicional. Esto no asigna el valor automáticamente al estudio: se muestra como
sugerencia ("el documento implica costo de ventas = 0 porque Utilidad Bruta = Ingresos") y
el analista decide si la acepta escribiendo `0` a mano.

### 6. El popup

Uno nuevo en `IngestaCifras.jsx` (memoria de proyecto: no usar `window.alert`/`confirm`, ya
se comprobó que no es confiable en esta app — modal propio, como el resto de la UI). Se
dispara al cerrar el flujo de ingesta **solo si** queda algo en `confirmado_ausente` o si no
se pudo revisar por falta de notas; si la pasada angosta encontró todo lo que faltaba
(`encontrado_en_notas` para cada campo), esos valores se fusionan en `campos` como una
lectura exitosa más y no aparece ningún popup — el caso feliz no debe interrumpir al
analista. Contenido cuando sí se dispara:

- Lista de lo que falta, con su estado (confirmado ausente / probable ausente por
  vocabulario / no se revisó por no haber notas / implícito en cero) — cada estado con su
  propio tono, no el mismo texto para los cuatro.
- La `conclusion` de Gemini, cuando la pasada angosta corrió (caso `confirmado_ausente` o
  `encontrado_en_notas`).
- Si fue el diccionario el que decidió (`probable_ausente_por_vocabulario`), una frase en
  código que deja claro que es una señal más débil: *"No encontramos ninguna palabra
  relacionada con [rubro] en todo el documento, según lo que hemos aprendido de otros
  estudios similares. Puede que este documento use un término distinto — revíselo
  manualmente antes de descartarlo."*
- Si la pasada angosta no corrió por falta de páginas (`no_verificado`), la frase ya
  planteada: *"Este documento no parece traer notas a los estados financieros, así que no
  fue posible revisar ahí. Verifique si existe una versión con notas, o pida directamente al
  cliente: [lista]."*

## Decisiones tomadas

| Decisión | Elegido | Por qué |
|---|---|---|
| Alcance de campos | Cualquier campo de `LEIDOS` que quede en `null`, no solo los tres insumos de Utilidad Operacional | El mecanismo (pasada angosta + estado `confirmado_ausente`) sirve igual para partes relacionadas e inventarios, que ya mostraron el mismo problema con LATV. Generalizarlo ahora evita repetir el diseño campo por campo. |
| Cuándo se dispara | Automático: primero el diccionario (si ya es maduro), después `numPaginas(pdf) > 6`, y solo si algo quedó en `null` | Evita gastar la llamada extra tanto cuando ya se sabe que el concepto no se menciona (diccionario maduro) como cuando es obvio que no hay notas (escaneo corto), sin exigirle al analista un paso manual. |
| Cómo se comunica lo confirmado ausente | Popup dedicado (modal propio), no la caja de advertencias existente | El usuario lo pidió explícitamente: quiere una notificación clara de lo que falta, con una conclusión en lenguaje natural, no otra línea más en una lista ya larga. |
| Quién redacta la conclusión | La misma llamada de la pasada angosta (Gemini), no una tercera llamada a Claude | Gemini ya tiene el contexto exacto de qué buscó y no encontró; pedirle la frase en la misma respuesta evita una llamada adicional solo para redactar. |
| El caso `Utilidad Bruta == Ingresos` | Regla aritmética en código, sin IA | Es una inferencia numérica determinista sobre datos que la pasada 1 ya trae (`cotejo`); no hay nada que buscar en el documento. |
| Cómo se confirma una ausencia con más certeza | Vocabulario mecánico (gratis, solo si ya maduró) + cita obligatoria cuando sí hace falta IA | Ninguna de las dos depende de "confiar en que el modelo buscó bien": una es un grep verificable, la otra exige una referencia que el analista puede comprobar en segundos. |
| Confianza mientras el diccionario es joven | Nunca se salta la IA hasta que el campo acumule `UMBRAL_MADUREZ` (20) estudios sin aportar palabra nueva | Un diccionario incompleto que decide solo repetiría el error D5 ya documentado en el spec de 2026-08-21 (vocabulario de un solo cliente), esta vez por incompletitud en vez de por diseño fijo. |
| Dónde vive el diccionario | Colección nueva `vocabularioEeff/{campo}` en Firestore, sin scoping por `uid` | Es la primera pieza de conocimiento en la app pensada para compartirse entre todos los estudios de la firma, no por usuario — el punto es que lo aprendido con un cliente sirva para el siguiente. |
| Cómo crece el diccionario | También de los éxitos de la pasada 1 (`rotulos[campo]`), no solo de los fallos de la pasada angosta | La mayoría de estudios nunca necesitan el fallback; que también esos alimenten el diccionario acelera la madurez sin gastar ninguna llamada adicional. |

## Contrato de datos — qué cambia

- `eeffTextoPdf.js`: nuevo export `contarPaginasPdf(file, { getDocument } = {})`, misma
  forma de apertura que `extraerTextoPdf` pero solo devuelve `doc.numPages`.
- `eeffParser.js`: nuevo `promptFaltantesEnNotas(faltantes)` (reusa las descripciones por
  rubro ya escritas en `EEFF_PROMPT`, factorizadas a un diccionario compartido) y
  `buscarFaltantesEnNotas(file, faltantes)`, que llama a `/api/gemini` y devuelve
  `{ hallazgos: { [campo]: { valor, encontradoEn, palabra, cita } }, conclusion }`.
- `eeffVerificacion.js`: cada advertencia por campo faltante gana un `estado` —
  `'confirmado_ausente' | 'probable_ausente_por_vocabulario' | 'no_verificado' |
  'implicito_cero'` — además del `mensaje` que ya tiene. Nueva función pura
  `aplicarHallazgosNotas(campos, advertencias, hallazgos)` para fusionar el resultado de la
  pasada angosta y volver a marcar lo que sí se encontró.
- `services/vocabularioEeff.js` (nuevo): funciones puras para normalizar palabras (minúsculas,
  sin tildes, dedupe) y decidir madurez (`esMaduro(estudiosSinPalabraNueva)`), separadas del
  I/O de Firestore — igual que el resto del código de dominio, que es puro y deja el I/O a
  quien orquesta.
- `firestoreRepo.js` (o el archivo que ya centralice el acceso a Firestore): funciones para
  leer/actualizar `vocabularioEeff/{campo}`.
- `firestore.rules`: regla nueva para `vocabularioEeff/*` — lectura/escritura para cualquier
  usuario autenticado, sin scoping por `uid`.
- `IngestaCifras.jsx`: orquesta las tres ramas del disparo condicional (diccionario maduro →
  páginas → ninguna), llama al nuevo popup con el resultado final.

## Cómo se va a verificar

- Pruebas unitarias puras para `aplicarHallazgosNotas` y para la regla `implicito_cero` en
  `eeffVerificacion.test.js` (sin red, con fixtures).
- Pruebas para `contarPaginasPdf` en `eeffTextoPdf.test.js`, con el mismo patrón de
  `getDocument` inyectado que ya usan las pruebas de `extraerTextoPdf`.
- Pruebas para `vocabularioEeff.js` (normalización, dedupe, `esMaduro`) — puras, sin
  Firestore.
- `promptFaltantesEnNotas` probado por su forma de salida (qué pide, qué campos incluye, que
  exige `palabra` y `cita`), igual que ya se prueba `EEFF_PROMPT` hoy.
- Prueba manual en el navegador con el propio caso de LATV: subir el PDF con notas, y
  confirmar que partes relacionadas e inventarios aparecen como `confirmado_ausente` con una
  conclusión coherente y su cita, y no como un `null` genérico.
- `npm test` completo en verde antes de cerrar.

## Fuera de alcance

- No se reintenta la pasada angosta más de una vez por estudio ni se ofrece un botón manual
  para forzarla — si el analista quiere insistir, puede volver a subir el mismo archivo.
- No se aplica a los prompts de comparables (`EEFF_COMPARABLE_PROMPT`,
  `EEFF_COMPARABLES_LOTE_PROMPT`) ni a su ruta: mismo criterio que el diseño anterior de
  ingesta verificada (2026-08-21), que tampoco las tocó.
- No se resuelve automáticamente el caso `implicito_cero`: se sugiere, el analista decide.
- No se cambia ningún backend (`server.js`, `functions/index.js`, PHP de cPanel): sigue
  yendo por el proxy genérico `/api/gemini`, sin endpoint propio.
- No se reescala nada por unidad de miles/millones — sigue fuera de alcance, como ya decidió
  el diseño de 2026-08-21.
- No se vuelve a muestrear un campo ya maduro para detectar que el vocabulario quedó
  desactualizado (drift) — un campo maduro deja de llamar IA salvo que vuelva a quedar en
  `null` tras el diccionario. Si en el futuro esto genera falsos `probable_ausente`
  recurrentes, vale la pena revisitarlo; se documenta aquí para que la limitación quede
  explícita, no silenciosa.
- No hay moderación ni validación semántica de las palabras que entran al diccionario más
  allá de normalizar y deduplicar — se confía en que solo entran palabras que Gemini asoció
  a un rótulo o a una cita real.

## Próximo paso

Plan de implementación vía la skill `writing-plans`, a partir de este spec.
