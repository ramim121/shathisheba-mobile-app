import { Directory, File, Paths } from 'expo-file-system';

/**
 * Spoken answers, kept on the phone after the first listen.
 *
 * Read-aloud is synthesised by Gemini, which sounds far better than the
 * device's own engine and is the right trade while the free tier covers it. But
 * a farmer listens to the same answer more than once — she replays it while
 * walking to the field, and she comes back to it the next day — and paying for
 * that twice is wrong in both currencies:
 *
 *   - **Her data.** A 40-second answer is a few hundred kilobytes. On a prepaid
 *     2G connection, re-downloading it every time she taps play is a real cost
 *     to her, for audio her phone already had.
 *   - **Our quota.** The free tier caps *requests* per model per day. A replay
 *     that has to ask the server again is a request that produced nothing new.
 *
 * So the first listen downloads, and every listen after that plays from disk —
 * with no network at all, which also means the history stays listenable when
 * she has no signal.
 *
 * **The filename is the server's own content hash.** `lib/apa/tts.ts` names
 * each file `<sha256 of text+voice+rate+model>.wav`, so identical audio always
 * arrives under the same name and different audio never collides. That means
 * this cache cannot go stale: if the answer, the voice or the speaking rate
 * changes, the URL changes with it, and the old file is simply never asked for
 * again (and is eventually pruned).
 *
 * It lives in the cache directory rather than documents, because Android may
 * reclaim it when storage runs low — which is the correct behaviour for
 * something that can always be fetched again.
 */

const DIR_NAME = 'apa-speech';

/**
 * A hundred and fifty megabytes, roughly five hundred spoken answers. Past
 * that the oldest go, because a farmer who has asked five hundred questions is
 * not still replaying the first one.
 *
 * Raised from sixty when `apa_tts_mode` became `server` and autoplay was turned
 * off. Those two together changed what accumulates here: every answer she
 * presses play on is now Gemini audio rather than the handset's own voice, so
 * clips arrive steadily instead of occasionally — and each one she keeps is a
 * synthesis nobody pays for twice and a download she never makes again. Evicting
 * early would be spending money to save disk.
 *
 * Still the cache directory rather than documents: Android may reclaim it under
 * pressure, which is the right behaviour for something that can always be
 * fetched again.
 */
const MAX_BYTES = 150 * 1024 * 1024;

function folder(): Directory {
  const dir = new Directory(Paths.cache, DIR_NAME);
  try {
    if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  } catch {
    /* another call created it between the check and the create */
  }
  return dir;
}

/**
 * The local name for a remote clip: the server's own hash, off the end of the
 * URL. Query strings are dropped — an S3 signature is not part of the content.
 */
function nameFor(url: string): string | null {
  const clean = url.split('?')[0].split('#')[0];
  const last = clean.slice(clean.lastIndexOf('/') + 1);
  // Only accept something that looks like a hashed filename we produced. A URL
  // shaped unexpectedly is left uncached rather than written under a name that
  // might collide with a different answer.
  return /^[A-Za-z0-9._-]{8,80}$/.test(last) ? last : null;
}

/** The local file for this URL if it is already held, without touching the network. */
export function heldLocally(url: string): string | null {
  const name = nameFor(url);
  if (!name) return null;
  try {
    const file = new File(folder(), name);
    return file.exists ? file.uri : null;
  } catch {
    return null;
  }
}

/**
 * A playable local URI for this clip, downloading it once if need be.
 *
 * Falls back to the remote URL on any failure — a cache that stops a farmer
 * hearing her answer has done more harm than the bytes it saved.
 */
export async function localSpeech(url: string): Promise<string> {
  const held = heldLocally(url);
  if (held) return held;

  const name = nameFor(url);
  if (!name) return url;

  try {
    const dir = folder();
    const file = await File.downloadFileAsync(url, new File(dir, name), { idempotent: true });
    // Pruning after the write, not before: the file just fetched is the one
    // most likely to be played again, so it must never be the one evicted.
    void prune().catch(() => undefined);
    return file.uri;
  } catch {
    // Offline, or the file has been removed server-side. Playing from the URL
    // will fail the same way, and the caller falls back to the device voice.
    return url;
  }
}

/** Oldest first, until the folder is back inside its budget. */
export async function prune(): Promise<{ removed: number; bytes: number }> {
  try {
    const dir = folder();
    const files = dir
      .list()
      .filter((entry): entry is File => entry instanceof File)
      .map((file) => ({
        file,
        size: Number((file as unknown as { size?: number }).size ?? 0),
        at: Number(file.modificationTime ?? 0),
      }));

    let total = files.reduce((sum, f) => sum + f.size, 0);
    if (total <= MAX_BYTES) return { removed: 0, bytes: total };

    files.sort((a, b) => a.at - b.at);
    let removed = 0;
    for (const entry of files) {
      if (total <= MAX_BYTES) break;
      try {
        entry.file.delete();
        total -= entry.size;
        removed += 1;
      } catch {
        /* already gone */
      }
    }
    return { removed, bytes: total };
  } catch {
    return { removed: 0, bytes: 0 };
  }
}

/** What the settings screen shows, so "clear" is not a blind button. */
export async function stats(): Promise<{ files: number; bytes: number }> {
  try {
    const files = folder()
      .list()
      .filter((entry): entry is File => entry instanceof File);
    return {
      files: files.length,
      bytes: files.reduce(
        (sum, f) => sum + Number((f as unknown as { size?: number }).size ?? 0),
        0
      ),
    };
  } catch {
    return { files: 0, bytes: 0 };
  }
}

/** Everything held, gone. Offered beside "delete my conversations". */
export async function clear(): Promise<void> {
  try {
    const dir = folder();
    for (const entry of dir.list()) {
      try { entry.delete(); } catch { /* already gone */ }
    }
  } catch {
    /* nothing to clear */
  }
}
