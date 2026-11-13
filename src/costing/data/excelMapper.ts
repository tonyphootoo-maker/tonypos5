/**
 * Excel Multi-Sheet Importer, Validator, Reconciler, and Exporter
 * Supports .xlsx, .xls, and .csv with robust error handling and human-readable validation.
 */

import * as XLSX from 'xlsx';
import {
  Ingredient,
  SubRecipe,
  MenuItem,
  SalesChannel,
  PackagingItem,
  ExpenseRecord,
  DailySalesRecord,
  BusinessSettings,
  ExcelMappingRow,
  ReconciliationComparison,
} from '../types/domain';

export interface ImportValidationResult {
  totalRowsProcessed: number;
  importedIngredientsCount: number;
  importedSubRecipesCount: number;
  importedMenuItemsCount: number;
  importedExpensesCount: number;
  warnings: string[];
  errors: string[];
  parsedData: {
    ingredients?: Ingredient[];
    subRecipes?: SubRecipe[];
    menuItems?: MenuItem[];
    expenses?: ExpenseRecord[];
  };
}

/**
 * Parse an uploaded Excel file (.xlsx / .xls / .csv)
 */
export async function parseExcelWorkbook(file: File): Promise<XLSX.WorkBook> {
  const data = await file.arrayBuffer();
  return XLSX.read(data, { type: 'array' });
}

/**
 * Validate and Extract Normalized Entities from Excel Worksheets
 */
export function validateAndMapExcelData(workbook: XLSX.WorkBook): ImportValidationResult {
  const result: ImportValidationResult = {
    totalRowsProcessed: 0,
    importedIngredientsCount: 0,
    importedSubRecipesCount: 0,
    importedMenuItemsCount: 0,
    importedExpensesCount: 0,
    warnings: [],
    errors: [],
    parsedData: {},
  };

  const sheetNames = workbook.SheetNames;
  if (!sheetNames || sheetNames.length === 0) {
    result.errors.push('ไม่พบแผ่นงาน (Worksheet) ในไฟล์ Excel ที่อัปโหลด');
    return result;
  }

  // Look for ingredient sheets (e.g. Ingredients, วัตถุดิบ, Ingredient_Master, Sheet1)
  const ingredientSheetName = sheetNames.find((s) =>
    /ingredient|วัตถุดิบ|raw_material|master/i.test(s)
  ) || sheetNames[0];

  if (ingredientSheetName && workbook.Sheets[ingredientSheetName]) {
    const rawRows = XLSX.utils.sheet_to_json<Record<string, any>>(workbook.Sheets[ingredientSheetName]);
    const parsedIngredients: Ingredient[] = [];

    rawRows.forEach((row, idx) => {
      result.totalRowsProcessed++;
      const rowNum = idx + 2;

      // Detect field names (flexible mapping for Thai/English headers)
      const thaiName = row['ชื่อวัตถุดิบ'] || row['Thai Name'] || row['Name'] || row['วัตถุดิบ'] || row['Item'];
      if (!thaiName || String(thaiName).trim() === '') {
        return; // skip empty rows
      }

      const englishName = row['ชื่อภาษาอังกฤษ'] || row['English Name'] || row['En Name'] || thaiName;
      const code = row['รหัส'] || row['Code'] || `ING-IMP-${idx + 1}`;
      const category = row['หมวดหมู่'] || row['Category'] || 'Other';
      const purchaseUnit = (row['หน่วยซื้อ'] || row['Purchase Unit'] || row['Unit'] || 'kg').toLowerCase();
      const rawPrice = row['ราคาซื้อ'] || row['Purchase Price'] || row['Price'] || 0;
      const purchasePrice = parseFloat(rawPrice) || 0;
      const rawQty = row['ปริมาณที่ซื้อ'] || row['Purchase Qty'] || row['Qty'] || 1;
      const purchaseQuantity = parseFloat(rawQty) || 1;
      const rawYield = row['Yield'] || row['% Yield'] || row['เปอร์เซ็นต์ใช้ได้'] || 100;
      let yieldPercent = parseFloat(rawYield) || 100;

      // If yield entered as decimal e.g. 0.95 -> 95
      if (yieldPercent > 0 && yieldPercent <= 1) {
        yieldPercent = yieldPercent * 100;
      }

      // Check for suspicious calculations or Excel errors
      const strRow = JSON.stringify(row);
      if (strRow.includes('#DIV/0!') || strRow.includes('#REF!') || strRow.includes('#VALUE!') || strRow.includes('#N/A')) {
        result.errors.push(`แถวที่ ${rowNum} (${thaiName}): พบสูตร Excel ที่ผิดพลาด (${strRow.match(/#[A-Z0-9\/!]+/)?.[0] || 'Formula Error'})`);
      }

      if (purchasePrice <= 0) {
        result.warnings.push(`แถวที่ ${rowNum} (${thaiName}): ไม่พบราคาซื้อหรือราคาเป็น 0`);
      }

      let yieldType: 'loss' | 'absorption' = 'loss';
      if (yieldPercent > 100) {
        yieldType = 'absorption';
        result.warnings.push(`แถวที่ ${rowNum} (${thaiName}): Yield สูงกว่า 100% (${yieldPercent}%) ได้รับการจัดหมวดหมู่เป็น "การดูดซึมน้ำ/การขยายตัว" (Absorption Yield)`);
      }

      const usableQuantity = purchaseQuantity * (yieldPercent / 100);
      const effectiveCost = usableQuantity > 0 ? purchasePrice / usableQuantity : 0;
      const costPerBaseUnit = purchaseUnit === 'kg' || purchaseUnit === 'l'
        ? effectiveCost / 1000
        : effectiveCost;

      parsedIngredients.push({
        id: `ing-imported-${idx + 1}-${Date.now()}`,
        code: String(code),
        thaiName: String(thaiName),
        englishName: String(englishName),
        category: category as any,
        purchaseUnit: purchaseUnit as any,
        purchaseQuantity,
        purchasePrice,
        supplierName: row['ผู้จัดจำหน่าย'] || row['Supplier'] || 'ทั่วไป',
        preparationMethod: row['วิธีเตรียม'] || row['Preparation'] || '',
        yieldType,
        yieldPercent,
        usableQuantity,
        effectiveCost,
        baseUnit: purchaseUnit === 'l' || purchaseUnit === 'ml' ? 'ml' : purchaseUnit === 'egg' ? 'egg' : 'g',
        costPerBaseUnit,
        minimumStock: 0,
        currentStock: 0,
        active: true,
        priceHistory: [
          {
            id: `ph-imp-${idx}`,
            date: new Date().toISOString().split('T')[0],
            price: purchasePrice,
            quantity: purchaseQuantity,
            unit: purchaseUnit as any,
          },
        ],
        createdAt: new Date().toISOString().split('T')[0],
        updatedAt: new Date().toISOString().split('T')[0],
      });
    });

    result.importedIngredientsCount = parsedIngredients.length;
    result.parsedData.ingredients = parsedIngredients;
  }

  return result;
}

/**
 * Generate and Download Multi-Sheet Excel Workbook for the Restaurant
 */
export function exportRestaurantDataToExcel(
  ingredients: Ingredient[],
  subRecipes: SubRecipe[],
  menuItems: MenuItem[],
  channels: SalesChannel[],
  packaging: PackagingItem[],
  expenses: ExpenseRecord[],
  sales: DailySalesRecord[],
  mappings: ExcelMappingRow[]
) {
  const wb = XLSX.utils.book_new();

  // 1. Ingredients Sheet
  const ingRows = ingredients.map((ing) => ({
    'รหัส (Code)': ing.code,
    'ชื่อไทย (Thai Name)': ing.thaiName,
    'ชื่ออังกฤษ (English Name)': ing.englishName,
    'หมวดหมู่ (Category)': ing.category,
    'หน่วยซื้อ (Purchase Unit)': ing.purchaseUnit,
    'จำนวนซื้อ (Purchase Qty)': ing.purchaseQuantity,
    'ราคาซื้อ (Purchase Price ฿)': ing.purchasePrice,
    'Yield %': ing.yieldPercent,
    'ประเภท Yield': ing.yieldType === 'absorption' ? 'การดูดซึมน้ำ (>100%)' : 'การสูญเสียตัดแต่ง (<=100%)',
    'ปริมาณใช้ได้จริง (Usable Qty)': Number(ing.usableQuantity.toFixed(2)),
    'ต้นทุนต่อหน่วยใช้ได้จริง (Effective Cost ฿)': Number(ing.effectiveCost.toFixed(2)),
    'ต้นทุนต่อหน่วยฐาน (Base Cost ฿/g or ฿/ml)': Number(ing.costPerBaseUnit.toFixed(4)),
    'ซัพพลายเออร์ (Supplier)': ing.supplierName || '-',
    'สถานะ': ing.active ? 'ใช้งาน' : 'ระงับ',
  }));
  const wsIng = XLSX.utils.json_to_sheet(ingRows);
  XLSX.utils.book_append_sheet(wb, wsIng, '1_Ingredient_Master');

  // 2. Sub-Recipes & Sauces Sheet
  const subRows = subRecipes.map((sub) => ({
    'รหัส (Code)': sub.code,
    'ชื่อซอส/สูตรเตรียม (Thai Name)': sub.thaiName,
    'หมวดหมู่': sub.category,
    'จำนวนวัตถุดิบ (Items)': sub.items.length,
    'ปริมาณแบทช์รวม (Batch Qty)': sub.batchQuantity,
    'Yield เตรียม (%)': sub.preparationYieldPercent,
    'ปริมาณสุดท้ายที่ได้ (Final Output)': sub.finalBatchQuantity,
    'หน่วย': sub.outputUnit,
    'ต้นทุนรวมแบทช์ (Batch Cost ฿)': Number(sub.batchCost.toFixed(2)),
    'ต้นทุนต่อหน่วยผลลัพธ์ (Cost/Unit ฿)': Number(sub.costPerFinalUnit.toFixed(4)),
    'ใช้ในเมนู': (sub.dependentMenuIds || []).join(', ') || '-',
  }));
  const wsSub = XLSX.utils.json_to_sheet(subRows);
  XLSX.utils.book_append_sheet(wb, wsSub, '2_Sub_Recipes_Sauces');

  // 3. Menu Costing & Portions Sheet
  const menuRows: any[] = [];
  menuItems.forEach((menu) => {
    menu.portions.forEach((portion) => {
      menuRows.push({
        'รหัสเมนู': menu.code,
        'ชื่อเมนู (Thai Name)': menu.thaiName,
        'ชื่ออังกฤษ (English Name)': menu.englishName,
        'หมวดหมู่': menu.category,
        'ขนาดพอร์ชั่น (Portion)': portion.name,
        'ต้นทุนอาหารทางตรง (Food Cost ฿)': Number(portion.directFoodCost.toFixed(2)),
        'ค่าบรรจุภัณฑ์ (Packaging ฿)': Number(portion.packagingCost.toFixed(2)),
        'ต้นทุนทางตรงรวม (Total Direct Cost ฿)': Number(portion.totalDirectCost.toFixed(2)),
        'ราคาขาย (Selling Price ฿)': portion.sellingPrice,
        '% Food Cost': Number(portion.foodCostPercent.toFixed(2)) + '%',
        '% Gross Margin': Number(portion.grossMarginPercent.toFixed(2)) + '%',
        'กำไรส่วนเกินต่อจาน (Contribution Profit ฿)': Number(portion.contributionProfit.toFixed(2)),
      });
    });
  });
  const wsMenu = XLSX.utils.json_to_sheet(menuRows);
  XLSX.utils.book_append_sheet(wb, wsMenu, '3_Menu_Costing');

  // 4. Sales Channels & Fees Sheet
  const channelRows = channels.map((ch) => ({
    'รหัสช่องทาง': ch.code,
    'ชื่อช่องทางขาย': ch.name,
    'ค่าคอมมิชชั่น GP (%)': ch.commissionPercent + '%',
    'VAT บน GP (%)': ch.taxOnCommissionPercent + '%',
    'ค่าธรรมเนียมชำระเงิน (%)': ch.paymentFeePercent + '%',
    'ค่าธรรมเนียมคงที่ต่อออเดอร์ (฿)': ch.fixedFeePerOrder,
    'สถานะ': ch.active ? 'เปิดใช้งาน' : 'ปิด',
  }));
  const wsChannel = XLSX.utils.json_to_sheet(channelRows);
  XLSX.utils.book_append_sheet(wb, wsChannel, '4_Sales_Channels');

  // 5. Excel Mapping Reference Document
  const wsMap = XLSX.utils.json_to_sheet(mappings);
  XLSX.utils.book_append_sheet(wb, wsMap, '5_Excel_App_Mapping_Doc');

  // Write and trigger download
  const dateStr = new Date().toISOString().split('T')[0];
  XLSX.writeFile(wb, `Restaurant_Cost_Profit_Management_${dateStr}.xlsx`);
}

/**
 * Export Master Ingredients to CSV string
 */
export function exportMasterIngredientsToCSV(ingredients: Ingredient[]): string {
  const headers = ['รหัส', 'ชื่อไทย', 'ชื่ออังกฤษ', 'หมวดหมู่', 'ราคาซื้อ (฿)', 'หน่วยซื้อ', 'Yield %', 'ต้นทุนสุทธิ (฿)', 'ต้นทุนต่อหน่วยฐาน'];
  const rows = ingredients.map((i) => [
    i.code,
    `"${i.thaiName}"`,
    `"${i.englishName}"`,
    `"${i.category}"`,
    i.purchasePrice,
    i.purchaseUnit,
    i.yieldPercent,
    i.effectiveCost.toFixed(2),
    i.costPerBaseUnit.toFixed(4),
  ]);
  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

/**
 * Export Menu Engineering Items to CSV string
 */
export function exportMenuEngineeringToCSV(items: any[]): string {
  const headers = ['รหัส/ชื่อเมนู', 'จำนวนขาย (จาน)', 'ราคาขาย (฿)', 'ต้นทุนต่อจาน (฿)', 'กำไรส่วนเกิน (฿)'];
  const rows = items.map((i) => [
    `"${i.name}"`,
    i.quantitySold,
    i.sellingPrice,
    i.costPerPortion,
    i.contributionMargin,
  ]);
  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

/**
 * Export Financial Summary to CSV string
 */
export function exportFinancialSummaryToCSV(sales: any[], expenses: any[], settings: any): string {
  const grossSales = sales.reduce((s, x) => s + (x.grossSales || 0), 0);
  const discounts = sales.reduce((s, x) => s + (x.discounts || 0), 0);
  const netSales = grossSales - discounts;
  const opex = expenses.reduce((s, x) => s + (x.amount || 0), 0);

  const rows = [
    ['หัวข้อรายการ', 'จำนวนเงิน (฿)'],
    ['ยอดขายรวมก่อนหัก (Gross Sales)', grossSales],
    ['ส่วนลดและโปรโมชั่น (Discounts)', -discounts],
    ['ยอดขายสุทธิ (Net Sales)', netSales],
    ['ค่าใช้จ่ายดำเนินงานรวม (OPEX)', opex],
  ];
  return rows.map((r) => r.join(',')).join('\n');
}

/**
 * Parse ingredients from CSV text
 */
export function parseIngredientsFromCSV(csvText: string): Partial<Ingredient>[] {
  const lines = csvText.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length <= 1) return [];

  const results: Partial<Ingredient>[] = [];
  // Skip header
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.replace(/^"|"$/g, '').trim());
    if (cols.length >= 3 && cols[1]) {
      results.push({
        code: cols[0] || `ING-${i}`,
        thaiName: cols[1],
        purchasePrice: parseFloat(cols[4]) || parseFloat(cols[2]) || 100,
        purchaseUnit: (cols[5] || cols[3] || 'kg') as any,
        yieldPercent: parseFloat(cols[6]) || 100,
      });
    }
  }
  return results;
}

