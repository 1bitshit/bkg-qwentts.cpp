import { generateWithLM } from './lmStudio';
import { streamPcmToSpeakers, synthesizeWav } from './audioRuntime';

export interface StoryCharacter {
  id: string;
  name: string;
  role: string;
  personality: string;
  voice_description: string;
  model_name: string;
  language: string;
}

export interface StoryMessage {
  speaker_id: string;
  speaker_name: string;
  text: string;
  audio_base64: string | null;
  timestamp: string;
  scene: number;
}

export interface StoryState {
  session_id: string;
  title: string;
  premise: string;
  genre: string;
  model_name: string;
  characters: StoryCharacter[];
  messages: StoryMessage[];
  status: string;
  current_scene: number;
  volume?: number;
  max_scenes: number;
  progress?: { percent: number; label: string };
  delivery_mode?: 'live' | 'prerecorded';
}
const STORAGE_KEY = 'bkg-stories';
const listeners = new Map<string, (event: string, data: any) => void>();

function readAll(): Record<string, StoryState> {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
}

function writeAll(value: Record<string, StoryState>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

function newId() {
  return `story-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function generateStoryIdea(payload: any, _apiKey?: string) {
  const text = await generateWithLM(
    'story',
    `Erzeuge eine deutsche Story-Idee im Genre ${payload.genre}. ` +
      'Antworte in genau zwei Zeilen: Titel und anschließend Prämisse.',
  );
  const [title, ...rest] = text.split('\n').filter(Boolean);
  return {
    title: title || 'Die verlorene Stimme',
    premise: rest.join(' ') || 'Eine unerwartete Reise verändert alles.',
    genre: payload.genre,
  };
}
export async function createStory(payload: any, _apiKey?: string): Promise<StoryState> {
  const count = Math.max(1, Number(payload.character_count || 2));
  const characters: StoryCharacter[] = Array.from({ length: count }, (_, index) => ({
    id: `character_${index + 1}`,
    name: `Figur ${index + 1}`,
    role: index === 0 ? 'Hauptfigur' : 'Nebenfigur',
    personality: index === 0 ? 'neugierig und mutig' : 'eigenwillig und aufmerksam',
    voice_description: index % 2 ? 'ruhige Stimme' : 'klare Stimme',
    model_name: payload.model_name || '',
    language: 'German',
  }));
  const state: StoryState = {
    session_id: newId(),
    title: payload.title,
    premise: payload.premise,
    genre: payload.genre,
    model_name: payload.model_name || '',
    characters,
    messages: [],
    status: 'idle',
    current_scene: 0,
    volume: 1,
    max_scenes: Math.min(Number(payload.max_scenes || 12), 12),
    progress: { percent: 0, label: 'Bereit' },
    delivery_mode: payload.delivery_mode || 'live',
  };
  const all = readAll(); all[state.session_id] = state; writeAll(all);
  return state;
}
export async function listStories(_apiKey?: string) {
  return Object.values(readAll()).map((story) => ({
    session_id: story.session_id,
    title: story.title,
    status: story.status,
    message_count: story.messages.length,
    updated_at: new Date().toISOString(),
  }));
}

export async function getStory(id: string, _apiKey?: string) {
  const story = readAll()[id];
  if (!story) throw new Error('Geschichte nicht gefunden');
  return story;
}

export async function startStory(id: string, _apiKey?: string) {
  const all = readAll();
  const story = all[id];
  if (!story) throw new Error('Geschichte nicht gefunden');
  if (story.status === 'finished') {
    if ((story.volume || 1) >= 9) throw new Error('Die Reihe ist mit Band 0.9 abgeschlossen.');
    story.volume = (story.volume || 1) + 1;
    story.current_scene = 0;
  }
  story.status = 'running';
  writeAll(all);
  listeners.get(id)?.('status', { status: 'running' });
  void runStory(story);
  return story;
}

export async function stopStory(id: string, _apiKey?: string) {
  const all = readAll();
  if (all[id]) all[id].status = 'stopped';
  writeAll(all);
  return all[id];
}
async function runStory(story: StoryState) {
  try {
    for (let scene = story.current_scene + 1; scene <= story.max_scenes; scene += 1) {
      if (story.status !== 'running') return;
      const percent = Math.round((scene / story.max_scenes) * 100);
      const intensity = Math.min(0.9, Math.max(0.1, scene / story.max_scenes));
      const band = `0.${story.volume || 1}`;
      const director = await generateWithLM(
        'director',
        `Du bist Regisseur. Plane Band ${band}, Szene ${scene} für ${story.title}. Dramaturgische Intensität ${intensity.toFixed(1)} von 0.1 bis 0.9. ` +
          `Genre: ${story.genre}. Prämisse: ${story.premise}. ` +
          'Gib eine kurze Regiezeile mit Atmosphäre, Musik und Geräuschen aus.',
      );
      const history = story.messages.slice(-4).map((item) => item.text).join('\n');
      const text = await generateWithLM(
        'story',
        `Schreibe Band ${band}, Szene ${scene} der deutschen Geschichte ${story.title}. ` +
          `Prämisse: ${story.premise}. Regie: ${director}. ` +
          `Fortsetzung: ${history}. Schreibe 2 bis 4 Absätze.`,
      );
      const spokenText = text.replace(/\[REGIE:[^\]]*\]/g, '').trim();
      let audioBase64: string | null = null;
      if (story.delivery_mode === 'live') {
        await streamPcmToSpeakers({ text: spokenText, language: 'German', instructions: director });
      } else {
        audioBase64 = await synthesizeWav({ text: spokenText, language: 'German', instructions: director });
      }
      const message: StoryMessage = {
        speaker_id: 'director',
        speaker_name: 'Regie',
        text: `[BAND ${band}] [REGIE: ${director}]\n${text}`,
        audio_base64: audioBase64,
        timestamp: new Date().toISOString(),
        scene,
      };
      story.messages.push(message);
      story.current_scene = scene;
      story.progress = { percent, label: `Szene ${scene} erzeugt` };
      const all = readAll(); all[story.session_id] = story; writeAll(all);
      listeners.get(story.session_id)?.('message', message);
      listeners.get(story.session_id)?.('progress', story.progress);
    }
    story.status = 'finished';
    const all = readAll(); all[story.session_id] = story; writeAll(all);
    listeners.get(story.session_id)?.('status', { status: 'finished' });
  } catch (error) {
    listeners.get(story.session_id)?.('error', { detail: (error as Error).message });
  }
}
export function streamStory(
  id: string,
  onEvent: (event: string, data: any) => void,
): AbortController {
  const controller = new AbortController();
  listeners.set(id, onEvent);
  controller.signal.addEventListener('abort', () => listeners.delete(id));
  return controller;
}
