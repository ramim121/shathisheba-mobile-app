import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityActionEvent, Animated, Easing, LayoutChangeEvent, PanResponder, Pressable,
  StyleSheet, Text, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useLanguage, useReducedMotion } from '../theme/primitives';
import {
  pauseSpeech, queueStart, rememberHeard, resumeSpeech, seekSpeech, speakingToken, speechEnding,
  speechProgress, useClipInfo, useSpeechFor,
} from './speech';
import {
  heardInFull, playbarReadout, playbarView, readoutIsLive, seekRatio, SLOW_LOAD_MS,
  tapPlay as decidePlay, tapWaveform as decideSeek,
} from './playbar';

/*
 * The voice playbar, built to the handoff in
 * shathiapa-design/Audio Playback Bar Artbook/SPEC.md, with the field test's
 * two amendments (see src/ai/playbar.ts): the readout counts up, and the
 * length is kept only once an answer has been heard in full.
 *
 * WHY IT NEVER WORKED BEFORE. For five rounds this component was handed its
 * state as a prop, through the chat's context — and that context's memoised
 * value left `speakingKey` and `speakingState` out of its dependency list. So
 * every playbar was told "idle" for ever: it never drew loading, never showed
 * pause, and its progress sampler (which runs only while playing) never ran.
 * It now reads its own clip's state straight from the speech layer.
 */

/* --- §3 colour tokens, exactly as specified --------------------------------- */

const T = {
  plumInk: '#5E1D3E',
  plumFill: '#7C2A52',
  trackLoaded: '#E0C3D0',
  trackCold: '#F1DEE6',
  trackLoading: '#DDD8DA',
  trackPeak: '#CDC7CA',
  buttonWash: '#F8E7EE',
  buttonDisabled: '#EDEAEC',
  glyphDisabled: '#B0A3AA',
  ring: '#D9C3CE',
  readoutCold: '#BDAEB5',
};

/* --- §2 anatomy ------------------------------------------------------------- */

const BUTTON = 46;
const ROW = 44;
const BARS = 36;
const MIN_H = 6;
const MAX_H = 36;

/* --- §6 motion -------------------------------------------------------------- */

const RING_MS = 1900;
const WAVE_MS = 1700;
const WAVE_STEP_MS = 32;
const DARKEN_MS = 420;
const RESET_FADE_MS = 260;
const FAIL_MS = 2000;
/** How often the playing bar samples the player. */
const SAMPLE_MS = 200;

/* --- session memory (§8) ---------------------------------------------------- */

/** Clips loaded this session: their track stays dark (§8 "Load never repeats"). */
const loadedThisSession = new Set<string>();
/** Interrupted clips and where they were, as a fraction (§8 "One player at a time"). */
const bookmarks = new Map<string, number>();
/* --- helpers ---------------------------------------------------------------- */

/**
 * A stand-in shape for a clip whose audio does not exist yet.
 *
 * DEPARTURE FROM §2. The spec draws the real envelope in every state. Audio is
 * only synthesised when she presses play (autoplay is off: synthesising every
 * answer costs ~$0.010 whether or not anyone listens), so before the first
 * press there is no envelope. This stable per-message shape stands in until
 * then; the real one replaces it on the frame the track darkens, and is kept
 * with the message after that.
 */
function standIn(seed: string, bars: number): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Array.from({ length: bars }, () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h ^= h >>> 13;
    return ((h >>> 0) % 1000) / 1000;
  });
}

function gapFor(width: number): number {
  if (width >= 320) return 6;
  if (width >= 230) return 4;
  if (width >= 180) return 3;
  return 2;
}

/* --- the component ---------------------------------------------------------- */

export function SpeechBar({
  onToggle,
  seed = 'apa',
  heardSeconds = null,
  peaks = null,
  onHeard,
}: {
  /** Start this clip (load, or replay). Pause and resume are handled here. */
  onToggle: () => void;
  /** This clip's speech token — the turn's key. */
  seed?: string;
  /** The answer's length, once it has been heard in full. */
  heardSeconds?: number | null;
  /** The real waveform, kept with the message once known. */
  peaks?: number[] | null;
  /** Called once when the answer has played to its end, with its length. */
  onHeard?: (seconds: number) => void;
}) {
  const { tx } = useLanguage();
  const reduce = useReducedMotion();

  // The live state of this clip, from the source.
  const state = useSpeechFor(seed);

  // Length, waveform and heard-in-full length, persisted across restarts.
  const info = useClipInfo(seed);
  const meta = info.meta;
  const realPeaks = peaks ?? meta?.peaks ?? null;
  const heard = heardSeconds ?? info.heard ?? null;

  /* --- §1 the loaded latch ------------------------------------------------ */

  const [loaded, setLoaded] = useState(() => loadedThisSession.has(seed) || Boolean(realPeaks));
  useEffect(() => {
    if (state === 'playing' && !loaded) {
      loadedThisSession.add(seed);
      setLoaded(true);
    }
  }, [state, loaded, seed]);
  // Stored information arrives from storage a moment after launch. A clip whose
  // real waveform is on record was loaded in an earlier session, so it draws as
  // loaded (§5 F) rather than cold — but never while a load is in flight.
  useEffect(() => {
    if (!loaded && realPeaks && state === 'idle') setLoaded(true);
  }, [loaded, realPeaks, state]);

  /* --- a reload that is slow enough to show ------------------------------- */

  const [slowLoad, setSlowLoad] = useState(false);
  useEffect(() => {
    if (state !== 'loading') { setSlowLoad(false); return; }
    const timer = setTimeout(() => setSlowLoad(true), SLOW_LOAD_MS);
    return () => clearTimeout(timer);
  }, [state]);

  /* --- the clock ------------------------------------------------------------ */

  // Seconds played, run on the wall clock and corrected by the player whenever
  // it reports. If the player's own figures are late, zero or missing, the
  // readout and the fill still move — they are never hostage to one source.
  const clock = useRef({ base: 0, at: 0, running: false });
  const elapsedNow = () =>
    clock.current.base + (clock.current.running ? (Date.now() - clock.current.at) / 1000 : 0);
  const [elapsed, setElapsed] = useState(0);
  const [duration, setDuration] = useState(meta?.seconds ?? heard ?? 0);
  const durationRef = useRef(duration);
  durationRef.current = duration;
  const playerDuration = useRef(0);

  /* --- failure, bookmarks and endings (§8) -------------------------------- */

  const [failed, setFailed] = useState(false);
  const [bookmark, setBookmark] = useState<number | null>(() => bookmarks.get(seed) ?? null);
  const [endedFade, setEndedFade] = useState(false);
  const prevState = useRef(state);
  const reachedPlay = useRef(false);

  useEffect(() => {
    const before = prevState.current;
    prevState.current = state;

    if (state === 'loading') {
      reachedPlay.current = false;
      setFailed(false);
      return;
    }

    if (state === 'playing') {
      reachedPlay.current = true;
      bookmarks.delete(seed);
      setBookmark(null);
      setFailed(false);
      if (before === 'paused') {
        clock.current = { ...clock.current, at: Date.now(), running: true };
      } else {
        // A fresh start, a resumed bookmark or a queued seek: the speech layer
        // has already placed the player, so start the clock where it is.
        const now = speechProgress();
        const at = now && now.duration > 0 ? now.position : 0;
        clock.current = { base: at, at: Date.now(), running: true };
        if (now && now.duration > 0) playerDuration.current = now.duration;
      }
      return;
    }

    if (state === 'paused') {
      clock.current = { base: elapsedNow(), at: Date.now(), running: false };
      setElapsed(clock.current.base);
      return;
    }

    // state === 'idle' from here.
    const stoppedAt = elapsedNow();
    clock.current = { ...clock.current, running: false };

    if (before === 'loading' && !reachedPlay.current) {
      // Loading ended without sound. Another clip taking over is an
      // interruption; nothing taking over is a failed fetch. §8: "--:--" for
      // two seconds, then back to cold.
      const other = speakingToken();
      if (!other || other === seed) {
        setFailed(true);
        const timer = setTimeout(() => setFailed(false), FAIL_MS);
        return () => clearTimeout(timer);
      }
      return;
    }

    if (before === 'playing' || before === 'paused') {
      if (heardInFull(speechEnding(seed))) {
        // Heard to the end. Keep the length: the player's own measurement if
        // it gave one, the server's if not, and the wall clock as a last
        // resort — which after a full play is the length by definition.
        const length = playerDuration.current || meta?.seconds || stoppedAt;
        if (length > 0) {
          rememberHeard(seed, length);
          onHeard?.(length);
          setDuration(length);
        }
        bookmarks.delete(seed);
        setBookmark(null);
        setEndedFade(true);
      } else {
        // Interrupted — another answer started, she left the screen, or she
        // began recording. Paused, not finished; the position survives.
        const d = durationRef.current;
        const at = d > 0 ? Math.min(0.995, Math.max(0, stoppedAt / d)) : 0;
        bookmarks.set(seed, at);
        setBookmark(at);
        setElapsed(stoppedAt);
      }
    }
  }, [state, seed]); // eslint-disable-line react-hooks/exhaustive-deps

  /* --- the derived view (§4) ---------------------------------------------- */

  const view = playbarView({ speech: state, loaded, bookmarked: bookmark !== null, slowLoad });
  const isLoading = view === 'loading';
  const isPlaying = view === 'playing';

  /* --- geometry ------------------------------------------------------------ */

  const [width, setWidth] = useState(0);
  const firstLoad = state === 'loading' && !loaded;
  const shapePeaks = firstLoad ? null : realPeaks;
  const heights = useMemo(() => {
    const shape = shapePeaks && shapePeaks.length === BARS ? shapePeaks : standIn(seed, BARS);
    return shape.map((v) => Math.round(MIN_H + Math.max(0, Math.min(1, v)) * (MAX_H - MIN_H)));
  }, [shapePeaks, seed]);
  const gap = gapFor(width);

  /* --- the fill: one native value, two layers ----------------------------- */

  const prog = useRef(new Animated.Value(bookmark ?? 0)).current;
  const fillOpacity = useRef(new Animated.Value(1)).current;
  const [p, setP] = useState(bookmark ?? 0);
  const anchor = useRef<{ p: number; at: number; dur: number } | null>(null);
  const dragging = useRef(false);

  const runFrom = useCallback((from: number, dur: number) => {
    prog.stopAnimation();
    prog.setValue(from);
    anchor.current = { p: from, at: Date.now(), dur };
    if (dur <= 0) return;
    // §6: linear — it is time, not animation.
    Animated.timing(prog, {
      toValue: 1,
      duration: Math.max(0, (1 - from) * dur * 1000),
      easing: Easing.linear,
      useNativeDriver: true,
    }).start();
  }, [prog]);

  // While this clip is live: sample, correct the clock, drive readout and fill.
  useEffect(() => {
    if (state !== 'playing' && state !== 'paused') return;
    const tick = () => {
      const now = speechProgress();
      if (now && now.duration > 0) {
        playerDuration.current = now.duration;
        // The player is the truth when it speaks; the clock only fills gaps.
        if (Math.abs(now.position - elapsedNow()) > 0.35) {
          clock.current = { ...clock.current, base: now.position, at: Date.now() };
        }
      }
      const dur = playerDuration.current || meta?.seconds || heard || 0;
      const secs = dur > 0 ? Math.min(elapsedNow(), dur) : elapsedNow();
      setElapsed(secs);
      if (dur > 0) setDuration(dur);
      if (dur <= 0 || dragging.current) return;

      const ratio = Math.min(1, secs / dur);
      setP(ratio);
      if (state === 'paused') {
        prog.stopAnimation();
        prog.setValue(ratio);
        anchor.current = null;
        return;
      }
      const a = anchor.current;
      const expected = a ? a.p + (Date.now() - a.at) / 1000 / a.dur : -1;
      if (!a || Math.abs(expected - ratio) * dur > 0.3) runFrom(ratio, dur);
    };
    tick();
    const timer = setInterval(tick, SAMPLE_MS);
    return () => clearInterval(timer);
  }, [state, prog, runFrom]); // eslint-disable-line react-hooks/exhaustive-deps

  // A bookmark is frozen where it was.
  useEffect(() => {
    if (state === 'idle' && bookmark !== null) {
      prog.stopAnimation();
      prog.setValue(bookmark);
      setP(bookmark);
      anchor.current = null;
    }
  }, [state, bookmark, prog]);

  // §6 reset on finish: fill fades over 260ms and snaps to 0. No rewind.
  useEffect(() => {
    if (!endedFade) return;
    anchor.current = null;
    prog.stopAnimation();
    Animated.timing(fillOpacity, {
      toValue: 0, duration: RESET_FADE_MS, easing: Easing.linear, useNativeDriver: true,
    }).start(() => {
      prog.setValue(0);
      fillOpacity.setValue(1);
      setP(0);
      setElapsed(0);
      clock.current = { base: 0, at: 0, running: false };
      setEndedFade(false);
    });
  }, [endedFade, prog, fillOpacity]);

  /* --- §6 track darkening -------------------------------------------------- */

  const darken = useRef(new Animated.Value(loaded ? 1 : 0)).current;
  useEffect(() => {
    if (!loaded) { darken.setValue(0); return; }
    Animated.timing(darken, {
      toValue: 1, duration: reduce ? 0 : DARKEN_MS, easing: Easing.inOut(Easing.ease),
      useNativeDriver: false,
    }).start();
  }, [loaded, reduce, darken]);
  const trackColour = darken.interpolate({ inputRange: [0, 1], outputRange: [T.trackCold, T.trackLoaded] });

  /* --- §6 loading motion ---------------------------------------------------- */

  const ringA = useRef(new Animated.Value(0)).current;
  const ringB = useRef(new Animated.Value(0)).current;
  const wave = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Removed, not faded, when loading ends (§5 C).
    if (!isLoading || reduce) {
      ringA.stopAnimation(); ringB.stopAnimation(); wave.stopAnimation();
      ringA.setValue(0); ringB.setValue(0); wave.setValue(0);
      return;
    }
    const loop = (v: Animated.Value, ms: number) =>
      Animated.loop(Animated.timing(v, { toValue: 1, duration: ms, easing: Easing.linear, useNativeDriver: true }));
    const a = loop(ringA, RING_MS);
    const b = loop(ringB, RING_MS);
    const w = loop(wave, WAVE_MS);
    a.start();
    w.start();
    // "Offset by half a cycle so there is always exactly one in flight."
    const delayed = setTimeout(() => b.start(), RING_MS / 2);
    return () => { a.stop(); b.stop(); w.stop(); clearTimeout(delayed); };
  }, [isLoading, reduce, ringA, ringB, wave]);

  const ringStyle = (v: Animated.Value) => ({
    transform: [{
      scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1.5], easing: Easing.out(Easing.quad) }),
    }],
    opacity: v.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0.55, 0, 0] }),
  });

  /**
   * Each bar's place in the travelling crest.
   *
   * CSS gives every bar the same 1.7s loop delayed by 32ms × its index. Here one
   * shared native loop drives all 36: each bar reads it shifted by its own
   * offset and wrapped with `Animated.modulo`, both of which run on the native
   * thread. (The previous version wrapped by repeating a point in an
   * interpolation's input range, which leaves a zero-width segment for the
   * native driver to divide by.)
   */
  const crest = useMemo(() => {
    if (!isLoading) return null;
    return heights.map((_, i) => {
      const offset = ((i * WAVE_STEP_MS) % WAVE_MS) / WAVE_MS;
      const local = offset === 0 ? wave : Animated.modulo(Animated.add(wave, 1 - offset), 1);
      return {
        // 0 → 18% → 50% of the cycle: scale 1 → 1.28 → 1, the keyframe in §6.
        scale: local.interpolate({
          inputRange: [0, 0.18, 0.5, 1],
          outputRange: [1, 1.28, 1, 1],
          easing: Easing.inOut(Easing.ease),
        }),
        tint: local.interpolate({
          inputRange: [0, 0.18, 0.5, 1],
          outputRange: [0, 1, 0, 0],
          easing: Easing.inOut(Easing.ease),
        }),
      };
    });
  }, [isLoading, heights, wave]);

  /* --- §7 tapWaveform, with a drag ---------------------------------------- */

  const [drag, setDrag] = useState<number | null>(null);
  const dragAt = useRef<number | null>(null);
  const touchedAt = useRef<number | null>(null);
  const live = useRef({ width, view, state, bookmark, p });
  live.current = { width, view, state, bookmark, p };

  const commit = useCallback((ratio: number) => {
    const at = Math.min(0.995, Math.max(0, ratio));
    const now = live.current;
    const action = decideSeek({ view: now.view, speech: now.state });
    if (action === 'queue') { queueStart(seed, at); return; }
    if (action === 'seek') {
      // "A seek always plays" — seekSpeech resumes a paused clip.
      const d = durationRef.current;
      if (d > 0) clock.current = { base: at * d, at: Date.now(), running: true };
      anchor.current = null;
      setP(at);
      void seekSpeech(at);
      return;
    }
    // Cold, finished or bookmarked: start it, from here.
    bookmarks.delete(seed);
    setBookmark(null);
    prog.setValue(at);
    setP(at);
    queueStart(seed, at);
    onToggle();
  }, [seed, prog, onToggle]);

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    // Horizontal only: this row lives inside the conversation's scroll view.
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy),
    onPanResponderTerminationRequest: () => true,
    onPanResponderGrant: (e) => {
      const w = live.current.width;
      touchedAt.current = w > 0 ? seekRatio(e.nativeEvent.locationX, w) : null;
    },
    onPanResponderMove: (e, g) => {
      const w = live.current.width;
      if (w <= 0 || Math.abs(g.dx) < 6 || Math.abs(g.dx) < Math.abs(g.dy)) return;
      const at = seekRatio(e.nativeEvent.locationX, w);
      dragging.current = true;
      dragAt.current = at;
      setDrag(at);
      if (live.current.view !== 'loading') { prog.stopAnimation(); prog.setValue(at); }
    },
    onPanResponderRelease: () => {
      const at = dragAt.current ?? touchedAt.current;
      dragging.current = false;
      dragAt.current = null;
      touchedAt.current = null;
      setDrag(null);
      if (at !== null) commit(at);
    },
    onPanResponderTerminate: () => {
      // The scroll view took the gesture: nothing was chosen, so hand the
      // edge back to the clock.
      dragging.current = false;
      dragAt.current = null;
      touchedAt.current = null;
      setDrag(null);
      anchor.current = null;
      if (live.current.state !== 'playing') prog.setValue(live.current.bookmark ?? live.current.p);
    },
  }), [commit, prog]);

  /* --- §7 tapPlay ---------------------------------------------------------- */

  const tapPlay = useCallback(() => {
    const action = decidePlay({ view, speech: state, bookmarked: bookmark !== null });
    if (action === 'ignore') return;
    if (action === 'pause') { void pauseSpeech(); return; }
    if (action === 'resume') { void resumeSpeech(); return; }
    if (action === 'resume-bookmark' && bookmark !== null) {
      queueStart(seed, bookmark);
      bookmarks.delete(seed);
      setBookmark(null);
    }
    onToggle();
  }, [view, state, bookmark, seed, onToggle]);

  /* --- the readout ----------------------------------------------------------- */

  const readout = playbarReadout({ view, failed, elapsed, heardSeconds: heard, duration, drag });
  const readoutLive = readoutIsLive({ view, failed, heardSeconds: heard });

  const onA11yAction = (e: AccessibilityActionEvent) => {
    if (duration <= 0) return;
    const step = 5 / duration;
    if (e.nativeEvent.actionName === 'increment') commit(p + step);
    if (e.nativeEvent.actionName === 'decrement') commit(p - step);
  };

  /* --- layers --------------------------------------------------------------- */

  const outerX = useMemo(
    () => prog.interpolate({ inputRange: [0, 1], outputRange: [-width, 0] }),
    [prog, width]
  );
  const innerX = useMemo(
    () => prog.interpolate({ inputRange: [0, 1], outputRange: [width, 0] }),
    [prog, width]
  );

  return (
    <View style={sheet.row}>
      <View style={sheet.buttonWrap}>
        {isLoading && !reduce ? (
          <>
            <Animated.View pointerEvents="none" style={[sheet.ring, ringStyle(ringA)]} />
            <Animated.View pointerEvents="none" style={[sheet.ring, ringStyle(ringB)]} />
          </>
        ) : null}
        <Pressable
          onPress={tapPlay}
          disabled={isLoading}
          hitSlop={6}
          style={({ pressed }) => [
            sheet.button,
            { backgroundColor: isLoading ? T.buttonDisabled : T.buttonWash },
            isLoading && reduce && { opacity: 0.6 },
            pressed && !isLoading && { opacity: 0.85, transform: [{ scale: 0.96 }] },
          ]}
          accessibilityRole="button"
          accessibilityLabel={
            isLoading ? tx('কণ্ঠ আনা হচ্ছে', 'Loading') : isPlaying ? tx('থামান', 'Pause') : tx('পড়ে শোনান', 'Play')
          }
          accessibilityState={{ disabled: isLoading, busy: isLoading }}
        >
          <Ionicons
            name={isPlaying ? 'pause' : 'play'}
            size={18}
            color={isLoading ? T.glyphDisabled : T.plumInk}
            style={isPlaying ? undefined : { marginLeft: 3 }}
          />
        </Pressable>
      </View>

      <View
        style={sheet.wave}
        onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={tx('অবস্থান', 'Seek')}
        accessibilityValue={{ text: readout }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={onA11yAction}
        {...pan.panHandlers}
      >
        {width > 0 ? (
          <View style={[sheet.layer, { gap }]} pointerEvents="none">
            {heights.map((h, i) => (
              <Animated.View
                key={i}
                style={[
                  sheet.bar,
                  {
                    height: h,
                    backgroundColor: isLoading ? T.trackLoading : trackColour,
                    transform: crest && !reduce ? [{ scaleY: crest[i].scale }] : undefined,
                  },
                ]}
              >
                {crest && !reduce ? (
                  <Animated.View style={[sheet.peak, { opacity: crest[i].tint }]} />
                ) : null}
              </Animated.View>
            ))}
          </View>
        ) : null}

        {/* The fill: the same bars in plum, revealed by a window sliding right
            while its contents slide left by the same amount — so the bars never
            move relative to the track. RN has no clip-path. */}
        {width > 0 && !isLoading ? (
          <Animated.View
            pointerEvents="none"
            style={[sheet.window, { width, opacity: fillOpacity, transform: [{ translateX: outerX }] }]}
          >
            <Animated.View style={[sheet.fillRow, { width, gap, transform: [{ translateX: innerX }] }]}>
              {heights.map((h, i) => (
                <View key={i} style={[sheet.bar, { height: h, backgroundColor: T.plumFill }]} />
              ))}
            </Animated.View>
          </Animated.View>
        ) : null}
      </View>

      <Text style={[sheet.readout, { color: readoutLive ? T.plumFill : T.readoutCold }]} numberOfLines={1}>
        {readout}
      </Text>
    </View>
  );
}

/**
 * How far through the current clip playback is, 0..1.
 *
 * For her own recording's bubble, which draws a simpler waveform and only
 * needs the ratio.
 */
export function useSpeechProgress(active: boolean): { ratio: number; position: number; duration: number } {
  const [at, setAt] = useState({ ratio: 0, position: 0, duration: 0 });
  useEffect(() => {
    if (!active) {
      setAt((prev) => ({ ratio: 0, position: 0, duration: prev.duration }));
      return;
    }
    const tick = () => {
      const now = speechProgress();
      if (!now || now.duration <= 0) return;
      setAt({
        ratio: Math.max(0, Math.min(1, now.position / now.duration)),
        position: now.position,
        duration: now.duration,
      });
    };
    tick();
    const timer = setInterval(tick, 160);
    return () => clearInterval(timer);
  }, [active]);
  return at;
}

const sheet = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10 },
  buttonWrap: { width: BUTTON, height: BUTTON, alignItems: 'center', justifyContent: 'center' },
  button: {
    width: BUTTON, height: BUTTON, borderRadius: BUTTON / 2,
    alignItems: 'center', justifyContent: 'center',
  },
  ring: {
    position: 'absolute', top: -4, left: -4, right: -4, bottom: -4,
    borderRadius: (BUTTON + 8) / 2, borderWidth: 2, borderColor: T.ring,
  },
  wave: { flex: 1, height: ROW, overflow: 'hidden' },
  layer: {
    position: 'absolute', top: 0, bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center',
  },
  fillRow: { position: 'absolute', top: 0, bottom: 0, left: 0, flexDirection: 'row', alignItems: 'center' },
  window: { position: 'absolute', top: 0, bottom: 0, left: 0, overflow: 'hidden' },
  bar: { flex: 1, minWidth: 1, borderRadius: 3, overflow: 'hidden' },
  peak: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: T.trackPeak },
  readout: {
    fontFamily: 'monospace', fontSize: 13, fontVariant: ['tabular-nums'],
    minWidth: 34, textAlign: 'right',
  },
});
