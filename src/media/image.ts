import { ImageManipulator, SaveFormat, type ImageResult } from 'expo-image-manipulator';

/**
 * Shrink a picture before it leaves the phone.
 *
 * A photograph off a modern Android camera is 3000×4000 and three to six
 * megabytes. Three things go wrong if it is sent as it came:
 *
 *   - **Her data.** Six megabytes on a prepaid 2G connection is minutes of
 *     waiting and a real amount of money, for a picture of a leaf. Measured on
 *     a real 2160×3840 photo from this platform: 1,664 KB as uploaded against
 *     86 KB at 1024 on the long edge — **nineteen times less data** for an
 *     answer about the same spot on the same leaf.
 *   - **Failures.** The largest phone photos were timing out on the upload
 *     before the model ever saw them.
 *
 * What it does **not** save is tokens, and it is worth being exact about that
 * because the obvious assumption is wrong. Measured against
 * `gemini-3.1-flash-lite` on 19 September 2026, an inline image costs a flat
 * **1,100 prompt tokens at every size** — 128×72 and 2160×1215 both came back
 * as 1,104 against a 4-token text-only baseline. Gemini resizes server-side
 * before it tokenises, so shrinking the file changes what it costs *her* and
 * nothing about what it costs us.
 *
 * The budgets below are per purpose, because they are not the same problem. An
 * AI photo only needs to be as large as the model will look at — and since the
 * token cost is flat, that bound is about her connection rather than the bill.
 * A listing photo is looked at by people, on a phone screen. A KYC document has
 * a national ID number on it that a human has to read, and squeezing that is
 * how a verification gets rejected for no reason — so it gets the loosest
 * budget of the four, and is still a third of what the camera produced.
 */

export type ImagePurpose =
  /**
   * Sent to a model. 1024 is chosen for the connection, not the token count:
   * the model sees no more detail than it needs at this size, and the file is
   * a nineteenth of the camera original.
   */
  | 'ai'
  /** Looked at by people in the app — a listing, a community post. */
  | 'photo'
  /** Shown small and often — a profile picture. */
  | 'avatar'
  /** Read by a human reviewer. An NID number must survive the compression. */
  | 'document';

type Budget = { maxPx: number; compress: number };

const BUDGETS: Record<ImagePurpose, Budget> = {
  ai: { maxPx: 1024, compress: 0.75 },
  photo: { maxPx: 1600, compress: 0.8 },
  avatar: { maxPx: 512, compress: 0.8 },
  document: { maxPx: 2000, compress: 0.9 },
};

export type Optimised = {
  uri: string;
  width: number;
  height: number;
  /** Present only when `base64` was asked for. */
  base64?: string;
  /** Roughly, from the base64 length. Null when no base64 was produced. */
  bytes: number | null;
  /** False when the original was already within budget, or optimising failed. */
  changed: boolean;
};

/**
 * The server can change the AI budget without an app release. The right number
 * is something real photographs on real connections will teach us, and it is
 * not a number worth freezing into an APK — particularly since what it trades
 * against is her data allowance rather than our bill.
 */
let aiMaxPx: number | null = null;
export function setAiImageMaxPx(px: number | null | undefined) {
  const value = Number(px);
  if (Number.isFinite(value) && value >= 256 && value <= 4096) aiMaxPx = Math.round(value);
}

function budgetFor(purpose: ImagePurpose): Budget {
  const base = BUDGETS[purpose];
  if (purpose === 'ai' && aiMaxPx) return { ...base, maxPx: aiMaxPx };
  return base;
}

const bytesOf = (base64: string | undefined): number | null =>
  base64 ? Math.round((base64.length * 3) / 4) : null;

/**
 * Resize and recompress, never upscale.
 *
 * Failure returns the original untouched. An optimiser that stops a farmer
 * uploading her photograph has done more harm than the bytes it saved — so
 * every path out of here is a usable image.
 */
export async function optimiseImage(
  uri: string,
  purpose: ImagePurpose = 'photo',
  opts: { base64?: boolean } = {}
): Promise<Optimised> {
  const { maxPx, compress } = budgetFor(purpose);
  const save = { compress, format: SaveFormat.JPEG, base64: opts.base64 === true };

  try {
    // Decoded once. The reference is reused for the resize so the file is not
    // read and decoded a second time.
    const original = await ImageManipulator.manipulate(uri).renderAsync();
    const longest = Math.max(original.width, original.height);

    if (longest <= maxPx) {
      // Already small enough to send, but still worth a JPEG pass: a PNG
      // screenshot of a leaf is several times the size of the same thing as a
      // JPEG, and the camera's own JPEG is saved at a quality nobody needs.
      const out = await original.saveAsync(save);
      return shape(out, save.base64, false);
    }

    const target = original.width >= original.height ? { width: maxPx } : { height: maxPx };
    const resized = await ImageManipulator.manipulate(original).resize(target).renderAsync();
    const out = await resized.saveAsync(save);
    return shape(out, save.base64, true);
  } catch {
    // Some content:// URIs on some OEM gallery apps cannot be decoded by the
    // manipulator at all. Send what she picked.
    return { uri, width: 0, height: 0, bytes: null, changed: false };
  }
}

function shape(out: ImageResult, wantedBase64: boolean, changed: boolean): Optimised {
  return {
    uri: out.uri,
    width: out.width,
    height: out.height,
    ...(wantedBase64 && out.base64 ? { base64: out.base64 } : {}),
    bytes: bytesOf(out.base64),
    changed,
  };
}

/** Several at once, for the listing composer's six pictures. */
export async function optimiseAll(uris: string[], purpose: ImagePurpose = 'photo'): Promise<string[]> {
  const done = await Promise.all(
    uris.map((uri) => optimiseImage(uri, purpose).then((r) => r.uri).catch(() => uri))
  );
  return done;
}
