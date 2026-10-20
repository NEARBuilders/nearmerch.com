import { notFound } from "@tanstack/react-router";

// Checked by shape, not instanceof: during SSR the error comes from the host's
// own @orpc/client copy across the federation boundary.
export function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "NOT_FOUND"
  );
}

export function rethrowAsRouteError(error: unknown): never {
  if (isNotFoundError(error)) {
    throw notFound();
  }
  throw error;
}
