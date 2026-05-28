/**
 * TrendLens AI — API Client
 * All API calls go to the backend at the configured URL.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface FetchOptions extends RequestInit {
  params?: Record<string, string | number | boolean>;
}

async function apiFetch<T>(endpoint: string, options: FetchOptions = {}): Promise<T> {
  const { params, ...fetchOptions } = options;

  let url = `${API_BASE}${endpoint}`;
  if (params) {
    const searchParams = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      searchParams.append(key, String(value));
    });
    url += `?${searchParams.toString()}`;
  }

  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...fetchOptions.headers,
    },
    ...fetchOptions,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(error.detail || `API Error: ${response.status}`);
  }

  return response.json();
}

// ─── Health ────────────────────────────────────────────────────────────────

export interface HealthStatus {
  status: string;
  version: string;
  timestamp: string;
  database: string;
  app_name: string;
}

export const getHealth = () => apiFetch<HealthStatus>('/health');

// ─── Stats ─────────────────────────────────────────────────────────────────

export interface ModelInfo {
  latest_auc: number;
  version: string;
  samples: number;
  trained_at: string;
}

export interface QuickStats {
  total_templates: number;
  total_posts: number;
  ground_truth_count: number;
  model: ModelInfo;
}

export const getStats = () => apiFetch<QuickStats>('/stats');

// ─── Activity ──────────────────────────────────────────────────────────────

export interface Activity {
  _id: string;
  event_type: string;
  message: string;
  metadata: Record<string, unknown>;
  timestamp: string;
}

export interface ActivityResponse {
  count: number;
  activities: Activity[];
}

export const getActivity = (limit = 20) =>
  apiFetch<ActivityResponse>('/activity', { params: { limit } });

// ─── Trends ────────────────────────────────────────────────────────────────

export interface TrendSignal {
  keyword: string;
  source: string;
  score: number;
  volume: number;
  growth_rate: number;
  category: string;
  country: string;
  fetched_at: string;
  metadata: Record<string, unknown>;
}

export interface TrendsResponse {
  category: string;
  count: number;
  trends: TrendSignal[];
  fetched_at: string;
}

export const getTrends = (category = 'general', limit = 20) =>
  apiFetch<TrendsResponse>('/trends/current', { params: { category, limit } });

// ─── Pipeline ──────────────────────────────────────────────────────────────

export interface TransformResult {
  status: string;
  templates_transformed: number;
  posts_transformed: number;
  ground_truth_created: number;
  [key: string]: unknown;
}

export const runTransform = (nClusters = 8, engagementThreshold = 0.04) =>
  apiFetch<TransformResult>('/pipeline/transform', {
    method: 'POST',
    params: { n_clusters: nClusters, engagement_threshold: engagementThreshold },
  });

export interface TransformStatus {
  status: string;
  last_run: string | null;
  result: TransformResult | null;
}

export const getTransformStatus = () =>
  apiFetch<TransformStatus>('/pipeline/transform/status');

export interface FieldMap {
  collection: string;
  mappings: Record<string, string>;
}

export interface FieldMapResponse {
  collections: FieldMap[];
}

export const getFieldMap = () =>
  apiFetch<FieldMapResponse>('/pipeline/transform/field-map');

export interface RetrainTriggers {
  drift_trigger: boolean;
  volume_trigger: boolean;
  schedule_trigger: boolean;
  needs_retrain: boolean;
  reason: string;
  [key: string]: unknown;
}

export const checkTriggers = () => apiFetch<RetrainTriggers>('/pipeline/retrain/triggers');

export interface RetrainResult {
  status: string;
  auc: number;
  fold_aucs: number[];
  samples: number;
  drift: Record<string, unknown>;
  ablation: Record<string, unknown>;
  should_deploy: boolean;
  trained_at: string;
}

export const runRetrain = (force = false) =>
  apiFetch<RetrainResult>('/pipeline/retrain/run', {
    method: 'POST',
    params: { force },
  });

export interface RetrainHistoryItem {
  _id: string;
  version: string;
  auc: number;
  samples: number;
  auto_retrained: boolean;
  trained_at: string;
}

export interface RetrainHistoryResponse {
  count: number;
  history: RetrainHistoryItem[];
}

export const getRetrainHistory = (limit = 20) =>
  apiFetch<RetrainHistoryResponse>('/pipeline/retrain/history', { params: { limit } });

export interface FullPipelineResult {
  transformation: TransformResult;
  retraining: RetrainResult | null;
  timestamp: string;
}

export const runFullPipeline = (nClusters = 8, engagementThreshold = 0.04, forceRetrain = false) =>
  apiFetch<FullPipelineResult>('/pipeline/full', {
    method: 'POST',
    params: {
      n_clusters: nClusters,
      engagement_threshold: engagementThreshold,
      force_retrain: forceRetrain,
    },
  });

// ─── Drift ─────────────────────────────────────────────────────────────────

export interface DriftMeasurement {
  _id: string;
  type: string;
  mmd_statistic: number;
  p_value: number;
  is_drift: boolean;
  new_sample_count: number;
  created_at: string;
}

export interface DriftMeasurementsResponse {
  count: number;
  measurements: DriftMeasurement[];
}

export const getDriftMeasurements = (limit = 20) =>
  apiFetch<DriftMeasurementsResponse>('/pipeline/drift/measurements', { params: { limit } });

export const getDriftMeasurementsDirect = (limit = 20) =>
  apiFetch<DriftMeasurementsResponse>('/drift/measurements', { params: { limit } });

export interface DriftBaseline {
  baseline_samples: number;
  baseline_mean: number;
  baseline_std: number;
  last_updated: string;
}

export const getDriftBaseline = () =>
  apiFetch<DriftBaseline>('/pipeline/drift/baseline');

// ─── Watcher ───────────────────────────────────────────────────────────────

export interface WatcherCheckResult {
  has_new_data: boolean;
  new_template_count: number;
  new_post_count: number;
  should_transform: boolean;
  [key: string]: unknown;
}

export const checkWatcher = () =>
  apiFetch<WatcherCheckResult>('/pipeline/watcher/check');

export const triggerWatcher = () =>
  apiFetch<{ status: string; result: Record<string, unknown> }>('/pipeline/watcher/trigger', {
    method: 'POST',
  });

export const startWatcher = () =>
  apiFetch<{ status: string; message: string }>('/pipeline/watcher/start', {
    method: 'POST',
  });

export const stopWatcher = () =>
  apiFetch<{ status: string; message: string }>('/pipeline/watcher/stop', {
    method: 'POST',
  });

export interface WatcherStatus {
  is_running: boolean;
  started_at: string | null;
  checks_performed: number;
  last_check: string | null;
}

export const getWatcherStatus = () =>
  apiFetch<WatcherStatus>('/pipeline/watcher/status');

// ─── Worker ────────────────────────────────────────────────────────────────

export const startWorker = () =>
  apiFetch<{ status: string; message: string }>('/pipeline/worker/start', {
    method: 'POST',
  });

export const stopWorker = () =>
  apiFetch<{ status: string; message: string }>('/pipeline/worker/stop', {
    method: 'POST',
  });

export interface WorkerStatus {
  is_running: boolean;
  started_at: string | null;
  retrain_count: number;
  last_retrain: string | null;
}

export const getWorkerStatus = () =>
  apiFetch<WorkerStatus>('/pipeline/worker/status');

// ─── Simulation ────────────────────────────────────────────────────────────

export interface SimulationResult {
  report: string;
  iterations: number;
}

export const runSimulation = (
  iterations = 2,
  templates = 100,
  posts = 150,
  injectDrift = true,
  clear = false,
) =>
  apiFetch<SimulationResult>('/pipeline/simulate', {
    method: 'POST',
    params: {
      iterations,
      templates,
      posts,
      inject_drift: injectDrift,
      clear,
    },
  });

// ─── Model History ─────────────────────────────────────────────────────────

export interface ModelVersion {
  _id: string;
  model_type: string;
  version: string;
  path: string;
  auc: number;
  samples: number;
  features: string[];
  trained_at: string;
  auto_retrained?: boolean;
  fold_aucs?: number[];
  drift_detected?: boolean;
  mmd_statistic?: number;
}

export interface ModelHistoryResponse {
  count: number;
  versions: ModelVersion[];
}

export const getModelHistory = (limit = 20) =>
  apiFetch<ModelHistoryResponse>('/models/history', { params: { limit } });

// ─── Benchmark ─────────────────────────────────────────────────────────────

export interface BenchmarkData {
  category: string;
  sample_count: number;
  industry_avg_engagement: number;
  industry_top10_engagement: number;
  total_posts: number;
  total_templates: number;
  message?: string;
}

export const getBenchmark = (category: string) =>
  apiFetch<BenchmarkData>(`/benchmark/${category}`);

// ─── Evaluate Poster ────────────────────────────────────────────────────────

export interface PosterAnnotation {
  number: number;
  x: number;
  y: number;
  title: string;
  detail: string;
  severity: 'info' | 'warning' | 'critical';
}

export interface SHAPContribution {
  feature: string;
  display_name: string;
  value: string | number;
  contribution: number;
  direction: 'positive' | 'negative' | 'neutral';
  percentage: number;
}

export interface SimilarPost {
  caption: string;
  engagement_rate: number;
  category: string;
  similarity: number;
}

export interface ImageQuality {
  brightness: number;
  contrast: number;
  saturation: number;
  sharpness: number;
  text_readability: number;
  quality_score: number;
  resolution: { width: number; height: number; ok: boolean };
  aspect_ratio: number;
  issues: string[];
  recommendations: string[];
}

export interface EvaluateResult {
  overall_score: number;
  poster_score: number;
  caption_score: number;
  confidence_interval: {
    lower: number;
    upper: number;
  };
  poster_improvements: string[];
  caption_improvements: string[];
  improved_caption: string;
  ocr_text: string;
  category: string;
  annotations: PosterAnnotation[];
  caption_features: Record<string, unknown>;
  model_version: string;
  evaluated_at: string;
  data_source?: 'mongodb' | 'heuristic';
  benchmarks?: {
    db_connected: boolean;
    category_samples: number;
    industry_avg_engagement?: number;
    top_10_engagement?: number;
    model_version?: string;
    model_auc?: number;
    cta_engagement_boost?: number;
    price_engagement_boost?: number;
    top_hashtags?: string[];
  };
  shap_contributions?: SHAPContribution[];
  similar_posts?: SimilarPost[];
  image_quality?: ImageQuality;
}

/**
 * Evaluate a poster image + caption by uploading a file.
 * Uses multipart/form-data POST to the /evaluate/poster endpoint.
 */
export const evaluatePoster = async (
  imageFile: File | null,
  imageUrl: string,
  caption: string,
): Promise<EvaluateResult> => {
  const formData = new FormData();

  if (imageFile) {
    formData.append('image', imageFile);
  } else if (imageUrl) {
    formData.append('image_url', imageUrl);
  }

  if (caption.trim()) {
    formData.append('caption', caption.trim());
  }

  const response = await fetch(`${API_BASE}/evaluate/poster`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(error.detail || `API Error: ${response.status}`);
  }

  return response.json();
};

/**
 * Evaluate a poster image URL + caption using GET (legacy endpoint).
 */
export const evaluatePosterGet = async (
  imageUrl: string,
  caption: string,
): Promise<{
  score: {
    score: number;
    lower: number;
    upper: number;
    confidence: number;
    model_version: string;
    evaluated_at: string;
  };
  ocr: Record<string, unknown>;
  annotations: PosterAnnotation[];
}> => {
  return apiFetch('/evaluate/poster', {
    params: { image_url: imageUrl, caption },
  });
};

// ─── Feedback ────────────────────────────────────────────────────────────

export interface FeedbackResponse {
  status: string;
  feedback_id: string;
  message: string;
}

export const submitFeedback = async (
  evaluationId: string,
  feedbackType: 'thumbs_up' | 'thumbs_down',
  score: number = 0,
  comment: string = '',
): Promise<FeedbackResponse> => {
  const formData = new FormData();
  if (evaluationId) formData.append('evaluation_id', evaluationId);
  formData.append('feedback_type', feedbackType);
  formData.append('score', String(score));
  formData.append('comment', comment);

  const response = await fetch(`${API_BASE}/feedback`, {
    method: 'POST',
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(error.detail || `API Error: ${response.status}`);
  }

  return response.json();
};

export interface FeedbackStats {
  total_feedback: number;
  thumbs_up: number;
  thumbs_down: number;
  satisfaction_rate: number;
}

export const getFeedbackStats = () =>
  apiFetch<FeedbackStats>('/feedback/stats');

// ─── Evaluations History ────────────────────────────────────────────────

export interface EvaluationRecord {
  _id: string;
  overall_score: number;
  poster_score: number;
  caption_score: number;
  category: string;
  caption: string;
  caption_features: Record<string, unknown>;
  model_version: string;
  created_at: string;
}

export interface EvaluationsHistoryResponse {
  count: number;
  evaluations: EvaluationRecord[];
}

export const getEvaluationsHistory = (limit = 20) =>
  apiFetch<EvaluationsHistoryResponse>('/evaluations/history', { params: { limit } });

// ─── Caption Variants ──────────────────────────────────────────────────

export interface CaptionVariant {
  platform: string;
  caption: string;
  reasoning: string;
}

export interface CaptionVariantsResponse {
  original_caption: string;
  category: string;
  variants: CaptionVariant[];
}

export const generateCaptionVariants = (caption: string, category: string = 'general') => {
  const formData = new FormData();
  formData.append('caption', caption);
  formData.append('category', category);

  return fetch(`${API_BASE}/caption/variants`, {
    method: 'POST',
    body: formData,
  }).then(res => {
    if (!res.ok) throw new Error('Caption variant generation failed');
    return res.json() as Promise<CaptionVariantsResponse>;
  });
};
