import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies";
import { ENV } from "./_core/env";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import * as db from "./db";
import { z } from "zod";
import { calculateOrderTotal } from "../shared/order";

const productInput = z.object({
  name: z.string().trim().min(1).max(255),
  category: z.string().trim().min(1).max(100),
  price: z.number().positive(),
  unit: z.string().trim().min(1).max(64),
  emoji: z.string().trim().min(1).max(16),
  barcode: z.string().trim().regex(/^\d{8,14}$/).optional().or(z.literal("")),
  inStock: z.boolean().default(true),
});

const orderInput = z.object({
  customerPhone: z.string().trim().regex(/^\+?[0-9\s-]{8,20}$/),
  deliveryAddress: z.string().trim().min(5).max(1000),
  locationNote: z.string().trim().max(500).optional(),
  items: z.array(z.object({
    productId: z.number().int().positive().optional(),
    productName: z.string().trim().min(1).max(255),
    unit: z.string().trim().min(1).max(64),
    unitPrice: z.number().positive(),
    quantity: z.number().int().min(1).max(99),
  })).min(1).max(100),
});

function assertManager(openId: string) {
  if (!ENV.ownerOpenId || openId !== ENV.ownerOpenId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Manager access required" });
  }
}

export const appRouter = router({
  // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  products: router({
    list: publicProcedure.query(() => db.getProducts()),
    byBarcode: publicProcedure.input(z.object({ barcode: z.string().min(1) })).query(({ input }) => db.getProductByBarcode(input.barcode)),
    create: publicProcedure.input(productInput).mutation(({ input }) => {
      return db.createProduct({ ...input, barcode: input.barcode || null });
    }),
    update: publicProcedure.input(productInput.extend({ id: z.number().int().positive() })).mutation(({ input }) => {
      const { id, ...values } = input;
      return db.updateProduct(id, { ...values, barcode: values.barcode || null });
    }),
    delete: publicProcedure.input(z.object({ id: z.number().int().positive() })).mutation(({ input }) => {
      return db.deleteProduct(input.id);
    }),
  }),
  orders: router({
    create: publicProcedure.input(orderInput).mutation(async ({ input }) => {
      const verifiedItems = await Promise.all(input.items.map(async (item) => {
        if (!item.productId) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "Product id is required" });
        }
        const product = await db.getProductById(item.productId);
        if (!product || !product.inStock) {
          throw new TRPCError({ code: "BAD_REQUEST", message: `Product unavailable: ${item.productName}` });
        }
        return {
          ...item,
          productName: product.name,
          unit: product.unit,
          unitPrice: product.price,
        };
      }));
      const total = calculateOrderTotal(verifiedItems);
      const id = await db.createOrder({
        customerPhone: input.customerPhone,
        deliveryAddress: input.deliveryAddress,
        locationNote: input.locationNote || null,
        total,
        paymentMethod: "cash_on_delivery",
        status: "pending",
      }, verifiedItems.map((item) => ({
        orderId: 0,
        productId: item.productId ?? null,
        productName: item.productName,
        unit: item.unit,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        subtotal: Number((item.unitPrice * item.quantity).toFixed(2)),
      })));
      return { id, total };
    }),
    list: publicProcedure.query(() => db.getOrdersWithItems()),
    items: publicProcedure.input(z.object({ orderId: z.number().int().positive() })).query(({ input }) => db.getOrderItems(input.orderId)),
    updateStatus: publicProcedure.input(z.object({
      id: z.number().int().positive(),
      status: z.enum(["pending", "confirmed", "out_for_delivery", "delivered", "cancelled"]),
    })).mutation(({ input }) => {
      return db.updateOrderStatus(input.id, input.status);
    }),
  }),
  settings: router({
    whatsapp: publicProcedure.query(() => db.getStoreSettings()),
    updateWhatsapp: publicProcedure.input(z.object({
      phone: z.string().trim().regex(/^\d{8,15}$/).or(z.literal("")),
    })).mutation(({ input }) => {
      return db.updateStoreSettings(input.phone || null);
    }),
  }),
});

export type AppRouter = typeof appRouter;
