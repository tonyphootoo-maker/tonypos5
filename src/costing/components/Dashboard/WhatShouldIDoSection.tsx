import React from 'react';
import { AlertCircle, AlertTriangle, Lightbulb, Info, ArrowUpRight, Sparkles } from 'lucide-react';
import { WhatShouldIDoAdvice } from '../../types/domain';

interface WhatShouldIDoSectionProps {
  advices?: WhatShouldIDoAdvice[];
  activeLanguage: 'th' | 'en';
  onNavigate: (view: string) => void;
}

export const WhatShouldIDoSection: React.FC<WhatShouldIDoSectionProps> = ({
  advices = [],
  activeLanguage,
  onNavigate,
}) => {
  const safeAdvices = advices || [];

  const getStatusIndicator = (type: WhatShouldIDoAdvice['type']) => {
    switch (type) {
      case 'CRITICAL':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-700">
            <AlertCircle className="h-3.5 w-3.5 text-rose-600 shrink-0" />
            <span>{activeLanguage === 'th' ? 'ต้องแก้ไขด่วน' : 'Critical Action'}</span>
          </span>
        );
      case 'WARNING':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
            <span>{activeLanguage === 'th' ? 'ควรเฝ้าระวัง' : 'Warning'}</span>
          </span>
        );
      case 'OPPORTUNITY':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
            <Lightbulb className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
            <span>{activeLanguage === 'th' ? 'โอกาสเพิ่มกำไร' : 'Opportunity'}</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-700">
            <Info className="h-3.5 w-3.5 text-sky-600 shrink-0" />
            <span>{activeLanguage === 'th' ? 'ข้อมูลแนะนำ' : 'Insight'}</span>
          </span>
        );
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2 px-1">
        <div className="flex items-center gap-2 text-slate-900">
          <Sparkles className="h-4 w-4 text-orange-600 shrink-0" />
          <h2 className="text-base font-bold tracking-tight">
            {activeLanguage === 'th'
              ? 'คำแนะนำเชิงธุรกิจอัตโนมัติ (What Should I Do?)'
              : 'Automated Cost & Profit Insights'}
          </h2>
        </div>

        <span className="text-xs font-semibold text-slate-500 tabular-nums shrink-0">
          {safeAdvices.length}{' '}
          {activeLanguage === 'th' ? 'รายการวิเคราะห์ล่าสุด' : 'active insights'}
        </span>
      </div>

      {safeAdvices.length === 0 ? (
        <div className="rounded-2xl bg-white/65 backdrop-blur-xl border border-white/85 p-6 text-center text-xs text-slate-500 shadow-[0_8px_24px_-8px_rgba(15,23,42,0.05),inset_0_1px_0_rgba(255,255,255,0.95)]">
          {activeLanguage === 'th'
            ? 'ยังไม่มีคำแนะนำเร่งด่วน ตัวเลขต้นทุนและยอดขายอยู่ในเกณฑ์ปกติ'
            : 'No urgent cost anomalies detected across your current menus and sales.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {safeAdvices.map((advice) => (
            <article
              key={advice.id}
              className="rounded-2xl bg-white/68 backdrop-blur-xl border border-white/85 p-5 flex flex-col justify-between shadow-[0_8px_24px_-8px_rgba(15,23,42,0.06),inset_0_1px_0_rgba(255,255,255,0.95)] hover:bg-white/84 transition-all duration-200"
            >
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  {getStatusIndicator(advice.type)}
                  <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">
                    {advice.category}
                  </span>
                </div>

                <h3 className="text-sm font-bold text-slate-900 leading-snug">
                  {activeLanguage === 'th' ? advice.titleTh : advice.titleEn}
                </h3>

                <p className="text-xs text-slate-600 leading-relaxed">
                  {activeLanguage === 'th' ? advice.descriptionTh : advice.descriptionEn}
                </p>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-200/60 flex items-center justify-between gap-3">
                <div className="flex items-baseline gap-1.5 text-xs">
                  <span className="text-slate-500">{advice.metricLabel}:</span>
                  <span className="font-bold text-slate-900 tabular-nums">
                    {advice.metricValue}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    if (advice.relatedEntityType === 'ingredient') onNavigate('ingredients');
                    else if (advice.relatedEntityType === 'menu') onNavigate('menu_costing');
                    else if (advice.relatedEntityType === 'channel') onNavigate('sales_channels');
                    else onNavigate('scenario_calculator');
                  }}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-orange-600 hover:text-orange-700 cursor-pointer transition-colors shrink-0"
                >
                  <span>{activeLanguage === 'th' ? 'จัดการหน้านี้' : 'View Action'}</span>
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
};

