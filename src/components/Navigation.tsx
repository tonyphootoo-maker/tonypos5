import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  Menu,
  X,
  LayoutGrid,
  UtensilsCrossed,
  Sliders,
  Receipt,
  CircleDollarSign,
  DatabaseBackup,
  Settings,
  LogOut,
  Clock,
  Globe,
  Sparkles,
  Calculator,
  BookOpen,
  Beef,
  FileSpreadsheet,
  Layers,
  ShoppingBag,
} from 'lucide-react';
import { Language, ShiftDoc } from '../types';
import { translations } from '../i18n/translations';
import { useLanguage } from '../contexts/LanguageContext';
import { OnlineStatusBadge } from './OnlineStatusBadge';
import { PWAInstallButton } from './PWAInstallButton';
import { signOutOwner } from '../data/db';

export type AppPage =
  | 'pos'
  | 'floor_plan'
  | 'menu_cost'
  | 'option_groups'
  | 'bills'
  | 'online_orders'
  | 'finance_hub'
  | 'finance'
  | 'reports'
  | 'dashboard'
  | 'backup'
  | 'settings'
  | 'cost_executive_dashboard'
  | 'cost_food_cost'
  | 'cost_food_cost_alacarte'
  | 'cost_quick_calculator'
  | 'cost_recipes'
  | 'cost_sauces'
  | 'cost_ingredients'
  | 'cost_purchases'
  | 'cost_inventory'
  | 'cost_pnl'
  | 'cost_overhead_breakeven'
  | 'cost_expenses'
  | 'cost_labor'
  | 'cost_sales_entry'
  | 'cost_reports'
  | 'cost_settings';

const UNIFIED_FINANCE_PAGES: AppPage[] = [
  'finance_hub',
  'finance',
  'reports',
  'dashboard',
  'cost_executive_dashboard',
  'cost_pnl',
  'cost_overhead_breakeven',
  'cost_expenses',
  'cost_labor',
  'cost_sales_entry',
];

interface Props {
  currentPage: AppPage;
  onSelectPage: (page: AppPage) => void;
  lang?: Language;
  onToggleLang?: () => void;
  userEmail?: string | null;
  activeShift?: ShiftDoc | null;
  onOpenShiftModal: () => void;
}

interface MenuItemDef {
  id: AppPage;
  label: string;
  desc: { en: string; th: string };
  icon: React.ReactNode;
}

interface MenuGroupDef {
  title: { en: string; th: string };
  items: MenuItemDef[];
}

export const Navigation: React.FC<Props> = ({
  currentPage,
  onSelectPage,
  lang: propLang,
  onToggleLang: propOnToggleLang,
  userEmail,
  activeShift,
  onOpenShiftModal,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const { lang: ctxLang, toggleLang: ctxToggleLang } = useLanguage();
  const lang = propLang ?? ctxLang;
  const onToggleLang = propOnToggleLang ?? ctxToggleLang;
  const t = translations[lang];

  // Close on Escape key press
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const menuGroups: MenuGroupDef[] = [
    {
      title: { th: 'ระบบขายหน้าร้าน (POS)', en: 'POS Operations' },
      items: [
        {
          id: 'pos',
          label: t.nav.tablesPos,
          desc: {
            th: 'จัดการโต๊ะ สั่งอาหาร และคิดเงิน',
            en: 'Floor plan, takeaway & checkout',
          },
          icon: <LayoutGrid className="w-5 h-5 text-orange-600" />,
        },
        {
          id: 'floor_plan',
          label: t.nav.floorPlan,
          desc: {
            th: 'ลากวาง ย่อ-ขยาย เลือกรูปแบบโต๊ะ & เก้าอี้',
            en: 'Drag, resize & customize tables & chairs',
          },
          icon: <Layers className="w-5 h-5 text-amber-600" />,
        },
        {
          id: 'option_groups',
          label: t.nav.optionGroups,
          desc: {
            th: 'ท็อปปิ้ง ระดับความหวาน ตัวเลือกเสริม',
            en: 'Toppings, options & modifier groups',
          },
          icon: <Sliders className="w-5 h-5 text-amber-600" />,
        },
        {
          id: 'bills',
          label: t.nav.billsHistory,
          desc: {
            th: 'ประวัติบิลทั้งหมด พิมพ์ใบเสร็จซ้ำ',
            en: 'Bills history & receipt reprint',
          },
          icon: <Receipt className="w-5 h-5 text-orange-600" />,
        },
        {
          id: 'online_orders',
          label: t.nav.onlineOrders,
          desc: {
            th: 'รับออเดอร์หน้าร้าน/เดลิเวอรี ส่งงาน Rider & ซิงค์ยอดเข้า P&L',
            en: 'Manage web pickup/delivery orders, Rider dispatch & P&L sync',
          },
          icon: <ShoppingBag className="w-5 h-5 text-emerald-600" />,
        },
      ],
    },
    {
      title: { th: 'คำนวณต้นทุน & สูตรอาหาร', en: 'Food Cost & Recipes' },
      items: [
        {
          id: 'cost_quick_calculator',
          label: lang === 'th' ? 'เครื่องคิดเลขต้นทุนด่วน' : 'Quick Cost Calculator',
          desc: {
            th: 'คำนวณต้นทุนต่อจานและราคาขาย Delivery ทันที',
            en: 'Interactive recipe & delivery pricing simulator',
          },
          icon: <Calculator className="w-5 h-5 text-orange-600" />,
        },
        {
          id: 'cost_food_cost',
          label: lang === 'th' ? 'ต้นทุนอาหาร / เมนู' : 'Food Cost / Menu',
          desc: {
            th: 'วิเคราะห์ต้นทุนอาหาร & ตารางราคาขาย',
            en: 'Menu food cost & channel pricing sheet',
          },
          icon: <UtensilsCrossed className="w-5 h-5 text-amber-600" />,
        },
        {
          id: 'cost_recipes',
          label: lang === 'th' ? 'คลังสูตรอาหารกลาง' : 'Base Recipe Builder',
          desc: {
            th: 'สูตรอาหารมาตรฐานชั่งตวงตามสัดส่วน',
            en: 'Standardized dish recipe cards',
          },
          icon: <BookOpen className="w-5 h-5 text-orange-700" />,
        },
        {
          id: 'cost_ingredients',
          label: lang === 'th' ? 'วัตถุดิบ & Yield Lab' : 'Ingredients & Yield Lab',
          desc: {
            th: 'ราคา AP / EP และ % สูญเสียจากการเตรียม',
            en: 'AP/EP costing, yield lab & price history',
          },
          icon: <Beef className="w-5 h-5 text-rose-600" />,
        },
      ],
    },
    {
      title: { th: 'การเงิน บริหาร & รายงาน P&L', en: 'Finance & Executive P&L' },
      items: [
        {
          id: 'finance_hub',
          label: lang === 'th' ? 'การเงิน บริหาร & รายงาน P&L' : 'Finance & Executive P&L',
          desc: {
            th: 'รวม KPI บริหาร งบ P&L ยอดขาย ค่าใช้จ่าย ค่าแรง และจุดคุ้มทุน',
            en: 'Unified KPIs, P&L, daily sales, expenses, labor & break-even',
          },
          icon: <CircleDollarSign className="w-5 h-5 text-emerald-600" />,
        },
      ],
    },
    {
      title: { th: 'Excel สำรองข้อมูล & ตั้งค่า', en: 'Excel, Backup & Settings' },
      items: [
        {
          id: 'cost_reports',
          label: lang === 'th' ? 'รายงาน & นำเข้า/ส่งออก Excel' : 'Reports & Excel (.xlsx)',
          desc: {
            th: 'ส่งออก/นำเข้าไฟล์ Excel และรายการตรวจสอบ',
            en: 'Excel workbook import/export & review queue',
          },
          icon: <FileSpreadsheet className="w-5 h-5 text-emerald-700" />,
        },
        {
          id: 'backup',
          label: t.nav.backup,
          desc: {
            th: 'สำรอง กู้คืน ส่งออก นำเข้า JSON',
            en: 'Export, import & cloud database sync',
          },
          icon: <DatabaseBackup className="w-5 h-5 text-blue-600" />,
        },
        {
          id: 'cost_settings',
          label: lang === 'th' ? 'เกณฑ์ต้นทุน GP & Q-Factor' : 'Costing Benchmarks',
          desc: {
            th: 'ตั้งค่า Target FC%, GP+VAT, Q-Factor & ไอคอน',
            en: 'Target FC%, Delivery GP, Q-Factor & icon',
          },
          icon: <Settings className="w-5 h-5 text-amber-700" />,
        },
        {
          id: 'settings',
          label: t.nav.settings,
          desc: {
            th: 'ข้อมูลร้าน ภาษี ค่าบริการ หัวใบเสร็จ POS',
            en: 'Store profile, VAT & receipt settings',
          },
          icon: <Settings className="w-5 h-5 text-neutral-600" />,
        },
      ],
    },
  ];

  const sidebarContent = (
    <div className="fixed inset-0 z-50 flex pointer-events-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-neutral-950/50 backdrop-blur-xs transition-opacity duration-200"
        onClick={() => setIsOpen(false)}
        aria-hidden="true"
      />

      {/* Left Sidebar Bar: Spans from top all the way down to bottom */}
      <div className="relative w-80 sm:w-88 max-w-[85vw] h-screen h-[100dvh] bg-[#F8FAFC] shadow-[16px_0_40px_-10px_rgba(15,23,42,0.22)] flex flex-col z-10 border-r border-slate-200">
        {/* Drawer Header */}
        <div className="p-4 bg-gradient-to-br from-orange-500 via-orange-600 to-red-600 text-white flex items-center justify-between shadow-[0_4px_0_rgba(154,52,18,0.3),0_10px_20px_-6px_rgba(234,88,12,0.3)] shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/20 backdrop-blur-xs flex items-center justify-center font-black text-white text-lg border border-white/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.45),0_3px_0_rgba(0,0,0,0.16)]">
              T
            </div>
            <div className="leading-tight">
              <div className="flex items-center gap-1.5">
                <span className="font-extrabold text-base tracking-tight">Tony&apos;s Kit</span>
                <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-white/20 text-white">
                  Pro
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            aria-label={lang === 'th' ? 'ปิดแถบเมนูด้านข้าง' : 'Close sidebar menu'}
            className="p-1.5 rounded-xl bg-white/15 hover:bg-white/25 text-white cursor-pointer transition-colors active:scale-95"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Menu Navigation Items (Scrollable from top to bottom) */}
        <div className="flex-1 overflow-y-auto p-3.5 space-y-4">
          {menuGroups.map((group) => (
            <div key={group.title.en} className="space-y-1.5">
              <div className="px-2.5 pt-1 pb-0.5 text-[11px] font-bold uppercase tracking-wider text-slate-400">
                {group.title[lang]}
              </div>
              {group.items.map((item) => {
                const isActive =
                  item.id === 'finance_hub'
                    ? UNIFIED_FINANCE_PAGES.includes(currentPage)
                    : currentPage === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      onSelectPage(item.id);
                      setIsOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-2xl text-left transition-all cursor-pointer group ${
                      isActive
                        ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-[0_3px_0_#c2410c,0_8px_16px_-6px_rgba(234,88,12,0.32)]'
                        : 'bg-white text-slate-700 hover:bg-orange-50/70 hover:text-orange-950 border border-slate-200/80 shadow-[0_2px_0_rgba(203,213,225,0.5)]'
                    }`}
                  >
                    <div
                      className={`p-1.5 rounded-xl shrink-0 transition-colors ${
                        isActive ? 'bg-white/20 text-white' : 'bg-slate-100 group-hover:bg-white'
                      }`}
                    >
                      {item.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-xs sm:text-sm font-bold truncate">{item.label}</span>
                        {isActive && (
                          <Sparkles className="w-3.5 h-3.5 text-amber-200 shrink-0" />
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        {/* Drawer Bottom Footer (Extends down to the very bottom) */}
        <div className="p-3.5 border-t border-neutral-200 bg-neutral-50/90 shrink-0 space-y-2.5">
          {/* Quick Shift & Lang in Drawer */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setIsOpen(false);
                onOpenShiftModal();
              }}
              className={`flex-1 py-1.5 px-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 border transition-all cursor-pointer shadow-2xs active:scale-95 ${
                activeShift
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100'
                  : 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100'
              }`}
            >
              <Clock className="w-3.5 h-3.5" />
              <span className="truncate">{activeShift ? t.nav.shiftActive : t.nav.openShift}</span>
            </button>

            <button
              onClick={onToggleLang}
              className="py-1.5 px-3 rounded-xl bg-white hover:bg-neutral-100 text-neutral-800 border border-neutral-300 text-xs font-bold flex items-center justify-center gap-1.5 shadow-2xs active:scale-95 cursor-pointer"
              title={lang === 'th' ? 'สลับภาษา ไทย / อังกฤษ' : 'Toggle Thai / English'}
            >
              <Globe className="w-3.5 h-3.5 text-neutral-600" />
              <span>{lang === 'th' ? 'ไทย' : 'EN'}</span>
            </button>
          </div>

          {/* User Email & Sign Out */}
          <div className="text-[11px] text-neutral-500 truncate flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"></span>
            <span className="truncate">
              {t.nav.signedInAs} <strong className="text-neutral-800">{userEmail || (lang === 'th' ? 'เจ้าของร้าน' : 'Owner')}</strong>
            </span>
          </div>

          <button
            onClick={async () => {
              setIsOpen(false);
              await signOutOwner();
            }}
            className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 text-xs font-bold cursor-pointer transition-colors shadow-2xs active:scale-95"
          >
            <LogOut className="w-4 h-4" />
            <span>{t.nav.signOut}</span>
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <header className="sticky top-0 z-40 bg-white/90 backdrop-blur-xl border-b border-slate-200/90 shadow-[inset_0_1px_0_rgba(255,255,255,1),0_6px_20px_-8px_rgba(15,23,42,0.1)]">
      <div className="max-w-7xl mx-auto px-3 sm:px-5 py-2.5 flex items-center justify-between gap-2">
        {/* Left: Hamburger & Brand */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setIsOpen(true)}
            aria-label={lang === 'th' ? 'เปิดแถบเมนูด้านข้าง' : 'Open Sidebar Menu'}
            title={lang === 'th' ? 'เปิดแถบเมนูด้านซ้าย' : 'Open Left Sidebar Menu'}
            className="p-2 rounded-xl bg-white hover:bg-orange-50 text-orange-700 border border-slate-200 shadow-[0_2px_0_#e2e8f0,0_4px_10px_-4px_rgba(15,23,42,0.08)] transition-transform active:translate-y-[1px] flex items-center justify-center cursor-pointer"
          >
            <Menu className="w-5 h-5" />
          </button>

          <div
            onClick={() => onSelectPage('pos')}
            className="flex items-center gap-2.5 cursor-pointer select-none"
          >
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500 via-orange-600 to-red-600 flex items-center justify-center text-white font-black text-lg border border-orange-300/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.4),0_3px_0_#c2410c,0_8px_16px_-4px_rgba(234,88,12,0.35)]">
              T
            </div>
            <div className="leading-tight">
              <div className="font-extrabold text-slate-900 tracking-tight flex items-center gap-1.5">
                <span>Tony&apos;s Kit</span>
                <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-orange-100 text-orange-700 border border-orange-200">
                  Pro
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right: Quick actions, Status, Lang Switcher */}
        <div className="flex items-center gap-2 sm:gap-2.5">
          {/* Shift Button */}
          <button
            onClick={onOpenShiftModal}
            className={`px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 border transition-all cursor-pointer active:translate-y-[1px] ${
              activeShift
                ? 'bg-emerald-50 text-emerald-800 border-emerald-200 shadow-[0_2px_0_#a7f3d0] hover:bg-emerald-100'
                : 'bg-amber-50 text-amber-900 border-amber-200 shadow-[0_2px_0_#fde68a] hover:bg-amber-100'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">
              {activeShift ? t.nav.shiftActive : t.nav.openShift}
            </span>
          </button>

          {/* Online status indicator */}
          <OnlineStatusBadge lang={lang} />

          {/* PWA Install Button (Android POS / Tablet / iPad / iOS) */}
          <PWAInstallButton lang={lang} variant="header" />

          {/* Language Switcher */}
          <button
            onClick={onToggleLang}
            className="px-2.5 py-1.5 rounded-xl bg-white hover:bg-slate-50 text-slate-800 border border-slate-200 text-xs font-bold flex items-center gap-1.5 shadow-[0_2px_0_#e2e8f0] active:translate-y-[1px] transition-all cursor-pointer"
            title={lang === 'th' ? 'สลับภาษา ไทย / อังกฤษ' : 'Toggle Thai / English'}
          >
            <Globe className="w-3.5 h-3.5 text-slate-600" />
            <span>{lang === 'th' ? 'ไทย' : 'EN'}</span>
          </button>
        </div>
      </div>

      {/* Render Sidebar Drawer via Portal to document.body so it is truly full height (top to bottom) */}
      {isOpen && typeof document !== 'undefined' ? createPortal(sidebarContent, document.body) : null}
    </header>
  );
};


