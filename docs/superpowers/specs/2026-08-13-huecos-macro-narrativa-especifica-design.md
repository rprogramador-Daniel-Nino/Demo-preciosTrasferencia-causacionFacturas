# Narrativa Específica por Hueco Intermedio de III.A/III.B/III.C — Design

## Contexto verificado

El 2026-08-12 se cerró (`docxRelleno.js`/`tablasHtmlInforme.js`, commits `8987c9c`/`b7de19b`/`41a02a3`)
el hueco de que la Sección III dejara sobrevivir prosa del informe de referencia (END GAME) sin
marcar. La solución de ese día fue deliberadamente conservadora: **8 huecos** —2 en III.A (mundo),
5 en III.B (Colombia) y 1 en la entrada de III.C (sector)— pasaron de "se queda el texto del
cliente anterior" a "se retira y se pone un marcador genérico de redacción manual"
(`marcadorContenidoRetirado`/`contenidoHuecoIntermedioHtml`, texto: *"Este párrafo del informe de
referencia se retiró porque describía cifras y hechos de otro contribuyente..."*). Confirmado
contando la cadena literal en un `.docx` real generado hoy: aparece exactamente 8 veces.

Verificado en Firestore (no en memoria, que estaba desactualizada en este punto) el 2026-08-13:

- `analisisMercado/actual` **sí tiene datos reales y vigentes**, actualizado 2026-08-12: las 8
  series de `SERIES_MACRO` (`functions/analisisMercadoPrompts.js:29-38`) —incluidas
  `tasa_intervencion`, `trm_promedio`, `desempleo_colombia`, que son justo los tres huecos que hoy
  se vacían— están `confiable:true` con `fuenteUrl` real (Banco de la República, DANE, FMI). El
  pipeline Gemini(busca)+Claude(redacta) de macro **no está roto** — la nota de memoria que decía
  que el cron mensual no había corrido y no correría hasta 2026-09-01 quedó obsoleta.
- `analisisSector` tiene 12 documentos reales (`act_*`), varios actualizados el 12 y 13 de agosto,
  con narrativa completa y `fuentesCitadas` reales. Tampoco está roto.

**El problema no es de búsqueda, es de redacción y de cableado.** Las cifras que necesitan los 7
huecos macro ya están en Firestore con su fuente. Lo que falta es que Claude las redacte como
párrafos cortos *por tema* (hoy solo redacta dos bloques grandes: `narrativa.mundial` y
`narrativa.colombia`) y que `docxRelleno.js`/`tablasHtmlInforme.js` conecten cada hueco a su párrafo
específico en vez de a la función genérica que solo sabe borrar.

## Alcance

Los 8 huecos, en el orden en que aparecen en el documento:

**III.A (mundo)** — de `actualizarApartadosMacroOoxml`/`Html`, primer grupo de hitos:
1. Entre "PIB Mundial" y "Inflación Global" → tema **inflación mundial**.
2. Entre "Inflación Global" y "por Región/País" → tema **proyección/pronóstico mundial**.

**III.B (Colombia)** — segundo grupo de hitos:
3. Entre "PIB en Colombia" y "Inflación en Colombia" → tema **inflación colombiana**.
4. Entre "Inflación en Colombia" e "Intervención del Banco" → tema **política monetaria**.
5. Entre "Intervención del Banco" y "Tasa Representativa del Mercado" → tema **tasa de cambio
   (TRM)**.
6. Entre "Tasa Representativa del Mercado" y "Desempleo en Colombia" → tema **mercado laboral**.
7. Entre "Desempleo en Colombia" y "Análisis del Sector" → tema **conclusiones** (cierra III.A/III.B).

**III.C (sector)** — de `actualizarApartadoSectorialOoxml`/`Html`:
8. Entre "Análisis del Sector" y "Comportamiento del Sector" → tema **introducción del sector**.

Los huecos 2-7 usan datos que **ya están verificados y en Firestore** (`inflacion_global`,
`crecimiento_por_region`, `inflacion_colombia`, `tasa_intervencion`, `trm_promedio`,
`desempleo_colombia`). El 7 (conclusiones) sintetiza, no cita una serie nueva. El 8 usa el mismo
pipeline de sector que ya funciona, solo le falta el campo.

**No se toca la búsqueda de Gemini** (`construirPromptBusqueda`/`construirPromptBusquedaSector`,
el `tools:[{google_search:{}}]`, el criterio de `confiable`): las 8 series ya se buscan y ya
vienen confiables. Esto es puramente una extensión de redacción (Claude) + cableado.

## Arquitectura

Tres piezas, cada una extendiendo un contrato que ya existe — ningún mecanismo nuevo:

**1. Redacción por tema, no por bloque grande** (`functions/analisisMercadoPrompts.js`)

`construirPromptRedaccion` pasa de pedir 2 apartados (`mundial`, `colombia`) a pedir 9: los mismos
2 —que se acortan, ya no tienen que mencionar política monetaria/TRM/desempleo, eso ahora vive en
su propio hueco— más `inflacionMundial`, `proyeccionMundial`, `inflacionColombia`,
`politicaMonetaria`, `tasaCambio`, `mercadoLaboral`, `conclusiones`. Cada uno es un párrafo corto
(1 `<p>`, no 3 como los bloques grandes) que cita únicamente las series ya verificadas que le
correspondan.

`parsearRespuestaRedaccion` sigue exigiendo `mundial`/`colombia` (igual que hoy: si faltan, se
aborta la corrida completa, se conserva el mes anterior). Los 7 campos nuevos son "mejor si están,
no bloqueantes": si Claude no trae uno o lo trae vacío, esa clave queda ausente en el documento —
no se aborta la corrida por eso, el hueco correspondiente simplemente sigue con el marcador
específico hasta el próximo mes.

`armarDocumentoFirestore` guarda los campos nuevos que sí vinieron, tal como guarda hoy
`fuentesCitadas` (presente siempre, aunque sea `null`/ausente por campo).

**2. Un campo más en sector** (`functions/analisisSectorPrompts.js`)

`construirPromptRedaccionSector` pide un quinto apartado, `introduccion`: 1-2 frases de contexto
general del sector antes de entrar en comportamiento/comercio exterior/proyección — mismo criterio
de "mejor si está" que arriba (`parsearRespuestaRedaccionSector` no lo exige junto a los otros 4).

**3. Cableado: cada hueco a su tema, no a la función genérica**

En `docxRelleno.js`/`tablasHtmlInforme.js`, los `contenidoHuecoIntermedio(Html)` de los 7 huecos
macro se reemplazan por closures `bloque(narrativa.tema, 'nombre del tema')` — mismo patrón que ya
usa `actualizarApartadoSectorialOoxml` para sus 4 bloques. Cada `bloque`:
- Si `narrativa.tema` existe: inserta el párrafo + una línea `FUENTE: <url>` (nueva función
  compartida `parrafoConFuente`, generaliza el patrón de `docxRelleno.js:160-162`) usando la
  `fuenteUrl` de la serie correspondiente (`series.inflacion_global.fuenteUrl`, etc. — no se
  vuelve a buscar, ya está en el mismo documento de Firestore). "Conclusiones" no lleva fuente:
  es síntesis, no cita.
- Si no: cae en `marcadorApartadoPendiente(tema, year)` —ya existe y ya acepta un `tema`
  arbitrario, solo cambia el texto que se le pasa— en vez del genérico `marcadorContenidoRetirado`.

El hueco 8 (entrada de III.C) cambia de `contenidoHuecoIntermedio` a
`bloque(entrada && entrada.narrativa.introduccion, 'introducción del sector')`, mismo patrón que
sus 4 hermanos en esa misma función.

`contenidoHuecoIntermedio`/`contenidoHuecoIntermedioHtml` (la función genérica) no se elimina:
sigue siendo el resguardo correcto para cualquier hueco intermedio que en el futuro no tenga un
tema propio identificado.

## Manejo de errores

- Ninguna llamada nueva a Gemini: no hay un nuevo modo de fallo de búsqueda que cubrir.
- Si Claude devuelve JSON sin alguno de los 7 campos nuevos (o vacío/corto), ese campo se omite del
  documento — no revienta la corrida ni descarta `mundial`/`colombia`, que siguen siendo los únicos
  obligatorios (mismo contrato de hoy).
- Migración: `analisisMercado/actual` existente (actualizado 2026-08-12) no tiene los 7 campos
  nuevos todavía. Hasta la próxima corrida exitosa (manual o cron), esos huecos muestran el
  marcador específico de "Actualizar con..." — nunca el genérico de "retirado", nunca el texto
  viejo. No se fuerza un backfill: la próxima corrida normal los completa.

## Pruebas

- `functions/analisisMercadoPrompts.test.js`: casos nuevos para los 7 campos —presentes,
  ausentes, vacíos— sin romper la obligatoriedad de `mundial`/`colombia`.
- `functions/analisisSectorPrompts.test.js`: caso para `introduccion` presente/ausente.
- `frontend/src/services/docxRelleno.test.js` / `tablasHtmlInforme.test.js`: por cada uno de los 8
  huecos, un caso con narrativa real (se inserta el párrafo + `FUENTE:`) y un caso sin ella (cae en
  el marcador específico, no en el genérico).
- Verificación manual obligatoria (ya documentada como limitación del resto de esta área): generar
  el `.docx` real con `Archivos Prueba/Informe Local End Game _ 2024_v2.docx` y abrirlo en Word.

## Fuera de alcance

- Un disparador manual/on-demand para `analisisMercadoActualizar` (hoy solo tiene `onSchedule`).
  Si hace falta probar el pipeline completo contra Firestore real antes del próximo ciclo mensual,
  se invoca aparte (como ya se hizo para producir el documento actualizado el 2026-08-12) — no es
  parte de este cambio.
- El aviso de "listo para radicar" no incorpora estos 7 huecos nuevos a su lista de `avisos` (hoy
  el reemplazo de un hueco intermedio no se avisa, solo la ausencia de un hito). Igual que con el
  hallazgo de la sesión anterior, sigue siendo cierto que el semáforo puede salir en verde con
  algún hueco todavía en marcador — no se resuelve aquí.
