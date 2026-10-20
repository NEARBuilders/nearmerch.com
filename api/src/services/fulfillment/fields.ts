import type { ProviderDetails } from '../../schema';
import { LULU_PROVIDER_FIELDS } from './lulu/fields';
import { PRINTFUL_PROVIDER_FIELDS } from './printful/fields';

export type ProviderDetailFields<TDetails> = {
  [K in keyof TDetails]?: {
    label: string;
    order: number;
    format?: (value: NonNullable<TDetails[K]>) => string;
  };
};

type ProviderDetailFieldsMap = {
  [P in keyof ProviderDetails]?: ProviderDetailFields<NonNullable<ProviderDetails[P]>>;
};

export const PROVIDER_DETAIL_FIELDS: ProviderDetailFieldsMap = {
  printful: PRINTFUL_PROVIDER_FIELDS,
  lulu: LULU_PROVIDER_FIELDS,
};

export interface ProviderDetailRow {
  label: string;
  value: string;
}

function formatDetails<TDetails>(
  details: TDetails | undefined,
  fields: ProviderDetailFields<NonNullable<TDetails>> | undefined,
): ProviderDetailRow[] {
  if (!details || !fields) return [];

  const rows: Array<ProviderDetailRow & { order: number }> = [];
  for (const key of Object.keys(fields) as Array<keyof NonNullable<TDetails>>) {
    const field = fields[key];
    const value = details[key];
    if (!field || value === undefined || value === null) continue;

    const text = field.format ? field.format(value) : String(value);
    if (text) rows.push({ label: field.label, value: text, order: field.order });
  }

  return rows
    .sort((a, b) => a.order - b.order)
    .map(({ label, value }) => ({ label, value }));
}

export function isProviderWithDetails(provider: string): provider is keyof ProviderDetails {
  return provider in PROVIDER_DETAIL_FIELDS;
}

export function formatProviderDetails<P extends keyof ProviderDetails>(
  provider: P,
  providerDetails: ProviderDetails | undefined,
): ProviderDetailRow[] {
  return formatDetails<ProviderDetails[P]>(
    providerDetails?.[provider],
    PROVIDER_DETAIL_FIELDS[provider],
  );
}
