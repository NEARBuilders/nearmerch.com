import { ORPCError } from "@orpc/client";
import { isNotFound } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { isNotFoundError, rethrowAsRouteError } from "./route-errors";

function capture(fn: () => never): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected function to throw");
}

describe("isNotFoundError", () => {
  it("matches an oRPC NOT_FOUND error", () => {
    expect(isNotFoundError(new ORPCError("NOT_FOUND", { message: "Collection not found: nope" }))).toBe(true);
  });

  it("matches a NOT_FOUND error from another oRPC copy (SSR across federation)", () => {
    const foreign = Object.assign(new Error("Collection not found: nope"), {
      code: "NOT_FOUND",
      status: 404,
    });
    expect(foreign instanceof ORPCError).toBe(false);
    expect(isNotFoundError(foreign)).toBe(true);
  });

  it("ignores other oRPC codes and plain errors that mention not found", () => {
    expect(isNotFoundError(new ORPCError("INTERNAL_SERVER_ERROR"))).toBe(false);
    expect(isNotFoundError(new Error("Product not found: nope"))).toBe(false);
    expect(isNotFoundError(undefined)).toBe(false);
  });
});

describe("rethrowAsRouteError", () => {
  it("throws a router notFound() for an oRPC NOT_FOUND error", () => {
    const thrown = capture(() => rethrowAsRouteError(new ORPCError("NOT_FOUND")));
    expect(isNotFound(thrown)).toBe(true);
  });

  it("rethrows any other error unchanged", () => {
    const serverError = new ORPCError("INTERNAL_SERVER_ERROR");
    const networkError = new TypeError("Failed to fetch");

    expect(capture(() => rethrowAsRouteError(serverError))).toBe(serverError);
    expect(capture(() => rethrowAsRouteError(networkError))).toBe(networkError);
  });
});
