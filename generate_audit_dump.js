const fs = require('fs');
const path = require('path');

/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║        GENERADOR DE AUDITORÍA (DUMP) - SISTEMA PT                ║
 * ║   Consolida el código fuente para revisión de soberanía          ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Uso:  node generate_audit_dump.js
 *
 * Genera un archivo .txt por cada capa del sistema:
 *   - frontend_audit_dump.txt  → Wizard React/Vite (frontend/src)
 *   - backend_audit_dump.txt   → Cloud Functions, servidor local y scripts
 *   - cpanel_audit_dump.txt    → API PHP desplegada en cPanel
 *   - monolito_audit_dump.txt  → HTML monolítico (sistema en producción)
 */

const ANCHO = 66; // ancho interno del marco

// ─── Carpetas y archivos excluidos globalmente ───────────────────────
// Dependencias, artefactos de build y librerías de terceros: no son
// código propio, así que no entran a la auditoría.
const EXCLUIR_SIEMPRE = [
    'node_modules', '.git', '.firebase', 'dist', 'build', 'env', 'venv',
    '__pycache__', 'vendor', 'pdfjs', 'assets', 'Archivos Prueba',
    'package-lock.json', '.DS_Store',
];

// ─── Archivos con secretos: NUNCA se incluyen en un dump ─────────────
// config.php lleva la API key de Anthropic y .env las credenciales
// locales. Si un archivo cae aquí se reporta como omitido en consola.
const SECRETOS = ['.env', 'config.php', 'usage_data.json', 'serviceAccountKey.json'];

const omitidosPorSeguridad = [];

function getFilesFromDirs(baseDirs, extensions, excludes = []) {
    const allFiles = [];

    function walk(dir) {
        if (!fs.existsSync(dir)) return;
        const files = fs.readdirSync(dir);
        files.forEach(file => {
            if (EXCLUIR_SIEMPRE.includes(file) || excludes.includes(file)) {
                return;
            }
            const filePath = path.join(dir, file);
            const stat = fs.statSync(filePath);
            if (stat.isDirectory()) {
                walk(filePath);
            } else if (extensions.some(ext => file.endsWith(ext))) {
                if (SECRETOS.includes(file)) {
                    omitidosPorSeguridad.push(rel(filePath));
                    return;
                }
                allFiles.push(filePath);
            }
        });
    }

    baseDirs.forEach(entry => {
        const fullPath = path.isAbsolute(entry) ? entry : path.join(__dirname, entry);
        if (!fs.existsSync(fullPath)) return;
        // A diferencia del original, aquí se aceptan también archivos
        // sueltos (server.js, index.html), no solo carpetas.
        if (fs.statSync(fullPath).isDirectory()) {
            walk(fullPath);
        } else if (SECRETOS.includes(path.basename(fullPath))) {
            omitidosPorSeguridad.push(rel(fullPath));
        } else {
            allFiles.push(fullPath);
        }
    });

    return [...new Set(allFiles)].sort();
}

function rel(file) {
    return path.relative(__dirname, file).replace(/\\/g, '/');
}

function getVersion() {
    try {
        const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
        return pkg.version || 'Unknown';
    } catch (e) {
        return 'Not Found';
    }
}

function marco(label, value) {
    const texto = `  ${label}: ${value}`;
    return `║${texto.padEnd(ANCHO).slice(0, ANCHO)}║\n`;
}

function generateDump(filePaths, outputFileName, title) {
    const version = getVersion();
    let lineasTotales = 0;
    let bytesTotales = 0;

    const cuerpos = filePaths.map(file => {
        const codigo = fs.readFileSync(file, 'utf8');
        lineasTotales += codigo.split('\n').length;
        bytesTotales += Buffer.byteLength(codigo, 'utf8');
        return { ruta: rel(file), codigo };
    });

    let content = `╔${'═'.repeat(ANCHO)}╗\n`;
    content += marco('DUMP DE AUDITORÍA', title);
    content += marco('SISTEMA', 'Precios de Transferencia / Causación Facturas');
    content += marco('VERSIÓN', version);
    content += marco('FECHA', new Date().toLocaleString('es-CO'));
    content += marco('ARCHIVOS', String(cuerpos.length));
    content += marco('LÍNEAS', String(lineasTotales));
    content += marco('TAMAÑO', `${(bytesTotales / 1024).toFixed(1)} KB`);
    content += `╚${'═'.repeat(ANCHO)}╝\n`;

    // Índice: permite ubicar un archivo sin recorrer todo el dump.
    content += `\nÍNDICE DE ARCHIVOS\n${'-'.repeat(ANCHO)}\n`;
    cuerpos.forEach((f, i) => {
        content += `${String(i + 1).padStart(3)}. ${f.ruta}\n`;
    });

    cuerpos.forEach(f => {
        content += `\n\n============================================================\n`;
        content += `FILE: ${f.ruta}\n`;
        content += `============================================================\n\n`;
        content += f.codigo;
    });

    fs.writeFileSync(path.join(__dirname, outputFileName), content, 'utf8');
    return { archivos: cuerpos.length, lineas: lineasTotales, kb: bytesTotales / 1024 };
}

// --- EJECUCIÓN SISTEMA PT ---

console.log('🚀 Iniciando escaneo de soberanía...');

const generados = [];

function correr(dirs, extensiones, salida, titulo, excludes = []) {
    const archivos = getFilesFromDirs(dirs, extensiones, excludes);
    if (archivos.length === 0) {
        console.log(`⚠️  ${titulo}: sin archivos, se omite el dump.`);
        return;
    }
    const stats = generateDump(archivos, salida, titulo);
    generados.push({ salida, ...stats });
    console.log(`✅ ${titulo}: ${stats.archivos} archivos, ${stats.lineas} líneas → ${salida}`);
}

// 1. EL WIZARD: Frontend React + Vite
correr(
    [
        'frontend/src',
        'frontend/index.html',
        'frontend/vite.config.js',
        'frontend/tailwind.config.js',
        'frontend/postcss.config.js',
        'frontend/package.json',
    ],
    ['.jsx', '.js', '.css', '.html', '.json'],
    'frontend_audit_dump.txt',
    'EL WIZARD (FRONTEND REACT)'
);

// 2. EL MOTOR: Cloud Functions (proxy Gemini/Anthropic), servidor local y scripts
correr(
    [
        'functions',
        'server.js',
        'scripts',
        'package.json',
        'firebase.json',
        '.firebaserc',
    ],
    ['.js', '.json', '.firebaserc'],
    'backend_audit_dump.txt',
    'EL MOTOR (FUNCTIONS + SERVIDOR)'
);

// 3. LA PASARELA: API PHP en cPanel (producción)
correr(
    ['Cpanel'],
    ['.php', '.htaccess'],
    'cpanel_audit_dump.txt',
    'LA PASARELA (API PHP CPANEL)'
);

// 4. EL MONOLITO: HTML autocontenido que hoy usa el cliente final.
//    Se excluye public/index.html porque es una copia generada por
//    scripts/sync-index.js a partir del index.html de la raíz.
correr(
    [
        'index.html',
        'Sistema PT con OCR.html',
        'Cpanel/public_html/demo-precios-transferencia/index.html',
        'Cpanel/public_html/demo-precios-transferencia/Sistema PT V3 5.html',
    ],
    ['.html'],
    'monolito_audit_dump.txt',
    'EL MONOLITO (HTML PRODUCCIÓN)'
);

// --- RESUMEN ---

console.log('\n🏛️  Auditoría lista.');
generados.forEach(g => {
    console.log(`- ${g.salida} (${g.kb.toFixed(1)} KB)`);
});

if (omitidosPorSeguridad.length > 0) {
    console.log('\n🔒 Omitidos por contener credenciales (no van al dump):');
    omitidosPorSeguridad.forEach(f => console.log(`- ${f}`));
}
