import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  extraerReferencia, estiloBaseDe, versionDe, loQueFaltaPorVersion, VERSION_EXTRACTOR,
  normalizarCaracteresMatematicos, textoPorId, emparejar, paginasDeAnexoQueSeConservan,
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
  const m = /<div data-encabezado="1"[^>]*>([\s\S]*?)<\/div>/.exec(r.html);
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
  const envueltas =
    (r.html.match(/<div class="pagina" data-pagina="\d+" data-orientacion="\w+">/g) || []).length;
  assert.strictEqual(envueltas, r.paginas, 'faltan páginas por envolver');
  /* Y la portada es la primera, con su título dentro. */
  const m =
    /<div class="pagina" data-pagina="1" data-orientacion="\w+">([\s\S]*?)<div class="pagina" data-pagina="2"/
      .exec(r.html);
  assert.ok(m, 'no se pudo aislar la portada');
  const texto = m[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
  assert.match(texto, /INFORME LOCAL DE PRECIOS DE TRANSFERENCIA/);
  assert.match(texto, /PERÍODO FISCAL/);
  /* El índice no debe estar en la portada: si aparece aquí, el salto no separa. */
  assert.ok(!/RESUMEN EJECUTIVO/.test(texto), 'el índice se colvió a la portada');
});

test('cada página dice su orientación, y hay una apaisada', async () => {
  const r = await extraer();
  const orientaciones = [...r.html.matchAll(/data-orientacion="(\w+)"/g)].map((m) => m[1]);
  assert.equal(orientaciones.length, 112, 'todas las páginas deben decir su orientación');
  const apaisadas = orientaciones.filter((o) => o === 'apaisada').length;
  /* Medido sobre el PDF real: 111 verticales y 1 apaisada. Sin esto, esa página sale vertical
     y su contenido no cabe. */
  assert.equal(apaisadas, 1, 'debe haber exactamente una apaisada');
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

test('cada imagen lleva el tamaño que le da el PDF, no el natural del PNG', async () => {
  const r = await extraer();
  /* Sin esto salían a su tamaño en píxeles: el logo del encabezado a 8,7 cm en vez de
     5,53, y la figura de la página 11 a 29,9 cm sobre un papel de 21,6. En el .doc no
     había ninguna regla de imagen, así que desbordaban y Word repartía el desborde en
     páginas nuevas —cientos—. */
  const marcas = r.html.match(/<img[^>]*>/g) || [];
  assert.ok(marcas.length >= 4, 'se perdieron imágenes: ' + marcas.length);
  for (const m of marcas) {
    assert.match(m, /style="width:[\d.]+cm;height:[\d.]+cm"/, 'imagen sin tamaño: ' + m);
  }
  /* Y ninguna mide más que la caja de texto del informe (21,6 − 2 × 2,5 = 16,6 cm). */
  for (const m of marcas) {
    const ancho = Number(/width:([\d.]+)cm/.exec(m)[1]);
    assert.ok(ancho > 0 && ancho <= 16.7, 'imagen más ancha que la caja de texto: ' + m);
  }
});

test('el encabezado sabe de qué lado va y desde qué página', async () => {
  const r = await extraer();
  const enc = /<div data-encabezado="1"([^>]*)>/.exec(r.html);
  assert.ok(enc, 'no se apartó el logo del encabezado');
  /* Medido sobre el PDF real: el logo va a la derecha —su centro cae en 16,7 cm de una
     hoja de 21,6— y no aparece hasta la página 6. Se exportaba centrado y también en la
     portada, donde se superponía con el logo grande de la portada. */
  assert.match(enc[1], /data-lado="derecha"/);
  const desde = Number(/data-desde-pagina="(\d+)"/.exec(enc[1])[1]);
  assert.ok(desde > 1, 'el encabezado del informe no está en la portada, y dice que sí');
  /* Medido: la primera con logo es la 5. Una medición por geometría exacta decía 6
     porque la de la página 5 está unos puntos desplazada respecto a las siguientes. */
  assert.strictEqual(desde, 5);
});

test('las citas legales se apartan como notas al pie, con su llamada marcada', async () => {
  const r = await extraer();
  /* El árbol del PDF ancla cada `Note` justo detrás del párrafo que la cita, así que
     emitirla ahí la dejaba en mitad de la página y empujaba el resto del texto hacia abajo:
     el diseño de la página siguiente dejaba de parecerse al original. Medido sobre el PDF
     real: 42 notas numeradas de corrido, 1 a 42. */
  const numeros = [...r.html.matchAll(/data-nota-pie="(\d+)"/g)].map((m) => Number(m[1]));
  assert.strictEqual(numeros.length, 42, 'no se apartaron las 42 citas del informe');
  assert.deepStrictEqual(
    numeros, Array.from({ length: 42 }, (_, i) => i + 1),
    'los números de las notas no son los del informe, de corrido y en orden'
  );

  /* Cada nota tiene su llamada, y con el mismo número: es lo que las empareja al exportar. */
  const refs = [...r.html.matchAll(/data-ref-nota="(\d+)"/g)].map((m) => Number(m[1]));
  assert.deepStrictEqual([...new Set(refs)].sort((a, b) => a - b), numeros,
    'hay notas sin llamada o llamadas sin nota');
});

test('la nota va al final de su página y no en medio del texto', async () => {
  const r = await extraer();
  const pagina = /<div class="pagina" data-pagina="6"[\s\S]*?(?=<div class="pagina" data-pagina="7")/
    .exec(r.html);
  assert.ok(pagina, 'no se encontró la página del RESUMEN EJECUTIVO');

  /* Las dos notas de esta página van juntas al final, detrás de todo el texto. */
  const iNota = pagina[0].indexOf('data-nota-pie="1"');
  const iUltimoParrafo = pagina[0].lastIndexOf('<p>');
  assert.ok(iNota > 0, 'la página del RESUMEN EJECUTIVO no lleva su nota apartada');
  assert.ok(iNota > pagina[0].indexOf('empresa especializada'),
    'la nota sigue delante del cuerpo del texto');
  assert.ok(iNota < iUltimoParrafo, 'la nota no está en el bloque final de la página');

  /* Y el párrafo que la cita empalma con el siguiente del cuerpo, sin la cita en medio: es
     justo lo que se había perdido. */
  const texto = pagina[0].replace(/<div data-nota-pie[\s\S]*$/, '').replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ');
  assert.ok(/artículo 260-2 del E\.T\.\s+END GAME INTERACTIVE COLOMBIA SAS es una empresa/
    .test(texto), 'la cita sigue partiendo el cuerpo del RESUMEN EJECUTIVO: ' + texto.slice(0, 400));
});

test('el cuerpo de la nota no repite el número que Word le pone', async () => {
  const r = await extraer();
  /* El texto de la nota empieza por su número en el PDF. Word numera sus notas al pie por su
     cuenta, así que dejarlo daría «1 1 En virtud de…». */
  const m = /<div data-nota-pie="1">([\s\S]*?)<\/div>/.exec(r.html);
  assert.ok(m, 'no se apartó la primera nota');
  const texto = m[1].replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  assert.ok(texto.startsWith('En virtud de lo expresado en'),
    'el cuerpo de la nota no empieza donde debe: ' + texto.slice(0, 60));

  /* Y el contenido no se pierde por el camino: la primera nota del informe son dos párrafos,
     el que cita el artículo y el que lo transcribe. */
  assert.ok(texto.includes('Art. 260-2 – Estatuto Tributario'), 'falta el artículo citado');
  assert.ok(texto.includes('Los contribuyentes del impuesto sobre la renta'),
    'falta la transcripción del artículo, que va en el segundo párrafo de la nota');
});

test('una dirección web dentro de una nota no se confunde con una llamada', async () => {
  const r = await extraer();
  /* Las notas de la sección III llevan la fuente y su URL, y en el árbol del PDF la URL es un
     `Link` igual que la llamada. Sólo el que es un número puro se marca como llamada. */
  assert.ok(!/data-ref-nota="[^"]*[^\d"]/.test(r.html),
    'se marcó como llamada algo que no es un número');
  const soloTexto = r.html.replace(/<[^>]*>/g, ' ');
  assert.ok(soloTexto.includes('https://www.dane.gov.co'),
    'se perdió una dirección web de las notas de la sección III');
});

test('normalizarCaracteresMatematicos traduce simbolos matematicos de LaTeX/Unicode a ASCII legible', () => {
  // Mayúsculas cursivas matemáticas (𝐴𝑅)
  assert.strictEqual(normalizarCaracteresMatematicos('𝐴𝑅 Adjustment'), 'AR Adjustment');

  /* Ecuación corrupta real de la plantilla: caracteres cursivos y negritas mezclados. Esta
     función solo TRADUCE caracteres; quien reconoce las ecuaciones es `esFormulaCorrupta`
     (`formulasOmml.js`), sobre el texto CRUDO de todo el nodo y no sobre una cadena suelta —una
     ecuación abarca varios items del PDF, así que desde una sola cadena no se puede reconocer—.
     Aquí sigue haciendo falta para la prosa que lleva alguna letra matemática suelta. */
  const ecuacionCorrupta = '𝐴𝐴𝐴𝐴𝐴𝐴𝑇𝑇𝑇𝑇 𝐴𝐴';
  assert.strictEqual(
    normalizarCaracteresMatematicos(ecuacionCorrupta).replace(/\s+/g, ' '), 'AAAAAATTTT AA');

  // Letras matemáticas combinadas: negritas, cursivas, sans-serif, monospace
  const combinadas = '𝐉𝑲𝖫𝗤𝚡'; // J negrita, K cursiva, L sans-serif, Q sans-serif negrita, x monospace
  assert.strictEqual(normalizarCaracteresMatematicos(combinadas), 'JKLQx');
});

test('las ecuaciones de ajuste llegan marcadas, no como letras corruptas', async () => {
  /* El PDF entrega cada ecuación con los caracteres del editor de ecuaciones perdidos: la fuente
     no lleva tabla `ToUnicode`, así que todas las letras de un mismo estilo colapsan al mismo
     code point y las barras de fracción y los paréntesis extensibles llegan como U+FFFD. No hay
     nada que leer: hay que reconocer el nodo y volver a escribir la ecuación.

     Se comprueba contra el PDF real y no con una cadena inventada, que es lo que este arreglo
     necesitaba: la reconstrucción vivió primero dentro de `normalizarCaracteresMatematicos`, que
     recibe una cadena a la vez y por eso no podía ver una ecuación repartida en varios items. Un
     test sobre esa función pasaba mientras el informe seguía saliendo con las letras corruptas. */
  const r = await extraer();

  /* La marca es lo que el .docx lee para escribir la ecuación con el motor matemático de Word.
     Una de cada, ni más ni menos: dos querría decir que también se marcó la entrada del índice. */
  assert.equal((r.html.match(/data-formula="AR"/g) || []).length, 1,
    'no hay exactamente una ecuación marcada como ajuste de cuentas por cobrar');
  assert.equal((r.html.match(/data-formula="AP"/g) || []).length, 1,
    'no hay exactamente una ecuación marcada como ajuste de cuentas por pagar');

  /* Cada una bajo su rótulo: es lo que decide si el ajuste es de cobrar o de pagar. Y el de pagar
     está en la página anterior a su ecuación, así que este orden también prueba que el estado
     cruza las páginas. */
  const orden = ['FORMULA AJUSTE CUENTAS POR COBRAR', 'data-formula="AR"',
                 'FORMULA AJUSTE CUENTAS POR PAGAR', 'data-formula="AP"'].map((t) => r.html.indexOf(t));
  for (let i = 0; i < orden.length; i++) {
    assert.ok(orden[i] >= 0 && (i === 0 || orden[i] > orden[i - 1]),
      `«${['rótulo de cobrar', 'ecuación de cobrar', 'rótulo de pagar', 'ecuación de pagar'][i]}» está fuera de sitio`);
  }

  /* La aserción que de verdad cierra el agujero, porque no depende de la forma que tenga la
     basura: si otro PDF colapsa a otra letra, o si un día deja de reconocerse un nodo, aquí se
     ve. La versión anterior comprobaba una racha concreta de aes y por eso callaba. */
  assert.ok(!/[\u{1D400}-\u{1D7FF}]/u.test(r.html),
    'sobrevive un carácter del editor de ecuaciones del PDF');
  assert.ok(!/�/.test(r.html), 'sobrevive un carácter de reemplazo del PDF');
});

test('dos ecuaciones en la misma página no salen las dos del mismo ajuste', () => {
  /* En el informe de referencia cada una está en su página, así que el defecto no se veía: el
     tipo se leía del estado FINAL tras recorrer la página en vez de anotarlo al abrir cada nodo,
     y con las dos juntas ambas habrían salido como la de pagar. */
  const items = [
    { type: 'beginMarkedContent', id: 'r1' },
    { str: 'FORMULA AJUSTE CUENTAS POR COBRAR', height: 12 },
    { type: 'endMarkedContent' },
    { type: 'beginMarkedContent', id: 'f1' },
    { str: '𝐴'.repeat(20) + '�'.repeat(6), height: 12 },
    { type: 'endMarkedContent' },
    { type: 'beginMarkedContent', id: 'r2' },
    { str: 'FORMULA AJUSTE CUENTAS POR PAGAR', height: 12 },
    { type: 'endMarkedContent' },
    { type: 'beginMarkedContent', id: 'f2' },
    { str: '𝐴'.repeat(20) + '�'.repeat(6), height: 12 },
    { type: 'endMarkedContent' },
  ];
  const { formulaPorId } = textoPorId(items);
  assert.equal(formulaPorId.get('f1'), 'AR');
  assert.equal(formulaPorId.get('f2'), 'AP');
});

test('el rótulo vale aunque esté en la página anterior a su ecuación', () => {
  /* Es el caso real: el rótulo del ajuste de cuentas por pagar está en la página 85 y su ecuación
     en la 86. `textoPorId` se llama una vez por página, así que el estado tiene que ser del
     documento; si se reiniciara en cada página, la de pagar saldría escrita como la de cobrar. */
  const estadoAjuste = { tipo: null };
  textoPorId([
    { type: 'beginMarkedContent', id: 'r' },
    { str: 'FORMULA AJUSTE CUENTAS POR PAGAR', height: 12 },
    { type: 'endMarkedContent' },
  ], new Map(), estadoAjuste);

  const { formulaPorId } = textoPorId([
    { type: 'beginMarkedContent', id: 'f' },
    { str: '𝐴'.repeat(20) + '�'.repeat(6), height: 12 },
    { type: 'endMarkedContent' },
  ], new Map(), estadoAjuste);
  assert.equal(formulaPorId.get('f'), 'AP');
});

/* --- Emparejar figuras sin `bbox` --- */

/* El informe de ATEB 2024 salía con los ANEXOS A y B vacíos: sólo su título. Sus 28 páginas
   son escaneos —los estados financieros firmados y el contrato de distribución— y el árbol
   del PDF las declara como `Figure`, pero SIN `bbox`. Con la coincidencia por rectángulo
   como único criterio, ninguna figura encontraba su dibujo, así que no se emitía ni un
   hueco del anexo y el escaneo tampoco salía como imagen: el anexo se quedaba en blanco.
   El PDF de referencia de los otros tests trae `bbox` en sus 18 figuras, por eso pasaban. */

test('una figura sin bbox se empareja por orden, saltándose el logo del encabezado', () => {
  /* La página del anexo tal como la trae el PDF real: dos dibujos —el logo del encabezado
     primero, el escaneo después— y una sola figura en el árbol, sin `bbox`. */
  const logo = { clave: 'logo', rect: [456, 693, 527, 738] };
  const escaneo = { clave: 'img_p47_1', rect: [85, 121, 527, 693] };
  const pares = emparejar([{ bbox: null, alt: '' }], [logo, escaneo],
    { mobiliario: new Set(['logo']) });
  assert.strictEqual(pares[0], escaneo, 'la figura tenía que quedarse con el escaneo');
});

test('sin bbox y con varias figuras, el orden del documento manda', () => {
  const logo = { clave: 'logo', rect: [456, 693, 527, 738] };
  const uno = { clave: 'a', rect: [85, 400, 527, 693] };
  const dos = { clave: 'b', rect: [85, 121, 527, 390] };
  const pares = emparejar([{ bbox: null }, { bbox: null }], [logo, uno, dos],
    { mobiliario: new Set(['logo']) });
  assert.deepStrictEqual(pares, [uno, dos]);
});

test('el bbox sigue mandando cuando lo hay: no se empareja por orden', () => {
  /* Una figura CON `bbox` que no coincide con ningún dibujo es un desajuste de verdad y no
     se adivina: emparejarla por orden le colgaría al texto una imagen que no es la suya. */
  const otro = { clave: 'otro', rect: [10, 10, 20, 20] };
  const pares = emparejar([{ bbox: [85, 121, 527, 693] }], [otro], { mobiliario: new Set() });
  assert.strictEqual(pares[0], null);
});

test('con bbox, la coincidencia por rectángulo gana al orden de aparición', () => {
  const primero = { clave: 'primero', rect: [10, 10, 20, 20] };
  const segundo = { clave: 'segundo', rect: [85, 121, 527, 693] };
  const pares = emparejar([{ bbox: [85, 121, 527, 693] }], [primero, segundo],
    { mobiliario: new Set() });
  assert.strictEqual(pares[0], segundo);
});

test('una figura sin bbox no se queda con un dibujo que otra ya reclamó por rectángulo', () => {
  const escaneo = { clave: 'escaneo', rect: [85, 121, 527, 693] };
  const suelto = { clave: 'suelto', rect: [100, 200, 300, 400] };
  const pares = emparejar([{ bbox: null }, { bbox: [85, 121, 527, 693] }], [escaneo, suelto],
    { mobiliario: new Set() });
  assert.strictEqual(pares[1], escaneo, 'la del bbox se queda con el suyo');
  assert.strictEqual(pares[0], suelto, 'la de sin bbox toma el que quedó libre');
});

test('sin dibujos libres, la figura sin bbox se queda sin emparejar', () => {
  const logo = { clave: 'logo', rect: [456, 693, 527, 738] };
  const pares = emparejar([{ bbox: null }], [logo], { mobiliario: new Set(['logo']) });
  assert.strictEqual(pares[0], null, 'el logo del encabezado no es la figura de la página');
});

/* --- Qué páginas escaneadas se conservan del informe de referencia --- */

/* Un informe puede traer más de un anexo escaneado. El de ATEB trae los estados financieros
   firmados (págs. 47-64) y detrás el contrato de distribución (65-74), y los dos son páginas
   sin más texto que una imagen. La diferencia importa: del anexo de estados financieros NO se
   puede copiar el escaneo del informe de referencia —son cifras firmadas de otro año— y del
   contrato sí, porque es el mismo documento y el sistema no tiene de dónde sacarlo.

   La lista es de lo que SE CONSERVA, no de lo que se descarta: así, todo lo que no se
   reconozca con certeza se queda con su hueco, que es el comportamiento seguro. */

const bloquesDe = (paginas) => paginas.map(([pagina, html]) => ({ pagina, html }));

test('del anexo de estados financieros no se conserva ninguna página, del otro sí', () => {
  const bloques = bloquesDe([
    [47, '<h1>VIII. ANEXOS</h1><p><strong>ANEXO A. Estados financieros ATEB S.A.S</strong></p>'],
    [48, '<p></p>'],
    [49, '<p></p>'],
    [65, '<h1>ANEXO B. Contrato de Distribucion de Servicios</h1>'],
    [66, '<p></p>'],
  ]);
  const anexo = new Set([47, 48, 49, 65, 66]);
  assert.deepStrictEqual(
    [...paginasDeAnexoQueSeConservan(bloques, anexo)].sort((a, b) => a - b),
    [65, 66]
  );
});

test('el anexo de estados financieros se reconoce por su nombre, no por ir primero', () => {
  const bloques = bloquesDe([
    [10, '<h1>ANEXO A. Contrato de Distribucion de Servicios</h1>'],
    [11, '<p></p>'],
    [20, '<p><strong>ANEXO B. Estados financieros de la Compania</strong></p>'],
    [21, '<p></p>'],
  ]);
  assert.deepStrictEqual(
    [...paginasDeAnexoQueSeConservan(bloques, new Set([10, 11, 20, 21]))].sort((a, b) => a - b),
    [10, 11]
  );
});

test('sin un anexo de estados financieros reconocible no se conserva nada', () => {
  /* Si no se sabe cuál de los anexos es el de estados financieros, cualquiera podría serlo:
     conservar sus páginas sería radicar cifras firmadas de otro año sin que nada lo delate.
     Se cae al comportamiento de siempre —hueco vacío en todos— que se ve y se corrige. */
  const bloques = bloquesDe([
    [10, '<h1>ANEXO A. Documentos de soporte</h1>'],
    [11, '<p></p>'],
    [12, '<p></p>'],
  ]);
  assert.strictEqual(paginasDeAnexoQueSeConservan(bloques, new Set([10, 11, 12])).size, 0);
});

test('un anexo con otro nombre se conserva si el de estados financieros sí se reconoció', () => {
  /* No hace falta que el nombre esté en la tabla: basta con saber que NO es el de estados
     financieros. Un certificado, un acuerdo de costos compartidos —lo que el informe del
     cliente lleve escaneado— entra igual que el contrato. */
  const bloques = bloquesDe([
    [30, '<p><strong>ANEXO A. Estados financieros de la Compania</strong></p>'],
    [31, '<p></p>'],
    [40, '<h1>ANEXO B. Acuerdo de costos compartidos</h1>'],
    [41, '<p></p>'],
  ]);
  assert.deepStrictEqual(
    [...paginasDeAnexoQueSeConservan(bloques, new Set([30, 31, 40, 41]))].sort((a, b) => a - b),
    [40, 41]
  );
});

test('la entrada del índice no abre el anexo', () => {
  /* El índice repite los títulos con el número de página pegado, sesenta páginas antes. Si
     contara, el anexo del contrato empezaría ahí y se conservarían las páginas de los estados
     financieros. */
  const bloques = bloquesDe([
    [3, '<p>ANEXO A. Estados financieros ATEB S.A.S52</p>' +
        '<p>ANEXO B. Contrato de Distribucion de Servicios61</p>'],
    [47, '<p><strong>ANEXO A. Estados financieros ATEB S.A.S</strong></p>'],
    [48, '<p></p>'],
    [65, '<h1>ANEXO B. Contrato de Distribucion de Servicios</h1>'],
  ]);
  assert.deepStrictEqual(
    [...paginasDeAnexoQueSeConservan(bloques, new Set([47, 48, 65]))],
    [65]
  );
});

test('una página escaneada anterior al primer anexo no se conserva', () => {
  /* `detectarPaginasDeAnexo` mira imágenes, no títulos: puede marcar una racha de gráficos del
     cuerpo. Esa no está en ningún anexo, así que no se conserva por esta vía —sigue el camino
     normal de las imágenes del cuerpo—. */
  const bloques = bloquesDe([
    [5, '<p>una racha de graficos del cuerpo</p>'],
    [47, '<p><strong>ANEXO A. Estados financieros ATEB S.A.S</strong></p>'],
    [65, '<h1>ANEXO B. Contrato de Distribucion de Servicios</h1>'],
  ]);
  assert.deepStrictEqual(
    [...paginasDeAnexoQueSeConservan(bloques, new Set([5, 47, 65]))],
    [65]
  );
});
