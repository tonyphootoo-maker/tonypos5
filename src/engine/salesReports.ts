import {
  BillDoc,
  CategoryDoc,
  DishDoc,
  Language,
  OrderType,
  PaymentMethod,
  ShiftDoc,
} from '../types';
import { roundTo2 } from './calculations';

export type SalesReportTabId =
  | 'sales_summary'
  | 'payment_methods'
  | 'by_user'
  | 'by_member'
  | 'taxes_fees'
  | 'by_category'
  | 'best_sellers'
  | 'modifiers'
  | 'discounts'
  | 'bill_list';

export type ReportChannelFilter = 'all' | OrderType;

export interface ChannelSummaryRow {
  id: ReportChannelFilter;
  billCount: number;
  receivedTotal: number;
}

export interface SalesSummaryMetrics {
  paidBills: BillDoc[];
  voidedBills: BillDoc[];
  savedBills: BillDoc[];
  channelRows: ChannelSummaryRow[];
  billCount: number;
  customerCount: number;
  totalReceived: number;
  avgPerCustomer: number;
  avgPerBill: number;
  subtotal: number;
  discountTotal: number;
  refundTotal: number;
  refundCount: number;
  serviceChargeTotal: number;
  extraChargesTotal: number; // packaging + platform fee
  packagingTotal: number;
  platformFeeTotal: number;
  vatTotal: number;
  netSalesTotal: number;
}

export interface PaymentMethodStat {
  method: PaymentMethod;
  transactionCount: number;
  billCount: number;
  amount: number;
  sharePercent: number;
}

export interface CategorySalesStat {
  categoryId: string;
  categoryName: string;
  quantity: number;
  revenue: number;
  sharePercent: number;
}

export interface BestSellerItemStat {
  dishId: string;
  dishName: string;
  quantity: number;
  revenue: number;
  sharePercent: number;
  variants: { variantName: string; quantity: number; revenue: number }[];
}

export interface ModifierSalesStat {
  key: string;
  groupName: string;
  choiceName: string;
  quantity: number;
  revenue: number;
}

export interface MemberSalesStat {
  key: string;
  name: string;
  phone?: string;
  isRegisteredMember: boolean;
  billCount: number;
  totalSpent: number;
  pointsEarned: number;
  pointsRedeemed: number;
}

export interface UserSalesStat {
  key: string;
  label: string;
  subLabel?: string;
  billCount: number;
  totalReceived: number;
  netSales: number;
}

export interface DiscountSummaryMetrics {
  totalDiscount: number;
  totalPointsRedeemed: number;
  discountedBillCount: number;
  avgDiscountPerBill: number;
  bills: BillDoc[];
}

/**
 * Resolves a bill's canonical order channel (`dine_in` | `takeaway` | `delivery`),
 * handling legacy channel IDs safely.
 */
export function resolveBillOrderType(bill: BillDoc): OrderType {
  if (bill.orderType === 'dine_in' || bill.orderType === 'takeaway' || bill.orderType === 'delivery') {
    return bill.orderType;
  }
  const chId = (bill.channelId || '').toLowerCase();
  if (chId.includes('take')) return 'takeaway';
  if (chId.includes('deliv') || chId.includes('grab') || chId.includes('line')) return 'delivery';
  return 'dine_in';
}

export function filterBillsByChannel(
  bills: BillDoc[],
  channelFilter: ReportChannelFilter
): BillDoc[] {
  if (channelFilter === 'all') return bills;
  return bills.filter((bill) => resolveBillOrderType(bill) === channelFilter);
}

/**
 * Formats a YYYY-MM-DD date string into Thai/English report header display,
 * e.g. `วันพุธ 25-11-2026` or `Wednesday 25-11-2026`.
 */
export function formatReportDateDisplay(
  startDate: string,
  endDate: string,
  lang: Language
): string {
  const formatSingle = (isoDate: string): string => {
    const parts = isoDate.split('-').map((n) => parseInt(n, 10));
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return isoDate;
    const [year, month, day] = parts;
    const d = new Date(year, month - 1, day);
    const weekday = d.toLocaleDateString(lang === 'th' ? 'th-TH' : 'en-US', {
      weekday: 'long',
    });
    const dd = String(day).padStart(2, '0');
    const mm = String(month).padStart(2, '0');
    return `${weekday} ${dd}-${mm}-${year}`;
  };

  if (!startDate) return '';
  if (!endDate || startDate === endDate) {
    return formatSingle(startDate);
  }
  const formatShort = (isoDate: string) => {
    const [y, m, d] = isoDate.split('-');
    return d && m && y ? `${d}-${m}-${y}` : isoDate;
  };
  return `${formatShort(startDate)} — ${formatShort(endDate)}`;
}

export function buildSalesSummary(
  allBillsInPeriod: BillDoc[],
  channelFilter: ReportChannelFilter
): SalesSummaryMetrics {
  const allPaid = allBillsInPeriod.filter((b) => b.status === 'paid');
  const dineInPaid = allPaid.filter((b) => resolveBillOrderType(b) === 'dine_in');
  const takeawayPaid = allPaid.filter((b) => resolveBillOrderType(b) === 'takeaway');
  const deliveryPaid = allPaid.filter((b) => resolveBillOrderType(b) === 'delivery');

  const sumGrandTotal = (list: BillDoc[]) =>
    roundTo2(list.reduce((acc, b) => acc + (Number(b.grandTotal) || 0), 0));

  const channelRows: ChannelSummaryRow[] = [
    { id: 'all', billCount: allPaid.length, receivedTotal: sumGrandTotal(allPaid) },
    { id: 'dine_in', billCount: dineInPaid.length, receivedTotal: sumGrandTotal(dineInPaid) },
    { id: 'takeaway', billCount: takeawayPaid.length, receivedTotal: sumGrandTotal(takeawayPaid) },
    { id: 'delivery', billCount: deliveryPaid.length, receivedTotal: sumGrandTotal(deliveryPaid) },
  ];

  const scopedBills = filterBillsByChannel(allBillsInPeriod, channelFilter);
  const paidBills = scopedBills.filter((b) => b.status === 'paid');
  const voidedBills = scopedBills.filter((b) => b.status === 'voided');
  const savedBills = scopedBills.filter((b) => b.status === 'saved');

  const billCount = paidBills.length;
  const customerCount = billCount;
  const totalReceived = sumGrandTotal(paidBills);
  const avgPerBill = billCount > 0 ? roundTo2(totalReceived / billCount) : 0;
  const avgPerCustomer = customerCount > 0 ? roundTo2(totalReceived / customerCount) : 0;

  const subtotal = roundTo2(paidBills.reduce((acc, b) => acc + (Number(b.subtotal) || 0), 0));
  const discountTotal = roundTo2(
    paidBills.reduce((acc, b) => acc + (Number(b.discountAmount) || 0), 0)
  );
  const refundTotal = sumGrandTotal(voidedBills);
  const serviceChargeTotal = roundTo2(
    paidBills.reduce((acc, b) => acc + (Number(b.serviceChargeAmount) || 0), 0)
  );
  const packagingTotal = roundTo2(
    paidBills.reduce((acc, b) => acc + (Number(b.packagingCost) || 0), 0)
  );
  const platformFeeTotal = roundTo2(
    paidBills.reduce((acc, b) => acc + (Number(b.platformFee) || 0), 0)
  );
  const extraChargesTotal = roundTo2(packagingTotal + platformFeeTotal);
  const vatTotal = roundTo2(paidBills.reduce((acc, b) => acc + (Number(b.vatAmount) || 0), 0));
  const netSalesTotal = roundTo2(
    paidBills.reduce((acc, b) => acc + (Number(b.netSales) || 0), 0)
  );

  return {
    paidBills,
    voidedBills,
    savedBills,
    channelRows,
    billCount,
    customerCount,
    totalReceived,
    avgPerCustomer,
    avgPerBill,
    subtotal,
    discountTotal,
    refundTotal,
    refundCount: voidedBills.length,
    serviceChargeTotal,
    extraChargesTotal,
    packagingTotal,
    platformFeeTotal,
    vatTotal,
    netSalesTotal,
  };
}

export function buildPaymentMethodsReport(paidBills: BillDoc[]): PaymentMethodStat[] {
  const methods: PaymentMethod[] = ['cash', 'qr', 'card', 'transfer'];
  const map = new Map<
    PaymentMethod,
    { transactionCount: number; billIds: Set<string>; amount: number }
  >();

  for (const m of methods) {
    map.set(m, { transactionCount: 0, billIds: new Set(), amount: 0 });
  }

  for (const bill of paidBills) {
    const payments = Array.isArray(bill.payments) ? bill.payments : [];
    if (payments.length === 0) {
      const entry = map.get('cash')!;
      entry.transactionCount += 1;
      entry.billIds.add(bill.id);
      entry.amount = roundTo2(entry.amount + (Number(bill.grandTotal) || 0));
      continue;
    }

    for (const p of payments) {
      const m: PaymentMethod = map.has(p.method) ? p.method : 'cash';
      const entry = map.get(m)!;
      entry.transactionCount += 1;
      entry.billIds.add(bill.id);
      entry.amount = roundTo2(entry.amount + (Number(p.amount) || 0));
    }
  }

  const totalAmount = Array.from(map.values()).reduce((sum, e) => sum + e.amount, 0);

  return methods.map((method) => {
    const entry = map.get(method)!;
    return {
      method,
      transactionCount: entry.transactionCount,
      billCount: entry.billIds.size,
      amount: entry.amount,
      sharePercent: totalAmount > 0 ? roundTo2((entry.amount / totalAmount) * 100) : 0,
    };
  });
}

export function buildCategorySalesReport(
  paidBills: BillDoc[],
  dishes: DishDoc[],
  categories: CategoryDoc[],
  lang: Language
): CategorySalesStat[] {
  const dishById = new Map(dishes.map((d) => [d.id, d]));
  const catById = new Map(categories.map((c) => [c.id, c]));

  const agg = new Map<
    string,
    { categoryId: string; categoryName: string; quantity: number; revenue: number }
  >();

  for (const bill of paidBills) {
    for (const item of bill.items || []) {
      const dish = dishById.get(item.dishId);
      const catId = dish?.categoryId || 'uncategorized';
      const catDoc = catId !== 'uncategorized' ? catById.get(catId) : undefined;
      const catName = catDoc
        ? lang === 'th'
          ? catDoc.nameTh || catDoc.name
          : catDoc.name || catDoc.nameTh || catId
        : lang === 'th'
        ? 'ไม่ระบุหมวดหมู่'
        : 'Uncategorized';

      const qty = Math.max(1, Number(item.quantity) || 1);
      const rev = roundTo2((Number(item.unitPrice) || 0) * qty);

      const prev = agg.get(catId);
      if (prev) {
        prev.quantity += qty;
        prev.revenue = roundTo2(prev.revenue + rev);
      } else {
        agg.set(catId, {
          categoryId: catId,
          categoryName: catName,
          quantity: qty,
          revenue: rev,
        });
      }
    }
  }

  const rows = Array.from(agg.values()).sort((a, b) => b.revenue - a.revenue);
  const totalRev = rows.reduce((sum, r) => sum + r.revenue, 0);

  return rows.map((r) => ({
    ...r,
    sharePercent: totalRev > 0 ? roundTo2((r.revenue / totalRev) * 100) : 0,
  }));
}

export function buildBestSellersReport(paidBills: BillDoc[]): BestSellerItemStat[] {
  const agg = new Map<
    string,
    {
      dishId: string;
      dishName: string;
      quantity: number;
      revenue: number;
      variantMap: Map<string, { variantName: string; quantity: number; revenue: number }>;
    }
  >();

  for (const bill of paidBills) {
    for (const item of bill.items || []) {
      const qty = Math.max(1, Number(item.quantity) || 1);
      const rev = roundTo2((Number(item.unitPrice) || 0) * qty);
      const dishKey = item.dishId || item.dishName;
      let entry = agg.get(dishKey);
      if (!entry) {
        entry = {
          dishId: item.dishId,
          dishName: item.dishName,
          quantity: 0,
          revenue: 0,
          variantMap: new Map(),
        };
        agg.set(dishKey, entry);
      }
      entry.quantity += qty;
      entry.revenue = roundTo2(entry.revenue + rev);

      const vName = item.variantName || '-';
      const prevVar = entry.variantMap.get(vName);
      if (prevVar) {
        prevVar.quantity += qty;
        prevVar.revenue = roundTo2(prevVar.revenue + rev);
      } else {
        entry.variantMap.set(vName, { variantName: vName, quantity: qty, revenue: rev });
      }
    }
  }

  const list = Array.from(agg.values()).sort(
    (a, b) => b.quantity - a.quantity || b.revenue - a.revenue
  );
  const totalRev = list.reduce((sum, r) => sum + r.revenue, 0);

  return list.map((item) => ({
    dishId: item.dishId,
    dishName: item.dishName,
    quantity: item.quantity,
    revenue: item.revenue,
    sharePercent: totalRev > 0 ? roundTo2((item.revenue / totalRev) * 100) : 0,
    variants: Array.from(item.variantMap.values()).sort((a, b) => b.quantity - a.quantity),
  }));
}

export function buildModifiersReport(paidBills: BillDoc[]): ModifierSalesStat[] {
  const agg = new Map<string, ModifierSalesStat>();

  for (const bill of paidBills) {
    for (const item of bill.items || []) {
      const dishQty = Math.max(1, Number(item.quantity) || 1);
      for (const opt of item.options || []) {
        const optQty = Math.max(1, Number(opt.quantity) || 1) * dishQty;
        const optRev = roundTo2((Number(opt.price) || 0) * dishQty);
        const key = `${opt.groupId || opt.groupName}::${opt.choiceId || opt.choiceName}`;

        const prev = agg.get(key);
        if (prev) {
          prev.quantity += optQty;
          prev.revenue = roundTo2(prev.revenue + optRev);
        } else {
          agg.set(key, {
            key,
            groupName: opt.groupName || '',
            choiceName: opt.choiceName || '',
            quantity: optQty,
            revenue: optRev,
          });
        }
      }
    }
  }

  return Array.from(agg.values()).sort(
    (a, b) => b.quantity - a.quantity || b.revenue - a.revenue
  );
}

export function buildMemberSalesReport(
  paidBills: BillDoc[],
  lang: Language
): MemberSalesStat[] {
  const agg = new Map<string, MemberSalesStat>();

  for (const bill of paidBills) {
    const hasMember = Boolean(bill.memberId || bill.memberName);
    const hasCustomer = Boolean(bill.customerName || bill.customerPhone);

    const key = hasMember
      ? `member:${bill.memberId || bill.memberName}`
      : hasCustomer
      ? `customer:${bill.customerPhone || bill.customerName}`
      : 'walk_in';

    const name = hasMember
      ? bill.memberName || (lang === 'th' ? 'สมาชิก' : 'Member')
      : hasCustomer
      ? bill.customerName || bill.customerPhone || (lang === 'th' ? 'ลูกค้าจัดส่ง' : 'Customer')
      : lang === 'th'
      ? 'ลูกค้าทั่วไป (ไม่ระบุสมาชิก)'
      : 'Walk-in / Guest';

    const prev = agg.get(key);
    const amount = Number(bill.grandTotal) || 0;
    const earned = Number(bill.pointsEarned) || 0;
    const redeemed = Number(bill.pointsRedeemed) || 0;

    if (prev) {
      prev.billCount += 1;
      prev.totalSpent = roundTo2(prev.totalSpent + amount);
      prev.pointsEarned += earned;
      prev.pointsRedeemed += redeemed;
    } else {
      agg.set(key, {
        key,
        name,
        phone: bill.customerPhone,
        isRegisteredMember: hasMember,
        billCount: 1,
        totalSpent: roundTo2(amount),
        pointsEarned: earned,
        pointsRedeemed: redeemed,
      });
    }
  }

  return Array.from(agg.values()).sort((a, b) => b.totalSpent - a.totalSpent);
}

export function buildUserSalesReport(
  paidBills: BillDoc[],
  shifts: ShiftDoc[],
  ownerEmail: string | null | undefined,
  lang: Language
): UserSalesStat[] {
  const staffName =
    ownerEmail?.trim() || (lang === 'th' ? 'เจ้าของร้าน / แคชเชียร์หลัก' : 'Store Owner / Main POS');

  if (paidBills.length === 0) return [];

  const shiftByDate = new Map<string, ShiftDoc[]>();
  for (const s of shifts) {
    const list = shiftByDate.get(s.workDate) || [];
    list.push(s);
    shiftByDate.set(s.workDate, list);
  }

  const agg = new Map<string, UserSalesStat>();

  for (const bill of paidBills) {
    const dayShifts = shiftByDate.get(bill.workDate) || [];
    const billTime = new Date(bill.paidAt || bill.createdAt).getTime();

    const matchedShift = dayShifts.find((s) => {
      const start = new Date(s.openedAt).getTime();
      const end = s.closedAt ? new Date(s.closedAt).getTime() : Number.MAX_SAFE_INTEGER;
      return billTime >= start && billTime <= end;
    });

    const key = matchedShift ? `${staffName}::${matchedShift.id}` : `${staffName}::default`;
    const subLabel = matchedShift
      ? `${lang === 'th' ? 'กะเปิด' : 'Shift'} ${new Date(matchedShift.openedAt).toLocaleTimeString(
          lang === 'th' ? 'th-TH' : 'en-US',
          { hour: '2-digit', minute: '2-digit' }
        )}${
          matchedShift.closedAt
            ? ` - ${new Date(matchedShift.closedAt).toLocaleTimeString(
                lang === 'th' ? 'th-TH' : 'en-US',
                { hour: '2-digit', minute: '2-digit' }
              )}`
            : ` (${lang === 'th' ? 'กำลังเปิด' : 'Open'})`
        }`
      : lang === 'th'
      ? 'ขายหน้าร้าน (นอกกะ)'
      : 'POS Counter';

    const prev = agg.get(key);
    if (prev) {
      prev.billCount += 1;
      prev.totalReceived = roundTo2(prev.totalReceived + (Number(bill.grandTotal) || 0));
      prev.netSales = roundTo2(prev.netSales + (Number(bill.netSales) || 0));
    } else {
      agg.set(key, {
        key,
        label: staffName,
        subLabel,
        billCount: 1,
        totalReceived: roundTo2(Number(bill.grandTotal) || 0),
        netSales: roundTo2(Number(bill.netSales) || 0),
      });
    }
  }

  return Array.from(agg.values()).sort((a, b) => b.totalReceived - a.totalReceived);
}

export function buildDiscountsReport(paidBills: BillDoc[]): DiscountSummaryMetrics {
  const discountedBills = paidBills
    .filter((b) => (Number(b.discountAmount) || 0) > 0 || (Number(b.pointsRedeemed) || 0) > 0)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const totalDiscount = roundTo2(
    discountedBills.reduce((acc, b) => acc + (Number(b.discountAmount) || 0), 0)
  );
  const totalPointsRedeemed = discountedBills.reduce(
    (acc, b) => acc + (Number(b.pointsRedeemed) || 0),
    0
  );
  const avgDiscountPerBill =
    discountedBills.length > 0 ? roundTo2(totalDiscount / discountedBills.length) : 0;

  return {
    totalDiscount,
    totalPointsRedeemed,
    discountedBillCount: discountedBills.length,
    avgDiscountPerBill,
    bills: discountedBills,
  };
}
