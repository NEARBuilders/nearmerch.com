import type { FulfillmentFile } from "../schema";

export const CENTERED_PLACEMENT_PRIORITY = [
  "front",
  "front_large",
  "front_dtf",
  "front_dtfabric",
  "embroidery_front_large",
  "embroidery_front",
  "embroidery_chest_center",
] as const;

export const SECONDARY_PLACEMENTS = new Set([
  "back",
  "embroidery_chest_left",
  "sleeve_left",
  "sleeve_right",
  "label_inside",
  "label_outside",
  "inside",
  "neck",
]);

export type CatalogPlacement = {
  placement?: string;
  technique?: string;
};

export type CatalogTechnique = {
  key?: string;
  is_default?: boolean;
};

export type CatalogPlacementData = {
  primaryPlacement?: { name: string; technique: string };
  placementTechniques?: Record<string, string>;
} | null;

export function pickPrimaryPlacement(
  placements: CatalogPlacement[],
  techniques?: CatalogTechnique[],
): { name: string; technique: string } | undefined {
  const usable = placements.filter(
    (placement): placement is { placement: string; technique: string } =>
      Boolean(placement.placement && placement.placement !== "mockup" && placement.technique),
  );
  if (usable.length === 0) return undefined;

  const defaultTechnique = techniques?.find((technique) => technique.is_default)?.key;
  const defaultPool = defaultTechnique
    ? usable.filter((placement) => placement.technique === defaultTechnique)
    : [];
  const search = defaultPool.length > 0 ? defaultPool : usable;

  for (const name of CENTERED_PLACEMENT_PRIORITY) {
    const match = search.find((placement) => placement.placement === name);
    if (match) {
      return { name: match.placement, technique: match.technique };
    }
  }

  const fallback = search.find((placement) => !SECONDARY_PLACEMENTS.has(placement.placement));
  if (!fallback) return undefined;
  return { name: fallback.placement, technique: fallback.technique };
}

export function fulfillmentFileTechnique(file: FulfillmentFile): string | undefined {
  const technique = file.metadata?.technique;
  return typeof technique === "string" ? technique : undefined;
}

export function filesNeedCatalogLookup(files: FulfillmentFile[]): boolean {
  return files.some((file) => {
    const slot = file.slot || "default";
    return slot === "default" || !fulfillmentFileTechnique(file);
  });
}

export function remapPrintfulPlacement(
  slot: string,
  technique: string | null | undefined,
  catalog: CatalogPlacementData,
  siblingSlots: string[] = [],
): { slot: string; technique: string | undefined } {
  const normalizedSlot = slot || "default";
  const primary = catalog?.primaryPlacement;
  const placementTechniques = catalog?.placementTechniques;
  const isKnownSlot = Boolean(placementTechniques?.[normalizedSlot]);
  const needsRemap = normalizedSlot === "default" || (catalog != null && !isKnownSlot);

  if (!needsRemap) {
    return {
      slot: normalizedSlot,
      technique: technique ?? placementTechniques?.[normalizedSlot] ?? primary?.technique,
    };
  }

  const wouldCollide = Boolean(
    primary && primary.name !== normalizedSlot && siblingSlots.includes(primary.name),
  );
  const primaryTechnique = primary
    ? (placementTechniques?.[primary.name] ?? primary.technique)
    : undefined;
  const techniqueCompatible =
    !technique || !primaryTechnique || primaryTechnique === technique;

  if (!primary || wouldCollide || !techniqueCompatible) {
    return {
      slot: normalizedSlot,
      technique: technique ?? placementTechniques?.[normalizedSlot] ?? primary?.technique,
    };
  }

  return {
    slot: primary.name,
    technique: technique ?? primaryTechnique,
  };
}
