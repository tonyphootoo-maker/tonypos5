import {
  AppEntryMode,
  CategoryDoc,
  DishDoc,
  IngredientDoc,
  OnlineOrderDoc,
  OnlineOrderItem,
  OnlineOrderMode,
  OptionGroupDoc,
  PackagingDoc,
  PublicCategory,
  PublicDish,
  PublicOptionGroup,
  PublicStoreDoc,
  SettingsDoc,
  SubRecipeDoc,
} from '../types';
import { DailySalesRecord } from '../costing/types/domain';
import { MenuItem as CostMenuItem } from '../costing/types';
import { resolveCostVariantDisplayNames } from '../costing/services/spreadsheetCostHelper';
import { resolveBilingualDescriptionFields } from '../utils/thaiToEnglish';
import {
  calculateDishVariantCost,
  calculateIngredientEffectiveCost,
  getOptionChoiceEffectiveQuantity,
  isOptionChoiceQuantityEnabled,
  roundTo2,
} from './calculations';

export type OnlinePeriodFilter = 'today' | 'week' | 'month' | 'year' | 'all';

export const ONLINE_CHANNEL_PICKUP_ID = 'web_pickup';
export const ONLINE_CHANNEL_DELIVERY_ID = 'web_delivery';

export const ONLINE_CHANNEL_NAMES: Record<string, string> = {
  [ONLINE_CHANNEL_PICKUP_ID]: 'สั่งออนไลน์ (รับที่ร้าน)',
  [ONLINE_CHANNEL_DELIVERY_ID]: 'สั่งออนไลน์ (เดลิเวอรีร้าน)',
};

/**
 * Resolve role-based app entry mode from URL search params or path:
 * - ?mode=order or /order -> 'customer'
 * - ?mode=rider or /rider -> 'rider'
 * - Default -> 'owner'
 */
export function resolveAppMode(search: string = '', pathname: string = ''): AppEntryMode {
  try {
    const params = new URLSearchParams(search || '');
    const modeParam = (params.get('mode') || '').trim().toLowerCase();
    if (modeParam === 'order' || modeParam === 'customer') return 'customer';
    if (modeParam === 'rider') return 'rider';
  } catch {
    // Ignore malformed query strings
  }

  const normalizedPath = (pathname || '').trim().toLowerCase().replace(/\/+$/, '');
  if (normalizedPath === '/order' || normalizedPath.endsWith('/order')) {
    return 'customer';
  }
  if (normalizedPath === '/rider' || normalizedPath.endsWith('/rider')) {
    return 'rider';
  }
  return 'owner';
}

/**
 * Strict Zero-Cost-Leak sanitizer: transforms private Owner menu & recipe documents
 * into a lean PublicStoreDoc without any ingredients, subRecipes, packaging, or cost fields.
 */
export function sanitizeMenuForPublicStore(params: {
  storeId: string;
  settings: SettingsDoc;
  categories: CategoryDoc[];
  dishes: DishDoc[];
  optionGroups: OptionGroupDoc[];
  costMenus?: CostMenuItem[];
  publishedAt?: string;
}): {
  publicStore: PublicStoreDoc;
  referencedImageIds: string[];
} {
  const {
    storeId,
    settings,
    categories,
    dishes,
    optionGroups,
    costMenus = [],
    publishedAt = new Date().toISOString(),
  } = params;

  const sortedCategories = [...categories].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id)
  );
  const categoryRankMap = new Map<string, number>();
  sortedCategories.forEach((c, idx) => categoryRankMap.set(c.id, idx));

  const publicCategories: PublicCategory[] = sortedCategories.map((c) => ({
    id: c.id,
    name: c.name || '',
    ...(c.nameTh ? { nameTh: c.nameTh } : {}),
    order: c.order ?? 0,
  }));

  const publicOptionGroups: PublicOptionGroup[] = [...optionGroups]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id))
    .map((g) => ({
      id: g.id,
      name: g.name || '',
      ...(g.nameTh ? { nameTh: g.nameTh } : {}),
      minSelect: Math.max(0, Number(g.minSelect) || 0),
      maxSelect: Math.max(1, Number(g.maxSelect) || 1),
      order: g.order ?? 0,
      choices: (g.choices || []).map((ch) => {
        const usesQty = isOptionChoiceQuantityEnabled(ch);
        const effQty = getOptionChoiceEffectiveQuantity(ch);
        return {
          id: ch.id,
          name: ch.name || '',
          ...(ch.nameTh ? { nameTh: ch.nameTh } : {}),
          price: Math.max(0, Number(ch.price) || 0),
          ...(usesQty ? { hasQuantity: true } : {}),
          ...(usesQty && effQty > 1 ? { quantity: effQty } : {}),
        };
      }),
    }));

  const imageIdSet = new Set<string>();
  if (settings.qrImageId) {
    imageIdSet.add(settings.qrImageId);
  }

  const publicDishes: PublicDish[] = [...dishes]
    .sort((a, b) => {
      const catRankA = categoryRankMap.get(a.categoryId) ?? 999999;
      const catRankB = categoryRankMap.get(b.categoryId) ?? 999999;
      if (catRankA !== catRankB) return catRankA - catRankB;
      return (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id);
    })
    .map((d) => {
      if (d.imageId) {
        imageIdSet.add(d.imageId);
      }
      const resolvedDesc = resolveBilingualDescriptionFields(d.description, d.descriptionTh);
      return {
        id: d.id,
        name: d.name || '',
        ...(d.nameTh ? { nameTh: d.nameTh } : {}),
        categoryId: d.categoryId || '',
        ...(d.imageId ? { imageId: d.imageId } : {}),
        ...(resolvedDesc.description ? { description: resolvedDesc.description } : {}),
        ...(resolvedDesc.descriptionTh ? { descriptionTh: resolvedDesc.descriptionTh } : {}),
        order: d.order ?? 0,
        optionGroupIds: Array.isArray(d.optionGroupIds) ? [...d.optionGroupIds] : [],
        variants: (d.variants || []).map((v) => {
          const resolved = resolveCostVariantDisplayNames(d, v, costMenus);
          return {
            id: v.id,
            name: resolved.name || v.name || 'Standard',
            ...(resolved.nameTh ? { nameTh: resolved.nameTh } : v.nameTh ? { nameTh: v.nameTh } : {}),
            price: Math.max(0, Number(v.price) || 0),
          };
        }),
      };
    });

  const publicStore: PublicStoreDoc = {
    id: storeId,
    storeId,
    shopName: settings.shopName || "Tony's Kit Restaurant",
    ...(settings.shopAddress ? { shopAddress: settings.shopAddress } : {}),
    ...(settings.shopPhone ? { shopPhone: settings.shopPhone } : {}),
    ...(settings.qrImageId ? { qrImageId: settings.qrImageId } : {}),
    onlineOrderingEnabled: settings.onlineOrderingEnabled !== false,
    onlineDeliveryFee: Math.max(0, Number(settings.onlineDeliveryFee ?? 0) || 0),
    onlinePickupEnabled: settings.onlinePickupEnabled !== false,
    onlineDeliveryEnabled: settings.onlineDeliveryEnabled !== false,
    onlineEstimatedPrepMinutes: Math.max(5, Number(settings.onlineEstimatedPrepMinutes ?? 20) || 20),
    pricesIncludeVat: Boolean(settings.pricesIncludeVat),
    vatPercent: Number(settings.vatPercent ?? 7) || 0,
    categories: publicCategories,
    dishes: publicDishes,
    optionGroups: publicOptionGroups,
    publishedAt,
  };

  return {
    publicStore,
    referencedImageIds: Array.from(imageIdSet),
  };
}

/**
 * Safely convert ISO string, epoch ms, Date, or Firestore Timestamp-like objects into a Date.
 */
export function toDateSafe(input: unknown): Date | null {
  if (!input) return null;
  if (input instanceof Date) {
    return isNaN(input.getTime()) ? null : input;
  }
  if (typeof input === 'number') {
    const d = new Date(input);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof input === 'string') {
    const d = new Date(input);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof input === 'object') {
    const maybeTs = input as { toDate?: () => Date; seconds?: number; nanoseconds?: number };
    if (typeof maybeTs.toDate === 'function') {
      const d = maybeTs.toDate();
      return isNaN(d.getTime()) ? null : d;
    }
    if (typeof maybeTs.seconds === 'number') {
      const d = new Date(maybeTs.seconds * 1000 + Math.floor((maybeTs.nanoseconds || 0) / 1e6));
      return isNaN(d.getTime()) ? null : d;
    }
  }
  return null;
}

/**
 * Extracts calendar date and 24h time components strictly in Asia/Bangkok timezone (UTC+7).
 */
export function getBangkokDateParts(input: unknown): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  dateStr: string;
} {
  const date = toDateSafe(input) || new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(date);
  const map: Record<string, string> = {};
  for (const part of parts) {
    map[part.type] = part.value;
  }

  const year = Number(map.year) || 2026;
  const month = Number(map.month) || 1;
  const day = Number(map.day) || 1;
  const rawHour = Number(map.hour) || 0;
  const hour = rawHour === 24 ? 0 : rawHour;
  const minute = Number(map.minute) || 0;
  const dateStr = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  return { year, month, day, hour, minute, dateStr };
}

function shiftIsoDateDays(dateStr: string, deltaDays: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const utc = Date.UTC(y, (m || 1) - 1, d || 1);
  const shifted = new Date(utc + deltaDays * 86400000);
  const sy = shifted.getUTCFullYear();
  const sm = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const sd = String(shifted.getUTCDate()).padStart(2, '0');
  return `${sy}-${sm}-${sd}`;
}

/**
 * Computes restaurant business workDate (YYYY-MM-DD) in Asia/Bangkok timezone respecting dailyClosingTime.
 * Example: 2026-11-18T01:30+07:00 with closingTime "04:00" belongs to workDate "2026-11-17".
 */
export function getBangkokBusinessWorkDate(
  input: unknown,
  dailyClosingTime: string = '04:00'
): string {
  const bkk = getBangkokDateParts(input);
  const [closeHStr, closeMStr] = (dailyClosingTime || '04:00').split(':');
  const closeHour = parseInt(closeHStr, 10) || 0;
  const closeMinute = parseInt(closeMStr, 10) || 0;

  const currentMins = bkk.hour * 60 + bkk.minute;
  const closeMins = closeHour * 60 + closeMinute;

  if (closeMins > 0 && currentMins < closeMins) {
    return shiftIsoDateDays(bkk.dateStr, -1);
  }
  return bkk.dateStr;
}

/**
 * Checks whether an online order timestamp falls within the Thailand local period filter.
 * Uses calendar week starting Monday -> Sunday in Asia/Bangkok.
 */
export function isOnlineOrderInLocalPeriod(
  timestampInput: unknown,
  period: OnlinePeriodFilter,
  referenceNow: Date = new Date()
): boolean {
  if (period === 'all') return true;
  const parsed = toDateSafe(timestampInput);
  if (!parsed) return false;

  const orderBkk = getBangkokDateParts(parsed);
  const nowBkk = getBangkokDateParts(referenceNow);

  if (period === 'today') {
    return orderBkk.dateStr === nowBkk.dateStr;
  }
  if (period === 'month') {
    return orderBkk.dateStr.slice(0, 7) === nowBkk.dateStr.slice(0, 7);
  }
  if (period === 'year') {
    return orderBkk.dateStr.slice(0, 4) === nowBkk.dateStr.slice(0, 4);
  }
  if (period === 'week') {
    const [y, m, d] = nowBkk.dateStr.split('-').map(Number);
    const utcDay = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
    const mondayOffset = utcDay === 0 ? -6 : 1 - utcDay;
    const weekStart = shiftIsoDateDays(nowBkk.dateStr, mondayOffset);
    const weekEnd = shiftIsoDateDays(weekStart, 6);
    return orderBkk.dateStr >= weekStart && orderBkk.dateStr <= weekEnd;
  }
  return true;
}

export function getOnlineOrderChannelInfo(orderMode: OnlineOrderMode): {
  channelId: string;
  channelName: string;
} {
  if (orderMode === 'delivery') {
    return {
      channelId: ONLINE_CHANNEL_DELIVERY_ID,
      channelName: ONLINE_CHANNEL_NAMES[ONLINE_CHANNEL_DELIVERY_ID],
    };
  }
  return {
    channelId: ONLINE_CHANNEL_PICKUP_ID,
    channelName: ONLINE_CHANNEL_NAMES[ONLINE_CHANNEL_PICKUP_ID],
  };
}

/**
 * Calculates real foodCost & packagingCost for an online order's items using Owner recipe/ingredient tables.
 * Because both pickup & delivery leave the premises, variant packaging costs apply.
 */
export function calculateOnlineOrderCostSnapshot(params: {
  items: OnlineOrderItem[];
  dishesMap: Map<string, DishDoc>;
  optionGroupsMap: Map<string, OptionGroupDoc>;
  ingredientsMap: Map<string, IngredientDoc>;
  subRecipesMap: Map<string, SubRecipeDoc>;
  packagingMap: Map<string, PackagingDoc>;
}): { foodCost: number; packagingCost: number } {
  const { items, dishesMap, optionGroupsMap, ingredientsMap, subRecipesMap, packagingMap } = params;
  let totalFoodCost = 0;
  let totalPackagingCost = 0;

  for (const item of items || []) {
    const qty = Math.max(0, Number(item.quantity) || 0);
    if (qty === 0) continue;

    const dish = dishesMap.get(item.dishId);
    const variant =
      dish?.variants?.find((v) => v.id === item.variantId) || dish?.variants?.[0];

    let unitFoodCost = 0;
    let unitPackagingCost = 0;

    if (variant) {
      const calc = calculateDishVariantCost(
        variant,
        ingredientsMap,
        subRecipesMap,
        packagingMap
      );
      unitFoodCost += calc.foodCost;
      unitPackagingCost += calc.packagingCost;
    }

    for (const opt of item.options || []) {
      const group = optionGroupsMap.get(opt.groupId);
      const choice = group?.choices?.find((c) => c.id === opt.choiceId);
      if (choice && Array.isArray(choice.ingredients)) {
        const choiceQty =
          typeof opt.quantity === 'number' && opt.quantity > 0
            ? Math.max(1, Math.round(opt.quantity))
            : getOptionChoiceEffectiveQuantity(choice);
        for (const ingLine of choice.ingredients) {
          const ing = ingredientsMap.get(ingLine.ingredientId);
          if (ing) {
            unitFoodCost += ingLine.quantity * calculateIngredientEffectiveCost(ing) * choiceQty;
          }
        }
      }
    }

    totalFoodCost += unitFoodCost * qty;
    totalPackagingCost += unitPackagingCost * qty;
  }

  return {
    foodCost: roundTo2(totalFoodCost),
    packagingCost: roundTo2(totalPackagingCost),
  };
}

/**
 * Converts completed OnlineOrderDoc[] into idempotent DailySalesRecord entries keyed by
 * `web_sync_${workDate}_${channelId}` (never starting with `pos_sync_`).
 *
 * Key P&L guarantees:
 * - Only status === 'completed' orders are included (pending/accepted/preparing/out_for_delivery/cancelled are ignored).
 * - Delivery fee is tracked separately in `deliveryFeeTotal` and NEVER inflates food `netSales`/`grossSales`,
 *   preventing GP% and Food Cost % distortion.
 * - Ex-VAT conversion applies when `pricesIncludeVat` is enabled.
 */
export function buildWebSyncDailySalesRecords(
  orders: OnlineOrderDoc[],
  context: {
    dailyClosingTime: string;
    pricesIncludeVat?: boolean;
    vatPercent?: number;
    dishes?: DishDoc[];
    optionGroups?: OptionGroupDoc[];
    ingredients?: IngredientDoc[];
    subRecipes?: SubRecipeDoc[];
    packaging?: PackagingDoc[];
  }
): Record<string, DailySalesRecord> {
  const dishesMap = new Map((context.dishes || []).map((d) => [d.id, d]));
  const optionGroupsMap = new Map((context.optionGroups || []).map((g) => [g.id, g]));
  const ingredientsMap = new Map((context.ingredients || []).map((i) => [i.id, i]));
  const subRecipesMap = new Map((context.subRecipes || []).map((s) => [s.id, s]));
  const packagingMap = new Map((context.packaging || []).map((p) => [p.id, p]));

  const vatPct = Number(context.vatPercent ?? 7) || 0;
  const pricesIncludeVat = Boolean(context.pricesIncludeVat);

  const grouped = new Map<
    string,
    {
      date: string;
      channelId: string;
      channelName: string;
      orderCount: number;
      grossSales: number;
      netSales: number;
      foodCost: number;
      packagingCost: number;
      deliveryFeeTotal: number;
      cashSalesTotal: number;
      qrSalesTotal: number;
    }
  >();

  for (const order of orders || []) {
    if (!order || order.status !== 'completed') continue;

    const workDate =
      order.workDate ||
      getBangkokBusinessWorkDate(
        order.completedAt || order.updatedAt || order.createdAt,
        context.dailyClosingTime
      );
    const { channelId, channelName } = getOnlineOrderChannelInfo(order.orderMode);
    const docId = `web_sync_${workDate}_${channelId}`;

    const foodNominal = Math.max(0, Number(order.subtotal) || 0);
    const deliveryFee =
      order.orderMode === 'delivery' ? Math.max(0, Number(order.deliveryFee) || 0) : 0;
    const orderTotal = Math.max(0, Number(order.totalAmount) || foodNominal + deliveryFee);

    const foodNetExVat =
      pricesIncludeVat && vatPct > 0
        ? foodNominal / (1 + vatPct / 100)
        : foodNominal;

    let orderFoodCost =
      typeof order.foodCostSnapshot === 'number' ? order.foodCostSnapshot : undefined;
    let orderPackagingCost =
      typeof order.packagingCostSnapshot === 'number' ? order.packagingCostSnapshot : undefined;

    if (orderFoodCost === undefined || orderPackagingCost === undefined) {
      const snapshot = calculateOnlineOrderCostSnapshot({
        items: order.items || [],
        dishesMap,
        optionGroupsMap,
        ingredientsMap,
        subRecipesMap,
        packagingMap,
      });
      if (orderFoodCost === undefined) orderFoodCost = snapshot.foodCost;
      if (orderPackagingCost === undefined) orderPackagingCost = snapshot.packagingCost;
    }

    const existing = grouped.get(docId) || {
      date: workDate,
      channelId,
      channelName,
      orderCount: 0,
      grossSales: 0,
      netSales: 0,
      foodCost: 0,
      packagingCost: 0,
      deliveryFeeTotal: 0,
      cashSalesTotal: 0,
      qrSalesTotal: 0,
    };

    existing.orderCount += 1;
    existing.grossSales += foodNominal;
    existing.netSales += foodNetExVat;
    existing.foodCost += orderFoodCost;
    existing.packagingCost += orderPackagingCost;
    existing.deliveryFeeTotal += deliveryFee;
    if (order.paymentMethod === 'qr_payment') {
      existing.qrSalesTotal += orderTotal;
    } else {
      existing.cashSalesTotal += orderTotal;
    }

    grouped.set(docId, existing);
  }

  const records: Record<string, DailySalesRecord> = {};
  for (const [docId, g] of grouped.entries()) {
    const netRounded = roundTo2(g.netSales);
    records[docId] = {
      id: docId,
      date: g.date,
      channelId: g.channelId,
      channelName: g.channelName,
      orderCount: g.orderCount,
      grossSales: roundTo2(g.grossSales),
      discounts: 0,
      refunds: 0,
      netSales: netRounded,
      isVatInclusive: pricesIncludeVat,
      vatRatePercent: vatPct,
      platformFees: 0,
      actualPayout: netRounded,
      serviceCharge: 0,
      foodCost: roundTo2(g.foodCost),
      packagingCost: roundTo2(g.packagingCost),
      deliveryFeeTotal: roundTo2(g.deliveryFeeTotal),
      cashSalesTotal: roundTo2(g.cashSalesTotal),
      qrSalesTotal: roundTo2(g.qrSalesTotal),
      source: 'online',
      estimatedAllocation: false,
    };
  }

  return records;
}

export interface LatLngLiteralSimple {
  lat: number;
  lng: number;
}

/**
 * Calculates straight-line geodesic distance in meters between two lat/lng coordinates (Haversine).
 */
export function haversineMeters(a: LatLngLiteralSimple, b: LatLngLiteralSimple): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/**
 * Formats navigation distance cleanly in meters or kilometers for Thai/English Rider UI.
 */
export function formatNavDistance(meters: number, lang: 'th' | 'en' = 'th'): string {
  const safe = Math.max(0, Number(meters) || 0);
  if (safe < 1000) {
    const rounded = Math.round(safe / 10) * 10;
    return lang === 'th' ? `${rounded} ม.` : `${rounded} m`;
  }
  const km = (safe / 1000).toFixed(1);
  return lang === 'th' ? `${km} กม.` : `${km} km`;
}

/**
 * Formats navigation ETA / duration cleanly in minutes / hours for Thai/English Rider UI.
 */
export function formatNavDuration(durationMillis: number, lang: 'th' | 'en' = 'th'): string {
  const totalMinutes = Math.max(1, Math.round((Number(durationMillis) || 0) / 60000));
  if (totalMinutes < 60) {
    return lang === 'th' ? `${totalMinutes} นาที` : `${totalMinutes} min`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (mins === 0) {
    return lang === 'th' ? `${hours} ชม.` : `${hours} hr`;
  }
  return lang === 'th' ? `${hours} ชม. ${mins} นาที` : `${hours} hr ${mins} min`;
}

/**
 * Strips HTML markup from Google Routes step instructions safely for plain-text React rendering.
 */
export function stripHtmlInstructions(html: string): string {
  if (!html) return '';
  return html
    .replace(/<div[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalizes Google Maps LatLng / LatLngLiteral / PlaceLocation shapes into `{ lat, lng }`.
 */
export function extractLatLngLiteral(input: unknown): LatLngLiteralSimple | null {
  if (!input || typeof input !== 'object') return null;
  const obj = input as Record<string, unknown>;

  if (typeof obj.lat === 'number' && typeof obj.lng === 'number') {
    return Number.isFinite(obj.lat) && Number.isFinite(obj.lng)
      ? { lat: obj.lat, lng: obj.lng }
      : null;
  }

  if (typeof obj.lat === 'function' && typeof obj.lng === 'function') {
    const lat = (obj.lat as () => number)();
    const lng = (obj.lng as () => number)();
    return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
  }

  if (typeof obj.latitude === 'number' && typeof obj.longitude === 'number') {
    return Number.isFinite(obj.latitude) && Number.isFinite(obj.longitude)
      ? { lat: obj.latitude, lng: obj.longitude }
      : null;
  }

  if (obj.latLng) {
    return extractLatLngLiteral(obj.latLng);
  }
  if (obj.location) {
    return extractLatLngLiteral(obj.location);
  }
  return null;
}

/**
 * Builds an external Google Maps turn-by-turn directions fallback URL.
 */
export function buildExternalGoogleMapsUrl(
  order: Pick<OnlineOrderDoc, 'deliveryLat' | 'deliveryLng' | 'deliveryAddress'>
): string {
  if (
    typeof order.deliveryLat === 'number' &&
    typeof order.deliveryLng === 'number' &&
    Number.isFinite(order.deliveryLat) &&
    Number.isFinite(order.deliveryLng)
  ) {
    return `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${order.deliveryLat},${order.deliveryLng}`;
  }
  const addr = encodeURIComponent((order.deliveryAddress || '').trim());
  return `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${addr}`;
}

/**
 * Extracts ?store= from URL search string or hash query fragment (safe across LINE/iOS redirects).
 */
export function extractStoreIdFromLocation(search: string = '', hash: string = ''): string | null {
  const candidates: string[] = [];
  if (search) candidates.push(search);
  if (hash) {
    const qIdx = hash.indexOf('?');
    if (qIdx >= 0) {
      candidates.push(hash.slice(qIdx));
    } else if (hash.includes('store=')) {
      candidates.push(hash.startsWith('#') ? hash.slice(1) : hash);
    }
  }

  for (const raw of candidates) {
    try {
      const params = new URLSearchParams(raw);
      const val = params.get('store')?.trim();
      if (val) return val;
    } catch {
      // Ignore malformed query string
    }
  }
  return null;
}

/**
 * Converts a Firestore REST API Value JSON object into a plain JS value.
 */
export function decodeFirestoreRestValue(value: unknown): unknown {
  if (!value || typeof value !== 'object') return value;
  const v = value as Record<string, unknown>;

  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return Boolean(v.booleanValue);
  if ('integerValue' in v) {
    const n = Number(v.integerValue);
    return Number.isFinite(n) ? n : 0;
  }
  if ('doubleValue' in v) {
    const n = Number(v.doubleValue);
    return Number.isFinite(n) ? n : 0;
  }
  if ('stringValue' in v) return String(v.stringValue ?? '');
  if ('timestampValue' in v) return String(v.timestampValue ?? '');
  if ('referenceValue' in v) return String(v.referenceValue ?? '');
  if ('arrayValue' in v) {
    const arrObj = v.arrayValue as { values?: unknown[] } | undefined;
    const list = Array.isArray(arrObj?.values) ? arrObj.values : [];
    return list.map((item) => decodeFirestoreRestValue(item));
  }
  if ('mapValue' in v) {
    const mapObj = v.mapValue as { fields?: Record<string, unknown> } | undefined;
    const fields = mapObj?.fields || {};
    const out: Record<string, unknown> = {};
    for (const [k, rawVal] of Object.entries(fields)) {
      out[k] = decodeFirestoreRestValue(rawVal);
    }
    return out;
  }
  return undefined;
}

/**
 * Converts a Firestore REST API Document response (`{ name, fields }`) into a plain JS document.
 */
export function parseFirestoreRestDocument(rawDoc: unknown): Record<string, unknown> | null {
  if (!rawDoc || typeof rawDoc !== 'object') return null;
  const docObj = rawDoc as { name?: string; fields?: Record<string, unknown> };
  if (!docObj.fields || typeof docObj.fields !== 'object') return null;

  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(docObj.fields)) {
    out[k] = decodeFirestoreRestValue(val);
  }
  if (!out.id && typeof docObj.name === 'string') {
    const parts = docObj.name.split('/');
    const last = parts[parts.length - 1];
    if (last) out.id = last;
  }
  return out;
}
