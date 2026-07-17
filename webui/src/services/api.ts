import { CONFIG } from '../config/api';
import { DEFAULT_API_KEY } from '../config/constants';
import type {
  GenerateCustomVoiceRequest,
  GenerateVoiceDesignRequest,
  CloneVoiceRequest,
  CreatePromptRequest,
  GenerateWithPromptRequest,
  AudioResponse,
  HealthResponse,
  ModelsHealthResponse,
  CacheStatsResponse,
  CreatePromptResponse,
  UploadRefAudioResponse,
  ApiErrorResponse,
} from '../types/api';

/**
 * Get headers with API key
 */
export function getHeaders(apiKey?: string, contentType: string = 'application/json'): HeadersInit {
  const headers: HeadersInit = {};
  if (contentType) {
    headers['Content-Type'] = contentType;
  }
  const effectiveApiKey = (
    apiKey ||
    localStorage.getItem('qwen-tts-api-key') ||
    DEFAULT_API_KEY
  ).trim();
  if (effectiveApiKey) {
    headers['X-API-Key'] = effectiveApiKey;
  }
  // Add Accept-Language header based on user preference
  const lang = localStorage.getItem('qwen-tts-lang');
  if (lang) {
    headers['Accept-Language'] = lang;
  }
  return headers;
}

/**
 * Handle API errors
 */
async function handleResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const error: ApiErrorResponse = await response.json();
    throw new Error(error.detail || 'API request failed');
  }
  return response.json();
}

/**
 * Check server health
 */
export async function checkHealth(): Promise<HealthResponse> {
  const response = await fetch(`${CONFIG.baseUrl}${CONFIG.endpoints.health}`);
  return handleResponse<HealthResponse>(response);
}

/**
 * Check models health
 */
export async function checkModelsHealth(): Promise<ModelsHealthResponse> {
  const response = await fetch(`${CONFIG.baseUrl}${CONFIG.endpoints.modelsHealth}`);
  return handleResponse<ModelsHealthResponse>(response);
}

/**
 * Fetch cache statistics
 */
export async function fetchCacheStats(apiKey: string): Promise<CacheStatsResponse> {
  const response = await fetch(`${CONFIG.baseUrl}${CONFIG.endpoints.base.cacheStats}`, {
    headers: getHeaders(apiKey, ''),
  });
  return handleResponse<CacheStatsResponse>(response);
}

/**
 * Clear cache
 */
export async function clearCache(apiKey: string): Promise<void> {
  const response = await fetch(`${CONFIG.baseUrl}${CONFIG.endpoints.base.cacheClear}`, {
    method: 'POST',
    headers: getHeaders(apiKey, ''),
  });
  if (!response.ok) {
    throw new Error('Failed to clear cache');
  }
}


async function wavResponse(response: Response): Promise<{ data: AudioResponse; headers: Headers }> {
  if (!response.ok) throw new Error(await response.text());
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 32768) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  }
  return { data: { audio: btoa(binary), sample_rate: 24000 }, headers: response.headers };
}

async function streamPcm(body: object, onChunk: (chunk: Uint8Array) => void): Promise<void> {
  const response = await fetch(`${CONFIG.baseUrl}/v1/audio/speech`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, response_format: 'pcm' }),
  });
  if (!response.ok || !response.body) throw new Error(await response.text());
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value?.length) onChunk(value);
  }
}

async function registerVoice(name: string, wav: string, refText?: string): Promise<void> {
  const response = await fetch(`${CONFIG.baseUrl}/v1/voices`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, wav_b64: wav, ref_text: refText || '' }),
  });
  if (!response.ok) throw new Error(await response.text());
}

/**
 * Generate custom voice speech
 */
export async function generateCustomVoice(
  request: GenerateCustomVoiceRequest,
  _apiKey: string
): Promise<{ data: AudioResponse; headers: Headers }> {
  const instructions = [
    request.emotion ? `Speak with ${request.emotion} emotion.` : '',
    request.instruct || '',
  ].filter(Boolean).join(' ');

  const response = await fetch(`${CONFIG.baseUrl}/v1/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: request.text,
      voice: request.speaker?.toLowerCase(),
      language: request.language,
      instructions,
      speed: request.speed,
      temperature: request.temperature,
      top_p: request.top_p,
      repetition_penalty: request.rep_penalty,
      seed: request.seed,
      response_format: 'wav',
    }),
  });
  if (!response.ok) throw new Error(await response.text());
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 32768) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  }
  return { data: { audio: btoa(binary) } as AudioResponse, headers: response.headers };
}

export async function streamEngineSpeech(
  request: GenerateCustomVoiceRequest,
  _apiKey: string,
  onChunk: (chunk: Uint8Array) => void,
): Promise<void> {
  const instructions = [
    request.emotion ? `Speak with ${request.emotion} emotion.` : '',
    request.instruct || '',
  ].filter(Boolean).join(' ');
  const response = await fetch(`${CONFIG.baseUrl}/v1/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: request.text,
      voice: request.speaker?.toLowerCase(),
      language: request.language,
      instructions,
      speed: request.speed,
      temperature: request.temperature,
      top_p: request.top_p,
      repetition_penalty: request.rep_penalty,
      seed: request.seed,
      response_format: 'pcm',
    }),
  });
  if (!response.ok || !response.body) throw new Error(await response.text());
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value?.length) onChunk(value);
  }
}

/**
 * Generate voice design speech
 */
export async function generateVoiceDesign(
  request: GenerateVoiceDesignRequest,
  _apiKey: string
): Promise<{ data: AudioResponse; headers: Headers }> {
  const response = await fetch(`${CONFIG.baseUrl}/v1/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: request.text,
      language: request.language,
      instructions: request.instruct,
      speed: request.speed,
      response_format: 'wav',
    }),
  });
  if (!response.ok) throw new Error(await response.text());
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 32768) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  }
  return {
    data: { audio: btoa(binary), sample_rate: 24000 },
    headers: response.headers,
  };
}

/** Native voice design PCM stream. */
export async function streamVoiceDesign(
  request: GenerateVoiceDesignRequest,
  _apiKey: string,
  onChunk: (chunk: Uint8Array) => void,
): Promise<void> {
  return streamPcm({
    input: request.text, language: request.language,
    instructions: request.instruct, speed: request.speed,
  }, onChunk);
}

/** Register a reference WAV and synthesize with the cloned voice. */
export async function cloneVoice(
  request: CloneVoiceRequest,
  _apiKey: string
): Promise<{ data: AudioResponse; headers: Headers }> {
  const name = `clone-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await registerVoice(name, request.ref_audio_base64, request.ref_text);
  return wavResponse(await fetch(`${CONFIG.baseUrl}/v1/audio/speech`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: request.text, voice: name, language: request.language,
      speed: request.speed, response_format: 'wav' }),
  }));
}

export async function streamClonedVoice(
  request: CloneVoiceRequest,
  _apiKey: string,
  onChunk: (chunk: Uint8Array) => void,
): Promise<void> {
  const name = `clone-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await registerVoice(name, request.ref_audio_base64, request.ref_text);
  return streamPcm({ input: request.text, voice: name, language: request.language, speed: request.speed }, onChunk);
}

export async function createVoicePrompt(
  request: CreatePromptRequest,
  _apiKey: string
): Promise<CreatePromptResponse> {
  const promptId = `voice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await registerVoice(promptId, request.ref_audio_base64, request.ref_text);
  return { prompt_id: promptId } as CreatePromptResponse;
}

export async function generateWithPrompt(
  request: GenerateWithPromptRequest,
  _apiKey: string
): Promise<{ data: AudioResponse; headers: Headers }> {
  return wavResponse(await fetch(`${CONFIG.baseUrl}/v1/audio/speech`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: request.text, voice: request.prompt_id,
      language: request.language, speed: request.speed, response_format: 'wav' }),
  }));
}

export async function streamWithPrompt(
  request: GenerateWithPromptRequest,
  _apiKey: string,
  onChunk: (chunk: Uint8Array) => void,
): Promise<void> {
  return streamPcm({ input: request.text, voice: request.prompt_id,
    language: request.language, speed: request.speed }, onChunk);
}

/**
 * Upload reference audio
 */
export async function uploadRefAudio(
  file: File,
  apiKey: string
): Promise<UploadRefAudioResponse> {
  const formData = new FormData();
  formData.append('file', file);

  const response = await fetch(`${CONFIG.baseUrl}${CONFIG.endpoints.base.uploadRefAudio}`, {
    method: 'POST',
    headers: getHeaders(apiKey, ''), // No content-type for FormData
    body: formData,
  });

  return handleResponse<UploadRefAudioResponse>(response);
}
