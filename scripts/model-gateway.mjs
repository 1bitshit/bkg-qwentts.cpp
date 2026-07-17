import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const host = process.env.MODEL_GATEWAY_HOST || '0.0.0.0';
const port = Number(process.env.MODEL_GATEWAY_PORT || 8010);
const livePort = Number(process.env.TTS_LIVE_PORT || 8012);
const studioPort = Number(process.env.TTS_STUDIO_PORT || 8013);
const idleMs = Number(process.env.TTS_IDLE_MS || 120000);
const runtime = path.join(root, 'scripts', 'model-runtime.sh');
const dist = path.join(root, 'webui', 'dist');
let activeMode = 'none';
let lastUse = 0;
let switching = Promise.resolve();

function runRuntime(mode) {
  const result = spawnSync(runtime, [mode], { cwd: root, env: process.env, encoding: 'utf8' });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || `runtime ${mode} failed`).trim());
}

async function ensureMode(mode) {
  switching = switching.then(() => {
    if (activeMode !== mode) {
      runRuntime(mode);
      activeMode = mode;
    }
    lastUse = Date.now();
  });
  return switching;
}

function contentType(file) {
  const ext = path.extname(file);
  return ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' })[ext] || 'application/octet-stream';
}

function serveStatic(req, res) {
  const pathname = decodeURIComponent(new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname);
  let file = path.join(dist, pathname === '/' ? 'index.html' : pathname);
  if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, 'index.html');
  const data = fs.readFileSync(file);
  res.writeHead(200, { 'Content-Type': contentType(file), 'Content-Length': data.length, 'Cache-Control': file.endsWith('index.html') ? 'no-cache' : 'public, max-age=31536000, immutable' });
  res.end(data);
}

async function proxy(req, res, mode, targetPort, stripPrefix = '') {
  try {
    await ensureMode(mode);
    const targetPath = stripPrefix && req.url.startsWith(stripPrefix) ? req.url.slice(stripPrefix.length) || '/' : req.url;
    const upstream = http.request({ host: '127.0.0.1', port: targetPort, method: req.method, path: targetPath, headers: { ...req.headers, host: `127.0.0.1:${targetPort}` } }, up => {
      res.writeHead(up.statusCode || 502, up.headers);
      up.pipe(res);
    });
    upstream.on('error', error => { if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: error.message })); });
    req.pipe(upstream);
  } catch (error) {
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    const body = JSON.stringify({ status: 'ok', active_model: activeMode, idle_ms: idleMs });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
    return res.end(body);
  }
  if (req.url.startsWith('/v1/studio/')) return void proxy(req, res, 'studio', studioPort, '/v1/studio');
  if (req.url.startsWith('/v1/')) return void proxy(req, res, 'live', livePort);
  return serveStatic(req, res);
});

setInterval(() => {
  if (activeMode !== 'none' && Date.now() - lastUse > idleMs) {
    switching = switching.then(() => { runRuntime('unload'); activeMode = 'none'; });
  }
}, 5000).unref();

process.on('SIGTERM', () => { try { runRuntime('unload'); } finally { server.close(() => process.exit(0)); } });
server.listen(port, host, () => console.log(`[model-gateway] listening on ${host}:${port}`));
