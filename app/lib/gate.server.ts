import type { GraphQL } from "./compile.server";
import { currentPlan } from "./billing.server";
import { allowsFeature, planNeededFor, type Feature } from "./plans";

/** Null when the shop's plan includes `feature`, otherwise the name of the plan that does. */
export async function requireFeature(graphql: GraphQL, domain: string, feature: Feature) {
  const plan = await currentPlan(graphql, domain);
  if (allowsFeature(plan, feature)) return null;
  return planNeededFor((p) => allowsFeature(p, feature)).name;
}
