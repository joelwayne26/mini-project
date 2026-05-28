// TrendLens AI v6.0 - Trend Chart Component

'use client';

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid } from 'recharts';
import type { TrendSnapshot } from '@/lib/types';

interface TrendChartProps {
  trends: TrendSnapshot[];
}

export function TrendChart({ trends }: TrendChartProps) {
  if (!trends || trends.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
        No trend data available
      </div>
    );
  }

  const chartData = trends
    .sort((a, b) => b.velocity - a.velocity)
    .map(t => ({
      name: t.term.replace('#', ''),
      velocity: Math.round(t.velocity * 100),
      volume: t.volume,
      sentiment: Math.round(t.sentiment * 100),
      fill: t.velocity > 0.7 ? '#10b981' : t.velocity > 0.5 ? '#f59e0b' : '#6b7280',
    }));

  return (
    <div className="w-full">
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={chartData} margin={{ left: 10, right: 20, top: 10, bottom: 60 }}>
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis
            dataKey="name"
            fontSize={10}
            angle={-45}
            textAnchor="end"
            height={70}
          />
          <YAxis
            fontSize={11}
            tickFormatter={(v: number) => `${v}%`}
            domain={[0, 100]}
          />
          <Tooltip
            formatter={(value: number, name: string) => {
              if (name === 'velocity') return [`${value}%`, 'Velocity'];
              if (name === 'volume') return [value.toLocaleString(), 'Volume'];
              return [value, name];
            }}
            contentStyle={{ fontSize: '12px' }}
          />
          <Bar dataKey="velocity" name="Velocity" radius={[4, 4, 0, 0]} maxBarSize={35}>
            {chartData.map((entry, index) => (
              <Cell key={index} fill={entry.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="flex items-center justify-center gap-4 mt-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm bg-emerald-500 inline-block" /> Surging (&gt;70%)
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm bg-yellow-500 inline-block" /> Rising (50-70%)
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm bg-gray-500 inline-block" /> Stable (&lt;50%)
        </span>
      </div>
    </div>
  );
}
