import { describe, expect, it } from "vitest";

import { DEFAULT_PRODUCTS, formatPrice, fromRemoteProduct } from "../lib/products";

describe("product catalog", () => {
  it("ships with a useful starter catalog", () => {
    expect(DEFAULT_PRODUCTS.length).toBeGreaterThanOrEqual(6);
    expect(DEFAULT_PRODUCTS.every((product) => product.name && product.category && product.price > 0)).toBe(true);
    expect(DEFAULT_PRODUCTS.every((product) => /^\d{8,14}$/.test(product.barcode ?? ""))).toBe(true);
  });

  it("formats prices in Syrian pounds with whole-number grouping", () => {
    expect(formatPrice(26250)).toContain("ل.س");
    expect(formatPrice(26250)).toContain("٢٦");
    expect(formatPrice(12000)).toContain("ل.س");
  });

  it("maps cloud product records to the local fallback shape", () => {
    expect(fromRemoteProduct({ id: 42, name: "سكر", category: "مؤن", price: 8, unit: "كجم", emoji: "🧂", inStock: true, barcode: "6281007009999" })).toEqual({
      id: "42",
      name: "سكر",
      category: "مؤن",
      price: 8,
      unit: "كجم",
      emoji: "🧂",
      inStock: true,
      barcode: "6281007009999",
    });
  });
});
