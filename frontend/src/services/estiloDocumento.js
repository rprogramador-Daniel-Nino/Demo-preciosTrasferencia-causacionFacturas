/* El aspecto del informe en un solo sitio, porque tiene que servir a dos salidas: la
   previsualización en pantalla y el .doc que se descarga.

   Estaban escritas por separado. La pantalla iba con los estilos de Tailwind (`prose`)
   y el archivo con otros hechos a mano, así que revisar el documento en pantalla no
   decía nada de lo que iba a salir en Word: ni la tipografía, ni el ancho de la caja,
   ni —lo más visible— dónde caía cada salto de página. Se descubría al abrir el .doc.

   La tipografía del cuerpo NO se decide aquí: la anota el extractor al leer las fuentes
   del PDF de referencia y entra siempre por `base`. */

/* Medidas de la hoja. Las comparten `@page` —lo que Word va a imprimir— y la
   previsualización, que es lo que hace que una hoja en pantalla y una hoja en Word
   sean la misma hoja. Carta con los márgenes del informe. */
export const HOJA = {
  ancho: '21.6cm',
  alto: '27.9cm',
  margen: '2.5cm',
  pie: '2cm',
  /* Distancia del borde del papel al encabezado y al pie. */
  borde: '1.25cm',
  /* Con encabezado la caja de texto arranca más abajo: el borde más el alto del logo. */
  altoEncabezado: '1.5cm',
  conEncabezado: '3.4cm',
};

export const REGLAS_DOCUMENTO = [
  ['h1', 'font-size:1.5em;color:#0E1726;border-bottom:2px solid #0FA3A1;padding-bottom:6px'],
  ['h2', 'font-size:1.2em;color:#0E1726;border-bottom:1px solid #E2E8F0;' +
         'padding-bottom:4px;margin-top:26px'],
  ['h3', 'font-size:1.05em;color:#0E1726'],
  ['table', 'width:100%;border-collapse:collapse;margin:16px 0;font-size:0.9em'],
  ['th', 'background:#0E1726;color:#fff;text-align:left;padding:8px 12px'],
  ['td', 'padding:8px 12px;border-bottom:1px solid #E2E8F0'],
  /* Word ignora un `<strong>` anidado en un `<span>` con estilo si no se le dice que el
     peso se hereda; con esto la negrita del informe llega intacta. */
  ['strong', 'font-weight:bold'],
  ['em', 'font-style:italic'],
  ['p,li,td', 'text-align:justify'],
];

/* Las mismas reglas, opcionalmente acotadas a un contenedor. La previsualización las
   necesita acotadas para no repintar la interfaz que las rodea; el .doc las quiere
   desnudas. */
export function reglasDocumento(prefijo = '') {
  return REGLAS_DOCUMENTO
    .map(([sel, decl]) =>
      sel.split(',').map((s) => prefijo + s).join(',') + '{' + decl + '}')
    .join('');
}

/* La tipografía del cuerpo tal como la declaró el extractor. Sin marca se cae a Arial,
   que es lo más común en estos documentos y desde luego más cerca que una serif de
   pantalla —lo que había antes era Georgia, y el Word no se parecía al original ni de
   lejos, porque el informe está en Arial 12—. */
export function cuerpoDe(base) {
  const b = base || {};
  return "font-family:'" + (b.familia || 'Arial') + "',Arial,sans-serif;font-size:" +
    (b.tamano || 12) + 'pt';
}

/* CSS de la previsualización en hojas.

   Va todo por CSS y ni una etiqueta nueva en el HTML, a propósito: el previo es
   `contentEditable` y al perder el foco se guarda su `innerHTML` como documento. Un
   número de hoja o un logo repetido metidos como elementos acabarían dentro del informe
   que se radica. Los pseudoelementos no se serializan, así que la hoja se dibuja
   alrededor del documento sin tocarlo.

   `logo` es la data URL del encabezado, o null si el documento no trae. */
export function cssDeHojas({ base, logo } = {}) {
  const arriba = logo ? HOJA.conEncabezado : HOJA.margen;
  return (
    /* Fondo gris de mesa de trabajo: es lo que hace que la hoja se lea como hoja.
       El alto va acotado y el scroll es interno: son 112 hojas de 27.9 cm, y sin esto
       la página de la aplicación medía cien mil píxeles y los botones de arriba
       quedaban a un viaje de rueda de distancia. */
    '.hojas{background:#3f3f46;padding:24px;border-radius:8px;overflow:auto;' +
    'max-height:78vh;counter-reset:hoja}' +
    '.hojas .pagina{counter-increment:hoja;position:relative;box-sizing:border-box;' +
    'width:' + HOJA.ancho + ';min-height:' + HOJA.alto + ';margin:0 auto 24px;' +
    'background:#fff;color:#111;padding:' + arriba + ' ' + HOJA.margen + ' ' +
    HOJA.pie + ' ' + HOJA.margen + ';box-shadow:0 2px 14px rgba(0,0,0,.5);' +
    'line-height:1.5;' + cuerpoDe(base) + '}' +
    /* Papel blanco también en tema oscuro: el previo es la hoja, no la interfaz. */
    '.hojas .pagina *{color:inherit}' +
    '.hojas .pagina th{color:#fff}' +
    /* Número de hoja, el mismo que Word pondrá en el pie con el campo PAGE. */
    '.hojas .pagina::after{content:counter(hoja);position:absolute;left:0;right:0;' +
    'bottom:' + HOJA.borde + ';text-align:center;font-size:9pt;color:#71717a}' +
    (logo
      ? '.hojas .pagina::before{content:"";position:absolute;left:' + HOJA.margen +
        ';right:' + HOJA.margen + ';top:' + HOJA.borde + ';height:' + HOJA.altoEncabezado +
        ';background:url("' + logo + '") left center/contain no-repeat}'
      : '') +
    /* El logo se repite arriba de cada hoja, así que en el flujo del cuerpo no va: si
       no, sale dos veces en la portada, que es justo lo que se veía en pantalla. */
    '.hojas [data-encabezado="1"]{display:none}' +
    reglasDocumento('.hojas .pagina ')
  );
}

/* CSS del .doc. Las reglas del documento son las mismas de arriba; lo propio de esta
   salida es sólo la caja del `body`. */
export function cssDeExportacion(base) {
  return 'body{' + cuerpoDe(base) + ';max-width:800px;margin:40px auto;padding:0 24px;' +
    'color:#222;line-height:1.5}' + reglasDocumento();
}

/* El bloque `@page` con nombre y los saltos de página que Word entiende desde HTML.

   La página va **nombrada** y hay un div que la usa con `page:Section1`. Es lo que Word
   exige: con un `@page` sin nombre ignora `mso-header` y el logo se queda como primera
   imagen del cuerpo en vez de repetirse arriba de cada página. Es la estructura que
   Word emite cuando uno guarda como página web. */
export function cssDeWord({ conEncabezado } = {}) {
  return (
    'body{counter-reset:secpt}h2::before{content:""}' +
    '@page Section1{size:' + HOJA.ancho + ' ' + HOJA.alto + ';margin:' + HOJA.margen +
    ' ' + HOJA.margen + ' ' + HOJA.pie + ' ' + HOJA.margen + ';' +
    'mso-header-margin:' + HOJA.borde + ';mso-footer-margin:' + HOJA.borde +
    ';mso-paper-source:0;' + (conEncabezado ? 'mso-header:h1;' : '') + 'mso-footer:f1}' +
    'div.Section1{page:Section1}' +
    'p.pie{text-align:center;font-size:0.8em;color:#666;margin:0}' +
    'p.enc{text-align:center;margin:0}' +
    /* La portada es su propia página, como en el original. Sin esto el título y el logo
       se funden con el índice, que es lo que hacía que no se pareciera. */
    'div.pagina{page-break-before:always}' +
    'div.pagina:first-of-type{page-break-before:auto}'
  );
}
