import { ProductCard } from "@/components/marketplace/product-card";
import { useCart } from "@/hooks/use-cart";
import { useNearAccountId } from "@/hooks/use-near-account-id";
import { useNearPrice } from "@/hooks/use-near-price";
import {
  COLOR_MAP,
  getAttributeHex
} from "@/lib/product-utils";
import {
  getPurchaseGatePluginId,
  usePurchaseGateAccessMap,
  type ProductMetadata,
  type PurchaseGatePluginId,
} from "@/integrations/api";
import { getCartItemReactKey } from "@/stores/cart-store";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Lock, Minus, Plus, X } from "lucide-react";

export const Route = createFileRoute("/_marketplace/cart")({
  component: CartPage,
});

function CartPage() {
  const { cartItems, subtotal, updateQuantity, removeItem } = useCart();
  const { nearPrice, isLoading: isLoadingNearPrice } = useNearPrice();
  const nearAmount = (subtotal / nearPrice).toFixed(2);
  const nearAccountId = useNearAccountId();
  const gatedPluginIds = Array.from(
    new Set(
      cartItems
        .map((item) =>
          getPurchaseGatePluginId(item.product.metadata as ProductMetadata | undefined),
        )
        .filter((pluginId): pluginId is PurchaseGatePluginId => Boolean(pluginId)),
    ),
  );
  const { accessByPlugin, isLoading: isPurchaseGateLoading } =
    usePurchaseGateAccessMap(gatedPluginIds, nearAccountId);
  const blockedItems = cartItems.filter((item) => {
    const pluginId = getPurchaseGatePluginId(
      item.product.metadata as ProductMetadata | undefined,
    );

    return pluginId ? !accessByPlugin.get(pluginId) : false;
  });
  const hasBlockedItems = blockedItems.length > 0;

  return (
    <div className="bg-background min-h-screen pt-32">
      <div className="container-app mx-auto px-4 md:px-8 lg:px-16">
        {/* Back and Title Blocks */}
        <div className="flex flex-row gap-4 mb-8">
          {/* Back Block */}
          <Link
            to="/"
            className="rounded-2xl border border-border/60 px-4 md:px-8 lg:px-10 py-4 md:py-8 flex items-center justify-center hover:border-[#00EC97] hover:text-[#00EC97] transition-colors shrink-0"
          >
            <ArrowLeft className="size-5" />
          </Link>

          {/* Title Block */}
          <div className="flex-1 rounded-2xl bg-background border border-border/60 px-6 md:px-8 lg:px-10 py-6 md:py-8">
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
              Shopping Cart
            </h1>
          </div>
        </div>

        {cartItems.length === 0 ? (
          <div className="rounded-2xl bg-background border border-border/60 px-6 md:px-8 lg:px-10 py-12 md:py-16 text-center">
            <p className="text-foreground/90 dark:text-muted-foreground text-lg mb-6 font-medium">
              Your cart is empty
            </p>
            <Link to="/">
              <button className="px-8 py-3 rounded-lg bg-[#00EC97] text-black font-semibold text-sm hover:bg-[#00d97f] transition-colors">
                Continue Shopping
              </button>
            </Link>
          </div>
        ) : (
          <div className="grid lg:grid-cols-3 gap-8 lg:gap-12">
            {/* Cart Items Block */}
            <div className="lg:col-span-2">
              <div className="rounded-2xl bg-background border border-border/60 px-6 md:px-8 lg:px-10 py-6 md:py-8 space-y-4">
                {cartItems.map((item) => {
                  const availableVariants = item.product.variants || [];
                  const selectedVariant = availableVariants.find(
                    (v) => v.id === item.variantId
                  );

                  const apiHex = getAttributeHex(
                    selectedVariant?.attributes,
                    "Color"
                  );
                  const colorHex =
                    apiHex ||
                    (item.color && item.color !== "N/A"
                      ? COLOR_MAP[item.color]
                      : null) ||
                    null;

                  return (
                    <div key={getCartItemReactKey(item)}>
                    <ProductCard
                      product={item.product}
                      variant="horizontal"
                      hideFavorite
                      hidePrice
                      priceOverride={item.unitPrice}
                      imageOverride={item.imageUrl}
                        className="hover:shadow-none !bg-transparent !p-0"
                      actionSlot={
                        <button
                           onClick={() => removeItem(item.id)}
                            className="size-8 flex items-center justify-center shrink-0 rounded-lg hover:bg-background/60 hover:text-[#00EC97] transition-colors"
                          aria-label={`Remove ${item.product.title}`}
                        >
                          <X className="size-4" aria-hidden="true" />
                        </button>
                      }
                    >
                      <div className="w-full flex flex-col gap-3 mt-2">
                        <div className="flex items-center gap-4">
                          {item.color && item.color !== "N/A" && (
                            <div className="flex items-center gap-2">
                              {colorHex && (
                                <div
                                  className="size-5 rounded-full border border-border/60"
                                  style={{ backgroundColor: colorHex }}
                                />
                              )}
                              <span className="text-sm text-foreground/90 dark:text-muted-foreground">
                                {item.color}
                              </span>
                            </div>
                          )}

                          {item.size !== "N/A" && item.size !== "One size" && (
                            <div className="text-sm text-foreground/90 dark:text-muted-foreground">
                              Size: {item.size}
                            </div>
                          )}
                        </div>

                        <div className="flex items-center justify-between gap-3 w-full">
                          <div className="flex items-center border border-border/60 rounded-lg h-[38px]">
                            <button
                              onClick={() => updateQuantity(item.id, -1)}
                              disabled={item.quantity <= 1}
                              className="size-9 flex items-center justify-center disabled:opacity-50 hover:text-[#00EC97] transition-colors rounded-l-lg"
                              aria-label="Decrease quantity"
                            >
                              <Minus className="size-4" aria-hidden="true" />
                            </button>
                            <span className="w-10 text-center text-sm font-medium">
                              {item.quantity}
                            </span>
                            <button
                              onClick={() => updateQuantity(item.id, 1)}
                              className="size-9 flex items-center justify-center hover:text-[#00EC97] transition-colors rounded-r-lg"
                              aria-label="Increase quantity"
                            >
                              <Plus className="size-4" aria-hidden="true" />
                            </button>
                          </div>

                        <div className="text-base font-semibold whitespace-nowrap h-[38px] flex items-center">
                          ${(item.unitPrice * item.quantity).toFixed(2)}
                        </div>
                      </div>
                      </div>
                    </ProductCard>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Order Summary Block */}
            <div className="lg:col-span-1">
              <div className="rounded-2xl bg-background border border-border/60 p-6 md:p-8 lg:sticky lg:top-24">
                <h2 className="text-xl font-bold tracking-tight mb-6">
                  Order Summary
                </h2>

                <div className="space-y-3 mb-6">
                  {hasBlockedItems && (
                    <div className="rounded-xl border border-border/60 bg-background/40 p-4 text-sm text-foreground/80">
                      <div className="flex items-start gap-2 font-medium">
                        <Lock className="size-4 mt-0.5 shrink-0" />
                        <span>
                          {!nearAccountId
                            ? "Connect your NEAR account to buy Legion-gated items in your cart."
                            : "Your connected account cannot purchase one or more Legion-gated items in your cart."}
                        </span>
                      </div>
                    </div>
                  )}
                  <div className="flex justify-between text-sm">
                    <span className="text-foreground/90 dark:text-muted-foreground">Subtotal</span>
                    <span className="text-foreground font-medium">${subtotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-foreground/90 dark:text-muted-foreground">Shipping</span>
                    <span className="text-foreground/90 dark:text-muted-foreground">Calculated at checkout</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-foreground/90 dark:text-muted-foreground">Tax</span>
                    <span className="text-foreground/90 dark:text-muted-foreground">Calculated at checkout</span>
                  </div>
                </div>

                <div className="flex justify-between items-center mb-2">
                  <span className="text-base font-semibold">Estimated Total</span>
                  <span className="text-base font-semibold">
                    ${subtotal.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between items-center mb-6 text-sm text-foreground/90 dark:text-muted-foreground">
                  <span>NEAR Equivalent</span>
                  <span>{isLoadingNearPrice ? '...' : `${nearAmount} NEAR`}</span>
                </div>

                <div className="flex flex-col gap-3">
                  <Link to="/" className="w-full">
                    <button 
                      className="w-full px-8 py-3 rounded-lg bg-background/60 backdrop-blur-sm border border-border/60 text-foreground flex items-center justify-center font-semibold text-base hover:bg-[#00EC97] hover:border-[#00EC97] hover:text-black transition-colors"
                    >
                      <ArrowLeft className="size-4 mr-2" />
                      Continue Shopping
                    </button>
                  </Link>
                  {hasBlockedItems ? (
                    <button
                      className="w-full px-8 py-3 rounded-lg bg-muted text-muted-foreground font-semibold text-base cursor-not-allowed"
                      disabled
                      data-testid="checkout-button"
                    >
                      {isPurchaseGateLoading ? "Checking Access..." : "Checkout Locked"}
                    </button>
                  ) : (
                    <Link to="/checkout" data-testid="checkout-link" className="w-full">
                      <button className="w-full px-8 py-3 rounded-lg bg-[#00EC97] text-black font-semibold text-base hover:bg-[#00d97f] transition-colors" data-testid="checkout-button">
                        Checkout
                      </button>
                    </Link>
                  )}
                </div>

                <p className="text-foreground/90 dark:text-muted-foreground text-xs text-center mt-4">
                  Shipping and taxes calculated at checkout
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
