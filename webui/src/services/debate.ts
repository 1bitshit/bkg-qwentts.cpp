import type {
  AddSpeakerRequest,
  CreateDebateRequest,
  DebateState,
  SpeakerConfig,
} from '../types/debate';
import { generateWithLM } from './lmStudio';

const STORAGE_KEY = 'bkg-debates';
const listeners = new Map<string, (event: string, data: any) => void>();

function readAll(): Record<string, DebateState> {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
}

function writeAll(value: Record<string, DebateState>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

function sessionId() {
  return `debate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function listDebateSessions(_apiKey?: string) {
  return Object.values(readAll()).map((session) => ({
    session_id: session.session_id,
    topic: session.topic,
    status: session.status,
    message_count: session.messages.length,
    updated_at: new Date().toISOString(),
  }));
}
export async function generateDebateIdea(category: string, _apiKey?: string) {
  const text = await generateWithLM(
    'debate',
    `Erzeuge ein anspruchsvolles deutsches Debattenthema zur Kategorie ${category}. ` +
      'Antworte in genau zwei Zeilen: zuerst das Thema, dann ein kurzer Teaser.',
  );
  const [topic, ...rest] = text.split('\n').filter(Boolean);
  return {
    topic: topic || `Sollte ${category} stärker reguliert werden?`,
    teaser: rest.join(' ') || 'Zwei Positionen prallen aufeinander.',
    category,
  };
}

export async function createDebate(req: CreateDebateRequest, _apiKey?: string) {
  const state: DebateState = {
    session_id: sessionId(),
    topic: req.topic,
    category: req.category,
    teaser: req.teaser,
    speakers: req.speakers,
    messages: [],
    status: 'idle',
    current_round: 0,
    current_speaker_index: 0,
    max_rounds: req.max_rounds,
    auto_advance: req.auto_advance,
  };
  const all = readAll();
  all[state.session_id] = state;
  writeAll(all);
  return state;
}
export async function startDebate(id: string, _apiKey?: string) {
  const all = readAll();
  const state = all[id];
  if (!state) throw new Error('Debatte nicht gefunden');
  state.status = 'running';
  writeAll(all);
  listeners.get(id)?.('status', { status: 'running', lm_studio_connected: true });

  void runDebate(state);
  return state;
}

async function runDebate(state: DebateState) {
  try {
    for (let round = Math.max(1, state.current_round + 1); round <= state.max_rounds; round += 1) {
      const intro = await generateWithLM('director', `Du bist ein charismatischer deutscher Talkmaster der 1990er. Leite Runde ${round} zum Thema ${state.topic} in 1 bis 2 pointierten Sätzen ein.`);
      const hostMessage = { speaker_id: 'talkmaster', speaker_name: 'Talkmaster', text: intro, audio_base64: null, timestamp: new Date().toISOString(), round };
      state.messages.push(hostMessage);
      listeners.get(state.session_id)?.('message', hostMessage);
      listeners.get(state.session_id)?.('cue', { type: 'applause', intensity: 0.55 });
      for (const speaker of state.speakers) {
        if (state.status !== 'running') return;
        listeners.get(state.session_id)?.('turn', { speaker_id: speaker.id, round });
        const history = state.messages.slice(-8)
          .map((message) => `${message.speaker_name}: ${message.text}`)
          .join('\n');
        const prompt = `Du bist ${speaker.name}. Persönlichkeit: ${speaker.personality}. ` +
          `Thema: ${state.topic}. Antworte in 2 bis 4 deutschen Sätzen. Verlauf:\n${history}`;
        const text = await generateWithLM('debate', prompt);
        const message = {
          speaker_id: speaker.id,
          speaker_name: speaker.name,
          text,
          audio_base64: null,
          timestamp: new Date().toISOString(),
          round,
        };
        state.messages.push(message);
        state.current_round = round;
        const all = readAll();
        all[state.session_id] = state;
        writeAll(all);
        listeners.get(state.session_id)?.('message', message);
      }
    }
    state.status = 'finished';
    const all = readAll();
    all[state.session_id] = state;
    writeAll(all);
    listeners.get(state.session_id)?.('status', { status: 'finished' });
  } catch (error) {
    listeners.get(state.session_id)?.('error', {
      detail: (error as Error).message,
    });
  }
}

export async function stopDebate(id: string, _apiKey?: string) {
  const all = readAll();
  if (all[id]) all[id].status = 'stopped';
  writeAll(all);
  return all[id];
}

export async function getDebate(id: string) {
  const state = readAll()[id];
  if (!state) throw new Error('Debatte nicht gefunden');
  return state;
}
export async function addSpeaker(id: string, req: AddSpeakerRequest, _apiKey?: string) {
  const all = readAll();
  const state = all[id];
  const speaker = {
    ...req,
    id: `speaker_${state.speakers.length}`,
  } as SpeakerConfig;
  state.speakers.push(speaker);
  writeAll(all);
  return state;
}

export async function removeSpeaker(id: string, speakerId: string, _apiKey?: string) {
  const all = readAll();
  all[id].speakers = all[id].speakers.filter((speaker) => speaker.id !== speakerId);
  writeAll(all);
  return all[id];
}

export async function updateSpeaker(id: string, speakerId: string, req: AddSpeakerRequest, _apiKey?: string) {
  const all = readAll();
  all[id].speakers = all[id].speakers.map((speaker) =>
    speaker.id === speakerId ? { ...speaker, ...req } : speaker,
  );
  writeAll(all);
  return all[id];
}

export function streamDebate(id: string, onEvent: (event: string, data: any) => void) {
  const controller = new AbortController();
  listeners.set(id, onEvent);
  controller.signal.addEventListener('abort', () => listeners.delete(id));
  return controller;
}

export async function submitAudienceQuestion(id: string, question: string) {
  const all = readAll();
  const state = all[id];
  if (!state) throw new Error('Debatte nicht gefunden');
  const round = Math.max(1, state.current_round);
  const hostText = await generateWithLM(
    'director',
    `Du bist Talkmaster einer deutschen 90er-Talkshow. Eine Person aus dem Publikum fragt: ${question}. Formuliere die Frage kurz und fordere alle Gäste nacheinander zur Stellungnahme auf.`,
  );
  const host = { speaker_id: 'talkmaster', speaker_name: 'Talkmaster', text: hostText, audio_base64: null, timestamp: new Date().toISOString(), round };
  state.messages.push(host);
  listeners.get(id)?.('message', host);
  listeners.get(id)?.('cue', { type: 'applause', intensity: 0.35 });
  for (const speaker of state.speakers) {
    const text = await generateWithLM('debate', `Du bist ${speaker.name}. Persönlichkeit: ${speaker.personality}. Beantworte diese Publikumsfrage zur laufenden Debatte in 2 bis 3 klaren deutschen Sätzen: ${question}`);
    const message = { speaker_id: speaker.id, speaker_name: speaker.name, text, audio_base64: null, timestamp: new Date().toISOString(), round };
    state.messages.push(message);
    listeners.get(id)?.('message', message);
  }
  all[id] = state;
  writeAll(all);
  return state;
}
