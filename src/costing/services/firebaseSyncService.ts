import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  getDocs,
  getDoc,
  writeBatch,
  serverTimestamp,
} from 'firebase/firestore';
import {
  auth,
  db,
  handleFirestoreError,
  OperationType,
  stripUndefined,
} from './firebase';
import { StorageService } from './storageService';
import {
  Ingredient,
  Sauce,
  MenuItem,
  RestaurantSettings,
  Supplier,
  ExpenseRecord,
  SaleOrder,
  InventoryItem,
  WasteRecord,
  PurchaseRecord,
  PriceHistoryRecord,
  Employee,
} from '../types';
import { DailySalesRecord } from '../types/domain';
import { DailySummaryDoc } from '../../types';

/**
 * Namespaced under users/{uid}/cost* so costing data coexists cleanly
 * alongside KinPOS operational POS collections without schema collisions.
 */
export const COST_COLLECTIONS = {
  SETTINGS: 'costSettings',
  INGREDIENTS: 'costIngredients',
  SAUCES: 'costSauces',
  MENUS: 'costMenus',
  DAILY_SALES: 'costDailySales',
  EXPENSES: 'costExpenses',
  EMPLOYEES: 'costEmployees',
  INVENTORY: 'costInventory',
  PURCHASES: 'costPurchases',
  WASTE_LOG: 'costWasteLog',
  SUPPLIERS: 'costSuppliers',
  PRICE_HISTORY: 'costPriceHistory',
  SALES_ORDERS: 'costSalesOrders',
  STOCK_COUNTS: 'costStockCounts',
  BASE_RECIPES: 'costBaseRecipes',
  RICE_NOODLE_PORTIONS: 'costRiceNoodlePortions',
} as const;

export const COLLECTIONS = COST_COLLECTIONS;

export interface CloudSyncState {
  isSyncing: boolean;
  isConnected: boolean;
  lastSyncedAt: string | null;
  error: string | null;
}

export const FirebaseSyncService = {
  /**
   * Helper to recursively strip undefined properties before writing to Firestore.
   */
  sanitizeData<T>(data: T): T {
    return stripUndefined(data);
  },

  /**
   * Save a single user-scoped document to Firestore:
   * Paths: users/{uid}/{collectionName}/{docId}
   */
  async saveUserDoc<T extends Record<string, any>>(
    userId: string,
    collectionName: string,
    docId: string,
    data: T
  ): Promise<void> {
    if (!userId || !docId || !db) return;
    const path = `users/${userId}/${collectionName}/${docId}`;
    try {
      const docRef = doc(db, 'users', userId, collectionName, docId);
      const clean = stripUndefined(data) as Record<string, any>;
      const payload: Record<string, any> = {
        ...clean,
        id: docId,
        updatedAt: serverTimestamp(),
      };
      if (!clean.createdAt) {
        payload.createdAt = serverTimestamp();
      }
      await setDoc(docRef, stripUndefined(payload), { merge: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  },

  /**
   * Delete a single user-scoped document from Firestore
   */
  async deleteUserDoc(userId: string, collectionName: string, docId: string): Promise<void> {
    if (!userId || !docId || !db) return;
    const path = `users/${userId}/${collectionName}/${docId}`;
    try {
      const docRef = doc(db, 'users', userId, collectionName, docId);
      await deleteDoc(docRef);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  },

  /**
   * Batch save multiple user-scoped entities (chunked at 400 per commit)
   */
  async batchSaveUser<T extends { id?: string }>(
    userId: string,
    collectionName: string,
    items: T[]
  ): Promise<void> {
    if (!userId || !items || items.length === 0 || !db) return;
    const basePath = `users/${userId}/${collectionName}`;
    try {
      let batch = writeBatch(db);
      let count = 0;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const docId = item.id || `doc_${Date.now()}_${i}`;
        const docRef = doc(db, 'users', userId, collectionName, docId);
        const clean = stripUndefined(item) as Record<string, any>;
        const payload = stripUndefined({
          ...clean,
          id: docId,
          updatedAt: serverTimestamp(),
          createdAt: clean.createdAt || serverTimestamp(),
        });
        batch.set(docRef, payload, { merge: true });
        count++;

        if (count >= 400) {
          await batch.commit();
          batch = writeBatch(db);
          count = 0;
        }
      }

      if (count > 0) {
        await batch.commit();
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, basePath);
    }
  },

  /**
   * Real-time Firestore collection subscription scoped to user UID
   */
  subscribeUserCollection<T>(
    userId: string,
    collectionName: string,
    onData: (items: T[]) => void,
    onError?: (err: Error) => void
  ): () => void {
    if (!userId || !db) return () => {};
    const path = `users/${userId}/${collectionName}`;
    const colRef = collection(db, 'users', userId, collectionName);
    return onSnapshot(
      colRef,
      (snapshot) => {
        const list = snapshot.docs.map((d) => ({
          ...d.data(),
          id: d.id,
        })) as T[];
        onData(list);
      },
      (err) => {
        console.error(`Error subscribing to ${path}:`, err);
        if (onError) onError(err);
      }
    );
  },

  /**
   * Real-time subscription to a single user document (e.g., costSettings/default)
   */
  subscribeUserDoc<T>(
    userId: string,
    collectionName: string,
    docId: string,
    onData: (data: T | null) => void,
    onError?: (err: Error) => void
  ): () => void {
    if (!userId || !docId || !db) return () => {};
    const path = `users/${userId}/${collectionName}/${docId}`;
    const docRef = doc(db, 'users', userId, collectionName, docId);
    return onSnapshot(
      docRef,
      (snapshot) => {
        if (snapshot.exists()) {
          onData({ ...snapshot.data(), id: snapshot.id } as T);
        } else {
          onData(null);
        }
      },
      (err) => {
        console.error(`Error subscribing to ${path}:`, err);
        if (onError) onError(err);
      }
    );
  },

  /**
   * Check whether the user already has costing data stored in Firestore
   */
  async hasUserData(userId: string): Promise<boolean> {
    if (!userId || !db) return false;
    try {
      const [settingsSnap, ingSnap, menuSnap] = await Promise.all([
        getDoc(doc(db, 'users', userId, COST_COLLECTIONS.SETTINGS, 'default')),
        getDocs(collection(db, 'users', userId, COST_COLLECTIONS.INGREDIENTS)),
        getDocs(collection(db, 'users', userId, COST_COLLECTIONS.MENUS)),
      ]);
      return settingsSnap.exists() || !ingSnap.empty || !menuSnap.empty;
    } catch (err) {
      console.warn('Error checking user costing cloud state:', err);
      return false;
    }
  },

  /**
   * Seed initial or localStorage costing data into Firestore under users/{uid}/cost*
   */
  async migrateLocalDataToUser(
    userId: string
  ): Promise<{ success: boolean; count: number; error?: string }> {
    if (!userId) return { success: false, count: 0, error: 'User ID is required' };
    try {
      const settings = StorageService.getSettings();
      const ingredients = StorageService.getIngredients();
      const sauces = StorageService.getSauces();
      const menus = StorageService.getMenus();
      const dailySales = StorageService.getDailySales();
      const expenses = StorageService.getExpenses();
      const employees = StorageService.getEmployees();
      const inventory = StorageService.getInventory();
      const purchases = StorageService.getPurchases();
      const wasteLog = StorageService.getWasteLog();
      const suppliers = StorageService.getSuppliers();
      const priceHistory = StorageService.getPriceHistory();
      const salesOrders = StorageService.getSalesOrders();
      const stockCounts = StorageService.getStockCounts();
      const baseRecipes = StorageService.getBaseRecipes();
      const riceNoodlePortions = StorageService.getRiceNoodlePortions();

      await this.saveUserDoc(userId, COST_COLLECTIONS.SETTINGS, 'default', settings);
      await Promise.all([
        this.batchSaveUser(userId, COST_COLLECTIONS.INGREDIENTS, ingredients),
        this.batchSaveUser(userId, COST_COLLECTIONS.SAUCES, sauces),
        this.batchSaveUser(userId, COST_COLLECTIONS.MENUS, menus),
        this.batchSaveUser(userId, COST_COLLECTIONS.DAILY_SALES, dailySales),
        this.batchSaveUser(userId, COST_COLLECTIONS.EXPENSES, expenses),
        this.batchSaveUser(userId, COST_COLLECTIONS.EMPLOYEES, employees),
        this.batchSaveUser(userId, COST_COLLECTIONS.INVENTORY, inventory),
        this.batchSaveUser(userId, COST_COLLECTIONS.PURCHASES, purchases),
        this.batchSaveUser(userId, COST_COLLECTIONS.WASTE_LOG, wasteLog),
        this.batchSaveUser(userId, COST_COLLECTIONS.SUPPLIERS, suppliers),
        this.batchSaveUser(userId, COST_COLLECTIONS.PRICE_HISTORY, priceHistory),
        this.batchSaveUser(userId, COST_COLLECTIONS.SALES_ORDERS, salesOrders),
        this.batchSaveUser(userId, COST_COLLECTIONS.STOCK_COUNTS, stockCounts),
        this.batchSaveUser(userId, COST_COLLECTIONS.BASE_RECIPES, baseRecipes),
        this.batchSaveUser(userId, COST_COLLECTIONS.RICE_NOODLE_PORTIONS, riceNoodlePortions),
      ]);

      const count =
        1 +
        ingredients.length +
        sauces.length +
        menus.length +
        dailySales.length +
        expenses.length +
        employees.length +
        inventory.length +
        purchases.length +
        wasteLog.length +
        suppliers.length +
        priceHistory.length +
        salesOrders.length +
        stockCounts.length +
        baseRecipes.length +
        riceNoodlePortions.length;

      return { success: true, count };
    } catch (err: any) {
      console.error('Failed to initialize costing cloud data:', err);
      return { success: false, count: 0, error: err.message };
    }
  },

  /**
   * Pull REAL daily sales directly from KinPOS operational dailySummaries in Firestore
   * and convert them into DailySalesRecord[] for ExecutiveDashboard, P&L, and Break-Even.
   */
  async pullDailySales(
    userId?: string
  ): Promise<{ success: boolean; data: DailySalesRecord[]; error?: string }> {
    try {
      const uid = userId || auth?.currentUser?.uid;
      if (!uid || !db) {
        return { success: true, data: StorageService.getDailySales() };
      }

      const [summariesSnap, cloudSalesSnap] = await Promise.all([
        getDocs(collection(db, 'users', uid, 'dailySummaries')),
        getDocs(collection(db, 'users', uid, COST_COLLECTIONS.DAILY_SALES)),
      ]);
      const summaries = summariesSnap.docs.map((docSnap) => docSnap.data() as DailySummaryDoc);
      const localRecords = StorageService.getDailySales();
      const cloudMap = new Map<string, DailySalesRecord>();
      for (const rec of localRecords) {
        if (rec?.id) cloudMap.set(rec.id, rec);
      }
      for (const docSnap of cloudSalesSnap.docs) {
        const cloudRec = { ...(docSnap.data() as DailySalesRecord), id: docSnap.id };
        if (!cloudRec.id.startsWith('pos_sync_') || !cloudMap.has(cloudRec.id)) {
          cloudMap.set(cloudRec.id, cloudRec);
        }
      }

      const merged = convertDailySummariesToSalesRecords(summaries, Array.from(cloudMap.values()));
      StorageService.saveDailySales(merged);
      return { success: true, data: merged };
    } catch (err: any) {
      console.error('Error pulling live POS daily sales:', err);
      return {
        success: false,
        data: StorageService.getDailySales(),
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};

/**
 * Pure conversion from POS dailySummaries -> DailySalesRecord[] with idempotency,
 * exact per-channel breakdown when present, legacy proportional fallback flagging
 * (estimatedAllocation: true), Service Charge propagation, and preservation of explicit
 * manual overrides marked `replacesPosSync: true`.
 */
export function convertDailySummariesToSalesRecords(
  summaries: DailySummaryDoc[],
  existingRecords: DailySalesRecord[] = []
): DailySalesRecord[] {
  const existingManual = (existingRecords || []).filter(
    (rec) => !rec.id?.startsWith('pos_sync_')
  );

  if (!summaries || summaries.length === 0) {
    return [...existingManual].sort(
      (a, b) => a.date.localeCompare(b.date) || (a.channelId || '').localeCompare(b.channelId || '')
    );
  }

  const CHANNEL_DISPLAY_NAMES: Record<string, string> = {
    dine_in: 'หน้าร้าน (Dine-in)',
    takeaway: 'สั่งกลับบ้าน (Takeaway)',
    grab: 'GrabFood',
    lineman: 'LINE MAN',
    shopeefood: 'ShopeeFood',
    robinhood: 'Robinhood',
  };

  const normalizeKey = (ch?: string): string => {
    const raw = (ch || '').trim().toLowerCase().replace(/-/g, '_');
    if (!raw) return '';
    if (raw === 'dinein') return 'dine_in';
    if (raw === 'take_away') return 'takeaway';
    if (raw === 'grabfood') return 'grab';
    if (raw === 'line_man') return 'lineman';
    return raw;
  };

  const round2 = (v: number): number =>
    Number.isFinite(v) ? Math.round((v + Number.EPSILON) * 100) / 100 : 0;

  const posRecords: DailySalesRecord[] = [];

  for (const s of summaries) {
    const channelEntries = Object.entries(s.channelTotals || {}).filter(
      ([, chData]) => (chData?.netSales || 0) > 0 || (chData?.orderCount || 0) > 0
    );

    if (channelEntries.length > 0) {
      const deliveryKeys = channelEntries
        .map(([k]) => k)
        .filter((k) => k !== 'dine_in' && k !== 'takeaway');
      const deliverySalesSum = deliveryKeys.reduce(
        (sum, k) => sum + (s.channelTotals?.[k]?.netSales || 0),
        0
      );
      const totalNetSum = channelEntries.reduce((sum, [, d]) => sum + (d?.netSales || 0), 0);

      for (const [chId, chData] of channelEntries) {
        const chNet = Math.max(0, chData.netSales || 0);
        const chOrders = Math.max(0, chData.orderCount || 0);

        const hasExactBreakdown =
          typeof chData.grossSales === 'number' &&
          typeof chData.discounts === 'number' &&
          typeof chData.platformFees === 'number';

        const shareOfTotal = totalNetSum > 0 ? chNet / totalNetSum : 1 / channelEntries.length;
        const isDelivery = chId !== 'dine_in' && chId !== 'takeaway';
        const feeShare = isDelivery
          ? deliverySalesSum > 0
            ? chNet / deliverySalesSum
            : 1 / Math.max(1, deliveryKeys.length)
          : 0;

        const chDiscounts =
          typeof chData.discounts === 'number'
            ? round2(Math.max(0, chData.discounts))
            : round2((s.discounts || 0) * shareOfTotal);

        const chPlatformFees =
          typeof chData.platformFees === 'number'
            ? round2(Math.max(0, chData.platformFees))
            : round2((s.platformFees || 0) * feeShare);

        const chGross =
          typeof chData.grossSales === 'number'
            ? round2(Math.max(0, chData.grossSales))
            : round2(chNet + chDiscounts);

        const chFoodCost =
          typeof chData.totalFoodCost === 'number'
            ? round2(Math.max(0, chData.totalFoodCost))
            : typeof s.totalFoodCost === 'number'
              ? round2(Math.max(0, s.totalFoodCost * shareOfTotal))
              : undefined;

        const chPackagingCost =
          typeof chData.packagingCost === 'number'
            ? round2(Math.max(0, chData.packagingCost))
            : typeof s.packagingCost === 'number'
              ? round2(Math.max(0, s.packagingCost * shareOfTotal))
              : undefined;

        const chServiceCharge =
          typeof chData.serviceCharge === 'number'
            ? round2(Math.max(0, chData.serviceCharge))
            : typeof s.serviceCharge === 'number'
              ? round2(Math.max(0, s.serviceCharge * shareOfTotal))
              : 0;

        posRecords.push({
          id: `pos_sync_${s.date}_${chId}`,
          date: s.date,
          channelId: chId,
          channelName: CHANNEL_DISPLAY_NAMES[chId] || chId,
          orderCount: chOrders,
          grossSales: chGross,
          discounts: chDiscounts,
          refunds: 0,
          netSales: chNet,
          vatRatePercent: (s.vat || 0) > 0 && chNet > 0 ? 7 : 0,
          platformFees: chPlatformFees,
          actualPayout: Math.max(0, round2(chNet - chPlatformFees)),
          serviceCharge: chServiceCharge,
          foodCost: chFoodCost,
          packagingCost: chPackagingCost,
          estimatedAllocation: !hasExactBreakdown,
        });
      }
    } else {
      const netSales =
        s.netSales > 0 ? s.netSales : Math.max(0, (s.grossSales || 0) - (s.discounts || 0));
      const platformFees = Math.max(0, s.platformFees || 0);
      posRecords.push({
        id: `pos_sync_${s.date}_dine_in`,
        date: s.date,
        channelId: 'dine_in',
        channelName: 'หน้าร้าน (Dine-in)',
        orderCount: s.orderCount || 0,
        grossSales: s.grossSales || netSales,
        discounts: Math.max(0, s.discounts || 0),
        refunds: 0,
        netSales,
        vatRatePercent: (s.vat || 0) > 0 && netSales > 0 ? 7 : 0,
        platformFees,
        actualPayout: Math.max(0, round2(netSales - platformFees)),
        serviceCharge: Math.max(0, s.serviceCharge || 0),
        foodCost: typeof s.totalFoodCost === 'number' ? round2(Math.max(0, s.totalFoodCost)) : undefined,
        packagingCost: typeof s.packagingCost === 'number' ? round2(Math.max(0, s.packagingCost)) : undefined,
        estimatedAllocation: false,
      });
    }
  }

  const byKey = new Map<string, DailySalesRecord>();
  for (const rec of existingManual) {
    byKey.set(`${rec.date}::${normalizeKey(rec.channelId)}`, rec);
  }
  for (const posRec of posRecords) {
    const key = `${posRec.date}::${normalizeKey(posRec.channelId)}`;
    const existing = byKey.get(key);
    if (existing?.replacesPosSync) {
      // Explicit user override ("แทนที่ POS") must not be overwritten by subsequent syncs
      continue;
    }
    byKey.set(key, posRec);
  }

  return Array.from(byKey.values()).sort(
    (a, b) => a.date.localeCompare(b.date) || (a.channelId || '').localeCompare(b.channelId || '')
  );
}
