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
