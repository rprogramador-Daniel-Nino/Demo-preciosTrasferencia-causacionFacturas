# Imágenes persistentes desde el PDF de referencia — Plan 1 de 2

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que las imágenes del informe de referencia sobrevivan a una recarga de la página —el fallo que motivó todo— y que el informe generado para un cliente deje de llevar dentro el NIT y las cifras de End Game.

**Architecture:** Tres piezas nuevas en `frontend/src/services/`, todas con una responsabilidad y sin conocerse entre sí: un clasificador puro de imágenes, un extractor que lee el PDF con pdf.js, y un almacén sobre IndexedDB. Se cablean en `ReporteGenerador.jsx`, que hoy guarda el HTML en `useState` y lo pierde al recargar. La contención de la fuga de datos va primero y es independiente del resto.

**Tech Stack:** React 19 + Vite, ESM. `pdfjs-dist` como dependencia nueva de `frontend/`. Tests con el runner integrado de Node.

Implementa `docs/superpowers/specs/2026-07-31-plantilla-marcada-e-imagenes-design.md`, secciones 0, 2 y 5. El marcado por IA, la pantalla de revisión y el renderizador por campos son el plan 2.

## Global Constraints

- **Idioma:** todo el código, los comentarios y la documentación en español. Es la convención del repo.
- **`frontend/` es ESM.** Su `package.json` declara `"type": "module"`: se usa `import`/`export`, nunca `require`. (`scripts/` sí es CommonJS — no confundir.)
- **Comando de tests:** `npm test` desde la raíz, que tras la Task 1 será
  `node --test "scripts/lib/*.test.js" "frontend/src/services/*.test.js"`. Verificado: una sola invocación mezcla CommonJS y ESM sin problema.
- **Los 27 tests que ya existen en `scripts/lib/` deben seguir pasando** después de cada tarea.
- **No editar `public/index.html` ni `public/gestor-reportes/` a mano.** Son artefactos de `npm run build`.
- **Sin trailer `Co-Authored-By`** en los mensajes de commit.
- **`npm install` hace falta** en la raíz y en `frontend/`: hoy no hay `node_modules` y `npm run build` falla con "vite no se reconoce".
- Fixture de test versionado: `Cpanel/public_html/demo-precios-transferencia/Archivos Prueba/estudio pasado.pdf` — 112 páginas, 20 imágenes embebidas.

---

### Task 1: Contener la fuga de datos de End Game

Independiente del resto del plan y entregable por sí sola. `exactTemplateMapper.js` sustituye por valor literal: lo que no tiene una regla escrita a mano sobrevive del cliente anterior. Seis cifras no la tienen.

**Files:**
- Modify: `frontend/src/services/exactTemplateMapper.js`
- Create: `frontend/src/services/exactTemplateMapper.test.js`
- Modify: `package.json` (raíz) — ampliar el script `test`

**Interfaces:**
- Consumes: `hydrateExactWordTemplate(rawHtml, study)`, ya existente.
- Produces: nada nuevo. Se retira entero en el plan 2.

- [ ] **Step 1: Ampliar el script de tests**

En `package.json` de la raíz, buscar:

```json
    "test": "node --test \"scripts/lib/*.test.js\""
```

Reemplazar por:

```json
    "test": "node --test \"scripts/lib/*.test.js\" \"frontend/src/services/*.test.js\""
```

- [ ] **Step 2: Escribir los tests que fallan**

Crear `frontend/src/services/exactTemplateMapper.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { hydrateExactWordTemplate } from './exactTemplateMapper.js';

/* Estudio de un cliente que NO es End Game. Todo lo que salga con datos de
   End Game en la salida es una fuga. */
const otroCliente = {
  ent: 'ACME COLOMBIA S.A.S',
  nit: '800123456-7',
  anio: 2025,
  t_inv_assoc: 5000000,
  t_intang: 111111,
  t_dif: 222222,
  t_act_nocurr: 5333333,
};

test('el NIT de End Game no sobrevive, y el DV no queda colgando', () => {
  const html = '<p>END GAME INTERACTIVE COLOMBIA S.A.S con NIT 901.337.576-6 es una empresa</p>';
  const salida = hydrateExactWordTemplate(html, otroCliente);
  assert.ok(!salida.includes('901.337.576'), 'el NIT de End Game sigue en la salida');
  assert.ok(!salida.includes('-6'), 'quedó colgando el dígito de verificación de End Game');
  assert.ok(salida.includes('800123456-7'), 'no se insertó el NIT del estudio');
});

test('las cuatro líneas de balance huérfanas se sustituyen', () => {
  const html =
    '<td>1.247.447.456</td><td>4.703.375</td><td>83.801.656</td><td>206.129.230</td>';
  const salida = hydrateExactWordTemplate(html, otroCliente);
  for (const cifra of ['1.247.447.456', '4.703.375', '83.801.656', '206.129.230']) {
    assert.ok(!salida.includes(cifra), 'sobrevivió la cifra de End Game ' + cifra);
  }
  assert.ok(salida.includes('5.000.000'), 'falta Inversiones asociadas del estudio');
  assert.ok(salida.includes('5.333.333'), 'falta Total activos no corrientes del estudio');
});

/* Regresión del error que cometí al analizar: 247.447.456 y 435.357.400 NO son
   cifras independientes, son la cola de 1.247.447.456 y 3.435.357.400. Un
   patrón sin delimitar las reemplazaría por separado y corrompería ambas. */
test('no se parte un número largo por su cola', () => {
  const html = '<td>1.247.447.456</td>';
  const salida = hydrateExactWordTemplate(html, otroCliente);
  assert.ok(!/\d\.?5\.000\.000/.test(salida), 'se sustituyó la cola dejando el prefijo suelto');
  assert.ok(!salida.includes('1.5.000.000'), 'quedó un número corrupto');
});

test('sin datos del estudio no se filtran los de End Game', () => {
  const html = '<p>NIT 901.337.576-6</p><td>4.703.375</td>';
  const salida = hydrateExactWordTemplate(html, {});
  assert.ok(!salida.includes('901.337.576'), 'con estudio vacío sigue el NIT de End Game');
  assert.ok(!salida.includes('4.703.375'), 'con estudio vacío sigue una cifra de End Game');
});
```

- [ ] **Step 3: Correr los tests para verificar que fallan**

Run: `npm test`
Expected: FAIL. Los cuatro tests nuevos fallan; los 27 de `scripts/lib/` siguen pasando.

- [ ] **Step 4: Agregar las reglas faltantes**

En `frontend/src/services/exactTemplateMapper.js`, buscar:

```js
    { target: /2024/g, val: wrap(year) }
  ];
```

Reemplazar por:

```js
    { target: /2024/g, val: wrap(year) },

    /* Cifras que no tenían regla y por eso viajaban de End Game a cualquier
       informe generado con esta plantilla. Los delimitadores (?<![\d.]) y
       (?![\d.]) son obligatorios: sin ellos, "1.247.447.456" se reemplazaría
       por su cola "247.447.456" y quedaría un número corrupto.
       El NIT se captura con su dígito de verificación para no dejarlo colgando. */
    { target: /(?<![\d.])901\.337\.576-\d(?![\d])/g, val: wrap(study.nit || '—') },
    { target: /(?<![\d.])1\.247\.447\.456(?![\d.])/g, val: wrap(study.t_inv_assoc ? fmt(num(study.t_inv_assoc)) : '—') },
    { target: /(?<![\d.])4\.703\.375(?![\d.])/g, val: wrap(study.t_intang ? fmt(num(study.t_intang)) : '—') },
    { target: /(?<![\d.])83\.801\.656(?![\d.])/g, val: wrap(study.t_dif ? fmt(num(study.t_dif)) : '—') },
    { target: /(?<![\d.])206\.129\.230(?![\d.])/g, val: wrap(study.t_act_nocurr ? fmt(num(study.t_act_nocurr)) : '—') }
  ];
```

- [ ] **Step 5: Sustituir el monto del ajuste**

`983.180.000` es el monto del ajuste de plena competencia de End Game y aparece dos veces. Se calcula, no se ingresa, así que va después de que exista `adj`.

Buscar:

```js
  // Reemplazar resultado Cumple/No Cumple
  html = html.replace(/cumple con el principio de plena competencia/gi, `${wrap(cumpleStr)} con el principio de plena competencia`);
```

Reemplazar por:

```js
  /* Monto del ajuste. Si el estudio está dentro del rango no hay ajuste que
     reportar, pero la frase de la plantilla sí existe: se pone un marcador
     visible en vez de la cifra de End Game. Corregir la redacción de esa frase
     queda para el plan 2, cuando la plantilla tenga campos con nombre. */
  const montoAjuste = adj && !adj.within ? fmt(Math.abs(adj.capped)) : '—';
  html = html.replace(/(?<![\d.])983\.180\.000(?![\d.])/g, wrap(montoAjuste));

  // Reemplazar resultado Cumple/No Cumple
  html = html.replace(/cumple con el principio de plena competencia/gi, `${wrap(cumpleStr)} con el principio de plena competencia`);
```

- [ ] **Step 6: Correr los tests**

Run: `npm test`
Expected: PASS. 31 tests (27 previos + 4 nuevos).

- [ ] **Step 7: Verificar contra la plantilla real**

Run:
```bash
node --input-type=module -e "
import { readFileSync } from 'node:fs';
const { MASTER_WORD_TEMPLATE } = await import('./frontend/src/services/masterTemplate.js');
const { hydrateExactWordTemplate } = await import('./frontend/src/services/exactTemplateMapper.js');
const salida = hydrateExactWordTemplate(MASTER_WORD_TEMPLATE, { ent: 'ACME S.A.S', nit: '800123456-7', anio: 2025 });
const fugas = ['901.337.576','983.180.000','1.247.447.456','4.703.375','83.801.656','206.129.230']
  .filter(c => salida.includes(c));
console.log(fugas.length ? 'SIGUEN FILTRÁNDOSE: ' + fugas.join(', ') : 'ninguna cifra de End Game sobrevive');
"
```

Expected: `ninguna cifra de End Game sobrevive`. Es la verificación que importa: los tests usan HTML de juguete, esto corre contra las 302 KB de plantilla real.

- [ ] **Step 8: Commit**

```bash
git add package.json frontend/src/services/exactTemplateMapper.js frontend/src/services/exactTemplateMapper.test.js
git commit -m "Contener la fuga del NIT y cifras de End Game a otros clientes

La sustitucion de la plantilla es por valor literal, asi que toda cifra sin
una regla escrita a mano sobrevivia del cliente anterior. Seis no la tenian,
incluido el NIT de End Game, en informes que se radican ante la DIAN.

Los patrones van delimitados con (?<![\\d.]) y (?![\\d.]) porque sin eso
1.247.447.456 se reemplazaria por su cola y quedaria corrupto. El NIT se
captura con su digito de verificacion para no dejarlo colgando.

Es contencion, no la solucion: sigue siendo sustitucion por valor y el
proximo dato que alguien agregue volvera a filtrarse. Se retira junto con
este archivo en el plan 2."
```

---

### Task 2: Clasificador de imágenes por superficie renderizada

Función pura, sin pdf.js ni DOM. Decide si una imagen del PDF es una página escaneada o un recurso reutilizable.

**Files:**
- Create: `frontend/src/services/clasificadorImagenes.js`
- Create: `frontend/src/services/clasificadorImagenes.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: `clasificarImagen(render, pagina) => 'pagina' | 'recurso'` donde `render = { ancho, alto }` y `pagina = { ancho, alto }`, ambos en unidades de PDF. Lo consume la Task 4.
- Produces: `UMBRAL_PAGINA = 0.8`, exportado para que el test y el extractor compartan el valor.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `frontend/src/services/clasificadorImagenes.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { clasificarImagen, UMBRAL_PAGINA } from './clasificadorImagenes.js';

/* Carta en unidades PDF: 612 x 792 puntos. */
const CARTA = { ancho: 612, alto: 792 };

test('una imagen que cubre casi toda la página es un escaneo', () => {
  assert.strictEqual(clasificarImagen({ ancho: 600, alto: 780 }, CARTA), 'pagina');
});

test('un logo en una esquina es un recurso', () => {
  assert.strictEqual(clasificarImagen({ ancho: 120, alto: 27 }, CARTA), 'recurso');
});

test('el umbral es inclusivo: justo en 80% cuenta como página', () => {
  const area = CARTA.ancho * CARTA.alto * UMBRAL_PAGINA;
  const lado = Math.sqrt(area);
  assert.strictEqual(clasificarImagen({ ancho: lado, alto: lado }, CARTA), 'pagina');
});

test('justo por debajo del umbral es recurso', () => {
  const area = CARTA.ancho * CARTA.alto * (UMBRAL_PAGINA - 0.01);
  const lado = Math.sqrt(area);
  assert.strictEqual(clasificarImagen({ ancho: lado, alto: lado }, CARTA), 'recurso');
});

/* El criterio es la superficie sobre la página, no los píxeles del archivo:
   un logo en alta resolución tiene más píxeles que un escaneo mediocre pero
   ocupa una esquina. */
test('una página con dimensiones cero no revienta', () => {
  assert.strictEqual(clasificarImagen({ ancho: 100, alto: 100 }, { ancho: 0, alto: 0 }), 'recurso');
});

test('una imagen sin dimensiones es recurso', () => {
  assert.strictEqual(clasificarImagen({ ancho: 0, alto: 0 }, CARTA), 'recurso');
});
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `npm test`
Expected: FAIL con `Cannot find module './clasificadorImagenes.js'`.

- [ ] **Step 3: Implementar**

Crear `frontend/src/services/clasificadorImagenes.js`:

```js
/* Clasificación de las imágenes embebidas en un PDF de referencia.
   Función pura: no toca pdf.js, ni el DOM, ni disco. */

/* Fracción del área de la página a partir de la cual una imagen se considera
   una página escaneada y no un recurso reutilizable. */
export const UMBRAL_PAGINA = 0.8;

/* Decide qué es una imagen a partir del espacio que ocupa sobre la página.
   Se usa la superficie renderizada y no las dimensiones en píxeles del
   archivo: un logo en alta resolución puede tener más píxeles que un escaneo
   mediocre, pero en la página ocupa una esquina. */
export function clasificarImagen(render, pagina) {
  const areaPagina = (pagina?.ancho || 0) * (pagina?.alto || 0);
  const areaRender = (render?.ancho || 0) * (render?.alto || 0);
  if (areaPagina <= 0 || areaRender <= 0) return 'recurso';
  return areaRender / areaPagina >= UMBRAL_PAGINA ? 'pagina' : 'recurso';
}
```

- [ ] **Step 4: Correr los tests**

Run: `npm test`
Expected: PASS. 37 tests (31 previos + 6 nuevos).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/clasificadorImagenes.js frontend/src/services/clasificadorImagenes.test.js
git commit -m "Agregar clasificador de imagenes por superficie renderizada

Separa las paginas escaneadas de los recursos reutilizables por el area que
ocupan sobre la pagina, no por sus pixeles: un logo en alta resolucion tiene
mas pixeles que un escaneo mediocre pero ocupa una esquina."
```

---

### Task 3: Codificador PNG sin dependencias

Las imágenes que pdf.js entrega son muestras crudas, no un formato de archivo. Para guardarlas como data URL hay que empaquetarlas. Es un módulo pequeño y aislado, con su propio test.

**Files:**
- Create: `frontend/src/services/png.js`
- Create: `frontend/src/services/png.test.js`

**Interfaces:**
- Consumes: nada.
- Produces: `crc32(bytes) => number`, `aFilasPNG(rgb, ancho, alto) => Uint8Array`, `codificarPNG(rgb, ancho, alto) => Promise<Uint8Array>`, `aBase64(bytes) => string`. Los consume la Task 4.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `frontend/src/services/png.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { crc32, aFilasPNG, codificarPNG, aBase64 } from './png.js';

/* 0xAE426082 es el CRC del trozo IEND, constante conocida de la
   especificación PNG: sirve de vector de prueba independiente. */
test('crc32 coincide con la constante conocida de IEND', () => {
  assert.strictEqual(crc32(new Uint8Array([0x49, 0x45, 0x4e, 0x44])), 0xae426082);
});

test('aFilasPNG antepone el byte de filtro a cada fila', () => {
  const filas = aFilasPNG(new Uint8Array([1, 2, 3, 4, 5, 6]), 2, 1);
  assert.deepStrictEqual(Array.from(filas), [0, 1, 2, 3, 4, 5, 6]);
});

test('aFilasPNG separa correctamente varias filas', () => {
  const filas = aFilasPNG(new Uint8Array([1, 1, 1, 2, 2, 2]), 1, 2);
  assert.deepStrictEqual(Array.from(filas), [0, 1, 1, 1, 0, 2, 2, 2]);
});

test('codificarPNG produce un archivo con la firma correcta', async () => {
  const rgb = new Uint8Array(4 * 4 * 3).fill(200);
  const png = await codificarPNG(rgb, 4, 4);
  assert.deepStrictEqual(Array.from(png.slice(0, 8)), [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.ok(png.length > 40, 'el PNG salió demasiado corto');
});

test('aBase64 codifica sin depender del entorno', () => {
  assert.strictEqual(aBase64(new Uint8Array([104, 111, 108, 97])), 'aG9sYQ==');
});
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `npm test`
Expected: FAIL con `Cannot find module './png.js'`.

- [ ] **Step 3: Implementar**

Crear `frontend/src/services/png.js`. Este código está verificado: el CRC de `IEND` da la constante de la especificación y el PNG resultante abre correctamente.

```js
/* Codificación PNG mínima y sin dependencias. Solo cubre lo que hace falta
   para guardar una imagen extraída de un PDF como data URL: color RGB de
   8 bits, sin filtro por fila. */

const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = TABLA_CRC[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/* PNG exige un byte de filtro al inicio de cada fila. Se usa 0 (sin filtro):
   comprime algo peor, pero evita toda la maquinaria de predictores. */
export function aFilasPNG(rgb, ancho, alto) {
  const filas = new Uint8Array((ancho * 3 + 1) * alto);
  for (let y = 0; y < alto; y++) {
    const destino = y * (ancho * 3 + 1);
    filas[destino] = 0;
    filas.set(rgb.subarray(y * ancho * 3, (y + 1) * ancho * 3), destino + 1);
  }
  return filas;
}

function trozo(tipo, datos) {
  const salida = new Uint8Array(12 + datos.length);
  const vista = new DataView(salida.buffer);
  vista.setUint32(0, datos.length);
  for (let i = 0; i < 4; i++) salida[4 + i] = tipo.charCodeAt(i);
  salida.set(datos, 8);
  vista.setUint32(8 + datos.length, crc32(salida.subarray(4, 8 + datos.length)));
  return salida;
}

/* CompressionStream('deflate') produce deflate con envoltura zlib, que es
   exactamente lo que espera el trozo IDAT. Está disponible tanto en el
   navegador como en Node 25, así que el mismo código sirve para los tests. */
export async function codificarPNG(rgb, ancho, alto) {
  const filas = aFilasPNG(rgb, ancho, alto);
  const comprimido = new Uint8Array(
    await new Response(
      new Blob([filas]).stream().pipeThrough(new CompressionStream('deflate'))
    ).arrayBuffer()
  );

  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, ancho);
  v.setUint32(4, alto);
  ihdr[8] = 8;  /* bits por canal */
  ihdr[9] = 2;  /* tipo de color: RGB */

  const partes = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozo('IHDR', ihdr),
    trozo('IDAT', comprimido),
    trozo('IEND', new Uint8Array(0)),
  ];
  const png = new Uint8Array(partes.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of partes) { png.set(p, o); o += p.length; }
  return png;
}

/* btoa en el navegador, Buffer en Node: el mismo módulo sirve en ambos. */
export function aBase64(bytes) {
  if (typeof btoa === 'function') {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  return Buffer.from(bytes).toString('base64');
}
```

- [ ] **Step 4: Correr los tests**

Run: `npm test`
Expected: PASS. 42 tests (37 previos + 5 nuevos).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/png.js frontend/src/services/png.test.js
git commit -m "Agregar codificador PNG sin dependencias

pdf.js entrega muestras crudas, no un formato de archivo. Se empaquetan como
PNG para poder guardarlas como data URL. CompressionStream produce deflate
con envoltura zlib, que es lo que pide IDAT, y existe tanto en el navegador
como en Node, asi que el mismo codigo corre en los tests."
```

---

### Task 4: Extractor del PDF de referencia

Lee el PDF con pdf.js y devuelve el HTML de su estructura más el catálogo de imágenes ya clasificadas.

**Files:**
- Modify: `frontend/package.json` — agregar `pdfjs-dist`
- Create: `frontend/src/services/pdfReferenceExtractor.js`
- Create: `frontend/src/services/pdfReferenceExtractor.test.js`

**Interfaces:**
- Consumes: `clasificarImagen` de la Task 2; `codificarPNG` y `aBase64` de la Task 3.
- Produces: `extraerReferencia(datos) => Promise<{ html, imagenes, huecos, paginas, etiquetado }>` donde `datos` es un `Uint8Array`; `imagenes` es un array de `{ id, dataUrl, pagina, orden }`; `huecos` es un array de `{ id, pagina, orden, paginasCubiertas }`. Lo consumen las Tasks 5 y 6.

- [ ] **Step 1: Instalar la dependencia**

Run:
```bash
npm install --prefix frontend pdfjs-dist@^4
node -e "console.log(require('./frontend/package.json').dependencies['pdfjs-dist'])"
```

Expected: imprime la versión instalada. Se fija la mayor 4 a propósito: la API de `getStructTree` y `getOperatorList` es estable ahí, y la 5+ cambió el empaquetado de los workers.

- [ ] **Step 2: Escribir el test que falla**

Crear `frontend/src/services/pdfReferenceExtractor.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { extraerReferencia } from './pdfReferenceExtractor.js';

const RUTA = 'Cpanel/public_html/demo-precios-transferencia/Archivos Prueba/estudio pasado.pdf';

test('extrae el PDF de referencia real', async () => {
  const datos = new Uint8Array(readFileSync(RUTA));
  const r = await extraerReferencia(datos);

  assert.strictEqual(r.paginas, 112, 'número de páginas');
  assert.strictEqual(r.etiquetado, true, 'el PDF de referencia está etiquetado');
  assert.ok(r.html.length > 1000, 'el HTML salió vacío');

  /* Las 16 páginas escaneadas del anexo firmado producen hueco y no se
     guardan: son del ejercicio 2024 y no deben viajar al informe siguiente.
     Los huecos NO dependen de que la imagen se decodifique, solo de su tamaño
     sobre la página, así que esta cuenta sí es fiable fuera del navegador. */
  assert.ok(r.huecos.length >= 10, 'se esperaban huecos por el anexo, hubo ' + r.huecos.length);

  /* Ninguna página escaneada debe haberse colado como recurso reutilizable. */
  assert.ok(r.imagenes.length <= 6, 'se colaron escaneos como recursos: ' + r.imagenes.length);

  /* Toda imagen que SÍ se haya decodificado debe traer una dataUrl válida.
     No se exige un número mínimo: fuera del navegador pdf.js deja sin
     resolver las imágenes que no se renderizan, así que la cuenta exacta
     varía. La verificación de que los dos logos aparecen de verdad es
     manual, en el navegador, en la Task 6. */
  assert.ok(
    r.imagenes.every((i) => typeof i.dataUrl === 'string' && i.dataUrl.startsWith('data:image/')),
    'alguna dataUrl mal formada'
  );
});

test('una imagen que pdf.js no resuelve no cuelga la extracción', async () => {
  /* Regresión: sin límite de tiempo en objs.get, una sola imagen sin resolver
     dejaba la extracción colgada para siempre. Verificado sobre el PDF real:
     3 de 5 imágenes de las primeras páginas no resuelven fuera del navegador. */
  const datos = new Uint8Array(readFileSync(RUTA));
  const r = await extraerReferencia(datos);
  assert.ok(r, 'la extracción no terminó');
});

test('un buffer que no es PDF falla con un mensaje claro', async () => {
  await assert.rejects(
    () => extraerReferencia(new Uint8Array([1, 2, 3, 4])),
    /no se pudo leer el PDF/i
  );
});
```

- [ ] **Step 3: Correr para verificar que falla**

Run: `npm test`
Expected: FAIL con `Cannot find module './pdfReferenceExtractor.js'`.

- [ ] **Step 4: Implementar**

Crear `frontend/src/services/pdfReferenceExtractor.js`:

```js
/* Lectura del PDF que se sube como referencia (el informe del año anterior).
   Devuelve el HTML de su estructura y el catálogo de imágenes clasificadas.
   No conoce el dominio de precios de transferencia ni persiste nada. */

import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { clasificarImagen } from './clasificadorImagenes.js';
import { codificarPNG, aBase64 } from './png.js';

/* Etiquetas del árbol de estructura del PDF y su equivalente en HTML. */
const MAPA_ETIQUETAS = {
  H1: 'h1', H2: 'h2', H3: 'h3', H4: 'h4', H5: 'h5', H6: 'h6',
  P: 'p', L: 'ul', LI: 'li', Table: 'table', TR: 'tr', TD: 'td', TH: 'th',
};

const escapar = (s) =>
  String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* pdf.js resuelve los objetos de imagen mientras renderiza la página. Si no se
   renderiza —caso de los tests, que corren sin canvas—, `objs.get` puede no
   llamar nunca a su callback. Sin este límite la extracción se cuelga entera
   por una sola imagen. Verificado: de 5 imágenes en las primeras 8 páginas del
   PDF de referencia, 3 no resuelven fuera del navegador. */
const TIEMPO_LIMITE_IMAGEN = 5000;

function conTiempoLimite(promesa, ms) {
  return Promise.race([
    promesa,
    new Promise((res) => setTimeout(() => res(null), ms)),
  ]);
}

export async function extraerReferencia(datos) {
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: datos, useSystemFonts: true }).promise;
  } catch (e) {
    throw new Error('no se pudo leer el PDF: ' + e.message);
  }

  const partes = [];
  const imagenes = [];
  const huecos = [];
  let etiquetado = false;

  for (let n = 1; n <= doc.numPages; n++) {
    const pagina = await doc.getPage(n);
    const vista = pagina.getViewport({ scale: 1 });
    const dimPagina = { ancho: vista.width, alto: vista.height };

    /* Estructura. Si el PDF no está etiquetado, getStructTree devuelve null y
       se degrada a texto plano: la plantilla saldrá sin secciones. */
    const arbol = await pagina.getStructTree().catch(() => null);
    const texto = await pagina.getTextContent();
    if (arbol) {
      etiquetado = true;
      partes.push(aHTML(arbol, texto));
    } else {
      partes.push('<p>' + escapar(texto.items.map((i) => i.str).join(' ')) + '</p>');
    }

    /* Imágenes. La matriz del operador da el tamaño renderizado sobre la
       página, que es lo que decide si es un escaneo o un recurso. */
    const ops = await pagina.getOperatorList();
    let orden = 0;
    for (let k = 0; k < ops.fnArray.length; k++) {
      if (ops.fnArray[k] !== pdfjs.OPS.paintImageXObject) continue;
      const [clave] = ops.argsArray[k];
      const m = ops.argsArray[k - 1] && Array.isArray(ops.argsArray[k - 1][0])
        ? ops.argsArray[k - 1][0]
        : null;
      const render = m
        ? { ancho: Math.abs(m[0]), alto: Math.abs(m[3]) }
        : { ancho: 0, alto: 0 };
      orden++;

      if (clasificarImagen(render, dimPagina) === 'pagina') {
        const id = 'hueco_' + n + '_' + orden;
        huecos.push({ id, pagina: n, orden, paginasCubiertas: 1 });
        partes.push('<div data-hueco="anexo_eeff" data-id="' + id + '"></div>');
        continue;
      }

      const dataUrl = await aDataUrl(pagina, clave);
      if (!dataUrl) continue;
      const id = 'img_' + n + '_' + orden;
      imagenes.push({ id, dataUrl, pagina: n, orden });
      partes.push('<img data-recurso="' + id + '" src="' + dataUrl + '" />');
    }
  }

  return { html: partes.join('\n'), imagenes, huecos, paginas: doc.numPages, etiquetado };
}

/* Convierte el nodo de imagen de pdf.js en un data URL PNG. pdf.js entrega
   las muestras ya decodificadas; el número de canales varía según el espacio
   de color del original, así que se normaliza a RGB antes de empaquetar. */
async function aDataUrl(pagina, clave) {
  try {
    const obj = await conTiempoLimite(
      new Promise((res) => pagina.objs.get(clave, res)),
      TIEMPO_LIMITE_IMAGEN
    );
    if (!obj || !obj.width || !obj.height || !obj.data) return null;
    const { width, height, data } = obj;
    const canales = data.length / (width * height);
    if (canales < 1) return null;

    const rgb = new Uint8Array(width * height * 3);
    for (let i = 0; i < width * height; i++) {
      const o = i * canales;
      rgb[i * 3] = data[o];
      rgb[i * 3 + 1] = data[o + (canales > 1 ? 1 : 0)];
      rgb[i * 3 + 2] = data[o + (canales > 2 ? 2 : 0)];
    }
    return 'data:image/png;base64,' + aBase64(await codificarPNG(rgb, width, height));
  } catch (e) {
    return null;
  }
}

/* Recorre el árbol de estructura y emite HTML con la jerarquía del documento. */
function aHTML(nodo, texto) {
  if (!nodo) return '';
  const hijos = (nodo.children || []).map((h) => aHTML(h, texto)).join('');
  const etiqueta = MAPA_ETIQUETAS[nodo.role];
  if (nodo.type === 'content') {
    const item = texto.items.find((i) => i.id === nodo.id);
    return item ? escapar(item.str) : '';
  }
  if (!etiqueta) return hijos;
  return '<' + etiqueta + '>' + hijos + '</' + etiqueta + '>';
}

```

- [ ] **Step 5: Correr los tests**

Run: `npm test`
Expected: PASS. 45 tests (42 previos + 3 nuevos). El primero tarda unos segundos: procesa 112 páginas reales.

- [ ] **Step 6: Verificar el reparto contra el PDF real**

Run:
```bash
node --input-type=module -e "
import { readFileSync } from 'node:fs';
const { extraerReferencia } = await import('./frontend/src/services/pdfReferenceExtractor.js');
const r = await extraerReferencia(new Uint8Array(readFileSync('Cpanel/public_html/demo-precios-transferencia/Archivos Prueba/estudio pasado.pdf')));
console.log('paginas:', r.paginas, '| etiquetado:', r.etiquetado);
console.log('recursos conservados:', r.imagenes.length);
console.log('huecos de anexo:', r.huecos.length);
console.log('peso de los recursos:', Math.round(r.imagenes.reduce((a,i)=>a+i.dataUrl.length,0)/1024), 'KB');
"
```

Expected: 112 páginas, etiquetado `true`, entre 2 y 6 recursos, al menos 10 huecos, y el peso de los recursos por debajo de 500 KB. Si los recursos pesan megas, la clasificación está dejando pasar escaneos y hay que revisarla antes de seguir.

- [ ] **Step 7: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/services/pdfReferenceExtractor.js frontend/src/services/pdfReferenceExtractor.test.js
git commit -m "Agregar extractor del PDF de referencia

Lee estructura e imagenes con pdf.js. El PDF de referencia esta etiquetado
(/StructTreeRoot), asi que se recorre getStructTree para conservar secciones;
sin etiquetas degrada a texto plano y lo reporta.

Las paginas escaneadas del anexo firmado no se guardan: producen un hueco en
su posicion, porque son del ejercicio 2024 y no deben viajar al informe del
año siguiente."
```

---

### Task 5: Almacén de recursos en IndexedDB

Persiste plantilla, recursos y anexos. Es la pieza que arregla el fallo reportado: hoy todo vive en `useState` y muere al recargar.

**Files:**
- Create: `frontend/src/services/plantillaStore.js`
- Create: `frontend/src/services/plantillaStore.test.js`

**Interfaces:**
- Consumes: nada de tareas previas.
- Produces:
  - `clave(estudioId, recursoId) => string` — pura, testable sin IndexedDB.
  - `guardarRecursos(estudioId, imagenes) => Promise<void>`
  - `leerRecursos(estudioId) => Promise<Imagen[]>`
  - `borrarRecursos(estudioId) => Promise<void>`
  - `guardarPlantilla(plantillaId, html) => Promise<void>` / `leerPlantilla(plantillaId) => Promise<string|null>`
  - `hashPlantilla(datos) => Promise<string>` — identifica la plantilla por el contenido del PDF, no por el estudio.

- [ ] **Step 1: Escribir los tests que fallan**

IndexedDB no existe en Node, así que se prueban las partes puras. El resto se verifica a mano en el navegador en la Task 5.

Crear `frontend/src/services/plantillaStore.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { clave, hashPlantilla } from './plantillaStore.js';

test('la clave separa estudio y recurso sin ambigüedad', () => {
  assert.strictEqual(clave('estudio_1', 'img_2_1'), 'estudio_1:img_2_1');
});

test('dos estudios distintos nunca comparten clave', () => {
  assert.notStrictEqual(clave('a', 'x'), clave('b', 'x'));
});

test('un id con dos puntos no rompe la clave', () => {
  /* Sin escapar, clave('a:b','c') y clave('a','b:c') colisionarían. */
  assert.notStrictEqual(clave('a:b', 'c'), clave('a', 'b:c'));
});

test('el hash identifica la plantilla por contenido, no por nombre', async () => {
  const a = await hashPlantilla(new Uint8Array([1, 2, 3]));
  const b = await hashPlantilla(new Uint8Array([1, 2, 3]));
  const c = await hashPlantilla(new Uint8Array([1, 2, 4]));
  assert.strictEqual(a, b, 'mismo contenido debe dar el mismo hash');
  assert.notStrictEqual(a, c, 'contenido distinto debe dar hash distinto');
  assert.match(a, /^[0-9a-f]{16}$/, 'formato del hash');
});
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `npm test`
Expected: FAIL con `Cannot find module './plantillaStore.js'`.

- [ ] **Step 3: Implementar**

Crear `frontend/src/services/plantillaStore.js`:

```js
/* Persistencia de la plantilla marcada y de los recursos del cliente.
   Va en IndexedDB y no en localStorage: el tope de localStorage ronda los
   5 MB por origen y ya lo ocupan los estudios (pt:study:*), el anexo del PDF
   de referencia pesa 5.25 MB en base64, y setItem no falla limpio — lanza
   QuotaExceededError a mitad de la escritura y puede dejar el estudio a
   medias. */

const BASE = 'pt-plantillas';
const VERSION = 1;
const ALMACENES = ['plantillas', 'recursos', 'anexos'];

/* Los ids se escapan porque un ':' dentro de uno haría colisionar dos claves
   distintas: 'a:b' + 'c' y 'a' + 'b:c'. */
const esc = (s) => String(s).replace(/%/g, '%25').replace(/:/g, '%3A');

export function clave(estudioId, recursoId) {
  return esc(estudioId) + ':' + esc(recursoId);
}

/* Identifica una plantilla por el contenido del PDF del que salió, no por el
   estudio: la plantilla es muy parecida entre clientes, así que dos estudios
   que carguen el mismo documento comparten el marcado y no se vuelve a pagar. */
export async function hashPlantilla(datos) {
  const buf = await crypto.subtle.digest('SHA-256', datos);
  return [...new Uint8Array(buf)].slice(0, 8)
    .map((b) => b.toString(16).padStart(2, '0')).join('');
}

function abrir() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(BASE, VERSION);
    req.onupgradeneeded = () => {
      for (const nombre of ALMACENES) {
        if (!req.result.objectStoreNames.contains(nombre)) req.result.createObjectStore(nombre);
      }
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function operar(almacen, modo, fn) {
  const db = await abrir();
  return new Promise((res, rej) => {
    const tx = db.transaction(almacen, modo);
    const req = fn(tx.objectStore(almacen));
    tx.oncomplete = () => res(req ? req.result : undefined);
    tx.onerror = () => rej(tx.error);
  });
}

export const guardarRecursos = (estudioId, imagenes) =>
  operar('recursos', 'readwrite', (s) => s.put(imagenes, esc(estudioId)));

export const leerRecursos = (estudioId) =>
  operar('recursos', 'readonly', (s) => s.get(esc(estudioId))).then((r) => r || []);

export const borrarRecursos = (estudioId) =>
  operar('recursos', 'readwrite', (s) => s.delete(esc(estudioId)));

export const guardarPlantilla = (plantillaId, html) =>
  operar('plantillas', 'readwrite', (s) => s.put(html, plantillaId));

export const leerPlantilla = (plantillaId) =>
  operar('plantillas', 'readonly', (s) => s.get(plantillaId)).then((r) => r || null);
```

- [ ] **Step 4: Correr los tests**

Run: `npm test`
Expected: PASS. 49 tests (45 previos + 4 nuevos).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/plantillaStore.js frontend/src/services/plantillaStore.test.js
git commit -m "Agregar almacen de plantilla y recursos en IndexedDB

localStorage no sirve: el tope ronda los 5 MB por origen, ya lo ocupan los
estudios, el anexo del PDF de referencia pesa 5.25 MB en base64, y setItem
lanza QuotaExceededError a mitad de la escritura dejando el estudio a medias.

La plantilla se identifica por el hash del PDF del que salio, no por el
estudio, para que dos clientes con el mismo documento de referencia compartan
el marcado."
```

---

### Task 6: Cablear en ReporteGenerador — que sobrevivan a la recarga

Es el fallo que motivó el proyecto. `ReporteGenerador.jsx` guarda el HTML en `useState`, que muere con la página.

**Files:**
- Modify: `frontend/src/components/ReporteGenerador.jsx`
- Modify: `frontend/src/App.jsx` — pasar el identificador del estudio

**Interfaces:**
- Consumes: `extraerReferencia` (Task 4); `guardarRecursos`, `leerRecursos`, `hashPlantilla`, `guardarPlantilla`, `leerPlantilla` (Task 5).
- Produces: nada que consuman otras tareas del plan 1.

- [ ] **Step 1: Pasar el identificador del estudio al componente**

**El objeto `study` no lleva `id` dentro.** En `App.jsx` el identificador vive en el estado
`activeStudyId`, aparte, y a `ReporteGenerador` solo se le pasa `study`. Sin este paso, todo
se guardaría bajo la clave `undefined` y los recursos de todos los estudios se pisarían entre sí.

En `frontend/src/App.jsx`, buscar:

```jsx
            <ReporteGenerador study={study} />
```

Reemplazar por:

```jsx
            <ReporteGenerador study={study} estudioId={activeStudyId} />
```

Y en `frontend/src/components/ReporteGenerador.jsx`, cambiar la firma:

```js
export default function ReporteGenerador({ study, estudioId }) {
```

Verificar con Grep que `activeStudyId` es efectivamente el nombre del estado en `App.jsx`
antes de editar; los números de línea se mueven.

- [ ] **Step 2: Aceptar PDF además de .docx en la carga**

En `frontend/src/components/ReporteGenerador.jsx`, la carga usa hoy `mammoth.convertToHtml`, que solo lee `.docx`. Localiza `handleTemplateUpload` con Grep en el momento de editar; no confíes en números de línea.

Se enruta por extensión: `.pdf` va a `extraerReferencia`, `.docx` sigue con mammoth. Agrega el import:

```js
import { extraerReferencia } from '../services/pdfReferenceExtractor';
import { guardarRecursos, leerRecursos, hashPlantilla, guardarPlantilla, leerPlantilla } from '../services/plantillaStore';
```

Y dentro de `reader.onload`, antes de la llamada a mammoth, enruta:

```js
        const esPdf = /\.pdf$/i.test(file.name);
        let html;
        if (esPdf) {
          const datos = new Uint8Array(arrayBuffer);
          const ref = await extraerReferencia(datos);
          html = ref.html;
          const idPlantilla = await hashPlantilla(datos);
          await guardarPlantilla(idPlantilla, ref.html);
          if (estudioId) await guardarRecursos(estudioId, ref.imagenes);
          if (!ref.etiquetado) {
            alert('El PDF no trae estructura interna: la plantilla saldrá sin secciones.');
          }
        } else {
          const result = await mammoth.convertToHtml({ arrayBuffer });
          html = result.value;
        }
```

y sustituye el uso posterior de `result.value` por `html`.

- [ ] **Step 3: Rehidratar al montar**

Agrega un efecto que, al montar el componente, recupere lo guardado. Es la corrección del fallo: hoy no existe ninguna lectura desde almacenamiento.

```js
  const [recursosCargados, setRecursosCargados] = useState([]);

  /* Rehidratación: sin esto las imágenes del informe de referencia se pierden
     al recargar la página, que es el fallo que motivó este trabajo. La bandera
     `vivo` evita escribir estado si el componente se desmonta antes de que
     IndexedDB responda. */
  useEffect(() => {
    let vivo = true;
    (async () => {
      if (!estudioId) return;
      const recursos = await leerRecursos(estudioId);
      if (vivo && recursos.length) setRecursosCargados(recursos);
    })();
    return () => { vivo = false; };
  }, [estudioId]);
```

Y al construir el HTML de descarga, reinserta cada recurso en su marca `data-recurso`:

```js
  /* Vuelve a poner las imágenes rehidratadas en los huecos que dejó el
     extractor. Se hace al descargar y no al cargar la plantilla, porque el
     HTML guardado ya trae las marcas pero puede venir de una sesión anterior. */
  const conImagenes = (htmlBase) =>
    recursosCargados.reduce(
      (acc, r) =>
        acc.replace(
          new RegExp('<img data-recurso="' + r.id + '"[^>]*>'),
          '<img src="' + r.dataUrl + '" />'
        ),
      htmlBase
    );
```

y usa `conImagenes(cleanHtml)` en lugar de `cleanHtml` al armar el archivo de descarga.

- [ ] **Step 4: Verificar el fallo original, a mano en el navegador**

Es el criterio que define si este plan sirvió. No hay test automático que lo cubra.

Run:
```bash
npm install
npm install --prefix frontend
npm run dev --prefix frontend
```

Luego, en el navegador:
1. Crear o abrir un estudio.
2. Cargar `Cpanel/public_html/demo-precios-transferencia/Archivos Prueba/estudio pasado.pdf` como referencia.
3. Comprobar que los logos de ENDGAME aparecen en la vista previa.
4. **Recargar la página con F5.**
5. Comprobar que los logos **siguen ahí**.
6. Descargar el `.doc` y abrirlo en Word: las imágenes deben verse.

Expected: los pasos 5 y 6 pasan. Si el paso 5 falla, la rehidratación no está corriendo o `estudioId` llega `undefined` al montar — comprueba eso antes de dar la tarea por buena.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/App.jsx frontend/src/components/ReporteGenerador.jsx
git commit -m "Persistir las imagenes de la referencia entre recargas

El componente guardaba el HTML en useState, que muere con la pagina: por eso
las imagenes del informe de referencia desaparecian al recargar. Ahora se
guardan en IndexedDB al cargar el PDF y se rehidratan al montar.

Se acepta ademas .pdf en la carga de referencia; antes solo .docx via mammoth."
```

---

## Verificación final del plan 1

```bash
npm test                                   # 49 tests en verde
git status --short                         # limpio
```

Y a mano, en el navegador: cargar el PDF de referencia, recargar con F5, y confirmar que las imágenes siguen ahí y que el `.doc` descargado las muestra en Word.

Queda para el plan 2: el marcado asistido por IA, la pantalla de revisión de marcas, el renderizador por nombre de campo, las tres guardas de generación, y la retirada de `exactTemplateMapper.js` —que hay que avisarle a Daniel antes de empezar, porque lo extendió el 2026-07-30.
