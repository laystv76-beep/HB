import { MaterialIcons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { formatPrice, fromRemoteProduct, loadProducts, saveProducts, type Product } from "@/lib/products";
import { useColors } from "@/hooks/use-colors";
import { trpc } from "@/lib/trpc";
import { buildOrderWhatsAppUrl } from "@/shared/whatsapp";

const categoryIcons: Record<string, string> = {
  الكل: "apps",
  ألبان: "local-drink",
  مخبوزات: "bakery-dining",
  مؤن: "inventory-2",
  "خضار وفواكه": "eco",
  "لحوم ودواجن": "restaurant",
  مشروبات: "local-cafe",
};

type CartLine = Product & { quantity: number };

export default function HomeScreen() {
  const colors = useColors();
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("الكل");
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [cartVisible, setCartVisible] = useState(false);
  const [addedProductName, setAddedProductName] = useState<string | null>(null);
  const cartPulse = useRef(new Animated.Value(1)).current;
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [locationNote, setLocationNote] = useState("");
  const cloudProductsQuery = trpc.products.list.useQuery(undefined, {
    refetchInterval: 15_000,
    refetchOnReconnect: true,
  });
  const orderMutation = trpc.orders.create.useMutation();
  const whatsappQuery = trpc.settings.whatsapp.useQuery(undefined, { refetchInterval: 15_000, refetchOnReconnect: true });
  const cloudProducts = cloudProductsQuery.data?.map(fromRemoteProduct) ?? null;
  const isCloudConnected = Boolean(cloudProducts && !cloudProductsQuery.isError);

  useEffect(() => {
    loadProducts().then(setProducts).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!cloudProducts) return;
    setProducts(cloudProducts);
    saveProducts(cloudProducts).catch(() => undefined);
  }, [cloudProductsQuery.data]);

  const categories = useMemo(() => {
    const values = Array.from(new Set(products.map((product) => product.category)));
    return ["الكل", ...values];
  }, [products]);

  const filteredProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return products.filter((product) => {
      const matchesCategory = selectedCategory === "الكل" || product.category === selectedCategory;
      const matchesQuery = !normalizedQuery || product.name.toLowerCase().includes(normalizedQuery) || (product.barcode ?? "").includes(normalizedQuery);
      return matchesCategory && matchesQuery && product.inStock;
    });
  }, [products, query, selectedCategory]);

  const cartItems = useMemo<CartLine[]>(() => products
    .filter((product) => (cart[product.id] ?? 0) > 0)
    .map((product) => ({ ...product, quantity: cart[product.id] ?? 0 })), [cart, products]);
  const cartCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const cartTotal = cartItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const hasUnsyncedItems = cartItems.some((item) => !/^\d+$/.test(item.id));

  const addToCart = (product: Product) => {
    setCart((previous) => ({ ...previous, [product.id]: Math.min((previous[product.id] ?? 0) + 1, 99) }));
    if (Platform.OS !== "web") void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setAddedProductName(product.name);
    cartPulse.stopAnimation();
    cartPulse.setValue(1);
    Animated.sequence([
      Animated.timing(cartPulse, { toValue: 1.12, duration: 140, useNativeDriver: true }),
      Animated.timing(cartPulse, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start();
  };

  const changeQuantity = (productId: string, delta: number) => {
    setCart((previous) => {
      const nextQuantity = Math.max((previous[productId] ?? 0) + delta, 0);
      const next = { ...previous };
      if (nextQuantity === 0) delete next[productId];
      else next[productId] = nextQuantity;
      return next;
    });
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    const result = await cloudProductsQuery.refetch();
    if (!result.data) setProducts(await loadProducts());
    setRefreshing(false);
  }, [cloudProductsQuery]);

  const submitOrder = async () => {
    if (hasUnsyncedItems) {
      Alert.alert("الاتصال مطلوب", "حدّث قائمة المنتجات عبر الإنترنت قبل إرسال الطلب.");
      return;
    }
    if (!/^\+?[0-9\s-]{8,20}$/.test(phone.trim())) {
      Alert.alert("رقم التواصل غير صحيح", "أدخل رقم هاتف صالحاً حتى نتواصل معك لتوصيل الطلب.");
      return;
    }
    if (address.trim().length < 5) {
      Alert.alert("العنوان ناقص", "اكتب عنوان التوصيل بالتفصيل.");
      return;
    }
    try {
      const result = await orderMutation.mutateAsync({
        customerPhone: phone.trim(),
        deliveryAddress: address.trim(),
        locationNote: locationNote.trim() || undefined,
        items: cartItems.map((item) => ({
          productId: Number(item.id),
          productName: item.name,
          unit: item.unit,
          unitPrice: item.price,
          quantity: item.quantity,
        })),
      });
      setCart({});
      setPhone("");
      setAddress("");
      setLocationNote("");
      setCartVisible(false);
      const whatsappPhone = whatsappQuery.data?.whatsappPhone ?? "";
      const whatsappUrl = whatsappPhone ? buildOrderWhatsAppUrl({
        phone: whatsappPhone,
        orderId: result.id,
        totalLabel: formatPrice(result.total),
        customerPhone: phone.trim(),
        address: address.trim(),
        locationNote: locationNote.trim(),
        items: cartItems.map((item) => ({ name: item.name, quantity: item.quantity })),
      }) : "";
      const message = `رقم الطلب: #${result.id}\nالإجمالي: ${formatPrice(result.total)}\n\nالدفع نقداً عند الاستلام.`;
      if (whatsappUrl) {
        Alert.alert("تم إرسال الطلب", `${message}\n\nافتح واتساب وأرسل إشعار الطلب للمتجر.`, [
          { text: "لاحقاً", style: "cancel" },
          { text: "فتح واتساب", onPress: () => { void Linking.openURL(whatsappUrl); } },
        ]);
      } else {
        Alert.alert("تم إرسال الطلب", `${message}\n\nسيتم التواصل معك لتأكيد الطلب.`);
      }
    } catch {
      Alert.alert("تعذر إرسال الطلب", "تحقق من اتصال الإنترنت وحاول مرة أخرى.");
    }
  };

  const renderProduct = ({ item }: { item: Product }) => (
    <View style={{ flex: 1, minHeight: 205, marginBottom: 12, marginHorizontal: 5, borderRadius: 22, padding: 14, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border }}>
      <Pressable onPress={() => addToCart(item)} style={({ pressed }) => [pressed && { opacity: 0.78, transform: [{ scale: 0.98 }] }]}>
        <View style={{ alignItems: "flex-end" }}><View style={{ width: 54, height: 54, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "#E8F4EA" }}><Text style={{ fontSize: 30 }}>{item.emoji}</Text></View></View>
        <Text numberOfLines={2} style={{ marginTop: 12, textAlign: "right", color: colors.foreground, fontSize: 15, fontWeight: "700", lineHeight: 21 }}>{item.name}</Text>
        <Text style={{ marginTop: 4, textAlign: "right", color: colors.muted, fontSize: 12 }}>{item.unit}</Text>
        <View style={{ marginTop: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}><View style={{ borderRadius: 10, backgroundColor: "#E8F4EA", paddingHorizontal: 7, paddingVertical: 4 }}><Text style={{ color: "#176B45", fontSize: 10, fontWeight: "700" }}>متوفر</Text></View><Text style={{ color: "#176B45", fontSize: 16, fontWeight: "800" }}>{formatPrice(item.price)}</Text></View>
      </Pressable>
      <Pressable onPress={() => addToCart(item)} style={({ pressed }) => [{ marginTop: 10, minHeight: 36, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, borderRadius: 11, backgroundColor: "#176B45" }, pressed && { opacity: 0.8 }]}><MaterialIcons name="add-shopping-cart" size={16} color="#FFFFFF" /><Text style={{ color: "#FFFFFF", fontSize: 11, fontWeight: "800" }}>أضف للسلة</Text></Pressable>
    </View>
  );

  const listHeader = (
    <View>
      <View style={{ marginBottom: 18, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}><View style={{ flex: 1, paddingLeft: 14 }}><Text style={{ color: colors.muted, fontSize: 13, textAlign: "right" }}>مرحباً بك في</Text><Text style={{ marginTop: 2, color: colors.foreground, fontSize: 27, fontWeight: "900", textAlign: "right" }}>HB</Text></View><View style={{ width: 52, height: 52, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "#176B45" }}><MaterialIcons name="shopping-basket" size={27} color="#FFFFFF" /></View></View>
      <View style={{ marginBottom: 16, overflow: "hidden", borderRadius: 26, backgroundColor: "#176B45", padding: 20 }}><View style={{ position: "absolute", right: -22, top: -25, width: 110, height: 110, borderRadius: 55, backgroundColor: "#2C855E", opacity: 0.55 }} /><Text style={{ color: "#BDE5C9", fontSize: 12, fontWeight: "700", textAlign: "right" }}>كل ما تحتاجه… أقرب إليك</Text><Text style={{ marginTop: 7, color: "#FFFFFF", fontSize: 22, fontWeight: "900", lineHeight: 30, textAlign: "right" }}>أسعار واضحة،{String.fromCharCode(10)}وتسوق أسهل</Text><View style={{ marginTop: 14, flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 6 }}><Text style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "700" }}>توصيل حتى باب المنزل</Text><MaterialIcons name="local-shipping" size={16} color="#F4C95D" /></View></View>
      <Animated.View style={{ transform: [{ scale: cartPulse }] }}><Pressable onPress={() => setCartVisible(true)} style={({ pressed }) => [{ marginBottom: 8, minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 16, backgroundColor: cartCount > 0 ? "#F4C95D" : colors.surface, borderWidth: 1, borderColor: cartCount > 0 ? "#F4C95D" : colors.border, paddingHorizontal: 15 }, pressed && { opacity: 0.8 }]}><View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><MaterialIcons name="arrow-forward" size={18} color={cartCount > 0 ? "#59451A" : colors.muted} /><Text style={{ color: cartCount > 0 ? "#59451A" : colors.muted, fontSize: 12, fontWeight: "700" }}>الطلب والدفع نقداً عند الاستلام</Text></View><View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><Text style={{ color: cartCount > 0 ? "#59451A" : colors.foreground, fontSize: 15, fontWeight: "900" }}>سلة المشتريات {cartCount > 0 ? `(${cartCount})` : ""}</Text><MaterialIcons name="shopping-cart" size={22} color={cartCount > 0 ? "#59451A" : "#176B45"} /></View></Pressable></Animated.View>
      {addedProductName && <Pressable onPress={() => setCartVisible(true)} style={{ marginBottom: 10, borderRadius: 12, backgroundColor: "#EAF6ED", paddingHorizontal: 12, paddingVertical: 8 }}><Text style={{ color: "#176B45", fontSize: 12, fontWeight: "800", textAlign: "right" }}>تمت إضافة «{addedProductName}» إلى السلة · اضغط لعرض الطلب</Text></Pressable>}
      <View style={{ flexDirection: "row", alignItems: "center", borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, minHeight: 50 }}><TextInput value={query} onChangeText={setQuery} placeholder="ابحث بالاسم أو الباركود…" placeholderTextColor={colors.muted} style={{ flex: 1, color: colors.foreground, textAlign: "right", fontSize: 14, paddingVertical: 12 }} returnKeyType="search" /><MaterialIcons name="search" size={22} color="#176B45" /></View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: "row-reverse", gap: 8, paddingVertical: 18 }}>{categories.map((category) => { const active = selectedCategory === category; return <Pressable key={category} onPress={() => setSelectedCategory(category)} style={({ pressed }) => [{ flexDirection: "row", alignItems: "center", gap: 6, borderRadius: 14, paddingHorizontal: 13, paddingVertical: 9, backgroundColor: active ? "#176B45" : colors.surface, borderWidth: 1, borderColor: active ? "#176B45" : colors.border }, pressed && { opacity: 0.78 }]}><MaterialIcons name={(categoryIcons[category] ?? "category") as never} size={16} color={active ? "#FFFFFF" : colors.muted} /><Text style={{ color: active ? "#FFFFFF" : colors.foreground, fontSize: 12, fontWeight: "700" }}>{category}</Text></Pressable>; })}</ScrollView>
      <View style={{ marginBottom: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}><View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}><View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: isCloudConnected ? "#2E8B57" : "#D7A62A" }} /><Text style={{ color: colors.muted, fontSize: 11 }}>{isCloudConnected ? "أسعار محدثة" : "نسخة محلية"} · {filteredProducts.length} منتجات</Text></View><Text style={{ color: colors.foreground, fontSize: 19, fontWeight: "900", textAlign: "right" }}>المنتجات المتاحة</Text></View>
    </View>
  );

  return <ScreenContainer className="px-4" containerClassName="bg-background">
    {loading ? <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator size="large" color="#176B45" /><Text style={{ marginTop: 12, color: colors.muted }}>جاري تحميل المنتجات…</Text></View> : <FlatList data={filteredProducts} keyExtractor={(item) => item.id} renderItem={renderProduct} numColumns={2} columnWrapperStyle={{ marginHorizontal: -5 }} ListHeaderComponent={listHeader} ListEmptyComponent={<View style={{ alignItems: "center", paddingVertical: 40 }}><MaterialIcons name="search-off" size={42} color={colors.muted} /><Text style={{ marginTop: 10, color: colors.muted, textAlign: "center" }}>لا توجد منتجات مطابقة لبحثك</Text></View>} contentContainerStyle={{ paddingTop: 14, paddingBottom: 30 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#176B45" colors={["#176B45"]} />} showsVerticalScrollIndicator={false} />}
    <Modal visible={cartVisible} transparent animationType="slide" onRequestClose={() => setCartVisible(false)}><KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(13,36,24,0.35)" }}><View style={{ maxHeight: "92%", borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: colors.background, padding: 20 }}><View style={{ marginBottom: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}><Pressable onPress={() => setCartVisible(false)} style={({ pressed }) => [{ width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface }, pressed && { opacity: 0.65 }]}><MaterialIcons name="close" size={20} color={colors.foreground} /></Pressable><Text style={{ color: colors.foreground, fontSize: 21, fontWeight: "900" }}>سلة المشتريات</Text></View>{cartItems.length === 0 ? <View style={{ alignItems: "center", paddingVertical: 35 }}><MaterialIcons name="remove-shopping-cart" size={48} color={colors.muted} /><Text style={{ marginTop: 12, color: colors.muted, fontSize: 14 }}>السلة فارغة، أضف ما تحتاجه أولاً</Text></View> : <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled"><View style={{ marginBottom: 14, gap: 8 }}>{cartItems.map((item) => <View key={item.id} style={{ flexDirection: "row", alignItems: "center", borderRadius: 15, backgroundColor: colors.surface, padding: 10 }}><View style={{ flex: 1 }}><Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "800", textAlign: "right" }}>{item.name}</Text><Text style={{ marginTop: 4, color: "#176B45", fontSize: 12, fontWeight: "700", textAlign: "right" }}>{formatPrice(item.price * item.quantity)}</Text></View><View style={{ flexDirection: "row", alignItems: "center", gap: 9, marginLeft: 12 }}><Pressable onPress={() => changeQuantity(item.id, -1)} style={({ pressed }) => [{ width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: "#FDECEC" }, pressed && { opacity: 0.7 }]}><MaterialIcons name="remove" size={17} color="#C24141" /></Pressable><Text style={{ minWidth: 18, color: colors.foreground, fontSize: 14, fontWeight: "900", textAlign: "center" }}>{item.quantity}</Text><Pressable onPress={() => changeQuantity(item.id, 1)} style={({ pressed }) => [{ width: 30, height: 30, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: "#E8F4EA" }, pressed && { opacity: 0.7 }]}><MaterialIcons name="add" size={17} color="#176B45" /></Pressable></View><Text style={{ width: 30, fontSize: 24, textAlign: "center" }}>{item.emoji}</Text></View>)}</View><View style={{ marginBottom: 14, borderRadius: 15, backgroundColor: "#EAF6ED", padding: 13 }}><View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}><Text style={{ color: "#176B45", fontSize: 18, fontWeight: "900" }}>{formatPrice(cartTotal)}</Text><Text style={{ color: "#176B45", fontSize: 13, fontWeight: "800" }}>الإجمالي</Text></View><Text style={{ marginTop: 5, color: "#437253", fontSize: 11, textAlign: "right" }}>طريقة الدفع: نقداً عند استلام الطلب</Text></View><Text style={{ marginBottom: 8, color: colors.foreground, fontSize: 15, fontWeight: "900", textAlign: "right" }}>بيانات التوصيل</Text><TextInput value={phone} onChangeText={setPhone} placeholder="رقم التواصل" placeholderTextColor={colors.muted} keyboardType="phone-pad" style={{ marginBottom: 10, minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: colors.border, color: colors.foreground, paddingHorizontal: 14, textAlign: "right" }} /><TextInput value={address} onChangeText={setAddress} placeholder="العنوان بالتفصيل (الحي، الشارع، رقم المنزل)" placeholderTextColor={colors.muted} multiline style={{ marginBottom: 10, minHeight: 72, borderRadius: 14, borderWidth: 1, borderColor: colors.border, color: colors.foreground, paddingHorizontal: 14, paddingTop: 13, textAlign: "right", textAlignVertical: "top" }} /><TextInput value={locationNote} onChangeText={setLocationNote} placeholder="وصف إضافي للموقع (اختياري)" placeholderTextColor={colors.muted} multiline style={{ marginBottom: 14, minHeight: 58, borderRadius: 14, borderWidth: 1, borderColor: colors.border, color: colors.foreground, paddingHorizontal: 14, paddingTop: 13, textAlign: "right", textAlignVertical: "top" }} /><Pressable onPress={() => void submitOrder()} disabled={orderMutation.isPending || hasUnsyncedItems} style={({ pressed }) => [{ minHeight: 54, alignItems: "center", justifyContent: "center", borderRadius: 16, backgroundColor: hasUnsyncedItems ? "#B8C5BC" : "#176B45", opacity: orderMutation.isPending ? 0.65 : 1 }, pressed && { opacity: 0.82 }]}><Text style={{ color: "#FFFFFF", fontSize: 15, fontWeight: "900" }}>{orderMutation.isPending ? "جاري إرسال الطلب…" : hasUnsyncedItems ? "اتصل بالإنترنت لإتمام الطلب" : "تأكيد الطلب والدفع عند الاستلام"}</Text></Pressable></ScrollView>}</View></KeyboardAvoidingView></Modal>
  </ScreenContainer>;
}
