import { eq } from "drizzle-orm";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "../src/db/schema";
import {
  QIKINK_SANDBOX_CATALOG,
  mapFixtureProduct,
  providerConfigFromCatalogSelection,
} from "../src/services/fulfillment/qikink/catalog";
import { generateSlug } from "../src/utils/product-ids";

const DATABASE_URL =
  process.env.API_DATABASE_URL ?? "postgres://postgres:postgres@localhost:5433/api";

const STOREFRONT_USD_PRICE = 25;

const PUBLIC_KEYS: Record<string, string> = {
  "unisex-oversized-raglan": "qkraglanxs01",
  "classic-round-neck-tee": "qkteeclass01",
  "pullover-hoodie": "qkhoodie0001",
  "tote-bag": "qktotebag001",
  "mug-11oz": "qkmug11oz001",
};

const FALLBACK_IMAGE =
  "https://qikink-stores.s3.ap-south-1.amazonaws.com/assets/mockups/6/f787f104-9e35-4cad-acab-05be0c7f322d.jpg";

function storefrontId(key: string) {
  return `qikink-store-${key}`;
}

function toCents(price: number): number {
  return Math.round(price * 100);
}

async function main() {
  const client = postgres(DATABASE_URL, { max: 1 });
  const db = drizzle(client, { schema });
  const now = new Date();

  try {
    for (const fixture of QIKINK_SANDBOX_CATALOG) {
      const publicKey = PUBLIC_KEYS[fixture.key];
      if (!publicKey) {
        continue;
      }
      if (publicKey.length !== 12) {
        throw new Error(`Missing 12-char public key for Qikink catalog product ${fixture.key}`);
      }

      const id = storefrontId(fixture.key);
      const slug = generateSlug(fixture.name, publicKey);
      const catalogProduct = mapFixtureProduct(fixture, { includeVariants: true });
      const image = fixture.image ?? FALLBACK_IMAGE;
      const variants = catalogProduct.variants ?? [];

      await db
        .insert(schema.products)
        .values({
          id,
          publicKey,
          slug,
          name: fixture.name,
          description: fixture.description,
          price: toCents(STOREFRONT_USD_PRICE),
          currency: "USD",
          brand: "Qikink",
          productTypeSlug: null,
          tags: ["qikink"],
          options: [
            ...new Set(variants.map((variant) => variant.size).filter(Boolean)),
          ].length > 0
            ? [
                {
                  id: "option-0",
                  name: "Size",
                  values: [...new Set(variants.map((variant) => variant.size).filter((value): value is string => Boolean(value)))],
                  position: 1,
                },
                {
                  id: "option-1",
                  name: "Color",
                  values: [...new Set(variants.map((variant) => variant.color).filter((value): value is string => Boolean(value)))],
                  position: 2,
                },
              ]
            : [],
          thumbnailImage: image,
          featured: fixture.key === "unisex-oversized-raglan",
          metadata: { fees: [] },
          fulfillmentProvider: "qikink",
          externalProductId: fixture.key,
          source: "qikink",
          listed: true,
          priceLocked: false,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: schema.products.id,
          set: {
            name: fixture.name,
            description: fixture.description,
            price: toCents(STOREFRONT_USD_PRICE),
            currency: "USD",
            brand: "Qikink",
            tags: ["qikink"],
            thumbnailImage: image,
            featured: fixture.key === "unisex-oversized-raglan",
            fulfillmentProvider: "qikink",
            externalProductId: fixture.key,
            source: "qikink",
            listed: true,
            updatedAt: now,
          },
        });

      await db.delete(schema.productImages).where(eq(schema.productImages.productId, id));
      await db.insert(schema.productImages).values({
        id: `${id}-img-0`,
        productId: id,
        url: image,
        type: "catalog",
        placement: "Front",
        style: null,
        variantIds: null,
        order: 0,
        createdAt: now,
      });

      await db.delete(schema.productVariants).where(eq(schema.productVariants.productId, id));
      if (variants.length > 0) {
        await db.insert(schema.productVariants).values(
          variants.map((variant) => {
            const providerConfig = providerConfigFromCatalogSelection({
              product: catalogProduct,
              variant,
            });
            return {
              id: `${id}-${variant.id}`,
              productId: id,
              name: variant.name,
              sku: variant.providerRef,
              price: toCents(STOREFRONT_USD_PRICE),
              currency: "USD",
              attributes: [
                ...(variant.size ? [{ name: "Size", value: variant.size }] : []),
                ...(variant.color ? [{ name: "Color", value: variant.color }] : []),
              ],
              externalVariantId: variant.id,
              fulfillmentConfig: {
                providerName: "qikink" as const,
                providerConfig: {
                  ...providerConfig,
                  ...(fixture.key === "unisex-oversized-raglan"
                    ? {
                        storeSku: "v-9Ryj3ieHaVZW0M8OPRAhubTergzY-HeV",
                        designSku: "ereneyes",
                      }
                    : {}),
                },
                files: [],
              },
              inStock: true,
              createdAt: now,
            };
          }),
        );
      }
    }

    console.log(`Listed ${QIKINK_SANDBOX_CATALOG.length} Qikink products on the storefront`);
  } finally {
    await client.end();
  }
}

void main().catch((error) => {
  console.error("Qikink product seed failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
