// Copia el index.html de la raíz (fuente original) a public/index.html
// (lo que realmente sirven server.js y Firebase Hosting), junto con vendor/
// (librerías de terceros alojadas localmente, ej. pdf.js).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const publicDir = path.join(root, 'public');

const srcIndex = path.join(root, 'index.html');
const destIndex = path.join(publicDir, 'index.html');
if (fs.existsSync(srcIndex)) {
  fs.copyFileSync(srcIndex, destIndex);
  console.log('index.html sincronizado a public/index.html');
} else {
  console.log('public/index.html ya es la fuente principal.');
}

const vendorSrc = path.join(root, 'vendor');
const vendorDest = path.join(publicDir, 'vendor');
if (fs.existsSync(vendorSrc)) {
  fs.cpSync(vendorSrc, vendorDest, { recursive: true });
  console.log('vendor/ sincronizado a public/vendor/');
}
