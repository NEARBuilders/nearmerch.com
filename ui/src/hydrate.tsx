import { getAssetsUrl, getRuntimeConfig } from "./remote/runtime";
import { initPostHog } from "./lib/posthog";

export async function hydrate() {
  const runtimeConfig = getRuntimeConfig();
  if (!runtimeConfig) {
    console.error("[Hydrate] No runtime config found");
    return;
  }

  const { hydrateRoot } = await import("react-dom/client");
  const { RouterClient } = await import("@tanstack/react-router/ssr/client");
  const { QueryClientProvider } = await import("@tanstack/react-query");
  const { createRouter } = await import("./router");
  const { authClient } = await import("./lib/auth-client");

  let session: unknown = null;
  try {
    const res = await authClient.getSession();
    session = res.data ?? null;
  } catch {
    session = null;
  }

  const nearAccountId = authClient.near.getAccountId() ?? null;

  initPostHog();

  const { router, queryClient } = createRouter({
    context: {
      assetsUrl: getAssetsUrl(runtimeConfig),
      runtimeConfig,
      session,
      nearAccountId,
    },
  });

  hydrateRoot(
    document,
    <QueryClientProvider client={queryClient}>
      <RouterClient router={router} />
    </QueryClientProvider>,
  );
}

export default hydrate;
