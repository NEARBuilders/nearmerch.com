import type { ShippingAddress } from "../../schema";

export function getProviderAddressRequirementError(
  providerName: string,
  address: ShippingAddress,
): string | undefined {
  if (providerName === "lulu" && !address.phone?.trim()) {
    return "Phone number is required for delivery";
  }

  if (providerName === "qikink") {
    if (!address.phone?.trim()) {
      return "Phone number is required for Qikink delivery";
    }
    if (!address.postCode?.trim()) {
      return "Pincode is required for Qikink delivery";
    }
  }

  // manual and printful do not require phone

  return undefined;
}

export function getProvidersAddressRequirementError(
  providerNames: Iterable<string>,
  address: ShippingAddress,
): { provider: string; message: string } | undefined {
  for (const providerName of providerNames) {
    const message = getProviderAddressRequirementError(providerName, address);

    if (message) {
      return { provider: providerName, message };
    }
  }

  return undefined;
}
