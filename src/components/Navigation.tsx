import React, { useState } from 'react';
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

  const menuItems: { id: AppPage; label: string; icon: React.ReactNode; badge?: string }[] = [
    { id: 'pos', label: t.nav.tablesPos, icon: <LayoutGrid className="w-5 h-5 text-orange-600" /> },
    { id: 'menu_cost', label: t.nav.menuCost, icon: <UtensilsCrossed className="w-5 h-5 text-red-600" /> },
    { id: 'option_groups', label: t.nav.optionGroups, icon: <Sliders className="w-5 h-5 text-amber-600" /> },
    { id: 'bills', label: t.nav.billsHistory, icon: <Receipt className="w-5 h-5 text-orange-600" /> },
    { id: 'finance', label: t.nav.finance, icon: <CircleDollarSign className="w-5 h-5 text-emerald-600" /> },
    { id: 'reports', label: t.nav.reports, icon: <BarChart3 className="w-5 h-5 text-red-600" /> },
    { id: 'dashboard', label: t.nav.dashboard, icon: <LayoutDashboard className="w-5 h-5 text-amber-600" /> },
    { id: 'backup', label: t.nav.backup, icon: <DatabaseBackup className="w-5 h-5 text-blue-600" /> },
    { id: 'settings', label: t.nav.settings, icon: <Settings className="w-5 h-5 text-neutral-600" /> },
  ];

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-orange-200 shadow-sm">
      <div className="max-w-7xl mx-auto px-3 sm:px-5 py-2.5 flex items-center justify-between gap-2">
        {/* Left: Hamburger & Brand */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setIsOpen(true)}
            aria-label="Open Menu"
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

      {/* Hamburger Drawer Overlay */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-neutral-950/40 backdrop-blur-xs transition-opacity"
            onClick={() => setIsOpen(false)}
          />

          {/* Side Drawer */}
          <div className="relative w-80 max-w-[85vw] h-full bg-white shadow-2xl flex flex-col z-10 border-r border-orange-200">
            {/* Drawer Header */}
            <div className="p-4 bg-gradient-to-r from-orange-500 via-red-500 to-amber-500 text-white flex items-center justify-between shadow-xs">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-white/20 backdrop-blur-xs flex items-center justify-center font-black text-white text-base border border-white/30">
                  K
                </div>
                <div>
                  <h3 className="font-extrabold text-base leading-tight">KinPOS</h3>
                  <p className="text-[11px] text-orange-100">{t.tagline}</p>
                </div>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white cursor-pointer transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Menu List */}
            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              {menuItems.map((item) => {
                const isActive = currentPage === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      onSelectPage(item.id);
                      setIsOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-3.5 py-3 rounded-xl text-sm font-semibold transition-all cursor-pointer ${
                      isActive
                        ? 'bg-gradient-to-r from-orange-500 to-red-500 text-white shadow-md shadow-orange-500/20 translate-x-1'
                        : 'text-neutral-700 hover:bg-orange-50/80 hover:text-orange-900'
                    }`}
                  >
                    <div
                      className={`p-1.5 rounded-lg ${
                        isActive ? 'bg-white/20 text-white' : 'bg-neutral-100'
                      }`}
                    >
                      {item.icon}
                    </div>
                    <span className="flex-1 text-left">{item.label}</span>
                    {isActive && <Sparkles className="w-4 h-4 text-amber-200 animate-pulse" />}
                  </button>
                );
              })}
            </div>

            {/* Drawer Footer with Owner Profile and Sign Out */}
            <div className="p-3.5 border-t border-neutral-200 bg-neutral-50/80">
              <div className="text-xs text-neutral-500 mb-2 truncate">
                {t.nav.signedInAs} <strong className="text-neutral-800">{userEmail || 'Owner'}</strong>
              </div>
              <button
                onClick={async () => {
                  setIsOpen(false);
                  await signOutOwner();
                }}
                className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 text-xs font-bold cursor-pointer transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span>{t.nav.signOut}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};
