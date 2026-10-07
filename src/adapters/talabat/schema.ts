import { z } from "zod";

/** Simulated Talabat order payload (shape modelled for v0.1; not the official API). */
export const talabatOrderSchema = z.object({
  order_id: z.string(),
  short_code: z.string(),
  vendor_code: z.string(),
  created_at: z.string(),
  expedition_type: z.enum(["TALABAT_DELIVERY", "PICKUP"]),
  customer: z.object({ first_name: z.string(), phone_masked: z.string() }),
  items: z.array(
    z.object({
      sku: z.string(),
      title: z.string(),
      qty: z.number().int().positive(),
      unit_price: z.number(),
      options: z.array(z.object({ title: z.string(), price: z.number() })),
      comment: z.string().optional(),
    }),
  ),
  payment: z.object({ method: z.enum(["ONLINE", "CASH"]), wallet_used: z.boolean() }),
  price: z.object({
    subtotal: z.number(),
    discount_total: z.number(),
    delivery_fee: z.number(),
    vat: z.number(),
    grand_total: z.number(),
  }),
  special_instructions: z.string().optional(),
  status: z.literal("RECEIVED"),
});
export type TalabatOrder = z.infer<typeof talabatOrderSchema>;
