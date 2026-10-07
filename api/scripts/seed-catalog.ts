import { eq } from "drizzle-orm";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { extractPublicKeyFromSlug } from "../src/utils/product-ids";
import * as schema from "../src/db/schema";

const SOURCE_API = process.env.CATALOG_SOURCE_URL ?? "https://nearmerch.com";
const DATABASE_URL =
  process.env.API_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/api";

type CatalogProduct = {
  id: string;
  slug: string;
  title: string;
  description?: string;
  price: number;
  currency?: string;
  brand?: string;
  productType?: { slug: string; label: string; description?: string; displayOrder?: number };
  tags?: string[];
  featured?: boolean;
  collections?: Array<{ slug: string }>;
  options?: unknown[];
  images?: Array<{
    id: string;
    url: string;
    type: string;
    placement?: string;
    style?: string;
    variantIds?: string[];
    order?: number;
  }>;
  variants?: Array<{
    id: string;
    title: string;
    sku?: string;
    price: number;
    currency?: string;
    attributes?: unknown;
    externalVariantId?: string;
    fulfillmentConfig?: unknown;
    availableForSale?: boolean;
  }>;
  thumbnailImage?: string;
  fulfillmentProvider?: string;
  externalProductId?: string;
  source?: string;
  listed?: boolean;
  priceLocked?: boolean;
  assetId?: string;
  metadata?: unknown;
};

function toCents(price: number): number {
  return Math.round(price * 100);
}

function publicKeyFor(product: CatalogProduct): string {
  return extractPublicKeyFromSlug(product.slug) ?? product.id.replace(/-/g, "").slice(-12);
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${SOURCE_API}${path}`, init);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${path} failed: ${response.status} ${body.slice(0, 200)}`);
  }
  return (await response.json()) as T;
}

async function fetchProducts(): Promise<CatalogProduct[]> {
  try {
    const rpc = await fetchJson<{ json?: { products?: CatalogProduct[]; total?: number } }>(
      "/api/rpc/getProducts",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ json: { limit: 200, offset: 0 } }),
      },
    );
    if (rpc.json?.products?.length) {
      return rpc.json.products;
    }
  } catch {
    // Fall back to REST default page.
  }

  const rest = await fetchJson<{ products: CatalogProduct[]; total: number }>("/api/products");
  return rest.products ?? [];
}

async function main() {
  const [products, collectionsRes, typesRes] = await Promise.all([
    fetchProducts(),
    fetchJson<{ collections: Array<Record<string, unknown>> }>("/api/collections"),
    fetchJson<{ productTypes?: Array<Record<string, unknown>>; types?: Array<Record<string, unknown>> }>(
      "/api/product-types",
    ).catch(() => ({ productTypes: [] })),
  ]);

  const collections = collectionsRes.collections ?? [];
  const productTypes = typesRes.productTypes ?? typesRes.types ?? [];

  const client = postgres(DATABASE_URL, { max: 1 });
  const db = drizzle(client, { schema });
  const now = new Date();

  try {
    const typeRows = new Map<string, { slug: string; label: string; description?: string; displayOrder?: number }>();
    for (const type of productTypes) {
      if (typeof type.slug === "string" && typeof type.label === "string") {
        typeRows.set(type.slug, {
          slug: type.slug,
          label: type.label,
          description: typeof type.description === "string" ? type.description : undefined,
          displayOrder: typeof type.displayOrder === "number" ? type.displayOrder : 0,
        });
      }
    }
    for (const product of products) {
      if (product.productType?.slug) {
        typeRows.set(product.productType.slug, {
          slug: product.productType.slug,
          label: product.productType.label,
          description: product.productType.description,
          displayOrder: product.productType.displayOrder ?? 0,
        });
      }
    }

    if (typeRows.size > 0) {
      await db
        .insert(schema.productTypes)
        .values(
          [...typeRows.values()].map((type) => ({
            slug: type.slug,
            label: type.label,
            description: type.description ?? null,
            displayOrder: type.displayOrder ?? 0,
            createdAt: now,
            updatedAt: now,
          })),
        )
        .onConflictDoNothing();
    }

    for (const product of products) {
      await db
        .insert(schema.products)
        .values({
          id: product.id,
          publicKey: publicKeyFor(product),
          slug: product.slug,
          name: product.title,
          description: product.description ?? null,
          price: toCents(product.price),
          currency: product.currency ?? "USD",
          brand: product.brand ?? null,
          productTypeSlug: product.productType?.slug ?? null,
          tags: product.tags ?? [],
          options: (product.options ?? []) as schema.products.$inferInsert["options"],
          thumbnailImage: product.thumbnailImage ?? null,
          featured: product.featured ?? false,
          metadata: (product.metadata ?? undefined) as schema.products.$inferInsert["metadata"],
          fulfillmentProvider: product.fulfillmentProvider ?? "manual",
          externalProductId: product.externalProductId ?? null,
          source: product.source ?? "catalog-seed",
          assetId: null,
          listed: product.listed ?? true,
          priceLocked: product.priceLocked ?? false,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: schema.products.id,
          set: {
            name: product.title,
            description: product.description ?? null,
            price: toCents(product.price),
            currency: product.currency ?? "USD",
            brand: product.brand ?? null,
            productTypeSlug: product.productType?.slug ?? null,
            tags: product.tags ?? [],
            options: (product.options ?? []) as schema.products.$inferInsert["options"],
            thumbnailImage: product.thumbnailImage ?? null,
            featured: product.featured ?? false,
            metadata: (product.metadata ?? undefined) as schema.products.$inferInsert["metadata"],
            fulfillmentProvider: product.fulfillmentProvider ?? "manual",
            externalProductId: product.externalProductId ?? null,
            listed: product.listed ?? true,
            updatedAt: now,
          },
        });

      if (product.images?.length) {
        await db
          .insert(schema.productImages)
          .values(
            product.images.map((image, index) => ({
              id: image.id || `${product.id}-img-${index}`,
              productId: product.id,
              url: image.url,
              type: image.type,
              placement: image.placement ?? null,
              style: image.style ?? null,
              variantIds: image.variantIds ?? null,
              order: image.order ?? index,
              createdAt: now,
            })),
          )
          .onConflictDoNothing();
      }

      if (product.variants?.length) {
        await db
          .insert(schema.productVariants)
          .values(
            product.variants.map((variant) => ({
              id: variant.id,
              productId: product.id,
              name: variant.title,
              sku: variant.sku ?? null,
              price: toCents(variant.price),
              currency: variant.currency ?? product.currency ?? "USD",
              attributes: (variant.attributes ?? null) as schema.productVariants.$inferInsert["attributes"],
              externalVariantId: variant.externalVariantId ?? null,
              fulfillmentConfig: (variant.fulfillmentConfig ??
                null) as schema.productVariants.$inferInsert["fulfillmentConfig"],
              inStock: variant.availableForSale ?? true,
              createdAt: now,
            })),
          )
          .onConflictDoNothing();
      }
    }

    if (collections.length > 0) {
      await db
        .insert(schema.collections)
        .values(
          collections.map((collection) => ({
            slug: String(collection.slug),
            name: String(collection.name ?? collection.slug),
            description: typeof collection.description === "string" ? collection.description : null,
            image: typeof collection.image === "string" ? collection.image : null,
            badge: typeof collection.badge === "string" ? collection.badge : null,
            featuredProductId: null,
            carouselTitle: typeof collection.carouselTitle === "string" ? collection.carouselTitle : null,
            carouselDescription:
              typeof collection.carouselDescription === "string" ? collection.carouselDescription : null,
            showInCarousel: collection.showInCarousel !== false,
            carouselOrder: typeof collection.carouselOrder === "number" ? collection.carouselOrder : 0,
            createdAt: now,
            updatedAt: now,
          })),
        )
        .onConflictDoUpdate({
          target: schema.collections.slug,
          set: {
            updatedAt: now,
          },
        });

      const productIds = new Set(products.map((product) => product.id));
      for (const collection of collections) {
        const featuredId =
          typeof collection.featuredProductId === "string" ? collection.featuredProductId : null;
        if (featuredId && productIds.has(featuredId)) {
          await db
            .update(schema.collections)
            .set({ featuredProductId: featuredId, updatedAt: now })
            .where(eq(schema.collections.slug, String(collection.slug)));
        }
      }
    }

    const memberships = products.flatMap((product) =>
      (product.collections ?? []).map((collection) => ({
        productId: product.id,
        collectionSlug: collection.slug,
      })),
    );
    if (memberships.length > 0) {
      await db.insert(schema.productCollections).values(memberships).onConflictDoNothing();
    }

    console.log(
      `Seeded catalog: ${products.length} products, ${collections.length} collections, ${typeRows.size} product types`,
    );
  } finally {
    await client.end();
  }
}

void main().catch((error) => {
  console.error("Catalog seed failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
