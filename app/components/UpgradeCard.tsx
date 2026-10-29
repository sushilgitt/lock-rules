// Shown in place of a page's content when the merchant's plan doesn't include it.
export function UpgradeCard({ feature, plan }: { feature: string; plan: string }) {
  return (
    <s-section>
      <s-stack gap="base" alignItems="center" padding="large">
        <s-heading>{feature} is on the {plan} plan</s-heading>
        <s-paragraph>Upgrade any time; you can switch or cancel from the Plans page.</s-paragraph>
        <s-button variant="primary" href="/app/plans">
          See plans
        </s-button>
      </s-stack>
    </s-section>
  );
}
