import { PageTransition } from "@/components/page-transition";
import { MarketplaceSkeletonLoader } from "@/components/marketplace-skeleton-loader";
import { VideoBackground } from "@/components/video-background";
import { CartSidebar } from "@/components/marketplace/cart-sidebar";
import { useCartSidebarStore } from "@/stores/cart-sidebar-store";
import { ProductCard } from "@/components/marketplace/product-card";
import { SizeSelectionModal } from "@/components/marketplace/size-selection-modal";
import { useCart } from "@/hooks/use-cart";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { absoluteUrl, createSeoHead, SITE_NAME } from "@/lib/seo";
import { getLowestVariantPrice } from "@/lib/product-price";
import {
  productLoaders,
  useFeaturedProducts,
  useProducts,
  useProductTypes,
  useCarouselCollections,
  useSubscribeNewsletter,
  collectionLoaders,
  type Product
} from "@/integrations/api";
import {
  createFileRoute,
  Link,
} from "@tanstack/react-router";
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Square,
  Grid3x3,
} from "lucide-react";
import { useEffect, useRef, useState, useMemo } from "react";

export const Route = createFileRoute("/_marketplace/")({
  loader: async ({ context }) => {
    const queryClient = context.queryClient;
    await Promise.all([
      queryClient.ensureQueryData(productLoaders.featured(6)),
      queryClient.ensureQueryData(productLoaders.list({ limit: 100 })),
      queryClient.ensureQueryData(collectionLoaders.carousel()),
    ]).catch((error) => {
      const errorCode = error?.response?.data?.code || error?.code;
      const isExpected = errorCode === 'NOT_FOUND' || errorCode === 404;
      if (!isExpected) {
        console.warn('Failed to prefetch:', error);
      }
    });

    return {
      siteUrl: context.runtimeConfig?.hostUrl ?? "",
    };
  },
  head: ({ loaderData }) => {
    const siteUrl = loaderData?.siteUrl ?? "";
    const title = SITE_NAME;
    const description = "Shop official NEAR Protocol merchandise, apparel, accessories, and collectibles for the ecosystem.";

    return createSeoHead({
      title,
      description,
      url: siteUrl ? absoluteUrl(siteUrl, '/') : undefined,
    });
  },
  component: MarketplaceHome,
});

function MarketplaceHome() {
  const { addToCart } = useCart();

  const [currentSlide, setCurrentSlide] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);

  const [sizeModalProduct, setSizeModalProduct] = useState<Product | null>(
    null
  );
  const isCartSidebarOpen = useCartSidebarStore((state) => state.isOpen);
  const closeCartSidebar = useCartSidebarStore((state) => state.close);
  const openCartSidebar = useCartSidebarStore((state) => state.open);
  const [newsletterEmail, setNewsletterEmail] = useState("");
  const subscribeNewsletter = useSubscribeNewsletter();
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const normalizedNewsletterEmail = newsletterEmail.trim();
  const isNewsletterEmailValid = useMemo(() => {
    if (!normalizedNewsletterEmail) return false;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedNewsletterEmail);
  }, [normalizedNewsletterEmail]);

  const { data: featuredData } = useFeaturedProducts(6);
  const featuredProducts = featuredData?.products ?? [];

  const { data: productTypesData } = useProductTypes();
  const productTypes = productTypesData?.productTypes ?? [];

  const { data: carouselData, isLoading: isCollectionsLoading } = useCarouselCollections();
  const collections = carouselData?.collections ?? [];

  const [selectedProductCategory, setSelectedProductCategory] = useState<string>('all');
  const [viewMode, setViewMode] = useState<'single' | 'grid'>('single');
  
  const productTypeCategoriesForFilter = useMemo(() => [
    { key: 'all', label: 'All' },
    ...productTypes.map((pt) => ({ key: pt.slug, label: pt.label }))
  ], [productTypes]);

 const { data: allProductsData } = useProducts({ limit: 100 });
  const allProducts = allProductsData?.products || [];

  const handleQuickAdd = (product: Product) => {
    setSizeModalProduct(product);
  };

  const handleAddToCartFromModal = (productId: string, variantId: string, size: string, color: string, imageUrl?: string) => {
    addToCart(productId, variantId, size, color, imageUrl);
    setSizeModalProduct(null);
    openCartSidebar();
  };

  const filteredProducts = useMemo(() => {
    if (selectedProductCategory === 'all') {
      return allProducts;
    }
    return allProducts.filter((product: Product) => {
      return product.productType?.slug === selectedProductCategory;
    });
  }, [allProducts, selectedProductCategory]);
  
  const displayProducts = useMemo(() => {
    if (filteredProducts.length >= 3 || selectedProductCategory === 'all') {
      return filteredProducts.slice(0, 3);
    }
    
    const additionalProducts = allProducts.filter((product: Product) => {
      return product.productType?.slug === selectedProductCategory && 
             !filteredProducts.some((p: Product) => p.id === product.id);
    }).slice(0, 3 - filteredProducts.length);
    
    return [...filteredProducts, ...additionalProducts].slice(0, 3);
  }, [filteredProducts, allProducts, selectedProductCategory]);

  const slides = useMemo(() => {
    const glowColors = ["#00ec97", "#0066ff", "#ff6b6b", "#ffd93d", "#6c5ce7", "#00b894"];
    
    return collections.slice(0, 4).map((collection: any, index: number) => ({
      badge: collection.badge || "COLLECTION",
      title: (collection.carouselTitle || collection.name).split(' ').slice(0, 3).join(' ').toUpperCase(),
      subtitle: (collection.carouselTitle || collection.name).split(' ').slice(3).join(' ').toUpperCase() || "COLLECTION",
      description: collection.carouselDescription || collection.description || `Discover ${collection.name} in the NEAR merch store`,
      buttonText: "View Collection",
      image: collection.featuredProduct?.thumbnailImage || null,
      gradientFrom: "#012216",
      gradientTo: glowColors[index % glowColors.length],
      glowColor: glowColors[index % glowColors.length],
      collection: collection,
    }));
  }, [collections]);

  const nextSlide = () => {
    if (!isAnimating && slides.length > 0) {
      setIsAnimating(true);
      setTimeout(() => {
        setCurrentSlide((prev) => (prev + 1) % slides.length);
        setTimeout(() => setIsAnimating(false), 100);
      }, 50);
    }
  };

  const prevSlide = () => {
    if (!isAnimating && slides.length > 0) {
      setIsAnimating(true);
      setTimeout(() => {
        setCurrentSlide((prev) => (prev - 1 + slides.length) % slides.length);
        setTimeout(() => setIsAnimating(false), 100);
      }, 50);
    }
  };

  useEffect(() => {
    if (slides.length > 0 && currentSlide >= slides.length) {
      setCurrentSlide(0);
    }
  }, [slides.length, currentSlide]);

  useEffect(() => {
    if (!isPaused) {
      intervalRef.current = setInterval(() => {
        nextSlide();
      }, 3000);
    } else if (intervalRef.current) {
        clearInterval(intervalRef.current);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [isPaused, currentSlide, slides.length]);

  const safeCurrentSlide = slides.length > 0 ? Math.min(currentSlide, slides.length - 1) : 0;
  const activeSlide = slides.length > 0 ? slides[safeCurrentSlide] : null;

  return (
    <PageTransition className="m-0 p-0 relative">
      {activeSlide && <VideoBackground position="absolute" height="calc(100vh - 80px)" />}
      {!activeSlide && isCollectionsLoading && <VideoBackground position="absolute" height="calc(100vh - 80px)" />}
      {activeSlide && (
      <section className="pt-24 md:pt-32 relative z-10 min-h-[calc(100vh-120px)] flex items-center">
        <div className="w-full max-w-[1408px] mx-auto px-4 md:px-8 lg:px-16">
          <div className="flex flex-col gap-4 md:gap-8 lg:gap-10">
            <div className="flex flex-col lg:flex-row items-stretch gap-4 md:gap-8 lg:gap-10">
              <div className="hidden lg:flex flex-col lg:flex-1 gap-6 lg:gap-8 lg:h-full lg:min-h-[700px]">
                <div className="flex-1 lg:flex-1 rounded-2xl bg-background/60 backdrop-blur-sm border border-border/60 px-6 md:px-10 py-8 md:py-10 flex flex-col justify-center space-y-4 md:space-y-6">
                  <div className="inline-block rounded-md bg-muted/30 px-2.5 py-0.5 text-[10px] md:text-xs font-semibold tracking-[0.16em] uppercase text-muted-foreground border border-border/40 w-fit dark:bg-[#00EC97]/10 dark:text-[#00EC97] dark:border-[#00EC97]/60">
                    {activeSlide.badge}
                  </div>

                  <div>
                    <h1 className="text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight text-foreground mb-2">
                      {activeSlide.title}
                    </h1>
                    <h2 className="text-2xl md:text-3xl font-semibold tracking-tight text-foreground/90">
                      {activeSlide.subtitle}
                    </h2>
                  </div>

                  <p className="text-sm md:text-base text-foreground/90 dark:text-muted-foreground max-w-xl">
                    {activeSlide.description}
                  </p>
                </div>

                <div className="hidden lg:flex flex-1 rounded-2xl bg-background/60 backdrop-blur-sm border border-border/60 px-6 md:px-8 py-6 md:py-8 flex flex-col justify-center">
                  <div className="flex flex-col gap-4">
                    <div>
                      <h3 className="text-xl md:text-2xl font-bold tracking-tight text-foreground mb-2">
                        Represent the NEAR protocol IRL
                      </h3>
                      <p className="text-sm md:text-base text-foreground/90 dark:text-muted-foreground">
                        Discover curated drops and official merch to show your support for NEAR in the real world.
                      </p>
                    </div>
                    <div>
                      <Link
                        to="/products"
                        search={{ category: "all", categoryId: undefined, collection: undefined }}
                        className="inline-flex items-center justify-center gap-2 px-4 md:px-8 py-2 md:py-3 h-[40px] md:h-[48px] rounded-lg bg-[#00EC97] text-black font-semibold text-xs md:text-base hover:bg-[#00d97f] transition-colors whitespace-nowrap"
                      >
                        Shop Items
                      </Link>
                    </div>
                  </div>
                </div>
              </div>

              <div
                className="flex-1 lg:flex-1 rounded-2xl bg-background/60 backdrop-blur-sm border border-border/60 px-3 md:px-5 py-3 md:py-5 relative min-h-[52vh] md:min-h-[500px] lg:h-full lg:min-h-[700px]"
                onMouseEnter={() => setIsPaused(true)}
                onMouseLeave={() => setIsPaused(false)}
              >
              <div className="absolute inset-0 rounded-2xl overflow-hidden bg-black/40 flex items-end md:items-center justify-center p-8">
            {/* Gradient layer - behind image */}
            <div
                  className="absolute inset-0 z-0"
              style={{
                    background: `radial-gradient(circle at top left, ${activeSlide.glowColor}33 0, transparent 55%)`,
              }}
            />
            
            {/* Image layer - above gradient */}
            {activeSlide.image ? (
              <img
                    src={activeSlide.image}
                    alt={activeSlide.title}
                    className="relative z-[15] h-auto w-auto max-h-[70%] max-w-[70%] object-contain object-center"
              />
            ) : (
              <div className="relative z-[15] flex items-center justify-center h-full w-full">
                <div className="text-white/60 text-lg md:text-xl font-semibold">
                  {activeSlide.title}
                </div>
              </div>
            )}
              </div>

              {/* Mobile overlay gradient - behind text but above image */}
              <div className="absolute inset-0 lg:hidden bg-gradient-to-b from-black/60 via-black/40 to-black/60 rounded-2xl z-[12] pointer-events-none" />

              <div className="absolute inset-0 lg:hidden z-[20] flex flex-col justify-between p-6 md:p-8">
                <div className="flex flex-col gap-3">
                  <div className="inline-block rounded-md bg-black/40 px-2.5 py-0.5 text-[10px] md:text-xs font-semibold tracking-[0.16em] uppercase text-white border border-white/60 w-fit dark:bg-[#00EC97]/20 dark:text-[#00EC97] dark:border-[#00EC97]/70">
                    {activeSlide.badge}
                  </div>

                  <div>
                    <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-white mb-1 drop-shadow-lg">
                      {activeSlide.title}
                  </h1>
                    <h2 className="text-lg md:text-xl font-semibold tracking-tight text-white/95 drop-shadow-md">
                      {activeSlide.subtitle}
                    </h2>
                  </div>

                  <p className="text-sm md:text-base text-white/90 max-w-xs drop-shadow-md">
                    {activeSlide.description}
                  </p>
                </div>
              </div>

              {activeSlide.collection && (
                <>
                  <div className="hidden lg:block absolute top-4 right-4 z-30">
                    <Link
                      to="/collections/$collection"
                      params={{ collection: activeSlide.collection.slug }}
                      className="rounded-lg bg-background/40 backdrop-blur-sm border border-border/40 px-4 py-1.5 flex items-center gap-2 transition-all duration-200 hover:bg-[#00EC97] hover:border-[#00EC97] hover:text-black group"
                    >
                      <span className="text-base font-semibold whitespace-nowrap">
                        View Collection
                      </span>
                      <ChevronRight className="h-4 w-4" />
                    </Link>
                  </div>

                  <div className="lg:hidden absolute top-4 right-4 z-30">
                    <Link
                      to="/collections/$collection"
                      params={{ collection: activeSlide.collection.slug }}
                      className="rounded-lg bg-background/60 backdrop-blur-sm border border-border/60 px-3 py-1.5 flex items-center gap-2 active:bg-[#00EC97] active:border-[#00EC97] transition-all duration-200 shadow-lg group"
                    >
                      <span className="text-sm font-semibold">
                        View Collection
                      </span>
                      <ChevronRight className="h-4 w-4" />
                    </Link>
                  </div>
                </>
              )}

<div className="absolute inset-x-0 bottom-4 flex items-center justify-between px-4 z-30">
                <div className="flex items-center gap-2">
                  <Link to="/collections/$collection" params={{ collection: activeSlide.collection?.slug }} className="lg:hidden">
                    <button
                      type="button"
                      className="inline-flex items-center justify-center px-4 py-2.5 h-[40px] rounded-lg bg-[#00EC97] text-black font-semibold text-xs hover:bg-[#00d97f] transition-colors whitespace-nowrap"
                    >
                      {activeSlide.buttonText}
                    </button>
                    </Link>
                  <div className="hidden lg:flex items-center gap-2">
                    {slides.map((_: any, index: number) => (
                      <button
                        key={index}
                        type="button"
                        onClick={() => setCurrentSlide(index)}
                        className={`h-1.5 rounded-full transition-all ${
                          index === currentSlide
                            ? "w-6 bg-[#00EC97]"
                            : "w-2.5 bg-muted/50"
                        }`}
                        aria-label={`Go to slide ${index + 1}`}
                      />
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2">
          <button
            onClick={prevSlide}
            type="button"
                    className="p-2.5 rounded-lg bg-background/60 backdrop-blur-sm border border-border/60 hover:bg-[#00EC97] hover:border-[#00EC97] transition-all duration-200 shadow-lg hover:shadow-xl"
            aria-label="Previous"
          >
                    <ChevronLeft className="h-5 w-5 text-foreground" aria-hidden="true" />
          </button>
          <button
            onClick={nextSlide}
            type="button"
                    className="p-2.5 rounded-lg bg-background/60 backdrop-blur-sm border border-border/60 hover:bg-[#00EC97] hover:border-[#00EC97] transition-all duration-200 shadow-lg hover:shadow-xl"
            aria-label="Next"
          >
                    <ChevronRight className="h-5 w-5 text-foreground" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
        </div>
      </section>
      )}

      {!activeSlide && isCollectionsLoading && <MarketplaceSkeletonLoader />}

      {activeSlide && (
            <div className="lg:hidden rounded-2xl bg-background/60 backdrop-blur-sm border border-border/60 px-4 md:px-6 py-4 md:py-6 relative z-10 mx-4 md:mx-8 -mt-4 md:mt-0 mb-6 md:mb-8">
              <div className="flex flex-col gap-3 md:gap-4">
                <div>
                  <h3 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground mb-1.5 md:mb-2">
                    Represent the NEAR protocol IRL
                  </h3>
                  <p className="text-xs md:text-sm text-foreground/90 dark:text-muted-foreground">
                    Discover curated drops and official merch to show your support for NEAR in the real world.
                  </p>
                </div>

                <div>
                  <Link
                    to="/products"
                    search={{ category: "all", categoryId: undefined, collection: undefined }}
                    className="inline-flex items-center justify-center px-4 md:px-8 py-2 md:py-3 h-[40px] md:h-[48px] rounded-lg bg-[#00EC97] text-black font-semibold text-xs md:text-base hover:bg-[#00d97f] transition-colors whitespace-nowrap"
                  >
                    Shop Items
                  </Link>
                </div>
              </div>
            </div>
      )}

      {activeSlide && (
        <div className="relative w-full h-48 md:h-96 bg-gradient-to-b from-transparent via-background/50 to-background pointer-events-none -mt-48 md:-mt-96 z-[5]" />
      )}

      <section className={cn("section-padding relative z-10", !activeSlide && "pt-32 md:pt-40")} id="featured-products">
        <div className="container-app">
          <ProductCarousel />
        </div>
      </section>

      <section className={cn(
 
        featuredProducts.length === 0 ? "pt-32 md:pt-40" : "pt-8 md:pt-16"
      )} id="products">
        <div className="container-app">
          {featuredProducts.length === 0 ? (
            <div className="flex flex-col items-center justify-center min-h-[400px] py-16 text-center">
              <div className="text-foreground/90 dark:text-muted-foreground mb-4">
                <svg
                  className="mx-auto h-16 w-16 mb-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"
                  />
                </svg>
                <h3 className="text-xl font-semibold text-foreground mb-2">
                  No Products Found
                </h3>
                <p className="text-sm max-w-md">
                  There are currently no products available in the marketplace.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-8">
                {/* Mobile: Category dropdown + view toggle */}
                <div className="md:hidden flex items-center gap-2 flex-1">
                  <Select value={selectedProductCategory} onValueChange={(v) => setSelectedProductCategory(v)}>
                    <SelectTrigger className="flex-1 h-11 rounded-xl bg-background/60 backdrop-blur-sm border border-border/60 font-semibold text-sm hover:bg-background/80 hover:border-[#00EC97]/60 focus:ring-0 focus:ring-offset-0 data-[state=open]:border-[#00EC97] data-[state=open]:bg-background/80">
                      <SelectValue placeholder="Category" />
                    </SelectTrigger>
                    <SelectContent className="bg-background/60 backdrop-blur-sm border border-border/60 rounded-2xl p-2 shadow-lg min-w-[var(--radix-select-trigger-width)]">
                      {productTypeCategoriesForFilter.map((category) => (
                        <SelectItem key={category.key} value={category.key} className="rounded-lg py-2.5 pr-3 focus:bg-[#00EC97] focus:text-black data-[highlighted]:bg-[#00EC97] data-[highlighted]:text-black cursor-pointer [&>span.absolute]:hidden">
                          {category.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => setViewMode('single')}
                      className={cn("h-11 w-11 flex items-center justify-center rounded-xl bg-background/60 backdrop-blur-sm border border-border/60 transition-colors shrink-0", viewMode === 'single' ? "bg-[#00EC97] border-[#00EC97] text-black" : "hover:bg-[#00EC97] hover:border-[#00EC97] hover:text-black")}
                      aria-label="Single view"
                    >
                      <Square className="h-5 w-5" />
                    </button>
                    <button
                      onClick={() => setViewMode('grid')}
                      className={cn("h-11 w-11 flex items-center justify-center rounded-xl bg-background/60 backdrop-blur-sm border border-border/60 transition-colors shrink-0", viewMode === 'grid' ? "bg-[#00EC97] border-[#00EC97] text-black" : "hover:bg-[#00EC97] hover:border-[#00EC97] hover:text-black")}
                      aria-label="Grid view"
                    >
                      <Grid3x3 className="h-5 w-5" />
                    </button>
                  </div>
                </div>
              </div>

              <div className="hidden md:flex flex-wrap items-center justify-center gap-2 mb-8">
                {productTypeCategoriesForFilter.map((category) => (
                  <button
                    key={category.key}
                    onClick={() => setSelectedProductCategory(category.key)}
                    className={cn(
                      "inline-flex items-center gap-2 px-8 py-3 rounded-lg bg-background/60 backdrop-blur-sm border border-border/60 hover:bg-[#00EC97] hover:border-[#00EC97] hover:text-black transition-colors font-semibold text-base",
                      selectedProductCategory === category.key
                        ? "bg-[#00EC97] border-[#00EC97] text-black"
                        : ""
                    )}
                  >
                    {category.label}
                  </button>
                ))}
              </div>

              <div className="md:hidden mb-8">
                <div className={cn(
                  "grid gap-4",
                  viewMode === 'single' ? "grid-cols-1" : "grid-cols-2"
                )}>
                  {displayProducts?.map((product: Product) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      variant="sm"
                      onQuickAdd={handleQuickAdd}
                    />
                  ))}
                </div>
              </div>
              
              <div className="hidden md:grid sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
                {displayProducts?.map((product: Product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    variant="sm"
                    onQuickAdd={handleQuickAdd}
                  />
                ))}
              </div>
              
              <div className="text-center">
                <div className="flex items-center justify-center gap-2 md:gap-0">
                  <Link
                    to="/products"
                    search={{ category: selectedProductCategory === 'all' ? 'all' : selectedProductCategory, categoryId: undefined, collection: undefined }}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2.5 md:px-8 md:py-3 rounded-lg bg-background/60 backdrop-blur-sm border border-border/60 hover:bg-[#00EC97] hover:border-[#00EC97] hover:text-black transition-colors font-semibold text-xs md:text-base h-[40px] md:h-auto"
                  >
                    {selectedProductCategory === 'all' 
                      ? 'View All Products'
                      : `View ${productTypeCategoriesForFilter.find(cat => cat.key === selectedProductCategory)?.label || 'Products'}`}
                    <ChevronRight className="hidden md:block h-5 w-5" />
                  </Link>
                </div>
              </div>
            </>
          )}
        </div>
      </section>

      {/* Stay Updated + Request for Featuring Merch Collection Section */}
      <section className="relative z-10 py-12 md:py-16 lg:py-20">
        <div className="w-full max-w-[1408px] mx-auto px-4 md:px-8 lg:px-16">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
            {/* Stay Updated Newsletter Block */}
            <div className="rounded-2xl bg-background/60 backdrop-blur-sm border border-border/60 px-4 md:px-6 lg:px-10 py-4 md:py-8">
              <div className="flex flex-col gap-3 md:gap-5">
                <div className="text-left">
                  <h3 className="text-lg md:text-2xl lg:text-3xl font-bold tracking-tight text-foreground mb-1.5 md:mb-3">
                    Stay Updated
                  </h3>
                  <p className="text-xs md:text-sm lg:text-base text-foreground/90 dark:text-muted-foreground">
                    Subscribe to receive the latest NEAR merch updates and new product drops
                  </p>
                </div>
                <form
                  noValidate
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (subscribeNewsletter.isPending) return;

                    const email = normalizedNewsletterEmail.toLowerCase();
                    if (!isNewsletterEmailValid) {
                      toast.error("Please enter a valid email address");
                      return;
                    }

                    subscribeNewsletter.mutate(
                      { email },
                      {
                        onSuccess: (data) => {
                          if (data.status === 'already_subscribed') {
                            toast.success("You're already subscribed.");
                          } else {
                            toast.success("Thank you for subscribing!");
                          }
                          setNewsletterEmail("");
                        },
                        onError: (error: any) => {
                          const errorCode = error?.response?.data?.code || error?.code;
                          if (errorCode === 'BAD_REQUEST') {
                            toast.error('Please enter a valid email address');
                            return;
                          }
                          toast.error('Unable to subscribe right now. Please try again.');
                        },
                      }
                    );
                  }}
                  className="flex flex-row items-stretch gap-2 md:gap-3"
                >
                  <Input
                    type="email"
                    placeholder="Enter your email"
                    value={newsletterEmail}
                    onChange={(e) => setNewsletterEmail(e.target.value)}
                    autoComplete="email"
                    inputMode="email"
                    disabled={subscribeNewsletter.isPending}
                    aria-invalid={newsletterEmail.length > 0 && !isNewsletterEmailValid}
                    className="flex-1 h-[40px] md:h-[48px] text-sm md:text-base bg-background/60 border-border/60 focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-b-2 focus-visible:border-[#00EC97] hover:border-border/60 disabled:opacity-70"
                  />
                  <button
                    type="submit"
                    disabled={subscribeNewsletter.isPending || !normalizedNewsletterEmail || !isNewsletterEmailValid}
                    className="px-4 md:px-8 py-2 md:py-3 h-[40px] md:h-[48px] rounded-lg bg-[#00EC97] text-black font-semibold text-xs md:text-base hover:bg-[#00d97f] transition-colors whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {subscribeNewsletter.isPending ? (
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Subscribing...
                      </span>
                    ) : (
                      'Subscribe'
                    )}
                  </button>
                </form>
              </div>
            </div>

            {/* Request for Featuring Merch Collection Block */}
            <div className="rounded-2xl bg-background/60 backdrop-blur-sm border border-border/60 px-4 md:px-6 lg:px-10 py-4 md:py-8">
              <div className="flex flex-col gap-3 md:gap-5 h-full justify-between">
                <div className="text-left">
                  <h3 className="text-lg md:text-2xl lg:text-3xl font-bold tracking-tight text-foreground mb-1.5 md:mb-3">
                    Request for featuring merch collection
                  </h3>
                  <p className="text-xs md:text-sm lg:text-base text-foreground/90 dark:text-muted-foreground">
                    Have a NEAR-related merch collection you want to feature in this store? Submit a request and our team will review it.
                  </p>
                </div>
                <div className="flex justify-start">
                  <a
                    href="https://near-foundation.notion.site/2d365bc975504078b8b0bded040a4e2e?pvs=105"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center justify-center px-4 md:px-8 py-2 md:py-3 h-[40px] md:h-[48px] rounded-lg bg-[#00EC97] text-black font-semibold text-xs md:text-base hover:bg-[#00d97f] transition-colors whitespace-nowrap"
                  >
                    Open request form
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <SizeSelectionModal
        product={sizeModalProduct}
        isOpen={!!sizeModalProduct}
        onClose={() => setSizeModalProduct(null)}
        onAddToCart={handleAddToCartFromModal}
      />

      <CartSidebar
        isOpen={isCartSidebarOpen}
        onClose={closeCartSidebar}
      />
    </PageTransition>
  );
}

function ProductCarousel() {
  const { data: featuredData } = useFeaturedProducts(6);
  const products = featuredData?.products ?? [];

  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [userInteracted, setUserInteracted] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const carouselItems = useMemo(() => {
    return products.slice(0, 6).map((product: Product) => ({
      id: product.id,
      name: product.title,
      slug: product.slug,
      description: product.description || product.title,
      image: product.thumbnailImage || product.images?.[0]?.url || null,
      price: `$${getLowestVariantPrice(product).toFixed(2)}`,
      product: product,
    }));
  }, [products]);

  const nextItem = () => {
    setUserInteracted(true);
    setCurrentIndex((prev) => (prev + 1) % carouselItems.length);
  };

  const prevItem = () => {
    setUserInteracted(true);
    setCurrentIndex((prev) => (prev - 1 + carouselItems.length) % carouselItems.length);
  };

  useEffect(() => {
    if (carouselItems.length === 0 || isPaused || userInteracted) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    intervalRef.current = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % carouselItems.length);
    }, 5000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [carouselItems.length, isPaused, userInteracted]);

  if (carouselItems.length === 0) {
    return (
      <div className="text-center py-12 relative z-10">
        <div className="rounded-2xl bg-background/60 backdrop-blur-sm border border-border/60 px-6 md:px-8 py-8 md:py-10 max-w-2xl mx-auto">
          <p className="text-foreground/90 dark:text-muted-foreground">
            No collections to display. Create collections and enable them for carousel in the admin dashboard.
          </p>
        </div>
      </div>
    );
  }

  const getVisibleItems = () => {
    const prevIdx = (currentIndex - 1 + carouselItems.length) % carouselItems.length;
    const nextIdx = (currentIndex + 1) % carouselItems.length;
    
    return [
      { ...carouselItems[prevIdx], position: 'left' as const },
      { ...carouselItems[currentIndex], position: 'center' as const },
      { ...carouselItems[nextIdx], position: 'right' as const },
    ];
  };

  const visibleItems = getVisibleItems();

  return (
    <div 
      className="relative w-full"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
    >
      <div className="md:hidden relative w-full overflow-hidden">
        <div className="relative h-[450px] flex items-center justify-start w-full px-4">
          {carouselItems.map((item: any, index: number) => {
            const isCurrent = index === currentIndex;
            const isNext = index === (currentIndex + 1) % carouselItems.length;
            const isVisible = isCurrent || isNext;
            
            if (!isVisible) return null;
            
            return (
              <div
                key={`${item.slug}-${index}`}
                className={`absolute transition-all duration-500 ease-out ${
                  isCurrent ? 'z-30' : 'z-10 opacity-50'
                }`}
                style={{
                  transform: isCurrent
                    ? 'scale(1) translateX(0) translateY(0)'
                    : 'scale(0.65) translateX(calc(85% - 1rem)) translateY(0)',
                  left: isCurrent ? '1rem' : 'auto',
                  right: isCurrent ? 'auto' : '-15%',
                }}
              >
                <Link
                  to="/products/$productId"
                  params={{ productId: item.slug }}
                  className="block group"
                >
                  <div className="relative w-[calc(100vw-3rem)] max-w-[340px] h-[400px] rounded-2xl bg-background/60 backdrop-blur-sm border border-border/60 overflow-hidden transition-all duration-500 hover:border-[#00EC97] hover:shadow-xl">
{item.image ? (
                       <div className="absolute inset-0">
                         <img
                           src={item.image}
                           alt={item.name}
                           loading={isCurrent ? "eager" : "lazy"}
                           decoding="async"
                           className="w-full h-full object-cover"
                         />
                        <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-background/40 to-transparent" />
                      </div>
                    ) : (
                      <div className="absolute inset-0 bg-muted" />
                    )}
                    
<div className="absolute bottom-0 left-0 right-0 p-6 z-10">
                       <h4 className="text-2xl font-bold text-foreground mb-2 drop-shadow-lg">
                         {item.name}
                       </h4>
                       {item.price && (
                         <p className="text-[#00EC97] font-bold text-lg mb-2 drop-shadow-lg">
                           {item.price}
                         </p>
                       )}
                       {item.description && (
                         <p className="text-foreground/90 dark:text-muted-foreground text-sm line-clamp-2">
                           {item.description}
                         </p>
                       )}
                     </div>

                    {isCurrent && (
                      <div className="absolute bottom-4 right-4 z-20">
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            nextItem();
                          }}
                          className="p-2.5 rounded-lg bg-background/60 backdrop-blur-sm border border-border/60 hover:bg-[#00EC97] hover:border-[#00EC97] transition-all duration-200 shadow-lg hover:shadow-xl"
                          aria-label="Next collection"
                        >
                          <ChevronRight className="h-5 w-5 text-foreground" />
                        </button>
                      </div>
                    )}
                  </div>
                </Link>
              </div>
            );
          })}
        </div>
      </div>

      <div 
        className="hidden md:block relative h-[700px] lg:h-[800px] flex items-center justify-center w-full"
        style={{ perspective: '1000px' }}
      >
        {visibleItems.map((item: any, index: number) => {
          const isCenter = item.position === 'center';
          const isLeft = item.position === 'left';
          
          return (
            <div
              key={`${item.slug}-${currentIndex}-${index}`}
              className={`absolute transition-all duration-500 ease-out ${
                isCenter ? 'z-30 left-1/2' : 'z-10 opacity-70 left-1/2'
              }`}
              style={{
                transform: isCenter
                  ? 'translateX(-50%) translateY(0) translateZ(0) scale(1)'
                  : isLeft
                  ? 'translateX(calc(-50% - 55%)) translateY(-3%) translateZ(-80px) scale(0.85)'
                  : 'translateX(calc(-50% + 55%)) translateY(-3%) translateZ(-80px) scale(0.85)',
                transformStyle: 'preserve-3d',
                willChange: 'transform',
              }}
            >
              <Link
                to="/products/$productId"
                params={{ productId: item.slug }}
                className="block group"
              >
                <div className="relative w-[580px] lg:w-[680px] h-[650px] lg:h-[720px] rounded-2xl bg-background/60 backdrop-blur-sm border border-border/60 overflow-hidden transition-all duration-500 hover:border-[#00EC97] hover:shadow-xl">
{item.image ? (
                       <div className="absolute inset-0">
                         <img
                           src={item.image}
                           alt={item.name}
                           loading={isCenter ? "eager" : "lazy"}
                           decoding="async"
                           className="w-full h-full object-cover"
                         />
                      <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-background/40 to-transparent" />
                    </div>
                  ) : (
                    <div className="absolute inset-0 bg-muted" />
                  )}
                  
                  <div className="absolute bottom-0 left-0 right-0 p-6 z-30 pointer-events-auto" style={{ backfaceVisibility: 'visible' }}>
                    <h4 className="text-3xl md:text-4xl font-bold text-foreground mb-2 drop-shadow-lg">
                      {item.name}
                    </h4>
                    {item.price && (
                      <p className="text-[#00EC97] font-bold text-xl mb-2 drop-shadow-lg">
                        {item.price}
                      </p>
                    )}
                    {item.description && (
                      <p className="text-foreground/90 dark:text-muted-foreground text-sm md:text-base line-clamp-2">
                        {item.description}
                      </p>
                    )}
                  </div>
                </div>
              </Link>
            </div>
          );
        })}
      </div>

      <div className="hidden md:flex lg:hidden absolute w-full items-center justify-between px-4 pointer-events-none z-40" style={{ top: 'calc(50% + 220px)' }}>
        <button
          onClick={prevItem}
          className="p-2.5 rounded-lg bg-background/60 backdrop-blur-sm border border-border/60 hover:bg-[#00EC97] hover:border-[#00EC97] transition-all duration-200 pointer-events-auto shadow-lg hover:shadow-xl"
          aria-label="Previous collection"
        >
          <ChevronLeft className="h-5 w-5 text-foreground" />
        </button>
        
        <button
          onClick={nextItem}
          className="p-2.5 rounded-lg bg-background/60 backdrop-blur-sm border border-border/60 hover:bg-[#00EC97] hover:border-[#00EC97] transition-all duration-200 pointer-events-auto shadow-lg hover:shadow-xl"
          aria-label="Next collection"
        >
          <ChevronRight className="h-5 w-5 text-foreground" />
        </button>
      </div>
      
      <div className="hidden lg:flex absolute w-full items-center justify-between px-6 pointer-events-none z-40" style={{ top: 'calc(50% + 240px)' }}>
        <button
          onClick={prevItem}
          className="p-2.5 rounded-lg bg-background/60 backdrop-blur-sm border border-border/60 hover:bg-[#00EC97] hover:border-[#00EC97] transition-all duration-200 pointer-events-auto shadow-lg hover:shadow-xl"
          aria-label="Previous collection"
        >
          <ChevronLeft className="h-5 w-5 text-foreground" />
        </button>
        
        <button
          onClick={nextItem}
          className="p-2.5 rounded-lg bg-background/60 backdrop-blur-sm border border-border/60 hover:bg-[#00EC97] hover:border-[#00EC97] transition-all duration-200 pointer-events-auto shadow-lg hover:shadow-xl"
          aria-label="Next collection"
        >
          <ChevronRight className="h-5 w-5 text-foreground" />
        </button>
      </div>
    </div>
  );
}
