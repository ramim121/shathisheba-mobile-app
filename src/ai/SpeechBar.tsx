import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Easing, LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '../theme/colors';
import { useLanguage, useReducedMotion } from '../theme/primitives';
import { restartSpeech, seekSpeech, speechProgress, type SpeechState } from './speech';

/**
 * How far through the current clip playback is, 0..1.
 *
 * Sampled four times a second rather than subscribed to: position moves sixty
 * times a second and nothing on screen needs to know that often. Returns 0
 * when nothing is playing, and stops sampling entirely then — this is used
 * inside a chat list where there may be sixty of them mounted.
 */
export function useSpeechProgress(active: boolean): number {
  const [ratio, setRatio] = useState(0);
  useEffect(() => {
    if (!active) {
      setRatio(0);
      return;
    }
    const tick = () => {
      const at = speechProgress();
      if (at) setRatio(at.duration > 0 ? at.position / at.duration : 0);
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [active]);
  return ratio;
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
    // 0.28..1: never flat, never all full height, so it reads as speech.
    out.push(0.28 + (((h >>> 0) % 1000) / 1000) * 0.72);
  }
  return out;
}

/**
 * The player under one of Shathi Apa's answers.
 *
 * ## What this replaces
 *
 * The original row had a play glyph, a track and a caption, and two of the
 * three lied. The track's fill was `width: '35%'` — a constant, so it looked
 * like progress and reported nothing, which is worse than no bar at all: one
 * that never moves reads as a stuck download. The button had no loading state
 * either, so the second or two spent fetching a clip looked identical to a
 * button that had ignored the press.
 *
 * ## The three states, and what each has to say
 *
 * **Loading.** The whole bar is read-only and breathes: the waveform flattens
 * to grey and pulses. Nothing about it invites a press, because a press cannot
 * do anything yet. The wait is shown where the progress will appear — which is
 * where she is already looking — rather than as a spinner elsewhere.
 *
 * **Ready.** The waveform is solid and the play button carries a slow outer
 * glow. That glow is the only moving thing on the row, so what to press next
 * is unambiguous.
 *
 * **Playing.** The button turns green and becomes a pause, the heard bars stay
 * maroon and the rest stay pale, and the position advances. Green because this
 * is the one control whose state has to be readable at a glance.
 *
 * ## Seeking
 *
 * The waveform is tappable. It looks exactly like every other seek bar on her
 * phone, so she will press it — and for a spoken answer it is genuinely
 * useful: the caution is at the end, and hearing it again should not mean
 * hearing all of it again. Twenty bars is twenty landing points, which is
 * finer than a fingertip.
 */
export function SpeechBar({
  state,
  onToggle,
  /** Distinguishes one message's waveform from the next. */
  seed = 'apa',
  /** Present only once there is something to restart. */
  canRestart = true,
}: {
  state: SpeechState;
  onToggle: () => void;
  seed?: string;
  canRestart?: boolean;
}) {
  const { tx } = useLanguage();
  const reduce = useReducedMotion();

  const loading = state === 'loading';
  const playing = state === 'playing';
  const paused = state === 'paused';
  const active = playing || paused;

  const BARS = 20;
  const bars = useMemo(() => waveform(seed, BARS), [seed]);
  const ratio = useSpeechProgress(active);
  const [width, setWidth] = useState(0);

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

  /* --- ready: the button invites the press ------------------------------ */

  const glow = useRef(new Animated.Value(0)).current;
  const idle = !loading && !active;
  useEffect(() => {
    if (!idle || reduce) {
      glow.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 1100, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0, duration: 900, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [idle, reduce, glow]);

  const onSeek = useCallback(
    (x: number) => {
      if (loading || !active || width <= 0) return;
      void seekSpeech(x / width);
    },
    [active, loading, width]
  );

  const onRestart = useCallback(() => { void restartSpeech(); }, []);

  const caption = loading
    ? tx('কণ্ঠ আনা হচ্ছে…', 'Getting the voice…')
    : playing
      ? tx('পড়ে শোনানো হচ্ছে', 'Reading')
      : paused
        ? tx('থেমে আছে', 'Paused')
        : tx('পড়ে শোনান', 'Read aloud');

  return (
    <View style={sheet.row}>
      <View style={sheet.mainWrap}>
        {idle && !reduce ? (
          <Animated.View
            pointerEvents="none"
            style={[
              sheet.glow,
              {
                opacity: glow.interpolate({ inputRange: [0, 1], outputRange: [0, 0.4] }),
                transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.4] }) }],
              },
            ]}
          />
        ) : null}
        <Pressable
          onPress={loading ? undefined : onToggle}
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
            color={playing ? '#fff' : loading ? colors.muted : colors.maroon}
          />
        </Pressable>
      </View>

      {/* Progress, loader and seek bar, in one control. */}
      <Pressable
        style={sheet.wave}
        onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
        onPress={(e) => onSeek(e.nativeEvent.locationX)}
        disabled={loading || !active}
        accessibilityRole="adjustable"
        accessibilityLabel={tx('যেখান থেকে শুনতে চান চাপুন', 'Tap to play from a point')}
        accessibilityState={{ disabled: loading || !active }}
      >
        {bars.map((h, i) => {
          const heard = active && i / BARS <= ratio;
          return (
            <Animated.View
              key={i}
              style={[
                sheet.bar,
                {
                  height: Math.max(3, Math.round(h * 18)),
                  backgroundColor: heard ? colors.maroon : colors.line,
                  opacity: loading
                    ? reduce
                      ? 0.5
                      : pulse.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.8] })
                    : heard
                      ? 1
                      : 0.85,
                },
              ]}
            />
          );
        })}
      </Pressable>

      {canRestart && active ? (
        <Pressable
          onPress={onRestart}
          hitSlop={8}
          style={({ pressed }) => [sheet.side, pressed && sheet.pressed]}
          accessibilityRole="button"
          accessibilityLabel={tx('গোড়া থেকে শুনুন', 'Start again')}
        >
          <Ionicons name="play-skip-back" size={13} color={colors.maroon} />
        </Pressable>
      ) : (
        <Text style={sheet.caption} numberOfLines={1}>{caption}</Text>
      )}
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
  // Dimmed rather than replaced: she should see the control she pressed still
  // there, and see that it is busy.
  mainLoading: { opacity: 0.5 },
  side: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.rose,
  },
  pressed: { opacity: 0.6 },
  wave: { flex: 1, height: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bar: { width: 2.5, borderRadius: 2 },
  caption: { color: colors.muted, fontSize: 11, maxWidth: 92 },
});
