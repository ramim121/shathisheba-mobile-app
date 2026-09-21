/**
 * The playbar's decisions, as pure functions.
 *
 * SPEC.md §4 (the derived view per phase) and §7 (the event contract) are a
 * table and three handlers — exactly the kind of thing that is easy to get
 * subtly wrong inside a component and impossible to notice until a farmer
 * sees a grey button twice. Out here they have no imports, so
 * `ShathiShebaAdmin/scripts/test-apa.mjs` lifts this file by source and checks
 * it against the spec's own tables.
 */

export type SpeechPhase = 'idle' | 'loading' | 'playing' | 'paused';
export type PlaybarView = 'cold' | 'loading' | 'playing' | 'paused' | 'ended';

/**
 * §4: which of the six states to draw.
 *
 * `loaded` is the latch from §1 — true once this clip has resolved, and never
 * false again. `bookmarked` means the clip was interrupted rather than
 * finished (§8: "paused, not finished — their positions survive").
 */
export function playbarView(o: {
  speech: SpeechPhase;
  loaded: boolean;
  bookmarked: boolean;
}): PlaybarView {
  if (o.speech === 'loading') {
    // §8 "Load never repeats": a clip already loaded this session goes
    // straight to playing — the grey state is never shown twice.
    return o.loaded ? 'playing' : 'loading';
  }
  if (o.speech === 'playing') return 'playing';
  if (o.speech === 'paused' || o.bookmarked) return 'paused';
  return o.loaded ? 'ended' : 'cold';
}

/** §7: `m:ss`, rounded up, so 0.4s left reads 0:01 and 0:00 never comes early. */
export function playbarClock(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * §7 readout. Not loaded → 0:00, because the duration is not known and is
 * deliberately not guessed. Loaded, at the start and not playing → the full
 * length. Otherwise the time *remaining*, counting down.
 */
export function playbarReadout(o: {
  view: PlaybarView;
  loaded: boolean;
  failed: boolean;
  duration: number;
  progress: number;
  /** Where her finger is during a drag, if it is down. */
  drag?: number | null;
}): string {
  if (o.failed) return '--:--';
  if (!o.loaded) return '0:00';
  if (o.drag !== null && o.drag !== undefined && o.duration > 0) {
    return playbarClock(o.duration * (1 - o.drag));
  }
  if (o.view === 'ended' || (o.progress === 0 && o.view !== 'playing')) {
    return playbarClock(o.duration);
  }
  return playbarClock(o.duration * (1 - o.progress));
}

export type PlayAction = 'ignore' | 'load' | 'pause' | 'resume' | 'resume-bookmark' | 'replay';

/** §7 tapPlay. */
export function tapPlay(o: {
  view: PlaybarView;
  speech: SpeechPhase;
  bookmarked: boolean;
}): PlayAction {
  if (o.view === 'loading') return 'ignore';          // the button is inert
  if (o.speech === 'playing') return 'pause';          // keep progress
  if (o.speech === 'paused') return 'resume';
  if (o.bookmarked) return 'resume-bookmark';          // interrupted: from where it was
  if (o.view === 'cold') return 'load';
  return 'replay';                                     // ended, or loaded and idle
}

export type SeekAction = 'queue' | 'seek' | 'load-from';

/**
 * §7 tapWaveform. "Seek only means play" — every outcome ends in audible
 * playback from the tapped point, from every phase, including finished.
 */
export function tapWaveform(o: { view: PlaybarView; speech: SpeechPhase }): SeekAction {
  // During loading the point is remembered and applied when it resolves.
  if (o.view === 'loading') return 'queue';
  // A live clip seeks in place (and a paused one resumes).
  if (o.speech === 'playing' || o.speech === 'paused') return 'seek';
  // Cold, finished or bookmarked: start it, from here.
  return 'load-from';
}

/** §7: `clamp((x − left) / width, 0, 0.995)`. */
export function seekRatio(x: number, width: number): number {
  if (!(width > 0)) return 0;
  return Math.min(0.995, Math.max(0, x / width));
}
