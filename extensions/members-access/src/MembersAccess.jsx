import '@shopify/ui-extensions/preact';
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';

// LockRules backend; keep in sync with application_url in shopify.app.toml.
const APP_URL = 'https://lockrules.173.212.233.194.sslip.io';

export default async () => {
  render(<MembersAccess />, document.body);
};

function MembersAccess() {
  const [state, setState] = useState({ status: 'loading', areas: [] });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const token = await shopify.sessionToken.get();
        const res = await fetch(`${APP_URL}/customer/access`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (!cancelled) setState({ status: 'ready', areas: data.areas ?? [] });
      } catch {
        if (!cancelled) setState({ status: 'error', areas: [] });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Nothing to show: stay out of the profile page entirely.
  if (state.status === 'ready' && state.areas.length === 0) return null;

  return (
    <s-section heading={shopify.i18n.translate('heading')}>
      {state.status === 'loading' && <s-text>{shopify.i18n.translate('loading')}</s-text>}
      {state.status === 'error' && <s-text color="subdued">{shopify.i18n.translate('error')}</s-text>}
      {state.status === 'ready' && (
        <s-stack gap="base">
          {state.areas.map((area) => (
            <s-stack key={area.name} gap="small-200">
              <s-text type="strong">{area.name}</s-text>
              {area.items.map((item) => (
                <s-link key={item.url} href={item.url}>
                  {item.title}
                </s-link>
              ))}
            </s-stack>
          ))}
        </s-stack>
      )}
    </s-section>
  );
}
