import { z } from "zod";

/** Simulated Keeta order payload (numeric ids, unix-second timestamps, amounts in fils). */
export const keetaOrderSchema = z.object({
  orderId: z.number().int(),
  orderViewId: z.string(),
  shopId: z.number().int(),
  ctime: z.number().int(),
  deliveryType: z.union([z.literal(1), z.literal(2)]), // 1 = Keeta rider, 2 = self pickup
  recipient: z.object({ name: z.string(), phoneTail: z.string() }),
  products: z.array(
    z.object({
      spuId: z.string(),
      name: z.string(),
      count: z.number().int().positive(),
      price: z.number().int(), // fils
      attrs: z.array(z.object({ name: z.string(), price: z.number().int() })),
    }),
  ),
  fee: z.object({
    productAmount: z.number().int(),
    discountAmount: z.number().int(),
    shippingFee: z.number().int(),
    vatAmount: z.number().int(),
    payAmount: z.number().int(),
  }),
  payType: z.union([z.literal(1), z.literal(2)]), // 1 = online, 2 = cash
  remark: z.string(),
});
export type KeetaOrder = z.infer<typeof keetaOrderSchema>;
