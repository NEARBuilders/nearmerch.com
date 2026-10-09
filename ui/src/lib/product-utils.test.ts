import { describe, expect, it } from "vitest";
import {
  findVariantForSelection,
  getAvailableSizesForColor,
  getInitialSizeForColor,
  hasSelectableSizes,
  getVariantImageUrl,
  resolveSelectedSizeForColor,
} from "./product-utils";

const variants = [
  {
    id: "black-m",
    attributes: [
      { name: "Color", value: "Black" },
      { name: "Size", value: "M" },
    ],
    availableForSale: true,
  },
  {
    id: "blue-jean-s",
    attributes: [
      { name: "Color", value: "Blue Jean" },
      { name: "Size", value: "S" },
    ],
    availableForSale: true,
  },
];

describe("product option utilities", () => {
  it("does not substitute another size when the selected size is unavailable for the color", () => {
    const availableSizes = getAvailableSizesForColor({
      sizes: ["S", "M"],
      variants,
      selectedColor: "Blue Jean",
      hasColorOptions: true,
    });

    expect(availableSizes).toEqual(["S"]);
    expect(resolveSelectedSizeForColor("M", availableSizes)).toBe("");
    expect(resolveSelectedSizeForColor("S", availableSizes)).toBe("S");
    expect(
      findVariantForSelection(variants, {
        selectedColor: "Blue Jean",
        selectedSize: "M",
        hasColorOptions: true,
        hasSizeOptions: true,
      }),
    ).toBeUndefined();
    expect(
      findVariantForSelection(variants, {
        selectedColor: "Blue Jean",
        selectedSize: "S",
        hasColorOptions: true,
        hasSizeOptions: true,
      })?.id,
    ).toBe("blue-jean-s");
  });

  it("treats undefined availableForSale as buyable and false as not", () => {
    const mixed = [
      {
        id: "legacy",
        attributes: [
          { name: "Color", value: "Black" },
          { name: "Size", value: "M" },
        ],
      },
      {
        id: "oos",
        attributes: [
          { name: "Color", value: "Black" },
          { name: "Size", value: "L" },
        ],
        availableForSale: false,
      },
      {
        id: "in-stock",
        attributes: [
          { name: "Color", value: "Black" },
          { name: "Size", value: "S" },
        ],
        availableForSale: true,
      },
    ];

    expect(
      getAvailableSizesForColor({
        sizes: ["S", "M", "L"],
        variants: mixed,
        selectedColor: "Black",
        hasColorOptions: true,
      }),
    ).toEqual(["S", "M"]);
    expect(
      findVariantForSelection(mixed, {
        selectedColor: "Black",
        selectedSize: "M",
        hasColorOptions: true,
        hasSizeOptions: true,
      })?.id,
    ).toBe("legacy");
    expect(
      findVariantForSelection(mixed, {
        selectedColor: "Black",
        selectedSize: "L",
        hasColorOptions: true,
        hasSizeOptions: true,
      }),
    ).toBeUndefined();
  });

  it("does not treat N/A as a size the shopper must pick", () => {
    expect(hasSelectableSizes(["N/A"])).toBe(false);
    expect(getInitialSizeForColor(["N/A"])).toBe("");
    expect(hasSelectableSizes(["S", "M", "L"])).toBe(true);
  });

  it("resolves variant images from local Printful image ids when variantIds are missing", () => {
    const product = {
      images: [
        {
          id: "catalog-417721398",
          url: "https://example.com/brown.png",
          type: "preview",
        },
        {
          id: "file-939131829-5178432965",
          url: "https://example.com/black.png",
          type: "preview",
        },
        {
          id: "file-939131831-5178432974",
          url: "https://example.com/blue.png",
          type: "preview",
        },
      ],
      variants: [
        {
          id: "printful-variant-5178432965",
          attributes: [
            { name: "Color", value: "Black" },
            { name: "Size", value: "M" },
          ],
        },
        {
          id: "printful-variant-5178432974",
          attributes: [
            { name: "Color", value: "Blue Jean" },
            { name: "Size", value: "L" },
          ],
        },
        {
          id: "printful-variant-5178432975",
          attributes: [
            { name: "Color", value: "Blue Jean" },
            { name: "Size", value: "XL" },
          ],
        },
        {
          id: "printful-variant-5178432969",
          attributes: [
            { name: "Color", value: "Espresso" },
            { name: "Size", value: "M" },
          ],
        },
      ],
    };

    expect(getVariantImageUrl(product, "printful-variant-5178432965")).toBe(
      "https://example.com/black.png"
    );
    expect(getVariantImageUrl(product, "printful-variant-5178432975")).toBe(
      "https://example.com/blue.png"
    );
    expect(getVariantImageUrl(product, "printful-variant-5178432969")).toBe(
      "https://example.com/brown.png"
    );
  });
});
