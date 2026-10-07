import { z } from "zod";

const money = z.object({ cents: z.number().int(), currency_code: z.literal("AED") });

/** Simulated Deliveroo order payload (amounts in minor units / fils). */
export const deliverooOrderSchema = z.object({
  id: z.string(),
  display_id: z.string(),
  location_id: z.string(),
  placed_at: z.string(),
  fulfillment_type: z.enum(["deliveroo", "customer_collection"]),
  customer: z.object({ first_name: z.string(), contact_number: z.string() }),
  items: z.array(
    z.object({
      pos_item_id: z.string(),
      name: z.string(),
      quantity: z.number().int().positive(),
      unit_price: money,
      modifiers: z.array(z.object({ name: z.string(), unit_price: money })),
    }),
  ),
  partner_order_subtotal: money,
  offer_discount: money,
  delivery_fee: money,
  vat: money,
  partner_order_total: money,
  cash_due: money,
  order_notes: z.string().nullable(),
});
export type DeliverooOrder = z.infer<typeof deliverooOrderSchema>;
