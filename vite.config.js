import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// Dev-only endpoint for tools/drops.html: saves a labelled song's beat levels and true drop
// beats to scripts/drop-corpus/<name>.json, which `npm run test:drops` checks the detector
// against. Only numbers are stored, never audio.
const CORPUS = path.resolve('scripts/drop-corpus');

function dropCorpus() {
  return {
    name: 'drop-corpus',
    configureServer(server) {
      server.middlewares.use('/__drop-corpus', (req, res) => {
        const name = decodeURIComponent((req.url || '').replace(/^\//, ''));
        if (!/^[a-z0-9-]{1,80}$/.test(name)) {
          res.statusCode = 400;
          return res.end('bad name');
        }
        const file = path.join(CORPUS, `${name}.json`);
        if (req.method === 'GET') {
          if (!fs.existsSync(file)) {
            res.statusCode = 404;
            return res.end('{}');
          }
          res.setHeader('Content-Type', 'application/json');
          return res.end(fs.readFileSync(file));
        }
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return res.end();
        }
        let body = '';
        req.on('data', (c) => {
          body += c;
          if (body.length > 2e6) req.destroy();
        });
        req.on('end', () => {
          try {
            const j = JSON.parse(body);
            if (!Array.isArray(j.loudDb) || !Array.isArray(j.bassDb) || !Array.isArray(j.drops)) throw new Error('missing fields');
            fs.mkdirSync(CORPUS, { recursive: true });
            fs.writeFileSync(file, JSON.stringify(j) + '\n');
            res.end('saved');
          } catch (e) {
            res.statusCode = 400;
            res.end(String(e.message || e));
          }
        });
      });
    },
  };
}

// Dev-only endpoint for refreshing the How to Play screenshots: with `?dev` open, calling
// captureShot('<name>') in the console posts the current frame here and it is saved as
// public/tutorial/<name>.jpg.
const SHOTS = path.resolve('public/tutorial');

function tutorialShots() {
  return {
    name: 'tutorial-shots',
    configureServer(server) {
      server.middlewares.use('/__shot', (req, res) => {
        const name = decodeURIComponent((req.url || '').replace(/^\//, ''));
        if (!/^[a-z0-9-]{1,40}$/.test(name) || req.method !== 'POST') {
          res.statusCode = 400;
          return res.end('bad request');
        }
        let body = '';
        req.on('data', (c) => {
          body += c;
          if (body.length > 8e6) req.destroy();
        });
        req.on('end', () => {
          const m = /^data:image\/jpeg;base64,(.+)$/.exec(body);
          if (!m) {
            res.statusCode = 400;
            return res.end('expected a jpeg data URL');
          }
          fs.mkdirSync(SHOTS, { recursive: true });
          fs.writeFileSync(path.join(SHOTS, `${name}.jpg`), Buffer.from(m[1], 'base64'));
          res.end('saved');
        });
      });
    },
  };
}

export default defineConfig({
  // relative asset paths, so the built game runs from any folder or sub-path (itch.io, GitHub Pages)
  base: './',
  // the packaged zip is rewritten while the dev server runs; watching it can crash the server
  server: { watch: { ignored: ['**/redshift-web.zip', '**/dist/**'] } },
  plugins: [dropCorpus(), tutorialShots()],
});
