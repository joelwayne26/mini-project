'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  BarChart3,
  Brain,
  Database,
  FlaskConical,
  Gauge,
  GraduationCap,
  Heart,
  Map,
  MonitorDot,
  Radio,
  Settings,
  Star,
  TrendingUp,
  AlertTriangle,
} from 'lucide-react';
import {
  getHealth,
  getStats,
  getActivity,
  getTrends,
  runTransform,
  getFieldMap,
  checkTriggers,
  runRetrain,
  runFullPipeline,
  getDriftMeasurements,
  getDriftBaseline,
  checkWatcher,
  triggerWatcher,
  startWatcher,
  stopWatcher,
  getWatcherStatus,
  startWorker,
  stopWorker,
  getWorkerStatus,
  runSimulation,
  getModelHistory,
  type HealthStatus,
  type QuickStats,
  type Activity as ActivityType,
  type TrendSignal,
  type TransformResult,
  type TransformStatus,
  type FieldMapResponse,
  type RetrainTriggers,
  type RetrainResult,
  type FullPipelineResult,
  type DriftMeasurement,
  type DriftBaseline,
  type WatcherCheckResult,
  type WatcherStatus,
  type WorkerStatus,
  type SimulationResult,
  type ModelVersion,
} from '@/lib/api';
import { MOCK_HEALTH, MOCK_STATS, MOCK_ACTIVITIES, MOCK_TRENDS } from '@/lib/utils';

// ─── Shared Components ─────────────────────────────────────────────────────
import { PentagonLogo } from '@/components/shared/PentagonLogo';
import { StatusBadge } from '@/components/shared/StatusBadge';

// ─── Tab Components ────────────────────────────────────────────────────────
import { DashboardTab } from '@/components/tabs/DashboardTab';
import { PipelineTab } from '@/components/tabs/PipelineTab';
import { WatcherTab } from '@/components/tabs/WatcherTab';
import { FieldMapTab } from '@/components/tabs/FieldMapTab';
import { DriftTab } from '@/components/tabs/DriftTab';
import { RetrainTab } from '@/components/tabs/RetrainTab';
import { TrendsTab } from '@/components/tabs/TrendsTab';
import { SimulationTab } from '@/components/tabs/SimulationTab';
import { ModelsTab } from '@/components/tabs/ModelsTab';
import { WorkerTab } from '@/components/tabs/WorkerTab';
import { SettingsTab } from '@/components/tabs/SettingsTab';
import { HelpTab } from '@/components/tabs/HelpTab';
import { EvaluateTab } from '@/components/tabs/EvaluateTab';

// ─── Tab Definition ──────────────────────────────────────────────────────

interface TabDef {
  id: string;
  label: string;
  icon: React.ElementType;
  color: string;
}

const TABS: TabDef[] = [
  { id: 'dashboard', label: 'Dashboard', icon: Heart, color: 'text-sky-600' },
  { id: 'evaluate', label: 'Evaluate', icon: Star, color: 'text-amber-500' },
  { id: 'pipeline', label: 'Pipeline', icon: Database, color: 'text-emerald-600' },
  { id: 'watcher', label: 'Watcher', icon: Radio, color: 'text-amber-600' },
  { id: 'fieldmap', label: 'Field Map', icon: Map, color: 'text-violet-600' },
  { id: 'drift', label: 'Drift', icon: Gauge, color: 'text-red-500' },
  { id: 'retrain', label: 'Retrain', icon: Brain, color: 'text-purple-600' },
  { id: 'trends', label: 'Trends', icon: TrendingUp, color: 'text-blue-600' },
  { id: 'simulation', label: 'Simulation', icon: FlaskConical, color: 'text-orange-500' },
  { id: 'models', label: 'Models', icon: BarChart3, color: 'text-teal-600' },
  { id: 'worker', label: 'Worker', icon: MonitorDot, color: 'text-indigo-600' },
  { id: 'settings', label: 'Settings', icon: Settings, color: 'text-slate-600' },
  { id: 'help', label: 'Guide', icon: GraduationCap, color: 'text-pink-600' },
];

// ─── Main App ─────────────────────────────────────────────────────────────

export default function TrendLensApp() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [loading, setLoading] = useState(true);
  const [useMock, setUseMock] = useState(false);

  // Data states
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [stats, setStats] = useState<QuickStats | null>(null);
  const [activities, setActivities] = useState<ActivityType[]>([]);
  const [trends, setTrends] = useState<TrendSignal[]>([]);
  const [transformResult, setTransformResult] = useState<TransformResult | null>(null);
  const [transformStatus, setTransformStatus] = useState<TransformStatus | null>(null);
  const [fieldMap, setFieldMap] = useState<FieldMapResponse | null>(null);
  const [triggers, setTriggers] = useState<RetrainTriggers | null>(null);
  const [retrainResult, setRetrainResult] = useState<RetrainResult | null>(null);
  const [fullPipelineResult, setFullPipelineResult] = useState<FullPipelineResult | null>(null);
  const [driftMeasurements, setDriftMeasurements] = useState<DriftMeasurement[]>([]);
  const [driftBaseline, setDriftBaseline] = useState<DriftBaseline | null>(null);
  const [watcherCheck, setWatcherCheck] = useState<WatcherCheckResult | null>(null);
  const [watcherStatus, setWatcherStatus] = useState<WatcherStatus | null>(null);
  const [workerStatus, setWorkerStatus] = useState<WorkerStatus | null>(null);
  const [simResult, setSimResult] = useState<SimulationResult | null>(null);
  const [modelVersions, setModelVersions] = useState<ModelVersion[]>([]);

  // Loading states
  const [loadingTransform, setLoadingTransform] = useState(false);
  const [loadingTriggers, setLoadingTriggers] = useState(false);
  const [loadingRetrain, setLoadingRetrain] = useState(false);
  const [loadingFullPipeline, setLoadingFullPipeline] = useState(false);
  const [loadingDrift, setLoadingDrift] = useState(false);
  const [loadingSimulation, setLoadingSimulation] = useState(false);
  const [loadingTrends, setLoadingTrends] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [loadingWatcher, setLoadingWatcher] = useState(false);
  const [loadingFieldMap, setLoadingFieldMap] = useState(false);

  const [error, setError] = useState<string | null>(null);

  // Simulation params
  const [simIterations, setSimIterations] = useState(2);
  const [simTemplates, setSimTemplates] = useState(100);
  const [simPosts, setSimPosts] = useState(150);
  const [simInjectDrift, setSimInjectDrift] = useState(true);

  // ─── Initial Data Fetch ───────────────────────────────────────────────

  const fetchInitialData = useCallback(async (isRefresh = false) => {
    // Only show the full-screen spinner on the very first load,
    // NOT on background refreshes (which caused constant UI flashing)
    if (!isRefresh) setLoading(true);
    setError(null);
    try {
      const results = await Promise.allSettled([
        getHealth(),
        getStats(),
        getActivity(10),
      ]);
      if (results[0].status === 'fulfilled') setHealth(results[0].value);
      if (results[1].status === 'fulfilled') setStats(results[1].value);
      if (results[2].status === 'fulfilled') setActivities(results[2].value.activities);
      setUseMock(false);
    } catch {
      // Use mock data if backend is unavailable
      setHealth(MOCK_HEALTH);
      setStats(MOCK_STATS);
      setActivities(MOCK_ACTIVITIES);
      setUseMock(true);
    } finally {
      if (!isRefresh) setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInitialData(false);
    const interval = setInterval(() => fetchInitialData(true), 60000);
    return () => clearInterval(interval);
  }, [fetchInitialData]);

  // ─── Action Handlers ──────────────────────────────────────────────────

  const handleRunTransform = async () => {
    setLoadingTransform(true); setError(null);
    try {
      const result = await runTransform();
      setTransformResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transform failed');
    } finally { setLoadingTransform(false); }
  };

  const handleCheckTriggers = async () => {
    setLoadingTriggers(true); setError(null);
    try {
      const result = await checkTriggers();
      setTriggers(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Trigger check failed');
    } finally { setLoadingTriggers(false); }
  };

  const handleRunRetrain = async () => {
    setLoadingRetrain(true); setError(null);
    try {
      const result = await runRetrain();
      setRetrainResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Retrain failed');
    } finally { setLoadingRetrain(false); }
  };

  const handleFullPipeline = async () => {
    setLoadingFullPipeline(true); setError(null);
    try {
      const result = await runFullPipeline();
      setFullPipelineResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Full pipeline failed');
    } finally { setLoadingFullPipeline(false); }
  };

  const handleLoadDrift = async () => {
    setLoadingDrift(true); setError(null);
    try {
      const [meas, base] = await Promise.allSettled([getDriftMeasurements(), getDriftBaseline()]);
      if (meas.status === 'fulfilled') setDriftMeasurements(meas.value.measurements);
      if (base.status === 'fulfilled') setDriftBaseline(base.value);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load drift data');
    } finally { setLoadingDrift(false); }
  };

  const handleFetchTrends = async () => {
    setLoadingTrends(true); setError(null);
    try {
      const result = await getTrends('general', 50);
      setTrends(result.trends);
    } catch {
      setTrends(MOCK_TRENDS);
    } finally { setLoadingTrends(false); }
  };

  const handleFetchModels = async () => {
    setLoadingModels(true); setError(null);
    try {
      const result = await getModelHistory(50);
      setModelVersions(result.versions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch models');
    } finally { setLoadingModels(false); }
  };

  const handleCheckWatcher = async () => {
    setLoadingWatcher(true); setError(null);
    try {
      const [check, status] = await Promise.allSettled([checkWatcher(), getWatcherStatus()]);
      if (check.status === 'fulfilled') setWatcherCheck(check.value);
      if (status.status === 'fulfilled') setWatcherStatus(status.value);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Watcher check failed');
    } finally { setLoadingWatcher(false); }
  };

  const handleToggleWatcher = async () => {
    try {
      if (watcherStatus?.is_running) {
        await stopWatcher();
      } else {
        await startWatcher();
      }
      handleCheckWatcher();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Watcher toggle failed');
    }
  };

  const handleFetchFieldMap = async () => {
    setLoadingFieldMap(true); setError(null);
    try {
      const result = await getFieldMap();
      setFieldMap(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Field map fetch failed');
    } finally { setLoadingFieldMap(false); }
  };

  const handleRunSimulation = async () => {
    setLoadingSimulation(true); setError(null); setSimResult(null);
    try {
      const res = await runSimulation(simIterations, simTemplates, simPosts, simInjectDrift, false);
      setSimResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Simulation failed');
    } finally { setLoadingSimulation(false); }
  };

  const handleCheckWorker = async () => {
    try {
      const status = await getWorkerStatus();
      setWorkerStatus(status);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Worker status check failed');
    }
  };

  const handleToggleWorker = async () => {
    try {
      if (workerStatus?.is_running) {
        await stopWorker();
      } else {
        await startWorker();
      }
      handleCheckWorker();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Worker toggle failed');
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-sky-50 to-white flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-14 h-14 border-4 border-sky-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sky-600 font-medium">Loading TrendLens AI...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-sky-50 to-white">
      {/* ─── Top Header Bar ──────────────────────────────────────────────── */}
      <header className="bg-white border-b border-sky-200 shadow-sm">
        <div className="max-w-[1400px] mx-auto px-6 py-3 flex items-center justify-between">
          {/* Logo + Title */}
          <div className="flex items-center gap-4">
            <PentagonLogo />
            <div>
              <h1 className="text-xl font-bold gradient-text">TrendLens AI</h1>
              <p className="text-xs text-slate-400">Ugandan Food Business Analytics v6.0.0</p>
            </div>
          </div>

          {/* Status + Mock indicator */}
          <div className="flex items-center gap-3">
            {useMock && (
              <span className="px-3 py-1 bg-amber-100 text-amber-700 text-xs font-semibold rounded-full">
                Mock Data
              </span>
            )}
            {health && <StatusBadge status={health.status} />}
          </div>
        </div>
      </header>

      {/* ─── Icon Tab Bar ────────────────────────────────────────────────── */}
      <nav className="bg-white/80 backdrop-blur-sm border-b border-sky-100 sticky top-0 z-20">
        <div className="max-w-[1400px] mx-auto px-6">
          <div className="flex items-center gap-1 overflow-x-auto py-2 scrollbar-none">
            {TABS.map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`tab-icon flex flex-col items-center gap-1 px-3 py-2 rounded-xl min-w-[70px] transition-all ${
                    isActive
                      ? 'bg-sky-100 shadow-sm border border-sky-200'
                      : 'hover:bg-sky-50 border border-transparent'
                  }`}
                >
                  <Icon className={`w-5 h-5 ${isActive ? tab.color : 'text-slate-400'}`} />
                  <span className={`text-[10px] font-medium ${isActive ? 'text-sky-700' : 'text-slate-400'}`}>
                    {tab.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </nav>

      {/* ─── Main Content ────────────────────────────────────────────────── */}
      <main className="max-w-[1400px] mx-auto px-6 py-6">
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-600 text-sm mb-6 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {activeTab === 'dashboard' && (
          <DashboardTab
            stats={stats}
            health={health}
            activities={activities}
            setActiveTab={setActiveTab}
          />
        )}

        {activeTab === 'pipeline' && (
          <PipelineTab
            handleRunTransform={handleRunTransform}
            loadingTransform={loadingTransform}
            transformResult={transformResult}
            handleCheckTriggers={handleCheckTriggers}
            loadingTriggers={loadingTriggers}
            triggers={triggers}
            handleFullPipeline={handleFullPipeline}
            loadingFullPipeline={loadingFullPipeline}
            fullPipelineResult={fullPipelineResult}
            handleRunRetrain={handleRunRetrain}
            loadingRetrain={loadingRetrain}
            retrainResult={retrainResult}
          />
        )}

        {activeTab === 'watcher' && (
          <WatcherTab
            handleCheckWatcher={handleCheckWatcher}
            loadingWatcher={loadingWatcher}
            watcherStatus={watcherStatus}
            handleToggleWatcher={handleToggleWatcher}
            watcherCheck={watcherCheck}
            setError={setError}
          />
        )}

        {activeTab === 'fieldmap' && (
          <FieldMapTab
            handleFetchFieldMap={handleFetchFieldMap}
            loadingFieldMap={loadingFieldMap}
            fieldMap={fieldMap}
          />
        )}

        {activeTab === 'drift' && (
          <DriftTab
            handleLoadDrift={handleLoadDrift}
            loadingDrift={loadingDrift}
            driftBaseline={driftBaseline}
            driftMeasurements={driftMeasurements}
          />
        )}

        {activeTab === 'retrain' && (
          <RetrainTab
            handleCheckTriggers={handleCheckTriggers}
            loadingTriggers={loadingTriggers}
            triggers={triggers}
            handleRunRetrain={handleRunRetrain}
            loadingRetrain={loadingRetrain}
            retrainResult={retrainResult}
          />
        )}

        {activeTab === 'trends' && (
          <TrendsTab
            handleFetchTrends={handleFetchTrends}
            loadingTrends={loadingTrends}
            trends={trends}
          />
        )}

        {activeTab === 'simulation' && (
          <SimulationTab
            simIterations={simIterations}
            setSimIterations={setSimIterations}
            simTemplates={simTemplates}
            setSimTemplates={setSimTemplates}
            simPosts={simPosts}
            setSimPosts={setSimPosts}
            simInjectDrift={simInjectDrift}
            setSimInjectDrift={setSimInjectDrift}
            handleRunSimulation={handleRunSimulation}
            loadingSimulation={loadingSimulation}
            simResult={simResult}
          />
        )}

        {activeTab === 'models' && (
          <ModelsTab
            handleFetchModels={handleFetchModels}
            loadingModels={loadingModels}
            modelVersions={modelVersions}
          />
        )}

        {activeTab === 'worker' && (
          <WorkerTab
            handleCheckWorker={handleCheckWorker}
            workerStatus={workerStatus}
            handleToggleWorker={handleToggleWorker}
          />
        )}

        {activeTab === 'settings' && (
          <SettingsTab
            health={health}
            stats={stats}
          />
        )}

        {activeTab === 'evaluate' && (
          <EvaluateTab useMock={useMock} />
        )}

        {activeTab === 'help' && <HelpTab />}
      </main>

      {/* ─── Footer ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-sky-200 bg-white/50 mt-8">
        <div className="max-w-[1400px] mx-auto px-6 py-4 flex items-center justify-between text-xs text-slate-400">
          <span>TrendLens AI v6.0.0 — Ugandan Food Business Analytics</span>
          <span>MongoDB Atlas | Docker | SBERT + XGBoost</span>
        </div>
      </footer>
    </div>
  );
}
