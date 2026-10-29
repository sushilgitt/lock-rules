import type { SAppNavAttributes } from "@shopify/app-bridge-types";

declare module "*.css";

// @shopify/app-bridge-types declares its elements on the global JSX namespace,
// which React 19's react-jsx runtime no longer reads. Re-expose the one we use.
declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "s-app-nav": SAppNavAttributes & { children?: React.ReactNode };
    }
  }
}
