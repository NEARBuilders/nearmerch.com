import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getX402CheckoutUnavailableReason,
  getX402IntentsFacilitatorApiKey,
  getX402IntentsFacilitatorUrl,
  getX402IntentsInactiveReason,
  getX402IntentsOrigins,
  isX402IntentsActive,
  isX402IntentsEnabled,
} from '@/services/payment/x402/config';
import { planX402IntentsFees } from '@/services/payment/x402/intents/fees';
import {
  buildX402IntentsQuotedEntry,
  buildX402IntentsSettleRequirements,
  findOffer,
  normalizeX402IntentsOffer,
  originAllowed,
  x402IntentsOperationKey,
} from '@/services/payment/x402/intents/requirements';
import { createX402IntentsHttpFacilitator } from '@/services/payment/x402/intents/facilitator';
import { stripOperationToken } from '@/services/payment/x402/intents/middleware';
import { createX402IntentsPayDeps } from '@/services/payment/x402/intents/host-deps';
import { X402_INTENTS_DEFAULT_FACILITATOR_URL } from '@/services/payment/x402/constants';

const ARB = 'eip155:42161';
const ARB_USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831';
const NEAR_USDC = '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
const DESTINATION = { network: 'near:mainnet', asset: NEAR_USDC, amount: '25000000', recipient: 'merchant.test.near' };

/** One entry of Ping's unquoted `GET /offers` accepts[]. */
const pingOffer = (overrides: Record<string, unknown> = {}) => ({
  scheme: 'exact',
  network: ARB,
  asset: ARB_USDC,
  amount: '',
  payTo: '',
  maxTimeoutSeconds: 300,
  description: 'nearmerch order',
  extra: {
    settlementBackend: 'near-intents',
    assetTransferMethod: 'near-intents',
    paymentFlow: 'upfront',
    destination: DESTINATION,
  },
  ...overrides,
});

const ENV_KEYS = [
  'X402_ENABLED', 'X402_PAY_TO_ADDRESS', 'X402_HOST_SECRET', 'X402_NETWORK', 'PING_API_KEY',
  'X402_INTENTS_ENABLED', 'X402_INTENTS_FACILITATOR_URL', 'X402_INTENTS_FACILITATOR_API_KEY',
  'X402_INTENTS_ORIGINS',
];

describe('x402 near-intents config', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const key of ENV_KEYS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    process.env.X402_ENABLED = 'true';
    process.env.X402_HOST_SECRET = 'secret';
    process.env.X402_INTENTS_FACILITATOR_API_KEY = 'key-123';
  });
  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('X402_INTENTS_ENABLED defaults to on, but X402_ENABLED is the master switch', () => {
    expect(isX402IntentsEnabled()).toBe(true);
    expect(isX402IntentsActive()).toBe(true);
    process.env.X402_INTENTS_ENABLED = 'false';
    expect(getX402IntentsInactiveReason()).toBe('X402_INTENTS_ENABLED is off');
    process.env.X402_INTENTS_ENABLED = 'true';
    delete process.env.X402_ENABLED;
    expect(getX402IntentsInactiveReason()).toBe('X402_ENABLED is off');
  });

  it('does not need a Base pay-to or Base mainnet', () => {
    process.env.X402_NETWORK = 'eip155:84532';
    expect(isX402IntentsActive()).toBe(true);
  });

  it('defaults to Ping production and needs an API key', () => {
    expect(getX402IntentsFacilitatorUrl()).toBe(X402_INTENTS_DEFAULT_FACILITATOR_URL);
    expect(X402_INTENTS_DEFAULT_FACILITATOR_URL).toBe('https://pay.pingpay.io/agentpay/x402');
    delete process.env.X402_INTENTS_FACILITATOR_API_KEY;
    expect(getX402IntentsInactiveReason()).toMatch(/API_KEY/);
  });

  it('falls back to PING_API_KEY only for a Ping facilitator host', () => {
    delete process.env.X402_INTENTS_FACILITATOR_API_KEY;
    process.env.PING_API_KEY = 'ping-key';
    expect(getX402IntentsFacilitatorApiKey()).toBe('ping-key');
    process.env.X402_INTENTS_FACILITATOR_URL = 'https://staging.pingpay.io/agentpay/x402/';
    expect(getX402IntentsFacilitatorUrl()).toBe('https://staging.pingpay.io/agentpay/x402');
    expect(getX402IntentsFacilitatorApiKey()).toBe('ping-key');
    process.env.X402_INTENTS_FACILITATOR_URL = 'https://other-facilitator.test';
    expect(getX402IntentsFacilitatorApiKey()).toBeUndefined();
    process.env.X402_INTENTS_FACILITATOR_API_KEY = 'explicit';
    expect(getX402IntentsFacilitatorApiKey()).toBe('explicit');
  });

  it('parses the optional origin allow-list and fails closed when it has no valid entry', () => {
    expect(getX402IntentsOrigins()).toEqual({ origins: undefined, errors: [] });
    process.env.X402_INTENTS_ORIGINS = JSON.stringify([
      'eip155:8453',
      { network: ARB, asset: ARB_USDC, decimals: 6 },
      { network: ARB, asset: ARB_USDC.toLowerCase() },
      { network: 'not a caip2' },
    ]);
    const { origins, errors } = getX402IntentsOrigins();
    expect(origins).toEqual([{ network: 'eip155:8453' }, { network: ARB, asset: ARB_USDC }]);
    expect(errors).toHaveLength(2);
    process.env.X402_INTENTS_ORIGINS = 'not json';
    expect(getX402IntentsOrigins().errors).toEqual(['X402_INTENTS_ORIGINS is not valid JSON']);
    expect(getX402IntentsInactiveReason()).toMatch(/no usable origin/);
  });

  it('x402 checkout works without a Base pay-to when the intents path is configured', () => {
    expect(getX402CheckoutUnavailableReason()).toBeNull();
    // No facilitator key: the host won't mount the pay route, so checkout must refuse too.
    delete process.env.X402_INTENTS_FACILITATOR_API_KEY;
    expect(getX402CheckoutUnavailableReason()).toMatch(/FACILITATOR_API_KEY/);
    process.env.X402_INTENTS_FACILITATOR_API_KEY = 'key-123';
    process.env.X402_INTENTS_ENABLED = 'false';
    expect(getX402CheckoutUnavailableReason()).toMatch(/pay-to address/);
    process.env.X402_PAY_TO_ADDRESS = '0x0000000000000000000000000000000000000abc';
    expect(getX402CheckoutUnavailableReason()).toBeNull();
    delete process.env.X402_ENABLED;
    expect(getX402CheckoutUnavailableReason()).toBe('x402 payments are not enabled');
  });

  it('host deps are null unless active, and send X-Api-Key only to the configured facilitator', async () => {
    const client = {} as never;
    process.env.X402_INTENTS_ENABLED = 'false';
    expect(createX402IntentsPayDeps(client)).toBeNull();
    process.env.X402_INTENTS_ENABLED = 'true';
    process.env.X402_INTENTS_FACILITATOR_URL = 'https://intents.test';
    const sent: Array<[string, string | null, string | null]> = [];
    const deps = createX402IntentsPayDeps(client, {
      fetch: (async (url: string, init: RequestInit) => {
        const headers = new Headers(init.headers);
        sent.push([url, headers.get('x-api-key'), headers.get('authorization')]);
        return Response.json({ isValid: false, invalidReason: 'x' });
      }) as typeof fetch,
    })!;
    expect(deps.origins).toBeUndefined();
    expect(deps.facilitatorUrl).toBe('https://intents.test');
    expect(deps.getFacilitator('https://intents.test')).toBe(deps.getFacilitator('https://intents.test'));
    await deps.getFacilitator('https://intents.test').verify({} as never, {} as never);
    await deps.getFacilitator('https://old-facilitator.test').verify({} as never, {} as never);
    expect(sent).toEqual([
      ['https://intents.test/verify', 'key-123', null],
      ['https://old-facilitator.test/verify', null, null],
    ]);
  });
});

describe('planX402IntentsFees', () => {
  const fees = [
    { type: 'royalty' as const, label: 'Artist', recipient: 'artist.near', bps: 300 },
    { type: 'affiliate' as const, label: 'Ref', recipient: 'ref.near', bps: 150 },
  ];

  it('returns mode none without splits', () => {
    expect(planX402IntentsFees({ totalAmount: '1000000', fees: [] })).toEqual({
      mode: 'none', totalAmount: '1000000', destinationAmount: '1000000', splits: [],
    });
  });

  it('out_of_band keeps the full destination and records splits', () => {
    const plan = planX402IntentsFees({ totalAmount: '25000000', fees });
    expect(plan.mode).toBe('out_of_band');
    expect(plan.destinationAmount).toBe('25000000');
    expect(plan.splits.map((s) => s.amount)).toEqual(['750000', '375000']);
    expect(plan).not.toHaveProperty('appFees');
  });
});

describe('near-intents requirements', () => {
  it('normalises a Ping offer and rejects unusable ones', () => {
    const offer = normalizeX402IntentsOffer(pingOffer({ amount: '1', payTo: 'x' }), '25000000')!;
    expect(offer).toEqual({
      scheme: 'exact',
      network: ARB,
      asset: ARB_USDC,
      amount: '',
      payTo: '',
      maxTimeoutSeconds: 300,
      extra: pingOffer().extra,
    });
    expect(normalizeX402IntentsOffer(pingOffer({ maxTimeoutSeconds: undefined }), '25000000')!.maxTimeoutSeconds).toBe(3600);
    // Destination amount must be exactly what we asked for.
    expect(normalizeX402IntentsOffer(pingOffer(), '1')).toBeUndefined();
    expect(normalizeX402IntentsOffer(pingOffer({ scheme: 'upto' }), '25000000')).toBeUndefined();
    expect(normalizeX402IntentsOffer(pingOffer({ extra: { assetTransferMethod: 'eip3009', destination: DESTINATION } }), '25000000')).toBeUndefined();
    expect(normalizeX402IntentsOffer(pingOffer({ extra: { assetTransferMethod: 'near-intents' } }), '25000000')).toBeUndefined();
  });

  it('matches offers by origin and applies the allow-list', () => {
    const offers = [normalizeX402IntentsOffer(pingOffer(), '25000000')!];
    expect(findOffer(offers, ARB, ARB_USDC.toLowerCase())).toBe(offers[0]);
    expect(findOffer(offers, 'eip155:10', ARB_USDC)).toBeUndefined();
    expect(originAllowed(undefined, ARB, ARB_USDC)).toBe(true);
    expect(originAllowed([{ network: ARB }], ARB, ARB_USDC)).toBe(true);
    expect(originAllowed([{ network: ARB, asset: ARB_USDC.toLowerCase() }], ARB, ARB_USDC)).toBe(true);
    expect(originAllowed([{ network: ARB, asset: '0x1' }], ARB, ARB_USDC)).toBe(false);
    expect(originAllowed([], ARB, ARB_USDC)).toBe(false);
  });

  it('builds the quoted entry and settle requirements without trusting the client destination', () => {
    const unquoted = normalizeX402IntentsOffer(pingOffer(), '25000000')!;
    const quoted = buildX402IntentsQuotedEntry(unquoted, {
      depositAddress: '0xdep',
      amountIn: '25125000',
      refundDeadline: '2026-10-26T10:00:00.000Z',
      operationToken: 'k1.1.mac',
      depositMemo: 'memo',
    });
    expect(quoted).toMatchObject({
      payTo: '0xdep',
      amount: '25125000',
      extra: { ...unquoted.extra, refundDeadline: '2026-10-26T10:00:00.000Z', operationToken: 'k1.1.mac', depositMemo: 'memo' },
    });
    const tampered = { ...quoted, extra: { ...quoted.extra, destination: { ...DESTINATION, recipient: 'attacker.near' } } };
    const settle = buildX402IntentsSettleRequirements(unquoted, tampered, '0xdep');
    expect(settle).toMatchObject({ payTo: '0xdep', amount: '25125000' });
    expect(settle.extra.destination).toEqual(DESTINATION);
    expect(settle.extra.operationToken).toBe('k1.1.mac');
    expect(x402IntentsOperationKey(ARB, '0xdep', 'memo')).toBe(`${ARB}:0xdep:memo`);
    expect(x402IntentsOperationKey(ARB, '0xdep')).toBe(`${ARB}:0xdep`);
  });

  it('never leaks the operation token in receipts', () => {
    expect(stripOperationToken({ a: 1, extra: { operationToken: 't', nested: [{ operationToken: 't', b: 2 }] } })).toEqual({
      a: 1, extra: { nested: [{ b: 2 }] },
    });
  });
});

describe('createX402IntentsHttpFacilitator (Ping Agent Pay)', () => {
  it('GETs /offers with X-Api-Key, keeps usable entries and caches per amountOut', async () => {
    let now = 0;
    const calls: Array<[string, string | null]> = [];
    const facilitator = createX402IntentsHttpFacilitator({
      url: 'https://pay.pingpay.test/agentpay/x402/',
      apiKey: 'key-123',
      now: () => now,
      fetch: (async (url: string, init: RequestInit) => {
        calls.push([url, new Headers(init.headers).get('x-api-key')]);
        return Response.json({ x402Version: 2, accepts: [pingOffer(), pingOffer({ scheme: 'other' })] });
      }) as unknown as typeof fetch,
    });
    const offers = await facilitator.offers('25000000');
    expect(offers).toHaveLength(1);
    expect(calls).toEqual([['https://pay.pingpay.test/agentpay/x402/offers?amountOut=25000000', 'key-123']]);
    await facilitator.offers('25000000');
    expect(calls).toHaveLength(1);
    now = 61_000;
    await facilitator.offers('25000000');
    expect(calls).toHaveLength(2);
  });

  it('throws on a failed /offers without leaking the key', async () => {
    const facilitator = createX402IntentsHttpFacilitator({
      url: 'https://pay.pingpay.test/agentpay/x402',
      apiKey: 'secret-key',
      fetch: (async () => Response.json({ error: 'Agent Pay disabled', code: 'agent_pay_disabled' }, { status: 403 })) as unknown as typeof fetch,
    });
    const error = await facilitator.offers('1').catch((e: Error) => e);
    expect(String(error)).toMatch(/403 agent_pay_disabled/);
    expect(String(error)).not.toContain('secret-key');
  });

  it('keeps the body of a terminal 402 settle, throws on 503/504 and non-JSON', async () => {
    const facilitator = createX402IntentsHttpFacilitator({
      url: 'https://intents.test/',
      fetch: (async () =>
        Response.json({ success: false, errorReason: 'exact_near_intents_payment_failed', network: ARB, transaction: '0x1' }, { status: 402 })) as unknown as typeof fetch,
    });
    await expect(facilitator.settle({} as never, {} as never)).resolves.toMatchObject({ errorReason: 'exact_near_intents_payment_failed' });

    for (const status of [503, 504]) {
      const transient = createX402IntentsHttpFacilitator({
        url: 'https://intents.test',
        fetch: (async () => Response.json({ success: false }, { status })) as unknown as typeof fetch,
      });
      await expect(transient.settle({} as never, {} as never)).rejects.toThrow(/unavailable/);
    }

    const broken = createX402IntentsHttpFacilitator({
      url: 'https://intents.test',
      fetch: (async () => new Response('bad gateway', { status: 400 })) as unknown as typeof fetch,
    });
    await expect(broken.verify({} as never, {} as never)).rejects.toThrow();
  });

  it('maps a Ping { code } verify error to isValid false', async () => {
    const facilitator = createX402IntentsHttpFacilitator({
      url: 'https://intents.test',
      fetch: (async () => Response.json({ error: 'refund address required', code: 'refund_address_required' }, { status: 400 })) as unknown as typeof fetch,
    });
    await expect(facilitator.verify({} as never, {} as never)).resolves.toEqual({
      isValid: false,
      invalidReason: 'refund_address_required',
    });
  });

  it('claims execution with { depositAddress } and tolerates a missing route', async () => {
    const bodies: unknown[] = [];
    const make = (response: () => Response) =>
      createX402IntentsHttpFacilitator({
        url: 'https://intents.test',
        fetch: (async (_url: string, init: RequestInit) => {
          bodies.push(JSON.parse(String(init.body)));
          return response();
        }) as unknown as typeof fetch,
      });
    await expect(make(() => Response.json({ execute: true })).claimExecution!('0xdep')).resolves.toBe(true);
    await expect(make(() => Response.json({ execute: false })).claimExecution!('0xdep')).resolves.toBe(false);
    await expect(make(() => Response.json({}, { status: 404 })).claimExecution!('0xdep')).resolves.toBeUndefined();
    expect(bodies[0]).toEqual({ depositAddress: '0xdep' });
  });
});
