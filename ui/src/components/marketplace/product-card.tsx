import { FavoriteButton } from "@/components/marketplace/favorite-button";
import legionExclusiveLock from "@/assets/images/pngs/legion-exclusive.png";
import { useFavorites } from "@/hooks/use-favorites";
import { useNearAccountId } from "@/hooks/use-near-account-id";
import { useCart } from "@/hooks/use-cart";
import {
  getPurchaseGatePluginId,
  type Product,
  usePurchaseGateAccess,
  useSuspenseProduct,
  type ProductMetadata,
} from "@/integrations/api";
import { useResolvedAssetUrl } from "@/lib/asset-url";
import { cn } from "@/lib/utils";
import { Link } from "@tanstack/react-router";
import { ShoppingCart } from "lucide-react";
import React, { useCallback, useState, useEffect } from "react";
import { useCartSidebarStore } from "@/stores/cart-sidebar-store";
import {
  COLOR_MAP,
  findVariantForSelection,
  getAvailableSizesForColor,
  getAttributeHex,
  getInitialSizeForColor,
  getOptionValue,
  getUnavailableVariantMessage,
  getVariantImageUrl,
  hasSelectableSizes,
  resolveSelectedSizeForColor,
  sizeAfterColorChange,
  sizeOptionSelection,
} from "@/lib/product-utils";
import { getLowestVariantPrice } from "@/lib/product-price";
import { toast } from "sonner";

function getTotalFeePercentage(metadata: ProductMetadata | undefined): number {
  if (!metadata?.fees?.length) return 0;
  const totalBps = metadata.fees.reduce((sum, f) => sum + f.bps, 0);
  return totalBps / 100;
}

interface ProductCardProps {
  product?: Product;
  productId?: string;
  variant?: "sm" | "md" | "lg" | "horizontal";
  className?: string;
  onQuickAdd?: (product: Product) => void;
  hideActions?: boolean;
  hideFavorite?: boolean;
  hidePrice?: boolean;
  priceOverride?: number;
  actionSlot?: React.ReactNode;
  children?: React.ReactNode;
  imageOverride?: string;
}

export function ProductCard({
  product,
  productId,
  variant = "md",
  className,
  onQuickAdd,
  hideActions = false,
  hideFavorite = false,
  hidePrice = false,
  priceOverride,
  actionSlot,
  children,
  imageOverride,
}: ProductCardProps) {
  if (product) {
    return (
      <ProductCardContent
        product={product}
        variant={variant}
        className={className}
        onQuickAdd={onQuickAdd}
        hideActions={hideActions}
        hideFavorite={hideFavorite}
        hidePrice={hidePrice}
        priceOverride={priceOverride}
        actionSlot={actionSlot}
        imageOverride={imageOverride}
      >
        {children}
      </ProductCardContent>
    );
  }

  if (productId) {
    return (
      <SuspendedProductCard
        productId={productId}
        variant={variant}
        className={className}
        onQuickAdd={onQuickAdd}
        hideActions={hideActions}
        hideFavorite={hideFavorite}
        hidePrice={hidePrice}
        priceOverride={priceOverride}
        actionSlot={actionSlot}
      >
        {children}
      </SuspendedProductCard>
    );
  }

  return null;
}

function SuspendedProductCard({
  productId,
  variant,
  className,
  onQuickAdd,
  hideActions,
  hideFavorite,
  hidePrice,
  priceOverride,
  actionSlot,
  children,
  imageOverride,
}: { productId: string } & Omit<ProductCardProps, "product" | "productId">) {
  const { data } = useSuspenseProduct(productId);
  return (
    <ProductCardContent
      product={data.product}
      variant={variant}
      className={className}
      onQuickAdd={onQuickAdd}
      hideActions={hideActions}
      hideFavorite={hideFavorite}
      hidePrice={hidePrice}
      priceOverride={priceOverride}
      actionSlot={actionSlot}
      imageOverride={imageOverride}
    >
      {children}
    </ProductCardContent>
  );
}

interface ProductCardContentProps
  extends Omit<ProductCardProps, "product" | "productId"> {
  product: Product;
  imageOverride?: string;
}

function ProductCardContent(props: ProductCardContentProps) {
  const { variant = "md" } = props;

  if (variant === "horizontal") {
    return <HorizontalProductLayout {...props} />;
  }

  return <VerticalProductLayout {...props} />;
}

function VerticalProductLayout({
  product,
  variant = "md",
  className,
  onQuickAdd,
  hideActions,
  hideFavorite,
  hidePrice,
  priceOverride,
  actionSlot,
  children,
  imageOverride: _imageOverride,
}: ProductCardContentProps) {
  const { favoriteIds, toggleFavorite } = useFavorites();
  const { addToCart } = useCart();
  const openCartSidebar = useCartSidebarStore((state) => state.open);
  const [isExpanded, setIsExpanded] = useState(false);
  const [selectedColor, setSelectedColor] = useState<string>("");
  const [selectedSize, setSelectedSize] = useState<string>("");
  const nearAccountId = useNearAccountId();
  const purchaseGatePluginId = getPurchaseGatePluginId(
    product.metadata as ProductMetadata | undefined,
  );
  const {
    hasAccess: canPurchase,
    isGated: isPurchaseGated,
    isLoading: isPurchaseGateLoading,
  } = usePurchaseGateAccess(purchaseGatePluginId, nearAccountId);

  const colorOption = product?.options?.find((opt) => opt.name === "Color");
  const sizeOption = product?.options?.find((opt) => opt.name === "Size");
  const orderedColors = colorOption?.values || [];
  const orderedSizes = sizeOption?.values || [];
  const availableSizes = orderedSizes.length > 0 ? orderedSizes : ["N/A"];
  const availableVariants = product?.variants || [];
  const displayPrice = priceOverride ?? getLowestVariantPrice(product);

  useEffect(() => {
    if (isExpanded && product) {
      const nextColor = orderedColors[0] || "";
      const sizesForColor = getAvailableSizesForColor({
        sizes: orderedSizes.length > 0 ? orderedSizes : ["N/A"],
        variants: product.variants || [],
        selectedColor: nextColor,
        hasColorOptions: orderedColors.length > 0,
      });
      setSelectedColor(nextColor);
      setSelectedSize(getInitialSizeForColor(sizesForColor));
    }
  }, [isExpanded, product, orderedColors, orderedSizes]);

  const availableSizesForColor = getAvailableSizesForColor({
    sizes: availableSizes,
    variants: availableVariants,
    selectedColor,
    hasColorOptions: orderedColors.length > 0,
  });
  const effectiveSelectedSize = resolveSelectedSizeForColor(
    selectedSize,
    availableSizesForColor,
  );

  const hasSizeOptions = hasSelectableSizes(orderedSizes);

  useEffect(() => {
    if (!isExpanded || !product) return;
    const nextSize = sizeAfterColorChange(selectedSize, availableSizesForColor);
    if (nextSize !== selectedSize) setSelectedSize(nextSize);
  }, [isExpanded, product, selectedSize, availableSizesForColor]);

  const handleToggleFavorite = useCallback(
    () => toggleFavorite(product.id, product.title),
    [product, toggleFavorite]
  );

  const handleQuickAddClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!canPurchase) {
        return;
      }
      if (orderedColors.length > 0 || orderedSizes.length > 0) {
        setIsExpanded(!isExpanded);
      } else if (onQuickAdd) {
        onQuickAdd(product);
      }
    },
    [canPurchase, product, onQuickAdd, isExpanded, orderedColors.length, orderedSizes.length]
  );

  const handleAddToCart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!canPurchase) {
        return;
      }
      
      let finalColor = selectedColor || "N/A";
      let finalSize = effectiveSelectedSize || selectedSize || "N/A";
      const variant = findVariantForSelection(availableVariants, {
        selectedColor,
        selectedSize: effectiveSelectedSize,
        hasColorOptions: orderedColors.length > 0,
        hasSizeOptions,
      });

      if (!variant) {
        toast.error(
          getUnavailableVariantMessage({
            selectedSize,
            selectedColor,
            effectiveSelectedSize,
            availableSizesForColor,
            hasSizeOptions,
          }),
        );
        return;
      }

      finalColor = getOptionValue(variant.attributes, "Color") || finalColor;
      finalSize = getOptionValue(variant.attributes, "Size") || finalSize;

      const variantImageUrl = getVariantImageUrl(product, variant.id);
      addToCart(product.slug, variant.id, finalSize, finalColor, variantImageUrl);
      setIsExpanded(false);
      openCartSidebar();
    },
    [canPurchase, product, addToCart, selectedColor, selectedSize, effectiveSelectedSize, orderedColors, hasSizeOptions, availableVariants, availableSizesForColor, openCartSidebar]
  );

  const isFavorite = favoriteIds.includes(product.id);
  
  // Filter out mockup images and use only variant images
  const variantImages = product.images?.filter(
    (img) => img.type !== "mockup" && img.type !== "detail" && img.variantIds && img.variantIds.length > 0
  ) || [];
  
  const displayImage =
    variantImages[0]?.url ||
    product.variants?.[0]?.fulfillmentConfig?.files?.[0]?.url ||
    product.images?.find((img) => img.type !== "mockup" && img.type !== "detail")?.url;

  const titleSize =
    variant === "sm" ? "text-sm" : variant === "lg" ? "text-xl" : "text-lg";
  const priceSize = "text-sm";
  const useCompactPriceBadge = variant === "sm";
  const shouldDimProduct = isPurchaseGated && !canPurchase && !isPurchaseGateLoading;
  const exclusiveLockImageSrc = useResolvedAssetUrl(legionExclusiveLock);

  return (
    <div
      className={cn(
        "group relative rounded-2xl bg-background/5 backdrop-blur-sm border border-border/60 overflow-hidden transition-all duration-300 hover:shadow-lg hover:border-border flex flex-col h-full",
        className
      )}
      data-testid="product-card"
    >
      <div className="relative bg-muted overflow-hidden shrink-0 aspect-square w-full rounded-t-2xl">
        <div className="absolute inset-0 bg-gradient-to-b from-background/5 via-background/20 to-background/60 dark:from-background/5 dark:via-background/30 dark:to-background/80 z-0"></div>
        <Link
          to="/products/$productId"
          params={{ productId: product.slug }}
          preload="intent"
          preloadDelay={0}
          className="block w-full h-full relative z-10"
          resetScroll={true}
        >
          {displayImage ? (
            <img
              src={displayImage}
              alt={product.title}
              loading="lazy"
              decoding="async"
              width={400}
              height={400}
              className={cn(
                "w-full h-full object-cover transition-transform duration-500 group-hover:scale-105 relative z-10",
                shouldDimProduct && "grayscale brightness-75"
              )}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-foreground/90 dark:text-muted-foreground bg-muted relative z-10">
              No Image
            </div>
          )}
        </Link>

        {shouldDimProduct && (
          <div className="pointer-events-none absolute inset-0 z-[18] flex items-center justify-center">
            <div className="relative flex h-full w-full flex-col items-center justify-center gap-3 bg-black/10 px-6 text-center">
              <img
                src={exclusiveLockImageSrc}
                alt="Legion SBT required"
                loading="eager"
                decoding="async"
                fetchPriority="high"
                width={500}
                height={500}
                className="w-32 max-w-[42%] object-contain opacity-95 drop-shadow-[0_12px_30px_rgba(0,0,0,0.45)]"
              />
              <a
                href="https://nearlegion.com/mint"
                target="_blank"
                rel="noreferrer"
                className="pointer-events-auto rounded-xl bg-background/80 px-3 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-foreground/85 backdrop-blur-sm transition-colors hover:text-[#00EC97]"
              >
                Legion SBT required
              </a>
            </div>
          </div>
        )}

        {/* Gradient overlay for text readability - only at bottom to help title stand out */}
        <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-background via-background/60 to-transparent z-[15] pointer-events-none"></div>

        {/* Price badge - top left corner */}
        {!hidePrice && (
          <div
            className={cn(
              "absolute top-3 left-3 rounded-lg border border-border/60 bg-background/60 p-2 backdrop-blur-sm z-20",
              useCompactPriceBadge ? "flex flex-col items-start gap-0.5" : "flex items-center gap-2"
            )}
          >
            <div className={cn("font-medium text-[#00EC97]", priceSize)}>
              ${displayPrice ? displayPrice.toFixed(2) : "0.00"}
            </div>
            {(() => {
              const feePct = getTotalFeePercentage(product.metadata as ProductMetadata | undefined);
              if (feePct > 0) {
                return (
                  <div className="text-xs leading-none text-foreground/60">
                    {useCompactPriceBadge ? `${feePct}% fees` : `(${feePct}% fees)`}
                  </div>
                );
              }
              return null;
            })()}
          </div>
        )}

        {/* Product info overlay on image - moved lower */}
        <div className="absolute bottom-0 left-0 right-0 pb-1 px-4 z-20 pointer-events-none">
          <Link
            to="/products/$productId"
            params={{ productId: product.slug }}
            className="block pointer-events-auto"
            resetScroll={true}
          >
            <div className="space-y-1">
              <h3
                className={cn(
                  "font-medium text-foreground truncate leading-tight transition-colors hover:text-[#00EC97] drop-shadow-lg",
                  shouldDimProduct && "text-foreground/70",
                  titleSize
                )}
              >
                {product.title}
              </h3>
              {product.collections && product.collections.length > 0 && (
                <p className="text-foreground/90 dark:text-muted-foreground text-xs uppercase tracking-wider drop-shadow-lg">
                  {product.collections[0]?.name}
                </p>
              )}
            </div>
          </Link>
        </div>

        {!hideFavorite && (
          <FavoriteButton
            isFavorite={isFavorite}
            onToggle={handleToggleFavorite}
            variant="icon"
          />
        )}

        {!hideActions && !isExpanded && canPurchase && (
          <button
            type="button"
            onClick={handleQuickAddClick}
            className="absolute bottom-3 right-3 p-2 bg-background/60 backdrop-blur-sm border border-border/60 hover:bg-background/80 hover:text-[#00EC97] transition-all z-30 rounded-lg group flex items-center gap-0 overflow-hidden"
            data-testid="quick-add-button"
            aria-label="Add to cart"
          >
            <ShoppingCart className="size-4 transition-all duration-200 flex-shrink-0 stroke-foreground group-hover:stroke-[#00EC97]" aria-hidden="true" />
            <span className="text-sm font-semibold whitespace-nowrap w-0 opacity-0 group-hover:w-auto group-hover:opacity-100 group-hover:ml-2 transition-all duration-200">
              +ADD
            </span>
          </button>
        )}

        {/* Expanded Quick Add Section - appears at bottom of image */}
        {isExpanded && !hideActions && (
          <div className="absolute bottom-3 left-3 right-3 z-30 rounded-2xl bg-background/95 backdrop-blur-sm border border-border/60 p-4 space-y-4 max-h-[60%] overflow-y-auto shadow-xl">
            {orderedColors.length > 0 && (
              <div>
                <label className="block text-xs font-medium mb-2 text-foreground/90 dark:text-foreground/90 dark:text-muted-foreground">
                  Color: {selectedColor}
                </label>
                <div className="flex flex-wrap gap-2">
                  {orderedColors.map((color) => {
                    const sampleVariant = availableVariants.find(
                      (v) => getOptionValue(v.attributes, "Color") === color
                    );
                    const apiHex = getAttributeHex(sampleVariant?.attributes, "Color");
                    const hex = apiHex || COLOR_MAP[color] || "#808080";
                    const isSelected = color === selectedColor;

                    return (
                      <button
                        key={color}
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setSelectedColor(color);
                        }}
                        className={cn(
                          "size-8 rounded-lg border transition-all p-0.5",
                          isSelected
                            ? "border-[#00EC97] ring-2 ring-[#00EC97]/30 ring-offset-1"
                            : "border-border/60 hover:border-[#00EC97]/60"
                        )}
                        title={color}
                      >
                        <div
                          className="w-full h-full rounded-md border border-black/10 dark:border-white/20"
                          style={{ backgroundColor: hex }}
                        />
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {hasSizeOptions && (
                <div>
                  <label className="block text-xs font-medium mb-2 text-foreground/90 dark:text-foreground/90 dark:text-muted-foreground">
                    Size
                  </label>
                  <div className="grid grid-cols-5 gap-2">
                    {orderedSizes.map((size) => {
                      const isAvailable = availableSizesForColor.includes(size);
                      const isSelected = isAvailable && size === effectiveSelectedSize;

                      return (
                        <button
                          key={size}
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const selection = sizeOptionSelection(
                              size,
                              availableSizesForColor,
                              selectedColor || undefined,
                            );
                            if ("error" in selection) {
                              toast.error(selection.error);
                              return;
                            }
                            setSelectedSize(selection.size);
                          }}
                          className={cn(
                            "h-8 border border-border/60 rounded-lg transition-all text-xs font-medium",
                            isSelected
                              ? "border-[#00EC97] bg-[#00EC97] text-black"
                              : "bg-background/40 text-foreground hover:bg-background/60 hover:border-[#00EC97]",
                            !isAvailable && "opacity-50 line-through"
                          )}
                        >
                          {size}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsExpanded(false);
                }}
                className="flex-1 border border-border/60 bg-background/40 text-foreground h-9 flex items-center justify-center rounded-lg text-sm font-medium hover:bg-background/60 hover:border-[#00EC97] hover:text-[#00EC97] transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddToCart}
                className="flex-1 bg-[#00EC97] text-black h-9 flex items-center justify-center rounded-lg text-sm font-medium hover:bg-[#00d97f] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                disabled={!canPurchase || (hasSizeOptions && !effectiveSelectedSize)}
              >
                Add to Cart
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="p-4 pt-0 flex-1 space-y-3 flex flex-col">
        {actionSlot}

        {children}
      </div>
    </div>
  );
}

function HorizontalProductLayout({
  product,
  className,
  hidePrice,
  priceOverride,
  actionSlot,
  children,
  imageOverride,
}: ProductCardContentProps) {
  // Use imageOverride if provided, otherwise use default logic
  const variantImages = product.images?.filter(
    (img) => img.type !== "mockup" && img.type !== "detail" && img.variantIds && img.variantIds.length > 0
  ) || [];
  
  const displayImage = imageOverride ||
    variantImages[0]?.url ||
    product.variants?.[0]?.fulfillmentConfig?.files?.[0]?.url ||
    product.images?.find((img) => img.type !== "mockup" && img.type !== "detail")?.url;
  const displayPrice = priceOverride ?? getLowestVariantPrice(product);

  return (
    <div
      className={cn(
        "group relative bg-transparent border-transparent overflow-hidden flex items-start gap-4 p-4",
        className
      )}
      data-testid="cart-item"
    >
      <div className="relative bg-muted overflow-hidden shrink-0 size-20 rounded-md">
        <div className="absolute inset-0 bg-gradient-to-b from-background/5 via-background/20 to-background/60 dark:from-background/5 dark:via-background/30 dark:to-background/80 z-0"></div>
        <Link
          to="/products/$productId"
          params={{ productId: product.slug }}
          preload="intent"
          preloadDelay={0}
          className="block w-full h-full relative z-10"
          resetScroll={true}
        >
          {displayImage ? (
            <img
              src={displayImage}
              alt={product.title}
              loading="lazy"
              decoding="async"
              width={80}
              height={80}
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105 relative z-10"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-foreground/90 dark:text-muted-foreground bg-muted relative z-10">
              No Image
            </div>
          )}
        </Link>
      </div>

      <div className="flex-1 min-w-0 justify-between h-full py-0.5 flex flex-col">
        <div className="flex justify-between items-start gap-2">
          <div className="min-w-0">
            <Link
              to="/products/$productId"
              params={{ productId: product.slug }}
              className="block"
              resetScroll={true}
            >
              <h3 className="font-medium text-foreground leading-tight transition-colors hover:text-primary text-base">
                {product.title}
              </h3>
            </Link>
            {product.collections && product.collections.length > 0 && (
              <p className="text-foreground/90 dark:text-muted-foreground text-xs uppercase tracking-wider mt-1">
                {product.collections[0]?.name}
              </p>
            )}
          </div>

          {actionSlot}
        </div>

        {children}

        {!hidePrice && (
          <div className="mt-2 flex items-end justify-between">
            <div className="font-medium text-foreground text-sm">
              ${displayPrice ? displayPrice.toFixed(2) : "0.00"}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
