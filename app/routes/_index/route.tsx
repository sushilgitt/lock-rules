import type { LoaderFunctionArgs, MetaFunction } from "react-router";
import { redirect } from "react-router";

import styles from "./styles.module.css";

export const meta: MetaFunction = () => [
  { title: "LockRules: access control for Shopify stores" },
  {
    name: "description",
    content:
      "Lock products, collections, pages or your whole store to customers with a tag, passcode, secret link, location or newsletter signup.",
  },
];

// Public landing page. Installation always starts from Shopify (App Store or
// admin), so there is deliberately no "enter your shop domain" form here.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }
  return null;
};

export default function Landing() {
  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>LockRules</h1>
        <p className={styles.text}>
          Members-only products, wholesale pricing and private pages for your Shopify store.
        </p>
        <ul className={styles.list}>
          <li>
            <strong>Lock anything</strong>. Products, collections, pages, blogs, vendors, tags or
            the whole store.
          </li>
          <li>
            <strong>Flexible keys</strong>. Customer tags, passcodes, secret links, location,
            order history, schedules and newsletter signups.
          </li>
          <li>
            <strong>Enforced at checkout</strong>. Locked products can&apos;t be bought by anyone
            without a key.
          </li>
        </ul>
        <p className={styles.text}>
          Install LockRules from the Shopify App Store. <a href="/privacy">Privacy policy</a>
        </p>
      </div>
    </div>
  );
}
