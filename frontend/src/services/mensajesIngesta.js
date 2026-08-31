/* ─────────────────────────────────────────────────────────────────────────────
   mensajesIngesta.js — qué se le dice al analista cuando una lectura con IA no devuelve lo
   que se esperaba.

   POR QUÉ EXISTE. Se vio en pruebas el 2026-08-31: se cargó un DICTAMEN de revisor fiscal en la
   casilla del certificado de composición accionaria. El modelo lo leyó bien y devolvió
   `accionistas: []` —correcto, un dictamen no lista accionistas—, no hubo excepción, y el
   handler solo cambiaba el mensaje en dos ramas: éxito CON datos, o error. La tercera —«leyó y
   no encontró nada»— no existía, así que el texto en pantalla se quedaba en «🤖 Leyendo
   Certificado…». El spinner sí se apagaba, pero para quien mira eso es un cuelgue, y el
   analista se queda esperando algo que ya pasó.

   El mismo hueco estaba en la lectura de RUT y Cámara de Comercio (`if (data)` sin `else`), con
   un agravante: cantaba «✅ RUT extraído con éxito» aunque no hubiera llenado un solo campo.

   LA REGLA QUE ESTE MÓDULO IMPONE: toda lectura termina en un mensaje, y el mensaje distingue
   tres desenlaces que antes se confundían entre sí o se quedaban mudos.

     · `ok`     — se leyó y hay datos que aplicar.
     · `aviso`  — se leyó bien y NO hay nada que aplicar. Casi siempre es el documento
                  equivocado, y decirlo ahorra el reintento inútil con el mismo archivo.
     · `error`  — no se pudo leer. Aquí sí tiene sentido reintentar, o escribirlo a mano.

   `aplicar` existe para que un resultado vacío no pise lo que el analista ya tenía escrito: una
   lista de accionistas vacía sobrescribiendo una buena es peor que no haber cargado nada.

   Mismo patrón que `semaforoRadicacion.js`: servicio puro, sin React, que la pantalla solo
   pinta. Es lo que permite probar la decisión sin montar el componente — y estas tres ramas son
   una decisión, no un estilo.
   ───────────────────────────────────────────────────────────────────────────── */

/** Los documentos de identificación que lee el paso 1, con su nombre para el mensaje. */
const NOMBRE_DOCUMENTO = {
  rut: 'RUT',
  camara: 'Cámara de Comercio',
};

/** Los campos que cada lectura puede llenar, para poder contar cuántos entraron de verdad. */
const CAMPOS_CONTABLES = ['ent', 'nit', 'ciiu', 'direccion', 'representante', 'objeto'];

const plural = (n, singular, prefijoPlural = 's') => `${n} ${singular}${n === 1 ? '' : prefijoPlural}`;

/**
 * El mensaje de la lectura del certificado de composición accionaria.
 *
 * @param {object} resultado  lo que devolvió `parseAccionistasWithGeminiOCR`.
 * @param {Error}  [fallo]    la excepción, si la hubo.
 * @returns {{tono: 'ok'|'aviso'|'error', texto: string, aplicar: boolean}}
 */
export function mensajeAccionistas(resultado, fallo = null) {
  if (fallo) {
    return {
      tono: 'error',
      texto: '⚠ No se pudo procesar el certificado de composición accionaria. '
        + 'Puede reintentar o ingresar los accionistas a mano.',
      aplicar: false,
    };
  }

  const datos = (resultado && typeof resultado === 'object') ? resultado : {};
  const lista = Array.isArray(datos.accionistas) ? datos.accionistas : [];

  if (lista.length > 0) {
    return {
      tono: 'ok',
      texto: `✅ ${plural(lista.length, 'accionista')} extraído${lista.length === 1 ? '' : 's'} con éxito.`,
      aplicar: true,
    };
  }

  /* La razón social sí leída es la pista de que el documento se leyó de verdad y el problema es
     el documento: si el modelo sacó el nombre de la empresa, no falló la lectura. */
  const empresa = typeof datos.empresa === 'string' ? datos.empresa.trim() : '';
  return {
    tono: 'aviso',
    texto: '⚠ El documento se leyó, pero no encontró ninguna lista de accionistas en él'
      + (empresa ? ` (sí identificó a ${empresa})` : '')
      + '. Verifique que sea el certificado de composición accionaria: un dictamen de revisor '
      + 'fiscal o unos estados financieros no la traen. También puede escribir los accionistas '
      + 'a mano.',
    aplicar: false,
  };
}

/**
 * El mensaje de la lectura del RUT o de la Cámara de Comercio.
 *
 * @param {string} tipo       'rut' | 'camara'.
 * @param {object} campos     los campos que la lectura consiguió llenar.
 * @param {Error}  [fallo]    la excepción, si la hubo.
 * @returns {{tono: 'ok'|'aviso'|'error', texto: string, aplicar: boolean}}
 */
export function mensajeDocumentoIdentidad(tipo, campos, fallo = null) {
  const nombre = NOMBRE_DOCUMENTO[tipo] || 'documento';

  if (fallo) {
    return {
      tono: 'error',
      texto: `⚠ No se pudo procesar el ${nombre}. Por favor ingrese los datos manualmente.`,
      aplicar: false,
    };
  }

  const datos = (campos && typeof campos === 'object') ? campos : {};
  const leidos = CAMPOS_CONTABLES.filter((c) => {
    const v = datos[c];
    return v !== undefined && v !== null && String(v).trim() !== '';
  });

  if (leidos.length > 0) {
    return {
      tono: 'ok',
      texto: `✅ ${nombre} leído: ${plural(leidos.length, 'campo')} extraído${leidos.length === 1 ? '' : 's'}. `
        + 'Revíselos antes de continuar.',
      aplicar: true,
    };
  }

  return {
    tono: 'aviso',
    texto: `⚠ Se procesó el archivo, pero no se pudo leer ningún campo del ${nombre}. `
      + 'Verifique que sea el documento correcto y que esté legible, o ingrese los datos '
      + 'manualmente.',
    aplicar: false,
  };
}
