const _parsed = Number(import.meta.env.VITE_AI_QUOTA_FREE_MAX);
export const AI_QUOTA_FREE_MAX: number =
  Number.isFinite(_parsed) && _parsed > 0 ? _parsed : 5;
export const BILLING_ENABLED: boolean =
  import.meta.env.VITE_BILLING_ENABLED === "true";
export const PRO_PRICE_USD: number = 5;
