import { describe, it, expect } from "vitest";
import { computeUsageCost, aggregateUsage, PRICING } from "../src/quality/usageCost";

describe("computeUsageCost", () => {
  it("taze input + output token maliyetini hesaplar", () => {
    // 1M input + 1M output = 3 + 15 = 18 USD
    expect(computeUsageCost({ inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(18, 6);
  });

  it("cache okuma/yazımını ayrı fiyatlandırır", () => {
    // 1M cache read = 0.30, 1M cache write = 3.75
    expect(computeUsageCost({ cacheReadTokens: 1_000_000 })).toBeCloseTo(PRICING.cacheRead, 6);
    expect(computeUsageCost({ cacheCreationTokens: 1_000_000 })).toBeCloseTo(PRICING.cacheWrite, 6);
  });

  it("eksik alanları 0 sayar", () => {
    expect(computeUsageCost({})).toBe(0);
  });

  it("cache okuma taze input'tan ~10× ucuzdur", () => {
    const fresh = computeUsageCost({ inputTokens: 1_000_000 });
    const cached = computeUsageCost({ cacheReadTokens: 1_000_000 });
    expect(fresh / cached).toBeCloseTo(10, 5);
  });
});

describe("aggregateUsage", () => {
  it("kayıtları toplar ve USD'yi 2 ondalığa yuvarlar", () => {
    const out = aggregateUsage([
      { inputTokens: 500_000, outputTokens: 100_000, cacheReadTokens: 2_000_000 },
      { inputTokens: 500_000, outputTokens: 100_000, cacheCreationTokens: 400_000 },
    ]);
    expect(out.inputTokens).toBe(1_000_000);
    expect(out.outputTokens).toBe(200_000);
    expect(out.cacheReadTokens).toBe(2_000_000);
    expect(out.cacheCreationTokens).toBe(400_000);
    // 3 (input) + 3 (output) + 0.6 (cache read) + 1.5 (cache write) = 8.1
    expect(out.totalCostUsd).toBeCloseTo(8.1, 2);
  });

  it("boş listede sıfır döner", () => {
    expect(aggregateUsage([])).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalCostUsd: 0,
    });
  });
});
