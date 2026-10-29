import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";

export const EMBED_HANDLE = "lock_embed";

/**
 * Whether the LockRules app embed is turned on in the published theme.
 * Returns null when it can't be determined (e.g. no published theme).
 */
export async function isEmbedEnabled(graphql: AdminApiContext["graphql"]) {
  const res = await graphql(`#graphql
    query LockRulesMainTheme {
      themes(first: 1, roles: [MAIN]) {
        nodes {
          files(filenames: ["config/settings_data.json"], first: 1) {
            nodes {
              body {
                ... on OnlineStoreThemeFileBodyText { content }
              }
            }
          }
        }
      }
    }`);
  const json = await res.json();
  const content: string | undefined =
    json.data?.themes?.nodes?.[0]?.files?.nodes?.[0]?.body?.content;
  if (!content) return null;

  try {
    // settings_data.json can start with a /* ... */ comment block.
    const data = JSON.parse(content.replace(/^\s*\/\*[\s\S]*?\*\//, ""));
    const blocks: Record<string, { type?: string; disabled?: boolean }> =
      data?.current?.blocks ?? {};
    return Object.values(blocks).some(
      (b) => b.type?.includes(`/blocks/${EMBED_HANDLE}/`) && b.disabled !== true,
    );
  } catch {
    return null;
  }
}

export function embedActivationUrl(shop: string, apiKey: string) {
  const store = shop.replace(".myshopify.com", "");
  return `https://admin.shopify.com/store/${store}/themes/current/editor?context=apps&activateAppId=${apiKey}/${EMBED_HANDLE}`;
}
