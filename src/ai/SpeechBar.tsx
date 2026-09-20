import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated, Easing, LayoutChangeEvent, PanResponder, Pressable, StyleSheet, Text, View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '../theme/colors';
import { useLanguage, useReducedMotion } from '../theme/primitives';
import { seekSpeech, speechProgress, type SpeechState } from './speech';

/** How long the "it loaded" pulse runs before the bar settles. */
const READY_PULSE_MS = 5500;

const BARS = 28;

/**
 * No brand colour anywhere on the row while the clip is being fetched.
 *
 * Neutral rather than a desaturated rose: the point is that the row reads as
 * switched off at a glance, and a warm grey beside the maroon of every other
 * bubble still reads as part of the palette.
 */
const GREY = '#8E8A8C';
const GREY_FILL = '#EFEDEE';
const GREY_LINE = '#C9C4C7';

/**
 * How far through the current clip playback is, 0..1, and how long it is.
 *
 * Sampled six times a second rather than subscribed to: position moves sixty
 * times a second and nothing on screen needs to know that often. Stops
 * sampling entirely when this bar is not the one playing — this lives inside a
 * chat list where sixty of them may be mounted.
 *
 * `duration` is kept after playback stops so the bar can keep showing the
 * clip's length at rest, which is what she reads it for before deciding to
 * press play at all.
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

/**
 * A stable waveform for one message, derived from its own key.
 *
 * Not the real amplitude envelope: getting that means decoding the clip, and
 * the clip is not on the phone until she presses play — so a real waveform
 * could only appear *after* the thing it is meant to invite. A stable
 * pseudo-random one is honest about position, which is what she reads it for,
 * and is identical every time the same message is drawn.
 */
function waveform(seed: string, bars: number): number[] {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const out: number[] = [];
  for (let i = 0; i < bars; i += 1) {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h ^= h >>> 13;
    // 0.3..1: never flat, never all full height, so it reads as speech.
    out.push(0.3 + (((h >>> 0) % 1000) / 1000) * 0.7);
  }
  return out;
}

/** 0:07 — never 7 seconds, never 0:07.4. */
function clock(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return Math.floor(whole / 60) + ':' + String(whole % 60).padStart(2, '0');
}

/**
 * The player under one of Shathi Apa's answers.
 *
 * ## The three states, and what each has to say
 *
 * **Loading.** The whole row goes grey — bars, button and label together, no
 * brand colour anywhere on it. Nothing about it invites a press, because a
 * press cannot do anything yet, and the wait is shown where the progress will
 * appear rather than as a spinner somewhere else.
 *
 * **Just loaded.** A slow glow behind the play button, for five and a half
 * seconds. Its job is to say *the voice arrived* — so it fires once, on the
 * transition out of loading, and then stops. The previous version pulsed
 * whenever a bar was idle, which meant every answer in the history pulsed for
 * ever: a signal that is always on is not a signal.
 *
 * **Playing.** The button is green with a pause glyph, the heard part of the
 * waveform is maroon, a thumb sits at the position, and the clock counts up
 * against the clip's length.
 *
 * ## Seeking
 *
 * The waveform is a seek bar she can tap or drag, at rest as well as during
 * playback. It looks exactly like every other voice message on her phone, so
 * she will try it — and for a spoken answer it earns its place, because the
 * caution is at the end and hearing it again should not mean hearing all of it
 * again. Dragging shows the position immediately and commits on release,
 * rather than firing a seek per pixel.
 *
 * Touching it before the clip exists starts playback and then jumps: the
 * requested point is held and applied as soon as there is something to apply
 * it to.
 */
export function SpeechBar({
  state,
  onToggle,
  /** Distinguishes one message's waveform from the next. */
  seed = 'apa',
  /**
   * The clip's length as the server measured it, where it is known.
   *
   * Without it the bar can only learn the length from the player, which does
   * not exist until she has pressed play — so "0:23" would appear only after
   * she had heard the whole thing.
   */
  seconds = null,
}: {
  state: SpeechState;
  onToggle: () => void;
  seed?: string;
  seconds?: number | null;
}) {
  const { tx } = useLanguage();
  const reduce = useReducedMotion();

  const loading = state === 'loading';
  const playing = state === 'playing';
  const paused = state === 'paused';
  const active = playing || paused;

  const bars = useMemo(() => waveform(seed, BARS), [seed]);
  const { ratio, position, duration: played } = useSpeechProgress(active);
  const [width, setWidth] = useState(0);

  // The player's own figure wins once it has one: it is the clip actually on
  // the phone. The server's is what to show before that.
  const duration = played > 0 ? played : Number(seconds ?? 0) > 0 ? Number(seconds) : 0;

  /* --- just loaded: one pulse, then quiet ------------------------------- */

  const [ready, setReady] = useState(false);
  const wasLoading = useRef(false);

  useEffect(() => {
    // The transition out of loading is the only thing that means "the voice
    // arrived". A bar that was never loading — every answer already in the
    // history — never enters this state at all.
    if (loading) {
      wasLoading.current = true;
      setReady(false);
      return;
    }
    if (!wasLoading.current) return;
    wasLoading.current = false;
    setReady(true);
    const timer = setTimeout(() => setReady(false), READY_PULSE_MS);
    return () => clearTimeout(timer);
  }, [loading]);

  const glow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!ready || reduce) {
      glow.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 850, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0, duration: 700, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [ready, reduce, glow]);

  /* --- loading: the bar is the loader ----------------------------------- */

  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!loading || reduce) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 620, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 620, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [loading, reduce, pulse]);

  /* --- seeking ---------------------------------------------------------- */

  // Where her finger is, while it is down. Null the rest of the time, so the
  // real position takes over the moment she lets go.
  const [dragRatio, setDragRatio] = useState<number | null>(null);
  const widthRef = useRef(0);
  const activeRef = useRef(false);
  const loadingRef = useRef(false);
  // A point asked for before there was a clip to apply it to.
  const pendingSeek = useRef<number | null>(null);

  activeRef.current = active;
  loadingRef.current = loading;
  widthRef.current = width;

  const commitSeek = useCallback((next: number) => {
    const clamped = Math.max(0, Math.min(1, next));
    if (activeRef.current) {
      void seekSpeech(clamped);
      return;
    }
    // Nothing is loaded: start it, and hold the point until it exists.
    pendingSeek.current = clamped;
    onToggle();
  }, [onToggle]);

  // Applied once the clip has a duration. Without the hold, a tap on the
  // waveform of an unplayed answer would start it from the beginning and throw
  // the one thing she asked for away.
  useEffect(() => {
    if (pendingSeek.current === null) return;
    if (!active || duration <= 0) return;
    const to = pendingSeek.current;
    pendingSeek.current = null;
    void seekSpeech(to);
  }, [active, duration]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !loadingRef.current,
        // Horizontal only, and only past six pixels. This bar lives inside the
        // conversation's scroll view, and a responder that claims every move
        // stops her scrolling the moment she puts a finger on an answer.
        onMoveShouldSetPanResponder: (_event, gesture) =>
          !loadingRef.current &&
          Math.abs(gesture.dx) > 6 &&
          Math.abs(gesture.dx) > Math.abs(gesture.dy),
        // And if the scroll view decides the gesture is really a scroll, it can
        // have it.
        onPanResponderTerminationRequest: () => true,
        onPanResponderGrant: (event) => {
          if (widthRef.current <= 0) return;
          setDragRatio(Math.max(0, Math.min(1, event.nativeEvent.locationX / widthRef.current)));
        },
        onPanResponderMove: (event) => {
          if (widthRef.current <= 0) return;
          setDragRatio(Math.max(0, Math.min(1, event.nativeEvent.locationX / widthRef.current)));
        },
        onPanResponderRelease: () => {
          setDragRatio((current) => {
            if (current !== null) commitSeek(current);
            return null;
          });
        },
        onPanResponderTerminate: () => setDragRatio(null),
      }),
    [commitSeek]
  );

  /* --- what it says ----------------------------------------------------- */

  const shown = dragRatio ?? ratio;
  const label = loading
    ? tx('আনা হচ্ছে…', 'Getting it…')
    : duration > 0
      ? dragRatio !== null
        // Her finger's position, not the clip's — she is choosing, not listening.
        ? clock(dragRatio * duration) + ' / ' + clock(duration)
        : active
          ? clock(position) + ' / ' + clock(duration)
          : clock(duration)
      : tx('পড়ে শোনান', 'Read aloud');

  const barColour = (heard: boolean) =>
    loading ? GREY_LINE : heard ? colors.maroon : colors.line;

  return (
    <View style={sheet.row}>
      <View style={sheet.mainWrap}>
        {ready && !reduce ? (
          <Animated.View
            pointerEvents="none"
            style={[
              sheet.glow,
              {
                opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0, 0.38] }),
                transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.5] }) }],
              },
            ]}
          />
        ) : null}
        <Pressable
          onPress={() => {
            // Any press ends the "it arrived" pulse: she has seen it.
            setReady(false);
            if (!loading) onToggle();
          }}
          disabled={loading}
          hitSlop={8}
          style={({ pressed }) => [
            sheet.main,
            playing && sheet.mainPlaying,
            paused && sheet.mainPaused,
            loading && sheet.mainLoading,
            pressed && !loading && sheet.pressed,
          ]}
          accessibilityRole="button"
          accessibilityState={{ disabled: loading, busy: loading, selected: playing }}
          accessibilityLabel={
            loading
              ? tx('কণ্ঠ আনা হচ্ছে', 'Getting the voice')
              : playing
                ? tx('থামান', 'Pause')
                : paused
                  ? tx('আবার চালান', 'Resume')
                  : tx('পড়ে শোনান', 'Read aloud')
          }
        >
          <Ionicons
            name={loading ? 'ellipsis-horizontal' : playing ? 'pause' : 'play'}
            size={15}
            color={playing ? '#fff' : loading ? GREY : colors.maroon}
          />
        </Pressable>
      </View>

      {/* Progress, loader and seek bar, in one control. */}
      <View
        style={sheet.wave}
        onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
        accessibilityRole="adjustable"
        accessibilityLabel={tx('যেখান থেকে শুনতে চান চাপুন', 'Tap or drag to play from a point')}
        accessibilityState={{ disabled: loading }}
        accessibilityValue={{ min: 0, max: 100, now: Math.round(shown * 100) }}
        {...pan.panHandlers}
      >
        {bars.map((h, i) => {
          // Fractional, so the boundary bar fills partway rather than the fill
          // jumping a whole bar at a time.
          const edge = shown * BARS;
          const heard = i < Math.floor(edge);
          const partial = i === Math.floor(edge) && edge % 1 > 0.35;
          return (
            <Animated.View
              key={i}
              style={[
                sheet.bar,
                {
                  height: Math.max(3, Math.round(h * 20)),
                  backgroundColor: barColour(heard || partial),
                  opacity: loading
                    ? reduce
                      ? 0.5
                      : pulse.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.75] })
                    : heard
                      ? 1
                      : partial
                        ? 0.55
                        : 0.8,
                },
              ]}
            />
          );
        })}

        {/* The thumb. Nothing else on the row says "you can move this". */}
        {!loading && width > 0 && (active || dragRatio !== null || duration > 0) ? (
          <View
            pointerEvents="none"
            style={[
              sheet.thumb,
              dragRatio !== null && sheet.thumbHeld,
              { left: Math.max(0, Math.min(width - 12, shown * width - 6)) },
            ]}
          />
        ) : null}
      </View>

      <Text style={[sheet.caption, loading && sheet.grey]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const sheet = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  mainWrap: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  glow: { position: 'absolute', width: 30, height: 30, borderRadius: 15, backgroundColor: colors.maroon },
  main: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.rose,
    borderWidth: 1,
    borderColor: colors.line,
  },
  // Green while playing: the one control whose state has to be readable at a
  // glance, from across a room.
  mainPlaying: { backgroundColor: colors.green, borderColor: colors.green },
  mainPaused: { backgroundColor: colors.rose, borderColor: colors.maroon },
  // Grey, not dimmed. While the clip is being fetched there is no brand colour
  // anywhere on this row, so "not yet" is legible without reading the label.
  mainLoading: { backgroundColor: GREY_FILL, borderColor: GREY_LINE },
  grey: { color: GREY },
  pressed: { opacity: 0.6 },
  wave: {
    flex: 1,
    height: 26,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  bar: { width: 2.5, borderRadius: 2 },
  thumb: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.maroon,
    borderWidth: 2,
    borderColor: colors.card,
  },
  thumbHeld: { transform: [{ scale: 1.25 }] },
  // Wide enough for "0:07 / 1:24" without wrapping, and tabular so the digits
  // do not shuffle the layout as they count.
  caption: {
    color: colors.muted,
    fontSize: 11,
    width: 74,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
});
