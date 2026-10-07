import { z } from "zod";

/** Orders from the restaurant's own website / online ordering (simulated checkout webhook). */
export const directOrderSchema = z.object({
  id: z.string(),
  storeSlug: z.string(),
  createdAt: z.string(),
  fulfillment: z.enum(["delivery", "pickup"]),
  customer: z.object({ name: z.string(), phone: z.string() }),
  lineItems: z.array(
    z.object({
      menuSku: z.string(),
      name: z.string(),
      qty: z.number().int().positive(),
      price: z.number(),
      options: z.array(z.object({ name: z.string(), price: z.number() })),
      note: z.string().optional(),
    }),
  ),
  totals: z.object({
    subtotal: z.number(),
    promo: z.number(),
    delivery: z.number(),
    vat: z.number(),
    total: z.number(),
  }),
  payment: z.object({ provider: z.enum(["card", "apple_pay", "cash"]), status: z.enum(["authorized", "pending"]) }),
  note: z.string().optional(),
});
export type DirectOrder = z.infer<typeof directOrderSchema>;
