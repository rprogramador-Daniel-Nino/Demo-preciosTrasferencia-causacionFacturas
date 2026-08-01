/* Vocabulario cerrado de campos sustituibles y su resolución contra el estudio.
   No conoce HTML ni IA: solo qué campos existen y qué valor les corresponde.

   La lista es cerrada a propósito. El modelo elige de aquí y no inventa nombres:
   un campo inventado produciría una marca que nunca se resuelve y dejaría el
   valor del cliente anterior en el documento sin que nada lo delate. */

import { fmt, num, UVT_VALUES } from '../utils/calculations.js';
import { analizarRango } from './rangoIntercuartil.js';

const EEFF = [
  ['t_cash', 'Efectivo'],
  ['t_ar', 'Cuentas por cobrar'],
  ['t_inv', 'Inventarios'],
  ['t_tax', 'Impuestos'],
  ['t_ppe', 'Propiedad, planta y equipo'],
  ['t_act_curr', 'Total activo corriente'],
  ['t_act_nocurr', 'Total activos no corrientes'],
  ['t_act_tot', 'Total activos'],
  ['t_inv_assoc', 'Inversiones asociadas'],
  ['t_intang', 'Intangibles'],
  ['t_dif', 'Diferidos'],
  ['t_ap', 'Cuentas por pagar'],
  ['t_c', 'Costos'],
  ['t_op', 'Gastos operacionales'],
  ['t_s', 'Ingresos'],
];

export const VOCABULARIO = [
  { campo: 'ent', etiqueta: 'Razón social', grupo: 'Contribuyente' },
  { campo: 'nit', etiqueta: 'NIT', grupo: 'Contribuyente' },
  { campo: 'ciiu', etiqueta: 'Código CIIU', grupo: 'Contribuyente' },
  { campo: 'objeto', etiqueta: 'Objeto social', grupo: 'Contribuyente' },
  { campo: 'representante', etiqueta: 'Representante legal', grupo: 'Contribuyente' },
  { campo: 'anio', etiqueta: 'Año gravable', grupo: 'Contribuyente' },
  { campo: 'vinc', etiqueta: 'Vinculado económico', grupo: 'Vinculada' },
  { campo: 'vinc_id', etiqueta: 'Identificación del vinculado', grupo: 'Vinculada' },
  { campo: 'vinc_tipo', etiqueta: 'Tipo de operación', grupo: 'Vinculada' },
  { campo: 'pais_vinc', etiqueta: 'País del vinculado', grupo: 'Vinculada' },
  { campo: 'accionista.nombre', etiqueta: 'Accionista principal', grupo: 'Accionistas' },
  { campo: 'accionista.pais', etiqueta: 'País del accionista', grupo: 'Accionistas' },
  { campo: 'accionista.acciones', etiqueta: 'Acciones', grupo: 'Accionistas' },
  { campo: 'accionista.valor_capital', etiqueta: 'Valor del capital', grupo: 'Accionistas' },
  ...EEFF.map(([c, etiqueta]) => ({ campo: 'eeff.' + c, etiqueta, grupo: 'Estados financieros' })),
  { campo: 'rango.p25', etiqueta: 'Cuartil inferior', grupo: 'Rango' },
  { campo: 'rango.mediana', etiqueta: 'Mediana', grupo: 'Rango' },
  { campo: 'rango.p75', etiqueta: 'Cuartil superior', grupo: 'Rango' },
  { campo: 'rango.cumple', etiqueta: 'Conclusión de cumplimiento', grupo: 'Rango' },
  { campo: 'uvt.tope45k', etiqueta: 'Tope de 45.000 UVT', grupo: 'Topes' },
  { campo: 'uvt.tope10k', etiqueta: 'Tope de 10.000 UVT', grupo: 'Topes' },
];

const CAMPOS = new Set(VOCABULARIO.map((v) => v.campo));

export const esCampoValido = (campo) => CAMPOS.has(campo);

/* El cálculo vive en `rangoIntercuartil.js` (Task 0), compartido con
   `exactTemplateMapper.js`. Aquí solo se decide qué se publica: si no hay
   rango, el campo sale nulo y el renderizador pondrá un hueco visible. Ojo con
   la diferencia deliberada respecto al mapper: aquel devuelve 'CUMPLE' cuando
   no hay comparables —comportamiento heredado que la Task 0 conserva— y esta
   ruta prefiere el hueco, porque afirmar cumplimiento sin haberlo calculado es
   justo lo que no debe llegar a un documento que se radica ante la DIAN. */

/* Devuelve el valor listo para insertar, o null si el estudio no lo trae.
   Nunca devuelve un valor por defecto: un campo sin dato tiene que verse como
   hueco, no heredar la cifra del informe de referencia. */
export function valorDeCampo(estudio, campo) {
  if (!estudio || !esCampoValido(campo)) return null;

  if (campo.startsWith('uvt.')) {
    const y = parseInt(estudio.anio, 10);
    if (!UVT_VALUES[y]) return null;
    const tasa = UVT_VALUES[y];
    return fmt((campo === 'uvt.tope45k' ? 45000 : 10000) * tasa);
  }

  if (campo.startsWith('rango.')) {
    const { stats, cumple } = analizarRango(estudio);
    if (!stats) return null;
    if (campo === 'rango.cumple') return cumple;
    const v = { 'rango.p25': stats.p25, 'rango.mediana': stats.med, 'rango.p75': stats.p75 }[campo];
    return v === null || v === undefined ? null : fmt(v);
  }

  if (campo.startsWith('eeff.')) {
    const bruto = estudio[campo.slice(5)];
    if (bruto === undefined || bruto === null || bruto === '') return null;
    const numerico = num(bruto);
    return numerico === null ? null : fmt(numerico);
  }

  if (campo.startsWith('accionista.')) {
    const a = (estudio.accionistas || [])[0];
    if (!a) return null;
    const clave = campo.slice(11);
    const bruto = a[clave];
    if (bruto === undefined || bruto === null || bruto === '') return null;
    if (clave === 'acciones' || clave === 'valor_capital') {
      const numerico = num(bruto);
      return numerico === null ? null : fmt(numerico);
    }
    return String(bruto);
  }

  const bruto = estudio[campo];
  return bruto === undefined || bruto === null || bruto === '' ? null : String(bruto);
}
