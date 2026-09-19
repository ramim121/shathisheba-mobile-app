import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors } from '../theme/colors';
import { useLanguage, useReducedMotion } from '../theme/primitives';
import { restartSpeech, speechProgress, type SpeechState } from './speech';

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
 * The player under one of Shathi Apa's answers.
 *
 * ## What was wrong with the row this replaces
 *
 * It had a play glyph, a track, and a caption. Two of those three lied:
 *
 *   - the track's fill was `width: '35%'`, a constant. It looked like progress
 *     and reported nothing, which is worse than having no bar at all — a bar
 *     that never moves reads as a stuck download.
 *   - the button offered no loading state, so the second or two spent fetching
 *     a clip looked identical to a button that had ignored the press. That is
 *     the same gap that used to let three playbacks stack on top of each other.
 *
 * There was also no way back to the start. For a farmer who cannot read, an
 * answer she half-heard is one she has to hear again from the beginning, and
 * the only option was to stop and wait through the whole fetch a second time.
 *
 * ## The shape
 *
 *   [ play | pause | spinner ]  ———progress———  [ restart ]   caption
 *
 * Primary action on the left where her thumb already is, restart on the right
 * so it cannot be hit by accident mid-sentence, and the caption last because it
 * is the part she needs least once the control is learned.
 *
 * Progress comes from `useSpeechProgress` below; under reduce-motion the width
 * is set directly rather than animated.
 */
export function SpeechBar({
  state,
  onToggle,
  /** Present only once there is something to restart. */
  canRestart = true,
}: {
  state: SpeechState;
  onToggle: () => void;
  canRestart?: boolean;
}) {
  const { tx } = useLanguage();
  const reduce = useReducedMotion();

  const loading = state === 'loading';
  const playing = state === 'playing';
  const paused = state === 'paused';
  const active = playing || paused;

  const ratio = useSpeechProgress(active);
  const fill = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduce) {
      fill.setValue(ratio);
      return;
    }
    // 260ms against a 250ms sample: just longer than the gap, so the bar is
    // always still moving when the next sample lands and never stutters.
    Animated.timing(fill, {
      toValue: ratio,
      duration: 260,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();
  }, [fill, ratio, reduce]);

  const onRestart = useCallback(() => {
    // The hook's next sample will report the new position; this just stops the
    // bar sitting at its old width for a quarter of a second.
    void restartSpeech().then((ok) => { if (ok) fill.setValue(0); });
  }, [fill]);

  const caption = loading
    ? tx('কণ্ঠ আনা হচ্ছে…', 'Getting the voice…')
    : playing
      ? tx('পড়ে শোনানো হচ্ছে', 'Reading')
      : paused
        ? tx('থেমে আছে', 'Paused')
        : tx('পড়ে শোনান', 'Read aloud');

  return (
    <View style={sheet.row}>
      {/* Disabled while loading, and visibly so. A press that is going to be
          ignored must not look like a press that was accepted. */}
      <Pressable
        onPress={loading ? undefined : onToggle}
        disabled={loading}
        hitSlop={8}
        style={({ pressed }) => [
          sheet.main,
          active && sheet.mainActive,
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
        {loading ? (
          <ActivityIndicator size="small" color={colors.maroon} />
        ) : (
          <Ionicons
            name={playing ? 'pause' : 'play'}
            size={16}
            color={active ? '#fff' : colors.maroon}
          />
        )}
      </Pressable>

      <View style={sheet.track}>
        <Animated.View
          style={[
            sheet.fill,
            {
              width: fill.interpolate({
                inputRange: [0, 1],
                outputRange: ['0%', '100%'],
                extrapolate: 'clamp',
              }),
            },
          ]}
        />
      </View>

      {/* Only once there is a position to return from. Offering "start again"
          on something that has not started is a control that does nothing. */}
      {canRestart && active ? (
        <Pressable
          onPress={onRestart}
          hitSlop={8}
          style={({ pressed }) => [sheet.side, pressed && sheet.pressed]}
          accessibilityRole="button"
          accessibilityLabel={tx('গোড়া থেকে শুনুন', 'Start again')}
        >
          <Ionicons name="play-skip-back" size={14} color={colors.maroon} />
        </Pressable>
      ) : null}

      <Text style={sheet.caption} numberOfLines={1}>{caption}</Text>
    </View>
  );
}

const sheet = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
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
  mainActive: { backgroundColor: colors.maroon, borderColor: colors.maroon },
  // Dimmed rather than hidden: she should see the control she pressed, and see
  // that it is working rather than gone.
  mainLoading: { opacity: 0.55 },
  side: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.rose,
  },
  pressed: { opacity: 0.6 },
  track: {
    flex: 1,
    height: 3,
    borderRadius: 2,
    backgroundColor: colors.line,
    overflow: 'hidden',
  },
  fill: { height: 3, borderRadius: 2, backgroundColor: colors.maroon },
  caption: { color: colors.muted, fontSize: 11, maxWidth: 104 },
});
