import { StatusBar as ExpoStatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { Audio } from 'expo-av';
import { Ionicons } from '@expo/vector-icons';
import { GoogleGenAI, MediaResolution } from '@google/genai';
import { Component, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import YoutubePlayer from 'react-native-youtube-iframe';
import {
  ActivityIndicator,
  Animated,
  Easing,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Pressable,
  RefreshControl,
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
  | 'gpsGrant'
  | 'shathiApa'
  | 'apaVoice'
  | 'apaCamera'
  | 'login'
  | 'personalInfo'
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
  | 'cattleMeasure'
  | 'cattlePrice'
  | 'cattleDone'
  | 'inputsForm'
  | 'inputsPrice'
  | 'buyCategories'
  | 'buyProducts'
  | 'buyOrder'
  | 'buyDone'
  | 'training'
  | 'trainingCategory'
  | 'trainingModule'
  | 'trainingArticle'
  | 'trainingVideo'
  | 'trainingQuiz'
  | 'partnerRegister'
  | 'kyc'
  | 'regDone'
  | 'menuPersonal'
  | 'menuBanking'
  | 'menuFarm'
  | 'menuKyc'
  | 'menuFaq'
  | 'marketUpdates'
  | 'marketDetail'
  | 'officers'
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
// Draft for the livestock "List for Sale" flow (form -> measure -> price).
type ListingDraft = {
  categorySlug: string;          // 'livestock' | 'inputs' | ...
  animalId: string | null;
  animalName: string;
  species: string | null;
  breedId: string | null;
  breedName: string;
  saleItemId: string | null;     // for inputs: seeds/feed/fertilizer item
  saleItemName: string;
  variety: string;               // for inputs: brand / variety name
  unit: string;                  // kg / piece / sack
  ageMonths: string;
  weightKg: string;              // for inputs this is the quantity in `unit`
  quantity: string;
  description: string;
  aiGenerating: boolean;
  images: string[];
  divisionId: string | null;
  divisionName: string;
  districtId: string | null;
  districtName: string;
  thanaId: string | null;
  thanaName: string;
  thanaOther: boolean;           // user typed a thana not in the list
  contactSelf: boolean;          // true = me, false = someone else
  contactName: string;
  contactPhone: string;
  contactNid: string;
  addressText: string;
  measure: { girth: string; length: string; height: string; weightKg: number } | null;
};
function makeListingDraft(): ListingDraft {
  return {
    categorySlug: 'livestock',
    animalId: null, animalName: '', species: null,
    breedId: null, breedName: '',
    saleItemId: null, saleItemName: '', variety: '', unit: 'kg',
    ageMonths: '24', weightKg: '', quantity: '1',
    description: '', aiGenerating: false, images: [],
    divisionId: null, divisionName: '', districtId: null, districtName: '',
    thanaId: null, thanaName: '', thanaOther: false,
    contactSelf: true, contactName: '', contactPhone: '', contactNid: '', addressText: '', measure: null,
  };
}
type WeatherApiState = { data: ApiRow | null; loading: boolean; error: string | null; usingFallback: boolean };
type LocationState = {
  query: string;
  label: string;
  loading: boolean;
  granted: boolean;
  error: string | null;
  fallback: boolean;
  latitude?: number | null;
  longitude?: number | null;
  detected?: { division?: string; district?: string; thana?: string } | null;
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
const SERVER_FALLBACK_MESSAGE = 'We could not load this from current server.';

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

const MONTHS_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_BN = ['জানু', 'ফেব্রু', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্ট', 'অক্টো', 'নভে', 'ডিসে'];

// Formats a DB date/datetime into a readable, language-aware label
// (avoids raw ISO strings leaking into the UI).
function formatDate(value: unknown, lang: Lang) {
  if (!value) return '';
  const date = new Date(value as string);
  if (Number.isNaN(date.getTime())) return String(value);
  const day = date.getDate();
  const month = date.getMonth();
  const year = date.getFullYear();
  return lang === 'bn'
    ? `${bn(day)} ${MONTHS_BN[month]} ${bn(year)}`
    : `${day} ${MONTHS_EN[month]} ${year}`;
}

// Humanizes snake_case / SCREAMING_CASE enum values into Title Case labels.
function humanizeLabel(value: unknown) {
  if (value == null) return '';
  return String(value)
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// Bilingual labels for backend enum values (status / step / type) so bn mode
// never shows raw English tokens.
const ENUM_LABELS: Record<string, [string, string]> = {
  draft: ['খসড়া', 'Draft'], submitted: ['জমা হয়েছে', 'Submitted'], needs_document: ['ডকুমেন্ট দরকার', 'Needs document'],
  officer_verification: ['কর্মকর্তা যাচাই', 'Officer verification'], ready_to_approve: ['অনুমোদনের অপেক্ষায়', 'Ready to approve'],
  approved: ['অনুমোদিত', 'Approved'], rejected: ['বাতিল', 'Rejected'], pending: ['অপেক্ষমাণ', 'Pending'],
  project_selection: ['প্রকল্প নির্বাচন', 'Project selection'], personal_kyc: ['ব্যক্তিগত KYC', 'Personal KYC'],
  banking_info: ['ব্যাংকিং তথ্য', 'Banking info'], farm_assessment: ['খামার মূল্যায়ন', 'Farm assessment'],
  field_verification: ['মাঠ যাচাই', 'Field verification'], approval: ['অনুমোদন', 'Approval'],
  open: ['চলমান', 'Open'], opening_soon: ['শীঘ্রই', 'Soon'], closed: ['বন্ধ', 'Closed'], completed: ['সম্পন্ন', 'Completed'],
  price: ['দর', 'Price'], stock: ['স্টক', 'Stock'], training: ['প্রশিক্ষণ', 'Training'], notice: ['নোটিশ', 'Notice'], weather: ['আবহাওয়া', 'Weather'],
  active: ['সক্রিয়', 'Active'], sold: ['বিক্রিত', 'Sold'], cancelled: ['বাতিল', 'Cancelled'],
  livestock: ['গবাদিপশু', 'Livestock'], poultry: ['পোল্ট্রি', 'Poultry'], crops: ['ফসল', 'Crops'],
  fishery: ['মৎস্য', 'Fishery'], vegetables: ['সবজি', 'Vegetables'], fruits: ['ফল', 'Fruits'],
  field_officer: ['মাঠ কর্মকর্তা', 'Field officer'], ho_query_officer: ['এইচও কর্মকর্তা', 'HO officer'], community_officer: ['কমিউনিটি কর্মকর্তা', 'Community officer'],
  question: ['প্রশ্ন', 'Question'], update: ['আপডেট', 'Update'], general: ['সাধারণ', 'General'], complaint: ['অভিযোগ', 'Complaint'], crop: ['ফসল', 'Crop'],
};
function tEnum(value: unknown, lang: Lang) {
  const key = String(value ?? '').toLowerCase().trim();
  const pair = ENUM_LABELS[key];
  return pair ? (lang === 'bn' ? pair[0] : pair[1]) : humanizeLabel(value);
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

type AppRole = 'field_officer' | 'shathisheba_seller' | 'shathisheba_buyer';

type AuthUser = {
  id: string;
  full_name?: string | null;
  display_name?: string | null;
  phone?: string | null;
  gender?: string | null;
  date_of_birth?: string | null;
  district?: string | null;
  upazila?: string | null;
  profile_image_url?: string | null;
  status?: string | null;
  roles?: AppRole[];
  division?: string | null;
  is_kyc_verified?: boolean;
  nid_number?: string | null;
  kyc?: { nid?: string; selfie?: string; trade_license?: string; banking?: boolean; document_count?: number } | null;
  preferences?: { categories?: string[]; items?: Record<string, string[]> } | null;
  needs_personal_info?: boolean;
  needs_preferences?: boolean;
};

const AUTH_STORAGE_KEY = 'shathi.auth.v1';

const AuthContext = createContext<{
  user: AuthUser | null;
  token: string | null;
  signIn: (user: AuthUser, token: string) => Promise<void>;
  updateUser: (patch: Partial<AuthUser>) => Promise<void>;
  signOut: () => Promise<void>;
}>({
  user: null,
  token: null,
  signIn: async () => {},
  updateUser: async () => {},
  signOut: async () => {},
});

function useAuth() {
  return useContext(AuthContext);
}

function hasRole(user: AuthUser | null, role: AppRole) {
  return Boolean(user?.roles?.includes(role));
}

// Post-login routing for the onboarding scenarios:
// personal info first (if missing), then preferences (if missing), else home.
function routeAfterAuth(user: AuthUser): Screen {
  if (user.needs_personal_info) return 'personalInfo';
  if (user.needs_preferences) return 'prefAnimal';
  return 'home';
}

function naturalApiError(error: unknown, lang: Lang) {
  const message = error instanceof Error ? error.message : String(error);
  if (/^TIMEOUT|timed out|took too long/i.test(message)) {
    return lang === 'bn'
      ? 'সার্ভার সাড়া দিতে দেরি করছে। ইন্টারনেট সংযোগ দেখে আবার চেষ্টা করুন।'
      : 'The server is taking too long to respond. Check your connection and try again.';
  }
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

// Lightweight global loading store: any in-flight apiRequest increments the
// counter; the GlobalLoader overlay subscribes and shows a branded spinner.
const loadingStore = {
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
const refreshStore = {
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

function useRefreshTick() {
  const [tick, setTick] = useState(refreshStore.tick);
  useEffect(() => refreshStore.subscribe(setTick), []);
  return tick;
}

// True while the soft keyboard is visible — used to hide the bottom nav so it
// stays at the device bottom (keyboard covers it) instead of floating up.
function useKeyboardVisible() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const show = Keyboard.addListener(showEvt, () => setVisible(true));
    const hide = Keyboard.addListener(hideEvt, () => setVisible(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return visible;
}

function usePullRefresh() {
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = () => {
    setRefreshing(true);
    refreshStore.trigger();
    setTimeout(() => setRefreshing(false), 900);
  };
  return { refreshing, onRefresh };
}

// ScrollView preset: pull-to-refresh + keeps taps working while keyboard is open.
function RefreshScroll({ children, style, contentContainerStyle }: { children: React.ReactNode; style?: any; contentContainerStyle?: any }) {
  const { refreshing, onRefresh } = usePullRefresh();
  return (
    <ScrollView
      style={style}
      contentContainerStyle={contentContainerStyle}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.maroon]} tintColor={colors.maroon} />}
    >
      {children}
    </ScrollView>
  );
}

const REQUEST_TIMEOUT_MS = 15000;

async function apiRequest<T = any>(resource: string, options?: RequestInit): Promise<T> {
  loadingStore.begin();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(apiUrl(resource), {
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(options?.headers || {}),
      },
      signal: controller.signal,
      ...options,
    });
    const json = await response.json().catch(() => ({}));
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
    loadingStore.end();
  }
}

async function uploadImage(uri: string, folder: string): Promise<string> {
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
    const response = await fetch(`${base}/api/upload`, { method: 'POST', body: form as any });
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

function GlobalLoader() {
  const [active, setActive] = useState(loadingStore.active);
  useEffect(() => loadingStore.subscribe(setActive), []);
  if (active <= 0) return null;
  return (
    <View pointerEvents="none" style={styles.loaderOverlay}>
      <View style={styles.loaderCard}>
        <ActivityIndicator size="large" color={colors.maroon} />
      </View>
    </View>
  );
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
  const refreshTick = useRefreshTick();
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
  }, [resource, lang, refreshTick]);
  return state;
}

// Onboarding interest tree (roots + children) from the backend — drives the
// DB-backed preference selection screens.
function useOnboardingTree() {
  const refreshTick = useRefreshTick();
  const [state, setState] = useState<{ roots: ApiRow[]; loading: boolean }>({ roots: [], loading: true });
  useEffect(() => {
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    apiRequest<{ data?: ApiRow[] }>('app/onboarding')
      .then((j) => { if (alive) setState({ roots: j.data ?? [], loading: false }); })
      .catch(() => { if (alive) setState({ roots: [], loading: false }); });
    return () => { alive = false; };
  }, [refreshTick]);
  return state;
}

const PREF_ROOT_SLUG: Record<PreferenceKey, string> = {
  cattle: 'livestock-poultry',
  crops: 'crops',
  fishery: 'fishery',
  vegetables: 'vegetables',
  fruits: 'fruits',
};

function safeEmoji(emoji: unknown, fallback: string) {
  const e = typeof emoji === 'string' ? emoji : '';
  return e && !e.includes('?') ? e : fallback;
}

// Builds the PreferenceSetupStep sections for a root slug from the onboarding
// tree, grouping children by step_group (e.g. livestock vs poultry).
function prefSectionsForRoot(roots: ApiRow[], rootSlug: string, lang: Lang, fallbackIcon: string): PreferenceSection[] {
  const root = roots.find((r) => String(r.slug) === rootSlug);
  const children = (root?.children ?? []) as ApiRow[];
  if (!children.length) return [];
  const groups = new Map<string, PreferenceOption[]>();
  for (const c of children) {
    const key = String(c.step_group || rootSlug);
    const opt: PreferenceOption = {
      id: String(c.slug),
      icon: safeEmoji(c.emoji, fallbackIcon),
      label: rowTitle(c, lang, c.name_en || c.name_bn || 'Item'),
    };
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(opt);
  }
  return Array.from(groups.entries()).map(([g, items]) => ({ title: tEnum(g, lang), items }));
}

function useAppHome(userId?: string | null) {
  const { lang } = useLanguage();
  const refreshTick = useRefreshTick();
  const [state, setState] = useState<{ data: ApiRow | null; loading: boolean }>({ data: null, loading: true });
  useEffect(() => {
    let alive = true;
    setState((current) => ({ ...current, loading: true }));
    const resource = userId ? `app/home?user_id=${encodeURIComponent(String(userId))}` : 'app/home';
    apiRequest<{ data?: ApiRow }>(resource)
      .then((json) => {
        if (alive) setState({ data: json.data ?? null, loading: false });
      })
      .catch(() => {
        if (alive) setState({ data: null, loading: false });
      });
    return () => {
      alive = false;
    };
  }, [userId, lang, refreshTick]);
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
    return (
      <View style={styles.statusLoading}>
        <ActivityIndicator color={colors.maroon} />
        <Text style={styles.statusLoadingText}>{tx('সার্ভার থেকে তথ্য আনা হচ্ছে...', 'Loading latest data…')}</Text>
      </View>
    );
  }
  if (state.error) {
    return (
      <View style={styles.statusError}>
        <Text style={styles.statusErrorIcon}>⚠️</Text>
        <Text style={styles.statusErrorTitle}>{tx('তথ্য আনা যায়নি', 'Could not load data')}</Text>
        <Text style={styles.statusErrorText}>{state.error}</Text>
        <Pressable onPress={() => refreshStore.trigger()} style={({ pressed }) => [styles.statusRetryBtn, pressed && styles.pressed]}>
          <Text style={styles.statusRetryText}>↻ {tx('আবার চেষ্টা করুন', 'Retry')}</Text>
        </Pressable>
      </View>
    );
  }
  if (!state.rows.length && empty) {
    return (
      <View style={styles.statusEmpty}>
        <Text style={styles.statusEmptyText}>{empty}</Text>
      </View>
    );
  }
  return null;
}

function shouldUseFallback<T>(state: ApiState<T>) {
  return !state.loading && (!!state.error || state.rows.length === 0);
}

function fallbackWarning<T>(state: ApiState<T>) {
  return shouldUseFallback(state) ? SERVER_FALLBACK_MESSAGE : null;
}

const fallbackMarketUpdates: ApiRow[] = [
  { id: 'fallback-market-1', title_bn: 'আজ গরুর বাজারদর ভালো', title_en: 'Cattle rate is strong today', description_bn: 'ময়মনসিংহ বাজারে জীবন্ত গরুর গড় দর কেজি প্রতি ৬৭০ টাকা।', description_en: 'Live cattle is averaging Tk 670 per kg in Mymensingh markets.', status: 'Live', update_type: 'price' },
  { id: 'fallback-market-2', title_bn: 'শাধীন ফিড আবার স্টকে এসেছে', title_en: 'Shadhin Feed is back in stock', description_bn: 'পার্টনার কৃষকদের জন্য ৫০ কেজি ক্যাটল ফিডের বস্তা পাওয়া যাচ্ছে।', description_en: '50kg cattle feed sacks are available for partner farmers.', status: 'Stock', update_type: 'stock' },
  { id: 'fallback-market-3', title_bn: 'নতুন প্রশিক্ষণ ভিডিও প্রকাশিত', title_en: 'New training video published', description_bn: 'ঈদ ব্যাচে তালিকা দেওয়ার আগে গরু মোটাতাজাকরণ চেকলিস্ট দেখে নিন।', description_en: 'Watch the cattle fattening checklist before Eid batch listing.', status: 'Training', update_type: 'training' },
];

const fallbackSaleCategories: ApiRow[] = [
  { id: 'fallback-sale-1', slug: 'crops', name_bn: 'ফসল', name_en: 'Crops', description_bn: 'ধান, ভুট্টা ও মৌসুমি ফসল', description_en: 'Rice, maize and seasonal harvests', status: 'soon' },
  { id: 'fallback-sale-2', slug: 'livestock', name_bn: 'গবাদিপশু', name_en: 'Livestock', description_bn: 'গরু তালিকা এখন সক্রিয়', description_en: 'Cattle listing is active now', status: 'active' },
  { id: 'fallback-sale-3', slug: 'inputs', name_bn: 'উপকরণ', name_en: 'Inputs', description_bn: 'বীজ, ফিড ও সার', description_en: 'Seeds, feed and fertilizer', status: 'soon' },
  { id: 'fallback-sale-4', slug: 'machinery', name_bn: 'যন্ত্রপাতি', name_en: 'Machinery', description_bn: 'ভাড়া ও সার্ভিস অনুরোধ', description_en: 'Rental and service requests', status: 'soon' },
];

const fallbackSaleItems: ApiRow[] = [
  { id: 'fallback-item-1', slug: 'cattle', name_bn: 'গরু', name_en: 'Cattle', description_bn: 'শাথী যাচাইয়ের মাধ্যমে গরু বা বলদ বিক্রি করুন', description_en: 'Sell cow or bull through Shathi verification', status: 'active' },
  { id: 'fallback-item-2', slug: 'goat', name_bn: 'ছাগল', name_en: 'Goat', description_bn: 'ছাগল তালিকা শিগগিরই চালু হবে', description_en: 'Goat listing will open soon', status: 'soon' },
  { id: 'fallback-item-3', slug: 'poultry', name_bn: 'পোল্ট্রি', name_en: 'Poultry', description_bn: 'মুরগি ও হাঁস তালিকা শিগগিরই চালু হবে', description_en: 'Chicken and duck listing will open soon', status: 'soon' },
  { id: 'fallback-item-4', slug: 'fish', name_bn: 'মৎস্য', name_en: 'Fishery', description_bn: 'মাছ তালিকা শিগগিরই চালু হবে', description_en: 'Fish listing will open soon', status: 'soon' },
];

const fallbackBuyCategories: ApiRow[] = [
  { id: 'fallback-buy-cat-1', slug: 'feed', name_bn: 'শাধীন ফিড', name_en: 'Shadhin Feed', description_bn: 'গরু, মাছ ও পোল্ট্রি ফিড', description_en: 'Cattle, fish and poultry feed' },
  { id: 'fallback-buy-cat-2', slug: 'seeds', name_bn: 'বীজ', name_en: 'Seeds', description_bn: 'ধান ও সবজি বীজ প্যাক', description_en: 'Rice and vegetable seed packs' },
  { id: 'fallback-buy-cat-3', slug: 'fertilizer', name_bn: 'সার', name_en: 'Fertilizer', description_bn: 'সুষম সার সহায়তা', description_en: 'Balanced fertilizer support' },
  { id: 'fallback-buy-cat-4', slug: 'medicine', name_bn: 'কৃষি ওষুধ', name_en: 'Agri-medicine', description_bn: 'ফসল ও প্রাণী যত্ন পণ্য', description_en: 'Crop and animal care products' },
  { id: 'fallback-buy-cat-5', slug: 'tools', name_bn: 'টুলস', name_en: 'Tools', description_bn: 'খামারের টুলস ও এক্সেসরিজ', description_en: 'Farm tools and accessories' },
  { id: 'fallback-buy-cat-6', slug: 'machinery', name_bn: 'যন্ত্র ভাড়া', name_en: 'Machinery rental', description_bn: 'মাঠের কাজের জন্য যন্ত্র বুক করুন', description_en: 'Book machines for field work' },
];

const fallbackBuyProducts: ApiRow[] = [
  { id: 101, sku: 'FALL-FEED-50', name_bn: 'শাধীন ক্যাটল ফিড', name_en: 'Shadhin Cattle Feed', description_bn: 'গরু মোটাতাজাকরণের জন্য উচ্চ প্রোটিন সুষম ফিড।', description_en: 'High protein balanced feed for cattle fattening.', package_size: '50kg', unit: 'sack', price: 1800, status: 'active', stock_qty: 45, low_stock_threshold: 8, metadata: '{"features":["High protein","Verified supplier"]}', delivery_window: '2-3 days' },
  { id: 102, sku: 'FALL-FISH-25', name_bn: 'শাধীন ফিশ ফিড', name_en: 'Shadhin Fish Feed', description_bn: 'মাছের স্বাস্থ্যকর বৃদ্ধির জন্য ফ্লোটিং ফিড।', description_en: 'Floating feed for healthy fish growth.', package_size: '25kg', unit: 'bag', price: 1250, status: 'active', stock_qty: 18, low_stock_threshold: 5, metadata: '{"features":["Floating feed","Clean packaging"]}', delivery_window: '2-3 days' },
  { id: 103, sku: 'FALL-POULTRY-50', name_bn: 'শাধীন পোল্ট্রি ফিড', name_en: 'Shadhin Poultry Feed', description_bn: 'দ্রুত ও সুষম বৃদ্ধির জন্য ব্রয়লার ফিড।', description_en: 'Broiler feed for fast and balanced growth.', package_size: '50kg', unit: 'sack', price: 1600, status: 'inactive', stock_qty: 0, low_stock_threshold: 5, metadata: '{"features":["Broiler grade","Fresh batch"]}', delivery_window: 'Coming soon' },
  { id: 104, sku: 'FALL-SEED-87', name_bn: 'BRRI ধান ৮৭ বীজ', name_en: 'BRRI Rice 87 Seed', description_bn: 'বোরো মৌসুমের সার্টিফায়েড ধান বীজ প্যাক।', description_en: 'Boro season certified rice seed pack.', package_size: '5kg', unit: 'pack', price: 320, status: 'active', stock_qty: 30, low_stock_threshold: 6, metadata: '{"features":["Certified seed","Boro season"]}', delivery_window: '1-2 days' },
];

const fallbackPartnerProjects: ApiRow[] = [
  { id: 201, project_code: 'FALL-EID-2024', title_bn: 'গরু মোটাতাজাকরণ ঈদ ব্যাচ ২০২৪', title_en: 'Cattle Fattening Eid Batch 2024', description_bn: 'উপকরণ সহায়তা ও বাজার সংযোগসহ চুক্তিভিত্তিক গবাদিপশু প্রকল্প।', description_en: 'Contract livestock project with input support and market linkage.', district: 'Mymensingh', upazila: 'Sadar', status: 'open', capacity: 120, lender_name: 'Shathi Finance', max_credit_amount: 75000, start_date: '2024-05-01', end_date: '2024-06-15', steps_json: '["Project selection","KYC","Verification","Approval"]', steps_bn_json: '["প্রকল্প নির্বাচন","KYC","যাচাই","অনুমোদন"]' },
  { id: 202, project_code: 'FALL-BORO-2025', title_bn: 'বোরো ধান চুক্তি প্রকল্প শীত ২০২৫', title_en: 'Boro Rice Contract Winter 2025', description_bn: 'বোরো কৃষকদের জন্য বীজ, পরামর্শ ও ক্রেতা সংযোগ।', description_en: 'Seed, advisory and buyer linkage for Boro farmers.', district: 'Jamalpur', upazila: 'Islampur', status: 'soon', capacity: 180, lender_name: 'Partner Bank', max_credit_amount: 45000, start_date: '2025-01-10', end_date: '2025-04-30' },
];

const fallbackLedgers: ApiRow[] = [
  { id: 'fallback-ledger-1', title_bn: 'বীজ ও ফিড উপকরণ', title_en: 'Seed and feed input', entry_type: 'input', amount: 62000 },
  { id: 'fallback-ledger-2', title_bn: 'সার্ভিস ও ভেট সহায়তা', title_en: 'Service and vet support', entry_type: 'service', amount: 8500 },
  { id: 'fallback-ledger-3', title_bn: 'আংশিক পেমেন্ট পাওয়া গেছে', title_en: 'Partial payment received', entry_type: 'payment', amount: 18000 },
  { id: 'fallback-ledger-4', title_bn: 'সম্ভাব্য লাভের অংশ', title_en: 'Projected profit share', entry_type: 'profit', amount: 27000 },
];

const fallbackOfficers: ApiRow[] = [
  { id: 'fallback-officer-1', name: 'Rana Hossain', role_bn: 'মাঠ কর্মকর্তা', role: 'Field Officer', district: 'Mymensingh', upazila: 'Sadar' },
  { id: 'fallback-officer-2', name: 'Sadia Akter', role_bn: 'কমিউনিটি কর্মকর্তা', role: 'Community Officer', district: 'Mymensingh', upazila: 'Sadar' },
];

const fallbackCommunityPosts: ApiRow[] = [
  { id: 'fallback-post-1', farmer_name: 'Md Rahim', post_type_bn: 'প্রশ্ন', post_type_en: 'Question', post_type: 'Question', body_bn: 'আমার গরু আজ কম খাচ্ছে। ভেট ডাকবার আগে কোন ফিড মিক্স চেষ্টা করতে পারি?', body_en: 'My cow is eating less today. What feed mix should I try before calling the vet?', like_count: 18, comment_count: 5, district: 'Mymensingh' },
  { id: 'fallback-post-2', farmer_name: 'Fatema Begum', post_type_bn: 'আপডেট', post_type_en: 'Update', post_type: 'Update', body_bn: 'আমাদের বোরো জমিতে BRRI ধান ৮৭ ভালো ফল দিয়েছে। অন্য কৃষকদের জন্য শেয়ার করলাম।', body_en: 'BRRI Rice 87 seed performed well in our Boro plot. Sharing this for other farmers.', like_count: 24, comment_count: 7, district: 'Jamalpur' },
];

const fallbackWeatherAlerts: ApiRow[] = [
  { id: 'fallback-weather-1', title_bn: 'বিকেলের জন্য বৃষ্টি সতর্কতা', title_en: 'Rain alert for afternoon', description_bn: 'মেঘ বাড়লে কাটা ফসল ঢেকে রাখুন এবং শুকানো কিছুটা দেরি করুন।', description_en: 'Keep harvested crops under cover and delay drying if clouds build up.', alert_type: 'rain', severity: 'warning' },
  { id: 'fallback-weather-2', title_bn: 'সেরা ফসল কাটার সময়', title_en: 'Best harvest window', description_bn: 'আজ সকাল থেকে দুপুর পর্যন্ত সবজি ও ফল কাটার জন্য তুলনামূলক নিরাপদ।', description_en: 'Morning to noon looks safer for cutting vegetables and fruits today.', alert_type: 'field_advice', severity: 'info' },
  { id: 'fallback-weather-3', title_bn: 'মেরিটাইম সিগন্যাল পর্যবেক্ষণ', title_en: 'Maritime signal watch', description_bn: 'বর্তমান সার্ভার থেকে কোনো গুরুতর মেরিটাইম পোর্ট সিগন্যাল পাওয়া যায়নি।', description_en: 'No critical maritime port signal is available from the current server.', alert_type: 'maritime', severity: 'info' },
];

const fallbackProfileUser: ApiRow = {
  id: 'fallback-user',
  display_name: 'Ramim',
  full_name: 'Ramim',
  phone: '01712-345678',
  district: 'Mymensingh',
};

function fallbackTrainingModulesFor(tx: (bnText: string, enText: string) => string): TrainingModule[] {
  return [
    { icon: '🐄', title: tx('গবাদিপশু পরিচর্যা', 'Livestock Care'), sub: tx('গরুর স্বাস্থ্য, ফিড ও মোটাতাজাকরণ', 'Cattle health, feed and fattening basics'), count: tx('৩টি কনটেন্ট', '3 contents'), article: tx('দৈনিক গরু পরিচর্যা চেকলিস্ট', 'Daily cattle care checklist'), video: tx('সুষম ফিড মেশানোর গাইড', 'Balanced feed mixing guide'), quiz: tx('গবাদিপশু পরিচর্যা কুইজ', 'Livestock care quiz'), progress: tx('শুরু করুন', 'Start'), bg: colors.rose, articleBody: tx('পরিষ্কার পানি, সুষম খাবার, ছায়া, টিকা রেকর্ড এবং প্রতিদিন খাবারের রুচি লক্ষ্য করুন। জ্বর, ফুলে যাওয়া, ডায়রিয়া বা হঠাৎ দুর্বলতা হলে ভেট ডাকুন।', 'Keep clean water, balanced feed, shade, vaccination records and daily appetite checks. Call a vet when fever, swelling, diarrhea or sudden weakness appears.'), videoUrl: tx('নমুনা ভিডিও কনটেন্ট', 'Sample video content') },
    { icon: '🌾', title: tx('ফসল উৎপাদন', 'Crop Production'), sub: tx('ধান, ভুট্টা ও মাঠ ফসল নির্দেশনা', 'Rice, maize and field crop guidance'), count: tx('৩টি কনটেন্ট', '3 contents'), article: tx('বোরো জমি প্রস্তুতির ধাপ', 'Boro field preparation steps'), video: tx('ধানের সার প্রয়োগের সময়', 'Fertilizer timing for rice'), quiz: tx('ফসল উৎপাদন কুইজ', 'Crop production quiz'), progress: tx('শুরু করুন', 'Start'), bg: colors.goldPale, articleBody: tx('জমি সমান করুন, সার্টিফায়েড বীজ ব্যবহার করুন, সেচ নিয়মিত রাখুন এবং সব সার একসাথে না দিয়ে বৃদ্ধির ধাপ অনুযায়ী দিন।', 'Prepare land evenly, use certified seed, keep irrigation consistent and apply fertilizer by growth stage instead of all at once.'), videoUrl: tx('নমুনা ভিডিও কনটেন্ট', 'Sample video content') },
    { icon: '🥬', title: tx('সবজি', 'Vegetables'), sub: tx('মৌসুমি সবজি ও পোকা ব্যবস্থাপনা', 'Seasonal vegetable growing and pest care'), count: tx('৩টি কনটেন্ট', '3 contents'), article: tx('নিরাপদ সবজি পোকা নিয়ন্ত্রণ', 'Safe vegetable pest control'), video: tx('উঁচু বেডে সবজি চাষ', 'Raised bed vegetable farming'), quiz: tx('সবজি কুইজ', 'Vegetable quiz'), progress: tx('শুরু করুন', 'Start'), bg: colors.greenPale, articleBody: tx('উঁচু বেড, ভালো পানি নিষ্কাশন, পরিষ্কার চারা ট্রে এবং নিয়মিত পোকা পর্যবেক্ষণ করুন। অপ্রয়োজনীয় কীটনাশক এড়িয়ে নিরাপদ অপেক্ষার সময় মানুন।', 'Use raised beds, good drainage, clean seedling trays and pest scouting. Avoid unnecessary pesticide and follow safe waiting periods.'), videoUrl: tx('নমুনা ভিডিও কনটেন্ট', 'Sample video content') },
    { icon: '🐟', title: tx('মৎস্য', 'Fishery'), sub: tx('পুকুর প্রস্তুতি, ফিড ও পানির মান', 'Pond preparation, feed and water quality'), count: tx('৩টি কনটেন্ট', '3 contents'), article: tx('পুকুরের পানির মান চেকলিস্ট', 'Pond water quality checklist'), video: tx('মাছের ফিড ব্যবস্থাপনা', 'Fish feed management'), quiz: tx('মৎস্য কুইজ', 'Fishery quiz'), progress: tx('শুরু করুন', 'Start'), bg: colors.bluePale, articleBody: tx('পানির রং, অক্সিজেন, পুকুরের গভীরতা ও খাবারের সাড়া দেখুন। অক্সিজেন কম থাকলে বা ভারী বৃষ্টির পর খাবার কমান।', 'Check water color, oxygen, pond depth and feed response. Reduce feeding during low oxygen and after heavy rain.'), videoUrl: tx('নমুনা ভিডিও কনটেন্ট', 'Sample video content') },
    { icon: '🍎', title: tx('ফল', 'Fruits'), sub: tx('ফলের বাগান পরিচর্যা ও হারভেস্ট পরিকল্পনা', 'Fruit orchard care and harvest planning'), count: tx('৩টি কনটেন্ট', '3 contents'), article: tx('ফল সংগ্রহ ও হ্যান্ডলিং', 'Fruit harvest handling'), video: tx('আম বাগানের মৌলিক যত্ন', 'Mango orchard care basics'), quiz: tx('ফল চাষ কুইজ', 'Fruit farming quiz'), progress: tx('শুরু করুন', 'Start'), bg: '#FCE7F3', articleBody: tx('সাবধানে ফল সংগ্রহ করুন, আঘাত লাগা এড়ান, আকার ও পরিপক্বতা অনুযায়ী বাছাই করুন এবং পরিবহনের আগে ছায়ায় রাখুন।', 'Harvest carefully, avoid bruising, sort by size and maturity, and keep fruits shaded before transport.'), videoUrl: tx('নমুনা ভিডিও কনটেন্ট', 'Sample video content') },
    { icon: '☁️', title: tx('আবহাওয়া-স্মার্ট কৃষি', 'Weather Smart Farming'), sub: tx('বৃষ্টি, গরম ও ঝড়ের ঝুঁকি প্রস্তুতি', 'Rain, heat and storm risk preparation'), count: tx('৩টি কনটেন্ট', '3 contents'), article: tx('ভারী বৃষ্টির আগে খামারের কাজ', 'Farm action before heavy rain'), video: tx('আবহাওয়া দেখে ফসল কাটার পরিকল্পনা', 'Weather-based harvest planning'), quiz: tx('আবহাওয়া কুইজ', 'Weather quiz'), progress: tx('শুরু করুন', 'Start'), bg: '#CCFBF1', articleBody: tx('কাটা ফসল ঢেকে রাখুন, গোয়ালঘর শক্ত করুন, নালা পরিষ্কার রাখুন এবং ভারী বৃষ্টির আগে সার প্রয়োগ এড়িয়ে চলুন।', 'Move harvested crops under cover, secure livestock sheds, clean drainage and avoid fertilizer application before heavy rain.'), videoUrl: tx('নমুনা ভিডিও কনটেন্ট', 'Sample video content') },
  ];
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

// Generates a short, plain sale-listing description from the first uploaded
// photo. Used by every listing type's description field.
// Category-gated AI sale-description (Shathi Apa). Returns NOT_RELEVANT when the
// photo is not the expected category so the caller can show a polite message.
async function generateListingDescription(uri: string, lang: Lang, opts: { kind: 'livestock' | 'inputs'; context?: string }) {
  const inlineData = await uriToInlineData(uri, 'image/jpeg');
  const rules = opts.kind === 'livestock'
    ? `The photo MUST clearly show a farm animal of one of these types only: cow, bull, buffalo, goat, sheep, poultry (chicken/duck). If it does NOT show such an animal, reply with EXACTLY the single token NOT_RELEVANT and nothing else. If it does, write a marketplace product sale description in 2-4 plain sentences (no markdown, no headings) covering the animal type, visible health/condition and approximate body size.`
    : `The photo MUST clearly show an agricultural input for sale: seeds, animal feed, or fertilizer (e.g. seed packets, feed/fertilizer sacks or containers). If it does NOT show such an input, reply with EXACTLY the single token NOT_RELEVANT and nothing else. If it does, write a marketplace product sale description in 2-4 plain sentences (no markdown, no headings) covering the input type, visible quality/condition and approximate quantity/packaging.`;
  const ctx = opts.context ? ` Where sensible, incorporate these seller-provided details: ${opts.context}.` : '';
  const response = await requireGenAI().models.generateContent({
    model: GEMINI_TEXT_MODEL,
    config: GEMINI_TEXT_CONFIG,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData },
          { text: `You are Shathi Apa, writing short marketplace sale descriptions for a Bangladeshi farmer app. ${rules}${ctx} Be factual; never invent prices. Reply in ${lang === 'bn' ? 'Bengali Bangla' : 'English'}.` },
        ],
      },
    ],
  });
  return (response.text || '').trim();
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
  onRightPress,
}: {
  title: string;
  onBack?: () => void;
  right?: string;
  onRightPress?: () => void;
}) {
  return (
    <View style={styles.header}>
      {onBack ? (
        <Pressable onPress={onBack} style={styles.backButton}>
          <Text style={styles.backText}>‹</Text>
        </Pressable>
      ) : null}
      <Text style={styles.headerTitle}>{title}</Text>
      {right ? (
        <Text style={styles.headerRight} onPress={onRightPress}>{right}</Text>
      ) : (
        <View style={styles.headerSpacer} />
      )}
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
  dimmed,
}: {
  icon: string;
  title: string;
  subtitle?: string;
  onPress: () => void;
  selected?: boolean;
  dimmed?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.tile, selected && styles.tileSelected, dimmed && styles.tileDimmed, pressed && styles.pressed]}>
      <Text style={[styles.tileIcon, dimmed && styles.tileIconDimmed]}>{icon}</Text>
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
  const { user } = useAuth();
  // Uniform line icons (Ionicons) — outline when inactive, filled when active.
  const tabs: Array<{ id: MainTab; label: string; icon: keyof typeof Ionicons.glyphMap; screen: Screen }> = [
    { id: 'home', label: tx('হোম', 'Home'), icon: 'home', screen: 'home' },
    { id: 'community', label: tx('কমিউনিটি', 'Community'), icon: 'people', screen: 'community' },
    // Shathi Partner projects: area projects + the user's own enrolled projects.
    { id: 'projects' as MainTab, label: tx('প্রকল্প', 'Projects'), icon: 'briefcase' as keyof typeof Ionicons.glyphMap, screen: 'projects' as Screen },
    { id: 'profile', label: tx('মেনু', 'Menu'), icon: 'grid', screen: 'profile' },
  ];

  const { refreshing, onRefresh } = usePullRefresh();
  const keyboardVisible = useKeyboardVisible();
  return (
    <View style={styles.shell}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={[styles.shellContent, fixedAccessory ? styles.shellContentWithAccessory : null]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.maroon]} tintColor={colors.maroon} />}
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
      {fixedAccessory ? <View style={styles.fixedAccessory}>{fixedAccessory}</View> : null}
      {/* Bottom nav stays pinned at the device bottom; hidden while the keyboard
          is open so it never floats above the keyboard. */}
      {keyboardVisible ? null : (
        <View style={styles.navBar}>
          {tabs.map((tab) => (
            <Pressable
              key={tab.id}
              onPress={() => setScreen(tab.screen)}
              style={styles.navItem}
            >
              <View style={[styles.navIconWrap, activeTab === tab.id && styles.navIconWrapActive]}>
                <Ionicons
                  name={activeTab === tab.id ? tab.icon : (`${tab.icon}-outline` as keyof typeof Ionicons.glyphMap)}
                  size={23}
                  color={activeTab === tab.id ? '#FFFFFF' : 'rgba(255,255,255,0.78)'}
                />
              </View>
              <Text style={[styles.navLabel, activeTab === tab.id && styles.navLabelActive]}>{tab.label}</Text>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

// Full-screen crash fallback so a render error never leaves a blank screen.
function CrashScreen({ message, detail, onRetry, onHome }: { message: string; detail?: string; onRetry: () => void; onHome?: () => void }) {
  return (
    <View style={styles.crashScreen}>
      <View style={styles.crashCard}>
        <Text style={styles.crashIcon}>😕</Text>
        <Text style={styles.crashTitle}>কিছু একটা সমস্যা হয়েছে</Text>
        <Text style={styles.crashTitleEn}>Something went wrong</Text>
        <Text style={styles.crashMsg}>{message || 'Unexpected error'}</Text>
        {detail ? (
          <ScrollView style={styles.crashDetail} contentContainerStyle={{ padding: 10 }}>
            <Text style={styles.crashDetailText} selectable>{detail}</Text>
          </ScrollView>
        ) : null}
        <Pressable onPress={onRetry} style={({ pressed }) => [styles.crashBtn, pressed && styles.pressed]}>
          <Text style={styles.crashBtnText}>↻ আবার চেষ্টা করুন / Try again</Text>
        </Pressable>
        {onHome ? (
          <Pressable onPress={onHome} style={({ pressed }) => [styles.crashBtnOutline, pressed && styles.pressed]}>
            <Text style={styles.crashBtnOutlineText}>হোমে ফিরুন / Go home</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

class ErrorBoundary extends Component<{ children: React.ReactNode; onHome?: () => void }, { hasError: boolean; message: string; detail: string }> {
  state = { hasError: false, message: '', detail: '' };
  static getDerivedStateFromError(error: any) {
    return { hasError: true, message: error?.message ? String(error.message) : 'Unexpected error', detail: '' };
  }
  componentDidCatch(error: any, info: any) {
    const stack = (info && info.componentStack ? String(info.componentStack) : '').split('\n').slice(0, 8).join('\n');
    // Surface to the Metro terminal and onto the crash screen for diagnosis.
    console.error('[ErrorBoundary]', error?.message, '\n', error?.stack, '\nComponent stack:', stack);
    this.setState({ detail: `${error?.message || ''}\n${stack}`.trim() });
  }
  reset = () => this.setState({ hasError: false, message: '', detail: '' });
  render() {
    if (this.state.hasError) {
      return <CrashScreen message={this.state.message} detail={this.state.detail} onRetry={this.reset} onHome={this.props.onHome ? () => { this.reset(); this.props.onHome?.(); } : undefined} />;
    }
    return this.props.children;
  }
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('onboarding');
  const [onboarding, setOnboarding] = useState(0);
  const [weight, setWeight] = useState('200');
  const [qty, setQty] = useState(2);
  const [lang, setLang] = useState<Lang>('bn');
  const [cattleImage, setCattleImage] = useState<string | null>(null);
  const [listingDraft, setListingDraft] = useState<ListingDraft>(makeListingDraft);
  const patchDraft = (p: Partial<ListingDraft>) => setListingDraft((d) => ({ ...d, ...p }));
  const prefsSeeded = useRef(false);
  const [selectedPreferenceCategories, setSelectedPreferenceCategories] = useState<PreferenceKey[]>(['cattle']);
  const [livestockPrefs, setLivestockPrefs] = useState<string[]>(['cow']);
  const [cropPrefs, setCropPrefs] = useState<string[]>(['rice']);
  const [fishPrefs, setFishPrefs] = useState<string[]>(['rohu']);
  const [vegetablePrefs, setVegetablePrefs] = useState<string[]>(['tomato']);
  const [fruitPrefs, setFruitPrefs] = useState<string[]>(['mango']);
  const [learnCategory, setLearnCategory] = useState<LearnCat | null>(null);
  const [learnModule, setLearnModule] = useState<LearnMod | null>(null);
  const [learnContentId, setLearnContentId] = useState<string | null>(null);
  const [apaMessages, setApaMessages] = useState<ChatMessage[]>([]);
  const [apaImageUri, setApaImageUri] = useState<string | null>(null);
  const [apaBusy, setApaBusy] = useState(false);
  const [apaDraftSuggestion, setApaDraftSuggestion] = useState('');
  const [selectedProduct, setSelectedProduct] = useState<ApiRow | null>(null);
  const [latestOrder, setLatestOrder] = useState<ApiRow | null>(null);
  const [latestListing, setLatestListing] = useState<ApiRow | null>(null);
  const [latestApplication, setLatestApplication] = useState<ApiRow | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectsInitialTab, setProjectsInitialTab] = useState<'all' | 'area' | 'mine'>('area');
  const [selectedMarketId, setSelectedMarketId] = useState<string | null>(null);
  const [appLocation, setAppLocation] = useState<LocationState>({
    query: WEATHERAPI_LOCATION,
    label: 'Default location',
    loading: true,
    granted: false,
    error: null,
    fallback: true,
  });
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(AUTH_STORAGE_KEY);
        if (!alive || !stored) return;
        const parsed = JSON.parse(stored) as { user: AuthUser; token: string };
        if (!parsed?.user?.id) return;
        setAuthUser(parsed.user);
        setAuthToken(parsed.token ?? null);
        // Refresh onboarding gates from the server, then route accordingly.
        try {
          const me = await apiRequest<{ data?: AuthUser }>(`app/me?user_id=${parsed.user.id}`);
          if (!alive) return;
          const merged = me.data ? { ...parsed.user, ...me.data } : parsed.user;
          setAuthUser(merged);
          await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ user: merged, token: parsed.token }));
          setScreen(routeAfterAuth(merged));
        } catch {
          if (alive) setScreen(routeAfterAuth(parsed.user));
        }
      } catch {
        // ignore corrupt storage; user just logs in again
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const authValue = useMemo(
    () => ({
      user: authUser,
      token: authToken,
      signIn: async (user: AuthUser, token: string) => {
        setAuthUser(user);
        setAuthToken(token);
        await AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ user, token }));
      },
      updateUser: async (patch: Partial<AuthUser>) => {
        setAuthUser((current) => {
          if (!current) return current;
          const next = { ...current, ...patch };
          AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ user: next, token: authToken })).catch(() => {});
          return next;
        });
      },
      signOut: async () => {
        setAuthUser(null);
        setAuthToken(null);
        await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
        setScreen('onboarding');
        setOnboarding(0);
      },
    }),
    [authUser, authToken],
  );

  const refreshLocation = useCallback(async () => {
    let alive = true;
    {
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
        // Reverse geocode to pre-fill the user's Division / District / Thana.
        let detected: { division?: string; district?: string; thana?: string } | null = null;
        try {
          const places = await Location.reverseGeocodeAsync({ latitude, longitude });
          const place = places[0];
          if (place) {
            detected = {
              division: (place.region || undefined) as string | undefined,
              district: (place.subregion || place.city || undefined) as string | undefined,
              thana: (place.district || place.city || place.name || undefined) as string | undefined,
            };
          }
        } catch {
          // reverse geocode is best-effort; user can still pick manually
        }
        if (!alive) return;
        setAppLocation({
          query: `${latitude},${longitude}`,
          label: detected?.district ? `${detected.thana ? detected.thana + ', ' : ''}${detected.district}` : `${latitude.toFixed(3)}, ${longitude.toFixed(3)}`,
          loading: false,
          granted: true,
          error: null,
          fallback: false,
          latitude,
          longitude,
          detected,
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
  }, [lang]);

  useEffect(() => {
    void refreshLocation();
  }, [refreshLocation]);

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
  // Seed preference selections from the DB-saved snapshot once it loads (so the
  // selection lives in the database, not only on the phone).
  useEffect(() => {
    const prefs = authUser?.preferences;
    if (prefsSeeded.current || !prefs) return;
    prefsSeeded.current = true;
    if (Array.isArray(prefs.categories) && prefs.categories.length) {
      setSelectedPreferenceCategories(prefs.categories.filter((k): k is PreferenceKey => preferenceOrder.includes(k as PreferenceKey)));
    }
    const it = prefs.items || {};
    if (Array.isArray(it.livestock)) setLivestockPrefs(it.livestock);
    if (Array.isArray(it.crops)) setCropPrefs(it.crops);
    if (Array.isArray(it.fishery)) setFishPrefs(it.fishery);
    if (Array.isArray(it.vegetables)) setVegetablePrefs(it.vegetables);
    if (Array.isArray(it.fruits)) setFruitPrefs(it.fruits);
  }, [authUser?.preferences]);

  const persistPreferences = async () => {
    if (!authUser?.id) return;
    const selection = [
      ...selectedPreferenceCategories,
      ...livestockPrefs,
      ...cropPrefs,
      ...fishPrefs,
      ...vegetablePrefs,
      ...fruitPrefs,
    ];
    try {
      await apiCreate('app/preferences', {
        user_id: authUser.id,
        selection,
        snapshot: {
          categories: selectedPreferenceCategories,
          items: {
            livestock: livestockPrefs,
            crops: cropPrefs,
            fishery: fishPrefs,
            vegetables: vegetablePrefs,
            fruits: fruitPrefs,
          },
        },
      });
      setAuthUser((current) => {
        if (!current) return current;
        const next = { ...current, needs_preferences: false };
        AsyncStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ user: next, token: authToken })).catch(() => {});
        return next;
      });
    } catch {
      // Non-blocking: preferences also live locally; user still reaches home.
    }
  };
  const finishPreferences = (next: Screen) => {
    if (next === 'home') {
      void persistPreferences();
      go('home');
    } else {
      go(next);
    }
  };
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
          onNext={() => (onboarding === 0 ? setOnboarding(1) : go('gpsGrant'))}
          onBack={() => setOnboarding(0)}
        />
      ),
      gpsGrant: <GpsGrant onContinue={() => go('login')} refreshLocation={refreshLocation} />,
      shathiApa: <ShathiApa setScreen={go} messages={apaMessages} busy={apaBusy} onAsk={sendApaMessage} setDraftSuggestion={setApaDraftSuggestion} />,
      apaVoice: <ApaVoice setScreen={go} />,
      apaCamera: <ApaCamera setScreen={go} />,
      login: <Login onAuthed={(user) => go(routeAfterAuth(user))} />,
      personalInfo: (
        <PersonalInfo
          onDone={() => go(authUser?.needs_preferences === false ? 'home' : 'prefAnimal')}
        />
      ),
      prefAnimal: (
        <PreferenceAnimal
          selected={selectedPreferenceCategories}
          onChange={setSelectedPreferenceCategories}
          onNext={() => finishPreferences(nextPreferenceScreen())}
          onSkip={() => finishPreferences('home')}
          step={preferenceStep()}
        />
      ),
      prefLivestock: (
        <PreferenceLivestock
          selected={livestockPrefs}
          onChange={setLivestockPrefs}
          onNext={() => finishPreferences(nextPreferenceScreen('cattle'))}
          onBack={() => go(previousPreferenceScreen('cattle'))}
          onSkip={() => finishPreferences('home')}
          step={preferenceStep('cattle')}
          isFinal={nextPreferenceScreen('cattle') === 'home'}
        />
      ),
      prefCrops: (
        <PreferenceCrops
          selected={cropPrefs}
          onChange={setCropPrefs}
          onNext={() => finishPreferences(nextPreferenceScreen('crops'))}
          onBack={() => go(previousPreferenceScreen('crops'))}
          onSkip={() => finishPreferences('home')}
          step={preferenceStep('crops')}
          isFinal={nextPreferenceScreen('crops') === 'home'}
        />
      ),
      prefFish: (
        <PreferenceFish
          selected={fishPrefs}
          onChange={setFishPrefs}
          onNext={() => finishPreferences(nextPreferenceScreen('fishery'))}
          onBack={() => go(previousPreferenceScreen('fishery'))}
          onSkip={() => finishPreferences('home')}
          step={preferenceStep('fishery')}
          isFinal={nextPreferenceScreen('fishery') === 'home'}
        />
      ),
      prefVegetable: (
        <PreferenceVegetable
          selected={vegetablePrefs}
          onChange={setVegetablePrefs}
          onNext={() => finishPreferences(nextPreferenceScreen('vegetables'))}
          onBack={() => go(previousPreferenceScreen('vegetables'))}
          onSkip={() => finishPreferences('home')}
          step={preferenceStep('vegetables')}
          isFinal={nextPreferenceScreen('vegetables') === 'home'}
        />
      ),
      prefFruits: (
        <PreferenceFruits
          selected={fruitPrefs}
          onChange={setFruitPrefs}
          onNext={() => finishPreferences('home')}
          onBack={() => go(previousPreferenceScreen('fruits'))}
          step={preferenceStep('fruits')}
          isFinal
        />
      ),
      home: <Home setScreen={go} openProjects={(t) => { setProjectsInitialTab(t); go('projects'); }} />,
      weather: <WeatherPage setScreen={go} />,
      community: <Community setScreen={go} />,
      projects: <Projects setScreen={go} initialTab={projectsInitialTab} onApply={(id) => { setSelectedProjectId(id); go('kyc'); }} />,
      profile: <Profile setScreen={go} />,
      menuPersonal: <PersonalInfo onDone={() => go('profile')} />,
      menuBanking: <BankingScreen setScreen={go} />,
      menuFarm: <FarmScreen setScreen={go} />,
      menuKyc: <KycScreen setScreen={go} />,
      menuFaq: <FaqScreen setScreen={go} />,
      marketUpdates: <MarketUpdates setScreen={go} onSelect={(id) => { setSelectedMarketId(id); go('marketDetail'); }} />,
      marketDetail: <MarketDetail setScreen={go} id={selectedMarketId} />,
      officers: <OfficersScreen setScreen={go} />,
      saleCategories: <SaleCategories setScreen={go} patchDraft={patchDraft} />,
      livestock: <Livestock setScreen={go} />,
      cattleForm: <CattleForm setScreen={go} draft={listingDraft} patchDraft={patchDraft} />,
      cattleMeasure: <CattleMeasure setScreen={go} draft={listingDraft} patchDraft={patchDraft} />,
      cattlePrice: <CattlePrice setScreen={go} draft={listingDraft} patchDraft={patchDraft} onSubmitted={setLatestListing} />,
      cattleDone: <CattleDone setScreen={go} listing={latestListing} />,
      inputsForm: <InputsForm setScreen={go} draft={listingDraft} patchDraft={patchDraft} />,
      inputsPrice: <InputsPrice setScreen={go} draft={listingDraft} patchDraft={patchDraft} onSubmitted={setLatestListing} />,
      buyCategories: <BuyCategories setScreen={go} />,
      buyProducts: <BuyProducts setScreen={go} onSelectProduct={setSelectedProduct} />,
      buyOrder: <BuyOrder setScreen={go} qty={qty} setQty={setQty} product={selectedProduct} onOrdered={setLatestOrder} />,
      buyDone: <BuyDone setScreen={go} qty={qty} product={selectedProduct} order={latestOrder} />,
      training: <TrainingHome setScreen={go} openCategory={(cat) => { setLearnCategory(cat); go('trainingCategory'); }} />,
      trainingCategory: <TrainingCategory category={learnCategory} setScreen={go} openModule={(mod) => { setLearnModule(mod); go('trainingModule'); }} />,
      trainingModule: (
        <TrainingModuleScreen
          module={learnModule}
          setScreen={go}
          openContent={(id, type) => { setLearnContentId(id); go(type === 'video' ? 'trainingVideo' : 'trainingArticle'); }}
        />
      ),
      trainingArticle: <TrainingArticle contentId={learnContentId} setScreen={go} openQuiz={(id) => { setLearnContentId(id); go('trainingQuiz'); }} />,
      trainingVideo: <TrainingVideoScreen contentId={learnContentId} setScreen={go} />,
      trainingQuiz: <TrainingQuiz contentId={learnContentId} setScreen={go} />,
      partnerRegister: <PartnerRegister setScreen={go} />,
      kyc: <Kyc setScreen={go} projectId={selectedProjectId} onSubmitted={setLatestApplication} />,
      regDone: <RegDone setScreen={go} application={latestApplication} />,
      inactive: <Inactive setScreen={go} />,
    };

    return routes[screen];
  }, [screen, onboarding, weight, qty, cattleImage, listingDraft, selectedPreferenceCategories, livestockPrefs, cropPrefs, fishPrefs, vegetablePrefs, fruitPrefs, learnCategory, learnModule, learnContentId, apaMessages, apaImageUri, apaBusy, lang, selectedProduct, latestOrder, latestListing, latestApplication, selectedProjectId, projectsInitialTab, authUser, selectedMarketId]);

  const authScreens: Screen[] = ['onboarding', 'login', 'personalInfo', 'prefAnimal', 'prefLivestock', 'prefCrops', 'prefFish', 'prefVegetable', 'prefFruits', 'apaVoice', 'apaCamera'];

  return (
    <AuthContext.Provider value={authValue}>
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
            <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
              <ErrorBoundary key={screen} onHome={() => go('home')}>{content}</ErrorBoundary>
            </KeyboardAvoidingView>
          ) : (
            <Shell activeTab={activeTab} setScreen={go} fixedAccessory={screen === 'shathiApa' ? <ApaInputBar onAsk={sendApaMessage} onImage={sendApaImage} onVoice={sendApaVoice} busy={apaBusy} draftSuggestion={apaDraftSuggestion} clearDraftSuggestion={() => setApaDraftSuggestion('')} /> : undefined}>
              <ErrorBoundary key={screen} onHome={() => go('home')}>{content}</ErrorBoundary>
            </Shell>
          )}
          <GlobalLoader />
        </SafeAreaView>
        </LocationContext.Provider>
      </LanguageContext.Provider>
    </AuthContext.Provider>
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

function Login({ onAuthed }: { onAuthed: (user: AuthUser) => void }) {
  const { tx, lang } = useLanguage();
  const { signIn } = useAuth();
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');
  const [resendIn, setResendIn] = useState(0); // seconds until "Resend" is allowed
  const [expiresIn, setExpiresIn] = useState(0); // seconds until the OTP expires

  // Tick the resend + expiry countdowns once per second while on the OTP step.
  useEffect(() => {
    if (step !== 'otp') return;
    const timer = setInterval(() => {
      setResendIn((s) => (s > 0 ? s - 1 : 0));
      setExpiresIn((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [step]);

  const fmtTime = (s: number) => {
    const t = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    return lang === 'bn' ? bn(t) : t;
  };

  async function sendCode() {
    const phoneValue = phone.trim();
    if (!/^01[0-9]{9}$/.test(phoneValue)) {
      setError(tx('সঠিক ১১ ডিজিটের মোবাইল নম্বর দিন (01XXXXXXXXX)।', 'Enter a valid 11-digit mobile number (01XXXXXXXXX).'));
      return;
    }
    setError('');
    setHint('');
    try {
      const response = await apiRequest<{ result?: { dev_otp?: string } }>('app/auth/request-otp', {
        method: 'POST',
        body: JSON.stringify({ phone: phoneValue }),
      });
      setStep('otp');
      setResendIn(60);
      setExpiresIn(300);
      if (response.result?.dev_otp) {
        setHint(tx(`টেস্ট কোড: ${response.result.dev_otp}`, `Test code: ${response.result.dev_otp}`));
      }
    } catch (sendError) {
      setError(naturalApiError(sendError, lang));
    }
  }

  async function verify() {
    const codeValue = code.trim();
    if (codeValue.length < 4) {
      setError(tx('৪ ডিজিটের কোড দিন।', 'Enter the 4-digit code.'));
      return;
    }
    setError('');
    try {
      const response = await apiRequest<{ result?: { token: string; user: AuthUser } }>('app/auth/verify-otp', {
        method: 'POST',
        body: JSON.stringify({ phone: phone.trim(), code: codeValue }),
      });
      const result = response.result;
      if (!result?.user?.id || !result.token) {
        throw new Error(tx('যাচাই ব্যর্থ হয়েছে। আবার চেষ্টা করুন।', 'Verification failed. Please try again.'));
      }
      await signIn(result.user, result.token);
      onAuthed(result.user);
    } catch (verifyError) {
      setError(naturalApiError(verifyError, lang));
    }
  }

  return (
    <View style={styles.authScreen}>
      <View style={styles.authLang}>
        <LangToggle subtle />
      </View>
      <Card style={styles.loginCard}>
        <Text style={styles.loginTitle}>{tx('শাথী সেবায় স্বাগতম', 'Welcome to Shathi Sheba')}</Text>
        {step === 'phone' ? (
          <>
            <Text style={styles.loginSub}>{tx('চালিয়ে যেতে মোবাইল নম্বর দিন', 'Enter your mobile number to continue')}</Text>
            <Text style={styles.label}>{tx('মোবাইল নম্বর', 'Mobile number')}</Text>
            <TextInput
              style={styles.input}
              value={phone}
              onChangeText={setPhone}
              keyboardType="phone-pad"
              maxLength={11}
              autoCapitalize="none"
              placeholder={tx('০১XXXXXXXXX', '01XXXXXXXXX')}
              placeholderTextColor={colors.muted}
            />
            {error ? <Text style={styles.apiNotice}>{error}</Text> : null}
            <AppButton title={tx('কোড পাঠান', 'Send Code')} onPress={sendCode} />
          </>
        ) : (
          <>
            <Text style={styles.loginSub}>{tx(`${phone} নম্বরে পাঠানো কোডটি দিন`, `Enter the code sent to ${phone}`)}</Text>
            <Text style={styles.label}>{tx('OTP কোড', 'OTP code')}</Text>
            <TextInput
              style={styles.input}
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              maxLength={6}
              placeholder={tx('৪ ডিজিটের কোড', '4-digit code')}
              placeholderTextColor={colors.muted}
            />
            {hint ? <Text style={styles.otpEditPhone}>{hint}</Text> : null}
            {expiresIn > 0 ? (
              <Text style={styles.otpTimer}>⏳ {tx('কোডের মেয়াদ', 'Code expires in')} {fmtTime(expiresIn)}</Text>
            ) : (
              <Text style={styles.otpExpired}>{tx('কোডের মেয়াদ শেষ — আবার পাঠান', 'Code expired — please resend')}</Text>
            )}
            {error ? <Text style={styles.apiNotice}>{error}</Text> : null}
            <AppButton title={tx('যাচাই করুন', 'Verify')} onPress={verify} />
            {resendIn > 0 ? (
              <Text style={styles.otpResendWait}>{tx('আবার পাঠানো যাবে', 'Resend available in')} {fmtTime(resendIn)}</Text>
            ) : (
              <Text style={styles.otpResend} onPress={sendCode}>{tx('কোড আবার পাঠান', 'Resend code')}</Text>
            )}
            <Text
              style={styles.otpEditPhone}
              onPress={() => {
                setStep('phone');
                setCode('');
                setError('');
                setHint('');
                setResendIn(0);
                setExpiresIn(0);
              }}
            >
              {tx('নম্বর পরিবর্তন করুন', 'Change number')}
            </Text>
          </>
        )}
      </Card>
    </View>
  );
}

function GpsGrant({ onContinue, refreshLocation }: { onContinue: () => void; refreshLocation: () => Promise<void> }) {
  const { tx } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(true);
  // Conditional: if location is already granted, skip this screen entirely.
  // Only shown when access has not been granted yet.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (!alive) return;
        if (perm.status === 'granted') { onContinue(); return; }
      } catch { /* fall through to prompt */ }
      if (alive) setChecking(false);
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function allow() {
    setBusy(true);
    try { await refreshLocation(); } catch { /* ignore */ } finally { setBusy(false); onContinue(); }
  }
  if (checking) {
    return <View style={[styles.gpsScreen, { justifyContent: 'center' }]}><ActivityIndicator color={colors.maroon} size="large" /></View>;
  }
  const points: Array<[string, string]> = [
    ['🏷️', tx('এলাকাভিত্তিক প্রকল্প ও বাজারদর', 'Area-based projects & market rates')],
    ['🌦️', tx('আপনার এলাকার আবহাওয়া', 'Weather for your exact area')],
    ['🚚', tx('দ্রুত মাঠ পরিদর্শন ও পেমেন্ট', 'Faster field visits & payment')],
  ];
  return (
    <View style={styles.gpsScreen}>
      <View style={styles.prefLangCenter}><LangToggle subtle /></View>
      <View style={styles.gpsHero}>
        <View style={styles.gpsHeroCircle}><Text style={styles.gpsHeroEmoji}>📍</Text></View>
        <Text style={styles.gpsTitle}>{tx('আপনার এলাকা চিনে নিই', 'Let us find your area')}</Text>
        <Text style={styles.gpsSub}>{tx('লোকেশন অনুমতি দিলে আমরা আপনার বিভাগ, জেলা ও থানা অনুযায়ী প্রকল্প, বাজারদর ও আবহাওয়া দেখাতে পারব।', 'Allow location and we will tailor projects, market rates and weather to your division, district and thana.')}</Text>
        <View style={styles.gpsPoints}>
          {points.map(([icon, text]) => (
            <View key={text} style={styles.gpsPoint}>
              <Text style={styles.gpsPointIcon}>{icon}</Text>
              <Text style={styles.gpsPointText}>{text}</Text>
            </View>
          ))}
        </View>
      </View>
      <View style={styles.gpsBottom}>
        <AppButton title={busy ? tx('অনুমতি নেওয়া হচ্ছে...', 'Requesting permission...') : tx('লোকেশন অনুমতি দিন', 'Allow location access')} onPress={allow} disabled={busy} />
        <Pressable onPress={onContinue} style={({ pressed }) => [styles.gpsSkipBtn, pressed && styles.pressed]}>
          <Text style={styles.gpsSkipText}>{tx('এখন না, পরে দেব', 'Not now')}</Text>
        </Pressable>
        <Text style={styles.gpsPrivacy}>🔒 {tx('আমরা শুধু আপনার এলাকা নির্ধারণে এটি ব্যবহার করি।', 'We only use this to set your area — never shared.')}</Text>
      </View>
    </View>
  );
}

function PersonalInfo({ onDone }: { onDone: () => void }) {
  const { tx, lang } = useLanguage();
  const { user, updateUser } = useAuth();
  const initialName = user?.full_name && user.full_name !== 'Shathi user' ? user.full_name : '';
  const [fullName, setFullName] = useState(initialName ?? '');
  const [gender, setGender] = useState<string>(user?.gender ?? '');
  const initialDob = user?.date_of_birth ? String(user.date_of_birth).slice(0, 10).split('-') : [];
  const [dobYear, setDobYear] = useState(initialDob[0] || '');
  const [dobMonth, setDobMonth] = useState(initialDob[1] || '');
  const [dobDay, setDobDay] = useState(initialDob[2] || '');
  const [imageUri, setImageUri] = useState<string | null>(user?.profile_image_url ?? null);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(user?.profile_image_url ?? null);
  const [error, setError] = useState('');

  // Region: Division -> District -> Thana, cascading from the geo API.
  const appLocation = useAppLocation();
  const divisions = useApiList<ApiRow>('geo/divisions');
  const [divId, setDivId] = useState<string | null>(null);
  const [divName, setDivName] = useState(user?.division ?? '');
  const districts = useApiList<ApiRow>(divId ? `geo/districts?division_id=${divId}` : 'geo/districts');
  const [distId, setDistId] = useState<string | null>(null);
  const [distName, setDistName] = useState(user?.district ?? '');
  const upazilas = useApiList<ApiRow>(distId ? `geo/upazilas?district_id=${distId}` : 'geo/upazilas');
  const [thaId, setThaId] = useState<string | null>(null);
  const [thaName, setThaName] = useState(user?.upazila ?? '');
  const [gpsNote, setGpsNote] = useState('');

  const matchByName = (rows: ApiRow[], name?: string) => {
    const n = String(name || '').trim().toLowerCase();
    if (!n) return undefined;
    return rows.find((r) => String(r.name_en).toLowerCase() === n) || rows.find((r) => String(r.name_en).toLowerCase().includes(n) || n.includes(String(r.name_en).toLowerCase()));
  };
  // Resolve saved names -> ids once each geo list loads (keeps the cascade in sync).
  useEffect(() => { if (!divId && divName && divisions.rows.length) { const r = matchByName(divisions.rows, divName); if (r) setDivId(String(r.id)); } /* eslint-disable-next-line */ }, [divisions.rows.length]);
  useEffect(() => { if (!distId && distName && districts.rows.length) { const r = matchByName(districts.rows, distName); if (r) setDistId(String(r.id)); } /* eslint-disable-next-line */ }, [districts.rows.length]);
  useEffect(() => { if (!thaId && thaName && upazilas.rows.length) { const r = matchByName(upazilas.rows, thaName); if (r) setThaId(String(r.id)); } /* eslint-disable-next-line */ }, [upazilas.rows.length]);

  function useGpsLocation() {
    const d = appLocation.detected;
    if (!appLocation.granted || !d) {
      setGpsNote(tx('GPS লোকেশন পাওয়া যায়নি — হাতে নির্বাচন করুন।', 'GPS location not available — please select manually.'));
      return;
    }
    const dv = matchByName(divisions.rows, d.division);
    if (dv) { setDivId(String(dv.id)); setDivName(String(dv.name_en)); }
    // district/thana match resolves after the dependent lists load; store names now.
    if (d.district) setDistName(d.district);
    if (d.thana) setThaName(d.thana);
    setDistId(null); setThaId(null);
    setGpsNote(tx('GPS থেকে এলাকা পূরণ করা হয়েছে — প্রয়োজনে বদলান।', 'Filled region from GPS — adjust if needed.'));
  }

  const genders: Array<{ key: string; label: string }> = [
    { key: 'male', label: tx('পুরুষ', 'Male') },
    { key: 'female', label: tx('নারী', 'Female') },
    { key: 'other', label: tx('অন্যান্য', 'Other') },
  ];

  async function pickPhoto() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsEditing: true, aspect: [1, 1], quality: 0.7 });
    if (result.canceled) return;
    const uri = result.assets[0].uri;
    setImageUri(uri);
    try {
      const url = await uploadImage(uri, 'profiles');
      setUploadedUrl(url);
    } catch (uploadError) {
      setError(naturalApiError(uploadError, lang));
    }
  }

  async function save() {
    if (!fullName.trim()) {
      setError(tx('নাম দিন।', 'Please enter your name.'));
      return;
    }
    if (!gender) {
      setError(tx('লিঙ্গ নির্বাচন করুন।', 'Please select your gender.'));
      return;
    }
    if (!divName) {
      setError(tx('অন্তত আপনার বিভাগ নির্বাচন করুন।', 'Please select at least your division.'));
      return;
    }
    setError('');
    try {
      const response = await apiRequest<{ result?: { user: AuthUser } }>('app/profile', {
        method: 'POST',
        body: JSON.stringify({
          user_id: user?.id,
          full_name: fullName.trim(),
          gender,
          date_of_birth: dobYear && dobMonth && dobDay ? `${dobYear}-${dobMonth}-${dobDay}` : null,
          profile_image_url: uploadedUrl || undefined,
          division: divName || undefined,
          district: distName || undefined,
          upazila: thaName || undefined,
          latitude: appLocation.latitude ?? undefined,
          longitude: appLocation.longitude ?? undefined,
        }),
      });
      if (response.result?.user) await updateUser(response.result.user);
      onDone();
    } catch (saveError) {
      setError(naturalApiError(saveError, lang));
    }
  }

  return (
    <View style={styles.prefScreen}>
      <Header title={tx('ব্যক্তিগত তথ্য', 'Personal Information')} right={tx('এড়িয়ে যান', 'Skip')} onRightPress={onDone} />
      <View style={styles.prefLangCenter}><LangToggle subtle /></View>
      <RefreshScroll>
        <Pressable style={styles.avatarPick} onPress={pickPhoto}>
          {imageUri ? <Image source={{ uri: imageUri }} style={styles.avatarPickImage} /> : <Text style={styles.avatarPickIcon}>＋</Text>}
        </Pressable>
        <Text style={styles.otpEditPhone}>{tx('প্রোফাইল ছবি (ঐচ্ছিক)', 'Profile photo (optional)')}</Text>

        <Text style={styles.label}>{tx('পুরো নাম', 'Full name')} *</Text>
        <TextInput style={styles.input} value={fullName} onChangeText={setFullName} placeholder={tx('আপনার নাম লিখুন', 'Enter your name')} placeholderTextColor={colors.muted} />

        <Text style={styles.label}>{tx('লিঙ্গ', 'Gender')} *</Text>
        <View style={styles.genderRow}>
          {genders.map((g) => (
            <Pressable key={g.key} style={[styles.genderPill, gender === g.key && styles.genderPillActive]} onPress={() => setGender(g.key)}>
              <Text style={[styles.genderPillText, gender === g.key && styles.genderPillTextActive]}>{g.label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>{tx('জন্ম তারিখ (ঐচ্ছিক)', 'Date of birth (optional)')}</Text>
        <View style={styles.dobRow}>
          <DropdownField
            value={dobDay}
            placeholder={tx('দিন', 'Day')}
            onSelect={setDobDay}
            options={Array.from({ length: 31 }, (_, i) => { const v = String(i + 1).padStart(2, '0'); return { value: v, label: num(i + 1, lang) }; })}
          />
          <DropdownField
            value={dobMonth}
            placeholder={tx('মাস', 'Month')}
            flexBasis={1.3}
            onSelect={setDobMonth}
            options={MONTHS_EN.map((_, i) => { const v = String(i + 1).padStart(2, '0'); return { value: v, label: lang === 'bn' ? MONTHS_BN[i] : MONTHS_EN[i] }; })}
          />
          <DropdownField
            value={dobYear}
            placeholder={tx('সাল', 'Year')}
            flexBasis={1.2}
            onSelect={setDobYear}
            options={Array.from({ length: 75 }, (_, i) => { const y = new Date().getFullYear() - 10 - i; return { value: String(y), label: num(y, lang) }; })}
          />
        </View>

        <View style={styles.regionCard}>
          <View style={styles.regionHead}>
            <Text style={styles.regionTitle}>📍 {tx('আপনার এলাকা', 'Your location')} <Text style={styles.reqStar}>*</Text></Text>
            <Pressable onPress={useGpsLocation} style={({ pressed }) => [styles.gpsBtn, pressed && styles.pressed]}>
              <Text style={styles.gpsBtnText}>⌖ {tx('GPS দিয়ে পূরণ', 'Use GPS')}</Text>
            </Pressable>
          </View>
          <Text style={styles.regionHint}>{tx('প্রকল্প ও বাজারদর আপনার এলাকা অনুযায়ী দেখাতে এটি প্রয়োজন।', 'Needed to show projects and rates for your area.')}</Text>
          <View style={{ height: 6 }} />
          <DropdownField
            value={divId ?? ''}
            placeholder={tx('বিভাগ বেছে নিন', 'Select division')}
            onSelect={(id) => { const r = divisions.rows.find((x) => String(x.id) === id); setDivId(id); setDivName(String(r?.name_en ?? '')); setDistId(null); setDistName(''); setThaId(null); setThaName(''); }}
            options={divisions.rows.map((r) => ({ value: String(r.id), label: rowTitle(r, lang, r.name_en) }))}
          />
          <View style={styles.geoRow}>
            <View style={styles.flex}>
              <DropdownField
                value={distId ?? ''}
                placeholder={divName ? tx('জেলা বেছে নিন', 'Select district') : tx('আগে বিভাগ', 'Division first')}
                onSelect={(id) => { const r = districts.rows.find((x) => String(x.id) === id); setDistId(id); setDistName(String(r?.name_en ?? '')); setThaId(null); setThaName(''); }}
                options={districts.rows.map((r) => ({ value: String(r.id), label: rowTitle(r, lang, r.name_en) }))}
              />
            </View>
            <View style={styles.flex}>
              <DropdownField
                value={thaId ?? ''}
                placeholder={distName ? tx('থানা বেছে নিন', 'Select thana') : tx('আগে জেলা', 'District first')}
                onSelect={(id) => { const r = upazilas.rows.find((x) => String(x.id) === id); setThaId(id); setThaName(String(r?.name_en ?? '')); }}
                options={upazilas.rows.map((r) => ({ value: String(r.id), label: rowTitle(r, lang, r.name_en) }))}
              />
            </View>
          </View>
          {gpsNote ? <Text style={styles.regionGpsNote}>{gpsNote}</Text> : null}
        </View>

        {error ? <Text style={styles.apiNotice}>{error}</Text> : null}
        <View style={{ height: 12 }} />
        <AppButton title={tx('সংরক্ষণ করুন', 'Save')} onPress={save} />
        <Text style={styles.otpResend} onPress={onDone}>{tx('এখন এড়িয়ে যান', 'Skip for now')}</Text>
      </RefreshScroll>
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
  const { roots } = useOnboardingTree();
  const fallbackItems: Array<PreferenceOption & { id: PreferenceKey }> = [
    { id: 'cattle', icon: '🐄', label: tx('গবাদিপশু ও পোল্ট্রি', 'Cattle & Poultry') },
    { id: 'crops', icon: '🌾', label: tx('ফসল', 'Crops') },
    { id: 'fishery', icon: '🐟', label: tx('মৎস্য', 'Fishery') },
    { id: 'vegetables', icon: '🥬', label: tx('সবজি', 'Vegetables') },
    { id: 'fruits', icon: '🍎', label: tx('ফল', 'Fruits') },
  ];
  // DB-driven roots: only preference-selectable ones (Inputs/Machinery are hidden).
  const slugToKey: Record<string, PreferenceKey> = { 'livestock-poultry': 'cattle', crops: 'crops', fishery: 'fishery', vegetables: 'vegetables', fruits: 'fruits' };
  const dbItems = roots
    .filter((r) => Number(r.is_selectable) !== 0 && slugToKey[String(r.slug)])
    .map((r) => ({ id: slugToKey[String(r.slug)], icon: safeEmoji(r.emoji, '🌿'), label: rowTitle(r, lang, r.name_en || 'Category') }));
  const items = dbItems.length ? dbItems : fallbackItems;
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
  const { roots } = useOnboardingTree();
  const db = prefSectionsForRoot(roots, PREF_ROOT_SLUG.cattle, lang, '🐄');
  return (
    <PreferenceSetupStep
      {...props}
      title={tx('আপনি কোন প্রাণী ও পোল্ট্রি নিয়ে কাজ করেন?', 'Choose your livestock and poultry')}
      subtitle={tx('গবাদিপশু ও পোল্ট্রি থেকে এক বা একাধিক নির্বাচন করুন', 'Select one or more livestock and poultry options')}
      sections={db.length ? db : [
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
  const { roots } = useOnboardingTree();
  const db = prefSectionsForRoot(roots, PREF_ROOT_SLUG.crops, lang, '🌾');
  return (
    <PreferenceSetupStep
      {...props}
      title={tx('আপনি কোন ফসল নিয়ে কাজ করেন?', 'Choose your crops')}
      subtitle={tx('আপনার জমি বা ব্যবসার সাথে সম্পর্কিত ফসল নির্বাচন করুন', 'Select crops related to your land or business')}
      sections={db.length ? db : [
        {
          title: tx('ফসল', 'Crops'),
          items: [
            { id: 'rice', icon: '🌾', label: tx('ধান', 'Rice') },
            { id: 'corn', icon: '🌽', label: tx('ভুট্টা', 'Corn') },
            { id: 'wheat', icon: '🌾', label: tx('গম', 'Wheat') },
            { id: 'garlic', icon: '🧄', label: tx('রসুন', 'Garlic') },
            { id: 'onion', icon: '🧅', label: tx('পেঁয়াজ', 'Onion') },
            { id: 'mustard', icon: '🌼', label: tx('সরিষা', 'Mustard') },
            { id: 'turmeric', icon: '🫚', label: tx('হলুদ', 'Turmeric') },
            { id: 'chili', icon: '🌶️', label: tx('মরিচ', 'Chili') },
          ],
        },
      ]}
    />
  );
}

function PreferenceFish(props: PreferencePageProps) {
  const { tx, lang } = useLanguage();
  const { roots } = useOnboardingTree();
  const db = prefSectionsForRoot(roots, PREF_ROOT_SLUG.fishery, lang, '🐟');
  return (
    <PreferenceSetupStep
      {...props}
      title={tx('আপনি কোন মাছ চাষ করেন?', 'Choose your fishery interests')}
      subtitle={tx('চাষ, বিক্রি বা পরামর্শের জন্য প্রযোজ্য মাছ নির্বাচন করুন', 'Select the fish you cultivate, sell, or need support for')}
      sections={db.length ? db : [
        {
          title: tx('মাছ', 'Fishery'),
          items: [
            { id: 'rohu', icon: '🐟', label: tx('রুই', 'Rohu') },
            { id: 'catla', icon: '🐟', label: tx('কাতলা', 'Catla') },
            { id: 'hilsa', icon: '🐟', label: tx('ইলিশ', 'Hilsa') },
            { id: 'pangas', icon: '🐟', label: tx('পাঙ্গাস', 'Pangas') },
            { id: 'tilapia', icon: '🐟', label: tx('তেলাপিয়া', 'Tilapia') },
            { id: 'prawn', icon: '🦐', label: tx('চিংড়ি', 'Prawn') },
          ],
        },
      ]}
    />
  );
}

function PreferenceVegetable(props: PreferencePageProps) {
  const { tx, lang } = useLanguage();
  const { roots } = useOnboardingTree();
  const db = prefSectionsForRoot(roots, PREF_ROOT_SLUG.vegetables, lang, '🥬');
  return (
    <PreferenceSetupStep
      {...props}
      title={tx('আপনি কোন সবজি চাষ করেন?', 'Choose your vegetables')}
      subtitle={tx('আপনার উৎপাদন বা আগ্রহের সবজি নির্বাচন করুন', 'Select vegetables you produce or care about')}
      sections={db.length ? db : [
        {
          title: tx('সবজি', 'Vegetables'),
          items: [
            { id: 'tomato', icon: '🍅', label: tx('টমেটো', 'Tomato') },
            { id: 'potato', icon: '🥔', label: tx('আলু', 'Potato') },
            { id: 'bottle-gourd', icon: '🫑', label: tx('লাউ', 'Bottle Gourd') },
            { id: 'eggplant', icon: '🍆', label: tx('বেগুন', 'Eggplant') },
            { id: 'cucumber', icon: '🥒', label: tx('শসা', 'Cucumber') },
            { id: 'okra', icon: '🫑', label: tx('ঢেঁড়স', 'Okra') },
          ],
        },
      ]}
    />
  );
}

function PreferenceFruits(props: PreferencePageProps) {
  const { tx, lang } = useLanguage();
  const { roots } = useOnboardingTree();
  const db = prefSectionsForRoot(roots, PREF_ROOT_SLUG.fruits, lang, '🥭');
  return (
    <PreferenceSetupStep
      {...props}
      title={tx('আপনি কোন ফল নিয়ে কাজ করেন?', 'Choose your fruits')}
      subtitle={tx('উৎপাদন, বিক্রি বা সহায়তার জন্য ফল নির্বাচন করুন', 'Select fruits you produce, sell, or need support for')}
      sections={db.length ? db : [
        {
          title: tx('ফল', 'Fruits'),
          items: [
            { id: 'mango', icon: '🥭', label: tx('আম', 'Mango') },
            { id: 'banana', icon: '🍌', label: tx('কলা', 'Banana') },
            { id: 'papaya', icon: '🍈', label: tx('পেঁপে', 'Papaya') },
            { id: 'lychee', icon: '🍒', label: tx('লিচু', 'Lychee') },
            { id: 'jackfruit', icon: '🍈', label: tx('কাঁঠাল', 'Jackfruit') },
            { id: 'watermelon', icon: '🍉', label: tx('তরমুজ', 'Watermelon') },
            { id: 'guava', icon: '🍐', label: tx('পেয়ারা', 'Guava') },
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

function Home({ setScreen, openProjects }: { setScreen: (screen: Screen) => void; openProjects: (tab: 'all' | 'area' | 'mine') => void }) {
  const { tx, lang } = useLanguage();
  const { user } = useAuth();
  const isFieldOfficer = hasRole(user, 'field_officer');
  const isSeller = hasRole(user, 'shathisheba_seller');
  // Scenario 2: a seller (partner) who is not a field officer gets a full-width Training tile.
  const trainingFullWidth = isSeller && !isFieldOfficer;
  const home = useAppHome(user?.id);
  const users = useApiList<ApiRow>('users');
  const liveWeather = useWeatherApi();
  const market = useApiList<ApiRow>('market-updates');
  const homeUser = user || (shouldUseFallback(users) ? fallbackProfileUser : users.rows[0]);
  const homeStats = home.data?.stats as ApiRow | undefined;
  const marketRows = shouldUseFallback(market) ? fallbackMarketUpdates : market.rows;
  const marketWarning = fallbackWarning(market);
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
        <Text style={styles.heroGreeting} numberOfLines={1}>
          <Text style={styles.heroSmall}>{tx('আসসালামু আলাইকুম, ', 'Assalamu Alaikum, ')}</Text>
          <Text style={styles.heroName}>{homeUser?.display_name || homeUser?.full_name || tx('শাথী ব্যবহারকারী', 'Shathi user')} 👋</Text>
        </Text>
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
      </Card>
      <View style={styles.metricsBand}>
        <MetricCard value={num(Number(homeStats?.listings ?? 0), lang)} label={tx('তালিকা', 'Listings')} icon="🏷️" tone="rose" />
        <View style={styles.metricDivider} />
        <MetricCard value={num(Number(homeStats?.orders ?? 0), lang)} label={tx('অর্ডার', 'Orders')} icon="🛒" tone="blue" />
        <View style={styles.metricDivider} />
        <MetricCard value={amount(Number(homeStats?.earnings ?? 0), lang)} label={tx('আয়', 'Earnings')} icon="৳" tone="green" />
      </View>
      <SectionTitle title={tx('সেবাসমূহ', 'Services')} />
      <View style={styles.serviceGrid}>
        {isFieldOfficer || isSeller ? (
          <ServiceCard icon="🏷️" title={tx('বিক্রির তালিকা', 'List for Sale')} sub={tx('পশু ও কৃষি পণ্য বিক্রি', 'Sell livestock & produce')} tone="rose" highlight onPress={() => setScreen('saleCategories')} />
        ) : null}
        <ServiceCard icon="🛒" title={tx('শাথী থেকে কিনুন', 'Buy from Shathi')} sub={tx('বীজ, ফিড, সার ও আরও', 'Seeds, feed, fertilizer & more')} tone="gold" highlight onPress={() => setScreen('buyCategories')} />
        <ServiceCard icon="🎓" title={tx('প্রশিক্ষণ মডিউল', 'Training Modules')} sub={tx('ভিডিও ও বিশেষজ্ঞ পরামর্শ', 'Videos & expert advice')} tone="blue" onPress={() => setScreen('training')} fullWidth={trainingFullWidth} />
        <ServiceCard icon="🤝" title={tx('শাথী পার্টনার প্রকল্প', 'Shathi Partner Projects')} sub={tx('চুক্তি চাষ ও সকল প্রকল্প', 'Contract farming & all projects')} tone="green" onPress={() => openProjects('all')} />
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
      <SectionTitle title={tx('বাজার আপডেট', 'Market Updates')} right={tx('সব দেখুন', 'See all')} warning={marketWarning} onRightPress={() => setScreen('marketUpdates')} />
      {market.loading ? <ApiStatus state={market} empty={tx('এখন কোনো বাজার আপডেট নেই।', 'No market updates are available right now.')} /> : null}
      {marketRows.slice(0, 3).map((item, index) => (
        <Alert
          key={item.id || index}
          title={rowTitle(item, lang, tx('বাজার আপডেট', 'Market update'))}
          sub={rowBody(item, lang, item.district || '')}
          badge={tEnum(item.status || item.update_type || '', lang)}
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

function MetricCard({ value, label, icon, tone }: { value: string; label: string; icon: string; tone: 'rose' | 'blue' | 'green' }) {
  const accent = tone === 'blue' ? colors.blue : tone === 'green' ? colors.green : colors.maroon;
  const chip = tone === 'blue' ? colors.bluePale : tone === 'green' ? colors.greenPale : colors.rose;
  return (
    <View style={styles.metricCard}>
      <View style={[styles.metricIcon, { backgroundColor: chip }]}><Text style={styles.metricIconText}>{icon}</Text></View>
      <Text style={[styles.metricValue, { color: accent }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
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
  const adminAlerts = shouldUseFallback(adminWeather) ? fallbackWeatherAlerts : adminWeather.rows;
  const weatherFallbackWarning = liveWeather.usingFallback || shouldUseFallback(adminWeather) ? SERVER_FALLBACK_MESSAGE : null;
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

      <SectionTitle title={tx('৩ দিনের পূর্বাভাস', '3-Day Forecast')} warning={liveWeather.usingFallback ? SERVER_FALLBACK_MESSAGE : null} />
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

      <SectionTitle title={tx('গুরুত্বপূর্ণ সতর্কতা', 'Important Updates')} warning={weatherFallbackWarning} />
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
  fullWidth,
  highlight,
  badge,
}: {
  icon: string;
  title: string;
  sub: string;
  tone: 'rose' | 'gold' | 'blue' | 'green';
  onPress: () => void;
  fullWidth?: boolean;
  highlight?: boolean;
  badge?: string;
}) {
  const bg = tone === 'gold' ? colors.goldPale : tone === 'blue' ? colors.bluePale : tone === 'green' ? colors.greenPale : colors.rose;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.serviceCard, fullWidth && styles.serviceCardFull, highlight && styles.serviceCardHighlight, pressed && styles.pressed]}>
      {highlight && badge ? <View style={styles.serviceBadge}><Text style={styles.serviceBadgeText}>{badge}</Text></View> : null}
      <View style={[styles.serviceIcon, { backgroundColor: bg }, highlight && styles.serviceIconHighlight]}>
        <Text style={styles.serviceIconText}>{icon}</Text>
      </View>
      <Text style={[styles.serviceTitle, highlight && styles.serviceTitleHighlight]}>{title}</Text>
      <Text style={[styles.serviceSub, highlight && styles.serviceSubHighlight]}>{sub}</Text>
      {highlight ? <Text style={styles.serviceArrow}>›</Text> : null}
    </Pressable>
  );
}

function SectionTitle({ title, right, warning, onRightPress }: { title: string; right?: string; warning?: string | null; onRightPress?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.sectionBlock}>
      <View style={styles.sectionRow}>
        <View style={styles.sectionTitleWrap}>
          <Text style={styles.sectionTitle}>{title}</Text>
          {warning ? (
            <Pressable onPress={() => setOpen((current) => !current)} hitSlop={10} style={styles.sectionWarningButton}>
              <Text style={styles.sectionWarningIcon}>!</Text>
            </Pressable>
          ) : null}
        </View>
        {right ? <Text style={styles.sectionRight} onPress={onRightPress}>{right}</Text> : null}
      </View>
      {warning && open ? (
        <View style={styles.sectionTooltip}>
          <Text style={styles.sectionTooltipText}>{warning}</Text>
        </View>
      ) : null}
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

function SaleCategories({ setScreen, patchDraft }: { setScreen: (screen: Screen) => void; patchDraft: (patch: Partial<ListingDraft>) => void }) {
  const { tx, lang } = useLanguage();
  const { user } = useAuth();
  const categories = useApiList<ApiRow>('sale/categories');
  const categoryRows = shouldUseFallback(categories) ? fallbackSaleCategories : categories.rows;
  const [available, setAvailable] = useState<string[] | null>(null);
  useEffect(() => {
    let alive = true;
    const uid = user?.id ? `?user_id=${encodeURIComponent(String(user.id))}` : '';
    apiRequest<{ data?: { available?: string[] } }>(`app/sale/category-availability${uid}`)
      .then((j) => { if (alive) setAvailable(j.data?.available ?? []); })
      .catch(() => { if (alive) setAvailable([]); });
    return () => { alive = false; };
  }, [user?.id]);

  function startListing(category: ApiRow) {
    const slug = String(category.slug || '').toLowerCase();
    const isLivestock = slug.includes('livestock') || slug.includes('cattle') || slug.includes('poultry');
    const isInputs = slug === 'inputs';
    patchDraft({ categorySlug: slug, animalId: null, animalName: '', species: null, breedId: null, breedName: '', saleItemId: null, saleItemName: '', variety: '', weightKg: '', quantity: '1', description: '', images: [], measure: null });
    setScreen(isLivestock ? 'cattleForm' : isInputs ? 'inputsForm' : 'inactive');
  }

  function renderTile(category: ApiRow) {
    const slug = String(category.slug || '').toLowerCase();
    const interestSlug = String(category.interest_slug || '');
    const catKey = interestSlug || slug; // inputs/machinery projects use the slug as interest_slug
    const isLivestock = slug.includes('livestock') || slug.includes('cattle') || slug.includes('poultry');
    const isInputs = slug === 'inputs';
    const built = isLivestock || isInputs;
    const hasProject = available === null ? built : available.includes(catKey);
    const enabled = built && hasProject;
    const emoji = category.emoji
      || (isLivestock ? '🐄' : slug.includes('crop') ? '🌾' : slug.includes('fish') ? '🐟' : slug.includes('veg') ? '🥬' : slug.includes('fruit') ? '🥭' : slug.includes('mach') ? '🚜' : isInputs ? '🌱' : '🌿');
    const sub = !hasProject
      ? tx('এই এলাকায় কোনো প্রকল্প নেই', 'No project in your area')
      : isLivestock ? tx('গবাদিপশু ও পোল্ট্রি বিক্রি', 'Sell cattle & poultry')
      : isInputs ? tx('বীজ, ফিড, সার বিক্রি', 'Sell seeds, feed, fertilizer')
      : tx('শীঘ্রই আসছে', 'Coming soon');
    return (
      <Tile key={category.id || slug} icon={emoji} title={rowTitle(category, lang, tx('বিভাগ', 'Category'))} subtitle={sub} dimmed={!enabled} onPress={() => (enabled ? startListing(category) : setScreen('inactive'))} />
    );
  }

  const mainCats = categoryRows.filter((c) => Number(c.pref_selectable) !== 0);
  const extraCats = categoryRows.filter((c) => Number(c.pref_selectable) === 0);

  return (
    <>
      <Header title={tx('বিক্রির তালিকা করুন', 'List for Sale')} onBack={() => setScreen('home')} />
      <Text style={styles.pageHint}>{tx('আপনার পণ্যের বিভাগ বেছে নিন', 'Choose your product category')}</Text>
      {categories.loading ? <ApiStatus state={categories} empty={tx('বিক্রির কোনো বিভাগ পাওয়া যায়নি।', 'No sale categories are available.')} /> : null}

      <SectionTitle title={tx('পণ্য ও উৎপাদন', 'Produce & Livestock')} warning={fallbackWarning(categories)} />
      <View style={styles.grid}>{mainCats.map(renderTile)}</View>

      {extraCats.length ? (
        <>
          <SectionTitle title={tx('উপকরণ ও যন্ত্রপাতি', 'Inputs & Machinery')} />
          <View style={styles.grid}>{extraCats.map(renderTile)}</View>
        </>
      ) : null}
    </>
  );
}

function Livestock({ setScreen }: { setScreen: (screen: Screen) => void }) {
  const { tx, lang } = useLanguage();
  const items = useApiList<ApiRow>('sale/items');
  const itemRows = shouldUseFallback(items) ? fallbackSaleItems : items.rows;
  return (
    <>
      <Header title={tx('গবাদিপশু', 'Livestock')} onBack={() => setScreen('saleCategories')} right={tx('সক্রিয়', 'Active')} />
      <Text style={styles.pageHint}>{tx('কোন পশু তালিকা করতে চান?', 'Which animal would you like to list?')}</Text>
      <SectionTitle title={tx('তালিকা ধরন', 'Listing type')} warning={fallbackWarning(items)} />
      {items.loading ? <ApiStatus state={items} empty={tx('তালিকা করার মতো কোনো আইটেম পাওয়া যায়নি।', 'No sale items are available.')} /> : null}
      {itemRows.map((item) => {
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

type CattleStepProps = {
  setScreen: (screen: Screen) => void;
  draft: ListingDraft;
  patchDraft: (patch: Partial<ListingDraft>) => void;
};

function CattleForm({ setScreen, draft, patchDraft }: CattleStepProps) {
  const { tx, lang } = useLanguage();
  const [showInfo, setShowInfo] = useState(false);
  const animalState = useApiList<ApiRow>('sale/animals');
  const breedResource = draft.species ? `sale/breeds?species=${encodeURIComponent(draft.species)}` : 'sale/breeds';
  const breedState = useApiList<ApiRow>(breedResource);

  const animalItems = animalState.rows
    .filter((row) => row.is_active !== 0)
    .map((row) => ({ id: String(row.id), label: `${row.emoji ? row.emoji + ' ' : ''}${rowTitle(row, lang, row.name_en || 'Animal')}`, raw: row }));
  const breedItems = breedState.rows
    .filter((row) => row.is_active !== 0)
    .map((row) => ({ id: String(row.id), label: rowTitle(row, lang, row.name_en || row.name_bn || 'Breed'), raw: row }));

  // Default the animal to the first one (Cow) and prefill contact once.
  useEffect(() => {
    if (!draft.animalId && animalItems.length) {
      const first = animalItems[0];
      patchDraft({ animalId: first.id, animalName: first.raw.name_en || first.label, species: first.raw.species || null, breedId: null, breedName: '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animalState.rows.length]);

  function selectAnimal(item: { id: string; raw: ApiRow }) {
    patchDraft({ animalId: item.id, animalName: item.raw.name_en || '', species: item.raw.species || null, breedId: null, breedName: '' });
  }
  function selectBreed(item: { id: string; raw: ApiRow }) {
    patchDraft({ breedId: item.id, breedName: item.raw.name_en || item.raw.name_bn || '' });
  }

  const canContinue = Boolean(draft.animalId && draft.breedId && Number(draft.weightKg) > 0 && draft.images.length > 0);
  const selectedAnimalLabel = animalItems.find((i) => i.id === draft.animalId)?.label ?? draft.animalName;

  return (
    <>
      <Header title={tx('গবাদিপশু বিক্রির তালিকা', 'List Livestock for Sale')} onBack={() => setScreen('saleCategories')} />
      {showInfo ? (
        <View style={styles.infoBar}>
          <Text style={styles.infoText}>{tx('পশুর ধরন, জাত, বয়স ও ওজন দিন এবং ছবি যুক্ত করুন। মাঠ কর্মকর্তা প্রকৃত ওজন যাচাই করবেন।', 'Enter animal type, breed, age and weight, and add photos. The field officer verifies the actual weight.')}</Text>
        </View>
      ) : null}

      <View style={styles.sectionHeadRow}>
        <Text style={styles.sectionHeadTitle}>{tx('পশুর তথ্য', 'Animal details')}</Text>
        <Pressable onPress={() => setShowInfo((v) => !v)} style={({ pressed }) => [styles.infoToggle, showInfo && styles.infoToggleActive, pressed && styles.pressed]}>
          <Text style={[styles.infoToggleText, showInfo && styles.infoToggleTextActive]}>{showInfo ? '×' : 'i'}</Text>
        </Pressable>
      </View>

      <View style={styles.twoCol}>
        <View style={styles.flex}>
          <FormLabel label={tx('পশুর ধরন', 'Animal type')} required />
          <PickerSelect compact value={selectedAnimalLabel} placeholder={tx('ধরন', 'Type')} items={animalItems} onSelect={selectAnimal} />
        </View>
        <View style={styles.flex}>
          <FormLabel label={tx('জাত', 'Breed')} required />
          <PickerSelect compact value={draft.breedName} placeholder={tx('জাত', 'Breed')} items={breedItems} onSelect={selectBreed} disabled={!draft.animalId} />
        </View>
      </View>

      <View style={styles.twoCol}>
        <View style={styles.flex}>
          <FormLabel label={tx('বয়স (মাস)', 'Age (months)')} />
          <TextInput style={[styles.input, styles.inRowInput]} value={draft.ageMonths} onChangeText={(v) => patchDraft({ ageMonths: v })} keyboardType="number-pad" />
        </View>
        <View style={styles.flex}>
          <FormLabel label={tx('পশুর সংখ্যা', 'Quantity')} />
          <Stepper value={draft.quantity} onChange={(v) => patchDraft({ quantity: v })} min={1} compact />
        </View>
      </View>

      <FormLabel label={tx('আনুমানিক ওজন (কেজি)', 'Tentative weight (kg)')} required />
      <View style={styles.weightRow}>
        <TextInput style={[styles.input, styles.flex, styles.weightRowInput]} value={draft.weightKg} onChangeText={(v) => patchDraft({ weightKg: v })} keyboardType="number-pad" placeholder={tx('যেমন ২০০', 'e.g. 200')} placeholderTextColor={colors.muted} />
        <Pressable onPress={() => setScreen('cattleMeasure')} style={({ pressed }) => [styles.measureBtn, pressed && styles.pressed]}>
          <Text style={styles.measureBtnText}>📏 {tx('ফিতা দিয়ে মাপুন', 'Measure by tape')}</Text>
        </Pressable>
      </View>
      <Text style={styles.fieldHint}>{tx('ফিতা পদ্ধতিতে বুকের বেড় ও দৈর্ঘ্য দিয়ে আনুমানিক ওজন বের করুন। চূড়ান্ত ওজন মাঠ কর্মকর্তা স্কেলে নেবেন।', 'Use the tape method (chest girth + body length) to estimate weight. Final weight is taken on the field officer scale.')}</Text>

      <MediaDescription draft={draft} patchDraft={patchDraft} kind="livestock" context={[draft.animalName && `type: ${draft.animalName}`, draft.breedName && `breed: ${draft.breedName}`, draft.ageMonths && `age ${draft.ageMonths} months`, Number(draft.weightKg) > 0 && `approx ${draft.weightKg} kg`].filter(Boolean).join(', ')} />

      <ContactSection draft={draft} patchDraft={patchDraft} />

      {!canContinue ? (
        <Text style={styles.fieldHint}>{tx('পশুর ধরন, জাত, ওজন ও অন্তত একটি ছবি দিন।', 'Add animal type, breed, weight and at least one photo to continue.')}</Text>
      ) : null}
      <AppButton title={tx('পশুর তথ্য নিশ্চিত করুন  →', 'Confirm Cattle Details  →')} onPress={() => setScreen('cattlePrice')} disabled={!canContinue} />
    </>
  );
}

// Tape-measurement weight estimator (Schaeffer / heart-girth method).
function CattleMeasure({ setScreen, draft, patchDraft }: CattleStepProps) {
  const { tx, lang } = useLanguage();
  const [unit, setUnit] = useState<'in' | 'cm'>('in');
  const [girth, setGirth] = useState(draft.measure?.girth ?? '');
  const [length, setLength] = useState(draft.measure?.length ?? '');
  const [height, setHeight] = useState(draft.measure?.height ?? '');

  const toInches = (v: number) => (unit === 'cm' ? v / 2.54 : v);
  const g = toInches(Number(girth) || 0);
  const l = toInches(Number(length) || 0);
  // Schaeffer's formula: weight(lb) = (girth^2 * length) / 300 ; kg = lb * 0.4536
  const weightKg = g > 0 && l > 0 ? Math.round(((g * g * l) / 300) * 0.4536) : 0;

  function useWeight() {
    patchDraft({ weightKg: String(weightKg), measure: { girth, length, height, weightKg } });
    setScreen('cattleForm');
  }

  return (
    <>
      <Header title={tx('ফিতা দিয়ে ওজন মাপুন', 'Measure Weight by Tape')} onBack={() => setScreen('cattleForm')} />
      <View style={styles.infoBar}>
        <Text style={styles.infoText}>{tx('ⓘ একটি ফিতা দিয়ে বুকের বেড় ও শরীরের দৈর্ঘ্য মেপে আনুমানিক ওজন বের করুন।', 'ⓘ Use a measuring tape to get chest girth and body length, then estimate the weight.')}</Text>
      </View>

      <View style={styles.measureDiagram}>
        <Text style={styles.measureDiagramArt}>🐄  ↔  📏</Text>
        <Text style={styles.measureDiagramText}>
          {tx('১) বুকের বেড় (Heart Girth): সামনের পায়ের ঠিক পেছনে বুক ঘিরে মাপুন।\n২) দৈর্ঘ্য (Body Length): কাঁধ থেকে লেজের গোড়া পর্যন্ত।',
            '1) Heart Girth: wrap the tape around the chest, just behind the front legs.\n2) Body Length: from the shoulder point to the pin bone (tail base).')}
        </Text>
      </View>

      <View style={styles.unitToggle}>
        {(['in', 'cm'] as const).map((u) => (
          <Pressable key={u} onPress={() => setUnit(u)} style={[styles.unitChip, unit === u && styles.unitChipActive]}>
            <Text style={[styles.unitChipText, unit === u && styles.unitChipTextActive]}>{u === 'in' ? tx('ইঞ্চি', 'inch') : tx('সেমি', 'cm')}</Text>
          </Pressable>
        ))}
      </View>

      <FormLabel label={tx('বুকের বেড় (Heart Girth)', 'Chest girth (heart girth)')} />
      <TextInput style={styles.input} value={girth} onChangeText={setGirth} keyboardType="numeric" placeholder={unit === 'in' ? tx('যেমন ৬৫', 'e.g. 65') : tx('যেমন ১৬৫', 'e.g. 165')} placeholderTextColor={colors.muted} />
      <FormLabel label={tx('শরীরের দৈর্ঘ্য (Body Length)', 'Body length')} />
      <TextInput style={styles.input} value={length} onChangeText={setLength} keyboardType="numeric" placeholder={unit === 'in' ? tx('যেমন ৫৫', 'e.g. 55') : tx('যেমন ১৪০', 'e.g. 140')} placeholderTextColor={colors.muted} />
      <FormLabel label={tx('উচ্চতা (ঐচ্ছিক)', 'Height (optional)')} />
      <TextInput style={styles.input} value={height} onChangeText={setHeight} keyboardType="numeric" placeholderTextColor={colors.muted} />

      <View style={styles.estimate}>
        <Text style={styles.estimateLabel}>{tx('আনুমানিক ওজন', 'Approximate weight')}</Text>
        <Text style={styles.estimateValue}>{weightKg > 0 ? `${num(weightKg, lang)} ${tx('কেজি', 'kg')}` : '—'}</Text>
      </View>
      <Text style={styles.fieldHint}>{tx('এটি আনুমানিক (প্রাক-গণনাকৃত) ওজন। চূড়ান্ত ওজন মাঠ কর্মকর্তা স্কেলে নেবেন।', 'This is a tentative (pre-calculated) weight. Final weight is taken on the field officer scale.')}</Text>
      <AppButton title={tx('এই ওজন ব্যবহার করুন', 'Use this weight')} onPress={useWeight} disabled={weightKg <= 0} />
      <AppButton title={tx('বাতিল', 'Cancel')} variant="outline" onPress={() => setScreen('cattleForm')} />
    </>
  );
}

function FormLabel({ label, required, small }: { label: string; required?: boolean; small?: boolean }) {
  return (
    <Text style={[styles.label, small && styles.labelSm]}>
      {label}{required ? <Text style={styles.reqStar}> *</Text> : null}
    </Text>
  );
}

// +/- counter for quantities. Compact mode drops the outer margin for cards.
function Stepper({ value, onChange, min = 0, max = 99999, step = 1, compact = false }: { value: string; onChange: (v: string) => void; min?: number; max?: number; step?: number; compact?: boolean }) {
  const n = Number(value) || 0;
  const set = (x: number) => onChange(String(Math.max(min, Math.min(max, x))));
  return (
    <View style={[styles.stepper, compact && styles.stepperCompact]}>
      <Pressable onPress={() => set(n - step)} style={({ pressed }) => [styles.stepperBtn, pressed && styles.pressed]}><Text style={styles.stepperBtnText}>−</Text></Pressable>
      <TextInput style={styles.stepperInput} value={value} onChangeText={(v) => onChange(v.replace(/[^0-9.]/g, ''))} keyboardType="number-pad" />
      <Pressable onPress={() => set(n + step)} style={({ pressed }) => [styles.stepperBtn, pressed && styles.pressed]}><Text style={styles.stepperBtnText}>＋</Text></Pressable>
    </View>
  );
}

function FakeSelect({ value, options, onChange, disabled = false }: { value: string; options?: string[]; onChange?: (value: string) => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const interactive = !disabled && !!options?.length && !!onChange;
  return (
    <>
      <Pressable disabled={!interactive} onPress={() => setOpen(true)} style={({ pressed }) => [styles.fakeSelect, disabled && styles.inputDisabled, pressed && interactive && styles.pressed]}>
        <Text style={styles.fakeSelectText}>{value}</Text>
        <Text style={styles.chevron}>⌄</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.dropdownBackdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.dropdownCard} onPress={() => {}}>
            <View style={styles.dropdownHandle} />
            <ScrollView showsVerticalScrollIndicator={false}>
              {(options || []).map((opt) => (
                <Pressable key={opt} style={[styles.dropdownOption, opt === value && styles.dropdownOptionActive]} onPress={() => { onChange?.(opt); setOpen(false); }}>
                  <Text style={[styles.dropdownOptionText, opt === value && styles.dropdownOptionTextActive]} numberOfLines={1}>{opt}</Text>
                  {opt === value ? <Text style={styles.dropdownCheck}>✓</Text> : null}
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

// Generic dropdown backed by {id,label} items (animal, breed, geo).
function PickerSelect({ value, placeholder, items, onSelect, disabled = false, compact = false }: {
  value?: string;
  placeholder: string;
  items: { id: string; label: string; raw?: any }[];
  onSelect: (item: any) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const interactive = !disabled && items.length > 0;
  return (
    <>
      <Pressable disabled={!interactive} onPress={() => setOpen(true)} style={({ pressed }) => [styles.fakeSelect, compact && styles.fakeSelectCompact, disabled && styles.inputDisabled, pressed && interactive && styles.pressed]}>
        <Text style={[styles.fakeSelectText, !value && styles.fakeSelectPlaceholder]} numberOfLines={1}>{value || placeholder}</Text>
        <Text style={styles.chevron}>⌄</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.dropdownBackdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.dropdownCard} onPress={() => {}}>
            <View style={styles.dropdownHandle} />
            <Text style={styles.dropdownSheetTitle}>{placeholder}</Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              {items.map((item) => {
                const sel = item.label === value;
                return (
                  <Pressable key={item.id} style={[styles.dropdownOption, sel && styles.dropdownOptionActive]} onPress={() => { onSelect(item); setOpen(false); }}>
                    <Text style={[styles.dropdownOptionText, sel && styles.dropdownOptionTextActive]} numberOfLines={1}>{item.label}</Text>
                    {sel ? <Text style={styles.dropdownCheck}>✓</Text> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

// Cascading Division -> District -> Thana picker sourced from the geo API.
function GeoPicker({ draft, patchDraft, small = false, hideGps = false, gpsRef }: { draft: ListingDraft; patchDraft: (patch: Partial<ListingDraft>) => void; small?: boolean; hideGps?: boolean; gpsRef?: React.MutableRefObject<(() => void) | undefined> }) {
  const { tx, lang } = useLanguage();
  const appLocation = useAppLocation();
  const divisions = useApiList<ApiRow>('geo/divisions');
  const districts = useApiList<ApiRow>(draft.divisionId ? `geo/districts?division_id=${draft.divisionId}` : 'geo/districts');
  const thanas = useApiList<ApiRow>(draft.districtId ? `geo/upazilas?district_id=${draft.districtId}` : 'geo/upazilas');
  const toItems = (rows: ApiRow[]) => rows.map((r) => ({ id: String(r.id), label: rowTitle(r, lang, r.name_en || 'N/A'), raw: r }));
  const matchByName = (rows: ApiRow[], name?: string) => {
    const n = String(name || '').trim().toLowerCase();
    if (!n) return undefined;
    return rows.find((r) => String(r.name_en).toLowerCase() === n) || rows.find((r) => String(r.name_en).toLowerCase().includes(n) || n.includes(String(r.name_en).toLowerCase()));
  };
  function useGps() {
    const d = appLocation.detected;
    if (!appLocation.granted || !d) return;
    const dv = matchByName(divisions.rows, d.division);
    patchDraft({
      divisionId: dv ? String(dv.id) : draft.divisionId,
      divisionName: dv ? String(dv.name_en) : (d.division || draft.divisionName),
      districtId: null, districtName: d.district || '',
      thanaId: null, thanaName: d.thana || '', thanaOther: false,
    });
  }
  if (gpsRef) gpsRef.current = useGps;
  return (
    <>
      {!hideGps ? (
        <View style={styles.gpsPillRow}>
          <Pressable onPress={useGps} style={({ pressed }) => [styles.gpsPill, pressed && styles.pressed]}>
            <Text style={styles.gpsPillText}>⌖ {tx('GPS দিয়ে পূরণ', 'Use GPS')}</Text>
          </Pressable>
        </View>
      ) : null}
      {!small ? <FormLabel required label={tx('বিভাগ', 'Division')} /> : null}
      {small ? <View style={{ height: 2 }} /> : null}
      <PickerSelect
        value={draft.divisionName}
        placeholder={tx('বিভাগ বেছে নিন', 'Select division')}
        items={toItems(divisions.rows)}
        compact={small}
        onSelect={(item) => patchDraft({ divisionId: item.id, divisionName: item.raw.name_en || '', districtId: null, districtName: '', thanaId: null, thanaName: '' })}
      />
      <View style={small ? styles.geoRow : styles.twoCol}>
        <View style={styles.flex}>
          {!small ? <FormLabel label={tx('জেলা', 'District')} /> : null}
          <PickerSelect
            value={draft.districtName}
            placeholder={tx('জেলা বেছে নিন', 'Select district')}
            items={toItems(districts.rows)}
            disabled={!draft.divisionId}
            compact={small}
            onSelect={(item) => patchDraft({ districtId: item.id, districtName: item.raw.name_en || '', thanaId: null, thanaName: '' })}
          />
        </View>
        <View style={styles.flex}>
          {!small ? <FormLabel label={tx('থানা / উপজেলা', 'Thana / Upazila')} /> : null}
          <PickerSelect
            value={draft.thanaOther ? tx('অন্যান্য', 'Other') : draft.thanaName}
            placeholder={tx('থানা বেছে নিন', 'Select thana')}
            items={[...toItems(thanas.rows), { id: '__other__', label: tx('অন্যান্য (নিজে লিখুন)', 'Other (type manually)'), raw: {} as ApiRow }]}
            disabled={!draft.districtId}
            compact={small}
            onSelect={(item) => item.id === '__other__'
              ? patchDraft({ thanaOther: true, thanaId: null, thanaName: '' })
              : patchDraft({ thanaOther: false, thanaId: item.id, thanaName: item.raw.name_en || '' })}
          />
        </View>
      </View>
      {draft.thanaOther ? (
        <TextInput style={small ? styles.inputSm : styles.input} value={draft.thanaName} onChangeText={(v) => patchDraft({ thanaName: v })} placeholder={tx('থানার নাম লিখুন', 'Type thana name')} placeholderTextColor={colors.muted} />
      ) : null}
    </>
  );
}

// KYC status pill colour by status string.
function kycTone(s?: string): 'green' | 'gold' | 'rose' | 'muted' {
  return s === 'verified' ? 'green' : s === 'pending' ? 'gold' : s === 'rejected' ? 'rose' : 'muted';
}

// Compact, reusable contact + address block for every listing type.
// Radio: "Me" (prefilled + KYC status chips) vs "Someone else" (manual incl NID).
function ContactSection({ draft, patchDraft }: { draft: ListingDraft; patchDraft: (patch: Partial<ListingDraft>) => void }) {
  const { tx, lang } = useLanguage();
  const { user } = useAuth();
  const kyc = user?.kyc || {};
  const gpsRef = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    if (draft.contactSelf && !draft.contactName && user) {
      patchDraft({
        contactName: user.display_name || user.full_name || '',
        contactPhone: user.phone || '',
        contactNid: user.nid_number || '',
        districtName: draft.districtName || user.district || '',
        thanaName: draft.thanaName || user.upazila || '',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  function chooseSelf(self: boolean) {
    if (self) {
      patchDraft({ contactSelf: true, contactName: user?.display_name || user?.full_name || '', contactPhone: user?.phone || '', contactNid: user?.nid_number || '' });
    } else {
      patchDraft({ contactSelf: false, contactName: '', contactPhone: '', contactNid: '' });
    }
  }

  const chips: Array<[string, string, string | undefined]> = [
    ['🪪', tx('NID', 'NID'), kyc.nid],
    ['🤳', tx('সেলফি', 'Selfie'), kyc.selfie],
    ['🏦', tx('ব্যাংক', 'Bank'), kyc.banking ? 'verified' : 'none'],
  ];

  return (
    <View style={styles.formCard}>
      <View style={styles.formCardTitleRow}>
        <Text style={styles.formCardTitle}>{tx('যোগাযোগের ব্যক্তি', 'Contact person')}</Text>
        <Pressable onPress={() => gpsRef.current?.()} style={({ pressed }) => [styles.gpsPill, pressed && styles.pressed]}>
          <Text style={styles.gpsPillText}>⌖ {tx('GPS', 'Use GPS')}</Text>
        </Pressable>
      </View>
      <View style={styles.radioRow}>
        {([[true, tx('আমি', 'Me')], [false, tx('অন্য কেউ', 'Someone else')]] as Array<[boolean, string]>).map(([val, label]) => {
          const active = draft.contactSelf === val;
          return (
            <Pressable key={String(val)} onPress={() => chooseSelf(val)} style={[styles.radioPill, active && styles.radioPillActive]}>
              <View style={[styles.radioDot, active && styles.radioDotActive]}>{active ? <View style={styles.radioDotInner} /> : null}</View>
              <Text style={[styles.radioText, active && styles.radioTextActive]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      {draft.contactSelf ? (
        <>
          <View style={styles.kycChips}>
            {chips.map(([icon, label, st]) => {
              const tone = kycTone(st);
              return (
                <View key={label} style={[styles.kycChip, styles[`kycChip_${tone}` as 'kycChip_green']]}>
                  <Text style={styles.kycChipText}>{icon} {label}: {st === 'verified' ? '✓' : st === 'pending' ? tx('অপেক্ষমাণ', 'pending') : st === 'rejected' ? '✕' : tx('নেই', 'none')}</Text>
                </View>
              );
            })}
          </View>
          {!user?.is_kyc_verified ? (
            <Text style={styles.fieldHint}>{tx('সম্পূর্ণ যাচাইয়ের জন্য মেনু → KYC ডকুমেন্ট থেকে আপলোড করুন।', 'Upload from Menu → KYC Documents to complete verification.')}</Text>
          ) : null}
        </>
      ) : (
        <Text style={styles.fieldHint}>{tx('এই ব্যক্তির নাম, মোবাইল ও NID দিন। যাচাইয়ের সময় মাঠ কর্মকর্তা তথ্য মিলিয়ে দেখবেন।', "Enter this person's name, mobile and NID. The field officer will verify these details.")}</Text>
      )}

      <View style={styles.geoRow}>
        <View style={styles.flex}>
          <FormLabel small required label={tx('নাম', 'Name')} />
          <TextInput style={styles.inputSm} value={draft.contactName} onChangeText={(v) => patchDraft({ contactName: v })} placeholder={tx('পূর্ণ নাম', 'Full name')} placeholderTextColor={colors.muted} />
        </View>
        <View style={styles.flex}>
          <FormLabel small required label={tx('মোবাইল', 'Mobile')} />
          <TextInput style={styles.inputSm} value={draft.contactPhone} onChangeText={(v) => patchDraft({ contactPhone: v })} keyboardType="phone-pad" placeholder="01XXXXXXXXX" placeholderTextColor={colors.muted} />
        </View>
      </View>
      {!draft.contactSelf ? (
        <>
          <FormLabel small required label={tx('NID নম্বর', 'NID number')} />
          <TextInput style={styles.inputSm} value={draft.contactNid} onChangeText={(v) => patchDraft({ contactNid: v })} keyboardType="number-pad" placeholder={tx('১০ বা ১৭ সংখ্যা', '10 or 17 digits')} placeholderTextColor={colors.muted} />
        </>
      ) : null}
      <GeoPicker draft={draft} patchDraft={patchDraft} small hideGps gpsRef={gpsRef} />
      <FormLabel small label={tx('বিস্তারিত ঠিকানা (গ্রাম)', 'Address (village)')} />
      <TextInput style={styles.inputSm} value={draft.addressText} onChangeText={(v) => patchDraft({ addressText: v })} placeholder={tx('গ্রাম / বাড়ি', 'Village / house')} placeholderTextColor={colors.muted} />
    </View>
  );
}

// Reusable multi-image upload + category-gated AI description (Shathi Apa).
// Read-only while generating; editable after. Refuses off-category photos.
function MediaDescription({ draft, patchDraft, kind, context }: { draft: ListingDraft; patchDraft: (patch: Partial<ListingDraft>) => void; kind: 'livestock' | 'inputs'; context?: string }) {
  const { tx, lang } = useLanguage();
  const [aiError, setAiError] = useState('');
  const [genDone, setGenDone] = useState(false);

  async function pickImages() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsMultipleSelection: true, selectionLimit: 6, quality: 0.72 });
    if (!result.canceled) patchDraft({ images: [...draft.images, ...result.assets.map((a) => a.uri)].slice(0, 6) });
  }
  function removeImage(uri: string) { patchDraft({ images: draft.images.filter((u) => u !== uri) }); }

  async function generate() {
    if (!draft.images.length) { setAiError(tx('আগে অন্তত একটি ছবি যোগ করুন।', 'Add at least one photo first.')); return; }
    setAiError('');
    patchDraft({ aiGenerating: true });
    try {
      const text = await generateListingDescription(draft.images[0], lang, { kind, context });
      if (/NOT_RELEVANT/i.test(text) || text.length < 4) {
        patchDraft({ aiGenerating: false });
        setAiError(kind === 'livestock'
          ? tx('এই ছবিটি গরু, বলদ, মহিষ, ছাগল, ভেড়া বা পোল্ট্রির স্পষ্ট ছবি মনে হচ্ছে না। অনুগ্রহ করে উল্লিখিত পশুর একটি ছবি আপলোড করুন।', 'This does not look like a clear photo of a cow, bull, buffalo, goat, sheep or poultry. Please upload a photo of the listed animal.')
          : tx('এই ছবিটি বীজ, ফিড বা সারের স্পষ্ট ছবি মনে হচ্ছে না। অনুগ্রহ করে উপকরণের একটি ছবি আপলোড করুন।', 'This does not look like a clear photo of seeds, feed or fertilizer. Please upload a photo of the input.'));
        return;
      }
      patchDraft({ description: text, aiGenerating: false });
      setGenDone(true);
    } catch (e) {
      patchDraft({ aiGenerating: false });
      setAiError(friendlyAiError(e, lang));
    }
  }

  const canGen = !draft.aiGenerating && draft.images.length > 0;
  return (
    <>
      <FormLabel label={tx('ছবি (একাধিক)', 'Photos (multiple)')} required />
      <Pressable onPress={pickImages} style={({ pressed }) => [styles.uploadCompact, pressed && styles.pressed]}>
        <Text style={styles.uploadIcon}>＋</Text>
        <Text style={styles.uploadTitle}>{tx('ছবি যোগ করুন', 'Add photos')}</Text>
        <Text style={styles.uploadSub}>{tx('সর্বোচ্চ ৬টি · JPG, PNG', 'Up to 6 · JPG, PNG')}</Text>
      </Pressable>
      {draft.images.length ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.thumbRow}>
          {draft.images.map((uri) => (
            <View key={uri} style={styles.thumbWrap}>
              <Image source={{ uri }} style={styles.thumb} />
              <Pressable onPress={() => removeImage(uri)} style={styles.thumbRemove}><Text style={styles.thumbRemoveText}>×</Text></Pressable>
            </View>
          ))}
        </ScrollView>
      ) : null}

      <FormLabel label={tx('বিবরণ', 'Description')} />
      <Pressable onPress={generate} disabled={!canGen} style={({ pressed }) => [styles.aiBtnBlock, !canGen && styles.aiBtnDisabled, pressed && canGen && styles.pressed]}>
        <Text style={styles.aiBtnBlockText}>{draft.aiGenerating ? tx('শাথী আপা তৈরি করছে...', 'Shathi Apa is writing…') : genDone ? tx('✨ আবার তৈরি করুন', '✨ Regenerate') : tx('✨ শাথী আপা দিয়ে তৈরি করুন', '✨ Generate by Shathi Apa')}</Text>
      </Pressable>
      <TextInput
        style={[styles.input, styles.descInput, draft.aiGenerating && styles.inputDisabled]}
        value={draft.description}
        editable={!draft.aiGenerating}
        onChangeText={(v) => patchDraft({ description: v })}
        multiline
        placeholder={tx('ছবি যোগ করে শাথী আপা দিয়ে বিবরণ তৈরি করুন, অথবা নিজে লিখুন।', 'Add a photo and let Shathi Apa write the description, or write your own.')}
        placeholderTextColor={colors.muted}
      />
      {draft.aiGenerating ? <Text style={styles.fieldHint}>{tx('শাথী আপা ছবি বিশ্লেষণ করছে... সম্পন্ন হলে বিবরণ সম্পাদনা করা যাবে।', 'Shathi Apa is analyzing the photo… you can edit once it finishes.')}</Text> : null}
      {aiError ? <Text style={styles.apiNotice}>{aiError}</Text> : null}
    </>
  );
}

function CattlePrice({ setScreen, draft, patchDraft, onSubmitted }: CattleStepProps & { onSubmitted: (listing: ApiRow) => void }) {
  const { tx, lang } = useLanguage();
  const { user } = useAuth();
  const [quote, setQuote] = useState<ApiRow | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const district = draft.districtName || user?.district || '';
  const w = Number(draft.weightKg) || 0;

  useEffect(() => {
    let alive = true;
    setQuoteLoading(true);
    const params = new URLSearchParams();
    if (draft.animalId) params.set('animal_id', draft.animalId);
    if (draft.breedId) params.set('breed_id', draft.breedId);
    if (district) params.set('district', district);
    if (w > 0) params.set('weight', String(w));
    apiRequest<{ data?: ApiRow }>(`app/sale/price-quote?${params.toString()}`)
      .then((json) => { if (alive) setQuote(json.data?.breakdown ?? null); })
      .catch(() => { if (alive) setQuote(null); })
      .finally(() => { if (alive) setQuoteLoading(false); });
    return () => { alive = false; };
  }, [draft.animalId, draft.breedId, district, w]);

  const b2bRate = Number(quote?.b2b_market_rate ?? 0);
  const platformFee = Number(quote?.platform_fee ?? 0);
  const logisticsFee = Number(quote?.logistics_fee ?? 0);
  const vetFee = Number(quote?.warehouse_vet_fee ?? 0);
  const farmerRate = Number(quote?.net_farmer_rate ?? (b2bRate - platformFee - logisticsFee - vetFee)) || 670;
  const rows: Array<[string, string, number, boolean]> = [
    [tx('B2B বাজার দর', 'B2B market rate'), tx('পাইকারি ক্রয় মূল্য', 'Wholesale buy rate'), b2bRate, false],
    [tx('প্ল্যাটফর্ম চার্জ', 'Platform fee'), '', -platformFee, false],
    [tx('লজিস্টিক্স ও পরিবহন', 'Logistics & transport'), '', -logisticsFee, false],
    [tx('গুদাম ও পশু চিকিৎসা', 'Warehouse & vet care'), '', -vetFee, false],
    [tx('নিট কৃষক মূল্য', 'Net farmer rate'), tx('আপনি পাবেন এই মূল্যে', 'Your selling rate'), farmerRate, true],
  ];

  async function submitListing() {
    setSubmitting(true);
    setSubmitError('');
    try {
      let mediaUrls: string[] = [];
      try {
        mediaUrls = await Promise.all(draft.images.map((uri) => uploadImage(uri, 'sale-listings')));
      } catch {
        mediaUrls = draft.images; // fall back to local uris if upload fails
      }
      const listingCode = `SAL-APP-${Date.now()}`;
      const response = await apiCreate('sale/listings', {
        listing_code: listingCode,
        user_id: Number(user?.id) || 1,
        sale_item_id: 1,
        animal_id: draft.animalId ? Number(draft.animalId) : undefined,
        breed_id: draft.breedId ? Number(draft.breedId) : undefined,
        title_en: `${draft.animalName || 'Livestock'} listing from mobile app`,
        title_bn: 'মোবাইল অ্যাপ থেকে পশুর তালিকা',
        description: draft.description || undefined,
        age_months: Number(draft.ageMonths) || undefined,
        weight_kg: w,
        quantity: Number(draft.quantity) || 1,
        unit: 'piece',
        farmer_expected_price: farmerRate,
        estimated_earning: w * farmerRate,
        contact_phone: draft.contactPhone,
        contact_name: draft.contactName || undefined,
        contact_nid: draft.contactNid || undefined,
        contact_is_self: draft.contactSelf ? 1 : 0,
        division: draft.divisionName || undefined,
        district: draft.districtName || user?.district || undefined,
        upazila: draft.thanaName || user?.upazila || undefined,
        address_text: [draft.addressText, draft.thanaName, draft.districtName, draft.divisionName].filter(Boolean).join(', '),
        media_json: mediaUrls,
        ai_analysis_json: { source: 'mobile_app', measure: draft.measure },
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
          <Text style={styles.smallUpper}>{tx('আনুমানিক ওজন', 'Tentative weight')}</Text>
          <View style={styles.weightInputRow}>
            <TextInput style={styles.weightInput} value={draft.weightKg} onChangeText={(v) => patchDraft({ weightKg: v })} keyboardType="number-pad" />
            <Text style={styles.kgText}>{tx('কেজি', 'kg')}</Text>
          </View>
        </View>
        <View>
          <Text style={styles.miniMuted}>{tx('সম্ভাব্য আয়', 'Earning')}</Text>
          <Text style={styles.quickEarn}>{amount(w * farmerRate, lang)}</Text>
        </View>
      </Card>

      <View style={styles.summaryChips}>
        <View style={styles.summaryChip}><Text style={styles.summaryChipText}>{draft.animalName || tx('পশু', 'Animal')}</Text></View>
        {draft.breedName ? <View style={styles.summaryChip}><Text style={styles.summaryChipText}>{draft.breedName}</Text></View> : null}
        {district ? <View style={styles.summaryChip}><Text style={styles.summaryChipText}>⌖ {district}</Text></View> : null}
      </View>

      {quoteLoading ? <Text style={styles.fieldHint}>{tx('অনুমোদিত B2B দর আনা হচ্ছে...', 'Fetching approved B2B rate...')}</Text> : null}
      {!quoteLoading && !quote ? <Text style={styles.fieldHint}>{tx('এই অঞ্চলে অনুমোদিত দর নেই — ডিফল্ট দর দেখানো হচ্ছে।', 'No approved rate for this region — showing default rate.')}</Text> : null}

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
        {rows.map(([title, sub, rate, highlight]) => (
          <View key={title} style={[styles.priceRow, highlight && styles.priceRowHighlight]}>
            <View style={styles.flex}>
              <Text style={[styles.priceTitle, highlight && styles.priceTitleStrong]}>{title}</Text>
              {sub ? <Text style={styles.priceSub}>{sub}</Text> : null}
            </View>
            <Text style={styles.rateText}>৳{num(Math.abs(rate), lang)}</Text>
            <Text style={styles.totalText}>{amount(rate * w, lang)}</Text>
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
      {submitError ? <Text style={styles.apiNotice}>{submitError}</Text> : null}
      <AppButton title={submitting ? tx('জমা হচ্ছে...', 'Submitting...') : tx('অর্ডার যাচাইয়ের জন্য নিশ্চিত করুন ✓', 'Confirm for Order Validation ✓')} onPress={submitListing} disabled={submitting} />
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

function InputsForm({ setScreen, draft, patchDraft }: CattleStepProps) {
  const { tx, lang } = useLanguage();
  const itemsState = useApiList<ApiRow>('sale/items');
  const inputItems = itemsState.rows
    .filter((r) => String(r.category_slug) === 'inputs' && r.status !== 'inactive')
    .map((r) => ({ id: String(r.id), label: rowTitle(r, lang, r.name_en || 'Item'), raw: r }));

  useEffect(() => {
    if (!draft.saleItemId && inputItems.length) {
      const f = inputItems[0];
      patchDraft({ saleItemId: f.id, saleItemName: f.raw.name_en || f.label, unit: 'kg' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsState.rows.length]);

  const canContinue = Boolean(draft.saleItemId && Number(draft.weightKg) > 0 && draft.images.length > 0);
  const selectedLabel = inputItems.find((i) => i.id === draft.saleItemId)?.label ?? draft.saleItemName;

  return (
    <>
      <Header title={tx('উপকরণ বিক্রির তালিকা', 'List Inputs for Sale')} onBack={() => setScreen('saleCategories')} />
      <View style={styles.infoBar}>
        <Text style={styles.infoText}>{tx('ⓘ উদ্বৃত্ত বীজ, ফিড বা সার ন্যায্য দরে বিক্রি করুন। ধরন, পরিমাণ ও ছবি দিন।', 'ⓘ Sell surplus seeds, feed or fertilizer at a fair rate. Add type, quantity and photos.')}</Text>
      </View>

      <SectionTitle title={tx('উপকরণের তথ্য', 'Input details')} />
      {itemsState.loading ? <ApiStatus state={itemsState} /> : null}
      <View style={styles.twoCol}>
        <View style={styles.flex}>
          <FormLabel label={tx('উপকরণের ধরন', 'Input type')} required />
          <PickerSelect compact value={selectedLabel} placeholder={tx('ধরন', 'Type')} items={inputItems} onSelect={(item) => patchDraft({ saleItemId: item.id, saleItemName: item.raw.name_en || '', unit: 'kg' })} />
        </View>
        <View style={styles.flex}>
          <FormLabel label={tx('নাম / জাত', 'Name / variety')} />
          <TextInput style={[styles.input, styles.inRowInput]} value={draft.variety} onChangeText={(v) => patchDraft({ variety: v })} placeholder={tx('যেমন BRRI ধান২৮', 'e.g. BRRI 28')} placeholderTextColor={colors.muted} />
        </View>
      </View>

      <View style={styles.twoCol}>
        <View style={styles.flex}>
          <FormLabel label={tx('পরিমাণ (কেজি)', 'Quantity (kg)')} required />
          <TextInput style={[styles.input, styles.inRowInput]} value={draft.weightKg} onChangeText={(v) => patchDraft({ weightKg: v })} keyboardType="number-pad" placeholder={tx('যেমন ১০০', 'e.g. 100')} placeholderTextColor={colors.muted} />
        </View>
        <View style={styles.flex}>
          <FormLabel label={tx('লট সংখ্যা', 'Lots')} />
          <Stepper value={draft.quantity} onChange={(v) => patchDraft({ quantity: v })} min={1} compact />
        </View>
      </View>

      <MediaDescription draft={draft} patchDraft={patchDraft} kind="inputs" context={[draft.saleItemName && `type: ${draft.saleItemName}`, draft.variety && `name: ${draft.variety}`, Number(draft.weightKg) > 0 && `quantity ${draft.weightKg} kg`].filter(Boolean).join(', ')} />

      <ContactSection draft={draft} patchDraft={patchDraft} />

      {!canContinue ? (
        <Text style={styles.fieldHint}>{tx('উপকরণের ধরন, পরিমাণ ও অন্তত একটি ছবি দিন।', 'Add input type, quantity and at least one photo to continue.')}</Text>
      ) : null}
      <AppButton title={tx('তালিকা নিশ্চিত করুন  →', 'Confirm listing  →')} onPress={() => setScreen('inputsPrice')} disabled={!canContinue} />
    </>
  );
}

function InputsPrice({ setScreen, draft, patchDraft, onSubmitted }: CattleStepProps & { onSubmitted: (listing: ApiRow) => void }) {
  const { tx, lang } = useLanguage();
  const { user } = useAuth();
  const [quote, setQuote] = useState<ApiRow | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const district = draft.districtName || user?.district || '';
  const qty = Number(draft.weightKg) || 0;

  useEffect(() => {
    let alive = true;
    setQuoteLoading(true);
    const params = new URLSearchParams();
    if (draft.saleItemId) params.set('sale_item_id', draft.saleItemId);
    if (district) params.set('district', district);
    if (qty > 0) params.set('weight', String(qty));
    apiRequest<{ data?: ApiRow }>(`app/sale/price-quote?${params.toString()}`)
      .then((json) => { if (alive) setQuote(json.data?.breakdown ?? null); })
      .catch(() => { if (alive) setQuote(null); })
      .finally(() => { if (alive) setQuoteLoading(false); });
    return () => { alive = false; };
  }, [draft.saleItemId, district, qty]);

  const b2bRate = Number(quote?.b2b_market_rate ?? 0);
  const platformFee = Number(quote?.platform_fee ?? 0);
  const logisticsFee = Number(quote?.logistics_fee ?? 0);
  const handlingFee = Number(quote?.warehouse_vet_fee ?? 0);
  const farmerRate = Number(quote?.net_farmer_rate ?? (b2bRate - platformFee - logisticsFee - handlingFee)) || 0;
  const unit = String(quote?.unit || draft.unit || 'kg');
  const rows: Array<[string, string, number, boolean]> = [
    [tx('B2B বাজার দর', 'B2B market rate'), tx('পাইকারি ক্রয় মূল্য', 'Wholesale buy rate'), b2bRate, false],
    [tx('প্ল্যাটফর্ম চার্জ', 'Platform fee'), '', -platformFee, false],
    [tx('লজিস্টিক্স ও পরিবহন', 'Logistics & transport'), '', -logisticsFee, false],
    [tx('গুদাম ও হ্যান্ডলিং', 'Warehouse & handling'), '', -handlingFee, false],
    [tx('নিট কৃষক মূল্য', 'Net farmer rate'), tx('আপনি পাবেন এই দরে', 'Your selling rate'), farmerRate, true],
  ];

  async function submitListing() {
    setSubmitting(true);
    setSubmitError('');
    try {
      let mediaUrls: string[] = [];
      try { mediaUrls = await Promise.all(draft.images.map((uri) => uploadImage(uri, 'sale-listings'))); } catch { mediaUrls = draft.images; }
      const listingCode = `INP-APP-${Date.now()}`;
      const response = await apiCreate('sale/listings', {
        listing_code: listingCode,
        user_id: Number(user?.id) || 1,
        sale_item_id: draft.saleItemId ? Number(draft.saleItemId) : undefined,
        title_en: `${[draft.saleItemName || 'Input', draft.variety].filter(Boolean).join(' — ')} listing from mobile app`,
        title_bn: `${[draft.variety, draft.saleItemName].filter(Boolean).join(' ')} উপকরণের তালিকা`.trim() || 'মোবাইল অ্যাপ থেকে উপকরণের তালিকা',
        description: draft.description || undefined,
        weight_kg: qty,
        quantity: Number(draft.quantity) || 1,
        unit,
        farmer_expected_price: farmerRate,
        estimated_earning: qty * farmerRate,
        contact_phone: draft.contactPhone,
        contact_name: draft.contactName || undefined,
        contact_nid: draft.contactNid || undefined,
        contact_is_self: draft.contactSelf ? 1 : 0,
        division: draft.divisionName || undefined,
        district: draft.districtName || user?.district || undefined,
        upazila: draft.thanaName || user?.upazila || undefined,
        address_text: [draft.addressText, draft.thanaName, draft.districtName, draft.divisionName].filter(Boolean).join(', '),
        media_json: mediaUrls,
        ai_analysis_json: { source: 'mobile_app', category: 'inputs' },
        status: 'submitted',
      });
      onSubmitted({ listing_code: listingCode, id: response.result?.insertId, estimated_earning: qty * farmerRate });
      setScreen('cattleDone');
    } catch (error) {
      setSubmitError(naturalApiError(error, lang));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Header title={tx('মূল্য ও আয়ের বিবরণ', 'Price & Earning')} onBack={() => setScreen('inputsForm')} />
      <Card style={styles.weightCard}>
        <Text style={styles.weightIcon}>⚖</Text>
        <View style={styles.flex}>
          <Text style={styles.smallUpper}>{tx('পরিমাণ', 'Quantity')} ({unit})</Text>
          <View style={styles.weightInputRow}>
            <TextInput style={styles.weightInput} value={draft.weightKg} onChangeText={(v) => patchDraft({ weightKg: v })} keyboardType="number-pad" />
            <Text style={styles.kgText}>{unit}</Text>
          </View>
        </View>
        <View>
          <Text style={styles.miniMuted}>{tx('সম্ভাব্য আয়', 'Earning')}</Text>
          <Text style={styles.quickEarn}>{amount(qty * farmerRate, lang)}</Text>
        </View>
      </Card>

      <View style={styles.summaryChips}>
        <View style={styles.summaryChip}><Text style={styles.summaryChipText}>{draft.saleItemName || tx('উপকরণ', 'Input')}</Text></View>
        {district ? <View style={styles.summaryChip}><Text style={styles.summaryChipText}>⌖ {district}</Text></View> : null}
      </View>

      {quoteLoading ? <Text style={styles.fieldHint}>{tx('অনুমোদিত B2B দর আনা হচ্ছে...', 'Fetching approved B2B rate...')}</Text> : null}
      {!quoteLoading && !quote ? <Text style={styles.fieldHint}>{tx('এই উপকরণের জন্য অনুমোদিত দর নেই।', 'No approved rate for this input yet.')}</Text> : null}

      <View style={styles.priceTable}>
        <View style={styles.priceHead}>
          <Text style={styles.priceHeadTitle}>{tx('মূল্য বিবরণী', 'Price Breakdown')}</Text>
          <Text style={styles.priceHeadSub}>{tx(`সব মূল্য প্রতি ${unit} হিসেবে`, `All values per ${unit}`)}</Text>
        </View>
        <View style={styles.priceColumns}>
          <Text style={[styles.colLabel, styles.flex]}>{tx('বিবরণ', 'Item')}</Text>
          <Text style={styles.colLabel}>/{unit}</Text>
          <Text style={styles.colLabel}>{tx('মোট', 'Total')} ({num(qty, lang)})</Text>
        </View>
        {rows.map(([title, sub, rate, highlight]) => (
          <View key={title} style={[styles.priceRow, highlight && styles.priceRowHighlight]}>
            <View style={styles.flex}>
              <Text style={[styles.priceTitle, highlight && styles.priceTitleStrong]}>{title}</Text>
              {sub ? <Text style={styles.priceSub}>{sub}</Text> : null}
            </View>
            <Text style={styles.rateText}>৳{num(Math.abs(rate), lang)}</Text>
            <Text style={styles.totalText}>{amount(rate * qty, lang)}</Text>
          </View>
        ))}
        <View style={styles.finalRow}>
          <View style={styles.flex}>
            <Text style={styles.finalLabel}>{tx('আপনার আনুমানিক আয়', 'Your estimated earning')}</Text>
            <Text style={styles.finalSub}>৳{num(farmerRate, lang)} × {num(qty, lang)} {unit}</Text>
          </View>
          <Text style={styles.finalValue}>{amount(qty * farmerRate, lang)}</Text>
        </View>
      </View>
      <View style={styles.noteGold}>
        <Text style={styles.noteText}>{tx('মাঠ কর্মকর্তা গুণগত মান যাচাই করে নগদ বা চেকে পেমেন্ট করবেন।', 'Field officer verifies quality, then pays by cash or cheque.')}</Text>
      </View>
      {submitError ? <Text style={styles.apiNotice}>{submitError}</Text> : null}
      <AppButton title={submitting ? tx('জমা হচ্ছে...', 'Submitting...') : tx('তালিকা নিশ্চিত করুন ✓', 'Confirm listing ✓')} onPress={submitListing} disabled={submitting} />
      <AppButton title={tx('তথ্য পরিবর্তন করুন', 'Edit Details')} variant="outline" onPress={() => setScreen('inputsForm')} />
    </>
  );
}

function BuyCategories({ setScreen }: { setScreen: (screen: Screen) => void }) {
  const { tx, lang } = useLanguage();
  const categories = useApiList<ApiRow>('buy/categories');
  const categoryRows = shouldUseFallback(categories) ? fallbackBuyCategories : categories.rows;
  return (
    <>
      <Header title={tx('শাথী থেকে কিনুন', 'Buy from Shathi')} onBack={() => setScreen('home')} />
      <View style={styles.deliveryBanner}>
        <Text style={styles.deliveryText}>{tx('🚚 দ্রুত ডেলিভারি ১-৩ দিন · ৳৫০০+ অর্ডারে বিনামূল্যে', '🚚 Fast delivery 1-3 days · Free over ৳500')}</Text>
      </View>
      <SectionTitle title={tx('বিভাগ অনুযায়ী কিনুন', 'Shop by category')} warning={fallbackWarning(categories)} />
      {categories.loading ? <ApiStatus state={categories} empty={tx('কেনার কোনো বিভাগ পাওয়া যায়নি।', 'No buying categories are available.')} /> : null}
      <View style={styles.grid}>
        {categoryRows.map((category) => (
          <Tile key={category.id || category.slug} icon={String(category.slug || '').includes('mach') ? '🚜' : String(category.slug || '').includes('tool') ? '🔧' : String(category.slug || '').includes('medicine') ? '💊' : String(category.slug || '').includes('fertilizer') ? '🧪' : String(category.slug || '').includes('seed') ? '🌱' : '🌾'} title={rowTitle(category, lang, tx('বিভাগ', 'Category'))} subtitle={rowBody(category, lang, '')} onPress={() => setScreen('buyProducts')} />
        ))}
      </View>
    </>
  );
}

function BuyProducts({ setScreen, onSelectProduct }: { setScreen: (screen: Screen) => void; onSelectProduct: (product: ApiRow) => void }) {
  const { tx, lang } = useLanguage();
  const products = useApiList<ApiRow>('buy/products');
  const productRows = shouldUseFallback(products) ? fallbackBuyProducts : products.rows;
  return (
    <>
      <Header title={tx('শাধীন ফিড', 'Seeds')} onBack={() => setScreen('buyCategories')} />
      <View style={styles.segment}>
        <Text style={styles.segmentActive}>{tx('কিনুন', 'Buy')}</Text>
        <Text style={styles.segmentInactive}>{tx('বিক্রি করুন', 'Sell')}</Text>
      </View>
      <SectionTitle title={tx('পণ্য', 'Products')} warning={fallbackWarning(products)} />
      {products.loading ? <ApiStatus state={products} empty={tx('কোনো পণ্য পাওয়া যায়নি।', 'No products are available.')} /> : null}
      {productRows.map((product) => {
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
  const { user } = useAuth();
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
        user_id: Number(user?.id) || 1,
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
          <OrderFeature icon="✨" title={features[0] || tx('মানসম্মত', 'Quality')} sub={features[1] || tx('সার্ভার ডাটা', 'server data')} />
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

// ── Training module (gamified: categories > subcategories > content) ──────────

type LearnCat = { id: string; name: string; emoji?: string };
type LearnMod = { id: string; title: string; level: number };

async function learnFetch<T = any>(path: string): Promise<T> {
  const json = await apiRequest<{ data: T }>(path);
  return json.data;
}

async function summarizeMarkdown(text: string, lang: Lang): Promise<string> {
  const response = await requireGenAI().models.generateContent({
    model: GEMINI_TEXT_MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          {
            text: `Summarize the following farm training content ${lang === 'bn' ? 'in Bengali Bangla' : 'in English'} as concise Markdown: a one-line intro then up to 5 short bullet points of the key practical takeaways. Content:\n\n${text}`,
          },
        ],
      },
    ],
  });
  return response.text || '';
}

function useUid() {
  const { user } = useAuth();
  return Number(user?.id) || 1;
}

// Training home — points, level, next-up, preference-first categories + all.
// Learning sections (segmented training): order + bilingual headers.
const TRAIN_SECTIONS: Array<[string, [string, string]]> = [
  ['agriculture', ['কৃষি ও খামার', 'Farming & Agriculture']],
  ['climate', ['জলবায়ু ও সহনশীলতা', 'Climate & Resilience']],
  ['livelihood', ['দক্ষতা ও জীবিকা', 'Skills & Livelihood']],
  ['social', ['সমাজ ও কল্যাণ', 'Community & Wellbeing']],
];

function TrainingHome({ setScreen, openCategory }: { setScreen: (screen: Screen) => void; openCategory: (cat: LearnCat) => void }) {
  const { tx, lang } = useLanguage();
  const uid = useUid();
  const tick = useRefreshTick();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    learnFetch(`app/learning/overview?user_id=${uid}`)
      .then((d) => { if (alive) setData(d); })
      .catch(() => undefined)
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [uid, tick]);

  const cats: any[] = data?.categories ?? [];
  const points = Number(data?.points ?? 0);
  const level = Number(data?.level ?? 1);
  const next = data?.next;

  return (
    <>
      <Header title={tx('প্রশিক্ষণ', 'Training')} onBack={() => setScreen('home')} />
      <View style={styles.trainPointsCard}>
        <View style={styles.trainPointsCol}>
          <Text style={styles.trainPointsValue}>{num(points, lang)}</Text>
          <Text style={styles.trainPointsLabel}>{tx('পয়েন্ট', 'Points')}</Text>
        </View>
        <View style={styles.trainPointsDivider} />
        <View style={styles.trainPointsCol}>
          <Text style={styles.trainPointsValue}>{tx('স্তর', 'Lv')} {num(level, lang)}</Text>
          <Text style={styles.trainPointsLabel}>{tx('লেভেল', 'Level')}</Text>
        </View>
        <View style={styles.trainPointsDivider} />
        <View style={styles.trainPointsCol}>
          <Text style={styles.trainPointsValue}>{num(Number(data?.completed_content ?? 0), lang)}/{num(Number(data?.total_content ?? 0), lang)}</Text>
          <Text style={styles.trainPointsLabel}>{tx('সম্পন্ন', 'Done')}</Text>
        </View>
      </View>

      {next ? (
        <Pressable
          style={({ pressed }) => [styles.trainContinue, pressed && styles.pressed]}
          onPress={() => openCategory({ id: String(next.category_id), name: String(next.category_name || ''), emoji: '📘' })}
        >
          <Ionicons name={next.content_type === 'video' ? 'play-circle' : 'document-text'} size={30} color="#FFFFFF" />
          <View style={styles.flex}>
            <Text style={styles.trainContinueLabel}>{tx('পরবর্তী কনটেন্ট', 'Continue learning')}</Text>
            <Text style={styles.trainContinueTitle}>{rowTitle(next, lang, '')}</Text>
            <Text style={styles.trainContinueSub}>{String(next.category_name || '')} · {String(next.module_title || '')}</Text>
          </View>
          <Ionicons name="chevron-forward" size={22} color="#FFFFFF" />
        </Pressable>
      ) : null}

      {loading ? <ActivityIndicator color={colors.maroon} style={{ marginVertical: 18 }} /> : null}

      {cats.some((c) => c.preferred) ? (
        <>
          <SectionTitle title={tx('আপনার পছন্দ অনুযায়ী', 'For your preferences')} />
          <View style={styles.trainCatGrid}>
            {cats.filter((c) => c.preferred).map((c) => (
              <TrainCatCard key={c.id} cat={c} highlighted onPress={() => openCategory({ id: String(c.id), name: rowTitle(c, lang, ''), emoji: c.emoji })} />
            ))}
          </View>
        </>
      ) : null}

      {TRAIN_SECTIONS.map(([key, label]) => {
        const list = cats.filter((c) => String(c.section || 'agriculture') === key);
        if (!list.length) return null;
        return (
          <View key={key}>
            <SectionTitle title={tx(label[0], label[1])} />
            <View style={styles.trainCatGrid}>
              {list.map((c) => (
                <TrainCatCard key={`sec-${c.id}`} cat={c} onPress={() => openCategory({ id: String(c.id), name: rowTitle(c, lang, ''), emoji: c.emoji })} />
              ))}
            </View>
          </View>
        );
      })}
      {!loading && cats.length === 0 ? <Text style={styles.apiNotice}>{tx('এখন কোনো প্রশিক্ষণ বিষয় নেই।', 'No training categories yet.')}</Text> : null}
    </>
  );
}

function TrainCatCard({ cat, onPress, highlighted }: { cat: any; onPress: () => void; highlighted?: boolean }) {
  const { tx, lang } = useLanguage();
  const total = Number(cat.content_count ?? 0);
  const done = Number(cat.completed_count ?? 0);
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.trainCatCard, highlighted && styles.trainCatCardHi, pressed && styles.pressed]}>
      <Text style={styles.trainCatEmoji}>{cat.emoji || '📚'}</Text>
      <Text style={styles.trainCatTitle}>{rowTitle(cat, lang, tx('বিষয়', 'Topic'))}</Text>
      <Text style={styles.trainCatMeta}>{num(Number(cat.module_count ?? 0), lang)} {tx('উপ-বিষয়', 'sub-topics')} · {num(total, lang)} {tx('কনটেন্ট', 'items')}</Text>
      <View style={styles.trainProgressTrack}><View style={[styles.trainProgressFill, { width: `${pct}%` }]} /></View>
      <Text style={styles.trainCatMeta}>{num(done, lang)}/{num(total, lang)} {tx('সম্পন্ন', 'done')}</Text>
    </Pressable>
  );
}

// Category → subcategory (modules with level).
function TrainingCategory({ category, setScreen, openModule }: { category: LearnCat | null; setScreen: (screen: Screen) => void; openModule: (mod: LearnMod) => void }) {
  const { tx, lang } = useLanguage();
  const uid = useUid();
  const tick = useRefreshTick();
  const [mods, setMods] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!category) return;
    let alive = true;
    setLoading(true);
    learnFetch<any[]>(`app/learning/modules?category_id=${category.id}&user_id=${uid}`)
      .then((d) => { if (alive) setMods(d ?? []); })
      .catch(() => undefined)
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [category?.id, uid, tick]);

  return (
    <>
      <Header title={category?.name || tx('বিষয়', 'Category')} onBack={() => setScreen('training')} />
      <Text style={styles.pageHint}>{tx('একটি উপ-বিষয় বেছে নিন। লেভেল অনুযায়ী সাজানো।', 'Pick a sub-topic. Ordered by level.')}</Text>
      {loading ? <ActivityIndicator color={colors.maroon} style={{ marginVertical: 18 }} /> : null}
      <View style={styles.subList}>
        {mods.map((m) => {
          const total = Number(m.content_count ?? 0);
          const done = Number(m.completed_count ?? 0);
          const complete = total > 0 && done >= total;
          return (
            <Pressable key={m.id} onPress={() => openModule({ id: String(m.id), title: rowTitle(m, lang, ''), level: Number(m.level ?? 1) })} style={({ pressed }) => [styles.subCard, pressed && styles.pressed]}>
              <View style={styles.subEmojiWrap}><Text style={styles.subEmoji}>{m.emoji || '📘'}</Text></View>
              <View style={styles.flex}>
                <View style={styles.subTitleRow}>
                  <Text style={styles.subTitle}>{rowTitle(m, lang, tx('উপ-বিষয়', 'Sub-topic'))}</Text>
                  <View style={styles.levelChip}><Text style={styles.levelChipText}>{tx('লেভেল', 'Lv')} {num(Number(m.level ?? 1), lang)}</Text></View>
                </View>
                <Text style={styles.subSub}>{localized(m, lang, 'subtitle', '')}</Text>
                <Text style={styles.subMeta}>{num(done, lang)}/{num(total, lang)} {tx('সম্পন্ন', 'done')} · {num(Number(m.total_points ?? 0), lang)} {tx('পয়েন্ট', 'pts')}</Text>
              </View>
              {complete ? <Ionicons name="checkmark-circle" size={22} color={colors.green} /> : <Ionicons name="chevron-forward" size={20} color={colors.muted} />}
            </Pressable>
          );
        })}
      </View>
      {!loading && mods.length === 0 ? <Text style={styles.apiNotice}>{tx('এই বিষয়ে কনটেন্ট নেই।', 'No content in this category yet.')}</Text> : null}
    </>
  );
}

// Subcategory → content cards (articles + videos in sections).
function TrainingModuleScreen({ module, setScreen, openContent }: { module: LearnMod | null; setScreen: (screen: Screen) => void; openContent: (id: string, type: 'article' | 'video') => void }) {
  const { tx, lang } = useLanguage();
  const uid = useUid();
  const tick = useRefreshTick();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!module) return;
    let alive = true;
    setLoading(true);
    learnFetch<any[]>(`app/learning/contents?module_id=${module.id}&user_id=${uid}`)
      .then((d) => { if (alive) setItems(d ?? []); })
      .catch(() => undefined)
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [module?.id, uid, tick]);

  const articles = items.filter((i) => i.content_type === 'article');
  const videos = items.filter((i) => i.content_type === 'video');

  const renderCard = (c: any) => (
    <Pressable key={c.id} onPress={() => openContent(String(c.id), c.content_type === 'video' ? 'video' : 'article')} style={({ pressed }) => [styles.contentCard, pressed && styles.pressed]}>
      {c.image_url ? <Image source={{ uri: String(c.image_url) }} style={styles.contentThumb} /> : <View style={[styles.contentThumb, styles.contentThumbFallback]}><Ionicons name={c.content_type === 'video' ? 'videocam' : 'document-text'} size={26} color={colors.maroon} /></View>}
      <View style={styles.flex}>
        <Text style={styles.contentTitle}>{rowTitle(c, lang, '')}</Text>
        {c.excerpt ? <Text style={styles.contentExcerpt} numberOfLines={2}>{String(c.excerpt).replace(/[#*]/g, '')}</Text> : null}
        <View style={styles.contentMetaRow}>
          <View style={styles.pointPill}><Ionicons name="star" size={11} color={colors.gold} /><Text style={styles.pointPillText}>{num(Number(c.points ?? 0), lang)}</Text></View>
          {c.has_quiz ? <View style={styles.quizPill}><Text style={styles.quizPillText}>{tx('কুইজ', 'Quiz')}</Text></View> : null}
          {c.completed ? <View style={styles.donePill}><Ionicons name="checkmark" size={11} color="#FFFFFF" /><Text style={styles.donePillText}>{tx('সম্পন্ন', 'Done')}</Text></View> : null}
        </View>
      </View>
    </Pressable>
  );

  return (
    <>
      <Header title={module?.title || tx('উপ-বিষয়', 'Sub-topic')} onBack={() => setScreen('trainingCategory')} />
      {loading ? <ActivityIndicator color={colors.maroon} style={{ marginVertical: 18 }} /> : null}
      {articles.length ? (
        <>
          <SectionTitle title={tx('আর্টিকেল', 'Articles')} />
          <View style={styles.contentList}>{articles.map(renderCard)}</View>
        </>
      ) : null}
      {videos.length ? (
        <>
          <SectionTitle title={tx('ভিডিও', 'Videos')} />
          <View style={styles.contentList}>{videos.map(renderCard)}</View>
        </>
      ) : null}
      {!loading && items.length === 0 ? <Text style={styles.apiNotice}>{tx('এখানে কনটেন্ট নেই।', 'No content here yet.')}</Text> : null}
    </>
  );
}

// Article reader → Finished → quiz (or complete if no quiz).
function TrainingArticle({ contentId, setScreen, openQuiz }: { contentId: string | null; setScreen: (screen: Screen) => void; openQuiz: (id: string) => void }) {
  const { tx, lang } = useLanguage();
  const uid = useUid();
  const [content, setContent] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!contentId) return;
    learnFetch(`app/learning/content?content_id=${contentId}&user_id=${uid}`).then(setContent).catch(() => undefined);
  }, [contentId, uid]);

  async function onFinish() {
    if (!content) return;
    if (content.has_quiz) { openQuiz(String(content.id)); return; }
    setBusy(true);
    try {
      await apiRequest('app/learning/progress', { method: 'POST', body: JSON.stringify({ user_id: uid, content_id: content.id, progress_pct: 100 }) });
      refreshStore.trigger();
    } catch { /* ignore */ } finally { setBusy(false); setScreen('trainingModule'); }
  }

  const body = localized(content, lang, 'body', '') || (content?.body_en ?? '');
  return (
    <>
      <Header title={tx('আর্টিকেল', 'Article')} onBack={() => setScreen('trainingModule')} />
      {content?.image_url ? <Image source={{ uri: String(content.image_url) }} style={styles.readerImage} /> : null}
      <View style={styles.readerBody}>
        <Text style={styles.readerKicker}>{String(content?.module_title || '')}</Text>
        <Text style={styles.readerTitle}>{rowTitle(content || undefined, lang, '')}</Text>
        <View style={styles.pointPillRow}>
          <View style={styles.pointPill}><Ionicons name="star" size={12} color={colors.gold} /><Text style={styles.pointPillText}>{num(Number(content?.points ?? 0), lang)} {tx('পয়েন্ট', 'pts')}</Text></View>
          {content?.status === 'completed' ? <View style={styles.donePill}><Ionicons name="checkmark" size={12} color="#FFFFFF" /><Text style={styles.donePillText}>{tx('সম্পন্ন', 'Completed')}</Text></View> : null}
        </View>
        {content ? <MarkdownText text={body || tx('কনটেন্ট নেই।', 'No content.')} style={styles.readerText} strongStyle={styles.readerStrong} /> : <ActivityIndicator color={colors.maroon} />}
      </View>
      {content ? (
        <AppButton
          title={content.has_quiz ? tx('শেষ করেছি — কুইজ দিন', 'Finished — take quiz') : (busy ? tx('সংরক্ষণ হচ্ছে...', 'Saving...') : tx('সম্পন্ন হিসেবে চিহ্নিত করুন', 'Mark as complete'))}
          onPress={onFinish}
        />
      ) : null}
    </>
  );
}

// Video player (YouTube) with 90% completion + AI summary + audio read.
function TrainingVideoScreen({ contentId, setScreen }: { contentId: string | null; setScreen: (screen: Screen) => void }) {
  const { tx, lang } = useLanguage();
  const uid = useUid();
  const [content, setContent] = useState<any>(null);
  const [playing, setPlaying] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [summary, setSummary] = useState('');
  const [summarizing, setSummarizing] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const playerRef = useRef<any>(null);
  const reportedRef = useRef(false);

  useEffect(() => {
    if (!contentId) return;
    learnFetch(`app/learning/content?content_id=${contentId}&user_id=${uid}`).then((c) => {
      setContent(c);
      if (c?.status === 'completed') { setCompleted(true); reportedRef.current = true; }
    }).catch(() => undefined);
    return () => { stopAiSpeech().catch(() => undefined); };
  }, [contentId, uid]);

  const duration = Number(content?.duration_seconds) || 0;

  const reportComplete = useCallback(async (pct: number) => {
    if (reportedRef.current) return;
    reportedRef.current = true;
    try {
      const res: any = await apiRequest('app/learning/progress', { method: 'POST', body: JSON.stringify({ user_id: uid, content_id: contentId, progress_pct: pct }) });
      if (res?.result?.completed) { setCompleted(true); refreshStore.trigger(); }
    } catch { reportedRef.current = false; }
  }, [uid, contentId]);

  const onChangeState = useCallback((state: string) => {
    setPlaying(state === 'playing');
    if (state === 'ended') reportComplete(100);
  }, [reportComplete]);

  useEffect(() => {
    if (!playing || completed) return;
    const timer = setInterval(async () => {
      try {
        const cur: number = (await playerRef.current?.getCurrentTime?.()) ?? 0;
        let dur = duration;
        if (!dur && playerRef.current?.getDuration) dur = await playerRef.current.getDuration();
        if (dur > 0 && cur / dur >= 0.9) reportComplete(Math.round((cur / dur) * 100));
      } catch { /* ignore */ }
    }, 3000);
    return () => clearInterval(timer);
  }, [playing, completed, duration, reportComplete]);

  async function onSummarize() {
    if (!content) return;
    setSummarizing(true);
    try {
      const text = `${rowTitle(content, lang, '')}. ${localized(content, lang, 'body', '') || content.body_en || ''}`;
      setSummary(await summarizeMarkdown(text, lang));
    } catch { setSummary(tx('সারাংশ তৈরি করা যায়নি।', 'Could not generate a summary.')); } finally { setSummarizing(false); }
  }

  function toggleRead() {
    if (speaking) { stopAiSpeech().finally(() => setSpeaking(false)); return; }
    playAiSpeech(summary, lang, () => setSpeaking(true), () => setSpeaking(false)).catch(() => setSpeaking(false));
  }

  return (
    <>
      <Header title={tx('ভিডিও', 'Video')} onBack={() => { stopAiSpeech().catch(() => undefined); setScreen('trainingModule'); }} />
      <View style={styles.videoFrame}>
        {content?.youtube_id ? (
          <YoutubePlayer ref={playerRef} height={210} play={false} videoId={String(content.youtube_id)} onChangeState={onChangeState} />
        ) : (
          <View style={styles.videoFallback}><Text style={styles.apiNotice}>{tx('ভিডিও লিংক সঠিক নয়।', 'Video link is not valid.')}</Text></View>
        )}
      </View>
      <View style={styles.readerBody}>
        <Text style={styles.readerKicker}>{String(content?.module_title || '')}</Text>
        <Text style={styles.readerTitle}>{rowTitle(content || undefined, lang, '')}</Text>
        <View style={styles.pointPillRow}>
          <View style={styles.pointPill}><Ionicons name="star" size={12} color={colors.gold} /><Text style={styles.pointPillText}>{num(Number(content?.points ?? 0), lang)} {tx('পয়েন্ট', 'pts')}</Text></View>
          {completed ? <View style={styles.donePill}><Ionicons name="checkmark" size={12} color="#FFFFFF" /><Text style={styles.donePillText}>{tx('সম্পন্ন', 'Completed')}</Text></View> : <Text style={styles.videoHint}>{tx('৯০% দেখলে সম্পন্ন হবে', 'Completes at 90% watched')}</Text>}
        </View>
        {content?.body_en ? <Text style={styles.readerText}>{localized(content, lang, 'body', '') || content.body_en}</Text> : null}

        <Pressable onPress={onSummarize} disabled={summarizing} style={({ pressed }) => [styles.aiSummaryBtn, pressed && styles.pressed]}>
          <Ionicons name="sparkles" size={16} color={colors.maroon} />
          <Text style={styles.aiSummaryBtnText}>{summarizing ? tx('সারাংশ তৈরি হচ্ছে...', 'Generating summary...') : tx('AI সারাংশ', 'AI summary')}</Text>
        </Pressable>

        {summary ? (
          <View style={styles.aiSummaryBlock}>
            <View style={styles.aiSummaryHead}>
              <Text style={styles.aiSummaryTitle}>{tx('সারাংশ', 'Summary')}</Text>
              <Pressable onPress={toggleRead} hitSlop={8} style={styles.aiReadBtn}>
                <Ionicons name={speaking ? 'stop-circle' : 'volume-high'} size={20} color={colors.maroon} />
              </Pressable>
            </View>
            <MarkdownText text={summary} style={styles.readerText} strongStyle={styles.readerStrong} />
          </View>
        ) : null}
      </View>
      {content ? <AppButton title={tx('শেষ', 'Done')} onPress={() => { stopAiSpeech().catch(() => undefined); setScreen('trainingModule'); }} /> : null}
    </>
  );
}

// Quiz — 80% to pass and complete the article.
function TrainingQuiz({ contentId, setScreen }: { contentId: string | null; setScreen: (screen: Screen) => void }) {
  const { tx, lang } = useLanguage();
  const uid = useUid();
  const [content, setContent] = useState<any>(null);
  const [answers, setAnswers] = useState<number[]>([]);
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!contentId) return;
    learnFetch(`app/learning/content?content_id=${contentId}&user_id=${uid}`).then((c) => {
      setContent(c);
      setAnswers(new Array((c?.quiz ?? []).length).fill(-1));
    }).catch(() => undefined);
  }, [contentId, uid]);

  const quiz: any[] = content?.quiz ?? [];
  const allAnswered = quiz.length > 0 && answers.every((a) => a >= 0);

  async function submit() {
    setBusy(true);
    try {
      const res: any = await apiRequest('app/learning/submit-quiz', { method: 'POST', body: JSON.stringify({ user_id: uid, content_id: contentId, answers }) });
      setResult(res.result);
      if (res.result?.passed) refreshStore.trigger();
    } catch { /* ignore */ } finally { setBusy(false); }
  }

  if (result) {
    const passed = result.passed;
    return (
      <>
        <Header title={tx('কুইজ ফলাফল', 'Quiz result')} onBack={() => setScreen('trainingModule')} />
        <View style={styles.quizResult}>
          <View style={[styles.quizResultIcon, { backgroundColor: passed ? colors.green : colors.gold }]}>
            <Ionicons name={passed ? 'trophy' : 'refresh'} size={40} color="#FFFFFF" />
          </View>
          <Text style={styles.quizResultScore}>{num(Number(result.score ?? 0), lang)}%</Text>
          <Text style={styles.quizResultText}>{passed ? tx('অভিনন্দন! আপনি পাস করেছেন।', 'Congrats! You passed.') : tx('৮০% দরকার। আবার চেষ্টা করুন।', 'You need 80%. Try again.')}</Text>
          <Text style={styles.quizResultSub}>{num(Number(result.correct ?? 0), lang)}/{num(Number(result.total ?? 0), lang)} {tx('সঠিক', 'correct')}{passed ? ` · +${num(Number(result.points_awarded ?? 0), lang)} ${tx('পয়েন্ট', 'pts')}` : ''}</Text>
          {passed ? (
            <AppButton title={tx('সম্পন্ন', 'Done')} onPress={() => setScreen('trainingModule')} />
          ) : (
            <AppButton title={tx('আবার চেষ্টা করুন', 'Try again')} onPress={() => { setResult(null); setAnswers(new Array(quiz.length).fill(-1)); }} />
          )}
        </View>
      </>
    );
  }

  return (
    <>
      <Header title={tx('কুইজ', 'Quiz')} onBack={() => setScreen('trainingArticle')} />
      <Text style={styles.pageHint}>{tx('৮০% সঠিক হলে আর্টিকেল সম্পন্ন হবে।', 'Score 80% to complete the article.')}</Text>
      {quiz.map((q, qi) => (
        <View key={qi} style={styles.quizCard}>
          <Text style={styles.quizQuestion}>{num(qi + 1, lang)}. {q.q}</Text>
          {q.options.map((opt: string, oi: number) => {
            const selected = answers[qi] === oi;
            return (
              <Pressable key={oi} onPress={() => setAnswers((prev) => prev.map((a, idx) => (idx === qi ? oi : a)))} style={[styles.quizOption, selected && styles.quizOptionSel]}>
                <View style={[styles.quizRadio, selected && styles.quizRadioSel]}>{selected ? <Ionicons name="checkmark" size={13} color="#FFFFFF" /> : null}</View>
                <Text style={[styles.quizOptionText, selected && styles.quizOptionTextSel]}>{opt}</Text>
              </Pressable>
            );
          })}
        </View>
      ))}
      {quiz.length ? <AppButton title={busy ? tx('জমা হচ্ছে...', 'Submitting...') : tx('জমা দিন', 'Submit')} onPress={submit} disabled={!allAnswered || busy} /> : <Text style={styles.apiNotice}>{tx('এই কনটেন্টে কুইজ নেই।', 'This content has no quiz.')}</Text>}
    </>
  );
}

function PartnerRegister({ setScreen }: { setScreen: (screen: Screen) => void }) {
  const { tx, lang } = useLanguage();
  const projects = useApiList<ApiRow>('partners/projects');
  const projectRows = shouldUseFallback(projects) ? fallbackPartnerProjects : projects.rows;
  return (
    <>
      <Header title={tx('শাথী পার্টনার নিবন্ধন', 'Shathi Partner Registration')} onBack={() => setScreen('home')} />
      <SectionTitle title={tx('সক্রিয় প্রকল্পসমূহ', 'Active Projects')} warning={fallbackWarning(projects)} />
      {projects.loading ? <ApiStatus state={projects} empty={tx('এখন কোনো পার্টনার প্রকল্প নেই।', 'No partner projects are available right now.')} /> : null}
      {projectRows.map((project) => (
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

function Kyc({ setScreen, projectId, onSubmitted }: { setScreen: (screen: Screen) => void; projectId?: string | null; onSubmitted: (application: ApiRow) => void }) {
  const { tx, lang } = useLanguage();
  const { user } = useAuth();
  const projects = useApiList<ApiRow>('partners/projects');
  const project = (projectId && projects.rows.find((row) => String(row.id) === String(projectId)))
    || projects.rows.find((row) => row.status === 'open') || projects.rows[0];

  const verified = Boolean(user?.is_kyc_verified);
  const profileName = user?.full_name && user.full_name !== 'Shathi user' ? user.full_name : '';
  const initialDob = user?.date_of_birth ? String(user.date_of_birth).slice(0, 10).split('-') : [];

  const [fullName, setFullName] = useState(profileName);
  const [nid, setNid] = useState(user?.nid_number ?? '');
  const [gender, setGender] = useState(user?.gender ?? '');
  const [dobYear, setDobYear] = useState(initialDob[0] || '');
  const [dobMonth, setDobMonth] = useState(initialDob[1] || '');
  const [dobDay, setDobDay] = useState(initialDob[2] || '');
  const [land, setLand] = useState('');
  const [livestock, setLivestock] = useState('');
  const [income, setIncome] = useState('');
  const [incomeSource, setIncomeSource] = useState('');
  const [mfs, setMfs] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const genders: Array<{ key: string; label: string }> = [
    { key: 'male', label: tx('পুরুষ', 'Male') },
    { key: 'female', label: tx('নারী', 'Female') },
    { key: 'other', label: tx('অন্যান্য', 'Other') },
  ];
  const incomeSources = [tx('গবাদিপশু', 'Livestock'), tx('ফসল', 'Crops'), tx('মৎস্য', 'Fishery'), tx('ব্যবসা', 'Business'), tx('চাকরি', 'Service'), tx('অন্যান্য', 'Other')];
  const mfsOptions = [tx('বিকাশ', 'bKash'), tx('নগদ', 'Nagad'), tx('রকেট', 'Rocket'), tx('উপায়', 'Upay'), tx('নেই', 'None')];
  // When the profile is verified, identity fields are locked to the verified data.
  const lockIdentity = verified && Boolean(profileName) && Boolean(user?.gender);

  async function submitKyc() {
    if (!fullName.trim()) { setSubmitError(tx('NID অনুযায়ী পূর্ণ নাম দিন।', 'Enter your full name as per NID.')); return; }
    if (!nid.trim()) { setSubmitError(tx('জাতীয় পরিচয়পত্র নম্বর দিন।', 'Enter your NID number.')); return; }
    if (!gender) { setSubmitError(tx('লিঙ্গ নির্বাচন করুন।', 'Select your gender.')); return; }
    setSubmitting(true);
    setSubmitError('');
    try {
      const response = await apiCreate('app/kyc/submit', {
        user_id: Number(user?.id) || 1,
        partner_project_id: Number(project?.id || 1),
        full_name_per_nid: fullName.trim(),
        nid_number: nid.trim(),
        date_of_birth: dobYear && dobMonth && dobDay ? `${dobYear}-${dobMonth}-${dobDay}` : null,
        total_land_decimals: Number(land) || 0,
        livestock_count: Number(livestock) || 0,
        primary_income_source: incomeSource || undefined,
        annual_household_income: Number(income) || 0,
        mobile_banking_provider: mfs || undefined,
      });
      const result = (response.result ?? {}) as { application_code?: string; application_id?: number };
      onSubmitted({ application_code: result.application_code, id: result.application_id });
      setScreen('regDone');
    } catch (error) {
      setSubmitError(naturalApiError(error, lang));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Header title={tx('KYC যাচাই', 'KYC Verification')} onBack={() => setScreen('projects')} right={tx('ধাপ ২/৫', 'Step 2/5')} />
      {project ? (
        <View style={styles.kycProjectBar}>
          <Text style={styles.kycProjectLabel}>{tx('প্রকল্প', 'Project')}</Text>
          <Text style={styles.kycProjectName} numberOfLines={1}>{rowTitle(project, lang, tx('প্রকল্প', 'Project'))}</Text>
        </View>
      ) : null}

      <View style={styles.formCard}>
        <Text style={styles.formCardTitle}>{tx('পরিচয় তথ্য', 'Identity details')}</Text>
        {lockIdentity ? (
          <View style={styles.verifiedBanner}>
            <Text style={styles.verifiedBannerText}>✓ {tx('আপনার প্রোফাইল যাচাইকৃত — নাম ও লিঙ্গ স্বয়ংক্রিয়ভাবে পূরণ হয়েছে।', 'Your profile is verified — name and gender are filled automatically.')}</Text>
          </View>
        ) : null}

        <FormLabel small required label={tx('পূর্ণ নাম (NID অনুযায়ী)', 'Full name (per NID)')} />
        <TextInput style={[styles.inputSm, lockIdentity && styles.inputLocked]} editable={!lockIdentity} value={fullName} onChangeText={setFullName} placeholder={tx('আপনার পূর্ণ নাম', 'Your full name')} placeholderTextColor={colors.muted} />

        <FormLabel small required label={tx('জাতীয় পরিচয়পত্র নম্বর', 'NID number')} />
        <TextInput style={styles.inputSm} value={nid} onChangeText={setNid} placeholder={tx('১০ বা ১৭ সংখ্যা', '10 or 17 digits')} placeholderTextColor={colors.muted} keyboardType="number-pad" />

        <FormLabel small label={tx('জন্ম তারিখ', 'Date of birth')} />
        <View style={styles.dobRow}>
          <DropdownField value={dobDay} placeholder={tx('দিন', 'Day')} onSelect={lockIdentity ? () => {} : setDobDay} options={Array.from({ length: 31 }, (_, i) => { const v = String(i + 1).padStart(2, '0'); return { value: v, label: num(i + 1, lang) }; })} />
          <DropdownField value={dobMonth} placeholder={tx('মাস', 'Month')} flexBasis={1.3} onSelect={lockIdentity ? () => {} : setDobMonth} options={MONTHS_EN.map((_, i) => { const v = String(i + 1).padStart(2, '0'); return { value: v, label: lang === 'bn' ? MONTHS_BN[i] : MONTHS_EN[i] }; })} />
          <DropdownField value={dobYear} placeholder={tx('সাল', 'Year')} flexBasis={1.2} onSelect={lockIdentity ? () => {} : setDobYear} options={Array.from({ length: 75 }, (_, i) => { const y = new Date().getFullYear() - 10 - i; return { value: String(y), label: num(y, lang) }; })} />
        </View>

        <FormLabel small required label={tx('লিঙ্গ', 'Gender')} />
        <View style={styles.genderRow}>
          {genders.map((g) => (
            <Pressable key={g.key} disabled={lockIdentity} style={[styles.genderPillSm, gender === g.key && styles.genderPillActive, lockIdentity && gender !== g.key && styles.inputLocked]} onPress={() => setGender(g.key)}>
              <Text style={[styles.genderPillText, gender === g.key && styles.genderPillTextActive]}>{g.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.formCard}>
        <Text style={styles.formCardTitle}>{tx('খামার ও আয়', 'Farm & income')}</Text>
        <View style={styles.twoCol}>
          <View style={styles.flex}>
            <FormLabel small label={tx('মোট জমি (শতক)', 'Total land (decimals)')} />
            <TextInput style={styles.inputSm} value={land} onChangeText={setLand} keyboardType="number-pad" placeholder={tx('যেমন ১২০', 'e.g. 120')} placeholderTextColor={colors.muted} />
          </View>
          <View style={styles.flex}>
            <FormLabel small label={tx('পশুর সংখ্যা', 'Livestock count')} />
            <Stepper value={livestock} onChange={setLivestock} min={0} compact />
          </View>
        </View>
        <FormLabel small label={tx('প্রধান আয়ের উৎস', 'Primary income source')} />
        <FakeSelect value={incomeSource || tx('নির্বাচন করুন', 'Select')} options={incomeSources} onChange={setIncomeSource} />
        <FormLabel small label={tx('বার্ষিক পারিবারিক আয় (৳)', 'Annual household income (৳)')} />
        <TextInput style={styles.inputSm} value={income} onChangeText={setIncome} keyboardType="number-pad" placeholder={tx('যেমন ১২০০০০', 'e.g. 120000')} placeholderTextColor={colors.muted} />
        <FormLabel small label={tx('মোবাইল ব্যাংকিং', 'Mobile banking')} />
        <FakeSelect value={mfs || tx('নির্বাচন করুন', 'Select')} options={mfsOptions} onChange={setMfs} />
      </View>

      <Text style={styles.fieldHint}>{tx('মাঠ কর্মকর্তা তথ্য যাচাই করে অনুমোদন করবেন। যাচাইকৃত KYC ছাড়া প্রকল্প সক্রিয় হবে না।', 'A field officer verifies your details before approval. Projects activate only after KYC is approved.')}</Text>
      {submitError ? <Text style={styles.apiNotice}>{submitError}</Text> : null}
      <AppButton title={submitting ? tx('জমা হচ্ছে...', 'Submitting...') : tx('আবেদন জমা দিন', 'Submit application')} onPress={submitKyc} disabled={submitting} />
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
  const { user } = useAuth();
  const district = user?.district ? `?district=${encodeURIComponent(user.district)}` : '';
  const posts = useApiList<ApiRow>('community/posts');
  const officers = useApiList<ApiRow>(`community/officers${district}`);
  const marketUpdates = useApiList<ApiRow>(`app/market-updates${district}`);
  const [postDraft, setPostDraft] = useState('');
  const [postImage, setPostImage] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [postError, setPostError] = useState('');
  const [localPosts, setLocalPosts] = useState<ApiRow[]>([]);
  const officerRows = shouldUseFallback(officers) ? fallbackOfficers : officers.rows;
  const postRows = shouldUseFallback(posts) && !localPosts.length ? fallbackCommunityPosts : posts.rows;
  // Top market updates surface in the feed as highlighted official Shathi Sheba cards.
  const highlightUpdates = (shouldUseFallback(marketUpdates) ? [] : marketUpdates.rows).slice(0, 2);

  async function pickPostImage() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 });
    if (!result.canceled) setPostImage(result.assets[0].uri);
  }

  async function submitPost() {
    const body = postDraft.trim();
    if (!body && !postImage) return;
    setPosting(true);
    setPostError('');
    try {
      let imageUrl: string | undefined;
      if (postImage) imageUrl = await uploadImage(postImage, 'community');
      await apiCreate('community/posts', {
        user_id: Number(user?.id) || 1,
        scope: 'upazila',
        post_type: 'general',
        body,
        image_url: imageUrl,
        district: user?.district || 'Mymensingh',
        upazila: user?.upazila || 'Mymensingh Sadar',
        status: 'visible',
      });
      setLocalPosts((current) => [{ farmer_name: user?.display_name || user?.full_name, body, image_url: imageUrl, post_type: 'general', like_count: 0, comment_count: 0, created_at: new Date().toISOString() }, ...current]);
      setPostDraft('');
      setPostImage(null);
    } catch (error) {
      setPostError(naturalApiError(error, lang));
    } finally {
      setPosting(false);
    }
  }
  const visiblePosts = [...localPosts, ...postRows];
  return (
    <>
      <BrandHeader setScreen={setScreen} />
      <View style={styles.communityHero}>
        <View style={styles.communityHeroIcon}>
          <Ionicons name="people" size={24} color="#FFFFFF" />
        </View>
        <View style={styles.flex}>
          <Text style={styles.communityHeroTitle}>{tx('কমিউনিটি', 'Community')}</Text>
          <Text style={styles.communityHeroSub}>{tx('প্রশ্ন করুন, অভিজ্ঞতা ভাগ করুন', 'Ask questions, share your experience')}</Text>
        </View>
      </View>
      <View style={styles.filterRow}>
        {[tx('আমার উপজেলা', 'My Upazila'), tx('জেলা', 'District'), tx('বাংলাদেশ', 'Bangladesh')].map((filter, index) => (
          <View key={filter} style={[styles.filter, index === 0 && styles.filterActive]}>
            <Text style={[styles.filterText, index === 0 && styles.filterTextActive]}>{filter}</Text>
          </View>
        ))}
      </View>
      <SectionTitle title={tx('উপজেলা কর্মকর্তা', 'Upazila Officers')} right={tx('সব দেখুন', 'See all')} onRightPress={() => setScreen('officers')} />
      <Card>
        {officerRows.slice(0, 2).map((officer, index) => (
          <Officer key={String(officer.id ?? index)} name={String(officer.name || officer.full_name || tx('কর্মকর্তা', 'Officer'))} role={[tEnum(officer.role || officer.officer_role, lang), officer.district, officer.upazila].filter(Boolean).join(' · ')} phone={officer.phone ? String(officer.phone) : undefined} />
        ))}
        {officers.loading ? <Text style={styles.apiNotice}>{tx('কর্মকর্তার তথ্য আনা হচ্ছে...', 'Loading officer data...')}</Text> : null}
      </Card>
      <View style={styles.postBox}>
        <View style={styles.postAvatar}>
          <Text style={styles.postAvatarText}>{(user?.display_name || user?.full_name || 'S').slice(0, 1).toUpperCase()}</Text>
        </View>
        <TextInput style={styles.postInput} value={postDraft} onChangeText={setPostDraft} placeholder={tx('কিছু লিখুন...', 'Write something...')} placeholderTextColor={colors.muted} multiline />
        <Pressable onPress={pickPostImage} hitSlop={8} style={styles.postIconBtn}><Ionicons name="image-outline" size={22} color={colors.maroon} /></Pressable>
        <Pressable onPress={submitPost} disabled={posting} style={styles.postSubmitBtn}>
          <Text style={styles.postSubmitText}>{posting ? tx('...', '...') : tx('পোস্ট', 'Post')}</Text>
        </Pressable>
      </View>
      {postImage ? (
        <View style={styles.postPreviewWrap}>
          <Image source={{ uri: postImage }} style={styles.postPreview} />
          <Pressable onPress={() => setPostImage(null)} hitSlop={8}><Text style={styles.postPreviewRemove}>{tx('ছবি সরান ✕', 'Remove ✕')}</Text></Pressable>
        </View>
      ) : null}
      {postError ? <Text style={styles.apiNotice}>{postError}</Text> : null}

      {highlightUpdates.length ? (
        <>
          <SectionTitle title={tx('শাথী সেবা আপডেট', 'Shathi Sheba Updates')} right={tx('সব দেখুন', 'See all')} onRightPress={() => setScreen('marketUpdates')} />
          {highlightUpdates.map((row, index) => (
            <Pressable key={`mk-${row.id ?? index}`} onPress={() => setScreen('marketUpdates')}>
              <Card style={styles.officialCard}>
                <View style={styles.officialRibbon}>
                  <Text style={styles.officialRibbonText}>{tx('শাথী সেবা ✓', 'Shathi Sheba ✓')}</Text>
                </View>
                {row.image_url ? <Image source={{ uri: String(row.image_url) }} style={styles.officialImage} /> : null}
                <Text style={styles.postName}>{rowTitle(row, lang, tx('বাজার আপডেট', 'Market update'))}</Text>
                <Text style={styles.postText} numberOfLines={2}>{rowBody(row, lang, '')}</Text>
              </Card>
            </Pressable>
          ))}
        </>
      ) : null}

      <SectionTitle title={tx('কমিউনিটি পোস্ট', 'Community Posts')} warning={fallbackWarning(posts)} />
      {posts.loading ? <ApiStatus state={posts} empty={tx('এখন কোনো কমিউনিটি পোস্ট নেই।', 'No community posts are available right now.')} /> : null}
      {visiblePosts.map((post, index) => (
        <Post
          key={String(post.id ?? `local-${index}`)}
          name={String(post.farmer_name || post.user_name || tx('শাথী ব্যবহারকারী', 'Shathi user'))}
          tag={post.post_type ? tEnum(post.post_type, lang) : tx('পোস্ট', 'Post')}
          text={rowBody(post, lang, '')}
          image={post.image_url ? String(post.image_url) : undefined}
          official={Number(post.is_official ?? 0) === 1}
          likes={num(post.like_count || 0, lang)}
          comments={num(post.comment_count || 0, lang)}
          meta={[formatDate(post.created_at, lang), post.district || post.upazila].filter(Boolean).join(' · ')}
        />
      ))}
    </>
  );
}

function Officer({ name, role, phone }: { name: string; role: string; phone?: string }) {
  return (
    <View style={styles.officerRow}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{name.slice(0, 1).toUpperCase()}</Text>
      </View>
      <View style={styles.flex}>
        <Text style={styles.officerName}>{name}</Text>
        <Text style={styles.officerMeta}>{role}</Text>
      </View>
      <Pressable
        style={styles.officerCallBtn}
        hitSlop={8}
        onPress={() => { if (phone) Linking.openURL(`tel:${phone}`); }}
      >
        <Ionicons name="call" size={17} color="#FFFFFF" />
      </Pressable>
    </View>
  );
}

function Post({ name, tag, text, likes, comments, meta, image, official }: { name: string; tag: string; text: string; likes: string; comments: string; meta?: string; image?: string; official?: boolean }) {
  const { tx } = useLanguage();
  return (
    <Card style={[styles.postCard, official && styles.officialCard]}>
      {official ? (
        <View style={styles.officialRibbon}>
          <Text style={styles.officialRibbonText}>{tx('শাথী সেবা ✓', 'Shathi Sheba ✓')}</Text>
        </View>
      ) : null}
      <View style={styles.postHeader}>
        <View style={[styles.avatar, official && { backgroundColor: colors.maroon }]}>
          <Text style={styles.avatarText}>{(name || 'S').slice(0, 1)}</Text>
        </View>
        <View style={styles.flex}>
          <Text style={styles.postName}>{name}</Text>
          <Text style={styles.productSub}>{meta || ''}</Text>
        </View>
        <Badge label={tag} tone={official ? 'rose' : tag === 'প্রশ্ন' || tag === 'Question' ? 'gold' : 'green'} />
      </View>
      {text ? <Text style={styles.postText}>{text}</Text> : null}
      {image ? <Image source={{ uri: image }} style={styles.postImage} /> : null}
      <View style={styles.postActions}>
        <View style={styles.postActionItem}><Ionicons name="heart-outline" size={18} color={colors.muted} /><Text style={styles.postActionText}>{likes}</Text></View>
        <View style={styles.postActionItem}><Ionicons name="chatbubble-outline" size={17} color={colors.muted} /><Text style={styles.postActionText}>{comments}</Text></View>
        <View style={styles.postActionItem}><Ionicons name="share-social-outline" size={17} color={colors.muted} /></View>
      </View>
    </Card>
  );
}

const PROJECT_CAT_EMOJI: Record<string, string> = {
  'livestock-poultry': '🐄', crops: '🌾', fishery: '🐟', vegetables: '🥬', fruits: '🥭', inputs: '🌱', machinery: '🚜',
};

function ProjectAreaCard({ project, onApply }: { project: ApiRow; onApply: () => void }) {
  const { tx, lang } = useLanguage();
  const emoji = PROJECT_CAT_EMOJI[String(project.interest_slug)] || '📦';
  const region = [project.upazila, project.district, project.division].filter(Boolean).join(', ');
  const open = project.status === 'open';
  const matches = Number(project.matches_interest) === 1;
  return (
    <Card style={styles.projCard}>
      <View style={styles.projImageWrap}>
        {project.image_url ? <Image source={{ uri: String(project.image_url) }} style={styles.projImage} /> : <View style={[styles.projImage, styles.projImagePlaceholder]}><Text style={styles.projImageEmoji}>{emoji}</Text></View>}
        {matches ? <View style={styles.projTag}><Text style={styles.projTagText}>{tx('আপনার আগ্রহ', 'Your interest')}</Text></View> : null}
        <View style={[styles.projStatusPill, open ? styles.projStatusOpen : styles.projStatusSoon]}>
          <Text style={styles.projStatusText}>{open ? tx('নিবন্ধন চলছে', 'Open') : tx('শীঘ্রই', 'Soon')}</Text>
        </View>
      </View>
      <View style={styles.projBody}>
        <Text style={styles.projName}>{emoji} {rowTitle(project, lang, tx('প্রকল্প', 'Project'))}</Text>
        {region ? <Text style={styles.projMeta}>⌖ {region}{Number(project.region_based) === 0 ? ` · ${tx('সব অঞ্চল', 'All regions')}` : ''}</Text> : null}
        {project.summary_en || project.summary_bn ? <Text style={styles.projSummary} numberOfLines={2}>{rowBody(project, lang, '')}</Text> : null}
        <View style={styles.projStatsRow}>
          {project.duration_label ? <View style={styles.projStat}><Text style={styles.projStatLabel}>{tx('মেয়াদ', 'Duration')}</Text><Text style={styles.projStatValue}>{String(project.duration_label)}</Text></View> : null}
          {Number(project.investment_amount) > 0 ? <View style={styles.projStat}><Text style={styles.projStatLabel}>{tx('বিনিয়োগ', 'Investment')}</Text><Text style={styles.projStatValue}>{amount(Number(project.investment_amount), lang)}</Text></View> : null}
          {Number(project.capacity) > 0 ? <View style={styles.projStat}><Text style={styles.projStatLabel}>{tx('আসন', 'Seats')}</Text><Text style={styles.projStatValue}>{num(Number(project.enrolled || 0), lang)}/{num(Number(project.capacity), lang)}</Text></View> : null}
        </View>
        {project.market_overview_en || project.market_overview_bn ? (
          <View style={styles.projOverview}><Text style={styles.projOverviewText}>📈 {lang === 'bn' ? (project.market_overview_bn || project.market_overview_en) : (project.market_overview_en || project.market_overview_bn)}</Text></View>
        ) : null}
        {open ? <AppButton title={tx('এই প্রকল্পে আবেদন করুন  →', 'Apply for this project  →')} onPress={onApply} /> : null}
      </View>
    </Card>
  );
}

function ProjectMineCard({ project }: { project: ApiRow }) {
  const { tx, lang } = useLanguage();
  const emoji = PROJECT_CAT_EMOJI[String(project.interest_slug)] || '📦';
  const approved = Number(project.is_approved) === 1 || project.application_status === 'approved';
  const kyc = Number(project.kyc_verified) === 1;
  const banking = Number(project.has_banking) === 1;
  const farm = Number(project.has_farm_assessment) === 1;
  const steps: Array<{ label: string; done: boolean }> = [
    { label: tx('আবেদন/নথিভুক্ত', 'Enrolled'), done: approved },
    { label: tx('ব্যক্তিগত KYC', 'Personal KYC'), done: kyc },
    { label: tx('ব্যাংকিং তথ্য', 'Banking info'), done: banking },
    { label: tx('খামার মূল্যায়ন', 'Farm assessment'), done: farm },
  ];
  const firstPending = steps.findIndex((s) => !s.done);
  const region = [project.upazila, project.district, project.division].filter(Boolean).join(', ');
  const dates = [formatDate(project.start_date, lang), formatDate(project.end_date, lang)].filter(Boolean).join(' — ');
  return (
    <Card style={styles.projCard}>
      {project.image_url ? (
        <View style={styles.projImageWrap}>
          <Image source={{ uri: String(project.image_url) }} style={styles.projImage} />
          <View style={[styles.projStatusPill, approved ? styles.projStatusOpen : styles.projStatusSoon]}>
            <Text style={styles.projStatusText}>{approved ? tx('সক্রিয়', 'Active') : tEnum(project.application_status, lang)}</Text>
          </View>
        </View>
      ) : null}
      <View style={styles.projBody}>
        <View style={styles.projMineHead}>
          <Text style={styles.projName}>{emoji} {rowTitle(project, lang, tx('প্রকল্প', 'Project'))}</Text>
          {!project.image_url ? <Badge label={approved ? tx('সক্রিয়', 'Active') : tEnum(project.application_status, lang)} tone={approved ? 'green' : 'gold'} /> : null}
        </View>
        {region ? <Text style={styles.projMeta}>⌖ {region}</Text> : null}
        {dates ? <Text style={styles.projMeta}>🗓 {dates}{project.duration_label ? ` · ${project.duration_label}` : ''}</Text> : null}
        {project.application_code ? <Text style={styles.projMeta}>{tx('আবেদন', 'Application')}: {String(project.application_code)}</Text> : null}

        <Text style={styles.projTimelineTitle}>{tx('আবেদন অগ্রগতি', 'Application progress')}</Text>
        <View style={styles.connectedTimeline}>
          {steps.map((s, index) => {
            const state = s.done ? 'done' : (index === firstPending ? 'current' : 'pending');
            return (
              <View key={s.label} style={styles.connectedStep}>
                <View style={styles.timelineNodeRow}>
                  {index > 0 ? <View style={[styles.timelineConnector, steps[index - 1].done ? styles.timelineConnectorDone : styles.timelineConnectorPending]} /> : <View style={styles.timelineConnectorGhost} />}
                  <View style={[styles.timelineNode, state === 'done' && styles.timelineNodeDone, state === 'current' && styles.timelineNodeCurrent]}>
                    <Text style={[styles.timelineNodeText, state === 'pending' && styles.timelineNodeTextPending]}>{state === 'done' ? '✓' : num(index + 1, lang)}</Text>
                  </View>
                  {index < steps.length - 1 ? <View style={[styles.timelineConnector, s.done ? styles.timelineConnectorDone : styles.timelineConnectorPending]} /> : <View style={styles.timelineConnectorGhost} />}
                </View>
                <Text style={[styles.timelineText, state === 'current' && styles.timelineTextCurrent]} numberOfLines={2}>{s.label}</Text>
                <Text style={[styles.timelineStateText, s.done && styles.timelineStateDone, state === 'current' && styles.timelineStateCurrent]}>
                  {s.done ? tx('সম্পন্ন ✓', 'Verified ✓') : tx('অপেক্ষমাণ', 'Pending')}
                </Text>
              </View>
            );
          })}
        </View>
      </View>
    </Card>
  );
}

function Projects({ setScreen, onApply, initialTab = 'area' }: { setScreen: (screen: Screen) => void; onApply: (projectId: string) => void; initialTab?: 'all' | 'area' | 'mine' }) {
  const { tx, lang } = useLanguage();
  const { user } = useAuth();
  const uid = user?.id ? `?user_id=${encodeURIComponent(String(user.id))}` : '';
  const all = useApiList<ApiRow>('partners/projects');
  const active = useApiList<ApiRow>(`app/projects/active${uid}`);
  const mine = useApiList<ApiRow>(`app/projects/mine${uid}`);
  const [tab, setTab] = useState<'all' | 'area' | 'mine'>(initialTab);
  const allRows = all.rows.filter((p) => Number(p.is_active) !== 0);
  const tabs: Array<{ key: 'all' | 'area' | 'mine'; label: string }> = [
    { key: 'area', label: tx('আপনার এলাকা', 'In your area') },
    { key: 'all', label: tx('সকল প্রকল্প', 'All projects') },
    { key: 'mine', label: tx('আমার প্রকল্প', 'My projects') },
  ];
  return (
    <>
      <BrandHeader setScreen={setScreen} />
      <View style={styles.projectHero}>
        <View style={styles.projectHeroIcon}><Text style={styles.projectHeroEmoji}>▣</Text></View>
        <View style={styles.flex}>
          <Text style={styles.projectHeroTitle}>{tx('শাথী পার্টনার প্রকল্প', 'Shathi Partner Projects')}</Text>
          <Text style={styles.projectHeroSub}>{tx('এলাকার, সকল ও আপনার প্রকল্প', 'Area, all and your projects')}</Text>
        </View>
      </View>

      <View style={styles.projTabBar}>
        {tabs.map((t) => (
          <Pressable key={t.key} onPress={() => setTab(t.key)} style={[styles.projTab, tab === t.key && styles.projTabActive]}>
            <Text style={[styles.projTabText, tab === t.key && styles.projTabTextActive]} numberOfLines={1}>{t.label}</Text>
          </Pressable>
        ))}
      </View>

      {tab === 'area' ? (
        <>
          {active.loading ? <ApiStatus state={active} /> : null}
          {!active.loading && active.rows.length === 0 ? (
            <Text style={styles.fieldHint}>{tx('আপনার এলাকায় এখন কোনো সক্রিয় প্রকল্প নেই।', 'No active projects in your area right now.')}</Text>
          ) : null}
          {active.rows.map((p) => (
            <ProjectAreaCard key={String(p.id)} project={p} onApply={() => onApply(String(p.id))} />
          ))}
        </>
      ) : tab === 'all' ? (
        <>
          {all.loading ? <ApiStatus state={all} /> : null}
          {!all.loading && allRows.length === 0 ? (
            <Text style={styles.fieldHint}>{tx('এখন কোনো প্রকল্প নেই।', 'No projects available right now.')}</Text>
          ) : null}
          {allRows.map((p) => (
            <ProjectAreaCard key={String(p.id)} project={p} onApply={() => onApply(String(p.id))} />
          ))}
        </>
      ) : (
        <>
          {mine.loading ? <ApiStatus state={mine} /> : null}
          {!mine.loading && mine.rows.length === 0 ? (
            <View style={styles.projEmpty}>
              <Text style={styles.projEmptyText}>{tx('আপনি এখনো কোনো প্রকল্পে যুক্ত হননি।', 'You have not joined any project yet.')}</Text>
              <AppButton title={tx('সকল প্রকল্প দেখুন', 'Browse all projects')} variant="outline" onPress={() => setTab('all')} />
            </View>
          ) : null}
          {mine.rows.map((p) => (
            <ProjectMineCard key={String(p.application_id || p.id)} project={p} />
          ))}
        </>
      )}
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
  const { user: authedUser, signOut } = useAuth();
  const users = useApiList<ApiRow>('users');
  const user = authedUser || (shouldUseFallback(users) ? fallbackProfileUser : users.rows[0]);
  const menuRows: Array<{ icon: string; title: string; sub: string; target?: Screen; action?: () => void; pill?: string }> = [
    { icon: '👤', title: tx('ব্যক্তিগত তথ্য', 'Personal Info'), sub: tx('নাম, লিঙ্গ, ছবি', 'Name, gender, photo'), target: 'menuPersonal' },
    { icon: '🏦', title: tx('ব্যাংকিং বিবরণ', 'Banking Details'), sub: tx('ব্যাংক, মোবাইল ব্যাংকিং', 'Bank, mobile banking'), target: 'menuBanking' },
    { icon: '🌾', title: tx('খামারের তথ্য', 'Farm Info'), sub: tx('জমি, ফসল, পশুপাখি', 'Land, crops, livestock'), target: 'menuFarm' },
    { icon: '🪪', title: tx('KYC ডকুমেন্ট', 'KYC Documents'), sub: tx('NID, কাগজপত্র', 'NID, papers'), target: 'menuKyc' },
    { icon: '🗂️', title: tx('ক্যাটাগরি আপডেট', 'Update Categories'), sub: tx('পছন্দ তালিকা পরিবর্তন', 'Change preferences'), target: 'prefAnimal' },
    { icon: '🌐', title: tx('ভাষা', 'Language'), sub: tx('ভাষা পরিবর্তন করুন', 'Switch language'), action: toggleLang, pill: lang === 'bn' ? 'BN' : 'EN' },
    { icon: '❓', title: tx('সাহায্য ও FAQ', 'Help & FAQ'), sub: tx('সাধারণ জিজ্ঞাসা', 'Common questions'), target: 'menuFaq' },
  ];
  const roleChips = roleLabelsFor(authedUser, tx);
  return (
    <>
      <View style={styles.profileHead}>
        <View style={styles.profileAvatar}>
          {user?.profile_image_url ? (
            <Image source={{ uri: user.profile_image_url }} style={styles.profileAvatarImage} />
          ) : (
            <Text style={styles.profileAvatarText}>{String(user?.display_name || user?.full_name || 'SS').slice(0, 2).toUpperCase()}</Text>
          )}
        </View>
        <Text style={styles.profileName}>{user?.display_name || user?.full_name || tx('শাথী ব্যবহারকারী', 'Shathi user')}</Text>
        <Text style={styles.profileMeta}>☎ {user?.phone || ''}{user?.district ? `   ⌖ ${user.district}` : ''}</Text>
        <View style={styles.roleChipRow}>
          {roleChips.map((label) => (
            <View key={label} style={styles.roleChip}>
              <Text style={styles.roleChipText}>{label}</Text>
            </View>
          ))}
        </View>
      </View>
      <SectionTitle title={tx('মেনু', 'Menu')} />
      <Card style={styles.menuCard}>
        {menuRows.map((row, index) => (
          <Pressable
            key={row.title}
            onPress={row.action ? row.action : row.target ? () => setScreen(row.target as Screen) : undefined}
            style={({ pressed }) => [styles.menuItem, index === menuRows.length - 1 && styles.menuItemLast, pressed && styles.menuItemPressed]}
          >
            <View style={styles.menuIconWrap}><Text style={styles.menuIcon}>{row.icon}</Text></View>
            <View style={styles.flex}>
              <Text style={styles.menuTitle}>{row.title}</Text>
              <Text style={styles.menuSub}>{row.sub}</Text>
            </View>
            {row.pill ? (
              <View style={styles.languagePill}>
                <Text style={styles.languagePillText}>{row.pill}</Text>
              </View>
            ) : (
              <Text style={styles.chevron}>›</Text>
            )}
          </Pressable>
        ))}
      </Card>
      <Pressable onPress={() => { void signOut(); }} style={({ pressed }) => [styles.logoutButton, pressed && styles.pressed]}>
        <Text style={styles.logoutButtonIcon}>↪</Text>
        <Text style={styles.logoutButtonText}>{tx('লগআউট', 'Logout')}</Text>
      </Pressable>
      <Text style={styles.version}>{tx('Shathi Sheba v1.0 · প্রস্তুতকারী Digigram Ventures Ltd.', 'Shathi Sheba v1.0 · Powered by Digigram Ventures Ltd.')}</Text>
    </>
  );
}

// Human role labels for the app (a user can hold several roles).
function roleLabelsFor(user: AuthUser | null, tx: (bn: string, en: string) => string): string[] {
  const labels: string[] = [];
  if (hasRole(user, 'field_officer')) labels.push(tx('মাঠ কর্মকর্তা', 'Field Officer'));
  if (hasRole(user, 'shathisheba_seller')) labels.push(tx('শাথী সেবা পার্টনার', 'Shathi Sheba Partner'));
  if (hasRole(user, 'shathisheba_buyer')) labels.push(tx('শাথী ক্রেতা', 'Shathi Buyer'));
  return labels.length ? labels : [tx('শাথী ক্রেতা', 'Shathi Buyer')];
}

function DropdownField({ value, placeholder, options, onSelect, flexBasis }: { value: string; placeholder: string; options: Array<{ value: string; label: string }>; onSelect: (v: string) => void; flexBasis?: number }) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  return (
    <View style={{ flex: flexBasis ?? 1 }}>
      <Pressable style={styles.dropdownField} onPress={() => setOpen(true)}>
        <Text style={[styles.dropdownValue, !selected && { color: colors.muted }]} numberOfLines={1}>{selected ? selected.label : placeholder}</Text>
        <Text style={styles.dropdownCaret}>▾</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.dropdownBackdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.dropdownCard} onPress={() => {}}>
            <View style={styles.dropdownHandle} />
            <Text style={styles.dropdownSheetTitle}>{placeholder}</Text>
            <ScrollView showsVerticalScrollIndicator={false}>
              {options.map((o) => (
                <Pressable key={o.value} style={[styles.dropdownOption, o.value === value && styles.dropdownOptionActive]} onPress={() => { onSelect(o.value); setOpen(false); }}>
                  <Text style={[styles.dropdownOptionText, o.value === value && styles.dropdownOptionTextActive]} numberOfLines={1}>{o.label}</Text>
                  {o.value === value ? <Text style={styles.dropdownCheck}>✓</Text> : null}
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function MenuField({ label, value, onChangeText, placeholder, keyboardType, multiline }: { label: string; value: string; onChangeText: (v: string) => void; placeholder?: string; keyboardType?: 'default' | 'number-pad' | 'phone-pad'; multiline?: boolean }) {
  return (
    <>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && { height: 84, textAlignVertical: 'top', paddingTop: 10 }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        keyboardType={keyboardType || 'default'}
        multiline={multiline}
      />
    </>
  );
}

function BankingScreen({ setScreen }: { setScreen: (screen: Screen) => void }) {
  const { tx, lang } = useLanguage();
  const { user } = useAuth();
  const [bankName, setBankName] = useState('');
  const [branch, setBranch] = useState('');
  const [accountName, setAccountName] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [provider, setProvider] = useState('');
  const [mobileAccount, setMobileAccount] = useState('');
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    if (!user?.id) return;
    apiRequest<{ data?: ApiRow }>(`app/banking?user_id=${user.id}`)
      .then((res) => {
        const d = res.data;
        if (!alive || !d || Array.isArray(d)) return;
        setBankName(d.bank_name || '');
        setBranch(d.branch_name || '');
        setAccountName(d.account_name || '');
        setAccountNumber(d.account_number || '');
        setProvider(d.mobile_provider || '');
        setMobileAccount(d.mobile_account || '');
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [user?.id]);

  async function save() {
    setError('');
    setSaved('');
    try {
      await apiCreate('app/banking', {
        user_id: user?.id,
        bank_name: bankName,
        branch_name: branch,
        account_name: accountName,
        account_number: accountNumber,
        mobile_provider: provider || null,
        mobile_account: mobileAccount,
      });
      setSaved(tx('ব্যাংকিং তথ্য সংরক্ষণ হয়েছে।', 'Banking details saved.'));
    } catch (saveError) {
      setError(naturalApiError(saveError, lang));
    }
  }

  const providers = ['bkash', 'nagad', 'rocket', 'upay'];
  return (
    <>
      <Header title={tx('ব্যাংকিং বিবরণ', 'Banking Details')} onBack={() => setScreen('profile')} />
      <RefreshScroll contentContainerStyle={styles.menuFormScroll}>
        <MenuField label={tx('ব্যাংকের নাম', 'Bank name')} value={bankName} onChangeText={setBankName} placeholder={tx('যেমন: ডাচ্-বাংলা ব্যাংক', 'e.g. Dutch-Bangla Bank')} />
        <MenuField label={tx('শাখা', 'Branch')} value={branch} onChangeText={setBranch} />
        <MenuField label={tx('অ্যাকাউন্টের নাম', 'Account name')} value={accountName} onChangeText={setAccountName} />
        <MenuField label={tx('অ্যাকাউন্ট নম্বর', 'Account number')} value={accountNumber} onChangeText={setAccountNumber} keyboardType="number-pad" />
        <Text style={styles.label}>{tx('মোবাইল ব্যাংকিং', 'Mobile banking')}</Text>
        <View style={styles.kycChipRow}>
          {providers.map((p) => (
            <Pressable key={p} style={[styles.genderPill, { flex: 0, paddingHorizontal: 16 }, provider === p && styles.genderPillActive]} onPress={() => setProvider(provider === p ? '' : p)}>
              <Text style={[styles.genderPillText, provider === p && styles.genderPillTextActive]}>{p}</Text>
            </Pressable>
          ))}
        </View>
        <MenuField label={tx('মোবাইল অ্যাকাউন্ট নম্বর', 'Mobile account number')} value={mobileAccount} onChangeText={setMobileAccount} keyboardType="phone-pad" />
        {error ? <Text style={styles.apiNotice}>{error}</Text> : null}
        {saved ? <Text style={[styles.apiNotice, { color: colors.green }]}>{saved}</Text> : null}
        <View style={{ height: 10 }} />
        <AppButton title={tx('সংরক্ষণ করুন', 'Save')} onPress={save} />
      </RefreshScroll>
    </>
  );
}

function FarmScreen({ setScreen }: { setScreen: (screen: Screen) => void }) {
  const { tx, lang } = useLanguage();
  const { user } = useAuth();
  const [land, setLand] = useState('');
  const [focus, setFocus] = useState('');
  const [crops, setCrops] = useState('');
  const [livestock, setLivestock] = useState('');
  const [ponds, setPonds] = useState('');
  const [address, setAddress] = useState('');
  const [saved, setSaved] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    if (!user?.id) return;
    apiRequest<{ data?: ApiRow }>(`app/farm?user_id=${user.id}`)
      .then((res) => {
        const d = res.data;
        if (!alive || !d || Array.isArray(d)) return;
        setLand(d.total_land_decimals != null ? String(d.total_land_decimals) : '');
        setFocus(d.primary_focus || '');
        setCrops(d.crop_types || '');
        setLivestock(d.livestock_count != null ? String(d.livestock_count) : '');
        setPonds(d.pond_count != null ? String(d.pond_count) : '');
        setAddress(d.farm_address || '');
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [user?.id]);

  async function save() {
    setError('');
    setSaved('');
    try {
      await apiCreate('app/farm', {
        user_id: user?.id,
        total_land_decimals: land ? Number(land) : null,
        primary_focus: focus,
        crop_types: crops,
        livestock_count: livestock ? Number(livestock) : null,
        pond_count: ponds ? Number(ponds) : null,
        farm_address: address,
      });
      setSaved(tx('খামারের তথ্য সংরক্ষণ হয়েছে।', 'Farm info saved.'));
    } catch (saveError) {
      setError(naturalApiError(saveError, lang));
    }
  }

  return (
    <>
      <Header title={tx('খামারের তথ্য', 'Farm Info')} onBack={() => setScreen('profile')} />
      <RefreshScroll contentContainerStyle={styles.menuFormScroll}>
        <MenuField label={tx('মোট জমি (শতাংশ)', 'Total land (decimals)')} value={land} onChangeText={setLand} keyboardType="number-pad" />
        <MenuField label={tx('প্রধান কাজ', 'Primary focus')} value={focus} onChangeText={setFocus} placeholder={tx('যেমন: গবাদিপশু, ফসল', 'e.g. livestock, crops')} />
        <MenuField label={tx('ফসলের ধরন', 'Crop types')} value={crops} onChangeText={setCrops} placeholder={tx('ধান, ভুট্টা', 'rice, maize')} />
        <Text style={styles.label}>{tx('পশুর সংখ্যা', 'Livestock count')}</Text>
        <Stepper value={livestock} onChange={setLivestock} min={0} />
        <MenuField label={tx('পুকুরের সংখ্যা', 'Pond count')} value={ponds} onChangeText={setPonds} keyboardType="number-pad" />
        <MenuField label={tx('খামারের ঠিকানা', 'Farm address')} value={address} onChangeText={setAddress} multiline />
        {error ? <Text style={styles.apiNotice}>{error}</Text> : null}
        {saved ? <Text style={[styles.apiNotice, { color: colors.green }]}>{saved}</Text> : null}
        <View style={{ height: 10 }} />
        <AppButton title={tx('সংরক্ষণ করুন', 'Save')} onPress={save} />
      </RefreshScroll>
    </>
  );
}

function KycScreen({ setScreen }: { setScreen: (screen: Screen) => void }) {
  const { tx, lang } = useLanguage();
  const { user } = useAuth();
  const [docs, setDocs] = useState<ApiRow[]>([]);
  const [docType, setDocType] = useState('nid_front');
  const [pickedUri, setPickedUri] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState('');
  const kyc = user?.kyc || {};

  const docTypes: Array<{ key: string; label: string; icon: string; sample: string; guide: string }> = [
    { key: 'nid_front', label: tx('NID সামনে', 'NID front'), icon: '🪪', sample: tx('NID-এর সামনের অংশ', 'NID front side'), guide: tx('ছবি, নাম ও NID নম্বর স্পষ্ট দেখা যাবে এমনভাবে ফ্রেমের ভেতরে রাখুন।', 'Place inside the frame so photo, name and NID number are clearly readable.') },
    { key: 'nid_back', label: tx('NID পিছনে', 'NID back'), icon: '🪪', sample: tx('NID-এর পিছনের অংশ', 'NID back side'), guide: tx('পুরো পিছনের অংশ ফ্রেমে রাখুন, কোনো অংশ কাটা যাবে না।', 'Fit the whole back side in the frame, no corners cut.') },
    { key: 'selfie', label: tx('সেলফি', 'Selfie'), icon: '🤳', sample: tx('আপনার সেলফি', 'Your selfie'), guide: tx('মুখ স্পষ্ট ও ভালো আলোতে, চশমা/টুপি ছাড়া।', 'Face clear, good light, no glasses/cap.') },
    { key: 'trade_license', label: tx('ট্রেড লাইসেন্স', 'Trade license'), icon: '📄', sample: tx('ট্রেড লাইসেন্স', 'Trade license'), guide: tx('সম্পূর্ণ ডকুমেন্ট পড়া যায় এমনভাবে তুলুন।', 'Capture the full document, fully readable.') },
    { key: 'passbook', label: tx('পাসবই', 'Passbook'), icon: '📒', sample: tx('ব্যাংক পাসবই', 'Bank passbook'), guide: tx('অ্যাকাউন্ট তথ্যসহ প্রথম পৃষ্ঠা তুলুন।', 'Capture the first page showing account details.') },
  ];
  const activeType = docTypes.find((d) => d.key === docType) || docTypes[0];

  async function load() {
    if (!user?.id) return;
    try {
      const res = await apiRequest<{ data?: ApiRow[] }>(`app/kyc-documents?user_id=${user.id}`);
      setDocs(Array.isArray(res.data) ? res.data : []);
    } catch {
      setDocs([]);
    }
  }
  useEffect(() => { load(); }, [user?.id]);

  async function pick() {
    setError('');
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 });
    if (!result.canceled) setPickedUri(result.assets[0].uri);
  }

  async function confirmUpload() {
    if (!pickedUri) return;
    setError('');
    try {
      const url = await uploadImage(pickedUri, 'kyc');
      await apiCreate('app/kyc-documents', { user_id: user?.id, doc_type: docType, document_url: url });
      setPickedUri(null);
      load();
    } catch (uploadError) {
      setError(naturalApiError(uploadError, lang));
    }
  }

  function statusLabel(status: string) {
    if (status === 'verified') return tx('যাচাইকৃত', 'Verified');
    if (status === 'rejected') return tx('বাতিল', 'Rejected');
    return tx('অপেক্ষমাণ', 'Pending');
  }

  return (
    <>
      <Header title={tx('KYC ডকুমেন্ট', 'KYC Documents')} onBack={() => setScreen('profile')} />
      <RefreshScroll contentContainerStyle={styles.menuFormScroll}>
        <Text style={styles.pageHint}>{tx('ডকুমেন্টের ধরন নির্বাচন করে নমুনা দেখে ছবি তুলুন।', 'Pick a document type, check the sample, then add a photo.')}</Text>
        <View style={styles.kycChipRow}>
          {docTypes.map((d) => (
            <Pressable key={d.key} style={[styles.genderPill, { flex: 0, paddingHorizontal: 14 }, docType === d.key && styles.genderPillActive]} onPress={() => { setDocType(d.key); setPickedUri(null); }}>
              <Text style={[styles.genderPillText, docType === d.key && styles.genderPillTextActive]}>{d.label}</Text>
            </Pressable>
          ))}
        </View>

        {/* Sample placement guide for the selected document type */}
        <View style={styles.kycSampleBox}>
          <View style={styles.kycSampleFrame}>
            <Text style={styles.kycSampleIcon}>{activeType.icon}</Text>
            <Text style={styles.kycSampleTag}>{tx('নমুনা', 'Sample')} · {activeType.sample}</Text>
          </View>
          <Text style={styles.kycSampleText}>{activeType.guide}</Text>
        </View>

        {/* Selected image preview before upload */}
        {pickedUri ? (
          <View style={styles.kycPreviewWrap}>
            <Text style={styles.label}>{tx('নির্বাচিত ছবি (প্রিভিউ)', 'Selected image (preview)')}</Text>
            <Image source={{ uri: pickedUri }} style={styles.kycPreviewImage} resizeMode="cover" />
            <View style={styles.kycPreviewActions}>
              <AppButton title={tx('আপলোড নিশ্চিত করুন', 'Confirm upload')} onPress={confirmUpload} />
              <Text style={styles.otpResend} onPress={pick}>{tx('অন্য ছবি বেছে নিন', 'Choose another')}</Text>
            </View>
          </View>
        ) : (
          <>
            <View style={{ height: 6 }} />
            <AppButton title={tx('ছবি বেছে নিন', 'Select photo')} onPress={pick} />
          </>
        )}

        {error ? <Text style={styles.apiNotice}>{error}</Text> : null}

        <SectionTitle title={tx('যাচাই অবস্থা', 'Verification status')} />
        <View style={styles.kycSummaryRow}>
          {([['🪪', tx('NID', 'NID'), kyc.nid], ['🤳', tx('সেলফি', 'Selfie'), kyc.selfie], ['🏦', tx('ব্যাংক', 'Bank'), kyc.banking ? 'verified' : 'none']] as Array<[string, string, string | undefined]>).map(([icon, label, st]) => {
            const tone = kycTone(st);
            return (
              <View key={label} style={[styles.kycSummaryChip, styles[`kycChip_${tone}` as 'kycChip_green']]}>
                <Text style={styles.kycSummaryIcon}>{icon}</Text>
                <Text style={styles.kycSummaryLabel}>{label}</Text>
                <Text style={styles.kycSummaryStatus}>{st === 'verified' ? tx('যাচাইকৃত ✓', 'Verified ✓') : st === 'pending' ? tx('অপেক্ষমাণ', 'Pending') : st === 'rejected' ? tx('বাতিল ✕', 'Rejected ✕') : tx('নেই', 'Not added')}</Text>
              </View>
            );
          })}
        </View>

        <SectionTitle title={tx('আপলোড করা ডকুমেন্ট', 'Uploaded documents')} />
        <Card style={{ marginHorizontal: 16 }}>
          {docs.length === 0 ? (
            <Text style={styles.menuSub}>{tx('এখনো কোনো ডকুমেন্ট আপলোড করা হয়নি।', 'No documents uploaded yet.')}</Text>
          ) : (
            docs.map((d) => (
              <View key={String(d.id)} style={styles.kycDocRow}>
                <Pressable onPress={() => setPreview(String(d.document_url))}>
                  <Image source={{ uri: String(d.document_url) }} style={styles.kycDocThumb} />
                  <View style={styles.kycDocThumbZoom}><Text style={styles.kycDocThumbZoomText}>⤢</Text></View>
                </Pressable>
                <View style={styles.flex}>
                  <Text style={styles.menuTitle}>{docTypes.find((t) => t.key === d.doc_type)?.label || humanizeLabel(d.doc_type)}</Text>
                  <Text style={styles.menuSub}>{formatDate(d.created_at, lang)}</Text>
                  <Text style={styles.kycUpdateLink} onPress={() => { setDocType(String(d.doc_type)); setPickedUri(null); }}>{tx('↻ আপডেট করুন', '↻ Update')}</Text>
                </View>
                <Badge label={statusLabel(String(d.status))} tone={d.status === 'verified' ? 'green' : d.status === 'rejected' ? 'rose' : 'gold'} />
              </View>
            ))
          )}
        </Card>
      </RefreshScroll>

      <Modal visible={!!preview} transparent animationType="fade" onRequestClose={() => setPreview(null)}>
        <Pressable style={styles.previewBackdrop} onPress={() => setPreview(null)}>
          {preview ? <Image source={{ uri: preview }} style={styles.previewImage} resizeMode="contain" /> : null}
          <Text style={styles.previewClose}>{tx('বন্ধ করতে ট্যাপ করুন', 'Tap to close')}</Text>
        </Pressable>
      </Modal>
    </>
  );
}

function FaqScreen({ setScreen }: { setScreen: (screen: Screen) => void }) {
  const { tx, lang } = useLanguage();
  const faqs = useApiList<ApiRow>('faq');
  const [open, setOpen] = useState<string | null>(null);
  return (
    <>
      <Header title={tx('সাহায্য ও FAQ', 'Help & FAQ')} onBack={() => setScreen('profile')} />
      <RefreshScroll contentContainerStyle={styles.menuFormScroll}>
        {faqs.loading ? <ApiStatus state={faqs} empty={tx('এখন কোনো প্রশ্ন পাওয়া যায়নি।', 'No FAQs available right now.')} /> : null}
        {faqs.rows.map((row) => {
          const id = String(row.id);
          const question = localized(row, lang, 'question', String(row.question || row.question_en || ''));
          const answer = localized(row, lang, 'answer', String(row.answer || row.answer_en || ''));
          const isOpen = open === id;
          return (
            <Pressable key={id} onPress={() => setOpen(isOpen ? null : id)}>
              <Card style={styles.faqCard}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Text style={[styles.faqQuestion, styles.flex]}>{question}</Text>
                  <Text style={styles.chevron}>{isOpen ? '−' : '+'}</Text>
                </View>
                {isOpen ? <Text style={styles.faqAnswer}>{answer}</Text> : null}
              </Card>
            </Pressable>
          );
        })}
      </RefreshScroll>
    </>
  );
}

function MarketUpdates({ setScreen, onSelect }: { setScreen: (screen: Screen) => void; onSelect: (id: string) => void }) {
  const { tx, lang } = useLanguage();
  const { user } = useAuth();
  const district = user?.district ? `?district=${encodeURIComponent(user.district)}` : '';
  const updates = useApiList<ApiRow>(`app/market-updates${district}`);
  const rows = shouldUseFallback(updates) ? fallbackMarketUpdates : updates.rows;
  return (
    <>
      <Header title={tx('বাজার আপডেট', 'Market Updates')} onBack={() => setScreen('home')} />
      <RefreshScroll contentContainerStyle={styles.menuFormScroll}>
        {updates.loading ? <ApiStatus state={updates} empty={tx('এখন কোনো আপডেট নেই।', 'No updates right now.')} /> : null}
        {rows.map((row, index) => {
          const id = String(row.id ?? index);
          const hasDetail = Number(row.has_detail ?? 0) === 1 || !!row.detail_en || !!row.detail_bn || !!row.image_url;
          const area = [row.district, row.upazila].filter(Boolean).join(' · ');
          return (
            <Pressable key={id} onPress={() => hasDetail && onSelect(id)} style={({ pressed }) => [styles.marketCard, pressed && hasDetail && styles.pressed]}>
              {row.image_url ? <Image source={{ uri: String(row.image_url) }} style={styles.marketCardImage} /> : null}
              <View style={styles.marketCardBody}>
                <View style={styles.marketCardTop}>
                  <Badge label={tEnum(row.category || row.update_type || 'update', lang)} tone="gold" />
                  {row.created_at ? <Text style={styles.menuSub}>{formatDate(row.created_at, lang)}</Text> : null}
                </View>
                <Text style={styles.marketCardTitle}>{rowTitle(row, lang, tx('বাজার আপডেট', 'Market update'))}</Text>
                <Text style={styles.marketCardSub} numberOfLines={2}>{rowBody(row, lang, '')}</Text>
                {area ? <Text style={styles.menuSub}>⌖ {area}</Text> : null}
                {hasDetail ? <Text style={styles.marketReadMore}>{tx('বিস্তারিত দেখুন ›', 'Read details ›')}</Text> : null}
              </View>
            </Pressable>
          );
        })}
      </RefreshScroll>
    </>
  );
}

function MarketDetail({ setScreen, id }: { setScreen: (screen: Screen) => void; id: string | null }) {
  const { tx, lang } = useLanguage();
  const [row, setRow] = useState<ApiRow | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    if (!id) { setLoading(false); return; }
    apiRequest<{ data?: ApiRow }>(`app/market-updates?id=${encodeURIComponent(id)}`)
      .then((res) => { if (alive) { setRow(res.data ?? null); setLoading(false); } })
      .catch(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id]);

  const detail = localized(row || undefined, lang, 'detail', '') || rowBody(row || undefined, lang, '');
  const area = [row?.district, row?.upazila].filter(Boolean).join(' · ');
  return (
    <>
      <Header title={tx('বাজার আপডেট', 'Market Update')} onBack={() => setScreen('marketUpdates')} />
      <RefreshScroll contentContainerStyle={styles.menuFormScroll}>
        {loading ? <Text style={styles.apiNotice}>{tx('লোড হচ্ছে...', 'Loading...')}</Text> : null}
        {!loading && !row ? <Text style={styles.apiNotice}>{tx('এই আপডেট পাওয়া যায়নি।', 'This update was not found.')}</Text> : null}
        {row ? (
          <>
            {row.image_url ? <Image source={{ uri: String(row.image_url) }} style={styles.marketDetailImage} /> : null}
            <View style={{ paddingHorizontal: 16, paddingTop: 14 }}>
              <View style={styles.marketCardTop}>
                <Badge label={tEnum(row.category || row.update_type || 'update', lang)} tone="gold" />
                {row.created_at ? <Text style={styles.menuSub}>{formatDate(row.created_at, lang)}</Text> : null}
              </View>
              <Text style={styles.marketDetailTitle}>{rowTitle(row, lang, '')}</Text>
              {area ? <Text style={styles.menuSub}>⌖ {area}</Text> : null}
              <Text style={styles.marketDetailBody}>{detail || rowBody(row, lang, '')}</Text>
            </View>
          </>
        ) : null}
      </RefreshScroll>
    </>
  );
}

function OfficersScreen({ setScreen }: { setScreen: (screen: Screen) => void }) {
  const { tx, lang } = useLanguage();
  const { user } = useAuth();
  const district = user?.district ? `?district=${encodeURIComponent(user.district)}` : '';
  const officers = useApiList<ApiRow>(`community/officers${district}`);
  const rows = shouldUseFallback(officers) ? fallbackOfficers : officers.rows;
  return (
    <>
      <Header title={tx('উপজেলা কর্মকর্তা', 'Upazila Officers')} onBack={() => setScreen('community')} />
      <RefreshScroll contentContainerStyle={styles.menuFormScroll}>
        <Text style={styles.pageHint}>{tx('আপনার এলাকার নিকটবর্তী কর্মকর্তাগণ।', 'Officers nearby in your area.')}</Text>
        {officers.loading ? <ApiStatus state={officers} empty={tx('কোনো কর্মকর্তা পাওয়া যায়নি।', 'No officers found.')} /> : null}
        <Card style={{ marginHorizontal: 16 }}>
          {rows.map((officer, index) => (
            <Officer
              key={String(officer.id ?? index)}
              name={String(officer.name || officer.full_name || tx('কর্মকর্তা', 'Officer'))}
              role={[tEnum(officer.role || officer.officer_role, lang), officer.district, officer.upazila].filter(Boolean).join(' · ')}
              phone={officer.phone ? String(officer.phone) : undefined}
            />
          ))}
        </Card>
      </RefreshScroll>
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
  profileAvatarImage: { width: '100%', height: '100%' },
  roleChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginTop: 10 },
  roleChip: { backgroundColor: 'rgba(255,255,255,0.22)', borderRadius: 20, paddingHorizontal: 12, paddingVertical: 5 },
  roleChipText: { color: 'white', fontSize: 12.5, fontWeight: '800' },
  menuIconWrap: { width: 38, height: 38, borderRadius: 10, backgroundColor: '#FBEAF1', alignItems: 'center', justifyContent: 'center', marginRight: 12 },
  menuItemLast: { borderBottomWidth: 0 },
  menuItemPressed: { backgroundColor: '#FAFAFA' },
  logoutButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginHorizontal: 16, marginTop: 16, height: 52, borderRadius: 12, backgroundColor: '#FEF2F2', borderWidth: 1.5, borderColor: colors.danger },
  logoutButtonIcon: { color: colors.danger, fontSize: 18, fontWeight: '900' },
  logoutButtonText: { color: colors.danger, fontSize: 16, fontWeight: '800' },
  dobRow: { flexDirection: 'row', gap: 8, marginHorizontal: 20, marginTop: 6 },
  dropdownField: { height: 44, borderRadius: 11, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dropdownValue: { color: colors.ink, fontSize: 14.5, fontWeight: '600', flex: 1 },
  dropdownCaret: { color: colors.muted, fontSize: 12, marginLeft: 6 },
  stepper: { flexDirection: 'row', alignItems: 'center', height: 46, borderRadius: 11, borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card, marginHorizontal: 16, overflow: 'hidden' },
  stepperBtn: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.rose },
  stepperBtnText: { color: colors.maroon, fontSize: 22, fontWeight: '800', lineHeight: 24 },
  stepperInput: { flex: 1, textAlign: 'center', color: colors.ink, fontSize: 16, fontWeight: '700' },
  stepperCompact: { marginHorizontal: 0, height: 44 },
  gpsPillRow: { flexDirection: 'row', justifyContent: 'flex-end', marginHorizontal: 16, marginTop: 2 },
  gpsPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.bluePale, borderWidth: 1, borderColor: '#BBD3FB', borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 },
  gpsPillText: { color: colors.blue, fontSize: 11.5, fontWeight: '800' },
  dropdownBackdrop: { flex: 1, backgroundColor: 'rgba(20,8,16,0.45)', justifyContent: 'flex-end' },
  dropdownCard: { width: '100%', maxHeight: '70%', backgroundColor: colors.card, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingTop: 8, paddingBottom: 24, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 20, shadowOffset: { width: 0, height: -4 }, elevation: 12 },
  dropdownHandle: { alignSelf: 'center', width: 38, height: 4, borderRadius: 4, backgroundColor: colors.line, marginBottom: 8 },
  dropdownSheetTitle: { color: colors.muted, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4, paddingHorizontal: 20, paddingBottom: 6 },
  dropdownOption: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 20 },
  dropdownOptionActive: { backgroundColor: colors.rose },
  dropdownOptionText: { color: colors.ink, fontSize: 15.5, flex: 1 },
  dropdownOptionTextActive: { color: colors.maroon, fontWeight: '800' },
  dropdownCheck: { color: colors.maroon, fontSize: 17, fontWeight: '800', marginLeft: 12 },
  menuFormScroll: { paddingBottom: 28 },
  kycDocRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.line },
  kycDocThumb: { width: 44, height: 44, borderRadius: 8, backgroundColor: '#FBEAF1' },
  kycChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginHorizontal: 20, marginTop: 6 },
  kycSampleBox: { marginHorizontal: 16, marginTop: 14, backgroundColor: '#FBF7F9', borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: 14 },
  kycSampleFrame: { height: 150, borderRadius: 12, borderWidth: 2, borderStyle: 'dashed', borderColor: '#D9A8C0', alignItems: 'center', justifyContent: 'center', backgroundColor: 'white' },
  kycSampleIcon: { fontSize: 54 },
  kycSampleTag: { color: colors.maroon, fontSize: 12.5, fontWeight: '800', marginTop: 8 },
  kycSampleText: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 10 },
  kycPreviewWrap: { marginHorizontal: 16, marginTop: 14 },
  kycPreviewImage: { width: '100%', height: 220, borderRadius: 12, borderWidth: 1, borderColor: colors.line, marginTop: 6 },
  kycPreviewActions: { marginTop: 8 },
  marketCard: { marginHorizontal: 16, marginTop: 12, backgroundColor: 'white', borderRadius: 14, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  marketCardImage: { width: '100%', height: 150 },
  marketCardBody: { padding: 14 },
  marketCardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  marketCardTitle: { color: colors.ink, fontSize: 16, fontWeight: '800', lineHeight: 22 },
  marketCardSub: { color: colors.muted, fontSize: 13, lineHeight: 19, marginTop: 4 },
  marketReadMore: { color: colors.maroon, fontSize: 13, fontWeight: '700', marginTop: 8 },
  marketDetailImage: { width: '100%', height: 220 },
  marketDetailTitle: { color: colors.ink, fontSize: 22, fontWeight: '800', lineHeight: 30, marginTop: 10 },
  marketDetailBody: { color: colors.ink, fontSize: 15, lineHeight: 24, marginTop: 14 },
  postImageIcon: { fontSize: 20, marginHorizontal: 6 },
  postPreviewWrap: { marginHorizontal: 16, marginTop: 8, alignItems: 'flex-start' },
  postPreview: { width: 120, height: 90, borderRadius: 10, borderWidth: 1, borderColor: colors.line },
  postPreviewRemove: { color: colors.danger, fontSize: 12, fontWeight: '700', marginTop: 4 },
  postImage: { width: '100%', height: 180, borderRadius: 10, marginTop: 8 },
  officialCard: { borderColor: colors.maroon, borderWidth: 1.5, backgroundColor: '#FFF6FB' },
  officialRibbon: { alignSelf: 'flex-start', backgroundColor: colors.maroon, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, marginBottom: 8 },
  officialRibbonText: { color: 'white', fontSize: 11, fontWeight: '800' },
  officialImage: { width: '100%', height: 160, borderRadius: 10, marginBottom: 8 },
  faqCard: { marginHorizontal: 16, marginTop: 10, padding: 16 },
  faqQuestion: { color: colors.ink, fontSize: 15, fontWeight: '700', lineHeight: 21 },
  faqAnswer: { color: colors.muted, fontSize: 13.5, lineHeight: 20, marginTop: 8 },
  loaderOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', zIndex: 1000 },
  loaderCard: { width: 76, height: 76, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.96)', alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 8, borderWidth: 1, borderColor: colors.line },
  otpResend: { color: colors.maroon, fontSize: 14, fontWeight: '700', textAlign: 'center', marginTop: 14 },
  otpTimer: { color: colors.muted, fontSize: 13, fontWeight: '600', textAlign: 'center', marginTop: 10 },
  otpExpired: { color: colors.danger, fontSize: 13, fontWeight: '700', textAlign: 'center', marginTop: 10 },
  otpResendWait: { color: colors.muted, fontSize: 13, textAlign: 'center', marginTop: 14 },
  otpEditPhone: { color: colors.muted, fontSize: 13, textAlign: 'center', marginTop: 8 },
  genderRow: { flexDirection: 'row', gap: 10, marginHorizontal: 20, marginTop: 6 },
  genderPill: { flex: 1, height: 46, borderRadius: 10, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card },
  genderPillActive: { borderColor: colors.maroon, backgroundColor: '#FBEAF1' },
  genderPillText: { color: colors.ink, fontSize: 14, fontWeight: '600' },
  genderPillTextActive: { color: colors.maroon, fontWeight: '800' },
  avatarPick: { alignSelf: 'center', width: 96, height: 96, borderRadius: 48, backgroundColor: '#FBEAF1', alignItems: 'center', justifyContent: 'center', marginTop: 6, marginBottom: 4, overflow: 'hidden', borderWidth: 1, borderColor: colors.line },
  avatarPickImage: { width: 96, height: 96 },
  avatarPickIcon: { fontSize: 34, color: colors.maroon },
  loginCard: { marginHorizontal: 0, padding: 32, borderRadius: 18 },
  loginTitle: { color: colors.maroon, fontSize: 29, lineHeight: 36, fontWeight: '700', textAlign: 'center' },
  loginSub: { color: colors.muted, fontSize: 18, textAlign: 'center', marginBottom: 22 },
  label: { color: colors.ink, fontSize: 12.5, fontWeight: '700', marginHorizontal: 16, marginTop: 12, marginBottom: 5, letterSpacing: 0.1 },
  input: {
    height: 46,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
    marginHorizontal: 16,
    color: colors.ink,
    fontSize: 15,
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
  prefOptionIcon: { fontSize: 36, lineHeight: 42, textAlign: 'center' },
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
  tileIcon: { fontSize: 31, lineHeight: 38, marginBottom: 8, textAlign: 'center' },
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
  heroGreeting: { marginBottom: 2 },
  heroSmall: { color: 'rgba(255,255,255,0.82)', fontSize: 16 },
  heroName: { color: 'white', fontSize: 18, fontWeight: '800' },
  heroMeta: { color: 'rgba(255,255,255,0.78)', fontSize: 13, marginTop: 8 },
  weatherHomeCard: { marginTop: 10, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.14)', paddingVertical: 9, paddingHorizontal: 11, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  weatherHomeTop: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  weatherHomeIcon: { width: 36, height: 36, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  weatherHomeEmoji: { fontSize: 20 },
  weatherHomeTitle: { color: 'white', fontSize: 14, fontWeight: '700' },
  weatherHomeLocation: { color: 'rgba(255,255,255,0.8)', fontSize: 11, marginTop: 1 },
  weatherHomeTemp: { alignItems: 'flex-end' },
  weatherHomeTempText: { color: colors.goldPale, fontSize: 19, fontWeight: '700' },
  weatherHomeMeta: { color: 'rgba(255,255,255,0.76)', fontSize: 10 },
  weatherHomeAlert: { color: 'rgba(255,255,255,0.84)', fontSize: 11, fontWeight: '700', marginTop: 6 },
  metricsBand: { flexDirection: 'row', alignItems: 'stretch', marginHorizontal: 16, marginTop: 14, marginBottom: 4, backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.line, paddingVertical: 12, shadowColor: colors.maroon, shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 2 },
  metricDivider: { width: 1, backgroundColor: colors.line, marginVertical: 6 },
  metricCard: { flex: 1, alignItems: 'center', paddingHorizontal: 4 },
  metricIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  metricIconText: { fontSize: 17 },
  metricValue: { fontSize: 18, fontWeight: '800', marginTop: 6 },
  metricLabel: { color: colors.muted, fontSize: 11, fontWeight: '700', marginTop: 2 },
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
  sectionBlock: { marginTop: 18, marginBottom: 8 },
  sectionRow: { paddingHorizontal: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 10 },
  sectionTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1 },
  sectionTitle: { color: colors.ink, fontSize: 19, fontWeight: '700' },
  sectionRight: { color: colors.maroon, fontSize: 13, fontWeight: '700' },
  sectionWarningButton: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF7ED', borderWidth: 1, borderColor: '#FDBA74' },
  sectionWarningIcon: { color: '#92400E', fontSize: 13, fontWeight: '900', lineHeight: 16 },
  sectionTooltip: { marginHorizontal: 16, marginTop: 8, alignSelf: 'flex-start', maxWidth: '92%', borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: '#FFF7ED', borderWidth: 1, borderColor: '#FDBA74' },
  sectionTooltipText: { color: '#92400E', fontSize: 12, lineHeight: 17, fontWeight: '600' },
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
  serviceCardFull: { width: '100%' },
  serviceCardHighlight: { backgroundColor: colors.rose, borderColor: '#E8C4D4', borderWidth: 1.5, shadowColor: colors.maroon, shadowOpacity: 0.1, shadowRadius: 9, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
  serviceBadge: { position: 'absolute', top: 10, right: 10, backgroundColor: colors.gold, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, zIndex: 2 },
  serviceBadgeText: { color: '#4A2C00', fontSize: 10, fontWeight: '800' },
  serviceIcon: { width: 50, height: 50, borderRadius: 12, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  serviceIconHighlight: { width: 52, height: 52, backgroundColor: colors.card },
  serviceIconText: { color: colors.maroon, fontSize: 27, lineHeight: 32, textAlign: 'center' },
  serviceTitle: { color: colors.ink, fontSize: 15, lineHeight: 19, fontWeight: '700', flexShrink: 1 },
  serviceTitleHighlight: { color: colors.maroon, fontSize: 16, fontWeight: '800' },
  serviceSub: { color: colors.muted, fontSize: 11, lineHeight: 15, marginTop: 2 },
  serviceSubHighlight: { color: colors.maroon, opacity: 0.75 },
  serviceArrow: { position: 'absolute', bottom: 12, right: 12, color: colors.maroon, opacity: 0.55, fontSize: 22, lineHeight: 22 },
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
    paddingTop: 8,
    paddingBottom: 8 + androidNavigationInset,
    backgroundColor: colors.maroon,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 6,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: -3 },
    elevation: 12,
  },
  navItem: { flex: 1, alignItems: 'center', justifyContent: 'flex-start', paddingVertical: 2 },
  navIconWrap: { width: 48, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', marginBottom: 3 },
  navIconWrapActive: { backgroundColor: 'rgba(255,255,255,0.18)' },
  navIcon: { color: 'rgba(255,255,255,0.85)', fontSize: 23, lineHeight: 28, textAlign: 'center' },
  navIconActive: { color: 'white' },
  navLabel: { color: 'rgba(255,255,255,0.7)', fontSize: 11.5, fontWeight: '700' },
  navLabelActive: { color: 'white' },
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
  listIcon: { fontSize: 28, lineHeight: 34, textAlign: 'center' },
  listTitle: { color: colors.ink, fontSize: 16, lineHeight: 20, fontWeight: '700', flexShrink: 1 },
  listSub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  chevron: { color: colors.muted, fontSize: 22 },
  infoBar: { backgroundColor: colors.rose, paddingHorizontal: 16, paddingVertical: 13, marginHorizontal: 16, marginTop: 8, borderRadius: 12, borderLeftWidth: 4, borderLeftColor: colors.maroon },
  infoText: { color: colors.maroon, fontSize: 14, lineHeight: 21, fontWeight: '500' },
  twoCol: { flexDirection: 'row', gap: 10, paddingHorizontal: 16 },
  fakeSelect: {
    height: 46,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
    paddingHorizontal: 14,
    marginHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  fakeSelectCompact: { height: 44, marginHorizontal: 0, paddingHorizontal: 12 },
  fakeSelectText: { color: colors.ink, fontSize: 15, flex: 1 },
  fakeSelectPlaceholder: { color: colors.muted },
  fieldHint: { color: colors.muted, fontSize: 12, marginHorizontal: 16, marginTop: 6, lineHeight: 17 },
  inRowInput: { marginHorizontal: 0, height: 44, fontSize: 14 },
  sectionHeadRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginHorizontal: 16, marginTop: 14, marginBottom: 2 },
  sectionHeadTitle: { color: colors.maroon, fontSize: 15, fontWeight: '800' },
  infoToggle: { width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: colors.muted, alignItems: 'center', justifyContent: 'center' },
  infoToggleActive: { backgroundColor: colors.maroon, borderColor: colors.maroon },
  infoToggleText: { color: colors.muted, fontSize: 13, fontWeight: '800', fontStyle: 'italic' },
  infoToggleTextActive: { color: 'white', fontStyle: 'normal' },
  weightRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16 },
  weightRowInput: { marginHorizontal: 0 },
  measureBtn: { height: 48, paddingHorizontal: 12, borderRadius: 10, backgroundColor: colors.bluePale, borderWidth: 1, borderColor: '#BBD3FB', alignItems: 'center', justifyContent: 'center' },
  measureBtnText: { color: colors.blue, fontSize: 13, fontWeight: '700' },
  uploadCompact: { marginHorizontal: 16, borderWidth: 2, borderStyle: 'dashed', borderColor: '#D8A4BC', backgroundColor: colors.rose, borderRadius: 12, minHeight: 84, alignItems: 'center', justifyContent: 'center' },
  thumbRow: { marginHorizontal: 16, marginTop: 10 },
  thumbWrap: { width: 84, height: 84, borderRadius: 10, marginRight: 10, overflow: 'hidden', position: 'relative' },
  thumb: { width: 84, height: 84, resizeMode: 'cover' },
  thumbRemove: { position: 'absolute', top: 2, right: 2, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(74,17,43,0.85)', alignItems: 'center', justifyContent: 'center' },
  thumbRemoveText: { color: 'white', fontSize: 15, fontWeight: '700', lineHeight: 17 },
  measureDiagram: { marginHorizontal: 16, marginTop: 10, backgroundColor: colors.rose, borderRadius: 12, padding: 14, alignItems: 'center' },
  measureDiagramArt: { fontSize: 30 },
  measureDiagramText: { color: colors.ink, fontSize: 13, lineHeight: 20, marginTop: 8 },
  unitToggle: { flexDirection: 'row', gap: 8, marginHorizontal: 16, marginTop: 12 },
  unitChip: { paddingVertical: 7, paddingHorizontal: 18, borderRadius: 999, borderWidth: 1, borderColor: colors.line, backgroundColor: '#FFFDFE' },
  unitChipActive: { backgroundColor: colors.maroon, borderColor: colors.maroon },
  unitChipText: { color: colors.muted, fontSize: 13, fontWeight: '700' },
  unitChipTextActive: { color: 'white' },
  summaryChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginHorizontal: 16, marginTop: 12 },
  summaryChip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999, backgroundColor: colors.rose, borderWidth: 1, borderColor: colors.line },
  summaryChipText: { color: colors.maroon, fontSize: 12, fontWeight: '700' },
  projTabBar: { flexDirection: 'row', marginHorizontal: 16, marginTop: 6, marginBottom: 4, backgroundColor: colors.rose, borderRadius: 12, padding: 4, gap: 4 },
  projTab: { flex: 1, paddingVertical: 9, borderRadius: 9, alignItems: 'center' },
  projTabActive: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
  projTabText: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  projTabTextActive: { color: colors.maroon },
  projTimelineTitle: { color: colors.muted, fontSize: 11, fontWeight: '800', textTransform: 'uppercase', marginTop: 14, marginBottom: 4 },
  projCard: { marginHorizontal: 16, marginTop: 12, padding: 0, overflow: 'hidden' },
  projImageWrap: { position: 'relative', width: '100%', height: 150, backgroundColor: colors.rose },
  projImage: { width: '100%', height: 150, resizeMode: 'cover' },
  projImagePlaceholder: { alignItems: 'center', justifyContent: 'center' },
  projImageEmoji: { fontSize: 44 },
  projTag: { position: 'absolute', top: 10, left: 10, backgroundColor: colors.maroon, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  projTagText: { color: 'white', fontSize: 11, fontWeight: '700' },
  projStatusPill: { position: 'absolute', top: 10, right: 10, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  projStatusOpen: { backgroundColor: colors.green },
  projStatusSoon: { backgroundColor: colors.blue },
  projStatusText: { color: 'white', fontSize: 11, fontWeight: '700' },
  projBody: { padding: 14 },
  projName: { color: colors.ink, fontSize: 16, fontWeight: '700' },
  projMeta: { color: colors.muted, fontSize: 12, marginTop: 4 },
  projSummary: { color: colors.ink, fontSize: 13, lineHeight: 19, marginTop: 6 },
  projStatsRow: { flexDirection: 'row', gap: 16, marginTop: 10 },
  projStat: {},
  projStatLabel: { color: colors.muted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  projStatValue: { color: colors.maroon, fontSize: 14, fontWeight: '700', marginTop: 2 },
  projOverview: { marginTop: 10, backgroundColor: colors.bluePale, borderRadius: 10, padding: 10 },
  projOverviewText: { color: '#1E40AF', fontSize: 12, lineHeight: 18 },
  projMineHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  projHealthBar: { height: 7, borderRadius: 7, backgroundColor: colors.line, overflow: 'hidden', marginTop: 10 },
  projHealthFill: { height: 7, borderRadius: 7, backgroundColor: colors.green },
  projStepText: { color: colors.ink, fontSize: 12, fontWeight: '700', marginTop: 6 },
  projStepsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  projStepItem: { flex: 1, alignItems: 'center', paddingHorizontal: 2 },
  projStepDot: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  projStepDotDone: { backgroundColor: colors.green },
  projStepDotCur: { backgroundColor: colors.maroon },
  projStepDotText: { color: 'white', fontSize: 12, fontWeight: '700' },
  projStepLabel: { color: colors.muted, fontSize: 10, textAlign: 'center', marginTop: 4 },
  projEmpty: { marginHorizontal: 16, marginTop: 16, padding: 18, backgroundColor: colors.rose, borderRadius: 14, alignItems: 'center', gap: 10 },
  projEmptyText: { color: colors.ink, fontSize: 14, textAlign: 'center' },
  tileDimmed: { opacity: 0.55 },
  tileIconDimmed: { opacity: 0.6 },
  gpsScreen: { flex: 1, backgroundColor: colors.cream, paddingHorizontal: 24, paddingTop: androidStatusBarInset + 24, justifyContent: 'space-between' },
  gpsHero: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  gpsHeroCircle: { width: 112, height: 112, borderRadius: 56, backgroundColor: colors.rose, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#E8C4D4' },
  gpsHeroEmoji: { fontSize: 52 },
  gpsTitle: { color: colors.maroon, fontSize: 24, fontWeight: '800', marginTop: 22, textAlign: 'center' },
  gpsSub: { color: colors.ink, fontSize: 15, lineHeight: 23, textAlign: 'center', marginTop: 12 },
  gpsPoints: { alignSelf: 'stretch', marginTop: 24, gap: 12 },
  gpsPoint: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.line, paddingVertical: 13, paddingHorizontal: 14 },
  gpsPointIcon: { fontSize: 22 },
  gpsPointText: { color: colors.ink, fontSize: 14, fontWeight: '600', flex: 1 },
  gpsBottom: { paddingBottom: 28, gap: 6 },
  gpsSkipBtn: { alignItems: 'center', paddingVertical: 10 },
  gpsSkipText: { color: colors.muted, fontSize: 14, fontWeight: '700' },
  gpsPrivacy: { color: colors.muted, fontSize: 12, textAlign: 'center', marginTop: 2 },
  regionCard: { marginTop: 14, backgroundColor: '#FBF4F8', borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: 14 },
  regionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  regionTitle: { color: colors.maroon, fontSize: 15, fontWeight: '800' },
  regionHint: { color: colors.muted, fontSize: 12, marginTop: 4, marginBottom: 4 },
  gpsBtn: { backgroundColor: colors.maroon, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7 },
  gpsBtnText: { color: 'white', fontSize: 12, fontWeight: '700' },
  regionGpsNote: { color: colors.green, fontSize: 12, fontWeight: '600', marginTop: 8 },
  geoRow: { flexDirection: 'row', gap: 8, marginTop: 8 },
  statusLoading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginHorizontal: 16, marginTop: 12, paddingVertical: 16, backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.line },
  statusLoadingText: { color: colors.muted, fontSize: 14, fontWeight: '600' },
  statusError: { marginHorizontal: 16, marginTop: 12, padding: 18, backgroundColor: '#FEF2F2', borderRadius: 14, borderWidth: 1, borderColor: '#FECACA', alignItems: 'center' },
  statusErrorIcon: { fontSize: 30 },
  statusErrorTitle: { color: colors.danger, fontSize: 16, fontWeight: '800', marginTop: 8 },
  statusErrorText: { color: '#7F1D1D', fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 6 },
  statusRetryBtn: { marginTop: 14, backgroundColor: colors.maroon, borderRadius: 999, paddingHorizontal: 22, paddingVertical: 10 },
  statusRetryText: { color: 'white', fontSize: 14, fontWeight: '700' },
  statusEmpty: { marginHorizontal: 16, marginTop: 12, padding: 18, backgroundColor: colors.rose, borderRadius: 14, alignItems: 'center' },
  statusEmptyText: { color: colors.ink, fontSize: 14, textAlign: 'center', lineHeight: 20 },
  crashScreen: { flex: 1, backgroundColor: colors.cream, alignItems: 'center', justifyContent: 'center', padding: 24 },
  crashCard: { backgroundColor: colors.card, borderRadius: 18, borderWidth: 1, borderColor: colors.line, padding: 26, alignItems: 'center', width: '100%', maxWidth: 360 },
  crashIcon: { fontSize: 52 },
  crashTitle: { color: colors.maroon, fontSize: 20, fontWeight: '800', marginTop: 12 },
  crashTitleEn: { color: colors.muted, fontSize: 14, fontWeight: '700', marginTop: 2 },
  crashMsg: { color: colors.ink, fontSize: 13, lineHeight: 19, textAlign: 'center', marginTop: 12 },
  crashDetail: { maxHeight: 180, alignSelf: 'stretch', marginTop: 10, borderRadius: 8, backgroundColor: '#FBF1F5', borderWidth: 1, borderColor: colors.line },
  crashDetailText: { color: '#7A1230', fontSize: 11, lineHeight: 16, fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace' },
  crashBtn: { marginTop: 18, backgroundColor: colors.maroon, borderRadius: 12, paddingHorizontal: 22, paddingVertical: 13, alignSelf: 'stretch', alignItems: 'center' },
  crashBtnText: { color: 'white', fontSize: 15, fontWeight: '700' },
  crashBtnOutline: { marginTop: 10, borderRadius: 12, borderWidth: 1.5, borderColor: colors.maroon, paddingVertical: 12, alignSelf: 'stretch', alignItems: 'center' },
  crashBtnOutlineText: { color: colors.maroon, fontSize: 14, fontWeight: '700' },
  reqStar: { color: colors.danger, fontWeight: '800' },
  labelSm: { fontSize: 13, marginTop: 10, marginBottom: 4, marginHorizontal: 0 },
  inputSm: { height: 44, borderRadius: 10, borderWidth: 1, borderColor: colors.line, backgroundColor: '#FFFDFE', paddingHorizontal: 12, fontSize: 14, color: colors.ink },
  inputLocked: { backgroundColor: '#F2E9EE', opacity: 0.85 },
  genderPillSm: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 10, borderWidth: 1, borderColor: colors.line, backgroundColor: '#FFFDFE' },
  formCard: { marginHorizontal: 16, marginTop: 12, backgroundColor: colors.card, borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: 14 },
  formCardTitle: { color: colors.maroon, fontSize: 14, fontWeight: '800', marginBottom: 4 },
  formCardTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  kycProjectBar: { marginHorizontal: 16, marginTop: 10, backgroundColor: colors.rose, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, borderLeftWidth: 4, borderLeftColor: colors.maroon },
  kycProjectLabel: { color: colors.muted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  kycProjectName: { color: colors.maroon, fontSize: 15, fontWeight: '800', marginTop: 2 },
  verifiedBanner: { backgroundColor: colors.greenPale, borderRadius: 10, paddingHorizontal: 11, paddingVertical: 9, marginVertical: 6, borderWidth: 1, borderColor: '#A7F3D0' },
  verifiedBannerText: { color: '#166534', fontSize: 12, lineHeight: 17, fontWeight: '600' },
  radioRow: { flexDirection: 'row', gap: 8, marginTop: 8, marginBottom: 4 },
  radioPill: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 9, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.line, backgroundColor: '#FFFDFE' },
  radioPillActive: { borderColor: colors.maroon, backgroundColor: colors.rose },
  radioDot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  radioDotActive: { borderColor: colors.maroon },
  radioDotInner: { width: 9, height: 9, borderRadius: 5, backgroundColor: colors.maroon },
  radioText: { color: colors.muted, fontSize: 14, fontWeight: '700' },
  radioTextActive: { color: colors.maroon },
  kycChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 8 },
  kycChip: { paddingVertical: 5, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1 },
  kycChip_green: { backgroundColor: colors.greenPale, borderColor: '#A7F3D0' },
  kycChip_gold: { backgroundColor: colors.goldPale, borderColor: '#F4D385' },
  kycChip_rose: { backgroundColor: '#FEF2F2', borderColor: '#FECACA' },
  kycChip_muted: { backgroundColor: colors.rose, borderColor: colors.line },
  kycChipText: { color: colors.ink, fontSize: 11, fontWeight: '700' },
  kycSummaryRow: { flexDirection: 'row', gap: 8, marginHorizontal: 16, marginTop: 6 },
  kycSummaryChip: { flex: 1, alignItems: 'center', borderRadius: 12, borderWidth: 1, paddingVertical: 10, paddingHorizontal: 4 },
  kycSummaryIcon: { fontSize: 20 },
  kycSummaryLabel: { color: colors.ink, fontSize: 12, fontWeight: '700', marginTop: 3 },
  kycSummaryStatus: { color: colors.muted, fontSize: 10, fontWeight: '600', marginTop: 1, textAlign: 'center' },
  kycDocThumbZoom: { position: 'absolute', right: 4, bottom: 4, width: 18, height: 18, borderRadius: 9, backgroundColor: 'rgba(74,17,43,0.8)', alignItems: 'center', justifyContent: 'center' },
  kycDocThumbZoomText: { color: 'white', fontSize: 11 },
  kycUpdateLink: { color: colors.blue, fontSize: 12, fontWeight: '700', marginTop: 4 },
  previewBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center', padding: 16 },
  previewImage: { width: '100%', height: '80%' },
  previewClose: { color: 'rgba(255,255,255,0.8)', fontSize: 13, marginTop: 14 },
  descHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginRight: 16 },
  descInput: { minHeight: 92, textAlignVertical: 'top', paddingTop: 10 },
  aiBtn: { backgroundColor: colors.bluePale, borderWidth: 1, borderColor: '#BBD3FB', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  aiBtnDisabled: { opacity: 0.5 },
  aiBtnText: { color: colors.blue, fontSize: 12, fontWeight: '700' },
  aiBtnBlock: { marginHorizontal: 16, marginTop: 2, marginBottom: 6, backgroundColor: colors.bluePale, borderWidth: 1, borderColor: '#BBD3FB', borderRadius: 11, paddingVertical: 11, alignItems: 'center' },
  aiBtnBlockText: { color: colors.blue, fontSize: 14, fontWeight: '800' },
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
  noteText: { color: colors.maroon, fontSize: 14, lineHeight: 21, fontWeight: '500' },
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
  productIcon: { width: 58, height: 58, borderRadius: 10, backgroundColor: colors.rose, textAlign: 'center', textAlignVertical: 'center', fontSize: 31, lineHeight: 58, overflow: 'hidden' },
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
  moduleIcon: { fontSize: 37, lineHeight: 44, textAlign: 'center' },
  // Training module (gamified) styles
  trainPointsCard: { flexDirection: 'row', alignItems: 'center', margin: 16, marginBottom: 8, backgroundColor: colors.maroon, borderRadius: 16, paddingVertical: 16 },
  trainPointsCol: { flex: 1, alignItems: 'center' },
  trainPointsValue: { color: 'white', fontSize: 22, fontWeight: '800' },
  trainPointsLabel: { color: 'rgba(255,255,255,0.8)', fontSize: 12, marginTop: 3 },
  trainPointsDivider: { width: 1, height: 34, backgroundColor: 'rgba(255,255,255,0.22)' },
  trainContinue: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginBottom: 6, backgroundColor: colors.green, borderRadius: 14, padding: 14 },
  trainContinueLabel: { color: 'rgba(255,255,255,0.85)', fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  trainContinueTitle: { color: 'white', fontSize: 15, fontWeight: '800', marginTop: 2 },
  trainContinueSub: { color: 'rgba(255,255,255,0.85)', fontSize: 12, marginTop: 1 },
  trainCatGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 12, paddingHorizontal: 16, paddingTop: 4 },
  trainCatCard: { width: '48%', backgroundColor: 'white', borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: 14 },
  trainCatCardHi: { borderColor: colors.maroon, borderWidth: 2, backgroundColor: colors.rose },
  trainCatEmoji: { fontSize: 32, lineHeight: 38, marginBottom: 6 },
  trainCatTitle: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  trainCatMeta: { color: colors.muted, fontSize: 11.5, marginTop: 4 },
  trainProgressTrack: { height: 6, borderRadius: 6, backgroundColor: '#EFE6EC', overflow: 'hidden', marginTop: 8, marginBottom: 4 },
  trainProgressFill: { height: '100%', backgroundColor: colors.green, borderRadius: 6 },
  subList: { paddingHorizontal: 16, paddingTop: 4, gap: 10 },
  subCard: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: 'white', borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: 13 },
  subEmojiWrap: { width: 46, height: 46, borderRadius: 13, backgroundColor: colors.rose, alignItems: 'center', justifyContent: 'center' },
  subEmoji: { fontSize: 24, lineHeight: 30 },
  subTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  subTitle: { color: colors.ink, fontSize: 15.5, fontWeight: '800', flexShrink: 1 },
  subSub: { color: colors.muted, fontSize: 12.5, marginTop: 2 },
  subMeta: { color: colors.maroon, fontSize: 11.5, fontWeight: '700', marginTop: 4 },
  levelChip: { backgroundColor: colors.goldPale, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  levelChipText: { color: '#92610C', fontSize: 10.5, fontWeight: '800' },
  contentList: { paddingHorizontal: 16, gap: 10 },
  contentCard: { flexDirection: 'row', gap: 12, backgroundColor: 'white', borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: 10 },
  contentThumb: { width: 70, height: 70, borderRadius: 11 },
  contentThumbFallback: { backgroundColor: colors.rose, alignItems: 'center', justifyContent: 'center' },
  contentTitle: { color: colors.ink, fontSize: 15, fontWeight: '800' },
  contentExcerpt: { color: colors.muted, fontSize: 12.5, lineHeight: 17, marginTop: 3 },
  contentMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 7 },
  pointPill: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: colors.goldPale, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3 },
  pointPillText: { color: '#92610C', fontSize: 11, fontWeight: '800' },
  pointPillRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, marginBottom: 4 },
  quizPill: { backgroundColor: colors.bluePale, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3 },
  quizPillText: { color: '#1D4ED8', fontSize: 11, fontWeight: '800' },
  donePill: { flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: colors.green, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 3 },
  donePillText: { color: 'white', fontSize: 11, fontWeight: '800' },
  readerImage: { width: '100%', height: 200 },
  readerBody: { paddingHorizontal: 18, paddingTop: 14 },
  readerKicker: { color: colors.maroon, fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  readerTitle: { color: colors.ink, fontSize: 22, fontWeight: '800', marginTop: 4, lineHeight: 28 },
  readerText: { color: colors.ink, fontSize: 15.5, lineHeight: 25, marginTop: 6 },
  readerStrong: { fontWeight: '800', color: colors.maroon },
  videoFrame: { backgroundColor: '#000', marginTop: 8 },
  videoFallback: { height: 210, alignItems: 'center', justifyContent: 'center' },
  videoHint: { color: colors.muted, fontSize: 12 },
  aiSummaryBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', backgroundColor: colors.rose, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginTop: 14 },
  aiSummaryBtnText: { color: colors.maroon, fontWeight: '800', fontSize: 13.5 },
  aiSummaryBlock: { backgroundColor: '#FBF6F9', borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: 14, marginTop: 12 },
  aiSummaryHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  aiSummaryTitle: { color: colors.maroon, fontSize: 15, fontWeight: '800' },
  aiReadBtn: { width: 36, height: 36, borderRadius: 12, backgroundColor: colors.rose, alignItems: 'center', justifyContent: 'center' },
  quizCard: { marginHorizontal: 16, marginTop: 12, backgroundColor: 'white', borderRadius: 14, borderWidth: 1, borderColor: colors.line, padding: 14 },
  quizQuestion: { color: colors.ink, fontSize: 15.5, fontWeight: '800', marginBottom: 10, lineHeight: 21 },
  quizOption: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.line, borderRadius: 11, padding: 12, marginBottom: 8 },
  quizOptionSel: { borderColor: colors.maroon, backgroundColor: colors.rose },
  quizRadio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
  quizRadioSel: { borderColor: colors.maroon, backgroundColor: colors.maroon },
  quizOptionText: { color: colors.ink, fontSize: 14.5, flexShrink: 1 },
  quizOptionTextSel: { fontWeight: '700', color: colors.maroon },
  quizResult: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 30 },
  quizResultIcon: { width: 90, height: 90, borderRadius: 45, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  quizResultScore: { color: colors.ink, fontSize: 40, fontWeight: '900' },
  quizResultText: { color: colors.ink, fontSize: 17, fontWeight: '700', textAlign: 'center', marginTop: 6 },
  quizResultSub: { color: colors.muted, fontSize: 14, textAlign: 'center', marginTop: 6, marginBottom: 20 },
  moduleTitle: { color: colors.ink, fontSize: 13, lineHeight: 17, fontWeight: '700', paddingHorizontal: 10, paddingTop: 10 },
  moduleSub: { color: colors.muted, fontSize: 11, paddingHorizontal: 10, marginTop: 2 },
  moduleCount: { color: colors.maroon, fontSize: 12, fontWeight: '700', padding: 10 },
  learningList: { paddingHorizontal: 16, paddingTop: 10, gap: 12 },
  learningCard: { backgroundColor: 'white', borderRadius: 16, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  learningThumb: { minHeight: 92, padding: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  learningBody: { padding: 14, paddingTop: 10 },
  learningMaterial: { flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: '#FBF8FA', borderRadius: 12, padding: 10, marginTop: 10 },
  learningMaterialIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'white', textAlign: 'center', textAlignVertical: 'center', overflow: 'hidden', color: colors.maroon, fontSize: 18, lineHeight: 36 },
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
  apiNotice: { marginHorizontal: 16, marginTop: 10, marginBottom: 4, padding: 13, borderRadius: 12, backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA', color: '#B91C1C', fontSize: 14, lineHeight: 20, fontWeight: '600' },
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
  filter: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F0EAEE' },
  filterActive: { backgroundColor: colors.maroon },
  filterText: { color: colors.muted, fontWeight: '700', fontSize: 13 },
  filterTextActive: { color: 'white' },
  communityHero: { margin: 16, marginBottom: 4, backgroundColor: colors.maroon, borderRadius: 16, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 13 },
  communityHeroIcon: { width: 46, height: 46, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' },
  communityHeroTitle: { color: 'white', fontSize: 20, fontWeight: '800' },
  communityHeroSub: { color: 'rgba(255,255,255,0.82)', fontSize: 12.5, marginTop: 2 },
  officerCallBtn: { width: 38, height: 38, borderRadius: 13, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  postAvatarText: { color: colors.maroon, fontWeight: '800', fontSize: 15 },
  postIconBtn: { width: 38, height: 38, borderRadius: 11, backgroundColor: colors.rose, alignItems: 'center', justifyContent: 'center' },
  postSubmitBtn: { backgroundColor: colors.maroon, paddingHorizontal: 16, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  postSubmitText: { color: 'white', fontWeight: '800', fontSize: 13 },
  postActionItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  postActionText: { color: colors.muted, fontWeight: '700', fontSize: 13 },
  search: { margin: 16, backgroundColor: 'white', borderRadius: 10, borderWidth: 1, borderColor: colors.line, flexDirection: 'row', alignItems: 'center', padding: 8 },
  searchIcon: { color: colors.muted, marginHorizontal: 8 },
  searchInput: { flex: 1, height: 36, backgroundColor: '#F7F3F5', borderRadius: 10, paddingHorizontal: 12, color: colors.ink },
  searchButton: { backgroundColor: colors.maroon, color: 'white', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, marginLeft: 8, overflow: 'hidden', fontWeight: '700' },
  officerRow: { flexDirection: 'row', gap: 12, alignItems: 'center', paddingVertical: 9 },
  avatar: { width: 42, height: 42, borderRadius: 12, backgroundColor: colors.rose, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.maroon, fontWeight: '700' },
  officerAction: { width: 38, height: 38, borderRadius: 14, backgroundColor: colors.rose, color: colors.maroon, textAlign: 'center', textAlignVertical: 'center', overflow: 'hidden', fontSize: 19 },
  postBox: { margin: 16, marginTop: 12, backgroundColor: 'white', borderRadius: 12, borderWidth: 1, borderColor: colors.line, padding: 10, flexDirection: 'row', gap: 8, alignItems: 'center' },
  postAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.rose, alignItems: 'center', justifyContent: 'center' },
  postInput: { flex: 1, height: 36, backgroundColor: '#F7F3F5', borderRadius: 10, paddingHorizontal: 12 },
  postButton: { backgroundColor: colors.maroon, color: 'white', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, overflow: 'hidden', fontWeight: '700' },
  postCard: { padding: 14 },
  postHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  postName: { color: colors.ink, fontSize: 16, fontWeight: '700' },
  postText: { color: colors.ink, fontSize: 15, lineHeight: 24, marginTop: 12 },
  postActions: { flexDirection: 'row', justifyContent: 'space-around', borderTopWidth: 1, borderColor: colors.line, marginTop: 12, paddingTop: 10 },
  postAction: { color: colors.muted, fontWeight: '700' },
  projectHero: { margin: 16, marginBottom: 8, backgroundColor: colors.maroon, borderRadius: 16, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 },
  projectHeroIcon: { width: 52, height: 52, borderRadius: 15, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center' },
  projectHeroEmoji: { color: 'white', fontSize: 25 },
  projectHeroTitle: { color: 'white', fontSize: 22, fontWeight: '700' },
  projectHeroSub: { color: 'rgba(255,255,255,0.76)', fontSize: 12, lineHeight: 18, marginTop: 4 },
  projectStatGrid: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, marginTop: 4 },
  projectStatCard: { width: '31.5%', minHeight: 78, backgroundColor: 'white', borderRadius: 12, borderWidth: 1, borderColor: colors.line, padding: 8, alignItems: 'center', justifyContent: 'center' },
  projectStatValue: { color: colors.maroon, fontSize: 18, fontWeight: '700' },
  projectStatLabel: { color: colors.muted, fontSize: 9, lineHeight: 12, textAlign: 'center', textTransform: 'uppercase', marginTop: 4 },
  projectDetailCard: { marginHorizontal: 16, marginTop: 8, backgroundColor: 'white', borderRadius: 16, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  projectDetailTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 16, backgroundColor: '#FFF7FA', borderBottomWidth: 1, borderBottomColor: colors.line },
  projectDetailName: { color: colors.ink, fontSize: 18, lineHeight: 23, fontWeight: '700' },
  projectDetailMeta: { color: colors.muted, fontSize: 12, marginTop: 4 },
  projectBalance: { alignItems: 'flex-end', minWidth: 76 },
  projectBalanceLabel: { color: colors.muted, fontSize: 11 },
  projectBalanceValue: { color: colors.maroon, fontSize: 17, fontWeight: '700', marginTop: 3 },
  projectHealthBar: { marginHorizontal: 16, marginTop: 16, height: 10, borderRadius: 10, backgroundColor: '#F3E8EE', overflow: 'hidden' },
  projectHealthFill: { height: 10, backgroundColor: colors.green },
  projectHealthText: { color: colors.ink, fontSize: 13, lineHeight: 18, marginHorizontal: 16, marginTop: 8, marginBottom: 10, fontWeight: '700' },
  projectProgressHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, marginTop: 12 },
  projectProgressBadge: { color: colors.maroon, fontSize: 12, fontWeight: '700', backgroundColor: colors.rose, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  projectStats: { backgroundColor: colors.maroon, flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 18, marginTop: 14 },
  ledgerCard: { padding: 0, overflow: 'hidden' },
  ledgerHead: { backgroundColor: colors.rose, padding: 16 },
  timeline: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', paddingVertical: 16, paddingHorizontal: 8 },
  timelineItem: { alignItems: 'center', width: 72 },
  timelineDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#E7E0E4', marginBottom: 8 },
  timelineDone: { backgroundColor: colors.maroon },
  timelineCurrent: { backgroundColor: colors.gold },
  connectedTimeline: { flexDirection: 'row', paddingHorizontal: 8, paddingTop: 16, paddingBottom: 20 },
  connectedStep: { flex: 1, alignItems: 'center', minHeight: 86 },
  timelineNodeRow: { flexDirection: 'row', alignItems: 'center', width: '100%', minHeight: 32 },
  timelineConnector: { flex: 1, height: 3, borderRadius: 3 },
  timelineConnectorGhost: { flex: 1, height: 3 },
  timelineConnectorDone: { backgroundColor: colors.green },
  timelineConnectorPending: { backgroundColor: '#E7E0E4' },
  timelineNode: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F7F3F5', borderWidth: 2, borderColor: '#E7E0E4', alignItems: 'center', justifyContent: 'center' },
  timelineNodeDone: { backgroundColor: colors.green, borderColor: colors.green },
  timelineNodeCurrent: { backgroundColor: colors.gold, borderColor: '#D97706' },
  timelineNodeText: { color: 'white', fontSize: 12, fontWeight: '700' },
  timelineNodeTextPending: { color: colors.muted },
  timelineText: { color: colors.muted, fontSize: 10, textAlign: 'center', lineHeight: 14, marginTop: 7, paddingHorizontal: 2, minHeight: 28 },
  timelineTextCurrent: { color: colors.ink, fontWeight: '700' },
  timelineStateText: { marginTop: 4, color: colors.muted, fontSize: 9, fontWeight: '700', textAlign: 'center' },
  timelineStateDone: { color: colors.green },
  timelineStateCurrent: { color: '#B45309' },
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
  menuIcon: { width: 42, height: 42, borderRadius: 11, backgroundColor: '#F0EAEE', color: colors.maroon, textAlign: 'center', textAlignVertical: 'center', overflow: 'hidden', fontSize: 21, lineHeight: 42 },
  menuTitle: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  menuSub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  languagePill: { minWidth: 48, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.maroon, alignItems: 'center' },
  languagePillText: { color: 'white', fontSize: 12, fontWeight: '700' },
  logout: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  logoutIcon: { color: colors.danger, fontSize: 24 },
  logoutTitle: { color: colors.danger, fontWeight: '700', fontSize: 16 },
  version: { color: colors.muted, fontSize: 11, textAlign: 'center', marginVertical: 16 },
});

