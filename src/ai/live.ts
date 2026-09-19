import {
  LIVE_INPUT_RATE,
  captureUtterance,
  createPlayer,
  micPermitted,
  prepareLiveSession,
  releaseLiveSession,
  type MicHandle,
  type PlayerHandle,
} from './livePcm';

/**
 * A live conversation with Shathi Apa.
 *
 * ## What "live" turned out to mean on this key
 *
 * Everything below is shaped by one measurement, made on 2026-09-19 against the
 * billed key and recorded in Resources/apa-probes/live-matrix.cjs:
 *
 *   **`realtimeInput` audio is accepted by the wire format and then ignored.**
 *
 * Both documented frame shapes (`mediaChunks` and `audio`), three mime types,
 * with and without explicit `activityStart`/`activityEnd` markers, with and
 * without `audioStreamEnd`, on `v1alpha` and `v1beta`, on the constrained
 * ephemeral socket and on the raw-key socket — twenty combinations, and not one
 * of them produced a single frame in reply. A text turn on the very same socket
 * comes back as twelve seconds of Bengali speech with a transcript, so the
 * session, the token and the constraint are all sound.
 *
 * What works, first time, is one `clientContent` turn carrying the whole
 * utterance as an inline linear-PCM part.
 *
 * So this is a **turn-based voice conversation over a persistent socket**, not
 * an open microphone:
 *
 *   - she presses to talk, and the utterance goes as one turn
 *   - **no barge-in.** Interrupting needs the streaming path, which does not
 *     function. She can stop Apa talking, which is most of the value, but
 *     talking over her is not possible.
 *   - context carries across turns, which the voice-message flow cannot do —
 *     "and what about the other field?" works here and nowhere else
 *   - the reply audio streams while it is generated: first frame at 3.2s
 *     measured, against about 8s for transcribe-then-answer-then-speak
 *   - one billed call per turn instead of three
 *
 * The screen must not promise what this cannot do. Six orb states exist, and
 * `listening` here means "press and speak", not "I am hearing you".
 *
 * ## Cost, measured
 *
 * One turn — a 3.7s question, a 12s answer — billed 721 prompt tokens (429
 * text, 292 audio) and 307 audio output tokens, which at the table in
 * lib/apa/pure.ts is **$0.0071**, about **$0.027 per minute** of conversation.
 * A typed answer is $0.0017. So a minute of live costs roughly what fifteen
 * typed questions cost, which is why lib/apa/budget.ts closes live first when
 * the month's ceiling gets close.
 */

/* ---------------------------------------------------------------------------
   States
   --------------------------------------------------------------------------- */

/**
 * The six states the orb draws, and nothing else.
 *
 * Kept identical to the design's vocabulary so there is no translation layer
 * between what the socket is doing and what she is looking at.
 */
export type LiveState =
  | 'connecting'
  | 'listening'
  | 'thinking'
  | 'speaking'
  | 'reconnecting'
  | 'paused';

export type LiveEvent =
  /** The state changed. The screen redraws the orb from this and nothing else. */
  | { type: 'state'; state: LiveState }
  /** Something Apa said, as text, for the transcript strip. */
  | { type: 'said'; text: string }
  /** One of her turns went up. There is no transcript of it — see `heard`. */
  | { type: 'asked'; seconds: number }
  /** Under two minutes left of the session cap, told once and quietly. */
  | { type: 'ending'; secondsLeft: number }
  /** Over, with a reason for the receipt and the session row. */
  | { type: 'closed'; reason: LiveEndReason }
  /** Already a sentence a farmer can read. */
  | { type: 'error'; message: string };

export type LiveEndReason =
  | 'farmer_hung_up'
  | 'cap_reached'
  | 'server_goodbye'
  | 'lost_connection'
  | 'mic_denied'
  | 'failed';

export type LiveHandle = {
  state: () => LiveState;
  /** Begin capturing. Resolves once the microphone is actually running. */
  startTalking: () => Promise<void>;
  /** Send what she said. */
  stopTalking: () => Promise<void>;
  /** Slid up to cancel — the utterance is discarded and nothing is billed. */
  cancelTalking: () => void;
  /** Stop Apa mid-sentence. Not barge-in; the reply is simply dropped. */
  hush: () => void;
  pause: () => void;
  resume: () => void;
  close: (reason?: LiveEndReason) => Promise<void>;
  /** Seconds of conversation so far, which is what the receipt is charged on. */
  seconds: () => number;
};

/**
 * Bengali, and about her rather than about the protocol.
 *
 * Every string a farmer can reach is here so that none of them can be a raw
 * socket close code, which is what she saw before src/ai/errors.ts existed.
 */
const SAY = {
  micDenied: 'মাইক্রোফোনের অনুমতি দিলে কথা বলা যাবে। নাহলে লিখে জিজ্ঞাসা করুন।',
  noSpeech: 'কিছু শোনা যায়নি। একটু জোরে বলে আবার চেষ্টা করুন।',
  dropped: 'লাইন কেটে গেছে। আবার যোগ করার চেষ্টা করছি…',
  gone: 'লাইন ধরে রাখা যাচ্ছে না। ভয়েস মেসেজ পাঠান — উত্তর একই রকম পাবেন।',
  failed: 'লাইভ কথা এখন শুরু করা যাচ্ছে না। একটু পরে আবার চেষ্টা করুন।',
};

/** How long a reply may stall before the line is treated as dropped. */
const REPLY_TIMEOUT_MS = 45_000;
/** How many times a dropped socket is picked back up before giving up. */
const MAX_RECONNECTS = 2;

/* ---------------------------------------------------------------------------
   The session
   --------------------------------------------------------------------------- */

export async function openLive(input: {
  /** The minted socket URL. It already carries the constrained ephemeral token. */
  url: string;
  /** Seconds this call may run — the smaller of the session cap and her balance. */
  allowedSeconds: number;
  onEvent: (event: LiveEvent) => void;
}): Promise<LiveHandle> {
  const { url, allowedSeconds, onEvent } = input;

  if (!(await micPermitted())) {
    onEvent({ type: 'error', message: SAY.micDenied });
    throw new Error(SAY.micDenied);
  }
  await prepareLiveSession();

  let ws: WebSocket | null = null;
  let player: PlayerHandle | null = createPlayer();
  let mic: MicHandle | null = null;
  let state: LiveState = 'connecting';
  let resumeHandle: string | null = null;
  let reconnects = 0;
  let closedFor: LiveEndReason | null = null;
  let startedAt = 0;
  let replyTimer: ReturnType<typeof setTimeout> | null = null;
  let capTimer: ReturnType<typeof setTimeout> | null = null;
  let warnTimer: ReturnType<typeof setTimeout> | null = null;
  /** Text of the current reply, coalesced so the strip gets one line per turn. */
  let saying = '';

  const setState = (next: LiveState) => {
    if (state === next || closedFor) return;
    state = next;
    onEvent({ type: 'state', state: next });
  };

  const clearReplyTimer = () => {
    if (replyTimer) { clearTimeout(replyTimer); replyTimer = null; }
  };

  /** A reply that never arrives is a dropped line, not a long silence. */
  const armReplyTimer = () => {
    clearReplyTimer();
    replyTimer = setTimeout(() => {
      if (closedFor) return;
      onEvent({ type: 'error', message: SAY.dropped });
      reconnect();
    }, REPLY_TIMEOUT_MS);
  };

  const flushSaid = () => {
    const text = saying.trim();
    saying = '';
    if (text) onEvent({ type: 'said', text });
  };

  /* --- the socket ------------------------------------------------------- */

  function connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const socket = new WebSocket(url);
      ws = socket;

      socket.onopen = () => {
        // The setup frame is still expected even though the constrained token
        // already carries it. Anything put in it is ignored, which is the whole
        // point of minting the token server-side: the phone cannot widen the
        // instruction, change the model or add a tool.
        //
        // On a reconnect the resumption handle goes with it, so the model keeps
        // what she has already told it. Without this a dropped line means
        // starting the conversation again, which is worse than a dropped call.
        socket.send(JSON.stringify({
          setup: resumeHandle ? { sessionResumption: { handle: resumeHandle } } : {},
        }));
      };

      socket.onerror = () => {
        if (settled) return;
        settled = true;
        reject(new Error(SAY.failed));
      };

      socket.onclose = () => {
        if (closedFor) return;
        // 1008 and friends all arrive here. Which code it was does not change
        // what she should do, so it is not shown to her.
        if (!settled) { settled = true; reject(new Error(SAY.failed)); return; }
        reconnect();
      };

      socket.onmessage = (event) => {
        void handleFrame(event.data, () => {
          if (settled) return;
          settled = true;
          resolve();
        });
      };
    });
  }

  async function handleFrame(data: unknown, onReady: () => void) {
    let text: string;
    if (typeof data === 'string') text = data;
    else if (data instanceof ArrayBuffer) text = new TextDecoder().decode(data);
    else if (typeof Blob !== 'undefined' && data instanceof Blob) text = await data.text();
    else return;

    let msg: Record<string, any>;
    try { msg = JSON.parse(text); } catch { return; }

    if (msg.setupComplete) {
      reconnects = 0;
      if (!startedAt) {
        startedAt = Date.now();
        armCapTimers();
      }
      setState('listening');
      onReady();
      return;
    }

    // The handle that makes a reconnection continue the conversation rather
    // than restart it. It arrives unprompted, early, and can be replaced.
    if (msg.sessionResumptionUpdate?.newHandle) {
      resumeHandle = String(msg.sessionResumptionUpdate.newHandle);
      return;
    }

    // The server telling us it is about to hang up — a fifteen-minute cap, or
    // maintenance. Reconnecting with the handle is the correct response and is
    // invisible to her.
    if (msg.goAway) {
      reconnect();
      return;
    }

    const sc = msg.serverContent;
    if (!sc) return;

    if (sc.outputTranscription?.text) saying += String(sc.outputTranscription.text);

    for (const part of sc.modelTurn?.parts ?? []) {
      const inline = part?.inlineData;
      if (inline?.data) {
        clearReplyTimer();
        setState('speaking');
        await player?.push(String(inline.data));
      }
      // A text part on an audio-only session means the model answered in the
      // wrong modality, which is worth keeping for the strip rather than
      // dropping on the floor.
      if (part?.text) saying += String(part.text);
    }

    if (sc.interrupted) {
      player?.stop();
      flushSaid();
      setState('listening');
      return;
    }

    if (sc.turnComplete) {
      clearReplyTimer();
      flushSaid();
      setState('listening');
    }
  }

  /* --- reconnection ----------------------------------------------------- */

  function reconnect() {
    if (closedFor) return;
    clearReplyTimer();
    player?.stop();
    if (reconnects >= MAX_RECONNECTS) {
      onEvent({ type: 'error', message: SAY.gone });
      void close('lost_connection');
      return;
    }
    reconnects += 1;
    setState('reconnecting');
    // A short, growing pause. Immediate retries against a server that is
    // shedding load are how a dropped call becomes an outage.
    const wait = reconnects * 1200;
    setTimeout(() => {
      if (closedFor) return;
      connect().catch(() => {
        onEvent({ type: 'error', message: SAY.gone });
        void close('lost_connection');
      });
    }, wait);
  }

  /* --- the clock -------------------------------------------------------- */

  function armCapTimers() {
    // The cap is enforced here as well as on the server, because the server
    // cannot end a socket it does not hold. The server still charges the cap if
    // this fails, so the two agree on the bill either way.
    capTimer = setTimeout(() => void close('cap_reached'), allowedSeconds * 1000);

    // One quiet line under two minutes, and never a number counting down
    // mid-conversation (SRS V4). A visible timer while she is describing a sick
    // animal manufactures exactly the anxiety the design exists to avoid.
    const warnAt = (allowedSeconds - 120) * 1000;
    if (warnAt > 0) {
      warnTimer = setTimeout(() => onEvent({ type: 'ending', secondsLeft: 120 }), warnAt);
    }
  }

  /* --- talking ---------------------------------------------------------- */

  async function startTalking() {
    if (closedFor || state === 'paused') return;
    // Stop Apa first. Not barge-in — the streaming path that would allow
    // genuine interruption does not work on this key — but the audio she has
    // already been sent is dropped, so she is not talked over.
    player?.stop();
    if (mic) return;
    mic = await captureUtterance({
      maxSeconds: 60,
      onMaxReached: () => { void stopTalking(); },
    });
    setState('listening');
  }

  async function stopTalking() {
    const handle = mic;
    mic = null;
    if (!handle || closedFor) return;

    const { base64, seconds, silent } = await handle.stop();
    if (silent || seconds < 0.4) {
      onEvent({ type: 'error', message: SAY.noSpeech });
      setState('listening');
      return;
    }

    onEvent({ type: 'asked', seconds });
    setState('thinking');
    armReplyTimer();

    try {
      ws?.send(JSON.stringify({
        clientContent: {
          turns: [{
            role: 'user',
            parts: [{ inlineData: { mimeType: `audio/pcm;rate=${LIVE_INPUT_RATE}`, data: base64 } }],
          }],
          turnComplete: true,
        },
      }));
    } catch {
      // The socket died between recording and sending. Her words are gone
      // either way, so the honest move is to reconnect and let her repeat it.
      onEvent({ type: 'error', message: SAY.dropped });
      reconnect();
    }
  }

  function cancelTalking() {
    mic?.cancel();
    mic = null;
    setState('listening');
  }

  /* --- ending ----------------------------------------------------------- */

  async function close(reason: LiveEndReason = 'farmer_hung_up') {
    if (closedFor) return;
    closedFor = reason;
    clearReplyTimer();
    if (capTimer) clearTimeout(capTimer);
    if (warnTimer) clearTimeout(warnTimer);
    mic?.cancel();
    mic = null;
    try { ws?.close(); } catch { /* already gone */ }
    ws = null;
    await player?.close();
    player = null;
    await releaseLiveSession();
    onEvent({ type: 'closed', reason });
  }

  await connect();

  return {
    state: () => state,
    startTalking,
    stopTalking,
    cancelTalking,
    hush: () => { player?.stop(); setState('listening'); },
    pause: () => {
      // Pause stops the clock on the server side too, via the receipt: the
      // seconds reported at close are what she is charged, and this stops
      // counting them.
      mic?.cancel();
      mic = null;
      player?.stop();
      setState('paused');
    },
    resume: () => setState('listening'),
    close,
    seconds: () => (startedAt ? Math.round((Date.now() - startedAt) / 1000) : 0),
  };
}
