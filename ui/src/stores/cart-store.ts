import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { CartItem } from "@/integrations/api";

const CART_STORAGE_KEY = "marketplace-cart";

/**
 * Cart store state interface
 *
 * This store manages cart items with automatic localStorage persistence.
 * Actions are pure functions that update the state immutably.
 */
interface CartState {
  items: Record<string, CartItem>;

  // Actions
  addToCart: (
    productId: string,
    variantId: string,
    size: string,
    color: string,
    imageUrl?: string,
    referralAccountId?: string,
  ) => void;
  updateQuantity: (itemId: string, change: number) => void;
  removeItem: (itemId: string) => void;
  clearCart: () => void;

  // Getters (computed values)
  getItem: (itemId: string) => CartItem | undefined;
  getItemCount: () => number;
  getItemIds: () => string[];
}

export function buildCartItemId(variantId: string, referralAccountId?: string) {
  const normalizedReferral = referralAccountId?.trim().toLowerCase();

  return normalizedReferral
    ? `${variantId}::ref:${normalizedReferral}`
    : `${variantId}::direct`;
}

export function getCartItemReactKey(item: Pick<CartItem, "id">): string {
  return item.id;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: {},

      addToCart: (
        productId: string,
        variantId: string,
        size: string,
        color: string,
        imageUrl?: string,
        referralAccountId?: string,
      ) => {
        set((state) => {
          const normalizedReferral = referralAccountId?.trim().toLowerCase() || undefined;
          const itemId = buildCartItemId(variantId, normalizedReferral);
          const existingItem = state.items[itemId];

          return {
            items: {
              ...state.items,
              [itemId]: {
                id: itemId,
                productId,
                variantId,
                quantity: (existingItem?.quantity || 0) + 1,
                size,
                color,
                imageUrl: imageUrl || existingItem?.imageUrl,
                referralAccountId: normalizedReferral,
              },
            },
          };
        });
      },

      updateQuantity: (itemId: string, change: number) => {
        set((state) => {
          const current = state.items[itemId];
          if (!current) return state;

          const newQuantity = current.quantity + change;

          if (newQuantity <= 0) {
            const { [itemId]: _, ...rest } = state.items;
            return { items: rest };
          }

          return {
            items: {
              ...state.items,
              [itemId]: { ...current, quantity: newQuantity },
            },
          };
        });
      },

      removeItem: (itemId: string) => {
        set((state) => {
          const { [itemId]: _, ...rest } = state.items;
          return { items: rest };
        });
      },

      clearCart: () => {
        set({ items: {} });
      },

      getItem: (itemId: string) => {
        return get().items[itemId];
      },

      getItemCount: () => {
        return Object.values(get().items).reduce(
          (sum, item) => sum + item.quantity,
          0
        );
      },

      getItemIds: () => {
        return Object.keys(get().items);
      },
    }),
    {
      name: CART_STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      // Only persist the items, not the functions
      partialize: (state) => ({ items: state.items }),
    }
  )
);
