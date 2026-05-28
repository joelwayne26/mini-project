// TrendLens AI v6.0 - Model AUC Chart Component

'use client';

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Area, AreaChart } from 'recharts';
import type { ModelRegistry } from '@/lib/types';

interface ModelAucChartProps {
  models: ModelRegistry[];
}

export function ModelAucChart({ models }: ModelAucChartProps) {
  if (!models || models.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
        No model data available
      </div>
    );
  }

  const chartData = [...models]
    .sort((a, b) => new Date(a.trainedAt).getTime() - new Date(b.trainedAt).getTime())
    .map(m => ({
      version: m.version,
      auc: m.aucScore,
      accuracy: m.accuracy,
      trainedAt: new Date(m.trainedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      datasetSize: m.datasetSize,
    }));

  return (
    <div className="w-full">
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={chartData} margin={{ left: 10, right: 20, top: 10, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis dataKey="version" fontSize={11} />
          <YAxis
            domain={[0.5, 1.0]}
            fontSize={11}
            tickFormatter={(v: number) => `${(v * 100).toFixed(0)}%`}
          />
          <Tooltip
            formatter={(value: number, name: string) => {
              const label = name === 'auc' ? 'AUC' : 'Accuracy';
              return [`${(value * 100).toFixed(1)}%`, label];
            }}
            contentStyle={{ fontSize: '12px' }}
          />
          <Area
            type="monotone"
            dataKey="auc"
            stroke="#10b981"
            fill="#10b981"
            fillOpacity={0.1}
            strokeWidth={2}
            name="auc"
          />
          <Area
            type="monotone"
            dataKey="accuracy"
            stroke="#f59e0b"
            fill="#f59e0b"
            fillOpacity={0.1}
            strokeWidth={2}
            name="accuracy"
          />
        </AreaChart>
      </ResponsiveContainer>
      <div className="flex items-center justify-center gap-4 mt-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="w-3 h-1 bg-emerald-500 inline-block rounded" /> AUC Score
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-1 bg-yellow-500 inline-block rounded" /> Accuracy
        </span>
      </div>
    </div>
  );
}
