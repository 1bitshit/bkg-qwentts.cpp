import type { DebateMessage } from '../types/debate';

type DecodedMessage = {
  message: DebateMessage;
  buffer: AudioBuffer;
};

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function isOverlay(message: DebateMessage): boolean {
  return message.speaker_name.includes('Zwischenruf') ||
    message.speaker_name.includes('Reaktion');
}

function isGuest(message: DebateMessage): boolean {
  return !message.speaker_name.startsWith('Talkmaster') &&
    !message.speaker_name.includes('Publikum') &&
    !message.speaker_name.includes('Frage') &&
    !isOverlay(message);
}
function connectTrack(
  context: AudioContext,
  buffer: AudioBuffer,
  startAt: number,
  gainValue: number,
  panValue: number,
): AudioBufferSourceNode {
  const source = context.createBufferSource();
  const gain = context.createGain();
  const panner = context.createStereoPanner();
  source.buffer = buffer;
  gain.gain.value = gainValue;
  panner.pan.value = panValue;
  source.connect(gain).connect(panner).connect(context.destination);
  source.start(startAt);
  return source;
}

async function decodeMessages(
  context: AudioContext,
  messages: DebateMessage[],
): Promise<DecodedMessage[]> {
  const decoded: DecodedMessage[] = [];
  for (const message of messages) {
    if (!message.audio_base64) continue;
    const data = base64ToArrayBuffer(message.audio_base64);
    const buffer = await context.decodeAudioData(data.slice(0));
    decoded.push({ message, buffer });
  }
  return decoded;
}
export async function playTalkshowTimeline(
  messages: DebateMessage[],
): Promise<void> {
  const context = new AudioContext();
  if (context.state === 'suspended') await context.resume();
  const decoded = await decodeMessages(context, messages);
  const pendingOverlays: DecodedMessage[] = [];
  const sources: AudioBufferSourceNode[] = [];
  let cursor = context.currentTime + 0.12;
  let endAt = cursor;

  for (const item of decoded) {
    if (isOverlay(item.message)) {
      pendingOverlays.push(item);
      continue;
    }

    const moderator = item.message.speaker_name.startsWith('Talkmaster');
    const question = item.message.speaker_name.includes('Frage');
    const pan = moderator ? 0 : question ? -0.35 : 0.12;
    const gain = moderator ? 0.92 : question ? 0.78 : 0.88;
    sources.push(connectTrack(context, item.buffer, cursor, gain, pan));

    if (isGuest(item.message) && pendingOverlays.length > 0) {
      pendingOverlays.slice(0, 3).forEach((overlay, index) => {
        const fraction = [0.28, 0.54, 0.72][index] ?? 0.5;
        const overlayAt = cursor + Math.min(
          Math.max(0.55, item.buffer.duration * fraction),
          Math.max(0.6, item.buffer.duration - 0.35),
        );
        const overlayPan = index % 2 === 0 ? -0.72 : 0.72;
        sources.push(connectTrack(context, overlay.buffer, overlayAt, 0.52, overlayPan));
        endAt = Math.max(endAt, overlayAt + overlay.buffer.duration);
      });
      pendingOverlays.length = 0;
    }

    endAt = Math.max(endAt, cursor + item.buffer.duration);
    cursor += item.buffer.duration + (moderator ? 0.08 : 0.14);
  }

  pendingOverlays.forEach((overlay, index) => {
    const at = cursor + index * 0.18;
    sources.push(connectTrack(context, overlay.buffer, at, 0.48, index % 2 ? 0.7 : -0.7));
    endAt = Math.max(endAt, at + overlay.buffer.duration);
  });

  await new Promise<void>((resolve) => {
    const waitMs = Math.max(0, (endAt - context.currentTime) * 1000 + 120);
    window.setTimeout(() => {
      sources.forEach(source => { try { source.stop(); } catch { /* already ended */ } });
      void context.close();
      resolve();
    }, waitMs);
  });
}
