// Estimate cost from transcript token usage. Prices are per million tokens (USD)
// and approximate — labeled "est." in the UI.

export interface Usage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

interface Price {
  in: number;
  out: number;
  cacheWrite: number;
  cacheRead: number;
}

function priceFor(model: string): Price {
  const m = (model || "").toLowerCase();
  if (m.includes("opus")) return { in: 15, out: 75, cacheWrite: 18.75, cacheRead: 1.5 };
  if (m.includes("haiku")) return { in: 0.8, out: 4, cacheWrite: 1, cacheRead: 0.08 };
  // sonnet / fable / unknown → sonnet-tier
  return { in: 3, out: 15, cacheWrite: 3.75, cacheRead: 0.3 };
}

export function costOf(u: Usage): number {
  const p = priceFor(u.model);
  return (
    (u.inputTokens * p.in + u.outputTokens * p.out + u.cacheReadTokens * p.cacheRead + u.cacheWriteTokens * p.cacheWrite) /
    1e6
  );
}

export function totalTokens(u: Usage): number {
  return u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheWriteTokens;
}

export function fmtTokens(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return String(n);
}

export function fmtCost(n: number): string {
  return n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(3)}`;
}
