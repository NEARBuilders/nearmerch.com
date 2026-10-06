import { ProductCard } from "@/components/marketplace/product-card";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useCart } from "@/hooks/use-cart";
import {
  COLOR_MAP,
  getAttributeHex
} from "@/lib/product-utils";
import { getCartItemReactKey } from "@/stores/cart-store";
import { Link, useRouter, useCanGoBack } from "@tanstack/react-router";
import { Minus, Plus, X } from "lucide-react";

interface CartSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

export function CartSidebar({ isOpen, onClose }: CartSidebarProps) {
  const { cartItems, subtotal, updateQuantity, removeItem } = useCart();
  const router = useRouter();
  const canGoBack = useCanGoBack();

  const handleContinueShopping = () => {
    onClose();
    if (canGoBack) {
      router.history.back();
    } else {
      router.navigate({ to: "/" });
    }
  };

  return (
    <Sheet open={isOpen} onOpenChange={onClose}>
      <SheetContent
        side="right"
        hideCloseButton={true}
        className="w-full max-w-[512px] sm:max-w-[512px] flex flex-col p-0 bg-background"
      >
        <div className="px-6 py-5">
          <div className="flex items-start justify-between mb-2">
            <div className="flex-1">
              <h2 className="text-xl font-bold tracking-tight">Shopping Cart</h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-background/60 hover:text-[#00EC97] transition-colors"
              aria-label="Close cart"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <p className="text-foreground/90 dark:text-muted-foreground text-sm">
            Review your items and proceed to checkout
          </p>
        </div>
        <div className="flex-1 overflow-y-auto px-6 min-h-0">
          {cartItems.length === 0 ? (
            <div className="py-12 text-center text-foreground/90 dark:text-muted-foreground">
              <p className="text-sm">
                Your cart is empty
              </p>
            </div>
          ) : (
            <div className="space-y-4 py-6">
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
                  <div key={getCartItemReactKey(item)} onClick={onClose}>
                    <ProductCard
                      product={item.product}
                      variant="horizontal"
                      hideFavorite
                      hidePrice
                      priceOverride={item.unitPrice}
                      className="pb-4 hover:shadow-none !p-0 !bg-transparent"
                      imageOverride={item.imageUrl}
                      actionSlot={
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeItem(item.id);
                          }}
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
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              updateQuantity(item.id, -1);
                            }}
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
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              updateQuantity(item.id, 1);
                            }}
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
          )}
        </div>
        {cartItems.length > 0 && (
          <div className="px-6 pt-5 pb-5">
            <div className="flex items-center justify-between mb-5">
              <span className="text-base font-semibold">Subtotal</span>
              <span className="text-base font-semibold">
                ${subtotal.toFixed(2)}
              </span>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                onClick={handleContinueShopping}
                className="flex-1 px-8 py-3 rounded-lg bg-background/60 backdrop-blur-sm border border-border/60 text-foreground flex items-center justify-center font-semibold text-base hover:bg-[#00EC97] hover:border-[#00EC97] hover:text-black transition-colors"
              >
                Continue Shopping
              </button>
            <Link
                to="/cart"
              onClick={onClose}
                className="flex-1 px-8 py-3 rounded-lg bg-[#00EC97] text-black flex items-center justify-center font-semibold text-base hover:bg-[#00d97f] transition-colors"
            >
                View Cart
            </Link>
            </div>
            <p className="text-foreground/90 dark:text-muted-foreground text-xs text-center mt-4">
              Shipping and taxes calculated at checkout
            </p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
