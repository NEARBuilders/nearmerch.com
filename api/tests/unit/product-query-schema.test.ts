import { describe, expect, it } from "vitest";
import { contract } from "../../src/contract";

const inputSchema = contract.getProducts["~orpc"].inputSchema!;

describe("getProducts query parameters", () => {
  it("coerces REST pagination strings to numbers", () => {
    const result = inputSchema.parse({
      limit: "1",
      offset: "2",
    });

    expect(result.limit).toBe(1);
    expect(result.offset).toBe(2);
  });

  it("continues to reject invalid pagination values", () => {
    expect(() => inputSchema.parse({ limit: "0", offset: "-1" })).toThrow();
    expect(() => inputSchema.parse({ limit: "not-a-number" })).toThrow();
  });
});
