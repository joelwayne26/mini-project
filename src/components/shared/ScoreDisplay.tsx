/**
 * TrendLens AI v6.0 — Score Display Component
 */

'use client';

import { cn } from '@/lib/utils';

interface ScoreDisplayProps {
  score: number;
  label: string;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
}

export function ScoreDisplay({ score, label, size = 'md', showLabel = true }: ScoreDisplayProps) {
  const getColor = (s: number) => {
    if (s >= 8) return 'text-emerald-600';
    if (s >= 6) return 'text-amber-600';
    if (s >= 4) return 'text-orange-600';
    return 'text-red-600';
  };

  const getBgColor = (s: number) => {
    if (s >= 8) return 'bg-emerald-50 border-emerald-200';
    if (s >= 6) return 'bg-amber-50 border-amber-200';
    if (s >= 4) return 'bg-orange-50 border-orange-200';
    return 'bg-red-50 border-red-200';
  };

  const sizeClass = size === 'lg' ? 'text-4xl' : size === 'md' ? 'text-2xl' : 'text-xl';

  return (
    <div className={cn('flex flex-col items-center gap-1 p-3 rounded-xl border', getBgColor(score))}>
      <span className={cn('font-bold', sizeClass, getColor(score))}>
        {score.toFixed(1)}
      </span>
      {showLabel && <span className="text-xs text-muted-foreground font-medium">{label}</span>}
    </div>
  );
}
