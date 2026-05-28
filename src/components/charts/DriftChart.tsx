// TrendLens AI v6.0 - Drift Chart Component

'use client';

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine, Legend } from 'recharts';
import type { DriftMeasurement } from '@/lib/types';

interface DriftChartProps {
  measurements: DriftMeasurement[];
  threshold?: number;
}

const FEATURE_LABELS: Record<string, string> = {
  hashtag_relevance: 'Hashtags',
  cta_strength: 'CTA',
  image_quality_score: 'Image',
  trend_alignment_score: 'Trends',
  caption_readability: 'Caption',
  engagement_prediction: 'Engagement',
  posting_time_score: 'Time',
  audience_fit_score: 'Audience',
  visual_appeal_score: 'Visual',
  sentiment_score: 'Sentiment',
};

export function DriftChart({ measurements, threshold = 0.05 }: DriftChartProps) {
  if (!measurements || measurements.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
        No drift measurements available
      </div>
    );
  }

  const chartData = measurements.map(m => ({
    name: FEATURE_LABELS[m.feature] || m.feature,
    mmdValue: m.mmdValue,
    pValue: m.pValue,
    isDrift: m.isDrift,
    fill: m.isDrift ? '#ef4444' : '#10b981',
  }));

  return (
    <div className="w-full">
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData} margin={{ left: 10, right: 20, top: 10, bottom: 40 }}>
          <XAxis
            dataKey="name"
            fontSize={10}
            angle={-35}
            textAnchor="end"
            height={60}
          />
          <YAxis
            fontSize={11}
            tickFormatter={(v: number) => v.toFixed(2)}
            label={{ value: 'MMD', angle: -90, position: 'insideLeft', fontSize: 11 }}
          />
          <Tooltip
            formatter={(value: number, name: string) => {
              if (name === 'mmdValue') return [value.toFixed(4), 'MMD Value'];
              return [value, name];
            }}
            contentStyle={{ fontSize: '12px' }}
          />
          <ReferenceLine
            y={threshold}
            stroke="#f59e0b"
            strokeDasharray="5 5"
            label={{ value: `Threshold (${threshold})`, fontSize: 10, fill: '#f59e0b' }}
          />
          <Bar dataKey="mmdValue" name="MMD Value" radius={[4, 4, 0, 0]} maxBarSize={40}>
            {chartData.map((entry, index) => (
              <Cell key={index} fill={entry.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="flex items-center justify-center gap-4 mt-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm bg-emerald-500 inline-block" /> No drift
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm bg-red-500 inline-block" /> Drift detected
        </span>
        <span className="flex items-center gap-1">
          <span className="w-8 border-t-2 border-dashed border-yellow-500 inline-block" /> Threshold
        </span>
      </div>
    </div>
  );
}
