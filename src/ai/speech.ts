import * as Speech from 'expo-speech';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { apiRequest } from '../api/client';
import type { Lang } from '../types';

/**
 * Reading aloud, on the phone's own engine wherever the phone can.
 *
 * Every answer used to be synthesised by Gemini and sent down as base64 WAV.
 * That was wrong three times over:
 *
 *   - **Cost.** Spoken output is the most expensive token type there is. A
 *     farmer who listens to everything — and they do — was the single largest
 *     line in the bill, larger than the answers themselves.
 *   - **Weight.** A 40-second answer is ~2.5 MB of base64 over a connection
 *     that is often 2G, before she hears the first word.
 *   - **Offline.** Nothing could be re-read without a network round trip, which
 *     defeats the point of keeping the history on the device.
 *
 * Android has had a text-to-speech engine since 2009 and Google's engine ships
 * a Bengali (bn-BD) voice. It is free, instant, works with the plane in
 * flight-mode and costs nothing per farmer per year. It also sounds more
 * synthetic than Gemini, which is a real loss — and a smaller one than any of
 * the three above.
 *
 * So: the device reads, always, when it has a Bangla voice installed. The
 * server is the fallback for the handsets that do not, and it is asked for
 * audio **by id** — never by sending it text — so an open text-to-speech
 * endpoint is not left on the internet.
 *
 * Nothing here ever sends the text of an answer anywhere. When the device can
 * speak, no request is made at all.
 */

/* ---------------------------------------------------------------------------
   Does this phone have a voice that can read Bangla
   --------------------------------------------------------------------------- */

const VOICE_CACHE_KEY = 'shathi.speech.voice.v1';

/** Anything the engine calls Bengali. Android reports bn-BD, bn-IN or bare bn. */
const BANGLA = /^bn([-_]|$)/i;

type VoicePick = {
  /** The identifier to hand to `Speech.speak`, when one is worth pinning. */
  identifier: string | null;
  /** The BCP-47 tag to ask for — bn-BD where available. */
  language: string;
  name: string;
};

let picked: VoicePick | null = null;
/** null until we have looked; false once we have looked and found nothing. */
let checked: boolean | null = null;

/**
 * Pick the best Bangla voice on the device.
 *
 * Preference order is deliberate: bn-BD is the dialect these farmers speak,
 * bn-IN is intelligible but noticeably West Bengali, bare `bn` is whatever the
 * engine decides. An `Enhanced` voice is preferred within a language because on
 * Android that means the downloaded high-quality model rather than the small
 * on-board one.
 */
function choose(voices: Speech.Voice[]): VoicePick | null {
  const bangla = voices.filter((v) => BANGLA.test(v.language ?? ''));
  if (!bangla.length) return null;
  const rank = (v: Speech.Voice) => {
    const tag = (v.language ?? '').toLowerCase().replace('_', '-');
    const dialect = tag === 'bn-bd' ? 0 : tag === 'bn-in' ? 1 : 2;
    const quality = v.quality === Speech.VoiceQuality.Enhanced ? 0 : 1;
    return dialect * 2 + quality;
  };
  const best = [...bangla].sort((a, b) => rank(a) - rank(b))[0];
  return {
    identifier: best.identifier || null,
    language: (best.language || 'bn-BD').replace('_', '-'),
    name: best.name || best.identifier || 'bn',
  };
}

/**
 * Look for a Bangla voice, and remember the answer.
 *
 * Called once at sign-in so the first question does not wait on it. The result
 * is cached in storage as well as in memory because the voice list is a native
 * call that takes a beat on a cold start, and the answer only changes when the
 * farmer installs a voice — which means leaving the app.
 */
export async function primeDeviceVoice(): Promise<boolean> {
  if (checked !== null) return checked;
  try {
    const cached = await AsyncStorage.getItem(VOICE_CACHE_KEY);
    if (cached) {
      const saved = JSON.parse(cached) as VoicePick | { none: true };
      if ('none' in saved) {
        // Not trusted for long: she may have installed one since.
        checked = false;
      } else {
        picked = saved;
        checked = true;
        return true;
      }
    }
  } catch {
    /* an unreadable cache is no cache */
  }

  try {
    let voices = await Speech.getAvailableVoicesAsync();
    // Android sometimes answers before the engine has finished enumerating,
    // and an empty list is indistinguishable from a device with no voices.
    if (!voices.length) {
      await new Promise((r) => setTimeout(r, 600));
      voices = await Speech.getAvailableVoicesAsync();
    }
    picked = choose(voices);
    checked = picked !== null;
    await AsyncStorage.setItem(VOICE_CACHE_KEY, JSON.stringify(picked ?? { none: true })).catch(() => undefined);
  } catch {
    // No engine at all — some stripped-down Android builds ship without one.
    picked = null;
    checked = false;
  }
  return checked;
}

/** What the phone should tell the server, so the server knows whether to synthesise. */
export function needsServerSpeech(): boolean {
  return checked === false;
}

/** Re-check after the farmer has been sent to install a voice. */
export async function forgetDeviceVoice(): Promise<void> {
  checked = null;
  picked = null;
  await AsyncStorage.removeItem(VOICE_CACHE_KEY).catch(() => undefined);
}

export function deviceVoiceName(): string | null {
  return picked?.name ?? null;
}

/* ---------------------------------------------------------------------------
   What a voice should read
   --------------------------------------------------------------------------- */

/**
 * Markdown read aloud is worse than no markdown: "star star careful star star"
 * is what a farmer actually hears. The server strips this too, for the text it
 * returns; this is the same rule applied on the device so nothing has to be
 * fetched to read an answer that is already on screen.
 */
export function speakable(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s*/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s{0,3}[-*+]\s+/gm, '')
    .replace(/^\s{0,3}\d+[.)]\s+/gm, '')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/\*([^*]*)\*/g, '$1')
    .replace(/__([^_]*)__/g, '$1')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^\s*[-=_]{3,}\s*$/gm, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

/**
 * Split a long text into pieces the engine will accept.
 *
 * Android's TTS has a hard input limit (`maxSpeechInputLength`, 4000 characters
 * on current versions) and silently truncates past it — which for a training
 * article means it stops mid-sentence and the farmer assumes the app broke. The
 * split is at sentence ends so the pause lands where a reader would pause.
 */
function chunk(text: string, limit: number): string[] {
  if (text.length <= limit) return [text];
  const out: string[] = [];
  // Bangla ends a sentence with a daṛi (।); keep the terminator with its sentence.
  const sentences = text.split(/(?<=[।?!.\n])\s+/);
  let current = '';
  for (const sentence of sentences) {
    if (sentence.length > limit) {
      // A single sentence longer than the limit: break on the last space that fits.
      if (current) { out.push(current); current = ''; }
      let rest = sentence;
      while (rest.length > limit) {
        const cut = rest.lastIndexOf(' ', limit);
        const at = cut > limit * 0.5 ? cut : limit;
        out.push(rest.slice(0, at));
        rest = rest.slice(at).trimStart();
      }
      current = rest;
      continue;
    }
    if ((current + ' ' + sentence).trim().length > limit) {
      out.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  }
  if (current) out.push(current);
  return out.filter(Boolean);
}

/** The three settings the farmer can choose, as engine rates. */
const RATES: Record<string, number> = { slow: 0.72, normal: 1, fast: 1.25 };

/**
 * Her chosen pace, as the server reports it.
 *
 * Held here so that every read-aloud button in the app obeys the setting
 * without each one having to be handed it — a training article read at the
 * default speed while chat answers respected the setting was the bug this
 * fixes.
 */
let defaultRate = 'normal';
export function setDefaultRate(rate: string | null | undefined) {
  if (rate && rate in RATES) defaultRate = rate;
}

export function rateValue(rate: string | null | undefined): number {
  return RATES[String(rate ?? defaultRate)] ?? 1;
}

/* ---------------------------------------------------------------------------
   One thing speaking at a time
   --------------------------------------------------------------------------- */

export type SpeechSource =
  | { source: 'apa_message'; id: string | number }
  | { source: 'learning'; id: string | number }
  | { source: 'market_update'; id: string | number };

export type SpeechMode = 'device' | 'server';

/**
 * Whatever is speaking now, if anything.
 *
 * A single token rather than a boolean because several speaker buttons are on
 * screen at once — a chat has one per answer — and each needs to know whether
 * *it* is the one playing. Without this they all showed "playing" together.
 */
let playingToken: string | null = null;
/** Bumped on every stop so a queued chunk from a cancelled job never starts. */
let generation = 0;
let player: AudioPlayer | null = null;

type Listener = (token: string | null) => void;
const listeners = new Set<Listener>();

/** Subscribe to "who is speaking". Returns the unsubscribe. */
export function onSpeechChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function announce(token: string | null) {
  playingToken = token;
  for (const fn of listeners) {
    try { fn(token); } catch { /* a listener must not break playback */ }
  }
}

export function speakingToken(): string | null {
  return playingToken;
}

export function isSpeaking(token?: string): boolean {
  return token ? playingToken === token : playingToken !== null;
}

/** Stop whatever is speaking, on either path. Safe to call when nothing is. */
export async function stopSpeech(): Promise<void> {
  generation += 1;
  if (player) {
    const dying = player;
    player = null;
    try { dying.pause(); } catch { /* already stopped */ }
    try { dying.remove(); } catch { /* already released */ }
  }
  try { await Speech.stop(); } catch { /* nothing was speaking */ }
  if (playingToken !== null) announce(null);
}

/* ---------------------------------------------------------------------------
   Speaking
   --------------------------------------------------------------------------- */

export type SpeakInput = {
  /** The text as it is on screen. Never leaves the phone. */
  text: string;
  lang?: Lang;
  /** 'slow' | 'normal' | 'fast', from her settings. */
  rate?: string | null;
  /**
   * Where the server can find this same text, for the handsets with no Bangla
   * voice. Omit it and such a handset gets `NO_VOICE` instead of audio.
   */
  server?: SpeechSource | null;
  /** Distinguishes this button from the others on screen. */
  token?: string;
  onStart?: () => void;
  onEnd?: () => void;
};

/**
 * Read something aloud, device-first.
 *
 * Resolves with the path actually used. Rejects with `NO_VOICE` when the phone
 * has no Bangla voice and the caller gave nothing the server could look up, and
 * with `TOO_LONG` / `NO_AUDIO` from the server path as before.
 */
export async function speak(input: SpeakInput): Promise<SpeechMode> {
  const token = input.token ?? 'one';
  // A second tap on the button that is already playing means stop.
  if (playingToken === token) {
    await stopSpeech();
    input.onEnd?.();
    return 'device';
  }
  await stopSpeech();

  const body = speakable(input.text);
  if (!body) {
    input.onEnd?.();
    return 'device';
  }

  const hasVoice = await primeDeviceVoice();
  if (hasVoice) {
    await speakOnDevice(body, input, token);
    return 'device';
  }

  if (!input.server) {
    const error = new Error('NO_VOICE');
    input.onEnd?.();
    throw error;
  }
  await speakFromServer(input.server, input, token);
  return 'server';
}

/** The device path: chunked, rate-applied, cancellable. */
async function speakOnDevice(body: string, input: SpeakInput, token: string): Promise<void> {
  const mine = generation;
  const limit = Math.max(200, (Speech.maxSpeechInputLength || 4000) - 40);
  const pieces = chunk(body, limit);
  const language = input.lang === 'en' ? 'en-US' : picked?.language ?? 'bn-BD';
  const rate = rateValue(input.rate);

  announce(token);
  input.onStart?.();

  let index = 0;
  const finish = () => {
    if (mine !== generation) return;
    announce(null);
    input.onEnd?.();
  };

  const next = () => {
    // A stop, or a different button taking over, invalidates the rest.
    if (mine !== generation) return;
    if (index >= pieces.length) { finish(); return; }
    const piece = pieces[index];
    index += 1;
    Speech.speak(piece, {
      language,
      rate,
      // Pinning the identifier only where the engine gave us one; on some
      // devices an identifier from the list is rejected by `speak`, and the
      // language tag alone is the reliable request.
      ...(input.lang === 'en' || !picked?.identifier ? {} : { voice: picked.identifier }),
      onDone: next,
      onStopped: () => { if (mine === generation) finish(); },
      onError: () => {
        // The engine claimed the voice and then could not use it. Better a
        // silent stop than half an answer.
        if (mine === generation) finish();
      },
    });
  };

  next();
}

/** The server path, for a handset with no Bangla voice of its own. */
async function speakFromServer(where: SpeechSource, input: SpeakInput, token: string): Promise<void> {
  announce(token);
  input.onStart?.();
  try {
    const json = await apiRequest<{
      result:
        | { mode: 'device'; text: string; language: string; rate: string }
        | { mode: 'server'; url: string; mime_type: string; sample_rate: number; seconds: number | null }
        | { mode: 'none'; reason: string };
    }>('app/ai/speak', {
      method: 'POST',
      body: JSON.stringify({
        source: where.source,
        id: String(where.id),
        lang: input.lang ?? 'bn',
        needs_server: true,
      }),
      silent: true,
      timeoutMs: 60_000,
    });
    const result = json.result;

    if (result.mode === 'none') {
      throw new Error(result.reason === 'too_long' ? 'TOO_LONG' : 'NO_AUDIO');
    }
    if (result.mode === 'device') {
      // The server declined to synthesise — it is configured device-only, or
      // its own model is out of quota. Try the engine anyway: a phone with an
      // English voice reading Bangla badly is still better than silence, and
      // this only happens on a handset we already know has no Bangla voice.
      await stopSpeech();
      await speakOnDevice(speakable(result.text), { ...input, rate: result.rate }, token);
      return;
    }
    await playUrl(result.url, input, token);
  } catch (error) {
    if (playingToken === token) announce(null);
    input.onEnd?.();
    throw error;
  }
}

/** Play a WAV the server produced, from its URL. */
async function playUrl(url: string, input: SpeakInput, token: string): Promise<void> {
  const mine = generation;
  const next = createAudioPlayer({ uri: url });
  if (mine !== generation) {
    try { next.remove(); } catch { /* already gone */ }
    return;
  }
  player = next;
  next.addListener('playbackStatusUpdate', (status) => {
    if (status.didJustFinish && player === next) {
      void stopSpeech().finally(() => input.onEnd?.());
    }
  });
  next.play();
}

/**
 * Whether read-aloud can work at all right now, and what to tell her if not.
 *
 * Used by the settings screen so "read answers aloud" is not a switch that
 * silently does nothing on a handset with no voice installed.
 */
export async function speechAvailability(): Promise<{
  ok: boolean;
  voice: string | null;
  hint_bn: string | null;
  hint_en: string | null;
}> {
  const ok = await primeDeviceVoice();
  if (ok) return { ok: true, voice: deviceVoiceName(), hint_bn: null, hint_en: null };
  return {
    ok: false,
    voice: null,
    hint_bn:
      'এই ফোনে বাংলা কণ্ঠ নেই। সেটিংস → ভাষা ও ইনপুট → টেক্সট-টু-স্পিচ থেকে বাংলা ভয়েস নামিয়ে নিলে সব উত্তর পড়ে শোনানো যাবে।',
    hint_en:
      'This phone has no Bangla voice. Install one from Settings → Language & input → Text-to-speech to have answers read aloud.',
  };
}
