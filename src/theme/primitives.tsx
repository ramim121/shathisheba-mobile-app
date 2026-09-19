import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo, Animated, Easing, Pressable, Text, View,
  type StyleProp, type ViewStyle,
} from 'react-native';
import { styles } from './styles';
import type { Lang } from '../types';

// The handful of building blocks every screen uses: the language context, the
// header, the button, the badge, the card, and the small Markdown renderer.
//
// These lived in App.tsx, which is where every screen in this app lives. They
// moved out for one reason: Shathi Apa is about fifteen hundred lines of screen
// on its own, App.tsx is already twelve thousand, and a feature of that size
// belongs in its own file. A file outside App.tsx cannot import from it without
// a cycle, so the pieces it needs came here instead. Nothing changed but the
// location — App.tsx imports these back under the same names.

export const LanguageContext = createContext<{
  lang: Lang;
  setLang: (lang: Lang) => void;
  toggleLang: () => void;
  tx: (bnText: string, enText: string) => string;
} | null>(null);

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used inside LanguageContext');
  }
  return context;
}

export function AppButton({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'gold' | 'outline';
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        variant === 'gold' && styles.goldButton,
        variant === 'outline' && styles.outlineButton,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text style={[styles.buttonText, variant === 'outline' && styles.outlineButtonText, disabled && styles.buttonTextDisabled]}>{title}</Text>
    </Pressable>
  );
}

export function Header({
  title,
  onBack,
  right,
  onRightPress,
}: {
  title: string;
  onBack?: () => void;
  right?: string;
  onRightPress?: () => void;
}) {
  return (
    <View style={styles.header}>
      {onBack ? (
        <Pressable onPress={onBack} style={({ pressed }) => [styles.backButton, pressed && styles.pressed]} hitSlop={8} accessibilityRole="button" accessibilityLabel="Back">
          <Text style={styles.backText}>‹</Text>
        </Pressable>
      ) : null}
      <Text style={styles.headerTitle}>{title}</Text>
      {right ? (
        <Text style={styles.headerRight} onPress={onRightPress}>{right}</Text>
      ) : (
        <View style={styles.headerSpacer} />
      )}
    </View>
  );
}

export function Badge({ label, tone = 'rose' }: { label: string; tone?: 'rose' | 'green' | 'gold' | 'blue' }) {
  const style = {
    rose: styles.badgeRose,
    green: styles.badgeGreen,
    gold: styles.badgeGold,
    blue: styles.badgeBlue,
  }[tone];
  return (
    <View style={[styles.badge, style]}>
      <Text style={[styles.badgeText, tone === 'green' && styles.badgeGreenText]}>{label}</Text>
    </View>
  );
}

export function MarkdownText({
  text,
  style,
  strongStyle,
}: {
  text: string;
  style?: object;
  strongStyle?: object;
}) {
  const lines = text.split('\n').filter((line) => line.trim().length > 0);
  return (
    <>
      {lines.map((line, lineIndex) => {
        const trimmed = line.replace(/^#{1,4}\s*/, '').trim();
        const bullet = /^[-*•]\s+/.test(trimmed);
        const clean = trimmed.replace(/^[-*•]\s+/, '');
        const parts = clean.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
        return (
          <Text key={`${lineIndex}-${clean.slice(0, 8)}`} style={style}>
            {bullet ? '• ' : ''}
            {parts.map((part, index) => {
              const strong = part.startsWith('**') && part.endsWith('**');
              return (
                <Text key={`${index}-${part.slice(0, 6)}`} style={strong ? strongStyle : undefined}>
                  {strong ? part.slice(2, -2) : part}
                </Text>
              );
            })}
          </Text>
        );
      })}
    </>
  );
}

export function Card({ children, style, onPress }: { children: React.ReactNode; style?: object; onPress?: () => void }) {
  if (onPress) {
    return <Pressable onPress={onPress} style={({ pressed }) => [styles.card, style, pressed && styles.pressed]}>{children}</Pressable>;
  }
  return <View style={[styles.card, style]}>{children}</View>;
}

/* ---------------------------------------------------------------------------
   Press feedback
   --------------------------------------------------------------------------- */

/**
 * A pressable that answers back.
 *
 * Every button in this app was a flat `Pressable` with, at best, an opacity
 * change. On a mid-range Android handset with a slow screen that reads as
 * nothing happening, so farmers press twice — which is how the read-aloud
 * button came to play the same answer three times at once.
 *
 * A scale of 0.96 on press-in is small enough not to be decorative and large
 * enough to be felt. `useNativeDriver` keeps it off the JS thread, so it still
 * responds while an answer is being parsed.
 *
 * Honours the system reduce-motion switch: there the scale is dropped and the
 * opacity change carries the feedback instead, because for someone with a
 * vestibular disorder a moving button is not a nicety.
 */
export function PressableScale({
  children,
  onPress,
  onLongPress,
  disabled,
  style,
  scaleTo = 0.96,
  hitSlop = 8,
  accessibilityLabel,
  accessibilityRole = 'button',
  accessibilityState,
}: {
  children: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  scaleTo?: number;
  hitSlop?: number;
  accessibilityLabel?: string;
  accessibilityRole?: 'button' | 'link' | 'switch' | 'tab';
  accessibilityState?: { selected?: boolean; disabled?: boolean; busy?: boolean; checked?: boolean };
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const reduce = useReducedMotion();

  const to = (value: number) =>
    Animated.spring(scale, {
      toValue: value,
      useNativeDriver: true,
      speed: 40,
      bounciness: 4,
    }).start();

  // The style goes on the Animated.View, not on the Pressable.
  //
  // It used to go on the Pressable, with the children inside an unstyled
  // Animated.View — so a `flexDirection: 'row'` meant for the children landed
  // on their grandparent and they stacked in a column instead. Every pill built
  // with this rendered its icon above its label rather than beside it, which
  // read as a broken button. The layout and the children have to be on the same
  // element.
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      onLongPress={disabled ? undefined : onLongPress}
      onPressIn={() => { if (!disabled && !reduce) to(scaleTo); }}
      onPressOut={() => { if (!reduce) to(1); }}
      disabled={disabled}
      hitSlop={hitSlop}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled: Boolean(disabled), ...accessibilityState }}
    >
      {({ pressed }) => (
        <Animated.View
          style={[
            style,
            reduce ? null : { transform: [{ scale }] },
            pressed && reduce ? { opacity: 0.6 } : null,
          ]}
        >
          {children}
        </Animated.View>
      )}
    </Pressable>
  );
}

/**
 * Whether the farmer has asked the system to stop things moving.
 *
 * Shared so that every animation in the app reads the same switch rather than
 * each screen deciding for itself — and so that adding an animation does not
 * mean remembering to check.
 */
export function useReducedMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => { if (alive) setReduce(Boolean(on)); })
      .catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (on) =>
      setReduce(Boolean(on))
    );
    return () => { alive = false; sub?.remove?.(); };
  }, []);
  return reduce;
}

/**
 * A soft pulse, for the one place something is genuinely happening and the
 * farmer is waiting on it: the mic while recording, the orb while thinking.
 *
 * Returns an Animated value in [0, 1]; the caller decides what it drives. Held
 * at 1 when reduce-motion is on, so a component built on it renders at full
 * size rather than disappearing.
 */
export function usePulse(active: boolean, durationMs = 1100): Animated.Value {
  const value = useRef(new Animated.Value(0)).current;
  const reduce = useReducedMotion();
  useEffect(() => {
    value.stopAnimation();
    if (!active) { value.setValue(0); return; }
    if (reduce) { value.setValue(1); return; }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(value, { toValue: 1, duration: durationMs / 2, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(value, { toValue: 0, duration: durationMs / 2, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [active, durationMs, reduce, value]);
  return value;
}
