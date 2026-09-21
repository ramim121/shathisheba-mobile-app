/**
 * The playbar's decisions, as pure functions.
 *
 * SPEC.md §4 (the derived view per phase) and §7 (the event contract) are a
 * table and three handlers — exactly the kind of thing that is easy to get
 * subtly wrong inside a component and impossible to notice until a farmer
 * sees a grey button twice. Out here they have no imports, so
 * `ShathiShebaAdmin/scripts/test-apa.mjs` lifts this file by source and checks
 * it against the spec's own tables.
 *
 * Two rules here are the field test's, and deliberately differ from SPEC.md:
 *
 *  - The readout counts **up** while playing — "show how many seconds it is
 *    playing" — rather than down.
 *  - The length is shown only once the answer has been heard all the way
 *    through, and is then kept (on the phone and in the database) so it shows
 *    from then on. Before that the readout rests at 0:00.
 */

export type SpeechPhase = 'idle' | 'loading' | 'playing' | 'paused';
export type PlaybarView = 'cold' | 'loading' | 'playing' | 'paused' | 'ended';

/**
 * How long a load of an already-loaded clip may take before the loading state
 * is shown for it. A clip already on the phone's disk opens in a few tens of
 * milliseconds, and flashing grey for two frames reads as a glitch; one that
 * has to be fetched again takes seconds, and showing nothing for that long
 * reads as a button that ignored the press. So: grey only if it is slow.
 */
export const SLOW_LOAD_MS = 150;

/**
 * §4: which of the six states to draw.
 *
 * `loaded` is the latch from §1. `bookmarked` means interrupted rather than
 * finished (§8). `slowLoad` is true once a load of an already-loaded clip has
 * taken longer than SLOW_LOAD_MS.
 */
export function playbarView(o: {
  speech: SpeechPhase;
  loaded: boolean;
  bookmarked: boolean;
  slowLoad?: boolean;
}): PlaybarView {
  if (o.speech === 'loading') {
    // A first load always shows the loading state. A reload shows it only if
    // it is genuinely taking time — never as a flash.
    if (!o.loaded) return 'loading';
    return o.slowLoad ? 'loading' : 'playing';
  }
  if (o.speech === 'playing') return 'playing';
  if (o.speech === 'paused' || o.bookmarked) return 'paused';
  return o.loaded ? 'ended' : 'cold';
}

/** Whole seconds as `m:ss`. `mode` decides how a fraction is treated. */
export function playbarClock(seconds: number, mode: 'floor' | 'round' = 'floor'): string {
  const whole = Math.max(0, mode === 'round' ? Math.round(seconds) : Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/**
 * The readout.
 *
 * Playing or paused: the seconds heard so far, counting up (floored, so it
 * ticks to 0:01 after one full second, not at half a second). At rest: the
 * answer's length if it has been heard in full, otherwise 0:00. During a drag:
 * the position under her finger.
 */
export function playbarReadout(o: {
  view: PlaybarView;
  failed: boolean;
  /** Seconds played so far. */
  elapsed: number;
  /** The length, once it has been heard in full; null before. */
  heardSeconds: number | null;
  /** The clip's length as far as it is known right now, for a drag. */
  duration: number;
  drag?: number | null;
}): string {
  if (o.failed) return '--:--';
  if (o.drag !== null && o.drag !== undefined && o.duration > 0) {
    return playbarClock(o.drag * o.duration);
  }
  if (o.view === 'playing' || o.view === 'paused') return playbarClock(o.elapsed);
  if (o.view === 'loading') return '0:00';
  return o.heardSeconds && o.heardSeconds > 0 ? playbarClock(o.heardSeconds, 'round') : '0:00';
}

/** Whether the readout is drawn in the loaded colour rather than the cold one. */
export function readoutIsLive(o: { view: PlaybarView; failed: boolean; heardSeconds: number | null }): boolean {
  if (o.failed) return false;
  if (o.view === 'playing' || o.view === 'paused') return true;
  if (o.view === 'loading' || o.view === 'cold') return false;
  return Boolean(o.heardSeconds && o.heardSeconds > 0);
}

/**
 * Whether a playback that just ended counts as heard in full.
 *
 * Only a clip that reached its end by itself. A pause, an interruption by
 * another answer, leaving the screen, or starting a recording all end in
 * "stopped" and must not record a length.
 */
export function heardInFull(ending: 'finished' | 'stopped' | null): boolean {
  return ending === 'finished';
}

export type PlayAction = 'ignore' | 'load' | 'pause' | 'resume' | 'resume-bookmark' | 'replay';

/** §7 tapPlay. */
export function tapPlay(o: {
  view: PlaybarView;
  speech: SpeechPhase;
  bookmarked: boolean;
}): PlayAction {
  if (o.view === 'loading') return 'ignore';          // the button is inert
  if (o.speech === 'loading') return 'ignore';        // a fast reload is still in flight
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
  if (o.view === 'loading' || o.speech === 'loading') return 'queue';
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
