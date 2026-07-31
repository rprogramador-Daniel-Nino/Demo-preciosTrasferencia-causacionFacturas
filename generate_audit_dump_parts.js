const fs = require('fs');
const path = require('path');

/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║          GENERADOR DE AUDITORÍA (DUMP) - SISTEMA PT              ║
 * ║      Consolida el código fuente POR PARTES para revisión         ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Uso:  node generate_audit_dump_parts.js
 *
 * Cada capa se divide en partes por responsabilidad. Si una parte supera
 * MAX_KB se subdivide en sufijos _a, _b, _c… para que ningún archivo
 * quede impracticable de revisar (el index.html de producción pesa
 * ~860 KB por sí solo).
 */

const ANCHO = 66;   // ancho interno del marco
const MAX_KB = 400; // tamaño máximo por archivo de salida

const SKIP_ALWAYS = [
    'node_modules', '.git', '.firebase', 'dist', 'build', 'env', 'venv',
    '__pycache__', '.claude', '.agents', 'vendor', 'pdfjs', 'assets',
    'Archivos Prueba', 'package-lock.json', '.DS_Store',
];

// Archivos con credenciales: config.php lleva la API key de Anthropic y
// .env las variables locales. Nunca entran al dump; se reportan aparte.
const SECRETOS = ['.env', 'config.php', 'usage_data.json', 'serviceAccountKey.json'];

const omitidosPorSeguridad = [];
const generados = [];

/**
 * @param {string[]} baseDirs   - carpetas o archivos sueltos
 * @param {string[]} extensions
 * @param {string[]} excludes   - nombres de carpeta/archivo extra a omitir
 * @param {boolean}  shallow    - true → solo archivos del nivel raíz (sin recursión)
 */
function getFilesFromDirs(baseDirs, extensions, excludes = [], shallow = false) {
    const allFiles = [];
    const skip = new Set([...SKIP_ALWAYS, ...excludes]);

    function walk(dir) {
        if (!fs.existsSync(dir)) return;
        fs.readdirSync(dir).forEach(file => {
            if (skip.has(file)) return;
            const filePath = path.join(dir, file);
            const stat = fs.statSync(filePath);
            if (stat.isDirectory()) {
                if (!shallow) walk(filePath);
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
        // Además de carpetas se aceptan archivos sueltos (server.js,
        // index.html, firebase.json), que en este proyecto viven en la raíz.
        if (fs.statSync(fullPath).isDirectory()) {
            walk(fullPath);
        } else if (SECRETOS.includes(path.basename(fullPath))) {
            omitidosPorSeguridad.push(rel(fullPath));
        } else {
            allFiles.push(fullPath);
        }
    });

    return [...new Set(allFiles)];
}

function rel(file) {
    return path.relative(__dirname, file).replace(/\\/g, '/');
}

function getVersion(type) {
    try {
        switch (type) {
            case 'WIZARD': {
                const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'frontend/package.json'), 'utf8'));
                return pkg.version || 'Unknown';
            }
            case 'MOTOR':
            case 'PASARELA':
            case 'MONOLITO': {
                const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
                return pkg.version || 'Unknown';
            }
            default:
                return 'Unknown';
        }
    } catch {
        return 'Not Found';
    }
}

function marco(label, value) {
    const texto = `  ${label}: ${value}`;
    return `║${texto.padEnd(ANCHO).slice(0, ANCHO)}║\n`;
}

function separador(etiqueta) {
    return `\n\n============================================================\n`
        + `FILE: ${etiqueta}\n`
        + `============================================================\n\n`;
}

/**
 * Convierte cada archivo en uno o más bloques de texto. Un archivo que
 * por sí solo excede MAX_KB se corta por líneas, indicando el rango en
 * el encabezado para que el fragmento siga siendo ubicable.
 */
function construirBloques(filePaths) {
    const bloques = [];

    filePaths.forEach(file => {
        const ruta = rel(file);
        let codigo;
        try {
            codigo = fs.readFileSync(file, 'utf8');
        } catch (e) {
            bloques.push({ ruta, texto: separador(ruta) + `[ERROR LEYENDO ARCHIVO: ${e.message}]\n`, kb: 0 });
            return;
        }

        const kb = Buffer.byteLength(codigo, 'utf8') / 1024;
        if (kb <= MAX_KB) {
            bloques.push({ ruta, texto: separador(ruta) + codigo, kb });
            return;
        }

        const lineas = codigo.split('\n');
        const trozos = Math.ceil(kb / MAX_KB);
        const porTrozo = Math.ceil(lineas.length / trozos);
        for (let i = 0; i < trozos; i++) {
            const desde = i * porTrozo;
            const hasta = Math.min(desde + porTrozo, lineas.length);
            const fragmento = lineas.slice(desde, hasta).join('\n');
            const etiqueta = `${ruta}  [fragmento ${i + 1}/${trozos} — líneas ${desde + 1}-${hasta}]`;
            bloques.push({
                ruta,
                texto: separador(etiqueta) + fragmento,
                kb: Buffer.byteLength(fragmento, 'utf8') / 1024,
            });
        }
    });

    return bloques;
}

/** Agrupa los bloques en tandas que no superen MAX_KB. */
function repartir(bloques) {
    const tandas = [];
    let actual = [];
    let acumulado = 0;

    bloques.forEach(b => {
        if (actual.length > 0 && acumulado + b.kb > MAX_KB) {
            tandas.push(actual);
            actual = [];
            acumulado = 0;
        }
        actual.push(b);
        acumulado += b.kb;
    });
    if (actual.length > 0) tandas.push(actual);

    return tandas;
}

function generateDump(filePaths, outputFileName, title, type) {
    if (filePaths.length === 0) {
        console.log(`  ⚠️  Sin archivos: ${title}`);
        return;
    }

    const version = getVersion(type);
    const fecha = new Date().toLocaleString('es-CO');
    const tandas = repartir(construirBloques(filePaths));
    const sufijos = 'abcdefghijklmnopqrstuvwxyz';

    tandas.forEach((tanda, idx) => {
        const nombre = tandas.length === 1
            ? outputFileName
            : outputFileName.replace(/\.txt$/, `_${sufijos[idx]}.txt`);

        const rutas = [...new Set(tanda.map(b => b.ruta))];
        const kb = tanda.reduce((s, b) => s + b.kb, 0);

        let content = `╔${'═'.repeat(ANCHO)}╗\n`;
        content += marco('DUMP DE AUDITORÍA', title);
        content += marco('SISTEMA', 'Precios de Transferencia / Causación Facturas');
        content += marco('VERSIÓN', version);
        content += marco('FECHA', fecha);
        if (tandas.length > 1) {
            content += marco('PARTE', `${idx + 1} de ${tandas.length}`);
        }
        content += marco('ARCHIVOS', String(rutas.length));
        content += marco('TAMAÑO', `${kb.toFixed(1)} KB`);
        content += `╚${'═'.repeat(ANCHO)}╝\n`;

        content += `\nCONTENIDO\n${'-'.repeat(ANCHO)}\n`;
        rutas.forEach((r, i) => { content += `${String(i + 1).padStart(3)}. ${r}\n`; });

        tanda.forEach(b => { content += b.texto; });

        fs.writeFileSync(path.join(__dirname, nombre), content, 'utf8');
        generados.push(nombre);
        console.log(`  ✅ ${nombre} — ${rutas.length} archivos, ${kb.toFixed(1)} KB`);
    });
}

// ─────────────────────────────────────────────────────────────────────
console.log('\n🚀 Auditoría completa Sistema PT — iniciando...\n');

// ═══════════════════════════════════════════════════════════════════
// 1. EL WIZARD — Frontend React / Vite
// ═══════════════════════════════════════════════════════════════════
console.log('🎨 [1/4] EL WIZARD (Frontend React)');

// 1.1 Componentes de la UI (pasos del wizard)
generateDump(
    getFilesFromDirs(['frontend/src/components'], ['.jsx', '.js', '.css']),
    'wizard_part1_ui.txt', 'EL WIZARD — COMPONENTES UI', 'WIZARD'
);

// 1.2 Lógica: parsers de Excel/EEFF y cálculos.
//     masterTemplate.js se excluye aquí porque son ~295 KB de plantilla
//     y desplazaría a la lógica; va en su propia parte (1.3).
generateDump(
    getFilesFromDirs(
        ['frontend/src/services', 'frontend/src/utils'],
        ['.js'],
        ['masterTemplate.js']
    ),
    'wizard_part2_logica.txt', 'EL WIZARD — PARSERS & CÁLCULOS', 'WIZARD'
);

// 1.3 Plantilla maestra del informe (archivo único de gran tamaño)
generateDump(
    getFilesFromDirs(['frontend/src/services/masterTemplate.js'], ['.js']),
    'wizard_part3_plantilla.txt', 'EL WIZARD — PLANTILLA MAESTRA', 'WIZARD'
);

// 1.4 Raíz de src (App, main, estilos) + configuración de build
generateDump(
    [
        ...getFilesFromDirs(['frontend/src'], ['.jsx', '.js', '.css'], [], true),
        ...getFilesFromDirs(
            [
                'frontend/index.html',
                'frontend/vite.config.js',
                'frontend/tailwind.config.js',
                'frontend/postcss.config.js',
                'frontend/package.json',
                'frontend/.oxlintrc.json',
            ],
            ['.html', '.js', '.json']
        ),
    ],
    'wizard_part4_config.txt', 'EL WIZARD — APP & CONFIG BUILD', 'WIZARD'
);

// ═══════════════════════════════════════════════════════════════════
// 2. EL MOTOR — Cloud Functions y servidor local
// ═══════════════════════════════════════════════════════════════════
console.log('\n⚙️  [2/4] EL MOTOR (Backend)');

// 2.1 Cloud Functions: proxy hacia Gemini / Anthropic
generateDump(
    getFilesFromDirs(['functions'], ['.js', '.json']),
    'motor_part1_functions.txt', 'EL MOTOR — CLOUD FUNCTIONS', 'MOTOR'
);

// 2.2 Servidor local, scripts de build y configuración de despliegue
generateDump(
    getFilesFromDirs(
        ['server.js', 'scripts', 'package.json', 'firebase.json', '.firebaserc', '.htaccess', 'build-wizard.ps1'],
        ['.js', '.json', '.ps1']
    ),
    'motor_part2_servidor.txt', 'EL MOTOR — SERVIDOR & DESPLIEGUE', 'MOTOR'
);

// ═══════════════════════════════════════════════════════════════════
// 3. LA PASARELA — API PHP en cPanel
// ═══════════════════════════════════════════════════════════════════
console.log('\n🔌 [3/4] LA PASARELA (API PHP cPanel)');

// 3.1 API en producción
generateDump(
    getFilesFromDirs(['Cpanel/public_html/api'], ['.php', '.htaccess']),
    'pasarela_part1_api.txt', 'LA PASARELA — API PRODUCCIÓN', 'PASARELA'
);

// 3.2 API del entorno demo
generateDump(
    getFilesFromDirs(['Cpanel/public_html/demo-precios-transferencia/api'], ['.php', '.htaccess']),
    'pasarela_part2_demo.txt', 'LA PASARELA — API DEMO', 'PASARELA'
);

// ═══════════════════════════════════════════════════════════════════
// 4. EL MONOLITO — HTML autocontenido que usa el cliente final
// ═══════════════════════════════════════════════════════════════════
console.log('\n📄 [4/4] EL MONOLITO (HTML producción)');

// 4.1 Sistema en producción. Se omite public/index.html: es una copia
//     que scripts/sync-index.js genera desde el index.html de la raíz.
generateDump(
    getFilesFromDirs(['index.html'], ['.html']),
    'monolito_part1_produccion.txt', 'EL MONOLITO — PRODUCCIÓN', 'MONOLITO'
);

// 4.2 Variante con OCR
generateDump(
    getFilesFromDirs(['Sistema PT con OCR.html'], ['.html']),
    'monolito_part2_ocr.txt', 'EL MONOLITO — VARIANTE OCR', 'MONOLITO'
);

// 4.3 Versiones desplegadas en cPanel
generateDump(
    getFilesFromDirs(
        [
            'Cpanel/public_html/demo-precios-transferencia/index.html',
            'Cpanel/public_html/demo-precios-transferencia/Sistema PT V3 5.html',
        ],
        ['.html']
    ),
    'monolito_part3_cpanel.txt', 'EL MONOLITO — DESPLIEGUE CPANEL', 'MONOLITO'
);

// ─────────────────────────────────────────────────────────────────────
console.log(`\n🏛️  Auditoría Sistema PT completa — ${generados.length} dumps generados.`);

if (omitidosPorSeguridad.length > 0) {
    console.log('\n🔒 Omitidos por contener credenciales (no van al dump):');
    [...new Set(omitidosPorSeguridad)].forEach(f => console.log(`- ${f}`));
}
