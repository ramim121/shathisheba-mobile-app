import type { Lang } from '../types';

/**
 * Every failure, turned into something a farmer should be shown.
 *
 * This exists because of a screenshot. A farmer photographed her cow, the
 * upload failed, and the chat showed her:
 *
 *     Unsupported FormDataPart implementation
 *
 * That is a React Native internal, in English, in the middle of a Bangla
 * conversation about a sick animal. The old `friendlyAiError` recognised a
 * handful of patterns and **returned the raw message for everything else**,
 * which meant every unanticipated failure — and there is always one — reached
 * her verbatim.
 *
 * So the rule here is inverted: nothing is shown unless it has been written for
 * her. An unrecognised failure gets the generic line, and the real text goes to
 * the console for whoever can act on it.
 *
 * The other half is the **retry**. A per-minute rate limit is not "something
 * went wrong", it is "wait eighteen seconds" — and the server now passes that
 * number through (`retry_after`). A screen that knows it can count down, keep
 * its retry button disabled until zero, and then enable it, which is the
 * difference between a dead end and a pause.
 */

export type FailureKind =
  /** A rate limit or a busy model. Has `retryAfter`; retrying will work. */
  | 'busy'
  /** No network. Retrying works once she has signal. */
  | 'offline'
  /** The request never came back. Worth one retry. */
  | 'timeout'
  /** Her trial is spent or a feature is locked. Not an error — a wall. */
  | 'locked'
  /** The photo could not be sent. Retrying the same photo may work. */
  | 'upload'
  /** Too long to read aloud. Nothing to retry. */
  | 'too_long'
  /** No Bangla voice on the phone and none from the server. */
  | 'no_voice'
  /** She must sign in again. */
  | 'signed_out'
  /** Anything else. */
  | 'unknown';

export type Failure = {
  kind: FailureKind;
  /** One line, in her language, written for her. */
  message: string;
  /** Seconds until a retry is worth making, when the upstream told us. */
  retryAfter: number | null;
  /** False where retrying cannot help — a wall, or an answer too long to read. */
  canRetry: boolean;
  /** For the console only. Never rendered. */
  detail: string;
};

type Raw = {
  code?: string;
  message?: string;
  retry_after?: number;
  retryAfter?: number;
  status?: number;
};

const BN: Record<FailureKind, string> = {
  busy: 'এখন অনেকে একসাথে প্রশ্ন করছেন।',
  offline: 'ইন্টারনেট নেই। আগের উত্তরগুলো পড়তে ও শুনতে পারবেন।',
  timeout: 'উত্তর আসতে দেরি হচ্ছে।',
  locked: 'এই সুবিধাটি এখন খোলা নেই।',
  upload: 'ছবিটি পাঠানো গেল না।',
  too_long: 'লেখাটি পড়ে শোনানোর জন্য একটু বড়। পড়ে নিতে পারেন।',
  no_voice: 'এই ফোনে বাংলা কণ্ঠ নেই।',
  signed_out: 'আবার লগ ইন করুন।',
  unknown: 'এখন কাজটি করা গেল না।',
};

const EN: Record<FailureKind, string> = {
  busy: 'A lot of farmers are asking at once.',
  offline: 'No internet. You can still read and play earlier answers.',
  timeout: 'The answer is taking too long.',
  locked: 'That is not open yet.',
  upload: 'The photo could not be sent.',
  too_long: 'That is a little long to read aloud. You can read it instead.',
  no_voice: 'This phone has no Bangla voice.',
  signed_out: 'Please sign in again.',
  unknown: 'That did not work just now.',
};

/** A second line, where there is something useful to add. */
const HINT_BN: Partial<Record<FailureKind, string>> = {
  busy: 'নিচের সময় শেষ হলে আবার পাঠাতে পারবেন।',
  offline: 'নেটওয়ার্ক ফিরলে আবার চেষ্টা করুন।',
  upload: 'ছবিটি আবার তুলে বা গ্যালারি থেকে বেছে পাঠান।',
  unknown: 'একটু পরে আবার চেষ্টা করুন।',
};

const HINT_EN: Partial<Record<FailureKind, string>> = {
  busy: 'You can send it again when the timer runs out.',
  offline: 'Try again when the network comes back.',
  upload: 'Take the photo again, or pick it from the gallery.',
  unknown: 'Try again in a moment.',
};

/** Codes the server sends that are walls rather than failures. */
const WALL_CODES = new Set([
  'apa_locked',
  'apa_trial_spent',
  'apa_not_verified',
  'apa_live_closed',
  'geo_locked',
  'location_required',
  'change_pending',
]);

function kindOf(raw: string, code: string | undefined, status: number | undefined): FailureKind {
  if (code && WALL_CODES.has(code)) return 'locked';
  if (code === 'rate_limited' || code === 'apa_busy') return 'busy';
  if (code === 'apa_timeout') return 'timeout';
  if (code === 'apa_unconfigured') return 'busy';
  if (status === 429) return 'busy';
  if (status === 401 || /SESSION_EXPIRED|unauthenticated/i.test(raw)) return 'signed_out';

  if (/^TOO_LONG$/.test(raw)) return 'too_long';
  if (/^NO_VOICE$/.test(raw)) return 'no_voice';
  if (/^UPLOAD_/.test(raw) || /FormDataPart|upload failed|Upload failed/i.test(raw)) return 'upload';
  if (/network request failed|failed to fetch|load failed|ENOTFOUND|ECONNREFUSED/i.test(raw)) {
    return 'offline';
  }
  if (/^TIMEOUT|timed out|took too long|abort/i.test(raw)) return 'timeout';
  return 'unknown';
}

/**
 * The only function a screen should use to turn a caught error into text.
 *
 * Deliberately never returns `error.message` for an unrecognised failure. If
 * something new breaks, she sees the generic line and the console sees the
 * truth — rather than the other way round, which is what shipped.
 */
export function describeFailure(error: unknown, lang: Lang = 'bn'): Failure {
  const asObject = (error ?? {}) as Raw;
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const code = typeof asObject.code === 'string' ? asObject.code : undefined;
  const status = typeof asObject.status === 'number' ? asObject.status : undefined;

  const kind = kindOf(raw, code, status);

  const advised = Number(asObject.retry_after ?? asObject.retryAfter ?? NaN);
  const retryAfter = Number.isFinite(advised) && advised > 0 ? Math.ceil(advised) : null;

  // The server writes its refusals for her, so a coded message passes through.
  // Anything else does not, however tempting it is to be specific.
  const serverWrote =
    Boolean(code) && !WALL_CODES.has(code as string) && raw.length > 0 && !/^[\x00-\x7F]+$/.test(raw);

  const base = lang === 'bn' ? BN[kind] : EN[kind];
  const hint = lang === 'bn' ? HINT_BN[kind] : HINT_EN[kind];

  let message: string;
  if (kind === 'locked') {
    // A wall's copy is written by the entitlement resolver and is already hers.
    message = raw || base;
  } else if (serverWrote) {
    message = raw;
  } else {
    message = hint ? `${base} ${hint}` : base;
  }

  if (raw && !serverWrote && kind === 'unknown') {
    // The one place the real text goes. Kept out of the UI on purpose.
    console.warn('[shathi] unmasked failure:', raw.slice(0, 300));
  }

  return {
    kind,
    message,
    retryAfter: kind === 'busy' ? (retryAfter ?? 30) : retryAfter,
    canRetry: kind !== 'locked' && kind !== 'too_long' && kind !== 'no_voice',
    detail: raw.slice(0, 300),
  };
}

/**
 * Kept for the many call sites that only want a sentence.
 *
 * Same masking, so a screen that has not been updated to show a countdown still
 * cannot leak a stack trace.
 */
export function friendlyError(error: unknown, lang: Lang = 'bn'): string {
  return describeFailure(error, lang).message;
}

/** "১৮ সেকেন্ড পরে আবার চেষ্টা করুন" — the countdown line, in her numerals. */
export function retryLine(seconds: number, lang: Lang = 'bn'): string {
  if (seconds <= 0) {
    return lang === 'bn' ? 'আবার চেষ্টা করুন' : 'Try again';
  }
  if (lang === 'bn') {
    const bn = String(seconds).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[Number(d)]);
    return `${bn} সেকেন্ড পরে আবার চেষ্টা করুন`;
  }
  return `Try again in ${seconds}s`;
}
