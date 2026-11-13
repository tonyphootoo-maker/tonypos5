import {
  SaleOrder,
  SaleOrderItem,
  InventoryItem,
  InventoryTransaction,
  MenuItem,
  MenuVariant,
  Sauce,
  Ingredient,
  UnitType,
} from '../types';
import { StorageService } from './storageService';
import { generateId } from '../utils/id';

export interface ConsumedIngredientDetail {
  ingredientId: string;
  ingredientName: string;
  consumedQuantity: number;
  unit: UnitType;
  unitCost: number;
  totalCost: number;
  remainingStock: number;
}

export interface InsufficientIngredientDetail {
  ingredientId: string;
  ingredientName: string;
  required: number;
  available: number;
  unit: string;
}

export interface TransactionProcessResult {
  success: boolean;
  orderId: string;
  orderNumber: string;
  alreadyProcessed?: boolean;
  inventoryTransactions: InventoryTransaction[];
  consumedIngredients: ConsumedIngredientDetail[];
  totalFoodCost: number;
  grossProfit: number;
  error?: string;
  insufficientIngredients?: InsufficientIngredientDetail[];
}

export interface RestoredIngredientDetail {
  ingredientId: string;
  ingredientName: string;
  restoredQuantity: number;
  unit: UnitType;
  newStock: number;
}

export interface TransactionVoidResult {
  success: boolean;
  orderId: string;
  orderNumber: string;
  reversalTransactions: InventoryTransaction[];
  restoredIngredients: RestoredIngredientDetail[];
  error?: string;
}

export interface ExplodedIngredientRequirement {
  ingredientId: string;
  ingredientName: string;
  quantity: number;
  unit: UnitType;
  sourceVariantId?: string;
  sourceMenuName?: string;
}

export interface ProcessTransactionOptions {
  user?: string;
  allowNegativeStock?: boolean; // Default false (Atomic strict rejection)
  skipPackagingDeduction?: boolean;
}

/**
 * Standard unit converter between recipe usage unit and inventory tracking unit.
 */
export function convertUnitQuantity(
  quantity: number,
  fromUnit: UnitType,
  toUnit: UnitType
): number {
  if (fromUnit === toUnit) return quantity;

  // Weight conversions
  if (fromUnit === 'kg' && toUnit === 'g') return quantity * 1000;
  if (fromUnit === 'g' && toUnit === 'kg') return quantity / 1000;

  // Volume conversions
  if (fromUnit === 'l' && toUnit === 'ml') return quantity * 1000;
  if (fromUnit === 'ml' && toUnit === 'l') return quantity / 1000;

  // Discrete / piece units or unhandled pairs return as-is
  return quantity;
}

/**
 * Explodes SaleOrder items into raw ingredient requirements (BOM explosion).
 * Resolves MenuVariant -> RecipeItems -> SubRecipes/Sauces -> Raw Ingredients.
 */
export function explodeRecipeItems(
  items: SaleOrderItem[],
  menus: MenuItem[],
  sauces: Sauce[],
  ingredients: Ingredient[]
): ExplodedIngredientRequirement[] {
  const requirements: ExplodedIngredientRequirement[] = [];

  const saucesMap = new Map<string, Sauce>();
  sauces.forEach((s) => saucesMap.set(s.id, s));

  const ingredientsMap = new Map<string, Ingredient>();
  ingredients.forEach((i) => ingredientsMap.set(i.id, i));

  // Build variants map
  const variantsMap = new Map<string, { variant: MenuVariant; menuName: string }>();
  menus.forEach((m) => {
    (m.variants || []).forEach((v) => {
      variantsMap.set(v.id, { variant: v, menuName: m.name });
    });
  });

  for (const item of items) {
    const dishCount = Number(item.quantity) || 0;
    if (dishCount <= 0) continue;

    const variantEntry = variantsMap.get(item.variantId);
    let recipeItems = variantEntry?.variant?.recipeItems;

    // Fallback: Check if item already carries a recipeSnapshot
    if ((!recipeItems || recipeItems.length === 0) && item.recipeSnapshot && item.recipeSnapshot.length > 0) {
      for (const snap of item.recipeSnapshot) {
        requirements.push({
          ingredientId: snap.ingredientId,
          ingredientName: snap.name,
          quantity: snap.quantity * dishCount,
          unit: snap.unit as UnitType,
          sourceVariantId: item.variantId,
          sourceMenuName: item.menuName,
        });
      }
      continue;
    }

    if (!recipeItems || recipeItems.length === 0) {
      continue;
    }

    for (const rItem of recipeItems) {
      const perDishQty = Number(rItem.quantity) || 0;
      const totalDishItemQty = perDishQty * dishCount;
      if (totalDishItemQty <= 0) continue;

      const isSauce =
        rItem.ingredientType === 'SAUCE' ||
        rItem.sauceId ||
        saucesMap.has(rItem.ingredientId);

      if (isSauce) {
        const sauceId = rItem.sauceId || rItem.ingredientId;
        const sauce = saucesMap.get(sauceId);

        if (sauce && sauce.items && sauce.items.length > 0) {
          // Explode sauce sub-recipe into raw ingredients
          // Batch produced yield quantity
          const batchYield = Number(sauce.actualQuantity) || Number(sauce.productionQuantity) || 1;
          const sauceBatchUnit = sauce.productionUnit || 'g';
          
          // Convert recipe sauce consumption to sauce batch unit
          const normalizedSauceNeeded = convertUnitQuantity(
            totalDishItemQty,
            rItem.unit,
            sauceBatchUnit
          );
          const batchProportion = normalizedSauceNeeded / batchYield;

          for (const sItem of sauce.items) {
            const rawIngredientNeeded = (Number(sItem.quantity) || 0) * batchProportion;
            const rawIng = ingredientsMap.get(sItem.ingredientId);
            const ingredientName = rawIng?.name || sItem.ingredientName || sItem.ingredientId;

            requirements.push({
              ingredientId: sItem.ingredientId,
              ingredientName,
              quantity: rawIngredientNeeded,
              unit: sItem.unit,
              sourceVariantId: item.variantId,
              sourceMenuName: item.menuName,
            });
          }
        } else {
          // Sauce tracked directly as an ingredient / inventory item
          const ing = ingredientsMap.get(rItem.ingredientId);
          requirements.push({
            ingredientId: rItem.ingredientId,
            ingredientName: ing?.name || rItem.name,
            quantity: totalDishItemQty,
            unit: rItem.unit,
            sourceVariantId: item.variantId,
            sourceMenuName: item.menuName,
          });
        }
      } else {
        // Direct INGREDIENT or PREPARED_ITEM
        const ing = ingredientsMap.get(rItem.ingredientId);
        requirements.push({
          ingredientId: rItem.ingredientId,
          ingredientName: ing?.name || rItem.name,
          quantity: totalDishItemQty,
          unit: rItem.unit,
          sourceVariantId: item.variantId,
          sourceMenuName: item.menuName,
        });
      }
    }
  }

  return requirements;
}

/**
 * Aggregates exploded ingredient requirements and normalizes units against current inventory units.
 */
export function aggregateIngredientRequirements(
  requirements: ExplodedIngredientRequirement[],
  inventory: InventoryItem[]
): Map<string, { ingredientId: string; ingredientName: string; totalQuantity: number; unit: UnitType }> {
  const inventoryMap = new Map<string, InventoryItem>();
  inventory.forEach((inv) => inventoryMap.set(inv.ingredientId, inv));

  const aggregated = new Map<
    string,
    { ingredientId: string; ingredientName: string; totalQuantity: number; unit: UnitType }
  >();

  for (const req of requirements) {
    const inv = inventoryMap.get(req.ingredientId);
    const targetUnit = inv?.unit || req.unit;
    const normalizedQuantity = convertUnitQuantity(req.quantity, req.unit, targetUnit);

    const existing = aggregated.get(req.ingredientId);
    if (existing) {
      existing.totalQuantity += normalizedQuantity;
    } else {
      aggregated.set(req.ingredientId, {
        ingredientId: req.ingredientId,
        ingredientName: inv?.ingredientName || req.ingredientName,
        totalQuantity: normalizedQuantity,
        unit: targetUnit,
      });
    }
  }

  return aggregated;
}

/**
 * Central Transaction Service for POS Sales & Stock Deductions
 */
export const TransactionService = {
  /**
   * Process a sale order transaction atomically:
   * 1. Load SaleOrder
   * 2. Verify idempotency (no duplicate deduction)
   * 3. Validate order state (reject cancelled)
   * 4. Resolve BOM & explode recipe / sub-recipes
   * 5. Aggregate ingredients
   * 6. Atomic stock sufficiency check (all or nothing)
   * 7. Generate InventoryTransaction audit trail
   * 8. Update InventoryItem.currentStock
   * 9. Preserve / snapshot COGS & Gross Profit
   * 10. Mark SaleOrder as COMPLETED
   * 11. Atomic save via StorageService
   */
  processSaleTransaction(
    saleOrderId: string,
    options?: ProcessTransactionOptions
  ): TransactionProcessResult {
    const sales = StorageService.getSalesOrders();
    const orderIndex = sales.findIndex((o) => o.id === saleOrderId);

    if (orderIndex === -1) {
      return {
        success: false,
        orderId: saleOrderId,
        orderNumber: '',
        inventoryTransactions: [],
        consumedIngredients: [],
        totalFoodCost: 0,
        grossProfit: 0,
        error: `ไม่พบข้อมูลคำสั่งซื้อรหัส ${saleOrderId}`,
      };
    }

    const order = sales[orderIndex];

    // Check order status: CANCELLED orders cannot be processed
    if (order.orderStatus === 'CANCELLED') {
      return {
        success: false,
        orderId: order.id,
        orderNumber: order.orderNumber,
        inventoryTransactions: [],
        consumedIngredients: [],
        totalFoodCost: order.totalFoodCost || 0,
        grossProfit: order.grossProfit || 0,
        error: `คำสั่งซื้อ ${order.orderNumber} ถูกยกเลิกไปแล้ว ไม่สามารถตัดสต็อกได้`,
      };
    }

    // IDEMPOTENCY CHECK:
    // Check if order is already COMPLETED or if InventoryTransactions with referenceId === saleOrderId already exist
    const existingTxns = StorageService.getInventoryTransactions();
    const hasExistingSaleTxns = existingTxns.some(
      (t) => t.referenceId === order.id && t.type === 'USAGE'
    );

    if (order.orderStatus === 'COMPLETED' || hasExistingSaleTxns) {
      return {
        success: true,
        orderId: order.id,
        orderNumber: order.orderNumber,
        alreadyProcessed: true,
        inventoryTransactions: [],
        consumedIngredients: [],
        totalFoodCost: order.totalFoodCost || 0,
        grossProfit: order.grossProfit || 0,
      };
    }

    // Load master data
    const menus = StorageService.getMenus();
    const sauces = StorageService.getSauces();
    const ingredients = StorageService.getIngredients();
    const inventory = StorageService.getInventory();

    const ingredientsMap = new Map<string, Ingredient>();
    ingredients.forEach((i) => ingredientsMap.set(i.id, i));

    const inventoryMap = new Map<string, InventoryItem>();
    inventory.forEach((inv) => inventoryMap.set(inv.ingredientId, inv));

    // 4. BOM Explosion
    const rawRequirements = explodeRecipeItems(order.items || [], menus, sauces, ingredients);

    // 5. Aggregate ingredient consumption across all order items
    const aggregated = aggregateIngredientRequirements(rawRequirements, inventory);

    // 6. ATOMIC SUFFICIENCY CHECK
    const insufficientList: InsufficientIngredientDetail[] = [];

    for (const [ingredientId, req] of aggregated.entries()) {
      const inv = inventoryMap.get(ingredientId);
      const available = inv ? (inv.currentStock ?? inv.currentQuantity ?? 0) : 0;

      if (!options?.allowNegativeStock && available < req.totalQuantity) {
        insufficientList.push({
          ingredientId,
          ingredientName: req.ingredientName,
          required: req.totalQuantity,
          available,
          unit: req.unit,
        });
      }
    }

    // If any ingredient is insufficient, fail atomically with zero state mutations
    if (insufficientList.length > 0) {
      return {
        success: false,
        orderId: order.id,
        orderNumber: order.orderNumber,
        inventoryTransactions: [],
        consumedIngredients: [],
        totalFoodCost: order.totalFoodCost || 0,
        grossProfit: order.grossProfit || 0,
        error: `วัตถุดิบไม่เพียงพอสำหรับการตัดสต็อก (Atomic Failure)`,
        insufficientIngredients: insufficientList,
      };
    }

    // 7 & 8. Generate InventoryTransaction & update InventoryItem.currentStock
    const newTransactions: InventoryTransaction[] = [];
    const consumedDetails: ConsumedIngredientDetail[] = [];
    const updatedInventory: InventoryItem[] = [...inventory];
    const txnDate = order.date || new Date().toISOString().split('T')[0];
    const txnUser = options?.user || 'POS System';

    let calculatedBatchFoodCost = 0;

    for (const [ingredientId, req] of aggregated.entries()) {
      const invIndex = updatedInventory.findIndex((i) => i.ingredientId === ingredientId);
      const ing = ingredientsMap.get(ingredientId);

      // Determine unit cost: from ingredient master or inventory costPerUnit
      const unitCost = ing?.costPerBaseUnit || updatedInventory[invIndex]?.costPerUnit || 0;
      const lineCost = req.totalQuantity * unitCost;
      calculatedBatchFoodCost += lineCost;

      let currentStock = 0;
      let minStock = 0;
      let maxStock: number | undefined;

      if (invIndex !== -1) {
        const invItem = updatedInventory[invIndex];
        currentStock = invItem.currentStock ?? invItem.currentQuantity ?? 0;
        minStock = invItem.minStock ?? invItem.minimumStock ?? 0;
        maxStock = invItem.maxStock ?? invItem.maximumStock;

        const newStock = currentStock - req.totalQuantity;
        updatedInventory[invIndex] = {
          ...invItem,
          currentStock: newStock,
          currentQuantity: newStock,
          minStock,
          minimumStock: minStock,
          maxStock,
          maximumStock: maxStock,
          lastUpdated: new Date().toISOString(),
        };

        consumedDetails.push({
          ingredientId,
          ingredientName: req.ingredientName,
          consumedQuantity: req.totalQuantity,
          unit: req.unit,
          unitCost,
          totalCost: lineCost,
          remainingStock: newStock,
        });

        newTransactions.push({
          id: generateId('txn'),
          ingredientId,
          ingredientName: req.ingredientName,
          type: 'USAGE',
          quantity: req.totalQuantity,
          quantityChange: -req.totalQuantity,
          resultingQuantity: newStock,
          unit: req.unit,
          date: txnDate,
          reason: `ตัดสต็อกจากการขาย Order #${order.orderNumber || order.id}`,
          notes: `อ้างอิงบิล ${order.orderNumber}`,
          cost: lineCost,
          user: txnUser,
          referenceId: order.id,
        });
      } else {
        // Untracked in inventory view: create transaction record to preserve audit trail
        consumedDetails.push({
          ingredientId,
          ingredientName: req.ingredientName,
          consumedQuantity: req.totalQuantity,
          unit: req.unit,
          unitCost,
          totalCost: lineCost,
          remainingStock: -req.totalQuantity,
        });

        newTransactions.push({
          id: generateId('txn'),
          ingredientId,
          ingredientName: req.ingredientName,
          type: 'USAGE',
          quantity: req.totalQuantity,
          quantityChange: -req.totalQuantity,
          resultingQuantity: -req.totalQuantity,
          unit: req.unit,
          date: txnDate,
          reason: `ตัดสต็อกจากการขาย Order #${order.orderNumber || order.id}`,
          notes: `อ้างอิงบิล ${order.orderNumber} (Untracked Inventory Item)`,
          cost: lineCost,
          user: txnUser,
          referenceId: order.id,
        });
      }
    }

    // 9 & 10. Preserve Cost Snapshot & calculate Gross Profit
    // Rule: If historical totalFoodCost exists and > 0, preserve it!
    const effectiveFoodCost =
      order.totalFoodCost && order.totalFoodCost > 0
        ? order.totalFoodCost
        : calculatedBatchFoodCost;

    const netRev =
      typeof order.netRevenue === 'number'
        ? order.netRevenue
        : order.grossSales - (order.commissionFee || 0);

    const grossProfit = netRev - effectiveFoodCost - (order.packagingCost || 0);

    // Update order items food cost snapshot if not already snapshot
    const updatedItems = (order.items || []).map((item) => {
      if (item.foodCostPerUnit && item.foodCostPerUnit > 0) {
        return item;
      }
      // If variant has directFoodCost, snapshot it
      const vEntry = menus
        .flatMap((m) => m.variants || [])
        .find((v) => v.id === item.variantId);
      const unitFc = vEntry?.directFoodCost || 0;
      return {
        ...item,
        foodCostPerUnit: unitFc,
        totalFoodCost: unitFc * item.quantity,
      };
    });

    const updatedOrder: SaleOrder = {
      ...order,
      items: updatedItems,
      totalFoodCost: effectiveFoodCost,
      grossProfit,
      orderStatus: 'COMPLETED',
      paymentStatus: order.paymentStatus || 'PAID',
      updatedAt: new Date().toISOString(),
    };

    sales[orderIndex] = updatedOrder;

    // 11. ATOMIC COMMIT TO STORAGE
    StorageService.saveInventory(updatedInventory);
    StorageService.saveInventoryTransactions([...existingTxns, ...newTransactions]);
    StorageService.saveSalesOrders(sales);

    return {
      success: true,
      orderId: order.id,
      orderNumber: order.orderNumber,
      inventoryTransactions: newTransactions,
      consumedIngredients: consumedDetails,
      totalFoodCost: effectiveFoodCost,
      grossProfit,
    };
  },

  /**
   * Void / cancel a completed transaction and restore inventory with a transparent reversal audit trail.
   * Never deletes original transactions.
   */
  voidSaleTransaction(
    saleOrderId: string,
    options?: { reason?: string; user?: string }
  ): TransactionVoidResult {
    const sales = StorageService.getSalesOrders();
    const orderIndex = sales.findIndex((o) => o.id === saleOrderId);

    if (orderIndex === -1) {
      return {
        success: false,
        orderId: saleOrderId,
        orderNumber: '',
        reversalTransactions: [],
        restoredIngredients: [],
        error: `ไม่พบข้อมูลคำสั่งซื้อรหัส ${saleOrderId}`,
      };
    }

    const order = sales[orderIndex];

    if (order.orderStatus === 'CANCELLED') {
      return {
        success: false,
        orderId: order.id,
        orderNumber: order.orderNumber,
        reversalTransactions: [],
        restoredIngredients: [],
        error: `คำสั่งซื้อ ${order.orderNumber} อยู่ในสถานะยกเลิกอยู่แล้ว`,
      };
    }

    const allTxns = StorageService.getInventoryTransactions();
    // Find all previous deductions for this sale order
    const saleTxns = allTxns.filter(
      (t) => t.referenceId === order.id && t.type === 'USAGE'
    );

    // Also check if already reversed
    const alreadyReversed = allTxns.some(
      (t) => t.referenceId === order.id && t.reason?.includes('Void')
    );

    if (alreadyReversed) {
      return {
        success: false,
        orderId: order.id,
        orderNumber: order.orderNumber,
        reversalTransactions: [],
        restoredIngredients: [],
        error: `คำสั่งซื้อนี้ได้รับการทำรายการคืนสต็อก (Void) ไปแล้ว`,
      };
    }

    const inventory = StorageService.getInventory();
    const updatedInventory = [...inventory];
    const reversalTxns: InventoryTransaction[] = [];
    const restoredDetails: RestoredIngredientDetail[] = [];
    const voidDate = new Date().toISOString().split('T')[0];
    const voidUser = options?.user || 'POS Supervisor';
    const voidReason = options?.reason || 'ยกเลิกออเดอร์ (Void)';

    for (const txn of saleTxns) {
      const restoredQty = Math.abs(txn.quantityChange ?? txn.quantity ?? 0);
      if (restoredQty <= 0) continue;

      const invIndex = updatedInventory.findIndex((i) => i.ingredientId === txn.ingredientId);
      if (invIndex !== -1) {
        const invItem = updatedInventory[invIndex];
        const currentStock = invItem.currentStock ?? invItem.currentQuantity ?? 0;
        const newStock = currentStock + restoredQty;

        updatedInventory[invIndex] = {
          ...invItem,
          currentStock: newStock,
          currentQuantity: newStock,
          lastUpdated: new Date().toISOString(),
        };

        restoredDetails.push({
          ingredientId: txn.ingredientId,
          ingredientName: txn.ingredientName,
          restoredQuantity: restoredQty,
          unit: txn.unit,
          newStock,
        });

        reversalTxns.push({
          id: generateId('txn'),
          ingredientId: txn.ingredientId,
          ingredientName: txn.ingredientName,
          type: 'ADJUSTMENT',
          quantity: restoredQty,
          quantityChange: restoredQty,
          resultingQuantity: newStock,
          unit: txn.unit,
          date: voidDate,
          reason: `ยกเลิกออเดอร์ (Void) คืนสต็อก #${order.orderNumber}: ${voidReason}`,
          notes: `Reversal of transaction ${txn.id}`,
          cost: txn.cost ? -txn.cost : 0,
          user: voidUser,
          referenceId: order.id,
        });
      }
    }

    // Update order status
    const updatedOrder: SaleOrder = {
      ...order,
      orderStatus: 'CANCELLED',
      paymentStatus: 'VOID',
      updatedAt: new Date().toISOString(),
    };

    sales[orderIndex] = updatedOrder;

    // Atomic save
    StorageService.saveInventory(updatedInventory);
    StorageService.saveInventoryTransactions([...allTxns, ...reversalTxns]);
    StorageService.saveSalesOrders(sales);

    return {
      success: true,
      orderId: order.id,
      orderNumber: order.orderNumber,
      reversalTransactions: reversalTxns,
      restoredIngredients: restoredDetails,
    };
  },
};
