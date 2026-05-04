import { and, asc, count, eq, inArray, like, lt } from "drizzle-orm";
import { Context, Effect, Layer } from "every-plugin/effect";
import * as schema from "../db/schema";
import type {
  Collection,
  ProductMetadata,
  Product,
  ProductCriteria,
  ProductImage,
  ProductType,
  ProductVariant,
  ProductWithImages,
} from "../schema";
import { Database } from "./database";
import type { PrintfulProviderConfig } from '../services/fulfillment/printful/client';

export class ProductStore extends Context.Tag("ProductStore")<
  ProductStore,
  {
    readonly find: (identifier: string) => Effect.Effect<Product | null, Error>;
    readonly findByPublicKey: (
      publicKey: string,
    ) => Effect.Effect<Product | null, Error>;
    readonly findByExternalProductId: (
      externalProductId: string,
      fulfillmentProvider: string,
    ) => Effect.Effect<Product | null, Error>;
    readonly findMany: (
      criteria: ProductCriteria,
    ) => Effect.Effect<{ products: Product[]; total: number }, Error>;
    readonly search: (
      query: string,
      limit: number,
    ) => Effect.Effect<Product[], Error>;
    readonly upsert: (
      product: ProductWithImages,
      syncedAt?: Date,
    ) => Effect.Effect<Product & { isNew: boolean }, Error>;
    readonly delete: (id: string) => Effect.Effect<void, Error>;
    readonly updateListing: (
      id: string,
      listed: boolean,
    ) => Effect.Effect<Product | null, Error>;
    readonly updateTags: (
      id: string,
      tags: string[],
    ) => Effect.Effect<Product | null, Error>;
    readonly updateFeatured: (
      id: string,
      featured: boolean,
    ) => Effect.Effect<Product | null, Error>;
    readonly updateProductType: (
      id: string,
      productTypeSlug: string | null,
    ) => Effect.Effect<Product | null, Error>;
    readonly updateMetadata: (
      id: string,
      metadata: ProductMetadata,
    ) => Effect.Effect<Product | null, Error>;
    readonly updateProduct: (
      id: string,
      data: {
        name?: string;
        description?: string | null;
        price?: number;
        priceLocked?: boolean;
        images?: ProductImage[];
        thumbnailImage?: string | null;
      },
    ) => Effect.Effect<Product | null, Error>;
  }
>() {}

export const ProductStoreLive = Layer.effect(
  ProductStore,
  Effect.gen(function* () {
    const db = yield* Database;

    const getProductImages = async (
      productId: string,
    ): Promise<ProductImage[]> => {
      const images = await db
        .select()
        .from(schema.productImages)
        .where(eq(schema.productImages.productId, productId))
        .orderBy(schema.productImages.order);

      return images.map((img) => ({
        id: img.id,
        url: img.url,
        type: img.type as ProductImage["type"],
        placement: img.placement || undefined,
        style: img.style || undefined,
        variantIds: img.variantIds || undefined,
        order: img.order,
      }));
    };

    const getProductVariants = async (
      productId: string,
    ): Promise<ProductVariant[]> => {
      const variants = await db
        .select()
        .from(schema.productVariants)
        .where(eq(schema.productVariants.productId, productId));

      return variants.map((v) => {
        const fc = v.fulfillmentConfig as { providerName?: string; providerConfig?: PrintfulProviderConfig } | null;
        const fulfillmentCost = fc?.providerConfig?.fulfillmentCost;
        return {
          id: v.id,
          title: v.name,
          sku: v.sku || undefined,
          price: v.price / 100,
          currency: v.currency,
          attributes: v.attributes || [],
          externalVariantId: v.externalVariantId || undefined,
          fulfillmentConfig: v.fulfillmentConfig || undefined,
          availableForSale: v.inStock,
          fulfillmentCost,
        };
      });
    };

    const getProductCollections = async (
      productId: string,
    ): Promise<Collection[]> => {
      const results = await db
        .select({
          slug: schema.collections.slug,
          name: schema.collections.name,
          description: schema.collections.description,
          image: schema.collections.image,
          showInCarousel: schema.collections.showInCarousel,
          carouselOrder: schema.collections.carouselOrder,
        })
        .from(schema.productCollections)
        .innerJoin(
          schema.collections,
          eq(schema.productCollections.collectionSlug, schema.collections.slug),
        )
        .where(eq(schema.productCollections.productId, productId));

      return results.map((row) => ({
        slug: row.slug,
        name: row.name,
        description: row.description || undefined,
        image: row.image || undefined,
        showInCarousel: row.showInCarousel,
        carouselOrder: row.carouselOrder,
      }));
    };

    const getProductType = async (
      productTypeSlug: string | null,
    ): Promise<ProductType | undefined> => {
      if (!productTypeSlug) return undefined;

      const results = await db
        .select()
        .from(schema.productTypes)
        .where(eq(schema.productTypes.slug, productTypeSlug))
        .limit(1);

      if (results.length === 0) return undefined;

      const row = results[0]!;
      return {
        slug: row.slug,
        label: row.label,
        description: row.description || undefined,
        displayOrder: row.displayOrder,
      };
    };

    const safeParseJsonArray = (
      value: unknown,
      fieldName: string,
      rowId: string,
    ): any[] => {
      if (!value) return [];
      if (Array.isArray(value)) return value;

      if (typeof value === "string") {
        try {
          const parsed = JSON.parse(value);
          return Array.isArray(parsed) ? parsed : [];
        } catch (error) {
          console.error(
            `[ProductStore] Invalid JSON in ${fieldName} for product ${rowId}: ${value}`,
          );
          return [];
        }
      }

      return [];
    };

    const rowToProduct = async (
      row: typeof schema.products.$inferSelect,
    ): Promise<Product> => {
      const images = await getProductImages(row.id);
      const variants = await getProductVariants(row.id);
      const collections = await getProductCollections(row.id);
      const productType = await getProductType(row.productTypeSlug);

      const tags = safeParseJsonArray(row.tags, "tags", row.id);
      const options = safeParseJsonArray(row.options, "options", row.id);

      return {
        id: row.id,
        slug: row.slug,
        title: row.name,
        createdAt: row.createdAt.toISOString(),
        lastSyncedAt: row.lastSyncedAt?.toISOString(),
        description: row.description || undefined,
        price: row.price / 100,
        currency: row.currency,
        brand: row.brand || undefined,
        productType,
        tags,
        featured: row.featured ?? false,
        collections,
        options,
        images,
        variants,
        designFiles: [],
        fulfillmentProvider: row.fulfillmentProvider,
        externalProductId: row.externalProductId || undefined,
        source: row.source,
        thumbnailImage: row.thumbnailImage || undefined,
        listed: row.listed ?? true,
        priceLocked: row.priceLocked ?? false,
        assetId: row.assetId || undefined,
        metadata: row.metadata || undefined,
      };
    };

    return {
      find: (identifier) =>
        Effect.tryPromise({
          try: async () => {
            const isUUID =
              /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                identifier,
              );

            if (isUUID) {
              const results = await db
                .select()
                .from(schema.products)
                .where(eq(schema.products.id, identifier))
                .limit(1);

              if (results.length > 0) {
                return await rowToProduct(results[0]!);
              }
              return null;
            }

            const slugResults = await db
              .select()
              .from(schema.products)
              .where(eq(schema.products.slug, identifier))
              .limit(1);

            if (slugResults.length > 0) {
              return await rowToProduct(slugResults[0]!);
            }

            const publicKey = identifier.slice(-12);
            const results = await db
              .select()
              .from(schema.products)
              .where(eq(schema.products.publicKey, publicKey))
              .limit(1);

            if (results.length === 0) {
              return null;
            }

            return await rowToProduct(results[0]!);
          },
          catch: (error) => new Error(`Failed to find product: ${error}`),
        }),

      findByPublicKey: (publicKey) =>
        Effect.tryPromise({
          try: async () => {
            const results = await db
              .select()
              .from(schema.products)
              .where(eq(schema.products.publicKey, publicKey))
              .limit(1);

            if (results.length === 0) {
              return null;
            }

            return await rowToProduct(results[0]!);
          },
          catch: (error) =>
            new Error(`Failed to find product by publicKey: ${error}`),
        }),

      findByExternalProductId: (externalProductId, fulfillmentProvider) =>
        Effect.tryPromise({
          try: async () => {
            const results = await db
              .select()
              .from(schema.products)
              .where(
                and(
                  eq(schema.products.externalProductId, externalProductId),
                  eq(schema.products.fulfillmentProvider, fulfillmentProvider),
                ),
              )
              .limit(1);

            if (results.length === 0) {
              return null;
            }

            return await rowToProduct(results[0]!);
          },
          catch: (error) =>
            new Error(`Failed to find product by externalProductId: ${error}`),
        }),

      findMany: (criteria) =>
        Effect.tryPromise({
          try: async () => {
            const {
              productTypeSlug,
              collectionSlugs,
              tags,
              featured,
              limit = 50,
              offset = 0,
              includeUnlisted = false,
            } = criteria;

            const conditions = [];

            if (!includeUnlisted) {
              conditions.push(eq(schema.products.listed, true));
            }

            if (productTypeSlug) {
              conditions.push(
                eq(schema.products.productTypeSlug, productTypeSlug),
              );
            }

            if (featured !== undefined) {
              conditions.push(eq(schema.products.featured, featured));
            }

            const whereClause =
              conditions.length > 0 ? and(...conditions) : undefined;

            let productIds: string[] | undefined;

            if (collectionSlugs && collectionSlugs.length > 0) {
              const collectionProducts = await db
                .select({ productId: schema.productCollections.productId })
                .from(schema.productCollections)
                .where(
                  inArray(
                    schema.productCollections.collectionSlug,
                    collectionSlugs,
                  ),
                );

              productIds = [
                ...new Set(collectionProducts.map((p) => p.productId)),
              ];

              if (productIds.length === 0) {
                return { products: [], total: 0 };
              }
            }

            const finalConditions = whereClause
              ? productIds
                ? and(whereClause, inArray(schema.products.id, productIds))
                : whereClause
              : productIds
                ? inArray(schema.products.id, productIds)
                : undefined;

            const [countResult] = await db
              .select({ count: count() })
              .from(schema.products)
              .where(finalConditions);

            const total = Number(countResult?.count ?? 0);

            const results = await db
              .select()
              .from(schema.products)
              .where(finalConditions)
              .orderBy(asc(schema.products.name), asc(schema.products.id))
              .limit(limit)
              .offset(offset);

            let products = await Promise.all(results.map(rowToProduct));

            if (tags && tags.length > 0) {
              products = products.filter((product) =>
                tags.some((tag) => product.tags.includes(tag)),
              );
            }

            return { products, total };
          },
          catch: (error) => new Error(`Failed to find products: ${error}`),
        }),

      search: (query, limit) =>
        Effect.tryPromise({
          try: async () => {
            const searchTerm = `%${query}%`;

            const conditions = [eq(schema.products.listed, true)];

            const results = await db
              .select()
              .from(schema.products)
              .where(and(...conditions))
              .limit(limit);

            const allProducts = await Promise.all(results.map(rowToProduct));

            return allProducts.filter((product) => {
              const nameMatch = product.title
                .toLowerCase()
                .includes(query.toLowerCase());
              const tagMatch = product.tags.some((tag) =>
                tag.toLowerCase().includes(query.toLowerCase()),
              );
              return nameMatch || tagMatch;
            });
          },
          catch: (error) => new Error(`Failed to search products: ${error}`),
        }),

      upsert: (product) =>
        Effect.tryPromise({
          try: async () => {
            const now = new Date();

            let existingProduct: typeof schema.products.$inferSelect | null =
              null;
            if (product.externalProductId) {
              const existing = await db
                .select()
                .from(schema.products)
                .where(
                  and(
                    eq(
                      schema.products.externalProductId,
                      product.externalProductId,
                    ),
                    eq(
                      schema.products.fulfillmentProvider,
                      product.fulfillmentProvider,
                    ),
                  ),
                )
                .limit(1);

              if (existing.length > 0) {
                existingProduct = existing[0]!;
              }
            }

            const finalId = existingProduct?.id ?? product.id;

            let existingVariantsByExtId = new Map<string, { price: number }>();
            if (existingProduct && existingProduct.priceLocked) {
              const existingVariants = await db
                .select({ externalVariantId: schema.productVariants.externalVariantId, price: schema.productVariants.price })
                .from(schema.productVariants)
                .where(eq(schema.productVariants.productId, existingProduct.id));
              for (const ev of existingVariants) {
                if (ev.externalVariantId) {
                  existingVariantsByExtId.set(ev.externalVariantId, { price: ev.price });
                }
              }
            }

            if (existingProduct) {
              const existingMetadata = existingProduct.metadata as ProductMetadata | null;
              const newProviderDetails = product.metadata?.providerDetails;

              const mergedMetadata: ProductMetadata = {
                creatorAccountId: existingMetadata?.creatorAccountId,
                fees: existingMetadata?.fees ?? [],
                providerDetails: newProviderDetails ?? existingMetadata?.providerDetails,
                downloads: product.metadata?.downloads ?? existingMetadata?.downloads,
                purchaseGate: existingMetadata?.purchaseGate,
                affiliate: existingMetadata?.affiliate,
              };

              await db
                .update(schema.products)
                .set({
                  price: existingProduct.priceLocked ? existingProduct.price : Math.round(product.price * 100),
                  options: product.options,
                  thumbnailImage: product.thumbnailImage || existingProduct.thumbnailImage || null,
                  currency: product.currency,
                  brand: product.brand || existingProduct.brand || null,
                  fulfillmentProvider: product.fulfillmentProvider,
                  externalProductId: product.externalProductId || null,
                  source: product.source,
                  metadata: mergedMetadata,
                  lastSyncedAt: now,
                  updatedAt: now,
                })
                .where(eq(schema.products.id, finalId));

              await db
                .delete(schema.productVariants)
                .where(eq(schema.productVariants.productId, finalId));

              if (product.variants.length > 0) {
                await db.insert(schema.productVariants).values(
                  product.variants.map((variant) => {
                    const existingVariant = existingVariantsByExtId.get(variant.externalVariantId || '');
                    const isPriceLocked = existingProduct.priceLocked ?? false;
                    return {
                      id: variant.id,
                      productId: finalId,
                      name: variant.name,
                      sku: variant.sku || null,
                      price: (isPriceLocked && existingVariant) ? existingVariant.price : Math.round(variant.price * 100),
                      currency: variant.currency,
                      attributes: variant.attributes || null,
                      externalVariantId: variant.externalVariantId || null,
                      fulfillmentConfig: variant.fulfillmentConfig || null,
                      inStock: variant.inStock ?? true,
                      createdAt: now,
                    };
                  }),
                );
              }

              if (product.images.length > 0) {
                const existingImages = await db
                  .select({
                    id: schema.productImages.id,
                    url: schema.productImages.url,
                    type: schema.productImages.type,
                    variantIds: schema.productImages.variantIds,
                    order: schema.productImages.order,
                  })
                  .from(schema.productImages)
                  .where(eq(schema.productImages.productId, finalId));

                const existingByUrl = new Map(existingImages.map(i => [i.url, i]));

                const newImages: typeof product.images = [];
                for (const img of product.images) {
                  const existing = existingByUrl.get(img.url);
                  if (!existing) {
                    newImages.push(img);
                  } else {
                    const typeChanged = existing.type !== img.type;
                    const existingVids = existing.variantIds ?? [];
                    const newVids = img.variantIds ?? [];
                    const vidsChanged = JSON.stringify(existingVids) !== JSON.stringify(newVids);
                    if (typeChanged || vidsChanged) {
                      await db
                        .update(schema.productImages)
                        .set({
                          ...(typeChanged ? { type: img.type } : {}),
                          ...(vidsChanged ? { variantIds: newVids.length > 0 ? newVids : null } : {}),
                        })
                        .where(eq(schema.productImages.id, existing.id));
                    }
                  }
                }

                if (newImages.length > 0) {
                  const maxOrder = existingImages.length > 0 ? Math.max(...existingImages.map(i => i.order)) + 1 : 0;
                  let nextOrder = maxOrder;

                  await db.insert(schema.productImages).values(
                    newImages.map((img) => ({
                      id: img.id || `${finalId}-img-sync-${nextOrder}`,
                      productId: finalId,
                      url: img.url,
                      type: img.type,
                      placement: img.placement || null,
                      style: img.style || null,
                      variantIds: img.variantIds || null,
                      order: img.order ?? nextOrder++,
                      createdAt: now,
                    })),
                  );
                }
              }
            } else {
              await db.insert(schema.products).values({
                id: finalId,
                publicKey: product.publicKey,
                slug: product.slug,
                name: product.name,
                description: product.description || null,
                price: Math.round(product.price * 100),
                currency: product.currency,
                brand: product.brand || null,
                productTypeSlug: null,
                tags: [],
                options: product.options,
                thumbnailImage: product.thumbnailImage || null,
                featured: false,
                fulfillmentProvider: product.fulfillmentProvider,
                externalProductId: product.externalProductId || null,
                source: product.source,
                metadata: product.metadata,
                createdAt: now,
                updatedAt: now,
                listed: true,
                assetId: product.assetId || null,
              });

              if (product.images.length > 0) {
                await db.insert(schema.productImages).values(
                  product.images.map((img, index) => ({
                    id: img.id || `${finalId}-img-${index}`,
                    productId: finalId,
                    url: img.url,
                    type: img.type,
                    placement: img.placement || null,
                    style: img.style || null,
                    variantIds: img.variantIds || null,
                    order: img.order ?? index,
                    createdAt: now,
                  })),
                );
              }

              if (product.variants.length > 0) {
                await db.insert(schema.productVariants).values(
                  product.variants.map((variant) => ({
                    id: variant.id,
                    productId: finalId,
                    name: variant.name,
                    sku: variant.sku || null,
                    price: Math.round(variant.price * 100),
                    currency: variant.currency,
                    attributes: variant.attributes || null,
                    externalVariantId: variant.externalVariantId || null,
                    fulfillmentConfig: variant.fulfillmentConfig || null,
                    inStock: variant.inStock ?? true,
                    createdAt: now,
                  })),
                );
              }
            }

            const results = await db
              .select()
              .from(schema.products)
              .where(eq(schema.products.id, finalId))
              .limit(1);

            if (results.length === 0) {
              throw new Error("Product not found after upsert");
            }

            const result = await rowToProduct(results[0]!);
            return { ...result, isNew: !existingProduct } as Product & { isNew: boolean };
          },
          catch: (error) => new Error(`Failed to upsert product: ${error}`),
        }),

      delete: (id) =>
        Effect.tryPromise({
          try: async () => {
            await db.delete(schema.products).where(eq(schema.products.id, id));
          },
          catch: (error) => new Error(`Failed to delete product: ${error}`),
        }),

      updateListing: (id, listed) =>
        Effect.tryPromise({
          try: async () => {
            const now = new Date();
            await db
              .update(schema.products)
              .set({ listed, updatedAt: now })
              .where(eq(schema.products.id, id));

            const results = await db
              .select()
              .from(schema.products)
              .where(eq(schema.products.id, id))
              .limit(1);

            if (results.length === 0) {
              return null;
            }

            return await rowToProduct(results[0]!);
          },
          catch: (error) =>
            new Error(`Failed to update product listing: ${error}`),
        }),

      updateTags: (id, tags) =>
        Effect.tryPromise({
          try: async () => {
            const now = new Date();
            await db
              .update(schema.products)
              .set({ tags, updatedAt: now })
              .where(eq(schema.products.id, id));

            const results = await db
              .select()
              .from(schema.products)
              .where(eq(schema.products.id, id))
              .limit(1);

            if (results.length === 0) {
              return null;
            }

            return await rowToProduct(results[0]!);
          },
          catch: (error) =>
            new Error(`Failed to update product tags: ${error}`),
        }),

      updateFeatured: (id, featured) =>
        Effect.tryPromise({
          try: async () => {
            const now = new Date();
            await db
              .update(schema.products)
              .set({ featured, updatedAt: now })
              .where(eq(schema.products.id, id));

            const results = await db
              .select()
              .from(schema.products)
              .where(eq(schema.products.id, id))
              .limit(1);

            if (results.length === 0) {
              return null;
            }

            return await rowToProduct(results[0]!);
          },
          catch: (error) =>
            new Error(`Failed to update product featured status: ${error}`),
        }),

      updateProductType: (id, productTypeSlug) =>
        Effect.tryPromise({
          try: async () => {
            const now = new Date();
            await db
              .update(schema.products)
              .set({ productTypeSlug, updatedAt: now })
              .where(eq(schema.products.id, id));

            const results = await db
              .select()
              .from(schema.products)
              .where(eq(schema.products.id, id))
              .limit(1);

            if (results.length === 0) {
              return null;
            }

            return await rowToProduct(results[0]!);
          },
          catch: (error) =>
            new Error(`Failed to update product type: ${error}`),
        }),

      updateMetadata: (id, metadata) =>
        Effect.tryPromise({
          try: async () => {
            const now = new Date();
            await db
              .update(schema.products)
              .set({ metadata, updatedAt: now })
              .where(eq(schema.products.id, id));

            const results = await db
              .select()
              .from(schema.products)
              .where(eq(schema.products.id, id))
              .limit(1);

            if (results.length === 0) {
              return null;
            }

            return await rowToProduct(results[0]!);
          },
          catch: (error) =>
            new Error(`Failed to update product metadata: ${error}`),
        }),

      updateProduct: (id, data) =>
        Effect.tryPromise({
          try: async () => {
            const now = new Date();
            const updateData: Record<string, unknown> = { updatedAt: now };
            if (data.name !== undefined) updateData.name = data.name;
            if (data.description !== undefined) updateData.description = data.description;
            if (data.price !== undefined) updateData.price = Math.round(data.price * 100);
            if (data.priceLocked !== undefined) updateData.priceLocked = data.priceLocked;
            if (data.thumbnailImage !== undefined) updateData.thumbnailImage = data.thumbnailImage;

            await db
              .update(schema.products)
              .set(updateData)
              .where(eq(schema.products.id, id));

            if (data.images !== undefined) {
              await db
                .delete(schema.productImages)
                .where(eq(schema.productImages.productId, id));

              if (data.images.length > 0) {
                await db.insert(schema.productImages).values(
                  data.images.map((img, index) => ({
                    id: img.id || `${id}-img-${index}`,
                    productId: id,
                    url: img.url,
                    type: img.type,
                    placement: img.placement || null,
                    style: img.style || null,
                    variantIds: img.variantIds || null,
                    order: img.order ?? index,
                    createdAt: now,
                  })),
                );
              }
            }

            const results = await db
              .select()
              .from(schema.products)
              .where(eq(schema.products.id, id))
              .limit(1);

            if (results.length === 0) {
              return null;
            }

            return await rowToProduct(results[0]!);
          },
          catch: (error) =>
            new Error(`Failed to update product: ${error}`),
        }),
    };
  }),
);
