import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as fbSignOut,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  runTransaction,
  writeBatch,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  getDocFromServer,
  Unsubscribe,
} from 'firebase/firestore';

import firebaseConfig from '../../firebase-applet-config.json';
import {
  SettingsDoc,
  IngredientDoc,
  SubRecipeDoc,
  PackagingDoc,
  DishDoc,
  OptionGroupDoc,
  CategoryDoc,
  ChannelDoc,
  TableDoc,
  ZoneDoc,
  BillDoc,
  ExpenseDoc,
  EmployeeDoc,
  ShiftDoc,
  MemberDoc,
  ImageDoc,
  DailySummaryDoc,
  SyncStatus,
  BillStatus,
  PaymentMethod,
} from '../types';
import { getBusinessWorkDate, roundTo2 } from '../engine/calculations';

// Initialize Firebase App safely so it can never throw at import time
let appInstance: any = null;
let dbInstance: any = null;
let authInstance: any = null;
export let firebaseInitError: string | null = null;

try {
  appInstance = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
} catch (err) {
  firebaseInitError = err instanceof Error ? err.message : String(err);
  console.error('Failed to initialize Firebase App:', err);
}

if (appInstance) {
  try {
    dbInstance = initializeFirestore(
      appInstance,
      {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      },
      firebaseConfig.firestoreDatabaseId
    );
  } catch (cacheErr) {
    console.warn('Persistent cache unavailable, falling back to standard Firestore:', cacheErr);
    try {
      dbInstance = getFirestore(appInstance, firebaseConfig.firestoreDatabaseId);
    } catch {
      try {
        dbInstance = getFirestore(appInstance);
      } catch (finalErr) {
        firebaseInitError = finalErr instanceof Error ? finalErr.message : String(finalErr);
      }
    }
  }

  try {
    authInstance = getAuth(appInstance);
  } catch (authErr) {
    firebaseInitError = authErr instanceof Error ? authErr.message : String(authErr);
    console.error('Failed to get Firebase Auth:', authErr);
  }
}

export const app = appInstance;
export const db = dbInstance;
export const auth = authInstance;

// Test server connection per skill requirements safely
async function testConnection() {
  try {
    if (db) {
      await getDocFromServer(doc(db, 'test', 'connection'));
    }
  } catch (error) {
    // Non-fatal warning if offline
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.warn('Firebase client is currently offline. Operating from persistent local cache.');
    }
  }
}
try {
  testConnection();
} catch {
  // Safe ignore to never block app launch
}

// Standard Error Handler per Firebase Skill specification
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
  };
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path,
  };
  console.error('Firestore Error:', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// ==========================================
// Authentication
// ==========================================

export async function signInWithGoogle(): Promise<User> {
  if (!auth) {
    throw new Error(firebaseInitError || 'Firebase Authentication is not initialized.');
  }
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const result = await signInWithPopup(auth, provider);
  return result.user;
}

export async function signOutOwner(): Promise<void> {
  if (auth) {
    await fbSignOut(auth);
  }
}

export function subscribeAuth(callback: (user: User | null) => void): Unsubscribe {
  if (!auth) {
    callback(null);
    return () => {};
  }
  return onAuthStateChanged(auth, callback);
}

// Current User UID helper
export function getCurrentUid(): string {
  const user = auth?.currentUser;
  if (!user) {
    // If not authenticated, throw so screens catch or redirect
    throw new Error('User is not authenticated.');
  }
  return user.uid;
}

// ==========================================
// Base Collection Paths
// ==========================================
function getColPath(colName: string): string {
  const uid = getCurrentUid();
  return `users/${uid}/${colName}`;
}

// Helper to produce new document timestamps & version
function createMetadata(existingVersion: number = 0) {
  const now = new Date().toISOString();
  return {
    createdAt: now,
    updatedAt: now,
    version: existingVersion + 1,
  };
}

function updateMetadata(existingVersion: number) {
  return {
    updatedAt: new Date().toISOString(),
    version: existingVersion + 1,
  };
}

/**
 * Recursively strips `undefined` properties from objects and arrays before writing to Firestore.
 * Firestore SDK throws "Unsupported field value: undefined" if any field is `undefined`.
 */
export function stripUndefined<T>(value: T): T {
  if (value === null || value === undefined || typeof value !== 'object') {
    return value;
  }
  if (value instanceof Date) {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== undefined)
      .map((item) => stripUndefined(item)) as unknown as T;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    return value;
  }
  const cleaned: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (val !== undefined) {
      cleaned[key] = stripUndefined(val);
    }
  }
  return cleaned as T;
}

// ==========================================
// Default Seed Setup
// ==========================================
export async function initializeDefaultsIfEmpty(): Promise<void> {
  const uid = getCurrentUid();
  const settingsDocRef = doc(db, `users/${uid}/settings/main`);
  const snapshot = await getDoc(settingsDocRef);
  if (snapshot.exists()) {
    return; // Already initialized
  }

  const batch = writeBatch(db);
  const now = new Date().toISOString();

  // Settings
  const defaultSettings: SettingsDoc = {
    id: 'main',
    shopName: 'Kin Cafe & Bistro',
    shopAddress: '123 Sukhumvit Rd, Bangkok, Thailand',
    shopPhone: '02-123-4567',
    taxId: '0105558000000',
    receiptHeader: 'Welcome to Kin Cafe! Have a great meal.',
    receiptFooter: 'Thank you for dining with us. Please come again!',
    targetFoodCostPercent: 30, // 30%
    vatPercent: 7, // 7% VAT
    serviceChargePercent: 10, // 10% Service Charge
    dailyClosingTime: '04:00', // 4 AM cycle
    pointsEarnUnitThb: 100, // 100 THB = 1 Point
    pointsRedeemValueThb: 1, // 1 Point = 1 THB
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
  batch.set(settingsDocRef, defaultSettings);

  // Channels
  const channels: ChannelDoc[] = [
    {
      id: 'dine_in',
      name: 'Dine-In',
      nameTh: 'ทานที่ร้าน',
      type: 'dine_in',
      commissionPercent: 0,
      packagingCost: 0,
      createdAt: now,
      updatedAt: now,
      version: 1,
    },
    {
      id: 'takeaway',
      name: 'Takeaway',
      nameTh: 'สั่งกลับบ้าน',
      type: 'takeaway',
      commissionPercent: 0,
      packagingCost: 5,
      createdAt: now,
      updatedAt: now,
      version: 1,
    },
    {
      id: 'lineman',
      name: 'LINE MAN',
      nameTh: 'ไลน์แมน',
      type: 'delivery',
      commissionPercent: 30,
      packagingCost: 10,
      createdAt: now,
      updatedAt: now,
      version: 1,
    },
    {
      id: 'grab',
      name: 'GrabFood',
      nameTh: 'แกร็บฟู้ด',
      type: 'delivery',
      commissionPercent: 30,
      packagingCost: 10,
      createdAt: now,
      updatedAt: now,
      version: 1,
    },
  ];
  for (const ch of channels) {
    batch.set(doc(db, `users/${uid}/channels/${ch.id}`), ch);
  }

  // Categories
  const categories: CategoryDoc[] = [
    { id: 'cat_main', name: 'Main Dishes', nameTh: 'อาหารจานหลัก', order: 1, createdAt: now, updatedAt: now, version: 1 },
    { id: 'cat_app', name: 'Appetizers', nameTh: 'ของทานเล่น', order: 2, createdAt: now, updatedAt: now, version: 1 },
    { id: 'cat_drink', name: 'Beverages', nameTh: 'เครื่องดื่ม', order: 3, createdAt: now, updatedAt: now, version: 1 },
    { id: 'cat_dessert', name: 'Desserts', nameTh: 'ของหวาน', order: 4, createdAt: now, updatedAt: now, version: 1 },
  ];
  for (const cat of categories) {
    batch.set(doc(db, `users/${uid}/categories/${cat.id}`), cat);
  }

  // Zone & Tables
  const defaultZone: ZoneDoc = {
    id: 'zone_main',
    name: 'Indoor Dining',
    nameTh: 'ห้องแอร์ในร้าน',
    order: 1,
    createdAt: now,
    updatedAt: now,
    version: 1,
  };
  batch.set(doc(db, `users/${uid}/zones/zone_main`), defaultZone);

  const defaultTables: TableDoc[] = [
    { id: 't1', name: 'T1', zoneId: 'zone_main', shape: 'square', chairs: 2, x: 60, y: 80, createdAt: now, updatedAt: now, version: 1 },
    { id: 't2', name: 'T2', zoneId: 'zone_main', shape: 'square', chairs: 4, x: 200, y: 80, createdAt: now, updatedAt: now, version: 1 },
    { id: 't3', name: 'T3', zoneId: 'zone_main', shape: 'rectangle', chairs: 6, x: 340, y: 80, createdAt: now, updatedAt: now, version: 1 },
    { id: 't4', name: 'T4', zoneId: 'zone_main', shape: 'round', chairs: 4, x: 120, y: 220, createdAt: now, updatedAt: now, version: 1 },
    { id: 't5', name: 'T5', zoneId: 'zone_main', shape: 'square', chairs: 4, x: 280, y: 220, createdAt: now, updatedAt: now, version: 1 },
  ];
  for (const tbl of defaultTables) {
    batch.set(doc(db, `users/${uid}/tables/${tbl.id}`), tbl);
  }

  // Sample Ingredients for instant food costing
  const sampleIngredients: IngredientDoc[] = [
    {
      id: 'ing_pork',
      name: 'Pork Tenderloin',
      nameTh: 'เนื้อหมูสันใน',
      purchaseUnit: 'kg',
      purchasePrice: 180,
      purchaseQuantity: 1,
      yieldPercent: 85,
      baseUnit: 'g',
      costPerBaseUnit: 180 / (1000 * 0.85), // ~0.2118 THB/g
      createdAt: now,
      updatedAt: now,
      version: 1,
    },
    {
      id: 'ing_chicken',
      name: 'Chicken Breast',
      nameTh: 'อกไก่',
      purchaseUnit: 'kg',
      purchasePrice: 95,
      purchaseQuantity: 1,
      yieldPercent: 90,
      baseUnit: 'g',
      costPerBaseUnit: 95 / (1000 * 0.9), // ~0.1056 THB/g
      createdAt: now,
      updatedAt: now,
      version: 1,
    },
    {
      id: 'ing_rice',
      name: 'Jasmine Rice',
      nameTh: 'ข้าวหอมมะลิ',
      purchaseUnit: 'kg',
      purchasePrice: 42,
      purchaseQuantity: 1,
      yieldPercent: 220, // Cooked rice yield ~ 2.2x
      baseUnit: 'g',
      costPerBaseUnit: 42 / (1000 * 2.2), // ~0.019 THB/g
      createdAt: now,
      updatedAt: now,
      version: 1,
    },
    {
      id: 'ing_egg',
      name: 'Fresh Egg',
      nameTh: 'ไข่ไก่',
      purchaseUnit: 'pack',
      purchasePrice: 120,
      purchaseQuantity: 30, // 30 eggs
      yieldPercent: 100,
      baseUnit: 'piece',
      costPerBaseUnit: 4.0, // 4 THB / egg
      createdAt: now,
      updatedAt: now,
      version: 1,
    },
    {
      id: 'ing_oil',
      name: 'Cooking Oil',
      nameTh: 'น้ำมันพืช',
      purchaseUnit: 'l',
      purchasePrice: 55,
      purchaseQuantity: 1,
      yieldPercent: 100,
      baseUnit: 'ml',
      costPerBaseUnit: 0.055,
      createdAt: now,
      updatedAt: now,
      version: 1,
    },
  ];
  for (const ing of sampleIngredients) {
    batch.set(doc(db, `users/${uid}/ingredients/${ing.id}`), ing);
  }

  // Sample Dishes
  const sampleDishes: DishDoc[] = [
    {
      id: 'dish_pad_kaprao',
      name: 'Pad Kaprao with Rice',
      nameTh: 'ข้าวกะเพราราดข้าว',
      categoryId: 'cat_main',
      order: 1,
      optionGroupIds: [],
      variants: [
        {
          id: 'var_pork',
          name: 'Pork',
          nameTh: 'หมู',
          price: 70,
          ingredients: [
            { ingredientId: 'ing_pork', quantity: 120 }, // 120g pork
            { ingredientId: 'ing_rice', quantity: 180 }, // 180g rice
            { ingredientId: 'ing_oil', quantity: 15 }, // 15ml oil
          ],
          subRecipes: [],
          packaging: [],
        },
        {
          id: 'var_chicken',
          name: 'Chicken',
          nameTh: 'ไก่',
          price: 65,
          ingredients: [
            { ingredientId: 'ing_chicken', quantity: 130 },
            { ingredientId: 'ing_rice', quantity: 180 },
            { ingredientId: 'ing_oil', quantity: 15 },
          ],
          subRecipes: [],
          packaging: [],
        },
      ],
      createdAt: now,
      updatedAt: now,
      version: 1,
    },
  ];
  for (const dish of sampleDishes) {
    batch.set(doc(db, `users/${uid}/dishes/${dish.id}`), dish);
  }

  await batch.commit();
}

// ==========================================
// Settings Operations
// ==========================================
export async function getSettings(): Promise<SettingsDoc> {
  const uid = getCurrentUid();
  const ref = doc(db, `users/${uid}/settings/main`);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await initializeDefaultsIfEmpty();
      const fresh = await getDoc(ref);
      return fresh.data() as SettingsDoc;
    }
    return snap.data() as SettingsDoc;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, ref.path);
  }
}

export async function updateSettings(settings: Partial<SettingsDoc>, expectedVersion: number): Promise<void> {
  const uid = getCurrentUid();
  const ref = doc(db, `users/${uid}/settings/main`);
  try {
    await runTransaction(db, async (txn) => {
      const snap = await txn.get(ref);
      if (snap.exists()) {
        const currentVersion = snap.data().version || 1;
        if (currentVersion !== expectedVersion) {
          throw new Error('VERSION_CONFLICT');
        }
      }
      txn.set(
        ref,
        stripUndefined({
          ...settings,
          ...updateMetadata(expectedVersion),
        }),
        { merge: true }
      );
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'VERSION_CONFLICT') {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, ref.path);
  }
}

// ==========================================
// Generic CRUD with Optimistic Concurrency
// ==========================================
export async function fetchCollection<T>(collectionName: string): Promise<T[]> {
  const path = getColPath(collectionName);
  const colRef = collection(db, path);
  try {
    const snapshot = await getDocs(colRef);
    return snapshot.docs.map((d) => d.data() as T);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function saveDocument<T extends { id: string; version: number }>(
  collectionName: string,
  docData: T,
  isNew: boolean
): Promise<void> {
  const path = `${getColPath(collectionName)}/${docData.id}`;
  const docRef = doc(db, path);

  try {
    if (isNew) {
      const newDoc = stripUndefined({
        ...docData,
        ...createMetadata(0),
      });
      await setDoc(docRef, newDoc);
    } else {
      // Optimistic concurrency check
      await runTransaction(db, async (txn) => {
        const snap = await txn.get(docRef);
        if (snap.exists()) {
          const currentVersion = snap.data().version || 0;
          if (currentVersion !== docData.version) {
            throw new Error('VERSION_CONFLICT');
          }
        }
        const updatedDoc = stripUndefined({
          ...docData,
          ...updateMetadata(docData.version),
        });
        txn.set(docRef, updatedDoc);
      });
    }
  } catch (error) {
    if (error instanceof Error && error.message === 'VERSION_CONFLICT') {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function deleteDocument(collectionName: string, docId: string): Promise<void> {
  const path = `${getColPath(collectionName)}/${docId}`;
  const docRef = doc(db, path);
  try {
    await deleteDoc(docRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// ==========================================
// Realtime Listeners for Tables and Open Bills
// ==========================================
export function subscribeTables(
  onData: (tables: TableDoc[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  if (!auth.currentUser) {
    return () => {};
  }
  const path = getColPath('tables');
  const q = collection(db, path);
  return onSnapshot(
    q,
    (snap) => {
      const tables = snap.docs.map((d) => d.data() as TableDoc);
      onData(tables);
    },
    (err) => {
      console.error('Tables listener error:', err);
      onError?.(err);
      handleFirestoreError(err, OperationType.LIST, path);
    }
  );
}

export function subscribeOpenBills(
  onData: (bills: BillDoc[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  if (!auth?.currentUser || !db) {
    return () => {};
  }
  const path = getColPath('bills');
  const q = query(collection(db, path), where('status', '==', 'saved'));
  return onSnapshot(
    q,
    (snap) => {
      const bills = snap.docs.map((d) => d.data() as BillDoc);
      onData(bills);
    },
    (err) => {
      console.error('Open bills listener error:', err);
      onError?.(err);
      handleFirestoreError(err, OperationType.LIST, path);
    }
  );
}

// ==========================================
// Universal Realtime Listeners for All Collections & Settings
// ==========================================
export function subscribeCollection<T>(
  collectionName: string,
  onData: (items: T[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  if (!auth?.currentUser || !db) {
    return () => {};
  }
  const path = getColPath(collectionName);
  const colRef = collection(db, path);
  return onSnapshot(
    colRef,
    (snap) => {
      const items = snap.docs.map((d) => ({ ...d.data(), id: d.id }) as T);
      onData(items);
    },
    (err) => {
      console.error(`Realtime listener error (${collectionName}):`, err);
      onError?.(err);
      handleFirestoreError(err, OperationType.LIST, path);
    }
  );
}

export function subscribeDocument<T>(
  collectionName: string,
  docId: string,
  onData: (data: T | null) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  if (!auth?.currentUser || !db || !docId) {
    return () => {};
  }
  const path = `${getColPath(collectionName)}/${docId}`;
  const docRef = doc(db, path);
  return onSnapshot(
    docRef,
    (snap) => {
      if (snap.exists()) {
        onData({ ...snap.data(), id: snap.id } as T);
      } else {
        onData(null);
      }
    },
    (err) => {
      console.error(`Realtime doc listener error (${path}):`, err);
      onError?.(err);
      handleFirestoreError(err, OperationType.GET, path);
    }
  );
}

export function subscribeSettings(
  onData: (settings: SettingsDoc) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  if (!auth?.currentUser || !db) {
    return () => {};
  }
  const uid = getCurrentUid();
  const path = `users/${uid}/settings/main`;
  const ref = doc(db, path);
  let initializing = false;

  return onSnapshot(
    ref,
    async (snap) => {
      if (snap.exists()) {
        onData(snap.data() as SettingsDoc);
      } else if (!initializing) {
        initializing = true;
        try {
          await initializeDefaultsIfEmpty();
        } catch (err) {
          onError?.(err instanceof Error ? err : new Error(String(err)));
        }
      }
    },
    (err) => {
      console.error('Settings listener error:', err);
      onError?.(err);
      handleFirestoreError(err, OperationType.GET, path);
    }
  );
}

// ==========================================
// Images Store
// ==========================================
export async function saveImageDoc(imageId: string, dataUrl: string, sizeBytes: number): Promise<string> {
  const path = `${getColPath('images')}/${imageId}`;
  const ref = doc(db, path);
  const imageDoc: ImageDoc = {
    id: imageId,
    dataUrl,
    sizeBytes,
    ...createMetadata(0),
  };
  try {
    await setDoc(ref, stripUndefined(imageDoc));
    return imageId;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function getImageDoc(imageId: string): Promise<ImageDoc | null> {
  if (!imageId) return null;
  const path = `${getColPath('images')}/${imageId}`;
  const ref = doc(db, path);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    return snap.data() as ImageDoc;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

// ==========================================
// Atomic Bill Number Generation via Counter
// ==========================================
export async function generateNextBillNumber(workDate: string): Promise<string> {
  const uid = getCurrentUid();
  const counterRef = doc(db, `users/${uid}/counters/bills`);
  const cleanDate = workDate.replace(/-/g, '');

  try {
    return await runTransaction(db, async (txn) => {
      const snap = await txn.get(counterRef);
      let nextCount = 1;

      if (snap.exists()) {
        const data = snap.data();
        if (data.workDate === workDate) {
          nextCount = (data.count || 0) + 1;
        }
      }

      txn.set(
        counterRef,
        stripUndefined({
          id: 'bills',
          workDate,
          count: nextCount,
          ...updateMetadata(snap.exists() ? snap.data().version || 0 : 0),
        })
      );

      const padded = String(nextCount).padStart(4, '0');
      return `B-${cleanDate}-${padded}`;
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, counterRef.path);
  }
}

// ==========================================
// Atomic Order Saving & Table Binding
// ==========================================
export async function saveOrderToTableAtomic(
  billData: BillDoc,
  tableId: string | null
): Promise<BillDoc> {
  const uid = getCurrentUid();
  const isNew = !billData.billNumber;
  const billNumber = isNew ? await generateNextBillNumber(billData.workDate) : billData.billNumber;
  const billId = billData.id || `bill_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const billRef = doc(db, `users/${uid}/bills/${billId}`);

  try {
    await runTransaction(db, async (txn) => {
      // 1. Check existing bill version if updating
      let existingVersion = 0;
      if (!isNew) {
        const billSnap = await txn.get(billRef);
        if (billSnap.exists()) {
          existingVersion = billSnap.data().version || 0;
          if (billData.version && existingVersion !== billData.version) {
            throw new Error('VERSION_CONFLICT');
          }
        }
      }

      // 2. If table is specified, update table.currentBillId
      if (tableId) {
        const tableRef = doc(db, `users/${uid}/tables/${tableId}`);
        const tableSnap = await txn.get(tableRef);
        if (tableSnap.exists()) {
          txn.update(
            tableRef,
            stripUndefined({
              currentBillId: billId,
              updatedAt: new Date().toISOString(),
              version: (tableSnap.data().version || 0) + 1,
            })
          );
        }
      }

      // 3. Write bill document
      const completeBill: BillDoc = stripUndefined({
        ...billData,
        id: billId,
        billNumber,
        status: 'saved',
        tableId: tableId || null,
        ...(isNew ? createMetadata(0) : updateMetadata(existingVersion)),
      });
      txn.set(billRef, completeBill);
    });

    return {
      ...billData,
      id: billId,
      billNumber,
      status: 'saved',
      tableId: tableId || null,
      version: (billData.version || 0) + 1,
    };
  } catch (error) {
    if (error instanceof Error && error.message === 'VERSION_CONFLICT') {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, billRef.path);
  }
}

// ==========================================
// Atomic Settlement: Pay Bill, Free Table & Update Daily Summary
// ==========================================
export async function payBillAtomic(
  bill: BillDoc,
  payments: BillDoc['payments']
): Promise<void> {
  const uid = getCurrentUid();
  const billRef = doc(db, `users/${uid}/bills/${bill.id}`);
  const summaryRef = doc(db, `users/${uid}/dailySummaries/${bill.workDate}`);
  const tableRef = bill.tableId ? doc(db, `users/${uid}/tables/${bill.tableId}`) : null;

  try {
    await runTransaction(db, async (txn) => {
      // 1. Verify bill state and version
      const billSnap = await txn.get(billRef);
      if (!billSnap.exists()) {
        throw new Error('Bill does not exist');
      }
      const currentBillData = billSnap.data() as BillDoc;
      if (currentBillData.status === 'paid') {
        throw new Error('Bill is already paid');
      }
      if (bill.version && currentBillData.version !== bill.version) {
        throw new Error('VERSION_CONFLICT');
      }

      // 2. Get existing daily summary or prepare empty baseline
      const summarySnap = await txn.get(summaryRef);
      let summary: DailySummaryDoc;

      if (summarySnap.exists()) {
        summary = summarySnap.data() as DailySummaryDoc;
      } else {
        const now = new Date().toISOString();
        summary = {
          id: bill.workDate,
          date: bill.workDate,
          orderCount: 0,
          grossSales: 0,
          discounts: 0,
          netSales: 0,
          serviceCharge: 0,
          vat: 0,
          totalFoodCost: 0,
          packagingCost: 0,
          platformFees: 0,
          paymentTotals: {
            cash: 0,
            qr: 0,
            card: 0,
            transfer: 0,
          },
          channelTotals: {},
          dishStats: {},
          createdAt: now,
          updatedAt: now,
          version: 1,
        };
      }

      // 3. Accumulate bill values into daily summary
      summary.orderCount += 1;
      summary.grossSales = roundTo2(summary.grossSales + bill.subtotal);
      summary.discounts = roundTo2(summary.discounts + bill.discountAmount);
      summary.netSales = roundTo2(summary.netSales + bill.netSales);
      summary.serviceCharge = roundTo2(summary.serviceCharge + bill.serviceChargeAmount);
      summary.vat = roundTo2(summary.vat + bill.vatAmount);
      summary.totalFoodCost = roundTo2(summary.totalFoodCost + bill.totalFoodCost);
      summary.packagingCost = roundTo2(summary.packagingCost + bill.packagingCost);
      summary.platformFees = roundTo2(summary.platformFees + bill.platformFee);

      // Payment methods breakdown
      for (const p of payments) {
        const currentMethodTotal = summary.paymentTotals[p.method] || 0;
        summary.paymentTotals[p.method] = roundTo2(currentMethodTotal + p.amount);
      }

      // Channel totals breakdown
      const chKey = bill.channelId || 'other';
      if (!summary.channelTotals[chKey]) {
        summary.channelTotals[chKey] = { orderCount: 0, netSales: 0 };
      }
      summary.channelTotals[chKey].orderCount += 1;
      summary.channelTotals[chKey].netSales = roundTo2(
        summary.channelTotals[chKey].netSales + bill.netSales
      );

      // Per-dish quantity & revenue stats
      for (const item of bill.items) {
        const dishId = item.dishId;
        const qty = item.quantity || 1;
        const itemRevenue = roundTo2(item.unitPrice * qty);
        const unitFoodCost = item.foodCostSnapshot ?? item.totalUnitCostSnapshot;
        const itemCost = roundTo2(unitFoodCost * qty);

        if (!summary.dishStats[dishId]) {
          summary.dishStats[dishId] = {
            dishId,
            dishName: item.dishName,
            quantity: 0,
            revenue: 0,
            cost: 0,
          };
        }
        summary.dishStats[dishId].quantity += qty;
        summary.dishStats[dishId].revenue = roundTo2(summary.dishStats[dishId].revenue + itemRevenue);
        summary.dishStats[dishId].cost = roundTo2(summary.dishStats[dishId].cost + itemCost);
      }

      summary.updatedAt = new Date().toISOString();
      summary.version = (summary.version || 0) + 1;

      // 4. Update Bill to 'paid'
      const nowIso = new Date().toISOString();
      txn.update(
        billRef,
        stripUndefined({
          status: 'paid',
          payments,
          paidAt: nowIso,
          updatedAt: nowIso,
          version: (currentBillData.version || 0) + 1,
        })
      );

      // 5. Update Daily Summary document atomically
      txn.set(summaryRef, stripUndefined(summary));

      // 6. If table attached, free the table atomically
      if (tableRef) {
        const tableSnap = await txn.get(tableRef);
        if (tableSnap.exists()) {
          txn.update(
            tableRef,
            stripUndefined({
              currentBillId: null,
              updatedAt: nowIso,
              version: (tableSnap.data().version || 0) + 1,
            })
          );
        }
      }

      // 7. Member points update if applicable
      if (bill.memberId) {
        const memberRef = doc(db, `users/${uid}/members/${bill.memberId}`);
        const memberSnap = await txn.get(memberRef);
        if (memberSnap.exists()) {
          const mem = memberSnap.data() as MemberDoc;
          const newPoints = Math.max(0, mem.points - (bill.pointsRedeemed || 0) + (bill.pointsEarned || 0));
          txn.update(
            memberRef,
            stripUndefined({
              points: newPoints,
              totalSpent: roundTo2((mem.totalSpent || 0) + bill.netSales),
              visitCount: (mem.visitCount || 0) + 1,
              updatedAt: nowIso,
              version: (mem.version || 0) + 1,
            })
          );
        }
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'VERSION_CONFLICT') {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, billRef.path);
  }
}

// ==========================================
// Atomic Void Bill: Excludes from Reports & Updates Summary
// ==========================================
export async function voidBillAtomic(
  billId: string,
  voidReason: string
): Promise<void> {
  const uid = getCurrentUid();
  const billRef = doc(db, `users/${uid}/bills/${billId}`);

  try {
    await runTransaction(db, async (txn) => {
      const billSnap = await txn.get(billRef);
      if (!billSnap.exists()) {
        throw new Error('Bill not found');
      }
      const bill = billSnap.data() as BillDoc;
      if (bill.status === 'voided') {
        throw new Error('Bill is already voided');
      }

      const nowIso = new Date().toISOString();

      // If bill was already paid, we must deduct it from daily summary in the same transaction
      if (bill.status === 'paid') {
        const summaryRef = doc(db, `users/${uid}/dailySummaries/${bill.workDate}`);
        const summarySnap = await txn.get(summaryRef);
        if (summarySnap.exists()) {
          const summary = summarySnap.data() as DailySummaryDoc;

          summary.orderCount = Math.max(0, summary.orderCount - 1);
          summary.grossSales = roundTo2(Math.max(0, summary.grossSales - bill.subtotal));
          summary.discounts = roundTo2(Math.max(0, summary.discounts - bill.discountAmount));
          summary.netSales = roundTo2(Math.max(0, summary.netSales - bill.netSales));
          summary.serviceCharge = roundTo2(Math.max(0, summary.serviceCharge - bill.serviceChargeAmount));
          summary.vat = roundTo2(Math.max(0, summary.vat - bill.vatAmount));
          summary.totalFoodCost = roundTo2(Math.max(0, summary.totalFoodCost - bill.totalFoodCost));
          summary.packagingCost = roundTo2(Math.max(0, summary.packagingCost - bill.packagingCost));
          summary.platformFees = roundTo2(Math.max(0, summary.platformFees - bill.platformFee));

          // Deduct payment methods
          for (const p of bill.payments || []) {
            if (summary.paymentTotals[p.method]) {
              summary.paymentTotals[p.method] = roundTo2(
                Math.max(0, summary.paymentTotals[p.method] - p.amount)
              );
            }
          }

          // Deduct channel
          const chKey = bill.channelId || 'other';
          if (summary.channelTotals[chKey]) {
            summary.channelTotals[chKey].orderCount = Math.max(0, summary.channelTotals[chKey].orderCount - 1);
            summary.channelTotals[chKey].netSales = roundTo2(
              Math.max(0, summary.channelTotals[chKey].netSales - bill.netSales)
            );
          }

          // Deduct dish stats
          for (const item of bill.items) {
            const dishId = item.dishId;
            const qty = item.quantity || 1;
            if (summary.dishStats[dishId]) {
              summary.dishStats[dishId].quantity = Math.max(0, summary.dishStats[dishId].quantity - qty);
              summary.dishStats[dishId].revenue = roundTo2(
                Math.max(0, summary.dishStats[dishId].revenue - item.unitPrice * qty)
              );
              const unitFoodCost = item.foodCostSnapshot ?? item.totalUnitCostSnapshot;
              summary.dishStats[dishId].cost = roundTo2(
                Math.max(0, summary.dishStats[dishId].cost - unitFoodCost * qty)
              );
            }
          }

          summary.updatedAt = nowIso;
          summary.version = (summary.version || 0) + 1;
          txn.set(summaryRef, stripUndefined(summary));
        }
      }

      // If attached to a table, free the table
      if (bill.tableId) {
        const tableRef = doc(db, `users/${uid}/tables/${bill.tableId}`);
        const tableSnap = await txn.get(tableRef);
        if (tableSnap.exists() && tableSnap.data().currentBillId === billId) {
          txn.update(
            tableRef,
            stripUndefined({
              currentBillId: null,
              updatedAt: nowIso,
              version: (tableSnap.data().version || 0) + 1,
            })
          );
        }
      }

      // Update bill to voided
      txn.update(
        billRef,
        stripUndefined({
          status: 'voided',
          voidReason,
          voidedAt: nowIso,
          updatedAt: nowIso,
          version: (bill.version || 0) + 1,
        })
      );
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, billRef.path);
  }
}

// ==========================================
// Cheap Read Paged Queries for Bills & History
// ==========================================
export async function fetchBillsWithFilter(options: {
  status?: BillStatus | 'all';
  startDate?: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  limitCount?: number;
}): Promise<BillDoc[]> {
  const path = getColPath('bills');
  const constraints = [];

  if (options.status && options.status !== 'all') {
    constraints.push(where('status', '==', options.status));
  }

  if (options.startDate && options.endDate) {
    if (options.startDate === options.endDate) {
      constraints.push(where('workDate', '==', options.startDate));
    } else {
      constraints.push(where('workDate', '>=', options.startDate));
      constraints.push(where('workDate', '<=', options.endDate));
    }
  }

  // Cost-effective order by workDate and limit
  constraints.push(orderBy('workDate', 'desc'));
  constraints.push(limit(options.limitCount || 50));

  const q = query(collection(db, path), ...constraints);
  try {
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as BillDoc);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

// ==========================================
// Reports & P&L Queries (Read ONLY Daily Summaries + Expenses + Employees)
// ==========================================
export async function fetchDailySummariesInRange(
  startDate: string,
  endDate: string
): Promise<DailySummaryDoc[]> {
  const path = getColPath('dailySummaries');
  const q = query(
    collection(db, path),
    where('date', '>=', startDate),
    where('date', '<=', endDate),
    orderBy('date', 'asc')
  );
  try {
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data() as DailySummaryDoc);
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function fetchSingleDailySummary(date: string): Promise<DailySummaryDoc | null> {
  const path = `${getColPath('dailySummaries')}/${date}`;
  const ref = doc(db, path);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    return snap.data() as DailySummaryDoc;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export function subscribeBillsWithFilter(
  options: {
    status?: BillStatus | 'all';
    startDate?: string;
    endDate?: string;
    limitCount?: number;
  },
  onData: (bills: BillDoc[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  if (!auth?.currentUser || !db) {
    return () => {};
  }
  const path = getColPath('bills');
  const constraints = [];

  if (options.status && options.status !== 'all') {
    constraints.push(where('status', '==', options.status));
  }

  if (options.startDate && options.endDate) {
    if (options.startDate === options.endDate) {
      constraints.push(where('workDate', '==', options.startDate));
    } else {
      constraints.push(where('workDate', '>=', options.startDate));
      constraints.push(where('workDate', '<=', options.endDate));
    }
  }

  constraints.push(orderBy('workDate', 'desc'));
  constraints.push(limit(options.limitCount || 50));

  const q = query(collection(db, path), ...constraints);
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => d.data() as BillDoc));
    },
    (err) => {
      console.error('Bills filter listener error:', err);
      onError?.(err);
      handleFirestoreError(err, OperationType.LIST, path);
    }
  );
}

export function subscribeDailySummariesInRange(
  startDate: string,
  endDate: string,
  onData: (summaries: DailySummaryDoc[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  if (!auth?.currentUser || !db) {
    return () => {};
  }
  const path = getColPath('dailySummaries');
  const q = query(
    collection(db, path),
    where('date', '>=', startDate),
    where('date', '<=', endDate),
    orderBy('date', 'asc')
  );
  return onSnapshot(
    q,
    (snap) => {
      onData(snap.docs.map((d) => d.data() as DailySummaryDoc));
    },
    (err) => {
      console.error('Daily summaries range listener error:', err);
      onError?.(err);
      handleFirestoreError(err, OperationType.LIST, path);
    }
  );
}

export function subscribeSingleDailySummary(
  date: string,
  onData: (summary: DailySummaryDoc | null) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  if (!auth?.currentUser || !db || !date) {
    return () => {};
  }
  const path = `${getColPath('dailySummaries')}/${date}`;
  const ref = doc(db, path);
  return onSnapshot(
    ref,
    (snap) => {
      onData(snap.exists() ? (snap.data() as DailySummaryDoc) : null);
    },
    (err) => {
      console.error('Single daily summary listener error:', err);
      onError?.(err);
      handleFirestoreError(err, OperationType.GET, path);
    }
  );
}

// ==========================================
// Rebuild Summaries from Real Bills & Consistency Check
// ==========================================
export async function rebuildSummariesFromBills(): Promise<{
  rebuiltCount: number;
  dates: string[];
}> {
  const uid = getCurrentUid();
  const billsPath = getColPath('bills');
  const billsSnap = await getDocs(collection(db, billsPath));
  const paidBills = billsSnap.docs
    .map((d) => d.data() as BillDoc)
    .filter((b) => b.status === 'paid');

  // Group paid bills by workDate
  const byDate = new Map<string, BillDoc[]>();
  for (const bill of paidBills) {
    const d = bill.workDate;
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d)!.push(bill);
  }

  const batch = writeBatch(db);
  const rebuiltDates: string[] = [];

  for (const [date, bills] of byDate.entries()) {
    rebuiltDates.push(date);
    const summaryRef = doc(db, `users/${uid}/dailySummaries/${date}`);

    const summary: DailySummaryDoc = {
      id: date,
      date,
      orderCount: bills.length,
      grossSales: 0,
      discounts: 0,
      netSales: 0,
      serviceCharge: 0,
      vat: 0,
      totalFoodCost: 0,
      packagingCost: 0,
      platformFees: 0,
      paymentTotals: { cash: 0, qr: 0, card: 0, transfer: 0 },
      channelTotals: {},
      dishStats: {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
    };

    for (const bill of bills) {
      summary.grossSales = roundTo2(summary.grossSales + bill.subtotal);
      summary.discounts = roundTo2(summary.discounts + bill.discountAmount);
      summary.netSales = roundTo2(summary.netSales + bill.netSales);
      summary.serviceCharge = roundTo2(summary.serviceCharge + bill.serviceChargeAmount);
      summary.vat = roundTo2(summary.vat + bill.vatAmount);
      summary.totalFoodCost = roundTo2(summary.totalFoodCost + bill.totalFoodCost);
      summary.packagingCost = roundTo2(summary.packagingCost + bill.packagingCost);
      summary.platformFees = roundTo2(summary.platformFees + bill.platformFee);

      for (const p of bill.payments || []) {
        summary.paymentTotals[p.method] = roundTo2((summary.paymentTotals[p.method] || 0) + p.amount);
      }

      const chKey = bill.channelId || 'other';
      if (!summary.channelTotals[chKey]) {
        summary.channelTotals[chKey] = { orderCount: 0, netSales: 0 };
      }
      summary.channelTotals[chKey].orderCount += 1;
      summary.channelTotals[chKey].netSales = roundTo2(
        summary.channelTotals[chKey].netSales + bill.netSales
      );

      for (const item of bill.items) {
        const dishId = item.dishId;
        const qty = item.quantity || 1;
        if (!summary.dishStats[dishId]) {
          summary.dishStats[dishId] = {
            dishId,
            dishName: item.dishName,
            quantity: 0,
            revenue: 0,
            cost: 0,
          };
        }
        summary.dishStats[dishId].quantity += qty;
        summary.dishStats[dishId].revenue = roundTo2(
          summary.dishStats[dishId].revenue + item.unitPrice * qty
        );
        const unitFoodCost = item.foodCostSnapshot ?? item.totalUnitCostSnapshot;
        summary.dishStats[dishId].cost = roundTo2(
          summary.dishStats[dishId].cost + unitFoodCost * qty
        );
      }
    }

    batch.set(summaryRef, stripUndefined(summary));
  }

  await batch.commit();
  return { rebuiltCount: rebuiltDates.length, dates: rebuiltDates };
}

export async function auditSummariesAgainstBills(): Promise<{
  isMatch: boolean;
  discrepantDates: string[];
}> {
  const uid = getCurrentUid();
  const billsSnap = await getDocs(collection(db, getColPath('bills')));
  const summariesSnap = await getDocs(collection(db, getColPath('dailySummaries')));

  const paidBills = billsSnap.docs
    .map((d) => d.data() as BillDoc)
    .filter((b) => b.status === 'paid');

  const summaries = new Map<string, DailySummaryDoc>();
  summariesSnap.docs.forEach((d) => {
    summaries.set(d.id, d.data() as DailySummaryDoc);
  });

  const billsByDate = new Map<string, number>();
  for (const b of paidBills) {
    billsByDate.set(b.workDate, roundTo2((billsByDate.get(b.workDate) || 0) + b.netSales));
  }

  const discrepantDates: string[] = [];

  for (const [date, billTotal] of billsByDate.entries()) {
    const summary = summaries.get(date);
    if (!summary || Math.abs(summary.netSales - billTotal) > 0.05) {
      discrepantDates.push(date);
    }
  }

  return {
    isMatch: discrepantDates.length === 0,
    discrepantDates,
  };
}

// ==========================================
// Full JSON Backup Export & Import
// ==========================================
export async function exportFullDatabase(): Promise<Record<string, unknown>> {
  const collectionsToExport = [
    'settings',
    'ingredients',
    'subRecipes',
    'packaging',
    'dishes',
    'optionGroups',
    'categories',
    'channels',
    'tables',
    'zones',
    'bills',
    'expenses',
    'employees',
    'shifts',
    'members',
    'images',
    'dailySummaries',
    'counters',
  ];

  const backupData: Record<string, unknown> = {
    exportedAt: new Date().toISOString(),
    version: '1.0',
  };

  for (const colName of collectionsToExport) {
    const docs = await fetchCollection<unknown>(colName);
    backupData[colName] = docs;
  }

  return backupData;
}

export async function importFullDatabase(backupData: Record<string, unknown>): Promise<void> {
  const uid = getCurrentUid();
  const collectionsToImport = [
    'settings',
    'ingredients',
    'subRecipes',
    'packaging',
    'dishes',
    'optionGroups',
    'categories',
    'channels',
    'tables',
    'zones',
    'bills',
    'expenses',
    'employees',
    'shifts',
    'members',
    'images',
    'dailySummaries',
    'counters',
  ];

  for (const colName of collectionsToImport) {
    const list = backupData[colName];
    if (Array.isArray(list)) {
      // Chunk writes into batches of 400
      let batch = writeBatch(db);
      let count = 0;

      for (const item of list) {
        if (item && typeof item === 'object' && 'id' in item) {
          const docRef = doc(db, `users/${uid}/${colName}/${item.id}`);
          batch.set(docRef, stripUndefined(item));
          count++;
          if (count >= 400) {
            await batch.commit();
            batch = writeBatch(db);
            count = 0;
          }
        }
      }
      if (count > 0) {
        await batch.commit();
      }
    }
  }
}
