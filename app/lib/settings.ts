export interface ShopSettings {
  messages: {
    denied: string;
    login: string;
    loginButton: string;
    checkout: string;
  };
}

export const DEFAULT_SETTINGS: ShopSettings = {
  messages: {
    denied: "Sorry, you don't have access to this page.",
    login: "Please sign in to view this page.",
    loginButton: "Sign in",
    checkout: "{title} isn't available for your account.",
  },
};

export function getSettings(raw: unknown): ShopSettings {
  const s = (raw ?? {}) as Partial<ShopSettings>;
  return {
    messages: { ...DEFAULT_SETTINGS.messages, ...(s.messages ?? {}) },
  };
}
