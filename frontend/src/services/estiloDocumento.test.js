import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HOJA, REGLAS_DOCUMENTO, reglasDocumento, cuerpoDe, cssDeHojas, cssDeExportacion, cssDeWord,
  CLASE_VALOR, resaltarValor, cmATwips, cmAPixeles, medidaEnCm, HOJA_TWIPS,
  conSaltosDePagina, conTamanoDeImagen,
} from './estiloDocumento.js';

test('la pantalla y el .doc llevan las mismas reglas de documento', () => {
  /* Este es el punto del módulo. Estaban escritas dos veces —una en el previo, otra en
     la exportación— y el previo iba además con los estilos de Tailwind, así que revisar
     el documento en pantalla no decía nada de lo que iba a salir en Word. Si alguien
     vuelve a tocar una de las dos caras a mano, este test cae. */
  const previo = cssDeHojas({ base: { familia: 'Arial', tamano: 12 } });
  const doc = cssDeExportacion({ familia: 'Arial', tamano: 12 });
  for (const [sel, decl] of REGLAS_DOCUMENTO) {
    assert.ok(doc.includes(sel.split(',').join(',') + '{' + decl + '}'),
      'la exportación no lleva la regla de ' + sel);
    /* En el previo van acotadas al contenedor, así que se compara la declaración. */
    assert.ok(previo.includes(decl), 'el previo no lleva la regla de ' + sel);
  }
});

test('la hoja de la pantalla mide lo mismo que la de Word', () => {
  /* Si el previo pinta una hoja de otro tamaño, los saltos que se ven en pantalla caen
     donde no van a caer, que es peor que no paginar. */
  const previo = cssDeHojas({ base: null });
  const word = cssDeWord({});
  assert.ok(previo.includes('width:' + HOJA.ancho));
  assert.ok(previo.includes('min-height:' + HOJA.alto));
  assert.ok(word.includes('size:' + HOJA.ancho + ' ' + HOJA.alto));
  assert.ok(word.includes('margin:' + HOJA.margen + ' ' + HOJA.margen + ' ' + HOJA.pie));
});

test('con encabezado la caja de texto baja, y el logo del cuerpo se oculta', () => {
  const conLogo = cssDeHojas({ logo: 'data:image/png;base64,AAA' });
  const sinLogo = cssDeHojas({});
  assert.ok(conLogo.includes('padding:' + HOJA.conEncabezado));
  assert.ok(sinLogo.includes('padding:' + HOJA.margen));
  /* El logo se repite arriba de cada hoja como pseudoelemento, así que el del flujo
     tiene que desaparecer: si no, en la portada salía dos veces. */
  assert.ok(conLogo.includes('background:url("data:image/png;base64,AAA")'));
  assert.ok(!sinLogo.includes('::before{content:""'));
  assert.ok(conLogo.includes('[data-encabezado="1"]{display:none}'));
  assert.ok(sinLogo.includes('[data-encabezado="1"]{display:none}'));
});

test('la numeración de hojas va por contador de CSS y no por elementos', () => {
  /* El previo es contentEditable y su innerHTML se guarda como documento. Un número de
     hoja metido como elemento acabaría dentro del informe que se radica. Los
     pseudoelementos no se serializan. */
  const css = cssDeHojas({});
  assert.ok(css.includes('counter-reset:hoja'));
  assert.ok(css.includes('counter-increment:hoja'));
  assert.ok(css.includes('::after{content:counter(hoja)'));
});

test('todo el CSS del previo queda acotado al contenedor de hojas', () => {
  /* Sin esto las reglas de `table`, `th` o `p` repintarían la interfaz de la aplicación
     entera, que comparte página con el previo. */
  const css = cssDeHojas({ logo: 'data:image/png;base64,AAA' });
  const selectores = css.split('}').map((t) => t.split('{')[0]).filter(Boolean);
  for (const s of selectores) {
    for (const parte of s.split(',')) {
      assert.ok(parte.trim().startsWith('.hojas'),
        'selector fuera del contenedor: ' + parte.trim());
    }
  }
});

test('la tipografía sale del informe y sin marca cae en Arial', () => {
  assert.equal(cuerpoDe({ familia: 'Times New Roman', tamano: 11 }),
    "font-family:'Times New Roman',Arial,sans-serif;font-size:11pt");
  /* Sin marca —un .docx por mammoth, o una plantilla vieja— Arial 12, que es lo común
     en estos informes. Antes caía en Georgia y no se parecía al original. */
  assert.equal(cuerpoDe(null), "font-family:'Arial',Arial,sans-serif;font-size:12pt");
  assert.equal(cuerpoDe({}), "font-family:'Arial',Arial,sans-serif;font-size:12pt");
});

test('el encabezado de Word sólo se declara si el documento lo trae', () => {
  /* Declarar `mso-header:h1` sin el div correspondiente deja a Word buscando un
     encabezado que no existe. */
  assert.ok(cssDeWord({ conEncabezado: true }).includes('mso-header:h1'));
  assert.ok(!cssDeWord({ conEncabezado: false }).includes('mso-header:h1'));
  /* La página va nombrada: con un `@page` sin nombre Word ignora `mso-header` y el logo
     se queda como primera imagen del cuerpo. */
  assert.ok(cssDeWord({}).includes('@page Section1'));
  assert.ok(cssDeWord({}).includes('div.Section1{page:Section1}'));
});

test('reglasDocumento acota cada selector de una lista, no sólo el primero', () => {
  /* `p,li,td` acotado a medias dejaría `li` y `td` sueltos pintando la interfaz. */
  const r = reglasDocumento('.x ');
  assert.ok(r.includes('.x p,.x li,.x td{text-align:justify}'));
});

test('el resaltado de pantalla no puede llegar al documento', () => {
  /* Iba en un `style=` de seis propiedades y la exportación quitaba tres a mano. Las
     otras tres —font-weight:600, padding:0 4px, border-radius:3px— se colaban, así que
     en el .doc cada dato sustituido salía más negrita y con aire a los lados, cientos de
     veces en las 112 páginas. Por clase no hay nada que limpiar: en Word ninguna regla
     la mira. */
  const marcado = resaltarValor('900123456-7');
  assert.equal(marcado, '<span class="pt-valor">900123456-7</span>');
  assert.ok(!/style=/.test(marcado), 'el valor resaltado lleva estilo inline');
  /* El estilo existe, pero sólo acotado al previo. */
  assert.ok(cssDeHojas({}).includes('.hojas .pagina .pt-valor{'));
  assert.ok(!cssDeExportacion(null).includes(CLASE_VALOR));
  assert.ok(!cssDeExportacion(null).includes('F0FDF4'));
});

test('el .doc no lleva la caja de página web que peleaba con @page', () => {
  /* `max-width:800px;margin:40px auto;padding:0 24px` recortaba la caja de texto a
     ~15,3 cm en vez de los 16,6 cm del informe y añadía un centímetro arriba sobre el
     margen de la hoja: el texto rompía línea en otro sitio que en el previo y que en el
     original, en las 112 páginas. Con `@page` gobernando el papel, sobra. */
  const css = cssDeExportacion({ familia: 'Arial', tamano: 12 });
  /* Acotado al `body`: `img` SÍ lleva `max-width`, y es su red de seguridad. */
  const body = /body\{([^}]*)\}/.exec(css)[1];
  assert.ok(!body.includes('max-width'), 'sigue la caja de 800px');
  assert.ok(!body.includes('40px auto'), 'sigue el margen de página web');
  assert.ok(css.includes('margin:0'));
  /* Fondo explícito para que un visor en modo oscuro no invierta el informe. */
  assert.ok(css.includes('background:#fff'));
});

test('las imágenes no pueden desbordar la hoja', () => {
  /* El .doc no tenía NI UNA regla de imagen, así que cada una salía a su tamaño natural
     en píxeles: la figura de la página 11 medía 29,9 cm contra 21,6 de papel, y Word
     repartía el desborde en páginas nuevas. En el previo no se notaba porque Tailwind le
     pone `max-width:100%` por su cuenta, que es justo por qué pantalla y archivo no se
     parecían. */
  for (const css of [cssDeExportacion(null), cssDeHojas({})]) {
    assert.ok(/img\{[^}]*max-width:100%/.test(css), 'falta el tope de ancho de imagen');
  }
});

test('el encabezado va al lado que dice el PDF, no centrado por defecto', () => {
  assert.ok(cssDeWord({ conEncabezado: true, lado: 'derecha' }).includes('p.enc{text-align:right'));
  assert.ok(cssDeWord({ conEncabezado: true, lado: 'izquierda' }).includes('p.enc{text-align:left'));
  assert.ok(cssDeWord({ conEncabezado: true }).includes('p.enc{text-align:center'));
  /* Y el previo lo ancla al mismo lado. */
  assert.ok(cssDeHojas({ logo: 'data:image/png;base64,A', lado: 'derecha' })
    .includes('") right center/contain'));
  assert.ok(cssDeHojas({ logo: 'data:image/png;base64,A', lado: 'izquierda' })
    .includes('") left center/contain'));
});

test('si el informe no lleva encabezado en la portada, no se imprime ahí', () => {
  /* El del informe de referencia empieza en la página 6. Imprimirlo en la primera lo
     superponía con el logo grande de la portada, que es lo que se veía en el .doc. */
  const conPortada = cssDeWord({ conEncabezado: true, enLaPortada: true });
  const sinPortada = cssDeWord({ conEncabezado: true, enLaPortada: false });
  assert.ok(!conPortada.includes('mso-title-page'));
  assert.ok(sinPortada.includes('mso-title-page:yes'));
  /* Sin declarar `mso-first-header`, esa primera página se queda sin encabezado. */
  assert.ok(!sinPortada.includes('mso-first-header'));
  /* Y el previo hace lo mismo, para que en pantalla no salga un logo que en el
     documento no va a estar. */
  const previo = cssDeHojas({ logo: 'data:image/png;base64,A', enLaPortada: false });
  assert.ok(previo.includes('[data-pagina="1"]::before{content:none}'));
  assert.ok(!cssDeHojas({ logo: 'data:image/png;base64,A' }).includes('content:none'));
});

test('el alto del logo del previo sale del documento', () => {
  /* Iba a 1,5 cm fijos y el del informe de referencia mide 1,23. */
  assert.ok(cssDeHojas({ logo: 'data:image/png;base64,A', alto: '1.23cm' })
    .includes('height:1.23cm'));
  assert.ok(cssDeHojas({ logo: 'data:image/png;base64,A' })
    .includes('height:' + HOJA.altoEncabezado));
});

test('el CSS del .doc no usa pseudoclases que Word no entiende', () => {
  /* El motor HTML de Word es de la época de CSS 2: ignora `:first-of-type`, `:first-child`,
     `:nth-child` y compañía. Había una regla `div.pagina:first-of-type{page-break-before:auto}`
     para que la portada no llevara salto, y Word la ignoraba, así que la portada TAMBIÉN
     llevaba salto y el informe abría con una hoja en blanco delante.

     Y era falsa dos veces: el primer `div` del cuerpo era el de metadatos del extractor, no
     una página, así que el selector no emparejaba con nada ni en un navegador. */
  const css = cssDeWord({ conEncabezado: true, enLaPortada: false }) + cssDeExportacion(null);
  for (const pseudo of [':first-of-type', ':first-child', ':last-child', ':nth-child',
    ':nth-of-type', ':not(', ':is(', ':where(']) {
    assert.ok(!css.includes(pseudo), 'Word no entiende ' + pseudo + ' y la regla se pierde');
  }
  /* Y el salto de página tampoco va por selector: ninguna regla lo menciona, porque Word
     empujaría la propiedad a cada párrafo de dentro del div. Va como elemento, en
     `conSaltosDePagina`. */
  assert.ok(!css.includes('page-break'));
});

test('el previo no señala la primera página con :first-of-type', () => {
  /* Mismo error, y en el previo tampoco funcionaba: el div de metadatos del extractor ocupa el
     puesto de primer `div`, así que `:first-of-type` no emparejaba con la portada y el logo del
     encabezado se seguía dibujando encima del logo grande de la portada. */
  const css = cssDeHojas({ logo: 'data:image/png;base64,A', enLaPortada: false });
  assert.ok(!css.includes(':first-of-type'));
  assert.ok(css.includes('[data-pagina="1"]::before{content:none}'));
});

test('la hoja en twips describe la misma hoja que la del previo', () => {
  /* El previo va en centímetros y OOXML en twips. Si las dos descripciones se separan, el
     .docx sale con otra hoja que la que se revisó en pantalla, y los saltos caen donde no
     van. Este test es el que lo impide. */
  assert.equal(cmATwips(2.54), 1440, 'una pulgada son 1440 twips');
  assert.equal(HOJA_TWIPS.ancho, 12240, 'carta: 8,5 pulgadas');
  assert.equal(HOJA_TWIPS.alto, 15840, 'carta: 11 pulgadas');
  /* Y salen de HOJA, no escritos a mano otra vez. */
  assert.equal(HOJA_TWIPS.margen, cmATwips(medidaEnCm(HOJA.margen)));
  assert.equal(HOJA_TWIPS.pie, cmATwips(medidaEnCm(HOJA.pie)));
  assert.equal(HOJA_TWIPS.borde, cmATwips(medidaEnCm(HOJA.borde)));
});

test('el tamaño de imagen se convierte a píxeles de 96 ppp, que es lo que quiere docx', () => {
  /* Comprobado contra docx 9.7.1: `transformation` produce 9525 EMU por unidad, es decir un
     píxel a 96 ppp. Con puntos (12700 EMU) las imágenes saldrían un 33 % más grandes, que es
     la clase de error que ya costó un documento de 834 páginas. */
  assert.equal(cmAPixeles(2.54), 96);
  assert.equal(cmAPixeles(5.53), 209, 'el logo del informe de referencia');
});

test('medidaEnCm lee las medidas del previo', () => {
  assert.equal(medidaEnCm('2.5cm'), 2.5);
  assert.equal(medidaEnCm('21.6cm'), 21.6);
  /* Sin unidad o con basura devuelve 0 y no NaN: un NaN en un twip produce un .docx que Word
     no abre, y el fallo aparecería lejos de aquí. */
  assert.equal(medidaEnCm('abc'), 0);
  assert.equal(medidaEnCm(undefined), 0);
});

test('el salto de página va como elemento, no como propiedad del div', () => {
  /* Este es el fallo de las 834 hojas. Word no tiene `div`: su modelo son párrafos, tablas y
     secciones. Al importar un `div` con `page-break-before` empuja la propiedad a cada párrafo
     de dentro, y en Word el salto ES una propiedad de párrafo. Salían 810 párrafos sueltos
     convertidos en 834 hojas. Un elemento, un salto. */
  const css = cssDeWord({ conEncabezado: true });
  assert.ok(!css.includes('page-break'), 'sigue habiendo una regla de salto sobre el div');
});

test('conSaltosDePagina pone un salto por página y ninguno delante de la portada', () => {
  const html = '<div class="pagina" data-pagina="1"><p>a</p></div>' +
    '<div class="pagina" data-pagina="2"><p>b</p></div>' +
    '<div class="pagina" data-pagina="3"><p>c</p></div>';
  const r = conSaltosDePagina(html);
  /* Dos saltos para tres páginas. */
  assert.equal((r.match(/page-break-before:always/g) || []).length, 2);
  /* Y el primero NO va delante de la portada: si fuera, Word abriría con una hoja en blanco. */
  assert.ok(r.startsWith('<div class="pagina" data-pagina="1"'), 'la portada lleva salto delante');
  /* El salto cae justo antes de la página que abre, no en otro sitio. */
  assert.ok(r.includes('<br clear="all" style="page-break-before:always" /><div class="pagina" data-pagina="2"'));
  /* No se pierde contenido. */
  assert.ok(r.includes('<p>a</p>') && r.includes('<p>b</p>') && r.includes('<p>c</p>'));
});

test('conSaltosDePagina aguanta un documento sin páginas y uno vacío', () => {
  /* La plantilla maestra y un .docx por mammoth no traen páginas: sin saltos y sin romperse. */
  assert.equal(conSaltosDePagina('<p>a</p>'), '<p>a</p>');
  assert.equal(conSaltosDePagina(''), '');
  assert.equal(conSaltosDePagina(undefined), '');
  /* Una sola página tampoco lleva salto. */
  assert.equal((conSaltosDePagina('<div class="pagina" data-pagina="1"></div>')
    .match(/page-break/g) || []).length, 0);
});

test('cada imagen lleva también su tamaño en atributos, que Word sí obedece', () => {
  /* Word ignora buena parte del CSS —`max-width` y las pseudoclases de CSS 3 ya lo
     demostraron en este mismo proyecto—, así que el `width` de una hoja de estilos sobre una
     imagen no es de fiar. Los atributos `width`/`height` de HTML son de 1995 y los obedece
     siempre. Conviven: el navegador da prioridad al CSS en centímetros, que es exacto. */
  const r = conTamanoDeImagen(
    '<img data-recurso="logo" style="width:5.53cm;height:1.23cm" src="data:image/png;base64,A" />');
  /* 5,53 cm x 37,795 px/cm = 209; 1,23 cm = 46. */
  assert.match(r, /width="209"/);
  assert.match(r, /height="46"/);
  /* Y no se pierde ni el estilo ni el resto de la etiqueta. */
  assert.match(r, /style="width:5\.53cm;height:1\.23cm"/);
  assert.match(r, /data-recurso="logo"/);
  assert.match(r, /src="data:image\/png;base64,A"/);
});

test('una imagen sin tamaño declarado no recibe uno inventado', () => {
  /* Es el caso de una plantilla anterior a la versión 7 del lector. Inventarle un tamaño sería
     peor que dejarla salir al natural, porque parecería correcta. Para eso está el aviso de
     versión, que dice que hay que volver a subir el PDF. */
  const sin = '<img data-recurso="x" src="data:image/png;base64,A" />';
  assert.equal(conTamanoDeImagen(sin), sin);
  /* Y una con el estilo a medias tampoco. */
  const media = '<img data-recurso="x" style="width:2cm" src="data:image/png;base64,A" />';
  assert.equal(conTamanoDeImagen(media), media);
});

test('conTamanoDeImagen no pisa un tamaño que ya venga en atributos', () => {
  /* Un .docx por mammoth puede traerlos ya puestos, y son los del documento original. */
  const ya = '<img width="100" height="50" style="width:5cm;height:2cm" src="d" />';
  assert.equal(conTamanoDeImagen(ya), ya);
});

test('conTamanoDeImagen aguanta un documento sin imágenes y uno vacío', () => {
  assert.equal(conTamanoDeImagen('<p>hola</p>'), '<p>hola</p>');
  assert.equal(conTamanoDeImagen(''), '');
  assert.equal(conTamanoDeImagen(undefined), '');
});
