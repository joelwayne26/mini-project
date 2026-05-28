// TrendLens AI v6.0 - Feature Badge Component

'use client';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface FeatureBadgeProps {
  feature: string;
  value: number;
  contribution: 'positive' | 'negative' | 'neutral';
  className?: string;
}

const FEATURE_LABELS: Record<string, string> = {
  hashtag_relevance: 'Hashtags',
  cta_presence: 'CTA',
  image_quality: 'Image',
  trend_alignment: 'Trends',
  engagement_prediction: 'Engagement',
  caption_quality: 'Caption',
  posting_time: 'Time',
  audience_fit: 'Audience',
  visual_appeal: 'Visual',
};

export function FeatureBadge({ feature, value, contribution, className }: FeatureBadgeProps) {
  const label = FEATURE_LABELS[feature] || feature;
  const colors = {
    positive: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800',
    negative: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800',
    neutral: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400 border-gray-200 dark:border-gray-700',
  };

  return (
    <Badge
      variant="outline"
      className={cn('text-xs', colors[contribution], className)}
    >
      {label}: {Math.round(value * 100)}%
    </Badge>
  );
}
