import { apiClient } from "@/utils/orpc";
import type {
  FeeConfig,
  PrintfulProviderDetails,
  LuluProviderDetails,
  ProviderDetails,
  PurchaseGatePluginId,
  PurchaseGate,
  ReferralConfig,
  AffiliateMetadata,
  ProductMetadata,
} from "../../../../api/src/schema";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  useSuspenseQuery,
  type QueryClient,
} from "@tanstack/react-query";
import {
  productKeys,
  productTypeKeys,
  collectionKeys,
  categoryKeys,
  type Category,
} from "./keys";
import { toast } from "sonner";

export type Product = Awaited<
  ReturnType<typeof apiClient.getProduct>
>["product"];
export type ProductImage = Product["images"][number];

function isProductNotFoundError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const candidate = error as {
    code?: unknown;
    status?: unknown;
    response?: {
      status?: unknown;
      data?: { code?: unknown };
    };
  };

  return (
    candidate.code === "NOT_FOUND" ||
    candidate.status === 404 ||
    candidate.response?.status === 404 ||
    candidate.response?.data?.code === "NOT_FOUND"
  );
}

export function getPrimaryCategoryName(product: Product): string {
  return product.collections?.[0]?.name ?? "";
}

export function useProducts(options?: {
  productTypeSlug?: string;
  collectionSlugs?: string[];
  tags?: string[];
  featured?: boolean;
  limit?: number;
  offset?: number;
  includeUnlisted?: boolean;
  refetchInterval?: number | false;
  refetchOnWindowFocus?: boolean;
}) {
  return useQuery({
    queryKey: productKeys.list({
      productTypeSlug: options?.productTypeSlug,
      collectionSlugs: options?.collectionSlugs,
      tags: options?.tags,
      featured: options?.featured,
      limit: options?.limit,
      offset: options?.offset,
      includeUnlisted: options?.includeUnlisted,
    }),
    queryFn: async () => {
      const data = await apiClient.getProducts({
        productTypeSlug: options?.productTypeSlug,
        collectionSlugs: options?.collectionSlugs,
        tags: options?.tags,
        featured: options?.featured,
        limit: options?.limit ?? 50,
        offset: options?.offset ?? 0,
        includeUnlisted: options?.includeUnlisted,
      });

      return data;
    },
    placeholderData: (prev) => prev,
    refetchInterval: options?.refetchInterval,
    refetchOnWindowFocus: options?.refetchOnWindowFocus,
  });
}

export function useProduct(id: string) {
  return useQuery({
    queryKey: productKeys.detail(id),
    queryFn: async () => {
      const data = await apiClient.getProduct({ id });
      return {
        product: data.product,
      };
    },
  });
}

export function useSuspenseProduct(id: string) {
  return useSuspenseQuery({
    queryKey: productKeys.detail(id),
    queryFn: async () => {
      const data = await apiClient.getProduct({ id });
      return {
        product: data.product,
      };
    },
  });
}

export function useFeaturedProducts(limit = 12) {
  return useQuery({
    queryKey: productKeys.featured(limit),
    queryFn: async () => {
      const data = await apiClient.getFeaturedProducts({ limit });
      return data;
    },
    placeholderData: (prev) => prev,
  });
}

export function useSearchProducts(
  query: string,
  options?: {
    limit?: number;
  },
) {
  return useQuery({
    queryKey: productKeys.search(query, options?.limit),
    queryFn: async () => {
      const data = await apiClient.searchProducts({
        query,
        limit: options?.limit ?? 20,
      });
      return data;
    },
    enabled: query.length > 0,
  });
}

export function useProductsByIds(ids: string[]) {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: productKeys.detail(id),
      queryFn: () => apiClient.getProduct({ id }),
      enabled: !!id,
    })),
    combine: (results) => {
      const missingProductIds = results.reduce<string[]>((missingIds, result, index) => {
        const id = ids[index];
        if (id && result.isError && isProductNotFoundError(result.error)) {
          missingIds.push(id);
        }
        return missingIds;
      }, []);

      return {
        data: results.map((r) => r.data?.product).filter(Boolean) as Product[],
        isLoading: results.some((r) => r.isLoading),
        isError: results.some((r) => r.isError),
        missingProductIds,
      };
    },
  });
}

export const productLoaders = {
  featured: (limit = 12) => ({
    queryKey: productKeys.featured(limit),
    queryFn: () => apiClient.getFeaturedProducts({ limit }),
  }),

  detail: (id: string) => ({
    queryKey: productKeys.detail(id),
    queryFn: () => apiClient.getProduct({ id }),
  }),

  list: (options?: {
    productTypeSlug?: string;
    collectionSlugs?: string[];
    tags?: string[];
    featured?: boolean;
    limit?: number;
    offset?: number;
  }) => ({
    queryKey: productKeys.list({
      productTypeSlug: options?.productTypeSlug,
      collectionSlugs: options?.collectionSlugs,
      tags: options?.tags,
      featured: options?.featured,
      limit: options?.limit,
      offset: options?.offset,
    }),
    queryFn: () =>
      apiClient.getProducts({
        productTypeSlug: options?.productTypeSlug,
        collectionSlugs: options?.collectionSlugs,
        tags: options?.tags,
        featured: options?.featured,
        limit: options?.limit ?? 50,
        offset: options?.offset ?? 0,
      }),
  }),

  search: (query: string, options?: { limit?: number }) => ({
    queryKey: productKeys.search(query, options?.limit),
    queryFn: () =>
      apiClient.searchProducts({
        query,
        limit: options?.limit ?? 50,
      }),
  }),

  prefetchFeatured: async (qc: QueryClient, limit = 8) => {
    await qc.prefetchQuery(productLoaders.featured(limit));
  },

  prefetchProduct: async (qc: QueryClient, id: string) => {
    await qc.prefetchQuery(productLoaders.detail(id));
  },

  prefetchList: async (
    qc: QueryClient,
    options?: {
      productTypeSlug?: string;
      collectionSlugs?: string[];
      tags?: string[];
      featured?: boolean;
      limit?: number;
      offset?: number;
    },
  ) => {
    await qc.prefetchQuery(productLoaders.list(options));
  },

  prefetchSearch: async (
    qc: QueryClient,
    query: string,
    options?: { limit?: number },
  ) => {
    await qc.prefetchQuery(productLoaders.search(query, options));
  },
};

export function useUpdateProductListing() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, listed }: { id: string; listed: boolean }) =>
      apiClient.updateProductListing({ id, listed }),
    onMutate: async ({ id, listed }) => {
      await queryClient.cancelQueries({ queryKey: productKeys.all });

      const previousProducts = queryClient.getQueriesData({
        queryKey: productKeys.all,
      });

      queryClient.setQueriesData(
        {
          predicate: (query) =>
            query.queryKey[0] === "products" &&
            query.state.status === "success",
        },
        (old: any) => {
          if (!old) return old;
          if (old.products) {
            return {
              ...old,
              products: old.products.map((p: Product) =>
                p.id === id ? { ...p, listed } : p,
              ),
            };
          }
          if (old.product && old.product.id === id) {
            return {
              ...old,
              product: {
                ...old.product,
                listed,
              },
            };
          }
          return old;
        },
      );

      return { previousProducts };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousProducts) {
        context.previousProducts.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
      toast.error("Failed to update listing status");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: productKeys.all });
      queryClient.invalidateQueries({ queryKey: ["admin-products"] });
    },
  });
}

export function useUpdateProductCategories() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, categoryIds }: { id: string; categoryIds: string[] }) =>
      apiClient.updateProductCategories({ id, categoryIds }),
    onMutate: async ({ id, categoryIds }) => {
      await queryClient.cancelQueries({ queryKey: productKeys.all });
      const previousProducts = queryClient.getQueriesData({
        queryKey: productKeys.all,
      });

      const categoriesData = queryClient.getQueryData(categoryKeys.list()) as
        | { categories: Category[] }
        | undefined;

      queryClient.setQueriesData(
        {
          predicate: (query) =>
            query.queryKey[0] === "products" &&
            query.state.status === "success",
        },
        (old: any) => {
          if (!old) return old;

          const toCollection = (slug: string, existing?: any) => {
            if (existing) return existing;
            const cat = categoriesData?.categories?.find(
              (c) => c.slug === slug,
            );
            return {
              slug,
              name: cat?.name ?? slug,
              showInCarousel: true,
              carouselOrder: 0,
            };
          };

          if (old.products) {
            return {
              ...old,
              products: old.products.map((p: Product) =>
                p.id === id
                  ? {
                      ...p,
                      collections: (categoryIds as string[]).map((slug) =>
                        toCollection(
                          slug,
                          p.collections?.find((c: any) => c.slug === slug),
                        ),
                      ),
                    }
                  : p,
              ),
            };
          }

          if (old.product && old.product.id === id) {
            const p = old.product as Product;
            return {
              ...old,
              product: {
                ...p,
                collections: (categoryIds as string[]).map((slug) =>
                  toCollection(
                    slug,
                    p.collections?.find((c: any) => c.slug === slug),
                  ),
                ),
              },
            };
          }

          return old;
        },
      );

      return { previousProducts };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousProducts) {
        context.previousProducts.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
      toast.error("Failed to update collections", {
        description: "An unknown error occurred",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: productKeys.all });
      queryClient.invalidateQueries({ queryKey: collectionKeys.all });
      queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
    onSuccess: () => {
      toast.success("Collections updated successfully");
    },
  });
}

export function useUpdateProductTags() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, tags }: { id: string; tags: string[] }) =>
      apiClient.updateProductTags({ id, tags }),
    onMutate: async ({ id, tags }) => {
      await queryClient.cancelQueries({ queryKey: productKeys.all });
      const previousProducts = queryClient.getQueriesData({
        queryKey: productKeys.all,
      });

      queryClient.setQueriesData(
        {
          predicate: (query) =>
            query.queryKey[0] === "products" &&
            query.state.status === "success",
        },
        (old: any) => {
          if (!old) return old;
          if (old.products) {
            return {
              ...old,
              products: old.products.map((p: Product) =>
                p.id === id ? { ...p, tags } : p,
              ),
            };
          }
          if (old.product && old.product.id === id) {
            return {
              ...old,
              product: {
                ...old.product,
                tags,
              },
            };
          }
          return old;
        },
      );

      return { previousProducts };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousProducts) {
        context.previousProducts.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
      toast.error("Failed to update tags", {
        description: "An unknown error occurred",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: productKeys.all });
    },
    onSuccess: () => {
      toast.success("Tags updated successfully");
    },
  });
}

export function useUpdateProductFeatured() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, featured }: { id: string; featured: boolean }) =>
      apiClient.updateProductFeatured({ id, featured }),
    onMutate: async ({ id, featured }) => {
      await queryClient.cancelQueries({ queryKey: productKeys.all });
      const previousProducts = queryClient.getQueriesData({
        queryKey: productKeys.all,
      });

      queryClient.setQueriesData(
        {
          predicate: (query) =>
            query.queryKey[0] === "products" &&
            query.state.status === "success",
        },
        (old: any) => {
          if (!old) return old;
          if (old.products) {
            return {
              ...old,
              products: old.products.map((p: Product) =>
                p.id === id ? { ...p, featured } : p,
              ),
            };
          }
          if (old.product && old.product.id === id) {
            return {
              ...old,
              product: {
                ...old.product,
                featured,
              },
            };
          }
          return old;
        },
      );

      return { previousProducts };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousProducts) {
        context.previousProducts.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
      toast.error("Failed to update featured status", {
        description: "An unknown error occurred",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: productKeys.all });
    },
    onSuccess: (_, { featured }) => {
      const status = featured ? "featured" : "unfeatured";
      toast.success(`Product ${status} successfully`);
    },
  });
}

export function useUpdateProductType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      productTypeSlug,
    }: {
      id: string;
      productTypeSlug: string | null;
    }) => apiClient.updateProductType({ id, productTypeSlug }),
    onMutate: async ({ id, productTypeSlug }) => {
      await queryClient.cancelQueries({ queryKey: productKeys.all });
      const previousProducts = queryClient.getQueriesData({
        queryKey: productKeys.all,
      });

      queryClient.setQueriesData(
        {
          predicate: (query) =>
            query.queryKey[0] === "products" &&
            query.state.status === "success",
        },
        (old: any) => {
          if (!old) return old;
          if (old.products) {
            return {
              ...old,
              products: old.products.map((p: Product) =>
                p.id === id
                  ? {
                      ...p,
                      productType: productTypeSlug
                        ? {
                            slug: productTypeSlug,
                            label: productTypeSlug,
                            displayOrder: 0,
                          }
                        : null,
                    }
                  : p,
              ),
            };
          }
          if (old.product && old.product.id === id) {
            const p = old.product as Product;
            return {
              ...old,
              product: {
                ...p,
                productType: productTypeSlug
                  ? {
                      slug: productTypeSlug,
                      label: productTypeSlug,
                      displayOrder: 0,
                    }
                  : null,
              },
            };
          }
          return old;
        },
      );

      return { previousProducts };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousProducts) {
        context.previousProducts.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: productKeys.all });
    },
  });
}

export type ProductTypeData = Awaited<
  ReturnType<typeof apiClient.getProductTypes>
>["productTypes"][number];

export function useProductTypes() {
  return useQuery({
    queryKey: productTypeKeys.list(),
    queryFn: async () => {
      const data = await apiClient.getProductTypes();
      return data;
    },
  });
}

export function useCreateProductType() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      slug: string;
      label: string;
      description?: string;
      displayOrder?: number;
    }) => apiClient.createProductType(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productTypeKeys.all });
    },
  });
}

export function useUpdateProductTypeItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      slug,
      ...data
    }: {
      slug: string;
      label?: string;
      description?: string;
      displayOrder?: number;
    }) => apiClient.updateProductTypeItem({ slug, ...data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: productTypeKeys.all });
    },
  });
}

export type {
  FeeConfig,
  PrintfulProviderDetails,
  LuluProviderDetails,
  ProviderDetails,
  PurchaseGatePluginId,
  PurchaseGate,
  ReferralConfig,
  AffiliateMetadata,
  ProductMetadata,
};

export function getPurchaseGatePluginId(
  metadata?: ProductMetadata,
): PurchaseGatePluginId | undefined {
  return metadata?.purchaseGate?.pluginId;
}

export function getReferralConfig(
  metadata?: ProductMetadata,
): ReferralConfig | undefined {
  const referral = metadata?.affiliate?.referral;

  if (!referral?.enabled || !referral.feeBps || referral.feeBps <= 0) {
    return undefined;
  }

  return referral;
}

export function usePurchaseGateAccess(
  pluginId?: PurchaseGatePluginId,
  nearAccountId?: string | null,
) {
  const query = useQuery({
    queryKey: ["purchase-gate-access", pluginId ?? "none", nearAccountId ?? "anonymous"],
    queryFn: () =>
      apiClient.checkPurchaseGateAccess({
        pluginId: pluginId!,
        nearAccountId: nearAccountId!,
      }),
    enabled: Boolean(pluginId && nearAccountId),
    staleTime: 60_000,
  });

  const isGated = Boolean(pluginId);
  const hasAccess = !isGated
    ? true
    : !nearAccountId
      ? false
      : query.data?.hasAccess ?? false;
  const isLoading = Boolean(pluginId && nearAccountId && query.isPending);

  return {
    ...query,
    isGated,
    hasAccess,
    isLoading,
  };
}

export function usePurchaseGateAccessMap(
  pluginIds: PurchaseGatePluginId[],
  nearAccountId?: string | null,
) {
  const uniquePluginIds = Array.from(new Set(pluginIds));
  const queries = useQueries({
    queries: uniquePluginIds.map((pluginId) => ({
      queryKey: ["purchase-gate-access", pluginId, nearAccountId ?? "anonymous"],
      queryFn: () =>
        apiClient.checkPurchaseGateAccess({
          pluginId,
          nearAccountId: nearAccountId!,
        }),
      enabled: Boolean(nearAccountId),
      staleTime: 60_000,
    })),
  });

  const accessByPlugin = new Map<PurchaseGatePluginId, boolean>();

  uniquePluginIds.forEach((pluginId, index) => {
    const query = queries[index];
    accessByPlugin.set(
      pluginId,
      !nearAccountId ? false : query?.data?.hasAccess ?? false,
    );
  });

  return {
    accessByPlugin,
    isLoading: Boolean(nearAccountId) && queries.some((query) => query.isPending),
  };
}

export function useUpdateProductMetadata() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, metadata }: { id: string; metadata: ProductMetadata }) =>
      apiClient.updateProductMetadata({ id, metadata }),
    onMutate: async ({ id, metadata }) => {
      await queryClient.cancelQueries({ queryKey: productKeys.all });
      const previousProducts = queryClient.getQueriesData({
        queryKey: productKeys.all,
      });

      queryClient.setQueriesData(
        {
          predicate: (query) =>
            query.queryKey[0] === "products" &&
            query.state.status === "success",
        },
        (old: any) => {
          if (!old) return old;
          if (old.products) {
            return {
              ...old,
              products: old.products.map((p: Product) =>
                p.id === id ? { ...p, metadata } : p,
              ),
            };
          }
          if (old.product && old.product.id === id) {
            return {
              ...old,
              product: {
                ...old.product,
                metadata,
              },
            };
          }
          return old;
        },
      );

      return { previousProducts };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousProducts) {
        context.previousProducts.forEach(([queryKey, data]) => {
          queryClient.setQueryData(queryKey, data);
        });
      }
      toast.error("Failed to update metadata", {
        description: "An unknown error occurred",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: productKeys.all });
    },
    onSuccess: () => {
      toast.success("Metadata updated successfully");
    },
  });
}
