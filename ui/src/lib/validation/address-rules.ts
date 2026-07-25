interface FieldRule {
  required?: boolean;
  maxLength?: number;
  errorMessage?: string;
}

interface ProviderRules {
  addressLine1?: FieldRule;
  addressLine2?: FieldRule;
  phone?: FieldRule;
  postcode?: FieldRule;
  city?: FieldRule;
  name?: FieldRule;
  state?: FieldRule;
}

export const PROVIDER_ADDRESS_RULES: Record<string, ProviderRules> = {
  lulu: {
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

  printful: {},

  manual: {},

  gelato: {},
};

export type FieldName = keyof ProviderRules;

/**
 * Country codes unsupported by Printful / fulfillment partners due to legal restrictions, sanctions, or carrier limitations.
 * Belarus (BY), Cuba (CU), Iran (IR), North Korea (KP), Palestine (PS - Gaza Strip), Russia (RU), Syria (SY), Venezuela (VE).
 */
export const UNSUPPORTED_COUNTRY_CODES = [
  'BY',
  'CU',
  'IR',
  'KP',
  'PS',
  'RU',
  'SY',
  'VE',
] as const;

export function isCountrySupported(countryCode: string): boolean {
  if (!countryCode) return true;
  return !UNSUPPORTED_COUNTRY_CODES.includes(countryCode.toUpperCase() as (typeof UNSUPPORTED_COUNTRY_CODES)[number]);
}

/**
 * Restricted sub-regions/states within supported countries (e.g. Crimea, Donetsk, Luhansk in Ukraine).
 */
export const RESTRICTED_STATE_KEYWORDS_UA = [
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
];

export function isStateSupported(countryCode: string, stateCode: string, stateName?: string): boolean {
  if (!countryCode) return true;
  const country = countryCode.toUpperCase();
  if (country === 'UA') {
    const code = (stateCode || '').toLowerCase();
    const name = (stateName || '').toLowerCase();
    
    // Check specific state ISO codes for Ukraine (43 = Crimea, 40 = Sevastopol, 14 = Donetsk, 09 = Luhansk)
    if (['43', '40', '14', '09', 'cr', 'se', 'dn', 'lu'].includes(code)) {
      return false;
    }
    
    // Check state name keywords
    if (RESTRICTED_STATE_KEYWORDS_UA.some((keyword) => name.includes(keyword) || code.includes(keyword))) {
      return false;
    }
  }
  return true;
}


/**
 * Printful Shipping Regions based on printful_shipping_rates.csv
 */
export const PRINTFUL_SHIPPING_REGIONS = {
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
} as const;

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

  if (PRINTFUL_SHIPPING_REGIONS.USA.includes(code as any)) return 'USA';
  if (PRINTFUL_SHIPPING_REGIONS.CANADA.includes(code as any)) return 'Canada';
  if (PRINTFUL_SHIPPING_REGIONS.UK.includes(code as any)) return 'UK';
  if (PRINTFUL_SHIPPING_REGIONS.EFTA.includes(code as any)) return 'EFTA States';
  if (PRINTFUL_SHIPPING_REGIONS.EUROPE.includes(code as any)) return 'Europe';
  if (PRINTFUL_SHIPPING_REGIONS.AUSTRALIA_NZ.includes(code as any)) return 'Australia / New Zealand';
  if (PRINTFUL_SHIPPING_REGIONS.JAPAN.includes(code as any)) return 'Japan';
  if (PRINTFUL_SHIPPING_REGIONS.BRAZIL.includes(code as any)) return 'Brazil';

  return 'Worldwide';
}


