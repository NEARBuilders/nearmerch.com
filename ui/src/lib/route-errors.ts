import { ORPCError } from "@orpc/client";
import { notFound } from "@tanstack/react-router";

export function isNotFoundError(error: unknown): boolean {
  return error instanceof ORPCError && error.code === "NOT_FOUND";
}

export function rethrowAsRouteError(error: unknown): never {
  if (isNotFoundError(error)) {
    throw notFound();
  }
  throw error;
}
