const BASE = '';

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
      voice: req.voice,
      language: req.language || 'German',
      instructions: req.instructions,
      speed: req.speed,
      response_format: 'wav',
    }),
  });
  if (!response.ok) throw new Error(await response.text());
  return bytesToBase64(new Uint8Array(await response.arrayBuffer()));
}
export async function streamPcmToSpeakers(req: SpeechRequest): Promise<void> {
  const response = await fetch(`${BASE}/v1/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: req.text,
      voice: req.voice,
      language: req.language || 'German',
      instructions: req.instructions,
      speed: req.speed,
      response_format: 'pcm',
    }),
  });
  if (!response.ok || !response.body) throw new Error(await response.text());

  const context = new AudioContext({ sampleRate: 24000 });
  const reader = response.body.getReader();
  let nextStart = context.currentTime + 0.08;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value?.byteLength) continue;
    const sampleCount = Math.floor(value.byteLength / 2);
    const audioBuffer = context.createBuffer(1, sampleCount, 24000);
    const channel = audioBuffer.getChannelData(0);
    const view = new DataView(value.buffer, value.byteOffset, value.byteLength);
    for (let i = 0; i < sampleCount; i += 1) channel[i] = view.getInt16(i * 2, true) / 32768;
    const source = context.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(context.destination);
    nextStart = Math.max(nextStart, context.currentTime + 0.03);
    source.start(nextStart);
    nextStart += audioBuffer.duration;
  }
}
