import { useSyncExternalStore } from 'react';
import * as Speech from 'expo-speech';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';
import { apiRequest } from '../api/client';
import { heldLocally, localSpeech } from '../media/audioCache';
import type { Lang } from '../types';

/**
 * Reading aloud: Gemini's voice, cached on the phone, with the device's own
 * engine behind it.
 *
 * Which of the two leads is a **product** decision, not a technical one, and it
 * is a setting (`apa_tts_mode`) rather than a constant here:
 *
 *   - `server` — Gemini synthesises. It sounds markedly better than any
 *     on-device Bengali voice, and for a farmer who cannot read, the voice *is*
 *     the product. This is the default.
 *   - `device_then_server` — the phone reads if it has a Bangla voice, and the
 *     server covers the handsets that do not.
 *   - `device` — the phone always reads. Free and offline, more synthetic.
 *
 * What makes `server` affordable is that **the audio is paid for once.** Every
 * clip is cached on disk under the server's own content hash, so a replay is a
 * local file read: no data off her pack, no request against the day's quota,
 * and it still works with no signal. See `../media/audioCache.ts`.
 *
 * Three properties hold whichever mode is in force:
 *
 *   - **The text never leaves the phone.** The server is asked for audio **by
 *     id** and looks the text up itself, with ownership in the WHERE clause, so
 *     there is no open text-to-speech endpoint on the internet.
 *   - **Offline still speaks.** If a clip is already cached it plays from disk;
 *     if it is not and there is no network, the device voice takes over.
 *   - **A handset with no Bangla voice is told where to get one**, in two taps,
 *     rather than handed a button that silently does nothing.
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

/**
 * Which engine leads, as the server configures it.
 *
 * Unknown until `app/apa/speech-config` has answered. `server` is assumed
 * meanwhile, because that is the configured default and guessing `device` would
 * have the first answer of a session read in the worse voice.
 */
let mode: 'server' | 'device_then_server' | 'device' = 'server';
export function setSpeechMode(next: string | null | undefined) {
  if (next === 'server' || next === 'device_then_server' || next === 'device') mode = next;
}
export function speechMode() {
  return mode;
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
  | { source: 'market_update'; id: string | number }
  /**
   * The opening greeting. Identical for every farmer, so the server
   * synthesises it once and serves it from cache forever after — and it is
   * spoken in Shathi Apa's own voice rather than the phone's default, which on
   * most handsets is male.
   */
  | { source: 'intro'; id: string | number };

/**
 * The greeting text, as the server holds it.
 *
 * Kept here so the chat renders byte-for-byte what will be spoken: the speech
 * cache is keyed on the text, and a greeting differing by a full stop would
 * synthesise a second clip.
 */
let introText = '';
export function setIntroText(text: string) {
  if (text && text.trim()) introText = text.trim();
}
export function intro(): string {
  return introText;
}

/**
 * Fetch the greeting's audio and put it on disk, without playing it.
 *
 * The greeting is the one clip whose latency is fully predictable: it is the
 * same line for every farmer, it is the first thing on the screen, and she will
 * press it within a second or two of arriving. Waiting until the press meant a
 * spinner and about nine seconds the first time, which is long enough to look
 * broken.
 *
 * Silent about failure on purpose. This is an optimisation; if it does not
 * happen, `speak()` still works and simply takes as long as it used to.
 */
export async function primeIntroAudio(): Promise<void> {
  try {
    await primeSpeechUrls();
    // Already on disk from a previous visit: nothing to do, and no request.
    const known = rememberedUrl(INTRO_SOURCE);
    if (known && heldLocally(known)) return;

    const json = await apiRequest<{
      result:
        | { mode: 'device'; text: string }
        | { mode: 'server'; url: string }
        | { mode: 'none'; reason: string };
    }>('app/ai/speak', {
      method: 'POST',
      body: JSON.stringify({
        source: INTRO_SOURCE.source,
        id: String(INTRO_SOURCE.id),
        lang: 'bn',
        // Always true here. The greeting is Apa introducing herself and must be
        // her voice whatever apa_tts_mode says - see SpeakInput.alwaysServer.
        needs_server: true,
      }),
      silent: true,
      timeoutMs: 60_000,
    });
    if (json.result.mode !== 'server') return;
    rememberUrl(INTRO_SOURCE, json.result.url);
    // Pulls the bytes onto disk, so the press plays from the file system.
    await localSpeech(json.result.url);
  } catch {
    // See above.
  }
}

/** The source to hand `speak()` for the greeting. */
export const INTRO_SOURCE: SpeechSource = { source: 'intro', id: 'intro' };

export type SpeechMode = 'device' | 'server';

/**
 * What the speaker button is doing, per button.
 *
 * A boolean was not enough and the gap showed. Fetching a clip takes a second
 * or two — it may be a download, it may be a synthesis — and during that the
 * button looked idle, so a farmer pressed it again. Each press started another
 * playback, and she heard the answer twice, overlapping.
 *
 * So there are four states, one active token, and a guard: a press while
 * `loading` is ignored, and a press while `playing` stops. That is how every
 * other audio player on her phone behaves.
 */
export type SpeechState = 'idle' | 'loading' | 'playing' | 'paused';

let playingToken: string | null = null;
let state: SpeechState = 'idle';
/**
 * Set for the whole of an in-flight `speak()`, so a second press cannot start a
 * second one even before the first has announced itself.
 */
let starting: string | null = null;
/** Bumped on every stop so a queued chunk from a cancelled job never starts. */
let generation = 0;
let player: AudioPlayer | null = null;

/**
 * What the server told us about a clip: its length and its real waveform.
 *
 * Kept per token for the session, so a replay from the phone's own disk — which
 * makes no request and so gets no response to read them from — still has them.
 */
export type ClipMeta = { seconds: number | null; peaks: number[] | null };
const clipMetas = new Map<string, ClipMeta>();

/**
 * Lengths heard in full, per clip.
 *
 * Answers keep theirs on the message (and in the database). This covers the
 * clips with no message to keep it on — the greeting — which otherwise went
 * back to 0:00 on every restart even though she had heard it to the end.
 */
const heardLengths = new Map<string, number>();

const META_KEY = 'shathi.speech.meta.v1';
type StoredMeta = Record<string, { s?: number | null; p?: number[] | null; h?: number | null }>;

/** Bumped whenever the stored clip information changes, so bars redraw. */
let metaVersion = 0;
const metaListeners = new Set<() => void>();
function bumpMeta() {
  metaVersion += 1;
  for (const fn of metaListeners) {
    try { fn(); } catch { /* a listener must not break the store */ }
  }
}

function saveMeta() {
  const out: StoredMeta = {};
  const tokens = new Set([...clipMetas.keys(), ...heardLengths.keys()]);
  for (const t of tokens) {
    const m = clipMetas.get(t);
    out[t] = { s: m?.seconds ?? null, p: m?.peaks ?? null, h: heardLengths.get(t) ?? null };
  }
  // Bounded, oldest first: two hundred is far more than the sixty turns kept.
  const keys = Object.keys(out);
  for (const k of keys.slice(0, Math.max(0, keys.length - 200))) delete out[k];
  AsyncStorage.setItem(META_KEY, JSON.stringify(out)).catch(() => undefined);
}

async function loadMeta() {
  try {
    const raw = await AsyncStorage.getItem(META_KEY);
    if (!raw) return;
    const stored = JSON.parse(raw) as StoredMeta;
    for (const [t, v] of Object.entries(stored)) {
      if (!clipMetas.has(t) && (v.s || v.p)) clipMetas.set(t, { seconds: v.s ?? null, peaks: v.p ?? null });
      if (!heardLengths.has(t) && v.h && v.h > 0) heardLengths.set(t, v.h);
    }
    bumpMeta();
  } catch { /* nothing stored, or unreadable: start empty */ }
}

export function clipMeta(token: string): ClipMeta | null {
  return clipMetas.get(token) ?? null;
}

function rememberMeta(token: string, meta: ClipMeta) {
  clipMetas.set(token, meta);
  saveMeta();
  bumpMeta();
}

/** A clip was heard to its end: keep its length, across restarts. */
export function rememberHeard(token: string, seconds: number) {
  if (!(seconds > 0)) return;
  heardLengths.set(token, seconds);
  saveMeta();
  bumpMeta();
}

/**
 * What is known about one clip, for the bar that draws it. Redraws when that
 * changes — including when it finishes loading from storage after launch.
 */
export function useClipInfo(token: string): { meta: ClipMeta | null; heard: number | null } {
  useSyncExternalStore(
    (notify) => { metaListeners.add(notify); return () => { metaListeners.delete(notify); }; },
    () => metaVersion,
    () => 0,
  );
  return { meta: clipMetas.get(token) ?? null, heard: heardLengths.get(token) ?? null };
}

/**
 * Where to start a clip that is about to load, as a fraction.
 *
 * The playbar lets her tap the waveform of an answer that has never been
 * played, or tap it again while it is still loading. Both mean "play from
 * here", and both happen before there is a player to seek. The point is held
 * here and applied the moment the clip is ready — before it starts, so she
 * never hears the first half-second of the answer and then a jump.
 */
const startAt = new Map<string, number>();

export function queueStart(token: string, ratio: number) {
  startAt.set(token, Math.max(0, Math.min(0.995, ratio)));
}

/**
 * How the last playback of each clip ended.
 *
 * The playbar has to tell a clip that finished (rearm: empty track, full
 * length) from one that was interrupted because another clip started (pause:
 * position held). Both reach the listener as the same "idle", so it is
 * recorded here at the moment it happens rather than guessed afterwards.
 */
const endings = new Map<string, 'finished' | 'stopped'>();

export function speechEnding(token: string): 'finished' | 'stopped' | null {
  return endings.get(token) ?? null;
}

type Listener = (token: string | null, state: SpeechState) => void;
const listeners = new Set<Listener>();

/** Subscribe to what is speaking and what it is doing. Returns the unsubscribe. */

/**
 * The last position and duration the player reported about itself.
 *
 * This exists because reading `player.duration` on demand does not work. On
 * Android the getter answers 0 until the clip has been prepared, and for a WAV
 * assembled on the phone it can keep answering 0 for the whole of a short
 * clip — so the progress bar sat at zero for the entire playback while the
 * audio played correctly. The status event carries the same two numbers and is
 * emitted by the player itself once they are real, so it is the only source
 * that can be trusted.
 */
let progress: { position: number; duration: number } | null = null;

/** Called from the player's own status listener. */
function noteProgress(status: { currentTime?: number | null; duration?: number | null }) {
  const duration = Number(status?.duration ?? 0);
  const position = Number(status?.currentTime ?? 0);
  if (!Number.isFinite(duration) || duration <= 0) return;
  progress = {
    duration,
    position: Math.max(0, Math.min(Number.isFinite(position) ? position : 0, duration)),
  };
}

/**
 * Where playback has got to, for the progress bar.
 *
 * The bar was `width: '35%'` — a fixed value, so it looked like a progress bar
 * and told her nothing. Worse than none: a bar that never moves reads as a
 * stuck download.
 *
 * Returns the player's last reported figures, falling back to the getters for
 * the case where a status event has not landed yet. Null means there is
 * nothing to show, which is the signal to draw the bar at rest rather than to
 * draw an empty one.
 */
export function speechProgress(): { position: number; duration: number } | null {
  if (!player) return null;
  if (progress) return progress;
  try {
    const duration = Number(player.duration ?? 0);
    const position = Number(player.currentTime ?? 0);
    if (!Number.isFinite(duration) || duration <= 0) return null;
    return { position: Math.max(0, Math.min(position, duration)), duration };
  } catch {
    // The player was torn down between the check and the read.
    return null;
  }
}

/**
 * Jump to a fraction of the clip, 0..1.
 *
 * The progress bar was a read-only indicator, which is the wrong affordance
 * for something that looks exactly like every other seek bar on her phone: she
 * will press it. For a spoken answer it is also genuinely useful - the caution
 * is at the end, and hearing it again should not mean hearing the whole thing
 * again.
 *
 * No re-fetch: the clip is already in memory, so a seek is instant.
 */
export async function seekSpeech(ratio: number): Promise<boolean> {
  if (!player) return false;
  try {
    // The reported duration first: the getter answers 0 on Android until the
    // clip is prepared, and a seek against 0 is a seek to the start.
    const duration = progress?.duration || Number(player.duration ?? 0);
    if (!Number.isFinite(duration) || duration <= 0) return false;
    const to = Math.max(0, Math.min(1, ratio)) * duration;
    // Moved before the await so the bar lands under her finger immediately
    // rather than on the next status event, which can be 200ms away.
    progress = { position: to, duration };
    await player.seekTo(to);
    // A seek on a paused clip resumes it: she dragged to a point in order to
    // hear that point.
    if (state !== 'playing') {
      player.play();
      announce(playingToken, 'playing');
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Back to the beginning, without re-fetching anything.
 *
 * `seekTo(0)` rather than stop-and-speak-again: the clip is already in memory,
 * so a restart should be instant and should cost neither a request nor the
 * two-second wait that made the original press feel slow.
 */
export async function restartSpeech(): Promise<boolean> {
  if (!player) return false;
  try {
    if (progress) progress = { ...progress, position: 0 };
    await player.seekTo(0);
    if (state !== 'playing') {
      player.play();
      announce(playingToken, 'playing');
    }
    return true;
  } catch {
    return false;
  }
}

export function onSpeechChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** When the current state began, in ms since epoch. */
let stateSince = Date.now();

export function speechSince(): number {
  return stateSince;
}

function announce(token: string | null, next: SpeechState) {
  if (token !== playingToken || next !== state) stateSince = Date.now();
  playingToken = token;
  state = next;
  for (const fn of listeners) {
    try { fn(token, next); } catch { /* a listener must not break playback */ }
  }
}

export function speakingToken(): string | null {
  return playingToken;
}

export function speechState(token?: string): SpeechState {
  if (!token) return state;
  if (starting === token && state === 'idle') return 'loading';
  return playingToken === token ? state : 'idle';
}

/**
 * The live state of one clip, for a component that draws it.
 *
 * Subscribes to the speech layer directly rather than receiving the state as
 * a prop. For five rounds the playbar was handed its state through the chat's
 * context, whose memoised value left `speakingKey` and `speakingState` out of
 * its dependency list — so every consumer was told "idle" for ever, and the
 * bar never drew loading, never showed pause and never moved, however it was
 * written. A hook reading the source cannot be starved by a memo in between.
 */
export function useSpeechFor(token: string): SpeechState {
  return useSyncExternalStore(
    (notify) => onSpeechChange(() => notify()),
    () => speechState(token),
    () => 'idle' as SpeechState,
  );
}

export function isSpeaking(token?: string): boolean {
  return token ? playingToken === token && state === 'playing' : state === 'playing';
}

/** True while a clip is being fetched or synthesised for this button. */
export function isLoading(token?: string): boolean {
  if (!token) return state === 'loading';
  return (starting === token || playingToken === token) && state === 'loading';
}

/**
 * Which URL the server last gave for a given message, article or update.
 *
 * Small and deliberately persistent: it is what lets a replay skip the request
 * entirely. Without it the phone has to ask the server for a URL it already
 * holds the file for, which spends a request from the day's allowance to learn
 * something it already knew.
 */
const URL_MEMO_KEY = 'shathi.speech.urls.v1';
let urlMemo: Record<string, string> | null = null;

export async function primeSpeechUrls(): Promise<void> {
  void loadMeta();
  if (urlMemo) return;
  try {
    const raw = await AsyncStorage.getItem(URL_MEMO_KEY);
    urlMemo = raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    urlMemo = {};
  }
}

const memoKey = (where: SpeechSource) => `${where.source}:${where.id}`;

function rememberedUrl(where: SpeechSource): string | null {
  return urlMemo?.[memoKey(where)] ?? null;
}

function rememberUrl(where: SpeechSource, url: string) {
  urlMemo = urlMemo ?? {};
  urlMemo[memoKey(where)] = url;
  // Bounded, oldest-inserted first. Two hundred entries is far more than the
  // sixty turns the chat itself keeps.
  const keys = Object.keys(urlMemo);
  if (keys.length > 200) for (const k of keys.slice(0, keys.length - 200)) delete urlMemo[k];
  AsyncStorage.setItem(URL_MEMO_KEY, JSON.stringify(urlMemo)).catch(() => undefined);
}

/** Stop whatever is speaking, on either path. Safe to call when nothing is. */
/**
 * Tear down whatever is playing, synchronously.
 *
 * Split out of stopSpeech because the press that starts a new clip must be
 * able to announce "loading" on the same tick as the tap. stopSpeech ends by
 * awaiting the device engine's `Speech.stop()`, and that call can take a long
 * time to answer — measured on an emulator with no engine bound, about
 * twenty-five seconds; on a phone, however long its engine takes to wake. For
 * all of that time the playbar sat in its cold state looking like a press that
 * had been ignored, and then jumped straight to playing: the loading state
 * existed and was never on screen.
 */
function release() {
  // Whatever was going and did not finish by itself was stopped.
  if (playingToken && !endings.has(playingToken)) endings.set(playingToken, 'stopped');
  generation += 1;
  starting = null;
  // Cleared with the player: a stale duration from the previous answer would
  // draw the next one's bar at the wrong length before its first status event.
  progress = null;
  if (player) {
    const dying = player;
    player = null;
    try { dying.pause(); } catch { /* already stopped */ }
    try { dying.remove(); } catch { /* already released */ }
  }
}

export async function stopSpeech(): Promise<void> {
  release();
  try { await Speech.stop(); } catch { /* nothing was speaking */ }
  if (playingToken !== null || state !== 'idle') announce(null, 'idle');
}

/**
 * Pause a server clip, or stop a device utterance.
 *
 * The device engine cannot resume mid-sentence reliably on Android, so a pause
 * there is a stop — and the button says so by returning to idle rather than
 * showing a resume arrow it cannot honour.
 */
export async function pauseSpeech(): Promise<void> {
  if (player && state === 'playing') {
    try { player.pause(); announce(playingToken, 'paused'); return; } catch { /* fall through */ }
  }
  await stopSpeech();
}

export async function resumeSpeech(): Promise<void> {
  if (player && state === 'paused') {
    try { player.play(); announce(playingToken, 'playing'); } catch { await stopSpeech(); }
  }
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
  /**
   * Use Gemini's voice whatever `apa_tts_mode` says.
   *
   * For the greeting only. Shathi Apa is a woman and the line introducing her
   * is the first thing anyone hears, so it must not follow a cost setting down
   * to the handset's default engine — which on most Android phones is male.
   * One line of text for the whole product, synthesised once and then served
   * from its content hash, so the exemption costs about $0.003 in total.
   */
  alwaysServer?: boolean;
  onStart?: () => void;
  onEnd?: () => void;
  /** The clip's length and real waveform, once the server has said them. */
  onClip?: (meta: ClipMeta) => void;
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

  // Already fetching for this button: ignore. Without this, the two seconds a
  // download takes were two seconds in which every press queued another
  // playback, and she heard the answer three times at once.
  if (starting === token) return 'device';

  // A press on the button that is already going means stop, as it does in every
  // other player on her phone.
  if (playingToken === token && (state === 'playing' || state === 'paused')) {
    await stopSpeech();
    input.onEnd?.();
    return 'device';
  }

  const body = speakable(input.text);
  if (!body) {
    input.onEnd?.();
    return 'device';
  }

  // Announced before any await — really, this time. The previous clip is torn
  // down synchronously and the device engine is told to stop in the
  // background, so the loading state is on screen on the same tick as the tap
  // however long anything after it takes. (This used to `await stopSpeech()`
  // first, whose last step waits on the device engine; see release().)
  release();
  starting = token;
  endings.delete(token);
  announce(token, 'loading');
  Speech.stop().catch(() => undefined);
  input.onStart?.();

  // Gemini's voice first when that is the configured mode and the caller gave
  // us something the server can look up. A clip already on disk is played
  // without a request at all, so a replay costs nothing either way.
  //
  // `alwaysServer` exists for the greeting, and it is not a preference.
  // Shathi Apa is a woman, and the line that introduces her is the first thing
  // anyone hears. Left to `apa_tts_mode`, moving that setting to
  // `device_then_server` to cut the speech bill had a side effect nobody would
  // predict from the setting's name: the intro fell through to the handset's
  // default engine, which on most Android phones is male. She introduced
  // herself in a man's voice.
  //
  // It costs nothing to exempt. The greeting is one line of text for the whole
  // product, synthesised once at about $0.003 and then served from the content
  // hash for every farmer for ever.
  const wantsServer =
    input.alwaysServer === true ||
    mode === 'server' ||
    (mode === 'device_then_server' && !(await primeDeviceVoice()));
  if (wantsServer && input.server) {
    try {
      await speakFromServer(input.server, input, token);
      return 'server';
    } catch (error) {
      starting = null;
      // The server could not or would not produce audio — out of quota, out of
      // signal, or nothing to read. Her own phone is the answer to all three.
      if (await primeDeviceVoice()) {
        await speakOnDevice(body, input, token);
        return 'device';
      }
      throw error;
    }
  }

  if (await primeDeviceVoice()) {
    await speakOnDevice(body, input, token);
    return 'device';
  }

  // No Bangla voice on the phone and nothing the server can look up.
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
  starting = null;
  const limit = Math.max(200, (Speech.maxSpeechInputLength || 4000) - 40);
  const pieces = chunk(body, limit);
  const language = input.lang === 'en' ? 'en-US' : picked?.language ?? 'bn-BD';
  const rate = rateValue(input.rate);

  announce(token, 'playing');

  let index = 0;
  const finish = () => {
    if (mine !== generation) return;
    announce(null, 'idle');
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
  try {
    // A clip we already hold for this exact source needs no request at all.
    // Keyed by source and id rather than by URL, because the URL is what the
    // request would have told us — and the point is not to make it.
    const known = rememberedUrl(where);
    if (known && heldLocally(known)) {
      const held = clipMetas.get(token);
      if (held) input.onClip?.(held);
      await playUrl(known, input, token);
      return;
    }
    const json = await apiRequest<{
      result:
        | { mode: 'device'; text: string; language: string; rate: string }
        | {
            mode: 'server';
            url: string;
            mime_type: string;
            sample_rate: number;
            seconds: number | null;
            peaks?: number[] | null;
          }
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
    rememberUrl(where, result.url);
    const meta: ClipMeta = {
      seconds: result.seconds ?? null,
      peaks: Array.isArray(result.peaks) && result.peaks.length ? result.peaks : null,
    };
    rememberMeta(token, meta);
    input.onClip?.(meta);
    await playUrl(result.url, input, token);
  } catch (error) {
    starting = null;
    if (playingToken === token) announce(null, 'idle');
    input.onEnd?.();
    throw error;
  }
}

/**
 * Play a recording the farmer made herself.
 *
 * Her own voice message was played with a bare `createAudioPlayer(...).play()`
 * and nothing else: no state, no way to stop it, no sign it had started, and a
 * second tap stacked another playback on the first. It goes through the same
 * four states as everything else now, so the control under her clip behaves
 * exactly like the one under Shathi Apa's answer — which matters, because they
 * sit two lines apart.
 *
 * No network and no model: this is a local file she recorded.
 */
export async function playClip(input: {
  uri: string;
  token: string;
  onEnd?: () => void;
}): Promise<void> {
  const token = input.token;

  if (starting === token) return;
  if (playingToken === token && (state === 'playing' || state === 'paused')) {
    await stopSpeech();
    input.onEnd?.();
    return;
  }

  // Synchronous, for the same reason as in speak(): the loading state belongs
  // on the tap, not after the device engine has finished answering.
  release();
  starting = token;
  endings.delete(token);
  announce(token, 'loading');
  Speech.stop().catch(() => undefined);
  const mine = generation;
  try {
    const next = createAudioPlayer({ uri: input.uri });
    if (mine !== generation) {
      try { next.remove(); } catch { /* already gone */ }
      return;
    }
    player = next;
    starting = null;
    next.addListener('playbackStatusUpdate', (status) => {
      if (player === next) noteProgress(status);
      if (status.didJustFinish && player === next) {
        endings.set(token, 'finished');
        void stopSpeech().finally(() => input.onEnd?.());
      }
    });
    next.play();
    announce(token, 'playing');
  } catch (error) {
    starting = null;
    if (playingToken === token) announce(null, 'idle');
    input.onEnd?.();
    throw error;
  }
}

/**
 * Play a clip the server produced — from disk if we already have it.
 *
 * The first listen downloads and keeps it; every listen after that is a local
 * file read, which costs her nothing and works with the signal off.
 */
async function playUrl(url: string, input: SpeakInput, token: string): Promise<void> {
  const mine = generation;
  const uri = await localSpeech(url);
  if (mine !== generation) return;
  const next = createAudioPlayer({ uri });
  if (mine !== generation) {
    try { next.remove(); } catch { /* already gone */ }
    return;
  }
  player = next;
  starting = null;

  // A start point asked for before the clip existed. Applied before the first
  // sound, so she hears the part she chose rather than the opening and then a
  // jump. The seek needs a duration, which the player only knows once it has
  // loaded, so the start waits for that — with a ceiling, because a clip that
  // never reports itself loaded should still play rather than hang in grey.
  const from = startAt.get(token);
  startAt.delete(token);
  let begun = false;
  const begin = async (duration: number) => {
    if (begun || player !== next) return;
    begun = true;
    if (from !== undefined && duration > 0) {
      try {
        progress = { position: from * duration, duration };
        await next.seekTo(from * duration);
      } catch { /* play from the start rather than not at all */ }
    }
    if (player !== next) return;
    next.play();
    // Only now is it genuinely playing. Everything before this was the wait the
    // loading state exists to cover.
    announce(token, 'playing');
  };

  next.addListener('playbackStatusUpdate', (status) => {
    if (player === next) noteProgress(status);
    if (!begun && from !== undefined && Number(status?.duration ?? 0) > 0) {
      void begin(Number(status.duration));
    }
    if (status.didJustFinish && player === next) {
      endings.set(token, 'finished');
      void stopSpeech().finally(() => input.onEnd?.());
    }
  });

  if (from === undefined) {
    void begin(0);
  } else {
    setTimeout(() => { void begin(Number(next.duration ?? 0)); }, 1500);
  }
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
