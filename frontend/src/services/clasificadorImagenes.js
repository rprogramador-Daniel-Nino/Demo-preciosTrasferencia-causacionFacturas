/* Clasificación de las imágenes embebidas en un PDF de referencia.
   Función pura: no toca pdf.js, ni el DOM, ni disco. */

/* Fracción del área de la página a partir de la cual una imagen se considera
   una página escaneada y no un recurso reutilizable. */
export const UMBRAL_PAGINA = 0.8;

/* Decide qué es una imagen a partir del espacio que ocupa sobre la página.
   Se usa la superficie renderizada y no las dimensiones en píxeles del
   archivo: un logo en alta resolución puede tener más píxeles que un escaneo
   mediocre, pero en la página ocupa una esquina. */
export function clasificarImagen(render, pagina) {
  const areaPagina = (pagina?.ancho || 0) * (pagina?.alto || 0);
  const areaRender = (render?.ancho || 0) * (render?.alto || 0);
  if (areaPagina <= 0 || areaRender <= 0) return 'recurso';
  const EPSILON = 1e-9;
  return areaRender / areaPagina >= UMBRAL_PAGINA - EPSILON ? 'pagina' : 'recurso';
}
