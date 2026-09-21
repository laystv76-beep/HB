import { describe, expect, it } from "vitest";
import { calculateOrderTotal } from "../shared/order";

describe("cash-on-delivery orders", () => {
  it("calculates the cart total from unit prices and quantities", () => {
    expect(calculateOrderTotal([
      { unitPrice: 7.5, quantity: 2 },
      { unitPrice: 2.25, quantity: 1 },
    ])).toBe(17.25);
  });

  it("rounds totals to two decimal places", () => {
    expect(calculateOrderTotal([{ unitPrice: 1.999, quantity: 3 }])).toBe(6);
  });
});
