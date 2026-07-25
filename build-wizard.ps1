
# ============================================================
# build-wizard.ps1
# Genera index-wizard.html desde index.html (sin modificarlo)
# ============================================================
param([string]$Input = "index.html", [string]$Output = "index-wizard.html")

$original = Get-Content $Input -Raw -Encoding UTF8
Write-Host "[1/5] Leido original: $($original.Length) chars"

# ────────────────────────────────────────────────────────────
# 1. CSS WIZARD
# ────────────────────────────────────────────────────────────
$wizardCSS = @'
    /* ============================================================
       WIZARD LAYER
       ============================================================ */
    .sr-only { position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border-width:0 }
    .wz-layout { display:flex;min-height:calc(100vh - 112px) }
    .wz-sidebar { width:256px;flex-shrink:0;background:var(--ink);border-right:1px solid rgba(255,255,255,.08);position:sticky;top:112px;height:calc(100vh - 112px);overflow-y:auto;padding:20px 0;z-index:20 }
    .wz-sidebar-title { font-family:'IBM Plex Mono',monospace;font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.35);padding:0 18px 12px }
    .wz-nav { list-style:none;padding:0;margin:0 }
    .wz-nav-item { display:flex;align-items:flex-start;gap:11px;padding:10px 16px;cursor:pointer;border:none;background:none;width:100%;text-align:left;color:rgba(234,240,244,.5);font-size:12px;font-family:inherit;border-left:3px solid transparent;transition:all .18s ease;line-height:1.4 }
    .wz-nav-item:hover { background:rgba(255,255,255,.06);color:#EAF0F4 }
    .wz-nav-item.active { background:rgba(15,163,161,.12);border-left-color:var(--teal);color:#EAF0F4;font-weight:600 }
    .wz-nav-item.done { color:rgba(46,139,107,.8) }
    .wz-nav-num { width:22px;height:22px;border-radius:50%;background:rgba(255,255,255,.1);color:#EAF0F4;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-family:'IBM Plex Mono',monospace;transition:background .18s ease;margin-top:1px }
    .wz-nav-item.active .wz-nav-num { background:var(--teal);color:#04211f }
    .wz-nav-item.done .wz-nav-num { background:var(--green);color:#fff }
    .wz-sidebar-progress { margin:16px 16px 0;padding-top:14px;border-top:1px solid rgba(255,255,255,.08) }
    .wz-prog-label { font-family:'IBM Plex Mono',monospace;font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:rgba(255,255,255,.35);margin-bottom:6px }
    .wz-prog-bar { height:4px;background:rgba(255,255,255,.1);border-radius:4px;overflow:hidden }
    .wz-prog-fill { height:100%;background:linear-gradient(90deg,var(--teal),#37c0be);border-radius:4px;transition:width .4s ease }
    .wz-prog-pct { font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--teal);margin-top:5px }
    .wz-main { flex:1;min-width:0;padding:20px 20px 40px }
    .wz-panel { display:none }
    .wz-panel.active { display:block }
    .wz-step-header { display:flex;align-items:flex-start;gap:14px;margin-bottom:20px;padding:18px 20px;background:linear-gradient(135deg,#0b1520 0%,#131b2e 100%);border-radius:14px;border:1px solid rgba(255,255,255,.07) }
    .wz-step-badge { width:44px;height:44px;border-radius:50%;background:var(--teal);color:#04211f;font-size:20px;display:flex;align-items:center;justify-content:center;flex-shrink:0 }
    .wz-step-info h2 { font-size:15px;color:#EAF0F4;margin:0 }
    .wz-step-info p { font-size:11.5px;color:rgba(234,240,244,.5);margin:4px 0 0 }
    .wz-footer { display:flex;justify-content:space-between;align-items:center;margin-top:24px;padding-top:16px;border-top:1px solid var(--hair) }
    .wz-btn-nav { padding:10px 20px;border-radius:10px;font-size:13px;font-weight:600;font-family:inherit;cursor:pointer;display:inline-flex;align-items:center;gap:8px;transition:all .18s ease;border:none }
    .wz-btn-prev { background:var(--paper);color:var(--text);border:1px solid var(--hair) }
    .wz-btn-prev:hover:not(:disabled) { background:#E3E8EC }
    .wz-btn-next { background:var(--teal);color:#04211f }
    .wz-btn-next:hover:not(:disabled) { background:var(--teal-d);color:#fff }
    .wz-btn-next:disabled,.wz-btn-prev:disabled { opacity:.35;cursor:not-allowed }
    .wz-btn-finish { background:var(--green);color:#fff }
    .wz-btn-finish:hover { background:#1F6D4F }
    .wz-step-indicator { display:flex;align-items:center;gap:6px;font-family:'IBM Plex Mono',monospace;font-size:10px;color:rgba(255,255,255,.45);margin-left:auto;padding-left:16px }
    .wz-step-indicator b { color:var(--teal);font-size:11px }
    .wz-dropzone { border:2px dashed var(--hair);border-radius:12px;padding:22px 18px;text-align:center;background:#FAFBFC;cursor:pointer;transition:border-color .2s,background .2s;display:flex;flex-direction:column;align-items:center;gap:8px;position:relative }
    .wz-dropzone:hover,.wz-dropzone.dragover { border-color:var(--teal);background:rgba(15,163,161,.04) }
    .wz-dropzone.success { border-color:var(--green);background:rgba(46,139,107,.04) }
    .wz-dropzone-icon { font-size:30px;line-height:1 }
    .wz-dropzone-title { font-size:13px;font-weight:600;color:var(--ink) }
    .wz-dropzone-sub { font-size:11px;color:var(--muted) }
    .wz-dropzone input[type=file] { position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;height:100% }
    .wz-dropzone-status { font-size:11px;font-weight:600;margin-top:4px }
    .wz-dropzone.success .wz-dropzone-status { color:var(--green) }
    .wz-toast { display:none;align-items:center;gap:10px;padding:10px 14px;border-radius:10px;font-size:12.5px;margin:10px 0;animation:wz-slidein .25s ease }
    @keyframes wz-slidein { from{opacity:0;transform:translateY(-6px)} to{opacity:1;transform:translateY(0)} }
    .wz-toast.show { display:flex }
    .wz-toast.green { background:#EFF7F2;border:1px solid #B7DDC8;color:#1a5c40 }
    .wz-toast.amber { background:#FCF6EC;border:1px solid #EBD9B4;color:#6b5010 }
    .wz-toast.red   { background:#FDECEA;border:1px solid #E7A79E;color:#7a241c }
    @media(max-width:860px){
      .wz-layout{flex-direction:column}
      .wz-sidebar{position:static;width:100%;height:auto;padding:10px 0;border-right:none;border-bottom:1px solid rgba(255,255,255,.08);top:0}
      .wz-nav{display:flex;flex-wrap:wrap;padding:0 10px;gap:4px}
      .wz-nav-item{border-radius:8px;border-left:none;border-bottom:2px solid transparent;width:auto;padding:7px 10px;font-size:11px}
      .wz-nav-item.active{border-bottom-color:var(--teal)}
      .wz-sidebar-progress{display:none}
    }
'@

# ────────────────────────────────────────────────────────────
# 2. HTML SIDEBAR + ENVOLTURA (se inyecta justo después de <body>)
# ────────────────────────────────────────────────────────────
$wizardHTML = @'

  <!-- ══════════════ WIZARD SIDEBAR ══════════════ -->
  <div id="wz-sidebar" class="wz-sidebar" aria-label="Navegación del asistente de PT"></div>

'@

# ────────────────────────────────────────────────────────────
# 3. STEP HEADERS + WRAPPER PANELS
#    Se inyectan ANTES del primer .card y DESPUES del último
# ────────────────────────────────────────────────────────────

# Definiciones de los paneles (lo que va dentro de cada uno)
# Estrategia: buscamos markers específicos del HTML original

# Panel 1: Guía rápida + Documentos empresa + Año anterior
$p1Start = '<!-- WIZARD:PANEL1:START -->'
$p1End   = '<!-- WIZARD:PANEL1:END -->'

# Panel 2: Operación analizada + Parámetros
$p2Start = '<!-- WIZARD:PANEL2:START -->'
$p2End   = '<!-- WIZARD:PANEL2:END -->'

# Panel 3: EEFF parte examinada
$p3Start = '<!-- WIZARD:PANEL3:START -->'
$p3End   = '<!-- WIZARD:PANEL3:END -->'

# Panel 4: Comparables + SuperSociedades + Otros docs + Dashboard
$p4Start = '<!-- WIZARD:PANEL4:START -->'
$p4End   = '<!-- WIZARD:PANEL4:END -->'

# Panel 5: Estudio económico + Regeneración + Auditoría + Verificación + Checklist
$p5Start = '<!-- WIZARD:PANEL5:START -->'
$p5End   = '<!-- WIZARD:PANEL5:END -->'

# Panel 6: Informe generado
$p6Start = '<!-- WIZARD:PANEL6:START -->'
$p6End   = '<!-- WIZARD:PANEL6:END -->'

# ────────────────────────────────────────────────────────────
# 4. JS WIZARD ENGINE
# ────────────────────────────────────────────────────────────
$wizardJS = @'

  <script>
  /* ============================================================
     WIZARD ENGINE — se añade sobre la lógica original de PT
     ============================================================ */
  (function(){
    'use strict';
    const STEPS=[
      {id:1,label:'Identidad Corporativa',desc:'RUT · Cámara · Entidad base',emoji:'🏢',hint:'Cargue el RUT y la Cámara de Comercio. Los campos se completan automáticamente.'},
      {id:2,label:'Operación y Topes UVT',desc:'Excel operaciones · PLI · Parámetros',emoji:'📊',hint:'Adjunte el Excel de operaciones con vinculados y configure el indicador PLI y los topes UVT.'},
      {id:3,label:'Estados Financieros',desc:'EEFF parte examinada',emoji:'📋',hint:'Ingrese ventas, costo y utilidad de la entidad local y adjunte los EEFF firmados.'},
      {id:4,label:'Comparables y Rango',desc:'Capital IQ · SuperSociedades · IQR',emoji:'📈',hint:'Importe comparables, ejecute el motor de selección y revise el rango intercuartil.'},
      {id:5,label:'Auditoría y Revisión',desc:'Estudio económico · Cruces · Checklist',emoji:'🛡️',hint:'Ejecute la auditoría de norma y técnica antes de emitir el informe.'},
      {id:6,label:'Entregables y XML',desc:'Informe Word · 1125 · Resumen',emoji:'📥',hint:'Descargue los documentos finales: Informe Local, Formato 1125 y Resumen Ejecutivo.'}
    ];
    let cur=1;
    const visited=new Set([1]);

    function hasData(n){
      try{
        const m={
          1:()=>!!($('ent')&&$('ent').value.trim()),
          2:()=>!!($('monto')&&$('monto').value.trim()),
          3:()=>!!($('t_s')&&$('t_s').value.trim()),
          4:()=>{const cb=$('cbody');return cb&&cb.children.length>0&&cb.querySelector('input')&&!!cb.querySelector('input').value.trim();},
          5:()=>!!($('e_mundo')&&$('e_mundo').value.trim()),
          6:()=>false
        };
        return m[n]?!!m[n]():false;
      }catch(e){return false;}
    }

    function go(n,fromUser){
      if(n<1||n>STEPS.length)return;
      if(fromUser)visited.add(n);
      cur=n;
      // Paneles
      for(let i=1;i<=STEPS.length;i++){
        const el=document.getElementById('wz-panel-'+i);
        if(el)el.classList.toggle('active',i===n);
      }
      // Sidebar buttons
      document.querySelectorAll('.wz-nav-item').forEach((btn,i)=>{
        btn.classList.remove('active','done');
        if(i+1===n)btn.classList.add('active');
        else if(hasData(i+1))btn.classList.add('done');
        btn.setAttribute('aria-current',i+1===n?'step':'false');
      });
      // Progress
      const pct=Math.round(n/STEPS.length*100);
      const fill=document.getElementById('wz-prog-fill');
      const lbl=document.getElementById('wz-prog-pct');
      if(fill)fill.style.width=pct+'%';
      if(lbl)lbl.textContent='Paso '+n+' de '+STEPS.length+' · '+pct+'%';
      // Topbar indicator
      const ind=document.getElementById('wz-topbar-ind');
      if(ind)ind.innerHTML='Paso&nbsp;<b>'+n+'</b>&nbsp;/&nbsp;'+STEPS.length;
      // Scroll
      window.scrollTo({top:0,behavior:'smooth'});
      // Recalcular
      try{if(typeof calc==='function')calc();}catch(e){}
    }

    function buildSidebar(){
      const sb=document.getElementById('wz-sidebar');
      if(!sb)return;
      let h='<div class="wz-sidebar-title">Pasos del estudio</div><ul class="wz-nav" role="list">';
      STEPS.forEach((s,i)=>{
        h+=`<li role="listitem"><button class="wz-nav-item${i===0?' active':''}"
          onclick="__wz.go(${s.id},true)"
          aria-label="Ir al paso ${s.id}: ${s.label}"
          aria-current="${i===0?'step':'false'}">
          <span class="wz-nav-num">${s.id}</span>
          <span>
            <span style="display:block;font-size:12px;font-weight:600">${s.label}</span>
            <span style="display:block;font-size:10px;opacity:.6;margin-top:1px">${s.desc}</span>
          </span>
        </button></li>`;
      });
      h+=`</ul><div class="wz-sidebar-progress">
        <div class="wz-prog-label">Completitud del expediente</div>
        <div class="wz-prog-bar"><div class="wz-prog-fill" id="wz-prog-fill" style="width:17%"></div></div>
        <div class="wz-prog-pct" id="wz-prog-pct">Paso 1 de 6 · 17%</div>
      </div>`;
      sb.innerHTML=h;
    }

    function buildTopbarIndicator(){
      const actions=document.querySelector('.topbar .r1');
      if(!actions)return;
      if(document.getElementById('wz-topbar-ind'))return;
      const span=document.createElement('span');
      span.className='wz-step-indicator';
      span.id='wz-topbar-ind';
      span.innerHTML='Paso&nbsp;<b>1</b>&nbsp;/&nbsp;6';
      actions.appendChild(span);
    }

    function buildPanelHeaders(){
      STEPS.forEach(s=>{
        const panel=document.getElementById('wz-panel-'+s.id);
        if(!panel)return;
        const hdr=document.createElement('div');
        hdr.className='wz-step-header';
        hdr.setAttribute('aria-labelledby','wz-h-'+s.id);
        hdr.innerHTML=`<div class="wz-step-badge" aria-hidden="true">${s.emoji}</div>
          <div class="wz-step-info">
            <h2 id="wz-h-${s.id}">Paso ${s.id}: ${s.label}</h2>
            <p>${s.hint}</p>
          </div>`;
        panel.insertBefore(hdr,panel.firstChild);

        // Footer de navegación
        const footer=document.createElement('div');
        footer.className='wz-footer';
        const prevBtn=`<button class="wz-btn-nav wz-btn-prev" id="wz-prev-${s.id}"${s.id===1?' disabled':''} onclick="__wz.go(${s.id-1},true)" aria-label="Paso anterior">← Anterior</button>`;
        let nextBtn='';
        if(s.id<STEPS.length){
          nextBtn=`<button class="wz-btn-nav wz-btn-next" id="wz-next-${s.id}" onclick="__wz.go(${s.id+1},true)" aria-label="Siguiente paso">Siguiente: ${STEPS[s.id].label} →</button>`;
        }else{
          nextBtn=`<button class="wz-btn-nav wz-btn-next wz-btn-finish" onclick="generarDefinitivo&&generarDefinitivo()">✓ Generar Informe Definitivo</button>`;
        }
        footer.innerHTML=prevBtn+nextBtn;
        panel.appendChild(footer);
      });
    }

    function initDragDrop(){
      document.querySelectorAll('.wz-dropzone').forEach(dz=>{
        dz.addEventListener('dragover',e=>{e.preventDefault();dz.classList.add('dragover');});
        dz.addEventListener('dragleave',()=>dz.classList.remove('dragover'));
        dz.addEventListener('drop',e=>{
          e.preventDefault();dz.classList.remove('dragover');
          const inp=dz.querySelector('input[type=file]');
          if(inp&&e.dataTransfer.files.length){
            try{const dt=new DataTransfer();[...e.dataTransfer.files].forEach(f=>dt.items.add(f));inp.files=dt.files;}catch(er){}
            inp.dispatchEvent(new Event('change',{bubbles:true}));
          }
        });
      });
    }

    function initARIA(){
      // Toggle guía rápida
      const helpBtn=document.querySelector('[onclick="toggleHelp()"]');
      const helpBody=document.getElementById('helpbody');
      if(helpBtn&&helpBody){
        helpBtn.setAttribute('aria-expanded','true');
        helpBtn.setAttribute('aria-controls','helpbody');
        const origToggle=window.toggleHelp;
        window.toggleHelp=function(){
          if(origToggle)origToggle.call(this);
          const isNowHidden=helpBody.style.display==='none';
          helpBtn.setAttribute('aria-expanded',isNowHidden?'false':'true');
        };
      }
      // Scope a tablas de comparables
      document.querySelectorAll('#ctbl thead th').forEach(th=>{if(!th.hasAttribute('scope'))th.setAttribute('scope','col');});
    }

    function initBadgeUpdates(){
      document.addEventListener('input',function(){
        document.querySelectorAll('.wz-nav-item').forEach((btn,i)=>{
          if(i+1!==cur)btn.classList.toggle('done',hasData(i+1));
        });
      });
    }

    window.__wz={go,cur:()=>cur};

    function init(){
      buildSidebar();
      buildTopbarIndicator();
      buildPanelHeaders();
      initDragDrop();
      initARIA();
      initBadgeUpdates();
      go(1,false);
    }

    if(document.readyState==='loading'){
      document.addEventListener('DOMContentLoaded',init);
    }else{
      setTimeout(init,0);
    }
  })();
  </script>
'@

# ────────────────────────────────────────────────────────────
# 5. TRANSFORMAR EL HTML ORIGINAL
# ────────────────────────────────────────────────────────────
Write-Host "[2/5] Inyectando CSS…"

# a) Agregar CSS antes del cierre del ULTIMO </style> del <head>
# El head cierra con </style> antes de </head>
$cssInject = $wizardCSS + "`n  </style>"
$modified = $original -replace "(?s)(</style>\s*</head>)", ($cssInject + "`n</head>")

# b) Cambiar <body> a body semántico sin tocar nada más
Write-Host "[2b/5] Semántica básica…"
# Convertir el topbar div a header
$modified = $modified -replace '<div class="topbar">', '<header class="topbar" role="banner">'
$modified = $modified -replace '(</div>)(\s*\n\s*<div class="wrap">)', '</header>$2'

Write-Host "[3/5] Inyectando sidebar HTML…"
# Insertar el sidebar después de <body>
$modified = $modified -replace '(<body>)', '$1' + "`n" + @'
  <!-- WIZARD SIDEBAR -->
  <div id="wz-sidebar" class="wz-sidebar" role="navigation" aria-label="Pasos del asistente de Precios de Transferencia"></div>
  <!-- WIZARD MAIN WRAPPER START -->
  <div class="wz-layout">
'@

Write-Host "[4/5] Envolviendo paneles del wizard…"

# ── PANEL 1: Guía rápida + Documentos empresa + Documentación año anterior
# Las primeras 3 tarjetas .card.full
$p1Header = '<div id="wz-panel-1" class="wz-panel active" role="region" aria-labelledby="wz-h-1"><div class="wz-main">'
$p1Footer = '</div></div><!-- end wz-panel-1 -->'

# ── PANEL 2: Operación analizada + Parámetros e indicador (2 cards grid)
$p2Header = '<div id="wz-panel-2" class="wz-panel" role="region" aria-labelledby="wz-h-2"><div class="wz-main">'
$p2Footer = '</div></div><!-- end wz-panel-2 -->'

# ── PANEL 3: Parte examinada EEFF
$p3Header = '<div id="wz-panel-3" class="wz-panel" role="region" aria-labelledby="wz-h-3"><div class="wz-main">'
$p3Footer = '</div></div><!-- end wz-panel-3 -->'

# ── PANEL 4: Comparables + SuperSociedades + Otros docs + Universo + Dashboard
$p4Header = '<div id="wz-panel-4" class="wz-panel" role="region" aria-labelledby="wz-h-4"><div class="wz-main">'
$p4Footer = '</div></div><!-- end wz-panel-4 -->'

# ── PANEL 5: Estudio económico + Regeneración + Auditoría + Verificación + Checklist
$p5Header = '<div id="wz-panel-5" class="wz-panel" role="region" aria-labelledby="wz-h-5"><div class="wz-main">'
$p5Footer = '</div></div><!-- end wz-panel-5 -->'

# ── PANEL 6: Informe generado
$p6Header = '<div id="wz-panel-6" class="wz-panel" role="region" aria-labelledby="wz-h-6"><div class="wz-main">'
$p6Footer = '</div></div><!-- end wz-panel-6 -->'

# Markers que existen en el HTML original — usamos comentarios que ya tiene el sistema
# o usamos patrones únicos de cada sección

# La estructura del original es:
#   <div class="wrap">
#     <div class="grid">
#       [cards panel 1: guia + documentos + año anterior]
#       [cards panel 2: operacion + parametros]
#       [cards panel 3: eeff]
#       [cards panel 4: comparables + super + otros + universo + estudio]
#       [cards panel 5: auditoría + verificacion + checklist + regen]
#     </div>  <!-- cierra .grid -->
#     <div class="dashwrap"> ...kpis+rangebox+veredicto... </div>
#     <div id="report"> ...informe... </div>
#   </div>  <!-- cierra .wrap -->

# ESTRATEGIA:
# Encontramos los delimitadores únicos en el HTML y los envolvemos

# P1 = desde inicio del .grid hasta la card de "Operación analizada"
# P2 = card Operación + card Parámetros
# P3 = card EEFF
# P4 = card Comparables + card SuperSociedades + card Otros + card Universo + dashwrap
# P5 = card Estudio económico + card Regeneración + card Auditoría + card Verificación + card Checklist
# P6 = #report

# IDENTIFICADORES ÚNICOS:
# P1→P2 boundary: '<h3>Operación analizada'
# P2→P3 boundary: '<h3>Parte examinada — EEFF'
# P3→P4 boundary: '<h3>Comparables'
# P4→P5 boundary: '<h3>Estudio económico y sectorial'  (primera card oculta del bloque 4→5)
#   Pero esas cards tienen style="display:none" — están ocultas en el original
#   La marca real es el dashwrap
# P4→P5 boundary real: '</div>↵↵    <div class="dashwrap">'
# P5 = dashwrap + estudio + regen + auditoria + verificacion + checklist
# P5→P6 boundary: '<div id="report">'
# P6 = #report hasta </div>↵↵</div> del wrap

# Wrapping P1: desde inicio .grid hasta P2
$modified = $modified -replace '(<div class="grid">)', ($p1Header + '<div class="grid">')

# P1→P2: donde empieza la card de "Operación analizada"
$modified = $modified -replace '(<div class="card">[\s\n\r]*<div class="hd">[\s\n\r]*<h3>Operación analizada)', ($p1Footer + "`n" + $p2Header + '<div class="grid"><div class="card"><div class="hd"><h3>Operación analizada')

# La card de Operación es .card (mitad del grid) igual que Parámetros
# P2→P3: donde empieza la card de EEFF
$modified = $modified -replace '(<div class="card">[\s\n\r]*<div class="hd">[\s\n\r]*<h3>Parte examinada)', ($p2Footer + "`n" + $p3Header + '<div class="grid"><div class="card"><div class="hd"><h3>Parte examinada')

# P3→P4: donde empieza la card de Comparables
$modified = $modified -replace '(<div class="card">[\s\n\r]*<div class="hd">[\s\n\r]*<h3>Comparables)', ($p3Footer + "`n" + $p4Header + '<div class="grid"><div class="card full"><div class="hd"><h3>Comparables')

# En P3 y P2 cerramos el .grid artificialmente — necesitamos cerrar el grid div que injectamos
# Esto se resuelve inyectando </div><!-- grid --> antes del pX footer
# Reemplazamos los footers para incluir el cierre del grid
$p1Footer = '</div><!-- grid --></div></div><!-- end wz-panel-1 -->'
$p2Footer = '</div><!-- grid --></div></div><!-- end wz-panel-2 -->'
$p3Footer = '</div><!-- grid --></div></div><!-- end wz-panel-3 -->'
$p4Footer = '</div></div><!-- end wz-panel-4 -->'

# Dado que ya hicimos los reemplazos arriba con los footers sin el </div>, los ajustamos:
$modified = $modified -replace '<!-- end wz-panel-1 -->', '<!-- end wz-panel-1 PLACEHOLDER -->'
$modified = $modified -replace '<!-- end wz-panel-2 -->', '<!-- end wz-panel-2 PLACEHOLDER -->'
$modified = $modified -replace '<!-- end wz-panel-3 -->', '<!-- end wz-panel-3 PLACEHOLDER -->'

# Simplificar: usamos un enfoque directo — reformateamos la sección de paneles completamente
# con regex más precisos aprovechando los IDs únicos

# ══════════════════════════════════════════════════════════════════
# ENFOQUE FINAL: Transformación posicional directa con regex precisos
# ══════════════════════════════════════════════════════════════════

Write-Host "[4b/5] Aplicando transformación de paneles…"

# Restaurar el original limpio y aplicar transformación nueva y más precisa
$modified = $original

# PASO A: Inyectar CSS
$modified = $modified -replace '(?s)(</style>(\s*</style>)?\s*</head>)', {
    $last = $_.Groups[0].Value
    $wizardCSS + "`n" + $last
}

# Inyectar CSS antes de </head>
$cssBlock = "`n  <style id=`"wz-styles`">`n" + $wizardCSS + "`n  </style>`n"
$modified = $modified.Replace("</head>", $cssBlock + "</head>")

# PASO B: Semántica del topbar
$modified = $modified.Replace('<div class="topbar">', '<header class="topbar" role="banner">')

# PASO C: Insertar layout wrapper tras <body>
$bodyReplacement = @'
<body>
  <!-- WIZARD SIDEBAR -->
  <div id="wz-sidebar" class="wz-sidebar" role="navigation" aria-label="Pasos del asistente"></div>
  <!-- WIZARD LAYOUT WRAPPER -->
  <div class="wz-layout" id="wz-layout-root">
'@
$modified = $modified.Replace('<body>', $bodyReplacement)

# PASO D: Encontrar dónde termina el .wrap y cerrar el wz-layout
$modified = $modified.Replace('</div>' + "`n" + '</body>', '</div>' + "`n" + '  </div><!-- end wz-layout -->' + "`n" + '</body>')

# PASO E: Envolver el contenido del .wrap en panels del wizard
# El .wrap contiene: .grid > [cards] y .dashwrap y #report

# Identificamos los comentarios que separan las secciones
# Las cards en el .grid van en este orden:
#   1. card.full "Cómo usar el sistema — guía rápida"
#   2. card.full "Documentos de la compañía"
#   3. card.full "Documentación comprobatoria del año anterior"
#   4. card      "Operación analizada"
#   5. card      "Parámetros e indicador"
#   6. card      "Parte examinada — EEFF"
#   7. card      "Comparables"
#   8. card.full "Ingesta especial · Comparables nacionales"
#   9. card.full "Otros documentos"
#  10. card[oculta] "Universo de búsqueda"
#  11. card[oculta] "Estudio económico y sectorial"
#  12. card[oculta] "Regeneración por instrucción"
#  13. card[oculta] "Módulo de auditoría"
#  14. card[oculta] "Verificación de puntos de ingesta"
#  15. card[oculta] "Checklist normativo"
#   .dashwrap  (kpis + bar + veredicto + progreso + umbrales)
#   #report

# Inyectamos marcadores antes de cada grupo:
# Grupo P1 (cards 1-3): desde inicio de .grid
# Grupo P2 (cards 4-5): desde "Operación analizada"
# Grupo P3 (card 6): desde "Parte examinada — EEFF"
# Grupo P4 (cards 7-10 + dashwrap): desde "Comparables"
# Grupo P5 (cards 11-15): desde "Estudio económico"
# Grupo P6 (#report): desde id="report"

# Marcadores de inicio de cada panel (patrones únicos en el HTML)
$mark1 = '<div class="grid">'
$mark2 = '<h3>Operación analizada'
$mark3 = '<h3>Parte examinada'
$mark4 = '<h3>Comparables<'
$mark5 = '<h3>Estudio económico y sectorial<'
$mark6 = '<div id="report">'

# Verificar que los markers existen
Write-Host "Verificando markers..."
Write-Host "  mark1 (.grid): $($modified.Contains($mark1))"
Write-Host "  mark2 (Operación): $($modified.Contains($mark2))"
Write-Host "  mark3 (EEFF): $($modified.Contains($mark3))"
Write-Host "  mark4 (Comparables): $($modified.Contains($mark4))"
Write-Host "  mark5 (Estudio económico): $($modified.Contains($mark5))"
Write-Host "  mark6 (#report): $($modified.Contains($mark6))"

# Envolver la seccion de contenido del wizard
# Estrategia: reemplazamos la seccion completa del .wrap con la version wizard

# Extraer el bloque del wrap
$wrapStart = $modified.IndexOf('<div class="wrap">')
$wrapEnd = $modified.IndexOf('</div>', $modified.IndexOf('</div>', $modified.IndexOf('</div>', $wrapStart + 18) + 6))

Write-Host "wrap start index: $wrapStart"

# ENFOQUE SIMPLIFICADO: Inyectar divs de panel directamente en posiciones clave
# usando Replace con valores únicos

# PANEL 1 -> comienza con el .wrap, termina justo antes de "Operación analizada"
# Insertamos apertura del panel antes de <div class="wrap">
$modified = $modified.Replace('<div class="wrap">', @'
<div class="wz-main" style="flex:1;min-width:0">
<div id="wz-panel-1" class="wz-panel active" role="region" aria-labelledby="wz-h-1">
<div class="wrap" style="max-width:100%">
'@)

# Encontrar la primera ocurrencia de "Operación analizada" y añadir marcador ANTES de su card
# La card empieza con <div class="card"> seguido (con whitespace) de <div class="hd"> luego <h3>Operación analizada
$operRegex = '(<div class="card">(\s|\n|\r)*<div class="hd">(\s|\n|\r)*<h3>Operación analizada)'
$p1Close_p2Open = @'
</div><!-- end wrap p1 -->
</div><!-- end wz-panel-1 -->
<div id="wz-panel-2" class="wz-panel" role="region" aria-labelledby="wz-h-2">
<div class="wrap" style="max-width:100%"><div class="grid">
'@
$modified = [System.Text.RegularExpressions.Regex]::Replace($modified, $operRegex, $p1Close_p2Open + '$1', [System.Text.RegularExpressions.RegexOptions]::Singleline, [System.TimeSpan]::FromSeconds(30))

Write-Host "[5/5] Escribiendo archivo: $Output"
[System.IO.File]::WriteAllText((Join-Path (Get-Location) $Output), $modified, [System.Text.Encoding]::UTF8)
Write-Host "✓ Listo: $Output ($([System.IO.File]::ReadAllBytes((Join-Path (Get-Location) $Output)).Length) bytes)"
