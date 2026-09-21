import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityActionEvent, Animated, Easing, LayoutChangeEvent, PanResponder, Pressable,
  StyleSheet, Text, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { useLanguage, useReducedMotion } from '../theme/primitives';
import {
  clipMeta, pauseSpeech, queueStart, resumeSpeech, seekSpeech, speakingToken, speechEnding,
  speechProgress, type SpeechState,
} from './speech';
import {
  playbarReadout, playbarView, seekRatio, tapPlay as decidePlay, tapWaveform as decideSeek,
  type PlaybarView,
} from './playbar';

/*
 * The voice playbar, built to the handoff in
 * shathiapa-design/Audio Playback Bar Artbook/SPEC.md.
 *
 * Section numbers in the comments below refer to that document. Where this
 * departs from it, the comment says so and says why.
 */

/* --- §3 colour tokens, exactly as specified --------------------------------- */

const T = {
  plumInk: '#5E1D3E',       // play / pause glyph
  plumFill: '#7C2A52',      // progress fill, loaded readout
  trackLoaded: '#E0C3D0',   // unplayed bars after load
  trackCold: '#F1DEE6',     // bars before load
  trackLoading: '#DDD8DA',  // bars during load
  trackPeak: '#CDC7CA',     // bar tint at the crest of the loading wave
  buttonWash: '#F8E7EE',    // button background, enabled
  buttonDisabled: '#EDEAEC',// button background, loading
  glyphDisabled: '#B0A3AA', // glyph, loading
  ring: '#D9C3CE',          // radiating loading rings
  readoutCold: '#BDAEB5',   // readout before load
};

/* --- §2 anatomy ------------------------------------------------------------- */

const BUTTON = 46;
const ROW = 44;
const BARS = 36;
const SHORT_BARS = 18;
/** Bar heights span this range inside the 44px row, as the artbook draws them. */
const MIN_H = 6;
const MAX_H = 36;

/* --- §6 motion -------------------------------------------------------------- */

const RING_MS = 1900;
const WAVE_MS = 1700;
const WAVE_STEP_MS = 32;
const DARKEN_MS = 420;
const RESET_FADE_MS = 260;
const FAIL_MS = 2000;

/* --- session memory (§8) ---------------------------------------------------- */

/**
 * Clips loaded this session. "Load never repeats": once a clip has resolved,
 * its darker track is permanent, and a second press must not show grey again.
 */
const loadedThisSession = new Set<string>();

/**
 * Where an interrupted clip was. "Starting one clip sends every other to
 * paused, not finished — their positions survive." Our speech layer has one
 * player, so starting another clip tears the first one down; this is what
 * lets its bar come back as a bookmark rather than as a clip that ended.
 */
const bookmarks = new Map<string, number>();

/* --- helpers ---------------------------------------------------------------- */

/**
 * A stand-in shape for a clip whose audio does not exist yet.
 *
 * DEPARTURE FROM §2. The spec draws the clip's real envelope in every state,
 * including cold. Here the audio is only synthesised when she presses play —
 * `apa_autoplay_voice` is off because synthesising every answer costs about
 * $0.010 each whether or not anyone listens — so before the first press there
 * is no envelope to draw. This stable per-message shape stands in until then,
 * and the real one replaces it on the same frame the track darkens (§5 C), so
 * the shape changes exactly once, at the moment everything else resolves.
 * After that the real envelope is kept with the message and drawn in every
 * state, as specified.
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

/** Down-sample 36 real bars to 18 by taking the louder of each pair. */
function fold(peaks: number[], bars: number): number[] {
  if (peaks.length === bars) return peaks;
  const out: number[] = [];
  const step = peaks.length / bars;
  for (let i = 0; i < bars; i += 1) {
    const from = Math.floor(i * step);
    const to = Math.max(from + 1, Math.floor((i + 1) * step));
    out.push(Math.max(...peaks.slice(from, to)));
  }
  return out;
}

/** The gap scales with the room the bubble gives the waveform. */
function gapFor(width: number): number {
  if (width >= 320) return 6;
  if (width >= 230) return 4;
  if (width >= 180) return 3;
  return 2;
}

/* --- the component ---------------------------------------------------------- */

export function SpeechBar({
  state,
  onToggle,
  /** This clip's speech token — the turn's key. */
  seed = 'apa',
  /** Length as the server measured it, kept with the message once known. */
  seconds = null,
  /** The real waveform, kept with the message once known. */
  peaks = null,
}: {
  state: SpeechState;
  onToggle: () => void;
  seed?: string;
  seconds?: number | null;
  peaks?: number[] | null;
}) {
  const { tx } = useLanguage();
  const reduce = useReducedMotion();

  // What the server has said about this clip: from the message if it was
  // loaded in an earlier session, or from this session's speech layer.
  const meta = clipMeta(seed);
  const realPeaks = peaks ?? meta?.peaks ?? null;
  const knownSeconds = seconds ?? meta?.seconds ?? null;

  /* --- §1 state: loaded latches, never goes back ------------------------- */

  const [loaded, setLoaded] = useState(
    () => loadedThisSession.has(seed) || Boolean(realPeaks && knownSeconds)
  );
  useEffect(() => {
    if (state === 'playing' && !loaded) {
      loadedThisSession.add(seed);
      setLoaded(true);
    }
  }, [state, loaded, seed]);

  /* --- failure, bookmarks and endings (§8) -------------------------------- */

  const [failed, setFailed] = useState(false);
  const [bookmark, setBookmark] = useState<number | null>(() => bookmarks.get(seed) ?? null);
  const [endedFade, setEndedFade] = useState(false);
  const prevState = useRef<SpeechState>(state);
  const reachedPlay = useRef(false);
  const lastP = useRef(0);

  useEffect(() => {
    const before = prevState.current;
    prevState.current = state;

    if (state === 'loading') { reachedPlay.current = false; setFailed(false); return; }
    if (state === 'playing' || state === 'paused') {
      reachedPlay.current = true;
      bookmarks.delete(seed);
      setBookmark(null);
      setFailed(false);
      return;
    }

    // state === 'idle' from here.
    if (before === 'loading' && !reachedPlay.current) {
      // Loading ended without sound. If another clip took over, that is an
      // interruption; if nothing did, the fetch failed. §8: rings stop, button
      // returns to plum, readout "--:--" for two seconds, then back to cold.
      const other = speakingToken();
      if (!other || other === seed) {
        setFailed(true);
        const timer = setTimeout(() => setFailed(false), FAIL_MS);
        return () => clearTimeout(timer);
      }
      return;
    }

    if (before === 'playing' || before === 'paused') {
      if (speechEnding(seed) === 'finished') {
        // §5 F: fill fades, clip snaps to 0, readout returns to the length.
        bookmarks.delete(seed);
        setBookmark(null);
        setEndedFade(true);
      } else {
        // Interrupted — another clip started, she left the screen, or she
        // began recording. §8: paused, not finished; the position survives.
        const at = Math.min(0.995, Math.max(0, lastP.current));
        bookmarks.set(seed, at);
        setBookmark(at);
      }
    }
  }, [state, seed]);

  /* --- the derived view (§4) ---------------------------------------------- */

  // §4, from src/ai/playbar.ts — tested against the spec's own table.
  const view: PlaybarView = playbarView({ speech: state, loaded, bookmarked: bookmark !== null });

  const isLoading = view === 'loading';
  const isPlaying = view === 'playing';

  /* --- geometry ------------------------------------------------------------ */

  const [width, setWidth] = useState(0);
  const barCount = knownSeconds !== null && knownSeconds > 0 && knownSeconds < 3 ? SHORT_BARS : BARS;
  const heights = useMemo(() => {
    const shape = realPeaks && realPeaks.length ? fold(realPeaks, barCount) : standIn(seed, barCount);
    return shape.map((v) => Math.round(MIN_H + Math.max(0, Math.min(1, v)) * (MAX_H - MIN_H)));
  }, [realPeaks, barCount, seed]);
  const gap = gapFor(width);

  /* --- progress: one native value, two layers (§7) ------------------------ */

  const prog = useRef(new Animated.Value(bookmark ?? 0)).current;
  const fillOpacity = useRef(new Animated.Value(1)).current;
  const [p, setP] = useState(bookmark ?? 0);
  const [duration, setDuration] = useState(knownSeconds ?? 0);
  useEffect(() => { if (knownSeconds && knownSeconds > 0) setDuration(knownSeconds); }, [knownSeconds]);

  // Where the running animation started, so drift against the player can be
  // measured without reading a natively-driven value back into JS.
  const anchor = useRef<{ p: number; at: number; dur: number } | null>(null);
  // True while a finger is dragging the edge.
  const dragging = useRef(false);

  const runFrom = useCallback((from: number, dur: number) => {
    prog.stopAnimation();
    prog.setValue(from);
    anchor.current = { p: from, at: Date.now(), dur };
    if (dur <= 0) return;
    // §6: linear, no easing — it is time, not animation.
    Animated.timing(prog, {
      toValue: 1,
      duration: Math.max(0, (1 - from) * dur * 1000),
      easing: Easing.linear,
      useNativeDriver: true,
    }).start();
  }, [prog]);

  // While this clip is the one playing: sample the player, drive the readout,
  // and re-anchor the fill only when it has drifted — restarting it on every
  // sample would make the edge stutter.
  useEffect(() => {
    if (state !== 'playing' && state !== 'paused') return;
    const tick = () => {
      const now = speechProgress();
      if (!now || now.duration <= 0) return;
      const ratio = Math.max(0, Math.min(1, now.position / now.duration));
      lastP.current = ratio;
      setP(ratio);
      setDuration(now.duration);
      if (state === 'paused') {
        prog.stopAnimation();
        prog.setValue(ratio);
        anchor.current = null;
        return;
      }
      // A finger on the waveform owns the edge until it lets go.
      if (dragging.current) return;
      const a = anchor.current;
      const expected = a ? a.p + (Date.now() - a.at) / 1000 / a.dur : -1;
      if (!a || Math.abs(expected - ratio) * now.duration > 0.3) runFrom(ratio, now.duration);
    };
    tick();
    const timer = setInterval(tick, 200);
    return () => clearInterval(timer);
  }, [state, prog, runFrom]);

  // §5 E as a bookmark: frozen where it was.
  useEffect(() => {
    if (state === 'idle' && bookmark !== null) {
      prog.stopAnimation();
      prog.setValue(bookmark);
      setP(bookmark);
      anchor.current = null;
    }
  }, [state, bookmark, prog]);

  // §6 reset on finish: the fill fades over 260ms and the clip snaps to 0.
  // Never a rewind scrub.
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
      lastP.current = 0;
      setEndedFade(false);
    });
  }, [endedFade, prog, fillOpacity]);

  /* --- §6 track darkening, 420ms, the instant load resolves ---------------- */

  const darken = useRef(new Animated.Value(loaded ? 1 : 0)).current;
  useEffect(() => {
    if (!loaded) { darken.setValue(0); return; }
    Animated.timing(darken, {
      toValue: 1, duration: reduce ? 0 : DARKEN_MS, easing: Easing.inOut(Easing.ease),
      useNativeDriver: false,
    }).start();
  }, [loaded, reduce, darken]);
  const trackColour = darken.interpolate({ inputRange: [0, 1], outputRange: [T.trackCold, T.trackLoaded] });

  /* --- §6 loading motion: two rings and a travelling crest ----------------- */

  const ringA = useRef(new Animated.Value(0)).current;
  const ringB = useRef(new Animated.Value(0)).current;
  const wave = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    // Removed, not faded, on resolve (§5 C).
    if (!isLoading || reduce) {
      ringA.setValue(0); ringB.setValue(0); wave.setValue(0);
      return;
    }
    const ring = (v: Animated.Value) =>
      Animated.loop(Animated.timing(v, {
        toValue: 1, duration: RING_MS, easing: Easing.linear, useNativeDriver: true,
      }));
    const a = ring(ringA);
    const b = ring(ringB);
    a.start();
    // "Offset by half a cycle so there is always exactly one in flight."
    const delayed = setTimeout(() => b.start(), RING_MS / 2);
    const w = Animated.loop(Animated.timing(wave, {
      toValue: 1, duration: WAVE_MS, easing: Easing.linear, useNativeDriver: true,
    }));
    w.start();
    return () => { a.stop(); b.stop(); w.stop(); clearTimeout(delayed); };
  }, [isLoading, reduce, ringA, ringB, wave]);

  const ringStyle = (v: Animated.Value) => ({
    // scale 0.82 → 1.5, opacity 0.55 → 0 by 70%, ease-out.
    transform: [{
      scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1.5], easing: Easing.out(Easing.quad) }),
    }],
    opacity: v.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0.55, 0, 0] }),
  });

  /**
   * Each bar's place in the crest.
   *
   * CSS gives every bar the same 1.7s loop with a 32ms × index delay. One
   * shared native value reproduces it without 36 timers: bar i reads the loop
   * shifted by its own offset, wrapped round with a two-point step in the
   * input range (Animated accepts a repeated input value, which is what makes
   * the wrap possible), then maps 0 → 18% → 50% of its cycle to
   * scale 1 → 1.28 → 1, which is the keyframe in §6.
   */
  const crest = useMemo(() => !isLoading ? null : heights.map((_, i) => {
    const offset = ((i * WAVE_STEP_MS) % WAVE_MS) / WAVE_MS;
    const local = offset === 0
      ? wave
      : wave.interpolate({
          inputRange: [0, offset, offset, 1],
          outputRange: [1 - offset, 1, 0, 1 - offset],
        });
    return {
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
  }), [isLoading, heights, wave]);

  /* --- §7 tapWaveform, with a drag ---------------------------------------- */

  const [drag, setDrag] = useState<number | null>(null);
  // Mirrors `drag` for the gesture handlers, which must not read state through
  // an updater: an updater runs during render, and committing a seek from
  // inside one sets state in other components while React is rendering.
  const dragAt = useRef<number | null>(null);
  const touchedAt = useRef<number | null>(null);
  const live = useRef({ width, loading: isLoading, loaded, state, bookmark, view });
  live.current = { width, loading: isLoading, loaded, state, bookmark, view };

  const commit = useCallback((ratio: number) => {
    const at = Math.min(0.995, Math.max(0, ratio));
    const now = live.current;
    const action = decideSeek({ view: now.view, speech: now.state });
    // During loading the tap is remembered and applied when it resolves.
    if (action === 'queue') { queueStart(seed, at); return; }
    if (action === 'seek') {
      // "A seek always plays" — seekSpeech resumes a paused clip.
      prog.stopAnimation();
      prog.setValue(at);
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
    // Horizontal only: this row lives inside the conversation's scroll view,
    // and a responder that claims every move stops her scrolling.
    onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 6 && Math.abs(g.dx) > Math.abs(g.dy),
    onPanResponderTerminationRequest: () => true,
    // The touch-down point is only remembered. Moving the edge on touch-down
    // would flash it every time a finger lands on an answer to scroll past
    // it; a tap commits on release, and a drag moves the edge once it has
    // shown itself to be horizontal.
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
      // §5 E: "Progress jumps with no transition so the finger and the edge
      // stay locked." Not during loading, where the grey never fills in.
      if (!live.current.loading) { prog.stopAnimation(); prog.setValue(at); }
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
      // The scroll view took the gesture. Nothing was chosen, so the edge goes
      // back to the audio: a stopped animation with a still-valid anchor would
      // otherwise never be resynced, and the fill would sit frozen under where
      // her finger had been while the clip played on.
      dragging.current = false;
      dragAt.current = null;
      touchedAt.current = null;
      setDrag(null);
      anchor.current = null;
      if (live.current.state !== 'playing') prog.setValue(live.current.bookmark ?? lastP.current);
    },
  }), [commit, prog]);

  /* --- §7 tapPlay ---------------------------------------------------------- */

  const tapPlay = useCallback(() => {
    // §7, from src/ai/playbar.ts.
    const action = decidePlay({ view, speech: state, bookmarked: bookmark !== null });
    if (action === 'ignore') return;
    if (action === 'pause') { void pauseSpeech(); return; }
    if (action === 'resume') { void resumeSpeech(); return; }
    if (action === 'resume-bookmark' && bookmark !== null) {
      queueStart(seed, bookmark);
      bookmarks.delete(seed);
      setBookmark(null);
    }
    onToggle();                                         // load, replay, or resume from the bookmark
  }, [view, state, bookmark, seed, onToggle]);

  /* --- the readout (§7) --------------------------------------------------- */

  const readout = playbarReadout({ view, loaded, failed, duration, progress: p, drag });

  const a11yLabel = isLoading
    ? tx('কণ্ঠ আনা হচ্ছে', 'Loading')
    : isPlaying
      ? tx('থামান', 'Pause')
      : tx('পড়ে শোনান', 'Play');

  const onA11yAction = (e: AccessibilityActionEvent) => {
    // ←/→ for ±5s, as the spec asks of the keyboard.
    if (!loaded || duration <= 0) return;
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

  const baseColour = isLoading ? T.trackLoading : trackColour;

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
            // §8 reduced motion: a static 60%-opacity button stands in for the rings.
            isLoading && reduce && { opacity: 0.6 },
            pressed && !isLoading && { opacity: 0.85 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={a11yLabel}
          accessibilityState={{ disabled: isLoading, busy: isLoading }}
        >
          <Ionicons
            name={isPlaying ? 'pause' : 'play'}
            size={18}
            color={isLoading ? T.glyphDisabled : T.plumInk}
            // A play triangle sits left-heavy in a circle; two pixels centre it by eye.
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
        accessibilityValue={{ text: `${readout} ${tx('বাকি', 'remaining')}` }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={onA11yAction}
        {...pan.panHandlers}
      >
        {/* Base layer: the track. Drawn once the row has a width, so the
            bars do not appear at one spacing and jump to another. */}
        {width > 0 ? (
        <View style={[sheet.layer, { gap }]} pointerEvents="none">
          {heights.map((h, i) => (
            <Animated.View
              key={i}
              style={[
                sheet.bar,
                {
                  height: h,
                  backgroundColor: baseColour,
                  transform: crest && !reduce ? [{ scaleY: crest[i].scale }] : undefined,
                },
              ]}
            >
              {/* The crest's tint, as an exact overlay rather than a colour
                  animation, so it can run on the native thread with the
                  scale. Mounted only while loading: on resolve the loading
                  motion is removed, not faded (§5 C). */}
              {crest && !reduce ? (
                <Animated.View style={[sheet.peak, { opacity: crest[i].tint }]} />
              ) : null}
            </Animated.View>
          ))}
        </View>
        ) : null}

        {/* Fill layer: the same bars in plum, revealed from the left. RN has
            no clip-path, so the reveal is a window that slides right while its
            contents slide left by the same amount — both transforms, both on
            the native thread, and the bars inside never move relative to the
            track, which is the point of §7's "never width". */}
        {width > 0 && !isLoading ? (
          <Animated.View
            pointerEvents="none"
            style={[
              sheet.window,
              { width, opacity: fillOpacity, transform: [{ translateX: outerX }] },
            ]}
          >
            <Animated.View
              style={[sheet.layer, { width, gap, transform: [{ translateX: innerX }] }]}
            >
              {heights.map((h, i) => (
                <View key={i} style={[sheet.bar, { height: h, backgroundColor: T.plumFill }]} />
              ))}
            </Animated.View>
          </Animated.View>
        ) : null}
      </View>

      <Text
        style={[sheet.readout, { color: loaded && !failed ? T.plumFill : T.readoutCold }]}
        numberOfLines={1}
      >
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
  // §2 puts 18px between parts; a chat bubble is about a third of the
  // artbook's width, so the gaps come down with it and the waveform keeps the
  // room it needs to be hit with a finger.
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10 },
  buttonWrap: { width: BUTTON, height: BUTTON, alignItems: 'center', justifyContent: 'center' },
  // "46px circle, never moves or resizes between states."
  button: {
    width: BUTTON, height: BUTTON, borderRadius: BUTTON / 2,
    alignItems: 'center', justifyContent: 'center',
  },
  // inset: -4px, 2px border.
  ring: {
    position: 'absolute', top: -4, left: -4, right: -4, bottom: -4,
    borderRadius: (BUTTON + 8) / 2, borderWidth: 2, borderColor: T.ring,
  },
  // "The hit area is the full 44px row, not the bar heights."
  wave: { flex: 1, height: ROW, overflow: 'hidden' },
  layer: {
    position: 'absolute', top: 0, bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center',
  },
  window: { position: 'absolute', top: 0, bottom: 0, left: 0, overflow: 'hidden' },
  bar: { flex: 1, minWidth: 1, borderRadius: 3, overflow: 'hidden' },
  peak: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, backgroundColor: T.trackPeak },
  // "Mono, 13px, tabular figures, min-width 34px, right aligned."
  readout: {
    fontFamily: 'monospace', fontSize: 13, fontVariant: ['tabular-nums'],
    minWidth: 34, textAlign: 'right',
  },
});
