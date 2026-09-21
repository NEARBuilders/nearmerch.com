import {
  requiresSize,
  useProductsByIds,
  type CartItem,
  type Product,
} from "@/integrations/api";
import { getProductVariantPrice } from "@/lib/product-price";
import { useCartStore } from "@/stores/cart-store";
import { useEffect, useMemo } from "react";

interface CartItemWithProduct extends CartItem {
  id: string;
  product: Product;
  unitPrice: number;
}

/**
 * Hook for accessing and managing cart state.
 * Uses Zustand for performant state management with localStorage persistence.
 *
 * @returns Cart state and actions
 */
export function useCart() {
  // Get cart state from Zustand store
  const items = useCartStore((state) => state.items);
  const addToCart = useCartStore((state) => state.addToCart);
  const updateQuantity = useCartStore((state) => state.updateQuantity);
  const removeItem = useCartStore((state) => state.removeItem);
  const clearCart = useCartStore((state) => state.clearCart);

  // Get unique product IDs and fetch product data
  const productIds = useMemo(() => {
    const uniqueProductIds = new Set<string>();
    Object.values(items).forEach((item) => {
      uniqueProductIds.add(item.productId);
    });
    return Array.from(uniqueProductIds);
  }, [items]);

  const { data: products, isLoading, missingProductIds } =
    useProductsByIds(productIds);

  const cartItems: CartItemWithProduct[] = useMemo(() => {
    const result: CartItemWithProduct[] = [];

    Object.entries(items).forEach(([itemId, item]) => {
      const product = products.find((p) => p.slug === item.productId);
      if (product) {
        result.push({
          ...item,
          id: item.id ?? itemId,
          product,
          unitPrice: getProductVariantPrice(product, item.variantId),
        });
      }
    });

    return result;
  }, [products, items]);

  useEffect(() => {
    if (isLoading) return;

    const missingIds = new Set(missingProductIds);

    Object.entries(items).forEach(([itemId, item]) => {
      if (missingIds.has(item.productId)) {
        removeItem(itemId);
      }
    });
  }, [missingProductIds, items, isLoading, removeItem]);

  // Memoize computed values
  const totalCount = useMemo(
    () => cartItems.reduce((sum, item) => sum + item.quantity, 0),
    [cartItems]
  );

  const subtotal = useMemo(
    () =>
      cartItems.reduce(
        (sum, item) => sum + item.unitPrice * item.quantity,
        0
      ),
    [cartItems]
  );

  return {
    items,
    cartItems,
    totalCount,
    subtotal,
    isLoading,
    addToCart,
    updateQuantity,
    removeItem,
    clearCart,
    requiresSize,
  };
}
