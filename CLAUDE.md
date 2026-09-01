# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es esto

**Sistema PT** — generador de Informes Locales de Precios de Transferencia para Colombia
(arts. 260-1 a 260-11 E.T., Decreto 2120 de 2017, BEPS Acción 13). Produce el Informe Local
en Word/HTML, la Declaración Informativa (Formulario 120) y el Formato 1125 (Word/CSV/XML).

El código, los comentarios, la UI y los documentos de `docs/` están en español. Manténlo así.

## Comandos

```bash
npm run build          # build de frontend/ (Vite → public/gestor-reportes)
npm start              # corre build (prestart) y levanta server.js en :3000
npm run dev  --prefix frontend    # Vite dev server del gestor de reportes, proxy /api → :3000
npm run lint --prefix frontend    # oxlint (única herramienta de lint del repo)
npm test               # corre la suite de pruebas unitarias sobre scripts/lib/, frontend/src/services/, frontend/src/utils/ y functions/
firebase deploy        # hosting + functions; el predeploy dispara `npm run build`
node frontend/smoke_panel.mjs     # render de los componentes con datos reales (SSR con Vite)
```

**Verificación de la interfaz sin navegador.** `frontend/smoke_panel.mjs` carga los componentes
reales con el SSR de Vite y los renderiza con el cribado de Capital IQ y las cifras de un EEFF
real, comprobando lo que sale en el HTML. No sustituye al navegador —no hay eventos, ni CSS, ni
sesión de Firebase— pero sí atrapa lo que ni el build ni `npm test` ven: un error en la ruta de
render, un símbolo que no resuelve, un número sin formato. Encontró exactamente eso al escribirse
(cifras del paso 2 sin separador de miles). Si el cribado de Drive no está a mano, cae a un
universo sintético del mismo tamaño y corre igual.

**La aplicación tiene pruebas unitarias integradas.** `npm test` ejecuta los casos de prueba sobre `scripts/lib/`, los servicios puros en `frontend/src/services/` (por ejemplo, el motor de rango, cálculos, parser y vocabulario de plantillas), las utilidades en `frontend/src/utils/` y las funciones de Firebase en `functions/` (~2.480 pruebas al 2026-09-01). Para un cambio en estos servicios, la suite debe quedar al 100 % en verde. Para cambios puramente visuales, la verificación sigue siendo manual en el navegador.

## Arquitectura

**Gestor de Reportes (`frontend/`)** — app React 19 + Vite + Tailwind 4. Hasta el
2026-08-13 convivía con un monolito legado, **Sistema PT** (`index.html` en la raíz,
~13 000 líneas de HTML/CSS/JS vanilla, servido en `/`); se eliminó por decisión del
usuario y `frontend/` pasó a servirse también en la raíz del dominio (antes solo bajo
`/gestor-reportes/`; `vite.config.js` sigue fijando `base` y `outDir: ../public/gestor-reportes`,
y `firebase.json`/`server.js` reescriben `/` y cualquier ruta no reconocida hacia
`/gestor-reportes/index.html`). `frontend/src/services/` porta la lógica que antes
vivía en aquel archivo — es el único código vivo del dominio ahora.

### Backend: tres implementaciones del mismo proxy

El navegador nunca habla directo con Anthropic ni con Google. Siempre pasa por un proxy que
guarda las API keys. Existen **tres implementaciones paralelas de los mismos endpoints** y
deben mantenerse sincronizadas al cambiar prompts o contratos:

| Destino | Archivo | Secretos |
|---|---|---|
| Local / red interna | `server.js` (Express) | `.env` (`ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `PORT`) |
| Firebase (producción) | `functions/index.js` (Functions v2, `us-central1`, `timeoutSeconds: 180`) | Secret Manager vía `defineSecret` |
| Hosting cPanel (legado) | `Cpanel/public_html/api/*.php` + `.htaccess` | `api/config.php` (gitignored) |

Endpoints: `POST /api/claude`, `POST /api/gemini`, `POST /api/extraer-rut`,
`POST /api/extraer-camara` (+ `GET /api/estado`, solo en `server.js`, para el panel
"Probar conector"). `firebase.json` mapea cada ruta a su función.

**Reparto de modelos por costo:** Claude (`claude-haiku-4-5` por defecto, `claude-sonnet-5`
en la redacción pesada) para redacción y razonamiento; Gemini (`gemini-3-flash-preview`)
para lectura/OCR de documentos — es notablemente más barato en esa tarea. Los prompts de
extracción de RUT y Cámara de Comercio están **duplicados literalmente** en `server.js`,
`functions/index.js` y el PHP: al ajustar uno, ajusta los tres.

**Fallback de Claude a Gemini.** Si Anthropic no puede atender —sin saldo (400/402 con
`credit balance`), con el tope de gasto de la cuenta alcanzado (400 con `usage limits`, el
que fija la propia organización en la consola), con el límite de peticiones alcanzado (429)
o sobrecargado (529)—,
`/api/claude` atiende con Gemini y **devuelve la respuesta con forma de Anthropic**
(`content[].text`), porque así la leen los catorce llamadores. NO se cae en un 400 por
petición mal formada ni en un 401 por key inválida: fallarían igual en Gemini y taparlo
enmascara un defecto propio. Quién atendió se publica en la cabecera `X-Proveedor-IA` y en
el campo `proveedor` de la respuesta. La lógica es pura y vive en
`functions/fallbackGemini.js` (probada en `functions/fallbackGemini.test.js`); `server.js`
la requiere desde ahí, así que esas dos no pueden divergir. El PHP
(`Cpanel/public_html/api/fallback-gemini.php`) **sí** es un port a mano: al cambiar la
lógica, cámbialo también.

### Dos entornos: producción y pruebas

| Entorno | Proyecto Firebase | URL | Despliegue |
|---|---|---|---|
| Producción | `precios-trasnferencia` | https://precios-trasnferencia.web.app | `firebase deploy` |
| Pruebas | `precios-trasnferencia-pruebas` | https://precios-trasnferencia-pruebas.web.app | `firebase deploy -P pruebas` |

Los alias están en `.firebaserc`. Pruebas es un proyecto aparte y completo: su propio
Firestore, su propio Auth, sus propias functions y su propio bucket, así que nada de lo que
se pruebe ahí toca los estudios reales. Las **API keys de IA sí son las mismas** (decisión
del 2026-08-20), de modo que probar descuenta del mismo tope de Anthropic y de Gemini que
usa producción.

**Un solo bundle sirve a los dos.** El proyecto se resuelve en tiempo de ejecución por el
dominio, en `frontend/src/services/firebase.js`; no hay `vite build --mode pruebas` porque
las dos compilaciones irían al mismo `public/gestor-reportes`, que está trackeado en git, y
el bundle de pruebas quedaría a un `git commit` de publicarse en producción apuntando a la
base de pruebas. Las llamadas a `/api/*` son relativas y las resuelve el rewrite de cada
proyecto; la única URL absoluta —`URL_ANALISIS_SECTOR` en `ReporteGenerador.jsx`— se
construye con `projectIdFirebase`. Para apuntar el `npm run dev` local a pruebas:
`localStorage.setItem('pt:entorno-firebase', 'pruebas')` en la consola del navegador.

**El CORS del bucket de pruebas se aplica a mano**, igual que se hizo en producción y por lo
que explica `storage.rules`: `firebase deploy` no lo toca.

```bash
gcloud storage buckets update gs://precios-trasnferencia-pruebas.firebasestorage.app --cors-file=storage.cors.json
```

La corrida programada `actualizarAnalisisMercadoScheduled` existe en los dos proyectos: una
vez al mes (día 10, 6:00 Bogotá) y en pruebas gasta cuota de IA como en producción. Si
molesta, pausar su job en Cloud Scheduler en lugar de retirarla del código.

### Persistencia

Sin base de datos por defecto: `localStorage` directo, con `pt:study:<id>` para el
detalle de cada estudio y `pt:study:index` para el índice. También hay respaldo en
Firestore por usuario (`usuarios/{uid}/estudios/{id}`, ver `firestoreRepo.js`).

### Respuestas de IA

Los modelos devuelven JSON envuelto en prosa o markdown con frecuencia. `comparablesEngine.js`
incluye `extraerJSON(texto)`, que escanea llaves balanceadas respetando cadenas. Úsala en
lugar de `JSON.parse(texto.replace(fences).trim())`, que falla en cuanto el modelo agrega una
palabra después del JSON.

## Flujo de trabajo documentado

`docs/superpowers/specs/` guarda diseños y `docs/superpowers/plans/` los planes de
implementación derivados, nombrados `YYYY-MM-DD-tema[-design].md`. Los specs verifican cada
afirmación contra el código antes de proponer cambios (incluyendo marcar como falsas las que
no se sostienen). Si vas a implementar algo descrito ahí, lee el spec y el plan primero, y
respeta su alcance.

## Trabajo en equipo

Cada quien trabaja en su rama (`juandev` y las que definan los demás) sobre el mismo
repo. Correr:

```
/revisar-ramas-equipo
```

Trae `main` y las ramas remotas de los compañeros, reporta qué cambió cada una e integra
en el orden que emite el escaneo: **`main` primero** y después los compañeros de menor a
mayor solapamiento, abortando ante cualquier conflicto fuera de `public/gestor-reportes/`
(el único artefacto que regenera `npm run build`).

El mapeo por **bloque de `index.html`** que hacía `scripts/revisar-ramas.js` quedó sin
efecto al retirar ese archivo (2026-08-13): el script sigue corriendo —degrada a no
reportar bloques, no falla—, pero esa parte de su lógica (`etiquetasDeHunks`,
`bloques_en_conflicto_potencial`) es código muerto hasta que alguien la retire o la
adapte a `frontend/`.

**Dos momentos, no uno:** al empezar un spec o feature, para no duplicar trabajo, y otra vez
al cerrarlo antes del merge, para integrar limpio lo que los demás publicaron mientras duraba.
Correrla solo al arrancar deja una ventana abierta y la integración llega sucia.

`main` se trata como una rama más y no como un contador: quedarse atrás del tronco ensucia
la siguiente integración igual que quedarse atrás de un compañero, y va primero porque las
ramas de los compañeros suelen traerlo ya mergeado.

No requiere instalación. Vive en `.claude/skills/` y llega con `git pull`.

Su parte determinista es `scripts/revisar-ramas.js`, que solo lee y se puede correr suelto
si se quiere el JSON crudo.

**Si `git fetch` falla con `bad object refs/desktop.ini`**, es Google Drive: crea
`desktop.ini` dentro de `.git/refs/` y git los lee como refs corruptas. `.gitignore` no cubre
`.git/`, así que se repite en cada sincronización. Limpiar con
`find .git -name desktop.ini -delete`.

## Notas sueltas

- `prueba.html`, `Sistema PT con OCR.html`, `mockup-comparables.html` y
  `Cpanel/.../Sistema PT V3 5.html` son snapshots/experimentos, no fuentes vivas — no
  dependen del `index.html` de la raíz, que se eliminó (2026-08-13).
- `build-wizard.ps1` generaba un `index-wizard.html` a partir del `index.html` de la
  raíz; con ese archivo retirado, el script ya no tiene fuente y quedó roto. No formaba
  parte de `npm run build` ni del deploy, así que no bloquea nada, pero hay que retirarlo
  o adaptarlo si alguien lo vuelve a necesitar.
- `Cpanel/public_html/` sirve el mismo dominio de forma legada, fuera de Firebase; ahí
  puede seguir habiendo copias del `index.html` retirado (p. ej. `Cpanel/public_html/demo-precios-transferencia/index.html`)
  que este cambio no tocó.
- `brain_estudio_pasado.txt` (180 KB) es material de referencia de un estudio previo.
