import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { useLanguage } from '../theme/primitives';
import {
  isSpeaking, onSpeechChange, speak, speechAvailability, speechState, stopSpeech,
  type SpeechSource, type SpeechState,
} from './speech';

/**
 * "Read this to me", on anything.
 *
 * Farmers listen to everything — an answer, a market update, a whole training
 * article — and many of them read Bangla slowly or not at all. So this is not a
 * convenience on the chat screen; it is how a good part of the app is consumed,
 * and it needs to be the same control everywhere so it is learned once.
 *
 * It manages its own playing state off the shared subscription rather than a
 * local boolean, because several of these are on screen at once in a chat and
 * they were all showing "playing" whenever any one of them was.
 */

let token = 0;

export function ListenButton({
  text,
  server = null,
  size = 20,
  label,
  style,
  rate,
  onStateChange,
}: {
  /** The text as rendered on screen. Never sent anywhere. */
  text: string;
  /** Where the server can find the same text, for a phone with no Bangla voice. */
  server?: SpeechSource | null;
  size?: number;
  /** Show a word beside the icon. Off by default — the icon is understood. */
  label?: string;
  style?: object;
  rate?: string | null;
  onStateChange?: (playing: boolean) => void;
}) {
  const { tx, lang } = useLanguage();
  const mine = useRef(`listen-${(token += 1)}`).current;
  // One state rather than two booleans: the engine owns it, and a button that
  // derived its own could disagree with what was actually playing.
  const [state, setState] = useState<SpeechState>('idle');
  const playing = state === 'playing' || state === 'paused';
  const busy = state === 'loading';

  useEffect(
    () =>
      onSpeechChange((active) => {
        const next = speechState(mine);
        setState(next);
        onStateChange?.(active === mine && next === 'playing');
      }),
    [mine, onStateChange]
  );

  // Leaving the screen must not leave the phone talking.
  useEffect(() => () => { if (isSpeaking(mine)) void stopSpeech(); }, [mine]);

  const onPress = useCallback(async () => {
    // A press while it is fetching does nothing. `speak()` guards this too, but
    // the button should also not flicker as though it accepted the press.
    if (busy) return;
    if (playing) { await stopSpeech(); return; }
    if (!text.trim()) return;
    try {
      await speak({ text, lang, rate, server, token: mine });
    } catch (error) {
      const why = error instanceof Error ? error.message : '';
      if (why === 'NO_VOICE') {
        // Said properly rather than as a failure: nothing is broken, the phone
        // simply has no Bangla voice installed, and she can fix that in two
        // taps if she is told where.
        const hint = await speechAvailability();
        Alert.alert(
          tx('বাংলা কণ্ঠ পাওয়া যায়নি', 'No Bangla voice found'),
          (lang === 'bn' ? hint.hint_bn : hint.hint_en) ?? ''
        );
      } else if (why === 'TOO_LONG') {
        Alert.alert('', tx('লেখাটি পড়ে শোনানোর জন্য একটু বড়।', 'That is a little long to read aloud.'));
      } else {
        Alert.alert('', tx('এখন পড়ে শোনানো যাচ্ছে না।', 'Cannot read that aloud right now.'));
      }
    }
  }, [busy, lang, mine, playing, rate, server, text, tx]);

  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      accessibilityRole="button"
      accessibilityLabel={
        busy
          ? tx('কণ্ঠ আনা হচ্ছে', 'Getting the voice')
          : playing
            ? tx('পড়া বন্ধ করুন', 'Stop reading')
            : tx('পড়ে শোনান', 'Read aloud')
      }
      accessibilityState={{ selected: playing, busy }}
      style={({ pressed }) => [sheet.button, label ? sheet.withLabel : null, pressed && sheet.pressed, style]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={colors.maroon} />
      ) : (
        <Ionicons
          name={state === 'playing' ? 'pause-circle' : state === 'paused' ? 'play-circle' : 'volume-high'}
          size={size}
          color={colors.maroon}
        />
      )}
      {label ? (
        <Text style={sheet.label}>
          {busy
            ? tx('আনা হচ্ছে…', 'Loading…')
            : state === 'playing'
              ? tx('থামান', 'Pause')
              : state === 'paused'
                ? tx('চালান', 'Play')
                : label}
        </Text>
      ) : null}
    </Pressable>
  );
}

/**
 * The same control, sized for a section heading.
 *
 * A training article is the one place the button needs a word beside it: the
 * icon alone on a wall of text was not being found in testing.
 */
export function ListenStrip({ text, server, rate }: { text: string; server?: SpeechSource | null; rate?: string | null }) {
  const { tx } = useLanguage();
  return (
    <View style={sheet.strip}>
      <ListenButton text={text} server={server ?? null} rate={rate} label={tx('পড়ে শোনান', 'Read aloud')} size={18} />
    </View>
  );
}

const sheet = StyleSheet.create({
  button: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  withLabel: {
    paddingHorizontal: 14,
    borderRadius: 22,
    backgroundColor: colors.rose,
    borderWidth: 1,
    borderColor: colors.line,
  },
  pressed: { opacity: 0.6 },
  label: { color: colors.maroon, fontWeight: '700', fontSize: 14 },
  strip: { flexDirection: 'row', justifyContent: 'flex-start', marginBottom: 10 },
});
