/**
 * Token kullanımından USD maliyet hesabı (Claude Sonnet fiyatları).
 * Cache-aware: cache okuma (0.1×) ve cache yazımı (1.25×) faturada ayrı
 * kalemlerdir; taze input token'larından farklı fiyatlandırılır.
 *
 * `inputTokens` cache-DIŞI (taze) token sayısıdır — Anthropic usage'ında
 * `input_tokens` zaten cache_read/cache_creation'ı içermez.
 */

// USD / milyon token
export const PRICING = {
  input: 3.0,
  output: 15.0,
  cacheWrite: 3.75, // 1.25×
  cacheRead: 0.3, // 0.1×
} as const;

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

/** Tek bir kullanım kaydının USD maliyeti (yuvarlama yok). */
export function computeUsageCost(u: TokenUsage): number {
  return (
    ((u.inputTokens ?? 0) / 1_000_000) * PRICING.input +
    ((u.outputTokens ?? 0) / 1_000_000) * PRICING.output +
    ((u.cacheCreationTokens ?? 0) / 1_000_000) * PRICING.cacheWrite +
    ((u.cacheReadTokens ?? 0) / 1_000_000) * PRICING.cacheRead
  );
}

export interface AggregatedUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

/** Birden çok kaydı toplayıp toplam token + USD döndürür. */
export function aggregateUsage(records: TokenUsage[]): AggregatedUsage & { totalCostUsd: number } {
  const totals = records.reduce<AggregatedUsage>(
    (acc, r) => {
      acc.inputTokens += r.inputTokens ?? 0;
      acc.outputTokens += r.outputTokens ?? 0;
      acc.cacheReadTokens += r.cacheReadTokens ?? 0;
      acc.cacheCreationTokens += r.cacheCreationTokens ?? 0;
      return acc;
    },
    { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 }
  );
  return {
    ...totals,
    totalCostUsd: Math.round(computeUsageCost(totals) * 100) / 100,
  };
}
