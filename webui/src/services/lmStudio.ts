function cleanLMText(text: string): string {
  return text
    .replace(/^[\s\S]*?__LM_STUDIO_INTERNAL_LSEP_SYNTHETIC_REASONING_END_[A-Za-z0-9_]+__/m, '')
    .replace(/^v?undefined\s*/i, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .trim();
}

export function roleModel(role: 'story' | 'debate' | 'director'): string {
  const key = role === 'director' ? 'story-model' : `${role}-model`;
  return localStorage.getItem(key) || localStorage.getItem('story-model') || 'qwen3-14b-128k';
}

export async function generateWithLM(
  role: 'story' | 'debate' | 'director',
  prompt: string,
): Promise<string> {
  const response = await fetch('/v1/lms/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role, prompt, model: roleModel(role) }),
  });
  const text = await response.text();
  let json: any = {};
  try { json = text ? JSON.parse(text) : {}; } catch { throw new Error(text || 'LM-Studio-Bridge lieferte keine gültige Antwort.'); }
  if (!response.ok) throw new Error(json.detail || json.error || 'LM-Studio-Anfrage fehlgeschlagen.');
  return cleanLMText(String(json.content || ''));
}
