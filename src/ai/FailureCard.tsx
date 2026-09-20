import React, { useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { PressableScale, useLanguage, useReducedMotion } from '../theme/primitives';
import { retryLine, type Failure } from './errors';
import { lastFailureDetail } from './report';
import { BrandLoader } from '../theme/BrandLoader';

/**
 * What a farmer sees when something failed.
 *
 * This replaces a red bubble containing whatever the failure happened to say —
 * which, on the run that prompted it, was "Unsupported FormDataPart
 * implementation" in the middle of a Bangla conversation about a sick cow.
 *
 * The card is built around one idea: **a rate limit is a pause, not a fault.**
 * When the upstream tells us how long to wait, the card counts it down and
 * keeps its own retry button disabled until it reaches zero. So instead of
 * "something went wrong" and a button that fails again the moment it is
 * pressed, she gets a number going down and a button that works when it lights
 * up. That is the difference between a dead end and a queue.
 *
 * Nothing here renders a code, a status or an English word.
 */

const ICONS: Record<Failure['kind'], keyof typeof Ionicons.glyphMap> = {
  busy: 'hourglass-outline',
  offline: 'cloud-offline-outline',
  timeout: 'time-outline',
  locked: 'lock-closed-outline',
  upload: 'image-outline',
  too_long: 'document-text-outline',
  no_voice: 'volume-mute-outline',
  signed_out: 'log-in-outline',
  unknown: 'alert-circle-outline',
};

/** Amber for a wait, rose for a wall, grey for everything else. */
function toneFor(kind: Failure['kind']): { bg: string; border: string; fg: string } {
  if (kind === 'busy' || kind === 'timeout' || kind === 'offline') {
    return { bg: '#FEF6E7', border: '#F6DFAE', fg: '#8A5A06' };
  }
  if (kind === 'locked') {
    return { bg: colors.rose, border: colors.line, fg: colors.maroon };
  }
  return { bg: colors.cream, border: colors.line, fg: colors.ink };
}

export function FailureCard({
  failure,
  onRetry,
  compact,
}: {
  failure: Failure;
  /** Omit where there is nothing to retry — the card then just explains. */
  onRetry?: () => void;
  compact?: boolean;
}) {
  const { tx, lang } = useLanguage();
  const reduce = useReducedMotion();
  const tone = toneFor(failure.kind);

  // Counts down from whatever the upstream advised. Only this card knows the
  // number, so only this card can say when the button is worth pressing.
  const [left, setLeft] = useState(failure.retryAfter ?? 0);
  const [retrying, setRetrying] = useState(false);
  // Revealed by a long press, never shown by default.
  const [showDetail, setShowDetail] = useState(false);

  useEffect(() => {
    setLeft(failure.retryAfter ?? 0);
  }, [failure.retryAfter]);

  useEffect(() => {
    if (left <= 0) return;
    const timer = setInterval(() => setLeft((n) => (n <= 1 ? 0 : n - 1)), 1000);
    return () => clearInterval(timer);
  }, [left > 0]);

  // A single fade-in. Enough to read as "this is new" without being an event.
  const fade = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  useEffect(() => {
    if (reduce) { fade.setValue(1); return; }
    Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }).start();
  }, [fade, reduce]);

  const waiting = left > 0;
  const canPress = Boolean(onRetry) && failure.canRetry && !waiting && !retrying;

  return (
    <Animated.View
      style={[
        sheet.card,
        compact && sheet.compact,
        { backgroundColor: tone.bg, borderColor: tone.border, opacity: fade },
      ]}
      accessibilityLiveRegion="polite"
    >
      {/* Long-press reveals the technical reason.
          Not a debug leftover, and not shown by default: a farmer must never
          read a stack trace, which is the bug src/ai/errors.ts exists to
          prevent. But a failure nobody can describe is the reason the photo
          upload took four attempts and voice input three - each report arrived
          as "still broken" with nothing attached, and each fix was a guess.
          One long press turns an unactionable report into an actionable one.

          It is also sent to the server (src/ai/report.ts), so this is the
          copy for whoever is holding the phone right now. */}
      <Pressable
        onLongPress={() => setShowDetail((v) => !v)}
        delayLongPress={600}
        accessibilityHint={tx(
          'কারণ দেখতে চেপে ধরে রাখুন',
          'Press and hold to show the technical reason'
        )}
      >
        <View style={sheet.row}>
          <Ionicons name={ICONS[failure.kind]} size={compact ? 18 : 20} color={tone.fg} />
          <Text style={[sheet.message, { color: tone.fg }]}>{failure.message}</Text>
        </View>
      </Pressable>

      {showDetail ? (
        <Text style={sheet.detail} selectable>
          {failure.detail || lastFailureDetail() || tx('বিস্তারিত কিছু নেই', 'No further detail')}
        </Text>
      ) : null}

      {onRetry && failure.canRetry ? (
        <PressableScale
          style={[sheet.retry, !canPress && sheet.retryOff]}
          disabled={!canPress}
          onPress={() => {
            if (!canPress) return;
            setRetrying(true);
            try {
              onRetry();
            } finally {
              // Re-enabled by the next render if it fails again with a new
              // countdown; cleared here so a successful retry does not leave
              // the button stuck.
              setTimeout(() => setRetrying(false), 600);
            }
          }}
          accessibilityLabel={
            waiting
              ? retryLine(left, lang)
              : tx('আবার চেষ্টা করুন', 'Try again')
          }
          accessibilityState={{ disabled: !canPress, busy: retrying }}
        >
          {retrying ? (
            <BrandLoader size={16} />
          ) : (
            <Ionicons
              name={waiting ? 'time-outline' : 'refresh'}
              size={16}
              color={waiting ? colors.muted : colors.maroon}
            />
          )}
          <Text style={[sheet.retryText, !canPress && { color: colors.muted }]}>
            {waiting ? retryLine(left, lang) : tx('আবার চেষ্টা করুন', 'Try again')}
          </Text>
        </PressableScale>
      ) : null}
    </Animated.View>
  );
}

const sheet = StyleSheet.create({
  // Monospace and small: this is for whoever is debugging, not for her. Only
  // ever visible after a deliberate long press.
  detail: {
    marginTop: 8,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    fontSize: 10,
    lineHeight: 14,
    color: colors.muted,
  },
  card: {
    // No alignSelf or maxWidth: this sits inside a flex row and the parent
    // gives it its width. Constraining it here made it collapse to its
    // narrowest possible size — one word per line.
    alignSelf: 'stretch',
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  compact: { paddingVertical: 8, borderRadius: 12 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  message: { flex: 1, fontSize: 14.5, lineHeight: 21, fontWeight: '600' },
  retry: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
  },
  retryOff: { opacity: 0.85 },
  retryText: { color: colors.maroon, fontSize: 13.5, fontWeight: '700' },
});
