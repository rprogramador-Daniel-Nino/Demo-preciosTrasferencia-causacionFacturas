/* Detección de las páginas de un PDF de referencia que corresponden a un anexo
   escaneado. Funciones puras: no tocan pdf.js, ni el DOM, ni disco. */

/* Fracción del área de la página a partir de la cual una imagen se considera
   dominante en esa página. Verificado contra el PDF de referencia real: las
   páginas del anexo se dibujan al 52,1-54,4 %, y lo siguiente más grande es un
   gráfico suelto al 20,9 %. 0,35 cae en mitad de ese hueco. */
export const UMBRAL_DOMINANTE = 0.35;

/* Umbral con el que entra una página INTERIOR de un anexo ya detectado. Una hoja escaneada
   puede acabarse a media página —la última de un estado financiero— y quedarse por debajo de
   UMBRAL_DOMINANTE: en el informe de ATEB 2024 la página 54 se dibuja al 31,1 % entre
   veintisiete páginas al 52 %. Quedarse fuera del anexo no la deja en blanco, la deja COPIADA:
   el informe de 2025 se radicaba con una hoja firmada de 2024 dentro, que es justo lo que el
   hueco existe para evitar. 0,25 cae entre ese 31,1 % y el gráfico suelto más grande del
   cuerpo (20,9 %), y sólo se aplica encerrado entre páginas de anexo, así que fuera de un
   anexo un gráfico grande sigue siendo un gráfico. */
export const UMBRAL_INTERIOR = 0.25;

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

  /* Los huecos que quedan DENTRO del anexo. Se hace al final y sobre el conjunto ya formado
     porque la condición es estar encerrado: el hueco se llena sólo si el anexo continúa al
     otro lado y todas sus páginas llegan al umbral interior. Así una hoja a media página no
     rompe el anexo, y las páginas de texto que separan un anexo del siguiente —el título del
     que viene, su índice— siguen fuera. */
  const paginas = [...anexo].sort((a, b) => a - b);
  for (let i = 0; i + 1 < paginas.length; i += 1) {
    const desde = paginas[i];
    const hasta = paginas[i + 1];
    if (hasta - desde <= 1) continue;
    const hueco = [];
    for (let p = desde + 1; p < hasta; p += 1) hueco.push(p);
    if (hueco.every((p) => (dominanteDe.get(p) || 0) >= UMBRAL_INTERIOR)) {
      for (const p of hueco) anexo.add(p);
    }
  }

  return anexo;
}

/* Compatibilidad hacia atrás con pdfReferenceExtractor que aún usa clasificarImagen.
   Esta función usa el antiguo umbral (0.8) para mantener comportamiento previo. */
export const UMBRAL_PAGINA = 0.8;
export function clasificarImagen(render, pagina) {
  const areaPagina = (pagina?.ancho || 0) * (pagina?.alto || 0);
  const areaRender = (render?.ancho || 0) * (render?.alto || 0);
  if (areaPagina <= 0 || areaRender <= 0) return 'recurso';
  const EPSILON = 1e-9;
  return areaRender / areaPagina >= UMBRAL_PAGINA - EPSILON ? 'pagina' : 'recurso';
}
