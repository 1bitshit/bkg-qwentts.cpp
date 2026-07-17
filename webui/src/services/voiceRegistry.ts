export interface VoiceProfileRequest {
  id: string;
  displayName: string;
  description: string;
  refText: string;
  domain: 'talkshow' | 'story' | 'shared';
  language?: string;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  }
  return btoa(binary);
}

export function stableVoiceId(domain: string, name: string, description: string): string {
  const source = `${domain}:${name}:${description}`;
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const slug = name.toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '') || 'voice';
  return `${domain}_${slug}_${(hash >>> 0).toString(36)}`;
}

async function listVoiceIds(): Promise<Set<string>> {
  const response = await fetch('/v1/audio/voices');
  if (!response.ok) throw new Error(await response.text());
  const payload = await response.json();
  return new Set((payload.voices || []).map((voice: any) => String(voice.name)));
}

async function designReference(profile: VoiceProfileRequest): Promise<string> {
  const response = await fetch('/v1/studio/audio/speech', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: profile.refText,
      language: profile.language || 'German',
      instructions: profile.description,
      response_format: 'wav',
    }),
  });
  if (!response.ok) throw new Error(await response.text());
  return bytesToBase64(new Uint8Array(await response.arrayBuffer()));
}

async function registerReference(profile: VoiceProfileRequest, wavBase64: string): Promise<void> {
  const response = await fetch('/v1/audio/voices', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: profile.id,
      display_name: profile.displayName,
      description: profile.description,
      domain: profile.domain,
      ref_text: profile.refText,
      wav_b64: wavBase64,
    }),
  });
  if (!response.ok) throw new Error(await response.text());
}

export type VoiceProgress = (percent: number, label: string) => void;

export async function ensureVoiceProfiles(
  profiles: VoiceProfileRequest[],
  onProgress?: VoiceProgress,
): Promise<void> {
  onProgress?.(0, 'Vorhandene Stimmen werden geprüft');
  const existing = await listVoiceIds();
  const missing = profiles.filter(profile => !existing.has(profile.id));
  if (!missing.length) {
    onProgress?.(100, 'Alle Stimmen sind bereits im nativen Archiv');
    return;
  }

  const references: Array<{ profile: VoiceProfileRequest; wavBase64: string }> = [];
  for (let index = 0; index < missing.length; index += 1) {
    const profile = missing[index];
    const percent = Math.round((index / missing.length) * 70);
    onProgress?.(percent, `VoiceDesign erzeugt ${profile.displayName} (${index + 1}/${missing.length})`);
    references.push({ profile, wavBase64: await designReference(profile) });
  }
  for (let index = 0; index < references.length; index += 1) {
    const reference = references[index];
    const percent = 72 + Math.round(((index + 1) / references.length) * 28);
    onProgress?.(percent, `Native Registry speichert ${reference.profile.displayName}`);
    await registerReference(reference.profile, reference.wavBase64);
  }
  onProgress?.(100, `${missing.length} neue Stimmen sind archiviert`);
}
