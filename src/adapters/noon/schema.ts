import { z } from "zod";

/** Simulated Noon Food order payload (camelCase, epoch-ms timestamps). */
export const noonOrderSchema = z.object({
  orderRef: z.string(),
  outletId: z.string(),
  orderedAt: z.number().int(),
  deliveryMode: z.enum(["NOON_FLEET", "SELF_PICKUP"]),
  customerName: z.string(),
  customerMobile: z.string(),
  lines: z.array(
    z.object({
      productCode: z.string(),
      productName: z.string(),
      quantity: z.number().int().positive(),
      unitPrice: z.number(),
      addOns: z.array(z.object({ label: z.string(), amount: z.number() })),
      lineTotal: z.number(),
    }),
  ),
  amounts: z.object({
    itemsTotal: z.number(),
    discount: z.number(),
    deliveryCharge: z.number(),
    vatAmount: z.number(),
    payable: z.number(),
  }),
  paymentMode: z.enum(["PREPAID", "COD"]),
  remarks: z.string().optional(),
});
export type NoonOrder = z.infer<typeof noonOrderSchema>;
