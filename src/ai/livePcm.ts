import {
  AudioBufferQueueSourceNode,
  AudioContext,
  AudioManager,
  AudioRecorder,
  decodePCMInBase64,
} from 'react-native-audio-api';

import { bytesToBase64 } from './apa';

/**
 * The microphone and the speaker, for live conversation only.
 *
 * ## Why this is not expo-audio
 *
 * Everything else that records in this app uses `expo-audio`, and should keep
 * doing so — it writes a file, the file is uploaded, and that is exactly right
 * for a voice message. Live needs something expo-audio cannot give on Android:
 * the raw samples, while she is still speaking.
 *
 * Measured against the live API on 2026-09-19 (Resources/apa-probes/live-format.cjs):
 * the socket accepts linear PCM and nothing else. Raw PCM16 and PCM inside a
 * WAV header both work; AAC in MPEG-4, Opus in Ogg and MP3 are each refused
 * outright, with close code 1008 "Operation is not implemented, or supported,
 * or enabled". On Android `expo-audio` records through MediaRecorder, whose
 * output formats are AAC, AMR and 3GP — every one of them compressed. There is
 * no configuration of it that produces a format this socket will take.
 *
 * So `react-native-audio-api` is here for one reason: it exposes the sample
 * buffers. That makes it a native dependency, which makes a new build
 * necessary — see LIVE_CLIENT_READY in src/apa/screens.tsx.
 *
 * ## The two halves
 *
 * Recording hands back PCM16 at 16 kHz, which is the rate the live API
 * specifies. Playback takes the 24 kHz PCM16 frames the model streams and
 * queues them, so speech begins while the rest is still arriving — measured at
 * 3.2 seconds to the first frame, against about eight for the
 * transcribe-then-answer-then-speak path it replaces.
 */

/** What the live API requires on the way in. Not negotiable. */
export const LIVE_INPUT_RATE = 16000;
/** What the model streams back, per its own mime type. */
export const LIVE_OUTPUT_RATE = 24000;

/* ---------------------------------------------------------------------------
   Sample conversion
   --------------------------------------------------------------------------- */

/**
 * Float samples to PCM16, little-endian.
 *
 * The recorder gives floats in -1..1 and the wire wants signed 16-bit. The
 * asymmetry in the scaling is deliberate: 32767 and 32768 are the actual
 * bounds, and using 32768 for both directions clips the loudest positive
 * sample to -32768, which is a click on every peak.
 */
export function floatToPcm16(samples: Float32Array): Uint8Array {
  const out = new Uint8Array(samples.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, Math.round(clamped * (clamped < 0 ? 32768 : 32767)), true);
  }
  return out;
}

/**
 * Linear resample of float samples.
 *
 * Needed because the requested capture rate is a preference, not a promise —
 * the library says so, and Android hardware routinely ignores it and hands
 * back 44,100 or 48,000. Sending those to a socket that has been told 16,000
 * does not fail loudly; it makes her sound like she is speaking three times too
 * fast, which is a much harder bug to recognise from a field report.
 *
 * Linear interpolation rather than a windowed filter: this is speech heading
 * into a recogniser, the aliasing it introduces is above the band that carries
 * intelligibility, and a proper filter in JavaScript on a low-end phone would
 * cost more than it returns.
 */
export function resampleFloat(samples: Float32Array, from: number, to: number): Float32Array {
  if (from === to || samples.length === 0) return samples;
  const count = Math.max(1, Math.floor((samples.length * to) / from));
  const out = new Float32Array(count);
  const step = from / to;
  for (let i = 0; i < count; i += 1) {
    const at = i * step;
    const lo = Math.floor(at);
    const hi = Math.min(lo + 1, samples.length - 1);
    const frac = at - lo;
    out[i] = samples[lo] + (samples[hi] - samples[lo]) * frac;
  }
  return out;
}

/** Rough loudness, 0..1, for the level meter and for spotting a dead mic. */
export function levelOf(samples: Float32Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return Math.min(1, Math.sqrt(sum / samples.length) * 3);
}

/* ---------------------------------------------------------------------------
   The microphone
   --------------------------------------------------------------------------- */

export type MicHandle = {
  /** Stop capturing and return the whole utterance as base64 PCM16 @ 16 kHz. */
  stop: () => Promise<{ base64: string; seconds: number; silent: boolean }>;
  /** Abandon the utterance — she slid up to cancel. */
  cancel: () => void;
};

export async function micPermitted(): Promise<boolean> {
  try {
    const status = await AudioManager.checkRecordingPermissions();
    if (status === 'Granted') return true;
    return (await AudioManager.requestRecordingPermissions()) === 'Granted';
  } catch {
    return false;
  }
}

/**
 * Capture one utterance.
 *
 * Accumulates rather than streams, because the live socket will not take a
 * stream: `realtimeInput` — in both of its documented shapes, with three mime
 * types, with and without explicit speech markers, on v1alpha and v1beta, on
 * the constrained and the unconstrained socket — is accepted by the wire format
 * and then silently ignored. Nothing ever comes back. The grid is in
 * Resources/apa-probes/live-matrix.cjs.
 *
 * What does work is one `clientContent` turn carrying the whole utterance. That
 * is why this is press-to-talk rather than an open microphone, and why there is
 * no barge-in: both of those need the streaming path that does not function.
 *
 * `onLevel` still fires throughout, because the farmer has to be able to see
 * that the app is hearing her while she talks.
 */
export async function captureUtterance(opts: {
  onLevel?: (level: number) => void;
  /** Hard ceiling, so a phone left in a pocket cannot record for ever. */
  maxSeconds?: number;
  onMaxReached?: () => void;
}): Promise<MicHandle> {
  const recorder = new AudioRecorder();
  const chunks: Uint8Array[] = [];
  let frames = 0;
  let cancelled = false;
  let peak = 0;
  const maxSeconds = opts.maxSeconds ?? 60;

  recorder.onAudioReady(
    // 1,600 samples is 100ms at 16 kHz: small enough that the level meter
    // tracks her voice, large enough not to wake the JS thread constantly.
    { sampleRate: LIVE_INPUT_RATE, bufferLength: 1600, channelCount: 1 },
    (event) => {
      if (cancelled) return;
      const source = event.buffer.getChannelData(0);
      // The rate the hardware actually gave us, not the one we asked for.
      const samples = resampleFloat(source, event.buffer.sampleRate, LIVE_INPUT_RATE);
      const level = levelOf(samples);
      if (level > peak) peak = level;
      opts.onLevel?.(level);
      chunks.push(floatToPcm16(samples));
      frames += samples.length;
      if (frames / LIVE_INPUT_RATE >= maxSeconds) opts.onMaxReached?.();
    }
  );

  await recorder.start();

  const finish = async () => {
    try {
      await recorder.stop();
    } catch {
      // Already stopped, or the session was taken by a phone call. The samples
      // collected so far are still worth sending.
    }
    recorder.clearOnAudioReady();
  };

  return {
    async stop() {
      await finish();
      let total = 0;
      for (const c of chunks) total += c.length;
      const joined = new Uint8Array(total);
      let at = 0;
      for (const c of chunks) { joined.set(c, at); at += c.length; }
      return {
        base64: bytesToBase64(joined),
        seconds: total / 2 / LIVE_INPUT_RATE,
        // A permission that was granted and then revoked, or a mic another app
        // has taken, records perfect silence rather than failing. Sending it
        // costs money and comes back as a confused answer, so it is caught here
        // and the screen asks her to speak again.
        silent: peak < 0.01,
      };
    },
    cancel() {
      cancelled = true;
      void finish();
    },
  };
}

/* ---------------------------------------------------------------------------
   The speaker
   --------------------------------------------------------------------------- */

export type PlayerHandle = {
  /** Queue one 24 kHz PCM16 frame as it arrives off the socket. */
  push: (base64: string) => Promise<void>;
  /** Drop everything not yet spoken — she interrupted, or the call ended. */
  stop: () => void;
  close: () => Promise<void>;
};

/**
 * Streaming playback of the reply.
 *
 * A queue rather than one buffer at the end. The model generates about twice as
 * fast as speech, so waiting for the whole answer adds several seconds of
 * silence to every turn — and silence after a question is indistinguishable
 * from the app having failed.
 *
 * Each frame is decoded and enqueued as it arrives; the node plays them in
 * order with no gap. `clearBuffers()` is what makes stopping instant, which
 * matters because the alternative is Apa talking over her.
 */
export function createPlayer(): PlayerHandle {
  const context = new AudioContext({ sampleRate: LIVE_OUTPUT_RATE });
  const queue = new AudioBufferQueueSourceNode(context);
  queue.connect(context.destination);
  queue.start();
  let closed = false;

  return {
    async push(base64: string) {
      if (closed || !base64) return;
      try {
        const buffer = await decodePCMInBase64(base64, LIVE_OUTPUT_RATE, 1);
        if (!closed) queue.enqueueBuffer(buffer);
      } catch {
        // One malformed frame is a click, not a reason to end the call.
      }
    },
    stop() {
      try { queue.clearBuffers(); } catch { /* nothing queued */ }
    },
    async close() {
      closed = true;
      try { queue.clearBuffers(); } catch { /* nothing queued */ }
      try { queue.stop(); } catch { /* not started */ }
      try { await context.close(); } catch { /* already closed */ }
    },
  };
}

/**
 * Put the audio session into a mode that can record and play at once.
 *
 * Without this, starting playback on Android can take the input away and the
 * next turn records silence — which looks exactly like a broken microphone.
 */
export async function prepareLiveSession(): Promise<void> {
  try {
    AudioManager.setAudioSessionOptions({
      iosCategory: 'playAndRecord',
      iosMode: 'voiceChat',
      iosOptions: ['defaultToSpeaker', 'allowBluetoothHFP'],
    });
    await AudioManager.setAudioSessionActivity(true);
  } catch {
    // Older devices reject some combinations. The call still works; the
    // speaker may just be quieter than it should be.
  }
}

export async function releaseLiveSession(): Promise<void> {
  try {
    await AudioManager.setAudioSessionActivity(false);
  } catch {
    // Nothing to release.
  }
}
