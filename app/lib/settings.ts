export interface Messages {
  denied: string;
  login: string;
  loginButton: string;
  passcode: string;
  passcodeButton: string;
  passcodeError: string;
  confirm: string;
  confirmButton: string;
  newsletter: string;
  newsletterButton: string;
  newsletterError: string;
  checkout: string;
}

// Hides payment methods whose name contains one of `methods`, when the customer
// is missing (or has) one of `tags`. Mirrors extensions/payment-rules.
export interface PaymentRule {
  methods: string[];
  when: "missing_tag" | "has_tag";
  tags: string[];
}

export interface ApprovalSettings {
  enabled: boolean;
  pendingTag: string;
  approvedTag: string;
  rejectedTag: string;
}

export interface ShopSettings {
  messages: Messages;
  // Per-locale overrides keyed by ISO code ("fr", "pt-BR"); missing keys fall back to messages.
  translations: Record<string, Partial<Messages>>;
  paymentRules: PaymentRule[];
  approval: ApprovalSettings;
}

export const MESSAGE_FIELDS: { key: keyof Messages; label: string; multiline?: boolean }[] = [
  { key: "login", label: "Sign-in prompt", multiline: true },
  { key: "loginButton", label: "Sign-in button" },
  { key: "denied", label: "Access denied message", multiline: true },
  { key: "passcode", label: "Passcode prompt", multiline: true },
  { key: "passcodeButton", label: "Passcode button" },
  { key: "passcodeError", label: "Wrong passcode message" },
  { key: "confirm", label: "Confirmation prompt (default)", multiline: true },
  { key: "confirmButton", label: "Confirmation button" },
  { key: "newsletter", label: "Newsletter prompt", multiline: true },
  { key: "newsletterButton", label: "Newsletter button" },
  { key: "newsletterError", label: "Newsletter error" },
  { key: "checkout", label: "Checkout error ({title} = product name)" },
];

export const DEFAULT_SETTINGS: ShopSettings = {
  messages: {
    denied: "Sorry, you don't have access to this page.",
    login: "Please sign in to view this page.",
    loginButton: "Sign in",
    passcode: "Enter the passcode to continue.",
    passcodeButton: "Unlock",
    passcodeError: "That passcode isn't right. Try again.",
    confirm: "Please confirm to continue.",
    confirmButton: "I confirm",
    newsletter: "Join our newsletter to get access.",
    newsletterButton: "Subscribe and unlock",
    newsletterError: "We couldn't sign you up. Check your email and try again.",
    checkout: "{title} isn't available for your account.",
  },
  translations: {},
  paymentRules: [],
  approval: {
    enabled: false,
    pendingTag: "pending-approval",
    approvedTag: "approved",
    rejectedTag: "rejected",
  },
};

const cleanList = (list: unknown) =>
  Array.isArray(list) ? [...new Set(list.map((v) => String(v).trim().toLowerCase()).filter(Boolean))] : [];

export function getSettings(raw: unknown): ShopSettings {
  const s = (raw ?? {}) as Partial<ShopSettings>;
  const translations: ShopSettings["translations"] = {};
  for (const [locale, msgs] of Object.entries(s.translations ?? {})) {
    const clean = Object.fromEntries(
      Object.entries(msgs ?? {}).filter(([k, v]) => k in DEFAULT_SETTINGS.messages && v?.trim()),
    );
    if (/^[a-z]{2}(-[a-z]{2})?$/i.test(locale) && Object.keys(clean).length) {
      translations[locale.toLowerCase()] = clean;
    }
  }
  const paymentRules = (Array.isArray(s.paymentRules) ? s.paymentRules : [])
    .map((r): PaymentRule => ({
      methods: cleanList(r?.methods),
      when: r?.when === "has_tag" ? "has_tag" : "missing_tag",
      tags: cleanList(r?.tags),
    }))
    .filter((r) => r.methods.length && r.tags.length);
  const a = { ...DEFAULT_SETTINGS.approval, ...(s.approval ?? {}) };
  const tag = (v: string, fallback: string) => v?.trim() || fallback;

  return {
    messages: { ...DEFAULT_SETTINGS.messages, ...(s.messages ?? {}) },
    translations,
    paymentRules,
    approval: {
      enabled: Boolean(a.enabled),
      pendingTag: tag(a.pendingTag, DEFAULT_SETTINGS.approval.pendingTag),
      approvedTag: tag(a.approvedTag, DEFAULT_SETTINGS.approval.approvedTag),
      rejectedTag: tag(a.rejectedTag, DEFAULT_SETTINGS.approval.rejectedTag),
    },
  };
}
