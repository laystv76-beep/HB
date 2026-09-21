import { MaterialIcons } from "@expo/vector-icons";
import { CameraView, useCameraPermissions, type BarcodeScanningResult } from "expo-camera";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import { ScreenContainer } from "@/components/screen-container";
import { OWNER_OPEN_ID, startOAuthLogin } from "@/constants/oauth";
import { useAuth } from "@/hooks/use-auth";
import { formatPrice, fromRemoteProduct, loadProducts, saveProducts, type Product } from "@/lib/products";
import { trpc } from "@/lib/trpc";
import { useColors } from "@/hooks/use-colors";
import { CUSTOMER_MODE } from "@/constants/app-mode";

const emptyForm = { name: "", category: "مؤن", price: "", unit: "قطعة", emoji: "🛒", barcode: "" };

type ProductPayload = Omit<Product, "id">;

export default function ManageScreen() {
  const colors = useColors();
  const { user, loading: authLoading } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [modalVisible, setModalVisible] = useState(false);
  const [scannerVisible, setScannerVisible] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [permission, requestPermission] = useCameraPermissions();
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const [whatsappPhone, setWhatsappPhone] = useState("");

  const cloudProductsQuery = trpc.products.list.useQuery(undefined, {
    refetchInterval: 15_000,
    refetchOnReconnect: true,
  });
  const createProduct = trpc.products.create.useMutation();
  const updateProduct = trpc.products.update.useMutation();
  const deleteProduct = trpc.products.delete.useMutation();
  const isManager = !CUSTOMER_MODE || Boolean(user && (user.role === "admin" || user.openId === OWNER_OPEN_ID));
  const isCloudConnected = Boolean(cloudProductsQuery.data && !cloudProductsQuery.isError);
  const ordersQuery = trpc.orders.list.useQuery(undefined, { enabled: isManager, refetchInterval: 15_000 });
  const updateOrderStatus = trpc.orders.updateStatus.useMutation();
  const orderItemsQuery = trpc.orders.items.useQuery({ orderId: selectedOrderId ?? 0 }, { enabled: isManager && selectedOrderId !== null });
  const whatsappQuery = trpc.settings.whatsapp.useQuery(undefined, { refetchInterval: 15_000 });
  const updateWhatsapp = trpc.settings.updateWhatsapp.useMutation();

  useEffect(() => {
    loadProducts().then(setProducts).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!cloudProductsQuery.data) return;
    const nextProducts = cloudProductsQuery.data.map(fromRemoteProduct);
    setProducts(nextProducts);
    saveProducts(nextProducts).catch(() => undefined);
  }, [cloudProductsQuery.data]);

  useEffect(() => {
    setWhatsappPhone(whatsappQuery.data?.whatsappPhone ?? "");
  }, [whatsappQuery.data?.whatsappPhone]);

  const requestManagerAccess = useCallback(async () => {
    if (isManager) return true;
    if (!user) {
      await startOAuthLogin();
      return false;
    }
    Alert.alert("صلاحية المدير مطلوبة", "هذا الحساب لا يملك صلاحية تعديل المنتجات. سجّل الدخول بحساب المدير.");
    return false;
  }, [isManager, user]);

  const refreshProducts = useCallback(async () => {
    const result = await cloudProductsQuery.refetch();
    if (!result.data) setProducts(await loadProducts());
  }, [cloudProductsQuery]);

  const openAdd = async () => {
    if (!(await requestManagerAccess())) return;
    setEditing(null);
    setForm(emptyForm);
    setModalVisible(true);
  };

  const openEdit = async (product: Product) => {
    if (!(await requestManagerAccess())) return;
    setEditing(product);
    setForm({ name: product.name, category: product.category, price: String(product.price), unit: product.unit, emoji: product.emoji, barcode: product.barcode ?? "" });
    setModalVisible(true);
  };

  const closeModal = () => {
    setModalVisible(false);
    setEditing(null);
    setForm(emptyForm);
  };

  const openScanner = async () => {
    if (!(await requestManagerAccess())) return;
    if (Platform.OS === "web") {
      Alert.alert("المسح بالكاميرا", "مسح الباركود متاح من تطبيق الجوال. استخدم حقل الباركود في نسخة المتصفح.");
      return;
    }
    if (!permission?.granted) {
      const result = await requestPermission();
      if (!result.granted) {
        Alert.alert("صلاحية الكاميرا مطلوبة", "اسمح للتطبيق باستخدام الكاميرا حتى تتمكن من مسح الباركود.");
        return;
      }
    }
    setScanned(false);
    setScannerVisible(true);
  };

  const closeScanner = () => {
    setScannerVisible(false);
    setScanned(false);
  };

  const handleBarcodeScanned = ({ data }: BarcodeScanningResult) => {
    if (scanned || !data) return;
    setScanned(true);
    const normalized = data.trim();
    const existing = products.find((product) => product.barcode === normalized);
    closeScanner();
    if (existing) {
      void openEdit(existing);
      Alert.alert("تم العثور على المنتج", `تم فتح «${existing.name}» لتعديل بياناته.`);
      return;
    }
    setEditing(null);
    setForm({ ...emptyForm, barcode: normalized });
    setModalVisible(true);
    Alert.alert("باركود جديد", "تمت تعبئة رقم الباركود. أكمل بيانات المنتج ثم احفظه.");
  };

  const getPayload = (): ProductPayload | null => {
    const price = Number(form.price.replace(",", "."));
    const barcode = form.barcode.trim();
    if (!form.name.trim() || !Number.isFinite(price) || price <= 0) {
      Alert.alert("بيانات ناقصة", "أدخل اسم المنتج وسعراً صحيحاً أكبر من صفر.");
      return null;
    }
    if (barcode && !/^\d{8,14}$/.test(barcode)) {
      Alert.alert("باركود غير صحيح", "يجب أن يتكون الباركود من 8 إلى 14 رقماً.");
      return null;
    }
    return {
      name: form.name.trim(),
      category: form.category.trim() || "أخرى",
      price,
      unit: form.unit.trim() || "قطعة",
      emoji: form.emoji.trim() || "🛒",
      inStock: editing?.inStock ?? true,
      barcode: barcode || undefined,
    };
  };

  const handleSave = async () => {
    if (!isManager) return;
    const payload = getPayload();
    if (!payload) return;
    const duplicate = payload.barcode && products.find((item) => item.barcode === payload.barcode && item.id !== editing?.id);
    if (duplicate) {
      Alert.alert("الباركود مستخدم", `الباركود مرتبط بالمنتج «${duplicate.name}». استخدم رقماً آخر.`);
      return;
    }
    try {
      const remoteId = editing && /^\d+$/.test(editing.id) ? Number(editing.id) : null;
      if (remoteId) {
        await updateProduct.mutateAsync({ id: remoteId, ...payload });
      } else {
        await createProduct.mutateAsync(payload);
      }
      await cloudProductsQuery.refetch();
      closeModal();
      Alert.alert("تم الحفظ", "تم تحديث السعر والبيانات على السحابة لجميع المستخدمين.");
    } catch {
      Alert.alert("تعذر الحفظ", "تحقق من اتصال الإنترنت وصلاحية حساب المدير ثم حاول مجدداً.");
    }
  };

  const toggleStock = async (product: Product) => {
    if (!isManager || !/^\d+$/.test(product.id)) return;
    try {
      await updateProduct.mutateAsync({
        id: Number(product.id),
        name: product.name,
        category: product.category,
        price: product.price,
        unit: product.unit,
        emoji: product.emoji,
        barcode: product.barcode,
        inStock: !product.inStock,
      });
      await cloudProductsQuery.refetch();
    } catch {
      Alert.alert("تعذر التحديث", "لم يتم تغيير حالة التوفر.");
    }
  };

  const removeProduct = (product: Product) => {
    if (!isManager || !/^\d+$/.test(product.id)) return;
    Alert.alert("حذف المنتج", `هل تريد حذف «${product.name}» من السحابة؟`, [
      { text: "إلغاء", style: "cancel" },
      { text: "حذف", style: "destructive", onPress: async () => {
        try {
          await deleteProduct.mutateAsync({ id: Number(product.id) });
          await cloudProductsQuery.refetch();
        } catch {
          Alert.alert("تعذر الحذف", "تحقق من اتصال الإنترنت ثم حاول مجدداً.");
        }
      } },
    ]);
  };

  const orderStatusLabel: Record<string, string> = {
    pending: "جديد",
    confirmed: "تم التأكيد",
    out_for_delivery: "قيد التوصيل",
    delivered: "تم التسليم",
    cancelled: "ملغى",
  };
  const nextOrderStatus: Record<string, "confirmed" | "out_for_delivery" | "delivered"> = {
    pending: "confirmed",
    confirmed: "out_for_delivery",
    out_for_delivery: "delivered",
  };

  const advanceOrder = async (id: number, status: string) => {
    const next = nextOrderStatus[status];
    if (!next) return;
    try {
      await updateOrderStatus.mutateAsync({ id, status: next });
      await ordersQuery.refetch();
    } catch {
      Alert.alert("تعذر تحديث الطلب", "تحقق من اتصال الإنترنت ثم حاول مجدداً.");
    }
  };

  const saveWhatsappPhone = async () => {
    const normalized = whatsappPhone.replace(/\D/g, "");
    if (normalized && !/^\d{8,15}$/.test(normalized)) {
      Alert.alert("رقم غير صحيح", "اكتب الرقم بصيغة دولية بدون + أو مسافات، مثل 9665XXXXXXXX.");
      return;
    }
    try {
      await updateWhatsapp.mutateAsync({ phone: normalized });
      await whatsappQuery.refetch();
      Alert.alert("تم الحفظ", normalized ? "سيظهر زر واتساب بهذا الرقم بعد كل طلب جديد." : "تم حذف رقم واتساب المتجر.");
    } catch {
      Alert.alert("تعذر الحفظ", "تحقق من الاتصال وحاول مرة أخرى.");
    }
  };

  const whatsappSection = isManager ? (
    <View style={{ marginBottom: 18, borderRadius: 18, backgroundColor: "#EAF6ED", padding: 15 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8 }}><MaterialIcons name="phone" size={19} color="#176B45" /><Text style={{ color: "#176B45", fontSize: 14, fontWeight: "900", textAlign: "right" }}>رقم واتساب استقبال الطلبات</Text></View>
      <Text style={{ marginTop: 6, color: "#437253", fontSize: 11, lineHeight: 17, textAlign: "right" }}>أدخل الرقم مرة واحدة ويمكنك تغييره لاحقاً. سيُفتح واتساب برسالة الطلب جاهزة للإرسال.</Text>
      <View style={{ marginTop: 10, flexDirection: "row", gap: 8 }}><Pressable onPress={() => void saveWhatsappPhone()} style={({ pressed }) => [{ width: 82, minHeight: 46, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: "#176B45" }, pressed && { opacity: 0.8 }]}><Text style={{ color: "#FFFFFF", fontSize: 12, fontWeight: "900" }}>{updateWhatsapp.isPending ? "..." : "حفظ"}</Text></Pressable><TextInput value={whatsappPhone} onChangeText={setWhatsappPhone} placeholder="9665XXXXXXXX" placeholderTextColor="#789383" keyboardType="phone-pad" style={{ flex: 1, minHeight: 46, borderRadius: 12, backgroundColor: "#FFFFFF", color: "#183326", paddingHorizontal: 12, textAlign: "right" }} /></View>
    </View>
  ) : null;

  const ordersSection = isManager ? (
    <View style={{ marginBottom: 18 }}>
      <View style={{ marginBottom: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ color: colors.muted, fontSize: 12 }}>{ordersQuery.data?.length ?? 0} طلبات</Text>
        <Text style={{ color: colors.foreground, fontSize: 18, fontWeight: "900", textAlign: "right" }}>طلبات التوصيل</Text>
      </View>
      {ordersQuery.isLoading ? <ActivityIndicator color="#176B45" /> : ordersQuery.data?.length ? ordersQuery.data.slice(0, 12).map((order) => (
        <Pressable key={order.id} onPress={() => setSelectedOrderId(order.id)} style={({ pressed }) => [{ marginBottom: 8, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: order.status === "pending" ? "#F4C95D" : colors.border, padding: 12 }, pressed && { opacity: 0.78 }]}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}><View style={{ borderRadius: 8, backgroundColor: order.status === "pending" ? "#FFF4D6" : "#EAF6ED", paddingHorizontal: 8, paddingVertical: 4 }}><Text style={{ color: order.status === "pending" ? "#8C6B1D" : "#176B45", fontSize: 10, fontWeight: "800" }}>{orderStatusLabel[order.status] ?? order.status}</Text></View><Text style={{ color: colors.foreground, fontSize: 14, fontWeight: "900" }}>طلب #{order.id}</Text></View>
          <Text style={{ marginTop: 7, color: colors.muted, fontSize: 12, textAlign: "right" }}>هاتف: {order.customerPhone}</Text>
          <Text numberOfLines={2} style={{ marginTop: 4, color: colors.muted, fontSize: 12, textAlign: "right" }}>العنوان: {order.deliveryAddress}</Text>
          <View style={{ marginTop: 8, borderRadius: 11, backgroundColor: colors.background, padding: 9 }}>
            <Text style={{ marginBottom: 4, color: colors.foreground, fontSize: 11, fontWeight: "800", textAlign: "right" }}>المواد المطلوبة</Text>
            {order.items?.length ? order.items.map((item) => <Text key={item.id} numberOfLines={1} style={{ marginTop: 2, color: colors.muted, fontSize: 11, textAlign: "right" }}>{item.quantity} × {item.productName}</Text>) : <Text style={{ color: colors.muted, fontSize: 11, textAlign: "right" }}>اضغط للتفاصيل</Text>}
          </View>
          <View style={{ marginTop: 8, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}><Text style={{ color: "#176B45", fontSize: 15, fontWeight: "900" }}>{formatPrice(order.total)}</Text><Text style={{ color: colors.muted, fontSize: 10 }}>نقداً عند الاستلام · اضغط للتفاصيل</Text></View>
          {nextOrderStatus[order.status] && <Pressable onPress={() => void advanceOrder(order.id, order.status)} style={({ pressed }) => [{ marginTop: 9, minHeight: 36, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: "#176B45" }, pressed && { opacity: 0.8 }]}><Text style={{ color: "#FFFFFF", fontSize: 11, fontWeight: "800" }}>{order.status === "pending" ? "تأكيد الطلب" : order.status === "confirmed" ? "تسليمه للمندوب" : "تأكيد التسليم"}</Text></Pressable>}
        </Pressable>
      )) : <View style={{ alignItems: "center", borderRadius: 16, backgroundColor: colors.surface, padding: 18 }}><MaterialIcons name="receipt-long" size={30} color={colors.muted} /><Text style={{ marginTop: 8, color: colors.muted, fontSize: 12 }}>لا توجد طلبات جديدة</Text></View>}
    </View>
  ) : null;

  const managerCard = useMemo(() => {
    if (authLoading || isManager) return null;
    return (
      <View style={{ marginBottom: 16, borderRadius: 18, backgroundColor: "#FFF4D6", padding: 15 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8 }}><MaterialIcons name="lock-outline" size={18} color="#9A7418" /><Text style={{ color: "#785B15", fontSize: 13, fontWeight: "800", textAlign: "right" }}>وضع العرض فقط</Text></View>
        <Text style={{ marginTop: 7, color: "#8C7435", fontSize: 11, lineHeight: 17, textAlign: "right" }}>سجّل الدخول بحساب المدير لتعديل الأسعار أو إضافة منتجات.</Text>
        <Pressable onPress={() => void requestManagerAccess()} style={({ pressed }) => [{ marginTop: 12, minHeight: 42, alignItems: "center", justifyContent: "center", borderRadius: 12, backgroundColor: "#176B45" }, pressed && { opacity: 0.8 }]}><Text style={{ color: "#FFFFFF", fontSize: 13, fontWeight: "800" }}>تسجيل دخول المدير</Text></Pressable>
      </View>
    );
  }, [authLoading, isManager, requestManagerAccess]);

  const renderProduct = ({ item }: { item: Product }) => (
    <View style={{ marginBottom: 10, flexDirection: "row", alignItems: "center", borderRadius: 18, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, padding: 12 }}>
      <View style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "flex-end" }}>
        <View style={{ marginRight: 10, flex: 1 }}>
          <Text numberOfLines={1} style={{ color: colors.foreground, fontSize: 15, fontWeight: "800", textAlign: "right" }}>{item.name}</Text>
          <Text style={{ marginTop: 4, color: colors.muted, fontSize: 12, textAlign: "right" }}>{item.category} · {item.unit}</Text>
          <View style={{ marginTop: 7, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
            <Text style={{ color: "#176B45", fontSize: 14, fontWeight: "900" }}>{formatPrice(item.price)}</Text>
            <View style={{ borderRadius: 7, backgroundColor: item.inStock ? "#E8F4EA" : "#FDECEC", paddingHorizontal: 7, paddingVertical: 3 }}><Text style={{ color: item.inStock ? "#176B45" : "#C24141", fontSize: 10, fontWeight: "700" }}>{item.inStock ? "متوفر" : "غير متوفر"}</Text></View>
          </View>
          {item.barcode && <Text style={{ marginTop: 5, color: colors.muted, fontSize: 10, textAlign: "right" }}>باركود: {item.barcode}</Text>}
        </View>
        <View style={{ width: 52, height: 52, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "#F2F7F1" }}><Text style={{ fontSize: 28 }}>{item.emoji}</Text></View>
      </View>
      {isManager && <View style={{ marginLeft: 8, alignItems: "center", gap: 5 }}>
        <Pressable onPress={() => void openEdit(item)} style={({ pressed }) => [{ width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "#EEF5F0" }, pressed && { opacity: 0.65 }]}><MaterialIcons name="edit" size={17} color="#176B45" /></Pressable>
        <Pressable onPress={() => removeProduct(item)} style={({ pressed }) => [{ width: 34, height: 34, borderRadius: 10, alignItems: "center", justifyContent: "center", backgroundColor: "#FFF0F0" }, pressed && { opacity: 0.65 }]}><MaterialIcons name="delete-outline" size={17} color="#C24141" /></Pressable>
      </View>}
    </View>
  );

  return (
    <ScreenContainer className="px-4" containerClassName="bg-background">
      <FlatList
        data={products}
        keyExtractor={(item) => item.id}
        renderItem={renderProduct}
        contentContainerStyle={{ paddingTop: 16, paddingBottom: 30 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await refreshProducts(); setRefreshing(false); }} tintColor="#176B45" colors={["#176B45"]} />}
        ListHeaderComponent={
          <View>
            <View style={{ marginBottom: 18, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View style={{ flex: 1, paddingLeft: 12 }}><Text style={{ color: colors.muted, fontSize: 13, textAlign: "right" }}>لوحة التحكم</Text><Text style={{ marginTop: 3, color: colors.foreground, fontSize: 26, fontWeight: "900", textAlign: "right" }}>إدارة المنتجات</Text></View>
              <View style={{ width: 52, height: 52, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "#F4C95D" }}><MaterialIcons name="inventory" size={26} color="#59451A" /></View>
            </View>
            {!CUSTOMER_MODE && managerCard}
            <View style={{ marginBottom: 18, borderRadius: 20, backgroundColor: isCloudConnected ? "#EAF6ED" : "#FFF8E7", padding: 15 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8 }}><MaterialIcons name={isCloudConnected ? "cloud-done" : "cloud-off"} size={18} color={isCloudConnected ? "#176B45" : "#A77A12"} /><Text style={{ color: isCloudConnected ? "#176B45" : "#785B15", fontSize: 12, fontWeight: "700", textAlign: "right" }}>{isCloudConnected ? "متصل بالسحابة · تحديث كل 15 ثانية" : "نسخة محلية مؤقتة · بانتظار الاتصال"}</Text></View>
              <Text style={{ marginTop: 7, color: isCloudConnected ? "#437253" : "#8C7435", fontSize: 11, lineHeight: 17, textAlign: "right" }}>التعديلات المحفوظة من المدير تظهر تلقائياً لجميع المستخدمين.</Text>
            </View>
            {whatsappSection}
            {ordersSection}
            {isManager && <Pressable onPress={() => void openAdd()} style={({ pressed }) => [{ marginBottom: 10, minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 16, backgroundColor: "#176B45" }, pressed && { opacity: 0.86, transform: [{ scale: 0.98 }] }]}><MaterialIcons name="add" size={22} color="#FFFFFF" /><Text style={{ color: "#FFFFFF", fontSize: 15, fontWeight: "800" }}>إضافة منتج جديد</Text></Pressable>}
            {isManager && <Pressable onPress={() => void openScanner()} style={({ pressed }) => [{ marginBottom: 18, minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, borderRadius: 16, backgroundColor: "#EEF5F0", borderWidth: 1, borderColor: "#CFE5D5" }, pressed && { opacity: 0.78 }]}><MaterialIcons name="qr-code-scanner" size={20} color="#176B45" /><Text style={{ color: "#176B45", fontSize: 14, fontWeight: "800" }}>مسح باركود للعثور على منتج</Text></Pressable>}
            <View style={{ marginBottom: 10, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}><Text style={{ color: colors.muted, fontSize: 12 }}>{products.length} منتجات</Text><Text style={{ color: colors.foreground, fontSize: 18, fontWeight: "900", textAlign: "right" }}>قائمة المنتجات</Text></View>
          </View>
        }
        ListEmptyComponent={<View style={{ alignItems: "center", paddingVertical: 40 }}><MaterialIcons name="inventory-2" size={42} color={colors.muted} /><Text style={{ marginTop: 10, color: colors.muted }}>لم تضف أي منتجات بعد</Text></View>}
      />

      {isManager && <Modal visible={modalVisible} transparent animationType="slide" onRequestClose={closeModal}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(13, 36, 24, 0.35)" }}>
          <View style={{ maxHeight: "90%", borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: colors.background, padding: 20 }}>
            <View style={{ marginBottom: 18, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}><Pressable onPress={closeModal} style={({ pressed }) => [{ width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface }, pressed && { opacity: 0.65 }]}><MaterialIcons name="close" size={20} color={colors.foreground} /></Pressable><Text style={{ color: colors.foreground, fontSize: 20, fontWeight: "900" }}>{editing ? "تعديل المنتج" : "إضافة منتج"}</Text></View>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={{ marginBottom: 7, color: colors.foreground, fontSize: 13, fontWeight: "700", textAlign: "right" }}>اسم المنتج</Text>
              <TextInput value={form.name} onChangeText={(name) => setForm((prev) => ({ ...prev, name }))} placeholder="مثال: سكر أبيض" placeholderTextColor={colors.muted} style={{ marginBottom: 14, minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: colors.border, color: colors.foreground, paddingHorizontal: 14, textAlign: "right" }} returnKeyType="next" />
              <View style={{ flexDirection: "row", gap: 10 }}><View style={{ flex: 1 }}><Text style={{ marginBottom: 7, color: colors.foreground, fontSize: 13, fontWeight: "700", textAlign: "right" }}>السعر (ر.س)</Text><TextInput value={form.price} onChangeText={(price) => setForm((prev) => ({ ...prev, price }))} placeholder="0.00" placeholderTextColor={colors.muted} keyboardType="decimal-pad" style={{ minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: colors.border, color: colors.foreground, paddingHorizontal: 14, textAlign: "right" }} /></View><View style={{ flex: 1 }}><Text style={{ marginBottom: 7, color: colors.foreground, fontSize: 13, fontWeight: "700", textAlign: "right" }}>الوحدة</Text><TextInput value={form.unit} onChangeText={(unit) => setForm((prev) => ({ ...prev, unit }))} placeholder="قطعة" placeholderTextColor={colors.muted} style={{ minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: colors.border, color: colors.foreground, paddingHorizontal: 14, textAlign: "right" }} /></View></View>
              <View style={{ marginTop: 14, flexDirection: "row", gap: 10 }}><View style={{ flex: 1 }}><Text style={{ marginBottom: 7, color: colors.foreground, fontSize: 13, fontWeight: "700", textAlign: "right" }}>التصنيف</Text><TextInput value={form.category} onChangeText={(category) => setForm((prev) => ({ ...prev, category }))} placeholder="مؤن" placeholderTextColor={colors.muted} style={{ minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: colors.border, color: colors.foreground, paddingHorizontal: 14, textAlign: "right" }} /></View><View style={{ width: 88 }}><Text style={{ marginBottom: 7, color: colors.foreground, fontSize: 13, fontWeight: "700", textAlign: "right" }}>رمز</Text><TextInput value={form.emoji} onChangeText={(emoji) => setForm((prev) => ({ ...prev, emoji }))} placeholder="🛒" placeholderTextColor={colors.muted} style={{ minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: colors.border, color: colors.foreground, paddingHorizontal: 10, textAlign: "center", fontSize: 20 }} /></View></View>
              <Text style={{ marginTop: 14, marginBottom: 7, color: colors.foreground, fontSize: 13, fontWeight: "700", textAlign: "right" }}>الباركود</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><Pressable onPress={() => void openScanner()} style={({ pressed }) => [{ width: 50, height: 48, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "#176B45" }, pressed && { opacity: 0.8 }]}><MaterialIcons name="qr-code-scanner" size={22} color="#FFFFFF" /></Pressable><TextInput value={form.barcode} onChangeText={(barcode) => setForm((prev) => ({ ...prev, barcode }))} placeholder="امسح أو اكتب رقم الباركود" placeholderTextColor={colors.muted} keyboardType="number-pad" style={{ flex: 1, minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: colors.border, color: colors.foreground, paddingHorizontal: 14, textAlign: "right" }} /></View>
              {editing && <View style={{ marginTop: 16, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8 }}><Switch value={editing.inStock} onValueChange={() => void toggleStock(editing)} trackColor={{ false: "#D1D5DB", true: "#A9D5B7" }} thumbColor={editing.inStock ? "#176B45" : "#F4F4F5"} /><Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "700" }}>المنتج متوفر حالياً</Text></View>}
              <Pressable onPress={() => void handleSave()} disabled={createProduct.isPending || updateProduct.isPending} style={({ pressed }) => [{ marginTop: 22, minHeight: 52, alignItems: "center", justifyContent: "center", borderRadius: 16, backgroundColor: "#176B45", opacity: createProduct.isPending || updateProduct.isPending ? 0.6 : 1 }, pressed && { transform: [{ scale: 0.98 }] }]}><Text style={{ color: "#FFFFFF", fontSize: 15, fontWeight: "800" }}>{createProduct.isPending || updateProduct.isPending ? "جاري الحفظ…" : editing ? "حفظ التعديلات" : "إضافة المنتج"}</Text></Pressable>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>}

      {isManager && <Modal visible={selectedOrderId !== null} transparent animationType="slide" onRequestClose={() => setSelectedOrderId(null)}><View style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(13,36,24,0.35)" }}><View style={{ maxHeight: "86%", borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: colors.background, padding: 20 }}><View style={{ marginBottom: 16, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}><Pressable onPress={() => setSelectedOrderId(null)} style={({ pressed }) => [{ width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface }, pressed && { opacity: 0.65 }]}><MaterialIcons name="close" size={20} color={colors.foreground} /></Pressable><Text style={{ color: colors.foreground, fontSize: 20, fontWeight: "900" }}>تفاصيل الطلب #{selectedOrderId ?? ""}</Text></View>{(() => { const order = ordersQuery.data?.find((item) => item.id === selectedOrderId); return order ? <ScrollView showsVerticalScrollIndicator={false}><View style={{ marginBottom: 14, borderRadius: 16, backgroundColor: "#EAF6ED", padding: 14 }}><Text style={{ color: "#176B45", fontSize: 13, fontWeight: "800", textAlign: "right" }}>الدفع نقداً عند الاستلام · {orderStatusLabel[order.status]}</Text><Text style={{ marginTop: 7, color: colors.foreground, fontSize: 13, textAlign: "right" }}>رقم التواصل: {order.customerPhone}</Text><Text style={{ marginTop: 5, color: colors.foreground, fontSize: 13, lineHeight: 19, textAlign: "right" }}>العنوان: {order.deliveryAddress}</Text>{order.locationNote && <Text style={{ marginTop: 5, color: colors.muted, fontSize: 12, lineHeight: 18, textAlign: "right" }}>ملاحظة الموقع: {order.locationNote}</Text>}<Text style={{ marginTop: 8, color: "#176B45", fontSize: 16, fontWeight: "900", textAlign: "right" }}>الإجمالي: {formatPrice(order.total)}</Text></View><Text style={{ marginBottom: 8, color: colors.foreground, fontSize: 15, fontWeight: "900", textAlign: "right" }}>المواد المطلوبة</Text>{orderItemsQuery.isLoading ? <ActivityIndicator color="#176B45" /> : orderItemsQuery.data?.map((item) => <View key={item.id} style={{ marginBottom: 7, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderRadius: 12, backgroundColor: colors.surface, padding: 11 }}><Text style={{ color: "#176B45", fontSize: 13, fontWeight: "800" }}>{item.quantity} × {formatPrice(item.unitPrice)}</Text><Text style={{ color: colors.foreground, fontSize: 13, fontWeight: "700", textAlign: "right" }}>{item.productName} ({item.unit})</Text></View>)}</ScrollView> : <Text style={{ color: colors.muted, textAlign: "center" }}>تعذر تحميل تفاصيل الطلب</Text>; })()}</View></View></Modal>}

      <Modal visible={scannerVisible} animationType="slide" onRequestClose={closeScanner}><View style={{ flex: 1, backgroundColor: "#07130D" }}><CameraView style={{ flex: 1 }} facing="back" barcodeScannerSettings={{ barcodeTypes: ["ean13", "ean8", "upc_a", "upc_e", "code128", "code39", "qr"] }} onBarcodeScanned={scanned ? undefined : handleBarcodeScanned}><View style={{ flex: 1, justifyContent: "space-between", padding: 24, paddingTop: 58 }}><View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}><Pressable onPress={closeScanner} style={({ pressed }) => [{ width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.55)" }, pressed && { opacity: 0.7 }]}><MaterialIcons name="close" size={24} color="#FFFFFF" /></Pressable><Text style={{ color: "#FFFFFF", fontSize: 20, fontWeight: "900" }}>مسح الباركود</Text></View><View style={{ alignItems: "center" }}><View style={{ width: 285, height: 170, borderRadius: 22, borderWidth: 3, borderColor: "#F4C95D" }} /><View style={{ marginTop: 18, borderRadius: 14, backgroundColor: "rgba(0,0,0,0.58)", paddingHorizontal: 16, paddingVertical: 10 }}><Text style={{ color: "#FFFFFF", fontSize: 13, textAlign: "center" }}>وجّه الكاميرا إلى الباركود داخل الإطار</Text></View></View><View style={{ alignItems: "center", paddingBottom: 14 }}><Text style={{ color: "#D5E6DA", fontSize: 12, textAlign: "center" }}>سيتم فتح المنتج الموجود أو تجهيز منتج جديد</Text></View></View></CameraView></View></Modal>
    </ScreenContainer>
  );
}
