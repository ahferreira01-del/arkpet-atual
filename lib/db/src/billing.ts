// Shared billing-interval definitions used by seeding, Stripe price creation,
// the API routes and the frontend. Keeping the discount math in one place ensures
// the DB-seeded prices, the Stripe prices and the UI badges never drift apart.

export const BILLING_INTERVALS = ["month", "quarter", "semester", "year"] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

// How many monthly cycles each interval bills at once.
export const INTERVAL_MONTHS: Record<BillingInterval, number> = {
  month: 1,
  quarter: 3,
  semester: 6,
  year: 12,
};

// Discount applied versus paying month-by-month.
export const INTERVAL_DISCOUNT_PCT: Record<BillingInterval, number> = {
  month: 0,
  quarter: 3,
  semester: 6,
  year: 10,
};

// Human labels (pt-BR) for UI and the per-period suffix.
export const INTERVAL_LABELS: Record<BillingInterval, string> = {
  month: "Mensal",
  quarter: "Trimestral",
  semester: "Semestral",
  year: "Anual",
};

export const INTERVAL_SUFFIX: Record<BillingInterval, string> = {
  month: "/mês",
  quarter: "/trimestre",
  semester: "/semestre",
  year: "/ano",
};

// Total amount (in centavos) charged per period for a given monthly base price.
// Rounded to the nearest centavo (not whole reais) to preserve exact pricing.
export function computeIntervalPrice(monthlyBrl: number, interval: BillingInterval): number {
  const months = INTERVAL_MONTHS[interval];
  const pct = INTERVAL_DISCOUNT_PCT[interval];
  const raw = monthlyBrl * months * (1 - pct / 100);
  return Math.round(raw);
}

// Stripe `recurring` config for each interval.
export function stripeRecurringFor(interval: BillingInterval): {
  interval: "month" | "year";
  interval_count: number;
} {
  switch (interval) {
    case "month":
      return { interval: "month", interval_count: 1 };
    case "quarter":
      return { interval: "month", interval_count: 3 };
    case "semester":
      return { interval: "month", interval_count: 6 };
    case "year":
      return { interval: "year", interval_count: 1 };
  }
}
