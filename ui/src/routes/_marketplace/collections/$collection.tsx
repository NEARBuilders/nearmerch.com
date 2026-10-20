import { createFileRoute, Link, useRouter, useNavigate } from '@tanstack/react-router';
import { useState, useMemo } from 'react';
import { ArrowLeft, AlertCircle, ChevronRight, Square, Grid3x3, Filter, Search, X, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LoadingSpinner } from '@/components/loading';
import { PageTransition } from '@/components/page-transition';
import {
  Sheet,
  SheetContent,
} from '@/components/ui/sheet';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { SizeSelectionModal } from '@/components/marketplace/size-selection-modal';
import { CartSidebar } from '@/components/marketplace/cart-sidebar';
import { ProductCard } from '@/components/marketplace/product-card';
import { useCart } from '@/hooks/use-cart';
import { cn } from '@/lib/utils';
import { getLowestVariantPrice } from '@/lib/product-price';
import { useSuspenseQuery } from '@tanstack/react-query';
import {
  useSuspenseCollection,
  useSuspenseCollections,
  useProductTypes,
  collectionLoaders,
  productLoaders,
  type Collection,
  type Product,
} from '@/integrations/api';
import { COLOR_MAP } from '@/lib/product-utils';
import { rethrowAsRouteError } from '@/lib/route-errors';
import {
  absoluteUrl,
  buildCollectionDescription,
  buildCollectionJsonLd,
  createSeoHead,
  getCollectionSeoImage,
  SITE_NAME,
} from '@/lib/seo';

export const Route = createFileRoute('/_marketplace/collections/$collection')({
  pendingComponent: LoadingSpinner,
  loader: async ({ params, context }) => {
    const queryClient = context.queryClient;
    const siteUrl = context.runtimeConfig?.hostUrl ?? '';
    const assetsUrl = context.assetsUrl ?? '';
    const listData = await queryClient.ensureQueryData(collectionLoaders.list());
    if (params.collection === 'all') {
      const collections = (listData as { collections: { slug: string }[] }).collections;
      const collectionSlugs = collections.length > 0 ? [...collections.map((c) => c.slug)].sort() : ['_none'];
      const productsData = await queryClient.ensureQueryData(productLoaders.list({ collectionSlugs, limit: 100 }));
      return {
        kind: 'all' as const,
        collections: (listData as { collections: Collection[] }).collections,
        products: productsData.products,
        totalProducts: productsData.total,
        siteUrl,
        assetsUrl,
      };
    }

    const detailData = await queryClient
      .ensureQueryData(collectionLoaders.detail(params.collection))
      .catch(rethrowAsRouteError);
    return {
      kind: 'collection' as const,
      collection: detailData.collection,
      products: detailData.products,
      siteUrl,
      assetsUrl,
    };
  },
  head: ({ loaderData, params }) => {
    const siteUrl = loaderData?.siteUrl ?? '';
    const assetsUrl = loaderData?.assetsUrl ?? '';
    const fallbackImage = assetsUrl ? absoluteUrl(assetsUrl, '/metadata.png') : undefined;
    const canonicalUrl = siteUrl
      ? absoluteUrl(siteUrl, `/collections/${encodeURIComponent(params.collection)}`)
      : undefined;

    if (params.collection === 'all') {
      const allProducts = loaderData?.products ?? [];
      const totalProducts = loaderData?.totalProducts ?? allProducts.length;
      const title = `All Collections | ${SITE_NAME}`;
      const description = buildCollectionDescription(undefined, totalProducts);
      const image = getCollectionSeoImage(undefined, allProducts) || fallbackImage;

      return createSeoHead({
        title,
        description,
        url: canonicalUrl,
        image,
        imageAlt: image ? 'All collections preview image' : undefined,
        jsonLd: canonicalUrl
          ? buildCollectionJsonLd({
              name: 'All Collections',
              description,
              url: canonicalUrl,
              image,
              products: allProducts,
              totalItems: totalProducts,
            })
          : null,
      });
    }

    const collection = loaderData?.collection;
    const products = loaderData?.products ?? [];
    const collectionTitle = collection?.name ?? 'Collection';
    const title = `${collectionTitle} | ${SITE_NAME}`;
    const description = buildCollectionDescription(collection, products.length);
    const image = getCollectionSeoImage(collection, products) || fallbackImage;

    return createSeoHead({
      title,
      description,
      url: canonicalUrl,
      image,
      imageAlt: image ? `${collectionTitle} collection preview image` : undefined,
      jsonLd: canonicalUrl
        ? buildCollectionJsonLd({
            name: collectionTitle,
            description,
            url: canonicalUrl,
            image,
            products,
          })
        : null,
    });
  },
  errorComponent: ({ error }) => {
    const router = useRouter();
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="max-w-md text-center space-y-4">
          <div className="text-red-600">
            <AlertCircle className="h-12 w-12 mx-auto mb-4" />
            <h2 className="text-xl font-semibold">Unable to Load Collection</h2>
          </div>
          <p className="text-gray-600">
            {error.message || 'Failed to load collection data. Please check your connection and try again.'}
          </p>
          <div className="flex gap-3 justify-center">
            <Button onClick={() => router.invalidate()}>Try Again</Button>
            <Button variant="outline" onClick={() => router.navigate({ to: '/collections' })}>
              Back to Collections
            </Button>
          </div>
        </div>
      </div>
    );
  },
  component: CollectionDetailPage,
});

type SortOption = 'relevance' | 'price-low-high' | 'price-high-low';
type PriceRange = 'all' | 'under-50' | '50-100' | '100-200' | 'over-200';

function CollectionDetailPage() {
  const { collection: collectionSlug } = Route.useParams();

  if (collectionSlug === 'all') {
    return <CollectionAllView />;
  }
  return <CollectionSingleView collectionSlug={collectionSlug} />;
}

function CollectionAllView() {
  const { data: collectionsData } = useSuspenseCollections();
  const collectionSlugs = useMemo(() => {
    const slugs = (collectionsData?.collections ?? []).map((c) => c.slug);
    return slugs.length > 0 ? [...slugs].sort() : ['_none'];
  }, [collectionsData]);
  const { data: productsData } = useSuspenseQuery(
    productLoaders.list({ collectionSlugs, limit: 100 })
  );
  const products = productsData?.products ?? [];
  return (
    <CollectionPageContent
      collectionSlug="all"
      pageTitle="All Collections"
      products={products}
    />
  );
}

function CollectionSingleView({ collectionSlug }: { collectionSlug: string }) {
  const { data } = useSuspenseCollection(collectionSlug);
  const { collection, products } = data;

  if (!collection) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-medium mb-4">Collection Not Found</h1>
          <Link to="/collections" className="text-[#00ec97] hover:underline">
            Back to Collections
          </Link>
        </div>
      </div>
    );
  }

  return (
    <CollectionPageContent
      collectionSlug={collectionSlug}
      pageTitle={collection.name}
      products={products}
    />
  );
}

function CollectionSwitcherSelect({
  collectionSlug,
  allCollections,
}: {
  collectionSlug: string;
  allCollections: { slug: string; name: string }[];
}) {
  const navigate = useNavigate();
  return (
    <Select
      value={collectionSlug}
      onValueChange={(v) => navigate({ to: '/collections/$collection', params: { collection: v } })}
    >
      <SelectTrigger className="flex-1 h-11 rounded-xl bg-background/60 backdrop-blur-sm border border-border/60 font-semibold text-sm hover:bg-background/80 hover:border-[#00EC97]/60 focus:ring-0 focus:ring-offset-0 data-[state=open]:border-[#00EC97] data-[state=open]:bg-background/80">
        <SelectValue placeholder="Collection" />
      </SelectTrigger>
      <SelectContent className="bg-background/60 backdrop-blur-sm border border-border/60 rounded-2xl p-2 shadow-lg min-w-[var(--radix-select-trigger-width)]">
        <SelectItem value="all" className="rounded-lg py-2.5 pr-3 focus:bg-[#00EC97] focus:text-black data-[highlighted]:bg-[#00EC97] data-[highlighted]:text-black cursor-pointer [&>span.absolute]:hidden">All</SelectItem>
        {allCollections.map((c) => (
          <SelectItem key={c.slug} value={c.slug} className="rounded-lg py-2.5 pr-3 focus:bg-[#00EC97] focus:text-black data-[highlighted]:bg-[#00EC97] data-[highlighted]:text-black cursor-pointer [&>span.absolute]:hidden">
            {c.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function CollectionPageContent({
  collectionSlug,
  pageTitle,
  products,
}: {
  collectionSlug: string;
  pageTitle: string;
  products: Product[];
}) {
  const { addToCart } = useCart();
  const [sizeModalProduct, setSizeModalProduct] = useState<Product | null>(null);
  const [isCartSidebarOpen, setIsCartSidebarOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'single' | 'grid'>('single');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('relevance');
  const [sizeFilter, setSizeFilter] = useState<string>('all');
  const [colorFilter, setColorFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [priceRange, setPriceRange] = useState<PriceRange>('all');
  const [brandFilter, setBrandFilter] = useState<string>('all');
  const [isFilterSheetOpen, setIsFilterSheetOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    sort: true,
    collections: true,
    category: false,
    sizes: false,
    color: false,
    brand: false,
    price: false,
  });

  const { data: collectionsData } = useSuspenseCollections();
  const { data: productTypesData } = useProductTypes();
  const productTypes = productTypesData?.productTypes ?? [];
  const productTypeCategoriesForFilter = useMemo(
    () => [{ key: 'all', label: 'All' }, ...productTypes.map((pt) => ({ key: pt.slug, label: pt.label }))],
    [productTypes]
  );

  const allCollections = useMemo(() => {
    return [...(collectionsData?.collections ?? [])].sort((a, b) => {
      const aOrder = a.carouselOrder ?? 0;
      const bOrder = b.carouselOrder ?? 0;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return a.name.localeCompare(b.name);
    });
  }, [collectionsData]);

  const { availableSizes, availableColors, availableBrands } = useMemo(() => {
    const sizes = new Set<string>();
    const colors = new Set<string>();
    const brands = new Set<string>();
    products.forEach((product) => {
      product.variants?.forEach((variant) => {
        variant.attributes?.forEach((attr) => {
          if (attr.name === 'Size') sizes.add(attr.value);
          if (attr.name === 'Color') colors.add(attr.value);
        });
      });
      if (product.brand) brands.add(product.brand);
    });
    return {
      availableSizes: Array.from(sizes).sort(),
      availableColors: Array.from(colors).sort(),
      availableBrands: Array.from(brands).sort(),
    };
  }, [products]);

  const filteredProducts = useMemo(() => {
    let result = products;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          (p.description || '').toLowerCase().includes(q)
      );
    }
    if (categoryFilter !== 'all') {
      result = result.filter((p) => p.productType?.slug === categoryFilter);
    }
    if (brandFilter !== 'all') {
      result = result.filter((p) => p.brand === brandFilter);
    }
    if (sizeFilter !== 'all') {
      result = result.filter((p) =>
        p.variants?.some((v) => {
          const size = v.attributes?.find((a) => a.name === 'Size')?.value;
          return size === sizeFilter && v.availableForSale;
        })
      );
    }
    if (colorFilter !== 'all') {
      result = result.filter((p) =>
        p.variants?.some((v) => {
          const color = v.attributes?.find((a) => a.name === 'Color')?.value;
          return color === colorFilter && v.availableForSale;
        })
      );
    }
    if (priceRange !== 'all') {
      result = result.filter((p) => {
        const price = getLowestVariantPrice(p);
        switch (priceRange) {
          case 'under-50': return price < 50;
          case '50-100': return price >= 50 && price < 100;
          case '100-200': return price >= 100 && price < 200;
          case 'over-200': return price >= 200;
          default: return true;
        }
      });
    }

    result = [...result].sort((a, b) => {
      if (sortBy === 'price-low-high') return getLowestVariantPrice(a) - getLowestVariantPrice(b);
      if (sortBy === 'price-high-low') return getLowestVariantPrice(b) - getLowestVariantPrice(a);
      return 0;
    });
    return result;
  }, [products, searchQuery, sortBy, categoryFilter, brandFilter, sizeFilter, colorFilter, priceRange]);

  const toggleSection = (section: string) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const handleAddToCart = (product: Product) => {
    setSizeModalProduct(product);
  };

  const handleAddToCartFromModal = (productId: string, variantId: string, size: string, color: string, imageUrl?: string) => {
    addToCart(productId, variantId, size, color, imageUrl);
    setSizeModalProduct(null);
    setIsCartSidebarOpen(true);
  };

  return (
    <PageTransition className="bg-background min-h-screen pt-32">
      <div className="max-w-[1408px] mx-auto px-4 md:px-8 lg:px-16">
        {/* Back and Title Blocks */}
        <div className="flex flex-row gap-4 mb-8">
          <Link
            to="/collections"
            className="rounded-2xl border border-border/60 px-4 md:px-8 lg:px-10 py-4 md:py-8 flex items-center justify-center hover:border-[#00EC97] hover:text-[#00EC97] transition-colors shrink-0"
          >
            <ArrowLeft className="size-5" />
          </Link>

          <div className="flex-1 rounded-2xl bg-background/60 backdrop-blur-sm border border-border/60 px-6 md:px-8 lg:px-10 py-6 md:py-8">
            <h1 className="text-3xl md:text-4xl font-bold tracking-tight">{pageTitle}</h1>
          </div>
        </div>

        {/* Collection switcher + Filter */}
        <div className="mb-8">
          {/* Mobile: Collection dropdown + view toggle */}
          <div className="md:hidden flex items-center gap-2">
            <CollectionSwitcherSelect
              collectionSlug={collectionSlug}
              allCollections={allCollections}
            />
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => setViewMode('single')}
                className={cn(
                  'h-11 w-11 flex items-center justify-center rounded-xl bg-background/60 backdrop-blur-sm border border-border/60 transition-colors shrink-0',
                  viewMode === 'single' ? 'bg-[#00EC97] border-[#00EC97] text-black' : 'hover:bg-[#00EC97] hover:border-[#00EC97] hover:text-black'
                )}
                aria-label="Single view"
              >
                <Square className="h-5 w-5" />
              </button>
              <button
                onClick={() => setViewMode('grid')}
                className={cn(
                  'h-11 w-11 flex items-center justify-center rounded-xl bg-background/60 backdrop-blur-sm border border-border/60 transition-colors shrink-0',
                  viewMode === 'grid' ? 'bg-[#00EC97] border-[#00EC97] text-black' : 'hover:bg-[#00EC97] hover:border-[#00EC97] hover:text-black'
                )}
                aria-label="Grid view"
              >
                <Grid3x3 className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Desktop: Collection buttons + Filter */}
          <div className="hidden md:flex flex-wrap items-center gap-2">
            <Link
              to="/collections/$collection"
              params={{ collection: 'all' }}
              className={cn(
                'inline-flex items-center justify-center px-8 py-3 rounded-lg font-semibold text-base transition-colors',
                collectionSlug === 'all'
                  ? 'bg-[#00EC97] border border-[#00EC97] text-black'
                  : 'bg-background/60 backdrop-blur-sm border border-border/60 hover:bg-[#00EC97] hover:border-[#00EC97] hover:text-black'
              )}
            >
              All
            </Link>
            {allCollections.map((c) =>
              c.slug === collectionSlug ? (
                <span
                  key={c.slug}
                  className="inline-flex items-center justify-center px-8 py-3 rounded-lg bg-[#00EC97] border border-[#00EC97] text-black font-semibold text-base"
                >
                  {c.name}
                </span>
              ) : (
                <Link
                  key={c.slug}
                  to="/collections/$collection"
                  params={{ collection: c.slug }}
                  className="inline-flex items-center justify-center px-8 py-3 rounded-lg bg-background/60 backdrop-blur-sm border border-border/60 hover:bg-[#00EC97] hover:border-[#00EC97] hover:text-black transition-colors font-semibold text-base"
                >
                  {c.name}
                </Link>
              )
            )}
            <button
              onClick={() => setIsFilterSheetOpen(true)}
              className="inline-flex items-center gap-2 px-8 py-3 rounded-lg bg-background/60 backdrop-blur-sm border border-border/60 hover:bg-[#00EC97] hover:border-[#00EC97] hover:text-black transition-colors font-semibold text-base ml-auto"
            >
              <Filter className="h-4 w-4" />
              Filter
            </button>
          </div>
        </div>

        {/* Mobile Filter FAB */}
        <button
          onClick={() => setIsFilterSheetOpen(true)}
          className="md:hidden fixed bottom-6 right-6 z-50 inline-flex items-center gap-2 px-6 py-4 rounded-lg bg-background/60 backdrop-blur-sm border border-border/60 hover:bg-[#00EC97] hover:border-[#00EC97] hover:text-black transition-colors font-semibold text-base shadow-lg"
        >
          <Filter className="h-5 w-5" />
          Filter
        </button>

        {/* Filter Sheet */}
        <Sheet open={isFilterSheetOpen} onOpenChange={setIsFilterSheetOpen}>
          <SheetContent side="left" hideCloseButton className="w-full sm:w-full p-0 bg-background flex flex-col">
            <div className="flex flex-col h-full">
              <div className="px-6 py-5 flex items-start justify-between">
                <h2 className="text-xl font-bold tracking-tight">Filters</h2>
                <button
                  type="button"
                  onClick={() => setIsFilterSheetOpen(false)}
                  className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-background/60 hover:text-[#00EC97] transition-colors"
                  aria-label="Close filters"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-6 min-h-0 pb-4">
                <div className="relative mb-6">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    type="search"
                    placeholder="Search products..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 h-10 bg-background/70 border border-border/60 rounded-lg text-sm focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-[#00EC97]"
                  />
                </div>
                <div>
                  <button onClick={() => toggleSection('sort')} className="w-full flex items-center justify-between py-4 hover:opacity-80">
                    <span className="font-medium text-base">Sort</span>
                    {expandedSections.sort ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                  {expandedSections.sort && (
                    <div className="pb-4 space-y-3">
                      {(['relevance', 'price-low-high', 'price-high-low'] as const).map((opt) => (
                        <label key={opt} className="flex items-center gap-3 cursor-pointer">
                          <input type="radio" name="sort" checked={sortBy === opt} onChange={() => setSortBy(opt)} className="sr-only" />
                          <div className={cn('h-4 w-4 rounded-full border-2 flex-shrink-0', sortBy === opt ? 'bg-[#00EC97] border-[#00EC97]' : 'bg-transparent border-border/60')} />
                          <span className="text-sm">
                            {opt === 'relevance' ? 'Relevance' : opt === 'price-low-high' ? 'Price: Low to High' : 'Price: High to Low'}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <button onClick={() => toggleSection('category')} className="w-full flex items-center justify-between py-4 hover:opacity-80">
                    <span className="font-medium text-base">Category</span>
                    {expandedSections.category ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                  {expandedSections.category && (
                    <div className="pb-4 space-y-3">
                      {productTypeCategoriesForFilter.map((cat) => (
                        <label key={cat.key} className="flex items-center gap-3 cursor-pointer">
                          <input type="radio" name="category" checked={categoryFilter === cat.key} onChange={() => setCategoryFilter(cat.key)} className="sr-only" />
                          <div className={cn('h-4 w-4 rounded-full border-2 flex-shrink-0', categoryFilter === cat.key ? 'bg-[#00EC97] border-[#00EC97]' : 'bg-transparent border-border/60')} />
                          <span className="text-sm">{cat.label}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                {availableSizes.length > 0 && (
                  <div>
                    <button onClick={() => toggleSection('sizes')} className="w-full flex items-center justify-between py-4 hover:opacity-80">
                      <span className="font-medium text-base">Size</span>
                      {expandedSections.sizes ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                    {expandedSections.sizes && (
                      <div className="pb-4">
                        <div className="grid grid-cols-4 gap-2">
                          <label className="flex items-center gap-2 cursor-pointer">
                            <input type="radio" name="size" checked={sizeFilter === 'all'} onChange={() => setSizeFilter('all')} className="sr-only" />
                            <div className={cn('h-4 w-4 rounded border-2 flex-shrink-0', sizeFilter === 'all' ? 'bg-[#00EC97] border-[#00EC97]' : 'bg-transparent border-border/60')} />
                            <span className="text-sm">All</span>
                          </label>
                          {availableSizes.map((size) => (
                            <label key={size} className="flex items-center gap-2 cursor-pointer">
                              <input type="radio" name="size" checked={sizeFilter === size} onChange={() => setSizeFilter(size)} className="sr-only" />
                              <div className={cn('h-4 w-4 rounded border-2 flex-shrink-0', sizeFilter === size ? 'bg-[#00EC97] border-[#00EC97]' : 'bg-transparent border-border/60')} />
                              <span className="text-sm">{size}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {availableColors.length > 0 && (
                  <div>
                    <button onClick={() => toggleSection('color')} className="w-full flex items-center justify-between py-4 hover:opacity-80">
                      <span className="font-medium text-base">Color</span>
                      {expandedSections.color ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                    {expandedSections.color && (
                      <div className="pb-4">
                        <div className="grid grid-cols-4 gap-3">
                          <label className="flex flex-col items-center gap-2 cursor-pointer">
                            <input type="radio" name="color" checked={colorFilter === 'all'} onChange={() => setColorFilter('all')} className="sr-only" />
                            <div className={cn('w-10 h-10 rounded-lg border-2 overflow-hidden', colorFilter === 'all' ? 'border-[#00EC97]' : 'border-border/60')}>
                              <div className="w-full h-full rounded-lg bg-gradient-to-br from-gray-200 to-gray-400" />
                            </div>
                            <span className="text-xs">All</span>
                          </label>
                          {availableColors.map((color) => (
                            <label key={color} className="flex flex-col items-center gap-2 cursor-pointer">
                              <input type="radio" name="color" checked={colorFilter === color} onChange={() => setColorFilter(color)} className="sr-only" />
                              <div className={cn('w-10 h-10 rounded-lg border-2 overflow-hidden', colorFilter === color ? 'border-[#00EC97]' : 'border-border/60')}>
                                <div className="w-full h-full rounded-lg" style={{ backgroundColor: COLOR_MAP[color] || '#808080' }} />
                              </div>
                              <span className="text-xs text-center">{color}</span>
                            </label>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {availableBrands.length > 0 && (
                  <div>
                    <button onClick={() => toggleSection('brand')} className="w-full flex items-center justify-between py-4 hover:opacity-80">
                      <span className="font-medium text-base">Brand</span>
                      {expandedSections.brand ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                    {expandedSections.brand && (
                      <div className="pb-4 space-y-3">
                        <label className="flex items-center gap-3 cursor-pointer">
                          <input type="radio" name="brand" checked={brandFilter === 'all'} onChange={() => setBrandFilter('all')} className="sr-only" />
                          <div className={cn('h-4 w-4 rounded-full border-2 flex-shrink-0', brandFilter === 'all' ? 'bg-[#00EC97] border-[#00EC97]' : 'bg-transparent border-border/60')} />
                          <span className="text-sm">All Brands</span>
                        </label>
                        {availableBrands.map((brand) => (
                          <label key={brand} className="flex items-center gap-3 cursor-pointer">
                            <input type="radio" name="brand" checked={brandFilter === brand} onChange={() => setBrandFilter(brand)} className="sr-only" />
                            <div className={cn('h-4 w-4 rounded-full border-2 flex-shrink-0', brandFilter === brand ? 'bg-[#00EC97] border-[#00EC97]' : 'bg-transparent border-border/60')} />
                            <span className="text-sm">{brand}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <button onClick={() => toggleSection('price')} className="w-full flex items-center justify-between py-4 hover:opacity-80">
                    <span className="font-medium text-base">Price</span>
                    {expandedSections.price ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                  {expandedSections.price && (
                    <div className="pb-4 space-y-3">
                      {(['all', 'under-50', '50-100', '100-200', 'over-200'] as const).map((opt) => (
                        <label key={opt} className="flex items-center gap-3 cursor-pointer">
                          <input type="radio" name="price" checked={priceRange === opt} onChange={() => setPriceRange(opt)} className="sr-only" />
                          <div className={cn('h-4 w-4 rounded-full border-2 flex-shrink-0', priceRange === opt ? 'bg-[#00EC97] border-[#00EC97]' : 'bg-transparent border-border/60')} />
                          <span className="text-sm">
                            {opt === 'all' ? 'All Prices' : opt === 'under-50' ? 'Under $50' : opt === '50-100' ? '$50 - $100' : opt === '100-200' ? '$100 - $200' : 'Over $200'}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <button onClick={() => toggleSection('collections')} className="w-full flex items-center justify-between py-4 hover:opacity-80">
                    <span className="font-medium text-base">Collections</span>
                    {expandedSections.collections ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </button>
                  {expandedSections.collections && (
                    <div className="pb-4 space-y-3">
                      <Link
                        to="/collections/$collection"
                        params={{ collection: 'all' }}
                        onClick={() => setIsFilterSheetOpen(false)}
                        className={cn(
                          'flex items-center gap-3 py-1 cursor-pointer',
                          collectionSlug === 'all' && 'font-semibold text-[#00EC97]'
                        )}
                      >
                        <span className="text-sm">All</span>
                      </Link>
                      {allCollections.map((c) => (
                        <Link
                          key={c.slug}
                          to="/collections/$collection"
                          params={{ collection: c.slug }}
                          onClick={() => setIsFilterSheetOpen(false)}
                          className={cn(
                            'flex items-center gap-3 py-1 cursor-pointer',
                            c.slug === collectionSlug && 'font-semibold text-[#00EC97]'
                          )}
                        >
                          <span className="text-sm">{c.name}</span>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </SheetContent>
        </Sheet>

        {/* Products Section */}
        <div className="rounded-2xl bg-background/60 backdrop-blur-sm border border-border/60 p-4 md:p-6 overflow-hidden">
          {filteredProducts.length === 0 ? (
            <p className="text-center text-foreground/70 dark:text-muted-foreground py-12">No products found.</p>
          ) : (
            <>
              <div className={cn('md:hidden grid gap-4 md:gap-6', viewMode === 'single' ? 'grid-cols-1' : 'grid-cols-2')}>
                {filteredProducts.map((product) => (
                  <ProductCard key={product.id} product={product} onQuickAdd={handleAddToCart} variant="lg" />
                ))}
              </div>
              <div className="hidden md:grid grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                {filteredProducts.map((product) => (
                  <ProductCard key={product.id} product={product} onQuickAdd={handleAddToCart} variant="lg" />
                ))}
              </div>
            </>
          )}
        </div>

        {/* View All Collections */}
        <div className="flex justify-center py-8 md:py-12 mb-12">
          <Link
            to="/collections"
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 md:px-8 md:py-3 rounded-lg bg-background/60 backdrop-blur-sm border border-border/60 hover:bg-[#00EC97] hover:border-[#00EC97] hover:text-black transition-colors font-semibold text-xs md:text-base h-[40px] md:h-auto"
          >
            View all collections
            <ChevronRight className="h-5 w-5" />
          </Link>
        </div>
      </div>

      <SizeSelectionModal
        product={sizeModalProduct}
        isOpen={!!sizeModalProduct}
        onClose={() => setSizeModalProduct(null)}
        onAddToCart={handleAddToCartFromModal}
      />

      <CartSidebar isOpen={isCartSidebarOpen} onClose={() => setIsCartSidebarOpen(false)} />
    </PageTransition>
  );
}
