import {defineConfig} from 'vite';

// Dev-only endpoint for remote log reading (src/core/log.js pushes here):
//   POST /__log  — page appends its ring buffer (JSON array of entries)
//   GET  /__log  — returns everything accumulated, plain text
// The agent reads the browser log with curl, without opening the page.
function logEndpoint() {
  const lines = [];
  return {
    name: 'pp-log-endpoint',
    configureServer(server) {
      server.middlewares.use('/__log', (req, res) => {
        if (req.method === 'POST') {
          let body = '';
          req.on('data', c => body += c);
          req.on('end', () => {
            try { for (const e of JSON.parse(body)) lines.push(e); } catch { lines.push(body); }
            if (lines.length > 2000) lines.splice(0, lines.length - 2000);
            res.end('ok');
          });
        } else {
          res.setHeader('content-type', 'text/plain');
          res.end(lines.length ? lines.join('\n') : '(no log yet — open the page first)');
        }
      });
    },
  };
}

// cache-busting for the wasm in dev: never let the browser serve a stale core.
// Vite serves JS with its own hashes, but a raw .wasm URL is cached by the
// browser forever. Append the file mtime as ?v= so every rebuild = new URL.
import fs from 'node:fs';

function wasmNoCache() {
  return {
    name: 'pp-wasm-no-cache',
    configureServer(server) {
      server.middlewares.use('/PPE-graphics/sim/pocket_physics.wasm', (_req, res, next) => {
        // never cache the wasm in dev: every reload gets the fresh build
        res.setHeader('Cache-Control', 'no-store, max-age=0');
        next();
      });
    },
  };
}

export default defineConfig({
  base: './',
  // copy the wasm core into the bundle: pp.js fetches it at runtime
  plugins: [],
  build: {outDir: 'PPE-server/dist', emptyOutDir: true, target: 'es2020', sourcemap: false, chunkSizeWarningLimit: 900,
    rollupOptions: {output: {manualChunks: {three: ['three']}}}},
  optimizeDeps: {include: ['three', 'three/examples/jsm/utils/BufferGeometryUtils.js']},
  plugins: [logEndpoint(), wasmNoCache()],
  // the wasm is fetched at runtime by pp.js — ship it with the build
  publicDir: false,
  assetsInclude: [],
  server: {headers: {'Cache-Control': 'no-store'}},
});

// Note: run vite from the repo root (npm run build / npm run dev).
// outDir is relative to root, so send the bundle into PPE-server/dist.
