import { signInAnonymously, User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Unsubscribe,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  auth,
  db,
  getImageDoc,
  handleFirestoreError,
  OperationType,
  stripUndefined,
} from './db';
import {
  CategoryDoc,
  DishDoc,
  IngredientDoc,
  OnlineOrderDoc,
  OnlineOrderItem,
  OnlineOrderMode,
  OnlineOrderStatus,
  OnlinePaymentMethod,
  OptionGroupDoc,
  PackagingDoc,
  PublicStoreDoc,
  PublicStoreIndexDoc,
  SettingsDoc,
  SubRecipeDoc,
} from '../types';
import { DailySalesRecord } from '../costing/types/domain';
import { COST_COLLECTIONS } from '../costing/services/firebaseSyncService';
import { StorageService } from '../costing/services/storageService';
import {
  buildWebSyncDailySalesRecords,
  getBangkokDateParts,
  sanitizeMenuForPublicStore,
  toDateSafe,
} from '../engine/onlineOrdering';

const STORAGE_STORE_ID_KEY = 'kinpos_public_store_id';
const STORAGE_RIDER_NAME_KEY = 'kinpos_rider_name';
const STORAGE_CUSTOMER_INFO_KEY = 'kinpos_online_customer_profile';
const publicImageCache = new Map<string, string>();

export interface SavedCustomerCheckoutInfo {
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  customerNote: string;
  orderMode: OnlineOrderMode;
  paymentMethod: OnlinePaymentMethod;
  deliveryLat?: number | null;
  deliveryLng?: number | null;
}

export function loadSavedCustomerInfo(): SavedCustomerCheckoutInfo {
  try {
    const raw = localStorage.getItem(STORAGE_CUSTOMER_INFO_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        customerName: parsed.customerName || '',
        customerPhone: parsed.customerPhone || '',
        deliveryAddress: parsed.deliveryAddress || '',
        customerNote: parsed.customerNote || '',
        orderMode: parsed.orderMode === 'delivery' ? 'delivery' : 'pickup',
        paymentMethod: parsed.paymentMethod === 'qr_payment' ? 'qr_payment' : 'cash',
        deliveryLat: typeof parsed.deliveryLat === 'number' ? parsed.deliveryLat : null,
        deliveryLng: typeof parsed.deliveryLng === 'number' ? parsed.deliveryLng : null,
      };
    }
  } catch {
    // Ignore storage read error
  }
  return {
    customerName: '',
    customerPhone: '',
    deliveryAddress: '',
    customerNote: '',
    orderMode: 'pickup',
    paymentMethod: 'cash',
    deliveryLat: null,
    deliveryLng: null,
  };
}

export function saveCustomerInfo(info: SavedCustomerCheckoutInfo): void {
  try {
    localStorage.setItem(STORAGE_CUSTOMER_INFO_KEY, JSON.stringify(info));
  } catch {
    // Ignore quota errors
  }
}

export function loadSavedRiderName(): string {
  try {
    return localStorage.getItem(STORAGE_RIDER_NAME_KEY) || '';
  } catch {
    return '';
  }
}

export function saveRiderName(name: string): void {
  try {
    localStorage.setItem(STORAGE_RIDER_NAME_KEY, name);
  } catch {
    // Ignore storage error
  }
}

/**
 * Ensures either an active signed-in user or a silent Firebase Anonymous session.
 * Never logs out an existing Google-signed-in owner.
 */
export async function ensureAnonymousAuth(): Promise<User> {
  if (!auth) {
    throw new Error('Firebase Authentication is not initialized.');
  }
  if (auth.currentUser) {
    return auth.currentUser;
  }
  try {
    const cred = await signInAnonymously(auth);
    return cred.user;
  } catch (err: any) {
    const code = err?.code || '';
    if (
      code === 'auth/operation-not-allowed' ||
      code === 'auth/admin-restricted-operation'
    ) {
      throw new Error(
        'กรุณาเปิดใช้งาน Anonymous Sign-In ใน Firebase Console > Authentication > Sign-in method เพื่อให้ลูกค้าและไรเดอร์เข้าใช้งานได้อัตโนมัติ / Please enable Anonymous Sign-In provider in Firebase Console.'
      );
    }
    throw err;
  }
}

/**
 * Resolves storefront owner storeId from URL ?store=, /publicStoreIndex/default, or localStorage.
 */
export async function resolvePublicStoreId(search: string = ''): Promise<string | null> {
  try {
    const params = new URLSearchParams(search || (typeof window !== 'undefined' ? window.location.search : ''));
    const storeFromUrl = params.get('store')?.trim();
    if (storeFromUrl) {
      try {
        localStorage.setItem(STORAGE_STORE_ID_KEY, storeFromUrl);
      } catch {
        // Ignore storage errors
      }
      return storeFromUrl;
    }
  } catch {
    // Ignore URL parse error
  }

  if (db) {
    try {
      const indexRef = doc(db, 'publicStoreIndex', 'default');
      const snap = await getDoc(indexRef);
      if (snap.exists()) {
        const indexData = snap.data() as PublicStoreIndexDoc;
        if (indexData?.storeId) {
          try {
            localStorage.setItem(STORAGE_STORE_ID_KEY, indexData.storeId);
          } catch {
            // Ignore
          }
          return indexData.storeId;
        }
      }
    } catch (err) {
      console.warn('Could not read publicStoreIndex/default:', err);
    }
  }

  try {
    return localStorage.getItem(STORAGE_STORE_ID_KEY);
  } catch {
    return null;
  }
}

export function subscribePublicStore(
  storeId: string,
  onData: (store: PublicStoreDoc | null) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  if (!db || !storeId) return () => {};
  const path = `publicStores/${storeId}`;
  return onSnapshot(
    doc(db, 'publicStores', storeId),
    (snap) => {
      onData(snap.exists() ? ({ ...snap.data(), id: snap.id } as PublicStoreDoc) : null);
    },
    (err) => {
      console.error(`Error subscribing to ${path}:`, err);
      onError?.(err);
    }
  );
}

export async function fetchPublicStoreImage(
  storeId: string,
  imageId: string
): Promise<string | null> {
  if (!db || !storeId || !imageId) return null;
  const cacheKey = `${storeId}::${imageId}`;
  if (publicImageCache.has(cacheKey)) {
    return publicImageCache.get(cacheKey)!;
  }
  const path = `publicStores/${storeId}/images/${imageId}`;
  try {
    const snap = await getDoc(doc(db, 'publicStores', storeId, 'images', imageId));
    if (snap.exists()) {
      const dataUrl = (snap.data() as { dataUrl?: string }).dataUrl || null;
      if (dataUrl) publicImageCache.set(cacheKey, dataUrl);
      return dataUrl;
    }
    return null;
  } catch (err) {
    handleFirestoreError(err, OperationType.GET, path);
  }
}

/**
 * Publishes strictly sanitized menu, categories, option groups, storefront settings,
 * and dish/QR images from Owner private collections to `/publicStores/{uid}`.
 */
export async function publishMenuToPublicStore(params: {
  storeId: string;
  settings: SettingsDoc;
  categories: CategoryDoc[];
  dishes: DishDoc[];
  optionGroups: OptionGroupDoc[];
}): Promise<{ dishCount: number; imageCount: number; publishedAt: string }> {
  if (!db) throw new Error('Firestore is not initialized.');
  const { storeId, settings, categories, dishes, optionGroups } = params;
  const publishedAt = new Date().toISOString();

  const { publicStore, referencedImageIds } = sanitizeMenuForPublicStore({
    storeId,
    settings,
    categories,
    dishes,
    optionGroups,
    publishedAt,
  });

  const storePath = `publicStores/${storeId}`;
  try {
    await setDoc(doc(db, 'publicStores', storeId), stripUndefined(publicStore));
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, storePath);
  }

  let copiedImages = 0;
  for (const imageId of referencedImageIds) {
    try {
      const imgDoc = await getImageDoc(imageId);
      if (imgDoc?.dataUrl) {
        await setDoc(doc(db, 'publicStores', storeId, 'images', imageId), {
          id: imageId,
          dataUrl: imgDoc.dataUrl,
          sizeBytes: imgDoc.sizeBytes || imgDoc.dataUrl.length,
          updatedAt: serverTimestamp(),
        });
        publicImageCache.set(`${storeId}::${imageId}`, imgDoc.dataUrl);
        copiedImages += 1;
      }
    } catch (err) {
      console.warn(`Skipped copying public image ${imageId}:`, err);
    }
  }

  if (settings.onlinePublishDefaultIndex !== false) {
    const indexPath = 'publicStoreIndex/default';
    try {
      await setDoc(doc(db, 'publicStoreIndex', 'default'), {
        id: 'default',
        storeId,
        shopName: publicStore.shopName,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, indexPath);
    }
  }

  return {
    dishCount: publicStore.dishes.length,
    imageCount: copiedImages,
    publishedAt,
  };
}

function sortOrdersNewestFirst(list: OnlineOrderDoc[]): OnlineOrderDoc[] {
  return [...list].sort((a, b) => {
    const da = toDateSafe(a.createdAt)?.getTime() ?? 0;
    const dbTime = toDateSafe(b.createdAt)?.getTime() ?? 0;
    return dbTime - da;
  });
}

function generateOnlineOrderNumber(): string {
  const bkk = getBangkokDateParts(new Date());
  const yy = String(bkk.year).slice(-2);
  const mm = String(bkk.month).padStart(2, '0');
  const dd = String(bkk.day).padStart(2, '0');
  const suffix = String(Date.now()).slice(-4);
  return `ON-${yy}${mm}${dd}-${suffix}`;
}

export async function createOnlineOrder(input: {
  storeId: string;
  customerName: string;
  customerPhone: string;
  orderMode: OnlineOrderMode;
  paymentMethod: OnlinePaymentMethod;
  deliveryAddress?: string;
  deliveryLat?: number | null;
  deliveryLng?: number | null;
  customerNote?: string;
  items: OnlineOrderItem[];
  subtotal: number;
  deliveryFee: number;
  totalAmount: number;
}): Promise<OnlineOrderDoc> {
  if (!db) throw new Error('Firestore is not initialized.');
  const customerUser = await ensureAnonymousAuth();
  const orderId = `ord_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const orderNumber = generateOnlineOrderNumber();
  const path = `onlineOrders/${orderId}`;

  const payload = stripUndefined({
    id: orderId,
    orderNumber,
    storeId: input.storeId,
    customerUid: customerUser.uid,
    customerName: input.customerName.trim(),
    customerPhone: input.customerPhone.trim(),
    orderMode: input.orderMode,
    paymentMethod: input.paymentMethod,
    ...(input.deliveryAddress?.trim() ? { deliveryAddress: input.deliveryAddress.trim() } : {}),
    ...(typeof input.deliveryLat === 'number' ? { deliveryLat: input.deliveryLat } : {}),
    ...(typeof input.deliveryLng === 'number' ? { deliveryLng: input.deliveryLng } : {}),
    ...(input.customerNote?.trim() ? { customerNote: input.customerNote.trim() } : {}),
    items: input.items,
    subtotal: Math.max(0, Number(input.subtotal) || 0),
    deliveryFee: input.orderMode === 'delivery' ? Math.max(0, Number(input.deliveryFee) || 0) : 0,
    totalAmount: Math.max(0, Number(input.totalAmount) || 0),
    status: 'pending' as OnlineOrderStatus,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  try {
    await setDoc(doc(db, 'onlineOrders', orderId), payload);
    return {
      ...(payload as unknown as OnlineOrderDoc),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  } catch (err) {
    handleFirestoreError(err, OperationType.CREATE, path);
  }
}

export function subscribeCustomerOrders(
  customerUid: string,
  onData: (orders: OnlineOrderDoc[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  if (!db || !customerUid) return () => {};
  const path = 'onlineOrders';
  const q = query(collection(db, 'onlineOrders'), where('customerUid', '==', customerUid));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => ({ ...d.data(), id: d.id }) as OnlineOrderDoc);
      onData(sortOrdersNewestFirst(items));
    },
    (err) => {
      console.error('Customer orders listener error:', err);
      onError?.(err);
    }
  );
}

export async function cancelOnlineOrderByCustomer(
  orderId: string,
  cancelReason: string = 'ลูกค้ายกเลิกคำสั่งซื้อ'
): Promise<void> {
  if (!db) return;
  const path = `onlineOrders/${orderId}`;
  try {
    await updateDoc(doc(db, 'onlineOrders', orderId), {
      status: 'cancelled',
      cancelReason,
      cancelledAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export function subscribeRiderDeliveryOrders(
  storeId: string,
  onData: (orders: OnlineOrderDoc[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  if (!db || !storeId) return () => {};
  const q = query(
    collection(db, 'onlineOrders'),
    where('storeId', '==', storeId),
    where('orderMode', '==', 'delivery')
  );
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => ({ ...d.data(), id: d.id }) as OnlineOrderDoc);
      onData(sortOrdersNewestFirst(items));
    },
    (err) => {
      console.error('Rider delivery orders listener error:', err);
      onError?.(err);
    }
  );
}

export async function updateOnlineOrderByRider(
  orderId: string,
  nextStatus: 'out_for_delivery' | 'completed',
  riderName: string,
  riderUid?: string
): Promise<void> {
  if (!db) return;
  const path = `onlineOrders/${orderId}`;
  const updatePayload: Record<string, unknown> = {
    status: nextStatus,
    riderName: riderName.trim() || 'Rider',
    ...(riderUid ? { riderUid } : {}),
    updatedAt: serverTimestamp(),
  };
  if (nextStatus === 'out_for_delivery') {
    updatePayload.pickedUpAt = serverTimestamp();
  }
  if (nextStatus === 'completed') {
    updatePayload.completedAt = serverTimestamp();
  }
  try {
    await updateDoc(doc(db, 'onlineOrders', orderId), stripUndefined(updatePayload));
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export function subscribeOwnerOnlineOrders(
  storeId: string,
  onData: (orders: OnlineOrderDoc[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  if (!db || !storeId) return () => {};
  const q = query(collection(db, 'onlineOrders'), where('storeId', '==', storeId));
  return onSnapshot(
    q,
    (snap) => {
      const items = snap.docs.map((d) => ({ ...d.data(), id: d.id }) as OnlineOrderDoc);
      onData(sortOrdersNewestFirst(items));
    },
    (err) => {
      console.error('Owner online orders listener error:', err);
      onError?.(err);
    }
  );
}

export async function updateOnlineOrderByOwner(
  orderId: string,
  nextStatus: OnlineOrderStatus,
  extra?: { cancelReason?: string; riderName?: string }
): Promise<void> {
  if (!db) return;
  const path = `onlineOrders/${orderId}`;
  const updatePayload: Record<string, unknown> = {
    status: nextStatus,
    updatedAt: serverTimestamp(),
  };
  if (nextStatus === 'accepted') updatePayload.acceptedAt = serverTimestamp();
  if (nextStatus === 'ready_for_pickup') updatePayload.readyAt = serverTimestamp();
  if (nextStatus === 'out_for_delivery') updatePayload.pickedUpAt = serverTimestamp();
  if (nextStatus === 'completed') updatePayload.completedAt = serverTimestamp();
  if (nextStatus === 'cancelled') updatePayload.cancelledAt = serverTimestamp();
  if (extra?.cancelReason) updatePayload.cancelReason = extra.cancelReason;
  if (extra?.riderName) updatePayload.riderName = extra.riderName;

  try {
    await updateDoc(doc(db, 'onlineOrders', orderId), stripUndefined(updatePayload));
  } catch (err) {
    handleFirestoreError(err, OperationType.UPDATE, path);
  }
}

export async function deleteOnlineOrderByOwner(orderId: string): Promise<void> {
  if (!db) return;
  const path = `onlineOrders/${orderId}`;
  try {
    await deleteDoc(doc(db, 'onlineOrders', orderId));
  } catch (err) {
    handleFirestoreError(err, OperationType.DELETE, path);
  }
}

/**
 * Idempotently aggregates all `'completed'` online orders into `users/{uid}/costDailySales`
 * under document IDs `web_sync_${workDate}_${channelId}` (strictly separate from `pos_sync_*`).
 *
 * Also cleans up stale `web_sync_*` documents if all completed orders for that group were deleted/voided,
 * and stamps cost snapshots + `pnlSyncedAt` onto completed `onlineOrders` docs.
 */
export async function syncCompletedOnlineOrdersToPnl(params: {
  uid: string;
  orders: OnlineOrderDoc[];
  settings: SettingsDoc;
  dishes: DishDoc[];
  optionGroups: OptionGroupDoc[];
  ingredients: IngredientDoc[];
  subRecipes: SubRecipeDoc[];
  packaging: PackagingDoc[];
}): Promise<{ syncedRecords: number; removedRecords: number }> {
  if (!db || !params.uid) return { syncedRecords: 0, removedRecords: 0 };
  const { uid, orders, settings, dishes, optionGroups, ingredients, subRecipes, packaging } = params;

  const targetRecords = buildWebSyncDailySalesRecords(orders, {
    dailyClosingTime: settings.dailyClosingTime || '04:00',
    pricesIncludeVat: settings.pricesIncludeVat,
    vatPercent: settings.vatPercent ?? 7,
    dishes,
    optionGroups,
    ingredients,
    subRecipes,
    packaging,
  });

  const colRef = collection(db, 'users', uid, COST_COLLECTIONS.DAILY_SALES);
  const existingSnap = await getDocs(colRef);
  const existingWebDocs = existingSnap.docs.filter((d) => d.id.startsWith('web_sync_'));

  const batch = writeBatch(db);
  let syncedRecords = 0;
  let removedRecords = 0;

  // Remove stale web_sync_* docs no longer backed by any completed order
  for (const docSnap of existingWebDocs) {
    if (!targetRecords[docSnap.id]) {
      batch.delete(doc(db, 'users', uid, COST_COLLECTIONS.DAILY_SALES, docSnap.id));
      removedRecords += 1;
    }
  }

  // Upsert exact computed web_sync_* records
  for (const [docId, record] of Object.entries(targetRecords)) {
    const docRef = doc(db, 'users', uid, COST_COLLECTIONS.DAILY_SALES, docId);
    batch.set(
      docRef,
      stripUndefined({
        ...record,
        updatedAt: serverTimestamp(),
      })
    );
    syncedRecords += 1;
  }

  try {
    await batch.commit();
  } catch (err) {
    handleFirestoreError(err, OperationType.WRITE, `users/${uid}/${COST_COLLECTIONS.DAILY_SALES}`);
  }

  // Keep localStorage StorageService in sync
  const localExisting = StorageService.getDailySales().filter((r) => !r.id?.startsWith('web_sync_'));
  const mergedLocal = [...localExisting, ...Object.values(targetRecords)].sort(
    (a, b) => a.date.localeCompare(b.date) || (a.channelId || '').localeCompare(b.channelId || '')
  );
  StorageService.saveDailySales(mergedLocal);

  // Stamp sync metadata onto completed orders lacking pnlSyncedAt (best-effort)
  const dishesMap = new Map(dishes.map((d) => [d.id, d]));
  const optionGroupsMap = new Map(optionGroups.map((g) => [g.id, g]));
  const ingredientsMap = new Map(ingredients.map((i) => [i.id, i]));
  const subRecipesMap = new Map(subRecipes.map((s) => [s.id, s]));
  const packagingMap = new Map(packaging.map((p) => [p.id, p]));

  const syncIso = new Date().toISOString();
  const ordersNeedingStamp = orders.filter((o) => o.status === 'completed' && !o.pnlSyncedAt);
  for (const ord of ordersNeedingStamp) {
    try {
      const workDate =
        ord.workDate ||
        Object.values(targetRecords).find((r) => r.channelId.includes(ord.orderMode))?.date;
      const singleRec = buildWebSyncDailySalesRecords([ord], {
        dailyClosingTime: settings.dailyClosingTime || '04:00',
        pricesIncludeVat: settings.pricesIncludeVat,
        vatPercent: settings.vatPercent ?? 7,
        dishes: Array.from(dishesMap.values()),
        optionGroups: Array.from(optionGroupsMap.values()),
        ingredients: Array.from(ingredientsMap.values()),
        subRecipes: Array.from(subRecipesMap.values()),
        packaging: Array.from(packagingMap.values()),
      });
      const firstRec = Object.values(singleRec)[0];
      await updateDoc(doc(db, 'onlineOrders', ord.id), {
        workDate: firstRec?.date || workDate || getBangkokDateParts(new Date()).dateStr,
        foodCostSnapshot: firstRec?.foodCost ?? 0,
        packagingCostSnapshot: firstRec?.packagingCost ?? 0,
        pnlSyncedAt: syncIso,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      console.warn(`Could not stamp pnlSyncedAt on order ${ord.id}:`, err);
    }
  }

  return { syncedRecords, removedRecords };
}
