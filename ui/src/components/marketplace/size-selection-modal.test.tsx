import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { SizeSelectionModal } from "./size-selection-modal";
import type { Product } from "@/integrations/api";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/components/marketplace/product-card", () => ({
  ProductCard: ({ product }: { product: Product }) => (
    <div data-testid="product-card">{product.title}</div>
  ),
}));

const product: Product = {
  id: "near-n-rings",
  slug: "near-n-rings",
  title: "NEAR N & Rings",
  createdAt: "2026-01-01T00:00:00.000Z",
  price: 25,
  currency: "USD",
  tags: [],
  featured: false,
  collections: [{ slug: "men", name: "Men", showInCarousel: true, carouselOrder: 0 }],
  options: [
    {
      id: "color",
      name: "Color",
      values: ["Black", "Blue Jean"],
      position: 1,
    },
    {
      id: "size",
      name: "Size",
      values: ["S", "M"],
      position: 2,
    },
  ],
  images: [
    {
      id: "blue-jean-image",
      url: "https://example.com/blue-jean.png",
      type: "primary",
      variantIds: ["blue-jean-s"],
      order: 0,
    },
  ],
  variants: [
    {
      id: "black-m",
      title: "Black / M",
      price: 25,
      currency: "USD",
      attributes: [
        { name: "Color", value: "Black" },
        { name: "Size", value: "M" },
      ],
      availableForSale: true,
    },
    {
      id: "blue-jean-s",
      title: "Blue Jean / S",
      price: 25,
      currency: "USD",
      attributes: [
        { name: "Color", value: "Blue Jean" },
        { name: "Size", value: "S" },
      ],
      availableForSale: true,
    },
  ],
  designFiles: [],
  fulfillmentProvider: "manual",
  listed: true,
  priceLocked: false,
};

describe("SizeSelectionModal", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("does not add a fallback size after changing to a color without the selected size", () => {
    const onAddToCart = vi.fn();

    render(
      <SizeSelectionModal
        product={product}
        isOpen
        onClose={vi.fn()}
        onAddToCart={onAddToCart}
      />
    );

    fireEvent.click(screen.getByTitle("Blue Jean"));
    fireEvent.click(screen.getByRole("button", { name: "M" }));
    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));

    expect(onAddToCart).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "M isn’t available in Blue Jean. Please pick another size.",
    );
  });

  it("adds the size the shopper selected for that color", () => {
    const onAddToCart = vi.fn();

    render(
      <SizeSelectionModal
        product={product}
        isOpen
        onClose={vi.fn()}
        onAddToCart={onAddToCart}
      />
    );

    fireEvent.click(screen.getByTitle("Blue Jean"));
    fireEvent.click(screen.getByRole("button", { name: "S" }));
    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));

    expect(onAddToCart).toHaveBeenCalledWith(
      "near-n-rings",
      "blue-jean-s",
      "S",
      "Blue Jean",
      "https://example.com/blue-jean.png"
    );
  });
});
