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
import { colors } from './src/theme/colors';
import { androidNavigationInset, androidStatusBarInset, styles } from './src/theme/styles';
import type {
  ApiRow, ApiState, AppRole, AuthUser, CattleAiResult, ChatMessage, Lang, LearnCat, LearnMod,
  ListingDraft, LocationState, MainTab, PreferenceKey, PreferenceOption, PreferenceSection,
  Screen, TrainingContentKind, TrainingModule, WeatherApiState,
  FinanceGrade, FinanceSummary, ReadinessQuestion, ReadinessResult, ConfidenceSignal,
  LoanProduct, LoanQuote, LoanDraft, RepaymentMode,
  CreditAssessment, AssessmentEnvelope, DevelopmentPlan, DevelopmentTask, AssessmentHistory,
  NarrativeChange, LoanAccountView, LoanArrears,
} from './src/types';
import {
  analyzeCattlePhoto, askShathiApaAudio, askShathiApaAudioWithTranscript, askShathiApaImage,
  askShathiApaImageFollowup, askShathiApaText, generateListingDescription, generateResponseSuggestions,
  friendlyAiError, isAiSpeaking, parseJsonArray, parseJsonObject, playAiSpeech, stopAiSpeech,
  summarizeMarkdown, toggleSpeech, withSuggestions,
} from './src/ai/gemini';
import {
  API_BASE_URL, API_CACHE_PREFIX, SERVER_FALLBACK_MESSAGE, WEATHERAPI_KEY, WEATHERAPI_LOCATION,
  apiCreate, apiList, apiRequest, apiUrl, authHeaders, loadingStore, naturalApiError, refreshStore,
  setApiAuthToken, setAuthExpiredHandler, staleStore, uploadImage, weatherApiUrl,
} from './src/api/client';
import {
  GRADE_COLORS, GRADE_TINTS, financeLabel, resolveActionLink, GUIDANCE_TOPICS,
  REPAYMENT_MODES, PENDING_ACTION_LABEL, parseDigits,
} from './src/finance/helpers';



// Draft for the livestock "List for Sale" flow (form -> measure -> price).
function makeLoanDraft(): LoanDraft {
  return {
    product: null,
    amount: 0,
    tenureMonths: 12,
    repaymentMode: 'monthly',
    purposeCode: 'livestock_purchase',
    purposeText: '',
    quote: null,
    consented: false,
    needsCorrection: false,
    correctionNote: '',
  };
}

// Cattle is traded in two currencies of weight: buyers and traders quote LIVE
// weight, farmers and beparis quote MEAT weight. They are the same animal at a
// dressing yield, so the form takes either and fills the other. 50% is the
// working yield for local cattle — the server's pricing rule carries the real
// figure and overrides this once a quote comes back.
const DEFAULT_DRESSING_PCT = 50;

/** Trims a computed weight to one decimal without a trailing ".0". */
function weightText(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '';
  return String(Math.round(value * 10) / 10);
}

function meatFromLive(live: string, dressingPct = DEFAULT_DRESSING_PCT): string {
  const n = Number(live);
  if (!n || n <= 0) return '';
  return weightText((n * dressingPct) / 100);
}

function liveFromMeat(meat: string, dressingPct = DEFAULT_DRESSING_PCT): string {
  const n = Number(meat);
  if (!n || n <= 0 || dressingPct <= 0) return '';
  return weightText((n * 100) / dressingPct);
}

function makeListingDraft(): ListingDraft {
  return {
    categorySlug: 'livestock',
    animalId: null, animalName: '', species: null,
    breedId: null, breedName: '',
    saleItemId: null, saleItemName: '', variety: '', unit: 'kg',
    ageMonths: '24', weightKg: '', meatWeightKg: '', quantity: '1',
    description: '', aiGenerating: false, images: [],
    divisionId: null, divisionName: '', districtId: null, districtName: '',
    thanaId: null, thanaName: '', thanaOther: false,
    contactSelf: true, contactName: '', contactPhone: '', contactNid: '', addressText: '', measure: null,
  };
}

const preferenceOrder: PreferenceKey[] = ['cattle', 'crops', 'fishery', 'vegetables', 'fruits'];


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
      // The bottom nav is absolutely positioned, so without this the last card
      // on every screen using RefreshScroll sits underneath it — which is what
      // cut off the foot of the readiness result. A caller passing its own
      // contentContainerStyle still wins.
      contentContainerStyle={[styles.refreshScrollContent, contentContainerStyle]}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[colors.maroon]} tintColor={colors.maroon} />}
    >
      {children}
    </ScrollView>
  );
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

function useStaleState() {
  const [snapshot, setSnapshot] = useState({ count: staleStore.resources.size, fails: staleStore.failedRefreshes, lastError: staleStore.lastError });
  useEffect(
    () =>
      staleStore.subscribe(() =>
        setSnapshot({ count: staleStore.resources.size, fails: staleStore.failedRefreshes, lastError: staleStore.lastError })
      ),
    []
  );
  return snapshot;
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
        if (!alive) return;
        setState({ rows, loading: false, error: null });
        staleStore.clear(resource);
        staleStore.resetFailures();
        // Persist the last good response so the app still works offline next time.
        AsyncStorage.setItem(API_CACHE_PREFIX + resource, JSON.stringify(rows)).catch(() => {});
      })
      .catch(async (error) => {
        let cached: T[] = [];
        try {
          const raw = await AsyncStorage.getItem(API_CACHE_PREFIX + resource);
          if (raw) cached = JSON.parse(raw) as T[];
        } catch {
          cached = [];
        }
        if (!alive) return;
        const friendly = naturalApiError(error, lang);
        if (cached.length > 0) staleStore.mark(resource, friendly);
        setState({ rows: cached, loading: false, error: friendly, stale: cached.length > 0 });
      });
    return () => {
      alive = false;
      // Leaving the screen: its stale mark must not keep the global banner alive.
      staleStore.clear(resource);
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
        if (!alive) return;
        setState({ data: json.data ?? null, loading: false });
        staleStore.clear(resource);
        staleStore.resetFailures();
        AsyncStorage.setItem(API_CACHE_PREFIX + resource, JSON.stringify(json.data ?? null)).catch(() => {});
      })
      .catch(async (error) => {
        // Fall back to the last good home payload so the dashboard never blanks out.
        let cached: ApiRow | null = null;
        try {
          const raw = await AsyncStorage.getItem(API_CACHE_PREFIX + resource);
          if (raw) cached = JSON.parse(raw) as ApiRow;
        } catch {
          cached = null;
        }
        if (!alive) return;
        if (cached) staleStore.mark(resource, naturalApiError(error, lang));
        setState({ data: cached, loading: false });
      });
    return () => {
      alive = false;
      staleStore.clear(resource);
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
        <View style={styles.statusLoadingSpinner}>
          <ActivityIndicator color={colors.maroon} size="small" />
        </View>
        <Text style={styles.statusLoadingText}>{tx('তথ্য আনা হচ্ছে…', 'Loading…')}</Text>
      </View>
    );
  }
  if (state.error && state.rows.length > 0) {
    // Cached data is on screen — show a slim notice, not a scary error block.
    return (
      <View style={styles.statusStale}>
        <Text style={styles.statusStaleText}>📡 {tx('সার্ভারে পৌঁছানো যায়নি — সংরক্ষিত তথ্য দেখানো হচ্ছে', 'Server unreachable — showing saved data')}</Text>
        <Pressable onPress={() => refreshStore.trigger()} hitSlop={8}>
          <Text style={styles.statusStaleRefresh}>↻ {tx('রিফ্রেশ', 'Refresh')}</Text>
        </Pressable>
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

// Slim global banner shown only while a visible list is serving cached data after
// a failed server fetch. Hides itself the moment a refresh succeeds (or the screen
// changes). After repeated failed refreshes it shows the exact underlying error.
const STALE_DETAIL_AFTER = 3;

function StaleBanner() {
  const { tx } = useLanguage();
  const { count, fails, lastError } = useStaleState();
  if (count === 0) return null;
  const showDetail = fails >= STALE_DETAIL_AFTER && !!lastError;
  return (
    <View style={styles.staleBanner}>
      <View style={styles.flex}>
        <Text style={styles.staleBannerText} numberOfLines={1}>
          📡 {tx('সার্ভার থেকে আনা যায়নি — আগের তথ্য দেখানো হচ্ছে', 'Server fetch failed — showing previous data')}
        </Text>
        {showDetail ? (
          <Text style={styles.staleBannerDetail} numberOfLines={2}>
            {tx('কারণ', 'Cause')}: {lastError}
          </Text>
        ) : null}
      </View>
      <Pressable
        onPress={() => {
          staleStore.noteRefreshAttempt();
          refreshStore.trigger();
        }}
        style={({ pressed }) => [styles.staleBannerBtn, pressed && styles.pressed]}
      >
        <Text style={styles.staleBannerBtnText}>↻ {tx('রিফ্রেশ', 'Refresh')}</Text>
      </Pressable>
    </View>
  );
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


function Card({ children, style, onPress }: { children: React.ReactNode; style?: object; onPress?: () => void }) {
  if (onPress) {
    return <Pressable onPress={onPress} style={({ pressed }) => [styles.card, style, pressed && styles.pressed]}>{children}</Pressable>;
  }
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
        <StaleBanner />
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
  // Finance state is hoisted here for the same reason ListingDraft is: there is
  // no navigation stack, so anything that must survive a screen change lives in
  // the root and is passed down.
  const [loanDraft, setLoanDraft] = useState<LoanDraft>(makeLoanDraft);
  const [readinessPart, setReadinessPart] = useState<'core' | 'deep'>('core');
  const [readinessResult, setReadinessResult] = useState<ReadinessResult | null>(null);
  const [guidanceTopic, setGuidanceTopic] = useState<string>('clear_arrears');
  const [loanSubmission, setLoanSubmission] = useState<ApiRow | null>(null);
  const patchLoanDraft = useCallback(
    (patch: Partial<LoanDraft>) => setLoanDraft((current) => ({ ...current, ...patch })),
    [],
  );
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
  const [buyCategory, setBuyCategory] = useState<ApiRow | null>(null);
  const [buyInitialTab, setBuyInitialTab] = useState<'shop' | 'orders'>('shop');
  const [latestOrder, setLatestOrder] = useState<ApiRow | null>(null);
  const [latestListing, setLatestListing] = useState<ApiRow | null>(null);
  const [latestApplication, setLatestApplication] = useState<ApiRow | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  // Which listing / application the progress trail is showing.
  const [progressListingId, setProgressListingId] = useState<string | null>(null);
  const [progressApplicationId, setProgressApplicationId] = useState<string | null>(null);
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
        // Restore the token into the fetch helpers before the first request below,
        // otherwise app/me goes out unauthenticated and comes back 401.
        setApiAuthToken(parsed.token ?? null);
        // Refresh onboarding gates from the server, then route accordingly.
        try {
          const me = await apiRequest<{ data?: AuthUser }>('app/me');
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
        setApiAuthToken(token);
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
        setApiAuthToken(null);
        await AsyncStorage.removeItem(AUTH_STORAGE_KEY);
        setScreen('onboarding');
        setOnboarding(0);
      },
    }),
    [authUser, authToken],
  );

  // Let the fetch helpers drop us back to login when the server rejects our token.
  useEffect(() => {
    setAuthExpiredHandler(() => {
      authValue.signOut().catch(() => {});
    });
    return () => setAuthExpiredHandler(null);
  }, [authValue]);

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

  // The app has no navigation stack — every screen hardcodes its own back
  // target. That is fine while there is one way into a screen, and wrong the
  // moment a readiness action deep-links into, say, KYC documents: back then
  // dropped the farmer on Profile, miles from the result they were working
  // through. `returnTo` records the screen that sent them, and only the screens
  // that can be deep-linked into consult it.
  const [returnTo, setReturnTo] = useState<Screen | null>(null);
  const goFrom = (from: Screen, next: Screen) => { setReturnTo(from); setScreen(next); };
  const goBackTo = (fallback: Screen) => {
    const target = returnTo ?? fallback;
    setReturnTo(null);
    setScreen(target);
  };
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
      home: <Home setScreen={go} openProjects={(t) => { setProjectsInitialTab(t); go('projects'); }} openBuy={(t) => { setBuyInitialTab(t); go('buyCategories'); }} />,
      weather: <WeatherPage setScreen={go} />,
      community: <Community setScreen={go} />,
      projects: (
        <Projects
          setScreen={go}
          initialTab={projectsInitialTab}
          onApply={(id) => { setSelectedProjectId(id); go('kyc'); }}
          onOpenApplication={(id) => { setProgressApplicationId(id); go('projectProgress'); }}
        />
      ),
      profile: <Profile setScreen={go} />,
      menuPersonal: <PersonalInfo onDone={() => goBackTo('profile')} />,
      menuBanking: <BankingScreen setScreen={(next) => (next === 'profile' ? goBackTo('profile') : go(next))} />,
      menuFarm: <FarmScreen setScreen={(next) => (next === 'profile' ? goBackTo('profile') : go(next))} />,
      menuKyc: <KycScreen setScreen={(next) => (next === 'profile' ? goBackTo('profile') : go(next))} />,
      menuFaq: <FaqScreen setScreen={go} />,
      marketUpdates: <MarketUpdates setScreen={go} onSelect={(id) => { setSelectedMarketId(id); go('marketDetail'); }} />,
      marketDetail: <MarketDetail setScreen={go} id={selectedMarketId} />,
      officers: <OfficersScreen setScreen={go} />,
      financeReadinessIntro: <FinanceReadinessIntro setScreen={go} />,
      financeReadinessQuiz: (
        <FinanceReadinessQuiz
          setScreen={go}
          part={readinessPart}
          onFinished={(result) => { setReadinessResult(result); go('financeReadinessResult'); }}
        />
      ),
      financeReadinessResult: (
        <FinanceReadinessResult
          setScreen={go}
          result={readinessResult}
          onContinuePart2={() => { setReadinessPart('deep'); go('financeReadinessQuiz'); }}
          onOpenSheet={(topic) => { setGuidanceTopic(topic); go('financeGuidanceSheet'); }}
          onNavigateAway={(next) => goFrom('financeReadinessResult', next)}
        />
      ),
      financeGuidanceSheet: <FinanceGuidanceSheet setScreen={go} topic={guidanceTopic} />,
      financeHub: (
        <FinanceHub
          setScreen={go}
          onPickProduct={() => go('loanApplyType')}
          onSelectProduct={(product) => {
            patchLoanDraft({
              product,
              amount: Number(product.min_amount) || 0,
              tenureMonths: product.allowed_tenures[0] ?? 12,
              repaymentMode: (product.allowed_repayment_modes[0] as RepaymentMode) ?? 'monthly',
              quote: null,
            });
            go('loanApplyDetails');
          }}
        />
      ),
      loanApplyType: (
        <LoanApplyType
          setScreen={go}
          onSelect={(product) => {
            patchLoanDraft({
              product,
              amount: Number(product.min_amount) || 0,
              tenureMonths: product.allowed_tenures[0] ?? 12,
              repaymentMode: (product.allowed_repayment_modes[0] as RepaymentMode) ?? 'monthly',
              quote: null,
            });
            go('loanApplyDetails');
          }}
        />
      ),
      loanApplyDetails: <LoanApplyDetails setScreen={go} draft={loanDraft} patchDraft={patchLoanDraft} />,
      loanSchedulePreview: <LoanSchedulePreview setScreen={go} draft={loanDraft} />,
      loanApplyProfile: <LoanApplyProfile setScreen={go} draft={loanDraft} patchDraft={patchLoanDraft} />,
      loanApplyConsent: (
        <LoanApplyConsent
          setScreen={go}
          draft={loanDraft}
          onSubmitted={(result) => { setLoanSubmission(result); setLoanDraft(makeLoanDraft()); }}
        />
      ),
      loanApplyDone: <LoanApplyDone setScreen={go} result={loanSubmission} />,
      loanStatus: <LoanStatus setScreen={go} />,
      loanResult: (
        <LoanResult
          setScreen={go}
          onOpenSheet={(topic) => { setGuidanceTopic(topic); go('financeGuidanceSheet'); }}
        />
      ),
      developmentPlan: (
        <DevelopmentPlanScreen
          setScreen={go}
          onOpenSheet={(topic) => { setGuidanceTopic(topic); go('financeGuidanceSheet'); }}
          onNavigateAway={(next) => goFrom('developmentPlan', next)}
        />
      ),
      assessmentHistory: <AssessmentHistoryScreen setScreen={go} />,
      loanAccount: <LoanAccountScreen setScreen={go} />,
      saleCategories: <SaleCategories setScreen={go} patchDraft={patchDraft} />,
      livestock: <Livestock setScreen={go} />,
      cattleForm: <CattleForm setScreen={go} draft={listingDraft} patchDraft={patchDraft} />,
      cattleMeasure: <CattleMeasure setScreen={go} draft={listingDraft} patchDraft={patchDraft} />,
      cattlePrice: <CattlePrice setScreen={go} draft={listingDraft} patchDraft={patchDraft} onSubmitted={setLatestListing} />,
      cattleDone: (
        <CattleDone
          setScreen={go}
          listing={latestListing}
          onSeeProgress={() => {
            if (latestListing?.id) setProgressListingId(String(latestListing.id));
            go(latestListing?.id ? 'listingProgress' : 'myListings');
          }}
        />
      ),
      inputsForm: <InputsForm setScreen={go} draft={listingDraft} patchDraft={patchDraft} />,
      inputsPrice: <InputsPrice setScreen={go} draft={listingDraft} patchDraft={patchDraft} onSubmitted={setLatestListing} />,
      myListings: <MyListings setScreen={go} onOpenProgress={(id) => { setProgressListingId(id); go('listingProgress'); }} />,
      listingProgress: <ListingProgress setScreen={go} listingId={progressListingId} />,
      myProjects: <MyProjects setScreen={go} onOpen={(id) => { setProgressApplicationId(id); go('projectProgress'); }} />,
      projectProgress: <ProjectProgress setScreen={go} applicationId={progressApplicationId} />,
      buyCategories: <BuyCategories setScreen={go} initialTab={buyInitialTab} onSelectCategory={(c) => { setBuyCategory(c); go('buyProducts'); }} />,
      buyProducts: <BuyProducts setScreen={go} category={buyCategory} onSelectProduct={setSelectedProduct} />,
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
      regDone: (
        <RegDone
          setScreen={go}
          application={latestApplication}
          onSeeProgress={() => {
            if (latestApplication?.id) setProgressApplicationId(String(latestApplication.id));
            go(latestApplication?.id ? 'projectProgress' : 'myProjects');
          }}
        />
      ),
      inactive: <Inactive setScreen={go} />,
    };

    return routes[screen];
  // Every piece of state a screen in this map reads must be listed here.
  // The finance screens were added without their state, so `loanDraft` and the
  // readiness values were captured once and never refreshed: tapping a tenure or
  // a repayment mode updated the state and re-rendered nothing, and a consent
  // checkbox could be ticked but never cleared. A missing dependency here does
  // not fail loudly — it silently freezes a screen's props.
  }, [screen, onboarding, weight, qty, cattleImage, listingDraft, selectedPreferenceCategories, livestockPrefs, cropPrefs, fishPrefs, vegetablePrefs, fruitPrefs, learnCategory, learnModule, learnContentId, apaMessages, apaImageUri, apaBusy, lang, selectedProduct, buyCategory, buyInitialTab, latestOrder, latestListing, latestApplication, selectedProjectId, progressListingId, progressApplicationId, projectsInitialTab, authUser, selectedMarketId, loanDraft, readinessPart, readinessResult, guidanceTopic, loanSubmission, returnTo]);

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

function Home({ setScreen, openProjects, openBuy }: { setScreen: (screen: Screen) => void; openProjects: (tab: 'all' | 'area' | 'mine') => void; openBuy: (tab: 'shop' | 'orders') => void }) {
  const { tx, lang } = useLanguage();
  const { user } = useAuth();
  const home = useAppHome(user?.id);
  const users = useApiList<ApiRow>('users');
  const liveWeather = useWeatherApi();
  const market = useApiList<ApiRow>('market-updates');
  const homeUser = user || (shouldUseFallback(users) ? fallbackProfileUser : users.rows[0]);
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
      {/* The listings / orders / earnings band is withdrawn until the figures
          behind it are trustworthy — three tiles reading zero taught the farmer
          nothing and pushed the one number that does mean something below the
          fold. The readiness passport takes the slot instead. */}
      <FinancePassportCard setScreen={setScreen} />
      <SectionTitle title={tx('সেবাসমূহ', 'Services')} />
      <View style={styles.serviceGrid}>
        <ServiceCard icon="🏷️" title={tx('বিক্রির তালিকা', 'List for Sale')} sub={tx('পশু ও কৃষি পণ্য বিক্রি', 'Sell livestock & produce')} tone="rose" highlight onPress={() => setScreen('saleCategories')} />
        <ServiceCard icon="🛒" title={tx('শাথী থেকে কিনুন', 'Buy from Shathi')} sub={tx('বীজ, ফিড, সার ও আরও', 'Seeds, feed, fertilizer & more')} tone="gold" highlight onPress={() => openBuy('shop')} />
        <ServiceCard icon="🎓" title={tx('প্রশিক্ষণ মডিউল', 'Training Modules')} sub={tx('ভিডিও ও বিশেষজ্ঞ পরামর্শ', 'Videos & expert advice')} tone="blue" onPress={() => setScreen('training')} />
        <ServiceCard icon="🏦" title={tx('ঋণের আবেদন', 'Apply for Loan')} sub={tx('ঋণের ধরন, কিস্তি ও আবেদন', 'Loan types, instalments & applying')} tone="green" onPress={() => setScreen('financeHub')} />
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

// Retained unused: the home metrics band is withdrawn, not deleted, and this
// is the tile it will come back as.
function MetricCard({ value, label, icon, tone, onPress }: { value: string; label: string; icon: string; tone: 'rose' | 'blue' | 'green'; onPress?: () => void }) {
  const accent = tone === 'blue' ? colors.blue : tone === 'green' ? colors.green : colors.maroon;
  const chip = tone === 'blue' ? colors.bluePale : tone === 'green' ? colors.greenPale : colors.rose;
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.metricCard, pressed && onPress ? styles.pressed : null]}>
      <View style={[styles.metricIcon, { backgroundColor: chip }]}><Text style={styles.metricIconText}>{icon}</Text></View>
      <Text style={[styles.metricValue, { color: accent }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </Pressable>
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
    if (isAiSpeaking()) {
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
  const { user } = useAuth();
  const initial = String(user?.display_name || user?.full_name || 'S').trim().charAt(0).toUpperCase() || 'S';
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
          <Text style={styles.userAvatarText}>{initial}</Text>
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
  const [tab, setTab] = useState<'cats' | 'mine'>('cats');
  useEffect(() => {
    let alive = true;
    const uid = user?.id ? `?user_id=${encodeURIComponent(String(user.id))}` : '';
    apiRequest<{ data?: { available?: string[] } }>(`app/sale/category-availability${uid}`)
      .then((j) => { if (alive) setAvailable(j.data?.available ?? []); })
      // Leave it unknown on failure. Treating a failed lookup as "nothing is
      // available" greys out every tile on the screen, which is the same thing
      // the farmer sees when the platform genuinely does not serve their area —
      // an outage should not be indistinguishable from a coverage decision.
      .catch(() => {});
    return () => { alive = false; };
  }, [user?.id]);

  function startListing(category: ApiRow) {
    const slug = String(category.slug || '').toLowerCase();
    // `is_active = 0` in the admin is what takes a category off the market —
    // the screen must honour it, not just the hard-coded slug list.
    const live = String(category.status || 'active') === 'active';
    const isLivestock = live && (slug.includes('livestock') || slug.includes('cattle') || slug.includes('poultry'));
    const isInputs = live && slug === 'inputs';
    patchDraft({ categorySlug: slug, animalId: null, animalName: '', species: null, breedId: null, breedName: '', saleItemId: null, saleItemName: '', variety: '', weightKg: '', meatWeightKg: '', quantity: '1', description: '', images: [], measure: null });
    setScreen(isLivestock ? 'cattleForm' : isInputs ? 'inputsForm' : 'inactive');
  }

  function renderTile(category: ApiRow) {
    const slug = String(category.slug || '').toLowerCase();
    const interestSlug = String(category.interest_slug || '');
    const catKey = interestSlug || slug; // inputs/machinery projects use the slug as interest_slug
    const live = String(category.status || 'active') === 'active';
    const isLivestock = slug.includes('livestock') || slug.includes('cattle') || slug.includes('poultry');
    const isInputs = slug === 'inputs';
    const built = live && (isLivestock || isInputs);
    const hasProject = available === null ? built : available.includes(catKey);
    const enabled = built && hasProject;
    const emoji = category.emoji
      || (isLivestock ? '🐄' : slug.includes('crop') ? '🌾' : slug.includes('fish') ? '🐟' : slug.includes('veg') ? '🥬' : slug.includes('fruit') ? '🥭' : slug.includes('mach') ? '🚜' : isInputs ? '🌱' : '🌿');
    const sub = !live
      ? tx('আপাতত বন্ধ', 'Not available right now')
      : !hasProject
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
      <View style={styles.projTabBar}>
        <Pressable onPress={() => setTab('cats')} style={[styles.projTab, tab === 'cats' && styles.projTabActive]}>
          <Text style={[styles.projTabText, tab === 'cats' && styles.projTabTextActive]}>{tx('বিভাগসমূহ', 'Categories')}</Text>
        </Pressable>
        <Pressable onPress={() => setTab('mine')} style={[styles.projTab, tab === 'mine' && styles.projTabActive]}>
          <Text style={[styles.projTabText, tab === 'mine' && styles.projTabTextActive]}>{tx('আমার তালিকা', 'My Listings')}</Text>
        </Pressable>
      </View>
      {tab === 'cats' ? (
        <>
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
      ) : (
        <MyListingsBody setScreen={setScreen} />
      )}
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
          <ChoiceSelect compact value={selectedAnimalLabel} placeholder={tx('ধরন', 'Type')} items={animalItems} onSelect={selectAnimal} />
        </View>
        <View style={styles.flex}>
          <FormLabel label={tx('জাত', 'Breed')} required />
          <ChoiceSelect compact value={draft.breedName} placeholder={tx('জাত', 'Breed')} items={breedItems} onSelect={selectBreed} disabled={!draft.animalId} />
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

      <View style={styles.twoCol}>
        <View style={styles.flex}>
          <FormLabel label={tx('আনুমানিক জীবিত ওজন (কেজি)', 'Tentative live weight (kg)')} required />
          <TextInput style={[styles.input, styles.inRowInput]} value={draft.weightKg} onChangeText={(v) => patchDraft({ weightKg: v, meatWeightKg: meatFromLive(v) })} keyboardType="number-pad" placeholder={tx('যেমন ২০০', 'e.g. 200')} placeholderTextColor={colors.muted} />
        </View>
        <View style={styles.flex}>
          <FormLabel label={tx('আনুমানিক মাংসের ওজন (কেজি)', 'Tentative meat weight (kg)')} />
          <TextInput style={[styles.input, styles.inRowInput]} value={draft.meatWeightKg} onChangeText={(v) => patchDraft({ meatWeightKg: v, weightKg: liveFromMeat(v) })} keyboardType="number-pad" placeholder={tx('যেমন ১০০', 'e.g. 100')} placeholderTextColor={colors.muted} />
        </View>
      </View>
      <Pressable onPress={() => setScreen('cattleMeasure')} style={({ pressed }) => [styles.measureBtn, styles.measureBtnWide, pressed && styles.pressed]}>
        <Text style={styles.measureBtnText}>📏 {tx('ফিতা দিয়ে মাপুন', 'Measure by tape')}</Text>
      </Pressable>
      <Text style={styles.fieldHint}>{tx('যেকোনো একটি ঘরে লিখুন — অন্যটি নিজে থেকেই হিসাব হবে (ড্রেসিং ৫০%, জীবিত ওজন = ২ × মাংসের ওজন)। ব্যাপারী ও ক্রেতারা জীবিত ওজনে, কৃষক ও বেপারীরা মাংসের ওজনে দর করেন।', 'Fill either box — the other is worked out for you (50% dressing, live weight = 2 × meat weight). Traders and buyers deal in live weight; farmers and beparis deal in meat weight.')}</Text>
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
    patchDraft({ weightKg: String(weightKg), meatWeightKg: meatFromLive(String(weightKg)), measure: { girth, length, height, weightKg } });
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
  // Same rule as ChoiceSelect: a handful of short options belong on the screen,
  // not behind a sheet. Payment method (cash / bkash / nagad / bank) is the case
  // this exists for.
  const chipItems = (options ?? []).map((option) => ({ id: option, label: option }));
  if (onChange && autoChips(chipItems)) {
    return <ChipSelect value={value} items={chipItems} onSelect={(item) => onChange(item.id)} disabled={disabled} />;
  }
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

/**
 * A row of choice chips.
 *
 * `PickerSelect` opens a modal sheet, which is the right shape for a long list
 * (494 upazilas) but the wrong one for three short words. Seed / Feed /
 * Fertilizer as chips are visible without any interaction and cost one tap
 * rather than three, which matters most for the users who find modals hardest.
 *
 * `autoChips` below is what decides which of the two a call site gets, so the
 * rule lives in one place rather than being re-judged at every picker.
 */
function ChipSelect({ value, items, onSelect, disabled = false, compact = false }: {
  value?: string;
  items: { id: string; label: string; disabled?: boolean; raw?: any }[];
  onSelect: (item: any) => void;
  disabled?: boolean;
  /** Already inside a padded container (a card, or a two-column row). */
  compact?: boolean;
}) {
  return (
    <View style={[styles.chipRow, compact && styles.chipRowCompact]}>
      {items.map((item) => {
        const selected = item.label === value || item.id === value;
        const off = disabled || item.disabled;
        return (
          <Pressable
            key={item.id}
            disabled={off}
            onPress={() => onSelect(item)}
            accessibilityRole="button"
            accessibilityState={{ selected, disabled: off }}
            style={({ pressed }) => [
              styles.chipOption,
              selected && styles.chipOptionActive,
              off && styles.chipOptionDisabled,
              pressed && !off && styles.pressed,
            ]}
          >
            <Text style={[
              styles.chipOptionText,
              selected && styles.chipOptionTextActive,
              off && styles.chipOptionTextDisabled,
            ]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Chips only when they will actually fit and read well: at most four options,
 * each short enough that two or three sit on a line. Anything longer stays a
 * dropdown, because a chip row that wraps to four lines is worse than a sheet.
 */
function autoChips(items: { label: string }[]): boolean {
  if (items.length === 0 || items.length > 4) return false;
  return items.every((item) => item.label.length <= 18);
}

/**
 * Picks the right control for the option list it is given. Call sites use this
 * instead of PickerSelect wherever the list may be short.
 */
function ChoiceSelect({ value, placeholder, items, onSelect, disabled = false, compact = false }: {
  value?: string;
  placeholder: string;
  items: { id: string; label: string; disabled?: boolean; raw?: any }[];
  onSelect: (item: any) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  if (autoChips(items)) {
    return <ChipSelect value={value} items={items} onSelect={onSelect} disabled={disabled} compact={compact} />;
  }
  return <PickerSelect value={value} placeholder={placeholder} items={items} onSelect={onSelect} disabled={disabled} compact={compact} />;
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
    ['🤳', tx('ব্যবহারকারীর ছবি', 'User Photo'), kyc.selfie],
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
    if (Number(draft.meatWeightKg) > 0) params.set('meat_weight', draft.meatWeightKg);
    apiRequest<{ data?: ApiRow }>(`app/sale/price-quote?${params.toString()}`)
      .then((json) => { if (alive) setQuote(json.data?.breakdown ?? null); })
      .catch(() => { if (alive) setQuote(null); })
      .finally(() => { if (alive) setQuoteLoading(false); });
    return () => { alive = false; };
  }, [draft.animalId, draft.breedId, district, w, draft.meatWeightKg]);

  // Every figure below is per kg of LIVE weight — that is the basis the rule is
  // written on. The meat rate beside it is the same money restated at the
  // dressing yield, for farmers who only ever think in meat weight.
  const b2bRate = Number(quote?.b2b_market_rate ?? 0) || 400;
  const dressingPct = Number(quote?.dressing_pct ?? 0) || DEFAULT_DRESSING_PCT;
  const b2bMeatRate = Number(quote?.b2b_meat_rate ?? 0) || (b2bRate * 100) / dressingPct;
  const platformFee = Number(quote?.platform_fee ?? 0);
  const platformPct = quote?.platform_fee_pct === null || quote?.platform_fee_pct === undefined ? null : Number(quote.platform_fee_pct);
  const logisticsFee = Number(quote?.logistics_fee ?? 0);
  const vetFee = Number(quote?.warehouse_vet_fee ?? 0);
  const farmerRate = Number(quote?.net_farmer_rate ?? 0) || b2bRate - platformFee - logisticsFee - vetFee;
  const farmerMeatRate = (farmerRate * 100) / dressingPct;
  const meatW = Number(draft.meatWeightKg) || (w * dressingPct) / 100;
  const rows: Array<[string, string, number, boolean]> = [
    [tx('B2B বাজার দর', 'B2B market rate'), tx(`মাংসের দরে ৳${num(b2bMeatRate, 'bn')}/কেজি`, `৳${num(b2bMeatRate, 'en')}/kg on meat weight`), b2bRate, false],
    [tx('প্ল্যাটফর্ম চার্জ', 'Platform fee'), platformPct ? tx(`জীবিত ওজনের দামের ${num(platformPct, 'bn')}%`, `${num(platformPct, 'en')}% of the live weight amount`) : '', -platformFee, false],
    [tx('লজিস্টিক্স ও পরিবহন', 'Logistics & transport'), tx('প্রতি কেজি জীবিত ওজনে', 'Per kg live weight'), -logisticsFee, false],
    [tx('গুদাম ও পশু চিকিৎসা', 'Warehouse & vet care'), tx('প্রতি কেজি জীবিত ওজনে', 'Per kg live weight'), -vetFee, false],
    [tx('নিট কৃষক মূল্য', 'Net farmer rate'), tx(`আপনি পাবেন — মাংসের দরে ৳${num(farmerMeatRate, 'bn')}/কেজি`, `Your selling rate — ৳${num(farmerMeatRate, 'en')}/kg on meat weight`), farmerRate, true],
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
        user_id: Number(user?.id) || undefined,
        sale_item_id: 1,
        animal_id: draft.animalId ? Number(draft.animalId) : undefined,
        breed_id: draft.breedId ? Number(draft.breedId) : undefined,
        title_en: `${draft.animalName || 'Livestock'} listing from mobile app`,
        title_bn: 'মোবাইল অ্যাপ থেকে পশুর তালিকা',
        description: draft.description || undefined,
        age_months: Number(draft.ageMonths) || undefined,
        weight_kg: w,
        meat_weight_kg: Number(draft.meatWeightKg) || undefined,
        dressing_pct: dressingPct,
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
          <Text style={styles.smallUpper}>{tx('জীবিত ওজন', 'Live weight')}</Text>
          <View style={styles.weightInputRow}>
            <TextInput style={styles.weightInput} value={draft.weightKg} onChangeText={(v) => patchDraft({ weightKg: v, meatWeightKg: meatFromLive(v, dressingPct) })} keyboardType="number-pad" />
            <Text style={styles.kgText}>{tx('কেজি', 'kg')}</Text>
          </View>
        </View>
        <View style={styles.flex}>
          <Text style={styles.smallUpper}>{tx('মাংসের ওজন', 'Meat weight')}</Text>
          <View style={styles.weightInputRow}>
            <TextInput style={styles.weightInput} value={draft.meatWeightKg} onChangeText={(v) => patchDraft({ meatWeightKg: v, weightKg: liveFromMeat(v, dressingPct) })} keyboardType="number-pad" />
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
          <Text style={styles.priceHeadSub}>{tx(`সব দর প্রতি কেজি জীবিত ওজনে · ড্রেসিং ${num(dressingPct, 'bn')}%`, `All rates per kg live weight · ${num(dressingPct, 'en')}% dressing`)}</Text>
        </View>
        <View style={styles.priceColumns}>
          <Text style={[styles.colLabel, styles.flex]}>{tx('বিবরণ', 'Item')}</Text>
          <Text style={styles.colLabel}>{tx('/কেজি', '/kg')}</Text>
          <Text style={styles.colLabel}>{tx('মোট', 'Total')} ({num(w, lang)} {tx('কেজি', 'kg')})</Text>
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
            <Text style={styles.finalSub}>৳{num(farmerRate, lang)} × {num(w, lang)} {tx('কেজি জীবিত ওজন', 'kg live')} · {tx('বা', 'or')} ৳{num(farmerMeatRate, lang)} × {num(meatW, lang)} {tx('কেজি মাংস', 'kg meat')}</Text>
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

function CattleDone({ setScreen, listing, onSeeProgress }: { setScreen: (screen: Screen) => void; listing: ApiRow | null; onSeeProgress: () => void }) {
  const { tx } = useLanguage();
  return (
    <SuccessScreen
      icon="✓"
      title={tx('তালিকা জমা হয়েছে!', 'Listing Submitted!')}
      headerTitle={tx('তালিকা জমা', 'Listing Submitted')}
      onBack={() => setScreen('home')}
      refNo={listing?.listing_code || 'SHT-APP'}
      desc={tx('মাঠ কর্মকর্তা ৩ কর্মদিনের মধ্যে যোগাযোগ করবেন।', 'Field officer will contact you within 3 working days.')}
      action={() => setScreen('home')}
      primary={{ title: tx('অগ্রগতি দেখুন', 'See progress'), onPress: onSeeProgress }}
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
          <ChoiceSelect compact value={selectedLabel} placeholder={tx('ধরন', 'Type')} items={inputItems} onSelect={(item) => patchDraft({ saleItemId: item.id, saleItemName: item.raw.name_en || '', unit: 'kg' })} />
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
        user_id: Number(user?.id) || undefined,
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

function buyCategoryIcon(slug: string) {
  return slug.includes('mach') ? '🚜' : slug.includes('tool') ? '🔧' : slug.includes('medicine') ? '💊'
    : slug.includes('fertilizer') ? '🧪' : slug.includes('seed') ? '🌱' : slug.includes('livestock') ? '🐄'
    : slug.includes('produce') || slug.includes('crop') ? '🌾' : slug.includes('feed') ? '🌽'
    : slug.includes('fish') ? '🐟' : slug.includes('veg') ? '🥬' : slug.includes('fruit') ? '🥭' : '🛒';
}

// Buyer-facing order status labels (plain language, not backend enum tokens).
function orderStatusBadge(s: string, tx: (bn: string, en: string) => string): { label: string; tone: 'green' | 'gold' | 'rose' | 'blue' } {
  if (s === 'placed') return { label: tx('স্টক যাচাইয়ের অপেক্ষায়', 'Awaiting stock check'), tone: 'gold' };
  if (s === 'confirmed') return { label: tx('নিশ্চিত হয়েছে', 'Confirmed'), tone: 'green' };
  if (s === 'assigned' || s === 'in_transit') return { label: tx('ডেলিভারির পথে', 'On the way'), tone: 'blue' };
  if (s === 'delivered') return { label: tx('ডেলিভারি সম্পন্ন', 'Delivered'), tone: 'green' };
  return { label: tx('বাতিল', 'Cancelled'), tone: 'rose' };
}

// Visual fulfilment progress: Placed -> Confirmed -> On the way -> Delivered.
function OrderProgress({ status }: { status: string }) {
  const { tx } = useLanguage();
  if (status === 'cancelled') return null;
  const stageIndex = status === 'placed' ? 0 : status === 'confirmed' ? 1 : status === 'assigned' || status === 'in_transit' ? 2 : 3;
  const steps = [tx('গৃহীত', 'Placed'), tx('নিশ্চিত', 'Confirmed'), tx('পথে', 'On way'), tx('ডেলিভারি', 'Delivered')];
  return (
    <View style={styles.orderProgress}>
      {steps.map((label, i) => (
        <View key={label} style={styles.orderProgressStep}>
          {i > 0 ? <View style={[styles.orderProgressLine, i <= stageIndex && styles.orderProgressLineDone]} /> : null}
          <View style={[styles.orderProgressDot, i <= stageIndex && styles.orderProgressDotDone]}>
            <Text style={[styles.orderProgressDotText, i <= stageIndex && styles.orderProgressDotTextDone]}>{i < stageIndex ? '✓' : ''}</Text>
          </View>
          <Text style={[styles.orderProgressLabel, i <= stageIndex && styles.orderProgressLabelDone]} numberOfLines={1}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

function BuyCategories({ setScreen, onSelectCategory, initialTab = 'shop' }: { setScreen: (screen: Screen) => void; onSelectCategory: (category: ApiRow) => void; initialTab?: 'shop' | 'orders' }) {
  const { tx, lang } = useLanguage();
  const { user } = useAuth();
  const [tab, setTab] = useState<'shop' | 'orders'>(initialTab);
  useEffect(() => { setTab(initialTab); }, [initialTab]);
  const mainCats = useApiList<ApiRow>('sale/categories');
  const buyCats = useApiList<ApiRow>('buy/categories');
  const uid = user?.id ? `?user_id=${encodeURIComponent(String(user.id))}` : '';
  const myOrders = useApiList<ApiRow>(`app/orders/mine${uid}`);

  // Availability: which preference (interest) categories actually have products.
  const countByInterest: Record<string, number> = {};
  for (const c of buyCats.rows) {
    const key = String(c.interest_slug || '');
    if (key) countByInterest[key] = (countByInterest[key] || 0) + Number(c.product_count || 0);
  }
  const mainRows = (shouldUseFallback(mainCats) ? fallbackSaleCategories : mainCats.rows);
  const withAvail = mainRows.map((c) => {
    const key = String(c.interest_slug || c.slug || '');
    return { cat: c, key, count: countByInterest[key] || 0 };
  });
  const availableFirst = [...withAvail].sort((a, b) => (b.count > 0 ? 1 : 0) - (a.count > 0 ? 1 : 0));

  return (
    <>
      <Header title={tx('শাথী থেকে কিনুন', 'Buy from Shathi')} onBack={() => setScreen('home')} />
      <View style={styles.projTabBar}>
        <Pressable onPress={() => setTab('shop')} style={[styles.projTab, tab === 'shop' && styles.projTabActive]}>
          <Text style={[styles.projTabText, tab === 'shop' && styles.projTabTextActive]}>{tx('কিনুন', 'Shop')}</Text>
        </Pressable>
        <Pressable onPress={() => setTab('orders')} style={[styles.projTab, tab === 'orders' && styles.projTabActive]}>
          <Text style={[styles.projTabText, tab === 'orders' && styles.projTabTextActive]}>{tx('আমার অর্ডার', 'My Orders')}</Text>
        </Pressable>
      </View>

      {tab === 'shop' ? (
        <>
          <View style={styles.deliveryBanner}>
            <Text style={styles.deliveryText}>{tx('🚚 দ্রুত ডেলিভারি ১-৩ দিন · ৳৫০০+ অর্ডারে বিনামূল্যে', '🚚 Fast delivery 1-3 days · Free over ৳500')}</Text>
          </View>
          <SectionTitle title={tx('বিভাগ অনুযায়ী কিনুন', 'Shop by category')} warning={fallbackWarning(mainCats)} />
          {mainCats.loading || buyCats.loading ? <ApiStatus state={mainCats.loading ? mainCats : buyCats} /> : null}
          <View style={styles.grid}>
            {availableFirst.map(({ cat, key, count }) => {
              const active = count > 0;
              const emoji = String(cat.emoji || '') || buyCategoryIcon(key);
              return (
                <Pressable
                  key={String(cat.id || cat.slug)}
                  disabled={!active}
                  onPress={() => onSelectCategory({ ...cat, interest_slug: key })}
                  style={({ pressed }) => [styles.catCard, !active && styles.catCardInactive, pressed && styles.pressed]}
                >
                  <Text style={styles.catCardIcon}>{emoji}</Text>
                  <Text style={styles.catCardTitle} numberOfLines={1}>{rowTitle(cat, lang, tx('বিভাগ', 'Category'))}</Text>
                  {active
                    ? <Text style={styles.catCardCount}>{num(count, lang)} {tx('পণ্য', 'items')}</Text>
                    : <Text style={styles.catCardCountMuted}>{tx('এখন কোনো পণ্য নেই', 'No items right now')}</Text>}
                </Pressable>
              );
            })}
          </View>
        </>
      ) : (
        <>
          {myOrders.loading ? <ApiStatus state={myOrders} /> : null}
          {!myOrders.loading && myOrders.rows.length === 0 ? (
            <View style={styles.projEmpty}>
              <Text style={styles.projEmptyIcon}>🛒</Text>
              <Text style={styles.projEmptyTitle}>{tx('এখনো কোনো অর্ডার নেই', 'No orders yet')}</Text>
              <Text style={styles.projEmptyText}>{tx('পছন্দের পণ্য অর্ডার করুন — অনুমোদনের পর ডেলিভারি হবে।', 'Order products you need — delivery follows confirmation.')}</Text>
            </View>
          ) : null}
          {myOrders.rows.map((o) => {
            const badge = orderStatusBadge(String(o.fulfillment_status || 'placed'), tx);
            return (
              <View key={String(o.id)} style={styles.orderCard}>
                <View style={styles.orderCardTop}>
                  <Text style={styles.orderCardCode}>{String(o.order_code)}</Text>
                  <Badge label={badge.label} tone={badge.tone} />
                </View>
                <Text style={styles.orderCardItems} numberOfLines={2}>{String(o.items_summary || '')}</Text>
                <OrderProgress status={String(o.fulfillment_status || 'placed')} />
                <View style={styles.orderCardFoot}>
                  <Text style={styles.orderCardDate}>{new Date(String(o.created_at)).toLocaleDateString()}</Text>
                  <Text style={styles.orderCardTotal}>{amount(Number(o.payable_amount || 0), lang)}</Text>
                </View>
                {String(o.fulfillment_status) === 'placed' ? (
                  <Text style={styles.orderCardHint}>{tx('ⓘ স্টক যাচাইয়ের পর অর্ডার নিশ্চিত করা হবে।', 'ⓘ Your order will be confirmed after our stock check.')}</Text>
                ) : null}
              </View>
            );
          })}
        </>
      )}
    </>
  );
}

function BuyProducts({ setScreen, category, onSelectProduct }: { setScreen: (screen: Screen) => void; category: ApiRow | null; onSelectProduct: (product: ApiRow) => void }) {
  const { tx, lang } = useLanguage();
  const interest = category?.interest_slug ? String(category.interest_slug) : '';
  const slug = !interest && category?.slug ? String(category.slug) : '';
  const products = useApiList<ApiRow>(interest ? `buy/products?interest=${interest}` : slug ? `buy/products?category=${slug}` : 'buy/products');
  const [query, setQuery] = useState('');
  const productRows = shouldUseFallback(products) ? fallbackBuyProducts : products.rows;
  const q = query.trim().toLowerCase();
  const filtered = q ? productRows.filter((p) => `${p.name_en || ''} ${p.name_bn || ''} ${p.short_description_en || ''}`.toLowerCase().includes(q)) : productRows;
  const title = category ? rowTitle(category, lang, tx('পণ্য', 'Products')) : tx('সব পণ্য', 'All products');
  return (
    <>
      <Header title={title} onBack={() => setScreen('buyCategories')} />
      <View style={styles.buySearch}>
        <Text style={styles.buySearchIcon}>🔍</Text>
        <TextInput style={styles.buySearchInput} value={query} onChangeText={setQuery} placeholder={tx('পণ্য খুঁজুন', 'Search products')} placeholderTextColor={colors.muted} />
        {query ? <Pressable onPress={() => setQuery('')} hitSlop={8}><Text style={styles.buySearchClear}>×</Text></Pressable> : null}
      </View>
      {products.loading ? <ApiStatus state={products} empty={tx('কোনো পণ্য পাওয়া যায়নি।', 'No products are available.')} /> : null}
      {!products.loading && filtered.length === 0 ? <Text style={styles.buyEmpty}>{tx('কোনো পণ্য মেলেনি।', 'No products match your search.')}</Text> : null}
      {filtered.map((product) => {
        const available = product.status === 'active';
        const lowStock = Number(product.stock_qty || 0) <= Number(product.low_stock_threshold || -1);
        const img = product.image_url ? String(product.image_url) : '';
        return (
          <Pressable
            key={product.id || product.sku}
            disabled={!available}
            onPress={() => { onSelectProduct(product); setScreen('buyOrder'); }}
            style={[styles.buyCard, !available && styles.disabledCard]}
          >
            {img
              ? <Image source={{ uri: img }} style={styles.buyCardImage} />
              : <View style={styles.buyCardImagePh}><Text style={styles.buyCardImagePhText}>{buyCategoryIcon(slug || interest)}</Text></View>}
            <View style={styles.buyCardBody}>
              <Text style={styles.productTitle} numberOfLines={1}>{rowTitle(product, lang, tx('পণ্য', 'Product'))}</Text>
              {rowBody(product, lang, '') ? <Text style={styles.productSub} numberOfLines={2}>{rowBody(product, lang, '')}</Text> : null}
              {product.package_size ? <Text style={styles.buyCardPack}>{String(product.package_size)}</Text> : null}
              <View style={styles.buyCardFoot}>
                <Text style={[styles.productPrice, !available && styles.mutedPrice]}>{amount(Number(product.price || 0), lang)}<Text style={styles.unit}> /{product.unit || tx('একক', 'unit')}</Text></Text>
                <Badge label={!available ? tx('মজুদ নেই', 'Out of stock') : lowStock ? tx('কম মজুদ', 'Low stock') : tx('মজুদ আছে', 'In stock')} tone={available ? 'green' : 'rose'} />
              </View>
            </View>
          </Pressable>
        );
      })}
    </>
  );
}

type SpecRow = { label_en?: string; label_bn?: string; value_en?: string; value_bn?: string; value?: string };
type VaccinationRow = { name_en?: string; name_bn?: string; given_on?: string; due_on?: string; status?: string };

function pickLang(lang: Lang, bn?: string, en?: string): string {
  return String((lang === 'bn' ? bn || en : en || bn) || '');
}

/** Two-column fact table used for cattle specs and feed nutrition alike. */
function SpecTable({ title, rows }: { title: string; rows: SpecRow[] }) {
  const { lang } = useLanguage();
  if (!rows.length) return null;
  return (
    <Card style={styles.orderInfoCard}>
      <Text style={styles.orderSectionTitle}>{title}</Text>
      {rows.map((row, i) => (
        <View key={`${row.label_en || i}`} style={[styles.specRow, i === rows.length - 1 && styles.specRowLast]}>
          <Text style={styles.specLabel}>{pickLang(lang, row.label_bn, row.label_en)}</Text>
          <Text style={styles.specValue}>{row.value !== undefined ? String(row.value) : pickLang(lang, row.value_bn, row.value_en)}</Text>
        </View>
      ))}
    </Card>
  );
}

function VaccinationChart({ rows }: { rows: VaccinationRow[] }) {
  const { tx, lang } = useLanguage();
  if (!rows.length) return null;
  return (
    <Card style={styles.orderInfoCard}>
      <Text style={styles.orderSectionTitle}>{tx('টিকার রেকর্ড', 'Vaccination chart')}</Text>
      {rows.map((row, i) => {
        // "done" is the record of a dose given; the due date is the next one.
        const done = String(row.status || 'done') === 'done';
        return (
          <View key={`${row.name_en || i}`} style={[styles.vaccRow, i === rows.length - 1 && styles.specRowLast]}>
            <View style={styles.flex}>
              <Text style={styles.vaccName}>{pickLang(lang, row.name_bn, row.name_en)}</Text>
              <Text style={styles.vaccMeta}>
                {[row.given_on ? tx(`দেওয়া হয়েছে ${formatDate(row.given_on, lang)}`, `Given ${formatDate(row.given_on, lang)}`) : '',
                  row.due_on ? tx(`পরবর্তী ${formatDate(row.due_on, lang)}`, `Next due ${formatDate(row.due_on, lang)}`) : ''].filter(Boolean).join(' · ')}
              </Text>
            </View>
            <Badge label={done ? tx('সম্পন্ন', 'Done') : tx('বাকি', 'Due')} tone={done ? 'green' : 'gold'} />
          </View>
        );
      })}
    </Card>
  );
}

/**
 * Everything the seed carries beyond name and price: the digital ear-tag id, the
 * spec table, the vaccination chart for cattle, and the nutrition / ingredient
 * detail for feed. Rendered from `metadata`, so a product without them simply
 * shows nothing rather than an empty frame.
 */
function ProductDetailBlocks({ product }: { product: ApiRow | null }) {
  const { tx, lang } = useLanguage();
  if (!product) return null;
  const metadata = parseMaybeJson(product.metadata);
  const specs = (Array.isArray(metadata.specs) ? metadata.specs : []) as SpecRow[];
  const nutrition = (Array.isArray(metadata.nutrition) ? metadata.nutrition : []) as SpecRow[];
  const vaccinations = (Array.isArray(metadata.vaccinations) ? metadata.vaccinations : []) as VaccinationRow[];
  const digitalPrefix = metadata.digital_id_prefix ? String(metadata.digital_id_prefix) : '';
  const purpose = pickLang(lang, metadata.purpose_bn as string, metadata.purpose_en as string);
  const ingredients = pickLang(lang, metadata.ingredients_bn as string, metadata.ingredients_en as string);
  const benefits = pickLang(lang, metadata.benefits_bn as string, metadata.benefits_en as string);
  const mrpPerKg = Number(metadata.mrp_per_kg || 0);

  return (
    <>
      {digitalPrefix ? (
        <Card style={styles.digitalIdCard}>
          <View style={styles.flex}>
            <Text style={styles.smallUpper}>{tx('ডিজিটাল পরিচিতি', 'Digital identification')}</Text>
            {/* The ear tag is issued per animal at dispatch; the listing can only
                honestly show the series it comes from. */}
            <Text style={styles.digitalIdCode}>{digitalPrefix}-••••</Text>
            <Text style={styles.digitalIdHint}>{tx('প্রতিটি পশুর কানের ট্যাগ নম্বর সরবরাহের সময় দেওয়া হয়।', 'Each animal’s ear-tag number is issued on dispatch.')}</Text>
          </View>
          <Text style={styles.digitalIdIcon}>🏷️</Text>
        </Card>
      ) : null}
      {purpose ? (
        <View style={[styles.noteBlue, styles.noteSpaced]}>
          <Text style={styles.noteText}>{purpose}</Text>
        </View>
      ) : null}
      {mrpPerKg > 0 ? (
        <View style={[styles.noteGold, styles.noteSpaced]}>
          <Text style={styles.noteText}>{tx(`এমআরপি ৳${num(mrpPerKg, 'bn')}/কেজি`, `MRP ৳${num(mrpPerKg, 'en')}/kg`)}</Text>
        </View>
      ) : null}
      <SpecTable title={tx('পশুর বিবরণ', 'Animal details')} rows={specs} />
      <SpecTable title={tx('পুষ্টিমান', 'Nutrition')} rows={nutrition} />
      <VaccinationChart rows={vaccinations} />
      {ingredients ? (
        <Card style={styles.orderInfoCard}>
          <Text style={styles.orderSectionTitle}>{tx('উপাদান', 'Ingredients')}</Text>
          <Text style={styles.orderDescription}>{ingredients}</Text>
        </Card>
      ) : null}
      {benefits ? (
        <Card style={styles.orderInfoCard}>
          <Text style={styles.orderSectionTitle}>{tx('উপকারিতা', 'Benefits')}</Text>
          <Text style={styles.orderDescription}>{benefits}</Text>
        </Card>
      ) : null}
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
  const productImage = String(product?.image_url || metadata.image_url || '');
  async function submitOrder() {
    if (!product) {
      setSubmitError(tx('অর্ডারের জন্য আগে একটি পণ্য নির্বাচন করুন।', 'Please select a product before placing an order.'));
      return;
    }
    setSubmitting(true);
    setSubmitError('');
    try {
      // One call, one transaction. This used to create the order header and its
      // line item as two independent requests: a failure between them left an
      // order with nothing in it, which the buyer could neither see nor cancel.
      const orderResponse = await apiCreate('app/orders', {
        user_id: Number(user?.id) || undefined,
        delivery_fee: 0,
        payment_method: paymentMethod,
        delivery_address: address,
        district: user?.district || null,
        upazila: user?.upazila || null,
        notes: 'Placed from mobile app.',
        items: [
          {
            product_id: Number(product.id),
            quantity: qty,
            unit_price: unitPrice,
          },
        ],
      });
      const placed = (orderResponse as any).result ?? {};
      onOrdered({
        id: placed.order_id,
        order_code: placed.order_code,
        payable_amount: placed.payable_amount ?? total,
      });
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
      {/* With a photo the card stacks: a full-width image cannot share a row
          with the copy, and putting it there collapsed the copy column to zero
          width, wrapping its text one character per line and stretching the
          card to a screen and a half of cream. Without a photo the original
          side-by-side tile is still right. */}
      <Card style={[styles.orderHeroCard, productImage ? styles.orderHeroCardStacked : null]}>
        {productImage ? (
          <Image source={{ uri: productImage }} style={styles.orderProductPhoto} resizeMode="cover" />
        ) : (
          <View style={styles.orderProductVisual}>
            <Text style={styles.orderProductEmoji}>🐄</Text>
            <Text style={styles.orderSackText}>{rowTitle(product || undefined, lang, tx('পণ্য', 'Product'))}</Text>
            <Text style={styles.orderSackWeight}>{product?.package_size || product?.unit || ''}</Text>
          </View>
        )}
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
      <ProductDetailBlocks product={product} />
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
      desc={tx(`${bn(qty)} × ${rowTitle(product || undefined, 'bn', 'পণ্য')} অর্ডার গৃহীত হয়েছে। স্টক যাচাইয়ের পর নিশ্চিত করা হবে — 'আমার অর্ডার'-এ অবস্থা দেখুন।`, `${num(qty, lang)} × ${rowTitle(product || undefined, 'en', 'Product')} order placed. We will confirm it after a quick stock check — track it in My Orders.`)}
      action={() => setScreen('home')}
      gold
    />
  );
}

// ── Training module (gamified: categories > subcategories > content) ──────────


async function learnFetch<T = any>(path: string): Promise<T> {
  const json = await apiRequest<{ data: T }>(path);
  return json.data;
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
        user_id: Number(user?.id) || undefined,
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

function RegDone({ setScreen, application, onSeeProgress }: { setScreen: (screen: Screen) => void; application: ApiRow | null; onSeeProgress: () => void }) {
  const { tx } = useLanguage();
  return (
    <SuccessScreen
      icon="🤝"
      title={tx('আবেদন জমা হয়েছে!', 'Application Submitted!')}
      headerTitle={tx('আবেদন জমা', 'Application Submitted')}
      onBack={() => setScreen('projects')}
      refNo={application?.application_code || 'REG-APP'}
      desc={tx('পর্যালোচনা হচ্ছে। মাঠ কর্মকর্তা ৫ কর্মদিনে যোগাযোগ করবেন।', 'Review is in progress. Field officer will contact within 5 working days.')}
      action={() => setScreen('home')}
      primary={{ title: tx('প্রকল্পের অগ্রগতি দেখুন', 'See project progress'), onPress: onSeeProgress }}
      gold
    />
  );
}

function Community({ setScreen }: { setScreen: (screen: Screen) => void }) {
  const { tx, lang } = useLanguage();
  const { user } = useAuth();
  const district = user?.district ? `?district=${encodeURIComponent(user.district)}` : '';
  const [feedFilter, setFeedFilter] = useState<'regional' | 'mine' | 'listings' | 'all'>('regional');
  const feedQs = [
    user?.district ? `district=${encodeURIComponent(String(user.district))}` : '',
    feedFilter !== 'regional' ? `filter=${feedFilter}` : '',
    feedFilter === 'mine' && user?.id ? `user_id=${encodeURIComponent(String(user.id))}` : '',
  ].filter(Boolean).join('&');
  const posts = useApiList<ApiRow>(`community/posts${feedQs ? '?' + feedQs : ''}`);
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
        user_id: Number(user?.id) || undefined,
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
      <View style={styles.feedFilterRow}>
        {([
          ['regional', tx('আঞ্চলিক', 'Regional')],
          ['mine', tx('আমার পোস্ট', 'My posts')],
          ['listings', tx('বিক্রির তালিকা', 'Sale listings')],
          ['all', tx('সব', 'All')],
        ] as Array<['regional' | 'mine' | 'listings' | 'all', string]>).map(([key, label]) => (
          <Pressable key={key} onPress={() => setFeedFilter(key)} style={[styles.feedFilterChip, feedFilter === key && styles.feedFilterChipActive]}>
            <Text style={[styles.feedFilterText, feedFilter === key && styles.feedFilterTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>
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
          highlight={Number(post.is_listing ?? 0) === 1}
          onViewListing={Number(post.is_listing ?? 0) === 1 ? () => setScreen('buyCategories') : undefined}
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

function Post({ name, tag, text, likes, comments, meta, image, official, highlight, onViewListing }: { name: string; tag: string; text: string; likes: string; comments: string; meta?: string; image?: string; official?: boolean; highlight?: boolean; onViewListing?: () => void }) {
  const { tx } = useLanguage();
  return (
    <Card style={[styles.postCard, official && styles.officialCard, highlight && styles.listingPostCard]}>
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
      {onViewListing ? (
        <Pressable onPress={onViewListing} style={({ pressed }) => [styles.listingPostBtn, pressed && styles.pressed]}>
          <Text style={styles.listingPostBtnText}>🛒 {tx('শাথী থেকে কিনুন-এ দেখুন', 'View in Buy from Shathi')}</Text>
        </Pressable>
      ) : null}
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
  // A project can be withdrawn from the market while the farmers already in it
  // carry on. `is_active = 0` closes new applications; it does not close the
  // project.
  const acceptingApplications = Number(project.is_active ?? 1) === 1 && project.status === 'open';
  const open = acceptingApplications;
  const modelLine = lang === 'bn' ? String(project.model_bn || project.model_en || '') : String(project.model_en || '');
  const incomeLabel = lang === 'bn' ? String(project.income_label_bn || '') : String(project.income_label_en || '');
  const capacityLabel = lang === 'bn' ? String(project.capacity_label_bn || '') : String(project.capacity_label_en || '');
  const loanPartners = lang === 'bn' ? String(project.loan_partners_bn || project.loan_partners_en || '') : String(project.loan_partners_en || '');
  const matches = Number(project.matches_interest) === 1;
  return (
    <Card style={styles.projCard}>
      <View style={styles.projImageWrap}>
        {project.image_url ? <Image source={{ uri: String(project.image_url) }} style={styles.projImage} /> : <View style={[styles.projImage, styles.projImagePlaceholder]}><Text style={styles.projImageEmoji}>{emoji}</Text></View>}
        {matches ? <View style={styles.projTag}><Text style={styles.projTagText}>{tx('আপনার আগ্রহ', 'Your interest')}</Text></View> : null}
        <View style={[styles.projStatusPill, open ? styles.projStatusOpen : styles.projStatusSoon]}>
          <Text style={styles.projStatusText}>{open ? tx('নিবন্ধন চলছে', 'Open') : tx('শীঘ্রই', 'Soon')}</Text>
        </View>
        {region ? (
          <View style={styles.projRegionTag}><Text style={styles.projRegionTagText} numberOfLines={1}>⌖ {region}</Text></View>
        ) : null}
      </View>
      <View style={styles.projBody}>
        <Text style={styles.projName}>{emoji} {rowTitle(project, lang, tx('প্রকল্প', 'Project'))}</Text>
        {modelLine ? <Text style={styles.projModel}>{modelLine}</Text> : null}
        {Number(project.region_based) === 0 ? <Text style={styles.projMeta}>🌐 {tx('সব অঞ্চলের জন্য উন্মুক্ত', 'Open to all regions')}</Text> : null}
        {project.summary_en || project.summary_bn ? <Text style={styles.projSummary} numberOfLines={2}>{rowBody(project, lang, '')}</Text> : null}
        <View style={styles.projStatsRow}>
          {project.duration_label ? <View style={styles.projStat}><Text style={styles.projStatLabel}>{tx('মেয়াদ', 'Duration')}</Text><Text style={styles.projStatValue}>{String(project.duration_label)}</Text></View> : null}
          {/* Income where the project pays the farmer, investment where the
              farmer pays in. A buy-back project has no investment at all, and
              showing a blank or zero there read as "costs nothing yet". */}
          {Number(project.income_amount) > 0 ? (
            <View style={styles.projStat}><Text style={styles.projStatLabel}>{tx('আয়', 'Income')}</Text><Text style={styles.projStatValue}>{incomeLabel || amount(Number(project.income_amount), lang)}</Text></View>
          ) : Number(project.investment_amount) > 0 ? (
            <View style={styles.projStat}><Text style={styles.projStatLabel}>{tx('বিনিয়োগ', 'Investment')}</Text><Text style={styles.projStatValue}>{amount(Number(project.investment_amount), lang)}</Text></View>
          ) : null}
          {capacityLabel ? (
            <View style={styles.projStat}><Text style={styles.projStatLabel}>{tx('অংশগ্রহণ', 'Capacity')}</Text><Text style={styles.projStatValue}>{capacityLabel}</Text></View>
          ) : Number(project.capacity) > 0 ? (
            <View style={styles.projStat}><Text style={styles.projStatLabel}>{tx('আসন', 'Seats')}</Text><Text style={styles.projStatValue}>{num(Number(project.enrolled || 0), lang)}/{num(Number(project.capacity), lang)}</Text></View>
          ) : null}
        </View>
        {loanPartners ? <View style={styles.projPartner}><Text style={styles.projPartnerText}>🏦 {loanPartners}</Text></View> : null}
        {project.market_overview_en || project.market_overview_bn ? (
          <View style={styles.projOverview}><Text style={styles.projOverviewText}>📈 {lang === 'bn' ? (project.market_overview_bn || project.market_overview_en) : (project.market_overview_en || project.market_overview_bn)}</Text></View>
        ) : null}
        {acceptingApplications ? (
          <AppButton title={tx('এই প্রকল্পে আবেদন করুন  →', 'Apply for this project  →')} onPress={onApply} />
        ) : (
          <Text style={styles.fieldHint}>
            {Number(project.is_active ?? 1) === 0
              ? tx('এই প্রকল্পে নতুন আবেদন নেওয়া হচ্ছে না। ইতিমধ্যে যুক্ত থাকলে "আমার প্রকল্প"-এ অগ্রগতি দেখুন।', 'This project is not taking new applications. If you are already enrolled, see progress under My Projects.')
              : tx('নিবন্ধন শীঘ্রই শুরু হবে।', 'Registration opens soon.')}
          </Text>
        )}
      </View>
    </Card>
  );
}

function ProjectMineCard({ project, onOpen }: { project: ApiRow; onOpen?: () => void }) {
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
    <Card style={styles.projCard} onPress={onOpen}>
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

function Projects({ setScreen, onApply, onOpenApplication, initialTab = 'area' }: { setScreen: (screen: Screen) => void; onApply: (projectId: string) => void; onOpenApplication: (applicationId: string) => void; initialTab?: 'all' | 'area' | 'mine' }) {
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
          {(() => {
            const approved = mine.rows.filter((p) => Number(p.is_approved) === 1);
            const pending = mine.rows.filter((p) => Number(p.is_approved) !== 1);
            return (
              <>
                {pending.length > 0 ? (
                  <>
                    <SectionTitle title={tx('চলমান আবেদন', 'Pending applications')} />
                    {pending.map((p) => <ProjectMineCard key={String(p.application_id || p.id)} project={p} onOpen={p.application_id ? () => onOpenApplication(String(p.application_id)) : undefined} />)}
                  </>
                ) : (!mine.loading ? (
                  <View style={styles.projEmpty}>
                    <Text style={styles.projEmptyIcon}>📋</Text>
                    <Text style={styles.projEmptyTitle}>{tx('কোনো চলমান আবেদন নেই', 'No pending applications')}</Text>
                    <Text style={styles.projEmptyText}>{tx('একটি প্রকল্পে আবেদন করলে এখানে অগ্রগতি দেখা যাবে।', 'Apply to a project and track its progress here.')}</Text>
                    <AppButton title={tx('সকল প্রকল্প দেখুন', 'Browse all projects')} variant="outline" onPress={() => setTab('all')} />
                  </View>
                ) : null)}
                {approved.length > 0 ? (
                  <>
                    <SectionTitle title={tx('সক্রিয় প্রকল্প', 'Active projects')} />
                    {approved.map((p) => <ProjectMineCard key={String(p.application_id || p.id)} project={p} onOpen={p.application_id ? () => onOpenApplication(String(p.application_id)) : undefined} />)}
                  </>
                ) : null}
              </>
            );
          })()}
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

// Seller's own listings + their admin-approval status.
function listingStatusTone(s: string): 'green' | 'gold' | 'rose' | 'blue' {
  return s === 'active' ? 'green' : s === 'rejected' || s === 'cancelled' ? 'rose' : s === 'sold' ? 'blue' : 'gold';
}

function MyListingsBody({ setScreen, onOpenProgress }: { setScreen: (screen: Screen) => void; onOpenProgress?: (listingId: string) => void }) {
  const { tx, lang } = useLanguage();
  const { user } = useAuth();
  const uid = user?.id ? `?user_id=${encodeURIComponent(String(user.id))}` : '';
  const listings = useApiList<ApiRow>(`app/sale/my-listings${uid}`);
  const rows = listings.rows;
  const pendingCount = rows.filter((l) => l.status === 'submitted' || l.status === 'field_verification').length;
  return (
    <>
      {/* header rendered by wrapper */}
      {pendingCount > 0 ? (
        <View style={styles.infoBar}>
          <Text style={styles.infoText}>{tx(`ⓘ ${num(pendingCount, lang)}টি তালিকা অনুমোদনের অপেক্ষায়। অনুমোদনের পর "শাথী থেকে কিনুন"-এ দেখা যাবে।`, `ⓘ ${pendingCount} listing(s) awaiting approval. Once approved they appear in Buy from Shathi.`)}</Text>
        </View>
      ) : null}
      {listings.loading ? <ApiStatus state={listings} /> : null}
      {!listings.loading && rows.length === 0 ? (
        <View style={styles.projEmpty}>
          <Text style={styles.projEmptyIcon}>🏷️</Text>
          <Text style={styles.projEmptyTitle}>{tx('এখনো কোনো তালিকা নেই', 'No listings yet')}</Text>
          <Text style={styles.projEmptyText}>{tx('পশু বা কৃষি উপকরণ ন্যায্য দরে বিক্রি করতে তালিকা দিন।', 'List livestock or farm inputs to sell at a fair rate.')}</Text>
          <AppButton title={tx('বিক্রির তালিকা দিন', 'List for sale')} onPress={() => setScreen('saleCategories')} />
        </View>
      ) : null}
      {rows.map((l) => {
        const media = Array.isArray(l.media_json) ? (l.media_json as unknown[]) : [];
        const img = media.length ? String(media[0]) : '';
        const status = String(l.status || 'submitted');
        const isPending = status === 'submitted' || status === 'field_verification';
        const visitDate = l.field_visit_date ? formatDate(l.field_visit_date, lang) : '';
        // The whole card opens the progress trail — a status badge alone never
        // answered "and what happens next?".
        const open = onOpenProgress ? () => onOpenProgress(String(l.id)) : undefined;
        return (
          <Pressable key={String(l.id)} onPress={open} disabled={!open} style={({ pressed }) => [styles.listingCard, pressed && open ? styles.pressed : null]}>
            {img
              ? <Image source={{ uri: img }} style={styles.listingCardImage} resizeMode="cover" />
              : <View style={styles.listingCardImagePh}><Text style={styles.buyCardImagePhText}>🏷️</Text></View>}
            <View style={styles.listingCardBody}>
              <Text style={styles.productTitle} numberOfLines={1}>{rowTitle(l, lang, String(l.item_name || 'Listing'))}</Text>
              <Text style={styles.productSub} numberOfLines={1}>
                {[l.item_name ? tEnum(l.category_slug, lang) || String(l.item_name) : '', `${num(Number(l.quantity || 1), lang)} ${l.unit || ''}`].filter(Boolean).join(' · ')}
              </Text>
              <Text style={styles.buyCardPack}>{new Date(String(l.created_at)).toLocaleDateString()}</Text>
              <View style={styles.buyCardFoot}>
                <Text style={styles.productPrice}>{amount(Number(l.farmer_expected_price || 0), lang)}<Text style={styles.unit}> /{l.unit || ''}</Text></Text>
                <Badge label={isPending ? tx('অনুমোদনের অপেক্ষায়', 'Pending approval') : tEnum(status, lang)} tone={listingStatusTone(status)} />
              </View>
              <Text style={styles.trailDesc}>
                {status === 'paid' && l.paid_at
                  ? tx(`পরিশোধিত · ${formatDate(l.paid_at, lang)}`, `Paid · ${formatDate(l.paid_at, lang)}`)
                  : visitDate
                    ? tx(`মাঠ পরিদর্শন · ${visitDate}`, `Field visit · ${visitDate}`)
                    : tx('অগ্রগতি দেখতে ট্যাপ করুন →', 'Tap to see progress →')}
              </Text>
            </View>
          </Pressable>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------
// Progress trails
// ---------------------------------------------------------------------------

type ProgressStep = {
  key: string;
  index: number;
  title_en: string;
  title_bn: string;
  desc_en: string;
  desc_bn: string;
  state: 'done' | 'current' | 'upcoming';
  date: string | null;
  note: string | null;
};

type ProgressPayload = {
  reference?: string;
  status?: string;
  rejected?: boolean;
  steps?: ProgressStep[];
  note?: string | null;
  officer?: { name?: string; phone?: string; area?: string } | null;
  listing?: ApiRow;
  application?: ApiRow;
};

/** One-shot fetch of a single object. `useApiList` only speaks in arrays. */
function useApiObject<T>(resource: string | null) {
  const { lang } = useLanguage();
  const refreshTick = useRefreshTick();
  const [state, setState] = useState<{ data: T | null; loading: boolean; error: string | null }>({ data: null, loading: !!resource, error: null });
  useEffect(() => {
    if (!resource) {
      setState({ data: null, loading: false, error: null });
      return;
    }
    let alive = true;
    setState({ data: null, loading: true, error: null });
    apiRequest<{ data?: T }>(resource)
      .then((json) => { if (alive) setState({ data: json.data ?? null, loading: false, error: null }); })
      .catch((error) => { if (alive) setState({ data: null, loading: false, error: naturalApiError(error, lang) }); });
    return () => { alive = false; };
  }, [resource, refreshTick, lang]);
  return state;
}

function ProgressTrail({ steps }: { steps: ProgressStep[] }) {
  const { tx, lang } = useLanguage();
  return (
    <View style={styles.trail}>
      {steps.map((step, i) => {
        const done = step.state === 'done';
        const current = step.state === 'current';
        const last = i === steps.length - 1;
        return (
          <View key={step.key} style={styles.trailRow}>
            <View style={styles.trailRail}>
              <View style={[styles.trailDot, done && styles.trailDotDone, current && styles.trailDotCurrent]}>
                <Text style={done || current ? styles.trailDotText : styles.trailDotTextPending}>{done ? '✓' : String(step.index)}</Text>
              </View>
              {/* The connector is coloured by the step above it, so the green
                  stops exactly where progress stopped. */}
              {!last ? <View style={[styles.trailLine, done && styles.trailLineDone]} /> : null}
            </View>
            <View style={styles.trailBody}>
              <Text style={[styles.trailTitle, step.state === 'upcoming' && styles.trailTitleMuted]}>{tx(step.title_bn, step.title_en)}</Text>
              <Text style={styles.trailDesc}>{tx(step.desc_bn, step.desc_en)}</Text>
              {step.date ? <Text style={styles.trailDate}>{formatDate(step.date, lang)}</Text> : null}
              {current ? (
                <View style={styles.trailCurrentPill}>
                  <Text style={styles.trailCurrentPillText}>{tx('এখন এই ধাপে', 'HAPPENING NOW')}</Text>
                </View>
              ) : null}
              {step.note ? <Text style={styles.trailNote}>{step.note}</Text> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function OfficerCard({ officer }: { officer: { name?: string; phone?: string; area?: string } }) {
  const { tx } = useLanguage();
  // A plain Card, not styles.officerCard: that variant zeroes the horizontal
  // margin for the success screens, which already inset their own content. Used
  // at screen level it renders full-bleed beside cards that are inset by 16.
  return (
    <Card>
      <Text style={styles.smallUpper}>{tx('নির্ধারিত মাঠ কর্মকর্তা', 'Assigned field officer')}</Text>
      <Text style={styles.officerName}>{officer.name}</Text>
      <Text style={styles.officerMeta}>{[officer.phone ? `☎ ${officer.phone}` : '', officer.area].filter(Boolean).join(' · ')}</Text>
    </Card>
  );
}

function ListingProgress({ setScreen, listingId }: { setScreen: (screen: Screen) => void; listingId: string | null }) {
  const { tx, lang } = useLanguage();
  const { user } = useAuth();
  const resource = listingId
    ? `app/sale/listing-progress?listing_id=${encodeURIComponent(listingId)}${user?.id ? `&user_id=${encodeURIComponent(String(user.id))}` : ''}`
    : null;
  const state = useApiObject<ProgressPayload>(resource);
  const data = state.data;
  const listing = (data?.listing ?? {}) as ApiRow;
  const live = Number(listing.weight_kg || 0);
  const meat = Number(listing.meat_weight_kg || 0) || (live * (Number(listing.dressing_pct) || DEFAULT_DRESSING_PCT)) / 100;

  return (
    <>
      <Header title={tx('তালিকার অগ্রগতি', 'Listing Progress')} onBack={() => setScreen('myListings')} />
      {state.loading ? <Text style={styles.fieldHint}>{tx('অগ্রগতি আনা হচ্ছে...', 'Loading progress...')}</Text> : null}
      {!state.loading && !data ? (
        <View style={styles.projEmpty}>
          <Text style={styles.projEmptyIcon}>🏷️</Text>
          <Text style={styles.projEmptyTitle}>{tx('তালিকাটি পাওয়া যায়নি', 'Listing not found')}</Text>
          <Text style={styles.projEmptyText}>{state.error || tx('তালিকাটি সরানো হয়েছে অথবা আপনার নয়।', 'It may have been removed, or it is not yours.')}</Text>
          <AppButton title={tx('আমার তালিকা', 'My Listings')} onPress={() => setScreen('myListings')} />
        </View>
      ) : null}
      {data ? (
        <>
          <Card>
            <Text style={styles.smallUpper}>{tx('রেফারেন্স', 'Reference')}</Text>
            <Text style={styles.officerName}>{String(data.reference || '')}</Text>
            <Text style={styles.officerMeta}>
              {[rowTitle(listing, lang, String(listing.animal_name || 'Livestock')), listing.breed_name ? String(lang === 'bn' ? listing.breed_name_bn || listing.breed_name : listing.breed_name) : ''].filter(Boolean).join(' · ')}
            </Text>
            <View style={[styles.summaryChips, styles.summaryChipsInline]}>
              {live > 0 ? <View style={styles.summaryChip}><Text style={styles.summaryChipText}>{tx('জীবিত', 'Live')} {num(live, lang)} {tx('কেজি', 'kg')}</Text></View> : null}
              {meat > 0 ? <View style={styles.summaryChip}><Text style={styles.summaryChipText}>{tx('মাংস', 'Meat')} {num(Math.round(meat), lang)} {tx('কেজি', 'kg')}</Text></View> : null}
              {Number(listing.verified_weight_kg || 0) > 0 ? <View style={styles.summaryChip}><Text style={styles.summaryChipText}>{tx('যাচাইকৃত', 'Verified')} {num(Number(listing.verified_weight_kg), lang)} {tx('কেজি', 'kg')}</Text></View> : null}
            </View>
          </Card>
          {data.rejected ? (
            <View style={styles.infoBar}>
              <Text style={styles.infoText}>{tx('এই তালিকাটি বাতিল হয়েছে। মাঠ কর্মকর্তার সাথে কথা বলুন।', 'This listing was cancelled or rejected. Talk to your field officer.')}</Text>
            </View>
          ) : null}
          <ProgressTrail steps={data.steps || []} />
          <View style={styles.priceTable}>
            <View style={styles.finalRow}>
              <View style={styles.flex}>
                <Text style={styles.finalLabel}>{Number(listing.paid_amount || 0) > 0 ? tx('পরিশোধিত', 'Paid') : tx('আনুমানিক আয়', 'Estimated earning')}</Text>
                <Text style={styles.finalSub}>
                  {Number(listing.paid_amount || 0) > 0
                    ? [listing.payment_method ? tEnum(String(listing.payment_method), lang) : '', listing.payment_reference].filter(Boolean).join(' · ')
                    : tx('চূড়ান্ত পেমেন্ট যাচাইকৃত ওজনে', 'Final payment is set on the verified weight')}
                </Text>
              </View>
              <Text style={styles.finalValue}>{amount(Number(listing.paid_amount || listing.estimated_earning || 0), lang)}</Text>
            </View>
          </View>
          {data.officer ? <OfficerCard officer={data.officer} /> : null}
        </>
      ) : null}
      <AppButton title={tx('আমার তালিকায় ফিরুন', 'Back to My Listings')} variant="outline" onPress={() => setScreen('myListings')} />
    </>
  );
}

function ProjectProgress({ setScreen, applicationId }: { setScreen: (screen: Screen) => void; applicationId: string | null }) {
  const { tx, lang } = useLanguage();
  const { user } = useAuth();
  const resource = applicationId
    ? `app/projects/application-progress?application_id=${encodeURIComponent(applicationId)}${user?.id ? `&user_id=${encodeURIComponent(String(user.id))}` : ''}`
    : null;
  const state = useApiObject<ProgressPayload>(resource);
  const data = state.data;
  const app = (data?.application ?? {}) as ApiRow;

  return (
    <>
      <Header title={tx('প্রকল্পের অগ্রগতি', 'Project Progress')} onBack={() => setScreen('myProjects')} />
      {state.loading ? <Text style={styles.fieldHint}>{tx('অগ্রগতি আনা হচ্ছে...', 'Loading progress...')}</Text> : null}
      {!state.loading && !data ? (
        <View style={styles.projEmpty}>
          <Text style={styles.projEmptyIcon}>🤝</Text>
          <Text style={styles.projEmptyTitle}>{tx('আবেদন পাওয়া যায়নি', 'Application not found')}</Text>
          <Text style={styles.projEmptyText}>{state.error || tx('আবেদনটি সরানো হয়েছে অথবা আপনার নয়।', 'It may have been removed, or it is not yours.')}</Text>
          <AppButton title={tx('আমার প্রকল্প', 'My Projects')} onPress={() => setScreen('myProjects')} />
        </View>
      ) : null}
      {data ? (
        <>
          <Card>
            <Text style={styles.smallUpper}>{tx('রেফারেন্স', 'Reference')}</Text>
            <Text style={styles.officerName}>{String(data.reference || '')}</Text>
            <Text style={styles.productTitle}>{lang === 'bn' ? String(app.project_name_bn || app.project_name || '') : String(app.project_name || '')}</Text>
            {app.model_en ? <Text style={styles.officerMeta}>{lang === 'bn' ? String(app.model_bn || app.model_en) : String(app.model_en)}</Text> : null}
            <View style={[styles.summaryChips, styles.summaryChipsInline]}>
              {app.duration_label ? <View style={styles.summaryChip}><Text style={styles.summaryChipText}>⏱ {String(app.duration_label)}</Text></View> : null}
              {Number(app.income_amount || 0) > 0 ? (
                <View style={styles.summaryChip}><Text style={styles.summaryChipText}>{(lang === 'bn' ? String(app.income_label_bn || '') : String(app.income_label_en || '')) || amount(Number(app.income_amount), lang)}</Text></View>
              ) : null}
            </View>
            {app.loan_partners_en ? <Text style={styles.trailDesc}>{lang === 'bn' ? String(app.loan_partners_bn || app.loan_partners_en) : String(app.loan_partners_en)}</Text> : null}
          </Card>
          {data.rejected ? (
            <View style={styles.infoBar}>
              <Text style={styles.infoText}>{tx('এই আবেদনটি অনুমোদিত হয়নি। মাঠ কর্মকর্তার সাথে কথা বলুন।', 'This application was not approved. Talk to your field officer.')}</Text>
            </View>
          ) : null}
          <ProgressTrail steps={data.steps || []} />
          {data.note ? (
            <View style={styles.noteBlue}>
              <Text style={styles.noteText}>{data.note}</Text>
            </View>
          ) : null}
          {data.officer ? <OfficerCard officer={data.officer} /> : null}
        </>
      ) : null}
      <AppButton title={tx('আমার প্রকল্পে ফিরুন', 'Back to My Projects')} variant="outline" onPress={() => setScreen('myProjects')} />
    </>
  );
}

function applicationStatusTone(s: string): 'green' | 'gold' | 'rose' | 'blue' {
  if (s === 'approved') return 'green';
  if (s === 'rejected') return 'rose';
  if (s === 'officer_verification' || s === 'ready_to_approve') return 'blue';
  return 'gold';
}

function MyProjects({ setScreen, onOpen }: { setScreen: (screen: Screen) => void; onOpen: (applicationId: string) => void }) {
  const { tx, lang } = useLanguage();
  const { user } = useAuth();
  const uid = user?.id ? `?user_id=${encodeURIComponent(String(user.id))}` : '';
  const apps = useApiList<ApiRow>(`app/projects/applications${uid}`);
  const rows = apps.rows;
  return (
    <>
      <Header title={tx('আমার প্রকল্প', 'My Projects')} onBack={() => setScreen('profile')} />
      {apps.loading ? <ApiStatus state={apps} /> : null}
      {!apps.loading && rows.length === 0 ? (
        <View style={styles.projEmpty}>
          <Text style={styles.projEmptyIcon}>🤝</Text>
          <Text style={styles.projEmptyTitle}>{tx('এখনো কোনো প্রকল্প নেই', 'No projects yet')}</Text>
          <Text style={styles.projEmptyText}>{tx('প্রকল্পে যোগ দিলে এখানে অগ্রগতি দেখতে পাবেন।', 'Join a project and its progress shows up here.')}</Text>
          <AppButton title={tx('প্রকল্প দেখুন', 'Browse projects')} onPress={() => setScreen('projects')} />
        </View>
      ) : null}
      {rows.map((a) => {
        const status = String(a.status || 'submitted');
        const img = a.image_url ? String(a.image_url) : '';
        return (
          <Pressable key={String(a.id)} onPress={() => onOpen(String(a.id))} style={({ pressed }) => [styles.listingCard, pressed && styles.pressed]}>
            {img
              ? <Image source={{ uri: img }} style={styles.listingCardImage} resizeMode="cover" />
              : <View style={styles.listingCardImagePh}><Text style={styles.buyCardImagePhText}>🤝</Text></View>}
            <View style={styles.listingCardBody}>
              <Text style={styles.productTitle} numberOfLines={1}>{lang === 'bn' ? String(a.project_name_bn || a.project_name || '') : String(a.project_name || '')}</Text>
              <Text style={styles.productSub} numberOfLines={1}>{[String(a.application_code || ''), a.duration_label ? String(a.duration_label) : ''].filter(Boolean).join(' · ')}</Text>
              <Text style={styles.buyCardPack}>{formatDate(a.created_at, lang)}</Text>
              <View style={styles.buyCardFoot}>
                <Text style={styles.productPrice}>{Number(a.income_amount || 0) > 0 ? amount(Number(a.income_amount), lang) : ''}</Text>
                <Badge label={tEnum(status, lang)} tone={applicationStatusTone(status)} />
              </View>
              {/* A project the platform has since closed keeps showing its
                  progress to the farmers already in it. */}
              {Number(a.project_is_active ?? 1) === 0 ? (
                <Text style={styles.trailDesc}>{tx('নতুন আবেদন বন্ধ — আপনার তালিকাভুক্তি চালু আছে।', 'Closed to new applications — your enrolment continues.')}</Text>
              ) : null}
            </View>
          </Pressable>
        );
      })}
    </>
  );
}

function MyListings({ setScreen, onOpenProgress }: { setScreen: (screen: Screen) => void; onOpenProgress?: (listingId: string) => void }) {
  const { tx } = useLanguage();
  return (
    <>
      <Header title={tx('আমার বিক্রির তালিকা', 'My Listings')} onBack={() => setScreen('profile')} />
      <MyListingsBody setScreen={setScreen} onOpenProgress={onOpenProgress} />
    </>
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
    // Secondary entry point to the finance feature, directly above My Listings
    // (MOB-RDY-05).
    { icon: '🧭', title: tx('ফাইন্যান্স প্রস্তুতি', 'Finance Readiness'), sub: tx('আপনার ঋণ প্রস্তুতি দেখুন', 'See your finance readiness'), target: 'financeReadinessResult' },
    { icon: '🏷️', title: tx('আমার বিক্রির তালিকা', 'My Listings'), sub: tx('তালিকা ও অনুমোদনের অবস্থা', 'Listings & approval status'), target: 'myListings' },
    { icon: '🤝', title: tx('আমার প্রকল্প', 'My Projects'), sub: tx('আবেদন ও প্রকল্পের অগ্রগতি', 'Applications & project progress'), target: 'myProjects' },
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
    { key: 'selfie', label: tx('ব্যবহারকারীর ছবি', 'User Photo'), icon: '🤳', sample: tx('আপনার ছবি', 'Your photo'), guide: tx('মুখ স্পষ্ট ও ভালো আলোতে, চশমা/টুপি ছাড়া।', 'Face clear, good light, no glasses/cap.') },
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
          {([['🪪', tx('NID', 'NID'), kyc.nid], ['🤳', tx('ব্যবহারকারীর ছবি', 'User Photo'), kyc.selfie], ['🏦', tx('ব্যাংক', 'Bank'), kyc.banking ? 'verified' : 'none']] as Array<[string, string, string | undefined]>).map(([icon, label, st]) => {
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
  headerTitle,
  onBack,
  primary,
}: {
  icon: string;
  title: string;
  refNo: string;
  desc: string;
  action: () => void;
  children?: React.ReactNode;
  gold?: boolean;
  /** Renders the standard top nav so the farmer is not trapped on the tick. */
  headerTitle?: string;
  onBack?: () => void;
  /** Optional call to action shown above "Back to Home". */
  primary?: { title: string; onPress: () => void };
}) {
  const { tx } = useLanguage();
  return (
    <>
      {onBack ? <Header title={headerTitle || title} onBack={onBack} /> : null}
      <View style={styles.success}>
        <View style={[styles.successCircle, gold && styles.successGold]}>
          <Text style={styles.successIcon}>{icon}</Text>
        </View>
        <Text style={[styles.successTitle, gold && styles.successGoldText]}>{title}</Text>
        <Text style={styles.refNo}>{refNo}</Text>
        <Text style={styles.successDesc}>{desc}</Text>
        {children}
        <View style={styles.successActions}>
          {primary ? <AppButton title={primary.title} onPress={primary.onPress} /> : null}
          <AppButton title={tx('হোমে ফিরুন', 'Back to Home')} variant={primary ? 'outline' : 'primary'} onPress={action} />
        </View>
      </View>
    </>
  );
}

// ===========================================================================
// FINANCE — Feature 1 (Readiness) and Feature 2 (Loan application)
//
// Screens use the existing shared primitives (Header, Card, AppButton, Shell,
// RefreshScroll, ApiStatus) so caching, the global loader, pull-to-refresh and
// humanised errors behave exactly as they do everywhere else.
//
// Finance-specific styling lives in the local `fin` StyleSheet below rather than
// in the shared sheet, so this feature adds no edits to existing style rules.
//
// Two rules hold throughout:
//   * No screen ever displays a weight, a per-question point value or the
//     formula. The server does not send them (P6).
//   * Nothing here says "approved" or promises finance. Copy is প্রস্তুতি /
//     সম্ভাব্য / সুপারিশ — the lender owns the decision (P1).
// ===========================================================================

const fin = StyleSheet.create({
  // Readiness result badge. One maroon block instead of a white card with the
  // grade ring, score, label and chips stacked down it — that layout spent most
  // of the first screen on whitespace and pushed the breakdown below the fold.
  badge: { marginHorizontal: 16, marginTop: 14, backgroundColor: colors.maroon, borderRadius: 20, padding: 18 },
  badgeTop: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  badgeRing: { width: 88, height: 88, borderRadius: 44, borderWidth: 2.5, alignItems: 'center', justifyContent: 'center' },
  badgeGrade: { fontSize: 38, fontWeight: '800' },
  badgePip: { position: 'absolute', right: -2, bottom: -2, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.gold, borderWidth: 2, borderColor: colors.maroon },
  badgeScoreLabel: { color: 'rgba(255,255,255,0.78)', fontSize: 12, fontWeight: '700', letterSpacing: 0.4 },
  badgeScore: { color: 'white', fontSize: 38, lineHeight: 46, fontWeight: '800' },
  badgeOutOf: { color: 'rgba(255,255,255,0.6)', fontSize: 17, fontWeight: '600' },
  badgeMessage: { color: '#FFF3C4', fontSize: 15, lineHeight: 22, fontWeight: '700', marginTop: 12 },
  badgeChipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 14 },
  badgeChip: { borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.16)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.34)', paddingHorizontal: 11, paddingVertical: 5 },
  badgeChipText: { color: 'white', fontSize: 11.5, fontWeight: '700' },
  badgeChipTextGold: { color: '#FFF3C4' },
  badgeProvisional: { marginTop: 12, backgroundColor: 'rgba(245,158,11,0.22)', borderWidth: 1, borderColor: 'rgba(245,158,11,0.55)', borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10 },
  badgeProvisionalTag: { color: '#FFE9B8', fontSize: 12, fontWeight: '800' },
  badgeProvisionalNote: { color: 'rgba(255,255,255,0.86)', fontSize: 12.5, lineHeight: 19, marginTop: 3 },
  badgeFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 14 },
  badgeMicro: { color: 'rgba(255,255,255,0.72)', fontSize: 11.5, lineHeight: 16 },
  badgeRetake: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.45)', borderRadius: 9, paddingHorizontal: 14, paddingVertical: 9, minHeight: 38, justifyContent: 'center' },
  badgeRetakeText: { color: 'white', fontSize: 13, fontWeight: '700' },

  // Requested vs recommended, drawn to scale. Named `ask*` because `amountRow`
  // is already taken by the loan amount input further down this sheet.
  askRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  askLabel: { color: colors.muted, fontSize: 12.5, fontWeight: '600' },
  askValue: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  askValueMuted: { color: colors.muted, fontSize: 13.5, fontWeight: '700' },
  askTrack: { height: 8, borderRadius: 999, backgroundColor: colors.line, marginTop: 6, overflow: 'hidden' },
  askFill: { height: 8, borderRadius: 999, backgroundColor: colors.maroon },
  askFillMuted: { height: 8, borderRadius: 999, backgroundColor: '#DCCBD4' },
  askNote: { color: colors.muted, fontSize: 12, lineHeight: 18, marginTop: 10 },

  // Readiness questionnaire
  quizPage: { flex: 1, backgroundColor: colors.cream },
  quizBody: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 18 },
  tagRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  tagPhase: { backgroundColor: '#F1E3EA', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  tagPhaseText: { color: colors.maroon, fontSize: 12.5, fontWeight: '800' },
  tagCat: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  tagCatText: { color: colors.ink, fontSize: 12.5, fontWeight: '700' },
  tagFlag: { alignSelf: 'flex-start', marginTop: 8, backgroundColor: colors.goldPale, borderWidth: 1, borderColor: '#EBC66A', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  tagFlagText: { color: '#7A5200', fontSize: 12, fontWeight: '800' },
  questionRow: { flexDirection: 'row', gap: 14, alignItems: 'flex-start', marginTop: 16 },
  questionIcon: { width: 52, height: 52, borderRadius: 12, backgroundColor: colors.rose, alignItems: 'center', justifyContent: 'center' },
  questionText: { flex: 1, color: colors.ink, fontSize: 22, fontWeight: '800', lineHeight: 31 },
  whyTitle: { color: colors.maroon, fontSize: 14, fontWeight: '800', marginTop: 20 },
  whyBox: { marginTop: 8, backgroundColor: '#FBEEF3', borderRadius: 12, padding: 14 },
  whyText: { color: colors.ink, fontSize: 14, lineHeight: 21 },

  // Answers are docked to the bottom edge so they never move between questions.
  answerDock: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 14, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.cream },
  answerBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: 14, paddingVertical: 17, marginTop: 10, minHeight: 56 },
  answerGlyph: { fontSize: 20, fontWeight: '800' },
  answerLabel: { color: colors.ink, fontSize: 18, fontWeight: '800' },
  privacyNote: { textAlign: 'center', color: colors.maroon, fontSize: 12, marginTop: 12, lineHeight: 17 },
  quizError: { color: colors.danger, fontSize: 13, lineHeight: 19, marginBottom: 4 },
  quizSubmitting: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(255,255,255,0.55)', alignItems: 'center', justifyContent: 'center' },
  weakNotice: { padding: 16, backgroundColor: colors.goldPale, borderWidth: 1, borderColor: '#EBC66A' },
  weakTitle: { color: '#7A5200', fontSize: 15.5, fontWeight: '800' },
  weakBody: { color: '#7A5200', fontSize: 13.5, marginTop: 6, lineHeight: 20 },
  stageMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5, flexWrap: 'wrap' },
  ownerChip: { borderWidth: 1, borderColor: colors.line, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 2 },
  ownerChipText: { color: colors.muted, fontSize: 11.5, fontWeight: '700' },
  stageDate: { color: colors.muted, fontSize: 11.5 },
  refreshHint: { textAlign: 'center', color: colors.muted, fontSize: 12, marginTop: 16 },
  // Officer contact card
  officerCard: { marginHorizontal: 16, padding: 14 },
  officerRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  officerActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  smsBtn: { flex: 1, borderWidth: 1, borderColor: colors.line, borderRadius: 10, paddingVertical: 11, alignItems: 'center', justifyContent: 'center', minHeight: 44 },
  smsBtnText: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  officerHours: { marginTop: 10, backgroundColor: colors.rose, borderRadius: 8, padding: 9 },

  // Indicative terms table
  termRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, paddingVertical: 9, borderTopWidth: 1, borderTopColor: colors.line },
  termLabel: { color: colors.muted, fontSize: 13.5 },
  termValue: { color: colors.ink, fontSize: 13.5, fontWeight: '700', flexShrink: 1, textAlign: 'right' },

  promiseCard: { marginHorizontal: 16, marginTop: 12, padding: 13, backgroundColor: '#E6F5ED', borderWidth: 1, borderColor: '#B7E0C9' },
  promiseText: { color: '#1E7A46', fontSize: 13.5, fontWeight: '600', lineHeight: 20 },
  // Consent step
  consentAllCard: { marginHorizontal: 16, marginTop: 14, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  consentRow: { marginHorizontal: 16, marginTop: 10, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  switchTrack: { width: 44, height: 26, borderRadius: 999, backgroundColor: colors.line, padding: 3, justifyContent: 'center' },
  switchKnob: { width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff' },
  stillNeeded: { marginHorizontal: 16, marginTop: 14, color: colors.maroon, fontSize: 12.5, lineHeight: 18 },
  noteInput: { minHeight: 64, borderWidth: 1, borderColor: colors.line, borderRadius: 10, padding: 11, color: colors.ink, fontSize: 14, textAlignVertical: 'top' },
  // Inline repayment schedule on the amount step
  schedHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.line, minHeight: 44 },
  schedHeadText: { flex: 1, color: colors.maroon, fontSize: 13.5, fontWeight: '800' },
  schedChevron: { color: colors.maroon, fontSize: 19, fontWeight: '800', width: 18, textAlign: 'center' },
  schedRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#FAF4F7' },
  schedNo: { width: 24, color: colors.muted, fontSize: 12, fontWeight: '700' },
  schedDate: { flex: 1, color: colors.ink, fontSize: 13 },
  schedAmount: { color: colors.ink, fontSize: 13.5, fontWeight: '700' },
  // Loan hub — live application summary
  hubStatRow: { flexDirection: 'row', gap: 8, marginTop: 14 },
  hubStat: { flex: 1, backgroundColor: colors.rose, borderRadius: 10, paddingVertical: 9, paddingHorizontal: 10 },
  hubStatLabel: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  hubStatValue: { color: colors.ink, fontSize: 13.5, fontWeight: '800', marginTop: 3 },
  hubProgressTrack: { height: 7, backgroundColor: colors.line, borderRadius: 999, marginTop: 8, overflow: 'hidden' },
  hubProgressFill: { height: 7, borderRadius: 999, backgroundColor: colors.maroon },

  // Loan hub — how it works
  howCard: { marginHorizontal: 16, marginTop: 14, padding: 16, backgroundColor: colors.rose, borderWidth: 1, borderColor: '#EBDDE4' },
  howKicker: { color: colors.maroon, fontSize: 11.5, fontWeight: '800', letterSpacing: 0.4, textTransform: 'uppercase' },
  howTitle: { color: colors.ink, fontSize: 16.5, fontWeight: '800', marginTop: 4, marginBottom: 10 },
  howStep: { flexDirection: 'row', gap: 8, marginTop: 8 },
  howNum: { color: colors.maroon, fontSize: 13.5, fontWeight: '800', minWidth: 20 },
  howText: { flex: 1, color: colors.ink, fontSize: 13.5, lineHeight: 20 },
  howNote: { flexDirection: 'row', gap: 9, alignItems: 'flex-start', marginTop: 14, backgroundColor: colors.card, borderRadius: 10, padding: 11 },
  howNoteText: { flex: 1, color: colors.maroon, fontSize: 12.5, lineHeight: 18, fontWeight: '600' },

  // Loan hub — readiness entry
  readyCard: { marginHorizontal: 16, marginTop: 12, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  readyIcon: { width: 38, height: 38, borderRadius: 10, backgroundColor: colors.rose, alignItems: 'center', justifyContent: 'center' },

  productTerms: { color: colors.maroon, fontSize: 12, fontWeight: '700', marginTop: 3 },
  // Collapsible section header
  collapseHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginHorizontal: 16, marginTop: 18, marginBottom: 8, minHeight: 44 },
  collapseTitle: { flex: 1, color: colors.ink, fontSize: 16, fontWeight: '800' },
  collapseBadge: { backgroundColor: '#E6F5ED', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  collapseBadgeText: { color: colors.green, fontSize: 12.5, fontWeight: '800' },
  collapseChevron: { color: colors.maroon, fontSize: 20, fontWeight: '800', width: 18, textAlign: 'center' },

  // Profile-strength meter
  strengthBar: { flexDirection: 'row', gap: 4, marginBottom: 10 },
  strengthSeg: { flex: 1, height: 7, borderRadius: 999 },
  strengthMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12, flexWrap: 'wrap' },

  // Confidence ring on the home passport badge
  confidenceRing: { position: 'absolute', right: -2, bottom: -2, width: 18, height: 18, borderRadius: 9, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: colors.card },
  confidenceGlyph: { fontSize: 10, fontWeight: '900' },
  // Home Finance Passport card
  passport: { marginHorizontal: 16, marginTop: 12, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 14 },
  passportBadge: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  passportBadgeText: { fontSize: 24, fontWeight: '800' },
  passportKicker: { fontSize: 11, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase' },
  passportTitle: { color: colors.ink, fontSize: 16, fontWeight: '800', marginTop: 2 },
  passportSub: { color: colors.muted, fontSize: 12.5, marginTop: 2 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1 },
  chipText: { fontSize: 11.5, fontWeight: '700' },
  chevron: { color: colors.muted, fontSize: 22, marginLeft: 4 },

  // Ticker
  ticker: { marginHorizontal: 16, marginTop: 10, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  tickerAmount: { fontSize: 20, fontWeight: '800', color: colors.ink },

  // Quiz
  quizWrap: { flex: 1, paddingHorizontal: 20, paddingTop: 8 },
  progressTrack: { height: 6, backgroundColor: colors.rose, borderRadius: 3, marginBottom: 18, overflow: 'hidden' },
  progressFill: { height: 6, backgroundColor: colors.maroon, borderRadius: 3 },
  partChip: { alignSelf: 'flex-start', backgroundColor: colors.rose, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, marginBottom: 14 },
  partChipText: { color: colors.maroon, fontSize: 12, fontWeight: '700' },
  question: { color: colors.ink, fontSize: 23, fontWeight: '800', lineHeight: 33 },
  helperToggle: { color: colors.maroon, fontSize: 13.5, fontWeight: '600', marginTop: 12 },
  helperBody: { color: colors.muted, fontSize: 13.5, lineHeight: 20, marginTop: 8 },

  // Result
  scoreWrap: { alignItems: 'center', paddingVertical: 18 },
  scoreCircle: { width: 104, height: 104, borderRadius: 52, borderWidth: 4, alignItems: 'center', justifyContent: 'center' },
  scoreLetter: { fontSize: 42, fontWeight: '800' },
  scoreValue: { fontSize: 34, fontWeight: '800', color: colors.ink, marginTop: 12 },
  scoreOutOf: { fontSize: 15, color: colors.muted, fontWeight: '600' },
  selfDeclared: { color: colors.muted, fontSize: 12, marginTop: 6, fontWeight: '600' },
  barRow: { marginBottom: 12 },
  barLabelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 5 },
  barLabel: { color: colors.ink, fontSize: 14, fontWeight: '600' },
  barValue: { color: colors.maroon, fontSize: 14, fontWeight: '800' },
  barTrack: { height: 8, backgroundColor: colors.rose, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: 8, borderRadius: 4, backgroundColor: colors.maroon },
  listItem: { flexDirection: 'row', gap: 10, marginBottom: 9, alignItems: 'flex-start' },
  listGlyph: { fontSize: 15, marginTop: 1 },
  listText: { flex: 1, color: colors.ink, fontSize: 14.5, lineHeight: 21 },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: colors.line },
  actionTitle: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  actionSub: { color: colors.muted, fontSize: 12.5, marginTop: 2, lineHeight: 18 },
  signalRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  signalDot: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },

  // Officer strip
  officerStrip: { marginHorizontal: 16, marginTop: 12, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  officerAvatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.rose, alignItems: 'center', justifyContent: 'center' },
  officerAvatarText: { color: colors.maroon, fontWeight: '800', fontSize: 16 },
  callBtn: { backgroundColor: colors.maroon, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9 },
  callBtnText: { color: '#fff', fontWeight: '700', fontSize: 13.5 },

  // Products
  productCard: { marginHorizontal: 16, marginTop: 12, padding: 16 },
  productDim: { opacity: 0.55 },
  productHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  productIcon: { fontSize: 30 },
  productName: { color: colors.ink, fontSize: 16.5, fontWeight: '800' },
  productDesc: { color: colors.muted, fontSize: 13, marginTop: 3, lineHeight: 19 },
  rateBadge: { backgroundColor: colors.goldPale, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 },
  rateBadgeText: { color: '#8A5A00', fontWeight: '800', fontSize: 13 },
  productMeta: { color: colors.muted, fontSize: 12.5, marginTop: 10 },

  // Amount + quote
  amountRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 6 },
  amountInput: { flex: 1, borderWidth: 1.5, borderColor: colors.line, borderRadius: 12, paddingHorizontal: 14,
                 paddingVertical: 12, fontSize: 22, fontWeight: '800', color: colors.ink, textAlign: 'right', backgroundColor: colors.card },
  sliderRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  stepBtn: { width: 44, height: 44, borderRadius: 22, borderWidth: 1.5, borderColor: colors.line,
             alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card },
  stepBtnText: { fontSize: 22, fontWeight: '800', color: colors.maroon },
  sliderTrack: { flex: 1, height: 8, backgroundColor: colors.rose, borderRadius: 4, overflow: 'hidden' },
  sliderFill: { height: 8, backgroundColor: colors.maroon, borderRadius: 4 },
  boundsRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  boundText: { color: colors.muted, fontSize: 11.5 },
  segmentRow: { flexDirection: 'row', gap: 8, marginTop: 8, flexWrap: 'wrap' },
  segment: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.card },
  segmentOn: { borderColor: colors.maroon, backgroundColor: colors.rose },
  segmentText: { fontSize: 14.5, fontWeight: '700', color: colors.ink },
  modeCard: { padding: 14, borderRadius: 12, borderWidth: 1.5, borderColor: colors.line, backgroundColor: colors.card, marginBottom: 8 },
  modeCardOn: { borderColor: colors.maroon, backgroundColor: colors.rose },
  quoteCard: { marginHorizontal: 16, marginTop: 14, padding: 16, borderWidth: 1.5, borderColor: colors.maroon },
  quoteLine: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  quoteLabel: { color: colors.muted, fontSize: 13.5 },
  quoteValue: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  quoteDivider: { height: 1, backgroundColor: colors.line, marginVertical: 8 },
  emiBlock: { alignItems: 'center', paddingVertical: 10 },
  emiLabel: { color: colors.muted, fontSize: 13, fontWeight: '600' },
  emiValue: { color: colors.maroon, fontSize: 32, fontWeight: '800', marginTop: 2 },
  caveat: { color: colors.muted, fontSize: 11.5, textAlign: 'center', marginTop: 10, lineHeight: 17 },

  // Consent
  consentAllBtn: { padding: 16, borderRadius: 14, borderWidth: 2, borderColor: colors.maroon, backgroundColor: colors.rose,
                   flexDirection: 'row', alignItems: 'center', gap: 12 },
  consentCheck: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: colors.maroon,
                  alignItems: 'center', justifyContent: 'center' },
  consentItem: { flexDirection: 'row', gap: 10, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: colors.line, alignItems: 'flex-start' },

  // Timeline
  stageRow: { flexDirection: 'row', gap: 14 },
  stageRail: { alignItems: 'center', width: 30 },
  stageDot: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  stageLine: { width: 2, flex: 1, backgroundColor: colors.line, marginVertical: 2 },
  stageBody: { flex: 1, paddingBottom: 20 },
  stageTitle: { fontSize: 15.5, fontWeight: '700', color: colors.ink },
  stageOwner: { fontSize: 12.5, color: colors.muted, marginTop: 3 },
  actionBanner: { marginHorizontal: 16, marginTop: 12, padding: 14, borderRadius: 14, backgroundColor: colors.goldPale,
                  borderWidth: 1, borderColor: '#EBC66A', flexDirection: 'row', alignItems: 'center', gap: 12 },
});

/** Grade badge used on the home card and the result screens. */
/**
 * A titled section that collapses. The badge on the header carries the count, so
 * a closed section still answers "how many" without being opened — which is the
 * only reason to collapse a list rather than truncate it.
 */
function Collapsible({
  title, badge, tone, open, onToggle, children,
}: {
  title: string;
  badge?: string | number;
  tone?: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [fin.collapseHead, pressed && styles.pressed]}
      >
        <Text style={fin.collapseTitle}>{title}</Text>
        {badge != null ? (
          <View style={[fin.collapseBadge, tone ? { backgroundColor: `${tone}22` } : null]}>
            <Text style={[fin.collapseBadgeText, tone ? { color: tone } : null]}>{badge}</Text>
          </View>
        ) : null}
        <Text style={fin.collapseChevron}>{open ? '−' : '+'}</Text>
      </Pressable>
      {open ? <Card style={{ marginHorizontal: 16, padding: 16 }}>{children}</Card> : null}
    </>
  );
}

/** Confidence is a property of the evidence, not of the farmer. */
const CONFIDENCE_TONE: Record<string, string> = {
  high: '#1E9E5A',
  medium: '#D97706',
  low: '#8A7680',
};

function GradeBadge({
  grade, size = 56, verified, confidence,
}: {
  grade: FinanceGrade | '?';
  size?: number;
  verified?: boolean;
  /** Renders a small ring on the badge instead of a separate text chip. */
  confidence?: string | null;
}) {
  const { tx, lang } = useLanguage();
  const color = GRADE_COLORS[grade];
  const tone = confidence ? CONFIDENCE_TONE[confidence] ?? CONFIDENCE_TONE.low : null;

  return (
    <View style={{ position: 'relative' }}>
      <View
        style={[
          fin.passportBadge,
          {
            width: size, height: size, borderRadius: size / 2,
            borderColor: color,
            backgroundColor: verified ? color : GRADE_TINTS[grade],
          },
        ]}
      >
        <Text style={[fin.passportBadgeText, { color: verified ? '#fff' : color, fontSize: size * 0.42 }]}>{grade}</Text>
      </View>

      {/* "Confidence: Low" spelled out next to a grade reads as a second, worse
          grade — people saw it as a judgement on them rather than on how much of
          their file we had verified. A filled/half/hollow ring carries the same
          three states without competing with the grade for meaning, and the
          accessibility label still says it in full. */}
      {tone ? (
        <View
          style={[fin.confidenceRing, { backgroundColor: confidence === 'low' ? colors.card : tone, borderColor: tone }]}
          accessibilityLabel={`${tx('তথ্য নির্ভরযোগ্যতা', 'Data confidence')}: ${financeLabel(confidence!, lang)}`}
        >
          <Text style={[fin.confidenceGlyph, { color: confidence === 'low' ? tone : '#fff' }]}>
            {confidence === 'high' ? '✓' : confidence === 'medium' ? '◐' : '○'}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function OutputChip({ label, tone }: { label: string; tone: string }) {
  return (
    <View style={[fin.chip, { borderColor: tone + '55', backgroundColor: tone + '14' }]}>
      <Text style={[fin.chipText, { color: tone }]}>{label}</Text>
    </View>
  );
}

/**
 * Field officer contact. Required at ten placements (MOB-LON-39); falls back to
 * central support rather than rendering empty, and reads from cache offline —
 * a phone number is exactly what a farmer needs when connectivity has failed.
 */
function OfficerHelpStrip({ district, title }: { district?: string | null; title?: string }) {
  const { tx, lang } = useLanguage();
  const officers = useApiList<ApiRow>(`community/officers${district ? `?district=${encodeURIComponent(district)}` : ''}`);
  const officer = officers.rows[0];
  const name = officer ? String(officer.name ?? officer.full_name ?? '') : tx('শাথী সেবা সহায়তা', 'Shathi Sheba support');
  const role = officer
    ? rowTitle({ title_bn: officer.role_bn, title_en: officer.role }, lang, tx('মাঠ কর্মকর্তা', 'Field officer'))
    : tx('কেন্দ্রীয় সহায়তা', 'Central support');
  const area = officer ? String(officer.upazila ?? officer.district ?? district ?? '') : '';
  const phone = officer ? String(officer.phone ?? officer.mobile ?? '') : '16234';
  const initials = (name || 'S').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

  return (
    <>
      <SectionTitle title={title ?? tx('আপনার এলাকার শাথী কর্মকর্তা', 'Your local Shathi officer')} />
      <Card style={fin.officerCard}>
        <View style={fin.officerRow}>
          <View style={fin.officerAvatar}>
            <Text style={fin.officerAvatarText}>{initials}</Text>
          </View>
          <View style={styles.flex}>
            <Text style={{ color: colors.ink, fontSize: 15.5, fontWeight: '700' }}>{name}</Text>
            <Text style={{ color: colors.muted, fontSize: 12.5, marginTop: 2 }}>
              {role}{area ? ` · ${area}` : ''}
            </Text>
            {phone ? <Text style={{ color: colors.muted, fontSize: 12.5, marginTop: 1 }}>{num(phone, lang)}</Text> : null}
          </View>
        </View>

        {/* Call and SMS both: a farmer standing in a field with one bar of signal
            can send a message when a call will not connect. */}
        <View style={fin.officerActions}>
          <Pressable
            onPress={() => Linking.openURL(`tel:${phone}`)}
            accessibilityLabel={tx('কল করুন', 'Call')}
            style={({ pressed }) => [fin.callBtn, pressed && styles.pressed]}
          >
            <Text style={fin.callBtnText}>📞  {tx('কল করুন', 'Call')}</Text>
          </Pressable>
          <Pressable
            onPress={() => Linking.openURL(`sms:${phone}`)}
            accessibilityLabel={tx('এসএমএস', 'SMS')}
            style={({ pressed }) => [fin.smsBtn, pressed && styles.pressed]}
          >
            <Text style={fin.smsBtnText}>✉  {tx('এসএমএস', 'SMS')}</Text>
          </Pressable>
        </View>

        <View style={fin.officerHours}>
          <Text style={{ color: colors.muted, fontSize: 12, lineHeight: 17 }}>
            🕐  {tx('শনি – বৃহস্পতি, সকাল ৯টা – সন্ধ্যা ৬টা। কল না ধরলে তিনি ফিরতি কল করবেন।',
                    'Sat – Thu, 9:00 am – 6:00 pm. If he cannot answer, he will call you back.')}
          </Text>
        </View>
      </Card>
    </>
  );
}

/** Shared fetch for the finance summary that backs the home card and ticker. */
function useFinanceSummary() {
  const { user } = useAuth();
  const tick = useRefreshTick();
  const [data, setData] = useState<FinanceSummary | null>(null);
  useEffect(() => {
    let alive = true;
    if (!user?.id) { setData(null); return; }
    (async () => {
      try {
        // Silent: this refires every time Home mounts, and a full-screen spinner
        // over an already-rendered page is what made returning from the loan
        // screens feel like the app had stalled.
        const res = await apiRequest<{ data?: FinanceSummary }>('app/finance/summary', { silent: true });
        if (alive) setData(res.data ?? null);
      } catch {
        // Keep whatever was last shown rather than blanking the card — a failed
        // background refresh is not a reason to remove information already on
        // screen.
      }
    })();
    return () => { alive = false; };
  }, [user?.id, tick]);
  return data;
}

/**
 * The home-screen Finance Passport card. Full width, directly below the metrics
 * band — a ⅓-width tile structurally cannot show Grade, Readiness Status and
 * Confidence as separate outputs, which P2 requires (decision D1). All three
 * existing metric tiles are preserved.
 */
function FinancePassportCard({ setScreen }: { setScreen: (screen: Screen) => void }) {
  const { tx, lang } = useLanguage();
  const summary = useFinanceSummary();
  if (!summary) return null;

  const grade = (summary.grade ?? '?') as FinanceGrade | '?';
  const verified = summary.state === 'loan_graded';
  const next = summary.next_payment;

  let kicker = tx('ফাইন্যান্স প্রস্তুতি', 'Finance readiness');
  let title = tx('আপনি কি ঋণের জন্য প্রস্তুত?', 'Are you finance ready?');
  let sub = tx('২ মিনিটের চেক নিন', 'Take the 2-minute check');
  let target: Screen = 'financeReadinessIntro';

  if (summary.state === 'readiness' || summary.state === 'readiness_partial') {
    kicker = tx('স্ব-ঘোষিত', 'Self-declared');
    title = tx('সম্ভাব্য প্রস্তুতি স্কোর', 'Indicative readiness score');
    sub = summary.state === 'readiness_partial'
      ? tx('১০/২০ প্রশ্ন — ফলাফল আরও নির্ভুল করুন', '10 of 20 answered — make your result more accurate')
      : `${num(summary.score ?? 0, lang)} / ${num(100, lang)}`;
    target = 'financeReadinessResult';
  } else if (summary.state === 'loan_in_progress') {
    kicker = tx('ঋণ আবেদন', 'Loan application');
    title = tx('ঋণ আবেদন চলমান', 'Loan application in progress');
    sub = `${tx('ধাপ', 'Stage')} ${num(summary.stage_index ?? 1, lang)} / ${num(summary.stage_total, lang)}`;
    target = 'loanStatus';
  } else if (summary.state === 'loan_graded') {
    kicker = tx('যাচাইকৃত', 'Verified');
    title = tx('আপনার ঋণ ঝুঁকি গ্রেড', 'Your credit risk grade');
    sub = financeLabel(summary.readiness_status, lang);
    // Once an assessment exists, the passport opens the result rather than the
    // timeline — the grade on the card is the thing the tap is asking about.
    target = 'loanResult';
  }

  // A live repayment outranks everything above it. Once money is owed, the card
  // is about the next instalment, not the grade that got them the loan.
  if (next) {
    kicker = tx('চলমান ঋণ', 'Active loan');
    title = tx('পরবর্তী কিস্তি', 'Next instalment');
    sub = `${amount(next.amount, lang)} · ${next.due_date}`;
    target = 'loanAccount';
  }

  return (
    <>
      <Pressable onPress={() => setScreen(target)} style={({ pressed }) => [pressed && styles.pressed]}>
        <Card style={fin.passport}>
          <GradeBadge grade={grade} verified={verified} confidence={summary?.data_confidence} />
          <View style={styles.flex}>
            <Text style={[fin.passportKicker, { color: verified ? GRADE_COLORS[grade] : colors.muted }]}>{kicker}</Text>
            <Text style={fin.passportTitle}>{title}</Text>
            <Text style={fin.passportSub}>{sub}</Text>
            {(summary.readiness_status || summary.data_confidence) && summary.state !== 'not_assessed' ? (
              <View style={fin.chipRow}>
                {summary.grade ? <OutputChip label={`${tx('গ্রেড', 'Grade')} ${summary.grade}`} tone={GRADE_COLORS[grade]} /> : null}
                {summary.readiness_status ? <OutputChip label={financeLabel(summary.readiness_status, lang)} tone={colors.maroon} /> : null}
                {/* Data confidence is deliberately NOT a chip here — it rides on
                    the grade badge as a ring (see GradeBadge). Spelled out beside
                    the grade it read as a second, worse grade. */}
              </View>
            ) : null}
          </View>
          <Text style={fin.chevron}>›</Text>
        </Card>
      </Pressable>

      {next ? (
        <Pressable onPress={() => setScreen('loanStatus')} style={({ pressed }) => [pressed && styles.pressed]}>
          <Card style={[fin.ticker, next.state === 'overdue' && { borderColor: colors.danger, borderWidth: 1.5 }]}>
            <View style={styles.flex}>
              <Text style={{ color: colors.muted, fontSize: 12.5, fontWeight: '600' }}>{tx('পরবর্তী কিস্তি', 'Next payment')}</Text>
              <Text style={fin.tickerAmount}>{amount(next.amount, lang)}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{
                fontSize: 13, fontWeight: '800',
                color: next.state === 'overdue' ? colors.danger : next.state === 'normal' ? colors.muted : colors.gold,
              }}>
                {next.state === 'overdue'
                  ? `${num(Math.abs(next.days_remaining), lang)} ${tx('দিন পার', 'days late')}`
                  : next.state === 'due_today'
                    ? tx('আজ পরিশোধ', 'Due today')
                    : `${num(next.days_remaining, lang)} ${tx('দিন বাকি', 'days left')}`}
              </Text>
              <Text style={{ color: colors.muted, fontSize: 11.5, marginTop: 2 }}>{formatDate(next.due_date, lang)}</Text>
            </View>
          </Card>
        </Pressable>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Feature 1 — Readiness
// ---------------------------------------------------------------------------

function FinanceReadinessIntro({ setScreen }: { setScreen: (screen: Screen) => void }) {
  const { tx } = useLanguage();
  return (
    <>
      <Header title={tx('ফাইন্যান্স প্রস্তুতি', 'Finance Readiness')} onBack={() => setScreen('home')} />
      <RefreshScroll>
        <Card style={{ marginHorizontal: 16, marginTop: 14, padding: 20 }}>
          <Text style={{ fontSize: 40, textAlign: 'center' }}>🧭</Text>
          <Text style={{ color: colors.ink, fontSize: 21, fontWeight: '800', textAlign: 'center', marginTop: 10, lineHeight: 30 }}>
            {tx('আপনি কি ঋণের জন্য প্রস্তুত?', 'Are you ready for finance?')}
          </Text>
          <Text style={{ color: colors.muted, fontSize: 14.5, textAlign: 'center', marginTop: 10, lineHeight: 22 }}>
            {tx(
              'কয়েকটি সহজ হ্যাঁ/না প্রশ্নের উত্তর দিন। আমরা আপনাকে দেখাব কোথায় আপনি শক্তিশালী এবং কী করলে আপনার সম্ভাবনা বাড়বে।',
              'Answer a few simple yes/no questions. We will show you where you are strong and what would improve your chances.'
            )}
          </Text>
        </Card>

        <Card style={{ marginHorizontal: 16, marginTop: 12, padding: 16 }}>
          {[
            ['১', '1', tx('অংশ ১ — ১০টি প্রশ্ন', 'Part 1 — 10 questions'), tx('প্রায় ৯০ সেকেন্ড। সাথে সাথে ফলাফল।', 'About 90 seconds. Instant result.')],
            ['২', '2', tx('অংশ ২ — আরও ১০টি', 'Part 2 — 10 more'), tx('ঐচ্ছিক। ফলাফল আরও নির্ভুল হয়।', 'Optional. Makes your result more accurate.')],
          ].map(([bnNum, enNum, title, sub]) => (
            <View key={String(enNum)} style={{ flexDirection: 'row', gap: 12, marginBottom: 12, alignItems: 'flex-start' }}>
              <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: colors.rose, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: colors.maroon, fontWeight: '800' }}>{tx(String(bnNum), String(enNum))}</Text>
              </View>
              <View style={styles.flex}>
                <Text style={{ color: colors.ink, fontSize: 15, fontWeight: '700' }}>{title}</Text>
                <Text style={{ color: colors.muted, fontSize: 13, marginTop: 2, lineHeight: 19 }}>{sub}</Text>
              </View>
            </View>
          ))}
        </Card>

        <Card style={{ marginHorizontal: 16, marginTop: 12, padding: 14, backgroundColor: colors.goldPale, borderWidth: 1, borderColor: '#EBC66A' }}>
          <Text style={{ color: '#7A5200', fontSize: 13.5, lineHeight: 20, fontWeight: '600' }}>
            {tx(
              'এটি একটি প্রাথমিক ধারণা। এটি ঋণ অনুমোদন নয়।',
              'This is an initial indication only. It is not a loan approval.'
            )}
          </Text>
        </Card>

        <View style={{ paddingHorizontal: 16, marginTop: 18, marginBottom: 28 }}>
          <AppButton title={tx('শুরু করুন', 'Start')} onPress={() => setScreen('financeReadinessQuiz')} />
        </View>
      </RefreshScroll>
    </>
  );
}

/** Tag vocabulary from the questionnaire screens. */
const CATEGORY_TONE: Record<string, string> = {
  kyc: '#EFE7EB',
  enterprise: '#E7EFFE',
  financial: '#FDF3E3',
};

const CATEGORY_ICON: Record<string, string> = {
  kyc: '🪪',
  enterprise: '🌾',
  financial: '💰',
};

function categoryLabel(category: string, lang: Lang) {
  const map: Record<string, [string, string]> = {
    kyc: ['কেওয়াইসি', 'KYC'],
    enterprise: ['ব্যবসা', 'Enterprise'],
    financial: ['আর্থিক', 'Financial'],
  };
  const pair = map[category];
  return pair ? (lang === 'bn' ? pair[0] : pair[1]) : category;
}

function FinanceReadinessQuiz({
  setScreen, part, onFinished,
}: {
  setScreen: (screen: Screen) => void;
  part: 'core' | 'deep';
  onFinished: (result: ReadinessResult) => void;
}) {
  const { tx, lang } = useLanguage();
  const [questions, setQuestions] = useState<ReadinessQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, boolean>>({});
  const [index, setIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await apiRequest<{ data?: { questions: ReadinessQuestion[] } }>('app/finance/readiness/questions');
        if (!alive) return;
        setQuestions(res.data?.questions ?? []);
      } catch (e) {
        if (alive) setError(naturalApiError(e, lang));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [lang]);

  // Branching is evaluated from the server-declared rule only (MOB-RDY-11A).
  const visible = useMemo(() => {
    return questions
      .filter((q) => q.part === part)
      .filter((q) => {
        if (!q.branch_parent_id || !q.branch_show_when) return true;
        const parent = answers[q.branch_parent_id];
        // Part 2's branch parents were answered back in Part 1 and are not in
        // this screen's state, so an undefined parent is "I cannot know", not
        // "No". Falling back to false hid Q11-13 and offered seven questions
        // while the server still required ten, which made the submission
        // unrejectable-but-refused. The server's verdict is derived from the
        // stored answer; it never sends the answer itself.
        if (parent === undefined) return q.branch_default_visible === true;
        return parent === (q.branch_show_when === 'yes');
      })
      .sort((a, b) => a.sort_order - b.sort_order);
  }, [questions, part, answers]);

  const current = visible[index];
  const total = visible.length;

  async function answer(value: boolean) {
    if (!current) return;
    const next = { ...answers, [current.id]: value };
    setAnswers(next);

    if (index + 1 < total) { setIndex(index + 1); return; }

    // Last question of the part — submit everything presented in this part.
    setSubmitting(true);
    setError('');
    try {
      const payload = visible.map((q) => ({ question_id: q.id, answer: !!next[q.id] }));
      const res = await apiRequest<{ result?: ReadinessResult }>('app/finance/readiness/submit', {
        method: 'POST',
        body: JSON.stringify({ part, answers: payload }),
      });
      if (res.result) onFinished(res.result);
    } catch (e) {
      // Answers are never lost on failure (MOB-RDY-14).
      setError(naturalApiError(e, lang));
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <>
        <Header title={tx('প্রস্তুতি প্রশ্নমালা', 'Readiness questionnaire')} onBack={() => setScreen('financeReadinessIntro')} />
        <View style={{ padding: 24 }}>
          <ActivityIndicator color={colors.maroon} />
        </View>
      </>
    );
  }

  const helper = current ? (lang === 'bn' ? current.helper_bn : current.helper_en) : null;

  return (
    <>
      <Header
        title={tx('প্রস্তুতি প্রশ্নমালা', 'Readiness questionnaire')}
        onBack={() => (index > 0 ? setIndex(index - 1) : setScreen('financeReadinessIntro'))}
        right={total ? `${tx('প্রশ্ন', 'Question')} ${num(index + 1, lang)} / ${num(total, lang)}` : undefined}
      />

      {/* Fixed column, not a scroll view: the answer buttons sit on the bottom
          edge on every question, so the tap target never moves between one
          question and the next. Only the body scrolls if a question runs long. */}
      <View style={fin.quizPage}>
        <View style={fin.progressTrack}>
          <View style={[fin.progressFill, { width: `${total ? ((index + 1) / total) * 100 : 0}%` }]} />
        </View>

        {current ? (
          <>
            <ScrollView
              style={styles.flex}
              contentContainerStyle={fin.quizBody}
              showsVerticalScrollIndicator={false}
            >
              <View style={fin.tagRow}>
                <View style={fin.tagPhase}>
                  <Text style={fin.tagPhaseText}>
                    {part === 'core' ? tx('অংশ ১', 'Phase 1') : tx('অংশ ২', 'Phase 2')}
                  </Text>
                </View>
                {current.category ? (
                  <View style={[fin.tagCat, { backgroundColor: CATEGORY_TONE[current.category] ?? colors.line }]}>
                    <Text style={fin.tagCatText}>{categoryLabel(current.category, lang)}</Text>
                  </View>
                ) : null}
              </View>

              {/* Only for the two questions that behave differently from the rest.
                  Saying so up front is fairer than letting someone discover it
                  from a score that did not move. */}
              {current.flag ? (
                <View style={fin.tagFlag}>
                  <Text style={fin.tagFlagText}>
                    {current.flag === 'gate'
                      ? tx('গেট প্রশ্ন — "না" হলে স্কোর নয়', 'Gate — "No" suppresses the score')
                      : tx('ঝুঁকি প্রশ্ন', 'Risk override')}
                  </Text>
                </View>
              ) : null}

              <View style={fin.questionRow}>
                <View style={[fin.questionIcon, current.flag === 'gate' || current.flag === 'risk'
                  ? { backgroundColor: colors.goldPale } : null]}>
                  <Text style={{ fontSize: 22 }}>
                    {current.flag ? '⚠️' : CATEGORY_ICON[current.category ?? 'financial']}
                  </Text>
                </View>
                <Text style={fin.questionText}>
                  {lang === 'bn' ? current.question_bn : current.question_en}
                </Text>
              </View>

              {/* Always open. Collapsed, it was a row of chevrons nobody tapped in
                  the middle of an otherwise empty screen — the space was there
                  either way, so the explanation may as well be in it. */}
              {helper ? (
                <>
                  <Text style={fin.whyTitle}>{tx('কেন জিজ্ঞাসা করছি?', 'Why we ask')}</Text>
                  <View style={fin.whyBox}>
                    <Text style={fin.whyText}>{helper}</Text>
                  </View>
                </>
              ) : null}
            </ScrollView>

            <View style={fin.answerDock}>
              {error ? <Text style={fin.quizError}>{error}</Text> : null}

              <Pressable
                disabled={submitting}
                onPress={() => answer(true)}
                accessibilityRole="button"
                accessibilityLabel={tx('হ্যাঁ', 'Yes')}
                style={({ pressed }) => [fin.answerBtn, pressed && styles.pressed]}
              >
                <Text style={[fin.answerGlyph, { color: colors.green }]}>✓</Text>
                <Text style={fin.answerLabel}>{tx('হ্যাঁ', 'Yes')}</Text>
              </Pressable>

              <Pressable
                disabled={submitting}
                onPress={() => answer(false)}
                accessibilityRole="button"
                accessibilityLabel={tx('না', 'No')}
                style={({ pressed }) => [fin.answerBtn, pressed && styles.pressed]}
              >
                <Text style={[fin.answerGlyph, { color: colors.muted }]}>✕</Text>
                <Text style={fin.answerLabel}>{tx('না', 'No')}</Text>
              </Pressable>

              <Text style={fin.privacyNote}>
                {tx('আপনার উত্তর গোপন থাকবে। "হ্যাঁ" সবসময় ভালো উত্তর।',
                    'Your answers stay private. "Yes" is always the favourable answer.')}
              </Text>
            </View>
          </>
        ) : (
          <View style={{ padding: 24 }}>
            <Text style={fin.questionText}>{tx('কোনো প্রশ্ন পাওয়া যায়নি।', 'No questions available.')}</Text>
          </View>
        )}

        {submitting ? (
          <View style={fin.quizSubmitting}>
            <ActivityIndicator color={colors.maroon} />
          </View>
        ) : null}
      </View>
    </>
  );
}

/**
 * What each grade band tells the farmer to do next. The grade letter and its
 * label say where they stand; this says what to do about it, which is the part
 * a farmer reads first.
 */
const GRADE_NEXT_STEP: Record<FinanceGrade, { bn: string; en: string }> = {
  A: {
    bn: 'আপনি সম্পূর্ণ প্রস্তুত — এখনই ব্যাংক বা এমএফআই ঋণের জন্য আবেদন করুন।',
    en: 'You are fully ready — apply for bank or MFI finance now.',
  },
  B: {
    bn: 'শাথী প্রকল্প ও সহজ শর্তের ছোট ঋণ দিয়ে শুরু করুন।',
    en: 'Start with a Shathi project and a starter loan.',
  },
  C: {
    bn: 'উন্নয়ন পরিকল্পনা দিয়ে শুরু করুন, তারপর আবেদন করুন।',
    en: 'Start with a development plan, then apply.',
  },
  D: {
    bn: 'প্রস্তুতির প্রোফাইল গড়তে কর্মকর্তার সহায়তা নিন।',
    en: 'Get support from your officer to build your readiness profile.',
  },
};

function gradeMessage(grade: FinanceGrade, lang: Lang): string {
  const band = GRADE_NEXT_STEP[grade];
  if (!band) return '';
  return lang === 'bn' ? band.bn : band.en;
}

function FinanceReadinessResult({
  setScreen, result, onContinuePart2, onOpenSheet, onNavigateAway,
}: {
  setScreen: (screen: Screen) => void;
  result: ReadinessResult | null;
  onContinuePart2: () => void;
  onOpenSheet: (topic: string) => void;
  /** Navigate out while recording this screen as the place back should return to. */
  onNavigateAway: (screen: Screen) => void;
}) {
  const { tx, lang } = useLanguage();
  const { user } = useAuth();
  const [signals, setSignals] = useState<ConfidenceSignal[]>([]);
  const [loaded, setLoaded] = useState<ReadinessResult | null>(result);
  const [showAllActions, setShowAllActions] = useState(false);
  const [showStrengths, setShowStrengths] = useState(false);
  const [showGaps, setShowGaps] = useState(false);
  // Only true while a fetch is actually running. Starting from `!result` rather
  // than `true` keeps a result passed in by the quiz from flashing a spinner.
  const [busy, setBusy] = useState(!result);
  // A weak grade gets one honest interstitial before the apply button appears.
  const [acknowledgedWeak, setAcknowledgedWeak] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!result) {
          const res = await apiRequest<{ data?: ReadinessResult }>('app/finance/readiness/latest');
          // Must be an actual assessment. A truthy-but-empty payload here is what
          // made this screen render a result with no grade in it.
          const d = res.data as ReadinessResult | undefined;
          if (alive && d && typeof d === 'object' && !Array.isArray(d) && d.grade) setLoaded(d);
        }
        const sig = await apiRequest<{ data?: ConfidenceSignal[] }>('app/finance/readiness/signals');
        if (alive) setSignals(sig.data ?? []);
      } catch {
        /* the result screen still renders from whatever it already has */
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => { alive = false; };
  }, [result]);

  const r = loaded;

  // Two different "no result" cases, and they must not look the same. While the
  // fetch is in flight a spinner is right; once it has finished and there is
  // genuinely nothing, a spinner is a screen that never resolves — which is what
  // the Profile menu entry landed on for anyone who had not taken the check yet.
  if (!r) {
    return (
      <>
        <Header title={tx('আপনার ফলাফল', 'Your result')} onBack={() => setScreen('profile')} />
        {busy ? (
          <View style={{ padding: 24 }}><ActivityIndicator color={colors.maroon} /></View>
        ) : (
          <RefreshScroll>
            <Card style={{ marginHorizontal: 16, marginTop: 16, padding: 18 }}>
              <Text style={{ color: colors.ink, fontSize: 17, fontWeight: '800' }}>
                {tx('এখনো প্রস্তুতি যাচাই করা হয়নি', 'You have not taken the check yet')}
              </Text>
              <Text style={{ color: colors.muted, fontSize: 13.5, marginTop: 8, lineHeight: 20 }}>
                {tx('১০টি সহজ প্রশ্নের উত্তর দিন — মাত্র ২ মিনিট। আপনি ঋণের জন্য কতটা প্রস্তুত তা জানতে পারবেন।',
                    'Answer 10 simple questions — about 2 minutes. You will see how finance-ready you are.')}
              </Text>
              <View style={{ marginTop: 14 }}>
                <AppButton title={tx('শুরু করুন', 'Start the check')} onPress={() => setScreen('financeReadinessIntro')} />
              </View>
            </Card>
            <OfficerHelpStrip district={user?.district} />
            <View style={{ height: 28 }} />
          </RefreshScroll>
        )}
      </>
    );
  }

  const provisional = r.depth === 'core';
  const weakGrade = r.grade === 'C' || r.grade === 'D';

  // The invitation used to promise ten regardless. Q11-13 are only presented to
  // someone who answered Yes to Q9 ("have you ever borrowed?"), so a farmer who
  // has never borrowed is shown seven — and a screen that said ten read as a bug
  // rather than as the branching working. The server counts what will actually
  // be asked, because only it holds the answers; ten is the fallback for an
  // older response that predates the field.
  const part2Pending = r.part2_pending ?? 10;
  const actions = showAllActions ? r.actions : r.actions.slice(0, 5);

  function runAction(link: string | null) {
    const target = resolveActionLink(link);
    if (!target) return;
    if (target.kind === 'sheet') { onOpenSheet(target.topic); return; }
    // Remember where we came from so the destination's back button returns here
    // rather than to whatever it normally falls back to.
    onNavigateAway(target.screen);
  }

  return (
    <>
      {/* Retake lives on the badge now, where the score it replaces is. */}
      <Header title={tx('আপনার ফলাফল', 'Your result')} onBack={() => setScreen('home')} />
      <RefreshScroll>
        {/* (1) Score badge. One maroon block carries grade, score, the band's
            next step, all three status chips, the provisional note and the
            retake control. The previous layout stacked the same information
            down a white card and pushed the breakdown a full screen below the
            fold. */}
        <View style={fin.badge}>
          <View style={fin.badgeTop}>
            <View>
              <View style={[fin.badgeRing, { borderColor: GRADE_COLORS[r.grade], backgroundColor: GRADE_TINTS[r.grade] }]}>
                <Text style={[fin.badgeGrade, { color: GRADE_COLORS[r.grade] }]}>{r.grade}</Text>
              </View>
              {/* The amber pip marks a part-1-only score, so the ring itself
                  says "not final" without a second line of text. */}
              {provisional ? <View style={fin.badgePip} /> : null}
            </View>
            <View style={styles.flex}>
              <Text style={fin.badgeScoreLabel}>{tx('সম্ভাব্য প্রস্তুতি স্কোর', 'Indicative readiness score')}</Text>
              <Text style={fin.badgeScore}>
                {num(r.score, lang)}<Text style={fin.badgeOutOf}> / {num(100, lang)}</Text>
              </Text>
            </View>
          </View>

          <Text style={fin.badgeMessage}>{gradeMessage(r.grade, lang)}</Text>

          <View style={fin.badgeChipRow}>
            {[
              `${tx('গ্রেড', 'Grade')} ${r.grade}`,
              financeLabel(r.readiness_status, lang),
              `${tx('তথ্য যাচাই', 'Verification')}: ${financeLabel(r.data_confidence, lang)}`,
            ].map((label, i) => (
              <View key={label} style={fin.badgeChip}>
                <Text style={[fin.badgeChipText, i === 1 && fin.badgeChipTextGold]}>{label}</Text>
              </View>
            ))}
          </View>

          {provisional ? (
            <View style={fin.badgeProvisional}>
              <Text style={fin.badgeProvisionalTag}>{tx('প্রাথমিক ফলাফল', 'Provisional result')}</Text>
              <Text style={fin.badgeProvisionalNote}>
                {tx(`বাকি ${num(part2Pending, 'bn')}টি প্রশ্নের উত্তর দিলে স্কোর বাড়তে বা কমতে পারে।`,
                    `Your score may go up or down once you answer the remaining ${part2Pending} questions.`)}
              </Text>
            </View>
          ) : null}

          <View style={fin.badgeFoot}>
            <View style={styles.flex}>
              <Text style={fin.badgeMicro}>{tx('স্ব-ঘোষিত মূল্যায়ন', 'Self-declared assessment')}</Text>
              {r.created_at ? <Text style={fin.badgeMicro}>{formatDate(r.created_at, lang)}</Text> : null}
            </View>
            <Pressable
              onPress={() => setScreen('financeReadinessIntro')}
              style={({ pressed }) => [fin.badgeRetake, pressed && styles.pressed]}
            >
              <Text style={fin.badgeRetakeText}>{tx('আবার মূল্যায়ন', 'Retake')}</Text>
            </Pressable>
          </View>
        </View>

        {/* Gate / risk flag lead with the single corrective action (ENG-06) */}
        {r.gate_triggered ? (
          <Card style={{ marginHorizontal: 16, marginTop: 12, padding: 14, backgroundColor: '#F8EAE9', borderWidth: 1, borderColor: '#E5B5B1' }}>
            <Text style={{ color: '#8A2F28', fontWeight: '800', fontSize: 15 }}>{tx('এখনই সম্ভব নয়', 'Not possible yet')}</Text>
            <Text style={{ color: '#8A2F28', fontSize: 13.5, marginTop: 6, lineHeight: 20 }}>
              {tx('বৈধ এনআইডি ছাড়া কোনো ঋণ সম্ভব নয়। এটিই আপনার প্রথম কাজ।',
                  'No finance is possible without a valid National ID. This is your first step.')}
            </Text>
            <View style={{ marginTop: 12 }}>
              <AppButton title={tx('এনআইডি যোগ করুন', 'Add your NID')} onPress={() => setScreen('menuKyc')} />
            </View>
          </Card>
        ) : null}

        {r.risk_flag === 'ARREARS' ? (
          <Card style={{ marginHorizontal: 16, marginTop: 12, padding: 14, backgroundColor: colors.goldPale, borderWidth: 1, borderColor: '#EBC66A' }}>
            <Text style={{ color: '#7A5200', fontWeight: '800', fontSize: 15 }}>{tx('বকেয়া কিস্তি আছে', 'You have overdue instalments')}</Text>
            <Text style={{ color: '#7A5200', fontSize: 13.5, marginTop: 6, lineHeight: 20 }}>
              {tx('এটি সবচেয়ে জরুরি বিষয়। এটি ঠিক হলে আপনার অবস্থান অনেক ভালো হবে।',
                  'This matters most. Clearing it will improve your position substantially.')}
            </Text>
            <View style={{ marginTop: 12 }}>
              <AppButton variant="outline" title={tx('কীভাবে করব', 'How to fix this')} onPress={() => onOpenSheet('clear_arrears')} />
            </View>
          </Card>
        ) : null}

        {/* ② Part 2 continuation — honest that the score can move either way */}
        {provisional ? (
          <Card style={{ marginHorizontal: 16, marginTop: 12, padding: 16, backgroundColor: colors.goldPale, borderWidth: 1, borderColor: '#EBC66A' }}>
            <Text style={{ color: '#7A5200', fontWeight: '800', fontSize: 15.5 }}>
              {tx('এটি প্রাথমিক ফলাফল', 'This is a provisional result')}
            </Text>
            <Text style={{ color: '#7A5200', fontSize: 13.5, marginTop: 6, lineHeight: 20 }}>
              {tx(`বাকি ${num(part2Pending, 'bn')}টি প্রশ্নের উত্তর দিলে স্কোর বাড়তে বা কমতে পারে।`,
                  `Your score may go up or down once you answer the remaining ${part2Pending} questions.`)}
            </Text>
            <View style={{ marginTop: 12 }}>
              <AppButton
                title={tx(`আরও ${num(part2Pending, 'bn')}টি প্রশ্নের উত্তর দিন`, `Answer ${part2Pending} more questions`)}
                onPress={onContinuePart2}
              />
            </View>
          </Card>
        ) : null}

        {/* ③ Category breakdown — percentages only, never weights (P6) */}
        <SectionTitle title={tx('বিস্তারিত', 'Breakdown')} />
        <Card style={{ marginHorizontal: 16, padding: 16 }}>
          {[
            [tx('পরিচয় ও কাগজপত্র', 'Identity & documents'), r.categories.kyc],
            [tx('উদ্যোগ ও সম্পদ', 'Enterprise & assets'), r.categories.enterprise],
            [tx('আর্থিক অবস্থা', 'Financial position'), r.categories.financial],
          ].map(([label, value]) => (
            <View key={String(label)} style={fin.barRow}>
              <View style={fin.barLabelRow}>
                <Text style={fin.barLabel}>{label}</Text>
                <Text style={fin.barValue}>{num(Number(value), lang)}%</Text>
              </View>
              <View style={fin.barTrack}>
                <View style={[fin.barFill, { width: `${Math.max(0, Math.min(100, Number(value)))}%` }]} />
              </View>
            </View>
          ))}
        </Card>

        {/* ④ Profile strength — what we can already verify (ENG-08 / MOB-RDY-15) */}
        <SectionTitle title={tx('প্রোফাইলের শক্তি', 'Profile strength')} />
        <Card style={{ marginHorizontal: 16, padding: 16 }}>
          <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 19, marginBottom: 10 }}>
            {tx('আপনার দেওয়া তথ্যের কতটুকু আমরা যাচাই করতে পেরেছি',
                'How much of what you told us we can already verify')}
          </Text>

          {/* A segment per signal, filled for the ones that are confirmed. A
              plain count tells you the number; the bar tells you the shape of
              what is missing at a glance. */}
          <View style={fin.strengthBar}>
            {signals.map((s) => (
              <View
                key={`bar-${s.code}`}
                style={[fin.strengthSeg, { backgroundColor: s.present ? colors.maroon : colors.line }]}
              />
            ))}
          </View>
          <View style={fin.strengthMeta}>
            <Text style={{ color: colors.ink, fontSize: 13, fontWeight: '700' }}>
              {num(signals.filter((s) => s.present).length, lang)} / {num(signals.length, lang)}{' '}
              {tx('সংকেত যাচাই হয়েছে', 'signals confirmed')}
            </Text>
            <OutputChip
              label={`${tx('তথ্য নির্ভরযোগ্যতা', 'Data confidence')}: ${financeLabel(r.data_confidence, lang)}`}
              tone={colors.blue}
            />
          </View>

          {signals.map((s) => (
            <Pressable
              key={s.code}
              disabled={s.present}
              onPress={() => runAction(s.fix_deeplink)}
              style={({ pressed }) => [fin.signalRow, pressed && !s.present && styles.pressed]}
            >
              <View style={[fin.signalDot, { backgroundColor: s.present ? '#E6F5ED' : colors.rose }]}>
                <Text style={{ color: s.present ? colors.green : colors.muted, fontWeight: '800', fontSize: 12 }}>
                  {s.present ? '✓' : '+'}
                </Text>
              </View>
              <Text style={[styles.flex, { color: s.present ? colors.ink : colors.muted, fontSize: 14 }]}>
                {lang === 'bn' ? s.label_bn : s.label_en}
              </Text>
              {!s.present ? <Text style={{ color: colors.maroon, fontSize: 18 }}>›</Text> : null}
            </Pressable>
          ))}
        </Card>

        {/* ⑤ Remarks. Collapsed by default with the count on the header: a strong
            profile can produce fifteen strengths, and an unbroken wall of ticks
            buries the two or three gaps that are the actionable part. */}
        {r.strengths.length ? (
          <Collapsible
            title={tx('যা শক্তিশালী', 'What is strong')}
            badge={`${num(r.strengths.length, lang)} / ${num(r.strengths.length + r.gaps.length, lang)}`}
            open={showStrengths}
            onToggle={() => setShowStrengths((v) => !v)}
          >
            {r.strengths.map((s, i) => (
              <View key={`s${i}`} style={fin.listItem}>
                <Text style={[fin.listGlyph, { color: colors.green }]}>✓</Text>
                <Text style={fin.listText}>{lang === 'bn' ? s.bn : s.en}</Text>
              </View>
            ))}
          </Collapsible>
        ) : null}

        {r.gaps.length ? (
          <Collapsible
            title={tx('যা উন্নত করা দরকার', 'What needs improvement')}
            badge={num(r.gaps.length, lang)}
            tone={colors.gold}
            open={showGaps}
            onToggle={() => setShowGaps((v) => !v)}
          >
            {r.gaps.map((g, i) => (
              <View key={`g${i}`} style={fin.listItem}>
                <Text style={[fin.listGlyph, { color: colors.gold }]}>•</Text>
                <Text style={fin.listText}>{lang === 'bn' ? g.bn : g.en}</Text>
              </View>
            ))}
          </Collapsible>
        ) : null}

        {/* ⑥ Recommended actions — ranked, deep-linked */}
        {r.actions.length ? (
          <>
            <SectionTitle title={tx('এখন কী করবেন', 'What to do next')} />
            <Card style={{ marginHorizontal: 16, padding: 16, paddingBottom: 4 }}>
              {actions.map((a, i) => (
                <Pressable key={`a${i}`} onPress={() => runAction(a.deeplink)} style={({ pressed }) => [fin.actionRow, pressed && styles.pressed]}>
                  <Text style={{ fontSize: 18 }}>{i + 1 === 1 ? '⭐' : '→'}</Text>
                  <View style={styles.flex}>
                    <Text style={fin.actionTitle}>{lang === 'bn' ? a.title_bn : a.title_en}</Text>
                    {(a.rationale_bn || a.rationale_en) ? (
                      <Text style={fin.actionSub}>{lang === 'bn' ? a.rationale_bn : a.rationale_en}</Text>
                    ) : null}
                  </View>
                  <Text style={{ color: colors.muted, fontSize: 20 }}>›</Text>
                </Pressable>
              ))}
              {r.actions.length > 5 ? (
                <Pressable onPress={() => setShowAllActions((v) => !v)} style={{ paddingVertical: 12 }}>
                  <Text style={{ color: colors.maroon, fontWeight: '700', textAlign: 'center' }}>
                    {showAllActions ? tx('কম দেখুন', 'Show less') : tx('আরও দেখুন', 'See more')}
                  </Text>
                </Pressable>
              ) : null}
            </Card>
          </>
        ) : null}

        {/* Apply CTA only where the status permits it (MOB-RDY-21) */}
        {['bank_ready_indicative', 'conditionally_ready', 'project_ready'].includes(r.readiness_status) ? (
          <View style={{ paddingHorizontal: 16, marginTop: 18 }}>
            {weakGrade && !acknowledgedWeak ? (
              <>
                {/* Never a block — the farmer may still apply. But saying what is
                    likely to happen first is the difference between an informed
                    choice and a wasted visit for both sides. */}
                <Card style={fin.weakNotice}>
                  <Text style={fin.weakTitle}>
                    {tx('আবেদনের আগে জেনে নিন', 'Before you apply')}
                  </Text>
                  <Text style={fin.weakBody}>
                    {tx('আপনার বর্তমান গ্রেড ' + r.grade + '। এখনই আবেদন করলে অনুমোদনের সম্ভাবনা কম, এবং প্রক্রিয়াটি কয়েক সপ্তাহ সময় নেয়। উপরের ধাপগুলো আগে সম্পন্ন করলে সম্ভাবনা অনেক বাড়ে।',
                        `Your current grade is ${r.grade}. Applying now is unlikely to be approved, and the process takes several weeks. Completing the steps above first improves your chances considerably.`)}
                  </Text>
                  <View style={{ marginTop: 12, gap: 8 }}>
                    <AppButton
                      title={tx('আগে ধাপগুলো সম্পন্ন করি', 'I will complete the steps first')}
                      onPress={() => setShowGaps(true)}
                    />
                    <AppButton
                      variant="outline"
                      title={tx('তবুও আবেদন করব', 'Apply anyway')}
                      onPress={() => setAcknowledgedWeak(true)}
                    />
                  </View>
                </Card>
              </>
            ) : (
              <AppButton title={tx('ঋণের জন্য আবেদন করুন', 'Apply for finance')} onPress={() => setScreen('financeHub')} />
            )}
          </View>
        ) : null}

        {/* ⑦ Local officer */}
        <OfficerHelpStrip district={user?.district} />
        <View style={{ height: 28 }} />
      </RefreshScroll>
    </>
  );
}

function FinanceGuidanceSheet({ setScreen, topic }: { setScreen: (screen: Screen) => void; topic: string }) {
  const { tx, lang } = useLanguage();
  const { user } = useAuth();
  const t = GUIDANCE_TOPICS[topic];

  return (
    <>
      <Header
        title={t ? (lang === 'bn' ? t.title_bn : t.title_en) : tx('সহায়তা', 'Guidance')}
        onBack={() => setScreen('financeReadinessResult')}
      />
      <RefreshScroll>
        {t ? (
          <>
            <Card style={{ marginHorizontal: 16, marginTop: 14, padding: 18 }}>
              <Text style={{ color: colors.ink, fontSize: 15, lineHeight: 23 }}>
                {lang === 'bn' ? t.intro_bn : t.intro_en}
              </Text>
            </Card>
            <SectionTitle title={tx('ধাপে ধাপে', 'Step by step')} />
            <Card style={{ marginHorizontal: 16, padding: 16 }}>
              {(lang === 'bn' ? t.steps_bn : t.steps_en).map((step, i) => (
                <View key={`step${i}`} style={{ flexDirection: 'row', gap: 12, marginBottom: 14, alignItems: 'flex-start' }}>
                  <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: colors.rose, alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ color: colors.maroon, fontWeight: '800', fontSize: 13 }}>{num(i + 1, lang)}</Text>
                  </View>
                  <Text style={[styles.flex, { color: colors.ink, fontSize: 14.5, lineHeight: 21 }]}>{step}</Text>
                </View>
              ))}
            </Card>
          </>
        ) : (
          <Card style={{ marginHorizontal: 16, marginTop: 14, padding: 18 }}>
            <Text style={{ color: colors.muted }}>{tx('এই বিষয়ে তথ্য পাওয়া যায়নি।', 'No guidance found for this topic.')}</Text>
          </Card>
        )}

        <SectionTitle title={tx('সাহায্য দরকার?', 'Need help?')} />
        <OfficerHelpStrip district={user?.district} />
        <View style={{ height: 28 }} />
      </RefreshScroll>
    </>
  );
}

// ---------------------------------------------------------------------------
// Feature 2 — Loan application
//
// The farmer uploads nothing (P9). Four short steps: product, request, confirm,
// consent. All evidence is collected by a field officer in the admin console.
// ---------------------------------------------------------------------------

function FinanceHub({
  setScreen, onPickProduct, onSelectProduct,
}: {
  setScreen: (screen: Screen) => void;
  onPickProduct: () => void;
  onSelectProduct: (product: LoanProduct) => void;
}) {
  const { tx, lang } = useLanguage();
  const { user } = useAuth();
  const summary = useFinanceSummary();
  const apps = useApiList<ApiRow>('app/finance/applications');
  const products = useApiList<LoanProduct>('app/finance/loan-products');

  const active = apps.rows[0];
  const hasActive = active && !['closed', 'withdrawn', 'cancelled'].includes(String(active.status));
  const tookCheck = Boolean(summary && summary.state !== 'not_assessed');

  const STEPS: [string, string][] = [
    [
      'আপনার প্রয়োজন জানান ও সম্মতি দিন — ৪টি ছোট ধাপ।',
      'You state what you need and give consent — four short steps.',
    ],
    [
      'মাঠ কর্মকর্তা ৫ কর্মদিবসের মধ্যে যোগাযোগ করে সব তথ্য ও কাগজ সংগ্রহ করবেন।',
      'A field officer contacts you within 5 working days and collects everything.',
    ],
    [
      'শাথী সেবা মূল্যায়ন করে ব্যাংক/এমএফআই-তে পাঠায়; সিদ্ধান্ত তাদের।',
      'Shathi Sheba assesses and forwards to the lender, who decides.',
    ],
  ];

  return (
    <>
      {/* Loans only. Partner projects live on the bottom navigation — putting
          both behind one tile made two unrelated flows compete for one screen. */}
      <Header title={tx('ঋণের আবেদন', 'Apply for Loan')} onBack={() => setScreen('home')} />
      <RefreshScroll>
        {/* A live application outranks everything else: it is why the farmer
            opened this screen. */}
        {hasActive ? (
          <>
            <SectionTitle title={tx('আপনার আবেদনের অবস্থা', 'Loan application status')} />
            <Pressable onPress={() => setScreen('loanStatus')} style={({ pressed }) => [pressed && styles.pressed]}>
              <Card style={{ marginHorizontal: 16, padding: 16 }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                  <View style={styles.flex}>
                    <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.3 }}>
                      {tx('আবেদন কোড', 'Application code')}
                    </Text>
                    <Text style={{ color: colors.ink, fontSize: 17, fontWeight: '800', marginTop: 2 }}>
                      {String(active.application_code)}
                    </Text>
                  </View>
                  <Badge label={financeLabel(String(active.status), lang)} tone="gold" />
                </View>

                <View style={fin.hubStatRow}>
                  {([
                    [tx('ধরন', 'Product'), rowTitle({ title_bn: active.product_bn, title_en: active.product_en }, lang, '—')],
                    [tx('আবেদনকৃত', 'Requested'), amount(Number(active.requested_amount ?? 0), lang)],
                    [tx('সুদ', 'Rate'), `${num(Number(active.interest_rate_annual ?? 0), lang)}% ${tx('বার্ষিক', 'p.a.')}`],
                  ] as [string, string][]).map(([k, v]) => (
                    <View key={k} style={fin.hubStat}>
                      <Text style={fin.hubStatLabel}>{k}</Text>
                      <Text style={fin.hubStatValue}>{v}</Text>
                    </View>
                  ))}
                </View>

                {summary?.stage_index ? (
                  <>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 }}>
                      <Text style={{ color: colors.ink, fontSize: 13, fontWeight: '700' }}>
                        {financeLabel(String(active.status), lang)}
                      </Text>
                      <Text style={{ color: colors.muted, fontSize: 12.5 }}>
                        {tx('ধাপ', 'Stage')} {num(summary.stage_index, lang)} / {num(summary.stage_total, lang)}
                      </Text>
                    </View>
                    <View style={fin.hubProgressTrack}>
                      <View style={[fin.hubProgressFill, { width: `${(summary.stage_index / Math.max(1, summary.stage_total)) * 100}%` }]} />
                    </View>
                  </>
                ) : null}

                <View style={{ marginTop: 14 }}>
                  <AppButton variant="outline" title={tx('অগ্রগতি দেখুন', 'View progress')} onPress={() => setScreen('loanStatus')} />
                </View>
              </Card>
            </Pressable>

            {summary?.pending_user_action ? (
              <Card style={fin.actionBanner}>
                <Text style={{ fontSize: 20 }}>!</Text>
                <View style={styles.flex}>
                  <Text style={{ color: '#7A5200', fontWeight: '800', fontSize: 14.5 }}>
                    {tx('আপনার পদক্ষেপ প্রয়োজন', 'Action needed from you')}
                  </Text>
                  <Text style={{ color: '#7A5200', fontSize: 13, marginTop: 2 }}>
                    {(() => {
                      const l = PENDING_ACTION_LABEL[summary.pending_user_action];
                      return l ? (lang === 'bn' ? l[0] : l[1]) : summary.pending_user_action;
                    })()}
                  </Text>
                </View>
              </Card>
            ) : null}
          </>
        ) : null}

        {/* How it works — the three things that happen, in the order they happen. */}
        <Card style={fin.howCard}>
          <Text style={fin.howKicker}>{tx('কীভাবে কাজ করে', 'How it works')}</Text>
          <Text style={fin.howTitle}>{tx('শাথী সেবার মাধ্যমে অর্থায়ন', 'Finance through Shathi Sheba')}</Text>
          {STEPS.map(([bn, en], i) => (
            <View key={i} style={fin.howStep}>
              <Text style={fin.howNum}>{num(i + 1, lang)}।</Text>
              <Text style={fin.howText}>{lang === 'bn' ? bn : en}</Text>
            </View>
          ))}
          <View style={fin.howNote}>
            <Text style={{ fontSize: 15 }}>📄</Text>
            <Text style={fin.howNoteText}>
              {tx('আপনাকে কোনো কাগজপত্র আপলোড করতে হবে না — মাঠ কর্মকর্তা সব সংগ্রহ করবেন।',
                  'You do not need to upload anything — your field officer collects it all.')}
            </Text>
          </View>
        </Card>

        {/* Readiness check. Always offered: before applying it is the cheapest way
            to find out what is missing, and afterwards it is how the score moves. */}
        <Pressable
          onPress={() => setScreen(tookCheck ? 'financeReadinessResult' : 'financeReadinessIntro')}
          style={({ pressed }) => [pressed && styles.pressed]}
        >
          <Card style={fin.readyCard}>
            <View style={fin.readyIcon}><Text style={{ fontSize: 17 }}>📊</Text></View>
            <View style={styles.flex}>
              <Text style={{ color: colors.ink, fontSize: 14.5, fontWeight: '700', lineHeight: 20 }}>
                {tookCheck
                  ? tx('আপনার প্রস্তুতির ফলাফল দেখুন', 'See your readiness result')
                  : tx('আগে ২ মিনিটের প্রস্তুতি চেক নিন', 'Take the 2-minute readiness check first')}
              </Text>
              <Text style={{ color: colors.muted, fontSize: 12.5, marginTop: 2 }}>
                {tookCheck
                  ? tx('কী বাকি আছে দেখে নিন', 'See what is still missing')
                  : tx('আবেদনের আগে কী বাকি আছে দেখুন', 'See what is missing before you apply')}
              </Text>
            </View>
            <Text style={{ color: colors.muted, fontSize: 20 }}>›</Text>
          </Card>
        </Pressable>

        {/* Loan types */}
        <SectionTitle title={tx('ঋণের ধরন', 'Loan types')} />
        <ApiStatus state={products as any} empty={tx('কোনো ঋণ পাওয়া যায়নি।', 'No loan types available.')} />
        {products.rows.map((p) => {
          const dim = !p.is_active;
          return (
            <Pressable
              key={p.id}
              disabled={dim}
              onPress={() => onSelectProduct(p)}
              style={({ pressed }) => [pressed && !dim && styles.pressed]}
            >
              <Card style={[fin.productCard, dim && fin.productDim]}>
                <View style={fin.productHead}>
                  <Text style={fin.productIcon}>{p.icon ?? '💼'}</Text>
                  <View style={styles.flex}>
                    <Text style={fin.productName}>{lang === 'bn' ? p.name_bn : p.name_en}</Text>
                    {p.is_active ? (
                      <>
                        <Text style={fin.productMeta}>
                          {amount(Number(p.min_amount), lang)} – {amount(Number(p.max_amount), lang)}
                        </Text>
                        <Text style={fin.productTerms}>
                          {num(Number(p.interest_rate_annual), lang)}% {tx('বার্ষিক', 'p.a.')}
                          {'  ·  '}
                          {p.allowed_tenures.map((t) => num(t, lang)).join(' / ')} {tx('মাস', 'mo')}
                        </Text>
                      </>
                    ) : (
                      (p.description_bn || p.description_en) ? (
                        <Text style={fin.productDesc}>{lang === 'bn' ? p.description_bn : p.description_en}</Text>
                      ) : null
                    )}
                  </View>
                  <Badge
                    label={p.is_active ? tx('উপলব্ধ', 'Available') : tx('শীঘ্রই আসছে', 'Coming soon')}
                    tone={p.is_active ? 'green' : 'gold'}
                  />
                </View>
              </Card>
            </Pressable>
          );
        })}

        {/* Always present, whatever the state above — it is the screen's job. */}
        <View style={{ paddingHorizontal: 16, marginTop: 18 }}>
          <AppButton
            title={hasActive ? tx('আরেকটি ঋণের আবেদন', 'Apply for another loan') : tx('ঋণের জন্য আবেদন করুন', 'Apply for loan')}
            onPress={onPickProduct}
          />
        </View>

        <OfficerHelpStrip district={user?.district} />
        <View style={{ height: 28 }} />
      </RefreshScroll>
    </>
  );
}

function LoanApplyType({
  setScreen, onSelect,
}: {
  setScreen: (screen: Screen) => void;
  onSelect: (product: LoanProduct) => void;
}) {
  const { tx, lang } = useLanguage();
  const products = useApiList<LoanProduct>('app/finance/loan-products');

  return (
    <>
      <Header title={tx('ঋণের ধরন', 'Choose loan type')} onBack={() => setScreen('financeHub')} right={tx('ধাপ ১/৪', 'Step 1/4')} />
      <RefreshScroll>
        <ApiStatus state={products as any} empty={tx('কোনো ঋণ পাওয়া যায়নি।', 'No finance products available.')} />
        {products.rows.map((p) => {
          const dim = !p.is_active;
          return (
            <Pressable
              key={p.id}
              disabled={dim}
              onPress={() => onSelect(p)}
              style={({ pressed }) => [pressed && !dim && styles.pressed]}
            >
              <Card style={[fin.productCard, dim && fin.productDim]}>
                <View style={fin.productHead}>
                  <Text style={fin.productIcon}>{p.icon ?? '💼'}</Text>
                  <View style={styles.flex}>
                    <Text style={fin.productName}>{lang === 'bn' ? p.name_bn : p.name_en}</Text>
                    {(p.description_bn || p.description_en) ? (
                      <Text style={fin.productDesc}>{lang === 'bn' ? p.description_bn : p.description_en}</Text>
                    ) : null}
                  </View>
                  {p.is_active ? (
                    <View style={fin.rateBadge}>
                      <Text style={fin.rateBadgeText}>{num(Number(p.interest_rate_annual), lang)}% {tx('বার্ষিক', 'p.a.')}</Text>
                    </View>
                  ) : (
                    <Badge label={tx('শীঘ্রই আসছে', 'Coming soon')} tone="gold" />
                  )}
                </View>
                {p.is_active ? (
                  <Text style={fin.productMeta}>
                    {amount(Number(p.min_amount), lang)} – {amount(Number(p.max_amount), lang)}
                    {'  ·  '}
                    {p.allowed_tenures.map((t) => num(t, lang)).join(', ')} {tx('মাস', 'months')}
                  </Text>
                ) : null}
              </Card>
            </Pressable>
          );
        })}
        <View style={{ height: 28 }} />
      </RefreshScroll>
    </>
  );
}

function LoanApplyDetails({
  setScreen, draft, patchDraft,
}: {
  setScreen: (screen: Screen) => void;
  draft: LoanDraft;
  patchDraft: (patch: Partial<LoanDraft>) => void;
}) {
  const { tx, lang } = useLanguage();
  const product = draft.product;
  const [amountText, setAmountText] = useState(String(draft.amount || ''));
  const [quote, setQuote] = useState<LoanQuote | null>(draft.quote);
  const [quoting, setQuoting] = useState(false);
  const [error, setError] = useState('');
  const purposes = useApiList<ApiRow>('app/finance/purposes');
  // The schedule is shown inline rather than on its own screen: "how much, how
  // often, for how long" is one question, and answering it across two screens
  // meant nobody checked the dates before committing.
  const [schedule, setSchedule] = useState<{ installment_no: number; due_date: string; amount_due: number }[]>([]);
  const [showSchedule, setShowSchedule] = useState(false);

  const min = Number(product?.min_amount ?? 0);
  const max = Number(product?.max_amount ?? 0);
  const step = Number(product?.amount_step ?? 1000);

  // Live quote — recomputes whenever amount, tenure or mode changes.
  useEffect(() => {
    if (!product || !draft.amount || draft.amount < min || draft.amount > max) { setQuote(null); return; }
    let alive = true;
    const timer = setTimeout(async () => {
      setQuoting(true);
      setError('');
      try {
        const res = await apiRequest<{ result?: LoanQuote }>('app/finance/quote', {
          method: 'POST',
          body: JSON.stringify({
            product_id: product.id,
            amount: draft.amount,
            tenure_months: draft.tenureMonths,
            repayment_mode: draft.repaymentMode,
          }),
        });
        if (!alive) return;
        setQuote(res.result ?? null);
        patchDraft({ quote: res.result ?? null });

        const sched = await apiRequest<{ result?: { rows: typeof schedule } }>('app/finance/quote/schedule', {
          method: 'POST',
          body: JSON.stringify({
            product_id: product.id,
            amount: draft.amount,
            tenure_months: draft.tenureMonths,
            repayment_mode: draft.repaymentMode,
          }),
        });
        if (alive) setSchedule(sched.result?.rows ?? []);
      } catch (e) {
        if (alive) { setQuote(null); setError(naturalApiError(e, lang)); }
      } finally {
        if (alive) setQuoting(false);
      }
    }, 350);
    return () => { alive = false; clearTimeout(timer); };
  }, [product?.id, draft.amount, draft.tenureMonths, draft.repaymentMode, lang]);

  function setAmount(value: number) {
    const clamped = Math.max(min, Math.min(max, Math.round(value / step) * step));
    patchDraft({ amount: clamped });
    setAmountText(String(clamped));
  }

  if (!product) {
    return (
      <>
        <Header title={tx('চাহিদা', 'Your request')} onBack={() => setScreen('loanApplyType')} />
        <View style={{ padding: 24 }}>
          <Text style={{ color: colors.muted }}>{tx('আগে ঋণের ধরন নির্বাচন করুন।', 'Please choose a loan type first.')}</Text>
        </View>
      </>
    );
  }

  const pct = max > min ? ((draft.amount - min) / (max - min)) * 100 : 0;

  return (
    <>
      <Header title={tx('চাহিদা', 'Your request')} onBack={() => setScreen('loanApplyType')} right={tx('ধাপ ২/৪', 'Step 2/4')} />
      <RefreshScroll>
        {/* Amount — slider AND numeric box, two-way synced (MOB-LON-08B) */}
        <SectionTitle title={tx('কত টাকা প্রয়োজন?', 'How much do you need?')} />
        <Card style={{ marginHorizontal: 16, padding: 16 }}>
          <View style={fin.amountRow}>
            <Text style={{ fontSize: 24, fontWeight: '800', color: colors.maroon }}>৳</Text>
            <TextInput
              style={fin.amountInput}
              value={amountText}
              keyboardType="number-pad"
              onChangeText={(t) => { setAmountText(t); patchDraft({ amount: parseDigits(t) }); }}
              onBlur={() => setAmount(parseDigits(amountText))}
              accessibilityLabel={tx('ঋণের পরিমাণ', 'Loan amount')}
            />
          </View>

          <View style={fin.sliderRow}>
            <Pressable
              onPress={() => setAmount(draft.amount - step)}
              accessibilityLabel={tx('কমান', 'Decrease')}
              style={({ pressed }) => [fin.stepBtn, pressed && styles.pressed]}
            >
              <Text style={fin.stepBtnText}>−</Text>
            </Pressable>
            <View style={fin.sliderTrack}>
              <View style={[fin.sliderFill, { width: `${Math.max(0, Math.min(100, pct))}%` }]} />
            </View>
            <Pressable
              onPress={() => setAmount(draft.amount + step)}
              accessibilityLabel={tx('বাড়ান', 'Increase')}
              style={({ pressed }) => [fin.stepBtn, pressed && styles.pressed]}
            >
              <Text style={fin.stepBtnText}>+</Text>
            </Pressable>
          </View>
          <View style={fin.boundsRow}>
            <Text style={fin.boundText}>{amount(min, lang)}</Text>
            <Text style={fin.boundText}>{amount(max, lang)}</Text>
          </View>
        </Card>

        {/* Tenure — restricted to what the product permits (MOB-LON-08F) */}
        <SectionTitle title={tx('কত সময়ে পরিশোধ করবেন?', 'Over what period will you repay?')} />
        <View style={{ paddingHorizontal: 16 }}>
          <View style={fin.segmentRow}>
            {product.allowed_tenures.map((t) => (
              <Pressable
                key={t}
                onPress={() => patchDraft({ tenureMonths: t })}
                style={({ pressed }) => [fin.segment, draft.tenureMonths === t && fin.segmentOn, pressed && styles.pressed]}
              >
                <Text style={[fin.segmentText, draft.tenureMonths === t && { color: colors.maroon }]}>
                  {num(t, lang)} {tx('মাস', 'mo')}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Repayment mode */}
        <SectionTitle title={tx('কীভাবে পরিশোধ করবেন?', 'How will you repay?')} />
        <View style={{ paddingHorizontal: 16 }}>
          {REPAYMENT_MODES.filter((m) => product.allowed_repayment_modes.includes(m.key)).map((m) => (
            <Pressable
              key={m.key}
              onPress={() => patchDraft({ repaymentMode: m.key })}
              style={({ pressed }) => [fin.modeCard, draft.repaymentMode === m.key && fin.modeCardOn, pressed && styles.pressed]}
            >
              <Text style={{ color: colors.ink, fontSize: 15.5, fontWeight: '700' }}>{lang === 'bn' ? m.bn : m.en}</Text>
              <Text style={{ color: colors.muted, fontSize: 12.5, marginTop: 2 }}>{lang === 'bn' ? m.hint_bn : m.hint_en}</Text>
            </Pressable>
          ))}
        </View>

        {/* Purpose */}
        <SectionTitle title={tx('কী কাজে ব্যবহার করবেন?', 'What will you use it for?')} />
        <View style={{ paddingHorizontal: 16 }}>
          <View style={fin.segmentRow}>
            {purposes.rows.map((p) => (
              <Pressable
                key={String(p.code)}
                onPress={() => patchDraft({ purposeCode: String(p.code) })}
                style={({ pressed }) => [fin.segment, draft.purposeCode === p.code && fin.segmentOn, pressed && styles.pressed]}
              >
                <Text style={[fin.segmentText, draft.purposeCode === p.code && { color: colors.maroon }]}>
                  {String(p.icon ?? '')} {rowTitle({ title_bn: p.label_bn, title_en: p.label_en }, lang, '')}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Live quote (MOB-LON-08C). Per-instalment is the dominant figure. */}
        <SectionTitle title={tx('আপনার কিস্তি', 'Your instalment')} />
        {error ? (
          <Card style={{ marginHorizontal: 16, padding: 14 }}>
            <Text style={{ color: colors.danger, fontSize: 13.5, lineHeight: 20 }}>{error}</Text>
          </Card>
        ) : quote ? (
          <Card style={fin.quoteCard}>
            <View style={fin.emiBlock}>
              <Text style={fin.emiLabel}>{tx('প্রতি কিস্তি', 'Per instalment')}</Text>
              <Text style={fin.emiValue}>{amount(quote.emi_amount, lang)}</Text>
              <Text style={{ color: colors.muted, fontSize: 13, marginTop: 4 }}>
                {num(quote.installment_count, lang)}{tx('টি', '')} {financeLabel(quote.repayment_mode, lang)}
              </Text>
            </View>
            <View style={fin.quoteDivider} />
            <View style={fin.quoteLine}>
              <Text style={fin.quoteLabel}>{tx('সুদের হার', 'Interest rate')}</Text>
              <Text style={fin.quoteValue}>{num(quote.interest_rate_annual, lang)}% {tx('বার্ষিক', 'per year')}</Text>
            </View>
            <View style={fin.quoteLine}>
              <Text style={fin.quoteLabel}>{tx('ঋণের পরিমাণ', 'Loan amount')}</Text>
              <Text style={fin.quoteValue}>{amount(quote.principal, lang)}</Text>
            </View>
            <View style={fin.quoteLine}>
              <Text style={fin.quoteLabel}>{tx('মেয়াদ', 'Tenure')}</Text>
              <Text style={fin.quoteValue}>{num(quote.tenure_months, lang)} {tx('মাস', 'months')}</Text>
            </View>
            <View style={fin.quoteLine}>
              <Text style={fin.quoteLabel}>{tx('সুদ', 'Interest')}</Text>
              <Text style={fin.quoteValue}>{amount(quote.total_interest, lang)}</Text>
            </View>
            {/* A zero fee is omitted entirely, never rendered as ৳0 (AC-E-17) */}
            {quote.processing_fee > 0 ? (
              <View style={fin.quoteLine}>
                <Text style={fin.quoteLabel}>{tx('প্রসেসিং ফি', 'Processing fee')}</Text>
                <Text style={fin.quoteValue}>{amount(quote.processing_fee, lang)}</Text>
              </View>
            ) : null}
            <View style={fin.quoteDivider} />
            <View style={fin.quoteLine}>
              <Text style={[fin.quoteLabel, { fontWeight: '700', color: colors.ink }]}>{tx('মোট পরিশোধযোগ্য', 'Total payable')}</Text>
              <Text style={[fin.quoteValue, { fontSize: 16 }]}>{amount(quote.total_payable, lang)}</Text>
            </View>
            <Text style={fin.caveat}>
              {tx('চূড়ান্ত পরিমাণ ও তারিখ অনুমোদনের পর নির্ধারিত হবে।', 'Final amounts and dates are set after approval.')}
            </Text>
            {/* Collapsed by default, with the count and cadence on the header so
                the answer is visible without opening it — and it restates itself
                whenever the tenure or mode above changes. */}
            {schedule.length ? (
              <>
                <Pressable
                  onPress={() => setShowSchedule((v) => !v)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: showSchedule }}
                  style={({ pressed }) => [fin.schedHead, pressed && styles.pressed]}
                >
                  <Text style={fin.schedHeadText}>
                    {num(schedule.length, lang)}{tx('টি ', ' ')}
                    {financeLabel(quote.repayment_mode, lang)} {tx('কিস্তি', 'instalments')}
                    {'  '}
                    <Text style={{ color: colors.muted, fontWeight: '600' }}>
                      ({amount(quote.total_payable, lang)})
                    </Text>
                  </Text>
                  <Text style={fin.schedChevron}>{showSchedule ? '−' : '+'}</Text>
                </Pressable>

                {showSchedule ? (
                  <View style={{ marginTop: 4 }}>
                    {schedule.map((r) => (
                      <View key={r.installment_no} style={fin.schedRow}>
                        <Text style={fin.schedNo}>{num(r.installment_no, lang)}</Text>
                        <Text style={fin.schedDate}>{formatDate(r.due_date, lang)}</Text>
                        <Text style={fin.schedAmount}>{amount(r.amount_due, lang)}</Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </>
            ) : null}
          </Card>
        ) : (
          <Card style={{ marginHorizontal: 16, padding: 16 }}>
            {quoting ? <ActivityIndicator color={colors.maroon} /> : (
              <Text style={{ color: colors.muted, fontSize: 13.5 }}>
                {tx('পরিমাণ দিন — কিস্তি এখানে দেখানো হবে।', 'Enter an amount and your instalment appears here.')}
              </Text>
            )}
          </Card>
        )}

        <View style={{ paddingHorizontal: 16, marginTop: 18, marginBottom: 28 }}>
          <AppButton
            title={tx('পরবর্তী', 'Continue')}
            disabled={!quote}
            onPress={() => setScreen('loanApplyProfile')}
          />
        </View>
      </RefreshScroll>
    </>
  );
}

function LoanSchedulePreview({ setScreen, draft }: { setScreen: (screen: Screen) => void; draft: LoanDraft }) {
  const { tx, lang } = useLanguage();
  const [rows, setRows] = useState<{ installment_no: number; due_date: string; amount_due: number; balance_after: number }[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!draft.product) return;
      try {
        const res = await apiRequest<{ result?: { rows: typeof rows } }>('app/finance/quote/schedule', {
          method: 'POST',
          body: JSON.stringify({
            product_id: draft.product.id,
            amount: draft.amount,
            tenure_months: draft.tenureMonths,
            repayment_mode: draft.repaymentMode,
          }),
        });
        if (alive) setRows(res.result?.rows ?? []);
      } catch {
        if (alive) setRows([]);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [draft.product?.id, draft.amount, draft.tenureMonths, draft.repaymentMode]);

  const shown = expanded ? rows : rows.slice(0, 6);

  return (
    <>
      <Header title={tx('কিস্তির তালিকা', 'Repayment schedule')} onBack={() => setScreen('loanApplyDetails')} />
      <RefreshScroll>
        <Card style={{ marginHorizontal: 16, marginTop: 14, padding: 16 }}>
          {loading ? <ActivityIndicator color={colors.maroon} /> : shown.map((r) => (
            <View key={r.installment_no} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
              borderBottomWidth: 1, borderBottomColor: colors.line }}>
              <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: colors.rose, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: colors.maroon, fontWeight: '800', fontSize: 12.5 }}>{num(r.installment_no, lang)}</Text>
              </View>
              <View style={[styles.flex, { marginLeft: 12 }]}>
                <Text style={{ color: colors.ink, fontSize: 14.5, fontWeight: '700' }}>{amount(r.amount_due, lang)}</Text>
                <Text style={{ color: colors.muted, fontSize: 12 }}>{formatDate(r.due_date, lang)}</Text>
              </View>
              <Text style={{ color: colors.muted, fontSize: 12 }}>
                {tx('বাকি', 'left')} {amount(r.balance_after, lang)}
              </Text>
            </View>
          ))}
          {rows.length > 6 ? (
            <Pressable onPress={() => setExpanded((v) => !v)} style={{ paddingVertical: 12 }}>
              <Text style={{ color: colors.maroon, fontWeight: '700', textAlign: 'center' }}>
                {expanded ? tx('কম দেখুন', 'Show less') : `${tx('সব দেখুন', 'See all')} (${num(rows.length, lang)})`}
              </Text>
            </Pressable>
          ) : null}
        </Card>
        <Text style={[fin.caveat, { marginHorizontal: 24 }]}>
          {tx('তারিখগুলো আনুমানিক। বিতরণের পর চূড়ান্ত হবে।', 'Dates are approximate and are fixed after disbursement.')}
        </Text>
        <View style={{ height: 28 }} />
      </RefreshScroll>
    </>
  );
}

function LoanApplyProfile({
  setScreen, draft, patchDraft,
}: {
  setScreen: (screen: Screen) => void;
  draft: LoanDraft;
  patchDraft: (patch: Partial<LoanDraft>) => void;
}) {
  const { tx, lang } = useLanguage();
  const { user } = useAuth();

  const rows: [string, string][] = [
    [tx('নাম', 'Name'), String(user?.full_name ?? user?.display_name ?? '—')],
    [tx('মোবাইল', 'Mobile'), String(user?.phone ?? '—')],
    [tx('এনআইডি', 'National ID'), user?.is_kyc_verified ? tx('যাচাই হয়েছে', 'Verified') : tx('যাচাই বাকি', 'Not yet verified')],
    [tx('জেলা', 'District'), String(user?.district ?? '—')],
    [tx('উপজেলা', 'Upazila'), String(user?.upazila ?? '—')],
  ];

  return (
    <>
      <Header title={tx('তথ্য নিশ্চিত করুন', 'Confirm your details')} onBack={() => setScreen('loanApplyDetails')} right={tx('ধাপ ৩/৪', 'Step 3/4')} />
      <RefreshScroll>
        <Card style={{ marginHorizontal: 16, marginTop: 14, padding: 16 }}>
          <Text style={{ color: colors.muted, fontSize: 13.5, lineHeight: 20, marginBottom: 10 }}>
            {tx('শাথী সেবার কাছে আপনার যে তথ্য আছে তা দেখে নিন। এখানে কিছু লিখতে বা আপলোড করতে হবে না।',
                'Here is what Shathi Sheba already holds. Nothing to type and nothing to upload.')}
          </Text>
          {rows.map(([k, v]) => (
            <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 9,
              borderBottomWidth: 1, borderBottomColor: colors.line }}>
              <Text style={{ color: colors.muted, fontSize: 14 }}>{k}</Text>
              <Text style={{ color: colors.ink, fontSize: 14, fontWeight: '700' }}>{v}</Text>
            </View>
          ))}
        </Card>

        <Pressable
          onPress={() => patchDraft({ needsCorrection: !draft.needsCorrection })}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: draft.needsCorrection }}
          style={({ pressed }) => [pressed && styles.pressed]}
        >
          <Card style={{
            marginHorizontal: 16, marginTop: 12, padding: 14,
            flexDirection: 'row', alignItems: 'center', gap: 12,
            borderWidth: 1, borderColor: draft.needsCorrection ? colors.maroon : 'transparent',
          }}>
            <View style={[fin.consentCheck, draft.needsCorrection && { backgroundColor: colors.maroon, borderColor: colors.maroon }]}>
              {draft.needsCorrection ? <Text style={{ color: '#fff', fontWeight: '800' }}>✓</Text> : null}
            </View>
            <View style={styles.flex}>
              <Text style={{ color: colors.ink, fontSize: 14, lineHeight: 20, fontWeight: '600' }}>
                {tx('কিছু তথ্য ভুল আছে — কর্মকর্তাকে জানান',
                    'Something here is wrong — flag it for the officer')}
              </Text>
              <Text style={{ color: colors.muted, fontSize: 12.5, marginTop: 3, lineHeight: 18 }}>
                {tx('আবেদন থামবে না। কর্মকর্তা যোগাযোগের সময় ঠিক করে নেবেন।',
                    'This does not stop your application. The officer fixes it when they contact you.')}
              </Text>
            </View>
          </Card>
        </Pressable>

        {/* Only asked once the box is ticked — an always-visible free-text field
            invites people to type where nobody is going to read it. */}
        {draft.needsCorrection ? (
          <Card style={{ marginHorizontal: 16, marginTop: 10, padding: 14 }}>
            <Text style={{ color: colors.muted, fontSize: 12.5, fontWeight: '700', marginBottom: 6 }}>
              {tx('কোনটি ভুল?', 'What is wrong?')}
            </Text>
            <TextInput
              style={fin.noteInput}
              value={draft.correctionNote ?? ''}
              onChangeText={(t) => patchDraft({ correctionNote: t })}
              placeholder={tx('যেমন: উপজেলা ভুল আছে', 'For example: the upazila is wrong')}
              placeholderTextColor={colors.muted}
              multiline
              accessibilityLabel={tx('কোনটি ভুল', 'What is wrong')}
            />
          </Card>
        ) : null}

        <View style={{ paddingHorizontal: 16, marginTop: 18, marginBottom: 28 }}>
          <AppButton title={tx('পরবর্তী', 'Next')} onPress={() => setScreen('loanApplyConsent')} />
        </View>
      </RefreshScroll>
    </>
  );
}

function LoanApplyConsent({
  setScreen, draft, onSubmitted,
}: {
  setScreen: (screen: Screen) => void;
  draft: LoanDraft;
  onSubmitted: (result: ApiRow) => void;
}) {
  const { tx, lang } = useLanguage();
  const consents = useApiList<ApiRow>('app/finance/consents');
  // One switch per consent rather than a single blanket tick. Each is stored
  // separately with its own version and can be withdrawn on its own later, so a
  // single "I agree to everything" would misrepresent what is actually recorded.
  const [granted, setGranted] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const required = consents.rows.filter((c) => Number(c.is_required) === 1);
  const missing = required.filter((c) => !granted[String(c.consent_key)]);
  const allOn = required.length > 0 && missing.length === 0;

  function toggleAll() {
    const next = !allOn;
    setGranted(Object.fromEntries(required.map((c) => [String(c.consent_key), next])));
  }

  async function submit() {
    if (!draft.product || !allOn) return;
    setSubmitting(true);
    setError('');
    try {
      const res = await apiCreate('app/finance/applications', {
        product_id: draft.product.id,
        amount: draft.amount,
        tenure_months: draft.tenureMonths,
        repayment_mode: draft.repaymentMode,
        purpose_code: draft.purposeCode,
        purpose_text: draft.purposeText || undefined,
        // Passed through so the officer sees what the farmer flagged on step 3
        // rather than discovering it on the visit.
        needs_correction: draft.needsCorrection || undefined,
        needs_correction_note: draft.needsCorrection ? (draft.correctionNote || undefined) : undefined,
        consents: required.map((c) => String(c.consent_key)),
      });
      const result = (res as any).result;
      if (result) { onSubmitted(result); setScreen('loanApplyDone'); }
    } catch (e) {
      setError(naturalApiError(e, lang));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Header title={tx('ঋণের আবেদন', 'Loan application')} onBack={() => setScreen('loanApplyProfile')} right={tx('ধাপ ৪/৪', 'Step 4/4')} />
      <RefreshScroll>
        <View style={{ paddingHorizontal: 16, marginTop: 14 }}>
          <Text style={{ color: colors.ink, fontSize: 19, fontWeight: '800' }}>
            {tx('সম্মতি দিন', 'Give your consent')}
          </Text>
          <Text style={{ color: colors.muted, fontSize: 13.5, marginTop: 6, lineHeight: 20 }}>
            {tx('প্রতিটি সম্মতি আলাদাভাবে সংরক্ষিত হয় এবং প্রোফাইল থেকে প্রত্যাহার করা যায়। আবেদনের জন্য সবকটি প্রয়োজন।',
                'Each consent is stored separately and can be withdrawn later from your profile. All are needed to apply.')}
          </Text>
        </View>

        <ApiStatus state={consents as any} empty={tx('সম্মতির তালিকা পাওয়া যায়নি।', 'Consent list unavailable.')} />

        {required.length ? (
          <Pressable onPress={toggleAll} style={({ pressed }) => [pressed && styles.pressed]}>
            <Card style={fin.consentAllCard}>
              <View style={[fin.consentCheck, allOn && { backgroundColor: colors.maroon, borderColor: colors.maroon }]}>
                {allOn ? <Text style={{ color: '#fff', fontWeight: '800' }}>✓</Text> : null}
              </View>
              <Text style={[styles.flex, { color: colors.ink, fontSize: 15.5, fontWeight: '700' }]}>
                {tx('সব নির্বাচন করুন', 'Select all')}
              </Text>
            </Card>
          </Pressable>
        ) : null}

        {required.map((c) => {
          const key = String(c.consent_key);
          const on = !!granted[key];
          return (
            <Pressable
              key={key}
              onPress={() => setGranted((g) => ({ ...g, [key]: !g[key] }))}
              accessibilityRole="switch"
              accessibilityState={{ checked: on }}
              style={({ pressed }) => [pressed && styles.pressed]}
            >
              <Card style={fin.consentRow}>
                <View style={styles.flex}>
                  <Text style={{ color: colors.ink, fontSize: 14.5, fontWeight: '700' }}>
                    {rowTitle({ title_bn: c.title_bn, title_en: c.title_en }, lang, key)}
                    <Text style={{ color: colors.maroon }}> ★</Text>
                  </Text>
                  {(c.description_bn || c.description_en) ? (
                    <Text style={{ color: colors.muted, fontSize: 12.5, marginTop: 3, lineHeight: 18 }}>
                      {rowTitle({ title_bn: c.description_bn, title_en: c.description_en }, lang, '')}
                    </Text>
                  ) : null}
                </View>
                {/* A switch, not a checkbox: consent is a setting you hold and can
                    turn off, and the profile screen shows the same control. */}
                <View style={[fin.switchTrack, on && { backgroundColor: colors.maroon }]}>
                  <View style={[fin.switchKnob, on && { alignSelf: 'flex-end' }]} />
                </View>
              </Card>
            </Pressable>
          );
        })}

        {error ? (
          <Card style={{ marginHorizontal: 16, marginTop: 12, padding: 14 }}>
            <Text style={{ color: colors.danger, fontSize: 13.5, lineHeight: 20 }}>{error}</Text>
          </Card>
        ) : null}

        {/* Names exactly what is still missing. "Submit is disabled" without
            saying why is the single most common dead end in a form like this. */}
        {missing.length ? (
          <Text style={fin.stillNeeded}>
            {tx('বাকি আছে: ', 'Still needed: ')}
            {missing.map((c) => rowTitle({ title_bn: c.title_bn, title_en: c.title_en }, lang, String(c.consent_key))).join(', ')}
          </Text>
        ) : null}

        <View style={{ paddingHorizontal: 16, marginTop: 16, marginBottom: 28 }}>
          <AppButton
            title={submitting ? tx('জমা হচ্ছে…', 'Submitting…') : tx('আবেদন জমা দিন', 'Submit application')}
            disabled={!allOn || submitting}
            onPress={submit}
          />
        </View>
      </RefreshScroll>
    </>
  );
}

function LoanApplyDone({ setScreen, result }: { setScreen: (screen: Screen) => void; result: ApiRow | null }) {
  const { tx, lang } = useLanguage();
  const { user } = useAuth();
  const quote = (result?.quote ?? {}) as Record<string, number>;

  return (
    <>
      <Header title={tx('জমা সম্পন্ন', 'Application submitted')} onBack={() => setScreen('financeHub')} />
      <RefreshScroll>
        <Card style={{ marginHorizontal: 16, marginTop: 14, padding: 20, alignItems: 'center' }}>
          <View style={{ width: 62, height: 62, borderRadius: 31, backgroundColor: '#E6F5ED', alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ fontSize: 30, color: colors.green }}>✓</Text>
          </View>
          <Text style={{ color: colors.ink, fontSize: 19, fontWeight: '800', marginTop: 12, textAlign: 'center' }}>
            {tx('আবেদন জমা হয়েছে!', 'Your application is in!')}
          </Text>
          <Text style={{ color: colors.maroon, fontSize: 14, fontWeight: '700', marginTop: 6 }}>
            {String(result?.application_code ?? '')}
          </Text>
        </Card>

        {quote.emi_amount ? (
          <Card style={{ marginHorizontal: 16, marginTop: 12, padding: 16 }}>
            <View style={fin.quoteLine}>
              <Text style={fin.quoteLabel}>{tx('ঋণের পরিমাণ', 'Loan amount')}</Text>
              <Text style={fin.quoteValue}>{amount(Number(quote.principal ?? 0), lang)}</Text>
            </View>
            <View style={fin.quoteLine}>
              <Text style={fin.quoteLabel}>{tx('প্রতি কিস্তি', 'Per instalment')}</Text>
              <Text style={fin.quoteValue}>{amount(Number(quote.emi_amount ?? 0), lang)}</Text>
            </View>
            <View style={fin.quoteLine}>
              <Text style={fin.quoteLabel}>{tx('মোট পরিশোধযোগ্য', 'Total payable')}</Text>
              <Text style={fin.quoteValue}>{amount(Number(quote.total_payable ?? 0), lang)}</Text>
            </View>
          </Card>
        ) : null}

        <SectionTitle title={tx('আপনার চাহিদা অনুযায়ী প্রাথমিক হিসাব', 'Indicative terms for what you requested')} />
        <Card style={{ marginHorizontal: 16, padding: 16 }}>
          {([
            [tx('ঋণের ধরন', 'Product'), String(result?.product_en ?? result?.product_bn ?? '—')],
            [tx('সুদের হার', 'Interest rate'), `${num(Number(quote.interest_rate_annual ?? 0), lang)}% ${tx('বার্ষিক (সরল)', 'p.a. flat')}`],
            [tx('মেয়াদ', 'Term'), `${num(Number(quote.tenure_months ?? 0), lang)} ${tx('মাস', 'months')} · ${num(Number(quote.installment_count ?? 0), lang)} ${tx('কিস্তি', 'instalments')}`],
            [tx('প্রতি কিস্তি', 'Each instalment'), amount(Number(quote.emi_amount ?? 0), lang)],
            [tx('মোট পরিশোধযোগ্য', 'Total payable'), amount(Number(quote.total_payable ?? 0), lang)],
          ] as [string, string][]).map(([k, v], i) => (
            <View key={k} style={[fin.termRow, i === 0 && { borderTopWidth: 0 }]}>
              <Text style={fin.termLabel}>{k}</Text>
              <Text style={fin.termValue}>{v}</Text>
            </View>
          ))}
        </Card>

        <SectionTitle title={tx('এরপর কী হবে', 'What happens next')} />
        <Card style={{ marginHorizontal: 16, padding: 16 }}>
          {[
            tx('মাঠ কর্মকর্তা ৫ কর্মদিবসের মধ্যে আপনার সাথে যোগাযোগ করবেন।', 'A field officer will contact you within 5 working days.'),
            tx('তিনি আপনার সব কাগজপত্র সংগ্রহ করবেন — আপনাকে কিছু আপলোড করতে হবে না।', 'They will collect every document — you upload nothing.'),
            tx('এরপর আপনার আবেদন মূল্যায়ন করে ব্যাংক বা এমএফআই-তে পাঠানো হবে।', 'Your application is then assessed and sent to a partner lender.'),
          ].map((line, i) => (
            <View key={`n${i}`} style={{ flexDirection: 'row', gap: 12, marginBottom: 12, alignItems: 'flex-start' }}>
              <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: colors.rose, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: colors.maroon, fontWeight: '800', fontSize: 13 }}>{num(i + 1, lang)}</Text>
              </View>
              <Text style={[styles.flex, { color: colors.ink, fontSize: 14, lineHeight: 21 }]}>{line}</Text>
            </View>
          ))}
        </Card>

        {/* The one promise with a number in it, given its own line so it is not
            lost in the list above. */}
        <Card style={fin.promiseCard}>
          <Text style={fin.promiseText}>
            ✓  {tx('৫ কর্মদিবসের মধ্যে একজন মাঠ কর্মকর্তা আপনার সাথে যোগাযোগ করবেন।',
                   'A field officer will contact you within 5 working days.')}
          </Text>
        </Card>

        <OfficerHelpStrip district={user?.district} />

        <View style={{ paddingHorizontal: 16, marginTop: 18, marginBottom: 28, gap: 10 }}>
          <AppButton title={tx('অগ্রগতি দেখুন', 'View progress')} onPress={() => setScreen('loanStatus')} />
          <AppButton variant="outline" title={tx('হোমে ফিরে যান', 'Return to home')} onPress={() => setScreen('home')} />
        </View>
      </RefreshScroll>
    </>
  );
}

function LoanStatus({ setScreen }: { setScreen: (screen: Screen) => void }) {
  const { tx, lang } = useLanguage();
  const { user } = useAuth();
  const [detail, setDetail] = useState<ApiRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const tick = useRefreshTick();

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      try {
        const list = await apiRequest<{ data?: ApiRow[] }>('app/finance/applications');
        const first = list.data?.[0];
        if (!first) { if (alive) { setDetail(null); setLoading(false); } return; }
        const res = await apiRequest<{ data?: ApiRow }>(`app/finance/applications/${first.application_code}`);
        if (alive) setDetail(res.data ?? null);
      } catch (e) {
        if (alive) setError(naturalApiError(e, lang));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [lang, tick]);

  const stages = (detail?.stages ?? []) as ApiRow[];
  const pending = detail?.pending_user_action ? String(detail.pending_user_action) : null;

  return (
    <>
      <Header title={tx('অগ্রগতি', 'Progress')} onBack={() => setScreen('financeHub')} />
      <RefreshScroll>
        {loading ? <View style={{ padding: 24 }}><ActivityIndicator color={colors.maroon} /></View> : null}
        {error ? (
          <Card style={{ marginHorizontal: 16, marginTop: 14, padding: 14 }}>
            <Text style={{ color: colors.danger, fontSize: 13.5, lineHeight: 20 }}>{error}</Text>
          </Card>
        ) : null}

        {!loading && !detail && !error ? (
          <Card style={{ marginHorizontal: 16, marginTop: 14, padding: 18 }}>
            <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 21 }}>
              {tx('আপনার কোনো চলমান আবেদন নেই।', 'You have no active application.')}
            </Text>
          </Card>
        ) : null}

        {detail ? (
          <>
            <Card style={{ marginHorizontal: 16, marginTop: 14, padding: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                <View style={styles.flex}>
                  <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '700', letterSpacing: 0.3 }}>
                    {tx('আবেদন কোড', 'Application code')}
                  </Text>
                  <Text style={{ color: colors.ink, fontSize: 18, fontWeight: '800', marginTop: 2 }}>
                    {String(detail.application_code)}
                  </Text>
                  <Text style={{ color: colors.muted, fontSize: 13, marginTop: 2 }}>
                    {rowTitle({ title_bn: detail.product_bn, title_en: detail.product_en }, lang, '')}
                  </Text>
                </View>
                <Badge label={financeLabel(String(detail.status), lang)} tone="gold" />
              </View>

              {/* The three numbers a borrower checks, side by side rather than as
                  a stack of label/value rows they have to read through. */}
              <View style={fin.hubStatRow}>
                {([
                  [tx('আবেদনকৃত', 'Requested'), amount(Number(detail.requested_amount ?? 0), lang)],
                  [tx('সুদ ও মেয়াদ', 'Rate & term'),
                   `${num(Number(detail.interest_rate_annual ?? 0), lang)}% · ${num(Number(detail.tenure_months ?? 0), lang)} ${tx('মাস', 'mo')}`],
                  [tx('সম্ভাব্য কিস্তি', 'Est. instalment'), amount(Number(detail.emi_amount ?? 0), lang)],
                ] as [string, string][]).map(([k, v]) => (
                  <View key={k} style={fin.hubStat}>
                    <Text style={fin.hubStatLabel}>{k}</Text>
                    <Text style={fin.hubStatValue}>{v}</Text>
                  </View>
                ))}
              </View>
            </Card>

            {pending ? (
              <Card style={fin.actionBanner}>
                <Text style={{ fontSize: 20 }}>!</Text>
                <View style={styles.flex}>
                  <Text style={{ color: '#7A5200', fontWeight: '800', fontSize: 14.5 }}>
                    {tx('আপনার পদক্ষেপ প্রয়োজন', 'Action needed from you')}
                  </Text>
                  <Text style={{ color: '#7A5200', fontSize: 13, marginTop: 2 }}>
                    {(() => { const l = PENDING_ACTION_LABEL[pending]; return l ? (lang === 'bn' ? l[0] : l[1]) : pending; })()}
                  </Text>
                </View>
              </Card>
            ) : null}

            <SectionTitle title={tx('ধাপসমূহ', 'Stages')} />
            <Card style={{ marginHorizontal: 16, padding: 16 }}>
              {stages.map((s, i) => {
                const state = String(s.state);
                const done = state === 'complete';
                const active = state === 'active';
                const tone = done ? colors.green : active ? colors.maroon : colors.line;
                return (
                  <View key={String(s.index)} style={fin.stageRow}>
                    <View style={fin.stageRail}>
                      <View style={[fin.stageDot, { borderColor: tone, backgroundColor: done ? colors.green : active ? colors.maroon : colors.card }]}>
                        {done ? <Text style={{ color: '#fff', fontWeight: '800', fontSize: 12 }}>✓</Text> : null}
                      </View>
                      {i < stages.length - 1 ? <View style={fin.stageLine} /> : null}
                    </View>
                    <View style={fin.stageBody}>
                      <Text style={[fin.stageTitle, active && { color: colors.maroon }]}>
                        {rowTitle({ title_bn: s.title_bn, title_en: s.title_en }, lang, '')}
                      </Text>
                      {/* Who holds the work right now — the single biggest
                          anxiety-reducer for someone waiting on a loan. A chip
                          rather than a sentence so it scans down the column. */}
                      <View style={fin.stageMetaRow}>
                        <View style={[fin.ownerChip, active && { backgroundColor: colors.rose, borderColor: '#EBDDE4' }]}>
                          <Text style={fin.ownerChipText}>
                            {rowTitle({ title_bn: s.owner_bn, title_en: s.owner_en }, lang, '')}
                          </Text>
                        </View>
                        {s.completed_at ? (
                          <Text style={fin.stageDate}>✓ {formatDate(String(s.completed_at), lang)}</Text>
                        ) : active ? (
                          <Text style={fin.stageDate}>{tx('চলমান', 'In progress')}</Text>
                        ) : (
                          <Text style={fin.stageDate}>{tx('অপেক্ষমাণ', 'Pending')}</Text>
                        )}
                      </View>
                    </View>
                  </View>
                );
              })}
            </Card>
          </>
        ) : null}

        <OfficerHelpStrip district={user?.district} title={tx('আপনার আবেদনের দায়িত্বে', 'Handling your application')} />

        <Text style={fin.refreshHint}>
          {tx('টানুন — সর্বশেষ তথ্যের জন্য রিফ্রেশ করুন', 'Pull to refresh for the latest update')}
        </Text>
        <View style={{ height: 28 }} />
      </RefreshScroll>
    </>
  );
}

// ---------------------------------------------------------------------------
// Assessment outcome — SRS §15.4–15.5
// ---------------------------------------------------------------------------

/**
 * `loanResult` (MOB-LON-24). The section order is prescribed, and prescribed for
 * a reason: the outcome, then what to do about it, then what is strong, then what
 * is weak. A screen that opens with the weaknesses reads as a verdict; this one
 * reads as a next step.
 *
 * Nothing here exposes a weight, a per-criterion rating or an internal reason
 * code (MOB-LON-26) — the server does not send them.
 */
function LoanResult({
  setScreen, onOpenSheet,
}: {
  setScreen: (screen: Screen) => void;
  onOpenSheet: (topic: string) => void;
}) {
  const { tx, lang } = useLanguage();
  const { user } = useAuth();
  const [envelope, setEnvelope] = useState<AssessmentEnvelope | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await apiRequest<{ data?: AssessmentEnvelope }>('app/finance/assessment');
        if (alive) setEnvelope(res.data ?? { state: 'not_assessed', assessment: null });
      } catch {
        if (alive) setEnvelope({ state: 'not_assessed', assessment: null });
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const a = envelope?.assessment ?? null;

  function runPathway() {
    const wantsPlan = a?.pathway?.code === 'complete_development' || a?.pathway?.code === 'reduced_loan_limit';
    setScreen(wantsPlan ? 'developmentPlan' : 'loanStatus');
  }

  if (busy) {
    return (
      <>
        <Header title={tx('আপনার ফাইন্যান্স প্রোফাইল', 'Your finance profile')} onBack={() => setScreen('financeHub')} />
        <View style={{ padding: 24 }}><ActivityIndicator color={colors.maroon} /></View>
      </>
    );
  }

  if (!a) {
    return (
      <>
        <Header title={tx('আপনার ফাইন্যান্স প্রোফাইল', 'Your finance profile')} onBack={() => setScreen('financeHub')} />
        <RefreshScroll>
          <Card style={{ marginHorizontal: 16, marginTop: 16, padding: 18 }}>
            <Text style={{ color: colors.ink, fontSize: 16, fontWeight: '700' }}>
              {tx('মূল্যায়ন এখনো হয়নি', 'No assessment yet')}
            </Text>
            <Text style={{ color: colors.muted, fontSize: 13.5, marginTop: 8, lineHeight: 20 }}>
              {tx('আপনার আবেদন যাচাই হওয়ার পর এখানে ফলাফল দেখতে পাবেন।',
                  'Your result will appear here once your application has been reviewed.')}
            </Text>
            <View style={{ marginTop: 14 }}>
              <AppButton title={tx('অগ্রগতি দেখুন', 'View progress')} onPress={() => setScreen('loanStatus')} />
            </View>
          </Card>
          <OfficerHelpStrip district={user?.district} />
          <View style={{ height: 28 }} />
        </RefreshScroll>
      </>
    );
  }

  return (
    <>
      {/* History sits on the badge, beside the assessment it belongs to. */}
      <Header title={tx('আপনার ফাইন্যান্স প্রোফাইল', 'Your finance profile')} onBack={() => setScreen('financeHub')} />
      <RefreshScroll>
        {/* MOB-LON-27. A blocked result leads with what would change it, and never
            with the word "rejected". */}
        {a.blocked ? (
          <Card style={{ marginHorizontal: 16, marginTop: 14, padding: 16, backgroundColor: '#F8EAE9', borderWidth: 1, borderColor: '#E5B5B1' }}>
            <Text style={{ color: '#8A2F28', fontWeight: '800', fontSize: 16 }}>
              {tx('এই মুহূর্তে আমরা এগোতে পারছি না', 'We cannot proceed at this time')}
            </Text>
            {a.blocked_reasons.map((r, i) => (
              <View key={i} style={{ marginTop: 10 }}>
                <Text style={{ color: '#8A2F28', fontSize: 14, fontWeight: '700' }}>{lang === 'bn' ? r.bn : r.en}</Text>
                {(lang === 'bn' ? r.action_bn : r.action_en) ? (
                  <Text style={{ color: '#8A2F28', fontSize: 13.5, marginTop: 4, lineHeight: 20 }}>
                    {lang === 'bn' ? r.action_bn : r.action_en}
                  </Text>
                ) : null}
              </View>
            ))}
            <Text style={{ color: '#8A2F28', fontSize: 13, marginTop: 12, lineHeight: 19 }}>
              {tx('এগুলো ঠিক হলে আবার মূল্যায়নের আবেদন করা যাবে। আপনার এলাকার কর্মকর্তা সাহায্য করবেন।',
                  'Once these are resolved you can ask for a fresh assessment. Your local officer can help.')}
            </Text>
          </Card>
        ) : null}

        {/* Three separate labelled outputs (P2) — never merged into one verdict.
            Same compact badge as the readiness result: this is the verified
            twin of that screen and the two should not look like different
            products. */}
        <View style={fin.badge}>
          <View style={fin.badgeTop}>
            <View style={[fin.badgeRing, { borderColor: GRADE_COLORS[a.grade], backgroundColor: GRADE_TINTS[a.grade] }]}>
              <Text style={[fin.badgeGrade, { color: GRADE_COLORS[a.grade] }]}>{a.grade}</Text>
            </View>
            <View style={styles.flex}>
              <Text style={fin.badgeScoreLabel}>{tx('যাচাইকৃত ঝুঁকি স্কোর', 'Verified risk score')}</Text>
              <Text style={fin.badgeScore}>
                {num(a.score, lang)}<Text style={fin.badgeOutOf}> / {num(100, lang)}</Text>
              </Text>
            </View>
          </View>

          <Text style={fin.badgeMessage}>{lang === 'bn' ? a.grade_label.bn : a.grade_label.en}</Text>

          <View style={fin.badgeChipRow}>
            {[
              `${tx('ঝুঁকি গ্রেড', 'Risk grade')} ${a.grade}`,
              lang === 'bn' ? a.readiness_label.bn : a.readiness_label.en,
              `${tx('নির্ভরযোগ্যতা', 'Confidence')}: ${lang === 'bn' ? a.confidence_label.bn : a.confidence_label.en}`,
            ].map((label, i) => (
              <View key={label} style={fin.badgeChip}>
                <Text style={[fin.badgeChipText, i === 1 && fin.badgeChipTextGold]}>{label}</Text>
              </View>
            ))}
          </View>

          <View style={fin.badgeFoot}>
            <View style={styles.flex}>
              <Text style={fin.badgeMicro}>
                {tx('যাচাইকৃত মূল্যায়ন', 'Verified assessment')} · {a.application_code}
              </Text>
              <Text style={fin.badgeMicro}>
                {/* The sequence number matters: a farmer who has been assessed
                    twice needs to know which one they are looking at. */}
                {a.sequence_no > 1
                  ? tx(`${num(a.sequence_no, 'bn')}তম মূল্যায়ন · ${formatDate(a.assessed_at, lang)}`,
                       `Assessment #${a.sequence_no} · ${formatDate(a.assessed_at, lang)}`)
                  : formatDate(a.assessed_at, lang)}
              </Text>
            </View>
            <Pressable
              onPress={() => setScreen('assessmentHistory')}
              style={({ pressed }) => [fin.badgeRetake, pressed && styles.pressed]}
            >
              <Text style={fin.badgeRetakeText}>{tx('ইতিহাস', 'History')}</Text>
            </Pressable>
          </View>
        </View>

        {/* MOB-LON-25. Where safeguards changed the outcome, both results are shown.
            Collapsing them would credit the farmer for a guarantee they did not
            earn, and hide that the standing is the structure's, not theirs. */}
        {a.structured_readiness_label ? (
          <Card style={{ marginHorizontal: 16, marginTop: 12, padding: 14 }}>
            <Text style={{ color: colors.muted, fontSize: 12.5, fontWeight: '700', letterSpacing: 0.3 }}>
              {tx('প্রকল্প কাঠামোর সঙ্গে', 'With project structure')}
            </Text>
            <Text style={{ color: colors.ink, fontSize: 14.5, marginTop: 6, lineHeight: 21 }}>
              {tx('নিজস্ব গ্রেড', 'Inherent grade')}: <Text style={{ fontWeight: '800' }}>{a.inherent_grade ?? a.grade}</Text>
              {'  ·  '}
              {tx('কাঠামোসহ', 'With structure')}: <Text style={{ fontWeight: '800' }}>
                {lang === 'bn' ? a.structured_readiness_label.bn : a.structured_readiness_label.en}
              </Text>
            </Text>
          </Card>
        ) : null}

        {/* One recommended next step, one primary button. */}
        {!a.blocked && a.pathway ? (
          <Card style={{ marginHorizontal: 16, marginTop: 12, padding: 16 }}>
            <Text style={{ color: colors.muted, fontSize: 12.5, fontWeight: '700', letterSpacing: 0.3 }}>
              {tx('পরবর্তী ধাপ', 'Recommended next step')}
            </Text>
            <Text style={{ color: colors.ink, fontSize: 16, fontWeight: '700', marginTop: 6, lineHeight: 23 }}>
              {lang === 'bn' ? a.pathway.label_bn : a.pathway.label_en}
            </Text>
            {a.recommended_amount != null && a.recommended_amount < a.requested_amount ? (
              /* A reduced limit is the hardest thing on this screen to accept,
                 so it is shown to scale rather than as two numbers in a
                 sentence: the farmer can see how much of the ask survived. */
              <View style={{ marginTop: 12 }}>
                <View style={fin.askRow}>
                  <Text style={fin.askLabel}>{tx('আপনি চেয়েছেন', 'You asked for')}</Text>
                  <Text style={fin.askValueMuted}>{amount(a.requested_amount, lang)}</Text>
                </View>
                <View style={fin.askTrack}><View style={[fin.askFillMuted, { width: '100%' }]} /></View>
                <View style={[fin.askRow, { marginTop: 10 }]}>
                  <Text style={fin.askLabel}>{tx('এখন সুপারিশ', 'Recommended now')}</Text>
                  <Text style={fin.askValue}>{amount(a.recommended_amount, lang)}</Text>
                </View>
                <View style={fin.askTrack}>
                  <View style={[fin.askFill, {
                    width: `${a.requested_amount > 0 ? Math.max(4, Math.min(100, Math.round((a.recommended_amount / a.requested_amount) * 100))) : 0}%`,
                  }]} />
                </View>
                <Text style={fin.askNote}>
                  {tx('সম্পূর্ণ পরিমাণ পরে পাওয়া যেতে পারে — নিচের ধাপগুলো শেষ করলে সীমা পুনর্বিবেচনা হয়।',
                      'The full amount can come later — the limit is reconsidered once the steps below are done.')}
                </Text>
              </View>
            ) : null}
            <View style={{ marginTop: 14 }}>
              <AppButton
                title={a.pathway.code === 'complete_development' || a.pathway.code === 'reduced_loan_limit'
                  ? tx('উন্নয়ন পরিকল্পনা দেখুন', 'View development plan')
                  : tx('অগ্রগতি দেখুন', 'View progress')}
                onPress={runPathway}
              />
            </View>
          </Card>
        ) : null}

        {a.strengths.length ? (
          <>
            <SectionTitle title={tx('যা শক্তিশালী', 'What is strong')} />
            <Card style={{ marginHorizontal: 16, padding: 14 }}>
              {a.strengths.map((s, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 10, marginTop: i ? 10 : 0 }}>
                  <Text style={{ color: colors.green, fontSize: 15, fontWeight: '800' }}>✓</Text>
                  <Text style={{ color: colors.ink, fontSize: 14, flex: 1, lineHeight: 21 }}>
                    {lang === 'bn' ? s.bn : s.en}
                  </Text>
                </View>
              ))}
            </Card>
          </>
        ) : null}

        {a.improvements.length ? (
          <>
            <SectionTitle title={tx('যা উন্নত করা দরকার', 'What needs improvement')} />
            <Card style={{ marginHorizontal: 16, padding: 14 }}>
              {a.improvements.map((s, i) => (
                <View key={i} style={{ flexDirection: 'row', gap: 10, marginTop: i ? 10 : 0 }}>
                  <Text style={{ color: colors.gold, fontSize: 15, fontWeight: '800' }}>•</Text>
                  <Text style={{ color: colors.ink, fontSize: 14, flex: 1, lineHeight: 21 }}>
                    {lang === 'bn' ? s.bn : s.en}
                  </Text>
                </View>
              ))}
            </Card>
          </>
        ) : null}

        <SectionTitle title={tx('আপনার যোগ্যতা বাড়ান', 'Improve your eligibility')} />
        <View style={{ paddingHorizontal: 16 }}>
          <AppButton
            variant="outline"
            title={tx('উন্নয়ন পরিকল্পনা খুলুন', 'Open development plan')}
            onPress={() => setScreen('developmentPlan')}
          />
        </View>

        <OfficerHelpStrip district={user?.district} />
        <View style={{ height: 28 }} />
      </RefreshScroll>
    </>
  );
}

/**
 * `developmentPlan` (MOB-LON-28/29). The tasks are the product: a farmer who is
 * not ready needs a list of things to do, not a score to stare at.
 *
 * The reassessment CTA appears only when nothing is outstanding. Offering it
 * early wastes the farmer's trip and the analyst's review, and teaches both that
 * the button means nothing.
 */
function DevelopmentPlanScreen({
  setScreen, onOpenSheet, onNavigateAway,
}: {
  setScreen: (screen: Screen) => void;
  onOpenSheet: (topic: string) => void;
  onNavigateAway: (screen: Screen) => void;
}) {
  const { tx, lang } = useLanguage();
  const { user } = useAuth();
  const [plan, setPlan] = useState<DevelopmentPlan | null>(null);
  const [busy, setBusy] = useState(true);
  const [requested, setRequested] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await apiRequest<{ data?: DevelopmentPlan }>('app/finance/development-plan');
        if (alive) setPlan(res.data ?? null);
      } catch {
        if (alive) setPlan(null);
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  function openTask(task: DevelopmentTask) {
    const target = resolveActionLink(task.action_link);
    if (!target) return;
    if (target.kind === 'sheet') { onOpenSheet(target.topic); return; }
    onNavigateAway(target.screen);
  }

  async function requestReassessment() {
    try {
      await apiCreate('app/finance/reassessment-request', {});
      setRequested(true);
      setNotice(tx('আবেদন পাঠানো হয়েছে। কর্মকর্তা যোগাযোগ করবেন।',
                   'Request sent. An officer will be in touch.'));
    } catch (error) {
      setNotice(naturalApiError(error, lang));
    }
  }

  const doneCount = plan ? plan.total - plan.outstanding : 0;
  // Outstanding first, then done. The server returns assignment order, which
  // buries the one step left under six that are already ticked.
  const orderedTasks = plan ? [...plan.tasks].sort((a, b) => Number(a.done) - Number(b.done)) : [];
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <Header title={tx('উন্নয়ন পরিকল্পনা', 'Development plan')} onBack={() => setScreen('loanResult')} />
      <RefreshScroll>
        {busy ? (
          <View style={{ padding: 24 }}><ActivityIndicator color={colors.maroon} /></View>
        ) : !plan || plan.total === 0 ? (
          <Card style={{ marginHorizontal: 16, marginTop: 16, padding: 18 }}>
            <Text style={{ color: colors.ink, fontSize: 16, fontWeight: '700' }}>
              {tx('এখনো কোনো কাজ দেওয়া হয়নি', 'No tasks assigned yet')}
            </Text>
            <Text style={{ color: colors.muted, fontSize: 13.5, marginTop: 8, lineHeight: 20 }}>
              {tx('মূল্যায়নের পর আপনার জন্য নির্দিষ্ট কাজ এখানে আসবে।',
                  'Once you have been assessed, the specific steps for you will appear here.')}
            </Text>
          </Card>
        ) : (
          <>
            <Card style={{ marginHorizontal: 16, marginTop: 14, padding: 16 }}>
              <Text style={{ color: colors.ink, fontSize: 15.5, fontWeight: '700' }}>
                {num(doneCount, lang)} / {num(plan.total, lang)} {tx('সম্পন্ন', 'done')}
              </Text>
              <View style={{ height: 8, backgroundColor: colors.line, borderRadius: 999, marginTop: 10, overflow: 'hidden' }}>
                <View style={{
                  height: 8,
                  borderRadius: 999,
                  backgroundColor: colors.green,
                  width: `${plan.total ? Math.round((doneCount / plan.total) * 100) : 0}%`,
                }} />
              </View>
              <Text style={{ color: colors.muted, fontSize: 13, marginTop: 10, lineHeight: 19 }}>
                {plan.outstanding === 0
                  ? tx('সব কাজ শেষ। এখন আবার মূল্যায়নের আবেদন করতে পারেন।',
                       'Everything is done. You can ask for a fresh assessment now.')
                  : tx('প্রতিটি কাজ শেষ হলে আপনার অবস্থান ভালো হবে।',
                       'Each completed step improves your position.')}
              </Text>
            </Card>

            {orderedTasks.map((task) => (
              <Pressable
                key={task.id}
                onPress={() => openTask(task)}
                disabled={task.done || !task.action_link}
                accessibilityLabel={lang === 'bn' ? task.title.bn : task.title.en}
                style={({ pressed }) => [pressed && !task.done && styles.pressed]}
              >
                <Card style={{ marginHorizontal: 16, marginTop: 12, padding: 14, opacity: task.done ? 0.62 : 1 }}>
                  <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
                    <View style={{
                      width: 24, height: 24, borderRadius: 12, borderWidth: 2, marginTop: 2,
                      alignItems: 'center', justifyContent: 'center',
                      borderColor: task.done ? colors.green : colors.line,
                      backgroundColor: task.done ? colors.green : 'transparent',
                    }}>
                      {task.done ? <Text style={{ color: '#fff', fontWeight: '800', fontSize: 13 }}>✓</Text> : null}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{
                        color: colors.ink, fontSize: 15, fontWeight: '700', lineHeight: 22,
                        textDecorationLine: task.done ? 'line-through' : 'none',
                      }}>
                        {lang === 'bn' ? task.title.bn : task.title.en}
                      </Text>
                      {(lang === 'bn' ? task.detail.bn : task.detail.en) ? (
                        <Text style={{ color: colors.muted, fontSize: 13, marginTop: 4, lineHeight: 19 }}>
                          {lang === 'bn' ? task.detail.bn : task.detail.en}
                        </Text>
                      ) : null}
                      <View style={{ flexDirection: 'row', gap: 12, marginTop: 8, alignItems: 'center' }}>
                        {task.due_on ? (
                          /* A date that has already passed is the only thing on
                             this card that needs to shout. */
                          <Text style={{
                            color: !task.done && String(task.due_on).slice(0, 10) < today ? colors.danger : colors.muted,
                            fontSize: 12.5,
                            fontWeight: !task.done && String(task.due_on).slice(0, 10) < today ? '700' : '400',
                          }}>
                            {!task.done && String(task.due_on).slice(0, 10) < today
                              ? tx(`সময় পেরিয়েছে · ${formatDate(task.due_on, lang)}`, `Overdue · ${formatDate(task.due_on, lang)}`)
                              : `${tx('সময়সীমা', 'Due')}: ${formatDate(task.due_on, lang)}`}
                          </Text>
                        ) : null}
                        {!task.done && task.action_link ? (
                          <Text style={{ color: colors.maroon, fontSize: 12.5, fontWeight: '700' }}>
                            {tx('শুরু করুন →', 'Start →')}
                          </Text>
                        ) : null}
                      </View>
                    </View>
                  </View>
                </Card>
              </Pressable>
            ))}

            {notice ? (
              <Card style={{ marginHorizontal: 16, marginTop: 14, padding: 14 }}>
                <Text style={{ color: colors.ink, fontSize: 13.5, lineHeight: 20 }}>{notice}</Text>
              </Card>
            ) : null}

            {plan.can_request_reassessment && !requested ? (
              <View style={{ paddingHorizontal: 16, marginTop: 16 }}>
                <AppButton title={tx('পুনরায় মূল্যায়নের আবেদন', 'Request reassessment')} onPress={requestReassessment} />
              </View>
            ) : plan.outstanding === 0 && !requested ? (
              /* All the farmer's work is done but the request is still withheld
                 — usually because an officer has to verify the evidence first.
                 A silent screen with no next move reads as a broken button. */
              <View style={styles.noteBlue}>
                <Text style={styles.noteText}>
                  {tx('সব কাজ শেষ। কর্মকর্তা কাগজপত্র যাচাই করলেই পুনঃমূল্যায়নের আবেদন করা যাবে।',
                      'All steps are done. Once your officer has verified the evidence you will be able to request a reassessment.')}
                </Text>
              </View>
            ) : null}
          </>
        )}

        <OfficerHelpStrip district={user?.district} />
        <View style={{ height: 28 }} />
      </RefreshScroll>
    </>
  );
}

/**
 * `loanAccount` (MOB-LON-31). Read-only in v1 — there is no in-app payment, so
 * every figure here is something the farmer checks rather than acts on.
 *
 * The two questions a borrower actually opens this for are "how much, and when"
 * and "how far through am I". Both are answered above the fold; the full
 * schedule is below for the one time in twelve that someone wants it.
 */
/**
 * What a farmer needs when an instalment is late: how much and how long, what
 * it is costing, what happens next, and who to talk to. The old screen showed
 * only the first of those, which left the farmer with a red number and no move
 * to make.
 */
function OverdueHandling({ arrears, account }: { arrears?: LoanArrears; account: NonNullable<LoanAccountView['account']> }) {
  const { tx, lang } = useLanguage();
  const dpd = arrears?.days_past_due ?? account.days_past_due;
  const bucket = arrears?.bucket ?? (dpd <= 30 ? '1_30' : dpd <= 60 ? '31_60' : dpd <= 90 ? '61_90' : '90_plus');
  const overdueAmount = arrears?.overdue_amount ?? account.overdue_amount;
  const penalty = arrears?.penalty_accrued ?? 0;
  const count = arrears?.overdue_installments ?? 0;
  const officer = arrears?.officer ?? null;

  // The escalation ladder, stated plainly and in advance. A farmer who knows a
  // field visit comes at 30 days can plan for it; one who is surprised by it
  // cannot.
  const ladder: Array<{ key: string; bn: string; en: string; from: number }> = [
    { key: '1_30', from: 1, bn: 'মোবাইলে মনে করিয়ে দেওয়া হবে এবং মাঠ কর্মকর্তা ফোন করবেন।', en: 'SMS reminders, and a phone call from your field officer.' },
    { key: '31_60', from: 31, bn: 'মাঠ কর্মকর্তা সরাসরি খামারে আসবেন এবং পরিশোধের পরিকল্পনা করা হবে।', en: 'Your field officer visits the farm and a repayment plan is agreed.' },
    { key: '61_90', from: 61, bn: 'কিস্তি পুনর্গঠনের আবেদন করা যাবে; ঋণদাতাকে জানানো হবে।', en: 'You may apply to restructure the instalments; the lender is informed.' },
    { key: '90_plus', from: 91, bn: 'ঋণ খেলাপি হিসেবে চিহ্নিত হবে এবং ভবিষ্যতের ঋণ সীমিত হবে।', en: 'The loan is classified in default and future credit is restricted.' },
  ];
  const currentIndex = ladder.findIndex((l) => l.key === bucket);

  return (
    <>
      <Card style={{ marginHorizontal: 16, marginTop: 14, padding: 16, backgroundColor: '#F8EAE9', borderWidth: 1, borderColor: '#E5B5B1' }}>
        <Text style={{ color: '#8A2F28', fontWeight: '800', fontSize: 15.5 }}>
          {tx('বকেয়া কিস্তি আছে', 'You have overdue instalments')}
        </Text>
        <Text style={{ color: '#8A2F28', fontSize: 26, fontWeight: '800', marginTop: 6 }}>
          {amount(overdueAmount, lang)}
        </Text>
        <Text style={{ color: '#8A2F28', fontSize: 13, marginTop: 6, lineHeight: 19 }}>
          {count > 0
            ? tx(`${num(count, 'bn')}টি কিস্তি · ${num(dpd, 'bn')} দিন পার হয়েছে`, `${count} instalment${count > 1 ? 's' : ''} · ${dpd} days past due`)
            : tx(`${num(dpd, 'bn')} দিন পার হয়েছে`, `${dpd} days past due`)}
          {arrears?.oldest_due_date ? ` · ${tx('প্রথম বকেয়া', 'Oldest due')} ${formatDate(arrears.oldest_due_date, lang)}` : ''}
        </Text>
        {penalty > 0 ? (
          <View style={{ marginTop: 12, backgroundColor: 'white', borderRadius: 9, paddingHorizontal: 10, paddingVertical: 8 }}>
            <Text style={{ color: '#8A2F28', fontSize: 12.5, fontWeight: '700' }}>
              {tx('জরিমানা জমা হয়েছে', 'Penalty accrued so far')}: {amount(penalty, lang)}
            </Text>
            <Text style={{ color: colors.muted, fontSize: 11.5, marginTop: 3, lineHeight: 16 }}>
              {tx('দেরি যত বাড়বে, জরিমানাও তত বাড়বে। আগে পরিশোধ করলে খরচ কম।',
                  'The longer it runs, the more it costs. Paying sooner costs less.')}
            </Text>
          </View>
        ) : null}
      </Card>

      <SectionTitle title={tx('এরপর কী হবে', 'What happens next')} />
      <Card style={{ marginHorizontal: 16, padding: 14 }}>
        {ladder.map((rung, i) => {
          const reached = i <= currentIndex;
          const now = i === currentIndex;
          return (
            <View key={rung.key} style={{ flexDirection: 'row', gap: 10, paddingTop: i ? 10 : 0, marginTop: i ? 10 : 0, borderTopWidth: i ? 1 : 0, borderTopColor: colors.line }}>
              <View style={[styles.trailDot, reached && styles.trailDotDone, now && styles.trailDotCurrent]}>
                <Text style={reached ? styles.trailDotText : styles.trailDotTextPending}>{num(i + 1, lang)}</Text>
              </View>
              <View style={styles.flex}>
                <Text style={{ color: now ? colors.ink : colors.muted, fontSize: 12, fontWeight: '800' }}>
                  {rung.from >= 91
                    ? tx('৯০+ দিন', '90+ days')
                    : tx(`${num(rung.from, 'bn')}–${num(rung.from + 29, 'bn')} দিন`, `${rung.from}–${rung.from + 29} days`)}
                </Text>
                <Text style={{ color: colors.ink, fontSize: 13, lineHeight: 19, marginTop: 2 }}>{tx(rung.bn, rung.en)}</Text>
                {now ? (
                  <View style={styles.trailCurrentPill}>
                    <Text style={styles.trailCurrentPillText}>{tx('আপনি এখানে', 'YOU ARE HERE')}</Text>
                  </View>
                ) : null}
              </View>
            </View>
          );
        })}
      </Card>

      <SectionTitle title={tx('এখন কী করবেন', 'What you can do now')} />
      <Card style={{ marginHorizontal: 16, padding: 14 }}>
        {[
          { bn: 'নিকটস্থ শাখা বা মাঠ কর্মকর্তার কাছে বকেয়া টাকা জমা দিন।', en: 'Pay the overdue amount at your branch or to your field officer.' },
          { bn: 'একবারে দিতে না পারলে আংশিক জমা দিন — জরিমানার হিসাব কমে।', en: 'If you cannot pay it all, pay part of it — the penalty is calculated on what is left.' },
          { bn: 'সমস্যা থাকলে কিস্তি পুনর্গঠনের জন্য মাঠ কর্মকর্তার সঙ্গে কথা বলুন।', en: 'If something has gone wrong, talk to your field officer about restructuring the instalments.' },
        ].map((row, i) => (
          <View key={row.en} style={{ flexDirection: 'row', gap: 8, marginTop: i ? 10 : 0 }}>
            <Text style={{ color: colors.maroon, fontSize: 13.5, fontWeight: '800' }}>·</Text>
            <Text style={{ color: colors.ink, fontSize: 13.5, lineHeight: 20, flex: 1 }}>{tx(row.bn, row.en)}</Text>
          </View>
        ))}
        {/* In-app payment does not exist in v1. Saying so is better than a
            button that goes nowhere. */}
        <Text style={{ color: colors.muted, fontSize: 11.5, lineHeight: 16, marginTop: 12 }}>
          {tx('এই মুহূর্তে অ্যাপ থেকে সরাসরি পরিশোধ করা যায় না।', 'Paying directly from the app is not available yet.')}
        </Text>
      </Card>

      {officer ? (
        <>
          <SectionTitle title={tx('যোগাযোগ করুন', 'Who to contact')} />
          <Card style={{ marginHorizontal: 16, padding: 14 }}>
            <Text style={styles.officerName}>{officer.name}</Text>
            <Text style={styles.officerMeta}>{[officer.phone ? `☎ ${officer.phone}` : '', officer.area].filter(Boolean).join(' · ')}</Text>
            {officer.phone ? (
              <AppButton title={tx('কর্মকর্তাকে কল করুন', 'Call your officer')} variant="outline" onPress={() => Linking.openURL(`tel:${officer.phone}`)} />
            ) : null}
          </Card>
        </>
      ) : null}
    </>
  );
}

function LoanAccountScreen({ setScreen }: { setScreen: (screen: Screen) => void }) {
  const { tx, lang } = useLanguage();
  const { user } = useAuth();
  const [data, setData] = useState<LoanAccountView | null>(null);
  const [busy, setBusy] = useState(true);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await apiRequest<{ data?: LoanAccountView }>('app/finance/loan-account');
        if (alive) setData(res.data ?? null);
      } catch {
        if (alive) setData(null);
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const acc = data?.has_account ? data.account : null;
  const schedule = data?.schedule ?? [];
  const shown = showAll ? schedule : schedule.slice(0, 6);

  const rowTone = (status: string) =>
    status === 'paid' ? colors.green
    : status === 'overdue' ? '#B4443C'
    : status === 'partial' ? colors.gold
    : colors.muted;

  return (
    <>
      <Header title={tx('আমার ঋণ', 'My loan')} onBack={() => setScreen('financeHub')} />
      <RefreshScroll>
        {busy ? (
          <View style={{ padding: 24 }}><ActivityIndicator color={colors.maroon} /></View>
        ) : !acc ? (
          <Card style={{ marginHorizontal: 16, marginTop: 16, padding: 18 }}>
            <Text style={{ color: colors.ink, fontSize: 16, fontWeight: '700' }}>
              {tx('কোনো চলমান ঋণ নেই', 'No active loan')}
            </Text>
            <Text style={{ color: colors.muted, fontSize: 13.5, marginTop: 8, lineHeight: 20 }}>
              {tx('ঋণ অনুমোদিত ও বিতরণ হলে এখানে কিস্তির তথ্য দেখতে পাবেন।',
                  'Once a loan is approved and disbursed, your instalments will appear here.')}
            </Text>
          </Card>
        ) : (
          <>
            {/* Overdue leads, because it is the only thing on this screen that
                needs action today. */}
            {acc.is_overdue ? <OverdueHandling arrears={data?.arrears} account={acc} /> : null}

            {/* How much, and when. */}
            <Card style={{ marginHorizontal: 16, marginTop: 14, padding: 18 }}>
              <Text style={{ color: colors.muted, fontSize: 12.5, fontWeight: '700', letterSpacing: 0.3 }}>
                {tx('পরবর্তী কিস্তি', 'Next instalment')}
              </Text>
              <Text style={{ color: colors.ink, fontSize: 28, fontWeight: '800', marginTop: 4 }}>
                {amount(acc.next_due_amount, lang)}
              </Text>
              <Text style={{ color: colors.muted, fontSize: 13.5, marginTop: 4 }}>
                {acc.next_due_date
                  ? `${tx('তারিখ', 'Due')} ${acc.next_due_date}`
                  : tx('সব কিস্তি পরিশোধ হয়েছে', 'All instalments paid')}
              </Text>

              {/* How far through. */}
              <View style={{ height: 8, backgroundColor: colors.line, borderRadius: 999, marginTop: 16, overflow: 'hidden' }}>
                <View style={{ height: 8, borderRadius: 999, backgroundColor: colors.green, width: `${acc.progress_pct}%` }} />
              </View>
              <Text style={{ color: colors.muted, fontSize: 13, marginTop: 8 }}>
                {num(acc.installments_paid, lang)} / {num(acc.installments_total, lang)} {tx('কিস্তি পরিশোধ', 'instalments paid')}
                {'  ·  '}
                {tx('বাকি', 'Outstanding')} {amount(acc.outstanding_total, lang)}
              </Text>
            </Card>

            <SectionTitle title={tx('ঋণের বিবরণ', 'Loan details')} />
            <Card style={{ marginHorizontal: 16, padding: 14 }}>
              {([
                [tx('ঋণের পরিমাণ', 'Loan amount'), amount(acc.principal, lang)],
                [tx('সুদের হার', 'Interest rate'), `${num(acc.interest_rate_annual, lang)}% ${tx('বার্ষিক', 'per year')}`],
                [tx('মোট পরিশোধযোগ্য', 'Total payable'), amount(acc.total_payable, lang)],
                [tx('পরিশোধ হয়েছে', 'Paid so far'), amount(acc.amount_paid, lang)],
                [tx('মেয়াদ শেষ', 'Final instalment'), String(acc.maturity_date ?? '—')],
                [tx('আবেদন নম্বর', 'Application'), acc.application_code],
              ] as [string, string][]).map(([label, value], i) => (
                <View key={label} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginTop: i ? 10 : 0 }}>
                  <Text style={{ color: colors.muted, fontSize: 13.5 }}>{label}</Text>
                  <Text style={{ color: colors.ink, fontSize: 13.5, fontWeight: '700', flexShrink: 1, textAlign: 'right' }}>{value}</Text>
                </View>
              ))}
            </Card>

            <SectionTitle title={tx('কিস্তির তালিকা', 'Repayment schedule')} />
            <Card style={{ marginHorizontal: 16, padding: 14 }}>
              {shown.map((s, i) => (
                <View key={s.installment_no} style={{
                  flexDirection: 'row', alignItems: 'center', gap: 12,
                  paddingTop: i ? 10 : 0, marginTop: i ? 10 : 0,
                  borderTopWidth: i ? 1 : 0, borderTopColor: colors.line,
                }}>
                  <Text style={{ color: colors.muted, fontSize: 12.5, width: 26 }}>{num(s.installment_no, lang)}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.ink, fontSize: 14, fontWeight: '600' }}>{s.due_date}</Text>
                    {s.status === 'partial' || s.status === 'overdue' ? (
                      <Text style={{ color: rowTone(s.status), fontSize: 12, marginTop: 2 }}>
                        {s.amount_paid > 0
                          ? `${amount(s.amount_paid, lang)} ${tx('জমা', 'paid')}`
                          : tx('বকেয়া', 'overdue')}
                        {s.days_overdue > 0 ? ` · ${num(s.days_overdue, lang)} ${tx('দিন', 'days')}` : ''}
                      </Text>
                    ) : null}
                  </View>
                  <Text style={{ color: colors.ink, fontSize: 14, fontWeight: '700' }}>{amount(s.amount_due, lang)}</Text>
                  <Text style={{ color: rowTone(s.status), fontSize: 16, width: 18, textAlign: 'center' }}>
                    {s.status === 'paid' ? '✓' : s.status === 'overdue' ? '!' : '·'}
                  </Text>
                </View>
              ))}
              {schedule.length > 6 ? (
                <Pressable onPress={() => setShowAll((v) => !v)} style={({ pressed }) => [{ marginTop: 12 }, pressed && styles.pressed]}>
                  <Text style={{ color: colors.maroon, fontSize: 13.5, fontWeight: '700' }}>
                    {showAll
                      ? tx('কম দেখুন', 'Show less')
                      : `${tx('সব দেখুন', 'Show all')} (${num(schedule.length, lang)})`}
                  </Text>
                </Pressable>
              ) : null}
            </Card>

            {data && data.payments.length > 0 ? (
              <>
                <SectionTitle title={tx('জমার ইতিহাস', 'Payment history')} />
                <Card style={{ marginHorizontal: 16, padding: 14 }}>
                  {data.payments.map((p, i) => (
                    <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginTop: i ? 10 : 0 }}>
                      <View>
                        <Text style={{ color: colors.ink, fontSize: 13.5, fontWeight: '600' }}>
                          {String(p.paid_at).slice(0, 10)}
                        </Text>
                        {p.method ? <Text style={{ color: colors.muted, fontSize: 12 }}>{p.method}{p.reference ? ` · ${p.reference}` : ''}</Text> : null}
                      </View>
                      <Text style={{ color: colors.green, fontSize: 13.5, fontWeight: '700' }}>{amount(p.amount, lang)}</Text>
                    </View>
                  ))}
                </Card>
              </>
            ) : null}
          </>
        )}

        <OfficerHelpStrip district={user?.district} />
        <View style={{ height: 28 }} />
      </RefreshScroll>
    </>
  );
}

/**
 * A reason code's label describes the finding, not the change. "Low behavioural
 * assessment result" printed under "What improved" tells the farmer the opposite
 * of what happened, so the sentence is built from how the item moved.
 */
function changePhrase(
  change: NarrativeChange,
  lang: Lang,
  tx: (bn: string, en: string) => string
): string {
  const label = lang === 'bn' ? change.bn : change.en;
  switch (change.kind) {
    case 'resolved': return `${label} — ${tx('সমাধান হয়েছে', 'resolved')}`;
    case 'lost': return `${label} — ${tx('আর প্রযোজ্য নয়', 'no longer applies')}`;
    default: return label;   // 'gained' and 'appeared' read correctly as they are
  }
}

/**
 * `assessmentHistory` (MOB-LON-30). An improvement narrative, not a table of
 * scores — "you went from C to B, and here is what did it" is the only version of
 * this screen that changes anyone's behaviour.
 */
function AssessmentHistoryScreen({ setScreen }: { setScreen: (screen: Screen) => void }) {
  const { tx, lang } = useLanguage();
  const { user } = useAuth();
  const [history, setHistory] = useState<AssessmentHistory | null>(null);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await apiRequest<{ data?: AssessmentHistory }>('app/finance/assessment/history');
        if (alive) setHistory(res.data ?? null);
      } catch {
        if (alive) setHistory(null);
      } finally {
        if (alive) setBusy(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const narrative = history?.narrative ?? null;
  const change = narrative?.score_change ?? 0;

  return (
    <>
      <Header title={tx('মূল্যায়নের ইতিহাস', 'Assessment history')} onBack={() => setScreen('loanResult')} />
      <RefreshScroll>
        {busy ? (
          <View style={{ padding: 24 }}><ActivityIndicator color={colors.maroon} /></View>
        ) : !history || history.entries.length === 0 ? (
          <Card style={{ marginHorizontal: 16, marginTop: 16, padding: 18 }}>
            <Text style={{ color: colors.muted, fontSize: 13.5, lineHeight: 20 }}>
              {tx('এখনো কোনো মূল্যায়ন হয়নি।', 'No assessments yet.')}
            </Text>
          </Card>
        ) : (
          <>
            {narrative ? (
              <Card style={{ marginHorizontal: 16, marginTop: 14, padding: 16 }}>
                <Text style={{ color: colors.ink, fontSize: 15.5, fontWeight: '700', lineHeight: 23 }}>
                  {tx('আগে', 'Previous')}: {tx('গ্রেড', 'Grade')} {narrative.previous.grade} — {num(narrative.previous.score, lang)}
                  {'  ·  '}
                  {tx('এখন', 'Current')}: {tx('গ্রেড', 'Grade')} {narrative.current.grade} — {num(narrative.current.score, lang)}
                </Text>
                <Text style={{
                  color: change > 0 ? colors.green : change < 0 ? colors.gold : colors.muted,
                  fontSize: 14, fontWeight: '700', marginTop: 8,
                }}>
                  {change === 0
                    ? tx('স্কোর অপরিবর্তিত', 'Score unchanged')
                    : `${change > 0 ? '▲' : '▼'} ${num(Math.abs(change), lang)} ${tx('পয়েন্ট', 'points')}`}
                </Text>
                {narrative.actions_completed > 0 ? (
                  <Text style={{ color: colors.muted, fontSize: 13, marginTop: 6, lineHeight: 19 }}>
                    {num(narrative.actions_completed, lang)} {tx('টি কাজ সম্পন্ন হয়েছে', 'actions completed since then')}
                  </Text>
                ) : null}

                {narrative.improved.length ? (
                  <View style={{ marginTop: 14 }}>
                    <Text style={{ color: colors.muted, fontSize: 12.5, fontWeight: '700', letterSpacing: 0.3 }}>
                      {tx('যা উন্নত হয়েছে', 'What improved')}
                    </Text>
                    {narrative.improved.map((x, i) => (
                      <Text key={i} style={{ color: colors.ink, fontSize: 13.5, marginTop: 6, lineHeight: 20 }}>
                        ✓ {changePhrase(x, lang, tx)}
                      </Text>
                    ))}
                  </View>
                ) : null}

                {narrative.deteriorated.length ? (
                  <View style={{ marginTop: 14 }}>
                    <Text style={{ color: colors.muted, fontSize: 12.5, fontWeight: '700', letterSpacing: 0.3 }}>
                      {tx('যা দুর্বল হয়েছে', 'What weakened')}
                    </Text>
                    {narrative.deteriorated.map((x, i) => (
                      <Text key={i} style={{ color: colors.ink, fontSize: 13.5, marginTop: 6, lineHeight: 20 }}>
                        • {changePhrase(x, lang, tx)}
                      </Text>
                    ))}
                  </View>
                ) : null}
              </Card>
            ) : null}

            <SectionTitle title={tx('সব মূল্যায়ন', 'All assessments')} />
            {history.entries.map((e) => (
              <Card key={`${e.application_code}-${e.sequence_no}`} style={{ marginHorizontal: 16, marginTop: 10, padding: 14 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                  <GradeBadge grade={e.grade} size={40} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.ink, fontSize: 15, fontWeight: '700' }}>
                      {num(e.score, lang)} / {num(100, lang)} · {lang === 'bn' ? e.grade_label.bn : e.grade_label.en}
                    </Text>
                    <Text style={{ color: colors.muted, fontSize: 12.5, marginTop: 3 }}>
                      {e.application_code} · {financeLabel(e.readiness_status, lang)}
                    </Text>
                  </View>
                </View>
              </Card>
            ))}
          </>
        )}

        <OfficerHelpStrip district={user?.district} />
        <View style={{ height: 28 }} />
      </RefreshScroll>
    </>
  );
}
