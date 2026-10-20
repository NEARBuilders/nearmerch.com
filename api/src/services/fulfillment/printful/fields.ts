import type { ProviderDetailFields } from '../fields';
import type { PrintfulProviderDetails } from './types';

export const PRINTFUL_PROVIDER_FIELDS = {
  brand: { label: 'Brand', order: 1 },
  model: { label: 'Model', order: 2 },
  gsm: { label: 'Fabric Weight', format: (v) => `${v} g/m²`, order: 3 },
  material: { label: 'Material', order: 4 },
  techniques: { label: 'Print Method', format: (v) => v.join(', '), order: 5 },
  placements: { label: 'Print Locations', format: (v) => v.join(', '), order: 6 },
} satisfies ProviderDetailFields<PrintfulProviderDetails>;
