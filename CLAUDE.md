# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Qué es esto

**Sistema PT** — generador de Informes Locales de Precios de Transferencia para Colombia
(arts. 260-1 a 260-11 E.T., Decreto 2120 de 2017, BEPS Acción 13). Produce el Informe Local
en Word/HTML, la Declaración Informativa (Formulario 120) y el Formato 1125 (Word/CSV/XML).

El código, los comentarios, la UI y los documentos de `docs/` están en español. Manténlo así.

## Comandos

```bash
npm run build          # sync-index.js (raíz→public) + build de frontend/ (Vite→public/gestor-reportes)
npm start              # corre build (prestart) y levanta server.js en :3000
npm run dev  --prefix frontend    # Vite dev server del gestor de reportes, proxy /api → :3000
npm run lint --prefix frontend    # oxlint (única herramienta de lint del repo)
npm test               # node --test sobre scripts/lib/ — cubre solo los helpers de scripts/
firebase deploy        # hosting + functions; el predeploy dispara `npm run build`
```

**La aplicación no tiene tests.** `npm test` cubre únicamente los helpers de `scripts/lib/`;
nada de `index.html` ni de `frontend/` está bajo test. Para un cambio en la aplicación la
verificación es: (a) `grep` de que ningún símbolo eliminado siga referenciado, y (b) prueba
manual en el navegador. No afirmes que algo "pasa los tests" apoyándote en `npm test` si
tocaste la aplicación; describe qué verificaste y cómo.

## Regla crítica de edición

`index.html` (raíz) es la **fuente**; `public/index.html` es un **artefacto generado**
(`scripts/sync-index.js` copia raíz→public, nunca al revés). Editar `public/index.html`
directamente produce drift y el cambio se pierde en el siguiente `npm run build`.
`public/vendor/` (pdf.js, `pdf.min.js`, `pdf.worker.min.js`) **no** sigue esa regla: no hay
`vendor/` en la raíz del repo, así que `scripts/sync-index.js` nunca copia nada ahí (el copiado
`vendor/` → `public/vendor/` solo se dispara si existe una carpeta `vendor/` en la raíz).
`public/vendor/` está commiteado directamente y se edita ahí mismo.

## Arquitectura

### Dos aplicaciones conviviendo

1. **Sistema PT (`index.html`)** — la aplicación principal y activa. Monolito de ~13 000
   líneas: HTML + CSS + JavaScript vanilla en un solo archivo. Sin framework, sin bundler,
   sin módulos. Se sirve en `/`.
2. **Gestor de Reportes (`frontend/`)** — app React 19 + Vite + Tailwind 4, servida bajo
   `/gestor-reportes/` (`vite.config.js` fija `base` y `outDir: ../public/gestor-reportes`).
   Reimplementación parcial y más joven del mismo dominio (ver `frontend/src/services/`,
   que porta lógica de `index.html`). No es un reemplazo terminado: el trabajo del día a día
   ocurre casi siempre en `index.html`.

### Estructura interna de `index.html`

Entender esto es indispensable antes de tocar el archivo:

- **Script principal** (`<script>` ~1925–6114): estado global (`studies`, `active`, `MATRIX`,
  `DESCS`, `MOTOR`), utilidades (`$`, `num`, `escH`, `calc`/`calcD`), persistencia
  (`stSet`/`stGet`/`stDel`/`stList`), motor de comparables (`moRows`, `moScore`, `moCfg`),
  exportaciones (Word, 1125, 120), ingesta documental y llamadas a IA.
- **`window.ORQ_OCR`** (~6151–6312): OCR sobre PDFs. PDF con capa de texto → extracción
  directa vía pdf.js (`public/vendor/pdfjs/`); PDF escaneado → rasteriza a canvas y usa
  tesseract.js cargado perezosamente desde CDN.
- **~20 bloques `PARCHE PT — Bloque N`** (~6316–13232): IIFEs que se cargan *después* del
  script principal y **reasignan funciones globales** para corregir o extender el
  comportamiento base sin tocar el código original. Es un patrón deliberado y reversible
  (quitar el `<script>` revierte el parche), no deuda accidental.

Consecuencias prácticas:

- Una función puede estar **redefinida varias veces**. Antes de editar, `grep` de todas las
  definiciones y determina **cuál es la última que gana en tiempo de ejecución** — editar la
  primera suele no tener efecto.
- Algunas funciones son **cadenas de decoradores** (`window.ptContextoCompleto` se envuelve
  tres veces guardando la anterior en `_ctxPrev`). Ahí sí importan todas las capas.
- Los **números de línea se mueven constantemente**. Localiza el texto exacto con Grep/Read
  en el momento de editar; nunca confíes en una línea citada en un plan o spec.

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

### Persistencia

Sin base de datos. Todo vive en el navegador.

- `index.html`: abstracción `stSet/stGet/stDel/stList` con fallback en cascada
  `window.storage` → `localStorage` → objeto en memoria. Claves `pt:study:<slug-entidad>:<año>`.
  Una auto-limpieza cada 24 h conserva solo los `autoSaveConfig.keepOldStudies` estudios más
  recientes (hoy 500; `nota para programador.md` y `parche_keepOldStudies.patch` documentan
  el ajuste, ya aplicado).
- `frontend/`: `localStorage` directo, con **otro esquema** — `pt:study:<id>` para el detalle
  y `pt:study:index` para el índice. Los dos esquemas no son intercambiables.

### Respuestas de IA

Los modelos devuelven JSON envuelto en prosa o markdown con frecuencia. `index.html` incluye
`extraerJSONDeRespuestaIA(texto)`, que escanea llaves balanceadas respetando cadenas. Úsala
en lugar de `JSON.parse(texto.replace(fences).trim())`, que falla en cuanto el modelo agrega
una palabra después del JSON.

## Flujo de trabajo documentado

`docs/superpowers/specs/` guarda diseños y `docs/superpowers/plans/` los planes de
implementación derivados, nombrados `YYYY-MM-DD-tema[-design].md`. Los specs verifican cada
afirmación contra el código antes de proponer cambios (incluyendo marcar como falsas las que
no se sostienen). Si vas a implementar algo descrito ahí, lee el spec y el plan primero, y
respeta su alcance.

## Trabajo en equipo

Cada quien trabaja en su rama (`juandev` y las que definan los demás) sobre un `index.html`
que todos editan. Correr:

```
/revisar-ramas-equipo
```

Trae `main` y las ramas remotas de los compañeros, reporta qué cambió cada una **mapeado al
bloque concreto de `index.html` que toca** —no "conflicto en index.html", que en 13 000 líneas
no informa nada— e integra en el orden que emite el escaneo: **`main` primero** y después los
compañeros de menor a mayor solapamiento, abortando ante cualquier conflicto fuera de
`public/index.html` y `public/gestor-reportes/` (los únicos artefactos que regenera
`npm run build`; `public/vendor/` está commiteado directamente y no es generado).

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
  `Cpanel/.../Sistema PT V3 5.html` son snapshots/experimentos, no fuentes vivas.
- `build-wizard.ps1` genera un `index-wizard.html` a partir de `index.html`; no forma parte
  de `npm run build` ni del deploy.
- `brain_estudio_pasado.txt` (180 KB) es material de referencia de un estudio previo.
