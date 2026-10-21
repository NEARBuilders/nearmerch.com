import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProductDetails } from "./product-details";

afterEach(() => {
  cleanup();
});

describe("ProductDetails", () => {
  it("renders formatted provider details without a session or API call", () => {
    render(
      <ProductDetails
        provider="printful"
        providerDetails={{
          printful: {
            brand: "Bella + Canvas",
            gsm: 180,
            techniques: ["dtg", "embroidery"],
            placements: ["front", "back"],
          },
        }}
      />,
    );

    expect(screen.getByText("Product Details")).toBeTruthy();
    expect(screen.getByText("Bella + Canvas")).toBeTruthy();
    expect(screen.getByText("180 g/m²")).toBeTruthy();
    expect(screen.getByText("dtg, embroidery")).toBeTruthy();
    expect(screen.getByText("front, back")).toBeTruthy();
  });

  it("renders nothing for providers without display fields", () => {
    const { container } = render(
      <ProductDetails
        provider="manual"
        providerDetails={{ manual: { notificationEmails: ["orders@example.com"], ownerAccountIds: [] } }}
      />,
    );

    expect(container.innerHTML).toBe("");
  });
});
