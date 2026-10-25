import type { Db } from "../db/client";
import { createAlertRepository, type AlertRepository } from "./alerts";
import { createAuditRepository, type AuditRepository } from "./audit";
import { createChannelRepository, type ChannelRepository } from "./channels";
import { createCustomerRepository, type CustomerRepository } from "./customers";
import { createEventRepository, type EventRepository } from "./events";
import { createInventoryRepository, type InventoryRepository } from "./inventory";
import { createMembershipRepository, type MembershipRepository } from "./memberships";
import { createMenuRepository, type MenuRepository } from "./menu";
import { createOrderRepository, type OrderRepository } from "./orders";
import {
  createLocationRepository,
  createOrganizationRepository,
  type LocationRepository,
  type OrganizationRepository,
} from "./organizations";

/** All persistence for one organization, bound to one connection/transaction. */
export interface Repositories {
  organization: OrganizationRepository;
  locations: LocationRepository;
  memberships: MembershipRepository;
  orders: OrderRepository;
  menu: MenuRepository;
  inventory: InventoryRepository;
  channels: ChannelRepository;
  customers: CustomerRepository;
  alerts: AlertRepository;
  events: EventRepository;
  audit: AuditRepository;
}

/**
 * `financials` merges finance-only fields (commission, food cost, unit cost,
 * commercial terms) through the database's financial functions, which refuse
 * callers without a finance role.
 */
export function createRepositories(db: Db, organizationId: string, opts: { financials?: boolean } = {}): Repositories {
  const fin = { financials: opts.financials ?? false };
  return {
    organization: createOrganizationRepository(db, organizationId, fin),
    locations: createLocationRepository(db, organizationId),
    memberships: createMembershipRepository(db, organizationId),
    orders: createOrderRepository(db, organizationId, fin),
    menu: createMenuRepository(db, organizationId, fin),
    inventory: createInventoryRepository(db, organizationId, fin),
    channels: createChannelRepository(db, organizationId),
    customers: createCustomerRepository(db, organizationId),
    alerts: createAlertRepository(db, organizationId),
    events: createEventRepository(db, organizationId),
    audit: createAuditRepository(db, organizationId),
  };
}
