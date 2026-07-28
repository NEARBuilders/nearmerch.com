export interface FieldRule {
  required?: boolean;
  maxLength?: number;
  errorMessage?: string;
}

export interface ProviderAddressRules {
  addressLine1?: FieldRule;
  addressLine2?: FieldRule;
  phone?: FieldRule;
  postcode?: FieldRule;
  city?: FieldRule;
  name?: FieldRule;
  state?: FieldRule;
}

export interface RestrictedStateRule {
  codes?: readonly string[];
  keywords?: readonly string[];
}

export interface ProviderConfig {
  addressRules?: ProviderAddressRules;
  unsupportedCountryCodes?: readonly string[];
  restrictedStates?: Record<string, RestrictedStateRule>;
  shippingRegions?: Record<string, readonly string[]>;
}

export const PROVIDER_CONFIG: Record<string, ProviderConfig> = {
  lulu: {
    addressRules: {
      addressLine1: {
        maxLength: 30,
        errorMessage: 'Address is too long. Please use Address Line 2 for apartment/unit numbers.',
      },
      addressLine2: {
        maxLength: 30,
        errorMessage: 'Address Line 2 is too long.',
      },
      phone: {
        required: true,
        maxLength: 20,
        errorMessage: 'Phone number is required for delivery.',
      },
      postcode: {
        maxLength: 64,
        errorMessage: 'ZIP/Postal code is too long.',
      },
    },
  },

  printful: {
    unsupportedCountryCodes: [
      'BY',
      'CU',
      'IR',
      'KP',
      'PS',
      'RU',
      'SY',
      'VE',
    ],
    restrictedStates: {
      UA: {
        codes: ['43', '40', '14', '09', 'cr', 'se', 'dn', 'lu'],
        keywords: [
          'crimea',
          'krym',
          'sevastopol',
          'donetsk',
          'donets',
          'dpr',
          'dnr',
          'luhansk',
          'lugansk',
          'luhans',
          'lpr',
          'lnr',
        ],
      },
    },
    shippingRegions: {
      USA: ['US'],
      CANADA: ['CA'],
      UK: ['GB'],
      EFTA: ['IS', 'LI', 'NO', 'CH'],
      EUROPE: [
        'AL', 'AD', 'AT', 'BE', 'BA', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI',
        'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'XK', 'LV', 'LT', 'LU', 'MT', 'MD',
        'ME', 'NL', 'MK', 'PL', 'PT', 'RO', 'SM', 'RS', 'SK', 'SI', 'ES', 'SE',
        'VA', 'UA',
      ],
      AUSTRALIA_NZ: ['AU', 'NZ'],
      JAPAN: ['JP'],
      BRAZIL: ['BR'],
    },
  },

  manual: {},

  gelato: {},
};

/**
 * Backward-compatible address rules dictionary derived from PROVIDER_CONFIG
 */
export const PROVIDER_ADDRESS_RULES: Record<string, ProviderAddressRules> = Object.fromEntries(
  Object.entries(PROVIDER_CONFIG).map(([provider, config]) => [provider, config.addressRules || {}]),
);

export type FieldName = keyof ProviderAddressRules;

/**
 * Checks if a country code is supported by the active fulfillment providers in the cart.
 */
export function isCountrySupported(countryCode: string, providers?: string[]): boolean {
  if (!countryCode) return true;
  const code = countryCode.toUpperCase();
  const activeProviders = providers && providers.length > 0 ? providers : Object.keys(PROVIDER_CONFIG);

  return !activeProviders.some((providerId) => {
    const config = PROVIDER_CONFIG[providerId.toLowerCase()];
    return config?.unsupportedCountryCodes?.includes(code);
  });
}

/**
 * Checks if a state / sub-region is supported by the active fulfillment providers in the cart.
 */
export function isStateSupported(
  countryCode: string,
  stateCode: string,
  stateName?: string,
  providers?: string[],
): boolean {
  if (!countryCode) return true;
  const country = countryCode.toUpperCase();
  const code = (stateCode || '').toLowerCase();
  const name = (stateName || '').toLowerCase();
  const activeProviders = providers && providers.length > 0 ? providers : Object.keys(PROVIDER_CONFIG);

  return !activeProviders.some((providerId) => {
    const config = PROVIDER_CONFIG[providerId.toLowerCase()];
    const stateRule = config?.restrictedStates?.[country];
    if (!stateRule) return false;

    if (stateRule.codes?.some((c) => c.toLowerCase() === code)) {
      return true;
    }

    if (stateRule.keywords?.some((keyword) => name.includes(keyword.toLowerCase()) || code.includes(keyword.toLowerCase()))) {
      return true;
    }

    return false;
  });
}

export type PrintfulShippingRegionName =
  | 'USA'
  | 'Europe'
  | 'UK'
  | 'EFTA States'
  | 'Canada'
  | 'Australia / New Zealand'
  | 'Japan'
  | 'Brazil'
  | 'Worldwide';

export function getPrintfulShippingRegion(countryCode: string): PrintfulShippingRegionName {
  if (!countryCode) return 'Worldwide';
  const code = countryCode.toUpperCase();
  const regions = PROVIDER_CONFIG.printful?.shippingRegions;
  if (!regions) return 'Worldwide';

  if (regions.USA?.includes(code)) return 'USA';
  if (regions.CANADA?.includes(code)) return 'Canada';
  if (regions.UK?.includes(code)) return 'UK';
  if (regions.EFTA?.includes(code)) return 'EFTA States';
  if (regions.EUROPE?.includes(code)) return 'Europe';
  if (regions.AUSTRALIA_NZ?.includes(code)) return 'Australia / New Zealand';
  if (regions.JAPAN?.includes(code)) return 'Japan';
  if (regions.BRAZIL?.includes(code)) return 'Brazil';

  return 'Worldwide';
}



