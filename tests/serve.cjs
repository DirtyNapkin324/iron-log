const { createServer } = require('node:http');
const { createReadStream } = require('node:fs');
const { resolve } = require('node:path');
const root = resolve(__dirname, '..');
const assets = {
  'index.html': 'text/html; charset=utf-8',
  'social.js': 'text/javascript',
  'app.js': 'text/javascript',
  'routine-builder.js': 'text/javascript',
  'routine-ui.js': 'text/javascript',
  'exercise-library.js': 'text/javascript',
  'app.css': 'text/css',
  'iron-core.js': 'text/javascript',
  'sw.js': 'text/javascript',
  'manifest.webmanifest': 'application/manifest+json',
  'apple-touch-icon.png': 'image/png',
  'icon.svg': 'image/svg+xml'
};

createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1:4173');
  const path = url.pathname.slice(1) || 'index.html';
  if (!Object.hasOwn(assets, path)) { response.writeHead(404).end(); return; }
  response.setHeader('Content-Type', assets[path]);
  createReadStream(resolve(root, path)).pipe(response);
}).listen(4173, '127.0.0.1');
