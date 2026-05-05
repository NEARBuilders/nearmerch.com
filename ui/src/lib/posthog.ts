import posthog from "posthog-js";

const POSTHOG_KEY = import.meta.env.PUBLIC_POSTHOG_KEY as string | undefined;
const POSTHOG_HOST = import.meta.env.PUBLIC_POSTHOG_HOST as string | undefined;

let initialized = false;

export function initPostHog() {
  if (typeof window === "undefined" || initialized) return;
  if (!POSTHOG_KEY) return;

  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST || "https://us.i.posthog.com",
    capture_pageview: false,
    capture_pageleave: false,
    autocapture: false,
  });

  initialized = true;
}

export function captureEvent(
  event: string,
  properties?: Record<string, unknown>,
) {
  if (!initialized) return;
  posthog.capture(event, properties);
}
