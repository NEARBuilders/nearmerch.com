import { LoadingSpinner } from "@/components/loading";
import { FavoriteButton } from "@/components/marketplace/favorite-button";
import { ImageViewer } from "@/components/marketplace/image-viewer";
import { ProductCard } from "@/components/marketplace/product-card";
import { ProductDetails } from "@/components/marketplace/product-details";
import { Button } from "@/components/ui/button";
import { useCart } from "@/hooks/use-cart";
import { useFavorites } from "@/hooks/use-favorites";
import { useNearPrice } from "@/hooks/use-near-price";
import { useCartSidebarStore } from "@/stores/cart-sidebar-store";
import {
  getReferralConfig,
  getPurchaseGatePluginId,
  requiresSize,
  useProducts,
  usePurchaseGateAccess,
  type ProductImage,
  type ProductMetadata,
} from "@/integrations/api";
import {
  COLOR_MAP,
  getAttributeHex,
  getOptionValue,
  getVariantImageUrl,
} from "@/lib/product-utils";
import {
  absoluteUrl,
  buildProductDescription,
  buildProductJsonLd,
  createSeoHead,
  getProductSeoImage,
  SITE_NAME,
} from "@/lib/seo";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { captureEvent } from "@/lib/posthog";
import { apiClient } from "@/utils/orpc";
import { useNearAccountId } from "@/hooks/use-near-account-id";
import { toast } from "sonner";
import { createFileRoute, Link, useRouter, useCanGoBack } from "@tanstack/react-router";
import {
  AlertCircle,
  ArrowLeft,
  Award,
  ChevronLeft,
  ChevronRight,
  Download,
  Minus,
  Plus,
  Lock,
  Info,
  Share2,
} from "lucide-react";
import { useState, useMemo, useEffect, useRef } from "react";

function normalizeNearAccountId(value?: string | null): string | undefined {
  const trimmed = value?.trim().toLowerCase();

  if (!trimmed) {
    return undefined;
  }

  const firstToken = trimmed.split(/\s+/)[0];
  const cleaned = firstToken?.replace(/[^a-z0-9._-]/g, "");

  return cleaned || undefined;
}

function getTotalFeePercentage(metadata: ProductMetadata | undefined): number {
  if (!metadata?.fees?.length) return 0;
  const totalBps = metadata.fees.reduce((sum: number, fee: ProductMetadata["fees"][number]) => sum + fee.bps, 0);
  return totalBps / 100;
}

function formatFeeType(type: string): string {
  switch (type) {
    case "royalty": return "Creator Royalty";
    case "affiliate": return "Affiliate";
    case "platform": return "Platform Fee";
    case "custom": return "Custom";
    default: return type;
  }
}

export const Route = createFileRoute("/_marketplace/products/$productId")({
  pendingComponent: LoadingSpinner,
  loader: async ({ params, context }) => {
    const siteUrl = context.runtimeConfig?.hostUrl ?? '';
    const assetsUrl = context.assetsUrl ?? '';

    try {
      const data = await apiClient.getProduct({ id: params.productId });
      return { data: { product: data.product }, siteUrl, assetsUrl };
    } catch (error) {
      return { error: error as Error, data: null, siteUrl, assetsUrl };
    }
  },
  head: ({ loaderData }) => {
    const product = loaderData?.data?.product;
    const siteUrl = loaderData?.siteUrl ?? '';
    const assetsUrl = loaderData?.assetsUrl ?? '';
    const fallbackImage = assetsUrl ? absoluteUrl(assetsUrl, '/metadata.png') : undefined;

    if (!product) {
      return createSeoHead({
        title: SITE_NAME,
        description: "Shop official NEAR Protocol merchandise, apparel, accessories, and collectibles",
        image: fallbackImage,
        robots: 'noindex, nofollow',
      });
    }

    const title = `${product.title} | ${SITE_NAME}`;
    const description = buildProductDescription(product);
    const url = siteUrl ? absoluteUrl(siteUrl, `/products/${product.slug}`) : undefined;
    const productImage = getProductSeoImage(product) || fallbackImage;

    return createSeoHead({
      title,
      description,
      url,
      image: productImage,
      imageAlt: productImage ? `${product.title} product image` : undefined,
      type: "product",
      jsonLd: url ? buildProductJsonLd(product, url, productImage) : null,
    });
  },
  errorComponent: ({ error }) => {
    const router = useRouter();

    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md text-center space-y-4">
          <div className="text-destructive">
            <AlertCircle className="h-12 w-12 mx-auto mb-4" />
            <h2 className="text-xl font-semibold">Unable to Load Product</h2>
          </div>
          <p className="text-muted-foreground">
            {error.message ||
              "Failed to load product details. Please check your connection and try again."}
          </p>
          <div className="flex gap-3 justify-center">
            <Button onClick={() => router.invalidate()}>Try Again</Button>
            <Button
              variant="outline"
              onClick={() => router.navigate({ to: "/" })}
            >
              Go Home
            </Button>
          </div>
        </div>
      </div>
    );
  },
  component: ProductDetailPage,
});

function ProductDetailPage() {
  const router = useRouter();
  const canGoBack = useCanGoBack();
  const { addToCart } = useCart();
  const { favoriteIds, toggleFavorite } = useFavorites();
  const { nearPrice, isLoading: isLoadingNearPrice } = useNearPrice();
  const openCartSidebar = useCartSidebarStore((state) => state.open);

  const loaderData = Route.useLoaderData();

  if (loaderData.error || !loaderData.data) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md text-center space-y-4">
          <div className="text-destructive">
            <AlertCircle className="h-12 w-12 mx-auto mb-4" />
            <h2 className="text-xl font-semibold">Unable to Load Product</h2>
          </div>
          <p className="text-muted-foreground">
            {loaderData.error?.message ||
              "Failed to load product details. Please check your connection and try again."}
          </p>
          <div className="flex gap-3 justify-center">
            <Button onClick={() => window.location.reload()}>Try Again</Button>
            <Link to="/">
              <Button variant="outline">Go Home</Button>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const { product } = loaderData.data;

  const nearAccountId = useNearAccountId();
  const ref =
    typeof window === "undefined"
      ? undefined
      : new URLSearchParams(window.location.search).get("ref");
  const metadata = product.metadata as ProductMetadata | undefined;
  const freeDownload = metadata?.downloads?.find(
    (download) => download.kind === "free" || !download.kind
  );
  const referralConfig = getReferralConfig(metadata);
  const normalizedNearAccountId = normalizeNearAccountId(nearAccountId);
  const normalizedRefAccountId = normalizeNearAccountId(ref);
  const activeReferralAccountId =
    referralConfig &&
    normalizedRefAccountId &&
    normalizedRefAccountId !== normalizedNearAccountId
      ? normalizedRefAccountId
      : undefined;
  const shareReferralUrl = useMemo(() => {
    if (typeof window === "undefined" || !referralConfig || !normalizedNearAccountId) {
      return null;
    }

    const url = new URL(`/products/${product.slug}`, window.location.origin);
    url.searchParams.set("ref", normalizedNearAccountId);
    return url.toString();
  }, [normalizedNearAccountId, product.slug, referralConfig]);

  const purchaseGatePluginId = getPurchaseGatePluginId(
    metadata,
  );
  const isGatedProduct = Boolean(purchaseGatePluginId);
  const {
    hasAccess: canPurchase,
    isLoading: isAccessLoading,
  } = usePurchaseGateAccess(purchaseGatePluginId, nearAccountId);

  const availableVariants = product.variants || [];
  const hasVariants = availableVariants.length > 0;

  const sizeOption = product.options?.find((opt) => opt.name === "Size");
  const colorOption = product.options?.find((opt) => opt.name === "Color");

  const orderedSizes = sizeOption?.values || [];
  const orderedColors = colorOption?.values || [];

  const defaultColor = orderedColors[0] || "";
  const defaultSize = orderedSizes.includes("M") ? "M" : orderedSizes[0] || "";

  const [selectedColor, setSelectedColor] = useState<string>(defaultColor);
  const [selectedSize, setSelectedSize] = useState<string>(defaultSize);

  const selectedVariant = availableVariants.find((v) => {
    const vSize = getOptionValue(v.attributes, "Size");
    const vColor = getOptionValue(v.attributes, "Color");
    const colorMatch = orderedColors.length === 0 || vColor === selectedColor;
    const sizeMatch = orderedSizes.length === 0 || vSize === selectedSize;
    return colorMatch && sizeMatch;
  }) || availableVariants[0];

  const displayPrice = selectedVariant?.price || product.price;
  const selectedVariantId = selectedVariant?.id;

  const availableSizesForColor = orderedSizes.filter((size) => {
    return availableVariants.some((v) => {
      const vSize = getOptionValue(v.attributes, "Size");
      const vColor = getOptionValue(v.attributes, "Color");
      const colorMatches = orderedColors.length === 0 || vColor === selectedColor;

      return vSize === size && colorMatches && v.availableForSale;
    });
  });

  const [quantity, setQuantity] = useState(1);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerImageIndex, setViewerImageIndex] = useState(0);
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [isManualImageSelection, setIsManualImageSelection] = useState(false);
  
  // Track previous color/size to detect actual changes (not initial mount)
  const prevColorSizeRef = useRef<{ color: string; size: string } | null>(null);
  const isInitialMountRef = useRef(true);

  const { data: relatedData } = useProducts({
    collectionSlugs: product.collections?.map((c) => c.slug) ?? [],
    limit: 4,
  });
  const relatedProducts = (relatedData?.products ?? [])
    .filter((p) => p.id !== product.id)
    .slice(0, 3);

  // Determine display images (filter out 'detail' type/blueprints and 'mockup' type)
  // Keep a STABLE order - don't reorder when variant changes
  // Use only variant images (images with variantIds)
  const validImages = useMemo(
    () => product.images.filter(
      (img: ProductImage) => 
        img.type !== "detail" && 
        img.type !== "mockup" &&
        img.variantIds && 
        img.variantIds.length > 0
    ),
    [product.images]
  );

  // Get stable image URLs array - maintain original order
  const productImages = useMemo(
    () => validImages.map((img: ProductImage) => img.url),
    [validImages]
  );

  // Find variant-specific image for the selected variant
  const variantImage = useMemo(
    () =>
      validImages.find((img: ProductImage) =>
        img.variantIds?.includes(selectedVariantId || "")
      ),
    [validImages, selectedVariantId]
  );

  const handleShareReferral = async () => {
    if (!referralConfig) {
      return;
    }

    if (!shareReferralUrl) {
      toast.error("Sign in with your NEAR account to share this product");
      return;
    }

    try {
      if (navigator.share) {
        await navigator.share({
          url: shareReferralUrl,
        });
        toast.success("Referral link shared");
      } else {
        await navigator.clipboard.writeText(shareReferralUrl);
        toast.success("Referral link copied");
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        return;
      }

      toast.error("Unable to share referral link");
    }
  };

  // Reset image index when product changes
  useEffect(() => {
    setSelectedColor(defaultColor);
    setSelectedSize(defaultSize);
    setCurrentImageIndex(0);
    setIsManualImageSelection(false);
    isInitialMountRef.current = true;
    prevColorSizeRef.current = null;
  }, [defaultColor, defaultSize, product.id]);

  // When color/variant changes via color picker (not thumbnail click), update main image
  useEffect(() => {
    // Skip on initial mount - always start with first image
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      prevColorSizeRef.current = { color: selectedColor, size: selectedSize };
      return;
    }

    // Only auto-update if:
    // 1. User didn't manually select an image via thumbnail
    // 2. Color or size actually changed (not just a re-render)
    const colorSizeChanged = 
      prevColorSizeRef.current === null ||
      prevColorSizeRef.current.color !== selectedColor ||
      prevColorSizeRef.current.size !== selectedSize;

    if (!isManualImageSelection && variantImage && colorSizeChanged) {
      const variantImageIndex = validImages.findIndex(
        (img) => img.id === variantImage.id
      );
      if (variantImageIndex !== -1 && variantImageIndex !== currentImageIndex) {
        setCurrentImageIndex(variantImageIndex);
      }
    }

    // Update ref for next comparison
    prevColorSizeRef.current = { color: selectedColor, size: selectedSize };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedColor, selectedSize, variantImage, isManualImageSelection]);

  // Reset manual selection flag after color/size changes settle
  useEffect(() => {
    if (isManualImageSelection) {
      const timer = setTimeout(() => setIsManualImageSelection(false), 150);
      return () => clearTimeout(timer);
    }
  }, [isManualImageSelection]);

  // Favorites should track the MAIN product
  const isFavorite = favoriteIds.includes(product.id);

  const needsSize =
    requiresSize(product.collections) && hasVariants && orderedSizes.length > 0;

  const handleAddToCart = () => {
    if (!selectedVariant || !canPurchase) return;
    const variantImageUrl = selectedVariantId ? getVariantImageUrl(product, selectedVariantId) : undefined;
    for (let i = 0; i < quantity; i++) {
      addToCart(
        product.slug,
        selectedVariantId || '',
        selectedSize,
        selectedColor,
        variantImageUrl,
        activeReferralAccountId,
      );
    }
    captureEvent('add_to_cart', {
      product_id: product.id,
      product_slug: product.slug,
      product_title: product.title,
      variant_id: selectedVariantId,
      price: displayPrice,
      quantity,
    });
    openCartSidebar();
  };

  const handleDownload = () => {
    captureEvent('download', {
      product_id: product.id,
      product_slug: product.slug,
      product_title: product.title,
      download_kind: freeDownload?.kind || 'free',
    });
  };

  const handleImageClick = (index: number) => {
    setViewerImageIndex(index);
    setViewerOpen(true);
  };

  return (
    <div className="bg-background w-full min-h-screen pt-32">
      {viewerOpen && (
        <ImageViewer
          images={productImages}
          initialIndex={viewerImageIndex}
          onClose={() => setViewerOpen(false)}
          productName={product.title}
        />
      )}

      <div className="container-app mx-auto px-4 md:px-8 lg:px-16 mb-8">
        {/* Back and Title Blocks */}
        <div className="flex flex-row gap-4 mb-8">
          {/* Back Block */}
          <button
            onClick={() => {
              if (canGoBack) {
                router.history.back();
              } else {
                router.navigate({ to: "/" });
              }
            }}
            className="rounded-2xl border border-border/60 px-4 md:px-8 lg:px-10 py-4 md:py-8 flex items-center justify-center hover:border-[#00EC97] hover:text-[#00EC97] transition-colors shrink-0"
          >
            <ArrowLeft className="size-5" />
          </button>

          {/* Title Block */}
          <div className="flex-1 rounded-2xl bg-background/60 backdrop-blur-sm border border-border/60 px-4 md:px-8 lg:px-10 py-4 md:py-8">
            <div className="flex items-center justify-end gap-3">
              {isGatedProduct && (
                <div className="h-[40px] flex items-center justify-center bg-muted/30 px-3 py-2 text-xs font-semibold tracking-[0.16em] uppercase text-muted-foreground border border-border/40 w-fit dark:bg-[#00EC97]/10 dark:text-[#00EC97] dark:border-[#00EC97]/60 rounded-lg">
                  LEGION GATED
                </div>
              )}
              {referralConfig && (
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleShareReferral}
                    className="h-[40px] rounded-lg border-border/60 bg-background/40 px-3 text-xs font-semibold uppercase tracking-[0.16em]"
                  >
                    <Share2 className="mr-2 size-4" />
                    Share
                  </Button>
                  {referralConfig.feeBps && referralConfig.feeBps > 0 && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="h-[40px] flex items-center gap-1.5 rounded-lg border border-[#00EC97]/40 bg-[#00EC97]/10 px-3 text-xs font-semibold text-[#00EC97] cursor-default">
                            <Award className="size-4 shrink-0" />
                            <span>{referralConfig.feeBps / 100}% referral</span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent
                          side="bottom"
                          align="end"
                          sideOffset={8}
                          className="max-w-72 rounded-lg border border-[#00EC97]/30 bg-background/95 backdrop-blur-md p-3 text-xs text-foreground/80 shadow-lg"
                        >
                          <p>
                            Half of this fee goes to your wallet, half goes towards a NEAR buy back.{" "}
                            <a
                              href="https://docs.near-intents.org/integration/distribution-channels/1click-api/fee-config"
                              target="_blank"
                              rel="noreferrer"
                              className="text-[#00EC97] underline underline-offset-2 hover:text-[#00d97f]"
                            >
                              Learn more
                            </a>
                          </p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}
                </div>
              )}
              <FavoriteButton
                isFavorite={isFavorite}
                onToggle={() => toggleFavorite(product.id, product.title)}
                variant="button"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="container-app mx-auto px-4 md:px-8 lg:px-16 pb-12">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-12">
          {/* Image Block */}
          <div className="rounded-2xl bg-background/60 backdrop-blur-sm border border-border/60 p-4 md:p-6">
          <div className="w-full space-y-4">
            {/* Title - Mobile only, inside image block */}
            <div className="lg:hidden">
              <h1 className="text-xl md:text-2xl font-bold tracking-tight text-foreground/90 dark:text-muted-foreground">
                {product.title}
              </h1>
            </div>
              <div className="relative w-full aspect-square rounded-lg overflow-hidden">
              <div className="absolute inset-0 bg-gradient-to-b from-background/10 via-background/40 to-background/90 dark:from-background/10 dark:via-background/60 dark:to-background z-0"></div>
              {productImages.map((img, index) => (
                <div
                  key={index}
                  className={cn(
                    "absolute inset-0 transition-opacity duration-500 cursor-pointer z-10",
                    index === currentImageIndex ? "opacity-100" : "opacity-0"
                  )}
                  onClick={() => handleImageClick(currentImageIndex)}
                >
                  <img
                    src={img}
                    alt={`${product.title} - Image ${index + 1}`}
                    loading={index === currentImageIndex ? "eager" : "lazy"}
                    decoding="async"
                    className="w-full h-full object-cover relative z-10"
                  />
                </div>
              ))}

              {productImages.length > 1 && (
                <div className="absolute bottom-4 right-4 flex items-center gap-2 z-10">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsManualImageSelection(true);
                      setCurrentImageIndex(
                        (prev) =>
                          (prev - 1 + productImages.length) %
                          productImages.length
                      );
                    }}
                    className="flex items-center justify-center w-10 h-10 rounded-lg border border-border/60 bg-background/60 backdrop-blur-sm hover:bg-[#00EC97] hover:border-[#00EC97] hover:text-black transition-all duration-200 text-foreground/80"
                    aria-label="Previous image"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsManualImageSelection(true);
                      setCurrentImageIndex(
                        (prev) => (prev + 1) % productImages.length
                      );
                    }}
                    className="flex items-center justify-center w-10 h-10 rounded-lg border border-border/60 bg-background/60 backdrop-blur-sm hover:bg-[#00EC97] hover:border-[#00EC97] hover:text-black transition-all duration-200 text-foreground/80"
                    aria-label="Next image"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </div>
              )}

              {productImages.length > 1 && (
                <div className="absolute bottom-4 left-4 px-3 py-1.5 rounded-lg bg-background/60 backdrop-blur-sm border border-border/60 text-foreground/90 dark:text-muted-foreground text-sm z-10">
                  {currentImageIndex + 1} / {productImages.length}
                </div>
              )}
            </div>

            {productImages.length > 1 && (
              <div className="flex gap-2 overflow-x-auto pb-2">
                {productImages.map((img, index) => {
                  // Use stable validImages array, not sortedImages
                  const imageObj = validImages[index];
                  
                  return (
                    <button
                      key={`${imageObj?.id || index}-${img}`}
                      onClick={() => {
                        setIsManualImageSelection(true);
                        setCurrentImageIndex(index);
                        
                        // Update color if this image is associated with a variant
                        // Proper matching: Image → Variant(s) → Color (considering current Size)
                        if (imageObj?.variantIds?.length) {
                          // Find variants that match this image
                          const matchingVariants = availableVariants.filter(
                            (v) => imageObj.variantIds?.includes(v.id)
                          );
                          
                          if (matchingVariants.length > 0) {
                            // Prefer variant that matches current size, otherwise use first match
                            const preferredVariant = matchingVariants.find((v) => {
                              const vSize = getOptionValue(v.attributes, "Size");
                              return vSize === selectedSize;
                            }) || matchingVariants[0];
                            
                            const variantColor = getOptionValue(preferredVariant.attributes, "Color");
                            if (variantColor && orderedColors.includes(variantColor)) {
                              setSelectedColor(variantColor);
                            }
                          }
                        }
                      }}
                      className={cn(
                        "flex-shrink-0 w-20 h-20 rounded-lg overflow-hidden border-2 transition-all",
                        index === currentImageIndex
                            ? "border-[#00EC97]"
                            : "border-border/60 hover:border-[#00EC97]/60 opacity-60 hover:opacity-100"
                      )}
                    >
                      <img
                        src={img}
                        alt={`${product.title} - Thumbnail ${index + 1}`}
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-cover"
                      />
                    </button>
                  );
                })}
              </div>
            )}
            </div>
          </div>

          <div className="space-y-6">
            {/* Title Block - Desktop only */}
            <div className="hidden lg:block rounded-2xl bg-background/60 backdrop-blur-sm border border-border/60 px-4 md:px-6 py-4 md:py-5">
              <div className="space-y-2">
                <h1 className="text-xl md:text-2xl font-bold tracking-tight text-foreground/90 dark:text-muted-foreground">
                  {product.title}
                </h1>
              </div>
            </div>

            {/* Product Info Block */}
            <div className="rounded-2xl bg-background/60 backdrop-blur-sm border border-border/60 px-6 md:px-8 lg:px-10 py-6 md:py-8 space-y-8">
            {/* Price */}
            <div className="flex items-baseline gap-4 flex-wrap">
              <div className="flex items-baseline gap-2">
                <span className="text-3xl md:text-4xl font-bold text-foreground dark:text-foreground">
                  ${displayPrice}
                </span>
                <span className="text-sm text-foreground/80 dark:text-muted-foreground/60 font-normal">
                  USD
                </span>
              </div>
              {nearPrice && (
                <>
                  <span className="text-foreground/60 dark:text-muted-foreground/30">•</span>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl md:text-4xl font-bold text-[#00EC97]">
                      {isLoadingNearPrice ? '...' : (displayPrice / nearPrice).toFixed(2)}
                    </span>
                    <span className="text-sm text-[#00EC97]/80 font-normal">
                      NEAR
                    </span>
                  </div>
                </>
              )}
            </div>

            {/* Fee Distribution */}
            {(() => {
              const feePct = getTotalFeePercentage(product.metadata as ProductMetadata | undefined);
              const fees = (product.metadata as ProductMetadata | undefined)?.fees || [];
              const providerDetails = (product.metadata as ProductMetadata | undefined)?.providerDetails;
              
              if (feePct === 0 && !providerDetails?.printful) return null;
              
              return (
                <div className="rounded-lg bg-background/40 border border-border/40 p-4 space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-foreground/80">
                    <Info className="size-4" />
                    <span>Price includes {feePct}% creator fees</span>
                  </div>
                  {fees.length > 0 && (
                    <div className="text-xs text-foreground/60 space-y-1">
                      {fees.map((fee: ProductMetadata["fees"][number], idx: number) => (
                        <div key={idx} className="flex justify-between">
                          <span>{formatFeeType(fee.type)} ({fee.label})</span>
                          <span>{fee.bps / 100}%</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {providerDetails?.printful && (
                    <div className="text-xs text-foreground/50 pt-2 border-t border-border/30">
                      {providerDetails.printful.brand && <span>Brand: {providerDetails.printful.brand}</span>}
                      {providerDetails.printful.model && <span className="ml-2">Model: {providerDetails.printful.model}</span>}
                      {providerDetails.printful.gsm && <span className="ml-2">{providerDetails.printful.gsm} g/m²</span>}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Description */}
            {product.description && (
              <div className="space-y-2">
                <p className="text-base md:text-lg text-foreground/90 dark:text-muted-foreground leading-relaxed">
                {product.description}
              </p>
              </div>
            )}

            {/* Separator */}
            <div className="h-px bg-border/60" />

            {/* Options Section */}
            <div className="space-y-6">
              {/* Color Selection */}
            {orderedColors.length > 0 && (
              <div className="space-y-3">
                  <label className="block text-sm font-semibold tracking-[-0.48px] text-foreground/90 dark:text-muted-foreground uppercase">
                    Color
                  </label>
                  <div className="flex flex-wrap gap-3">
                  {orderedColors.map((color) => {
                    const sampleVariant = availableVariants.find(
                      (v) => getOptionValue(v.attributes, "Color") === color
                    );
                    const apiHex = getAttributeHex(
                      sampleVariant?.attributes,
                      "Color"
                    );

                    const hex = apiHex || COLOR_MAP[color] || "#808080";
                    const isSelected = color === selectedColor;

                    return (
                      <button
                        key={color}
                        onClick={() => {
                          setIsManualImageSelection(false);
                          setSelectedColor(color);
                        }}
                        className={cn(
                            "size-10 rounded-lg border-2 transition-colors overflow-hidden",
                          isSelected
                              ? "border-[#00EC97]"
                              : "border-border/60 hover:border-[#00EC97]/60"
                        )}
                        title={color}
                          style={{ backgroundColor: hex }}
                        />
                    );
                  })}
                </div>
              </div>
            )}

              {/* Size Selection */}
            {hasVariants && orderedSizes.length > 0 && !(orderedSizes.length === 1 && orderedSizes[0] === "One size") && (
              <div className="space-y-3 min-h-[80px]">
                  <label className="block text-sm font-semibold tracking-[-0.48px] text-foreground/90 dark:text-muted-foreground uppercase">
                    Size
                  </label>
                <div className="flex flex-wrap gap-2">
                  {orderedSizes.map((size) => {
                    const isAvailable = availableSizesForColor.includes(size);

                    return (
                      <button
                        key={size}
                        onClick={() => setSelectedSize(size)}
                        disabled={!isAvailable}
                        className={cn(
                            "px-5 py-2.5 tracking-[-0.48px] transition-all rounded-lg font-medium text-sm border-2",
                          size === selectedSize
                              ? "bg-[#00EC97] text-black border-[#00EC97]"
                              : "bg-background/40 border-border/60 hover:border-[#00EC97] hover:text-[#00EC97] hover:bg-background/60",
                          !isAvailable &&
                            "opacity-50 cursor-not-allowed line-through"
                        )}
                      >
                        {size}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

              {/* Quantity Selection */}
            <div className="space-y-3">
                <label className="block text-sm font-semibold tracking-[-0.48px] text-foreground/90 dark:text-muted-foreground uppercase">
                  Quantity
                </label>
                <div className="flex items-center gap-3 border border-border/60 rounded-lg w-fit px-2 py-1.5 bg-background/40">
                <button
                  onClick={() => setQuantity(Math.max(1, quantity - 1))}
                    className="p-2 hover:bg-background/60 hover:text-[#00EC97] rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  disabled={quantity <= 1}
                    aria-label="Decrease quantity"
                >
                  <Minus className="size-4" />
                </button>
                  <span className="tracking-tight min-w-[3ch] text-center text-base font-semibold text-foreground dark:text-foreground">
                  {quantity}
                </span>
                <button
                  onClick={() => setQuantity(quantity + 1)}
                    className="p-2 hover:bg-background/60 hover:text-[#00EC97] rounded-lg transition-colors"
                    aria-label="Increase quantity"
                >
                  <Plus className="size-4" />
                </button>
                </div>
              </div>
            </div>

            {/* Add to Cart Button */}
            <div className="pt-2">
              {freeDownload && (
                <Button
                  asChild
                  variant="outline"
                  className="mb-3 w-full rounded-lg h-14 border-[#00EC97]/40 bg-[#00EC97]/10 text-base font-bold text-[#00EC97] hover:border-[#00EC97] hover:bg-[#00EC97]/12"
                >
                  <a href={freeDownload.url} target="_blank" rel="noreferrer" onClick={handleDownload}>
                    <Download className="size-5" />
                    {freeDownload.label || "Download for Free"}
                  </a>
                </Button>
              )}
              {isGatedProduct && !canPurchase ? (
              <div className="space-y-2">
                <Button
                  className="w-full bg-muted text-muted-foreground rounded-lg h-14 text-base font-bold cursor-not-allowed"
                  disabled
                >
                  <Lock className="size-5 mr-2" />
                  Legion Holder Required
                </Button>
                <p className="text-xs text-center text-muted-foreground">
                  {!nearAccountId 
                    ? "Sign in with your NEAR account to unlock this item"
                    : "Your account does not hold the required Legion NFT"}
                </p>
              </div>
            ) : (
              <Button
                onClick={handleAddToCart}
                className="w-full rounded-lg h-14 bg-[#00EC97] text-base font-bold text-black transition-colors hover:bg-[#00d97f]"
                disabled={(needsSize && !selectedVariant) || isAccessLoading}
              >
                {isAccessLoading ? "Checking access..." : `Add to Cart - $${(displayPrice * quantity).toFixed(2)}`}
              </Button>
            )}
            </div>
            </div>
          </div>
        </div>

        <ProductDetails
          provider={product.fulfillmentProvider}
          providerDetails={metadata?.providerDetails}
          className="mt-8"
        />

        {relatedProducts.length > 0 && (
          <div className="mt-16 space-y-6">
            {/* Title Block */}
            <div className="rounded-2xl bg-background/60 backdrop-blur-sm border border-border/60 px-6 md:px-8 lg:px-10 py-6 md:py-8">
              <div className="flex flex-row items-center justify-between gap-4">
                <div className="space-y-2 flex-1 min-w-0">
                  <h2 className="text-xl md:text-2xl font-medium tracking-tight text-foreground/90 dark:text-muted-foreground">
                You Might Also Like
              </h2>
                </div>
                <Link to="/products" search={() => ({ category: "", categoryId: undefined, collection: undefined })} className="shrink-0">
                  <Button className="bg-[#00EC97] text-black hover:bg-[#00d97f] rounded-lg h-14 text-base font-bold whitespace-nowrap">
                    All Products
                  </Button>
                </Link>
              </div>
            </div>

            {/* Products Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {relatedProducts.map((relatedProduct) => (
                <ProductCard
                  key={relatedProduct.id}
                  product={relatedProduct}
                  variant="sm"
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
