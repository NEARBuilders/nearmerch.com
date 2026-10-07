import { describe, expect, it } from 'vitest';
import { PROVIDERS, PROVIDER_MAP, getProvider } from './providers';

describe('admin provider list', () => {
  it('includes Qikink on the existing catalog-backed new-product path', () => {
    const qikink = PROVIDERS.find((provider) => provider.id === 'qikink');

    expect(qikink).toMatchObject({
      id: 'qikink',
      hasCatalog: true,
    });
    expect(PROVIDER_MAP.get('qikink')).toEqual(qikink);
    expect(getProvider('qikink').hasCatalog).toBe(true);
  });

  it('keeps Printful and Lulu catalog-backed and Manual without a catalog', () => {
    expect(getProvider('printful').hasCatalog).toBe(true);
    expect(getProvider('lulu').hasCatalog).toBe(true);
    expect(getProvider('manual').hasCatalog).toBe(false);
  });
});
