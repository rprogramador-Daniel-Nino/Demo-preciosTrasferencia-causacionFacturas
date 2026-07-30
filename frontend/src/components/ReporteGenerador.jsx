import React, { useState, useEffect } from 'react';
import { Upload, FileDown, Edit3, Loader2, Sparkles, Check, FileText } from 'lucide-react';
import mammoth from 'mammoth';
import { MASTER_WORD_TEMPLATE } from '../services/masterTemplate';
import { hydrateExactWordTemplate } from '../services/exactTemplateMapper';

export default function ReporteGenerador({ study }) {
  const [htmlContent, setHtmlContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [customTemplateLoaded, setCustomTemplateLoaded] = useState(false);

  // Carga la plantilla original 100% completa de 27 secciones (End Game 2024) y aplica el reemplazo de variables
  const loadExactMasterTemplate = () => {
    const hydrated = hydrateExactWordTemplate(MASTER_WORD_TEMPLATE, study);
    setHtmlContent(hydrated);
  };

  useEffect(() => {
    if (!customTemplateLoaded) {
      loadExactMasterTemplate();
    }
  }, [study, customTemplateLoaded]);

  // Carga de una nueva plantilla Word (.docx) por si el usuario desea usar otro documento modelo
  const handleTemplateUpload = (file) => {
    setLoading(true);
    const reader = new FileReader();
    reader.readAsArrayBuffer(file);
    reader.onload = async (e) => {
      try {
        const arrayBuffer = e.target.result;
        const result = await mammoth.convertToHtml({ arrayBuffer });
        let html = result.value;

        // Aplicar reemplazo de variables sobre la nueva plantilla subida
        const hydrated = hydrateExactWordTemplate(html, study);
        setHtmlContent(hydrated);
        setCustomTemplateLoaded(true);
      } catch (err) {
        console.error("Error parsing custom DOCX template:", err);
        alert("No se pudo analizar la plantilla Word seleccionada.");
      } finally {
        setLoading(false);
      }
    };
  };

  const handleDownload = () => {
    // Estilos compatibles con Word (.doc)
    const exportStyle = `body{font-family:Georgia,serif;max-width:800px;margin:40px auto;padding:0 24px;color:#222;line-height:1.7}h1{font-size:22px;color:#0E1726;border-bottom:2px solid #0FA3A1;padding-bottom:6px}h2{border-bottom:1px solid #E2E8F0;padding-bottom:4px;margin-top:26px;font-size:16px;color:#0E1726}table{width:100%;border-collapse:collapse;margin:16px 0;font-size:13px}th{background:#0E1726;color:#fff;text-align:left;padding:8px 12px}td{padding:8px 12px;border-bottom:1px solid #E2E8F0}`;
    const wordCSS = 'body{counter-reset:secpt}h2::before{content:""}p,li,td{text-align:justify}';
    
    // Limpiamos los estilos de resaltado de pantalla para que el documento final en Word quede impecable
    const cleanHtml = htmlContent
      .replace(/background-color:\s*#F0FDF4;\s*/g, '')
      .replace(/border-bottom:\s*1px\s*dashed\s*#0FA3A1;\s*/g, '')
      .replace(/color:\s*#0B7C7A;\s*/g, '');

    const content = `\ufeff<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"><title>Informe Local Precios de Transferencia</title><style>${exportStyle}${wordCSS}</style></head><body>${cleanHtml}</body></html>`;

    const blob = new Blob([content], { type: 'application/msword' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `Informe_Local_PT_${study.ent || 'Empresa'}_${study.anio || ''}.doc`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-6">
      {/* Barra de Acciones y Control */}
      <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm flex flex-col md:flex-row gap-4 items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-md font-bold text-zinc-950 dark:text-zinc-50">Generador de Informe Final (Fiel 100% al Word Original)</h3>
            <span className="bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">
              27 Secciones Intactas
            </span>
          </div>
          <p className="text-xs text-zinc-500 mt-1">
            Conserva el texto íntegro original del informe (Introducción, FAR, Tendencias, Anexos A-C) e inyecta quirúrgicamente los datos del cliente.
          </p>
        </div>
        <div className="flex gap-3">
          <div className="relative">
            <button className="flex items-center gap-2 bg-[#ffffff] dark:bg-[#262626] text-[#334155] dark:text-zinc-200 border border-zinc-200 dark:border-zinc-700 rounded-lg px-4 py-2 text-xs font-semibold hover:bg-[#f8fafc] dark:hover:bg-zinc-800 transition-colors shadow-sm cursor-pointer">
              {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              Subir Otra Plantilla Word
            </button>
            <input
              type="file"
              accept=".docx"
              disabled={loading}
              onChange={(e) => {
                if (e.target.files[0]) {
                  handleTemplateUpload(e.target.files[0]);
                }
              }}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
          </div>
          <button
            onClick={handleDownload}
            className="flex items-center gap-2 bg-[#0FA3A1] hover:bg-[#0B7C7A] text-white rounded-lg px-4 py-2 text-xs font-semibold transition-colors shadow-sm cursor-pointer"
          >
            <FileDown className="w-3.5 h-3.5" />
            Descargar Word (.doc)
          </button>
        </div>
      </div>

      {/* Contenedor del Editor de HTML Renderizado */}
      <div className="bg-white dark:bg-[#0c0c0f] border border-zinc-200 dark:border-zinc-800 rounded-xl p-8 shadow-sm overflow-x-auto min-h-[600px]">
        {loading ? (
          <div className="flex flex-col items-center justify-center min-h-[400px] text-zinc-500">
            <Loader2 className="w-8 h-8 text-[#0FA3A1] animate-spin mb-2" />
            <span>Cargando plantilla...</span>
          </div>
        ) : (
          <div 
            dangerouslySetInnerHTML={{ __html: htmlContent }} 
            className="prose dark:prose-invert max-w-none focus:outline-none"
            contentEditable
            onBlur={(e) => setHtmlContent(e.currentTarget.innerHTML)}
          />
        )}
      </div>
    </div>
  );
}
