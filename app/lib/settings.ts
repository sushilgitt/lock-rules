export interface Messages {
  denied: string;
  login: string;
  loginButton: string;
  passcode: string;
  passcodeButton: string;
  passcodeError: string;
  confirm: string;
  confirmButton: string;
  checkout: string;
}

export interface ShopSettings {
  messages: Messages;
  // Per-locale overrides keyed by ISO code ("fr", "pt-BR"); missing keys fall back to messages.
  translations: Record<string, Partial<Messages>>;
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
    checkout: "{title} isn't available for your account.",
  },
  translations: {},
};

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
  return {
    messages: { ...DEFAULT_SETTINGS.messages, ...(s.messages ?? {}) },
    translations,
  };
}
