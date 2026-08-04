# Análisis de mercado con IA (Sección III — III.A y III.B)

## Origen

`frontend/src/services/analisisMercado.js` (commit `fc0ca45`) corrigió que las 12 páginas de
TENDENCIAS DE LA ECONOMÍA salieran literales del informe de End Game Interactive 2024 (sector
videojuegos) para cualquier cliente. Reconstruye las 8 tablas macro por año gravable y el
apartado sectorial (III.C) con la actividad real del contribuyente.

Quedó una asimetría: las **tablas** se regeneran, pero los **párrafos narrativos** que las
preceden —III.A "Análisis del Panorama de la Economía Mundial" y III.B "Análisis del panorama
de la economía colombiana"— no tienen ninguna regla de reemplazo en `exactTemplateMapper.js` y
salen tal cual del informe de End Game (hablando de 2023-2024, Ucrania-Rusia, aranceles de
EE.UU., etc.), sin importar el cliente ni el año del estudio.

Además, `DATOS_MACRO` —la fuente de las 8 tablas— es una constante fija en el código, cargada
una vez y nunca refrescada. Se verificó contra fuentes reales (agosto de 2026) y **mezcla
cifras correctas con cifras obsoletas**, sin manera de distinguir cuáles son cuáles:

| Serie | Valor en `DATOS_MACRO` | Valor real verificado | Estado |
|---|---|---|---|
| Tasa de intervención Banrep, dic-2026 | 6.75 % | Banrep la mantuvo en **12 %** en agosto de 2026 | Muy desactualizado — la tabla asume que las tasas bajaban, y subieron |
| PIB Colombia 2026 (proyección FMI) | 3.0 % | FMI la revisó a **2.3 %** en su reporte de abril de 2026 | Desactualizado — quedó con la cifra de un reporte anterior |
| Inflación Colombia 2024 / 2025 | 5.2 % / 5.1 % | DANE confirmó exactamente 5.2 % (dic-2024) y 5.1 % (dic-2025) | Correcto |
| TRM promedio 2025 | 4120 | Cierre fuertemente bajista (4.409 → 3.757 en el año); el promedio real está cerca pero sin fuente verificable adjunta | Aproximado, sin fecha de consulta |

Esto es exactamente el vicio que el numeral 4 del artículo 1.2.2.2.1.5 del Decreto 1625 de
2016 exige evitar (fuente y fecha de consulta por cifra), aplicado ahora a los valores mismos y
no solo a su fecha de verificación.

## Alcance

**Dentro de este spec:**
- Generar la narrativa extensa de III.A (economía mundial) y III.B (economía colombiana),
  sustentada con búsquedas reales (Google Search vía Gemini grounding) y redactada por Claude.
- Mantener frescas las 8 series de `DATOS_MACRO` con el mismo mecanismo de búsqueda.
- Refresco **mensual, en segundo plano** (Cloud Scheduler vía Firebase Functions v2), no en
  vivo por cada informe generado.
- Persistencia en Firestore (colección nueva), reutilizando la base ya provisionada
  (`firestore.rules`, `firestore.indexes.json`) para `estudios`/`clientes`/etc.

**Fuera de alcance (queda para después):**
- El apartado sectorial III.C — sigue con su reemplazo genérico actual y su marcador
  `[Actualizar con los indicadores sectoriales...]`.
- Alertas activas si el cron falla (correo, Slack). Para v1 basta con Cloud Logging: es un cron
  mensual, no una ruta crítica de cara al usuario en el momento en que falla.
- Cambios a `index.html`/Sistema PT — todo el desarrollo nuevo vive en `frontend/`, por decisión
  ya registrada en `CLAUDE.md` (2026-07-31).

## Decisiones tomadas

| Decisión | Elegido | Descartado | Por qué |
|---|---|---|---|
| Cadencia de refresco | Mensual, en segundo plano (caché) | Al vuelo en cada generación de informe | Generación de informe se mantiene instantánea; un cron mensual ya corrige el problema real (datos que llevan meses o años sin tocarse), sin latencia ni costo por informe |
| Motor de búsqueda | Gemini con Google Search grounding | Web search tool nativo de Claude; API de Google Custom Search + scraping propio | Sigue el reparto de costos ya establecido en el proyecto (Gemini barato para lectura, Claude para redacción); el grounding de Gemini expone las URLs que realmente consultó, sin agregar secretos ni infraestructura nueva |
| Redacción del párrafo final | Claude Sonnet, a partir de las cifras+fuentes que ya trajo Gemini | Que el mismo Gemini redactara el párrafo | Separa "buscar hechos verificados" de "redactar prosa extensa"; Claude nunca inventa una cifra porque no busca, solo redacta sobre lo que el paso 1 ya verificó |
| Persistencia | Firestore (colección nueva `analisisMercado`) | Seguir con la constante en código; un JSON servido como asset estático | Reutiliza infraestructura ya provisionada (Auth, reglas, Functions v2 con Admin SDK); permite guardar historial mensual auditable |
| Firmas de los generadores de tabla | Reciben los datos macro como parámetro | Seguir leyendo el `DATOS_MACRO` importado del módulo | Permite que el mismo generador sirva con datos de Firestore o con el respaldo local mínimo si Firestore no responde |

## Diseño

### 1. Piezas

```
Cloud Scheduler (mensual)
  └─> functions/index.js: actualizarAnalisisMercado (onSchedule, Functions v2)
        1. Gemini + Google Search grounding → cifras y fuentes verificadas por serie
        2. Claude Sonnet → redacta III.A y III.B a partir de esas cifras
        └─> Firestore: analisisMercado/actual (+ historial/{YYYY-MM})

frontend/src/services/firestoreRepo.js
  └─> leerAnalisisMercado() — lee analisisMercado/actual, una vez por sesión

frontend/src/services/analisisMercado.js
  └─> generadores de tabla reciben los datos por parámetro (antes: import fijo)
  └─> generarApartadoMundial() / generarApartadoColombia() (nuevas, análogas a
      generarApartadoSectorial)

frontend/src/services/exactTemplateMapper.js
  └─> reemplazarApartadoMundial() / reemplazarApartadoColombia() (nuevas, mismo
      patrón que reemplazarApartadoSectorial: delimitan por ancla de Word)

frontend/src/components/ReporteGenerador.jsx
  └─> llama leerAnalisisMercado() al montar; pasa el resultado (o su ausencia) al
      hidratador; extiende avisosDeMercado con el estado del refresco
```

### 2. Esquema de Firestore

```
analisisMercado/actual
{
  actualizadoEn: Timestamp,
  series: {
    pib_mundial:            { valores: { "2024": "3.3", "2025": "3.2", "2026": "3.2", "2027": "3.1" }, fuente: "FMI, WEO", fuenteUrl: "...", fechaConsulta: Timestamp },
    pib_colombia:           { valores: {...}, fuente, fuenteUrl, fechaConsulta },
    inflacion_global:       { valores: {...}, fuente, fuenteUrl, fechaConsulta },
    inflacion_colombia:     { valores: {...}, fuente, fuenteUrl, fechaConsulta },
    tasa_intervencion:      { valores: { "2025": { etiqueta: "Diciembre 2025", valor: "..." }, ... }, fuente, fuenteUrl, fechaConsulta },
    trm_promedio:           { valores: {...}, fuente, fuenteUrl, fechaConsulta },
    desempleo_colombia:     { valores: {...}, fuente, fuenteUrl, fechaConsulta },
    crecimiento_por_region: { valores: { "2026": [["Mundial","3.0"], ...] }, fuente, fuenteUrl, fechaConsulta },
  },
  narrativa: {
    mundial: "<p>...</p><p>...</p>...",   // HTML, extenso, listo para inyectar
    colombia: "<p>...</p>...",
    fuentesCitadas: [{ titulo, url }, ...]
  }
}

analisisMercado/historial/{YYYY-MM}   // copia congelada de cada corrida, para auditoría
```

**Ventana de años:** cada serie debe cubrir al menos año actual − 2 hasta año actual + 1 (igual
de ancha que la `DATOS_MACRO` de hoy), porque el año gravable de un estudio puede ir un poco
detrás del año calendario en que se genera el informe. El prompt del paso 1 pide ese rango
completo, no solo el dato puntual de hoy.

**Reglas Firestore** (mismo patrón whitelist que `estudios`/`clientes`):
```
match /analisisMercado/{doc} {
  allow read: if esMiembro();
  allow write: if false;  // solo la Cloud Function, vía Admin SDK, que no pasa por reglas
}
```

### 3. La función programada

`functions/index.js`, junto a `claude`/`gemini`/`extraerRut`/`extraerCamara`:

```js
exports.actualizarAnalisisMercado = onSchedule(
  { schedule: '0 6 1 * *', timeZone: 'America/Bogota', secrets: [GEMINI_API_KEY, ANTHROPIC_API_KEY] },
  async () => { ... }
);
```

Flujo:

1. **Gemini + Google Search grounding.** Un prompt (o varios, agrupando series relacionadas)
   pide el valor vigente de cada serie para la ventana de años definida arriba, con instrucción
   explícita de usar la búsqueda y no inventar; si no hay dato confiable para una serie, debe
   decirlo en vez de rellenar con un número. La respuesta se parsea a JSON (helper equivalente a
   `extraerJSONDeRespuestaIA` de `index.html`, reimplementado aquí porque `functions/` no
   comparte código con `frontend/src`). Los `groundingChunks` de la respuesta —no una URL que el
   modelo redacte de memoria— son la `fuenteUrl` que se guarda.
2. **Claude Sonnet.** Recibe las cifras+fuentes ya verificadas del paso 1 y redacta el párrafo
   extenso de III.A y III.B, citando esas fuentes, con instrucción de no introducir ninguna
   cifra que no venga del paso 1.
3. **Guardado atómico.** Solo si ambos pasos tuvieron éxito se escribe `analisisMercado/actual`
   y `analisisMercado/historial/{YYYY-MM}`. Si cualquiera falla, no se toca lo existente y el
   error queda en Cloud Logging — se prefiere un dato de un mes atrás a uno corrupto a mitad de
   escritura.

La lógica de armar el documento a partir de las respuestas ya parseadas de Gemini/Claude se
separa en una función pura, testeable sin red — mismo patrón que ya usan
`firestoreModelo.js`/`firestoreRepo.js` (lógica de negocio bajo test, llamadas al SDK aparte).

### 4. Cambios en el frontend

**`analisisMercado.js`:** las 8 funciones generadoras cambian de firma —
`generarTablaPibMundial(datos, year, wrap)` en vez de leer `DATOS_MACRO` importado— para poder
alimentarlas tanto con lo que traiga Firestore como con el respaldo local si Firestore no
responde. Se agregan `generarApartadoMundial(narrativa, year, wrap)` y
`generarApartadoColombia(narrativa, year, wrap)`, análogas a `generarApartadoSectorial`: insertan
el HTML ya redactado, o el marcador `[Actualizar con...]` si no hay narrativa disponible.

**`exactTemplateMapper.js`:** dos reemplazos de apartado nuevos, mismo patrón que
`reemplazarApartadoSectorial` — delimitados por las anclas de Word ya presentes en la plantilla
(`_Toc208930977` para III.A, `_Toc208930978` para III.B), conservando `<a id>` y la estructura
`<ol><li>`.

**`ReporteGenerador.jsx`:** llama `leerAnalisisMercado()` al montar y pasa el resultado (o su
ausencia) a `hydrateExactWordTemplate`. `avisosDeMercado` se extiende con dos casos nuevos:
"el dato macro tiene más de ~2 meses" (el cron falló dos veces seguidas) y "no se pudo leer
Firestore, se usó el respaldo local embebido en el código".

**Respaldo sin Firestore:** si la lectura falla o el documento no existe aún (primera vez, antes
de la primera corrida del cron), se usa como piso mínimo el `DATOS_MACRO` que hoy vive en el
código — ya no se autoactualiza, pero evita que el informe se rompa — y el aviso lo deja
explícito.

## Manejo de errores (resumen)

- Escritura en Firestore solo si Gemini y Claude tuvieron éxito los dos; si no, se conserva el
  mes anterior.
- Serie sin fuente confiable → marcador de pendiente, nunca una cifra inventada (mismo criterio
  que ya rige hoy en `valorODisponible`).
- Dato con más de ~2 meses de antigüedad al generar un informe → aviso visible.
- Firestore no disponible → respaldo local embebido + aviso.

## Testing

- `analisisMercado.test.js` se actualiza para las nuevas firmas (datos por parámetro) y cubre
  `generarApartadoMundial`/`generarApartadoColombia`, con y sin narrativa disponible.
- La función pura que arma el documento de Firestore a partir de respuestas ya parseadas entra a
  `npm test` (que ya corre `frontend/src/services/*.test.js` con `node --test` — el dato de
  `CLAUDE.md` de que `npm test` cubre solo `scripts/lib` está desactualizado). Las llamadas de
  red reales a Gemini/Claude/Firestore no se testean automatizado.
- Verificación manual: disparar la función una vez, confirmar en Firestore que `series` y
  `narrativa` quedaron pobladas con fuente y fecha de consulta; generar un informe y confirmar
  que III.A/III.B ya no mencionan End Game/Ucrania-Rusia/2023, sino contenido actual y coherente
  con el año del estudio.
