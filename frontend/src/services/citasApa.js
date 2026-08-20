/* ─────────────────────────────────────────────────────────────────────────────
   citasApa.js — la referencia bibliográfica de una fuente, como la escriben las notas al pie
   del informe.

   POR QUÉ. La Sección III citaba sus fuentes en un párrafo «FUENTE:» al final del apartado, con
   las URL crudas entre paréntesis y todas seguidas: «FUENTE: Acoplásticos / BluRadio
   (https://www.bluradio.com/economia/exportaciones-de-plasticos-y-caucho-de-colombia-crecieron-7-4…);
   Acoplásticos / La Nota Económica (https://…); …, consultado el 19 de agosto de 2026». Ocupaba
   media página de direcciones ilegibles en el cuerpo del documento, mientras el resto del informe
   —lo que escribe el consultor a mano— cita al pie y en formato bibliográfico:

     6  DANE. (s.f.). Resultados Producción industrial - Encuesta Mensual de Industria - EMIM.
        Recuperado de https://www.dane.gov.co/index.php/estadisticas-por-tema/industria/…

   Este módulo produce esa cadena. Quién la convierte en nota al pie es otro asunto:
   `notasAlPieOoxml.js` para el .docx y el bloque de notas del apartado en la ruta del PDF.

   EL FORMATO ES EL DE LA PLANTILLA, no el del manual. La APA en español pediría «(2025, 19 de
   febrero)», pero las notas que el informe ya trae escriben «(2025, febrero 19)», y un documento
   que cita de dos maneras distintas se lee como un documento hecho por dos personas. Manda la
   plantilla.

   NUNCA QUEDA UN HUECO (requisito del usuario, 2026-08-20). Una cita a medias —«. (). …»— es
   peor que la línea que se venía publicando, así que cada parte tiene su respaldo y ninguno
   inventa nada:

     · sin fecha de publicación → «(s.f.)», que es lo que la propia plantilla usa para el DANE;
     · sin título del artículo → el nombre de lo que esa fuente respalda (la serie o la tabla),
       que es un dato que el sistema ya tiene y no una suposición sobre la página;
     · sin URL → se omite «Recuperado de», y la cita se sostiene con autor, fecha y título.

   Si falta el autor no hay cita: se devuelve cadena vacía para que el llamador sepa que no hay
   nada real que publicar, en vez de dejar una nota al pie hueca colgando de un número.
   ───────────────────────────────────────────────────────────────────────────── */

/* Los meses como los escribe el informe. En minúscula: así van dentro del paréntesis de la
   fecha, y así aparecen en las notas de la plantilla. */
const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

const limpio = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();

/* El punto final se pone una sola vez: los títulos y los nombres de fuente llegan tanto con
   punto como sin él, según los escriba el modelo. */
const conPunto = (t) => {
  const s = limpio(t);
  if (!s) return '';
  return /[.!?]$/.test(s) ? s : s + '.';
};

/**
 * La fecha de publicación entre paréntesis, en el formato de las notas del informe.
 *
 * Acepta lo que devuelva el modelo o lo que traiga el respaldo local: una fecha ISO
 * (`2025-02-19`), un año suelto (`2025`, `"2025"`) o ya escrita («2025, febrero 19»). Lo que no
 * se pueda leer con seguridad se trata como si no hubiera fecha: «(s.f.)» es un dato honesto,
 * una fecha a medio adivinar no.
 *
 * @param {string|number|Date|null} fecha
 * @returns {string} «(2025, febrero 19)», «(2025)» o «(s.f.)».
 */
export function fechaDeCita(fecha) {
  if (fecha instanceof Date && !Number.isNaN(fecha.getTime())) {
    return `(${fecha.getFullYear()}, ${MESES[fecha.getMonth()]} ${fecha.getDate()})`;
  }

  const s = limpio(fecha);
  if (!s) return '(s.f.)';

  /* Año, mes y día, con o sin hora detrás. */
  const iso = /^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/.exec(s);
  if (iso) {
    const anio = Number(iso[1]);
    const mes = Number(iso[2]);
    const dia = iso[3] ? Number(iso[3]) : null;
    if (mes >= 1 && mes <= 12) {
      return dia ? `(${anio}, ${MESES[mes - 1]} ${dia})` : `(${anio}, ${MESES[mes - 1]})`;
    }
    return `(${anio})`;
  }

  /* Ya viene escrita: se respeta tal cual, sin el paréntesis si ya lo trae. */
  if (/[a-záéíóúñ]/i.test(s)) {
    const dentro = /^\((.*)\)$/.exec(s);
    return `(${dentro ? dentro[1] : s})`;
  }

  /* Un año suelto. El rango descarta un número que no puede ser un año de publicación. */
  const anio = Number(s);
  if (Number.isInteger(anio) && anio >= 1900 && anio <= 2200) return `(${anio})`;

  return '(s.f.)';
}

/**
 * Parte «Entidad, Publicación» en el autor y el título con que se cita.
 *
 * Las fuentes del sistema vienen en una sola cadena: «Departamento Administrativo Nacional de
 * Estadística (DANE), Índice de Precios al Consumidor (IPC)», «DANE, GEIH». La coma separa a
 * quién se cita de qué se cita, que es exactamente el corte que pide una referencia
 * bibliográfica, y es como están escritas las notas de la plantilla: «DANE. (s.f.).
 * Resultados Producción industrial - Encuesta Mensual de Industria - EMIM.».
 *
 * Se corta por la PRIMERA coma y solo por ella: el título suele llevar comas dentro. Sin coma
 * —«Acoplásticos / BluRadio»— todo es el autor y el título lo pone quien llame, que sabe qué
 * dato respalda esa fuente.
 *
 * @param {string} texto
 * @returns {{medio:string, titulo:string}}
 */
export function partirMedioYTitulo(texto) {
  const s = limpio(texto);
  if (!s) return { medio: '', titulo: '' };

  const coma = s.indexOf(',');
  if (coma === -1) return { medio: s, titulo: '' };

  const medio = s.slice(0, coma).trim();
  const titulo = s.slice(coma + 1).trim();
  /* Una coma al principio o al final no separa nada. */
  if (!medio || !titulo) return { medio: s.replace(/^,|,$/g, '').trim(), titulo: '' };
  return { medio, titulo };
}

/**
 * La referencia completa de una fuente, para publicarla como nota al pie.
 *
 * @param {object} f
 * @param {string} f.medio  quién publica: la entidad o el medio («DANE», «La República»). Sin
 *        esto no hay cita.
 * @param {string} [f.titulo]  el título del documento o del artículo.
 * @param {string} [f.tituloRespaldo]  qué respalda esta fuente —el nombre de la serie o de la
 *        tabla—, para cuando no hay título propio. Es un dato del sistema, no una suposición.
 * @param {string|number|Date} [f.fecha]  fecha de publicación.
 * @param {string} [f.url]
 * @param {string} [f.fechaConsulta]  cuándo se consultó, ya escrita («19 de agosto de 2026»).
 * @returns {string} la cita, o vacío si no hay ni medio ni nada con lo que sostenerla.
 */
export function citaApa(f = {}) {
  const medio = limpio(f.medio);
  if (!medio) return '';

  const titulo = limpio(f.titulo) || limpio(f.tituloRespaldo);
  const url = limpio(f.url);
  const consulta = limpio(f.fechaConsulta);

  const partes = [conPunto(medio), fechaDeCita(f.fecha) + '.'];
  if (titulo) partes.push(conPunto(titulo));

  if (url) {
    /* Con fecha de consulta se usa la forma que la reconoce; sin ella, la de la plantilla. */
    partes.push(consulta ? `Recuperado el ${consulta}, de ${url}` : `Recuperado de ${url}`);
  }

  return partes.join(' ');
}

/**
 * Las citas de varias fuentes, sin repetir y sin las que no se sostienen.
 *
 * Se deduplica por URL cuando la hay y por medio+título cuando no: la misma corrida trae la
 * misma fuente citada por varias filas de la tabla, y el informe no puede llevar la misma nota
 * al pie tres veces.
 *
 * @param {Array<object>} fuentes  cada una como las acepta `citaApa`.
 * @returns {Array<{cita:string, url:string}>} en el orden en que llegaron.
 */
export function citasApa(fuentes) {
  const vistas = new Set();
  const salida = [];
  for (const f of fuentes || []) {
    const cita = citaApa(f);
    if (!cita) continue;
    const url = limpio(f && f.url);
    const clave = (url || `${limpio(f.medio)}|${limpio(f.titulo) || limpio(f.tituloRespaldo)}`)
      .toLowerCase();
    if (vistas.has(clave)) continue;
    vistas.add(clave);
    salida.push({ cita, url });
  }
  return salida;
}
