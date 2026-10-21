import type { ProviderDetailFields } from '../fields';
import type { LuluProviderDetails } from './types';

export const LULU_PROVIDER_FIELDS = {
  pageCount: { label: 'Pages', order: 1 },
  format: { label: 'Format', order: 2 },
} satisfies ProviderDetailFields<LuluProviderDetails>;
