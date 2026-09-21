export type OrderLineForTotal = {
  unitPrice: number;
  quantity: number;
};

export function calculateOrderTotal(items: OrderLineForTotal[]): number {
  return Number(items.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0).toFixed(2));
}
