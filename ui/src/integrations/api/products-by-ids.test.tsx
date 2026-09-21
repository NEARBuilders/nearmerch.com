import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "@/utils/orpc";
import { useProductsByIds } from "./products";

vi.mock("@/utils/orpc", () => ({
  apiClient: {
    getProduct: vi.fn(),
  },
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    );
  };
}

describe("useProductsByIds", () => {
  beforeEach(() => {
    vi.mocked(apiClient.getProduct).mockReset();
  });

  it("does not classify a transient request failure as a missing product", async () => {
    vi.mocked(apiClient.getProduct).mockRejectedValue(
      Object.assign(new Error("Service temporarily unavailable"), {
        code: "INTERNAL_SERVER_ERROR",
      }),
    );

    const { result } = renderHook(
      () => useProductsByIds(["temporary-failure"]),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.data).toEqual([]);
    expect(result.current.missingProductIds).toEqual([]);
  });

  it("reports the exact product ID returned as not found", async () => {
    vi.mocked(apiClient.getProduct).mockRejectedValue(
      Object.assign(new Error("This product is no longer available"), {
        code: "NOT_FOUND",
        status: 404,
      }),
    );

    const { result } = renderHook(
      () => useProductsByIds(["deleted-product"]),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.missingProductIds).toEqual(["deleted-product"]);
  });

  it("separates confirmed missing products from transient failures", async () => {
    vi.mocked(apiClient.getProduct).mockImplementation(({ id }) => {
      if (id === "deleted-product") {
        return Promise.reject(
          Object.assign(new Error("This product is no longer available"), {
            code: "NOT_FOUND",
          }),
        );
      }

      return Promise.reject(
        Object.assign(new Error("Network request failed"), {
          code: "INTERNAL_SERVER_ERROR",
        }),
      );
    });

    const { result } = renderHook(
      () => useProductsByIds(["deleted-product", "temporary-failure"]),
      { wrapper: createWrapper() },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.missingProductIds).toEqual(["deleted-product"]);
  });
});
