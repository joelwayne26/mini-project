import type { HealthStatus, Activity as ActivityType, TrendSignal } from '@/lib/api';

// ─── Format Time ─────────────────────────────────────────────────────────

export const formatTime = (ts: string) => {
  try { return new Date(ts).toLocaleString(); } catch { return ts; }
};

// ─── Mock Data ────────────────────────────────────────────────────────────

export const MOCK_STATS = {
  total_templates: 45230,
  total_posts: 88745,
  ground_truth_count: 12480,
  model: { latest_auc: 0.8742, version: 'v6.0.0', samples: 12480, trained_at: '2026-05-15T18:30:00Z' },
};

export const MOCK_HEALTH: HealthStatus = {
  status: 'healthy',
  version: '6.0.0',
  timestamp: new Date().toISOString(),
  database: 'connected',
  app_name: 'TrendLens AI',
};

export const MOCK_TRENDS: TrendSignal[] = [
  { keyword: 'rolex uganda', source: 'Google Trends', score: 0.94, volume: 12500, growth_rate: 0.23, category: 'restaurant', country: 'UG', fetched_at: new Date().toISOString(), metadata: {} },
  { keyword: 'wedding cake kampala', source: 'Instagram', score: 0.89, volume: 8900, growth_rate: 0.18, category: 'cake', country: 'UG', fetched_at: new Date().toISOString(), metadata: {} },
  { keyword: 'muchomo recipe', source: 'Google Trends', score: 0.85, volume: 7200, growth_rate: 0.15, category: 'restaurant', country: 'UG', fetched_at: new Date().toISOString(), metadata: {} },
  { keyword: 'chapati business', source: 'Reddit', score: 0.81, volume: 5600, growth_rate: 0.12, category: 'bakery', country: 'UG', fetched_at: new Date().toISOString(), metadata: {} },
  { keyword: 'mandazi uganda', source: 'YouTube', score: 0.78, volume: 4300, growth_rate: 0.09, category: 'bakery', country: 'UG', fetched_at: new Date().toISOString(), metadata: {} },
  { keyword: 'luwombo recipe', source: 'Google Trends', score: 0.75, volume: 3800, growth_rate: 0.07, category: 'restaurant', country: 'UG', fetched_at: new Date().toISOString(), metadata: {} },
];

export const MOCK_ACTIVITIES: ActivityType[] = [
  { _id: '1', event_type: 'auto_retrain', message: 'Auto-retrain triggered by drift detection (MMD=0.342)', metadata: {}, timestamp: new Date(Date.now() - 1800000).toISOString() },
  { _id: '2', event_type: 'data_transformation', message: 'Data transformation completed: 1,250 templates, 3,400 posts processed', metadata: {}, timestamp: new Date(Date.now() - 3600000).toISOString() },
  { _id: '3', event_type: 'watcher_check', message: 'Watcher detected 847 new untransformed documents', metadata: {}, timestamp: new Date(Date.now() - 7200000).toISOString() },
  { _id: '4', event_type: 'model_deployed', message: 'Model v6.0.0 deployed with AUC=0.8742 (5-fold CV)', metadata: {}, timestamp: new Date(Date.now() - 14400000).toISOString() },
  { _id: '5', event_type: 'drift_detected', message: 'Significant drift detected (p=0.012), MMD=0.342', metadata: {}, timestamp: new Date(Date.now() - 21600000).toISOString() },
];
