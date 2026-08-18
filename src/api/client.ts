import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ApiRow, Lang } from '../types';

// The app's HTTP transport: URL building, the single fetch wrapper, the bearer
// token the server authenticates against, uploads, and the global loading and
// stale-data stores that screens subscribe to.
//
// Extracted from App.tsx so that changing how the app talks to the backend
// (retries, auth, caching) touches one small file rather than the same file as
// every screen.

// The backend the app talks to.
//
// Development reads EXPO_PUBLIC_API_BASE_URL from .env, which points at whatever
// LAN address this machine currently has. A release build reads .env.production,
// which points at the EC2 deployment behind shathisheba.digigramventures.com.
//
// The two fallbacks differ on purpose. A shipped APK that quietly falls back to
// localhost resolves to the *phone itself*: every request fails, the app shows
// its offline copy, and nothing says the build was misconfigured. So in a release
// build the fallback is production, and only development falls back to localhost.
export const PRODUCTION_API_BASE_URL = 'https://shathisheba.digigramventures.com/api/v1';

const configuredBaseUrl =
  process.env.EXPO_PUBLIC_API_BASE_URL ||
  process.env.API_BASE_URL ||
  (__DEV__ ? 'http://localhost:3000/api/v1' : PRODUCTION_API_BASE_URL);

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
export type ApiOptions = RequestInit & { silent?: boolean };

export async function apiRequest<T = any>(resource: string, options?: ApiOptions): Promise<T> {
  const silent = options?.silent === true;
  if (!silent) loadingStore.begin();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
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
      throw new Error(json.message || `Server responded with ${response.status}`);
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

export async function uploadImage(uri: string, folder: string): Promise<string> {
  const name = uri.split('/').pop() || `photo-${Date.now()}.jpg`;
  const match = /\.(\w+)$/.exec(name);
  const ext = (match ? match[1] : 'jpg').toLowerCase();
  const type = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  const form = new FormData();
  form.append('folder', folder);
  // React Native FormData file shape.
  form.append('file', { uri, name, type } as any);
  loadingStore.begin();
  try {
    const base = API_BASE_URL.replace(/\/api\/v1\/?$/, '');
    const response = await fetch(`${base}/api/upload`, {
      method: 'POST',
      headers: authHeaders(),
      body: form as any,
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok || json.ok === false) {
      throw new Error(json.message || `Upload failed (${response.status})`);
    }
    // Build the URL from the app's own base so the host is always reachable
    // from the device (the server's request origin can resolve to 0.0.0.0).
    return json.path ? `${base}${json.path}` : (json.url as string);
  } finally {
    loadingStore.end();
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

