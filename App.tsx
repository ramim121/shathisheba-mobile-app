import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { Audio } from 'expo-av';
import { GoogleGenAI, MediaResolution } from '@google/genai';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  Platform,
  StatusBar as NativeStatusBar,
  Image,
  View,
} from 'react-native';

type MainTab = 'home' | 'community' | 'projects' | 'profile';
type Lang = 'bn' | 'en';
type Screen =
  | 'onboarding'
  | 'shathiApa'
  | 'apaVoice'
  | 'apaCamera'
  | 'login'
  | 'prefAnimal'
  | 'prefLivestock'
  | 'prefCrops'
  | 'prefFish'
  | 'prefVegetable'
  | 'prefFruits'
  | 'home'
  | 'weather'
  | 'community'
  | 'projects'
  | 'profile'
  | 'saleCategories'
  | 'livestock'
  | 'cattleForm'
  | 'cattlePrice'
  | 'cattleDone'
  | 'buyCategories'
  | 'buyProducts'
  | 'buyOrder'
  | 'buyDone'
  | 'training'
  | 'trainingDetail'
  | 'trainingArticle'
  | 'trainingVideo'
  | 'partnerRegister'
  | 'kyc'
  | 'regDone'
  | 'inactive';

const colors = {
  maroon: '#871449',
  maroonDark: '#4A112B',
  rose: '#F4E8EE',
  cream: '#FCFAF8',
  card: '#FFFFFF',
  gold: '#F59E0B',
  goldPale: '#FFF3C4',
  green: '#16A34A',
  greenPale: '#DCFCE7',
  blue: '#2563EB',
  bluePale: '#DBEAFE',
  ink: '#2B0B1E',
  muted: '#9B5173',
  line: '#E8D7DF',
  danger: '#DC2626',
};

type PreferenceKey = 'cattle' | 'crops' | 'fishery' | 'vegetables' | 'fruits';
type PreferenceOption = { id: string; icon: string; label: string };
type PreferenceSection = { title: string; items: PreferenceOption[] };
type TrainingContentKind = 'article' | 'video';
type ChatMessage = { role: 'user' | 'model'; text: string; imageUri?: string; suggestions?: string[] };
type CattleAiResult = {
  ageMonths?: number;
  weightKg?: number;
  animalType?: string;
  breed?: string;
  count?: number;
  healthSummary?: string;
  accuracyPercent?: number;
  isCow?: boolean;
};
type TrainingModule = {
  icon: string;
  title: string;
  sub: string;
  count: string;
  article: string;
  video: string;
  quiz: string;
  progress: string;
  bg: string;
  articleBody?: string;
  videoUrl?: string;
};
type ApiRow = Record<string, any>;
type ApiState<T> = { rows: T[]; loading: boolean; error: string | null };
type WeatherApiState = { data: ApiRow | null; loading: boolean; error: string | null; usingFallback: boolean };
type LocationState = {
  query: string;
  label: string;
  loading: boolean;
  granted: boolean;
  error: string | null;
  fallback: boolean;
};

const preferenceOrder: PreferenceKey[] = ['cattle', 'crops', 'fishery', 'vegetables', 'fruits'];

const androidStatusBarInset = Platform.OS === 'android' ? NativeStatusBar.currentHeight ?? 0 : 0;
const androidNavigationInset = Platform.OS === 'android' ? 24 : 0;
const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL ||
  process.env.API_BASE_URL ||
  'http://localhost:3000/api/v1';
const WEATHERAPI_KEY =
  process.env.EXPO_PUBLIC_WEATHERAPI_KEY ||
  process.env.WEATHERAPI_KEY ||
  '0912cecdd77a45d99d350953261405';
const WEATHERAPI_LOCATION = process.env.EXPO_PUBLIC_WEATHERAPI_LOCATION || '23.783200747913025,90.3994';

const bnDigits = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

const LanguageContext = createContext<{
  lang: Lang;
  setLang: (lang: Lang) => void;
  toggleLang: () => void;
  tx: (bnText: string, enText: string) => string;
} | null>(null);

const LocationContext = createContext<LocationState>({
  query: WEATHERAPI_LOCATION,
  label: 'Default location',
  loading: false,
  granted: false,
  error: null,
  fallback: true,
});

function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used inside LanguageContext');
  }
  return context;
}

function bn(value: number | string) {
  return String(value).replace(/\d/g, (digit) => bnDigits[Number(digit)]);
}

function money(value: number) {
  return `৳${bn(Math.round(value).toLocaleString('en-IN'))}`;
}

function amount(value: number, lang: Lang) {
  const formatted = Math.round(value).toLocaleString('en-IN');
  return lang === 'bn' ? `৳${bn(formatted)}` : `৳${formatted}`;
}

function num(value: number | string, lang: Lang) {
  return lang === 'bn' ? bn(value) : String(value);
}

function useAppLocation() {
  return useContext(LocationContext);
}

function naturalApiError(error: unknown, lang: Lang) {
  const message = error instanceof Error ? error.message : String(error);
  if (/network request failed|failed to fetch|load failed/i.test(message)) {
    return lang === 'bn'
      ? 'এখন সার্ভার থেকে তথ্য আনা যাচ্ছে না। একটু পরে আবার চেষ্টা করুন।'
      : 'We could not load this from the server right now. Please try again shortly.';
  }
  return lang === 'bn'
    ? `তথ্য আনতে সমস্যা হয়েছে: ${message}`
    : `Could not fetch the latest content: ${message}`;
}

function apiUrl(resource: string) {
  return `${API_BASE_URL.replace(/\/$/, '')}/${resource.replace(/^\//, '')}`;
}

function weatherApiUrl(lang: Lang, query: string) {
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

async function apiRequest<T = any>(resource: string, options?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(resource), {
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
    ...options,
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.ok === false) {
    throw new Error(json.message || `Server responded with ${response.status}`);
  }
  return json as T;
}

async function apiList<T = ApiRow>(resource: string): Promise<T[]> {
  const json = await apiRequest<{ data?: T[] | { row?: T; related?: unknown } }>(resource);
  return Array.isArray(json.data) ? json.data : [];
}

async function apiCreate(resource: string, payload: ApiRow) {
  return apiRequest<{ result?: { insertId?: number }; [key: string]: any }>(resource, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

function useApiList<T = ApiRow>(resource: string): ApiState<T> {
  const { lang } = useLanguage();
  const [state, setState] = useState<ApiState<T>>({ rows: [], loading: true, error: null });
  useEffect(() => {
    let alive = true;
    setState((current) => ({ ...current, loading: true, error: null }));
    apiList<T>(resource)
      .then((rows) => {
        if (alive) setState({ rows, loading: false, error: null });
      })
      .catch((error) => {
        if (alive) setState({ rows: [], loading: false, error: naturalApiError(error, lang) });
      });
    return () => {
      alive = false;
    };
  }, [resource, lang]);
  return state;
}

function sampleWeatherApiData(lang: Lang) {
  return {
    location: {
      name: lang === 'bn' ? 'ময়মনসিংহ সদর' : 'Mymensingh Sadar',
      country: 'Bangladesh',
      localtime: 'Sample',
    },
    current: {
      temp_c: 31,
      feelslike_c: 35,
      humidity: 40,
      wind_kph: 12,
      gust_kph: 18,
      precip_mm: 0,
      cloud: 46,
      uv: 7,
      condition: { text: lang === 'bn' ? 'আংশিক মেঘলা' : 'Partly cloudy', icon: '' },
      air_quality: { pm2_5: 22, pm10: 35, 'us-epa-index': 2 },
    },
    forecast: {
      forecastday: [
        {
          date: 'Sample',
          day: {
            daily_chance_of_rain: 65,
            maxtemp_c: 33,
            mintemp_c: 26,
            avgtemp_c: 31,
            totalprecip_mm: 2.1,
            avghumidity: 58,
            condition: { text: lang === 'bn' ? 'গরম ও আর্দ্র' : 'Warm and humid' },
          },
          astro: { sunrise: '05:15 AM', sunset: '06:35 PM' },
          hour: [],
        },
      ],
    },
    alerts: {
      alert: [],
    },
  };
}

function useWeatherApi(): WeatherApiState {
  const { lang } = useLanguage();
  const appLocation = useAppLocation();
  const [state, setState] = useState<WeatherApiState>({ data: null, loading: true, error: null, usingFallback: false });
  useEffect(() => {
    let alive = true;
    setState((current) => ({ ...current, loading: true, error: null }));
    fetch(weatherApiUrl(lang, appLocation.query))
      .then(async (response) => {
        const json = await response.json();
        if (!response.ok || json.error) {
          throw new Error(json.error?.message || `Weather API responded with ${response.status}`);
        }
        return json;
      })
      .then((data) => {
        if (alive) setState({ data, loading: false, error: appLocation.error, usingFallback: appLocation.fallback });
      })
      .catch((error) => {
        if (alive) {
          setState({
            data: sampleWeatherApiData(lang),
            loading: false,
            error: naturalApiError(error, lang),
            usingFallback: true,
          });
        }
      });
    return () => {
      alive = false;
    };
  }, [lang, appLocation.query, appLocation.error, appLocation.fallback]);
  return state;
}

function WeatherSourceBadge({ fallback, error }: { fallback?: boolean; error?: string | null }) {
  const { tx } = useLanguage();
  if (!fallback) return null;
  return (
    <View style={styles.sourceBadge}>
      <Text style={styles.sourceBadgeIcon}>ⓘ</Text>
      <Text style={styles.sourceBadgeText}>
        {error || tx('লাইভ আবহাওয়া পাওয়া যায়নি, নমুনা ডাটা দেখানো হচ্ছে।', 'Live weather unavailable, showing sample data.')}
      </Text>
    </View>
  );
}

function weatherConditionIcon(code?: number, isDay = 1) {
  if (!code) return isDay ? '⛅' : '☁';
  if ([1063, 1150, 1153, 1180, 1183, 1186, 1189, 1192, 1195, 1240, 1243, 1246].includes(code)) return '🌧';
  if ([1087, 1273, 1276, 1279, 1282].includes(code)) return '⛈';
  if ([1000].includes(code)) return isDay ? '☀' : '☾';
  if ([1003, 1006, 1009].includes(code)) return '☁';
  return '⛅';
}

function bestHarvestAdvice(weather: ApiRow | null, lang: Lang) {
  const hours: ApiRow[] = weather?.forecast?.forecastday?.[0]?.hour || [];
  const nowHour = Number(String(weather?.location?.localtime || '').split(' ')[1]?.split(':')[0] || 10);
  const goodHour = hours.find((hour) => {
    const hourValue = Number(String(hour.time || '').split(' ')[1]?.split(':')[0] || 0);
    return hourValue >= nowHour && Number(hour.chance_of_rain || 0) < 35 && Number(hour.precip_mm || 0) < 0.5;
  });
  if (!goodHour) {
    return lang === 'bn'
      ? 'আজ বৃষ্টি/আর্দ্রতার ঝুঁকি থাকতে পারে। কাটা ফসল, সবজি বা ফল ঢেকে রাখুন এবং শুকনো জায়গায় নিন।'
      : 'Rain or humidity risk may continue today. Cover harvested crops, vegetables, or fruits and move them to a dry place.';
  }
  const time = String(goodHour.time || '').split(' ')[1] || '';
  return lang === 'bn'
    ? `আজ ${time} নাগাদ তুলনামূলক কম বৃষ্টির সময় দেখা যাচ্ছে। জরুরি ফসল/সবজি কাটার কাজ এই সময়ের মধ্যে করুন।`
    : `Around ${time} looks like a lower-rain window today. Use that period for urgent crop, vegetable, or fruit harvesting.`;
}

function parseMaybeJson(value: any) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function localized(row: ApiRow | undefined, lang: Lang, base: string, fallback = '') {
  if (!row) return fallback;
  return (
    row[`${base}_${lang}`] ||
    row[`${base}_${lang === 'bn' ? 'en' : 'bn'}`] ||
    row[base] ||
    row.name ||
    row.title ||
    fallback
  );
}

function rowTitle(row: ApiRow | undefined, lang: Lang, fallback = '') {
  if (!row) return fallback;
  return localized(row, lang, 'name') || localized(row, lang, 'title') || row.headline || row.item_name || row.product_name || fallback;
}

function rowBody(row: ApiRow | undefined, lang: Lang, fallback = '') {
  if (!row) return fallback;
  return localized(row, lang, 'body') || localized(row, lang, 'description') || localized(row, lang, 'short_description') || row.advice || row.metrics || fallback;
}

function ApiStatus({ state, empty }: { state: ApiState<any>; empty?: string }) {
  const { tx } = useLanguage();
  if (state.loading) {
    return <Text style={styles.apiNotice}>{tx('সার্ভার থেকে তথ্য আনা হচ্ছে...', 'Loading latest data from server...')}</Text>;
  }
  if (state.error) {
    return <Text style={styles.apiNotice}>{state.error}</Text>;
  }
  if (!state.rows.length && empty) {
    return <Text style={styles.apiNotice}>{empty}</Text>;
  }
  return null;
}

const GEMINI_API_KEY =
  process.env.EXPO_PUBLIC_GEMINI_API_KEY ||
  process.env.GEMINI_API_KEY ||
  process.env.gemkini_api_key ||
  process.env.GEMKINI_API_KEY ||
  '';

const genAI = GEMINI_API_KEY ? new GoogleGenAI({ apiKey: GEMINI_API_KEY }) : null;
const GEMINI_TEXT_MODEL = 'gemma-4-31b-it';
const GEMINI_TTS_MODEL = 'gemini-3.1-flash-tts-preview';
const GEMINI_TEXT_CONFIG = {
  mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
  tools: [{ googleSearch: {} }],
};
const SHATHI_APA_SCOPE =
  'You are Shathi Apa, a helpful specialist for Bangladesh users on agriculture, farming, cattle, livestock, crops, plants, fruits, vegetables, fishery, feed, weather, farm disease, image-based farm analysis, market price, farm business, and Shathi projects. Answer all relevant questions in these domains. Introduce yourself only once at the start of a new live conversation; for follow-up chat messages answer naturally like a regular conversation without repeating your identity. If the user asks unrelated things, respond cordially and ask for a relevant agriculture, farming, livestock, weather, feed, or Shathi service question. Keep advice safe, practical, and concise.';

function mimeFromUri(uri: string, fallback = 'image/jpeg') {
  const clean = uri.split('?')[0].toLowerCase();
  if (clean.endsWith('.png')) return 'image/png';
  if (clean.endsWith('.webp')) return 'image/webp';
  if (clean.endsWith('.mp4') || clean.endsWith('.m4a')) return 'audio/mp4';
  if (clean.endsWith('.wav')) return 'audio/wav';
  if (clean.endsWith('.mp3')) return 'audio/mpeg';
  return fallback;
}

function bytesToBase64(bytes: Uint8Array) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let output = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const b = bytes[index + 1] ?? 0;
    const c = bytes[index + 2] ?? 0;
    const triplet = (a << 16) | (b << 8) | c;
    output += alphabet[(triplet >> 18) & 63];
    output += alphabet[(triplet >> 12) & 63];
    output += index + 1 < bytes.length ? alphabet[(triplet >> 6) & 63] : '=';
    output += index + 2 < bytes.length ? alphabet[triplet & 63] : '=';
  }
  return output;
}

function base64ToBytes(base64: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const bytes: number[] = [];
  for (let index = 0; index < clean.length; index += 4) {
    const a = alphabet.indexOf(clean[index]);
    const b = alphabet.indexOf(clean[index + 1]);
    const c = alphabet.indexOf(clean[index + 2] ?? 'A');
    const d = alphabet.indexOf(clean[index + 3] ?? 'A');
    const triplet = (a << 18) | (b << 12) | ((c < 0 ? 0 : c) << 6) | (d < 0 ? 0 : d);
    bytes.push((triplet >> 16) & 255);
    if (clean[index + 2]) bytes.push((triplet >> 8) & 255);
    if (clean[index + 3]) bytes.push(triplet & 255);
  }
  return new Uint8Array(bytes);
}

function pcm16Base64ToWavBase64(pcmBase64: string, sampleRate = 24000, channels = 1) {
  const pcm = base64ToBytes(pcmBase64);
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);
  const writeString = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) header[offset + index] = value.charCodeAt(index);
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, pcm.length, true);
  const wav = new Uint8Array(header.length + pcm.length);
  wav.set(header);
  wav.set(pcm, header.length);
  return bytesToBase64(wav);
}

async function uriToInlineData(uri: string, fallbackMime = 'image/jpeg') {
  const response = await fetch(uri);
  const buffer = await response.arrayBuffer();
  return {
    data: bytesToBase64(new Uint8Array(buffer)),
    mimeType: mimeFromUri(uri, fallbackMime),
  };
}

function requireGenAI() {
  if (!genAI) {
    throw new Error('Gemini API key missing. Add gemkini_api_key or EXPO_PUBLIC_GEMINI_API_KEY to .env and restart Expo.');
  }
  return genAI;
}

function friendlyAiError(error: unknown, lang: Lang) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('@google/genai') || message.includes('conditional exports')) {
    return lang === 'bn'
      ? 'AI সংযোগের সেটআপ আপডেট করা হচ্ছে। অ্যাপ রিস্টার্ট করে আবার চেষ্টা করুন।'
      : 'AI connection setup was updated. Restart the app and try again.';
  }
  if (message.includes('Audio input modality') || message.includes('INVALID_ARGUMENT')) {
    return lang === 'bn'
      ? 'এই লাইভ মডেলে সরাসরি মাইক ইনপুট সীমিত। আপাতত নিচের চ্যাট বা ছবি ব্যবহার করুন, লাইভ উত্তর ভয়েসে চালু থাকবে।'
      : 'Direct mic input is limited for this live model. Use chat or image for now; live voice output remains enabled.';
  }
  if (message.includes('languageCodes')) {
    return lang === 'bn'
      ? 'লাইভ ভাষা সেটিং ঠিক করা হয়েছে। অ্যাপ রিলোড করে আবার চেষ্টা করুন।'
      : 'Live language setting was fixed. Reload the app and try again.';
  }
  return message;
}

function markdownInstruction(lang: Lang) {
  return `Use concise Markdown formatting in the answer: short headings with **bold**, bullet points for actions, and no long paragraphs. Reply in ${lang === 'bn' ? 'Bengali Bangla' : 'English'}.`;
}

async function askShathiApaText(question: string, lang: Lang, history: ChatMessage[] = []) {
  const response = await requireGenAI().models.generateContent({
    model: GEMINI_TEXT_MODEL,
    config: GEMINI_TEXT_CONFIG,
    contents: [
      ...history.slice(-8).map((message) => ({
        role: message.role,
        parts: [{ text: message.text }],
      })),
      {
        role: 'user',
        parts: [
          { text: `${SHATHI_APA_SCOPE}\n${markdownInstruction(lang)}\nUser question: ${question}` },
        ],
      },
    ],
  });
  return response.text || '';
}

async function askShathiApaImage(uri: string, lang: Lang) {
  const inlineData = await uriToInlineData(uri, 'image/jpeg');
  const response = await requireGenAI().models.generateContent({
    model: GEMINI_TEXT_MODEL,
    config: GEMINI_TEXT_CONFIG,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData },
          { text: `${SHATHI_APA_SCOPE}\n${markdownInstruction(lang)}\nAnalyze this new image only. Do not use previous image context. Identify whether it shows cattle, crops, vegetables, fruits, disease symptoms, or risk. If the image is unrelated to farming, say that clearly and ask for a relevant farm image.` },
        ],
      },
    ],
  });
  return response.text || '';
}

async function askShathiApaImageFollowup(uri: string, question: string, lang: Lang, history: ChatMessage[] = []) {
  const inlineData = await uriToInlineData(uri, 'image/jpeg');
  const response = await requireGenAI().models.generateContent({
    model: GEMINI_TEXT_MODEL,
    config: GEMINI_TEXT_CONFIG,
    contents: [
      ...history.slice(-8).map((message) => ({
        role: message.role,
        parts: [{ text: message.text }],
      })),
      {
        role: 'user',
        parts: [
          { inlineData },
          { text: `${SHATHI_APA_SCOPE}\n${markdownInstruction(lang)}\nUse the attached image and the prior chat context on this page to answer the follow-up.\nFollow-up question: ${question}` },
        ],
      },
    ],
  });
  return response.text || '';
}

async function generateResponseSuggestions(answer: string, lang: Lang, history: ChatMessage[] = []) {
  const response = await requireGenAI().models.generateContent({
    model: GEMINI_TEXT_MODEL,
    config: GEMINI_TEXT_CONFIG,
    contents: [
      ...history.slice(-6).map((message) => ({
        role: message.role,
        parts: [{ text: message.text }],
      })),
      {
        role: 'user',
        parts: [
          {
            text: `${SHATHI_APA_SCOPE}\nBased on the latest assistant answer below, generate exactly 3 short follow-up suggestion questions a farmer may tap next. Return only a JSON array of strings in ${lang === 'bn' ? 'Bengali Bangla' : 'English'}.\nLatest answer:\n${answer}`,
          },
        ],
      },
    ],
  });
  try {
    const parsed = parseJsonArray(response.text || '[]');
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string').slice(0, 3) : [];
  } catch {
    return [];
  }
}

async function withSuggestions(answer: string, lang: Lang, history: ChatMessage[]): Promise<ChatMessage> {
  try {
    const suggestions = await generateResponseSuggestions(answer, lang, history);
    return { role: 'model', text: answer, suggestions };
  } catch {
    return { role: 'model', text: answer };
  }
}

async function askShathiApaAudio(uri: string, lang: Lang) {
  const inlineData = await uriToInlineData(uri, 'audio/mp4');
  const response = await requireGenAI().models.generateContent({
    model: GEMINI_TEXT_MODEL,
    config: GEMINI_TEXT_CONFIG,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData },
          { text: `${SHATHI_APA_SCOPE}\n${markdownInstruction(lang)}\nTranscribe the user's farming question from this audio if needed, then answer as Shathi Apa. Keep the answer short and useful.` },
        ],
      },
    ],
  });
  return response.text || '';
}

async function askShathiApaAudioWithTranscript(uri: string, lang: Lang) {
  const inlineData = await uriToInlineData(uri, 'audio/mp4');
  const response = await requireGenAI().models.generateContent({
    model: GEMINI_TEXT_MODEL,
    config: GEMINI_TEXT_CONFIG,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData },
          {
            text: `${SHATHI_APA_SCOPE}\nTranscribe the user's voice question and answer it. Return only JSON with keys "transcript" and "answer". The transcript and answer must be in ${lang === 'bn' ? 'Bengali Bangla' : 'English'}. Use concise Markdown in the answer.`,
          },
        ],
      },
    ],
  });
  try {
    const parsed = parseJsonObject(response.text || '{}') as { transcript?: string; answer?: string };
    return {
      transcript: parsed.transcript || (lang === 'bn' ? 'ভয়েস থেকে প্রশ্নটি স্পষ্ট বোঝা যায়নি' : 'Voice transcript was unclear'),
      answer: parsed.answer || '',
    };
  } catch {
    return {
      transcript: lang === 'bn' ? 'ভয়েস থেকে প্রশ্নটি স্পষ্ট বোঝা যায়নি' : 'Voice transcript was unclear',
      answer: response.text || '',
    };
  }
}

function parseJsonObject(text: string) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i)?.[1];
  const raw = fenced || text.match(/\{[\s\S]*\}/)?.[0] || text;
  return JSON.parse(raw);
}

function parseJsonArray(text: string) {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i)?.[1];
  const raw = fenced || text.match(/\[[\s\S]*\]/)?.[0] || text;
  return JSON.parse(raw);
}

async function analyzeCattlePhoto(uri: string, lang: Lang): Promise<CattleAiResult> {
  const inlineData = await uriToInlineData(uri, 'image/jpeg');
  const response = await requireGenAI().models.generateContent({
    model: GEMINI_TEXT_MODEL,
    config: GEMINI_TEXT_CONFIG,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData },
          { text: `Analyze this new image only for a cattle sale listing form in Bangladesh. Do not use prior images or prior context. Return only JSON with keys: isCow boolean, ageMonths number|null, weightKg number|null, animalType string|null, breed string|null, count number|null, healthSummary string, accuracyPercent number. If the image is not clearly a cow/cattle, set isCow false, use null for unavailable cattle fields, set low accuracyPercent, and say "Please provide a clear cow image" in healthSummary. If details like age, weight, breed or type cannot be visually extracted, use null for those fields and explain uncertainty in healthSummary. Accuracy should be your confidence from 0 to 100.` },
        ],
      },
    ],
  });
  return parseJsonObject(response.text || '{}') as CattleAiResult;
}

function LangToggle({ subtle = false }: { subtle?: boolean }) {
  const { lang, toggleLang } = useLanguage();
  return (
    <Pressable onPress={toggleLang} style={[styles.langToggle, subtle && styles.langToggleSubtle]}>
      <Text style={[styles.langToggleText, subtle && styles.langToggleTextDark]}>{lang === 'bn' ? '文A' : 'অআ'}</Text>
    </Pressable>
  );
}

function AppButton({
  title,
  onPress,
  variant = 'primary',
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  variant?: 'primary' | 'gold' | 'outline';
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        variant === 'gold' && styles.goldButton,
        variant === 'outline' && styles.outlineButton,
        disabled && styles.buttonDisabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      <Text style={[styles.buttonText, variant === 'outline' && styles.outlineButtonText, disabled && styles.buttonTextDisabled]}>{title}</Text>
    </Pressable>
  );
}

function Header({
  title,
  onBack,
  right,
}: {
  title: string;
  onBack?: () => void;
  right?: string;
}) {
  return (
    <View style={styles.header}>
      {onBack ? (
        <Pressable onPress={onBack} style={styles.backButton}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
      ) : null}
      <Text style={styles.headerTitle}>{title}</Text>
      {right ? <Text style={styles.headerRight}>{right}</Text> : <View style={styles.headerSpacer} />}
    </View>
  );
}

function Badge({ label, tone = 'rose' }: { label: string; tone?: 'rose' | 'green' | 'gold' | 'blue' }) {
  const style = {
    rose: styles.badgeRose,
    green: styles.badgeGreen,
    gold: styles.badgeGold,
    blue: styles.badgeBlue,
  }[tone];
  return (
    <View style={[styles.badge, style]}>
      <Text style={[styles.badgeText, tone === 'green' && styles.badgeGreenText]}>{label}</Text>
    </View>
  );
}

function MarkdownText({
  text,
  style,
  strongStyle,
}: {
  text: string;
  style?: object;
  strongStyle?: object;
}) {
  const lines = text.split('\n').filter((line) => line.trim().length > 0);
  return (
    <>
      {lines.map((line, lineIndex) => {
        const trimmed = line.replace(/^#{1,4}\s*/, '').trim();
        const bullet = /^[-*•]\s+/.test(trimmed);
        const clean = trimmed.replace(/^[-*•]\s+/, '');
        const parts = clean.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
        return (
          <Text key={`${lineIndex}-${clean.slice(0, 8)}`} style={style}>
            {bullet ? '• ' : ''}
            {parts.map((part, index) => {
              const strong = part.startsWith('**') && part.endsWith('**');
              return (
                <Text key={`${index}-${part.slice(0, 6)}`} style={strong ? strongStyle : undefined}>
                  {strong ? part.slice(2, -2) : part}
                </Text>
              );
            })}
          </Text>
        );
      })}
    </>
  );
}

let activeTtsSound: Audio.Sound | null = null;

async function stopAiSpeech() {
  if (activeTtsSound) {
    await activeTtsSound.stopAsync().catch(() => undefined);
    await activeTtsSound.unloadAsync().catch(() => undefined);
    activeTtsSound = null;
  }
}

async function playAiSpeech(text: string, lang: Lang, onStart?: () => void, onEnd?: () => void) {
  await stopAiSpeech();
  onStart?.();
  try {
    const response = await requireGenAI().models.generateContent({
      model: GEMINI_TTS_MODEL,
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `Read this in a warm, clear female voice. Use ${lang === 'bn' ? 'Bengali Bangla' : 'English'} pronunciation. Do not add extra words.\n\n${text.replace(/\*\*/g, '')}`,
            },
          ],
        },
      ],
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Aoede' } } },
      },
    } as any);
    const inlineData = (response as any).candidates?.[0]?.content?.parts?.find((part: any) => part.inlineData)?.inlineData;
    const audioBase64 = inlineData?.data;
    const mimeType = inlineData?.mimeType || 'audio/wav';
    if (!audioBase64) throw new Error('No TTS audio returned.');
    const playableBase64 = mimeType.includes('wav') ? audioBase64 : pcm16Base64ToWavBase64(audioBase64);
    const created = await Audio.Sound.createAsync({ uri: `data:audio/wav;base64,${playableBase64}` }, { shouldPlay: true });
    activeTtsSound = created.sound;
    activeTtsSound.setOnPlaybackStatusUpdate((status) => {
      if ('didJustFinish' in status && status.didJustFinish) {
        stopAiSpeech().finally(() => onEnd?.());
      }
    });
  } catch (error) {
    onEnd?.();
    throw error;
  }
}

function toggleSpeech(text: string, lang: Lang = 'bn') {
  if (activeTtsSound) {
    stopAiSpeech();
    return;
  }
  playAiSpeech(text, lang).catch(() => undefined);
}

function Card({ children, style }: { children: React.ReactNode; style?: object }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

function Tile({
  icon,
  title,
  subtitle,
  onPress,
  selected,
}: {
  icon: string;
  title: string;
  subtitle?: string;
  onPress: () => void;
  selected?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.tile, selected && styles.tileSelected, pressed && styles.pressed]}>
      <Text style={styles.tileIcon}>{icon}</Text>
      <Text style={styles.tileTitle}>{title}</Text>
      {subtitle ? <Text style={styles.tileSub}>{subtitle}</Text> : null}
    </Pressable>
  );
}

function Shell({
  children,
  activeTab,
  setScreen,
  fixedAccessory,
}: {
  children: React.ReactNode;
  activeTab: MainTab;
  setScreen: (screen: Screen) => void;
  fixedAccessory?: React.ReactNode;
}) {
  const { tx } = useLanguage();
  const tabs: Array<{ id: MainTab; label: string; icon: string; screen: Screen }> = [
    { id: 'home', label: tx('হোম', 'Home'), icon: '⌂', screen: 'home' },
    { id: 'community', label: tx('কমিউনিটি', 'Community'), icon: '☷', screen: 'community' },
    { id: 'projects', label: tx('প্রকল্প', 'Projects'), icon: '▣', screen: 'projects' },
    { id: 'profile', label: tx('মেনু', 'Menu'), icon: '☰', screen: 'profile' },
  ];

  return (
    <View style={styles.shell}>
      <ScrollView contentContainerStyle={[styles.shellContent, fixedAccessory ? styles.shellContentWithAccessory : null]} showsVerticalScrollIndicator={false}>
        {children}
      </ScrollView>
      {fixedAccessory ? <View style={styles.fixedAccessory}>{fixedAccessory}</View> : null}
      <View style={styles.navBar}>
        {tabs.map((tab) => (
          <Pressable
            key={tab.id}
            onPress={() => setScreen(tab.screen)}
            style={[styles.navItem, activeTab === tab.id && styles.navItemActive]}
          >
            <Text style={styles.navIcon}>{tab.icon}</Text>
            <Text style={styles.navLabel}>{tab.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('onboarding');
  const [onboarding, setOnboarding] = useState(0);
  const [weight, setWeight] = useState('200');
  const [qty, setQty] = useState(2);
  const [lang, setLang] = useState<Lang>('bn');
  const [cattleImage, setCattleImage] = useState<string | null>(null);
  const [selectedPreferenceCategories, setSelectedPreferenceCategories] = useState<PreferenceKey[]>(['cattle']);
  const [livestockPrefs, setLivestockPrefs] = useState<string[]>(['cow']);
  const [cropPrefs, setCropPrefs] = useState<string[]>(['rice']);
  const [fishPrefs, setFishPrefs] = useState<string[]>(['rohu']);
  const [vegetablePrefs, setVegetablePrefs] = useState<string[]>(['tomato']);
  const [fruitPrefs, setFruitPrefs] = useState<string[]>(['mango']);
  const [selectedTrainingModule, setSelectedTrainingModule] = useState(0);
  const [trainingContentKind, setTrainingContentKind] = useState<TrainingContentKind>('article');
  const [apaMessages, setApaMessages] = useState<ChatMessage[]>([]);
  const [apaImageUri, setApaImageUri] = useState<string | null>(null);
  const [apaBusy, setApaBusy] = useState(false);
  const [apaDraftSuggestion, setApaDraftSuggestion] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<ApiRow | null>(null);
  const [latestOrder, setLatestOrder] = useState<ApiRow | null>(null);
  const [latestListing, setLatestListing] = useState<ApiRow | null>(null);
  const [latestApplication, setLatestApplication] = useState<ApiRow | null>(null);
  const [appLocation, setAppLocation] = useState<LocationState>({
    query: WEATHERAPI_LOCATION,
    label: 'Default location',
    loading: true,
    granted: false,
    error: null,
    fallback: true,
  });

  useEffect(() => {
    let alive = true;
    async function requestLocation() {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (!alive) return;
        if (permission.status !== 'granted') {
          setAppLocation({
            query: WEATHERAPI_LOCATION,
            label: 'Default location',
            loading: false,
            granted: false,
            error: lang === 'bn' ? 'লোকেশন অনুমতি না পাওয়ায় ডিফল্ট এলাকার আবহাওয়া দেখানো হচ্ছে।' : 'Location permission was not granted, so default-area weather is shown.',
            fallback: true,
          });
          return;
        }
        const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        if (!alive) return;
        const { latitude, longitude } = position.coords;
        setAppLocation({
          query: `${latitude},${longitude}`,
          label: `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`,
          loading: false,
          granted: true,
          error: null,
          fallback: false,
        });
      } catch (error) {
        if (!alive) return;
        setAppLocation({
          query: WEATHERAPI_LOCATION,
          label: 'Default location',
          loading: false,
          granted: false,
          error: naturalApiError(error, lang),
          fallback: true,
        });
      }
    }
    requestLocation();
    return () => {
      alive = false;
    };
  }, [lang]);

async function sendApaMessage(text: string) {
    const trimmed = text.trim();
    if (!trimmed || apaBusy) return;
    const userMessage: ChatMessage = { role: 'user', text: trimmed };
    const history = [...apaMessages, userMessage];
    setApaMessages(history);
    setApaBusy(true);
    try {
      const answer = apaImageUri
        ? await askShathiApaImageFollowup(apaImageUri, trimmed, lang, history)
        : await askShathiApaText(trimmed, lang, history);
      const finalAnswer = answer || (lang === 'bn' ? 'দুঃখিত, উত্তর পাওয়া যায়নি।' : 'Sorry, no answer was returned.');
      const modelMessage = await withSuggestions(finalAnswer, lang, history);
      setApaMessages((messages) => [...messages, modelMessage]);
      setApaDraftSuggestion('');
    } catch (error) {
      setApaMessages((messages) => [...messages, { role: 'model', text: error instanceof Error ? error.message : (lang === 'bn' ? 'AI সেবা চালু করা যায়নি।' : 'Could not start AI service.') }]);
    } finally {
      setApaBusy(false);
    }
  }

  async function sendApaImage(uri: string) {
    if (apaBusy) return;
    setApaImageUri(uri);
    const userMessage: ChatMessage = { role: 'user', text: lang === 'bn' ? 'ছবি সংযুক্ত করেছি।' : 'I attached an image.', imageUri: uri };
    const history = [...apaMessages, userMessage];
    setApaMessages(history);
    setApaBusy(true);
    try {
      const answer = await askShathiApaImage(uri, lang);
      const finalAnswer = answer || (lang === 'bn' ? 'ছবির বিশ্লেষণ পাওয়া যায়নি।' : 'No image analysis returned.');
      const modelMessage = await withSuggestions(finalAnswer, lang, history);
      setApaMessages((messages) => [...messages, modelMessage]);
    } catch (error) {
      setApaMessages((messages) => [...messages, { role: 'model', text: friendlyAiError(error, lang) }]);
    } finally {
      setApaBusy(false);
    }
  }

  async function sendApaVoice(uri: string) {
    if (apaBusy) return;
    setApaBusy(true);
    try {
      const voice = await askShathiApaAudioWithTranscript(uri, lang);
      const userMessage: ChatMessage = { role: 'user', text: voice.transcript };
      const history = [...apaMessages, userMessage];
      setApaMessages(history);
      const answer = voice.answer;
      const finalAnswer = answer || (lang === 'bn' ? 'ভয়েস থেকে উত্তর পাওয়া যায়নি।' : 'No answer returned from voice.');
      const modelMessage = await withSuggestions(finalAnswer, lang, history);
      setApaMessages((messages) => [...messages, modelMessage]);
    } catch (error) {
      setApaMessages((messages) => [...messages, { role: 'model', text: friendlyAiError(error, lang) }]);
    } finally {
      setApaBusy(false);
    }
  }

  const go = (next: Screen) => setScreen(next);
  const routeForPreference = (key: PreferenceKey): Screen => {
    const routes: Record<PreferenceKey, Screen> = {
      cattle: 'prefLivestock',
      crops: 'prefCrops',
      fishery: 'prefFish',
      vegetables: 'prefVegetable',
      fruits: 'prefFruits',
    };
    return routes[key];
  };
  const nextPreferenceScreen = (current?: PreferenceKey): Screen => {
    if (selectedPreferenceCategories.length === 0) return 'home';
    const currentIndex = current ? selectedPreferenceCategories.indexOf(current) : -1;
    const nextKey = selectedPreferenceCategories[currentIndex + 1];
    return nextKey ? routeForPreference(nextKey) : 'home';
  };
  const previousPreferenceScreen = (current: PreferenceKey): Screen => {
    const currentIndex = selectedPreferenceCategories.indexOf(current);
    const previousKey = selectedPreferenceCategories[currentIndex - 1];
    return previousKey ? routeForPreference(previousKey) : 'prefAnimal';
  };
  const preferenceStep = (key?: PreferenceKey) => {
    const total = 1 + selectedPreferenceCategories.length;
    const current = key ? selectedPreferenceCategories.indexOf(key) + 2 : 1;
    return { current, total };
  };
  const languageValue = useMemo(
    () => ({
      lang,
      setLang,
      toggleLang: () => setLang((current) => (current === 'bn' ? 'en' : 'bn')),
      tx: (bnText: string, enText: string) => (lang === 'bn' ? bnText : enText),
    }),
    [lang],
  );
  const activeTab: MainTab =
    screen === 'community' ? 'community' : screen === 'projects' ? 'projects' : screen === 'profile' ? 'profile' : 'home';

  const content = useMemo(() => {
    const routes: Record<Screen, React.ReactNode> = {
      onboarding: (
        <Onboarding
          step={onboarding}
          onNext={() => (onboarding === 0 ? setOnboarding(1) : go('login'))}
          onBack={() => setOnboarding(0)}
        />
      ),
      shathiApa: <ShathiApa setScreen={go} messages={apaMessages} busy={apaBusy} onAsk={sendApaMessage} setDraftSuggestion={setApaDraftSuggestion} />,
      apaVoice: <ApaVoice setScreen={go} />,
      apaCamera: <ApaCamera setScreen={go} />,
      login: <Login onLogin={() => go('prefAnimal')} />,
      prefAnimal: (
        <PreferenceAnimal
          selected={selectedPreferenceCategories}
          onChange={setSelectedPreferenceCategories}
          onNext={() => go(nextPreferenceScreen())}
          onSkip={() => go('home')}
          step={preferenceStep()}
        />
      ),
      prefLivestock: (
        <PreferenceLivestock
          selected={livestockPrefs}
          onChange={setLivestockPrefs}
          onNext={() => go(nextPreferenceScreen('cattle'))}
          onBack={() => go(previousPreferenceScreen('cattle'))}
          onSkip={() => go('home')}
          step={preferenceStep('cattle')}
          isFinal={nextPreferenceScreen('cattle') === 'home'}
        />
      ),
      prefCrops: (
        <PreferenceCrops
          selected={cropPrefs}
          onChange={setCropPrefs}
          onNext={() => go(nextPreferenceScreen('crops'))}
          onBack={() => go(previousPreferenceScreen('crops'))}
          onSkip={() => go('home')}
          step={preferenceStep('crops')}
          isFinal={nextPreferenceScreen('crops') === 'home'}
        />
      ),
      prefFish: (
        <PreferenceFish
          selected={fishPrefs}
          onChange={setFishPrefs}
          onNext={() => go(nextPreferenceScreen('fishery'))}
          onBack={() => go(previousPreferenceScreen('fishery'))}
          onSkip={() => go('home')}
          step={preferenceStep('fishery')}
          isFinal={nextPreferenceScreen('fishery') === 'home'}
        />
      ),
      prefVegetable: (
        <PreferenceVegetable
          selected={vegetablePrefs}
          onChange={setVegetablePrefs}
          onNext={() => go(nextPreferenceScreen('vegetables'))}
          onBack={() => go(previousPreferenceScreen('vegetables'))}
          onSkip={() => go('home')}
          step={preferenceStep('vegetables')}
          isFinal={nextPreferenceScreen('vegetables') === 'home'}
        />
      ),
      prefFruits: (
        <PreferenceFruits
          selected={fruitPrefs}
          onChange={setFruitPrefs}
          onNext={() => go('home')}
          onBack={() => go(previousPreferenceScreen('fruits'))}
          step={preferenceStep('fruits')}
          isFinal
        />
      ),
      home: <Home setScreen={go} />,
      weather: <WeatherPage setScreen={go} />,
      community: <Community setScreen={go} />,
      projects: <Projects setScreen={go} />,
      profile: <Profile setScreen={go} />,
      saleCategories: <SaleCategories setScreen={go} />,
      livestock: <Livestock setScreen={go} />,
      cattleForm: <CattleForm setScreen={go} weight={weight} setWeight={setWeight} imageUri={cattleImage} setImageUri={setCattleImage} />,
      cattlePrice: <CattlePrice setScreen={go} weight={weight} setWeight={setWeight} onSubmitted={setLatestListing} />,
      cattleDone: <CattleDone setScreen={go} listing={latestListing} />,
      buyCategories: <BuyCategories setScreen={go} />,
      buyProducts: <BuyProducts setScreen={go} onSelectProduct={setSelectedProduct} />,
      buyOrder: <BuyOrder setScreen={go} qty={qty} setQty={setQty} product={selectedProduct} onOrdered={setLatestOrder} />,
      buyDone: <BuyDone setScreen={go} qty={qty} product={selectedProduct} order={latestOrder} />,
      training: <Training setScreen={go} setSelectedModule={setSelectedTrainingModule} />,
      trainingDetail: (
        <TrainingModuleDetail
          setScreen={go}
          moduleIndex={selectedTrainingModule}
          setContentKind={setTrainingContentKind}
        />
      ),
      trainingArticle: <TrainingContentPage setScreen={go} moduleIndex={selectedTrainingModule} kind="article" />,
      trainingVideo: <TrainingContentPage setScreen={go} moduleIndex={selectedTrainingModule} kind="video" />,
      partnerRegister: <PartnerRegister setScreen={go} />,
      kyc: <Kyc setScreen={go} onSubmitted={setLatestApplication} />,
      regDone: <RegDone setScreen={go} application={latestApplication} />,
      inactive: <Inactive setScreen={go} />,
    };

    return routes[screen];
  }, [screen, onboarding, weight, qty, cattleImage, selectedPreferenceCategories, livestockPrefs, cropPrefs, fishPrefs, vegetablePrefs, fruitPrefs, selectedTrainingModule, trainingContentKind, apaMessages, apaImageUri, apaBusy, lang, selectedProduct, latestOrder, latestListing, latestApplication]);

  const authScreens: Screen[] = ['onboarding', 'login', 'prefAnimal', 'prefLivestock', 'prefCrops', 'prefFish', 'prefVegetable', 'prefFruits', 'apaVoice', 'apaCamera'];

  return (
    <LanguageContext.Provider value={languageValue}>
      <LocationContext.Provider value={appLocation}>
        <SafeAreaView
          style={[
            styles.safe,
            { paddingTop: androidStatusBarInset },
            screen === 'onboarding' && styles.safeOnboarding,
          ]}
        >
          <ExpoStatusBar
            style={screen === 'onboarding' ? 'light' : 'dark'}
            backgroundColor={screen === 'onboarding' ? colors.maroon : colors.card}
            translucent={false}
          />
          {authScreens.includes(screen) ? (
            content
          ) : (
            <Shell activeTab={activeTab} setScreen={go} fixedAccessory={screen === 'shathiApa' ? <ApaInputBar onAsk={sendApaMessage} onImage={sendApaImage} onVoice={sendApaVoice} busy={apaBusy} draftSuggestion={apaDraftSuggestion} clearDraftSuggestion={() => setApaDraftSuggestion('')} /> : undefined}>
              {content}
            </Shell>
          )}
        </SafeAreaView>
      </LocationContext.Provider>
    </LanguageContext.Provider>
  );
}

function Onboarding({ step, onNext, onBack }: { step: number; onNext: () => void; onBack: () => void }) {
  const { tx } = useLanguage();
  const slides = [
    {
      title: tx('আপনার টেকসই বৃদ্ধির সহযাত্রী', 'Your Partner in Sustainable Growth.'),
      body: tx(
        'শাথী সেবার সাথে, টেকসই কৃষি আপনার হাতের মুঠোয়। খামার পরিচালনা উন্নত করুন এবং নতুন আয়ের পথ অন্বেষণ করুন।',
        'With Shathi Sheba, sustainable agriculture is at your fingertips. Improve farm management and explore new income streams.',
      ),
    },
    {
      title: tx('কৃষকদের ক্ষমতায়ন, কৃষি রূপান্তর', 'Empowering Farmers, Transforming Agriculture.'),
      body: tx(
        'ডিজিটাল কৃষি বিপ্লবে যোগ দিন। উৎপাদনশীলতা বাড়াতে এবং আয় উন্নত করতে উপযুক্ত প্রকল্পগুলোতে প্রবেশ করুন।',
        'Join the digital farming revolution with Shathi Sheba. Access tailored projects to boost productivity and enhance your livelihood.',
      ),
    },
  ];

  return (
    <View style={styles.onboarding}>
      <View style={styles.lang}>
        <LangToggle />
      </View>
      <View style={styles.onboardingCopy}>
        <Text style={styles.onboardingTitle}>{slides[step].title}</Text>
        <Text style={styles.onboardingBody}>{slides[step].body}</Text>
        <View style={styles.onboardingFooter}>
          {step > 0 ? (
            <Pressable onPress={onBack}>
              <Text style={styles.slideBack}>‹</Text>
            </Pressable>
          ) : (
            <View style={styles.dotSpacer} />
          )}
          <View style={styles.dots}>
            <View style={[styles.dot, step === 0 && styles.dotActive]} />
            <View style={[styles.dot, step === 1 && styles.dotActive]} />
          </View>
          <Pressable onPress={onNext} style={styles.nextCircle}>
            <Text style={styles.nextText}>›</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function Login({ onLogin }: { onLogin: () => void }) {
  const { tx } = useLanguage();
  return (
    <View style={styles.authScreen}>
      <View style={styles.authLang}>
        <LangToggle subtle />
      </View>
      <Card style={styles.loginCard}>
        <Text style={styles.loginTitle}>{tx('শাথী সেবায় স্বাগতম', 'Welcome to Shathi Sheba')}</Text>
        <Text style={styles.loginSub}>{tx('চলিয়ে যেতে তথ্য দিন', 'Enter your credentials to continue')}</Text>
        <Text style={styles.label}>{tx('ইউজার নাম', 'Username')}</Text>
        <TextInput style={styles.input} placeholder={tx('ইউজার নাম লিখুন', 'Enter username')} placeholderTextColor={colors.muted} />
        <Text style={styles.label}>{tx('পাসওয়ার্ড', 'Password')}</Text>
        <TextInput style={styles.input} secureTextEntry placeholder={tx('পাসওয়ার্ড লিখুন', 'Enter password')} placeholderTextColor={colors.muted} />
        <AppButton title={tx('লগইন', 'Login')} onPress={onLogin} />
      </Card>
    </View>
  );
}

function LegacyPreferenceAnimal({ onNext }: { onNext: () => void }) {
  const { tx } = useLanguage();
  const items = [
    tx('গরু', 'Cattle'),
    tx('ছাগল', 'Goat'),
    tx('শস্য', 'Crops'),
    tx('মুরগি', 'Poultry'),
    tx('মাছ', 'Fishery'),
    tx('সবজি', 'Vegetables'),
    tx('ফল', 'Fruits'),
  ];
  const icons = ['🐄', '🐐', '🌾', '🐔', '🐟', '🥬', '🍎'];
  return (
    <View style={styles.prefScreen}>
      <Header title="" right={tx('এড়িয়ে যান', 'Skip')} />
      <View style={styles.prefLangCenter}><LangToggle subtle /></View>
      <Text style={styles.prefTitle}>{tx('কোন এলাকায় কাজ করেন?', 'What areas do you work with?')}</Text>
      <Text style={styles.prefSub}>{tx('আপনি একাধিক নির্বাচন করতে পারবেন', 'You can select multiple options')}</Text>
      <View style={styles.grid}>
        {items.map((item, index) => (
          <Tile key={item} icon={icons[index]} title={item} selected={index === 0} onPress={() => undefined} />
        ))}
      </View>
      <View style={styles.prefBottom}>
        <Text style={styles.prefHint}>{tx('আপনি পরে মেন থেকে পছন্দসমূহ আপডেট করতে পারবেন', 'You can update preferences later from the menu')}</Text>
        <AppButton title={tx('হোমপেজে যান', 'Proceed to Homepage')} onPress={onNext} />
      </View>
    </View>
  );
}

function LegacyPreferenceLivestock({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const { tx } = useLanguage();
  return (
    <PreferenceStep
      title={tx('কোন গবাদি পশুগুলো নিয়ে কাজ করেন?', 'What livestock do you work with?')}
      onBack={onBack}
      onNext={onNext}
      button={tx('চলিয়ে যান', 'Continue')}
      items={[
        ['🐄', tx('গরু', 'Cattle')],
        ['🐐', tx('ছাগল', 'Goat')],
        ['🦆', tx('হাঁস', 'Duck')],
      ]}
      selected={[0]}
    />
  );
}

function LegacyPreferenceFish({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const { tx } = useLanguage();
  return (
    <PreferenceStep
      title={tx('কোন মাছগুলো চাষ করেন?', 'What fish do you cultivate?')}
      onBack={onBack}
      onNext={onNext}
      button={tx('চলিয়ে যান', 'Continue')}
      items={[
        ['🐟', tx('রুই', 'Rohu')],
        ['🐟', tx('কাতলা', 'Catla')],
        ['🐟', tx('ইলিশ', 'Hilsa')],
        ['🐟', tx('পাঙ্গাস', 'Pangas')],
        ['🐟', tx('তেলাপিয়া', 'Tilapia')],
        ['🦐', tx('চিংড়ি', 'Prawn')],
      ]}
      selected={[2, 5]}
    />
  );
}

function LegacyPreferenceVegetable({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const { tx } = useLanguage();
  return (
    <PreferenceStep
      title={tx('কোন শাকসবজিগুলো চাষ করেন?', 'What vegetables do you cultivate?')}
      onBack={onBack}
      onNext={onNext}
      button={tx('সম্পূর্ণ করুন', 'Complete Setup')}
      items={[
        ['🫑', tx('লাউ', 'Bottle Gourd')],
        ['🥒', tx('পটল', 'Pointed Gourd')],
        ['🍅', tx('টমেটো', 'Tomato')],
        ['🥔', tx('আলু', 'Potato')],
        ['🫑', tx('মিষ্টি', 'Okra')],
        ['🫘', tx('কচু লতি', 'Green Beans')],
        ['🍆', tx('বেগুন', 'Eggplant')],
        ['🥒', tx('শসা', 'Cucumber')],
        ['🥒', tx('কাকরোল', 'Spiny Gourd')],
        ['🥬', tx('লেটুস', 'Lettuce')],
      ]}
      selected={[0, 3, 6]}
    />
  );
}

function PreferenceStep({
  title,
  items,
  selected,
  onBack,
  onNext,
  button,
}: {
  title: string;
  items: string[][];
  selected: number[];
  onBack: () => void;
  onNext: () => void;
  button: string;
}) {
  const { tx } = useLanguage();
  return (
    <View style={styles.prefScreen}>
      <Header title="" onBack={onBack} right={tx('এড়িয়ে যান', 'Skip')} />
      <View style={styles.prefLangCenter}><LangToggle subtle /></View>
      <Text style={styles.prefTitle}>{title}</Text>
      <Text style={styles.prefSub}>{tx('আপনি একাধিক নির্বাচন করতে পারবেন', 'You can select multiple options')}</Text>
      <View style={styles.grid}>
        {items.map(([icon, label], index) => (
          <Tile key={label} icon={icon} title={label} selected={selected.includes(index)} onPress={() => undefined} />
        ))}
      </View>
      <View style={styles.prefBottom}>
        <View style={styles.stepDots}>
          {[0, 1, 2, 3].map((dot) => (
            <View key={dot} style={[styles.stepDot, dot <= selected.length && styles.stepDotActive]} />
          ))}
        </View>
        <AppButton title={button} onPress={onNext} />
      </View>
    </View>
  );
}

function PreferenceAnimal({
  selected,
  onChange,
  onNext,
  onSkip,
  step,
}: {
  selected: PreferenceKey[];
  onChange: (keys: PreferenceKey[]) => void;
  onNext: () => void;
  onSkip: () => void;
  step: { current: number; total: number };
}) {
  const { tx, lang } = useLanguage();
  const items: Array<PreferenceOption & { id: PreferenceKey }> = [
    { id: 'cattle', icon: '🐄', label: tx('গবাদিপশু ও পোল্ট্রি', 'Cattle & Poultry') },
    { id: 'crops', icon: '🌾', label: tx('ফসল', 'Crops') },
    { id: 'fishery', icon: '🐟', label: tx('মৎস্য', 'Fishery') },
    { id: 'vegetables', icon: '🥬', label: tx('সবজি', 'Vegetables') },
    { id: 'fruits', icon: '🍎', label: tx('ফল', 'Fruits') },
  ];
  const toggle = (key: PreferenceKey) => {
    onChange(selected.includes(key) ? selected.filter((item) => item !== key) : preferenceOrder.filter((item) => item === key || selected.includes(item)));
  };
  return (
    <PreferenceSetupStep
      title={tx('আপনার আগ্রহের ক্ষেত্র বেছে নিন', 'Choose your areas of interest')}
      subtitle={tx('আপনার কাজের সাথে মিল আছে এমন এক বা একাধিক ক্ষেত্র নির্বাচন করুন', 'Select one or more areas that match your work')}
      sections={[{ title: tx('বিভাগ', 'Categories'), items }]}
      selected={selected}
      onChange={(items) => onChange(items as PreferenceKey[])}
      onToggle={(id) => toggle(id as PreferenceKey)}
      onNext={onNext}
      onSkip={onSkip}
      step={step}
    />
  );
}

function PreferenceLivestock(props: PreferencePageProps) {
  const { tx, lang } = useLanguage();
  return (
    <PreferenceSetupStep
      {...props}
      title={tx('আপনি কোন প্রাণী ও পোল্ট্রি নিয়ে কাজ করেন?', 'Choose your livestock and poultry')}
      subtitle={tx('গবাদিপশু ও পোল্ট্রি থেকে এক বা একাধিক নির্বাচন করুন', 'Select one or more livestock and poultry options')}
      sections={[
        {
          title: tx('গবাদিপশু', 'Livestock'),
          items: [
            { id: 'cow', icon: '🐄', label: tx('গরু', 'Cow') },
            { id: 'goat', icon: '🐐', label: tx('ছাগল', 'Goat') },
          ],
        },
        {
          title: tx('পোল্ট্রি', 'Poultry'),
          items: [
            { id: 'chicken', icon: '🐔', label: tx('মুরগি', 'Chicken') },
            { id: 'duck', icon: '🦆', label: tx('হাঁস', 'Duck') },
          ],
        },
      ]}
    />
  );
}

function PreferenceCrops(props: PreferencePageProps) {
  const { tx, lang } = useLanguage();
  return (
    <PreferenceSetupStep
      {...props}
      title={tx('আপনি কোন ফসল নিয়ে কাজ করেন?', 'Choose your crops')}
      subtitle={tx('আপনার জমি বা ব্যবসার সাথে সম্পর্কিত ফসল নির্বাচন করুন', 'Select crops related to your land or business')}
      sections={[
        {
          title: tx('ফসল', 'Crops'),
          items: [
            { id: 'rice', icon: '🌾', label: tx('ধান', 'Rice') },
            { id: 'corn', icon: '🌽', label: tx('ভুট্টা', 'Corn') },
            { id: 'wheat', icon: '🌾', label: tx('গম', 'Wheat') },
            { id: 'garlic', icon: '🧄', label: tx('রসুন', 'Garlic') },
            { id: 'onion', icon: '🧅', label: tx('পেঁয়াজ', 'Onion') },
            { id: 'mustard', icon: '🌼', label: tx('সরিষা', 'Mustard') },
            { id: 'turmeric', icon: '🫚', label: tx('হলুদ', 'Turmeric') },
            { id: 'chili', icon: '🌶️', label: tx('মরিচ', 'Chili') },
            { id: 'ginger', icon: '🫚', label: tx('আদা', 'Ginger') },
            { id: 'lentils', icon: '🫘', label: tx('মসুর ডাল', 'Lentils') },
            { id: 'soybean', icon: '🫘', label: tx('সয়াবিন', 'Soybean') },
            { id: 'betel', icon: '🍃', label: tx('পান', 'Betel') },
          ],
        },
      ]}
    />
  );
}

function PreferenceFish(props: PreferencePageProps) {
  const { tx } = useLanguage();
  return (
    <PreferenceSetupStep
      {...props}
      title={tx('আপনি কোন মাছ চাষ করেন?', 'Choose your fishery interests')}
      subtitle={tx('চাষ, বিক্রি বা পরামর্শের জন্য প্রযোজ্য মাছ নির্বাচন করুন', 'Select the fish you cultivate, sell, or need support for')}
      sections={[
        {
          title: tx('মাছ', 'Fishery'),
          items: [
            { id: 'rohu', icon: '🐟', label: tx('রুই', 'Rohu') },
            { id: 'catla', icon: '🐟', label: tx('কাতলা', 'Catla') },
            { id: 'hilsa', icon: '🐟', label: tx('ইলিশ', 'Hilsa') },
            { id: 'pangas', icon: '🐟', label: tx('পাঙ্গাস', 'Pangas') },
            { id: 'tilapia', icon: '🐟', label: tx('তেলাপিয়া', 'Tilapia') },
            { id: 'prawn', icon: '🦐', label: tx('চিংড়ি', 'Prawn') },
          ],
        },
      ]}
    />
  );
}

function PreferenceVegetable(props: PreferencePageProps) {
  const { tx } = useLanguage();
  return (
    <PreferenceSetupStep
      {...props}
      title={tx('আপনি কোন সবজি চাষ করেন?', 'Choose your vegetables')}
      subtitle={tx('আপনার উৎপাদন বা আগ্রহের সবজি নির্বাচন করুন', 'Select vegetables you produce or care about')}
      sections={[
        {
          title: tx('সবজি', 'Vegetables'),
          items: [
            { id: 'bottle-gourd', icon: '🥒', label: tx('লাউ', 'Bottle Gourd') },
            { id: 'pointed-gourd', icon: '🥒', label: tx('পটল', 'Pointed Gourd') },
            { id: 'tomato', icon: '🍅', label: tx('টমেটো', 'Tomato') },
            { id: 'potato', icon: '🥔', label: tx('আলু', 'Potato') },
            { id: 'okra', icon: '🫛', label: tx('ঢেঁড়স', 'Okra') },
            { id: 'green-beans', icon: '🫛', label: tx('বরবটি', 'Green Beans') },
            { id: 'eggplant', icon: '🍆', label: tx('বেগুন', 'Eggplant') },
            { id: 'cucumber', icon: '🥒', label: tx('শসা', 'Cucumber') },
            { id: 'spiny-gourd', icon: '🥒', label: tx('কাঁকরোল', 'Spiny Gourd') },
            { id: 'lettuce', icon: '🥬', label: tx('লেটুস', 'Lettuce') },
            { id: 'beans', icon: '🫘', label: tx('শিম', 'Beans') },
            { id: 'pumpkin', icon: '🎃', label: tx('কুমড়া', 'Pumpkin') },
            { id: 'leafy-greens', icon: '🥬', label: tx('শাক', 'Leafy Greens') },
          ],
        },
      ]}
    />
  );
}

function PreferenceFruits(props: PreferencePageProps) {
  const { tx } = useLanguage();
  return (
    <PreferenceSetupStep
      {...props}
      title={tx('আপনি কোন ফল নিয়ে কাজ করেন?', 'Choose your fruits')}
      subtitle={tx('উৎপাদন, বিক্রি বা সহায়তার জন্য ফল নির্বাচন করুন', 'Select fruits you produce, sell, or need support for')}
      sections={[
        {
          title: tx('ফল', 'Fruits'),
          items: [
            { id: 'mango', icon: '🥭', label: tx('আম', 'Mango') },
            { id: 'banana', icon: '🍌', label: tx('কলা', 'Banana') },
            { id: 'papaya', icon: '🍈', label: tx('পেঁপে', 'Papaya') },
            { id: 'lychee', icon: '🍒', label: tx('লিচু', 'Lychee') },
            { id: 'jackfruit', icon: '🍈', label: tx('কাঁঠাল', 'Jackfruit') },
            { id: 'watermelon', icon: '🍉', label: tx('তরমুজ', 'Watermelon') },
            { id: 'guava', icon: '🍐', label: tx('পেয়ারা', 'Guava') },
            { id: 'lemon', icon: '🍋', label: tx('লেবু', 'Lemon') },
          ],
        },
      ]}
    />
  );
}

type PreferencePageProps = {
  selected: string[];
  onChange: (items: string[]) => void;
  onBack?: () => void;
  onNext: () => void;
  onSkip?: () => void;
  step: { current: number; total: number };
  isFinal?: boolean;
};

function PreferenceSetupStep({
  title,
  subtitle,
  sections,
  selected,
  onChange,
  onBack,
  onNext,
  onSkip,
  step,
  isFinal = false,
  onToggle,
}: PreferencePageProps & {
  title: string;
  subtitle: string;
  sections: PreferenceSection[];
  onToggle?: (id: string) => void;
}) {
  const { tx } = useLanguage();
  const canProceed = selected.length > 0;
  const toggle = (id: string) => {
    if (onToggle) {
      onToggle(id);
      return;
    }
    onChange(selected.includes(id) ? selected.filter((item) => item !== id) : [...selected, id]);
  };
  return (
    <View style={styles.prefScreen}>
      <Header title="" onBack={onBack} />
      <View style={styles.prefLangCenter}><LangToggle subtle /></View>
      <ScrollView contentContainerStyle={styles.prefScrollContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.prefTitle}>{title}</Text>
        <Text style={styles.prefSub}>{subtitle}</Text>
        {sections.map((section) => (
          <View key={section.title} style={styles.prefSection}>
            <Text style={styles.prefSectionTitle}>{section.title}</Text>
            <View style={styles.prefGrid}>
              {section.items.map((item) => (
                <PreferenceOptionCard
                  key={item.id}
                  icon={item.icon}
                  title={item.label}
                  selected={selected.includes(item.id)}
                  onPress={() => toggle(item.id)}
                />
              ))}
            </View>
          </View>
        ))}
      </ScrollView>
      <View style={styles.prefBottom}>
        <Text style={styles.prefStepText}>{tx(`ধাপ ${bn(step.current)}/${bn(step.total)}`, `Step ${step.current}/${step.total}`)}</Text>
        <View style={styles.stepDots}>
          {Array.from({ length: step.total }).map((_, index) => (
            <View key={index} style={[styles.stepDot, index < step.current && styles.stepDotActive]} />
          ))}
        </View>
        <View style={[styles.prefActionRow, isFinal && styles.prefActionRowFinal]}>
          {!isFinal && onSkip ? (
            <Pressable onPress={onSkip} style={({ pressed }) => [styles.prefSkipButton, pressed && styles.pressed]}>
              <Text style={styles.prefSkipText}>{tx('এড়িয়ে যান', 'Skip')}</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={onNext}
            disabled={!canProceed}
            style={({ pressed }) => [
              styles.prefProceedButton,
              isFinal && styles.prefProceedButtonFinal,
              !canProceed && styles.prefProceedDisabled,
              pressed && canProceed && styles.pressed,
            ]}
          >
            <Text style={styles.prefProceedText}>{isFinal ? tx('সেভ করে এগিয়ে যান', 'Save and Continue') : tx('এগিয়ে যান', 'Proceed')}</Text>
          </Pressable>
        </View>
        <Text style={styles.prefSelectHint}>
          {canProceed ? tx(`${bn(selected.length)}টি নির্বাচন করা হয়েছে`, `${selected.length} selected`) : tx('এগোতে অন্তত একটি অপশন নির্বাচন করুন', 'Select at least one option to proceed')}
        </Text>
      </View>
    </View>
  );
}

function PreferenceOptionCard({
  icon,
  title,
  selected,
  onPress,
}: {
  icon: string;
  title: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.prefOption, selected && styles.prefOptionSelected, pressed && styles.pressed]}>
      <View style={[styles.prefOptionIconWrap, selected && styles.prefOptionIconWrapSelected]}>
        <Text style={styles.prefOptionIcon}>{icon}</Text>
      </View>
      <Text style={styles.prefOptionTitle}>{title}</Text>
      <View style={[styles.prefCheck, selected && styles.prefCheckActive]}>
        <Text style={styles.prefCheckText}>{selected ? '✓' : ''}</Text>
      </View>
    </Pressable>
  );
}

function Home({ setScreen }: { setScreen: (screen: Screen) => void }) {
  const { tx, lang } = useLanguage();
  const users = useApiList<ApiRow>('users');
  const liveWeather = useWeatherApi();
  const market = useApiList<ApiRow>('market-updates');
  const currentWeather = liveWeather.data?.current;
  const forecastDay = liveWeather.data?.forecast?.forecastday?.[0]?.day;
  const temp = currentWeather?.temp_c ?? 31;
  const humidity = currentWeather?.humidity ?? 40;
  const rainChance = forecastDay?.daily_chance_of_rain ?? currentWeather?.chance_of_rain ?? 0;
  const location = liveWeather.data?.location?.name;
  return (
    <>
      <BrandHeader setScreen={setScreen} />
      <Card style={styles.heroCard}>
        <Text style={styles.heroSmall}>{tx('আসসালামু আলাইকুম', 'Assalamu Alaikum')}</Text>
        <Text style={styles.heroName}>{users.rows[0]?.display_name || users.rows[0]?.full_name || tx('শাথী ব্যবহারকারী', 'Shathi user')} 👋</Text>
        <Pressable onPress={() => setScreen('weather')} style={({ pressed }) => [styles.weatherHomeCard, pressed && styles.pressed]}>
          <View style={styles.weatherHomeTop}>
            <View style={styles.weatherHomeIcon}>
              <Text style={styles.weatherHomeEmoji}>{weatherConditionIcon(currentWeather?.condition?.code, currentWeather?.is_day)}</Text>
            </View>
            <View style={styles.flex}>
              <Text style={styles.weatherHomeTitle}>{currentWeather?.condition?.text || tx('আজকের আবহাওয়া', "Today's Weather")}</Text>
              <Text style={styles.weatherHomeLocation}>⌖ {location || tx('আপনার এলাকা', 'Your area')}</Text>
            </View>
            <View style={styles.weatherHomeTemp}>
              <Text style={styles.weatherHomeTempText}>{num(temp, lang)}°C</Text>
              <Text style={styles.weatherHomeMeta}>{num(humidity, lang)}% {tx('আর্দ্রতা', 'humid')}</Text>
            </View>
          </View>
          <Text style={styles.weatherHomeAlert} numberOfLines={1}>{tx('বৃষ্টির সম্ভাবনা', 'Rain chance')}: {num(rainChance, lang)}%</Text>
          <WeatherSourceBadge fallback={liveWeather.usingFallback} error={liveWeather.error} />
        </Pressable>
        <View style={styles.heroStats}>
          <HeroStat value={num(12, lang)} label={tx('তালিকা', 'Listings')} />
          <HeroStat value={num(3, lang)} label={tx('অর্ডার', 'Orders')} />
          <HeroStat value={tx('৳৪.২L', '৳4.2L')} label={tx('মোট আয়', 'Earnings')} />
        </View>
      </Card>
      <SectionTitle title={tx('সেবাসমূহ', 'Services')} />
      <View style={styles.serviceGrid}>
        <ServiceCard icon="▣" title={tx('বিক্রির তালিকা', 'List for Sale')} sub={tx('পশু ও কৃষি পণ্য বিক্রি', 'Sell livestock & produce')} tone="rose" onPress={() => setScreen('saleCategories')} />
        <ServiceCard icon="🛒" title={tx('শাথী থেকে কিনুন', 'Buy from Shathi')} sub={tx('বীজ, ফিড, সার ও আরও', 'Seeds, feed, fertilizer & more')} tone="gold" onPress={() => setScreen('buyCategories')} />
        <ServiceCard icon="▱" title={tx('প্রশিক্ষণ মডিউল', 'Training Modules')} sub={tx('ভিডিও ও বিশেষজ্ঞ পরামর্শ', 'Videos & expert advice')} tone="blue" onPress={() => setScreen('training')} />
        <ServiceCard icon="♢" title={tx('শাথী পার্টনার', 'Shathi Partner')} sub={tx('চুক্তি চাষ ও ঋণ সংযোগ', 'Contract farming & loans')} tone="green" onPress={() => setScreen('partnerRegister')} />
      </View>
      <Pressable onPress={() => setScreen('shathiApa')} style={({ pressed }) => [styles.homeApaCard, pressed && styles.pressed]}>
        <View style={styles.homeApaIcon}>
          <View style={styles.homeApaLogo}>
            <View style={[styles.logoLeaf, styles.logoLeafGreen]} />
            <View style={[styles.logoLeaf, styles.logoLeafPurpleOne]} />
            <View style={[styles.logoLeaf, styles.logoLeafPurpleTwo]} />
          </View>
        </View>
        <View style={styles.flex}>
          <Text style={styles.homeApaKicker}>{tx('AI সহায়তা', 'AI Assistant')}</Text>
          <Text style={styles.homeApaTitle}>{tx('শাথী আপাকে জিজ্ঞেস করুন', 'Ask Shathi Apa')}</Text>
          <Text style={styles.homeApaSub}>{tx('দাম, আবহাওয়া, রোগ বা প্রকল্প নিয়ে দ্রুত উত্তর পান।', 'Get fast answers on price, weather, disease, or projects.')}</Text>
        </View>
        <Text style={styles.homeApaArrow}>›</Text>
      </Pressable>
      <SectionTitle title={tx('বাজার আপডেট', 'Market Updates')} right={tx('সব দেখুন', 'See all')} />
      <ApiStatus state={market} empty={tx('এখন কোনো বাজার আপডেট নেই।', 'No market updates are available right now.')} />
      {market.rows.slice(0, 3).map((item, index) => (
        <Alert
          key={item.id || index}
          title={rowTitle(item, lang, tx('বাজার আপডেট', 'Market update'))}
          sub={rowBody(item, lang, item.district || '')}
          badge={item.status || item.update_type || ''}
          gold={item.update_type === 'stock' || item.update_type === 'training'}
        />
      ))}
    </>
  );
}

function HeroStat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.heroStat}>
      <Text style={styles.heroStatValue}>{value}</Text>
      <Text style={styles.heroStatLabel}>{label}</Text>
    </View>
  );
}

function WeatherPage({ setScreen }: { setScreen: (screen: Screen) => void }) {
  const { tx, lang } = useLanguage();
  const appLocation = useAppLocation();
  const liveWeather = useWeatherApi();
  const adminWeather = useApiList<ApiRow>('weather');
  const weather = liveWeather.data;
  const current = weather?.current;
  const forecastDay = weather?.forecast?.forecastday?.[0]?.day;
  const weatherAlerts: ApiRow[] = weather?.alerts?.alert || [];
  const location = weather?.location?.name || tx('আপনার এলাকা', 'Your area');
  const temp = current?.temp_c ?? '--';
  const humidity = current?.humidity ?? '--';
  const wind = current?.wind_kph ?? '--';
  const rain = forecastDay?.daily_chance_of_rain ?? current?.chance_of_rain ?? '--';
  const pm25 = current?.air_quality?.pm2_5;
  const adminAlerts = adminWeather.rows;
  const forecastDays: ApiRow[] = weather?.forecast?.forecastday || [];

  return (
    <>
      <Header title={tx('আবহাওয়া আপডেট', 'Weather Update')} onBack={() => setScreen('home')} />
      <View style={styles.weatherBulletTicker}>
        <Text style={styles.weatherBulletText} numberOfLines={1}>
          {tx(
            weatherAlerts.map((item) => `• ${item.headline || item.event || 'আবহাওয়া সতর্কতা'}`).join('  ') || `• ${current?.condition?.text || 'আবহাওয়া আপডেট'}  • বৃষ্টির সম্ভাবনা ${num(rain, 'bn')}%  • ${bestHarvestAdvice(weather, 'bn')}`,
            weatherAlerts.map((item) => `• ${item.headline || item.event || 'Weather alert'}`).join('  ') || `• ${current?.condition?.text || 'Weather update'}  • Rain chance ${num(rain, 'en')}%  • ${bestHarvestAdvice(weather, 'en')}`,
          )}
        </Text>
      </View>
      {liveWeather.loading ? <Text style={styles.apiNotice}>{tx('WeatherAPI থেকে লাইভ আবহাওয়া আনা হচ্ছে...', 'Loading live weather from WeatherAPI...')}</Text> : null}
      <WeatherSourceBadge fallback={liveWeather.usingFallback} error={liveWeather.error} />
      <View style={styles.weatherHero}>
        <View style={styles.flex}>
          <Text style={styles.weatherLocation}>{location}</Text>
          <Text style={styles.weatherSummary}>{current?.condition?.text || tx('আবহাওয়া আপডেট', 'Weather update')}</Text>
          <Text style={styles.weatherHint}>{tx(`অনুভূত তাপমাত্রা ${num(current?.feelslike_c ?? '--', 'bn')}° · UV ${num(current?.uv ?? '--', 'bn')} · PM2.5 ${num(pm25 ? Math.round(pm25) : '--', 'bn')}`, `Feels like ${num(current?.feelslike_c ?? '--', 'en')}° · UV ${num(current?.uv ?? '--', 'en')} · PM2.5 ${num(pm25 ? Math.round(pm25) : '--', 'en')}`)}</Text>
          <Text style={styles.weatherHint}>{appLocation.granted ? tx('আপনার বর্তমান লোকেশন থেকে দেখানো হচ্ছে', 'Showing weather for your current location') : tx('ডিফল্ট লোকেশন থেকে দেখানো হচ্ছে', 'Showing weather from default location')}</Text>
        </View>
        <View style={styles.weatherTempBlock}>
          <Text style={styles.weatherSun}>{weatherConditionIcon(current?.condition?.code, current?.is_day)}</Text>
          <Text style={styles.weatherTemp}>{num(temp, lang)}°</Text>
        </View>
      </View>

      <View style={styles.weatherMetrics}>
        <WeatherMetric icon="💧" value={`${num(humidity, lang)}%`} label={tx('আর্দ্রতা', 'Humidity')} />
        <WeatherMetric icon="↗" value={`${num(wind, lang)} km/h`} label={tx('বাতাস', 'Wind')} />
        <WeatherMetric icon="🌧" value={`${num(rain, lang)}%`} label={tx('বৃষ্টির সম্ভাবনা', 'Rain chance')} />
      </View>

      <SectionTitle title={tx('৩ দিনের পূর্বাভাস', '3-Day Forecast')} />
      <View style={styles.forecastGrid}>
        {forecastDays.slice(0, 3).map((day, index) => (
          <View key={day.date || index} style={styles.forecastCard}>
            <Text style={styles.forecastDay}>{index === 0 ? tx('আজ', 'Today') : day.date}</Text>
            <Text style={styles.forecastIcon}>{weatherConditionIcon(day.day?.condition?.code, 1)}</Text>
            <Text style={styles.forecastTemp}>{num(Math.round(day.day?.maxtemp_c ?? 0), lang)}° / {num(Math.round(day.day?.mintemp_c ?? 0), lang)}°</Text>
            <Text style={styles.forecastMeta}>{tx('বৃষ্টি', 'Rain')}: {num(day.day?.daily_chance_of_rain ?? 0, lang)}%</Text>
            <Text style={styles.forecastMeta}>{tx('গড় আর্দ্রতা', 'Avg humidity')}: {num(day.day?.avghumidity ?? 0, lang)}%</Text>
          </View>
        ))}
      </View>

      <SectionTitle title={tx('গুরুত্বপূর্ণ সতর্কতা', 'Important Updates')} />
      {weatherAlerts.length ? weatherAlerts.map((alert, index) => (
        <Card key={alert.id || alert.event || index} style={styles.weatherAlert}>
          <View style={styles.weatherAlertIcon}>
            <Text style={styles.weatherAlertEmoji}>⚠</Text>
          </View>
          <View style={styles.flex}>
            <Text style={styles.weatherAlertTitle}>{alert.headline || alert.event || tx('আবহাওয়া সতর্কতা', 'Weather alert')}</Text>
            <Text style={styles.weatherAlertBody}>{alert.desc || alert.instruction || ''}</Text>
          </View>
        </Card>
      )) : (
        <Card style={styles.weatherAlert}>
          <View style={[styles.weatherAlertIcon, styles.weatherAlertGreen]}>
            <Text style={styles.weatherAlertEmoji}>✓</Text>
          </View>
          <View style={styles.flex}>
            <Text style={styles.weatherAlertTitle}>{tx('WeatherAPI সতর্কতা', 'WeatherAPI alerts')}</Text>
            <Text style={styles.weatherAlertBody}>{tx('এই মুহূর্তে WeatherAPI থেকে কোনো গুরুতর সতর্কতা পাওয়া যায়নি।', 'WeatherAPI is not reporting any severe alert right now.')}</Text>
          </View>
        </Card>
      )}
      {adminAlerts.map((alert, index) => (
        <Card key={alert.id || `admin-${index}`} style={styles.weatherAlert}>
          <View style={[styles.weatherAlertIcon, alert.severity === 'warning' && styles.weatherAlertGold, alert.severity === 'critical' && styles.weatherAlertBlue, alert.alert_type === 'field_advice' && styles.weatherAlertGreen]}>
            <Text style={styles.weatherAlertEmoji}>{alert.alert_type === 'maritime' ? '🌊' : alert.alert_type === 'field_advice' ? '🌾' : alert.alert_type === 'rain' ? '🌧' : '⛅'}</Text>
          </View>
          <View style={styles.flex}>
            <Text style={styles.weatherAlertTitle}>{rowTitle(alert, lang, tx('স্থানীয় পরামর্শ', 'Local advice'))}</Text>
            <Text style={styles.weatherAlertBody}>{rowBody(alert, lang, '')}</Text>
          </View>
        </Card>
      ))}
      {adminWeather.error ? <WeatherSourceBadge fallback error={adminWeather.error} /> : null}

      <SectionTitle title={tx('আজকের কাজের পরামর্শ', "Today's Field Advice")} />
      <View style={styles.adviceGrid}>
        <View style={styles.adviceCard}>
          <Text style={styles.adviceIcon}>🐄</Text>
          <Text style={styles.adviceTitle}>{tx('গবাদিপশু', 'Livestock')}</Text>
          <Text style={styles.adviceText}>{Number(current?.heatindex_c || 0) >= 36 ? tx('হিট ইনডেক্স বেশি। দুপুরে পরিষ্কার পানি ও ছায়া দিন।', 'Heat index is high. Provide clean water and shade at noon.') : tx('দুপুরে পরিষ্কার পানি দিন। ভেজা খাবার জমিয়ে রাখবেন না।', 'Give clean water at noon. Do not keep wet feed stored.')}</Text>
        </View>
        <View style={styles.adviceCard}>
          <Text style={styles.adviceIcon}>🥬</Text>
          <Text style={styles.adviceTitle}>{tx('সবজি ও ফল', 'Vegetables & fruits')}</Text>
          <Text style={styles.adviceText}>{bestHarvestAdvice(weather, lang)}</Text>
        </View>
      </View>
    </>
  );
}

function WeatherMetric({ icon, value, label }: { icon: string; value: string; label: string }) {
  return (
    <View style={styles.weatherMetric}>
      <Text style={styles.weatherMetricIcon}>{icon}</Text>
      <Text style={styles.weatherMetricValue}>{value}</Text>
      <Text style={styles.weatherMetricLabel}>{label}</Text>
    </View>
  );
}

function ShathiApa({
  setScreen,
  messages,
  busy,
  onAsk,
  setDraftSuggestion,
}: {
  setScreen: (screen: Screen) => void;
  messages: ChatMessage[];
  busy: boolean;
  onAsk: (text: string) => void;
  setDraftSuggestion: (text: string) => void;
}) {
  const { tx, lang } = useLanguage();
  const suggestions = [
    tx('আজ গরুর দাম কত?', 'Ask about cattle price today'),
    tx('কোন প্রকল্প চলছে?', 'What projects are running?'),
    tx('আজ বৃষ্টি হবে?', 'Will it rain today?'),
    tx('গরু বিক্রি করতে কী লাগবে?', 'What is needed to sell cattle?'),
  ];
  const hasMessages = messages.length > 0;

  return (
    <>
      <Header title={tx('শাথী আপা', 'Shathi Apa')} onBack={() => setScreen('home')} />
      <View style={[styles.apaHero, hasMessages && styles.apaHeroCompact]}>
        <View style={styles.apaAvatar}>
          <View style={styles.apaLogoMark}>
            <View style={[styles.logoLeaf, styles.logoLeafGreen]} />
            <View style={[styles.logoLeaf, styles.logoLeafPurpleOne]} />
            <View style={[styles.logoLeaf, styles.logoLeafPurpleTwo]} />
          </View>
        </View>
        <View style={hasMessages ? styles.flex : undefined}>
          <Text style={[styles.apaTitle, hasMessages && styles.apaTitleCompact]}>{tx('শাথী আপাকে জিজ্ঞেস করুন', 'Ask Shathi Apa')}</Text>
          <Text style={[styles.apaSubtitle, hasMessages && styles.apaSubtitleCompact]}>{tx('ভয়েস, ছবি বা চ্যাট দিয়ে প্রশ্ন করুন।', 'Ask with voice, image, or chat.')}</Text>
        </View>
      </View>
      <View style={[styles.apaActions, hasMessages && styles.apaActionsCompact]}>
        <Pressable onPress={() => setScreen('apaVoice')} style={({ pressed }) => [hasMessages ? styles.apaMiniAction : styles.apaActionPrimary, pressed && styles.pressed]}>
          <Text style={hasMessages ? styles.apaMiniActionIcon : styles.apaActionIcon}>🎙</Text>
          <Text style={hasMessages ? styles.apaMiniActionText : styles.apaActionTitle}>{tx('লাইভ', 'Live')}</Text>
        </Pressable>
        <Pressable onPress={() => setScreen('apaCamera')} style={({ pressed }) => [hasMessages ? styles.apaMiniAction : styles.apaActionSecondary, pressed && styles.pressed]}>
          <Text style={hasMessages ? styles.apaMiniActionIcon : styles.apaActionIcon}>📷</Text>
          <Text style={hasMessages ? styles.apaMiniActionText : styles.apaActionTitle}>{tx('ছবি', 'Image')}</Text>
        </Pressable>
      </View>
      {!hasMessages ? (
        <View style={styles.suggestionWrap}>
          {suggestions.map((item) => (
            <Pressable key={item} style={styles.suggestionBubble} onPress={() => onAsk(item)}>
              <Text style={styles.suggestionText}>{item}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {messages.length ? (
        <View style={styles.apaChatPreview}>
          {messages.slice(-4).map((message, index) => (
            <View key={`${message.role}-${index}-${message.text.slice(0, 8)}`} style={[styles.apaMessageBubble, message.role === 'user' ? styles.apaUserBubble : styles.apaModelBubble]}>
              <MarkdownText text={message.text} style={[styles.apaMessageText, message.role === 'user' && styles.apaUserText]} strongStyle={[styles.markdownStrong, message.role === 'user' && styles.apaUserText]} />
              {message.imageUri ? <Image source={{ uri: message.imageUri }} style={styles.chatAttachedImage} /> : null}
              {message.role === 'model' ? (
                <Pressable style={styles.speakerButton} onPress={() => toggleSpeech(message.text, lang)}>
                  <Text style={styles.speakerIcon}>🔊</Text>
                </Pressable>
              ) : null}
              {message.role === 'model' && index === messages.slice(-4).length - 1 && message.suggestions?.length ? (
                <View style={styles.responseSuggestionRow}>
                  {message.suggestions.map((item) => (
                    <Pressable key={item} style={styles.responseSuggestionBubble} onPress={() => onAsk(item)}>
                      <Text style={styles.responseSuggestionText}>{item}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          ))}
          {busy ? <Text style={styles.apaThinking}>{tx('শাথী আপা ভাবছে...', 'Shathi Apa is thinking...')}</Text> : null}
        </View>
      ) : null}
    </>
  );
}

function ApaInputBar({
  onAsk,
  onImage,
  onVoice,
  busy,
  draftSuggestion,
  clearDraftSuggestion,
}: {
  onAsk: (text: string) => void;
  onImage: (uri: string) => void;
  onVoice: (uri: string) => void;
  busy: boolean;
  draftSuggestion: string;
  clearDraftSuggestion: () => void;
}) {
  const { tx } = useLanguage();
  const [draft, setDraft] = useState('');
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const displayDraft = recording ? tx('শুনছে... শেষ হলে আবার মাইকে চাপ দিন', 'Listening... tap the mic again when done') : draft;
  useEffect(() => {
    if (draftSuggestion) {
      setDraft(draftSuggestion);
      clearDraftSuggestion();
    }
  }, [draftSuggestion, clearDraftSuggestion]);
  function submit() {
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    onAsk(text);
  }
  async function attachImage() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.72,
    });
    if (!result.canceled) {
      onImage(result.assets[0].uri);
    }
  }
  async function toggleVoice() {
    if (recording) {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      setRecording(null);
      if (uri) onVoice(uri);
      return;
    }
    const permission = await Audio.requestPermissionsAsync();
    if (!permission.granted) return;
    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
    const created = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
    setRecording(created.recording);
  }
  return (
    <View style={styles.apaInputBar}>
      <View style={styles.apaComposerTop}>
        <TextInput
          style={styles.apaTextInput}
          placeholder={tx('শাথী আপাকে জিজ্ঞেস করুন...', 'Ask Shathi Apa...')}
          placeholderTextColor={colors.muted}
          value={displayDraft}
          onChangeText={setDraft}
          editable={!busy && !recording}
          multiline
          textAlignVertical="top"
        />
      </View>
      <View style={styles.apaComposerBottom}>
        <View style={styles.apaComposerTools}>
          <Pressable style={styles.apaInputIconButton} onPress={attachImage} disabled={busy}>
            <Text style={styles.apaInputIcon}>📎</Text>
          </Pressable>
          <Pressable style={[styles.apaInputIconButton, recording && styles.apaInputIconButtonActive]} onPress={toggleVoice} disabled={busy}>
            <Text style={styles.apaInputIcon}>🎙</Text>
          </Pressable>
        </View>
        <Pressable style={[styles.apaSendButton, busy && styles.apaSendButtonDisabled]} onPress={submit} disabled={busy}>
          <Text style={styles.apaSendText}>{busy ? '…' : '›'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function ApaVoice({ setScreen }: { setScreen: (screen: Screen) => void }) {
  const { tx, lang } = useLanguage();
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [answer, setAnswer] = useState('');
  const [transcript, setTranscript] = useState('');
  const [busy, setBusy] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [liveStatus, setLiveStatus] = useState(tx('শাথী আপা প্রস্তুত', 'Shathi Apa ready'));
  const pulse = useRef(new Animated.Value(0)).current;
  const introduced = useRef(false);

  useEffect(() => {
    if (introduced.current) return;
    introduced.current = true;
    const intro = tx(
      'আমি শাথী আপা। কৃষি, গবাদি পশু, আবহাওয়া, রোগ, ফিড বা বাজারদর নিয়ে প্রশ্ন করুন।',
      'I am Shathi Apa. Ask about farming, livestock, weather, disease, feed, or market price.'
    );
    setAnswer(intro);
    playAiSpeech(intro, lang, () => setIsSpeaking(true), () => setIsSpeaking(false)).catch(() => setIsSpeaking(false));
  }, [lang, tx]);

  useEffect(() => {
    if (!isRecording && !isSpeaking) {
      pulse.stopAnimation();
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 860, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 0, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => {
      loop.stop();
    };
  }, [isRecording, isSpeaking, pulse]);

  async function toggleRecording() {
    if (activeTtsSound) {
      await stopAiSpeech();
      setIsSpeaking(false);
      setLiveStatus(tx('শুনছি...', 'Listening...'));
    }
    if (recording) {
      setBusy(true);
      try {
        await recording.stopAndUnloadAsync();
        const uri = recording.getURI();
        setRecording(null);
        setIsRecording(false);
        if (uri) {
          setLiveStatus(tx('কথা বুঝে নিচ্ছে...', 'Understanding your voice...'));
          const voice = await askShathiApaAudioWithTranscript(uri, lang);
          setTranscript(voice.transcript);
          const finalAnswer = voice.answer || tx('উত্তর পাওয়া যায়নি।', 'No answer returned.');
          setAnswer(finalAnswer);
          setLiveStatus(tx('শাথী আপা বলছে', 'Shathi Apa is speaking'));
          await playAiSpeech(finalAnswer, lang, () => setIsSpeaking(true), () => {
            setIsSpeaking(false);
            setLiveStatus(tx('আবার প্রশ্ন করতে মাইকে চাপ দিন', 'Tap mic to ask again'));
          });
        }
      } catch (error) {
        setAnswer(friendlyAiError(error, lang));
        setLiveStatus(tx('ভয়েস উত্তর পাওয়া যায়নি', 'Voice answer unavailable'));
      } finally {
        setBusy(false);
      }
      return;
    }
    const permission = await Audio.requestPermissionsAsync();
    if (!permission.granted) return;
    setTranscript(tx('শুনছে... শেষ হলে আবার মাইকে চাপ দিন', 'Listening... tap the mic again when done'));
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: true,
      playsInSilentModeIOS: true,
    });
    const created = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
    setRecording(created.recording);
    setIsRecording(true);
    setLiveStatus(tx('আপনার কথা শুনছে', 'Listening to you'));
  }

  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.45] });
  const ringOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 0] });
  const secondaryRingScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.22] });
  const subtitleLines = answer.split('\n').filter(Boolean).slice(0, 2).join('\n');

  return (
    <View style={styles.apaLiveScreen}>
      <Header title={tx('শাথী আপা', 'Shathi Apa')} onBack={() => setScreen('shathiApa')} />
      <View style={styles.voiceStage}>
        <View style={styles.liveBrandDot}>
          <View style={styles.apaLogoMark}>
            <View style={[styles.logoLeaf, styles.logoLeafGreen]} />
            <View style={[styles.logoLeaf, styles.logoLeafPurpleOne]} />
            <View style={[styles.logoLeaf, styles.logoLeafPurpleTwo]} />
          </View>
        </View>
        <Text style={styles.liveStatus}>{liveStatus}</Text>
        <Text style={styles.voiceTitle}>{busy ? tx('উত্তর তৈরি হচ্ছে...', 'Generating answer...') : isRecording ? tx('শুনছি', 'Listening') : isSpeaking ? tx('শাথী আপা বলছে', 'Shathi Apa speaking') : tx('লাইভ কথোপকথন', 'Live conversation')}</Text>
        <Text style={styles.voiceHint}>{tx('কৃষি, পশু, ফিড, আবহাওয়া, রোগ বা বাজারদর নিয়ে কথা বলুন', 'Talk about farming, livestock, feed, weather, disease, or market price')}</Text>
        <View style={styles.voiceOrbWrap}>
          {(isRecording || isSpeaking) ? (
            <>
              <Animated.View style={[styles.voicePulseRing, { opacity: ringOpacity, transform: [{ scale: ringScale }] }]} />
              <Animated.View style={[styles.voicePulseRingInner, { opacity: ringOpacity, transform: [{ scale: secondaryRingScale }] }]} />
            </>
          ) : null}
          <Pressable style={[styles.voiceCenterMic, isRecording && styles.voiceCenterMicListening, isSpeaking && styles.voiceCenterMicSpeaking]} onPress={toggleRecording} disabled={busy && !recording}>
            <Text style={styles.voiceCenterMicIcon}>{isSpeaking ? '◉' : '🎙'}</Text>
          </Pressable>
        </View>
        <Text style={styles.voiceTranscript}>{transcript}</Text>
        <Text numberOfLines={2} style={styles.voiceSubtitle}>{subtitleLines}</Text>
      </View>
      <View style={styles.voiceBottom}>
        <Pressable style={[styles.voiceMic, isRecording && styles.voiceMicActive]} onPress={toggleRecording} disabled={busy && !recording}>
          <Text style={styles.voiceMicIcon}>{isRecording ? '■' : '🎙'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function ApaCamera({ setScreen }: { setScreen: (screen: Screen) => void }) {
  const { tx, lang } = useLanguage();
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [recording, setRecording] = useState<Audio.Recording | null>(null);
  const displayDraft = recording ? tx('শুনছে... শেষ হলে আবার মাইকে চাপ দিন', 'Listening... tap the mic again when done') : draft;
  const [analyzing, setAnalyzing] = useState(false);
  async function analyzeSelectedImage(uri: string) {
    setAnalyzing(true);
    setMessages([]);
    try {
      const reply = await askShathiApaImage(uri, lang);
      const finalAnswer = reply || tx('ছবির বিশ্লেষণ পাওয়া যায়নি।', 'No image analysis returned.');
      const modelMessage = await withSuggestions(finalAnswer, lang, []);
      setMessages([modelMessage]);
    } catch (error) {
      setMessages([{ role: 'model', text: error instanceof Error ? error.message : tx('ছবি বিশ্লেষণ করা যায়নি।', 'Could not analyze image.') }]);
    } finally {
      setAnalyzing(false);
    }
  }
  async function sendFollowup() {
    const question = draft.trim();
    if (!question || !photoUri || analyzing) return;
    setDraft('');
    await sendImageQuestion(question);
  }
  async function sendImageQuestion(question: string) {
    if (!question || !photoUri || analyzing) return;
    const nextMessages: ChatMessage[] = [...messages, { role: 'user', text: question }];
    setMessages(nextMessages);
    setAnalyzing(true);
    try {
      const reply = await askShathiApaImageFollowup(photoUri, question, lang, nextMessages);
      const finalAnswer = reply || tx('উত্তর পাওয়া যায়নি।', 'No answer returned.');
      const modelMessage = await withSuggestions(finalAnswer, lang, nextMessages);
      setMessages((current) => [...current, modelMessage]);
    } catch (error) {
      setMessages((current) => [...current, { role: 'model', text: error instanceof Error ? error.message : tx('ফলোআপ উত্তর পাওয়া যায়নি।', 'Could not answer follow-up.') }]);
    } finally {
      setAnalyzing(false);
    }
  }
  async function toggleImageVoice() {
    if (recording) {
      await recording.stopAndUnloadAsync();
      const uri = recording.getURI();
      setRecording(null);
      if (uri && photoUri) {
        setAnalyzing(true);
        try {
          const voice = await askShathiApaAudioWithTranscript(uri, lang);
          setAnalyzing(false);
          await sendImageQuestion(voice.transcript);
        } catch (error) {
          setAnalyzing(false);
          setMessages((current) => [...current, { role: 'model', text: friendlyAiError(error, lang) }]);
        }
      }
      return;
    }
    const permission = await Audio.requestPermissionsAsync();
    if (!permission.granted) return;
    await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true });
    const created = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
    setRecording(created.recording);
  }
  async function openCamera() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      quality: 0.72,
    });
    if (!result.canceled) {
      const uri = result.assets[0].uri;
      setPhotoUri(uri);
      await analyzeSelectedImage(uri);
    }
  }
  async function pickImage() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.72,
    });
    if (!result.canceled) {
      const uri = result.assets[0].uri;
      setPhotoUri(uri);
      await analyzeSelectedImage(uri);
    }
  }

  return (
    <View style={styles.apaImageScreen}>
      <Header title={tx('শাথী আপা', 'Shathi Apa')} onBack={() => setScreen('shathiApa')} />
      <ScrollView contentContainerStyle={styles.apaImageContent} showsVerticalScrollIndicator={false}>
      <View style={styles.apaImageBrand}>
        <View style={styles.apaAvatar}>
          <View style={styles.apaLogoMark}>
            <View style={[styles.logoLeaf, styles.logoLeafGreen]} />
            <View style={[styles.logoLeaf, styles.logoLeafPurpleOne]} />
            <View style={[styles.logoLeaf, styles.logoLeafPurpleTwo]} />
          </View>
        </View>
        <View style={styles.flex}>
          <Text style={styles.apaImageTitle}>{tx('ছবি বিশ্লেষণ', 'Image Analysis')}</Text>
          <Text style={styles.apaImageSub}>{tx('ফসল, পশু, রোগ বা খামারের ছবি দিন। তারপর ফলোআপ প্রশ্ন করুন।', 'Attach a crop, livestock, disease, or farm image, then ask follow-up questions.')}</Text>
        </View>
      </View>
      <View style={styles.apaImagePreview}>
        {photoUri ? (
          <Image source={{ uri: photoUri }} style={styles.apaImagePhoto} />
        ) : (
          <>
            <Text style={styles.apaImageEmptyIcon}>📷</Text>
            <Text style={styles.apaImageEmptyTitle}>{tx('ছবি সংযুক্ত করুন', 'Attach image')}</Text>
            <Text style={styles.apaImageEmptySub}>{tx('ক্যামেরা বা গ্যালারি থেকে ছবি নিন', 'Use camera or gallery')}</Text>
          </>
        )}
      </View>
      <View style={styles.apaImageActions}>
        <Pressable style={styles.apaImageActionButton} onPress={pickImage} disabled={analyzing}>
          <Text style={styles.apaImageActionText}>{tx('গ্যালারি', 'Gallery')}</Text>
        </Pressable>
        <Pressable style={styles.apaImageActionButtonPrimary} onPress={openCamera} disabled={analyzing}>
          <Text style={styles.apaImageActionTextPrimary}>{tx('ক্যামেরা', 'Camera')}</Text>
        </Pressable>
      </View>
      <View style={styles.apaImageChat}>
        {messages.map((message, index) => (
          <View key={`${index}-${message.role}`} style={[styles.apaMessageBubble, message.role === 'user' ? styles.apaUserBubble : styles.apaModelBubble]}>
            <MarkdownText text={message.text} style={[styles.apaMessageText, message.role === 'user' && styles.apaUserText]} strongStyle={[styles.markdownStrong, message.role === 'user' && styles.apaUserText]} />
            {message.role === 'model' && message.suggestions?.length ? (
              <View style={styles.responseSuggestionRow}>
                {message.suggestions.map((item) => (
                  <Pressable key={item} style={styles.responseSuggestionBubble} onPress={() => sendImageQuestion(item)}>
                    <Text style={styles.responseSuggestionText}>{item}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </View>
        ))}
        {analyzing ? (
          <View style={styles.apaModelBubble}>
            <MarkdownText text={tx('**শাথী আপা বিশ্লেষণ করছে...**', '**Shathi Apa is analyzing...**')} style={styles.apaMessageText} strongStyle={styles.markdownStrong} />
          </View>
        ) : null}
      </View>
      </ScrollView>
      <View style={styles.apaImageInputBar}>
        <TextInput
          style={[styles.apaTextInput, styles.apaImageTextInput]}
          value={displayDraft}
          onChangeText={setDraft}
          editable={!!photoUri && !analyzing && !recording}
          placeholder={photoUri ? tx('এই ছবি নিয়ে প্রশ্ন করুন...', 'Ask about this image...') : tx('আগে ছবি সংযুক্ত করুন', 'Attach an image first')}
          placeholderTextColor={colors.muted}
          onSubmitEditing={sendFollowup}
          multiline
          textAlignVertical="top"
        />
        <Pressable style={[styles.apaInputIconButton, recording && styles.apaInputIconButtonActive, (!photoUri || analyzing) && styles.inputDisabled]} onPress={toggleImageVoice} disabled={!photoUri || analyzing}>
          <Text style={styles.apaInputIcon}>🎙</Text>
        </Pressable>
        <Pressable style={[styles.apaSendButton, (!photoUri || analyzing) && styles.apaSendButtonDisabled]} onPress={sendFollowup} disabled={!photoUri || analyzing}>
          <Text style={styles.apaSendText}>{analyzing ? '…' : '›'}</Text>
        </Pressable>
        </View>
    </View>
  );
}

function BrandHeader({ setScreen }: { setScreen?: (screen: Screen) => void }) {
  return (
    <View style={styles.brandHeader}>
      <View style={styles.brandLockup}>
        <View style={styles.shathiLogo}>
          <View style={[styles.logoLeaf, styles.logoLeafGreen]} />
          <View style={[styles.logoLeaf, styles.logoLeafPurpleOne]} />
          <View style={[styles.logoLeaf, styles.logoLeafPurpleTwo]} />
        </View>
        <Text style={styles.brandTitle}>Shathi Sheba</Text>
      </View>
      <View style={styles.brandActions}>
        <Pressable onPress={() => setScreen?.('shathiApa')} style={styles.brandIconButton}>
          <Text style={styles.geminiIcon}>✦</Text>
        </Pressable>
        <Text style={styles.brandActionIcon}>🔔</Text>
        <View style={styles.userAvatarMini}>
          <Text style={styles.userAvatarText}>R</Text>
        </View>
      </View>
    </View>
  );
}

function ServiceCard({
  icon,
  title,
  sub,
  tone,
  onPress,
}: {
  icon: string;
  title: string;
  sub: string;
  tone: 'rose' | 'gold' | 'blue' | 'green';
  onPress: () => void;
}) {
  const bg = tone === 'gold' ? colors.goldPale : tone === 'blue' ? colors.bluePale : tone === 'green' ? colors.greenPale : colors.rose;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.serviceCard, pressed && styles.pressed]}>
      <View style={[styles.serviceIcon, { backgroundColor: bg }]}>
        <Text style={styles.serviceIconText}>{icon}</Text>
      </View>
      <Text style={styles.serviceTitle}>{title}</Text>
      <Text style={styles.serviceSub}>{sub}</Text>
    </Pressable>
  );
}

function SectionTitle({ title, right }: { title: string; right?: string }) {
  return (
    <View style={styles.sectionRow}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {right ? <Text style={styles.sectionRight}>{right}</Text> : null}
    </View>
  );
}

function Alert({ title, sub, badge, gold }: { title: string; sub: string; badge: string; gold?: boolean }) {
  return (
    <Card style={styles.alert}>
      <View style={[styles.alertIcon, { backgroundColor: gold ? colors.goldPale : colors.rose }]}>
        <Text>{gold ? '⌁' : '↗'}</Text>
      </View>
      <View style={styles.flex}>
        <Text style={styles.alertTitle}>{title}</Text>
        <Text style={styles.alertSub}>{sub}</Text>
      </View>
      {badge ? <Badge label={badge} tone={gold ? 'gold' : 'green'} /> : null}
    </Card>
  );
}

function SaleCategories({ setScreen }: { setScreen: (screen: Screen) => void }) {
  const { tx, lang } = useLanguage();
  const categories = useApiList<ApiRow>('sale/categories');
  return (
    <>
      <Header title={tx('বিক্রির তালিকা করুন', 'List for Sale')} onBack={() => setScreen('home')} />
      <Text style={styles.pageHint}>{tx('আপনার পণ্যের বিভাগ বেছে নিন', 'Choose your product category')}</Text>
      <ApiStatus state={categories} empty={tx('বিক্রির কোনো বিভাগ পাওয়া যায়নি।', 'No sale categories are available.')} />
      <View style={styles.grid}>
        {categories.rows.map((category) => {
          const slug = String(category.slug || '').toLowerCase();
          return (
            <Tile
              key={category.id || slug}
              icon={slug.includes('livestock') ? '🐄' : slug.includes('crop') ? '🌾' : slug.includes('mach') ? '🚜' : '🌿'}
              title={rowTitle(category, lang, tx('বিভাগ', 'Category'))}
              subtitle={rowBody(category, lang, category.status || '')}
              onPress={() => setScreen(slug.includes('livestock') ? 'livestock' : 'inactive')}
            />
          );
        })}
      </View>
    </>
  );
}

function Livestock({ setScreen }: { setScreen: (screen: Screen) => void }) {
  const { tx, lang } = useLanguage();
  const items = useApiList<ApiRow>('sale/items');
  return (
    <>
      <Header title={tx('গবাদিপশু', 'Livestock')} onBack={() => setScreen('saleCategories')} right={tx('সক্রিয়', 'Active')} />
      <Text style={styles.pageHint}>{tx('কোন পশু তালিকা করতে চান?', 'Which animal would you like to list?')}</Text>
      <ApiStatus state={items} empty={tx('তালিকা করার মতো কোনো আইটেম পাওয়া যায়নি।', 'No sale items are available.')} />
      {items.rows.map((item) => {
        const slug = String(item.slug || item.name_en || '').toLowerCase();
        const isActive = item.status === 'active' && slug.includes('cattle');
        return (
        <Pressable key={item.id || slug} onPress={() => setScreen(isActive ? 'cattleForm' : 'inactive')} style={({ pressed }) => [styles.listItem, !isActive && styles.listItemInactive, pressed && styles.pressed]}>
          <Text style={styles.listIcon}>{slug.includes('cattle') ? '🐄' : slug.includes('goat') ? '🐐' : slug.includes('poultry') ? '🐔' : '🌾'}</Text>
          <View style={styles.flex}>
            <Text style={styles.listTitle}>{rowTitle(item, lang, tx('আইটেম', 'Item'))}</Text>
            <Text style={styles.listSub}>{rowBody(item, lang, item.status || '')}</Text>
          </View>
          <Badge label={isActive ? tx('সক্রিয়', 'Active') : tx('শীঘ্রই', 'Soon')} tone={isActive ? 'green' : 'gold'} />
          <Text style={styles.chevron}>›</Text>
        </Pressable>
      )})}
    </>
  );
}

function CattleForm({
  setScreen,
  weight,
  setWeight,
  imageUri,
  setImageUri,
}: {
  setScreen: (screen: Screen) => void;
  weight: string;
  setWeight: (value: string) => void;
  imageUri: string | null;
  setImageUri: (value: string | null) => void;
}) {
  const { tx, lang } = useLanguage();
  const breedState = useApiList<ApiRow>('sale/breeds');
  const [age, setAge] = useState(num(24, lang));
  const [count, setCount] = useState(num(1, lang));
  const [animalType, setAnimalType] = useState(tx('বলদ', 'Bull'));
  const [breed, setBreed] = useState(tx('ক্রস ফ্রিজিয়ান', 'Cross Friesian'));
  const [aiSummary, setAiSummary] = useState('');
  const [aiAccuracy, setAiAccuracy] = useState<number | null>(null);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const animalTypes = [tx('বলদ', 'Bull'), tx('গাভী', 'Cow'), tx('বাছুর', 'Calf'), tx('খাসি বলদ', 'Castrated bull')];
  const breeds = breedState.rows.length
    ? breedState.rows.filter((row) => row.is_active !== 0).map((row) => rowTitle(row, lang, row.name_en || row.name_bn || 'Breed'))
    : [tx('দেশি', 'Local'), tx('ক্রস ফ্রিজিয়ান', 'Cross Friesian'), tx('চট্টগ্রামের লাল গরু', 'Chittagong Red Cow'), tx('সাহিওয়াল', 'Sahiwal'), tx('ব্রাহমান ক্রস', 'Brahman Cross'), tx('হরিয়ানা', 'Hariana')];
  const earn = (Number(weight) || 0) * 670;
  async function pickImage() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.72,
    });
    if (!result.canceled) {
      const uri = result.assets[0].uri;
      setImageUri(uri);
      setAiAnalyzing(true);
      setAiSummary('');
      setAiAccuracy(null);
      try {
        const ai = await analyzeCattlePhoto(uri, lang);
        const accuracy = Math.max(0, Math.min(100, Math.round(ai.accuracyPercent ?? 0)));
        setAiAccuracy(accuracy);
        if (ai.isCow === false) {
          setAiSummary(ai.healthSummary || tx('এটি গরুর ছবি হিসেবে নিশ্চিত নয়। অনুগ্রহ করে পরিষ্কার গরুর ছবি দিন।', 'This does not look like a clear cow image. Please provide a clear cow image.'));
        } else {
          if (ai.ageMonths) setAge(num(ai.ageMonths, lang));
          if (ai.weightKg) setWeight(String(Math.round(ai.weightKg)));
          if (ai.count) setCount(num(ai.count, lang));
          if (ai.animalType) setAnimalType(ai.animalType);
          if (ai.breed) setBreed(ai.breed);
          setAiSummary(ai.healthSummary || tx('AI ছবি বিশ্লেষণ করে উপলব্ধ তথ্য পূরণ করেছে। অনিশ্চিত তথ্য আপনি বদলাতে পারবেন।', 'AI filled available details from the photo. You can adjust uncertain values.'));
        }
      } catch (error) {
        setAiAccuracy(0);
        setAiSummary(error instanceof Error ? error.message : tx('AI বিশ্লেষণ ব্যর্থ হয়েছে। অনুগ্রহ করে আবার পরিষ্কার গরুর ছবি দিন।', 'AI analysis failed. Please try again with a clear cow image.'));
      } finally {
        setAiAnalyzing(false);
      }
    }
  }

  return (
    <>
      <Header title={tx('গরু বিক্রির তালিকা', 'List Cattle for Sale')} onBack={() => setScreen('livestock')} />
      <View style={styles.infoBar}>
        <Text style={styles.infoText}>{tx('ⓘ গরুর ছবি আপলোড করুন। AI ছবি বিশ্লেষণ করে তথ্য পূরণ করবে, চাইলে আপনি বদলাতে পারবেন।', 'ⓘ Upload cattle photo. AI will analyze and prefill details; you can adjust any value.')}</Text>
      </View>
      <FormLabel label={tx('গরুর ছবি', 'Cattle photo')} />
      <Pressable onPress={pickImage} style={({ pressed }) => [styles.upload, imageUri && styles.uploadWithImage, pressed && styles.pressed]}>
        {imageUri ? (
          <>
            <Image source={{ uri: imageUri }} style={styles.uploadPreview} />
            <View style={styles.uploadOverlay}>
              <Text style={styles.uploadOverlayText}>{tx('AI বিশ্লেষণ সম্পন্ন · ছবি পরিবর্তন করুন', 'AI analysis complete · Change photo')}</Text>
            </View>
          </>
        ) : (
          <>
            <Text style={styles.uploadIcon}>▣</Text>
            <Text style={styles.uploadTitle}>{tx('ছবি তুলতে বা আপলোড করতে ট্যাপ করুন', 'Tap to upload cattle photo')}</Text>
            <Text style={styles.uploadSub}>JPG, PNG · max 5 MB</Text>
          </>
        )}
      </Pressable>
      {imageUri ? (
        <View style={styles.aiAnalysisCard}>
          <Text style={styles.aiAnalysisTitle}>{aiAnalyzing ? tx('AI ছবি বিশ্লেষণ করছে...', 'AI is analyzing photo...') : tx('AI অনুমান', 'AI estimate')}</Text>
          {aiAnalyzing ? (
            <View style={styles.aiProgressTrack}>
              <View style={styles.aiProgressFill} />
            </View>
          ) : null}
          {aiAccuracy !== null ? (
            <Text style={styles.aiAccuracyText}>{tx(`বিশ্লেষণের নির্ভুলতা: ${bn(aiAccuracy)}%`, `Analysis accuracy: ${aiAccuracy}%`)}</Text>
          ) : null}
          <MarkdownText
            text={aiSummary || tx('ছবি থেকে বয়স, ওজন, পশুর ধরন ও জাত অনুমান করা হচ্ছে।', 'Estimating age, weight, animal type and breed from the photo.')}
            style={styles.aiAnalysisText}
            strongStyle={styles.markdownStrong}
          />
        </View>
      ) : null}
      <View style={styles.twoCol}>
        <View style={styles.flex}>
          <FormLabel label={tx('বয়স (মাস)', 'Age (months)')} />
          <TextInput style={[styles.input, aiAnalyzing && styles.inputDisabled]} editable={!aiAnalyzing} value={age} onChangeText={setAge} keyboardType="number-pad" />
        </View>
        <View style={styles.flex}>
          <FormLabel label={tx('ওজন (কেজি)', 'Weight (kg)')} />
          <TextInput style={[styles.input, aiAnalyzing && styles.inputDisabled]} editable={!aiAnalyzing} value={weight} onChangeText={setWeight} keyboardType="number-pad" />
        </View>
      </View>
      <FormLabel label={tx('পশুর ধরন', 'Animal Type')} />
      <FakeSelect value={animalType} options={animalTypes} onChange={setAnimalType} disabled={aiAnalyzing} />
      <FormLabel label={tx('গরুর ধরন / জাত', 'Breed')} />
      <ApiStatus state={breedState} />
      <FakeSelect value={breed} options={breeds} onChange={setBreed} disabled={aiAnalyzing} />
      <FormLabel label={tx('পশুর সংখ্যা', 'Number of animals')} />
      <TextInput style={[styles.input, aiAnalyzing && styles.inputDisabled]} editable={!aiAnalyzing} value={count} onChangeText={setCount} keyboardType="number-pad" />
      {earn > 0 ? (
        <View style={styles.estimate}>
          <Text style={styles.estimateLabel}>{tx('আনুমানিক আয়', 'Estimated earning')}</Text>
          <Text style={styles.estimateValue}>{amount(earn, lang)}</Text>
        </View>
      ) : null}
      <AppButton title={tx('মূল্য বিবরণ দেখুন  →', 'View Price Breakdown  →')} onPress={() => setScreen('cattlePrice')} />
    </>
  );
}

function FormLabel({ label }: { label: string }) {
  return <Text style={styles.label}>{label}</Text>;
}

function FakeSelect({ value, options, onChange, disabled = false }: { value: string; options?: string[]; onChange?: (value: string) => void; disabled?: boolean }) {
  function cycleValue() {
    if (disabled || !options?.length || !onChange) return;
    const currentIndex = options.indexOf(value);
    onChange(options[(currentIndex + 1) % options.length]);
  }

  return (
    <Pressable disabled={disabled} onPress={cycleValue} style={({ pressed }) => [styles.fakeSelect, disabled && styles.inputDisabled, pressed && !disabled && styles.pressed]}>
      <Text style={styles.fakeSelectText}>{value}</Text>
      <Text style={styles.chevron}>⌄</Text>
    </Pressable>
  );
}

function CattlePrice({
  setScreen,
  weight,
  setWeight,
  onSubmitted,
}: {
  setScreen: (screen: Screen) => void;
  weight: string;
  setWeight: (value: string) => void;
  onSubmitted: (listing: ApiRow) => void;
}) {
  const { tx, lang } = useLanguage();
  const pricing = useApiList<ApiRow>('sale/pricing');
  const saleItems = useApiList<ApiRow>('sale/items');
  const breeds = useApiList<ApiRow>('sale/breeds');
  const [contactPhone, setContactPhone] = useState('01712-345678');
  const [addressText, setAddressText] = useState(tx('গ্রাম, উপজেলা, জেলা', 'Village, upazila, district'));
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const w = Number(weight) || 200;
  const rule = pricing.rows.find((row) => row.is_active !== 0) || {};
  const farmerRate = Number(rule.farmer_rate || 670);
  const b2bRate = Number(rule.b2b_market_rate || 0);
  const platformFee = Number(rule.platform_fee || 0);
  const logisticsFee = Number(rule.logistics_fee || 0);
  const vetFee = Number(rule.warehouse_vet_fee || 0);
  const rows: Array<[string, string, number]> = [
    [tx('B2B বাজার দর', 'B2B market rate'), tx('পাইকারি ক্রয় মূল্য', 'Wholesale buy rate'), b2bRate],
    [tx('নির্ধারিত বিক্রয় মূল্য', 'Nirdharito Bikroy Mullo'), tx('আপনি পাবেন এই মূল্যে', 'Your selling rate'), farmerRate],
    [tx('প্ল্যাটফর্ম চার্জ', 'Platform fee'), '', platformFee],
    [tx('লজিস্টিক্স ও পরিবহন', 'Logistics & transport'), '', logisticsFee],
    [tx('গুদাম ও পশু চিকিৎসা', 'Warehouse & vet care'), '', vetFee],
    [tx('মোট কর্তন', 'Total deductions'), '', platformFee + logisticsFee + vetFee],
  ];
  async function submitListing() {
    setSubmitting(true);
    setSubmitError('');
    try {
      const cattleItem = saleItems.rows.find((row) => String(row.slug || row.name_en || '').toLowerCase().includes('cattle')) || saleItems.rows[0];
      const breed = breeds.rows[0];
      const listingCode = `SAL-APP-${Date.now()}`;
      const response = await apiCreate('sale/listings', {
        listing_code: listingCode,
        user_id: 1,
        sale_item_id: Number(cattleItem?.id || 1),
        breed_id: breed?.id ? Number(breed.id) : undefined,
        title_en: 'Cattle listing from mobile app',
        title_bn: 'মোবাইল অ্যাপ থেকে গরুর তালিকা',
        weight_kg: w,
        quantity: 1,
        unit: 'piece',
        farmer_expected_price: farmerRate,
        estimated_earning: w * farmerRate,
        contact_phone: contactPhone,
        address_text: addressText,
        ai_analysis_json: { source: 'mobile_app', image_upload_pending: true },
        status: 'submitted',
      });
      onSubmitted({ listing_code: listingCode, id: response.result?.insertId, estimated_earning: w * farmerRate });
      setScreen('cattleDone');
    } catch (error) {
      setSubmitError(naturalApiError(error, lang));
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <>
      <Header title={tx('মূল্য ও আয়ের বিবরণ', 'Price & Earning')} onBack={() => setScreen('cattleForm')} />
      <Card style={styles.weightCard}>
        <Text style={styles.weightIcon}>⚖</Text>
        <View style={styles.flex}>
          <Text style={styles.smallUpper}>{tx('ওজন পরিবর্তন করুন', 'Adjust weight')}</Text>
          <View style={styles.weightInputRow}>
            <TextInput style={styles.weightInput} value={weight} onChangeText={setWeight} keyboardType="number-pad" />
            <Text style={styles.kgText}>{tx('কেজি', 'kg')}</Text>
          </View>
        </View>
        <View>
          <Text style={styles.miniMuted}>{tx('সম্ভাব্য আয়', 'Earning')}</Text>
          <Text style={styles.quickEarn}>{amount(w * farmerRate, lang)}</Text>
        </View>
      </Card>
      <View style={styles.priceTable}>
        <View style={styles.priceHead}>
          <Text style={styles.priceHeadTitle}>{tx('মূল্য বিবরণী', 'Price Breakdown')}</Text>
          <Text style={styles.priceHeadSub}>{tx('সব মূল্য প্রতি কেজি হিসেবে', 'All values per kg')}</Text>
        </View>
        <View style={styles.priceColumns}>
          <Text style={[styles.colLabel, styles.flex]}>{tx('বিবরণ', 'Item')}</Text>
          <Text style={styles.colLabel}>/kg</Text>
          <Text style={styles.colLabel}>{tx('মোট', 'Total')} ({num(w, lang)})</Text>
        </View>
        {rows.map(([title, sub, rate]) => (
          <View key={title} style={[styles.priceRow, (title === 'নির্ধারিত বিক্রয় মূল্য' || title === 'Nirdharito Bikroy Mullo') && styles.priceRowHighlight]}>
            <View style={styles.flex}>
              <Text style={[styles.priceTitle, (title === 'নির্ধারিত বিক্রয় মূল্য' || title === 'Nirdharito Bikroy Mullo') && styles.priceTitleStrong]}>{title}</Text>
              {sub ? <Text style={styles.priceSub}>{sub}</Text> : null}
            </View>
            <Text style={styles.rateText}>৳{num(rate, lang)}</Text>
            <Text style={styles.totalText}>{amount(Number(rate) * w, lang)}</Text>
          </View>
        ))}
        <View style={styles.finalRow}>
          <View style={styles.flex}>
            <Text style={styles.finalLabel}>{tx('আপনার আনুমানিক আয়', 'Your estimated earning')}</Text>
            <Text style={styles.finalSub}>৳{num(farmerRate, lang)} × {num(w, lang)} {tx('কেজি', 'kg')}</Text>
          </View>
          <Text style={styles.finalValue}>{amount(w * farmerRate, lang)}</Text>
        </View>
      </View>
      <View style={styles.noteBlue}>
        <Text style={styles.noteText}>{tx('মাঠ কর্মকর্তার পোর্টেবল স্কেলে যাচাইকৃত প্রকৃত ওজন অনুযায়ী চূড়ান্ত পেমেন্ট নির্ধারিত হবে।', "Final payment is set based on actual weight verified by the field officer's portable scale.")}</Text>
      </View>
      <View style={styles.noteGold}>
        <Text style={styles.noteText}>{tx('৩ কর্মদিনের মধ্যে মাঠ কর্মকর্তা আসবেন। সম্মতিতে ওজন নিশ্চিত হলে নগদ বা চেকে পেমেন্ট।', 'Field officer arrives within 3 working days. Cash or cheque payment after weight confirmation.')}</Text>
      </View>
      <View style={styles.contactSection}>
        <View style={styles.contactSectionHead}>
          <Text style={styles.contactSectionTitle}>{tx('যোগাযোগের তথ্য', 'Contact Information')}</Text>
          <Text style={styles.contactSectionHint}>{tx('মাঠ কর্মকর্তা এই তথ্য ব্যবহার করবেন', 'Field officer will use these details')}</Text>
        </View>
        <FormLabel label={tx('মোবাইল নম্বর', 'Mobile number')} />
        <TextInput style={styles.input} value={contactPhone} onChangeText={setContactPhone} keyboardType="phone-pad" />
        <FormLabel label={tx('ঠিকানা', 'Address')} />
        <TextInput style={styles.input} value={addressText} onChangeText={setAddressText} />
      </View>
      {submitError ? <Text style={styles.apiNotice}>{submitError}</Text> : null}
      <AppButton title={submitting ? tx('জমা হচ্ছে...', 'Submitting...') : tx('তালিকা নিশ্চিত করুন ✓', 'Confirm Listing ✓')} onPress={submitListing} disabled={submitting} />
      <AppButton title={tx('তথ্য পরিবর্তন করুন', 'Edit Details')} variant="outline" onPress={() => setScreen('cattleForm')} />
    </>
  );
}

function CattleDone({ setScreen, listing }: { setScreen: (screen: Screen) => void; listing: ApiRow | null }) {
  const { tx } = useLanguage();
  return (
    <SuccessScreen
      icon="✓"
      title={tx('তালিকা জমা হয়েছে!', 'Listing Submitted!')}
      refNo={listing?.listing_code || 'SHT-APP'}
      desc={tx('মাঠ কর্মকর্তা ৩ কর্মদিনের মধ্যে যোগাযোগ করবেন।', 'Field officer will contact you within 3 working days.')}
      action={() => setScreen('home')}
    >
      <Card style={styles.officerCard}>
        <Text style={styles.smallUpper}>{tx('নির্ধারিত মাঠ কর্মকর্তা', 'Assigned field officer')}</Text>
        <Text style={styles.officerName}>{tx('রানা হোসেন', 'Rana Hossain')}</Text>
        <Text style={styles.officerMeta}>☎ 01812-556677 · {tx('ময়মনসিংহ সদর', 'Mymensingh Sadar')}</Text>
      </Card>
    </SuccessScreen>
  );
}

function BuyCategories({ setScreen }: { setScreen: (screen: Screen) => void }) {
  const { tx, lang } = useLanguage();
  const categories = useApiList<ApiRow>('buy/categories');
  return (
    <>
      <Header title={tx('শাথী থেকে কিনুন', 'Buy from Shathi')} onBack={() => setScreen('home')} />
      <View style={styles.deliveryBanner}>
        <Text style={styles.deliveryText}>{tx('🚚 দ্রুত ডেলিভারি ১-৩ দিন · ৳৫০০+ অর্ডারে বিনামূল্যে', '🚚 Fast delivery 1-3 days · Free over ৳500')}</Text>
      </View>
      <SectionTitle title={tx('বিভাগ অনুযায়ী কিনুন', 'Shop by category')} />
      <ApiStatus state={categories} empty={tx('কেনার কোনো বিভাগ পাওয়া যায়নি।', 'No buying categories are available.')} />
      <View style={styles.grid}>
        {categories.rows.map((category) => (
          <Tile key={category.id || category.slug} icon="🌾" title={rowTitle(category, lang, tx('বিভাগ', 'Category'))} subtitle={rowBody(category, lang, '')} onPress={() => setScreen('buyProducts')} />
        ))}
      </View>
    </>
  );
}

function BuyProducts({ setScreen, onSelectProduct }: { setScreen: (screen: Screen) => void; onSelectProduct: (product: ApiRow) => void }) {
  const { tx, lang } = useLanguage();
  const products = useApiList<ApiRow>('buy/products');
  return (
    <>
      <Header title={tx('শাধীন ফিড', 'Seeds')} onBack={() => setScreen('buyCategories')} />
      <View style={styles.segment}>
        <Text style={styles.segmentActive}>{tx('কিনুন', 'Buy')}</Text>
        <Text style={styles.segmentInactive}>{tx('বিক্রি করুন', 'Sell')}</Text>
      </View>
      <ApiStatus state={products} empty={tx('কোনো পণ্য পাওয়া যায়নি।', 'No products are available.')} />
      {products.rows.map((product) => {
        const available = product.status === 'active';
        const lowStock = Number(product.stock_qty || 0) <= Number(product.low_stock_threshold || -1);
        return (
        <Pressable
          key={product.id || product.sku}
          disabled={!available}
          onPress={() => {
            onSelectProduct(product);
            setScreen('buyOrder');
          }}
          style={[styles.productCard, !available && styles.disabledCard]}
        >
          <Text style={styles.productIcon}>{String(product.name_en || '').toLowerCase().includes('fish') ? '🐟' : String(product.name_en || '').toLowerCase().includes('seed') ? '🌾' : '🐄'}</Text>
          <View style={styles.flex}>
            <Text style={styles.productTitle}>{rowTitle(product, lang, tx('পণ্য', 'Product'))}</Text>
            <Text style={styles.productSub}>{[product.package_size, rowBody(product, lang, '')].filter(Boolean).join(' · ')}</Text>
            <Badge label={!available ? tx('মজুদ নেই', 'Out of stock') : lowStock ? tx('কম মজুদ', 'Low stock') : tx('মজুদ আছে', 'In stock')} tone={available ? 'green' : 'rose'} />
            <Text style={[styles.productPrice, !available && styles.mutedPrice]}>{amount(Number(product.price || 0), lang)}<Text style={styles.unit}> /{product.unit || tx('বস্তা', 'sack')}</Text></Text>
          </View>
        </Pressable>
      )})}
    </>
  );
}

function BuyOrder({
  setScreen,
  qty,
  setQty,
  product,
  onOrdered,
}: {
  setScreen: (screen: Screen) => void;
  qty: number;
  setQty: (qty: number) => void;
  product: ApiRow | null;
  onOrdered: (order: ApiRow) => void;
}) {
  const { tx, lang } = useLanguage();
  const [address, setAddress] = useState(tx('চর নিলক্ষ্মিয়া, ময়মনসিংহ সদর', 'Char Nilakkhmiya, Mymensingh Sadar'));
  const [paymentMethod, setPaymentMethod] = useState('bkash');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const unitPrice = Number(product?.price || 0);
  const total = qty * unitPrice;
  const metadata = parseMaybeJson(product?.metadata);
  const features = Array.isArray(metadata.features) ? metadata.features : [];
  async function submitOrder() {
    if (!product) {
      setSubmitError(tx('অর্ডারের জন্য আগে একটি পণ্য নির্বাচন করুন।', 'Please select a product before placing an order.'));
      return;
    }
    setSubmitting(true);
    setSubmitError('');
    try {
      const orderCode = `ORD-APP-${Date.now()}`;
      const orderResponse = await apiCreate('buy/orders', {
        order_code: orderCode,
        user_id: 1,
        total_amount: total,
        delivery_fee: 0,
        payable_amount: total,
        payment_method: paymentMethod,
        payment_status: 'pending',
        fulfillment_status: 'placed',
        delivery_address: address,
        district: 'Mymensingh',
        upazila: 'Mymensingh Sadar',
        notes: 'Placed from mobile app.',
      });
      const orderId = orderResponse.result?.insertId;
      if (orderId) {
        await apiCreate('orders/items', {
          order_id: orderId,
          product_id: Number(product.id),
          quantity: qty,
          unit_price: unitPrice,
          line_total: total,
        });
      }
      onOrdered({ id: orderId, order_code: orderCode, payable_amount: total });
      setScreen('buyDone');
    } catch (error) {
      setSubmitError(naturalApiError(error, lang));
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <>
      <Header title={tx('অর্ডার দিন', 'Place Order')} onBack={() => setScreen('buyProducts')} />
      <Card style={styles.orderHeroCard}>
        <View style={styles.orderProductVisual}>
          <Text style={styles.orderProductEmoji}>🐄</Text>
          <Text style={styles.orderSackText}>{rowTitle(product || undefined, lang, tx('পণ্য', 'Product'))}</Text>
          <Text style={styles.orderSackWeight}>{product?.package_size || product?.unit || ''}</Text>
        </View>
        <View style={styles.orderHeroCopy}>
          <Badge label={tx('মজুদ আছে', 'In stock')} tone="green" />
          <Text style={styles.orderHeroTitle}>{rowTitle(product || undefined, lang, tx('পণ্য নির্বাচন করুন', 'Select a product'))}</Text>
          <Text style={styles.orderHeroSub}>{rowBody(product || undefined, lang, '')}</Text>
          <Text style={styles.productPrice}>{amount(unitPrice, lang)}<Text style={styles.unit}> /{product?.unit || tx('বস্তা', 'sack')}</Text></Text>
        </View>
      </Card>
      <Card style={styles.orderInfoCard}>
        <Text style={styles.orderSectionTitle}>{tx('পণ্যের বিবরণ', 'Product Description')}</Text>
        <Text style={styles.orderDescription}>
          {tx(
            rowBody(product || undefined, 'bn', 'পণ্যের বিবরণ সার্ভার থেকে পাওয়া যায়নি।'),
            rowBody(product || undefined, 'en', 'Product description is not available from the server.'),
          )}
        </Text>
        <View style={styles.orderFeatureRow}>
          <OrderFeature icon="⚖" title={product?.package_size || tx('প্যাকেজ', 'Package')} sub={product?.unit || tx('ইউনিট', 'unit')} />
          <OrderFeature icon="✦" title={features[0] || tx('মানসম্মত', 'Quality')} sub={features[1] || tx('সার্ভার ডাটা', 'server data')} />
          <OrderFeature icon="🚚" title={product?.delivery_window || tx('ডেলিভারি', 'Delivery')} sub={tx('সময়', 'window')} />
        </View>
      </Card>
      <Card style={styles.orderInfoCard}>
        <Text style={styles.label}>{tx('পরিমাণ', 'Quantity')}</Text>
        <View style={styles.qtyRow}>
          <Pressable style={styles.qtyBtn} onPress={() => setQty(Math.max(1, qty - 1))}>
            <Text style={styles.qtyText}>−</Text>
          </Pressable>
          <Text style={styles.qtyNumber}>{num(qty, lang)}</Text>
          <Pressable style={styles.qtyBtn} onPress={() => setQty(qty + 1)}>
            <Text style={styles.qtyText}>+</Text>
          </Pressable>
          <Text style={styles.qtyTotal}>{tx('মোট', 'Total')}: {amount(total, lang)}</Text>
        </View>
      </Card>
      <View style={styles.orderSummaryCard}>
        <Text style={styles.orderSectionTitle}>{tx('অর্ডার সারাংশ', 'Order Summary')}</Text>
        <View style={styles.orderSummaryRow}>
          <Text style={styles.orderSummaryLabel}>{tx('পণ্য মূল্য', 'Product price')}</Text>
          <Text style={styles.orderSummaryValue}>{amount(total, lang)}</Text>
        </View>
        <View style={styles.orderSummaryRow}>
          <Text style={styles.orderSummaryLabel}>{tx('ডেলিভারি', 'Delivery')}</Text>
          <Text style={styles.orderSummaryValue}>{tx('ফ্রি', 'Free')}</Text>
        </View>
        <View style={[styles.orderSummaryRow, styles.orderSummaryTotal]}>
          <Text style={styles.orderSummaryTotalText}>{tx('পরিশোধযোগ্য', 'Payable')}</Text>
          <Text style={styles.orderSummaryTotalText}>{amount(total, lang)}</Text>
        </View>
      </View>
      <FormLabel label={tx('ডেলিভারির ঠিকানা', 'Delivery address')} />
      <TextInput style={styles.input} value={address} onChangeText={setAddress} />
      <FormLabel label={tx('পেমেন্ট পদ্ধতি', 'Payment method')} />
      <FakeSelect value={paymentMethod} options={['cash', 'bkash', 'nagad', 'bank']} onChange={setPaymentMethod} />
      <View style={styles.noteGreen}>
        <Text style={styles.noteText}>{tx('✓ মজুদ নিশ্চিত · ডেলিভারি ২-৩ কর্মদিন', '✓ Stock confirmed · Delivery in 2-3 working days')}</Text>
      </View>
      {submitError ? <Text style={styles.apiNotice}>{submitError}</Text> : null}
      <AppButton title={submitting ? tx('অর্ডার জমা হচ্ছে...', 'Placing order...') : tx(`অর্ডার করুন ${money(total)}`, `Place Order ${amount(total, lang)}`)} variant="gold" onPress={submitOrder} disabled={submitting || !product} />
    </>
  );
}

function BuyDone({ setScreen, qty, product, order }: { setScreen: (screen: Screen) => void; qty: number; product: ApiRow | null; order: ApiRow | null }) {
  const { tx, lang } = useLanguage();
  return (
    <SuccessScreen
      icon="🎉"
      title={tx('অর্ডার সম্পন্ন!', 'Order Complete!')}
      refNo={order?.order_code || 'ORD-APP'}
      desc={tx(`${bn(qty)} × ${rowTitle(product || undefined, 'bn', 'পণ্য')} অর্ডার নিশ্চিত।`, `${num(qty, lang)} × ${rowTitle(product || undefined, 'en', 'Product')} order confirmed.`)}
      action={() => setScreen('home')}
      gold
    />
  );
}

function useTrainingModules(): TrainingModule[] {
  const { tx, lang } = useLanguage();
  const modules = useApiList<ApiRow>('learning/modules');
  const contents = useApiList<ApiRow>('learning/contents');
  return modules.rows
    .filter((row) => !row.status || row.status === 'published')
    .map((module, index) => {
      const related = contents.rows.filter((content) => Number(content.learning_module_id) === Number(module.id));
      const article = related.find((content) => content.content_type === 'article');
      const video = related.find((content) => content.content_type === 'video');
      const quiz = related.find((content) => content.content_type === 'quiz');
      return {
        icon: index % 3 === 0 ? '🐄' : index % 3 === 1 ? '🌾' : '▶',
        title: rowTitle(module, lang, tx('প্রশিক্ষণ মডিউল', 'Training module')),
        sub: localized(module, lang, 'subtitle', ''),
        count: tx(`${bn(related.length)} কনটেন্ট`, `${related.length} contents`),
        article: rowTitle(article, lang, tx('আর্টিকেল নেই', 'No article')),
        video: rowTitle(video, lang, tx('ভিডিও নেই', 'No video')),
        quiz: rowTitle(quiz, lang, tx('কুইজ নেই', 'No quiz')),
        progress: tx('সার্ভার ডাটা', 'Server data'),
        bg: [colors.rose, colors.goldPale, colors.bluePale, '#FCE7F3', '#EDE9FE', '#CCFBF1'][index % 6],
        articleBody: localized(article, lang, 'body', ''),
        videoUrl: video?.video_url,
      };
    });
}

function Training({ setScreen, setSelectedModule }: { setScreen: (screen: Screen) => void; setSelectedModule: (index: number) => void }) {
  const { tx } = useLanguage();
  const moduleState = useApiList<ApiRow>('learning/modules');
  const modules = useTrainingModules();
  return (
    <>
      <Header title={tx('প্রশিক্ষণ মডিউল', 'Training Modules')} onBack={() => setScreen('home')} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
        {[tx('সব', 'All'), tx('গবাদিপশু', 'Livestock'), tx('কৃষি', 'Agriculture'), tx('জলবায়ু', 'Climate'), tx('নারী', 'Women'), tx('স্বাস্থ্য', 'Health')].map((chip, index) => (
          <Text key={chip} style={[styles.chip, index === 0 && styles.chipActive]}>{chip}</Text>
        ))}
      </ScrollView>
      <ApiStatus state={moduleState} empty={tx('এখন কোনো প্রশিক্ষণ মডিউল পাওয়া যায়নি।', 'No training modules are available right now.')} />
      <View style={styles.moduleGrid}>
        {modules.map((module, index) => (
          <Pressable
            key={module.title}
            onPress={() => {
              setSelectedModule(index);
              setScreen('trainingDetail');
            }}
            style={({ pressed }) => [styles.moduleCard, pressed && styles.pressed]}
          >
            <View style={[styles.moduleThumb, { backgroundColor: module.bg }]}>
              <Text style={styles.moduleIcon}>{module.icon}</Text>
            </View>
            <Text style={styles.moduleTitle}>{module.title}</Text>
            <Text style={styles.moduleSub}>{module.sub}</Text>
            <Text style={styles.moduleCount}>{module.count}</Text>
          </Pressable>
        ))}
      </View>
    </>
  );
}

function TrainingModuleDetail({
  setScreen,
  moduleIndex,
  setContentKind,
}: {
  setScreen: (screen: Screen) => void;
  moduleIndex: number;
  setContentKind: (kind: TrainingContentKind) => void;
}) {
  const { tx } = useLanguage();
  const modules = useTrainingModules();
  const module = modules[moduleIndex] ?? modules[0];
  if (!module) {
    return (
      <>
        <Header title={tx('প্রশিক্ষণ মডিউল', 'Training Modules')} onBack={() => setScreen('training')} />
        <Text style={styles.apiNotice}>{tx('এই মডিউলের কনটেন্ট এখন পাওয়া যাচ্ছে না।', 'This module content is not available right now.')}</Text>
      </>
    );
  }
  return (
    <>
      <Header title={tx('প্রশিক্ষণ মডিউল', 'Training Modules')} onBack={() => setScreen('training')} />
      <View style={styles.learningList}>
        <View style={styles.learningCard}>
          <View style={[styles.learningThumb, { backgroundColor: module.bg }]}>
            <Text style={styles.moduleIcon}>{module.icon}</Text>
            <Badge label={module.progress} tone="rose" />
          </View>
          <View style={styles.learningBody}>
            <Text style={styles.moduleTitle}>{module.title}</Text>
            <Text style={styles.moduleSub}>{module.sub}</Text>
            <LearningMaterial
              icon="📄"
              label={tx('আর্টিকেল', 'Article')}
              title={module.article}
              onPress={() => {
                setContentKind('article');
                setScreen('trainingArticle');
              }}
            />
            <LearningMaterial
              icon="▶"
              label={tx('ভিডিও', 'Video')}
              title={module.video}
              onPress={() => {
                setContentKind('video');
                setScreen('trainingVideo');
              }}
            />
            <View style={styles.quizBox}>
              <View style={styles.quizIcon}>
                <Text style={styles.quizIconText}>?</Text>
              </View>
              <View style={styles.flex}>
                <Text style={styles.quizTitle}>{module.quiz}</Text>
                <Text style={styles.quizSub}>{tx('ভিডিও/আর্টিকেল শেষ হলে আনলক হবে', 'Unlocks after completing material')}</Text>
              </View>
              <Text style={styles.quizStatus}>{tx('কুইজ', 'Quiz')}</Text>
            </View>
          </View>
        </View>
      </View>
    </>
  );
}

function TrainingContentPage({ setScreen, moduleIndex, kind }: { setScreen: (screen: Screen) => void; moduleIndex: number; kind: TrainingContentKind }) {
  const { tx } = useLanguage();
  const modules = useTrainingModules();
  const module = modules[moduleIndex] ?? modules[0];
  if (!module) {
    return (
      <>
        <Header title={kind === 'article' ? tx('আর্টিকেল', 'Article') : tx('ভিডিও', 'Video')} onBack={() => setScreen('trainingDetail')} />
        <Text style={styles.apiNotice}>{tx('এই কনটেন্ট এখন পাওয়া যাচ্ছে না।', 'This content is not available right now.')}</Text>
      </>
    );
  }
  const title = kind === 'article' ? module.article : module.video;
  return (
    <>
      <Header title={kind === 'article' ? tx('আর্টিকেল', 'Article') : tx('ভিডিও', 'Video')} onBack={() => setScreen('trainingDetail')} />
      <Card style={styles.trainingContentHero}>
        <View style={[styles.trainingContentIcon, { backgroundColor: module.bg }]}>
          <Text style={styles.moduleIcon}>{kind === 'article' ? '📄' : '▶'}</Text>
        </View>
        <Text style={styles.trainingContentKicker}>{module.title}</Text>
        <Text style={styles.trainingContentTitle}>{title}</Text>
        <Text style={styles.trainingContentMeta}>{kind === 'article' ? tx('৫ মিনিট পড়া', '5 min read') : tx('৮ মিনিট ভিডিও', '8 min video')}</Text>
      </Card>
      {kind === 'article' ? (
        <Card style={styles.trainingContentBody}>
          <Text style={styles.trainingParagraph}>{module.articleBody || tx('এই আর্টিকেলের বিস্তারিত কনটেন্ট এখন সার্ভারে নেই।', 'The full article content is not available on the server yet.')}</Text>
        </Card>
      ) : (
        <View style={styles.videoLessonCard}>
          <View style={styles.videoPlayCircle}>
            <Text style={styles.videoPlayIcon}>▶</Text>
          </View>
          <Text style={styles.videoLessonTitle}>{title}</Text>
          <Text style={styles.videoLessonSub}>{module.videoUrl || tx('ভিডিও লিংক এখন সার্ভারে নেই।', 'Video link is not available on the server yet.')}</Text>
        </View>
      )}
      <AppButton title={tx('সম্পন্ন হিসেবে চিহ্নিত করুন', 'Mark as Complete')} onPress={() => setScreen('trainingDetail')} />
    </>
  );
}

function LearningMaterial({ icon, label, title, onPress }: { icon: string; label: string; title: string; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.learningMaterial, pressed && styles.pressed]}>
      <Text style={styles.learningMaterialIcon}>{icon}</Text>
      <View style={styles.flex}>
        <Text style={styles.learningMaterialLabel}>{label}</Text>
        <Text style={styles.learningMaterialTitle}>{title}</Text>
      </View>
    </Pressable>
  );
}

function PartnerRegister({ setScreen }: { setScreen: (screen: Screen) => void }) {
  const { tx, lang } = useLanguage();
  const projects = useApiList<ApiRow>('partners/projects');
  return (
    <>
      <Header title={tx('শাথী পার্টনার নিবন্ধন', 'Shathi Partner Registration')} onBack={() => setScreen('home')} />
      <View style={styles.notice}>
        <Text style={styles.noticeText}>{tx('চুক্তিভিত্তিক চাষ ও ঋণ সংযোগসম্পন্ন Due Diligence সার্ভে পূরণ করুন।', 'Contract farming & credit linkage. Complete the Due Diligence survey.')}</Text>
      </View>
      <SectionTitle title={tx('সক্রিয় প্রকল্পসমূহ', 'Active Projects')} />
      <ApiStatus state={projects} empty={tx('এখন কোনো পার্টনার প্রকল্প নেই।', 'No partner projects are available right now.')} />
      {projects.rows.map((project) => (
        <Card key={project.id || project.project_code} style={[styles.projectApply, project.status !== 'open' && styles.coolProject]}>
          <View style={styles.projectApplyHead}>
            <Badge label={project.status === 'open' ? tx('নিবন্ধন চলছে', 'Open') : tx('শীঘ্রই', 'Soon')} tone={project.status === 'open' ? 'green' : 'blue'} />
            <Text style={styles.projectProgress}>{num(project.capacity || 0, lang)} {tx('জন', 'farmers')}</Text>
          </View>
          <Text style={styles.projectName}>{rowTitle(project, lang, tx('প্রকল্প', 'Project'))}</Text>
          <Text style={styles.productSub}>⌖ {project.district || ''} · {project.upazila || ''}</Text>
          <View style={styles.progressBar}>
            <View style={styles.progressFill} />
          </View>
          <Text style={styles.productSub}>{tx('ঋণ সহায়তা', 'Lender')}: {project.lender_name || 'N/A'} · {tx('সর্বোচ্চ', 'Up to')} {amount(Number(project.max_credit_amount || 0), lang)}</Text>
          {project.status === 'open' ? <AppButton title={tx('এই প্রকল্পে আবেদন করুন  →', 'Apply for this project  →')} onPress={() => setScreen('kyc')} /> : null}
        </Card>
      ))}
      <SectionTitle title={tx('নিবন্ধনের ধাপ', 'Registration Steps')} />
      {[tx('প্রকল্প নির্বাচন', 'Project selection'), tx('ব্যক্তিগত KYC', 'Personal KYC'), tx('ব্যাংকিং তথ্য', 'Banking info'), tx('খামার মূল্যায়ন', 'Farm assessment')].map((step, index) => (
        <View key={step} style={styles.stepRow}>
          <Text style={styles.stepNum}>{num(index + 1, lang)}</Text>
          <View>
            <Text style={styles.stepTitle}>{step}</Text>
            <Text style={styles.stepSub}>{index === 0 ? tx('উপযুক্ত প্রকল্প বেছে নিন', 'Choose available project') : index === 1 ? tx('NID, ছবি, পরিবার', 'NID, land, family') : index === 2 ? tx('অ্যাকাউন্ট, MFS', 'Account, MFS') : tx('জমি, পশু-পাখি', 'Land, production')}</Text>
          </View>
        </View>
      ))}
    </>
  );
}

function Kyc({ setScreen, onSubmitted }: { setScreen: (screen: Screen) => void; onSubmitted: (application: ApiRow) => void }) {
  const { tx, lang } = useLanguage();
  const projects = useApiList<ApiRow>('partners/projects');
  const [fullName, setFullName] = useState('');
  const [nid, setNid] = useState('');
  const [land, setLand] = useState(num(120, lang));
  const [livestock, setLivestock] = useState(num(5, lang));
  const [income, setIncome] = useState(num(120000, lang));
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  async function submitKyc() {
    setSubmitting(true);
    setSubmitError('');
    try {
      const project = projects.rows.find((row) => row.status === 'open') || projects.rows[0];
      const applicationCode = `KYC-APP-${Date.now()}`;
      const response = await apiCreate('partners/applications', {
        application_code: applicationCode,
        user_id: 1,
        partner_project_id: Number(project?.id || 1),
        current_step: 'personal_kyc',
        full_name_per_nid: fullName,
        nid_number: nid,
        total_land_decimals: Number(land) || 0,
        livestock_count: Number(livestock) || 0,
        primary_income_source: 'Livestock',
        annual_household_income: Number(income) || 0,
        mobile_banking_provider: 'bKash',
        verification_notes: 'Submitted from mobile app.',
        status: 'submitted',
      });
      onSubmitted({ application_code: applicationCode, id: response.result?.insertId });
      setScreen('regDone');
    } catch (error) {
      setSubmitError(naturalApiError(error, lang));
    } finally {
      setSubmitting(false);
    }
  }
  return (
    <>
      <Header title={tx('KYC সার্ভে', 'KYC Survey')} onBack={() => setScreen('partnerRegister')} right={tx('ধাপ ২/৫', 'Step 2/5')} />
      <View style={styles.progressLine} />
      <FormLabel label={tx('পূর্ণ নাম (NID অনুযায়ী)', 'Full name (per NID)')} />
      <TextInput style={styles.input} value={fullName} onChangeText={setFullName} placeholder={tx('আপনার পূর্ণ নাম', 'Your full name')} placeholderTextColor={colors.muted} />
      <FormLabel label={tx('জাতীয় পরিচয়পত্র নম্বর', 'NID number')} />
      <TextInput style={styles.input} value={nid} onChangeText={setNid} placeholder={tx('১৭ সংখ্যার NID', '17-digit NID')} placeholderTextColor={colors.muted} keyboardType="number-pad" />
      <View style={styles.twoCol}>
        <View style={styles.flex}>
          <FormLabel label={tx('জন্ম তারিখ', 'DOB')} />
          <TextInput style={styles.input} placeholder="mm/dd/yyyy" placeholderTextColor={colors.muted} />
        </View>
        <View style={styles.flex}>
          <FormLabel label={tx('লিঙ্গ', 'Gender')} />
          <FakeSelect value={tx('নির্বাচন', 'Select')} />
        </View>
      </View>
      <FormLabel label={tx('মোট জমি (শতক)', 'Total land (decimals)')} />
      <TextInput style={styles.input} value={land} onChangeText={setLand} keyboardType="number-pad" />
      <FormLabel label={tx('বর্তমান পশুর সংখ্যা', 'Livestock count')} />
      <TextInput style={styles.input} value={livestock} onChangeText={setLivestock} keyboardType="number-pad" />
      <FormLabel label={tx('প্রধান আয়ের উৎস', 'Primary income source')} />
      <FakeSelect value={tx('নির্বাচন', 'Select')} />
      <FormLabel label={tx('বার্ষিক পারিবারিক আয় (৳)', 'Annual household income (৳)')} />
      <TextInput style={styles.input} value={income} onChangeText={setIncome} keyboardType="number-pad" />
      <FormLabel label={tx('মোবাইল ব্যাংকিং', 'Mobile banking')} />
      <FakeSelect value={tx('নির্বাচন', 'Select')} />
      {submitError ? <Text style={styles.apiNotice}>{submitError}</Text> : null}
      <AppButton title={submitting ? tx('জমা হচ্ছে...', 'Submitting...') : tx('জমা দিন ও পরবর্তী ধাপ  →', 'Submit & next step  →')} onPress={submitKyc} disabled={submitting} />
    </>
  );
}

function RegDone({ setScreen, application }: { setScreen: (screen: Screen) => void; application: ApiRow | null }) {
  const { tx } = useLanguage();
  return (
    <SuccessScreen
      icon="🤝"
      title={tx('আবেদন জমা হয়েছে!', 'Application Submitted!')}
      refNo={application?.application_code || 'REG-APP'}
      desc={tx('পর্যালোচনা হচ্ছে। মাঠ কর্মকর্তা ৫ কর্মদিনে যোগাযোগ করবেন।', 'Review is in progress. Field officer will contact within 5 working days.')}
      action={() => setScreen('home')}
      gold
    />
  );
}

function Community({ setScreen }: { setScreen: (screen: Screen) => void }) {
  const { tx, lang } = useLanguage();
  const posts = useApiList<ApiRow>('community/posts');
  const officers = useApiList<ApiRow>('admin/users');
  const [postDraft, setPostDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState('');
  const [localPosts, setLocalPosts] = useState<ApiRow[]>([]);
  async function submitPost() {
    const body = postDraft.trim();
    if (!body) return;
    setPosting(true);
    setPostError('');
    try {
      await apiCreate('community/posts', {
        user_id: 1,
        scope: 'upazila',
        post_type: 'general',
        body,
        district: 'Mymensingh',
        upazila: 'Mymensingh Sadar',
        status: 'visible',
      });
      setLocalPosts((current) => [{ body, post_type: 'general', like_count: 0, comment_count: 0 }, ...current]);
      setPostDraft('');
    } catch (error) {
      setPostError(naturalApiError(error, lang));
    } finally {
      setPosting(false);
    }
  }
  const visiblePosts = [...localPosts, ...posts.rows];
  return (
    <>
      <BrandHeader setScreen={setScreen} />
      <Text style={styles.pageTitle}>☷ {tx('কমিউনিটি', 'Community')}</Text>
      <View style={styles.filterRow}>
        {[tx('আমার উপজেলা', 'My Upazila'), tx('জেলা', 'District'), tx('বাংলাদেশ', 'Bangladesh')].map((filter, index) => (
          <Text key={filter} style={[styles.filter, index === 0 && styles.filterActive]}>{filter}</Text>
        ))}
      </View>
      <View style={styles.search}>
        <Text style={styles.searchIcon}>⌕</Text>
        <TextInput style={styles.searchInput} placeholder={tx('কৃষক বা পোস্ট খুঁজুন...', 'Search farmers or posts...')} placeholderTextColor={colors.muted} />
        <Text style={styles.searchButton}>{tx('খুঁজুন', 'Search')}</Text>
      </View>
      <SectionTitle title={tx('উপজেলা কর্মকর্তা', 'Upazila Officers')} />
      <Card>
        {officers.rows.slice(0, 2).map((officer) => (
          <Officer key={officer.id || officer.email} name={officer.name || officer.full_name || tx('কর্মকর্তা', 'Officer')} role={[officer.role, officer.district, officer.upazila].filter(Boolean).join(' · ')} action="☎" />
        ))}
        {!officers.loading && !officers.rows.length ? <Text style={styles.apiNotice}>{tx('কর্মকর্তার তথ্য পাওয়া যায়নি।', 'Officer data is not available.')}</Text> : null}
      </Card>
      <View style={styles.postBox}>
        <Text style={styles.postAvatar}>♟</Text>
        <TextInput style={styles.postInput} value={postDraft} onChangeText={setPostDraft} placeholder={tx('কিছু লিখুন...', 'Write something...')} placeholderTextColor={colors.muted} />
        <Pressable onPress={submitPost} disabled={posting}>
          <Text style={styles.postButton}>{posting ? tx('...', '...') : tx('পোস্ট', 'Post')}</Text>
        </Pressable>
      </View>
      {postError ? <Text style={styles.apiNotice}>{postError}</Text> : null}
      <ApiStatus state={posts} empty={tx('এখন কোনো কমিউনিটি পোস্ট নেই।', 'No community posts are available right now.')} />
      {visiblePosts.map((post, index) => (
        <Post
          key={post.id || index}
          name={post.farmer_name || post.user_name || tx('শাথী ব্যবহারকারী', 'Shathi user')}
          tag={post.post_type || tx('পোস্ট', 'Post')}
          text={post.body || ''}
          likes={num(post.like_count || 0, lang)}
          comments={num(post.comment_count || 0, lang)}
          meta={[post.created_at, post.district || post.upazila].filter(Boolean).join(' · ')}
        />
      ))}
    </>
  );
}

function Officer({ name, role, action }: { name: string; role: string; action: string }) {
  return (
    <View style={styles.officerRow}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{name.slice(0, 1)}</Text>
      </View>
      <View style={styles.flex}>
        <Text style={styles.officerName}>{name}</Text>
        <Text style={styles.officerMeta}>{role}</Text>
      </View>
      <Text style={styles.officerAction}>{action}</Text>
    </View>
  );
}

function Post({ name, tag, text, likes, comments, meta }: { name: string; tag: string; text: string; likes: string; comments: string; meta?: string }) {
  return (
    <Card style={styles.postCard}>
      <View style={styles.postHeader}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{name.slice(0, 1)}</Text>
        </View>
        <View style={styles.flex}>
          <Text style={styles.postName}>{name}</Text>
          <Text style={styles.productSub}>{meta || ''}</Text>
        </View>
        <Badge label={tag} tone={tag === 'প্রশ্ন' ? 'gold' : 'green'} />
      </View>
      <Text style={styles.postText}>{text}</Text>
      <View style={styles.postActions}>
        <Text style={styles.postAction}>♡ {likes}</Text>
        <Text style={styles.postAction}>□ {comments}</Text>
        <Text style={styles.postAction}>⌯</Text>
      </View>
    </Card>
  );
}

function Projects({ setScreen }: { setScreen: (screen: Screen) => void }) {
  const { tx, lang } = useLanguage();
  const projects = useApiList<ApiRow>('partners/projects');
  const ledgers = useApiList<ApiRow>('partners/ledgers');
  const project = projects.rows[0];
  const projectLedgers = ledgers.rows.slice(0, 4);
  return (
    <>
      <BrandHeader setScreen={setScreen} />
      <View style={styles.projectHero}>
        <View style={styles.projectHeroIcon}>
          <Text style={styles.projectHeroEmoji}>▣</Text>
        </View>
        <View style={styles.flex}>
          <Text style={styles.projectHeroTitle}>{tx('শাথী পার্টনার', 'Shathi Partner')}</Text>
          <Text style={styles.projectHeroSub}>{tx('চুক্তি চাষ, উপকরণ ও লাভের হিসাব', 'Contract farming, inputs and profit tracking')}</Text>
        </View>
        <Badge label={tx('সক্রিয়', 'Active')} tone="green" />
      </View>
      <ApiStatus state={projects} empty={tx('এখন কোনো প্রকল্প পাওয়া যায়নি।', 'No projects are available right now.')} />

      <View style={styles.projectStatGrid}>
        <View style={styles.projectStatCard}>
          <Text style={styles.projectStatValue}>{num(projects.rows.length, lang)}</Text>
          <Text style={styles.projectStatLabel}>{tx('সক্রিয় প্রকল্প', 'Active Projects')}</Text>
        </View>
        <View style={styles.projectStatCard}>
          <Text style={styles.projectStatValue}>৳62K</Text>
          <Text style={styles.projectStatLabel}>{tx('উপকরণ', 'Inputs')}</Text>
        </View>
        <View style={styles.projectStatCard}>
          <Text style={styles.projectStatValue}>৳18K</Text>
          <Text style={styles.projectStatLabel}>{tx('লভ্যাংশ', 'Profit Share')}</Text>
        </View>
      </View>

      <SectionTitle title={tx('সক্রিয় প্রকল্প', 'Active Project')} />
      <View style={styles.projectDetailCard}>
        <View style={styles.projectDetailTop}>
          <View style={styles.flex}>
            <Text style={styles.projectDetailName}>{rowTitle(project, lang, tx('প্রকল্প', 'Project'))}</Text>
            <Text style={styles.projectDetailMeta}>{[project?.start_date, project?.end_date].filter(Boolean).join(' to ')}</Text>
          </View>
          <View style={styles.projectBalance}>
            <Text style={styles.projectBalanceLabel}>{tx('বাকি', 'Balance')}</Text>
            <Text style={styles.projectBalanceValue}>৳2,700</Text>
          </View>
        </View>
        <View style={styles.projectHealthBar}>
          <View style={styles.projectHealthFill} />
        </View>
        <Text style={styles.projectHealthText}>{project?.status || tx('প্রকল্পের সর্বশেষ অবস্থা সার্ভার থেকে এসেছে।', 'Latest project status loaded from server.')}</Text>

        <View style={styles.projectProgressHead}>
          <Text style={styles.smallUpper}>{tx('প্রকল্পের অগ্রগতি', 'Project Progress')}</Text>
          <Text style={styles.projectProgressBadge}>{tx('বর্তমান ধাপ ৩/৪', 'Current step 3/4')}</Text>
        </View>
        <View style={styles.connectedTimeline}>
          {(parseMaybeJson(project?.steps_json) as any[]).length ? (parseMaybeJson(project?.steps_json) as any[]) : [tx('প্রকল্প নির্বাচন', 'Project selection'), tx('KYC', 'KYC'), tx('ভেরিফিকেশন', 'Verification'), tx('অনুমোদন', 'Approval')].map((item, index) => {
            const state = index < 2 ? 'done' : index === 2 ? 'current' : 'pending';
            return (
              <View key={item} style={styles.connectedStep}>
                <View style={styles.timelineNodeRow}>
                  {index > 0 ? <View style={[styles.timelineConnector, state === 'pending' ? styles.timelineConnectorPending : styles.timelineConnectorDone]} /> : <View style={styles.timelineConnectorGhost} />}
                  <View style={[styles.timelineNode, state === 'done' && styles.timelineNodeDone, state === 'current' && styles.timelineNodeCurrent]}>
                    <Text style={[styles.timelineNodeText, state === 'pending' && styles.timelineNodeTextPending]}>{state === 'done' ? '✓' : num(index + 1, lang)}</Text>
                  </View>
                  {index < 3 ? <View style={[styles.timelineConnector, index < 2 ? styles.timelineConnectorDone : styles.timelineConnectorPending]} /> : <View style={styles.timelineConnectorGhost} />}
                </View>
                <Text style={[styles.timelineText, state === 'current' && styles.timelineTextCurrent]} numberOfLines={2}>{item}</Text>
              </View>
            );
          })}
        </View>
        <Text style={styles.smallUpper}>{tx('উপকরণ ও হিসাব', 'Inputs & Accounts')}</Text>
        <ApiStatus state={ledgers} empty={tx('এই প্রকল্পে এখন কোনো লেজার তথ্য নেই।', 'No ledger data is available for this project yet.')} />
        {projectLedgers.map((ledger) => (
          <LedgerRow key={ledger.id || ledger.title_en} label={rowTitle(ledger, lang, ledger.entry_type || '')} value={amount(Number(ledger.amount || 0), lang)} green={ledger.entry_type === 'payment'} />
        ))}
      </View>
    </>
  );
}

function OrderFeature({ icon, title, sub }: { icon: string; title: string; sub: string }) {
  return (
    <View style={styles.orderFeature}>
      <Text style={styles.orderFeatureIcon}>{icon}</Text>
      <Text style={styles.orderFeatureTitle}>{title}</Text>
      <Text style={styles.orderFeatureSub}>{sub}</Text>
    </View>
  );
}

function LedgerRow({ label, value, green, strong }: { label: string; value: string; green?: boolean; strong?: boolean }) {
  return (
    <View style={styles.ledgerRow}>
      <Text style={[styles.ledgerLabel, strong && styles.ledgerStrong]}>{label}</Text>
      <Text style={[styles.ledgerValue, green && styles.greenText]}>{value}</Text>
    </View>
  );
}

function Profile({ setScreen }: { setScreen: (screen: Screen) => void }) {
  const { tx, lang, toggleLang } = useLanguage();
  const users = useApiList<ApiRow>('users');
  const user = users.rows[0];
  const menuRows = [
    ['♙', tx('ব্যক্তিগত তথ্য', 'Personal Info'), tx('নাম, যোগাযোগ, ঠিকানা', 'Name, contact, address')],
    ['▦', tx('ব্যাংকিং বিবরণ', 'Banking Details'), tx('ব্যাংক, মোবাইল ব্যাংকিং', 'Bank, mobile banking')],
    ['▧', tx('খামারের তথ্য', 'Farm Info'), tx('জমি, ফসল, পশুপাখি', 'Land, crops, livestock')],
    ['▤', tx('KYC ডকুমেন্ট', 'KYC Documents'), tx('NID, কাগজপত্র', 'NID, papers')],
    ['✎', tx('ক্যাটাগরি আপডেট', 'Update Categories'), tx('পছন্দ তালিকা পরিবর্তন', 'Change preferences')],
    ['文', tx('ভাষা: বাংলা', `Language: ${lang === 'bn' ? 'Bangla' : 'English'}`), tx('ভাষা পরিবর্তন করুন', 'Switch language')],
    ['?', tx('সাহায্য ও FAQ', 'Help & FAQ'), tx('সাধারণ জিজ্ঞাসা', 'Common questions')],
    ['⚙', tx('সেটিংস', 'Settings'), tx('নোটিফিকেশন', 'Notifications')],
  ];
  return (
    <>
      <View style={styles.profileHead}>
        <View style={styles.profileAvatar}>
          <Text style={styles.profileAvatarText}>{String(user?.display_name || user?.full_name || 'SS').slice(0, 2).toUpperCase()}</Text>
        </View>
        <Text style={styles.profileName}>{user?.display_name || user?.full_name || tx('শাথী ব্যবহারকারী', 'Shathi user')}</Text>
        <Text style={styles.profileMeta}>☎ {user?.phone || ''}   ⌖ {user?.district || ''}</Text>
        <View style={styles.profileBadge}>
          <Text style={styles.profileBadgeText}>{tx('শাথী পার্টনার ✓', 'Shathi Partner ✓')}</Text>
        </View>
      </View>
      <Card style={styles.menuCard}>
        {menuRows.map(([icon, title, sub], index) => (
          <Pressable
            key={title}
            onPress={index === 4 ? () => setScreen('prefAnimal') : index === 5 ? toggleLang : undefined}
            style={styles.menuItem}
          >
            <Text style={styles.menuIcon}>{icon}</Text>
            <View style={styles.flex}>
              <Text style={styles.menuTitle}>{title}</Text>
              <Text style={styles.menuSub}>{sub}</Text>
            </View>
            {index === 5 ? (
              <View style={styles.languagePill}>
                <Text style={styles.languagePillText}>{lang === 'bn' ? 'BN' : 'EN'}</Text>
              </View>
            ) : (
              <Text style={styles.chevron}>›</Text>
            )}
          </Pressable>
        ))}
      </Card>
      <Card style={styles.logout}>
        <Text style={styles.logoutIcon}>↪</Text>
        <View>
          <Text style={styles.logoutTitle}>{tx('লগআউট', 'Logout')}</Text>
          <Text style={styles.menuSub}>{tx('অ্যাকাউন্ট থেকে বের হন', 'Sign out of account')}</Text>
        </View>
      </Card>
      <Text style={styles.version}>{tx('Shathi Sheba v1.0 · প্রস্তুতকারী Digigram Ventures Ltd.', 'Shathi Sheba v1.0 · Powered by Digigram Ventures Ltd.')}</Text>
    </>
  );
}

function Inactive({ setScreen }: { setScreen: (screen: Screen) => void }) {
  const { tx } = useLanguage();
  return (
    <View style={styles.comingSoonPage}>
      <View style={styles.comingSoonArt}>
        <Text style={styles.comingSoonIcon}>⏳</Text>
      </View>
      <Text style={styles.comingSoonKicker}>{tx('শীঘ্রই চালু হবে', 'Coming Soon')}</Text>
      <Text style={styles.comingSoonTitle}>{tx('এই সেবাটি আপনার এলাকায় প্রস্তুত হচ্ছে', 'This service is being prepared for your area')}</Text>
      <Text style={styles.comingSoonDesc}>
        {tx('Digigram মাঠ দল ক্যাটাগরি, মূল্য ও অপারেশন যাচাই করছে। চালু হলে আপনাকে নোটিফিকেশন পাঠানো হবে।', 'The Digigram field team is validating category, pricing and operations. You will be notified when it goes live.')}
      </Text>
      <View style={styles.comingSoonList}>
        <Text style={styles.comingSoonListItem}>{tx('• এলাকা অনুযায়ী সক্রিয় হবে', '• Activated by zone')}</Text>
        <Text style={styles.comingSoonListItem}>{tx('• মাঠ কর্মকর্তা যাচাই করবেন', '• Field officer verified')}</Text>
        <Text style={styles.comingSoonListItem}>{tx('• নিরাপদ মূল্য ও ডেলিভারি নিশ্চিত করা হবে', '• Safe pricing and delivery will be confirmed')}</Text>
      </View>
      <AppButton title={tx('হোমে ফিরুন', 'Back to Home')} onPress={() => setScreen('home')} />
      <AppButton title={tx('অন্য সেবা দেখুন', 'Browse other services')} variant="outline" onPress={() => setScreen('saleCategories')} />
    </View>
  );
}

function SuccessScreen({
  icon,
  title,
  refNo,
  desc,
  action,
  children,
  gold,
}: {
  icon: string;
  title: string;
  refNo: string;
  desc: string;
  action: () => void;
  children?: React.ReactNode;
  gold?: boolean;
}) {
  const { tx } = useLanguage();
  return (
    <View style={styles.success}>
      <View style={[styles.successCircle, gold && styles.successGold]}>
        <Text style={styles.successIcon}>{icon}</Text>
      </View>
      <Text style={[styles.successTitle, gold && styles.successGoldText]}>{title}</Text>
      <Text style={styles.refNo}>{refNo}</Text>
      <Text style={styles.successDesc}>{desc}</Text>
      {children}
      <AppButton title={tx('হোমে ফিরুন', 'Back to Home')} onPress={action} />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.card },
  safeOnboarding: { backgroundColor: colors.maroon },
  shell: { flex: 1, backgroundColor: colors.cream },
  shellContent: { paddingBottom: 104 + androidNavigationInset },
  shellContentWithAccessory: { paddingBottom: 218 + androidNavigationInset },
  fixedAccessory: { position: 'absolute', left: 0, right: 0, bottom: 72 + androidNavigationInset, paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, backgroundColor: colors.cream },
  flex: { flex: 1 },
  pressed: { opacity: 0.78, transform: [{ scale: 0.99 }] },
  onboarding: {
    flex: 1,
    backgroundColor: colors.maroon,
    padding: 32,
    justifyContent: 'flex-end',
  },
  lang: {
    position: 'absolute',
    top: 28,
    right: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  langToggle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  langToggleSubtle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'transparent',
  },
  langText: { color: 'white', fontWeight: '700' },
  langToggleText: { color: 'white', fontWeight: '700', fontSize: 14 },
  langToggleTextDark: { color: colors.ink },
  onboardingCopy: { paddingBottom: 54 },
  onboardingTitle: { color: 'white', fontSize: 30, lineHeight: 37, fontWeight: '700', marginBottom: 18, maxWidth: 330 },
  onboardingBody: { color: 'white', fontSize: 16, lineHeight: 25, fontWeight: '500', maxWidth: 330 },
  onboardingFooter: { marginTop: 34, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  slideBack: { color: 'white', fontSize: 34 },
  dotSpacer: { width: 34 },
  dots: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  dot: { width: 8, height: 5, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.45)' },
  dotActive: { width: 34, backgroundColor: 'white' },
  nextCircle: { width: 58, height: 58, borderRadius: 29, backgroundColor: 'white', alignItems: 'center', justifyContent: 'center' },
  nextText: { color: colors.maroon, fontSize: 30, lineHeight: 30 },
  authScreen: {
    flex: 1,
    backgroundColor: '#F9F2F6',
    padding: 20,
    justifyContent: 'center',
  },
  authLang: { position: 'absolute', right: 30, top: 30 },
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.line,
    shadowColor: '#000',
    shadowOpacity: 0.07,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  loginCard: { marginHorizontal: 0, padding: 32, borderRadius: 18 },
  loginTitle: { color: colors.maroon, fontSize: 29, lineHeight: 36, fontWeight: '700', textAlign: 'center' },
  loginSub: { color: colors.muted, fontSize: 18, textAlign: 'center', marginBottom: 22 },
  label: { color: colors.maroon, fontSize: 13, fontWeight: '700', marginHorizontal: 20, marginTop: 14, marginBottom: 6 },
  input: {
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: '#FFFDFE',
    paddingHorizontal: 14,
    marginHorizontal: 16,
    color: colors.ink,
    fontSize: 17,
  },
  inputDisabled: { opacity: 0.58, backgroundColor: '#F2E9EE' },
  button: {
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: colors.maroon,
    borderRadius: 9,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  goldButton: { backgroundColor: colors.gold },
  outlineButton: { backgroundColor: 'transparent', borderWidth: 1.5, borderColor: colors.maroon },
  buttonDisabled: { backgroundColor: '#D9C9D1', borderColor: '#D9C9D1' },
  buttonText: { color: 'white', fontSize: 17, fontWeight: '700' },
  buttonTextDisabled: { color: '#FFF8FB' },
  outlineButtonText: { color: colors.maroon },
  prefScreen: { flex: 1, backgroundColor: '#FCF7FA' },
  header: {
    minHeight: 62,
    paddingHorizontal: 16,
    paddingTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  backButton: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F3EEF1', alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  backText: { fontSize: 28, color: colors.ink, lineHeight: 28 },
  headerTitle: { flex: 1, color: colors.ink, fontSize: 22, fontWeight: '700' },
  headerRight: { color: colors.muted, fontSize: 15 },
  headerSpacer: { width: 36 },
  prefLangCenter: { position: 'absolute', top: 20, alignSelf: 'center', zIndex: 2 },
  prefScrollContent: { paddingBottom: 24 },
  prefTitle: { color: colors.ink, fontSize: 25, lineHeight: 33, fontWeight: '600', marginHorizontal: 18, marginTop: 18 },
  prefSub: { color: colors.muted, fontSize: 15, lineHeight: 22, marginHorizontal: 18, marginTop: 8, marginBottom: 12 },
  prefSection: { marginTop: 8 },
  prefSectionTitle: { color: colors.maroon, fontSize: 15, fontWeight: '700', marginHorizontal: 18, marginBottom: 10 },
  prefGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12, paddingHorizontal: 16 },
  prefOption: {
    width: '48%',
    minHeight: 118,
    backgroundColor: colors.card,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 13,
    justifyContent: 'space-between',
    shadowColor: '#8A3A5A',
    shadowOpacity: 0.07,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
    position: 'relative',
  },
  prefOptionSelected: { borderColor: colors.maroon, backgroundColor: '#FFF6FA', borderWidth: 1.5 },
  prefOptionIconWrap: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#F8EEF3',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  prefOptionIconWrapSelected: { backgroundColor: colors.rose },
  prefOptionIcon: { fontSize: 33 },
  prefOptionTitle: { color: colors.ink, fontSize: 16, lineHeight: 21, fontWeight: '600', paddingRight: 16 },
  prefCheck: {
    position: 'absolute',
    right: 10,
    top: 10,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'white',
  },
  prefCheckActive: { backgroundColor: colors.maroon, borderColor: colors.maroon },
  prefCheckText: { color: 'white', fontSize: 13, fontWeight: '700', lineHeight: 16 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12, paddingHorizontal: 16, paddingTop: 8 },
  tile: {
    width: '48%',
    minHeight: 94,
    backgroundColor: 'white',
    borderRadius: 9,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
    justifyContent: 'center',
  },
  tileSelected: { borderColor: colors.maroon, backgroundColor: colors.rose, borderWidth: 2 },
  tileIcon: { fontSize: 27, marginBottom: 8 },
  tileTitle: { color: colors.ink, fontSize: 15, lineHeight: 20, fontWeight: '700', flexShrink: 1 },
  tileSub: { color: colors.muted, fontSize: 12, marginTop: 3 },
  prefBottom: { marginTop: 'auto', paddingTop: 10, paddingBottom: 18, borderTopWidth: 1, borderColor: colors.line, backgroundColor: colors.cream },
  prefHint: { color: colors.muted, fontSize: 16, textAlign: 'center', padding: 14 },
  prefStepText: { color: colors.muted, fontSize: 13, fontWeight: '700', textAlign: 'center', marginBottom: 8 },
  stepDots: { flexDirection: 'row', justifyContent: 'center', gap: 5, paddingBottom: 12, paddingHorizontal: 16 },
  stepDot: { flex: 1, maxWidth: 38, height: 6, borderRadius: 10, backgroundColor: '#E7E0E4' },
  stepDotActive: { backgroundColor: colors.maroon },
  prefActionRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, alignItems: 'center' },
  prefActionRowFinal: { justifyContent: 'center' },
  prefSkipButton: {
    flex: 0.45,
    minHeight: 50,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'white',
  },
  prefSkipText: { color: colors.maroon, fontSize: 15, fontWeight: '700' },
  prefProceedButton: {
    flex: 1,
    minHeight: 50,
    borderRadius: 9,
    backgroundColor: colors.maroon,
    alignItems: 'center',
    justifyContent: 'center',
  },
  prefProceedButtonFinal: { flex: 1 },
  prefProceedDisabled: { backgroundColor: '#D9C9D1' },
  prefProceedText: { color: 'white', fontSize: 16, fontWeight: '700' },
  prefSelectHint: { color: colors.muted, fontSize: 12, textAlign: 'center', marginTop: 8, minHeight: 16 },
  brandHeader: {
    height: 62,
    backgroundColor: 'white',
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderColor: colors.line,
  },
  brandLockup: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  shathiLogo: { width: 36, height: 36, position: 'relative' },
  logoLeaf: { position: 'absolute', width: 20, height: 20, borderTopLeftRadius: 20, borderBottomRightRadius: 20 },
  logoLeafGreen: { backgroundColor: colors.gold, right: 2, top: 0, transform: [{ rotate: '-12deg' }] },
  logoLeafPurpleOne: { backgroundColor: colors.maroon, left: 1, top: 10, transform: [{ rotate: '-38deg' }] },
  logoLeafPurpleTwo: { backgroundColor: '#C989A5', right: 7, bottom: 2, transform: [{ rotate: '42deg' }] },
  brandTitle: { color: colors.maroon, fontSize: 23, lineHeight: 29, fontWeight: '700', flexShrink: 1 },
  brandActions: { flexDirection: 'row', alignItems: 'center', gap: 12, marginLeft: 10 },
  brandIconButton: { minWidth: 32, minHeight: 32, alignItems: 'center', justifyContent: 'center' },
  brandActionIcon: { color: colors.maroon, fontSize: 20 },
  geminiIcon: { color: colors.maroon, fontSize: 25, fontWeight: '700' },
  userAvatarMini: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.rose, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  userAvatarText: { color: colors.maroon, fontWeight: '700' },
  topBar: { height: 44, backgroundColor: colors.maroon, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  topMenu: { color: 'white', fontSize: 20 },
  topText: { color: 'white', fontSize: 15, fontWeight: '700' },
  topIcon: { color: 'white', fontSize: 18 },
  heroCard: {
    marginTop: 10,
    backgroundColor: colors.maroon,
    borderRadius: 10,
    borderColor: colors.maroon,
    padding: 18,
  },
  heroSmall: { color: 'rgba(255,255,255,0.78)', fontSize: 16 },
  heroName: { color: 'white', fontSize: 19, fontWeight: '700', marginTop: 4 },
  heroMeta: { color: 'rgba(255,255,255,0.78)', fontSize: 13, marginTop: 8 },
  weatherHomeCard: { marginTop: 12, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.14)', padding: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  weatherHomeTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  weatherHomeIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  weatherHomeEmoji: { fontSize: 24 },
  weatherHomeTitle: { color: 'white', fontSize: 15, fontWeight: '700' },
  weatherHomeLocation: { color: 'rgba(255,255,255,0.8)', fontSize: 12, marginTop: 2 },
  weatherHomeTemp: { alignItems: 'flex-end' },
  weatherHomeTempText: { color: colors.goldPale, fontSize: 21, fontWeight: '700' },
  weatherHomeMeta: { color: 'rgba(255,255,255,0.76)', fontSize: 11 },
  weatherHomeAlert: { color: 'rgba(255,255,255,0.84)', fontSize: 12, fontWeight: '700', marginTop: 8 },
  sourceBadge: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 8, alignSelf: 'flex-start', maxWidth: '100%', backgroundColor: '#FFF7ED', borderWidth: 1, borderColor: '#FDBA74', borderRadius: 10, paddingHorizontal: 9, paddingVertical: 7 },
  sourceBadgeIcon: { color: '#92400E', fontSize: 12, fontWeight: '700' },
  sourceBadgeText: { color: '#92400E', fontSize: 11, lineHeight: 15, flexShrink: 1 },
  weatherTicker: { marginTop: 10, minHeight: 32, borderRadius: 10, backgroundColor: 'rgba(255,243,196,0.16)', flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8 },
  weatherTickerLabel: { color: colors.goldPale, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  weatherTickerText: { color: 'white', fontSize: 12, flex: 1 },
  weatherChipArrow: { color: 'white', fontSize: 18, lineHeight: 20 },
  heroStats: { flexDirection: 'row', justifyContent: 'space-around', borderTopWidth: 1, borderColor: 'rgba(255,255,255,0.22)', marginTop: 18, paddingTop: 10 },
  heroStat: { alignItems: 'center', minWidth: 80 },
  heroStatValue: { color: colors.goldPale, fontSize: 20, fontWeight: '700' },
  heroStatLabel: { color: 'rgba(255,255,255,0.72)', fontSize: 12 },
  sectionRow: { paddingHorizontal: 16, marginTop: 18, marginBottom: 8, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sectionTitle: { color: colors.ink, fontSize: 19, fontWeight: '700' },
  sectionRight: { color: colors.maroon, fontSize: 13, fontWeight: '700' },
  serviceGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10, paddingHorizontal: 16 },
  serviceCard: {
    width: '48%',
    minHeight: 112,
    backgroundColor: 'white',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 14,
  },
  serviceIcon: { width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  serviceIconText: { color: colors.maroon, fontSize: 22, fontWeight: '700' },
  serviceTitle: { color: colors.ink, fontSize: 15, lineHeight: 19, fontWeight: '700', flexShrink: 1 },
  serviceSub: { color: colors.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  homeApaCard: {
    marginHorizontal: 16,
    marginTop: 16,
    backgroundColor: '#FFF8ED',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#F4D385',
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  homeApaIcon: { width: 58, height: 58, borderRadius: 18, backgroundColor: 'white', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#F4D385' },
  homeApaLogo: { width: 38, height: 38, position: 'relative' },
  homeApaKicker: { color: '#A16207', fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  homeApaTitle: { color: colors.ink, fontSize: 18, lineHeight: 23, fontWeight: '700', marginTop: 2 },
  homeApaSub: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 3 },
  homeApaArrow: { color: colors.maroon, fontSize: 26, fontWeight: '700' },
  alert: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 70 },
  alertIcon: { width: 42, height: 42, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  alertTitle: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  alertSub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, alignSelf: 'flex-start' },
  badgeRose: { backgroundColor: colors.rose },
  badgeGreen: { backgroundColor: colors.greenPale },
  badgeGold: { backgroundColor: colors.goldPale },
  badgeBlue: { backgroundColor: colors.bluePale },
  badgeText: { color: colors.maroon, fontSize: 12, fontWeight: '700' },
  badgeGreenText: { color: colors.green },
  navBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 72 + androidNavigationInset,
    backgroundColor: colors.maroon,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingBottom: androidNavigationInset,
    borderTopLeftRadius: 2,
    borderTopRightRadius: 2,
  },
  navItem: { alignItems: 'center', justifyContent: 'center', width: 72, height: 54, borderRadius: 13 },
  navItemActive: { backgroundColor: '#74113F' },
  navIcon: { color: 'white', fontSize: 24 },
  navLabel: { color: 'white', fontSize: 13, marginTop: 1, fontWeight: '700' },
  weatherHero: {
    margin: 16,
    borderRadius: 18,
    backgroundColor: colors.maroon,
    padding: 18,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 14,
    overflow: 'hidden',
  },
  weatherLocation: { color: 'rgba(255,255,255,0.76)', fontSize: 14, fontWeight: '600' },
  weatherSummary: { color: 'white', fontSize: 23, lineHeight: 30, fontWeight: '700', marginTop: 8, flexShrink: 1 },
  weatherHint: { color: 'rgba(255,255,255,0.76)', fontSize: 13, lineHeight: 20, marginTop: 8, flexShrink: 1 },
  weatherTempBlock: { alignItems: 'center', justifyContent: 'center', minWidth: 70 },
  weatherSun: { fontSize: 38 },
  weatherTemp: { color: colors.goldPale, fontSize: 34, fontWeight: '700' },
  weatherMetrics: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16 },
  weatherMetric: { width: '31.5%', minHeight: 82, backgroundColor: 'white', borderRadius: 12, borderWidth: 1, borderColor: colors.line, padding: 8, alignItems: 'center', justifyContent: 'center' },
  weatherBulletTicker: { backgroundColor: colors.maroon, minHeight: 34, justifyContent: 'center', paddingHorizontal: 16 },
  weatherBulletText: { color: 'white', fontSize: 13, fontWeight: '600' },
  weatherMetricIcon: { fontSize: 18 },
  weatherMetricValue: { color: colors.ink, fontSize: 14, fontWeight: '700', marginTop: 4 },
  weatherMetricLabel: { color: colors.muted, fontSize: 10, lineHeight: 13, textAlign: 'center', marginTop: 2 },
  forecastGrid: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, gap: 8 },
  forecastCard: { flex: 1, minHeight: 126, backgroundColor: 'white', borderRadius: 12, borderWidth: 1, borderColor: colors.line, padding: 9, alignItems: 'center' },
  forecastDay: { color: colors.maroon, fontSize: 12, fontWeight: '700', textAlign: 'center' },
  forecastIcon: { fontSize: 24, marginTop: 6 },
  forecastTemp: { color: colors.ink, fontSize: 14, fontWeight: '700', marginTop: 6 },
  forecastMeta: { color: colors.muted, fontSize: 10, lineHeight: 14, marginTop: 3, textAlign: 'center' },
  weatherAlert: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  weatherAlertIcon: { width: 48, height: 48, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.rose },
  weatherAlertBlue: { backgroundColor: colors.bluePale },
  weatherAlertGreen: { backgroundColor: colors.greenPale },
  weatherAlertGold: { backgroundColor: colors.goldPale },
  weatherAlertEmoji: { fontSize: 24 },
  weatherAlertTitle: { color: colors.ink, fontSize: 16, fontWeight: '700' },
  weatherAlertBody: { color: colors.muted, fontSize: 13, lineHeight: 20, marginTop: 4 },
  adviceGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10, paddingHorizontal: 16 },
  adviceCard: { flex: 1, backgroundColor: 'white', borderRadius: 12, borderWidth: 1, borderColor: colors.line, padding: 14 },
  adviceIcon: { fontSize: 24 },
  adviceTitle: { color: colors.ink, fontSize: 14, lineHeight: 18, fontWeight: '700', marginTop: 8 },
  adviceText: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 6 },
  apaHero: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 22, paddingBottom: 16 },
  apaAvatar: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.rose, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#D8A4BC' },
  apaAvatarText: { color: colors.maroon, fontSize: 32, fontWeight: '700' },
  apaLogoMark: { width: 42, height: 42, position: 'relative' },
  markdownStrong: { fontWeight: '700', color: colors.maroon },
  apaTitle: { color: colors.ink, fontSize: 24, fontWeight: '700', marginTop: 14 },
  apaHeroCompact: { flexDirection: 'row', alignItems: 'center', paddingTop: 14, paddingBottom: 8 },
  apaTitleCompact: { fontSize: 18, marginTop: 0, textAlign: 'left' },
  apaSubtitleCompact: { textAlign: 'left', marginTop: 2 },
  apaSubtitle: { color: colors.muted, fontSize: 14, textAlign: 'center', marginTop: 6 },
  suggestionWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 18, justifyContent: 'center', marginTop: 22, marginBottom: 12 },
  suggestionBubble: { backgroundColor: 'white', borderWidth: 1, borderColor: colors.line, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 10, maxWidth: '100%' },
  suggestionText: { color: colors.maroon, fontSize: 13, fontWeight: '600' },
  apaChatPreview: { marginHorizontal: 16, marginTop: 16, gap: 8 },
  apaMessageBubble: { maxWidth: '88%', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 9 },
  apaUserBubble: { alignSelf: 'flex-end', backgroundColor: colors.maroon },
  apaModelBubble: { alignSelf: 'flex-start', backgroundColor: 'white', borderWidth: 1, borderColor: colors.line },
  apaMessageText: { color: colors.ink, fontSize: 15, lineHeight: 22 },
  apaUserText: { color: 'white' },
  chatAttachedImage: { width: 210, height: 150, borderRadius: 14, marginTop: 8, resizeMode: 'cover', backgroundColor: colors.rose },
  speakerButton: { alignSelf: 'flex-end', marginTop: 6, minWidth: 30, minHeight: 26, borderRadius: 13, backgroundColor: colors.rose, alignItems: 'center', justifyContent: 'center' },
  speakerIcon: { fontSize: 14 },
  responseSuggestionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10 },
  responseSuggestionBubble: { backgroundColor: '#FFF7FA', borderWidth: 1, borderColor: colors.line, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 7 },
  responseSuggestionText: { color: colors.maroon, fontSize: 12, fontWeight: '700' },
  apaThinking: { color: colors.muted, fontSize: 12, textAlign: 'center', marginTop: 3 },
  apaActions: { paddingHorizontal: 16, marginTop: 20, marginBottom: 22, gap: 12, flexDirection: 'row' },
  apaActionsCompact: { marginTop: 4, marginBottom: 4 },
  apaMiniAction: { flex: 1, minHeight: 44, borderRadius: 12, backgroundColor: 'white', borderWidth: 1, borderColor: colors.line, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  apaMiniActionIcon: { fontSize: 18 },
  apaMiniActionText: { color: colors.maroon, fontSize: 13, fontWeight: '700' },
  apaActionPrimary: { flex: 1, minHeight: 112, backgroundColor: 'white', borderRadius: 18, borderWidth: 1, borderColor: colors.line, padding: 14, alignItems: 'center', justifyContent: 'center' },
  apaActionSecondary: { flex: 1, minHeight: 112, backgroundColor: 'white', borderRadius: 18, borderWidth: 1, borderColor: colors.line, padding: 14, alignItems: 'center', justifyContent: 'center' },
  apaActionIcon: { fontSize: 30 },
  apaActionTitle: { color: colors.maroon, fontSize: 15, fontWeight: '700', marginTop: 8, textAlign: 'center' },
  apaActionSub: { color: colors.muted, fontSize: 12, marginTop: 4, textAlign: 'center' },
  apaInputBar: { minHeight: 104, borderRadius: 24, backgroundColor: 'white', borderWidth: 1, borderColor: colors.line, padding: 8, shadowColor: colors.maroon, shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 4 },
  apaComposerTop: { minHeight: 48 },
  apaComposerBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  apaComposerTools: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  apaInputIconButton: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FBF4F7' },
  apaInputIconButtonActive: { backgroundColor: colors.goldPale },
  apaInputIcon: { fontSize: 18 },
  apaTextInput: { color: colors.ink, fontSize: 16, lineHeight: 22, minHeight: 48, maxHeight: 76, paddingHorizontal: 8, paddingTop: 4 },
  apaSendButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.maroon, alignItems: 'center', justifyContent: 'center' },
  apaSendButtonDisabled: { backgroundColor: '#CDA8B9' },
  apaSendText: { color: 'white', fontSize: 28, lineHeight: 30 },
  apaLiveScreen: { flex: 1, backgroundColor: colors.cream },
  voiceLiveHero: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 26 },
  voiceStage: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingBottom: 18 },
  liveBrandDot: { width: 82, height: 82, borderRadius: 41, backgroundColor: colors.rose, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#D8A4BC', marginBottom: 14 },
  voiceOrb: { color: colors.maroon, fontSize: 96, opacity: 0.9 },
  liveStatus: { color: colors.maroon, fontSize: 12, fontWeight: '700', backgroundColor: colors.rose, paddingHorizontal: 12, paddingVertical: 5, borderRadius: 999, overflow: 'hidden' },
  voiceTitle: { color: colors.ink, fontSize: 28, fontWeight: '700', marginTop: 18, textAlign: 'center' },
  voiceHint: { color: colors.muted, fontSize: 15, lineHeight: 23, textAlign: 'center', marginTop: 10 },
  voiceOrbWrap: { width: 210, height: 210, alignItems: 'center', justifyContent: 'center', marginTop: 34 },
  voicePulseRing: { position: 'absolute', width: 148, height: 148, borderRadius: 74, borderWidth: 3, borderColor: colors.maroon, backgroundColor: colors.rose },
  voicePulseRingInner: { position: 'absolute', width: 120, height: 120, borderRadius: 60, borderWidth: 2, borderColor: colors.gold, backgroundColor: colors.goldPale },
  voiceCenterMic: { width: 126, height: 126, borderRadius: 63, backgroundColor: colors.maroon, alignItems: 'center', justifyContent: 'center', shadowColor: colors.maroon, shadowOpacity: 0.22, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 6 },
  voiceCenterMicListening: { backgroundColor: colors.gold },
  voiceCenterMicSpeaking: { backgroundColor: colors.maroonDark },
  voiceCenterMicIcon: { color: 'white', fontSize: 42, fontWeight: '700' },
  voiceTranscript: { color: colors.maroon, fontSize: 14, lineHeight: 20, textAlign: 'center', minHeight: 24, marginTop: 10, paddingHorizontal: 12 },
  voiceSubtitle: { color: colors.ink, fontSize: 18, lineHeight: 26, textAlign: 'center', fontWeight: '700', marginTop: 12, paddingHorizontal: 14, minHeight: 54 },
  voiceWave: { width: 118, height: 118, borderRadius: 59, marginTop: 24, backgroundColor: colors.rose, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#D8A4BC' },
  voiceWaveActive: { backgroundColor: colors.goldPale, borderColor: colors.gold },
  voiceWaveIcon: { fontSize: 46 },
  voiceAnswer: { marginTop: 18, backgroundColor: 'white', borderWidth: 1, borderColor: colors.line, borderRadius: 14, padding: 14, alignSelf: 'stretch' },
  voiceAnswerText: { color: colors.ink, fontSize: 14, lineHeight: 22, textAlign: 'center' },
  voiceBottom: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 28, paddingBottom: 34 },
  voiceRound: { width: 58, height: 58, borderRadius: 29, backgroundColor: 'white', borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  voiceRoundIcon: { fontSize: 24 },
  voiceMic: { width: 78, height: 78, borderRadius: 39, backgroundColor: colors.maroon, alignItems: 'center', justifyContent: 'center' },
  voiceMicActive: { backgroundColor: colors.gold },
  voiceMicIcon: { fontSize: 32 },
  cameraScreen: { flex: 1, backgroundColor: '#110611' },
  cameraPreview: { flex: 1, margin: 16, borderRadius: 22, backgroundColor: '#1D121C', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#3A2536' },
  cameraPhotoPreview: { width: '100%', height: '100%', borderRadius: 22, resizeMode: 'cover' },
  cameraFocus: { color: 'rgba(255,255,255,0.7)', fontSize: 90 },
  cameraHint: { color: 'rgba(255,255,255,0.78)', fontSize: 14, textAlign: 'center', marginTop: 20, paddingHorizontal: 34 },
  cameraAnalysisCard: { marginHorizontal: 16, marginBottom: 12, borderRadius: 14, backgroundColor: 'white', borderWidth: 1, borderColor: colors.line, padding: 14 },
  cameraAnalysisTitle: { color: colors.maroon, fontSize: 14, fontWeight: '700' },
  cameraAnalysisText: { color: colors.ink, fontSize: 13, lineHeight: 20, marginTop: 6 },
  cameraBottom: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 28, paddingBottom: 34 },
  captureButton: { width: 78, height: 78, borderRadius: 39, backgroundColor: 'white', alignItems: 'center', justifyContent: 'center', borderWidth: 5, borderColor: '#D8CBD4' },
  captureInner: { color: colors.maroon, fontSize: 34 },
  apaImageScreen: { flex: 1, backgroundColor: colors.cream },
  apaImageContent: { paddingBottom: 120 + androidNavigationInset },
  apaImageBrand: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginTop: 16, padding: 14, borderRadius: 16, backgroundColor: 'white', borderWidth: 1, borderColor: colors.line },
  apaImageTitle: { color: colors.ink, fontSize: 19, fontWeight: '700' },
  apaImageSub: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 3 },
  apaImagePreview: { marginHorizontal: 16, marginTop: 14, minHeight: 220, borderRadius: 18, backgroundColor: '#FFF7FA', borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  apaImagePhoto: { width: '100%', height: 240, resizeMode: 'cover' },
  apaImageEmptyIcon: { fontSize: 42 },
  apaImageEmptyTitle: { color: colors.maroon, fontSize: 18, fontWeight: '700', marginTop: 8 },
  apaImageEmptySub: { color: colors.muted, fontSize: 13, marginTop: 4 },
  apaImageActions: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, marginTop: 12 },
  apaImageActionButton: { flex: 1, minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.line, backgroundColor: 'white', alignItems: 'center', justifyContent: 'center' },
  apaImageActionButtonPrimary: { flex: 1, minHeight: 48, borderRadius: 12, backgroundColor: colors.maroon, alignItems: 'center', justifyContent: 'center' },
  apaImageActionText: { color: colors.maroon, fontSize: 14, fontWeight: '700' },
  apaImageActionTextPrimary: { color: 'white', fontSize: 14, fontWeight: '700' },
  apaImageChat: { marginHorizontal: 16, marginTop: 14, gap: 8 },
  apaImageInputBar: { position: 'absolute', left: 0, right: 0, bottom: androidNavigationInset, minHeight: 84, backgroundColor: colors.cream, borderTopWidth: 1, borderColor: colors.line, flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10, gap: 8 },
  apaImageTextInput: { flex: 1, minHeight: 54, maxHeight: 82, backgroundColor: 'white', borderWidth: 1, borderColor: colors.line, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8 },
  pageHint: { marginHorizontal: 20, marginTop: 14, color: colors.muted, fontSize: 15 },
  listItem: {
    backgroundColor: 'white',
    marginHorizontal: 16,
    marginTop: 10,
    padding: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  listItemInactive: { opacity: 0.72, backgroundColor: '#FBF8FA' },
  listIcon: { fontSize: 26 },
  listTitle: { color: colors.ink, fontSize: 16, lineHeight: 20, fontWeight: '700', flexShrink: 1 },
  listSub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  chevron: { color: colors.muted, fontSize: 22 },
  infoBar: { backgroundColor: colors.rose, paddingHorizontal: 18, paddingVertical: 12, marginTop: 0 },
  infoText: { color: colors.maroon, fontSize: 14 },
  twoCol: { flexDirection: 'row', gap: 10, paddingHorizontal: 16 },
  fakeSelect: {
    height: 48,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: '#FFFDFE',
    paddingHorizontal: 14,
    marginHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  fakeSelectText: { color: colors.ink, fontSize: 16 },
  upload: {
    marginHorizontal: 16,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#D8A4BC',
    backgroundColor: colors.rose,
    borderRadius: 12,
    minHeight: 108,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  uploadWithImage: { borderStyle: 'solid', borderColor: colors.maroon, minHeight: 170, padding: 0 },
  uploadPreview: { width: '100%', height: 170, resizeMode: 'cover' },
  uploadOverlay: { position: 'absolute', left: 10, right: 10, bottom: 10, borderRadius: 10, backgroundColor: 'rgba(74,17,43,0.78)', paddingVertical: 8, alignItems: 'center' },
  uploadOverlayText: { color: 'white', fontSize: 13, fontWeight: '700' },
  uploadIcon: { color: colors.maroon, fontSize: 28 },
  uploadTitle: { color: colors.maroon, fontSize: 16, fontWeight: '700', marginTop: 4 },
  uploadSub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  aiAnalysisCard: { marginHorizontal: 16, marginTop: 10, backgroundColor: '#F0FDF4', borderRadius: 12, borderWidth: 1, borderColor: '#BBF7D0', padding: 12 },
  aiAnalysisTitle: { color: colors.green, fontSize: 13, fontWeight: '700' },
  aiProgressTrack: { height: 7, borderRadius: 7, backgroundColor: '#DCFCE7', overflow: 'hidden', marginTop: 9 },
  aiProgressFill: { height: 7, width: '72%', borderRadius: 7, backgroundColor: colors.green },
  aiAccuracyText: { color: colors.green, fontSize: 12, fontWeight: '700', marginTop: 8 },
  aiAnalysisText: { color: colors.ink, fontSize: 13, lineHeight: 20, marginTop: 3 },
  estimate: { margin: 16, backgroundColor: colors.goldPale, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#F4D385' },
  estimateLabel: { color: '#A16207', fontSize: 13, fontWeight: '700' },
  estimateValue: { color: '#A16207', fontSize: 24, fontWeight: '700' },
  weightCard: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  weightIcon: { color: colors.maroon, fontSize: 24 },
  smallUpper: { color: colors.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' },
  weightInputRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 },
  weightInput: { borderWidth: 1.5, borderColor: colors.maroon, borderRadius: 8, minWidth: 78, height: 38, color: colors.maroon, fontSize: 18, fontWeight: '700', textAlign: 'center' },
  kgText: { color: colors.ink, fontWeight: '700' },
  miniMuted: { color: colors.muted, fontSize: 11, textAlign: 'right' },
  quickEarn: { color: colors.maroon, fontSize: 18, fontWeight: '700' },
  priceTable: { margin: 16, borderRadius: 14, overflow: 'hidden', backgroundColor: 'white', borderWidth: 1, borderColor: colors.line },
  priceHead: { backgroundColor: colors.maroon, padding: 14 },
  priceHeadTitle: { color: 'white', fontSize: 18, fontWeight: '700' },
  priceHeadSub: { color: 'rgba(255,255,255,0.7)', marginTop: 2 },
  priceColumns: { flexDirection: 'row', backgroundColor: '#F7F1F4', paddingHorizontal: 10, paddingVertical: 8, gap: 8 },
  colLabel: { color: colors.muted, fontSize: 10, fontWeight: '700', width: 72, textAlign: 'right' },
  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 11, borderTopWidth: 1, borderColor: colors.line },
  priceRowHighlight: { backgroundColor: '#FFF7FA' },
  priceTitle: { color: colors.ink, fontSize: 13, lineHeight: 17, fontWeight: '600', flexShrink: 1 },
  priceTitleStrong: { color: colors.maroon, fontWeight: '700' },
  priceSub: { color: colors.muted, fontSize: 11 },
  rateText: { width: 62, color: colors.ink, textAlign: 'right', fontWeight: '700', fontSize: 13 },
  totalText: { width: 82, color: colors.maroon, textAlign: 'right', fontWeight: '700', fontSize: 13 },
  finalRow: { backgroundColor: colors.maroon, padding: 14, flexDirection: 'row', alignItems: 'center' },
  finalLabel: { color: 'rgba(255,255,255,0.75)', fontSize: 14 },
  finalSub: { color: 'rgba(255,255,255,0.55)', fontSize: 12 },
  finalValue: { color: colors.goldPale, fontSize: 24, fontWeight: '700' },
  noteBlue: { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE', borderWidth: 1, marginHorizontal: 16, marginBottom: 10, borderRadius: 10, padding: 12 },
  noteGold: { backgroundColor: '#FFF7ED', borderColor: '#FDBA74', borderWidth: 1, marginHorizontal: 16, marginBottom: 4, borderRadius: 10, padding: 12 },
  noteGreen: { backgroundColor: colors.greenPale, borderColor: '#86EFAC', borderWidth: 1, marginHorizontal: 16, marginTop: 12, borderRadius: 10, padding: 12 },
  noteText: { color: colors.maroon, fontSize: 13, lineHeight: 20 },
  contactSection: { marginHorizontal: 16, marginTop: 12, paddingTop: 2, paddingBottom: 14, backgroundColor: 'white', borderRadius: 14, borderWidth: 1, borderColor: colors.line },
  contactSectionHead: { padding: 14, borderBottomWidth: 1, borderColor: colors.line },
  contactSectionTitle: { color: colors.ink, fontSize: 17, fontWeight: '700' },
  contactSectionHint: { color: colors.muted, fontSize: 12, marginTop: 3 },
  success: { flex: 1, alignItems: 'center', paddingHorizontal: 28, paddingTop: 74 },
  successCircle: { width: 76, height: 76, borderRadius: 38, backgroundColor: colors.rose, alignItems: 'center', justifyContent: 'center' },
  successGold: { backgroundColor: colors.goldPale },
  successIcon: { fontSize: 34 },
  successTitle: { color: colors.maroon, fontSize: 28, fontWeight: '700', marginTop: 18, textAlign: 'center' },
  successGoldText: { color: '#B45309' },
  refNo: { marginTop: 16, borderWidth: 1, borderColor: '#F7C948', borderRadius: 10, paddingHorizontal: 18, paddingVertical: 10, color: colors.maroon, fontSize: 17, fontWeight: '700', letterSpacing: 2 },
  successDesc: { color: colors.muted, fontSize: 15, lineHeight: 24, textAlign: 'center', marginTop: 18, marginBottom: 10 },
  officerCard: { width: '100%', marginHorizontal: 0 },
  officerName: { color: colors.ink, fontSize: 18, fontWeight: '700' },
  officerMeta: { color: colors.muted, fontSize: 12, marginTop: 2 },
  comingSoonPage: { flex: 1, alignItems: 'center', paddingHorizontal: 24, paddingTop: 62 },
  comingSoonArt: { width: 104, height: 104, borderRadius: 52, backgroundColor: colors.goldPale, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#F7C948' },
  comingSoonIcon: { fontSize: 42 },
  comingSoonKicker: { color: colors.gold, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', marginTop: 22 },
  comingSoonTitle: { color: colors.ink, fontSize: 25, lineHeight: 32, fontWeight: '700', textAlign: 'center', marginTop: 8 },
  comingSoonDesc: { color: colors.muted, fontSize: 15, lineHeight: 24, textAlign: 'center', marginTop: 12 },
  comingSoonList: { alignSelf: 'stretch', backgroundColor: 'white', borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: 14, marginTop: 18, marginBottom: 8 },
  comingSoonListItem: { color: colors.maroon, fontSize: 14, lineHeight: 23 },
  deliveryBanner: { margin: 16, backgroundColor: colors.maroon, borderRadius: 9, padding: 12 },
  deliveryText: { color: 'white', fontSize: 14, fontWeight: '700' },
  segment: { margin: 16, padding: 4, borderRadius: 24, backgroundColor: '#EEE9EC', flexDirection: 'row' },
  segmentActive: { flex: 1, color: 'white', backgroundColor: colors.maroon, padding: 10, borderRadius: 20, textAlign: 'center', fontWeight: '700' },
  segmentInactive: { flex: 1, color: colors.muted, padding: 10, textAlign: 'center', fontWeight: '700' },
  productCard: { marginHorizontal: 16, marginTop: 10, backgroundColor: 'white', borderRadius: 10, padding: 14, flexDirection: 'row', gap: 12, borderWidth: 1, borderColor: colors.line },
  disabledCard: { opacity: 0.55 },
  productIcon: { width: 58, height: 58, borderRadius: 10, backgroundColor: colors.rose, textAlign: 'center', textAlignVertical: 'center', fontSize: 28, overflow: 'hidden' },
  productTitle: { color: colors.ink, fontSize: 16, lineHeight: 20, fontWeight: '700', flexShrink: 1 },
  productSub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  productPrice: { color: colors.maroon, fontSize: 20, fontWeight: '700', marginTop: 6 },
  mutedPrice: { color: colors.muted },
  unit: { color: colors.muted, fontSize: 12, fontWeight: '400' },
  orderHeroCard: { flexDirection: 'row', gap: 14, alignItems: 'center', backgroundColor: '#FFF8ED', borderColor: '#F4D385' },
  orderProductVisual: { width: 118, minHeight: 142, borderRadius: 18, backgroundColor: colors.maroon, alignItems: 'center', justifyContent: 'center', padding: 12, overflow: 'hidden' },
  orderProductEmoji: { fontSize: 38, marginBottom: 8 },
  orderSackText: { color: 'white', fontSize: 15, lineHeight: 18, fontWeight: '700', textAlign: 'center' },
  orderSackWeight: { color: colors.goldPale, fontSize: 12, fontWeight: '700', marginTop: 5 },
  orderHeroCopy: { flex: 1 },
  orderHeroTitle: { color: colors.ink, fontSize: 21, lineHeight: 27, fontWeight: '700', marginTop: 8 },
  orderHeroSub: { color: colors.muted, fontSize: 13, lineHeight: 20, marginTop: 5 },
  orderInfoCard: { padding: 14 },
  orderSectionTitle: { color: colors.ink, fontSize: 17, fontWeight: '700', marginBottom: 8 },
  orderDescription: { color: colors.muted, fontSize: 13, lineHeight: 21 },
  orderFeatureRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  orderFeature: { flex: 1, backgroundColor: 'white', borderRadius: 12, borderWidth: 1, borderColor: colors.line, padding: 10, alignItems: 'center' },
  orderFeatureIcon: { fontSize: 20 },
  orderFeatureTitle: { color: colors.ink, fontSize: 12, lineHeight: 16, fontWeight: '700', textAlign: 'center', marginTop: 4 },
  orderFeatureSub: { color: colors.muted, fontSize: 10, textAlign: 'center', marginTop: 2 },
  orderSummaryCard: { marginHorizontal: 16, marginTop: 12, borderRadius: 14, backgroundColor: 'white', borderWidth: 1, borderColor: colors.line, padding: 14 },
  orderSummaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 7, borderBottomWidth: 1, borderColor: '#F0E6EC' },
  orderSummaryLabel: { color: colors.muted, fontSize: 13 },
  orderSummaryValue: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  orderSummaryTotal: { borderBottomWidth: 0, marginTop: 2 },
  orderSummaryTotalText: { color: colors.maroon, fontSize: 16, fontWeight: '700' },
  orderProduct: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 },
  qtyRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 8, flexWrap: 'wrap' },
  qtyBtn: { width: 38, height: 38, borderRadius: 8, backgroundColor: '#F6F1F4', borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  qtyText: { color: colors.maroon, fontSize: 20 },
  qtyNumber: { color: colors.ink, fontSize: 22, fontWeight: '700' },
  qtyTotal: { color: colors.maroon, fontSize: 15, fontWeight: '700' },
  chips: { paddingHorizontal: 12, marginTop: 10, maxHeight: 48 },
  chip: { borderWidth: 1, borderColor: colors.line, borderRadius: 18, paddingHorizontal: 18, paddingVertical: 8, marginRight: 8, color: colors.maroon, fontWeight: '700', backgroundColor: 'white' },
  chipActive: { backgroundColor: colors.maroon, color: 'white', borderColor: colors.maroon },
  moduleGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 10, paddingHorizontal: 14, paddingTop: 10 },
  moduleCard: { width: '48%', backgroundColor: 'white', borderRadius: 10, overflow: 'hidden', borderWidth: 1, borderColor: colors.line },
  moduleThumb: { height: 92, alignItems: 'center', justifyContent: 'center' },
  moduleIcon: { fontSize: 34 },
  moduleTitle: { color: colors.ink, fontSize: 13, lineHeight: 17, fontWeight: '700', paddingHorizontal: 10, paddingTop: 10 },
  moduleSub: { color: colors.muted, fontSize: 11, paddingHorizontal: 10, marginTop: 2 },
  moduleCount: { color: colors.maroon, fontSize: 12, fontWeight: '700', padding: 10 },
  learningList: { paddingHorizontal: 16, paddingTop: 10, gap: 12 },
  learningCard: { backgroundColor: 'white', borderRadius: 16, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  learningThumb: { minHeight: 92, padding: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  learningBody: { padding: 14, paddingTop: 10 },
  learningMaterial: { flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: '#FBF8FA', borderRadius: 12, padding: 10, marginTop: 10 },
  learningMaterialIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: 'white', textAlign: 'center', textAlignVertical: 'center', overflow: 'hidden', color: colors.maroon, fontSize: 16 },
  learningMaterialLabel: { color: colors.muted, fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  learningMaterialTitle: { color: colors.ink, fontSize: 13, lineHeight: 18, fontWeight: '700', marginTop: 1 },
  quizBox: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, padding: 12, borderRadius: 14, backgroundColor: colors.maroon },
  quizIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  quizIconText: { color: 'white', fontSize: 20, fontWeight: '700' },
  quizTitle: { color: 'white', fontSize: 14, lineHeight: 18, fontWeight: '700' },
  quizSub: { color: 'rgba(255,255,255,0.72)', fontSize: 11, marginTop: 2 },
  quizStatus: { color: colors.goldPale, fontSize: 12, fontWeight: '700' },
  trainingContentHero: { alignItems: 'center', paddingVertical: 24 },
  trainingContentIcon: { width: 86, height: 86, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  trainingContentKicker: { color: colors.muted, fontSize: 12, fontWeight: '700', textAlign: 'center' },
  trainingContentTitle: { color: colors.ink, fontSize: 22, lineHeight: 29, fontWeight: '700', textAlign: 'center', marginTop: 8 },
  trainingContentMeta: { color: colors.maroon, fontSize: 13, fontWeight: '700', marginTop: 10 },
  trainingContentBody: { padding: 18 },
  trainingParagraph: { color: colors.ink, fontSize: 15, lineHeight: 24 },
  trainingBullet: { color: colors.muted, fontSize: 14, lineHeight: 23, marginTop: 8 },
  videoLessonCard: { marginHorizontal: 16, marginTop: 12, borderRadius: 18, backgroundColor: colors.maroon, minHeight: 260, alignItems: 'center', justifyContent: 'center', padding: 22 },
  videoPlayCircle: { width: 78, height: 78, borderRadius: 39, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  videoPlayIcon: { color: 'white', fontSize: 34, marginLeft: 4 },
  videoLessonTitle: { color: 'white', fontSize: 20, lineHeight: 26, fontWeight: '700', textAlign: 'center', marginTop: 18 },
  videoLessonSub: { color: 'rgba(255,255,255,0.74)', fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 8 },
  notice: { backgroundColor: '#FFF8E1', padding: 14, borderBottomWidth: 1, borderColor: colors.line },
  noticeText: { color: '#92400E', fontSize: 14, fontWeight: '700' },
  apiNotice: { marginHorizontal: 16, marginTop: 10, marginBottom: 4, padding: 12, borderRadius: 12, backgroundColor: '#FFF7FA', borderWidth: 1, borderColor: colors.line, color: colors.maroon, fontSize: 13, lineHeight: 19 },
  projectApply: { padding: 14 },
  projectApplyHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  projectProgress: { color: colors.muted, fontWeight: '700' },
  projectName: { color: colors.ink, fontSize: 17, fontWeight: '700', marginTop: 10 },
  progressBar: { height: 6, borderRadius: 6, backgroundColor: colors.rose, marginTop: 14, marginBottom: 12, overflow: 'hidden' },
  progressFill: { height: 6, width: '76%', backgroundColor: colors.maroon },
  coolProject: { backgroundColor: '#EFF6FF' },
  stepRow: { marginHorizontal: 16, padding: 14, borderWidth: 1, borderColor: colors.line, backgroundColor: 'white', flexDirection: 'row', alignItems: 'center', gap: 14 },
  stepNum: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.maroon, color: 'white', textAlign: 'center', textAlignVertical: 'center', overflow: 'hidden', fontWeight: '700' },
  stepTitle: { color: colors.ink, fontSize: 16, fontWeight: '700' },
  stepSub: { color: colors.muted, fontSize: 12 },
  progressLine: { height: 4, backgroundColor: colors.maroon, width: '40%' },
  pageTitle: { color: colors.ink, fontSize: 24, fontWeight: '700', marginHorizontal: 20, marginTop: 16 },
  filterRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 14 },
  filter: { paddingHorizontal: 18, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F0EAEE', color: colors.muted, fontWeight: '700' },
  filterActive: { backgroundColor: colors.maroon, color: 'white' },
  search: { margin: 16, backgroundColor: 'white', borderRadius: 10, borderWidth: 1, borderColor: colors.line, flexDirection: 'row', alignItems: 'center', padding: 8 },
  searchIcon: { color: colors.muted, marginHorizontal: 8 },
  searchInput: { flex: 1, height: 36, backgroundColor: '#F7F3F5', borderRadius: 10, paddingHorizontal: 12, color: colors.ink },
  searchButton: { backgroundColor: colors.maroon, color: 'white', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, marginLeft: 8, overflow: 'hidden', fontWeight: '700' },
  officerRow: { flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 9 },
  avatar: { width: 42, height: 42, borderRadius: 12, backgroundColor: colors.rose, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.maroon, fontWeight: '700' },
  officerAction: { width: 38, height: 38, borderRadius: 14, backgroundColor: colors.rose, color: colors.maroon, textAlign: 'center', textAlignVertical: 'center', overflow: 'hidden', fontSize: 19 },
  postBox: { margin: 16, marginTop: 12, backgroundColor: 'white', borderRadius: 12, borderWidth: 1, borderColor: colors.line, padding: 10, flexDirection: 'row', gap: 8, alignItems: 'center' },
  postAvatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.rose, textAlign: 'center', textAlignVertical: 'center', overflow: 'hidden' },
  postInput: { flex: 1, height: 36, backgroundColor: '#F7F3F5', borderRadius: 10, paddingHorizontal: 12 },
  postButton: { backgroundColor: colors.maroon, color: 'white', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, overflow: 'hidden', fontWeight: '700' },
  postCard: { padding: 14 },
  postHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  postName: { color: colors.ink, fontSize: 16, fontWeight: '700' },
  postText: { color: colors.ink, fontSize: 15, lineHeight: 24, marginTop: 12 },
  postActions: { flexDirection: 'row', justifyContent: 'space-around', borderTopWidth: 1, borderColor: colors.line, marginTop: 12, paddingTop: 10 },
  postAction: { color: colors.muted, fontWeight: '700' },
  projectHero: { margin: 16, marginBottom: 8, backgroundColor: colors.maroon, borderRadius: 18, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 12 },
  projectHeroIcon: { width: 52, height: 52, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  projectHeroEmoji: { color: 'white', fontSize: 25 },
  projectHeroTitle: { color: 'white', fontSize: 22, fontWeight: '700' },
  projectHeroSub: { color: 'rgba(255,255,255,0.76)', fontSize: 12, lineHeight: 18, marginTop: 4 },
  projectStatGrid: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, marginTop: 4 },
  projectStatCard: { width: '31.5%', minHeight: 78, backgroundColor: 'white', borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: 8, alignItems: 'center', justifyContent: 'center' },
  projectStatValue: { color: colors.maroon, fontSize: 18, fontWeight: '700' },
  projectStatLabel: { color: colors.muted, fontSize: 9, lineHeight: 12, textAlign: 'center', textTransform: 'uppercase', marginTop: 4 },
  projectDetailCard: { marginHorizontal: 16, marginTop: 8, backgroundColor: 'white', borderRadius: 18, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  projectDetailTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 16, backgroundColor: '#FFF7FA' },
  projectDetailName: { color: colors.ink, fontSize: 18, lineHeight: 23, fontWeight: '700' },
  projectDetailMeta: { color: colors.muted, fontSize: 12, marginTop: 4 },
  projectBalance: { alignItems: 'flex-end', minWidth: 76 },
  projectBalanceLabel: { color: colors.muted, fontSize: 11 },
  projectBalanceValue: { color: colors.maroon, fontSize: 17, fontWeight: '700', marginTop: 3 },
  projectHealthBar: { marginHorizontal: 16, marginTop: 14, height: 8, borderRadius: 8, backgroundColor: colors.rose, overflow: 'hidden' },
  projectHealthFill: { width: '65%', height: 8, backgroundColor: colors.maroon },
  projectHealthText: { color: colors.muted, fontSize: 12, marginHorizontal: 16, marginTop: 8, marginBottom: 10 },
  projectProgressHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginTop: 8 },
  projectProgressBadge: { color: colors.maroon, fontSize: 12, fontWeight: '700', backgroundColor: colors.rose, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  projectStats: { backgroundColor: colors.maroon, flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 18, marginTop: 14 },
  ledgerCard: { padding: 0, overflow: 'hidden' },
  ledgerHead: { backgroundColor: colors.rose, padding: 16 },
  timeline: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingVertical: 16, paddingHorizontal: 8 },
  timelineItem: { alignItems: 'center', width: 72 },
  timelineDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#E7E0E4', marginBottom: 8 },
  timelineDone: { backgroundColor: colors.maroon },
  timelineCurrent: { backgroundColor: colors.gold },
  connectedTimeline: { flexDirection: 'row', paddingHorizontal: 8, paddingTop: 16, paddingBottom: 18 },
  connectedStep: { flex: 1, alignItems: 'center' },
  timelineNodeRow: { flexDirection: 'row', alignItems: 'center', width: '100%', minHeight: 32 },
  timelineConnector: { flex: 1, height: 3, borderRadius: 3 },
  timelineConnectorGhost: { flex: 1, height: 3 },
  timelineConnectorDone: { backgroundColor: colors.maroon },
  timelineConnectorPending: { backgroundColor: '#E7E0E4' },
  timelineNode: { width: 30, height: 30, borderRadius: 15, backgroundColor: '#F2E8EE', borderWidth: 2, borderColor: '#E7E0E4', alignItems: 'center', justifyContent: 'center' },
  timelineNodeDone: { backgroundColor: colors.maroon, borderColor: colors.maroon },
  timelineNodeCurrent: { backgroundColor: colors.gold, borderColor: '#D97706' },
  timelineNodeText: { color: 'white', fontSize: 12, fontWeight: '700' },
  timelineNodeTextPending: { color: colors.muted },
  timelineText: { color: colors.muted, fontSize: 10, textAlign: 'center', lineHeight: 14, marginTop: 6, paddingHorizontal: 2 },
  timelineTextCurrent: { color: colors.ink, fontWeight: '700' },
  ledgerRow: { flexDirection: 'row', justifyContent: 'space-between', borderTopWidth: 1, borderColor: colors.line, paddingVertical: 10, paddingHorizontal: 16 },
  ledgerLabel: { color: colors.muted, fontSize: 14 },
  ledgerStrong: { color: colors.ink, fontWeight: '700' },
  ledgerValue: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  greenText: { color: colors.green },
  profileHead: { backgroundColor: colors.maroon, alignItems: 'center', paddingVertical: 30 },
  profileAvatar: { width: 74, height: 74, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.22)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)', alignItems: 'center', justifyContent: 'center' },
  profileAvatarText: { color: 'white', fontSize: 24, fontWeight: '700' },
  profileName: { color: 'white', fontSize: 20, fontWeight: '700', marginTop: 10 },
  profileMeta: { color: 'rgba(255,255,255,0.75)', marginTop: 6 },
  profileBadge: { backgroundColor: 'rgba(255,255,255,0.25)', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 16, marginTop: 8 },
  profileBadgeText: { color: 'white', fontWeight: '700' },
  menuCard: { padding: 0, overflow: 'hidden' },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderBottomWidth: 1, borderColor: colors.line },
  menuIcon: { width: 40, height: 40, borderRadius: 10, backgroundColor: '#F0EAEE', color: colors.maroon, textAlign: 'center', textAlignVertical: 'center', overflow: 'hidden', fontSize: 18 },
  menuTitle: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  menuSub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  languagePill: { minWidth: 48, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.maroon, alignItems: 'center' },
  languagePillText: { color: 'white', fontSize: 12, fontWeight: '700' },
  logout: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  logoutIcon: { color: colors.danger, fontSize: 24 },
  logoutTitle: { color: colors.danger, fontWeight: '700', fontSize: 16 },
  version: { color: colors.muted, fontSize: 11, textAlign: 'center', marginVertical: 16 },
});

