export function buildOrderWhatsAppUrl(input: {
  phone: string;
  orderId: number;
  totalLabel: string;
  customerPhone: string;
  address: string;
  locationNote?: string;
  items?: Array<{ name: string; quantity: number }>;
}): string {
  const message = [
    `طلب جديد #${input.orderId}`,
    input.items?.length ? `الأصناف:\n${input.items.map((item) => `- ${item.quantity} × ${item.name}`).join("\n")}` : "",
    `الإجمالي: ${input.totalLabel}`,
    `رقم العميل: ${input.customerPhone}`,
    `العنوان: ${input.address}`,
    input.locationNote ? `ملاحظة الموقع: ${input.locationNote}` : "",
  ].filter(Boolean).join("\n");
  return `https://wa.me/${input.phone}?text=${encodeURIComponent(message)}`;
}
