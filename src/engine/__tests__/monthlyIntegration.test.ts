import { describe, it, expect } from 'vitest';
import {
  buildPeriodPnl,
  buildPnlCsvRows,
  calculatePeriodExpensesAndLabor,
  calculateUsaliPnl,
  deriveVariableCostPercent,
  getEmployeeMonthlyCost,
  isExplicitPayrollExpense,
  normalizeToMonthly,
  roundTo2,
} from '../calculations';
import { calculateDetailedBreakEven } from '../../costing/engine/calculations';
import { auditDataHealth } from '../dataHealth';
import {
  DailySummaryDoc,
  DishDoc,
  EmployeeDoc,
  ExpenseDoc,
  IngredientDoc,
  SubRecipeDoc,
} from '../../types';
import { Ingredient, MenuItem, PurchaseRecord, Sauce, StockCountSnapshot, WasteRecord } from '../../costing/types';
import { DailySalesRecord, ExpenseRecord } from '../../costing/types/domain';

describe('1-Month Full Integration Proof: Cross-Screen Parity, Accounting Identity & Period Sum', () => {
  // Build clean 30-day dataset for September 2026 (2026-09-01 .. 2026-09-30)
  // Every figure divides cleanly by 30 so 30 daily sums match the monthly P&L without satang drift.
  const days = Array.from({ length: 30 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`);

  const summaries: DailySummaryDoc[] = days.map((date) => ({
    id: date,
    date,
    orderCount: 40, // 40 * 30 = 1,200 orders/mo
    grossSales: 10700, // 10,000 net ex-VAT + 700 VAT (reference only)
    discounts: 0,
    netSales: 10000, // 300,000 THB/mo ex-VAT
    serviceCharge: 400, // 12,000 THB/mo staff pool
    vat: 700,
    totalFoodCost: 3200, // 96,000 THB/mo (32.0%)
    packagingCost: 300, // 9,000 THB/mo (3.0%)
    platformFees: 1200, // 36,000 THB/mo (12.0%)
    paymentTotals: { cash: 4000, qr: 4000, card: 1500, transfer: 500 },
    channelTotals: {
      dine_in: {
        orderCount: 25,
        netSales: 6250,
        grossSales: 6687.5,
        discounts: 0,
        platformFees: 0,
        totalFoodCost: 2000,
        packagingCost: 0,
        serviceCharge: 400,
      },
      grab: {
        orderCount: 15,
        netSales: 3750,
        grossSales: 4012.5,
        discounts: 0,
        platformFees: 1200,
        totalFoodCost: 1200,
        packagingCost: 300,
        serviceCharge: 0,
      },
    },
    dishStats: {
      dish_kaprow: {
        dishId: 'dish_kaprow',
        dishName: 'กะเพรา',
        quantity: 60,
        revenue: 10000,
        cost: 3200,
      },
    },
    createdAt: `${date}T22:00:00Z`,
    updatedAt: `${date}T22:00:00Z`,
    version: 1,
  }));

  const employees: EmployeeDoc[] = [
    {
      id: 'emp_chef',
      name: 'เชฟต้น',
      role: 'Head Chef',
      department: 'kitchen',
      roleCategory: 'direct_kitchen',
      wageType: 'monthly',
      wageAmount: 27000,
      benefitsMonthly: 3000, // 30,000 THB/mo => 1,000/day
      isActive: true,
      createdAt: '2026-09-01',
      updatedAt: '2026-09-01',
      version: 1,
    },
    {
      id: 'emp_foh',
      name: 'สมชาย',
      role: 'Cashier & Server',
      department: 'front_of_house',
      roleCategory: 'direct_service',
      wageType: 'monthly',
      wageAmount: 15000, // 15,000 THB/mo
      isActive: true,
      createdAt: '2026-09-01',
      updatedAt: '2026-09-01',
      version: 1,
    },
    {
      id: 'emp_hourly',
      name: 'นุ่น',
      role: 'Part-time Server',
      department: 'front_of_house',
      roleCategory: 'direct_service',
      wageType: 'hourly',
      wageAmount: 60,
      workDaysOrHoursPerMonth: 150, // 60 * 150 = 9,000 THB/mo (total FOH = 24,000 => 800/day)
      isActive: true,
      createdAt: '2026-09-01',
      updatedAt: '2026-09-01',
      version: 1,
    },
  ];

  const expenses: ExpenseDoc[] = [
    {
      id: 'exp_rent',
      title: 'Store Rent',
      category: 'rent',
      amount: 21000, // fixed 700/day
      date: '2026-09-01',
      isFixed: true,
      isRecurring: true,
      createdAt: '2026-09-01',
      updatedAt: '2026-09-01',
      version: 1,
    },
    {
      id: 'exp_elec',
      title: 'Electricity',
      category: 'electricity',
      amount: 6000, // fixed 200/day => total fixed OPEX = 27,000/mo (900/day)
      date: '2026-09-01',
      isFixed: true,
      isRecurring: true,
      createdAt: '2026-09-01',
      updatedAt: '2026-09-01',
      version: 1,
    },
    {
      id: 'exp_supplies',
      title: 'Cleaning & Gas Variable',
      category: 'supplies',
      amount: 9000, // recurring variable 300/day => total OPEX = 36,000/mo (1,200/day)
      date: '2026-09-01',
      isFixed: false,
      isRecurring: true,
      createdAt: '2026-09-01',
      updatedAt: '2026-09-01',
      version: 1,
    },
  ];

  // Beginning stock (2026-08-31): 50,000 + Sept Food Purchases: 102,000 - Ending stock (2026-09-30): 56,000 = 96,000
  const stockCountSnapshots: StockCountSnapshot[] = [
    { id: 'sc_begin', date: '2026-08-31', totalValue: 50000 },
    { id: 'sc_end', date: '2026-09-30', totalValue: 56000 },
  ];

  const purchases: PurchaseRecord[] = [
    {
      id: 'pur_food_1',
      date: '2026-09-10',
      supplierName: 'Makro',
      ingredientId: 'ing_pork',
      ingredientName: 'หมูสับ',
      quantity: 100,
      unit: 'g',
      totalPrice: 102000,
    },
    {
      id: 'pur_pkg_1',
      date: '2026-09-12',
      supplierName: 'Packaging Co',
      ingredientId: 'ing_box',
      ingredientName: 'กล่องอาหาร',
      quantity: 1000,
      unit: 'แพ็ค',
      category: 'บรรจุภัณฑ์',
      isPackaging: true,
      totalPrice: 9000, // excluded from food purchases
    },
  ];

  const wasteLog: WasteRecord[] = [
    {
      id: 'w_1',
      date: '2026-09-18',
      ingredientId: 'ing_pork',
      ingredientName: 'หมูสับ',
      quantity: 10,
      unit: 'g',
      cost: 2500,
      totalCost: 2500,
      user: 'Chef',
    },
  ];

  const settings = {
    serviceChargeTreatment: 'staff_pool' as const,
    vatPercent: 7,
    incomeTaxRatePercent: 20,
    cogsVarianceThresholdPercent: 3,
    socialSecurityEnabled: false,
  };

  it('matches hand calculation down to every baht and aligns Overview, P&L Statement, CSV Export, Break-Even, Labor %, and USALI', () => {
    const monthlyPnl = buildPeriodPnl({
      summaries,
      expenses,
      employees,
      period: 'month',
      dateParam: '2026-09',
      settings,
      cogsMode: 'actual',
      stockCountSnapshots,
      purchases,
      wasteLog,
      todayDate: '2026-10-05',
    });

    // Hand calculation proof (September 2026)
    expect(monthlyPnl.netSalesExVat).toBe(300000);
    expect(monthlyPnl.totalRevenue).toBe(300000);
    expect(monthlyPnl.foodCogs).toBe(96000); // 50,000 + 102,000 - 56,000 (waste 2,500 NOT subtracted)
    expect(monthlyPnl.packagingCogs).toBe(9000);
    expect(monthlyPnl.totalCogs).toBe(105000);
    expect(monthlyPnl.grossProfit).toBe(195000);
    expect(monthlyPnl.grossMarginPercent).toBe(65);
    expect(monthlyPnl.channelFees).toBe(36000);
    expect(monthlyPnl.kitchenLabor).toBe(30000);
    expect(monthlyPnl.fohLabor).toBe(24000);
    expect(monthlyPnl.totalLabor).toBe(54000);
    expect(monthlyPnl.laborPercent).toBe(18);
    expect(monthlyPnl.primeCost).toBe(159000); // 105,000 + 54,000
    expect(monthlyPnl.primeCostPercent).toBe(53);
    expect(monthlyPnl.fixedExpenses).toBe(27000);
    expect(monthlyPnl.variableExpenses).toBe(9000);
    expect(monthlyPnl.opex).toBe(36000);
    expect(monthlyPnl.operatingProfit).toBe(69000); // 195,000 - 36,000 - 54,000 - 36,000
    expect(monthlyPnl.operatingMarginPercent).toBe(23);
    expect(monthlyPnl.estimatedTax).toBe(13800); // 20% of 69,000
    expect(monthlyPnl.netProfit).toBe(55200); // 69,000 - 13,800
    expect(monthlyPnl.netMarginPercent).toBe(18.4);
    expect(monthlyPnl.wasteMemo).toBe(2500);
    expect(monthlyPnl.periodPackagingPurchasesExcluded).toBe(9000);
    expect(monthlyPnl.cogsStatus).toBe('complete');

    // Accounting identity check: Net Sales - every expense line = Net Profit
    expect(roundTo2(monthlyPnl.totalRevenue - monthlyPnl.totalCogs)).toBe(monthlyPnl.grossProfit);
    expect(
      roundTo2(
        monthlyPnl.grossProfit -
          monthlyPnl.channelFees -
          monthlyPnl.totalLabor -
          monthlyPnl.opex
      )
    ).toBe(monthlyPnl.operatingProfit);
    expect(roundTo2(monthlyPnl.operatingProfit - monthlyPnl.estimatedTax)).toBe(
      monthlyPnl.netProfit
    );

    // USALI calculator uses the same source totals
    const periodExpLabor = calculatePeriodExpensesAndLabor(
      'month',
      '2026-09',
      expenses,
      employees,
      summaries
    );
    const usali = calculateUsaliPnl(summaries, periodExpLabor, 'staff_pool');
    expect(usali.totalRevenue).toBe(monthlyPnl.totalRevenue);
    expect(usali.totalFoodCost).toBe(monthlyPnl.foodCogs);
    expect(usali.grossProfit).toBe(monthlyPnl.grossProfit);
    expect(usali.primeCost).toBe(monthlyPnl.primeCost);
    expect(usali.netOperatingProfit).toBe(monthlyPnl.operatingProfit);

    // LaborView equivalence check
    const activeRosterMonthly = employees.reduce((s, e) => s + getEmployeeMonthlyCost(e), 0);
    expect(activeRosterMonthly).toBe(monthlyPnl.totalLabor);
    const laborViewPercent = roundTo2((monthlyPnl.totalLabor / monthlyPnl.netSalesExVat) * 100);
    expect(laborViewPercent).toBe(monthlyPnl.laborPercent);

    // Break-Even View & Executive Overview Break-Even check
    // Food 32% + Pkg 3% + Fees 12% + VarExp (9,000/300,000 = 3%) = 50% variable => CM% = 50%
    const derivedCm = deriveVariableCostPercent(summaries, {
      otherVariableCostAmount: monthlyPnl.variableExpenses,
    });
    expect(derivedCm.foodCostPercent).toBe(32);
    expect(derivedCm.packagingPercent).toBe(3);
    expect(derivedCm.platformFeePercent).toBe(12);
    expect(derivedCm.otherVariableCostPercent).toBe(3);
    expect(derivedCm.variableCostPercent).toBe(50);
    expect(derivedCm.contributionMarginPercent).toBe(50);

    // Fixed Costs = Fixed Expenses (27,000) + Total Labor (54,000) = 81,000
    // Break-Even Monthly = 81,000 / 0.50 = 162,000 THB
    // Normalized Monthly Net Sales = 300,000 => Safety Margin = 138,000 (46%)
    const normalizedMonthlySales = normalizeToMonthly(
      monthlyPnl.netSalesExVat,
      'month',
      monthlyPnl.coveredMonths,
      '2026-09'
    );
    const executiveBe = calculateDetailedBreakEven(
      monthlyPnl.fixedExpenses + monthlyPnl.totalLabor,
      derivedCm.contributionMarginPercent,
      monthlyPnl.avgOrderValue,
      30,
      0,
      normalizedMonthlySales
    );
    expect(roundTo2(executiveBe.breakEvenSales)).toBe(162000);
    expect(roundTo2(executiveBe.breakEvenDailySales)).toBe(5400);
    expect(roundTo2(executiveBe.safetyMarginRevenue)).toBe(138000);
    expect(roundTo2(executiveBe.safetyMarginPercent)).toBe(46);

    // Export CSV rows consume the exact same numbers as P&L Statement and Break-Even
    const csvRows = buildPnlCsvRows(monthlyPnl, executiveBe.breakEvenSales);
    const csvMap = new Map(csvRows.map(([k, v]) => [k, v]));
    expect(csvMap.get('Period')).toBe('month:2026-09');
    expect(csvMap.get('Net Sales (ex-VAT)')).toBe('300000.00');
    expect(csvMap.get('Food COGS')).toBe('96000.00');
    expect(csvMap.get('Packaging COGS')).toBe('9000.00');
    expect(csvMap.get('Gross Profit')).toBe('195000.00');
    expect(csvMap.get('Channel / Platform Fees (GP)')).toBe('36000.00');
    expect(csvMap.get('Total Labor (All Staff)')).toBe('54000.00');
    expect(csvMap.get('Prime Cost (Total COGS + Total Labor)')).toBe('159000.00');
    expect(csvMap.get('Operating Expenses (OPEX)')).toBe('36000.00');
    expect(csvMap.get('Operating Profit (กำไรจากการดำเนินงาน)')).toBe('69000.00');
    expect(csvMap.get('Estimated Tax (Confirm with Accountant)')).toBe('13800.00');
    expect(csvMap.get('Net Profit')).toBe('55200.00');
    expect(csvMap.get('Monthly Break-Even Target')).toBe('162000.00');
  });

  it('proves sum of 30 daily P&Ls equals the monthly P&L (with no one-off expenses) and year period respects active months', () => {
    const monthlyPnl = buildPeriodPnl({
      summaries,
      expenses,
      employees,
      period: 'month',
      dateParam: '2026-09',
      settings,
      cogsMode: 'estimated',
    });

    const dailyPnls = days.map((d) =>
      buildPeriodPnl({
        summaries,
        expenses,
        employees,
        period: 'day',
        dateParam: d,
        settings,
        cogsMode: 'estimated',
      })
    );

    const sumField = (fn: (p: typeof monthlyPnl) => number) =>
      roundTo2(dailyPnls.reduce((acc, p) => acc + fn(p), 0));

    expect(sumField((p) => p.netSalesExVat)).toBe(monthlyPnl.netSalesExVat);
    expect(sumField((p) => p.foodCogs)).toBe(monthlyPnl.foodCogs);
    expect(sumField((p) => p.packagingCogs)).toBe(monthlyPnl.packagingCogs);
    expect(sumField((p) => p.grossProfit)).toBe(monthlyPnl.grossProfit);
    expect(sumField((p) => p.channelFees)).toBe(monthlyPnl.channelFees);
    expect(sumField((p) => p.kitchenLabor)).toBe(monthlyPnl.kitchenLabor);
    expect(sumField((p) => p.fohLabor)).toBe(monthlyPnl.fohLabor);
    expect(sumField((p) => p.totalLabor)).toBe(monthlyPnl.totalLabor);
    expect(sumField((p) => p.fixedExpenses)).toBe(monthlyPnl.fixedExpenses);
    expect(sumField((p) => p.variableExpenses)).toBe(monthlyPnl.variableExpenses);
    expect(sumField((p) => p.opex)).toBe(monthlyPnl.opex);
    expect(sumField((p) => p.operatingProfit)).toBe(monthlyPnl.operatingProfit);
    expect(sumField((p) => p.estimatedTax)).toBe(monthlyPnl.estimatedTax);
    expect(sumField((p) => p.netProfit)).toBe(monthlyPnl.netProfit);

    // Every individual day normalized to monthly equals 300,000 THB and keeps Labor % = 18%
    expect(dailyPnls[0].laborPercent).toBe(18);
    expect(
      roundTo2(
        normalizeToMonthly(
          dailyPnls[0].netSalesExVat,
          'day',
          dailyPnls[0].coveredMonths,
          '2026-09-01'
        )
      )
    ).toBe(300000);

    // Year view (2026) anchored cleanly when summaries/expenses start in 2026-09 through 2026-11
    const yearPnl = buildPeriodPnl({
      summaries,
      expenses,
      employees,
      period: 'year',
      dateParam: '2026',
      settings,
      cogsMode: 'estimated',
    });
    expect(yearPnl.netSalesExVat).toBe(300000);
    expect(yearPnl.coveredMonths).toBeGreaterThanOrEqual(1);
    // In year view, normalized monthly fixed/labor scales by active coveredMonths consistently
    expect(roundTo2(yearPnl.totalLabor)).toBe(roundTo2(54000 * yearPnl.coveredMonths));
    expect(roundTo2(yearPnl.opex)).toBe(roundTo2(36000 * yearPnl.coveredMonths));
  });

  it('Data Health audit passes when data is clean and detects all 6 warning categories accurately', () => {
    const healthyIngredients: Ingredient[] = [
      {
        id: 'ing_1',
        name: 'หมูสับ',
        category: 'เนื้อสัตว์และอาหารทะเล',
        purchaseQuantity: 1000,
        purchaseUnit: 'g',
        purchasePrice: 150,
        actualQuantity: 1000,
        actualUnit: 'g',
        yieldPercent: 100,
        actualCost: 150,
        baseUnit: 'g',
        costPerBaseUnit: 0.15,
        usageUnit: 'g',
        active: true,
        createdAt: '',
        updatedAt: '',
      },
    ];
    const healthySauces: Sauce[] = [
      {
        id: 'sauce_1',
        name: 'ซอสกะเพรา',
        productionQuantity: 500,
        productionUnit: 'g',
        yieldPercent: 100,
        actualQuantity: 500,
        productionCost: 100,
        actualCost: 100,
        costPerGram: 0.2,
        items: [],
        active: true,
        createdAt: '',
        updatedAt: '',
      },
    ];
    const healthyMenus: MenuItem[] = [
      {
        id: 'menu_1',
        name: 'กะเพรา',
        category: 'จานหลัก',
        active: true,
        variants: [
          {
            id: 'var_1',
            menuId: 'menu_1',
            name: 'กะเพราหมูสับ',
            proteinType: 'หมู',
            sellingPrice: 65,
            takeawayPrice: 70,
            deliveryPrice: 90,
            overheadCost: 0,
            active: true,
            recipeItems: [
              {
                ingredientId: 'ing_1',
                name: 'หมูสับ',
                quantity: 100,
                unit: 'g',
              },
            ],
          },
        ],
      },
    ];

    const cleanReport = auditDataHealth({
      period: 'month',
      dateParam: '2026-09',
      todayDate: '2026-10-05',
      costIngredients: healthyIngredients,
      posIngredients: [],
      costMenus: healthyMenus,
      posDishes: [],
      manualSales: [
        {
          id: 'manual_1',
          date: '2026-09-10',
          channelId: 'catering',
          channelName: 'Catering',
          orderCount: 1,
          grossSales: 5000,
          discounts: 0,
          refunds: 0,
          netSales: 5000,
          platformFees: 0,
          actualPayout: 5000,
          foodCost: 1600,
        },
      ],
      stockCountSnapshots,
      expenses: [
        {
          id: 'e1',
          date: '2026-09-01',
          category: 'Rent',
          description: 'ค่าเช่าร้าน',
          amount: 21000,
          paymentMethod: 'Bank Transfer',
          isFixed: true,
          recurring: true,
        },
      ],
      employees: employees.map((e) => ({ id: e.id, name: e.name, isActive: e.isActive })),
      costSauces: healthySauces,
      posSubRecipes: [],
    });

    expect(cleanReport.isHealthy).toBe(true);
    expect(cleanReport.passedCount).toBe(6);
    expect(cleanReport.totalIssueCount).toBe(0);

    // Now trigger ALL 6 data health defects simultaneously
    const dirtyPosIngredients: IngredientDoc[] = [
      {
        id: 'pos_ing_zero',
        name: 'Watercress',
        nameTh: 'ผักชี (POS)',
        purchaseUnit: 'g',
        purchasePrice: 0,
        purchaseQuantity: 100,
        yieldPercent: 100,
        baseUnit: 'g',
        costPerBaseUnit: 0,
        createdAt: '',
        updatedAt: '',
        version: 1,
      },
    ];
    const dirtyPosDishes: DishDoc[] = [
      {
        id: 'pos_dish_norecipe',
        name: 'Fried Egg',
        nameTh: 'ไข่ดาว (ไร้สูตร)',
        categoryId: 'cat1',
        optionGroupIds: [],
        order: 1,
        variants: [
          {
            id: 'pos_var_norecipe',
            name: 'Regular',
            price: 15,
            ingredients: [],
            subRecipes: [],
            packaging: [],
          },
        ],
        createdAt: '',
        updatedAt: '',
        version: 1,
      },
    ];
    const dirtyPosSubRecipes: SubRecipeDoc[] = [
      {
        id: 'pos_sub_zero',
        name: 'Chili Fish Sauce',
        nameTh: 'พริกน้ำปลา (ยังไม่กรอกปริมาณสุทธิ)',
        outputUnit: 'ml',
        outputQuantity: 0,
        ingredients: [],
        createdAt: '',
        updatedAt: '',
        version: 1,
      },
    ];
    const dirtyManualSales: DailySalesRecord[] = [
      {
        id: 'manual_nocost',
        date: '2026-09-15',
        channelId: 'walkin',
        channelName: 'ออกบูธ',
        orderCount: 10,
        grossSales: 4000,
        discounts: 0,
        refunds: 0,
        netSales: 4000,
        platformFees: 0,
        actualPayout: 4000,
      },
    ];
    const dirtyExpenses: ExpenseRecord[] = [
      {
        id: 'exp_payroll_dup',
        date: '2026-09-30',
        category: 'Labor (Salary & Wages)',
        description: 'จ่ายเงินเดือนพนักงาน ก.ย.',
        amount: 54000,
        paymentMethod: 'Bank Transfer',
        isFixed: true,
        isPayroll: true,
      },
    ];

    expect(isExplicitPayrollExpense(dirtyExpenses[0])).toBe(true);

    const dirtyReport = auditDataHealth({
      period: 'month',
      dateParam: '2026-09',
      todayDate: '2026-10-05',
      costIngredients: [
        {
          ...healthyIngredients[0],
          id: 'ing_zero',
          name: 'กระเทียม',
          purchasePrice: 0,
          costPerBaseUnit: 0,
        },
      ],
      posIngredients: dirtyPosIngredients,
      costMenus: [
        {
          ...healthyMenus[0],
          id: 'menu_norecipe',
          name: 'ข้าวเปล่า',
          variants: [
            {
              ...healthyMenus[0].variants[0],
              id: 'var_norecipe',
              name: 'ธรรมดา',
              recipeItems: [],
            },
          ],
        },
      ],
      posDishes: dirtyPosDishes,
      manualSales: dirtyManualSales,
      stockCountSnapshots: [], // Missing both beginning and ending snapshots
      expenses: dirtyExpenses,
      employees: employees.map((e) => ({ id: e.id, name: e.name, isActive: e.isActive })),
      excludePayrollDuplicates: false,
      costSauces: [{ ...healthySauces[0], id: 'sauce_zero', name: 'น้ำซุป', actualQuantity: 0 }],
      posSubRecipes: dirtyPosSubRecipes,
    });

    expect(dirtyReport.isHealthy).toBe(false);
    expect(dirtyReport.passedCount).toBe(0);
    expect(dirtyReport.checks.every((c) => !c.passed)).toBe(true);

    const byId = new Map(dirtyReport.checks.map((c) => [c.id, c]));
    expect(byId.get('zero_price_ingredients')?.count).toBe(2); // 1 costing + 1 POS
    expect(byId.get('menus_without_recipe')?.count).toBe(2); // 1 costing + 1 POS
    expect(byId.get('uncosted_manual_sales')?.count).toBe(1);
    expect(byId.get('missing_stock_counts')?.count).toBe(2); // beginning & ending
    expect(byId.get('duplicate_payroll')?.count).toBe(1);
    expect(byId.get('duplicate_payroll')?.severity).toBe('critical');
    expect(byId.get('sauces_without_net_qty')?.count).toBe(2); // 1 costing + 1 POS
  });
});
