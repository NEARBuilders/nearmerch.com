import { describe, expect, it } from 'vitest';
import { Effect } from 'every-plugin/effect';
import type { CreateOrderInput } from '@/services/fulfillment/schema';
import { QikinkService } from '@/services/fulfillment/qikink/service';
import {
  QIKINK_DOCUMENTED_PRINT_TYPE_ID,
  QIKINK_ORDER_CREATE_PATH,
  QIKINK_ORDER_NUMBER_MAX_LENGTH,
  QIKINK_DESIGN_CODE_MAX_LENGTH,
  QIKINK_STANDARD_SHIPPING_RATE_ID,
  mapQikinkDesignFromItem,
  toQikinkCreateOrderPayload,
  toQikinkDesignCode,
  toQikinkOrderNumber,
  toQikinkPlacementSku,
} from '@/services/fulfillment/qikink/orders';
import { toQikinkProviderConfig } from '@/services/fulfillment/qikink/catalog';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sampleInput(overrides?: Partial<CreateOrderInput>): CreateOrderInput {
  return {
    externalId: 'oabcdefghijklmno',
    recipient: {
      name: 'John Doe',
      address1: '123 Main Street',
      city: 'Mumbai',
      stateCode: 'Maharashtra',
      countryCode: 'IN',
      zip: '400001',
      phone: '9876543210',
      email: 'john.doe@example.com',
    },
    items: [
      {
        quantity: 2,
        providerConfig: { ...toQikinkProviderConfig({
          sku: 'classic-round-neck-tee-white-m',
          placementSku: 'Front',
          catalogProductId: 'qikink-classic-round-neck-tee',
          catalogVariantId: 'qikink-classic-round-neck-tee-white-m',
          printMethod: 'DTG',
        }) },
        files: [
          {
            assetId: 'design-front-1',
            url: 'https://assets.example.com/front.png',
            slot: 'Front',
          },
        ],
      },
    ],
    ...overrides,
  };
}

describe('Qikink order payload mapping', () => {
  it('maps providerConfig and artwork into the documented create-order shape', () => {
    const payload = toQikinkCreateOrderPayload(sampleInput());

    expect(payload.gateway).toBe('Prepaid');
    expect(payload.qikink_shipping).toBe('1');
    expect(payload.order_number.length).toBeLessThanOrEqual(QIKINK_ORDER_NUMBER_MAX_LENGTH);
    expect(payload.total_order_value).toBe('320');
    expect(typeof payload.total_order_value).toBe('string');
    expect(payload.line_items).toEqual([
      {
        search_from_my_products: 0,
        sku: 'classic-round-neck-tee-white-m',
        quantity: '2',
        price: '160',
        print_type_id: QIKINK_DOCUMENTED_PRINT_TYPE_ID,
        designs: [
          {
            design_code: 'design-front-1',
            width_inches: '',
            height_inches: '',
            placement_sku: 'fr',
            design_link: 'https://assets.example.com/front.png',
            mockup_link: 'https://assets.example.com/front.png',
          },
        ],
      },
    ]);
    expect(payload.line_items[0]).not.toHaveProperty('design_code');
    expect(payload.line_items[0]).not.toHaveProperty('mockup_link');
    expect(payload.line_items[0]).not.toHaveProperty('placement_sku');

    const design = mapQikinkDesignFromItem(sampleInput().items[0]!);
    expect(design).toEqual({
      design_code: 'design-front-1',
      width_inches: '',
      height_inches: '',
      placement_sku: 'fr',
      design_link: 'https://assets.example.com/front.png',
      mockup_link: 'https://assets.example.com/front.png',
    });
    expect(payload.shipping_address).toMatchObject({
      first_name: 'John',
      last_name: 'Doe',
      zip: '400001',
      phone: '9876543210',
      country_code: 'IN',
    });
  });

  it('truncates order_number to 15 characters', () => {
    expect(toQikinkOrderNumber('oabcdefghijklmnoEXTRA')).toBe('oabcdefghijklmn');
    expect(toQikinkOrderNumber('oabcdefghijklmnoEXTRA').length).toBe(15);
    expect(toQikinkOrderNumber('oabcdefghijklmno')).toBe(toQikinkOrderNumber('oabcdefghijklmno'));
  });

  it('uses T2 catalog INR cost for Qikink price, not a retail/USD providerConfig.price', () => {
    const payload = toQikinkCreateOrderPayload(sampleInput({
      items: [{
        ...sampleInput().items[0]!,
        providerConfig: {
          ...sampleInput().items[0]!.providerConfig,
          price: 25,
        },
      }],
    }));

    expect(payload.line_items[0]?.price).toBe('160');
    expect(payload.total_order_value).toBe('320');
  });

  it('maps T4 catalog-builder config (catalog ids + files, no sku/placementSku) into Qikink fields', () => {
    const payload = toQikinkCreateOrderPayload(sampleInput({
      items: [{
        quantity: 1,
        providerConfig: {
          catalogProductId: 'qikink-classic-round-neck-tee',
          catalogVariantId: 'qikink-classic-round-neck-tee-white-m',
        },
        files: [
          {
            assetId: 't4-asset-front',
            url: 'https://cdn.example.com/t4-front.png',
            slot: 'Front',
          },
        ],
      }],
    }));

    expect(payload.line_items[0]).toMatchObject({
      search_from_my_products: 0,
      sku: 'classic-round-neck-tee-white-m',
      price: '160',
      print_type_id: QIKINK_DOCUMENTED_PRINT_TYPE_ID,
      designs: [
        {
          design_code: 't4-asset-front',
          width_inches: '',
          height_inches: '',
          placement_sku: 'fr',
          design_link: 'https://cdn.example.com/t4-front.png',
          mockup_link: 'https://cdn.example.com/t4-front.png',
        },
      ],
    });
    expect(payload.line_items[0]).not.toHaveProperty('design_code');
  });

  it('defaults placement_sku to fr when T4 files have no slot yet', () => {
    const payload = toQikinkCreateOrderPayload(sampleInput({
      items: [{
        quantity: 1,
        providerConfig: {
          catalogProductId: 'qikink-classic-round-neck-tee',
          catalogVariantId: 'qikink-classic-round-neck-tee-white-m',
        },
        files: [
          {
            assetId: 't4-asset-unslotted',
            url: 'https://cdn.example.com/t4.png',
          },
        ],
      }],
    }));

    expect(payload.line_items[0]?.designs?.[0]?.placement_sku).toBe('fr');
    expect(payload.line_items[0]?.designs?.[0]?.design_code).toBe('t4-asset-unslotted');
    expect(payload.line_items[0]?.designs?.[0]?.design_link).toBe('https://cdn.example.com/t4.png');
    expect(payload.line_items[0]?.designs?.[0]?.mockup_link).toBe('https://cdn.example.com/t4.png');
  });

  it('maps documented placement names to Qikink placement codes', () => {
    expect(toQikinkPlacementSku('Front')).toBe('fr');
    expect(toQikinkPlacementSku('Back')).toBe('bk');
    expect(toQikinkPlacementSku('Left Pocket')).toBe('lp');
    expect(toQikinkPlacementSku('RightShoulder')).toBe('rs');
    expect(toQikinkPlacementSku('ls')).toBe('ls');
  });

  it('truncates design_code to 20 characters', () => {
    expect(toQikinkDesignCode('qikink-test-design-front').length).toBeLessThanOrEqual(QIKINK_DESIGN_CODE_MAX_LENGTH);
    expect(toQikinkDesignCode('qikink-test-design-front')).toBe('qikink-test-design-f');
    expect(toQikinkDesignCode('design-front-1')).toBe('design-front-1');
  });

  it('sends the documented print_type_id example value by default', () => {
    const withoutId = toQikinkCreateOrderPayload(sampleInput());
    expect(withoutId.line_items[0]?.print_type_id).toBe(QIKINK_DOCUMENTED_PRINT_TYPE_ID);

    const withId = toQikinkCreateOrderPayload(sampleInput({
      items: [{
        ...sampleInput().items[0]!,
        providerConfig: {
          ...sampleInput().items[0]!.providerConfig,
          printTypeId: 2,
        },
      }],
    }));
    expect(withId.line_items[0]?.print_type_id).toBe(2);
  });

  it('requires artwork on the local draft when search_from_my_products is 0', () => {
    expect(() => toQikinkCreateOrderPayload(sampleInput({
      items: [{
        ...sampleInput().items[0]!,
        files: [],
      }],
    }))).toThrow(/design artwork/);
  });

  it('omits designs and uses My Products SKU cost when search_from_my_products is 1', () => {
    const payload = toQikinkCreateOrderPayload(sampleInput({
      items: [{
        quantity: 1,
        providerConfig: {
          ...toQikinkProviderConfig({
            sku: 'UOsRgHs-BkCm-XS',
            placementSku: 'Front',
            catalogProductId: 'qikink-unisex-oversized-raglan',
            catalogVariantId: 'qikink-UOsRgHs-BkCm-XS',
            searchFromMyProducts: 1,
            printTypeId: 1,
            basePriceInr: 378,
          }),
        },
        files: [],
      }],
    }));

    expect(payload.line_items[0]).toEqual({
      search_from_my_products: 1,
      sku: 'UOsRgHs-BkCm-XS',
      quantity: '1',
      price: '378',
    });
    expect(payload.line_items[0]).not.toHaveProperty('designs');
    expect(payload.line_items[0]).not.toHaveProperty('print_type_id');
    expect(payload.total_order_value).toBe('378');
  });

  it('rejects unknown SKUs that have no fixture price and no basePriceInr', () => {
    expect(() => toQikinkCreateOrderPayload(sampleInput({
      items: [{
        quantity: 1,
        providerConfig: { sku: 'not-a-fixture-sku', searchFromMyProducts: 1 },
        files: [],
      }],
    }))).toThrow(/basePriceInr/);
  });
});

describe('Qikink shipping quote fallback', () => {
  it('returns the isolated qikink-standard fallback without calling Qikink', async () => {
    const calls: string[] = [];
    const service = new QikinkService({
      clientId: 'client-123',
      clientSecret: 'secret-456',
      environment: 'sandbox',
      fetch: async (input) => {
        calls.push(String(input));
        throw new Error('shipping must not call Qikink');
      },
    });

    const quote = await Effect.runPromise(service.quoteShipping({
      recipient: sampleInput().recipient,
      items: sampleInput().items,
      currency: 'USD',
    }));

    expect(quote.rates).toHaveLength(1);
    expect(quote.rates[0]?.id).toBe(QIKINK_STANDARD_SHIPPING_RATE_ID);
    expect(quote.rates[0]?.rate).toBe(0);
    expect(quote.currency).toBe('USD');
    expect(quote.rates[0]?.name).toMatch(/fallback/i);
    expect(quote.rates[0]?.name).toMatch(/TBD/i);
    expect(calls).toEqual([]);
  });

  it('rejects shipping quotes missing phone or pincode', async () => {
    const service = new QikinkService({
      clientId: 'client-123',
      clientSecret: 'secret-456',
      environment: 'sandbox',
      fetch: async () => {
        throw new Error('shipping must not call Qikink');
      },
    });

    await expect(Effect.runPromise(service.quoteShipping({
      recipient: { ...sampleInput().recipient, phone: '' },
      items: sampleInput().items,
    }))).rejects.toThrow(/Phone number/);
  });
});

describe('Qikink draft/confirm split', () => {
  it('createOrder stores a local draft and never calls /api/order/create', async () => {
    const calls: string[] = [];
    const service = new QikinkService({
      clientId: 'client-123',
      clientSecret: 'secret-456',
      environment: 'sandbox',
      fetch: async (input) => {
        calls.push(String(input));
        throw new Error('createOrder must not call Qikink');
      },
    });

    const draft = await Effect.runPromise(service.createOrder(sampleInput()));

    expect(draft.status).toBe('draft');
    expect(draft.id).toMatch(/^qk_/);
    expect(calls).toEqual([]);

    const lookedUp = await Effect.runPromise(service.getOrder({ id: draft.id }));
    expect(lookedUp.order.id).toBe(draft.id);
    expect(lookedUp.order.status).toBe('draft');
    expect(lookedUp.order.externalId).toBe('oabcdefghijklmn');
    expect(calls).toEqual([]);
  });

  it('confirmOrder posts Prepaid create-order and is idempotent on retry', async () => {
    const calls: Array<{ url: string; body?: string }> = [];
    const service = new QikinkService({
      clientId: 'client-123',
      clientSecret: 'secret-456',
      environment: 'sandbox',
      fetch: async (input, init) => {
        const url = String(input);
        calls.push({ url, body: typeof init?.body === 'string' ? init.body : undefined });
        if (url.endsWith('/api/token')) {
          return jsonResponse({ Accesstoken: 'token-1', expires_in: 3600 });
        }
        if (url.endsWith(QIKINK_ORDER_CREATE_PATH)) {
          return jsonResponse({ order_id: 'qk-live-99' });
        }
        throw new Error(`unexpected URL ${url}`);
      },
    });

    const draft = await Effect.runPromise(service.createOrder(sampleInput()));
    const first = await Effect.runPromise(service.confirmOrder({ id: draft.id }));
    const second = await Effect.runPromise(service.confirmOrder({ id: draft.id }));

    const orderCalls = calls.filter((call) => call.url.endsWith(QIKINK_ORDER_CREATE_PATH));
    expect(orderCalls).toHaveLength(1);
    expect(first).toEqual({ id: 'qk-live-99', status: 'processing' });
    expect(second).toEqual(first);

    const payload = JSON.parse(orderCalls[0]!.body!);
    expect(payload.gateway).toBe('Prepaid');
    expect(payload.order_number.length).toBeLessThanOrEqual(15);
    expect(typeof payload.line_items[0].quantity).toBe('string');
    expect(typeof payload.line_items[0].price).toBe('string');
    expect(typeof payload.total_order_value).toBe('string');
    expect(payload.line_items[0].search_from_my_products).toBe(0);
    expect(payload.line_items[0].sku).toBe('classic-round-neck-tee-white-m');
    expect(payload.line_items[0].print_type_id).toBe(QIKINK_DOCUMENTED_PRINT_TYPE_ID);
    expect(payload.line_items[0].designs).toEqual([
      {
        design_code: 'design-front-1',
        width_inches: '',
        height_inches: '',
        placement_sku: 'fr',
        design_link: 'https://assets.example.com/front.png',
        mockup_link: 'https://assets.example.com/front.png',
      },
    ]);
    expect(payload.line_items[0]).not.toHaveProperty('design_code');
  });

  it('dedupes concurrent confirmOrder calls for the same draft', async () => {
    let orderCalls = 0;
    const service = new QikinkService({
      clientId: 'client-123',
      clientSecret: 'secret-456',
      environment: 'sandbox',
      fetch: async (input) => {
        const url = String(input);
        if (url.endsWith('/api/token')) {
          return jsonResponse({ Accesstoken: 'token-1', expires_in: 3600 });
        }
        if (url.endsWith(QIKINK_ORDER_CREATE_PATH)) {
          orderCalls += 1;
          await new Promise((resolve) => setTimeout(resolve, 40));
          return jsonResponse({ order_id: 'qk-live-concurrent' });
        }
        throw new Error(`unexpected URL ${url}`);
      },
    });

    const draft = await Effect.runPromise(service.createOrder(sampleInput()));
    const [first, second] = await Promise.all([
      Effect.runPromise(service.confirmOrder({ id: draft.id })),
      Effect.runPromise(service.confirmOrder({ id: draft.id })),
    ]);

    expect(orderCalls).toBe(1);
    expect(first).toEqual(second);
    expect(first.id).toBe('qk-live-concurrent');
  });

  it('unpaid path never creates a Qikink order', async () => {
    const calls: string[] = [];
    const service = new QikinkService({
      clientId: 'client-123',
      clientSecret: 'secret-456',
      environment: 'sandbox',
      fetch: async (input) => {
        calls.push(String(input));
        throw new Error('unpaid path must not call Qikink');
      },
    });

    await Effect.runPromise(service.quoteShipping({
      recipient: sampleInput().recipient,
      items: sampleInput().items,
    }));
    await Effect.runPromise(service.createOrder(sampleInput()));

    expect(calls.some((url) => url.includes(QIKINK_ORDER_CREATE_PATH))).toBe(false);
    expect(calls).toEqual([]);
  });

  it('keeps calculateTax as an empty exempt stub', async () => {
    const service = new QikinkService({
      clientId: 'client-123',
      clientSecret: 'secret-456',
      environment: 'sandbox',
      fetch: async () => {
        throw new Error('tax must not call Qikink');
      },
    });

    const tax = await Effect.runPromise(service.calculateTax({
      recipient: {
        countryCode: sampleInput().recipient.countryCode,
        zip: sampleInput().recipient.zip,
        stateCode: sampleInput().recipient.stateCode,
      },
      items: sampleInput().items,
      currency: 'USD',
    }));

    expect(tax).toEqual({
      required: false,
      rate: 0,
      shippingTaxable: false,
      exempt: true,
    });
  });

  it('stubs contract methods Qikink does not document', async () => {
    const service = new QikinkService({
      clientId: 'client-123',
      clientSecret: 'secret-456',
      environment: 'sandbox',
      fetch: async () => {
        throw new Error('stub methods must not call Qikink');
      },
    });

    await expect(Effect.runPromise(service.getVariantPrice())).rejects.toThrow(/does not support getVariantPrice/);
    const mockups = await Effect.runPromise(service.generateMockups());
    const mockupResult = await Effect.runPromise(service.getMockupResult());
    expect(mockups).toEqual({ status: 'unsupported', images: [] });
    expect(mockupResult).toEqual({ status: 'unsupported', images: [] });
  });
});
