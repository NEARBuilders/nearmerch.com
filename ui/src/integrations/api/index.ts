import type { Category } from "./keys";
export * from "./collections";
import type { Collection } from "./collections";

export interface CartItem {
  id?: string;
  productId: string;
  variantId: string;
  quantity: number;
  size: string;
  color: string;
  imageUrl?: string;
  referralAccountId?: string;
}

export const requiresSize = (
  items: Category[] | Collection[] | undefined,
): boolean => {
  const names = (items ?? []).map((c) => c.name.toLowerCase());
  return names.some((n) => ["men", "women"].includes(n));
};

export { useProducts, useProduct, useSuspenseProduct, useFeaturedProducts, useSearchProducts, useProductsByIds, productLoaders, useUpdateProductListing, useUpdateProductCategories, useUpdateProductTags, useUpdateProductFeatured, useUpdateProductType, useUpdateProductMetadata, usePurchaseGateAccess, usePurchaseGateAccessMap, useProductTypes, useCreateProductType, useUpdateProductTypeItem, getPurchaseGatePluginId, getReferralConfig, getPrimaryCategoryName, type Product, type ProductImage, type ProductTypeData, type AffiliateMetadata, type FeeConfig, type PurchaseGate, type PurchaseGatePluginId, type ProductMetadata, type PrintfulProviderDetails, type LuluProviderDetails, type ProviderDetails, type ReferralConfig, } from "./products";

export { useCollections, useSuspenseCollections, useCollection, useSuspenseCollection, useCarouselCollections, useUpdateCollection, useUpdateCollectionFeaturedProduct, useCreateCollection, useDeleteCollection, collectionLoaders, type Collection, type CarouselCollection, } from "./collections";

export { useCategories, type Category, } from "./categories";

export { type ProviderConfig, type PrintfulWebhookEventType, } from "./providers";

export { useSubscribeNewsletter, type SubscribeNewsletterOutput, } from "./newsletter";

export { useSiteConfig, useSetMaintenanceMode, type SiteConfig, } from "./site-config";
