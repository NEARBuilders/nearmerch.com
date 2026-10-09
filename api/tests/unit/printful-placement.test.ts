import { describe, expect, it } from "vitest";
import {
  filesNeedCatalogLookup,
  pickPrimaryPlacement,
  remapPrintfulPlacement,
} from "../../src/services/fulfillment/printful/placements";

const hoodiePlacements = [
  { placement: "embroidery_chest_left", technique: "embroidery" },
  { placement: "front", technique: "dtg" },
  { placement: "back", technique: "dtg" },
  { placement: "mockup", technique: "dtg" },
];

const techniques = [
  { key: "dtg", is_default: true },
  { key: "embroidery", is_default: false },
];

describe("pickPrimaryPlacement", () => {
  it("prefers the default technique's centered front placement over left-chest embroidery", () => {
    expect(pickPrimaryPlacement(hoodiePlacements, techniques)).toEqual({
      name: "front",
      technique: "dtg",
    });
  });

  it("keeps embroidery_front for hats that have no DTG front", () => {
    expect(
      pickPrimaryPlacement(
        [
          { placement: "embroidery_front", technique: "embroidery" },
          { placement: "embroidery_front_large", technique: "embroidery" },
        ],
        [{ key: "embroidery", is_default: true }],
      ),
    ).toEqual({
      name: "embroidery_front_large",
      technique: "embroidery",
    });
  });

  it("does not fall back to back or left-chest embroidery", () => {
    expect(
      pickPrimaryPlacement(
        [
          { placement: "embroidery_chest_left", technique: "embroidery" },
          { placement: "back", technique: "dtg" },
        ],
        techniques,
      ),
    ).toBeUndefined();
  });
});

describe("remapPrintfulPlacement", () => {
  const catalog = {
    primaryPlacement: { name: "front", technique: "dtg" },
    placementTechniques: {
      front: "dtg",
      back: "dtg",
      embroidery_chest_left: "embroidery",
    },
  };

  it("remaps default files to the centered catalog placement", () => {
    expect(remapPrintfulPlacement("default", "dtg", catalog)).toEqual({
      slot: "front",
      technique: "dtg",
    });
  });

  it("keeps genuine left-chest embroidery instead of guessing a front remap", () => {
    expect(
      remapPrintfulPlacement("embroidery_chest_left", "embroidery", catalog),
    ).toEqual({
      slot: "embroidery_chest_left",
      technique: "embroidery",
    });
  });

  it("remaps slots that are invalid for the catalog product", () => {
    expect(remapPrintfulPlacement("not_a_real_slot", "dtg", catalog)).toEqual({
      slot: "front",
      technique: "dtg",
    });
  });

  it("keeps the incoming technique when it matches the primary placement", () => {
    expect(remapPrintfulPlacement("default", "dtg", catalog)).toEqual({
      slot: "front",
      technique: "dtg",
    });
  });

  it("does not swap an embroidery file onto a DTG front placement", () => {
    expect(remapPrintfulPlacement("default", "embroidery", catalog)).toEqual({
      slot: "default",
      technique: "embroidery",
    });
  });

  it("does not remap back prints", () => {
    expect(remapPrintfulPlacement("back", "dtg", catalog)).toEqual({
      slot: "back",
      technique: "dtg",
    });
  });

  it("does not remap a default file onto a sibling front file", () => {
    expect(
      remapPrintfulPlacement("default", undefined, catalog, ["default", "front"]),
    ).toEqual({
      slot: "default",
      technique: "dtg",
    });
  });
});

describe("filesNeedCatalogLookup", () => {
  it("needs a catalog fetch for default slots or missing techniques", () => {
    expect(
      filesNeedCatalogLookup([
        { assetId: "1", url: "https://example.com/a.png", slot: "front", metadata: { technique: "dtg" } },
      ]),
    ).toBe(false);
    expect(
      filesNeedCatalogLookup([
        { assetId: "1", url: "https://example.com/a.png", slot: "default", metadata: { technique: "dtg" } },
      ]),
    ).toBe(true);
    expect(
      filesNeedCatalogLookup([
        { assetId: "1", url: "https://example.com/a.png", slot: "front" },
      ]),
    ).toBe(true);
  });
});
