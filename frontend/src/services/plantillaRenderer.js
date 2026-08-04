/* Plantilla marcada + estudio + recursos → HTML final.
   Sustituye por nombre de campo, no por valor literal: es lo que impide que un
   dato del cliente anterior sobreviva cuando alguien agrega texto a la
   plantilla sin acordarse de añadir su regla. */

import { valorDeCampo } from './plantillaVocabulario.js';
import { resaltarValor } from './estiloDocumento.js';

/* Escapa caracteres especiales para usar en una expresión regular. */
const escaparParaRegex = (texto) => String(texto).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* Escapa caracteres HTML para evitar inyección. */
const escaparHTML = (texto) => {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  };
  return String(texto).replace(/[&<>"']/g, (c) => map[c]);
};

/* Resalta el valor sustituido en la vista previa. Va por clase, y el estilo lo pinta
   sólo el CSS del previo: así no hay nada que limpiar al exportar. Antes era un `style=`
   inline y la exportación quitaba tres de sus seis propiedades a mano, así que las otras
   tres se colaban en el documento que se radica. */
const resaltar = resaltarValor;

const RX_MARCA = /<span data-campo="([^"]+)">([\s\S]*?)<\/span>/g;

export function renderizar(htmlMarcado, estudio, recursos = []) {
  const vacios = new Set();
  const recursosFaltantes = new Set();

  let html = String(htmlMarcado || '').replace(RX_MARCA, (_, campo) => {
    const valor = valorDeCampo(estudio, campo);
    if (valor === null) {
      vacios.add(campo);
      return resaltar('—');
    }
    return resaltar(escaparHTML(valor));
  });

  /* Rastrea qué recursos están presentes en el HTML. */
  const recursosEnHTML = new Set();
  const rxRecurso = /data-recurso="([^"]+)"/g;
  let m;
  while ((m = rxRecurso.exec(html)) !== null) {
    recursosEnHTML.add(m[1]);
  }

  /* Resuelve los recursos contra el catálogo. */
  const recursoMap = new Map(recursos.map((r) => [r.id, r.dataUrl]));

  for (const id of recursosEnHTML) {
    if (recursoMap.has(id)) {
      const dataUrl = recursoMap.get(id);
      html = html.replace(
        new RegExp('<img data-recurso="' + escaparParaRegex(id) + '"[^>]*>', 'g'),
        (_) => {
          /* Usa callback para evitar que caracteres especiales en dataUrl se interpreten. */
          return '<img data-recurso="' + id + '" src="' + dataUrl + '" />';
        }
      );
    } else {
      recursosFaltantes.add(id);
    }
  }

  if (recursosFaltantes.size > 0) {
    console.warn('[plantillaRenderer] Recursos faltantes: ' + [...recursosFaltantes].join(', '));
  }

  return { html, vacios: [...vacios], recursosFaltantes: [...recursosFaltantes] };
}
