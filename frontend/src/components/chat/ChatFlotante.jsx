import React, { Suspense, useState } from 'react';
import { MessageCircle, X } from 'lucide-react';

/* La ventana pesada (historial, armado del prompt, llamada a Gemini) se carga solo
   cuando alguien abre la burbuja: es el primer `React.lazy` del repo, así que el
   bundle principal no paga por un chat que puede no llegar a abrirse nunca. */
const ChatVentana = React.lazy(() => import('./ChatVentana.jsx'));

/* Mismo tamaño que el contenedor real de `ChatVentana.jsx` —repetido y no
   compartido en un módulo aparte, porque un módulo compartido con esa única
   constante seguiría arrastrando `ChatVentana.jsx` a la importación estática de
   este archivo y anularía el `React.lazy` de arriba—: sin esto, el `fallback`
   cambiaba de tamaño en cuanto terminaba de cargar la ventana real. Es
   responsivo a propósito: llena el ancho/alto disponible hasta un máximo que
   crece con el viewport, así en un celular no se sale de la pantalla y en un
   monitor grande aprovecha más espacio que un tamaño fijo. */
const TAMANO_VENTANA = 'w-[calc(100vw-2rem)] max-w-[26rem] sm:max-w-[30rem] lg:max-w-[34rem] '
  + 'h-[calc(100vh-8rem)] max-h-[30rem] sm:max-h-[36rem] lg:max-h-[42rem]';

export default function ChatFlotante({ study, estudioId, usuario }) {
  const [abierto, setAbierto] = useState(false);

  /* Sin estudio abierto no hay de qué hablar con el asistente —no tiene sentido
     mandar un `<datos_estudio>` vacío—, así que la burbuja ni aparece. */
  if (!usuario || !estudioId) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col items-end gap-3">
      {abierto && (
        <Suspense fallback={
          <div className={`${TAMANO_VENTANA} rounded-xl bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 shadow-xl flex items-center justify-center text-xs text-zinc-500`}>
            Cargando asistente…
          </div>
        }>
          <ChatVentana
            study={study}
            estudioId={estudioId}
            usuario={usuario}
            onCerrar={() => setAbierto(false)}
          />
        </Suspense>
      )}
      <button
        type="button"
        onClick={() => setAbierto(v => !v)}
        className="w-14 h-14 rounded-full bg-[#0FA3A1] text-white shadow-lg flex items-center justify-center hover:brightness-110 transition"
        title="Asistente del estudio"
      >
        {abierto ? <X className="w-6 h-6" /> : <MessageCircle className="w-6 h-6" />}
      </button>
    </div>
  );
}
