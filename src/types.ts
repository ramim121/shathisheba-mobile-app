// Shared domain types for the Shathi Sheba app.
//
// These were spread through App.tsx between the constants and the components
// that used them. Collecting them here means a screen can be moved into its own
// module without dragging the type declarations along with it.


export type MainTab = 'home' | 'community' | 'projects' | 'profile';

export type Lang = 'bn' | 'en';

export type Screen =
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
  | 'myListings'
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

export type PreferenceKey = 'cattle' | 'crops' | 'fishery' | 'vegetables' | 'fruits';

export type PreferenceOption = { id: string; icon: string; label: string };

export type PreferenceSection = { title: string; items: PreferenceOption[] };

export type TrainingContentKind = 'article' | 'video';

export type ChatMessage = { role: 'user' | 'model'; text: string; imageUri?: string; suggestions?: string[] };

export type CattleAiResult = {
  ageMonths?: number;
  weightKg?: number;
  animalType?: string;
  breed?: string;
  count?: number;
  healthSummary?: string;
  accuracyPercent?: number;
  isCow?: boolean;
};

export type TrainingModule = {
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

export type ApiRow = Record<string, any>;

export type ApiState<T> = { rows: T[]; loading: boolean; error: string | null; stale?: boolean };

export type ListingDraft = {
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

export type WeatherApiState = { data: ApiRow | null; loading: boolean; error: string | null; usingFallback: boolean };

export type LocationState = {
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

export type AppRole = 'field_officer' | 'shathisheba_seller' | 'shathisheba_buyer';

export type AuthUser = {
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

export type LearnCat = { id: string; name: string; emoji?: string };

export type LearnMod = { id: string; title: string; level: number };
