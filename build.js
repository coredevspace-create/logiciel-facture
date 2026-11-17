#!/usr/bin/env node
/*
 * Assemble Ardoise en UN SEUL fichier HTML autonome : dist/Ardoise.html
 * (styles, scripts, moteur PDF et polices intégrés).
 *
 * Utilisation :  node build.js
 * Aucune dépendance : Node.js suffit.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = __dirname;
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
let html = read('app.html');

// <link rel="stylesheet" href="..."> → <style>…</style>
html = html.replace(/<link rel="stylesheet" href="([^"]+)">/g, (_, href) => `<style>\n${read(href)}\n</style>`);

// <script src="..."></script> → <script>…</script>
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, src) => {
  const code = read(src).replace(/<\/script/gi, '<\\/script');
  return `<script>/* ${src} */\n${code}\n</script>`;
});

// Politique de sécurité (CSP) : seuls les scripts intégrés ci-dessus, identifiés par leur
// empreinte SHA-256, peuvent s'exécuter. Tout script injecté serait bloqué par le navigateur.
const crypto = require('crypto');
const hashes = [];
html.replace(/<script>([\s\S]*?)<\/script>/g, (_, code) => { hashes.push(`'sha256-${crypto.createHash('sha256').update(code, 'utf8').digest('base64')}'`); return _; });
const csp = `default-src 'none'; script-src ${hashes.join(' ')}; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
html = html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n  <meta http-equiv="Content-Security-Policy" content="${csp}">`);

const version = JSON.parse(read('package.json')).version;
const stamp = new Date().toISOString().slice(0, 10);
html = html.replace('<head>', `<head>\n  <!-- Ardoise ${version} — fichier autonome généré le ${stamp} par build.js -->`);

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const out = path.join(root, 'dist', 'Ardoise.html');
fs.writeFileSync(out, html);
console.log(`✔ ${path.relative(root, out)} (${(fs.statSync(out).size / 1024 / 1024).toFixed(2)} Mo)`);
