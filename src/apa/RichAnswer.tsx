import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { useLanguage, useReducedMotion } from '../theme/primitives';

/**
 * An answer, rendered as the thing it is rather than as a wall of text.
 *
 * The shared `MarkdownText` handles bullets and bold and throws everything else
 * away — headings are stripped, numbered lists lose their numbers, and a step
 * sequence comes out as an undifferentiated paragraph. For an answer that says
 * "do this, then this, then this" to a farmer who reads slowly, the numbers are
 * the most useful thing on the screen.
 *
 * It also renders the two callouts the answer already carries differently,
 * because they mean different things and looked identical:
 *
 *   - **advice** — what to do. Rose, the colour of the app's own suggestions.
 *   - **likely** — what it probably is. Amber, with a caveat, because a guess
 *     about a disease from a photograph must not look like a conclusion.
 *
 * `MarkdownText` is left alone: it is used across the rest of the app and this
 * is not the place to change how a training article renders.
 */

type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'para'; text: string }
  | { kind: 'bullet'; text: string }
  | { kind: 'step'; index: number; text: string };

/** Parse the subset of markdown the answering prompt actually produces. */
export function parseBlocks(input: string): Block[] {
  const out: Block[] = [];
  let step = 0;
  for (const raw of input.split('\n')) {
    const line = raw.trim();
    if (!line) { step = 0; continue; }

    const heading = /^#{1,4}\s+(.*)$/.exec(line);
    if (heading) { out.push({ kind: 'heading', text: heading[1].trim() }); step = 0; continue; }

    // Numbered steps keep their number. This is the one the old renderer lost.
    const ordered = /^(\d+)[.)]\s+(.*)$/.exec(line);
    if (ordered) {
      step = Number(ordered[1]) || step + 1;
      out.push({ kind: 'step', index: step, text: ordered[2].trim() });
      continue;
    }

    const bullet = /^[-*•]\s+(.*)$/.exec(line);
    if (bullet) { out.push({ kind: 'bullet', text: bullet[1].trim() }); step = 0; continue; }

    out.push({ kind: 'para', text: line });
    step = 0;
  }
  return out;
}

/** Bold spans, rendered inline. Everything else is already plain by here. */
function Inline({ text, style, strongStyle }: { text: string; style?: object; strongStyle?: object }) {
  const parts = text.split(/(\*\*[^*]+\*\*|__[^_]+__)/g).filter(Boolean);
  return (
    <>
      {parts.map((part, i) => {
        const strong =
          (part.startsWith('**') && part.endsWith('**')) || (part.startsWith('__') && part.endsWith('__'));
        return (
          <Text key={`${i}-${part.slice(0, 6)}`} style={strong ? strongStyle : style}>
            {strong ? part.slice(2, -2) : part}
          </Text>
        );
      })}
    </>
  );
}

export function RichAnswer({
  text,
  textStyle,
  strongStyle,
  animate = true,
}: {
  text: string;
  textStyle?: object;
  strongStyle?: object;
  animate?: boolean;
}) {
  const blocks = parseBlocks(text);
  const reduce = useReducedMotion();

  // One fade for the whole answer rather than a stagger per line. A stagger
  // reads as a loading state, and by the time this renders the answer is
  // already complete — pretending otherwise makes it feel slower than it is.
  const fade = useRef(new Animated.Value(animate && !reduce ? 0 : 1)).current;
  useEffect(() => {
    if (!animate || reduce) { fade.setValue(1); return; }
    Animated.timing(fade, { toValue: 1, duration: 260, useNativeDriver: true }).start();
  }, [animate, fade, reduce]);

  return (
    <Animated.View style={{ opacity: fade, gap: 6 }}>
      {blocks.map((block, i) => {
        if (block.kind === 'heading') {
          return (
            <Text key={i} style={sheet.heading}>
              <Inline text={block.text} style={sheet.heading} strongStyle={sheet.heading} />
            </Text>
          );
        }
        if (block.kind === 'step') {
          return (
            <View key={i} style={sheet.stepRow}>
              <View style={sheet.stepNum}>
                <Text style={sheet.stepNumText}>{block.index}</Text>
              </View>
              <Text style={[textStyle, sheet.flex]}>
                <Inline text={block.text} style={textStyle} strongStyle={strongStyle} />
              </Text>
            </View>
          );
        }
        if (block.kind === 'bullet') {
          return (
            <View key={i} style={sheet.bulletRow}>
              <View style={sheet.dot} />
              <Text style={[textStyle, sheet.flex]}>
                <Inline text={block.text} style={textStyle} strongStyle={strongStyle} />
              </Text>
            </View>
          );
        }
        return (
          <Text key={i} style={textStyle}>
            <Inline text={block.text} style={textStyle} strongStyle={strongStyle} />
          </Text>
        );
      })}
    </Animated.View>
  );
}

/* ---------------------------------------------------------------------------
   The callouts
   --------------------------------------------------------------------------- */

/**
 * What to do, or what it probably is — and never the same styling for both.
 *
 * `kind: 'likely'` is the model's guess at a diagnosis, usually from a
 * photograph. It was rendered in the same rose box as a piece of settled
 * advice, which made a guess look like a finding. Amber, an explicit caveat and
 * a different icon, because a farmer acting on a wrong diagnosis loses an
 * animal.
 */
export function AnswerCallout({
  kind,
  title,
  body,
  textStyle,
  strongStyle,
}: {
  kind: 'advice' | 'likely';
  title: string;
  body: string;
  textStyle?: object;
  strongStyle?: object;
}) {
  const { tx } = useLanguage();
  const likely = kind === 'likely';
  return (
    <View style={[sheet.callout, likely ? sheet.calloutLikely : sheet.calloutAdvice]}>
      <View style={sheet.calloutHead}>
        <Ionicons
          name={likely ? 'search-outline' : 'bulb-outline'}
          size={15}
          color={likely ? '#8A5A06' : colors.maroon}
        />
        <Text style={[sheet.calloutTitle, likely && { color: '#8A5A06' }]}>
          {title || (likely ? tx('সম্ভাব্য কারণ', 'Likely cause') : tx('পরামর্শ', 'Advice'))}
        </Text>
      </View>
      <RichAnswer text={body} textStyle={textStyle} strongStyle={strongStyle} animate={false} />
      {likely ? (
        <Text style={sheet.calloutCaveat}>
          {tx(
            'ছবি দেখে প্রথম ধারণা — নিশ্চিত হতে অফিসারকে দেখান।',
            'A first impression from a photo — show an officer to be sure.'
          )}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The thinking state.
 *
 * Was a stock `ActivityIndicator` beside the word "ভাবছি…", which is the same
 * spinner the app shows for a list loading. Three dots that breathe say "she is
 * composing an answer" rather than "a request is in flight", and the difference
 * matters on the one screen where the wait is the product.
 */
export function ThinkingDots({ label }: { label: string }) {
  const reduce = useReducedMotion();
  const a = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduce) { a.setValue(1); return; }
    const loop = Animated.loop(
      Animated.timing(a, { toValue: 3, duration: 1200, useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [a, reduce]);

  return (
    <View style={sheet.thinking}>
      <View style={sheet.thinkingDots}>
        {[0, 1, 2].map((i) => (
          <Animated.View
            key={i}
            style={[
              sheet.thinkingDot,
              reduce
                ? null
                : {
                    opacity: a.interpolate({
                      inputRange: [i - 0.6, i, i + 0.6, 3],
                      outputRange: [0.3, 1, 0.3, 0.3],
                      extrapolate: 'clamp',
                    }),
                  },
            ]}
          />
        ))}
      </View>
      <Text style={sheet.thinkingText}>{label}</Text>
    </View>
  );
}

const sheet = StyleSheet.create({
  flex: { flex: 1 },
  heading: { color: colors.ink, fontSize: 15, fontWeight: '800', marginTop: 2 },

  // Numbered steps keep their numbers, in a disc, because "do this then this"
  // is the shape of most useful farming advice.
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  stepNum: {
    width: 20, height: 20, borderRadius: 10, marginTop: 2,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.rose,
  },
  stepNumText: { color: colors.maroon, fontSize: 11.5, fontWeight: '800' },

  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  dot: { width: 5, height: 5, borderRadius: 3, marginTop: 9, backgroundColor: colors.muted },

  callout: { borderRadius: 12, padding: 11, gap: 6, borderWidth: 1 },
  calloutAdvice: { backgroundColor: colors.rose, borderColor: colors.line },
  calloutLikely: { backgroundColor: '#FEF6E7', borderColor: '#F6DFAE' },
  calloutHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  calloutTitle: { color: colors.maroon, fontSize: 12.5, fontWeight: '800' },
  calloutCaveat: { color: '#8A5A06', fontSize: 11.5, lineHeight: 17, fontStyle: 'italic' },

  thinking: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingVertical: 4 },
  thinkingDots: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  thinkingDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.maroon },
  thinkingText: { color: colors.muted, fontSize: 13, fontWeight: '600' },
});
