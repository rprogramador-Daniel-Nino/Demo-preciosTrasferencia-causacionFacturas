import React, { useState } from 'react';
import { X, AlertTriangle, Check } from 'lucide-react';
import { fmt } from '../utils/calculations';

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
  revisar_total_mayor: {
    titulo: 'Verifique con el cliente',
    clase: 'bg-amber-100 text-amber-800 dark:bg-amber-950/30 dark:text-amber-300',
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
 * angosta corrió. `onElegirCandidata(campo, candidata)` es opcional: cuando viene, cada
 * candidata ambigua de `a.candidatas` se muestra como un botón para elegirla ahí mismo —
 * sin esto, la única forma de resolver la ambigüedad era escribir a mano el número exacto
 * en la casilla del formulario, sin ninguna pista de que hacerlo confirma cuál es.
 */
export default function PopupFaltantesEeff({ advertencias, conclusion, alCerrar, onElegirCandidata }) {
  /* Solo para el check visual del botón ya elegido: la decisión real (escribir el valor,
     aprender el rótulo) la toma `onElegirCandidata` en el componente padre; este estado no
     se sincroniza con el estudio, así que no hay nada que perder si el popup se cierra. */
  const [elegidas, setElegidas] = useState({});

  const elegir = (campo, candidata) => {
    setElegidas((prev) => ({ ...prev, [campo]: candidata }));
    onElegirCandidata?.(campo, candidata);
  };

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
              const elegida = a.campo ? elegidas[a.campo] : null;
              return (
                <li key={i} className="text-[11px] leading-snug text-zinc-800 dark:text-zinc-200">
                  <span className={`inline-block text-[9px] font-bold uppercase tracking-wide mr-1.5 px-1.5 py-0.5 rounded ${info.clase}`}>
                    {info.titulo}
                  </span>
                  {a.mensaje}
                  {onElegirCandidata && Array.isArray(a.candidatas) && a.candidatas.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {a.candidatas.map((c, j) => {
                        const yaElegida = elegida === c;
                        return (
                          <button
                            key={j}
                            type="button"
                            disabled={Boolean(elegida)}
                            onClick={() => elegir(a.campo, c)}
                            className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border flex items-center gap-1 transition-colors ${
                              yaElegida
                                ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300'
                                : 'border-zinc-300 text-zinc-700 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 disabled:opacity-50'
                            }`}
                          >
                            {yaElegida && <Check className="w-3 h-3" />}
                            Usar «{c.rotulo}» ({fmt(c.valor)})
                          </button>
                        );
                      })}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
