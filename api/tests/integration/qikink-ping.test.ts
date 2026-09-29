import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { describe, expect, it } from 'vitest';
import { Effect } from 'every-plugin/effect';
import { QikinkService } from '@/services/fulfillment/qikink/service';

loadEnv({ path: resolve(import.meta.dirname, '../../../.env') });

const clientId = process.env.QIKINK_CLIENT_ID;
const clientSecret = process.env.QIKINK_CLIENT_SECRET;
const environment = process.env.QIKINK_ENVIRONMENT ?? 'sandbox';
const hasCredentials = Boolean(clientId && clientSecret);

describe('Qikink sandbox ping', () => {
  it.skipIf(!hasCredentials)('authenticates against the configured Qikink environment', async () => {
    const service = new QikinkService({
      clientId: clientId!,
      clientSecret: clientSecret!,
      environment,
    });

    const result = await Effect.runPromise(service.ping());

    expect(result.provider).toBe('qikink');
    expect(result.status).toBe('ok');
    expect(result.timestamp).toBeTruthy();
  });
});
