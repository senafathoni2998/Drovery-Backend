export const PACKAGE_SIZES = ['Small', 'Medium', 'Large', 'XL'] as const;
export type PackageSize = (typeof PACKAGE_SIZES)[number];

export const PACKAGE_TYPES = [
  'food',
  'document',
  'fragile',
  'electronics',
  'clothing',
  'healthcare',
  'other',
] as const;
export type PackageType = (typeof PACKAGE_TYPES)[number];

export const MAX_WEIGHT_KG: Record<string, number> = {
  Small: 0.5,
  Medium: 1.5,
  Large: 3,
  XL: 5,
};

export const DELIVERY_STATUS_FLOW = [
  'PENDING',
  'CONFIRMED',
  'DRONE_ASSIGNED',
  'PICKUP_IN_PROGRESS',
  'IN_TRANSIT',
  'AWAITING_HANDOFF',
  'DELIVERED',
] as const;
