import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  extraerReferencia, estiloBaseDe, versionDe, loQueFaltaPorVersion, VERSION_EXTRACTOR,
} from './pdfReferenceExtractor.js';

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

/* `html.length > 1000` no distingue un informe de un esqueleto de etiquetas
   vacías: <p></p> repetido ya supera los 1000 caracteres. Estos dos tests
   miran el texto, que es lo que se perdía. */
test('el HTML lleva el texto del informe dentro de las etiquetas', async () => {
  const r = await extraer();
  const soloTexto = r.html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  assert.ok(
    soloTexto.length > 20000,
    'el HTML salió con la estructura pero sin texto: ' + soloTexto.length + ' caracteres'
  );
  assert.ok(soloTexto.includes('END GAME'), 'no aparece la razón social del informe');
  /* La razón social se repite en decenas de páginas y casi siempre parte entre
     dos renglones. Si el salto de línea no se convierte en espacio queda
     "COLOMBIAS.A.S", que ya no coincide con las reglas de sustitución del
     informe y deja el nombre del cliente anterior en el documento nuevo. */
  assert.ok(
    !soloTexto.includes('COLOMBIAS.A.S') && !soloTexto.includes('COLOMBIASAS'),
    'el salto de línea pegó las palabras: la razón social quedó sin separar'
  );
  assert.ok(soloTexto.includes('INTRODUCCIÓN'), 'no aparece el título de la primera sección');
});

test('el texto queda dentro de la etiqueta que le corresponde', async () => {
  const r = await extraer();
  /* Si el texto se asignara por orden de aparición en vez de por el id del
     contenido marcado, encajaría en las etiquetas equivocadas y ningún
     encabezado traería su propio título. */
  /* El contenido de un encabezado ya no es texto plano: lleva dentro el formato
     del original —casi siempre negrita—, así que hay que quitar las etiquetas de
     línea antes de comparar. */
  const encabezados = [...r.html.matchAll(/<h[1-6]>([\s\S]*?)<\/h[1-6]>/g)]
    .map((m) => m[1].replace(/<[^>]*>/g, '').trim());
  assert.ok(
    encabezados.some((t) => t.toUpperCase().includes('INTRODUCCIÓN')),
    'ningún encabezado contiene "INTRODUCCIÓN": ' + JSON.stringify(encabezados.slice(0, 10))
  );
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

test('las marcas del HTML apuntan al recurso y no cargan el base64', async () => {
  const r = await extraer();
  /* El logo del encabezado se dibuja en decenas de páginas. Si cada marca
     llevara su propia copia del data URL, el HTML que va a IndexedDB pesaría
     megabytes en vez de cientos de kilobytes. */
  assert.ok(!/<img[^>]*data:image/.test(r.html), 'una marca trae el base64 incrustado');
  const ids = r.imagenes.map((i) => i.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'hay recursos con id repetido');
  const marcadas = [...r.html.matchAll(/<img data-recurso="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(marcadas.length > 0, 'el HTML no trae ninguna marca de imagen');
  assert.ok(
    marcadas.every((id) => ids.includes(id)),
    'hay marcas que no corresponden a ningún recurso del catálogo'
  );
});

test('recupera las imágenes globales del documento', async () => {
  const r = await extraer();
  /* El logo del encabezado se repite en casi todas las páginas, así que pdf.js
     lo guarda como objeto global (clave con prefijo g_) en commonObjs y no en
     los objs de la página. La primera página donde aparece con esa clave es la
     6. Pedirlo al almacén equivocado no falla: se queda esperando. */
  assert.ok(
    r.imagenes.some((i) => i.pagina === 6),
    'no se recuperó la imagen global de la página 6'
  );
});

test('un buffer que no es PDF falla con un mensaje claro', async () => {
  await assert.rejects(
    () => extraerReferencia(new Uint8Array([1, 2, 3, 4])),
    /no se pudo leer el PDF/i
  );
});

/* --- Colocación de las imágenes en el flujo del texto --- */

test('las imágenes van donde el árbol las declara, no al final de la página', async () => {
  const r = await extraer();
  /* El organigrama del informe va entre su título y su línea de fuente. Antes se
     emitía detrás del bloque entero de la página, así que en el Word aparecía
     lejos del texto que lo explica. */
  const i = r.html.indexOf('Organigrama de la compañía');
  assert.ok(i > 0, 'no se encontró el título del gráfico');
  const despues = r.html.slice(i, i + 400);
  const posImg = despues.indexOf('<img data-recurso=');
  const posFuente = despues.indexOf('Fuente:');
  assert.ok(posImg > 0, 'no hay imagen tras el título del gráfico: ' + despues.slice(0, 120));
  assert.ok(
    posFuente > posImg,
    'la imagen debe ir antes de su línea de fuente, no después'
  );
});

test('no quedan marcadores de figura sin resolver', async () => {
  const r = await extraer();
  assert.ok(!r.html.includes('<!--FIG:'), 'quedó un marcador de figura sin imagen');
  assert.strictEqual(r.figurasSinDibujo, 0, 'hay figuras que ningún dibujo reclamó');
});

test('el logo del encabezado sale una vez, no en cada página', async () => {
  const r = await extraer();
  /* Se dibuja en casi cien páginas y antes se emitía una marca por dibujo: el
     documento salía con noventa y seis imágenes, casi todas el mismo logo
     repetido y fuera de sitio. */
  const marcas = (r.html.match(/<img data-recurso=/g) || []).length;
  assert.ok(marcas <= 8, 'demasiadas marcas de imagen, el logo se está repitiendo: ' + marcas);
  /* Y una sola vez cada contenido distinto: pdf.js promueve a global una imagen
     repetida, así que el mismo logo llega con dos claves y por clave saldría dos
     veces seguidas al abrir el documento. */
  const ids = [...r.html.matchAll(/<img data-recurso="([^"]+)"/g)].map((m) => m[1]);
  const urls = ids.map((id) => (r.imagenes.find((im) => im.id === id) || {}).dataUrl);
  assert.strictEqual(new Set(urls).size, urls.length, 'la misma imagen se emitió dos veces');
});

test('el hueco del anexo queda en su sitio del documento', async () => {
  const r = await extraer();
  /* El encabezado de la sección, no su entrada del índice: «ANEXO A. Estados
     financieros» aparece primero en la tabla de contenido, noventa mil
     caracteres antes, y medir desde ahí no dice nada de dónde quedó el hueco. */
  const m = /<h1>(?:(?!<\/h1>)[\s\S])*ANEXO A\. Estados financieros[\s\S]*?<\/h1>/.exec(r.html);
  assert.ok(m, 'no se encontró el encabezado del ANEXO A');
  const iTitulo = m.index + m[0].length;
  const iHueco = r.html.indexOf('data-hueco="anexo_eeff"');
  assert.ok(iHueco > 0, 'falta el hueco del anexo');
  assert.ok(iHueco > iTitulo, 'el hueco debe ir después del encabezado del ANEXO A');
  assert.ok(
    iHueco - iTitulo < 300,
    'el hueco quedó lejos de su encabezado: ' + (iHueco - iTitulo) + ' caracteres'
  );
});

/* --- Tipografía del informe --- */

test('el formato del original llega al HTML: negrita, cursiva y familias', async () => {
  const r = await extraer();
  /* El documento salía sin una sola negrita ni cursiva: la información estaba en
     los objetos de fuente y no se leía, así que el Word generado no se parecía al
     PDF. `styles` de getTextContent sólo da "sans-serif"/"serif", que no distingue
     una negrita de una redonda; el nombre real vive en commonObjs. */
  const negritas = r.html.split('<strong>').length - 1;
  const cursivas = r.html.split('<em>').length - 1;
  assert.ok(negritas > 100, 'apenas hay negritas: ' + negritas);
  assert.ok(cursivas > 10, 'apenas hay cursivas: ' + cursivas);
  /* «Arm's Length» va en cursiva en el informe: es el término técnico. */
  assert.ok(/<em>[^<]*Arm/i.test(r.html), 'no se detectó la cursiva del término técnico');
});

test('el cuerpo del documento se deduce y se anota en el HTML', async () => {
  const r = await extraer();
  /* El informe de referencia está en Arial 12. Antes la exportación imponía
     Georgia, elegida a dedo, y de ahí que no se pareciera al original. */
  assert.strictEqual(r.estiloBase.familia, 'Arial');
  assert.strictEqual(r.estiloBase.tamano, 12);
  assert.deepStrictEqual(estiloBaseDe(r.html), r.estiloBase, 'la marca no sobrevive en el HTML');
});

test('el nombre de la fuente llega sin el prefijo de subconjunto', async () => {
  const r = await extraer();
  /* Los nombres del PDF traen un prefijo de seis letras y un '+'
     (VXFCPX+BritannicBold). Si se emitiera tal cual, Word buscaría una fuente que
     no existe y caería a la que le pareciera. */
  assert.ok(!/font-family:'[A-Z]{6}\+/.test(r.html), 'quedó un prefijo de subconjunto');
  /* Y las variantes no son familias: la negrita y la cursiva viajan como tales. */
  assert.ok(!/font-family:'[^']*Bold/i.test(r.html), 'una variante se emitió como familia');
  assert.ok(!/font-family:'[^']*Italic/i.test(r.html), 'una variante se emitió como familia');
});

test('sólo se declara el tamaño cuando se desvía de verdad del cuerpo', async () => {
  const r = await extraer();
  /* `height` es el alto de los glifos y no el cuerpo de la fuente, así que un
     renglón sin ascendentes mide un punto menos que el de al lado. Emitir esa
     diferencia eran mil setecientas declaraciones invisibles a la vista. */
  const tamanos = [...r.html.matchAll(/font-size:(\d+)pt/g)].map((m) => Number(m[1]));
  assert.ok(tamanos.length > 0, 'no se conservó ningún tamaño, ni el de la letra pequeña');
  assert.ok(
    tamanos.every((t) => Math.abs(t - r.estiloBase.tamano) > 1),
    'se emitió un tamaño a un punto del cuerpo: ' + JSON.stringify([...new Set(tamanos)])
  );
  /* La letra pequeña de verdad —notas y fuentes de tabla— sí se conserva. */
  assert.ok(tamanos.some((t) => t <= 9), 'se perdió la letra pequeña');
});

test('la plantilla queda sellada con la versión del lector', async () => {
  const r = await extraer();
  assert.strictEqual(versionDe(r.html), VERSION_EXTRACTOR);
  assert.deepStrictEqual(loQueFaltaPorVersion(VERSION_EXTRACTOR), [], 'la actual no debe faltar nada');
});

test('una plantilla sin sello se trata como la más antigua y se dice qué le falta', () => {
  /* Las guardadas antes de que existiera el sello no lo traen. Devolver 1 y no
     null es lo que permite enumerar lo que les falta en vez de callar. */
  assert.strictEqual(versionDe('<p>plantilla vieja</p>'), 1);
  const falta = loQueFaltaPorVersion(1);
  assert.ok(falta.length >= 2, 'debería enumerar imágenes y tipografía');
  assert.ok(falta.some((f) => /tipograf/i.test(f)));
  assert.ok(falta.some((f) => /im[áa]genes/i.test(f)));

  /* Cuanto más nueva la plantilla, menos le falta, y a la actual nada. Se afirma
     la relación y no un número exacto: así el test sigue valiendo cuando se suba
     la versión otra vez, en vez de fallar por una cuenta que ya cambió una vez. */
  for (let v = 1; v < VERSION_EXTRACTOR; v++) {
    assert.ok(
      loQueFaltaPorVersion(v).length > loQueFaltaPorVersion(v + 1).length,
      'a la versión ' + v + ' debería faltarle más que a la ' + (v + 1)
    );
  }
  assert.ok(
    loQueFaltaPorVersion(2).some((f) => /tipograf/i.test(f)),
    'a la 2 le falta la tipografía, que llegó en la 3'
  );
});

test('cada entrada del índice va en su propio bloque', async () => {
  const r = await extraer();
  /* Las 89 entradas salían concatenadas en una sola línea corrida —título, puntos
     y número de página de una pegados a los de la siguiente— porque el rol TOCI no
     estaba en el mapa de etiquetas y sus hijos se emitían sin envolver. */
  const i = r.html.indexOf('INTRODUCCIÓN');
  const tramo = r.html.slice(i, i + 1200);
  const entradas = [...tramo.matchAll(/<p>(?:(?!<\/p>)[\s\S])*?\.{10,}[\s\S]*?<\/p>/g)];
  assert.ok(
    entradas.length >= 3,
    'las entradas del índice no están en bloques propios: ' + entradas.length
  );
  /* Y en cada bloque, un solo número de página al final: si hubiera dos, dos
     entradas se habrían fundido. */
  for (const e of entradas.slice(0, 5)) {
    const numeros = (e[0].match(/\.{10,}\s*\d+/g) || []).length;
    assert.strictEqual(numeros, 1, 'un bloque del índice trae dos entradas: ' + e[0].slice(0, 120));
  }
});

test('el logo queda marcado como encabezado, no como imagen del cuerpo', async () => {
  const r = await extraer();
  /* El logo del informe se repite en casi cien páginas: su sitio es el encabezado
     de página, no la primera imagen del documento. Va marcado en el HTML para que
     la exportación lo saque del cuerpo y lo declare como tal. */
  const m = /<div data-encabezado="1">([\s\S]*?)<\/div>/.exec(r.html);
  assert.ok(m, 'no se marcó el encabezado');
  assert.ok(/<img data-recurso=/.test(m[1]), 'el encabezado no lleva el logo');
  /* Y va antes que el contenido: es lo primero del documento. */
  assert.ok(m.index < r.html.indexOf('INTRODUCCIÓN'), 'el encabezado no está al principio');
});

test('cada página del original queda envuelta y numerada', async () => {
  const r = await extraer();
  /* Es lo que permite poner el salto donde el informe cambia de página. Sin esto la
     portada se fundía con el índice y la primera página no se parecía a la del
     original. */
  const envueltas = (r.html.match(/<div class="pagina" data-pagina="\d+">/g) || []).length;
  assert.strictEqual(envueltas, r.paginas, 'faltan páginas por envolver');
  /* Y la portada es la primera, con su título dentro. */
  const m = /<div class="pagina" data-pagina="1">([\s\S]*?)<div class="pagina" data-pagina="2">/
    .exec(r.html);
  assert.ok(m, 'no se pudo aislar la portada');
  const texto = m[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  assert.match(texto, /INFORME LOCAL DE PRECIOS DE TRANSFERENCIA/);
  assert.match(texto, /PERÍODO FISCAL/);
  /* El índice no debe estar en la portada: si aparece aquí, el salto no separa. */
  assert.ok(!/RESUMEN EJECUTIVO/.test(texto), 'el índice se colvió a la portada');
});

test('las páginas del anexo llegan todas al documento, no solo una', async () => {
  const r = await extraer();
  /* Regresión: el marcador de figura también desaparece al quitar las etiquetas para
     medir si la página tiene texto, así que una página cuyo contenido es sólo una
     imagen —las quince del anexo escaneado— parecía vacía. Se descartaba su
     estructura y con ella el hueco: de quince calculados llegaba uno al documento y
     las otras catorce páginas se perdían sin dejar rastro. */
  const enHtml = (r.html.match(/data-hueco=/g) || []).length;
  assert.strictEqual(
    enHtml, r.huecos.length,
    'los huecos calculados no llegan todos al HTML: ' + enHtml + ' de ' + r.huecos.length
  );
  assert.strictEqual(r.huecos.length, 15, 'el anexo del informe son quince páginas');
  /* Y cada uno nombra su página, para que el documento diga qué falta y dónde. */
  for (const p of [44, 51, 58]) {
    assert.ok(
      r.html.includes('data-id="hueco_' + p + '"'),
      'falta el hueco de la página ' + p
    );
  }
});

test('las filas de tabla no llevan párrafos sueltos dentro', async () => {
  const r = await extraer();
  /* El PDF cuelga un `P` vacío de cada `TR` —la marca de párrafo que Word deja al
     exportar la tabla— y emitirlo producía `<tr><p></p>`, que es HTML inválido: al no
     poder ser hijo de una fila, Word lo saca de la tabla. Ochocientos ochenta y nueve
     párrafos sueltos y otras tantas tablas partidas, y el documento pasaba de poco más
     de cien hojas a cientos. */
  assert.ok(!/<tr>\s*<p>/.test(r.html), 'hay párrafos colgando dentro de una fila');
  assert.ok(!/<tr>\s*<(strong|em|span|div)/.test(r.html), 'hay contenido fuera de celda en una fila');
  /* Y lo que sí debe haber: filas con sus celdas. */
  const filas = (r.html.match(/<tr>/g) || []).length;
  assert.ok(filas > 100, 'se perdieron filas de tabla: ' + filas);
  /* Cada fila abre y cierra, y solo contiene celdas. */
  for (const m of [...r.html.matchAll(/<tr>([\s\S]*?)<\/tr>/g)].slice(0, 40)) {
    const fuera = m[1].replace(/<t[dh]>[\s\S]*?<\/t[dh]>/g, '').trim();
    assert.strictEqual(fuera, '', 'contenido fuera de celda en una fila: ' + fuera.slice(0, 60));
  }
});
