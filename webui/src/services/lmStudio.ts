import { LMStudioClient } from '@lmstudio/sdk';

export function lmEndpoint(): string {
  return localStorage.getItem('lmstudio-endpoint') ||
    'wss://bkg-1235me-up80.beam.eysho.info';
}

export function roleModel(role: 'story' | 'debate' | 'director'): string {
  const key = role === 'director' ? 'story-model' : `${role}-model`;
  const model = localStorage.getItem(key) ||
    localStorage.getItem('story-model') || '';
  if (!model) throw new Error(`Kein ${role}-Modell ausgewählt.`);
  return model;
}

export async function generateWithLM(
  role: 'story' | 'debate' | 'director',
  prompt: string,
): Promise<string> {
  const client = new LMStudioClient({ baseUrl: lmEndpoint() });
  const model = await client.llm.model(roleModel(role));
  const result = await model.respond(prompt, {
    temperature: role === 'director' ? 0.4 : 0.8,
  });
  return result.content.trim();
}
