export const EXPIRY_VALUES = ["1h", "24h", "7d", "30d", "never"] as const;
export type ExpiryValue = (typeof EXPIRY_VALUES)[number];
