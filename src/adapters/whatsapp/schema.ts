import { z } from "zod";

/** Orders captured from WhatsApp catalog carts (simulated WhatsApp Business webhook). */
export const whatsappOrderSchema = z.object({
  messageId: z.string(),
  conversationId: z.string(),
  branch: z.string(),
  receivedAt: z.string(),
  customerWaName: z.string(),
  customerWaPhone: z.string(),
  cart: z.array(
    z.object({
      catalogItemId: z.string(),
      name: z.string(),
      qty: z.number().int().positive(),
      price: z.number(),
      extras: z.array(z.string()),
      extrasPrice: z.number(),
    }),
  ),
  orderType: z.enum(["delivery", "pickup"]),
  deliveryCharge: z.number(),
  discount: z.number(),
  paymentPreference: z.enum(["cash", "payment_link"]),
  notes: z.string().optional(),
});
export type WhatsAppOrder = z.infer<typeof whatsappOrderSchema>;
