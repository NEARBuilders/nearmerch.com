import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getX402IntentsFeeMode,
  getX402IntentsInactiveReason,
  getX402IntentsOrigins,
  isX402IntentsActive,
} from '@/services/payment/x402/config';
import { planX402IntentsFees } from '@/services/payment/x402/intents/fees';
import {
  buildX402IntentsQuotedEntry,
  buildX402IntentsUnquotedEntry,
  x402IntentsIndicativeAmount,
  x402IntentsOperationKey,
} from '@/services/payment/x402/intents/requirements';
import { createX402IntentsHttpFacilitator } from '@/services/payment/x402/intents/facilitator';
import { stripOperationToken } from '@/services/payment/x402/intents/middleware';
import { createX402IntentsPayDeps } from '@/services/payment/x402/intents/host-deps';
import { X402_USDC_BASE } from '@/services/payment/x402/constants';

const ARB_USDC = { network: 'eip155:42161', asset: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', decimals: 6, maxTimeoutSeconds: 300, usdPegged: true };
const ENV_KEYS = [
  'X402_ENABLED', 'X402_PAY_TO_ADDRESS', 'X402_HOST_SECRET', 'X402_NETWORK',
  'X402_INTENTS_ENABLED', 'X402_INTENTS_FACILITATOR_URL', 'X402_INTENTS_FACILITATOR_API_KEY',
  'X402_INTENTS_ORIGINS', 'X402_INTENTS_FEE_MODE',
];

describe('x402 near-intents config', () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const key of ENV_KEYS) saved[key] = process.env[key];
    process.env.X402_ENABLED = 'true';
    process.env.X402_PAY_TO_ADDRESS = '0x0000000000000000000000000000000000000abc';
    process.env.X402_HOST_SECRET = 'secret';
    process.env.X402_NETWORK = 'eip155:8453';
    process.env.X402_INTENTS_ENABLED = 'true';
    process.env.X402_INTENTS_FACILITATOR_URL = 'https://intents.test';
    process.env.X402_INTENTS_ORIGINS = JSON.stringify([ARB_USDC]);
    delete process.env.X402_INTENTS_FEE_MODE;
  });
  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it('is active only when fully configured on Base mainnet', () => {
    expect(isX402IntentsActive()).toBe(true);
    process.env.X402_INTENTS_ENABLED = 'false';
    expect(getX402IntentsInactiveReason()).toBe('X402_INTENTS_ENABLED is off');
    process.env.X402_INTENTS_ENABLED = 'true';
    process.env.X402_NETWORK = 'eip155:84532';
    expect(getX402IntentsInactiveReason()).toMatch(/eip155:8453/);
    process.env.X402_NETWORK = 'eip155:8453';
    delete process.env.X402_INTENTS_FACILITATOR_URL;
    expect(getX402IntentsInactiveReason()).toMatch(/FACILITATOR_URL/);
  });

  it('parses origins and rejects invalid, Base USDC, non-pegged and duplicate entries', () => {
    process.env.X402_INTENTS_ORIGINS = JSON.stringify([
      ARB_USDC,
      { ...ARB_USDC, asset: ARB_USDC.asset.toLowerCase() },
      { network: 'eip155:8453', asset: X402_USDC_BASE, decimals: 6, maxTimeoutSeconds: 300, usdPegged: true },
      { ...ARB_USDC, network: 'eip155:1', asset: '0x0000000000000000000000000000000000000000', usdPegged: false },
      { network: 'eip155:10' },
    ]);
    const { origins, errors } = getX402IntentsOrigins();
    expect(origins).toEqual([ARB_USDC]);
    expect(errors).toHaveLength(4);
    process.env.X402_INTENTS_ORIGINS = 'not json';
    expect(getX402IntentsOrigins().errors).toEqual(['X402_INTENTS_ORIGINS is not valid JSON']);
    expect(isX402IntentsActive()).toBe(false);
  });

  it('defaults the fee mode to out_of_band', () => {
    expect(getX402IntentsFeeMode()).toBe('out_of_band');
    process.env.X402_INTENTS_FEE_MODE = 'app_fees';
    expect(getX402IntentsFeeMode()).toBe('app_fees');
  });

  it('host deps are null unless active, and send the API key only to the configured facilitator', async () => {
    const client = {} as never;
    process.env.X402_INTENTS_ENABLED = 'false';
    expect(createX402IntentsPayDeps(client)).toBeNull();
    process.env.X402_INTENTS_ENABLED = 'true';
    process.env.X402_INTENTS_FACILITATOR_API_KEY = 'key-123';
    const auth: Array<[string, string | null]> = [];
    const deps = createX402IntentsPayDeps(client, {
      fetch: (async (url: string, init: RequestInit) => {
        auth.push([url, new Headers(init.headers).get('authorization')]);
        return Response.json({ isValid: false, invalidReason: 'x' });
      }) as typeof fetch,
    })!;
    expect(deps.origins).toEqual([ARB_USDC]);
    expect(deps.getFacilitator('https://intents.test')).toBe(deps.getFacilitator('https://intents.test'));
    await deps.getFacilitator('https://intents.test').verify({} as never, {} as never);
    await deps.getFacilitator('https://old-facilitator.test').verify({} as never, {} as never);
    expect(auth).toEqual([
      ['https://intents.test/verify', 'Bearer key-123'],
      ['https://old-facilitator.test/verify', null],
    ]);
  });
});

describe('planX402IntentsFees', () => {
  const fees = [
    { type: 'royalty' as const, label: 'Artist', recipient: 'artist.near', bps: 300 },
    { type: 'affiliate' as const, label: 'Ref', recipient: 'ref.near', bps: 150 },
    { type: 'royalty' as const, label: 'Co-artist', recipient: 'artist.near', bps: 50 },
  ];

  it('returns mode none without splits', () => {
    expect(planX402IntentsFees({ totalAmount: '1000000', fees: [], mode: 'app_fees' })).toEqual({
      mode: 'none', totalAmount: '1000000', destinationAmount: '1000000', splits: [],
    });
  });

  it('out_of_band keeps the full destination and records splits', () => {
    const plan = planX402IntentsFees({ totalAmount: '25000000', fees, mode: 'out_of_band' });
    expect(plan.mode).toBe('out_of_band');
    expect(plan.destinationAmount).toBe('25000000');
    expect(plan.splits.map((s) => s.amount)).toEqual(['750000', '375000', '125000']);
    expect(plan.appFees).toBeUndefined();
  });

  it('app_fees reduces the destination by the floored splits and merges appFees per recipient', () => {
    const plan = planX402IntentsFees({ totalAmount: '10000001', fees, mode: 'app_fees' });
    expect(plan.mode).toBe('app_fees');
    // floor(10000001*300/1e4)=300000, *150=150000, *50=50000
    expect(plan.destinationAmount).toBe(String(10000001 - 300000 - 150000 - 50000));
    expect(plan.appFees).toEqual([
      { recipient: 'artist.near', fee: 350 },
      { recipient: 'ref.near', fee: 150 },
    ]);
  });

  it('falls back to out_of_band above 500 bps or for non-NEAR recipients', () => {
    const over = planX402IntentsFees({ totalAmount: '1000000', fees: [{ ...fees[0]!, bps: 501 }], mode: 'app_fees' });
    expect(over).toMatchObject({ mode: 'out_of_band', destinationAmount: '1000000' });
    expect(over.fallbackReason).toMatch(/500 bps/);
    const evm = planX402IntentsFees({ totalAmount: '1000000', fees: [{ ...fees[0]!, recipient: '0xABC' }], mode: 'app_fees' });
    expect(evm).toMatchObject({ mode: 'out_of_band', fallbackReason: 'appFees recipients must be NEAR account ids' });
  });
});

describe('near-intents requirements', () => {
  const destination = { network: 'eip155:8453', asset: X402_USDC_BASE, amount: '25000000', recipient: '0xabc' };

  it('rescales the indicative amount to the origin decimals, rounding up', () => {
    expect(x402IntentsIndicativeAmount('25000001', 6)).toBe('25000001');
    expect(x402IntentsIndicativeAmount('25000001', 18)).toBe('25000001000000000000');
    expect(x402IntentsIndicativeAmount('25000001', 2)).toBe('2501');
  });

  it('builds the unquoted and quoted entries per spec #3370', () => {
    const feePlan = planX402IntentsFees({ totalAmount: '25000000', fees: [], mode: 'out_of_band' });
    const unquoted = buildX402IntentsUnquotedEntry({ origin: ARB_USDC, destination, feePlan });
    expect(unquoted).toEqual({
      scheme: 'exact',
      network: ARB_USDC.network,
      asset: ARB_USDC.asset,
      amount: '',
      payTo: '',
      maxTimeoutSeconds: 300,
      extra: {
        assetTransferMethod: 'near-intents',
        paymentFlow: 'upfront',
        indicativeAmount: '25000000',
        destination,
      },
    });
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
    expect(x402IntentsOperationKey('eip155:42161', '0xdep', 'memo')).toBe('eip155:42161:0xdep:memo');
    expect(x402IntentsOperationKey('eip155:42161', '0xdep')).toBe('eip155:42161:0xdep');
  });

  it('never leaks the operation token in receipts', () => {
    expect(stripOperationToken({ a: 1, extra: { operationToken: 't', nested: [{ operationToken: 't', b: 2 }] } })).toEqual({
      a: 1, extra: { nested: [{ b: 2 }] },
    });
  });
});

describe('createX402IntentsHttpFacilitator', () => {
  it('keeps the settle body on non-2xx and throws on non-JSON', async () => {
    const facilitator = createX402IntentsHttpFacilitator({
      url: 'https://intents.test/',
      fetch: (async () =>
        Response.json({ success: false, errorReason: 'settlement_pending', network: 'eip155:42161', transaction: '0x1' }, { status: 400 })) as unknown as typeof fetch,
    });
    await expect(facilitator.settle({} as never, {} as never)).resolves.toMatchObject({ errorReason: 'settlement_pending' });

    const broken = createX402IntentsHttpFacilitator({
      url: 'https://intents.test',
      fetch: (async () => new Response('bad gateway', { status: 502 })) as unknown as typeof fetch,
    });
    await expect(broken.verify({} as never, {} as never)).rejects.toThrow();
  });
});
