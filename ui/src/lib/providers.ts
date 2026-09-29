export type ProviderName = "printful" | "lulu" | "manual" | "qikink";

export interface ProviderInfo {
  id: ProviderName;
  name: string;
  description: string;
  color: string;
  hasCatalog: boolean;
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: "printful",
    name: "Printful",
    description: "Print-on-demand — apparel, accessories, homeware with DTG, embroidery, and more",
    color: "#00EC97",
    hasCatalog: true,
  },
  {
    id: "lulu",
    name: "Lulu",
    description: "Print-on-demand — books, prints, and publications",
    color: "#f97316",
    hasCatalog: true,
  },
  {
    id: "manual",
    name: "Basic",
    description: "Self-fulfilled — manual order management with email notifications",
    color: "#10b981",
    hasCatalog: false,
  },
  {
    id: "qikink",
    name: "Qikink",
    description: "Print-on-demand — India fulfillment",
    color: "#6366f1",
    hasCatalog: true,
  },
];

export const PROVIDER_MAP = new Map(PROVIDERS.map((p) => [p.id, p]));

export function getProvider(id: ProviderName): ProviderInfo {
  return PROVIDER_MAP.get(id)!;
}