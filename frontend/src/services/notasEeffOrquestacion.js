/* ─────────────────────────────────────────────────────────────────────────────
   Orquesta las tres ramas del fallback a notas cuando `verificarEeff()` deja costo de
   ventas, partes relacionadas o inventarios en null (ver
   docs/superpowers/specs/2026-08-25-fallback-notas-utilidad-operacional-design.md):

     1. Si el diccionario de ese campo ya es maduro y ninguna de sus palabras aparece en
        el texto del documento, se marca `probable_ausente_por_vocabulario` SIN llamar a
        Gemini.
     2. Si no, y el documento trae más de `UMBRAL_PAGINAS_CON_NOTAS` páginas, se ejecuta
        la pasada angosta y se re-verifica con lo que encuentre.
     3. Si no se cumple ninguna de las dos, el campo queda como estaba (`no_verificado`).

   Todo el I/O (Firestore, la llamada a Gemini, abrir el PDF para contar páginas) se
   inyecta con un valor por defecto — mismo patrón que ya usa `extraerTextoPdf(file,
   { getDocument })` —, así que este módulo se prueba sin red ni base de datos real. */

import {
  verificarEeff, fusionarHallazgosEnLectura, marcarEstadosConHallazgos,
  marcarProbableAusentePorVocabulario,
} from './eeffVerificacion.js';
import { CAMPOS_CON_FALLBACK_NOTAS, CAMPO_POR_RUBRO, buscarFaltantesEnNotas } from './eeffParser.js';
import { contarPaginasPdf } from './eeffTextoPdf.js';
import { diccionarioVacio, esMaduro, contienePalabraConocida, agregarPalabras } from './vocabularioEeff.js';

/* Heurística: portada + los 4 estados principales ≈ 5-6 páginas en los casos vistos. No
   pretende ser exacta, solo evitar la llamada cuando es obvio que no hay notas (el
   escaneo de 5 páginas de LATV, por ejemplo). */
const UMBRAL_PAGINAS_CON_NOTAS = 6;

const RUBRO_POR_CAMPO = Object.fromEntries(
  Object.entries(CAMPO_POR_RUBRO).map(([rubro, campo]) => [campo, rubro]),
);

/** Los campos con fallback que la verificación dejó en `null`, sin contar los que ya
 *  quedaron `implicito_cero` — ese caso se sugiere en pantalla, no se busca en notas. */
function camposFaltantes(verificacion) {
  return Object.keys(CAMPOS_CON_FALLBACK_NOTAS).filter((campo) => {
    if (verificacion.campos[campo] !== null) return false;
    return !verificacion.advertencias.some((a) => a.campo === campo && a.estado === 'implicito_cero');
  });
}

export async function resolverFaltantesConNotas({
  file, lectura, verificacion, anioEstudio,
  leerVocabulario, guardarVocabulario,
  buscar = buscarFaltantesEnNotas,
  contarPaginas = contarPaginasPdf,
}) {
  const faltantes = camposFaltantes(verificacion);
  if (faltantes.length === 0) return verificacion;

  const diccionarios = {};
  await Promise.all(faltantes.map(async (campo) => {
    try {
      diccionarios[campo] = await leerVocabulario(campo);
    } catch (err) {
      console.warn(`[notasEeffOrquestacion] no se pudo leer el diccionario de ${campo}`, err);
      diccionarios[campo] = diccionarioVacio();
    }
  }));

  /* La rama del diccionario exige capa de texto confiable: sin ella, "no encontramos la
     palabra" no significa nada — no hay texto donde buscarla, no es que se buscó y no
     estaba. Un escaneo sin texto (el de 5 páginas de LATV, por ejemplo) nunca puede
     resolverse por esta vía, así que cae directo a la rama de páginas/pasada angosta. */
  const hayTextoConfiable = Boolean(lectura.textoPdf && String(lectura.textoPdf).trim());
  const porVocabulario = hayTextoConfiable
    ? faltantes.filter((campo) => (
      esMaduro(diccionarios[campo]) && !contienePalabraConocida(lectura.textoPdf, diccionarios[campo])
    ))
    : [];
  const pendientes = faltantes.filter((campo) => !porVocabulario.includes(campo));

  let resultado = {
    ...verificacion,
    advertencias: marcarProbableAusentePorVocabulario(verificacion.advertencias, porVocabulario),
  };

  if (pendientes.length === 0) return resultado;

  const numPaginas = await contarPaginas(file);
  if (numPaginas <= UMBRAL_PAGINAS_CON_NOTAS) return resultado;

  const { hallazgos, conclusion } = await buscar(file, pendientes);
  const lecturaFusionada = fusionarHallazgosEnLectura(lectura, hallazgos);
  const reverificada = verificarEeff(lecturaFusionada, { anioEstudio });

  resultado = {
    ...reverificada,
    advertencias: marcarEstadosConHallazgos(
      marcarProbableAusentePorVocabulario(reverificada.advertencias, porVocabulario),
      hallazgos,
    ),
    conclusionNotas: conclusion,
  };

  await Promise.all(pendientes.map(async (campo) => {
    const hallazgo = hallazgos[campo];
    if (!hallazgo || !hallazgo.palabra) return;
    try {
      const actualizado = agregarPalabras(diccionarios[campo], [hallazgo.palabra]);
      await guardarVocabulario(campo, actualizado);
    } catch (err) {
      console.warn(`[notasEeffOrquestacion] no se pudo guardar el diccionario de ${campo}`, err);
    }
  }));

  return resultado;
}

/**
 * Alimenta el diccionario con los éxitos de la pasada 1, no solo con los fallos de la
 * pasada angosta: si un campo con fallback SÍ se encontró, el rótulo que le atribuyó
 * `parseEeffWithGeminiOCR` (`rotulos`, indexado por RUBRO — ver `CAMPO_POR_RUBRO`) es la
 * palabra con la que este documento lo llamó. La mayoría de estudios nunca necesitan el
 * fallback, y aun así alimentan el diccionario.
 */
export async function aprenderDeLecturaExitosa({ campos, rotulos, leerVocabulario, guardarVocabulario }) {
  const objetivo = Object.keys(CAMPOS_CON_FALLBACK_NOTAS);
  await Promise.all(objetivo.map(async (campo) => {
    if (campos[campo] === null || campos[campo] === undefined) return;
    const rubro = RUBRO_POR_CAMPO[campo];
    const palabra = rubro ? (rotulos || {})[rubro] : '';
    if (!palabra) return;
    try {
      const diccionario = await leerVocabulario(campo);
      const actualizado = agregarPalabras(diccionario, [palabra]);
      await guardarVocabulario(campo, actualizado);
    } catch (err) {
      console.warn(`[notasEeffOrquestacion] no se pudo aprender del éxito de ${campo}`, err);
    }
  }));
}
