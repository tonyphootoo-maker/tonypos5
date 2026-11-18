import {
  DishDoc,
  EmployeeDoc,
  IngredientDoc,
  SubRecipeDoc,
} from '../types';
import { Ingredient, MenuItem, Sauce, StockCountSnapshot } from '../costing/types';
import { DailySalesRecord, ExpenseRecord } from '../costing/types/domain';
import {
  getPeriodDateBounds,
  isDateInPeriod,
  isExplicitPayrollExpense,
  resolveStockCountSnapshotsForPeriod,
  roundTo2,
} from './calculations';

export type DataHealthCheckId =
  | 'zero_price_ingredients'
  | 'menus_without_recipe'
  | 'uncosted_manual_sales'
  | 'missing_stock_counts'
  | 'duplicate_payroll'
  | 'sauces_without_net_qty';

export type DataHealthSeverity = 'ok' | 'warning' | 'critical';

export interface DataHealthIssueDetail {
  id: string;
  label: string;
  detailTh: string;
  detailEn: string;
}

export interface DataHealthCheckResult {
  id: DataHealthCheckId;
  titleTh: string;
  titleEn: string;
  descriptionTh: string;
  descriptionEn: string;
  passed: boolean;
  severity: DataHealthSeverity;
  count: number;
  summaryTh: string;
  summaryEn: string;
  items: DataHealthIssueDetail[];
}

export interface AuditDataHealthInput {
  period: 'day' | 'month' | 'year';
  dateParam: string;
  todayDate?: string;
  costIngredients?: Ingredient[];
  posIngredients?: IngredientDoc[];
  costMenus?: MenuItem[];
  posDishes?: DishDoc[];
  manualSales?: DailySalesRecord[];
  stockCountSnapshots?: StockCountSnapshot[];
  expenses?: ExpenseRecord[];
  employees?: Array<Pick<EmployeeDoc, 'id' | 'name'> & { isActive?: boolean; active?: boolean }>;
  excludePayrollDuplicates?: boolean;
  costSauces?: Sauce[];
  posSubRecipes?: SubRecipeDoc[];
}

export interface DataHealthReport {
  isHealthy: boolean;
  passedCount: number;
  totalChecks: number;
  warningCount: number;
  criticalCount: number;
  totalIssueCount: number;
  checks: DataHealthCheckResult[];
}

/**
 * Pure Data Health Audit across all 6 core restaurant accounting & costing integrity rules:
 * 1. Ingredients with price = 0 (or missing cost)
 * 2. Menus / variants without any recipe lines
 * 3. Manual daily sales records missing paired food cost
 * 4. Missing beginning/ending stock count snapshots for the selected period
 * 5. Payroll-flagged expenses overlapping with active employee roster
 * 6. Sauces / sub-recipes without valid net yield quantity (<= 0)
 */
export function auditDataHealth(input: AuditDataHealthInput): DataHealthReport {
  const {
    period,
    dateParam,
    todayDate,
    costIngredients = [],
    posIngredients = [],
    costMenus = [],
    posDishes = [],
    manualSales = [],
    stockCountSnapshots = [],
    expenses = [],
    employees = [],
    excludePayrollDuplicates = true,
    costSauces = [],
    posSubRecipes = [],
  } = input;

  const checks: DataHealthCheckResult[] = [];

  // 1. Ingredients with price = 0 or missing costPerBaseUnit
  const zeroPriceItems: DataHealthIssueDetail[] = [];
  const seenIngIds = new Set<string>();
  for (const ing of costIngredients) {
    if (!ing || ing.active === false) continue;
    const price = Number(ing.purchasePrice) || 0;
    const cpu = Number(ing.costPerBaseUnit) || 0;
    if (price <= 0 || cpu <= 0) {
      seenIngIds.add(ing.id);
      zeroPriceItems.push({
        id: ing.id,
        label: ing.name,
        detailTh: `ราคาซื้อ ${roundTo2(price).toFixed(2)} ฿ (ต้นทุน/หน่วย ${roundTo2(cpu).toFixed(2)} ฿)`,
        detailEn: `Purchase price ${roundTo2(price).toFixed(2)} THB (unit cost ${roundTo2(cpu).toFixed(2)} THB)`,
      });
    }
  }
  for (const ing of posIngredients) {
    if (!ing || seenIngIds.has(ing.id)) continue;
    const price = Number(ing.purchasePrice) || 0;
    const cpu = Number(ing.costPerBaseUnit) || 0;
    if (price <= 0 || cpu <= 0) {
      zeroPriceItems.push({
        id: ing.id,
        label: ing.nameTh || ing.name,
        detailTh: `POS วัตถุดิบ: ราคาซื้อ ${roundTo2(price).toFixed(2)} ฿`,
        detailEn: `POS ingredient: purchase price ${roundTo2(price).toFixed(2)} THB`,
      });
    }
  }
  checks.push({
    id: 'zero_price_ingredients',
    titleTh: 'วัตถุดิบที่ราคาเป็น 0',
    titleEn: 'Ingredients with Zero Price',
    descriptionTh: 'ตรวจหาวัตถุดิบที่ยังไม่กรอกราคาซื้อ ทำให้ต้นทุนอาหารต่อจานต่ำกว่าความเป็นจริง',
    descriptionEn: 'Detects active ingredients missing purchase price, which understates dish food cost.',
    passed: zeroPriceItems.length === 0,
    severity: zeroPriceItems.length === 0 ? 'ok' : 'critical',
    count: zeroPriceItems.length,
    summaryTh:
      zeroPriceItems.length === 0
        ? 'วัตถุดิบทั้งหมดมีราคาครบถ้วน'
        : `พบวัตถุดิบที่ราคา = 0 จำนวน ${zeroPriceItems.length} รายการ`,
    summaryEn:
      zeroPriceItems.length === 0
        ? 'All active ingredients have valid prices.'
        : `Found ${zeroPriceItems.length} ingredient(s) with zero price.`,
    items: zeroPriceItems,
  });

  // 2. Menus without recipes (check Costing variants AND POS dishes)
  const noRecipeItems: DataHealthIssueDetail[] = [];
  const seenMenuVariantIds = new Set<string>();
  for (const menu of costMenus) {
    if (!menu || menu.active === false) continue;
    const variants = Array.isArray(menu.variants) ? menu.variants : [];
    if (variants.length === 0) {
      seenMenuVariantIds.add(menu.id);
      noRecipeItems.push({
        id: menu.id,
        label: menu.thaiName || menu.name,
        detailTh: 'ยังไม่มีสูตรหรือตัวเลือกในเมนูฝั่ง Costing',
        detailEn: 'No recipe variants configured in Costing.',
      });
      continue;
    }
    for (const v of variants) {
      if (!v || v.active === false) continue;
      if (!Array.isArray(v.recipeItems) || v.recipeItems.length === 0) {
        seenMenuVariantIds.add(v.id);
        const menuLabel = menu.thaiName || menu.name;
        const label = v.name && v.name !== menuLabel ? `${menuLabel} (${v.name})` : menuLabel;
        noRecipeItems.push({
          id: v.id,
          label,
          detailTh: 'ยังไม่มีรายการวัตถุดิบในสูตร (ต้นทุนจะเป็น 0)',
          detailEn: 'No recipe ingredient lines linked (food cost defaults to 0).',
        });
      }
    }
  }
  for (const dish of posDishes) {
    if (!dish) continue;
    const variants = Array.isArray(dish.variants) ? dish.variants : [];
    if (variants.length === 0) {
      noRecipeItems.push({
        id: `pos:${dish.id}`,
        label: dish.nameTh || dish.name,
        detailTh: 'เมนู POS ยังไม่มีตัวเลือกและสูตร',
        detailEn: 'POS dish has no variant or recipe.',
      });
      continue;
    }
    for (const v of variants) {
      if (!v) continue;
      if (v.costVariantId && seenMenuVariantIds.has(v.costVariantId)) continue;
      const lineCount =
        (v.ingredients?.length || 0) +
        (v.subRecipes?.length || 0) +
        (v.packaging?.length || 0);
      if (lineCount === 0) {
        const dishLabel = dish.nameTh || dish.name;
        const label = v.name && v.name !== 'Regular' ? `${dishLabel} (${v.nameTh || v.name})` : dishLabel;
        noRecipeItems.push({
          id: `pos:${v.id}`,
          label,
          detailTh: 'เมนู POS ยังไม่มีสูตรผูกไว้',
          detailEn: 'POS dish variant has no recipe linked.',
        });
      }
    }
  }
  checks.push({
    id: 'menus_without_recipe',
    titleTh: 'เมนูที่ยังไม่มีสูตร',
    titleEn: 'Menus Without Recipes',
    descriptionTh: 'ตรวจหาเมนูขายที่ยังไม่มีการผูกสูตรวัตถุดิบ ส่งผลให้ยอดขายจาก POS มีต้นทุนอาหารเป็น 0',
    descriptionEn: 'Detects sellable menus with no recipe lines, resulting in 0 food cost when sold.',
    passed: noRecipeItems.length === 0,
    severity: noRecipeItems.length === 0 ? 'ok' : 'warning',
    count: noRecipeItems.length,
    summaryTh:
      noRecipeItems.length === 0
        ? 'เมนูทั้งหมดมีสูตรครบถ้วน'
        : `พบเมนูที่ยังไม่มีสูตร ${noRecipeItems.length} รายการ`,
    summaryEn:
      noRecipeItems.length === 0
        ? 'All menus have recipe lines configured.'
        : `Found ${noRecipeItems.length} menu(s) missing recipes.`,
    items: noRecipeItems,
  });

  // 3. Manual daily sales without paired food cost
  const uncostedSalesItems: DataHealthIssueDetail[] = [];
  let uncostedTotalAmount = 0;
  for (const rec of manualSales) {
    if (!rec || rec.id?.startsWith('pos_sync_')) continue;
    const net =
      typeof rec.netSales === 'number' && Number.isFinite(rec.netSales)
        ? Math.max(0, rec.netSales)
        : Math.max(0, (rec.grossSales || 0) - (rec.discounts || 0) - (rec.refunds || 0));
    const hasExplicitFoodCost =
      typeof rec.foodCost === 'number' && Number.isFinite(rec.foodCost);
    if (net > 0 && !hasExplicitFoodCost) {
      uncostedTotalAmount += net;
      const inPeriod = isDateInPeriod(rec.date, period, dateParam);
      uncostedSalesItems.push({
        id: rec.id,
        label: `${rec.date} • ${rec.channelName || rec.channelId || 'ไม่ระบุช่องทาง'}`,
        detailTh: `ยอดขาย ${roundTo2(net).toFixed(2)} ฿ ไม่มีต้นทุนอาหารคู่${inPeriod ? ' (อยู่ในงวดที่เลือก)' : ''}`,
        detailEn: `Sales ${roundTo2(net).toFixed(2)} THB missing paired food cost${inPeriod ? ' (in selected period)' : ''}`,
      });
    }
  }
  checks.push({
    id: 'uncosted_manual_sales',
    titleTh: 'ยอดขาย Manual ที่ไม่มีต้นทุนคู่',
    titleEn: 'Manual Sales Without Paired Cost',
    descriptionTh: 'ตรวจหายอดขายที่บันทึกด้วยตนเองแต่ไม่ได้ระบุต้นทุนอาหาร ทำให้กำไรใน P&L อาจสูงเกินจริง',
    descriptionEn: 'Detects manual sales entries missing paired food cost, which can overstate profit.',
    passed: uncostedSalesItems.length === 0,
    severity: uncostedSalesItems.length === 0 ? 'ok' : 'warning',
    count: uncostedSalesItems.length,
    summaryTh:
      uncostedSalesItems.length === 0
        ? 'ยอดขาย Manual ทุกรายการมีต้นทุนคู่ครบถ้วน'
        : `พบ ${uncostedSalesItems.length} รายการ (รวม ฿${roundTo2(uncostedTotalAmount).toFixed(2)}) ที่ยังไม่มีต้นทุนคู่`,
    summaryEn:
      uncostedSalesItems.length === 0
        ? 'All manual sales records include paired food cost.'
        : `Found ${uncostedSalesItems.length} record(s) totaling ฿${roundTo2(uncostedTotalAmount).toFixed(2)} without food cost.`,
    items: uncostedSalesItems,
  });

  // 4. Missing stock count snapshots for the selected period
  const { periodStart, periodEnd } = getPeriodDateBounds(period, dateParam);
  const snapshotPair = resolveStockCountSnapshotsForPeriod(
    stockCountSnapshots,
    periodStart,
    periodEnd,
    todayDate
  );
  const missingStockItems: DataHealthIssueDetail[] = [];
  if (!snapshotPair.beginningSnapshot) {
    missingStockItems.push({
      id: `missing_begin_${periodStart}`,
      label: `สต็อกต้นงวด (ก่อน ${periodStart})`,
      detailTh: `ยังไม่มีใบนับสต็อกก่อนวันที่ ${periodStart} สำหรับคำนวณ Actual COGS`,
      detailEn: `No stock count snapshot found prior to ${periodStart} for Actual COGS.`,
    });
  }
  if (!snapshotPair.endingSnapshot) {
    missingStockItems.push({
      id: `missing_end_${periodEnd}`,
      label: `สต็อกปลายงวด (${periodEnd} เป็นต้นไป)`,
      detailTh: `ยังไม่มีใบนับสต็อก ณ วันที่ ${periodEnd} หรือหลังจากนั้น`,
      detailEn: `No ending stock count snapshot found on or after ${periodEnd}.`,
    });
  }
  checks.push({
    id: 'missing_stock_counts',
    titleTh: 'ยังไม่มีการนับสต็อกในช่วงที่เลือก',
    titleEn: 'Missing Stock Count for Selected Period',
    descriptionTh: `ตรวจสอบใบนับสต็อกต้นงวดและปลายงวดสำหรับช่วง ${periodStart} ถึง ${periodEnd}`,
    descriptionEn: `Verifies beginning & ending stock snapshots exist for ${periodStart} to ${periodEnd}.`,
    passed: snapshotPair.hasCompletePair,
    severity: snapshotPair.hasCompletePair ? 'ok' : 'warning',
    count: missingStockItems.length,
    summaryTh: snapshotPair.hasCompletePair
      ? `มีผลนับสต็อกครบ (${snapshotPair.beginningSnapshot!.date} → ${snapshotPair.endingSnapshot!.date})`
      : `ขาดผลนับสต็อก ${missingStockItems.length} จุดในช่วง ${periodStart} ถึง ${periodEnd}`,
    summaryEn: snapshotPair.hasCompletePair
      ? `Complete stock counts (${snapshotPair.beginningSnapshot!.date} → ${snapshotPair.endingSnapshot!.date})`
      : `Missing ${missingStockItems.length} stock count snapshot(s) for ${periodStart} to ${periodEnd}.`,
    items: missingStockItems,
  });

  // 5. Payroll expenses duplicating employee roster
  const activeEmployeesCount = employees.filter(
    (e) => e && e.isActive !== false && e.active !== false
  ).length;
  const payrollExpenses = expenses.filter((e) => e && !e.isExcluded && isExplicitPayrollExpense(e));
  const duplicatePayrollItems: DataHealthIssueDetail[] =
    activeEmployeesCount > 0 && payrollExpenses.length > 0
      ? payrollExpenses.map((e) => ({
          id: e.id,
          label: e.description || e.name || 'รายการ Payroll',
          detailTh: `จำนวนเงิน ${roundTo2(Number(e.amount) || 0).toFixed(2)} ฿ (${e.date}) — ${
            excludePayrollDuplicates
              ? 'ตัดออกจาก OPEX อัตโนมัติแล้ว'
              : 'คำเตือน: กำลังนับรวมซ้ำกับทะเบียนพนักงาน'
          }`,
          detailEn: `Amount ${roundTo2(Number(e.amount) || 0).toFixed(2)} THB (${e.date}) — ${
            excludePayrollDuplicates
              ? 'auto-excluded from OPEX'
              : 'warning: double-counted alongside roster'
          }`,
        }))
      : [];
  const hasDuplicatePayroll = duplicatePayrollItems.length > 0;
  checks.push({
    id: 'duplicate_payroll',
    titleTh: 'รายจ่ายเงินเดือนซ้ำกับรายชื่อพนักงาน',
    titleEn: 'Payroll Expense Overlapping Roster',
    descriptionTh: 'ตรวจพบทั้งค่าใช้จ่ายที่ระบุเป็น Payroll และทะเบียนพนักงานที่มีคนทำงานอยู่',
    descriptionEn: 'Detects payroll-flagged expenses alongside active employees on the labor roster.',
    passed: !hasDuplicatePayroll,
    severity: !hasDuplicatePayroll
      ? 'ok'
      : excludePayrollDuplicates
      ? 'warning'
      : 'critical',
    count: duplicatePayrollItems.length,
    summaryTh: !hasDuplicatePayroll
      ? 'ไม่พบการบันทึกเงินเดือนซ้ำซ้อน'
      : `พบรายจ่าย Payroll ${duplicatePayrollItems.length} รายการซ้อนกับพนักงาน ${activeEmployeesCount} คน`,
    summaryEn: !hasDuplicatePayroll
      ? 'No overlapping payroll expenses detected.'
      : `Found ${duplicatePayrollItems.length} payroll expense(s) alongside ${activeEmployeesCount} active employee(s).`,
    items: duplicatePayrollItems,
  });

  // 6. Sauces / Sub-recipes without net yield quantity
  const invalidSauceItems: DataHealthIssueDetail[] = [];
  const seenSauceIds = new Set<string>();
  for (const s of costSauces) {
    if (!s || s.active === false) continue;
    const netQty = Number(s.actualQuantity);
    if (!Number.isFinite(netQty) || netQty <= 0) {
      seenSauceIds.add(s.id);
      invalidSauceItems.push({
        id: s.id,
        label: s.thaiName || s.name,
        detailTh: `ปริมาณสุทธิ (actualQuantity) = ${Number.isFinite(netQty) ? roundTo2(netQty) : 0} ${s.productionUnit || 'g'} (ต้อง > 0)`,
        detailEn: `Net yield (actualQuantity) = ${Number.isFinite(netQty) ? roundTo2(netQty) : 0} ${s.productionUnit || 'g'} (must be > 0)`,
      });
    }
  }
  for (const sr of posSubRecipes) {
    if (!sr || seenSauceIds.has(sr.id)) continue;
    const outQty = Number(sr.outputQuantity);
    if (!Number.isFinite(outQty) || outQty <= 0) {
      invalidSauceItems.push({
        id: `pos:${sr.id}`,
        label: sr.nameTh || sr.name,
        detailTh: `ปริมาณผลผลิต (outputQuantity) = ${Number.isFinite(outQty) ? roundTo2(outQty) : 0} ${sr.outputUnit || 'g'}`,
        detailEn: `Output yield (outputQuantity) = ${Number.isFinite(outQty) ? roundTo2(outQty) : 0} ${sr.outputUnit || 'g'}`,
      });
    }
  }
  checks.push({
    id: 'sauces_without_net_qty',
    titleTh: 'ซอสที่ไม่มีปริมาณสุทธิ',
    titleEn: 'Sauces Without Net Quantity',
    descriptionTh: 'ตรวจหาสูตรซอส/สูตรกลางที่ยังไม่กรอกปริมาณผลผลิตสุทธิหลังทำ ทำให้คำนวณต้นทุนต่อกรัมไม่ได้',
    descriptionEn: 'Detects sauces or sub-recipes missing positive net yield, blocking per-unit costing.',
    passed: invalidSauceItems.length === 0,
    severity: invalidSauceItems.length === 0 ? 'ok' : 'critical',
    count: invalidSauceItems.length,
    summaryTh:
      invalidSauceItems.length === 0
        ? 'สูตรซอสทั้งหมดมีปริมาณสุทธิครบถ้วน'
        : `พบสูตรซอสที่ไม่มีปริมาณสุทธิ ${invalidSauceItems.length} รายการ`,
    summaryEn:
      invalidSauceItems.length === 0
        ? 'All sauces and sub-recipes have positive net yield quantities.'
        : `Found ${invalidSauceItems.length} sauce(s)/sub-recipe(s) missing net quantity.`,
    items: invalidSauceItems,
  });

  const warningCount = checks.filter((c) => !c.passed && c.severity === 'warning').length;
  const criticalCount = checks.filter((c) => !c.passed && c.severity === 'critical').length;
  const passedCount = checks.filter((c) => c.passed).length;
  const totalIssueCount = checks.reduce((sum, c) => sum + c.count, 0);

  return {
    isHealthy: warningCount === 0 && criticalCount === 0,
    passedCount,
    totalChecks: checks.length,
    warningCount,
    criticalCount,
    totalIssueCount,
    checks,
  };
}
