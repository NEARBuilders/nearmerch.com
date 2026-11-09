import { describe, expect, it } from "vitest";
import {
  getProductVariantSearch,
  parseProductRouteSearch,
  resolveProductVariantSelection,
} from "./product-route-search";

const variant = (color: string, size: string, availableForSale = true) => ({
  id: `${color}-${size}`,
  attributes: [
    { name: "Color", value: color },
    { name: "Size", value: size },
  ],
  availableForSale,
});

const shirt = {
  colors: ["Black", "White"],
  sizes: ["S", "M", "L"],
  variants: [
    variant("Black", "S"),
    variant("Black", "M"),
    variant("Black", "L"),
    variant("White", "S"),
    variant("White", "M", false),
  ],
};

describe("parseProductRouteSearch", () => {
  it("keeps color, size and ref and drops empty or non-string values", () => {
    expect(
      parseProductRouteSearch({ color: "Black", size: "M", ref: "alice.near" }),
    ).toEqual({ color: "Black", size: "M", ref: "alice.near" });
    expect(parseProductRouteSearch({ color: "", size: 3 })).toEqual({
      color: undefined,
      size: undefined,
      ref: undefined,
    });
  });
});

describe("resolveProductVariantSelection", () => {
  it("uses the default variant when the URL has no selection", () => {
    expect(resolveProductVariantSelection({ ...shirt, search: {} })).toEqual({
      color: "Black",
      size: "M",
      requestedSize: "M",
    });
  });

  it("selects the color and size from the URL", () => {
    expect(
      resolveProductVariantSelection({
        ...shirt,
        search: { color: "White", size: "S" },
      }),
    ).toEqual({ color: "White", size: "S", requestedSize: "S" });
  });

  it("falls back to the default for unknown colors and sizes", () => {
    expect(
      resolveProductVariantSelection({
        ...shirt,
        search: { color: "Purple", size: "XXXL" },
      }),
    ).toEqual({ color: "Black", size: "M", requestedSize: "M" });
  });

  it("matches color and size params case-insensitively", () => {
    expect(
      resolveProductVariantSelection({
        ...shirt,
        search: { color: "white", size: "s" },
      }),
    ).toEqual({ color: "White", size: "S", requestedSize: "S" });
  });

  it("picks the default size for the URL color when no size is given", () => {
    expect(
      resolveProductVariantSelection({ ...shirt, search: { color: "White" } }),
    ).toEqual({ color: "White", size: "S", requestedSize: "S" });
  });

  it("does not substitute another size when the requested one is unavailable for the color", () => {
    expect(
      resolveProductVariantSelection({
        ...shirt,
        search: { color: "White", size: "M" },
      }),
    ).toEqual({ color: "White", size: "", requestedSize: "M" });
  });

  it("ignores size params for products without selectable sizes", () => {
    expect(
      resolveProductVariantSelection({
        colors: ["Black"],
        sizes: ["One size"],
        variants: [variant("Black", "One size")],
        search: { color: "Black", size: "One size" },
      }),
    ).toEqual({ color: "Black", size: "", requestedSize: "" });
  });

  it("ignores color params for products without colors", () => {
    expect(
      resolveProductVariantSelection({
        colors: [],
        sizes: ["S", "M"],
        variants: [
          { id: "s", attributes: [{ name: "Size", value: "S" }] },
          { id: "m", attributes: [{ name: "Size", value: "M" }] },
        ],
        search: { color: "Black", size: "S" },
      }),
    ).toEqual({ color: "", size: "S", requestedSize: "S" });
  });
});

describe("getProductVariantSearch", () => {
  it("writes the selection and keeps other params", () => {
    expect(
      getProductVariantSearch(
        { ref: "alice.near" },
        { color: "White", size: "S" },
      ),
    ).toEqual({ ref: "alice.near", color: "White", size: "S" });
  });

  it("removes empty selections from the URL", () => {
    expect(
      getProductVariantSearch(
        { color: "Black", size: "M" },
        { color: "", size: "" },
      ),
    ).toEqual({ color: undefined, size: undefined });
  });
});
