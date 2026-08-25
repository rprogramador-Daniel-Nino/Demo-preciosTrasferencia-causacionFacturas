import React from 'react';
import { X, AlertTriangle } from 'lucide-react';

/* Un color por estado, con la clase completa y literal — Tailwind no reconoce clases
   armadas con interpolación de cadenas (`bg-${x}-100`), así que cada estado tiene la suya
   entera aquí, no un color que se compone en tiempo de ejecución. */
const ESTILO_ESTADO = {
  confirmado_ausente: {
    titulo: 'Confirmado ausente',
    clase: 'bg-rose-100 text-rose-800 dark:bg-rose-950/30 dark:text-rose-300',
  },
  probable_ausente_por_vocabulario: {
    titulo: 'Probablemente ausente',
    clase: 'bg-amber-100 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300',
  },
  implicito_cero: {
    titulo: 'Implícito en cero',
    clase: 'bg-amber-100 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300',
  },
  no_verificado: {
    titulo: 'No se pudo revisar',
    clase: 'bg-zinc-100 text-zinc-700 dark:bg-zinc-900/50 dark:text-zinc-300',
  },
};

/**
 * Popup dedicado para los campos de EEFF que quedaron sin cifra después del fallback a
 * notas (costo de ventas, partes relacionadas, inventarios) — no la caja de advertencias
 * de siempre: el usuario pidió una notificación clara de lo que falta, con una conclusión
 * en lenguaje natural cuando la hay.
 *
 * `advertencias` son las de `verificarEeff()`/`resolverFaltantesConNotas()` cuyo `estado`
 * ya no es el default; `conclusion` es `verificacion.conclusionNotas`, si la pasada
 * angosta corrió.
 */
export default function PopupFaltantesEeff({ advertencias, conclusion, alCerrar }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={alCerrar}
    >
      <div
        className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-zinc-200 dark:border-zinc-800">
          <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-500" />
            Datos que faltan en el documento
          </h3>
          <button onClick={alCerrar} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 p-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3 overflow-y-auto">
          {conclusion && (
            <p className="text-xs text-zinc-700 dark:text-zinc-300 bg-zinc-50 dark:bg-zinc-900/40 rounded-lg p-3 leading-snug">
              {conclusion}
            </p>
          )}
          <ul className="space-y-2">
            {advertencias.map((a, i) => {
              const info = ESTILO_ESTADO[a.estado] || ESTILO_ESTADO.no_verificado;
              return (
                <li key={i} className="text-[11px] leading-snug text-zinc-800 dark:text-zinc-200">
                  <span className={`inline-block text-[9px] font-bold uppercase tracking-wide mr-1.5 px-1.5 py-0.5 rounded ${info.clase}`}>
                    {info.titulo}
                  </span>
                  {a.mensaje}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
