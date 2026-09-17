import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { getPluginClient, runMigrations, teardown } from '../setup';
import { 
  clearOrders, 
  clearOrdersItems,
  clearProducts, 
  clearCollections,
  createTestProduct, 
  createTestProductVariant, 
  createTestProductWithImages,
  createTestCollection,
  addProductToCollection
} from '../helpers';

describe('Database Integration Tests', () => {
  const TEST_USER = 'test-user.near';

  beforeAll(async () => {
    await runMigrations();
  });

  afterAll(async () => {
    await teardown();
  });

  beforeEach(async () => {
    await clearOrders();
    await clearOrdersItems();
    await clearProducts();
    await clearCollections();
  });

  afterEach(async () => {
    await clearOrders();
    await clearOrdersItems();
    await clearProducts();
    await clearCollections();
  });

  describe('Product Operations', () => {
    it('should create product with variants and images in PostgreSQL', async () => {
      const client = await getPluginClient({ nearAccountId: TEST_USER });

      const { product, images } = await createTestProductWithImages('prod_123', {
        name: 'Test T-Shirt',
        price: 2999,
        currency: 'USD',
        brand: 'Test Brand',
        fulfillmentProvider: 'printful',
        source: 'test',
        listed: true,
      });

      expect(product).toBeDefined();
      expect(product.id).toBe('prod_123');
      expect(product.name).toBe('Test T-Shirt');
      expect(product.price).toBe(2999);

      await createTestProductVariant('var_456', 'prod_123', {
        name: 'Large',
        price: 2999,
        sku: 'TS-LG-001',
        inStock: true,
      });

      const getProductsResult = await client.getProducts({});
      
      const foundProduct = getProductsResult.products.find((p: any) => p.id === 'prod_123');
      expect(foundProduct).toBeDefined();
      expect(foundProduct?.title).toBe('Test T-Shirt');

      expect(images).toHaveLength(2);
      const getImageResult = await client.getProduct({ id: 'prod_123' });
      expect(getImageResult.product.id).toBe('prod_123');
    });

    it('should list products with filters from PostgreSQL', async () => {
      const client = await getPluginClient({ nearAccountId: TEST_USER });

      await createTestProduct('prod_1', { name: 'Product A', price: 1000, listed: true, fulfillmentProvider: 'manual', source: 'test' });
      await createTestProduct('prod_2', { name: 'Product B', price: 2000, listed: true, fulfillmentProvider: 'manual', source: 'test' });
      await createTestProduct('prod_3', { name: 'Product C', price: 1500, listed: false, fulfillmentProvider: 'manual', source: 'test' });

      const result = await client.getProducts({ includeUnlisted: true });

      expect(result.products).toBeDefined();
      expect(result.products.length).toBeGreaterThanOrEqual(2);
    });

    it('should find product by ID with details from PostgreSQL', async () => {
      const client = await getPluginClient({ nearAccountId: TEST_USER });

      const { product } = await createTestProductWithImages('prod_123', {
        name: 'FindMe Product',
        description: 'A product to find',
        price: 3499,
        currency: 'USD',
        fulfillmentProvider: 'manual',
        source: 'test',
      });

      await createTestProductVariant('var_456', 'prod_123', {
        name: 'Medium',
        price: 3499,
        sku: 'FM-MED-001',
        inStock: true,
      });

      const result = await client.getProduct({ id: 'prod_123' });

      expect(result.product).toBeDefined();
      expect(result.product?.title).toBe('FindMe Product');
      expect(result.product.price).toBe(34.99);
    });

    it('should handle product with tags in PostgreSQL JSONB', async () => {
      const client = await getPluginClient({ nearAccountId: TEST_USER });

      const tags = ['summer', 'clothing', 't-shirt']
      await createTestProduct('prod_123', {
        name: 'Tagged Product',
        price: 2500,
        currency: 'USD',
        tags,
        fulfillmentProvider: 'manual',
        source: 'test',
      });

      const searchResult = await client.searchProducts({ query: 'clothing' });

      expect(searchResult.products).toBeDefined();
      expect(searchResult.products.length).toBeGreaterThan(0);
    });

    it('should filter products before applying the search result limit', async () => {
      const client = await getPluginClient({ nearAccountId: TEST_USER });

      for (let index = 0; index < 5; index += 1) {
        await createTestProduct(`prod_filler_${index}`, {
          name: `Filler Product ${index}`,
          tags: ['filler'],
          fulfillmentProvider: 'manual',
          source: 'test',
        });
      }

      await createTestProduct('prod_search_target', {
        name: 'AIAYN Search Target',
        tags: ['Rare Merch'],
        fulfillmentProvider: 'manual',
        source: 'test',
      });

      const titleResult = await client.searchProducts({ query: 'aiayn', limit: 1 });
      const tagResult = await client.searchProducts({ query: 'rare merch', limit: 1 });

      expect(titleResult.products.map((product) => product.id)).toEqual(['prod_search_target']);
      expect(tagResult.products.map((product) => product.id)).toEqual(['prod_search_target']);
    });

    it('should exclude unlisted products from search results', async () => {
      const client = await getPluginClient({ nearAccountId: TEST_USER });

      await createTestProduct('prod_hidden_search_target', {
        name: 'Hidden AIAYN Product',
        tags: ['Rare Merch'],
        listed: false,
        fulfillmentProvider: 'manual',
        source: 'test',
      });

      const result = await client.searchProducts({ query: 'aiayn', limit: 10 });

      expect(result.products).toEqual([]);
    });
  });

  describe('Collection Operations', () => {
    it('should get collections from PostgreSQL', async () => {
      const client = await getPluginClient({ nearAccountId: TEST_USER });

      await createTestCollection('summer', {
        name: 'Summer Collection',
        description: 'Best summer items',
      });

      await createTestCollection('winter', {
        name: 'Winter Collection',
        description: 'Cozy winter items',
      });

      const result = await client.getCollections({});

      expect(result.collections).toBeDefined();
      expect(result.collections.length).toBeGreaterThanOrEqual(2);
    });

    it('should add product to collection in PostgreSQL', async () => {
      const client = await getPluginClient({ nearAccountId: TEST_USER });

      await createTestProduct('prod_123', {
        name: 'Collection Product',
        price: 1999,
        currency: 'USD',
        fulfillmentProvider: 'manual',
        source: 'test',
      });

      await createTestCollection('summer', {
        name: 'Summer Collection',
        description: 'Best summer items',
      });

      await addProductToCollection('prod_123', 'summer');

      const collectionsResult = await client.getCollections({});

      expect(collectionsResult.collections).toBeDefined();
      expect(collectionsResult.collections.length).toBeGreaterThanOrEqual(1);
    });

    it('should get carousel collections from PostgreSQL', async () => {
      const client = await getPluginClient({ nearAccountId: TEST_USER });

      await createTestCollection('featured', {
        name: 'Featured Collection',
        showInCarousel: true,
        carouselOrder: 1,
      });

      await createTestCollection('hidden', {
        name: 'Hidden Collection',
        showInCarousel: false,
        carouselOrder: 2,
      });

      const result = await client.getCarouselCollections({});

      expect(result.collections).toBeDefined();
      expect(result.collections.length).toBeGreaterThanOrEqual(1);
      expect(result.collections.every((c: any) => c.showInCarousel === true)).toBe(true);
    });
  });

  describe('Order Operations', () => {
    it('should create and find order in PostgreSQL', async () => {
      const client = await getPluginClient({ nearAccountId: TEST_USER });

      await createTestProduct('prod_1', {
        name: 'Test Product 1',
        price: 1000,
        currency: 'USD',
        fulfillmentProvider: 'manual',
        source: 'test',
      });

      await createTestProductVariant('var_1', 'prod_1', {
        name: 'Variant 1',
        price: 1000,
        sku: 'SKU-001',
        inStock: true,
      });

      await createTestProduct('prod_2', {
        name: 'Test Product 2',
        price: 1500,
        currency: 'USD',
        fulfillmentProvider: 'manual',
        source: 'test',
      });

      await createTestProductVariant('var_2', 'prod_2', {
        name: 'Variant 2',
        price: 1500,
        sku: 'SKU-002',
        inStock: true,
      });

      const quoteResult = await client.quote({
        items: [
          { productId: 'prod_1', variantId: 'var_1', quantity: 2 },
          { productId: 'prod_2', variantId: 'var_2', quantity: 1 },
        ],
        shippingAddress: {
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@example.com',
          addressLine1: '123 Main St',
          city: 'Los Angeles',
          state: 'CA',
          postCode: '90001',
          country: 'US',
        },
      });

      expect(quoteResult).toBeDefined();
      expect(quoteResult.total).toBeDefined();

      const selectedRates: Record<string, string> = {};
      quoteResult.providerBreakdown.forEach((provider: any) => {
        selectedRates[provider.provider] = provider.selectedShipping.rateId;
      });

      const checkoutResult = await client.createCheckout({
        items: [
          { productId: 'prod_1', variantId: 'var_1', quantity: 2 },
        ],
        shippingAddress: {
          firstName: 'John',
          lastName: 'Doe',
          email: 'john@example.com',
          addressLine1: '123 Main St',
          city: 'Los Angeles',
          state: 'CA',
          postCode: '90001',
          country: 'US',
        },
        selectedRates,
        shippingCost: quoteResult.shippingCost,
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
        paymentProvider: 'pingpay',
      });

      expect(checkoutResult).toBeDefined();
      expect(checkoutResult.checkoutSessionId).toBeDefined();
      expect(checkoutResult.orderId).toBeDefined();

      const order = await client.getOrder({ id: checkoutResult.orderId });

      expect(order.order).toBeDefined();
      expect(order.order.id).toBe(checkoutResult.orderId);
    });

    it('should append dynamic referral fees for eligible products', async () => {
      const client = await getPluginClient({ nearAccountId: TEST_USER });

      await createTestProduct('prod_ref', {
        name: 'Referral Product',
        price: 1000,
        currency: 'USD',
        fulfillmentProvider: 'manual',
        source: 'test',
        metadata: {
          fees: [],
          affiliate: {
            referral: {
              enabled: true,
              feeBps: 2000,
            },
          },
        },
      });

      await createTestProductVariant('var_ref', 'prod_ref', {
        name: 'Referral Variant',
        price: 1000,
        sku: 'SKU-REF-001',
        inStock: true,
      });

      const quoteResult = await client.quote({
        items: [{ productId: 'prod_ref', variantId: 'var_ref', quantity: 1 }],
        shippingAddress: {
          firstName: 'Referral',
          lastName: 'Buyer',
          email: 'buyer@example.com',
          addressLine1: '123 Main St',
          city: 'Los Angeles',
          state: 'CA',
          postCode: '90001',
          country: 'US',
        },
      });

      const selectedRates: Record<string, string> = {};
      quoteResult.providerBreakdown.forEach((provider: any) => {
        selectedRates[provider.provider] = provider.selectedShipping.rateId;
      });

      const checkoutResult = await client.createCheckout({
        items: [
          {
            productId: 'prod_ref',
            variantId: 'var_ref',
            quantity: 1,
            referralAccountId: 'referrer.near',
          },
        ],
        shippingAddress: {
          firstName: 'Referral',
          lastName: 'Buyer',
          email: 'buyer@example.com',
          addressLine1: '123 Main St',
          city: 'Los Angeles',
          state: 'CA',
          postCode: '90001',
          country: 'US',
        },
        selectedRates,
        shippingCost: quoteResult.shippingCost,
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
        paymentProvider: 'pingpay',
      });

      const order = await client.getOrder({ id: checkoutResult.orderId });
      const paymentDetails = order.order.paymentDetails as any;
      const requestFees = paymentDetails?.request?.fees as Array<any> | undefined;
      const referralItems = paymentDetails?.referral?.items as Array<any> | undefined;

      expect(requestFees).toBeDefined();
      expect(requestFees).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'affiliate',
            label: 'Referral',
            recipient: 'referrer.near',
            bps: 2000,
          }),
        ]),
      );
      expect(referralItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            productId: 'prod_ref',
            recipient: 'referrer.near',
            configuredFeeBps: 2000,
          }),
        ]),
      );
    });

    it('should split referral fees proportionally across the full order total', async () => {
      const client = await getPluginClient({ nearAccountId: TEST_USER });

      await createTestProduct('prod_book', {
        name: 'Book',
        price: 2000,
        currency: 'USD',
        fulfillmentProvider: 'manual',
        source: 'test',
        metadata: {
          fees: [],
          affiliate: {
            referral: {
              enabled: true,
              feeBps: 5000,
            },
          },
        },
      });

      await createTestProductVariant('var_book', 'prod_book', {
        name: 'Book Variant',
        price: 2000,
        sku: 'SKU-BOOK-001',
        inStock: true,
      });

      await createTestProduct('prod_poster', {
        name: 'Poster',
        price: 3000,
        currency: 'USD',
        fulfillmentProvider: 'manual',
        source: 'test',
        metadata: {
          fees: [],
          affiliate: {
            referral: {
              enabled: true,
              feeBps: 1000,
            },
          },
        },
      });

      await createTestProductVariant('var_poster', 'prod_poster', {
        name: 'Poster Variant',
        price: 3000,
        sku: 'SKU-POSTER-001',
        inStock: true,
      });

      await createTestProduct('prod_other', {
        name: 'Other',
        price: 5000,
        currency: 'USD',
        fulfillmentProvider: 'manual',
        source: 'test',
        metadata: {
          fees: [],
        },
      });

      await createTestProductVariant('var_other', 'prod_other', {
        name: 'Other Variant',
        price: 5000,
        sku: 'SKU-OTHER-001',
        inStock: true,
      });

      const quoteResult = await client.quote({
        items: [
          { productId: 'prod_book', variantId: 'var_book', quantity: 1 },
          { productId: 'prod_poster', variantId: 'var_poster', quantity: 1 },
          { productId: 'prod_other', variantId: 'var_other', quantity: 1 },
        ],
        shippingAddress: {
          firstName: 'Referral',
          lastName: 'Buyer',
          email: 'buyer@example.com',
          addressLine1: '123 Main St',
          city: 'Los Angeles',
          state: 'CA',
          postCode: '90001',
          country: 'US',
        },
      });

      const selectedRates: Record<string, string> = {};
      quoteResult.providerBreakdown.forEach((provider: any) => {
        selectedRates[provider.provider] = provider.selectedShipping.rateId;
      });

      const checkoutResult = await client.createCheckout({
        items: [
          {
            productId: 'prod_book',
            variantId: 'var_book',
            quantity: 1,
            referralAccountId: 'reader.near',
          },
          {
            productId: 'prod_poster',
            variantId: 'var_poster',
            quantity: 1,
            referralAccountId: 'artist.near',
          },
          {
            productId: 'prod_other',
            variantId: 'var_other',
            quantity: 1,
          },
        ],
        shippingAddress: {
          firstName: 'Referral',
          lastName: 'Buyer',
          email: 'buyer@example.com',
          addressLine1: '123 Main St',
          city: 'Los Angeles',
          state: 'CA',
          postCode: '90001',
          country: 'US',
        },
        selectedRates,
        shippingCost: quoteResult.shippingCost,
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
        paymentProvider: 'pingpay',
      });

      const order = await client.getOrder({ id: checkoutResult.orderId });
      const paymentDetails = order.order.paymentDetails as any;
      const requestFees = paymentDetails?.request?.fees as Array<any> | undefined;
      const referralItems = paymentDetails?.referral?.items as Array<any> | undefined;

      expect(requestFees).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            recipient: 'reader.near',
            bps: 1000,
          }),
          expect.objectContaining({
            recipient: 'artist.near',
            bps: 300,
          }),
        ]),
      );

      const bookReferral = referralItems?.find((item) => item.productId === 'prod_book');
      const posterReferral = referralItems?.find((item) => item.productId === 'prod_poster');

      expect(bookReferral).toMatchObject({
        recipient: 'reader.near',
        configuredFeeBps: 5000,
        itemSubtotal: 20,
      });
      expect(bookReferral?.allocationWeight).toBeCloseTo(0.2);
      expect(bookReferral?.allocatedTotalAmount).toBeCloseTo(20);
      expect(bookReferral?.feeAmount).toBeCloseTo(10);

      expect(posterReferral).toMatchObject({
        recipient: 'artist.near',
        configuredFeeBps: 1000,
        itemSubtotal: 30,
      });
      expect(posterReferral?.allocationWeight).toBeCloseTo(0.3);
      expect(posterReferral?.allocatedTotalAmount).toBeCloseTo(30);
      expect(posterReferral?.feeAmount).toBeCloseTo(3);
    });

    it('should find order by checkout session ID from PostgreSQL', async () => {
      const client = await getPluginClient({ nearAccountId: TEST_USER });

      await createTestProduct('prod_1', {
        name: 'Test Product',
        price: 1000,
        currency: 'USD',
        fulfillmentProvider: 'manual',
        source: 'test',
      });

      await createTestProductVariant('var_1', 'prod_1', {
        name: 'Variant 1',
        price: 1000,
        sku: 'SKU-001',
        inStock: true,
      });

      const quoteResult = await client.quote({
        items: [
          { productId: 'prod_1', variantId: 'var_1', quantity: 1 },
        ],
        shippingAddress: {
          firstName: 'Jane',
          lastName: 'Smith',
          email: 'jane@example.com',
          addressLine1: '456 Oak Ave',
          city: 'San Francisco',
          state: 'CA',
          postCode: '94102',
          country: 'US',
        },
      });

      const selectedRates: Record<string, string> = {};
      quoteResult.providerBreakdown.forEach((provider: any) => {
        selectedRates[provider.provider] = provider.selectedShipping.rateId;
      });

      const checkoutResult = await client.createCheckout({
        items: [
          { productId: 'prod_1', variantId: 'var_1', quantity: 1 },
        ],
        shippingAddress: {
          firstName: 'Jane',
          lastName: 'Smith',
          email: 'jane@example.com',
          addressLine1: '456 Oak Ave',
          city: 'San Francisco',
          state: 'CA',
          postCode: '94102',
          country: 'US',
        },
        selectedRates,
        shippingCost: quoteResult.shippingCost,
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
        paymentProvider: 'pingpay',
      });

      const sessionId = checkoutResult.checkoutSessionId;

      const result = await client.getOrderByCheckoutSession({ sessionId });
      
      expect(result.order).toBeDefined();
      expect(result.order?.id).toBe(checkoutResult.orderId);
      expect(result.order?.checkoutSessionId).toBe(sessionId);
    });

    it('should store timestamps correctly in PostgreSQL TIMESTAMPTZ', async () => {
      const client = await getPluginClient({ nearAccountId: TEST_USER });

      await createTestProduct('prod_1', {
        name: 'Timestamp Test Product',
        price: 1000,
        currency: 'USD',
        fulfillmentProvider: 'manual',
        source: 'test',
      });

      await createTestProductVariant('var_1', 'prod_1', {
        name: 'Variant 1',
        price: 1000,
        sku: 'SKU-001',
        inStock: true,
      });

      const quoteResult = await client.quote({
        items: [{ productId: 'prod_1', variantId: 'var_1', quantity: 1 }],
        shippingAddress: {
          firstName: 'Test',
          lastName: 'User',
          email: 'test@example.com',
          addressLine1: '123 Test St',
          city: 'Test City',
          state: 'CA',
          postCode: '12345',
          country: 'US',
        },
      });

      const selectedRates: Record<string, string> = {};
      quoteResult.providerBreakdown.forEach((provider: any) => {
        selectedRates[provider.provider] = provider.selectedShipping.rateId;
      });

      const creationTime = new Date().toISOString();

      const checkoutResult = await client.createCheckout({
        items: [{ productId: 'prod_1', variantId: 'var_1', quantity: 1 }],
        shippingAddress: {
          firstName: 'Test',
          lastName: 'User',
          email: 'test@example.com',
          addressLine1: '123 Test St',
          city: 'Test City',
          state: 'CA',
          postCode: '12345',
          country: 'US',
        },
        selectedRates,
        shippingCost: quoteResult.shippingCost,
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
        paymentProvider: 'pingpay',
      });

      const order = await client.getOrder({ id: checkoutResult.orderId });

      expect(order.order).toBeDefined();
      expect(order.order.createdAt).toBeDefined();
      expect(order.order.updatedAt).toBeDefined();
    });
  });
});
