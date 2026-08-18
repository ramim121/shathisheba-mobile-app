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
  | 'listingProgress'
  | 'myProjects'
  | 'projectProgress'
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
  | 'inactive'
  // Feature 1 — Finance Readiness
  | 'financeReadinessIntro'
  | 'financeReadinessQuiz'
  | 'financeReadinessResult'
  | 'financeGuidanceSheet'
  // Feature 2 — Loan application
  | 'financeHub'
  | 'loanApplyType'
  | 'loanApplyDetails'
  | 'loanSchedulePreview'
  | 'loanApplyProfile'
  | 'loanApplyConsent'
  | 'loanApplyDone'
  | 'loanStatus'
  // Feature 2 — assessment outcome
  | 'loanResult'
  | 'developmentPlan'
  | 'assessmentHistory'
  | 'loanAccount';

// ---------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------

export type FinanceGrade = 'A' | 'B' | 'C' | 'D';

export type ReadinessQuestion = {
  id: string;
  part: 'core' | 'deep';
  sort_order: number;
  question_bn: string;
  question_en: string;
  helper_bn?: string | null;
  helper_en?: string | null;
  /** Shown as a tag. The weight behind it is never sent (MOB-RDY-11). */
  category?: 'kyc' | 'enterprise' | 'financial' | null;
  /** `gate` suppresses the score on "No"; `risk` overrides the status. */
  flag?: 'gate' | 'risk' | null;
  /** Server-declared branching — the client evaluates only this rule. */
  branch_parent_id: string | null;
  branch_show_when: 'yes' | 'no' | null;
};

export type ReadinessResult = {
  assessment_id: string;
  /** Part-2 questions still to be asked, after branching. Seven when Q9 is No. */
  part2_pending?: number;
  score: number;
  grade: FinanceGrade;
  grade_label: { bn: string; en: string };
  readiness_status: string;
  data_confidence: 'low' | 'medium';
  depth: 'core' | 'full';
  categories: { kyc: number; enterprise: number; financial: number };
  gate_triggered: boolean;
  gate_reason: string | null;
  risk_flag: string | null;
  signal_count: number;
  signals_present: string[];
  strengths: { bn: string; en: string }[];
  gaps: { bn: string; en: string }[];
  actions: {
    title_bn: string; title_en: string;
    rationale_bn: string | null; rationale_en: string | null;
    deeplink: string | null;
  }[];
  created_at?: string;
};

// The farmer's view of a credit assessment (SRS §15.4).
//
// Deliberately narrower than what the console holds. MOB-LON-26 forbids numeric
// weights, per-criterion ratings, the scorecard formula, internal reason codes
// and raw mPowerU output from reaching the app — so none of them have a field
// here. The server does the filtering; this type is the second lock.
export type CreditAssessment = {
  application_code: string;
  sequence_no: number;
  assessed_at: string;
  score: number;
  grade: FinanceGrade;
  grade_label: { bn: string; en: string };
  readiness_status: string;
  readiness_label: { bn: string; en: string };
  data_confidence: 'low' | 'medium' | 'high';
  confidence_label: { bn: string; en: string };
  /** P7 — the borrower's own standing, before any project safeguards. */
  inherent_grade: FinanceGrade | null;
  /** P7 — what the project structure makes possible. Null when nothing changed. */
  structured_readiness: string | null;
  structured_readiness_label: { bn: string; en: string } | null;
  requested_amount: number;
  recommended_amount: number | null;
  pathway: { code: string; label_bn: string; label_en: string } | null;
  strengths: { bn: string; en: string }[];
  improvements: { bn: string; en: string }[];
  blocked: boolean;
  blocked_reasons: {
    bn: string; en: string;
    action_bn: string | null; action_en: string | null;
  }[];
};

export type AssessmentEnvelope = {
  state: 'not_assessed' | 'assessed' | 'blocked';
  assessment: CreditAssessment | null;
};

export type DevelopmentTask = {
  id: string;
  title: { bn: string; en: string };
  detail: { bn: string | null; en: string | null };
  action_link: string | null;
  due_on: string | null;
  status: 'assigned' | 'in_progress' | 'submitted' | 'verified' | 'waived';
  done: boolean;
};

export type DevelopmentPlan = {
  tasks: DevelopmentTask[];
  total: number;
  outstanding: number;
  can_request_reassessment: boolean;
};

export type AssessmentHistory = {
  entries: {
    sequence_no: number;
    application_code: string;
    score: number;
    grade: FinanceGrade;
    grade_label: { bn: string; en: string };
    readiness_status: string;
    data_confidence: string;
    assessed_at: string;
  }[];
  /** Null until there are two assessments to compare. */
  narrative: {
    previous: { score: number; grade: FinanceGrade; grade_label: { bn: string; en: string }; assessed_at: string };
    current: { score: number; grade: FinanceGrade; grade_label: { bn: string; en: string }; assessed_at: string };
    score_change: number;
    grade_changed: boolean;
    /**
     * `kind` says how the item moved, because the label alone reads wrong out of
     * context: a negative code that disappeared is good news, but its text still
     * describes the problem. The screen phrases each kind rather than printing
     * the raw label under a heading that contradicts it.
     */
    improved: NarrativeChange[];
    deteriorated: NarrativeChange[];
    actions_completed: number;
  } | null;
};

// Post-disbursement (MOB-LON-31). Read-only in v1 — there is no in-app payment.
export type LoanArrears = {
  is_overdue: boolean;
  days_past_due: number;
  /** Which arrears bucket the account has fallen into — decides who follows up. */
  bucket: 'current' | '1_30' | '31_60' | '61_90' | '90_plus';
  overdue_amount: number;
  overdue_installments: number;
  penalty_accrued: number;
  oldest_due_date: string | null;
  officer: { name: string; phone: string; area: string } | null;
};

export type LoanAccountView = {
  has_account: boolean;
  arrears?: LoanArrears;
  account: {
    application_code: string;
    principal: number;
    interest_rate_annual: number;
    repayment_mode: string;
    tenure_months: number;
    total_payable: number;
    installment_count: number;
    emi_amount: number;
    amount_paid: number;
    outstanding_total: number;
    /** Plain calendar days (YYYY-MM-DD) — never a serialised Date. */
    next_due_date: string | null;
    next_due_amount: number;
    overdue_amount: number;
    days_past_due: number;
    first_due_date: string | null;
    maturity_date: string | null;
    status: string;
    installments_paid: number;
    installments_total: number;
    progress_pct: number;
    is_overdue: boolean;
  } | null;
  schedule: {
    installment_no: number;
    due_date: string;
    amount_due: number;
    amount_paid: number;
    status: 'pending' | 'due' | 'paid' | 'partial' | 'overdue' | 'waived';
    days_overdue: number;
    penalty_accrued: number;
  }[];
  payments: { amount: number; paid_at: string; method: string | null; reference: string | null }[];
};

export type NarrativeChange = {
  bn: string;
  en: string;
  kind: 'resolved' | 'gained' | 'appeared' | 'lost';
};

export type ConfidenceSignal = {
  code: string;
  label_bn: string;
  label_en: string;
  fix_deeplink: string | null;
  present: boolean;
};

export type LoanProduct = {
  id: string;
  code: string;
  name_bn: string;
  name_en: string;
  description_bn?: string | null;
  description_en?: string | null;
  icon?: string | null;
  interest_rate_annual: string | number;
  allowed_tenures: number[];
  allowed_repayment_modes: string[];
  min_amount: string | number;
  max_amount: string | number;
  amount_step: string | number;
  is_active: boolean;
  coming_soon: boolean;
};

export type RepaymentMode = 'weekly' | 'monthly' | 'one_time';

export type LoanQuote = {
  quote_id: string | null;
  principal: number;
  tenure_months: number;
  repayment_mode: RepaymentMode;
  interest_rate_annual: number;
  total_interest: number;
  processing_fee: number;
  total_payable: number;
  installment_count: number;
  emi_amount: number;
  final_emi_amount: number;
  first_due_estimate: string;
  schedule_preview: {
    installment_no: number; due_date: string; amount_due: number;
  }[];
};

export type LoanDraft = {
  product: LoanProduct | null;
  amount: number;
  tenureMonths: number;
  repaymentMode: RepaymentMode;
  purposeCode: string;
  purposeText: string;
  quote: LoanQuote | null;
  consented: boolean;
  needsCorrection: boolean;
  /** What the farmer says is wrong, passed to the officer with the application. */
  correctionNote?: string;
};

export type FinanceSummary = {
  state: 'not_assessed' | 'readiness_partial' | 'readiness' | 'loan_in_progress' | 'loan_graded';
  grade: FinanceGrade | null;
  score: number | null;
  readiness_status: string | null;
  data_confidence: 'low' | 'medium' | null;
  depth: 'core' | 'full' | null;
  is_verified: boolean;
  application_code: string | null;
  stage_index: number | null;
  stage_total: number;
  pending_user_action: string | null;
  can_take_readiness: boolean;
  can_apply: boolean;
  next_payment: {
    amount: number; due_date: string; days_remaining: number;
    state: 'normal' | 'due_soon' | 'due_today' | 'overdue';
    installment_no: number; total_installments: number;
  } | null;
};

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
  weightKg: string;              // live weight for cattle; for inputs the quantity in `unit`
  meatWeightKg: string;          // cattle only: live weight at the dressing yield
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
