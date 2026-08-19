/* El aspecto del informe en un solo sitio, porque tiene que servir a dos salidas: la
   previsualización en pantalla y el .doc que se descarga.

   Estaban escritas por separado. La pantalla iba con los estilos de Tailwind (`prose`)
   y el archivo con otros hechos a mano, así que revisar el documento en pantalla no
   decía nada de lo que iba a salir en Word: ni la tipografía, ni el ancho de la caja,
   ni —lo más visible— dónde caía cada salto de página. Se descubría al abrir el .doc.

   La tipografía del cuerpo NO se decide aquí: la anota el extractor al leer las fuentes
   del PDF de referencia y entra siempre por `base`. */

/* Medidas de la hoja. Las comparten `@page` —lo que Word va a imprimir—, la
   previsualización en pantalla, y OOXML (en twips). Que una hoja en pantalla, en Word
   y en el .docx sean la misma hoja depende de que estas medidas sean exactas, no
   redondeadas: son carta estándar, 8,5 × 11 pulgadas exactas. Los valores anteriores
   (21,6 × 27,9 cm) eran un redondeo; aquí van en centímetros exactos porque al
   convertirlos a twips (1440 por pulgada, 566,929 por cm) tienen que dar 12240 × 15840
   exactos, no 12246 × 15857. Si esto se vuelve a cambiar, los twips que salen del
   cálculo ya no van a coincidir con el estándar de página, y los saltos van a caer mal
   tanto en pantalla como en el archivo. Márgenes del informe: superior/izquierdo/derecho
   2,5 cm, inferior 2 cm. */
export const HOJA = {
  ancho: '21.59cm',
  alto: '27.94cm',
  margen: '2.5cm',
  pie: '2cm',
  /* Distancia del borde del papel al encabezado y al pie. */
  borde: '1.25cm',
  /* Alto del logo cuando el extractor no anotó ninguno. Con encabezado la caja de
     texto arranca más abajo: ver `arribaConLogoCm`, que sí usa el alto real. */
  altoEncabezado: '1.5cm',
};

/* OOXML mide en twips: 1/20 de punto, 1440 por pulgada, 566,929 por centímetro. La hoja del
   previo y la del .docx tienen que ser la misma, así que las dos salen de `HOJA`. */
const TWIPS_POR_CM = 1440 / 2.54;

/* `docx` mide las imágenes en píxeles de 96 ppp: comprobado contra la versión 9.7.1, que
   emite 9525 EMU por unidad, y 9525 × 96 = 914400 EMU = una pulgada. Con puntos las imágenes
   saldrían un 33 % más grandes. */
const PIXELES_POR_CM = 96 / 2.54;

/* Tipografía de las tablas, en un solo sitio para que las tres salidas no puedan separarse.

   Es FIJA y no heredada, por decisión del usuario (2026-08-19): la tabla se ve igual en todos
   los informes aunque el PDF del cliente venga en otra letra. Antes era un factor —el 0,9 de
   `font-size:0.9em`— que multiplicaba el cuerpo, así que el tamaño de la tabla dependía de lo
   que el extractor hubiera leído del PDF.

   10 pt y no los 9,75 del modelo que fijó el usuario (13px a 96 ppp): OOXML mide en MEDIOS
   puntos, y 9,75 pt son 19,5 medios puntos, que no es entero. Redondear aquí, una vez, es lo
   que impide que el previo emita 9,75 y el .docx 10 y que las dos caras se separen por un
   redondeo que nadie ve venir. La diferencia con el modelo es un tercio de píxel. */
export const PUNTOS_TABLA = 10;
/* Con reservas para el navegador; en OOXML sólo cabe el nombre de la familia. */
export const FUENTE_TABLA = 'Arial';
export const FUENTE_TABLA_CSS = FUENTE_TABLA + ',Helvetica,sans-serif';

export const cmATwips = (cm) => Math.round((Number(cm) || 0) * TWIPS_POR_CM);
export const cmAPixeles = (cm) => Math.round((Number(cm) || 0) * PIXELES_POR_CM);

/* `'2.5cm'` → `2.5`. Devuelve 0 y no NaN ante cualquier cosa que no sepa leer: un NaN metido
   en un twip produce un .docx que Word no abre, y el fallo aparecería muy lejos de aquí. */
export const medidaEnCm = (valor) => {
  const m = /^([\d.]+)\s*cm$/.exec(String(valor || '').trim());
  return m ? Number(m[1]) : 0;
};

export const HOJA_TWIPS = {
  ancho: cmATwips(medidaEnCm(HOJA.ancho)),
  alto: cmATwips(medidaEnCm(HOJA.alto)),
  margen: cmATwips(medidaEnCm(HOJA.margen)),
  pie: cmATwips(medidaEnCm(HOJA.pie)),
  borde: cmATwips(medidaEnCm(HOJA.borde)),
};

/* Aire entre el borde inferior del logo y la primera línea de texto. Sin esto un logo
   que mida justo lo que el hueco reserva quedaría pegado al párrafo siguiente. */
const AIRE_TRAS_LOGO_CM = 0.3;

/* Cuánto hay que bajar el inicio del texto para que quepa un logo de este alto, en cm.
   Una sola cuenta para la previsualización (`cssDeHojas`) y el .docx (`docxWriter.js`):
   antes cada uno la hacía por su lado —o no la hacía— y un logo más alto que el hueco
   fijo de 3,4cm (pensado para el 1,5cm por defecto) invadía el cuerpo en los dos sitios
   por igual, sin que ninguno se enterara del alto real del otro. */
export function arribaConLogoCm(altoLogoCm) {
  const alto = Number(altoLogoCm) > 0 ? Number(altoLogoCm) : medidaEnCm(HOJA.altoEncabezado);
  return medidaEnCm(HOJA.borde) + alto + AIRE_TRAS_LOGO_CM;
}

/* El alto del logo tal como lo dejó el extractor en el `style` de sus imágenes: puede
   haber más de una (el encabezado concatena todos los artefactos que encontró), así que
   se toma la más alta, no la primera — una imagen chica adelante no puede esconder que
   otra más atrás desborda el hueco reservado. */
export function altoMaximoDeEncabezado(htmlEncabezado) {
  const alturas = [...String(htmlEncabezado || '').matchAll(/height:\s*([\d.]+)cm/g)]
    .map((m) => Number(m[1]))
    .filter((n) => Number.isFinite(n) && n > 0);
  return alturas.length ? Math.max(...alturas) : null;
}

export const REGLAS_DOCUMENTO = [
  ['h1', 'font-size:1.5em;color:#0E1726;border-bottom:2px solid #0FA3A1;padding-bottom:6px;margin:0;padding:0'],
  ['h2', 'font-size:1.2em;color:#0E1726;border-bottom:1px solid #E2E8F0;' +
         'padding-bottom:4px;margin:0;padding:0'],
  ['h3', 'font-size:1.05em;color:#0E1726;margin:0;padding:0'],
  /* El aspecto de las tablas lo fijó el usuario (2026-08-19) con un modelo HTML: rejilla negra
     completa, cabecera gris con letra negra en negrita, celdas blancas y todo centrado. Antes
     era una cabecera azul oscuro (#0E1726) con letra blanca y sin bordes verticales.

     La tipografía y el tamaño van aquí y no se heredan del cuerpo: ver `PUNTOS_TABLA`. Los tres
     emisores del informe —esta hoja para el previo y el .doc, `docxWriter.js` y
     `generarTablaOoxml` en `docxRelleno.js` para el .docx— tienen que decir lo mismo, o pantalla
     y archivo divergen en el 99 % del texto de tabla del informe: 2311 nodos de 2333, medido.
     Es la misma clase de asimetría que ya costó cuatro fallos en este proyecto.

     `table-layout:fixed` reparte las columnas a partes iguales sin mirar el contenido, que es
     lo que hace el writer del .docx con sus `columnWidths`: sin esto una razón social larga
     ensancha su columna en pantalla y no en el archivo. */
  ['table', 'width:100%;border-collapse:collapse;margin:16px 0;table-layout:fixed;' +
            'font-family:' + FUENTE_TABLA_CSS + ';font-size:' + PUNTOS_TABLA + 'pt;' +
            'border:1.5px solid #000000'],
  ['th', 'border:1px solid #000000;background:#999999;color:#000000;font-weight:bold;' +
         'padding:5px 6px;text-align:center;vertical-align:middle;word-break:break-word'],
  ['td', 'border:1px solid #000000;background:#FFFFFF;color:#000000;font-weight:normal;' +
         'padding:5px 6px;text-align:center;vertical-align:middle;word-break:break-word'],
  /* Word ignora un `<strong>` anidado en un `<span>` con estilo si no se le dice que el
     peso se hereda; con esto la negrita del informe llega intacta. */
  ['strong', 'font-weight:bold'],
  ['em', 'font-style:italic'],
  ['p,li', 'text-align:justify;margin:0;padding:0'],
  /* El `td` ya NO se justifica, pero sacarlo de la regla de arriba no basta: las celdas de la
     plantilla son `<td><p>AKATSUKI INC.</p></td>` —el extractor emite el `P` de dentro de la
     celda como párrafo— y `p{text-align:justify}` le gana a la herencia del `td`. Sin esta
     regla el texto sigue justificado dentro de una celda que se cree centrada. Va por
     especificidad (0,0,2 contra 0,0,1), no por orden. */
  ['td p,th p,td li', 'text-align:center;margin:0;padding:0'],
  /* Las ecuaciones de ajuste de capital. En pantalla y en el `.doc` se ven como una línea de
     texto —centrada y en la tipografía matemática, que es lo más cerca que se puede estar sin
     un motor de fórmulas—; en el `.docx` se sustituyen por la ecuación de Word de verdad. Va
     después de `p` para ganarle la justificación. */
  ['p[data-formula]', "text-align:center;font-family:'Cambria Math','Cambria',serif;" +
                      'font-style:italic;margin:8px 0'],
  /* Red de seguridad de las imágenes. Cada una lleva ya el tamaño que le da el PDF,
     pero esta regla es la que impide que una sin medida —una plantilla vieja, un .docx
     por mammoth— desborde la hoja. No la había en el .doc, y como el previo sí la
     recibe de Tailwind por su cuenta, en pantalla todo cuadraba mientras en Word la
     figura de la página 11 medía 29,9 cm contra 21,6 de papel y el desborde se repartía
     en páginas nuevas. `height:auto` va con ella para no deformar lo que se recorta. */
  ['img', 'max-width:100%;height:auto'],
  /* La llamada de una nota al pie. El lector la aparta en un `sup`; sin esta regla el navegador
     la sube pero el .doc la dejaría a media altura de línea, que es como se veía antes de que
     existiera el `sup`: un dígito pequeño indistinguible de un número cualquiera.
     En el .docx no hace falta —ahí es una referencia de Word y la coloca Word—. */
  ['sup', 'vertical-align:super;font-size:0.7em;line-height:0'],
  /* Las citas al pie de cada página, que el lector vuelca al final de su hoja. La línea de
     arriba imita la separadora que Word dibuja sobre sus notas al pie; va sólo sobre la primera
     nota de la página, y la regla siguiente es la que se la quita a las demás. Es una imitación
     y no un calco —la de Word ocupa un tercio del ancho—, y no se acota con `width` porque eso
     estrecharía también el texto de esa nota. El documento que se radica lleva la línea de
     verdad: en el .docx éstas son notas al pie reales y las dibuja Word. */
  ['div[data-nota-pie]',
    'font-size:8pt;text-align:justify;margin:0;padding:4px 0 0;' +
    'border-top:1px solid #0E1726;margin-top:12px'],
  ['div[data-nota-pie]+div[data-nota-pie]', 'border-top:none;margin-top:0;padding-top:0'],
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
  /* El logo se ancla al lado que el PDF le da, y con el alto que le da. Antes iba
     siempre a la izquierda y a 1,5 cm fijos, y el del informe de referencia va a la
     derecha y mide 1,23 cm. */
  const anclaje = lado === 'derecha' ? 'right center' : lado === 'izquierda' ? 'left center' : 'center';
  const altoLogo = alto || HOJA.altoEncabezado;
  /* El hueco de arriba se calcula sobre el alto REAL del logo, no sobre una constante
     pensada para el 1,5cm por defecto: un logo de 5,53cm (el del informe de referencia)
     o uno mayor invadía el cuerpo aunque este número diga lo contrario. */
  const arriba = logo ? arribaConLogoCm(medidaEnCm(altoLogo)).toFixed(2) + 'cm' : HOJA.margen;
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
    'line-height:1.15;' + cuerpoDe(base) + '}' +
    /* Papel blanco también en tema oscuro: el previo es la hoja, no la interfaz. */
    '.hojas .pagina *{color:inherit}' +
    /* `*{color:inherit}` pisa el color de la cabecera, así que hace falta la excepción. En
       NEGRO desde que la cabecera es gris: con el `#fff` de antes quedaría letra blanca sobre
       gris, ilegible en pantalla mientras el archivo se ve bien. */
    '.hojas .pagina th{color:#000000}' +
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
  return 'body{' + cuerpoDe(base) + ';color:#222;background:#fff;line-height:1.15;' +
    'margin:0;padding:0}' + reglasDocumento();
}

/* Añade a cada imagen los atributos `width` y `height` en píxeles, deducidos del tamaño en
   centímetros que el extractor le puso en el `style`.

   Hace falta porque Word ignora buena parte del CSS: ya se comprobó con `max-width`, que no
   respeta, y con las pseudoclases de CSS 3. El `width` de una hoja de estilos sobre una imagen
   entra en la misma categoría de "puede que sí, puede que no". Los atributos `width` y
   `height` de HTML son de 1995 y Word los obedece siempre.

   Los dos conviven sin pelear, y cada uno gana donde debe: un navegador da prioridad al CSS en
   centímetros, que es exacto; Word usa los atributos. Por eso el previo no cambia.

   Una imagen sin tamaño en el `style` —una plantilla anterior a la versión 7 del lector— se
   deja como está: inventarle un tamaño sería peor que dejar que salga al natural, porque
   parecería correcto. Para eso está el aviso de versión. */
export function conTamanoDeImagen(html) {
  const cajaTextoCm = medidaEnCm(HOJA.ancho) - 2 * medidaEnCm(HOJA.margen);
  return String(html || '').replace(/<img\s[^>]*>/g, (etiqueta) => {
    if (/\s(?:width|height)=/.test(etiqueta)) return etiqueta;
    const estilo = (/style="([^"]*)"/.exec(etiqueta) || [])[1] || '';
    let ancho = medidaEnCm((/width:\s*([\d.]+cm)/.exec(estilo) || [])[1]);
    let alto = medidaEnCm((/height:\s*([\d.]+cm)/.exec(estilo) || [])[1]);
    if (!ancho || !alto) return etiqueta;

    let estiloNuevo = estilo;
    if (ancho > cajaTextoCm) {
      alto = alto * (cajaTextoCm / ancho);
      ancho = cajaTextoCm;
      estiloNuevo = estilo
        .replace(/width:\s*[\d.]+cm/g, 'width:' + ancho.toFixed(2) + 'cm')
        .replace(/height:\s*[\d.]+cm/g, 'height:' + alto.toFixed(2) + 'cm');
    }

    let res = etiqueta.replace(/<img\s/,
      '<img width="' + cmAPixeles(ancho) + '" height="' + cmAPixeles(alto) + '" ');
    if (estiloNuevo !== estilo) {
      res = res.replace(/style="[^"]*"/, 'style="' + estiloNuevo + '"');
    }
    return res;
  });
}

/* Un salto de página que Word obedece: un elemento, un salto.

   `clear="all"` es lo que hace que no se cuele junto a nada flotante que haya quedado
   arriba, y es la forma que emite Word cuando uno guarda un documento como página web. */
const SALTO_DE_PAGINA = '<br clear="all" style="page-break-before:always" />';

/* Mete un salto de página delante de cada página del original menos la primera.

   Aquí está el fallo que produjo un documento de 834 hojas para 112 páginas, y que sobrevivió
   a tres arreglos porque yo daba por causa otra cosa.

   Lo que había era una regla `div.pagina{page-break-before:always}`. **Word no tiene `div`**:
   su modelo de documento son párrafos, tablas y secciones. Cuando el importador de HTML
   encuentra un `div` con propiedades de bloque no puede crear una caja —no existe— así que las
   EMPUJA a cada párrafo que hay dentro. Y en Word el salto de página es una propiedad de
   párrafo (`w:pageBreakBefore`). Resultado: un salto delante de casi cada párrafo suelto.

   Medido sobre el documento generado: 810 párrafos fuera de tablas contando cada racha de
   vacíos como una sola, contra las 834 hojas que marcaba Word. Los párrafos de dentro de las
   tablas no cuentan porque acaban en celdas, y una celda no arrastra el salto. Por eso el
   número seguía la cuenta de párrafos SUELTOS y no la de los 3972 del documento, y por eso
   quitar las 889 filas roscadas no cambió ni una hoja.

   Con el salto como elemento propio hay exactamente uno por página. La primera no lleva
   ninguno delante: empieza en la hoja 1. */
export function conSaltosDePagina(html) {
  let primera = true;
  return String(html || '').replace(/<div class="pagina"/g, (coincidencia) => {
    if (primera) { primera = false; return coincidencia; }
    return SALTO_DE_PAGINA + coincidencia;
  });
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
    /* Aquí NO va ninguna regla de salto de página, y es el hallazgo que costó más caro de
       toda esta historia.

       Lo que había era `div.pagina{page-break-before:always}`, y producía un documento de 834
       hojas para 112 páginas. **Word no tiene `div`**: su modelo de documento son párrafos,
       tablas y secciones. Cuando el importador de HTML encuentra un `div` con propiedades de
       bloque, no puede crear una caja —no existe—, así que las EMPUJA a cada párrafo que hay
       dentro. Y `page-break-before` es, en Word, una propiedad de párrafo
       (`w:pageBreakBefore`). Resultado: salto de página delante de casi cada párrafo.

       Medido sobre el documento generado: los párrafos que están fuera de tablas, contando
       cada racha de vacíos como una sola, son 810. Word marcaba 834 hojas. Los de dentro de
       las tablas no cuentan porque acaban en celdas, y una celda no arrastra el salto: por eso
       el número seguía la cuenta de párrafos SUELTOS y no la de todos. Y por eso quitar las
       889 filas roscadas no cambió ni una hoja, aunque yo diera esa por la causa.

       El salto va como un elemento propio entre página y página —un `<br>` con el estilo en
       línea, que lo pone `handleDownload`—: un elemento, un salto, sin nada que empujar hacia
       abajo. La portada no lleva ninguno delante, que era el otro fallo. */
    ''
  );
}
