import React from 'react';
import { AlertCircle, AlertTriangle, Lightbulb, Info, ArrowUpRight } from 'lucide-react';
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
  const getBadge = (type: WhatShouldIDoAdvice['type']) => {
    switch (type) {
      case 'CRITICAL':
        return (
          <span className="inline-flex items-center gap-1 rounded-md bg-[#EF4444]/10 px-2 py-0.5 text-xs font-bold text-[#EF4444] border border-[#EF4444]/20 font-mono">
            <AlertCircle className="h-3.5 w-3.5" />
            {activeLanguage === 'th' ? 'ต้องแก้ไขด่วน' : 'CRITICAL ACTION'}
          </span>
        );
      case 'WARNING':
        return (
          <span className="inline-flex items-center gap-1 rounded-md bg-[#F59E0B]/10 px-2 py-0.5 text-xs font-bold text-[#F59E0B] border border-[#F59E0B]/20 font-mono">
            <AlertTriangle className="h-3.5 w-3.5" />
            {activeLanguage === 'th' ? 'ควรเฝ้าระวัง' : 'WARNING'}
          </span>
        );
      case 'OPPORTUNITY':
        return (
          <span className="inline-flex items-center gap-1 rounded-md bg-[#10B981]/10 px-2 py-0.5 text-xs font-bold text-[#10B981] border border-[#10B981]/20 font-mono">
            <Lightbulb className="h-3.5 w-3.5" />
            {activeLanguage === 'th' ? 'โอกาสเพิ่มกำไร' : 'OPPORTUNITY'}
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded-md bg-[#00B1FF]/10 px-2 py-0.5 text-xs font-bold text-[#00B1FF] border border-[#00B1FF]/20 font-mono">
            <Info className="h-3.5 w-3.5" />
            {activeLanguage === 'th' ? 'ข้อมูลแนะนำ' : 'INSIGHT'}
          </span>
        );
    }
  };

  const getBorderColor = (type: WhatShouldIDoAdvice['type']) => {
    switch (type) {
      case 'CRITICAL': return 'border-l-4 border-l-[#EF4444]';
      case 'WARNING': return 'border-l-4 border-l-[#F59E0B]';
      case 'OPPORTUNITY': return 'border-l-4 border-l-[#10B981]';
      default: return 'border-l-4 border-l-white/20';
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xs font-bold uppercase tracking-widest text-white/60 flex items-center gap-2">
            <span>⚡ {activeLanguage === 'th' ? 'วันนี้ฉันควรทำอะไร? (WHAT SHOULD I DO?)' : 'Cost Impact Alerts & Insights'}</span>
            <span className="text-[10px] font-mono text-white/40 bg-white/5 border border-white/10 px-2 py-0.5 rounded-full">
              {safeAdvices.length} {activeLanguage === 'th' ? 'รายการคำนวณจริง' : 'action items'}
            </span>
          </h2>
          <p className="text-xs text-white/40 mt-0.5">
            {activeLanguage === 'th'
              ? 'ระบบประมวลผลจากต้นทุนวัตถุดิบล่าสุด ยอดขาย และค่าธรรมเนียมจริง (ไม่ใช่ข้อความสุ่ม)'
              : 'Computed dynamically from current ingredient costs, sales volumes, and platform GP.'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {safeAdvices.map((advice) => (
          <div
            key={advice.id}
            className={`rounded-xl border border-white/5 bg-[#151518] p-4 flex flex-col justify-between hover:border-white/15 transition-all ${getBorderColor(advice.type)}`}
          >
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                {getBadge(advice.type)}
                <span className="text-[10px] font-mono text-white/40 uppercase tracking-wider">
                  {advice.category}
                </span>
              </div>

              <h3 className="text-sm font-semibold text-white">
                {activeLanguage === 'th' ? advice.titleTh : advice.titleEn}
              </h3>

              <p className="text-xs text-white/50 leading-relaxed font-sans">
                {activeLanguage === 'th' ? advice.descriptionTh : advice.descriptionEn}
              </p>
            </div>

            <div className="mt-4 pt-3 border-t border-white/5 flex items-center justify-between gap-2">
              <div className="bg-white/5 rounded-lg px-2.5 py-1 text-xs border border-white/5">
                <span className="text-white/40 text-[11px] mr-1.5">{advice.metricLabel}:</span>
                <span className="font-mono font-bold text-white">{advice.metricValue}</span>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (advice.relatedEntityType === 'ingredient') onNavigate('ingredients');
                  else if (advice.relatedEntityType === 'menu') onNavigate('menu_costing');
                  else if (advice.relatedEntityType === 'channel') onNavigate('sales_channels');
                  else onNavigate('scenario_calculator');
                }}
                className="inline-flex items-center gap-1 text-xs font-semibold text-[#FF6321] hover:text-[#FF6321]/80 cursor-pointer"
              >
                <span>{activeLanguage === 'th' ? 'ไปที่หน้านี้' : 'View Action'}</span>
                <ArrowUpRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
