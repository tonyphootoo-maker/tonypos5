import * as XLSX from 'xlsx';
import {
  Ingredient,
  Sauce,
  MenuItem,
  RestaurantSettings,
  Supplier,
  ExpenseRecord,
  SaleOrder,
  InventoryItem,
  InventoryTransaction,
  WasteRecord,
  PurchaseRecord,
  PriceHistoryRecord,
  YieldTestRecord,
  Employee,
  PackagingItem,
  AppBackupPackage,
} from '../types';
import {
  INITIAL_SETTINGS,
  INITIAL_SUPPLIERS,
  INITIAL_INGREDIENTS,
  INITIAL_SAUCES,
  INITIAL_MENUS,
  INITIAL_INVENTORY,
  INITIAL_EXPENSES,
  INITIAL_SALES_ORDERS,
  INITIAL_WASTE_LOG,
} from '../data/initialData';
import { calculateIngredientCost } from './calculationEngine';
import { generateId, generateOrderNumber } from '../utils/id';

export { generateId, generateOrderNumber };

import { calculateTotalMonthlyExpenses, calculateNormalizedNetSales, calculateOverheadRatePercent } from '../engine/calculations';
import { DailySalesRecord } from '../types/domain';

const STORAGE_KEYS = {
  SETTINGS: 'tonys_settings_v1',
  INGREDIENTS: 'tonys_ingredients_v1',
  SAUCES: 'tonys_sauces_v1',
  MENUS: 'tonys_menus_v1',
  SUPPLIERS: 'tonys_suppliers_v1',
  INVENTORY: 'tonys_inventory_v1',
  INVENTORY_TXNS: 'tonys_inventory_txns_v1',
  PURCHASES: 'tonys_purchases_v1',
  PRICE_HISTORY: 'tonys_price_history_v1',
  EXPENSES: 'tonys_expenses_v1',
  SALES: 'tonys_sales_v1',
  DAILY_SALES: 'tonys_daily_sales_v1',
  WASTE: 'tonys_waste_v1',
  YIELD_TESTS: 'tonys_yield_tests_v1',
  EMPLOYEES: 'tonys_employees_v1',
  PACKAGING: 'tonys_packaging_v1',
  LAST_BACKUP: 'tonys_last_backup_time',
  OVERHEAD_COMPAT: 'tonys-kitchen-overhead-v1',
};

function safeLoad<T>(key: string, fallback: T): T {
  try {
    if (typeof localStorage === 'undefined') return fallback;
    const item = localStorage.getItem(key);
    if (!item) return fallback;
    return JSON.parse(item);
  } catch (err) {
    console.error(`Error loading key ${key}:`, err);
    return fallback;
  }
}

function safeSave<T>(key: string, data: T): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, JSON.stringify(data));
  } catch (err) {
    console.error(`Error saving key ${key}:`, err);
  }
}

export function migrateSettings(rawSettings: any): RestaurantSettings {
  if (!rawSettings || typeof rawSettings !== 'object') {
    return { ...INITIAL_SETTINGS };
  }

  const vatRate = typeof rawSettings.vatRatePercent === 'number' && Number.isFinite(rawSettings.vatRatePercent)
    ? rawSettings.vatRatePercent
    : (typeof rawSettings.taxRatePercent === 'number' && Number.isFinite(rawSettings.taxRatePercent) && rawSettings.taxRatePercent <= 15
        ? rawSettings.taxRatePercent
        : 7.0);

  const incomeTaxRate = typeof rawSettings.incomeTaxRatePercent === 'number' && Number.isFinite(rawSettings.incomeTaxRatePercent)
    ? rawSettings.incomeTaxRatePercent
    : (typeof rawSettings.taxRatePercent === 'number' && Number.isFinite(rawSettings.taxRatePercent) && rawSettings.taxRatePercent > 15
        ? rawSettings.taxRatePercent
        : 20.0);

  const grabPercent = rawSettings.grabFoodCommissionPercent ?? (rawSettings.channels?.find((c: any) => c.channelId === 'grab')?.commissionPercent ?? 30);
  const linemanPercent = rawSettings.lineManCommissionPercent ?? (rawSettings.channels?.find((c: any) => c.channelId === 'lineman')?.commissionPercent ?? 25);

  return {
    ...INITIAL_SETTINGS,
    ...rawSettings,
    vatRatePercent: vatRate,
    incomeTaxRatePercent: incomeTaxRate,
    overheadRatePercent: typeof rawSettings.overheadRatePercent === 'number' && Number.isFinite(rawSettings.overheadRatePercent)
      ? rawSettings.overheadRatePercent
      : 10.0,
    overheadCalculationBase: rawSettings.overheadCalculationBase || 'SELLING_PRICE',
    cogsVarianceThresholdPercent: typeof rawSettings.cogsVarianceThresholdPercent === 'number' && Number.isFinite(rawSettings.cogsVarianceThresholdPercent)
      ? rawSettings.cogsVarianceThresholdPercent
      : 3.0,
    grabFoodCommissionPercent: grabPercent,
    lineManCommissionPercent: linemanPercent,
  };
}

export const StorageService = {
  getSettings(): RestaurantSettings {
    const loaded = safeLoad(STORAGE_KEYS.SETTINGS, INITIAL_SETTINGS);
    return migrateSettings(loaded);
  },
  saveSettings(settings: RestaurantSettings): void {
    safeSave(STORAGE_KEYS.SETTINGS, migrateSettings(settings));
  },

  getIngredients(): Ingredient[] {
    const raw = safeLoad(STORAGE_KEYS.INGREDIENTS, INITIAL_INGREDIENTS);
    return raw.map((ing) => {
      const calc = calculateIngredientCost(ing);
      if (calc.isValid && Math.abs(calc.costPerBaseUnit - (ing.costPerBaseUnit || 0)) > 0.00001) {
        return {
          ...ing,
          actualCost: calc.actualCost,
          costPerBaseUnit: calc.costPerBaseUnit,
        };
      }
      return ing;
    });
  },
  saveIngredients(ingredients: Ingredient[]): void {
    safeSave(STORAGE_KEYS.INGREDIENTS, ingredients);
  },

  getSauces(): Sauce[] {
    return safeLoad(STORAGE_KEYS.SAUCES, INITIAL_SAUCES);
  },
  saveSauces(sauces: Sauce[]): void {
    safeSave(STORAGE_KEYS.SAUCES, sauces);
  },

  getMenus(): MenuItem[] {
    return safeLoad(STORAGE_KEYS.MENUS, INITIAL_MENUS);
  },
  saveMenus(menus: MenuItem[]): void {
    safeSave(STORAGE_KEYS.MENUS, menus);
  },

  getSuppliers(): Supplier[] {
    return safeLoad(STORAGE_KEYS.SUPPLIERS, INITIAL_SUPPLIERS);
  },
  saveSuppliers(suppliers: Supplier[]): void {
    safeSave(STORAGE_KEYS.SUPPLIERS, suppliers);
  },

  getInventory(): InventoryItem[] {
    const raw = safeLoad<any[]>(STORAGE_KEYS.INVENTORY, INITIAL_INVENTORY);
    return raw.map((item) => {
      const currentStock = typeof item.currentStock === 'number'
        ? item.currentStock
        : (typeof item.currentQuantity === 'number' ? item.currentQuantity : 0);
      const minStock = typeof item.minStock === 'number'
        ? item.minStock
        : (typeof item.minimumStock === 'number' ? item.minimumStock : 0);
      const maxStock = typeof item.maxStock === 'number'
        ? item.maxStock
        : (typeof item.maximumStock === 'number' ? item.maximumStock : undefined);

      return {
        ...item,
        currentStock,
        currentQuantity: currentStock, // legacy alias compatibility
        minStock,
        minimumStock: minStock,       // legacy alias compatibility
        maxStock,
        maximumStock: maxStock,       // legacy alias compatibility
      };
    });
  },
  saveInventory(inventory: InventoryItem[]): void {
    const normalized = inventory.map((item) => {
      const currentStock = item.currentStock ?? item.currentQuantity ?? 0;
      const minStock = item.minStock ?? item.minimumStock ?? 0;
      const maxStock = item.maxStock ?? item.maximumStock;
      return {
        ...item,
        currentStock,
        currentQuantity: currentStock,
        minStock,
        minimumStock: minStock,
        maxStock,
        maximumStock: maxStock,
      };
    });
    safeSave(STORAGE_KEYS.INVENTORY, normalized);
  },

  getInventoryTransactions(): InventoryTransaction[] {
    return safeLoad(STORAGE_KEYS.INVENTORY_TXNS, []);
  },
  saveInventoryTransactions(txns: InventoryTransaction[]): void {
    safeSave(STORAGE_KEYS.INVENTORY_TXNS, txns);
  },

  getPurchases(): PurchaseRecord[] {
    return safeLoad(STORAGE_KEYS.PURCHASES, []);
  },
  savePurchases(purchases: PurchaseRecord[]): void {
    safeSave(STORAGE_KEYS.PURCHASES, purchases);
  },

  getPriceHistory(): PriceHistoryRecord[] {
    return safeLoad(STORAGE_KEYS.PRICE_HISTORY, []);
  },
  savePriceHistory(history: PriceHistoryRecord[]): void {
    safeSave(STORAGE_KEYS.PRICE_HISTORY, history);
  },

  getExpenses(): ExpenseRecord[] {
    return safeLoad(STORAGE_KEYS.EXPENSES, INITIAL_EXPENSES);
  },
  saveExpenses(expenses: ExpenseRecord[]): void {
    safeSave(STORAGE_KEYS.EXPENSES, expenses);
  },

  getSalesOrders(): SaleOrder[] {
    const rawOrders = safeLoad<SaleOrder[]>(STORAGE_KEYS.SALES, INITIAL_SALES_ORDERS);
    return rawOrders.map((order) => ({
      ...order,
      items: (order.items || []).map((item) => ({
        ...item,
        foodCostPerUnit: typeof item.foodCostPerUnit === 'number' ? item.foodCostPerUnit : 0,
        totalFoodCost: typeof item.totalFoodCost === 'number' ? item.totalFoodCost : 0,
      })),
    }));
  },
  saveSalesOrders(sales: SaleOrder[]): void {
    safeSave(STORAGE_KEYS.SALES, sales);
  },

  getWasteLog(): WasteRecord[] {
    const rawWaste = safeLoad<any[]>(STORAGE_KEYS.WASTE, INITIAL_WASTE_LOG);
    return rawWaste.map((w) => {
      const totalCost = typeof w.totalCost === 'number'
        ? w.totalCost
        : (typeof w.cost === 'number' ? w.cost : 0);
      return {
        ...w,
        totalCost,
        cost: totalCost, // synchronized canonical & legacy alias
      };
    });
  },
  saveWasteLog(waste: WasteRecord[]): void {
    const normalized = waste.map((w) => {
      const totalCost = w.totalCost ?? w.cost ?? 0;
      return {
        ...w,
        totalCost,
        cost: totalCost,
      };
    });
    safeSave(STORAGE_KEYS.WASTE, normalized);
  },

  getYieldTests(): YieldTestRecord[] {
    return safeLoad(STORAGE_KEYS.YIELD_TESTS, []);
  },
  saveYieldTests(records: YieldTestRecord[]): void {
    safeSave(STORAGE_KEYS.YIELD_TESTS, records);
  },

  getDailySales(): DailySalesRecord[] {
    const raw = safeLoad<DailySalesRecord[]>(STORAGE_KEYS.DAILY_SALES, []);
    if (raw && raw.length > 0) return raw;
    const today = new Date().toISOString().split('T')[0];
    return [
      {
        id: 'sales-init-1',
        date: today,
        channelId: 'dine-in',
        channelName: 'หน้าร้าน (Dine-in)',
        orderCount: 45,
        grossSales: 16000,
        discounts: 500,
        refunds: 0,
        netSales: 15500,
        platformFees: 0,
        actualPayout: 15500,
      },
      {
        id: 'sales-init-2',
        date: today,
        channelId: 'grab',
        channelName: 'GrabFood',
        orderCount: 20,
        grossSales: 8500,
        discounts: 300,
        refunds: 0,
        netSales: 8200,
        platformFees: 2632,
        actualPayout: 5568,
      },
    ];
  },
  saveDailySales(sales: DailySalesRecord[]): void {
    safeSave(STORAGE_KEYS.DAILY_SALES, sales);
  },

  getEmployees(): Employee[] {
    const stored = safeLoad<Employee[]>(STORAGE_KEYS.EMPLOYEES, []);
    if (stored && stored.length > 0) return stored;
    return [
      {
        id: 'emp-1',
        name: 'สมชาย เชฟใหญ่ (Head Chef)',
        position: 'หัวหน้าพ่อครัว',
        type: 'monthly',
        roleCategory: 'direct_kitchen',
        wageRate: 28000,
        standardHoursPerMonth: 208,
        overtimeHoursMonthly: 0,
        overtimeRateMultiplier: 1.5,
        benefitsMonthly: 2000,
        active: true,
        department: 'kitchen',
        role: 'หัวหน้าพ่อครัว (Head Chef)',
        employmentType: 'full_time',
      },
      {
        id: 'emp-2',
        name: 'สมศรี ผู้ช่วยครัว (Kitchen Assistant)',
        position: 'ผู้ช่วยครัว/เตรียมวัตถุดิบ',
        type: 'monthly',
        roleCategory: 'direct_kitchen',
        wageRate: 15000,
        standardHoursPerMonth: 208,
        overtimeHoursMonthly: 0,
        overtimeRateMultiplier: 1.5,
        benefitsMonthly: 1000,
        active: true,
        department: 'kitchen',
        role: 'ผู้ช่วยครัว (Kitchen Hand)',
        employmentType: 'full_time',
      },
      {
        id: 'emp-3',
        name: 'วิภา บริการหน้าร้าน (Service Staff)',
        position: 'พนักงานบริการ',
        type: 'monthly',
        roleCategory: 'direct_service',
        wageRate: 14000,
        standardHoursPerMonth: 208,
        overtimeHoursMonthly: 0,
        overtimeRateMultiplier: 1.5,
        benefitsMonthly: 1000,
        active: true,
        department: 'front_of_house',
        role: 'พนักงานเสิร์ฟ (Server)',
        employmentType: 'full_time',
      },
    ];
  },
  saveEmployees(employees: Employee[]): void {
    safeSave(STORAGE_KEYS.EMPLOYEES, employees);
  },

  getPackagingItems(): PackagingItem[] {
    return safeLoad(STORAGE_KEYS.PACKAGING, []);
  },
  savePackagingItems(items: PackagingItem[]): void {
    safeSave(STORAGE_KEYS.PACKAGING, items);
  },

  resetToDefaults(): void {
    // Only remove keys belonging to Tony's Restaurant System - NEVER clear entire localStorage
    Object.values(STORAGE_KEYS).forEach((key) => {
      try {
        localStorage.removeItem(key);
      } catch (e) {
        console.error(`Failed to remove key ${key}:`, e);
      }
    });
    safeSave(STORAGE_KEYS.SETTINGS, INITIAL_SETTINGS);
    safeSave(STORAGE_KEYS.INGREDIENTS, INITIAL_INGREDIENTS);
    safeSave(STORAGE_KEYS.SAUCES, INITIAL_SAUCES);
    safeSave(STORAGE_KEYS.MENUS, INITIAL_MENUS);
    safeSave(STORAGE_KEYS.SUPPLIERS, INITIAL_SUPPLIERS);
    safeSave(STORAGE_KEYS.INVENTORY, INITIAL_INVENTORY);
    safeSave(STORAGE_KEYS.EXPENSES, INITIAL_EXPENSES);
    safeSave(STORAGE_KEYS.SALES, INITIAL_SALES_ORDERS);
    safeSave(STORAGE_KEYS.WASTE, INITIAL_WASTE_LOG);
    safeSave(STORAGE_KEYS.INVENTORY_TXNS, []);
    safeSave(STORAGE_KEYS.PURCHASES, []);
    safeSave(STORAGE_KEYS.PRICE_HISTORY, []);
    safeSave(STORAGE_KEYS.YIELD_TESTS, []);
    safeSave(STORAGE_KEYS.EMPLOYEES, []);
    safeSave(STORAGE_KEYS.PACKAGING, []);
  },

  // EXPORT TO EXCEL WORKBOOK
  exportAllToExcel(
    ingredients: Ingredient[],
    sauces: Sauce[],
    menus: MenuItem[],
    expenses: ExpenseRecord[],
    sales: SaleOrder[]
  ): void {
    const wb = XLSX.utils.book_new();

    // 1. Ingredients sheet
    const ingData = ingredients.map((ing) => ({
      'รหัส': ing.id,
      'ชื่อวัตถุดิบ': ing.name,
      'หมวดหมู่': ing.category,
      'ปริมาณซื้อ': ing.purchaseQuantity,
      'หน่วยซื้อ': ing.purchaseUnit,
      'ราคาซื้อ (บาท)': ing.purchasePrice,
      'Yield (%)': ing.yieldPercent,
      'ปริมาณใช้ได้จริง': ing.actualQuantity,
      'หน่วยใช้งาน': ing.usageUnit,
      'ต้นทุนจริงหลังหัก Yield': Number(ing.actualCost.toFixed(4)),
      'ต้นทุนต่อหน่วยใช้งาน (บาท)': Number(ing.costPerBaseUnit.toFixed(4)),
      'สถานะ': ing.active ? 'ใช้งาน' : 'ระงับ',
      'หมายเหตุ': ing.notes || '',
    }));
    const wsIng = XLSX.utils.json_to_sheet(ingData);
    XLSX.utils.book_append_sheet(wb, wsIng, 'วัตถุดิบ ที่ซื้อตลาด');

    // 2. Sauces sheet
    const sauceData = sauces.map((s) => ({
      'รหัส': s.id,
      'ชื่อซอส': s.name,
      'หมวดหมู่': s.category || '',
      'ปริมาณผลิต': s.productionQuantity,
      'หน่วยผลิต': s.productionUnit,
      'Yield (%)': s.yieldPercent,
      'ปริมาณสุทธิ (g)': s.actualQuantity,
      'ต้นทุนการผลิตรวม (บาท)': Number(s.productionCost.toFixed(2)),
      'ต้นทุนจริงหลัง Yield (บาท)': Number(s.actualCost.toFixed(2)),
      'ต้นทุนต่อกรัม (บาท/g)': Number(s.costPerGram.toFixed(6)),
      'จำนวนส่วนประกอบ': s.items.length,
      'หมายเหตุ': s.notes || '',
    }));
    const wsSauce = XLSX.utils.json_to_sheet(sauceData);
    XLSX.utils.book_append_sheet(wb, wsSauce, 'ซอส หลัก');

    // 3. Menus & Variants Sheet
    const menuRows: any[] = [];
    menus.forEach((m) => {
      m.variants.forEach((v) => {
        menuRows.push({
          'หมวดหมู่': m.category,
          'ชื่อเมนู': m.name,
          'ชื่อชุด/ขนาด': v.name,
          'ประเภทเนื้อสัตว์/โปรตีน': v.proteinType,
          'ราคาขายหน้าร้าน': v.sellingPrice,
          'ราคากลับบ้าน': v.takeawayPrice,
          'ราคาเดลิเวอรี': v.deliveryPrice,
          'ค่าโสหุ้ย (Overhead)': v.overheadCost,
          'จำนวนส่วนผสมในสูตร': v.recipeItems.length,
          'สถานะ': v.active ? 'เปิดขาย' : 'ปิดขาย',
        });
      });
    });
    const wsMenu = XLSX.utils.json_to_sheet(menuRows);
    XLSX.utils.book_append_sheet(wb, wsMenu, 'รายการเมนูและราคา');

    // 4. Expenses Sheet
    const expData = expenses.map((e) => ({
      'วันที่': e.date,
      'หมวดหมู่': e.category,
      'รายการ': e.description,
      'จำนวนเงิน (บาท)': e.amount,
      'วิธีชำระ': e.paymentMethod,
      'หมายเหตุ': e.notes || '',
    }));
    const wsExp = XLSX.utils.json_to_sheet(expData);
    XLSX.utils.book_append_sheet(wb, wsExp, 'ค่าใช้จ่าย');

    // 5. Sales Summary Sheet
    const salesData = sales.map((s) => ({
      'เลขที่บิล': s.orderNumber,
      'วันที่': s.date,
      'เวลา': s.time,
      'ช่องทาง': s.channel,
      'ยอดขายรวม (บาท)': s.grossSales,
      'ค่า GP เดลิเวอรี': s.commissionFee,
      'ค่าแพ็กเกจจิ้ง': s.packagingCost,
      'ต้นทุนวัตถุดิบรวม': Number(s.totalFoodCost.toFixed(2)),
      'กำไรขั้นต้น': Number(s.grossProfit.toFixed(2)),
    }));
    const wsSales = XLSX.utils.json_to_sheet(salesData);
    XLSX.utils.book_append_sheet(wb, wsSales, 'ยอดขาย');

    // Trigger download
    const fileName = `TonysKitchen_FoodCost_${new Date().toISOString().slice(0, 10)}.xlsx`;
    XLSX.writeFile(wb, fileName);
  },

  // IMPORT WORKBOOK
  async importExcelWorkbook(file: File): Promise<{
    success: boolean;
    importedIngredientsCount: number;
    warnings: string[];
    newIngredients: Ingredient[];
  }> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer);
          const workbook = XLSX.read(data, { type: 'array' });
          const warnings: string[] = [];
          const newIngredients: Ingredient[] = [];

          // Try to locate ingredient sheet
          const sheetName =
            workbook.SheetNames.find(
              (name) =>
                name.includes('วัตถุดิบ') ||
                name.includes('ตลาด') ||
                name.toLowerCase().includes('ingredient')
            ) || workbook.SheetNames[0];

          if (!sheetName) {
            resolve({
              success: false,
              importedIngredientsCount: 0,
              warnings: ['ไม่พบแผ่นงานข้อมูลวัตถุดิบในไฟล์ Excel'],
              newIngredients: [],
            });
            return;
          }

          const worksheet = workbook.Sheets[sheetName];
          const rawRows: any[] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

          if (rawRows.length < 2) {
            resolve({
              success: false,
              importedIngredientsCount: 0,
              warnings: ['แผ่นงานไม่มีข้อมูลเพียงพอ'],
              newIngredients: [],
            });
            return;
          }

          // Header row detection
          let headerIdx = 0;
          for (let i = 0; i < Math.min(5, rawRows.length); i++) {
            const rowStr = JSON.stringify(rawRows[i] || '');
            if (rowStr.includes('ชื่อ') || rowStr.includes('ราคา') || rowStr.includes('name') || rowStr.includes('price')) {
              headerIdx = i;
              break;
            }
          }

          const rows = XLSX.utils.sheet_to_json<any>(worksheet, { range: headerIdx });

          rows.forEach((row, idx) => {
            const name =
              row['ชื่อวัตถุดิบ'] ||
              row['ชื่อ'] ||
              row['วัตถุดิบ'] ||
              row['Name'] ||
              row['Ingredient'] ||
              row['รายการ'];

            if (!name || String(name).trim() === '' || String(name).includes('xxx')) {
              warnings.push(`แถวที่ ${idx + 2}: ชื่อวัตถุดิบไม่ถูกต้อง ถูกข้ามหรือต้องตรวจสอบ (DATA_REVIEW_REQUIRED)`);
              return;
            }

            const purchasePrice = parseFloat(row['ราคาซื้อ (บาท)'] || row['ราคา'] || row['Price'] || '0');
            const purchaseQuantity = parseFloat(row['ปริมาณซื้อ'] || row['ปริมาณ'] || row['Quantity'] || '1000');
            const purchaseUnit = (row['หน่วยซื้อ'] || row['หน่วย'] || row['Unit'] || 'g') as any;
            const yieldPercent = parseFloat(row['Yield (%)'] || row['Yield'] || row['yield'] || '100');
            const actualQuantity = parseFloat(row['ปริมาณใช้ได้จริง'] || row['ActualQuantity'] || String(purchaseQuantity));
            const usageUnit = (row['หน่วยใช้งาน'] || row['UsageUnit'] || purchaseUnit) as any;

            const isDataReview =
              purchasePrice <= 0 ||
              isNaN(purchasePrice) ||
              yieldPercent <= 0 ||
              isNaN(yieldPercent) ||
              actualQuantity <= 0 ||
              isNaN(actualQuantity);

            const ing: Ingredient = {
              id: `ing_import_${Date.now()}_${idx}`,
              name: String(name).trim(),
              category: 'ของแห้งและเบ็ดเตล็ด',
              purchaseQuantity: purchaseQuantity || 1000,
              purchaseUnit: purchaseUnit || 'g',
              purchasePrice: purchasePrice || 0,
              actualQuantity: actualQuantity || 1000,
              actualUnit: usageUnit || 'g',
              yieldPercent: yieldPercent || 100,
              actualCost: 0,
              baseUnit: usageUnit || 'g',
              costPerBaseUnit: 0,
              usageUnit: usageUnit || 'g',
              active: true,
              isReviewRequired: isDataReview,
              reviewReason: isDataReview
                ? 'ข้อมูลนำเข้าจาก Excel ไม่สมบูรณ์ กรุณาตรวจสอบราคาซื้อและ Yield (DATA_REVIEW_REQUIRED)'
                : undefined,
              notes: 'นำเข้าจากไฟล์ Excel ' + file.name,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };

            const calc = calculateIngredientCost(ing);
            ing.actualCost = calc.actualCost;
            ing.costPerBaseUnit = calc.costPerBaseUnit;

            newIngredients.push(ing);
          });

          resolve({
            success: true,
            importedIngredientsCount: newIngredients.length,
            warnings,
            newIngredients,
          });
        } catch (err: any) {
          reject(err);
        }
      };
      reader.onerror = (err) => reject(err);
      reader.readAsArrayBuffer(file);
    });
  },

  // ==========================================
  // UNIFIED LOCAL-FIRST JSON BACKUP & RESTORE
  // ==========================================

  /**
   * Generates a complete snapshot package of all application data from LocalStorage.
   * Completely offline and local-first.
   */
  exportBackup(): AppBackupPackage {
    const settings = this.getSettings();
    const expenses = this.getExpenses();
    const monthlyExp = calculateTotalMonthlyExpenses(expenses as any, settings.operatingDaysPerMonth || 30);
    const estimatedMonthlySales = settings.projectedMonthlySales || 330000;
    const normalizedSales = calculateNormalizedNetSales(
      estimatedMonthlySales,
      0,
      0,
      settings.salesVatInclusive ?? false,
      settings.vatRatePercent ?? 7
    );
    const calculatedOverhead = calculateOverheadRatePercent(monthlyExp.fixedMonthly, normalizedSales, 0);
    const overheadPercent = typeof settings.overheadRatePercent === 'number' && settings.overheadRatePercent > 0
      ? settings.overheadRatePercent
      : Number(calculatedOverhead.toFixed(2));

    // Keep compatibility snapshot key updated
    safeSave(STORAGE_KEYS.OVERHEAD_COMPAT, {
      overheadPercentOfSales: overheadPercent,
      fixedMonthlyExpenses: monthlyExp.fixedMonthly,
      variableMonthlyExpenses: monthlyExp.variableMonthly,
      updatedAt: new Date().toISOString(),
    });

    const backup: AppBackupPackage = {
      schemaVersion: '1.1.0',
      appId: 'TONYS_KITCHEN_POS',
      appName: "Tony's Kitchen POS & Cost Management",
      exportedAt: new Date().toISOString(),
      overheadPercentOfSales: overheadPercent,
      payload: {
        settings,
        ingredients: this.getIngredients(),
        sauces: this.getSauces(),
        menus: this.getMenus(),
        suppliers: this.getSuppliers(),
        inventory: this.getInventory(),
        inventoryTransactions: this.getInventoryTransactions(),
        purchases: this.getPurchases(),
        priceHistory: this.getPriceHistory(),
        expenses: this.getExpenses(),
        salesOrders: this.getSalesOrders(),
        wasteLog: this.getWasteLog(),
        dailySales: this.getDailySales(),
        yieldTests: this.getYieldTests(),
        employees: this.getEmployees(),
        packagingItems: this.getPackagingItems(),
      },
    };
    return backup;
  },

  /**
   * Gets the last backup ISO timestamp or null if never backed up.
   */
  getLastBackupTime(): string | null {
    try {
      if (typeof localStorage === 'undefined') return null;
      return localStorage.getItem(STORAGE_KEYS.LAST_BACKUP);
    } catch {
      return null;
    }
  },

  /**
   * Records current timestamp as the last backup time.
   */
  recordBackupCompleted(): void {
    try {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(STORAGE_KEYS.LAST_BACKUP, new Date().toISOString());
    } catch (e) {
      // ignore
    }
  },

  /**
   * Checks if backup is overdue (default > 7 days or never backed up).
   */
  isBackupOverdue(daysThreshold: number = 7): { isOverdue: boolean; lastBackupTime: string | null } {
    const lastBackup = this.getLastBackupTime();
    if (!lastBackup) {
      return { isOverdue: true, lastBackupTime: null };
    }
    const lastTime = new Date(lastBackup).getTime();
    if (isNaN(lastTime)) {
      return { isOverdue: true, lastBackupTime: null };
    }
    const diffDays = (Date.now() - lastTime) / (1000 * 60 * 60 * 24);
    return { isOverdue: diffDays >= daysThreshold, lastBackupTime: lastBackup };
  },

  /**
   * Triggers a client-side download of the full database backup in JSON format.
   */
  downloadBackupFile(): void {
    const backup = this.exportBackup();
    const jsonStr = JSON.stringify(backup, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const dateSegment = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `TONYS_POS_BACKUP_${dateSegment}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    this.recordBackupCompleted();
  },

  /**
   * Validates an arbitrary object to confirm it is a valid, compatible AppBackupPackage.
   */
  validateBackup(data: unknown): { valid: boolean; errors: string[]; backup?: AppBackupPackage } {
    const errors: string[] = [];
    if (!data || typeof data !== 'object') {
      return { valid: false, errors: ['ข้อมูลสำรองไม่ถูกต้อง: รูปแบบไฟล์ไม่ใช่ JSON Object'] };
    }

    const pkg = data as any;
    if (pkg.appId && pkg.appId !== 'TONYS_KITCHEN_POS') {
      errors.push(`appId ไม่ตรงกัน: พบ ${pkg.appId} (คาดหวัง TONYS_KITCHEN_POS)`);
    }

    if (!pkg.payload || typeof pkg.payload !== 'object') {
      errors.push('ไม่พบข้อมูลหลัก (payload object)');
      return { valid: false, errors };
    }

    const p = pkg.payload;
    if (p.ingredients && !Array.isArray(p.ingredients)) {
      errors.push('payload.ingredients ต้องเป็น Array');
    }
    if (p.menus && !Array.isArray(p.menus)) {
      errors.push('payload.menus ต้องเป็น Array');
    }
    if (p.sauces && !Array.isArray(p.sauces)) {
      errors.push('payload.sauces ต้องเป็น Array');
    }
    if (p.inventory && !Array.isArray(p.inventory)) {
      errors.push('payload.inventory ต้องเป็น Array');
    }

    if (errors.length > 0) {
      return { valid: false, errors };
    }

    return { valid: true, errors: [], backup: pkg as AppBackupPackage };
  },

  /**
   * Restores an entire validated backup package into LocalStorage, safely normalizing legacy fields.
   */
  restoreBackup(backup: AppBackupPackage): {
    success: boolean;
    message: string;
    counts: Record<string, number>;
  } {
    const p = backup.payload;
    const counts: Record<string, number> = {};

    if (p.settings) {
      this.saveSettings(p.settings);
      counts.settings = 1;
    }
    if (Array.isArray(p.ingredients)) {
      this.saveIngredients(p.ingredients);
      counts.ingredients = p.ingredients.length;
    }
    if (Array.isArray(p.sauces)) {
      this.saveSauces(p.sauces);
      counts.sauces = p.sauces.length;
    }
    if (Array.isArray(p.menus)) {
      this.saveMenus(p.menus);
      counts.menus = p.menus.length;
    }
    if (Array.isArray(p.suppliers)) {
      this.saveSuppliers(p.suppliers);
      counts.suppliers = p.suppliers.length;
    }
    if (Array.isArray(p.inventory)) {
      this.saveInventory(p.inventory);
      counts.inventory = p.inventory.length;
    }
    if (Array.isArray(p.inventoryTransactions)) {
      this.saveInventoryTransactions(p.inventoryTransactions);
      counts.inventoryTransactions = p.inventoryTransactions.length;
    }
    if (Array.isArray(p.purchases)) {
      this.savePurchases(p.purchases);
      counts.purchases = p.purchases.length;
    }
    if (Array.isArray(p.priceHistory)) {
      this.savePriceHistory(p.priceHistory);
      counts.priceHistory = p.priceHistory.length;
    }
    if (Array.isArray(p.expenses)) {
      this.saveExpenses(p.expenses);
      counts.expenses = p.expenses.length;
    }
    if (Array.isArray(p.salesOrders)) {
      this.saveSalesOrders(p.salesOrders);
      counts.salesOrders = p.salesOrders.length;
    }
    if (Array.isArray(p.wasteLog)) {
      this.saveWasteLog(p.wasteLog);
      counts.wasteLog = p.wasteLog.length;
    }
    if (Array.isArray(p.dailySales)) {
      this.saveDailySales(p.dailySales);
      counts.dailySales = p.dailySales.length;
    }
    if (Array.isArray(p.yieldTests)) {
      this.saveYieldTests(p.yieldTests);
      counts.yieldTests = p.yieldTests.length;
    }
    if (Array.isArray(p.employees)) {
      this.saveEmployees(p.employees);
      counts.employees = p.employees.length;
    }
    if (Array.isArray(p.packagingItems)) {
      this.savePackagingItems(p.packagingItems);
      counts.packagingItems = p.packagingItems.length;
    }

    this.recordBackupCompleted();
    return {
      success: true,
      message: 'กู้คืนข้อมูลสำรองสำเร็จเรียบร้อย',
      counts,
    };
  },

  /**
   * Imports a backup JSON file selected by the user, validates it, and restores data.
   */
  async importBackupFile(file: File): Promise<{
    success: boolean;
    message: string;
    warnings?: string[];
    counts?: Record<string, number>;
  }> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const content = e.target?.result as string;
          const parsed = JSON.parse(content);
          const validation = this.validateBackup(parsed);

          if (!validation.valid || !validation.backup) {
            resolve({
              success: false,
              message: `ไฟล์สำรองไม่ผ่านการตรวจสอบ: ${validation.errors.join(', ')}`,
              warnings: validation.errors,
            });
            return;
          }

          const result = this.restoreBackup(validation.backup);
          resolve({
            success: true,
            message: result.message,
            counts: result.counts,
          });
        } catch (err: any) {
          resolve({
            success: false,
            message: `ไม่สามารถอ่านไฟล์ JSON ได้: ${err.message || 'รูปแบบไฟล์ผิดพลาด'}`,
          });
        }
      };
      reader.onerror = (err) => reject(err);
      reader.readAsText(file, 'utf-8');
    });
  },
};
