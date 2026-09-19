import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo, ActivityIndicator, Animated, Easing, Image, LayoutAnimation, Linking,
  PanResponder, Pressable, ScrollView, Text, TextInput, View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as Network from 'expo-network';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import { colors } from '../theme/colors';
import { styles } from '../theme/styles';
import {
  AppButton, Header, MarkdownText, PressableScale, useLanguage, usePulse, useReducedMotion,
} from '../theme/primitives';
import { Ionicons } from '@expo/vector-icons';
import { FailureCard } from '../ai/FailureCard';
import { SpeechBar, useSpeechProgress } from '../ai/SpeechBar';
import type { SpeechState } from '../ai/speech';
import { AnswerCallout, RichAnswer, ThinkingDots } from './RichAnswer';
import {
  closeApaLive, clearApaHistory, getApaSettings, markApaLiveConnected,
  saveApaSettings, startApaLive,
  type ApaEntitlement, type ApaLiveReceipt, type ApaUserSettings,
} from '../ai/apa';
import {
  deviceVoiceName, intro as introText, primeDeviceVoice, speechAvailability, speechMode, stopSpeech,
} from '../ai/speech';
import { clear as clearAudioCache, stats as audioCacheStats } from '../media/audioCache';
import { ListenButton } from '../ai/ListenButton';
import { APA_AMBER, APA_END, APA_GREEN, apa } from './styles';
import { bn, clock, screenFromAction, useApa, type ApaTurn } from './state';
import { openLive, type LiveHandle } from '../ai/live';
import type { Screen } from '../types';

// Every Shathi Apa screen: the chat, the composer that feeds it, the unlock
// path, the live conversation, the camera and the settings.
//
// This is a screen module rather than another fifteen hundred lines of App.tsx,
// which is where the rest of this app's screens live. The feature is large
// enough to be read on its own, and everything it needs from the shared layer
// now comes from src/theme/primitives.
//
// The sizes, the copy and the state names all come from the design. Where the
// design and the code disagree the design wins, except in one place, called out
// where it happens: live microphone capture. No shipped app build can produce
// PCM16 audio on Android, so the live screen is complete and honest about the
// one thing it cannot do yet, rather than offering a button that fails.

/**
 * Whether this app build can actually hold a live conversation.
 *
 * Two things have to be true, and they are not the same thing.
 * `apa_live_mic_enabled` on the server says the platform is willing to pay for
 * it. This constant says the app in the farmer's hand can do its half: capture
 * microphone audio as linear PCM and send it up the socket.
 *
 * It now can. `react-native-audio-api` provides the PCM recorder that
 * `expo-audio` cannot on Android — see src/ai/livePcm.ts for why no
 * configuration of expo-audio would have done, and
 * Resources/apa-probes/live-format.cjs for the measurement behind that.
 *
 * ## This is still a build flag, and it still matters
 *
 * `react-native-audio-api` is a NATIVE module. It is in package.json and
 * registered in app.json, but it is only in the binary after `expo prebuild`
 * and a fresh build. An OTA update cannot add it. So on a build made before
 * 2026-09-19 this screen would offer a working-looking conversation and then
 * throw on the first press.
 *
 * Kept separate from the server switch for the same reason as before: turning
 * that switch on alone would otherwise draw a green "listening" orb with no
 * microphone behind it, which is worse than an honest "not ready" and much
 * harder to notice.
 */
const LIVE_CLIENT_READY = true;



/**
 * What a live conversation sounds like, for the screen that cannot hold one yet.
 *
 * Shown instead of nothing, because "coming soon" on its own tells a farmer
 * neither what she is waiting for nor whether it is worth waiting. These are
 * real exchanges from the voice-message path, which is the same model answering
 * the same way — only the turn-taking is missing.
 */
const LIVE_SAMPLES: { who: 'me' | 'apa'; bn: string; en: string }[] = [
  { who: 'me',  bn: 'আপা, ধানে পাতা মোড়ানো পোকা লেগেছে। কী দিব?',
                en: 'Apa, my rice has leaf-folder. What should I use?' },
  { who: 'apa', bn: 'আগে দেখুন কত শতাংশ পাতা মোড়ানো। ১০টার মধ্যে ১-২টা হলে এখনই ওষুধ দরকার নেই — পরজীবী পোকা নিজেই সামলে নেয়।',
                en: 'First check how many leaves are folded. One or two in ten needs no spray yet — natural predators handle it.' },
  { who: 'me',  bn: 'অনেক বেশি, প্রায় অর্ধেক পাতা।',
                en: 'Far more than that — nearly half the leaves.' },
  { who: 'apa', bn: 'তাহলে ব্যবস্থা নিতে হবে। আপনার এলাকার উপসহকারী কৃষি অফিসারের নম্বর দিচ্ছি — অনুমোদিত কীটনাশক ও মাত্রা উনি বলে দেবেন।',
                en: 'Then it needs treating. Here is your local agriculture officer — they will name an approved pesticide and the dose.' },
];

/* ===========================================================================
   The petal mark, at three sizes
   =========================================================================== */

function ApaMark({ size = 28 }: { size?: number }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={[styles.apaLogoMark, { transform: [{ scale: size / 34 }] }]}>
        <View style={[styles.logoLeaf, styles.logoLeafGreen]} />
        <View style={[styles.logoLeaf, styles.logoLeafPurpleOne]} />
        <View style={[styles.logoLeaf, styles.logoLeafPurpleTwo]} />
      </View>
    </View>
  );
}

/* ===========================================================================
   Chat
   =========================================================================== */

export function ShathiApaScreen({ setScreen }: { setScreen: (screen: Screen) => void }) {
  const { tx, lang } = useLanguage();
  const {
    entitlement, turns, busy, wall, error, askText, clear, replay, retryTurn,
    speakingKey, speakingState, vote, navigate,
  } = useApa();
  const scroller = useRef<ScrollView>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const starters = entitlement?.starters ?? [];
  const trial = entitlement?.trial;
  const locked = entitlement ? !entitlement.features.ask_text : false;

  useEffect(() => {
    const timer = setTimeout(() => scroller.current?.scrollToEnd({ animated: true }), 120);
    return () => clearTimeout(timer);
  }, [turns.length, busy, wall]);

  useEffect(() => () => { void stopSpeech(); }, []);

  // Looked for once, so the read-aloud button can say something useful rather
  // than failing silently on a handset with no Bangla voice.
  useEffect(() => { void primeDeviceVoice().catch(() => undefined); }, []);

  // The server's copy where it has answered, so the text on screen is exactly
  // the text that gets spoken — the speech cache is keyed on it, and a greeting
  // differing by a full stop would synthesise a second clip for every farmer.
  const greeting =
    lang === 'bn' && introText()
      ? introText()
      : tx(
          'আসসালামু আলাইকুম। আমি শাথী আপা। ফসল, গবাদি পশু, আবহাওয়া বা বাজারদর — যা জানতে চান, মাইক চেপে ধরে বলুন।',
          'Assalamu alaikum. I am Shathi Apa. Crops, livestock, weather or market rates — hold the mic and ask.'
        );

  return (
    <>
      <View style={apa.head}>
        <Pressable onPress={() => setScreen('home')} style={apa.headBack} hitSlop={8} accessibilityLabel={tx('পিছনে', 'Back')}>
          <Text style={apa.headBackText}>‹</Text>
        </Pressable>
        <View style={apa.headMark}><ApaMark size={28} /></View>
        <View style={apa.headTitles}>
          <Text style={apa.headTitle}>{tx('শাথী আপা', 'Shathi Apa')}</Text>
          <Text style={apa.headSub} numberOfLines={1}>
            {entitlement?.headline_bn && lang === 'bn' ? entitlement.headline_bn : tx('সবসময় পাশে আছি', 'Always here to help')}
          </Text>
        </View>
        {/* The counter is visible from question one, so the wall is never a
            surprise — and it names the reward, not the restriction. */}
        {trial?.active ? (
          <View style={[apa.headPill, apa.headPillTrial]}>
            <Text style={[apa.headPillText, apa.headPillTrialText]}>
              {lang === 'bn' ? `${bn(trial.left)}টি প্রশ্ন বাকি` : `${trial.left} left`}
            </Text>
          </View>
        ) : locked ? (
          <View style={[apa.headPill, apa.headPillSpent]}>
            <Text style={[apa.headPillText, apa.headPillSpentText]}>{tx('প্রশ্ন শেষ', 'Trial over')}</Text>
          </View>
        ) : null}
        <Pressable onPress={() => setMenuOpen((v) => !v)} style={apa.headKebab} hitSlop={8} accessibilityLabel={tx('আরও', 'More')}>
          <Text style={apa.headKebabText}>⋮</Text>
        </Pressable>
      </View>

      {menuOpen ? (
        <View style={{ backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.line }}>
          {/* Starting again was only possible by deleting every conversation
              from settings, which is a different and much larger thing. */}
          <PressableScale
            style={apa.row}
            onPress={() => {
              setMenuOpen(false);
              void stopSpeech();
              clear();
            }}
            disabled={!turns.length}
            accessibilityLabel={tx('নতুন আলাপ শুরু করুন', 'Start a new conversation')}
          >
            <View style={apa.rowIcon}>
              <Ionicons name="add-circle-outline" size={18} color={colors.maroon} />
            </View>
            <View style={apa.rowBody}>
              <Text style={[apa.rowTitle, !turns.length && { color: colors.muted }]}>
                {tx('নতুন আলাপ শুরু করুন', 'Start a new conversation')}
              </Text>
              <Text style={apa.rowDetail}>
                {tx('আগের আলাপ সেটিংসে জমা থাকবে', 'The earlier one stays saved in settings')}
              </Text>
            </View>
          </PressableScale>
          <PressableScale
            style={apa.row}
            onPress={() => { setMenuOpen(false); setScreen('apaSettings'); }}
            accessibilityLabel={tx('শাথী আপার সেটিংস', 'Shathi Apa settings')}
          >
            <View style={apa.rowIcon}>
              <Ionicons name="settings-outline" size={18} color={colors.maroon} />
            </View>
            <View style={apa.rowBody}>
              <Text style={apa.rowTitle}>{tx('শাথী আপার সেটিংস', 'Shathi Apa settings')}</Text>
            </View>
          </PressableScale>
        </View>
      ) : null}

      <ScrollView ref={scroller} contentContainerStyle={apa.thread} keyboardShouldPersistTaps="handled">
        <ApaBubble
          turn={{ key: 'greeting', role: 'apa', text: greeting, state: 'done' }}
          playing={speakingKey === 'greeting'}
          speechState={speakingKey === 'greeting' ? speakingState : 'idle'}
          onReplay={() => replay({ key: 'greeting', role: 'apa', text: greeting, state: 'done' })}
          onSuggestion={askText}
          onVote={() => undefined}
          onAction={(screen) => navigate(screen)}
          lang={lang}
          tx={tx}
        />

        {!turns.length && starters.length ? (
          <>
            <Text style={apa.starterLabel}>{tx('শুরু করতে বেছে নিন', 'Tap to begin')}</Text>
            <View style={apa.chipRow}>
              {starters.map((item) => (
                <Pressable key={item.text} style={apa.suggest} onPress={() => void askText(item.text)} disabled={locked}>
                  <Text style={apa.suggestText}>{item.text}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        {turns.map((turn) =>
          turn.role === 'user' ? (
            <UserBubble
              key={turn.key}
              turn={turn}
              playing={speakingKey === turn.key && speakingState === 'playing'}
              loading={speakingKey === turn.key && speakingState === 'loading'}
              speechState={speakingKey === turn.key ? speakingState : 'idle'}
              onReplay={() => replay(turn)}
              lang={lang}
              tx={tx}
            />
          ) : (
            <ApaBubble
              key={turn.key}
              turn={turn}
              playing={speakingKey === turn.key}
              onReplay={() => replay(turn)}
              onRetry={() => retryTurn(turn)}
              onSuggestion={askText}
              onVote={(v, reason) => vote(turn, v, reason)}
              onAction={(screen) => navigate(screen)}
              lang={lang}
              tx={tx}
            />
          )
        )}

        {wall ? <SoftWall message={wall} onVerify={() => setScreen('apaUnlock')} lang={lang} tx={tx} /> : null}

        {error && !turns.length ? (
          <View style={apa.notice}>
            <Text style={apa.noticeText}>{error}</Text>
          </View>
        ) : null}
      </ScrollView>
    </>
  );
}

/* --- her turn ------------------------------------------------------------ */

function UserBubble({
  turn, playing = false, loading = false, speechState = 'idle', onReplay, lang, tx,
}: {
  turn: ApaTurn;
  /** True only for the one clip actually playing. */
  playing?: boolean;
  /** True while the clip is being opened. */
  loading?: boolean;
  /**
   * The same four states as Shathi Apa's player, so her own recording and the
   * answer two lines below behave identically. `playing` and `loading` are kept
   * because the waveform reads them; this drives the control.
   */
  speechState?: SpeechState;
  onReplay: () => void;
  lang: string;
  tx: (bnText: string, enText: string) => string;
}) {
  const bars = useMemo(() => Array.from({ length: 20 }, (_, i) => 5 + ((i * 7) % 12)), []);
  // Real position now, so the waveform fills as it plays instead of switching
  // wholesale between dim and solid. The comment below used to say expo-audio
  // could not report this; it can, through speechProgress().
  const heard = useSpeechProgress(playing);
  return (
    <View style={apa.turnUser}>
      {turn.imageUri ? (
        <Image source={{ uri: turn.imageUri }} style={apa.turnUserPhoto} />
      ) : null}

      {/* Her own recording, with the same play/pause control as Shathi Apa's
          answer two lines below. It used to be a strip of static bars that
          fired playback once and gave no sign of it: no icon change, no way to
          stop, and a second tap stacked a second playback on the first. */}
      {turn.clipUri ? (
        <PressableScale
          style={apa.clip}
          onPress={onReplay}
          accessibilityLabel={
            playing ? tx('থামান', 'Stop') : tx('আপনার রেকর্ডিং শুনুন', 'Play your recording')
          }
          accessibilityState={{ selected: playing, busy: loading }}
        >
          {loading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name={playing ? 'pause' : 'play'} size={16} color="#fff" />
          )}
          <View style={apa.clipBars}>
            {bars.map((h, i) => (
              <View
                key={i}
                style={[
                  apa.clipBar,
                  { height: h },
                  // The bars she has heard stay solid and the rest dim, from
                  // the player's actual position. It was all-or-nothing before,
                  // on the belief that position was not available per bar — it
                  // is, via speechProgress(), so twenty bars is twenty steps of
                  // resolution and enough to see it moving.
                  playing && i / bars.length <= heard ? null : apa.clipBarIdle,
                ]}
              />
            ))}
          </View>
          <Text style={apa.clipTime}>{clock(turn.clipSeconds ?? 0, lang === 'bn' ? 'bn' : 'en')}</Text>
        </PressableScale>
      ) : null}

      {/* The transcript, under her clip. She asked by voice; seeing what was
          heard is how she catches a mis-hearing before acting on the answer. */}
      {turn.text ? (
        <Text style={[apa.turnUserText, turn.clipUri && apa.turnUserTranscript]}>{turn.text}</Text>
      ) : null}

      {turn.state === 'sending' ? (
        <Text style={apa.turnUserNote}>{tx('পাঠানো হচ্ছে…', 'Sending…')}</Text>
      ) : turn.state === 'unheard' ? (
        <Text style={apa.turnUserNote}>{tx('বুঝতে পারিনি — রেকর্ডিং রাখা আছে', 'Not understood — your recording is kept')}</Text>
      ) : turn.state === 'failed' ? (
        <Text style={apa.turnUserNote}>{tx('পাঠানো যায়নি', 'Could not send')}</Text>
      ) : turn.transcribed ? (
        // Read back so she learns Shathi Apa heard her, and catches it when she
        // did not (rule V2).
        <Text style={apa.turnUserNote}>{tx('আপনি যা বলেছেন — ভুল হলে আবার বলুন', 'What we heard — say it again if this is wrong')}</Text>
      ) : null}
    </View>
  );
}

/* --- her answer ---------------------------------------------------------- */

function ApaBubble({
  turn, playing = false, speechState = 'idle', onReplay, onRetry, onSuggestion, onVote, onAction, lang, tx,
}: {
  turn: ApaTurn;
  /** True only for the one bubble actually being read out. */
  playing?: boolean;
  /**
   * What that bubble's player is doing. A boolean could not express "fetching",
   * which is the second or two that used to look like an ignored press.
   */
  speechState?: SpeechState;
  onReplay: () => void;
  /** Absent where there is nothing to resend — the card then only explains. */
  onRetry?: () => void;
  onSuggestion: (text: string) => void;
  onVote: (vote: 'up' | 'down', reason?: string) => void;
  onAction: (screen: Screen) => void;
  lang: string;
  tx: (bnText: string, enText: string) => string;
}) {
  const [reasonOpen, setReasonOpen] = useState(false);

  if (turn.state === 'transcribing' || turn.state === 'thinking') {
    return (
      <View style={apa.status}>
        <ThinkingDots
          label={turn.state === 'transcribing' ? tx('লিখে নিচ্ছি…', 'Writing it down…') : tx('ভাবছি…', 'Thinking…')}
        />
      </View>
    );
  }

  const failed = turn.state === 'failed';

  // A failure gets its own card: an icon, one sentence written for her, and a
  // retry button that stays disabled until retrying would actually work.
  if (failed && turn.failure) {
    return (
      <View style={apa.turnApaRow}>
        <View style={apa.turnApaMark}><ApaMark size={24} /></View>
        <View style={{ flex: 1 }}>
          <FailureCard failure={turn.failure} onRetry={turn.retry ? onRetry : undefined} />
        </View>
      </View>
    );
  }

  return (
    <View style={apa.turnApaRow}>
      <View style={apa.turnApaMark}><ApaMark size={24} /></View>
      <View style={[apa.turnApa, failed && { borderColor: '#F6DFAE', backgroundColor: '#FEF6E7' }]}>
        <RichAnswer text={turn.text} textStyle={apa.turnText} strongStyle={apa.turnStrong} />

        {/* She asked for more detail rather than guessing. Marked so it reads
            as a question to answer, not as a failure to work around. */}
        {turn.askedClarification ? (
          <Text style={[apa.speakerHint, { marginTop: 6, fontStyle: 'italic' }]}>
            {tx('একটু বিস্তারিত বললে সঠিক উত্তর দিতে পারব।', 'A little more detail lets me answer properly.')}
          </Text>
        ) : null}

        {turn.advice ? (
          <AnswerCallout
            kind={turn.advice.kind === 'likely' ? 'likely' : 'advice'}
            title={turn.advice.title_bn}
            body={turn.advice.body}
            textStyle={apa.adviceText}
            strongStyle={apa.turnStrong}
          />
        ) : null}

        {turn.caution ? (
          <View style={apa.caution}>
            <Text style={apa.cautionIcon}>⚠</Text>
            <Text style={apa.cautionText}>{turn.caution}</Text>
          </View>
        ) : null}

        {turn.sources?.length ? (
          <View style={apa.chipRow}>
            {turn.sources.map((source, i) => {
              const target = screenFromAction(source.action);
              return (
                <Pressable
                  key={`${source.kind}-${i}`}
                  style={apa.source}
                  disabled={!target}
                  onPress={() => target && onAction(target)}
                >
                  <Text style={apa.sourceText}>{source.label_bn}</Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {/* Read-aloud sits at the bubble's bottom-left, always in the same
            place, because it is the control a farmer who cannot read uses most.
            The phone's own voice says it, so it is instant and works offline. */}
        {turn.text ? (
          <View style={apa.speaker}>
            {/* The row this replaces had a play glyph, a track whose fill was a
                constant `width: '35%'`, and a caption. The bar reported nothing
                while looking like it did, which is worse than no bar at all:
                one that never moves reads as a stuck download. There was also
                no loading state, so the second or two spent fetching a clip
                looked like an ignored press, and no way back to the start of an
                answer she only half heard. SpeechBar is all three. */}
            <SpeechBar state={speechState} onToggle={onReplay} />
            {turn.messageId ? (
              <>
                <Pressable
                  onPress={() => { setReasonOpen(false); onVote('up'); }}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={tx('কাজে লেগেছে', 'Helpful')}
                >
                  <Text style={{ fontSize: 15, opacity: turn.vote === 'up' ? 1 : 0.35 }}>👍</Text>
                </Pressable>
                <Pressable
                  onPress={() => setReasonOpen((v) => !v)}
                  hitSlop={6}
                  accessibilityRole="button"
                  accessibilityLabel={tx('কাজে লাগেনি', 'Not helpful')}
                >
                  <Text style={{ fontSize: 15, opacity: turn.vote === 'down' ? 1 : 0.35 }}>👎</Text>
                </Pressable>
              </>
            ) : null}
          </View>
        ) : null}

        {/* A bare thumbs-down is a number nobody can act on. "Wrong for my
            area" and "did not understand me" need completely different fixes,
            and only she knows which it was. */}
        {reasonOpen && turn.messageId ? (
          <ReasonPicker
            tx={tx}
            onPick={(reason) => { setReasonOpen(false); onVote('down', reason); }}
            onSkip={() => { setReasonOpen(false); onVote('down'); }}
          />
        ) : null}

        {turn.state === 'unheard' || failed ? (
          <View style={apa.chipRow}>
            <Pressable style={apa.suggest} onPress={onReplay}>
              <Text style={apa.suggestText}>{tx('▶ কী রেকর্ড হয়েছে শুনুন', '▶ Hear what was recorded')}</Text>
            </Pressable>
          </View>
        ) : null}

        {turn.suggestions?.length ? (
          <>
            <Text style={[apa.speakerHint, { marginTop: 2 }]}>{tx('আরও জানতে', 'Ask next')}</Text>
            <View style={apa.chipRow}>
              {turn.suggestions.map((item) => (
                <Pressable key={item} style={apa.suggest} onPress={() => onSuggestion(item)}>
                  <Text style={apa.suggestText}>{item}</Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        {turn.officer?.name ? <OfficerStrip officer={turn.officer} tx={tx} /> : null}
      </View>
    </View>
  );
}

/**
 * Why the answer was not useful, in her words rather than a star rating.
 *
 * Five reasons, because five is what a person will read. Each one points at a
 * different repair: "wrong for my area" is a grounding bug, "did not understand
 * me" is transcription, "hard to follow" is the prompt's register, "the
 * information is wrong" is the model and "not the whole answer" is the length
 * cap. A single downvote count told us none of that.
 *
 * Skipping is always available — a farmer who just wants to register that it
 * was bad must not be made to fill in a form first.
 */
const REASONS: { id: string; bn: string; en: string }[] = [
  { id: 'wrong_area',     bn: 'আমার এলাকার জন্য ঠিক নয়', en: 'Not right for my area' },
  { id: 'not_understood', bn: 'আমার প্রশ্ন বোঝেনি',        en: 'Did not understand me' },
  { id: 'hard_to_follow', bn: 'বুঝতে কষ্ট হয়েছে',          en: 'Hard to follow' },
  { id: 'wrong_info',     bn: 'তথ্য ভুল মনে হয়েছে',        en: 'The information looks wrong' },
  { id: 'incomplete',     bn: 'পুরো উত্তর পাইনি',           en: 'Not the whole answer' },
];

function ReasonPicker({
  tx, onPick, onSkip,
}: {
  tx: (bnText: string, enText: string) => string;
  onPick: (reason: string) => void;
  onSkip: () => void;
}) {
  return (
    <View style={{ marginTop: 10, gap: 8 }}>
      <Text style={apa.speakerHint}>{tx('কী সমস্যা হয়েছে?', 'What went wrong?')}</Text>
      <View style={apa.chipRow}>
        {REASONS.map((reason) => (
          <Pressable
            key={reason.id}
            style={apa.suggest}
            onPress={() => onPick(reason.id)}
            accessibilityRole="button"
          >
            <Text style={apa.suggestText}>{tx(reason.bn, reason.en)}</Text>
          </Pressable>
        ))}
        <Pressable style={apa.suggest} onPress={onSkip} accessibilityRole="button">
          <Text style={[apa.suggestText, { color: colors.muted }]}>{tx('বলতে চাই না', 'Skip')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * The escape hatch behind every hedged answer, every refusal and every pending
 * verification. Reused verbatim from the loan flow on purpose — a farmer who
 * has been through readiness already recognises it.
 */
function OfficerStrip({
  officer, tx,
}: {
  officer: { name?: string; phone?: string; area?: string };
  tx: (bnText: string, enText: string) => string;
}) {
  return (
    <View style={[apa.officer, { marginHorizontal: 0 }]}>
      <View style={apa.officerAvatar}>
        <Text style={apa.officerAvatarText}>{(officer.name ?? '?').slice(0, 1)}</Text>
      </View>
      <View style={apa.officerBody}>
        <Text style={apa.officerEyebrow}>{tx('আপনার এলাকার', 'Your area')}</Text>
        <Text style={apa.officerName} numberOfLines={1}>{officer.name}</Text>
        {officer.area ? <Text style={apa.officerArea}>{officer.area}</Text> : null}
      </View>
      {officer.phone ? (
        <Pressable style={apa.officerCall} onPress={() => Linking.openURL(`tel:${officer.phone}`)}>
          <Text style={apa.officerCallText}>{tx('📞 কল', '📞 Call')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/** Warm rose, never red, and the second action still gives her something. */
function SoftWall({
  message, onVerify, lang, tx,
}: {
  message: string;
  onVerify: () => void;
  lang: string;
  tx: (bnText: string, enText: string) => string;
}) {
  return (
    <View style={apa.wall}>
      <Text style={apa.wallTitle}>{tx('পরিচয় যাচাই করলে সব খুলে যাবে', 'Verify to unlock everything')}</Text>
      <Text style={apa.wallBody}>{message}</Text>
      <AppButton title={tx('পরিচয় যাচাই করুন', 'Verify my identity')} onPress={onVerify} />
    </View>
  );
}

/* ===========================================================================
   Composer
   =========================================================================== */

const CANCEL_DISTANCE = 70;
// Nine bars fit the 60px microphone. Eighteen were drawn for a 92px one
// that no longer exists, and overflowed the circle.
const BAR_COUNT = 9;

export function ApaComposer({ setScreen }: { setScreen: (screen: Screen) => void }) {
  const { tx, lang } = useLanguage();
  const { entitlement, busy, askText, askVoice, setRecording } = useApa();
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState('');
  const [recording, setRec] = useState(false);
  const [cancelArmed, setCancelArmed] = useState(false);
  const [micDenied, setMicDenied] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => Array(BAR_COUNT).fill(3));

  const startedAt = useRef(0);
  const cancelRef = useRef(false);
  // Hold-to-talk is the gesture farmers know from WhatsApp, and it is also the
  // one gesture some of them cannot make — arthritis, a hand carrying a load, a
  // cracked screen that does not track a long press. A quick tap latches the
  // recording on instead, and the next tap sends it. Both gestures, one button,
  // no setting to find.
  const latched = useRef(false);
  const [latchedOn, setLatchedOn] = useState(false);

  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const reduceMotion = useReducedMotion();

  // The waveform is read from the recorder rather than from the status
  // listener: `metering` is on RecorderState (getStatus), not on the
  // RecordingStatus the listener is handed.
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => {
      // -160 dB is silence and 0 dB is clipping. Mapped to a bar height so she
      // can see the phone is hearing her, which is this waveform's whole job.
      const db = recorder.getStatus().metering;
      // Capped at the bar container's height so a loud farmer does not push
      // the waveform outside the circle.
      const level = Math.max(3, Math.min(24, (((typeof db === 'number' ? db : -60) + 60) / 60) * 24));
      setLevels((current) => [...current.slice(1), level]);
    }, 90);
    return () => clearInterval(timer);
  }, [recorder, recording]);

  const canVoice = entitlement?.features.ask_voice !== false;
  // Both halves have to be true: the platform willing to pay for it, and this
  // build able to capture the audio. See LIVE_CLIENT_READY.
  const canLive = entitlement?.features.live === true && LIVE_CLIENT_READY;
  const liveMinutes = entitlement?.live.seconds_left ? Math.floor(entitlement.live.seconds_left / 60) : 0;

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - startedAt.current) / 1000)), 250);
    return () => clearInterval(timer);
  }, [recording]);

  const begin = useCallback(async () => {
    if (busy || !canVoice) return;
    // The phone must not be reading an answer aloud into its own microphone.
    await stopSpeech();
    const permission = await AudioModule.requestRecordingPermissionsAsync();
    if (!permission.granted) {
      // Never a dead button: tapping it opens the ask, and the composer says why.
      setMicDenied(true);
      return;
    }
    setMicDenied(false);
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
    startedAt.current = Date.now();
    cancelRef.current = false;
    setElapsed(0);
    setLevels(Array(BAR_COUNT).fill(3));
    setRec(true);
    setRecording(true);
  }, [busy, canVoice, recorder, setRecording]);

  const finish = useCallback(async () => {
    setRec(false);
    setRecording(false);
    setCancelArmed(false);
    latched.current = false;
    setLatchedOn(false);
    const seconds = Math.round((Date.now() - startedAt.current) / 1000);
    try {
      await recorder.stop();
    } catch {
      return;
    }
    const uri = recorder.uri;
    // Releasing inside the cancel zone keeps the clip as a replayable draft
    // rather than destroying it — first-time voice users cancel by accident
    // constantly (changed from §4.2).
    if (cancelRef.current || seconds < 1 || !uri) return;
    void askVoice(uri, seconds);
  }, [askVoice, recorder, setRecording]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          // A tap while latched is the send, not the start of a new recording.
          if (latched.current) { void finish(); return; }
          void begin();
        },
        onPanResponderMove: (_event, gesture) => {
          const armed = gesture.dy < -CANCEL_DISTANCE;
          cancelRef.current = armed;
          setCancelArmed(armed);
        },
        onPanResponderRelease: () => {
          // Released almost immediately and not in the cancel zone: she tapped
          // rather than held. Keep recording and wait for the next tap.
          const heldFor = Date.now() - startedAt.current;
          if (!latched.current && !cancelRef.current && heldFor < 450) {
            latched.current = true;
            setLatchedOn(true);
            return;
          }
          void finish();
        },
        onPanResponderTerminate: () => { cancelRef.current = true; void finish(); },
      }),
    [begin, finish]
  );

  async function pickPhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return;
    setScreen('apaCamera');
  }

  function send() {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    setTyping(false);
    void askText(text);
  }

  // The row changes shape rather than growing a second one above itself.
  // LayoutAnimation because the balance of the row comes from flex, and
  // animating widths by hand would fight it.
  const setTypingAnimated = useCallback(
    (next: boolean) => {
      if (!reduceMotion) {
        LayoutAnimation.configureNext({
          duration: 220,
          create: { type: 'easeInEaseOut', property: 'opacity' },
          update: { type: 'easeInEaseOut' },
          delete: { type: 'easeInEaseOut', property: 'opacity' },
        });
      }
      setTyping(next);
    },
    [reduceMotion]
  );

  return (
    <View style={apa.composer}>
      <View style={apa.tools}>
        {/* Photo stays on the left in both states, so one control never moves. */}
        <ToolButton
          icon="camera"
          label={tx('ছবি', 'Photo')}
          onPress={() => void pickPhoto()}
          disabled={busy || recording}
          compact={typing}
        />

        {typing ? (
          <>
            {/* The middle opens. The input used to appear as a whole extra row
                above the tools, which pushed the panel taller at the exact
                moment she needed to see what she was replying to. */}
            <TextInput
              style={[apa.input, apa.inputInline]}
              value={draft}
              onChangeText={setDraft}
              placeholder={tx('লিখে জিজ্ঞাসা করুন…', 'Type your question…')}
              placeholderTextColor={colors.muted}
              multiline
              autoFocus
              editable={!busy}
              onSubmitEditing={send}
              onBlur={() => { if (!draft.trim()) setTypingAnimated(false); }}
            />
            <PressableScale
              style={[apa.send, (!draft.trim() || busy) && apa.sendOff]}
              onPress={send}
              disabled={!draft.trim() || busy}
              accessibilityLabel={tx('পাঠান', 'Send')}
            >
              <Ionicons name="arrow-up" size={20} color="#fff" />
            </PressableScale>
          </>
        ) : (
          <>
            {/* Typing is second, where she reaches for it — it was third, past
                the microphone, which is the control she is trying not to use. */}
            <ToolButton
              icon="create-outline"
              label={tx('লিখুন', 'Type')}
              onPress={() => setTypingAnimated(true)}
              disabled={recording}
            />

            <MicButton
              pan={pan}
              recording={recording}
              latched={latchedOn}
              cancelArmed={cancelArmed}
              levels={levels}
              disabled={busy || !canVoice}
              locked={!canVoice}
              tx={tx}
            />

            {/* The same sparkle as the top navigation, so "this is the AI one"
                is one symbol across the app. */}
            <ToolButton
              icon="sparkles"
              label={tx('লাইভ', 'Live')}
              onPress={() => setScreen('apaVoice')}
              disabled={recording}
              dimmed={!canLive}
              badge={canLive ? (lang === 'bn' ? bn(liveMinutes) : String(liveMinutes)) : null}
            />
          </>
        )}
      </View>

      {typing ? (
        <PressableScale
          style={apa.typingBack}
          onPress={() => { setDraft(''); setTypingAnimated(false); }}
          accessibilityLabel={tx('বলে জিজ্ঞাসা করুন', 'Ask by voice instead')}
        >
          <Ionicons name="mic-outline" size={14} color={colors.maroon} />
          <Text style={apa.typingBackText}>{tx('বলে জিজ্ঞাসা করি', 'Ask by voice instead')}</Text>
        </PressableScale>
      ) : (
        <Text style={[apa.hint, recording && !cancelArmed && apa.hintLive, cancelArmed && apa.hintCancel]}>
          {micDenied
            ? tx('অনুমতি দিয়ে চালু করুন, নাহলে লিখে প্রশ্ন করুন', 'Allow the mic, or type instead')
            : busy
              ? tx('একটু অপেক্ষা করুন', 'One moment')
              : !canVoice
                ? tx('পরিচয় যাচাই করলে খুলে যাবে', 'Unlocks after verification')
                : recording
                  ? cancelArmed
                    ? tx('ছেড়ে দিলে বাতিল — রেকর্ডিং থেকে যাবে', 'Release to cancel — the clip is kept')
                    : latchedOn
                      ? `${clock(elapsed, lang === 'bn' ? 'bn' : 'en')} · ${tx('বলে শেষ হলে আবার চাপুন', 'tap again when you are done')}`
                      : `${clock(elapsed, lang === 'bn' ? 'bn' : 'en')} · ${tx('ছেড়ে দিন পাঠাতে · উপরে তুলে বাতিল', 'release to send · slide up to cancel')}`
                  : tx('চেপে ধরে বলুন, বা একবার চাপুন', 'Hold and speak, or tap once')}
        </Text>
      )}
    </View>
  );
}

/* --- the four controls --------------------------------------------------- */

/**
 * One of the three small buttons flanking the microphone.
 *
 * Ionicons rather than emoji: an emoji is rendered by whatever font the handset
 * ships, so 📷 and ⌨ were a different weight, size and colour on every phone,
 * and on some Android builds the keyboard glyph did not render at all.
 */
function ToolButton({
  icon, label, onPress, disabled, active, dimmed, badge, compact,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  active?: boolean;
  /** Present but not yet available — readable, not hidden. */
  dimmed?: boolean;
  badge?: string | null;
  /** Drops the caption while the input has the row, to make space for it. */
  compact?: boolean;
}) {
  return (
    <View style={[apa.toolSlot, compact && apa.toolSlotCompact]}>
      <PressableScale
        style={[apa.toolBtn, active && apa.toolBtnActive, (disabled || dimmed) && apa.toolBtnOff]}
        onPress={onPress}
        disabled={disabled}
        accessibilityLabel={label}
        accessibilityState={{ selected: Boolean(active), disabled: Boolean(disabled) }}
      >
        <Ionicons
          name={icon}
          size={22}
          color={dimmed ? colors.muted : active ? '#fff' : colors.maroon}
        />
        {badge ? (
          <View style={apa.toolBadge}>
            <Text style={apa.toolBadgeText}>{badge}</Text>
          </View>
        ) : null}
      </PressableScale>
      {compact ? null : (
        <Text style={[apa.toolLabel, dimmed && { color: colors.muted }]} numberOfLines={1}>
          {label}
        </Text>
      )}
    </View>
  );
}

/**
 * The microphone, which keeps its footprint.
 *
 * It used to grow from 72 to 92 pixels while recording, which moved every
 * control beside it and re-laid out the panel at the exact moment the farmer
 * was holding a finger on it. The size is fixed now and a ring pulses behind
 * it instead — the same information, none of the movement.
 */
function MicButton({
  pan, recording, latched, cancelArmed, levels, disabled, locked, tx,
}: {
  pan: ReturnType<typeof PanResponder.create>;
  recording: boolean;
  latched: boolean;
  cancelArmed: boolean;
  levels: number[];
  disabled?: boolean;
  locked?: boolean;
  tx: (bnText: string, enText: string) => string;
}) {
  const pulse = usePulse(recording && !cancelArmed);
  const reduce = useReducedMotion();
  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.28] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] });

  return (
    <View style={apa.micSlot}>
      <View {...pan.panHandlers}>
        <View style={apa.micWrap}>
          {recording && !cancelArmed && !reduce ? (
            <Animated.View
              pointerEvents="none"
              style={[apa.micRing, { transform: [{ scale: ringScale }], opacity: ringOpacity }]}
            />
          ) : null}
          <View
            style={[
              apa.mic,
              recording && apa.micRecording,
              disabled && apa.micOff,
              cancelArmed && { backgroundColor: APA_END },
            ]}
            accessibilityRole="button"
            accessibilityLabel={
              latched
                ? tx('পাঠাতে আবার চাপুন', 'Tap again to send')
                : tx('চেপে ধরে বলুন, বা একবার চাপুন', 'Hold to talk, or tap once')
            }
          >
            {recording ? (
              cancelArmed ? (
                <Ionicons name="close" size={26} color="#fff" />
              ) : (
                <View style={apa.micBars}>
                  {levels.map((h, i) => (
                    <View key={i} style={[apa.micBar, { height: h }]} />
                  ))}
                </View>
              )
            ) : (
              <Ionicons name="mic" size={28} color="#fff" />
            )}
            {locked ? (
              <View style={apa.micBadge}>
                <Ionicons name="lock-closed" size={11} color={colors.muted} />
              </View>
            ) : null}
          </View>
        </View>
      </View>
      <Text style={apa.toolLabel} numberOfLines={1}>
        {recording ? tx('শুনছি', 'Listening') : tx('বলুন', 'Speak')}
      </Text>
    </View>
  );
}

/* ===========================================================================
   Unlock
   =========================================================================== */

export function ApaUnlockScreen({ setScreen }: { setScreen: (screen: Screen) => void }) {
  const { tx, lang } = useLanguage();
  const { entitlement, reload, navigate } = useApa();

  const pending = entitlement?.requirements.find((r) => r.id === 'verified')?.state === 'pending';
  const unlocked = entitlement ? entitlement.features.live || entitlement.tier !== 'locked' : false;
  const done = entitlement?.steps_done ?? 0;
  const total = entitlement?.steps_total ?? 5;
  const gains = entitlement?.unlock ?? [];
  const nextStep = entitlement?.requirements.find((r) => r.state !== 'done' && r.action);

  return (
    <>
      <Header title={tx('পরিচয় যাচাই', 'Verify identity')} onBack={() => setScreen('shathiApa')} />
      <ScrollView contentContainerStyle={{ padding: 20, gap: 14, paddingBottom: 40 }}>
        <View style={apa.sheetIcon}><Text style={apa.sheetIconText}>{pending ? '⏳' : unlocked ? '🎉' : '🔓'}</Text></View>

        <Text style={apa.sheetTitle}>
          {pending
            ? tx('যাচাই চলছে', 'Verification in progress')
            : unlocked
              ? tx('যাচাই হয়ে গেছে!', 'You are verified!')
              : tx('পরিচয় যাচাই করলে কী পাবেন', 'What verifying gives you')}
        </Text>
        <Text style={apa.sheetBody}>
          {pending
            ? tx('সাধারণত ৭ কর্মদিবসে শেষ হয়। হয়ে গেলে জানিয়ে দেব। এর মাঝেও ভয়েস মেসেজ পাঠাতে পারবেন।',
                 'Usually done within 7 working days. We will tell you. Voice messages keep working meanwhile.')
            : unlocked
              ? tx('এখন যত খুশি প্রশ্ন করতে পারবেন — আর সরাসরি কথাও বলতে পারবেন।',
                   'Ask as much as you like now — and talk to her directly.')
              : tx('একবার যাচাই হলে আর কোনো সীমা থাকবে না। পুরোপুরি ফ্রি।',
                   'Once verified there are no limits at all. Completely free.')}
        </Text>

        {/* Three concrete gains, each naming something she has already tried.
            No feature list, no pricing table — this is a trust exchange. */}
        {gains.map((gain) => (
          <View style={apa.gain} key={gain.id}>
            <View style={apa.gainIcon}>
              <Text style={apa.gainIconText}>{gain.icon === 'phone' ? '📞' : gain.icon === 'camera' ? '📷' : '🎙'}</Text>
            </View>
            <View style={apa.gainBody}>
              <Text style={apa.gainTitle}>{gain.title_bn}</Text>
              <Text style={apa.gainDetail}>{gain.detail_bn}</Text>
            </View>
            <Text style={apa.gainTick}>✓</Text>
          </View>
        ))}

        {!unlocked ? (
          <>
            <View style={{ gap: 6 }}>
              <View style={apa.progressTrack}>
                <View style={[apa.progressFill, { width: `${Math.round((done / Math.max(1, total)) * 100)}%` }]} />
              </View>
              <Text style={apa.progressText}>
                {lang === 'bn' ? `${bn(done)}টি ধাপ শেষ · ${bn(total - done)}টি বাকি` : `${done} of ${total} steps done`}
              </Text>
            </View>

            {entitlement?.requirements.map((req) => (
              <Pressable
                key={req.id}
                style={apa.gain}
                disabled={!req.action}
                onPress={() => {
                  const target = screenFromAction(req.action);
                  if (target) navigate(target);
                }}
              >
                <View style={apa.gainIcon}>
                  <Text style={apa.gainIconText}>
                    {req.id === 'location' ? '📍' : req.id === 'selfie' ? '🤳' : req.id === 'verified' ? '🔎' : '🪪'}
                  </Text>
                </View>
                <View style={apa.gainBody}>
                  <Text style={apa.gainTitle}>{req.label_bn}</Text>
                  <Text style={apa.gainDetail}>{req.detail_bn}</Text>
                </View>
                {req.state === 'done' ? (
                  <Text style={apa.gainTick}>✓</Text>
                ) : req.action_label_bn ? (
                  <Text style={apa.rowValue}>{req.action_label_bn}</Text>
                ) : (
                  <View style={apa.gainTodo} />
                )}
              </Pressable>
            ))}
          </>
        ) : null}

        {unlocked ? (
          <AppButton title={tx('চ্যাটে ফিরে যান', 'Back to chat')} onPress={() => setScreen('shathiApa')} />
        ) : nextStep ? (
          <AppButton
            title={nextStep.action_label_bn ?? tx('যাচাই শুরু করুন', 'Start verifying')}
            onPress={() => {
              const target = screenFromAction(nextStep.action);
              if (target) navigate(target);
            }}
          />
        ) : null}

        {/* Where a farmer actually gets stuck: the photograph was rejected, or
            it has been pending for three days, and "upload it again" is not an
            answer to either. Somebody local, by name, with a phone number. */}
        {entitlement?.officer?.name ? (
          <>
            <Text style={apa.starterLabel}>
              {pending
                ? tx('দেরি হচ্ছে? আপনার এলাকার অফিসারকে জিজ্ঞাসা করুন', 'Taking long? Ask your local officer')
                : tx('সাহায্য দরকার হলে', 'If you need help')}
            </Text>
            <OfficerStrip officer={entitlement.officer} tx={tx} />
          </>
        ) : null}

        <AppButton title={tx('পরে করব', 'Later')} variant="outline" onPress={() => setScreen('shathiApa')} />
        <Text style={apa.sheetFoot}>{tx('আপনার এনআইডি শুধু যাচাইয়ের কাজে ব্যবহার হবে।', 'Your NID is used only for verification.')}</Text>
        <Pressable onPress={reload}><Text style={apa.sheetFoot}>{tx('আবার দেখুন', 'Check again')}</Text></Pressable>
      </ScrollView>
    </>
  );
}

/* ===========================================================================
   Live conversation
   =========================================================================== */

type OrbState = 'connecting' | 'listening' | 'thinking' | 'speaking' | 'reconnecting' | 'paused';

const ORB: Record<OrbState, { label_bn: string; label_en: string; hint_bn: string; hint_en: string; halo: string; core: string; bar: string }> = {
  connecting:  { label_bn: 'সংযোগ হচ্ছে…', label_en: 'Connecting…', hint_bn: 'একটু অপেক্ষা করুন — লাইন আসছে।', hint_en: 'One moment — the line is coming up.', halo: '#EFE6EA', core: '#FFFFFF', bar: '#C8B4BE' },
  listening:   { label_bn: 'শুনছি… বলুন', label_en: 'Listening…', hint_bn: 'আপনার কথা শেষ হলে আমি বুঝে নেব।', hint_en: 'I will know when you finish.', halo: '#DCFCE7', core: '#FFFFFF', bar: APA_GREEN },
  thinking:    { label_bn: 'ভাবছি…', label_en: 'Thinking…', hint_bn: 'এক সেকেন্ড — খুঁজে নিচ্ছি।', hint_en: 'One second — looking it up.', halo: '#FEF3DC', core: '#FFFFFF', bar: APA_AMBER },
  speaking:    { label_bn: 'বলছি…', label_en: 'Speaking…', hint_bn: 'কিছু বলতে চাইলে যেকোনো সময় বলুন — আমি থেমে যাব।', hint_en: 'Cut in any time — I will stop.', halo: '#F4E8EE', core: colors.maroon, bar: '#FFFFFF' },
  reconnecting:{ label_bn: 'আবার সংযোগ হচ্ছে…', label_en: 'Reconnecting…', hint_bn: 'কথা হারায়নি — লাইন ফিরলেই যেখান থেকে ছিলাম সেখান থেকে চলবে।', hint_en: 'Nothing is lost — we resume where we stopped.', halo: '#FEF3DC', core: '#FFFFFF', bar: APA_AMBER },
  paused:      { label_bn: 'বিরতি', label_en: 'Paused', hint_bn: 'চালু করতে সবুজ বোতামে চাপ দিন। সময় গোনা বন্ধ আছে।', hint_en: 'Tap play to resume. The clock has stopped.', halo: '#EFE6EA', core: '#FFFFFF', bar: '#C8B4BE' },
};

export function ApaLiveScreen({ setScreen }: { setScreen: (screen: Screen) => void }) {
  const { tx, lang } = useLanguage();
  const { entitlement, conversationId } = useApa();
  // Which screen she lands on is decided from the entitlement she already has,
  // not by letting her read a data-cost notice, tap "start", and only then be
  // told live is unavailable. The pre-flight notice is for farmers who can
  // actually make the call.
  const canStart = entitlement?.features.live === true && LIVE_CLIENT_READY;
  const [stage, setStage] = useState<'notice' | 'live' | 'receipt' | 'blocked'>(
    canStart ? 'notice' : 'blocked'
  );
  const [orb, setOrb] = useState<OrbState>('connecting');
  const [session, setSession] = useState<{ id: number; allowed: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [receipt, setReceipt] = useState<ApaLiveReceipt | null>(null);
  const [message, setMessage] = useState('');
  const [strip, setStrip] = useState<{ who: 'me' | 'apa'; text: string }[]>([]);
  const reduceMotion = useReducedMotion();
  // True while her finger is down. Live on this key is press-to-talk, not an
  // open microphone — see src/ai/live.ts for the measurement that forced that.
  const [talking, setTalking] = useState(false);
  const [endingSoon, setEndingSoon] = useState(false);
  const live = useRef<LiveHandle | null>(null);

  const mbPerMinute = entitlement?.live.data_mb_per_minute ?? 2;
  const minutesLeft = Math.floor((entitlement?.live.seconds_left ?? 0) / 60);

  /* --- her data, her decision ------------------------------------------- */

  // "Live only on Wi-Fi" is her preference, not a lock we impose. On mobile
  // data with the preference on, she is told what it will cost and asked —
  // once, for this call. A farmer standing in a field with no Wi-Fi and a real
  // question about a dying animal must not be refused by a setting she can no
  // longer remember turning on.
  const [onCellular, setOnCellular] = useState<boolean | null>(null);
  const [dataConsent, setDataConsent] = useState(false);
  const [wifiOnly, setWifiOnly] = useState(false);

  useEffect(() => {
    let alive = true;
    void Network.getNetworkStateAsync()
      .then((state) => {
        if (alive) setOnCellular(state.type === Network.NetworkStateType.CELLULAR);
      })
      .catch(() => { if (alive) setOnCellular(null); });
    void getApaSettings()
      .then((data) => { if (alive) setWifiOnly(Boolean(data.settings.wifi_only_live)); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);

  /** True when she has asked us to prefer Wi-Fi and we are not on Wi-Fi. */
  const needsConsent = wifiOnly && onCellular === true && !dataConsent;

  useEffect(() => {
    // The entitlement can land a moment after this screen mounts on a cold
    // start, so the opening stage is corrected once rather than guessed twice.
    if (stage === 'blocked' && canStart) setStage('notice');
  }, [canStart, stage]);

  // A screen that unmounts with the socket open keeps the microphone and keeps
  // being billed. Back-swiping out of a call must cost nothing more.
  useEffect(() => () => { void live.current?.close('farmer_hung_up'); live.current = null; }, []);

  // The clock stops when paused or reconnecting: a dropped line must never
  // spend her quota, and she has to be able to see that it is not spending.
  useEffect(() => {
    if (stage !== 'live' || orb === 'paused' || orb === 'reconnecting') return;
    const timer = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [stage, orb]);

  const close = useCallback(
    async (reason: string) => {
      // The socket first, so the microphone is released and nothing more is
      // billed while the receipt is being fetched.
      const spent = live.current?.seconds() ?? elapsed;
      await live.current?.close('farmer_hung_up');
      live.current = null;
      if (!session) { setScreen('shathiApa'); return; }
      try {
        setReceipt(await closeApaLive({ sessionId: session.id, seconds: spent || elapsed, reason }));
        setStage('receipt');
      } catch {
        setScreen('shathiApa');
      }
    },
    [elapsed, session, setScreen]
  );

  /**
   * Everything the socket says, turned into what she sees.
   *
   * One place, because the orb has six states and the temptation is to set them
   * from wherever is convenient — which is how a screen ends up claiming to
   * listen while the socket is reconnecting.
   */
  const onLiveEvent = useCallback(
    (event: Parameters<Parameters<typeof openLive>[0]['onEvent']>[0]) => {
      switch (event.type) {
        case 'state':
          setOrb(event.state as OrbState);
          break;
        case 'said':
          setStrip((lines) => [...lines, { who: 'apa', text: event.text }]);
          break;
        case 'asked':
          // No text, deliberately. This path returns no transcript of her own
          // words — the live model understands the audio but sends no
          // inputTranscription for a clientContent turn — so writing one would
          // be a guess printed as a quote. The duration is honest and is enough
          // to show that her turn landed.
          setStrip((lines) => [
            ...lines,
            {
              who: 'me',
              text: tx(
                `আপনি বললেন · ${bn(Math.round(event.seconds))} সেকেন্ড`,
                `You spoke · ${Math.round(event.seconds)}s`
              ),
            },
          ]);
          break;
        case 'ending':
          setEndingSoon(true);
          break;
        case 'error':
          // Already a sentence a farmer can read — src/ai/live.ts never passes
          // a socket code through.
          setMessage(event.message);
          break;
        case 'closed':
          if (event.reason !== 'farmer_hung_up') void close(event.reason);
          break;
      }
    },
    [close, tx]
  );

  async function start() {
    setMessage('');
    try {
      const started = await startApaLive(conversationId);
      setSession({ id: started.session_id, allowed: started.allowed_seconds });
      setStage('live');
      setOrb('connecting');
      // Opened before the connected mark, so a socket that refuses is never
      // recorded as a call she had.
      live.current = await openLive({
        url: started.token.url,
        allowedSeconds: started.allowed_seconds,
        onEvent: onLiveEvent,
      });
      await markApaLiveConnected(started.session_id);
    } catch (e) {
      // The server re-checks the entitlement at mint time, so this is also the
      // path for a quota that ran out between opening the screen and tapping,
      // and for the budget ceiling closing live.
      await live.current?.close('failed');
      live.current = null;
      setMessage(
        e instanceof Error
          ? e.message
          : tx('লাইভ কথা এখন শুরু করা যাছ্ছে না।', 'Live cannot start right now.')
      );
      setStage('blocked');
    }
  }

  const spec = ORB[orb];

  if (stage === 'notice') {
    return (
      <>
        <Header title={tx('লাইভ কথা', 'Live conversation')} onBack={() => setScreen('shathiApa')} />
        <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
          <View style={apa.sheetIcon}><Text style={apa.sheetIconText}>📞</Text></View>
          <Text style={apa.sheetTitle}>{tx('লাইভ কথা বলার আগে জেনে নিন', 'Before you start')}</Text>
          <Text style={apa.sheetBody}>
            {tx('লাইভ কথায় আপনার ফোনের ডেটা খরচ হয়। কথা যত লম্বা, খরচ তত বেশি।',
                'A live conversation spends your phone data. The longer you talk, the more it costs.')}
          </Text>
          {/* The cost is the headline, in MB and in minutes she can picture. */}
          <View style={apa.notice}>
            <Text style={[apa.noticeText, { fontWeight: '800' }]}>
              {lang === 'bn' ? `📶 প্রতি মিনিটে প্রায় ${bn(mbPerMinute)} MB` : `📶 About ${mbPerMinute} MB a minute`}
            </Text>
            <Text style={apa.noticeText}>
              {lang === 'bn'
                ? `ওয়াই-ফাই থাকলে ব্যবহার করুন। ৩ মিনিট কথা বললে প্রায় ${bn(mbPerMinute * 3)} MB খরচ হবে।`
                : `Use Wi-Fi if you have it. Three minutes costs about ${mbPerMinute * 3} MB.`}
            </Text>
          </View>
          {/* Her Wi-Fi preference, honoured as a question rather than a wall. */}
          {needsConsent ? (
            <View style={[apa.notice, { borderColor: APA_AMBER, backgroundColor: '#FEF6E7' }]}>
              <Text style={[apa.noticeText, { fontWeight: '800' }]}>
                {tx('আপনি এখন মোবাইল ডেটায় আছেন', 'You are on mobile data right now')}
              </Text>
              <Text style={apa.noticeText}>
                {lang === 'bn'
                  ? `আপনি ঠিক করে রেখেছেন যে লাইভ কথা শুধু ওয়াই-ফাইতে হবে। এখন কথা বললে প্রায় ${bn(mbPerMinute)} MB প্রতি মিনিটে আপনার ডেটা খরচ হবে।`
                  : `You chose to keep live calls on Wi-Fi. Talking now spends about ${mbPerMinute} MB a minute of your own data.`}
              </Text>
            </View>
          ) : null}

          {needsConsent ? (
            <>
              <AppButton
                title={tx('ঠিক আছে, আমার ডেটা ব্যবহার করুন', 'That is fine — use my data')}
                onPress={() => setDataConsent(true)}
              />
              <Text style={apa.sheetFoot}>
                {tx('শুধু এইবারের জন্য। আপনার সেটিংস বদলাবে না।', 'Just this once. Your setting does not change.')}
              </Text>
            </>
          ) : (
            <AppButton title={tx('শুরু করুন', 'Start')} onPress={() => void start()} />
          )}
          {/* The cheaper path is a full-width button, not a text link — most
              farmers should take it. */}
          <AppButton
            title={tx('ভয়েস মেসেজ পাঠাই — খরচ কম', 'Send a voice message — cheaper')}
            variant="outline"
            onPress={() => setScreen('shathiApa')}
          />
          <Text style={apa.sheetFoot}>
            {tx('ভয়েস মেসেজে উত্তর একই রকম পাবেন, শুধু একটু দেরিতে।', 'A voice message gets the same answer, just a little later.')}
          </Text>
        </ScrollView>
      </>
    );
  }

  if (stage === 'blocked') {
    // Four different reasons, four different things she should do about it.
    const locked = entitlement ? entitlement.tier === 'locked' || entitlement.tier === 'trial' : false;
    const spent = Boolean(entitlement && entitlement.live.seconds_left <= 0 && !locked);
    // The one case worth showing samples for: nothing is wrong, the feature
    // simply is not built yet.
    const comingSoon = !message && !locked && !spent && !LIVE_CLIENT_READY;
    const reason = message
      ? { icon: '🎙', title: tx('এখন শুরু করা গেল না', 'Could not start'), body: message }
      : locked
        ? {
            icon: '🔓',
            title: tx('লাইভ কথা যাচাইয়ের পরে', 'Live needs verification'),
            body: tx('পরিচয় যাচাই করলে মাসে ২০ মিনিট সরাসরি কথা বলতে পারবেন। ততদিন ভয়েস মেসেজ চালু আছে।',
                     'Verify your identity for 20 minutes of live conversation a month. Voice messages work meanwhile.'),
          }
        : spent
          ? {
              icon: '⏳',
              title: tx('এ মাসের লাইভ কথা শেষ', 'No live minutes left'),
              body: tx('ভয়েস মেসেজ পাঠাতে পারবেন যত খুশি — উত্তর একই রকম পাবেন, শুধু একটু দেরিতে। ১ তারিখে নতুন মিনিট যোগ হবে।',
                       'Send as many voice messages as you like — the same answers, just a little later. New minutes on the 1st.'),
            }
          : {
              icon: '🎙',
              title: tx('লাইভ কথা আসছে', 'Live is on the way'),
              body: tx('পরের অ্যাপ আপডেটে সরাসরি কথা বলতে পারবেন। ততদিন ভয়েস মেসেজ পাঠান — উত্তর একই রকম পাবেন, শুধু একটু দেরিতে।',
                       'Talking live arrives with the next app update. Until then send a voice message — the same answer, just a little later.'),
            };
    return (
      <>
        <Header title={tx('লাইভ কথা', 'Live conversation')} onBack={() => setScreen('shathiApa')} />
        <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
          <View style={apa.sheetIcon}><Text style={apa.sheetIconText}>{reason.icon}</Text></View>
          <Text style={apa.sheetTitle}>{reason.title}</Text>
          {comingSoon ? (
            <View style={[apa.headPill, apa.headPillTrial, { alignSelf: 'flex-start' }]}>
              <Text style={[apa.headPillText, apa.headPillTrialText]}>{tx('শীঘ্রই আসছে', 'Coming soon')}</Text>
            </View>
          ) : null}
          <Text style={apa.sheetBody}>{reason.body}</Text>

          {/* What she is waiting for, shown rather than described. The same
              model answers the same way through a voice message today — only
              the back-and-forth is missing — so this is a fair preview and not
              a promise about something that does not exist. */}
          {comingSoon ? (
            <View style={{ gap: 10 }}>
              <Text style={apa.starterLabel}>{tx('লাইভ কথা এমন হবে', 'A live conversation looks like this')}</Text>
              {LIVE_SAMPLES.map((line, i) =>
                line.who === 'me' ? (
                  <View key={i} style={[apa.turnUser, { alignSelf: 'flex-end', maxWidth: '86%' }]}>
                    <Text style={apa.turnUserText}>{tx(line.bn, line.en)}</Text>
                  </View>
                ) : (
                  <View key={i} style={apa.turnApaRow}>
                    <View style={apa.turnApaMark}><ApaMark size={24} /></View>
                    <View style={[apa.turnApa, { flex: 1 }]}>
                      <Text style={apa.turnText}>{tx(line.bn, line.en)}</Text>
                    </View>
                  </View>
                )
              )}
              <Text style={apa.sheetFoot}>
                {tx('উপরের কথাগুলো নমুনা — এখনই ভয়েস মেসেজে ঠিক এই উত্তরগুলোই পাবেন।',
                    'These are samples — a voice message gets you exactly these answers today.')}
              </Text>
            </View>
          ) : null}

          <View style={apa.gain}>
            <View style={apa.gainIcon}><Text style={apa.gainIconText}>🎙</Text></View>
            <View style={apa.gainBody}>
              <Text style={apa.gainTitle}>{tx('ভয়েস মেসেজ — কোনো সীমা নেই', 'Voice messages — no limit')}</Text>
              <Text style={apa.gainDetail}>{tx('ছবি ও লেখাও আগের মতোই চলবে', 'Photos and typing work as before')}</Text>
            </View>
            <Text style={apa.gainTick}>✓</Text>
          </View>
          {locked ? (
            <AppButton title={tx('পরিচয় যাচাই করুন', 'Verify my identity')} onPress={() => setScreen('apaUnlock')} />
          ) : null}
          <AppButton
            title={tx('🎙 ভয়েস মেসেজ পাঠাই', '🎙 Send a voice message')}
            variant={locked ? 'outline' : 'primary'}
            onPress={() => setScreen('shathiApa')}
          />
        </ScrollView>
      </>
    );
  }

  if (stage === 'receipt') {
    return (
      <>
        <Header title={tx('লাইভ কথা', 'Live conversation')} onBack={() => setScreen('shathiApa')} />
        <ScrollView contentContainerStyle={{ padding: 20, gap: 14 }}>
          <View style={[apa.sheetIcon, { backgroundColor: colors.greenPale }]}><Text style={apa.sheetIconText}>✓</Text></View>
          <Text style={apa.sheetTitle}>{tx('কথা শেষ হয়েছে', 'Conversation ended')}</Text>
          <Text style={apa.sheetBody}>{tx('আজকের আলাপের হিসাব —', "Today's conversation —")}</Text>
          {/* An honest receipt, not a rating prompt. */}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <View style={[apa.notice, { flex: 1, marginHorizontal: 0, marginTop: 0 }]}>
              <Text style={apa.noticeText}>{tx('সময়', 'Time')}</Text>
              <Text style={[apa.noticeText, { fontWeight: '800', fontSize: 16 }]}>{clock(receipt?.seconds ?? 0, lang === 'bn' ? 'bn' : 'en')}</Text>
            </View>
            <View style={[apa.notice, { flex: 1, marginHorizontal: 0, marginTop: 0 }]}>
              <Text style={apa.noticeText}>{tx('ডেটা', 'Data')}</Text>
              <Text style={[apa.noticeText, { fontWeight: '800', fontSize: 16 }]}>
                {lang === 'bn' ? `প্রায় ${bn(String(receipt?.data_mb ?? 0))} MB` : `About ${receipt?.data_mb ?? 0} MB`}
              </Text>
            </View>
          </View>
          <View style={apa.gain}>
            <View style={apa.gainIcon}><Text style={apa.gainIconText}>🔊</Text></View>
            <View style={apa.gainBody}>
              <Text style={apa.gainDetail}>
                {tx('পুরো আলাপ চ্যাটে সংরক্ষিত আছে — যখন খুশি শুনতে পারবেন।', 'The whole conversation is saved in the chat.')}
              </Text>
            </View>
          </View>
          <AppButton title={tx('চ্যাটে ফিরে যান', 'Back to chat')} onPress={() => setScreen('shathiApa')} />
          <Text style={apa.sheetFoot}>
            {lang === 'bn'
              ? `এ মাসে আরও ${bn(receipt?.minutes_left ?? 0)} মিনিট লাইভ কথা বাকি আছে।`
              : `${receipt?.minutes_left ?? 0} live minutes left this month.`}
          </Text>
        </ScrollView>
      </>
    );
  }

  return (
    <View style={apa.liveScreen}>
      <View style={apa.liveHead}>
        <Pressable onPress={() => void close('back')} style={apa.headBack} hitSlop={8}>
          <Text style={apa.headBackText}>‹</Text>
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={apa.liveHeadTitle}>{tx('লাইভ কথা', 'Live')}</Text>
          <Text style={apa.liveHeadSub}>
            {orb === 'paused'
              ? `${clock(elapsed, lang === 'bn' ? 'bn' : 'en')} — ${tx('বিরতি', 'paused')}`
              : orb === 'connecting'
                ? tx('সংযোগ হচ্ছে', 'connecting')
                : `${clock(elapsed, lang === 'bn' ? 'bn' : 'en')} ${tx('কথা চলছে', 'talking')}`}
          </Text>
        </View>
        {/* Elapsed and remaining sit in the header the whole time — no surprise
            bill — but the quota is never a live counter (V4). */}
        <View style={apa.liveHeadQuota}>
          <Text style={apa.liveHeadQuotaText}>
            {lang === 'bn' ? `${bn(minutesLeft)} মিনিট বাকি` : `${minutesLeft} min left`}
          </Text>
        </View>
      </View>

      <View style={apa.liveStage}>
        <Orb state={orb} spec={spec} reduceMotion={reduceMotion} />
        <View>
          <Text style={apa.liveLabel}>{lang === 'bn' ? spec.label_bn : spec.label_en}</Text>
          <Text style={apa.liveSecondary}>{lang === 'bn' ? spec.hint_bn : spec.hint_en}</Text>
        </View>
        {/* The instruction belongs here rather than only in the orb's own hint
            text: "press and hold" is the one thing she has to know, and the
            orb's label changes underneath it. */}
        {orb === 'listening' && !talking ? (
          <Text style={apa.liveSecondary}>
            {tx('নিচের মাইক চেপে ধরে বলুন', 'Hold the microphone below and speak')}
          </Text>
        ) : null}
        {endingSoon ? (
          <Text style={apa.liveSecondary}>{tx('আর প্রায় দুই মিনিট আছে', 'About two minutes left')}</Text>
        ) : null}
        {message ? <Text style={[apa.liveSecondary, { color: APA_END }]}>{message}</Text> : null}
        {strip.length ? (
          <View style={apa.strip}>
            {strip.slice(-2).map((line, i) => (
              <View key={i}>
                <Text style={apa.stripWho}>{line.who === 'me' ? tx('আপনি', 'You') : tx('শাথী আপা', 'Shathi Apa')}</Text>
                <Text style={apa.stripLine} numberOfLines={2}>{line.text}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>

      {/* Press-to-talk, not mute.
          A mute button belongs on an open microphone, and there is no open
          microphone here: the streaming input path is accepted by the API and
          then ignored (src/ai/live.ts). Offering mute would imply Apa is
          listening the rest of the time, which she is not.

          While she is being answered the middle button stops the reply
          instead. That is not barge-in — it drops audio already sent rather
          than interrupting generation — but it is the part of barge-in she
          actually reaches for: making Apa stop. */}
      <View style={apa.liveControls}>
        <Pressable
          style={[apa.liveSide, orb === 'paused' && apa.liveSideOn]}
          onPress={() => {
            if (orb === 'paused') { live.current?.resume(); setOrb('listening'); }
            else { live.current?.pause(); setOrb('paused'); }
          }}
          accessibilityLabel={orb === 'paused' ? tx('চালু করুন', 'Resume') : tx('বিরতি', 'Pause')}
        >
          <Text style={apa.liveSideIcon}>{orb === 'paused' ? '▶' : '❚❚'}</Text>
        </Pressable>

        {orb === 'speaking' ? (
          <Pressable
            style={apa.liveMain}
            onPress={() => live.current?.hush()}
            accessibilityLabel={tx('থামান', 'Stop')}
          >
            <Text style={apa.liveMainIcon}>{'❚❚'}</Text>
          </Pressable>
        ) : (
          <Pressable
            style={apa.liveMain}
            disabled={orb === 'connecting' || orb === 'reconnecting' || orb === 'paused' || orb === 'thinking'}
            onPressIn={() => {
              setMessage('');
              setTalking(true);
              void live.current?.startTalking();
            }}
            onPressOut={() => {
              setTalking(false);
              void live.current?.stopTalking();
            }}
            accessibilityLabel={tx('চেপে ধরে বলুন', 'Hold to speak')}
          >
            <Text style={apa.liveMainIcon}>{talking ? '●' : '🎙'}</Text>
          </Pressable>
        )}

        <Pressable
          style={[apa.liveSide, { backgroundColor: APA_END }]}
          onPress={() => void close('ended')}
          accessibilityLabel={tx('শেষ করুন', 'End')}
        >
          <Text style={[apa.liveSideIcon, { color: '#fff' }]}>{'■'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

/**
 * The orb. Colour and glyph carry the state on their own, because under
 * prefers-reduced-motion or on a phone that cannot hold 30fps every loop stops
 * and the glyph is all that is left.
 */
function Orb({
  state, spec, reduceMotion = false,
}: {
  state: OrbState;
  spec: (typeof ORB)[OrbState];
  /** Honour the system switch: the breathing halo is nausea for some people. */
  reduceMotion?: boolean;
}) {
  const loop = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    loop.setValue(0);
    if (state === 'paused') return;
    if (reduceMotion) {
      // Held at full size rather than pulsing. The colour and the label still
      // carry the state, which is what the orb is actually for.
      loop.setValue(1);
      return;
    }
    const duration = state === 'reconnecting' ? 2400 : state === 'connecting' ? 1800 : state === 'thinking' ? 3600 : 900;
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(loop, { toValue: 1, duration: duration / 2, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(loop, { toValue: 0, duration: duration / 2, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [loop, reduceMotion, state]);

  const scale = loop.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] });
  const opacity = loop.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1] });

  return (
    <Animated.View style={[apa.orbHalo, { backgroundColor: spec.halo, transform: [{ scale }], opacity }]}>
      {state === 'thinking' || state === 'reconnecting' ? (
        <View style={[apa.orbRing, { borderColor: spec.bar }]} />
      ) : null}
      <View style={[apa.orbCore, { backgroundColor: spec.core }]}>
        {state === 'connecting' || state === 'paused' ? (
          <View style={apa.orbDots}>
            {[0, 1, 2].map((i) => <View key={i} style={[apa.orbDot, { backgroundColor: spec.bar }]} />)}
          </View>
        ) : state === 'reconnecting' ? (
          <Text style={apa.orbGlyph}>📡</Text>
        ) : state === 'thinking' ? (
          <ApaMark size={40} />
        ) : (
          <View style={apa.orbBars}>
            {[16, 30, 44, 30, 16].map((h, i) => <View key={i} style={[apa.orbBar, { height: h, backgroundColor: spec.bar }]} />)}
          </View>
        )}
      </View>
    </Animated.View>
  );
}

/* ===========================================================================
   Camera
   =========================================================================== */

/**
 * The questions a photograph can answer.
 *
 * Free text is gone from this screen, deliberately. A farmer who has just
 * photographed a sick animal is not in a position to compose a good prompt, and
 * what she typed was usually two words — which produced the vaguest possible
 * answer and burned a vision call doing it. These five are the questions the
 * photographs in this platform are actually about, they are one tap, and each
 * one gives the model something specific to look for.
 *
 * They are written to fit a crop or an animal, because she photographs both and
 * asking her to pick a category first is a step that buys nothing.
 */
const PHOTO_QUESTIONS: Array<{
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  bn: string;
  en: string;
  ask_bn: string;
  ask_en: string;
}> = [
  {
    id: 'disease',
    icon: 'medkit-outline',
    bn: 'কী রোগ হয়েছে?',
    en: 'What disease is this?',
    ask_bn: 'ছবিটা দেখে বলুন কী রোগ বা সমস্যা হয়েছে, আর কেন মনে হচ্ছে।',
    ask_en: 'Look at this photo and tell me what disease or problem it is, and why you think so.',
  },
  {
    id: 'healthy',
    icon: 'heart-outline',
    bn: 'সুস্থ আছে কি?',
    en: 'Is it healthy?',
    ask_bn: 'ছবিটা দেখে বলুন এটা সুস্থ দেখাচ্ছে কি না, আর কোন লক্ষণ দেখে বুঝলেন।',
    ask_en: 'Looking at this photo, does it look healthy, and which signs tell you that?',
  },
  {
    id: 'next',
    icon: 'footsteps-outline',
    bn: 'এখন কী করব?',
    en: 'What should I do now?',
    ask_bn: 'ছবিটা দেখে বলুন এখন আমার কী কী করা উচিত, ধাপে ধাপে।',
    ask_en: 'Looking at this photo, what should I do now, step by step?',
  },
  {
    id: 'care',
    icon: 'leaf-outline',
    bn: 'যত্ন কীভাবে নেব?',
    en: 'How do I care for it?',
    ask_bn: 'ছবিটা দেখে বলুন এর যত্ন, খাবার বা সার নিয়ে কী করা উচিত।',
    ask_en: 'Looking at this photo, what should I do about its care, feed or fertiliser?',
  },
  {
    id: 'spread',
    icon: 'git-network-outline',
    bn: 'ছড়িয়ে পড়বে কি?',
    en: 'Will it spread?',
    ask_bn: 'ছবিটা দেখে বলুন এটা অন্যগুলোতে ছড়াতে পারে কি না, আর ছড়ানো আটকাতে কী করব।',
    ask_en: 'Looking at this photo, can this spread to the others, and how do I stop it?',
  },
];

export function ApaCameraScreen({ setScreen }: { setScreen: (screen: Screen) => void }) {
  const { tx, lang } = useLanguage();
  const { askPhoto } = useApa();
  const [photo, setPhoto] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const [notice, setNotice] = useState<string>('');

  async function shoot(fromLibrary: boolean) {
    setNotice('');
    const permission = fromLibrary
      ? await ImagePicker.requestMediaLibraryPermissionsAsync()
      : await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      // Said rather than silently doing nothing, which is what happened before.
      setNotice(
        fromLibrary
          ? tx('গ্যালারিতে ঢোকার অনুমতি দিলে ছবি বেছে নিতে পারবেন।', 'Allow gallery access to pick a photo.')
          : tx('ক্যামেরার অনুমতি দিলে ছবি তোলা যাবে।', 'Allow the camera to take a photo.')
      );
      return;
    }
    const result = fromLibrary
      ? await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.72 })
      : await ImagePicker.launchCameraAsync({ quality: 0.72 });
    if (!result.canceled && result.assets?.[0]?.uri) setPhoto(result.assets[0].uri);
  }

  function ask(question: string, id: string) {
    if (!photo || sending) return;
    setSending(id);
    void askPhoto(photo, question);
    setScreen('shathiApa');
  }

  /* --- nothing taken yet ------------------------------------------------- */

  if (!photo) {
    return (
      <View style={apa.camScreen}>
        <View style={apa.camHead}>
          <PressableScale
            onPress={() => setScreen('shathiApa')}
            style={apa.camClose}
            accessibilityLabel={tx('বন্ধ করুন', 'Close')}
          >
            <Ionicons name="close" size={22} color={colors.maroon} />
          </PressableScale>
          <Text style={apa.camTitle}>{tx('ছবি তুলুন', 'Take a photo')}</Text>
        </View>

        {/* Framing help in plain words. A diagram would need reading. */}
        <View style={apa.camFrame}>
          <Ionicons name="scan-outline" size={64} color={colors.line} />
          <Text style={apa.camGuide}>
            {tx('গাছের পাতা বা পশুর যে জায়গায় সমস্যা, সেটা ছবিতে আসুক', 'Get the affected leaf or the animal in the frame')}
          </Text>
          <Text style={apa.camGuideSub}>
            {tx('আলো ভালো থাকলে আর কাছ থেকে তুললে আমি ভালো বুঝতে পারব।', 'Good light and a close shot help me see it properly.')}
          </Text>
        </View>

        {notice ? (
          <View style={apa.camNotice}>
            <Ionicons name="information-circle-outline" size={18} color="#8A5A06" />
            <Text style={apa.camNoticeText}>{notice}</Text>
          </View>
        ) : null}

        <View style={apa.camBar}>
          <PressableScale
            style={apa.camSide}
            onPress={() => void shoot(true)}
            accessibilityLabel={tx('গ্যালারি', 'Gallery')}
          >
            <Ionicons name="images-outline" size={24} color={colors.maroon} />
          </PressableScale>
          <PressableScale
            style={apa.camShutter}
            onPress={() => void shoot(false)}
            accessibilityLabel={tx('ছবি তুলুন', 'Take a photo')}
            scaleTo={0.92}
          >
            <View style={apa.camShutterInner} />
          </PressableScale>
          <View style={apa.camSide} />
        </View>
      </View>
    );
  }

  /* --- taken: pick a question -------------------------------------------- */

  return (
    <View style={apa.camScreen}>
      <View style={apa.camHead}>
        <PressableScale
          onPress={() => setScreen('shathiApa')}
          style={apa.camClose}
          accessibilityLabel={tx('বন্ধ করুন', 'Close')}
        >
          <Ionicons name="close" size={22} color={colors.maroon} />
        </PressableScale>
        <Text style={apa.camTitle}>{tx('কী জানতে চান?', 'What do you want to know?')}</Text>
      </View>

      <ScrollView contentContainerStyle={apa.camAsk} keyboardShouldPersistTaps="handled">
        <Image source={{ uri: photo }} style={apa.camThumb} />

        {/* One tap each. She has just photographed something that worries her;
            composing a sentence is not the next thing to ask of her. */}
        <View style={apa.camChips}>
          {PHOTO_QUESTIONS.map((q) => (
            <PressableScale
              key={q.id}
              style={[apa.camChip, sending === q.id && apa.camChipBusy]}
              disabled={Boolean(sending)}
              onPress={() => ask(lang === 'bn' ? q.ask_bn : q.ask_en, q.id)}
              accessibilityLabel={lang === 'bn' ? q.bn : q.en}
            >
              {sending === q.id ? (
                <ActivityIndicator size="small" color={colors.maroon} />
              ) : (
                <Ionicons name={q.icon} size={18} color={colors.maroon} />
              )}
              <Text style={apa.camChipText}>{lang === 'bn' ? q.bn : q.en}</Text>
            </PressableScale>
          ))}
        </View>

        <PressableScale
          style={[apa.camPrimary, sending === 'overall' && apa.camChipBusy]}
          disabled={Boolean(sending)}
          onPress={() =>
            ask(
              lang === 'bn'
                ? 'ছবিটা সব মিলিয়ে দেখে যা যা বোঝা যায় বলুন — কী সমস্যা, কেন, আর এখন কী করব।'
                : 'Look at this photo overall and tell me what you can — the problem, why, and what to do now.',
              'overall'
            )
          }
          accessibilityLabel={tx('সব মিলিয়ে দেখে বলুন', 'Show Shathi Apa for overall analysis')}
        >
          {sending === 'overall' ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="sparkles" size={18} color="#fff" />
          )}
          <Text style={apa.camPrimaryText}>
            {tx('সব মিলিয়ে দেখে বলুন', 'Show Shathi Apa for overall analysis')}
          </Text>
        </PressableScale>

        <PressableScale
          style={apa.camSecondary}
          disabled={Boolean(sending)}
          onPress={() => { setPhoto(null); setNotice(''); }}
          accessibilityLabel={tx('আবার তুলুন', 'Retake')}
        >
          <Ionicons name="camera-reverse-outline" size={18} color={colors.maroon} />
          <Text style={apa.camSecondaryText}>{tx('আবার তুলুন', 'Retake')}</Text>
        </PressableScale>

        <Text style={apa.camFoot}>
          {tx(
            'ফসল বা পশুর ছবি না হলে শাথী আপা জানিয়ে দেবে — কিছু ভাঙবে না।',
            'If it is not a crop or an animal, Shathi Apa will say so — nothing breaks.'
          )}
        </Text>
      </ScrollView>
    </View>
  );
}

/* ===========================================================================
   Settings
   =========================================================================== */

export function ApaSettingsScreen({ setScreen }: { setScreen: (screen: Screen) => void }) {
  const { tx, lang } = useLanguage();
  const { clear, reload } = useApa();
  const [settings, setSettings] = useState<ApaUserSettings | null>(null);
  const [live, setLive] = useState<ApaEntitlement['live'] | null>(null);
  const [renews, setRenews] = useState('');
  const [busy, setBusy] = useState(false);
  const [voice, setVoice] = useState<{ ok: boolean; name: string | null }>({ ok: true, name: null });
  const [held, setHeld] = useState<{ files: number; bytes: number }>({ files: 0, bytes: 0 });

  useEffect(() => {
    let alive = true;
    void speechAvailability()
      .then((state) => { if (alive) setVoice({ ok: state.ok, name: state.voice ?? deviceVoiceName() }); })
      .catch(() => undefined);
    void audioCacheStats()
      .then((next) => { if (alive) setHeld(next); })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    getApaSettings()
      .then((data) => {
        if (!alive) return;
        setSettings(data.settings);
        setLive(data.live);
        setRenews(data.renews_on);
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, []);

  async function patch(next: Partial<ApaUserSettings>) {
    if (!settings || busy) return;
    setSettings({ ...settings, ...next });
    setBusy(true);
    try {
      setSettings(await saveApaSettings(next));
    } catch {
      /* the next read corrects it */
    } finally {
      setBusy(false);
    }
  }

  async function wipe() {
    setBusy(true);
    try {
      await clearApaHistory();
      clear();
      reload();
    } finally {
      setBusy(false);
    }
  }

  const usedPct = live && live.minutes_monthly
    ? Math.round((live.seconds_used / (live.minutes_monthly * 60)) * 100)
    : 0;

  return (
    <>
      <Header title={tx('শাথী আপার সেটিংস', 'Shathi Apa settings')} onBack={() => setScreen('shathiApa')} />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        {/* Quota first, as a maroon hero — what is left, before any switch. */}
        {live ? (
          <View style={apa.quotaHero}>
            <Text style={apa.quotaEyebrow}>{tx('এ মাসের লাইভ কথা', 'Live minutes this month')}</Text>
            <Text style={apa.quotaValue}>
              {lang === 'bn'
                ? `${bn(Math.floor(live.seconds_left / 60))} মিনিট বাকি`
                : `${Math.floor(live.seconds_left / 60)} min left`}
            </Text>
            <View style={apa.quotaTrack}>
              <View style={[apa.quotaFill, { width: `${Math.min(100, usedPct)}%` }]} />
            </View>
            <Text style={apa.quotaFoot}>
              {lang === 'bn'
                ? `মোট ${bn(live.minutes_monthly)} মিনিট · ${renews} তারিখে নতুন হবে`
                : `${live.minutes_monthly} minutes a month · renews ${renews}`}
            </Text>
          </View>
        ) : null}

        {settings ? (
          <>
            <View style={apa.group}>
              <Text style={apa.groupTitle}>{tx('কথা বলা ও শোনা', 'Speaking and listening')}</Text>
              <SettingRow
                icon="🔊"
                title={tx('উত্তর পড়ে শোনানো', 'Read answers aloud')}
                detail={tx('ভয়েসে প্রশ্ন করলে নিজে থেকেই পড়ে শোনাবে', 'Plays on its own when you ask by voice')}
                right={<Toggle on={settings.read_aloud} onPress={() => void patch({ read_aloud: !settings.read_aloud })} />}
              />
              {/* Which engine reads is a platform setting, so this row
                  reports rather than offers — and it says what she can do
                  about the one case that leaves her with no voice at all. */}
              <SettingRow
                icon="🗣"
                title={tx('যে কণ্ঠে পড়ে শোনাবে', 'Voice used for reading')}
                detail={
                  speechMode() === 'device'
                    ? voice.ok
                      ? tx('আপনার ফোনের নিজের কণ্ঠ — ইন্টারনেট ছাড়াও চলবে', "Your phone's own voice — works without internet")
                      : tx('এই ফোনে বাংলা কণ্ঠ নেই', 'No Bangla voice on this phone')
                    : voice.ok
                      ? tx('শাথী আপার নিজের কণ্ঠ · একবার শুনলে ফোনেই জমা থাকবে', "Shathi Apa's own voice · kept on your phone after the first listen")
                      : tx('শাথী আপার নিজের কণ্ঠ · ইন্টারনেট লাগবে', "Shathi Apa's own voice · needs internet")
                }
                right={
                  speechMode() === 'device' && !voice.ok ? (
                    <Pressable onPress={() => Linking.openSettings()}>
                      <Text style={apa.rowValue}>{tx('নামান', 'Install')}</Text>
                    </Pressable>
                  ) : (
                    <Text style={apa.rowValue} numberOfLines={1}>
                      {speechMode() === 'device'
                        ? voice.name ?? tx('আছে', 'Ready')
                        : tx('শাথী আপা', 'Shathi Apa')}
                    </Text>
                  )
                }
              />
              <SettingRow
                icon="🐢"
                title={tx('পড়ার গতি', 'Reading pace')}
                detail={tx('ধীরে চললে বুঝতে সুবিধা হয়', 'Slower is easier to follow')}
                right={
                  <Pressable
                    onPress={() =>
                      void patch({ speech_rate: settings.speech_rate === 'slow' ? 'normal' : settings.speech_rate === 'normal' ? 'fast' : 'slow' })
                    }
                  >
                    <Text style={apa.rowValue}>
                      {settings.speech_rate === 'slow' ? tx('ধীরে', 'Slow') : settings.speech_rate === 'fast' ? tx('দ্রুত', 'Fast') : tx('স্বাভাবিক', 'Normal')}
                    </Text>
                  </Pressable>
                }
              />
              <SettingRow
                icon="🗣"
                title={tx('ভাষা', 'Language')}
                detail={tx('শাথী আপা যে ভাষায় কথা বলবে', 'The language she answers in')}
                right={
                  <Pressable onPress={() => void patch({ language: settings.language === 'bn' ? 'en' : 'bn' })}>
                    <Text style={apa.rowValue}>{settings.language === 'bn' ? 'বাংলা' : 'English'}</Text>
                  </Pressable>
                }
              />
            </View>

            <View style={apa.group}>
              <Text style={apa.groupTitle}>{tx('ডেটা ও খরচ', 'Data and cost')}</Text>
              <SettingRow
                icon="📶"
                title={tx('লাইভ কথার আগে সতর্কতা', 'Warn me before a live call')}
                detail={tx('প্রতিবার ডেটা খরচ দেখাবে', 'Shows the data cost every time')}
                // Cannot be permanently dismissed, only acknowledged — spending
                // someone else's data without saying so is not a setting.
                right={<Toggle on amber onPress={() => undefined} />}
              />
              {/* The whole reason server speech is affordable: a clip is
                  downloaded once and then played from the phone. She should be
                  able to see that, and to reclaim the space. */}
              <SettingRow
                icon="🎧"
                title={tx('জমা রাখা কথা', 'Saved audio')}
                detail={
                  held.files
                    ? lang === 'bn'
                      ? `${bn(held.files)}টি উত্তর ফোনে জমা আছে · ইন্টারনেট ছাড়াই শোনা যাবে`
                      : `${held.files} answers saved · playable with no internet`
                    : tx('এখনো কিছু জমা হয়নি', 'Nothing saved yet')
                }
                right={
                  held.files ? (
                    <Pressable
                      onPress={() => {
                        void clearAudioCache().then(() => setHeld({ files: 0, bytes: 0 }));
                      }}
                    >
                      <Text style={apa.rowValue}>
                        {lang === 'bn'
                          ? `${bn(Math.round(held.bytes / 1048576))} MB · মুছুন`
                          : `${Math.round(held.bytes / 1048576)} MB · Clear`}
                      </Text>
                    </Pressable>
                  ) : (
                    <Text style={apa.rowValue}>—</Text>
                  )
                }
              />
              <SettingRow
                icon="📡"
                title={tx('লাইভ কথায় ওয়াই-ফাই পছন্দ', 'Prefer Wi-Fi for live')}
                // Deliberately not a lock. On mobile data she is asked once,
                // for that call, and can go ahead — see the consent prompt on
                // the live screen.
                detail={tx('মোবাইল ডেটায় আগে জিজ্ঞাসা করবে, বন্ধ করবে না', 'Asks first on mobile data — does not block you')}
                right={<Toggle on={settings.wifi_only_live} onPress={() => void patch({ wifi_only_live: !settings.wifi_only_live })} />}
              />
            </View>

            <View style={apa.group}>
              <Text style={apa.groupTitle}>{tx('অনুমতি ও তথ্য', 'Permissions and data')}</Text>
              <SettingRow
                icon="🎙"
                title={tx('মাইক ব্যবহারের অনুমতি', 'Microphone permission')}
                detail={tx('ভয়েস মেসেজ পাঠাতে লাগে', 'Needed to send a voice message')}
                right={
                  <Pressable onPress={() => Linking.openSettings()}>
                    <Text style={apa.rowValue}>{tx('দেখুন', 'Open')}</Text>
                  </Pressable>
                }
              />
              <SettingRow
                icon="🗑"
                title={tx('আলাপের রেকর্ড মুছুন', 'Delete my conversations')}
                detail={tx('সব ভয়েস ও লেখা মুছে যাবে', 'Every voice message and answer')}
                right={
                  <Pressable onPress={() => void wipe()} disabled={busy}>
                    <Text style={[apa.rowValue, apa.rowValueDanger]}>{tx('মুছুন', 'Delete')}</Text>
                  </Pressable>
                }
              />
            </View>
          </>
        ) : (
          <Text style={[apa.hint, { marginTop: 24 }]}>{tx('আনা হচ্ছে…', 'Loading…')}</Text>
        )}
      </ScrollView>
    </>
  );
}

function SettingRow({
  icon, title, detail, right,
}: {
  icon: string;
  title: string;
  detail: string;
  right: React.ReactNode;
}) {
  return (
    <View style={apa.row}>
      <View style={apa.rowIcon}><Text style={apa.rowIconText}>{icon}</Text></View>
      <View style={apa.rowBody}>
        <Text style={apa.rowTitle}>{title}</Text>
        <Text style={apa.rowDetail}>{detail}</Text>
      </View>
      {right}
    </View>
  );
}

function Toggle({ on, amber, onPress }: { on: boolean; amber?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={[apa.toggle, on && (amber ? apa.toggleOnAmber : apa.toggleOn), on && { alignItems: 'flex-end' }]}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
    >
      <View style={apa.toggleKnob} />
    </Pressable>
  );
}
