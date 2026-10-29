import type { MetaFunction } from "react-router";
import { useLoaderData } from "react-router";

export const meta: MetaFunction = () => [{ title: "LockRules privacy policy" }];

const UPDATED = "October 29, 2026";

export const loader = () => ({ email: process.env.SUPPORT_EMAIL || null });

// Public privacy policy, linked from the App Store listing. Keep it in step
// with what the app actually stores (see prisma/schema.prisma).
export default function Privacy() {
  const { email } = useLoaderData<typeof loader>();
  return (
    <main style={{ maxWidth: "46rem", margin: "0 auto", padding: "2rem 1rem", lineHeight: 1.6, fontFamily: "system-ui, sans-serif" }}>
      <h1>LockRules privacy policy</h1>
      <p>Last updated {UPDATED}</p>

      <h2>What LockRules does</h2>
      <p>
        LockRules lets Shopify merchants restrict who can see or buy parts of their online store.
        This policy explains what information the app handles when a merchant installs it and
        when shoppers visit that merchant&apos;s store.
      </p>

      <h2>Information we store</h2>
      <ul>
        <li>
          <strong>Store data:</strong> the store&apos;s Shopify domain, an access token issued by
          Shopify, the locks, keys, messages and settings the merchant configures, and the
          merchant&apos;s plan.
        </li>
        <li>
          <strong>Input lists:</strong> passcodes and customer email addresses the merchant uploads
          to use as keys.
        </li>
        <li>
          <strong>Key usage:</strong> when a shopper unlocks content with a passcode, secret link,
          confirmation, IP address or newsletter signup, we record the lock, the type of key, the
          passcode entered (if any), the Shopify customer ID (if signed in) and the time. We do not
          store shoppers&apos; IP addresses or newsletter email addresses.
        </li>
        <li>
          <strong>Integration credentials:</strong> Klaviyo or Mailchimp API keys the merchant
          connects, stored encrypted.
        </li>
      </ul>

      <h2>Information we process but don&apos;t keep</h2>
      <ul>
        <li>
          Shoppers&apos; IP addresses, to check IP-based keys and limit passcode guessing. They are
          held in memory briefly and never written to storage.
        </li>
        <li>
          Email addresses shoppers enter to subscribe, which are sent directly to the
          merchant&apos;s Klaviyo or Mailchimp account.
        </li>
        <li>
          A signed-in customer&apos;s email, looked up from Shopify to check Klaviyo list
          membership.
        </li>
      </ul>
      <p>
        Customer tags, emails, order counts and carts are otherwise evaluated by Shopify itself,
        in the merchant&apos;s theme and at checkout, and are not sent to LockRules.
      </p>

      <h2>How we use it</h2>
      <p>
        Only to provide the app&apos;s features to the merchant. We don&apos;t sell data, use it for
        advertising, or share it except with the service providers that host the app and with
        the email platforms a merchant connects.
      </p>

      <h2>Retention and deletion</h2>
      <p>
        When a merchant uninstalls LockRules, Shopify removes the app&apos;s data from the store.
        We delete all of a store&apos;s data from our systems when Shopify sends the shop redaction
        request (48 hours after uninstall), and delete a customer&apos;s key usage records when
        Shopify sends a customer redaction request.
      </p>

      <h2>Security</h2>
      <p>
        Data is sent over HTTPS, integration keys are encrypted at rest, and API keys are stored
        only as hashes.
      </p>

      <h2>Contact</h2>
      <p>
        Questions or requests about your data:{" "}
        {email ? <a href={`mailto:${email}`}>{email}</a> : "use the contact details on the LockRules App Store listing"}.
      </p>
    </main>
  );
}
