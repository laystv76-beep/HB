import { asc, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertProduct, InsertUser, orderItems, orders, products, storeSettings, users } from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = "admin";
      updateSet.role = "admin";
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

export async function getProducts() {
  const db = await getDb();
  if (!db) return [];
  let result = await db.select().from(products).orderBy(asc(products.name));
  if (result.length === 0) {
    await db.insert(products).values([
      { name: "حليب كامل الدسم", category: "ألبان", price: 7.5, unit: "لتر", emoji: "🥛", barcode: "6281007001012", inStock: true },
      { name: "خبز عربي طازج", category: "مخبوزات", price: 2.25, unit: "كيس", emoji: "🥖", barcode: "6281007001029", inStock: true },
      { name: "أرز بسمتي فاخر", category: "مؤن", price: 18.9, unit: "2 كجم", emoji: "🍚", barcode: "6281007001036", inStock: true },
      { name: "تفاح أحمر", category: "خضار وفواكه", price: 9.75, unit: "كجم", emoji: "🍎", barcode: "6281007001043", inStock: true },
      { name: "صدور دجاج طازجة", category: "لحوم ودواجن", price: 24.5, unit: "كجم", emoji: "🍗", barcode: "6281007001050", inStock: true },
      { name: "مياه معدنية", category: "مشروبات", price: 12, unit: "كرتون", emoji: "💧", barcode: "6281007001067", inStock: true },
      { name: "زيت دوار الشمس", category: "مؤن", price: 16.25, unit: "1.5 لتر", emoji: "🫗", barcode: "6281007001074", inStock: true },
      { name: "قهوة عربية", category: "مشروبات", price: 32, unit: "500 جم", emoji: "☕", barcode: "6281007001081", inStock: false },
    ]);
    result = await db.select().from(products).orderBy(asc(products.name));
  }
  return result;
}

export async function getProductByBarcode(barcode: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(products).where(eq(products.barcode, barcode)).limit(1);
  return result[0];
}

export async function getProductById(id: number) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(products).where(eq(products.id, id)).limit(1);
  return result[0];
}

export async function createProduct(product: InsertProduct) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(products).values(product);
}

export async function updateProduct(id: number, values: Partial<InsertProduct>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(products).set(values).where(eq(products.id, id));
}

export async function deleteProduct(id: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(products).where(eq(products.id, id));
}

export async function createOrder(order: typeof orders.$inferInsert, items: (typeof orderItems.$inferInsert)[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const result = await db.insert(orders).values(order);
  // Drizzle's mysql2 adapter returns [ResultSetHeader, FieldPacket[]].
  const resultSet = (result as unknown as [{ insertId: number }])[0];
  const orderId = Number(resultSet?.insertId);
  if (!Number.isInteger(orderId) || orderId <= 0) {
    throw new Error("Could not determine the created order id");
  }
  await db.insert(orderItems).values(items.map((item) => ({ ...item, orderId })));
  return orderId;
}

export async function getOrders() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(orders).orderBy(desc(orders.createdAt));
}

export async function getOrdersWithItems() {
  const orderList = await getOrders();
  return Promise.all(orderList.map(async (order) => ({
    ...order,
    items: await getOrderItems(order.id),
  })));
}

export async function getOrderItems(orderId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(orderItems).where(eq(orderItems.orderId, orderId));
}

export async function updateOrderStatus(id: number, status: "pending" | "confirmed" | "out_for_delivery" | "delivered" | "cancelled") {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(orders).set({ status }).where(eq(orders.id, id));
}

export async function getStoreSettings() {
  const db = await getDb();
  if (!db) return { whatsappPhone: null };
  const result = await db.select().from(storeSettings).limit(1);
  return { whatsappPhone: result[0]?.whatsappPhone ?? null };
}

export async function updateStoreSettings(whatsappPhone: string | null) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await db.select({ id: storeSettings.id }).from(storeSettings).limit(1);
  if (existing[0]) await db.update(storeSettings).set({ whatsappPhone }).where(eq(storeSettings.id, existing[0].id));
  else await db.insert(storeSettings).values({ whatsappPhone });
}
