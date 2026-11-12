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
  BarChart3,
  LayoutDashboard,
  DatabaseBackup,
  Settings,
  LogOut,
  Clock,
  Globe,
  Sparkles,
} from 'lucide-react';
import { Language, ShiftDoc } from '../types';
import { translations } from '../i18n/translations';
import { OnlineStatusBadge } from './OnlineStatusBadge';
import { signOutOwner } from '../data/db';

export type AppPage =
  | 'pos'
  | 'menu_cost'
  | 'option_groups'
  | 'bills'
  | 'finance'
  | 'reports'
  | 'dashboard'
  | 'backup'
  | 'settings';

interface Props {
  currentPage: AppPage;
  onSelectPage: (page: AppPage) => void;
  lang: Language;
  onToggleLang: () => void;
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

export const Navigation: React.FC<Props> = ({
  currentPage,
  onSelectPage,
  lang,
  onToggleLang,
  userEmail,
  activeShift,
  onOpenShiftModal,
}) => {
  const [isOpen, setIsOpen] = useState(false);
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

  const menuItems: MenuItemDef[] = [
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
      id: 'menu_cost',
      label: t.nav.menuCost,
      desc: {
        th: 'รายการอาหาร วัตถุดิบ และ Food Cost',
        en: 'Dishes, recipes & food costing',
      },
      icon: <UtensilsCrossed className="w-5 h-5 text-red-600" />,
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
      id: 'finance',
      label: t.nav.finance,
      desc: {
        th: 'บันทึกค่าใช้จ่าย กะพนักงาน เงินสดย่อย',
        en: 'Expenses, staff labor & cash float',
      },
      icon: <CircleDollarSign className="w-5 h-5 text-emerald-600" />,
    },
    {
      id: 'reports',
      label: t.nav.reports,
      desc: {
        th: 'รายงานกำไรขาดทุน P&L และยอดขาย',
        en: 'P&L daily summary & top sellers',
      },
      icon: <BarChart3 className="w-5 h-5 text-purple-600" />,
    },
    {
      id: 'dashboard',
      label: t.nav.dashboard,
      desc: {
        th: 'สถิติร้านค้าและภาพรวมตัวชี้วัด',
        en: 'Real-time KPIs & turnover rate',
      },
      icon: <LayoutDashboard className="w-5 h-5 text-indigo-600" />,
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
      id: 'settings',
      label: t.nav.settings,
      desc: {
        th: 'ข้อมูลร้าน ภาษี ค่าบริการ หัวใบเสร็จ',
        en: 'Store profile, VAT & printer setup',
      },
      icon: <Settings className="w-5 h-5 text-neutral-600" />,
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
      <div className="relative w-80 sm:w-88 max-w-[85vw] h-screen h-[100dvh] bg-white shadow-2xl flex flex-col z-10 border-r border-orange-200 animate-in slide-in-from-left duration-200">
        {/* Drawer Header */}
        <div className="p-4 bg-gradient-to-r from-orange-500 via-red-500 to-amber-500 text-white flex items-center justify-between shadow-xs shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-white/20 backdrop-blur-xs flex items-center justify-center font-black text-white text-lg border border-white/30 shadow-xs">
              K
            </div>
            <div className="leading-tight">
              <div className="flex items-center gap-1.5">
                <span className="font-extrabold text-base tracking-tight">KinPOS</span>
                <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded-md bg-white/25 text-white">
                  Pro
                </span>
              </div>
              <p className="text-[11px] text-orange-100 font-medium truncate max-w-[180px]">
                {t.appName}
              </p>
            </div>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            aria-label="Close sidebar menu"
            className="p-1.5 rounded-lg bg-white/10 hover:bg-white/25 text-white cursor-pointer transition-colors active:scale-95"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Menu Navigation Items (Scrollable from top to bottom) */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          <div className="px-2 pt-1 pb-1 text-[11px] font-bold uppercase tracking-wider text-neutral-400">
            {lang === 'th' ? 'เมนูระบบหลัก' : 'Main Modules'}
          </div>

          {menuItems.map((item) => {
            const isActive = currentPage === item.id;
            return (
              <button
                key={item.id}
                onClick={() => {
                  onSelectPage(item.id);
                  setIsOpen(false);
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all cursor-pointer group ${
                  isActive
                    ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-md shadow-orange-500/20 translate-x-1'
                    : 'text-neutral-700 hover:bg-orange-50/90 hover:text-orange-950 border border-transparent hover:border-orange-200'
                }`}
              >
                <div
                  className={`p-2 rounded-lg shrink-0 transition-colors ${
                    isActive ? 'bg-white/20 text-white' : 'bg-neutral-100 group-hover:bg-white'
                  }`}
                >
                  {item.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-sm font-bold truncate">{item.label}</span>
                    {isActive && (
                      <Sparkles className="w-3.5 h-3.5 text-amber-200 animate-pulse shrink-0" />
                    )}
                  </div>
                  <p
                    className={`text-[11px] truncate mt-0.5 ${
                      isActive ? 'text-orange-100' : 'text-neutral-400 group-hover:text-neutral-600'
                    }`}
                  >
                    {item.desc[lang]}
                  </p>
                </div>
              </button>
            );
          })}
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
              title="Toggle Thai / English"
            >
              <Globe className="w-3.5 h-3.5 text-neutral-600" />
              <span>{lang === 'th' ? 'ไทย' : 'EN'}</span>
            </button>
          </div>

          {/* User Email & Sign Out */}
          <div className="text-[11px] text-neutral-500 truncate flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"></span>
            <span className="truncate">
              {t.nav.signedInAs} <strong className="text-neutral-800">{userEmail || 'Owner'}</strong>
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
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-orange-200 shadow-sm">
      <div className="max-w-7xl mx-auto px-3 sm:px-5 py-2.5 flex items-center justify-between gap-2">
        {/* Left: Hamburger & Brand */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setIsOpen(true)}
            aria-label="Open Sidebar Menu"
            title={lang === 'th' ? 'เปิดแถบเมนูด้านซ้าย' : 'Open Left Sidebar Menu'}
            className="p-2 rounded-xl bg-orange-50 hover:bg-orange-100 text-orange-800 border border-orange-300 shadow-xs transition-transform active:scale-95 flex items-center justify-center cursor-pointer"
          >
            <Menu className="w-6 h-6" />
          </button>

          <div
            onClick={() => onSelectPage('pos')}
            className="flex items-center gap-2 cursor-pointer select-none"
          >
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-500 via-red-500 to-amber-500 flex items-center justify-center text-white shadow-md shadow-orange-500/20 font-black text-lg border border-orange-300">
              K
            </div>
            <div className="leading-tight">
              <div className="font-extrabold text-neutral-900 tracking-tight flex items-center gap-1.5">
                <span>KinPOS</span>
                <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-2xs">
                  Pro
                </span>
              </div>
              <div className="text-[10px] text-neutral-500 font-medium truncate max-w-[150px] sm:max-w-xs">
                {t.appName}
              </div>
            </div>
          </div>
        </div>

        {/* Right: Quick actions, Status, Lang Switcher */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Shift Button */}
          <button
            onClick={onOpenShiftModal}
            className={`px-2.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 border transition-all cursor-pointer shadow-xs active:scale-95 ${
              activeShift
                ? 'bg-emerald-50 text-emerald-800 border-emerald-300 hover:bg-emerald-100'
                : 'bg-amber-50 text-amber-900 border-amber-300 hover:bg-amber-100'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">
              {activeShift ? t.nav.shiftActive : t.nav.openShift}
            </span>
          </button>

          {/* Online status indicator */}
          <OnlineStatusBadge lang={lang} />

          {/* Language Switcher */}
          <button
            onClick={onToggleLang}
            className="px-2.5 py-1 rounded-xl bg-neutral-100 hover:bg-neutral-200 text-neutral-800 border border-neutral-300 text-xs font-bold flex items-center gap-1.5 shadow-2xs active:scale-95 transition-all cursor-pointer"
            title="Toggle Thai / English"
          >
            <Globe className="w-3.5 h-3.5 text-neutral-600" />
            <span>{lang === 'th' ? 'ไทย' : 'EN'}</span>
          </button>
        </div>
      </div>

      {/* Render Sidebar Drawer via Portal to document.body so it is truly full height (top to bottom) */}
      {isOpen && typeof document !== 'undefined' ? createPortal(sidebarContent, document.body) : null}
    </header>
  );
};


