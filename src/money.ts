const USD = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });

/**
 * Formats a budget as US dollars: 2000, "2000", "$2,000" and "about 2000 dollars" all become
 * "$2,000". Returns null when there is no number to format (e.g. "two hundred").
 */
export function formatUsd(value: unknown): string | null {
  const text = typeof value === "number" ? String(value) : typeof value === "string" ? value : "";
  const match = /\d[\d,]*(?:\.\d+)?/.exec(text);
  if (!match) return null;
  const amount = Number(match[0].replace(/,/g, ""));
  if (!Number.isFinite(amount)) return null;
  return USD.format(amount).replace(/\.00$/, "");
}
