import { describe, expect, it } from "vitest";
import {
  formatProviderDetails,
  isProviderWithDetails,
} from "../../src/services/fulfillment/fields";

describe("provider detail fields", () => {
  it("formats Printful details in config order", () => {
    expect(
      formatProviderDetails("printful", {
        printful: {
          placements: ["front", "back"],
          techniques: ["dtg", "embroidery"],
          gsm: 180,
          brand: "Bella + Canvas",
          model: "3001",
          material: "100% cotton",
          description: "Not shown",
        },
      }),
    ).toEqual([
      { label: "Brand", value: "Bella + Canvas" },
      { label: "Model", value: "3001" },
      { label: "Fabric Weight", value: "180 g/m²" },
      { label: "Material", value: "100% cotton" },
      { label: "Print Method", value: "dtg, embroidery" },
      { label: "Print Locations", value: "front, back" },
    ]);
  });

  it("formats Lulu details", () => {
    expect(
      formatProviderDetails("lulu", { lulu: { pageCount: 120, format: "Paperback" } }),
    ).toEqual([
      { label: "Pages", value: "120" },
      { label: "Format", value: "Paperback" },
    ]);
  });

  it("skips missing and empty values", () => {
    expect(
      formatProviderDetails("printful", { printful: { brand: "Gildan", techniques: [] } }),
    ).toEqual([{ label: "Brand", value: "Gildan" }]);
    expect(formatProviderDetails("printful", undefined)).toEqual([]);
  });

  it("does not expose manual provider settings", () => {
    expect(isProviderWithDetails("printful")).toBe(true);
    expect(isProviderWithDetails("lulu")).toBe(true);
    expect(isProviderWithDetails("manual")).toBe(false);
  });
});
