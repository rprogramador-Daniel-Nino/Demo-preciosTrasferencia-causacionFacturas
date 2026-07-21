// Copia el index.html de la raíz (fuente original) a public/index.html
// (lo que realmente sirven server.js y Firebase Hosting).
const fs = require('fs');
const path = require('path');

const src = path.join(__dirname, '..', 'index.html');
const dest = path.join(__dirname, '..', 'public', 'index.html');

fs.copyFileSync(src, dest);
console.log('index.html sincronizado a public/index.html');
