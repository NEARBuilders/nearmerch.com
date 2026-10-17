import { OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { describe, expect, it } from "vitest";
import { contract } from "../../src/contract";

describe("OpenAPI spec", () => {
  it("generates from the full contract", async () => {
    const generator = new OpenAPIGenerator({
      schemaConverters: [new ZodToJsonSchemaConverter()],
    });

    const spec = await generator.generate(contract, {
      info: { title: "API", version: "1.0.0" },
    });

    expect(spec.paths?.["/admin/orders/{orderId}/status"]?.post).toBeDefined();
  });
});
