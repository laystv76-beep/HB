import AsyncStorage from "@react-native-async-storage/async-storage";

export type Product = {
  id: string;
  name: string;
  category: string;
  price: number;
  unit: string;
  emoji: string;
  inStock: boolean;
  barcode?: string;
};

export type RemoteProduct = Omit<Product, "id" | "barcode"> & {
  id: number;
  barcode: string | null;
  createdAt?: Date | string;
  updatedAt?: Date | string;
};

export const SAR_TO_SYP_RATE = 3500;
const STORAGE_KEY = "supermarketna.products.syp.v2";
export const CURRENCY_LABEL = "ل.س";

const toSyp = (sar: number) => Math.round(sar * SAR_TO_SYP_RATE);

export const DEFAULT_PRODUCTS: Product[] = [
  { id: "milk-1", name: "حليب كامل الدسم", category: "ألبان", price: toSyp(7.5), unit: "لتر", emoji: "🥛", inStock: true, barcode: "6281007001012" },
  { id: "bread-1", name: "خبز عربي طازج", category: "مخبوزات", price: toSyp(2.25), unit: "كيس", emoji: "🥖", inStock: true, barcode: "6281007001029" },
  { id: "rice-1", name: "أرز بسمتي فاخر", category: "مؤن", price: toSyp(18.9), unit: "2 كجم", emoji: "🍚", inStock: true, barcode: "6281007001036" },
  { id: "apple-1", name: "تفاح أحمر", category: "خضار وفواكه", price: toSyp(9.75), unit: "كجم", emoji: "🍎", inStock: true, barcode: "6281007001043" },
  { id: "chicken-1", name: "صدور دجاج طازجة", category: "لحوم ودواجن", price: toSyp(24.5), unit: "كجم", emoji: "🍗", inStock: true, barcode: "6281007001050" },
  { id: "water-1", name: "مياه معدنية", category: "مشروبات", price: toSyp(12), unit: "كرتون", emoji: "💧", inStock: true, barcode: "6281007001067" },
  { id: "oil-1", name: "زيت دوار الشمس", category: "مؤن", price: toSyp(16.25), unit: "1.5 لتر", emoji: "🫗", inStock: true, barcode: "6281007001074" },
  { id: "coffee-1", name: "قهوة عربية", category: "مشروبات", price: toSyp(32), unit: "500 جم", emoji: "☕", inStock: false, barcode: "6281007001081" },
];

export async function loadProducts(): Promise<Product[]> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (!stored) {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(DEFAULT_PRODUCTS));
      return DEFAULT_PRODUCTS;
    }
    const parsed = JSON.parse(stored) as Product[];
    return Array.isArray(parsed) ? parsed : DEFAULT_PRODUCTS;
  } catch {
    return DEFAULT_PRODUCTS;
  }
}

export async function saveProducts(products: Product[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(products));
}

export function fromRemoteProduct(product: RemoteProduct): Product {
  return {
    id: String(product.id),
    name: product.name,
    category: product.category,
    price: product.price,
    unit: product.unit,
    emoji: product.emoji,
    inStock: product.inStock,
    barcode: product.barcode ?? undefined,
  };
}

export function formatPrice(price: number): string {
  return `${Math.round(price).toLocaleString("ar-SY")} ${CURRENCY_LABEL}`;
}
