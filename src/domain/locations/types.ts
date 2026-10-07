export interface Organization {
  id: string;
  name: string;
  slug: string;
  currency: "AED";
  timezone: string;
  createdAt: string;
  updatedAt: string;
}

export interface Restaurant {
  id: string;
  organizationId: string;
  name: string;
  cuisine: string;
  createdAt: string;
  updatedAt: string;
}

export interface OperatingHours {
  open: string; // "11:00"
  close: string; // "01:00" (may cross midnight)
}

export interface Location {
  id: string;
  organizationId: string;
  restaurantId: string;
  name: string;
  code: string;
  area: string;
  address: string;
  operatingHours: OperatingHours;
  /** Kitchen capacity: concurrent tickets before the kitchen is considered saturated. */
  kitchenCapacity: number;
  managerName: string;
  isOpen: boolean;
  createdAt: string;
  updatedAt: string;
}

export type UserRole = "owner" | "general_manager" | "branch_manager" | "kitchen_manager";

export interface AppUser {
  id: string;
  organizationId: string;
  name: string;
  email: string;
  role: UserRole;
  locationIds: string[] | "all";
  createdAt: string;
  updatedAt: string;
}

export interface Customer {
  id: string;
  organizationId: string;
  name: string;
  phone: string;
  area: string;
  firstOrderAt: string;
  createdAt: string;
  updatedAt: string;
}

/** "all" is the global multi-location context. */
export type LocationScope = string | "all";
export const ALL_LOCATIONS = "all" as const;
