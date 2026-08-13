import { Audio } from 'expo-av';
import { GoogleGenAI, MediaResolution } from '@google/genai';
import type { CattleAiResult, ChatMessage, Lang } from '../types';

// Everything that talks to Google Gemini: the client, the prompts, the audio
// codecs, and the text-to-speech playback. Extracted from App.tsx so the AI
// surface can be reviewed (and its prompts changed) without scrolling through
// screen components.
//
// NOTE: GEMINI_API_KEY reaches this module via EXPO_PUBLIC_*, which means it is
// compiled into the distributed APK and is extractable from it. Moving these
// calls behind the backend is the real fix; this module makes that a
// single-file change instead of a hunt through 8,000 lines.

export const GEMINI_API_KEY =
  process.env.EXPO_PUBLIC_GEMINI_API_KEY ||
  process.env.GEMINI_API_KEY ||
  process.env.gemkini_api_key ||
  process.env.GEMKINI_API_KEY ||
  '';

export const genAI = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;
export const GEMINI_TEXT_MODEL = 'gemma-4-31b-it';
export const GEMINI_TTS_MODEL = 'gemini-3.1-flash-tts-preview';
export const GEMINI_TEXT_CONFIG = {
  mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
  tools: [{ googleSearch: {} }],
};
export const SHATHI_APA_SCOPE =
  'You are Shathi Apa, a helpful specialist for Bangladesh users on agriculture, farming, cattle, livestock, crops, plants, fruits, vegetables, fishery, feed, weather, farm disease, image-based farm analysis, market price, farm business, and Shathi projects. Answer all relevant questions in these domains. Introduce yourself only once at the start of a new live conversation; for follow-up chat messages answer naturally like a regular conversation without repeating your identity. If the user asks unrelated things, respond cordially and ask for a relevant agriculture, farming, livestock, weather, feed, or Shathi service question. Keep advice safe, practical, and concise.';

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

export async function uriToInlineData(uri: string, fallbackMime = 'image/jpeg') {
  const response = await fetch(uri);
  const buffer = await response.arrayBuffer();
  return {
    data: bytesToBase64(new Uint8Array(buffer)),
    mimeType: mimeFromUri(uri, fallbackMime),
  };
}

export function requireGenAI() {
  if (!genAI) {
    throw new Error('Gemini API key missing. Add gemkini_api_key or EXPO_PUBLIC_GEMINI_API_KEY to .env and restart Expo.');
  }
  return genAI;
}

export function friendlyAiError(error: unknown, lang: Lang) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('@google/genai') || message.includes('conditional exports')) {
    return lang === 'bn'
      ? 'AI সংযোগের সেটআপ আপডেট করা হচ্ছে। অ্যাপ রিস্টার্ট করে আবার চেষ্টা করুন।'
      : 'AI connection setup was updated. Restart the app and try again.';
  }
  if (message.includes('Audio input modality') || message.includes('INVALID_ARGUMENT')) {
    return lang === 'bn'
      ? 'এই লাইভ মডেলে সরাসরি মাইক ইনপুট সীমিত। আপাতত নিচের চ্যাট বা ছবি ব্যবহার করুন, লাইভ উত্তর ভয়েসে চালু থাকবে।'
      : 'Direct mic input is limited for this live model. Use chat or image for now; live voice output remains enabled.';
  }
  if (message.includes('languageCodes')) {
    return lang === 'bn'
      ? 'লাইভ ভাষা সেটিং ঠিক করা হয়েছে। অ্যাপ রিলোড করে আবার চেষ্টা করুন।'
      : 'Live language setting was fixed. Reload the app and try again.';
  }
  return message;
}

export function markdownInstruction(lang: Lang) {
  return `Use concise Markdown formatting in the answer: short headings with **bold**, bullet points for actions, and no long paragraphs. Reply in ${lang === 'bn' ? 'Bengali Bangla' : 'English'}.`;
}

export async function askShathiApaText(question: string, lang: Lang, history: ChatMessage[] = []) {
  const response = await requireGenAI().models.generateContent({
    model: GEMINI_TEXT_MODEL,
    config: GEMINI_TEXT_CONFIG,
    contents: [
      ...history.slice(-8).map((message) => ({
        role: message.role,
        parts: [{ text: message.text }],
      })),
      {
        role: 'user',
        parts: [
          { text: `${SHATHI_APA_SCOPE}\n${markdownInstruction(lang)}\nUser question: ${question}` },
        ],
      },
    ],
  });
  return response.text || '';
}

export async function askShathiApaImage(uri: string, lang: Lang) {
  const inlineData = await uriToInlineData(uri, 'image/jpeg');
  const response = await requireGenAI().models.generateContent({
    model: GEMINI_TEXT_MODEL,
    config: GEMINI_TEXT_CONFIG,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData },
          { text: `${SHATHI_APA_SCOPE}\n${markdownInstruction(lang)}\nAnalyze this new image only. Do not use previous image context. Identify whether it shows cattle, crops, vegetables, fruits, disease symptoms, or risk. If the image is unrelated to farming, say that clearly and ask for a relevant farm image.` },
        ],
      },
    ],
  });
  return response.text || '';
}

// Generates a short, plain sale-listing description from the first uploaded
// photo. Used by every listing type's description field.
// Category-gated AI sale-description (Shathi Apa). Returns NOT_RELEVANT when the
// photo is not the expected category so the caller can show a polite message.
export async function generateListingDescription(uri: string, lang: Lang, opts: { kind: 'livestock' | 'inputs'; context?: string }) {
  const inlineData = await uriToInlineData(uri, 'image/jpeg');
  const rules = opts.kind === 'livestock'
    ? `The photo MUST clearly show a farm animal of one of these types only: cow, bull, buffalo, goat, sheep, poultry (chicken/duck). If it does NOT show such an animal, reply with EXACTLY the single token NOT_RELEVANT and nothing else. If it does, write a marketplace product sale description in 2-4 plain sentences (no markdown, no headings) covering the animal type, visible health/condition and approximate body size.`
    : `The photo MUST clearly show an agricultural input for sale: seeds, animal feed, or fertilizer (e.g. seed packets, feed/fertilizer sacks or containers). If it does NOT show such an input, reply with EXACTLY the single token NOT_RELEVANT and nothing else. If it does, write a marketplace product sale description in 2-4 plain sentences (no markdown, no headings) covering the input type, visible quality/condition and approximate quantity/packaging.`;
  const ctx = opts.context ? ` Where sensible, incorporate these seller-provided details: ${opts.context}.` : '';
  const response = await requireGenAI().models.generateContent({
    model: GEMINI_TEXT_MODEL,
    config: GEMINI_TEXT_CONFIG,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData },
          { text: `You are Shathi Apa, writing short marketplace sale descriptions for a Bangladeshi farmer app. ${rules}${ctx} Be factual; never invent prices. Reply in ${lang === 'bn' ? 'Bengali Bangla' : 'English'}.` },
        ],
      },
    ],
  });
  return (response.text || '').trim();
}

export async function askShathiApaImageFollowup(uri: string, question: string, lang: Lang, history: ChatMessage[] = []) {
  const inlineData = await uriToInlineData(uri, 'image/jpeg');
  const response = await requireGenAI().models.generateContent({
    model: GEMINI_TEXT_MODEL,
    config: GEMINI_TEXT_CONFIG,
    contents: [
      ...history.slice(-8).map((message) => ({
        role: message.role,
        parts: [{ text: message.text }],
      })),
      {
        role: 'user',
        parts: [
          { inlineData },
          { text: `${SHATHI_APA_SCOPE}\n${markdownInstruction(lang)}\nUse the attached image and the prior chat context on this page to answer the follow-up.\nFollow-up question: ${question}` },
        ],
      },
    ],
  });
  return response.text || '';
}

export async function generateResponseSuggestions(answer: string, lang: Lang, history: ChatMessage[] = []) {
  const response = await requireGenAI().models.generateContent({
    model: GEMINI_TEXT_MODEL,
    config: GEMINI_TEXT_CONFIG,
    contents: [
      ...history.slice(-6).map((message) => ({
        role: message.role,
        parts: [{ text: message.text }],
      })),
      {
        role: 'user',
        parts: [
          {
            text: `${SHATHI_APA_SCOPE}\nBased on the latest assistant answer below, generate exactly 3 short follow-up suggestion questions a farmer may tap next. Return only a JSON array of strings in ${lang === 'bn' ? 'Bengali Bangla' : 'English'}.\nLatest answer:\n${answer}`,
          },
        ],
      },
    ],
  });
  try {
    const parsed = parseJsonArray(response.text || '[]');
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string').slice(0, 3) : [];
  } catch {
    return [];
  }
}

export async function withSuggestions(answer: string, lang: Lang, history: ChatMessage[]): Promise<ChatMessage> {
  try {
    const suggestions = await generateResponseSuggestions(answer, lang, history);
    return { role: 'model', text: answer, suggestions };
  } catch {
    return { role: 'model', text: answer };
  }
}

export async function askShathiApaAudio(uri: string, lang: Lang) {
  const inlineData = await uriToInlineData(uri, 'audio/mp4');
  const response = await requireGenAI().models.generateContent({
    model: GEMINI_TEXT_MODEL,
    config: GEMINI_TEXT_CONFIG,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData },
          { text: `${SHATHI_APA_SCOPE}\n${markdownInstruction(lang)}\nTranscribe the user's farming question from this audio if needed, then answer as Shathi Apa. Keep the answer short and useful.` },
        ],
      },
    ],
  });
  return response.text || '';
}

export async function askShathiApaAudioWithTranscript(uri: string, lang: Lang) {
  const inlineData = await uriToInlineData(uri, 'audio/mp4');
  const response = await requireGenAI().models.generateContent({
    model: GEMINI_TEXT_MODEL,
    config: GEMINI_TEXT_CONFIG,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData },
          {
            text: `${SHATHI_APA_SCOPE}\nTranscribe the user's voice question and answer it. Return only JSON with keys "transcript" and "answer". The transcript and answer must be in ${lang === 'bn' ? 'Bengali Bangla' : 'English'}. Use concise Markdown in the answer.`,
          },
        ],
      },
    ],
  });
  try {
    const parsed = parseJsonObject(response.text || '{}') as { transcript?: string; answer?: string };
    return {
      transcript: parsed.transcript || (lang === 'bn' ? 'ভয়েস থেকে প্রশ্নটি স্পষ্ট বোঝা যায়নি' : 'Voice transcript was unclear'),
      answer: parsed.answer || '',
    };
  } catch {
    return {
      transcript: lang === 'bn' ? 'ভয়েস থেকে প্রশ্নটি স্পষ্ট বোঝা যায়নি' : 'Voice transcript was unclear',
      answer: response.text || '',
    };
  }
}

export function parseJsonObject(text: string) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i)?.[1];
  const raw = fenced || text.match(/\{[\s\S]*\}/)?.[0] || text;
  return JSON.parse(raw);
}

export function parseJsonArray(text: string) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i)?.[1];
  const raw = fenced || text.match(/\[[\s\S]*\]/)?.[0] || text;
  return JSON.parse(raw);
}

export async function analyzeCattlePhoto(uri: string, lang: Lang): Promise<CattleAiResult> {
  const inlineData = await uriToInlineData(uri, 'image/jpeg');
  const response = await requireGenAI().models.generateContent({
    model: GEMINI_TEXT_MODEL,
    config: GEMINI_TEXT_CONFIG,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData },
          { text: `Analyze this new image only for a cattle sale listing form in Bangladesh. Do not use prior images or prior context. Return only JSON with keys: isCow boolean, ageMonths number|null, weightKg number|null, animalType string|null, breed string|null, count number|null, healthSummary string, accuracyPercent number. If the image is not clearly a cow/cattle, set isCow false, use null for unavailable cattle fields, set low accuracyPercent, and say "Please provide a clear cow image" in healthSummary. If details like age, weight, breed or type cannot be visually extracted, use null for those fields and explain uncertainty in healthSummary. Accuracy should be your confidence from 0 to 100.` },
        ],
      },
    ],
  });
  return parseJsonObject(response.text || '{}') as CattleAiResult;
}


export let activeTtsSound: Audio.Sound | null = null;

export async function stopAiSpeech() {
  if (activeTtsSound) {
    await activeTtsSound.stopAsync().catch(() => undefined);
    await activeTtsSound.unloadAsync().catch(() => undefined);
    activeTtsSound = null;
  }
}

export async function playAiSpeech(text: string, lang: Lang, onStart?: () => void, onEnd?: () => void) {
  await stopAiSpeech();
  onStart?.();
  try {
    const response = await requireGenAI().models.generateContent({
      model: GEMINI_TTS_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `Read this in a warm, clear female voice. Use ${lang === 'bn' ? 'Bengali Bangla' : 'English'} pronunciation. Do not add extra words.\n\n${text.replace(/\*\*/g, '')}`,
            },
          ],
        },
      ],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } } },
      },
    } as any);
    const inlineData = (response as any).candidates?.[0]?.content?.parts?.find((part: any) => part.inlineData)?.inlineData;
    const audioBase64 = inlineData?.data;
    const mimeType = inlineData?.mimeType || 'audio/wav';
    if (!audioBase64) throw new Error('No TTS audio returned.');
    const playableBase64 = mimeType.includes('wav') ? audioBase64 : pcm16Base64ToWavBase64(audioBase64);
    const created = await Audio.Sound.createAsync({ uri: `data:audio/wav;base64,${playableBase64}` }, { shouldPlay: true });
    activeTtsSound = created.sound;
    activeTtsSound.setOnPlaybackStatusUpdate((status) => {
      if ('didJustFinish' in status && status.didJustFinish) {
        stopAiSpeech().finally(() => onEnd?.());
      }
    });
  } catch (error) {
    onEnd?.();
    throw error;
  }
}

export function toggleSpeech(text: string, lang: Lang = 'bn') {
  if (activeTtsSound) {
    stopAiSpeech();
    return;
  }
  playAiSpeech(text, lang).catch(() => undefined);
}

// Condenses a long training article into a short Markdown summary for the
// Training screens' "summarise" action.
export async function summarizeMarkdown(text: string, lang: Lang): Promise<string> {
  const response = await requireGenAI().models.generateContent({
    model: GEMINI_TEXT_MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `Summarize the following farm training content ${lang === 'bn' ? 'in Bengali Bangla' : 'in English'} as concise Markdown: a one-line intro then up to 5 short bullet points of the key practical takeaways. Content:\n\n${text}`,
          },
        ],
      },
    ],
  });
  return response.text || '';
}

// Is TTS playback currently active? Exposed as a predicate so callers do not
// have to reach for the mutable module binding.
export function isAiSpeaking() {
  return activeTtsSound !== null;
}
