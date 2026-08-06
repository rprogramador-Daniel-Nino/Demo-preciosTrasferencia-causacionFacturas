/* ─────────────────────────────────────────────────────────────────────────────
   perfilFuncionalPatch.js — Perfil funcional BILINGÜE (ES/EN) y AGNÓSTICO al sector.

   PROBLEMA que corrige: el `perfilDe` original clasificaba el perfil funcional con
   palabras clave SOLO en inglés y propias del nicho de software/juegos
   («publish», «free-to-play», «SaaS», «games»…). Para un sistema que procesa
   estudios de muchos sectores y en dos idiomas, eso es un sesgo: falla con una
   constructora, una comercializadora o una manufacturera, y falla si la
   descripción del negocio está en español.

   ENFOQUE AGNÓSTICO: el perfil funcional en precios de transferencia no depende del
   sector, sino de las FUNCIONES y RIESGOS que asume la empresa (Art. 260-4 E.T.):

     · SERVICIO (rutinario): presta servicios o fabrica/distribuye POR CUENTA de un
       tercero, sin IP significativa ni riesgo de mercado propio. Es comparable a
       una filial cautiva de servicios. Señales universales: «por cuenta de»,
       «para terceros», «maquila», «contract manufacturing», «outsourcing»,
       «toll», «OEM», «subcontrat», «presta servicios», «service provider»…

     · EMPRESARIO (pleno): tiene marca/producto/IP propios y asume el riesgo de
       mercado. NO es comparable a una filial rutinaria. Señales universales:
       «marca propia», «productos propios», «propiedad intelectual», «franquicia»,
       «own brand», «proprietary», «develops and markets its own», «franchise»,
       «licenses its»…

   Estas señales son funcionales, no sectoriales: aplican igual a software,
   alimentos, textil, construcción o autopartes. Se listan en ES y EN. Las listas
   son AMPLIABLES por configuración, sin tocar el código.

   INTEGRACIÓN: reemplazar en comparablesEngine.js la llamada
       const perfil = perfilIA || cand.perfilFuncional || perfilDe(cand.desc);
   por
       const perfil = perfilIA || cand.perfilFuncional || perfilFuncionalBilingue(cand.desc);
   La semántica (SERVICIO/EMPRESARIO/MIXTO/INDEFINIDO) es idéntica, así que el resto
   del motor (rigor funcional, puntaje) no cambia.
   ───────────────────────────────────────────────────────────────────────────── */

/* Señales de PERFIL DE SERVICIO / RUTINARIO (ES + EN), agnósticas al sector.
   Indican que la empresa opera POR CUENTA de un tercero o presta servicios,
   sin asumir riesgo de mercado ni IP propia. */
const SERVICIO_ES = [
  'presta servicios', 'prestación de servicios', 'prestacion de servicios',
  'servicios de outsourcing', 'por cuenta de', 'por cuenta ajena', 'para terceros',
  'a terceros', 'maquila', 'maquilador', 'fabricación por encargo', 'fabricacion por encargo',
  'fabricante por contrato', 'manufactura por contrato', 'producción por encargo',
  'subcontrat', 'tercerización', 'tercerizacion', 'tercerizad', 'terceriza', 'outsourcing', 'bajo pedido',
  'a la medida', 'por encargo', 'servicios de consultoría', 'servicios de consultoria',
  'servicios logísticos', 'servicios logisticos', 'servicios de distribución', 'servicios de distribucion',
  'servicios de transporte', 'ofrece servicios', 'brinda servicios', 'presta servicios de',
  'operador logístico', 'operador logistico',
];
const SERVICIO_EN = [
  'provides services', 'service provider', 'services to', 'development services',
  'it services', 'information technology services', 'consulting services', 'professional services',
  'technical services', 'outsourc', 'offshore', 'nearshore', 'contract manufactur',
  'contract develop', 'contract research', 'for hire', 'work for hire', 'on behalf of',
  'third party', 'third-party', 'subcontract', 'toll manufactur', 'toll process', 'oem',
  'original equipment manufacturer', 'white label', 'white-label', 'private label manufactur',
  'custom development', 'custom software', 'bespoke', 'support services', 'processing services',
  'managed services', 'on a contract basis', 'systems integration',
];

/* Señales de PERFIL EMPRESARIO / PLENO (ES + EN), agnósticas al sector.
   Indican marca/producto/IP propios y riesgo de mercado propio. */
const EMPRESARIO_ES = [
  'marca propia', 'marcas propias', 'productos propios', 'propiedad intelectual',
  'patentes propias', 'bajo su marca', 'bajo la marca', 'marca registrada',
  'franquicia', 'franquiciador', 'licencia sus', 'desarrolla y comercializa',
  'fabrica y comercializa', 'diseña y comercializa', 'disena y comercializa',
  'comercializa sus propios', 'investigación y desarrollo', 'investigacion y desarrollo',
  'i+d', 'cartera de marcas', 'integración vertical', 'integracion vertical',
  'propietaria de', 'de su propiedad',
];
const EMPRESARIO_EN = [
  'its own brand', 'own brands', 'proprietary', 'its own products', 'own products',
  'develops and markets', 'manufactures and markets', 'designs and markets',
  'markets its own', 'under its brand', 'under its own brand', 'own intellectual property',
  'owns the', 'franchise', 'franchisor', 'licenses its', 'publisher of', 'publishes its own',
  'in-house', 'brand owner', 'flagship', 'research and development', 'own portfolio',
  'trademark', 'vertically integrated', 'develops, manufactures', 'designs, manufactures',
];

/** Compila una lista de frases a una expresión regular insensible a mayúsculas. */
function compilar(lista) {
  const esc = lista.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(esc.join('|'), 'i');
}

/**
 * Perfil funcional bilingüe y agnóstico.
 * @param {string} descripcion  Business Description (ES o EN).
 * @param {{servicioExtra?:string[], empresarioExtra?:string[]}} [config]
 *        frases adicionales por sector/idioma, sin tocar el código.
 * @returns {'SERVICIO'|'EMPRESARIO'|'MIXTO'|'INDEFINIDO'}
 */
export function perfilFuncionalBilingue(descripcion, config = {}) {
  const d = String(descripcion || '');
  if (!d.trim()) return 'INDEFINIDO';

  const servicio = compilar([...SERVICIO_ES, ...SERVICIO_EN, ...(config.servicioExtra || [])]);
  const empresario = compilar([...EMPRESARIO_ES, ...EMPRESARIO_EN, ...(config.empresarioExtra || [])]);

  const esServicio = servicio.test(d);
  const esEmpresario = empresario.test(d);
  if (esServicio && !esEmpresario) return 'SERVICIO';
  if (esServicio && esEmpresario) return 'MIXTO';
  if (esEmpresario) return 'EMPRESARIO';
  return 'INDEFINIDO';
}

/** Perfiles que afirman algo sobre las funciones (INDEFINIDO nunca descarta). */
export const PERFILES_DETERMINADOS = new Set(['SERVICIO', 'EMPRESARIO', 'MIXTO']);

/** Listas expuestas por si se quieren inspeccionar o extender. */
export const CLAVES_PERFIL_BILINGUE = {
  servicio: { es: SERVICIO_ES, en: SERVICIO_EN },
  empresario: { es: EMPRESARIO_ES, en: EMPRESARIO_EN },
};
