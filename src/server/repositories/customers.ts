import type { Customer } from "@/domain/locations/types";
import type { Db } from "../db/client";
import { str } from "./mappers";

export interface CustomerRepository {
  list(): Promise<Customer[]>;
  findById(id: string): Promise<Customer | null>;
}

const mapCustomer = (r: Record<string, unknown>): Customer => ({
  id: str(r.id),
  organizationId: str(r.organization_id),
  name: str(r.name),
  phone: str(r.phone),
  area: str(r.area),
  firstOrderAt: str(r.first_order_at),
  createdAt: str(r.created_at),
  updatedAt: str(r.updated_at),
});

export function createCustomerRepository(db: Db, organizationId: string): CustomerRepository {
  return {
    async list() {
      return (await db`select * from public.customers where organization_id = ${organizationId}`).map(mapCustomer);
    },
    async findById(id) {
      const rows = await db`select * from public.customers where organization_id = ${organizationId} and id = ${id}`;
      return rows[0] ? mapCustomer(rows[0]) : null;
    },
  };
}
