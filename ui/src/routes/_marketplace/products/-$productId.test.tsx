import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  search: {} as Record<string, string | undefined>,
  navigate: vi.fn(),
  addToCart: vi.fn(),
}));

const product = {
  id: "product-1",
  slug: "near-tee",
  title: "NEAR Tee",
  price: 30,
  metadata: undefined,
  collections: [],
  options: [
    { name: "Color", values: ["Black", "White"] },
    { name: "Size", values: ["S", "M", "L"] },
  ],
  variants: [
    { id: "black-s", price: 30, availableForSale: true, attributes: [{ name: "Color", value: "Black" }, { name: "Size", value: "S" }] },
    { id: "black-m", price: 30, availableForSale: true, attributes: [{ name: "Color", value: "Black" }, { name: "Size", value: "M" }] },
    { id: "white-s", price: 35, availableForSale: true, attributes: [{ name: "Color", value: "White" }, { name: "Size", value: "S" }] },
    { id: "white-m", price: 35, availableForSale: false, attributes: [{ name: "Color", value: "White" }, { name: "Size", value: "M" }] },
  ],
  images: [
    { id: "img-black", url: "https://example.com/black.png", type: "preview", variantIds: ["black-s", "black-m"] },
    { id: "img-white", url: "https://example.com/white.png", type: "preview", variantIds: ["white-s", "white-m"] },
  ],
};

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: ComponentType }) => ({
    options,
    useLoaderData: () => ({ data: { product }, siteUrl: "", assetsUrl: "" }),
    useSearch: () => mocks.search,
    useNavigate: () => mocks.navigate,
  }),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  useRouter: () => ({ history: { back: vi.fn() }, navigate: vi.fn() }),
  useCanGoBack: () => false,
}));

vi.mock("@/integrations/api", () => ({
  getReferralConfig: () => undefined,
  getPurchaseGatePluginId: () => undefined,
  useProducts: () => ({ data: { products: [] } }),
  usePurchaseGateAccess: () => ({ hasAccess: true, isLoading: false }),
}));
vi.mock("@/hooks/use-cart", () => ({ useCart: () => ({ addToCart: mocks.addToCart }) }));
vi.mock("@/hooks/use-favorites", () => ({ useFavorites: () => ({ favoriteIds: [], toggleFavorite: vi.fn() }) }));
vi.mock("@/hooks/use-near-price", () => ({ useNearPrice: () => ({ nearPrice: 1, isLoading: false }) }));
vi.mock("@/hooks/use-near-account-id", () => ({ useNearAccountId: () => null }));
vi.mock("@/stores/cart-sidebar-store", () => ({ useCartSidebarStore: () => vi.fn() }));
vi.mock("@/components/marketplace/product-details", () => ({ ProductDetails: () => null }));
vi.mock("@/components/marketplace/product-card", () => ({ ProductCard: () => null }));
vi.mock("@/lib/posthog", () => ({ captureEvent: vi.fn() }));
vi.mock("@/utils/orpc", () => ({ apiClient: {} }));

async function renderPage() {
  const { Route } = await import("./$productId");
  const Page = (Route as unknown as { options: { component: ComponentType } }).options.component;
  return render(<Page />);
}

describe("product page variant URL params", () => {
  beforeEach(() => {
    mocks.search = {};
    mocks.navigate.mockReset();
    mocks.addToCart.mockReset();
  });

  afterEach(() => cleanup());

  it("selects the default variant without URL params", async () => {
    await renderPage();

    expect(screen.getByRole("button", { name: /Add to Cart - \$30\.00/ })).toBeTruthy();
    expect(screen.getByText("1 / 2")).toBeTruthy();
  });

  it("selects the variant, price and image from the URL and adds it to the cart", async () => {
    mocks.search = { color: "White", size: "S" };
    await renderPage();

    expect(screen.getByText("2 / 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Add to Cart - \$35\.00/ }));

    expect(mocks.addToCart).toHaveBeenCalledWith(
      "near-tee",
      "white-s",
      "S",
      "White",
      "https://example.com/white.png",
      undefined,
    );
  });

  it("falls back to the default variant for invalid params", async () => {
    mocks.search = { color: "Purple", size: "XXL" };
    await renderPage();

    expect(screen.getByRole("button", { name: /Add to Cart - \$30\.00/ })).toBeTruthy();
  });

  it("writes color and size changes to the URL with replace", async () => {
    mocks.search = { ref: "alice.near" };
    await renderPage();

    fireEvent.click(screen.getByTitle("White"));
    expect(mocks.navigate).toHaveBeenLastCalledWith({
      search: { ref: "alice.near", color: "White", size: "M" },
      replace: true,
      resetScroll: false,
    });

    fireEvent.click(screen.getByRole("button", { name: "S" }));
    expect(mocks.navigate).toHaveBeenLastCalledWith({
      search: { ref: "alice.near", color: "Black", size: "S" },
      replace: true,
      resetScroll: false,
    });
  });
});
