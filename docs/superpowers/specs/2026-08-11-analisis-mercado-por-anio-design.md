# Análisis de mercado (III.A y III.B) indexado por año gravable

Fecha: 2026-08-11
Rama: `juandev`
Antecedente: `docs/superpowers/specs/2026-08-03-analisis-mercado-ia-design.md`

## El defecto

La narrativa de los apartados III.A (economía mundial) y III.B (economía colombiana) **no
depende del año gravable del estudio**: cualquier informe recibe la última corrida guardada,
sea del año que sea, y nada lo señala.

Verificado ejecutando el módulo con un documento que simula la corrida del cron de 2025:

```
--- año gravable 2024 -> "<p>Durante 2025 el PIB mundial creció 3,2%...</p>"
--- año gravable 2025 -> "<p>Durante 2025 el PIB mundial creció 3,2%...</p>"
--- año gravable 2026 -> "<p>Durante 2025 el PIB mundial creció 3,2%...</p>"
```

Tres causas encadenadas:

1. **El documento no está indexado por año.** `analisisMercado/actual` es único y global
   (`functions/analisisMercadoActualizar.js:88`). No tiene el `porAnio` que sí tiene
   `analisisSector`.
2. **La lectura viva ignora el año.** `frontend/src/services/plantillaVocabulario.js:170-178`
   resuelve `ia.economia_mundial` e `ia.economia_colombia` leyendo `datosMacro.narrativa.*`
   sin mirar `estudio.anio`. Diez líneas más abajo, en la misma función, el sector sí filtra
   por `analisisSector.porAnio[String(estudio.anio)]` (`:180`). El defecto es esa asimetría.
3. **El cron redacta con el año calendario.** `functions/index.js:345`:
   `const anioActual = new Date().getFullYear()`, que no es el año gravable de ningún estudio
   en particular.

Y no hay forma de detectarlo: `armarDocumentoFirestore`
(`functions/analisisMercadoPrompts.js:167-180`) guarda `actualizadoEn` pero no para qué año se
redactó, así que no existe el dato con el que comparar. El único aviso relacionado
(`ReporteGenerador.jsx:216`, `dias > 62`) detecta "el cron dejó de correr", no "el año no
coincide".

El resultado es un documento internamente contradictorio: tablas con las cifras del año
gravable correcto y párrafos alrededor hablando de otro año.

### Lo que sí funciona y no se toca

Comprobado en la misma sesión, para no arreglar lo que no está roto:

- **Las ocho tablas macro** resuelven bien por año (`analisisMercado.js:216-336`): ventana
  deslizante `year-1 / year / year+1` y `marcadorPendiente` cuando falta el año, nunca el valor
  de otro.
- **El apartado sectorial III.C** está indexado por `porAnio[String(year)]`
  (`analisisMercado.js:394`) y cae al respaldo con marcador si no hay corrida para ese año.

## Decisiones tomadas

| Decisión | Elegido |
|---|---|
| Para qué año se redacta | Bajo demanda según `study.anio`, como el sector |
| Refresco | El cron mensual rehace los dos **años vivos**; los anteriores quedan congelados |

**Año vivo** = el año calendario y el inmediatamente anterior. Son los que se están radicando,
y el término se usa igual en el refresco del cron y en el aviso de frescura.
| Documento existente | Se adopta al leer, según el año de `actualizadoEn` |
| Dónde vive el índice | `porAnio` dentro de `analisisMercado/actual` (espejo del sector) |

### Enfoques descartados

**Un documento por año** (`analisisMercado/2025`, `analisisMercado/2026`): obliga a duplicar
las `series` en cada documento o a sacarlas a un tercero, y a rehacer la subcolección
`historial/{YYYY-MM}` que hoy cuelga de `actual`. Más piezas móviles para el mismo resultado,
y se aparta del patrón del sector justo cuando el objetivo es que los dos apartados se
comporten igual.

**Un solo documento con `anioRedactado`**, regenerando cuando no coincide con `study.anio`:
sin `porAnio` solo cabe un año a la vez, así que dos consultores con estudios de años distintos
se pisarían la narrativa el uno al otro en bucle. Sirve para avisar, no para arreglar.

## Forma del dato

Indexar solo la narrativa no basta. `armarDocumentoFirestore` escribe con `set()` completo y
`buscarCifras(geminiApiKey, N)` busca la ventana `N-2…N+1`: una generación bajo demanda
disparada por un estudio de 2023 sobrescribiría las `series` globales con valores de 2021-2024
y **borraría los de 2025 y 2026**, rompiendo las tablas de los demás estudios. La corrida
entera pasa a ser por año, no solo su prosa.

```
analisisMercado/actual
  actualizadoEn: Timestamp        ← última corrida, sea del año que sea (aviso de frescura)
  porAnio: {
    "2025": { series: {…}, narrativa: { mundial, colombia, fuentesCitadas }, actualizadoEn },
    "2026": { series: {…}, narrativa: {…}, actualizadoEn }
  }
  series:     ← legado: se sigue leyendo, ya no se escribe
  narrativa:  ← legado: ídem
```

Efecto colateral favorable: la entrada de cada año gravable queda con **sus** cifras, **su**
fuente y **su** fecha de consulta, en vez de una tabla de series compartida cuya fecha de
consulta pertenece a otra corrida. Es lo que pide el numeral 4 del artículo 1.2.2.2.1.5 del
Decreto 1625 de 2016.

Escritura con `merge: true` sobre `porAnio.{año}`, igual que `analisisSectorActualizar.js:145`.

El historial pasa de `historial/{YYYY-MM}` a `historial/{año}-{YYYY-MM}`: con corridas por año,
dos del mismo mes para años distintos se pisarían la entrada. El comodín `{mes}` de
`firestore.rules:313` acepta el id nuevo sin cambios.

**Restricción de Firestore que se conserva:** `crecimiento_por_region` sigue siendo un arreglo
de objetos planos y no de pares `[region, valor]`. Firestore prohíbe que un elemento de un
arreglo sea a su vez un arreglo, y con pares anidados el `set()` fallaba y se perdía la
escritura entera (ver el comentario en `analisisMercado.js:98-105`).

## El punto de costura

Una función concentra toda la resolución por año y es la única que sabe del esquema legado:

```js
/** La corrida guardada para ese año gravable, o null. */
export function entradaMercado(datosMacro, year)
```

1. `porAnio[String(year)]` si existe.
2. Si no, y el documento trae `narrativa`/`series` sueltas del esquema viejo: se adoptan **solo
   si** el año de `actualizadoEn` coincide con `year`. El cron siempre redactó con
   `new Date().getFullYear()`, así que esa igualdad es exacta, no una conjetura.
3. Si no, `null` → marcador de pendiente. Nunca la prosa de otro año.

Todo lo demás la consume y deja de mirar el documento crudo:

- `plantillaVocabulario.js:170-178` — las dos ramas `ia.economia_*`. **Es la ruta viva**: por
  `valorDeCampo` pasan tanto la exportación `.docx` (`docxRelleno.js:698`) como la plantilla
  PDF/HTML (`plantillaRenderer.js`). Un solo arreglo cubre las dos rutas.
- `resolverSerie` (`analisisMercado.js:204`) — recibe la entrada del año en vez del documento.
- `diagnosticarCobertura` (`tablasInforme.js:398`) — `narrativaCubierta` y `seriesFaltantes`
  pasan a mirar la entrada del año.

## Generación

Una HTTP `generarAnalisisMercado` en `functions/index.js`, gemela de `generarAnalisisSector`,
y el cron mensual llamando a esa misma lógica para el año calendario y el anterior.

El disparo bajo demanda en `ReporteGenerador.jsx` copia el efecto que ya existe para el sector
(`:118-162`), **incluida la llamada directa a la URL de la función** en vez de a
`/api/…`: ese path pasa por el rewrite de Firebase Hosting, que corta a los 60 s sin importar
el `timeoutSeconds` de la función, y la cadena Gemini→Claude tarda más que eso.

`server.js` y el PHP **no** cambian. Aquí no aplica la regla de las tres implementaciones del
proxy: ni el cron ni `generarAnalisisSector` existen fuera de Firebase, y el frontend llama la
URL de la función directamente.

## Errores

Cada año se escribe por separado con `merge: true`, así que un fallo redactando 2026 no toca la
entrada de 2025 — hoy, con `set()` completo, una corrida a medias se lo llevaba todo. El cron
intenta los dos años vivos de forma independiente: si uno revienta, el otro se guarda igual.

Si la generación bajo demanda falla, se replica el trío de estados que el sector ya distingue
(`ReporteGenerador.jsx:57-70`): en curso, falló *con su motivo*, o todavía no generado. El
apartado cae al marcador `[Actualizar con…]`, nunca a la prosa de otro año.

Dos usuarios abriendo estudios del mismo año a la vez lanzan dos generaciones. No se pone
cerrojo: con `merge` sobre la misma clave gana la última y ambas son válidas para ese año. Es
la misma carrera que el sector ya tolera.

**El aviso de frescura se aplica solo a los dos años vivos.** Una entrada de 2023, congelada a
propósito desde 2024, siempre tendría más de 62 días y gritaría "desactualizado" precisamente
cuando está como debe estar. Un banner que se queja siempre es un banner que nadie lee.

## Pruebas

TDD, rojo primero. Núcleo — `entradaMercado`:

- entrada por `porAnio`;
- legado adoptado cuando el año de `actualizadoEn` coincide;
- legado **ignorado** cuando no coincide;
- `porAnio` ganándole al legado cuando están los dos;
- nada → `null`.

Dos regresiones, que son los dos defectos concretos que motivan este trabajo:

- la narrativa de 2025 **no** aparece en un informe de 2026;
- guardar la corrida de 2023 **no** borra las series de 2026.

Y además: `plantillaVocabulario` (`ia.economia_mundial`/`_colombia` por año),
`diagnosticarCobertura` (cobertura por año; frescura solo en años vivos) y
`armarDocumentoFirestore` (produce `porAnio[year]`, ya no escribe las claves globales).

La suite completa (`npm test`) debe quedar en verde: es código de `frontend/src/services/` y de
`functions/`, ambos cubiertos.

## Alcance

Se toca: `frontend/src/services/analisisMercado.js`, `plantillaVocabulario.js`,
`tablasInforme.js`, `frontend/src/components/ReporteGenerador.jsx`,
`functions/analisisMercadoPrompts.js`, `functions/analisisMercadoActualizar.js`,
`functions/index.js` y sus tests.

No se toca: `index.html` (el monolito no recibe desarrollo nuevo), `server.js`, el PHP,
`firestore.rules` (`match /analisisMercado/{docId}` ya cubre la forma nueva) ni el respaldo
local `DATOS_MACRO`, que sigue sirviendo cuando Firestore no tiene nada.

### Código muerto que se retira

`generarApartadoMundial` (`analisisMercado.js:510`) y `generarApartadoColombia` (`:537`) están
exportadas y probadas, pero **no las llama nadie en producción**: solo sus tests y los
documentos del plan de 2026-08-03. La ruta viva es `plantillaVocabulario`. Se borran con sus
tests, porque son una trampa: quien mañana vaya a arreglar este mismo defecto las encontrará
primero, las corregirá y creerá que terminó sin haber tocado la ruta viva. Su hermana
`generarApartadoSectorial` sí sigue viva y se conserva.

## Verificación manual, tras la automática

Generar dos informes de la misma entidad con años gravables distintos y confirmar que III.A y
III.B hablan cada uno de su año; y que un año sin corrida guardada sale con el marcador
`[Actualizar con…]` y su aviso, no con la prosa del año vecino.
