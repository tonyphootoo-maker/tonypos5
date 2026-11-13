import React, { useState, useMemo } from 'react';
import {
  Calculator,
  Plus,
  Trash2,
  Sparkles,
  Printer,
  Save,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  RotateCcw,
  ArrowRight,
  TrendingUp,
  Percent,
  DollarSign,
  Package,
  Layers,
  ChefHat,
  Info,
  Flame,
  Box,
} from 'lucide-react';
import { Ingredient, Sauce, MenuItem, RestaurantSettings } from '../types';
import { NumericInput } from './common/NumericInput';

interface CalculatorItem {
  id: string;
  name: string;
  sourceIngredientId?: string;
  purchasePrice: number; // AP Price (บาท)
  packageSize: number; // AP Package Quantity (เช่น 1000 กรัม หรือ 1 ลิตร)
  unit: string; // g, ml, ฟอง, ชิ้น, ใบ, ชุด
  yieldPercent: number; // Yield % (เช่น 100% หรือ 70%)
  quantityUsed: number; // ปริมาณที่ใช้ในจานนี้
}

interface QuickCostCalculatorViewProps {
  ingredients: Ingredient[];
  sauces: Sauce[];
  settings: RestaurantSettings;
  onSaveNewMenu?: (menu: MenuItem) => void;
  onNavigateToTab?: (tabId: string) => void;
}

export const QuickCostCalculatorView: React.FC<QuickCostCalculatorViewProps> = ({
  ingredients,
  sauces,
  settings,
  onSaveNewMenu,
  onNavigateToTab,
}) => {
  // Dish information
  const [dishName, setDishName] = useState<string>('ข้าวกะเพราหมูสับไข่ดาว (ตัวอย่าง)');
  const [category, setCategory] = useState<string>('ผัดและกะเพรา');
  const [sellingPrice, setSellingPrice] = useState<number>(75);
  const [targetFcPercent, setTargetFcPercent] = useState<number>(settings.targetFoodCostPercent || 32);
  const [deliveryGpPercent, setDeliveryGpPercent] = useState<number>(settings.grabFoodCommissionPercent || 30);
  const [savedSuccessMsg, setSavedSuccessMsg] = useState<string | null>(null);

  // Active view tab in Extra Costs section: 'PACKAGING' | 'SEASONING' | 'BOTH'
  const [activeExtraTab, setActiveExtraTab] = useState<'PACKAGING' | 'SEASONING' | 'BOTH'>('BOTH');

  // 1. Primary Recipe Items (วัตถุดิบหลัก & สัดส่วนต่อจาน)
  const [items, setItems] = useState<CalculatorItem[]>([
    {
      id: 'item-1',
      name: 'เนื้อหมูบด',
      purchasePrice: 165,
      packageSize: 1000,
      unit: 'g',
      yieldPercent: 95,
      quantityUsed: 120,
    },
    {
      id: 'item-2',
      name: 'ใบกะเพรา',
      purchasePrice: 40,
      packageSize: 500,
      unit: 'g',
      yieldPercent: 65,
      quantityUsed: 25,
    },
    {
      id: 'item-3',
      name: 'พริกขี้หนู & กระเทียมสับ',
      purchasePrice: 70,
      packageSize: 1000,
      unit: 'g',
      yieldPercent: 85,
      quantityUsed: 20,
    },
    {
      id: 'item-4',
      name: 'ซอสผัดกะเพราสูตรทางร้าน',
      purchasePrice: 85,
      packageSize: 1000,
      unit: 'g',
      yieldPercent: 100,
      quantityUsed: 35,
    },
    {
      id: 'item-5',
      name: 'ข้าวสวยหอมมะลิหุงสุก',
      purchasePrice: 48,
      packageSize: 1000,
      unit: 'g',
      yieldPercent: 100,
      quantityUsed: 200,
    },
    {
      id: 'item-6',
      name: 'ไข่ไก่ เบอร์ 2',
      purchasePrice: 4.2,
      packageSize: 1,
      unit: 'ฟอง',
      yieldPercent: 100,
      quantityUsed: 1,
    },
  ]);

  // 2. Q-Factor / Seasoning Items (เครื่องปรุงย่อย & วัตถุดิบหน้าเตา) - ใส่แบบเดียวกันกับ Recipe Items
  const [qFactorItems, setQFactorItems] = useState<CalculatorItem[]>([
    {
      id: 'qf-1',
      name: 'น้ำมันพืชสำหรับผัดและทอดไข่',
      purchasePrice: 55,
      packageSize: 1000,
      unit: 'ml',
      yieldPercent: 100,
      quantityUsed: 15,
    },
    {
      id: 'qf-2',
      name: 'พริกไทยป่น & น้ำตาลทรายตัดรส',
      purchasePrice: 45,
      packageSize: 100,
      unit: 'g',
      yieldPercent: 100,
      quantityUsed: 2,
    },
  ]);

  // 3. Packaging & Plating Items (บรรจุภัณฑ์ & อุปกรณ์จัดเสิร์ฟ) - ใส่แบบเดียวกันกับ Recipe Items
  const [packagingItems, setPackagingItems] = useState<CalculatorItem[]>([
    {
      id: 'pkg-1',
      name: 'กล่องอาหารกระดาษคราฟท์เคลือบกันซึม',
      purchasePrice: 125,
      packageSize: 50,
      unit: 'ใบ',
      yieldPercent: 100,
      quantityUsed: 1,
    },
    {
      id: 'pkg-2',
      name: 'ชุดช้อนส้อมพลาสติก + กระดาษเช็ดปาก',
      purchasePrice: 45,
      packageSize: 50,
      unit: 'ชุด',
      yieldPercent: 100,
      quantityUsed: 1,
    },
    {
      id: 'pkg-3',
      name: 'ซองพริกน้ำปลาปรุงสำเร็จ',
      purchasePrice: 35,
      packageSize: 50,
      unit: 'ซอง',
      yieldPercent: 100,
      quantityUsed: 1,
    },
    {
      id: 'pkg-4',
      name: 'ถุงหูหิ้วรักษ์โลก',
      purchasePrice: 35,
      packageSize: 100,
      unit: 'ใบ',
      yieldPercent: 100,
      quantityUsed: 1,
    },
  ]);

  // Category filter state for pulling ingredients from inventory
  const [selectedQuickCategory, setSelectedQuickCategory] = useState<string>('ALL');

  const quickCategories = useMemo(() => {
    const set = new Set<string>();
    ingredients.forEach((i) => {
      if (i.category) set.add(i.category);
    });
    return Array.from(set);
  }, [ingredients]);

  const filteredQuickIngredients = useMemo(() => {
    if (selectedQuickCategory === 'ALL') return ingredients;
    return ingredients.filter((i) => i.category === selectedQuickCategory);
  }, [ingredients, selectedQuickCategory]);

  // --- Handlers for Primary Recipe Items ---
  const handleAddItem = (ingredientId?: string) => {
    if (ingredientId) {
      const ing = ingredients.find((i) => i.id === ingredientId);
      if (ing) {
        const newItem: CalculatorItem = {
          id: `item-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          name: ing.name,
          sourceIngredientId: ing.id,
          purchasePrice: ing.pricePerPack ?? ing.purchasePrice,
          packageSize: ing.packQuantity ?? ing.purchaseQuantity ?? 1,
          unit: ing.recipeUnit ?? ing.usageUnit ?? ing.packUnit ?? ing.purchaseUnit ?? 'g',
          yieldPercent: ing.yieldPercent || 100,
          quantityUsed: 50,
        };
        setItems([...items, newItem]);
        return;
      }
    }

    const defaultItem: CalculatorItem = {
      id: `item-${Date.now()}`,
      name: 'วัตถุดิบใหม่',
      purchasePrice: 100,
      packageSize: 1000,
      unit: 'g',
      yieldPercent: 100,
      quantityUsed: 100,
    };
    setItems([...items, defaultItem]);
  };

  const handleRemoveItem = (id: string) => {
    setItems(items.filter((item) => item.id !== id));
  };

  const handleUpdateItem = (id: string, field: keyof CalculatorItem, val: any) => {
    setItems(
      items.map((item) => (item.id === id ? { ...item, [field]: val } : item))
    );
  };

  // --- Handlers for Q-Factor / Seasoning Items ---
  const handleAddQFactorItem = (ingredientId?: string) => {
    if (ingredientId) {
      const ing = ingredients.find((i) => i.id === ingredientId);
      if (ing) {
        const newItem: CalculatorItem = {
          id: `qf-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          name: ing.name,
          sourceIngredientId: ing.id,
          purchasePrice: ing.pricePerPack ?? ing.purchasePrice,
          packageSize: ing.packQuantity ?? ing.purchaseQuantity ?? 1,
          unit: ing.recipeUnit ?? ing.usageUnit ?? ing.packUnit ?? ing.purchaseUnit ?? 'g',
          yieldPercent: ing.yieldPercent || 100,
          quantityUsed: 5,
        };
        setQFactorItems([...qFactorItems, newItem]);
        return;
      }
    }

    const defaultItem: CalculatorItem = {
      id: `qf-${Date.now()}`,
      name: 'เครื่องปรุงรส/น้ำมันใหม่',
      purchasePrice: 50,
      packageSize: 1000,
      unit: 'ml',
      yieldPercent: 100,
      quantityUsed: 10,
    };
    setQFactorItems([...qFactorItems, defaultItem]);
  };

  const handleRemoveQFactorItem = (id: string) => {
    setQFactorItems(qFactorItems.filter((item) => item.id !== id));
  };

  const handleUpdateQFactorItem = (id: string, field: keyof CalculatorItem, val: any) => {
    setQFactorItems(
      qFactorItems.map((item) => (item.id === id ? { ...item, [field]: val } : item))
    );
  };

  // --- Handlers for Packaging Items ---
  const handleAddPackagingItem = (ingredientId?: string) => {
    if (ingredientId) {
      const ing = ingredients.find((i) => i.id === ingredientId);
      if (ing) {
        const newItem: CalculatorItem = {
          id: `pkg-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
          name: ing.name,
          sourceIngredientId: ing.id,
          purchasePrice: ing.pricePerPack ?? ing.purchasePrice,
          packageSize: ing.packQuantity ?? ing.purchaseQuantity ?? 1,
          unit: ing.recipeUnit ?? ing.usageUnit ?? ing.packUnit ?? ing.purchaseUnit ?? 'ใบ',
          yieldPercent: ing.yieldPercent || 100,
          quantityUsed: 1,
        };
        setPackagingItems([...packagingItems, newItem]);
        return;
      }
    }

    const defaultItem: CalculatorItem = {
      id: `pkg-${Date.now()}`,
      name: 'บรรจุภัณฑ์/อุปกรณ์ใหม่',
      purchasePrice: 120,
      packageSize: 50,
      unit: 'ใบ',
      yieldPercent: 100,
      quantityUsed: 1,
    };
    setPackagingItems([...packagingItems, defaultItem]);
  };

  const handleRemovePackagingItem = (id: string) => {
    setPackagingItems(packagingItems.filter((item) => item.id !== id));
  };

  const handleUpdatePackagingItem = (id: string, field: keyof CalculatorItem, val: any) => {
    setPackagingItems(
      packagingItems.map((item) => (item.id === id ? { ...item, [field]: val } : item))
    );
  };

  // --- Calculations for all 3 Item groups ---
  const calculatedRows = useMemo(() => {
    return items.map((item) => {
      const safePackageSize = item.packageSize > 0 ? item.packageSize : 1;
      const safeYield = item.yieldPercent > 0 ? item.yieldPercent / 100 : 1;
      const epUnitCost = item.purchasePrice / (safePackageSize * safeYield);
      const lineCost = epUnitCost * item.quantityUsed;
      return { ...item, epUnitCost, lineCost };
    });
  }, [items]);

  const calculatedQFactorRows = useMemo(() => {
    return qFactorItems.map((item) => {
      const safePackageSize = item.packageSize > 0 ? item.packageSize : 1;
      const safeYield = item.yieldPercent > 0 ? item.yieldPercent / 100 : 1;
      const epUnitCost = item.purchasePrice / (safePackageSize * safeYield);
      const lineCost = epUnitCost * item.quantityUsed;
      return { ...item, epUnitCost, lineCost };
    });
  }, [qFactorItems]);

  const calculatedPackagingRows = useMemo(() => {
    return packagingItems.map((item) => {
      const safePackageSize = item.packageSize > 0 ? item.packageSize : 1;
      const safeYield = item.yieldPercent > 0 ? item.yieldPercent / 100 : 1;
      const epUnitCost = item.purchasePrice / (safePackageSize * safeYield);
      const lineCost = epUnitCost * item.quantityUsed;
      return { ...item, epUnitCost, lineCost };
    });
  }, [packagingItems]);

  // Direct food cost
  const directFoodCost = useMemo(() => {
    return calculatedRows.reduce((sum, row) => sum + row.lineCost, 0);
  }, [calculatedRows]);

  // Total Q-Factor / Seasoning cost
  const totalQFactorCost = useMemo(() => {
    return calculatedQFactorRows.reduce((sum, row) => sum + row.lineCost, 0);
  }, [calculatedQFactorRows]);

  // Total Packaging cost
  const totalPackagingCost = useMemo(() => {
    return calculatedPackagingRows.reduce((sum, row) => sum + row.lineCost, 0);
  }, [calculatedPackagingRows]);

  // Total plate cost (รวม วัตถุดิบหลัก + เครื่องปรุงย่อย/Q-Factor + บรรจุภัณฑ์)
  const totalCostPerPortion = useMemo(() => {
    return directFoodCost + totalQFactorCost + totalPackagingCost;
  }, [directFoodCost, totalQFactorCost, totalPackagingCost]);

  // Actual food cost % based on Selling Price
  const actualFoodCostPercent = sellingPrice > 0 ? (totalCostPerPortion / sellingPrice) * 100 : 0;
  const contributionMargin = sellingPrice - totalCostPerPortion;
  const marginPercent = sellingPrice > 0 ? (contributionMargin / sellingPrice) * 100 : 0;

  // Suggested selling price by Target Food Cost %
  const suggestedSellingPrice = targetFcPercent > 0 ? totalCostPerPortion / (targetFcPercent / 100) : 0;

  // Suggested Delivery Selling Price (หลังหัก GP เดลิเวอรี)
  const effectiveNetMultiplier = 1 - deliveryGpPercent / 100;
  const suggestedDeliveryPrice =
    effectiveNetMultiplier > 0 && targetFcPercent > 0
      ? totalCostPerPortion / ((targetFcPercent / 100) * effectiveNetMultiplier)
      : 0;

  // Status benchmark badge
  const getBenchmarkStatus = (fcPercent: number) => {
    if (fcPercent <= 32) {
      return {
        label: 'ดีมาก (On Target)',
        desc: 'อยู่ในเกณฑ์กำไรมาตรฐานสากล (≤ 32%)',
        color: 'text-emerald-700 bg-emerald-50 border-emerald-200',
        badge: 'bg-emerald-600 text-white',
      };
    }
    if (fcPercent <= 38) {
      return {
        label: 'ปานกลาง (Acceptable)',
        desc: 'เฝ้าระวังต้นทุน ควบคุมปริมาณตัก (33% - 38%)',
        color: 'text-amber-800 bg-amber-50 border-amber-200',
        badge: 'bg-amber-500 text-black font-bold',
      };
    }
    return {
      label: 'ต้นทุนสูงเกินเกณฑ์ (High Cost)',
      desc: 'เสี่ยงขาดทุน ควรปรับราคาหรือลดปริมาณ (> 38%)',
      color: 'text-rose-700 bg-rose-50 border-rose-200',
      badge: 'bg-rose-600 text-white',
    };
  };

  const status = getBenchmarkStatus(actualFoodCostPercent);

  // Reset presets
  const handleResetToPreset = (presetType: 'KAPRAO' | 'STEAK' | 'TOMYUM') => {
    if (presetType === 'KAPRAO') {
      setDishName('ข้าวกะเพราหมูสับไข่ดาว');
      setCategory('ผัดและกะเพรา');
      setSellingPrice(75);
      setItems([
        { id: '1', name: 'เนื้อหมูบด', purchasePrice: 165, packageSize: 1000, unit: 'g', yieldPercent: 95, quantityUsed: 120 },
        { id: '2', name: 'ใบกะเพรา', purchasePrice: 40, packageSize: 500, unit: 'g', yieldPercent: 65, quantityUsed: 25 },
        { id: '3', name: 'พริก & กระเทียม', purchasePrice: 70, packageSize: 1000, unit: 'g', yieldPercent: 85, quantityUsed: 20 },
        { id: '4', name: 'ซอสกะเพราปรุงสำเร็จ', purchasePrice: 85, packageSize: 1000, unit: 'g', yieldPercent: 100, quantityUsed: 35 },
        { id: '5', name: 'ข้าวสวยหอมมะลิ', purchasePrice: 48, packageSize: 1000, unit: 'g', yieldPercent: 100, quantityUsed: 200 },
        { id: '6', name: 'ไข่ไก่ เบอร์ 2', purchasePrice: 4.2, packageSize: 1, unit: 'ฟอง', yieldPercent: 100, quantityUsed: 1 },
      ]);
      setQFactorItems([
        { id: 'q1', name: 'น้ำมันพืชสำหรับผัดและทอดไข่', purchasePrice: 55, packageSize: 1000, unit: 'ml', yieldPercent: 100, quantityUsed: 15 },
        { id: 'q2', name: 'พริกไทยป่น & น้ำตาลทราย', purchasePrice: 45, packageSize: 100, unit: 'g', yieldPercent: 100, quantityUsed: 2 },
      ]);
      setPackagingItems([
        { id: 'p1', name: 'กล่องกระดาษคราฟท์เคลือบกันซึม', purchasePrice: 125, packageSize: 50, unit: 'ใบ', yieldPercent: 100, quantityUsed: 1 },
        { id: 'p2', name: 'ชุดช้อนส้อมพลาสติก + ทิชชู่', purchasePrice: 45, packageSize: 50, unit: 'ชุด', yieldPercent: 100, quantityUsed: 1 },
        { id: 'p3', name: 'ซองพริกน้ำปลาปรุงสำเร็จ', purchasePrice: 35, packageSize: 50, unit: 'ซอง', yieldPercent: 100, quantityUsed: 1 },
      ]);
    } else if (presetType === 'STEAK') {
      setDishName('สเต็กอกไก่พริกไทยดำ');
      setCategory('ทอดและกระเทียม');
      setSellingPrice(139);
      setItems([
        { id: '1', name: 'อกไก่สดลอกหนัง', purchasePrice: 95, packageSize: 1000, unit: 'g', yieldPercent: 88, quantityUsed: 220 },
        { id: '2', name: 'ซอสหมักพริกไทยดำ', purchasePrice: 110, packageSize: 1000, unit: 'ml', yieldPercent: 100, quantityUsed: 40 },
        { id: '3', name: 'เนยสดทอดกระทะ', purchasePrice: 180, packageSize: 1000, unit: 'g', yieldPercent: 100, quantityUsed: 15 },
        { id: '4', name: 'เฟรนช์ฟรายส์สำเร็จรูป', purchasePrice: 90, packageSize: 1000, unit: 'g', yieldPercent: 90, quantityUsed: 100 },
        { id: '5', name: 'สลัดผักรวม & น้ำสลัด', purchasePrice: 65, packageSize: 500, unit: 'g', yieldPercent: 85, quantityUsed: 60 },
      ]);
      setQFactorItems([
        { id: 'q1', name: 'โรสแมรี่ & พริกไทยเกลือหมัก', purchasePrice: 65, packageSize: 100, unit: 'g', yieldPercent: 100, quantityUsed: 3 },
        { id: 'q2', name: 'น้ำมันมะกอกจี่กระทะ', purchasePrice: 220, packageSize: 1000, unit: 'ml', yieldPercent: 100, quantityUsed: 10 },
      ]);
      setPackagingItems([
        { id: 'p1', name: 'กล่องสเต็กช่องแบ่ง 2 หลุม', purchasePrice: 180, packageSize: 50, unit: 'ใบ', yieldPercent: 100, quantityUsed: 1 },
        { id: 'p2', name: 'ถ้วยน้ำเกรวี่พร้อมฝาปิด', purchasePrice: 45, packageSize: 50, unit: 'ใบ', yieldPercent: 100, quantityUsed: 1 },
        { id: 'p3', name: 'มีดส้อมสเต็กพลาสติกแข็ง', purchasePrice: 65, packageSize: 50, unit: 'ชุด', yieldPercent: 100, quantityUsed: 1 },
      ]);
    } else {
      setDishName('ต้มยำกุ้งน้ำข้นยอดมะพร้าว');
      setCategory('ต้มยำและแกง');
      setSellingPrice(189);
      setItems([
        { id: '1', name: 'กุ้งสด (คิดเป็นตัว)', purchasePrice: 8.5, packageSize: 1, unit: 'ตัว', yieldPercent: 100, quantityUsed: 5 },
        { id: '2', name: 'น้ำสต็อกกระดูกหมู/ไก่', purchasePrice: 20, packageSize: 1000, unit: 'ml', yieldPercent: 100, quantityUsed: 350 },
        { id: '3', name: 'เห็ดฟาง & ยอดมะพร้าว', purchasePrice: 60, packageSize: 500, unit: 'g', yieldPercent: 75, quantityUsed: 90 },
        { id: '4', name: 'เครื่องต้มยำ (ข่า ตะไคร้ ใบมะกรูด)', purchasePrice: 35, packageSize: 300, unit: 'g', yieldPercent: 70, quantityUsed: 45 },
        { id: '5', name: 'น้ำพริกเผา & นมข้นจืด', purchasePrice: 80, packageSize: 500, unit: 'g', yieldPercent: 100, quantityUsed: 50 },
        { id: '6', name: 'มะนาวสดแท้', purchasePrice: 5, packageSize: 1, unit: 'ลูก', yieldPercent: 100, quantityUsed: 2 },
      ]);
      setQFactorItems([
        { id: 'q1', name: 'ผักชีฝรั่ง & พริกแห้งทอดโรยหน้า', purchasePrice: 30, packageSize: 200, unit: 'g', yieldPercent: 100, quantityUsed: 15 },
        { id: 'q2', name: 'น้ำปลาแท้ปรุงรสตัดเค็ม', purchasePrice: 38, packageSize: 700, unit: 'ml', yieldPercent: 100, quantityUsed: 10 },
      ]);
      setPackagingItems([
        { id: 'p1', name: 'ชามกระดาษคราฟท์ฝาปิด 850ml', purchasePrice: 195, packageSize: 50, unit: 'ชุด', yieldPercent: 100, quantityUsed: 1 },
        { id: 'p2', name: 'ช้อนซุปพลาสติกหนา', purchasePrice: 40, packageSize: 50, unit: 'คัน', yieldPercent: 100, quantityUsed: 1 },
        { id: 'p3', name: 'ถุงหูหิ้วใส่อาหารร้อน', purchasePrice: 35, packageSize: 100, unit: 'ใบ', yieldPercent: 100, quantityUsed: 1 },
      ]);
    }
  };

  // Save dish to menu
  const handleSaveToMenu = () => {
    if (!onSaveNewMenu) return;

    // Combine main ingredients, Q-Factor items, and packaging items
    const allRecipeItems = [
      ...calculatedRows.map((r, idx) => ({
        id: `item_main_${idx}_${Date.now()}`,
        ingredientId: r.sourceIngredientId || `custom_main_${idx}`,
        name: r.name,
        quantity: r.quantityUsed,
        unit: (r.unit as any) || 'g',
        type: 'INGREDIENT' as const,
        calculatedUnitCost: r.epUnitCost,
        calculatedLineCost: r.lineCost,
      })),
      ...calculatedQFactorRows.map((r, idx) => ({
        id: `item_qf_${idx}_${Date.now()}`,
        ingredientId: r.sourceIngredientId || `custom_qf_${idx}`,
        name: `[เครื่องปรุงย่อย] ${r.name}`,
        quantity: r.quantityUsed,
        unit: (r.unit as any) || 'g',
        type: 'INGREDIENT' as const,
        calculatedUnitCost: r.epUnitCost,
        calculatedLineCost: r.lineCost,
      })),
      ...calculatedPackagingRows.map((r, idx) => ({
        id: `item_pkg_${idx}_${Date.now()}`,
        ingredientId: r.sourceIngredientId || `custom_pkg_${idx}`,
        name: `[บรรจุภัณฑ์] ${r.name}`,
        quantity: r.quantityUsed,
        unit: (r.unit as any) || 'ชิ้น',
        type: 'PACKAGING' as const,
        calculatedUnitCost: r.epUnitCost,
        calculatedLineCost: r.lineCost,
      })),
    ];

    const newMenu: MenuItem = {
      id: `menu_${Date.now()}`,
      name: dishName,
      category: category,
      active: true,
      variants: [
        {
          id: `var_${Date.now()}`,
          name: 'ธรรมดา / จานเดี่ยว',
          proteinType: 'มาตรฐาน',
          sellingPrice: Math.round(sellingPrice),
          takeawayPrice: Math.round(sellingPrice + totalPackagingCost),
          deliveryPrice: Math.round(suggestedDeliveryPrice),
          overheadCost: Math.round(totalQFactorCost),
          packagingCost: totalPackagingCost,
          directFoodCost: directFoodCost,
          active: true,
          recipeItems: allRecipeItems,
        },
      ],
    };

    onSaveNewMenu(newMenu);
    setSavedSuccessMsg(`บันทึกเมนู "${dishName}" พร้อมแจกแจงรายการต้นทุนทั้งหมดสำเร็จแล้ว!`);
    setTimeout(() => setSavedSuccessMsg(null), 4000);
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Page Header */}
      <div className="bg-[#FFFDF9] border border-[#EAE4D9] p-5 sm:p-6 rounded-2xl flex flex-col md:flex-row md:items-center md:justify-between gap-4 shadow-xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-xl bg-[#F27D26]/10 text-[#F27D26] flex items-center justify-center font-bold">
              <Calculator className="w-4 h-4" />
            </span>
            <h1 className="text-xl sm:text-2xl font-bold text-stone-900 tracking-tight">
              เครื่องคิดเลขคำนวณต้นทุนอาหารตามหลักสากล (Recipe Cost Calculator)
            </h1>
          </div>
          <p className="text-xs text-stone-500 mt-1 max-w-3xl">
            คำนวณต้นทุนต่อจานอย่างแม่นยำด้วยการแจกแจงรายการจริง: วัตถุดิบหลัก, เครื่องปรุงย่อย/Q-Factor และบรรจุภัณฑ์ 
            อิงราคาซื้อ (AP), อัตราผลผลิต (Yield %) และต้นทุนเนื้อแท้ (EP) ตามหลักสากล ไร้การคาดคะเน
          </p>
        </div>

        {/* Quick Presets */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[11px] text-stone-400 font-semibold mr-1">โหลดตัวอย่าง:</span>
          <button
            type="button"
            onClick={() => handleResetToPreset('KAPRAO')}
            className="px-3 py-1.5 bg-[#FAF8F5] hover:bg-[#F7F3EB] border border-[#EAE4D9] rounded-xl text-xs font-semibold text-stone-700 transition-colors cursor-pointer"
          >
            กะเพราไข่ดาว
          </button>
          <button
            type="button"
            onClick={() => handleResetToPreset('STEAK')}
            className="px-3 py-1.5 bg-[#FAF8F5] hover:bg-[#F7F3EB] border border-[#EAE4D9] rounded-xl text-xs font-semibold text-stone-700 transition-colors cursor-pointer"
          >
            สเต็กอกไก่
          </button>
          <button
            type="button"
            onClick={() => handleResetToPreset('TOMYUM')}
            className="px-3 py-1.5 bg-[#FAF8F5] hover:bg-[#F7F3EB] border border-[#EAE4D9] rounded-xl text-xs font-semibold text-stone-700 transition-colors cursor-pointer"
          >
            ต้มยำกุ้ง
          </button>
        </div>
      </div>

      {savedSuccessMsg && (
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl flex items-center gap-3 text-emerald-800 text-sm font-semibold shadow-xs animate-in fade-in">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <span>{savedSuccessMsg}</span>
          {onNavigateToTab && (
            <button
              type="button"
              onClick={() => onNavigateToTab('food_cost')}
              className="ml-auto underline text-xs font-bold text-emerald-900 cursor-pointer"
            >
              ดูรายการเมนูทั้งหมด &rarr;
            </button>
          )}
        </div>
      )}

      {/* Main Grid: Left = Recipe & Extra Items Tables, Right = Financial Metrics & Pricing */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* LEFT COLUMN: Recipe Sheet Editor & Extra Cost Tables (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          {/* Dish Header Info Card */}
          <div className="bg-[#FFFDF9] border border-[#EAE4D9] rounded-2xl p-4 sm:p-5 shadow-xs space-y-3">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1">
                <label className="block text-[11px] font-bold text-stone-600 mb-1">
                  ชื่อเมนูอาหาร (Dish Name)
                </label>
                <input
                  type="text"
                  value={dishName}
                  onChange={(e) => setDishName(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-[#D6CEBE] rounded-xl text-sm font-bold text-stone-900 focus:outline-none focus:border-[#F27D26]"
                  placeholder="เช่น ข้าวกะเพราหมูสับไข่ดาว"
                />
              </div>

              <div className="w-full sm:w-48">
                <label className="block text-[11px] font-bold text-stone-600 mb-1">
                  หมวดหมู่ (Category)
                </label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-[#D6CEBE] rounded-xl text-xs font-semibold text-stone-800 focus:outline-none focus:border-[#F27D26]"
                >
                  <option value="ผัดและกะเพรา">ผัดและกะเพรา</option>
                  <option value="ทอดและกระเทียม">ทอดและกระเทียม</option>
                  <option value="ต้มยำและแกง">ต้มยำและแกง</option>
                  <option value="ข้าวผัดและเส้น">ข้าวผัดและเส้น</option>
                  <option value="ทานเล่นและเครื่องดื่ม">ทานเล่นและเครื่องดื่ม</option>
                  <option value="สเต็กและอาหารจานเดียว">สเต็กและอาหารจานเดียว</option>
                </select>
              </div>
            </div>
          </div>

          {/* TABLE 1: Primary Recipe Items Table */}
          <div className="bg-[#FFFDF9] border border-[#EAE4D9] rounded-2xl overflow-hidden shadow-xs">
            <div className="px-5 py-3.5 bg-[#FAF8F5] border-b border-[#EAE4D9] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#F27D26]" />
                  <span className="font-bold text-stone-900 text-sm">
                    1. รายการวัตถุดิบหลัก & สัดส่วนต่อจาน (Main Recipe Items)
                  </span>
                </div>
                <p className="text-[10px] text-stone-500 mt-0.5">
                  เนื้อสัตว์, ผัก, ข้าว, เส้น, ซอสหลัก คิดราคาซื้อ (AP) แปลงเป็นต้นทุนเนื้อแท้ (EP) ตาม Yield %
                </p>
              </div>

              {/* Add from Stock Dropdown: Select Category First, then Sub-ingredient */}
              <div className="flex items-center gap-2 flex-wrap">
                {ingredients.length > 0 && (
                  <>
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] text-stone-500 font-bold hidden sm:inline">หมวด:</span>
                      <select
                        value={selectedQuickCategory}
                        onChange={(e) => setSelectedQuickCategory(e.target.value)}
                        className="text-xs px-2 py-1.5 bg-white border border-[#D6CEBE] rounded-xl text-stone-800 font-semibold cursor-pointer max-w-[140px]"
                        title="เลือกหมวดหมู่วัตถุดิบก่อน"
                      >
                        <option value="ALL">📁 ทุกหมวดหมู่</option>
                        {quickCategories.map((cat) => (
                          <option key={cat} value={cat}>
                            {cat === 'เนื้อสัตว์และอาหารทะเล' ? '🥩 ' : cat === 'ผักและสมุนไพร' ? '🥬 ' : cat === 'เครื่องปรุงและซอส' ? '🧂 ' : cat === 'ข้าวและเส้น' ? '🍚 ' : cat === 'ไข่และเต้าหู้' ? '🥚 ' : cat === 'บรรจุภัณฑ์' ? '🥡 ' : '📦 '}{cat}
                          </option>
                        ))}
                      </select>
                    </div>

                    <select
                      onChange={(e) => {
                        if (e.target.value) {
                          handleAddItem(e.target.value);
                          e.target.value = '';
                        }
                      }}
                      defaultValue=""
                      className="text-xs px-2.5 py-1.5 bg-white border border-amber-300 rounded-xl text-stone-900 font-bold cursor-pointer max-w-[170px] truncate shadow-2xs focus:ring-2 focus:ring-[#F27D26]"
                      title="เลือกวัตถุดิบย่อยเพื่อเพิ่มเข้าสูตร"
                    >
                      <option value="" disabled>+ ดึงวัตถุดิบย่อย ({filteredQuickIngredients.length})...</option>
                      {filteredQuickIngredients.map((ing) => (
                        <option key={ing.id} value={ing.id}>
                          {ing.name} ({ing.pricePerPack ?? ing.purchasePrice}฿/{ing.packQuantity ?? ing.purchaseQuantity}{ing.packUnit ?? ing.purchaseUnit})
                        </option>
                      ))}
                    </select>
                  </>
                )}
                <button
                  type="button"
                  onClick={() => handleAddItem()}
                  className="px-3 py-1.5 bg-[#F27D26] hover:bg-[#d96817] text-white rounded-xl text-xs font-bold transition-all shadow-xs flex items-center gap-1 cursor-pointer shrink-0"
                >
                  <Plus className="w-3.5 h-3.5" />
                  เพิ่มแถว
                </button>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-[#F7F3EB] border-b border-[#EAE4D9] text-stone-600 text-[10px] uppercase font-bold tracking-wider">
                    <th className="py-2.5 px-3 min-w-[140px]">ชื่อวัตถุดิบ</th>
                    <th className="py-2.5 px-2 text-right">ราคาซื้อ (AP)</th>
                    <th className="py-2.5 px-2 text-right">ขนาดยกแพ็ค</th>
                    <th className="py-2.5 px-2 text-center">Yield %</th>
                    <th className="py-2.5 px-2 text-right">ปริมาณในจาน</th>
                    <th className="py-2.5 px-3 text-right">ต้นทุนจริง (฿)</th>
                    <th className="py-2.5 px-2 text-center w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EAE4D9]">
                  {calculatedRows.map((row) => (
                    <tr key={row.id} className="hover:bg-[#FAF8F5]/80 transition-colors">
                      <td className="py-2.5 px-3">
                        <input
                          type="text"
                          value={row.name}
                          onChange={(e) => handleUpdateItem(row.id, 'name', e.target.value)}
                          className="w-full bg-transparent border-b border-transparent hover:border-stone-300 focus:border-[#F27D26] focus:bg-white text-stone-900 font-semibold text-xs px-1 py-0.5 rounded focus:outline-none"
                        />
                      </td>

                      <td className="py-2.5 px-2 text-right">
                        <div className="inline-flex items-center gap-0.5 justify-end">
                          <span className="text-[10px] text-stone-400">฿</span>
                          <NumericInput
                            value={row.purchasePrice}
                            onValueChange={(val) => handleUpdateItem(row.id, 'purchasePrice', val)}
                            className="w-16 text-right bg-white border border-[#D6CEBE] rounded-lg px-1.5 py-0.5 font-mono text-xs font-semibold text-stone-900"
                          />
                        </div>
                      </td>

                      <td className="py-2.5 px-2 text-right">
                        <div className="inline-flex items-center gap-1 justify-end">
                          <NumericInput
                            value={row.packageSize}
                            onValueChange={(val) => handleUpdateItem(row.id, 'packageSize', val)}
                            className="w-14 text-right bg-white border border-[#D6CEBE] rounded-lg px-1.5 py-0.5 font-mono text-xs text-stone-900"
                          />
                          <input
                            type="text"
                            value={row.unit}
                            onChange={(e) => handleUpdateItem(row.id, 'unit', e.target.value)}
                            className="w-10 text-center bg-transparent border-b border-stone-200 text-stone-600 text-[10px]"
                          />
                        </div>
                      </td>

                      <td className="py-2.5 px-2 text-center">
                        <div className="inline-flex items-center gap-0.5 justify-center">
                          <NumericInput
                            value={row.yieldPercent}
                            min={1}
                            max={100}
                            onValueChange={(val) => handleUpdateItem(row.id, 'yieldPercent', val)}
                            className={`w-12 text-center rounded-lg px-1 py-0.5 font-mono text-xs font-bold border ${
                              row.yieldPercent < 70
                                ? 'bg-amber-50 border-amber-300 text-amber-900'
                                : 'bg-white border-[#D6CEBE] text-stone-900'
                            }`}
                          />
                          <span className="text-[10px] text-stone-400">%</span>
                        </div>
                      </td>

                      <td className="py-2.5 px-2 text-right">
                        <div className="inline-flex items-center gap-1 justify-end">
                          <NumericInput
                            value={row.quantityUsed}
                            onValueChange={(val) => handleUpdateItem(row.id, 'quantityUsed', val)}
                            className="w-16 text-right bg-white border border-[#D6CEBE] rounded-lg px-1.5 py-0.5 font-mono text-xs font-bold text-stone-900"
                          />
                          <span className="text-[10px] text-stone-500 w-6 text-left">{row.unit}</span>
                        </div>
                      </td>

                      <td className="py-2.5 px-3 text-right font-mono font-bold text-stone-900">
                        ฿{row.lineCost.toFixed(2)}
                      </td>

                      <td className="py-2.5 px-2 text-center">
                        <button
                          type="button"
                          onClick={() => handleRemoveItem(row.id)}
                          className="p-1 text-stone-400 hover:text-rose-600 transition-colors cursor-pointer"
                          title="ลบแถว"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Direct Cost Subtotal Strip */}
            <div className="p-4 bg-[#FAF8F5] border-t border-[#EAE4D9] flex justify-between items-center text-xs">
              <span className="font-semibold text-stone-600">
                รวมต้นทุนวัตถุดิบหลัก ({calculatedRows.length} รายการ):
              </span>
              <span className="font-mono text-base font-bold text-stone-900">
                ฿{directFoodCost.toFixed(2)}
              </span>
            </div>
          </div>

          {/* SECTION 2: Itemized Extra Costs (Packaging & Q-Factor Items Table) */}
          <div className="bg-[#FFFDF9] border border-[#EAE4D9] rounded-2xl overflow-hidden shadow-xs space-y-0">
            {/* Header with Tab Controls */}
            <div className="p-4 sm:p-5 bg-[#FAF8F5] border-b border-[#EAE4D9] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <span className="font-bold text-stone-900 text-sm flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-[#B45309]" />
                  2. ต้นทุนส่วนเพิ่มตามรายการจริง (Q-Factor & Packaging Items)
                </span>
                <p className="text-[10px] text-stone-500 mt-0.5">
                  ระบุราคาซื้อจริง (AP), ขนาดยกแพ็ค และปริมาณที่ใช้ต่อจานอย่างละเอียด ไร้การคาดคะเน
                </p>
              </div>

              {/* View Filter Buttons */}
              <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-[#D6CEBE] text-xs self-start sm:self-auto">
                <button
                  type="button"
                  onClick={() => setActiveExtraTab('BOTH')}
                  className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                    activeExtraTab === 'BOTH'
                      ? 'bg-[#F27D26] text-white shadow-xs'
                      : 'text-stone-600 hover:text-stone-900'
                  }`}
                >
                  ทั้งหมด (Both)
                </button>
                <button
                  type="button"
                  onClick={() => setActiveExtraTab('PACKAGING')}
                  className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                    activeExtraTab === 'PACKAGING'
                      ? 'bg-[#F27D26] text-white shadow-xs'
                      : 'text-stone-600 hover:text-stone-900'
                  }`}
                >
                  📦 บรรจุภัณฑ์ ({packagingItems.length})
                </button>
                <button
                  type="button"
                  onClick={() => setActiveExtraTab('SEASONING')}
                  className={`px-2.5 py-1 rounded-lg font-bold transition-all cursor-pointer ${
                    activeExtraTab === 'SEASONING'
                      ? 'bg-[#F27D26] text-white shadow-xs'
                      : 'text-stone-600 hover:text-stone-900'
                  }`}
                >
                  🧂 เครื่องปรุงย่อย ({qFactorItems.length})
                </button>
              </div>
            </div>

            {/* SUB-TABLE A: Packaging Items Table */}
            {(activeExtraTab === 'PACKAGING' || activeExtraTab === 'BOTH') && (
              <div className="border-b border-[#EAE4D9] last:border-b-0">
                <div className="px-5 py-3 bg-[#FFFDF9] flex items-center justify-between border-b border-[#EAE4D9]/80">
                  <div className="flex items-center gap-2">
                    <Box className="w-4 h-4 text-[#F27D26]" />
                    <span className="font-bold text-stone-800 text-xs">
                      กล่อง & บรรจุภัณฑ์ & อุปกรณ์จัดเสิร์ฟ (Packaging Items)
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-stone-100 text-stone-600 font-mono font-semibold">
                      {packagingItems.length} รายการ
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleAddPackagingItem()}
                    className="px-2.5 py-1 bg-white hover:bg-stone-50 border border-[#D6CEBE] text-stone-700 rounded-lg text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    เพิ่มบรรจุภัณฑ์
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-[#FAF8F5] border-b border-[#EAE4D9] text-stone-600 text-[10px] uppercase font-bold tracking-wider">
                        <th className="py-2 px-3 min-w-[140px]">ชื่อบรรจุภัณฑ์ / อุปกรณ์</th>
                        <th className="py-2 px-2 text-right">ราคาซื้อ (AP ฿)</th>
                        <th className="py-2 px-2 text-right">ขนาดยกแพ็ค</th>
                        <th className="py-2 px-2 text-center">Yield %</th>
                        <th className="py-2 px-2 text-right">จำนวนที่ใช้ในจาน</th>
                        <th className="py-2 px-3 text-right">ต้นทุนจริง (฿)</th>
                        <th className="py-2 px-2 text-center w-8"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EAE4D9]">
                      {calculatedPackagingRows.map((row) => (
                        <tr key={row.id} className="hover:bg-[#FAF8F5]/60 transition-colors">
                          <td className="py-2 px-3">
                            <input
                              type="text"
                              value={row.name}
                              onChange={(e) => handleUpdatePackagingItem(row.id, 'name', e.target.value)}
                              className="w-full bg-transparent border-b border-transparent hover:border-stone-300 focus:border-[#F27D26] focus:bg-white text-stone-900 font-semibold text-xs px-1 py-0.5 rounded focus:outline-none"
                            />
                          </td>
                          <td className="py-2 px-2 text-right">
                            <div className="inline-flex items-center gap-0.5 justify-end">
                              <span className="text-[10px] text-stone-400">฿</span>
                              <NumericInput
                                value={row.purchasePrice}
                                onValueChange={(val) => handleUpdatePackagingItem(row.id, 'purchasePrice', val)}
                                className="w-16 text-right bg-white border border-[#D6CEBE] rounded-lg px-1.5 py-0.5 font-mono text-xs font-semibold text-stone-900"
                              />
                            </div>
                          </td>
                          <td className="py-2 px-2 text-right">
                            <div className="inline-flex items-center gap-1 justify-end">
                              <NumericInput
                                value={row.packageSize}
                                onValueChange={(val) => handleUpdatePackagingItem(row.id, 'packageSize', val)}
                                className="w-14 text-right bg-white border border-[#D6CEBE] rounded-lg px-1.5 py-0.5 font-mono text-xs text-stone-900"
                              />
                              <input
                                type="text"
                                value={row.unit}
                                onChange={(e) => handleUpdatePackagingItem(row.id, 'unit', e.target.value)}
                                className="w-10 text-center bg-transparent border-b border-stone-200 text-stone-600 text-[10px]"
                              />
                            </div>
                          </td>
                          <td className="py-2 px-2 text-center">
                            <div className="inline-flex items-center gap-0.5 justify-center">
                              <NumericInput
                                value={row.yieldPercent}
                                min={1}
                                max={100}
                                onValueChange={(val) => handleUpdatePackagingItem(row.id, 'yieldPercent', val)}
                                className="w-12 text-center rounded-lg px-1 py-0.5 font-mono text-xs font-bold border bg-white border-[#D6CEBE] text-stone-900"
                              />
                              <span className="text-[10px] text-stone-400">%</span>
                            </div>
                          </td>
                          <td className="py-2 px-2 text-right">
                            <div className="inline-flex items-center gap-1 justify-end">
                              <NumericInput
                                value={row.quantityUsed}
                                onValueChange={(val) => handleUpdatePackagingItem(row.id, 'quantityUsed', val)}
                                className="w-14 text-right bg-white border border-[#D6CEBE] rounded-lg px-1.5 py-0.5 font-mono text-xs font-bold text-stone-900"
                              />
                              <span className="text-[10px] text-stone-500 w-6 text-left">{row.unit}</span>
                            </div>
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-bold text-stone-900">
                            ฿{row.lineCost.toFixed(2)}
                          </td>
                          <td className="py-2 px-2 text-center">
                            <button
                              type="button"
                              onClick={() => handleRemovePackagingItem(row.id)}
                              className="p-1 text-stone-400 hover:text-rose-600 transition-colors cursor-pointer"
                              title="ลบแถว"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="px-5 py-2.5 bg-[#FAF8F5]/80 flex justify-between items-center text-xs">
                  <span className="text-stone-600 font-semibold">รวมต้นทุนบรรจุภัณฑ์ต่อจาน:</span>
                  <span className="font-mono font-bold text-stone-900">฿{totalPackagingCost.toFixed(2)}</span>
                </div>
              </div>
            )}

            {/* SUB-TABLE B: Q-Factor / Seasoning Items Table */}
            {(activeExtraTab === 'SEASONING' || activeExtraTab === 'BOTH') && (
              <div>
                <div className="px-5 py-3 bg-[#FFFDF9] flex items-center justify-between border-b border-[#EAE4D9]/80">
                  <div className="flex items-center gap-2">
                    <Flame className="w-4 h-4 text-[#F27D26]" />
                    <span className="font-bold text-stone-800 text-xs">
                      เครื่องปรุงรสย่อย & น้ำมัน & ของเสียหน้าเตา (Q-Factor / Seasoning Items)
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-stone-100 text-stone-600 font-mono font-semibold">
                      {qFactorItems.length} รายการ
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleAddQFactorItem()}
                    className="px-2.5 py-1 bg-white hover:bg-stone-50 border border-[#D6CEBE] text-stone-700 rounded-lg text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    เพิ่มเครื่องปรุงย่อย
                  </button>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-[#FAF8F5] border-b border-[#EAE4D9] text-stone-600 text-[10px] uppercase font-bold tracking-wider">
                        <th className="py-2 px-3 min-w-[140px]">ชื่อเครื่องปรุง / น้ำมัน / ของหน้าเตา</th>
                        <th className="py-2 px-2 text-right">ราคาซื้อ (AP ฿)</th>
                        <th className="py-2 px-2 text-right">ขนาดยกแพ็ค</th>
                        <th className="py-2 px-2 text-center">Yield %</th>
                        <th className="py-2 px-2 text-right">ปริมาณที่ใช้ในจาน</th>
                        <th className="py-2 px-3 text-right">ต้นทุนจริง (฿)</th>
                        <th className="py-2 px-2 text-center w-8"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#EAE4D9]">
                      {calculatedQFactorRows.map((row) => (
                        <tr key={row.id} className="hover:bg-[#FAF8F5]/60 transition-colors">
                          <td className="py-2 px-3">
                            <input
                              type="text"
                              value={row.name}
                              onChange={(e) => handleUpdateQFactorItem(row.id, 'name', e.target.value)}
                              className="w-full bg-transparent border-b border-transparent hover:border-stone-300 focus:border-[#F27D26] focus:bg-white text-stone-900 font-semibold text-xs px-1 py-0.5 rounded focus:outline-none"
                            />
                          </td>
                          <td className="py-2 px-2 text-right">
                            <div className="inline-flex items-center gap-0.5 justify-end">
                              <span className="text-[10px] text-stone-400">฿</span>
                              <NumericInput
                                value={row.purchasePrice}
                                onValueChange={(val) => handleUpdateQFactorItem(row.id, 'purchasePrice', val)}
                                className="w-16 text-right bg-white border border-[#D6CEBE] rounded-lg px-1.5 py-0.5 font-mono text-xs font-semibold text-stone-900"
                              />
                            </div>
                          </td>
                          <td className="py-2 px-2 text-right">
                            <div className="inline-flex items-center gap-1 justify-end">
                              <NumericInput
                                value={row.packageSize}
                                onValueChange={(val) => handleUpdateQFactorItem(row.id, 'packageSize', val)}
                                className="w-14 text-right bg-white border border-[#D6CEBE] rounded-lg px-1.5 py-0.5 font-mono text-xs text-stone-900"
                              />
                              <input
                                type="text"
                                value={row.unit}
                                onChange={(e) => handleUpdateQFactorItem(row.id, 'unit', e.target.value)}
                                className="w-10 text-center bg-transparent border-b border-stone-200 text-stone-600 text-[10px]"
                              />
                            </div>
                          </td>
                          <td className="py-2 px-2 text-center">
                            <div className="inline-flex items-center gap-0.5 justify-center">
                              <NumericInput
                                value={row.yieldPercent}
                                min={1}
                                max={100}
                                onValueChange={(val) => handleUpdateQFactorItem(row.id, 'yieldPercent', val)}
                                className="w-12 text-center rounded-lg px-1 py-0.5 font-mono text-xs font-bold border bg-white border-[#D6CEBE] text-stone-900"
                              />
                              <span className="text-[10px] text-stone-400">%</span>
                            </div>
                          </td>
                          <td className="py-2 px-2 text-right">
                            <div className="inline-flex items-center gap-1 justify-end">
                              <NumericInput
                                value={row.quantityUsed}
                                onValueChange={(val) => handleUpdateQFactorItem(row.id, 'quantityUsed', val)}
                                className="w-14 text-right bg-white border border-[#D6CEBE] rounded-lg px-1.5 py-0.5 font-mono text-xs font-bold text-stone-900"
                              />
                              <span className="text-[10px] text-stone-500 w-6 text-left">{row.unit}</span>
                            </div>
                          </td>
                          <td className="py-2 px-3 text-right font-mono font-bold text-stone-900">
                            ฿{row.lineCost.toFixed(2)}
                          </td>
                          <td className="py-2 px-2 text-center">
                            <button
                              type="button"
                              onClick={() => handleRemoveQFactorItem(row.id)}
                              className="p-1 text-stone-400 hover:text-rose-600 transition-colors cursor-pointer"
                              title="ลบแถว"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="px-5 py-2.5 bg-[#FAF8F5]/80 flex justify-between items-center text-xs">
                  <span className="text-stone-600 font-semibold">รวมต้นทุนเครื่องปรุงย่อย (Q-Factor) ต่อจาน:</span>
                  <span className="font-mono font-bold text-stone-900">฿{totalQFactorCost.toFixed(2)}</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: Financial Analysis, Target FC & Pricing Simulator (5 cols) */}
        <div className="lg:col-span-5 space-y-5">
          {/* Main Pricing & Food Cost % Card */}
          <div className="bg-[#FFFDF9] border border-[#EAE4D9] rounded-2xl p-5 sm:p-6 shadow-md space-y-5">
            <div className="border-b border-[#EAE4D9] pb-4">
              <span className="text-[10px] uppercase font-bold tracking-widest text-stone-500 block">
                สรุปต้นทุนรวมต่อจาน (Total Plate Cost)
              </span>
              <div className="text-3xl sm:text-4xl font-mono font-bold text-stone-900 mt-1">
                ฿{totalCostPerPortion.toFixed(2)}
              </div>
              <div className="flex items-center gap-2 mt-2 text-xs text-stone-500 flex-wrap">
                <span className="bg-[#FAF8F5] px-2 py-0.5 rounded-md border border-[#EAE4D9]">
                  วัตถุดิบ ฿{directFoodCost.toFixed(2)}
                </span>
                <span>+</span>
                <span className="bg-[#FAF8F5] px-2 py-0.5 rounded-md border border-[#EAE4D9]">
                  เครื่องปรุง ฿{totalQFactorCost.toFixed(2)}
                </span>
                <span>+</span>
                <span className="bg-[#FAF8F5] px-2 py-0.5 rounded-md border border-[#EAE4D9]">
                  บรรจุภัณฑ์ ฿{totalPackagingCost.toFixed(2)}
                </span>
              </div>
            </div>

            {/* Price Input & Actual Food Cost % Result */}
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-stone-800 mb-1">
                  ราคาขายปัจจุบันที่ตั้งไว้ (Selling Price)
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400 font-bold">฿</span>
                  <NumericInput
                    value={sellingPrice}
                    min={1}
                    onValueChange={(val) => setSellingPrice(val)}
                    className="w-full pl-8 pr-4 py-2.5 bg-white border-2 border-[#F27D26] rounded-xl text-lg font-mono font-bold text-stone-900 focus:outline-none"
                  />
                </div>
              </div>

              {/* Status Banner */}
              <div className={`p-4 rounded-xl border ${status.color} space-y-2`}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider">
                    Food Cost % ปัจจุบัน
                  </span>
                  <span className={`text-xs px-2.5 py-0.5 rounded-full font-bold ${status.badge}`}>
                    {status.label}
                  </span>
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-3xl font-mono font-bold">
                    {actualFoodCostPercent.toFixed(1)}%
                  </span>
                  <span className="text-xs font-semibold">
                    (เป้าหมายสากล ≤ {targetFcPercent}%)
                  </span>
                </div>
                {/* Progress bar */}
                <div className="w-full h-2 rounded-full bg-stone-200 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      actualFoodCostPercent <= 32
                        ? 'bg-emerald-500'
                        : actualFoodCostPercent <= 38
                        ? 'bg-amber-500'
                        : 'bg-rose-500'
                    }`}
                    style={{ width: `${Math.min(actualFoodCostPercent, 100)}%` }}
                  />
                </div>
                <p className="text-[11px] leading-relaxed pt-1">
                  {status.desc}
                </p>
              </div>

              {/* Contribution Margin Strip */}
              <div className="p-3.5 bg-[#FAF8F5] border border-[#EAE4D9] rounded-xl flex items-center justify-between text-xs">
                <div>
                  <span className="font-bold text-stone-800 block">
                    กำไรส่วนเกินต่อจาน (Gross Profit / Margin)
                  </span>
                  <span className="text-[10px] text-stone-500">
                    ราคาขาย ฿{sellingPrice} หักต้นทุน ฿{totalCostPerPortion.toFixed(2)}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-base font-mono font-bold text-emerald-700 block">
                    +฿{contributionMargin.toFixed(2)}
                  </span>
                  <span className="text-[10px] font-mono text-stone-500">
                    Margin {marginPercent.toFixed(1)}%
                  </span>
                </div>
              </div>
            </div>

            {/* Target Food Cost % & Suggested Price Calculator */}
            <div className="pt-4 border-t border-[#EAE4D9] space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-stone-800">
                  เกณฑ์เป้าหมาย Food Cost % (Target Benchmark)
                </span>
                <span className="font-mono font-bold text-[#F27D26] text-sm">
                  {targetFcPercent}%
                </span>
              </div>
              <input
                type="range"
                min="20"
                max="45"
                step="1"
                value={targetFcPercent}
                onChange={(e) => setTargetFcPercent(parseFloat(e.target.value))}
                className="w-full accent-[#F27D26] cursor-pointer"
              />

              {/* Suggested Price Card */}
              <div className="p-4 bg-amber-50/60 border border-amber-200/80 rounded-xl space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-stone-800">
                    ราคาขายหน้าร้านที่แนะนำ (Suggested Price):
                  </span>
                  <span className="font-mono text-lg font-bold text-amber-900">
                    ฿{Math.ceil(suggestedSellingPrice)}
                  </span>
                </div>
                <p className="text-[10px] text-stone-600">
                  สูตรสากล: ต้นทุน ฿{totalCostPerPortion.toFixed(2)} ÷ {targetFcPercent}% = ฿{suggestedSellingPrice.toFixed(2)} (ปัดเศษเป็น ฿{Math.ceil(suggestedSellingPrice)})
                </p>
                {suggestedSellingPrice > sellingPrice && (
                  <button
                    type="button"
                    onClick={() => setSellingPrice(Math.ceil(suggestedSellingPrice))}
                    className="w-full mt-2 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer"
                  >
                    ปรับใช้ราคาแนะนำ ฿{Math.ceil(suggestedSellingPrice)} ทันที
                  </button>
                )}
              </div>

              {/* Delivery Price with GP simulator */}
              <div className="p-4 bg-[#FAF8F5] border border-[#EAE4D9] rounded-xl space-y-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-stone-800">
                    ราคาขายเดลิเวอรี (หัก GP {deliveryGpPercent}%)
                  </span>
                  <span className="font-mono text-base font-bold text-stone-900">
                    ฿{Math.ceil(suggestedDeliveryPrice)}
                  </span>
                </div>
                <p className="text-[10px] text-stone-500">
                  ตั้งราคาเดลิเวอรีที่ ฿{Math.ceil(suggestedDeliveryPrice)} เพื่อให้หลังจากโดนหัก GP {deliveryGpPercent}% แล้ว ร้านยังคงได้ Food Cost {targetFcPercent}% ตามเป้าหมาย ไม่ขาดทุน
                </p>
              </div>
            </div>

            {/* Action Buttons: Save to Menu & Print */}
            <div className="pt-2 flex flex-col sm:flex-row gap-2.5">
              <button
                type="button"
                onClick={handleSaveToMenu}
                className="flex-1 py-3 bg-[#F27D26] hover:bg-[#d96817] text-white rounded-xl text-xs font-bold shadow-md shadow-[#F27D26]/20 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Save className="w-4 h-4" />
                บันทึกเข้าสู่คลังเมนูอาหาร
              </button>

              <button
                type="button"
                onClick={() => window.print()}
                className="px-4 py-3 bg-white hover:bg-stone-50 border border-[#D6CEBE] text-stone-700 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
              >
                <Printer className="w-4 h-4" />
                พิมพ์ Recipe Sheet
              </button>
            </div>
          </div>

          {/* International Culinary Rules Reference Card */}
          <div className="bg-[#FAF8F5] border border-[#EAE4D9] rounded-2xl p-4 text-xs space-y-2.5">
            <div className="flex items-center gap-2 font-bold text-stone-800">
              <Info className="w-4 h-4 text-[#F27D26]" />
              <span>หลักสากลในการคำนวณ Food Cost (International Standards)</span>
            </div>
            <ul className="space-y-1.5 text-[11px] text-stone-600 list-disc list-inside">
              <li>
                <strong className="text-stone-800">As-Purchased (AP):</strong> ราคาซื้อวัตถุดิบยกแพ็ค/กิโลกรัม
              </li>
              <li>
                <strong className="text-stone-800">Usable Yield %:</strong> น้ำหนักส่วนที่ทานได้จริงหลังตัดแต่งลอกหนัง/เอ็น/เด็ดใบ
              </li>
              <li>
                <strong className="text-stone-800">Edible Portion (EP):</strong> ต้นทุนเนื้อแท้หลังตัดแต่ง = AP Price ÷ Yield %
              </li>
              <li>
                <strong className="text-stone-800">Q-Factor:</strong> แจกแจงรายการเครื่องปรุงย่อย น้ำมัน ซอส และของเสียหน้าเตาตามการใช้จริง
              </li>
              <li>
                <strong className="text-stone-800">Packaging:</strong> แจกแจงรายการกล่อง ถุง ช้อนส้อม และซองเครื่องปรุงตามชิ้นที่ใช้จริง
              </li>
              <li>
                <strong className="text-stone-800">Food Cost %:</strong> สัดส่วนต้นทุนรวมต่อราคาขาย มาตรฐานภัตตาคาร 28% - 35%
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};
