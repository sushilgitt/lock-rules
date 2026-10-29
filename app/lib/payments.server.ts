import prisma from "../db.server";
import { gql, setMetafields, userErrors, type GraphQL } from "./compile.server";
import type { PaymentRule } from "./settings";

export const PAYMENT_FUNCTION_HANDLE = "payment-rules";

// Mirrors Config in extensions/payment-rules/src.
export interface PaymentConfig {
  rules: PaymentRule[];
}

/** Pushes payment rules to the payment customization, creating it on first use. */
export async function syncPaymentRules(
  graphql: GraphQL,
  shop: { id: string; paymentCustomizationId: string | null },
  rules: PaymentRule[],
) {
  if (!rules.length && !shop.paymentCustomizationId) return;

  const config: PaymentConfig = { rules };
  const vars = { tags: [...new Set(rules.flatMap((r) => r.tags))].slice(0, 100) };
  const metafields = (ownerId?: string) => [
    { ...(ownerId ? { ownerId } : {}), namespace: "$app", key: "config", value: JSON.stringify(config) },
    { ...(ownerId ? { ownerId } : {}), namespace: "$app", key: "vars", value: JSON.stringify(vars) },
  ];

  if (shop.paymentCustomizationId) {
    const errors = await setMetafields(graphql, metafields(shop.paymentCustomizationId));
    if (!errors.length) return;
    // Deleted in Settings > Payments; recreate below.
  }

  const data = await gql(
    graphql,
    `#graphql
    mutation LockRulesCreatePaymentCustomization($paymentCustomization: PaymentCustomizationInput!) {
      paymentCustomizationCreate(paymentCustomization: $paymentCustomization) {
        paymentCustomization { id }
        userErrors { field message }
      }
    }`,
    {
      paymentCustomization: {
        functionHandle: PAYMENT_FUNCTION_HANDLE,
        title: "LockRules payment rules",
        enabled: true,
        metafields: metafields().map((m) => ({ type: "json", ...m })),
      },
    },
  );
  userErrors(data.paymentCustomizationCreate.userErrors, "Payment rules");
  await prisma.shop.update({
    where: { id: shop.id },
    data: { paymentCustomizationId: data.paymentCustomizationCreate.paymentCustomization.id },
  });
}
