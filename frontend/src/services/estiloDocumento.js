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
  /* Red de seguridad de las imágenes. Cada una lleva ya el tamaño que le da el PDF,
     pero esta regla es la que impide que una sin medida —una plantilla vieja, un .docx
     por mammoth— desborde la hoja. No la había en el .doc, y como el previo sí la
     recibe de Tailwind por su cuenta, en pantalla todo cuadraba mientras en Word la
     figura de la página 11 medía 29,9 cm contra 21,6 de papel y el desborde se repartía
     en páginas nuevas. `height:auto` va con ella para no deformar lo que se recorta. */
  ['img', 'max-width:100%;height:auto'],
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
export function cssDeHojas({ base, logo, lado = 'centro', enLaPortada = true, alto } = {}) {
  const arriba = logo ? HOJA.conEncabezado : HOJA.margen;
  /* El logo se ancla al lado que el PDF le da, y con el alto que le da. Antes iba
     siempre a la izquierda y a 1,5 cm fijos, y el del informe de referencia va a la
     derecha y mide 1,23 cm. */
  const anclaje = lado === 'derecha' ? 'right center' : lado === 'izquierda' ? 'left center' : 'center';
  const altoLogo = alto || HOJA.altoEncabezado;
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
        ';right:' + HOJA.margen + ';top:' + HOJA.borde + ';height:' + altoLogo +
        ';background:url("' + logo + '") ' + anclaje + '/contain no-repeat}' +
        /* La portada del informe puede no llevar encabezado. Word sólo sabe distinguir
           la primera página, así que el previo hace lo mismo: si se dibujara en la
           portada, en pantalla saldría un logo que en el documento no va a estar —y
           encima del logo grande de la portada, que sí va. */
        (enLaPortada ? '' : '.hojas [data-pagina="1"]::before{content:none}' +
          '.hojas [data-pagina="1"]{padding-top:' + HOJA.margen + '}')
      : '') +
    /* El logo se repite arriba de cada hoja, así que en el flujo del cuerpo no va: si
       no, sale dos veces en la portada, que es justo lo que se veía en pantalla. */
    '.hojas [data-encabezado="1"]{display:none}' +
    /* El resaltado del valor sustituido: sólo aquí, nunca en el archivo. */
    '.hojas .pagina .' + CLASE_VALOR + '{font-weight:600;color:#0B7C7A;' +
    'border-bottom:1px dashed #0FA3A1;background-color:#F0FDF4;padding:0 4px;' +
    'border-radius:3px}' +
    reglasDocumento('.hojas .pagina ')
  );
}

/* Clase del valor sustituido. El resaltado —fondo verde, subrayado de puntos— es cosa
   de la pantalla, así que va por clase y lo pinta sólo el CSS del previo. Antes iba en
   un `style=` de seis propiedades y la exportación limpiaba tres a mano: las otras tres
   —`font-weight:600`, `padding:0 4px`, `border-radius:3px`— se colaban en el .doc, así
   que en el documento que se radica cada dato sustituido salía más negrita y con cuatro
   píxeles de aire a cada lado, cientos de veces a lo largo del informe. Por clase no
   puede volver a pasar: en Word no hay ninguna regla que la mire. */
export const CLASE_VALOR = 'pt-valor';

/* Envuelve un valor sustituido para que la pantalla lo pueda señalar. Lo usan las dos
   rutas de sustitución —la de campos marcados y la de literales— y por eso vive aquí. */
export function resaltarValor(valor) {
  return '<span class="' + CLASE_VALOR + '">' + valor + '</span>';
}

/* CSS del .doc.

   Lo propio de esta salida es el `body`, y ahí ya no hay caja de página web. Tenía
   `max-width:800px;margin:40px auto;padding:0 24px`, de cuando esto se pensaba para
   mirar en un navegador, y peleaba con `@page`: el padding recortaba la caja de texto
   a ~15,3 cm en vez de los 16,6 cm del informe, y el margen añadía un centímetro
   arriba sobre el margen de la hoja. Con `@page` gobernando el papel, sobra: el texto
   rompía línea en un sitio distinto que en el previo y que en el original, en las 112
   páginas.

   El fondo se declara explícito para que un visor en modo oscuro no invierta el
   documento: el informe es papel blanco con letra negra en cualquier visor. */
export function cssDeExportacion(base) {
  return 'body{' + cuerpoDe(base) + ';color:#222;background:#fff;line-height:1.5;' +
    'margin:0;padding:0}' + reglasDocumento();
}

/* El bloque `@page` con nombre y los saltos de página que Word entiende desde HTML.

   La página va **nombrada** y hay un div que la usa con `page:Section1`. Es lo que Word
   exige: con un `@page` sin nombre ignora `mso-header` y el logo se queda como primera
   imagen del cuerpo en vez de repetirse arriba de cada página. Es la estructura que
   Word emite cuando uno guarda como página web. */
export function cssDeWord({ conEncabezado, lado = 'centro', enLaPortada = true } = {}) {
  /* `mso-title-page:yes` activa la primera página distinta, y al no declarar
     `mso-first-header` esa primera página se queda sin encabezado. Es lo que hace falta
     cuando el informe no lo lleva en la portada: el del informe de referencia empieza en
     la página 6, y ponerlo en la primera lo superponía con el logo grande de la portada.
     Word sólo distingue la primera página de las demás, así que las páginas 2 a 5
     seguirán llevándolo aunque el original no lo tenga; para eso harían falta varias
     secciones de Word, y esto ya quita el solape que se veía. */
  const primeraDistinta = conEncabezado && !enLaPortada;
  const alineacion = lado === 'derecha' ? 'right' : lado === 'izquierda' ? 'left' : 'center';
  return (
    'body{counter-reset:secpt}h2::before{content:""}' +
    '@page Section1{size:' + HOJA.ancho + ' ' + HOJA.alto + ';margin:' + HOJA.margen +
    ' ' + HOJA.margen + ' ' + HOJA.pie + ' ' + HOJA.margen + ';' +
    'mso-header-margin:' + HOJA.borde + ';mso-footer-margin:' + HOJA.borde +
    ';mso-paper-source:0;' + (primeraDistinta ? 'mso-title-page:yes;' : '') +
    (conEncabezado ? 'mso-header:h1;' : '') + 'mso-footer:f1}' +
    'div.Section1{page:Section1}' +
    'p.pie{text-align:center;font-size:0.8em;color:#666;margin:0}' +
    /* El lado sale del PDF: en el informe de referencia el logo va a la derecha —su
       centro cae en 16,7 cm de una hoja de 21,6— y se exportaba centrado. */
    'p.enc{text-align:' + alineacion + ';margin:0}' +
    /* La portada es su propia página, como en el original. Sin esto el título y el logo
       se funden con el índice, que es lo que hacía que no se pareciera.

       La primera página NO se exceptúa aquí con `:first-of-type`, que es lo que había y no
       funcionaba por dos motivos a la vez: el motor HTML de Word es de la época de CSS 2 y no
       entiende las pseudoclases estructurales de CSS 3, y además el selector era falso —el
       primer `div` del documento es el de metadatos del extractor, no una página, así que
       `div.pagina:first-of-type` no emparejaba con nada ni en un navegador—. Resultado: la
       primera página también llevaba salto y Word abría el informe con una hoja en blanco.

       La excepción va en un `style` en línea sobre la primera página, que Word sí respeta
       siempre y no depende de ningún selector. La pone `handleDownload`. */
    'div.pagina{page-break-before:always}'
  );
}
