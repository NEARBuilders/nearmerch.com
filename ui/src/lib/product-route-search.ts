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
};

export type ProductVariantSelection = {
  color: string;
  size: string;
  requestedSize: string;
};

function optionalString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function parseProductRouteSearch(
  search: Record<string, unknown>,
): ProductRouteSearch {
  return {
    color: optionalString(search.color),
    size: optionalString(search.size),
    ref: optionalString(search.ref),
  };
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
  const color =
    search.color && colors.includes(search.color)
      ? search.color
      : colors[0] || "";

  if (!hasSelectableSizes(sizes)) {
    return { color, size: "", requestedSize: "" };
  }

  const availableSizes = getAvailableSizesForColor({
    sizes,
    variants,
    selectedColor: color,
    hasColorOptions: colors.length > 0,
  });
  const requestedSize =
    search.size && sizes.includes(search.size)
      ? search.size
      : getInitialSizeForColor(availableSizes);

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
