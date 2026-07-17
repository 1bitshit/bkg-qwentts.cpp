import type {
  AddSpeakerRequest,
  CreateDebateRequest,
  DebateState,
  SpeakerConfig,
} from '../types/debate';
import { generateWithLM } from './lmStudio';
import { streamPcmToSpeakers, synthesizeWav } from './audioRuntime';

const STORAGE_KEY = 'bkg-radio-talkshows';
const GUEST_ARCHIVE_KEY = 'bkg-radio-talkshow-guests';
const AUDIENCE_ARCHIVE_KEY = 'bkg-radio-talkshow-audience';
const HOST_VOICE = 'aiden';
const listeners = new Map<string, (event: string, data: any) => void>();

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(binary);
}

function slug(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

async function prepareDesignedVoice(name: string, description: string, language: string, baseVoice: string): Promise<{ archiveId: string; baseVoice: string }> {
  const sample = `Guten Abend. Ich bin ${name} und freue mich auf diese Radio Talk Show.`;
  const speech = await fetch('/v1/audio/speech', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: sample, voice: baseVoice, language, instructions: description, response_format: 'wav' }),
  });
  if (!speech.ok) throw new Error(await speech.text());
  await speech.arrayBuffer();
  return { archiveId: `guest_${slug(name)}_${Date.now().toString(36)}`, baseVoice };
}

async function ensureHostVoice(): Promise<void> {
  const response = await fetch('/v1/audio/speech', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: 'Willkommen zurück bei Back to the 90.', voice: HOST_VOICE, language: 'German',
      instructions: 'Warmer, souveräner deutscher Radio-Moderator der 1990er, charmant, pointiert und professionell.',
      response_format: 'wav',
    }),
  });
  if (!response.ok) throw new Error(await response.text());
  await response.arrayBuffer();
}

export async function listTtsVoices(): Promise<string[]> {
  const response = await fetch('/v1/voices');
  if (!response.ok) throw new Error(await response.text());
  const data = await response.json();
  return (data.voices || []).map((v: any) => String(v.name)).filter(Boolean);
}

function extractJson(text: string): any {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('KI hat keine gültige Gästeliste geliefert.');
  return JSON.parse(match[0]);
}

export async function generateRandomGuests(count: number, language: string, topic: string): Promise<SpeakerConfig[]> {
  await ensureHostVoice();
  const raw = await generateWithLM('debate', `Erzeuge ${count} deutlich unterschiedliche, thematisch passende Gäste für eine deutsche Radio-Talkshow der 1990er zum Thema "${topic}". Die Besetzung muss echte Gegensätze enthalten: direkt Betroffene, Angehörige, Fachleute, Befürworter und entschiedene Gegner. Alter, Herkunft, Beruf, Lebensstil und soziale Perspektive müssen zum Thema passen. Queere Figuren dürfen vorkommen, wenn es zum Thema passt, aber niemals als Karikatur. Antworte ausschließlich als JSON-Array. Jedes Objekt braucht name, age, origin, occupation, motto, tagline, personality, position, biography, voice_description und emotion_profile. tagline ist ein kurzer wiedererkennbarer Satz, den die Figur häufig benutzt, zum Beispiel "Kann ich überhaupt nicht nachvollziehen" oder "Ich habe mein ganzes Leben nach Regeln gelebt". voice_description beschreibt eine einzigartige natürliche Stimme passend zu Alter, Herkunft, Persönlichkeit und Lebensgeschichte. emotion_profile beschreibt konkret, wann die Person lacht, seufzt, wütend, nervös, beschämt, verletzt oder traurig reagiert.`);
  const rows = extractJson(raw).slice(0, count);
  const baseVoices = ['vivian', 'ryan', 'serena', 'aiden', 'dylan', 'sohee'];
  const archive = JSON.parse(localStorage.getItem(GUEST_ARCHIVE_KEY) || '[]');
  const guests: SpeakerConfig[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const name = String(row.name || `Gast ${index + 1}`);
    const description = String(row.voice_description || `${row.personality || 'markant und natürlich'}, klare Radiostimme`);
    const designed = await prepareDesignedVoice(name, description, language, baseVoices[index % baseVoices.length]);
    const guest: SpeakerConfig = {
      id: `speaker_${Date.now()}_${index}`, name, age: Number(row.age || 35),
      origin: String(row.origin || 'Deutschland'), occupation: String(row.occupation || 'Gast'),
      motto: String(row.motto || row.tagline || 'Ich sage, was ich denke.'), tagline: String(row.tagline || row.motto || 'Ich sage, was ich denke.'), position: String(row.position || ''), biography: String(row.biography || ''), personality: String(row.personality || 'direkt und meinungsstark'),
      emotion_profile: String(row.emotion_profile || 'reagiert lebhaft und glaubwürdig auf Zustimmung und Kritik'),
      model_name: '', voice_description: description, language, voice_prompt_id: designed.archiveId, voice_archive_id: designed.archiveId, voice: designed.baseVoice,
    };
    guests.push(guest);
    archive.push({ ...guest, created_at: new Date().toISOString(), appearances: 0 });
  }
  localStorage.setItem(GUEST_ARCHIVE_KEY, JSON.stringify(archive));
  return guests;
}


type AudienceMember = { id: string; name: string; tagline: string; personality: string; voice_description: string; voice: string; appearances: number; status: 'audience' | 'regular' | 'guest_candidate' };

async function ensureAudienceCast(topic: string): Promise<AudienceMember[]> {
  const stored: AudienceMember[] = JSON.parse(localStorage.getItem(AUDIENCE_ARCHIVE_KEY) || '[]');
  const reusable = stored.filter((m) => m.status !== 'guest_candidate').slice(0, 3);
  if (reusable.length === 3) return reusable;
  const raw = await generateWithLM('debate', `Erzeuge genau 3 fiktive erwachsene Personen für das Studiopublikum einer deutschen 90er-Radio-Talkshow zum Thema "${topic}". Eine neugierig, eine moralisch empört, eine frech provozierend. Nur JSON-Array mit name, tagline, personality, voice_description.`);
  const rows = extractJson(raw).slice(0, 3);
  const voices = ['vivian', 'ryan', 'serena'];
  const created = rows.map((row: any, i: number): AudienceMember => ({ id: `audience_${slug(String(row.name || `Publikum ${i+1}`))}_${Date.now().toString(36)}`, name: String(row.name || `Publikum ${i+1}`), tagline: String(row.tagline || 'Das kann doch nicht wahr sein!'), personality: String(row.personality || 'direkt und reaktionsschnell'), voice_description: String(row.voice_description || 'markante spontane Stimme aus dem Studiopublikum'), voice: voices[i % voices.length], appearances: 0, status: 'audience' }));
  localStorage.setItem(AUDIENCE_ARCHIVE_KEY, JSON.stringify([...stored, ...created]));
  return created;
}

function advanceAudience(member: AudienceMember): AudienceMember {
  const appearances = member.appearances + 1;
  const status: AudienceMember['status'] = appearances >= 8 ? 'guest_candidate' : appearances >= 3 ? 'regular' : 'audience';
  const updated = { ...member, appearances, status };
  const all: AudienceMember[] = JSON.parse(localStorage.getItem(AUDIENCE_ARCHIVE_KEY) || '[]');
  localStorage.setItem(AUDIENCE_ARCHIVE_KEY, JSON.stringify(all.map((x) => x.id === updated.id ? updated : x)));
  return updated;
}

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
    `Erzeuge ein maximal reißerisches, absurdes Thema für eine fiktive deutsche Nachmittags-Radio-Talkshow der 1990er zur Kategorie ${category}. Nutze die historische Affekt-Talk-Logik: intime Beichte, geheimes Doppelleben, Seitensprung, Stiefbeziehung zwischen Erwachsenen, Fetisch, Sexpuppen, Swingerdrama, Escort-Geheimnis, Intimpiercing, Pornokonsum, Vaterschaftsstreit, Schönheitswahn, peinliche Familienenthüllung oder groteske Lebensentscheidung. Lege drei Schippen drauf: Der Titel muss ein schockierendes Geständnis enthalten, der Teaser eine verborgene zweite Enthüllung andeuten und ein später Gast muss den Konflikt persönlich eskalieren. Alle Figuren sind fiktive Erwachsene. Keine Minderjährigen, Tiere, Zwang, sexualisierte Gewalt oder reale Personen. ` +
      'Antworte in genau zwei Zeilen: zuerst ein sensationsheischender Sendungstitel als direkte Ich-Beichte oder Frage, dann ein kurzer Teaser mit angekündigter Enthüllung.',
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
    delivery_mode: req.delivery_mode,
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
  state.delivery_mode = state.delivery_mode || 'prerecorded';
  state.speakers = (state.speakers || []).filter(Boolean).map((speaker, index) => ({
    id: speaker.id || `speaker_${index + 1}`,
    name: speaker.name || `Gast ${index + 1}`,
    personality: speaker.personality || 'sachlich und meinungsstark',
    model_name: speaker.model_name || '',
    voice_description: speaker.voice_description || 'klare deutsche Stimme',
    language: speaker.language || 'German',
    voice_prompt_id: speaker.voice_prompt_id || '',
    voice: speaker.voice || speaker.voice_archive_id || '',
    age: speaker.age || 35,
    origin: speaker.origin || 'Deutschland',
    occupation: speaker.occupation || 'Gast',
    motto: speaker.motto || 'Ich sage, was ich denke.',
  }));
  if (state.speakers.length < 2) throw new Error('Mindestens zwei gültige Gäste werden benötigt.');
  state.status = 'running';
  writeAll(all);
  listeners.get(id)?.('status', { status: 'running', lm_studio_connected: true });

  void runDebate(state);
  return state;
}


async function addAudio(state: DebateState, text: string, instructions: string, voice: string, language = 'German'): Promise<string | null> {
  try {
    listeners.get(state.session_id)?.('progress', {
      percent: state.delivery_mode === 'live' ? 65 : 72,
      label: state.delivery_mode === 'live' ? 'Audio wird live gestreamt' : 'WAV wird vorproduziert',
    });
    if (state.delivery_mode === 'live') {
      await streamPcmToSpeakers({ text, voice, language, instructions });
      return null;
    }
    return await synthesizeWav({ text, voice, language, instructions });
  } catch (error) {
    listeners.get(state.session_id)?.('audio_error', {
      detail: (error as Error).message,
    });
    return null;
  }
}

function cleanRadioSpeech(text: string): string {
  return text
    .replace(/[„“”]/g, '')
    .replace(/^\s*['"]|['"]\s*$/g, '')
    .replace(/\*[^*]+\*/g, '')
    .replace(/\([^)]*(lacht|seufzt|weint|schmunzelt|blickt|rollt|zeigt|flüstert)[^)]*\)/gi, '')
    .replace(/(sage ich|sagt er|sagt sie|während ich|während er|während sie|meine Augen|seine Augen|ihre Augen|zwischen den Fingern|ich blicke|ich rolle)[^.!?]*[.!?]?/gi, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

async function runDebate(state: DebateState) {
  try {
    const totalSegments = Math.min(state.speakers.length, state.max_rounds || state.speakers.length);
    const audienceCast = await ensureAudienceCast(state.topic);
    const guestStage = new Map<string, string>();
    for (let segment = Math.max(1, state.current_round + 1); segment <= totalSegments; segment += 1) {
      const minuteStart = (segment - 1) * 6;
      const minuteEnd = segment * 6;
      const activeGuests = state.speakers.slice(0, segment);
      const newcomer = activeGuests[activeGuests.length - 1];

      listeners.get(state.session_id)?.('progress', {
        percent: Math.round((segment - 1) / totalSegments * 100),
        label: `Minute ${minuteStart}–${minuteEnd}: ${newcomer.name} kommt in die Sendung`,
      });

      const introPrompt = segment === 1
        ? `Du bist ein charismatischer deutscher Radio-Moderator der 1990er. Eröffne die Sendung zum Thema ${state.topic}. Stelle ${newcomer.name} als ersten Gast vor. Genau ein kurzer gesprochener Absatz. Keine Regieanweisungen.`
        : `Du bist ein charismatischer deutscher Radio-Moderator der 1990er. Die Sendung zum Thema ${state.topic} läuft bereits. Begrüße nun ${newcomer.name} als neuen Gast für Minute ${minuteStart} bis ${minuteEnd}. Erwähne kurz, welche neue Perspektive diese Person einbringt. Keine zweite Sendungsbegrüßung, keine Regieanweisungen.`;
      const intro = cleanRadioSpeech(await generateWithLM('director', introPrompt));
      const hostAudio = await addAudio(state, intro, 'Charismatischer deutscher Radio-Moderator der 1990er, warm, pointiert und präsent.', HOST_VOICE, 'German');
      const hostMessage = { speaker_id: 'talkmaster', speaker_name: 'Talkmaster', text: intro, audio_base64: hostAudio, timestamp: new Date().toISOString(), round: segment };
      state.messages.push(hostMessage);
      listeners.get(state.session_id)?.('message', hostMessage);
      listeners.get(state.session_id)?.('cue', { type: 'applause', intensity: 0.4 });

      const audienceRoles = [
        { kind: 'Frage', prompt: `Stelle ${newcomer.name} eine kurze, freche und persönliche Frage zum Thema ${state.topic}.` },
        { kind: 'Zwischenruf', prompt: `Rufe maximal 10 Wörter spontan in die laufende Diskussion. Direkt und emotional.` },
        { kind: 'Reaktion', prompt: `Rufe maximal 8 Wörter als Zustimmung, Empörung oder Buhruf passend zum Verlauf.` },
      ];
      for (let track = 0; track < 3; track += 1) {
        const member = advanceAudience(audienceCast[track]);
        audienceCast[track] = member;
        const history = state.messages.slice(-6).map((m) => `${m.speaker_name}: ${m.text}`).join('\n');
        const audienceText = cleanRadioSpeech(await generateWithLM('director', `Du bist ${member.name} im Studiopublikum. Persönlichkeit: ${member.personality}. Wiederkehrender Spruch: ${member.tagline}. ${audienceRoles[track].prompt} Keine Regieanweisung. Nur gesprochener Text. Verlauf:\n${history}`));
        const audienceAudio = await addAudio(state, audienceText, `${member.voice_description}. ${track === 1 ? 'Ruft spontan dazwischen, lauter und aufgebracht.' : track === 2 ? 'Kurzer emotionaler Publikumsruf.' : 'Direkte neugierige Publikumsfrage.'}`, member.voice, 'German');
        const audienceMessage = { speaker_id: member.id, speaker_name: `${member.name} · ${audienceRoles[track].kind}`, text: audienceText, audio_base64: audienceAudio, timestamp: new Date().toISOString(), round: segment };
        state.messages.push(audienceMessage);
        listeners.get(state.session_id)?.('message', audienceMessage);
      }

      for (const speaker of activeGuests) {
        if (state.status !== 'running') return;
        listeners.get(state.session_id)?.('turn', { speaker_id: speaker.id, speaker_name: speaker.name, round: segment });
        const history = state.messages.slice(-10).map((message) => `${message.speaker_name}: ${message.text}`).join('\n');
        const escalation = segment === totalSegments
          ? 'Finale Eskalation: Sprich laut, persönlich und wütend. Unterbrich gedanklich die anderen, wirf ihnen Heuchelei, Lügen oder Feigheit vor und benutze harte, aber nicht diskriminierende Beleidigungen. Es soll kurz vor einer Schlägerei wirken.'
          : segment >= Math.ceil(totalSegments / 2)
            ? 'Die Diskussion kippt: werde persönlicher, konfrontativer und greife konkrete Widersprüche der anderen Gäste an.'
            : 'Bleibe zunächst pointiert, aber noch kontrolliert.';
        const priorStage = guestStage.get(speaker.id) || 'normal';
        const stageRoll = Math.random();
        const stage = priorStage === 'normal' && stageRoll < 0.22 ? 'verwarnt' : priorStage === 'verwarnt' && stageRoll < 0.38 ? 'studioverweis' : priorStage === 'studioverweis' ? 'draußen' : priorStage === 'draußen' && stageRoll < 0.55 ? 'rückkehrversuch' : priorStage;
        guestStage.set(speaker.id, stage);
        if (stage === 'studioverweis') listeners.get(state.session_id)?.('cue', { type: 'studio_walkout', intensity: 0.82 });
        if (stage === 'rückkehrversuch') listeners.get(state.session_id)?.('cue', { type: 'studio_return', intensity: 0.9 });
        const stageInstruction = stage === 'verwarnt' ? 'Der Moderator hat dich gerade verwarnt. Reagiere empört und uneinsichtig.' : stage === 'studioverweis' ? 'Du wirst gerade des Studios verwiesen. Protestiere laut, aber drohe niemandem.' : stage === 'draußen' ? 'Du bist außerhalb des Studios und rufst noch einen kurzen Satz durch die Tür.' : stage === 'rückkehrversuch' ? 'Du bist wieder hereingestürmt und verlangst laut, weiterreden zu dürfen.' : 'Du bist noch im Studio.';
        const prompt = `Du bist ${speaker.name}. Biografie: ${speaker.biography || 'nicht angegeben'}. Position: ${speaker.position || 'eigene klare Haltung'}. Persönlichkeit: ${speaker.personality}. Wiederkehrende Tagline: ${speaker.tagline || speaker.motto || ''}. Emotionale Reaktionen: ${speaker.emotion_profile || 'natürlich und glaubwürdig'}. Thema: ${state.topic}. Dies ist Sendeminute ${minuteStart} bis ${minuteEnd}. Sprich wie in einer echten deutschen Radio-Talkshow der 1990er. ${stageInstruction} ${escalation} Antworte in 2 bis 4 gesprochenen Sätzen. Reagiere direkt auf den bisherigen Verlauf und die anderen anwesenden Gäste. Nutze die Tagline nur gelegentlich. Keine Regieanweisungen, keine Erzählprosa, keine sichtbaren Handlungen. Verlauf:\n${history}`;
        const text = cleanRadioSpeech(await generateWithLM('debate', prompt));
        const emotion = speaker.emotion_profile || 'reagiert emotional und glaubwürdig';
        const audio = await addAudio(state, text, `${speaker.voice_description}. ${emotion}.`, speaker.voice || '', speaker.language || 'German');
        const message = { speaker_id: speaker.id, speaker_name: speaker.name, text, audio_base64: audio, timestamp: new Date().toISOString(), round: segment };
        state.messages.push(message);
        listeners.get(state.session_id)?.('message', message);
      }

      state.current_round = segment;
      const all = readAll();
      all[state.session_id] = state;
      writeAll(all);
      if (segment === totalSegments) {
        listeners.get(state.session_id)?.('cue', { type: 'studio_chaos', intensity: 0.95 });
        const shutdown = cleanRadioSpeech(await generateWithLM('director', `Du bist der überforderte Moderator dieser fiktiven 90er-Radio-Talkshow. Brich die Sendung abrupt ab, rufe den Sicherheitsdienst und sage in zwei kurzen Sätzen, dass diese KI-Rückblende zeigen soll, wie absurd und entwürdigend damaliger Affekt-Talk war. Keine Regieanweisungen.`));
        const shutdownAudio = await addAudio(state, shutdown, 'Überforderter Radio-Moderator, laut, angespannt, versucht die Kontrolle zurückzugewinnen.', HOST_VOICE, 'German');
        const shutdownMessage = { speaker_id: 'talkmaster', speaker_name: 'Talkmaster', text: shutdown, audio_base64: shutdownAudio, timestamp: new Date().toISOString(), round: segment };
        state.messages.push(shutdownMessage);
        listeners.get(state.session_id)?.('message', shutdownMessage);
      }
      listeners.get(state.session_id)?.('progress', {
        percent: Math.round(segment / totalSegments * 100),
        label: `${minuteEnd} von ${totalSegments * 6} Sendeminuten abgeschlossen`,
      });
    }
    state.status = 'finished';
    const all = readAll();
    all[state.session_id] = state;
    writeAll(all);
    listeners.get(state.session_id)?.('status', { status: 'finished' });
  } catch (error) {
    state.status = 'stopped';
    const all = readAll(); all[state.session_id] = state; writeAll(all);
    listeners.get(state.session_id)?.('error', { detail: (error as Error).message });
  }
}

export async function updateDeliveryMode(id: string, mode: 'live' | 'prerecorded') {
  const all = readAll();
  const state = all[id];
  if (!state) throw new Error('Debatte nicht gefunden');
  if (state.status === 'running') throw new Error('Während einer laufenden Debatte kann der Audiomodus nicht geändert werden.');
  state.delivery_mode = mode;
  all[id] = state;
  writeAll(all);
  return state;
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
  const hostText = cleanRadioSpeech(await generateWithLM(
    'director',
    `Du bist Moderator einer deutschen Radio Talk Show der 1990er. Eine Person aus dem Publikum fragt: ${question}. Formuliere die Frage in einem kurzen gesprochenen Absatz und fordere die Gäste zur Stellungnahme auf. Keine Anführungszeichen, keine Regieanweisungen und keine sichtbaren Handlungen.`,
  ));
  const hostAudio = await addAudio(state, hostText, 'Charismatischer deutscher Radio-Moderator der 1990er, warm, pointiert und präsent.', HOST_VOICE, 'German');
  const host = { speaker_id: 'talkmaster', speaker_name: 'Talkmaster', text: hostText, audio_base64: hostAudio, timestamp: new Date().toISOString(), round };
  state.messages.push(host);
  listeners.get(id)?.('message', host);
  listeners.get(id)?.('cue', { type: 'applause', intensity: 0.35 });
  for (const speaker of state.speakers) {
    const text = await generateWithLM('debate', `Du bist ${speaker.name}. Persönlichkeit: ${speaker.personality}. Beantworte diese Publikumsfrage zur laufenden Debatte in 2 bis 3 klaren deutschen Sätzen: ${question}`);
    const emotion = speaker.emotion_profile || 'reagiert emotional und glaubwürdig';
        const audio = await addAudio(state, text, `${speaker.voice_description}. ${emotion}. Nutze passende Ausdrucksformen wie [laugh], [sigh], [crying], [anger] oder [fear], wenn der Gesprächsverlauf es rechtfertigt.`, speaker.voice || '', speaker.language || 'German');
    const message = { speaker_id: speaker.id, speaker_name: speaker.name, text, audio_base64: audio, timestamp: new Date().toISOString(), round };
    state.messages.push(message);
    listeners.get(id)?.('message', message);
  }
  all[id] = state;
  writeAll(all);
  return state;
}
