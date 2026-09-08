import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkBreaks from 'remark-breaks';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

/* Gemini responde en Markdown con frecuencia —negritas, listas, fórmulas en LaTeX
   para explicar un cálculo de precios de transferencia— y antes de esto se mostraba
   tal cual, con los asteriscos y los `$...$` a la vista. `react-markdown` no admite
   HTML crudo salvo que se le agregue `rehype-raw` —que aquí NO se agrega—, así que
   una respuesta del modelo no puede colar una etiqueta: solo se interpreta la
   sintaxis Markdown/LaTeX, nunca `<script>` ni similares. Los enlaces con esquemas
   peligrosos (`javascript:`) también los filtra la librería por defecto.

   Las clases de cada elemento se ponen aquí, a mano, en vez de traer el plugin de
   tipografía de Tailwind solo para esta ventana: el chat es angosto y los tamaños de
   un `prose` genérico (encabezados grandes, mucho margen) no caben en una burbuja. */
const COMPONENTES = {
  p: ({ children }) => <p className="mb-1.5 last:mb-0 leading-snug">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => <ul className="list-disc pl-4 my-1 space-y-0.5">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal pl-4 my-1 space-y-0.5">{children}</ol>,
  li: ({ children }) => <li className="leading-snug">{children}</li>,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline break-all">
      {children}
    </a>
  ),
  /* react-markdown ya no manda una prop `inline`: la distinción es si `className`
     trae `language-xxx` (bloque con cerca ```) o no (código en línea). */
  code: ({ className, children }) => (
    /language-/.test(className || '')
      ? <code className="font-mono text-[0.85em]">{children}</code>
      : <code className="bg-black/10 dark:bg-white/10 rounded px-1 py-0.5 text-[0.85em] font-mono">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="bg-black/10 dark:bg-white/10 rounded-lg p-2 my-1 overflow-x-auto text-xs">{children}</pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-current/30 pl-2 my-1 italic opacity-90">{children}</blockquote>
  ),
  h1: ({ children }) => <p className="font-semibold mb-1">{children}</p>,
  h2: ({ children }) => <p className="font-semibold mb-1">{children}</p>,
  h3: ({ children }) => <p className="font-semibold mb-1">{children}</p>,
  table: ({ children }) => (
    <div className="overflow-x-auto my-1">
      <table className="text-xs border-collapse">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border border-current/20 px-1.5 py-0.5 text-left">{children}</th>,
  td: ({ children }) => <td className="border border-current/20 px-1.5 py-0.5">{children}</td>,
};

/* Una fórmula en bloque (`$$...$$`) mide fácil el doble de alto que una línea de
   texto normal —numerador, raya y denominador—, y pegada al texto de arriba y de
   abajo con el mismo margen de un párrafo (`mb-1.5`) se veía amontonada, casi
   encima de la línea "Fórmula:". Se le da su propio respiro (más margen, relleno,
   una caja tenue) igual que ya tienen los bloques de código (`pre`) — es el mismo
   criterio, aplicado a la otra clase de contenido que necesita su propia línea. */
const ESPACIADO_FORMULAS = '[&_.katex-display]:overflow-x-auto [&_.katex-display]:overflow-y-hidden '
  + '[&_.katex-display]:my-2.5 [&_.katex-display]:py-2 [&_.katex-display]:px-2.5 '
  + '[&_.katex-display]:bg-black/5 [&_.katex-display]:dark:bg-white/5 [&_.katex-display]:rounded-lg '
  + '[&_.katex]:text-[1.05em]';

/** Texto de un mensaje del chat, con Markdown y fórmulas LaTeX (`$...$`/`$$...$$`)
 *  ya renderizadas. Las fórmulas en bloque llevan su propio scroll horizontal para
 *  no romper el ancho de la ventana de chat. */
export default function MensajeMarkdown({ texto }) {
  return (
    <div className={ESPACIADO_FORMULAS}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, remarkBreaks]}
        rehypePlugins={[rehypeKatex]}
        components={COMPONENTES}
      >
        {texto}
      </ReactMarkdown>
    </div>
  );
}
