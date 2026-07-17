const BASE = '';
const FALLBACK_VOICE = 'ryan';

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 32768) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  }
  return btoa(binary);
}

export type SpeechRequest = {
  text: string;
  voice?: string;
  language?: string;
  instructions?: string;
  speed?: number;
};

export async function synthesizeWav(req: SpeechRequest): Promise<string> {
  const response = await fetch(`${BASE}/v1/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: req.text,
      voice: (req.voice || FALLBACK_VOICE).toLowerCase(),
      language: req.language || 'German',
      instructions: req.instructions,
      speed: req.speed,
      response_format: 'wav',
    }),
  });
  if (!response.ok) throw new Error(await response.text());
  return bytesToBase64(new Uint8Array(await response.arrayBuffer()));
}
let radioAudioQueue: Promise<void> = Promise.resolve();

async function playPcmSerial(req: SpeechRequest): Promise<void> {
  const response = await fetch(`${BASE}/v1/audio/speech`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: req.text, voice: (req.voice || FALLBACK_VOICE).toLowerCase(),
      language: req.language || 'German', instructions: req.instructions,
      speed: req.speed, response_format: 'pcm' }),
  });
  if (!response.ok) throw new Error(await response.text());
  const bytes = new Uint8Array(await response.arrayBuffer());
  const usable = bytes.byteLength - (bytes.byteLength % 2);
  if (!usable) return;
  const context = new AudioContext({ sampleRate: 24000 });
  if (context.state === 'suspended') await context.resume();
  const sampleCount = usable / 2;
  const buffer = context.createBuffer(1, sampleCount, 24000);
  const channel = buffer.getChannelData(0);
  const view = new DataView(bytes.buffer, bytes.byteOffset, usable);
  for (let i = 0; i < sampleCount; i += 1) channel[i] = view.getInt16(i * 2, true) / 32768;
  await new Promise<void>((resolve, reject) => {
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.onended = () => { void context.close(); resolve(); };
    try { source.start(); } catch (error) { void context.close(); reject(error); }
  });
}

export async function streamPcmToSpeakers(req: SpeechRequest): Promise<void> {
  const queued = radioAudioQueue.then(() => playPcmSerial(req));
  radioAudioQueue = queued.catch(() => undefined);
  return queued;
}

export async function playPcmProducer(
  producer: (onChunk: (chunk: Uint8Array) => void) => Promise<void>,
): Promise<void> {
  const context = new AudioContext({ sampleRate: 24000 });
  let nextStart = context.currentTime + 0.08;
  await producer((chunk) => {
    const sampleCount = Math.floor(chunk.byteLength / 2);
    if (!sampleCount) return;
    const audioBuffer = context.createBuffer(1, sampleCount, 24000);
    const channel = audioBuffer.getChannelData(0);
    const view = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    for (let i = 0; i < sampleCount; i += 1) {
      channel[i] = view.getInt16(i * 2, true) / 32768;
    }
    const source = context.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(context.destination);
    nextStart = Math.max(nextStart, context.currentTime + 0.03);
    source.start(nextStart);
    nextStart += audioBuffer.duration;
  });
}
