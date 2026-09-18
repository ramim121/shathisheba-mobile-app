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

  thread: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10, gap: 12 },

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
  // Outline, never filled, so a suggestion never competes with a source chip.
  suggest: {
    minHeight: 34, paddingHorizontal: 12, paddingVertical: 7, borderRadius: 17,
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card,
  },
  suggestLarge: { minHeight: 42, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 21 },
  suggestText: { color: colors.maroon, fontSize: 13.5, fontWeight: '600' },

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

  composer: {
    paddingHorizontal: 24, paddingTop: 10, paddingBottom: 16, gap: 10,
    backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.line,
  },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  livePill: {
    flex: 1, height: 44, borderRadius: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 8, backgroundColor: colors.rose,
  },
  livePillLocked: { backgroundColor: colors.cream, borderWidth: 1, borderColor: colors.line },
  livePillText: { color: colors.maroon, fontSize: 14.5, fontWeight: '800' },
  livePillTextLocked: { color: colors.muted },
  liveQuota: { color: colors.muted, fontSize: 11.5, fontWeight: '600' },

  tools: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12 },
  toolBtn: { width: 56, height: 56, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.rose },
  toolBtnOff: { backgroundColor: '#F2ECEF' },
  toolIcon: { fontSize: 20 },

  mic: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.maroon },
  micRecording: { width: 92, height: 92, borderRadius: 46, backgroundColor: APA_GREEN },
  micLocked: { backgroundColor: APA_GREEN },
  micOff: { backgroundColor: '#B9A3AE' },
  micIcon: { fontSize: 26 },
  micBadge: {
    position: 'absolute', right: -2, bottom: -2, width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.line,
  },
  micBadgeText: { fontSize: 11 },
  micBars: { flexDirection: 'row', alignItems: 'center', gap: 3, height: 34 },
  micBar: { width: 4, borderRadius: 2, backgroundColor: '#fff' },

  hint: { color: colors.muted, fontSize: 12, textAlign: 'center' },
  hintCancel: { color: APA_END, fontWeight: '700' },
  hintLive: { color: APA_GREEN, fontWeight: '700' },

  input: {
    minHeight: 46, maxHeight: 120, borderRadius: 14, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.cream, paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12,
    color: colors.ink, fontSize: 15.5,
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

  camScreen: { flex: 1, backgroundColor: '#1B0E16' },
  camHead: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  camClose: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.14)' },
  camCloseText: { color: '#fff', fontSize: 17 },
  camTitle: { flex: 1, color: '#fff', fontSize: 16.5, fontWeight: '800' },
  camFrame: {
    flex: 1, margin: 24, borderRadius: 18, borderWidth: 2, borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.35)', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 20,
  },
  camGlyph: { fontSize: 44 },
  camGuide: { color: '#fff', fontSize: 14.5, fontWeight: '700', textAlign: 'center' },
  camGuideSub: { color: 'rgba(255,255,255,0.65)', fontSize: 12.5, textAlign: 'center', lineHeight: 18 },
  camTipPill: {
    alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, height: 34,
    paddingHorizontal: 14, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.14)',
  },
  camTipText: { color: '#fff', fontSize: 12.5, fontWeight: '600' },
  camBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 28, paddingTop: 16, paddingBottom: 30 },
  camSide: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.14)' },
  camSideIcon: { fontSize: 20 },
  camShutter: { width: 86, height: 86, borderRadius: 43, backgroundColor: '#fff', borderWidth: 5, borderColor: 'rgba(255,255,255,0.35)' },
  camPreview: { flex: 1, margin: 24, borderRadius: 18, resizeMode: 'cover' },
});
