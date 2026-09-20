import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';

import { colors } from './colors';
import { useLanguage, useReducedMotion } from './primitives';

/**
 * Waiting, in Shathi Sheba's own marks rather than a stock spinner.
 *
 * ## Why replace `ActivityIndicator`
 *
 * The platform spinner is the same grey circle every app shows, so it says
 * "something, somewhere, is happening" and nothing else. Three petals in the
 * brand's maroon and gold say *this* app is working, which matters most to
 * someone who is not a confident phone user and cannot read the label beside
 * it: she recognises the shape from the header of every screen she has used.
 *
 * ## Why it is Views and not SVG
 *
 * `react-native-svg` is not in this project, and adding it means a native
 * module and therefore a new build for everyone. Three rounded rectangles at
 * 120° with a scale-and-fade loop are indistinguishable from the drawn logo at
 * 20–40px, which is every size this appears at. The dependency would buy
 * nothing at the only scale that matters.
 *
 * ## Reduce-motion
 *
 * The loop stops and the petals sit at full opacity. That is a static brand
 * mark with a label beside it, which is still an honest "waiting" — the
 * alternative, a spinner that cannot spin, is not.
 */
export function BrandLoader({
  size = 28,
  label,
  inline = false,
  tone = 'brand',
}: {
  size?: number;
  /** A word beside it. Omit inside a small control where the mark is enough. */
  label?: string;
  /** Lay out in a row rather than centred in its own block. */
  inline?: boolean;
  /**
   * `light` on a maroon or green surface. The brand petals are maroon and
   * gold, and maroon on maroon is an invisible loader — a button that looks
   * like it ignored the press, which is the exact failure this component
   * exists to prevent.
   */
  tone?: 'brand' | 'light' | 'gold';
}) {
  const reduce = useReducedMotion();
  const spin = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduce) {
      spin.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 1400,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [reduce, spin]);

  // Three petals, each a third of the cycle behind the last, so the bloom
  // travels round rather than pulsing all at once.
  const petals = [0, 1, 2].map((i) => {
    const offset = i / 3;
    const at = (v: number) => (v + offset) % 1;
    return {
      key: i,
      colour:
        tone === 'light'
          ? i === 1
            ? 'rgba(255,255,255,0.72)'
            : '#FFFFFF'
          : tone === 'gold'
            ? i === 1
              ? '#5A3A06'
              : '#3D2600'
            : i === 1
              ? colors.gold
              : colors.maroon,
      angle: i * 120,
      scale: reduce
        ? 1
        : spin.interpolate({
            inputRange: [0, at(0.5), 1],
            outputRange: [0.62, 1, 0.62],
          }),
      opacity: reduce
        ? 1
        : spin.interpolate({
            inputRange: [0, at(0.5), 1],
            outputRange: [0.45, 1, 0.45],
          }),
    };
  });

  const petalW = Math.max(3, Math.round(size * 0.26));
  const petalH = Math.max(7, Math.round(size * 0.46));

  return (
    <View style={[sheet.wrap, inline && sheet.inline]}>
      <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        {petals.map((p) => (
          <Animated.View
            key={p.key}
            style={[
              sheet.petal,
              {
                width: petalW,
                height: petalH,
                borderRadius: petalW,
                backgroundColor: p.colour,
                opacity: p.opacity,
                transform: [
                  { rotate: `${p.angle}deg` },
                  // Pushed out along its own axis so the three meet at the
                  // centre, the way the drawn mark does.
                  { translateY: -petalH * 0.42 },
                  { scale: p.scale },
                ],
              },
            ]}
          />
        ))}
      </View>
      {label ? <Text style={sheet.label}>{label}</Text> : null}
    </View>
  );
}

/**
 * The loader where a whole screen or panel is waiting.
 *
 * Carries a word by default, because a brand mark alone in the middle of an
 * empty screen is decoration; with "আনা হচ্ছে…" under it, it is a status.
 */
export function BrandLoaderBlock({ label }: { label?: string }) {
  const { tx } = useLanguage();
  return (
    <View style={sheet.block}>
      <BrandLoader size={34} label={label ?? tx('আনা হচ্ছে…', 'Loading…')} />
    </View>
  );
}

const sheet = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', gap: 8 },
  inline: { flexDirection: 'row', gap: 8 },
  petal: { position: 'absolute' },
  label: { color: colors.muted, fontSize: 12, fontWeight: '600' },
  block: { paddingVertical: 28, alignItems: 'center', justifyContent: 'center' },
});
