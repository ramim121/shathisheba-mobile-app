import { StyleSheet } from 'react-native';
import { colors } from '../theme/colors';

// Shathi Apa's own stylesheet.
//
// The sizes here are the redlines from the design, not guesses: the mic is
// 72dp and grows to 92 while recording, the camera and keyboard beside it are
// 56 because both are floor-sized targets and neither should outrank the other,
// the live-call pill is 44 high with a 22 radius, and the orb is a 200dp halo
// around a 128dp core. Anything a farmer has to hit clears 48dp.
//
// Two colours are not in the brand palette on purpose. `recording` is the app's
// green because a farmer needs to see at a glance that the phone is listening,
// and `endFill` is a muted brick rather than a pure red — hanging up is not an
// error, and the design is explicit that it must never look like one.

export const APA_GREEN = colors.green;
export const APA_END = '#B4443C';
export const APA_AMBER = colors.gold;

/**
 * One tile, for every control in the composer.
 *
 * Four equal squircles is the whole design of that panel: the emphasis comes
 * from which one is filled, never from which one is bigger.
 */
const TILE = 54;

export const apa = StyleSheet.create({
  /* --- chat screen ------------------------------------------------------- */

  head: {
    flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56,
    paddingHorizontal: 12, backgroundColor: colors.card,
    borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  headBack: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.rose },
  headBackText: { color: colors.maroon, fontSize: 24, lineHeight: 26, marginTop: -3 },
  headMark: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  headTitles: { flex: 1, minWidth: 0 },
  headTitle: { color: colors.ink, fontSize: 16.5, fontWeight: '800' },
  headSub: { color: colors.muted, fontSize: 11.5, marginTop: 1 },
  headPill: {
    paddingHorizontal: 10, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.cream,
  },
  headPillText: { fontSize: 11.5, fontWeight: '700', color: colors.muted },
  headPillTrial: { backgroundColor: colors.greenPale, borderColor: '#B7EBC8' },
  headPillTrialText: { color: '#15803D' },
  headPillSpent: { backgroundColor: colors.rose, borderColor: colors.line },
  headPillSpentText: { color: colors.maroon },
  headKebab: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  headKebabText: { color: colors.muted, fontSize: 20 },

  // Bottom padding clears the composer above the nav bar. Ten was not
  // enough and the last suggestion chip sat behind the panel.
  // The chat owns the full height: header on top, thread below it scrolling.
  screen: { flex: 1, backgroundColor: colors.cream },
  threadScroll: { flex: 1 },
  thread: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 28, gap: 12 },

  turnUser: {
    alignSelf: 'flex-end', maxWidth: '86%', backgroundColor: colors.maroon,
    borderRadius: 16, borderBottomRightRadius: 6, paddingHorizontal: 14, paddingVertical: 11, gap: 7,
  },
  turnUserText: { color: '#fff', fontSize: 15.5, lineHeight: 22, fontWeight: '600' },
  turnUserNote: { color: 'rgba(255,255,255,0.72)', fontSize: 11.5, lineHeight: 16 },

  turnApa: {
    alignSelf: 'flex-start', maxWidth: '92%', backgroundColor: colors.card,
    borderRadius: 16, borderBottomLeftRadius: 6, borderWidth: 1, borderColor: colors.line,
    paddingHorizontal: 14, paddingVertical: 12, gap: 10,
  },
  turnApaRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  turnApaMark: { width: 26, height: 26, marginBottom: 2 },
  turnText: { color: colors.ink, fontSize: 15.5, lineHeight: 23 },
  turnStrong: { fontWeight: '800' },

  // The action, lifted out of the paragraph. A farmer standing in a field reads
  // this line and nothing else.
  advice: { borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, gap: 4, backgroundColor: colors.rose },
  adviceTitle: { color: colors.maroon, fontSize: 11, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase' },
  adviceText: { color: colors.ink, fontSize: 15, lineHeight: 22, fontWeight: '600' },

  caution: {
    flexDirection: 'row', gap: 8, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10,
    backgroundColor: '#FEF6E7', borderWidth: 1, borderColor: '#F6DFAE',
  },
  cautionIcon: { fontSize: 13, marginTop: 1 },
  cautionText: { flex: 1, color: '#8A5A08', fontSize: 13, lineHeight: 19 },

  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
  source: {
    flexDirection: 'row', alignItems: 'center', gap: 4, height: 26, paddingHorizontal: 10,
    borderRadius: 13, backgroundColor: colors.rose,
  },
  sourceText: { color: colors.maroon, fontSize: 11.5, fontWeight: '700' },
  /* Outline, never filled, so a suggestion never competes with a source chip.

     A row, not a bare box: each pill now carries a small maroon arrow before
     its text. The pills and the source chips were the same shape at the same
     size one under the other, and a tag you cannot press looks exactly like a
     question you can. The arrow says "this one goes somewhere". */
  suggest: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    minHeight: 36, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 18,
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card,
  },
  suggestPressed: { backgroundColor: colors.rose, borderColor: colors.muted },
  suggestLarge: { minHeight: 42, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 21 },
  suggestText: { color: colors.maroon, fontSize: 13.5, fontWeight: '600', flexShrink: 1 },

  starterLabel: { color: colors.muted, fontSize: 12, marginHorizontal: 16, marginBottom: 6, marginTop: 2 },

  // Speaker: bottom-left of the bubble, always in the same place, because this
  // is the control a farmer who cannot read uses most.
  speaker: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  speakerBtn: {
    width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.maroon,
  },
  speakerBtnIdle: { backgroundColor: colors.rose },
  speakerIcon: { color: '#fff', fontSize: 13 },
  speakerIconIdle: { color: colors.maroon, fontSize: 13 },
  speakerTrack: { flex: 1, height: 3, borderRadius: 2, backgroundColor: colors.line, overflow: 'hidden' },
  speakerFill: { height: 3, backgroundColor: colors.maroon },
  speakerHint: { color: colors.muted, fontSize: 11 },

  /* --- the answer's footer ------------------------------------------------
     Everything under an answer used to be one flat run of rows inside the
     bubble: the advice, the caution, the source chips, the player, the two
     thumbs, a label, the suggestion pills and the officer strip, all the same
     distance apart and all the same weight. Nine things in a column with no
     grouping reads as a list of nine equally important things, which is why
     the play button — the control a farmer who cannot read uses most — was
     the hardest one to find.

     A hairline separates what Apa said from what she can do about it. Below
     the rule everything is a control; above it everything is content. */
  answerFoot: { marginTop: 12, borderTopWidth: 1, borderTopColor: colors.line },
  // The label on the left, the two thumbs on the right: one balanced line
  // instead of two half-empty ones.
  footRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: 10, minHeight: 28,
  },
  footLabel: { color: colors.muted, fontSize: 11.5, fontWeight: '700' },

  // Her own clip, at rest inside her bubble.
  clip: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  clipBars: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 18, flex: 1 },
  clipBar: { width: 2, borderRadius: 1, backgroundColor: 'rgba(255,255,255,0.85)' },
  clipTime: { color: 'rgba(255,255,255,0.85)', fontSize: 11.5, fontWeight: '700', fontVariant: ['tabular-nums'] },

  status: {
    alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7,
    paddingHorizontal: 12, height: 34, borderRadius: 17, backgroundColor: colors.rose,
  },
  statusText: { color: colors.maroon, fontSize: 13, fontWeight: '700' },

  officer: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginTop: 2,
    padding: 10, borderRadius: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card,
  },
  officerAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.rose, alignItems: 'center', justifyContent: 'center' },
  officerAvatarText: { color: colors.maroon, fontSize: 15, fontWeight: '800' },
  officerBody: { flex: 1, minWidth: 0 },
  officerEyebrow: { color: colors.muted, fontSize: 10.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  officerName: { color: colors.ink, fontSize: 14.5, fontWeight: '700' },
  officerArea: { color: colors.muted, fontSize: 12 },
  officerCall: {
    flexDirection: 'row', alignItems: 'center', gap: 6, height: 38, paddingHorizontal: 14,
    borderRadius: 12, backgroundColor: APA_GREEN,
  },
  officerCallText: { color: '#fff', fontSize: 13.5, fontWeight: '800' },

  // The soft wall. Warm rose, never red, and the secondary action still gives
  // her something — the answers she already has.
  wall: {
    marginHorizontal: 16, marginTop: 6, padding: 16, borderRadius: 18,
    backgroundColor: colors.rose, borderWidth: 1, borderColor: '#EBD3DE', gap: 10,
  },
  wallTitle: { color: colors.maroon, fontSize: 16.5, fontWeight: '800' },
  wallBody: { color: colors.ink, fontSize: 14, lineHeight: 21 },

  notice: {
    marginHorizontal: 16, marginTop: 6, padding: 13, borderRadius: 14, gap: 4,
    backgroundColor: '#FEF6E7', borderWidth: 1, borderColor: '#F6DFAE',
  },
  noticeText: { color: '#8A5A08', fontSize: 13.5, lineHeight: 20 },

  /* --- composer ---------------------------------------------------------- */

  // Was two stacked rows — a full-width live pill above the tools — which made
  // this panel about 180px tall and 200px while recording, pushing the answer
  // it belongs under off the screen. One row of four now, about 96px.
  /* A card that floats, not a strip ruled off with a hairline.
     Every other surface in this app that sits over content — the bottom
     sheet, the answer bubbles, the buy panel — is a rounded raised plane, and
     this was the one square one. It sits inside the shell's own 16px gutter,
     so all four corners are on cream and all four are rounded. */
  composer: {
    paddingHorizontal: 12, paddingTop: 12, paddingBottom: 12, gap: 6,
    backgroundColor: colors.card, borderRadius: 30,
    shadowColor: '#2B0B1E', shadowOpacity: 0.08, shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },

  /* Four equal tiles.
     The microphone used to be a 60px circle among three 46px squares, which
     made it the odd one out twice over — bigger *and* a different shape — and
     nothing on the row lined up, because the taller slot pushed its own
     caption below the other three. It is the same tile as its neighbours now
     and says "this is the main one" by being filled rather than by being
     larger. It still grows, but only under a finger, and by a transform that
     the layout does not see. */
  tools: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  toolSlot: { alignItems: 'center', justifyContent: 'center', gap: 6, flex: 1 },
  toolBtn: {
    width: TILE, height: TILE, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.rose,
  },
  toolBtnActive: { backgroundColor: colors.maroon },
  // Throwing the recording away. Tinted rather than filled red: it sits beside
  // the microphone she is talking into, and a solid red button next to it
  // reads as the thing to press.
  toolBtnDanger: { backgroundColor: '#FDECEC' },
  toolBtnOff: { backgroundColor: '#F4EEF1' },
  toolLabel: { color: colors.maroon, fontSize: 10.5, fontWeight: '700' },
  // The live minutes left, on the button rather than in a sentence beside it.
  toolBadge: {
    position: 'absolute', top: -3, right: -5, minWidth: 17, height: 17, borderRadius: 9,
    paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center',
    backgroundColor: APA_GREEN, borderWidth: 1.5, borderColor: colors.card,
  },
  toolBadgeText: { color: '#fff', fontSize: 9.5, fontWeight: '800' },

  // The mic keeps its footprint while recording. It used to grow 72 -> 92,
  // which re-laid out the whole row under the farmer's finger.
  micSlot: { alignItems: 'center', justifyContent: 'center', gap: 6, flex: 1 },
  micWrap: { width: TILE, height: TILE, alignItems: 'center', justifyContent: 'center' },
  mic: {
    width: TILE, height: TILE, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.maroon,
  },
  micRing: { position: 'absolute', width: TILE, height: TILE, borderRadius: 18, backgroundColor: APA_GREEN },
  micRecording: { backgroundColor: APA_GREEN },
  micLocked: { backgroundColor: APA_GREEN },
  micOff: { backgroundColor: '#B9A3AE' },
  micIcon: { fontSize: 26 },
  micBadge: {
    position: 'absolute', right: -3, bottom: -3, width: 20, height: 20, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.line,
  },
  micBadgeText: { fontSize: 11 },
  // Nine bars at 3px with a 2px gap is 43px across, which fits the 54px tile
  // with a margin either side. Four-wide bars needed 52 and touched the edges.
  micBars: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 22 },
  micBar: { width: 3, borderRadius: 2, backgroundColor: '#fff' },

  hint: { color: colors.muted, fontSize: 12, textAlign: 'center' },
  hintCancel: { color: APA_END, fontWeight: '700' },
  hintLive: { color: APA_GREEN, fontWeight: '700' },

  input: {
    minHeight: 46, maxHeight: 120, borderRadius: 14, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.cream, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12,
    color: colors.ink, fontSize: 15.5,
  },

  /* Typing: the same two tiles, with a field between them.
     Two earlier attempts got this wrong in opposite directions. The first grew
     a third box *between* the camera and the microphone, so three things moved
     at once. The second put both controls inside the field, which fixed the
     movement but replaced the row with a control she had never seen — the tile
     language of the closed panel simply vanished the moment she tapped
     "লিখুন".

     This keeps the tiles exactly where they were, at exactly the size they
     were, and grows the field between them. Nothing changes shape; the middle
     changes width. */
  fieldRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  field: {
    flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 4,
    minHeight: TILE, borderRadius: TILE / 2,
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card,
    paddingLeft: 16, paddingRight: 6, paddingVertical: 4,
  },
  // maxHeight caps it at about four lines; past that the field would eat the
  // answer it is a reply to.
  fieldInput: {
    flex: 1, minHeight: TILE - 8, maxHeight: 108,
    paddingTop: 12, paddingBottom: 12, paddingRight: 2,
    color: colors.ink, fontSize: 15.5,
  },
  // Clears what she has typed, and closes the field when there is nothing left
  // to clear — so one control undoes the whole detour in at most two presses.
  fieldClear: {
    width: 32, height: 32, borderRadius: 16, marginBottom: 5,
    alignItems: 'center', justifyContent: 'center',
  },
  // Send takes the microphone's tile rather than appearing beside it: the
  // right-hand tile always holds the thing that happens next.
  fieldSend: {
    width: TILE, height: TILE, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.maroon,
  },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  send: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.maroon },
  sendOff: { backgroundColor: '#D8C6CF' },
  sendIcon: { color: '#fff', fontSize: 20, marginTop: -2 },

  /* --- unlock ------------------------------------------------------------ */

  sheetScrim: { flex: 1, backgroundColor: 'rgba(43,11,30,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.card, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, paddingTop: 10, paddingBottom: 24, gap: 14,
  },
  sheetGrip: { alignSelf: 'center', width: 44, height: 4, borderRadius: 2, backgroundColor: colors.line },
  sheetIcon: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.rose },
  sheetIconText: { fontSize: 22 },
  sheetTitle: { color: colors.ink, fontSize: 21, fontWeight: '800' },
  sheetBody: { color: colors.muted, fontSize: 14.5, lineHeight: 21 },
  sheetFoot: { color: colors.muted, fontSize: 12, textAlign: 'center' },

  gain: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 14,
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card,
  },
  gainIcon: { width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.rose },
  gainIconText: { fontSize: 17 },
  gainBody: { flex: 1, minWidth: 0 },
  gainTitle: { color: colors.ink, fontSize: 14.5, fontWeight: '700' },
  gainDetail: { color: colors.muted, fontSize: 12.5, marginTop: 1, lineHeight: 17 },
  gainTick: { color: APA_GREEN, fontSize: 16, fontWeight: '800' },
  gainTodo: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: colors.line },

  progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.line, overflow: 'hidden' },
  progressFill: { height: 6, borderRadius: 3, backgroundColor: colors.gold },
  progressText: { color: colors.muted, fontSize: 12, fontWeight: '600' },

  /* --- live conversation ------------------------------------------------- */

  liveScreen: { flex: 1, backgroundColor: colors.cream },
  liveHead: {
    flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingHorizontal: 12,
    backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  liveHeadTitle: { flex: 1, color: colors.ink, fontSize: 16, fontWeight: '800' },
  liveHeadSub: { color: colors.muted, fontSize: 11.5, marginTop: 1 },
  liveHeadQuota: {
    paddingHorizontal: 10, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.goldPale,
  },
  liveHeadQuotaText: { color: '#8A5A08', fontSize: 11.5, fontWeight: '800' },

  liveStage: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 24, paddingHorizontal: 28 },
  orbHalo: { width: 200, height: 200, borderRadius: 100, alignItems: 'center', justifyContent: 'center' },
  orbCore: { width: 128, height: 128, borderRadius: 64, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card },
  orbRing: { position: 'absolute', width: 200, height: 200, borderRadius: 100, borderWidth: 2, borderStyle: 'dashed' },
  orbDots: { flexDirection: 'row', gap: 6 },
  orbDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#C8B4BE' },
  orbBars: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 54 },
  orbBar: { width: 6, borderRadius: 3 },
  orbGlyph: { fontSize: 34 },

  liveLabel: { color: colors.ink, fontSize: 18, fontWeight: '800', textAlign: 'center' },
  liveSecondary: { color: colors.muted, fontSize: 13.5, lineHeight: 20, textAlign: 'center', marginTop: 6 },

  strip: {
    alignSelf: 'stretch', minHeight: 58, borderRadius: 14, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.card, paddingHorizontal: 12, paddingVertical: 10, gap: 4,
  },
  stripWho: { color: colors.muted, fontSize: 10.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.4 },
  stripLine: { color: colors.ink, fontSize: 13.5, lineHeight: 19 },

  liveControls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 32, paddingBottom: 40, paddingTop: 8 },
  liveSide: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.rose },
  liveSideOn: { backgroundColor: '#E7D2DA' },
  liveSideIcon: { fontSize: 20 },
  liveMain: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.maroon },
  liveEnd: { backgroundColor: APA_END },
  liveMainIcon: { color: '#fff', fontSize: 26 },

  /* --- settings ---------------------------------------------------------- */

  quotaHero: {
    margin: 16, padding: 16, borderRadius: 18, backgroundColor: colors.maroon, gap: 8,
  },
  quotaEyebrow: { color: 'rgba(255,255,255,0.7)', fontSize: 11.5, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
  quotaValue: { color: '#fff', fontSize: 27, fontWeight: '800' },
  quotaTrack: { height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.22)', overflow: 'hidden' },
  quotaFill: { height: 6, borderRadius: 3, backgroundColor: colors.goldPale },
  quotaFoot: { color: 'rgba(255,255,255,0.72)', fontSize: 12 },

  group: { marginTop: 6, gap: 1 },
  groupTitle: { color: colors.muted, fontSize: 12, fontWeight: '700', marginHorizontal: 16, marginBottom: 7, textTransform: 'uppercase', letterSpacing: 0.4 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 13,
    backgroundColor: colors.card, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.line,
  },
  rowIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.rose },
  rowIconText: { fontSize: 16 },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { color: colors.ink, fontSize: 14.5, fontWeight: '700' },
  rowDetail: { color: colors.muted, fontSize: 12.5, marginTop: 1, lineHeight: 17 },
  rowValue: { color: colors.maroon, fontSize: 13.5, fontWeight: '700' },
  rowValueDanger: { color: APA_END },

  toggle: { width: 46, height: 28, borderRadius: 14, padding: 3, backgroundColor: '#DCCDD4' },
  toggleOn: { backgroundColor: APA_GREEN },
  toggleOnAmber: { backgroundColor: colors.gold },
  toggleKnob: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff' },

  /* --- camera ------------------------------------------------------------ */

  camScreen: { flex: 1, backgroundColor: colors.cream },
  camHead: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  camClose: {
    width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.rose,
  },
  camCloseText: { color: '#fff', fontSize: 17 },
  camTitle: { flex: 1, color: colors.ink, fontSize: 16.5, fontWeight: '800' },
  camFrame: {
    flex: 1, margin: 24, borderRadius: 18, borderWidth: 2, borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.35)', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 20,
  },
  camGlyph: { fontSize: 44 },
  camGuide: { color: colors.ink, fontSize: 14.5, fontWeight: '700', textAlign: 'center' },
  camGuideSub: { color: colors.muted, fontSize: 12.5, textAlign: 'center', lineHeight: 18 },
  camTipPill: {
    alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, height: 34,
    paddingHorizontal: 14, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.14)',
  },
  camTipText: { color: '#fff', fontSize: 12.5, fontWeight: '600' },
  camBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 28, paddingTop: 16, paddingBottom: 30 },
  camSide: {
    width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.rose,
  },
  camSideIcon: { fontSize: 20 },
  // A ring around a disc, so the press animation has something to scale
  // against. It was a solid white circle, which read as a blank button.
  camShutter: {
    width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center',
    borderWidth: 4, borderColor: colors.rose,
  },
  camPreview: { flex: 1, margin: 24, borderRadius: 18, resizeMode: 'cover' },

  /* --- the photo screen, rebuilt ---------------------------------------- */
  //
  // Free text is gone: a farmer who has just photographed a sick animal is not
  // in a position to compose a prompt, and what she typed was usually two words
  // — the vaguest possible question, costing a full vision call. Five fixed
  // questions instead, one tap each.

  camAsk: { padding: 20, paddingBottom: 40, gap: 12, alignItems: 'stretch' },
  camThumb: { width: '100%', height: 220, borderRadius: 16, backgroundColor: '#000' },
  /* Compact pills, not buttons.
     Four 46px-tall full-width-ish buttons pushed the photograph she had just
     taken off the top of the screen, so she was choosing a question about an
     image she could no longer see. At 34px they wrap two to a row under the
     thumbnail and all four are visible with it. They are still 34px tall and
     ~90px wide, which is well past the 44dp-ish target once the 6px hit slop
     around a Pressable is counted. */
  camChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, justifyContent: 'center' },
  camChip: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, minHeight: 34,
    paddingHorizontal: 12, borderRadius: 17, backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.line,
  },
  camChipBusy: { opacity: 0.6, borderColor: colors.maroon },
  camChipText: { color: colors.maroon, fontSize: 12.5, fontWeight: '700' },

  camPrimary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    minHeight: 52, borderRadius: 26, backgroundColor: colors.maroon, paddingHorizontal: 18,
  },
  camPrimaryText: { color: '#fff', fontSize: 15, fontWeight: '800' },

  camSecondary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    minHeight: 50, borderRadius: 25, borderWidth: 1.5, borderColor: colors.line,
    backgroundColor: colors.card,
  },
  camSecondaryText: { color: colors.maroon, fontSize: 14.5, fontWeight: '700' },

  camFoot: { color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: 'center' },

  // A denied permission used to do nothing at all.
  camNotice: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 20,
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12,
    backgroundColor: '#FEF6E7', borderWidth: 1, borderColor: '#F6DFAE',
  },
  camNoticeText: { flex: 1, color: '#8A5A06', fontSize: 13, lineHeight: 19 },

  camShutterInner: {
    width: 54, height: 54, borderRadius: 27, backgroundColor: colors.maroon,
  },

  /* --- her own voice message -------------------------------------------- */
  turnUserPhoto: { width: 168, height: 132, borderRadius: 10 },
  // The transcript sits under the clip, slightly quieter than a typed message:
  // it is a read-back of what was heard, not something she wrote.
  turnUserTranscript: { fontSize: 14.5, fontWeight: '500', opacity: 0.95 },
  clipBarIdle: { opacity: 0.45 },

  /* --- the composer while she is typing --------------------------------- */
  // The row opens in the middle rather than growing a second row above itself.
  toolSlotCompact: { flex: 0 },
  inputInline: { flex: 1, minHeight: 46, maxHeight: 96, marginHorizontal: 8 },
  typingBack: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
    alignSelf: 'center', minHeight: 26, paddingHorizontal: 10, borderRadius: 13,
  },
  typingBackText: { color: colors.maroon, fontSize: 11.5, fontWeight: '700' },

  // Votes on their own row rather than beside the player: the waveform is
  // flex:1 and took the width, pushing both thumbs off the right edge.
  voteRow: { flexDirection: 'row', gap: 6 },
  voteBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.rose,
  },
  voteBtnOn: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
});
