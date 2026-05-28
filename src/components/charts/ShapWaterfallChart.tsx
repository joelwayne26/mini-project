/**
 * TrendLens AI v6.0 — SHAP Waterfall Chart
 */

'use client';

import { ShapValue } from '@/lib/types';

interface ShapWaterfallChartProps {
  shapValues: ShapValue[];
  baseScore?: number;
}

export function ShapWaterfallChart({ shapValues, baseScore = 40 }: ShapWaterfallChartProps) {
  if (!shapValues || shapValues.length === 0) return null;

  const maxContribution = Math.max(...shapValues.map(s => Math.abs(s.contribution)), 1);
  const sortedValues = [...shapValues].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution));

  return (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold text-muted-foreground">Feature Contributions (SHAP)</h4>
      <div className="space-y-1.5">
        {sortedValues.slice(0, 10).map((sv, idx) => {
          const widthPercent = (Math.abs(sv.contribution) / maxContribution) * 100;
          const isPositive = sv.contribution > 0;
          return (
            <div key={idx} className="flex items-center gap-2 text-sm">
              <span className="w-28 text-right text-xs text-muted-foreground truncate" title={sv.feature}>
                {sv.feature}
              </span>
              <div className="flex-1 flex items-center">
                <div className="w-full bg-muted/30 rounded-full h-5 relative overflow-hidden">
                  {isPositive ? (
                    <div
                      className="h-full bg-emerald-400/70 rounded-full flex items-center pl-2"
                      style={{ width: `${Math.max(widthPercent, 5)}%` }}
                    >
                      <span className="text-[10px] font-medium text-emerald-900 whitespace-nowrap">
                        +{sv.contribution.toFixed(1)}
                      </span>
                    </div>
                  ) : (
                    <div
                      className="h-full bg-red-400/70 rounded-full flex items-center pl-2"
                      style={{ width: `${Math.max(widthPercent, 5)}%` }}
                    >
                      <span className="text-[10px] font-medium text-red-900 whitespace-nowrap">
                        {sv.contribution.toFixed(1)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
              <span className="w-12 text-xs text-muted-foreground text-right">
                {sv.value.toFixed(2)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-4 text-[10px] text-muted-foreground pt-1">
        <span className="flex items-center gap-1">
          <span className="w-3 h-2 bg-emerald-400/70 rounded-sm inline-block" /> Increases score
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-2 bg-red-400/70 rounded-sm inline-block" /> Decreases score
        </span>
      </div>
    </div>
  );
}
