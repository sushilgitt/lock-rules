import type {
  CartPaymentMethodsTransformRunInput,
  CartPaymentMethodsTransformRunResult,
} from "../generated/api";

// Mirrors PaymentConfig in app/lib/payments.server.ts.
// A rule hides every payment method whose name contains one of `methods`:
//   when "missing_tag": unless the customer has one of `tags` (e.g. net terms for wholesale only)
//   when "has_tag":     if the customer has one of `tags`
export type PaymentRule = { methods: string[]; when: "missing_tag" | "has_tag"; tags: string[] };
type Config = { rules: PaymentRule[] };

export function cartPaymentMethodsTransformRun(
  input: CartPaymentMethodsTransformRunInput,
): CartPaymentMethodsTransformRunResult {
  const config = input.paymentCustomization.config?.jsonValue as Config | undefined;
  if (!config?.rules?.length) return { operations: [] };

  const tags = new Set(
    (input.cart.buyerIdentity?.customer?.hasTags ?? [])
      .filter((t) => t.hasTag)
      .map((t) => t.tag.toLowerCase()),
  );
  const hasAny = (list: string[]) => list.some((t) => tags.has(t));

  const hidden = new Set<string>();
  for (const rule of config.rules) {
    const applies = rule.when === "has_tag" ? hasAny(rule.tags) : !hasAny(rule.tags);
    if (!applies) continue;
    for (const method of input.paymentMethods) {
      const name = method.name.toLowerCase();
      if (rule.methods.some((m) => m && name.includes(m))) hidden.add(method.id);
    }
  }

  return {
    operations: [...hidden].map((paymentMethodId) => ({ paymentMethodHide: { paymentMethodId } })),
  };
}
