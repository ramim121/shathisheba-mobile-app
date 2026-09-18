import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  askApaPhoto, askApaText, askApaVoice, friendlyAiError, getApaEntitlement, getApaSpeechConfig,
  sendApaFeedback,
  type ApaAnswer, type ApaEntitlement, type ApaOfficer, type ApaSource,
} from '../ai/apa';
import { onSpeechChange, primeDeviceVoice, speak, stopSpeech } from '../ai/speech';
import { optimiseImage } from '../media/image';
import { uploadImage } from '../api/client';
import { useLanguage } from '../theme/primitives';
import type { Screen } from '../types';

// Shathi Apa's conversation, held in one place.
//
// It lives in a context rather than in a screen because the composer is not
// inside the screen: Shell pins it above the navigation bar as a fixed
// accessory, so the chat and the thing that writes to it are siblings. They
// need the same state, and passing it down through Shell would mean threading
// eight props through a component that has no interest in any of them.

export type ApaTurnState = 'sending' | 'transcribing' | 'thinking' | 'done' | 'unheard' | 'failed';

export type ApaTurn = {
  key: string;
  role: 'user' | 'apa';
  text: string;
  /** Her own recording, kept so a failed transcription can still be replayed. */
  clipUri?: string;
  clipSeconds?: number;
  imageUri?: string;
  state: ApaTurnState;
  /** True once the transcript has been read back to her, so the caption shows. */
  transcribed?: boolean;
  advice?: ApaAnswer['answer']['advice'];
  caution?: string | null;
  sources?: ApaSource[];
  suggestions?: string[];
  officer?: ApaOfficer | null;
  /**
   * A URL, only for the handsets with no Bangla voice of their own.
   *
   * This used to be the answer's audio as base64. Sixty of those is about
   * 150 MB, against an AsyncStorage database that Android caps at 6 MB by
   * default — so the store filled up, every write after that threw
   * "database or disk is full", and the farmer's history stopped saving
   * silently. Nothing large is kept here now: the device speaks from the text,
   * which was already being stored anyway.
   */
  speechUrl?: string | null;
  messageId?: string | null;
  vote?: 'up' | 'down' | null;
  voteReason?: string | null;
  refused?: boolean;
  askedClarification?: boolean;
  fromCache?: boolean;
};

type ApaValue = {
  entitlement: ApaEntitlement | null;
  turns: ApaTurn[];
  busy: boolean;
  /** Set when the server refused for entitlement reasons — the app shows the wall. */
  wall: string | null;
  conversationId: number | null;
  error: string;
  reload: () => void;
  askText: (text: string) => Promise<void>;
  askVoice: (uri: string, seconds: number) => Promise<void>;
  askPhoto: (uri: string, question: string) => Promise<void>;
  replay: (turn: ApaTurn) => void;
  /** Which turn is being read aloud, so only its own button shows playing. */
  speakingKey: string | null;
  vote: (turn: ApaTurn, vote: 'up' | 'down', reason?: string) => void;
  clear: () => void;
  navigate: (screen: Screen) => void;
  /** Set by the composer so the screen can show the "listening" header state. */
  recording: boolean;
  setRecording: (on: boolean) => void;
  /** True once, the first time she comes back verified. Shown then never again. */
  justUnlocked: boolean;
  dismissUnlocked: () => void;
};

const ApaContext = createContext<ApaValue | null>(null);

export function useApa(): ApaValue {
  const value = useContext(ApaContext);
  if (!value) throw new Error('useApa must be used inside ApaProvider');
  return value;
}

// History survives a restart so advice is readable with no signal at all. The
// key is versioned because the turn shape will change again.
const STORE_KEY = 'shathi.apa.v1';
const SEEN_UNLOCK_KEY = 'shathi.apa.unlocked.seen';
const KEEP_TURNS = 60;

let seq = 0;
const nextKey = () => `t${Date.now().toString(36)}${(seq += 1)}`;

export function ApaProvider({
  children,
  authed,
  onNavigate,
}: {
  children: React.ReactNode;
  authed: boolean;
  onNavigate: (screen: Screen) => void;
}) {
  const { lang } = useLanguage();
  const [entitlement, setEntitlement] = useState<ApaEntitlement | null>(null);
  const [turns, setTurns] = useState<ApaTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [wall, setWall] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [recording, setRecording] = useState(false);
  const [tick, setTick] = useState(0);
  const [justUnlocked, setJustUnlocked] = useState(false);
  const [speakingKey, setSpeakingKey] = useState<string | null>(null);
  const hydrated = useRef(false);

  // One place knows what is speaking, so a second speaker button cannot show
  // "playing" while the first one actually is.
  useEffect(() => onSpeechChange(setSpeakingKey), []);

  // Looked up once, ahead of the first question: the server needs to know
  // whether this phone can read aloud by itself before it decides whether to
  // spend a synthesis call, and the voice list is a slow native call.
  useEffect(() => {
    if (!authed) return;
    void primeDeviceVoice().catch(() => undefined);
    void getApaSpeechConfig().catch(() => undefined);
  }, [authed]);

  // Leaving Apa should not leave her phone talking.
  useEffect(() => () => { void stopSpeech(); }, []);

  useEffect(() => {
    if (!authed) return;
    let alive = true;
    getApaEntitlement()
      .then((next) => { if (alive) { setEntitlement(next); setError(''); } })
      .catch((e: unknown) => { if (alive) setError(friendlyAiError(e, lang)); });
    return () => { alive = false; };
  }, [authed, tick, lang]);

  useEffect(() => {
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORE_KEY);
        if (raw) {
          const saved = JSON.parse(raw) as { turns: ApaTurn[]; conversationId: number | null };
          setTurns(
            (saved.turns ?? []).map((t) => {
              // An install from before device read-aloud has megabytes of
              // base64 WAV in here. Dropped on the first read, which is what
              // frees the store rather than waiting for it to be overwritten.
              const { audio, ...rest } = t as ApaTurn & { audio?: string | null };
              // A turn stored mid-flight would come back as a spinner that
              // never resolves, so anything unfinished is written off as failed.
              return rest.state === 'done' || rest.state === 'unheard' ? rest : { ...rest, state: 'failed' as const };
            })
          );
          setConversationId(saved.conversationId ?? null);
        }
      } catch {
        /* an unreadable cache is an empty cache */
      } finally {
        hydrated.current = true;
      }
    })();
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    const payload = JSON.stringify({ turns: turns.slice(-KEEP_TURNS), conversationId });
    AsyncStorage.setItem(STORE_KEY, payload).catch(() => undefined);
  }, [turns, conversationId]);

  // The celebration is a one-time state: gold border, a line of congratulation,
  // and then the card settles back to normal for good (SRS E3).
  useEffect(() => {
    if (!entitlement) return;
    const unlocked = entitlement.tier === 'verified_free' || entitlement.tier === 'premium' || entitlement.tier === 'staff';
    if (!unlocked) return;
    void (async () => {
      const seen = await AsyncStorage.getItem(SEEN_UNLOCK_KEY).catch(() => null);
      if (!seen) setJustUnlocked(true);
    })();
  }, [entitlement]);

  const dismissUnlocked = useCallback(() => {
    setJustUnlocked(false);
    AsyncStorage.setItem(SEEN_UNLOCK_KEY, '1').catch(() => undefined);
  }, []);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  const patch = useCallback((key: string, next: Partial<ApaTurn>) => {
    setTurns((current) => current.map((t) => (t.key === key ? { ...t, ...next } : t)));
  }, []);

  /** Everything an answer changes, in one place so the three paths agree. */
  const land = useCallback(
    (apaKey: string, result: ApaAnswer, autoplay: boolean) => {
      setConversationId(result.conversation_id ?? null);
      setEntitlement(result.entitlement);
      const speech = result.speech;
      patch(apaKey, {
        text: result.answer.text,
        advice: result.answer.advice,
        caution: result.answer.caution,
        sources: result.answer.sources,
        suggestions: result.answer.suggestions,
        officer: result.officer,
        speechUrl: speech && speech.mode === 'server' ? speech.url : null,
        messageId: result.message_id ? String(result.message_id) : null,
        refused: result.refused,
        askedClarification: result.asked_clarification,
        fromCache: result.from_cache,
        state: 'done',
      });
      // Voice in, voice out, without being asked. A typed question gets the
      // button instead — reading aloud to someone sitting with other people is
      // not a kindness (SRS V1).
      if (autoplay && speech) {
        const spoken = [result.answer.text, result.answer.caution].filter(Boolean).join('। ');
        speak({
          text: speech.mode === 'device' ? speech.text || spoken : spoken,
          lang,
          rate: speech.mode === 'device' ? speech.rate : entitlementRate(result.entitlement),
          token: apaKey,
          server: result.message_id ? { source: 'apa_message', id: result.message_id } : null,
        }).catch(() => undefined);
      }
    },
    [lang, patch]
  );

  const fail = useCallback(
    (apaKey: string, e: unknown) => {
      const locked = (e as { code?: string; entitlement?: ApaEntitlement } | null) ?? {};
      if (locked.entitlement) setEntitlement(locked.entitlement);
      if (locked.code && locked.code.startsWith('apa_') && locked.code !== 'apa_busy' && locked.code !== 'apa_timeout' && locked.code !== 'apa_failed') {
        // Not an error: the trial is spent, or live is not open yet. The screen
        // shows the wall rather than a red bubble.
        setWall(e instanceof Error ? e.message : null);
        setTurns((current) => current.filter((t) => t.key !== apaKey));
        return;
      }
      patch(apaKey, { text: friendlyAiError(e, lang), state: 'failed' });
    },
    [lang, patch]
  );

  const askText = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;
      setWall(null);
      const apaKey = nextKey();
      setTurns((current) => [
        ...current,
        { key: nextKey(), role: 'user', text: trimmed, state: 'done' },
        { key: apaKey, role: 'apa', text: '', state: 'thinking' },
      ]);
      setBusy(true);
      try {
        land(apaKey, await askApaText(trimmed, conversationId), false);
      } catch (e) {
        fail(apaKey, e);
      } finally {
        setBusy(false);
      }
    },
    [busy, conversationId, fail, land]
  );

  const askVoice = useCallback(
    async (uri: string, seconds: number) => {
      if (busy) return;
      setWall(null);
      // Her bubble appears immediately, before anything has been transcribed.
      // Waiting for the server to answer before showing what she just said is
      // how a voice app comes to feel broken.
      const userKey = nextKey();
      const apaKey = nextKey();
      setTurns((current) => [
        ...current,
        { key: userKey, role: 'user', text: '', clipUri: uri, clipSeconds: seconds, state: 'sending' },
        { key: apaKey, role: 'apa', text: '', state: 'transcribing' },
      ]);
      setBusy(true);
      try {
        const result = await askApaVoice(uri, conversationId);
        if (result.transcript && !result.transcript.ok) {
          // The clip is never lost because the transcription was (SRS G1).
          patch(userKey, { state: 'unheard' });
          patch(apaKey, { text: result.answer.text, state: 'done', caution: null });
          setEntitlement(result.entitlement);
          return;
        }
        patch(userKey, { text: result.transcript?.text ?? '', state: 'done', transcribed: true });
        patch(apaKey, { state: 'thinking' });
        land(apaKey, result, true);
      } catch (e) {
        patch(userKey, { state: 'failed' });
        fail(apaKey, e);
      } finally {
        setBusy(false);
      }
    },
    [busy, conversationId, fail, land, patch]
  );

  const askPhoto = useCallback(
    async (uri: string, question: string) => {
      if (busy) return;
      setWall(null);
      const userKey = nextKey();
      const apaKey = nextKey();
      setTurns((current) => [
        ...current,
        { key: userKey, role: 'user', text: question, imageUri: uri, state: 'sending' },
        { key: apaKey, role: 'apa', text: '', state: 'thinking' },
      ]);
      setBusy(true);
      try {
        // Shrunk before it goes anywhere. Measured: nineteen times fewer bytes
        // off her data pack for the same answer about the same spot on the
        // same leaf. The token cost of an image is flat whatever its size, so
        // this is entirely about her connection and the upload succeeding.
        const small = await optimiseImage(uri, 'ai');
        // Uploaded rather than inlined: the console has to be able to show the
        // photograph beside the diagnosis it produced.
        const url = await uploadImage(small.uri, 'apa');
        patch(userKey, { state: 'done' });
        land(apaKey, await askApaPhoto(url, question, conversationId), true);
      } catch (e) {
        patch(userKey, { state: 'failed' });
        fail(apaKey, e);
      } finally {
        setBusy(false);
      }
    },
    [busy, conversationId, fail, land, patch]
  );

  const replay = useCallback(
    (turn: ApaTurn) => {
      if (turn.role === 'apa' && turn.text) {
        // Spoken by the phone, from text it already has — so this works with
        // no signal at all, which is most of the point of keeping the history.
        speak({
          text: [turn.text, turn.caution].filter(Boolean).join('। '),
          lang,
          rate: entitlementRate(entitlement),
          token: turn.key,
          server: turn.messageId ? { source: 'apa_message', id: turn.messageId } : null,
        }).catch(() => undefined);
        return;
      }
      if (turn.clipUri) {
        // Her own recording, played back from the file it was captured to.
        import('expo-audio')
          .then(({ createAudioPlayer }) => {
            void stopSpeech();
            createAudioPlayer({ uri: turn.clipUri! }).play();
          })
          .catch(() => undefined);
      }
    },
    [entitlement, lang]
  );

  const vote = useCallback(
    (turn: ApaTurn, next: 'up' | 'down', reason?: string) => {
      if (!turn.messageId) return;
      patch(turn.key, { vote: next, voteReason: reason ?? null });
      // The reason is the whole value of a thumbs-down: "wrong for my area" and
      // "did not understand me" need completely different fixes, and a bare
      // count of downvotes cannot tell them apart.
      sendApaFeedback(turn.messageId, next, reason).catch(() => undefined);
    },
    [patch]
  );

  const clear = useCallback(() => {
    void stopSpeech();
    setTurns([]);
    setConversationId(null);
    setWall(null);
    AsyncStorage.removeItem(STORE_KEY).catch(() => undefined);
  }, []);

  const value = useMemo<ApaValue>(
    () => ({
      entitlement, turns, busy, wall, conversationId, error, reload,
      askText, askVoice, askPhoto, replay, speakingKey, vote, clear,
      navigate: onNavigate, recording, setRecording, justUnlocked, dismissUnlocked,
    }),
    [entitlement, turns, busy, wall, conversationId, error, reload, askText, askVoice, askPhoto, replay, vote, clear, onNavigate, recording, justUnlocked, dismissUnlocked]
  );

  return <ApaContext.Provider value={value}>{children}</ApaContext.Provider>;
}

/** Her chosen reading speed, as the entitlement reports it. */
function entitlementRate(entitlement: ApaEntitlement | null): string {
  return entitlement?.voice?.speech_rate ?? 'normal';
}

/* ---------------------------------------------------------------------------
   Small shared formatters
   --------------------------------------------------------------------------- */

const BN_DIGITS = '০১২৩৪৫৬৭৮৯';

/** Bangla numerals. Latin digits in a Bangla sentence read as a foreign word. */
export function bn(value: number | string): string {
  return String(value).replace(/\d/g, (d) => BN_DIGITS[Number(d)]);
}

export function clock(seconds: number, lang: 'bn' | 'en' = 'bn'): string {
  const total = Math.max(0, Math.round(seconds));
  const text = `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  return lang === 'bn' ? bn(text) : text;
}

/** A screen token like `screen:menuKyc`, as the finance actions already use. */
export function screenFromAction(action: string | null | undefined): Screen | null {
  if (!action || !action.startsWith('screen:')) return null;
  return action.slice('screen:'.length) as Screen;
}
