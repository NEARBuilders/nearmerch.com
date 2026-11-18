import {
  getAvailableSizesForColor,
  getInitialSizeForColor,
  hasSelectableSizes,
  type VariantWithOptions,
} from "./product-utils";

export type ProductRouteSearch = {
  color?: string;
  size?: string;
  ref?: string;
  [key: string]: string | undefined;
};

export type ProductVariantSelection = {
  color: string;
  size: string;
  requestedSize: string;
};

function optionalString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function findOption(options: string[], value: string | undefined) {
  const normalized = value?.toLowerCase();
  return normalized
    ? options.find((option) => option.toLowerCase() === normalized)
    : undefined;
}

const variantSearchKeys = new Set(["color", "size", "ref"]);

export function parseProductRouteSearch(
  search: Record<string, unknown>,
): ProductRouteSearch {
  const parsed: ProductRouteSearch = {
    color: optionalString(search.color),
    size: optionalString(search.size),
    ref: optionalString(search.ref),
  };

  for (const [key, value] of Object.entries(search)) {
    if (variantSearchKeys.has(key)) continue;
    const extra = optionalString(value);
    if (extra) parsed[key] = extra;
  }

  return parsed;
}

export function emptyProductRouteSearch(
  current: Record<string, unknown> = {},
): ProductRouteSearch {
  const next: ProductRouteSearch = {
    color: undefined,
    size: undefined,
    ref: undefined,
  };

  for (const [key, value] of Object.entries(current)) {
    if (key === "color" || key === "size" || key === "ref") continue;
    if (!key.startsWith("utm_")) continue;
    const extra = optionalString(value);
    if (extra) next[key] = extra;
  }

  return next;
}

export function buildProductShareUrl(
  origin: string,
  slug: string,
  search: { ref: string; color?: string; size?: string },
): string {
  const url = new URL(`/products/${slug}`, origin);
  url.searchParams.set("ref", search.ref);
  if (search.color) url.searchParams.set("color", search.color);
  if (search.size) url.searchParams.set("size", search.size);
  return url.toString();
}

function defaultVariantSelection(
  colors: string[],
  sizes: string[],
  variants: VariantWithOptions[],
): ProductVariantSelection {
  const color = colors[0] ?? "";

  if (!hasSelectableSizes(sizes)) {
    return { color, size: "", requestedSize: "" };
  }

  const availableSizes = getAvailableSizesForColor({
    sizes,
    variants,
    selectedColor: color,
    hasColorOptions: colors.length > 0,
  });
  const size = getInitialSizeForColor(availableSizes);
  return { color, size, requestedSize: size };
}

export function resolveProductVariantSelection({
  colors,
  sizes,
  variants,
  search,
}: {
  colors: string[];
  sizes: string[];
  variants: VariantWithOptions[];
  search: Pick<ProductRouteSearch, "color" | "size">;
}): ProductVariantSelection {
  const matchedColor = findOption(colors, search.color);
  const matchedSize = findOption(sizes, search.size);
  // Unknown color or size means the link cannot name a variant, so use the
  // product default. A known size that is sold out for this color is handled
  // below and stays unselected (#225) instead of being swapped.
  const colorIsUnknown = colors.length > 0 && Boolean(search.color) && !matchedColor;
  const sizeIsUnknown =
    hasSelectableSizes(sizes) && Boolean(search.size) && !matchedSize;

  if (colorIsUnknown || sizeIsUnknown) {
    return defaultVariantSelection(colors, sizes, variants);
  }

  const color = matchedColor ?? colors[0] ?? "";

  if (!hasSelectableSizes(sizes)) {
    return { color, size: "", requestedSize: "" };
  }

  const availableSizes = getAvailableSizesForColor({
    sizes,
    variants,
    selectedColor: color,
    hasColorOptions: colors.length > 0,
  });
  const requestedSize = matchedSize ?? getInitialSizeForColor(availableSizes);

  return {
    color,
    size: availableSizes.includes(requestedSize) ? requestedSize : "",
    requestedSize,
  };
}

export function getProductVariantSearch(
  current: ProductRouteSearch,
  selection: { color: string; size: string },
): ProductRouteSearch {
  return {
    ...current,
    color: selection.color || undefined,
    size: selection.size || undefined,
  };
}
