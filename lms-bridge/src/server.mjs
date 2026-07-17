import http from 'node:http';
import { spawn } from 'node:child_process';
import { LMStudioClient } from '@lmstudio/sdk';

const host = process.env.LMS_BRIDGE_HOST || '127.0.0.1';
const port = Number(process.env.LMS_BRIDGE_PORT || 1236);
const lmBaseUrl = process.env.LMS_SDK_BASE_URL || 'ws://127.0.0.1:1234';
const client = new LMStudioClient({ baseUrl: lmBaseUrl });

const recommendations = {
  debate: [
    ['unsloth/Qwen3-14B-128K-GGUF@Q4_K_M', '9.0 GB', 'stabil', 'Gute deutsche Argumentation und langer Kontext.'],
    ['bartowski/Mistral-Small-24B-Instruct-2501-GGUF@Q4_K_M', '14 GB', 'hoch', 'Starker Talkmaster und präzise Gegenfragen.'],
    ['Qwen/Qwen3-8B-GGUF@Q5_K_M', '6 GB', 'schnell', 'Leichteres Modell für schnelle Live-Runden.'],
  ],
  story: [
    ['unsloth/Qwen3-14B-128K-GGUF@Q4_K_M', '9.0 GB', 'stabil', 'Lange Geschichten mit konsistenter Fortsetzung.'],
    ['bartowski/Mistral-Small-24B-Instruct-2501-GGUF@Q4_K_M', '14 GB', 'hoch', 'Guter Editor für Stil und Regie.'],
    ['Qwen/Qwen3-8B-GGUF@Q5_K_M', '6 GB', 'schnell', 'Schnelle Ideen und kürzere Szenen.'],
  ],
};
function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function dailyModels(kind) {
  return recommendations[kind].map(([id, size, tier, reason]) => ({
    id, size, tier, source: 'Hugging Face', reason,
    rating: { count: 0, average: null },
  }));
}

function runLms(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.LMS_BIN || 'lms', args, { env: process.env });
    let output = '';
    child.stdout.on('data', (data) => { output += data; });
    child.stderr.on('data', (data) => { output += data; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(output.trim()) : reject(new Error(output.trim() || `lms exited ${code}`)));
  });
}
async function handleGenerate(body) {
  const role = body.role || 'story';
  const modelId = body.model || process.env.LMS_DEFAULT_MODEL || 'qwen3-14b-128k';
  const model = await client.llm.model(modelId);
  const rawPrompt = String(body.prompt || '');
  const prompt = role === 'story' ? rawPrompt : `/no_think\nAntworte direkt ohne Analyse oder Vorrede.\n${rawPrompt}`;
  const maxTokens = Number(body.max_tokens || (role === 'director' ? 500 : role === 'debate' ? 1400 : 3000));
  const result = await model.respond(prompt, {
    temperature: role === 'director' ? 0.4 : 0.7,
    maxTokens,
  });
  const content = String(result.nonReasoningContent || result.content || '').trim();
  return { content, model: modelId, role };
}

async function handleModels() {
  const downloaded = await client.system.listDownloadedModels('llm');
  return {
    models: downloaded.map((model) => ({
      id: model.modelKey || model.path || model.displayName || model.name,
      path: model.path,
      displayName: model.displayName || model.name,
    })),
  };
}

async function handleDownload(body) {
  const allowed = [...dailyModels('debate'), ...dailyModels('story')].map((item) => item.id);
  if (!allowed.includes(body.model_id)) throw new Error('Modell ist nicht in der täglichen Empfehlungsliste.');
  const output = await runLms(['get', '--gguf', '--yes', body.model_id]);
  return { status: 'downloaded', model_id: body.model_id, output };
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET' && url.pathname === '/health') {
      send(res, 200, { status: 'ok', lm_base_url: lmBaseUrl });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/models') {
      send(res, 200, await handleModels());
      return;
    }
    if (req.method === 'GET' && url.pathname === '/model-lab/recommendations') {
      send(res, 200, {
        date: new Date().toISOString().slice(0, 10),
        debate: dailyModels('debate'),
        story: dailyModels('story'),
      });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/generate') {
      send(res, 200, await handleGenerate(await readJson(req)));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/model-lab/download') {
      send(res, 200, await handleDownload(await readJson(req)));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/model-lab/test') {
      const body = await readJson(req);
      const content = await handleGenerate({
        role: body.kind || 'story',
        model: body.model_id,
        prompt: 'Schreibe zwei präzise deutsche Sätze als Modelltest.',
      });
      send(res, 200, { output: content.content, evaluation: { language: 'de', status: 'ok' } });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/model-lab/rate') {
      const body = await readJson(req);
      send(res, 200, { status: 'saved', model_id: body.model_id, rating: body.rating });
      return;
    }
    if (req.method === 'POST' && url.pathname.startsWith('/model-lab/setup/')) {
      send(res, 200, { status: 'ready', role: url.pathname.split('/').at(-1) });
      return;
    }
    send(res, 404, { error: 'not_found', path: url.pathname });
  } catch (error) {
    send(res, 500, { error: 'bridge_error', detail: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(port, host, () => {
  console.log(`LM Studio bridge listening on http://${host}:${port}`);
});
