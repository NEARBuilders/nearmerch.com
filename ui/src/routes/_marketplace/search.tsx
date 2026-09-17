import { createFileRoute, Link } from '@tanstack/react-router';
import { ArrowLeft } from 'lucide-react';
import { ProductCard } from '@/components/marketplace/product-card';
import { LoadingSpinner } from '@/components/loading';
import {
  getPrimaryCategoryName,
  useSearchProducts,
  useProducts,
  productLoaders,
  type Product,
} from '@/integrations/api';
import { useMemo } from 'react';

type SearchParams = {
  q?: string;
  category?: string;
};

export const Route = createFileRoute('/_marketplace/search')({
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    q: typeof search.q === 'string' ? search.q : undefined,
    category: typeof search.category === 'string' ? search.category : undefined,
  }),
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(productLoaders.list({ limit: 100 }));
  },
  component: SearchPage,
});

function SearchPage() {
  const { q } = Route.useSearch();

  const { data: searchData, isFetching: isSearching } = useSearchProducts(q || '', {
    limit: 100,
  });

  const { data: allProductsData, isLoading } = useProducts({
    limit: 100,
  });

  const normalizeSearchTerm = (term: string): string => {
    const normalized = term.toLowerCase().trim();
    const words = normalized.split(/\s+/);
    
    return words.map(word => {
      if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
      if (word.endsWith('es') && word.length > 3) return word.slice(0, -2);
      if (word.endsWith('s') && word.length > 2) return word.slice(0, -1);
      return word;
    }).join(' ');
  };

  const matchesSearchQuery = (product: Product, query: string): boolean => {
    if (!query.trim()) return true;
    
    const queryLower = query.toLowerCase().trim();
    const normalizedQuery = normalizeSearchTerm(query);
    const searchText = `${product.title} ${product.productType || ''} ${product.brand || ''} ${getPrimaryCategoryName(product) || ''}`.toLowerCase();
    const normalizedSearchText = normalizeSearchTerm(searchText);
    
    return searchText.includes(queryLower) || 
           normalizedSearchText.includes(normalizedQuery) ||
           product.title.toLowerCase().includes(queryLower) ||
           normalizeSearchTerm(product.title).includes(normalizedQuery);
  };

  const products = useMemo(() => {
    if (!q) {
      return allProductsData?.products ?? [];
    }
    
    const apiResults = searchData?.products ?? [];
    const allProducts = allProductsData?.products ?? [];
    
    const apiResultIds = new Set(apiResults.map(p => p.id));
    const additionalResults = allProducts.filter(
      product => !apiResultIds.has(product.id) && matchesSearchQuery(product, q)
    );
    
    return [...apiResults, ...additionalResults];
  }, [q, searchData, allProductsData]);

  return (
    <section className="section-padding relative z-10 bg-background pt-32">
      <div className="container-app">
        {/* Back and Title Blocks */}
        <div className="flex flex-row gap-4 mb-8">
          {/* Back Block */}
          <Link
            to="/"
            className="rounded-2xl border border-border/60 px-4 md:px-8 lg:px-10 py-4 md:py-8 flex items-center justify-center hover:border-[#00EC97] hover:text-[#00EC97] transition-colors shrink-0"
          >
            <ArrowLeft className="size-5" />
          </Link>

          {/* Title Block */}
          <div className="flex-1 rounded-2xl bg-background border border-border/60 px-6 md:px-8 lg:px-10 py-6 md:py-8">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
              <div>
                <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
                  {q ? `Search results for "${q}"` : 'All Products'}
                </h1>
              </div>
            </div>
          </div>
        </div>

        {(isLoading || (isSearching && q)) ? (
          <div className="flex items-center justify-center py-20">
            <LoadingSpinner />
          </div>
        ) : products.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {products.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                variant="sm"
              />
            ))}
          </div>
        ) : (
          <div className="rounded-2xl bg-background border border-border/60 px-6 md:px-8 lg:px-10 py-12 md:py-16 text-center">
            <p className="text-lg font-medium text-foreground/90 dark:text-muted-foreground">
              No products found {q ? `matching "${q}"` : ''}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
