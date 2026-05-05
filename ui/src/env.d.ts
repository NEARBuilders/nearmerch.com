/// <reference types="@rsbuild/core/types" />
import type { ClientRuntimeConfig } from "everything-dev/types";

interface ImportMetaEnv {
  readonly PUBLIC_POSTHOG_KEY: string;
  readonly PUBLIC_POSTHOG_HOST: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare global {
  interface Window {
    __RUNTIME_CONFIG__?: ClientRuntimeConfig;
  }
}

export { };
