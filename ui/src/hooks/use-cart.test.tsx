import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "@/integrations/api";
import { useCartStore } from "@/stores/cart-store";
import { useCart } from "./use-cart";

const mockUseProductsByIds = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/api", () => ({
  requiresSize: vi.fn(() => false),
  useProductsByIds: mockUseProductsByIds,
}));

const itemId = "variant-1::direct";
const cartItem = {
  id: itemId,
  productId: "test-product",
  variantId: "variant-1",
  quantity: 1,
  size: "M",
  color: "Black",
};

const product = {
  id: "product-1",
  slug: "test-product",
  title: "Test Product",
  price: 25,
  variants: [
    {
      id: "variant-1",
      title: "M / Black",
      price: 25,
      currency: "USD",
      attributes: [],
      availableForSale: true,
    },
  ],
} as Product;

function seedCart() {
  act(() => {
    useCartStore.setState({ items: { [itemId]: cartItem } });
  });
}

function getPersistedItems() {
  const stored = JSON.parse(
    localStorage.getItem("marketplace-cart") ?? "{}",
  ) as { state?: { items?: Record<string, unknown> } };

  return stored.state?.items ?? {};
}

describe("useCart product cleanup", () => {
  beforeEach(() => {
    localStorage.clear();
    act(() => {
      useCartStore.setState({ items: {} });
    });
    mockUseProductsByIds.mockReset();
  });

  it("preserves persisted cart items during a transient product request failure", async () => {
    mockUseProductsByIds.mockReturnValue({
      data: [],
      isLoading: false,
      isError: true,
      missingProductIds: [],
    });
    seedCart();

    renderHook(() => useCart());

    await waitFor(() => {
      expect(useCartStore.getState().items).toHaveProperty(itemId);
    });
    expect(getPersistedItems()).toHaveProperty(itemId);
  });

  it("removes an item only when its product is confirmed missing", async () => {
    mockUseProductsByIds.mockReturnValue({
      data: [],
      isLoading: false,
      isError: true,
      missingProductIds: ["test-product"],
    });
    seedCart();

    renderHook(() => useCart());

    await waitFor(() => {
      expect(useCartStore.getState().items).not.toHaveProperty(itemId);
    });
    expect(getPersistedItems()).not.toHaveProperty(itemId);
  });

  it("keeps the item and restores its cart details after a successful retry", async () => {
    mockUseProductsByIds.mockReturnValue({
      data: [],
      isLoading: false,
      isError: true,
      missingProductIds: [],
    });
    seedCart();

    const { result, rerender } = renderHook(() => useCart());

    expect(useCartStore.getState().items).toHaveProperty(itemId);

    mockUseProductsByIds.mockReturnValue({
      data: [product],
      isLoading: false,
      isError: false,
      missingProductIds: [],
    });
    rerender();

    await waitFor(() => expect(result.current.cartItems).toHaveLength(1));
    expect(result.current.cartItems[0]?.product.slug).toBe("test-product");
    expect(getPersistedItems()).toHaveProperty(itemId);
  });
});
