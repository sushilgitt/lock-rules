// Plan limits (client + server). Prices and trials are configured in the Partner
// Dashboard under Shopify App Pricing; the handles there must match these.
import { conditionMeta, type ConditionType } from "./locks";

export type PlanHandle = "free" | "basic" | "pro";
export type Feature = "lists" | "integrations" | "api" | "secure" | "payments" | "approval";

export interface Plan {
  handle: PlanHandle;
  name: string;
  price: string; // display only; keep in sync with the Partner Dashboard
  maxLocks: number;
  conditions: "customer" | "standard" | "all";
  features: Feature[];
  highlights: string[];
}

const CUSTOMER_CONDITIONS: ConditionType[] = ["signed_in", "tag", "email_in", "email_contains", "always"];
const PRO_CONDITIONS: ConditionType[] = ["newsletter", "klaviyo_member", "liquid"];

export const PLANS: Plan[] = [
  {
    handle: "free",
    name: "Free",
    price: "$0",
    maxLocks: 1,
    conditions: "customer",
    features: [],
    highlights: ["1 lock", "Signed-in, tag and email keys", "Checkout protection"],
  },
  {
    handle: "basic",
    name: "Basic",
    price: "$9.99/month",
    maxLocks: 10,
    conditions: "standard",
    features: ["lists", "payments", "approval"],
    highlights: [
      "10 locks",
      "Passcodes, secret links, location, cart, history and time keys",
      "Input lists, payment rules, customer approval",
    ],
  },
  {
    handle: "pro",
    name: "Pro",
    price: "$24.99/month",
    maxLocks: Infinity,
    conditions: "all",
    features: ["lists", "payments", "approval", "integrations", "api", "secure"],
    highlights: [
      "Unlimited locks",
      "Secure mode (server-side hiding)",
      "Klaviyo and Mailchimp keys, custom Liquid",
      "REST and JavaScript APIs",
    ],
  },
];

export function planFor(handle: string | null | undefined): Plan {
  return PLANS.find((p) => p.handle === handle) ?? PLANS[0];
}

export function allowsCondition(plan: Plan, type: ConditionType) {
  if (plan.conditions === "all") return true;
  if (plan.conditions === "customer") return CUSTOMER_CONDITIONS.includes(type);
  return !PRO_CONDITIONS.includes(type);
}

export function allowsFeature(plan: Plan, feature: Feature) {
  return plan.features.includes(feature);
}

/** The cheapest plan that unlocks a feature or condition, for upgrade prompts. */
export function planNeededFor(check: (plan: Plan) => boolean) {
  return PLANS.find(check) ?? PLANS[PLANS.length - 1];
}

/** Why a lock can't be saved on this plan (empty when it can). */
export function planProblems(
  plan: Plan,
  lock: { resourceType: string; keys: { conditions: { type: ConditionType }[] }[] },
  otherLockCount: number,
) {
  const problems: string[] = [];
  if (otherLockCount + 1 > plan.maxLocks) {
    problems.push(`The ${plan.name} plan includes ${plan.maxLocks} lock${plan.maxLocks === 1 ? "" : "s"}. Upgrade to add more.`);
  }
  if (lock.resourceType === "liquid" && !allowsCondition(plan, "liquid")) {
    problems.push("Liquid locks need the Pro plan.");
  }
  const blocked = new Set<ConditionType>();
  for (const key of lock.keys) for (const c of key.conditions) if (!allowsCondition(plan, c.type)) blocked.add(c.type);
  for (const type of blocked) {
    const needed = planNeededFor((p) => allowsCondition(p, type));
    problems.push(`“${conditionMeta(type)?.label ?? type}” needs the ${needed.name} plan.`);
  }
  return problems;
}
