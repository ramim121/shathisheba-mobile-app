import type { FinanceGrade, Screen } from '../types';

// Shared finance vocabulary and helpers for the mobile app.
//
// Kept out of App.tsx because none of it is a component: it is the colour
// tokens, the bilingual enum labels the backend sends as raw tokens, the
// guidance-sheet content, and the resolver that turns a server-supplied action
// link into a screen. All of it is testable on its own.

// Grade colours (SRS §7.5). D is a muted brick, never alarm red — a weak result
// produces a development plan, not a rejection (P4).
export const GRADE_COLORS: Record<FinanceGrade | '?', string> = {
  A: '#1E9E5A',
  B: '#2563EB',
  C: '#D97706',
  D: '#B4443C',
  '?': '#8A7680',
};

export const GRADE_TINTS: Record<FinanceGrade | '?', string> = {
  A: '#E6F5ED',
  B: '#E7EFFE',
  C: '#FDF3E3',
  D: '#F8EAE9',
  '?': '#F0EBED',
};

// Every backend enum token the finance screens can receive, in both languages.
// The app renders tokens through this map so a new server state never leaks a
// raw snake_case string into the UI.
export const FINANCE_ENUM: Record<string, [string, string]> = {
  // Readiness / assessment status
  bank_ready: ['ব্যাংকের জন্য প্রস্তুত', 'Bank ready'],
  bank_ready_indicative: ['ব্যাংকের জন্য প্রস্তুত (সম্ভাব্য)', 'Bank ready (indicative)'],
  conditionally_ready: ['শর্তসাপেক্ষে প্রস্তুত', 'Conditionally ready'],
  project_ready: ['প্রকল্পের জন্য প্রস্তুত', 'Project ready'],
  development_required: ['উন্নয়ন প্রয়োজন', 'Development needed'],
  currently_ineligible: ['এখনই সম্ভব নয়', 'Not possible yet'],
  // Confidence
  low: ['নিম্ন', 'Low'],
  medium: ['মাঝারি', 'Medium'],
  high: ['উচ্চ', 'High'],
  // Application states
  draft: ['খসড়া', 'Draft'],
  submitted: ['জমা হয়েছে', 'Submitted'],
  kyc_in_progress: ['কাগজপত্র সংগ্রহ চলছে', 'Collecting documents'],
  field_verification: ['মাঠ যাচাই চলছে', 'Field verification'],
  behavioral_pending: ['আচরণগত মূল্যায়ন বাকি', 'Behavioural assessment pending'],
  under_assessment: ['মূল্যায়ন চলছে', 'Under assessment'],
  assessed: ['মূল্যায়ন সম্পন্ন', 'Assessed'],
  pending_submission: ['ব্যাংকে পাঠানোর অপেক্ষায়', 'Ready for lender'],
  submitted_to_lender: ['ব্যাংকে পাঠানো হয়েছে', 'Sent to lender'],
  lender_review: ['ব্যাংক পর্যালোচনা করছে', 'Lender reviewing'],
  info_requested: ['তথ্য চাওয়া হয়েছে', 'Information requested'],
  approved: ['অনুমোদিত', 'Approved'],
  disbursed: ['অর্থ বিতরণ হয়েছে', 'Disbursed'],
  repaying: ['পরিশোধ চলছে', 'Repaying'],
  overdue: ['বকেয়া', 'Overdue'],
  closed: ['সম্পন্ন', 'Closed'],
  withdrawn: ['প্রত্যাহার করা হয়েছে', 'Withdrawn'],
  lender_declined: ['এই মুহূর্তে এগোনো যায়নি', 'Could not proceed'],
  hard_stopped: ['এখনই সম্ভব নয়', 'Not possible yet'],
  ineligible: ['এখনই সম্ভব নয়', 'Not possible yet'],
  // Repayment
  weekly: ['সাপ্তাহিক কিস্তি', 'Weekly installment'],
  monthly: ['মাসিক কিস্তি', 'Monthly installment'],
  one_time: ['এককালীন পরিশোধ', 'One-time settlement'],
  coming_soon: ['শীঘ্রই আসছে', 'Coming soon'],
  pending: ['অপেক্ষমাণ', 'Pending'],
  due: ['পরিশোধযোগ্য', 'Due'],
  paid: ['পরিশোধিত', 'Paid'],
  partial: ['আংশিক পরিশোধিত', 'Partially paid'],
  waived: ['মওকুফ', 'Waived'],
};

export function financeLabel(token: string | null | undefined, lang: 'bn' | 'en'): string {
  if (!token) return '';
  const hit = FINANCE_ENUM[token];
  if (!hit) return token.replace(/_/g, ' ');
  return lang === 'bn' ? hit[0] : hit[1];
}

// Pending user actions (MOB-LON-19).
export const PENDING_ACTION_LABEL: Record<string, [string, string]> = {
  take_mpoweru: ['মূল্যায়ন শুরু করুন', 'Start assessment'],
  resume_mpoweru: ['মূল্যায়ন চালিয়ে যান', 'Continue assessment'],
  confirm_visit: ['সময় নিশ্চিত করুন', 'Confirm the time'],
  answer_query: ['উত্তর দিন', 'Respond'],
  grant_consent: ['সম্মতি দিন', 'Give consent'],
  development_task: ['কাজ দেখুন', 'View tasks'],
  confirm_offer: ['শর্ত দেখুন', 'Review terms'],
};

/**
 * Resolves a server-supplied action link.
 *
 * Links are app-internal route tokens (`screen:menuBanking`), not URLs — the app
 * has no deep-linking infrastructure and introducing one is out of scope
 * (MOB-RDY-23). `sheet:` topics all open the single reusable guidance screen
 * rather than five near-identical ones.
 */
export function resolveActionLink(
  link: string | null | undefined
): { kind: 'screen'; screen: Screen; params: Record<string, string> } | { kind: 'sheet'; topic: string } | null {
  if (!link) return null;
  if (link.startsWith('sheet:')) return { kind: 'sheet', topic: link.slice(6) };
  if (!link.startsWith('screen:')) return null;

  const body = link.slice(7);
  const [name, query] = body.split('?');
  const params: Record<string, string> = {};
  if (query) {
    query.split('&').forEach((pair) => {
      const [k, v] = pair.split('=');
      if (k) params[k] = decodeURIComponent(v ?? '');
    });
  }
  return { kind: 'screen', screen: name as Screen, params };
}

// Guidance sheets — the gaps with no in-app destination (MOB-RDY-23A).
// Content lives here rather than in five screens; the sheet is parameterised.
export type GuidanceTopic = {
  title_bn: string; title_en: string;
  intro_bn: string; intro_en: string;
  steps_bn: string[]; steps_en: string[];
};

export const GUIDANCE_TOPICS: Record<string, GuidanceTopic> = {
  clear_arrears: {
    title_bn: 'বকেয়া কিস্তি পরিশোধ',
    title_en: 'Clearing overdue instalments',
    intro_bn: 'বকেয়া কিস্তি থাকলে নতুন ঋণ পাওয়া কঠিন। এটি সবচেয়ে জরুরি কাজ, এবং এটি ঠিক করা সম্ভব।',
    intro_en: 'Overdue instalments make new finance very hard to obtain. This is the most urgent thing to fix — and it is fixable.',
    steps_bn: [
      'আপনার ঋণদাতার সাথে আজই কথা বলুন — এড়িয়ে গেলে সমস্যা বাড়ে।',
      'কত টাকা বকেয়া তা লিখে রাখুন।',
      'ছোট কিস্তিতে পরিশোধের অনুরোধ করুন — বেশিরভাগ প্রতিষ্ঠান রাজি হয়।',
      'পরিশোধের রসিদ সংগ্রহ করে রাখুন।',
      'আপনার মাঠ কর্মকর্তাকে জানান — তিনি সাহায্য করতে পারেন।',
    ],
    steps_en: [
      'Talk to your lender today — avoiding it makes it worse.',
      'Write down exactly how much is outstanding.',
      'Ask to repay in smaller instalments — most institutions will agree.',
      'Keep every payment receipt.',
      'Tell your field officer — they can help you arrange this.',
    ],
  },
  reduce_debt: {
    title_bn: 'বিদ্যমান ঋণ কমানো',
    title_en: 'Reducing your existing debt',
    intro_bn: 'আপনার সব কিস্তি মিলিয়ে মাসিক আয়ের অর্ধেকের কম হলে নতুন ঋণ পাওয়া সহজ হয়।',
    intro_en: 'When all your instalments together stay under half your monthly income, new finance becomes much easier to obtain.',
    steps_bn: [
      'সব ঋণের তালিকা করুন — কার কাছে কত।',
      'সবচেয়ে বেশি সুদের ঋণ আগে শেষ করুন।',
      'নতুন ঋণ নেওয়ার আগে পুরনোটা কমান।',
      'একাধিক ছোট ঋণ একত্র করা যায় কিনা কর্মকর্তার সাথে আলোচনা করুন।',
    ],
    steps_en: [
      'List every loan — who, and how much.',
      'Clear the highest-interest debt first.',
      'Reduce what you owe before taking on anything new.',
      'Ask your officer whether several small loans can be consolidated.',
    ],
  },
  tenancy_agreement: {
    title_bn: 'ভাড়ার চুক্তিপত্র',
    title_en: 'A written tenancy agreement',
    intro_bn: 'জমি বা দোকান ভাড়া নেওয়া হলে লিখিত চুক্তি আপনার ব্যবসার স্থিতিশীলতা প্রমাণ করে।',
    intro_en: 'If you rent your land or premises, a written agreement proves your business is stable.',
    steps_bn: [
      'মালিকের সাথে লিখিত চুক্তি করুন — সময়কাল ও ভাড়া স্পষ্ট লিখুন।',
      'দুজনের স্বাক্ষর ও তারিখ রাখুন।',
      'সম্ভব হলে স্থানীয় সাক্ষী রাখুন।',
      'চুক্তির একটি কপি নিজের কাছে রাখুন।',
    ],
    steps_en: [
      'Put the agreement in writing — state the term and the rent clearly.',
      'Both parties sign and date it.',
      'Have a local witness if you can.',
      'Keep your own copy safe.',
    ],
  },
  tin_registration: {
    title_bn: 'টিআইএন নিবন্ধন',
    title_en: 'TIN registration',
    intro_bn: 'টিআইএন (কর সনাক্তকরণ নম্বর) বড় অঙ্কের ঋণের জন্য প্রয়োজন হয়। এটি অনলাইনে বিনামূল্যে করা যায়।',
    intro_en: 'A TIN (Tax Identification Number) is required for larger loans. Registration is free and can be done online.',
    steps_bn: [
      'etaxnbr.gov.bd ওয়েবসাইটে যান।',
      'আপনার এনআইডি ও মোবাইল নম্বর দিয়ে নিবন্ধন করুন।',
      'ই-টিআইএন সার্টিফিকেট ডাউনলোড করে রাখুন।',
      'সাহায্য লাগলে মাঠ কর্মকর্তাকে বলুন।',
    ],
    steps_en: [
      'Go to etaxnbr.gov.bd.',
      'Register using your NID and mobile number.',
      'Download and keep the e-TIN certificate.',
      'Ask your field officer if you need help with the form.',
    ],
  },
  address_proof: {
    title_bn: 'ঠিকানার প্রমাণপত্র',
    title_en: 'Address proof document',
    intro_bn: 'আপনার নামে ঠিকানার প্রমাণ ঋণদাতার একটি বাধ্যতামূলক কাগজ।',
    intro_en: 'Proof of address in your own name is a document every lender asks for.',
    steps_bn: [
      'বিদ্যুৎ, গ্যাস বা পানির বিল আপনার নামে করুন।',
      'জমির দলিল বা খতিয়ানও গ্রহণযোগ্য।',
      'ইউনিয়ন পরিষদ থেকে নাগরিক সনদ নেওয়া যায়।',
      'কাগজটি ছয় মাসের মধ্যে হলে ভালো।',
    ],
    steps_en: [
      'Get an electricity, gas or water bill issued in your name.',
      'A land deed or khatian is also accepted.',
      'A citizenship certificate from the union parishad works too.',
      'A document less than six months old is best.',
    ],
  },
};

/** Repayment modes offered in the apply flow (MOB-LON-08A). */
export const REPAYMENT_MODES: { key: 'weekly' | 'monthly' | 'one_time'; bn: string; en: string; hint_bn: string; hint_en: string }[] = [
  { key: 'weekly', bn: 'সাপ্তাহিক কিস্তি', en: 'Weekly installment', hint_bn: 'প্রতি সপ্তাহে অল্প অল্প', hint_en: 'A small amount each week' },
  { key: 'monthly', bn: 'মাসিক কিস্তি', en: 'Monthly installment', hint_bn: 'প্রতি মাসে একবার', hint_en: 'Once a month' },
  { key: 'one_time', bn: 'এককালীন পরিশোধ', en: 'One-time settlement', hint_bn: 'মেয়াদ শেষে একবারে', hint_en: 'All at once, at the end' },
];

/** Parses Bangla or ASCII digits from a typed amount (MOB-LON-08B). */
export function parseDigits(text: string): number {
  const bnDigits = '০১২৩৪৫৬৭৮৯';
  const normalised = String(text)
    .split('')
    .map((ch) => {
      const i = bnDigits.indexOf(ch);
      return i >= 0 ? String(i) : ch;
    })
    .join('')
    .replace(/[^0-9]/g, '');
  return normalised ? Number(normalised) : 0;
}
