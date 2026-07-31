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

### Task 2: Detección de páginas de anexo por rachas

Funciones puras, sin pdf.js ni DOM. Deciden qué páginas del PDF corresponden a un anexo escaneado.

**Por qué rachas y no un umbral de superficie:** sobre el PDF de referencia real, las páginas del anexo se dibujan al **52,1–54,4 %** de la página, no cerca del 100 %: van insertadas dentro de los márgenes del documento. Un umbral alto no detecta ninguna, y uno bajo confundiría un gráfico grande con un escaneo. Lo que de verdad distingue un anexo es que son **muchas páginas seguidas** con una imagen dominante. Medido: páginas 44 a 58 (quince consecutivas) al 52 %, y lo siguiente más grande es un gráfico suelto en la página 19 al 20,9 %.

**Files:**
- Modify: `frontend/src/services/clasificadorImagenes.js` — reemplaza `clasificarImagen`
- Modify: `frontend/src/services/clasificadorImagenes.test.js`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `fraccionDePagina(render, pagina) => number` — fracción del área de la página que ocupa la imagen, `0` si falta algún dato. `render` y `pagina` son `{ ancho, alto }` en unidades de PDF.
  - `detectarPaginasDeAnexo(dibujos) => Set<number>` — `dibujos` es un array de `{ pagina, fraccion }`; devuelve el conjunto de páginas que forman parte de un anexo.
  - `UMBRAL_DOMINANTE = 0.35` y `MIN_PAGINAS_ANEXO = 3`, exportados para que test y extractor compartan los valores.
- Se retiran `clasificarImagen` y `UMBRAL_PAGINA`: todavía no los consume nadie.

- [ ] **Step 1: Reemplazar los tests**

Sustituye el contenido completo de `frontend/src/services/clasificadorImagenes.test.js` por:

```js
import { test } from 'node:test';
import assert from 'node:assert';
import {
  fraccionDePagina,
  detectarPaginasDeAnexo,
  UMBRAL_DOMINANTE,
  MIN_PAGINAS_ANEXO,
} from './clasificadorImagenes.js';

/* Carta en unidades PDF: 612 x 792 puntos. */
const CARTA = { ancho: 612, alto: 792 };

test('fraccionDePagina calcula la proporción de área', () => {
  assert.strictEqual(fraccionDePagina({ ancho: 306, alto: 396 }, CARTA), 0.25);
});

test('fraccionDePagina devuelve 0 si falta alguna dimensión', () => {
  assert.strictEqual(fraccionDePagina({ ancho: 100, alto: 100 }, { ancho: 0, alto: 0 }), 0);
  assert.strictEqual(fraccionDePagina({ ancho: 0, alto: 0 }, CARTA), 0);
  assert.strictEqual(fraccionDePagina(null, CARTA), 0);
});

test('una racha de páginas consecutivas dominantes es anexo', () => {
  const dibujos = [
    { pagina: 44, fraccion: 0.52 },
    { pagina: 45, fraccion: 0.52 },
    { pagina: 46, fraccion: 0.52 },
  ];
  assert.deepStrictEqual([...detectarPaginasDeAnexo(dibujos)].sort(), [44, 45, 46]);
});

/* Un gráfico grande en una sola página no es un anexo: lo que distingue al
   anexo es la continuidad, no el tamaño de una imagen suelta. */
test('una página dominante aislada no es anexo', () => {
  assert.strictEqual(detectarPaginasDeAnexo([{ pagina: 19, fraccion: 0.9 }]).size, 0);
});

test('una racha más corta que el mínimo no es anexo', () => {
  const dibujos = [
    { pagina: 10, fraccion: 0.6 },
    { pagina: 11, fraccion: 0.6 },
  ];
  assert.strictEqual(detectarPaginasDeAnexo(dibujos).size, 0);
});

test('dos rachas separadas se detectan ambas', () => {
  const dibujos = [
    { pagina: 5, fraccion: 0.6 }, { pagina: 6, fraccion: 0.6 }, { pagina: 7, fraccion: 0.6 },
    { pagina: 20, fraccion: 0.6 }, { pagina: 21, fraccion: 0.6 }, { pagina: 22, fraccion: 0.6 },
  ];
  assert.deepStrictEqual(
    [...detectarPaginasDeAnexo(dibujos)].sort((a, b) => a - b),
    [5, 6, 7, 20, 21, 22]
  );
});

/* El logo se dibuja como encabezado en las 112 páginas: son muchas páginas
   consecutivas, pero ninguna dominante. No debe confundirse con un anexo. */
test('un logo repetido en todas las páginas no es anexo', () => {
  const dibujos = Array.from({ length: 40 }, (_, i) => ({ pagina: i + 1, fraccion: 0.02 }));
  assert.strictEqual(detectarPaginasDeAnexo(dibujos).size, 0);
});

test('se toma la imagen más grande de cada página', () => {
  /* Una página del anexo lleva además el logo de encabezado: debe contar la
     imagen dominante, no la primera ni la última que aparezca. */
  const dibujos = [
    { pagina: 44, fraccion: 0.02 }, { pagina: 44, fraccion: 0.52 },
    { pagina: 45, fraccion: 0.52 }, { pagina: 45, fraccion: 0.02 },
    { pagina: 46, fraccion: 0.52 },
  ];
  assert.deepStrictEqual([...detectarPaginasDeAnexo(dibujos)].sort(), [44, 45, 46]);
});

test('sin dibujos no hay anexo', () => {
  assert.strictEqual(detectarPaginasDeAnexo([]).size, 0);
});

test('los umbrales son los verificados contra el PDF real', () => {
  /* 0,35 cae en el hueco entre el gráfico más grande (20,9 %) y el anexo
     (52,1 %). Tres páginas es el mínimo para hablar de una secuencia. */
  assert.strictEqual(UMBRAL_DOMINANTE, 0.35);
  assert.strictEqual(MIN_PAGINAS_ANEXO, 3);
});
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `npm test`
Expected: FAIL. `fraccionDePagina` y `detectarPaginasDeAnexo` no existen todavía.

- [ ] **Step 3: Reemplazar la implementación**

Sustituye el contenido completo de `frontend/src/services/clasificadorImagenes.js` por:

```js
/* Detección de las páginas de un PDF de referencia que corresponden a un anexo
   escaneado. Funciones puras: no tocan pdf.js, ni el DOM, ni disco. */

/* Fracción del área de la página a partir de la cual una imagen se considera
   dominante en esa página. Verificado contra el PDF de referencia real: las
   páginas del anexo se dibujan al 52,1-54,4 %, y lo siguiente más grande es un
   gráfico suelto al 20,9 %. 0,35 cae en mitad de ese hueco. */
export const UMBRAL_DOMINANTE = 0.35;

/* Páginas consecutivas con imagen dominante que hacen falta para considerarlo
   un anexo y no una ilustración suelta. */
export const MIN_PAGINAS_ANEXO = 3;

/* Proporción de la página que ocupa una imagen. Se mide sobre la superficie
   renderizada y no sobre los píxeles del archivo: un logo en alta resolución
   tiene más píxeles que un escaneo mediocre, pero ocupa una esquina. */
export function fraccionDePagina(render, pagina) {
  const areaPagina = (pagina?.ancho || 0) * (pagina?.alto || 0);
  const areaRender = (render?.ancho || 0) * (render?.alto || 0);
  if (areaPagina <= 0 || areaRender <= 0) return 0;
  return areaRender / areaPagina;
}

/* Devuelve el conjunto de páginas que forman parte de un anexo escaneado.
   El criterio es la continuidad, no el tamaño: un gráfico grande en una sola
   página no es un anexo, y un logo pequeño repetido en cuarenta páginas
   tampoco. */
export function detectarPaginasDeAnexo(dibujos) {
  const dominanteDe = new Map();
  for (const d of dibujos || []) {
    const previa = dominanteDe.get(d.pagina) || 0;
    if (d.fraccion > previa) dominanteDe.set(d.pagina, d.fraccion);
  }

  const candidatas = [...dominanteDe.entries()]
    .filter(([, f]) => f >= UMBRAL_DOMINANTE)
    .map(([p]) => p)
    .sort((a, b) => a - b);

  const anexo = new Set();
  let racha = [];
  const cerrarRacha = () => {
    if (racha.length >= MIN_PAGINAS_ANEXO) for (const p of racha) anexo.add(p);
    racha = [];
  };

  for (const p of candidatas) {
    if (racha.length && p === racha[racha.length - 1] + 1) racha.push(p);
    else { cerrarRacha(); racha = [p]; }
  }
  cerrarRacha();

  return anexo;
}
```

- [ ] **Step 4: Correr los tests**

Run: `npm test`
Expected: PASS. 46 tests (42 previos − 6 del clasificador viejo + 10 nuevos).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/services/clasificadorImagenes.js frontend/src/services/clasificadorImagenes.test.js
git commit -m "Detectar el anexo por rachas de paginas, no por umbral de superficie

El umbral del 80 % no detectaba nada: sobre el PDF de referencia real las
paginas del anexo se dibujan al 52 %, insertadas dentro de los margenes y no
a sangre. Bajarlo sin mas confundiria un grafico grande con un escaneo.

Lo que distingue un anexo es la continuidad. Con dominante >= 0,35 y rachas
de >= 3 paginas consecutivas se detectan exactamente las 15 paginas del anexo
(44-58), y quedan fuera el grafico de la pagina 19 y el logo de encabezado que
se repite en las 112 paginas."
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
- Create: `frontend/src/services/pdfReferenceExtractor.js`
- Create: `frontend/src/services/pdfReferenceExtractor.test.js`
- Ya hecho, no repetir: `pdfjs-dist@^4` está instalado en `frontend/package.json`

**Interfaces:**
- Consumes: `fraccionDePagina`, `detectarPaginasDeAnexo` de la Task 2; `codificarPNG`, `aBase64` de la Task 3.
- Produces: `extraerReferencia(datos) => Promise<{ html, imagenes, huecos, paginas, etiquetado }>` donde `datos` es un `Uint8Array`; `imagenes` es `[{ id, dataUrl, pagina, orden }]`; `huecos` es `[{ id, pagina }]`. Lo consumen las Tasks 5 y 6.

**Cómo se comporta pdf.js aquí — todo verificado contra el PDF real, no des nada por supuesto:**

1. El operador inmediatamente anterior a `paintImageXObject` **no es** `transform`: pdf.js interpone `OPS.dependency`. No busques la matriz en `k-1`.
2. Los argumentos de `transform` llegan **planos** (`[a,b,c,d,e,f]`), no anidados.
3. `paintImageXObject` trae `[objId, ancho, alto]`, pero ese ancho y alto son los **píxeles intrínsecos** de la imagen, no el tamaño al que se dibuja. No sirven para clasificar.
4. La única forma correcta de saber a qué tamaño se dibuja una imagen es **llevar la matriz acumulada** (CTM) recorriendo `save`, `restore` y `transform`.
5. `page.objs.get(clave, callback)` **solo resuelve las imágenes que se hayan renderizado**. Fuera del navegador muchas no resuelven nunca: hace falta un límite de tiempo o la extracción se cuelga.
6. Hay **126 dibujos pero solo 20 imágenes únicas** —el logo se repite como encabezado en las 112 páginas—. Decodificar por dibujo en vez de por clave única fue lo que hizo que una corrida tardara 18 minutos.
7. pdf.js escupe avisos inofensivos en Node (`standardFontDataUrl`, `TT: undefined function`). Afectan al renderizado de fuentes, que no usamos. No los persigas.

- [ ] **Step 1: Escribir el test que falla**

Crear `frontend/src/services/pdfReferenceExtractor.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { extraerReferencia } from './pdfReferenceExtractor.js';

const RUTA = 'Cpanel/public_html/demo-precios-transferencia/Archivos Prueba/estudio pasado.pdf';

/* Una sola extracción compartida: procesar 112 páginas dos veces duplicaría el
   tiempo del test sin aportar nada. */
let cache = null;
const extraer = async () => {
  if (!cache) cache = await extraerReferencia(new Uint8Array(readFileSync(RUTA)));
  return cache;
};

test('lee la estructura del PDF de referencia real', async () => {
  const r = await extraer();
  assert.strictEqual(r.paginas, 112, 'número de páginas');
  assert.strictEqual(r.etiquetado, true, 'el PDF de referencia está etiquetado');
  assert.ok(r.html.length > 1000, 'el HTML salió vacío');
});

test('detecta el anexo escaneado y no lo guarda como recurso', async () => {
  const r = await extraer();
  /* Las páginas 44 a 58 del PDF real son el anexo de estados financieros
     firmado: quince páginas seguidas con una imagen dominante al 52 %. */
  const paginasConHueco = [...new Set(r.huecos.map((h) => h.pagina))].sort((a, b) => a - b);
  assert.deepStrictEqual(
    paginasConHueco,
    [44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58],
    'las páginas de anexo detectadas no son las esperadas'
  );
});

test('conserva los recursos reutilizables sin colar escaneos', async () => {
  const r = await extraer();
  /* Sólo 5 imágenes únicas quedan fuera del anexo en este documento: los dos
     logos, el banner y un par de gráficos. Si salen muchas más, la detección
     del anexo está fallando. */
  assert.ok(r.imagenes.length <= 8, 'se colaron escaneos como recursos: ' + r.imagenes.length);
  assert.ok(
    r.imagenes.every((i) => typeof i.dataUrl === 'string' && i.dataUrl.startsWith('data:image/')),
    'alguna dataUrl mal formada'
  );
  /* No se exige un número mínimo: fuera del navegador pdf.js deja sin resolver
     las imágenes que no se renderizan, así que la cuenta exacta varía. Que los
     logos aparezcan de verdad se verifica a mano en la Task 6. */
});

test('un buffer que no es PDF falla con un mensaje claro', async () => {
  await assert.rejects(
    () => extraerReferencia(new Uint8Array([1, 2, 3, 4])),
    /no se pudo leer el PDF/i
  );
});
```

- [ ] **Step 2: Correr para verificar que falla**

Run: `npm test`
Expected: FAIL con `Cannot find module './pdfReferenceExtractor.js'`.

- [ ] **Step 3: Implementar**

Crear `frontend/src/services/pdfReferenceExtractor.js`:

```js
/* Lectura del PDF que se sube como referencia (el informe del año anterior).
   Devuelve el HTML de su estructura y el catálogo de imágenes clasificadas.
   No conoce el dominio de precios de transferencia ni persiste nada. */

import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { fraccionDePagina, detectarPaginasDeAnexo } from './clasificadorImagenes.js';
import { codificarPNG, aBase64 } from './png.js';

/* pdf.js resuelve los objetos de imagen mientras renderiza la página. Sin
   renderizar —caso de los tests, que corren sin canvas— `objs.get` puede no
   llamar nunca a su callback. Sin este límite la extracción se cuelga entera
   por una sola imagen. */
const TIEMPO_LIMITE_IMAGEN = 5000;

const MAPA_ETIQUETAS = {
  H1: 'h1', H2: 'h2', H3: 'h3', H4: 'h4', H5: 'h5', H6: 'h6',
  P: 'p', L: 'ul', LI: 'li', Table: 'table', TR: 'tr', TD: 'td', TH: 'th',
};

const escapar = (s) =>
  String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* Composición de matrices de transformación, en el mismo orden que usa pdf.js:
   CTM_nuevo = CTM_viejo x M. */
function componer(m1, m2) {
  return [
    m1[0] * m2[0] + m1[1] * m2[2],
    m1[0] * m2[1] + m1[1] * m2[3],
    m1[2] * m2[0] + m1[3] * m2[2],
    m1[2] * m2[1] + m1[3] * m2[3],
    m1[4] * m2[0] + m1[5] * m2[2] + m2[4],
    m1[4] * m2[1] + m1[5] * m2[3] + m2[5],
  ];
}

function conTiempoLimite(promesa, ms) {
  return Promise.race([promesa, new Promise((res) => setTimeout(() => res(null), ms))]);
}

export async function extraerReferencia(datos) {
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: datos }).promise;
  } catch (e) {
    throw new Error('no se pudo leer el PDF: ' + e.message);
  }

  /* --- Primera pasada: estructura y censo de dibujos --- */
  const bloques = [];
  const dibujos = [];
  let etiquetado = false;

  for (let n = 1; n <= doc.numPages; n++) {
    const pagina = await doc.getPage(n);
    const vista = pagina.getViewport({ scale: 1 });
    const dimPagina = { ancho: vista.width, alto: vista.height };

    const arbol = await pagina.getStructTree().catch(() => null);
    const texto = await pagina.getTextContent();
    if (arbol) {
      etiquetado = true;
      bloques.push({ pagina: n, html: aHTML(arbol, texto) });
    } else {
      bloques.push({ pagina: n, html: '<p>' + escapar(texto.items.map((i) => i.str).join(' ')) + '</p>' });
    }

    /* La matriz acumulada es la única forma de saber a qué tamaño se dibuja
       una imagen: los argumentos de paintImageXObject traen los píxeles
       intrínsecos, no el tamaño renderizado. */
    const ops = await pagina.getOperatorList();
    let ctm = [1, 0, 0, 1, 0, 0];
    const pila = [];
    let orden = 0;

    for (let k = 0; k < ops.fnArray.length; k++) {
      const fn = ops.fnArray[k];
      const args = ops.argsArray[k];
      if (fn === pdfjs.OPS.save) {
        pila.push(ctm.slice());
      } else if (fn === pdfjs.OPS.restore) {
        ctm = pila.pop() || [1, 0, 0, 1, 0, 0];
      } else if (fn === pdfjs.OPS.transform) {
        ctm = componer(ctm, args.length === 1 ? args[0] : args);
      } else if (fn === pdfjs.OPS.paintImageXObject) {
        const render = { ancho: Math.hypot(ctm[0], ctm[1]), alto: Math.hypot(ctm[2], ctm[3]) };
        dibujos.push({
          pagina: n,
          orden: ++orden,
          clave: args[0],
          fraccion: fraccionDePagina(render, dimPagina),
        });
      }
    }
  }

  /* --- Decisión: qué páginas son anexo --- */
  const paginasDeAnexo = detectarPaginasDeAnexo(dibujos);

  /* --- Segunda pasada: decodificar solo lo que se conserva, una vez por clave --- */
  const imagenes = [];
  const huecos = [];
  const marcasPorPagina = new Map();
  const yaDecodificada = new Map();

  for (const d of dibujos) {
    const marcas = marcasPorPagina.get(d.pagina) || [];
    marcasPorPagina.set(d.pagina, marcas);

    if (paginasDeAnexo.has(d.pagina)) {
      /* Un hueco por página, no por dibujo: el logo de encabezado también cae
         dentro de una página de anexo y no debe generar su propio hueco. */
      if (!huecos.some((h) => h.pagina === d.pagina)) {
        const id = 'hueco_' + d.pagina;
        huecos.push({ id, pagina: d.pagina });
        marcas.push('<div data-hueco="anexo_eeff" data-id="' + id + '"></div>');
      }
      continue;
    }

    /* Deduplicación por clave: hay 126 dibujos pero solo unas 20 imágenes
       distintas, y decodificar por dibujo multiplicaba el trabajo por seis. */
    if (!yaDecodificada.has(d.clave)) {
      const pagina = await doc.getPage(d.pagina);
      yaDecodificada.set(d.clave, await aDataUrl(pagina, d.clave));
    }
    const dataUrl = yaDecodificada.get(d.clave);
    if (!dataUrl) continue;

    const id = 'img_' + d.pagina + '_' + d.orden;
    imagenes.push({ id, dataUrl, pagina: d.pagina, orden: d.orden });
    marcas.push('<img data-recurso="' + id + '" src="' + dataUrl + '" />');
  }

  const html = bloques
    .map((b) => b.html + (marcasPorPagina.get(b.pagina) || []).join('\n'))
    .join('\n');

  return { html, imagenes, huecos, paginas: doc.numPages, etiquetado };
}

/* Convierte el objeto de imagen de pdf.js en un data URL PNG. pdf.js entrega
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
  if (nodo.type === 'content') {
    const item = texto.items.find((i) => i.id === nodo.id);
    return item ? escapar(item.str) : '';
  }
  const hijos = (nodo.children || []).map((h) => aHTML(h, texto)).join('');
  const etiqueta = MAPA_ETIQUETAS[nodo.role];
  return etiqueta ? '<' + etiqueta + '>' + hijos + '</' + etiqueta + '>' : hijos;
}
```

- [ ] **Step 4: Correr los tests**

Run: `time npm test`
Expected: PASS, 50 tests (46 previos + 4 nuevos).

**Vigila el tiempo.** Con la deduplicación por clave y el anexo descartado antes de decodificar, quedan unas 5 imágenes que decodificar en lugar de 126. Si `npm test` pasa de **90 segundos**, algo no está deduplicando: **repórtalo con el número medido en vez de subir el límite de tiempo o recortar el test.**

- [ ] **Step 5: Verificar el reparto contra el PDF real**

Run:
```bash
node --input-type=module -e "
import { readFileSync } from 'node:fs';
const { extraerReferencia } = await import('./frontend/src/services/pdfReferenceExtractor.js');
const t = Date.now();
const r = await extraerReferencia(new Uint8Array(readFileSync('Cpanel/public_html/demo-precios-transferencia/Archivos Prueba/estudio pasado.pdf')));
console.log('segundos:', ((Date.now()-t)/1000).toFixed(1));
console.log('paginas:', r.paginas, '| etiquetado:', r.etiquetado);
console.log('recursos conservados:', r.imagenes.length);
console.log('paginas con hueco:', [...new Set(r.huecos.map(h=>h.pagina))].join(','));
console.log('peso de los recursos:', Math.round(r.imagenes.reduce((a,i)=>a+i.dataUrl.length,0)/1024), 'KB');
" 2>&1 | grep -v "^Warning"
```

Expected: 112 páginas, etiquetado `true`, páginas con hueco `44,45,…,58`, recursos por debajo de 500 KB en total, y menos de 90 segundos. Si los recursos pesan megas, la detección del anexo está fallando y hay que reportarlo, no ajustar el umbral para que el número salga bien.

- [ ] **Step 6: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/services/pdfReferenceExtractor.js frontend/src/services/pdfReferenceExtractor.test.js
git commit -m "Agregar extractor del PDF de referencia

Lee estructura e imagenes con pdf.js en dos pasadas: primero censa los
dibujos con su tamano real sobre la pagina, decide que paginas son anexo, y
solo entonces decodifica lo que se conserva.

El tamano se obtiene llevando la matriz acumulada, no de los argumentos de
paintImageXObject: esos traen los pixeles intrinsecos de la imagen, no el
tamano al que se dibuja. Y el operador anterior no es transform, pdf.js
interpone dependency.

Se decodifica una vez por clave de imagen y no por dibujo: hay 126 dibujos
pero unas 20 imagenes distintas, porque el logo se repite como encabezado en
las 112 paginas."
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
Expected: PASS. 54 tests (50 previos + 4 nuevos).

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
npm test                                   # 54 tests en verde
git status --short                         # limpio
```

Y a mano, en el navegador: cargar el PDF de referencia, recargar con F5, y confirmar que las imágenes siguen ahí y que el `.doc` descargado las muestra en Word.

Queda para el plan 2: el marcado asistido por IA, la pantalla de revisión de marcas, el renderizador por nombre de campo, las tres guardas de generación, y la retirada de `exactTemplateMapper.js` —que hay que avisarle a Daniel antes de empezar, porque lo extendió el 2026-07-30.
