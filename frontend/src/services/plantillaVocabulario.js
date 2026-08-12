/* Vocabulario cerrado de campos sustituibles y su resolución contra el estudio.
   No conoce HTML ni IA: solo qué campos existen y qué valor les corresponde.

   La lista es cerrada a propósito. El modelo elige de aquí y no inventa nombres:
   un campo inventado produciría una marca que nunca se resuelve y dejaría el
   valor del cliente anterior en el documento sin que nada lo delate. */

import { fmt, pctf, num, UVT_VALUES } from '../utils/calculations.js';
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
  /* UTILIDAD y no gastos: `eeffParser.js` lo llena desde `utilidad_operacional` y `pliOf`
     lo consume como utilidad. La etiqueta viaja en el prompt del marcado, así que decir
     «gastos» hacía que el modelo señalara la línea equivocada del estado de resultados. */
  ['t_op', 'Utilidad operacional'],
  ['t_s', 'Ingresos'],
];

export const VOCABULARIO = [
  { campo: 'ent', etiqueta: 'Razón social', grupo: 'Contribuyente' },
  { campo: 'nit', etiqueta: 'NIT', grupo: 'Contribuyente' },
  { campo: 'ciiu', etiqueta: 'Código CIIU', grupo: 'Contribuyente' },
  /* La escribe `DatosContribuyente.jsx` desde la extracción del RUT
     (`updates.direccion`) y el spec la lista en el vocabulario cerrado. Sin
     entrada aquí el domicilio del contribuyente anterior viajaba al informe
     nuevo: la plantilla de referencia lo trae por escrito y no había campo con
     el que marcarlo. La rama genérica de `valorDeCampo` la resuelve sola. */
  { campo: 'direccion', etiqueta: 'Dirección', grupo: 'Contribuyente' },
  { campo: 'objeto', etiqueta: 'Objeto social', grupo: 'Contribuyente' },
  { campo: 'representante', etiqueta: 'Representante legal', grupo: 'Contribuyente' },
  { campo: 'anio', etiqueta: 'Año gravable', grupo: 'Contribuyente' },
  { campo: 'vinc', etiqueta: 'Vinculado económico', grupo: 'Vinculada' },
  { campo: 'vinc_id', etiqueta: 'Identificación del vinculado', grupo: 'Vinculada' },
  { campo: 'vinc_tipo', etiqueta: 'Tipo de operación', grupo: 'Vinculada' },
  { campo: 'pais_vinc', etiqueta: 'País del vinculado', grupo: 'Vinculada' },
  { campo: 'monto_operacion', etiqueta: 'Monto de la operación', grupo: 'Vinculada' },
  { campo: 'vinc_monto', etiqueta: 'Monto de la operación (alias)', grupo: 'Vinculada' },
  { campo: 'vinc_formato', etiqueta: 'Formato DIAN', grupo: 'Vinculada' },
  { campo: 'accionista.nombre', etiqueta: 'Accionista principal', grupo: 'Accionistas' },
  { campo: 'accionista.pais', etiqueta: 'País del accionista', grupo: 'Accionistas' },
  { campo: 'accionista.acciones', etiqueta: 'Acciones', grupo: 'Accionistas' },
  { campo: 'accionista.valor_capital', etiqueta: 'Valor del capital', grupo: 'Accionistas' },
  { campo: 'accionista.participacion', etiqueta: 'Participación del accionista principal', grupo: 'Accionistas' },
  { campo: 'capital_pagado', etiqueta: 'Capital pagado', grupo: 'Accionistas' },
  { campo: 'total_acciones', etiqueta: 'Total de acciones', grupo: 'Accionistas' },
  ...EEFF.map(([c, etiqueta]) => ({ campo: 'eeff.' + c, etiqueta, grupo: 'Estados financieros' })),
  { campo: 'rango.p25', etiqueta: 'Cuartil inferior', grupo: 'Rango' },
  { campo: 'rango.mediana', etiqueta: 'Mediana', grupo: 'Rango' },
  { campo: 'rango.p75', etiqueta: 'Cuartil superior', grupo: 'Rango' },
  { campo: 'rango.cumple', etiqueta: 'Conclusión de cumplimiento', grupo: 'Rango' },
  /* El indicador de la parte examinada. Faltaba, y el informe lo nombra en prosa —«la
     empresa obtuvo una rentabilidad de (X)»— justo debajo de la tabla que lo publica: sin
     campo no había dónde marcarlo, así que esa frase se radicaba con el porcentaje del
     contribuyente anterior. */
  { campo: 'rango.indicador', etiqueta: 'Indicador de la parte examinada', grupo: 'Rango' },
  { campo: 'uvt.valor', etiqueta: 'Valor de la UVT', grupo: 'Topes' },
  { campo: 'uvt.tope45k', etiqueta: 'Tope de 45.000 UVT', grupo: 'Topes' },
  { campo: 'uvt.tope10k', etiqueta: 'Tope de 10.000 UVT', grupo: 'Topes' },
  { campo: 'ia.economia_mundial', etiqueta: 'Análisis de economía mundial (IA)', grupo: 'Narrativa IA' },
  { campo: 'ia.economia_colombia', etiqueta: 'Análisis de economía colombiana (IA)', grupo: 'Narrativa IA' },
  { campo: 'ia.sector_titulo', etiqueta: 'Título del sector (IA)', grupo: 'Narrativa IA' },
  { campo: 'ia.sector_comportamiento', etiqueta: 'Comportamiento del sector (IA)', grupo: 'Narrativa IA' },
  { campo: 'ia.sector_comercio', etiqueta: 'Comercio exterior del sector (IA)', grupo: 'Narrativa IA' },
  { campo: 'ia.sector_proyeccion', etiqueta: 'Proyección del sector (IA)', grupo: 'Narrativa IA' },
  { campo: 'ia.sector_conclusiones', etiqueta: 'Conclusiones del sector (IA)', grupo: 'Narrativa IA' },
];

const CAMPOS = new Set(VOCABULARIO.map((v) => v.campo));

export const esCampoValido = (campo) => CAMPOS.has(campo);

/* El cálculo vive en `rangoIntercuartil.js`. Aquí solo se decide qué se publica:
   si no hay rango, el campo sale nulo y el renderizador pondrá un hueco visible.
   Ojo con la diferencia deliberada respecto a `analizarRango`: aquel devuelve
   'CUMPLE' when no hay comparables —comportamiento heredado que se conserva— y
   esta ruta prefiere el hueco, porque afirmar cumplimiento sin haberlo calculado
   es justo lo que no debe llegar a un documento que se radica ante la DIAN. */

function htmlAParaTexto(html) {
  if (!html) return '';
  return String(html)
    .replace(/<\/p>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/* Devuelve el valor listo para insertar, o null si el estudio no lo trae.
   Nunca devuelve un valor por defecto: un campo sin dato tiene que verse como
   hueco, no heredar la cifra del informe de referencia. */
export function valorDeCampo(estudio, campo, opciones = {}) {
  if (!estudio || !esCampoValido(campo)) return null;
  const { datosMacro, analisisSector } = opciones;

  if (campo === 'monto_operacion' || campo === 'vinc_monto') {
    const bruto = estudio.monto_operacion || estudio.monto;
    if (bruto === undefined || bruto === null || bruto === '') return null;
    const numerico = num(bruto);
    return numerico === null ? null : fmt(numerico);
  }

  if (campo === 'vinc_formato') {
    return 'Formato 1125';
  }

  if (campo === 'capital_pagado' || campo === 'total_acciones') {
    const bruto = estudio[campo];
    if (bruto === undefined || bruto === null || bruto === '') return null;
    const numerico = num(bruto);
    return numerico === null ? null : fmt(numerico);
  }

  if (campo.startsWith('uvt.')) {
    const y = parseInt(estudio.anio, 10);
    if (!UVT_VALUES[y]) return null;
    const tasa = UVT_VALUES[y];
    if (campo === 'uvt.valor') return fmt(tasa);
    return fmt((campo === 'uvt.tope45k' ? 45000 : 10000) * tasa);
  }

  if (campo.startsWith('rango.')) {
    const { stats, statsAjustado, tPLI, cumple } = analizarRango(estudio);
    if (!stats) return null;
    if (campo === 'rango.cumple') return cumple;
    /* El indicador del contribuyente NO se ajusta: se compara contra sí mismo, así que su
       ajuste es cero. Es la misma cifra que la tabla del rango publica en su primera
       columna. */
    if (campo === 'rango.indicador') {
      return tPLI === null || tPLI === undefined ? null : pctf(tPLI);
    }
    /* `statsAjustado` y no `stats`: estos campos rellenan la frase que va DEBAJO de la tabla
       del rango —«se ubica entre el percentil 25 (X) y (Y)…»— y la tabla publica el rango
       ajustado. `stats` es el escenario que sostiene la conclusión, el que elige `useadj`,
       así que con la casilla apagada la frase decía 3,315 % donde la tabla de encima decía
       2,165 %: dos cifras distintas para lo mismo, en la misma página del documento. */
    const base = statsAjustado || stats;
    const v = { 'rango.p25': base.p25, 'rango.mediana': base.med, 'rango.p75': base.p75 }[campo];
    /* `pctf` y no `fmt`: los percentiles son fracciones. `fmt` es el formateador de pesos
       —redondea a entero— y convertía cada percentil en «0» dentro del informe. */
    return v === null || v === undefined ? null : pctf(v);
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
    if (clave === 'participacion' || clave === 'participacion_pct') {
      const val = a.participacion_pct || a.participacion;
      if (val === undefined || val === null || val === '') return null;
      return String(val) + '%';
    }
    const bruto = a[clave];
    if (bruto === undefined || bruto === null || bruto === '') return null;
    if (clave === 'acciones' || clave === 'valor_capital') {
      const numerico = num(bruto);
      return numerico === null ? null : fmt(numerico);
    }
    return String(bruto);
  }

  if (campo.startsWith('ia.')) {
    if (campo === 'ia.economia_mundial') {
      const narrativa = datosMacro && datosMacro.narrativa && datosMacro.narrativa.mundial;
      return narrativa ? htmlAParaTexto(narrativa) : null;
    }
    if (campo === 'ia.economia_colombia') {
      const narrativa = datosMacro && datosMacro.narrativa && datosMacro.narrativa.colombia;
      return narrativa ? htmlAParaTexto(narrativa) : null;
    }

    const entrada = analisisSector && analisisSector.porAnio && analisisSector.porAnio[String(estudio.anio)];
    if (!entrada) return null;

    if (campo === 'ia.sector_titulo') {
      return entrada.tituloSector ? String(entrada.tituloSector) : null;
    }
    if (campo === 'ia.sector_comportamiento') {
      const narrativa = entrada.narrativa && entrada.narrativa.comportamiento;
      return narrativa ? htmlAParaTexto(narrativa) : null;
    }
    if (campo === 'ia.sector_comercio') {
      const narrativa = entrada.narrativa && entrada.narrativa.comercioExterior;
      return narrativa ? htmlAParaTexto(narrativa) : null;
    }
    if (campo === 'ia.sector_proyeccion') {
      const narrativa = entrada.narrativa && entrada.narrativa.proyeccion;
      return narrativa ? htmlAParaTexto(narrativa) : null;
    }
    if (campo === 'ia.sector_conclusiones') {
      const narrativa = entrada.narrativa && entrada.narrativa.conclusiones;
      return narrativa ? htmlAParaTexto(narrativa) : null;
    }
    return null;
  }

  const bruto = estudio[campo];
  return bruto === undefined || bruto === null || bruto === '' ? null : String(bruto);
}
