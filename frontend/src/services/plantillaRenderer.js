/* Plantilla marcada + estudio + recursos → HTML final.
   Sustituye por nombre de campo, no por valor literal: es lo que impide que un
   dato del cliente anterior sobreviva cuando alguien agrega texto a la
   plantilla sin acordarse de añadir su regla. */

import { valorDeCampo } from './plantillaVocabulario.js';

/* Resalta el valor sustituido en la vista previa. Los estilos se limpian al
   exportar, igual que hoy hace ReporteGenerador. */
const resaltar = (valor) =>
  '<span style="font-weight:600;color:#0B7C7A;border-bottom:1px dashed #0FA3A1;' +
  'background-color:#F0FDF4;padding:0 4px;border-radius:3px;">' + valor + '</span>';

const RX_MARCA = /<span data-campo="([^"]+)">([\s\S]*?)<\/span>/g;

export function renderizar(htmlMarcado, estudio, recursos = []) {
  const vacios = new Set();

  let html = String(htmlMarcado || '').replace(RX_MARCA, (_, campo) => {
    const valor = valorDeCampo(estudio, campo);
    if (valor === null) {
      vacios.add(campo);
      return resaltar('—');
    }
    return resaltar(valor);
  });

  for (const r of recursos) {
    html = html.replace(
      new RegExp('<img data-recurso="' + r.id + '"[^>]*>', 'g'),
      '<img data-recurso="' + r.id + '" src="' + r.dataUrl + '" />'
    );
  }

  return { html, vacios: [...vacios] };
}
