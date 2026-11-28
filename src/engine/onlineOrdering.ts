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
import { filterPosOwnedCategories } from './posMenuHelpers';

export type OnlinePeriodFilter = 'today' | 'week' | 'month' | 'year' | 'all';
export type OnlineManagerStatusFilter = 'all' | 'active' | 'delivering' | 'completed' | 'cancelled';

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
export function resolveAppMode(
  search: string = '',
  pathname: string = '',
  hash: string = ''
): AppEntryMode {
  try {
    const params = new URLSearchParams(search || '');
    const modeParam = (params.get('mode') || '').trim().toLowerCase();
    if (modeParam === 'order' || modeParam === 'customer') return 'customer';
    if (modeParam === 'rider') return 'rider';
  } catch {
    // Ignore malformed query strings
  }

  if (hash) {
    try {
      const qIdx = hash.indexOf('?');
      const hashQuery = qIdx >= 0 ? hash.slice(qIdx + 1) : hash.replace(/^#\/?/, '');
      const hashParams = new URLSearchParams(hashQuery);
      const hashMode = (hashParams.get('mode') || '').trim().toLowerCase();
      if (hashMode === 'order' || hashMode === 'customer') return 'customer';
      if (hashMode === 'rider') return 'rider';
    } catch {
      // Ignore malformed hash strings
    }
  }

  const normalizedPath = (pathname || '').trim().toLowerCase().replace(/\/+$/, '');
  if (
    normalizedPath === '/order' ||
    normalizedPath.endsWith('/order') ||
    normalizedPath === '/order.html' ||
    normalizedPath.endsWith('/order.html')
  ) {
    return 'customer';
  }
  if (
    normalizedPath === '/rider' ||
    normalizedPath.endsWith('/rider') ||
    normalizedPath === '/rider.html' ||
    normalizedPath.endsWith('/rider.html')
  ) {
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

  const sortedCategories = [...filterPosOwnedCategories(categories)].sort(
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
  if (settings.logoImageId) {
    imageIdSet.add(settings.logoImageId);
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
    ...(settings.logoImageId ? { logoImageId: settings.logoImageId } : {}),
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
 * Builds an external Google Maps turn-by-turn URL with `dir_action=navigate`
 * so mobile Google Maps starts voice/turn-by-turn navigation immediately.
 */
export function buildExternalGoogleMapsUrl(
  order: Pick<OnlineOrderDoc, 'deliveryLat' | 'deliveryLng' | 'deliveryAddress'>,
  origin?: string | null
): string {
  const originTrimmed = (origin || '').trim();
  const originQuery = originTrimmed ? `&origin=${encodeURIComponent(originTrimmed)}` : '';
  if (
    typeof order.deliveryLat === 'number' &&
    typeof order.deliveryLng === 'number' &&
    Number.isFinite(order.deliveryLat) &&
    Number.isFinite(order.deliveryLng)
  ) {
    return `https://www.google.com/maps/dir/?api=1&travelmode=driving&dir_action=navigate${originQuery}&destination=${order.deliveryLat},${order.deliveryLng}`;
  }
  const addr = encodeURIComponent((order.deliveryAddress || '').trim());
  return `https://www.google.com/maps/dir/?api=1&travelmode=driving&dir_action=navigate${originQuery}&destination=${addr}`;
}

/**
 * Builds native Android Google Maps Turn-by-Turn Navigation URI (`google.navigation:q=...&mode=d`)
 * so Android opens Google Maps directly in active GPS driving navigation rather than route preview.
 */
export function buildAndroidGoogleNavigationUri(
  order: Pick<OnlineOrderDoc, 'deliveryLat' | 'deliveryLng' | 'deliveryAddress'>
): string {
  if (
    typeof order.deliveryLat === 'number' &&
    typeof order.deliveryLng === 'number' &&
    Number.isFinite(order.deliveryLat) &&
    Number.isFinite(order.deliveryLng)
  ) {
    return `google.navigation:q=${order.deliveryLat},${order.deliveryLng}&mode=d`;
  }
  const addr = encodeURIComponent((order.deliveryAddress || '').trim());
  return `google.navigation:q=${addr}&mode=d`;
}

/**
 * Launches Google Maps turn-by-turn navigation:
 * - On Android: invokes native `google.navigation:` intent URI so Google Maps starts active
 *   voice/turn-by-turn navigation immediately, with automatic HTTPS fallback if app is absent.
 * - On iOS / Desktop: opens Google Maps navigation URL in external tab/app.
 */
export function launchExternalGoogleMapsNavigation(
  order: Pick<OnlineOrderDoc, 'deliveryLat' | 'deliveryLng' | 'deliveryAddress'>,
  origin?: string | null
): void {
  if (typeof window === 'undefined') return;
  const httpsUrl = buildExternalGoogleMapsUrl(order, origin);
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';

  if (/android/i.test(ua)) {
    const nativeUri = buildAndroidGoogleNavigationUri(order);
    let appOpened = false;
    const markOpened = () => {
      appOpened = true;
    };

    const cleanup = () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisChange);
      }
      window.removeEventListener('pagehide', markOpened);
      window.removeEventListener('blur', markOpened);
    };

    const onVisChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        markOpened();
        cleanup();
      }
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisChange);
    }
    window.addEventListener('pagehide', markOpened, { once: true });
    window.addEventListener('blur', markOpened, { once: true });

    try {
      window.location.href = nativeUri;
    } catch {
      cleanup();
      window.open(httpsUrl, '_blank', 'noopener,noreferrer');
      return;
    }

    window.setTimeout(() => {
      cleanup();
      const stillVisible =
        typeof document === 'undefined' ||
        (document.visibilityState === 'visible' && document.hasFocus());
      if (!appOpened && stillVisible) {
        window.open(httpsUrl, '_blank', 'noopener,noreferrer');
      }
    }, 1250);
    return;
  }

  window.open(httpsUrl, '_blank', 'noopener,noreferrer');
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

export interface OnlineOrderDisplayIds {
  sequenceNumber: number;
  displayNumber: string;
  referenceNumber: string;
  dateKey: string;
}

/**
 * Assigns each online order a deterministic daily queue number (`TK-001`, `TK-002`, ...)
 * and a searchable AD date reference (`DDMMYY-001`, e.g., `261126-001`) based on Asia/Bangkok date.
 */
export function buildOnlineOrderNumberingMap(
  orders: OnlineOrderDoc[]
): Map<string, OnlineOrderDisplayIds> {
  const result = new Map<string, OnlineOrderDisplayIds>();
  if (!Array.isArray(orders) || orders.length === 0) return result;

  const groupedByDate = new Map<
    string,
    Array<{ order: OnlineOrderDoc; ts: number; dd: string; mm: string; yy: string }>
  >();

  for (const order of orders) {
    if (!order?.id) continue;
    const created = toDateSafe(order.createdAt) || new Date();
    const bkk = getBangkokDateParts(created);
    const dd = String(bkk.day).padStart(2, '0');
    const mm = String(bkk.month).padStart(2, '0');
    const yy = String(bkk.year).slice(-2);
    const list = groupedByDate.get(bkk.dateStr) || [];
    list.push({ order, ts: created.getTime(), dd, mm, yy });
    groupedByDate.set(bkk.dateStr, list);
  }

  for (const [dateKey, entries] of groupedByDate.entries()) {
    entries.sort((a, b) => a.ts - b.ts || a.order.id.localeCompare(b.order.id));
    entries.forEach((entry, idx) => {
      const seq = idx + 1;
      const padded = String(seq).padStart(3, '0');
      result.set(entry.order.id, {
        sequenceNumber: seq,
        displayNumber: `TK-${padded}`,
        referenceNumber: `${entry.dd}${entry.mm}${entry.yy}-${padded}`,
        dateKey,
      });
    });
  }

  return result;
}

/**
 * Case-insensitive search across TK sequence number, reference code (DDMMYY-001),
 * raw orderNumber, customer name, phone, and delivery address.
 */
export function matchesOnlineOrderSearch(
  order: OnlineOrderDoc,
  displayIds: OnlineOrderDisplayIds | undefined,
  rawQuery: string
): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;

  const haystacks = [
    displayIds?.displayNumber || '',
    displayIds?.referenceNumber || '',
    order.orderNumber || '',
    order.customerName || '',
    order.customerPhone || '',
    order.deliveryAddress || '',
  ];

  return haystacks.some((val) => val.toLowerCase().includes(q));
}

export const ONLINE_CUSTOMER_CANCEL_WINDOW_MS = 120_000;

export function canCustomerCancelOrder(
  order: Pick<OnlineOrderDoc, 'status' | 'createdAt'>,
  nowMs: number = Date.now()
): { canCancel: boolean; remainingSeconds: number } {
  const eligibleStatus =
    order.status === 'pending' ||
    order.status === 'accepted' ||
    order.status === 'preparing';
  if (!eligibleStatus) {
    return { canCancel: false, remainingSeconds: 0 };
  }

  const createdDate = toDateSafe(order.createdAt);
  const createdMs = createdDate ? createdDate.getTime() : nowMs;
  const elapsedMs = Math.max(0, nowMs - createdMs);
  const remainingMs = Math.max(0, ONLINE_CUSTOMER_CANCEL_WINDOW_MS - elapsedMs);
  const remainingSeconds = Math.ceil(remainingMs / 1000);

  return {
    canCancel: remainingMs > 0,
    remainingSeconds,
  };
}

export function formatCountdownMMSS(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function isOnlineOrderPendingAlert(order: Pick<OnlineOrderDoc, 'status'>): boolean {
  return order.status === 'pending';
}

export function isOnlineOrderInActiveZone(order: Pick<OnlineOrderDoc, 'status'>): boolean {
  return order.status === 'accepted' || order.status === 'preparing';
}

export function isOnlineOrderInRiderZone(
  order: Pick<OnlineOrderDoc, 'status' | 'orderMode'>
): boolean {
  return (
    order.orderMode === 'delivery' &&
    (order.status === 'ready_for_pickup' || order.status === 'out_for_delivery')
  );
}

export function resolveNextReadyActionStatus(
  orderMode: OnlineOrderMode
): 'ready_for_pickup' | 'completed' {
  return orderMode === 'delivery' ? 'ready_for_pickup' : 'completed';
}

/**
 * Matches an online order against the OnlineOrdersManagerPage status filter tabs:
 * - 'active' (กำลังทำ): pending, accepted, preparing (and legacy non-delivery ready_for_pickup)
 * - 'delivering' (กำลังจัดส่ง): delivery orders marked ready_for_pickup (waiting rider) or out_for_delivery
 * - 'completed' (สำเร็จ): completed
 * - 'cancelled' (ยกเลิก): cancelled
 */
export function matchesOnlineManagerStatusFilter(
  order: Pick<OnlineOrderDoc, 'status' | 'orderMode'>,
  filter: OnlineManagerStatusFilter
): boolean {
  if (filter === 'all') return true;
  if (filter === 'completed') return order.status === 'completed';
  if (filter === 'cancelled') return order.status === 'cancelled';
  if (filter === 'delivering') {
    return (
      order.status === 'out_for_delivery' ||
      (order.orderMode === 'delivery' && order.status === 'ready_for_pickup')
    );
  }
  // 'active' (กำลังทำ)
  return (
    order.status === 'pending' ||
    order.status === 'accepted' ||
    order.status === 'preparing' ||
    (order.orderMode !== 'delivery' && order.status === 'ready_for_pickup')
  );
}

/**
 * Returns pending online orders awaiting acceptance, sorted oldest-first (FIFO queue).
 */
export function getPendingOnlineOrders(orders: OnlineOrderDoc[]): OnlineOrderDoc[] {
  if (!Array.isArray(orders) || orders.length === 0) return [];
  return [...orders]
    .filter((o) => o && isOnlineOrderPendingAlert(o))
    .sort((a, b) => {
      const ta = toDateSafe(a.createdAt)?.getTime() ?? 0;
      const tb = toDateSafe(b.createdAt)?.getTime() ?? 0;
      return ta - tb || a.id.localeCompare(b.id);
    });
}

/**
 * Returns accepted/in-progress online orders currently active in the POS ONLINE kitchen zone,
 * ordered chronologically (oldest first) so kitchen/POS handles queue in sequence.
 */
export function getActiveOnlineZoneOrders(orders: OnlineOrderDoc[]): OnlineOrderDoc[] {
  if (!Array.isArray(orders) || orders.length === 0) return [];
  return [...orders]
    .filter((o) => o && isOnlineOrderInActiveZone(o))
    .sort((a, b) => {
      const ta = toDateSafe(a.createdAt)?.getTime() ?? 0;
      const tb = toDateSafe(b.createdAt)?.getTime() ?? 0;
      return ta - tb || a.id.localeCompare(b.id);
    });
}

/**
 * Returns active delivery orders ready for pickup or out for delivery,
 * synchronized across POS RIDER zone and the Rider App.
 */
export function getActiveRiderZoneOrders(orders: OnlineOrderDoc[]): OnlineOrderDoc[] {
  if (!Array.isArray(orders) || orders.length === 0) return [];
  return [...orders]
    .filter((o) => o && isOnlineOrderInRiderZone(o))
    .sort((a, b) => {
      const ta = toDateSafe(a.createdAt)?.getTime() ?? 0;
      const tb = toDateSafe(b.createdAt)?.getTime() ?? 0;
      return ta - tb || a.id.localeCompare(b.id);
    });
}

export function playIncomingOrderChime(): void {
  try {
    if (typeof window === 'undefined') return;
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(660, now);
    osc1.frequency.setValueAtTime(880, now + 0.14);
    gain1.gain.setValueAtTime(0.18, now);
    gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.45);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.46);
  } catch {
    // Audio playback blocked by browser autoplay policy before user gesture
  }
}

const MAX_MERCATOR_LAT = 85.05112878;

/**
 * Projects a WGS84 lat/lng coordinate to global Web Mercator pixel coordinates at the given zoom level.
 */
export function latLngToMercatorPixel(
  lat: number,
  lng: number,
  zoom: number,
  tileSize: number = 256
): { x: number; y: number } {
  const clampedLat = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, lat));
  const clampedZoom = Math.max(0, Math.min(22, zoom));
  const worldSize = tileSize * Math.pow(2, clampedZoom);
  const x = ((lng + 180) / 360) * worldSize;
  const sinLat = Math.sin((clampedLat * Math.PI) / 180);
  const y =
    (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * worldSize;
  return { x, y };
}

/**
 * Unprojects global Web Mercator pixel coordinates back into WGS84 lat/lng rounded to 6 decimals.
 */
export function mercatorPixelToLatLng(
  x: number,
  y: number,
  zoom: number,
  tileSize: number = 256
): LatLngLiteralSimple {
  const clampedZoom = Math.max(0, Math.min(22, zoom));
  const worldSize = tileSize * Math.pow(2, clampedZoom);
  const rawLng = (x / worldSize) * 360 - 180;
  const wrappedLng = ((((rawLng + 180) % 360) + 360) % 360) - 180;
  const n = Math.PI - (2 * Math.PI * Math.max(0, Math.min(worldSize, y))) / worldSize;
  const rawLat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  const clampedLat = Math.max(-MAX_MERCATOR_LAT, Math.min(MAX_MERCATOR_LAT, rawLat));
  return {
    lat: Number(clampedLat.toFixed(6)),
    lng: Number(wrappedLng.toFixed(6)),
  };
}

export interface GeolocationResult {
  lat: number;
  lng: number;
  accuracy?: number;
}

export interface GeolocationErrorLike {
  code: number;
  message: string;
}

/**
 * Fetches current GPS coordinates with iOS Safari resilience:
 * 1) Checks secure context and navigator.geolocation availability.
 * 2) Attempts high-accuracy GPS lock first (8s timeout).
 * 3) If iOS CoreLocation fails with POSITION_UNAVAILABLE (2) or TIMEOUT (3),
 *    automatically retries using Wi-Fi/cellular fallback (enableHighAccuracy: false).
 */
export function getCurrentPositionWithIosFallback(
  geoArg?: Pick<Geolocation, 'getCurrentPosition'> | null
): Promise<GeolocationResult> {
  const geo =
    geoArg ??
    (typeof navigator !== 'undefined' && navigator.geolocation ? navigator.geolocation : null);

  if (!geo || typeof geo.getCurrentPosition !== 'function') {
    return Promise.reject({
      code: 2,
      message: 'Geolocation is not supported on this device/browser.',
    } satisfies GeolocationErrorLike);
  }

  const requestOnce = (options: PositionOptions) =>
    new Promise<GeolocationResult>((resolve, reject) => {
      geo.getCurrentPosition(
        (pos) => {
          const lat = Number(pos.coords.latitude.toFixed(6));
          const lng = Number(pos.coords.longitude.toFixed(6));
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            reject({ code: 2, message: 'Invalid coordinates' } satisfies GeolocationErrorLike);
            return;
          }
          resolve({
            lat,
            lng,
            accuracy: typeof pos.coords.accuracy === 'number' ? pos.coords.accuracy : undefined,
          });
        },
        (err) => {
          reject({
            code: typeof err?.code === 'number' ? err.code : 2,
            message: err?.message || 'Geolocation failed',
          } satisfies GeolocationErrorLike);
        },
        options
      );
    });

  return requestOnce({
    enableHighAccuracy: true,
    timeout: 8000,
    maximumAge: 0,
  }).catch((err: GeolocationErrorLike) => {
    // On iOS Safari indoors, high-accuracy GPS frequently throws code 2 or 3; fall back cleanly.
    if (err && (err.code === 2 || err.code === 3)) {
      return requestOnce({
        enableHighAccuracy: false,
        timeout: 15000,
        maximumAge: 60000,
      });
    }
    throw err;
  });
}

export const RIDER_COMPLETED_RETENTION_DAYS = 15;

export type RiderCompletedSectionKey = 'today' | 'yesterday' | 'past';

export interface RiderCompletedSections {
  today: OnlineOrderDoc[];
  yesterday: OnlineOrderDoc[];
  past: OnlineOrderDoc[];
  visibleOrders: OnlineOrderDoc[];
  expiredOrderIds: string[];
}

function bangkokDateStringToUtcMs(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Date.UTC(y || 2026, (m || 1) - 1, d || 1);
}

/**
 * Returns whole calendar day difference in Asia/Bangkok between referenceNow and targetDate:
 * 0 = same Bangkok date (today), 1 = yesterday, 2+ = earlier.
 */
export function getBangkokCalendarDayDiff(
  targetInput: unknown,
  referenceNow: Date = new Date()
): number | null {
  const targetDate = toDateSafe(targetInput);
  if (!targetDate) return null;
  const targetBkk = getBangkokDateParts(targetDate);
  const nowBkk = getBangkokDateParts(referenceNow);
  const diffMs =
    bangkokDateStringToUtcMs(nowBkk.dateStr) - bangkokDateStringToUtcMs(targetBkk.dateStr);
  return Math.round(diffMs / 86400000);
}

/**
 * Computes milliseconds until the next 00:00:00 in Asia/Bangkok timezone (UTC+7).
 */
export function getMillisUntilNextBangkokMidnight(referenceNow: Date = new Date()): number {
  const bkkNow = getBangkokDateParts(referenceNow);
  const nextDateStr = shiftIsoDateDays(bkkNow.dateStr, 1);
  const nextMidnightMs = new Date(`${nextDateStr}T00:00:00+07:00`).getTime();
  return Math.max(1000, nextMidnightMs - referenceNow.getTime() + 50);
}

export function getPrunedRiderStorageKey(storeId: string): string {
  return `tonys_rider_pruned_completed_${(storeId || 'default').trim()}`;
}

export function loadPrunedRiderCompletedOrderIds(storeId: string): string[] {
  if (typeof localStorage === 'undefined' || !storeId) return [];
  try {
    const raw = localStorage.getItem(getPrunedRiderStorageKey(storeId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function savePrunedRiderCompletedOrderIds(storeId: string, ids: string[]): void {
  if (typeof localStorage === 'undefined' || !storeId) return;
  try {
    const unique = Array.from(new Set(ids.filter(Boolean))).slice(-300);
    localStorage.setItem(getPrunedRiderStorageKey(storeId), JSON.stringify(unique));
  } catch {
    // Ignore storage quota errors
  }
}

function getOrderCompletedSortTimestamp(order: OnlineOrderDoc): number {
  return (
    toDateSafe(order.completedAt)?.getTime() ??
    toDateSafe(order.updatedAt)?.getTime() ??
    toDateSafe(order.createdAt)?.getTime() ??
    0
  );
}

/**
 * Groups completed delivery orders for the Rider "Done" tab into 3 Asia/Bangkok calendar sections:
 * - today: completed today (diffDays <= 0)
 * - yesterday: completed yesterday (diffDays === 1)
 * - past: completed 2..15 days ago, OR legacy completed orders without a completedAt timestamp
 *
 * Orders older than 15 days (or previously pruned in Rider history) are excluded and returned
 * in `expiredOrderIds` so Rider history hides them without deleting shared store/P&L data.
 */
export function groupRiderCompletedOrders(
  orders: OnlineOrderDoc[],
  options?: {
    referenceNow?: Date;
    prunedOrderIds?: Set<string> | string[];
    optimisticCompletedAtMap?: Record<string, string>;
    retentionDays?: number;
  }
): RiderCompletedSections {
  const referenceNow = options?.referenceNow ?? new Date();
  const retentionDays = options?.retentionDays ?? RIDER_COMPLETED_RETENTION_DAYS;
  const prunedSet =
    options?.prunedOrderIds instanceof Set
      ? options.prunedOrderIds
      : new Set(options?.prunedOrderIds || []);
  const optimisticMap = options?.optimisticCompletedAtMap || {};

  const today: OnlineOrderDoc[] = [];
  const yesterday: OnlineOrderDoc[] = [];
  const past: OnlineOrderDoc[] = [];
  const expiredOrderIds: string[] = [];

  for (const order of orders || []) {
    if (!order || order.status !== 'completed') continue;
    if (prunedSet.has(order.id)) continue;

    const effectiveCompletedAt = order.completedAt ?? optimisticMap[order.id];
    const completedDate = toDateSafe(effectiveCompletedAt);

    if (completedDate) {
      const diffDays = getBangkokCalendarDayDiff(completedDate, referenceNow);
      if (diffDays !== null && diffDays > retentionDays) {
        expiredOrderIds.push(order.id);
        continue;
      }
      if (diffDays !== null && diffDays <= 0) {
        today.push(order);
      } else if (diffDays === 1) {
        yesterday.push(order);
      } else {
        past.push(order);
      }
    } else {
      // Legacy completed order lacking `completedAt`: check fallback date only for >15d retention,
      // and always categorize valid legacy entries under "past" ("ที่ผ่านมา") without crashing.
      const fallbackDate = toDateSafe(order.updatedAt) ?? toDateSafe(order.createdAt);
      if (fallbackDate) {
        const fallbackDiff = getBangkokCalendarDayDiff(fallbackDate, referenceNow);
        if (fallbackDiff !== null && fallbackDiff > retentionDays) {
          expiredOrderIds.push(order.id);
          continue;
        }
      }
      past.push(order);
    }
  }

  const sortNewestFirst = (a: OnlineOrderDoc, b: OnlineOrderDoc) => {
    const ta = getOrderCompletedSortTimestamp({
      ...a,
      completedAt: a.completedAt ?? optimisticMap[a.id],
    });
    const tb = getOrderCompletedSortTimestamp({
      ...b,
      completedAt: b.completedAt ?? optimisticMap[b.id],
    });
    return tb - ta || a.id.localeCompare(b.id);
  };

  today.sort(sortNewestFirst);
  yesterday.sort(sortNewestFirst);
  past.sort(sortNewestFirst);

  return {
    today,
    yesterday,
    past,
    visibleOrders: [...today, ...yesterday, ...past],
    expiredOrderIds,
  };
}

/**
 * Resolves the destination string for Google Maps embed/directions links:
 * prefers `lat,lng` when valid numbers are present, otherwise trimmed delivery address.
 */
export function resolveOrderDestinationParam(
  order: Pick<OnlineOrderDoc, 'deliveryLat' | 'deliveryLng' | 'deliveryAddress'>
): string {
  if (
    typeof order.deliveryLat === 'number' &&
    typeof order.deliveryLng === 'number' &&
    Number.isFinite(order.deliveryLat) &&
    Number.isFinite(order.deliveryLng)
  ) {
    return `${order.deliveryLat},${order.deliveryLng}`;
  }
  return (order.deliveryAddress || '').trim();
}

/**
 * Resolves the origin (`saddr`) for Rider navigation:
 * prefers live GPS `lat,lng`, falls back to store pickup address if GPS permission is denied/unavailable.
 */
export function resolveRiderOriginParam(params: {
  riderPosition?: LatLngLiteralSimple | null;
  storeAddress?: string | null;
  fallbackDestination?: string | null;
}): { value: string; source: 'gps' | 'store' | 'fallback' } {
  const { riderPosition, storeAddress, fallbackDestination } = params;
  if (
    riderPosition &&
    typeof riderPosition.lat === 'number' &&
    typeof riderPosition.lng === 'number' &&
    Number.isFinite(riderPosition.lat) &&
    Number.isFinite(riderPosition.lng)
  ) {
    return {
      value: `${riderPosition.lat},${riderPosition.lng}`,
      source: 'gps',
    };
  }
  const trimmedStore = (storeAddress || '').trim();
  if (trimmedStore) {
    return { value: trimmedStore, source: 'store' };
  }
  return {
    value: (fallbackDestination || '').trim() || 'Bangkok, Thailand',
    source: 'fallback',
  };
}

/**
 * Builds an API-key-free Google Maps directions embed iframe URL:
 * https://maps.google.com/maps?saddr=<origin>&daddr=<destination>&output=embed
 */
export function buildGoogleMapsNoKeyEmbedUrl(params: {
  origin: string;
  destination: string;
}): string {
  const saddr = encodeURIComponent((params.origin || '').trim());
  const daddr = encodeURIComponent((params.destination || '').trim());
  return `https://maps.google.com/maps?saddr=${saddr}&daddr=${daddr}&output=embed`;
}

/**
 * Builds the external Google Maps fallback directions URL (`<a target="_blank" rel="noopener noreferrer">`):
 * https://www.google.com/maps/dir/?api=1&destination=...&travelmode=driving
 */
export function buildGoogleMapsDirectionsLink(
  order: Pick<OnlineOrderDoc, 'deliveryLat' | 'deliveryLng' | 'deliveryAddress'>
): string {
  const dest = encodeURIComponent(resolveOrderDestinationParam(order));
  return `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving`;
}



