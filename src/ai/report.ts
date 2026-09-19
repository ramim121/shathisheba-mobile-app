import { Platform } from 'react-native';
import Constants from 'expo-constants';

/**
 * Tell the server what actually went wrong on the phone.
 *
 * ## Why this exists
 *
 * The photo upload took four attempts and voice input three, and every round
 * failed identically: the fault was on a handset, the technical detail was
 * caught and dropped, and the next fix was a guess about which React Native
 * API was to blame — shipped on the strength of a clean typecheck.
 *
 * The server-side record made it worse by looking complete. `apa_model_calls`
 * showed ten transcription calls failing with a 500, which was true, and was
 * last written at 03:26. When the same farmer's voice messages failed again at
 * 03:53 there was no row at all, because the request never left the phone. An
 * empty table reads exactly like a working feature.
 *
 * ## What it is not
 *
 * Not analytics. Nothing is sent that is not a failure: no screen views, no
 * timings, no identity beyond the user who is already authenticated. `detail`
 * is an error message — never her question, her recording, or her photograph.
 *
 * ## It must never make things worse
 *
 * Every call is fire-and-forget and every failure is swallowed. A farmer whose
 * upload failed must not then be shown a second error because the report of the
 * first one could not be delivered. `silent` keeps it out of the global
 * spinner, and the short timeout keeps a dead network from holding anything up.
 */

export type ErrorArea = 'upload' | 'voice' | 'photo' | 'ask' | 'speech' | 'live';

/**
 * How a report reaches the server, injected rather than imported.
 *
 * `src/api/client.ts` reports its own upload failures, so importing
 * `apiRequest` here would put a cycle between the networking layer and its
 * error reporter. Metro tolerates that until the day one of them evaluates
 * first and the other sees `undefined` — a failure that appears as a crash in
 * the reporter, which is the worst possible place for one.
 *
 * client.ts registers the poster at module scope, so by the time any failure
 * can happen it is set.
 */
type Poster = (payload: Record<string, unknown>) => Promise<unknown>;

let poster: Poster | null = null;

export function setReporter(next: Poster | null) {
  poster = next;
}

/** What the build is, so a stale install is distinguishable from a current one. */
function build() {
  return {
    app_version: String(Constants.expoConfig?.version ?? 'unknown'),
    platform: Platform.OS,
    os_version: String(Platform.Version ?? ''),
  };
}

/**
 * Everything useful that can be got out of an unknown throw.
 *
 * Errors arrive here from three places with three shapes — our own coded
 * failures, React Native's internals, and whatever a native module rejects
 * with — and the interesting part is in a different property each time.
 */
function unpack(error: unknown): { code?: string; status?: number; detail: string } {
  const e = error as
    | { code?: string; status?: number; message?: string; detail?: string; name?: string }
    | null
    | undefined;
  const parts = [
    e?.name && e.name !== 'Error' ? `${e.name}:` : null,
    e?.message ?? null,
    e?.detail && e.detail !== e.message ? `| ${e.detail}` : null,
  ].filter(Boolean);
  return {
    code: e?.code,
    status: e?.status,
    // `String(error)` rather than nothing, for a throw that is not an Error at
    // all — which is how a native module rejection usually arrives.
    detail: (parts.join(' ') || String(error)).slice(0, 3500),
  };
}

/** The last failure, kept in memory so the screen can offer it on a long press. */
let lastDetail: string | null = null;

export function lastFailureDetail(): string | null {
  return lastDetail;
}

export async function reportFailure(input: {
  area: ErrorArea;
  /** The step inside that area: 'read_file', 'post_multipart', 'transcribe'. */
  stage: string;
  error: unknown;
  /** Anything else worth knowing — a URI scheme, a byte count. Never contents. */
  note?: string;
}): Promise<void> {
  const { code, status, detail } = unpack(input.error);
  const full = [input.stage, input.note, detail].filter(Boolean).join(' · ');
  lastDetail = full;

  if (__DEV__) console.error(`[apa:${input.area}/${input.stage}]`, input.error, input.note ?? '');

  if (!poster) return;
  try {
    // No user id is sent: the server derives the caller from the bearer token.
    // Screens stopped choosing their own identity when `?user_id=` turned out
    // to be a value the API trusted from anyone.
    await poster({
      area: input.area,
      stage: input.stage,
      code,
      http_status: status,
      detail: full,
      ...build(),
    });
  } catch {
    // Swallowed on purpose. See the note at the top: the report of a failure
    // must never become a second failure in front of the farmer.
  }
}
