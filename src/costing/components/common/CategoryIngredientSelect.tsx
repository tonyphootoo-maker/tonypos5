import React, { useState, useEffect, useMemo } from 'react';
import { Ingredient } from '../../types';
import { getLocalizedText, localizeUnit } from '../../../utils/thaiToEnglish';
import { useLanguage } from '../../../contexts/LanguageContext';

export interface ExtraIngredientOption {
  id: string;
  name: string;
  category?: string;
  subtext?: string;
  badge?: string;
  data?: any;
}

export interface CategoryIngredientSelectProps {
  ingredients: Ingredient[] | any[];
  selectedIngredientId: string;
  onSelectIngredientId: (ingredientId: string, ingredient?: any) => void;
  categoryLabel?: string;
  ingredientLabel?: string;
  categoryPlaceholder?: string;
  ingredientPlaceholder?: string;
  includeAllCategories?: boolean;
  allCategoriesLabel?: string;
  defaultCategory?: string;
  extraOptions?: ExtraIngredientOption[];
  formatIngredientOption?: (ingredient: any) => string;
  theme?: 'light' | 'dark';
  layout?: 'row' | 'col';
  className?: string;
  disabled?: boolean;
  required?: boolean;
  lang?: 'th' | 'en';
}

const CATEGORY_ORDER = [
  'เนื้อสัตว์และอาหารทะเล',
  'ผักและสมุนไพร',
  'เครื่องปรุงและซอส',
  'ข้าวและเส้น',
  'ไข่และเต้าหู้',
  'ของแห้งและเบ็ดเตล็ด',
  'บรรจุภัณฑ์',
];

const CATEGORY_ICONS: Record<string, string> = {
  'เนื้อสัตว์และอาหารทะเล': '🥩',
  'ผักและสมุนไพร': '🥬',
  'เครื่องปรุงและซอส': '🧂',
  'ข้าวและเส้น': '🍚',
  'ไข่และเต้าหู้': '🥚',
  'ของแห้งและเบ็ดเตล็ด': '📦',
  'บรรจุภัณฑ์': '🥡',
};

export const CategoryIngredientSelect: React.FC<CategoryIngredientSelectProps> = ({
  ingredients,
  selectedIngredientId,
  onSelectIngredientId,
  categoryLabel,
  ingredientLabel,
  categoryPlaceholder,
  ingredientPlaceholder,
  includeAllCategories = true,
  allCategoriesLabel,
  defaultCategory,
  extraOptions = [],
  formatIngredientOption,
  theme = 'light',
  layout = 'row',
  className = '',
  disabled = false,
  required = false,
  lang: propLang,
}) => {
  const { lang: ctxLang } = useLanguage();
  const lang = propLang ?? ctxLang;
  const resolvedCategoryLabel =
    categoryLabel ?? (lang === 'en' ? 'Ingredient Category' : 'หมวดหมู่วัตถุดิบ');
  const resolvedIngredientLabel =
    ingredientLabel ?? (lang === 'en' ? 'Select Ingredient' : 'เลือกวัตถุดิบย่อย');
  const resolvedIngredientPlaceholder =
    ingredientPlaceholder ?? (lang === 'en' ? '-- Select Ingredient --' : '-- เลือกวัตถุดิบย่อย --');
  const resolvedAllCategoriesLabel =
    allCategoriesLabel ?? (lang === 'en' ? '📁 All Categories' : '📁 ทุกหมวดหมู่วัตถุดิบ');
  void categoryPlaceholder;
  // Extract all unique categories in preferred order
  const categories = useMemo(() => {
    const set = new Set<string>();
    ingredients.forEach((ing) => {
      const cat = ing.category || ing.categoryName;
      if (cat) set.add(cat);
    });
    extraOptions.forEach((opt) => {
      if (opt.category) set.add(opt.category);
    });

    const ordered: string[] = [];
    CATEGORY_ORDER.forEach((cat) => {
      if (set.has(cat)) {
        ordered.push(cat);
        set.delete(cat);
      }
    });
    // Add any remaining categories
    set.forEach((cat) => ordered.push(cat));
    return ordered;
  }, [ingredients, extraOptions]);

  // Determine initial category based on currently selected ingredient
  const initialCategory = useMemo(() => {
    if (selectedIngredientId) {
      const foundExtra = extraOptions.find((e) => e.id === selectedIngredientId);
      if (foundExtra?.category) return foundExtra.category;

      const found = ingredients.find((i) => i.id === selectedIngredientId);
      if (found?.category) return found.category;
    }
    if (defaultCategory) return defaultCategory;
    if (includeAllCategories) return 'ALL';
    return categories[0] || 'ALL';
  }, [selectedIngredientId, ingredients, extraOptions, defaultCategory, includeAllCategories, categories]);

  const [selectedCategory, setSelectedCategory] = useState<string>(initialCategory);

  // Sync category when selectedIngredientId changes externally
  useEffect(() => {
    if (selectedIngredientId) {
      const foundExtra = extraOptions.find((e) => e.id === selectedIngredientId);
      if (foundExtra?.category) {
        setSelectedCategory(foundExtra.category);
        return;
      }
      const found = ingredients.find((i) => i.id === selectedIngredientId);
      if (found?.category) {
        setSelectedCategory(found.category);
      }
    }
  }, [selectedIngredientId, ingredients, extraOptions]);

  // Filter ingredients by selected category
  const filteredIngredients = useMemo(() => {
    if (selectedCategory === 'ALL') {
      return ingredients;
    }
    return ingredients.filter(
      (ing) => (ing.category || ing.categoryName) === selectedCategory
    );
  }, [ingredients, selectedCategory]);

  const filteredExtraOptions = useMemo(() => {
    if (selectedCategory === 'ALL') {
      return extraOptions;
    }
    return extraOptions.filter((opt) => !opt.category || opt.category === selectedCategory);
  }, [extraOptions, selectedCategory]);

  const handleCategoryChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newCat = e.target.value;
    setSelectedCategory(newCat);

    // If current selected ingredient is not in the new category, clear selection
    if (selectedIngredientId && newCat !== 'ALL') {
      const inExtras = extraOptions.some((opt) => opt.id === selectedIngredientId && (!opt.category || opt.category === newCat));
      const inIngs = ingredients.some((ing) => ing.id === selectedIngredientId && (ing.category || ing.categoryName) === newCat);
      if (!inExtras && !inIngs) {
        onSelectIngredientId('', undefined);
      }
    }
  };

  const handleIngredientChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newId = e.target.value;
    if (!newId) {
      onSelectIngredientId('', undefined);
      return;
    }
    const extraMatch = extraOptions.find((opt) => opt.id === newId);
    if (extraMatch) {
      onSelectIngredientId(newId, extraMatch.data || extraMatch);
      return;
    }
    const ingMatch = ingredients.find((ing) => ing.id === newId);
    onSelectIngredientId(newId, ingMatch);
  };

  const isDark = theme === 'dark';
  const labelClass = isDark
    ? 'block text-white/80 font-bold text-xs mb-1'
    : 'block text-stone-700 font-bold text-xs mb-1';

  const selectClass = isDark
    ? 'w-full p-2.5 bg-[#1a1a1a] border border-white/15 rounded-xl font-bold text-white text-xs focus:outline-none focus:border-[#F27D26] cursor-pointer'
    : 'w-full p-2.5 bg-white border border-[#D6CEBE] rounded-xl font-semibold text-stone-900 text-xs focus:outline-none focus:border-[#F27D26] focus:ring-1 focus:ring-[#F27D26] cursor-pointer shadow-2xs';

  return (
    <div
      className={`space-y-3 ${
        layout === 'row' ? 'grid grid-cols-1 sm:grid-cols-2 gap-3 space-y-0' : ''
      } ${className}`}
    >
      {/* 1. Category Selector */}
      <div>
        {resolvedCategoryLabel && (
          <label className={labelClass}>
            {resolvedCategoryLabel} {required && <span className="text-[#F27D26]">*</span>}
          </label>
        )}
        <select
          value={selectedCategory}
          onChange={handleCategoryChange}
          disabled={disabled}
          className={selectClass}
        >
          {includeAllCategories && (
            <option value="ALL" className={isDark ? 'bg-[#1a1a1a] text-white' : ''}>
              {resolvedAllCategoriesLabel}
            </option>
          )}
          {categories.map((cat) => {
            const icon = CATEGORY_ICONS[cat] || '📁';
            return (
              <option key={cat} value={cat} className={isDark ? 'bg-[#1a1a1a] text-white' : ''}>
                {icon} {getLocalizedText(lang, cat)}
              </option>
            );
          })}
        </select>
      </div>

      {/* 2. Sub-ingredient Selector */}
      <div>
        {resolvedIngredientLabel && (
          <label className={labelClass}>
            {resolvedIngredientLabel} {required && <span className="text-[#F27D26]">*</span>}
          </label>
        )}
        <select
          value={selectedIngredientId}
          onChange={handleIngredientChange}
          disabled={disabled}
          required={required}
          className={selectClass}
        >
          <option value="" className={isDark ? 'bg-[#1a1a1a] text-white/60' : 'text-stone-400'}>
            {resolvedIngredientPlaceholder} ({filteredIngredients.length + filteredExtraOptions.length}{' '}
            {lang === 'en' ? 'items' : 'รายการ'})
          </option>

          {/* Extra options if any (e.g. seafood combo) */}
          {filteredExtraOptions.length > 0 && (
            <optgroup
              label={lang === 'en' ? 'Special Options' : 'ตัวเลือกพิเศษ'}
              className={isDark ? 'bg-[#1a1a1a] text-amber-400 font-bold' : 'font-bold text-[#F27D26]'}
            >
              {filteredExtraOptions.map((opt) => (
                <option key={opt.id} value={opt.id} className={isDark ? 'text-white' : 'text-stone-900'}>
                  {getLocalizedText(lang, opt.name)} {opt.subtext ? `(${opt.subtext})` : ''}
                </option>
              ))}
            </optgroup>
          )}

          {/* Regular Ingredients */}
          {filteredIngredients.map((ing) => {
            const ingDisplay = getLocalizedText(lang, ing.thaiName || ing.name, ing.englishName);
            const unitDisplay = localizeUnit(ing.usageUnit || ing.baseUnit || ing.purchaseUnit || 'g', lang);
            const label = formatIngredientOption
              ? formatIngredientOption(ing)
              : `${ingDisplay} (฿${(ing.costPerBaseUnit ?? ing.purchasePrice ?? 0).toFixed(ing.costPerBaseUnit && ing.costPerBaseUnit < 1 ? 3 : 2)}/${unitDisplay})`;

            return (
              <option key={ing.id} value={ing.id} className={isDark ? 'bg-[#1a1a1a] text-white' : 'text-stone-900'}>
                {label}
              </option>
            );
          })}
        </select>
      </div>
    </div>
  );
};
