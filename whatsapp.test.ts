import { describe, expect, it } from "vitest";
import { buildOrderWhatsAppUrl } from "../shared/whatsapp";

describe("manual WhatsApp order message", () => {
  it("builds an international wa.me link with encoded order details", () => {
    const url = buildOrderWhatsAppUrl({
      phone: "966500000000",
      orderId: 42,
      totalLabel: "25 ر.س",
      customerPhone: "0501234567",
      address: "الرياض - حي النخيل",
      items: [{ name: "حليب كامل الدسم", quantity: 2 }],
    });
    expect(url.startsWith("https://wa.me/966500000000?text=")).toBe(true);
    expect(decodeURIComponent(url.split("?text=")[1])).toContain("طلب جديد #42");
    expect(decodeURIComponent(url.split("?text=")[1])).toContain("الرياض - حي النخيل");
    expect(decodeURIComponent(url.split("?text=")[1])).toContain("2 × حليب كامل الدسم");
  });
});
