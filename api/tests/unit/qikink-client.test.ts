import { describe, expect, it } from 'vitest';
import { Effect } from 'every-plugin/effect';
import { FulfillmentError } from '@/services/fulfillment/errors';
import { QikinkClient } from '@/services/fulfillment/qikink/client';
import { QikinkService } from '@/services/fulfillment/qikink/service';
import { resolveQikinkBaseUrl } from '@/services/fulfillment/qikink/types';

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

describe('Qikink client', () => {
  it('uses sandbox or live base URLs from the configured environment', () => {
    expect(resolveQikinkBaseUrl('sandbox')).toBe('https://sandbox.qikink.com');
    expect(resolveQikinkBaseUrl('production')).toBe('https://api.qikink.com');
    expect(resolveQikinkBaseUrl('live')).toBe('https://api.qikink.com');
  });

  it('requests a token with form-urlencoded ClientId and client_secret', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new QikinkClient({
      clientId: 'client-123',
      clientSecret: 'secret-456',
      environment: 'sandbox',
      fetch: async (input, init) => {
        calls.push({ url: String(input), init });
        return jsonResponse({
          ClientId: 'client-123',
          Accesstoken: 'token-1',
          expires_in: 3600,
        });
      },
    });

    await client.getAccessToken();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('https://sandbox.qikink.com/api/token');
    expect(calls[0]?.init?.method).toBe('POST');
    expect(new Headers(calls[0]?.init?.headers).get('Content-Type')).toBe(
      'application/x-www-form-urlencoded',
    );
    expect(String(calls[0]?.init?.body)).toBe(
      new URLSearchParams({
        ClientId: 'client-123',
        client_secret: 'secret-456',
      }).toString(),
    );
  });

  it('reuses a cached access token until it is close to expiry', async () => {
    let tokenRequests = 0;
    const client = new QikinkClient({
      clientId: 'client-123',
      clientSecret: 'secret-456',
      environment: 'sandbox',
      fetch: async () => {
        tokenRequests += 1;
        return jsonResponse({
          Accesstoken: `token-${tokenRequests}`,
          expires_in: 3600,
        });
      },
    });

    const first = await client.getAccessToken();
    const second = await client.getAccessToken();

    expect(first).toBe('token-1');
    expect(second).toBe('token-1');
    expect(tokenRequests).toBe(1);
  });

  it('maps HTTP 429 on token exchange to a RATE_LIMIT fulfillment error', async () => {
    const client = new QikinkClient({
      clientId: 'client-123',
      clientSecret: 'secret-456',
      environment: 'sandbox',
      fetch: async () => new Response('Too Many Requests', { status: 429 }),
    });

    try {
      await client.getAccessToken();
      throw new Error('expected token request to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(FulfillmentError);
      expect((error as FulfillmentError).code).toBe('RATE_LIMIT');
      expect((error as FulfillmentError).provider).toBe('qikink');
      expect((error as FulfillmentError).statusCode).toBe(429);
    }
  });

  it('maps HTTP 429 on authenticated requests to a RATE_LIMIT fulfillment error', async () => {
    const client = new QikinkClient({
      clientId: 'client-123',
      clientSecret: 'secret-456',
      environment: 'sandbox',
      fetch: async (input) => {
        if (String(input).endsWith('/api/token')) {
          return jsonResponse({ Accesstoken: 'token-1', expires_in: 3600 });
        }
        return new Response('Too Many Requests', { status: 429 });
      },
    });

    try {
      await client.request('/api/order/create', { method: 'POST' });
      throw new Error('expected authenticated request to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(FulfillmentError);
      expect((error as FulfillmentError).code).toBe('RATE_LIMIT');
      expect((error as FulfillmentError).statusCode).toBe(429);
    }
  });
});

describe('Qikink service', () => {
  it('pings by exchanging a token', async () => {
    const service = new QikinkService({
      clientId: 'client-123',
      clientSecret: 'secret-456',
      environment: 'sandbox',
      fetch: async () =>
        jsonResponse({
          Accesstoken: 'token-1',
          expires_in: 3600,
        }),
    });

    const ping = await Effect.runPromise(service.ping());
    expect(ping).toMatchObject({ provider: 'qikink', status: 'ok' });
  });
});
