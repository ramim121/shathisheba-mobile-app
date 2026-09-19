import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import type { ApiRow, Lang } from '../types';
import { reportFailure, setReporter } from '../ai/report';

// The app's HTTP transport: URL building, the single fetch wrapper, the bearer
// token the server authenticates against, uploads, and the global loading and
// stale-data stores that screens subscribe to.
//
// Extracted from App.tsx so that changing how the app talks to the backend
// (retries, auth, caching) touches one small file rather than the same file as
// every screen.

// The backend the app talks to.
//
// Development talks to the admin's `npm run dev` server on port 3000 of the
// machine running Metro. Its host is read from Expo's hostUri (the address the
// phone already loaded the bundle from), so a changed Wi-Fi IP needs no edit.
// Set EXPO_PUBLIC_DEV_API_BASE_URL in .env to point development elsewhere.
//
// A release build reads .env.production, which points at the EC2 deployment
// behind shathisheba.digigramventures.com. A shipped APK that quietly fell back
// to localhost would resolve to the *phone itself*: every request fails, the app
// shows its offline copy, and nothing says the build was misconfigured. So in a
// release build the fallback is production.
export const PRODUCTION_API_BASE_URL = 'https://shathisheba.digigramventures.com/api/v1';

const DEV_API_PORT = 3000;

function devApiBaseUrl(): string {
  const override = process.env.EXPO_PUBLIC_DEV_API_BASE_URL;
  if (override) return override;
  // hostUri is "<host>:<metroPort>", e.g. "192.168.1.104:8081". A tunnel host
  // (*.exp.direct) only forwards Metro, so it cannot reach port 3000.
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  if (host && !host.endsWith('.exp.direct')) return `http://${host}:${DEV_API_PORT}/api/v1`;
  return `http://localhost:${DEV_API_PORT}/api/v1`;
}

const configuredBaseUrl = __DEV__
  ? devApiBaseUrl()
  : process.env.EXPO_PUBLIC_API_BASE_URL || process.env.API_BASE_URL || PRODUCTION_API_BASE_URL;

// SEC-10. Plain HTTP is how you develop against a laptop on the same Wi-Fi; it is
// not how you ship. Session tokens, phone numbers and loan applications travel
// over this. A release build pointed at http:// is a configuration mistake, and
// the safe response is to use production rather than transmit in the clear.
function resolveBaseUrl(url: string): string {
  if (__DEV__ || url.startsWith('https://')) return url;
  console.warn(
    `[api] Refusing the non-HTTPS base URL "${url}" in a release build; ` +
      `using ${PRODUCTION_API_BASE_URL}. Set EXPO_PUBLIC_API_BASE_URL in .env.production.`
  );
  return PRODUCTION_API_BASE_URL;
}

export const API_BASE_URL = resolveBaseUrl(configuredBaseUrl);

// No hard-coded fallback. App.tsx previously carried a literal WeatherAPI key
// here as the last resort, which shipped it in source as well as in the bundle;
// an unset key now degrades to the sample-weather path instead.
export const WEATHERAPI_KEY =
  process.env.EXPO_PUBLIC_WEATHERAPI_KEY ||
  process.env.WEATHERAPI_KEY ||
  '';

export const WEATHERAPI_LOCATION =
  process.env.EXPO_PUBLIC_WEATHERAPI_LOCATION || '23.783200747913025,90.3994';

export const SERVER_FALLBACK_MESSAGE = 'We could not load this from current server.';

export type ApiFailure = Error & {
  code?: string;
  status?: number;
  /**
   * Some refusals carry the state the screen needs to render. Shathi Apa's
   * 403 returns the whole unlock screen — which steps are done, what
   * verification buys — so the app shows what the server decided rather than a
   * hard-coded guess at it.
   */
  entitlement?: unknown;
  /**
   * Seconds until a retry is worth making, where the upstream said so.
   *
   * A per-minute rate limit is a pause, not a fault. The screen can only count
   * it down and re-enable its retry button at the right moment if the number
   * survives the throw.
   */
  retry_after?: number;
};

/** The server's error code, if the failure carried one. */
export function apiErrorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error ? (error as ApiFailure).code : undefined;
}

export function naturalApiError(error: unknown, lang: Lang) {
  const message = error instanceof Error ? error.message : String(error);
  if (/^TIMEOUT|timed out|took too long/i.test(message)) {
    return lang === 'bn'
      ? 'সার্ভার সাড়া দিতে দেরি করছে। ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন।'
      : 'The server is taking too long to respond. Check your connection and try again.';
  }
  if (/network request failed|failed to fetch|load failed/i.test(message)) {
    return lang === 'bn'
      ? 'ব্যাকএন্ড সার্ভারে পৌঁছানো যাচ্ছে না। ইন্টারনেট বা সার্ভার ঠিকানা পরীক্ষা করুন।'
      : 'Cannot reach the backend server. Check your internet connection or the server address.';
  }
  if (/ETIMEDOUT|ECONNREFUSED|ER_|mysql|database/i.test(message)) {
    return lang === 'bn'
      ? `ডাটাবেস সমস্যা: ${message}`
      : `Database problem: ${message}`;
  }
  if (apiErrorCode(error)) return message;
  return lang === 'bn'
    ? `তথ্য আনতে সমস্যা হয়েছে: ${message}`
    : `Could not fetch the latest content: ${message}`;
}

export function apiUrl(resource: string) {
  return `${API_BASE_URL.replace(/\/$/, '')}/${resource.replace(/^\//, '')}`;
}

export function weatherApiUrl(lang: Lang, query: string) {
  const params = new URLSearchParams({
    key: WEATHERAPI_KEY,
    q: query,
    days: '3',
    aqi: 'yes',
    alerts: 'yes',
    lang,
  });
  return `https://api.weatherapi.com/v1/forecast.json?${params.toString()}`;
}

// Lightweight global loading store: any in-flight apiRequest increments the
// counter; the GlobalLoader overlay subscribes and shows a branded spinner.

export const loadingStore = {
  active: 0,
  listeners: new Set<(active: number) => void>(),
  begin() {
    this.active += 1;
    this.listeners.forEach((fn) => fn(this.active));
  },
  end() {
    this.active = Math.max(0, this.active - 1);
    this.listeners.forEach((fn) => fn(this.active));
  },
  subscribe(fn: (active: number) => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  },
};

// Global pull-to-refresh signal: bumping `tick` makes data hooks refetch.
export const refreshStore = {
  tick: 0,
  listeners: new Set<(tick: number) => void>(),
  trigger() {
    this.tick += 1;
    this.listeners.forEach((fn) => fn(this.tick));
  },
  subscribe(fn: (tick: number) => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  },
};


export const REQUEST_TIMEOUT_MS = 15000;

// The session token minted by app/auth/verify-otp, mirrored out of AuthContext so
// the plain (non-hook) fetch helpers below can attach it. The server resolves the
// caller's user_id from this token, so screens no longer decide their own identity
// by passing ?user_id= — a value the API used to trust from anyone.
export let apiAuthToken: string | null = null;
// Called when the server rejects our token (expired 90-day session, or a session
// revoked server-side). Without this the app would keep retrying with a dead
// token and show request errors on every screen instead of returning to login.
export let onAuthExpired: (() => void) | null = null;

export function setApiAuthToken(token: string | null) {
  apiAuthToken = token;
}

export function setAuthExpiredHandler(handler: (() => void) | null) {
  onAuthExpired = handler;
}

// How src/ai/report.ts posts a failure. Injected rather than imported there,
// because this file reports its own upload failures and a cycle between the
// networking layer and its error reporter fails as an `undefined` at runtime.
setReporter((payload) =>
  apiRequest('app/apa/client-error', {
    method: 'POST',
    silent: true,
    timeoutMs: 8000,
    body: JSON.stringify(payload),
  })
);

export function authHeaders(): Record<string, string> {
  return apiAuthToken ? { Authorization: `Bearer ${apiAuthToken}` } : {};
}

/**
 * `silent` opts a request out of the global spinner.
 *
 * The overlay is right for a fetch the user is waiting on, and wrong for a
 * background refresh of a screen they are already reading — returning to Home
 * re-fetched the finance summary and threw a full-screen loader over a page that
 * was already rendered.
 */
export type ApiOptions = RequestInit & {
  silent?: boolean;
  /**
   * Override the 15-second default. An AI answer that calls two grounding
   * tools legitimately takes eighteen seconds, and aborting it at fifteen
   * showed the farmer a timeout for a request that was about to succeed.
   */
  timeoutMs?: number;
};

export async function apiRequest<T = any>(resource: string, options?: ApiOptions): Promise<T> {
  const silent = options?.silent === true;
  if (!silent) loadingStore.begin();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options?.timeoutMs ?? REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(apiUrl(resource), {
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...authHeaders(),
        ...(options?.headers || {}),
      },
      signal: controller.signal,
      ...options,
    });
    const json = await response.json().catch(() => ({}));
    if (response.status === 401 && apiAuthToken) {
      apiAuthToken = null;
      onAuthExpired?.();
      throw new Error('SESSION_EXPIRED: please sign in again');
    }
    if (!response.ok || json.ok === false) {
      // Keep the server's machine-readable code: the app routes on it — geo_locked
      // opens the "outside your area" screen, change_pending the review state.
      const failure = new Error(json.message || `Server responded with ${response.status}`) as ApiFailure;
      failure.code = typeof json.code === 'string' ? json.code : undefined;
      failure.status = response.status;
      // How long the upstream said to wait. A per-minute rate limit is a pause,
      // not a fault, and the screen can only count it down if the number
      // survives this far.
      const wait = Number(json.retry_after ?? response.headers.get('Retry-After') ?? NaN);
      if (Number.isFinite(wait) && wait > 0) failure.retry_after = Math.ceil(wait);
      if (json.entitlement) failure.entitlement = json.entitlement;
      throw failure;
    }
    return json as T;
  } catch (error) {
    // Normalise an aborted (timed-out) request into a friendly timeout error.
    if (error instanceof Error && (error.name === 'AbortError' || /abort/i.test(error.message))) {
      throw new Error('TIMEOUT: request took too long');
    }
    throw error;
  } finally {
    clearTimeout(timer);
    if (!silent) loadingStore.end();
  }
}

/**
 * A multipart/form-data body, built byte by byte.
 *
 * ## Why this is hand-rolled
 *
 * Three earlier attempts to upload a photo from this app failed on a real
 * handset, and each one failed inside a React Native abstraction rather than in
 * our own logic:
 *
 *   1. `form.append('file', {uri, name, type})` - the legacy part shape - threw
 *      "Unsupported FormDataPart implementation" on RN 0.86 with the New
 *      Architecture.
 *   2. Constructing a `Blob` from the file's bytes threw outright: RN's Blob
 *      cannot be built from an ArrayBuffer or an ArrayBufferView.
 *   3. `expo-file-system`'s native uploader typechecked, bundled, and still did
 *      not deliver - and because the failure was caught and only warned in
 *      __DEV__, nobody could see why.
 *
 * The common thread is that every one of them was chosen by reasoning about
 * which API *ought* to work. So this one was chosen by testing the bytes: the
 * exact body below was posted to the production endpoint from Node and returned
 * 201 with an S3 URL, and the same body without a token returned 401, so the
 * pass means something.
 *
 * Everything it depends on is now a checked fact rather than an assumption:
 *
 *   - `File(uri).bytes()` exists in expo-file-system 57 and reads through the
 *     native layer, not through `fetch`.
 *   - RN 0.86's `convertRequestBody` maps `ArrayBuffer.isView(body)` to
 *     `{base64: ...}`, so a Uint8Array body reaches the wire as raw bytes and
 *     is binary-safe. A string body would not be: UTF-8 would corrupt every
 *     byte above 0x7F, which is most of a JPEG.
 *
 * Binary-safety is why the file bytes are copied in as bytes and never pass
 * through a string on the way.
 */
export function buildMultipart(input: {
  boundary: string;
  fields: Record<string, string>;
  file: { field: string; name: string; type: string; bytes: Uint8Array };
}): Uint8Array {
  const { boundary, fields, file } = input;
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];

  for (const [name, value] of Object.entries(fields)) {
    chunks.push(
      encoder.encode(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${name}"\r\n\r\n` +
          `${value}\r\n`
      )
    );
  }

  chunks.push(
    encoder.encode(
      `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="${file.field}"; filename="${file.name}"\r\n` +
        `Content-Type: ${file.type}\r\n\r\n`
    )
  );
  chunks.push(file.bytes);
  chunks.push(encoder.encode(`\r\n--${boundary}--\r\n`));

  let total = 0;
  for (const c of chunks) total += c.length;
  const body = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    body.set(c, at);
    at += c.length;
  }
  return body;
}

/**
 * The bytes of a local file, read through the native file system.
 *
 * Deliberately not `fetch(uri)`. That is what the audio path used, and on
 * RN 0.86 with the New Architecture `fetch` on a `file://` URI does not
 * reliably return the file - which is why a recorded voice message showed
 * "could not send" on a handset while every unit test passed.
 */
async function localFileBytes(uri: string): Promise<Uint8Array> {
  // The scheme is the first thing worth knowing and the first thing that was
  // never recorded: a content:// URI and a file:// URI fail here for entirely
  // different reasons and produced the same message.
  const scheme = uri.split(':')[0];

  if (uri.startsWith('file://')) {
    let File: typeof import('expo-file-system').File;
    try {
      ({ File } = await import('expo-file-system'));
    } catch (error) {
      await reportFailure({ area: 'upload', stage: 'import_file_system', error, note: scheme });
      throw Object.assign(new Error('UPLOAD_NO_FS'), { code: 'upload_failed' });
    }

    const file = new File(uri);
    let exists = false;
    let size: number | null = null;
    try {
      exists = file.exists;
      size = exists ? (file.size ?? null) : null;
    } catch (error) {
      await reportFailure({ area: 'upload', stage: 'file_stat', error, note: `${scheme} ${uri.length}ch` });
    }

    if (!exists) {
      const miss = Object.assign(new Error(`UPLOAD_FILE_MISSING: ${uri}`), { code: 'upload_no_file' });
      await reportFailure({ area: 'upload', stage: 'file_missing', error: miss, note: `${scheme} ${uri.length}ch` });
      throw miss;
    }

    try {
      const bytes = await file.bytes();
      if (!bytes.length) {
        const empty = Object.assign(new Error('UPLOAD_FILE_EMPTY'), { code: 'upload_no_file' });
        await reportFailure({ area: 'upload', stage: 'file_empty', error: empty, note: `size=${size}` });
        throw empty;
      }
      return bytes;
    } catch (error) {
      if ((error as { code?: string } | null)?.code) throw error;
      await reportFailure({ area: 'upload', stage: 'file_bytes', error, note: `size=${size}` });
      throw Object.assign(new Error('UPLOAD_READ_FAILED'), { code: 'upload_failed' });
    }
  }

  // A `content://` URI from an OEM gallery that expo-image-manipulator could
  // not decode, so `optimiseImage` handed back the original. The file system
  // cannot open those, but Android's own resolver can and `fetch` goes through
  // it — which is the one case where `fetch` is the right tool rather than the
  // thing that broke voice messages.
  try {
    const response = await fetch(uri);
    if (!response.ok) {
      const bad = Object.assign(new Error(`UPLOAD_FILE_UNREADABLE: ${response.status}`), {
        code: 'upload_no_file',
        status: response.status,
      });
      await reportFailure({ area: 'upload', stage: 'content_uri_status', error: bad, note: scheme });
      throw bad;
    }
    return new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    if ((error as { code?: string } | null)?.code) throw error;
    await reportFailure({ area: 'upload', stage: 'content_uri_fetch', error, note: scheme });
    throw Object.assign(new Error('UPLOAD_READ_FAILED'), { code: 'upload_failed' });
  }
}

export async function uploadImage(uri: string, folder: string): Promise<string> {
  if (!uri || typeof uri !== 'string') {
    // Never reach the uploader with nothing: that is the path that produced an
    // internal error string on a farmer's screen.
    throw Object.assign(new Error('UPLOAD_NO_FILE'), { code: 'upload_no_file' });
  }

  const rawName = uri.split('?')[0].split('/').pop() || '';
  const match = /\.(\w+)$/.exec(rawName);
  const ext = (match ? match[1] : 'jpg').toLowerCase();
  const type = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  const name = match ? rawName : `photo-${Date.now()}.${ext}`;

  const base = API_BASE_URL.replace(/\/api\/v1\/?$/, '');
  const endpoint = `${base}/api/upload`;

  loadingStore.begin();
  try {
    const bytes = await localFileBytes(uri);
    if (!bytes.length) {
      throw Object.assign(new Error('UPLOAD_FILE_EMPTY'), { code: 'upload_no_file' });
    }

    const boundary = `----ShathiSheba${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    const body = buildMultipart({
      boundary,
      fields: { folder },
      file: { field: 'file', name, type, bytes },
    });

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          ...authHeaders(),
          // The boundary has to be declared here, because nothing is generating
          // it for us any more. That is the point.
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body: body as unknown as BodyInit,
      });
    } catch (error) {
      // A transport failure, which is a different problem from the server
      // refusing the body — and the two were indistinguishable before.
      await reportFailure({
        area: 'upload',
        stage: 'post_multipart',
        error,
        note: `${body.length}B to ${endpoint}`,
      });
      throw Object.assign(new Error('UPLOAD_NO_NETWORK'), { code: 'upload_failed' });
    }

    const text = await response.text();
    const json = safeParse(text);
    if (!response.ok || json.ok === false) {
      const failed = Object.assign(
        new Error(String(json.message ?? `UPLOAD_FAILED_${response.status}`)),
        {
          code: 'upload_failed',
          status: response.status,
          retry_after: json.retry_after,
          // The server's own words, for the console. Never shown to her.
          detail: text.slice(0, 300),
        }
      );
      await reportFailure({
        area: 'upload',
        stage: 'server_refused',
        error: failed,
        note: `${body.length}B ${type}`,
      });
      throw failed;
    }

    // Built from the app's own base so the host is always reachable from the
    // device (the server's request origin can resolve to 0.0.0.0).
    return json.path ? `${base}${json.path}` : (json.url as string);
  } catch (error) {
    // Anything that is not already a coded failure is a mechanism failure, and
    // the one thing that must not happen again is it vanishing. Three attempts
    // were spent guessing because the real reason was swallowed.
    const coded = error as { code?: string; message?: string } | null;
    if (coded?.code) throw error;
    if (__DEV__) console.error('[upload] mechanism failed:', error);
    throw Object.assign(new Error(String(coded?.message ?? 'UPLOAD_FAILED')), {
      code: 'upload_failed',
      detail: String(coded?.message ?? error),
    });
  } finally {
    loadingStore.end();
  }
}

function safeParse(body: string): Record<string, any> {
  try {
    return JSON.parse(body) as Record<string, any>;
  } catch {
    return {};
  }
}



export async function apiList<T = ApiRow>(resource: string): Promise<T[]> {
  const json = await apiRequest<{ data?: T[] | { row?: T; related?: unknown } }>(resource);
  return Array.isArray(json.data) ? json.data : [];
}

export async function apiCreate(resource: string, payload: ApiRow) {
  return apiRequest<{ result?: { insertId?: number }; [key: string]: any }>(resource, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// Tracks which CURRENTLY-MOUNTED resources are serving cached (stale) data after a
// failed server fetch, so a single global banner can offer a refresh. Marks are
// removed when the resource refetches successfully OR its screen unmounts, so the
// banner never lingers after the data on screen is fresh again. Repeated failed
// refreshes surface the underlying error so the user learns the real cause.

export const staleStore = {
  resources: new Set<string>(),
  listeners: new Set<() => void>(),
  failedRefreshes: 0,
  lastError: null as string | null,
  notify() {
    this.listeners.forEach((fn) => fn());
  },
  mark(resource: string, error: string) {
    this.resources.add(resource);
    this.lastError = error;
    this.notify();
  },
  clear(resource: string) {
    if (this.resources.delete(resource)) this.notify();
  },
  // Called on any successful fetch: the server is reachable again.
  resetFailures() {
    if (this.failedRefreshes > 0 || this.lastError !== null) {
      this.failedRefreshes = 0;
      this.lastError = null;
      this.notify();
    }
  },
  noteRefreshAttempt() {
    if (this.resources.size > 0) {
      this.failedRefreshes += 1;
      this.notify();
    }
  },
  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  },
};


export const API_CACHE_PREFIX = 'apicache:';

