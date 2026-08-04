import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HOJA, REGLAS_DOCUMENTO, reglasDocumento, cuerpoDe, cssDeHojas, cssDeExportacion, cssDeWord,
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
