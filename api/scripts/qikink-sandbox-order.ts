import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: resolve(import.meta.dirname, "../../.env") });

const clientId = process.env.QIKINK_CLIENT_ID;
const clientSecret = process.env.QIKINK_CLIENT_SECRET;
const base = "https://sandbox.qikink.com";

if (!clientId || !clientSecret) {
  throw new Error("Set QIKINK_CLIENT_ID and QIKINK_CLIENT_SECRET in .env");
}

const tokenRes = await fetch(`${base}/api/token`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ ClientId: clientId, client_secret: clientSecret }),
});
const tokenJson = (await tokenRes.json()) as { Accesstoken?: string };
if (!tokenJson.Accesstoken) {
  throw new Error(`token failed: ${tokenRes.status}`);
}

const orderNumber = (`t${Date.now().toString(36)}`).slice(0, 15);
const res = await fetch(`${base}/api/order/create`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    ClientId: clientId,
    Accesstoken: tokenJson.Accesstoken,
  },
  body: JSON.stringify({
    order_number: orderNumber,
    qikink_shipping: "1",
    gateway: "Prepaid",
    total_order_value: "399",
    line_items: [
      {
        search_from_my_products: 0,
        print_type_id: 1,
        sku: "MVnHs-Wh-S",
        quantity: "1",
        price: "399",
        designs: [
          {
            design_code: "nearmerchtest1",
            width_inches: "",
            height_inches: "",
            placement_sku: "fr",
            design_link: "https://qikink.com/favicon.ico",
            mockup_link: "https://qikink.com/favicon.ico",
          },
        ],
      },
    ],
    shipping_address: {
      first_name: "Test",
      last_name: "Customer",
      address1: "123 Main Street",
      phone: "9876543210",
      email: "test@example.com",
      city: "Mumbai",
      zip: "400001",
      province: "Maharashtra",
      country_code: "IN",
    },
  }),
});

console.log(
  JSON.stringify(
    {
      status: res.status,
      order_number: orderNumber,
      body: await res.text(),
    },
    null,
    2,
  ),
);
