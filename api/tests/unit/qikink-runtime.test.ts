import { describe, expect, it } from 'vitest';
import { createMarketplaceRuntime } from '@/runtime';

describe('Qikink runtime registration', () => {
  it('boots without Qikink credentials and does not register the provider', async () => {
    const runtime = await createMarketplaceRuntime({});

    try {
      expect(runtime.getProvider('qikink')).toBeNull();
      expect(runtime.providers.some((provider) => provider.name === 'qikink')).toBe(false);
      expect(runtime.getProvider('manual')).not.toBeNull();
    } finally {
      await runtime.shutdown();
    }
  });
});
