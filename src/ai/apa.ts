import { apiRequest } from '../api/client';
import { needsServerSpeech, primeDeviceVoice, primeSpeechUrls, setDefaultRate, setSpeechMode } from './speech';
import { optimiseImage, setAiImageMaxPx } from '../media/image';
import type { CattleAiResult, Lang } from '../types';

// Everything Shathi Apa needs from the server, and the audio plumbing that
// plays what comes back.
//
// This file replaces src/ai/gemini.ts, which called Google directly from the
// phone using EXPO_PUBLIC_GEMINI_API_KEY. That key was compiled into every
// distributed APK and could be pulled out of one with `unzip` and `strings`; a
// key taken out of an APK carries no scope restriction, no quota and no owner,
// so the first person to find it had an unmetered Gemini account on our
// invoice. There is no key in this file and no @google/genai import. Every call
// below goes to our own backend, which holds the key, checks the farmer's
// entitlement, restricts the model to agriculture and writes down what it cost.
//
// Reading aloud is no longer here either. It moved to ./speech.ts, which uses
// the phone's own text-to-speech engine and only falls back to the server for a
// handset with no Bangla voice installed. What stayed is the PCM/WAV pair,
// because the live socket will still send raw PCM when live chat opens.

/* ---------------------------------------------------------------------------
   Types the screens read
   --------------------------------------------------------------------------- */

export type ApaFeature = 'ask_text' | 'ask_voice' | 'ask_photo' | 'read_aloud' | 'live';

export type ApaRequirement = {
  id: string;
  label_bn: string;
  label_en: string;
  detail_bn: string;
  state: 'done' | 'todo' | 'pending' | 'rejected';
  action: string | null;
  action_label_bn: string | null;
};

export type ApaEntitlement = {
  enabled: boolean;
  configured?: boolean;
  tier: 'locked' | 'trial' | 'verified_free' | 'premium' | 'staff';
  tier_source: string;
  blocked: boolean;
  blocked_reason: string | null;
  features: Record<ApaFeature, boolean>;
  requirements: ApaRequirement[];
  steps_done: number;
  steps_total: number;
  trial: { allowance: number; used: number; left: number; active: boolean };
  live: {
    minutes_monthly: number;
    seconds_used: number;
    seconds_left: number;
    session_seconds_max: number;
    mic_enabled: boolean;
    data_mb_per_minute: number;
    bandwidth_floor_kbps: number;
  };
  voice: { autoplay: boolean; voice_name: string; speech_rate: string };
  headline_bn: string;
  headline_en?: string;
  /**
   * Her area's field officer — present only while she is locked or waiting on
   * a verification. The unlock screen is where a farmer gets stuck; a name and
   * a number for somebody local is the difference between a wall and a step.
   */
  officer?: ApaOfficer | null;
  starters?: Array<{ text: string; icon: string }>;
  unlock?: Array<{ id: string; icon: string; title_bn: string; detail_bn: string }>;
};

export type ApaSource = { kind: string; label_bn: string; action: string | null };

export type ApaAdvice = { kind: 'advice' | 'likely'; title_bn: string; body: string };

export type ApaOfficer = { name?: string; phone?: string; role?: string; area?: string };

/**
 * How an answer should be read out.
 *
 * `device` is the normal case and carries no audio at all — just the text, for
 * the phone's own engine to say. `server` is the fallback for a handset with no
 * Bangla voice, and is a URL rather than the 2.5 MB of base64 this used to be.
 */
export type ApaSpeech =
  | { mode: 'device'; text: string; language: string; rate: string }
  | { mode: 'server'; url: string; mime_type: string; sample_rate: number; seconds: number | null };

export type ApaAnswer = {
  conversation_id: number | null;
  message_id: number | null;
  transcript: { text: string; seconds: number; ok: boolean } | null;
  refused: boolean;
  answer: {
    text: string;
    advice: ApaAdvice | null;
    caution: string | null;
    suggestions: string[];
    sources: ApaSource[];
  };
  officer: ApaOfficer | null;
  speech: ApaSpeech | null;
  /** True when she was asked to say more rather than given an answer. */
  asked_clarification: boolean;
  /** True when another farmer's identical question answered this one. */
  from_cache: boolean;
  entitlement: ApaEntitlement;
  latency_ms: number;
};

export type ApaLiveStart = {
  session_id: number;
  token: { name: string; url: string; model: string; expires_at: string; session_expires_at: string };
  allowed_seconds: number;
  entitlement: ApaEntitlement;
  notice: { data_mb_per_minute: number; bandwidth_floor_kbps: number; minutes_left: number };
};

export type ApaLiveReceipt = {
  seconds: number;
  minutes_left: number;
  data_mb: number;
  entitlement: ApaEntitlement;
};

export type ApaUserSettings = {
  read_aloud: boolean;
  speech_rate: 'slow' | 'normal' | 'fast';
  language: Lang;
  data_warning: boolean;
  wifi_only_live: boolean;
};

/** A locked farmer is not an error: the server hands back the unlock screen. */
export type ApaLocked = Error & { code?: string; entitlement?: ApaEntitlement };

export function apaLockCode(error: unknown): string | undefined {
  const code = (error as ApaLocked | null)?.code;
  return code && code.startsWith('apa_') ? code : undefined;
}

/* ---------------------------------------------------------------------------
   Asking
   --------------------------------------------------------------------------- */

// An answer that calls two grounding tools legitimately takes about eighteen
// seconds on the current models, and a photo read takes longer.
const ASK_TIMEOUT_MS = 60_000;

type AskEnvelope = { result: ApaAnswer };

async function ask(body: Record<string, unknown>): Promise<ApaAnswer> {
  // The server needs to know whether this phone can speak for itself before it
  // decides whether to spend a text-to-speech call on the answer.
  await primeDeviceVoice().catch(() => undefined);
  const json = await apiRequest<AskEnvelope>('app/apa/ask', {
    method: 'POST',
    body: JSON.stringify({ needs_server_speech: needsServerSpeech(), ...body }),
    timeoutMs: ASK_TIMEOUT_MS,
  });
  return json.result;
}

export function askApaText(text: string, conversationId?: number | null, speak = false) {
  return ask({ mode: 'text', text, conversation_id: conversationId ?? null, speak });
}

/**
 * What the server wants read aloud and how.
 *
 * Fetched once when Apa opens so the image budget and the speech mode are the
 * server's to change without an app release.
 */
export async function getApaSpeechConfig() {
  const json = await apiRequest<{
    data: {
      mode: 'device' | 'server' | 'off';
      preferred_language: string;
      fallback_languages: string[];
      rate: string;
      max_chars: number;
      server_available: boolean;
      image_max_px?: number;
    };
  }>('app/apa/speech-config', { silent: true });
  setAiImageMaxPx(json.data.image_max_px);
  setDefaultRate(json.data.rate);
  setSpeechMode(json.data.mode);
  await primeSpeechUrls();
  return json.data;
}

/**
 * A voice message. The clip is sent as base64 rather than uploaded first: it is
 * a few seconds of audio, and the round trip it saves is the difference between
 * her hearing an answer and wondering whether the app is stuck.
 */
export async function askApaVoice(uri: string, conversationId?: number | null) {
  const audio = await uriToInlineData(uri, 'audio/m4a');
  return ask({
    mode: 'voice',
    audio: { data: audio.data, mime_type: audio.mimeType },
    conversation_id: conversationId ?? null,
  });
}

/**
 * A photo. Uploaded first, because the console has to be able to show the
 * picture beside the diagnosis it produced — an answer nobody can audit is not
 * much use when the answer was about an animal's health.
 */
export async function askApaPhoto(imageUrl: string, question: string, conversationId?: number | null) {
  return ask({
    mode: 'photo',
    image_url: imageUrl,
    text: question,
    conversation_id: conversationId ?? null,
  });
}

/* ---------------------------------------------------------------------------
   Entitlement, settings, history
   --------------------------------------------------------------------------- */

export async function getApaEntitlement(): Promise<ApaEntitlement> {
  const json = await apiRequest<{ data: ApaEntitlement }>('app/apa/entitlement', { silent: true });
  return json.data;
}

export async function getApaSettings() {
  const json = await apiRequest<{
    data: { settings: ApaUserSettings; live: ApaEntitlement['live']; tier: string; renews_on: string };
  }>('app/apa/settings', { silent: true });
  return json.data;
}

export async function saveApaSettings(patch: Partial<ApaUserSettings>) {
  const json = await apiRequest<{ result: { settings: ApaUserSettings } }>('app/apa/settings', {
    method: 'POST',
    body: JSON.stringify(patch),
  });
  return json.result.settings;
}

export type ApaHistoryMessage = {
  id: string;
  role: 'user' | 'assistant';
  input_mode: string;
  body: string | null;
  transcript: string | null;
  advice: string | null;
  image_url: string | null;
  audio_seconds: number | null;
  sources: ApaSource[];
  suggestions: string[];
  refused: number;
  created_at: string;
  my_vote: 'up' | 'down' | null;
};

export async function getApaConversations() {
  const json = await apiRequest<{ data: Array<Record<string, unknown>> }>('app/apa/conversations', { silent: true });
  return json.data ?? [];
}

export async function getApaConversation(id: string | number) {
  const json = await apiRequest<{
    data: { conversation: Record<string, unknown>; messages: ApaHistoryMessage[] };
  }>(`app/apa/conversations?id=${id}`, { silent: true });
  return json.data;
}

export async function clearApaHistory() {
  await apiRequest('app/apa/history/clear', { method: 'POST', body: '{}' });
}

export async function sendApaFeedback(messageId: string | number, vote: 'up' | 'down', reason?: string) {
  await apiRequest('app/apa/feedback', {
    method: 'POST',
    body: JSON.stringify({ message_id: messageId, vote, reason }),
    silent: true,
  });
}

/* ---------------------------------------------------------------------------
   Live conversation
   --------------------------------------------------------------------------- */

export async function startApaLive(conversationId?: number | null): Promise<ApaLiveStart> {
  const json = await apiRequest<{ result: ApaLiveStart }>('app/apa/live/start', {
    method: 'POST',
    body: JSON.stringify({ conversation_id: conversationId ?? null }),
  });
  return json.result;
}

export async function markApaLiveConnected(sessionId: number) {
  await apiRequest('app/apa/live/connected', {
    method: 'POST',
    body: JSON.stringify({ session_id: sessionId }),
    silent: true,
  });
}

export async function closeApaLive(input: {
  sessionId: number;
  seconds: number;
  bytes?: number;
  reason?: string;
  resumed?: number;
}): Promise<ApaLiveReceipt> {
  const json = await apiRequest<{ result: ApaLiveReceipt }>('app/apa/live/close', {
    method: 'POST',
    body: JSON.stringify({
      session_id: input.sessionId,
      seconds: input.seconds,
      bytes: input.bytes ?? 0,
      reason: input.reason ?? 'ended',
      resumed: input.resumed ?? 0,
    }),
  });
  return json.result;
}

export async function saveApaLiveTranscript(sessionId: number, turns: Array<{ role: 'user' | 'assistant'; text: string }>) {
  if (!turns.length) return;
  await apiRequest('app/apa/live/transcript', {
    method: 'POST',
    body: JSON.stringify({ session_id: sessionId, turns }),
    silent: true,
  });
}

/* ---------------------------------------------------------------------------
   The three AI features that are not the assistant
   --------------------------------------------------------------------------- */

export async function generateListingDescription(
  uri: string,
  lang: Lang,
  opts: { kind: 'livestock' | 'inputs'; context?: string }
): Promise<string> {
  // Shrunk before it leaves the phone. The saving is her data, not our tokens:
  // an inline image is billed at a flat ~1,100 prompt tokens whatever its
  // dimensions (measured), while the file itself goes from megabytes to tens
  // of kilobytes.
  const image = await inlineForModel(uri);
  const json = await apiRequest<{ result: { text: string } }>('app/ai/listing-description', {
    method: 'POST',
    body: JSON.stringify({
      image: `data:${image.mimeType};base64,${image.data}`,
      kind: opts.kind,
      context: opts.context ?? '',
      lang,
    }),
    timeoutMs: ASK_TIMEOUT_MS,
  });
  return json.result.text;
}

export async function analyzeCattlePhoto(uri: string, lang: Lang): Promise<CattleAiResult> {
  const image = await inlineForModel(uri);
  const json = await apiRequest<{ result: CattleAiResult }>('app/ai/analyze-photo', {
    method: 'POST',
    body: JSON.stringify({ image: `data:${image.mimeType};base64,${image.data}`, lang }),
    timeoutMs: ASK_TIMEOUT_MS,
  });
  return json.result;
}

export async function summarizeMarkdown(text: string, lang: Lang): Promise<string> {
  const json = await apiRequest<{ result: { text: string } }>('app/ai/summarize', {
    method: 'POST',
    body: JSON.stringify({ text, lang }),
    timeoutMs: ASK_TIMEOUT_MS,
  });
  return json.result.text;
}

/* ---------------------------------------------------------------------------
   Audio: codecs and playback
   --------------------------------------------------------------------------- */

export function mimeFromUri(uri: string, fallback = 'image/jpeg') {
  const clean = uri.split('?')[0].toLowerCase();
  if (clean.endsWith('.png')) return 'image/png';
  if (clean.endsWith('.webp')) return 'image/webp';
  if (clean.endsWith('.mp4') || clean.endsWith('.m4a')) return 'audio/mp4';
  if (clean.endsWith('.wav')) return 'audio/wav';
  if (clean.endsWith('.mp3')) return 'audio/mpeg';
  return fallback;
}

export function bytesToBase64(bytes: Uint8Array) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const b = bytes[index + 1] ?? 0;
    const c = bytes[index + 2] ?? 0;
    const triplet = (a << 16) | (b << 8) | c;
    output += alphabet[(triplet >> 18) & 63];
    output += alphabet[(triplet >> 12) & 63];
    output += index + 1 < bytes.length ? alphabet[(triplet >> 6) & 63] : '=';
    output += index + 2 < bytes.length ? alphabet[triplet & 63] : '=';
  }
  return output;
}

export function base64ToBytes(base64: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const bytes: number[] = [];
  for (let index = 0; index < clean.length; index += 4) {
    const a = alphabet.indexOf(clean[index]);
    const b = alphabet.indexOf(clean[index + 1]);
    const c = alphabet.indexOf(clean[index + 2] ?? 'A');
    const d = alphabet.indexOf(clean[index + 3] ?? 'A');
    const triplet = (a << 18) | (b << 12) | ((c < 0 ? 0 : c) << 6) | (d < 0 ? 0 : d);
    bytes.push((triplet >> 16) & 255);
    if (clean[index + 2]) bytes.push((triplet >> 8) & 255);
    if (clean[index + 3]) bytes.push(triplet & 255);
  }
  return new Uint8Array(bytes);
}

/**
 * Raw little-endian PCM16 with a 44-byte WAV header in front of it.
 *
 * The live socket sends bare PCM at 24 kHz with no container, which expo-audio
 * will not play. The read-aloud path gets its WAV from the server already
 * wrapped; this is for live.
 */
export function pcm16Base64ToWavBase64(pcmBase64: string, sampleRate = 24000, channels = 1) {
  const pcm = base64ToBytes(pcmBase64);
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);
  const writeString = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) header[offset + index] = value.charCodeAt(index);
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, pcm.length, true);
  const wav = new Uint8Array(header.length + pcm.length);
  wav.set(header);
  wav.set(pcm, header.length);
  return bytesToBase64(wav);
}

/**
 * A photograph as base64, at the size a model needs and no larger.
 *
 * Always JPEG, because that is what the optimiser writes and what the model
 * wants; a 12-megapixel PNG screenshot inlined raw was the single heaviest
 * request this app ever made — heaviest on her connection, that is. The token
 * cost of an image is flat regardless of size.
 */
export async function inlineForModel(uri: string): Promise<{ data: string; mimeType: string }> {
  const out = await optimiseImage(uri, 'ai', { base64: true });
  if (out.base64) return { data: out.base64, mimeType: 'image/jpeg' };
  // The manipulator could not read this URI. Send the original rather than
  // refusing to answer a question about a sick animal over a file format.
  return uriToInlineData(out.uri, 'image/jpeg');
}

export async function uriToInlineData(uri: string, fallbackMime = 'image/jpeg') {
  const response = await fetch(uri);
  const buffer = await response.arrayBuffer();
  return {
    data: bytesToBase64(new Uint8Array(buffer)),
    mimeType: mimeFromUri(uri, fallbackMime),
  };
}

/* ---------------------------------------------------------------------------
   Failures, said in her language
   --------------------------------------------------------------------------- */

/**
 * The server already translates a model failure into one Bangla sentence, so
 * most of what arrives here is ready to show. This handles what the server
 * cannot see: the request never left the phone.
 */
export function friendlyAiError(error: unknown, lang: Lang) {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as ApaLocked | null)?.code;

  if (code === 'apa_busy' || code === 'apa_timeout' || code === 'apa_failed' || code === 'apa_unconfigured') {
    return message;
  }
  if (/^TIMEOUT|timed out|took too long/i.test(message)) {
    return lang === 'bn'
      ? 'উত্তর আসতে দেরি হচ্ছে। আরেকবার চেষ্টা করুন।'
      : 'The answer is taking too long. Try once more.';
  }
  if (/network request failed|failed to fetch|load failed/i.test(message)) {
    return lang === 'bn'
      ? 'ইন্টারনেট ছাড়া নতুন প্রশ্ন পাঠানো যাবে না। আগের উত্তরগুলো পড়তে ও শুনতে পারবেন।'
      : 'A new question needs internet. You can still read and play the earlier answers.';
  }
  if (/SESSION_EXPIRED/i.test(message)) {
    return lang === 'bn' ? 'আবার লগ ইন করুন।' : 'Please sign in again.';
  }
  if (/TOO_LONG/.test(message)) {
    return lang === 'bn'
      ? 'উত্তরটা পড়ে শোনানোর জন্য একটু বড়। পড়ে নিতে পারেন।'
      : 'That answer is a little long to read aloud. You can read it instead.';
  }
  return message;
}
