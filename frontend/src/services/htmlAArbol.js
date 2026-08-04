/* Recorrido del HTML sin DOM.

   El writer del .docx tiene que recorrer el HTML final y en `node --test` no hay navegador.
   Meter `jsdom` sería una dependencia grande para leer un HTML que produce este mismo
   proyecto: el extractor emite un conjunto cerrado de etiquetas. Con esto el writer se prueba
   entero sin navegador, que es la lección de los cuatro fallos que sólo se veían abriendo Word.

   Es tolerante a propósito. El HTML también llega de `mammoth` y del `contentEditable` del
   previo, donde el navegador mete etiquetas que no controlamos: una etiqueta desconocida se
   vuelve transparente y sus hijos siguen, en vez de perderse. Perder texto de un documento que
   se radica ante la DIAN es el peor resultado posible. */

/* No cierran, así que no abren ámbito. Tratarlas como abiertas dejaba todo el resto del
   documento colgando dentro de la imagen. */
const VACIAS = new Set(['img', 'br', 'hr', 'meta', 'link', 'input', 'col']);

/* Script y style llevan contenido crudo (JS y CSS), no HTML. */
const CRUDAS = new Set(['script', 'style']);

/* Etiquetas que cierran implícitamente la anterior del mismo tipo. Regla de HTML5.
   Esto es lo que hace que `<p>a<p>b` produzca dos párrafos hermanos, no anidados.
   Aplica cuando mammoth o el contentEditable emiten HTML sin cerrar. */
const CIERRA_IMPLICITA = {
  p: 'p', li: 'li', td: ['td', 'th'], th: ['td', 'th'], tr: 'tr',
};

const ENTIDADES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–',
};

const desescapar = (s) =>
  s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (todo, cuerpo) => {
    if (cuerpo[0] === '#') {
      const n = cuerpo[1] === 'x' || cuerpo[1] === 'X'
        ? parseInt(cuerpo.slice(2), 16) : parseInt(cuerpo.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : todo;
    }
    const v = ENTIDADES[cuerpo.toLowerCase()];
    return v === undefined ? todo : v;
  });

const leerAtributos = (texto) => {
  const attrs = {};
  const rx = /([a-zA-Z_:][-\w:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m;
  while ((m = rx.exec(texto))) {
    attrs[m[1].toLowerCase()] = desescapar(m[3] ?? m[4] ?? m[5] ?? '');
  }
  return attrs;
};

export function htmlAArbol(html) {
  const raiz = { etiqueta: '#raiz', atributos: {}, hijos: [] };
  const pila = [raiz];
  const cima = () => pila[pila.length - 1];

  /* Un solo recorrido: etiqueta de cierre, comentario, CDATA, declaración,
     instrucción de proceso, etiqueta de apertura. Regla crítica: ninguna
     alternativa puede consumir un <, que siempre empieza algo nuevo. */
  const rx = /<\/([a-zA-Z][-\w:]*)\s*>|<!--[^<]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<![^<>]*>|<\?[^<]*?\?>|<([a-zA-Z][-\w:]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let ultimo = 0;
  let m;

  const empujarTexto = (bruto) => {
    if (!bruto) return;
    const texto = desescapar(bruto);
    if (texto) cima().hijos.push({ texto });
  };

  while ((m = rx.exec(html))) {
    empujarTexto(html.slice(ultimo, m.index));
    ultimo = rx.lastIndex;

    if (m[1]) {
      /* Cierre. Se busca hacia arriba en vez de exigir que sea la cima: así un
         `<p><strong>a</p>` cierra el `strong` de paso en vez de descuadrar el resto. */
      const etiqueta = m[1].toLowerCase();
      const i = pila.map((n) => n.etiqueta).lastIndexOf(etiqueta);
      if (i > 0) pila.length = i;
      continue;
    }
    if (m[2]) {
      /* CDATA: su contenido es texto. */
      empujarTexto(m[2]);
      continue;
    }
    if (m[3]) {
      const etiqueta = m[3].toLowerCase();

      /* Script y style llevan contenido crudo (JS y CSS), no HTML. */
      if (CRUDAS.has(etiqueta)) {
        const nodo = { etiqueta, atributos: leerAtributos(m[4] || ''), hijos: [] };
        cima().hijos.push(nodo);

        const cierre = new RegExp('</' + etiqueta + '\\s*>', 'i');
        const resto = html.slice(rx.lastIndex);
        const match = cierre.exec(resto);

        if (match) {
          ultimo = rx.lastIndex + match.index + match[0].length;
          rx.lastIndex = ultimo;
        } else {
          /* Si no aparece el cierre, descarta hasta el final. */
          ultimo = html.length;
          rx.lastIndex = html.length;
        }
        continue;
      }

      /* Cierre implícito: una etiqueta de apertura cierra la anterior del mismo tipo.
         Es la regla de HTML5, y es lo que produce mammoth y el contentEditable. */
      const acierraA = CIERRA_IMPLICITA[etiqueta];
      if (acierraA) {
        const cierre = Array.isArray(acierraA) ? acierraA : [acierraA];
        /* `tr`/`td`/`th` cierran la etiqueta del mismo tipo dentro de SU tabla, nunca
           cruzando a una tabla exterior: sin este límite, la `tr` de una tabla anidada en una
           celda encontraba la `tr` de la tabla de fuera y la cerraba, aplanando las dos
           tablas en una sola. `p`/`li` no llevan límite: no anidan en un contenedor propio. */
        const limite = (etiqueta === 'tr' || etiqueta === 'td' || etiqueta === 'th')
          ? pila.map((n) => n.etiqueta).lastIndexOf('table') : -1;
        for (const e of cierre) {
          let i = -1;
          for (let k = pila.length - 1; k > limite; k--) {
            if (pila[k].etiqueta === e) { i = k; break; }
          }
          if (i > 0) pila.length = i;
        }
      }

      const nodo = { etiqueta, atributos: leerAtributos(m[4] || ''), hijos: [] };
      cima().hijos.push(nodo);
      const cierraSola = /\/\s*$/.test(m[4] || '');
      if (!VACIAS.has(etiqueta) && !cierraSola) pila.push(nodo);
      continue;
    }
    /* Comentario, declaración, instrucción de proceso: se descartan sin tocar la pila. */
  }
  empujarTexto(html.slice(ultimo));
  return raiz;
}

/* Todo el texto de un subárbol. Es lo que permite decidir si un bloque está vacío. */
export function textoDe(nodo) {
  if (!nodo) return '';
  if (nodo.texto !== undefined) return nodo.texto;
  return (nodo.hijos || []).map(textoDe).join('');
}
