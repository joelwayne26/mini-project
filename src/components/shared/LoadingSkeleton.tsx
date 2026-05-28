// TrendLens AI v6.0 - Loading Skeleton Component

'use client';

import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

interface LoadingSkeletonProps {
  type?: 'card' | 'chart' | 'table' | 'list';
  count?: number;
  className?: string;
}

export function LoadingSkeleton({ type = 'card', count = 1, className }: LoadingSkeletonProps) {
  const skeletons = Array.from({ length: count }, (_, i) => {
    switch (type) {
      case 'card':
        return (
          <div key={i} className={cn('p-6 rounded-lg border bg-card', className)}>
            <Skeleton className="h-4 w-1/3 mb-3" />
            <Skeleton className="h-8 w-1/2 mb-2" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        );
      case 'chart':
        return (
          <div key={i} className={cn('p-6 rounded-lg border bg-card', className)}>
            <Skeleton className="h-4 w-1/4 mb-4" />
            <div className="flex items-end gap-2 h-48">
              {[0.3, 0.5, 0.8, 0.6, 0.4, 0.7, 0.9, 0.5, 0.3, 0.6].map((h, j) => (
                <Skeleton key={j} className="flex-1" style={{ height: `${h * 100}%` }} />
              ))}
            </div>
          </div>
        );
      case 'table':
        return (
          <div key={i} className={cn('p-6 rounded-lg border bg-card', className)}>
            <div className="flex gap-4 mb-4">
              <Skeleton className="h-4 w-1/5" />
              <Skeleton className="h-4 w-1/5" />
              <Skeleton className="h-4 w-1/5" />
              <Skeleton className="h-4 w-1/5" />
            </div>
            {Array.from({ length: 5 }, (_, j) => (
              <div key={j} className="flex gap-4 mb-3">
                <Skeleton className="h-3 w-1/5" />
                <Skeleton className="h-3 w-1/5" />
                <Skeleton className="h-3 w-1/5" />
                <Skeleton className="h-3 w-1/5" />
              </div>
            ))}
          </div>
        );
      case 'list':
        return (
          <div key={i} className={cn('space-y-3', className)}>
            {Array.from({ length: 5 }, (_, j) => (
              <div key={j} className="flex items-center gap-3">
                <Skeleton className="h-8 w-8 rounded-full" />
                <div className="flex-1">
                  <Skeleton className="h-3 w-3/4 mb-1" />
                  <Skeleton className="h-2 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        );
      default:
        return <Skeleton key={i} className="h-20 w-full" />;
    }
  });

  return <>{skeletons}</>;
}
