import { describe, it, expect } from 'vitest';
import {
  resolveBillOrderType,
  buildSalesSummary,
  buildPaymentMethodsReport,
  buildCategorySalesReport,
  buildBestSellersReport,
  buildModifiersReport,
  buildMemberSalesReport,
  buildUserSalesReport,
  buildDiscountsReport,
  formatReportDateDisplay,
} from '../salesReports';
import { BillDoc, CategoryDoc, DishDoc, ShiftDoc } from '../../types';

function makeBill(overrides: Partial<BillDoc> = {}): BillDoc {
  return {
    id: 'bill_1',
    billNumber: 'T1-691125',
    status: 'paid',
    workDate: '2026-11-25',
    tableId: 't1',
    tableName: 'T1',
    channelId: 'dine_in',
    channelName: 'ทานที่ร้าน',
    orderType: 'dine_in',
    items: [
      {
        dishId: 'dish_1',
        dishName: 'ข้าวกะเพรา',
        variantId: 'v1',
        variantName: 'หมู',
        unitPrice: 80,
        dishCostSnapshot: 25,
        optionsCostSnapshot: 5,
        totalUnitCostSnapshot: 30,
        quantity: 2,
        options: [
          {
            groupId: 'g1',
            groupName: 'ท็อปปิ้ง',
            choiceId: 'c1',
            choiceName: 'ไข่ดาว',
            price: 15,
            cost: 5,
            quantity: 1,
          },
        ],
        hasRecipe: true,
      },
    ],
    subtotal: 160,
    discountAmount: 0,
    serviceChargeRate: 0,
    serviceChargeAmount: 0,
    vatRate: 7,
    vatAmount: 10.47,
    grandTotal: 160,
    netSales: 149.53,
    totalFoodCost: 60,
    packagingCost: 0,
    platformFee: 0,
    payments: [{ method: 'cash', amount: 160 }],
    paidAt: '2026-11-25T12:15:00.000Z',
    createdAt: '2026-11-25T12:00:00.000Z',
    updatedAt: '2026-11-25T12:15:00.000Z',
    version: 1,
    ...overrides,
  };
}

describe('salesReports engine', () => {
  it('resolves order types cleanly including legacy channel IDs', () => {
    expect(resolveBillOrderType(makeBill({ orderType: 'dine_in' }))).toBe('dine_in');
    expect(resolveBillOrderType(makeBill({ orderType: 'takeaway' }))).toBe('takeaway');
    expect(resolveBillOrderType(makeBill({ orderType: 'delivery' }))).toBe('delivery');
    expect(
      resolveBillOrderType(
        makeBill({ orderType: undefined as any, channelId: 'grab', tableId: null })
      )
    ).toBe('delivery');
  });

  it('builds channel breakdown and excludes voided/saved bills from sales while tracking refunds', () => {
    const bills: BillDoc[] = [
      makeBill({ id: 'b1', orderType: 'dine_in', grandTotal: 500, subtotal: 500, vatAmount: 32.71 }),
      makeBill({
        id: 'b2',
        orderType: 'takeaway',
        channelId: 'takeaway',
        grandTotal: 200,
        subtotal: 220,
        discountAmount: 20,
        packagingCost: 5,
        vatAmount: 13.08,
      }),
      makeBill({
        id: 'b3',
        orderType: 'delivery',
        channelId: 'delivery',
        grandTotal: 300,
        subtotal: 300,
        packagingCost: 10,
        serviceChargeAmount: 15,
        vatAmount: 19.63,
      }),
      makeBill({
        id: 'b_void',
        status: 'voided',
        orderType: 'dine_in',
        grandTotal: 150,
      }),
      makeBill({
        id: 'b_saved',
        status: 'saved',
        orderType: 'takeaway',
        grandTotal: 999,
      }),
    ];

    const summaryAll = buildSalesSummary(bills, 'all');
    expect(summaryAll.billCount).toBe(3);
    expect(summaryAll.totalReceived).toBe(1000);
    expect(summaryAll.avgPerBill).toBe(333.33);
    expect(summaryAll.discountTotal).toBe(20);
    expect(summaryAll.refundTotal).toBe(150);
    expect(summaryAll.refundCount).toBe(1);
    expect(summaryAll.serviceChargeTotal).toBe(15);
    expect(summaryAll.extraChargesTotal).toBe(15);
    expect(summaryAll.savedBills).toHaveLength(1);

    const allRow = summaryAll.channelRows.find((r) => r.id === 'all');
    const dineRow = summaryAll.channelRows.find((r) => r.id === 'dine_in');
    const takeRow = summaryAll.channelRows.find((r) => r.id === 'takeaway');
    const delivRow = summaryAll.channelRows.find((r) => r.id === 'delivery');

    expect(allRow).toEqual({ id: 'all', billCount: 3, receivedTotal: 1000 });
    expect(dineRow).toEqual({ id: 'dine_in', billCount: 1, receivedTotal: 500 });
    expect(takeRow).toEqual({ id: 'takeaway', billCount: 1, receivedTotal: 200 });
    expect(delivRow).toEqual({ id: 'delivery', billCount: 1, receivedTotal: 300 });

    const summaryDelivery = buildSalesSummary(bills, 'delivery');
    expect(summaryDelivery.billCount).toBe(1);
    expect(summaryDelivery.totalReceived).toBe(300);
    expect(summaryDelivery.refundTotal).toBe(0);
  });

  it('aggregates split payment methods and legacy bills without payment array', () => {
    const bills: BillDoc[] = [
      makeBill({
        id: 'b1',
        grandTotal: 300,
        payments: [
          { method: 'cash', amount: 100 },
          { method: 'qr', amount: 200 },
        ],
      }),
      makeBill({
        id: 'b2',
        grandTotal: 100,
        payments: [],
      }),
    ];

    const stats = buildPaymentMethodsReport(bills);
    const cash = stats.find((s) => s.method === 'cash')!;
    const qr = stats.find((s) => s.method === 'qr')!;
    expect(cash.amount).toBe(200);
    expect(cash.billCount).toBe(2);
    expect(cash.sharePercent).toBe(50);
    expect(qr.amount).toBe(200);
    expect(qr.billCount).toBe(1);
    expect(qr.sharePercent).toBe(50);
  });

  it('aggregates category sales, best sellers, and modifiers accurately', () => {
    const categories: CategoryDoc[] = [
      {
        id: 'cat_main',
        name: 'Main',
        nameTh: 'จานหลัก',
        order: 1,
        createdAt: '',
        updatedAt: '',
        version: 1,
      },
    ];
    const dishes: DishDoc[] = [
      {
        id: 'dish_1',
        name: 'Kaprao',
        nameTh: 'กะเพรา',
        categoryId: 'cat_main',
        variants: [],
        optionGroupIds: [],
        order: 1,
        createdAt: '',
        updatedAt: '',
        version: 1,
      },
    ];
    const bills: BillDoc[] = [
      makeBill({
        items: [
          {
            dishId: 'dish_1',
            dishName: 'ข้าวกะเพรา',
            variantId: 'v1',
            variantName: 'หมู',
            unitPrice: 95,
            dishCostSnapshot: 25,
            optionsCostSnapshot: 5,
            totalUnitCostSnapshot: 30,
            quantity: 3,
            options: [
              {
                groupId: 'g1',
                groupName: 'เพิ่มไข่',
                choiceId: 'c1',
                choiceName: 'ไข่ดาว',
                price: 15,
                cost: 5,
                quantity: 2,
              },
            ],
            hasRecipe: true,
          },
        ],
      }),
    ];

    const catStats = buildCategorySalesReport(bills, dishes, categories, 'th');
    expect(catStats).toHaveLength(1);
    expect(catStats[0].categoryName).toBe('จานหลัก');
    expect(catStats[0].quantity).toBe(3);
    expect(catStats[0].revenue).toBe(285);

    const best = buildBestSellersReport(bills);
    expect(best[0].dishName).toBe('ข้าวกะเพรา');
    expect(best[0].quantity).toBe(3);

    const mods = buildModifiersReport(bills);
    expect(mods).toHaveLength(1);
    expect(mods[0].choiceName).toBe('ไข่ดาว');
    expect(mods[0].quantity).toBe(6); // 2 options per dish * 3 dishes
    expect(mods[0].revenue).toBe(45); // 15 per dish * 3 dishes
  });

  it('builds member, user/shift, and discount reports plus Thai date display', () => {
    const shift: ShiftDoc = {
      id: 'shift_1',
      openedAt: '2026-11-25T08:00:00.000Z',
      startingCash: 1000,
      status: 'open',
      workDate: '2026-11-25',
      createdAt: '2026-11-25T08:00:00.000Z',
      updatedAt: '2026-11-25T08:00:00.000Z',
      version: 1,
    };

    const bills: BillDoc[] = [
      makeBill({
        id: 'b1',
        memberId: 'm1',
        memberName: 'คุณสมชาย',
        pointsEarned: 5,
        pointsRedeemed: 10,
        discountAmount: 25,
        grandTotal: 400,
      }),
      makeBill({
        id: 'b2',
        grandTotal: 100,
      }),
    ];

    const members = buildMemberSalesReport(bills, 'th');
    expect(members).toHaveLength(2);
    expect(members[0].name).toBe('คุณสมชาย');
    expect(members[0].pointsEarned).toBe(5);

    const users = buildUserSalesReport(bills, [shift], 'owner@shop.com', 'th');
    expect(users).toHaveLength(1);
    expect(users[0].billCount).toBe(2);
    expect(users[0].totalReceived).toBe(500);

    const discounts = buildDiscountsReport(bills);
    expect(discounts.discountedBillCount).toBe(1);
    expect(discounts.totalDiscount).toBe(25);
    expect(discounts.totalPointsRedeemed).toBe(10);

    const formatted = formatReportDateDisplay('2026-11-25', '2026-11-25', 'th');
    expect(formatted).toContain('25-11-2026');
  });
});
